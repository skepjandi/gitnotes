import type { JsonRpcMessage } from '../../../bridge/src/protocol';
import type { BridgeConnection, BridgeEvent, BridgeLostReason } from './BridgeConnection';
import {
  ACP_PROTOCOL_VERSION,
  JSON_RPC_INTERNAL_ERROR,
  JSON_RPC_METHOD_NOT_FOUND,
  type AcpInitializeResult,
  type AcpSessionNotification,
} from './acpTypes';

export const DEFAULT_REQUEST_TIMEOUT_MS = 30_000;

export class AcpRpcError extends Error {
  constructor(
    readonly code: number,
    message: string,
    readonly data?: unknown,
  ) {
    super(message);
    this.name = 'AcpRpcError';
  }
}

export class AcpTransportError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'AcpTransportError';
  }
}

export interface AcpResponse<T> {
  result: T;
  /** Bridge replay cursor of the response frame. */
  seq: number;
}

export interface AcpRequestContext {
  id: number | string;
  seq: number;
}

export type AcpRequestHandler = (params: unknown, context: AcpRequestContext) => Promise<unknown>;

export interface AcpRequestOptions {
  /** `null` disables the timeout (`session/prompt` runs for as long as the agent works). */
  timeoutMs?: number | null;
  /** Runs synchronously inside the frame dispatch, before the returned promise settles. */
  onSettled?: (outcome: { ok: true; result: unknown; seq: number } | { ok: false; error: Error }) => void;
  /** An id from `reserveRequestId()`, for callers that must persist it before the request goes out. */
  id?: number;
}

interface PendingRequest {
  settle(outcome: { ok: true; result: unknown; seq: number } | { ok: false; error: Error }): void;
}

export interface StartedRequest<T> {
  id: number;
  response: Promise<AcpResponse<T>>;
}

function requestKey(id: number | string): string {
  return `${typeof id}:${String(id)}`;
}

function isResponse(message: JsonRpcMessage): boolean {
  return message.method === undefined && message.id !== undefined && message.id !== null;
}

/**
 * Minimal JSON-RPC 2.0 client for ACP on top of a `BridgeConnection`.
 * Agent -> client requests are answered here: methods without a registered handler get
 * `-32601` so agents never hang waiting on an unsupported capability.
 */
export class AcpClient {
  private readonly pending = new Map<number, PendingRequest>();
  private readonly requestHandlers = new Map<string, AcpRequestHandler>();
  private readonly seenAgentRequests = new Set<string>();
  private readonly unsubscribe: () => void;
  private nextId: number;
  private initialized: Promise<AcpInitializeResult> | null = null;
  private disposed = false;

  /** Called for every `session/update` notification, in arrival order. */
  onSessionUpdate: ((notification: AcpSessionNotification, seq: number) => void) | null = null;
  /** Called for a response whose id this client never issued (e.g. the turn a previous app run started). */
  onUnmatchedResponse: ((message: JsonRpcMessage, seq: number) => void) | null = null;
  /** Called when the transport is gone for good; pending requests are rejected first. */
  onTransportLost: ((reason: BridgeLostReason, message: string) => void) | null = null;
  onAgentExit: ((info: { code: number | null; signal: string | null }) => void) | null = null;
  /** While true, `session/update` notifications are dropped (history replayed by `session/load`). */
  suppressSessionUpdates = false;

  constructor(
    private readonly connection: BridgeConnection,
    options: { firstRequestId?: number } = {},
  ) {
    // Ids restart per process; starting at the wall clock keeps them clear of any id a previous
    // run left in the replay log, which would otherwise be mistaken for a response to us.
    this.nextId = options.firstRequestId ?? Math.floor(Date.now() / 1000);
    this.unsubscribe = connection.subscribe((event) => this.handleEvent(event));
  }

  reserveRequestId(): number {
    return this.nextId++;
  }

  handle(method: string, handler: AcpRequestHandler): void {
    this.requestHandlers.set(method, handler);
  }

  unhandle(method: string): void {
    this.requestHandlers.delete(method);
  }

  initialize(clientName: string, clientVersion: string): Promise<AcpInitializeResult> {
    if (!this.initialized) {
      this.initialized = this.request<AcpInitializeResult>('initialize', {
        protocolVersion: ACP_PROTOCOL_VERSION,
        clientCapabilities: {
          fs: { readTextFile: false, writeTextFile: false },
          terminal: false,
          elicitation: { form: {}, url: {} },
          session: { configOptions: { boolean: {} } },
        },
        clientInfo: { name: clientName, version: clientVersion },
      }).catch((error: unknown) => {
        this.initialized = null;
        throw error;
      });
    }
    return this.initialized;
  }

  async request<T>(method: string, params: unknown, options: AcpRequestOptions = {}): Promise<T> {
    const { response } = this.startRequest<T>(method, params, options);
    return (await response).result;
  }

  startRequest<T>(method: string, params: unknown, options: AcpRequestOptions = {}): StartedRequest<T> {
    const id = options.id ?? this.nextId++;
    const timeoutMs = options.timeoutMs === undefined ? DEFAULT_REQUEST_TIMEOUT_MS : options.timeoutMs;

    const response = new Promise<AcpResponse<T>>((resolve, reject) => {
      let timer: ReturnType<typeof setTimeout> | null = null;
      const settle: PendingRequest['settle'] = (outcome) => {
        if (!this.pending.delete(id)) return;
        if (timer) clearTimeout(timer);
        options.onSettled?.(outcome);
        if (outcome.ok) resolve({ result: outcome.result as T, seq: outcome.seq });
        else reject(outcome.error);
      };
      this.pending.set(id, { settle });
      if (timeoutMs !== null) {
        timer = setTimeout(() => {
          settle({ ok: false, error: new AcpTransportError(`Agent did not answer ${method} in time`) });
        }, timeoutMs);
      }
      try {
        this.connection.send({ jsonrpc: '2.0', id, method, params });
      } catch (error) {
        settle({ ok: false, error: error instanceof Error ? error : new AcpTransportError('Could not reach the agent') });
      }
    });
    return { id, response };
  }

  notify(method: string, params: unknown): void {
    try {
      this.connection.send({ jsonrpc: '2.0', method, params });
    } catch {
      /* a notification to a dead connection has nobody to inform */
    }
  }

  dispose(): void {
    if (this.disposed) return;
    this.disposed = true;
    this.unsubscribe();
    this.failPending(new AcpTransportError('Agent connection closed'));
  }

  private failPending(error: Error): void {
    for (const request of [...this.pending.values()]) {
      request.settle({ ok: false, error });
    }
  }

  private handleEvent(event: BridgeEvent): void {
    switch (event.type) {
      case 'rpc':
        this.handleMessage(event.message, event.seq);
        return;
      case 'agent-exit': {
        const how = event.signal ? `signal ${event.signal}` : `code ${event.code ?? 'unknown'}`;
        this.onAgentExit?.({ code: event.code, signal: event.signal });
        this.failPending(new AcpTransportError(`The agent process exited (${how})`));
        return;
      }
      case 'lost':
        this.onTransportLost?.(event.reason, event.message);
        this.failPending(new AcpTransportError(event.message));
        return;
      case 'state':
        if (event.state === 'closed') this.failPending(new AcpTransportError('Agent connection closed'));
        return;
      default:
        return;
    }
  }

  private handleMessage(message: JsonRpcMessage, seq: number): void {
    if (isResponse(message)) {
      this.handleResponse(message, seq);
      return;
    }
    if (typeof message.method !== 'string') return;
    if (message.id === undefined || message.id === null) {
      this.handleNotification(message.method, message.params, seq);
      return;
    }
    void this.handleAgentRequest(message.id, message.method, message.params, seq);
  }

  private handleResponse(message: JsonRpcMessage, seq: number): void {
    const id = message.id;
    const request = typeof id === 'number' ? this.pending.get(id) : undefined;
    if (!request) {
      this.onUnmatchedResponse?.(message, seq);
      return;
    }
    if (message.error) {
      request.settle({
        ok: false,
        error: new AcpRpcError(message.error.code, message.error.message, message.error.data),
      });
      return;
    }
    request.settle({ ok: true, result: message.result, seq });
  }

  private handleNotification(method: string, params: unknown, seq: number): void {
    if (method !== 'session/update' || this.suppressSessionUpdates) return;
    if (!params || typeof params !== 'object') return;
    const notification = params as Partial<AcpSessionNotification>;
    if (typeof notification.sessionId !== 'string' || !notification.update || typeof notification.update !== 'object') return;
    this.onSessionUpdate?.(notification as AcpSessionNotification, seq);
  }

  private async handleAgentRequest(id: number | string, method: string, params: unknown, seq: number): Promise<void> {
    const key = requestKey(id);
    if (this.seenAgentRequests.has(key)) return;
    this.seenAgentRequests.add(key);

    const handler = this.requestHandlers.get(method);
    if (!handler) {
      this.reply({ jsonrpc: '2.0', id, error: { code: JSON_RPC_METHOD_NOT_FOUND, message: `Method not supported by this client: ${method}` } });
      return;
    }
    try {
      const result = await handler(params, { id, seq });
      this.reply({ jsonrpc: '2.0', id, result });
    } catch (error) {
      if (error instanceof AcpRpcError) {
        this.reply({ jsonrpc: '2.0', id, error: { code: error.code, message: error.message, data: error.data } });
        return;
      }
      this.reply({
        jsonrpc: '2.0',
        id,
        error: { code: JSON_RPC_INTERNAL_ERROR, message: error instanceof Error ? error.message : 'Client request failed' },
      });
    }
  }

  private reply(message: JsonRpcMessage): void {
    try {
      this.connection.send(message);
    } catch {
      /* the agent will be told through the connection teardown */
    }
  }
}
