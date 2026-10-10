import { StorageService } from '@/services/StorageService';
import { CloneSyncService } from '@/services/cloneSyncServiceImpl';
import { useNoteStore } from '@/stores/noteStore';

jest.mock('@/services/StorageService', () => ({
  StorageService: {
    deleteNote: jest.fn(),
    createNote: jest.fn(),
  },
}));

jest.mock('@/services/cloneSyncServiceImpl', () => ({
  CloneSyncService: { save: jest.fn() },
  NoteSyncQueueService: {
    onMutationSucceeded: jest.fn(),
    onDroppedMutation: jest.fn(),
  },
}));

jest.mock('@/services/git/defaultsPolicy', () => ({
  resolveDefaultFolder: jest.fn(() => 'notes/'),
  resolveDefaultRepo: jest.fn(),
}));

jest.mock('@/stores/gitOperationStore', () => ({
  gitOperationRegistry: {
    begin: jest.fn(() => 'op'),
    fail: jest.fn(),
    succeed: jest.fn(),
  },
  useGitOperationStore: { getState: jest.fn() },
}));

describe('noteStore.createNote filePath override', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    (CloneSyncService.save as jest.Mock).mockResolvedValue({ success: true });
  });

  it('passes explicit filePath to CloneSyncService.save when provided', async () => {
    const createdNote = {
      id: 'note-1',
      title: 'Welcome to GitNotēs',
      content: '# Welcome\n',
      createdAt: 1,
      updatedAt: 1,
      tags: [],
      repo: 'testuser/gitnotes',
      branch: 'main',
      filePath: 'notes/welcome-to-gitnotes.md',
      isPinned: false,
      format: 'markdown' as const,
      attachments: [],
    };
    (StorageService.createNote as jest.Mock).mockResolvedValue(createdNote);

    const result = await useNoteStore.getState().createNote({
      title: 'Welcome to GitNotēs',
      content: '# Welcome\n',
      format: 'markdown',
      repo: 'testuser/gitnotes',
      branch: 'main',
      folderPath: 'notes',
      filePath: 'notes/welcome-to-gitnotes.md',
    });

    expect(CloneSyncService.save).toHaveBeenCalledTimes(1);
    expect(CloneSyncService.save).toHaveBeenCalledWith(
      expect.objectContaining({
        repoPath: 'testuser/gitnotes',
        branch: 'main',
        filePath: 'notes/welcome-to-gitnotes.md',
        intent: 'upsert',
      }),
    );
    expect(result).toMatchObject({ id: 'note-1', filePath: 'notes/welcome-to-gitnotes.md' });
  });

  it('does not derive path from slug when filePath is explicitly provided', async () => {
    const createdNote = {
      id: 'note-1',
      title: 'Welcome to GitNotēs',
      content: '# Welcome\n',
      createdAt: 1,
      updatedAt: 1,
      tags: [],
      repo: 'testuser/gitnotes',
      branch: 'main',
      filePath: 'notes/welcome-to-gitnotes.md',
      isPinned: false,
      format: 'markdown' as const,
      attachments: [],
    };
    (StorageService.createNote as jest.Mock).mockResolvedValue(createdNote);

    await useNoteStore.getState().createNote({
      title: 'Welcome to GitNotēs',
      content: '# Welcome\n',
      format: 'markdown',
      repo: 'testuser/gitnotes',
      branch: 'main',
      folderPath: 'notes',
      filePath: 'notes/welcome-to-gitnotes.md',
    });

    const saveCall = (CloneSyncService.save as jest.Mock).mock.calls[0][0];
    expect(saveCall.filePath).not.toBe('notes/welcome-to-gitn-t-s.md');
    expect(saveCall.filePath).toBe('notes/welcome-to-gitnotes.md');
  });

  it('passes resolved filePath to StorageService.createNote for metadata', async () => {
    const createdNote = {
      id: 'note-1',
      title: 'Welcome to GitNotēs',
      content: '# Welcome\n',
      createdAt: 1,
      updatedAt: 1,
      tags: [],
      repo: 'testuser/gitnotes',
      branch: 'main',
      filePath: 'notes/welcome-to-gitnotes.md',
      isPinned: false,
      format: 'markdown' as const,
      attachments: [],
    };
    (StorageService.createNote as jest.Mock).mockResolvedValue(createdNote);

    await useNoteStore.getState().createNote({
      title: 'Welcome to GitNotēs',
      content: '# Welcome\n',
      format: 'markdown',
      repo: 'testuser/gitnotes',
      branch: 'main',
      folderPath: 'notes',
      filePath: 'notes/welcome-to-gitnotes.md',
    });

    expect(StorageService.createNote).toHaveBeenCalledTimes(1);
    expect(StorageService.createNote).toHaveBeenCalledWith(
      expect.objectContaining({
        filePath: 'notes/welcome-to-gitnotes.md',
      }),
    );
  });

  it('returns null and sets error when CloneSyncService.save fails', async () => {
    (CloneSyncService.save as jest.Mock).mockResolvedValue({ success: false, error: 'disk full' });
    useNoteStore.setState({ error: null });

    const result = await useNoteStore.getState().createNote({
      title: 'Welcome to GitNotēs',
      content: '# Welcome\n',
      format: 'markdown',
      repo: 'testuser/gitnotes',
      branch: 'main',
      folderPath: 'notes',
      filePath: 'notes/welcome-to-gitnotes.md',
    });

    expect(result).toBeNull();
    expect(useNoteStore.getState().error).toBe('disk full');
  });
});
