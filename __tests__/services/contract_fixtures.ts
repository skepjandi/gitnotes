/**
 * Contract fixtures for the GitNotēs Worker API.
 *
 * These fixtures define the stable contract between the Cloudflare Worker backend
 * and mobile clients. They are derived from the merged Rust source and verified
 * by contract tests.
 *
 * All field names use snake_case matching the Rust serdeSerialize field names.
 * All timestamp fields are Unix milliseconds (i64 in Rust).
 * All error codes are snake_case strings matching Rust ApiErrorCode variants.
 */

import type {
  OAuthInitiateResponse,
  OAuthExchangeResponse,
  OAuthRefreshResponse,
  OAuthRevokeResponse,
  GitHubAppInstallUrlResponse,
  GitHubAppInstallResponse,
  GitHubAppRenewalResponse,
  HealthResponse,
  WorkerErrorResponse,
} from "../src/types/worker";

// ── Health ─────────────────────────────────────────────────────────────────

export const HEALTH_RESPONSE_FIXTURE: HealthResponse = {
  status: "ok",
  version: "0.1.0",
};

// ── OAuth ──────────────────────────────────────────────────────────────────

export const OAUTH_INITIATE_RESPONSE_FIXTURE: OAuthInitiateResponse = {
  authorization_url: "https://github.com/login/oauth/authorize?client_id=test&redirect_uri=gitnotes://oauth/callback&scope=read:user&state=test-state",
  state: "test-state",
};

export const OAUTH_EXCHANGE_RESPONSE_FIXTURE: OAuthExchangeResponse = {
  login: "testuser",
  user_id: 12345,
  access_token: "gho_test_token",
  expires_at: Date.now() + 3600000, // 1 hour from now (Unix ms)
  refresh_token: "refresh_test_token",
  refresh_expires_at: Date.now() + 86400000 * 30, // 30 days from now (Unix ms)
};

export const OAUTH_REFRESH_RESPONSE_FIXTURE: OAuthRefreshResponse = {
  access_token: "gho_refreshed_token",
  expires_at: Date.now() + 3600000,
  refresh_token: "refreshed_token",
  refresh_expires_at: Date.now() + 86400000 * 30,
};

export const OAUTH_REVOKE_RESPONSE_FIXTURE: OAuthRevokeResponse = {
  revoked: true,
};

// ── GitHub App ─────────────────────────────────────────────────────────────

export const GITHUB_APP_INSTALL_URL_RESPONSE_FIXTURE: GitHubAppInstallUrlResponse = {
  installation_url: "https://github.com/apps/test-app/installations/new",
  state: "jws-signed-state",
};

export const GITHUB_APP_INSTALL_RESPONSE_FIXTURE: GitHubAppInstallResponse = {
  installation_id: 123456,
  app_id: 98765,
  app_slug: "test-app",
  account_login: "testuser",
  account_id: 54321,
  account_avatar_url: "https://avatars.githubusercontent.com/u/54321?v=4",
  token: "ghs_install_token",
  expires_at: Date.now() + 3600000, // 1 hour from now (Unix ms)
  renewal_grant_token: "grant_token",
  renewal_grant_expires_at: Date.now() + 86400000, // 1 day from now (Unix ms)
  repositories: [{ owner: "testuser", repo: "repo1" }],
};

export const GITHUB_APP_RENEWAL_RESPONSE_FIXTURE: GitHubAppRenewalResponse = {
  installation_id: 123456,
  app_id: 98765,
  app_slug: "test-app",
  account_login: "testuser",
  account_id: 54321,
  account_avatar_url: "https://avatars.githubusercontent.com/u/54321?v=4",
  token: "ghs_renewed_token",
  expires_at: Date.now() + 3600000,
  renewal_grant_token: "new_grant_token",
  renewal_grant_expires_at: Date.now() + 86400000,
  repositories: [{ owner: "testuser", repo: "repo1" }],
};

// ── Error Codes ─────────────────────────────────────────────────────────────

/**
 * All stable error codes that can appear in API responses.
 * Values match Rust/Worker ApiErrorCode variants exactly (snake_case strings).
 */
export const STABLE_ERROR_CODES = [
  // Bootstrap errors (Worker-specific, not in Rust)
  "not_found",
  "malformed_request",
  "missing_field",
  "invalid_field",
  // OAuth errors
  "exchange_denied",
  "verifier_mismatch",
  "state_mismatch",
  "redirect_mismatch",
  "code_expired",
  "refresh_denied",
  "refresh_expired",
  // GitHub errors
  "backend_unreachable",
  "malformed_response",
  "network_error",
  // GitHub App errors
  "installation_denied",
  "wrong_app",
  "installation_inactive",
  "selection_empty",
  "selection_mismatch",
  "renewal_denied",
  "renewal_replayed",
  "owner_not_allowed",
  // Configuration
  "configuration_missing",
] as const;

/**
 * Error response fixture factory.
 */
export function createErrorResponse(
  code: (typeof STABLE_ERROR_CODES)[number],
  message: string
): WorkerErrorResponse {
  return { code, message };
}

// ── Contract Field Names ────────────────────────────────────────────────────

/**
 * OAuth response field names - verified against Rust OAuthExchangeResponse.
 */
export const OAUTH_EXCHANGE_RESPONSE_FIELDS = [
  "login",
  "user_id",
  "access_token",
  "expires_at",
  "refresh_token",
  "refresh_expires_at",
] as const;

/**
 * GitHub App response field names returned by the Worker.
 */
export const GITHUB_APP_INSTALL_RESPONSE_FIELDS = [
  "installation_id",
  "app_id",
  "app_slug",
  "account_login",
  "account_id",
  "account_avatar_url",
  "token",
  "expires_at",
  "renewal_grant_token",
  "renewal_grant_expires_at",
  "repositories",
] as const;

/**
 * Timestamp fields that must be Unix milliseconds.
 * GitHub API returns ISO 8601 strings; Worker converts to Unix ms.
 */
export const TIMESTAMP_FIELDS = [
  "expires_at",
  "refresh_expires_at",
  "renewal_grant_expires_at",
] as const;

// ── Deep Link URLs ───────────────────────────────────────────────────────────

export const OAUTH_CALLBACK_URL = "gitnotes://oauth/callback";
export const APP_CALLBACK_URL = "gitnotes://app/callback";

/**
 * App setup redirect base - query params are appended by the Worker.
 */
export const APP_SETUP_REDIRECT_BASE = "gitnotes://app/callback";
