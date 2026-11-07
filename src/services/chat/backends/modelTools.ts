import type { Tool } from 'ai';
import type { TFunction } from 'i18next';
import { useAIStore } from '../../../stores/aiStore';
import type { ActionExecutorResult } from '../../ai/actionExecutor';
import { TOOL_EXECUTION_TIMEOUT_MS } from '../../ai/config';
import { chatTools, githubTools } from '../../ai/tools';

export function buildChatToolsMap(enabled: boolean = useAIStore.getState().githubToolsEnabled): Record<string, Tool> {
  return enabled ? { ...chatTools, ...githubTools } : chatTools;
}

/**
 * The SDK would run any tool that has an `execute`. Tool calls here go through
 * `executeToolCall` (confirmation, timeout, result formatting), so the model only
 * gets the schemas.
 */
export function withoutExecute(tools: Record<string, Tool>): Record<string, Tool> {
  const schemaOnly: Record<string, Tool> = {};
  for (const [name, definition] of Object.entries(tools)) {
    const schema = { ...definition };
    delete schema.execute;
    schemaOnly[name] = schema as Tool;
  }
  return schemaOnly;
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

export function makeToolCallKey(toolName: string, args: Record<string, unknown>): string {
  return `${toolName}:${JSON.stringify(args)}`;
}

/**
 * Wraps a tool-call promise with a timeout. Settles within TOOL_EXECUTION_TIMEOUT_MS;
 * rejects with Error('TIMEOUT') on timeout.
 */
export async function executeWithTimeout(toolPromise: Promise<ActionExecutorResult>): Promise<ActionExecutorResult> {
  let timeoutId: ReturnType<typeof setTimeout> | undefined;
  try {
    return await Promise.race([
      toolPromise,
      new Promise<never>((_, reject) => {
        timeoutId = setTimeout(() => {
          reject(new Error('TIMEOUT'));
        }, TOOL_EXECUTION_TIMEOUT_MS);
      }),
    ]);
  } finally {
    clearTimeout(timeoutId);
  }
}

interface ToolListItem {
  title?: string;
  text?: string;
  completed?: boolean;
}

function parseToolListItems(raw: string): ToolListItem[] | null {
  try {
    const parsed: unknown = JSON.parse(raw);
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

/** Readable summary of a search tool's JSON result, shown when the model produces no prose of its own. */
export function buildFallbackToolResponse(toolName: string, rawResult: string, t: TFunction): string | null {
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

/**
 * Detects iOS/macOS shared pasteboard RTFD file paths that the Apple Intelligence
 * native layer can leak as text deltas when processing rich text content.
 * These are internal system paths and must never be displayed as assistant output.
 */
export function isIosSharedPasteboardPath(value: string): boolean {
  return /\/(?:Users\/[^/]+|var\/mobile\/[^/]+)\/.*shared-pasteboard\//.test(value.trim());
}

export function hasMeaningfulAssistantText(value: string): boolean {
  const trimmed = value.trim();
  if (!trimmed) return false;
  if (isIosSharedPasteboardPath(trimmed)) return false;
  const normalized = trimmed.toLowerCase();
  return normalized !== 'show' && normalized !== 'hide';
}

/**
 * Text to append after a tool round so the user sees a usable answer when the model
 * only called tools (or said nothing meaningful). Null when the prose already covers it.
 */
export function toolFallbackText(assistantText: string, fallbackToolText: string): string | null {
  const fallback = fallbackToolText.trim();
  if (!fallback) return null;
  const assistant = assistantText.trim();
  if (hasMeaningfulAssistantText(assistant) && assistant.includes(fallback)) return null;
  return fallback;
}
