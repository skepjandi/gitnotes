import { beforeEach, describe, expect, it, jest } from '@jest/globals';
import AuthService from '@/services/AuthService';
import AccountStorage from '@/services/AccountStorage';
import { GitHubAppService } from '@/services/GitHubAppService';
import type { GitHubAppCredentialRecord } from '@/services/git/contracts';
import type { HostConnection, StoredAccount } from '@/services/AccountStorage';

jest.mock('@/services/AccountStorage', () => {
  const mock = {
    listAccounts: jest.fn(),
    listHostConnections: jest.fn(),
    getHostToken: jest.fn(),
    getGitHubAppCredential: jest.fn(),
    removeHostConnection: jest.fn(),
    removeAccount: jest.fn(),
  };
  return { __esModule: true, default: mock, AccountStorage: mock };
});

jest.mock('@/services/GitHubAppService', () => ({
  GitHubAppService: {
    renewInstallationToken: jest.fn(),
  },
}));

const storage = jest.mocked(AccountStorage);
const appService = jest.mocked(GitHubAppService);

function makeAppCredential(expired: boolean): GitHubAppCredentialRecord {
  return {
    id: 'acc-123:github:default:github_app',
    hostId: 'acc-123:github:default',
    kind: 'github_app',
    addedAt: Date.now(),
    installationId: 123,
    appId: 456,
    appSlug: 'gitnotes-app',
    accountLogin: 'octocat',
    accountId: 789,
    accountAvatarUrl: null,
    selectedRepositories: [{ owner: 'octocat', repo: 'notes' }],
    token: expired ? 'ghs-expired' : 'ghs-valid',
    expiresAt: Date.now() + (expired ? -1_000 : 3_600_000),
    renewal: {
      grantToken: 'grant-token',
      grantExpiresAt: Date.now() + 86_400_000,
      backendUrl: 'https://worker.example.com',
    },
  };
}

function makeHost(): HostConnection {
  return {
    id: 'acc-123:github:default',
    accountId: 'acc-123',
    provider: 'github',
    instanceBaseUrl: null,
    hostLogin: 'octocat',
    hostUserId: 789,
    name: 'Octocat',
    email: null,
    avatarUrl: null,
    addedAt: Date.now(),
  };
}

function makeAccount(): StoredAccount {
  return {
    id: 'acc-123',
    login: 'octocat',
    name: 'Octocat',
    email: '',
    avatarUrl: '',
    addedAt: Date.now(),
    hostIds: ['acc-123:github:default'],
  };
}

describe('AuthService.validateAllAccounts() with GitHub App credentials', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    storage.listAccounts.mockResolvedValue([makeAccount()]);
    storage.listHostConnections.mockResolvedValue([makeHost()]);
    storage.getHostToken.mockResolvedValue('ghs-installation-token');
    storage.removeHostConnection.mockResolvedValue(undefined);
    storage.removeAccount.mockResolvedValue(undefined);
  });

  it('preserves a host with a non-expired App credential without PAT validation', async () => {
    storage.getGitHubAppCredential.mockResolvedValue(makeAppCredential(false));

    await AuthService.validateAllAccounts();

    expect(storage.removeHostConnection).not.toHaveBeenCalled();
    expect(storage.removeAccount).not.toHaveBeenCalled();
  });

  it('renews an expired App credential instead of removing its host', async () => {
    const expired = makeAppCredential(true);
    storage.getGitHubAppCredential.mockResolvedValue(expired);
    appService.renewInstallationToken.mockResolvedValue({
      ok: true,
      credential: { ...expired, token: 'ghs-renewed', expiresAt: Date.now() + 3_600_000 },
    });

    await AuthService.validateAllAccounts();

    expect(appService.renewInstallationToken).toHaveBeenCalledWith({ credential: expired });
    expect(storage.removeHostConnection).not.toHaveBeenCalled();
  });

  it('preserves an App host when renewal cannot reach the backend', async () => {
    storage.getGitHubAppCredential.mockResolvedValue(makeAppCredential(true));
    appService.renewInstallationToken.mockResolvedValue({
      ok: false,
      code: 'backend_unreachable',
      message: 'Backend service unavailable',
    });

    await AuthService.validateAllAccounts();

    expect(storage.removeHostConnection).not.toHaveBeenCalled();
    expect(storage.removeAccount).not.toHaveBeenCalled();
  });
});
