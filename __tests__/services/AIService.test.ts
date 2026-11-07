/**
 * Regression tests for AIService — covers:
 * - streamChatEvents mapping of fullStream parts to typed ModelStreamPart values
 * - Empty body retry and generateText fallback
 * - Error handling (auth/network errors) and abort
 * - System message extraction
 */
import type { LanguageModel, ModelMessage } from 'ai';
import { streamChatEvents, generateChatTitle } from '@/services/AIService';
import type { ModelStreamPart } from '@/services/AIService';

const makeSchema = () => ({ parse: jest.fn(), optional: () => ({ parse: jest.fn() }) });

jest.mock('zod', () => ({
  z: {
    object: jest.fn(() => makeSchema()),
    string: jest.fn(() => makeSchema()),
    number: jest.fn(() => makeSchema()),
    boolean: jest.fn(() => makeSchema()),
    array: jest.fn(() => makeSchema()),
    enum: jest.fn(() => makeSchema()),
  },
}));

jest.mock('ai', () => {
  const streamText = jest.fn();
  const generateText = jest.fn();
  return {
    __esModule: true,
    streamText,
    generateText,
    tool: jest.fn((def: unknown) => def),
    default: { streamText, generateText },
  };
});

const aiMocks = jest.requireMock('ai');
const mockStreamText = aiMocks.streamText;
const mockGenerateText = aiMocks.generateText;

jest.mock('@/services/ai/providerFactory', () => ({
  getFactory: jest.fn(),
  validateNetworkProviderFields: jest.fn(),
}));

jest.mock('@/services/ai/providerAvailability', () => ({
  resolveProviderAvailability: jest.fn(),
  ProviderUnavailableError: class ProviderUnavailableError extends Error {
    reason: string;
    providerName: string;
    constructor(reason: string, providerName: string) {
      super(reason);
      this.reason = reason;
      this.providerName = providerName;
    }
  },
}));

const mockExtractErrorDetails = jest.fn();
jest.mock('@/services/ai/aiServiceErrors', () => ({
  extractErrorDetails: (error: unknown) => mockExtractErrorDetails(error),
  humanizeStreamError: (e: unknown) => (e instanceof Error ? e.message : 'Unknown error'),
}));

jest.mock('@/stores/aiStore', () => ({
  useAIStore: {
    getState: () => ({ githubToolsEnabled: false }),
  },
}));

jest.mock('@/services/ai/tools', () => ({
  createNoteParameters: { parse: jest.fn() },
  editNoteParameters: { parse: jest.fn() },
  deleteNoteParameters: { parse: jest.fn() },
  searchNotesParameters: { parse: jest.fn() },
  getNoteParameters: { parse: jest.fn() },
  createTodoParameters: { parse: jest.fn() },
  editTodoParameters: { parse: jest.fn() },
  deleteTodoParameters: { parse: jest.fn() },
  getTodoParameters: { parse: jest.fn() },
  searchTodosParameters: { parse: jest.fn() },
  findNotesParameters: { parse: jest.fn() },
  create_note: {},
  edit_note: {},
  delete_note: {},
  search_notes: {},
  get_note: {},
  create_todo: {},
  edit_todo: {},
  delete_todo: {},
  get_todo: {},
  search_todos: {},
  find_notes: {},
  search_notes_google: {},
  chatTools: [],
  githubTools: [],
}));

// ── Helpers ───────────────────────────────────────────────────────────────────

function createMockModel(): LanguageModel {
  return {} as LanguageModel;
}

const textDelta = (text: string) => ({ type: 'text-delta' as const, id: 't', text });
const inputStart = (id: string, toolName: string) => ({ type: 'tool-input-start' as const, id, toolName });
const inputDelta = (id: string, delta: string) => ({ type: 'tool-input-delta' as const, id, delta });
const toolCall = (toolCallId: string, toolName: string, input: unknown) => ({
  type: 'tool-call' as const,
  toolCallId,
  toolName,
  input,
});
const toolResult = (toolCallId: string, toolName: string, output: unknown) => ({
  type: 'tool-result' as const,
  toolCallId,
  toolName,
  output,
});
const errorPart = (msg: string) => ({ type: 'error' as const, error: new Error(msg) });

function streamOf(...parts: unknown[]) {
  return {
    fullStream: {
      [Symbol.asyncIterator]: async function* () {
        for (const part of parts) yield part;
      },
    },
  };
}

async function collect(gen: AsyncGenerator<ModelStreamPart>): Promise<ModelStreamPart[]> {
  const received: ModelStreamPart[] = [];
  for await (const part of gen) received.push(part);
  return received;
}

beforeEach(() => {
  jest.resetAllMocks();
});

// ── Test suite ───────────────────────────────────────────────────────────────

describe('AIService streamChatEvents', () => {
  let model: LanguageModel;
  let messages: ModelMessage[];

  beforeEach(() => {
    model = createMockModel();
    messages = [{ role: 'user' as const, content: 'Hello' }];
  });

  describe('part mapping', () => {
    it('yields text deltas as typed parts and drops empty ones', async () => {
      mockStreamText.mockReturnValueOnce(streamOf(textDelta('Hello '), textDelta(''), textDelta('world!')));
      expect(await collect(streamChatEvents(model, messages))).toEqual([
        { type: 'text-delta', text: 'Hello ' },
        { type: 'text-delta', text: 'world!' },
      ]);
    });

    it('keeps text that looks like a tool event as plain text', async () => {
      const lookalike = JSON.stringify({ type: 'tool-call', toolCallId: 'x', toolName: 'create_note', input: {} });
      mockStreamText.mockReturnValueOnce(streamOf(textDelta(lookalike)));
      expect(await collect(streamChatEvents(model, messages))).toEqual([{ type: 'text-delta', text: lookalike }]);
    });

    it('maps tool input start, delta, call and result', async () => {
      mockStreamText.mockReturnValueOnce(
        streamOf(
          inputStart('tc-1', 'search_notes'),
          inputDelta('tc-1', '{"query":'),
          toolCall('tc-1', 'search_notes', { query: 'test' }),
          toolResult('tc-1', 'search_notes', { matches: ['note1'] }),
        ),
      );
      expect(await collect(streamChatEvents(model, messages))).toEqual([
        { type: 'tool-input-start', toolCallId: 'tc-1', toolName: 'search_notes' },
        { type: 'tool-input-delta', toolCallId: 'tc-1', delta: '{"query":' },
        { type: 'tool-call', toolCallId: 'tc-1', toolName: 'search_notes', input: { query: 'test' } },
        { type: 'tool-result', toolCallId: 'tc-1', toolName: 'search_notes', output: { matches: ['note1'] } },
      ]);
    });

    it('splits the "name: {json}" tool name some OpenRouter models emit', async () => {
      mockStreamText.mockReturnValueOnce(
        streamOf(
          inputStart('tc-1', 'search_notes: {"query":"dogs"}'),
          toolCall('tc-1', 'search_notes: {"query":"dogs"}', ''),
        ),
      );
      expect(await collect(streamChatEvents(model, messages))).toEqual([
        { type: 'tool-input-start', toolCallId: 'tc-1', toolName: 'search_notes' },
        { type: 'tool-call', toolCallId: 'tc-1', toolName: 'search_notes', input: { query: 'dogs' } },
      ]);
    });

    it('ignores bookkeeping parts such as start-step and finish', async () => {
      mockStreamText.mockReturnValueOnce(
        streamOf({ type: 'start' }, { type: 'start-step' }, textDelta('hi'), { type: 'finish-step' }, { type: 'finish' }),
      );
      expect(await collect(streamChatEvents(model, messages))).toEqual([{ type: 'text-delta', text: 'hi' }]);
    });
  });

  describe('error handling', () => {
    it('yields text produced before an error and then throws the humanised error', async () => {
      mockStreamText.mockReturnValueOnce(streamOf(textDelta('Partial '), errorPart('API error')));
      mockExtractErrorDetails.mockReturnValue({ isEmptyBody: false, isParserError: false });

      const received: ModelStreamPart[] = [];
      await expect(
        (async () => {
          for await (const part of streamChatEvents(model, messages)) received.push(part);
        })(),
      ).rejects.toThrow('API error');
      expect(received).toEqual([{ type: 'text-delta', text: 'Partial ' }]);
      expect(mockGenerateText).not.toHaveBeenCalled();
    });

    it('retries once on an empty body and succeeds', async () => {
      jest.useFakeTimers();
      mockStreamText
        .mockReturnValueOnce(streamOf(errorPart('empty body')))
        .mockReturnValueOnce(streamOf(textDelta('second time lucky')));
      mockExtractErrorDetails.mockReturnValueOnce({ isEmptyBody: true, isParserError: false });

      const pending = collect(streamChatEvents(model, messages));
      await jest.advanceTimersByTimeAsync(600);
      expect(await pending).toEqual([{ type: 'text-delta', text: 'second time lucky' }]);
      expect(mockStreamText).toHaveBeenCalledTimes(2);
      jest.useRealTimers();
    });

    it('falls back to generateText on a parser error before any output, including its tool calls', async () => {
      mockStreamText.mockReturnValueOnce(streamOf(errorPart('Failed to process successful response')));
      mockExtractErrorDetails.mockReturnValue({ isEmptyBody: false, isParserError: true });
      mockGenerateText.mockResolvedValueOnce({
        text: 'Fallback response',
        toolCalls: [{ toolCallId: 'tc-9', toolName: 'get_note', input: { noteId: 'n1' } }],
      });

      expect(await collect(streamChatEvents(model, messages))).toEqual([
        { type: 'text-delta', text: 'Fallback response' },
        { type: 'tool-call', toolCallId: 'tc-9', toolName: 'get_note', input: { noteId: 'n1' } },
      ]);
    });

    it('does not fall back once output was already yielded', async () => {
      mockStreamText.mockReturnValueOnce(streamOf(textDelta('x'), errorPart('Failed to process successful response')));
      mockExtractErrorDetails.mockReturnValue({ isEmptyBody: false, isParserError: true });
      await expect(collect(streamChatEvents(model, messages))).rejects.toThrow();
      expect(mockGenerateText).not.toHaveBeenCalled();
    });

    it('throws the humanised original error when the fallback fails too', async () => {
      mockStreamText.mockReturnValueOnce(streamOf(errorPart('parser broke')));
      mockExtractErrorDetails.mockReturnValue({ isEmptyBody: false, isParserError: true });
      mockGenerateText.mockRejectedValueOnce(new Error('Auth failed'));
      await expect(collect(streamChatEvents(model, messages))).rejects.toThrow('parser broke');
    });

    it('ends quietly instead of throwing when the abort signal fired', async () => {
      const controller = new AbortController();
      mockStreamText.mockReturnValueOnce({
        fullStream: {
          [Symbol.asyncIterator]: async function* () {
            yield textDelta('partial');
            controller.abort();
            throw new Error('The operation was aborted');
          },
        },
      });
      mockExtractErrorDetails.mockReturnValue({ isEmptyBody: false, isParserError: false });

      expect(await collect(streamChatEvents(model, messages, undefined, controller.signal))).toEqual([
        { type: 'text-delta', text: 'partial' },
      ]);
    });
  });

  describe('request shaping', () => {
    it('lifts system messages into the system option', async () => {
      const withSystem: ModelMessage[] = [
        { role: 'system', content: 'You are a helpful assistant.' },
        { role: 'user', content: 'Hello' },
      ];
      mockStreamText.mockReturnValueOnce(streamOf(textDelta('Hi there!')));
      await collect(streamChatEvents(model, withSystem));
      expect(mockStreamText).toHaveBeenCalledWith(
        expect.objectContaining({ system: 'You are a helpful assistant.', messages: [{ role: 'user', content: 'Hello' }] }),
      );
    });

    it('passes messages untouched when there is no system message', async () => {
      mockStreamText.mockReturnValueOnce(streamOf(textDelta('Response')));
      await collect(streamChatEvents(model, messages));
      expect(mockStreamText).toHaveBeenCalledWith(expect.objectContaining({ system: undefined, messages }));
    });

    it('passes tools and the abort signal to streamText', async () => {
      const tools = { search_notes: jest.fn() } as unknown as Record<string, import('ai').Tool>;
      const controller = new AbortController();
      mockStreamText.mockReturnValueOnce(streamOf(textDelta('Done')));
      await collect(streamChatEvents(model, messages, tools, controller.signal));
      expect(mockStreamText).toHaveBeenCalledWith(expect.objectContaining({ tools, abortSignal: controller.signal }));
    });
  });
});

describe('AIService generateChatTitle', () => {
  it('extracts title from assistant response', async () => {
    mockGenerateText.mockResolvedValueOnce({ text: '  "GitNotes Overview"  ' });
    const model = createMockModel();
    const title = await generateChatTitle(model, 'What is GitNotes?', 'GitNotes is a mobile notes app.');
    expect(title).toBe('GitNotes Overview');
  });

  it('returns null for empty assistant response', async () => {
    mockGenerateText.mockResolvedValueOnce({ text: '   ' });

    const model = createMockModel();
    const title = await generateChatTitle(model, 'Hello', '');

    expect(title).toBeNull();
  });

  it('strips thinking tags from response', async () => {
    mockGenerateText.mockResolvedValueOnce({ text: '<think>摘要内容<think>reasoning</think>Final Title' });

    const model = createMockModel();
    const title = await generateChatTitle(model, 'Hello', 'Response');

    expect(title).toBe('Final Title');
  });
});
