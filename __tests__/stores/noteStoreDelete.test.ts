import type { Note } from '@/models/Note';
import { StorageService } from '@/services/StorageService';
import { CloneSyncService } from '@/services/cloneSyncServiceImpl';
import { CommitService } from '@/services/git/CommitService';
import { useNoteStore } from '@/stores/noteStore';

jest.mock('@/services/StorageService', () => ({
  StorageService: {
    deleteNote: jest.fn(),
    createNote: jest.fn(),
  },
}));

jest.mock('@/services/cloneSyncServiceImpl', () => ({
  CloneSyncService: {
    save: jest.fn(),
    listTree: jest.fn(),
  },
  NoteSyncQueueService: {
    onMutationSucceeded: jest.fn(),
    onDroppedMutation: jest.fn(),
  },
}));

jest.mock('@/services/git/CommitService', () => ({
  CommitService: { commit: jest.fn() },
}));

jest.mock('@/services/git/defaultsPolicy', () => ({
  resolveDefaultFolder: jest.fn(() => 'notes/'),
  resolveDefaultRepo: jest.fn(),
}));

jest.mock('@/services/NoteGitHubSyncService', () => ({
  applyNoteTagsToContent: (content: string) => content,
  applyNoteColorToContent: (content: string) => content,
}));

jest.mock('@/services/git/deleteFailures', () => ({
  recordDeleteFailure: jest.fn(),
}));

jest.mock('@/stores/gitOperationStore', () => ({
  gitOperationRegistry: {
    begin: jest.fn(() => 'delete-op'),
    fail: jest.fn(),
    succeed: jest.fn(),
  },
  useGitOperationStore: { getState: jest.fn() },
}));

describe('noteStore delete flows', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    (CloneSyncService.save as jest.Mock).mockResolvedValue({ success: true });
    (StorageService.deleteNote as jest.Mock).mockResolvedValue(true);
  });

  it('deletes a note without creating a commit', async () => {
    const note: Note = {
      id: 'note-1',
      title: 'Example',
      content: 'content',
      createdAt: 1,
      updatedAt: 1,
      tags: [],
      repo: 'owner/repo',
      branch: 'main',
      filePath: 'notes/example.md',
    };
    useNoteStore.setState({ notes: [note], error: null });

    await expect(useNoteStore.getState().deleteNote(note.id)).resolves.toBe(true);

    expect(CloneSyncService.save).toHaveBeenCalledWith(expect.objectContaining({
      repoPath: 'owner/repo',
      filePath: 'notes/example.md',
      intent: 'delete',
    }));
    expect(CommitService.commit).not.toHaveBeenCalled();
  });

  it('writes a new note without creating a commit', async () => {
    const createdNote: Note = {
      id: 'note-2',
      title: 'New note',
      content: 'content',
      createdAt: 1,
      updatedAt: 1,
      tags: [],
      repo: 'owner/repo',
      branch: 'main',
      filePath: 'notes/new-note.md',
    };
    (StorageService.createNote as jest.Mock).mockResolvedValue(createdNote);
    (CommitService.commit as jest.Mock).mockResolvedValue({ success: true });

    await expect(useNoteStore.getState().createNote({
      title: 'New note',
      content: 'content',
      repo: 'owner/repo',
      branch: 'main',
      format: 'markdown',
    })).resolves.toEqual(createdNote);

    expect(CloneSyncService.save).toHaveBeenCalledWith(expect.objectContaining({
      repoPath: 'owner/repo',
      branch: 'main',
      filePath: 'notes/new-note.md',
      intent: 'upsert',
    }));
    expect(CommitService.commit).not.toHaveBeenCalled();
  });

  describe('untitled note naming', () => {
    it('blank title uses notes/untitled.md when no existing untitled files', async () => {
      const createdNote: Note = {
        id: 'note-3',
        title: '',
        content: 'content',
        createdAt: 1,
        updatedAt: 1,
        tags: [],
        repo: 'owner/repo',
        branch: 'main',
        filePath: 'notes/untitled.md',
      };
      (CloneSyncService.listTree as jest.Mock).mockResolvedValue([]);
      (StorageService.createNote as jest.Mock).mockResolvedValue(createdNote);

      const result = await useNoteStore.getState().createNote({
        title: '',
        content: 'content',
        repo: 'owner/repo',
        branch: 'main',
        format: 'markdown',
      });

      expect(result?.filePath).toBe('notes/untitled.md');
      expect(CloneSyncService.save).toHaveBeenCalledWith(expect.objectContaining({
        repoPath: 'owner/repo',
        branch: 'main',
        filePath: 'notes/untitled.md',
        intent: 'upsert',
      }));
      expect(StorageService.createNote).toHaveBeenCalledWith(
        expect.objectContaining({ filePath: 'notes/untitled.md' }),
      );
    });

    it('blank title uses notes/untitled1.md when notes/untitled.md already exists', async () => {
      const createdNote: Note = {
        id: 'note-4',
        title: '',
        content: 'content',
        createdAt: 1,
        updatedAt: 1,
        tags: [],
        repo: 'owner/repo',
        branch: 'main',
        filePath: 'notes/untitled1.md',
      };
      (CloneSyncService.listTree as jest.Mock).mockResolvedValue([
        { path: 'notes/untitled.md', type: 'blob', sha: 'abc' },
      ]);
      (StorageService.createNote as jest.Mock).mockResolvedValue(createdNote);

      const result = await useNoteStore.getState().createNote({
        title: '',
        content: 'content',
        repo: 'owner/repo',
        branch: 'main',
        format: 'markdown',
      });

      expect(result?.filePath).toBe('notes/untitled1.md');
      expect(CloneSyncService.save).toHaveBeenCalledWith(expect.objectContaining({
        filePath: 'notes/untitled1.md',
      }));
    });

    it('blank title uses notes/untitled2.md when notes/untitled.md and notes/untitled1.md exist', async () => {
      const createdNote: Note = {
        id: 'note-5',
        title: '',
        content: 'content',
        createdAt: 1,
        updatedAt: 1,
        tags: [],
        repo: 'owner/repo',
        branch: 'main',
        filePath: 'notes/untitled2.md',
      };
      (CloneSyncService.listTree as jest.Mock).mockResolvedValue([
        { path: 'notes/untitled.md', type: 'blob', sha: 'abc' },
        { path: 'notes/untitled1.md', type: 'blob', sha: 'def' },
      ]);
      (StorageService.createNote as jest.Mock).mockResolvedValue(createdNote);

      const result = await useNoteStore.getState().createNote({
        title: '',
        content: 'content',
        repo: 'owner/repo',
        branch: 'main',
        format: 'markdown',
      });

      expect(result?.filePath).toBe('notes/untitled2.md');
      expect(CloneSyncService.save).toHaveBeenCalledWith(expect.objectContaining({
        filePath: 'notes/untitled2.md',
      }));
    });

    it('preserves .norg extension for neorg format', async () => {
      const createdNote: Note = {
        id: 'note-6',
        title: '',
        content: 'content',
        createdAt: 1,
        updatedAt: 1,
        tags: [],
        repo: 'owner/repo',
        branch: 'main',
        filePath: 'notes/untitled.norg',
      };
      (CloneSyncService.listTree as jest.Mock).mockResolvedValue([]);
      (StorageService.createNote as jest.Mock).mockResolvedValue(createdNote);

      const result = await useNoteStore.getState().createNote({
        title: '',
        content: 'content',
        repo: 'owner/repo',
        branch: 'main',
        format: 'neorg',
      });

      expect(result?.filePath).toBe('notes/untitled.norg');
      expect(CloneSyncService.save).toHaveBeenCalledWith(expect.objectContaining({
        filePath: 'notes/untitled.norg',
      }));
    });

    it('save failure does not call StorageService.createNote', async () => {
      (CloneSyncService.listTree as jest.Mock).mockResolvedValue([]);
      (CloneSyncService.save as jest.Mock).mockResolvedValue({ success: false, error: 'disk error' });

      const result = await useNoteStore.getState().createNote({
        title: '',
        content: 'content',
        repo: 'owner/repo',
        branch: 'main',
        format: 'markdown',
      });

      expect(result).toBeNull();
      expect(StorageService.createNote).not.toHaveBeenCalled();
    });
  });
});
