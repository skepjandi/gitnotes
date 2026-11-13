import type { Ionicons } from '@expo/vector-icons';
import type { ChatMessage, ChatMessageKind, PlanEntry, ToolDiff, ToolKind, ToolStatus } from '../../models/Chat';

type IconName = keyof typeof Ionicons.glyphMap;

export const MAX_TOOL_TEXT_CHARS = 4000;
export const MAX_DIFF_LINES = 120;
const DIFF_CONTEXT_LINES = 3;
const LCS_CELL_LIMIT = 250_000;

export const TOOL_KIND_ICONS: Record<ToolKind, IconName> = {
  read: 'document-text-outline',
  edit: 'create-outline',
  delete: 'trash-outline',
  move: 'swap-horizontal-outline',
  search: 'search-outline',
  execute: 'terminal-outline',
  think: 'bulb-outline',
  fetch: 'cloud-download-outline',
  switch_mode: 'shuffle-outline',
  other: 'build-outline',
};

export const TOOL_STATUS_ICONS: Record<Exclude<ToolStatus, 'running'>, IconName> = {
  pending: 'time-outline',
  'awaiting-approval': 'hand-left-outline',
  completed: 'checkmark-circle',
  failed: 'close-circle',
  rejected: 'ban-outline',
};

export const TOOL_STATUS_LABEL_KEYS: Record<ToolStatus, string> = {
  pending: 'chat.toolStatus.pending',
  'awaiting-approval': 'chat.toolStatus.awaitingApproval',
  running: 'chat.toolStatus.running',
  completed: 'chat.toolStatus.completed',
  failed: 'chat.toolStatus.failed',
  rejected: 'chat.toolStatus.rejected',
};

export const PLAN_STATUS_ICONS: Record<PlanEntry['status'], IconName> = {
  pending: 'ellipse-outline',
  in_progress: 'radio-button-on',
  completed: 'checkmark-circle',
};

export const PLAN_STATUS_LABEL_KEYS: Record<PlanEntry['status'], string> = {
  pending: 'chat.planStatus.pending',
  in_progress: 'chat.planStatus.inProgress',
  completed: 'chat.planStatus.completed',
};

/** Legacy messages predate `kind`: a tool name means tool, everything else is text. */
export function resolveMessageKind(message: ChatMessage): ChatMessageKind {
  if (message.kind) return message.kind;
  return message.toolCallName ? 'tool' : 'text';
}

/** Legacy tool messages carry no `toolStatus`; derive it from whether a result arrived. */
export function resolveToolStatus(message: ChatMessage, isStreaming: boolean | undefined): ToolStatus {
  if (message.toolStatus) return message.toolStatus;
  if (message.toolCallResult) return 'completed';
  return isStreaming ? 'running' : 'pending';
}

export function formatToolCallLabel(raw: string | undefined): string {
  const trimmed = raw?.trim();
  if (!trimmed) return 'Tool call';
  const printable = [...trimmed]
    .map((char) => {
      const code = char.charCodeAt(0);
      return code < 32 || code === 127 ? ' ' : char;
    })
    .join('')
    .trim();
  if (!printable) return 'Tool call';
  const normalized = printable
    .replace(/[_-]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
  if (!normalized) return 'Tool call';
  return normalized.replace(/\b\w/g, (char) => char.toUpperCase());
}

export interface NoteToolResult {
  noteId: string;
  title?: string;
}

export const NOTE_TOOL_NAMES: readonly string[] = ['create_note', 'edit_note', 'get_note'];

export function parseNoteToolResult(raw: string | undefined): NoteToolResult | null {
  if (!raw) return null;
  try {
    const parsed: unknown = JSON.parse(raw);
    if (parsed && typeof parsed === 'object' && 'noteId' in parsed && typeof parsed.noteId === 'string') {
      const title = 'title' in parsed && typeof parsed.title === 'string' ? parsed.title : undefined;
      return { noteId: parsed.noteId, title };
    }
  } catch {
    return null;
  }
  return null;
}

export interface TruncatedText {
  text: string;
  hiddenChars: number;
}

export function truncateText(text: string, max: number = MAX_TOOL_TEXT_CHARS): TruncatedText {
  if (text.length <= max) return { text, hiddenChars: 0 };
  return { text: text.slice(0, max), hiddenChars: text.length - max };
}

export function stringifyArgs(args: Record<string, unknown> | undefined): string | null {
  if (!args || Object.keys(args).length === 0) return null;
  try {
    return JSON.stringify(args, null, 2);
  } catch {
    return null;
  }
}

export type DiffLineType = 'add' | 'del' | 'ctx';

export interface DiffLine {
  type: DiffLineType;
  text: string;
}

export interface DiffView {
  path: string;
  lines: DiffLine[];
  hiddenLines: number;
  added: number;
  removed: number;
}

function splitLines(text: string): string[] {
  if (text === '') return [];
  const lines = text.split('\n');
  if (lines[lines.length - 1] === '') lines.pop();
  return lines;
}

function diffMiddle(oldMid: string[], newMid: string[]): DiffLine[] {
  const n = oldMid.length;
  const m = newMid.length;
  if (n === 0) return newMid.map((text) => ({ type: 'add', text }));
  if (m === 0) return oldMid.map((text) => ({ type: 'del', text }));
  if ((n + 1) * (m + 1) > LCS_CELL_LIMIT) {
    return [
      ...oldMid.map((text): DiffLine => ({ type: 'del', text })),
      ...newMid.map((text): DiffLine => ({ type: 'add', text })),
    ];
  }

  const width = m + 1;
  const table = new Uint32Array((n + 1) * width);
  for (let i = n - 1; i >= 0; i--) {
    for (let j = m - 1; j >= 0; j--) {
      table[i * width + j] =
        oldMid[i] === newMid[j]
          ? table[(i + 1) * width + j + 1] + 1
          : Math.max(table[(i + 1) * width + j], table[i * width + j + 1]);
    }
  }

  const out: DiffLine[] = [];
  let i = 0;
  let j = 0;
  while (i < n && j < m) {
    if (oldMid[i] === newMid[j]) {
      out.push({ type: 'ctx', text: oldMid[i] });
      i++;
      j++;
    } else if (table[(i + 1) * width + j] >= table[i * width + j + 1]) {
      out.push({ type: 'del', text: oldMid[i] });
      i++;
    } else {
      out.push({ type: 'add', text: newMid[j] });
      j++;
    }
  }
  while (i < n) out.push({ type: 'del', text: oldMid[i++] });
  while (j < m) out.push({ type: 'add', text: newMid[j++] });
  return out;
}

/**
 * Line diff for one edited file: shared head/tail are trimmed to a few context lines, the
 * changed middle is an LCS diff (or whole-block replace when it would be too large to diff).
 * The result is capped so a huge rewrite cannot blow up the render tree.
 */
export function buildDiffView(diff: ToolDiff, maxLines: number = MAX_DIFF_LINES): DiffView {
  const oldLines = splitLines(diff.oldText ?? '');
  const newLines = splitLines(diff.newText);

  let prefix = 0;
  const shared = Math.min(oldLines.length, newLines.length);
  while (prefix < shared && oldLines[prefix] === newLines[prefix]) prefix++;
  let suffix = 0;
  while (
    suffix < shared - prefix
    && oldLines[oldLines.length - 1 - suffix] === newLines[newLines.length - 1 - suffix]
  ) {
    suffix++;
  }

  const middle = diffMiddle(
    oldLines.slice(prefix, oldLines.length - suffix),
    newLines.slice(prefix, newLines.length - suffix),
  );
  const head = oldLines.slice(Math.max(0, prefix - DIFF_CONTEXT_LINES), prefix);
  const tail = oldLines.slice(oldLines.length - suffix, oldLines.length - suffix + DIFF_CONTEXT_LINES);

  const all: DiffLine[] = [
    ...head.map((text): DiffLine => ({ type: 'ctx', text })),
    ...middle,
    ...tail.map((text): DiffLine => ({ type: 'ctx', text })),
  ];

  let added = 0;
  let removed = 0;
  for (const line of all) {
    if (line.type === 'add') added++;
    else if (line.type === 'del') removed++;
  }

  return {
    path: diff.path,
    lines: all.slice(0, maxLines),
    hiddenLines: Math.max(0, all.length - maxLines),
    added,
    removed,
  };
}

export type StepVerb = 'ran' | 'edited' | 'read' | 'searched' | 'deleted' | 'moved' | 'fetched';

export interface StepLine {
  /** Past-tense lead word; null when the call carries nothing to summarise beyond its title. */
  verb: StepVerb | null;
  detail: string;
  monospace: boolean;
}

const STEP_VERB_BY_KIND: Partial<Record<ToolKind, StepVerb>> = {
  execute: 'ran',
  edit: 'edited',
  read: 'read',
  search: 'searched',
  delete: 'deleted',
  move: 'moved',
  fetch: 'fetched',
};

const COMMAND_KEYS = ['command', 'cmd'];
const PATH_KEYS = ['path', 'file_path', 'filePath', 'filename', 'file', 'url'];
const QUERY_KEYS = ['query', 'pattern', 'q', 'regex', 'search'];
const LEADING_VERB = /^(?:run|ran|running|execute|executing|edit|edited|editing|write|read|reading|search|searching|delete|deleting|move|moving|fetch|fetching)\s+/i;

function firstText(args: Record<string, unknown> | undefined, keys: string[]): string | null {
  if (!args) return null;
  for (const key of keys) {
    const value = args[key];
    if (typeof value === 'string' && value.trim()) return value.trim();
    if (Array.isArray(value) && value.length > 0 && value.every((part) => typeof part === 'string')) {
      return value.join(' ').trim();
    }
  }
  return null;
}

function firstLine(text: string): string {
  return text.split('\n', 1)[0].trim();
}

/** Togo-style step summary: "Ran `npm test`", "Edited src/a.ts", "Read README.md", "Searched \"query\"". */
export function describeToolStep(message: ChatMessage): StepLine {
  const title = message.toolTitle?.trim() ?? '';
  const fallback: StepLine = { verb: null, detail: title || formatToolCallLabel(message.toolCallName), monospace: false };
  const verb = message.toolKind ? STEP_VERB_BY_KIND[message.toolKind] : undefined;
  if (!verb) return fallback;

  const stripped = title.replace(LEADING_VERB, '').trim();
  const args = message.toolCallArgs;

  if (verb === 'ran') {
    const command = firstText(args, COMMAND_KEYS) ?? (stripped || null);
    return command ? { verb, detail: firstLine(command), monospace: true } : fallback;
  }
  if (verb === 'searched') {
    const query = firstText(args, QUERY_KEYS) ?? (stripped || null);
    return query ? { verb, detail: `"${firstLine(query)}"`, monospace: false } : fallback;
  }
  const path =
    message.toolLocations?.[0]?.path ?? message.toolDiffs?.[0]?.path ?? firstText(args, PATH_KEYS) ?? (stripped || null);
  return path ? { verb, detail: path, monospace: true } : fallback;
}
