import { createHash, randomBytes, timingSafeEqual } from 'node:crypto';
import { createServer as createHttpServer, type Server as HttpServer } from 'node:http';
import { createServer as createHttpsServer } from 'node:https';
import { readFile } from 'node:fs/promises';
import { hostname } from 'node:os';
import type { IncomingMessage } from 'node:http';
import { isAbsolute } from 'node:path';
import { WebSocket, WebSocketServer } from 'ws';
import { AgentConnection, sendFrame } from './connection.js';
import { isExecutableOnPath, toAgentInfo, type AgentDefinition } from './agents.js';
import { listWorkspaces } from './workspaces.js';
import { isInsideRoot, realpathOrNull, resolveRoots } from './paths.js';
import {
  BRIDGE_PROTOCOL_VERSION,
  type AgentInfo,
  type ClientFrame,
  type JsonRpcMessage,
} from './protocol.js';

export const MAX_FRAME_BYTES = 8 * 1024 * 1024;
export const DEFAULT_AUTH_TIMEOUT_MS = 5000;
export const DEFAULT_AUTH_BLOCK_MS = 60_000;
export const DEFAULT_MAX_CONNECTIONS = 8;
export const DEFAULT_IDLE_TTL_MS = 12 * 60 * 60 * 1000;
export const DEFAULT_PING_INTERVAL_MS = 20_000;
export const DEFAULT_PONG_TIMEOUT_MS = 10_000;
export const DEFAULT_IDLE_SWEEP_INTERVAL_MS = 60_000;
export const DEFAULT_EXIT_RETENTION_MS = 10 * 60 * 1000;
const JSON_RPC_INVALID_PARAMS = -32602;

const CWD_GUARDED_METHODS: Record<string, true> = {
  'session/new': true,
  'session/load': true,
  'session/resume': true,
  'session/fork': true,
};

export interface BridgeServerOptions {
  host: string;
  port: number;
  token: string;
  roots: string[];
  agents: AgentDefinition[];
  tls?: { cert: string; key: string };
  maxConnections?: number;
  idleTtlMs?: number;
  replayMaxFrames?: number;
  replayMaxBytes?: number;
  authTimeoutMs?: number;
  authBlockMs?: number;
  pingIntervalMs?: number;
  pongTimeoutMs?: number;
  idleSweepIntervalMs?: number;
  exitRetentionMs?: number;
  now?: () => number;
  bridgeVersion?: string;
}

interface SocketState {
  socket: WebSocket;
  ip: string;
  authenticated: boolean;
  connection: AgentConnection | null;
  authTimer: NodeJS.Timeout | undefined;
  heartbeatTimer: NodeJS.Timeout | undefined;
  pongTimer: NodeJS.Timeout | undefined;
  awaitingPong: boolean;
}

interface AuthFailure {
  count: number;
  blockedUntil: number;
}

/**
 * The WebSocket front door. One socket carries the whole conversation: it
 * authenticates, then either stays unbound (control frames) or binds to a
 * single agent connection.
 */
export class BridgeServer {
  private readonly options: BridgeServerOptions;
  private readonly connections = new Map<string, AgentConnection>();
  private readonly sockets = new Map<WebSocket, SocketState>();
  private readonly failures = new Map<string, AuthFailure>();
  private readonly now: () => number;

  private httpServer: HttpServer | null = null;
  private wss: WebSocketServer | null = null;
  private idleTimer: NodeJS.Timeout | undefined = undefined;
  private resolvedRoots: string[] = [];

  constructor(options: BridgeServerOptions) {
    this.options = options;
    this.now = options.now ?? Date.now;
  }

  async listen(): Promise<{ address: string; port: number }> {
    this.resolvedRoots = await resolveRoots(this.options.roots);

    if (this.options.tls) {
      const [cert, key] = await Promise.all([
        readFile(this.options.tls.cert, 'utf8'),
        readFile(this.options.tls.key, 'utf8'),
      ]);
      this.httpServer = createHttpsServer({ cert, key }, (_req, res) => {
        res.writeHead(426);
        res.end('Upgrade Required');
      });
    } else {
      this.httpServer = createHttpServer((_req, res) => {
        res.writeHead(426);
        res.end('Upgrade Required');
      });
    }

    this.wss = new WebSocketServer({ server: this.httpServer, maxPayload: MAX_FRAME_BYTES });
    this.wss.on('connection', (socket, request) => this.handleConnection(socket, request));

    await new Promise<void>((resolve, reject) => {
      const onError = (error: Error) => reject(error);
      this.httpServer?.once('error', onError);
      this.httpServer?.listen(this.options.port, this.options.host, () => {
        this.httpServer?.off('error', onError);
        resolve();
      });
    });

    this.idleTimer = setInterval(
      () => this.sweepIdle(),
      this.options.idleSweepIntervalMs ?? DEFAULT_IDLE_SWEEP_INTERVAL_MS,
    );
    this.idleTimer.unref?.();

    return this.address();
  }

  address(): { address: string; port: number } {
    const address = this.httpServer?.address();
    if (address && typeof address === 'object') {
      return { address: address.address, port: address.port };
    }
    return { address: this.options.host, port: this.options.port };
  }

  get roots(): string[] {
    return [...this.resolvedRoots];
  }

  get agentInfos(): AgentInfo[] {
    return this.options.agents.map(toAgentInfo);
  }

  /** Number of agent processes currently alive. */
  connectionCount(): number {
    return this.connections.size;
  }

  /** True while a client socket is attached to the connection. */
  isAttached(connectionId: string): boolean {
    return this.connections.get(connectionId)?.isAttached ?? false;
  }

  /** Highest sequence number the agent produced so far. */
  headSeq(connectionId: string): number {
    return this.connections.get(connectionId)?.headSeq ?? 0;
  }

  /** Kills agents that nobody is watching and that have been quiet for too long. */
  sweepIdle(): void {
    const now = this.now();
    const ttl = this.options.idleTtlMs ?? DEFAULT_IDLE_TTL_MS;
    for (const connection of [...this.connections.values()]) {
      if (connection.exited) continue;
      if (!connection.isIdle(now, ttl)) continue;
      this.connections.delete(connection.id);
      connection.kill();
    }
  }

  async close(): Promise<void> {
    clearInterval(this.idleTimer);
    this.idleTimer = undefined;
    for (const connection of this.connections.values()) connection.kill();
    this.connections.clear();
    for (const state of this.sockets.values()) {
      clearTimeout(state.authTimer);
      clearInterval(state.heartbeatTimer);
      clearTimeout(state.pongTimer);
      state.socket.terminate();
    }
    this.sockets.clear();
    if (this.wss) {
      const wss = this.wss;
      this.wss = null;
      await new Promise<void>((resolve) => wss.close(() => resolve()));
    }
    if (this.httpServer) {
      const httpServer = this.httpServer;
      this.httpServer = null;
      httpServer.closeAllConnections?.();
      await new Promise<void>((resolve) => httpServer.close(() => resolve()));
    }
  }

  private handleConnection(socket: WebSocket, request: IncomingMessage): void {
    const ip = request.socket.remoteAddress ?? 'unknown';
    const state: SocketState = {
      socket,
      ip,
      authenticated: false,
      connection: null,
      authTimer: undefined,
      heartbeatTimer: undefined,
      pongTimer: undefined,
      awaitingPong: false,
    };
    this.sockets.set(socket, state);

    if (this.isBlocked(ip)) {
      sendFrame(socket, {
        type: 'error',
        code: 'unauthorized',
        message: 'Too many failed authentication attempts; try again later',
      });
      socket.close();
      return;
    }

    state.authTimer = setTimeout(() => {
      if (state.authenticated) return;
      sendFrame(socket, {
        type: 'error',
        code: 'unauthorized',
        message: 'Authentication timeout',
      });
      socket.close();
    }, this.options.authTimeoutMs ?? DEFAULT_AUTH_TIMEOUT_MS);
    state.authTimer.unref?.();

    socket.on('message', (data) => {
      void this.handleRawMessage(state, data);
    });
    socket.on('close', () => this.handleSocketClose(state));
    socket.on('error', () => {
      /* the close handler performs the cleanup */
    });
    this.startHeartbeat(state);
  }

  private startHeartbeat(state: SocketState): void {
    const socket = state.socket;
    const interval = setInterval(() => {
      if (socket.readyState !== WebSocket.OPEN) return;
      if (state.awaitingPong) {
        socket.terminate();
        return;
      }
      state.awaitingPong = true;
      socket.ping();
      state.pongTimer = setTimeout(() => {
        if (state.awaitingPong) socket.terminate();
      }, this.options.pongTimeoutMs ?? DEFAULT_PONG_TIMEOUT_MS);
      state.pongTimer.unref?.();
    }, this.options.pingIntervalMs ?? DEFAULT_PING_INTERVAL_MS);
    interval.unref?.();
    state.heartbeatTimer = interval;

    socket.on('pong', () => {
      state.awaitingPong = false;
      clearTimeout(state.pongTimer);
      state.pongTimer = undefined;
    });
  }

  private handleSocketClose(state: SocketState): void {
    clearTimeout(state.authTimer);
    clearInterval(state.heartbeatTimer);
    clearTimeout(state.pongTimer);
    this.sockets.delete(state.socket);
    state.connection?.detach(state.socket);
    state.connection = null;
  }

  private async handleRawMessage(state: SocketState, data: WebSocket.RawData): Promise<void> {
    const text = rawDataToText(data);
    let frame: ClientFrame;
    try {
      const parsed: unknown = JSON.parse(text);
      if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
        throw new Error('frame must be a JSON object');
      }
      frame = parsed as ClientFrame;
    } catch (error) {
      sendFrame(state.socket, {
        type: 'error',
        code: 'bad-request',
        message: `Malformed frame: ${(error as Error).message}`,
      });
      return;
    }

    if (!state.authenticated) {
      if (frame.type !== 'auth') {
        sendFrame(state.socket, {
          type: 'error',
          code: 'unauthorized',
          message: 'First frame must be auth',
        });
        state.socket.close();
        return;
      }
      this.handleAuth(state, frame);
      return;
    }

    await this.handleFrame(state, frame);
  }

  private handleAuth(state: SocketState, frame: Extract<ClientFrame, { type: 'auth' }>): void {
    if (state.authenticated) {
      sendFrame(state.socket, {
        type: 'error',
        code: 'bad-request',
        message: 'Already authenticated',
      });
      return;
    }
    if (!tokensMatch(frame.token, this.options.token)) {
      this.recordFailure(state.ip);
      sendFrame(state.socket, { type: 'error', code: 'unauthorized', message: 'Invalid token' });
      state.socket.close();
      return;
    }
    if (frame.protocol !== BRIDGE_PROTOCOL_VERSION) {
      sendFrame(state.socket, {
        type: 'error',
        code: 'protocol-mismatch',
        message: `Unsupported protocol version ${frame.protocol}`,
      });
      state.socket.close();
      return;
    }

    state.authenticated = true;
    clearTimeout(state.authTimer);
    state.authTimer = undefined;
    this.failures.delete(state.ip);
    sendFrame(state.socket, {
      type: 'ready',
      protocol: BRIDGE_PROTOCOL_VERSION,
      bridgeVersion: this.options.bridgeVersion ?? '0.0.0',
      hostname: hostname(),
      agents: this.agentInfos,
      roots: this.resolvedRoots,
    });
  }

  private async handleFrame(state: SocketState, frame: ClientFrame): Promise<void> {
    switch (frame.type) {
      case 'ping':
        sendFrame(state.socket, { type: 'pong' });
        return;
      case 'list-workspaces': {
        const items = await listWorkspaces(this.resolvedRoots);
        sendFrame(state.socket, { type: 'workspaces', items });
        return;
      }
      case 'connect':
        await this.handleConnect(state, frame);
        return;
      case 'resume':
        await this.handleResume(state, frame);
        return;
      case 'rpc':
        await this.handleRpc(state, frame);
        return;
      case 'disconnect':
        this.handleDisconnect(state, frame);
        return;
      case 'auth':
        sendFrame(state.socket, {
          type: 'error',
          code: 'bad-request',
          message: 'Already authenticated',
        });
        return;
      default: {
        // Exhaustiveness guard: keep the payload typed instead of casting inline.
        const unknownFrame = frame as { type?: unknown };
        sendFrame(state.socket, {
          type: 'error',
          code: 'bad-request',
          message: `Unknown frame type: ${String(unknownFrame.type)}`,
        });
      }
    }
  }

  private async handleConnect(
    state: SocketState,
    frame: Extract<ClientFrame, { type: 'connect' }>,
  ): Promise<void> {
    if (state.connection) {
      sendFrame(state.socket, {
        type: 'error',
        code: 'bad-request',
        message: 'Socket is already bound to a connection',
      });
      return;
    }
    const agent = this.options.agents.find((candidate) => candidate.id === frame.agent);
    if (!agent) {
      sendFrame(state.socket, {
        type: 'error',
        code: 'unknown-agent',
        message: `No agent named "${frame.agent}"`,
      });
      return;
    }
    if (!isExecutableOnPath(agent.probe)) {
      sendFrame(state.socket, {
        type: 'error',
        code: 'agent-unavailable',
        message: `"${agent.probe}" is not available on the bridge host`,
      });
      return;
    }
    const maxConnections = this.options.maxConnections ?? DEFAULT_MAX_CONNECTIONS;
    if (this.liveConnectionCount() >= maxConnections) {
      sendFrame(state.socket, {
        type: 'error',
        code: 'too-many-connections',
        message: `Bridge already runs ${maxConnections} agents`,
      });
      return;
    }

    const cwd = this.resolvedRoots[0] ?? process.cwd();
    let connection: AgentConnection;
    try {
      connection = await AgentConnection.start({
        id: randomBytes(16).toString('hex'),
        agent,
        cwd,
        replayMaxFrames: this.options.replayMaxFrames,
        replayMaxBytes: this.options.replayMaxBytes,
        now: this.now,
        onExit: (exited) => this.scheduleConnectionCleanup(exited),
      });
    } catch (error) {
      sendFrame(state.socket, {
        type: 'error',
        code: 'spawn-failed',
        message: `Could not start "${agent.command}": ${(error as Error).message}`,
      });
      return;
    }

    this.connections.set(connection.id, connection);
    state.connection = connection;
    connection.attach(state.socket);

    const replay = connection.replay(0);
    sendFrame(state.socket, {
      type: 'connected',
      connectionId: connection.id,
      agent: agent.id,
      resumed: false,
      replayCount: replay.frames.length,
      headSeq: connection.headSeq,
    });
    for (const frame of replay.frames) {
      sendFrame(state.socket, { type: 'rpc', seq: frame.seq, message: frame.message });
    }
  }

  private async handleResume(
    state: SocketState,
    frame: Extract<ClientFrame, { type: 'resume' }>,
  ): Promise<void> {
    if (state.connection) {
      sendFrame(state.socket, {
        type: 'error',
        code: 'bad-request',
        message: 'Socket is already bound to a connection',
      });
      return;
    }
    const connection = this.connections.get(frame.connectionId);
    if (!connection) {
      sendFrame(state.socket, {
        type: 'error',
        code: 'unknown-connection',
        message: `Unknown connection "${frame.connectionId}"`,
      });
      return;
    }
    const replay = connection.replay(frame.lastSeq);
    if (replay.gap) {
      sendFrame(state.socket, {
        type: 'error',
        code: 'replay-gap',
        message: 'Requested cursor is older than the replay window; reconnect with session/load',
      });
      return;
    }

    connection.attach(state.socket);
    state.connection = connection;
    sendFrame(state.socket, {
      type: 'connected',
      connectionId: connection.id,
      agent: connection.agentId,
      resumed: true,
      replayCount: replay.frames.length,
      headSeq: connection.headSeq,
    });
    for (const replayed of replay.frames) {
      sendFrame(state.socket, { type: 'rpc', seq: replayed.seq, message: replayed.message });
    }
    if (connection.exited) {
      const info = connection.exitInfo;
      sendFrame(state.socket, { type: 'agent-exit', code: info.code, signal: info.signal });
    }
  }

  private async handleRpc(
    state: SocketState,
    frame: Extract<ClientFrame, { type: 'rpc' }>,
  ): Promise<void> {
    const connection = state.connection;
    if (!connection) {
      sendFrame(state.socket, {
        type: 'error',
        code: 'not-bound',
        message: 'Socket is not bound to an agent connection',
      });
      return;
    }
    const message = frame.message;
    if (!message || typeof message !== 'object') {
      sendFrame(state.socket, {
        type: 'error',
        code: 'bad-request',
        message: 'rpc frame needs a message object',
      });
      return;
    }

    const rejection = await this.checkCwd(message);
    if (rejection) {
      sendFrame(state.socket, { type: 'error', code: 'forbidden-cwd', message: rejection });
      if (message.id !== undefined && message.id !== null) {
        connection.emitBridgeError(message.id, JSON_RPC_INVALID_PARAMS, rejection);
      }
      return;
    }

    if (!message.method && message.id !== undefined && message.id !== null) {
      connection.markAnswered(message.id);
    }
    if (!connection.sendToAgent(message)) {
      sendFrame(state.socket, {
        type: 'error',
        code: 'bad-request',
        message: 'The agent is not running anymore',
      });
    }
  }

  private handleDisconnect(
    state: SocketState,
    frame: Extract<ClientFrame, { type: 'disconnect' }>,
  ): void {
    const connection = state.connection;
    if (!connection) {
      sendFrame(state.socket, {
        type: 'error',
        code: 'not-bound',
        message: 'Socket is not bound to an agent connection',
      });
      return;
    }
    state.connection = null;
    if (frame.kill) {
      this.connections.delete(connection.id);
      connection.kill();
      return;
    }
    connection.detach(state.socket);
  }

  /** Guards the ACP session methods that pick a working directory. */
  private async checkCwd(message: JsonRpcMessage): Promise<string | null> {
    const method = message.method;
    if (!method || !CWD_GUARDED_METHODS[method]) return null;
    const params = message.params;
    if (!params || typeof params !== 'object') {
      return `params.cwd is required for ${method}`;
    }
    if (!('cwd' in params)) {
      return `params.cwd is required for ${method}`;
    }
    const cwd = params.cwd;
    if (typeof cwd !== 'string' || cwd.length === 0) {
      return `params.cwd must be a non-empty string for ${method}`;
    }
    if (!isAbsolute(cwd)) {
      return `params.cwd must be an absolute path (got "${cwd}")`;
    }
    const real = await realpathOrNull(cwd);
    if (!real) {
      return `params.cwd does not exist: ${cwd}`;
    }
    for (const root of this.resolvedRoots) {
      if (isInsideRoot(real, root)) return null;
    }
    return `params.cwd "${cwd}" is outside the bridge roots (${this.resolvedRoots.join(', ')})`;
  }

  private liveConnectionCount(): number {
    let live = 0;
    for (const connection of this.connections.values()) {
      if (!connection.exited) live += 1;
    }
    return live;
  }

  private scheduleConnectionCleanup(connection: AgentConnection): void {
    const timer = setTimeout(
      () => this.connections.delete(connection.id),
      this.options.exitRetentionMs ?? DEFAULT_EXIT_RETENTION_MS,
    );
    timer.unref?.();
  }

  private isBlocked(ip: string): boolean {
    const failure = this.failures.get(ip);
    if (!failure) return false;
    if (failure.blockedUntil === 0) return false;
    if (failure.blockedUntil > this.now()) return true;
    // The block expired: the next failure starts a new streak.
    failure.blockedUntil = 0;
    failure.count = 0;
    return false;
  }

  private recordFailure(ip: string): void {
    const failure = this.failures.get(ip) ?? { count: 0, blockedUntil: 0 };
    failure.count += 1;
    if (failure.count >= 5) {
      failure.blockedUntil = this.now() + (this.options.authBlockMs ?? DEFAULT_AUTH_BLOCK_MS);
    }
    this.failures.set(ip, failure);
  }
}

/** Constant-time comparison of two tokens through equal-length digests. */
export function tokensMatch(candidate: string, expected: string): boolean {
  const candidateDigest = createHash('sha256').update(candidate).digest();
  const expectedDigest = createHash('sha256').update(expected).digest();
  return timingSafeEqual(candidateDigest, expectedDigest);
}

function rawDataToText(data: WebSocket.RawData): string {
  if (typeof data === 'string') return data;
  if (Buffer.isBuffer(data)) return data.toString('utf8');
  if (Array.isArray(data)) return Buffer.concat(data).toString('utf8');
  return Buffer.from(data).toString('utf8');
}
