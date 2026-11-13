import type { JsonRpcMessage } from '../../../bridge/src/protocol';
import { agentBackend, releaseAgentConnection } from '../../../src/services/chat/backends/agentBackend';
import type { AgentBridge } from '../../../src/services/agent/types';
import { useAgentBridgeStore } from '../../../src/stores/agentBridgeStore';
import {
  agentThread,
  collect,
  drive,
  eventsOfType,
  installNodeWebSocket,
  pairFakeBridge,
  runInput,
  textOf,
  waitFor,
} from '../../helpers/agentChat';
import { FakeBridge } from '../../helpers/fakeBridge';

jest.mock('../../../src/services/ContextService', () => ({
  getFileContent: jest.fn(async (_owner: string, _repo: string, _branch: string, path: string) => ({
    content: `body of ${path}`,
    name: path,
    size: 10,
    truncated: false,
  })),
  getFolderContents: jest.fn(async () => []),
  getRepoStructure: jest.fn(async () => []),
  getLocalNotesForContext: jest.fn(() => 'the note body'),
  getLocalTodosForContext: jest.fn(() => 'the todo body'),
  isBinaryFile: jest.fn(() => false),
}));

jest.mock('../../../src/services/chat/imageStorage', () => ({
  readImageBase64: jest.fn(async () => 'BASE64DATA'),
}));

/** The client's answer to the agent's `elicitation/create` request. */
function elicitationResponse(bridge: FakeBridge): unknown {
  const request = bridge.lastConnection.frames.find((frame) => frame.message.method === 'elicitation/create');
  const response = bridge.lastConnection.fromClient.find((message) => message.id === request?.message.id);
  return response?.result;
}

function promptText(blocks: Array<Record<string, unknown>>): string {
  return blocks
    .filter((block) => block.type === 'text')
    .map((block) => String(block.text ?? ''))
    .join('\n');
}

const CONFIG_OPTIONS = [
  {
    id: 'model',
    name: 'Model',
    type: 'select',
    currentValue: 'sonnet',
    options: [
      { value: 'sonnet', name: 'Sonnet' },
      { value: 'opus', name: 'Opus' },
    ],
  },
];

describe('agentBackend parity', () => {
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
    releaseAgentConnection('thread-1');
    await bridge.stop();
    useAgentBridgeStore.setState({ bridges: [] });
  });

  it('advertises elicitation and config option capabilities but no fs or terminal', async () => {
    await collect(agentBackend.run(runInput(agentThread(paired.id))));
    const initialize = bridge.lastConnection.fromClient.find((message) => message.method === 'initialize');
    expect(initialize?.params).toMatchObject({
      clientCapabilities: {
        fs: { readTextFile: false, writeTextFile: false },
        terminal: false,
        elicitation: { form: {}, url: {} },
        session: { configOptions: { boolean: {} } },
      },
    });
  });

  it('reports the agent image capability in the agent state', async () => {
    await bridge.stop();
    bridge = await FakeBridge.start({ agentPromptCapabilities: { image: true, embeddedContext: true } });
    paired = await pairFakeBridge(bridge);

    const events = await collect(agentBackend.run(runInput(agentThread(paired.id))));
    const state = eventsOfType(events, 'agent-state')[0];
    expect(state).toMatchObject({ supportsImages: true, supportsEmbeddedContext: true });
  });

  it('parses the config options of a new session', async () => {
    await bridge.stop();
    bridge = await FakeBridge.start({ agentConfigOptions: CONFIG_OPTIONS });
    paired = await pairFakeBridge(bridge);

    const events = await collect(agentBackend.run(runInput(agentThread(paired.id))));
    const state = eventsOfType(events, 'agent-state')[0];
    expect(state?.configOptions).toEqual([
      {
        id: 'model',
        name: 'Model',
        type: 'select',
        currentValue: 'sonnet',
        options: [
          { value: 'sonnet', name: 'Sonnet' },
          { value: 'opus', name: 'Opus' },
        ],
      },
    ]);
  });

  it('sets a config option and returns the agent list', async () => {
    await bridge.stop();
    bridge = await FakeBridge.start({ agentConfigOptions: CONFIG_OPTIONS });
    paired = await pairFakeBridge(bridge);

    const thread = agentThread(paired.id);
    const options = await agentBackend.setConfigOption?.(thread, 'model', 'opus');
    const request = bridge.lastConnection.fromClient.find((message) => message.method === 'session/set_config_option');
    expect(request?.params).toMatchObject({ configId: 'model', value: 'opus' });
    expect(options?.[0]?.currentValue).toBe('opus');
  });

  it('keeps the local value when the agent does not report the option list', async () => {
    await bridge.stop();
    bridge = await FakeBridge.start({ agentConfigOptions: CONFIG_OPTIONS, omitConfigOptionsInSetResponse: true });
    paired = await pairFakeBridge(bridge);

    const options = await agentBackend.setConfigOption?.(agentThread(paired.id), 'model', 'opus');
    expect(options?.[0]?.currentValue).toBe('opus');
  });

  it('sends the note content as an embedded resource', async () => {
    await bridge.stop();
    bridge = await FakeBridge.start({ agentPromptCapabilities: { embeddedContext: true } });
    paired = await pairFakeBridge(bridge);

    const input = runInput(agentThread(paired.id));
    input.contexts = [{ type: 'local-notes', owner: '', repo: '', path: 'note-1', name: 'Note' }];
    await collect(agentBackend.run(input));

    const prompt = bridge.lastConnection.prompts()[0]?.params as { prompt: Array<Record<string, unknown>> };
    const resource = prompt.prompt.find((block) => block.type === 'resource');
    expect(resource).toMatchObject({
      type: 'resource',
      resource: { uri: 'gitnotes://note/note-1', mimeType: 'text/markdown', text: 'the note body' },
    });
  });

  it('falls back to text when the agent cannot take embedded context', async () => {
    await bridge.stop();
    bridge = await FakeBridge.start({ agentPromptCapabilities: { embeddedContext: false } });
    paired = await pairFakeBridge(bridge);

    const input = runInput(agentThread(paired.id));
    input.contexts = [{ type: 'local-notes', owner: '', repo: '', path: 'note-1', name: 'Note' }];
    await collect(agentBackend.run(input));

    const prompt = bridge.lastConnection.prompts()[0]?.params as { prompt: Array<Record<string, unknown>> };
    expect(prompt.prompt.some((block) => block.type === 'resource')).toBe(false);
    expect(promptText(prompt.prompt)).toContain('the note body');
  });

  it('sends image blocks when the agent accepts images', async () => {
    await bridge.stop();
    bridge = await FakeBridge.start({ agentPromptCapabilities: { image: true } });
    paired = await pairFakeBridge(bridge);

    const input = runInput(agentThread(paired.id));
    input.images = [{ id: 'i1', uri: 'file:///docs/i1.png', mimeType: 'image/png' }];
    await collect(agentBackend.run(input));

    const prompt = bridge.lastConnection.prompts()[0]?.params as { prompt: Array<Record<string, unknown>> };
    expect(prompt.prompt).toContainEqual({ type: 'image', data: 'BASE64DATA', mimeType: 'image/png' });
  });

  it('drops images with a note when the agent cannot take them', async () => {
    const input = runInput(agentThread(paired.id));
    input.images = [{ id: 'i1', uri: 'file:///docs/i1.png', mimeType: 'image/png' }];
    await collect(agentBackend.run(input));

    const prompt = bridge.lastConnection.prompts()[0]?.params as { prompt: Array<Record<string, unknown>> };
    expect(prompt.prompt.some((block) => block.type === 'image')).toBe(false);
    expect(promptText(prompt.prompt)).toContain('does not accept images');
  });

  describe('elicitation', () => {
    const form = {
      message: 'Which runner?',
      requestedSchema: {
        type: 'object',
        properties: {
          runner: { type: 'string', enum: ['jest', 'vitest'], title: 'Runner' },
          notes: { type: 'string', title: 'Notes' },
        },
        required: ['runner'],
      },
    };

    it('asks the user and answers the agent with the form values', async () => {
      bridge.promptHandler = async (ctx) => {
        const response = await ctx.request('elicitation/create', { ...form, sessionId: ctx.sessionId });
        return JSON.stringify(response.result);
      };

      const input = runInput(agentThread(paired.id), {
        decideElicitation: () => ({ action: 'accept', content: { runner: 'jest', notes: 'hi' } }),
      });
      const events = await collect(agentBackend.run(input));

      expect(input.elicitationRequests).toHaveLength(1);
      expect(input.elicitationRequests[0]).toMatchObject({ mode: 'form', message: 'Which runner?' });
      expect(elicitationResponse(bridge)).toEqual({ action: 'accept', content: { runner: 'jest', notes: 'hi' } });
    });

    it('answers decline when the user says no', async () => {
      bridge.promptHandler = async (ctx) => {
        const response = await ctx.request('elicitation/create', { ...form, sessionId: ctx.sessionId });
        return JSON.stringify(response.result);
      };
      const input = runInput(agentThread(paired.id), { decideElicitation: () => ({ action: 'decline' }) });
      await collect(agentBackend.run(input));
      expect(elicitationResponse(bridge)).toEqual({ action: 'decline' });
    });

    it('answers cancel when the user dismisses the question', async () => {
      bridge.promptHandler = async (ctx) => {
        const response = await ctx.request('elicitation/create', { ...form, sessionId: ctx.sessionId });
        return JSON.stringify(response.result);
      };
      const input = runInput(agentThread(paired.id), { decideElicitation: () => ({ action: 'cancel' }) });
      await collect(agentBackend.run(input));
      expect(elicitationResponse(bridge)).toEqual({ action: 'cancel' });
    });

    it('answers cancel when the turn is aborted', async () => {
      bridge.promptHandler = async (ctx) => {
        const response = await ctx.request('elicitation/create', { ...form, sessionId: ctx.sessionId });
        return JSON.stringify(response.result);
      };
      const input = runInput(agentThread(paired.id), { decideElicitation: () => new Promise(() => undefined) });
      const iterator = agentBackend.run(input)[Symbol.asyncIterator]();
      const pulling = (async () => {
        for (;;) {
          const step = await iterator.next();
          if (step.done) return;
        }
      })();
      await waitFor(() => input.elicitationRequests.length > 0);
      input.controller.abort();
      await pulling;
      expect(elicitationResponse(bridge)).toEqual({ action: 'cancel' });
    }, 15000);

    it('rejects an elicitation for another session', async () => {
      bridge.promptHandler = async (ctx) => {
        const response = await ctx.request('elicitation/create', { ...form, sessionId: 'other' });
        return JSON.stringify(response.result);
      };
      const input = runInput(agentThread(paired.id));
      await collect(agentBackend.run(input));
      expect(input.elicitationRequests).toHaveLength(0);
      expect(elicitationResponse(bridge)).toEqual({ action: 'cancel' });
    });

    it('holds the replay cursor back while the question is open', async () => {
      bridge.promptHandler = async (ctx) => {
        ctx.agentMessage('before ');
        await ctx.request('elicitation/create', form);
      };
      const input = runInput(agentThread(paired.id), { decideElicitation: () => new Promise(() => undefined) });
      const iterator = agentBackend.run(input)[Symbol.asyncIterator]();
      const events = [];
      for (;;) {
        const step = await iterator.next();
        if (step.done) throw new Error('ended too early');
        events.push(step.value);
        if (input.elicitationRequests.length > 0) break;
      }
      const request = bridge.lastConnection.frames.find((frame) => frame.message.method === 'elicitation/create');
      expect(events[events.length - 1]?.seq).toBe((request?.seq ?? 0) - 1);
      input.controller.abort();
      await iterator.return?.(undefined);
    });
  });

  it('reports the agent failure when a config option cannot be set', async () => {
    bridge.rejectConfigOptions = true;
    const response = await agentBackend.setConfigOption?.(agentThread(paired.id), 'model', 'opus').catch((error: Error) => error);
    expect(response).toBeInstanceOf(Error);
  });
});
