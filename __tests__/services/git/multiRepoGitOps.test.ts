import { beforeEach, describe, expect, it, jest } from '@jest/globals';
import type { GitRepository } from '../../../src/services/GitService';
import type { Author, CommitInfo } from '../../../src/services/git/engine/GitEngine';
import * as GitEngine from '../../../src/services/git/engine/GitEngine';
import { GitFsService } from '../../../src/services/git/GitFsService';
import { GitSyncGate } from '../../../src/services/git/GitSyncGate';
import { commitAll, pushAll } from '../../../src/services/git/multiRepoGitOps';
import { gitOperationRegistry } from '../../../src/stores/gitOperationStore';

const COMMIT_INFO: CommitInfo = {
  id: 'commit-1',
  message: 'Test commit',
  author: { name: 'Test Author', email: 'test@example.com' },
  timestamp: 0,
  shortId: 'commit-1',
  summary: 'Test commit',
  parentCount: 1,
  authorTime: 0,
};

jest.mock('../../../src/services/git/engine/GitEngine', () => ({
  status: jest.fn(),
  statuses: jest.fn(),
  commit: jest.fn(),
  pushWithIntegrate: jest.fn(),
}));

jest.mock('../../../src/services/git/GitFsService', () => ({
  GitFsService: { workingTreeUri: jest.fn() },
}));

jest.mock('../../../src/services/git/GitSyncGate', () => ({
  GitSyncGate: {
    capturePreflight: jest.fn(),
    markPushActive: jest.fn(),
    verifyPostflight: jest.fn(),
    clearPushActive: jest.fn(),
    clearPreflight: jest.fn(),
    releasePushMarker: jest.fn(),
  },
}));

jest.mock('../../../src/stores/gitOperationStore', () => ({
  gitOperationRegistry: {
    begin: jest.fn(() => 'push-op'),
    fail: jest.fn(),
    succeed: jest.fn(),
  },
}));

describe('pushAll', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  it('pushes after a local commit even when the ahead snapshot is stale', async () => {
    const status = GitEngine.status as jest.MockedFunction<typeof GitEngine.status>;
    const pushWithIntegrate = GitEngine.pushWithIntegrate as jest.MockedFunction<typeof GitEngine.pushWithIntegrate>;
    const workingTreeUri = GitFsService.workingTreeUri as jest.MockedFunction<typeof GitFsService.workingTreeUri>;
    const capturePreflight = GitSyncGate.capturePreflight as jest.MockedFunction<typeof GitSyncGate.capturePreflight>;
    const verifyPostflight = GitSyncGate.verifyPostflight as jest.MockedFunction<typeof GitSyncGate.verifyPostflight>;

    status.mockResolvedValue({
      branch: 'master',
      branches: [],
      currentBranch: 'master',
      ahead: 0,
      behind: 0,
    });
    workingTreeUri.mockReturnValue('file:///repo');
    capturePreflight.mockResolvedValue({
      repoId: 'repo-1',
      repoPath: 'file:///repo',
      activeBranch: 'master',
      headOid: 'head-1',
    });
    verifyPostflight.mockResolvedValue({ ok: true });
    pushWithIntegrate.mockResolvedValue({
      ok: true,
      pushed: 1,
      integrated: 'false',
      kind: 'Direct',
      conflicts: [],
      message: 'pushed refs/heads/master to origin/master',
    });

    const result = await pushAll([{ id: 'repo-1', path: 'owner/repo', name: 'repo' } as GitRepository]);

    expect(pushWithIntegrate).toHaveBeenCalledWith('file:///repo', 'origin', 'repo-1');
    expect(result.ok).toBe(true);
  });

  it('fails the registry operation when postflight verification rejects the push', async () => {
    const status = GitEngine.status as jest.MockedFunction<typeof GitEngine.status>;
    const pushWithIntegrate = GitEngine.pushWithIntegrate as jest.MockedFunction<typeof GitEngine.pushWithIntegrate>;
    const workingTreeUri = GitFsService.workingTreeUri as jest.MockedFunction<typeof GitFsService.workingTreeUri>;
    const capturePreflight = GitSyncGate.capturePreflight as jest.MockedFunction<typeof GitSyncGate.capturePreflight>;
    const verifyPostflight = GitSyncGate.verifyPostflight as jest.MockedFunction<typeof GitSyncGate.verifyPostflight>;

    status.mockResolvedValue({ branch: 'master', branches: [], currentBranch: 'master', ahead: 0, behind: 0 });
    workingTreeUri.mockReturnValue('file:///repo');
    capturePreflight.mockResolvedValue({
      repoId: 'repo-1',
      repoPath: 'file:///repo',
      activeBranch: 'master',
      headOid: 'head-1',
    });
    verifyPostflight.mockResolvedValue({ ok: false, reason: 'head-changed' });
    pushWithIntegrate.mockResolvedValue({
      ok: true,
      pushed: 1,
      integrated: 'false',
      kind: 'Direct',
      conflicts: [],
      message: 'pushed refs/heads/master to origin/master',
    });

    const result = await pushAll([{ id: 'repo-1', path: 'owner/repo', name: 'repo' } as GitRepository]);

    expect(result.ok).toBe(false);
    expect(gitOperationRegistry.fail).toHaveBeenCalledWith('push-op', 'Branch state changed during push (head-changed)');
  });
});

describe('commitAll', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  it('invokes author resolver per repo and passes result to GitEngine.commit', async () => {
    const statuses = GitEngine.statuses as jest.MockedFunction<typeof GitEngine.statuses>;
    const commit = GitEngine.commit as jest.MockedFunction<typeof GitEngine.commit>;
    const workingTreeUri = GitFsService.workingTreeUri as jest.MockedFunction<typeof GitFsService.workingTreeUri>;

    workingTreeUri.mockImplementation(({ repoPath }) => `file:///${repoPath}`);
    statuses.mockResolvedValue([
      { path: 'a.txt', status: 'Modified', staged: true },
      { path: 'b.txt', status: 'Modified', staged: true },
    ]);
    commit.mockResolvedValue(COMMIT_INFO);

    const authorResolver = jest.fn<(repo: GitRepository) => Promise<Author | null>>();
    authorResolver.mockResolvedValue({ name: 'Test Author', email: 'test@example.com' });

    const repos = [
      { id: 'repo-1', path: 'owner/repo1', name: 'repo1' } as GitRepository,
      { id: 'repo-2', path: 'owner/repo2', name: 'repo2' } as GitRepository,
    ];

    const result = await commitAll(repos, 'Test commit', authorResolver);

    expect(authorResolver).toHaveBeenCalledTimes(2);
    expect(authorResolver).toHaveBeenCalledWith(repos[0]);
    expect(authorResolver).toHaveBeenCalledWith(repos[1]);
    expect(commit).toHaveBeenCalledTimes(2);
    expect(commit).toHaveBeenCalledWith(`file:///owner/repo1`, 'Test commit', { name: 'Test Author', email: 'test@example.com' });
    expect(commit).toHaveBeenCalledWith(`file:///owner/repo2`, 'Test commit', { name: 'Test Author', email: 'test@example.com' });
    expect(result.ok).toBe(true);
    expect(result.totalActed).toBe(2);
  });

  it('reports resolver failure for a specific repo', async () => {
    const statuses = GitEngine.statuses as jest.MockedFunction<typeof GitEngine.statuses>;
    const commit = GitEngine.commit as jest.MockedFunction<typeof GitEngine.commit>;
    const workingTreeUri = GitFsService.workingTreeUri as jest.MockedFunction<typeof GitFsService.workingTreeUri>;

    workingTreeUri.mockImplementation(({ repoPath }) => `file:///${repoPath}`);
    statuses.mockResolvedValue([
      { path: 'a.txt', status: 'Modified', staged: true },
    ]);
    commit.mockResolvedValue(COMMIT_INFO);

    const authorResolver = jest.fn<(repo: GitRepository) => Promise<Author | null>>();
    // repo-1 succeeds, repo-2 fails
    authorResolver.mockImplementation(async (repo) => {
      if (repo.id === 'repo-2') {
        throw new Error('Author resolution failed');
      }
      return { name: 'Test Author', email: 'test@example.com' };
    });

    const repos = [
      { id: 'repo-1', path: 'owner/repo1', name: 'repo1' } as GitRepository,
      { id: 'repo-2', path: 'owner/repo2', name: 'repo2' } as GitRepository,
    ];

    const result = await commitAll(repos, 'Test commit', authorResolver);

    expect(result.ok).toBe(false);
    expect(result.failures).toHaveLength(1);
    expect(result.failures[0].repoId).toBe('repo-2');
    expect(result.failures[0].error).toBe('Author resolution failed');
    // repo-1 should have succeeded
    expect(result.outcomes.find((o) => o.repoId === 'repo-1')?.ok).toBe(true);
  });

  it('reports a missing author without invoking native commit', async () => {
    const statuses = GitEngine.statuses as jest.MockedFunction<typeof GitEngine.statuses>;
    const commit = GitEngine.commit as jest.MockedFunction<typeof GitEngine.commit>;
    const workingTreeUri = GitFsService.workingTreeUri as jest.MockedFunction<typeof GitFsService.workingTreeUri>;

    workingTreeUri.mockReturnValue('file:///repo');
    statuses.mockResolvedValue([
      { path: 'a.txt', status: 'Modified', staged: true },
    ]);

    const result = await commitAll(
      [{ id: 'repo-1', path: 'owner/repo', name: 'repo' } as GitRepository],
      'Test commit',
      async () => null,
    );

    expect(result.ok).toBe(false);
    expect(result.failures[0]?.error).toBe('Missing commit author');
    expect(commit).not.toHaveBeenCalled();
  });

  it('skips repos with no staged files', async () => {
    const statuses = GitEngine.statuses as jest.MockedFunction<typeof GitEngine.statuses>;
    const commit = GitEngine.commit as jest.MockedFunction<typeof GitEngine.commit>;
    const workingTreeUri = GitFsService.workingTreeUri as jest.MockedFunction<typeof GitFsService.workingTreeUri>;

    workingTreeUri.mockReturnValue('file:///repo');
    // repo-1 has staged files, repo-2 has none
    statuses.mockResolvedValueOnce([
      { path: 'a.txt', status: 'Modified', staged: true },
    ]).mockResolvedValueOnce([]);

    const authorResolver = jest.fn<(repo: GitRepository) => Promise<Author | null>>();
    authorResolver.mockResolvedValue({ name: 'Test Author', email: 'test@example.com' });

    const repos = [
      { id: 'repo-1', path: 'owner/repo1', name: 'repo1' } as GitRepository,
      { id: 'repo-2', path: 'owner/repo2', name: 'repo2' } as GitRepository,
    ];

    const result = await commitAll(repos, 'Test commit', authorResolver);

    // authorResolver called only for repo-1 (repo-2 skipped)
    expect(authorResolver).toHaveBeenCalledTimes(1);
    expect(authorResolver).toHaveBeenCalledWith(repos[0]);
    expect(commit).toHaveBeenCalledTimes(1);
    expect(result.ok).toBe(true);
    expect(result.totalActed).toBe(1);
  });

  it('accepts Author object directly instead of resolver function', async () => {
    const statuses = GitEngine.statuses as jest.MockedFunction<typeof GitEngine.statuses>;
    const commit = GitEngine.commit as jest.MockedFunction<typeof GitEngine.commit>;
    const workingTreeUri = GitFsService.workingTreeUri as jest.MockedFunction<typeof GitFsService.workingTreeUri>;

    workingTreeUri.mockReturnValue('file:///repo');
    statuses.mockResolvedValue([
      { path: 'a.txt', status: 'Modified', staged: true },
    ]);
    commit.mockResolvedValue(COMMIT_INFO);

    const author: Author = { name: 'Direct Author', email: 'direct@example.com' };

    const result = await commitAll(
      [{ id: 'repo-1', path: 'owner/repo', name: 'repo' } as GitRepository],
      'Test commit',
      author,
    );

    expect(commit).toHaveBeenCalledWith('file:///repo', 'Test commit', author);
    expect(result.ok).toBe(true);
  });
});
