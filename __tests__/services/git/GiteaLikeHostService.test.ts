import AsyncStorage from '@react-native-async-storage/async-storage';
import { AccountStorage, type HostConnection } from '@/services/AccountStorage';
import { GiteaLikeHostService } from '@/services/git/GiteaLikeHostService';

jest.mock('@react-native-async-storage/async-storage', () => ({
  __esModule: true,
  default: {
    getItem: jest.fn(async () => null),
    setItem: jest.fn(async () => undefined),
    removeItem: jest.fn(async () => undefined),
  },
}));

describe('GiteaLikeHostService', () => {
  const apiBase = 'http://forgejo.local/api/v1';
  const originalFetch = global.fetch;

  afterEach(() => {
    global.fetch = originalFetch;
    jest.clearAllMocks();
  });

  it('validates repository-scoped Forgejo token against target repo, not /user', async () => {
    const fetchMock = jest.fn(async (input: RequestInfo | URL) => {
      const isTargetRepo = String(input) === `${apiBase}/repos/team/notes`;
      return {
        ok: isTargetRepo,
        status: isTargetRepo ? 200 : 403,
        json: async () =>
          isTargetRepo ? { id: 7, name: 'Notes', full_name: 'team/notes' } : null,
      } as Response;
    });
    global.fetch = fetchMock as unknown as typeof fetch;

    const service = new GiteaLikeHostService('forgejo', apiBase);
    const user = await service.setToken('repo-token', apiBase, {
      owner: 'team',
      repo: 'notes',
      username: 'writer',
    });

    expect(user).toEqual({ id: 0, login: 'writer', full_name: 'writer' });
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(fetchMock).toHaveBeenCalledWith(
      `${apiBase}/repos/team/notes`,
      expect.objectContaining({
        headers: expect.objectContaining({
          Authorization: 'token repo-token',
        }),
      }),
    );
  });

  it('does not save a repository token when target repo access fails', async () => {
    const fetchMock = jest.fn(async () => ({
      ok: false,
      status: 403,
      json: async () => null,
    }) as Response);
    global.fetch = fetchMock as unknown as typeof fetch;

    const service = new GiteaLikeHostService('forgejo', apiBase);
    const user = await service.setToken('repo-token', apiBase, {
      owner: 'team',
      repo: 'notes',
      username: 'writer',
    });

    expect(user).toBeNull();
    expect(AsyncStorage.setItem).not.toHaveBeenCalled();
  });

  it('keeps account-wide token validation on the /user endpoint', async () => {
    const fetchMock = jest.fn(async () => ({
      ok: true,
      status: 200,
      json: async () => ({ id: 7, login: 'writer', full_name: 'Writer' }),
    }) as Response);
    global.fetch = fetchMock as unknown as typeof fetch;

    const service = new GiteaLikeHostService('forgejo', apiBase);
    const user = await service.setToken('account-token', apiBase);

    expect(user).toEqual({ id: 7, login: 'writer', full_name: 'Writer' });
    expect(fetchMock).toHaveBeenCalledWith(
      `${apiBase}/user`,
      expect.objectContaining({
        headers: expect.objectContaining({
          Authorization: 'token account-token',
        }),
      }),
    );
  });

  it('lists only the configured repository for a repository-scoped token', async () => {
    const target = { owner: 'team', repo: 'notes', username: 'writer' };
    const hostConnection: HostConnection = {
      id: 'host-id',
      accountId: 'account-id',
      provider: 'forgejo',
      instanceBaseUrl: apiBase,
      hostLogin: 'writer',
      hostUserId: 0,
      name: 'writer',
      email: null,
      avatarUrl: null,
      addedAt: 0,
      repositoryTokenTarget: target,
    };
    jest.spyOn(AccountStorage, 'getHostToken').mockResolvedValue('repo-token');
    jest.spyOn(AccountStorage, 'getHostConnection').mockResolvedValue(hostConnection);
    const fetchMock = jest.fn(async (input: RequestInfo | URL) => {
      const isTargetRepo = String(input) === `${apiBase}/repos/team/notes`;
      return {
        ok: isTargetRepo,
        status: isTargetRepo ? 200 : 403,
        json: async () => ({
          id: 7,
          name: 'notes',
          full_name: 'team/notes',
          private: true,
          default_branch: 'main',
          owner: { login: 'team' },
        }),
      } as Response;
    });
    global.fetch = fetchMock as unknown as typeof fetch;

    const service = new GiteaLikeHostService('forgejo', apiBase);
    const repositories = await service.listRepositories('host-id');

    expect(repositories).toMatchObject([
      {
        provider: 'forgejo',
        owner: 'team',
        repo: 'notes',
        fullName: 'team/notes',
        defaultBranch: 'main',
      },
    ]);
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(fetchMock).toHaveBeenCalledWith(
      `${apiBase}/repos/team/notes`,
      expect.objectContaining({
        headers: expect.objectContaining({
          Authorization: 'token repo-token',
        }),
      }),
    );
  });

  it('reports target repository access failure instead of a generic network error', async () => {
    const target = { owner: 'team', repo: 'notes', username: 'writer' };
    const hostConnection: HostConnection = {
      id: 'host-id',
      accountId: 'account-id',
      provider: 'forgejo',
      instanceBaseUrl: apiBase,
      hostLogin: 'writer',
      hostUserId: 0,
      name: 'writer',
      email: null,
      avatarUrl: null,
      addedAt: 0,
      repositoryTokenTarget: target,
    };
    jest.spyOn(AccountStorage, 'getHostToken').mockResolvedValue('repo-token');
    jest.spyOn(AccountStorage, 'getHostConnection').mockResolvedValue(hostConnection);
    global.fetch = jest.fn(async () => ({
      ok: false,
      status: 403,
      json: async () => null,
    }) as Response) as unknown as typeof fetch;

    const service = new GiteaLikeHostService('forgejo', apiBase);
    const repositories = await service.listRepositories('host-id');

    expect(repositories).toEqual([
      {
        kind: 'unavailable',
        provider: 'forgejo',
        reason: 'Could not reach or access team/notes. Check network, repository path, and token permissions.',
      },
    ]);
  });
});
