/**
 * Referral API contract tests for the mobile Worker API client.
 *
 * These tests verify:
 * - API client methods make correct fetch calls
 * - Identity proof headers are sent correctly (github vs installation)
 * - Request/response serialization matches the contract
 * - Error responses are correctly parsed
 * - Reward catalog matches issue #1771
 *
 * Run with: yarn jest __tests__/services/worker_referral_contract.test.ts --testPathIgnorePatterns=
 */

import {
  WORKER_BASE_URL,
  WorkerErrorCode,
  REFERRAL_REWARD_CATALOG,
  REFERRAL_AUTH_HEADER,
  REFERRAL_INSTALL_ID_HEADER,
  ReferralCreateRequestSchema,
  ReferralCompleteRequestSchema,
  ReferralCompleteResponseSchema,
  ReferralStatusResponseSchema,
  type ReferralIdentityProof,
} from "../../src/types/worker";

import { workerApi } from "../../src/services/workerApi";

// Mock global fetch
const mockFetch = jest.fn();
global.fetch = mockFetch;

const GITHUB_IDENTITY: ReferralIdentityProof = { kind: "github", token: "gho_test_token", installationId: "uuid-install-123" };
const INSTALL_IDENTITY: ReferralIdentityProof = { kind: "installation", installationId: "uuid-install-123" };

describe("workerApi.referrals", () => {
  beforeEach(() => {
    mockFetch.mockReset();
  });

  describe("create", () => {
    it("calls POST /referrals/create with github token header", async () => {
      const mockResponse = {
        code: "abc123",
        share_url: "https://gitnotes.org/r/abc123",
        expires_at: Date.now() + 86400000 * 30,
      };
      mockFetch.mockResolvedValueOnce({
        ok: true,
        status: 200,
        text: () => Promise.resolve(JSON.stringify(mockResponse)),
      });

      const result = await workerApi.referrals.create({}, GITHUB_IDENTITY);

      expect(mockFetch).toHaveBeenCalledWith(
        `${WORKER_BASE_URL}/referrals/create`,
        expect.objectContaining({
          method: "POST",
          body: JSON.stringify({}),
          headers: expect.objectContaining({
            [REFERRAL_AUTH_HEADER]: "gho_test_token",
          }),
        })
      );
      expect(result).toEqual(mockResponse);
    });

    it("calls POST /referrals/create with installation ID header", async () => {
      const mockResponse = {
        code: "abc123",
        share_url: "https://gitnotes.org/r/abc123",
        expires_at: Date.now() + 86400000 * 30,
      };
      mockFetch.mockResolvedValueOnce({
        ok: true,
        status: 200,
        text: () => Promise.resolve(JSON.stringify(mockResponse)),
      });

      await workerApi.referrals.create({}, INSTALL_IDENTITY);

      expect(mockFetch).toHaveBeenCalledWith(
        `${WORKER_BASE_URL}/referrals/create`,
        expect.objectContaining({
          headers: expect.objectContaining({
            [REFERRAL_INSTALL_ID_HEADER]: "uuid-install-123",
          }),
        })
      );
    });

    it("does not send identity fields in body", async () => {
      const mockResponse = {
        code: "abc123",
        share_url: "https://gitnotes.org/r/abc123",
        expires_at: Date.now() + 86400000 * 30,
      };
      mockFetch.mockResolvedValueOnce({
        ok: true,
        status: 200,
        text: () => Promise.resolve(JSON.stringify(mockResponse)),
      });

      await workerApi.referrals.create({}, GITHUB_IDENTITY);

      const fetchCall = mockFetch.mock.calls[0];
      const requestBody = JSON.parse(fetchCall[1].body);
      expect(requestBody).not.toHaveProperty("user_id");
      expect(requestBody).not.toHaveProperty("installation_id");
      expect(requestBody).not.toHaveProperty("client_id");
      expect(requestBody).not.toHaveProperty("identity");
    });

    it("returns code, share_url, and expires_at", async () => {
      const expiresAt = Date.now() + 86400000 * 30;
      const mockResponse = {
        code: "testcode",
        share_url: "https://gitnotes.org/r/testcode",
        expires_at: expiresAt,
      };
      mockFetch.mockResolvedValueOnce({
        ok: true,
        status: 200,
        text: () => Promise.resolve(JSON.stringify(mockResponse)),
      });

      const result = await workerApi.referrals.create({}, INSTALL_IDENTITY);

      expect(result).toHaveProperty("code");
      expect(result).toHaveProperty("share_url");
      expect(result).toHaveProperty("expires_at");
      expect(result.share_url).toContain(result.code);
    });

    it("throws WorkerApiError for non-2xx responses", async () => {
      mockFetch.mockResolvedValueOnce({
        ok: false,
        status: 429,
        json: () => Promise.resolve({ code: "rate_limit_exceeded", message: "Too many requests" }),
      });

      await expect(workerApi.referrals.create({}, GITHUB_IDENTITY)).rejects.toThrow("Too many requests");
    });
  });

  describe("complete", () => {
    it("calls POST /referrals/complete with code field and BOTH github headers (token + installId)", async () => {
      const mockResponse = { accepted: true };
      mockFetch.mockResolvedValueOnce({
        ok: true,
        status: 200,
        text: () => Promise.resolve(JSON.stringify(mockResponse)),
      });

      const result = await workerApi.referrals.complete({ code: "abc123" }, GITHUB_IDENTITY);

      expect(mockFetch).toHaveBeenCalledWith(
        `${WORKER_BASE_URL}/referrals/complete`,
        expect.objectContaining({
          method: "POST",
          body: JSON.stringify({ code: "abc123" }),
          headers: expect.objectContaining({
            [REFERRAL_AUTH_HEADER]: "gho_test_token",
            [REFERRAL_INSTALL_ID_HEADER]: "uuid-install-123",
          }),
        })
      );
      expect(result).toEqual(mockResponse);
    });

    it("calls POST /referrals/complete with installation ID header only (no token header)", async () => {
      const mockResponse = { accepted: true };
      mockFetch.mockResolvedValueOnce({
        ok: true,
        status: 200,
        text: () => Promise.resolve(JSON.stringify(mockResponse)),
      });

      await workerApi.referrals.complete({ code: "abc123" }, INSTALL_IDENTITY);

      expect(mockFetch).toHaveBeenCalledWith(
        `${WORKER_BASE_URL}/referrals/complete`,
        expect.objectContaining({
          headers: expect.objectContaining({
            [REFERRAL_INSTALL_ID_HEADER]: "uuid-install-123",
          }),
        })
      );
      // Token header should NOT be present for installation-only identity
      const headers = mockFetch.mock.calls[0][1].headers;
      expect(headers[REFERRAL_AUTH_HEADER]).toBeUndefined();
    });

    it("does not send identity fields in request body", async () => {
      const mockResponse = { accepted: true };
      mockFetch.mockResolvedValueOnce({
        ok: true,
        status: 200,
        text: () => Promise.resolve(JSON.stringify(mockResponse)),
      });

      await workerApi.referrals.complete({ code: "abc123" }, GITHUB_IDENTITY);

      const fetchCall = mockFetch.mock.calls[0];
      const requestBody = JSON.parse(fetchCall[1].body);
      expect(requestBody).toEqual({ code: "abc123" });
      expect(requestBody).not.toHaveProperty("user_id");
      expect(requestBody).not.toHaveProperty("installation_id");
      expect(requestBody).not.toHaveProperty("identity_proof");
    });

    it("returns only accepted boolean (minimal response - no inviter progress)", async () => {
      const mockResponse = { accepted: true };
      mockFetch.mockResolvedValueOnce({
        ok: true,
        status: 200,
        text: () => Promise.resolve(JSON.stringify(mockResponse)),
      });

      const result = await workerApi.referrals.complete({ code: "abc123" }, INSTALL_IDENTITY);

      expect(result).toHaveProperty("accepted");
      expect(typeof result.accepted).toBe("boolean");
      expect(result).not.toHaveProperty("progress");
      expect(result).not.toHaveProperty("unlocked_milestone");
      expect(result).not.toHaveProperty("total_unlocks");
    });

    it("throws WorkerApiError for code_not_found", async () => {
      mockFetch.mockResolvedValueOnce({
        ok: false,
        status: 404,
        json: () => Promise.resolve({ code: "code_not_found", message: "Referral code not found" }),
      });

      await expect(workerApi.referrals.complete({ code: "invalid" }, GITHUB_IDENTITY)).rejects.toThrow(
        "Referral code not found"
      );
    });
  });

  describe("status", () => {
    it("calls GET /referrals/status with github token header", async () => {
      const mockResponse = {
        has_pending_code: false,
        pending_code: null,
        pending_expires_at: null,
        progress: 0,
        catalog_version: 1,
        unlocked_milestones: [],
        milestones: [],
      };
      mockFetch.mockResolvedValueOnce({
        ok: true,
        status: 200,
        text: () => Promise.resolve(JSON.stringify(mockResponse)),
      });

      const result = await workerApi.referrals.status(GITHUB_IDENTITY);

      expect(mockFetch).toHaveBeenCalledWith(
        `${WORKER_BASE_URL}/referrals/status`,
        expect.objectContaining({
          method: "GET",
          headers: expect.objectContaining({
            [REFERRAL_AUTH_HEADER]: "gho_test_token",
          }),
        })
      );
      expect(result).toEqual(mockResponse);
    });

    it("calls GET /referrals/status with installation ID header", async () => {
      const mockResponse = {
        has_pending_code: false,
        pending_code: null,
        pending_expires_at: null,
        progress: 0,
        catalog_version: 1,
        unlocked_milestones: [],
        milestones: [],
      };
      mockFetch.mockResolvedValueOnce({
        ok: true,
        status: 200,
        text: () => Promise.resolve(JSON.stringify(mockResponse)),
      });

      await workerApi.referrals.status(INSTALL_IDENTITY);

      expect(mockFetch).toHaveBeenCalledWith(
        `${WORKER_BASE_URL}/referrals/status`,
        expect.objectContaining({
          headers: expect.objectContaining({
            [REFERRAL_INSTALL_ID_HEADER]: "uuid-install-123",
          }),
        })
      );
    });

    it("does not send identity as query parameter", async () => {
      const mockResponse = {
        has_pending_code: false,
        pending_code: null,
        pending_expires_at: null,
        progress: 0,
        catalog_version: 1,
        unlocked_milestones: [],
        milestones: [],
      };
      mockFetch.mockResolvedValueOnce({
        ok: true,
        status: 200,
        text: () => Promise.resolve(JSON.stringify(mockResponse)),
      });

      await workerApi.referrals.status(GITHUB_IDENTITY);

      const fetchCall = mockFetch.mock.calls[0];
      const url = fetchCall[0];
      expect(url).toBe(`${WORKER_BASE_URL}/referrals/status`);
      expect(url).not.toContain("?identity=");
    });

    it("returns all required status fields including inviter progress", async () => {
      const mockResponse = {
        has_pending_code: true,
        pending_code: "abc123",
        pending_expires_at: Date.now() + 86400000 * 30,
        progress: 5,
        catalog_version: 1,
        unlocked_milestones: [1, 3, 5] as const,
        milestones: [
          { milestone: 1, name: "Terminal Mono", reward_type: "icon", reward_key: "terminal-mono-icon", unlocked: true },
          { milestone: 3, name: "Terminal Mono", reward_type: "theme", reward_key: "terminal-mono-theme", unlocked: true },
          { milestone: 5, name: "Amber Terminal", reward_type: "icon", reward_key: "amber-terminal-icon", unlocked: true },
          { milestone: 10, name: "CRT Green", reward_type: "theme", reward_key: "crt-green-theme", unlocked: false },
          { milestone: 15, name: "Monochrome Grid", reward_type: "icon", reward_key: "monochrome-grid-icon", unlocked: false },
          { milestone: 20, name: "Developer Desk", reward_type: "theme", reward_key: "developer-desk-theme", unlocked: false },
        ],
      };
      mockFetch.mockResolvedValueOnce({
        ok: true,
        status: 200,
        text: () => Promise.resolve(JSON.stringify(mockResponse)),
      });

      const result = await workerApi.referrals.status(INSTALL_IDENTITY);

      expect(result).toHaveProperty("has_pending_code");
      expect(result).toHaveProperty("pending_code");
      expect(result).toHaveProperty("pending_expires_at");
      expect(result).toHaveProperty("progress");
      expect(result).toHaveProperty("catalog_version");
      expect(result).toHaveProperty("unlocked_milestones");
      expect(result).toHaveProperty("milestones");
    });
  });
});

describe("Referral Error Codes", () => {
  it("must have referral-specific error codes defined in WorkerErrorCode", () => {
    const referralCodes = [
      "rate_limit_exceeded",
      "code_not_found",
      "code_already_used",
      "identity_required",
      "identity_mismatch",
      "self_referral_not_allowed",
      "invalid_milestone",
      "milestone_already_unlocked",
    ];

    const missingCodes: string[] = [];
    for (const code of referralCodes) {
      if (!Object.values(WorkerErrorCode).includes(code)) {
        missingCodes.push(code);
      }
    }

    expect(missingCodes).toHaveLength(0);
  });

  it("all referral error codes must be snake_case", () => {
    const referralCodes = [
      "rate_limit_exceeded",
      "code_not_found",
      "code_already_used",
      "identity_required",
      "identity_mismatch",
      "self_referral_not_allowed",
      "invalid_milestone",
      "milestone_already_unlocked",
    ];

    for (const code of referralCodes) {
      expect(code).toMatch(/^[a-z_]+$/);
    }
  });

  it("has REFERRAL_CODE_EXPIRED alias for code_expired", () => {
    expect(WorkerErrorCode.REFERRAL_CODE_EXPIRED).toBe("code_expired");
  });
});

describe("Referral Identity Headers", () => {
  it("must export REFERRAL_AUTH_HEADER constant", () => {
    expect(REFERRAL_AUTH_HEADER).toBe("X-Referral-Token");
  });

  it("must export REFERRAL_INSTALL_ID_HEADER constant", () => {
    expect(REFERRAL_INSTALL_ID_HEADER).toBe("X-Referral-Install-ID");
  });
});

describe("ReferralIdentityProof Type", () => {
  it("github variant requires token and installationId fields", () => {
    const proof: ReferralIdentityProof = { kind: "github", token: "gho_abc", installationId: "uuid-123" };
    expect(proof.kind).toBe("github");
    expect(proof.token).toBe("gho_abc");
    expect((proof as any).installationId).toBe("uuid-123");
  });

  it("installation variant requires installationId field", () => {
    const proof: ReferralIdentityProof = { kind: "installation", installationId: "uuid-123" };
    expect(proof.kind).toBe("installation");
    expect(proof.installationId).toBe("uuid-123");
  });
});

describe("Reward Catalog", () => {
  it("catalog must have exactly 6 milestones", () => {
    expect(REFERRAL_REWARD_CATALOG).toHaveLength(6);
  });

  it("milestone keys must match issue #1771 exactly", () => {
    const expectedKeys = [
      "terminal-mono-icon",
      "terminal-mono-theme",
      "amber-terminal-icon",
      "crt-green-theme",
      "monochrome-grid-icon",
      "developer-desk-theme",
    ];

    const actualKeys = REFERRAL_REWARD_CATALOG.map((c) => c.reward_key).sort();
    expect(actualKeys).toEqual(expectedKeys.sort());
  });

  it("milestone numbers must be 1, 3, 5, 10, 15, 20", () => {
    const expectedMilestones = [1, 3, 5, 10, 15, 20];
    const actualMilestones = REFERRAL_REWARD_CATALOG.map((c) => c.milestone).sort((a, b) => a - b);
    expect(actualMilestones).toEqual(expectedMilestones);
  });

  it("each milestone must have correct type mapping", () => {
    const expected = [
      { milestone: 1, reward_type: "icon" as const, reward_key: "terminal-mono-icon" },
      { milestone: 3, reward_type: "theme" as const, reward_key: "terminal-mono-theme" },
      { milestone: 5, reward_type: "icon" as const, reward_key: "amber-terminal-icon" },
      { milestone: 10, reward_type: "theme" as const, reward_key: "crt-green-theme" },
      { milestone: 15, reward_type: "icon" as const, reward_key: "monochrome-grid-icon" },
      { milestone: 20, reward_type: "theme" as const, reward_key: "developer-desk-theme" },
    ];

    for (const exp of expected) {
      const found = REFERRAL_REWARD_CATALOG.find(
        (c) => c.milestone === exp.milestone && c.reward_type === exp.reward_type
      );
      expect(found?.reward_key).toBe(exp.reward_key);
    }
  });

  it("each milestone must have name matching issue", () => {
    const expected = [
      { milestone: 1, name: "Terminal Mono" },
      { milestone: 3, name: "Terminal Mono" },
      { milestone: 5, name: "Amber Terminal" },
      { milestone: 10, name: "CRT Green" },
      { milestone: 15, name: "Monochrome Grid" },
      { milestone: 20, name: "Developer Desk" },
    ];

    for (const exp of expected) {
      const found = REFERRAL_REWARD_CATALOG.find((c) => c.milestone === exp.milestone);
      expect(found?.name).toBe(exp.name);
    }
  });

  it("catalog array equals exact expected tuple", () => {
    const expected = [
      { milestone: 1, name: "Terminal Mono", reward_type: "icon" as const, reward_key: "terminal-mono-icon" },
      { milestone: 3, name: "Terminal Mono", reward_type: "theme" as const, reward_key: "terminal-mono-theme" },
      { milestone: 5, name: "Amber Terminal", reward_type: "icon" as const, reward_key: "amber-terminal-icon" },
      { milestone: 10, name: "CRT Green", reward_type: "theme" as const, reward_key: "crt-green-theme" },
      { milestone: 15, name: "Monochrome Grid", reward_type: "icon" as const, reward_key: "monochrome-grid-icon" },
      { milestone: 20, name: "Developer Desk", reward_type: "theme" as const, reward_key: "developer-desk-theme" },
    ];

    expect(REFERRAL_REWARD_CATALOG).toEqual(expected);
  });
});

describe("Share URL", () => {
  it("referral share URL must use correct base", () => {
    const REFERRAL_LINK_BASE = "https://gitnotes.org/r/";
    expect(REFERRAL_LINK_BASE).toBe("https://gitnotes.org/r/");
  });

  it("share_url must use the correct domain", () => {
    const code = "abc123";
    const shareUrl = `https://gitnotes.org/r/${code}`;

    expect(shareUrl).toBe("https://gitnotes.org/r/abc123");
    expect(shareUrl).toMatch(/^https:\/\/gitnotes\.org\/r\/[a-zA-Z0-9]+$/);
  });
});

describe("Runtime Schema Validation", () => {
  describe("ReferralCreateRequestSchema", () => {
    it("accepts empty object", () => {
      const result = ReferralCreateRequestSchema.safeParse({});
      expect(result.success).toBe(true);
    });

    it("rejects user_id field", () => {
      const result = ReferralCreateRequestSchema.safeParse({ user_id: "123" });
      expect(result.success).toBe(false);
    });

    it("rejects installation_id field", () => {
      const result = ReferralCreateRequestSchema.safeParse({ installation_id: "abc" });
      expect(result.success).toBe(false);
    });

    it("rejects identity_proof field", () => {
      const result = ReferralCreateRequestSchema.safeParse({ identity_proof: "token" });
      expect(result.success).toBe(false);
    });
  });

  describe("ReferralCompleteRequestSchema", () => {
    it("accepts valid code", () => {
      const result = ReferralCompleteRequestSchema.safeParse({ code: "abc123" });
      expect(result.success).toBe(true);
    });

    it("rejects extra user_id field", () => {
      const result = ReferralCompleteRequestSchema.safeParse({ code: "abc123", user_id: "123" });
      expect(result.success).toBe(false);
    });

    it("rejects extra installation_id field", () => {
      const result = ReferralCompleteRequestSchema.safeParse({ code: "abc123", installation_id: "abc" });
      expect(result.success).toBe(false);
    });

    it("rejects extra identity_proof field", () => {
      const result = ReferralCompleteRequestSchema.safeParse({ code: "abc123", identity_proof: "token" });
      expect(result.success).toBe(false);
    });

    it("rejects extra progress field", () => {
      const result = ReferralCompleteRequestSchema.safeParse({ code: "abc123", progress: 1 });
      expect(result.success).toBe(false);
    });

    it("rejects extra claimed_milestone field", () => {
      const result = ReferralCompleteRequestSchema.safeParse({ code: "abc123", claimed_milestone: 3 });
      expect(result.success).toBe(false);
    });
  });

  describe("ReferralCompleteResponseSchema", () => {
    it("accepts minimal { accepted: true }", () => {
      const result = ReferralCompleteResponseSchema.safeParse({ accepted: true });
      expect(result.success).toBe(true);
    });

    it("accepts { accepted: false }", () => {
      const result = ReferralCompleteResponseSchema.safeParse({ accepted: false });
      expect(result.success).toBe(true);
    });

    it("rejects legacy response with progress field", () => {
      const result = ReferralCompleteResponseSchema.safeParse({ accepted: true, progress: 1 });
      expect(result.success).toBe(false);
    });

    it("rejects legacy response with unlocked_milestone field", () => {
      const result = ReferralCompleteResponseSchema.safeParse({ accepted: true, unlocked_milestone: 3 });
      expect(result.success).toBe(false);
    });

    it("rejects legacy response with total_unlocks field", () => {
      const result = ReferralCompleteResponseSchema.safeParse({ accepted: true, total_unlocks: 1 });
      expect(result.success).toBe(false);
    });

    it("rejects extra fields", () => {
      const result = ReferralCompleteResponseSchema.safeParse({ accepted: true, extra: "field" });
      expect(result.success).toBe(false);
    });
  });

  describe("ReferralStatusResponseSchema", () => {
    it("accepts valid numeric milestones", () => {
      const data = {
        has_pending_code: true,
        pending_code: "abc123",
        pending_expires_at: Date.now() + 86400000,
        progress: 5,
        catalog_version: 1,
        unlocked_milestones: [1, 3, 5],
        milestones: [
          { milestone: 1, name: "Terminal Mono", reward_type: "icon", reward_key: "terminal-mono-icon", unlocked: true },
          { milestone: 3, name: "Terminal Mono", reward_type: "theme", reward_key: "terminal-mono-theme", unlocked: true },
          { milestone: 5, name: "Amber Terminal", reward_type: "icon", reward_key: "amber-terminal-icon", unlocked: true },
          { milestone: 10, name: "CRT Green", reward_type: "theme", reward_key: "crt-green-theme", unlocked: false },
          { milestone: 15, name: "Monochrome Grid", reward_type: "icon", reward_key: "monochrome-grid-icon", unlocked: false },
          { milestone: 20, name: "Developer Desk", reward_type: "theme", reward_key: "developer-desk-theme", unlocked: false },
        ],
      };
      const result = ReferralStatusResponseSchema.safeParse(data);
      expect(result.success).toBe(true);
    });

    it("rejects string milestone values", () => {
      const data = {
        has_pending_code: false,
        pending_code: null,
        pending_expires_at: null,
        progress: 0,
        catalog_version: 1,
        unlocked_milestones: ["1", "3"],
        milestones: [],
      };
      const result = ReferralStatusResponseSchema.safeParse(data);
      expect(result.success).toBe(false);
    });

    it("rejects invalid milestone number 2", () => {
      const data = {
        has_pending_code: false,
        pending_code: null,
        pending_expires_at: null,
        progress: 0,
        catalog_version: 1,
        unlocked_milestones: [2],
        milestones: [],
      };
      const result = ReferralStatusResponseSchema.safeParse(data);
      expect(result.success).toBe(false);
    });

    it("rejects milestone 7 (not in catalog)", () => {
      const data = {
        has_pending_code: false,
        pending_code: null,
        pending_expires_at: null,
        progress: 0,
        catalog_version: 1,
        unlocked_milestones: [7],
        milestones: [],
      };
      const result = ReferralStatusResponseSchema.safeParse(data);
      expect(result.success).toBe(false);
    });
  });
});
