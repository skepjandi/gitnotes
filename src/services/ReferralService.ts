/**
 * ReferralService.
 *
 * Manages referral deep-link parsing, pending code persistence,
 * and idempotent referral completion after first successful repository clone.
 *
 * Identity concerns (installation ID generation, identity proof construction)
 * are delegated to ReferralIdentityService.
 *
 * Security invariants:
 * - Identity proof tokens are NEVER sent in JSON body or query parameters.
 * - Completion is idempotent: only the first successful repo clone triggers completion.
 */

import AsyncStorage from '@react-native-async-storage/async-storage';

import { workerApi } from './workerApi';
import { ReferralIdentityService } from './ReferralIdentityService';

// AsyncStorage key for the pending referral code
const PENDING_CODE_KEY = '@gitnotes:referral_pending_code';

// AsyncStorage key for the first-repo eligibility state machine.
// State transitions:
//   unknown → pending  : first repo add has started (eligibility engaged)
//   pending  → connected : first repo clone succeeded (terminal, ineligible)
//   unknown  → connected : existing install detected at startup (ineligible)
// The pending state survives clone failures so retries remain eligible.
const FIRST_REPO_STATUS_KEY = '@gitnotes:first_repo_status';
const FIRST_REPO_STATUS_PENDING = 'pending';
const FIRST_REPO_STATUS_CONNECTED = 'connected';

// Local referral code expiry: 30 days. The server is the authoritative expiry;
// this client-side maximum prevents stale codes from persisting indefinitely.
const REFERRAL_CODE_MAX_TTL_MS = 30 * 24 * 60 * 60 * 1000;

// ── First-repo eligibility state machine ─────────────────────────────────────
//
// persisted to AsyncStorage so it survives process restarts.
// Guards referral completion so that:
//   - Existing installs (repos already saved) are never eligible (connected).
//   - A clone failure leaves status as pending — retry is still eligible.
//   - Only the first SUCCESSFUL clone transition to connected.

export type FirstRepoStatus = 'unknown' | 'pending' | 'connected';

/**
 * Get the current first-repo eligibility status.
 */
export async function getFirstRepoStatus(): Promise<FirstRepoStatus> {
  const raw = await AsyncStorage.getItem(FIRST_REPO_STATUS_KEY);
  if (raw === FIRST_REPO_STATUS_PENDING) return 'pending';
  if (raw === FIRST_REPO_STATUS_CONNECTED) return 'connected';
  return 'unknown';
}

/**
 * Persist 'pending' — first repo add has started. Must be called BEFORE
 * GitService.addRepository (which pre-persists the repo row). If clone fails,
 * status stays pending so retry is referral-eligible.
 */
export async function setFirstRepoPending(): Promise<void> {
  await AsyncStorage.setItem(FIRST_REPO_STATUS_KEY, FIRST_REPO_STATUS_PENDING);
}

/**
 * Persist 'connected' — first repo clone succeeded. Terminal state:
 * no further referral completion will be attempted.
 */
export async function setFirstRepoConnected(): Promise<void> {
  await AsyncStorage.setItem(FIRST_REPO_STATUS_KEY, FIRST_REPO_STATUS_CONNECTED);
}

/**
 * Initialize first-repo status at app startup.
 *
 * - If repos already exist and status is 'unknown' → set 'connected'
 *   (existing install, not eligible for referral).
 * - If no repos and status is 'unknown' → leave as 'unknown' (fresh install).
 * - If status is already 'pending' or 'connected' → leave unchanged.
 *
 * Call this once on app load (before any addRepository call).
 */
export async function initializeFirstRepoStatus(
  savedReposCount: number,
): Promise<FirstRepoStatus> {
  const current = await getFirstRepoStatus();
  if (current !== 'unknown') return current;
  if (savedReposCount > 0) {
    await setFirstRepoConnected();
    return 'connected';
  }
  return 'unknown';
}

// ── URL parsing ───────────────────────────────────────────────────────────────

/**
 * Parse a referral deep-link URL and return the referral code.
 *
 * Supported formats:
 * - Custom scheme: gitnotes://r/<code>
 * - HTTPS:         https://gitnotes.org/r/<code>
 *
 * Returns the code string if valid, or null if the URL is not a referral link
 * or the code is empty / malformed.
 *
 * SECURITY: This function does NOT validate the code format beyond non-emptiness.
 * Server-side validation determines whether the code is valid, expired, or replayed.
 */
export function parseDeepLink(url: string): string | null {
  if (!url || typeof url !== 'string') return null;

  const trimmed = url.trim();
  if (trimmed.length === 0) return null;

  // Guard against path traversal attempts
  if (trimmed.includes('..')) return null;

  // Custom scheme: gitnotes://r/<code>
  // hostname is "r", pathname is "/<code>"
  try {
    const parsed = new URL(trimmed);
    if (parsed.protocol === 'gitnotes:') {
      if (parsed.hostname === 'r') {
        // Reject query strings and fragments — they cannot appear in a valid referral deep link
        if (parsed.search || parsed.hash) return null;
        const code = parsed.pathname.replace(/^\/+/, '').trim();
        // Referral codes must be alphanumeric + hyphen + underscore (URL-safe base64)
        if (!/^[A-Za-z0-9_-]+$/.test(code)) return null;
        return code.length > 0 ? code : null;
      }
      return null; // gitnotes:// but not /r/
    }
    // HTTPS: https://gitnotes.org/r/<code>
    if (
      parsed.protocol === 'https:' &&
      (parsed.hostname === 'gitnotes.org' || parsed.hostname === 'www.gitnotes.org')
    ) {
      if (parsed.pathname.startsWith('/r/')) {
        // Reject query strings and fragments
        if (parsed.search || parsed.hash) return null;
        const code = parsed.pathname.slice(3).trim();
        // Referral codes must be alphanumeric + hyphen + underscore (URL-safe base64)
        if (!/^[A-Za-z0-9_-]+$/.test(code)) return null;
        return code.length > 0 ? code : null;
      }
      return null;
    }
    return null;
  } catch {
    return null;
  }
}

// ── Pending code storage ──────────────────────────────────────────────────────

interface StoredPendingCode {
  readonly code: string;
  readonly expiresAt: number;
}

/**
 * Store a pending referral code if no non-expired code is already stored.
 * Preserves existing pending codes rather than silently overwriting them.
 */
export async function storePendingCode(code: string, expiresAt: number): Promise<void> {
  const existing = await getPendingCode();
  if (existing) {
    // Don't overwrite a valid pending code
    return;
  }
  const payload: StoredPendingCode = { code, expiresAt };
  await AsyncStorage.setItem(PENDING_CODE_KEY, JSON.stringify(payload));
}

/**
 * Retrieve the pending referral code if one is stored and not expired.
 * Returns null if no code is stored, or if the stored code has expired.
 */
export async function getPendingCode(): Promise<StoredPendingCode | null> {
  const raw = await AsyncStorage.getItem(PENDING_CODE_KEY);
  if (!raw) return null;

  let parsed: StoredPendingCode;
  try {
    parsed = JSON.parse(raw) as StoredPendingCode;
  } catch {
    await AsyncStorage.removeItem(PENDING_CODE_KEY);
    return null;
  }

  if (typeof parsed.code !== 'string' || typeof parsed.expiresAt !== 'number') {
    await AsyncStorage.removeItem(PENDING_CODE_KEY);
    return null;
  }

  if (parsed.expiresAt <= Date.now()) {
    await AsyncStorage.removeItem(PENDING_CODE_KEY);
    return null;
  }

  return { code: parsed.code, expiresAt: parsed.expiresAt };
}

/**
 * Clear any stored pending referral code.
 */
export async function clearPendingCode(): Promise<void> {
  await AsyncStorage.removeItem(PENDING_CODE_KEY);
}

// ── Referral completion ─────────────────────────────────────────────────────

/**
 * Attempt referral completion idempotently.
 *
 * Calls POST /referrals/complete with the pending referral code and
 * current identity proof. Guards on persisted 'pending' status so that:
 *   - Existing installs (status = connected) are never eligible.
 *   - Clone failures (status = pending) allow retry.
 *   - Server idempotency prevents duplicate completions.
 *
 * @param code - Referral code to claim. If omitted, uses the stored pending code.
 * @returns The accepted result from the server, or undefined if not eligible / no code.
 */
export async function completeReferral(code?: string): Promise<{ accepted: boolean } | undefined> {
  const status = await getFirstRepoStatus();
  if (status !== 'pending') return undefined;
  const claimCode = code ?? (await getPendingCode())?.code;
  if (!claimCode) return undefined;

  const proof = await ReferralIdentityService.getIdentityProof();

  let result: { accepted: boolean };
  try {
    result = await workerApi.referrals.complete({ code: claimCode }, proof);
  } catch {
    // Completion is retryable — network errors should not throw
    return undefined;
  }

  // Only mark completed and clear code when server explicitly accepts
  // false result preserves pending code for retry; server will return
  // idempotent result for replayed completions
  if (result.accepted) {
    await setFirstRepoConnected();
    await clearPendingCode();
  }
  return result;
}

/**
 * Returns true if first-repo referral completion has already been called.
 */
export async function hasCompletedFirstRepo(): Promise<boolean> {
  return (await getFirstRepoStatus()) === 'connected';
}

/**
 * Reset first-repo status to 'unknown' — for fresh-install / account logout.
 * This makes the device eligible for referral completion again.
 */
export async function resetFirstRepoCompletion(): Promise<void> {
  await AsyncStorage.removeItem(FIRST_REPO_STATUS_KEY);
}

/**
 * Handle successful first repository clone.
 *
 * Called by the repo-add / onboarding flow when the first repository
 * clone/sync completes successfully. Guards on status === 'pending'.
 * ALWAYS transitions to 'connected' after calling completeReferral — even
 * if no pending code exists — because the first connection attempt is done
 * and future second repos must never re-trigger completion.
 */
export async function onFirstRepoCloneSuccess(): Promise<void> {
  const status = await getFirstRepoStatus();
  if (status !== 'pending') return;
  const pending = await getPendingCode();
  if (!pending) {
    // No pending code but first clone succeeded — mark ineligible permanently.
    await setFirstRepoConnected();
    return;
  }
  await completeReferral();
}

// ── Deep-link capture ───────────────────────────────────────────────────────

/**
 * Capture a referral URL from cold-start or runtime deep-link event.
 *
 * Parses the URL using parseDeepLink and, if valid, stores the code with
 * a 30-day local expiry (REFERRAL_CODE_MAX_TTL_MS). Non-referral URLs
 * return false and leave no side-effects.
 *
 * This is the single function AppNavigator wires for both:
 *   - Linking.getInitialURL()  (cold start)
 *   - Linking.addEventListener('url', ...)  (runtime)
 *
 * Returns true if the URL was consumed as a referral link, false otherwise.
 */
export async function captureReferralUrl(url: string): Promise<boolean> {
  const code = parseDeepLink(url);
  if (!code) return false;
  await storePendingCode(code, Date.now() + REFERRAL_CODE_MAX_TTL_MS);
  return true;
}

// ── Service export ──────────────────────────────────────────────────────────

export const ReferralService = {
  parseDeepLink,
  captureReferralUrl,
  getOrCreateInstallationId: ReferralIdentityService.getOrCreateInstallationId,
  getIdentityProof: ReferralIdentityService.getIdentityProof,
  storePendingCode,
  getPendingCode,
  clearPendingCode,
  completeReferral,
  hasCompletedFirstRepo,
  resetFirstRepoCompletion,
  onFirstRepoCloneSuccess,
  getFirstRepoStatus,
  setFirstRepoPending,
  setFirstRepoConnected,
  initializeFirstRepoStatus,
};

export default ReferralService;
