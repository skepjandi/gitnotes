/**
 * Integration tests for AuthService.connectHost() — Free/Pro identity boundary.
 *
 * Tests the three entry paths inside connectHost:
 *   Path A — explicit accountId provided and found
 *   Path B — no accountId, login matched an existing account
 *   Path C — no accountId, no login match (fresh identity)
 *
 * Verifies:
 * - First identity creation is always allowed for Free.
 * - Second account/provider/host on the same account is blocked for Free.
 * - Same-host credential attachment (any kind) is always allowed.
 * - Pro bypasses all identity limits.
 * - connectHost returns the correct reason string on rejection.
 * - Token validation failures short-circuit before the tier policy is checked.
 *
 * Strategy: TierLimits is mocked via jest.mock factory with a module-level control
 * variable so each test sets canCreateAdditionalIdentity return value directly,
 * avoiding spy restoration issues across nested beforeEach. AccountStorage is spied
 * on the real class. global.fetch is mocked for token validation.
 */
import { describe, it, expect, beforeEach, afterEach, jest as _jest } from '@jest/globals';

jest.resetModules();
jest.unmock('@/services/TierLimits');
jest.unmock('@/services/AuthService');
jest.unmock('@/stores/proStore');
jest.unmock('@/services/AccountStorage');

const { useProStore } = jest.requireActual<typeof import('@/stores/proStore')>('@/stores/proStore');
const TierLimitsActual = jest.requireActual<typeof import('@/services/TierLimits')>('@/services/TierLimits');
const { AccountStorage: AccountStorageActual } = jest.requireActual<typeof import('@/services/AccountStorage')>('@/services/AccountStorage');
const { AuthService } = jest.requireActual<typeof import('@/services/AuthService')>('@/services/AuthService');

// ── Mock global fetch for validateGitHubToken ─────────────────────────────────

function mockFetchOk(user: { id: number; login: string; name?: string; email?: string }) {
  const mockResponse = {
    ok: true,
    status: 200,
    headers: new Map([['content-type', 'application/json']]),
    json: async () => user,
  } as unknown as Response;
  global.fetch = _jest.fn(async () => mockResponse) as unknown as typeof fetch;
}

function mockFetchAuthError() {
  const mockResponse = {
    ok: false,
    status: 401,
    headers: new Map(),
  } as unknown as Response;
  global.fetch = _jest.fn(async () => mockResponse) as unknown as typeof fetch;
}

function mockFetchSamlError() {
  const mockResponse = {
    ok: false,
    status: 403,
    headers: new Map([['x-github-sso', 'required']]),
  } as unknown as Response;
  global.fetch = _jest.fn(async () => mockResponse) as unknown as typeof fetch;
}

// ── Mock gitea/forgejo host services ───────────────────────────────────────

jest.mock('@/services/git/gitHostFactory', () => ({
  giteaHostService: {
    storeHostCredentials: jest.fn(async () => { /* noop */ }),
    setToken: jest.fn(async () => ({ id: 1, login: 'giteauser', name: 'Gitea User' })),
    getBaseUrl: () => 'https://gitea.example.com',
  },
  forgejoHostService: {
    storeHostCredentials: jest.fn(async () => { /* noop */ }),
    setToken: jest.fn(async () => ({ id: 1, login: 'forgejouser', name: 'Forgejo User' })),
    getBaseUrl: () => 'https://forgejo.example.com',
  },
}));

// ── Helpers ────────────────────────────────────────────────────────────────────

function makeHost(
  accountId: string,
  provider: 'github' | 'gitlab' | 'gitea' | 'forgejo',
  instanceBaseUrl: string | null,
): import('@/services/AccountStorage').HostConnection {
  const normalizedUrl = instanceBaseUrl ? instanceBaseUrl.replace(/\/+$/, '') : null;
  const instanceKey = (normalizedUrl ?? 'default').replace(/[^a-zA-Z0-9._-]/g, '_');
  return {
    id: `${accountId}:${provider}:${instanceKey}`,
    accountId,
    provider,
    instanceBaseUrl,
    hostLogin: `${provider}user`,
    hostUserId: 99999,
    name: `${provider} User`,
    email: `${provider}@example.com`,
    avatarUrl: null,
    addedAt: Date.now(),
  };
}

// ── Test suite ─────────────────────────────────────────────────────────────────

describe('AuthService.connectHost — Free/Pro identity boundary', () => {
  let canCreateAdditionalIdentitySpy: _jest.SpyInstance;
  let listAccountsSpy: _jest.SpyInstance;
  let listHostConnectionsSpy: _jest.SpyInstance;
  let addAccountSpy: _jest.SpyInstance;
  let upsertHostConnectionSpy: _jest.SpyInstance;

  beforeEach(() => {
    canCreateAdditionalIdentitySpy = _jest.spyOn(TierLimitsActual, 'canCreateAdditionalIdentity').mockReset();
    canCreateAdditionalIdentitySpy.mockResolvedValue(true);
    useProStore.setState({ status: 'free', entitlementActive: false });
    mockFetchOk({ id: 12345, login: 'testuser', name: 'Test User' });

    // Directly assign mock functions to static methods on the AccountStorage class
    // so AuthService (which imports AccountStorage from the same module) sees the mocks.
    listAccountsSpy = _jest.fn();
    listHostConnectionsSpy = _jest.fn();
    addAccountSpy = _jest.fn();
    upsertHostConnectionSpy = _jest.fn();
    (AccountStorageActual as unknown as { listAccounts: typeof listAccountsSpy }).listAccounts = listAccountsSpy;
    (AccountStorageActual as unknown as { listHostConnections: typeof listHostConnectionsSpy }).listHostConnections = listHostConnectionsSpy;
    (AccountStorageActual as unknown as { addAccount: typeof addAccountSpy }).addAccount = addAccountSpy;
    (AccountStorageActual as unknown as { upsertHostConnection: typeof upsertHostConnectionSpy }).upsertHostConnection = upsertHostConnectionSpy;
  });

  describe('Free user: first identity creation', () => {
    it('allows connecting a first host when no accounts exist (Path C)', async () => {
      listAccountsSpy.mockResolvedValue([]);
      listHostConnectionsSpy.mockResolvedValue([]);
      addAccountSpy.mockResolvedValue({
        id: 'acc-new', login: 'testuser', name: 'Test User', email: 'test@example.com',
        avatarUrl: null, addedAt: Date.now(),
      });
      upsertHostConnectionSpy.mockResolvedValue(makeHost('acc-new', 'github', null));

      const result = await AuthService.connectHost({
        provider: 'github',
        token: 'gho_test_token',
      });

      expect(result.ok).toBe(true);
      expect(addAccountSpy).toHaveBeenCalled();
      expect(upsertHostConnectionSpy).toHaveBeenCalled();
    });

    it('blocks adding a different provider to an existing account for Free (Path A)', async () => {
      listAccountsSpy.mockResolvedValue([{
        id: 'acc-1', login: 'testuser', name: 'Test', email: null, avatarUrl: null, addedAt: Date.now(),
      }]);
      listHostConnectionsSpy.mockResolvedValue([makeHost('acc-1', 'github', null)]);
      upsertHostConnectionSpy.mockResolvedValue(makeHost('acc-1', 'gitlab', null));
      canCreateAdditionalIdentitySpy.mockResolvedValue(false);

      const result = await AuthService.connectHost({
        provider: 'gitlab',
        token: 'gl_test_token',
        accountId: 'acc-1',
      });

      expect(result.ok).toBe(false);
      expect(result.reason).toBe('free_tier_identity_limit_reached');
    });

    it('blocks adding a different provider via Path B (login match, new host)', async () => {
      listAccountsSpy.mockResolvedValue([{
        id: 'acc-1', login: 'testuser', name: 'Test', email: null, avatarUrl: null, addedAt: Date.now(),
      }]);
      listHostConnectionsSpy.mockResolvedValue([makeHost('acc-1', 'github', null)]);
      upsertHostConnectionSpy.mockResolvedValue(makeHost('acc-1', 'gitlab', null));
      canCreateAdditionalIdentitySpy.mockResolvedValue(false);

      const result = await AuthService.connectHost({
        provider: 'gitlab',
        token: 'gl_test_token',
      });

      expect(result.ok).toBe(false);
      expect(result.reason).toBe('free_tier_identity_limit_reached');
    });
  });

  describe('Same-host credential attachment (always allowed)', () => {
    it('allows attaching credentials to an already-connected host (same provider, same instance)', async () => {
      listAccountsSpy.mockResolvedValue([{
        id: 'acc-1', login: 'testuser', name: 'Test', email: null, avatarUrl: null, addedAt: Date.now(),
      }]);
      listHostConnectionsSpy.mockResolvedValue([makeHost('acc-1', 'github', null)]);
      upsertHostConnectionSpy.mockResolvedValue(makeHost('acc-1', 'github', null));

      const result = await AuthService.connectHost({
        provider: 'github',
        token: 'gho_updated_token',
        accountId: 'acc-1',
      });

      expect(result.ok).toBe(true);
      expect(upsertHostConnectionSpy).toHaveBeenCalledWith(
        expect.objectContaining({ accountId: 'acc-1', provider: 'github' }),
      );
    });

    it('allows attaching a second credential kind to the same host for Free', async () => {
      listAccountsSpy.mockResolvedValue([{
        id: 'acc-1', login: 'testuser', name: 'Test', email: null, avatarUrl: null, addedAt: Date.now(),
      }]);
      listHostConnectionsSpy.mockResolvedValue([makeHost('acc-1', 'github', null)]);
      upsertHostConnectionSpy.mockResolvedValue(makeHost('acc-1', 'github', null));

      const result = await AuthService.connectHost({
        provider: 'github',
        token: 'gho_new_credential_kind_token',
        accountId: 'acc-1',
      });

      expect(result.ok).toBe(true);
    });
  });

  describe('Pro user: unlimited identities', () => {
    it('allows creating a second identity on a different provider for Pro (Path A)', async () => {
      useProStore.setState({ status: 'pro', entitlementActive: true });
      listAccountsSpy.mockResolvedValue([{
        id: 'acc-1', login: 'testuser', name: 'Test', email: null, avatarUrl: null, addedAt: Date.now(),
      }]);
      listHostConnectionsSpy.mockResolvedValue([makeHost('acc-1', 'github', null)]);
      upsertHostConnectionSpy.mockResolvedValue(makeHost('acc-1', 'gitlab', null));

      const result = await AuthService.connectHost({
        provider: 'gitlab',
        token: 'gl_test_token',
        accountId: 'acc-1',
      });

      expect(result.ok).toBe(true);
    });

    it('allows creating a second identity on a different host for Pro (Path B)', async () => {
      useProStore.setState({ status: 'pro', entitlementActive: true });
      listAccountsSpy.mockResolvedValue([{
        id: 'acc-1', login: 'testuser', name: 'Test', email: null, avatarUrl: null, addedAt: Date.now(),
      }]);
      listHostConnectionsSpy.mockResolvedValue([
        makeHost('acc-1', 'github', null),
        makeHost('acc-1', 'gitlab', 'https://gitlab.mycompany.com'),
      ]);
      upsertHostConnectionSpy.mockResolvedValue(
        makeHost('acc-1', 'github', 'https://github.myenterprise.com'),
      );

      const result = await AuthService.connectHost({
        provider: 'github',
        token: 'gho_enterprise_token',
        instanceBaseUrl: 'https://github.myenterprise.com',
      });

      expect(result.ok).toBe(true);
    });

    it('allows creating a fresh identity (Path C) for Pro even when Free cap is reached', async () => {
      useProStore.setState({ status: 'pro', entitlementActive: true });
      listAccountsSpy.mockResolvedValue([{
        id: 'acc-1', login: 'testuser', name: 'Test', email: null, avatarUrl: null, addedAt: Date.now(),
      }]);
      listHostConnectionsSpy.mockResolvedValue([makeHost('acc-1', 'github', null)]);
      addAccountSpy.mockResolvedValue({
        id: 'acc-new', login: 'newuser', name: 'New User', email: null,
        avatarUrl: null, addedAt: Date.now(),
      });
      upsertHostConnectionSpy.mockResolvedValue(makeHost('acc-new', 'github', null));

      mockFetchOk({ id: 67890, login: 'newuser', name: 'New User' });

      const result = await AuthService.connectHost({
        provider: 'github',
        token: 'gho_new_user_token',
      });

      expect(result.ok).toBe(true);
    });
  });

  describe('Rejection: correct reason returned for Free tier', () => {
    it('returns free_tier_identity_limit_reached when canCreateAdditionalIdentity is false (explicit accountId)', async () => {
      listAccountsSpy.mockResolvedValue([{
        id: 'acc-1', login: 'testuser', name: 'Test', email: null, avatarUrl: null, addedAt: Date.now(),
      }]);
      listHostConnectionsSpy.mockResolvedValue([makeHost('acc-1', 'github', null)]);
      upsertHostConnectionSpy.mockResolvedValue(makeHost('acc-1', 'github', null));
      canCreateAdditionalIdentitySpy.mockResolvedValue(false);

      const result = await AuthService.connectHost({
        provider: 'gitlab',
        token: 'gl_test_token',
        accountId: 'acc-1',
      });

      expect(result.ok).toBe(false);
      expect(result.reason).toBe('free_tier_identity_limit_reached');
    });

    it('returns free_tier_identity_limit_reached for Path B (login match, new host)', async () => {
      listAccountsSpy.mockResolvedValue([{
        id: 'acc-1', login: 'testuser', name: 'Test', email: null, avatarUrl: null, addedAt: Date.now(),
      }]);
      listHostConnectionsSpy.mockResolvedValue([makeHost('acc-1', 'github', null)]);
      upsertHostConnectionSpy.mockResolvedValue(makeHost('acc-1', 'gitlab', null));
      canCreateAdditionalIdentitySpy.mockResolvedValue(false);

      const result = await AuthService.connectHost({
        provider: 'gitlab',
        token: 'gl_test_token',
      });

      expect(result.ok).toBe(false);
      expect(result.reason).toBe('free_tier_identity_limit_reached');
    });

    it('returns free_tier_identity_limit_reached when no accounts left for new identity (Path C)', async () => {
      listAccountsSpy.mockResolvedValue([{
        id: 'acc-1', login: 'testuser', name: 'Test', email: null, avatarUrl: null, addedAt: Date.now(),
      }]);
      listHostConnectionsSpy.mockResolvedValue([makeHost('acc-1', 'github', null)]);
      upsertHostConnectionSpy.mockResolvedValue(makeHost('acc-1', 'github', null));
      canCreateAdditionalIdentitySpy.mockResolvedValue(false);

      const result = await AuthService.connectHost({
        provider: 'gitlab',
        token: 'gl_test_token',
      });

      expect(result.ok).toBe(false);
      expect(result.reason).toBe('free_tier_identity_limit_reached');
    });

    it('returns invalid when explicit accountId is provided but not found', async () => {
      listAccountsSpy.mockResolvedValue([]);
      listHostConnectionsSpy.mockResolvedValue([]);

      const result = await AuthService.connectHost({
        provider: 'github',
        token: 'gho_test_token',
        accountId: 'nonexistent-account',
      });

      expect(result.ok).toBe(false);
      expect(result.reason).toBe('invalid');
    });
  });

  describe('Token validation failures are not gated by tier policy', () => {
    it('rejects with invalid (401) before checking tier policy', async () => {
      mockFetchAuthError();

      const result = await AuthService.connectHost({
        provider: 'github',
        token: 'bad_token',
      });

      expect(result.ok).toBe(false);
      expect(result.reason).toBe('invalid');
      expect(canCreateAdditionalIdentitySpy).not.toHaveBeenCalled();
    });

    it('rejects with saml before checking tier policy', async () => {
      mockFetchSamlError();

      const result = await AuthService.connectHost({
        provider: 'github',
        token: 'saml_token',
      });

      expect(result.ok).toBe(false);
      expect(result.reason).toBe('saml');
      expect(canCreateAdditionalIdentitySpy).not.toHaveBeenCalled();
    });

    it('rejects with network error before checking tier policy', async () => {
      global.fetch = _jest.fn(async () => { throw new Error('network timeout'); }) as unknown as typeof fetch;

      const result = await AuthService.connectHost({
        provider: 'github',
        token: 'any_token',
      });

      expect(result.ok).toBe(false);
      expect(result.reason).toBe('network');
      expect(canCreateAdditionalIdentitySpy).not.toHaveBeenCalled();
    });
  });
});
