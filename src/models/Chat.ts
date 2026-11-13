import { AIContextItem } from './AIProvider';

export type ChatMessageKind = 'text' | 'thought' | 'tool' | 'plan';

export type ToolStatus = 'pending' | 'awaiting-approval' | 'running' | 'completed' | 'failed' | 'rejected';

export type ToolKind =
  | 'read'
  | 'edit'
  | 'delete'
  | 'move'
  | 'search'
  | 'execute'
  | 'think'
  | 'fetch'
  | 'switch_mode'
  | 'other';

export interface ToolDiff {
  path: string;
  oldText?: string | null;
  newText: string;
}

export interface ToolLocation {
  path: string;
  line?: number;
}

export interface PlanEntry {
  content: string;
  status: 'pending' | 'in_progress' | 'completed';
  priority?: 'high' | 'medium' | 'low';
}

export interface ChatMessage {
  id: string;
  role: 'user' | 'assistant' | 'system';
  content: string;
  timestamp: number;
  /** Absent on legacy messages; treat as `'text'`, or `'tool'` when `toolCallName` is set. */
  kind?: ChatMessageKind;
  toolCallId?: string;
  toolCallName?: string;
  toolCallArgs?: Record<string, unknown>;
  toolCallResult?: string;
  /** Agent-style tool metadata. Legacy tool bubbles omit these. */
  toolTitle?: string;
  toolKind?: ToolKind;
  toolStatus?: ToolStatus;
  toolDiffs?: ToolDiff[];
  toolLocations?: ToolLocation[];
  plan?: PlanEntry[];
  attachedContexts?: AIContextItem[];
}

export interface AgentMode {
  id: string;
  name: string;
  description?: string;
}

/** A slash command the agent advertises (ACP `available_commands_update`). */
export interface AgentCommand {
  name: string;
  description?: string;
  /** Placeholder for the argument the command takes, when it takes one. */
  hint?: string;
}

/**
 * Where a thread's assistant turns come from.
 * - `model`: in-app AI SDK model (Anthropic, OpenAI-compatible, Apple, Llama).
 * - `agent`: a coding agent (Claude Code, opencode, pi, ...) reached through a gitnotes-bridge.
 */
export type ThreadBackend =
  | { type: 'model' }
  | {
      type: 'agent';
      bridgeId: string;
      agentId: string;
      agentName: string;
      /** Absolute path on the bridge host. */
      cwd: string;
      /** ACP session id once `session/new` succeeded. */
      sessionId?: string;
      /** Bridge-side connection (agent process) id, kept so a cold-started app can re-attach. */
      connectionId?: string;
      /** Highest bridge frame sequence already folded into `messages` (same snapshot, so replay never duplicates). */
      lastSeq?: number;
      /** JSON-RPC id of the in-flight `session/prompt`, set only while a turn is running. */
      pendingPromptId?: number;
      modeId?: string;
      availableModes?: AgentMode[];
      availableCommands?: AgentCommand[];
    }
  /** Scripted walkthrough that replays canned turns; needs no bridge. */
  | { type: 'demo' };

export interface ChatThread {
  id: string;
  title: string;
  messages: ChatMessage[];
  createdAt: number;
  updatedAt: number;
  /** Model-backed threads live in the user's chat repo. Agent threads are device-local: transcripts can contain host secrets. */
  repoOwner: string;
  repoName: string;
  branch: string;
  filePath: string;
  /** Absent on legacy threads = `{ type: 'model' }`. */
  backend?: ThreadBackend;
}

export interface ChatThreadSummary {
  id: string;
  title: string;
  updatedAt: number;
  messageCount: number;
  preview?: string;
  /** Absent = model thread. */
  backend?: 'model' | 'agent' | 'demo';
  agentName?: string;
  /** Agent threads: absolute working directory on the bridge host. */
  cwd?: string;
}
