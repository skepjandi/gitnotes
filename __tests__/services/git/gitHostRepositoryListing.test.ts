import AsyncStorage from '@react-native-async-storage/async-storage';
import { GitHubHostService } from '../../../src/services/git/GitHubHostService';
import { GitLabService } from '../../../src/services/git/GitLabService';
import { GiteaLikeHostService } from '../../../src/services/git/GiteaLikeHostService';
import type { HostConnection } from '../../../src/services/AccountStorage';

// Fixtures

const mockGitHubRepos = [
  {
    id: 1,
    full_name: 'owner/repo1',
    name: 'repo1',
    description: 'A test repo',
    private: true,
    size: 1024,
    owner: { login: 'owner' },
  },
  {
    id: 2,
    full_name: 'owner/repo2',
    name: 'repo2',
    description: null,
    private: false,
    size: 2048,
    owner: { login: 'owner' },
  },
];

const mockGitLabProjects = [
  {
    id: 1,
    path_with_namespace: 'group/project1',
    name: 'project1',
    description: 'GitLab project',
    visibility: 'private' as const,
    default_branch: 'main',
    size: 4096,
  },
  {
    id: 2,
    path_with_namespace: 'group/project2',
    name: 'project2',
    description: undefined,
    visibility: 'public' as const,
  },
];

jest.mock('@/services/GitHubService', () => {
  return {
    __esModule: true,
    GitHubService: {
      getRepositories: jest.fn(),
    },
    GitHubServiceStatic: {
      getRepoMeta: jest.fn(),
      rawGet: jest.fn(),
    },
  };
}, { virtual: true });

jest.mock('../../../src/services/AccountStorage', () => ({
  AccountStorage: {
    getHostToken: jest.fn(),
    getHostConnection: jest.fn(),
    getGitHubAppCredential: jest.fn(),
    getOAuthCredential: jest.fn(),
  },
}));

describe('GitHostService.listRepositories()', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    const github = jest.requireMock('@/services/GitHubService');
    const accountStorage = jest.requireMock('../../../src/services/AccountStorage');
    github.GitHubService.getRepositories.mockReset();
    accountStorage.AccountStorage.getHostToken.mockReset();
    accountStorage.AccountStorage.getGitHubAppCredential.mockReset();
    accountStorage.AccountStorage.getOAuthCredential.mockReset();
  });

  describe('GitHubHostService', () => {
    it('maps GitHub repos correctly', async () => {
      const mock = jest.requireMock('@/services/GitHubService');
      mock.GitHubService.getRepositories.mockResolvedValue(mockGitHubRepos);

      const service = new GitHubHostService();
      const result = await service.listRepositories();

      expect(result).toHaveLength(2);

      expect(result[0]).toMatchObject({
        provider: 'github',
        owner: 'owner',
        repo: 'repo1',
        fullName: 'owner/repo1',
        name: 'repo1',
        description: 'A test repo',
        isPrivate: true,
        sizeKb: 1024,
        hostId: undefined,
      });

      expect(result[1]).toMatchObject({
        provider: 'github',
        owner: 'owner',
        repo: 'repo2',
        fullName: 'owner/repo2',
        name: 'repo2',
        description: null,
        isPrivate: false,
        sizeKb: 2048,
        hostId: undefined,
      });
    });

    it('uses the host token and preserves host identity for host-scoped discovery', async () => {
      const github = jest.requireMock('@/services/GitHubService');
      const { AccountStorage: mockAccountStorage } = jest.requireMock('../../../src/services/AccountStorage');
      const hostId = 'github-host-2';
      mockAccountStorage.getHostToken.mockResolvedValue('host-specific-token');
      github.GitHubService.getRepositories.mockResolvedValue(mockGitHubRepos);

      const service = new GitHubHostService();
      const result = await service.listRepositories(hostId);

      expect(github.GitHubService.getRepositories).toHaveBeenCalledWith({ tokenOverride: 'host-specific-token' });
      expect(result).toEqual(expect.arrayContaining([
        expect.objectContaining({ fullName: 'owner/repo1', hostId }),
        expect.objectContaining({ fullName: 'owner/repo2', hostId }),
      ]));
    });

    it('returns unavailable on error when getRepositories throws', async () => {
      const { AccountStorage: mockAccountStorage } = jest.requireMock('../../../src/services/AccountStorage');
      mockAccountStorage.getGitHubAppCredential.mockResolvedValue(null);
      mockAccountStorage.getOAuthCredential.mockResolvedValue(null);
      mockAccountStorage.getHostToken.mockResolvedValue('some-token');

      const github = jest.requireMock('@/services/GitHubService');
      github.GitHubService.getRepositories.mockImplementation(async () => {
        throw new Error('Network error');
      });

      const service = new GitHubHostService();
      const result = await service.listRepositories('test-host');

      expect(result).toHaveLength(1);
      expect(result[0]).toMatchObject({
        kind: 'unavailable',
        provider: 'github',
        reason: 'Network error',
      });
    });

    it('lists repositories selected by a GitHub App installation for the host', async () => {
      const { AccountStorage: mockAccountStorage } = jest.requireMock('../../../src/services/AccountStorage');
      mockAccountStorage.getGitHubAppCredential.mockResolvedValue({
        kind: 'github_app',
        selectedRepositories: [
          { owner: 'acme', repo: 'private-notes' },
          { owner: 'acme', repo: 'public-notes' },
        ],
      });

      const service = new GitHubHostService();
      const result = await service.listRepositories('github-host');

      expect(result).toEqual([
        expect.objectContaining({
          provider: 'github',
          owner: 'acme',
          repo: 'private-notes',
          fullName: 'acme/private-notes',
          name: 'private-notes',
          hostId: 'github-host',
        }),
        expect.objectContaining({
          provider: 'github',
          owner: 'acme',
          repo: 'public-notes',
          fullName: 'acme/public-notes',
          name: 'public-notes',
          hostId: 'github-host',
        }),
      ]);
    });

    it('returns union of App and OAuth repos when both are available', async () => {
      const github = jest.requireMock('@/services/GitHubService');
      const { AccountStorage: mockAccountStorage } = jest.requireMock('../../../src/services/AccountStorage');
      const hostId = 'github-host-union';

      mockAccountStorage.getGitHubAppCredential.mockResolvedValue({
        kind: 'github_app',
        selectedRepositories: [{ owner: 'acme', repo: 'app-repo' }],
      });
      mockAccountStorage.getOAuthCredential.mockResolvedValue({
        kind: 'oauth',
        accessToken: 'oauth-token',
        expiresAt: Date.now() + 3600000,
        renewal: { refreshToken: 'refresh', backendUrl: 'https://example.com' },
        userId: 123,
      });
      mockAccountStorage.getHostToken.mockResolvedValue(null);

      const oauthRepos = [{ id: 10, full_name: 'other/oauth-repo', name: 'oauth-repo', private: false, owner: { login: 'other' } }];
      github.GitHubService.getRepositories.mockImplementation(async (opts?: { credentialKind?: string; hostId?: string }) => {
        if (opts?.credentialKind === 'oauth' && opts?.hostId === hostId) return oauthRepos;
        return [];
      });

      const service = new GitHubHostService();
      const result = await service.listRepositories(hostId);

      expect(result).toHaveLength(2);
      expect(result).toEqual(expect.arrayContaining([
        expect.objectContaining({ fullName: 'acme/app-repo', hostId }),
        expect.objectContaining({ fullName: 'other/oauth-repo', hostId }),
      ]));
    });

    it('returns union of App and PAT repos when both are available', async () => {
      const github = jest.requireMock('@/services/GitHubService');
      const { AccountStorage: mockAccountStorage } = jest.requireMock('../../../src/services/AccountStorage');
      const hostId = 'github-host-app-pat';

      mockAccountStorage.getGitHubAppCredential.mockResolvedValue({
        kind: 'github_app',
        selectedRepositories: [{ owner: 'acme', repo: 'app-repo' }],
      });
      mockAccountStorage.getOAuthCredential.mockResolvedValue(null);
      mockAccountStorage.getHostToken.mockResolvedValue('pat-token');

      const patRepos = [{ id: 20, full_name: 'other/pat-repo', name: 'pat-repo', private: true, owner: { login: 'other' } }];
      github.GitHubService.getRepositories.mockImplementation(async (opts?: { tokenOverride?: string }) => {
        if (opts?.tokenOverride === 'pat-token') return patRepos;
        return [];
      });

      const service = new GitHubHostService();
      const result = await service.listRepositories(hostId);

      expect(result).toHaveLength(2);
      expect(result).toEqual(expect.arrayContaining([
        expect.objectContaining({ fullName: 'acme/app-repo', hostId }),
        expect.objectContaining({ fullName: 'other/pat-repo', hostId }),
      ]));
    });

    it('returns union of App, OAuth, and PAT repos (triple union)', async () => {
      const github = jest.requireMock('@/services/GitHubService');
      const { AccountStorage: mockAccountStorage } = jest.requireMock('../../../src/services/AccountStorage');
      const hostId = 'github-host-triple';

      mockAccountStorage.getGitHubAppCredential.mockResolvedValue({
        kind: 'github_app',
        selectedRepositories: [{ owner: 'acme', repo: 'app-repo' }],
      });
      mockAccountStorage.getOAuthCredential.mockResolvedValue({
        kind: 'oauth',
        accessToken: 'oauth-token',
        expiresAt: Date.now() + 3600000,
        renewal: { refreshToken: 'refresh', backendUrl: 'https://example.com' },
        userId: 123,
      });
      mockAccountStorage.getHostToken.mockResolvedValue('pat-token');

      const oauthRepos = [{ id: 10, full_name: 'other/oauth-repo', name: 'oauth-repo', private: false, owner: { login: 'other' } }];
      const patRepos = [{ id: 20, full_name: 'other/pat-repo', name: 'pat-repo', private: true, owner: { login: 'other' } }];
      github.GitHubService.getRepositories.mockImplementation(async (opts?: { credentialKind?: string; tokenOverride?: string; hostId?: string }) => {
        if (opts?.credentialKind === 'oauth' && opts?.hostId === hostId) return oauthRepos;
        if (opts?.tokenOverride === 'pat-token') return patRepos;
        return [];
      });

      const service = new GitHubHostService();
      const result = await service.listRepositories(hostId);

      expect(result).toHaveLength(3);
      expect(result).toEqual(expect.arrayContaining([
        expect.objectContaining({ fullName: 'acme/app-repo', hostId }),
        expect.objectContaining({ fullName: 'other/oauth-repo', hostId }),
        expect.objectContaining({ fullName: 'other/pat-repo', hostId }),
      ]));
    });

    it('deduplicates repos case-insensitively by fullName', async () => {
      const { AccountStorage: mockAccountStorage } = jest.requireMock('../../../src/services/AccountStorage');
      const hostId = 'github-host-dedupe';

      mockAccountStorage.getGitHubAppCredential.mockResolvedValue({
        kind: 'github_app',
        selectedRepositories: [{ owner: 'Acme', repo: 'Shared-Repo' }],
      });
      mockAccountStorage.getOAuthCredential.mockResolvedValue({
        kind: 'oauth',
        accessToken: 'oauth-token',
        expiresAt: Date.now() + 3600000,
        renewal: { refreshToken: 'refresh', backendUrl: 'https://example.com' },
        userId: 123,
      });
      mockAccountStorage.getHostToken.mockResolvedValue('different-pat-token');

      const github = jest.requireMock('@/services/GitHubService');
      const oauthRepos = [{ id: 10, full_name: 'acme/shared-repo', name: 'Shared-Repo', private: false, owner: { login: 'acme' } }];
      const patRepos = [{ id: 20, full_name: 'other/pat-repo', name: 'pat-repo', private: true, owner: { login: 'other' } }];
      github.GitHubService.getRepositories.mockImplementation(async (opts?: { credentialKind?: string; tokenOverride?: string; hostId?: string }) => {
        if (opts?.credentialKind === 'oauth' && opts?.hostId === hostId) return oauthRepos;
        if (opts?.tokenOverride === 'different-pat-token') return patRepos;
        return [];
      });

      const service = new GitHubHostService();
      const result = await service.listRepositories(hostId);

      expect(result).toHaveLength(2);
      const fullNames = result.map(r => r.fullName);
      expect(fullNames).toContain('Acme/Shared-Repo');
      expect(fullNames).toContain('other/pat-repo');
    });

    it('keeps richer metadata when duplicate sources describe the same repo', async () => {
      const { AccountStorage: mockAccountStorage } = jest.requireMock('../../../src/services/AccountStorage');
      const github = jest.requireMock('@/services/GitHubService');
      const hostId = 'github-host-metadata';

      mockAccountStorage.getGitHubAppCredential.mockResolvedValue({
        kind: 'github_app',
        selectedRepositories: [{ owner: 'acme', repo: 'shared-repo' }],
      });
      mockAccountStorage.getOAuthCredential.mockResolvedValue({
        kind: 'oauth',
        accessToken: 'oauth-token',
        expiresAt: Date.now() + 3600000,
        renewal: { refreshToken: 'refresh', backendUrl: 'https://example.com' },
        userId: 123,
      });
      mockAccountStorage.getHostToken.mockResolvedValue(null);
      github.GitHubService.getRepositories.mockResolvedValue([
        {
          id: 10,
          full_name: 'ACME/shared-repo',
          name: 'shared-repo',
          private: true,
          description: 'Shared repository',
          size: 42,
          owner: { login: 'ACME' },
        },
      ]);

      const service = new GitHubHostService();
      const result = await service.listRepositories(hostId);

      expect(result).toEqual([
        expect.objectContaining({
          fullName: 'acme/shared-repo',
          description: 'Shared repository',
          sizeKb: 42,
        }),
      ]);
    });

    it('returns repos from successful source when one source fails', async () => {
      const github = jest.requireMock('@/services/GitHubService');
      const { AccountStorage: mockAccountStorage } = jest.requireMock('../../../src/services/AccountStorage');
      const hostId = 'github-host-partial';

      mockAccountStorage.getGitHubAppCredential.mockResolvedValue(null);
      mockAccountStorage.getOAuthCredential.mockResolvedValue({
        kind: 'oauth',
        accessToken: 'oauth-token',
        expiresAt: Date.now() + 3600000,
        renewal: { refreshToken: 'refresh', backendUrl: 'https://example.com' },
        userId: 123,
      });
      mockAccountStorage.getHostToken.mockResolvedValue('pat-token');

      const oauthRepos = [{ id: 10, full_name: 'other/oauth-repo', name: 'oauth-repo', private: false, owner: { login: 'other' } }];
      github.GitHubService.getRepositories.mockImplementation(async (opts?: { credentialKind?: string; tokenOverride?: string; hostId?: string }) => {
        if (opts?.credentialKind === 'oauth' && opts?.hostId === hostId) return oauthRepos;
        if (opts?.tokenOverride === 'pat-token') throw new Error('PAT failed');
        return [];
      });

      const service = new GitHubHostService();
      const result = await service.listRepositories(hostId);

      expect(result).toHaveLength(1);
      expect(result[0]).toEqual(expect.objectContaining({ fullName: 'other/oauth-repo', hostId }));
    });

    it('returns unavailable only when all sources fail', async () => {
      const github = jest.requireMock('@/services/GitHubService');
      const { AccountStorage: mockAccountStorage } = jest.requireMock('../../../src/services/AccountStorage');
      const hostId = 'github-host-all-fail';

      mockAccountStorage.getGitHubAppCredential.mockResolvedValue(null);
      mockAccountStorage.getOAuthCredential.mockResolvedValue(null);
      mockAccountStorage.getHostToken.mockResolvedValue(null);

      github.GitHubService.getRepositories.mockRejectedValue(new Error('All failed'));

      const service = new GitHubHostService();
      const result = await service.listRepositories(hostId);

      expect(result).toHaveLength(1);
      expect(result[0]).toMatchObject({ kind: 'unavailable', provider: 'github' });
    });

    it('queries OAuth-only host when getOAuthCredential is available', async () => {
      const github = jest.requireMock('@/services/GitHubService');
      const { AccountStorage: mockAccountStorage } = jest.requireMock('../../../src/services/AccountStorage');
      const hostId = 'github-host-oauth-only';

      mockAccountStorage.getGitHubAppCredential.mockResolvedValue(null);
      mockAccountStorage.getOAuthCredential.mockResolvedValue({
        kind: 'oauth',
        accessToken: 'oauth-token',
        expiresAt: Date.now() + 3600000,
        renewal: { refreshToken: 'refresh', backendUrl: 'https://example.com' },
        userId: 123,
      });
      mockAccountStorage.getHostToken.mockResolvedValue(null);

      const oauthRepos = [{ id: 10, full_name: 'oauth/oauth-only-repo', name: 'oauth-only-repo', private: false, owner: { login: 'oauth' } }];
      github.GitHubService.getRepositories.mockImplementation(async (opts?: { credentialKind?: string; hostId?: string }) => {
        if (opts?.credentialKind === 'oauth' && opts?.hostId === hostId) return oauthRepos;
        return [];
      });

      const service = new GitHubHostService();
      const result = await service.listRepositories(hostId);

      expect(github.GitHubService.getRepositories).toHaveBeenCalledWith({ credentialKind: 'oauth', hostId });
      expect(result).toHaveLength(1);
      expect(result[0]).toEqual(expect.objectContaining({ fullName: 'oauth/oauth-only-repo', hostId }));
    });
  });

  describe('GitLabService', () => {
    it('maps GitLab projects correctly', async () => {
      const service = new GitLabService();
      service.listOwnedProjects = jest.fn().mockResolvedValue(mockGitLabProjects);

      const result = await service.listRepositories();

      expect(result).toHaveLength(2);

      // First project
      expect(result[0]).toMatchObject({
        provider: 'gitlab',
        owner: 'group',
        repo: 'project1',
        fullName: 'group/project1',
        name: 'project1',
        description: 'GitLab project',
        isPrivate: true,
        sizeKb: 4, // 4096 / 1024 = 4
        defaultBranch: 'main',
      });

      // Second project
      expect(result[1]).toMatchObject({
        provider: 'gitlab',
        owner: 'group',
        repo: 'project2',
        fullName: 'group/project2',
        name: 'project2',
        description: null,
        isPrivate: false,
      });
    });

    it('returns unavailable on error', async () => {
      const service = new GitLabService();
      service.listOwnedProjects = jest.fn().mockRejectedValue(new Error('GitLab fetch failed'));

      const result = await service.listRepositories();

      expect(result).toHaveLength(1);
      expect(result[0]).toMatchObject({
        kind: 'unavailable',
        provider: 'gitlab',
        reason: 'GitLab fetch failed',
      });
    });
  });

  describe('GiteaLikeHostService', () => {
    const mockGetItem = AsyncStorage.getItem as jest.Mock;
    const mockSetItem = AsyncStorage.setItem as jest.Mock;

    beforeEach(() => {
      mockGetItem.mockReset();
      mockSetItem.mockReset();
      mockGetItem.mockResolvedValue(null);
      mockSetItem.mockResolvedValue(undefined);
    });

    it('maps Gitea repos correctly', async () => {
      const giteaService = new GiteaLikeHostService('gitea', 'https://gitea.com/api/v1');
      await giteaService.setToken('test-pat');

      const mockRepos = [
        {
          id: 1,
          name: 'my-repo',
          full_name: 'testuser/my-repo',
          description: 'A test repo',
          private: true,
          default_branch: 'main',
          size: 2048,
          owner: { login: 'testuser' },
        },
        {
          id: 2,
          name: 'public-repo',
          full_name: 'testuser/public-repo',
          description: null,
          private: false,
          owner: { login: 'testuser' },
        },
      ];

      const fetchSpy = jest.spyOn(global, 'fetch').mockResolvedValue(
        new Response(JSON.stringify(mockRepos), {
          status: 200,
          headers: { 'content-type': 'application/json' },
        }),
      );

      const result = await giteaService.listRepositories();

      expect(fetchSpy).toHaveBeenCalledWith(
        'https://gitea.com/api/v1/user/repos',
        expect.objectContaining({
          headers: expect.objectContaining({
            Authorization: 'token test-pat',
          }),
        }),
      );

      expect(result).toHaveLength(2);
      expect(result[0]).toMatchObject({
        provider: 'gitea',
        owner: 'testuser',
        repo: 'my-repo',
        fullName: 'testuser/my-repo',
        name: 'my-repo',
        description: 'A test repo',
        isPrivate: true,
        sizeKb: 2,
        defaultBranch: 'main',
      });
      expect(result[1]).toMatchObject({
        provider: 'gitea',
        owner: 'testuser',
        repo: 'public-repo',
        fullName: 'testuser/public-repo',
        name: 'public-repo',
        description: null,
        isPrivate: false,
      });
    });

    it('uses custom base URL from setToken', async () => {
      const giteaService = new GiteaLikeHostService('forgejo', 'https://codeberg.org/api/v1');
      await giteaService.setToken('forgejo-pat', 'https://my-forgejo.example.com/api/v1');

      const fetchSpy = jest.spyOn(global, 'fetch').mockResolvedValue(
        new Response(JSON.stringify([]), {
          status: 200,
          headers: { 'content-type': 'application/json' },
        }),
      );

      await giteaService.listRepositories();

      expect(fetchSpy).toHaveBeenCalledWith(
        'https://my-forgejo.example.com/api/v1/user/repos',
        expect.objectContaining({
          headers: expect.objectContaining({
            Authorization: 'token forgejo-pat',
          }),
        }),
      );
    });

    it('returns unavailable with reason on 401 without leaking PAT', async () => {
      const giteaService = new GiteaLikeHostService('gitea', 'https://gitea.com/api/v1');
      await giteaService.setToken('super-secret-pat-12345');

      jest.spyOn(global, 'fetch').mockResolvedValue(
        new Response(JSON.stringify({ message: 'Unauthorized' }), {
          status: 401,
          headers: { 'content-type': 'application/json' },
        }),
      );

      const result = await giteaService.listRepositories();

      expect(result).toHaveLength(1);
      expect(result[0]).toMatchObject({
        kind: 'unavailable',
        provider: 'gitea',
        reason: 'Network error',
      });
      // Sanity: PAT does not appear in any error output
      expect(JSON.stringify(result)).not.toContain('super-secret-pat');
      expect(JSON.stringify(result)).not.toContain('pat-12345');
    });

    it('returns unavailable with reason on 403 without leaking PAT', async () => {
      const giteaService = new GiteaLikeHostService('forgejo', 'https://my-forgejo.com/api/v1');
      await giteaService.setToken('my-private-token-xyz');

      jest.spyOn(global, 'fetch').mockResolvedValue(
        new Response(JSON.stringify({ message: 'Forbidden' }), {
          status: 403,
          headers: { 'content-type': 'application/json' },
        }),
      );

      const result = await giteaService.listRepositories();

      expect(result).toHaveLength(1);
      expect(result[0]).toMatchObject({
        kind: 'unavailable',
        provider: 'forgejo',
        reason: 'Network error',
      });
      expect(JSON.stringify(result)).not.toContain('my-private-token');
    });

    it('returns unavailable on network failure without leaking PAT', async () => {
      const giteaService = new GiteaLikeHostService('gitea', 'https://gitea.com/api/v1');
      await giteaService.setToken('network-test-token');

      jest.spyOn(global, 'fetch').mockRejectedValue(new Error('Network request failed'));

      const result = await giteaService.listRepositories();

      expect(result).toHaveLength(1);
      expect(result[0]).toMatchObject({
        kind: 'unavailable',
        provider: 'gitea',
        reason: 'Network error',
      });
      expect(JSON.stringify(result)).not.toContain('network-test-token');
    });

    it('returns unavailable when unauthenticated (no token)', async () => {
      const giteaService = new GiteaLikeHostService('gitea', 'https://gitea.com/api/v1');
      // No setToken called - service has no token

      const result = await giteaService.listRepositories();

      expect(result).toHaveLength(1);
      expect(result[0]).toMatchObject({
        kind: 'unavailable',
        provider: 'gitea',
        reason: 'Network error',
      });
    });

    it('maps Forgejo repos correctly', async () => {
      const forgejoService = new GiteaLikeHostService('forgejo', 'https://codeberg.org/api/v1');
      await forgejoService.setToken('forgejo-pat');

      const mockRepos = [
        {
          id: 99,
          name: 'forgejo-project',
          full_name: 'forgejo-maintainer/forgejo-project',
          description: 'A Forgejo repo',
          private: false,
          default_branch: 'develop',
          size: 5120,
          owner: { login: 'forgejo-maintainer' },
        },
      ];

      jest.spyOn(global, 'fetch').mockResolvedValue(
        new Response(JSON.stringify(mockRepos), {
          status: 200,
          headers: { 'content-type': 'application/json' },
        }),
      );

      const result = await forgejoService.listRepositories();

      expect(result).toHaveLength(1);
      expect(result[0]).toMatchObject({
        provider: 'forgejo',
        owner: 'forgejo-maintainer',
        repo: 'forgejo-project',
        fullName: 'forgejo-maintainer/forgejo-project',
        name: 'forgejo-project',
        description: 'A Forgejo repo',
        isPrivate: false,
        sizeKb: 5,
        defaultBranch: 'develop',
      });
    });

    it('listRepositories(hostId) uses AccountStorage token and baseUrl', async () => {
      const { AccountStorage: MockAccountStorage } = jest.requireMock('../../../src/services/AccountStorage');
      MockAccountStorage.getHostToken.mockResolvedValue('host-specific-pat');
      MockAccountStorage.getHostConnection.mockResolvedValue({
        id: 'acc1:forgejo:my-forgejo.example.com',
        accountId: 'acc1',
        provider: 'forgejo',
        instanceBaseUrl: 'https://my-forgejo.example.com/api/v1',
        hostLogin: 'forgejouser',
        hostUserId: 1,
        name: 'Forgejo User',
        email: null,
        avatarUrl: null,
        addedAt: Date.now(),
      });

      const giteaLikeService = new GiteaLikeHostService('forgejo', 'https://codeberg.org/api/v1');
      // Singleton has a different default token set
      await giteaLikeService.setToken('singleton-token');

      const mockRepos = [
        {
          id: 1,
          name: 'custom-host-repo',
          full_name: 'forgejouser/custom-host-repo',
          description: null,
          private: false,
          owner: { login: 'forgejouser' },
        },
      ];

      const fetchSpy = jest.spyOn(global, 'fetch').mockResolvedValue(
        new Response(JSON.stringify(mockRepos), {
          status: 200,
          headers: { 'content-type': 'application/json' },
        }),
      );

      const result = await giteaLikeService.listRepositories('acc1:forgejo:my-forgejo.example.com');

      // Verify AccountStorage was called with the hostId
      expect(MockAccountStorage.getHostToken).toHaveBeenCalledWith('acc1:forgejo:my-forgejo.example.com');
      expect(MockAccountStorage.getHostConnection).toHaveBeenCalledWith('acc1:forgejo:my-forgejo.example.com');

      // Verify the correct host-specific base URL and token were used (not singleton's)
      expect(fetchSpy).toHaveBeenCalledWith(
        'https://my-forgejo.example.com/api/v1/user/repos',
        expect.objectContaining({
          headers: expect.objectContaining({
            Authorization: 'token host-specific-pat',
          }),
        }),
      );

      expect(result).toHaveLength(1);
      expect(result[0]).toMatchObject({
        provider: 'forgejo',
        owner: 'forgejouser',
        repo: 'custom-host-repo',
        fullName: 'forgejouser/custom-host-repo',
      });
    });

    it('two Forgejo hosts with different bases use correct credentials each', async () => {
      const { AccountStorage: MockAccountStorage } = jest.requireMock('../../../src/services/AccountStorage');

      // Host A
      MockAccountStorage.getHostToken
        .mockResolvedValueOnce('pat-host-a')
        .mockResolvedValueOnce('pat-host-b');
      MockAccountStorage.getHostConnection
        .mockResolvedValueOnce({ instanceBaseUrl: 'https://forgejo-a.example.com/api/v1' } as unknown as HostConnection)
        .mockResolvedValueOnce({ instanceBaseUrl: 'https://forgejo-b.example.com/api/v1' } as unknown as HostConnection);

      const giteaLikeService = new GiteaLikeHostService('forgejo', 'https://codeberg.org/api/v1');
      await giteaLikeService.setToken('singleton-token');

      const mockReposA = [{ id: 1, name: 'repo-a', full_name: 'user/repo-a', private: false, owner: { login: 'user' } }];
      const mockReposB = [{ id: 2, name: 'repo-b', full_name: 'user/repo-b', private: false, owner: { login: 'user' } }];

      jest.spyOn(global, 'fetch').mockImplementation(async (url: string) => {
        if (url.toString().includes('forgejo-a')) {
          return new Response(JSON.stringify(mockReposA), { status: 200, headers: { 'content-type': 'application/json' } });
        }
        return new Response(JSON.stringify(mockReposB), { status: 200, headers: { 'content-type': 'application/json' } });
      });

      const [resultA, resultB] = await Promise.all([
        giteaLikeService.listRepositories('host-a-id'),
        giteaLikeService.listRepositories('host-b-id'),
      ]);

      expect(resultA).toHaveLength(1);
      expect(resultA[0]).toMatchObject({ repo: 'repo-a' });
      expect(resultB).toHaveLength(1);
      expect(resultB[0]).toMatchObject({ repo: 'repo-b' });
    });

    it('falls back to singleton token when AccountStorage.getHostToken returns null for hostId', async () => {
      const { AccountStorage: MockAccountStorage } = jest.requireMock('../../../src/services/AccountStorage');
      MockAccountStorage.getHostToken.mockResolvedValue(null);
      MockAccountStorage.getHostConnection.mockResolvedValue(null);

      const giteaLikeService = new GiteaLikeHostService('forgejo', 'https://codeberg.org/api/v1');
      await giteaLikeService.setToken('singleton-pat');

      const mockRepos = [
        { id: 1, name: 'singleton-repo', full_name: 'user/singleton-repo', private: false, owner: { login: 'user' } },
      ];

      const fetchSpy = jest.spyOn(global, 'fetch').mockResolvedValue(
        new Response(JSON.stringify(mockRepos), {
          status: 200,
          headers: { 'content-type': 'application/json' },
        }),
      );

      const result = await giteaLikeService.listRepositories('nonexistent-host-id');

      // When hostId token is null, falls back to singleton token → repos returned
      expect(fetchSpy).toHaveBeenCalledWith(
        'https://codeberg.org/api/v1/user/repos',
        expect.objectContaining({
          headers: expect.objectContaining({
            Authorization: 'token singleton-pat',
          }),
        }),
      );
      expect(result).toHaveLength(1);
      expect(result[0]).toMatchObject({ repo: 'singleton-repo' });
    });

    it('401 on hostId request returns unavailable without leaking PAT', async () => {
      const { AccountStorage: MockAccountStorage } = jest.requireMock('../../../src/services/AccountStorage');
      MockAccountStorage.getHostToken.mockResolvedValue('super-secret-host-pat-99999');
      MockAccountStorage.getHostConnection.mockResolvedValue({
        instanceBaseUrl: 'https://my-forgejo.example.com/api/v1',
      } as unknown as HostConnection);

      const giteaLikeService = new GiteaLikeHostService('forgejo', 'https://codeberg.org/api/v1');
      await giteaLikeService.setToken('different-token');

      jest.spyOn(global, 'fetch').mockResolvedValue(
        new Response(JSON.stringify({ message: 'Unauthorized' }), {
          status: 401,
          headers: { 'content-type': 'application/json' },
        }),
      );

      const result = await giteaLikeService.listRepositories('host1:forgejo:my-forgejo.example.com');

      expect(result).toHaveLength(1);
      expect(result[0]).toMatchObject({ kind: 'unavailable', provider: 'forgejo' });
      // PAT must not appear in any output
      expect(JSON.stringify(result)).not.toContain('super-secret-host-pat');
      expect(JSON.stringify(result)).not.toContain('99999');
    });

    it('network failure on hostId request returns unavailable without leaking PAT', async () => {
      const { AccountStorage: MockAccountStorage } = jest.requireMock('../../../src/services/AccountStorage');
      MockAccountStorage.getHostToken.mockResolvedValue('network-pat-token');
      MockAccountStorage.getHostConnection.mockResolvedValue({
        instanceBaseUrl: 'https://offline-forgejo.example.com/api/v1',
      } as unknown as HostConnection);

      const giteaLikeService = new GiteaLikeHostService('forgejo', 'https://codeberg.org/api/v1');
      await giteaLikeService.setToken('singleton-token');

      jest.spyOn(global, 'fetch').mockRejectedValue(new Error('Network request failed'));

      const result = await giteaLikeService.listRepositories('host1:forgejo:offline.example.com');

      expect(result).toHaveLength(1);
      expect(result[0]).toMatchObject({ kind: 'unavailable', provider: 'forgejo' });
      expect(JSON.stringify(result)).not.toContain('network-pat-token');
    });
  });
});
