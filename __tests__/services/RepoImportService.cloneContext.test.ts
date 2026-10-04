import { importRepoAtAdd } from '@/services/RepoImportService';
import { AccountStorage } from '@/services/AccountStorage';
import { AuthService } from '@/services/AuthService';
import { StorageService } from '@/services/StorageService';
import { GitFsService } from '@/services/git/GitFsService';
import { resolveBranch } from '@/services/git/branchResolver';

jest.mock('@/services/AccountStorage', () => ({
  AccountStorage: {
    getActiveHostConnection: jest.fn(),
    getHostConnection: jest.fn(),
    getHostToken: jest.fn(),
    getHostUseSsh: jest.fn(),
  },
}));

jest.mock('@/services/AuthService', () => ({
  AuthService: {
    getToken: jest.fn(),
  },
}));

jest.mock('@/services/StorageService', () => ({
  StorageService: {
    getSavedRepositories: jest.fn(),
    getAllNotes: jest.fn(),
    saveAllNotes: jest.fn(),
  },
}));

jest.mock('@/services/git/GitFsService', () => ({
  GitFsService: {
    isCloned: jest.fn(),
    cloneExclusive: jest.fn(),
    getCommitOid: jest.fn(),
    listTree: jest.fn(),
    readFile: jest.fn(),
    pullWithFastForward: jest.fn(),
  },
}));

jest.mock('@/services/git/branchResolver', () => ({
  resolveBranch: jest.fn(),
}));

jest.mock('@/services/git/engine/GitEngine', () => ({
  setCredential: jest.fn(),
}));

jest.mock('@/services/GitHubService', () => ({
  GitHubService: {
    isAuthenticated: jest.fn(() => true),
    getPathCommitDates: jest.fn(() => Promise.resolve({})),
  },
}));

const mockPullFromSingleRepo = jest.fn();
jest.mock('@/services/RepoPullService', () => ({
  pullFromSingleRepo: (...args: unknown[]) => mockPullFromSingleRepo(...args),
}));

describe('importRepoAtAdd clone context', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockPullFromSingleRepo.mockResolvedValue({
      repos: 1, notes: 0, canvases: 0, todos: 0, templates: 0,
    });
    jest.mocked(AuthService.getToken).mockResolvedValue('gitlab-token');
    jest.mocked(StorageService.getSavedRepositories).mockResolvedValue([
      {
        id: 'gitlab:repo-123',
        path: 'group/project',
        name: 'project',
        provider: 'gitlab',
        hostId: 'account-1:gitlab:default',
        branch: 'main',
      },
    ]);
    jest.mocked(resolveBranch).mockResolvedValue('main');
    jest.mocked(AccountStorage.getActiveHostConnection).mockResolvedValue(null);
    jest.mocked(AccountStorage.getHostConnection).mockResolvedValue({
      id: 'account-1:gitlab:default',
      accountId: 'account-1',
      provider: 'gitlab',
      instanceBaseUrl: 'https://gitlab.example.com',
      hostLogin: 'alice',
      hostUserId: 42,
      name: 'Work GitLab',
      email: 'alice@example.com',
      avatarUrl: null,
      addedAt: 1,
    });
    jest.mocked(AccountStorage.getHostToken).mockResolvedValue('gitlab-host-token');
    jest.mocked(AccountStorage.getHostUseSsh).mockResolvedValue(false);
    jest.mocked(GitFsService.isCloned).mockResolvedValue(false);
    jest.mocked(GitFsService.cloneExclusive).mockResolvedValue(undefined);
    jest.mocked(GitFsService.getCommitOid).mockResolvedValue('abc123head');
    jest.mocked(GitFsService.listTree).mockResolvedValue([]);
    jest.mocked(StorageService.getAllNotes).mockResolvedValue([]);
    jest.mocked(StorageService.saveAllNotes).mockResolvedValue(undefined);
  });

  it('uses the repository host metadata when no active host is selected', async () => {
    await importRepoAtAdd('group/project', 'project');

    expect(AccountStorage.getHostConnection).toHaveBeenCalledWith('account-1:gitlab:default');
    expect(GitFsService.cloneExclusive).toHaveBeenCalledWith(
      expect.objectContaining({
        repoId: 'gitlab:repo-123',
        provider: 'gitlab',
        instanceBaseUrl: 'https://gitlab.example.com',
      }),
    );
  });

  it('BASELINE: cloneExclusive completes before pullFromSingleRepo is called', async () => {
    const callOrder: string[] = [];

    jest.mocked(GitFsService.cloneExclusive).mockImplementation(async () => {
      callOrder.push('cloneExclusive');
    });
    mockPullFromSingleRepo.mockImplementation(async () => {
      callOrder.push('pullFromSingleRepo');
      return { repos: 1, notes: 0, canvases: 0, todos: 0, templates: 0 };
    });

    await importRepoAtAdd('group/project', 'project');

    expect(callOrder).toEqual(['cloneExclusive', 'pullFromSingleRepo']);
  });

  it('BASELINE: pullFromSingleRepo is NOT called when getCommitOid returns null (empty repo)', async () => {
    jest.mocked(GitFsService.getCommitOid).mockResolvedValue(null);

    const result = await importRepoAtAdd('group/project', 'project');

    expect(result).toEqual({ ok: true, counts: { repos: 1, notes: 0, canvases: 0, todos: 0, templates: 0 } });
    expect(mockPullFromSingleRepo).not.toHaveBeenCalled();
  });

  it('BASELINE: cloneExclusive is skipped when repo is already cloned', async () => {
    jest.mocked(GitFsService.isCloned).mockResolvedValue(true);

    await importRepoAtAdd('group/project', 'project');

    expect(GitFsService.cloneExclusive).not.toHaveBeenCalled();
    expect(mockPullFromSingleRepo).toHaveBeenCalled();
  });

  it('returns an actionable retry result for an Expo lazy-bundle failure', async () => {
    jest.mocked(GitFsService.cloneExclusive).mockRejectedValue(
      new TypeError("Cannot read property 'reload' of undefined"),
    );

    await expect(importRepoAtAdd('group/project', 'project')).resolves.toEqual({
      ok: false,
      error: 'project: The app is still loading. Please try again.',
      retryable: true,
    });
  });
});
