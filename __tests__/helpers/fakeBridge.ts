import type { AddressInfo } from 'net';
import { WebSocket as WsSocket, WebSocketServer } from 'ws';
import type {
  AgentInfo,
  BridgeErrorCode,
  ClientFrame,
  JsonRpcMessage,
  ServerFrame,
  WorkspaceInfo,
} from '../../bridge/src/protocol';

/**
 * In-process stand-in for `gitnotes-bridge` speaking the real wire protocol (auth, connect,
 * resume with seq replay, replay window, superseded sockets) in front of a scriptable ACP agent.
 * Real sockets, real frames: tests exercise reconnect and replay for real.
 */

export interface FakeBridgeOptions {
  token?: string;
  agents?: AgentInfo[];
  roots?: string[];
  workspaces?: WorkspaceInfo[];
  /** Protocol version announced in `ready`. */
  protocol?: number;
  /** Never answer `auth` (probe timeout). */
  silentAuth?: boolean;
  /** Never answer app-level pings (heartbeat timeout). */
  ignorePings?: boolean;
  replayMaxFrames?: number;
  agentLoadSession?: boolean;
  agentAuthRequired?: boolean;
}

export interface PermissionOptionSpec {
  optionId: string;
  name: string;
  kind: 'allow_once' | 'allow_always' | 'reject_once' | 'reject_always';
}

export interface PromptContext {
  sessionId: string;
  promptId: number | string;
  text: string;
  /** Emits a `session/update` notification. */
  update(update: Record<string, unknown>): void;
  agentMessage(text: string): void;
  /** Agent -> client `session/request_permission`; resolves with the client's `outcome`. */
  requestPermission(
    toolCall: Record<string, unknown>,
    options?: PermissionOptionSpec[],
  ): Promise<{ outcome: string; optionId?: string }>;
  /** Raw agent -> client request; resolves with the client's response message. */
  request(method: string, params: unknown): Promise<JsonRpcMessage>;
  /** Resolves when `session/cancel` arrives for this session. */
  cancelled: Promise<void>;
  /** Pauses the script until the test calls `connection.release(name)`. */
  gate(name: string): Promise<void>;
}

export type PromptHandler = (context: PromptContext) => Promise<string | void> | string | void;

interface Deferred {
  promise: Promise<void>;
  resolve: () => void;
}

function deferred(): Deferred {
  let resolve: () => void = () => undefined;
  const promise = new Promise<void>((done) => {
    resolve = done;
  });
  return { promise, resolve };
}

interface StoredSession {
  id: string;
  cwd: string;
  modeId: string;
  history: Array<{ role: 'user' | 'agent'; text: string }>;
}

interface Frame {
  seq: number;
  message: JsonRpcMessage;
}

const DEFAULT_AGENTS: AgentInfo[] = [
  { id: 'fake', name: 'Fake Agent', available: true, command: 'fake-agent --acp' },
  { id: 'missing', name: 'Missing Agent', available: false, command: 'missing-agent' },
];

export class FakeAgentConnection {
  readonly frames: Frame[] = [];
  /** Every JSON-RPC message the phone sent to this agent, in order. */
  readonly fromClient: JsonRpcMessage[] = [];
  attached: WsSocket | null = null;
  exited = false;

  private nextSeq = 1;
  private readonly answered = new Set<string>();
  private readonly pendingAgentRequests = new Map<string, (message: JsonRpcMessage) => void>();
  private readonly gates = new Map<string, Deferred>();
  private nextAgentRequestId = 1;
  private nextSessionNumber = 1;
  private cancelSignals = new Map<string, Deferred>();

  constructor(
    readonly id: string,
    readonly agentId: string,
    private readonly bridge: FakeBridge,
  ) {}

  get headSeq(): number {
    return this.nextSeq - 1;
  }

  release(name: string): void {
    this.gate(name).resolve();
  }

  prompts(): JsonRpcMessage[] {
    return this.fromClient.filter((message) => message.method === 'session/prompt');
  }

  emit(message: JsonRpcMessage): number {
    const seq = this.nextSeq++;
    this.frames.push({ seq, message });
    while (this.frames.length > this.bridge.replayMaxFrames) this.frames.shift();
    this.bridge.send(this.attached, { type: 'rpc', seq, message });
    return seq;
  }

  /** Simulates the agent process ending while a socket is attached. */
  exit(code: number | null = 1): void {
    this.exited = true;
    this.bridge.connections.delete(this.id);
    this.bridge.send(this.attached, { type: 'agent-exit', code, signal: null });
  }

  replay(lastSeq: number): { gap: boolean; frames: Frame[] } {
    const first = this.frames.length > 0 ? (this.frames[0] as Frame).seq : this.headSeq + 1;
    if (lastSeq < first - 1) return { gap: true, frames: [] };
    return {
      gap: false,
      frames: this.frames.filter((frame) => frame.seq > lastSeq && !this.isAnsweredRequest(frame.message)),
    };
  }

  handleClient(message: JsonRpcMessage): void {
    this.fromClient.push(message);
    if (message.method !== undefined) {
      this.handleMethod(message);
      return;
    }
    if (message.id !== undefined && message.id !== null) {
      const key = String(message.id);
      this.answered.add(key);
      const resolve = this.pendingAgentRequests.get(key);
      this.pendingAgentRequests.delete(key);
      resolve?.(message);
    }
  }

  private isAnsweredRequest(message: JsonRpcMessage): boolean {
    return (
      message.method !== undefined &&
      message.id !== undefined &&
      message.id !== null &&
      this.answered.has(String(message.id))
    );
  }

  private gate(name: string): Deferred {
    let entry = this.gates.get(name);
    if (!entry) {
      entry = deferred();
      this.gates.set(name, entry);
    }
    return entry;
  }

  private respond(request: JsonRpcMessage, result: unknown): void {
    this.emit({ jsonrpc: '2.0', id: request.id as number | string, result });
  }

  private respondError(request: JsonRpcMessage, code: number, message: string): void {
    this.emit({ jsonrpc: '2.0', id: request.id as number | string, error: { code, message } });
  }

  private notifyUpdate(sessionId: string, update: Record<string, unknown>): void {
    this.emit({ jsonrpc: '2.0', method: 'session/update', params: { sessionId, update } });
  }

  private modes(session: StoredSession) {
    return {
      currentModeId: session.modeId,
      availableModes: [
        { id: 'default', name: 'Default', description: 'Ask before changes' },
        { id: 'plan', name: 'Plan' },
      ],
    };
  }

  private handleMethod(message: JsonRpcMessage): void {
    const params = (message.params ?? {}) as Record<string, unknown>;
    switch (message.method) {
      case 'initialize':
        this.respond(message, {
          protocolVersion: 1,
          agentCapabilities: { loadSession: this.bridge.agentLoadSession, promptCapabilities: {} },
          authMethods: this.bridge.agentAuthRequired ? [{ id: 'login', name: 'Log in' }] : [],
          agentInfo: { name: 'fake-agent', version: '0.0.1' },
        });
        return;
      case 'session/new': {
        if (this.bridge.agentAuthRequired) {
          this.respondError(message, -32000, 'Authentication required');
          return;
        }
        const session: StoredSession = {
          id: `sess_${this.id}_${this.nextSessionNumber++}`,
          cwd: String(params.cwd ?? ''),
          modeId: 'default',
          history: [],
        };
        this.bridge.sessions.set(session.id, session);
        this.respond(message, { sessionId: session.id, modes: this.modes(session) });
        return;
      }
      case 'session/load': {
        const session = this.bridge.sessions.get(String(params.sessionId));
        if (!session) {
          this.respondError(message, -32602, 'Unknown session');
          return;
        }
        for (const entry of session.history) {
          this.notifyUpdate(session.id, {
            sessionUpdate: entry.role === 'user' ? 'user_message_chunk' : 'agent_message_chunk',
            content: { type: 'text', text: entry.text },
          });
        }
        this.respond(message, { modes: this.modes(session) });
        return;
      }
      case 'session/set_mode': {
        const session = this.bridge.sessions.get(String(params.sessionId));
        if (!session) {
          this.respondError(message, -32602, 'Unknown session');
          return;
        }
        session.modeId = String(params.modeId);
        this.respond(message, {});
        this.notifyUpdate(session.id, { sessionUpdate: 'current_mode_update', currentModeId: session.modeId });
        return;
      }
      case 'session/cancel':
        this.cancelSignal(String(params.sessionId)).resolve();
        return;
      case 'session/prompt':
        void this.runPrompt(message, params);
        return;
      default:
        if (message.id !== undefined && message.id !== null) this.respondError(message, -32601, 'Method not found');
    }
  }

  private cancelSignal(sessionId: string): Deferred {
    let signal = this.cancelSignals.get(sessionId);
    if (!signal) {
      signal = deferred();
      this.cancelSignals.set(sessionId, signal);
    }
    return signal;
  }

  private async runPrompt(request: JsonRpcMessage, params: Record<string, unknown>): Promise<void> {
    const sessionId = String(params.sessionId);
    const session = this.bridge.sessions.get(sessionId);
    if (!session) {
      this.respondError(request, -32602, 'Unknown session');
      return;
    }
    const blocks = Array.isArray(params.prompt) ? (params.prompt as Array<{ type: string; text?: string }>) : [];
    const text = blocks
      .filter((block) => block.type === 'text')
      .map((block) => block.text ?? '')
      .join('\n');
    session.history.push({ role: 'user', text });
    this.cancelSignals.set(sessionId, deferred());

    const context: PromptContext = {
      sessionId,
      promptId: request.id as number | string,
      text,
      update: (update) => this.notifyUpdate(sessionId, update),
      agentMessage: (chunk) => {
        session.history.push({ role: 'agent', text: chunk });
        this.notifyUpdate(sessionId, { sessionUpdate: 'agent_message_chunk', content: { type: 'text', text: chunk } });
      },
      requestPermission: async (toolCall, options) => {
        const response = await context.request('session/request_permission', {
          sessionId,
          toolCall,
          options: options ?? [
            { optionId: 'allow', name: 'Allow once', kind: 'allow_once' },
            { optionId: 'reject', name: 'Reject', kind: 'reject_once' },
          ],
        });
        return (response.result as { outcome: { outcome: string; optionId?: string } }).outcome;
      },
      request: (method, requestParams) => {
        const id = this.nextAgentRequestId++;
        return new Promise<JsonRpcMessage>((resolve) => {
          this.pendingAgentRequests.set(String(id), resolve);
          this.emit({ jsonrpc: '2.0', id, method, params: requestParams });
        });
      },
      cancelled: this.cancelSignal(sessionId).promise,
      gate: (name) => this.gate(name).promise,
    };

    try {
      const handler = this.bridge.promptHandler ?? ((ctx: PromptContext) => ctx.agentMessage(`Echo: ${ctx.text}`));
      const stopReason = await handler(context);
      this.respond(request, { stopReason: stopReason ?? 'end_turn' });
    } catch (error) {
      this.respondError(request, -32603, error instanceof Error ? error.message : 'handler failed');
    }
  }
}

export class FakeBridge {
  readonly token: string;
  readonly connections = new Map<string, FakeAgentConnection>();
  /** Agent-side session store, shared by every spawned agent like sessions on disk. */
  readonly sessions = new Map<string, StoredSession>();
  readonly sockets = new Set<WsSocket>();
  promptHandler: PromptHandler | null = null;
  socketsAccepted = 0;
  /** Immediately cuts every new socket (a network that is still down). */
  rejectNewSockets = false;
  url = '';

  private nextConnectionNumber = 1;

  private constructor(
    private readonly server: WebSocketServer,
    private readonly options: FakeBridgeOptions,
  ) {
    this.token = options.token ?? 'test-token';
  }

  static async start(options: FakeBridgeOptions = {}): Promise<FakeBridge> {
    const server = new WebSocketServer({ host: '127.0.0.1', port: 0 });
    await new Promise<void>((resolve) => server.once('listening', () => resolve()));
    const bridge = new FakeBridge(server, options);
    bridge.url = `ws://127.0.0.1:${(server.address() as AddressInfo).port}`;
    server.on('connection', (socket) => bridge.accept(socket));
    return bridge;
  }

  get replayMaxFrames(): number {
    return this.options.replayMaxFrames ?? 5000;
  }

  get agentLoadSession(): boolean {
    return this.options.agentLoadSession ?? true;
  }

  get agentAuthRequired(): boolean {
    return this.options.agentAuthRequired ?? false;
  }

  /** The most recently spawned agent connection. */
  get lastConnection(): FakeAgentConnection {
    const all = [...this.connections.values()];
    const last = all[all.length - 1];
    if (!last) throw new Error('no agent connection yet');
    return last;
  }

  /** Cuts every socket without a close handshake, like a network flip. */
  dropClients(): void {
    for (const socket of this.sockets) socket.terminate();
  }

  async stop(): Promise<void> {
    this.dropClients();
    await new Promise<void>((resolve) => this.server.close(() => resolve()));
  }

  send(socket: WsSocket | null, frame: ServerFrame): void {
    if (!socket || socket.readyState !== WsSocket.OPEN) return;
    socket.send(JSON.stringify(frame));
  }

  private sendError(socket: WsSocket, code: BridgeErrorCode, message: string): void {
    this.send(socket, { type: 'error', code, message });
  }

  private accept(socket: WsSocket): void {
    this.socketsAccepted += 1;
    if (this.rejectNewSockets) {
      socket.terminate();
      return;
    }
    this.sockets.add(socket);
    let authed = false;
    let bound: FakeAgentConnection | null = null;

    socket.on('close', () => {
      this.sockets.delete(socket);
      if (bound && bound.attached === socket) bound.attached = null;
    });
    socket.on('message', (raw) => {
      let frame: ClientFrame;
      try {
        frame = JSON.parse(raw.toString()) as ClientFrame;
      } catch {
        return;
      }
      if (!authed) {
        if (frame.type !== 'auth') return;
        if (this.options.silentAuth) return;
        if (frame.token !== this.token) {
          this.sendError(socket, 'unauthorized', 'Invalid token');
          socket.close();
          return;
        }
        authed = true;
        this.send(socket, {
          type: 'ready',
          protocol: this.options.protocol ?? frame.protocol,
          bridgeVersion: '0.0.0-test',
          hostname: 'fake-host',
          agents: this.options.agents ?? DEFAULT_AGENTS,
          roots: this.options.roots ?? ['/work'],
        });
        return;
      }
      bound = this.handleFrame(socket, frame, bound);
    });
  }

  private handleFrame(socket: WsSocket, frame: ClientFrame, bound: FakeAgentConnection | null): FakeAgentConnection | null {
    switch (frame.type) {
      case 'ping':
        if (!this.options.ignorePings) this.send(socket, { type: 'pong' });
        return bound;
      case 'list-workspaces':
        this.send(socket, {
          type: 'workspaces',
          items: this.options.workspaces ?? [{ path: '/work', name: 'work', isRoot: true }],
        });
        return bound;
      case 'connect': {
        const agent = (this.options.agents ?? DEFAULT_AGENTS).find((candidate) => candidate.id === frame.agent);
        if (!agent) {
          this.sendError(socket, 'unknown-agent', `No agent ${frame.agent}`);
          return bound;
        }
        if (!agent.available) {
          this.sendError(socket, 'agent-unavailable', `${agent.name} is not installed`);
          return bound;
        }
        const connection = new FakeAgentConnection(`conn_${this.nextConnectionNumber++}`, agent.id, this);
        this.connections.set(connection.id, connection);
        this.attach(connection, socket);
        this.send(socket, { type: 'connected', connectionId: connection.id, agent: agent.id, resumed: false, replayCount: 0, headSeq: 0 });
        return connection;
      }
      case 'resume': {
        const connection = this.connections.get(frame.connectionId);
        if (!connection) {
          this.sendError(socket, 'unknown-connection', 'No such connection');
          return bound;
        }
        const { gap, frames } = connection.replay(frame.lastSeq);
        if (gap) {
          this.sendError(socket, 'replay-gap', 'Replay window exceeded');
          return bound;
        }
        this.attach(connection, socket);
        this.send(socket, {
          type: 'connected',
          connectionId: connection.id,
          agent: connection.agentId,
          resumed: true,
          replayCount: frames.length,
          headSeq: connection.headSeq,
        });
        for (const replayed of frames) this.send(socket, { type: 'rpc', seq: replayed.seq, message: replayed.message });
        return connection;
      }
      case 'rpc':
        if (!bound) {
          this.sendError(socket, 'not-bound', 'Not bound to an agent');
          return bound;
        }
        bound.handleClient(frame.message);
        return bound;
      case 'disconnect':
        if (bound) {
          if (bound.attached === socket) bound.attached = null;
          if (frame.kill) this.connections.delete(bound.id);
        }
        return null;
      default:
        return bound;
    }
  }

  private attach(connection: FakeAgentConnection, socket: WsSocket): void {
    const previous = connection.attached;
    if (previous && previous !== socket) {
      this.sendError(previous, 'superseded', 'Another client attached');
      previous.close();
    }
    connection.attached = socket;
  }
}
