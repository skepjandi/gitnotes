import type { AIContextItem } from '../../models/AIProvider';
import {
  getFileContent,
  getFolderContents,
  getLocalNotesForContext,
  getLocalTodosForContext,
  getRepoStructure,
  isBinaryFile,
  type ContextFolderItem,
} from '../ContextService';
import { DEFAULT_CHAT_BRANCH } from '../ai/config';

export const MAX_CONTEXT_ITEM_BYTES = 64 * 1024;
export const MAX_CONTEXT_TOTAL_BYTES = 256 * 1024;
const MAX_FOLDER_LISTING = 200;
const MAX_FOLDER_FILES = 5;
const MAX_FOLDER_FILE_BYTES = 8 * 1024;
export const TRUNCATED_MARKER = '[truncated]';

export interface ResolvedContext {
  item: AIContextItem;
  uri: string;
  mimeType: string;
  text: string;
  truncated: boolean;
}

export interface ResolvedContexts {
  items: ResolvedContext[];
  /** Items cut short or left out entirely to stay within the size limits. */
  truncatedCount: number;
}

const encoder = new TextEncoder();

function byteLength(value: string): number {
  return encoder.encode(value).length;
}

/** Cuts `text` to at most `maxBytes` of UTF-8 and appends the marker. */
function truncateBytes(text: string, maxBytes: number): { text: string; truncated: boolean } {
  if (byteLength(text) <= maxBytes) return { text, truncated: false };
  let cut = text.slice(0, maxBytes);
  while (cut.length > 0 && byteLength(cut) > maxBytes) cut = cut.slice(0, Math.floor(cut.length * 0.9));
  return { text: `${cut}\n${TRUNCATED_MARKER}`, truncated: true };
}

function uriFor(item: AIContextItem): string {
  switch (item.type) {
    case 'local-notes':
      return `gitnotes://note/${item.path || item.name}`;
    case 'local-todos':
      return 'gitnotes://todos';
    case 'repo':
      return `gitnotes://repo/${item.owner}/${item.repo}`;
    default:
      return `gitnotes://${item.type}/${item.owner}/${item.repo}/${item.path}`;
  }
}

function listing(items: ContextFolderItem[]): string {
  if (items.length === 0) return '(empty)';
  const shown = items.slice(0, MAX_FOLDER_LISTING).map((entry) => `${entry.type === 'dir' ? '[dir]' : '[file]'} ${entry.path}`);
  if (items.length > MAX_FOLDER_LISTING) shown.push(`${TRUNCATED_MARKER} (${items.length - MAX_FOLDER_LISTING} more entries)`);
  return shown.join('\n');
}

async function expandFolder(entries: ContextFolderItem[], item: AIContextItem, branch: string): Promise<string> {
  const parts = [listing(entries)];
  const files = entries.filter((entry) => entry.type === 'file' && !isBinaryFile(entry.name)).slice(0, MAX_FOLDER_FILES);
  for (const file of files) {
    try {
      const loaded = await getFileContent(item.owner, item.repo, branch, file.path);
      parts.push(`--- ${file.path} ---\n${truncateBytes(loaded.content, MAX_FOLDER_FILE_BYTES).text}`);
    } catch {
      /* unreadable files are skipped; the listing still names them */
    }
  }
  return parts.join('\n\n');
}

async function loadText(item: AIContextItem): Promise<string> {
  const branch = item.branch || DEFAULT_CHAT_BRANCH;
  switch (item.type) {
    case 'file':
      return (await getFileContent(item.owner, item.repo, branch, item.path)).content;
    case 'folder':
      return expandFolder(await getFolderContents(item.owner, item.repo, branch, item.path), item, branch);
    case 'repo':
      return expandFolder(await getRepoStructure(item.owner, item.repo, branch), item, branch);
    case 'local-notes':
      return getLocalNotesForContext(item.path || undefined);
    case 'local-todos':
      return getLocalTodosForContext();
  }
}

/**
 * Loads the content behind attached notes/files/folders/repos as text, bounded to
 * `MAX_CONTEXT_ITEM_BYTES` per item and `MAX_CONTEXT_TOTAL_BYTES` overall.
 */
export async function resolveContexts(contexts: AIContextItem[]): Promise<ResolvedContexts> {
  const items: ResolvedContext[] = [];
  let truncatedCount = 0;
  let remaining = MAX_CONTEXT_TOTAL_BYTES;

  for (const item of contexts) {
    if (remaining <= 0) {
      truncatedCount += 1;
      continue;
    }
    let raw: string;
    try {
      raw = await loadText(item);
    } catch (error) {
      raw = `[Failed to load: ${error instanceof Error ? error.message : 'unknown error'}]`;
    }
    const limit = Math.min(MAX_CONTEXT_ITEM_BYTES, remaining);
    const { text, truncated } = truncateBytes(raw, limit);
    if (truncated) truncatedCount += 1;
    remaining -= Math.min(byteLength(text), limit);
    items.push({
      item,
      uri: uriFor(item),
      mimeType: item.type === 'local-notes' || item.type === 'local-todos' ? 'text/markdown' : 'text/plain',
      text,
      truncated,
    });
  }
  return { items, truncatedCount };
}
