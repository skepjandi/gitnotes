import type { ModelMessage } from 'ai';
import type { AIContextItem } from '../../../models/AIProvider';
import type { ChatMessage } from '../../../models/Chat';
import type { ActionExecutorResult } from '../../ai/actionExecutor';

export function dedupeContexts(items: AIContextItem[]): AIContextItem[] {
  const map = new Map<string, AIContextItem>();
  for (const item of items) {
    const key = `${item.type}:${item.owner}/${item.repo}/${item.path}@${item.branch ?? ''}`;
    if (!map.has(key)) map.set(key, item);
  }
  return [...map.values()];
}

// Some providers (notably Ring-2.6-1T via OpenRouter) emit assistant text as a
// JSON-stringified value — a quoted string with `\n`/`\t`/`\"` escape
// sequences. The Markdown renderer takes that literally and shows backslash-n
// instead of newlines. Detect over-escaped chunks and decode them so the
// reader sees real whitespace. Conservative: only triggers on chunks that
// (a) parse as a JSON string AND (b) look quoted/escaped, so plain markdown
// text — which never starts with a `"` or `{` — passes through untouched.
export function decodeOverEscapedChunk(chunk: string): string {
  if (!chunk) return chunk;
  const trimmed = chunk.trim();
  if (!trimmed) return chunk;
  const looksQuoted = trimmed.startsWith('"') && trimmed.endsWith('"');
  const looksEscaped = trimmed.includes('\\n') || trimmed.includes('\\t') || trimmed.includes('\\"');
  if (!looksQuoted || !looksEscaped) return chunk;
  try {
    const parsed: unknown = JSON.parse(trimmed);
    if (typeof parsed === 'string') return parsed;
  } catch {
    // fall through to return chunk unchanged
  }
  return chunk;
}

/** Tool arguments from the finished tool-call input, falling back to the streamed JSON text. */
export function parseToolArgs(value: unknown, fallback = ''): Record<string, unknown> {
  if (typeof value === 'object' && value !== null && !Array.isArray(value)) return value as Record<string, unknown>;
  const streamed = typeof value === 'string' && value.trim() ? value : fallback;
  if (!streamed.trim()) return {};
  try {
    const parsed: unknown = JSON.parse(streamed);
    return typeof parsed === 'object' && parsed !== null && !Array.isArray(parsed)
      ? (parsed as Record<string, unknown>)
      : {};
  } catch {
    return {};
  }
}

// A tool bubble can carry `toolCallArgs` that fail to serialise (circular
// refs, BigInt, throwing getters) — never let that abort the request-history
// build for an otherwise healthy thread.
function stringifyToolCallArgs(args: Record<string, unknown> | undefined): string {
  try {
    return JSON.stringify(args ?? {});
  } catch {
    return '[unserializable]';
  }
}

export function formatHistoryMessage(message: ChatMessage): ModelMessage {
  const content =
    message.content
    || (message.toolCallName
      ? `${message.toolCallName}: ${stringifyToolCallArgs(message.toolCallArgs)}${message.toolCallResult ? `\nResult: ${message.toolCallResult}` : ''}`
      : '');

  return { role: message.role, content };
}

/** History worth sending to a model: drops thoughts, plans and messages that carry nothing. */
export function isModelHistoryMessage(message: ChatMessage): boolean {
  if (message.kind === 'thought' || message.kind === 'plan') return false;
  return message.content.trim().length > 0 || !!message.toolCallName;
}

export function formatToolResult(value: unknown): string {
  if (typeof value === 'string') return value;
  if (value == null) return 'Done.';
  try {
    return JSON.stringify(value, null, 2);
  } catch {
    return 'Done.';
  }
}

export function formatExecutorResult(result: ActionExecutorResult): string {
  if (!result.success) return result.error ?? 'Tool execution failed.';
  if (result.requiresConfirmation && result.proposedChanges) return result.proposedChanges.description;
  return formatToolResult(result.data);
}
