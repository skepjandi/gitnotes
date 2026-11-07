import type { ChatMessage, ToolStatus } from '../../models/Chat';
import type { ChatEvent, ToolPatch } from './types';

export interface ReducerDeps {
  now(): number;
  newId(): string;
}

const TERMINAL_TOOL_STATUSES: ReadonlySet<ToolStatus> = new Set(['completed', 'failed', 'rejected']);

const OPEN_TOOL_STATUSES: ReadonlySet<ToolStatus> = new Set(['pending', 'awaiting-approval', 'running']);

export function isTerminalToolStatus(status: ToolStatus | undefined): boolean {
  return status !== undefined && TERMINAL_TOOL_STATUSES.has(status);
}

function isToolMessage(message: ChatMessage): boolean {
  return message.kind === 'tool' || (message.kind === undefined && !!message.toolCallName);
}

function messageKind(message: ChatMessage): NonNullable<ChatMessage['kind']> {
  if (message.kind) return message.kind;
  return message.toolCallName ? 'tool' : 'text';
}

/** Index of the message a tool call belongs to, searching only the current turn (back to the last user message). */
function findToolIndex(messages: ChatMessage[], toolCallId: string): number {
  for (let i = messages.length - 1; i >= 0; i -= 1) {
    const message = messages[i];
    if (message.role === 'user') return -1;
    if (message.toolCallId === toolCallId && isToolMessage(message)) return i;
  }
  return -1;
}

export function findToolMessage(messages: ChatMessage[], toolCallId: string): ChatMessage | undefined {
  const index = findToolIndex(messages, toolCallId);
  return index >= 0 ? messages[index] : undefined;
}

function findPlanIndex(messages: ChatMessage[]): number {
  for (let i = messages.length - 1; i >= 0; i -= 1) {
    const message = messages[i];
    if (message.role === 'user') return -1;
    if (message.kind === 'plan') return i;
  }
  return -1;
}

function replaceAt(messages: ChatMessage[], index: number, next: ChatMessage): ChatMessage[] {
  const copy = messages.slice();
  copy[index] = next;
  return copy;
}

function appendDelta(
  messages: ChatMessage[],
  kind: 'text' | 'thought',
  text: string,
  deps: ReducerDeps,
): ChatMessage[] {
  if (!text) return messages;
  const lastIndex = messages.length - 1;
  const tail = lastIndex >= 0 ? messages[lastIndex] : undefined;
  if (tail && tail.role === 'assistant' && messageKind(tail) === kind) {
    return replaceAt(messages, lastIndex, { ...tail, content: tail.content + text });
  }
  return [
    ...messages,
    { id: deps.newId(), role: 'assistant', kind, content: text, timestamp: deps.now() },
  ];
}

function mergeToolPatch(message: ChatMessage, patch: ToolPatch): ChatMessage {
  const next: ChatMessage = { ...message };
  const name = patch.name ?? patch.title;
  if (patch.name !== undefined) next.toolCallName = patch.name;
  else if (!next.toolCallName && name) next.toolCallName = name;
  if (patch.title !== undefined) next.toolTitle = patch.title;
  if (patch.kind !== undefined) next.toolKind = patch.kind;
  if (patch.args !== undefined) next.toolCallArgs = patch.args;
  if (patch.result !== undefined) next.toolCallResult = patch.result;
  if (patch.diffs !== undefined) next.toolDiffs = patch.diffs;
  if (patch.locations !== undefined) next.toolLocations = patch.locations;
  if (patch.status !== undefined && !isTerminalToolStatus(message.toolStatus)) {
    next.toolStatus = patch.status;
  }
  return next;
}

function upsertTool(
  messages: ChatMessage[],
  toolCallId: string,
  patch: ToolPatch,
  deps: ReducerDeps,
): ChatMessage[] {
  const index = findToolIndex(messages, toolCallId);
  if (index >= 0) return replaceAt(messages, index, mergeToolPatch(messages[index], patch));

  const created: ChatMessage = {
    id: deps.newId(),
    role: 'assistant',
    kind: 'tool',
    content: '',
    timestamp: deps.now(),
    toolCallId,
    toolCallName: patch.name ?? patch.title ?? patch.kind ?? 'tool',
    toolCallArgs: {},
    toolStatus: 'pending',
  };
  return [...messages, mergeToolPatch(created, patch)];
}

function dropEmptyAssistantTail(messages: ChatMessage[]): ChatMessage[] {
  let result = messages;
  for (let i = messages.length - 1; i >= 0; i -= 1) {
    const message = messages[i];
    if (message.role === 'user') break;
    const kind = messageKind(message);
    if (message.role === 'assistant' && (kind === 'text' || kind === 'thought') && message.content.trim() === '') {
      if (result === messages) result = messages.slice();
      result.splice(i, 1);
    }
  }
  return result;
}

/**
 * Marks tool calls of the current turn that never reached a terminal status
 * (aborted turn, dead connection, killed app) so they stop looking like they are running.
 */
export function settleInterruptedTools(messages: ChatMessage[]): ChatMessage[] {
  let result = messages;
  for (let i = messages.length - 1; i >= 0; i -= 1) {
    const message = messages[i];
    if (message.role === 'user') break;
    if (!isToolMessage(message) || !message.toolStatus || !OPEN_TOOL_STATUSES.has(message.toolStatus)) continue;
    if (result === messages) result = messages.slice();
    result[i] = { ...message, toolStatus: message.toolStatus === 'awaiting-approval' ? 'rejected' : 'failed' };
  }
  return result;
}

/**
 * Folds one backend event into the message list. Pure: returns the input array
 * when nothing changes, otherwise a new array sharing every untouched message.
 */
export function applyChatEvent(messages: ChatMessage[], event: ChatEvent, deps: ReducerDeps): ChatMessage[] {
  switch (event.type) {
    case 'text-delta':
      return appendDelta(messages, 'text', event.text, deps);
    case 'thought-delta':
      return appendDelta(messages, 'thought', event.text, deps);
    case 'tool-start':
    case 'tool-update':
      return upsertTool(messages, event.toolCallId, event.patch, deps);
    case 'plan': {
      const index = findPlanIndex(messages);
      if (index >= 0) return replaceAt(messages, index, { ...messages[index], plan: event.entries });
      return [
        ...messages,
        { id: deps.newId(), role: 'assistant', kind: 'plan', content: '', timestamp: deps.now(), plan: event.entries },
      ];
    }
    case 'turn-end':
      return dropEmptyAssistantTail(messages);
    case 'agent-state':
      return messages;
  }
}
