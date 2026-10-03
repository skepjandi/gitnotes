import { requireNativeModule } from 'expo-modules-core';

jest.mock('expo-modules-core', () => ({
  requireNativeModule: jest.fn(() => ({
    pull: jest.fn(),
    pushWithIntegrate: jest.fn(),
    getCredential: jest.fn(),
    setCredential: jest.fn(),
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
import { AuthService } from '@/services/AuthService';
import { AccountStorage } from '@/services/AccountStorage';
import { StorageService } from '@/services/StorageService';

const nativeModule = (requireNativeModule as jest.Mock).mock.results[0].value as {
  pull: jest.Mock;
  pushWithIntegrate: jest.Mock;
  getCredential: jest.Mock;
  setCredential: jest.Mock;
};

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
