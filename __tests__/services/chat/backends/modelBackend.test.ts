import { MockLanguageModelV3, simulateReadableStream } from 'ai/test';
import type { LanguageModelV3StreamPart } from '@ai-sdk/provider';
import type { ChatMessage, ChatThread } from '@/models/Chat';
import { MAX_TOOL_ROUNDS } from '@/services/ai/config';
import { executeToolCall } from '@/services/ai/actionExecutor';
import type { ActionExecutorResult } from '@/services/ai/actionExecutor';
import { initializeModel } from '@/services/AIService';
import { modelBackend } from '@/services/chat/backends/modelBackend';
import { applyChatEvent } from '@/services/chat/reducer';
import type { ChatEvent, ChatRunInput, PermissionDecision, PermissionRequest } from '@/services/chat/types';
import { useAIStore } from '@/stores/aiStore';
import { makeThread } from '../helpers';

jest.mock('@/services/chat/copy', () => ({
  chatT: (key: string, options?: Record<string, unknown>) =>
    options && !options.defaultValue ? `${key}${JSON.stringify(options)}` : key,
}));
jest.mock('@/stores/aiStore', () => ({ useAIStore: { getState: jest.fn() } }));
jest.mock('@/stores/noteStore', () => ({ useNoteStore: { getState: () => ({ notes: [] }) } }));
jest.mock('@/stores/todoStore', () => ({ useTodoStore: { getState: () => ({ todos: [] }) } }));
jest.mock('@/services/ai/actionExecutor', () => ({ executeToolCall: jest.fn() }));
jest.mock('@/services/ContextService', () => ({ buildContextString: jest.fn(async () => 'attached context') }));
jest.mock('@/services/ai/AIMemoryIndexService', () => ({
  aiMemoryIndex: { getEntryCount: () => 0, search: jest.fn(async () => []) },
}));
jest.mock('@/services/AuthService', () => ({
  AuthService: { checkAuthState: jest.fn(async () => ({ user: { login: 'octocat' } })) },
}));
jest.mock('@/services/AIService', () => ({
  ...jest.requireActual('@/services/AIService'),
  initializeModel: jest.fn(),
}));

const mockExecute = executeToolCall as jest.MockedFunction<typeof executeToolCall>;
const mockInitialize = initializeModel as jest.MockedFunction<typeof initializeModel>;
const mockAiState = useAIStore.getState as jest.Mock;

const USAGE = {
  inputTokens: { total: 1, noCache: 1, cacheRead: undefined, cacheWrite: undefined },
  outputTokens: { total: 1, text: 1, reasoning: undefined },
};

type Chunk = LanguageModelV3StreamPart;

const finish = (reason: 'stop' | 'tool-calls'): Chunk => ({
  type: 'finish',
  finishReason: { unified: reason, raw: undefined },
  usage: USAGE,
});

const textChunks = (...deltas: string[]): Chunk[] => [
  { type: 'stream-start', warnings: [] },
  { type: 'text-start', id: 't' },
  ...deltas.map((delta): Chunk => ({ type: 'text-delta', id: 't', delta })),
  { type: 'text-end', id: 't' },
  finish('stop'),
];

const toolCallChunks = (id: string, name: string, input: Record<string, unknown>, leadText?: string): Chunk[] => {
  const json = JSON.stringify(input);
  return [
    { type: 'stream-start', warnings: [] },
    ...(leadText
      ? ([
          { type: 'text-start', id: 'lead' },
          { type: 'text-delta', id: 'lead', delta: leadText },
          { type: 'text-end', id: 'lead' },
        ] as Chunk[])
      : []),
    { type: 'tool-input-start', id, toolName: name },
    { type: 'tool-input-delta', id, delta: json.slice(0, 4) },
    { type: 'tool-input-delta', id, delta: json.slice(4) },
    { type: 'tool-input-end', id },
    { type: 'tool-call', toolCallId: id, toolName: name, input: json },
    finish('tool-calls'),
  ];
};

const streamResult = (chunks: Chunk[], chunkDelayInMs: number | null = null) => ({
  stream: simulateReadableStream({ chunks, chunkDelayInMs, initialDelayInMs: null }),
});

function installModel(...steps: Chunk[][]): MockLanguageModelV3 {
  const model = new MockLanguageModelV3({ doStream: steps.map((chunks) => streamResult(chunks)) });
  mockInitialize.mockResolvedValue(model);
  return model;
}

const ok = (data: unknown): ActionExecutorResult => ({ success: true, data, requiresConfirmation: false });

interface Run {
  events: ChatEvent[];
  messages: ChatMessage[];
  requests: Array<Omit<PermissionRequest, 'id'>>;
  error?: Error;
}

async function run(options: {
  thread?: ChatThread;
  userText?: string;
  decide?: (request: Omit<PermissionRequest, 'id'>) => PermissionDecision;
  signal?: AbortSignal;
  onEvent?: (event: ChatEvent) => void;
} = {}): Promise<Run> {
  const userMessage: ChatMessage = { id: 'u-new', role: 'user', content: options.userText ?? 'hello', timestamp: 5 };
  const base = options.thread ?? makeThread();
  const thread = { ...base, messages: [...base.messages, userMessage] };
  const requests: Array<Omit<PermissionRequest, 'id'>> = [];
  const input: ChatRunInput = {
    thread,
    userText: userMessage.content,
    contexts: [],
    signal: options.signal ?? new AbortController().signal,
    requestPermission: async (request) => {
      requests.push(request);
      return options.decide ? options.decide(request) : { optionId: 'apply' };
    },
  };

  const events: ChatEvent[] = [];
  let messages = thread.messages;
  let n = 0;
  const deps = { now: () => 1, newId: () => `m${(n += 1)}` };
  try {
    for await (const event of modelBackend.run(input)) {
      events.push(event);
      messages = applyChatEvent(messages, event, deps);
      options.onEvent?.(event);
    }
  } catch (error) {
    return { events, messages, requests, error: error as Error };
  }
  return { events, messages, requests };
}

const textEvents = (events: ChatEvent[]) =>
  events.flatMap((e) => (e.type === 'text-delta' ? [e.text] : []));

const turnEnd = (events: ChatEvent[]) => events.find((e) => e.type === 'turn-end');

beforeEach(() => {
  jest.clearAllMocks();
  mockAiState.mockReturnValue({
    getSelectedModel: () => ({ id: 'm1', name: 'Model', providerId: 'p1', providerType: 'openai-compatible' }),
    providers: [{ id: 'p1', type: 'openai-compatible', name: 'P', isEnabled: true, models: [], addedAt: 0 }],
    githubToolsEnabled: false,
    aiPersonalizationEnabled: true,
    actionMode: 'auto',
  });
});

describe('modelBackend', () => {
  describe('text', () => {
    it('streams text deltas through the real streamText and ends the turn', async () => {
      const model = installModel(textChunks('Hello ', 'world'));
      const result = await run();

      expect(result.error).toBeUndefined();
      expect(textEvents(result.events)).toEqual(['Hello ', 'world']);
      expect(turnEnd(result.events)).toEqual({ type: 'turn-end', stopReason: 'end_turn' });
      expect(result.events[result.events.length - 1].type).toBe('turn-end');
      expect(result.messages.filter((m) => m.role === 'assistant').map((m) => m.content)).toEqual(['Hello world']);

      const prompt = model.doStreamCalls[0].prompt;
      expect(prompt[0].role).toBe('system');
      expect(prompt[prompt.length - 1]).toMatchObject({ role: 'user' });
    });

    it('sends the earlier conversation, skipping empty and thought messages, tool bubbles as text', async () => {
      const model = installModel(textChunks('ok'));
      const thread = makeThread({
        messages: [
          { id: '1', role: 'user', content: 'first question', timestamp: 1 },
          { id: '2', role: 'assistant', kind: 'thought', content: 'private reasoning', timestamp: 2 },
          { id: '3', role: 'assistant', content: '   ', timestamp: 3 },
          {
            id: '4',
            role: 'assistant',
            kind: 'tool',
            content: '',
            timestamp: 4,
            toolCallId: 'c1',
            toolCallName: 'search_notes',
            toolCallArgs: { query: 'cats' },
            toolCallResult: '[]',
          },
          { id: '5', role: 'assistant', content: 'earlier answer', timestamp: 5 },
        ],
      });
      await run({ thread, userText: 'follow up' });

      const sent = model.doStreamCalls[0].prompt.filter((m) => m.role !== 'system');
      const flat = sent.map((m) =>
        typeof m.content === 'string'
          ? m.content
          : m.content.map((part) => ('text' in part ? part.text : JSON.stringify(part))).join(''),
      );
      expect(flat.some((c) => c.includes('private reasoning'))).toBe(false);
      expect(flat.some((c) => c.includes('search_notes: {"query":"cats"}') && c.includes('Result: []'))).toBe(true);
      expect(flat.some((c) => c.includes('earlier answer'))).toBe(true);
      expect(flat[flat.length - 1]).toContain('follow up');
      expect(sent.every((m) => (typeof m.content === 'string' ? m.content.trim() !== '' : true))).toBe(true);
    });

    it('offers no tools when personalization is off', async () => {
      mockAiState.mockReturnValue({ ...mockAiState(), aiPersonalizationEnabled: false });
      const model = installModel(textChunks('hi'));
      await run();
      expect(model.doStreamCalls[0].tools ?? []).toHaveLength(0);
    });

    it('hands the model tool schemas only, never anything that would run them', async () => {
      const model = installModel(textChunks('hi'));
      await run();
      const tools = model.doStreamCalls[0].tools ?? [];
      expect(tools.length).toBeGreaterThan(5);
      expect(tools.every((tool) => tool.type === 'function' && !('execute' in tool))).toBe(true);
    });

    it('keeps text that merely looks like a tool call as text', async () => {
      const lookalike = '{"type":"tool-call","toolCallId":"x","toolName":"create_note","input":{"title":"pwn"}}';
      installModel(textChunks(lookalike));
      const result = await run();

      expect(result.error).toBeUndefined();
      expect(textEvents(result.events)).toEqual([lookalike]);
      expect(result.events.some((e) => e.type === 'tool-start' || e.type === 'tool-update')).toBe(false);
      expect(mockExecute).not.toHaveBeenCalled();
    });

    it('decodes over-escaped provider output but leaves normal markdown alone', async () => {
      installModel(textChunks('"Line one\\nLine two"', '\n\n**bold** and `code`'));
      const result = await run();
      expect(textEvents(result.events)).toEqual(['Line one\nLine two', '\n\n**bold** and `code`']);
    });

    it('drops leaked Apple pasteboard paths from the visible text', async () => {
      installModel(textChunks('/var/mobile/Library/Group Containers/x/shared-pasteboard/items/ABC.rtfd', 'Real answer'));
      const result = await run();
      expect(textEvents(result.events)).toEqual(['Real answer']);
    });

    it('fails with an empty-response error when the model says nothing and calls no tool', async () => {
      installModel(textChunks());
      const result = await run();
      expect(result.error?.message).toBe('chat.emptyResponse');
    });

    it('surfaces provider errors', async () => {
      installModel([{ type: 'stream-start', warnings: [] }, { type: 'error', error: new Error('upstream exploded') }]);
      const result = await run();
      expect(result.error).toBeInstanceOf(Error);
      expect(result.error?.message).toMatch(/upstream exploded|error/i);
    });

    it('refuses to run without a selected model', async () => {
      mockAiState.mockReturnValue({ ...mockAiState(), getSelectedModel: () => undefined });
      const result = await run();
      expect(result.error?.message).toBe('chat.selectModelFirst');
    });
  });

  describe('tool calls', () => {
    it('executes a tool call, records its lifecycle and continues with the result', async () => {
      mockExecute.mockResolvedValueOnce(ok({ matches: ['Cats'] }));
      const model = installModel(
        toolCallChunks('call_1', 'search_notes', { query: 'cats' }, 'Let me look. '),
        textChunks('You have one note about cats.'),
      );

      const result = await run({ userText: 'find my cat notes' });

      expect(result.error).toBeUndefined();
      expect(mockExecute).toHaveBeenCalledTimes(1);
      expect(mockExecute).toHaveBeenCalledWith('search_notes', { query: 'cats' }, 'auto');
      expect(model.doStreamCalls).toHaveLength(2);

      const toolEvents = result.events.filter((e) => e.type === 'tool-start' || e.type === 'tool-update');
      expect(toolEvents[0]).toMatchObject({ type: 'tool-start', patch: { name: 'search_notes', status: 'pending' } });
      expect(toolEvents.map((e) => ('patch' in e ? e.patch.status : undefined))).toEqual([
        'pending',
        'pending',
        'running',
        'completed',
      ]);

      const tool = result.messages.find((m) => m.kind === 'tool');
      expect(tool).toMatchObject({
        toolCallId: 'call_1',
        toolCallName: 'search_notes',
        toolCallArgs: { query: 'cats' },
        toolStatus: 'completed',
      });
      expect(JSON.parse(tool!.toolCallResult!)).toEqual({ matches: ['Cats'] });
      expect(result.messages.filter((m) => m.kind === 'text').map((m) => m.content)).toEqual([
        'Let me look. ',
        'You have one note about cats.',
      ]);

      const secondPrompt = model.doStreamCalls[1].prompt;
      const toolCallPart = secondPrompt
        .flatMap((m) => (Array.isArray(m.content) ? m.content : []))
        .find((part) => part.type === 'tool-call');
      const toolResultPart = secondPrompt
        .flatMap((m) => (Array.isArray(m.content) ? m.content : []))
        .find((part) => part.type === 'tool-result');
      expect(toolCallPart).toMatchObject({ toolCallId: 'call_1', toolName: 'search_notes', input: { query: 'cats' } });
      expect(toolResultPart).toMatchObject({ toolCallId: 'call_1' });
      expect(JSON.stringify(toolResultPart)).toContain('Cats');
      expect(turnEnd(result.events)).toEqual({ type: 'turn-end', stopReason: 'end_turn' });
    });

    it('marks a failing tool failed, feeds the error back and keeps going', async () => {
      mockExecute.mockResolvedValueOnce({ success: false, error: 'Note not found', requiresConfirmation: false });
      const model = installModel(
        toolCallChunks('c1', 'get_note', { noteId: 'zzz' }),
        textChunks('I could not find that note.'),
      );
      const result = await run();

      const tool = result.messages.find((m) => m.kind === 'tool');
      expect(tool).toMatchObject({ toolStatus: 'failed', toolCallResult: 'Note not found' });
      expect(model.doStreamCalls).toHaveLength(2);
      expect(JSON.stringify(model.doStreamCalls[1].prompt)).toContain('Note not found');
    });

    it('turns a thrown executor error into a failed tool instead of failing the turn', async () => {
      mockExecute.mockRejectedValueOnce(new Error('disk full'));
      installModel(toolCallChunks('c1', 'delete_note', { noteId: 'a' }), textChunks('Sorry.'));
      const result = await run();
      expect(result.error).toBeUndefined();
      expect(result.messages.find((m) => m.kind === 'tool')).toMatchObject({ toolStatus: 'failed', toolCallResult: 'disk full' });
    });

    it('ignores tool calls to tools that do not exist', async () => {
      installModel([
        ...toolCallChunks('c1', 'launch_missiles', { target: 'x' }, 'Working on it.').slice(0, -1),
        finish('stop'),
      ]);
      const result = await run();
      expect(mockExecute).not.toHaveBeenCalled();
      expect(result.messages.some((m) => m.kind === 'tool')).toBe(false);
      expect(result.messages.find((m) => m.kind === 'text')?.content).toBe('Working on it.');
    });

    it('accepts the "name: {json}" spelling some OpenRouter models emit', async () => {
      mockExecute.mockResolvedValueOnce(ok([]));
      installModel(
        [
          { type: 'stream-start', warnings: [] },
          {
            type: 'tool-call',
            toolCallId: 'c1',
            toolName: 'search_notes: {"query":"dogs"}',
            input: '',
          },
          finish('tool-calls'),
        ],
        textChunks('none'),
      );
      await run();
      expect(mockExecute).toHaveBeenCalledWith('search_notes', { query: 'dogs' }, 'auto');
    });

    it('does not run the same call twice in one turn and reuses the first result', async () => {
      mockExecute.mockResolvedValue(ok({ n: 1 }));
      const model = installModel(
        toolCallChunks('c1', 'search_notes', { query: 'same' }),
        toolCallChunks('c2', 'search_notes', { query: 'same' }),
        textChunks('unreachable'),
      );
      const result = await run();

      expect(mockExecute).toHaveBeenCalledTimes(1);
      const tools = result.messages.filter((m) => m.kind === 'tool');
      expect(tools).toHaveLength(2);
      expect(tools.map((m) => m.toolStatus)).toEqual(['completed', 'completed']);
      expect(tools[1].toolCallResult).toBe(tools[0].toolCallResult);
      expect(model.doStreamCalls).toHaveLength(2);
      expect(turnEnd(result.events)).toMatchObject({ stopReason: 'end_turn' });
    });

    it('gives provider tool ids that repeat across rounds distinct message ids', async () => {
      mockExecute.mockResolvedValue(ok({ n: 1 }));
      installModel(
        toolCallChunks('call_1', 'search_notes', { query: 'a' }),
        toolCallChunks('call_1', 'search_notes', { query: 'b' }),
        textChunks('done'),
      );
      const result = await run();
      const ids = result.messages.filter((m) => m.kind === 'tool').map((m) => m.toolCallId);
      expect(new Set(ids).size).toBe(2);
      expect(mockExecute).toHaveBeenCalledTimes(2);
    });

    it('stops after MAX_TOOL_ROUNDS model calls and still shows the last tool output readably', async () => {
      mockExecute.mockResolvedValue(ok([{ title: 'Only note' }]));
      let call = 0;
      const model = new MockLanguageModelV3({
        doStream: async () => {
          call += 1;
          return streamResult(toolCallChunks(`call_${call}`, 'search_notes', { query: `q${call}` }));
        },
      });
      mockInitialize.mockResolvedValue(model);

      const result = await run();

      expect(result.error).toBeUndefined();
      expect(model.doStreamCalls).toHaveLength(MAX_TOOL_ROUNDS);
      expect(mockExecute).toHaveBeenCalledTimes(MAX_TOOL_ROUNDS);
      expect(turnEnd(result.events)).toEqual({ type: 'turn-end', stopReason: 'max_tool_rounds' });
      const lastText = result.messages.filter((m) => m.kind === 'text').pop();
      expect(lastText?.content).toContain('Only note');
    });
  });

  describe('confirmation', () => {
    const proposal: ActionExecutorResult = {
      success: true,
      requiresConfirmation: true,
      proposedChanges: {
        type: 'create_note',
        description: 'Create note "Groceries"',
        details: { title: 'Groceries' },
      },
    };

    beforeEach(() => {
      mockAiState.mockReturnValue({ ...mockAiState(), actionMode: 'confirm' });
    });

    it('asks first, and re-executes in auto mode only after the user applies', async () => {
      mockExecute.mockResolvedValueOnce(proposal).mockResolvedValueOnce(ok({ id: 'n1' }));
      const model = installModel(
        toolCallChunks('c1', 'create_note', { title: 'Groceries', content: 'milk' }),
        textChunks('Created it.'),
      );
      const statuses: Array<string | undefined> = [];

      const result = await run({
        decide: () => ({ optionId: 'apply' }),
        onEvent: (e) => {
          if (e.type === 'tool-update' && e.patch.status) statuses.push(e.patch.status);
        },
      });

      expect(result.requests).toHaveLength(1);
      expect(result.requests[0]).toMatchObject({
        toolCallId: 'c1',
        title: 'Create note "Groceries"',
        options: [
          { id: 'apply', kind: 'allow_once' },
          { id: 'cancel', kind: 'reject_once' },
        ],
      });
      expect(result.requests[0].description).toContain('Groceries');
      expect(mockExecute.mock.calls.map((c) => c[2])).toEqual(['confirm', 'auto']);
      expect(statuses).toEqual(['pending', 'running', 'awaiting-approval', 'running', 'completed']);
      expect(result.messages.find((m) => m.kind === 'tool')?.toolStatus).toBe('completed');
      expect(model.doStreamCalls).toHaveLength(2);
      expect(textEvents(result.events)).toEqual(['Created it.']);
    });

    it.each([
      ['cancel', { optionId: 'cancel' }],
      ['dismiss / abort', { optionId: null }],
    ] as const)('records a cancelled result on %s and ends the turn without another model call', async (_label, decision) => {
      mockExecute.mockResolvedValueOnce(proposal);
      const model = installModel(toolCallChunks('c1', 'create_note', { title: 'Groceries', content: 'milk' }));

      const result = await run({ decide: () => decision });

      expect(mockExecute).toHaveBeenCalledTimes(1);
      expect(model.doStreamCalls).toHaveLength(1);
      const tool = result.messages.find((m) => m.kind === 'tool');
      expect(tool).toMatchObject({ toolStatus: 'rejected', toolCallResult: 'chat.cancelled' });
      expect(turnEnd(result.events)).toEqual({ type: 'turn-end', stopReason: 'end_turn' });
      expect(result.error).toBeUndefined();
    });

    it('answers non-mutating tools without bothering the user', async () => {
      mockExecute.mockResolvedValueOnce(ok([]));
      installModel(toolCallChunks('c1', 'search_notes', { query: 'x' }), textChunks('Nothing.'));
      const result = await run();
      expect(result.requests).toHaveLength(0);
    });
  });

  describe('abort', () => {
    it('ends with a cancelled turn-end and no error when aborted mid-stream', async () => {
      const controller = new AbortController();
      const chunks = textChunks('one ', 'two ', 'three ', 'four ');
      const model = new MockLanguageModelV3({ doStream: async () => streamResult(chunks, 15) });
      mockInitialize.mockResolvedValue(model);

      const result = await run({
        signal: controller.signal,
        onEvent: (e) => {
          if (e.type === 'text-delta') controller.abort();
        },
      });

      expect(result.error).toBeUndefined();
      expect(turnEnd(result.events)).toEqual({ type: 'turn-end', stopReason: 'cancelled' });
      expect(textEvents(result.events).length).toBeLessThan(4);
      expect(model.doStreamCalls).toHaveLength(1);
    });

    it('does not start a model call when already aborted', async () => {
      const controller = new AbortController();
      controller.abort();
      const model = installModel(textChunks('never'));
      const result = await run({ signal: controller.signal });
      expect(model.doStreamCalls).toHaveLength(0);
      expect(turnEnd(result.events)).toMatchObject({ stopReason: 'cancelled' });
    });

    it('does not execute tools or continue after an abort that lands during streaming', async () => {
      const controller = new AbortController();
      const model = installModel(toolCallChunks('c1', 'search_notes', { query: 'x' }), textChunks('after'));
      const result = await run({
        signal: controller.signal,
        onEvent: (e) => {
          if (e.type === 'tool-start') controller.abort();
        },
      });
      expect(mockExecute).not.toHaveBeenCalled();
      expect(model.doStreamCalls).toHaveLength(1);
      expect(turnEnd(result.events)).toMatchObject({ stopReason: 'cancelled' });
    });
  });
});
