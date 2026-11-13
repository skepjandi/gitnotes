/**
 * Wire protocol between the GitNotēs app and `gitnotes-bridge`.
 *
 * One WebSocket carries JSON text frames. After `auth`, a socket is either
 * unbound (control frames only) or bound to exactly one agent *connection*
 * (a spawned ACP agent process). A connection outlives its socket: when the
 * phone sleeps or switches network the agent keeps running, the bridge keeps a
 * replay log, and the app re-attaches with `resume`.
 *
 * The bridge never interprets ACP beyond two things: it validates `cwd` on
 * `session/new` / `session/load` against the configured roots, and it tracks
 * which agent -> client requests are still unanswered so replay does not ask
 * the user the same permission question twice.
 *
 * This file has no runtime dependencies and is imported (type-only) by the app.
 */

export const BRIDGE_PROTOCOL_VERSION = 1;

/** A JSON-RPC 2.0 message exactly as an ACP agent reads or writes it on stdio. */
export interface JsonRpcMessage {
  jsonrpc: '2.0';
  id?: number | string | null;
  method?: string;
  params?: unknown;
  result?: unknown;
  error?: { code: number; message: string; data?: unknown };
}

export interface AgentInfo {
  /** Stable id used in `connect`. */
  id: string;
  /** Human readable, e.g. "Claude Code". */
  name: string;
  /** Whether the launcher binary was found on the host PATH. */
  available: boolean;
  /** Command line shown in the UI so users see what will run. */
  command: string;
}

export interface WorkspaceInfo {
  /** Absolute path on the bridge host. */
  path: string;
  /** Last path segment. */
  name: string;
  /** True when this is one of the configured roots rather than a child of one. */
  isRoot: boolean;
}

export type BridgeErrorCode =
  | 'unauthorized'
  | 'protocol-mismatch'
  | 'bad-request'
  | 'unknown-agent'
  | 'agent-unavailable'
  | 'spawn-failed'
  | 'unknown-connection'
  /** `resume.lastSeq` is older than the replay window; start over with `connect` + ACP `session/load`. */
  | 'replay-gap'
  | 'forbidden-cwd'
  | 'too-many-connections'
  /** Another socket attached to this connection. */
  | 'superseded'
  | 'not-bound'
  /** A `git` request failed (non-zero exit); `message` carries git's stderr. */
  | 'git-failed'
  | 'not-a-repo'
  /** The request needs a feature this bridge does not advertise in `ready.features`. */
  | 'unsupported';

/**
 * Optional capabilities beyond the agent socket. `ready.features` lists what the bridge supports;
 * a bridge that predates a feature simply omits it, and the app hides the matching UI.
 */
export type BridgeFeature = 'fs-search' | 'git' | 'ports';

export interface FileMatch {
  /** Path relative to the request's `cwd`, always `/`-separated. */
  path: string;
  isDir: boolean;
}

export type GitFileStatus = 'modified' | 'added' | 'deleted' | 'renamed' | 'untracked' | 'conflicted';

export interface GitFileChange {
  /** Relative to the repository root of `cwd`. */
  path: string;
  /** Set for renames: the previous path. */
  from?: string;
  status: GitFileStatus;
  staged: boolean;
  unstaged: boolean;
}

export type GitOp =
  | { kind: 'status' }
  /** Unified diff of one file. Untracked files diff against /dev/null. */
  | { kind: 'diff'; path: string; staged: boolean }
  | { kind: 'stage'; paths: string[] }
  | { kind: 'unstage'; paths: string[] }
  | { kind: 'commit'; message: string };

export type GitResult =
  | { kind: 'status'; branch: string | null; ahead: number; behind: number; files: GitFileChange[] }
  | { kind: 'diff'; path: string; staged: boolean; patch: string; truncated: boolean }
  | { kind: 'ok' }
  | { kind: 'commit'; hash: string; summary: string };

export interface ListeningPort {
  port: number;
  /** Process name, when the OS reports it. */
  process?: string;
  pid?: number;
}

export type ClientFrame =
  | { type: 'auth'; token: string; protocol: number }
  | { type: 'ping' }
  | { type: 'list-workspaces' }
  /** Spawn an agent and bind this socket to it. */
  | { type: 'connect'; agent: string }
  /** Re-attach to a running agent; the bridge replays every frame with seq > lastSeq. */
  | { type: 'resume'; connectionId: string; lastSeq: number }
  /** Forward a JSON-RPC message to the bound agent's stdin. */
  | { type: 'rpc'; message: JsonRpcMessage }
  /** Unbind this socket. `kill: true` also terminates the agent and forgets the connection. */
  | { type: 'disconnect'; kill?: boolean }
  /**
   * Request/response frames below are allowed on an unbound socket. Each carries a client-chosen
   * `reqId` echoed on the reply. `cwd` must lie inside the configured roots (`forbidden-cwd` otherwise).
   */
  | { type: 'fs-search'; reqId: string; cwd: string; query: string; limit?: number }
  | { type: 'git'; reqId: string; cwd: string; op: GitOp }
  /** Listening TCP ports owned by the agent process tree of `connectionId`. */
  | { type: 'ports'; reqId: string; connectionId: string };

export type ServerFrame =
  | {
      type: 'ready';
      protocol: number;
      bridgeVersion: string;
      hostname: string;
      agents: AgentInfo[];
      roots: string[];
      /** Absent on bridges that predate optional features: treat as `[]`. */
      features?: BridgeFeature[];
    }
  | { type: 'pong' }
  | { type: 'workspaces'; items: WorkspaceInfo[] }
  | {
      type: 'connected';
      connectionId: string;
      agent: string;
      resumed: boolean;
      /** Number of `rpc` frames that follow immediately as replay (0 for a fresh connect). */
      replayCount: number;
      /** Highest seq issued so far. */
      headSeq: number;
    }
  /** Agent stdout message. `seq` increases by 1 per frame within a connection and is the replay cursor. */
  | { type: 'rpc'; seq: number; message: JsonRpcMessage }
  /** Agent stderr, newest lines only; never replayed. */
  | { type: 'log'; text: string }
  | { type: 'agent-exit'; code: number | null; signal: string | null }
  | { type: 'error'; code: BridgeErrorCode; message: string }
  | { type: 'fs-results'; reqId: string; items: FileMatch[]; truncated: boolean }
  | { type: 'git-result'; reqId: string; result: GitResult }
  | { type: 'ports-result'; reqId: string; ports: ListeningPort[] }
  /** Failure of one request/response frame; the socket stays usable. */
  | { type: 'request-error'; reqId: string; code: BridgeErrorCode; message: string };

export const DEFAULT_PORT = 7878;

/** Heartbeat the client should use; the bridge also sends WebSocket-level pings. */
export const CLIENT_PING_INTERVAL_MS = 20_000;
export const CLIENT_PONG_TIMEOUT_MS = 10_000;

/** Pairing link users paste or tap: `gitnotes://agents/pair?url=<wss-or-ws-url>&token=<token>&name=<label>`. */
export const PAIRING_LINK_PREFIX = 'gitnotes://agents/pair';
