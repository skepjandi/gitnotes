import { deleteTemplateFromGitHub, syncTemplateToGitHub } from '@/services/TemplateGitHubSyncService';
import { CloneSyncService } from '@/services/cloneSyncServiceImpl';
import { CommitService } from '@/services/git/CommitService';

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

jest.mock('@/services/git/defaultsPolicy', () => ({
  resolveDefaultFolder: jest.fn(() => 'templates/'),
  resolveDefaultRepo: jest.fn(async () => 'owner/repo'),
}));

describe('TemplateGitHubSyncService', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    (CloneSyncService.save as jest.Mock).mockResolvedValue({ success: true });
  });

  it('writes template updates without creating a commit', async () => {
    const result = await syncTemplateToGitHub({
      repoPath: 'owner/repo',
      branch: 'main',
      template: {
        id: 'custom-template',
        name: 'Meeting',
        content: '# Meeting',
        isCustom: true,
        createdAt: 1,
        updatedAt: 2,
        filePath: 'templates/meeting.md',
      },
    });

    expect(result).toEqual({ success: true, filePath: 'templates/meeting.md' });
    expect(CloneSyncService.save).toHaveBeenCalledWith(expect.objectContaining({
      repoPath: 'owner/repo',
      branch: 'main',
      filePath: 'templates/meeting.md',
      intent: 'upsert',
    }));
    expect(CommitService.commit).not.toHaveBeenCalled();
  });

  it('deletes templates without creating a commit', async () => {
    const result = await deleteTemplateFromGitHub({
      repoPath: 'owner/repo',
      branch: 'main',
      filePath: 'templates/meeting.md',
      name: 'Meeting',
    });

    expect(result).toEqual({ success: true, filePath: 'templates/meeting.md' });
    expect(CloneSyncService.save).toHaveBeenCalledWith(expect.objectContaining({
      repoPath: 'owner/repo',
      branch: 'main',
      filePath: 'templates/meeting.md',
      intent: 'delete',
    }));
    expect(CommitService.commit).not.toHaveBeenCalled();
  });
});
