import type { ChatMessage, ToolKind, ToolStatus } from '../../models/Chat';
import type { PermissionRequest, QueuedPrompt } from '../../services/chat/types';
import { resolveMessageKind, resolveToolStatus } from './toolPresentation';

/** A pause longer than this between two messages gets a timestamp divider. */
export const TIMESTAMP_GAP_MS = 30 * 60 * 1000;

export type TimelineItem =
  | { kind: 'time'; key: string; timestamp: number }
  | { kind: 'user'; key: string; message: ChatMessage }
  | { kind: 'reply'; key: string; message: ChatMessage }
  | { kind: 'thought'; key: string; message: ChatMessage }
  | { kind: 'plan'; key: string; message: ChatMessage }
  | { kind: 'notice'; key: string; message: ChatMessage }
  | { kind: 'work'; key: string; messages: ChatMessage[] }
  | { kind: 'needs'; key: string; request: PermissionRequest }
  | { kind: 'queued'; key: string; prompt: QueuedPrompt };

export type WorkCounter = 'commands' | 'edits' | 'reads' | 'searches' | 'fetches' | 'steps';

export interface WorkCount {
  counter: WorkCounter;
  count: number;
}

export type WorkStatus = Extract<ToolStatus, 'awaiting-approval' | 'running' | 'failed' | 'completed'>;

const COUNTER_BY_KIND: Record<ToolKind, WorkCounter> = {
  execute: 'commands',
  edit: 'edits',
  delete: 'edits',
  move: 'edits',
  read: 'reads',
  search: 'searches',
  fetch: 'fetches',
  think: 'steps',
  switch_mode: 'steps',
  other: 'steps',
};

const COUNTER_ORDER: readonly WorkCounter[] = ['commands', 'edits', 'reads', 'searches', 'fetches', 'steps'];

function itemFor(message: ChatMessage): TimelineItem | null {
  if (message.role === 'system') return { kind: 'notice', key: message.id, message };
  switch (resolveMessageKind(message)) {
    case 'thought':
      return { kind: 'thought', key: message.id, message };
    case 'plan':
      return message.plan ? { kind: 'plan', key: message.id, message } : null;
    case 'tool':
      return null;
    case 'text':
      return message.role === 'user'
        ? { kind: 'user', key: message.id, message }
        : { kind: 'reply', key: message.id, message };
  }
}

/**
 * Flattens a transcript into the rows the chat list renders: consecutive tool calls fold into one
 * work row, open approvals sit right after the work that asked for them, and prompts typed while a
 * turn runs trail the transcript.
 */
export function buildTimeline(
  messages: readonly ChatMessage[],
  pendingPermissions: readonly PermissionRequest[] = [],
  queuedPrompts: readonly QueuedPrompt[] = [],
): TimelineItem[] {
  const items: TimelineItem[] = [];
  let work: Extract<TimelineItem, { kind: 'work' }> | null = null;
  let previousTimestamp: number | null = null;

  for (const message of messages) {
    if (Number.isFinite(message.timestamp) && message.timestamp > 0) {
      if (previousTimestamp !== null && message.timestamp - previousTimestamp >= TIMESTAMP_GAP_MS) {
        items.push({ kind: 'time', key: `time:${message.id}`, timestamp: message.timestamp });
        work = null;
      }
      previousTimestamp = message.timestamp;
    }

    if (resolveMessageKind(message) === 'tool' && message.role !== 'system') {
      if (work) work.messages.push(message);
      else {
        work = { kind: 'work', key: `work:${message.id}`, messages: [message] };
        items.push(work);
      }
      continue;
    }

    work = null;
    const item = itemFor(message);
    if (item) items.push(item);
  }

  const unplaced: PermissionRequest[] = [];
  for (const request of pendingPermissions) {
    const anchor = request.toolCallId
      ? items.findIndex(
          (item) => item.kind === 'work' && item.messages.some((message) => message.toolCallId === request.toolCallId),
        )
      : -1;
    if (anchor === -1) unplaced.push(request);
    else items.splice(anchor + 1, 0, { kind: 'needs', key: `needs:${request.id}`, request });
  }
  for (const request of unplaced) items.push({ kind: 'needs', key: `needs:${request.id}`, request });

  for (const prompt of queuedPrompts) items.push({ kind: 'queued', key: `queued:${prompt.id}`, prompt });
  return items;
}

export function summarizeWork(messages: readonly ChatMessage[]): WorkCount[] {
  const totals = new Map<WorkCounter, number>();
  for (const message of messages) {
    const counter = COUNTER_BY_KIND[message.toolKind ?? 'other'];
    totals.set(counter, (totals.get(counter) ?? 0) + 1);
  }
  return COUNTER_ORDER.flatMap((counter) => {
    const count = totals.get(counter);
    return count ? [{ counter, count }] : [];
  });
}

/** The most urgent state in the group: approval > running > failed > completed. */
export function workStatus(messages: readonly ChatMessage[], isStreaming: boolean): WorkStatus {
  let failed = false;
  let running = false;
  for (const message of messages) {
    const status = resolveToolStatus(message, isStreaming && message === messages[messages.length - 1]);
    if (status === 'awaiting-approval') return 'awaiting-approval';
    if (status === 'running' || status === 'pending') running = true;
    if (status === 'failed' || status === 'rejected') failed = true;
  }
  if (running) return 'running';
  return failed ? 'failed' : 'completed';
}
