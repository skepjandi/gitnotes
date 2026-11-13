import type {
  BridgeFeature,
  FileMatch,
  GitFileChange,
  GitOp,
  GitResult,
  ListeningPort,
} from '../../../bridge/src/protocol';
import { useAgentBridgeStore } from '../../stores/agentBridgeStore';
import { BridgeConnection } from './BridgeConnection';
import { loadBridgeCredentials } from './bridgeApi';
import { BridgeError } from './types';

export type { BridgeFeature, FileMatch, GitFileChange, ListeningPort };

export interface GitStatus {
  branch: string | null;
  ahead: number;
  behind: number;
  files: GitFileChange[];
}

export interface GitDiff {
  path: string;
  staged: boolean;
  /** Unified diff text. */
  patch: string;
  truncated: boolean;
}

export interface GitCommit {
  hash: string;
  summary: string;
}

/**
 * Request/response calls against a paired bridge (fs search, git, ports). Every call rejects with a
 * `BridgeError`: `kind: 'unreachable' | 'unauthorized' | 'timeout' | ...` for transport problems and
 * `BridgeError.code` set to the bridge's `request-error` code (`git-failed`, `not-a-repo`,
 * `forbidden-cwd`, `unsupported`, ...) when the bridge answered with a failure.
 */
export interface BridgeToolsApi {
  /** What the bridge supports; `[]` for bridges that predate optional features. Cached per bridge for the session. */
  features(bridgeId: string): Promise<BridgeFeature[]>;
  searchFiles(bridgeId: string, cwd: string, query: string, limit?: number): Promise<{ items: FileMatch[]; truncated: boolean }>;
  gitStatus(bridgeId: string, cwd: string): Promise<GitStatus>;
  gitDiff(bridgeId: string, cwd: string, path: string, staged: boolean): Promise<GitDiff>;
  gitStage(bridgeId: string, cwd: string, paths: string[]): Promise<void>;
  gitUnstage(bridgeId: string, cwd: string, paths: string[]): Promise<void>;
  gitCommit(bridgeId: string, cwd: string, message: string): Promise<GitCommit>;
  listPorts(bridgeId: string, connectionId: string): Promise<ListeningPort[]>;
}

const IDLE_CLOSE_MS = 20_000;

interface Link {
  connection: BridgeConnection | null;
  ready: Promise<BridgeConnection>;
  idleTimer: ReturnType<typeof setTimeout> | null;
}

const links = new Map<string, Link>();
const featureCache = new Map<string, BridgeFeature[]>();

function dropLink(bridgeId: string): void {
  const link = links.get(bridgeId);
  if (!link) return;
  links.delete(bridgeId);
  if (link.idleTimer) clearTimeout(link.idleTimer);
  link.connection?.close();
}

function forgetBridge(bridgeId: string): void {
  dropLink(bridgeId);
  featureCache.delete(bridgeId);
}

let knownBridges = new Map(useAgentBridgeStore.getState().bridges.map((bridge) => [bridge.id, bridge]));
useAgentBridgeStore.subscribe((state) => {
  const next = new Map(state.bridges.map((bridge) => [bridge.id, bridge]));
  for (const [id, previous] of knownBridges) {
    if (next.get(id) !== previous) forgetBridge(id);
  }
  knownBridges = next;
});

function asBridgeError(error: unknown): BridgeError {
  if (error instanceof BridgeError) return error;
  return new BridgeError('unknown', error instanceof Error ? error.message : 'Bridge request failed');
}

function openLink(bridgeId: string): Link {
  const connect = async (): Promise<BridgeConnection> => {
    let connection: BridgeConnection | null = null;
    try {
      const { url, token } = await loadBridgeCredentials(bridgeId);
      connection = new BridgeConnection({ url, token });
      link.connection = connection;
      connection.subscribe((event) => {
        if (event.type === 'state' && (event.state === 'idle' || event.state === 'closed') && links.get(bridgeId) === link) {
          links.delete(bridgeId);
        }
      });
      const ready = await connection.open();
      featureCache.set(bridgeId, ready.features ?? []);
      return connection;
    } catch (error) {
      connection?.close();
      if (links.get(bridgeId) === link) links.delete(bridgeId);
      throw error;
    }
  };
  const link: Link = { connection: null, idleTimer: null, ready: connect() };
  link.ready.catch(() => undefined);
  return link;
}

async function withLink<T>(bridgeId: string, use: (connection: BridgeConnection) => Promise<T>): Promise<T> {
  let link = links.get(bridgeId);
  if (!link) {
    link = openLink(bridgeId);
    links.set(bridgeId, link);
  }
  if (link.idleTimer) clearTimeout(link.idleTimer);
  link.idleTimer = null;
  try {
    return await use(await link.ready);
  } catch (error) {
    throw asBridgeError(error);
  } finally {
    if (links.get(bridgeId) === link) link.idleTimer = setTimeout(() => dropLink(bridgeId), IDLE_CLOSE_MS);
  }
}

async function runGit(bridgeId: string, cwd: string, op: GitOp): Promise<GitResult> {
  const reply = await withLink(bridgeId, (connection) => connection.request('git', { cwd, op }));
  return reply.result;
}

function unexpected(kind: GitResult['kind']): BridgeError {
  return new BridgeError('unknown', `The bridge answered a git request with an unexpected "${kind}" result`);
}

async function runGitOk(bridgeId: string, cwd: string, op: GitOp): Promise<void> {
  const result = await runGit(bridgeId, cwd, op);
  if (result.kind !== 'ok') throw unexpected(result.kind);
}

export const bridgeTools: BridgeToolsApi = {
  async features(bridgeId) {
    const cached = featureCache.get(bridgeId);
    if (cached) return cached;
    return withLink(bridgeId, async () => featureCache.get(bridgeId) ?? []);
  },

  async searchFiles(bridgeId, cwd, query, limit) {
    const reply = await withLink(bridgeId, (connection) =>
      connection.request('fs-search', { cwd, query, ...(limit === undefined ? {} : { limit }) }),
    );
    return { items: reply.items, truncated: reply.truncated };
  },

  async gitStatus(bridgeId, cwd) {
    const result = await runGit(bridgeId, cwd, { kind: 'status' });
    if (result.kind !== 'status') throw unexpected(result.kind);
    return { branch: result.branch, ahead: result.ahead, behind: result.behind, files: result.files };
  },

  async gitDiff(bridgeId, cwd, path, staged) {
    const result = await runGit(bridgeId, cwd, { kind: 'diff', path, staged });
    if (result.kind !== 'diff') throw unexpected(result.kind);
    return { path: result.path, staged: result.staged, patch: result.patch, truncated: result.truncated };
  },

  gitStage: (bridgeId, cwd, paths) => runGitOk(bridgeId, cwd, { kind: 'stage', paths }),

  gitUnstage: (bridgeId, cwd, paths) => runGitOk(bridgeId, cwd, { kind: 'unstage', paths }),

  async gitCommit(bridgeId, cwd, message) {
    const result = await runGit(bridgeId, cwd, { kind: 'commit', message });
    if (result.kind !== 'commit') throw unexpected(result.kind);
    return { hash: result.hash, summary: result.summary };
  },

  async listPorts(bridgeId, connectionId) {
    const reply = await withLink(bridgeId, (connection) => connection.request('ports', { connectionId }));
    return reply.ports;
  },
};
