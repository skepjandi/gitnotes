/**
 * The slice of the Agent Client Protocol (https://agentclientprotocol.com, schema v1)
 * the phone client reads or writes. Unknown fields are tolerated everywhere.
 */

export const ACP_PROTOCOL_VERSION = 1;

export const JSON_RPC_METHOD_NOT_FOUND = -32601;
export const JSON_RPC_INTERNAL_ERROR = -32603;
export const ACP_AUTH_REQUIRED = -32000;

export type AcpToolKind =
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

export type AcpToolStatus = 'pending' | 'in_progress' | 'completed' | 'failed';

export type AcpContentBlock =
  | { type: 'text'; text: string }
  | { type: 'image'; data?: string; mimeType?: string; uri?: string }
  | { type: 'audio'; data?: string; mimeType?: string }
  | { type: 'resource_link'; uri: string; name?: string }
  | { type: 'resource'; resource: { uri: string; text?: string; blob?: string; mimeType?: string } };

export type AcpToolCallContent =
  | { type: 'content'; content: AcpContentBlock }
  | { type: 'diff'; path: string; oldText?: string | null; newText: string }
  | { type: 'terminal'; terminalId: string };

export interface AcpToolCallLocation {
  path: string;
  line?: number | null;
}

export interface AcpToolCallFields {
  toolCallId: string;
  title?: string | null;
  name?: string | null;
  kind?: AcpToolKind | null;
  status?: AcpToolStatus | null;
  content?: AcpToolCallContent[] | null;
  locations?: AcpToolCallLocation[] | null;
  rawInput?: unknown;
  rawOutput?: unknown;
}

export interface AcpPlanEntry {
  content: string;
  status?: 'pending' | 'in_progress' | 'completed';
  priority?: 'high' | 'medium' | 'low';
}

export type AcpSessionUpdate =
  | { sessionUpdate: 'agent_message_chunk'; content: AcpContentBlock }
  | { sessionUpdate: 'agent_thought_chunk'; content: AcpContentBlock }
  | { sessionUpdate: 'user_message_chunk'; content: AcpContentBlock }
  | ({ sessionUpdate: 'tool_call' } & AcpToolCallFields)
  | ({ sessionUpdate: 'tool_call_update' } & AcpToolCallFields)
  | { sessionUpdate: 'plan'; entries: AcpPlanEntry[] }
  | { sessionUpdate: 'current_mode_update'; currentModeId: string }
  | { sessionUpdate: string; [key: string]: unknown };

export interface AcpSessionNotification {
  sessionId: string;
  update: AcpSessionUpdate;
}

export interface AcpPermissionOption {
  optionId: string;
  name: string;
  kind: 'allow_once' | 'allow_always' | 'reject_once' | 'reject_always';
}

export interface AcpPermissionRequest {
  sessionId: string;
  toolCall: AcpToolCallFields;
  options: AcpPermissionOption[];
}

export type AcpPermissionOutcome = { outcome: 'selected'; optionId: string } | { outcome: 'cancelled' };

export interface AcpSessionMode {
  id: string;
  name: string;
  description?: string | null;
}

export interface AcpSessionModeState {
  currentModeId: string;
  availableModes: AcpSessionMode[];
}

export interface AcpAuthMethod {
  id: string;
  name?: string;
  description?: string | null;
}

export interface AcpInitializeResult {
  protocolVersion: number;
  agentCapabilities?: {
    loadSession?: boolean;
    promptCapabilities?: { image?: boolean; audio?: boolean; embeddedContext?: boolean };
  };
  authMethods?: AcpAuthMethod[];
  agentInfo?: { name?: string; title?: string; version?: string } | null;
}

export interface AcpNewSessionResult {
  sessionId: string;
  modes?: AcpSessionModeState | null;
}

export interface AcpLoadSessionResult {
  modes?: AcpSessionModeState | null;
}

export interface AcpPromptResult {
  stopReason: string;
}

export type AcpPromptBlock =
  | { type: 'text'; text: string }
  | { type: 'resource'; resource: { uri: string; mimeType?: string; text: string } };
