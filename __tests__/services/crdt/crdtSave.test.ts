import { CloneSyncService } from '@/services/cloneSyncServiceImpl';
import { mergeNoteSides } from '@/services/crdt/noteCrdt';
import { notePathForSidecar, sidecarPathForNote } from '@/services/crdt/crdtSidecar';

const mockFiles = new Map<string, string>();

jest.mock('expo-file-system/legacy', () => ({
  documentDirectory: 'file:///documents/',
  makeDirectoryAsync: jest.fn(async () => undefined),
  getInfoAsync: jest.fn(async (uri: string) => ({ exists: mockFiles.has(uri) })),
  readAsStringAsync: jest.fn(async (uri: string) => mockFiles.get(uri) ?? ''),
  writeAsStringAsync: jest.fn(async (uri: string, content: string) => {
    mockFiles.set(uri, content);
  }),
  deleteAsync: jest.fn(async (uri: string) => {
    mockFiles.delete(uri);
  }),
}));

const REPO_DIR = 'file:///documents/GitNotes/owner/repo';
const NOTE = 'notes/example.md';

const save = (content: string, crdtEnabled?: boolean) =>
  CloneSyncService.save({
    repoPath: 'owner/repo',
    branch: 'main',
    filePath: NOTE,
    content,
    message: 'Update',
    intent: 'upsert',
    crdtEnabled,
  });

describe('CloneSyncService.save with CRDT merge', () => {
  beforeEach(() => mockFiles.clear());

  it('writes no sidecar when CRDT merge is off for the repo', async () => {
    await save('# Plain\n');

    expect(mockFiles.get(`${REPO_DIR}/${NOTE}`)).toBe('# Plain\n');
    expect(mockFiles.has(`${REPO_DIR}/${sidecarPathForNote(NOTE)}`)).toBe(false);
  });

  it('writes the note and a sidecar that reproduces the note body', async () => {
    await save('---\ntitle: A\n---\nhello\n', true);

    const sidecar = mockFiles.get(`${REPO_DIR}/${sidecarPathForNote(NOTE)}`) ?? null;
    expect(sidecar).not.toBeNull();
    const reloaded = mergeNoteSides({
      base: '',
      ours: { text: null, sidecar },
      theirs: { text: null, sidecar },
    });
    expect(reloaded.text).toBe('hello\n');
  });

  it('seeds an existing note from its on-disk text so two devices share one history', async () => {
    mockFiles.set(`${REPO_DIR}/${NOTE}`, 'shared\n');
    await save('shared\nfrom A\n', true);
    const sidecarA = mockFiles.get(`${REPO_DIR}/${sidecarPathForNote(NOTE)}`) ?? null;

    mockFiles.clear();
    mockFiles.set(`${REPO_DIR}/${NOTE}`, 'shared\n');
    await save('shared\nfrom B\n', true);
    const sidecarB = mockFiles.get(`${REPO_DIR}/${sidecarPathForNote(NOTE)}`) ?? null;

    const merged = mergeNoteSides({
      base: 'shared\n',
      ours: { text: 'shared\nfrom A\n', sidecar: sidecarA },
      theirs: { text: 'shared\nfrom B\n', sidecar: sidecarB },
    });
    expect(merged.text.match(/shared/g)).toHaveLength(1);
    expect(merged.text).toContain('from A');
    expect(merged.text).toContain('from B');
  });

  it('removes the sidecar when the note is deleted', async () => {
    await save('body\n', true);

    const result = await CloneSyncService.save({
      repoPath: 'owner/repo',
      branch: 'main',
      filePath: NOTE,
      message: 'Delete',
      intent: 'delete',
      crdtEnabled: true,
    });

    expect(result).toEqual({ success: true });
    expect(mockFiles.size).toBe(0);
  });

  it('never creates sidecars for non-Markdown mockFiles', async () => {
    await CloneSyncService.save({
      repoPath: 'owner/repo',
      branch: 'main',
      filePath: 'canvases/board.json',
      content: '{}',
      message: 'Update',
      intent: 'upsert',
      crdtEnabled: true,
    });

    expect([...mockFiles.keys()]).toEqual([`${REPO_DIR}/canvases/board.json`]);
  });
});

describe('sidecar paths', () => {
  it('round-trips note paths and rejects everything else', () => {
    expect(notePathForSidecar(sidecarPathForNote(NOTE))).toBe(NOTE);
    expect(notePathForSidecar(NOTE)).toBeNull();
    expect(notePathForSidecar('.gitnotes/crdt/board.json.crdt')).toBeNull();
  });
});
