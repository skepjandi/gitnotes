import type { PlanEntry, ToolDiff, ToolKind, ToolLocation, ToolStatus } from '../../models/Chat';
import type { ChatEventBody, ToolPatch } from '../chat/types';
import type {
  AcpContentBlock,
  AcpPlanEntry,
  AcpSessionUpdate,
  AcpToolCallContent,
  AcpToolCallFields,
} from './acpTypes';

const MAX_TOOL_RESULT_CHARS = 20_000;

const TOOL_KINDS: ReadonlySet<string> = new Set<ToolKind>([
  'read',
  'edit',
  'delete',
  'move',
  'search',
  'execute',
  'think',
  'fetch',
  'switch_mode',
  'other',
]);

const TOOL_STATUS_BY_ACP: Readonly<Record<string, ToolStatus>> = {
  pending: 'pending',
  in_progress: 'running',
  completed: 'completed',
  failed: 'failed',
};

const PLAN_STATUSES: ReadonlySet<string> = new Set(['pending', 'in_progress', 'completed']);
const PLAN_PRIORITIES: ReadonlySet<string> = new Set(['high', 'medium', 'low']);

function truncate(text: string): string {
  return text.length > MAX_TOOL_RESULT_CHARS ? `${text.slice(0, MAX_TOOL_RESULT_CHARS)}\n…[truncated]` : text;
}

/** Text of a block, or a short placeholder for content a phone transcript cannot show inline. */
export function contentBlockText(block: AcpContentBlock | null | undefined): string {
  if (!block || typeof block !== 'object') return '';
  switch (block.type) {
    case 'text':
      return typeof block.text === 'string' ? block.text : '';
    case 'image':
      return '[image]';
    case 'audio':
      return '[audio]';
    case 'resource_link':
      return `[resource: ${block.name ?? block.uri}]`;
    case 'resource':
      return `[resource: ${block.resource?.uri ?? 'embedded'}]`;
    default:
      return '';
  }
}

function toolContentText(content: AcpToolCallContent[]): string {
  const parts: string[] = [];
  for (const item of content) {
    if (item.type === 'content') {
      const text = contentBlockText(item.content);
      if (text) parts.push(text);
    } else if (item.type === 'terminal') {
      parts.push('[terminal]');
    }
  }
  return parts.join('\n');
}

function toolContentDiffs(content: AcpToolCallContent[]): ToolDiff[] {
  const diffs: ToolDiff[] = [];
  for (const item of content) {
    if (item.type === 'diff' && typeof item.path === 'string' && typeof item.newText === 'string') {
      diffs.push({ path: item.path, oldText: item.oldText ?? null, newText: item.newText });
    }
  }
  return diffs;
}

function stringifyRaw(value: unknown): string {
  if (typeof value === 'string') return value;
  try {
    return JSON.stringify(value, null, 2) ?? '';
  } catch {
    return '';
  }
}

function toolArgs(rawInput: unknown): Record<string, unknown> | undefined {
  if (rawInput === undefined || rawInput === null) return undefined;
  if (typeof rawInput === 'object' && !Array.isArray(rawInput)) return rawInput as Record<string, unknown>;
  return { input: rawInput };
}

function toolLocations(locations: AcpToolCallFields['locations']): ToolLocation[] | undefined {
  if (!Array.isArray(locations)) return undefined;
  const mapped: ToolLocation[] = [];
  for (const location of locations) {
    if (location && typeof location.path === 'string') {
      mapped.push(typeof location.line === 'number' ? { path: location.path, line: location.line } : { path: location.path });
    }
  }
  return mapped;
}

/** Fields a `tool_call` / `tool_call_update` / permission request's `toolCall` carries, as a chat patch. Absent fields stay absent. */
export function mapToolCallPatch(fields: AcpToolCallFields): ToolPatch {
  const patch: ToolPatch = {};
  if (typeof fields.name === 'string' && fields.name) patch.name = fields.name;
  if (typeof fields.title === 'string' && fields.title) patch.title = fields.title;
  if (typeof fields.kind === 'string') patch.kind = TOOL_KINDS.has(fields.kind) ? fields.kind : 'other';
  if (typeof fields.status === 'string') {
    const status = TOOL_STATUS_BY_ACP[fields.status];
    if (status) patch.status = status;
  }
  const args = toolArgs(fields.rawInput);
  if (args) patch.args = args;

  if (Array.isArray(fields.content)) {
    patch.diffs = toolContentDiffs(fields.content);
    const text = toolContentText(fields.content);
    if (text) patch.result = truncate(text);
    else if (fields.rawOutput !== undefined && fields.rawOutput !== null) patch.result = truncate(stringifyRaw(fields.rawOutput));
    else patch.result = '';
  } else if (fields.rawOutput !== undefined && fields.rawOutput !== null) {
    patch.result = truncate(stringifyRaw(fields.rawOutput));
  }

  const locations = toolLocations(fields.locations);
  if (locations) patch.locations = locations;
  return patch;
}

function mapPlanEntries(entries: AcpPlanEntry[]): PlanEntry[] {
  const mapped: PlanEntry[] = [];
  for (const entry of entries) {
    if (!entry || typeof entry.content !== 'string') continue;
    mapped.push({
      content: entry.content,
      status: entry.status && PLAN_STATUSES.has(entry.status) ? entry.status : 'pending',
      ...(entry.priority && PLAN_PRIORITIES.has(entry.priority) ? { priority: entry.priority } : {}),
    });
  }
  return mapped;
}

function toolDisplayName(fields: AcpToolCallFields, patch: ToolPatch): string {
  return patch.name ?? fields.title ?? patch.kind ?? 'tool';
}

/**
 * ACP `session/update` -> chat events. Pure; variants this app does not render
 * (`user_message_chunk`, `available_commands_update`, anything newer) map to nothing.
 */
export function mapSessionUpdate(update: AcpSessionUpdate): ChatEventBody[] {
  switch (update.sessionUpdate) {
    case 'agent_message_chunk': {
      const text = contentBlockText((update as { content?: AcpContentBlock }).content);
      return text ? [{ type: 'text-delta', text }] : [];
    }
    case 'agent_thought_chunk': {
      const text = contentBlockText((update as { content?: AcpContentBlock }).content);
      return text ? [{ type: 'thought-delta', text }] : [];
    }
    case 'tool_call': {
      const fields = update as AcpToolCallFields;
      if (typeof fields.toolCallId !== 'string') return [];
      const patch = mapToolCallPatch(fields);
      return [
        { type: 'tool-start', toolCallId: fields.toolCallId, patch: { ...patch, name: toolDisplayName(fields, patch) } },
      ];
    }
    case 'tool_call_update': {
      const fields = update as AcpToolCallFields;
      if (typeof fields.toolCallId !== 'string') return [];
      return [{ type: 'tool-update', toolCallId: fields.toolCallId, patch: mapToolCallPatch(fields) }];
    }
    case 'plan': {
      const entries = (update as { entries?: AcpPlanEntry[] }).entries;
      return Array.isArray(entries) ? [{ type: 'plan', entries: mapPlanEntries(entries) }] : [];
    }
    case 'current_mode_update': {
      const modeId = (update as { currentModeId?: unknown }).currentModeId;
      return typeof modeId === 'string' ? [{ type: 'agent-state', modeId }] : [];
    }
    default:
      return [];
  }
}
