import type { ChatEvent } from '../../../src/services/chat/types';
import { agentBackend, releaseAgentConnection } from '../../../src/services/chat/backends/agentBackend';
import type { AgentBridge } from '../../../src/services/agent/types';
import { useAgentBridgeStore } from '../../../src/stores/agentBridgeStore';
import {
  type AgentBackendState,
  agentThread,
  collect,
  drive,
  eventsOfType,
  foldBackend,
  installNodeWebSocket,
  pairFakeBridge,
  runInput,
  sleep,
  textOf,
  threadWithBackend,
  visibleTypes,
  waitFor,
} from '../../helpers/agentChat';
import { FakeBridge, type PromptContext } from '../../helpers/fakeBridge';

const THREAD_ID = 'thread-1';

function requireBackend(thread: ReturnType<typeof agentThread>): AgentBackendState {
  if (thread.backend?.type !== 'agent') throw new Error('not an agent thread');
  return thread.backend;
}

function methodsFromClient(bridge: FakeBridge): string[] {
  return bridge.lastConnection.fromClient.flatMap((message) => (message.method ? [message.method] : []));
}

/** Pulls events one by one until `predicate` matches, leaving the generator suspended. */
async function pullUntil(
  iterator: AsyncIterator<ChatEvent>,
  events: ChatEvent[],
  predicate: (event: ChatEvent) => boolean,
): Promise<void> {
  for (;;) {
    const step = await iterator.next();
    if (step.done) throw new Error('stream ended before the expected event');
    events.push(step.value);
    if (predicate(step.value)) return;
  }
}

async function drain(iterator: AsyncIterator<ChatEvent>, events: ChatEvent[]): Promise<Error | null> {
  try {
    for (;;) {
      const step = await iterator.next();
      if (step.done) return null;
      events.push(step.value);
    }
  } catch (error) {
    return error instanceof Error ? error : new Error(String(error));
  }
}

describe('agentBackend', () => {
  let restoreWebSocket: () => void;
  let bridge: FakeBridge;
  let paired: AgentBridge;

  beforeAll(() => {
    restoreWebSocket = installNodeWebSocket();
  });
  afterAll(() => restoreWebSocket());

  beforeEach(async () => {
    bridge = await FakeBridge.start();
    paired = await pairFakeBridge(bridge);
  });

  afterEach(async () => {
    releaseAgentConnection(THREAD_ID);
    await bridge.stop();
    useAgentBridgeStore.setState({ bridges: [] });
  });

  describe('a normal turn', () => {
    it('streams text, thoughts, tools with diffs and plans, then ends the turn once', async () => {
      bridge.promptHandler = async (ctx) => {
        ctx.update({ sessionUpdate: 'agent_thought_chunk', content: { type: 'text', text: 'Thinking…' } });
        ctx.agentMessage('Hello ');
        ctx.update({ sessionUpdate: 'tool_call', toolCallId: 'c1', title: 'Edit a.ts', kind: 'edit', status: 'pending' });
        ctx.update({
          sessionUpdate: 'tool_call_update',
          toolCallId: 'c1',
          status: 'completed',
          content: [{ type: 'diff', path: '/work/a.ts', oldText: 'a', newText: 'b' }],
        });
        ctx.update({ sessionUpdate: 'plan', entries: [{ content: 'Ship it', status: 'in_progress', priority: 'high' }] });
        ctx.agentMessage('world');
      };
      const thread = agentThread(paired.id);

      const events = await collect(agentBackend.run(runInput(thread)));

      expect(visibleTypes(events)).toEqual(['thought-delta', 'text-delta', 'tool-start', 'tool-update', 'plan', 'text-delta', 'turn-end']);
      expect(textOf(events)).toBe('Hello world');
      expect(eventsOfType(events, 'tool-start')[0]).toMatchObject({
        toolCallId: 'c1',
        patch: { name: 'Edit a.ts', kind: 'edit', status: 'pending' },
      });
      expect(eventsOfType(events, 'tool-update')[0]?.patch).toMatchObject({
        status: 'completed',
        diffs: [{ path: '/work/a.ts', oldText: 'a', newText: 'b' }],
      });
      expect(eventsOfType(events, 'plan')[0]?.entries).toEqual([{ content: 'Ship it', status: 'in_progress', priority: 'high' }]);
      expect(eventsOfType(events, 'turn-end')).toEqual([expect.objectContaining({ stopReason: 'end_turn' })]);
      expect(events[events.length - 1]?.type).toBe('turn-end');
    });

    it('records session, connection and prompt bookkeeping with a monotonic replay cursor', async () => {
      const events = await collect(agentBackend.run(runInput(agentThread(paired.id))));

      const states = eventsOfType(events, 'agent-state');
      expect(states[0]).toMatchObject({
        sessionId: expect.stringMatching(/^sess_/),
        connectionId: bridge.lastConnection.id,
        modeId: 'default',
        availableModes: [{ id: 'default', name: 'Default', description: 'Ask before changes' }, { id: 'plan', name: 'Plan' }],
      });
      expect(states[1]).toEqual(expect.objectContaining({ pendingPromptId: expect.any(Number) }));

      const seqs = events.flatMap((event) => (event.seq === undefined ? [] : [event.seq]));
      expect([...seqs].sort((a, b) => a - b)).toEqual(seqs);
      expect(events[events.length - 1]?.seq).toBe(bridge.lastConnection.headSeq);
    });

    it('initializes once with no client capabilities and sends exactly one prompt', async () => {
      await collect(agentBackend.run(runInput(agentThread(paired.id), { text: 'fix the bug' })));

      const { fromClient } = bridge.lastConnection;
      const initialize = fromClient.find((message) => message.method === 'initialize');
      expect(initialize?.params).toMatchObject({
        protocolVersion: 1,
        clientCapabilities: { fs: { readTextFile: false, writeTextFile: false }, terminal: false },
      });
      expect(methodsFromClient(bridge)).toEqual(['initialize', 'session/new', 'session/prompt']);
      expect(bridge.lastConnection.prompts()).toHaveLength(1);
      expect(bridge.lastConnection.prompts()[0]?.params).toMatchObject({
        prompt: [{ type: 'text', text: 'fix the bug' }],
      });
    });

    it('lists attached notes after the user text', async () => {
      const input = runInput(agentThread(paired.id), { text: 'review these' });
      input.contexts = [
        { type: 'file', owner: 'o', repo: 'r', path: 'notes/a.md', name: 'a.md' },
        { type: 'folder', owner: 'o', repo: 'r', path: 'notes', name: 'notes' },
      ];
      await collect(agentBackend.run(input));

      const prompt = bridge.lastConnection.prompts()[0]?.params as { prompt: Array<{ type: string; text: string }> };
      expect(prompt.prompt).toHaveLength(2);
      expect(prompt.prompt[1]?.text).toContain('- a.md (notes/a.md)');
      expect(prompt.prompt[1]?.text).toContain('- notes (notes)');
    });

    it('reuses the agent process and session for consecutive turns', async () => {
      const first = await collect(agentBackend.run(runInput(agentThread(paired.id), { text: 'one' })));
      const backend = foldBackend(requireBackend(agentThread(paired.id)), first);

      const second = await collect(agentBackend.run(runInput(threadWithBackend(agentThread(paired.id, {}, 'two'), backend), { text: 'two' })));

      expect(bridge.connections.size).toBe(1);
      expect(bridge.socketsAccepted).toBe(1);
      expect(methodsFromClient(bridge)).toEqual(['initialize', 'session/new', 'session/prompt', 'session/prompt']);
      expect(textOf(second)).toBe('Echo: two');
      expect(eventsOfType(second, 'agent-state')[0]?.sessionId).toBe(backend.sessionId);
    });

    it('re-attaches to the still-running agent after the in-memory connection is gone', async () => {
      const first = await collect(agentBackend.run(runInput(agentThread(paired.id), { text: 'one' })));
      const backend = foldBackend(requireBackend(agentThread(paired.id)), first);
      releaseAgentConnection(THREAD_ID, { kill: false });

      const second = await collect(agentBackend.run(runInput(threadWithBackend(agentThread(paired.id, {}, 'two'), backend), { text: 'two' })));

      expect(bridge.connections.size).toBe(1);
      expect(methodsFromClient(bridge)).toEqual(['initialize', 'session/new', 'session/prompt', 'session/prompt']);
      expect(textOf(second)).toBe('Echo: two');
    });

    it('reports a failing prompt as an error, not a turn end', async () => {
      bridge.promptHandler = () => {
        throw new Error('model overloaded');
      };

      const { events, error } = await drive(agentBackend.run(runInput(agentThread(paired.id))));

      expect(error?.message).toBe('model overloaded');
      expect(eventsOfType(events, 'turn-end')).toHaveLength(0);
    });

    it('rejects threads that are not agent threads', async () => {
      const thread = { ...agentThread(paired.id), backend: { type: 'model' as const } };
      await expect(collect(agentBackend.run(runInput(thread)))).rejects.toThrow(/not connected to a coding agent/);
    });

    it('does not touch the network when already cancelled', async () => {
      const input = runInput(agentThread(paired.id));
      input.controller.abort();

      const events = await collect(agentBackend.run(input));

      expect(events).toEqual([{ type: 'turn-end', stopReason: 'cancelled' }]);
      expect(bridge.socketsAccepted).toBe(0);
    });
  });

  describe('session setup', () => {
    it('restores a persisted session with session/load and discards the history the agent replays', async () => {
      const first = await collect(agentBackend.run(runInput(agentThread(paired.id), { text: 'one' })));
      const backend = foldBackend(requireBackend(agentThread(paired.id)), first);
      releaseAgentConnection(THREAD_ID, { kill: true });
      await waitFor(() => bridge.connections.size === 0);

      const second = await collect(
        agentBackend.run(runInput(threadWithBackend(agentThread(paired.id, {}, 'two'), backend), { text: 'two' })),
      );

      expect(methodsFromClient(bridge)).toEqual(['initialize', 'session/load', 'session/prompt']);
      expect(bridge.lastConnection.fromClient.find((message) => message.method === 'session/load')?.params).toEqual({
        sessionId: backend.sessionId,
        cwd: '/work',
        mcpServers: [],
      });
      expect(textOf(second)).toBe('Echo: two');
      expect(eventsOfType(second, 'tool-start')).toHaveLength(0);
      expect(eventsOfType(second, 'agent-state')[0]?.sessionId).toBe(backend.sessionId);
    });

    it('moves the replay cursor past discarded history so a cold resume cannot replay it', async () => {
      const first = await collect(agentBackend.run(runInput(agentThread(paired.id), { text: 'one' })));
      const backend = foldBackend(requireBackend(agentThread(paired.id)), first);
      releaseAgentConnection(THREAD_ID, { kill: true });

      const second = await collect(
        agentBackend.run(runInput(threadWithBackend(agentThread(paired.id, {}, 'two'), backend), { text: 'two' })),
      );

      const sessionState = eventsOfType(second, 'agent-state')[0];
      const loadedFrames = bridge.lastConnection.frames.filter(
        (frame) => frame.message.method === 'session/update' && JSON.stringify(frame.message.params).includes('user_message_chunk'),
      );
      expect(loadedFrames.length).toBeGreaterThan(0);
      expect(sessionState?.seq).toBeGreaterThan(Math.max(...loadedFrames.map((frame) => frame.seq)));
    });

    it('starts a new session when the agent cannot load sessions', async () => {
      await bridge.stop();
      bridge = await FakeBridge.start({ agentLoadSession: false });
      useAgentBridgeStore.setState({ bridges: [] });
      paired = await pairFakeBridge(bridge);

      const events = await collect(
        agentBackend.run(runInput(agentThread(paired.id, { sessionId: 'sess_from_before' }))),
      );

      expect(methodsFromClient(bridge)).toEqual(['initialize', 'session/new', 'session/prompt']);
      const [state] = eventsOfType(events, 'agent-state');
      expect(state?.sessionId).toMatch(/^sess_conn_/);
    });

    it('starts a new session when the agent no longer knows the persisted one', async () => {
      const events = await collect(
        agentBackend.run(runInput(agentThread(paired.id, { sessionId: 'sess_unknown' }))),
      );

      expect(methodsFromClient(bridge)).toEqual(['initialize', 'session/load', 'session/new', 'session/prompt']);
      expect(textOf(events)).toBe('Echo: hello');
    });

    it('falls back to a fresh agent when the bridge forgot the connection', async () => {
      const first = await collect(agentBackend.run(runInput(agentThread(paired.id), { text: 'one' })));
      const backend = foldBackend(requireBackend(agentThread(paired.id)), first);
      releaseAgentConnection(THREAD_ID, { kill: false });
      bridge.connections.clear();

      const second = await collect(
        agentBackend.run(runInput(threadWithBackend(agentThread(paired.id, {}, 'two'), backend), { text: 'two' })),
      );

      expect(bridge.connections.size).toBe(1);
      expect(methodsFromClient(bridge)).toEqual(['initialize', 'session/load', 'session/prompt']);
      expect(textOf(second)).toBe('Echo: two');
    });

    it('tells the user to sign in on the host when the agent requires authentication', async () => {
      await bridge.stop();
      bridge = await FakeBridge.start({ agentAuthRequired: true });
      useAgentBridgeStore.setState({ bridges: [] });
      paired = await pairFakeBridge(bridge);

      const { error, events } = await drive(agentBackend.run(runInput(agentThread(paired.id))));

      expect(error?.message).toMatch(/Fake Agent is not signed in on the host/);
      expect(error?.message).toMatch(/gitnotes-bridge/);
      expect(eventsOfType(events, 'turn-end')).toHaveLength(0);
      expect(bridge.lastConnection.prompts()).toHaveLength(0);
    });

    it('surfaces an agent that is not installed on the host', async () => {
      const { error } = await drive(agentBackend.run(runInput(agentThread(paired.id, { agentId: 'missing', agentName: 'Missing Agent' }))));
      expect(error?.message).toMatch(/not installed/);
    });

    it('explains a bridge that was removed', async () => {
      await useAgentBridgeStore.getState().removeBridge(paired.id);
      const { error } = await drive(agentBackend.run(runInput(agentThread(paired.id))));
      expect(error?.message).toMatch(/no longer paired/i);
    });

    it('re-applies the chosen mode to a new session and sets modes on demand', async () => {
      const backend = agentThread(paired.id, { modeId: 'plan' });
      await collect(agentBackend.run(runInput(backend)));

      const setMode = bridge.lastConnection.fromClient.find((message) => message.method === 'session/set_mode');
      expect(setMode?.params).toMatchObject({ modeId: 'plan' });

      await agentBackend.setMode?.(agentThread(paired.id, { modeId: 'plan' }), 'default');
      const modeCalls = bridge.lastConnection.fromClient.filter((message) => message.method === 'session/set_mode');
      expect(modeCalls.map((message) => (message.params as { modeId: string }).modeId)).toEqual(['plan', 'default']);
    });

    it('can set the mode before the first message by creating the session itself', async () => {
      await agentBackend.setMode?.(agentThread(paired.id), 'plan');

      expect(methodsFromClient(bridge)).toEqual(['initialize', 'session/new', 'session/set_mode']);

      const events = await collect(agentBackend.run(runInput(agentThread(paired.id))));
      expect(bridge.connections.size).toBe(1);
      expect(eventsOfType(events, 'agent-state')[0]).toMatchObject({ modeId: 'plan' });
    });
  });

  describe('permissions', () => {
    const permissionScript = async (ctx: PromptContext) => {
      const outcome = await ctx.requestPermission({
        toolCallId: 'c1',
        title: 'Run shell command',
        kind: 'execute',
        rawInput: { command: 'rm -rf build' },
      });
      ctx.agentMessage(outcome.outcome === 'selected' ? `chose:${outcome.optionId}` : 'cancelled');
    };

    it('asks the user with the agent options 1:1 and answers the agent with the selection', async () => {
      bridge.promptHandler = permissionScript;
      const input = runInput(agentThread(paired.id), { decide: (request) => ({ optionId: request.options[0]?.id ?? null }) });

      const events = await collect(agentBackend.run(input));

      expect(input.permissionRequests).toEqual([
        {
          toolCallId: 'c1',
          title: 'Run shell command',
          description: 'rm -rf build',
          options: [
            { id: 'allow', label: 'Allow once', kind: 'allow_once' },
            { id: 'reject', label: 'Reject', kind: 'reject_once' },
          ],
        },
      ]);
      expect(textOf(events)).toBe('chose:allow');
      expect(eventsOfType(events, 'tool-start')[0]).toMatchObject({
        toolCallId: 'c1',
        patch: { name: 'Run shell command', status: 'awaiting-approval', kind: 'execute' },
      });
      expect(eventsOfType(events, 'tool-update')[0]).toEqual({ type: 'tool-update', toolCallId: 'c1', patch: { status: 'running' } });
    });

    it('marks the tool rejected when the user rejects', async () => {
      bridge.promptHandler = permissionScript;
      const input = runInput(agentThread(paired.id), { decide: () => ({ optionId: 'reject' }) });

      const events = await collect(agentBackend.run(input));

      expect(textOf(events)).toBe('chose:reject');
      expect(eventsOfType(events, 'tool-update')[0]?.patch.status).toBe('rejected');
    });

    it('answers cancelled when the user dismisses the card', async () => {
      bridge.promptHandler = permissionScript;
      const input = runInput(agentThread(paired.id), { decide: () => ({ optionId: null }) });

      const events = await collect(agentBackend.run(input));

      expect(textOf(events)).toBe('cancelled');
    });

    it('answers cancelled for an option id the agent never offered', async () => {
      bridge.promptHandler = permissionScript;
      const input = runInput(agentThread(paired.id), { decide: () => ({ optionId: 'made-up' }) });

      const events = await collect(agentBackend.run(input));

      expect(textOf(events)).toBe('cancelled');
    });

    it('cancels the agent and the open permission question when the user stops the turn', async () => {
      let outcome: string | undefined;
      let sawCancel = false;
      bridge.promptHandler = async (ctx) => {
        const answer = await ctx.requestPermission({ toolCallId: 'c1', title: 'Danger', kind: 'execute' });
        outcome = answer.outcome;
        await ctx.cancelled;
        sawCancel = true;
        return 'cancelled';
      };
      const input = runInput(agentThread(paired.id), { decide: () => new Promise(() => undefined) });

      const pending = collect(agentBackend.run(input));
      await waitFor(() => input.permissionRequests.length === 1);
      input.controller.abort();
      const events = await pending;

      expect(outcome).toBe('cancelled');
      expect(sawCancel).toBe(true);
      expect(eventsOfType(events, 'turn-end')).toEqual([{ type: 'turn-end', stopReason: 'cancelled', seq: expect.any(Number) }]);
      await waitFor(
        () => bridge.lastConnection.fromClient.filter((message) => message.method === 'session/cancel').length === 1,
      );
    });

    it('reports a cancelled turn even when the agent says it ended normally', async () => {
      bridge.promptHandler = async (ctx) => {
        await ctx.cancelled;
        return 'end_turn';
      };
      const input = runInput(agentThread(paired.id));

      const pending = collect(agentBackend.run(input));
      await waitFor(() => bridge.connections.size === 1 && bridge.lastConnection.prompts().length === 1);
      input.controller.abort();
      const events = await pending;

      expect(eventsOfType(events, 'turn-end').map((event) => event.stopReason)).toEqual(['cancelled']);
    });

    it('holds the replay cursor back while a question is open so a restart would ask again', async () => {
      bridge.promptHandler = async (ctx) => {
        ctx.agentMessage('before ');
        await ctx.requestPermission({ toolCallId: 'c1', title: 'Danger', kind: 'execute' });
      };
      const input = runInput(agentThread(paired.id), { decide: () => new Promise(() => undefined) });
      const events: ChatEvent[] = [];
      const iterator = agentBackend.run(input)[Symbol.asyncIterator]();

      await pullUntil(iterator, events, (event) => event.type === 'tool-start');

      const connection = bridge.lastConnection;
      const request = connection.frames.find((frame) => frame.message.method === 'session/request_permission');
      expect(request).toBeDefined();
      const awaiting = events[events.length - 1];
      expect(awaiting?.seq).toBe((request?.seq ?? 0) - 1);

      input.controller.abort();
      await iterator.return?.(undefined);
    });
  });

  describe('agent requests the phone cannot serve', () => {
    it('answers fs and terminal requests with JSON-RPC -32601 so the agent does not hang', async () => {
      bridge.promptHandler = async (ctx) => {
        const read = await ctx.request('fs/read_text_file', { sessionId: ctx.sessionId, path: '/etc/hosts' });
        const terminal = await ctx.request('terminal/create', { sessionId: ctx.sessionId, command: 'ls' });
        const unknown = await ctx.request('vendor/custom', {});
        ctx.agentMessage([read.error?.code, terminal.error?.code, unknown.error?.code].join(','));
      };

      const events = await collect(agentBackend.run(runInput(agentThread(paired.id))));

      expect(textOf(events)).toBe('-32601,-32601,-32601');
    });

    it('ignores update variants it does not know and replayed user messages', async () => {
      bridge.promptHandler = async (ctx) => {
        ctx.update({ sessionUpdate: 'available_commands_update', availableCommands: [{ name: 'help', description: 'x' }] });
        ctx.update({ sessionUpdate: 'brand_new_variant_from_2027', payload: { nested: true } });
        ctx.update({ sessionUpdate: 'user_message_chunk', content: { type: 'text', text: 'echo of user' } });
        ctx.update({ sessionUpdate: 'config_option_update', configOptions: [] });
        ctx.agentMessage('visible');
        ctx.update({ sessionUpdate: 'agent_message_chunk', content: { type: 'image', data: 'AAAA', mimeType: 'image/png' } });
      };

      const events = await collect(agentBackend.run(runInput(agentThread(paired.id))));

      expect(visibleTypes(events)).toEqual(['text-delta', 'text-delta', 'turn-end']);
      expect(textOf(events)).toBe('visible[image]');
    });

    it('drops updates addressed to another session', async () => {
      bridge.promptHandler = async (ctx) => {
        ctx.update({ sessionUpdate: 'agent_message_chunk', content: { type: 'text', text: 'mine' } });
        bridge.lastConnection.emit({
          jsonrpc: '2.0',
          method: 'session/update',
          params: { sessionId: 'someone-else', update: { sessionUpdate: 'agent_message_chunk', content: { type: 'text', text: 'theirs' } } },
        });
      };

      const events = await collect(agentBackend.run(runInput(agentThread(paired.id))));

      expect(textOf(events)).toBe('mine');
    });
  });

  describe('surviving a flaky network', () => {
    async function startStreamingTurn() {
      bridge.promptHandler = async (ctx: PromptContext) => {
        ctx.agentMessage('one ');
        await ctx.gate('proceed');
        ctx.agentMessage('two ');
        ctx.agentMessage('three');
      };
      const input = runInput(agentThread(paired.id));
      const events: ChatEvent[] = [];
      const iterator = agentBackend.run(input)[Symbol.asyncIterator]();
      await pullUntil(iterator, events, (event) => event.type === 'text-delta');
      return { input, events, iterator };
    }

    it('keeps the turn alive across a dropped socket: no duplicated or missing text, one turn end, one prompt', async () => {
      const { input, events, iterator } = await startStreamingTurn();

      bridge.dropClients();
      await waitFor(() => bridge.socketsAccepted >= 2 && bridge.lastConnection.attached !== null);
      bridge.lastConnection.release('proceed');
      const error = await drain(iterator, events);

      expect(error).toBeNull();
      expect(textOf(events)).toBe('one two three');
      expect(eventsOfType(events, 'turn-end')).toHaveLength(1);
      expect(bridge.lastConnection.prompts()).toHaveLength(1);
      expect(input.statuses).toContain('Reconnecting to the bridge…');
      expect(input.statuses[input.statuses.length - 1]).toBeNull();
    });

    it('catches up on everything the agent did while the phone was offline', async () => {
      const { input, events, iterator } = await startStreamingTurn();

      bridge.rejectNewSockets = true;
      bridge.dropClients();
      await waitFor(() => bridge.lastConnection.attached === null);
      bridge.lastConnection.release('proceed');
      await waitFor(() => bridge.lastConnection.headSeq >= 5);
      await sleep(100);
      bridge.rejectNewSockets = false;
      const error = await drain(iterator, events);

      expect(error).toBeNull();
      expect(textOf(events)).toBe('one two three');
      expect(eventsOfType(events, 'turn-end')).toHaveLength(1);
      expect(bridge.lastConnection.prompts()).toHaveLength(1);
      expect(bridge.socketsAccepted).toBeGreaterThanOrEqual(3);
      expect(input.statuses.filter((status) => status === 'Reconnecting to the bridge…').length).toBeGreaterThanOrEqual(1);
    });

    it('delivers a permission answer given while offline once the socket is back', async () => {
      let outcome: string | undefined;
      bridge.promptHandler = async (ctx) => {
        const answer = await ctx.requestPermission({ toolCallId: 'c1', title: 'Allow?', kind: 'edit' });
        outcome = answer.outcome;
        ctx.agentMessage('done');
      };
      let decide: (value: { optionId: string }) => void = () => undefined;
      const input = runInput(agentThread(paired.id), {
        decide: () =>
          new Promise((resolve) => {
            decide = resolve;
          }),
      });
      const pending = collect(agentBackend.run(input));
      await waitFor(() => input.permissionRequests.length === 1);

      bridge.rejectNewSockets = true;
      bridge.dropClients();
      await waitFor(() => bridge.lastConnection.attached === null);
      decide({ optionId: 'allow' });
      await sleep(50);
      bridge.rejectNewSockets = false;
      const events = await pending;

      expect(outcome).toBe('selected');
      expect(textOf(events)).toBe('done');
      expect(input.permissionRequests).toHaveLength(1);
    });

    it('fails the turn with a clear message when the replay window was exceeded, then recovers on the next message', async () => {
      await bridge.stop();
      bridge = await FakeBridge.start({ replayMaxFrames: 5 });
      useAgentBridgeStore.setState({ bridges: [] });
      paired = await pairFakeBridge(bridge);
      bridge.promptHandler = async (ctx) => {
        ctx.agentMessage('one ');
        await ctx.gate('flood');
        for (let index = 0; index < 12; index += 1) ctx.agentMessage(`x${index} `);
      };
      const input = runInput(agentThread(paired.id));
      const events: ChatEvent[] = [];
      const iterator = agentBackend.run(input)[Symbol.asyncIterator]();
      await pullUntil(iterator, events, (event) => event.type === 'text-delta');
      const firstConnection = bridge.lastConnection;

      bridge.rejectNewSockets = true;
      bridge.dropClients();
      await waitFor(() => firstConnection.attached === null);
      firstConnection.release('flood');
      await waitFor(() => firstConnection.headSeq >= 14);
      await sleep(100);
      bridge.rejectNewSockets = false;
      const error = await drain(iterator, events);

      expect(error?.message).toMatch(/no longer has this agent's output/);
      expect(eventsOfType(events, 'turn-end')).toHaveLength(0);
      expect(firstConnection.prompts()).toHaveLength(1);

      bridge.promptHandler = null;
      const backend = foldBackend(requireBackend(agentThread(paired.id)), events);
      const next = await collect(
        agentBackend.run(runInput(threadWithBackend(agentThread(paired.id, {}, 'next'), backend), { text: 'next' })),
      );

      expect(textOf(next)).toBe('Echo: next');
      expect(bridge.connections.size).toBe(2);
      expect(methodsFromClient(bridge)).toEqual(['initialize', 'session/load', 'session/prompt']);
      expect(firstConnection.prompts()).toHaveLength(1);
    });

    it('ends the turn with an error when the agent process dies', async () => {
      bridge.promptHandler = async (ctx) => {
        ctx.agentMessage('partial ');
        await ctx.gate('never');
      };
      const events: ChatEvent[] = [];
      const iterator = agentBackend.run(runInput(agentThread(paired.id)))[Symbol.asyncIterator]();
      await pullUntil(iterator, events, (event) => event.type === 'text-delta');
      const connection = bridge.lastConnection;

      connection.exit(137);
      const error = await drain(iterator, events);

      expect(error?.message).toMatch(/agent process exited \(code 137\)/);
      expect(textOf(events)).toBe('partial ');
    });

    it('starts a fresh agent for the next message after the agent died', async () => {
      bridge.promptHandler = async (ctx) => {
        ctx.agentMessage('partial ');
        await ctx.gate('never');
      };
      const events: ChatEvent[] = [];
      const iterator = agentBackend.run(runInput(agentThread(paired.id)))[Symbol.asyncIterator]();
      await pullUntil(iterator, events, (event) => event.type === 'text-delta');
      bridge.lastConnection.exit(1);
      await drain(iterator, events);
      bridge.promptHandler = null;
      const backend = foldBackend(requireBackend(agentThread(paired.id)), events);

      const next = await collect(
        agentBackend.run(runInput(threadWithBackend(agentThread(paired.id, {}, 'again'), backend), { text: 'again' })),
      );

      expect(textOf(next)).toBe('Echo: again');
      expect(methodsFromClient(bridge)).toEqual(['initialize', 'session/load', 'session/prompt']);
    });
  });

  describe('resume after the app was killed', () => {
    async function startAndKill(script: (ctx: PromptContext) => Promise<void>) {
      bridge.promptHandler = script;
      const base = agentThread(paired.id);
      const input = runInput(base);
      const events: ChatEvent[] = [];
      const iterator = agentBackend.run(input)[Symbol.asyncIterator]();
      await pullUntil(iterator, events, (event) => event.type === 'text-delta');
      const connection = bridge.lastConnection;
      const persisted = foldBackend(requireBackend(base), events);
      releaseAgentConnection(THREAD_ID, { kill: false });
      return { base, connection, persisted, seenBeforeKill: events };
    }

    function resumeInput(base: ReturnType<typeof agentThread>, persisted: AgentBackendState) {
      const { thread, signal, requestPermission, reportStatus, controller, statuses, permissionRequests } = runInput(
        threadWithBackend(base, persisted),
      );
      return { thread, signal, requestPermission, reportStatus, controller, statuses, permissionRequests };
    }

    it('persists a pending prompt id and replay cursor with the first events', async () => {
      const { persisted, seenBeforeKill } = await startAndKill(async (ctx) => {
        ctx.agentMessage('before ');
        await ctx.gate('go');
      });

      expect(persisted.pendingPromptId).toEqual(expect.any(Number));
      expect(persisted.connectionId).toBe(bridge.lastConnection.id);
      expect(persisted.lastSeq).toBe(seenBeforeKill[seenBeforeKill.length - 1]?.seq);
    });

    it('finishes a turn the agent completed while the app was dead, without repeating what was already shown', async () => {
      const { base, connection, persisted } = await startAndKill(async (ctx) => {
        ctx.agentMessage('before ');
        await ctx.gate('go');
        ctx.agentMessage('after ');
        ctx.agentMessage('death');
      });
      connection.release('go');
      await waitFor(() => connection.frames.some((frame) => frame.message.result !== undefined && frame.message.id !== undefined && frame.message.method === undefined && JSON.stringify(frame.message).includes('stopReason')));

      const events = await collect(agentBackend.resume?.(resumeInput(base, persisted)) ?? (async function* () { /* unsupported */ })());

      expect(textOf(events)).toBe('after death');
      expect(visibleTypes(events)).toEqual(['text-delta', 'text-delta', 'turn-end']);
      expect(eventsOfType(events, 'turn-end')).toEqual([{ type: 'turn-end', stopReason: 'end_turn', seq: connection.headSeq }]);
      expect(connection.prompts()).toHaveLength(1);
      expect(foldBackend(persisted, events).pendingPromptId).toBeUndefined();
    });

    it('keeps following a turn that is still running and finishes when the agent answers', async () => {
      const { base, connection, persisted } = await startAndKill(async (ctx) => {
        ctx.agentMessage('before ');
        await ctx.gate('go');
        ctx.agentMessage('after');
        return 'max_tokens';
      });

      const input = resumeInput(base, persisted);
      const pending = collect(agentBackend.resume?.(input) ?? (async function* () { /* unsupported */ })());
      await waitFor(() => connection.attached !== null);
      connection.release('go');
      const events = await pending;

      expect(textOf(events)).toBe('after');
      expect(eventsOfType(events, 'turn-end').map((event) => event.stopReason)).toEqual(['max_tokens']);
      expect(connection.prompts()).toHaveLength(1);
    });

    it('re-asks a permission question that was still open when the app died', async () => {
      let outcome: string | undefined;
      const { base, connection, persisted } = await startAndKill(async (ctx) => {
        ctx.agentMessage('before ');
        await ctx.gate('ask');
        const answer = await ctx.requestPermission({ toolCallId: 'c1', title: 'Allow?', kind: 'edit' });
        outcome = answer.outcome === 'selected' ? answer.optionId : answer.outcome;
        ctx.agentMessage('after');
      });
      connection.release('ask');
      await waitFor(() => connection.frames.some((frame) => frame.message.method === 'session/request_permission'));

      const input = { ...resumeInput(base, persisted) };
      const events = await collect(agentBackend.resume?.(input) ?? (async function* () { /* unsupported */ })());

      expect(input.permissionRequests).toHaveLength(1);
      expect(input.permissionRequests[0]?.title).toBe('Allow?');
      expect(outcome).toBe('allow');
      expect(textOf(events)).toBe('after');
      expect(eventsOfType(events, 'turn-end')).toHaveLength(1);
    });

    it('stops following when the user cancels while re-attached', async () => {
      const { base, persisted } = await startAndKill(async (ctx) => {
        ctx.agentMessage('before ');
        await ctx.cancelled;
        return 'cancelled';
      });

      const input = resumeInput(base, persisted);
      const pending = collect(agentBackend.resume?.(input) ?? (async function* () { /* unsupported */ })());
      await waitFor(() => bridge.lastConnection.attached !== null);
      input.controller.abort();
      const events = await pending;

      expect(eventsOfType(events, 'turn-end').map((event) => event.stopReason)).toEqual(['cancelled']);
      await waitFor(
        () => bridge.lastConnection.fromClient.filter((message) => message.method === 'session/cancel').length === 1,
      );
    });

    it('fails clearly when the bridge no longer has the agent', async () => {
      const { base, persisted } = await startAndKill(async (ctx) => {
        ctx.agentMessage('before ');
        await ctx.gate('go');
      });
      bridge.connections.clear();

      const { error, events } = await drive(agentBackend.resume?.(resumeInput(base, persisted)) ?? (async function* () { /* unsupported */ })());

      expect(error?.message).toMatch(/no longer running on the bridge/);
      expect(events).toEqual([]);
    });

    it('ends immediately when there is no pending prompt to follow', async () => {
      const thread = agentThread(paired.id, { connectionId: 'conn_1' });
      const input = runInput(thread);

      const events = await collect(agentBackend.resume?.(input) ?? (async function* () { /* unsupported */ })());

      expect(events).toEqual([{ type: 'turn-end', stopReason: 'end_turn' }]);
      expect(bridge.socketsAccepted).toBe(0);
    });
  });
});
