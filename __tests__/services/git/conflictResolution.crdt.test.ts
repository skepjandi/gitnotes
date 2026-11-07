import * as GitEngine from '@/services/git/engine/GitEngine';
import { CommitService } from '@/services/git/CommitService';
import { syncNow } from '@/services/git/manualSync';
import {
  computeCrdtMerge,
  computeSidecarOnlyMerge,
  resolveConflictAndSync,
  resolveSidecarConflictAndSync,
} from '@/services/git/conflictResolution';
import { sidecarForSave, sidecarMatchesText } from '@/services/crdt/noteCrdt';
import { sidecarPathForNote } from '@/services/crdt/crdtSidecar';

const mockFiles = new Map<string, string>();

jest.mock('expo-file-system/legacy', () => ({
  getInfoAsync: jest.fn(async (uri: string) => ({ exists: mockFiles.has(uri) })),
  readAsStringAsync: jest.fn(async (uri: string) => mockFiles.get(uri) ?? ''),
  makeDirectoryAsync: jest.fn(async () => undefined),
  writeAsStringAsync: jest.fn(async (uri: string, content: string) => {
    mockFiles.set(uri, content);
  }),
}));

jest.mock('@/services/git/engine/GitEngine', () => ({
  conflicts: jest.fn(),
  getConflictBlobs: jest.fn(),
  markConflictResolved: jest.fn(),
  commit: jest.fn(),
  push: jest.fn(),
}));

jest.mock('@/services/git/CommitService', () => ({
  CommitService: { resolveAuthor: jest.fn() },
}));

jest.mock('@/services/git/GitFsService', () => ({
  GitFsService: { workingTreeUri: jest.fn(() => 'file:///repo') },
}));

jest.mock('@/services/git/manualSync', () => ({
  syncNow: jest.fn(),
}));

const NOTE = 'notes/n.md';
const SIDECAR = sidecarPathForNote(NOTE);
const BASE = 'one\ntwo\nthree\n';
const OURS = 'ONE\ntwo\nthree\n';
const THEIRS = 'one\ntwo\nTHREE\n';

const repo = (crdtMergeEnabled?: boolean) => ({
  id: 'repo-1',
  path: 'owner/repo',
  name: 'repo',
  branch: 'main',
  ...(crdtMergeEnabled === undefined ? {} : { crdtMergeEnabled }),
});

const oursSidecar = sidecarForSave({ sidecar: null, previousText: BASE, content: OURS });
const theirsSidecar = sidecarForSave({ sidecar: null, previousText: BASE, content: THEIRS });

function stubConflicts(conflictedPaths: string[]) {
  (GitEngine.conflicts as jest.Mock).mockResolvedValue(
    conflictedPaths.map((path) => ({ path, kind: 'both modified' })),
  );
  (GitEngine.getConflictBlobs as jest.Mock).mockImplementation(async (_repo: string, path: string) =>
    path === NOTE
      ? { base: BASE, ours: OURS, theirs: THEIRS }
      : { base: '', ours: oursSidecar, theirs: theirsSidecar },
  );
}

describe('CRDT conflict resolution', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockFiles.clear();
    (CommitService.resolveAuthor as jest.Mock).mockResolvedValue({ name: 'T', email: 't@example.com' });
    (GitEngine.push as jest.Mock).mockResolvedValue({ ok: true });
    (syncNow as jest.Mock).mockResolvedValue({ ok: true });
  });

  it('auto-merges both sides of a conflicted note', async () => {
    stubConflicts([NOTE, SIDECAR]);

    await expect(computeCrdtMerge(repo(true), NOTE)).resolves.toBe('ONE\ntwo\nTHREE\n');
  });

  it('still merges when the sidecar did not conflict and only a working-tree copy exists', async () => {
    stubConflicts([NOTE]);
    mockFiles.set(`file:///repo/${SIDECAR}`, oursSidecar);

    await expect(computeCrdtMerge(repo(true), NOTE)).resolves.toBe('ONE\ntwo\nTHREE\n');
  });

  it('resolves the note and its conflicted sidecar together, then pushes', async () => {
    stubConflicts([NOTE, SIDECAR]);

    await resolveConflictAndSync(repo(true), NOTE, 'ONE\ntwo\nTHREE\n');

    expect(mockFiles.get(`file:///repo/${NOTE}`)).toBe('ONE\ntwo\nTHREE\n');
    expect(mockFiles.get(`file:///repo/${SIDECAR}`)).toEqual(expect.any(String));
    expect(GitEngine.markConflictResolved).toHaveBeenCalledWith('file:///repo', NOTE);
    expect(GitEngine.markConflictResolved).toHaveBeenCalledWith('file:///repo', SIDECAR);
    expect(GitEngine.push).toHaveBeenCalledWith('file:///repo', 'origin', 'repo-1');
  });

  it('commits with the author resolved for the repository', async () => {
    stubConflicts([NOTE, SIDECAR]);

    await resolveConflictAndSync(repo(true), NOTE, 'ONE\ntwo\nTHREE\n');

    expect(CommitService.resolveAuthor).toHaveBeenCalledWith('repo-1');
  });

  it('never commits with an empty author name or email', async () => {
    (CommitService.resolveAuthor as jest.Mock).mockResolvedValue({ name: 'gitnotes', email: '' });
    stubConflicts([NOTE, SIDECAR]);

    await resolveConflictAndSync(repo(true), NOTE, 'ONE\ntwo\nTHREE\n');

    expect(GitEngine.commit).toHaveBeenCalledWith(
      'file:///repo',
      expect.any(String),
      { name: 'gitnotes', email: 'gitnotes@local' },
    );
  });

  describe('retrying after a failed commit/push', () => {
    // Staging a resolved path drops its conflict stages, like the real index.
    function stubStatefulConflicts() {
      const conflicted = new Set([NOTE, SIDECAR]);
      (GitEngine.conflicts as jest.Mock).mockImplementation(async () =>
        [...conflicted].map((path) => ({ path, kind: 'both modified' })),
      );
      (GitEngine.getConflictBlobs as jest.Mock).mockImplementation(async (_repo: string, path: string) => {
        if (!conflicted.has(path)) throw new Error(`no unresolved conflict for path: ${path}`);
        return path === NOTE
          ? { base: BASE, ours: OURS, theirs: THEIRS }
          : { base: '', ours: oursSidecar, theirs: theirsSidecar };
      });
      (GitEngine.markConflictResolved as jest.Mock).mockImplementation(async (_repo: string, path: string) => {
        conflicted.delete(path);
      });
      (GitEngine.push as jest.Mock).mockResolvedValueOnce({ ok: false, error: 'rejected' });
    }

    it('re-resolves with the same text without needing the conflict stages again', async () => {
      stubStatefulConflicts();
      const merged = 'ONE\ntwo\nTHREE\n';

      await expect(resolveConflictAndSync(repo(true), NOTE, merged)).rejects.toThrow('rejected');
      const firstSidecar = mockFiles.get(`file:///repo/${SIDECAR}`);
      await resolveConflictAndSync(repo(true), NOTE, merged);

      expect(GitEngine.push).toHaveBeenCalledTimes(2);
      expect(mockFiles.get(`file:///repo/${NOTE}`)).toBe(merged);
      expect(mockFiles.get(`file:///repo/${SIDECAR}`)).toBe(firstSidecar);
    });

    it('records text edited between attempts in the sidecar', async () => {
      stubStatefulConflicts();
      const edited = 'ONE\ntwo\nTHREE\nfour\n';

      await expect(resolveConflictAndSync(repo(true), NOTE, 'ONE\ntwo\nTHREE\n')).rejects.toThrow('rejected');
      await resolveConflictAndSync(repo(true), NOTE, edited);

      expect(mockFiles.get(`file:///repo/${NOTE}`)).toBe(edited);
      expect(sidecarMatchesText(mockFiles.get(`file:///repo/${SIDECAR}`) ?? null, edited)).toBe(true);
    });
  });

  it('leaves sidecars alone when CRDT merge is off for the repo', async () => {
    await resolveConflictAndSync(repo(), NOTE, 'resolved');

    expect(GitEngine.getConflictBlobs).not.toHaveBeenCalled();
    expect(GitEngine.markConflictResolved).toHaveBeenCalledTimes(1);
    expect(mockFiles.has(`file:///repo/${SIDECAR}`)).toBe(false);
  });

  it('merges a sidecar-only conflict using the note on disk as the seed', async () => {
    mockFiles.set(`file:///repo/${NOTE}`, '---\nid: n\n---\nbody\n');
    stubConflicts([SIDECAR]);
    const ours = sidecarForSave({ sidecar: null, previousText: '---\nid: n\n---\nbody\n', content: '---\nid: n\n---\nbody A\n' });
    const theirs = sidecarForSave({ sidecar: null, previousText: '---\nid: n\n---\nbody\n', content: '---\nid: n\n---\nB body\n' });
    (GitEngine.getConflictBlobs as jest.Mock).mockResolvedValue({ base: '', ours, theirs });

    const merged = await computeSidecarOnlyMerge(repo(true), NOTE);
    expect(merged).toBe('---\nid: n\n---\nB body A\n');

    await resolveSidecarConflictAndSync(repo(true), NOTE, merged);
    expect(mockFiles.get(`file:///repo/${NOTE}`)).toBe(merged);
    expect(GitEngine.markConflictResolved).toHaveBeenCalledWith('file:///repo', SIDECAR);
  });
});
