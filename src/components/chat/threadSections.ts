import type { ChatThreadSummary } from '../../models/Chat';
import type { ChatRunStatus } from '../../services/chat/types';

export type ThreadStatusMap = Readonly<Record<string, ChatRunStatus | undefined>>;

export type ThreadSectionKind = 'needs-you' | 'workspace' | 'chats' | 'demo';

export interface ThreadSection {
  key: string;
  kind: ThreadSectionKind;
  /** Folder name for `workspace` sections. */
  title?: string;
  data: ChatThreadSummary[];
}

export function workspaceName(cwd: string | undefined): string {
  const segments = (cwd ?? '').split(/[\\/]/).filter(Boolean);
  return segments.length > 0 ? segments[segments.length - 1] : '';
}

export function matchesThreadQuery(thread: ChatThreadSummary, query: string): boolean {
  const needle = query.trim().toLowerCase();
  if (!needle) return true;
  return [thread.title, thread.preview, thread.agentName].some((field) => field?.toLowerCase().includes(needle));
}

const byRecency = (a: ChatThreadSummary, b: ChatThreadSummary): number => b.updatedAt - a.updatedAt;

/**
 * Sections in display order: Needs you, agent threads per workspace folder, Chats, Demo.
 * Empty sections are omitted; rows are newest first inside each section.
 */
export function buildThreadSections(
  threads: readonly ChatThreadSummary[],
  statuses: ThreadStatusMap,
  query = '',
): ThreadSection[] {
  const needsYou: ChatThreadSummary[] = [];
  const workspaces = new Map<string, ChatThreadSummary[]>();
  const chats: ChatThreadSummary[] = [];
  const demo: ChatThreadSummary[] = [];

  for (const thread of threads) {
    if (!matchesThreadQuery(thread, query)) continue;
    if (statuses[thread.id] === 'awaiting-permission') needsYou.push(thread);
    else if (thread.backend === 'agent') {
      const name = workspaceName(thread.cwd);
      workspaces.set(name, [...(workspaces.get(name) ?? []), thread]);
    } else if (thread.backend === 'demo') demo.push(thread);
    else chats.push(thread);
  }

  const sections: ThreadSection[] = [];
  if (needsYou.length) sections.push({ key: 'needs-you', kind: 'needs-you', data: needsYou.sort(byRecency) });
  const workspaceKeys = [...workspaces.keys()].sort((a, b) => a.localeCompare(b));
  for (const name of workspaceKeys) {
    sections.push({ key: `workspace:${name}`, kind: 'workspace', title: name, data: (workspaces.get(name) ?? []).sort(byRecency) });
  }
  if (chats.length) sections.push({ key: 'chats', kind: 'chats', data: chats.sort(byRecency) });
  if (demo.length) sections.push({ key: 'demo', kind: 'demo', data: demo.sort(byRecency) });
  return sections;
}
