import type { ChatThread } from '@/models/Chat';
import { demoBackend, setDemoDelay } from '@/services/chat/backends/demoBackend';
import { resolveBackend } from '@/services/chat/backends';
import { applyChatEvent } from '@/services/chat/reducer';
import type { ChatEvent, ChatRunInput, PermissionDecision, PermissionRequest } from '@/services/chat/types';

jest.mock('@/services/chat/copy', () => ({ chatT: (key: string) => key }));
jest.mock('@/services/chat/backends/agentBackend', () => ({ agentBackend: { type: 'agent' } }));
jest.mock('@/services/chat/backends/modelBackend', () => ({ modelBackend: { type: 'model' } }));

const makeThread = (overrides: Partial<ChatThread> = {}): ChatThread => ({
  id: 't1',
  title: 'T',
  messages: [],
  createdAt: 1,
  updatedAt: 1,
  repoOwner: '',
  repoName: '',
  branch: '',
  filePath: '',
  ...overrides,
});

function demoThread(userTurns = 1): ChatThread {
  const thread = makeThread({ backend: { type: 'demo' } });
  return {
    ...thread,
    messages: Array.from({ length: userTurns }, (_, index) => ({
      id: `u${index}`,
      role: 'user' as const,
      content: 'hi',
      timestamp: index,
    })),
  };
}

async function collect(
  thread: ChatThread,
  decide: (request: Omit<PermissionRequest, 'id'>) => Promise<PermissionDecision>,
  signal = new AbortController().signal,
): Promise<ChatEvent[]> {
  const input: ChatRunInput = { thread, userText: 'hi', contexts: [], signal, requestPermission: decide };
  const events: ChatEvent[] = [];
  for await (const event of demoBackend.run(input)) events.push(event);
  return events;
}

describe('demoBackend', () => {
  beforeEach(() => setDemoDelay(0));

  it('streams thought, plan, read, edit with diff, permission-gated execute and text, ending once', async () => {
    const requests: Array<Omit<PermissionRequest, 'id'>> = [];
    const events = await collect(demoThread(), async (request) => {
      requests.push(request);
      return { optionId: 'allow' };
    });

    const types = events.map((event) => event.type);
    expect(types[0]).toBe('thought-delta');
    expect(types).toContain('plan');
    expect(types.filter((type) => type === 'turn-end')).toHaveLength(1);
    expect(events[events.length - 1]).toEqual({ type: 'turn-end', stopReason: 'end_turn' });
    expect(events.some((event) => event.type === 'tool-update' && event.patch.diffs?.length)).toBe(true);
    expect(events.filter((event) => event.type === 'text-delta').length).toBeGreaterThan(1);
    expect(requests).toHaveLength(1);
    expect(requests[0]).toMatchObject({ title: 'Run npm test', description: 'npm test' });
    expect(requests[0].options.map((option) => option.kind)).toEqual(['allow_once', 'reject_once']);

    const messages = events.reduce((acc, event) => applyChatEvent(acc, event, { newId: () => Math.random().toString(), now: () => 1 }), []);
    expect(messages.find((message) => message.toolKind === 'execute')?.toolStatus).toBe('completed');
  });

  it('marks the command rejected when denied and still answers', async () => {
    const events = await collect(demoThread(), async () => ({ optionId: 'deny' }));

    expect(events.some((event) => event.type === 'tool-update' && event.patch.status === 'rejected')).toBe(true);
    expect(events.some((event) => event.type === 'tool-update' && event.patch.result)).toBe(true);
    expect(events[events.length - 1]).toEqual({ type: 'turn-end', stopReason: 'end_turn' });
  });

  it('ends with a cancelled turn-end when aborted', async () => {
    setDemoDelay(20);
    const controller = new AbortController();
    const pending = collect(demoThread(), async () => ({ optionId: 'allow' }), controller.signal);
    setTimeout(() => controller.abort(), 30);
    const events = await pending;

    expect(events.filter((event) => event.type === 'turn-end')).toEqual([{ type: 'turn-end', stopReason: 'cancelled' }]);
    expect(events[events.length - 1].type).toBe('turn-end');
  });

  it('cycles scenarios by user turn', async () => {
    const first = await collect(demoThread(1), async () => ({ optionId: 'allow' }));
    const second = await collect(demoThread(2), async () => ({ optionId: 'allow' }));
    const wrapped = await collect(demoThread(4), async () => ({ optionId: 'allow' }));

    const thought = (events: ChatEvent[]) => events.find((event) => event.type === 'thought-delta');
    expect(thought(first)).not.toEqual(thought(second));
    expect(thought(wrapped)).toEqual(thought(first));
  });
});

describe('resolveBackend', () => {
  it('routes by backend type', () => {
    expect(resolveBackend(demoThread()).type).toBe('demo');
    expect(resolveBackend(makeThread({ backend: { type: 'agent', bridgeId: 'b', agentId: 'a', agentName: 'A', cwd: '/x' } })).type).toBe('agent');
    expect(resolveBackend(makeThread()).type).toBe('model');
  });
});
