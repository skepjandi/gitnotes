import { GitService } from '@/services/GitService';
import { StorageService } from '@/services/StorageService';
import { fetchGitHubDefaultBranch } from '@/services/git/branchResolver';
import { getActiveGitHost } from '@/services/git/activeHost';

jest.mock('@/services/StorageService', () => ({
  StorageService: { addRepository: jest.fn() },
}));

jest.mock('@/services/git/branchResolver', () => ({
  fetchGitHubDefaultBranch: jest.fn(),
  fetchGitLabDefaultBranch: jest.fn(),
  fetchGiteaLikeDefaultBranch: jest.fn(),
}));

jest.mock('@/services/git/activeHost', () => ({
  getActiveGitHost: jest.fn(),
}));

describe('GitService.addRepository', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    (getActiveGitHost as jest.Mock).mockResolvedValue(null);
    (fetchGitHubDefaultBranch as jest.Mock).mockResolvedValue('main');
  });

  it('persists the canonical owner/repo name for App credential selection', async () => {
    const repository = await GitService.addRepository('vidwadeseram/philosophy', undefined, 'github', 'host-1');

    expect(repository.full_name).toBe('vidwadeseram/philosophy');
    expect(StorageService.addRepository).toHaveBeenCalledWith(expect.objectContaining({
      full_name: 'vidwadeseram/philosophy',
    }));
  });
});
