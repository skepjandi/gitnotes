import { type ChildProcess, spawn } from 'node:child_process';
import { WebSocket } from 'ws';
import type { AgentDefinition } from './agents.js';
import { NdjsonDecoder } from './ndjson.js';
import type { JsonRpcMessage, ServerFrame } from './protocol.js';

export const DEFAULT_REPLAY_MAX_FRAMES = 5000;
export const DEFAULT_REPLAY_MAX_BYTES = 32 * 1024 * 1024;
const MAX_TRACKED_REQUESTS = 5000;
const MAX_LOG_LINES = 200;
const KILL_GRACE_MS = 3000;

export interface ReplayFrame {
  seq: number;
  message: JsonRpcMessage;
  bytes: number;
}

export interface ReplayResult {
  /** The requested cursor fell out of the replay window. */
  gap: boolean;
  frames: ReplayFrame[];
}

export interface AgentConnectionOptions {
  id: string;
  agent: AgentDefinition;
  cwd: string;
  env?: NodeJS.ProcessEnv;
  replayMaxFrames?: number;
  replayMaxBytes?: number;
  now?: () => number;
  onExit?: (connection: AgentConnection) => void;
}

export function isRequest(
  message: JsonRpcMessage,
): message is JsonRpcMessage & { id: number | string; method: string } {
  return typeof message.method === 'string' && message.id !== undefined && message.id !== null;
}

/** Stable key for a JSON-RPC id so `1` and `"1"` never collide. */
export function requestKey(id: number | string): string {
  return `${typeof id}:${String(id)}`;
}

/**
 * One spawned ACP agent plus everything needed to survive a disconnected
 * phone: the replay ring, the set of agent requests the client already
 * answered, and the socket that is currently attached.
 */
export class AgentConnection {
  readonly id: string;
  readonly agentId: string;
  readonly agentName: string;
  readonly startedAt: number;

  private readonly child: ChildProcess;
  private readonly decoder = new NdjsonDecoder();
  private readonly frames: ReplayFrame[] = [];
  private readonly pendingRequests = new Set<string>();
  private readonly maxFrames: number;
  private readonly maxBytes: number;
  private readonly now: () => number;
  private readonly onExit: ((connection: AgentConnection) => void) | undefined;

  private frameBytes = 0;
  private nextSeq = 1;
  private logCount = 0;
  private attachedSocket: WebSocket | null = null;
  private lastOutputAt: number;
  private killTimer: NodeJS.Timeout | null = null;
  private exitCode: number | null = null;
  private exitSignal: string | null = null;
  private hasExited = false;

  private constructor(child: ChildProcess, options: AgentConnectionOptions) {
    this.child = child;
    this.id = options.id;
    this.agentId = options.agent.id;
    this.agentName = options.agent.name;
    this.maxFrames = options.replayMaxFrames ?? DEFAULT_REPLAY_MAX_FRAMES;
    this.maxBytes = options.replayMaxBytes ?? DEFAULT_REPLAY_MAX_BYTES;
    this.now = options.now ?? Date.now;
    this.onExit = options.onExit;
    this.startedAt = this.now();
    this.lastOutputAt = this.startedAt;

    child.stdout?.setEncoding('utf8');
    child.stdout?.on('data', (chunk: string) => this.handleStdout(chunk));
    child.stderr?.setEncoding('utf8');
    child.stderr?.on('data', (chunk: string) => this.handleStderr(chunk));
    child.on('exit', (code, signal) => this.handleExit(code, signal));
    child.on('error', (error: Error) => this.handleChildError(error));
  }

  /** Spawns the agent and resolves once the OS accepted the process. */
  static async start(options: AgentConnectionOptions): Promise<AgentConnection> {
    const child = spawn(options.agent.command, options.agent.args, {
      cwd: options.cwd,
      env: { ...process.env, ...options.agent.env, ...options.env },
      shell: false,
      stdio: ['pipe', 'pipe', 'pipe'],
    });
    const connection = new AgentConnection(child, options);
    await connection.waitForSpawn();
    return connection;
  }

  private waitForSpawn(): Promise<void> {
    return new Promise<void>((resolve, reject) => {
      const onSpawn = () => {
        this.child.off('error', onError);
        resolve();
      };
      const onError = (error: Error) => {
        this.child.off('spawn', onSpawn);
        reject(error);
      };
      this.child.once('spawn', onSpawn);
      this.child.once('error', onError);
    });
  }

  get pid(): number | undefined {
    return this.child.pid;
  }

  get headSeq(): number {
    return this.nextSeq - 1;
  }

  get exited(): boolean {
    return this.hasExited;
  }

  get exitInfo(): { code: number | null; signal: string | null } {
    return { code: this.exitCode, signal: this.exitSignal };
  }

  get isAttached(): boolean {
    return this.attachedSocket !== null;
  }

  attach(socket: WebSocket): void {
    const previous = this.attachedSocket;
    if (previous && previous !== socket) {
      sendFrame(previous, {
        type: 'error',
        code: 'superseded',
        message: 'Another client attached to this connection',
      });
      previous.close();
    }
    this.attachedSocket = socket;
  }

  detach(socket: WebSocket): void {
    if (this.attachedSocket === socket) this.attachedSocket = null;
  }

  /** Frames newer than `lastSeq`, minus agent requests the client already answered. */
  replay(lastSeq: number): ReplayResult {
    const oldest = this.frames[0];
    const firstBuffered = oldest ? oldest.seq : this.headSeq + 1;
    if (lastSeq < firstBuffered - 1) return { gap: true, frames: [] };
    const frames = this.frames.filter(
      (frame) => frame.seq > lastSeq && this.shouldReplay(frame.message),
    );
    return { gap: false, frames };
  }

  /** Marks a client response as answering an agent request. */
  markAnswered(id: number | string): void {
    this.pendingRequests.delete(requestKey(id));
  }

  /** Sends a JSON-RPC error back to the client without involving the agent. */
  emitBridgeError(id: number | string, code: number, message: string): void {
    this.emitFrame({ jsonrpc: '2.0', id, error: { code, message } });
  }

  /** Writes one JSON-RPC message to the agent's stdin. */
  sendToAgent(message: JsonRpcMessage): boolean {
    const stdin = this.child.stdin;
    if (!stdin || stdin.destroyed || !stdin.writable) return false;
    stdin.write(`${JSON.stringify(message)}\n`);
    return true;
  }

  kill(): void {
    if (this.killTimer) return;
    this.child.kill('SIGTERM');
    this.killTimer = setTimeout(() => {
      this.child.kill('SIGKILL');
    }, KILL_GRACE_MS);
    this.killTimer.unref?.();
  }

  /** No client attached and no agent output for `ttlMs`. */
  isIdle(now: number, ttlMs: number): boolean {
    return !this.isAttached && now - this.lastOutputAt > ttlMs;
  }

  private emitFrame(message: JsonRpcMessage): ReplayFrame {
    const seq = this.nextSeq++;
    const frame: ReplayFrame = {
      seq,
      message,
      bytes: Buffer.byteLength(JSON.stringify(message), 'utf8'),
    };
    this.frames.push(frame);
    this.frameBytes += frame.bytes;
    while (this.frames.length > this.maxFrames || (this.frameBytes > this.maxBytes && this.frames.length > 1)) {
      const dropped = this.frames.shift();
      if (dropped) this.frameBytes -= dropped.bytes;
    }
    if (isRequest(message)) {
      this.pendingRequests.add(requestKey(message.id));
      while (this.pendingRequests.size > MAX_TRACKED_REQUESTS) {
        const oldest = this.pendingRequests.values().next();
        if (oldest.done) break;
        this.pendingRequests.delete(oldest.value);
      }
    }
    this.send({ type: 'rpc', seq, message });
    return frame;
  }

  /**
   * Notifications and responses are always replayed; a request is only
   * replayed while the client has not answered it yet.
   */
  private shouldReplay(message: JsonRpcMessage): boolean {
    if (!isRequest(message)) return true;
    return this.pendingRequests.has(requestKey(message.id));
  }

  private send(frame: ServerFrame): void {
    const socket = this.attachedSocket;
    if (!socket || socket.readyState !== WebSocket.OPEN) return;
    socket.send(JSON.stringify(frame));
  }

  private handleStdout(chunk: string): void {
    this.lastOutputAt = this.now();
    for (const line of this.decoder.push(chunk)) {
      this.consumeAgentLine(line);
    }
  }

  private consumeAgentLine(line: string): void {
    let parsed: unknown;
    try {
      parsed = JSON.parse(line);
    } catch {
      this.pushLog(`agent stdout: ${line.slice(0, 500)}`);
      return;
    }
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
      this.pushLog(`agent stdout: ${line.slice(0, 500)}`);
      return;
    }
    this.emitFrame(parsed as JsonRpcMessage);
  }

  private handleStderr(chunk: string): void {
    for (const raw of chunk.split('\n')) {
      const text = raw.endsWith('\r') ? raw.slice(0, -1) : raw;
      if (text.trim().length > 0) this.pushLog(text);
    }
  }

  private pushLog(text: string): void {
    if (this.logCount >= MAX_LOG_LINES) return;
    this.logCount += 1;
    this.send({ type: 'log', text });
  }

  private handleExit(code: number | null, signal: string | null): void {
    if (this.hasExited) return;
    this.hasExited = true;
    this.exitCode = code;
    this.exitSignal = signal;
    for (const line of this.decoder.flush()) {
      this.consumeAgentLine(line);
    }
    this.send({ type: 'agent-exit', code, signal });
    this.onExit?.(this);
  }

  private handleChildError(error: Error): void {
    this.pushLog(`agent process error: ${error.message}`);
  }
}

export function sendFrame(socket: WebSocket, frame: ServerFrame): void {
  if (socket.readyState !== WebSocket.OPEN) return;
  socket.send(JSON.stringify(frame));
}
