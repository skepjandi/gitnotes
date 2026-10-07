jest.mock('@/services/AuthService', () => ({
  __esModule: true,
  default: {
    getActiveSummary: jest.fn(),
    listAccountSummaries: jest.fn(),
    getProviderAuthAvailability: jest.fn(),
  },
}));

jest.mock('@/services/AccountStorage', () => ({
  AccountStorage: {
    getOAuthCredential: jest.fn(),
    getGitHubAppCredential: jest.fn(),
    getHostToken: jest.fn(),
  },
}));

jest.mock('@/services/http', () => ({
  __esModule: true,
  default: {},
  setAuthToken: jest.fn(),
  clearAuthToken: jest.fn(),
}));

import { GitHubService } from '@/services/GitHubService';
import AuthService from '@/services/AuthService';

describe('GitHubService OAuth authentication', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    jest.spyOn(GitHubService, 'isAuthenticated').mockReturnValue(false);
  });

  it('recognizes a GitHub OAuth host when another provider is active', async () => {
    jest.mocked(AuthService.listAccountSummaries).mockResolvedValue([
      {
      account: {} as never,
      activeHostId: 'gitlab-host',
      hosts: [
        {
          id: 'gitlab-host',
          accountId: 'account-1',
          provider: 'gitlab',
          hostLogin: 'gitlab-user',
          hostUserId: 1,
          name: 'GitLab User',
          email: null,
          avatarUrl: null,
          instanceBaseUrl: null,
          addedAt: 1,
        },
        {
          id: 'github-host',
          accountId: 'account-1',
          provider: 'github',
          hostLogin: 'github-user',
          hostUserId: 2,
          name: 'GitHub User',
          email: null,
          avatarUrl: null,
          instanceBaseUrl: null,
          addedAt: 2,
        },
      ],
      },
    ]);
    jest.mocked(AuthService.getProviderAuthAvailability).mockImplementation(async (_hostId, provider) => ({
      provider,
      isAvailable: provider === 'github',
    }));

    await expect(GitHubService.isAuthenticatedAsync()).resolves.toBe(true);
    expect(AuthService.getProviderAuthAvailability).toHaveBeenCalledWith('github-host', 'github');
  });
});
