/**
 * ReviewPromptService.ts
 *
 * Conservative native review prompting with persistent eligibility tracking.
 *
 * Policy (from issues.md):
 * - Eligibility: successfulSyncCount >= 3 OR notesCreatedCount >= 5,
 *   AND at least 14 days since first launch
 * - 90-day interval between prompt attempts
 * - Maximum 3 dismiss attempts before suppressing permanently
 * - Suppress during: onboarding, active sync, recent failure/error
 * - Never claim requestReview() resolution proves a review was submitted
 * - expo-store-review is the native SDK; web returns unavailable
 */

import AsyncStorage from '@react-native-async-storage/async-storage';
import { Platform } from 'react-native';
import { Linking } from 'react-native';

// ── Storage keys ────────────────────────────────────────────────────────────

const STORAGE_KEY = '@gitnotes:review_prompt_state';

// ── Persistent state shape ─────────────────────────────────────────────────

export interface ReviewPromptState {
  /** Wall-clock ms timestamp of first app launch. */
  firstLaunchAt: number | null;
  /** Number of completed whole successful syncs. */
  successfulSyncCount: number;
  /** Number of successfully created notes. */
  notesCreatedCount: number;
  /** Wall-clock ms timestamp of last native prompt attempt (not dismissal). */
  lastPromptAt: number | null;
  /** Number of times user dismissed the prompt. */
  dismissAttempts: number;
  /** Wall-clock ms timestamp of last dismissal. */
  dismissedAt: number | null;
  /** Total number of native prompt API calls made (capped at MAX_PROMPT_ATTEMPTS). */
  attemptsCount: number;
}

// ── Eligibility result ──────────────────────────────────────────────────────

export type ReviewPromptEligibleReason =
  | 'eligible'
  | 'not_enough_usage'
  | 'too_recent'
  | 'cooldown_active'
  | 'max_dismiss_attempts'
  | 'max_attempts'
  | 'onboarding_incomplete'
  | 'sync_in_flight'
  | 'recent_failure';

export interface ReviewPromptEligibility {
  eligible: boolean;
  reason: ReviewPromptEligibleReason;
  daysSinceFirstLaunch: number | null;
  daysSinceLastPrompt: number | null;
  successfulSyncCount: number;
  notesCreatedCount: number;
  dismissAttempts: number;
  attemptsCount: number;
}

// ── Defaults ───────────────────────────────────────────────────────────────

const DEFAULT_STATE: ReviewPromptState = {
  firstLaunchAt: null,
  successfulSyncCount: 0,
  notesCreatedCount: 0,
  lastPromptAt: null,
  dismissAttempts: 0,
  dismissedAt: null,
  attemptsCount: 0,
};

// ── Constants ─────────────────────────────────────────────────────────────

const DAYS_MS = 24 * 60 * 60 * 1000;
const FOURTEEN_DAYS_MS = 14 * DAYS_MS;
const NINETY_DAYS_MS = 90 * DAYS_MS;
const MAX_DISMISS_ATTEMPTS = 3;
const MAX_PROMPT_ATTEMPTS = 3;

// ── Store listing URLs (official App Store / Play Store) ───────────────────

/**
 * Returns the platform-specific store listing URL configured in app.json,
 * or the direct store URL as a fallback if not configured.
 */
export function getStoreListingUrl(): string | null {
  // Lazy require to avoid importing expo-constants at module load time — it accesses
  // native modules (EXDevLauncher) that are unavailable in Jest/test environments.
  const Constants = require('expo-constants') as { expoConfig?: Record<string, unknown> };
  const expoConfig = Constants.expoConfig as unknown as Record<string, unknown> | undefined;
  if (expoConfig) {
    if (Platform.OS === 'ios') {
      const ios = expoConfig.ios as unknown as Record<string, unknown> | undefined;
      const url = ios?.appStoreUrl as string | undefined;
      if (url) return url;
    }
    if (Platform.OS === 'android') {
      const android = expoConfig.android as unknown as Record<string, unknown> | undefined;
      const url = android?.playStoreUrl as string | undefined;
      if (url) return url;
    }
  }
  if (Platform.OS === 'ios') {
    return 'https://apps.apple.com/app/gitnotes/id6764829004';
  }
  if (Platform.OS === 'android') {
    return 'https://play.google.com/store/apps/details?id=org.gitnotes.app';
  }
  return null;
}

// ── Module-level state (in-memory cache, persisted to AsyncStorage) ─────────

let _state: ReviewPromptState = { ...DEFAULT_STATE };
let _storageLoaded = false;
/** Prevents concurrent native prompt attempts from exceeding MAX_PROMPT_ATTEMPTS. */
let _attemptingReview = false;

// ── Storage helpers ─────────────────────────────────────────────────────────

async function loadState(): Promise<void> {
  if (_storageLoaded) return;
  try {
    const raw = await AsyncStorage.getItem(STORAGE_KEY);
    if (raw) {
      const parsed = JSON.parse(raw) as Partial<ReviewPromptState>;
      _state = {
        firstLaunchAt: parsed.firstLaunchAt ?? null,
        successfulSyncCount: parsed.successfulSyncCount ?? 0,
        notesCreatedCount: parsed.notesCreatedCount ?? 0,
        lastPromptAt: parsed.lastPromptAt ?? null,
        dismissAttempts: parsed.dismissAttempts ?? 0,
        dismissedAt: parsed.dismissedAt ?? null,
        attemptsCount: parsed.attemptsCount ?? 0,
      };
    } else {
      // First time: record first launch
      _state.firstLaunchAt = Date.now();
      await persistState();
    }
  } catch {
    // Storage error: start fresh but record first launch
    _state.firstLaunchAt = Date.now();
  }
  _storageLoaded = true;
}

async function persistState(): Promise<void> {
  try {
    await AsyncStorage.setItem(STORAGE_KEY, JSON.stringify(_state));
  } catch {
    // Storage errors must never break note creation or sync
  }
}

// ── Guard helpers (imported lazily to avoid circular deps) ─────────────────

async function isOnboardingComplete(): Promise<boolean> {
  try {
    const { OnboardingService } = require('./OnboardingService');
    return OnboardingService.isOnboardingCompleted();
  } catch {
    return false;
  }
}

function isSyncInFlight(): boolean {
  try {
    // ForegroundSyncService may not be booted in all environments (e.g. tests).
    const { isForegroundSyncInFlight } = require('./ForegroundSyncService');
    return isForegroundSyncInFlight();
  } catch {
    return false;
  }
}

function hasRecentFailure(): boolean {
  try {
    const { getForegroundSyncHealth } = require('./ForegroundSyncService');
    const health = getForegroundSyncHealth();
    return health.status === 'failed' || health.status === 'timedout';
  } catch {
    return false;
  }
}

// ── Eligibility check ───────────────────────────────────────────────────────

/**
 * Full eligibility evaluation. Safe to call from anywhere; never throws.
 */
export async function checkEligibility(): Promise<ReviewPromptEligibility> {
  await loadState();

  const now = Date.now();
  const { firstLaunchAt, successfulSyncCount, notesCreatedCount, lastPromptAt, dismissAttempts, attemptsCount } = _state;

  // Suppress during onboarding
  if (!(await isOnboardingComplete())) {
    return {
      eligible: false,
      reason: 'onboarding_incomplete',
      daysSinceFirstLaunch: firstLaunchAt ? Math.floor((now - firstLaunchAt) / DAYS_MS) : null,
      daysSinceLastPrompt: lastPromptAt ? Math.floor((now - lastPromptAt) / DAYS_MS) : null,
      successfulSyncCount,
      notesCreatedCount,
      dismissAttempts,
      attemptsCount,
    };
  }

  // Suppress when sync is active
  if (isSyncInFlight()) {
    return {
      eligible: false,
      reason: 'sync_in_flight',
      daysSinceFirstLaunch: firstLaunchAt ? Math.floor((now - firstLaunchAt) / DAYS_MS) : null,
      daysSinceLastPrompt: lastPromptAt ? Math.floor((now - lastPromptAt) / DAYS_MS) : null,
      successfulSyncCount,
      notesCreatedCount,
      dismissAttempts,
      attemptsCount,
    };
  }

  // Suppress after recent failure
  if (hasRecentFailure()) {
    return {
      eligible: false,
      reason: 'recent_failure',
      daysSinceFirstLaunch: firstLaunchAt ? Math.floor((now - firstLaunchAt) / DAYS_MS) : null,
      daysSinceLastPrompt: lastPromptAt ? Math.floor((now - lastPromptAt) / DAYS_MS) : null,
      successfulSyncCount,
      notesCreatedCount,
      dismissAttempts,
      attemptsCount,
    };
  }

  // Max dismiss attempts reached
  if (dismissAttempts >= MAX_DISMISS_ATTEMPTS) {
    return {
      eligible: false,
      reason: 'max_dismiss_attempts',
      daysSinceFirstLaunch: firstLaunchAt ? Math.floor((now - firstLaunchAt) / DAYS_MS) : null,
      daysSinceLastPrompt: lastPromptAt ? Math.floor((now - lastPromptAt) / DAYS_MS) : null,
      successfulSyncCount,
      notesCreatedCount,
      dismissAttempts,
      attemptsCount,
    };
  }

  // Max total native prompt attempts reached
  if (attemptsCount >= MAX_PROMPT_ATTEMPTS) {
    return {
      eligible: false,
      reason: 'max_attempts',
      daysSinceFirstLaunch: firstLaunchAt ? Math.floor((now - firstLaunchAt) / DAYS_MS) : null,
      daysSinceLastPrompt: lastPromptAt ? Math.floor((now - lastPromptAt) / DAYS_MS) : null,
      successfulSyncCount,
      notesCreatedCount,
      dismissAttempts,
      attemptsCount,
    };
  }

  // 14-day threshold
  if (firstLaunchAt === null || now - firstLaunchAt < FOURTEEN_DAYS_MS) {
    return {
      eligible: false,
      reason: 'too_recent',
      daysSinceFirstLaunch: firstLaunchAt ? Math.floor((now - firstLaunchAt) / DAYS_MS) : null,
      daysSinceLastPrompt: lastPromptAt ? Math.floor((now - lastPromptAt) / DAYS_MS) : null,
      successfulSyncCount,
      notesCreatedCount,
      dismissAttempts,
      attemptsCount,
    };
  }

  // Usage threshold: >=3 successful syncs OR >=5 notes created
  const hasEnoughUsage = successfulSyncCount >= 3 || notesCreatedCount >= 5;
  if (!hasEnoughUsage) {
    return {
      eligible: false,
      reason: 'not_enough_usage',
      daysSinceFirstLaunch: Math.floor((now - firstLaunchAt) / DAYS_MS),
      daysSinceLastPrompt: lastPromptAt ? Math.floor((now - lastPromptAt) / DAYS_MS) : null,
      successfulSyncCount,
      notesCreatedCount,
      dismissAttempts,
      attemptsCount,
    };
  }

  // 90-day cooldown since last prompt attempt
  if (lastPromptAt !== null && now - lastPromptAt < NINETY_DAYS_MS) {
    return {
      eligible: false,
      reason: 'cooldown_active',
      daysSinceFirstLaunch: Math.floor((now - firstLaunchAt) / DAYS_MS),
      daysSinceLastPrompt: Math.floor((now - lastPromptAt) / DAYS_MS),
      successfulSyncCount,
      notesCreatedCount,
      dismissAttempts,
      attemptsCount,
    };
  }

  return {
    eligible: true,
    reason: 'eligible',
    daysSinceFirstLaunch: Math.floor((now - firstLaunchAt) / DAYS_MS),
    daysSinceLastPrompt: lastPromptAt ? Math.floor((now - lastPromptAt) / DAYS_MS) : null,
    successfulSyncCount,
    notesCreatedCount,
    dismissAttempts,
    attemptsCount,
  };
}

// ── Event recorders (never throw, never break callers) ───────────────────────

/**
 * Call after a whole successful sync completes (pull + push cycle).
 * Increments successfulSyncCount by 1.
 */
export async function recordSuccessfulSync(): Promise<void> {
  try {
    await loadState();
    _state.successfulSyncCount += 1;
    await persistState();
  } catch {
    // Storage errors must never break sync
  }
}

/**
 * Call after a note is successfully created and persisted.
 * Increments notesCreatedCount by 1.
 */
export async function recordNoteCreated(): Promise<void> {
  try {
    await loadState();
    _state.notesCreatedCount += 1;
    await persistState();
  } catch {
    // Storage errors must never break note creation
  }
}

// ── Prompt actions ─────────────────────────────────────────────────────────

/**
 * Attempts the native review prompt. Returns true if the native API was called
 * successfully; does NOT prove a review was submitted.
 *
 * expo-store-review:
 * - isAvailableAsync() must be called before requestReview()
 * - requestReview() resolves void; does not prove submission
 * - Web returns unavailable
 * - Errors are swallowed; the Settings store-listing remains available
 */
export async function attemptNativeReviewPrompt(): Promise<boolean> {
  // Single-flight guard: concurrent callers wait for the first attempt to complete
  if (_attemptingReview) return false;
  _attemptingReview = true;
  try {
    // Re-check cap and cooldown inside the lock — state may have changed while waiting
    const now = Date.now();
    if (
      _state.attemptsCount >= MAX_PROMPT_ATTEMPTS ||
      (_state.lastPromptAt !== null && now - _state.lastPromptAt < NINETY_DAYS_MS)
    ) {
      return false;
    }

    const StoreReview = require('expo-store-review');
    const available = await StoreReview.isAvailableAsync();
    if (!available) return false;

    const hasAction = await StoreReview.hasAction();
    if (!hasAction) return false;

    // Increment attemptsCount BEFORE the call so concurrent events cannot exceed the cap
    _state.attemptsCount += 1;
    _state.lastPromptAt = Date.now();
    await persistState();

    await StoreReview.requestReview();
    return true;
  } catch {
    return false;
  } finally {
    _attemptingReview = false;
  }
}

/**
 * Called when the user explicitly dismisses the prompt.
 * Records the dismissal so we can enforce the max-dismiss-attempts cap.
 */
export async function recordDismiss(): Promise<void> {
  try {
    await loadState();
    _state.dismissAttempts += 1;
    _state.dismissedAt = Date.now();
    await persistState();
  } catch {
    // Storage errors must never break note creation or sync
  }
}

/**
 * Orchestrates the review prompt flow. Called from successful usage events
 * (sync complete, note created). Runs the eligibility check and, only if
 * eligible, calls the native review prompt.
 *
 * Rules:
 * - Must be in foreground (AppState === 'active')
 * - Onboarding must be complete
 * - No sync in flight
 * - No recent failure
 * - First launch >= 14 days ago
 * - Usage threshold met (3+ syncs OR 5+ notes)
 * - 90-day cooldown elapsed
 * - Max 3 total native prompt attempts not exceeded
 * - Max 3 dismiss attempts not exceeded
 *
 * Safe to call fire-and-forget from event handlers; never throws.
 */
export async function maybeRequestReviewPrompt(): Promise<void> {
  try {
    const { AppState } = require('react-native');
    if (AppState.currentState !== 'active') return;

    const eligibility = await checkEligibility();
    if (!eligibility.eligible) return;

    await attemptNativeReviewPrompt();
  } catch {
    // Never throw — prompt failures must not affect sync or note creation
  }
}

/**
 * Sequences counter persistence then eligibility check. Used by callers
 * (ForegroundSyncService, noteStore) who need the counter persisted BEFORE
 * the eligibility gate runs. Safe to call as void; never throws.
 */
export async function __recordAndMaybePrompt(
  counter: 'sync' | 'note',
): Promise<void> {
  try {
    if (counter === 'sync') {
      await recordSuccessfulSync();
    } else {
      await recordNoteCreated();
    }
    // Counter is now persisted; check eligibility with guaranteed up-to-date state
    await maybeRequestReviewPrompt();
  } catch {
    // Never throw — prompt failures must not affect sync or note creation
  }
}

/**
 * Initializes first-launch timestamp on app startup. Idempotent —
 * calling multiple times on the same launch is safe. Must be called
 * early in the app boot sequence so firstLaunchAt reflects the true
 * wall-clock first launch, not the first note/sync event.
 *
 * Safe to call fire-and-forget; never throws.
 */
export async function initializeOnLaunch(): Promise<void> {
  try {
    await loadState();
    if (_state.firstLaunchAt === null) {
      _state.firstLaunchAt = Date.now();
      await persistState();
    }
  } catch {
    // Storage errors must not break app startup
  }
}

/**
 * Opens the platform store listing URL. Used as the Settings action and as
 * the fallback when the native review prompt is unavailable.
 */
export async function openStoreListing(): Promise<boolean> {
  const url = getStoreListingUrl();
  if (!url) return false;
  try {
    const supported = await Linking.canOpenURL(url);
    if (!supported) return false;
    await Linking.openURL(url);
    return true;
  } catch {
    return false;
  }
}

// ── Debug / test helpers ────────────────────────────────────────────────────

export function getPersistedState(): ReviewPromptState {
  return { ..._state };
}

export async function __resetForTest(): Promise<void> {
  _state = { ...DEFAULT_STATE, firstLaunchAt: Date.now() };
  _storageLoaded = false;
  _attemptingReview = false;
  try {
    await AsyncStorage.removeItem(STORAGE_KEY);
  } catch {
    // noop
  }
}

export async function __forceStateForTest(state: Partial<ReviewPromptState>): Promise<void> {
  _state = { ..._state, ...state };
  await persistState();
}
