/**
 * ReferralIdentityService.
 *
 * Manages the cryptographic installation ID and identity proof construction for
 * referral API calls.
 *
 * Security invariants:
 * - Installation ID is generated using cryptographically secure random bytes
 *   via expo-crypto (UUIDv4 format). Math.random is never used.
 * - Installation ID is persisted in SecureStore (iOS Keychain, Android EncryptedSharedPreferences).
 * - Installation ID is NOT guaranteed to reset on iOS reinstall due to Keychain persistence;
 *   this is documented as an abuse-limit key, not a verified identity.
 * - GitHub OAuth token (when available) is used as the primary identity proof because
 *   the Worker backend can verify it against GitHub /user API.
 * - Identity proof tokens are NEVER sent in JSON body or query parameters.
 */

import * as Crypto from 'expo-crypto';
import * as SecureStore from 'expo-secure-store';

import { AccountStorage } from './AccountStorage';
import type { ReferralIdentityProof } from '../types/worker';

// SecureStore key for the cryptographic installation ID
const INSTALL_ID_KEY = 'gitnotes_install_id';

// ── UUID generation via expo-crypto ───────────────────────────────────────────

/**
 * Generate a UUID v4 using cryptographically secure random bytes.
 * Uses expo-crypto.getRandomBytesAsync (iOS SecRandomCopyBytes, Android SecureRandom).
 * NEVER uses Math.random().
 */
async function generateSecureUuid(): Promise<string> {
  const bytes = await Crypto.getRandomBytesAsync(16);
  const view = new DataView(bytes.buffer as ArrayBuffer);

  // Set version (4) and variant (RFC 4122)
  view.setUint8(6, (view.getUint8(6) & 0x0f) | 0x40);
  view.setUint8(8, (view.getUint8(8) & 0x3f) | 0x80);

  const hex = (b: number) => b.toString(16).padStart(2, '0');
  return [
    hex(view.getUint8(0)),
    hex(view.getUint8(1)),
    hex(view.getUint8(2)),
    hex(view.getUint8(3)),
    '-',
    hex(view.getUint8(4)),
    hex(view.getUint8(5)),
    '-',
    hex(view.getUint8(6)),
    hex(view.getUint8(7)),
    '-',
    hex(view.getUint8(8)),
    hex(view.getUint8(9)),
    '-',
    hex(view.getUint8(10)),
    hex(view.getUint8(11)),
    hex(view.getUint8(12)),
    hex(view.getUint8(13)),
    hex(view.getUint8(14)),
    hex(view.getUint8(15)),
  ].join('');
}

// ── Installation ID ──────────────────────────────────────────────────────────

/**
 * Get the persistent installation ID, creating it if it does not exist.
 *
 * Uses SecureStore (iOS Keychain / Android EncryptedSharedPreferences).
 * Generation uses cryptographically secure random bytes (UUIDv4 via expo-crypto).
 *
 * @throws if SecureStore is unavailable (no predictable fallback)
 */
export async function getOrCreateInstallationId(): Promise<string> {
  try {
    const existing = await SecureStore.getItemAsync(INSTALL_ID_KEY);
    if (existing) return existing;
  } catch {
    // SecureStore unavailable — throw rather than falling back to predictable ID
    throw new Error('SecureStore unavailable: cannot create or retrieve installation identity');
  }

  const id = await generateSecureUuid();

  try {
    await SecureStore.setItemAsync(INSTALL_ID_KEY, id);
  } catch (error) {
    throw new Error(
      `SecureStore write failed: cannot persist installation identity. Error: ${error instanceof Error ? error.message : String(error)}`,
    );
  }

  return id;
}

// ── Identity scope ───────────────────────────────────────────────────────────

/**
 * Identity scope for cache namespacing — carries no credentials.
 *
 * 'github' scope: GitHub credentials are available; cache is namespaced by
 *   the local account ID (StoredAccount.id) which is stable per GitHub login.
 *   The raw token/credential is NOT part of this scope.
 *
 * 'installation' scope: no GitHub credentials; cache is namespaced by the
 *   SecureStore installation UUID only.
 */
export type IdentityScope =
  | { readonly kind: 'github'; readonly accountId: string; readonly installationId: string }
  | { readonly kind: 'installation'; readonly installationId: string };

/**
 * Get the current identity scope for cache namespacing.
 *
 * Returns 'github' scope with the local accountId when GitHub credentials exist.
 * Returns 'installation' scope with the SecureStore installationId otherwise.
 *
 * No credentials are stored or logged — only stable local identifiers.
 */
export async function getIdentityScope(): Promise<IdentityScope> {
  const installId = await getOrCreateInstallationId();

  const activeHostId = await AccountStorage.getActiveHostId();
  if (activeHostId) {
    const connection = await AccountStorage.getHostConnection(activeHostId);
    if (connection?.provider === 'github') {
      return { kind: 'github', accountId: connection.accountId, installationId: installId };
    }
  }
  return { kind: 'installation', installationId: installId };
}

// ── Identity proof ───────────────────────────────────────────────────────────

/**
 * Build a ReferralIdentityProof for referral API calls.
 *
 * Prefers GitHub OAuth credential (verifiable by Worker via GitHub /user API)
 * as the primary identity. Falls back to GitHub user PAT (via getHostToken)
 * when OAuth is unavailable. Never treats GitLab/Gitea/Forgejo tokens as GitHub.
 *
 * If no GitHub credential is available, falls back to installation-only
 * (rate-limit key via SecureStore install ID).
 *
 * GitHub App installation tokens are NOT sent through X-Referral-Token —
 * they are not user-scoped credentials and cannot be verified via /user API.
 * GitHub App-only setups (no user PAT) fall back to installation-only identity.
 *
 * The installation ID is always included alongside the GitHub token so the
 * backend can apply per-install abuse limits independently of GitHub identity.
 */
export async function getIdentityProof(): Promise<ReferralIdentityProof> {
  const installId = await getOrCreateInstallationId();

  const activeHostId = await AccountStorage.getActiveHostId();
  if (activeHostId) {
    const connection = await AccountStorage.getHostConnection(activeHostId);
    // Only use GitHub credentials — GitLab/Gitea/Forgejo are not GitHub
    if (connection?.provider === 'github') {
      // Prefer OAuth credential (verifiable via /user API)
      const oauth = await AccountStorage.getOAuthCredential(activeHostId);
      if (oauth?.accessToken && oauth.accessToken.length > 0) {
        return { kind: 'github', token: oauth.accessToken, installationId: installId };
      }
      // Fall back to GitHub user PAT (getHostToken).
      // GitHub App installation tokens are stored separately via getGitHubAppCredential
      // and are NOT used here — they cannot be verified via /user API.
      const pat = await AccountStorage.getHostToken(activeHostId);
      if (pat && pat.length > 0) {
        return { kind: 'github', token: pat, installationId: installId };
      }
    }
  }

  // Fallback to installation-only
  return { kind: 'installation', installationId: installId };
}

// ── Service export ────────────────────────────────────────────────────────────

export const ReferralIdentityService = {
  getOrCreateInstallationId,
  getIdentityProof,
  getIdentityScope,
};

export default ReferralIdentityService;
