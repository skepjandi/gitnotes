import type { ChatMessage, PlanEntry, ThreadBackend, ToolDiff, ToolStatus } from '../../../models/Chat';
import type { ListeningPort } from '../../../services/agent/bridgeTools';
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

export interface MissionSubagent {
  id: string;
  description: string;
  status: ToolStatus;
  resultSummary: string | null;
}

export interface MissionAgentsSection {
  type: 'agents';
  agents: MissionSubagent[];
}

export interface MissionBackgroundCommand {
  id: string;
  command: string;
  elapsedMs: number;
  tail: string;
}

export interface MissionBackgroundSection {
  type: 'background';
  commands: MissionBackgroundCommand[];
}

export interface MissionPortsSection {
  type: 'ports';
  ports: ListeningPort[];
}

export type MissionSection =
  | MissionNeedsYouSection
  | MissionAgentsSection
  | MissionBackgroundSection
  | MissionPortsSection
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

const BACKGROUND_TAIL_LINES = 40;
const SUBAGENT_TOOL_NAMES = new Set(['task', 'agent', 'subagent']);
const SUBAGENT_SUMMARY_MAX = 240;

function isSubagentCall(message: ChatMessage): boolean {
  if (resolveMessageKind(message) !== 'tool') return false;
  const name = (message.toolCallName ?? '').toLowerCase();
  const title = (message.toolTitle ?? '').toLowerCase().split(/[\s:(]/)[0];
  return (
    SUBAGENT_TOOL_NAMES.has(name) ||
    SUBAGENT_TOOL_NAMES.has(title) ||
    typeof message.toolCallArgs?.subagent_type === 'string'
  );
}

function stringArg(message: ChatMessage, key: string): string | null {
  const value = message.toolCallArgs?.[key];
  return typeof value === 'string' && value.trim() ? value.trim() : null;
}

function selectSubagents(messages: ChatMessage[]): MissionSubagent[] {
  return messages.filter(isSubagentCall).map((message) => {
    const result = message.toolCallResult?.trim();
    return {
      id: message.id,
      description:
        stringArg(message, 'description') ??
        stringArg(message, 'prompt')?.split('\n')[0] ??
        message.toolTitle ??
        message.toolCallName ??
        '',
      status: message.toolStatus ?? 'pending',
      resultSummary: result ? result.slice(0, SUBAGENT_SUMMARY_MAX) : null,
    };
  });
}

function selectBackground(messages: ChatMessage[], status: ChatRunStatus, now: number): MissionBackgroundCommand[] {
  let latestAssistantText = -1;
  for (let i = messages.length - 1; i >= 0; i--) {
    const message = messages[i];
    if (message.role === 'assistant' && resolveMessageKind(message) === 'text' && message.content.trim()) {
      latestAssistantText = i;
      break;
    }
  }
  const turnOver = status !== 'running' && status !== 'awaiting-permission';
  const commands: MissionBackgroundCommand[] = [];
  messages.forEach((message, index) => {
    if (message.toolKind !== 'execute' || message.toolStatus !== 'running') return;
    if (!turnOver && index > latestAssistantText) return;
    commands.push({
      id: message.id,
      command: stringArg(message, 'command') ?? message.toolTitle ?? message.toolCallName ?? '',
      elapsedMs: Math.max(0, now - message.timestamp),
      tail: (message.toolCallResult ?? '').split('\n').slice(-BACKGROUND_TAIL_LINES).join('\n').trimEnd(),
    });
  });
  return commands;
}

export function withPortsSection(mission: Mission, ports: ListeningPort[]): Mission {
  if (ports.length === 0) return mission;
  const section: MissionPortsSection = { type: 'ports', ports };
  const before = mission.sections.findIndex((entry) => entry.type === 'activity' || entry.type === 'status');
  const sections = [...mission.sections];
  sections.splice(before === -1 ? sections.length : before, 0, section);
  return { sections };
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

  const agents = selectSubagents(messages);
  if (agents.length > 0) sections.push({ type: 'agents', agents });

  const background = selectBackground(messages, status, now);
  if (background.length > 0) sections.push({ type: 'background', commands: background });

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
