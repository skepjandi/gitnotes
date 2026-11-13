import {
  BRIDGE_PROTOCOL_VERSION,
  CLIENT_PING_INTERVAL_MS,
  CLIENT_PONG_TIMEOUT_MS,
  type BridgeErrorCode,
  type ClientFrame,
  type JsonRpcMessage,
  type ServerFrame,
  type WorkspaceInfo,
} from '../../../bridge/src/protocol';
import { BridgeError } from './types';

export interface WebSocketLike {
  readonly readyState: number;
  send(data: string): void;
  close(code?: number, reason?: string): void;
  onopen: ((event: unknown) => void) | null;
  onmessage: ((event: { data: unknown }) => void) | null;
  onerror: ((event: { message?: string }) => void) | null;
  onclose: ((event: { code?: number; reason?: string }) => void) | null;
}

export type WebSocketConstructor = new (url: string) => WebSocketLike;

const WS_OPEN = 1;
const MAX_QUEUED_MESSAGES = 256;

export type ReadyFrame = Extract<ServerFrame, { type: 'ready' }>;
export type ConnectedFrame = Extract<ServerFrame, { type: 'connected' }>;

type ReplyFor<K extends RequestFrame['type']> = K extends 'fs-search'
  ? Extract<ReplyFrame, { type: 'fs-results' }>
  : K extends 'git'
    ? Extract<ReplyFrame, { type: 'git-result' }>
    : K extends 'list-sessions'
      ? Extract<ReplyFrame, { type: 'sessions-result' }>
      : Extract<ReplyFrame, { type: 'ports-result' }>;

export type BridgeLinkState = 'idle' | 'connecting' | 'ready' | 'reconnecting' | 'closed';

/** Why the connection was abandoned for good. */
export type BridgeLostReason = 'replay-gap' | 'unknown-connection' | 'superseded' | 'unauthorized' | 'fatal';

export type BridgeEvent =
  | { type: 'rpc'; seq: number; message: JsonRpcMessage }
  | { type: 'state'; state: BridgeLinkState }
  | { type: 'log'; text: string }
  | { type: 'agent-exit'; code: number | null; signal: string | null }
  /** Non-fatal bridge complaint (`bad-request`, `not-bound`, ...). */
  | { type: 'error'; code: BridgeErrorCode; message: string }
  /** Terminal: the bridge-side connection cannot be re-attached by this object any more. */
  | { type: 'lost'; reason: BridgeLostReason; message: string };

export type BridgeListener = (event: BridgeEvent) => void;

export interface BridgeConnectionOptions {
  url: string;
  token: string;
  /** Defaults to the runtime's global `WebSocket`. */
  webSocket?: WebSocketConstructor;
  pingIntervalMs?: number;
  pongTimeoutMs?: number;
  /** Time allowed for TCP/TLS + WebSocket upgrade, and for each control round-trip. */
  handshakeTimeoutMs?: number;
  /** Time allowed for one `request()` round-trip. */
  requestTimeoutMs?: number;
  reconnectBaseMs?: number;
  reconnectMaxMs?: number;
  random?: () => number;
}

interface Waiter {
  handle(frame: ServerFrame): boolean;
  fail(error: Error): void;
}

type RequestFrame = Extract<ClientFrame, { reqId: string }>;
type ReplyFrame = Extract<ServerFrame, { type: 'fs-results' | 'git-result' | 'ports-result' | 'sessions-result' }>;

interface PendingRequest {
  resolve(frame: ReplyFrame): void;
  reject(error: Error): void;
  timer: ReturnType<typeof setTimeout>;
}

const REQUEST_TIMEOUT_MS = 10_000;

const CLEARTEXT_PATTERN = /cleartext|app transport security|\bats\b|not permitted by network security policy/i;

function frameError(frame: Extract<ServerFrame, { type: 'error' }>): BridgeError {
  if (frame.code === 'unauthorized') return new BridgeError('unauthorized', frame.message, frame.code);
  if (frame.code === 'protocol-mismatch') return new BridgeError('protocol-mismatch', frame.message, frame.code);
  return new BridgeError('unknown', frame.message, frame.code);
}

/** Error codes after which re-attaching to the same agent connection can never work. */
function permanentReason(code: BridgeErrorCode | undefined): BridgeLostReason | null {
  switch (code) {
    case 'replay-gap':
      return 'replay-gap';
    case 'unknown-connection':
      return 'unknown-connection';
    case 'superseded':
      return 'superseded';
    case 'unauthorized':
      return 'unauthorized';
    default:
      return null;
  }
}

function reconnectFailureReason(error: unknown): BridgeLostReason | null {
  if (!(error instanceof BridgeError)) return null;
  const permanent = permanentReason(error.code);
  if (permanent) return permanent;
  return error.kind === 'protocol-mismatch' || error.code === 'too-many-connections' || error.code === 'bad-request'
    ? 'fatal'
    : null;
}

function resolveWebSocket(injected: WebSocketConstructor | undefined): WebSocketConstructor {
  if (injected) return injected;
  if (typeof WebSocket === 'undefined') throw new BridgeError('unreachable', 'WebSockets are not available on this device');
  const globalSocket: unknown = WebSocket;
  return globalSocket as WebSocketConstructor;
}

/**
 * One authenticated WebSocket to a `gitnotes-bridge`, bound to at most one agent connection.
 * After `connect`/`resume` succeeded, a lost socket is re-established transparently: the
 * object re-authenticates and issues `resume{connectionId,lastSeq}` with the highest
 * sequence it already delivered, so listeners never see a frame twice.
 */
export class BridgeConnection {
  private readonly options: BridgeConnectionOptions;
  private readonly listeners = new Set<BridgeListener>();
  private socket: WebSocketLike | null = null;
  private socketGeneration = 0;
  private waiter: Waiter | null = null;
  private abortEstablish: ((error: Error) => void) | null = null;
  private readonly requests = new Map<string, PendingRequest>();
  private outbox: JsonRpcMessage[] = [];
  private bound: { connectionId: string; agent: string } | null = null;
  private highestSeq = 0;
  private linkState: BridgeLinkState = 'idle';
  private pingTimer: ReturnType<typeof setInterval> | null = null;
  private pongTimer: ReturnType<typeof setTimeout> | null = null;
  private reconnectTimer: ReturnType<typeof setTimeout> | null = null;
  private reconnectWake: (() => void) | null = null;
  private reconnecting = false;
  private requestCounter = 0;

  constructor(options: BridgeConnectionOptions) {
    this.options = options;
  }

  get state(): BridgeLinkState {
    return this.linkState;
  }

  get connectionId(): string | null {
    return this.bound?.connectionId ?? null;
  }

  get lastSeq(): number {
    return this.highestSeq;
  }

  subscribe(listener: BridgeListener): () => void {
    this.listeners.add(listener);
    return () => {
      this.listeners.delete(listener);
    };
  }

  /** Opens the socket and authenticates. Resolves with the bridge's `ready` frame. */
  async open(): Promise<ReadyFrame> {
    if (this.linkState === 'closed') throw new BridgeError('unreachable', 'Connection is closed');
    this.setState('connecting');
    try {
      const ready = await this.establish();
      this.setState('ready');
      return ready;
    } catch (error) {
      this.dropSocket();
      this.setState('idle');
      throw error;
    }
  }

  async listWorkspaces(): Promise<WorkspaceInfo[]> {
    const frame = await this.exchange({ type: 'list-workspaces' }, (candidate) =>
      candidate.type === 'workspaces' ? candidate : null,
    );
    return frame.items;
  }

  /** Spawns `agent` on the bridge and binds this socket to it. */
  async connect(agent: string): Promise<ConnectedFrame> {
    const frame = await this.exchange({ type: 'connect', agent }, (candidate) =>
      candidate.type === 'connected' ? candidate : null,
    );
    this.bound = { connectionId: frame.connectionId, agent: frame.agent };
    this.highestSeq = 0;
    return frame;
  }

  /**
   * Re-attaches to a running agent. Resolves after `connected` and every replayed
   * frame has been delivered to listeners.
   */
  async resume(connectionId: string, lastSeq: number): Promise<ConnectedFrame> {
    const previous = this.bound;
    this.bound = { connectionId, agent: previous?.agent ?? '' };
    this.highestSeq = Math.max(lastSeq, 0);
    try {
      return await this.resumeBound();
    } catch (error) {
      this.bound = previous;
      throw error;
    }
  }

  /**
   * Request/response frame (`fs-search`, `git`, `ports`) correlated by `reqId`. Rejects with a
   * `BridgeError` carrying the bridge's code on `request-error`, `timeout` when unanswered.
   */
  request<K extends RequestFrame['type']>(
    type: K,
    body: Omit<Extract<RequestFrame, { type: K }>, 'type' | 'reqId'>,
  ): Promise<ReplyFor<K>> {
    if (!this.isSocketOpen()) return Promise.reject(new BridgeError('unreachable', 'Socket is not open'));
    const reqId = `req_${++this.requestCounter}`;
    return new Promise<ReplyFor<K>>((resolve, reject) => {
      const timer = setTimeout(() => {
        this.requests.delete(reqId);
        reject(new BridgeError('timeout', 'The bridge did not answer in time'));
      }, this.options.requestTimeoutMs ?? REQUEST_TIMEOUT_MS);
      this.requests.set(reqId, { resolve: (reply) => resolve(reply as ReplyFor<K>), reject, timer });
      try {
        this.sendFrame({ ...body, type, reqId } as unknown as ClientFrame);
      } catch (error) {
        clearTimeout(timer);
        this.requests.delete(reqId);
        reject(error instanceof Error ? error : new BridgeError('unreachable', 'Could not send to the bridge'));
      }
    });
  }

  /** Queues while the socket is down; flushed in order after the next successful resume. */
  send(message: JsonRpcMessage): void {
    if (this.linkState === 'closed') throw new BridgeError('unreachable', 'Connection is closed');
    if (this.linkState === 'ready' && this.isSocketOpen()) {
      this.sendFrame({ type: 'rpc', message });
      return;
    }
    if (!this.bound) throw new BridgeError('unreachable', 'Not connected to an agent');
    if (this.outbox.length >= MAX_QUEUED_MESSAGES) throw new BridgeError('unreachable', 'Too many messages queued while offline');
    this.outbox.push(message);
  }

  /** Unbinds; `kill` also terminates the agent process on the host. */
  close(options: { kill?: boolean } = {}): void {
    if (this.linkState === 'closed') return;
    if (this.bound && this.isSocketOpen()) {
      try {
        this.sendFrame(options.kill ? { type: 'disconnect', kill: true } : { type: 'disconnect' });
      } catch {
        /* socket already gone */
      }
    }
    this.terminate();
  }

  private emit(event: BridgeEvent): void {
    for (const listener of [...this.listeners]) {
      listener(event);
    }
  }

  private setState(state: BridgeLinkState): void {
    if (this.linkState === state) return;
    this.linkState = state;
    this.emit({ type: 'state', state });
  }

  private isSocketOpen(): boolean {
    return this.socket !== null && this.socket.readyState === WS_OPEN;
  }

  private sendFrame(frame: ClientFrame): void {
    if (!this.socket || !this.isSocketOpen()) throw new BridgeError('unreachable', 'Socket is not open');
    this.socket.send(JSON.stringify(frame));
  }

  private get handshakeTimeoutMs(): number {
    return this.options.handshakeTimeoutMs ?? 10_000;
  }

  private establish(): Promise<ReadyFrame> {
    this.dropSocket();
    const generation = ++this.socketGeneration;
    const Ctor = resolveWebSocket(this.options.webSocket);

    return new Promise<ReadyFrame>((resolve, reject) => {
      let socket: WebSocketLike;
      try {
        socket = new Ctor(this.options.url);
      } catch (error) {
        reject(new BridgeError('unreachable', error instanceof Error ? error.message : 'Invalid bridge address'));
        return;
      }
      this.socket = socket;

      let settled = false;
      let opened = false;
      const timeout = setTimeout(() => {
        fail(new BridgeError('timeout', 'Timed out connecting to the bridge'));
      }, this.handshakeTimeoutMs);

      const finish = () => {
        settled = true;
        clearTimeout(timeout);
      };
      const fail = (error: Error) => {
        if (settled) return;
        finish();
        if (this.waiter === waiter) this.waiter = null;
        reject(error);
      };
      this.abortEstablish = fail;
      const waiter: Waiter = {
        handle: (frame) => {
          if (frame.type === 'ready') {
            if (settled) return true;
            finish();
            this.waiter = null;
            this.startHeartbeat();
            resolve(frame);
            return true;
          }
          if (frame.type === 'error') {
            fail(frameError(frame));
            return true;
          }
          return false;
        },
        fail,
      };

      socket.onopen = () => {
        if (generation !== this.socketGeneration) return;
        opened = true;
        this.waiter = waiter;
        try {
          socket.send(JSON.stringify({ type: 'auth', token: this.options.token, protocol: BRIDGE_PROTOCOL_VERSION } satisfies ClientFrame));
        } catch (error) {
          fail(new BridgeError('unreachable', error instanceof Error ? error.message : 'Could not send to the bridge'));
        }
      };
      socket.onmessage = (event) => {
        if (generation !== this.socketGeneration) return;
        this.receive(event.data);
      };
      socket.onerror = (event) => {
        if (generation !== this.socketGeneration || opened) return;
        const detail = event?.message ?? '';
        if (this.options.url.startsWith('ws://') && CLEARTEXT_PATTERN.test(detail)) {
          fail(
            new BridgeError(
              'cleartext-blocked',
              'The operating system blocks unencrypted ws:// connections to this host. Use wss:// (for example through a Tailscale or Cloudflare tunnel).',
            ),
          );
          return;
        }
        fail(new BridgeError('unreachable', detail ? `Could not reach the bridge: ${detail}` : 'Could not reach the bridge'));
      };
      socket.onclose = () => {
        if (generation !== this.socketGeneration) return;
        fail(new BridgeError('unreachable', 'The bridge closed the connection'));
        this.handleSocketLoss(generation);
      };
    });
  }

  /** Sends a control frame on the established socket and waits for the frame `pick` selects. */
  private exchange<T>(frame: ClientFrame, pick: (candidate: ServerFrame) => T | null): Promise<T> {
    if (!this.isSocketOpen()) return Promise.reject(new BridgeError('unreachable', 'Socket is not open'));
    return new Promise<T>((resolve, reject) => {
      const timeout = setTimeout(() => fail(new BridgeError('timeout', 'The bridge did not answer in time')), this.handshakeTimeoutMs);
      const clear = () => {
        clearTimeout(timeout);
        if (this.waiter === waiter) this.waiter = null;
      };
      const fail = (error: Error) => {
        clear();
        reject(error);
      };
      const waiter: Waiter = {
        handle: (candidate) => {
          if (candidate.type === 'error') {
            fail(frameError(candidate));
            return true;
          }
          const picked = pick(candidate);
          if (picked === null) return false;
          clear();
          resolve(picked);
          return true;
        },
        fail,
      };
      this.waiter = waiter;
      try {
        this.sendFrame(frame);
      } catch (error) {
        fail(error instanceof Error ? error : new BridgeError('unreachable', 'Could not send to the bridge'));
      }
    });
  }

  private resumeBound(): Promise<ConnectedFrame> {
    const bound = this.bound;
    if (!bound) return Promise.reject(new BridgeError('unreachable', 'Not bound to an agent connection'));
    if (!this.isSocketOpen()) return Promise.reject(new BridgeError('unreachable', 'Socket is not open'));

    return new Promise<ConnectedFrame>((resolve, reject) => {
      let connected: ConnectedFrame | null = null;
      let remaining = 0;
      const timeout = setTimeout(() => fail(new BridgeError('timeout', 'The bridge did not answer in time')), this.handshakeTimeoutMs);
      const clear = () => {
        clearTimeout(timeout);
        if (this.waiter === waiter) this.waiter = null;
      };
      const fail = (error: Error) => {
        clear();
        reject(error);
      };
      const done = () => {
        clear();
        if (connected) resolve(connected);
      };
      const waiter: Waiter = {
        handle: (frame) => {
          if (frame.type === 'error') {
            fail(frameError(frame));
            return true;
          }
          if (frame.type === 'connected' && !connected) {
            connected = frame;
            this.bound = { connectionId: frame.connectionId, agent: frame.agent };
            remaining = frame.replayCount;
            if (remaining === 0) done();
            return true;
          }
          if (frame.type === 'rpc' && connected) {
            remaining -= 1;
            queueMicrotask(() => {
              if (remaining <= 0 && connected) done();
            });
          }
          return false;
        },
        fail,
      };
      this.waiter = waiter;
      try {
        this.sendFrame({ type: 'resume', connectionId: bound.connectionId, lastSeq: this.highestSeq });
      } catch (error) {
        fail(error instanceof Error ? error : new BridgeError('unreachable', 'Could not send to the bridge'));
      }
    });
  }

  private receive(data: unknown): void {
    if (typeof data !== 'string') return;
    let frame: ServerFrame;
    try {
      frame = JSON.parse(data) as ServerFrame;
    } catch {
      return;
    }
    if (!frame || typeof frame !== 'object' || typeof frame.type !== 'string') return;

    this.markAlive();
    if (this.settleRequest(frame)) return;
    if (this.waiter?.handle(frame)) return;

    switch (frame.type) {
      case 'rpc':
        if (frame.seq <= this.highestSeq) return;
        this.highestSeq = frame.seq;
        this.emit({ type: 'rpc', seq: frame.seq, message: frame.message });
        return;
      case 'log':
        this.emit({ type: 'log', text: frame.text });
        return;
      case 'agent-exit':
        this.emit({ type: 'agent-exit', code: frame.code, signal: frame.signal });
        return;
      case 'error':
        this.handleAsyncError(frame);
        return;
      default:
        return;
    }
  }

  private settleRequest(frame: ServerFrame): boolean {
    if (frame.type !== 'fs-results' && frame.type !== 'git-result' && frame.type !== 'ports-result' &&
      frame.type !== 'sessions-result' &&
      frame.type !== 'request-error') {
      return false;
    }
    const pending = this.requests.get(frame.reqId);
    if (!pending) return true;
    this.requests.delete(frame.reqId);
    clearTimeout(pending.timer);
    if (frame.type === 'request-error') pending.reject(new BridgeError('unknown', frame.message, frame.code));
    else pending.resolve(frame);
    return true;
  }

  private failRequests(error: Error): void {
    const pending = [...this.requests.values()];
    this.requests.clear();
    for (const request of pending) {
      clearTimeout(request.timer);
      request.reject(error);
    }
  }

  private handleAsyncError(frame: Extract<ServerFrame, { type: 'error' }>): void {
    const reason = permanentReason(frame.code);
    if (reason) {
      this.abandon(reason, frame.message);
      return;
    }
    this.emit({ type: 'error', code: frame.code, message: frame.message });
  }

  private startHeartbeat(): void {
    this.stopHeartbeat();
    const interval = this.options.pingIntervalMs ?? CLIENT_PING_INTERVAL_MS;
    const generation = this.socketGeneration;
    this.pingTimer = setInterval(() => {
      if (generation !== this.socketGeneration || !this.isSocketOpen()) return;
      if (this.pongTimer) return;
      try {
        this.sendFrame({ type: 'ping' });
      } catch {
        this.handleSocketLoss(generation);
        return;
      }
      this.pongTimer = setTimeout(() => {
        this.pongTimer = null;
        this.handleSocketLoss(generation);
      }, this.options.pongTimeoutMs ?? CLIENT_PONG_TIMEOUT_MS);
    }, interval);
  }

  private markAlive(): void {
    if (this.pongTimer) {
      clearTimeout(this.pongTimer);
      this.pongTimer = null;
    }
  }

  private stopHeartbeat(): void {
    if (this.pingTimer) clearInterval(this.pingTimer);
    if (this.pongTimer) clearTimeout(this.pongTimer);
    this.pingTimer = null;
    this.pongTimer = null;
  }

  private dropSocket(): void {
    this.stopHeartbeat();
    const abort = this.abortEstablish;
    this.abortEstablish = null;
    abort?.(new BridgeError('unreachable', 'Connection closed'));
    this.socketGeneration += 1;
    const socket = this.socket;
    this.socket = null;
    if (!socket) return;
    socket.onopen = null;
    socket.onmessage = null;
    socket.onerror = () => undefined;
    socket.onclose = null;
    try {
      socket.close();
    } catch {
      /* already closed */
    }
  }

  private isClosed(): boolean {
    return this.linkState === 'closed';
  }

  private handleSocketLoss(generation: number): void {
    if (generation !== this.socketGeneration || this.linkState === 'closed') return;
    this.dropSocket();
    const waiter = this.waiter;
    this.waiter = null;
    waiter?.fail(new BridgeError('unreachable', 'The connection to the bridge was lost'));
    this.failRequests(new BridgeError('unreachable', 'The connection to the bridge was lost'));
    if (!this.bound) {
      this.setState('idle');
      return;
    }
    void this.reconnect();
  }

  private async reconnect(): Promise<void> {
    if (this.reconnecting) return;
    this.reconnecting = true;
    this.setState('reconnecting');
    let attempt = 0;
    try {
      while (!this.isClosed()) {
        await this.sleepBeforeAttempt(attempt);
        attempt += 1;
        if (this.isClosed()) return;
        try {
          await this.establish();
          await this.resumeBound();
          this.setState('ready');
          this.flushOutbox();
          return;
        } catch (error) {
          this.dropSocket();
          const reason = reconnectFailureReason(error);
          if (reason) {
            this.abandon(reason, error instanceof Error ? error.message : 'Connection lost');
            return;
          }
        }
      }
    } finally {
      this.reconnecting = false;
    }
  }

  private sleepBeforeAttempt(attempt: number): Promise<void> {
    if (attempt === 0) return Promise.resolve();
    const base = this.options.reconnectBaseMs ?? 500;
    const cap = this.options.reconnectMaxMs ?? 15_000;
    const ceiling = Math.min(cap, base * 2 ** (attempt - 1));
    const jitter = (this.options.random ?? Math.random)();
    const delay = Math.round(ceiling / 2 + (ceiling / 2) * jitter);
    return new Promise<void>((resolve) => {
      const wake = () => {
        if (this.reconnectTimer) clearTimeout(this.reconnectTimer);
        this.reconnectTimer = null;
        this.reconnectWake = null;
        resolve();
      };
      this.reconnectWake = wake;
      this.reconnectTimer = setTimeout(wake, delay);
    });
  }

  private flushOutbox(): void {
    const queued = this.outbox;
    this.outbox = [];
    for (let index = 0; index < queued.length; index += 1) {
      try {
        this.sendFrame({ type: 'rpc', message: queued[index] as JsonRpcMessage });
      } catch {
        this.outbox = queued.slice(index);
        return;
      }
    }
  }

  private abandon(reason: BridgeLostReason, message: string): void {
    this.emit({ type: 'lost', reason, message });
    this.terminate();
  }

  private terminate(): void {
    this.outbox = [];
    this.waiter?.fail(new BridgeError('unreachable', 'Connection closed'));
    this.waiter = null;
    this.failRequests(new BridgeError('unreachable', 'Connection closed'));
    this.dropSocket();
    this.reconnectWake?.();
    this.setState('closed');
  }
}
