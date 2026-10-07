import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Alert } from 'react-native';
import type { AIContextItem, AIModelConfig, AIProviderConfig } from '../../models/AIProvider';
import type { ChatMessage } from '../../models/Chat';
import * as AIService from '../../services/AIService';
import { AuthService } from '../../services/AuthService';
import * as ChatStorageService from '../../services/ChatStorageService';
import { executeToolCall } from '../../services/ai/actionExecutor';
import { chatTools, githubTools } from '../../services/ai/tools';
import { buildSystemPrompt } from '../../services/ai/systemPrompt';
import { checkContextBudget, getModelContextLimit } from '../../services/ai/modelLimits';
import { buildContextString } from '../../services/ContextService';
import { STREAM_RENDER_FLUSH_MS, BYTES_PER_TOKEN } from '../../services/ai/config';
import { aiMemoryIndex } from '../../services/ai/AIMemoryIndexService';
import type { MemorySearchResult } from '../../services/ai/AIMemoryIndexService';
import { ProviderUnavailableError } from '../../services/ai/providerAvailability';
import { describeAvailability } from '../../services/ai/providerAvailabilityCopy';
import { useTranslation } from 'react-i18next';
import type { TFunction } from 'i18next';
import { useAIStore } from '../../stores/aiStore';
import { useChatStore } from '../../stores/chatStore';
import { useNoteStore } from '../../stores/noteStore';
import { useTodoStore } from '../../stores/todoStore';
import { generateId } from '../../utils/ids';
import {
  decodeOverEscapedChunk,
  dedupeContexts,
  formatExecutorResult,
  formatToolResult,
  formatHistoryMessage,
  parseToolArgs,
  parseToolEvent,
  type PendingConfirmation,
  type RetryPayload,
} from './chatScreenShared';
import { toContinuationMessages } from './continuationMessages';
import {
  computeShouldContinue,
  executeWithTimeout,
  makeToolCallKey,
  newExecutedToolCalls,
  type ExecutedToolCalls,
  type ContinuationSignal,
} from './continuationHelpers';
import { MAX_TOOL_ROUNDS } from '../../services/ai/config';

type ToolListItem = {
  title?: string;
  text?: string;
  completed?: boolean;
};

/**
 * Persists the primed thread (thread with user message) to storage.
 * Exported for unit testing - accepts dependencies as parameters.
 *
 * @param threadId - The thread ID to persist
 * @param getActiveThread - Returns current active thread from store
 * @param saveThread - Persists thread to storage service
 * @param onError - Callback to surface retryable error to UI
 */
export async function persistPrimedThreadToStorage(
  threadId: string,
  getActiveThread: () => { id: string; messages: ChatMessage[] } | null,
  saveThread: (thread: { id: string; messages: ChatMessage[] }) => Promise<void>,
  onError: (message: string) => void,
): Promise<void> {
  const latestThread = getActiveThread();
  if (!latestThread || latestThread.id !== threadId) {
    return;
  }

  try {
    await saveThread(latestThread);
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    console.warn('[ChatScreen] persistPrimedThread failed:', message);
    onError(message);
  }
}

export function buildChatToolsMap(enabled: boolean = useAIStore.getState().githubToolsEnabled) {
  return enabled ? { ...chatTools, ...githubTools } : chatTools;
}

export function sanitizeToolName(raw: string | undefined, knownToolNames: ReadonlySet<string>): string | null {
  const trimmed = raw?.trim();
  if (!trimmed) return null;
  if (knownToolNames.has(trimmed)) return trimmed;
  const colonIdx = trimmed.indexOf(':');
  if (colonIdx > 0) {
    const prefix = trimmed.slice(0, colonIdx).trim();
    if (knownToolNames.has(prefix)) return prefix;
  }
  return null;
}

function parseToolListItems(raw: string): ToolListItem[] | null {
  try {
    const parsed = JSON.parse(raw);
    if (!Array.isArray(parsed)) return null;
    return parsed.filter((item): item is ToolListItem => !!item && typeof item === 'object');
  } catch {
    return null;
  }
}

function formatBulletList(items: string[], noun: string, t: TFunction): string {
  if (items.length === 0) return t('chat.noFoundNoun', { noun });
  const visibleItems = items.slice(0, 8);
  const extraCount = items.length - visibleItems.length;
  return [
    t('chat.foundCount', { count: items.length, noun }),
    ...visibleItems.map((item) => `- ${item}`),
    ...(extraCount > 0 ? [t('chat.andMore', { count: extraCount })] : []),
  ].join('\n');
}

function buildFallbackToolResponse(toolName: string, rawResult: string, t: TFunction): string | null {
  if (!rawResult.trim()) return null;
  if (toolName === 'search_notes') {
    const items = parseToolListItems(rawResult);
    if (!items) return null;
    return formatBulletList(
      items.map((item) => item.title?.trim()).filter((item): item is string => !!item),
      t('chat.nounNotes'),
      t,
    );
  }
  if (toolName === 'search_todos' || toolName === 'get_todos') {
    const items = parseToolListItems(rawResult);
    if (!items) return null;
    return formatBulletList(
      items
        .map((item) => {
          const label = item.text?.trim();
          if (!label) return null;
          return item.completed ? `${label}${t('chat.doneParenthetical')}` : label;
        })
        .filter((item): item is string => !!item),
      t('chat.nounTodos'),
      t,
    );
  }
  return null;
}

function hasMeaningfulAssistantText(value: string): boolean {
  const trimmed = value.trim();
  if (!trimmed) return false;
  const normalized = trimmed.toLowerCase();
  return normalized !== 'show' && normalized !== 'hide';
}

const TOOL_ACTION_PATTERN = /^\s*(create|delete|edit|update|add|remove|modify)\s+(a\s+|an\s+|the\s+)?(note|todo|task)/i;

function isToolActionShaped(query: string): boolean {
  return TOOL_ACTION_PATTERN.test(query.trim());
}

function extractDateFromThoughtDumpPath(filePath: string): string {
  const match = filePath.match(/thoughts\/(\d{4})(\d{2})(\d{2})/);
  if (!match) return '';
  return `${match[1]}-${match[2]}-${match[3]}`;
}

function formatMemoryBlock(results: MemorySearchResult[], budgetBytes: number): string | null {
  if (results.length === 0) return null;

  const sorted = [...results].sort((a, b) => b.score - a.score);
  const lines: string[] = [];
  let currentBytes = 0;

  for (const result of sorted) {
    const date = extractDateFromThoughtDumpPath(result.filePath);
    const prefix = date ? `[${date}] ` : '';
    const line = `${prefix}${result.snippet}`;
    const lineBytes = line.length;

    if (currentBytes + lineBytes > budgetBytes && lines.length > 0) break;
    lines.push(line);
    currentBytes += lineBytes;
  }

  return lines.length > 0 ? lines.join('\n') : null;
}

async function buildMemoryBlockForQuery(
  query: string,
  model: AIModelConfig | undefined,
  existingPromptBytes: number,
): Promise<string | null> {
  if (aiMemoryIndex.getEntryCount() === 0) return null;
  if (isToolActionShaped(query)) return null;

  try {
    const results = await aiMemoryIndex.search(query, 5);
    if (results.length === 0) return null;

    let budgetBytes = 2000;
    if (model) {
      const limit = getModelContextLimit(model);
      if (limit) {
        const totalBudgetBytes = (limit.totalTokens - limit.reservedTokens) * BYTES_PER_TOKEN;
        const available = totalBudgetBytes - existingPromptBytes;
        budgetBytes = Math.max(200, Math.min(available, totalBudgetBytes * 0.15));
      }
    }

    return formatMemoryBlock(results, budgetBytes);
  } catch {
    return null;
  }
}

function mergeAssistantWithToolFallback(
  assistantText: string,
  fallbackToolText: string,
  handledToolCount: number,
  t: TFunction,
): string {
  const assistant = assistantText.trim();
  const fallback = fallbackToolText.trim();
  const assistantIsMeaningful = hasMeaningfulAssistantText(assistant);

  if (!fallback) {
    if (assistantIsMeaningful) return assistant;
    return handledToolCount > 0 ? '' : assistant || t('chat.done');
  }

  if (handledToolCount <= 0) {
    return assistantIsMeaningful ? assistant : fallback;
  }

  if (!assistantIsMeaningful) return fallback;

  // Keep the model's narrative text, but always include concrete tool output
  // when tools actually ran so the user sees a usable final answer.
  if (assistant.includes(fallback)) return assistant;
  return `${assistant}\n\n${fallback}`;
}

export function useChatScreenController(threadId: string) {
  const noteCount = useNoteStore((state) => state.notes.length);
  const todoCount = useTodoStore((state) => state.todos.length);
  const githubToolsEnabled = useAIStore((state) => state.githubToolsEnabled);
  const knownToolNames = useMemo(
    () => new Set(Object.keys(buildChatToolsMap(githubToolsEnabled))),
    [githubToolsEnabled],
  );
  const activeThread = useChatStore((state) => state.activeThread);
  const isLoading = useChatStore((state) => state.isLoading);
  const storeError = useChatStore((state) => state.error);
  const isStreaming = useChatStore((state) => state.isStreaming);
  const storageAdapter = useChatStore((state) => state.storageAdapter);
  const loadThread = useChatStore((state) => state.loadThread);
  const addMessage = useChatStore((state) => state.addMessage);
  const updateMessage = useChatStore((state) => state.updateMessage);
  const removeMessage = useChatStore((state) => state.removeMessage);
  const setStreaming = useChatStore((state) => state.setStreaming);
  const clearError = useChatStore((state) => state.clearError);
  const setStorageAdapter = useChatStore((state) => state.setStorageAdapter);
  const truncateAfter = useChatStore((state) => state.truncateAfter);

  const toolArgsBufferRef = useRef<Record<string, string>>({});
  // Maps each in-flight `toolCallId` to the chat message bubble we created
  // when the tool call started streaming, so subsequent deltas + the final
  // tool-call event can update the same bubble (rather than creating a
  // second one once execution finishes).
  const toolMessageIdsRef = useRef<Record<string, string>>({});
  const abortRef = useRef<AbortController | null>(null);
  // Tracks the current round number for bounded continuation loop
  const continuationRoundRef = useRef<number>(0);
  // Set by handleConfirmApply to signal the next round should continue
  const continuationSignalRef = useRef<ContinuationSignal | null>(null);
  // Tracks executed tool call ids across ALL rounds of a single streaming session
  const executedToolCallIdsRef = useRef<ExecutedToolCalls>(newExecutedToolCalls());
  // Tracks executed (toolName, argsJSON) pairs to prevent re-execution after confirmation Apply
  const executedToolCallsRef = useRef<ExecutedToolCalls>(newExecutedToolCalls());
  const { t } = useTranslation();

  const [attachedContexts, setAttachedContexts] = useState<AIContextItem[]>([]);
  const [isContextPickerVisible, setIsContextPickerVisible] = useState(false);
  const [pendingConfirmation, setPendingConfirmation] = useState<PendingConfirmation | null>(null);
  const [retryPayload, setRetryPayload] = useState<RetryPayload | null>(null);
  const [localError, setLocalError] = useState<string | null>(null);
  const [streamStartedAt, setStreamStartedAt] = useState<number>(0);

  const thread = activeThread?.id === threadId ? activeThread : null;
  const messages = thread?.messages ?? [];

  const saveActiveThread = useCallback(async () => {
    const latestThread = useChatStore.getState().activeThread;
    if (latestThread) await ChatStorageService.saveThread(latestThread);
  }, []);

  const persistPrimedThread = useCallback(async (threadId: string) => {
    const latestThread = useChatStore.getState().activeThread;
    if (!latestThread || latestThread.id !== threadId) {
      return;
    }

    try {
      await ChatStorageService.saveThread(latestThread);
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      console.warn('[ChatScreen] persistPrimedThread failed:', message);
      setLocalError(message);
    }
  }, []);

  const getSelectedModelConfig = useCallback(() => {
    const aiState = useAIStore.getState();
    const model = aiState.getSelectedModel();
    if (!model) throw new Error(t('chat.selectModelFirst'));
    const provider = aiState.providers.find((item) => item.id === model.providerId);
    return { model, provider };
  }, [t]);

  const runToolCall = useCallback(async (
    toolName: string,
    args: Record<string, unknown>,
    options?: { allowConfirmation?: boolean; messageId?: string },
  ) => {
    try {
      const mode = useAIStore.getState().actionMode;
      const effectiveMode = options?.allowConfirmation === false ? 'auto' : mode;

      const result = await executeWithTimeout(executeToolCall(toolName, args, effectiveMode));

      const resultText = formatExecutorResult(result);

      if (options?.messageId) updateMessage(options.messageId, { toolCallResult: resultText });

      if (result.requiresConfirmation && result.proposedChanges && options?.messageId) {
        setPendingConfirmation({ toolName, args, description: result.proposedChanges.description, details: result.proposedChanges.details, messageId: options.messageId });
      }

      if (!result.requiresConfirmation && !result.success) {
        addMessage({ id: generateId(), role: 'system', content: t('chat.toolError', { message: resultText }), timestamp: Date.now() });
      }

      return result;
    } catch (error) {
      const isTimeout = error instanceof Error && error.message === 'TIMEOUT';
      const message = isTimeout ? t('chat.toolTimedOut') : error instanceof Error ? error.message : t('chat.toolExecutionFailed');
      if (options?.messageId) updateMessage(options.messageId, { toolCallResult: message });
      addMessage({ id: generateId(), role: 'system', content: t('chat.toolError', { message }), timestamp: Date.now() });
      return {
        success: false,
        error: message,
        requiresConfirmation: false,
      };
    }
  }, [addMessage, updateMessage, t]);

  const executeRound = useCallback(
    async (
      round: number,
      text: string,
      contexts: AIContextItem[],
      _priorAssistantMessages: ChatMessage[],
      _continuationSignal: { success: true; resultText?: string } | null,
    ) => {
      continuationRoundRef.current = round;

      const currentThread = useChatStore.getState().activeThread;
      if (!currentThread) {
        setLocalError(t('chat.threadNotLoaded'));
        return;
      }

      if (round >= MAX_TOOL_ROUNDS) {
        return;
      }

      const trimmedText = text.trim();
      const userMessage: ChatMessage | null =
        text && round === 0
          ? { id: generateId(), role: 'user', content: trimmedText, timestamp: Date.now(), attachedContexts: contexts }
          : null;

      if (userMessage) {
        addMessage(userMessage);
        await persistPrimedThread(currentThread.id);
      }

      setRetryPayload(userMessage ? { text: userMessage.content, contexts } : null);
      setLocalError(null);
      clearError();
      setPendingConfirmation(null);
      setStreamStartedAt(Date.now());
      setStreaming(true);

      abortRef.current?.abort();
      const abortController = new AbortController();
      abortRef.current = abortController;
      const assistantMessageId = generateId();
      addMessage({ id: assistantMessageId, role: 'assistant', content: '', timestamp: Date.now() });

      let assistantText = '';
      let handledToolCount = 0;
      let pausedForConfirmation = false;
      let pendingFlush: ReturnType<typeof setTimeout> | null = null;
      const fallbackToolResponses: string[] = [];

      const flushAssistantText = () => {
        pendingFlush = null;
        updateMessage(assistantMessageId, { content: assistantText });
      };

      const scheduleFlush = () => {
        if (pendingFlush) return;
        const scale = 1 + Math.floor(assistantText.length / 2000);
        pendingFlush = setTimeout(flushAssistantText, STREAM_RENDER_FLUSH_MS * scale);
      };

      const clearContinuationSignal = () => {
        continuationSignalRef.current = null;
      };

      const executeToolCallRef = async (
        toolName: string,
        args: Record<string, unknown>,
        options?: { allowConfirmation?: boolean; messageId?: string },
      ) => {
        const result = await runToolCall(toolName, args, options);
        if (result.requiresConfirmation) {
          setPendingConfirmation({
            toolName,
            args,
            description: result.proposedChanges?.description ?? '',
            details: result.proposedChanges?.details ?? {},
            messageId: options?.messageId ?? '',
          });
          continuationSignalRef.current = { success: true };
          await saveActiveThread();
        }
        return result;
      };

      try {
        const aiState = useAIStore.getState();
        const githubAccountLogin = githubToolsEnabled
          ? (await AuthService.checkAuthState()).user?.login
          : undefined;
        const { model, provider } = getSelectedModelConfig();
        const runtimeThread = useChatStore.getState().activeThread;
        if (!runtimeThread) throw new Error(t('chat.threadNotAvailable'));

        const aggregatedContexts = dedupeContexts([
          ...runtimeThread.messages.flatMap((message) => message.attachedContexts ?? []),
          ...contexts,
        ]);
        const contextString = aggregatedContexts.length ? await buildContextString(aggregatedContexts) : undefined;
        const history = runtimeThread.messages
          .filter((message) => message.id !== assistantMessageId)
          .map(formatHistoryMessage);
        const toolsEnabled = aiState.aiPersonalizationEnabled;
        const basePrompt = buildSystemPrompt({
          attachedContexts: contextString,
          noteCount,
          todoCount,
          actionMode: aiState.actionMode,
          githubToolsEnabled,
          githubAccountLogin,
          toolsEnabled,
        });
        const memoryBlock =
          text && round === 0 ? await buildMemoryBlockForQuery(trimmedText, model, basePrompt.length) : null;
        const prompt = memoryBlock
          ? buildSystemPrompt({
              attachedContexts: contextString,
              noteCount,
              todoCount,
              actionMode: aiState.actionMode,
              memoryBlock,
              githubToolsEnabled,
              githubAccountLogin,
              toolsEnabled,
            })
          : basePrompt;
        const modelInstance = await AIService.initializeModel(model, provider as AIProviderConfig | undefined);

        let requestMessages: Parameters<typeof AIService.streamChatResponse>[1];
        if (round === 0) {
          requestMessages = [{ role: 'system', content: prompt }, ...history];
        } else {
          const allPriorMessages = runtimeThread.messages.filter(
            (message) => message.id !== assistantMessageId,
          );
          const continuationMsgs = toContinuationMessages(allPriorMessages);
          requestMessages = [{ role: 'system', content: prompt }, ...continuationMsgs];
        }

        for await (const chunk of AIService.streamChatResponse(
          modelInstance,
          requestMessages,
          toolsEnabled ? buildChatToolsMap() : undefined,
          abortController.signal,
        )) {
          if (abortController.signal.aborted) break;
          const toolEvent = parseToolEvent(chunk);
          if (!toolEvent) {
            assistantText += decodeOverEscapedChunk(chunk);
            scheduleFlush();
            continue;
          }

          const toolCallId = toolEvent.toolCallId ?? generateId();
          const existingArgs = toolArgsBufferRef.current[toolCallId] ?? '';
          if (toolEvent.type === 'tool-call-streaming-start') {
            toolArgsBufferRef.current[toolCallId] = existingArgs;
            if (!toolMessageIdsRef.current[toolCallId]) {
              const streamingToolName = sanitizeToolName(toolEvent.toolName, knownToolNames);
              if (!streamingToolName) continue;
              const streamingMessageId = generateId();
              toolMessageIdsRef.current[toolCallId] = streamingMessageId;
              addMessage({
                id: streamingMessageId,
                role: 'assistant',
                content: '',
                timestamp: Date.now(),
                toolCallId,
                toolCallName: streamingToolName,
                toolCallArgs: {},
              });
              if (pendingFlush) {
                clearTimeout(pendingFlush);
                flushAssistantText();
              }
            }
            continue;
          }
          if (toolEvent.type === 'tool-call-delta') {
            toolArgsBufferRef.current[toolCallId] = existingArgs + (toolEvent.argsTextDelta ?? '');
            continue;
          }
          if (toolEvent.type === 'tool-result') {
            const streamedResultText = formatToolResult(toolEvent.result);
            const existingToolMessageId = toolMessageIdsRef.current[toolCallId];
            if (existingToolMessageId) {
              const eventToolName = sanitizeToolName(toolEvent.toolName, knownToolNames);
              updateMessage(existingToolMessageId, {
                ...(eventToolName ? { toolCallName: eventToolName } : null),
                toolCallResult: streamedResultText,
              });
              const fallbackToolResponse = eventToolName
                ? buildFallbackToolResponse(eventToolName, streamedResultText, t)
                : null;
              if (fallbackToolResponse) fallbackToolResponses.push(fallbackToolResponse);
            }
            continue;
          }

          const resolvedToolName = sanitizeToolName(toolEvent.toolName, knownToolNames);
          if (!resolvedToolName) continue;

          if (executedToolCallIdsRef.current.toolCallIds.has(toolCallId)) {
            continue;
          }
          executedToolCallIdsRef.current.toolCallIds.add(toolCallId);

          const args = parseToolArgs(toolEvent.input, toolArgsBufferRef.current[toolCallId]);
          const toolMessageId = toolMessageIdsRef.current[toolCallId] ?? generateId();
          if (!toolMessageIdsRef.current[toolCallId]) {
            toolMessageIdsRef.current[toolCallId] = toolMessageId;
            addMessage({ id: toolMessageId, role: 'assistant', content: '', timestamp: Date.now(), toolCallId, toolCallName: resolvedToolName, toolCallArgs: args });
          } else {
            updateMessage(toolMessageId, { toolCallName: resolvedToolName, toolCallArgs: args });
          }
          const toolCallKey = makeToolCallKey(resolvedToolName, args);
          if (executedToolCallsRef.current.toolCallKeys.has(toolCallKey)) {
            delete toolArgsBufferRef.current[toolCallId];
            delete toolMessageIdsRef.current[toolCallId];
            continue;
          }
          executedToolCallsRef.current.toolCallKeys.add(toolCallKey);
          const result = await executeToolCallRef(resolvedToolName, args, { messageId: toolMessageId });
          const resultText = formatExecutorResult(result);
          const fallbackToolResponse = buildFallbackToolResponse(resolvedToolName, resultText, t);
          if (fallbackToolResponse) fallbackToolResponses.push(fallbackToolResponse);
          delete toolArgsBufferRef.current[toolCallId];
          delete toolMessageIdsRef.current[toolCallId];
          if (!result.requiresConfirmation) {
            continuationSignalRef.current = { success: true };
          }
          if (result.requiresConfirmation) {
            pausedForConfirmation = true;
          }
          continue;
        }

        handledToolCount += 1;

        if (abortController.signal.aborted) {
          updateMessage(assistantMessageId, { content: assistantText || t('chat.stopped') });
        } else if (pausedForConfirmation) {
          clearContinuationSignal();
          await saveActiveThread();
          return;
        } else {
          const shouldContinue = computeShouldContinue({
            round,
            handledToolCount,
            pausedForConfirmation,
            continuationSignal: continuationSignalRef.current,
          });

          if (shouldContinue) {
            clearContinuationSignal();
            const priorMsgs = useChatStore.getState().activeThread?.messages ?? [];
            const priorAssistantMsgs = priorMsgs.filter(
              (m) => m.role === 'assistant' && (m.content || m.toolCallName),
            );
            await executeRound(round + 1, '', [], priorAssistantMsgs, null);
            return;
          }

          if (!assistantText.trim() && !pausedForConfirmation) {
            const fallbackToolText = fallbackToolResponses.join('\n\n').trim();
            if (handledToolCount > 0) {
              if (fallbackToolText) {
                assistantText = fallbackToolText;
                updateMessage(assistantMessageId, { content: assistantText });
              } else {
                removeMessage(assistantMessageId);
              }
            } else {
              updateMessage(assistantMessageId, { content: t('chat.noResponseReceived') });
              setLocalError(t('chat.emptyResponse'));
            }
          } else {
            const fallbackToolText = fallbackToolResponses.join('\n\n').trim();
            const nextContent = mergeAssistantWithToolFallback(assistantText, fallbackToolText, handledToolCount, t);
            if (!nextContent && handledToolCount > 0) removeMessage(assistantMessageId);
            else updateMessage(assistantMessageId, { content: nextContent });
          }
          await saveActiveThread().catch((err) => console.warn('[ChatScreen] saveActiveThread failed:', err));
        }

        if (abortRef.current === abortController) abortRef.current = null;
        setStreaming(false);
        setStreamStartedAt(0);
      } catch (error) {
        if (pendingFlush) clearTimeout(pendingFlush);
        if (abortRef.current === abortController) abortRef.current = null;
        setStreaming(false);
        setStreamStartedAt(0);
        const aborted = (error as Error)?.name === 'AbortError' || abortController.signal.aborted;
        if (aborted) updateMessage(assistantMessageId, { content: assistantText || t('chat.stopped') });
        else {
          const message =
            error instanceof ProviderUnavailableError
              ? describeAvailability(t, error.reason)
              : error instanceof Error
                ? error.message
                : t('chat.failedToSend');
          const fallbackToolText = fallbackToolResponses.join('\n\n').trim();
          if (hasMeaningfulAssistantText(assistantText) || handledToolCount > 0 || fallbackToolText) {
            const nextContent = mergeAssistantWithToolFallback(assistantText, fallbackToolText, handledToolCount, t);
            if (!nextContent && handledToolCount > 0) removeMessage(assistantMessageId);
            else updateMessage(assistantMessageId, { content: nextContent });
            console.warn('[ChatScreen] stream finished with visible output but failed while persisting or post-processing:', message);
          } else {
            removeMessage(assistantMessageId);
            setLocalError(message);
          }
        }
      } finally {
        if (abortRef.current === abortController) abortRef.current = null;
        setStreaming(false);
        setStreamStartedAt(0);
      }
    },
    [
      addMessage,
      clearError,
      getSelectedModelConfig,
      githubToolsEnabled,
      knownToolNames,
      noteCount,
      persistPrimedThread,
      removeMessage,
      runToolCall,
      saveActiveThread,
      setStreaming,
      t,
      todoCount,
      updateMessage,
    ],
  );

  const streamAssistantResponse = useCallback(async (text: string, contexts: AIContextItem[]) => {
    const currentThread = useChatStore.getState().activeThread;
    if (!currentThread) {
      setLocalError(t('chat.threadNotLoaded'));
      return;
    }
    continuationRoundRef.current = 0;
    continuationSignalRef.current = null;
    executedToolCallIdsRef.current = newExecutedToolCalls();
    executedToolCallsRef.current = newExecutedToolCalls();
    await executeRound(0, text, contexts, [], null);
  }, [executeRound, t]);

  const stopStreaming = useCallback(() => abortRef.current?.abort(), []);

  const handleMessageLongPress = useCallback((message: ChatMessage) => {
    if (isStreaming) return;
    if (message.role === 'user') {
      Alert.prompt?.(t('chat.editMessageTitle'), t('chat.editMessageBody'), [
        { text: t('common.cancel'), style: 'cancel' },
        { text: t('chat.send'), onPress: (newText?: string) => {
          const text = (newText ?? '').trim();
          if (!text) return;
          truncateAfter(message.id, { inclusive: true });
          void streamAssistantResponse(text, message.attachedContexts ?? []);
        } },
      ], 'plain-text', message.content);
      return;
    }

    if (message.role === 'assistant' && !message.toolCallName) {
      const currentMessages = useChatStore.getState().activeThread?.messages ?? [];
      const idx = currentMessages.findIndex((item) => item.id === message.id);
      if (idx < 0) return;
      let priorUserIdx = idx - 1;
      while (priorUserIdx >= 0 && currentMessages[priorUserIdx].role !== 'user') priorUserIdx -= 1;
      if (priorUserIdx < 0) return;
      const priorUser = currentMessages[priorUserIdx];
      Alert.alert(t('chat.regenerateTitle'), t('chat.regenerateBody'), [
        { text: t('common.cancel'), style: 'cancel' },
        { text: t('chat.regenerate'), onPress: () => {
          truncateAfter(priorUser.id);
          void streamAssistantResponse(priorUser.content, priorUser.attachedContexts ?? []);
        } },
      ]);
    }
  }, [isStreaming, streamAssistantResponse, truncateAfter, t]);

  useEffect(() => {
    if (storageAdapter) return;
    setStorageAdapter({
      loadThreadSummaries: ChatStorageService.loadThreadSummaries,
      loadThread: (owner, repo, branch, activeThreadId) => ChatStorageService.loadThread(owner, repo, activeThreadId, branch),
      saveThread: ChatStorageService.saveThread,
      deleteThread: (owner, repo, branch, activeThreadId) => ChatStorageService.deleteThread(owner, repo, activeThreadId, branch).then(() => undefined),
    });
  }, [setStorageAdapter, storageAdapter]);

  useEffect(() => {
    if (thread || !storageAdapter) return;
    const { chatRepoOwner, chatRepoName, chatRepoBranch } = useAIStore.getState();
    if (!chatRepoOwner || !chatRepoName) {
      setLocalError(t('chat.storageRepoNotConfigured'));
      return;
    }
    void loadThread({ owner: chatRepoOwner, repo: chatRepoName, branch: chatRepoBranch, threadId });
  }, [loadThread, storageAdapter, thread, threadId, t]);

  const handleRetry = useCallback(() => {
    if (retryPayload && !isStreaming) void streamAssistantResponse(retryPayload.text, retryPayload.contexts);
  }, [isStreaming, retryPayload, streamAssistantResponse]);

  // Rebuild `pendingConfirmation` from the persisted message list when this
  // controller mounts (e.g. user navigated away from a thread that paused
  // for confirmation and came back). The chip itself rides on the persisted
  // assistant message, but Apply/Cancel only work when the controller's
  // local `pendingConfirmation` state is populated — without this the chip
  // renders as a dead end. Re-issuing the tool call in confirm mode is
  // non-mutating: the executor returns `proposedChanges` instead of
  // applying them, which is exactly what we need to repopulate the state.
  useEffect(() => {
    if (isStreaming) return;
    if (pendingConfirmation) return;
    if (useAIStore.getState().actionMode !== 'confirm') return;
    if (!messages.length) return;

    const pendingMessage = [...messages].reverse().find(
      (message) =>
        message.role === 'assistant'
        && !!message.toolCallName
        && !message.toolCallResult,
    );
    if (!pendingMessage?.toolCallName) return;

    let cancelled = false;
    void (async () => {
      try {
        const result = await executeToolCall(
          pendingMessage.toolCallName as string,
          pendingMessage.toolCallArgs ?? {},
          'confirm',
        );
        if (cancelled) return;
        if (!result.requiresConfirmation || !result.proposedChanges) return;
        setPendingConfirmation({
          toolName: pendingMessage.toolCallName as string,
          args: pendingMessage.toolCallArgs ?? {},
          description: result.proposedChanges.description,
          details: result.proposedChanges.details,
          messageId: pendingMessage.id,
        });
      } catch (error) {
        console.warn('[useChatScreenController] executeToolCall for pending confirmation failed:', error);
      }
    })();

    return () => {
      cancelled = true;
    };
    // We intentionally key off `messages.length` instead of `messages` so this
    // effect doesn't refire every render (the array identity changes). When a
    // new tool call arrives mid-stream the live setter in `runToolCall`
    // populates `pendingConfirmation` directly, so we don't need to react to
    // every message mutation here.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isStreaming, messages.length, pendingConfirmation, threadId]);

  const handleConfirmApply = useCallback(async () => {
    if (!pendingConfirmation) return;
    const confirmation = pendingConfirmation;
    setPendingConfirmation(null);
    setLocalError(null);
    try {
      await runToolCall(confirmation.toolName, confirmation.args, { allowConfirmation: false, messageId: confirmation.messageId });
      executedToolCallsRef.current.toolCallKeys.add(makeToolCallKey(confirmation.toolName, confirmation.args));
      continuationSignalRef.current = { success: true };
      const priorMsgs = useChatStore.getState().activeThread?.messages ?? [];
      const priorAssistantMsgs = priorMsgs.filter(
        (m) => m.role === 'assistant' && (m.content || m.toolCallName),
      );
      await executeRound(continuationRoundRef.current + 1, '', [], priorAssistantMsgs, null);
    } catch (error) {
      setPendingConfirmation(confirmation);
      continuationSignalRef.current = null;
      setLocalError(error instanceof Error ? error.message : t('chat.failedToApplyTool'));
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [runToolCall, t, executeRound]);

  const handleConfirmCancel = useCallback(async () => {
    if (!pendingConfirmation) return;
    continuationSignalRef.current = null;
    updateMessage(pendingConfirmation.messageId, { toolCallResult: t('chat.cancelled') });
    addMessage({ id: generateId(), role: 'system', content: t('chat.cancelledAction', { description: pendingConfirmation.description }), timestamp: Date.now() });
    setPendingConfirmation(null);
    await saveActiveThread();
  }, [addMessage, pendingConfirmation, saveActiveThread, updateMessage, t]);

  const contextBudget = useCallback(() => {
    const model = useAIStore.getState().getSelectedModel();
    const attachedBytes = attachedContexts.reduce((acc, item) => acc + (item.approxBytes || 0), 0);
    const historyAttachedBytes = (thread?.messages ?? []).flatMap((message) => message.attachedContexts ?? []).reduce((acc, item) => acc + (item.approxBytes || 0), 0);
    const historyTextBytes = (thread?.messages ?? []).reduce((acc, message) => acc + (message.content?.length || 0) + (message.toolCallResult?.length || 0), 0);
    return checkContextBudget(model, attachedBytes + historyAttachedBytes + historyTextBytes + 600);
  }, [attachedContexts, thread?.messages]);

  const handleSend = useCallback((text: string): void | Promise<void> => {
    if (!text.trim() || isStreaming || isLoading) return;
    return streamAssistantResponse(text, attachedContexts);
  }, [attachedContexts, isLoading, isStreaming, streamAssistantResponse]);

  return {
    attachedContexts,
    setAttachedContexts,
    isContextPickerVisible,
    setIsContextPickerVisible,
    pendingConfirmation,
    retryPayload,
    localError,
    setLocalError,
    storeError,
    thread,
    messages,
    isLoading,
    isStreaming,
    streamStartedAt,
    contextBudget: contextBudget(),
    handleSend,
    stopStreaming,
    handleMessageLongPress,
    handleRetry,
    handleConfirmApply,
    handleConfirmCancel,
    clearError,
  };
}
