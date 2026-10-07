import { ThoughtDumpService } from '@/services/ThoughtDumpService';
import { CloneSyncService } from '@/services/cloneSyncServiceImpl';
import { CommitService } from '@/services/git/CommitService';
import { GitHubService } from '@/services/GitHubService';

jest.mock('@/services/cloneSyncServiceImpl', () => ({
  CloneSyncService: {
    save: jest.fn(),
  },
}));

jest.mock('@/services/git/CommitService', () => ({
  CommitService: {
    commit: jest.fn(async () => ({ success: true })),
  },
}));

jest.mock('@/services/GitHubService', () => ({
  GitHubService: {
    isAuthenticated: jest.fn(() => true),
    isAuthenticatedAsync: jest.fn(async () => true),
  },
}));

jest.mock('@/services/git/branchResolver', () => ({
  resolveBranch: jest.fn(async (_repoPath: string, branch?: string) => branch ?? 'main'),
}));

describe('ThoughtDumpService', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    (CloneSyncService.save as jest.Mock).mockResolvedValue({ success: true });
  });

  it('writes thought dumps without creating a commit', async () => {
    const result = await ThoughtDumpService.create('A useful thought', {
      repoPath: 'owner/repo',
      branch: 'main',
    });

    expect(result.ok).toBe(true);
    expect(CloneSyncService.save).toHaveBeenCalledWith(expect.objectContaining({
      repoPath: 'owner/repo',
      branch: 'main',
      intent: 'upsert',
      content: expect.any(String),
    }));
    expect(CommitService.commit).not.toHaveBeenCalled();
  });

  it('writes thought dumps with an OAuth credential when no legacy token is loaded', async () => {
    (GitHubService.isAuthenticated as jest.Mock).mockReturnValue(false);
    (GitHubService.isAuthenticatedAsync as jest.Mock).mockResolvedValue(true);

    const result = await ThoughtDumpService.create('An OAuth thought', {
      repoPath: 'owner/repo',
      branch: 'main',
    });

    expect(result.ok).toBe(true);
  });
});
