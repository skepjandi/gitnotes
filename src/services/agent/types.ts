/**
 * Contracts for talking to a `gitnotes-bridge` from the app.
 * Wire format: bridge/src/protocol.ts. Agent protocol: ACP (https://agentclientprotocol.com).
 */

import type {
  AgentInfo,
  BridgeErrorCode,
  BridgeFeature,
  BridgeSessionInfo,
  WorkspaceInfo,
} from '../../../bridge/src/protocol';

export type { AgentInfo, BridgeSessionInfo, WorkspaceInfo };

/** A paired bridge. The token never lives here; it is in secure storage keyed by `id`. */
export interface AgentBridge {
  id: string;
  /** User label, defaults to the bridge hostname. */
  name: string;
  /** `ws://` or `wss://` URL of the bridge. */
  url: string;
  addedAt: number;
  /** Workspace most recently chosen on this bridge, used as the default for new chats. */
  lastWorkspace?: string;
}

export interface BridgeProbeResult {
  hostname: string;
  bridgeVersion: string;
  agents: AgentInfo[];
  roots: string[];
  features?: BridgeFeature[];
}

export interface PairingLink {
  url: string;
  token: string;
  name?: string;
}

export type BridgeErrorKind =
  | 'unreachable'
  | 'unauthorized'
  | 'protocol-mismatch'
  | 'cleartext-blocked'
  | 'timeout'
  | 'unknown';

export class BridgeError extends Error {
  constructor(
    readonly kind: BridgeErrorKind,
    message: string,
    /** Set when the bridge itself answered with an `error` frame. */
    readonly code?: BridgeErrorCode,
  ) {
    super(message);
    this.name = 'BridgeError';
  }
}
