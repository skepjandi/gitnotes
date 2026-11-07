import type { ModelMessage } from 'ai';
import type { ChatMessage } from '../../../models/Chat';
import { useAIStore } from '../../../stores/aiStore';
import { useNoteStore } from '../../../stores/noteStore';
import { useTodoStore } from '../../../stores/todoStore';
import { generateId } from '../../../utils/ids';
import * as AIService from '../../AIService';
import type { ModelStreamPart } from '../../AIService';
import { AuthService } from '../../AuthService';
import { buildContextString } from '../../ContextService';
import { executeToolCall } from '../../ai/actionExecutor';
import type { ActionExecutorResult } from '../../ai/actionExecutor';
import { MAX_TOOL_ROUNDS } from '../../ai/config';
import { ProviderUnavailableError } from '../../ai/providerAvailability';
import { describeAvailability } from '../../ai/providerAvailabilityCopy';
import { buildSystemPrompt } from '../../ai/systemPrompt';
import { chatT } from '../copy';
import { applyChatEvent } from '../reducer';
import type { ChatBackend, ChatEvent, ChatRunInput, PermissionOption } from '../types';
import { toContinuationMessages } from './continuationMessages';
import {
  decodeOverEscapedChunk,
  dedupeContexts,
  formatExecutorResult,
  formatHistoryMessage,
  isModelHistoryMessage,
  parseToolArgs,
} from './modelHistory';
import { buildMemoryBlockForQuery } from './modelPrompt';
import {
  buildChatToolsMap,
  buildFallbackToolResponse,
  executeWithTimeout,
  isIosSharedPasteboardPath,
  makeToolCallKey,
  sanitizeToolName,
  toolFallbackText,
  withoutExecute,
} from './modelTools';

const APPLY_OPTION_ID = 'apply';
const CANCEL_OPTION_ID = 'cancel';
const PERMISSION_DETAILS_MAX_CHARS = 1500;

interface RoundCall {
  /** Id unique within the thread, used for the message and the history sent back to the provider. */
  id: string;
  name: string;
  args: Record<string, unknown>;
  /** True once the provider delivered the finished `tool-call` (as opposed to only streamed input). */
  complete: boolean;
}

interface ToolOutcome {
  text: string;
  success: boolean;
  rejected: boolean;
}

function describeDetails(details: Record<string, unknown>): string | undefined {
  try {
    const json = JSON.stringify(details, null, 2);
    if (!json || json === '{}') return undefined;
    return json.length > PERMISSION_DETAILS_MAX_CHARS ? `${json.slice(0, PERMISSION_DETAILS_MAX_CHARS)}…` : json;
  } catch {
    return undefined;
  }
}

async function runTool(
  name: string,
  args: Record<string, unknown>,
  mode: 'auto' | 'confirm',
): Promise<ActionExecutorResult> {
  try {
    return await executeWithTimeout(executeToolCall(name, args, mode));
  } catch (error) {
    const message =
      error instanceof Error && error.message === 'TIMEOUT'
        ? chatT('chat.toolTimedOut', { defaultValue: 'The tool timed out.' })
        : error instanceof Error
          ? error.message
          : chatT('chat.toolExecutionFailed');
    return { success: false, error: message, requiresConfirmation: false };
  }
}

/**
 * Executes one finished tool call, asking the user first when the executor wants confirmation.
 * Yields the tool message updates and returns what to feed back to the model.
 */
async function* executeCall(
  call: RoundCall,
  input: ChatRunInput,
): AsyncGenerator<ChatEvent, ToolOutcome> {
  yield { type: 'tool-update', toolCallId: call.id, patch: { status: 'running', args: call.args } };

  let result = await runTool(call.name, call.args, useAIStore.getState().actionMode);

  if (result.requiresConfirmation && result.proposedChanges) {
    const options: PermissionOption[] = [
      { id: APPLY_OPTION_ID, label: chatT('common.apply'), kind: 'allow_once' },
      { id: CANCEL_OPTION_ID, label: chatT('common.cancel'), kind: 'reject_once' },
    ];
    yield { type: 'tool-update', toolCallId: call.id, patch: { status: 'awaiting-approval' } };
    const decision = await input.requestPermission({
      toolCallId: call.id,
      title: result.proposedChanges.description,
      description: describeDetails(result.proposedChanges.details),
      options,
    });

    if (decision.optionId !== APPLY_OPTION_ID) {
      const text = chatT('chat.cancelled');
      yield { type: 'tool-update', toolCallId: call.id, patch: { status: 'rejected', result: text } };
      return { text, success: false, rejected: true };
    }
    yield { type: 'tool-update', toolCallId: call.id, patch: { status: 'running' } };
    result = await runTool(call.name, call.args, 'auto');
  }

  const text = formatExecutorResult(result);
  yield {
    type: 'tool-update',
    toolCallId: call.id,
    patch: { status: result.success ? 'completed' : 'failed', result: text },
  };
  return { text, success: result.success, rejected: false };
}

async function initializeSelectedModel() {
  const aiState = useAIStore.getState();
  const model = aiState.getSelectedModel();
  if (!model) throw new Error(chatT('chat.selectModelFirst'));
  const provider = aiState.providers.find((item) => item.id === model.providerId);
  try {
    return { model, instance: await AIService.initializeModel(model, provider) };
  } catch (error) {
    if (error instanceof ProviderUnavailableError) throw new Error(describeAvailability(chatT, error.reason));
    throw error;
  }
}

async function* runModelTurn(input: ChatRunInput): AsyncGenerator<ChatEvent> {
  const { thread, signal } = input;
  const aiState = useAIStore.getState();
  const githubToolsEnabled = aiState.githubToolsEnabled;
  const toolsEnabled = aiState.aiPersonalizationEnabled;

  const githubAccountLogin = githubToolsEnabled ? (await AuthService.checkAuthState()).user?.login : undefined;
  const { model, instance } = await initializeSelectedModel();

  const aggregatedContexts = dedupeContexts([
    ...thread.messages.flatMap((message) => message.attachedContexts ?? []),
    ...input.contexts,
  ]);
  const contextString = aggregatedContexts.length ? await buildContextString(aggregatedContexts) : undefined;

  const promptOptions = {
    attachedContexts: contextString,
    noteCount: useNoteStore.getState().notes.length,
    todoCount: useTodoStore.getState().todos.length,
    actionMode: aiState.actionMode,
    githubToolsEnabled,
    githubAccountLogin,
    toolsEnabled,
  };
  const basePrompt = buildSystemPrompt(promptOptions);
  const memoryBlock = input.userText.trim()
    ? await buildMemoryBlockForQuery(input.userText.trim(), model, basePrompt.length)
    : null;
  const system: ModelMessage = {
    role: 'system',
    content: memoryBlock ? buildSystemPrompt({ ...promptOptions, memoryBlock }) : basePrompt,
  };

  const toolMap = buildChatToolsMap(githubToolsEnabled);
  const knownToolNames = new Set(Object.keys(toolMap));
  const tools = toolsEnabled ? withoutExecute(toolMap) : undefined;

  const history = thread.messages.filter(isModelHistoryMessage).map(formatHistoryMessage);

  // The turn's own messages, kept so later rounds can send real tool-call/tool-result history.
  let turnMessages: ChatMessage[] = thread.messages;
  const track = (event: ChatEvent): ChatEvent => {
    turnMessages = applyChatEvent(turnMessages, event, { now: Date.now, newId: generateId });
    return event;
  };

  const usedCallIds = new Set(thread.messages.flatMap((message) => (message.toolCallId ? [message.toolCallId] : [])));
  const resultsByCallKey = new Map<string, string>();
  let producedText = false;
  let handledToolCount = 0;
  let stopReason = 'end_turn';

  for (let round = 0; round < MAX_TOOL_ROUNDS && !signal.aborted; round += 1) {
    const request = round === 0 ? [system, ...history] : [system, ...toContinuationMessages(turnMessages)];

    const calls = new Map<string, RoundCall>();
    const streamedArgs = new Map<string, string>();
    let roundText = '';

    const registerCall = (providerId: string, name: string): RoundCall => {
      const existing = calls.get(providerId);
      if (existing) return existing;
      let id = providerId;
      for (let suffix = 2; usedCallIds.has(id); suffix += 1) id = `${providerId}-${suffix}`;
      usedCallIds.add(id);
      const call: RoundCall = { id, name, args: {}, complete: false };
      calls.set(providerId, call);
      return call;
    };

    const handlePart = function* (part: ModelStreamPart): Generator<ChatEvent> {
      switch (part.type) {
        case 'text-delta': {
          const text = decodeOverEscapedChunk(part.text);
          if (isIosSharedPasteboardPath(text)) return;
          roundText += text;
          producedText ||= text.trim().length > 0;
          yield track({ type: 'text-delta', text });
          return;
        }
        case 'tool-input-start': {
          const name = sanitizeToolName(part.toolName, knownToolNames);
          if (!name || calls.has(part.toolCallId)) return;
          const call = registerCall(part.toolCallId, name);
          yield track({ type: 'tool-start', toolCallId: call.id, patch: { name, status: 'pending' } });
          return;
        }
        case 'tool-input-delta':
          streamedArgs.set(part.toolCallId, (streamedArgs.get(part.toolCallId) ?? '') + part.delta);
          return;
        case 'tool-call': {
          const name = sanitizeToolName(part.toolName, knownToolNames);
          if (!name) return;
          const known = calls.has(part.toolCallId);
          const call = registerCall(part.toolCallId, name);
          call.args = parseToolArgs(part.input, streamedArgs.get(part.toolCallId));
          call.complete = true;
          yield track({
            type: known ? 'tool-update' : 'tool-start',
            toolCallId: call.id,
            patch: { name, status: 'pending', args: call.args },
          });
          return;
        }
        case 'tool-result':
          // Providers that run tools themselves echo the arguments back as the "result".
          // The app executes tools itself, so that echo is not a result.
          return;
      }
    };

    for await (const part of AIService.streamChatEvents(instance, request, tools, signal)) {
      if (signal.aborted) break;
      yield* handlePart(part);
    }

    if (signal.aborted) break;

    const fallbacks: string[] = [];
    let executedThisRound = 0;
    let rejected = false;
    for (const call of calls.values()) {
      if (!call.complete) continue;
      if (signal.aborted) break;
      handledToolCount += 1;

      const key = makeToolCallKey(call.name, call.args);
      const earlier = resultsByCallKey.get(key);
      if (earlier !== undefined) {
        yield track({ type: 'tool-update', toolCallId: call.id, patch: { status: 'completed', result: earlier } });
        continue;
      }

      const execution = executeCall(call, input);
      let step = await execution.next();
      while (!step.done) {
        yield track(step.value);
        step = await execution.next();
      }
      const outcome = step.value;
      resultsByCallKey.set(key, outcome.text);
      executedThisRound += 1;
      rejected ||= outcome.rejected;
      const fallback = outcome.success ? buildFallbackToolResponse(call.name, outcome.text, chatT) : null;
      if (fallback) fallbacks.push(fallback);
    }

    const keepGoing = executedThisRound > 0 && !rejected && !signal.aborted;
    if (keepGoing && round + 1 < MAX_TOOL_ROUNDS) continue;
    if (keepGoing) stopReason = 'max_tool_rounds';

    const extra = toolFallbackText(roundText, fallbacks.join('\n\n'));
    if (extra) {
      producedText = true;
      yield track({ type: 'text-delta', text: extra });
    }
    break;
  }

  if (signal.aborted) {
    yield { type: 'turn-end', stopReason: 'cancelled' };
    return;
  }
  if (!producedText && handledToolCount === 0) throw new Error(chatT('chat.emptyResponse'));
  yield { type: 'turn-end', stopReason };
}

export const modelBackend: ChatBackend = {
  type: 'model',
  run: runModelTurn,
};
