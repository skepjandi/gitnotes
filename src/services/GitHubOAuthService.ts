/**
 * GitHub OAuth 2.0 PKCE service.
 *
 * Implements the browser-based PKCE flow:
 * 1. Generate a cryptographically random verifier and S256 challenge.
 * 2. Call backend `/api/v1/oauth/initiate` with the challenge.
 * 3. Open the returned authorization URL in the system browser.
 * 4. Handle the deep-link callback (`gitnotes://oauth/callback?code=…&state=…`).
 * 5. Call backend `/api/v1/oauth/exchange` with the code and verifier.
 * 6. Store the returned credential in AccountStorage.
 *
 * The backend contract is in `gitnotes-backend/src/auth/mod.rs`.
 *
 * Security invariants:
 * - PKCE verifier is generated fresh for every flow — never reused.
 * - The verifier is transmitted only to the backend (never to GitHub directly).
 * - Authorization codes, verifiers, and tokens are never logged.
 * - No client secret ever appears in the mobile codebase.
 */

import * as Crypto from 'expo-crypto';
import * as WebBrowser from 'expo-web-browser';
export { WebBrowser };

import type {
  GitHubOAuthCredentialRecord,
  OAuthErrorCode,
  GitHubOAuthAvailability,
} from './git/contracts';
import {
  validateOAuthCredential,
} from './git/contracts';
import { AccountStorage } from './AccountStorage';
import { generateId } from '../utils/ids';

// ── PKCE helpers ──────────────────────────────────────────────────────────────

/** Base64url encoding without padding (RFC 7636 §4). */
function base64urlEncode(buffer: ArrayBuffer): string {
  const bytes = new Uint8Array(buffer);
  let binary = '';
  for (const byte of bytes) {
    binary += String.fromCharCode(byte);
  }
  return btoa(binary).replace(/\+/g, '-').replace(/\//g, '_').replace(/=/g, '');
}

/**
 * Generate a PKCE code verifier.
 * Must be 43–128 characters from the unreserved URI character set.
 * We generate 64 chars of cryptographically secure random bytes (192 bits).
 */
export async function generatePkceVerifier(): Promise<string> {
  const randomBytes = await Crypto.getRandomBytesAsync(64);
  return base64urlEncode(randomBytes.buffer as ArrayBuffer);
}

/**
 * Generate the S256 PKCE challenge from a verifier.
 * Challenge = BASE64URL(SHA256(verifier))
 */
export async function generateS256Challenge(verifier: string): Promise<string> {
  const digest = await Crypto.digestStringAsync(
    Crypto.CryptoDigestAlgorithm.SHA256,
    verifier,
    { encoding: Crypto.CryptoEncoding.BASE64 },
  );
  // `digestStringAsync` with BASE64 returns standard Base64.
  // Convert to base64url (RFC 7636 §4):
  return digest.replace(/\+/g, '-').replace(/\//g, '_').replace(/=/g, '');
}

// ── Pending OAuth flow store ──────────────────────────────────────────────────

export interface PendingOAuthFlow {
  verifier: string;
  backendUrl: string;
  redirectUri: string;
  clientId: string;
  /** null means first-time OAuth: no existing host connection yet. */
  hostId: string | null;
}

/**
 * In-memory store of pending OAuth flows, keyed by the `state` parameter.
 * Entries are added by `initiate()` before opening the browser
 * and consumed by `exchangeCode()` when the deep link is received.
 * Entries expire after 10 minutes (matching the backend state TTL).
 */
export const pendingOAuthFlows = new Map<string, PendingOAuthFlow>();

// ── Deep-link callback result types ───────────────────────────────────────────

export type OAuthCallbackResult =
  | { outcome: 'success'; credential: GitHubOAuthCredentialRecord }
  | { outcome: 'cancelled' }
  | { outcome: 'denied'; code?: string; message?: string }
  | { outcome: 'duplicate' }
  | { outcome: 'malformed' }
  | { outcome: 'backend_error'; code: OAuthErrorCode; message: string };

export type OAuthInitiationResult =
  | { ok: true; authorizationUrl: string; state: string }
  | { ok: false; reason: 'backend_unreachable' | 'network_error' };

export type OAuthBrowserResult =
  | { outcome: 'callback'; url: string }
  | { outcome: 'cancelled' }
  | { outcome: 'failed' };

// ── Backend HTTP client ────────────────────────────────────────────────────────

const axiosInstance = (() => {
  const axios = require('axios').default;
  return axios.create({ timeout: 30_000 });
})();

// Mutable export so tests can replace with a mock: mod.httpClient = { post: mockPost, get: mockGet }
let httpClient = axiosInstance;
export { httpClient };
export const setHttpClient = (client: typeof httpClient) => { httpClient = client; };

function mapBackendError(code: string): OAuthErrorCode {
  switch (code) {
    case 'exchange_denied':
      return 'exchange_denied';
    case 'verifier_mismatch':
      return 'verifier_mismatch';
    case 'state_mismatch':
      return 'state_mismatch';
    case 'redirect_mismatch':
      return 'redirect_mismatch';
    case 'code_expired':
      return 'code_expired';
    case 'refresh_denied':
      return 'refresh_denied';
    case 'refresh_expired':
      return 'refresh_expired';
    case 'backend_unreachable':
      return 'backend_unreachable';
    case 'malformed_response':
      return 'malformed_response';
    case 'network_error':
      return 'network_error';
    default:
      return 'exchange_denied';
  }
}

// ── Backend URL resolution ───────────────────────────────────────────────────

// ── OAuthService ───────────────────────────────────────────────────────────────

export class GitHubOAuthService {
  /**
   * Initiate the OAuth flow by:
   * 1. Generating a fresh PKCE verifier and S256 challenge.
   * 2. Calling backend `POST /api/v1/oauth/initiate`.
   * 3. Returning the authorization URL for the browser.
   *
   * Returns `{ ok: true, authorizationUrl, state }` on success.
   * The `state` is echoed back by GitHub in the callback and verified by the backend.
   */
  /**
   * Initiate the OAuth flow.
   *
   * 1. Generates a fresh PKCE verifier and S256 challenge.
   * 2. Calls backend `POST /api/v1/oauth/initiate`.
   * 3. Stores the pending flow (verifier + params) in memory, keyed by `state`.
   * 4. Returns the authorization URL and state for the caller to open in the browser.
   *
   * Returns `{ ok: true, authorizationUrl, state }` on success.
   * The caller opens the browser, then handles the deep-link callback at
   * `gitnotes://oauth/callback?code=…&state=…` using `exchangeCode()`.
   */
  static async initiate(params: {
    backendUrl: string;
    redirectUri: string;
    clientId: string;
    hostId: string | null;
    scopes?: string[];
  }): Promise<OAuthInitiationResult> {
    const { backendUrl, redirectUri, clientId, hostId, scopes = ['read:user', 'repo'] } = params;

    const verifier = await generatePkceVerifier();
    const challenge = await generateS256Challenge(verifier);

    const state = generateId();

    try {
      const response = await httpClient.post(
        `${backendUrl}/api/v1/oauth/initiate`,
        {
          state,
          code_challenge: challenge,
          redirect_uri: redirectUri,
          scopes,
        },
        { headers: { 'Content-Type': 'application/json' } },
      );

      const data = response.data as {
        authorization_url: string;
        state: string;
      };

      if (data.state !== state) {
        console.warn('[GitHubOAuthService] State mismatch in initiate response');
        return { ok: false, reason: 'backend_unreachable' };
      }

      pendingOAuthFlows.set(state, { verifier, backendUrl, redirectUri, clientId, hostId });

      setTimeout(() => {
        pendingOAuthFlows.delete(state);
      }, 600_000);

      void clientId;

      return { ok: true, authorizationUrl: data.authorization_url, state };
    } catch (err) {
      const error = err as { response?: { status?: number }; message?: string };
      if (error.response?.status === 503) {
        return { ok: false, reason: 'backend_unreachable' };
      }
      console.warn('[GitHubOAuthService] initiate failed:', error.message);
      return { ok: false, reason: 'network_error' };
    }
  }

  /**
   * Open the GitHub authorization URL in an auth session.
   * The auth session returns the custom-scheme callback URL directly on success.
   */
  static async openAuthorizationUrl(
    authorizationUrl: string,
    redirectUrl: string,
  ): Promise<OAuthBrowserResult> {
    try {
      const result = await WebBrowser.openAuthSessionAsync(authorizationUrl, redirectUrl);
      if (result.type === 'success' && 'url' in result) {
        return { outcome: 'callback', url: result.url };
      }
      return { outcome: 'cancelled' };
    } catch (err) {
      console.warn('[GitHubOAuthService] openAuthSessionAsync failed:', err);
      return { outcome: 'failed' };
    }
  }

  /**
   * Exchange an authorization code (from the deep-link callback) for tokens.
   * Calls `POST /api/v1/oauth/exchange` with the code, verifier, and state.
   *
   * The returned credential is validated and stored via AccountStorage.
   *
   * Returns the outcome of the exchange attempt.
   */
  static async exchangeCode(params: {
    code: string;
    codeVerifier: string;
    state: string;
    redirectUri: string;
    clientId: string;
    backendUrl: string;
    hostId: string | null;
  }): Promise<OAuthCallbackResult> {
    const { code, codeVerifier, state, redirectUri, clientId, backendUrl, hostId } = params;

    try {
      const response = await httpClient.post(
        `${backendUrl}/api/v1/oauth/exchange`,
        {
          code,
          code_verifier: codeVerifier,
          state,
          redirect_uri: redirectUri,
          client_id: clientId,
        },
        { headers: { 'Content-Type': 'application/json' } },
      );

      const data = response.data as {
        login: string;
        user_id: number;
        avatar_url?: string | null;
        access_token: string;
        expires_at: number;
        refresh_token: string;
        refresh_expires_at: number;
      };

      let resolvedHostId: string;

      if (hostId === null) {
        const account = await AccountStorage.addAccount(null, {
          login: data.login,
          name: data.login,
          email: '',
          avatarUrl: data.avatar_url ?? '',
        });
        const host = await AccountStorage.upsertHostConnection({
          accountId: account.id,
          provider: 'github',
          instanceBaseUrl: null,
          hostLogin: data.login,
          hostUserId: data.user_id,
          name: data.login,
          email: null,
          avatarUrl: data.avatar_url ?? null,
        });
        const currentActiveHostId = await AccountStorage.getActiveHostId();
        if (!currentActiveHostId) {
          await AccountStorage.setActiveAccountId(account.id);
          await AccountStorage.setActiveHostId(host.id);
        }
        resolvedHostId = host.id;
      } else {
        resolvedHostId = hostId;
      }

      await AccountStorage.updateHostProfile(resolvedHostId, {
        name: data.login,
        hostLogin: data.login,
        email: null,
        avatarUrl: data.avatar_url ?? null,
      });

      const credential: GitHubOAuthCredentialRecord = {
        id: `${resolvedHostId}:oauth`,
        hostId: resolvedHostId,
        kind: 'oauth',
        addedAt: Date.now(),
        accessToken: data.access_token,
        login: data.login,
        userId: data.user_id,
        expiresAt: data.expires_at,
        renewal: {
          refreshToken: data.refresh_token,
          refreshExpiresAt: data.refresh_expires_at,
          backendUrl,
        },
      };

      const valid = validateOAuthCredential(credential);
      if (!valid.valid) {
        return { outcome: 'malformed' };
      }

      await AccountStorage.setOAuthCredential(resolvedHostId, credential);
      return { outcome: 'success', credential };
    } catch (err) {
      pendingOAuthFlows.delete(state);
      const error = err as {
        response?: { status?: number; data?: { code?: string; message?: string } };
        message?: string;
      };
      if (error.response?.status === 400 || error.response?.status === 422) {
        const code = error.response.data?.code ?? 'exchange_denied';
        const message = error.response.data?.message ?? '';
        return { outcome: 'backend_error', code: mapBackendError(code), message };
      }
      if (error.response?.status === 503) {
        return { outcome: 'backend_error', code: 'backend_unreachable', message: 'Backend service unavailable' };
      }
      if (error.response?.status === 500) {
        return { outcome: 'backend_error', code: 'backend_unreachable', message: 'Backend service unavailable' };
      }
      console.warn('[GitHubOAuthService] exchange failed:', error.message);
      return { outcome: 'backend_error', code: 'network_error', message: error.message ?? '' };
    }
  }

  /**
   * Refresh an expired OAuth access token.
   * For GitHub OAuth, this always returns `RefreshDenied` — the user must re-authenticate.
   */
  static async refreshAccessToken(params: {
    refreshToken: string;
    backendUrl: string;
  }): Promise<
    | { ok: true; accessToken: string; expiresAt: number; refreshToken: string; refreshExpiresAt: number }
    | { ok: false; code: OAuthErrorCode; message: string }
  > {
    const { refreshToken, backendUrl } = params;
    try {
      const response = await httpClient.post(
        `${backendUrl}/api/v1/oauth/refresh`,
        { refresh_token: refreshToken },
        { headers: { 'Content-Type': 'application/json' } },
      );

      const data = response.data as {
        access_token: string;
        expires_at: number;
        refresh_token: string;
        refresh_expires_at: number;
      };

      return {
        ok: true,
        accessToken: data.access_token,
        expiresAt: data.expires_at,
        refreshToken: data.refresh_token,
        refreshExpiresAt: data.refresh_expires_at,
      };
    } catch (err) {
      const error = err as {
        response?: { status?: number; data?: { code?: string; message?: string } };
        message?: string;
      };
      // GitHub OAuth does not support refresh — the backend always returns RefreshDenied.
      if (error.response?.status === 400 || error.response?.status === 422) {
        const code = error.response.data?.code ?? 'refresh_denied';
        return { ok: false, code: mapBackendError(code), message: error.response.data?.message ?? 'GitHub OAuth does not support token refresh — please re-authenticate.' };
      }
      return { ok: false, code: 'backend_unreachable', message: error.message ?? '' };
    }
  }

  /**
   * Revoke the OAuth token at GitHub via the backend.
   */
  static async revoke(params: {
    backendUrl: string;
  }): Promise<{ ok: true } | { ok: false; reason: 'backend_unreachable' }> {
    const { backendUrl } = params;
    try {
      await httpClient.post(
        `${backendUrl}/api/v1/oauth/revoke`,
        {},
        { headers: { 'Content-Type': 'application/json' } },
      );
      return { ok: true };
    } catch {
      return { ok: false, reason: 'backend_unreachable' };
    }
  }

  /**
   * Compute availability state for a host's OAuth credential.
   * Reads the stored credential and the backend reachability.
   */
  static async getAvailability(
    hostId: string,
  ): Promise<GitHubOAuthAvailability> {
    const cred = await AccountStorage.getOAuthCredential(hostId);
    if (!cred) {
      return { available: false, error: null, backendReachable: false };
    }

    const { isOAuthExpired, isRefreshExpired } = await import('./git/contracts');
    const tokenExpired = isOAuthExpired(cred);
    const refreshExpired = isRefreshExpired(cred);

    if (tokenExpired && refreshExpired) {
      return { available: false, error: 'refresh_expired', backendReachable: true };
    }
    if (tokenExpired) {
      // Token expired but refresh is still valid — caller should attempt refresh.
      return { available: false, error: 'exchange_denied', backendReachable: true };
    }

    // Check backend reachability with a lightweight call.
    let backendReachable = true;
    try {
      await httpClient.get(`${cred.renewal.backendUrl}/api/v1/health`, { timeout: 5_000 });
    } catch {
      backendReachable = false;
    }

    return { available: true, error: null, backendReachable };
  }
}

export default GitHubOAuthService;
