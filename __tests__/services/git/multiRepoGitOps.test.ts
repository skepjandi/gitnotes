import { beforeEach, describe, expect, it, jest } from '@jest/globals';
import type { GitRepository } from '../../../src/services/GitService';
import * as GitEngine from '../../../src/services/git/engine/GitEngine';
import { GitFsService } from '../../../src/services/git/GitFsService';
import { GitSyncGate } from '../../../src/services/git/GitSyncGate';
import { pushAll } from '../../../src/services/git/multiRepoGitOps';
import { gitOperationRegistry } from '../../../src/stores/gitOperationStore';

jest.mock('../../../src/services/git/engine/GitEngine', () => ({
  status: jest.fn(),
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
