import { GitFsService, remoteUrlForHost } from '@/services/git/GitFsService';
import { autoMergeCrdtConflicts } from '@/services/git/conflictResolution';
import { StorageService } from '@/services/StorageService';
import * as GitEngine from '@/services/git/engine/GitEngine';
import * as KeepAwake from 'expo-keep-awake';

jest.mock('expo-file-system/legacy', () => ({
  documentDirectory: 'file:///documents/',
}));

jest.mock('@/services/git/engine/GitEngine', () => ({
  clone: jest.fn(),
  repoInfo: jest.fn(),
  fetch: jest.fn(),
  pull: jest.fn(),
}));

jest.mock('expo-keep-awake', () => ({
  activateKeepAwakeAsync: jest.fn(),
  deactivateKeepAwake: jest.fn(),
}));

jest.mock('@/services/git/gitFs', () => ({
  makeGitFs: jest.fn(() => ({ promises: { readFile: jest.fn() } })),
}));

jest.mock('@/services/git/lfs', () => ({
  LfsService: { scanRepo: jest.fn().mockResolvedValue(undefined) },
}));

jest.mock('@/services/StorageService', () => ({
  StorageService: { getSavedRepositories: jest.fn() },
}));

jest.mock('@/services/git/conflictResolution', () => ({
  autoMergeCrdtConflicts: jest.fn(),
}));

describe('GitFsService.clone screen-awake lifecycle', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    jest.mocked(KeepAwake.activateKeepAwakeAsync).mockResolvedValue(undefined);
    jest.mocked(KeepAwake.deactivateKeepAwake).mockResolvedValue(undefined);
    (GitEngine.repoInfo as jest.Mock).mockResolvedValue({ currentBranch: 'main' });
  });

  it('keeps the screen awake until a clone completes', async () => {
    const clone = GitEngine.clone as jest.MockedFunction<typeof GitEngine.clone>;
    clone.mockResolvedValue('');

    await GitFsService.clone({ repoPath: 'owner/repo', branch: 'main' });

    expect(KeepAwake.activateKeepAwakeAsync).toHaveBeenCalledWith(expect.any(String));
    expect(KeepAwake.deactivateKeepAwake).toHaveBeenCalledWith(
      jest.mocked(KeepAwake.activateKeepAwakeAsync).mock.calls[0][0],
    );
  });

  it('releases the screen-awake lock when a clone fails', async () => {
    const clone = GitEngine.clone as jest.MockedFunction<typeof GitEngine.clone>;
    clone.mockRejectedValue(new Error('clone failed'));

    await expect(GitFsService.clone({ repoPath: 'owner/repo', branch: 'main' })).rejects.toThrow('clone failed');

    expect(KeepAwake.deactivateKeepAwake).toHaveBeenCalledWith(
      jest.mocked(KeepAwake.activateKeepAwakeAsync).mock.calls[0][0],
    );
  });
});

describe('GitFsService.pullWithFastForward', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    jest.mocked(StorageService.getSavedRepositories).mockResolvedValue([]);
  });

  it('pulls remote changes through the native GitEngine bridge', async () => {
    const pull = GitEngine.pull as jest.MockedFunction<typeof GitEngine.pull>;
    pull.mockResolvedValue({ ok: true });

    const result = await GitFsService.pullWithFastForward({
      repoPath: 'owner/repo',
      branch: 'main',
      token: 'token',
      repoId: 'repo-id',
    });

    expect(result).toEqual({ ok: true });
    expect(pull).toHaveBeenCalledWith('file:///documents/GitNotes/owner/repo', 'origin', 'repo-id');
  });

  it('surfaces native pull conflicts instead of reporting success', async () => {
    const pull = GitEngine.pull as jest.MockedFunction<typeof GitEngine.pull>;
    pull.mockResolvedValue({ ok: false, error: 'merge conflict in notes/example.md' });

    const result = await GitFsService.pullWithFastForward({
      repoPath: 'owner/repo',
      branch: 'main',
      repoId: 'repo-id',
    });

    expect(result).toEqual({
      ok: false,
      reason: 'diverged',
      error: 'merge conflict in notes/example.md',
    });
  });

  describe('with CRDT merge enabled', () => {
    const savedRepo = { id: 'repo-id', path: 'owner/repo', name: 'repo', branch: 'main', crdtMergeEnabled: true };
    const pullOpts = { repoPath: 'owner/repo', branch: 'main', repoId: 'repo-id' };

    beforeEach(() => {
      jest.mocked(StorageService.getSavedRepositories).mockResolvedValue([savedRepo]);
      (GitEngine.pull as jest.Mock).mockResolvedValue({ ok: false, error: 'merge of refs/remotes/origin/main produced 1 conflicts' });
    });

    it('reports success when the conflicts auto-merge', async () => {
      jest.mocked(autoMergeCrdtConflicts).mockResolvedValue(true);

      await expect(GitFsService.pullWithFastForward(pullOpts)).resolves.toEqual({ ok: true });
      expect(autoMergeCrdtConflicts).toHaveBeenCalledWith(savedRepo);
    });

    it('keeps reporting diverged when the auto-merge declines', async () => {
      jest.mocked(autoMergeCrdtConflicts).mockResolvedValue(false);

      await expect(GitFsService.pullWithFastForward(pullOpts)).resolves.toMatchObject({ ok: false, reason: 'diverged' });
    });

    it('does not auto-merge failures that are not conflicts', async () => {
      (GitEngine.pull as jest.Mock).mockResolvedValue({ ok: false, error: 'working tree has uncommitted changes' });

      await GitFsService.pullWithFastForward(pullOpts);

      expect(autoMergeCrdtConflicts).not.toHaveBeenCalled();
    });
  });
});

describe('GitFsService.getCurrentBranch', () => {
  it('reads the native repository HEAD branch', async () => {
    (GitEngine.repoInfo as jest.Mock).mockResolvedValue({ currentBranch: 'master' });

    await expect(GitFsService.getCurrentBranch({ repoPath: 'owner/repo' })).resolves.toBe('master');
    expect(GitEngine.repoInfo).toHaveBeenCalledWith('file:///documents/GitNotes/owner/repo');
  });
});

describe('GitFsService.fetch', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  it('passes the absolute worktree path to the native GitEngine bridge', async () => {
    const fetch = GitEngine.fetch as jest.MockedFunction<typeof GitEngine.fetch>;
    fetch.mockResolvedValue(undefined);

    await GitFsService.fetch({
      repoPath: 'owner/repo',
      branch: 'main',
      token: 'token',
      repoId: 'repo-id',
    });

    expect(fetch).toHaveBeenCalledWith('file:///documents/GitNotes/owner/repo', 'origin', 'repo-id');
  });
});

describe('remoteUrlForHost', () => {
  describe('Gitea/Forgejo direct-root HTTPS (API base with /api/v1 suffix)', () => {
    it('strips /api/v1 suffix from instanceBaseUrl for direct-root clone URL', () => {
      const url = remoteUrlForHost('owner', 'repo', {
        useSsh: false,
        provider: 'gitea',
        instanceBaseUrl: 'http://localhost:3000/api/v1',
      });
      expect(url).toBe('http://localhost:3000/owner/repo.git');
      expect(url).not.toContain('/api/v1/');
    });

    it('handles instanceBaseUrl with trailing slash after /api/v1', () => {
      const url = remoteUrlForHost('owner', 'repo', {
        useSsh: false,
        provider: 'gitea',
        instanceBaseUrl: 'http://localhost:3000/api/v1/',
      });
      expect(url).toBe('http://localhost:3000/owner/repo.git');
      expect(url).not.toContain('/api/v1/');
    });

    it('handles https Gitea/Forgejo instance with /api/v1 base', () => {
      const url = remoteUrlForHost('myowner', 'myrepo', {
        useSsh: false,
        provider: 'gitea',
        instanceBaseUrl: 'https://gitea.example.com/api/v1',
      });
      expect(url).toBe('https://gitea.example.com/myowner/myrepo.git');
      expect(url).not.toContain('/api/v1/');
    });
  });

  describe('GitHub HTTPS (unchanged behavior — no /api/v1 handling)', () => {
    it('returns standard GitHub HTTPS URL', () => {
      const url = remoteUrlForHost('owner', 'repo', {
        useSsh: false,
        provider: 'github',
        instanceBaseUrl: null,
      });
      expect(url).toBe('https://github.com/owner/repo.git');
    });

    it('returns standard GitLab HTTPS URL', () => {
      const url = remoteUrlForHost('owner', 'repo', {
        useSsh: false,
        provider: 'gitlab',
        instanceBaseUrl: null,
      });
      expect(url).toBe('https://gitlab.com/owner/repo.git');
    });
  });

  describe('SSH URLs (unchanged — out of scope for this fix)', () => {
    it('returns GitHub SSH URL', () => {
      const url = remoteUrlForHost('owner', 'repo', {
        useSsh: true,
        provider: 'github',
        instanceBaseUrl: null,
      });
      expect(url).toBe('git@github.com:owner/repo.git');
    });

    it('returns GitLab SSH URL', () => {
      const url = remoteUrlForHost('owner', 'repo', {
        useSsh: true,
        provider: 'gitlab',
        instanceBaseUrl: null,
      });
      expect(url).toBe('git@gitlab.com:owner/repo.git');
    });
  });
});
