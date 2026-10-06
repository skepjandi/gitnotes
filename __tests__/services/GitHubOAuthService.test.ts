/**
 * Tests for GitHubOAuthService.
 */

import { jest, describe, it, expect } from '@jest/globals';

const TEST_BACKEND = 'https://gitnotes-backend.example.com';
const TEST_CLIENT_ID = 'Iv1.test-client-id';
const TEST_HOST_ID = 'github:user@example.com';
const TEST_REDIRECT_URI = 'gitnotes://oauth/callback';

const FAKE_ACCOUNT = { id: 'acc-123', login: 'testuser', name: 'Test User', email: 'test@example.com', avatarUrl: 'https://example.com/avatar.png', addedAt: Date.now(), hostIds: [] };
const FAKE_HOST = { id: 'acc-123:github:default', accountId: 'acc-123', provider: 'github' as const, instanceBaseUrl: null, hostLogin: 'testuser', hostUserId: 123, name: 'Test User', email: 'test@example.com', avatarUrl: 'https://example.com/avatar.png', addedAt: Date.now() };

const mockCanCreate = jest.fn<() => Promise<boolean>>();
mockCanCreate.mockResolvedValue(true);

jest.mock('@/services/TierLimits', () => ({
  canCreateAdditionalIdentity: mockCanCreate,
  enforceTierLimits: async () => {},
}));

const loadService = async () => {
  const mockPost = jest.fn<() => Promise<unknown>>();
  const mockGetRandomBytesAsync = jest.fn<() => Promise<string>>();
  const mockDigestStringAsync = jest.fn<() => Promise<string>>();
  const mockOpenAuthSessionAsync = jest.fn<() => Promise<{ type: string; url?: string }>>();
  const mockAddAccount = jest.fn<() => Promise<typeof FAKE_ACCOUNT>>();
  const mockUpsertHostConnection = jest.fn<() => Promise<typeof FAKE_HOST>>();
  const mockSetActiveAccountId = jest.fn<() => Promise<void>>();
  const mockSetActiveHostId = jest.fn<() => Promise<void>>();
  const mockGetActiveHostId = jest.fn<() => Promise<string | null>>();
  const mockSetOAuthCredential = jest.fn<() => Promise<void>>();
  const mockUpdateHostProfile = jest.fn<() => Promise<void>>();
  const mockListAccounts = jest.fn<() => Promise<{ id: string }[]>>();
  const uuid = { current: 'test-state-abc' };

  mockCanCreate.mockReset();
  mockCanCreate.mockResolvedValue(true);
  mockGetActiveHostId.mockResolvedValue(null);
  mockListAccounts.mockResolvedValue([]);

  const mod = await new Promise<typeof import('../../src/services/GitHubOAuthService')>((resolve) => {
    jest.isolateModules(() => {
      jest.doMock('@/services/TierLimits', () => ({
        canCreateAdditionalIdentity: mockCanCreate,
        enforceTierLimits: async () => {},
      }));
      jest.doMock('@/services/AccountStorage', () => ({
        AccountStorage: {
          addAccount: mockAddAccount,
          upsertHostConnection: mockUpsertHostConnection,
          setActiveAccountId: mockSetActiveAccountId,
          setActiveHostId: mockSetActiveHostId,
          getActiveHostId: mockGetActiveHostId,
          setOAuthCredential: mockSetOAuthCredential,
          updateHostProfile: mockUpdateHostProfile,
          listAccounts: mockListAccounts,
        },
      }));

      jest.doMock('@/services/git/contracts', () => ({
        validateOAuthCredential: () => ({ valid: true }),
        isOAuthExpired: () => false,
        isRefreshExpired: () => false,
      }));

      jest.doMock('axios', () => ({
        default: {
          create: () => ({
            post: mockPost,
            interceptors: { request: { use: jest.fn() }, response: { use: jest.fn() } },
          }),
        },
      }));

      jest.doMock('expo-crypto', () => ({
        getRandomBytesAsync: mockGetRandomBytesAsync,
        digestStringAsync: mockDigestStringAsync,
        CryptoDigestAlgorithm: { SHA256: 'SHA256' },
        CryptoEncoding: { BASE64: 'base64' },
        randomUUID: () => uuid.current,
      }));

      jest.doMock('expo-web-browser', () => ({
        openAuthSessionAsync: mockOpenAuthSessionAsync,
      }));

      const m = require('../../src/services/GitHubOAuthService');
      const mockGet = jest.fn<() => Promise<unknown>>();
      m.setHttpClient({ post: mockPost, get: mockGet });

      resolve(m);
    });
  });

  return {
    mod, mockPost, mockGetRandomBytesAsync, mockDigestStringAsync, mockOpenAuthSessionAsync,
    mockAddAccount, mockUpsertHostConnection, mockSetActiveAccountId, mockSetActiveHostId,
    mockGetActiveHostId, mockSetOAuthCredential, mockUpdateHostProfile, mockListAccounts,
    mockCanCreate,
    pendingOAuthFlows: mod.pendingOAuthFlows,
    setUuid: (s: string) => { uuid.current = s; },
  };
};

describe('GitHubOAuthService', () => {
  describe('initiate()', () => {
    it('returns backend_unreachable when backend responds with 503', async () => {
      const { mod, mockPost, mockGetRandomBytesAsync, mockDigestStringAsync } = await loadService();
      mockGetRandomBytesAsync.mockResolvedValue('test-verifier');
      mockDigestStringAsync.mockResolvedValue('sha-256-test');
      mockPost.mockRejectedValueOnce({ response: { status: 503 } });

      const result = await mod.GitHubOAuthService.initiate({
        backendUrl: TEST_BACKEND,
        hostId: TEST_HOST_ID,
        clientId: TEST_CLIENT_ID,
        redirectUri: TEST_REDIRECT_URI,
      });

      expect(result.ok).toBe(false);
      expect(result.reason).toBe('backend_unreachable');
    });

    it('returns network_error when request fails without HTTP status', async () => {
      const { mod, mockPost, mockGetRandomBytesAsync, mockDigestStringAsync } = await loadService();
      mockGetRandomBytesAsync.mockResolvedValue('test-verifier');
      mockDigestStringAsync.mockResolvedValue('sha-256-test');
      mockPost.mockRejectedValueOnce(new Error('ENOTFOUND'));

      const result = await mod.GitHubOAuthService.initiate({
        backendUrl: TEST_BACKEND,
        hostId: TEST_HOST_ID,
        clientId: TEST_CLIENT_ID,
        redirectUri: TEST_REDIRECT_URI,
      });

      expect(result.ok).toBe(false);
      expect(result.reason).toBe('network_error');
    });

    it('stores pending flow with correct fields after successful initiate', async () => {
      const { mod, mockPost, mockGetRandomBytesAsync, mockDigestStringAsync } = await loadService();
      mockGetRandomBytesAsync.mockResolvedValue(new Uint8Array([116, 101, 115, 116, 45, 118, 101, 114, 105, 102, 105, 101, 114, 45, 49, 50, 51]));
      mockDigestStringAsync.mockResolvedValue('sha-256-verifier-hash');
      mockPost.mockResolvedValueOnce({
        data: {
          authorization_url:
            'https://github.com/login/oauth/authorize?client_id=Iv1.test&redirect_uri=gitnotes://oauth/callback&state=test-state-abc',
          state: 'test-state-abc',
        },
      });

      const result = await mod.GitHubOAuthService.initiate({
        backendUrl: TEST_BACKEND,
        hostId: TEST_HOST_ID,
        clientId: TEST_CLIENT_ID,
        redirectUri: TEST_REDIRECT_URI,
      });

      expect(result.ok).toBe(true);
      expect(mockPost).toHaveBeenCalledWith(
        `${TEST_BACKEND}/api/v1/oauth/initiate`,
        expect.objectContaining({ scopes: ['read:user', 'user:email', 'repo'] }),
        expect.anything(),
      );

      const pending = mod.pendingOAuthFlows.get('test-state-abc');
      expect(pending).toBeDefined();
      expect(pending!.backendUrl).toBe(TEST_BACKEND);
      expect(pending!.redirectUri).toBe(TEST_REDIRECT_URI);
      expect(pending!.clientId).toBe(TEST_CLIENT_ID);
      expect(pending!.hostId).toBe(TEST_HOST_ID);
    });

    it('registers pending flow and returns authorizationUrl on success', async () => {
      const { mod, mockPost, mockGetRandomBytesAsync, mockDigestStringAsync, setUuid } = await loadService();
      setUuid('oauth-state-xyz');
      mockGetRandomBytesAsync.mockResolvedValue('verifier-xyz');
      mockDigestStringAsync.mockResolvedValue('sha-256-xyz');
      mockPost.mockResolvedValueOnce({
        data: {
          authorization_url:
            'https://github.com/login/oauth/authorize?client_id=Iv1.test&redirect_uri=gitnotes://oauth/callback&state=oauth-state-xyz',
          state: 'oauth-state-xyz',
        },
      });

      const result = await mod.GitHubOAuthService.initiate({
        backendUrl: TEST_BACKEND,
        hostId: TEST_HOST_ID,
        clientId: TEST_CLIENT_ID,
        redirectUri: TEST_REDIRECT_URI,
      });

      expect(result.ok).toBe(true);
      expect(result.authorizationUrl).toContain('github.com/login/oauth/authorize');
      expect(mod.pendingOAuthFlows.has('oauth-state-xyz')).toBe(true);
    });

    it('forwards explicit scopes without replacing them with defaults', async () => {
      const { mod, mockPost, mockGetRandomBytesAsync, mockDigestStringAsync } = await loadService();
      mockGetRandomBytesAsync.mockResolvedValue('verifier-custom-scope');
      mockDigestStringAsync.mockResolvedValue('sha-256-custom-scope');
      mockPost.mockResolvedValueOnce({
        data: {
          authorization_url: 'https://github.com/login/oauth/authorize',
          state: 'custom-scope-state',
        },
      });

      await mod.GitHubOAuthService.initiate({
        backendUrl: TEST_BACKEND,
        hostId: TEST_HOST_ID,
        clientId: TEST_CLIENT_ID,
        redirectUri: TEST_REDIRECT_URI,
        scopes: ['read:user'],
      });

      expect(mockPost).toHaveBeenCalledWith(
        `${TEST_BACKEND}/api/v1/oauth/initiate`,
        expect.objectContaining({ scopes: ['read:user'] }),
        expect.anything(),
      );
    });
  });

  describe('openAuthorizationUrl()', () => {
    it('returns the callback URL from the auth session', async () => {
      const { mod, mockOpenAuthSessionAsync } = await loadService();
      mockOpenAuthSessionAsync.mockResolvedValueOnce({
        type: 'success',
        url: 'gitnotes://oauth/callback?code=oauth-code&state=oauth-state',
      });

      const result = await mod.GitHubOAuthService.openAuthorizationUrl(
        'https://github.com/login/oauth/authorize?client_id=Iv1.test',
        TEST_REDIRECT_URI,
      );

      expect(result).toEqual({
        outcome: 'callback',
        url: 'gitnotes://oauth/callback?code=oauth-code&state=oauth-state',
      });
      expect(mockOpenAuthSessionAsync).toHaveBeenCalledWith(
        'https://github.com/login/oauth/authorize?client_id=Iv1.test',
        TEST_REDIRECT_URI,
      );
    });

    it('returns cancelled when the auth session is dismissed', async () => {
      const { mod, mockOpenAuthSessionAsync } = await loadService();
      mockOpenAuthSessionAsync.mockResolvedValueOnce({ type: 'cancel' });

      await expect(mod.GitHubOAuthService.openAuthorizationUrl(
        'https://github.com/login/oauth/authorize?client_id=Iv1.test',
        TEST_REDIRECT_URI,
      )).resolves.toEqual({ outcome: 'cancelled' });
    });
  });

  describe('exchangeCode()', () => {
    it('returns state_mismatch when backend returns exchange_denied error code', async () => {
      const { mod, mockPost, mockGetRandomBytesAsync, mockDigestStringAsync } = await loadService();
      mockGetRandomBytesAsync.mockResolvedValue('verifier-abc');
      mockDigestStringAsync.mockResolvedValue('sha-256-abc');

      mod.pendingOAuthFlows.set('state-abc', {
        verifier: 'verifier-abc',
        backendUrl: TEST_BACKEND,
        redirectUri: TEST_REDIRECT_URI,
        clientId: TEST_CLIENT_ID,
        hostId: TEST_HOST_ID,
      });

      mockPost.mockRejectedValueOnce({
        response: { status: 400, data: { code: 'exchange_denied', message: 'User cancelled' } },
      });

      const result = await mod.GitHubOAuthService.exchangeCode({
        code: 'auth-code-123',
        state: 'state-abc',
      });

      expect(result.outcome).toBe('backend_error');
      expect(result.code).toBe('exchange_denied');
    });

    it('removes pending flow after exchangeCode is called', async () => {
      const { mod, mockPost, mockGetRandomBytesAsync, mockDigestStringAsync } = await loadService();
      mockGetRandomBytesAsync.mockResolvedValue('verifier-abc');
      mockDigestStringAsync.mockResolvedValue('sha-256-abc');

      mod.pendingOAuthFlows.set('state-abc', {
        verifier: 'verifier-abc',
        backendUrl: TEST_BACKEND,
        redirectUri: TEST_REDIRECT_URI,
        clientId: TEST_CLIENT_ID,
        hostId: TEST_HOST_ID,
      });

      mockPost.mockRejectedValueOnce(new Error('network error'));

      const result = await mod.GitHubOAuthService.exchangeCode({
        code: 'auth-code-123',
        codeVerifier: 'verifier-abc',
        state: 'state-abc',
        redirectUri: TEST_REDIRECT_URI,
        clientId: TEST_CLIENT_ID,
        backendUrl: TEST_BACKEND,
        hostId: TEST_HOST_ID,
      });

      expect(result.outcome).toBe('backend_error');
      expect(result.code).toBe('network_error');
      expect(mod.pendingOAuthFlows.has('state-abc')).toBe(false);
    });

    it('returns backend_unreachable when exchange responds with HTTP 500', async () => {
      const { mod, mockPost } = await loadService();
      const fakeState = 'state-http-500';
      mod.pendingOAuthFlows.set(fakeState, {
        verifier: 'verifier-http-500',
        backendUrl: TEST_BACKEND,
        redirectUri: TEST_REDIRECT_URI,
        clientId: TEST_CLIENT_ID,
        hostId: TEST_HOST_ID,
      });
      mockPost.mockRejectedValueOnce({ response: { status: 500 } });

      const result = await mod.GitHubOAuthService.exchangeCode({
        code: 'auth-code-500',
        codeVerifier: 'verifier-http-500',
        state: fakeState,
        redirectUri: TEST_REDIRECT_URI,
        clientId: TEST_CLIENT_ID,
        backendUrl: TEST_BACKEND,
        hostId: TEST_HOST_ID,
      });

      expect(result).toEqual({
        outcome: 'backend_error',
        code: 'backend_unreachable',
        message: 'Backend service unavailable',
      });
    });
  });

  describe('first-time OAuth (null hostId)', () => {
    it('initiate() accepts hostId: null and stores null in pending flow', async () => {
      const { mod, mockPost, mockGetRandomBytesAsync, mockDigestStringAsync, setUuid } = await loadService();
      setUuid('oauth-state-null-host');
      mockGetRandomBytesAsync.mockResolvedValue('verifier-null');
      mockDigestStringAsync.mockResolvedValue('sha-256-null');
      mockPost.mockResolvedValueOnce({
        data: {
          authorization_url: 'https://github.com/login/oauth/authorize?client_id=Iv1.test&redirect_uri=gitnotes://oauth/callback&state=oauth-state-null-host',
          state: 'oauth-state-null-host',
        },
      });

      const result = await mod.GitHubOAuthService.initiate({
        backendUrl: TEST_BACKEND,
        hostId: null as unknown as string,
        clientId: TEST_CLIENT_ID,
        redirectUri: TEST_REDIRECT_URI,
      });

      expect(result.ok).toBe(true);
      const pending = mod.pendingOAuthFlows.get('oauth-state-null-host');
      expect(pending).toBeDefined();
      expect(pending!.hostId).toBeNull();
    });

    it('exchangeCode() with null hostId creates account, host connection, and stores OAuth credential under resolved hostId', async () => {
      const {
        mod, mockPost, mockAddAccount, mockUpsertHostConnection,
        mockSetActiveAccountId, mockSetActiveHostId, mockGetActiveHostId, mockSetOAuthCredential,
        mockUpdateHostProfile,
      } = await loadService();

      mod.pendingOAuthFlows.set('state-first-oauth', {
        verifier: 'verifier-first',
        backendUrl: TEST_BACKEND,
        redirectUri: TEST_REDIRECT_URI,
        clientId: TEST_CLIENT_ID,
        hostId: null,
      });

      mockPost.mockResolvedValueOnce({
        data: {
          login: 'firstuser',
          user_id: 456,
          access_token: 'access-token-first',
          expires_at: Date.now() + 3600000,
          refresh_token: 'refresh-token-first',
          refresh_expires_at: Date.now() + 86400000,
        },
      });
      mockAddAccount.mockResolvedValue(FAKE_ACCOUNT);
      mockUpsertHostConnection.mockResolvedValue(FAKE_HOST);
      mockGetActiveHostId.mockResolvedValue(null);

      const result = await mod.GitHubOAuthService.exchangeCode({
        code: 'auth-code-first',
        codeVerifier: 'verifier-first',
        state: 'state-first-oauth',
        redirectUri: TEST_REDIRECT_URI,
        clientId: TEST_CLIENT_ID,
        backendUrl: TEST_BACKEND,
        hostId: null,
      });

      expect(result.outcome).toBe('success');
      expect(mockAddAccount).toHaveBeenCalledWith(null, expect.objectContaining({
        login: 'firstuser',
        name: 'firstuser',
      }));
      expect(mockUpsertHostConnection).toHaveBeenCalledWith(expect.objectContaining({
        accountId: 'acc-123',
        provider: 'github',
        instanceBaseUrl: null,
        hostLogin: 'firstuser',
        hostUserId: 456,
      }));
      expect(mockUpsertHostConnection.mock.calls[0][0]).not.toHaveProperty('token');
      expect(mockSetActiveAccountId).toHaveBeenCalledWith('acc-123');
      expect(mockSetActiveHostId).toHaveBeenCalledWith('acc-123:github:default');
      expect(mockUpdateHostProfile).toHaveBeenCalledWith('acc-123:github:default', expect.objectContaining({
        name: 'firstuser',
        email: null,
        avatarUrl: null,
         hostLogin: 'firstuser',
      }));
      expect(mockSetOAuthCredential).toHaveBeenCalledWith('acc-123:github:default', expect.objectContaining({
        kind: 'oauth',
        login: 'firstuser',
        userId: 456,
      }));
    });

    it('exchangeCode() with existing active host does not set active account/host when one already exists', async () => {
      const {
        mod, mockPost, mockAddAccount, mockUpsertHostConnection,
        mockSetActiveAccountId, mockSetActiveHostId, mockGetActiveHostId, mockSetOAuthCredential,
      } = await loadService();

      mod.pendingOAuthFlows.set('state-first-oauth-active', {
        verifier: 'verifier-first-2',
        backendUrl: TEST_BACKEND,
        redirectUri: TEST_REDIRECT_URI,
        clientId: TEST_CLIENT_ID,
        hostId: null,
      });

      mockPost.mockResolvedValueOnce({
        data: {
          login: 'seconduser',
          user_id: 789,
          access_token: 'access-token-second',
          expires_at: Date.now() + 3600000,
          refresh_token: 'refresh-token-second',
          refresh_expires_at: Date.now() + 86400000,
        },
      });
      mockAddAccount.mockResolvedValue(FAKE_ACCOUNT);
      mockUpsertHostConnection.mockResolvedValue(FAKE_HOST);
      mockGetActiveHostId.mockResolvedValue('existing-host-id');

      const result = await mod.GitHubOAuthService.exchangeCode({
        code: 'auth-code-second',
        codeVerifier: 'verifier-first-2',
        state: 'state-first-oauth-active',
        redirectUri: TEST_REDIRECT_URI,
        clientId: TEST_CLIENT_ID,
        backendUrl: TEST_BACKEND,
        hostId: null,
      });

      expect(result.outcome).toBe('success');
      expect(mockSetActiveAccountId).not.toHaveBeenCalled();
      expect(mockSetActiveHostId).not.toHaveBeenCalled();
      expect(mockSetOAuthCredential).toHaveBeenCalledWith('acc-123:github:default', expect.objectContaining({
        kind: 'oauth',
      }));
    });
  });

});
