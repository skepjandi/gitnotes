import type { AIContextItem } from '../../../src/models/AIProvider';
import {
  MAX_CONTEXT_ITEM_BYTES,
  MAX_CONTEXT_TOTAL_BYTES,
  TRUNCATED_MARKER,
  resolveContexts,
} from '../../../src/services/chat/contextContent';

const mockGetFileContent = jest.fn();
const mockGetFolderContents = jest.fn();
const mockGetLocalNotesForContext = jest.fn();

jest.mock('../../../src/services/ContextService', () => ({
  getFileContent: (...args: unknown[]) => mockGetFileContent(...args),
  getFolderContents: (...args: unknown[]) => mockGetFolderContents(...args),
  getRepoStructure: jest.fn(async () => []),
  getLocalNotesForContext: (...args: unknown[]) => mockGetLocalNotesForContext(...args),
  getLocalTodosForContext: jest.fn(() => 'todos'),
  isBinaryFile: jest.fn((name: string) => name.endsWith('.png')),
}));

const note = (path: string): AIContextItem => ({ type: 'local-notes', owner: '', repo: '', path, name: path });

describe('resolveContexts', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockGetFileContent.mockResolvedValue({ content: 'file body', name: 'a.md', size: 8, truncated: false });
    mockGetFolderContents.mockResolvedValue([]);
    mockGetLocalNotesForContext.mockReturnValue('note body');
  });

  it('reads the note content behind a local note', async () => {
    const { items, truncatedCount } = await resolveContexts([note('note-1')]);
    expect(mockGetLocalNotesForContext).toHaveBeenCalledWith('note-1');
    expect(items[0]).toMatchObject({
      uri: 'gitnotes://note/note-1',
      mimeType: 'text/markdown',
      text: 'note body',
      truncated: false,
    });
    expect(truncatedCount).toBe(0);
  });

  it('reads the file content behind a GitHub file', async () => {
    const { items } = await resolveContexts([
      { type: 'file', owner: 'o', repo: 'r', branch: 'main', path: 'notes/a.md', name: 'a.md' },
    ]);
    expect(items[0]).toMatchObject({
      uri: 'gitnotes://file/o/r/notes/a.md',
      text: 'file body',
    });
  });

  it('truncates one item at the item limit and says so', async () => {
    mockGetLocalNotesForContext.mockReturnValue('x'.repeat(MAX_CONTEXT_ITEM_BYTES + 100));
    const { items, truncatedCount } = await resolveContexts([note('big')]);
    expect(items[0]?.text.endsWith(TRUNCATED_MARKER)).toBe(true);
    expect(items[0]?.text.length).toBeLessThanOrEqual(MAX_CONTEXT_ITEM_BYTES + TRUNCATED_MARKER.length + 1);
    expect(items[0]?.truncated).toBe(true);
    expect(truncatedCount).toBe(1);
  });

  it('keeps the total within the budget and counts what was left out', async () => {
    mockGetLocalNotesForContext.mockReturnValue('x'.repeat(MAX_CONTEXT_ITEM_BYTES));
    const { items, truncatedCount } = await resolveContexts([note('a'), note('b'), note('c'), note('d'), note('e')]);
    const total = items.reduce((sum, item) => sum + item.text.length, 0);
    expect(total).toBeLessThanOrEqual(MAX_CONTEXT_TOTAL_BYTES + MAX_CONTEXT_ITEM_BYTES);
    expect(truncatedCount).toBeGreaterThan(0);
    expect(items.length).toBeLessThan(5);
  });

  it('expands a folder to a listing and the first files', async () => {
    mockGetFolderContents.mockResolvedValue([
      { name: 'a.md', path: 'notes/a.md', type: 'file', size: 4 },
      { name: 'logo.png', path: 'notes/logo.png', type: 'file', size: 4 },
    ]);
    const { items } = await resolveContexts([
      { type: 'folder', owner: 'o', repo: 'r', branch: 'main', path: 'notes', name: 'notes' },
    ]);
    expect(items[0]?.text).toContain('[file] notes/a.md');
    expect(items[0]?.text).toContain('file body');
    expect(items[0]?.text).not.toContain('logo.png ---');
  });

  it('keeps a failed item as readable text', async () => {
    mockGetFileContent.mockRejectedValue(new Error('boom'));
    const { items } = await resolveContexts([
      { type: 'file', owner: 'o', repo: 'r', branch: 'main', path: 'x.md', name: 'x.md' },
    ]);
    expect(items[0]?.text).toContain('Failed to load');
  });
});
