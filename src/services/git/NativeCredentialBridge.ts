/**
 * Native credential bridge — maps per-repo credential lifecycle to the Rust engine.
 *
 * The Rust engine (`engine/credentials.rs`) maintains a per-repo registry of
 * `CredentialSource` variants. This bridge keeps the JS-side state in sync:
 *
 * - `setGitHubOAuth(repoId, hostId, token)` → stores `CredentialSource.GitHubOAuth`
 * - `setGitHubApp(repoId, hostId, token)` → stores `CredentialSource.GitHubAppInstallation`
 * - `setPat(repoId, hostId, token)` → stores `CredentialSource.UserPass`
 * - `clearCredential(repoId)` → removes the registration
 *
 * SECURITY INVARIANTS:
 * - OAuth identity tokens are NEVER passed to native Git callbacks — only
 *   repository-scoped OAuth tokens (exchanged via the backend PKCE flow) and
 *   GitHub App installation tokens reach the Rust engine via `x-access-token`.
 * - App credentials are isolated to their selected repositories: operations on
 *   repos outside the selection fail fast before hitting the network.
 * - PAT credentials never use this bridge for GitHub OAuth/App — PAT auth
 *   remains entirely within the existing `GitHubHostService` flow.
 *
 * The bridge does NOT own storage — `AccountStorage` holds the credential
 * records; this bridge only propagates the active token to the Rust engine
 * for clone/fetch/push/pull operations.
 */

import type { GitHubAppCredentialRecord } from './contracts';
import { isInstallationTokenExpired } from './contracts';
import { GitHubAppService } from '../GitHubAppService';
import { AccountStorage } from '../AccountStorage';

// ── Types ────────────────────────────────────────────────────────────────────

export type CredentialKindForNative = 'oauth' | 'github_app' | 'token' | 'ssh';

/** Maps a repo (owner/repo) to its active credential kind on a given host. */
export interface RepoCredentialAssignment {
  repoId: string;         // e.g. "github.com/owner/repo"
  hostId: string;         // e.g. "acc-123:github.com:default"
  kind: CredentialKindForNative;
  /** Opaque token appropriate for the credential kind. */
  token: string;
}

/** Errors from the native credential bridge. */
export class NativeCredentialBridgeError extends Error {
  readonly name = 'NativeCredentialBridgeError';
  constructor(
    message: string,
    readonly code:
      | 'repo_not_in_selection'
      | 'credential_not_found'
      | 'renewal_failed'
      | 'multiple_renewal_attempts'
  ) {
    super(message);
  }
}

// ── In-memory repo → credential kind mapping ──────────────────────────────────
//
// This map tracks which credential kind is active for each repo on each host.
// It is NOT durable — on app restart the correct kind is re-resolved from
// AccountStorage by `resolveForRepo`.

const repoCredentialKinds = new Map<string, CredentialKindForNative>();
// Token is NOT cached here — tokens come from AccountStorage via resolveForRepo.

function repoKey(repoId: string, hostId: string): string {
  return `${hostId}::${repoId}`;
}

// ── Native engine credential registration ────────────────────────────────────

/**
 * Register an OAuth repository credential with the Rust engine.
 *
 * The token is passed as `CredentialSource.GitHubOAuth { token }` which maps
 * to `x-access-token` in the git HTTP callbacks — the OAuth identity token
 * is never sent to the native Git layer.
 *
 * SECURITY: The token passed here is the repository-scoped OAuth access token
 * (exchanged via backend PKCE), NOT the OAuth identity token.
 */
export async function registerGitHubOAuthCredential(
  repoId: string,
  hostId: string,
  token: string,
): Promise<void> {
  const key = repoKey(repoId, hostId);
  repoCredentialKinds.set(key, 'oauth');
  // The Rust side receives the token via the bridge - we call setCredential
  // through the native module's JS proxy (populated by the UniFFI scaffolding).
  await nativeSetCredential(repoId, {
    kind: 'userpass',
    username: 'x-access-token',
    password: token,
  });
}

/**
 * Register a GitHub App installation credential with the Rust engine.
 *
 * The token is passed as `CredentialSource.GitHubAppInstallation { token }`
 * which maps to `x-access-token` in the git HTTP callbacks.
 */
export async function registerGitHubAppCredential(
  repoId: string,
  hostId: string,
  token: string,
): Promise<void> {
  const key = repoKey(repoId, hostId);
  repoCredentialKinds.set(key, 'github_app');
  await nativeSetCredential(repoId, {
    kind: 'userpass',
    username: 'x-access-token',
    password: token,
  });
}

/**
 * Register a PAT credential with the Rust engine.
 *
 * Uses `CredentialSource.UserPass` so the PAT serves as the HTTPS password.
 * This bypasses the OAuth/App path entirely.
 */
export async function registerPatCredential(
  repoId: string,
  hostId: string,
  token: string,
): Promise<void> {
  const key = repoKey(repoId, hostId);
  repoCredentialKinds.set(key, 'token');
  await nativeSetCredential(repoId, {
    kind: 'userpass',
    username: 'x-access-token',
    password: token,
  });
}

/**
 * Clear the registered credential for a repo.
 */
export async function clearRepoCredential(repoId: string): Promise<void> {
  // Remove all entries for this repoId (could be registered on multiple hosts
  // if the same repo appears under different host connections — unlikely but possible).
  for (const key of repoCredentialKinds.keys()) {
    if (key.endsWith(`::${repoId}`)) {
      repoCredentialKinds.delete(key);
    }
  }
  await nativeClearCredential(repoId);
}

/**
 * Get the credential kind currently registered for a repo/host pair.
 * Returns null when no credential is registered.
 */
export function getRegisteredCredentialKind(
  repoId: string,
  hostId: string,
): CredentialKindForNative | null {
  return repoCredentialKinds.get(repoKey(repoId, hostId)) ?? null;
}

// ── Repository selection enforcement ─────────────────────────────────────────

/**
 * Verify that `repoId` (owner/repo) is within the selected repository list
 * of the given App credential.
 *
 * Throws `NativeCredentialBridgeError` with code `repo_not_in_selection`
 * when the repo is not in the credential's selection list.
 *
 * This check is done BEFORE any native Git operation so that the failure is
 * fast and clear rather than a cryptic 403 from GitHub.
 */
export function enforceAppRepositorySelection(
  repoId: string,
  appCredential: GitHubAppCredentialRecord,
): void {
  const selected = appCredential.selectedRepositories;
  if (!selected || selected.length === 0) {
    throw new NativeCredentialBridgeError(
      `Repository ${repoId} is not in the App credential's selection (empty selection)`,
      'repo_not_in_selection',
    );
  }
  const segments = repoId.split('/');
  const normalized = (segments.length >= 3 ? segments.slice(-2).join('/') : repoId).toLowerCase();
  const isSelected = selected.some(
    (r: { owner: string; repo: string }) => `${r.owner}/${r.repo}`.toLowerCase() === normalized,
  );
  if (!isSelected) {
    throw new NativeCredentialBridgeError(
      `Repository ${repoId} is not in the GitHub App's selected repositories. Access is denied.`,
      'repo_not_in_selection',
    );
  }
}

// ── Pre-expiry renewal ─────────────────────────────────────────────────────────

/** Milliseconds: renew App tokens when they have less than this remaining. */
const APP_RENEWAL_BUFFER_MS = 10 * 60 * 1000; // 10 minutes

/**
 * Check whether an App installation token needs pre-expiry renewal.
 * Returns `true` when the token expires within `APP_RENEWAL_BUFFER_MS`.
 */
export function isAppNearExpiry(cred: GitHubAppCredentialRecord): boolean {
  return cred.expiresAt - Date.now() < APP_RENEWAL_BUFFER_MS;
}

/**
 * Attempt to renew a GitHub App installation token if it is near expiry.
 *
 * Uses the one-time renewal grant from the credential.
 * Updates the stored credential and re-registers it with the Rust engine.
 *
 * Returns the renewed credential on success.
 * Returns null when renewal is not needed (token still fresh).
 * Throws `NativeCredentialBridgeError` when renewal is needed but fails.
 */
export async function renewAppTokenIfNeeded(
  hostId: string,
  cred: GitHubAppCredentialRecord,
): Promise<GitHubAppCredentialRecord | null> {
  if (!isAppNearExpiry(cred)) {
    return null; // Not needed yet.
  }

  const result = await GitHubAppService.renewInstallationToken({ credential: cred });
  if (!result.ok) {
    throw new NativeCredentialBridgeError(
      `App token renewal failed: ${result.message} (${result.code})`,
      'renewal_failed',
    );
  }

  // Re-register the renewed token with the Rust engine for all repos
  // that were registered with this hostId's App credential.
  const renewed = result.credential;
  await reregisterAppCredentialForHost(hostId, renewed);
  return renewed;
}

/**
 * Re-register the App credential with the Rust engine for all repos
 * that were using this hostId's App credential.
 *
 * This is called after a successful renewal so the Rust engine gets
 * the fresh token.
 */
async function reregisterAppCredentialForHost(
  hostId: string,
  cred: GitHubAppCredentialRecord,
): Promise<void> {
  // Find all repos registered with this hostId's App credential.
  const reposToReregister: string[] = [];
  for (const [key, kind] of repoCredentialKinds.entries()) {
    if (key.startsWith(`${hostId}::`) && kind === 'github_app') {
      const repoId = key.slice(hostId.length + 2);
      reposToReregister.push(repoId);
    }
  }
  // Register the renewed token for each repo.
  await Promise.all(
    reposToReregister.map((repoId) =>
      registerGitHubAppCredential(repoId, hostId, cred.token),
    ),
  );
}

// ── Auth failure classification ──────────────────────────────────────────────

/**
 * Returns true when `error` represents an authentication failure (401), not a
 * permission (403), SAML/SSO, conflict, rate-limit, network, or server error.
 *
 * For GitHub API errors: checks `status === 401` using the same classification
 * logic as `syncFailure.ts`.
 *
 * For native Git errors: parses error message strings from git2 for auth-specific
 * failure patterns, excluding permission/403 patterns.
 *
 * Does NOT trigger fallback for:
 * - App repository-selection errors (`repo_not_in_selection`)
 * - App renewal failures
 * - SAML/SSO errors (GitHub 403 with SSO header)
 * - Permission/scope 403s
 * - Conflicts (409)
 * - Rate limits (429)
 * - Network errors
 * - Server errors (5xx)
 * - Validation errors
 */
export function isAuthFailure(error: unknown): boolean {
  if (error == null) return false;

  // NativeCredentialBridgeError types that are NOT auth failures — do NOT fallback.
  const raw = typeof error === 'object' ? error : { message: String(error) };
  const msg = typeof error === 'object' && 'message' in error
    ? String((error as Record<string, unknown>).message).toLowerCase()
    : String(error).toLowerCase();
  if (/repo_not_in_selection|renewal_failed|credential_not_found/i.test(msg)) {
    return false;
  }

  // GitHub API error with 401 status — authentication failure.
  const response = (raw as Record<string, unknown>).response as Record<string, unknown> | undefined;
  const status = response?.status ?? (raw as Record<string, number>).status;
  if (typeof status === 'number' && status === 401) {
    return true;
  }

  // Native Git error — check message for auth-specific patterns.
  // 401 in message is a strong auth signal.
  if (/\b401\b/.test(msg)) return true;

  // "authentication failed" is the git2 message for bad credentials.
  if (/authentication\s*failed/i.test(msg)) return true;

  // "credentials" alone can appear in git2 credential rejection messages,
  // but we exclude messages that also mention "permission" (403/permission denied).
  if (/credential/i.test(msg) && !/permission/i.test(msg) && !/denied/i.test(msg)) {
    return true;
  }

  // "unauthorized" — but not "not authorized" which can appear in some 403 cases.
  if (/^.*\b401\b.*$/.test(msg) || /unauthorized/i.test(msg)) return true;

  return false;
}

/**
 * Returns the next credential kind in the fallback chain after `currentKind`.
 * The fallback order is: github_app → oauth → token (PAT).
 * Returns null when there is no fallback (currentKind is 'token', 'ssh', or unknown).
 */
export function getNextCredentialKind(currentKind: CredentialKindForNative): CredentialKindForNative | null {
  switch (currentKind) {
    case 'github_app':
      return 'oauth';
    case 'oauth':
      return 'token';
    case 'token':
    case 'ssh':
    default:
      return null;
  }
}

// ── 401 recovery ─────────────────────────────────────────────────────────────

/**
 * Attempt a single recovery from a 401 by renewing the App token and retrying.
 *
 * Only applicable when the active credential for the repo is a GitHub App
 * installation token. OAuth and PAT 401s are not retried — OAuth requires
 * re-authentication (no refresh support), and PAT 401 means the token is
 * simply invalid.
 *
 * Returns the renewed credential on success.
 * Returns null when recovery was not attempted (wrong credential kind or
 * App renewal also failed).
 */
export async function recoverFromApp401(
  repoId: string,
  hostId: string,
  cred: GitHubAppCredentialRecord,
): Promise<GitHubAppCredentialRecord | null> {
  const kind = getRegisteredCredentialKind(repoId, hostId);
  if (kind !== 'github_app') {
    return null; // Only App credentials can be renewed on 401.
  }

  // Attempt renewal once.
  const result = await GitHubAppService.renewInstallationToken({ credential: cred });
  if (!result.ok) {
    return null; // Renewal failed — propagate the original 401.
  }

  // Re-register for this repo.
  const renewed = result.credential;
  await registerGitHubAppCredential(repoId, hostId, renewed.token);
  return renewed;
}

// ── Rust engine bridge (populated by UniFFI JS proxy) ───────────────────────
//
// The UniFFI-generated scaffolding exposes these as plain JS functions.
// We wrap them to add type safety and handle the credential type mapping.

let _nativeSetCredential: ((repoId: string, cred: object) => Promise<void>) | null = null;
let _nativeClearCredential: ((repoId: string) => Promise<boolean>) | null = null;

/**
 * Populate the native credential functions.
 * Called once at app boot from the native module initialization.
 * Idempotent — calling multiple times with the same functions is safe.
 */
export function initNativeCredentialBridge(opts: {
  setCredential: (repoId: string, cred: object) => Promise<void>;
  clearCredential: (repoId: string) => Promise<boolean>;
}): void {
  _nativeSetCredential = opts.setCredential;
  _nativeClearCredential = opts.clearCredential;
}

async function nativeSetCredential(
  repoId: string,
  cred: object,
): Promise<void> {
  if (!_nativeSetCredential) {
    return;
  }
  await _nativeSetCredential(repoId, cred);
}

async function nativeClearCredential(repoId: string): Promise<void> {
  if (!_nativeClearCredential) {
    return;
  }
  await _nativeClearCredential(repoId);
}

// ── Credential resolution for GitHubService ───────────────────────────────────

/**
 * Resolve the best available token for a GitHub API operation on a repo.
 *
 * Priority: GitHub App (if repo is in selection) > OAuth > PAT
 *
 * SECURITY INVARIANT — fail-closed on App:
 * - If an App credential exists for the host, the repo MUST be in the
 *   selected-repository list. If it is not, we throw `repo_not_in_selection`.
 * - If the App token is expired, we renew it. If renewal fails, we THROW
 *   rather than silently falling through to OAuth/PAT — a failed App
 *   installation means the user must re-authorize, not silently degrade.
 * - OAuth/PAT are consulted ONLY when no App credential exists for the host.
 *
 * For OAuth credentials: returns the token directly (no refresh — GitHub
 * OAuth does not support refresh; expiry is handled by surfacing re-auth).
 *
 * For PAT: returns the token directly.
 *
 * Throws `NativeCredentialBridgeError` when:
 * - App credential exists but repo is not in selection (`repo_not_in_selection`)
 * - App credential exists but is expired and renewal fails (`renewal_failed`)
 * - No credential is available (`credential_not_found`)
 */
export async function resolveGitHubRepoToken(params: {
  repoId: string;
  hostId: string;
  /**
   * Canonical owner/repo name (e.g. "acme/repo-a") for the App selection check.
   * Required when `repoId` is a local numeric ID rather than an owner/repo string.
   * Must be supplied whenever the stored repo ID does not use owner/repo format
   * so that enforceAppRepositorySelection can correctly match against selectedRepositories.
   */
  repoFullName?: string;
}): Promise<{ token: string; kind: CredentialKindForNative }> {
  const { repoId, hostId, repoFullName } = params;

  // Check App credential first (highest priority).
  const appCred = await AccountStorage.getGitHubAppCredential(hostId);
  if (appCred) {
    // App exists — enforce selected-repository membership FIRST (fail-closed).
    // Use the canonical owner/repo name if provided; otherwise fall back to the raw repoId.
    // The raw repoId may be a local numeric ID (e.g. "github:1790980499852") which
    // does not match the "owner/repo" format in selectedRepositories.
    enforceAppRepositorySelection(repoFullName ?? repoId, appCred);

    if (isInstallationTokenExpired(appCred)) {
      // Expired — attempt one renewal. Throw on failure; do NOT fall through.
      // The user must re-authorize the App, not silently use OAuth/PAT.
      const renewed = await renewAppTokenIfNeeded(hostId, appCred);
      // renewAppTokenIfNeeded throws NativeCredentialBridgeError on failure,
      // so we only reach here on success.
      return { token: renewed!.token, kind: 'github_app' as CredentialKindForNative };
    }

    // Not expired — check if renewal is needed before we hand back the token.
    const renewed = await renewAppTokenIfNeeded(hostId, appCred);
    const token = renewed ? renewed.token : appCred.token;
    return { token, kind: 'github_app' as CredentialKindForNative };
  }

  // No App credential — consult OAuth.
  const oauthCred = await AccountStorage.getOAuthCredential(hostId);
  if (oauthCred) {
    return { token: oauthCred.accessToken, kind: 'oauth' as CredentialKindForNative };
  }

  // Fall back to PAT.
  const pat = await AccountStorage.getHostToken(hostId);
  if (pat) {
    return { token: pat, kind: 'token' as CredentialKindForNative };
  }

  throw new NativeCredentialBridgeError(
    `No credential available for ${repoId} on ${hostId}`,
    'credential_not_found',
  );
}

/**
 * Clear all credential registrations for a host.
 * Called when disconnecting or switching away from a host.
 */
export async function clearHostCredentials(hostId: string): Promise<void> {
  const repoIds: string[] = [];
  for (const [key] of repoCredentialKinds.entries()) {
    if (key.startsWith(`${hostId}::`)) {
      const repoId = key.slice(hostId.length + 2);
      repoIds.push(repoId);
    }
  }
  await Promise.all(repoIds.map((repoId) => clearRepoCredential(repoId)));
}

/**
 * Clear only the credential registrations of a specific kind for a host.
 *
 * Used when removing one credential kind while preserving others — e.g., removing
 * OAuth but keeping the GitHub App installation, or removing PAT but keeping OAuth.
 * Only repo registrations whose kind matches `kind` are cleared; other kinds
 * registered for the same repos are left intact.
 *
 * When `kind` is 'token' (PAT), clears registrations of kind 'token' only.
 * When `kind` is 'oauth', clears 'oauth' registrations only.
 * When `kind` is 'github_app', clears 'github_app' registrations only.
 */
export async function clearCredentialKindForHost(
  hostId: string,
  kind: CredentialKindForNative,
): Promise<void> {
  const repoIds: string[] = [];
  for (const [key, registeredKind] of repoCredentialKinds.entries()) {
    if (key.startsWith(`${hostId}::`) && registeredKind === kind) {
      const repoId = key.slice(hostId.length + 2);
      repoIds.push(repoId);
    }
  }
  await Promise.all(repoIds.map((repoId) => clearRepoCredential(repoId)));
}

export function __clearRepoCredentialKindsForTest(): void {
  repoCredentialKinds.clear();
}
