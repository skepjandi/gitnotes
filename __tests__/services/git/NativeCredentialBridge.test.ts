import {
  registerGitHubOAuthCredential,
  registerGitHubAppCredential,
  registerPatCredential,
  clearRepoCredential,
  getRegisteredCredentialKind,
  enforceAppRepositorySelection,
  isAppNearExpiry,
  renewAppTokenIfNeeded,
  recoverFromApp401,
  resolveGitHubRepoToken,
  clearHostCredentials,
  clearCredentialKindForHost,
  initNativeCredentialBridge,
  NativeCredentialBridgeError,
  isAuthFailure,
  getNextCredentialKind,
  __clearRepoCredentialKindsForTest,
} from '@/services/git/NativeCredentialBridge';
import type { GitHubAppCredentialRecord } from '@/services/git/contracts';

function makeAppCred(overrides: Partial<{
  token: string;
  expiresAt: number;
  selectedRepositories: GitHubAppCredentialRecord['selectedRepositories'];
}> = {}): GitHubAppCredentialRecord {
  return {
    installationId: 123,
    appId: 456,
    appSlug: 'test-app',
    accountLogin: 'acme',
    accountId: 789,
    token: 'ghs_inst_tok',
    expiresAt: Date.now() + 3600 * 1000,
    selectedRepositories: [
      { owner: 'acme', repo: 'repo-a' },
      { owner: 'acme', repo: 'repo-b' },
    ],
    renewal: {
      grantToken: 'grntkn',
      grantExpiresAt: Date.now() + 86400 * 1000,
      backendUrl: 'https://gitnotes-backend.example.com',
    },
    ...overrides,
  } as GitHubAppCredentialRecord;
}

let lastNativeCredential: object | null = null;

function mockSetCredential(_repoId: string, cred: object): Promise<void> {
  lastNativeCredential = cred;
  return Promise.resolve();
}

function mockClearCredential(_repoId: string): Promise<boolean> {
  return Promise.resolve(true);
}

jest.mock('@/services/GitHubAppService', () => ({
  GitHubAppService: {
    renewInstallationToken: jest.fn(),
  },
}));

jest.mock('@/services/AccountStorage', () => ({
  AccountStorage: {
    getGitHubAppCredential: jest.fn(),
    setGitHubAppCredential: jest.fn(),
    getOAuthCredential: jest.fn(),
    deleteOAuthCredential: jest.fn(),
    deleteGitHubAppCredential: jest.fn(),
    getHostToken: jest.fn(),
  },
}));

beforeEach(() => {
  jest.clearAllMocks();
  lastNativeCredential = null;
  __clearRepoCredentialKindsForTest();
  initNativeCredentialBridge({ setCredential: mockSetCredential, clearCredential: mockClearCredential });
});

describe('OAuth credential lifecycle', () => {
  test('registerGitHubOAuthCredential sets oauth kind in memory map', async () => {
    await registerGitHubOAuthCredential('github.com/acme/repo-a', 'host-1', 'oauth_token');
    const kind = await getRegisteredCredentialKind('github.com/acme/repo-a', 'host-1');
    expect(kind).toBe('oauth');
    expect(lastNativeCredential).toEqual({
      kind: 'userpass',
      username: 'x-access-token',
      password: 'oauth_token',
    });
  });

  test('multiple OAuth repos under same host are independently registered', async () => {
    await registerGitHubOAuthCredential('github.com/acme/repo-a', 'host-1', 'tok_a');
    await registerGitHubOAuthCredential('github.com/acme/repo-b', 'host-1', 'tok_b');
    expect(await getRegisteredCredentialKind('github.com/acme/repo-a', 'host-1')).toBe('oauth');
    expect(await getRegisteredCredentialKind('github.com/acme/repo-b', 'host-1')).toBe('oauth');
  });

  test('clearRepoCredential removes the credential kind', async () => {
    await registerGitHubOAuthCredential('github.com/acme/repo-a', 'host-1', 'tok');
    await clearRepoCredential('github.com/acme/repo-a');
    expect(await getRegisteredCredentialKind('github.com/acme/repo-a', 'host-1')).toBeNull();
  });

  test('switching from OAuth to PAT updates kind', async () => {
    await registerGitHubOAuthCredential('github.com/acme/repo-a', 'host-1', 'oauth_tok');
    await registerPatCredential('github.com/acme/repo-a', 'host-1', 'ghp_pat');
    expect(await getRegisteredCredentialKind('github.com/acme/repo-a', 'host-1')).toBe('token');
  });
});

describe('GitHub App credential lifecycle', () => {
  test('registerGitHubAppCredential sets github_app kind in memory map', async () => {
    await registerGitHubAppCredential('github.com/acme/repo-a', 'host-1', 'inst_tok');
    const kind = await getRegisteredCredentialKind('github.com/acme/repo-a', 'host-1');
    expect(kind).toBe('github_app');
  });

  test('App credential for repo not in selection throws', () => {
    const appCred = makeAppCred({ selectedRepositories: [{ owner: 'acme', repo: 'repo-a' }] });
    expect(() => enforceAppRepositorySelection('github.com/acme/repo-b', appCred)).toThrow(
      NativeCredentialBridgeError,
    );
  });

  test('App credential for repo in selection does not throw', () => {
    const appCred = makeAppCred({
      selectedRepositories: [{ owner: 'acme', repo: 'repo-a' }],
    });
    expect(() => enforceAppRepositorySelection('github.com/acme/repo-a', appCred)).not.toThrow();
  });

  test('App case-insensitive repo matching', () => {
    const appCred = makeAppCred({
      selectedRepositories: [{ owner: 'Acme', repo: 'Repo-A' }],
    });
    expect(() => enforceAppRepositorySelection('github.com/acme/repo-a', appCred)).not.toThrow();
  });

  test('clearRepoCredential removes App kind', async () => {
    await registerGitHubAppCredential('github.com/acme/repo-a', 'host-1', 'inst_tok');
    await clearRepoCredential('github.com/acme/repo-a');
    expect(await getRegisteredCredentialKind('github.com/acme/repo-a', 'host-1')).toBeNull();
  });
});

describe('PAT / SSH regression', () => {
  test('last credential kind registered wins for same repo', async () => {
    await registerPatCredential('github.com/acme/repo-a', 'host-1', 'ghp_pat');
    await registerGitHubOAuthCredential('github.com/acme/repo-a', 'host-1', 'oauth_tok');
    expect(await getRegisteredCredentialKind('github.com/acme/repo-a', 'host-1')).toBe('oauth');
  });
});

describe('clearHostCredentials', () => {
  test('clears all repos for a given host', async () => {
    await registerGitHubOAuthCredential('github.com/acme/repo-a', 'host-1', 'tok_a');
    await registerGitHubOAuthCredential('github.com/acme/repo-b', 'host-1', 'tok_b');
    await registerGitHubOAuthCredential('github.com/acme/repo-c', 'host-2', 'tok_c');
    await clearHostCredentials('host-1');
    expect(await getRegisteredCredentialKind('github.com/acme/repo-a', 'host-1')).toBeNull();
    expect(await getRegisteredCredentialKind('github.com/acme/repo-b', 'host-1')).toBeNull();
    expect(await getRegisteredCredentialKind('github.com/acme/repo-c', 'host-2')).toBe('oauth');
  });
});

describe('clearCredentialKindForHost', () => {
  test('clears only repos with matching kind for host, preserves other kinds', async () => {
    await registerGitHubOAuthCredential('github.com/acme/repo-a', 'host-1', 'oauth_tok');
    await registerPatCredential('github.com/acme/repo-b', 'host-1', 'pat_tok');
    await registerGitHubOAuthCredential('github.com/acme/repo-c', 'host-2', 'oauth_tok');
    await clearCredentialKindForHost('host-1', 'oauth');
    expect(await getRegisteredCredentialKind('github.com/acme/repo-a', 'host-1')).toBeNull();
    expect(await getRegisteredCredentialKind('github.com/acme/repo-b', 'host-1')).toBe('token');
    expect(await getRegisteredCredentialKind('github.com/acme/repo-c', 'host-2')).toBe('oauth');
  });

  test('clearing oauth does not affect github_app repos', async () => {
    await registerGitHubOAuthCredential('github.com/acme/repo-a', 'host-1', 'oauth_tok');
    await registerGitHubAppCredential('github.com/acme/repo-b', 'host-1', 'app_tok');
    await clearCredentialKindForHost('host-1', 'oauth');
    expect(await getRegisteredCredentialKind('github.com/acme/repo-a', 'host-1')).toBeNull();
    expect(await getRegisteredCredentialKind('github.com/acme/repo-b', 'host-1')).toBe('github_app');
  });

  test('clearing token does not affect oauth repos', async () => {
    await registerPatCredential('github.com/acme/repo-a', 'host-1', 'pat_tok');
    await registerGitHubOAuthCredential('github.com/acme/repo-b', 'host-1', 'oauth_tok');
    await clearCredentialKindForHost('host-1', 'token');
    expect(await getRegisteredCredentialKind('github.com/acme/repo-a', 'host-1')).toBeNull();
    expect(await getRegisteredCredentialKind('github.com/acme/repo-b', 'host-1')).toBe('oauth');
  });

  test('clearing ssh does not affect token', async () => {
    await registerPatCredential('github.com/acme/repo-a', 'host-1', 'pat_tok');
    await registerGitHubOAuthCredential('github.com/acme/repo-b', 'host-1', 'oauth_tok');
    await clearCredentialKindForHost('host-1', 'ssh');
    expect(await getRegisteredCredentialKind('github.com/acme/repo-a', 'host-1')).toBe('token');
    expect(await getRegisteredCredentialKind('github.com/acme/repo-b', 'host-1')).toBe('oauth');
  });

  test('no-op when no repos have that kind for host', async () => {
    await registerGitHubOAuthCredential('github.com/acme/repo-a', 'host-1', 'oauth_tok');
    await expect(clearCredentialKindForHost('host-1', 'token')).resolves.toBeUndefined();
    expect(await getRegisteredCredentialKind('github.com/acme/repo-a', 'host-1')).toBe('oauth');
  });
});

describe('isAppNearExpiry', () => {
  test('true when token expires within 10 minutes', () => {
    const cred = makeAppCred({ expiresAt: Date.now() + 3 * 60 * 1000 });
    expect(isAppNearExpiry(cred)).toBe(true);
  });

  test('false when token has more than 10 minutes', () => {
    const cred = makeAppCred({ expiresAt: Date.now() + 20 * 60 * 1000 });
    expect(isAppNearExpiry(cred)).toBe(false);
  });

  test('true for already-expired token', () => {
    const cred = makeAppCred({ expiresAt: Date.now() - 10 * 1000 });
    expect(isAppNearExpiry(cred)).toBe(true);
  });
});

describe('renewAppTokenIfNeeded', () => {
  let mockRenew: jest.Mock;

  beforeEach(() => {
    mockRenew = jest.fn();
    const { GitHubAppService } = require('@/services/GitHubAppService');
    (GitHubAppService.renewInstallationToken as jest.Mock) = mockRenew;
  });

  test('returns null when no credential exists for host', async () => {
    const { AccountStorage } = require('@/services/AccountStorage');
    (AccountStorage.getGitHubAppCredential as jest.Mock).mockResolvedValue(null);
    const result = await renewAppTokenIfNeeded('github.com', 'nonexistent-host');
    expect(result).toBeNull();
    expect(mockRenew).not.toHaveBeenCalled();
  });

  test('returns null when token is not near expiry', async () => {
    const cred = makeAppCred({ expiresAt: Date.now() + 3600 * 1000 });
    const { AccountStorage } = require('@/services/AccountStorage');
    (AccountStorage.getGitHubAppCredential as jest.Mock).mockResolvedValue(cred);
    const result = await renewAppTokenIfNeeded('host-1', cred);
    expect(result).toBeNull();
    expect(mockRenew).not.toHaveBeenCalled();
  });

  test('calls renew when token is near expiry', async () => {
    const oldCred = makeAppCred({ token: 'old_tok', expiresAt: Date.now() + 2 * 60 * 1000 });
    const newCred = makeAppCred({ token: 'new_tok', expiresAt: Date.now() + 3600 * 1000 });
    const { AccountStorage } = require('@/services/AccountStorage');
    (AccountStorage.getGitHubAppCredential as jest.Mock).mockResolvedValue(oldCred);
    mockRenew.mockResolvedValue({ ok: true, credential: newCred });

    const result = await renewAppTokenIfNeeded('host-1', oldCred);

    expect(mockRenew).toHaveBeenCalledWith({ credential: oldCred });
    expect(result?.token).toBe('new_tok');
  });

  test('returns null without calling renew when not near expiry', async () => {
    const cred = makeAppCred({ expiresAt: Date.now() + 3600 * 1000 });
    const { AccountStorage } = require('@/services/AccountStorage');
    (AccountStorage.getGitHubAppCredential as jest.Mock).mockResolvedValue(cred);
    const result = await renewAppTokenIfNeeded('github.com', 'host-1');
    expect(result).toBeNull();
    expect(mockRenew).not.toHaveBeenCalled();
  });

  test('returns null when renewal fails', async () => {
    const cred = makeAppCred({ expiresAt: Date.now() + 2 * 60 * 1000 });
    const { AccountStorage } = require('@/services/AccountStorage');
    (AccountStorage.getGitHubAppCredential as jest.Mock).mockResolvedValue(cred);
    mockRenew.mockResolvedValue({ ok: false });

    await expect(renewAppTokenIfNeeded('host-1', cred)).rejects.toThrow(
      NativeCredentialBridgeError,
    );
  });
});

describe('recoverFromApp401', () => {
  let mockRenew: jest.Mock;

  beforeEach(() => {
    mockRenew = jest.fn();
    const { GitHubAppService } = require('@/services/GitHubAppService');
    (GitHubAppService.renewInstallationToken as jest.Mock) = mockRenew;
  });

  test('returns null when repo is not registered as App credential', async () => {
    const cred = makeAppCred();
    await registerGitHubOAuthCredential('github.com/acme/repo-a', 'github.com', 'tok');
    const result = await recoverFromApp401('github.com/acme/repo-a', 'github.com', cred);
    expect(result).toBeNull();
  });

  test('returns renewed token on success', async () => {
    const oldCred = makeAppCred({ token: 'expired_tok' });
    const newCred = makeAppCred({ token: 'renewed_tok' });
    mockRenew.mockResolvedValue({ ok: true, credential: newCred });
    await registerGitHubAppCredential('github.com/acme/repo-a', 'github.com', 'expired_tok');

    const result = await recoverFromApp401('github.com/acme/repo-a', 'github.com', oldCred);

    expect(result?.token).toBe('renewed_tok');
  });

  test('returns null when renewal fails after 401', async () => {
    const cred = makeAppCred({ token: 'expired_tok' });
    mockRenew.mockResolvedValue({ ok: false });
    await registerGitHubAppCredential('github.com/acme/repo-a', 'github.com', 'expired_tok');

    const result = await recoverFromApp401('github.com/acme/repo-a', 'github.com', cred);

    expect(result).toBeNull();
  });
});

describe('account isolation', () => {
  test('same repo on different hosts has independent credential kinds', async () => {
    await registerGitHubOAuthCredential('github.com/acme/repo-a', 'host-1', 'tok_h1');
    await registerGitHubAppCredential('github.com/acme/repo-a', 'host-2', 'tok_h2');
    expect(await getRegisteredCredentialKind('github.com/acme/repo-a', 'host-1')).toBe('oauth');
    expect(await getRegisteredCredentialKind('github.com/acme/repo-a', 'host-2')).toBe('github_app');
  });

  test('switching host credential kind does not affect other host', async () => {
    await registerGitHubOAuthCredential('github.com/acme/repo-a', 'host-1', 'tok');
    await registerPatCredential('github.com/acme/repo-a', 'host-2', 'pat');
    await registerPatCredential('github.com/acme/repo-a', 'host-1', 'new_pat');
    expect(await getRegisteredCredentialKind('github.com/acme/repo-a', 'host-1')).toBe('token');
    expect(await getRegisteredCredentialKind('github.com/acme/repo-a', 'host-2')).toBe('token');
  });
});

describe('provider independence', () => {
  test('GitHub App and OAuth coexist for different repos on same host', async () => {
    await registerGitHubOAuthCredential('github.com/acme/repo-a', 'host-1', 'oauth_tok');
    await registerGitHubAppCredential('github.com/acme/repo-b', 'host-1', 'app_tok');
    expect(await getRegisteredCredentialKind('github.com/acme/repo-a', 'host-1')).toBe('oauth');
    expect(await getRegisteredCredentialKind('github.com/acme/repo-b', 'host-1')).toBe('github_app');
  });

  test('clearing App credential does not affect OAuth credential', async () => {
    await registerGitHubOAuthCredential('github.com/acme/repo-a', 'host-1', 'oauth_tok');
    await registerGitHubAppCredential('github.com/acme/repo-b', 'host-1', 'app_tok');
    await clearRepoCredential('github.com/acme/repo-b');
    expect(await getRegisteredCredentialKind('github.com/acme/repo-a', 'host-1')).toBe('oauth');
    expect(await getRegisteredCredentialKind('github.com/acme/repo-b', 'host-1')).toBeNull();
  });

  test('clearing github_app via clearCredentialKindForHost preserves oauth registrations', async () => {
    await registerGitHubOAuthCredential('github.com/acme/repo-a', 'host-1', 'oauth_tok');
    await registerGitHubAppCredential('github.com/acme/repo-b', 'host-1', 'app_tok');
    await clearCredentialKindForHost('host-1', 'github_app');
    expect(await getRegisteredCredentialKind('github.com/acme/repo-a', 'host-1')).toBe('oauth');
    expect(await getRegisteredCredentialKind('github.com/acme/repo-b', 'host-1')).toBeNull();
  });
});

describe('resolveGitHubRepoToken', () => {
  let mockRenew: jest.Mock;

  beforeEach(() => {
    mockRenew = jest.fn();
    const { GitHubAppService } = require('@/services/GitHubAppService');
    (GitHubAppService.renewInstallationToken as jest.Mock) = mockRenew;
  });

  test('throws when no credential available', async () => {
    const { AccountStorage } = require('@/services/AccountStorage');
    (AccountStorage.getGitHubAppCredential as jest.Mock).mockResolvedValue(null);
    (AccountStorage.getOAuthCredential as jest.Mock).mockResolvedValue(null);
    (AccountStorage.getHostToken as jest.Mock).mockResolvedValue(null);

    await expect(
      resolveGitHubRepoToken({ repoId: 'github.com/acme/repo-a', hostId: 'github.com' }),
    ).rejects.toThrow(NativeCredentialBridgeError);
  });

  test('OAuth repo returns oauth kind with null token', async () => {
    const { AccountStorage } = require('@/services/AccountStorage');
    (AccountStorage.getGitHubAppCredential as jest.Mock).mockResolvedValue(null);
    (AccountStorage.getOAuthCredential as jest.Mock).mockResolvedValue({
      accessToken: 'oauth_tok',
      expiresAt: '2099-01-01',
      refreshToken: 'refresh',
    });
    (AccountStorage.getHostToken as jest.Mock).mockResolvedValue(null);

    const result = await resolveGitHubRepoToken({
      repoId: 'github.com/acme/repo-a',
      hostId: 'github.com',
    });
    expect(result).toEqual({ kind: 'oauth', token: 'oauth_tok' });
  });

  test('App repo with valid token returns app kind and token', async () => {
    const cred = makeAppCred({ token: 'inst_tok', expiresAt: Date.now() + 3600 * 1000 });
    const { AccountStorage } = require('@/services/AccountStorage');
    (AccountStorage.getGitHubAppCredential as jest.Mock).mockResolvedValue(cred);
    (AccountStorage.getOAuthCredential as jest.Mock).mockResolvedValue(null);
    (AccountStorage.getHostToken as jest.Mock).mockResolvedValue(null);

    const result = await resolveGitHubRepoToken({
      repoId: 'github.com/acme/repo-a',
      hostId: 'github.com',
    });
    expect(result).toEqual({ kind: 'github_app', token: 'inst_tok' });
  });

  test('App repo near expiry triggers renewal', async () => {
    const cred = makeAppCred({ token: 'old_tok', expiresAt: Date.now() + 2 * 60 * 1000 });
    const renewed = makeAppCred({ token: 'new_tok', expiresAt: Date.now() + 3600 * 1000 });
    const { AccountStorage } = require('@/services/AccountStorage');
    (AccountStorage.getGitHubAppCredential as jest.Mock).mockResolvedValue(cred);
    (AccountStorage.getOAuthCredential as jest.Mock).mockResolvedValue(null);
    (AccountStorage.getHostToken as jest.Mock).mockResolvedValue(null);
    mockRenew.mockResolvedValue({ ok: true, credential: renewed });

    const result = await resolveGitHubRepoToken({
      repoId: 'github.com/acme/repo-a',
      hostId: 'github.com',
    });

    expect(mockRenew).toHaveBeenCalled();
    expect(result?.token).toBe('new_tok');
    expect(result?.kind).toBe('github_app');
  });

  test('PAT returns token kind', async () => {
    const { AccountStorage } = require('@/services/AccountStorage');
    (AccountStorage.getGitHubAppCredential as jest.Mock).mockResolvedValue(null);
    (AccountStorage.getOAuthCredential as jest.Mock).mockResolvedValue(null);
    (AccountStorage.getHostToken as jest.Mock).mockResolvedValue('ghp_pat');

    const result = await resolveGitHubRepoToken({
      repoId: 'github.com/acme/repo-a',
      hostId: 'github.com',
    });
    expect(result).toEqual({ kind: 'token', token: 'ghp_pat' });
  });

  test('SECURITY: expired App with failed renewal throws — does NOT fall back to OAuth', async () => {
    const expiredCred = makeAppCred({ token: 'expired_tok', expiresAt: Date.now() - 1000 });
    const { AccountStorage } = require('@/services/AccountStorage');
    (AccountStorage.getGitHubAppCredential as jest.Mock).mockResolvedValue(expiredCred);
    (AccountStorage.getOAuthCredential as jest.Mock).mockResolvedValue({
      accessToken: 'oauth_tok',
      expiresAt: '2099-01-01',
      refreshToken: 'refresh',
    });
    (AccountStorage.getHostToken as jest.Mock).mockResolvedValue(null);
    mockRenew.mockResolvedValue({ ok: false, code: 'renewal_denied', message: 'Renewal denied' });

    // Must throw, not return OAuth token
    await expect(
      resolveGitHubRepoToken({ repoId: 'github.com/acme/repo-a', hostId: 'github.com' }),
    ).rejects.toThrow(NativeCredentialBridgeError);
  });

  test('SECURITY: expired App with failed renewal throws — does NOT fall back to PAT', async () => {
    const expiredCred = makeAppCred({ token: 'expired_tok', expiresAt: Date.now() - 1000 });
    const { AccountStorage } = require('@/services/AccountStorage');
    (AccountStorage.getGitHubAppCredential as jest.Mock).mockResolvedValue(expiredCred);
    (AccountStorage.getOAuthCredential as jest.Mock).mockResolvedValue(null);
    (AccountStorage.getHostToken as jest.Mock).mockResolvedValue('ghp_pat');
    mockRenew.mockResolvedValue({ ok: false, code: 'renewal_denied', message: 'Renewal denied' });

    // Must throw, not return PAT token
    await expect(
      resolveGitHubRepoToken({ repoId: 'github.com/acme/repo-a', hostId: 'github.com' }),
    ).rejects.toThrow(NativeCredentialBridgeError);
  });

  test('falls back to OAuth when repo is outside App selection', async () => {
    const cred = makeAppCred({
      token: 'inst_tok',
      expiresAt: Date.now() + 3600 * 1000,
      selectedRepositories: [{ owner: 'acme', repo: 'repo-a' }],
    });
    const { AccountStorage } = require('@/services/AccountStorage');
    (AccountStorage.getGitHubAppCredential as jest.Mock).mockResolvedValue(cred);
    (AccountStorage.getOAuthCredential as jest.Mock).mockResolvedValue({
      accessToken: 'oauth_tok',
      expiresAt: '2099-01-01',
      refreshToken: 'refresh',
    });
    (AccountStorage.getHostToken as jest.Mock).mockResolvedValue(null);

    await expect(
      resolveGitHubRepoToken({ repoId: 'github.com/acme/repo-b', hostId: 'github.com' }),
    ).resolves.toEqual({ kind: 'oauth', token: 'oauth_tok' });
  });

  test('falls back to PAT when repo is outside App selection and OAuth is absent', async () => {
    const cred = makeAppCred({
      token: 'inst_tok',
      expiresAt: Date.now() + 3600 * 1000,
      selectedRepositories: [{ owner: 'acme', repo: 'repo-a' }],
    });
    const { AccountStorage } = require('@/services/AccountStorage');
    (AccountStorage.getGitHubAppCredential as jest.Mock).mockResolvedValue(cred);
    (AccountStorage.getOAuthCredential as jest.Mock).mockResolvedValue(null);
    (AccountStorage.getHostToken as jest.Mock).mockResolvedValue('ghp_pat');

    await expect(
      resolveGitHubRepoToken({ repoId: 'github.com/acme/repo-b', hostId: 'github.com' }),
    ).resolves.toEqual({ kind: 'token', token: 'ghp_pat' });
  });

  test('OAuth is only consulted when no App credential exists', async () => {
    const { AccountStorage } = require('@/services/AccountStorage');
    (AccountStorage.getGitHubAppCredential as jest.Mock).mockResolvedValue(null);
    (AccountStorage.getOAuthCredential as jest.Mock).mockResolvedValue({
      accessToken: 'oauth_tok',
      expiresAt: '2099-01-01',
      refreshToken: 'refresh',
    });
    (AccountStorage.getHostToken as jest.Mock).mockResolvedValue('ghp_pat');

    const result = await resolveGitHubRepoToken({
      repoId: 'github.com/acme/repo-a',
      hostId: 'github.com',
    });
    // OAuth should be returned since no App exists
    expect(result).toEqual({ kind: 'oauth', token: 'oauth_tok' });
  });

  test('local repoId plus canonical owner/repo passes when repo is selected', async () => {
    // Regression: a local numeric ID like "github:1790980499852" must not be
    // compared directly to "acme/repo-a" in enforceAppRepositorySelection.
    // The canonical fullName ("acme/repo-a") must be used for the selection check
    // while the local repoId is retained for native credential registration.
    const cred = makeAppCred({
      token: 'inst_tok',
      expiresAt: Date.now() + 3600 * 1000,
      selectedRepositories: [{ owner: 'acme', repo: 'repo-a' }],
    });
    const { AccountStorage } = require('@/services/AccountStorage');
    (AccountStorage.getGitHubAppCredential as jest.Mock).mockResolvedValue(cred);
    (AccountStorage.getOAuthCredential as jest.Mock).mockResolvedValue(null);
    (AccountStorage.getHostToken as jest.Mock).mockResolvedValue(null);

    // repoId is a local numeric ID; repoFullName is the canonical owner/repo.
    // The call must NOT throw because "acme/repo-a" IS in the selection.
    await expect(
      resolveGitHubRepoToken({
        repoId: 'github:1790980499852',
        hostId: 'github.com',
        repoFullName: 'acme/repo-a',
      }),
    ).resolves.toEqual({ kind: 'github_app', token: 'inst_tok' });
  });

  test('canonical owner/repo not in selected list still throws repo_not_in_selection', async () => {
    const cred = makeAppCred({
      token: 'inst_tok',
      expiresAt: Date.now() + 3600 * 1000,
      selectedRepositories: [{ owner: 'acme', repo: 'repo-a' }],
    });
    const { AccountStorage } = require('@/services/AccountStorage');
    (AccountStorage.getGitHubAppCredential as jest.Mock).mockResolvedValue(cred);
    (AccountStorage.getOAuthCredential as jest.Mock).mockResolvedValue(null);
    (AccountStorage.getHostToken as jest.Mock).mockResolvedValue(null);

    // Even with a canonical owner/repo, if it's not selected the App must deny access.
    await expect(
      resolveGitHubRepoToken({
        repoId: 'github:1790980499852',
        hostId: 'github.com',
        repoFullName: 'acme/repo-b',
      }),
    ).rejects.toThrow(NativeCredentialBridgeError);
  });
});

describe('initNativeCredentialBridge', () => {
  test('idempotent: calling init twice does not throw', () => {
    expect(() => {
      initNativeCredentialBridge({ setCredential: mockSetCredential, clearCredential: mockClearCredential });
      initNativeCredentialBridge({ setCredential: mockSetCredential, clearCredential: mockClearCredential });
    }).not.toThrow();
  });
});

describe('isAuthFailure', () => {
  test('returns true for 401 status in response object', () => {
    const error = { response: { status: 401, message: 'Bad credentials' } };
    expect(isAuthFailure(error)).toBe(true);
  });

  test('returns true for GitHub API error with 401 status', () => {
    const error = new Error('Bad credentials');
    (error as Record<string, unknown>).response = { status: 401 };
    expect(isAuthFailure(error)).toBe(true);
  });

  test('returns true for "authentication failed" message', () => {
    expect(isAuthFailure(new Error('Authentication failed'))).toBe(true);
  });

  test('returns true for "401" in error message', () => {
    expect(isAuthFailure(new Error('Failed to push: 401 Unauthorized'))).toBe(true);
  });

  test('returns true for "credentials" without permission in message', () => {
    expect(isAuthFailure(new Error('Failed to send request: credentials rejected'))).toBe(true);
  });

  test('returns true for "unauthorized" in message', () => {
    expect(isAuthFailure(new Error('HTTP Error: 401 Unauthorized'))).toBe(true);
  });

  test('returns false for 403 status (permission error)', () => {
    const error = new Error('Forbidden');
    (error as Record<string, unknown>).response = { status: 403 };
    expect(isAuthFailure(error)).toBe(false);
  });

  test('returns false for "permission denied" message', () => {
    expect(isAuthFailure(new Error('Permission denied'))).toBe(false);
  });

  test('returns false for "403" in error message', () => {
    expect(isAuthFailure(new Error('Server returned 403 Forbidden'))).toBe(false);
  });

  test('returns false for SAML error (403 with SSO header)', () => {
    const error = new Error('SAML required');
    (error as Record<string, unknown>).response = { status: 403, headers: { 'x-github-sso': 'required' } };
    expect(isAuthFailure(error)).toBe(false);
  });

  test('returns false for network error', () => {
    expect(isAuthFailure(new Error('Network error: ECONNREFUSED'))).toBe(false);
  });

  test('returns false for server error (500)', () => {
    const error = new Error('Internal Server Error');
    (error as Record<string, unknown>).response = { status: 500 };
    expect(isAuthFailure(error)).toBe(false);
  });

  test('returns false for conflict error (409)', () => {
    const error = new Error('Conflict');
    (error as Record<string, unknown>).response = { status: 409 };
    expect(isAuthFailure(error)).toBe(false);
  });

  test('returns false for null', () => {
    expect(isAuthFailure(null)).toBe(false);
  });

  test('returns false for non-error values', () => {
    expect(isAuthFailure('error string')).toBe(false);
    expect(isAuthFailure({})).toBe(false);
  });

  test('returns true for "too many redirects or authentication replays" (libgit2 native error)', () => {
    expect(isAuthFailure(new Error('Git(message: "too many redirects or authentication replays", corruption: false)'))).toBe(true);
  });

  test('returns true when libgit2 reports that no auth callback was configured', () => {
    expect(isAuthFailure(new Error('remote authentication required but no callback set'))).toBe(true);
  });
});

describe('getNextCredentialKind', () => {
  test('github_app -> oauth', () => {
    expect(getNextCredentialKind('github_app')).toBe('oauth');
  });

  test('oauth -> token', () => {
    expect(getNextCredentialKind('oauth')).toBe('token');
  });

  test('token -> null (no more fallbacks)', () => {
    expect(getNextCredentialKind('token')).toBeNull();
  });

  test('ssh -> null', () => {
    expect(getNextCredentialKind('ssh')).toBeNull();
  });
});
