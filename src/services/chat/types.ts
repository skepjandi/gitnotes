/**
 * Contracts for the chat runtime.
 *
 *   UI  ->  ChatSession (one per thread, lives outside React)  ->  ChatBackend
 *                      ^                                              |
 *                      +---------------- ChatEvent stream <-----------+
 *
 * A backend turns "run the next assistant turn for this thread" into a stream
 * of typed `ChatEvent`s. `applyChatEvent` (reducer.ts) folds them into the
 * message list. Nothing downstream parses strings out of a text stream.
 */

import type { AIContextItem } from '../../models/AIProvider';
import type {
  AgentCommand,
  AgentConfigOption,
  AgentMode,
  ChatMessage,
  ChatThread,
  ImageAttachment,
  PlanEntry,
  ToolDiff,
  ToolKind,
  ToolLocation,
  ToolStatus,
} from '../../models/Chat';

export interface ToolPatch {
  name?: string;
  title?: string;
  kind?: ToolKind;
  status?: ToolStatus;
  args?: Record<string, unknown>;
  /** Human readable output (stdout, file contents, JSON). Replaces any previous result. */
  result?: string;
  diffs?: ToolDiff[];
  locations?: ToolLocation[];
}

export type ChatEventBody =
  | { type: 'text-delta'; text: string }
  | { type: 'thought-delta'; text: string }
  /** First sighting of a tool call. A second `tool-start` with the same id is treated as an update. */
  | { type: 'tool-start'; toolCallId: string; patch: ToolPatch & { name: string } }
  | { type: 'tool-update'; toolCallId: string; patch: ToolPatch }
  | { type: 'plan'; entries: PlanEntry[] }
  /** Agent session bookkeeping persisted on the thread (`thread.backend`). `pendingPromptId: null` clears it. */
  | {
      type: 'agent-state';
      sessionId?: string;
      connectionId?: string;
      pendingPromptId?: number | null;
      modeId?: string;
      availableModes?: AgentMode[];
      availableCommands?: AgentCommand[];
      configOptions?: AgentConfigOption[];
      supportsImages?: boolean;
      supportsEmbeddedContext?: boolean;
    }
  /** Terminal event of a turn. */
  | { type: 'turn-end'; stopReason: string };

/** `seq` is the backend's replay cursor; the session stores it atomically with the message changes it came with. */
export type ChatEvent = ChatEventBody & { seq?: number };

export type PermissionOptionKind = 'allow_once' | 'allow_always' | 'reject_once' | 'reject_always';

export interface PermissionOption {
  id: string;
  label: string;
  kind: PermissionOptionKind;
}

export interface PermissionRequest {
  /** Unique within the session. */
  id: string;
  /** Tool message this question is about, when known. */
  toolCallId?: string;
  title: string;
  description?: string;
  options: PermissionOption[];
}

/** `optionId` is one of `PermissionRequest.options[].id`; `null` means the user dismissed / the turn was cancelled. */
export type PermissionDecision = { optionId: string } | { optionId: null };

/** One field of an ACP form-mode elicitation (flat JSON Schema, restricted to primitives and enums). */
export interface ElicitationField {
  key: string;
  label: string;
  description?: string;
  required: boolean;
  kind: 'string' | 'number' | 'integer' | 'boolean' | 'enum' | 'multi-enum';
  /** `enum` / `multi-enum`. */
  options?: Array<{ value: string; label: string }>;
  default?: string | number | boolean | string[];
  multiline?: boolean;
  minimum?: number;
  maximum?: number;
}

/** An agent asking the user for structured input (ACP `elicitation/create`). */
export type ElicitationRequest =
  | {
      mode: 'form';
      /** Unique within the session. */
      id: string;
      toolCallId?: string;
      message: string;
      fields: ElicitationField[];
    }
  | {
      mode: 'url';
      id: string;
      toolCallId?: string;
      message: string;
      url: string;
    };

export type ElicitationValue = string | number | boolean | string[];

/** `accept` carries the form values (empty for url mode); `decline` is an explicit no; `cancel` is a dismissal or abort. */
export type ElicitationResult =
  | { action: 'accept'; content: Record<string, ElicitationValue> }
  | { action: 'decline' }
  | { action: 'cancel' };

/** `Omit` that keeps a discriminated union's variants apart. */
export type DistributiveOmit<T, K extends PropertyKey> = T extends unknown ? Omit<T, K> : never;

export interface ChatRunInput {
  /** Snapshot taken after the new user message was appended. Backends must not mutate it. */
  thread: ChatThread;
  /** Latest user text (already in `thread.messages`). Empty when re-attaching to a turn that is already running. */
  userText: string;
  contexts: AIContextItem[];
  /** Images attached to the latest user message; empty unless the agent advertised `supportsImages`. */
  images: ImageAttachment[];
  signal: AbortSignal;
  /**
   * Ask the user. Resolves when they pick, or with `{ optionId: null }` if the
   * signal aborts first. Backends must call this instead of auto-approving.
   */
  requestPermission: (request: Omit<PermissionRequest, 'id'>) => Promise<PermissionDecision>;
  /** Ask the user for structured input. Resolves `{ action: 'cancel' }` if the signal aborts first. */
  requestElicitation: (request: DistributiveOmit<ElicitationRequest, 'id'>) => Promise<ElicitationResult>;
  /** Free-form line for the "connecting..." / "reconnecting..." banner. Optional. */
  reportStatus?: (status: string | null) => void;
}

export interface ChatBackend {
  readonly type: 'model' | 'agent' | 'demo';
  /**
   * Run one assistant turn. Must end with exactly one `turn-end` event unless it
   * throws. On abort, stop promptly and emit `turn-end` with stopReason `cancelled`.
   * Throwing surfaces as the session error and keeps messages produced so far.
   */
  run(input: ChatRunInput): AsyncIterable<ChatEvent>;
  /**
   * Re-attach to a turn that was running when the app died (`thread.backend.pendingPromptId` set).
   * Backends without that capability omit it.
   */
  resume?(input: Omit<ChatRunInput, 'userText' | 'contexts' | 'images'>): AsyncIterable<ChatEvent>;
  /** Agent mode switch (e.g. plan / accept-edits). */
  setMode?(thread: ChatThread, modeId: string): Promise<void>;
  /** Change an ACP config option (model, reasoning effort, ...). Resolves with the agent's full updated option list. */
  setConfigOption?(thread: ChatThread, configId: string, value: string | boolean): Promise<AgentConfigOption[]>;
}

export type ChatLoadState = 'loading' | 'ready' | 'not-found' | 'error';

/** idle -> running -> (awaiting-permission <-> running) -> idle | error */
export type ChatRunStatus = 'idle' | 'running' | 'awaiting-permission' | 'error';

export interface ChatSessionState {
  loadState: ChatLoadState;
  loadError: string | null;
  thread: ChatThread | null;
  status: ChatRunStatus;
  /** Present when `status === 'error'` (or a non-fatal warning while idle). */
  error: string | null;
  streamStartedAt: number;
  /** Transient connection line from the backend, e.g. "Reconnecting to bridge...". */
  statusLine: string | null;
  pendingPermissions: PermissionRequest[];
  pendingElicitations: ElicitationRequest[];
  /** Last user input, kept so `retry()` can re-run after a failure. */
  retryable: boolean;
  /** Prompts typed while a turn was running; they run one at a time, oldest first, once the turn ends. */
  queuedPrompts: QueuedPrompt[];
}

export type QueuedPromptState = 'queued' | 'sending' | 'failed';

export interface QueuedPrompt {
  id: string;
  text: string;
  contexts: AIContextItem[];
  images: ImageAttachment[];
  state: QueuedPromptState;
}

export interface ChatSessionActions {
  send(text: string, contexts: AIContextItem[], images?: ImageAttachment[]): Promise<void>;
  stop(): void;
  retry(): Promise<void>;
  /** Replace a user message (and everything after it) and re-run. */
  editAndResend(messageId: string, text: string): Promise<void>;
  /** Drop the assistant output after the user message preceding `messageId` and re-run. */
  regenerate(messageId: string): Promise<void>;
  resolvePermission(requestId: string, decision: PermissionDecision): void;
  resolveElicitation(requestId: string, result: ElicitationResult): void;
  setMode(modeId: string): Promise<void>;
  setConfigOption(configId: string, value: string | boolean): Promise<void>;
  dismissError(): void;
  /** Drop a queued prompt that has not been sent yet (or a failed one). */
  cancelQueued(promptId: string): void;
  /** Put a failed queued prompt back at the head of the queue. */
  retryQueued(promptId: string): void;
}

export type { ChatMessage };

/** What `useChatSession(threadId)` returns. */
export type UseChatSessionResult = ChatSessionState &
  ChatSessionActions & {
    messages: ChatMessage[];
    /** Rough context-window usage for model threads; null for agent threads. */
    contextBudget: { warningLevel: 'none' | 'caution' | 'over'; message: string | null } | null;
  };

export interface CreateAgentThreadInput {
  bridgeId: string;
  agentId: string;
  agentName: string;
  /** Absolute path on the bridge host. */
  cwd: string;
  title?: string;
}

/**
 * Thread lifecycle API (src/services/chat/threads.ts). Both functions register the new
 * thread's summary in `useChatStore.threads` and seed its `ChatSession` before resolving.
 * Agent threads are written to device storage immediately. Model threads reach the chat
 * repo with their first message, so opening and abandoning "New Chat" never commits an empty thread.
 */
export interface ChatThreadApi {
  /** Model-backed thread in the user's configured chat repo. Rejects with a user-facing Error when no chat repo is configured. */
  createModelThread(): Promise<ChatThread>;
  /** Device-local thread driven by an agent behind a bridge. */
  createAgentThread(input: CreateAgentThreadInput): Promise<ChatThread>;
  /** Scripted walkthrough thread that works without any bridge. */
  createDemoThread(): Promise<ChatThread>;
}
