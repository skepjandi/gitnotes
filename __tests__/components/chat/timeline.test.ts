import type { ChatMessage } from '@/models/Chat';
import { TIMESTAMP_GAP_MS, buildTimeline, summarizeWork, workStatus } from '@/components/chat/timeline';
import type { ElicitationRequest, PermissionRequest, QueuedPrompt } from '@/services/chat/types';

const text = (id: string, role: ChatMessage['role'], timestamp: number): ChatMessage => ({
  id,
  role,
  content: id,
  timestamp,
  kind: 'text',
});

const tool = (id: string, overrides: Partial<ChatMessage> = {}): ChatMessage => ({
  id,
  role: 'assistant',
  content: '',
  timestamp: 10,
  kind: 'tool',
  toolCallId: `call-${id}`,
  toolKind: 'execute',
  toolStatus: 'completed',
  ...overrides,
});

const request = (id: string, toolCallId?: string): PermissionRequest => ({
  id,
  toolCallId,
  title: 'Run it',
  options: [{ id: 'allow', label: 'Allow', kind: 'allow_once' }],
});

describe('buildTimeline', () => {
  it('folds consecutive tool calls into one work row keyed by its first tool', () => {
    const items = buildTimeline([text('u', 'user', 1), tool('t1'), tool('t2'), text('a', 'assistant', 2), tool('t3')]);

    expect(items.map((item) => item.kind)).toEqual(['user', 'work', 'reply', 'work']);
    const first = items[1];
    expect(first.kind === 'work' && first.messages.map((m) => m.id)).toEqual(['t1', 't2']);
    expect(first.key).toBe('work:t1');
  });

  it('keeps the work row key stable while the group grows', () => {
    const before = buildTimeline([tool('t1')]);
    const after = buildTimeline([tool('t1'), tool('t2')]);
    expect(after[0].key).toBe(before[0].key);
  });

  it('inserts a timestamp divider only after a long pause and breaks the work group', () => {
    const items = buildTimeline([
      text('u1', 'user', 1_000),
      tool('t1', { timestamp: 2_000 }),
      tool('t2', { timestamp: 2_000 + TIMESTAMP_GAP_MS }),
      text('u2', 'user', 2_000 + TIMESTAMP_GAP_MS + 1),
    ]);

    expect(items.map((item) => item.kind)).toEqual(['user', 'work', 'time', 'work', 'user']);
  });

  it('places an approval right after the work that asked for it, else at the end', () => {
    const items = buildTimeline(
      [text('u', 'user', 1), tool('t1'), text('a', 'assistant', 2)],
      [request('r1', 'call-t1'), request('r2')],
    );

    expect(items.map((item) => item.kind)).toEqual(['user', 'work', 'needs', 'reply', 'needs']);
    expect(items[2].key).toBe('needs:r1');
    expect(items[4].key).toBe('needs:r2');
  });

  it('appends queued prompts after everything else', () => {
    const queued: QueuedPrompt = { id: 'q1', text: 'next', contexts: [], state: 'queued' };
    const items = buildTimeline([text('u', 'user', 1)], [request('r1')], [queued]);

    expect(items.map((item) => item.kind)).toEqual(['user', 'needs', 'queued']);
  });

  it('renders system messages as notices and legacy tool messages as work', () => {
    const legacy: ChatMessage = { id: 'l', role: 'assistant', content: '', timestamp: 1, toolCallName: 'get_note' };
    const items = buildTimeline([{ ...text('s', 'system', 1) }, legacy]);

    expect(items.map((item) => item.kind)).toEqual(['notice', 'work']);
  });
});

describe('summarizeWork', () => {
  it('counts by what the step did, in a fixed order', () => {
    const counts = summarizeWork([
      tool('a', { toolKind: 'read' }),
      tool('b', { toolKind: 'execute' }),
      tool('c', { toolKind: 'edit' }),
      tool('d', { toolKind: 'delete' }),
      tool('e', { toolKind: 'read' }),
    ]);

    expect(counts).toEqual([
      { counter: 'commands', count: 1 },
      { counter: 'edits', count: 2 },
      { counter: 'reads', count: 2 },
    ]);
  });
});

describe('workStatus', () => {
  it('prefers a pending approval over running, failed and completed', () => {
    expect(
      workStatus([tool('a', { toolStatus: 'failed' }), tool('b', { toolStatus: 'awaiting-approval' }), tool('c', { toolStatus: 'running' })], true),
    ).toBe('awaiting-approval');
  });

  it('is running while any step runs, failed when one failed or was rejected, else completed', () => {
    expect(workStatus([tool('a'), tool('b', { toolStatus: 'running' })], true)).toBe('running');
    expect(workStatus([tool('a'), tool('b', { toolStatus: 'rejected' })], false)).toBe('failed');
    expect(workStatus([tool('a'), tool('b')], false)).toBe('completed');
  });
});

describe('buildTimeline with elicitations', () => {
  const elicitation = (id: string, toolCallId?: string): ElicitationRequest => ({
    mode: 'form',
    id,
    toolCallId,
    message: 'Which one?',
    fields: [],
  });

  it('keeps the three argument call working', () => {
    const items = buildTimeline([text('u', 'user', 1), text('a', 'assistant', 2)]);
    expect(items.map((item) => item.kind)).toEqual(['user', 'reply']);
  });

  it('places an elicitation right after the work that owns its tool call', () => {
    const items = buildTimeline(
      [text('u', 'user', 1), tool('t1'), text('a', 'assistant', 2)],
      [],
      [],
      [elicitation('e1', 'call-t1')],
    );

    expect(items.map((item) => item.kind)).toEqual(['user', 'work', 'elicitation', 'reply']);
    expect(items[2]).toMatchObject({ kind: 'elicitation', key: 'elicitation:e1' });
  });

  it('appends an elicitation without a tool call at the end', () => {
    const items = buildTimeline([text('u', 'user', 1)], [], [], [elicitation('e1')]);
    expect(items.map((item) => item.kind)).toEqual(['user', 'elicitation']);
  });

  it('keeps approvals and elicitations in their own places', () => {
    const items = buildTimeline(
      [text('u', 'user', 1), tool('t1'), tool('t2')],
      [request('p1', 'call-t1')],
      [],
      [elicitation('e1', 'call-t2')],
    );

    expect(items.map((item) => item.kind)).toEqual(['user', 'work', 'needs', 'elicitation']);
  });
});
