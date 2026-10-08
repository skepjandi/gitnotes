/**
 * Regression tests for useChatScreenController — covers bounded continuation
 * behavior by testing the pure helpers and integration of executeRound.
 */
import type { LanguageModel, ModelMessage } from 'ai';
import type { ChatMessage } from '@/models/Chat';
import { useChatScreenController } from '@/components/chat/useChatScreenController';
import { streamChatResponse, initializeModel } from '@/services/AIService';
import { executeToolCall } from '@/services/ai/actionExecutor';
import { useChatStore } from '@/stores/chatStore';
import { useAIStore } from '@/stores/aiStore';
import { useNoteStore } from '@/stores/noteStore';
import { useTodoStore } from '@/stores/todoStore';
import * as ChatStorageService from '@/services/ChatStorageService';
import { renderHook, act, waitFor } from '@testing-library/react-native';

jest.mock('@/services/AIService');
jest.mock('@/services/ai/actionExecutor');
jest.mock('@/stores/chatStore');
jest.mock('@/stores/aiStore');
jest.mock('@/stores/noteStore');
jest.mock('@/stores/todoStore');
jest.mock('@/services/ChatStorageService');
jest.mock('@/services/ContextService');
jest.mock('@/services/ai/AIMemoryIndexService');
jest.mock('@/services/ai/tools');
jest.mock('@/services/ai/systemPrompt', () => ({
  buildSystemPrompt: jest.fn(() => 'mocked system prompt'),
}));
jest.mock('@/services/ai/modelLimits', () => ({
  checkContextBudget: jest.fn(() => ({ within: true, used: 0, limit: 100000 })),
  getModelContextLimit: jest.fn(() => 100000),
}));
jest.mock('@/utils/ids');
jest.mock('react-i18next', () => ({
  useTranslation: () => ({ t: (key: string) => key, i18n: { changeLanguage: jest.fn() } }),
  initReactI18next: { type: '3rdParty', init: jest.fn() },
}));

const mockStreamChatResponse = streamChatResponse as jest.MockedFunction<typeof streamChatResponse>;
const mockInitializeModel = initializeModel as jest.MockedFunction<typeof initializeModel>;
const mockExecuteToolCall = executeToolCall as jest.MockedFunction<typeof executeToolCall>;

const threadMessages: ChatMessage[] = [];

const chatState = {
  activeThread: null as { id: string; title: string; messages: ChatMessage[]; createdAt: number; updatedAt: number; repoOwner: string; repoName: string; branch: string; filePath: string } | null,
  isLoading: false,
  error: null as string | null,
  isStreaming: false,
  storageAdapter: null,
  threads: [] as ChatMessage[],
  addMessage: (msg: ChatMessage) => { threadMessages.push(msg); },
  updateMessage: (id: string, update: Partial<ChatMessage>) => {
    const msg = threadMessages.find((m) => m.id === id);
    if (msg) Object.assign(msg, update);
  },
  removeMessage: jest.fn(),
  setStreaming: jest.fn(),
  clearError: jest.fn(),
  truncateAfter: jest.fn(),
  loadThread: jest.fn(),
  setStorageAdapter: jest.fn(),
  saveThread: jest.fn(),
};

const aiState = {
  providers: [] as unknown[],
  githubToolsEnabled: false,
  aiPersonalizationEnabled: false,
  actionMode: 'auto' as const,
  getSelectedModel: () => ({
    id: 'test-model', name: 'Test Model', providerId: 'test-provider',
    providerType: 'openai-compatible', requiresDownload: false,
  }),
};

function setupStores(overrides: Partial<typeof chatState> = {}) {
  const thread = {
    id: THREAD_ID, title: 'Test', messages: threadMessages, createdAt: Date.now(),
    updatedAt: Date.now(), repoOwner: 'owner', repoName: 'repo',
    branch: 'main', filePath: 'chat/thread-1.json',
  };
  const merged = { ...chatState, activeThread: thread, ...overrides };
  (useChatStore as jest.Mock).mockImplementation((sel: (s: typeof merged) => unknown) => sel(merged));
  (useChatStore as jest.Mock).getState = () => merged;
  (useAIStore as jest.Mock).mockImplementation((sel: (s: typeof aiState) => unknown) => sel(aiState));
  (useAIStore as jest.Mock).getState = () => aiState;

  const noteState = { notes: [] as unknown[] };
  (useNoteStore as jest.Mock).mockImplementation((sel: (s: typeof noteState) => unknown) => sel(noteState));
  (useNoteStore as jest.Mock).getState = () => noteState;

  const todoState = { todos: [] as unknown[] };
  (useTodoStore as jest.Mock).mockImplementation((sel: (s: typeof todoState) => unknown) => sel(todoState));
  (useTodoStore as jest.Mock).getState = () => todoState;
}

function textDelta(delta: string) {
  return delta;
}

function toolCall(tcId: string, toolName: string, input: Record<string, unknown> = {}) {
  return JSON.stringify({ type: 'tool-call', toolCallId: tcId, toolName, input });
}

let generateIdCounter = 0;
beforeEach(() => {
  jest.clearAllMocks();
  generateIdCounter = 0;
  threadMessages.length = 0;
  const { generateId } = jest.requireMock('@/utils/ids');
  (generateId as jest.Mock).mockImplementation(() => `test-id-${++generateIdCounter}`);
  chatState.addMessage = (msg: ChatMessage) => { threadMessages.push(msg); };
  chatState.updateMessage = jest.fn((id: string, update: Partial<ChatMessage>) => {
    const msg = threadMessages.find((m) => m.id === id);
    if (msg) Object.assign(msg, update);
  }) as typeof chatState.updateMessage;
  chatState.removeMessage = jest.fn();
  chatState.setStreaming = jest.fn();
  chatState.clearError = jest.fn();
  chatState.truncateAfter = jest.fn();
  chatState.loadThread = jest.fn();
  chatState.saveThread = jest.fn();
  mockStreamChatResponse.mockReset();
  mockInitializeModel.mockReset();
  mockExecuteToolCall.mockReset();
});

const THREAD_ID = 'thread-1';
const activeThread = {
  id: THREAD_ID, title: 'Test', messages: threadMessages, createdAt: Date.now(),
  updatedAt: Date.now(), repoOwner: 'owner', repoName: 'repo',
  branch: 'main', filePath: 'chat/thread-1.json',
};

describe('useChatScreenController — streamChatResponse orchestration', () => {
  it('calls streamChatResponse twice: tool round then final text round', async () => {
    const model = {} as LanguageModel;
    mockInitializeModel.mockResolvedValueOnce(model);

    let round = 0;
    mockStreamChatResponse.mockImplementation(async function* (): AsyncGenerator<string> {
      round++;
      if (round === 1) {
        yield textDelta('Searching...');
        yield toolCall('tc1', 'search_notes', { query: 'test' });
      } else {
        yield textDelta('Found 2 notes.');
      }
      return;
    });

    mockExecuteToolCall.mockResolvedValueOnce({
      success: true, data: { matches: [{ title: 'Note 1' }] }, requiresConfirmation: false,
    });

    setupStores({ activeThread });

    const { result } = renderHook(() => useChatScreenController(THREAD_ID));
    await act(async () => { await result.current.handleSend('Search for notes'); });

    expect(mockStreamChatResponse).toHaveBeenCalledTimes(2);
    expect(mockExecuteToolCall).toHaveBeenCalledTimes(1);

    const assistantMsgs = threadMessages.filter((m) => m.role === 'assistant' && m.content);
    expect(assistantMsgs.length).toBeGreaterThan(0);
    const lastAssistant = assistantMsgs[assistantMsgs.length - 1];
    expect(lastAssistant.content).toBe('Found 2 notes.');
  });

  it('feeds tool result back as a tool message in the second round', async () => {
    const model = {} as LanguageModel;
    mockInitializeModel.mockResolvedValueOnce(model);

    let capturedSecondRoundMessages: ModelMessage[] = [];

    mockStreamChatResponse
      .mockImplementationOnce(async function* (): AsyncGenerator<string> {
        yield toolCall('tc1', 'search_notes', { query: 'test' });
        return;
      })
      .mockImplementation(async function* (
        _m: LanguageModel, msgs: ModelMessage[],
      ): AsyncGenerator<string> {
        if (msgs.some((m) => m.role === 'tool')) {
          capturedSecondRoundMessages = msgs;
        }
        yield textDelta('Done.');
        return;
      });

    mockExecuteToolCall.mockResolvedValueOnce({
      success: true, data: { matches: [] }, requiresConfirmation: false,
    });

    setupStores({ activeThread });

    const { result } = renderHook(() => useChatScreenController(THREAD_ID));
    await act(async () => { await result.current.handleSend('Search'); });

    expect(mockStreamChatResponse).toHaveBeenCalledTimes(2);
    expect(mockExecuteToolCall).toHaveBeenCalledTimes(1);

    const toolResultMsg = capturedSecondRoundMessages.find((m) => m.role === 'tool');
    expect(toolResultMsg).toBeDefined();
    const toolContent = toolResultMsg!.content as unknown[];
    const toolResultPart = toolContent[0] as { type: string; toolCallId: string; toolName: string; output: { type: string; value: string } };
    expect(toolResultPart.type).toBe('tool-result');
    expect(toolResultPart.toolCallId).toBe('tc1');
    expect(toolResultPart.toolName).toBe('search_notes');
    expect(toolResultPart.output).toEqual({ type: 'text', value: '{\n  "matches": []\n}' });

    const assistantWithToolCall = capturedSecondRoundMessages.find(
      (m) => m.role === 'assistant' && Array.isArray(m.content) && m.content[0] && (m.content[0] as { type?: string }).type === 'tool-call',
    );
    expect(assistantWithToolCall).toBeDefined();
    const assistantContent = assistantWithToolCall!.content as unknown[];
    const toolCallPart = assistantContent[0] as { type: string; toolCallId: string; toolName: string; input: Record<string, unknown> };
    expect(toolCallPart.type).toBe('tool-call');
    expect(toolCallPart.toolCallId).toBe('tc1');
    expect(toolCallPart.toolName).toBe('search_notes');
    expect(toolCallPart.input).toEqual({ query: 'test' });
  });
});

describe('useChatScreenController — MAX_TOOL_ROUNDS bound', () => {
  it('stops calling provider at MAX_TOOL_ROUNDS', async () => {
    const model = {} as LanguageModel;
    mockInitializeModel.mockResolvedValueOnce(model);

    let round = 0;
    mockStreamChatResponse.mockImplementation(async function* (): AsyncGenerator<string> {
      round++;
      yield toolCall(`tc${round}`, 'search_notes', { query: 'test' });
      return;
    });

    mockExecuteToolCall.mockResolvedValue({
      success: true, data: { matches: [] }, requiresConfirmation: false,
    });

    setupStores({ activeThread });
    chatState.saveThread.mockResolvedValue(undefined);

    const { result } = renderHook(() => useChatScreenController(THREAD_ID));
    await act(async () => { await result.current.handleSend('Keep searching'); });

    expect(round).toBeLessThanOrEqual(5);
  });
});

describe('useChatScreenController — confirmation Apply/Cancel', () => {
  it('re-executes tool with auto mode on Apply', async () => {
    const model = {} as LanguageModel;
    mockInitializeModel.mockResolvedValueOnce(model);

    mockStreamChatResponse.mockImplementation(async function* (): AsyncGenerator<string> {
      yield toolCall('tc1', 'create_note', { title: 'New Note' });
      return;
    });

    mockExecuteToolCall
      .mockResolvedValueOnce({ success: true, requiresConfirmation: true, proposedChanges: { type: 'create_note', description: 'desc', details: {} } })
      .mockResolvedValueOnce({ success: true, data: {}, requiresConfirmation: false });

    setupStores({ activeThread });
    chatState.saveThread.mockResolvedValue(undefined);

    const { result } = renderHook(() => useChatScreenController(THREAD_ID));
    await act(async () => { await result.current.handleSend('Create note'); });
    await act(async () => { await result.current.handleConfirmApply(); });

    expect(mockExecuteToolCall).toHaveBeenCalledTimes(2);
  });

  it('does not re-execute tool on Cancel', async () => {
    const model = {} as LanguageModel;
    mockInitializeModel.mockResolvedValueOnce(model);

    mockStreamChatResponse.mockImplementation(async function* (): AsyncGenerator<string> {
      yield toolCall('tc1', 'create_note', { title: 'New Note' });
      return;
    });

    mockExecuteToolCall.mockResolvedValueOnce({
      success: true, requiresConfirmation: true,
      proposedChanges: { type: 'create_note', description: 'desc', details: {} },
    });

    setupStores({ activeThread });
    chatState.saveThread.mockResolvedValue(undefined);

    const { result } = renderHook(() => useChatScreenController(THREAD_ID));
    await act(async () => { await result.current.handleSend('Create note'); });
    await act(async () => { await result.current.handleConfirmCancel(); });

    expect(mockExecuteToolCall).toHaveBeenCalledTimes(1);
    expect(threadMessages.some((m) => m.role === 'user' || m.role === 'assistant')).toBe(true);
  });
});

describe('useChatScreenController — stopStreaming', () => {
  it('sets isStreaming to false when stopStreaming is called', async () => {
    const model = {} as LanguageModel;
    mockInitializeModel.mockResolvedValueOnce(model);

    let providerStarted!: () => void;
    const providerStartedPromise = new Promise<void>((resolve) => { providerStarted = resolve; });

    mockStreamChatResponse.mockImplementation(
      async function* (
        _m: LanguageModel,
        _msgs: ModelMessage[],
        _tools?: Record<string, unknown>,
        signal?: AbortSignal,
      ): AsyncGenerator<string> {
        providerStarted();
        yield textDelta('Long response...');
        await new Promise<void>((resolve) => signal?.addEventListener('abort', () => resolve(), { once: true }));
        throw Object.assign(new Error('aborted'), { name: 'AbortError' });
      },
    );

    mockExecuteToolCall.mockResolvedValueOnce({
      success: true, data: undefined, requiresConfirmation: false,
    });

    setupStores({ activeThread });

    const { result } = renderHook(() => useChatScreenController(THREAD_ID));

    const sendPromise = result.current.handleSend('Tell me a story') as Promise<void>;
    await providerStartedPromise;

    await act(async () => {
      result.current.stopStreaming();
    });

    await act(async () => {
      await sendPromise;
    });

    expect(mockStreamChatResponse.mock.calls[0][3]?.aborted).toBe(true);
    expect(chatState.setStreaming).toHaveBeenCalledWith(false);
  });
});

describe('useChatScreenController — first-message persistence', () => {
  it('waits for the primed thread save before starting the AI request', async () => {
    const model = {} as LanguageModel;
    mockInitializeModel.mockResolvedValueOnce(model);

    let resolvePrimedSave!: () => void;
    const primedSave = new Promise<void>((resolve) => {
      resolvePrimedSave = resolve;
    });
    ChatStorageService.saveThread
      .mockImplementationOnce(() => primedSave)
      .mockResolvedValue(undefined);
    mockStreamChatResponse.mockImplementation(async function* (): AsyncGenerator<string> {
      yield textDelta('Hello!');
    });

    setupStores({ activeThread });
    const { result } = renderHook(() => useChatScreenController(THREAD_ID));
    await act(async () => {
      const sendPromise = result.current.handleSend('Hello') as Promise<void>;
      await Promise.resolve();
      expect(mockStreamChatResponse).not.toHaveBeenCalled();
      resolvePrimedSave();
      await sendPromise;
    });

    expect(mockStreamChatResponse).toHaveBeenCalledTimes(1);
    expect(ChatStorageService.saveThread).toHaveBeenCalledTimes(2);
  });

  it('saves thread after first user message', async () => {
    const model = {} as LanguageModel;
    mockInitializeModel.mockResolvedValueOnce(model);

    mockStreamChatResponse.mockImplementation(async function* (): AsyncGenerator<string> {
      yield textDelta('Hello!');
      return;
    });

    setupStores({ activeThread });

    const { result } = renderHook(() => useChatScreenController(THREAD_ID));
    await act(async () => { await result.current.handleSend('Hello'); });

    expect(ChatStorageService.saveThread).toHaveBeenCalled();
  });

  it('clears streaming state before a slow completed-response save resolves', async () => {
    const model = {} as LanguageModel;
    mockInitializeModel.mockResolvedValueOnce(model);

    let resolveSave!: () => void;
    const slowSave = new Promise<void>((resolve) => {
      resolveSave = resolve;
    });
    ChatStorageService.saveThread
      .mockResolvedValueOnce(undefined)
      .mockImplementationOnce(() => slowSave);
    mockStreamChatResponse.mockImplementation(async function* (): AsyncGenerator<string> {
      yield textDelta('Hello!');
    });

    setupStores({ activeThread });
    const { result } = renderHook(() => useChatScreenController(THREAD_ID));
    const sendPromise = result.current.handleSend('Hello') as Promise<void>;

    await act(async () => {
      await waitFor(() => expect(ChatStorageService.saveThread).toHaveBeenCalledTimes(2));
    });

    expect(chatState.setStreaming).toHaveBeenLastCalledWith(false);
    resolveSave();
    await act(async () => {
      await sendPromise;
    });
  });

  it('surfaces a completed-response save failure after clearing streaming state', async () => {
    const model = {} as LanguageModel;
    mockInitializeModel.mockResolvedValueOnce(model);
    ChatStorageService.saveThread
      .mockResolvedValueOnce(undefined)
      .mockRejectedValueOnce(new Error('disk full'));
    mockStreamChatResponse.mockImplementation(async function* (): AsyncGenerator<string> {
      yield textDelta('Hello!');
    });

    setupStores({ activeThread });
    const { result } = renderHook(() => useChatScreenController(THREAD_ID));

    await act(async () => {
      await result.current.handleSend('Hello');
    });

    expect(result.current.localError).toBe('disk full');
    expect(chatState.setStreaming).toHaveBeenLastCalledWith(false);
  });
});
