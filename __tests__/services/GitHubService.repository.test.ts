/**
 * Focused tests for GitHubService.createRepository()
 *
 * Covers:
 * - Typed success identity (id, node_id, name, full_name, owner, private, default_branch, html_url, description)
 * - Exact POST URL and body ({ name, private:true, auto_init:true })
 * - OAuth-only token resolution when singleton token is absent
 * - Missing auth throws 'GitHub token is not configured'
 * - HTTP 401/403/422 propagation with status attached
 * - Network rejection (no status) re-thrown as-is
 */

import http from '@/services/http';
import AuthService from '@/services/AuthService';
import { AccountStorage } from '@/services/AccountStorage';
import { GitHubService } from '@/services/GitHubService';

jest.mock('@/services/http');
jest.mock('@/services/AuthService');
jest.mock('@/services/AccountStorage');

const mockHttp = http as jest.Mocked<typeof http>;
const mockAuthService = AuthService as jest.Mocked<typeof AuthService>;
const mockAccountStorage = AccountStorage as jest.Mocked<typeof AccountStorage>;

jest.spyOn(console, 'warn').mockReturnValue();

function makeOAuthCredential(accessToken = 'gho_oauth_token') {
  return {
    id: 'oauth-cred-1',
    hostId: 'host-1',
    kind: 'oauth' as const,
    addedAt: Date.now(),
    accessToken,
    tokenType: 'bearer',
    scope: 'repo,user',
  };
}

function makeGitHubCreatedRepository(overrides: Partial<{
  id: number;
  node_id: string;
  name: string;
  full_name: string;
  owner: { login: string; id: number };
  private: boolean;
  default_branch: string;
  html_url: string;
  description: string;
}> = {}) {
  return {
    id: 12345678,
    node_id: 'R_kgDOExample',
    name: 'my-notes-repo',
    full_name: 'test-user/my-notes-repo',
    owner: { login: 'test-user', id: 999999 },
    private: true,
    default_branch: 'main',
    html_url: 'https://github.com/test-user/my-notes-repo',
    description: '',
    ...overrides,
  };
}

async function setupSingletonToken() {
  mockAuthService.connectHost.mockResolvedValue({
    ok: true,
    account: { id: 'acc-1', provider: 'github' } as never,
    host: { id: 'host-1' } as never,
  });
  const fakeUser = {
    login: 'test-user',
    id: 999999,
    avatar_url: '',
    html_url: 'https://github.com/test-user',
    name: 'Test User',
    email: 'test@example.com',
  };
  await GitHubService.setToken('gho_singleton_pat', fakeUser);
}

describe('GitHubService.createRepository()', () => {
  beforeEach(async () => {
    jest.clearAllMocks();
    mockAuthService.getToken.mockResolvedValue(null);
    mockAuthService.listAccountSummaries.mockResolvedValue([]);
    mockAuthService.connectHost.mockResolvedValue({ ok: false, reason: 'invalid' });
    mockAccountStorage.getOAuthCredential.mockResolvedValue(null);
    mockAccountStorage.getActiveHostConnection.mockResolvedValue(null);
    await GitHubService.clearToken();
  });

  describe('successful repository creation', () => {
    it('returns typed GitHubCreatedRepository with all identity fields', async () => {
      await setupSingletonToken();
      const repo = makeGitHubCreatedRepository();
      mockHttp.request.mockResolvedValue({ data: repo });

      const result = await GitHubService.createRepository({ name: 'my-notes-repo' });

      expect(result).toMatchObject({
        id: repo.id,
        node_id: repo.node_id,
        name: repo.name,
        full_name: repo.full_name,
        owner: { login: repo.owner.login, id: repo.owner.id },
        private: repo.private,
        default_branch: repo.default_branch,
        html_url: repo.html_url,
        description: repo.description,
      });
    });

    it('posts exact URL https://api.github.com/user/repos', async () => {
      await setupSingletonToken();
      mockHttp.request.mockResolvedValue({ data: makeGitHubCreatedRepository() });

      await GitHubService.createRepository({ name: 'my-notes-repo' });

      expect(mockHttp.request).toHaveBeenCalledTimes(1);
      const [callArgs] = mockHttp.request.mock.calls;
      expect(callArgs[0].url).toBe('https://api.github.com/user/repos');
      expect(callArgs[0].method).toBe('POST');
    });

    it('sends name, private:true, and auto_init:true in request body', async () => {
      await setupSingletonToken();
      mockHttp.request.mockResolvedValue({ data: makeGitHubCreatedRepository() });

      await GitHubService.createRepository({ name: 'my-private-repo' });

      const [callArgs] = mockHttp.request.mock.calls;
      expect(callArgs[0].data).toEqual({
        name: 'my-private-repo',
        private: true,
        auto_init: true,
      });
    });

    it('passes singleton token as authOverride when available', async () => {
      await setupSingletonToken();
      mockHttp.request.mockResolvedValue({ data: makeGitHubCreatedRepository() });

      await GitHubService.createRepository({ name: 'test-repo' });

      const [callArgs] = mockHttp.request.mock.calls;
      expect(callArgs[0].authOverride).toBe('gho_singleton_pat');
    });
  });

  describe('OAuth-only token resolution', () => {
    it('resolves OAuth token when singleton token is absent', async () => {
      const oauthCred = makeOAuthCredential('gho_oauth_access_token');
      mockAuthService.listAccountSummaries.mockResolvedValue([
        {
          account: {} as never,
          activeHostId: 'github-host-1',
          hosts: [
            {
              id: 'github-host-1',
              accountId: 'acc-1',
              provider: 'github',
              hostLogin: 'test-user',
              hostUserId: 999999,
              name: 'Test User',
              email: null,
              avatarUrl: null,
              instanceBaseUrl: null,
              addedAt: 1,
            },
          ],
        },
      ]);
      mockAccountStorage.getOAuthCredential.mockResolvedValue(oauthCred);

      mockHttp.request.mockResolvedValue({ data: makeGitHubCreatedRepository() });

      await GitHubService.createRepository({ name: 'oauth-repo' });

      const [callArgs] = mockHttp.request.mock.calls;
      expect(callArgs[0].authOverride).toBe('gho_oauth_access_token');
    });

    it('prefers singleton token over OAuth when both are present', async () => {
      await setupSingletonToken();
      const oauthCred = makeOAuthCredential('gho_oauth_access_token');
      mockAccountStorage.getOAuthCredential.mockResolvedValue(oauthCred);

      mockHttp.request.mockResolvedValue({ data: makeGitHubCreatedRepository() });

      await GitHubService.createRepository({ name: 'test-repo' });

      const [callArgs] = mockHttp.request.mock.calls;
      expect(callArgs[0].authOverride).toBe('gho_singleton_pat');
    });
  });

  describe('auth failures', () => {
    it('throws "GitHub token is not configured" when no singleton token and no OAuth credential', async () => {
      mockAccountStorage.getOAuthCredential.mockResolvedValue(null);

      await expect(GitHubService.createRepository({ name: 'orphan-repo' }))
        .rejects
        .toThrow('GitHub token is not configured');
    });
  });

  describe('HTTP error propagation', () => {
    function makeHttpError(status: number, message: string) {
      const err = new Error(`GitHub API error: ${status} (${message})`) as Error & {
        status?: number;
        response?: { data?: { message?: string }; status?: number };
      };
      err.status = status;
      err.response = { data: { message }, status };
      return err;
    }

    it('re-throws HTTP 401 with status attached', async () => {
      await setupSingletonToken();
      const err = makeHttpError(401, 'Bad credentials');
      mockHttp.request.mockRejectedValue(err);

      await expect(GitHubService.createRepository({ name: 'test-repo' }))
        .rejects
        .toMatchObject({ status: 401 });
    });

    it('re-throws HTTP 403 with status attached', async () => {
      await setupSingletonToken();
      const err = makeHttpError(403, 'Resource not accessible by integration');
      mockHttp.request.mockRejectedValue(err);

      await expect(GitHubService.createRepository({ name: 'test-repo' }))
        .rejects
        .toMatchObject({ status: 403 });
    });

    it('re-throws HTTP 422 (validation error) with status attached', async () => {
      await setupSingletonToken();
      const err = makeHttpError(422, 'Validation Failed');
      mockHttp.request.mockRejectedValue(err);

      await expect(GitHubService.createRepository({ name: 'test-repo' }))
        .rejects
        .toMatchObject({ status: 422 });
    });

    it('re-throws network/transient error without status when no response', async () => {
      await setupSingletonToken();
      const networkErr = new Error('Network error');
      mockHttp.request.mockRejectedValue(networkErr);

      await expect(GitHubService.createRepository({ name: 'test-repo' }))
        .rejects
        .toThrow('Network error');
    });
  });
});
