import {
  MAX_DIFF_LINES,
  MAX_TOOL_TEXT_CHARS,
  buildDiffView,
  formatToolCallLabel,
  parseNoteToolResult,
  resolveMessageKind,
  resolveToolStatus,
  truncateText,
} from '@/components/chat/toolPresentation';
import type { ChatMessage } from '@/models/Chat';

const base: ChatMessage = { id: 'm1', role: 'assistant', content: '', timestamp: 1 };

describe('buildDiffView', () => {
  it('treats a missing old text as a brand new file', () => {
    const view = buildDiffView({ path: 'a.ts', oldText: null, newText: 'one\ntwo\n' });
    expect(view.lines).toEqual([
      { type: 'add', text: 'one' },
      { type: 'add', text: 'two' },
    ]);
    expect(view.added).toBe(2);
    expect(view.removed).toBe(0);
  });

  it('marks only the changed line and keeps up to three context lines around it', () => {
    const oldText = ['a', 'b', 'c', 'd', 'e', 'f', 'g', 'h'].join('\n');
    const newText = ['a', 'b', 'c', 'd', 'E', 'f', 'g', 'h'].join('\n');
    const view = buildDiffView({ path: 'x', oldText, newText });

    expect(view.lines.map((line) => `${line.type}:${line.text}`)).toEqual([
      'ctx:b', 'ctx:c', 'ctx:d', 'del:e', 'add:E', 'ctx:f', 'ctx:g', 'ctx:h',
    ]);
    expect(view.added).toBe(1);
    expect(view.removed).toBe(1);
  });

  it('keeps unchanged lines inside a changed region as context instead of delete + add', () => {
    const view = buildDiffView({ path: 'x', oldText: 'a\nkeep\nz', newText: 'b\nkeep\ny' });
    expect(view.lines.map((line) => `${line.type}:${line.text}`)).toEqual([
      'del:a', 'add:b', 'ctx:keep', 'del:z', 'add:y',
    ]);
  });

  it('reports no changes for identical text', () => {
    const view = buildDiffView({ path: 'x', oldText: 'same', newText: 'same' });
    expect(view.added + view.removed).toBe(0);
  });

  it('caps long diffs and reports how many lines were hidden', () => {
    const newText = Array.from({ length: MAX_DIFF_LINES + 30 }, (_, i) => `line ${i}`).join('\n');
    const view = buildDiffView({ path: 'big.txt', oldText: '', newText });
    expect(view.lines).toHaveLength(MAX_DIFF_LINES);
    expect(view.hiddenLines).toBe(30);
    expect(view.added).toBe(MAX_DIFF_LINES + 30);
  });

  it('falls back to replacing the whole block when the changed region is too large to diff', () => {
    const oldText = Array.from({ length: 700 }, (_, i) => `old ${i}`).join('\n');
    const newText = Array.from({ length: 700 }, (_, i) => `new ${i}`).join('\n');
    const view = buildDiffView({ path: 'huge', oldText, newText }, 2000);
    expect(view.removed).toBe(700);
    expect(view.added).toBe(700);
    expect(view.lines[0]?.type).toBe('del');
  });
});

describe('truncateText', () => {
  it('leaves short text untouched', () => {
    expect(truncateText('hello')).toEqual({ text: 'hello', hiddenChars: 0 });
  });

  it('cuts at the limit and reports the hidden character count', () => {
    const result = truncateText('x'.repeat(MAX_TOOL_TEXT_CHARS + 25));
    expect(result.text).toHaveLength(MAX_TOOL_TEXT_CHARS);
    expect(result.hiddenChars).toBe(25);
  });
});

describe('resolveMessageKind / resolveToolStatus', () => {
  it('treats legacy messages with a tool name as tool and everything else as text', () => {
    expect(resolveMessageKind({ ...base, toolCallName: 'create_note' })).toBe('tool');
    expect(resolveMessageKind(base)).toBe('text');
    expect(resolveMessageKind({ ...base, kind: 'thought' })).toBe('thought');
  });

  it('prefers the explicit status and otherwise derives it from the legacy result', () => {
    expect(resolveToolStatus({ ...base, toolStatus: 'failed', toolCallResult: 'x' }, true)).toBe('failed');
    expect(resolveToolStatus({ ...base, toolCallResult: 'ok' }, true)).toBe('completed');
    expect(resolveToolStatus(base, true)).toBe('running');
    expect(resolveToolStatus(base, false)).toBe('pending');
  });
});

describe('parseNoteToolResult', () => {
  it('extracts the note id and title', () => {
    expect(parseNoteToolResult('{"noteId":"n1","title":"Plans"}')).toEqual({ noteId: 'n1', title: 'Plans' });
  });

  it('ignores JSON without a note id and malformed text', () => {
    expect(parseNoteToolResult('{"title":"x"}')).toBeNull();
    expect(parseNoteToolResult('not json')).toBeNull();
    expect(parseNoteToolResult(undefined)).toBeNull();
  });
});

describe('formatToolCallLabel', () => {
  it('humanises snake case names and falls back for empty ones', () => {
    expect(formatToolCallLabel('create_note')).toBe('Create Note');
    expect(formatToolCallLabel('  ')).toBe('Tool call');
    expect(formatToolCallLabel(undefined)).toBe('Tool call');
  });
});
