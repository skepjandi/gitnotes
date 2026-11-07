import type { ChatThread } from '@/models/Chat';
import type { ChatBackend, ChatEvent, ChatRunInput, PermissionDecision } from '@/services/chat/types';
import {
  MemoryStorage,
  ScriptedBackend,
  makeAgentThread,
  makeSession,
  makeThread,
  textOf,
} from './helpers';

const tick = (ms = 60) => jest.advanceTimersByTimeAsync(ms);

const ALLOW = { id: 'allow', label: 'Allow', kind: 'allow_once' as const };
const REJECT = { id: 'reject', label: 'Reject', kind: 'reject_once' as const };

beforeEach(() => {
  jest.useFakeTimers();
  jest.spyOn(console, 'warn').mockImplementation(() => undefined);
});

afterEach(() => {
  jest.useRealTimers();
  jest.restoreAllMocks();
});

describe('ChatSession send', () => {
  it('persists the user message before the backend sees it and derives the title', async () => {
    const h = makeSession(makeThread());
    let savedAtRun: ChatThread | undefined;
    h.backend.onRun = () => {
      savedAtRun = h.storage.last;
    };

    const sent = h.session.send('  What is GitNotes?  ', [{ type: 'note', path: 'a.md', owner: 'o', repo: 'r' } as never]);
    await tick(0);
    h.backend.push({ type: 'text-delta', text: 'A notes app.' });
    await tick();
    h.backend.end();
    await sent;

    expect(savedAtRun?.messages).toHaveLength(1);
    expect(savedAtRun?.messages[0]).toMatchObject({ role: 'user', content: 'What is GitNotes?' });
    expect(savedAtRun?.title).toBe('What is GitNotes');
    expect(h.backend.inputs[0].userText).toBe('What is GitNotes?');
    expect(h.backend.inputs[0].contexts).toHaveLength(1);

    const state = h.session.store.getState();
    expect(state.status).toBe('idle');
    expect(textOf(state.thread!.messages)).toBe('A notes app.');
    expect(h.storage.last.messages.map((m) => m.role)).toEqual(['user', 'assistant']);
  });

  it('ignores blank input and sends while a turn is running', async () => {
    const h = makeSession(makeThread());
    await h.session.send('   ', []);
    expect(h.backend.inputs).toHaveLength(0);

    const first = h.session.send('one', []);
    await tick(0);
    await h.session.send('two', []);
    await h.session.editAndResend('nope', 'x');
    expect(h.backend.inputs).toHaveLength(1);
    expect(h.session.store.getState().thread!.messages).toHaveLength(1);

    h.backend.end();
    await first;
  });

  it('never has two saves in flight even when stop and agent throttling overlap', async () => {
    const h = makeSession(makeAgentThread(), {
      deps: { now: () => Date.now(), agentPersistIntervalMs: 10 },
    });
    h.storage.saveDelayMs = 25;

    const sent = h.session.send('go', []);
    for (let i = 1; i <= 12; i += 1) {
      await tick(8);
      h.backend.push({ type: 'text-delta', text: `w${i} `, seq: i });
    }
    h.session.stop();
    await tick(500);
    await sent;

    expect(h.storage.maxActive).toBe(1);
    expect(h.storage.saved.length).toBeGreaterThan(2);
    const finalThread = h.storage.last;
    expect(finalThread).toEqual(JSON.parse(JSON.stringify(h.session.store.getState().thread)));
  });

  it('surfaces a failed save as a warning, keeps the turn going and clears it after the next good save', async () => {
    const h = makeSession(makeThread());
    h.storage.failNextSave = new Error('GitHub is down');

    const sent = h.session.send('hello', []);
    await tick(0);
    expect(h.backend.inputs).toHaveLength(1);
    expect(h.session.store.getState()).toMatchObject({ status: 'running', error: 'GitHub is down' });

    h.backend.push({ type: 'text-delta', text: 'still here' });
    await tick();
    h.backend.end();
    await sent;

    const state = h.session.store.getState();
    expect(state.status).toBe('idle');
    expect(state.error).toBeNull();
    expect(h.storage.last.messages).toHaveLength(2);
  });
});

describe('ChatSession streaming', () => {
  it('two threads streaming at once never mix their output', async () => {
    const a = makeSession(makeThread({ id: 'a' }));
    const b = makeSession(makeThread({ id: 'b' }));

    const sentA = a.session.send('question a', []);
    const sentB = b.session.send('question b', []);
    await tick(0);

    for (let i = 0; i < 5; i += 1) {
      a.backend.push({ type: 'text-delta', text: `a${i}` });
      b.backend.push({ type: 'text-delta', text: `b${i}` });
      await tick(30);
    }
    b.backend.push({ type: 'tool-start', toolCallId: 'tb', patch: { name: 'only_b' } });
    a.backend.end();
    await sentA;
    b.backend.end();
    await sentB;

    const aMessages = a.session.store.getState().thread!.messages;
    const bMessages = b.session.store.getState().thread!.messages;
    expect(textOf(aMessages)).toBe('a0a1a2a3a4');
    expect(textOf(bMessages)).toBe('b0b1b2b3b4');
    expect(aMessages.some((m) => m.toolCallId)).toBe(false);
    expect(bMessages.some((m) => m.toolCallId === 'tb')).toBe(true);
    expect(a.storage.last.id).toBe('a');
    expect(b.storage.last.id).toBe('b');
  });

  it('keeps running and finishing while nobody is subscribed, and a late subscriber sees the result', async () => {
    const h = makeSession(makeThread());
    const seen: string[] = [];
    const unsubscribe = h.session.store.subscribe((s) => seen.push(s.status));

    const sent = h.session.send('hello', []);
    await tick(0);
    h.backend.push({ type: 'text-delta', text: 'part one ' });
    await tick();
    unsubscribe();

    h.backend.push({ type: 'text-delta', text: 'part two' });
    await tick();
    h.backend.end();
    await sent;

    const state = h.session.store.getState();
    expect(state.status).toBe('idle');
    expect(textOf(state.thread!.messages)).toBe('part one part two');
    expect(h.storage.last.messages[1].content).toBe('part one part two');
    expect(seen).not.toContain('idle');
  });

  it('coalesces a burst of deltas into few store updates and flushes the tail', async () => {
    const h = makeSession(makeThread());
    const sent = h.session.send('burst', []);
    await tick(0);

    let threadUpdates = 0;
    let lastMessages = h.session.store.getState().thread!.messages;
    h.session.store.subscribe((s) => {
      if (s.thread && s.thread.messages !== lastMessages) {
        lastMessages = s.thread.messages;
        threadUpdates += 1;
      }
    });

    for (let i = 0; i < 500; i += 1) h.backend.push({ type: 'text-delta', text: 'x' });
    await tick(0);
    expect(threadUpdates).toBeLessThanOrEqual(1);
    await tick(60);

    expect(textOf(h.session.store.getState().thread!.messages)).toBe('x'.repeat(500));
    expect(threadUpdates).toBeLessThanOrEqual(2);
    h.backend.end();
    await sent;
  });

  it('flushes buffered text before a tool event so order is preserved', async () => {
    const h = makeSession(makeThread());
    const sent = h.session.send('go', []);
    await tick(0);

    h.backend.push(
      { type: 'text-delta', text: 'before ' },
      { type: 'tool-start', toolCallId: 't1', patch: { name: 'x' } },
      { type: 'text-delta', text: 'after' },
    );
    await tick(0);
    const kinds = h.session.store.getState().thread!.messages.map((m) => m.kind ?? m.role);
    expect(kinds).toEqual(['user', 'text', 'tool']);
    await tick(60);
    expect(h.session.store.getState().thread!.messages.map((m) => m.kind ?? m.role)).toEqual(['user', 'text', 'tool', 'text']);
    h.backend.end();
    await sent;
  });

  it('a snapshot taken at any point replays without missing or duplicated text', async () => {
    const h = makeSession(makeAgentThread(), {
      deps: { now: () => Date.now(), agentPersistIntervalMs: 90 },
    });
    const words = Array.from({ length: 60 }, (_, i) => `w${i} `);
    const observed: ChatThread[] = [];
    h.session.store.subscribe((s) => {
      if (s.thread) observed.push(s.thread);
    });

    const sent = h.session.send('stream', []);
    await tick(0);
    for (let i = 0; i < words.length; i += 1) {
      h.backend.push({ type: 'text-delta', text: words[i], seq: i + 1 });
      await tick(i % 7 === 0 ? 70 : 9);
    }
    h.backend.end();
    await sent;

    const replayable = (thread: ChatThread) => {
      const seq = thread.backend?.type === 'agent' ? (thread.backend.lastSeq ?? 0) : 0;
      return textOf(thread.messages) === words.slice(0, seq).join('');
    };
    expect(observed.length).toBeGreaterThan(10);
    expect(observed.every(replayable)).toBe(true);
    expect(h.storage.saved.length).toBeGreaterThan(2);
    expect(h.storage.saved.every(replayable)).toBe(true);
    expect(h.storage.last.backend).toMatchObject({ lastSeq: words.length });
  });

  it('persists agent threads at most every 1.5s while a turn runs, model threads only at the end', async () => {
    const agent = makeSession(makeAgentThread(), { deps: { now: () => Date.now() } });
    const model = makeSession(makeThread());
    const sentAgent = agent.session.send('a', []);
    const sentModel = model.session.send('m', []);
    await tick(0);
    const agentBaseline = agent.storage.saved.length;
    const modelBaseline = model.storage.saved.length;

    for (let i = 1; i <= 50; i += 1) {
      agent.backend.push({ type: 'text-delta', text: 'x', seq: i });
      model.backend.push({ type: 'text-delta', text: 'x' });
      await tick(100);
    }
    const agentDuringRun = agent.storage.saved.length - agentBaseline;
    expect(agentDuringRun).toBeGreaterThanOrEqual(2);
    expect(agentDuringRun).toBeLessThanOrEqual(4);
    expect(model.storage.saved.length).toBe(modelBaseline);

    agent.backend.end();
    model.backend.end();
    await Promise.all([sentAgent, sentModel]);
    expect(model.storage.saved.length).toBe(modelBaseline + 1);
  });

  it('folds agent-state into thread.backend and clears the pending prompt at turn end', async () => {
    const h = makeSession(makeAgentThread());
    const sent = h.session.send('hi', []);
    await tick(0);
    h.backend.push(
      { type: 'agent-state', sessionId: 'sess-1', connectionId: 'conn-1', pendingPromptId: 12, seq: 1 },
      { type: 'agent-state', modeId: 'plan', availableModes: [{ id: 'plan', name: 'Plan' }], seq: 2 },
    );
    await tick(0);
    expect(h.session.store.getState().thread!.backend).toMatchObject({
      sessionId: 'sess-1',
      connectionId: 'conn-1',
      pendingPromptId: 12,
      modeId: 'plan',
      lastSeq: 2,
    });

    h.backend.end();
    await sent;
    const backend = h.storage.last.backend;
    expect(backend).toMatchObject({ sessionId: 'sess-1', connectionId: 'conn-1', modeId: 'plan' });
    expect(backend && 'pendingPromptId' in backend).toBe(false);
  });

  it('shows the backend status line while it runs and clears it afterwards', async () => {
    const h = makeSession(makeThread());
    const sent = h.session.send('hi', []);
    await tick(0);
    h.backend.inputs[0].reportStatus?.('Reconnecting to bridge...');
    expect(h.session.store.getState().statusLine).toBe('Reconnecting to bridge...');
    h.backend.end();
    await sent;
    expect(h.session.store.getState().statusLine).toBeNull();
    expect(h.session.store.getState().streamStartedAt).toBe(0);
  });
});

describe('ChatSession stop', () => {
  it('stops mid-stream, keeps the partial text and persists it', async () => {
    const h = makeSession(makeThread());
    const sent = h.session.send('long', []);
    await tick(0);
    h.backend.push({ type: 'text-delta', text: 'partial answer' });
    await tick();

    h.session.stop();
    await sent;

    expect(h.backend.inputs[0].signal.aborted).toBe(true);
    const state = h.session.store.getState();
    expect(state).toMatchObject({ status: 'idle', error: null, retryable: false });
    expect(textOf(state.thread!.messages)).toBe('partial answer');
    expect(textOf(h.storage.last.messages)).toBe('partial answer');
  });

  it('does not wait forever for a backend that ignores the abort', async () => {
    const h = makeSession(makeThread());
    h.backend.endsOnAbort = false;
    const sent = h.session.send('long', []);
    await tick(0);
    h.backend.push({ type: 'text-delta', text: 'so far' });
    await tick();

    h.session.stop();
    await tick(250);
    await sent;

    expect(h.session.store.getState().status).toBe('idle');
    expect(textOf(h.session.store.getState().thread!.messages)).toBe('so far');
  });

  it('settles tool calls that were still running when the turn was stopped', async () => {
    const h = makeSession(makeThread());
    const sent = h.session.send('go', []);
    await tick(0);
    h.backend.push({ type: 'tool-start', toolCallId: 't1', patch: { name: 'x', status: 'running' } });
    await tick();
    h.session.stop();
    await sent;
    expect(h.session.store.getState().thread!.messages[1].toolStatus).toBe('failed');
  });

  it('allows a new turn after a stop', async () => {
    const h = makeSession(makeThread());
    const first = h.session.send('one', []);
    await tick(0);
    h.session.stop();
    await first;

    const second = h.session.send('two', []);
    await tick(0);
    expect(h.backend.inputs).toHaveLength(2);
    expect(h.backend.inputs[1].signal.aborted).toBe(false);
    h.backend.end();
    await second;
  });
});

describe('ChatSession permissions', () => {
  function permissionBackend(decisions: PermissionDecision[]): ChatBackend {
    return {
      type: 'model',
      async *run(input: ChatRunInput): AsyncGenerator<ChatEvent> {
        yield { type: 'tool-start', toolCallId: 't1', patch: { name: 'create_note', status: 'running' } };
        const decision = await input.requestPermission({
          toolCallId: 't1',
          title: 'Create note',
          options: [ALLOW, REJECT],
        });
        decisions.push(decision);
        yield { type: 'tool-update', toolCallId: 't1', patch: { status: decision.optionId === 'allow' ? 'completed' : 'rejected' } };
        yield { type: 'turn-end', stopReason: 'end_turn' };
      },
    };
  }

  async function startPermissionTurn() {
    const decisions: PermissionDecision[] = [];
    const backend = permissionBackend(decisions);
    const storage = new MemoryStorage();
    const h = makeSession(makeThread(), { storage, deps: { resolveBackend: () => backend } });
    const sent = h.session.send('make a note', []);
    await tick(0);
    return { h, sent, decisions };
  }

  it('queues the request, marks the tool awaiting approval and resumes on allow', async () => {
    const { h, sent, decisions } = await startPermissionTurn();
    const state = h.session.store.getState();
    expect(state.status).toBe('awaiting-permission');
    expect(state.pendingPermissions).toHaveLength(1);
    expect(state.pendingPermissions[0]).toMatchObject({ toolCallId: 't1', title: 'Create note' });
    expect(state.thread!.messages[1].toolStatus).toBe('awaiting-approval');

    h.session.resolvePermission(state.pendingPermissions[0].id, { optionId: 'allow' });
    expect(h.session.store.getState()).toMatchObject({ status: 'running', pendingPermissions: [] });
    expect(h.session.store.getState().thread!.messages[1].toolStatus).toBe('running');

    await sent;
    expect(decisions).toEqual([{ optionId: 'allow' }]);
    expect(h.session.store.getState().thread!.messages[1].toolStatus).toBe('completed');
    expect(h.session.store.getState().status).toBe('idle');
  });

  it('marks the tool rejected right away when the user rejects', async () => {
    const { h, sent, decisions } = await startPermissionTurn();
    const [request] = h.session.store.getState().pendingPermissions;
    h.session.resolvePermission(request.id, { optionId: 'reject' });
    expect(h.session.store.getState().thread!.messages[1].toolStatus).toBe('rejected');
    await sent;
    expect(decisions).toEqual([{ optionId: 'reject' }]);
  });

  it('resolves pending requests with a null decision when the turn is stopped', async () => {
    const { h, sent, decisions } = await startPermissionTurn();
    h.session.stop();
    expect(h.session.store.getState().pendingPermissions).toEqual([]);
    await sent;
    expect(decisions).toEqual([{ optionId: null }]);
    expect(h.session.store.getState()).toMatchObject({ status: 'idle', error: null });
    expect(h.session.store.getState().thread!.messages[1].toolStatus).toBe('rejected');
  });

  it('ignores decisions for unknown or already answered requests', async () => {
    const { h, sent } = await startPermissionTurn();
    const [request] = h.session.store.getState().pendingPermissions;
    h.session.resolvePermission('nope', { optionId: 'allow' });
    expect(h.session.store.getState().pendingPermissions).toHaveLength(1);
    h.session.resolvePermission(request.id, { optionId: 'allow' });
    h.session.resolvePermission(request.id, { optionId: 'reject' });
    await sent;
    expect(h.session.store.getState().thread!.messages[1].toolStatus).toBe('completed');
  });

  it('keeps awaiting-permission until every queued request is answered', async () => {
    const backend: ChatBackend = {
      type: 'agent',
      async *run(input) {
        const first = input.requestPermission({ title: 'one', options: [ALLOW, REJECT] });
        const second = input.requestPermission({ title: 'two', options: [ALLOW, REJECT] });
        await Promise.all([first, second]);
        yield { type: 'turn-end', stopReason: 'end_turn' };
      },
    };
    const h = makeSession(makeAgentThread(), { deps: { resolveBackend: () => backend } });
    const sent = h.session.send('go', []);
    await tick(0);
    const { pendingPermissions } = h.session.store.getState();
    expect(pendingPermissions).toHaveLength(2);

    h.session.resolvePermission(pendingPermissions[0].id, { optionId: 'allow' });
    expect(h.session.store.getState().status).toBe('awaiting-permission');
    h.session.resolvePermission(pendingPermissions[1].id, { optionId: 'allow' });
    expect(h.session.store.getState().status).toBe('running');
    await sent;
  });
});

describe('ChatSession errors, retry, edit and regenerate', () => {
  it('keeps partial output on failure, reports the error and retries from the last user message', async () => {
    const h = makeSession(makeThread());
    const sent = h.session.send('please', []);
    await tick(0);
    h.backend.push({ type: 'text-delta', text: 'half an ans' });
    await tick();
    h.backend.fail(new Error('Rate limited'));
    await sent;

    let state = h.session.store.getState();
    expect(state).toMatchObject({ status: 'error', error: 'Rate limited', retryable: true });
    expect(textOf(state.thread!.messages)).toBe('half an ans');
    expect(textOf(h.storage.last.messages)).toBe('half an ans');

    const retried = h.session.retry();
    await tick(0);
    expect(h.backend.inputs).toHaveLength(2);
    expect(h.backend.inputs[1].userText).toBe('please');
    expect(h.backend.inputs[1].thread.messages).toHaveLength(1);
    state = h.session.store.getState();
    expect(state).toMatchObject({ status: 'running', error: null, retryable: false });

    h.backend.push({ type: 'text-delta', text: 'full answer' });
    await tick();
    h.backend.end();
    await retried;
    expect(textOf(h.session.store.getState().thread!.messages)).toBe('full answer');
    expect(h.session.store.getState().thread!.messages.filter((m) => m.role === 'user')).toHaveLength(1);
  });

  it('settles tools that were mid-flight when the backend threw', async () => {
    const h = makeSession(makeThread());
    const sent = h.session.send('go', []);
    await tick(0);
    h.backend.push({ type: 'tool-start', toolCallId: 't1', patch: { name: 'x', status: 'running' } });
    await tick();
    h.backend.fail(new Error('connection lost'));
    await sent;
    expect(h.session.store.getState().thread!.messages[1].toolStatus).toBe('failed');
  });

  it('uses a generic message when the backend throws something without one', async () => {
    const h = makeSession(makeThread());
    const sent = h.session.send('go', []);
    await tick(0);
    h.backend.fail(new Error(''));
    await sent;
    expect(h.session.store.getState().error).toBeTruthy();
    expect(h.session.store.getState().status).toBe('error');
  });

  it('dismissError returns to idle', async () => {
    const h = makeSession(makeThread());
    const sent = h.session.send('go', []);
    await tick(0);
    h.backend.fail(new Error('nope'));
    await sent;
    h.session.dismissError();
    expect(h.session.store.getState()).toMatchObject({ status: 'idle', error: null, retryable: false });
  });

  async function threadWithTwoExchanges() {
    const h = makeSession(makeThread());
    for (const [question, answer] of [['first q', 'first a'], ['second q', 'second a']]) {
      const sent = h.session.send(question, [{ type: 'note', path: `${question}.md`, owner: 'o', repo: 'r' } as never]);
      await tick(0);
      h.backend.push({ type: 'text-delta', text: answer });
      await tick();
      h.backend.end();
      await sent;
    }
    return h;
  }

  it('editAndResend replaces the message and everything after it, then re-runs', async () => {
    const h = await threadWithTwoExchanges();
    const [firstQuestion] = h.session.store.getState().thread!.messages;

    const edited = h.session.editAndResend(firstQuestion.id, '  edited q ');
    await tick(0);
    const run = h.backend.inputs[h.backend.inputs.length - 1];
    expect(run.userText).toBe('edited q');
    expect(run.contexts).toHaveLength(1);
    expect(run.thread.messages).toHaveLength(1);
    expect(run.thread.messages[0]).toMatchObject({ role: 'user', content: 'edited q' });
    expect(h.storage.last.messages).toHaveLength(1);

    h.backend.push({ type: 'text-delta', text: 'new answer' });
    await tick();
    h.backend.end();
    await edited;
    expect(h.session.store.getState().thread!.messages.map((m) => m.content)).toEqual(['edited q', 'new answer']);
  });

  it('regenerate drops the reply and everything after the user message before it', async () => {
    const h = await threadWithTwoExchanges();
    const messages = h.session.store.getState().thread!.messages;
    expect(messages.map((m) => m.content)).toEqual(['first q', 'first a', 'second q', 'second a']);

    const regenerated = h.session.regenerate(messages[1].id);
    await tick(0);
    const run = h.backend.inputs[h.backend.inputs.length - 1];
    expect(run.userText).toBe('first q');
    expect(run.thread.messages.map((m) => m.content)).toEqual(['first q']);

    h.backend.push({ type: 'text-delta', text: 'first a v2' });
    await tick();
    h.backend.end();
    await regenerated;
    expect(h.session.store.getState().thread!.messages.map((m) => m.content)).toEqual(['first q', 'first a v2']);
  });

  it('regenerate on an unknown message does nothing', async () => {
    const h = await threadWithTwoExchanges();
    const runs = h.backend.inputs.length;
    await h.session.regenerate('missing');
    expect(h.backend.inputs).toHaveLength(runs);
  });
});

describe('ChatSession loading and cold-start resume', () => {
  it('reports not-found and load errors without a thread', async () => {
    const missing = makeSession(makeThread({ id: 'gone' }), { hydrate: false });
    missing.storage.stored.clear();
    await missing.session.ensureLoaded();
    expect(missing.session.store.getState()).toMatchObject({ loadState: 'not-found', thread: null });

    const failing = makeSession(makeThread(), {
      hydrate: false,
      deps: { loadThread: async () => { throw new Error('offline'); } },
    });
    await failing.session.ensureLoaded();
    expect(failing.session.store.getState()).toMatchObject({ loadState: 'error', loadError: 'offline' });
  });

  it('loads once however many screens ask', async () => {
    const loadThread = jest.fn(async () => makeThread());
    const h = makeSession(makeThread(), { hydrate: false, deps: { loadThread } });
    await Promise.all([h.session.ensureLoaded(), h.session.ensureLoaded(), h.session.ensureLoaded()]);
    expect(loadThread).toHaveBeenCalledTimes(1);
    expect(h.session.store.getState().loadState).toBe('ready');
  });

  const interrupted = () =>
    makeAgentThread({
      title: 'Fix the build',
      messages: [
        { id: 'u1', role: 'user', content: 'fix it', timestamp: 1 },
        { id: 'a1', role: 'assistant', kind: 'text', content: 'Looking at ', timestamp: 2 },
        { id: 't1', role: 'assistant', kind: 'tool', content: '', timestamp: 3, toolCallId: 't1', toolCallName: 'bash', toolStatus: 'running' },
      ],
      backend: {
        type: 'agent',
        bridgeId: 'b',
        agentId: 'claude',
        agentName: 'Claude Code',
        cwd: '/work',
        sessionId: 's1',
        connectionId: 'c1',
        lastSeq: 3,
        pendingPromptId: 7,
      },
    });

  it('re-attaches through backend.resume when the app died mid-turn, then replays from the stored cursor', async () => {
    const backend = new ScriptedBackend('agent', true);
    const h = makeSession(interrupted(), { backend, hydrate: false });
    await h.session.ensureLoaded();
    await tick(0);

    expect(backend.resumeInputs).toHaveLength(1);
    expect(backend.inputs).toHaveLength(0);
    expect(backend.resumeInputs[0].thread.backend).toMatchObject({ lastSeq: 3, pendingPromptId: 7 });
    expect(h.session.store.getState().status).toBe('running');
    expect(h.session.store.getState().thread!.messages[2].toolStatus).toBe('running');

    backend.push(
      { type: 'tool-update', toolCallId: 't1', patch: { status: 'completed', result: 'ok' }, seq: 4 },
      { type: 'text-delta', text: 'Done.', seq: 5 },
    );
    await tick();
    backend.end();
    await tick(0);

    const state = h.session.store.getState();
    expect(state.status).toBe('idle');
    expect(state.thread!.messages[2]).toMatchObject({ toolStatus: 'completed', toolCallResult: 'ok' });
    expect(textOf(state.thread!.messages)).toBe('Looking at |Done.');
    expect(h.storage.last.backend).toMatchObject({ lastSeq: 5 });
    expect(h.storage.last.backend && 'pendingPromptId' in h.storage.last.backend).toBe(false);
  });

  it('does not start anything on load when there is no pending prompt', async () => {
    const backend = new ScriptedBackend('agent', true);
    const thread = interrupted();
    if (thread.backend?.type === 'agent') delete thread.backend.pendingPromptId;
    const h = makeSession(thread, { backend, hydrate: false });
    await h.session.ensureLoaded();
    await tick(0);
    expect(backend.resumeInputs).toHaveLength(0);
    expect(h.session.store.getState().status).toBe('idle');
  });

  it('drops the stale pending prompt and settles tools when the backend cannot resume', async () => {
    const backend = new ScriptedBackend('agent', false);
    const h = makeSession(interrupted(), { backend, hydrate: false });
    await h.session.ensureLoaded();
    await tick(0);

    const state = h.session.store.getState();
    expect(state.status).toBe('idle');
    expect(backend.inputs).toHaveLength(0);
    expect(state.thread!.messages[2].toolStatus).toBe('failed');
    expect(state.thread!.backend && 'pendingPromptId' in state.thread!.backend).toBe(false);
  });

  it('settles abandoned tool calls of model threads loaded from storage', async () => {
    const thread = makeThread({
      messages: [
        { id: 'u1', role: 'user', content: 'x', timestamp: 1 },
        { id: 't1', role: 'assistant', kind: 'tool', content: '', timestamp: 2, toolCallId: 't1', toolCallName: 'create_note', toolStatus: 'awaiting-approval' },
      ],
    });
    const h = makeSession(thread, { hydrate: false });
    await h.session.ensureLoaded();
    expect(h.session.store.getState().thread!.messages[1].toolStatus).toBe('rejected');
  });
});

describe('ChatSession misc actions', () => {
  it('setMode forwards to the backend and persists the new mode', async () => {
    const backend = new ScriptedBackend('agent');
    const setMode = jest.fn(async () => undefined);
    backend.setMode = setMode;
    const h = makeSession(makeAgentThread(), { backend });
    await h.session.setMode('plan');
    await tick(0);
    expect(setMode).toHaveBeenCalledWith(expect.objectContaining({ id: 'thread-1' }), 'plan');
    expect(h.session.store.getState().thread!.backend).toMatchObject({ modeId: 'plan' });
    expect(h.storage.last.backend).toMatchObject({ modeId: 'plan' });
  });

  it('setMode keeps the old mode and reports the error when the backend rejects', async () => {
    const backend = new ScriptedBackend('agent');
    backend.setMode = jest.fn(async () => { throw new Error('mode unsupported'); });
    const h = makeSession(makeAgentThread(), { backend });
    await h.session.setMode('plan');
    expect(h.session.store.getState().error).toBe('mode unsupported');
    expect(h.session.store.getState().thread!.backend).not.toMatchObject({ modeId: 'plan' });
  });

  it('rename updates the loaded thread and persists it', async () => {
    const h = makeSession(makeThread({ title: 'Old' }));
    expect(h.session.rename('Renamed')).toBe(true);
    await tick(0);
    expect(h.storage.last.title).toBe('Renamed');
  });

  it('dispose aborts a running turn and stops further saves', async () => {
    const h = makeSession(makeThread());
    const sent = h.session.send('go', []);
    await tick(0);
    const savesBefore = h.storage.saved.length;
    h.session.dispose();
    await tick(300);
    await sent;
    expect(h.backend.inputs[0].signal.aborted).toBe(true);
    expect(h.storage.saved.length).toBe(savesBefore);
  });
});
