// ── Pending App flow store ────────────────────────────────────────────────────

export interface PendingAppFlow {
  selectedRepositoryIds: string[];
  selectedRepositories: string[];
  backendUrl: string;
  /** null means first-time App install: no existing host connection yet. */
  hostId: string | null;
}

/**
 * In-memory store of pending App installations, keyed by the JWS `state`.
 * Entries are added by `buildInstallUrl()` before opening the browser
 * and consumed by `handleCallback()` when the deep link is received.
 * Entries expire after 10 minutes (matching the backend state TTL).
 */
export const pendingAppFlows = new Map<string, PendingAppFlow>();

import * as WebBrowser from 'expo-web-browser';
export { WebBrowser };
import type {
  GitHubAppCredentialRecord,
  GitHubAppErrorCode,
  GitHubAppAvailability,
  SelectedRepository,
} from './git/contracts';
import { validateGitHubAppCredential, isInstallationTokenExpired } from './git/contracts';
import { AccountStorage } from './AccountStorage';

// ── Deep-link callback result types ───────────────────────────────────────────

export type AppCallbackResult =
  | { outcome: 'success'; credential: GitHubAppCredentialRecord }
  | { outcome: 'denied'; code?: string; message?: string }
  | { outcome: 'duplicate'; code?: string; message?: string }
  | { outcome: 'malformed'; code?: string; message?: string }
  | { outcome: 'wrong_app'; code?: string; message?: string }
  | { outcome: 'selection_mismatch'; code?: string; message?: string }
  | { outcome: 'owner_not_allowed'; message?: string }
  | { outcome: 'backend_error'; code: GitHubAppErrorCode; message: string };

const inFlightCallbacks = new Map<string, Promise<AppCallbackResult>>();
const completedCallbacks = new Map<string, { result: AppCallbackResult; expiresAt: number }>();
const CALLBACK_DEDUPE_TTL_MS = 30_000;

export type AppCallbackParsed = {
  installationId: string;
  state: string;
};

export type AppInitiationResult =
  | { ok: true; installationUrl: string; state: string }
  | { ok: false; reason: 'backend_unreachable' | 'network_error' | 'not_configured' | 'malformed_response' };

export type AppBrowserResult =
  | { outcome: 'callback'; url: string }
  | { outcome: 'cancelled' }
  | { outcome: 'failed' };

export type AppRenewalResult =
  | { ok: true; credential: GitHubAppCredentialRecord }
  | { ok: false; code: GitHubAppErrorCode; message: string };

// ── Backend HTTP client ───────────────────────────────────────────────────────

/** Axios instance for backend API calls — separate from the GitHub API client. */
export const backendHttp = (() => {
  const axios = require('axios').default;
  const instance = axios.create({ timeout: 30_000 });
  return instance;
})();

function mapAppError(code: string): GitHubAppErrorCode {
  switch (code) {
    case 'installation_denied':
      return 'installation_denied';
    case 'callback_denied':
      return 'callback_denied';
    case 'wrong_app':
      return 'wrong_app';
    case 'duplicate':
      return 'duplicate';
    case 'installation_inactive':
      return 'installation_inactive';
    case 'selection_empty':
      return 'selection_empty';
    case 'selection_mismatch':
      return 'selection_mismatch';
    case 'token_exchange_failed':
      return 'token_exchange_failed';
    case 'renewal_denied':
      return 'renewal_denied';
    case 'renewal_replayed':
      return 'renewal_replayed';
    case 'backend_unreachable':
      return 'backend_unreachable';
    case 'network_error':
      return 'network_error';
    case 'malformed_response':
      return 'malformed_response';
    case 'owner_not_allowed':
      return 'owner_not_allowed';
    default:
      return 'token_exchange_failed';
  }
}

// ── GitHubAppService ──────────────────────────────────────────────────────────

export class GitHubAppService {
  /**
   * Request a GitHub App installation URL from the backend.
   *
   * The backend generates a signed JWS containing the selected repository IDs
   * and returns the installation URL. The mobile app opens this URL in the browser.
   *
   * Returns `{ ok: true, installationUrl, state }` on success.
   */
  static async buildInstallUrl(params: {
    backendUrl: string;
    hostId: string | null;
    selectedRepositoryIds: string[];
    selectedRepositories?: SelectedRepository[];
  }): Promise<AppInitiationResult> {
    const { backendUrl, hostId, selectedRepositoryIds, selectedRepositories } = params;

    try {
      const response = await backendHttp.post(
        `${backendUrl}/api/v1/app/install-url`,
        { selected_repository_ids: selectedRepositoryIds.map((id) => Number(id)) },
        { headers: { 'Content-Type': 'application/json' } },
      );

      const data = response.data as {
        installation_url: string;
        state: string;
      };

      if (!data.installation_url || !data.state) {
        return { ok: false, reason: 'malformed_response' };
      }

      pendingAppFlows.set(data.state, {
        selectedRepositoryIds,
        selectedRepositories: selectedRepositories?.map((r) => `${r.owner}/${r.repo}`) ?? [],
        backendUrl,
        hostId,
      });

      setTimeout(() => {
        pendingAppFlows.delete(data.state);
      }, 600_000);

      return { ok: true, installationUrl: data.installation_url, state: data.state };
    } catch (err) {
      const error = err as {
        response?: { status?: number; data?: { code?: string } };
        message?: string;
      };
      if (error.response?.status === 503) {
        return { ok: false, reason: 'not_configured' };
      }
      if (error.response?.data?.code === 'backend_unreachable') {
        return { ok: false, reason: 'backend_unreachable' };
      }
      if (error.response?.status === 400 || error.response?.status === 422) {
        return { ok: false, reason: 'backend_unreachable' };
      }
      console.warn('[GitHubAppService] buildInstallUrl failed:', error.message);
      return { ok: false, reason: 'network_error' };
    }
  }

  /**
   * Open the GitHub App installation URL as an auth session so the custom-scheme
   * redirect is delivered back to the app instead of remaining in the browser.
   */
  static async openInstallationUrl(
    installationUrl: string,
    redirectUrl = 'gitnotes://app/callback',
  ): Promise<AppBrowserResult> {
    try {
      const result = await WebBrowser.openAuthSessionAsync(installationUrl, redirectUrl);
      if (result.type === 'success' && 'url' in result) {
        return { outcome: 'callback', url: result.url };
      }
      return { outcome: 'cancelled' };
    } catch (err) {
      console.warn('[GitHubAppService] openAuthSessionAsync failed:', err);
      return { outcome: 'failed' };
    }
  }

  /**
   * Parse a deep-link callback URL into its components.
   *
   * Supported URL forms:
   * - `gitnotes://app/callback?installation_id=123&state=abc`
   * - `gitnotes://app/denied`
   * - `gitnotes://app/duplicate`
   *
   * Returns the parsed components or null if the URL is not a valid callback URL.
   */
  static parseCallbackUrl(url: string): AppCallbackParsed | 'denied' | 'duplicate' | null {
    try {
      const parsed = new URL(url);
      const path = `${parsed.hostname}${parsed.pathname}`.replace(/^\//, '');

      if (path === 'app/denied') return 'denied';
      if (path === 'app/duplicate') return 'duplicate';

      if (path !== 'app/callback') return null;

      const installationId = parsed.searchParams.get('installation_id');
      const state = parsed.searchParams.get('state');

      if (!installationId || !state) return null;
      return { installationId, state };
    } catch {
      return null;
    }
  }

  /**
   * Exchange a GitHub App callback (installation_id + state) for an installation token.
   *
   * Calls `POST /api/v1/app/callback` with the installation_id, state, and selected_repository_ids.
   * The backend validates the JWS state, verifies the App ownership, and exchanges
   * the callback for a scoped installation token.
   *
   * Returns the outcome of the callback handling.
   */
  static async handleCallback(params: {
    installationId: string;
    state: string;
    pendingFlow?: PendingAppFlow;
  }): Promise<AppCallbackResult> {
    const cached = completedCallbacks.get(params.state);
    if (cached) {
      if (cached.expiresAt > Date.now()) return cached.result;
      completedCallbacks.delete(params.state);
    }

    const inFlight = inFlightCallbacks.get(params.state);
    if (inFlight) return inFlight;

    const callback = this.processCallback(params);
    inFlightCallbacks.set(params.state, callback);

    try {
      const result = await callback;
      completedCallbacks.set(params.state, {
        result,
        expiresAt: Date.now() + CALLBACK_DEDUPE_TTL_MS,
      });
      return result;
    } finally {
      inFlightCallbacks.delete(params.state);
    }
  }

  private static async processCallback(params: {
    installationId: string;
    state: string;
    pendingFlow?: PendingAppFlow;
  }): Promise<AppCallbackResult> {
    const { installationId, state, pendingFlow } = params;

    const pending = pendingFlow ?? pendingAppFlows.get(state);
    if (!pending) {
      return { outcome: 'malformed' };
    }
    pendingAppFlows.delete(state);
    const { selectedRepositoryIds, selectedRepositories, backendUrl, hostId } = pending;

    try {
      const response = await backendHttp.post(
        `${backendUrl}/api/v1/app/callback`,
        {
          installation_id: Number(installationId),
          state,
          selected_repository_ids: selectedRepositoryIds.map((id) => Number(id)),
        },
        { headers: { 'Content-Type': 'application/json' } },
      );

      const data = response.data as {
        installation_id: number;
        app_id: number;
        app_slug: string;
        account_login: string;
        account_id: number;
        account_avatar_url: string | null;
        token: string;
        expires_at: number;
          renewal_grant_token: string;
          renewal_grant_expires_at: number;
          repositories?: Array<{ owner: string; repo: string }>;
        };

      const credentialRepos: SelectedRepository[] = data.repositories?.length
        ? data.repositories.map(({ owner, repo }) => ({ owner, repo }))
        : selectedRepositories.map((fullName) => {
            const [owner, repo] = fullName.split('/');
            return { owner, repo };
          });

      let resolvedHostId: string;

      if (hostId === null) {
        // First-time App install: no existing host connection.
        // Create account + host connection from backend response.
        const accountAvatarUrl = data.account_avatar_url ?? null;
        const account = await AccountStorage.addAccount(data.token, {
          login: data.account_login,
          name: data.account_login,
          email: '',
          avatarUrl: accountAvatarUrl ?? '',
        });
        const host = await AccountStorage.upsertHostConnection({
          accountId: account.id,
          provider: 'github',
          instanceBaseUrl: null,
          hostLogin: data.account_login,
          hostUserId: data.account_id,
          name: data.account_login,
          email: null,
          avatarUrl: accountAvatarUrl,
          token: data.token,
        });
        await AccountStorage.clearHostToken(host.id);
        const currentActiveHostId = await AccountStorage.getActiveHostId();
        if (!currentActiveHostId) {
          await AccountStorage.setActiveAccountId(account.id);
          await AccountStorage.setActiveHostId(host.id);
        }
        resolvedHostId = host.id;
      } else {
        resolvedHostId = hostId;
      }

      const credential: GitHubAppCredentialRecord = {
        id: `${resolvedHostId}:github_app`,
        hostId: resolvedHostId,
        kind: 'github_app',
        addedAt: Date.now(),
        installationId: data.installation_id,
        appId: data.app_id,
        appSlug: data.app_slug,
        accountLogin: data.account_login,
        accountId: data.account_id,
        accountAvatarUrl: data.account_avatar_url ?? null,
        selectedRepositories: credentialRepos,
        token: data.token,
        expiresAt: data.expires_at,
        renewal: {
          grantToken: data.renewal_grant_token,
          grantExpiresAt: data.renewal_grant_expires_at,
          backendUrl,
        },
      };

      // Validate before storing.
      const valid = validateGitHubAppCredential(credential);
      if (!valid.valid) {
        return { outcome: 'malformed' };
      }

      await AccountStorage.setGitHubAppCredential(resolvedHostId, credential);
      return { outcome: 'success', credential };
    } catch (err) {
      const error = err as {
        response?: { status?: number; data?: { code?: string; message?: string } };
        message?: string;
      };
      if (error.response?.status === 400 || error.response?.status === 409) {
        const code = error.response.data?.code ?? 'callback_denied';
        const message = error.response.data?.message ?? '';
        const mapped = mapAppError(code) as string;
        if (mapped === 'wrong_app') return { outcome: 'wrong_app', code, message };
        if (mapped === 'selection_mismatch') return { outcome: 'selection_mismatch', code, message };
        if (mapped === 'duplicate') return { outcome: 'duplicate', code, message };
        if (mapped === 'denied' || mapped === 'installation_denied' || mapped === 'callback_denied') return { outcome: 'denied', code, message };
        return { outcome: 'malformed', code, message };
      }
      if (error.response?.status === 403) {
        return { outcome: 'owner_not_allowed' };
      }
      if (error.response?.status === 503) {
        return { outcome: 'backend_error', code: 'backend_unreachable', message: 'Backend service unavailable' };
      }
      if (error.response?.data?.code === 'backend_unreachable') {
        return {
          outcome: 'backend_error',
          code: 'backend_unreachable',
          message: error.response.data.message ?? 'Backend service unavailable',
        };
      }
      console.warn('[GitHubAppService] handleCallback failed:', error.message);
      return { outcome: 'backend_error', code: 'network_error', message: error.message ?? '' };
    }
  }

  /**
   * Renew an installation token before it expires.
   *
   * Uses the one-time renewal grant stored in the credential.
   * The backend checks JTI replay protection and issues a new token + grant.
   *
   * Returns the renewed credential or an error.
   */
  static async renewInstallationToken(params: {
    credential: GitHubAppCredentialRecord;
  }): Promise<AppRenewalResult> {
    const { credential } = params;

    try {
      // Generate a JTI for replay protection.
      const { generateId } = await import('../utils/ids');
      const jti = generateId();

      const response = await backendHttp.post(
        `${credential.renewal.backendUrl}/api/v1/app/renewal`,
        {
          installation_id: credential.installationId,
          renewal_grant_token: credential.renewal.grantToken,
          jti,
        },
        { headers: { 'Content-Type': 'application/json' } },
      );

      const data = response.data as {
        installation_id: number;
        app_id: number;
        app_slug: string;
        account_login: string;
        account_id: number;
        token: string;
        expires_at: number;
        renewal_grant_token: string;
        renewal_grant_expires_at: number;
      };

      const renewed: GitHubAppCredentialRecord = {
        ...credential,
        token: data.token,
        expiresAt: data.expires_at,
        renewal: {
          grantToken: data.renewal_grant_token,
          grantExpiresAt: data.renewal_grant_expires_at,
          backendUrl: credential.renewal.backendUrl,
        },
      };

      await AccountStorage.setGitHubAppCredential(credential.hostId, renewed);
      return { ok: true, credential: renewed };
    } catch (err) {
      const error = err as {
        response?: { status?: number; data?: { code?: string; message?: string } };
        message?: string;
      };
      if (error.response?.status === 400 || error.response?.status === 409) {
        const code = error.response.data?.code ?? 'renewal_denied';
        return { ok: false, code: mapAppError(code), message: error.response.data?.message ?? 'Renewal failed' };
      }
      if (error.response?.status === 409) {
        return { ok: false, code: 'renewal_replayed', message: 'Renewal request was already processed — please try again.' };
      }
      if (error.response?.status === 503) {
        return { ok: false, code: 'backend_unreachable', message: 'Backend service unavailable' };
      }
      console.warn('[GitHubAppService] renewInstallationToken failed:', error.message);
      return { ok: false, code: 'network_error', message: error.message ?? '' };
    }
  }

  /**
   * Disconnect (revoke) a GitHub App installation by deleting the stored credential.
   * Note: The backend handles revocation with GitHub; we just clean up the local credential.
   */
  static async disconnect(hostId: string): Promise<void> {
    await AccountStorage.deleteGitHubAppCredential(hostId);
  }

  /**
   * Compute availability state for a host's GitHub App credential.
   */
  static async getAvailability(
    hostId: string,
  ): Promise<GitHubAppAvailability> {
    const cred = await AccountStorage.getGitHubAppCredential(hostId);
    if (!cred) {
      return { available: false, error: null, backendReachable: false };
    }

    if (isInstallationTokenExpired(cred)) {
      return { available: false, error: 'installation_inactive', backendReachable: true };
    }

    // Check backend reachability.
    let backendReachable = true;
    try {
      await backendHttp.get(`${cred.renewal.backendUrl}/api/v1/health`, { timeout: 5_000 });
    } catch {
      backendReachable = false;
    }

    return { available: true, error: null, backendReachable };
  }
}

export default GitHubAppService;
