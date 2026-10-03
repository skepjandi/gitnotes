/**
 * Tests for GitHubAppService.
 *
 * Covered scenarios:
 * - buildInstallUrl(): backend unreachable (503) → { ok: false, reason: 'not_configured' }
 * - buildInstallUrl(): stores pending flow with selectedRepositoryIds, backendUrl, hostId
 * - buildInstallUrl(): registers pending flow before returning installationUrl
 * - openInstallationUrl(): calls WebBrowser.openAuthSessionAsync with the app callback URL
 * - parseCallbackUrl(): callback URL with installation_id+state → { installationId, state }
 * - parseCallbackUrl(): denied URL → 'denied'
 * - parseCallbackUrl(): duplicate URL → 'duplicate'
 * - parseCallbackUrl(): unrecognized URL → null
 * - handleCallback(): owner_not_allowed (403) → { outcome: 'owner_not_allowed' }
 * - handleCallback(): backend_unreachable (503) → { outcome: 'backend_error' }
 * - handleCallback(): network error → { outcome: 'backend_error' }
 * - pendingAppFlows: entries are consumed and deleted after handleCallback
 */

import { jest, describe, it, expect } from '@jest/globals';

const TEST_BACKEND = 'https://gitnotes-backend.example.com';
const TEST_HOST_ID = 'github:user@example.com';
const TEST_INSTALLATION_URL = 'https://github.com/apps/test-app/installations/new?state=test-state';

const FAKE_ACCOUNT_APP = { id: 'acc-app-456', login: 'appuser', name: 'App User', email: '', avatarUrl: '', addedAt: Date.now(), hostIds: [] };
const FAKE_HOST_APP = { id: 'acc-app-456:github:default', accountId: 'acc-app-456', provider: 'github' as const, instanceBaseUrl: null, hostLogin: 'appuser', hostUserId: 789, name: 'App User', email: null, avatarUrl: null, addedAt: Date.now() };

/** Loads GitHubAppService fresh each time with mocks in place. */
const loadService = async () => {
  const mockPost = jest.fn<() => Promise<unknown>>();
  const mockSetGitHubAppCredential = jest.fn<() => Promise<void>>();
  const mockAddAccount = jest.fn<() => Promise<typeof FAKE_ACCOUNT_APP>>();
  const mockUpsertHostConnection = jest.fn<() => Promise<typeof FAKE_HOST_APP>>();
  const mockSetActiveAccountId = jest.fn<() => Promise<void>>();
  const mockSetActiveHostId = jest.fn<() => Promise<void>>();
  const mockGetActiveHostId = jest.fn<() => Promise<string | null>>();
  const mockClearHostToken = jest.fn<() => Promise<void>>();
  mockGetActiveHostId.mockResolvedValue(null);

  jest.doMock('expo-web-browser', () => ({
    openBrowserAsync: jest.fn(),
    openAuthSessionAsync: jest.fn(),
  }));

  jest.doMock('axios', () => ({
    default: {
      create: () => ({
        post: mockPost,
        interceptors: { request: { use: jest.fn() }, response: { use: jest.fn() } },
      }),
    },
  }));

  jest.doMock('@/services/AccountStorage', () => ({
    AccountStorage: {
      setGitHubAppCredential: mockSetGitHubAppCredential,
      addAccount: mockAddAccount,
      upsertHostConnection: mockUpsertHostConnection,
      setActiveAccountId: mockSetActiveAccountId,
      setActiveHostId: mockSetActiveHostId,
      getActiveHostId: mockGetActiveHostId,
      clearHostToken: mockClearHostToken,
    },
  }));

  jest.doMock('@/services/git/contracts', () => ({
    validateGitHubAppCredential: () => ({ valid: true }),
    isInstallationTokenExpired: () => false,
    isGrantExpired: () => false,
    hasEmptyRepositorySelection: () => false,
  }));

  // Re-require clears the module cache and returns fresh module with mocks active.
  // Using Function to bypass TS import analysis.
  const mod = await new Promise<typeof import('../../src/services/GitHubAppService')>((resolve) => {
    jest.isolateModules(() => {
      const m = require('../../src/services/GitHubAppService');
      resolve(m);
    });
  });

  return {
    mod, mockPost, mockSetGitHubAppCredential,
    mockAddAccount, mockUpsertHostConnection,
    mockSetActiveAccountId, mockSetActiveHostId, mockGetActiveHostId,
    mockClearHostToken,
  };
};

describe('GitHubAppService', () => {
  describe('buildInstallUrl()', () => {
    it('returns not_configured when backend responds with 503', async () => {
      const { mod, mockPost } = await loadService();
      mockPost.mockRejectedValueOnce({ response: { status: 503 } });

      const result = await mod.GitHubAppService.buildInstallUrl({
        backendUrl: TEST_BACKEND,
        hostId: TEST_HOST_ID,
        selectedRepositoryIds: ['1', '2'],
      });

      expect(result.ok).toBe(false);
      expect(result.reason).toBe('not_configured');
    });

    it('returns backend_unreachable when the backend reports that code in a 500 response', async () => {
      const { mod, mockPost } = await loadService();
      mockPost.mockRejectedValueOnce({
        response: {
          status: 500,
          data: { code: 'backend_unreachable', message: 'An unexpected error occurred' },
        },
      });

      const result = await mod.GitHubAppService.buildInstallUrl({
        backendUrl: TEST_BACKEND,
        hostId: TEST_HOST_ID,
        selectedRepositoryIds: [],
      });

      expect(result).toEqual({ ok: false, reason: 'backend_unreachable' });
    });

    it('stores pending flow with selectedRepositoryIds and hostId after successful call', async () => {
      const { mod, mockPost } = await loadService();
      const fakeState = 'app-install-state-12345';
      mockPost.mockResolvedValueOnce({
        data: { installation_url: TEST_INSTALLATION_URL, state: fakeState },
      });

      const repoIds = ['1', '2', '3'];
      const result = await mod.GitHubAppService.buildInstallUrl({
        backendUrl: TEST_BACKEND,
        hostId: TEST_HOST_ID,
        selectedRepositoryIds: repoIds,
      });

      expect(result.ok).toBe(true);
      expect(result.state).toBe(fakeState);

      const pending = mod.pendingAppFlows.get(fakeState);
      expect(pending).toBeDefined();
      expect(pending!.selectedRepositoryIds).toEqual(repoIds);
      expect(pending!.backendUrl).toBe(TEST_BACKEND);
      expect(pending!.hostId).toBe(TEST_HOST_ID);
    });

    it('registers pending flow before returning installationUrl on success', async () => {
      const { mod, mockPost } = await loadService();
      const fakeState = 'app-install-state-67890';
      mockPost.mockResolvedValueOnce({
        data: { installation_url: TEST_INSTALLATION_URL, state: fakeState },
      });

      const result = await mod.GitHubAppService.buildInstallUrl({
        backendUrl: TEST_BACKEND,
        hostId: TEST_HOST_ID,
        selectedRepositoryIds: ['1'],
      });

      expect(result.ok).toBe(true);
      expect(result.installationUrl).toBe(TEST_INSTALLATION_URL);
      expect(mod.pendingAppFlows.has(fakeState)).toBe(true);
    });
  });

  describe('openInstallationUrl()', () => {
    it('opens the installation URL as an auth session with the app callback URL', async () => {
      const { mod } = await loadService();
      const mockOpen = mod.WebBrowser.openAuthSessionAsync as jest.Mock;
      mockOpen.mockResolvedValueOnce({ type: 'success', url: 'gitnotes://app/callback?installation_id=1&state=state' });

      const result = await mod.GitHubAppService.openInstallationUrl(TEST_INSTALLATION_URL);

      expect(result).toEqual({
        outcome: 'callback',
        url: 'gitnotes://app/callback?installation_id=1&state=state',
      });
      expect(mockOpen).toHaveBeenCalledWith(TEST_INSTALLATION_URL, 'gitnotes://app/callback');
    });

    it('returns failed when the auth session cannot open', async () => {
      const { mod } = await loadService();
      const mockOpen = mod.WebBrowser.openAuthSessionAsync as jest.Mock;
      mockOpen.mockRejectedValueOnce(new Error('Browser not available'));

      const result = await mod.GitHubAppService.openInstallationUrl(TEST_INSTALLATION_URL);

      expect(result).toEqual({ outcome: 'failed' });
    });
  });

  describe('parseCallbackUrl()', () => {
    it('parses callback URL with installation_id and state', async () => {
      const { mod } = await loadService();
      const result = mod.GitHubAppService.parseCallbackUrl(
        'gitnotes://app/callback?installation_id=12345&state=abc123'
      );
      expect(result).toEqual({ installationId: '12345', state: 'abc123' });
    });

    it('returns denied when URL path is /app/denied (ignores any query params)', async () => {
      const { mod } = await loadService();
      const result = mod.GitHubAppService.parseCallbackUrl(
        'gitnotes://app/denied?installation_id=12345&state=abc123'
      );
      expect(result).toBe('denied');
    });

    it('returns duplicate when URL path is /app/duplicate (ignores any query params)', async () => {
      const { mod } = await loadService();
      const result = mod.GitHubAppService.parseCallbackUrl(
        'gitnotes://app/duplicate?installation_id=12345&state=abc123'
      );
      expect(result).toBe('duplicate');
    });

    it('returns null for unrecognized URL patterns', async () => {
      const { mod } = await loadService();
      const result = mod.GitHubAppService.parseCallbackUrl('gitnotes://app/unknown');
      expect(result).toBeNull();
    });

    it('returns null for callback URL missing installation_id', async () => {
      const { mod } = await loadService();
      const result = mod.GitHubAppService.parseCallbackUrl(
        'gitnotes://app/callback?state=abc123'
      );
      expect(result).toBeNull();
    });
  });

  describe('handleCallback()', () => {
    it('returns malformed when no pending flow exists for the state', async () => {
      const { mod } = await loadService();
      const result = await mod.GitHubAppService.handleCallback({
        installationId: '12345',
        state: 'nonexistent',
      });
      expect(result.outcome).toBe('malformed');
    });

    it('consumes and removes pending flow after handleCallback', async () => {
      const { mod, mockPost } = await loadService();
      const fakeState = 'callback-state-remove';
      mod.pendingAppFlows.set(fakeState, {
        selectedRepositoryIds: ['1'],
        selectedRepositories: ['owner/repo'],
        backendUrl: TEST_BACKEND,
        hostId: TEST_HOST_ID,
      });
      mockPost.mockRejectedValueOnce(new Error('network error'));

      await mod.GitHubAppService.handleCallback({ installationId: '12345', state: fakeState });

      expect(mod.pendingAppFlows.has(fakeState)).toBe(false);
    });

    it('returns owner_not_allowed when backend responds with 403', async () => {
      const { mod, mockPost } = await loadService();
      const fakeState = 'callback-state-403';
      mod.pendingAppFlows.set(fakeState, {
        selectedRepositoryIds: ['1'],
        selectedRepositories: ['owner/repo'],
        backendUrl: TEST_BACKEND,
        hostId: TEST_HOST_ID,
      });
      mockPost.mockRejectedValueOnce({
        response: { status: 403, data: { message: 'Owner not allowed' } },
      });

      const result = await mod.GitHubAppService.handleCallback({
        installationId: '12345',
        state: fakeState,
      });

      expect(result.outcome).toBe('owner_not_allowed');
    });

    it('deduplicates concurrent callback delivery for the same state', async () => {
      const { mod, mockPost } = await loadService();
      const fakeState = 'callback-state-duplicate-delivery';
      mod.pendingAppFlows.set(fakeState, {
        selectedRepositoryIds: ['1'],
        selectedRepositories: ['owner/repo'],
        backendUrl: TEST_BACKEND,
        hostId: TEST_HOST_ID,
      });
      mockPost.mockRejectedValue(new Error('network error'));

      const first = mod.GitHubAppService.handleCallback({
        installationId: '12345',
        state: fakeState,
      });
      const second = mod.GitHubAppService.handleCallback({
        installationId: '12345',
        state: fakeState,
      });
      const [firstResult, secondResult] = await Promise.all([first, second]);

      expect(mockPost).toHaveBeenCalledTimes(1);
      expect(firstResult).toEqual(secondResult);
    });

    it('returns the cached result for a sequential duplicate callback', async () => {
      const { mod, mockPost } = await loadService();
      const fakeState = 'callback-state-sequential-duplicate';
      mod.pendingAppFlows.set(fakeState, {
        selectedRepositoryIds: ['1'],
        selectedRepositories: ['owner/repo'],
        backendUrl: TEST_BACKEND,
        hostId: TEST_HOST_ID,
      });
      mockPost.mockRejectedValueOnce(new Error('network error'));

      const firstResult = await mod.GitHubAppService.handleCallback({
        installationId: '12345',
        state: fakeState,
      });
      const secondResult = await mod.GitHubAppService.handleCallback({
        installationId: '12345',
        state: fakeState,
      });

      expect(mockPost).toHaveBeenCalledTimes(1);
      expect(secondResult).toEqual(firstResult);
    });

    it('returns backend_error when backend responds with 503', async () => {
      const { mod, mockPost } = await loadService();
      const fakeState = 'callback-state-503';
      mod.pendingAppFlows.set(fakeState, {
        selectedRepositoryIds: ['1'],
        selectedRepositories: ['owner/repo'],
        backendUrl: TEST_BACKEND,
        hostId: TEST_HOST_ID,
      });
      mockPost.mockRejectedValueOnce({ response: { status: 503 } });

      const result = await mod.GitHubAppService.handleCallback({
        installationId: '12345',
        state: fakeState,
      });

      expect(result.outcome).toBe('backend_error');
    });

    it('returns backend_unreachable when callback backend reports that code in a 500 response', async () => {
      const { mod, mockPost } = await loadService();
      const fakeState = 'callback-state-500';
      mod.pendingAppFlows.set(fakeState, {
        selectedRepositoryIds: ['1'],
        selectedRepositories: ['owner/repo'],
        backendUrl: TEST_BACKEND,
        hostId: TEST_HOST_ID,
      });
      mockPost.mockRejectedValueOnce({
        response: {
          status: 500,
          data: { code: 'backend_unreachable', message: 'An unexpected error occurred' },
        },
      });

      const result = await mod.GitHubAppService.handleCallback({
        installationId: '12345',
        state: fakeState,
      });

      expect(result).toEqual({
        outcome: 'backend_error',
        code: 'backend_unreachable',
        message: 'An unexpected error occurred',
      });
    });

    it('returns backend_error on network error', async () => {
      const { mod, mockPost } = await loadService();
      const fakeState = 'callback-state-neterror';
      mod.pendingAppFlows.set(fakeState, {
        selectedRepositoryIds: ['1'],
        selectedRepositories: ['owner/repo'],
        backendUrl: TEST_BACKEND,
        hostId: TEST_HOST_ID,
      });
      mockPost.mockRejectedValueOnce(new Error('ENOTFOUND'));

      const result = await mod.GitHubAppService.handleCallback({
        installationId: '12345',
        state: fakeState,
      });

      expect(result.outcome).toBe('backend_error');
    });

    it('stores credential and removes pending flow on successful callback', async () => {
      const { mod, mockPost, mockSetGitHubAppCredential } = await loadService();
      const fakeState = 'callback-state-success';
      mod.pendingAppFlows.set(fakeState, {
        selectedRepositoryIds: ['1', '2'],
        selectedRepositories: ['owner/repo1', 'owner/repo2'],
        backendUrl: TEST_BACKEND,
        hostId: TEST_HOST_ID,
      });
      mockPost.mockResolvedValueOnce({
        data: {
          installation_id: 99999,
          app_id: 123456,
          app_slug: 'test-app',
          account_login: 'testuser',
          account_id: 789,
          account_avatar_url: 'https://avatars.githubusercontent.com/u/789',
          token: 'installation-token-abc',
          expires_at: Date.now() + 3600000,
          renewal_grant_token: 'grant-token-xyz',
          renewal_grant_expires_at: Date.now() + 86400000,
          repositories: [
            { owner: 'owner', repo: 'repo1' },
            { owner: 'owner', repo: 'repo2' },
          ],
        },
      });

      const result = await mod.GitHubAppService.handleCallback({
        installationId: '99999',
        state: fakeState,
      });

      expect(result.outcome).toBe('success');
      expect(result).toHaveProperty('credential');
      expect(mod.pendingAppFlows.has(fakeState)).toBe(false);
      expect(mockSetGitHubAppCredential).toHaveBeenCalledTimes(1);
      const stored = mockSetGitHubAppCredential.mock.calls[0];
      expect(stored[0]).toBe(TEST_HOST_ID);
      expect(stored[1].hostId).toBe(TEST_HOST_ID);
      expect(stored[1].installationId).toBe(99999);
      expect(stored[1].appId).toBe(123456);
      expect(stored[1].token).toBe('installation-token-abc');
      expect(stored[1].selectedRepositories).toEqual([
        { owner: 'owner', repo: 'repo1' },
        { owner: 'owner', repo: 'repo2' },
      ]);
      expect(stored[1].accountAvatarUrl).toBe('https://avatars.githubusercontent.com/u/789');
    });

    it('removes pending flow and returns duplicate when backend returns 409', async () => {
      const { mod, mockPost } = await loadService();
      const fakeState = 'callback-state-dup';
      mod.pendingAppFlows.set(fakeState, {
        selectedRepositoryIds: ['1'],
        selectedRepositories: ['owner/repo'],
        backendUrl: TEST_BACKEND,
        hostId: TEST_HOST_ID,
      });
      mockPost.mockRejectedValueOnce({
        response: { status: 400, data: { code: 'duplicate', message: 'already installed' } },
      });

      const result = await mod.GitHubAppService.handleCallback({
        installationId: '12345',
        state: fakeState,
      });

      expect(result.outcome).toBe('duplicate');
      expect(result.code).toBe('duplicate');
      expect(mod.pendingAppFlows.has(fakeState)).toBe(false);
    });
  });

  describe('first-time App install (null hostId)', () => {
    it('buildInstallUrl() accepts hostId: null and stores null in pending flow', async () => {
      const { mod, mockPost } = await loadService();
      const fakeState = 'app-null-host-state';
      mockPost.mockResolvedValueOnce({
        data: { installation_url: TEST_INSTALLATION_URL, state: fakeState },
      });

      const result = await mod.GitHubAppService.buildInstallUrl({
        backendUrl: TEST_BACKEND,
        hostId: null as unknown as string,
        selectedRepositoryIds: ['1', '2'],
      });

      expect(result.ok).toBe(true);
      const pending = mod.pendingAppFlows.get(fakeState);
      expect(pending).toBeDefined();
      expect(pending!.hostId).toBeNull();
    });

    it('handleCallback() with null hostId creates account, host connection, and stores App credential under resolved hostId', async () => {
      const {
        mod, mockPost, mockAddAccount, mockUpsertHostConnection,
        mockSetActiveAccountId, mockSetActiveHostId, mockGetActiveHostId, mockSetGitHubAppCredential, mockClearHostToken,
      } = await loadService();

      const fakeState = 'callback-state-null-host';
      mod.pendingAppFlows.set(fakeState, {
        selectedRepositoryIds: ['1'],
        selectedRepositories: ['owner/repo'],
        backendUrl: TEST_BACKEND,
        hostId: null,
      });

      mockPost.mockResolvedValueOnce({
        data: {
          installation_id: 111222,
          app_id: 654321,
          app_slug: 'my-app',
          account_login: 'appuser',
          account_id: 333,
          account_avatar_url: 'https://avatars.githubusercontent.com/u/333',
          token: 'installation-token-null-host',
          expires_at: Date.now() + 3600000,
          renewal_grant_token: 'grant-null-host',
          renewal_grant_expires_at: Date.now() + 86400000,
        },
      });
      mockAddAccount.mockResolvedValue(FAKE_ACCOUNT_APP);
      mockUpsertHostConnection.mockResolvedValue(FAKE_HOST_APP);
      mockGetActiveHostId.mockResolvedValue(null);

      const result = await mod.GitHubAppService.handleCallback({
        installationId: '111222',
        state: fakeState,
      });

      expect(result.outcome).toBe('success');
      expect(mockAddAccount).toHaveBeenCalledWith('installation-token-null-host', expect.objectContaining({
        login: 'appuser',
        name: 'appuser',
        avatarUrl: 'https://avatars.githubusercontent.com/u/333',
      }));
      expect(mockUpsertHostConnection).toHaveBeenCalledWith(expect.objectContaining({
        accountId: 'acc-app-456',
        provider: 'github',
        instanceBaseUrl: null,
        hostLogin: 'appuser',
        hostUserId: 333,
        token: 'installation-token-null-host',
        avatarUrl: 'https://avatars.githubusercontent.com/u/333',
      }));
      expect(mockSetActiveAccountId).toHaveBeenCalledWith('acc-app-456');
      expect(mockSetActiveHostId).toHaveBeenCalledWith('acc-app-456:github:default');
      expect(mockSetGitHubAppCredential).toHaveBeenCalledWith('acc-app-456:github:default', expect.objectContaining({
        kind: 'github_app',
        accountLogin: 'appuser',
        accountId: 333,
        installationId: 111222,
        accountAvatarUrl: 'https://avatars.githubusercontent.com/u/333',
      }));
      expect(mockClearHostToken).toHaveBeenCalledWith('acc-app-456:github:default');
    });

    it('handleCallback() with null hostId does not set active account/host when one already exists', async () => {
      const {
        mod, mockPost, mockAddAccount, mockUpsertHostConnection,
        mockSetActiveAccountId, mockSetActiveHostId, mockGetActiveHostId, mockSetGitHubAppCredential,
      } = await loadService();

      const fakeState = 'callback-state-null-host-existing';
      mod.pendingAppFlows.set(fakeState, {
        selectedRepositoryIds: ['1'],
        selectedRepositories: ['owner/repo'],
        backendUrl: TEST_BACKEND,
        hostId: null,
      });

      mockPost.mockResolvedValueOnce({
        data: {
          installation_id: 222333,
          app_id: 777888,
          app_slug: 'another-app',
          account_login: 'anotheruser',
          account_id: 444,
          account_avatar_url: 'https://avatars.githubusercontent.com/u/444',
          token: 'token-another',
          expires_at: Math.floor(Date.now() / 1000) + 3600,
          renewal_grant_token: 'grant-another',
          renewal_grant_expires_at: Math.floor(Date.now() / 1000) + 86400,
        },
      });
      mockAddAccount.mockResolvedValue(FAKE_ACCOUNT_APP);
      mockUpsertHostConnection.mockResolvedValue(FAKE_HOST_APP);
      mockGetActiveHostId.mockResolvedValue('existing-active-host');

      const result = await mod.GitHubAppService.handleCallback({
        installationId: '222333',
        state: fakeState,
      });

      expect(result.outcome).toBe('success');
      expect(mockSetActiveAccountId).not.toHaveBeenCalled();
      expect(mockSetActiveHostId).not.toHaveBeenCalled();
      expect(mockSetGitHubAppCredential).toHaveBeenCalledWith('acc-app-456:github:default', expect.objectContaining({
        kind: 'github_app',
        accountAvatarUrl: 'https://avatars.githubusercontent.com/u/444',
      }));
    });
  });
});
