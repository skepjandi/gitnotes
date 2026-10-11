/**
 * Types for the GitNotēs Worker API.
 * These types preserve the contract from the Cloudflare Worker implementation.
 *
 * Base URL: https://worker.gitnotes.org/api/v1
 * Error envelope: { code: string, message: string } with snake_case codes.
 */

import { z } from "zod";

// -----------------------------------------------------------------------------
// Configuration
// -----------------------------------------------------------------------------

/**
 * Production base URL for the Worker API.
 * Local overrides supported via EXPO_PUBLIC_GITNOTES_BACKEND_URL env var.
 *
 * The deployed Worker API is served at worker.gitnotes.org.
 */
export const WORKER_BASE_URL = "https://worker.gitnotes.org/api/v1";

/**
 * Environment variable name for backend URL override.
 * Supports Expo build-time environment substitution.
 */
export const WORKER_BACKEND_URL_ENV = "EXPO_PUBLIC_GITNOTES_BACKEND_URL";

/**
 * Environment variable name for GitHub OAuth client ID.
 * This is the public OAuth client ID - NOT a secret.
 */
export const GITHUB_OAUTH_CLIENT_ID_ENV = "EXPO_PUBLIC_GITHUB_OAUTH_CLIENT_ID";

// -----------------------------------------------------------------------------
// Error Envelope - matches Rust ApiErrorCode and ApiErrorResponse.
// The `code` field uses snake_case strings matching Rust enum variants.
// -----------------------------------------------------------------------------

/**
 * Stable error codes used in API responses.
 * Values match Rust/Worker ApiErrorCode enum variants exactly.
 */
export const WorkerErrorCode = {
  // Bootstrap errors (no Rust equivalent)
  INTERNAL_NOT_FOUND: "not_found",
  INTERNAL_MALFORMED_REQUEST: "malformed_request",
  INTERNAL_MISSING_FIELD: "missing_field",
  INTERNAL_INVALID_FIELD: "invalid_field",

  // OAuth errors
  EXCHANGE_DENIED: "exchange_denied",
  VERIFIER_MISMATCH: "verifier_mismatch",
  STATE_MISMATCH: "state_mismatch",
  REDIRECT_MISMATCH: "redirect_mismatch",
  CODE_EXPIRED: "code_expired",
  REFRESH_DENIED: "refresh_denied",
  REFRESH_EXPIRED: "refresh_expired",

  // GitHub errors
  BACKEND_UNREACHABLE: "backend_unreachable",
  MALFORMED_RESPONSE: "malformed_response",
  NETWORK_ERROR: "network_error",

  // GitHub App errors
  INSTALLATION_DENIED: "installation_denied",
  WRONG_APP: "wrong_app",
  INSTALLATION_INACTIVE: "installation_inactive",
  SELECTION_EMPTY: "selection_empty",
  SELECTION_MISMATCH: "selection_mismatch",
  RENEWAL_DENIED: "renewal_denied",
  RENEWAL_REPLAYED: "renewal_replayed",
  OWNER_NOT_ALLOWED: "owner_not_allowed",

  // Configuration
  CONFIGURATION_MISSING: "configuration_missing",

  // Referral: rate limit exceeded
  RATE_LIMIT_EXCEEDED: "rate_limit_exceeded",

  // Referral: code not found
  CODE_NOT_FOUND: "code_not_found",

  // Referral: code already used by this recipient
  CODE_ALREADY_USED: "code_already_used",

  // Referral: identity proof required
  IDENTITY_REQUIRED: "identity_required",

  // Referral: identity mismatch (self-referral or replay)
  IDENTITY_MISMATCH: "identity_mismatch",

  // Referral: self-referral not allowed
  SELF_REFERRAL_NOT_ALLOWED: "self_referral_not_allowed",

  // Referral: invalid milestone requested
  INVALID_MILESTONE: "invalid_milestone",

  // Referral: milestone already unlocked
  MILESTONE_ALREADY_UNLOCKED: "milestone_already_unlocked",

  // Referral: code expired (dedicated alias)
  REFERRAL_CODE_EXPIRED: "code_expired",
} as const;

// eslint-disable-next-line no-redeclare
export type WorkerErrorCode = (typeof WorkerErrorCode)[keyof typeof WorkerErrorCode];

/**
 * Error response body matching Rust ApiErrorResponse.
 * Never leaks internal details, stack traces, or secrets.
 */
export interface WorkerErrorResponse {
  readonly code: WorkerErrorCode;
  readonly message: string;
}

/**
 * Zod schema for validating error responses.
 */
export const WorkerErrorResponseSchema = z.object({
  code: z.string(),
  message: z.string(),
});

// -----------------------------------------------------------------------------
// OAuth Types
// -----------------------------------------------------------------------------

/**
 * OAuth callback URLs used by the mobile app.
 * These are fixed deep-link URLs registered in the app.
 */
export const OAUTH_CALLBACK_URL = "gitnotes://oauth/callback";

/**
 * App callback URL used by the mobile app.
 * This is a fixed deep-link URL registered in the app.
 */
export const APP_CALLBACK_URL = "gitnotes://app/callback";

/**
 * Request to initiate OAuth flow - store PKCE state, return GitHub auth URL.
 */
export interface OAuthInitiateRequest {
  state: string;
  code_challenge: string;
  redirect_uri: string;
  scopes?: string[];
}

/**
 * Response from OAuth initiation - contains the GitHub authorization URL.
 */
export interface OAuthInitiateResponse {
  authorization_url: string;
  state: string;
}

/**
 * Request to exchange authorization code for tokens.
 */
export interface OAuthExchangeRequest {
  code: string;
  code_verifier: string;
  state: string;
  redirect_uri: string;
  client_id: string;
}

/**
 * Response from successful OAuth code exchange.
 */
export interface OAuthExchangeResponse {
  login: string;
  user_id: number;
  access_token: string;
  expires_at: number;
  refresh_token: string;
  refresh_expires_at: number;
}

/**
 * Request to refresh an OAuth access token.
 * Note: GitHub OAuth does not support refresh - this always returns RefreshDenied.
 */
export interface OAuthRefreshRequest {
  refresh_token: string;
}

/**
 * Response from token refresh.
 */
export interface OAuthRefreshResponse {
  access_token: string;
  expires_at: number;
  refresh_token: string;
  refresh_expires_at: number;
}

/**
 * Request to revoke an access token.
 */
export interface OAuthRevokeRequest {
  access_token: string;
}

/**
 * Response from token revocation.
 */
export interface OAuthRevokeResponse {
  revoked: boolean;
}

// -----------------------------------------------------------------------------
// GitHub App Types
// -----------------------------------------------------------------------------

/**
 * Request to generate GitHub App installation URL with signed JWS state.
 */
export interface GitHubAppInstallUrlRequest {
  selected_repository_ids?: number[];
}

/**
 * Response with installation URL and state for CSRF protection.
 */
export interface GitHubAppInstallUrlResponse {
  installation_url: string;
  state: string;
}

/**
 * Request after user approves GitHub App installation.
 */
export interface GitHubAppCallbackRequest {
  installation_id: number;
  state: string;
  selected_repository_ids?: number[];
}

/**
 * Response from successful GitHub App installation token exchange.
 */
export interface GitHubAppInstallResponse {
  installation_id: number;
  app_id: number;
  app_slug: string;
  account_login: string;
  account_id: number;
  token: string;
  expires_at: number;
  renewal_grant_token: string;
  renewal_grant_expires_at: number;
  repositories: Array<{ owner: string; repo: string }>;
}

/**
 * Request to renew an installation token.
 */
export interface GitHubAppRenewalRequest {
  installation_id: number;
  renewal_grant_token: string;
  jti: string;
}

/**
 * Response from successful installation token renewal.
 */
export type GitHubAppRenewalResponse = GitHubAppInstallResponse;

// -----------------------------------------------------------------------------
// Health Check
// -----------------------------------------------------------------------------

/**
 * Health check response.
 */
export interface HealthResponse {
  status: "ok";
  version: string;
}

// -----------------------------------------------------------------------------
// Referral Types
// -----------------------------------------------------------------------------

// Identity proof header constants - match Worker exactly
export const REFERRAL_AUTH_HEADER = "X-Referral-Token";
export const REFERRAL_INSTALL_ID_HEADER = "X-Referral-Install-ID";

/**
 * Identity proof for referral endpoints.
 * Exactly one field must be provided - discriminated by `kind`.
 *
 * `github` - GitHub OAuth bearer token; Worker verifies against GitHub /user API.
 *            Also carries the SecureStore installation ID so the backend can
 *            apply per-install rate limits independently of GitHub identity.
 * `installation` - SecureStore random UUID; reinstall-abuse limited fallback.
 *                   Used when no verifiable GitHub OAuth token is available.
 */
export type ReferralIdentityProof =
  | { kind: "github"; token: string; installationId: string }
  | { kind: "installation"; installationId: string };

export const REFERRAL_MILESTONES = [1, 3, 5, 10, 15, 20] as const;
export type ReferralMilestone = (typeof REFERRAL_MILESTONES)[number];

export type ReferralRewardType = "theme" | "icon";

export interface ReferralRewardCatalogEntry {
  milestone: ReferralMilestone;
  name: string;
  reward_type: ReferralRewardType;
  reward_key: string;
}

export const REFERRAL_REWARD_CATALOG: readonly ReferralRewardCatalogEntry[] = [
  { milestone: 1, name: "Terminal Mono", reward_type: "icon", reward_key: "terminal-mono-icon" },
  { milestone: 3, name: "Terminal Mono", reward_type: "theme", reward_key: "terminal-mono-theme" },
  { milestone: 5, name: "Amber Terminal", reward_type: "icon", reward_key: "amber-terminal-icon" },
  { milestone: 10, name: "CRT Green", reward_type: "theme", reward_key: "crt-green-theme" },
  { milestone: 15, name: "Monochrome Grid", reward_type: "icon", reward_key: "monochrome-grid-icon" },
  { milestone: 20, name: "Developer Desk", reward_type: "theme", reward_key: "developer-desk-theme" },
] as const;

export type ReferralCreateRequest = Record<string, never>;

export const ReferralCreateRequestSchema = z.strictObject({});

export interface ReferralCreateResponse {
  code: string;
  share_url: string;
  expires_at: number;
}

export const ReferralCreateResponseSchema = z.object({
  code: z.string().min(1),
  share_url: z.url(),
  expires_at: z.number().int().positive(),
});

export interface ReferralCompleteRequest {
  code: string;
}

export const ReferralCompleteRequestSchema = z.strictObject({
  code: z.string().min(1),
});

export interface ReferralCompleteResponse {
  accepted: boolean;
}

export const ReferralCompleteResponseSchema = z.strictObject({
  accepted: z.boolean(),
});

export interface ReferralMilestoneInfo {
  milestone: ReferralMilestone;
  name: string;
  reward_type: ReferralRewardType;
  reward_key: string;
  unlocked: boolean;
}

export interface ReferralStatusResponse {
  has_pending_code: boolean;
  pending_code: string | null;
  pending_expires_at: number | null;
  progress: number;
  catalog_version: number;
  unlocked_milestones: ReadonlyArray<ReferralMilestone>;
  milestones: ReadonlyArray<ReferralMilestoneInfo>;
}

export const ReferralStatusResponseSchema = z.object({
  has_pending_code: z.boolean(),
  pending_code: z.string().nullable(),
  pending_expires_at: z.number().int().nullable(),
  progress: z.number().int().nonnegative(),
  catalog_version: z.number().int().positive(),
  unlocked_milestones: z.array(z.union([z.literal(1), z.literal(3), z.literal(5), z.literal(10), z.literal(15), z.literal(20)])).readonly(),
  milestones: z.array(z.object({
    milestone: z.union([z.literal(1), z.literal(3), z.literal(5), z.literal(10), z.literal(15), z.literal(20)]),
    name: z.string(),
    reward_type: z.enum(["theme", "icon"]),
    reward_key: z.string(),
    unlocked: z.boolean(),
  })).readonly(),
});

export const REFERRAL_LINK_BASE = "https://gitnotes.org/r/";

// -----------------------------------------------------------------------------
// Error Classes
// -----------------------------------------------------------------------------

/**
 * Error thrown when the Worker API returns a non-2xx response.
 */
export class WorkerApiError extends Error {
  constructor(
    public readonly code: WorkerErrorCode,
    message: string,
    public readonly statusCode: number
  ) {
    super(message);
    this.name = "WorkerApiError";
  }
}

/**
 * Attempt to parse a response as a WorkerErrorResponse.
 */
export function parseWorkerError(response: unknown): WorkerApiError | null {
  const parsed = WorkerErrorResponseSchema.safeParse(response);
  if (!parsed.success) return null;
  const { code, message } = parsed.data;
  return new WorkerApiError(code as WorkerErrorCode, message, 0);
}
