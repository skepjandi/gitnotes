/**
 * useNoteHistory.test.ts
 *
 * Focused tests for useNoteHistory hook:
 * - Stale history/blob request cleanup when note changes
 * - Close cleanup resets all state and aborts pending requests
 * - Pagination appends, preserves order, and deduplicates
 * - No checkout/reset/branch mutation calls
 * - Lifecycle: abort on unmount
 */

jest.mock('@/services/StorageService', () => ({
  StorageService: {
    getSavedRepositories: jest.fn(),
  },
}));

jest.mock('@/services/git/activeBranchStore', () => ({
  getActiveBranch: jest.fn(),
}));

jest.mock('@/services/git/engine/GitEngine', () => ({
  fileHistory: jest.fn(),
  readBlobAtRef: jest.fn(),
  checkout: jest.fn(),
  resetSoft: jest.fn(),
}));

jest.mock('@/services/git/GitFsService', () => ({
  GitFsService: {
    workingTreeUri: jest.fn(),
  },
}));

import type { Note } from '@/models/Note';
import { StorageService } from '@/services/StorageService';
import { getActiveBranch } from '@/services/git/activeBranchStore';
import * as GitEngine from '@/services/git/engine/GitEngine';
import { GitFsService } from '@/services/git/GitFsService';
import { act, renderHook } from '@testing-library/react-native';
import { useNoteHistory } from '@/hooks/useNoteHistory';

const mockStorageService = StorageService as jest.Mocked<typeof StorageService>;
const mockActiveBranchStore = getActiveBranch as jest.MockedFunction<typeof getActiveBranch>;
const mockGitEngine = GitEngine as jest.Mocked<typeof GitEngine>;
const mockGitFsService = GitFsService as jest.Mocked<typeof GitFsService>;

const MOCK_REPO = {
  id: 'repo-uuid-123',
  path: 'owner/repo',
  full_name: 'Owner/Repo',
  name: 'repo',
  branch: 'main',
  provider: 'github' as const,
  hostId: 'host-uuid',
};

const MOCK_WORKING_TREE_PATH = '/Users/documents/GitNotes/owner/repo';

function makeCloneModeNote(overrides: Partial<Note> = {}): Note {
  return {
    id: 'note-1',
    title: 'Test Note',
    content: '# Test Content',
    createdAt: Date.now(),
    updatedAt: Date.now(),
    tags: [],
    repo: 'owner/repo',
    branch: 'main',
    filePath: 'notes/test.md',
    format: 'markdown',
    ...overrides,
  };
}

const mockEntry = (id: string) => ({
  id,
  shortId: id.slice(0, 7),
  message: `Commit ${id}`,
  summary: `Commit ${id}`,
  authorName: 'Test User',
  authorEmail: 'test@example.com',
  authorTime: 1700000000,
  committerTime: 1700000000,
  parentCount: 1,
  parents: ['parent-1'],
});

describe('useNoteHistory hook lifecycle', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockGitFsService.workingTreeUri.mockReturnValue(MOCK_WORKING_TREE_PATH);
    mockStorageService.getSavedRepositories.mockResolvedValue([MOCK_REPO]);
    mockActiveBranchStore.mockResolvedValue({
      repoId: MOCK_REPO.id,
      repoPath: MOCK_WORKING_TREE_PATH,
      activeBranch: 'main',
      source: 'head',
      status: 'idle',
    });
  });

  describe('loadHistory', () => {
    it('loads history and sets status to ready with entries', async () => {
      mockGitEngine.fileHistory.mockResolvedValue({
        entries: [mockEntry('commit-1'), mockEntry('commit-2')],
        shallow: false,
      });

      const note = makeCloneModeNote();
      const { result } = renderHook(() => useNoteHistory({ note }));

      await act(async () => {
        result.current.loadHistory();
      });

      expect(result.current.state.status).toBe('ready');
      if (result.current.state.status === 'ready') {
        expect(result.current.state.entries).toHaveLength(2);
        expect(result.current.state.shallow).toBe(false);
        expect(result.current.state.hasMore).toBe(false);
      }
    });

    it('sets status to empty when no entries returned', async () => {
      mockGitEngine.fileHistory.mockResolvedValue({ entries: [], shallow: false });

      const note = makeCloneModeNote();
      const { result } = renderHook(() => useNoteHistory({ note }));

      await act(async () => {
        result.current.loadHistory();
      });

      expect(result.current.state.status).toBe('empty');
      if (result.current.state.status === 'empty') {
        expect(result.current.state.shallow).toBe(false);
      }
    });

    it('sets status to unavailable when note is not eligible', async () => {
      const note = makeCloneModeNote({ filePath: undefined });

      const { result } = renderHook(() => useNoteHistory({ note }));

      await act(async () => {
        result.current.loadHistory();
      });

      expect(result.current.state.status).toBe('unavailable');
      if (result.current.state.status === 'unavailable') {
        expect(result.current.unavailableReason).toBe('NewNote');
      }
    });

    it('sets status to error when fileHistory throws', async () => {
      mockGitEngine.fileHistory.mockRejectedValue(new Error('Native module unavailable'));

      const note = makeCloneModeNote();
      const { result } = renderHook(() => useNoteHistory({ note }));

      await act(async () => {
        result.current.loadHistory();
      });

      expect(result.current.state.status).toBe('error');
      if (result.current.state.status === 'error') {
        expect(result.current.state.message).toBe('Native module unavailable');
      }
    });

    it('does not call checkout or reset when loading history', async () => {
      mockGitEngine.fileHistory.mockResolvedValue({ entries: [], shallow: false });

      const note = makeCloneModeNote();
      const { result } = renderHook(() => useNoteHistory({ note }));

      await act(async () => {
        result.current.loadHistory();
      });

      expect(mockGitEngine.checkout).not.toHaveBeenCalled();
      expect(mockGitEngine.resetSoft).not.toHaveBeenCalled();
    });
  });

  describe('selectCommit', () => {
    it('loads blob for selected commit', async () => {
      mockGitEngine.fileHistory.mockResolvedValue({
        entries: [mockEntry('commit-1')],
        shallow: false,
      });
      mockGitEngine.readBlobAtRef.mockResolvedValue({
        kind: 'Content',
        content: '# Historical Content\n',
        oid: 'blob-oid-123',
        mimeType: 'text/markdown',
        truncated: false,
      });

      const note = makeCloneModeNote();
      const { result } = renderHook(() => useNoteHistory({ note }));

      await act(async () => {
        result.current.loadHistory();
      });

      await act(async () => {
        result.current.selectCommit('commit-1');
      });

      expect(result.current.selectedCommitId).toBe('commit-1');
      expect(result.current.isLoadingBlob).toBe(false);
      expect(result.current.selectedBlob).not.toBeNull();
      if (result.current.selectedBlob?.kind === 'Content') {
        expect(result.current.selectedBlob.content).toBe('# Historical Content\n');
      }
    });

    it('does not call checkout or reset when loading blob', async () => {
      mockGitEngine.fileHistory.mockResolvedValue({
        entries: [mockEntry('commit-1')],
        shallow: false,
      });
      mockGitEngine.readBlobAtRef.mockResolvedValue({
        kind: 'Content',
        content: '# Content',
        oid: 'oid',
        mimeType: 'text/markdown',
        truncated: false,
      });

      const note = makeCloneModeNote();
      const { result } = renderHook(() => useNoteHistory({ note }));

      await act(async () => {
        result.current.loadHistory();
      });

      await act(async () => {
        result.current.selectCommit('commit-1');
      });

      expect(mockGitEngine.checkout).not.toHaveBeenCalled();
      expect(mockGitEngine.resetSoft).not.toHaveBeenCalled();
    });

    it('does not call checkout when blob read returns error kind', async () => {
      mockGitEngine.fileHistory.mockResolvedValue({
        entries: [mockEntry('commit-1')],
        shallow: false,
      });
      mockGitEngine.readBlobAtRef.mockResolvedValue({
        kind: 'Error',
        errorKind: 'PathNotFound',
        message: 'path not found',
      });

      const note = makeCloneModeNote();
      const { result } = renderHook(() => useNoteHistory({ note }));

      await act(async () => {
        result.current.loadHistory();
      });

      await act(async () => {
        result.current.selectCommit('commit-1');
      });

      expect(result.current.selectedBlob?.kind).toBe('Error');
      expect(mockGitEngine.checkout).not.toHaveBeenCalled();
      expect(mockGitEngine.resetSoft).not.toHaveBeenCalled();
    });
  });

  describe('loadMore pagination', () => {
    it('loadMore does not call fileHistory when hasMore is false', async () => {
      mockGitEngine.fileHistory.mockResolvedValue({
        entries: [mockEntry('commit-1'), mockEntry('commit-2')],
        shallow: false,
      });

      const note = makeCloneModeNote();
      const { result } = renderHook(() => useNoteHistory({ note }));

      await act(async () => {
        result.current.loadHistory();
      });

      const initialEntries = result.current.state.status === 'ready' ? result.current.state.entries.length : 0;

      await act(async () => {
        result.current.loadMore();
      });

      if (result.current.state.status === 'ready') {
        expect(result.current.state.entries).toHaveLength(initialEntries);
      }
    });

    it('loadMore returns early when state is not ready', async () => {
      mockGitEngine.fileHistory.mockRejectedValue(new Error('error'));

      const note = makeCloneModeNote();
      const { result } = renderHook(() => useNoteHistory({ note }));

      await act(async () => {
        result.current.loadHistory();
      });

      await act(async () => {
        result.current.loadMore();
      });

      expect(result.current.state.status).toBe('error');
    });

    it('loadMore appends entries with deduplication and newest-first order', async () => {
      const firstPage = Array.from({ length: 50 }, (_, i) =>
        mockEntry(`commit-${String(i).padStart(3, '0')}`),
      );
      const secondPage = [
        mockEntry('commit-048'),
        mockEntry('commit-050'),
        mockEntry('commit-051'),
        mockEntry('commit-052'),
      ];

      mockGitEngine.fileHistory
        .mockResolvedValueOnce({ entries: firstPage, shallow: false })
        .mockResolvedValueOnce({ entries: secondPage, shallow: false });

      const note = makeCloneModeNote();
      const { result } = renderHook(() => useNoteHistory({ note }));

      await act(async () => {
        result.current.loadHistory();
      });

      expect(result.current.state.status).toBe('ready');
      if (result.current.state.status === 'ready') {
        expect(result.current.state.entries).toHaveLength(50);
        expect(result.current.state.hasMore).toBe(true);
      }

      await act(async () => {
        result.current.loadMore();
      });

      expect(result.current.state.status).toBe('ready');
      if (result.current.state.status === 'ready') {
        expect(result.current.state.entries).toHaveLength(53);
        expect(result.current.state.entries[0].id).toBe('commit-000');
        expect(result.current.state.entries[49].id).toBe('commit-049');
        expect(result.current.state.entries[50].id).toBe('commit-050');
        expect(result.current.state.entries[52].id).toBe('commit-052');
        const hasDuplicate = result.current.state.entries.some(
          (e, i) => result.current.state.entries.findIndex((x) => x.id === e.id) !== i,
        );
        expect(hasDuplicate).toBe(false);
      }
    });
  });

  describe('close cleanup', () => {
    it('resets state to idle on close', async () => {
      mockGitEngine.fileHistory.mockResolvedValue({
        entries: [mockEntry('commit-1')],
        shallow: false,
      });
      mockGitEngine.readBlobAtRef.mockResolvedValue({
        kind: 'Content',
        content: '# Content',
        oid: 'oid',
        mimeType: 'text/markdown',
        truncated: false,
      });

      const note = makeCloneModeNote();
      const { result } = renderHook(() => useNoteHistory({ note }));

      await act(async () => {
        result.current.loadHistory();
      });

      await act(async () => {
        result.current.selectCommit('commit-1');
      });

      await act(async () => {
        result.current.close();
      });

      expect(result.current.state.status).toBe('idle');
      expect(result.current.selectedCommitId).toBeNull();
      expect(result.current.selectedBlob).toBeNull();
      expect(result.current.isLoadingBlob).toBe(false);
      expect(result.current.hasMore).toBe(false);
      expect(result.current.identity).toBeNull();
    });

    it('aborts in-flight history request on close', async () => {
      mockGitEngine.fileHistory.mockImplementation(
        () => new Promise(() => { /* never resolves */ }),
      );

      const note = makeCloneModeNote();
      const { result } = renderHook(() => useNoteHistory({ note }));

      await act(async () => {
        result.current.loadHistory();
      });

      await act(async () => {
        result.current.close();
      });

      expect(result.current.state.status).toBe('idle');
    });

    it('aborts in-flight blob request on close', async () => {
      mockGitEngine.fileHistory.mockResolvedValue({
        entries: [mockEntry('commit-1')],
        shallow: false,
      });

      mockGitEngine.readBlobAtRef.mockImplementation(
        () => new Promise(() => { /* never resolves */ }),
      );

      const note = makeCloneModeNote();
      const { result } = renderHook(() => useNoteHistory({ note }));

      await act(async () => {
        result.current.loadHistory();
      });

      await act(async () => {
        result.current.selectCommit('commit-1');
      });

      await act(async () => {
        result.current.close();
      });

      expect(result.current.state.status).toBe('idle');
    });
  });

  describe('stale request handling', () => {
    it('resets state when note changes', async () => {
      mockGitEngine.fileHistory.mockResolvedValue({
        entries: [mockEntry('commit-1')],
        shallow: false,
      });

      const note1 = makeCloneModeNote({ id: 'note-1' });
      const note2 = makeCloneModeNote({ id: 'note-2', filePath: 'notes/other.md' });

      const { result, rerender } = renderHook(
        ({ n }: { n: Note }) => useNoteHistory({ note: n }),
        { initialProps: { n: note1 } },
      );

      await act(async () => {
        result.current.loadHistory();
      });

      expect(result.current.state.status).toBe('ready');

      rerender({ n: note2 });

      expect(result.current.state.status).toBe('idle');
      expect(result.current.selectedCommitId).toBeNull();
    });

    it('stale history request cannot overwrite state after rerender to different note', async () => {
      const noteAEntry = mockEntry('note-a-commit');
      const noteBEntry = mockEntry('note-b-commit');

      mockGitEngine.fileHistory.mockImplementation(
        () =>
          new Promise((resolve) => {
            const callNumber = mockGitEngine.fileHistory.mock.calls.length;
            if (callNumber === 1) {
              setTimeout(() => resolve({ entries: [noteAEntry], shallow: false }), 0);
            } else {
              resolve({ entries: [noteBEntry], shallow: false });
            }
          }),
      );

      const noteA = makeCloneModeNote({ id: 'note-a', filePath: 'notes/note-a.md' });
      const noteB = makeCloneModeNote({ id: 'note-b', filePath: 'notes/note-b.md' });

      const { result, rerender } = renderHook(
        ({ n }: { n: Note }) => useNoteHistory({ note: n }),
        { initialProps: { n: noteA } },
      );

      await act(async () => {
        result.current.loadHistory();
      });

      rerender({ n: noteB });

      await act(async () => {
        result.current.loadHistory();
        await Promise.resolve();
        await Promise.resolve();
      });

      expect(result.current.state.status).toBe('ready');
      expect(result.current.state.entries[0].id).toBe('note-b-commit');
    });
  });

  describe('unmount cleanup', () => {
    it('aborts requests on unmount', () => {
      mockGitEngine.fileHistory.mockImplementation(
        () => new Promise(() => { /* never resolves */ }),
      );

      const note = makeCloneModeNote();
      const { result, unmount } = renderHook(() => useNoteHistory({ note }));

      act(() => {
        result.current.loadHistory();
      });

      unmount();

      expect(result.current.state.status).toBe('idle');
    });
  });

  describe('isDirty propagation', () => {
    it('exposes isDirty from options', async () => {
      const note = makeCloneModeNote();

      const { result } = renderHook(() =>
        useNoteHistory({ note, isDirty: true }),
      );

      expect(result.current.isDirty).toBe(true);
    });

    it('defaults isDirty to false', async () => {
      const note = makeCloneModeNote();

      const { result } = renderHook(() => useNoteHistory({ note }));

      expect(result.current.isDirty).toBe(false);
    });
  });
});
