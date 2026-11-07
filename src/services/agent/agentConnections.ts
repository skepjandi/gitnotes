import Constants from 'expo-constants';
import type { ChatThread, ThreadBackend } from '../../models/Chat';
import { AcpClient, AcpRpcError, AcpTransportError } from './AcpClient';
import {
  ACP_AUTH_REQUIRED,
  type AcpAuthMethod,
  type AcpLoadSessionResult,
  type AcpNewSessionResult,
  type AcpSessionModeState,
} from './acpTypes';
import { BridgeConnection } from './BridgeConnection';
import { loadBridgeCredentials } from './bridgeApi';
import { BridgeError } from './types';

export type AgentThreadBackend = Extract<ThreadBackend, { type: 'agent' }>;

const SESSION_LOAD_TIMEOUT_MS = 60_000;

/** An agent process on a bridge plus the client talking to it; one per chat thread, reused across turns. */
export interface LiveAgentConnection {
  threadId: string;
  connection: BridgeConnection;
  acp: AcpClient;
  connectionId: string;
  sessionId: string | null;
  /** `null` when this process attached to an agent it did not initialize. */
  loadSession: boolean | null;
  authMethods: AcpAuthMethod[];
  modes: AcpSessionModeState | null;
  /** True while a turn (or a resumed turn) is being driven. */
  busy: boolean;
}

export interface SessionSetup {
  sessionId: string;
  modes: AcpSessionModeState | null;
  /** Bridge cursor of the response that finished setup; everything up to it was discarded history. */
  seq?: number;
}

/** The agent process behind a persisted `connectionId` no longer exists on the bridge. */
export class AgentConnectionGoneError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'AgentConnectionGoneError';
  }
}

const liveByThread = new Map<string, LiveAgentConnection>();

export function getLiveConnection(threadId: string): LiveAgentConnection | undefined {
  return liveByThread.get(threadId);
}

function forget(live: LiveAgentConnection): void {
  if (liveByThread.get(live.threadId) === live) liveByThread.delete(live.threadId);
}

/** Closes the cached agent connection of a thread. `kill` (default) also terminates the agent process on the host. */
export function releaseAgentConnection(threadId: string, options: { kill?: boolean } = {}): void {
  const live = liveByThread.get(threadId);
  if (!live) return;
  liveByThread.delete(threadId);
  live.acp.dispose();
  live.connection.close({ kill: options.kill ?? true });
}

async function openBridge(bridgeId: string): Promise<BridgeConnection> {
  const { url, token } = await loadBridgeCredentials(bridgeId);
  const connection = new BridgeConnection({ url, token });
  try {
    await connection.open();
  } catch (error) {
    connection.close();
    throw error;
  }
  return connection;
}

function register(
  threadId: string,
  connection: BridgeConnection,
  acp: AcpClient,
  connectionId: string,
  sessionId: string | null,
): LiveAgentConnection {
  const live: LiveAgentConnection = {
    threadId,
    connection,
    acp,
    connectionId,
    sessionId,
    loadSession: null,
    authMethods: [],
    modes: null,
    busy: false,
  };
  liveByThread.set(threadId, live);
  connection.subscribe((event) => {
    if (event.type === 'lost' || event.type === 'agent-exit') {
      forget(live);
      if (event.type === 'agent-exit') connection.close();
    }
  });
  return live;
}

function isGone(error: unknown): boolean {
  return error instanceof BridgeError && (error.code === 'unknown-connection' || error.code === 'replay-gap');
}

function clientVersion(): string {
  return Constants.expoConfig?.version ?? '0.0.0';
}

async function startFresh(
  thread: ChatThread,
  backend: AgentThreadBackend,
  connection: BridgeConnection,
  install: (acp: AcpClient) => void,
): Promise<LiveAgentConnection> {
  const acp = new AcpClient(connection);
  install(acp);
  try {
    const connected = await connection.connect(backend.agentId);
    const live = register(thread.id, connection, acp, connected.connectionId, null);
    const init = await acp.initialize('gitnotes', clientVersion());
    live.loadSession = init.agentCapabilities?.loadSession === true;
    live.authMethods = init.authMethods ?? [];
    return live;
  } catch (error) {
    releaseAgentConnection(thread.id);
    acp.dispose();
    connection.close();
    throw error;
  }
}

export interface AcquireOptions {
  /** Called with the new `AcpClient` before any frame (replay included) can reach it. */
  install: (acp: AcpClient) => void;
  /** Resume only: never spawn a fresh agent; throw `AgentConnectionGoneError` instead. */
  requireExisting?: boolean;
}

/**
 * Returns the thread's live agent connection: the cached one, a re-attached one
 * (`resume` with the persisted connection id), or a freshly spawned agent.
 */
export async function acquireConnection(
  thread: ChatThread,
  backend: AgentThreadBackend,
  options: AcquireOptions,
): Promise<LiveAgentConnection> {
  const cached = liveByThread.get(thread.id);
  if (cached && cached.connection.state !== 'closed') {
    options.install(cached.acp);
    return cached;
  }
  if (cached) releaseAgentConnection(thread.id, { kill: false });

  const connection = await openBridge(backend.bridgeId);

  if (backend.connectionId) {
    const acp = new AcpClient(connection);
    options.install(acp);
    try {
      await connection.resume(backend.connectionId, backend.lastSeq ?? 0);
      return register(thread.id, connection, acp, backend.connectionId, backend.sessionId ?? null);
    } catch (error) {
      acp.dispose();
      if (!isGone(error)) {
        connection.close();
        throw error;
      }
      if (options.requireExisting) {
        connection.close();
        throw new AgentConnectionGoneError(
          `${backend.agentName} is no longer running on the bridge (it was restarted or cleaned up), so this turn cannot be picked back up.`,
        );
      }
    }
  } else if (options.requireExisting) {
    connection.close();
    throw new AgentConnectionGoneError('This chat has no running agent to re-attach to.');
  }

  return startFresh(thread, backend, connection, options.install);
}

function describeAuthFailure(backend: AgentThreadBackend): Error {
  return new Error(
    `${backend.agentName} is not signed in on the host. Log in to it on the machine running gitnotes-bridge (run the agent's login command in a terminal there), then send your message again.`,
  );
}

function toError(error: unknown, backend: AgentThreadBackend): Error {
  if (error instanceof AcpRpcError) {
    return error.code === ACP_AUTH_REQUIRED ? describeAuthFailure(backend) : new Error(error.message);
  }
  return error instanceof Error ? error : new Error('The agent request failed');
}

async function createSession(live: LiveAgentConnection, backend: AgentThreadBackend): Promise<SessionSetup> {
  try {
    const { result, seq } = await live.acp.startRequest<AcpNewSessionResult>('session/new', {
      cwd: backend.cwd,
      mcpServers: [],
    }).response;
    live.sessionId = result.sessionId;
    live.modes = result.modes ?? null;
    return { sessionId: result.sessionId, modes: live.modes, seq };
  } catch (error) {
    throw toError(error, backend);
  }
}

async function loadSession(live: LiveAgentConnection, backend: AgentThreadBackend, sessionId: string): Promise<SessionSetup | null> {
  live.acp.suppressSessionUpdates = true;
  try {
    const { result, seq } = await live.acp.startRequest<AcpLoadSessionResult | null>(
      'session/load',
      { sessionId, cwd: backend.cwd, mcpServers: [] },
      { timeoutMs: SESSION_LOAD_TIMEOUT_MS },
    ).response;
    live.sessionId = sessionId;
    live.modes = result?.modes ?? null;
    return { sessionId, modes: live.modes, seq };
  } catch (error) {
    if (error instanceof AcpTransportError) throw error;
    if (error instanceof AcpRpcError && error.code === ACP_AUTH_REQUIRED) throw describeAuthFailure(backend);
    return null;
  } finally {
    live.acp.suppressSessionUpdates = false;
  }
}

async function restoreMode(live: LiveAgentConnection, setup: SessionSetup, modeId: string | undefined): Promise<void> {
  const modes = setup.modes;
  if (!modeId || !modes || modes.currentModeId === modeId) return;
  if (!modes.availableModes.some((mode) => mode.id === modeId)) return;
  try {
    await live.acp.request('session/set_mode', { sessionId: setup.sessionId, modeId });
    live.modes = { ...modes, currentModeId: modeId };
    setup.modes = live.modes;
  } catch {
    /* the agent keeps its default mode */
  }
}

/**
 * Makes sure `live` has an ACP session. A persisted session id is restored with
 * `session/load` (history it replays is discarded: the transcript lives on the phone);
 * if the agent does not know it any more a new session is created. Returns `null`
 * when the connection already had a session, so nothing changed.
 */
export async function ensureSession(
  live: LiveAgentConnection,
  backend: AgentThreadBackend,
): Promise<SessionSetup | null> {
  if (live.sessionId) return null;
  let setup: SessionSetup | null = null;
  if (backend.sessionId && live.loadSession) setup = await loadSession(live, backend, backend.sessionId);
  if (!setup) setup = await createSession(live, backend);
  await restoreMode(live, setup, backend.modeId);
  return setup;
}
