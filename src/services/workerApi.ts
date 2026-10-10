/**
 * GitNotēs Worker API client.
 *
 * Provides typed HTTP calls to the Cloudflare Worker backend at
 * https://worker.gitnotes.org/api/v1 (production) with local override support
 * via EXPO_PUBLIC_GITNOTES_BACKEND_URL.
 *
 * Error handling follows the Worker contract: non-2xx responses return
 * {@link WorkerApiError} with snake_case error codes.
 */

import {
  WORKER_BASE_URL,
  WORKER_BACKEND_URL_ENV,
  WorkerApiError,
  WorkerErrorResponseSchema,
  type WorkerErrorCode,
  type OAuthInitiateRequest,
  type OAuthInitiateResponse,
  type OAuthExchangeRequest,
  type OAuthExchangeResponse,
  type OAuthRefreshRequest,
  type OAuthRefreshResponse,
  type OAuthRevokeRequest,
  type OAuthRevokeResponse,
  type GitHubAppInstallUrlRequest,
  type GitHubAppInstallUrlResponse,
  type GitHubAppCallbackRequest,
  type GitHubAppInstallResponse,
  type GitHubAppRenewalRequest,
  type GitHubAppRenewalResponse,
  type HealthResponse,
  type ReferralCreateRequest,
  type ReferralCreateResponse,
  type ReferralCompleteRequest,
  type ReferralCompleteResponse,
  type ReferralStatusResponse,
  type ReferralIdentityProof,
  REFERRAL_AUTH_HEADER,
  REFERRAL_INSTALL_ID_HEADER,
} from "../types/worker";

/**
 * Get the configured backend URL.
 * Uses EXPO_PUBLIC_GITNOTES_BACKEND_URL if set, otherwise defaults to production URL.
 * Expo's build-time environment substitution allows this to be overridden per build.
 */
function getBackendUrl(): string {
  // Expo exposes public env vars on process.env
  const envUrl = process.env[WORKER_BACKEND_URL_ENV];
  return envUrl && envUrl.length > 0 ? envUrl : WORKER_BASE_URL;
}

/**
 * HTTP methods supported by the Worker API.
 */
type HttpMethod = "GET" | "POST" | "DELETE";

/**
 * Make a typed request to the Worker API.
 *
 * @param path - API path (e.g., "/oauth/initiate")
 * @param method - HTTP method
 * @param body - Request body (will be JSON-serialized)
 * @param signal - Optional AbortSignal for cancellation
 * @param extraHeaders - Optional additional headers (e.g., identity proof)
 * @returns Parsed response of type T
 * @throws WorkerApiError for non-2xx responses
 */
async function request<T>(
  path: string,
  method: HttpMethod,
  body?: unknown,
  signal?: AbortSignal,
  extraHeaders?: Record<string, string>
): Promise<T> {
  const url = `${getBackendUrl()}${path}`;
  const headers: Record<string, string> = {
    "Content-Type": "application/json",
    Accept: "application/json",
    ...extraHeaders,
  };

  const fetchOptions: RequestInit = {
    method,
    headers,
    signal,
  };

  if (body !== undefined && method !== "GET") {
    fetchOptions.body = JSON.stringify(body);
  }

  const response = await fetch(url, fetchOptions);

  if (!response.ok) {
    // Try to parse error envelope
    let errorMessage = `HTTP ${response.status}`;
    let errorCode: WorkerErrorCode = "backend_unreachable";

    try {
      const errorData = await response.json();
      const parsed = WorkerErrorResponseSchema.safeParse(errorData);
      if (parsed.success) {
        errorMessage = parsed.data.message;
        errorCode = parsed.data.code as WorkerErrorCode;
      }
    } catch {
      // Response wasn't JSON or parse failed - use status-based message
    }

    throw new WorkerApiError(errorCode, errorMessage, response.status);
  }

  // Handle empty responses
  const text = await response.text();
  if (text.length === 0) {
    return {} as T;
  }

  return JSON.parse(text) as T;
}

/**
 * Build identity headers for referral endpoints from a ReferralIdentityProof.
 *
 * For the GitHub branch: sends both the GitHub bearer token (verifiable identity)
 * AND the SecureStore installation ID (per-install rate-limit key).
 *
 * For the installation-only branch: sends only the installation ID header.
 * Tokens are NEVER sent in request bodies or query parameters.
 */
function buildReferralHeaders(identityProof: ReferralIdentityProof): Record<string, string> {
  if (identityProof.kind === "github") {
    return {
      [REFERRAL_AUTH_HEADER]: identityProof.token,
      [REFERRAL_INSTALL_ID_HEADER]: identityProof.installationId,
    };
  } else {
    return { [REFERRAL_INSTALL_ID_HEADER]: identityProof.installationId };
  }
}

/**
 * Worker API client providing typed access to backend endpoints.
 */
export const workerApi = {
  /**
   * Get the configured backend URL.
   * Useful for debugging and testing.
   */
  getBackendUrl,

  /**
   * Health check endpoint.
   */
  async health(signal?: AbortSignal): Promise<HealthResponse> {
    return request<HealthResponse>("/health", "GET", undefined, signal);
  },

  /**
   * OAuth endpoints.
   */
  oauth: {
    /**
     * Initiate OAuth flow - store PKCE state and return GitHub authorization URL.
     */
    async initiate(
      req: OAuthInitiateRequest,
      signal?: AbortSignal
    ): Promise<OAuthInitiateResponse> {
      return request<OAuthInitiateResponse>("/oauth/initiate", "POST", req, signal);
    },

    /**
     * Exchange authorization code for tokens.
     */
    async exchange(
      req: OAuthExchangeRequest,
      signal?: AbortSignal
    ): Promise<OAuthExchangeResponse> {
      return request<OAuthExchangeResponse>("/oauth/exchange", "POST", req, signal);
    },

    /**
     * Refresh an access token.
     * Note: GitHub OAuth does not support refresh - this always returns an error.
     */
    async refresh(
      req: OAuthRefreshRequest,
      signal?: AbortSignal
    ): Promise<OAuthRefreshResponse> {
      return request<OAuthRefreshResponse>("/oauth/refresh", "POST", req, signal);
    },

    /**
     * Revoke an access token.
     */
    async revoke(
      req: OAuthRevokeRequest,
      signal?: AbortSignal
    ): Promise<OAuthRevokeResponse> {
      return request<OAuthRevokeResponse>("/oauth/revoke", "POST", req, signal);
    },
  },

  /**
   * GitHub App endpoints.
   */
  app: {
    /**
     * Get the installation URL for GitHub App setup.
     */
    async getInstallUrl(
      req: GitHubAppInstallUrlRequest,
      signal?: AbortSignal
    ): Promise<GitHubAppInstallUrlResponse> {
      return request<GitHubAppInstallUrlResponse>("/app/install-url", "POST", req, signal);
    },

    /**
     * Handle the callback after user approves GitHub App installation.
     */
    async callback(
      req: GitHubAppCallbackRequest,
      signal?: AbortSignal
    ): Promise<GitHubAppInstallResponse> {
      return request<GitHubAppInstallResponse>("/app/callback", "POST", req, signal);
    },

    /**
     * Renew an installation token using a one-time grant.
     */
    async renew(
      req: GitHubAppRenewalRequest,
      signal?: AbortSignal
    ): Promise<GitHubAppRenewalResponse> {
      return request<GitHubAppRenewalResponse>("/app/renewal", "POST", req, signal);
    },
  },

  /**
   * Referral endpoints.
   */
  referrals: {
    /**
     * Create a new referral code.
     * @param _req - Empty request body (identity comes from header)
     * @param identityProof - GitHub token or installation ID
     * @param signal - Optional AbortSignal
     */
    async create(
      _req: ReferralCreateRequest,
      identityProof: ReferralIdentityProof,
      signal?: AbortSignal
    ): Promise<ReferralCreateResponse> {
      const headers = buildReferralHeaders(identityProof);
      return request<ReferralCreateResponse>("/referrals/create", "POST", _req, signal, headers);
    },

    /**
     * Complete a referral claim.
     * @param req - Must contain only `code` field
     * @param identityProof - GitHub token or installation ID
     * @param signal - Optional AbortSignal
     */
    async complete(
      req: ReferralCompleteRequest,
      identityProof: ReferralIdentityProof,
      signal?: AbortSignal
    ): Promise<ReferralCompleteResponse> {
      const headers = buildReferralHeaders(identityProof);
      return request<ReferralCompleteResponse>("/referrals/complete", "POST", req, signal, headers);
    },

    /**
     * Get referral status.
     * @param identityProof - GitHub token or installation ID
     * @param signal - Optional AbortSignal
     */
    async status(
      identityProof: ReferralIdentityProof,
      signal?: AbortSignal
    ): Promise<ReferralStatusResponse> {
      const headers = buildReferralHeaders(identityProof);
      return request<ReferralStatusResponse>("/referrals/status", "GET", undefined, signal, headers);
    },
  },
};

export default workerApi;
