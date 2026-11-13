import type { ChatMessage, PlanEntry, ThreadBackend, ToolDiff } from '../../../models/Chat';
import type { ChatRunStatus, PermissionRequest } from '../../../services/chat/types';
import { buildDiffView, resolveMessageKind } from '../toolPresentation';

export interface MissionNeedsYouSection {
  type: 'needsYou';
  requests: PermissionRequest[];
}

export interface MissionPlanSection {
  type: 'plan';
  entries: PlanEntry[];
  completed: number;
  total: number;
}

export interface MissionChange {
  path: string;
  status: 'new' | 'edited';
  added: number;
  removed: number;
  messageId: string;
  diff: ToolDiff;
}

export interface MissionChangesSection {
  type: 'changes';
  changes: MissionChange[];
}

export interface MissionActivity {
  commands: number;
  filesRead: number;
  filesEdited: number;
  searches: number;
  failed: number;
}

export interface MissionActivitySection {
  type: 'activity';
  activity: MissionActivity;
}

export type MissionRunState = 'running' | 'awaiting' | 'idle';

export interface MissionStatusSection {
  type: 'status';
  agentName: string | null;
  workspace: string | null;
  modeName: string | null;
  state: MissionRunState;
  elapsedMs: number | null;
  messageCount: number;
}

export type MissionSection =
  | MissionNeedsYouSection
  | MissionPlanSection
  | MissionChangesSection
  | MissionActivitySection
  | MissionStatusSection;

export interface Mission {
  sections: MissionSection[];
}

export interface SelectMissionInput {
  messages: ChatMessage[];
  pendingPermissions: PermissionRequest[];
  backend: ThreadBackend | undefined;
  status: ChatRunStatus;
  streamStartedAt: number;
  now: number;
}

function lastSegment(path: string): string | null {
  const parts = path.split(/[\\/]/).filter(Boolean);
  return parts.length > 0 ? parts[parts.length - 1] : null;
}

function selectChanges(messages: ChatMessage[]): MissionChange[] {
  const byPath = new Map<string, MissionChange>();
  for (const message of messages) {
    if (!message.toolDiffs) continue;
    for (const diff of message.toolDiffs) {
      const view = buildDiffView(diff, 0);
      byPath.delete(diff.path);
      byPath.set(diff.path, {
        path: diff.path,
        status: diff.oldText == null ? 'new' : 'edited',
        added: view.added,
        removed: view.removed,
        messageId: message.id,
        diff,
      });
    }
  }
  return [...byPath.values()];
}

function selectActivity(messages: ChatMessage[]): MissionActivity {
  const activity: MissionActivity = { commands: 0, filesRead: 0, filesEdited: 0, searches: 0, failed: 0 };
  for (const message of messages) {
    if (resolveMessageKind(message) !== 'tool') continue;
    if (message.toolKind === 'execute') activity.commands++;
    else if (message.toolKind === 'read') activity.filesRead++;
    else if (message.toolKind === 'edit') activity.filesEdited++;
    else if (message.toolKind === 'search') activity.searches++;
    if (message.toolStatus === 'failed') activity.failed++;
  }
  return activity;
}

function selectPlan(messages: ChatMessage[]): MissionPlanSection | null {
  for (let i = messages.length - 1; i >= 0; i--) {
    const entries = messages[i].plan;
    if (resolveMessageKind(messages[i]) !== 'plan' && !entries) continue;
    if (!entries || entries.length === 0) return null;
    return {
      type: 'plan',
      entries,
      completed: entries.filter((entry) => entry.status === 'completed').length,
      total: entries.length,
    };
  }
  return null;
}

export function selectMission(input: SelectMissionInput): Mission {
  const { messages, pendingPermissions, backend, status, streamStartedAt, now } = input;
  const sections: MissionSection[] = [];

  if (pendingPermissions.length > 0) sections.push({ type: 'needsYou', requests: pendingPermissions });

  const plan = selectPlan(messages);
  if (plan) sections.push(plan);

  const changes = selectChanges(messages);
  if (changes.length > 0) sections.push({ type: 'changes', changes });

  const activity = selectActivity(messages);
  if (Object.values(activity).some((count) => count > 0)) sections.push({ type: 'activity', activity });

  const state: MissionRunState = status === 'running' ? 'running' : status === 'awaiting-permission' ? 'awaiting' : 'idle';
  const agent = backend?.type === 'agent' ? backend : null;
  if (messages.length > 0 || agent || state !== 'idle') {
    const modeId = agent?.modeId;
    sections.push({
      type: 'status',
      agentName: agent?.agentName ?? null,
      workspace: agent ? lastSegment(agent.cwd) : null,
      modeName: modeId ? agent?.availableModes?.find((mode) => mode.id === modeId)?.name ?? modeId : null,
      state,
      elapsedMs: state !== 'idle' && streamStartedAt > 0 ? Math.max(0, now - streamStartedAt) : null,
      messageCount: messages.length,
    });
  }

  return { sections };
}
