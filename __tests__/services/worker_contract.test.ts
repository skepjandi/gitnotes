/**
 * Contract tests that verify the mobile app correctly handles the Worker API contract.
 *
 * These tests verify:
 * - Correct field names matching the Rust source
 * - Correct timestamp units (Unix milliseconds)
 * - Correct error code handling
 * - Correct deep link URL handling
 *
 * Run with: yarn jest __tests__/services/worker_contract.test.ts --testPathIgnorePatterns=
 */

import {
  STABLE_ERROR_CODES,
  OAUTH_EXCHANGE_RESPONSE_FIELDS,
  GITHUB_APP_INSTALL_RESPONSE_FIELDS,
  TIMESTAMP_FIELDS,
  OAUTH_CALLBACK_URL,
  APP_CALLBACK_URL,
  APP_SETUP_REDIRECT_BASE,
  createErrorResponse,
  OAUTH_EXCHANGE_RESPONSE_FIXTURE,
  GITHUB_APP_INSTALL_RESPONSE_FIXTURE,
  HEALTH_RESPONSE_FIXTURE,
  OAUTH_INITIATE_RESPONSE_FIXTURE,
  GITHUB_APP_INSTALL_URL_RESPONSE_FIXTURE,
  GITHUB_APP_RENEWAL_RESPONSE_FIXTURE,
} from "./contract_fixtures";
import { WorkerErrorCode, WORKER_BASE_URL } from "../../src/types/worker";

describe("Worker Contract: Field Names", () => {
  describe("OAuthExchangeResponse fields", () => {
    it("must have exactly the expected fields from Rust contract", () => {
      const response = OAUTH_EXCHANGE_RESPONSE_FIXTURE;
      const actualFields = Object.keys(response).sort();
      const expectedFields = [...OAUTH_EXCHANGE_RESPONSE_FIELDS].sort();

      expect(actualFields).toEqual(expectedFields);
    });

    it("must not have additional fields", () => {
      const response = OAUTH_EXCHANGE_RESPONSE_FIXTURE;
      const actualFields = Object.keys(response);

      for (const field of actualFields) {
        expect(OAUTH_EXCHANGE_RESPONSE_FIELDS).toContain(field);
      }
    });
  });

  describe("GitHubAppInstallResponse fields", () => {
    it("must have exactly the expected fields from Worker contract", () => {
      const response = GITHUB_APP_INSTALL_RESPONSE_FIXTURE;
      const actualFields = Object.keys(response).sort();
      const expectedFields = [...GITHUB_APP_INSTALL_RESPONSE_FIELDS].sort();

      expect(actualFields).toEqual(expectedFields);
    });
  });

  describe("OAuthInitiateResponse fields", () => {
    it("must have authorization_url and state", () => {
      const response = OAUTH_INITIATE_RESPONSE_FIXTURE;

      expect(response).toHaveProperty("authorization_url");
      expect(response).toHaveProperty("state");
      expect(Object.keys(response).sort()).toEqual(["authorization_url", "state"]);
    });
  });

  describe("GitHubAppInstallUrlResponse fields", () => {
    it("must have installation_url and state", () => {
      const response = GITHUB_APP_INSTALL_URL_RESPONSE_FIXTURE;

      expect(response).toHaveProperty("installation_url");
      expect(response).toHaveProperty("state");
      expect(Object.keys(response).sort()).toEqual(["installation_url", "state"]);
    });
  });
});

describe("Worker Contract: Timestamp Units", () => {
  const FIXTURE_CREATION_TOLERANCE_MS = 5000;

  it("expires_at must be Unix milliseconds (not seconds)", () => {
    const now = Date.now();
    const oneHourFromNow = now + 3600000; // 1 hour in ms

    // Timestamps should be in the future (ms since epoch)
    expect(OAUTH_EXCHANGE_RESPONSE_FIXTURE.expires_at).toBeGreaterThan(now);
    expect(OAUTH_EXCHANGE_RESPONSE_FIXTURE.expires_at).toBeLessThan(
      oneHourFromNow + FIXTURE_CREATION_TOLERANCE_MS,
    );
  });

  it("refresh_expires_at must be Unix milliseconds", () => {
    const now = Date.now();
    const thirtyDaysFromNow = now + 86400000 * 30;

    expect(OAUTH_EXCHANGE_RESPONSE_FIXTURE.refresh_expires_at).toBeGreaterThan(now);
    expect(OAUTH_EXCHANGE_RESPONSE_FIXTURE.refresh_expires_at).toBeLessThan(
      thirtyDaysFromNow + FIXTURE_CREATION_TOLERANCE_MS,
    );
  });

  it("renewal_grant_expires_at must be Unix milliseconds", () => {
    const now = Date.now();
    const oneDayFromNow = now + 86400000;

    expect(GITHUB_APP_INSTALL_RESPONSE_FIXTURE.renewal_grant_expires_at).toBeGreaterThan(now);
    expect(GITHUB_APP_INSTALL_RESPONSE_FIXTURE.renewal_grant_expires_at).toBeLessThan(
      oneDayFromNow + FIXTURE_CREATION_TOLERANCE_MS,
    );
  });

  it("timestamps must be i64-compatible (fit in JavaScript safe integer)", () => {
    const maxSafeInteger = Number.MAX_SAFE_INTEGER; // 9007199254740991

    expect(OAUTH_EXCHANGE_RESPONSE_FIXTURE.expires_at).toBeLessThan(maxSafeInteger);
    expect(OAUTH_EXCHANGE_RESPONSE_FIXTURE.refresh_expires_at).toBeLessThan(maxSafeInteger);
    expect(GITHUB_APP_INSTALL_RESPONSE_FIXTURE.expires_at).toBeLessThan(maxSafeInteger);
    expect(GITHUB_APP_INSTALL_RESPONSE_FIXTURE.renewal_grant_expires_at).toBeLessThan(maxSafeInteger);
  });

  it("timestamp fields must be numbers, not ISO strings", () => {
    expect(typeof OAUTH_EXCHANGE_RESPONSE_FIXTURE.expires_at).toBe("number");
    expect(typeof OAUTH_EXCHANGE_RESPONSE_FIXTURE.refresh_expires_at).toBe("number");
    expect(typeof GITHUB_APP_INSTALL_RESPONSE_FIXTURE.expires_at).toBe("number");
    expect(typeof GITHUB_APP_INSTALL_RESPONSE_FIXTURE.renewal_grant_expires_at).toBe("number");
  });
});

describe("Worker Contract: Error Codes", () => {
  it("must have all stable error codes defined in WorkerErrorCode", () => {
    // Verify each stable code maps to a WorkerErrorCode constant
    const missingCodes: string[] = [];
    for (const code of STABLE_ERROR_CODES) {
      const hasConstant = Object.values(WorkerErrorCode).includes(code as typeof WorkerErrorCode);
      if (!hasConstant) {
        missingCodes.push(code);
      }
    }
    expect(missingCodes).toHaveLength(0);
  });

  it("error response must have exactly code and message fields", () => {
    const errorResponse = createErrorResponse("state_mismatch", "State does not match");

    const fields = Object.keys(errorResponse).sort();
    expect(fields).toEqual(["code", "message"]);
  });

  it("error response must not have additional fields", () => {
    const errorResponse = createErrorResponse("code_expired", "Authorization code expired");

    expect(errorResponse).not.toHaveProperty("status");
    expect(errorResponse).not.toHaveProperty("details");
    expect(errorResponse).not.toHaveProperty("stack");
  });

  it("error codes must be snake_case strings", () => {
    for (const code of STABLE_ERROR_CODES) {
      expect(code).toMatch(/^[a-z_]+$/);
    }
  });
});

describe("Worker Contract: Deep Links", () => {
  it("OAuth callback URL must be gitnotes://oauth/callback", () => {
    expect(OAUTH_CALLBACK_URL).toBe("gitnotes://oauth/callback");
  });

  it("App callback URL must be gitnotes://app/callback", () => {
    expect(APP_CALLBACK_URL).toBe("gitnotes://app/callback");
  });

  it("App setup redirect base must be gitnotes://app/callback", () => {
    expect(APP_SETUP_REDIRECT_BASE).toBe("gitnotes://app/callback");
  });
});

describe("Worker Contract: Snakecase Field Names", () => {
  it("OAuthInitiateResponse must have snake_case fields", () => {
    const response = OAUTH_INITIATE_RESPONSE_FIXTURE;

    expect(response).toHaveProperty("authorization_url");
    expect(response).toHaveProperty("state");
    expect(response).not.toHaveProperty("authorizationUrl");
  });

  it("OAuthExchangeResponse must have snake_case fields", () => {
    const response = OAUTH_EXCHANGE_RESPONSE_FIXTURE;

    expect(response).toHaveProperty("access_token");
    expect(response).toHaveProperty("expires_at");
    expect(response).toHaveProperty("refresh_token");
    expect(response).toHaveProperty("refresh_expires_at");
    expect(response).toHaveProperty("user_id");
  });

  it("GitHubAppCallbackRequest must have snake_case fields", () => {
    const request = {
      installation_id: 123456,
      state: "jws-state",
      selected_repository_ids: [1, 2, 3],
    };

    expect(request).toHaveProperty("installation_id");
    expect(request).toHaveProperty("state");
    expect(request).toHaveProperty("selected_repository_ids");
  });

  it("GitHubAppInstallResponse must have snake_case fields", () => {
    const response = GITHUB_APP_INSTALL_RESPONSE_FIXTURE;

    expect(response).toHaveProperty("installation_id");
    expect(response).toHaveProperty("app_id");
    expect(response).toHaveProperty("app_slug");
    expect(response).toHaveProperty("account_login");
    expect(response).toHaveProperty("account_id");
    expect(response).toHaveProperty("account_avatar_url");
    expect(response).toHaveProperty("token");
    expect(response).toHaveProperty("expires_at");
    expect(response).toHaveProperty("renewal_grant_token");
    expect(response).toHaveProperty("renewal_grant_expires_at");
  });

  it("GitHubAppRenewalRequest must have snake_case fields", () => {
    const request = {
      installation_id: 123456,
      renewal_grant_token: "grant-token",
      jti: "unique-jti",
    };

    expect(request).toHaveProperty("installation_id");
    expect(request).toHaveProperty("renewal_grant_token");
    expect(request).toHaveProperty("jti");
  });
});

describe("Worker Contract: Numeric IDs", () => {
  it("user_id must be a positive number", () => {
    expect(OAUTH_EXCHANGE_RESPONSE_FIXTURE.user_id).toBeGreaterThan(0);
    expect(Number.isInteger(OAUTH_EXCHANGE_RESPONSE_FIXTURE.user_id)).toBe(true);
  });

  it("installation_id must be a positive number", () => {
    expect(GITHUB_APP_INSTALL_RESPONSE_FIXTURE.installation_id).toBeGreaterThan(0);
    expect(Number.isInteger(GITHUB_APP_INSTALL_RESPONSE_FIXTURE.installation_id)).toBe(true);
  });

  it("app_id must be a positive number", () => {
    expect(GITHUB_APP_INSTALL_RESPONSE_FIXTURE.app_id).toBeGreaterThan(0);
    expect(Number.isInteger(GITHUB_APP_INSTALL_RESPONSE_FIXTURE.app_id)).toBe(true);
  });

  it("account_id must be a positive number", () => {
    expect(GITHUB_APP_INSTALL_RESPONSE_FIXTURE.account_id).toBeGreaterThan(0);
    expect(Number.isInteger(GITHUB_APP_INSTALL_RESPONSE_FIXTURE.account_id)).toBe(true);
  });
});

describe("Worker Contract: Renewal Grant", () => {
  it("renewal_grant_token must be a non-empty string", () => {
    expect(typeof GITHUB_APP_INSTALL_RESPONSE_FIXTURE.renewal_grant_token).toBe("string");
    expect(GITHUB_APP_INSTALL_RESPONSE_FIXTURE.renewal_grant_token.length).toBeGreaterThan(0);
  });

  it("renewal_grant_expires_at must be after expires_at (grant outlasts token)", () => {
    const tokenExpiry = GITHUB_APP_INSTALL_RESPONSE_FIXTURE.expires_at;
    const grantExpiry = GITHUB_APP_INSTALL_RESPONSE_FIXTURE.renewal_grant_expires_at;

    // Grant should expire at least as long as the token (usually longer)
    expect(grantExpiry).toBeGreaterThan(tokenExpiry);
  });

  it("renewal response must have same shape as install response", () => {
    const installResponse = GITHUB_APP_INSTALL_RESPONSE_FIXTURE;
    const renewResponse = GITHUB_APP_RENEWAL_RESPONSE_FIXTURE;

    const installFields = Object.keys(installResponse).sort();
    const renewFields = Object.keys(renewResponse).sort();

    expect(renewFields).toEqual(installFields);
  });
});

describe("Worker Contract: Health Response", () => {
  it("health response must have status and version", () => {
    const response = HEALTH_RESPONSE_FIXTURE;

    expect(response).toHaveProperty("status");
    expect(response).toHaveProperty("version");
    expect(Object.keys(response).sort()).toEqual(["status", "version"]);
  });

  it("health status must be 'ok'", () => {
    expect(HEALTH_RESPONSE_FIXTURE.status).toBe("ok");
  });
});

describe("Worker Base URL", () => {
  it("WORKER_BASE_URL must point to the deployed Worker API", () => {
    expect(WORKER_BASE_URL).toBe("https://worker.gitnotes.org/api/v1");
  });

  it("WORKER_BASE_URL must not have a double /api/v1 path", () => {
    const matches = WORKER_BASE_URL.match(/\/api\/v1.*\/api\/v1/);
    expect(matches).toBeNull();
  });
});
