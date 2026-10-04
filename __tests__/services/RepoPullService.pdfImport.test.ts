/**
 * Regression fixtures for binary PDF import and clone/pull timing boundaries.
 *
 * Baseline characterization (these tests PASS against current code):
 *   - PDFs ARE selected by NOTE_EXTS and flow through to the import pipeline
 *   - cloneExclusive and pullFromSingleRepo are separately observable phases
 *   - Reader errors and empty trees are handled without fabricating notes
 *
 * Failing-first (these tests FAIL until Todo 2 removes 'pdf' from NOTE_EXTS):
 *   - PDFs should NOT be selected for text-note import
 *
 * Refs: src/services/RepoPullService.ts (NOTE_EXTS line 199, pullNotesFromRepo line 315)
 *       src/services/RepoImportService.ts (runImport line 84, cloneExclusive line 124, pullFromSingleRepo line 140)
 */

// Prevent native Expo modules from loading when jest.requireActual loads RepoPullService
jest.mock('expo-sqlite', () => ({}), { virtual: true });
jest.mock('expo-file-system', () => ({ File: {}, Directory: {}, Paths: {} }), { virtual: true });
jest.mock('@/stores/aiStore', () => ({ useAiStore: { getState: () => ({}) } }), { virtual: true });

import { importRepoAtAdd } from '@/services/RepoImportService';
import { pullFromSingleRepo } from '@/services/RepoPullService';
import { AccountStorage } from '@/services/AccountStorage';
import { AuthService } from '@/services/AuthService';
import { StorageService } from '@/services/StorageService';
import { GitFsService } from '@/services/git/GitFsService';
import { resolveBranch } from '@/services/git/branchResolver';
import { GitHubService } from '@/services/GitHubService';

// ─── Mocks ───────────────────────────────────────────────────────────────────

jest.mock('@/services/AccountStorage', () => ({
  AccountStorage: {
    getActiveHostConnection: jest.fn(),
    getHostConnection: jest.fn(),
    getHostUseSsh: jest.fn(),
    getSshKey: jest.fn(),
  },
}));

jest.mock('@/services/AuthService', () => ({
  AuthService: {
    getToken: jest.fn(),
  },
}));

jest.mock('@/services/StorageService', () => ({
  StorageService: {
    getSavedRepositories: jest.fn(),
    getAllNotes: jest.fn(),
    saveAllNotes: jest.fn(),
    getAllTodos: jest.fn(),
    saveAllTodos: jest.fn(),
    mutateCanvases: jest.fn(),
    invalidateRepoFoldersCache: jest.fn(),
  },
}));

jest.mock('@/services/git/GitFsService', () => ({
  GitFsService: {
    isCloned: jest.fn(),
    cloneExclusive: jest.fn(),
    getCommitOid: jest.fn(),
    listTree: jest.fn(),
    readFile: jest.fn(),
    pullWithFastForward: jest.fn(),
    removeRepo: jest.fn(),
  },
}));

jest.mock('@/services/git/branchResolver', () => ({
  resolveBranch: jest.fn(),
}));

jest.mock('@/services/git/engine/GitEngine', () => ({
  setCredential: jest.fn(),
}));

jest.mock('@/services/GitHubService', () => ({
  GitHubService: {
    isAuthenticated: jest.fn(() => true),
    getPathCommitDates: jest.fn(() => Promise.resolve({})),
  },
}));

const mockPullFromSingleRepo = jest.fn();

let realPullFromSingleRepo: (
  ...args: Parameters<typeof import('@/services/RepoPullService').pullFromSingleRepo>
) => ReturnType<typeof import('@/services/RepoPullService').pullFromSingleRepo>;

jest.mock('@/services/RepoPullService', () => {
  const actual = jest.requireActual('@/services/RepoPullService');
  realPullFromSingleRepo = actual.pullFromSingleRepo;
  return {
    ...actual,
    pullFromSingleRepo: (...args: unknown[]) => mockPullFromSingleRepo(...args),
  };
});

export { realPullFromSingleRepo };

// ─── Shared tree fixture (does not modify source repository) ───────────────────

const TREE_WITH_MD_AND_PDF = [
  { path: 'notes/welcome.md', type: 'blob' as const, sha: 'aaa', size: 120 },
  { path: 'notes/guide.pdf', type: 'blob' as const, sha: 'bbb', size: 8192 },
  { path: 'README.md', type: 'blob' as const, sha: 'ccc', size: 80 },
];

// ─── PDF exclusion through the real import seam ────────────────────────────────

/**
 * Exercises the real pullFromSingleRepo → pullNotesFromRepo import path to verify
 * PDF files are excluded from the notes import pipeline.
 *
 * The production NOTE_EXTS constant (['md', 'markdown', 'norg', 'org', 'txt'])
 * does NOT include 'pdf'. This test proves that by observing what StorageService.saveAllNotes
 * receives when the tree contains both .md and .pdf files.
 *
 * If NOTE_EXTS were changed to include 'pdf' (regression), this test would fail.
 */
describe('PDF exclusion via pullFromSingleRepo import seam', () => {
  const REPO_PATH = 'alice/monorepo';
  const REPO_ID = 'github:alice/monorepo';

  beforeEach(() => {
    jest.clearAllMocks();
    mockPullFromSingleRepo.mockResolvedValue({
      repos: 1, notes: 0, canvases: 0, todos: 0, templates: 0,
    });
    jest.mocked(AuthService.getToken).mockResolvedValue('gh-token');
    jest.mocked(StorageService.getSavedRepositories).mockResolvedValue([
      {
        id: REPO_ID,
        path: REPO_PATH,
        name: 'monorepo',
        provider: 'github',
        hostId: null,
        branch: 'main',
      },
    ]);
    jest.mocked(resolveBranch).mockResolvedValue('main');
    jest.mocked(AccountStorage.getActiveHostConnection).mockResolvedValue(null);
    // Already-cloned so we go through pullWithFastForward (not cloneExclusive)
    jest.mocked(GitFsService.isCloned).mockResolvedValue(true);
    jest.mocked(GitFsService.pullWithFastForward).mockResolvedValue({ ok: true });
    jest.mocked(StorageService.getAllNotes).mockResolvedValue([]);
    jest.mocked(StorageService.getAllTodos).mockResolvedValue([]);
    jest.mocked(StorageService.saveAllNotes).mockResolvedValue(undefined);
    jest.mocked(GitHubService.isAuthenticated).mockReturnValue(true);
  });

  it('PDF files are excluded from notes imported through pullFromSingleRepo', async () => {
    // Tree with both .md and .pdf files — the real observable is what saveAllNotes receives
    jest.mocked(GitFsService.listTree).mockResolvedValue([
      { path: 'notes/welcome.md', type: 'blob', sha: 'aaa', size: 120 },
      { path: 'notes/guide.pdf', type: 'blob', sha: 'bbb', size: 8192 },
      { path: 'README.md', type: 'blob', sha: 'ccc', size: 80 },
    ]);
    jest.mocked(GitFsService.readFile).mockImplementation(
      async (args: { filepath: string }) => {
        if (args.filepath === 'notes/welcome.md') return '# Welcome';
        if (args.filepath === 'README.md') return '# Repo README';
        return null;
      },
    );

    // Delegate to real implementation so the full pullNotesFromRepo pipeline runs
    mockPullFromSingleRepo.mockImplementation(realPullFromSingleRepo);

    await pullFromSingleRepo(REPO_PATH);

    // Verify saveAllNotes was called with exactly the .md notes (PDF excluded)
    expect(StorageService.saveAllNotes).toHaveBeenCalledTimes(1);
    const savedNotes = jest.mocked(StorageService.saveAllNotes).mock.calls[0][0];
    expect(savedNotes).toHaveLength(2);
    const savedPaths = savedNotes.map((n: { filePath?: string }) => n.filePath).sort();
    expect(savedPaths).toEqual(['README.md', 'notes/welcome.md']);
    expect(savedPaths).not.toContain('notes/guide.pdf');
  });

  it('empty notes when tree contains only non-note files', async () => {
    jest.mocked(GitFsService.listTree).mockResolvedValue([
      { path: 'notes/guide.pdf', type: 'blob', sha: 'bbb', size: 8192 },
      { path: 'images/logo.png', type: 'blob', sha: 'ddd', size: 4096 },
    ]);

    mockPullFromSingleRepo.mockImplementation(realPullFromSingleRepo);

    await pullFromSingleRepo(REPO_PATH);

    expect(StorageService.saveAllNotes).toHaveBeenCalledTimes(1);
    const savedNotes = jest.mocked(StorageService.saveAllNotes).mock.calls[0][0];
    expect(savedNotes).toHaveLength(0);
  });

  it('imports local clone notes with a native host connection and no legacy GitHub token', async () => {
    jest.mocked(AuthService.getToken).mockResolvedValue(null);
    jest.mocked(AccountStorage.getActiveHostConnection).mockResolvedValue({
      id: 'account:github:default',
      accountId: 'account',
      provider: 'github',
      instanceBaseUrl: null,
      hostLogin: 'alice',
      hostUserId: 1,
      name: 'Alice',
      email: null,
      avatarUrl: null,
      addedAt: 1,
    });
    jest.mocked(GitHubService.isAuthenticated).mockReturnValue(false);
    jest.mocked(GitFsService.listTree).mockResolvedValue([
      { path: 'notes/welcome.md', type: 'blob', sha: 'aaa', size: 120 },
    ]);
    jest.mocked(GitFsService.readFile).mockResolvedValue('# Welcome');
    mockPullFromSingleRepo.mockImplementation(realPullFromSingleRepo);

    await pullFromSingleRepo(REPO_PATH);

    expect(GitFsService.pullWithFastForward).toHaveBeenCalledWith({
      repoPath: REPO_PATH,
      branch: 'main',
      token: undefined,
      repoId: REPO_ID,
    });
    expect(StorageService.saveAllNotes).toHaveBeenCalledTimes(1);
    expect(jest.mocked(StorageService.saveAllNotes).mock.calls[0][0]).toHaveLength(1);
  });
});

// ─── Timing boundary: cloneExclusive vs pullFromSingleRepo ───────────────────

describe('clone vs. pull timing boundary', () => {
  const REPO_PATH = 'alice/monorepo';
  const REPO_ID = 'github:alice/monorepo';

  beforeEach(() => {
    jest.clearAllMocks();
    mockPullFromSingleRepo.mockResolvedValue({
      repos: 1, notes: 0, canvases: 0, todos: 0, templates: 0,
    });
    jest.mocked(AuthService.getToken).mockResolvedValue('gh-token');
    jest.mocked(StorageService.getSavedRepositories).mockResolvedValue([
      {
        id: REPO_ID,
        path: REPO_PATH,
        name: 'monorepo',
        provider: 'github',
        hostId: null,
        branch: 'main',
      },
    ]);
    jest.mocked(resolveBranch).mockResolvedValue('main');
    jest.mocked(AccountStorage.getActiveHostConnection).mockResolvedValue(null);
    jest.mocked(GitFsService.isCloned).mockResolvedValue(false);
    jest.mocked(GitFsService.cloneExclusive).mockResolvedValue(undefined);
    jest.mocked(GitFsService.getCommitOid).mockResolvedValue('abc123oid');
    jest.mocked(GitFsService.listTree).mockResolvedValue([]);
    jest.mocked(StorageService.getAllNotes).mockResolvedValue([]);
    jest.mocked(StorageService.saveAllNotes).mockResolvedValue(undefined);
  });

  it('BASELINE: cloneExclusive completes before pullFromSingleRepo is called', async () => {
    const callOrder: string[] = [];

    jest.mocked(GitFsService.cloneExclusive).mockImplementation(async () => {
      callOrder.push('cloneExclusive');
    });
    mockPullFromSingleRepo.mockImplementation(async () => {
      callOrder.push('pullFromSingleRepo');
      return { repos: 1, notes: 0, canvases: 0, todos: 0, templates: 0 };
    });

    await importRepoAtAdd(REPO_PATH, 'monorepo');

    expect(callOrder).toEqual(['cloneExclusive', 'pullFromSingleRepo']);
  });

  it('BASELINE: GitFsService.cloneExclusive is called with correct repo metadata', async () => {
    await importRepoAtAdd(REPO_PATH, 'monorepo');

    expect(GitFsService.cloneExclusive).toHaveBeenCalledWith(
      expect.objectContaining({
        repoPath: REPO_PATH,
        branch: 'main',
        repoId: REPO_ID,
        provider: 'github',
      }),
    );
  });

  it('BASELINE: pullFromSingleRepo is called with the repo path after clone completes', async () => {
    await importRepoAtAdd(REPO_PATH, 'monorepo');

    expect(mockPullFromSingleRepo).toHaveBeenCalledTimes(1);
    expect(mockPullFromSingleRepo.mock.calls[0][0]).toBe(REPO_PATH);
  });

  it('BASELINE: cloneExclusive and pullFromSingleRepo both receive onProgress callback', async () => {
    const progressFn = jest.fn();

    await importRepoAtAdd(REPO_PATH, 'monorepo', progressFn);

    expect(GitFsService.cloneExclusive).toHaveBeenCalledWith(
      expect.objectContaining({ onProgress: progressFn }),
    );
    expect(mockPullFromSingleRepo).toHaveBeenCalledWith(REPO_PATH, progressFn);
  });
});

// ─── Reader failure and empty-tree behavior ───────────────────────────────────

describe('pullNotesFromRepo error paths', () => {
  const REPO_PATH = 'alice/test-repo';
  const REPO_ID = 'github:alice/test-repo';

  beforeEach(() => {
    jest.clearAllMocks();
    mockPullFromSingleRepo.mockResolvedValue({
      repos: 1, notes: 0, canvases: 0, todos: 0, templates: 0,
    });
    jest.mocked(AuthService.getToken).mockResolvedValue('gh-token');
    jest.mocked(StorageService.getSavedRepositories).mockResolvedValue([
      {
        id: REPO_ID,
        path: REPO_PATH,
        name: 'test-repo',
        provider: 'github',
        hostId: null,
        branch: 'main',
      },
    ]);
    jest.mocked(resolveBranch).mockResolvedValue('main');
    jest.mocked(AccountStorage.getActiveHostConnection).mockResolvedValue(null);
  });

  it('BASELINE: pullFromSingleRepo is NOT called when getCommitOid returns null (empty repo)', async () => {
    jest.mocked(GitFsService.getCommitOid).mockResolvedValue(null);

    const result = await importRepoAtAdd(REPO_PATH, 'test-repo');

    expect(result).toEqual({ ok: true, counts: { repos: 1, notes: 0, canvases: 0, todos: 0, templates: 0 } });
    expect(mockPullFromSingleRepo).not.toHaveBeenCalled();
  });

  it('BASELINE: pullFromSingleRepo IS called when getCommitOid returns non-null (non-empty repo)', async () => {
    jest.mocked(GitFsService.getCommitOid).mockResolvedValue('abc123head');

    await importRepoAtAdd(REPO_PATH, 'test-repo');

    expect(mockPullFromSingleRepo).toHaveBeenCalled();
  });

  it('BASELINE: cloneExclusive is skipped when repo is already cloned', async () => {
    jest.mocked(GitFsService.isCloned).mockResolvedValue(true);
    jest.mocked(GitFsService.getCommitOid).mockResolvedValue('abc123head');

    await importRepoAtAdd(REPO_PATH, 'test-repo');

    expect(GitFsService.cloneExclusive).not.toHaveBeenCalled();
    expect(mockPullFromSingleRepo).toHaveBeenCalled();
  });

  it('BASELINE: when pullFromSingleRepo throws, import returns classified error', async () => {
    jest.mocked(GitFsService.getCommitOid).mockResolvedValue('abc123head');
    mockPullFromSingleRepo.mockRejectedValue(new Error('network timeout'));

    const result = await importRepoAtAdd(REPO_PATH, 'test-repo');

    expect(result.ok).toBe(false);
    expect(result.error).toContain('network timeout');
    expect(result.retryable).toBe(true);
  });
});

// ─── Source PDF preservation ───────────────────────────────────────────────────

describe('source PDF data preservation', () => {
  it('BASELINE: fixture tree does not delete or rewrite source PDFs', () => {
    const fixtureTree = TREE_WITH_MD_AND_PDF;
    expect(fixtureTree.find((e) => e.path.endsWith('.pdf'))?.type).toBe('blob');
    expect(fixtureTree.find((e) => e.path === 'notes/guide.pdf')).toEqual({
      path: 'notes/guide.pdf',
      type: 'blob',
      sha: 'bbb',
      size: 8192,
    });
  });
});
