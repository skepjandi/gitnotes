import { requireNativeModule } from 'expo-modules-core';

jest.mock('expo-modules-core', () => ({
  requireNativeModule: jest.fn(() => ({
    pull: jest.fn(),
    clone: jest.fn(),
    pushWithIntegrate: jest.fn(),
    getCredential: jest.fn(),
    setCredential: jest.fn(),
    fileHistory: jest.fn(),
    readBlobAtRef: jest.fn(),
    checkout: jest.fn(),
    resetSoft: jest.fn(),
  })),
}));

jest.mock('@/services/AuthService', () => ({
  AuthService: {
    getToken: jest.fn(),
  },
}));

jest.mock('@/services/AccountStorage', () => ({
  AccountStorage: {
    getHostConnection: jest.fn(),
    getHostToken: jest.fn(),
    getGitHubAppCredential: jest.fn(),
    getOAuthCredential: jest.fn(),
  },
}));

jest.mock('@/services/StorageService', () => ({
  StorageService: {
    getSavedRepositories: jest.fn(),
  },
}));

jest.mock('react-native', () => ({
  Platform: { OS: 'ios' },
}));

jest.mock('expo-web-browser', () => ({
  openBrowserAsync: jest.fn(),
}));

import * as GitEngine from '@/services/git/engine/GitEngine';
import { ANDROID_NATIVE_BUILD_COMMAND } from '@/services/git/engine/GitEngine';
import { AuthService } from '@/services/AuthService';
import { AccountStorage } from '@/services/AccountStorage';
import { StorageService } from '@/services/StorageService';

const nativeModule = (requireNativeModule as jest.Mock).mock.results[0].value as {
  pull: jest.Mock;
  clone: jest.Mock;
  pushWithIntegrate: jest.Mock;
  getCredential: jest.Mock;
  setCredential: jest.Mock;
  fileHistory: jest.Mock;
  readBlobAtRef: jest.Mock;
  checkout: jest.Mock;
  resetSoft: jest.Mock;
};

describe('GitEngine Android build guidance', () => {
  it('uses the runnable Android Rust build script command', () => {
    expect(ANDROID_NATIVE_BUILD_COMMAND).toBe('yarn build:rust:android');
  });
});

describe('GitEngine.pull', () => {
  beforeEach(() => {
    nativeModule.pull.mockReset();
    nativeModule.pushWithIntegrate.mockReset();
    nativeModule.getCredential.mockReset();
    nativeModule.setCredential.mockReset();
    jest.mocked(AuthService.getToken).mockReset();
    jest.mocked(AccountStorage.getHostConnection).mockReset();
    jest.mocked(AccountStorage.getHostToken).mockReset();
    jest.mocked(StorageService.getSavedRepositories).mockReset();
    nativeModule.pull.mockResolvedValue({ kind: 'UpToDate', message: 'up to date', conflicts: [] });
    nativeModule.pushWithIntegrate.mockResolvedValue({
      ok: false,
      kind: 'Error',
      message: '',
      conflicts: [],
      pushed: 0,
    });
    nativeModule.getCredential.mockResolvedValue(null);
    nativeModule.setCredential.mockResolvedValue(undefined);
    jest.mocked(AuthService.getToken).mockResolvedValue('new-token');
    jest.mocked(StorageService.getSavedRepositories).mockResolvedValue([]);
    jest.mocked(AccountStorage.getHostConnection).mockResolvedValue(null);
    jest.mocked(AccountStorage.getHostToken).mockResolvedValue(null);
  });

  it('maps a native fast-forward result to the facade success contract', async () => {
    nativeModule.pull.mockResolvedValue({ kind: 'FastForward', message: 'updated', conflicts: [] });

    const result = await GitEngine.pull('/repo', 'origin');

    expect(result).toEqual({ ok: true });
  });

  it('maps an unborn native result to the facade success contract', async () => {
    nativeModule.pull.mockResolvedValue({ kind: 'Unborn', message: 'unborn HEAD: nothing to pull', conflicts: [] });

    const result = await GitEngine.pull('/repo', 'origin');

    expect(result).toEqual({ ok: true });
  });

  it('maps a native conflict result to the facade failure contract', async () => {
    nativeModule.pull.mockResolvedValue({
      kind: 'Conflict',
      message: 'merge conflict',
      conflicts: [{ path: 'notes/example.md', ours: null, theirs: null, ancestor: null, status: 'both' }],
    });

    const result = await GitEngine.pull('/repo', 'origin');

    expect(result).toEqual({ ok: false, error: 'merge conflict' });
  });

  it('refreshes a cached HTTPS credential from the active token', async () => {
    nativeModule.getCredential.mockResolvedValue({
      kind: 'userpass',
      username: 'x-access-token',
      password: 'old-token',
    });

    await GitEngine.pull('/repo', 'origin', 'repo-1');

    expect(nativeModule.setCredential).toHaveBeenCalledWith('repo-1', {
      kind: 'userpass',
      username: 'x-access-token',
      password: 'new-token',
    });
  });

  it('keeps a cached SSH credential instead of replacing it with the active token', async () => {
    const sshCredential = {
      kind: 'ssh',
      username: 'git',
      privateKey: 'private-key',
      publicKey: 'public-key',
      passphrase: null,
    };
    nativeModule.getCredential.mockResolvedValue(sshCredential);

    await GitEngine.pull('/repo', 'origin', 'repo-1');

    expect(nativeModule.setCredential).not.toHaveBeenCalled();
  });

  it('restores a Forgejo credential from the repository host after reload', async () => {
    nativeModule.getCredential.mockResolvedValue(null);
    jest.mocked(StorageService.getSavedRepositories).mockResolvedValue([
      {
        id: 'repo-forgejo',
        path: 'forgeadmin/test-repo',
        name: 'test-repo',
        provider: 'forgejo',
        hostId: 'account:forgejo:instance',
      },
    ]);
    jest.mocked(AccountStorage.getHostConnection).mockResolvedValue({
      id: 'account:forgejo:instance',
      accountId: 'account',
      provider: 'forgejo',
      instanceBaseUrl: 'http://192.168.1.16:3030/api/v1',
      hostLogin: 'forgeadmin',
      hostUserId: 1,
      name: 'Forgejo',
      email: null,
      avatarUrl: null,
      addedAt: 0,
    });
    jest.mocked(AccountStorage.getHostToken).mockResolvedValue('forgejo-token');

    await GitEngine.pull('/repo', 'origin', 'repo-forgejo');

    expect(nativeModule.setCredential).toHaveBeenCalledWith('repo-forgejo', {
      kind: 'userpass',
      username: 'forgeadmin',
      password: 'forgejo-token',
    });
    expect(AuthService.getToken).not.toHaveBeenCalled();
  });
});

describe('GitEngine.clone auth fallback chain', () => {
  beforeEach(() => {
    nativeModule.clone.mockReset();
    nativeModule.getCredential.mockReset();
    nativeModule.setCredential.mockReset();
    jest.mocked(AccountStorage.getHostConnection).mockReset();
    jest.mocked(AccountStorage.getHostToken).mockReset();
    jest.mocked(AccountStorage.getGitHubAppCredential).mockReset();
    jest.mocked(AccountStorage.getOAuthCredential).mockReset();
    jest.mocked(StorageService.getSavedRepositories).mockReset();
    nativeModule.getCredential.mockResolvedValue(null);
    nativeModule.setCredential.mockResolvedValue(undefined);
    jest.mocked(StorageService.getSavedRepositories).mockResolvedValue([
      {
        id: 'github/owner/repo',
        path: 'github/owner/repo',
        name: 'repo',
        provider: 'github',
        hostId: 'github-host',
      },
    ]);
    jest.mocked(AccountStorage.getHostConnection).mockResolvedValue({
      id: 'github-host',
      accountId: 'account',
      provider: 'github',
      instanceBaseUrl: 'https://github.com',
      hostLogin: 'testuser',
      hostUserId: 1,
      name: 'GitHub',
      email: null,
      avatarUrl: null,
      addedAt: 0,
    });
    jest.mocked(AccountStorage.getHostToken).mockResolvedValue(null);
    jest.mocked(AccountStorage.getGitHubAppCredential).mockResolvedValue({
      kind: 'github_app' as const,
      token: 'github-app-token',
      appId: 1,
      appName: 'GitNotes',
      selectedRepositories: [{ owner: 'owner', repo: 'repo' }],
    });
    jest.mocked(AccountStorage.getOAuthCredential).mockResolvedValue({
      kind: 'oauth' as const,
      accessToken: 'oauth-token',
      provider: 'github',
    });
  });

  it('retries with OAuth after GitHub App fails with too many redirects during clone', async () => {
    nativeModule.clone
      .mockRejectedValueOnce(new Error('Git(message: "too many redirects or authentication replays", corruption: false)'))
      .mockResolvedValueOnce('/dest');

    const result = await GitEngine.clone('https://github.com/owner/repo.git', '/dest', 'github/owner/repo');

    expect(result).toBe('/dest');
    expect(nativeModule.clone).toHaveBeenCalledTimes(2);
    expect(nativeModule.setCredential).toHaveBeenCalledWith('github/owner/repo', {
      kind: 'userpass',
      username: 'x-access-token',
      password: 'github-app-token',
    });
    expect(nativeModule.setCredential).toHaveBeenLastCalledWith('github/owner/repo', {
      kind: 'userpass',
      username: 'x-access-token',
      password: 'oauth-token',
    });
  });
});

describe('GitEngine.pull auth fallback chain', () => {
  beforeEach(() => {
    nativeModule.pull.mockReset();
    nativeModule.getCredential.mockReset();
    nativeModule.setCredential.mockReset();
    jest.mocked(AuthService.getToken).mockReset();
    jest.mocked(AccountStorage.getHostConnection).mockReset();
    jest.mocked(AccountStorage.getHostToken).mockReset();
    jest.mocked(AccountStorage.getGitHubAppCredential).mockReset();
    jest.mocked(AccountStorage.getOAuthCredential).mockReset();
    jest.mocked(StorageService.getSavedRepositories).mockReset();
    nativeModule.pull.mockResolvedValue({ kind: 'UpToDate', message: 'up to date', conflicts: [] });
    nativeModule.getCredential.mockResolvedValue(null);
    nativeModule.setCredential.mockResolvedValue(undefined);
    jest.mocked(AuthService.getToken).mockResolvedValue('new-token');
    jest.mocked(StorageService.getSavedRepositories).mockResolvedValue([
      {
        id: 'github/owner/repo',
        path: 'github/owner/repo',
        name: 'repo',
        provider: 'github',
        hostId: 'github-host',
      },
    ]);
    jest.mocked(AccountStorage.getHostConnection).mockResolvedValue({
      id: 'github-host',
      accountId: 'account',
      provider: 'github',
      instanceBaseUrl: 'https://github.com',
      hostLogin: 'testuser',
      hostUserId: 1,
      name: 'GitHub',
      email: null,
      avatarUrl: null,
      addedAt: 0,
    });
    jest.mocked(AccountStorage.getHostToken).mockResolvedValue(null);
    jest.mocked(AccountStorage.getGitHubAppCredential).mockResolvedValue(null);
    jest.mocked(AccountStorage.getOAuthCredential).mockResolvedValue(null);
  });

  it('retries with OAuth after GitHub App fails with too many redirects error', async () => {
    nativeModule.pull
      .mockResolvedValueOnce({
        ok: false,
        error: 'too many redirects or authentication replays',
        message: 'too many redirects or authentication replays',
        conflicts: [],
      })
      .mockResolvedValueOnce({ kind: 'UpToDate', message: 'up to date', conflicts: [] });

    jest.mocked(AccountStorage.getGitHubAppCredential).mockResolvedValue({
      kind: 'github_app' as const,
      token: 'github-app-token',
      appId: 1,
      appName: 'GitNotes',
      selectedRepositories: [{ owner: 'owner', repo: 'repo' }],
    });
    jest.mocked(AccountStorage.getOAuthCredential).mockResolvedValue({
      kind: 'oauth' as const,
      accessToken: 'oauth-token',
      provider: 'github',
    });

    const result = await GitEngine.pull('/repo', 'origin', 'github/owner/repo');

    expect(result).toEqual({ ok: true });
    expect(nativeModule.pull).toHaveBeenCalledTimes(2);
    expect(nativeModule.setCredential).toHaveBeenCalledWith('github/owner/repo', {
      kind: 'userpass',
      username: 'x-access-token',
      password: 'github-app-token',
    });
    expect(nativeModule.setCredential).toHaveBeenLastCalledWith('github/owner/repo', {
      kind: 'userpass',
      username: 'x-access-token',
      password: 'oauth-token',
    });
  });

  it('rejects a push when no credential source is available', async () => {
    jest.mocked(AuthService.getToken).mockResolvedValue(null);

    await expect(GitEngine.pushWithIntegrate('/repo', 'origin', 'repo-without-credentials'))
      .rejects.toThrow('No credentials found for repo repo-without-credentials');
    expect(nativeModule.pushWithIntegrate).not.toHaveBeenCalled();
  });
});

describe('GitEngine.pushWithIntegrate auth fallback chain', () => {
  beforeEach(() => {
    nativeModule.pull.mockReset();
    nativeModule.pushWithIntegrate.mockReset();
    nativeModule.getCredential.mockReset();
    nativeModule.setCredential.mockReset();
    jest.mocked(AuthService.getToken).mockReset();
    jest.mocked(AccountStorage.getHostConnection).mockReset();
    jest.mocked(AccountStorage.getHostToken).mockReset();
    jest.mocked(AccountStorage.getGitHubAppCredential).mockReset();
    jest.mocked(AccountStorage.getOAuthCredential).mockReset();
    jest.mocked(StorageService.getSavedRepositories).mockReset();
    nativeModule.pushWithIntegrate.mockResolvedValue({
      ok: false,
      kind: 'Error',
      message: '',
      conflicts: [],
      pushed: 0,
    });
    nativeModule.getCredential.mockResolvedValue(null);
    nativeModule.setCredential.mockResolvedValue(undefined);
    jest.mocked(AuthService.getToken).mockResolvedValue('new-token');
    jest.mocked(StorageService.getSavedRepositories).mockResolvedValue([
      {
        id: 'github/owner/repo',
        path: 'github/owner/repo',
        name: 'repo',
        provider: 'github',
        hostId: 'github-host',
      },
    ]);
    jest.mocked(AccountStorage.getHostConnection).mockResolvedValue({
      id: 'github-host',
      accountId: 'account',
      provider: 'github',
      instanceBaseUrl: 'https://github.com',
      hostLogin: 'testuser',
      hostUserId: 1,
      name: 'GitHub',
      email: null,
      avatarUrl: null,
      addedAt: 0,
    });
    jest.mocked(AccountStorage.getHostToken).mockResolvedValue(null);
    jest.mocked(AccountStorage.getGitHubAppCredential).mockResolvedValue(null);
    jest.mocked(AccountStorage.getOAuthCredential).mockResolvedValue(null);
  });

  it('retries with OAuth after GitHub App fails with auth error', async () => {
    const authError = new Error('Authentication failed');
    nativeModule.pushWithIntegrate
      .mockRejectedValueOnce(authError)
      .mockResolvedValueOnce({ ok: true, message: 'pushed', conflicts: [], pushed: 1 });

    jest.mocked(AccountStorage.getGitHubAppCredential).mockResolvedValue({
      kind: 'github_app' as const,
      token: 'github-app-token',
      appId: 1,
      appName: 'GitNotes',
      selectedRepositories: [{ owner: 'owner', repo: 'repo' }],
    });
    jest.mocked(AccountStorage.getOAuthCredential).mockResolvedValue({
      kind: 'oauth' as const,
      accessToken: 'oauth-token',
      provider: 'github',
    });

    const result = await GitEngine.pushWithIntegrate('/repo', 'origin', 'github/owner/repo');

    expect(result.ok).toBe(true);
    expect(nativeModule.pushWithIntegrate).toHaveBeenCalledTimes(2);
    expect(nativeModule.setCredential).toHaveBeenCalledWith('github/owner/repo', {
      kind: 'userpass',
      username: 'x-access-token',
      password: 'github-app-token',
    });
    expect(nativeModule.setCredential).toHaveBeenLastCalledWith('github/owner/repo', {
      kind: 'userpass',
      username: 'x-access-token',
      password: 'oauth-token',
    });
  });

  it('retries with PAT after GitHub App and OAuth both fail with auth errors', async () => {
    const authError = new Error('Authentication failed');
    nativeModule.pushWithIntegrate
      .mockRejectedValueOnce(authError)
      .mockRejectedValueOnce(authError)
      .mockResolvedValueOnce({ ok: true, message: 'pushed', conflicts: [], pushed: 1 });

    jest.mocked(AccountStorage.getGitHubAppCredential).mockResolvedValue({
      kind: 'github_app' as const,
      token: 'github-app-token',
      appId: 1,
      appName: 'GitNotes',
      selectedRepositories: [{ owner: 'owner', repo: 'repo' }],
    });
    jest.mocked(AccountStorage.getOAuthCredential).mockResolvedValue({
      kind: 'oauth' as const,
      accessToken: 'oauth-token',
      provider: 'github',
    });
    jest.mocked(AccountStorage.getHostToken).mockResolvedValue('pat-token');

    const result = await GitEngine.pushWithIntegrate('/repo', 'origin', 'github/owner/repo');

    expect(result.ok).toBe(true);
    expect(nativeModule.pushWithIntegrate).toHaveBeenCalledTimes(3);
  });

  it('fails after all credentials exhaust auth errors (App -> OAuth -> PAT)', async () => {
    const authError = new Error('Authentication failed');
    nativeModule.pushWithIntegrate
      .mockRejectedValueOnce(authError)
      .mockRejectedValueOnce(authError)
      .mockRejectedValueOnce(authError);

    jest.mocked(AccountStorage.getGitHubAppCredential).mockResolvedValue({
      kind: 'github_app' as const,
      token: 'github-app-token',
      appId: 1,
      appName: 'GitNotes',
      selectedRepositories: [{ owner: 'owner', repo: 'repo' }],
    });
    jest.mocked(AccountStorage.getOAuthCredential).mockResolvedValue({
      kind: 'oauth' as const,
      accessToken: 'oauth-token',
      provider: 'github',
    });
    jest.mocked(AccountStorage.getHostToken).mockResolvedValue('pat-token');

    await expect(GitEngine.pushWithIntegrate('/repo', 'origin', 'github/owner/repo')).rejects.toThrow('Authentication failed');
    expect(nativeModule.pushWithIntegrate).toHaveBeenCalledTimes(3);
  });

  it('does not retry when native operation fails with 403 permission error', async () => {
    nativeModule.pushWithIntegrate.mockResolvedValueOnce({
      ok: false,
      error: 'Permission denied',
      message: 'Permission denied',
      conflicts: [],
      pushed: 0,
    });

    jest.mocked(AccountStorage.getGitHubAppCredential).mockResolvedValue({
      kind: 'github_app' as const,
      token: 'github-app-token',
      appId: 1,
      appName: 'GitNotes',
      selectedRepositories: [{ owner: 'owner', repo: 'repo' }],
    });
    jest.mocked(AccountStorage.getOAuthCredential).mockResolvedValue({
      kind: 'oauth' as const,
      accessToken: 'oauth-token',
      provider: 'github',
    });
    jest.mocked(AccountStorage.getHostToken).mockResolvedValue('pat-token');

    const result = await GitEngine.pushWithIntegrate('/repo', 'origin', 'github/owner/repo');

    expect(result.ok).toBe(false);
    expect(result.error).toContain('Permission denied');
    expect(nativeModule.pushWithIntegrate).toHaveBeenCalledTimes(1);
  });

  it('does not retry when native operation fails with network error', async () => {
    nativeModule.pushWithIntegrate.mockResolvedValueOnce({
      ok: false,
      error: 'Network error: ECONNREFUSED',
      message: 'Network error: ECONNREFUSED',
      conflicts: [],
      pushed: 0,
    });

    jest.mocked(AccountStorage.getGitHubAppCredential).mockResolvedValue({
      kind: 'github_app' as const,
      token: 'github-app-token',
      appId: 1,
      appName: 'GitNotes',
      selectedRepositories: [{ owner: 'owner', repo: 'repo' }],
    });
    jest.mocked(AccountStorage.getOAuthCredential).mockResolvedValue({
      kind: 'oauth' as const,
      accessToken: 'oauth-token',
      provider: 'github',
    });
    jest.mocked(AccountStorage.getHostToken).mockResolvedValue('pat-token');

    const result = await GitEngine.pushWithIntegrate('/repo', 'origin', 'github/owner/repo');

    expect(result.ok).toBe(false);
    expect(result.error).toContain('Network error');
    expect(nativeModule.pushWithIntegrate).toHaveBeenCalledTimes(1);
  });

  it('does not retry when native operation fails with 409 conflict error', async () => {
    nativeModule.pushWithIntegrate.mockResolvedValueOnce({
      ok: false,
      error: 'Push rejected: non-fast-forward',
      message: 'Push rejected: non-fast-forward',
      conflicts: [],
      pushed: 0,
    });

    jest.mocked(AccountStorage.getGitHubAppCredential).mockResolvedValue({
      kind: 'github_app' as const,
      token: 'github-app-token',
      appId: 1,
      appName: 'GitNotes',
      selectedRepositories: [{ owner: 'owner', repo: 'repo' }],
    });
    jest.mocked(AccountStorage.getOAuthCredential).mockResolvedValue({
      kind: 'oauth' as const,
      accessToken: 'oauth-token',
      provider: 'github',
    });
    jest.mocked(AccountStorage.getHostToken).mockResolvedValue('pat-token');

    const result = await GitEngine.pushWithIntegrate('/repo', 'origin', 'github/owner/repo');

    expect(result.ok).toBe(false);
    expect(nativeModule.pushWithIntegrate).toHaveBeenCalledTimes(1);
  });

  it('does not retry when native operation fails with 500 server error', async () => {
    nativeModule.pushWithIntegrate.mockResolvedValueOnce({
      ok: false,
      error: 'Internal Server Error',
      message: 'Internal Server Error',
      conflicts: [],
      pushed: 0,
    });

    jest.mocked(AccountStorage.getGitHubAppCredential).mockResolvedValue({
      kind: 'github_app' as const,
      token: 'github-app-token',
      appId: 1,
      appName: 'GitNotes',
      selectedRepositories: [{ owner: 'owner', repo: 'repo' }],
    });
    jest.mocked(AccountStorage.getOAuthCredential).mockResolvedValue({
      kind: 'oauth' as const,
      accessToken: 'oauth-token',
      provider: 'github',
    });
    jest.mocked(AccountStorage.getHostToken).mockResolvedValue('pat-token');

    const result = await GitEngine.pushWithIntegrate('/repo', 'origin', 'github/owner/repo');

    expect(result.ok).toBe(false);
    expect(nativeModule.pushWithIntegrate).toHaveBeenCalledTimes(1);
  });

  it('does not retry when native operation fails with SAML 403 error', async () => {
    nativeModule.pushWithIntegrate.mockResolvedValueOnce({
      ok: false,
      error: 'SAML required',
      message: 'SAML required',
      conflicts: [],
      pushed: 0,
    });

    jest.mocked(AccountStorage.getGitHubAppCredential).mockResolvedValue({
      kind: 'github_app' as const,
      token: 'github-app-token',
      appId: 1,
      appName: 'GitNotes',
      selectedRepositories: [{ owner: 'owner', repo: 'repo' }],
    });
    jest.mocked(AccountStorage.getOAuthCredential).mockResolvedValue({
      kind: 'oauth' as const,
      accessToken: 'oauth-token',
      provider: 'github',
    });
    jest.mocked(AccountStorage.getHostToken).mockResolvedValue('pat-token');

    const result = await GitEngine.pushWithIntegrate('/repo', 'origin', 'github/owner/repo');

    expect(result.ok).toBe(false);
    expect(nativeModule.pushWithIntegrate).toHaveBeenCalledTimes(1);
  });
});

describe('GitEngine.fileHistory', () => {
  beforeEach(() => {
    nativeModule.fileHistory.mockReset();
    nativeModule.checkout.mockReset();
    nativeModule.resetSoft.mockReset();
  });

  it('returns FileHistoryResult with entries for happy path', async () => {
    const mockResult = {
      entries: [
        {
          id: 'abc1234def5678',
          shortId: 'abc1234',
          message: 'Update notes/example.md',
          summary: 'Update notes/example.md',
          authorName: 'Test User',
          authorEmail: 'test@example.com',
          authorTime: 1700000000,
          committerTime: 1700000000,
          parentCount: 1,
          parents: ['parent123'],
        },
      ],
      shallow: false,
    };
    nativeModule.fileHistory.mockResolvedValue(mockResult);

    const result = await GitEngine.fileHistory('/repo', 'main', 'notes/example.md', 50, 0);

    expect(result.entries).toHaveLength(1);
    expect(result.entries[0].id).toBe('abc1234def5678');
    expect(result.entries[0].shortId).toBe('abc1234');
    expect(result.shallow).toBe(false);
    expect(nativeModule.fileHistory).toHaveBeenCalledWith('/repo', 'main', 'notes/example.md', 50, 0);
  });

  it('returns empty entries when file has no history', async () => {
    nativeModule.fileHistory.mockResolvedValue({ entries: [], shallow: false });

    const result = await GitEngine.fileHistory('/repo', 'main', 'nonexistent.md', 50, 0);

    expect(result.entries).toHaveLength(0);
    expect(result.shallow).toBe(false);
  });

  it('returns shallow flag when history may be truncated', async () => {
    nativeModule.fileHistory.mockResolvedValue({
      entries: [],
      shallow: true,
    });

    const result = await GitEngine.fileHistory('/repo', 'main', 'notes/example.md', 50, 0);

    expect(result.shallow).toBe(true);
  });
});

describe('GitEngine.readBlobAtRef', () => {
  beforeEach(() => {
    nativeModule.readBlobAtRef.mockReset();
    nativeModule.checkout.mockReset();
    nativeModule.resetSoft.mockReset();
  });

  it('returns decoded content string on happy path', async () => {
    const encoder = new TextEncoder();
    const contentBytes = encoder.encode('# Hello World\n');
    nativeModule.readBlobAtRef.mockResolvedValue({
      kind: 'Content',
      oid: 'blob123oid',
      content: contentBytes,
      truncated: false,
      mimeType: 'text/markdown',
    });

    const result = await GitEngine.readBlobAtRef('/repo', 'abc123', 'notes/example.md');

    expect(result.kind).toBe('Content');
    if (result.kind === 'Content') {
      expect(result.content).toBe('# Hello World\n');
      expect(result.oid).toBe('blob123oid');
      expect(result.mimeType).toBe('text/markdown');
      expect(result.truncated).toBe(false);
    }
    expect(nativeModule.readBlobAtRef).toHaveBeenCalledWith('/repo', 'abc123', 'notes/example.md');
  });

  it('returns RefNotFound error when ref does not exist', async () => {
    nativeModule.readBlobAtRef.mockResolvedValue({
      kind: 'Error',
      error: { kind: 'RefNotFound', message: 'ref not found: nonexistent' },
    });

    const result = await GitEngine.readBlobAtRef('/repo', 'nonexistent', 'notes/example.md');

    expect(result.kind).toBe('Error');
    if (result.kind === 'Error') {
      expect(result.errorKind).toBe('RefNotFound');
      expect(result.message).toBe('ref not found: nonexistent');
    }
  });

  it('returns PathNotFound error when file does not exist at ref', async () => {
    nativeModule.readBlobAtRef.mockResolvedValue({
      kind: 'Error',
      error: { kind: 'PathNotFound', message: "path 'notes/nonexistent.md' not found at ref 'main'" },
    });

    const result = await GitEngine.readBlobAtRef('/repo', 'main', 'notes/nonexistent.md');

    expect(result.kind).toBe('Error');
    if (result.kind === 'Error') {
      expect(result.errorKind).toBe('PathNotFound');
    }
  });

  it('returns ShallowHistory error for shallow clones', async () => {
    nativeModule.readBlobAtRef.mockResolvedValue({
      kind: 'Error',
      error: {
        kind: 'ShallowHistory',
        message: "ref 'main' is a shallow commit (history truncated by git clone --depth)",
      },
    });

    const result = await GitEngine.readBlobAtRef('/repo', 'main', 'notes/example.md');

    expect(result.kind).toBe('Error');
    if (result.kind === 'Error') {
      expect(result.errorKind).toBe('ShallowHistory');
    }
  });

  it('returns BinaryContent error for binary files', async () => {
    nativeModule.readBlobAtRef.mockResolvedValue({
      kind: 'Error',
      error: { kind: 'BinaryContent', message: "file 'image.png' at ref 'main' is binary" },
    });

    const result = await GitEngine.readBlobAtRef('/repo', 'main', 'image.png');

    expect(result.kind).toBe('Error');
    if (result.kind === 'Error') {
      expect(result.errorKind).toBe('BinaryContent');
    }
  });

  it('returns TooLarge error when blob exceeds size limit', async () => {
    nativeModule.readBlobAtRef.mockResolvedValue({
      kind: 'Error',
      error: {
        kind: 'TooLarge',
        message: 'blob at notes/large.md at ref main is 15728640 bytes (limit: 10485760 bytes)',
      },
    });

    const result = await GitEngine.readBlobAtRef('/repo', 'main', 'notes/large.md');

    expect(result.kind).toBe('Error');
    if (result.kind === 'Error') {
      expect(result.errorKind).toBe('TooLarge');
    }
  });

  it('rejects path traversal attempt with PathNotFound', async () => {
    nativeModule.readBlobAtRef.mockResolvedValue({
      kind: 'Error',
      error: {
        kind: 'PathNotFound',
        message: "invalid file path: '../etc/passwd'",
      },
    });

    const result = await GitEngine.readBlobAtRef('/repo', 'main', '../etc/passwd');

    expect(result.kind).toBe('Error');
    if (result.kind === 'Error') {
      expect(result.errorKind).toBe('PathNotFound');
    }
  });

  it('rejects absolute path with PathNotFound', async () => {
    nativeModule.readBlobAtRef.mockResolvedValue({
      kind: 'Error',
      error: {
        kind: 'PathNotFound',
        message: "invalid file path: '/etc/passwd'",
      },
    });

    const result = await GitEngine.readBlobAtRef('/repo', 'main', '/etc/passwd');

    expect(result.kind).toBe('Error');
    if (result.kind === 'Error') {
      expect(result.errorKind).toBe('PathNotFound');
    }
  });

  it('rejects empty ref with RefNotFound', async () => {
    nativeModule.readBlobAtRef.mockResolvedValue({
      kind: 'Error',
      error: { kind: 'RefNotFound', message: 'ref not found: ' },
    });

    const result = await GitEngine.readBlobAtRef('/repo', '', 'notes/example.md');

    expect(result.kind).toBe('Error');
    if (result.kind === 'Error') {
      expect(result.errorKind).toBe('RefNotFound');
    }
  });

  it('does not call checkout or resetSoft when blob is read', async () => {
    const encoder = new TextEncoder();
    nativeModule.readBlobAtRef.mockResolvedValue({
      kind: 'Content',
      oid: 'blob123oid',
      content: encoder.encode('# Hello\n'),
      truncated: false,
      mimeType: 'text/markdown',
    });

    await GitEngine.readBlobAtRef('/repo', 'main', 'notes/example.md');

    expect(nativeModule.checkout).not.toHaveBeenCalled();
    expect(nativeModule.resetSoft).not.toHaveBeenCalled();
  });

  it('decodes Uint8Array content correctly (production contract)', async () => {
    const markdown = '# Hëllo Wörld\n🎉';
    const encoder = new TextEncoder();
    const contentBytes = encoder.encode(markdown);
    nativeModule.readBlobAtRef.mockResolvedValue({
      kind: 'Content',
      oid: 'abc123oid',
      content: contentBytes,
      truncated: false,
      mimeType: 'text/markdown',
    });

    const result = await GitEngine.readBlobAtRef('/repo', 'main', 'notes/test.md');

    expect(result.kind).toBe('Content');
    if (result.kind === 'Content') {
      expect(result.content).toBe(markdown);
    }
  });

  it('throws when native returns base64 string instead of Uint8Array', async () => {
    const contentBytes = new TextEncoder().encode('# Hëllo');
    nativeModule.readBlobAtRef.mockResolvedValue({
      kind: 'Content',
      oid: 'abc123oid',
      content: Buffer.from(contentBytes).toString('base64'),
      truncated: false,
      mimeType: 'text/markdown',
    });

    await expect(
      GitEngine.readBlobAtRef('/repo', 'main', 'notes/test.md'),
    ).rejects.toMatchObject({ message: expect.stringContaining('') });
  });

  it('normalizes lowercase content kind from legacy native builds', async () => {
    const encoder = new TextEncoder();
    nativeModule.readBlobAtRef.mockResolvedValue({
      kind: 'content',
      oid: 'legacyOid',
      content: encoder.encode('# Legacy content'),
      truncated: false,
      mimeType: 'text/markdown',
    });

    const result = await GitEngine.readBlobAtRef('/repo', 'main', 'notes/test.md');

    expect(result.kind).toBe('Content');
    if (result.kind === 'Content') {
      expect(result.content).toBe('# Legacy content');
      expect(result.oid).toBe('legacyOid');
    }
  });

  it('normalizes flat-code error shape from legacy native builds', async () => {
    nativeModule.readBlobAtRef.mockResolvedValue({
      kind: 'error',
      code: 'RefNotFound',
    });

    const result = await GitEngine.readBlobAtRef('/repo', 'nonexistent', 'notes/test.md');

    expect(result.kind).toBe('Error');
    if (result.kind === 'Error') {
      expect(result.errorKind).toBe('RefNotFound');
      expect(result.message).toBe('');
    }
  });

  it('normalizes flat-code error with unknown kind', async () => {
    nativeModule.readBlobAtRef.mockResolvedValue({
      kind: 'error',
      code: 'SomeUnknownError',
    });

    const result = await GitEngine.readBlobAtRef('/repo', 'main', 'notes/test.md');

    expect(result.kind).toBe('Error');
    if (result.kind === 'Error') {
      expect(result.errorKind).toBe('SomeUnknownError');
    }
  });
});

describe('GitEngine.fileHistory pagination', () => {
  beforeEach(() => {
    nativeModule.fileHistory.mockReset();
    nativeModule.checkout.mockReset();
    nativeModule.resetSoft.mockReset();
  });

  it('passes skip and limit to native module', async () => {
    nativeModule.fileHistory.mockResolvedValue({ entries: [], shallow: false });

    await GitEngine.fileHistory('/repo', 'main', 'notes/example.md', 20, 5);

    expect(nativeModule.fileHistory).toHaveBeenCalledWith('/repo', 'main', 'notes/example.md', 20, 5);
  });

  it('returns entries from native result with correct field mapping', async () => {
    const mockEntries = [
      {
        id: 'abc0000000001',
        shortId: 'abc0000',
        message: 'Update notes/example.md',
        summary: 'Update notes/example.md',
        authorName: 'Alice',
        authorEmail: 'alice@example.com',
        authorTime: 1710000000,
        committerTime: 1710000000,
        parentCount: 1,
        parents: ['abc0000000000'],
      },
    ];
    nativeModule.fileHistory.mockResolvedValue({ entries: mockEntries, shallow: false });

    const result = await GitEngine.fileHistory('/repo', 'main', 'notes/example.md', 50, 0);

    expect(result.entries).toHaveLength(1);
    expect(result.entries[0].id).toBe('abc0000000001');
    expect(result.entries[0].authorName).toBe('Alice');
    expect(result.shallow).toBe(false);
  });

  it('handles skip beyond available entries gracefully', async () => {
    nativeModule.fileHistory.mockResolvedValue({ entries: [], shallow: false });

    const result = await GitEngine.fileHistory('/repo', 'main', 'notes/example.md', 50, 999);

    expect(result.entries).toHaveLength(0);
    expect(nativeModule.fileHistory).toHaveBeenCalledWith('/repo', 'main', 'notes/example.md', 50, 999);
  });

  it('does not call checkout or resetSoft when history is retrieved', async () => {
    nativeModule.fileHistory.mockResolvedValue({ entries: [], shallow: false });

    await GitEngine.fileHistory('/repo', 'main', 'notes/example.md', 50, 0);

    expect(nativeModule.checkout).not.toHaveBeenCalled();
    expect(nativeModule.resetSoft).not.toHaveBeenCalled();
  });

  it('treats limit=0 as limit=1 (max guard)', async () => {
    const mockEntry = {
      id: 'abc0000000001',
      shortId: 'abc0000',
      message: 'Update notes/example.md',
      summary: 'Update notes/example.md',
      authorName: 'Alice',
      authorEmail: 'alice@example.com',
      authorTime: 1710000000,
      committerTime: 1710000000,
      parentCount: 1,
      parents: ['abc0000000000'],
    };
    nativeModule.fileHistory.mockResolvedValue({ entries: [mockEntry], shallow: false });

    const result = await GitEngine.fileHistory('/repo', 'main', 'notes/example.md', 0, 0);

    expect(nativeModule.fileHistory).toHaveBeenCalledWith('/repo', 'main', 'notes/example.md', 0, 0);
    expect(result.entries).toHaveLength(1);
  });
});
