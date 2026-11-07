import type { ChatMessage } from '@/models/Chat';
import { applyChatEvent, settleInterruptedTools } from '@/services/chat/reducer';
import type { ChatEvent } from '@/services/chat/types';

function makeDeps() {
  let n = 0;
  return { now: () => 1000 + n, newId: () => `id-${(n += 1)}` };
}

function fold(events: ChatEvent[], initial: ChatMessage[] = []): ChatMessage[] {
  const deps = makeDeps();
  return events.reduce((messages, event) => applyChatEvent(messages, event, deps), initial);
}

const user = (id: string, content = 'hi'): ChatMessage => ({ id, role: 'user', content, timestamp: 1 });

describe('applyChatEvent', () => {
  describe('text and thought deltas', () => {
    it('opens an assistant text message and appends to it', () => {
      const messages = fold([
        { type: 'text-delta', text: 'Hel' },
        { type: 'text-delta', text: 'lo' },
      ]);
      expect(messages).toHaveLength(1);
      expect(messages[0]).toMatchObject({ role: 'assistant', kind: 'text', content: 'Hello' });
    });

    it('keeps text and thought in separate messages and reopens after interleaving', () => {
      const messages = fold([
        { type: 'thought-delta', text: 'hmm ' },
        { type: 'thought-delta', text: 'ok' },
        { type: 'text-delta', text: 'A' },
        { type: 'thought-delta', text: 'again' },
        { type: 'text-delta', text: 'B' },
      ]);
      expect(messages.map((m) => [m.kind, m.content])).toEqual([
        ['thought', 'hmm ok'],
        ['text', 'A'],
        ['thought', 'again'],
        ['text', 'B'],
      ]);
    });

    it('a tool event closes the open text message', () => {
      const messages = fold([
        { type: 'text-delta', text: 'before' },
        { type: 'tool-start', toolCallId: 't1', patch: { name: 'read_file' } },
        { type: 'text-delta', text: 'after' },
      ]);
      expect(messages.map((m) => m.kind)).toEqual(['text', 'tool', 'text']);
      expect(messages[0].content).toBe('before');
      expect(messages[2].content).toBe('after');
    });

    it('does not start a new turn on top of a user message', () => {
      const messages = fold([{ type: 'text-delta', text: 'reply' }], [user('u1')]);
      expect(messages.map((m) => m.role)).toEqual(['user', 'assistant']);
    });

    it('ignores empty deltas and returns the same array', () => {
      const initial = [user('u1')];
      expect(applyChatEvent(initial, { type: 'text-delta', text: '' }, makeDeps())).toBe(initial);
    });

    it('does not touch untouched messages when a delta arrives', () => {
      const first = user('u1');
      const before = fold([{ type: 'text-delta', text: 'a' }], [first]);
      const after = applyChatEvent(before, { type: 'text-delta', text: 'b' }, makeDeps());
      expect(after[0]).toBe(first);
      expect(before[1].content).toBe('a');
      expect(after[1].content).toBe('ab');
    });
  });

  describe('tool calls', () => {
    it('creates a tool message with legacy fields filled for old renderers and history conversion', () => {
      const [tool] = fold([
        {
          type: 'tool-start',
          toolCallId: 't1',
          patch: { name: 'search_notes', args: { query: 'x' }, status: 'running', kind: 'search' },
        },
        { type: 'tool-update', toolCallId: 't1', patch: { status: 'completed', result: '[]' } },
      ]);
      expect(tool).toMatchObject({
        kind: 'tool',
        role: 'assistant',
        toolCallId: 't1',
        toolCallName: 'search_notes',
        toolCallArgs: { query: 'x' },
        toolCallResult: '[]',
        toolStatus: 'completed',
        toolKind: 'search',
      });
    });

    it('merges patches without clobbering fields the patch does not mention', () => {
      const [tool] = fold([
        {
          type: 'tool-start',
          toolCallId: 't1',
          patch: { name: 'edit', title: 'Edit a.ts', args: { path: 'a.ts' }, locations: [{ path: 'a.ts', line: 3 }] },
        },
        { type: 'tool-update', toolCallId: 't1', patch: { diffs: [{ path: 'a.ts', oldText: 'x', newText: 'y' }] } },
        { type: 'tool-update', toolCallId: 't1', patch: { result: 'done' } },
      ]);
      expect(tool.toolTitle).toBe('Edit a.ts');
      expect(tool.toolCallArgs).toEqual({ path: 'a.ts' });
      expect(tool.toolLocations).toEqual([{ path: 'a.ts', line: 3 }]);
      expect(tool.toolDiffs).toHaveLength(1);
      expect(tool.toolCallResult).toBe('done');
    });

    it('treats a second tool-start with the same id as an update', () => {
      const messages = fold([
        { type: 'tool-start', toolCallId: 't1', patch: { name: 'run' } },
        { type: 'tool-start', toolCallId: 't1', patch: { name: 'run', args: { cmd: 'ls' } } },
      ]);
      expect(messages).toHaveLength(1);
      expect(messages[0].toolCallArgs).toEqual({ cmd: 'ls' });
    });

    it('creates the message when an update arrives for an unseen id', () => {
      const messages = fold([{ type: 'tool-update', toolCallId: 'late', patch: { title: 'Run tests', status: 'running' } }]);
      expect(messages).toHaveLength(1);
      expect(messages[0]).toMatchObject({ toolCallId: 'late', toolTitle: 'Run tests', toolStatus: 'running', kind: 'tool' });
      expect(messages[0].toolCallName).toBeTruthy();
    });

    it('updates the owning message even when other messages arrived after it', () => {
      const messages = fold([
        { type: 'tool-start', toolCallId: 'a', patch: { name: 'one' } },
        { type: 'tool-start', toolCallId: 'b', patch: { name: 'two' } },
        { type: 'text-delta', text: 'between' },
        { type: 'tool-update', toolCallId: 'a', patch: { status: 'completed', result: 'A' } },
      ]);
      expect(messages.map((m) => m.toolCallId ?? 'text')).toEqual(['a', 'b', 'text']);
      expect(messages[0]).toMatchObject({ toolStatus: 'completed', toolCallResult: 'A' });
      expect(messages[1].toolStatus).toBe('pending');
    });

    it.each(['completed', 'failed', 'rejected'] as const)('never regresses from %s', (terminal) => {
      const messages = fold([
        { type: 'tool-start', toolCallId: 't1', patch: { name: 'x', status: terminal } },
        { type: 'tool-update', toolCallId: 't1', patch: { status: 'running' } },
        { type: 'tool-update', toolCallId: 't1', patch: { status: 'awaiting-approval' } },
        { type: 'tool-update', toolCallId: 't1', patch: { status: 'pending' } },
      ]);
      expect(messages[0].toolStatus).toBe(terminal);
    });

    it('still accepts late result content after a terminal status', () => {
      const [tool] = fold([
        { type: 'tool-start', toolCallId: 't1', patch: { name: 'x', status: 'completed' } },
        { type: 'tool-update', toolCallId: 't1', patch: { result: 'late output', status: 'running' } },
      ]);
      expect(tool.toolStatus).toBe('completed');
      expect(tool.toolCallResult).toBe('late output');
    });

    it('allows pending -> awaiting-approval -> running -> completed', () => {
      const statuses = (['awaiting-approval', 'running', 'completed'] as const).map((status) => status);
      let messages = fold([{ type: 'tool-start', toolCallId: 't1', patch: { name: 'x' } }]);
      const seen: Array<string | undefined> = [messages[0].toolStatus];
      for (const status of statuses) {
        messages = applyChatEvent(messages, { type: 'tool-update', toolCallId: 't1', patch: { status } }, makeDeps());
        seen.push(messages[0].toolStatus);
      }
      expect(seen).toEqual(['pending', 'awaiting-approval', 'running', 'completed']);
    });

    it('does not reach into a previous turn for a tool id', () => {
      const messages = fold(
        [{ type: 'tool-update', toolCallId: 't1', patch: { status: 'running', title: 'new turn' } }],
        [
          {
            id: 'old',
            role: 'assistant',
            kind: 'tool',
            content: '',
            timestamp: 1,
            toolCallId: 't1',
            toolCallName: 'x',
            toolStatus: 'completed',
          },
          user('u2'),
        ],
      );
      expect(messages).toHaveLength(3);
      expect(messages[0].toolStatus).toBe('completed');
      expect(messages[2]).toMatchObject({ toolCallId: 't1', toolStatus: 'running' });
    });
  });

  describe('plan', () => {
    it('replaces the turn\'s plan message instead of adding another', () => {
      const messages = fold([
        { type: 'plan', entries: [{ content: 'a', status: 'pending' }] },
        { type: 'text-delta', text: 'working' },
        {
          type: 'plan',
          entries: [
            { content: 'a', status: 'completed' },
            { content: 'b', status: 'in_progress' },
          ],
        },
      ]);
      expect(messages.filter((m) => m.kind === 'plan')).toHaveLength(1);
      expect(messages[0].plan).toHaveLength(2);
      expect(messages[0].plan?.[0].status).toBe('completed');
      expect(messages).toHaveLength(2);
    });

    it('starts a new plan message in the next turn', () => {
      const messages = fold(
        [{ type: 'plan', entries: [{ content: 'fresh', status: 'pending' }] }],
        [{ id: 'p', role: 'assistant', kind: 'plan', content: '', timestamp: 1, plan: [] }, user('u2')],
      );
      expect(messages.filter((m) => m.kind === 'plan')).toHaveLength(2);
    });
  });

  describe('turn-end', () => {
    it('drops whitespace-only assistant text from the finished turn only', () => {
      const messages = fold(
        [
          { type: 'text-delta', text: '  \n' },
          { type: 'tool-start', toolCallId: 't1', patch: { name: 'x' } },
          { type: 'text-delta', text: 'real answer' },
          { type: 'thought-delta', text: ' ' },
          { type: 'turn-end', stopReason: 'end_turn' },
        ],
        [{ id: 'prev', role: 'assistant', content: ' ', timestamp: 1 }, user('u1')],
      );
      expect(messages.map((m) => m.id === 'prev' || m.kind)).toEqual([true, undefined, 'tool', 'text']);
      expect(messages[3].content).toBe('real answer');
    });

    it('returns the same array when nothing needs dropping', () => {
      const initial = fold([{ type: 'text-delta', text: 'ok' }]);
      expect(applyChatEvent(initial, { type: 'turn-end', stopReason: 'end_turn' }, makeDeps())).toBe(initial);
    });

    it('keeps tool messages even though their content is empty', () => {
      const messages = fold([
        { type: 'tool-start', toolCallId: 't1', patch: { name: 'x' } },
        { type: 'turn-end', stopReason: 'end_turn' },
      ]);
      expect(messages).toHaveLength(1);
    });
  });

  it('agent-state does not change messages', () => {
    const initial = [user('u1')];
    expect(applyChatEvent(initial, { type: 'agent-state', sessionId: 's' }, makeDeps())).toBe(initial);
  });

  it('does not mutate its input', () => {
    const input = Object.freeze([Object.freeze(user('u1'))]) as ChatMessage[];
    const out = fold(
      [
        { type: 'text-delta', text: 'a' },
        { type: 'tool-start', toolCallId: 't', patch: { name: 'n' } },
        { type: 'turn-end', stopReason: 'x' },
      ],
      input,
    );
    expect(input).toHaveLength(1);
    expect(out).toHaveLength(3);
  });

  it('folds a very long stream in linear time', () => {
    const deps = makeDeps();
    const run = (count: number) => {
      const started = process.hrtime.bigint();
      let messages: ChatMessage[] = [user('u1')];
      for (let i = 0; i < count; i += 1) {
        messages = applyChatEvent(messages, { type: 'text-delta', text: 'token ' }, deps);
      }
      expect(messages[1].content.length).toBe(count * 6);
      return Number(process.hrtime.bigint() - started);
    };
    run(2000);
    const small = run(20_000);
    const large = run(200_000);
    expect(large / small).toBeLessThan(40);
  });
});

describe('settleInterruptedTools', () => {
  it('fails running tools and rejects awaiting ones, only in the current turn', () => {
    const tool = (id: string, toolStatus: ChatMessage['toolStatus']): ChatMessage => ({
      id,
      role: 'assistant',
      kind: 'tool',
      content: '',
      timestamp: 1,
      toolCallId: id,
      toolCallName: 'x',
      toolStatus,
    });
    const messages = [tool('old', 'running'), user('u2'), tool('a', 'running'), tool('b', 'awaiting-approval'), tool('c', 'completed'), tool('d', 'pending')];
    const settled = settleInterruptedTools(messages);
    expect(settled.map((m) => m.toolStatus)).toEqual(['running', undefined, 'failed', 'rejected', 'completed', 'failed']);
  });

  it('returns the same array when every tool is settled', () => {
    const messages = fold([{ type: 'tool-start', toolCallId: 't', patch: { name: 'x', status: 'completed' } }]);
    expect(settleInterruptedTools(messages)).toBe(messages);
  });
});
