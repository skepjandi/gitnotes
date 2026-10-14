/**
 * NoteHistoryService.test.ts
 *
 * Focused tests for NoteHistoryService:
 * - Eligibility checks (new, local-only, PDF, missing identity)
 * - Happy path: resolve identity and load history
 * - Pagination and deduplication
 * - Blob loading at commit
 * - Error handling without Git mutations
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
import {
  getNoteHistoryEligibility,
  isNoteEligibleForHistory,
  resolveNoteHistoryIdentity,
  loadNoteFileHistory,
  loadNoteBlobAtCommit,
  getNoteHistoryIdentityOrUnavailable,
} from '@/services/note/NoteHistoryService';

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

describe('getNoteHistoryEligibility', () => {
  it('returns null for eligible clone-mode note', () => {
    const note = makeCloneModeNote();
    expect(getNoteHistoryEligibility(note)).toBeNull();
  });

  it('returns NewNote for note without filePath', () => {
    const note = makeCloneModeNote({ filePath: undefined });
    expect(getNoteHistoryEligibility(note)).toBe('NewNote');
  });

  it('returns MissingRepo for note without repo', () => {
    const note = makeCloneModeNote({ repo: undefined });
    expect(getNoteHistoryEligibility(note)).toBe('MissingRepo');
  });

  it('returns MissingBranch for note without branch', () => {
    const note = makeCloneModeNote({ branch: undefined });
    expect(getNoteHistoryEligibility(note)).toBe('MissingBranch');
  });

  it('returns PdfNote for PDF format', () => {
    const note = makeCloneModeNote({ format: 'pdf' });
    expect(getNoteHistoryEligibility(note)).toBe('PdfNote');
  });
});

describe('isNoteEligibleForHistory', () => {
  it('returns true for eligible clone-mode note', () => {
    const note = makeCloneModeNote();
    expect(isNoteEligibleForHistory(note)).toBe(true);
  });

  it('returns false for new note', () => {
    const note = makeCloneModeNote({ filePath: undefined });
    expect(isNoteEligibleForHistory(note)).toBe(false);
  });

  it('returns false for PDF note', () => {
    const note = makeCloneModeNote({ format: 'pdf' });
    expect(isNoteEligibleForHistory(note)).toBe(false);
  });
});

describe('resolveNoteHistoryIdentity', () => {
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

  it('resolves identity for eligible note', async () => {
    const note = makeCloneModeNote();

    const identity = await resolveNoteHistoryIdentity(note);

    expect(identity).toEqual({
      repoPath: 'owner/repo',
      repoId: 'repo-uuid-123',
      branch: 'main',
      filePath: 'notes/test.md',
      workingTreePath: MOCK_WORKING_TREE_PATH,
    });
  });

  it('uses note.branch when activeBranchStore returns null', async () => {
    const note = makeCloneModeNote({ branch: 'feature-branch' });
    mockActiveBranchStore.mockResolvedValue(null);

    const identity = await resolveNoteHistoryIdentity(note);

    expect(identity.branch).toBe('feature-branch');
  });

  it('uses active branch from store when available', async () => {
    const note = makeCloneModeNote({ branch: 'main' });
    mockActiveBranchStore.mockResolvedValue({
      repoId: MOCK_REPO.id,
      repoPath: MOCK_WORKING_TREE_PATH,
      activeBranch: 'feature-active',
      source: 'head',
      status: 'idle',
    });

    const identity = await resolveNoteHistoryIdentity(note);

    expect(identity.branch).toBe('feature-active');
  });

  it('throws when repository not found', async () => {
    mockStorageService.getSavedRepositories.mockResolvedValue([]);
    const note = makeCloneModeNote();

    await expect(resolveNoteHistoryIdentity(note)).rejects.toThrow(
      'Repository not found: owner/repo',
    );
  });
});

describe('loadNoteFileHistory', () => {
  const mockIdentity = {
    repoPath: 'owner/repo',
    repoId: 'repo-uuid-123',
    branch: 'main',
    filePath: 'notes/test.md',
    workingTreePath: MOCK_WORKING_TREE_PATH,
  };

  beforeEach(() => {
    jest.clearAllMocks();
  });

  it('returns history entries and hasMore flag', async () => {
    const mockResult = {
      entries: [
        {
          id: 'commit-1',
          shortId: 'commit-1',
          message: 'Update test.md',
          summary: 'Update test.md',
          authorName: 'Test User',
          authorEmail: 'test@example.com',
          authorTime: 1700000000,
          committerTime: 1700000000,
          parentCount: 1,
          parents: ['parent-1'],
        },
      ],
      shallow: false,
    };
    mockGitEngine.fileHistory.mockResolvedValue(mockResult);

    const result = await loadNoteFileHistory(mockIdentity, { limit: 50, skip: 0 });

    expect(result.entries).toHaveLength(1);
    expect(result.entries[0].id).toBe('commit-1');
    expect(result.shallow).toBe(false);
    expect(result.hasMore).toBe(false); // entries.length (1) < limit (50), so no more
    expect(mockGitEngine.fileHistory).toHaveBeenCalledWith(
      MOCK_WORKING_TREE_PATH,
      'main',
      'notes/test.md',
      50,
      0,
    );
  });

  it('deduplicates entries across pages', async () => {
    const mockResult = {
      entries: [
        {
          id: 'commit-duplicate',
          shortId: 'commit-dup',
          message: 'Duplicate commit',
          summary: 'Duplicate commit',
          authorName: 'Test User',
          authorEmail: 'test@example.com',
          authorTime: 1700000000,
          committerTime: 1700000000,
          parentCount: 1,
          parents: ['parent-1'],
        },
      ],
      shallow: false,
    };
    mockGitEngine.fileHistory.mockResolvedValue(mockResult);

    const result = await loadNoteFileHistory(mockIdentity, { limit: 50, skip: 0 });

    expect(result.entries).toHaveLength(1);
  });

  it('returns empty hasMore when shallow', async () => {
    mockGitEngine.fileHistory.mockResolvedValue({ entries: [], shallow: true });

    const result = await loadNoteFileHistory(mockIdentity, { limit: 50, skip: 0 });

    expect(result.shallow).toBe(true);
    expect(result.hasMore).toBe(false);
  });

  it('hasMore is true when page is full and not shallow', async () => {
    // Generate 50 entries to simulate a full page
    const fullPageEntries = Array.from({ length: 50 }, (_, i) => ({
      id: `commit-${i}`,
      shortId: `short-${i}`,
      message: `Commit ${i}`,
      summary: `Commit ${i}`,
      authorName: 'Test User',
      authorEmail: 'test@example.com',
      authorTime: 1700000000 + i,
      committerTime: 1700000000 + i,
      parentCount: 1,
      parents: [`parent-${i}`],
    }));
    mockGitEngine.fileHistory.mockResolvedValue({
      entries: fullPageEntries,
      shallow: false,
    });

    const result = await loadNoteFileHistory(mockIdentity, { limit: 50, skip: 0 });

    expect(result.entries).toHaveLength(50);
    expect(result.shallow).toBe(false);
    expect(result.hasMore).toBe(true); // full page + not shallow
  });

  it('hasMore is false when page is full but shallow', async () => {
    const fullPageEntries = Array.from({ length: 50 }, (_, i) => ({
      id: `commit-${i}`,
      shortId: `short-${i}`,
      message: `Commit ${i}`,
      summary: `Commit ${i}`,
      authorName: 'Test User',
      authorEmail: 'test@example.com',
      authorTime: 1700000000 + i,
      committerTime: 1700000000 + i,
      parentCount: 1,
      parents: [`parent-${i}`],
    }));
    mockGitEngine.fileHistory.mockResolvedValue({
      entries: fullPageEntries,
      shallow: true,
    });

    const result = await loadNoteFileHistory(mockIdentity, { limit: 50, skip: 0 });

    expect(result.entries).toHaveLength(50);
    expect(result.shallow).toBe(true);
    expect(result.hasMore).toBe(false); // shallow, even with full page
  });

  it('hasMore is false when subsequent page is partial', async () => {
    // Subsequent page (skip=50) returns fewer than limit entries = exhausted history
    const partialEntries = [
      {
        id: 'commit-a',
        shortId: 'short-a',
        message: 'Commit A',
        summary: 'Commit A',
        authorName: 'Test User',
        authorEmail: 'test@example.com',
        authorTime: 1700000000,
        committerTime: 1700000000,
        parentCount: 1,
        parents: ['parent-a'],
      },
      {
        id: 'commit-b',
        shortId: 'short-b',
        message: 'Commit B',
        summary: 'Commit B',
        authorName: 'Test User',
        authorEmail: 'test@example.com',
        authorTime: 1699999999,
        committerTime: 1699999999,
        parentCount: 1,
        parents: ['parent-b'],
      },
    ];
    mockGitEngine.fileHistory.mockResolvedValue({
      entries: partialEntries,
      shallow: false,
    });

    const result = await loadNoteFileHistory(mockIdentity, { limit: 50, skip: 50 });

    expect(result.entries).toHaveLength(2);
    expect(result.shallow).toBe(false);
    expect(result.hasMore).toBe(false); // partial page = exhausted history
  });
});

describe('loadNoteBlobAtCommit', () => {
  const mockIdentity = {
    repoPath: 'owner/repo',
    repoId: 'repo-uuid-123',
    branch: 'main',
    filePath: 'notes/test.md',
    workingTreePath: MOCK_WORKING_TREE_PATH,
  };

  beforeEach(() => {
    jest.clearAllMocks();
  });

  it('returns content on happy path', async () => {
    mockGitEngine.readBlobAtRef.mockResolvedValue({
      kind: 'Content',
      content: '# Historical Content\n',
      oid: 'blob-oid-123',
      mimeType: 'text/markdown',
      truncated: false,
    });

    const result = await loadNoteBlobAtCommit(mockIdentity, 'commit-1');

    expect(result.kind).toBe('Content');
    if (result.kind === 'Content') {
      expect(result.content).toBe('# Historical Content\n');
      expect(result.oid).toBe('blob-oid-123');
    }
    expect(mockGitEngine.readBlobAtRef).toHaveBeenCalledWith(
      MOCK_WORKING_TREE_PATH,
      'commit-1',
      'notes/test.md',
    );
  });

  it('returns PathNotFound error when file missing at commit', async () => {
    mockGitEngine.readBlobAtRef.mockResolvedValue({
      kind: 'Error',
      errorKind: 'PathNotFound',
      message: "path 'notes/nonexistent.md' not found at ref 'commit-1'",
    });

    const result = await loadNoteBlobAtCommit(mockIdentity, 'commit-1');

    expect(result.kind).toBe('Error');
    if (result.kind === 'Error') {
      expect(result.errorKind).toBe('PathNotFound');
    }
  });

  it('returns ShallowHistory error for shallow clones', async () => {
    mockGitEngine.readBlobAtRef.mockResolvedValue({
      kind: 'Error',
      errorKind: 'ShallowHistory',
      message: "ref 'main' is a shallow commit",
    });

    const result = await loadNoteBlobAtCommit(mockIdentity, 'commit-1');

    expect(result.kind).toBe('Error');
    if (result.kind === 'Error') {
      expect(result.errorKind).toBe('ShallowHistory');
    }
  });

  it('returns BinaryContent error for binary files', async () => {
    mockGitEngine.readBlobAtRef.mockResolvedValue({
      kind: 'Error',
      errorKind: 'BinaryContent',
      message: "file 'image.png' at ref 'main' is binary",
    });

    const result = await loadNoteBlobAtCommit(mockIdentity, 'commit-1');

    expect(result.kind).toBe('Error');
    if (result.kind === 'Error') {
      expect(result.errorKind).toBe('BinaryContent');
    }
  });

  it('returns TooLarge error for large blobs', async () => {
    mockGitEngine.readBlobAtRef.mockResolvedValue({
      kind: 'Error',
      errorKind: 'TooLarge',
      message: 'blob exceeds size limit',
    });

    const result = await loadNoteBlobAtCommit(mockIdentity, 'commit-1');

    expect(result.kind).toBe('Error');
    if (result.kind === 'Error') {
      expect(result.errorKind).toBe('TooLarge');
    }
  });
});

describe('getNoteHistoryIdentityOrUnavailable', () => {
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

  it('returns available=true for eligible note', async () => {
    const note = makeCloneModeNote();

    const result = await getNoteHistoryIdentityOrUnavailable(note);

    expect(result.available).toBe(true);
    if (result.available) {
      expect(result.identity.repoPath).toBe('owner/repo');
    }
  });

  it('returns available=false with reason for new note', async () => {
    const note = makeCloneModeNote({ filePath: undefined });

    const result = await getNoteHistoryIdentityOrUnavailable(note);

    expect(result.available).toBe(false);
    if (!result.available) {
      expect(result.reason).toBe('NewNote');
    }
  });

  it('returns available=false with reason for PDF note', async () => {
    const note = makeCloneModeNote({ format: 'pdf' });

    const result = await getNoteHistoryIdentityOrUnavailable(note);

    expect(result.available).toBe(false);
    if (!result.available) {
      expect(result.reason).toBe('PdfNote');
    }
  });

  it('returns available=false with reason when repo not found', async () => {
    mockStorageService.getSavedRepositories.mockResolvedValue([]);
    const note = makeCloneModeNote();

    const result = await getNoteHistoryIdentityOrUnavailable(note);

    expect(result.available).toBe(false);
    if (!result.available) {
      expect(result.reason).toBe('NoRepositoryFound');
    }
  });
});
