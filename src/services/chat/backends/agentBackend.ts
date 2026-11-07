import type { AIContextItem } from '../../../models/AIProvider';
import type { AgentMode, ChatThread } from '../../../models/Chat';
import { AcpClient, AcpRpcError, AcpTransportError, type AcpRequestContext } from '../../agent/AcpClient';
import { mapSessionUpdate, mapToolCallPatch } from '../../agent/acpMapper';
import type {
  AcpPermissionOption,
  AcpPermissionOutcome,
  AcpPermissionRequest,
  AcpPromptBlock,
  AcpSessionModeState,
  AcpSessionNotification,
  AcpToolCallFields,
} from '../../agent/acpTypes';
import {
  acquireConnection,
  ensureSession,
  releaseAgentConnection,
  type AgentThreadBackend,
  type LiveAgentConnection,
} from '../../agent/agentConnections';
import { AsyncQueue } from '../../agent/AsyncQueue';
import type { BridgeLostReason } from '../../agent/BridgeConnection';
import type { JsonRpcMessage } from '../../../../bridge/src/protocol';
import type { ChatBackend, ChatEvent, ChatEventBody, ChatRunInput, PermissionOption, ToolPatch } from '../types';

export { releaseAgentConnection };

const CANCEL_GRACE_MS = 3_000;
const ABORTED = Symbol('aborted');

type TurnItem =
  | { kind: 'event'; event: ChatEvent }
  | { kind: 'error'; error: Error }
  | { kind: 'abort' }
  | { kind: 'grace' };

type TurnIo = Pick<ChatRunInput, 'signal' | 'requestPermission' | 'reportStatus'>;

type PromptOutcome = { ok: true; result: unknown; seq: number } | { ok: false; error: Error };

const PERMISSION_DESCRIPTION_KEYS = ['command', 'cmd', 'file_path', 'path', 'url', 'pattern', 'query'] as const;

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function requireAgentBackend(thread: ChatThread): AgentThreadBackend {
  if (thread.backend?.type !== 'agent') throw new Error('This chat is not connected to a coding agent.');
  return thread.backend;
}

function buildPrompt(text: string, contexts: AIContextItem[]): AcpPromptBlock[] {
  const blocks: AcpPromptBlock[] = [{ type: 'text', text }];
  if (contexts.length > 0) {
    const lines = contexts.map((context) => `- ${context.name}${context.path ? ` (${context.path})` : ''}`);
    blocks.push({ type: 'text', text: `Notes and files attached to this message:\n${lines.join('\n')}` });
  }
  return blocks;
}

function describePermission(fields: AcpToolCallFields): string | undefined {
  if (isRecord(fields.rawInput)) {
    for (const key of PERMISSION_DESCRIPTION_KEYS) {
      const value = fields.rawInput[key];
      if (typeof value === 'string' && value) return value;
      if (Array.isArray(value) && value.every((part) => typeof part === 'string')) return value.join(' ');
    }
  }
  const location = fields.locations?.[0];
  return location ? location.path : undefined;
}

function parsePermissionRequest(params: unknown): AcpPermissionRequest | null {
  if (!isRecord(params) || !isRecord(params.toolCall) || !Array.isArray(params.options)) return null;
  if (typeof params.sessionId !== 'string' || typeof params.toolCall.toolCallId !== 'string') return null;
  const options = params.options.filter(
    (option): option is AcpPermissionOption =>
      isRecord(option) && typeof option.optionId === 'string' && typeof option.name === 'string' && typeof option.kind === 'string',
  );
  return {
    sessionId: params.sessionId,
    toolCall: params.toolCall as unknown as AcpToolCallFields,
    options,
  };
}

function lostMessage(reason: BridgeLostReason, detail: string): string {
  switch (reason) {
    case 'replay-gap':
    case 'unknown-connection':
      return 'The bridge no longer has this agent\'s output (you were away too long, or the bridge restarted). Your last message may or may not have been processed — check the result and resend if needed. Sending a new message reconnects.';
    case 'superseded':
      return 'Another device attached to this agent session, so this phone was disconnected.';
    case 'unauthorized':
      return 'The bridge rejected this phone\'s access token. Pair the bridge again in Settings.';
    default:
      return `Lost the connection to the agent: ${detail}`;
  }
}

function modesToEvent(modes: AcpSessionModeState | null | undefined): { modeId?: string; availableModes?: AgentMode[] } {
  if (!modes) return {};
  return {
    modeId: modes.currentModeId,
    availableModes: modes.availableModes.map((mode) => ({
      id: mode.id,
      name: mode.name,
      ...(mode.description ? { description: mode.description } : {}),
    })),
  };
}

/** Everything that happens between "user pressed send" (or "app re-attached") and the turn's `turn-end`. */
class AgentTurn {
  readonly queue = new AsyncQueue<TurnItem>();
  sessionId: string | null;
  /** Set once the agent answered (or failed) `session/prompt`; nothing is left to cancel. */
  agentFinished = false;
  promptSent = false;
  private cancelSent = false;
  aborted = false;

  private acp: AcpClient | null = null;
  private expectedPromptId: number | null = null;
  private failed = false;
  private readonly pendingRequestSeqs = new Map<string, number>();
  private readonly seenTools = new Set<string>();
  private graceTimer: ReturnType<typeof setTimeout> | null = null;
  private unsubscribeLink: (() => void) | null = null;
  private readonly onAbort = () => this.queue.push({ kind: 'abort' });

  constructor(
    private readonly io: TurnIo,
    sessionId: string | null,
  ) {
    this.sessionId = sessionId;
  }

  expectResponseFor(promptId: number): void {
    this.expectedPromptId = promptId;
  }

  install(acp: AcpClient): void {
    this.acp = acp;
    acp.onSessionUpdate = (notification, seq) => this.handleUpdate(notification, seq);
    acp.onUnmatchedResponse = (message, seq) => this.handleUnmatchedResponse(message, seq);
    acp.onTransportLost = (reason, detail) => this.fail(new Error(lostMessage(reason, detail)));
    acp.onAgentExit = ({ code, signal }) =>
      this.fail(new Error(`The agent process exited (${signal ? `signal ${signal}` : `code ${code ?? 'unknown'}`}).`));
    acp.handle('session/request_permission', (params, context) => this.handlePermission(params, context));
    this.io.signal.addEventListener('abort', this.onAbort, { once: true });
  }

  watchLink(live: LiveAgentConnection): void {
    this.unsubscribeLink?.();
    this.unsubscribeLink = live.connection.subscribe((event) => {
      if (event.type !== 'state') return;
      if (event.state === 'reconnecting') this.io.reportStatus?.('Reconnecting to the bridge…');
      else if (event.state === 'ready') this.io.reportStatus?.(null);
    });
  }

  dispose(): void {
    this.io.signal.removeEventListener('abort', this.onAbort);
    this.unsubscribeLink?.();
    this.unsubscribeLink = null;
    if (this.graceTimer) clearTimeout(this.graceTimer);
    this.graceTimer = null;
    const acp = this.acp;
    if (acp) {
      acp.onSessionUpdate = null;
      acp.onUnmatchedResponse = null;
      acp.onTransportLost = null;
      acp.onAgentExit = null;
      acp.unhandle('session/request_permission');
    }
    this.io.reportStatus?.(null);
  }

  /** Resolves `ABORTED` if the user stops the turn before `work` settles. */
  race<T>(work: Promise<T>): Promise<T | typeof ABORTED> {
    return new Promise<T | typeof ABORTED>((resolve, reject) => {
      const { signal } = this.io;
      if (signal.aborted) {
        this.aborted = true;
        resolve(ABORTED);
      }
      const onAbort = () => {
        this.aborted = true;
        resolve(ABORTED);
      };
      signal.addEventListener('abort', onAbort, { once: true });
      work.then(
        (value) => {
          signal.removeEventListener('abort', onAbort);
          resolve(value);
        },
        (error: unknown) => {
          signal.removeEventListener('abort', onAbort);
          reject(error);
        },
      );
    });
  }

  fail(error: Error): void {
    if (this.failed) return;
    this.failed = true;
    this.queue.push({ kind: 'error', error });
  }

  cancelAgent(): void {
    if (!this.acp || !this.sessionId || !this.promptSent || this.agentFinished || this.cancelSent) return;
    this.cancelSent = true;
    this.acp.notify('session/cancel', { sessionId: this.sessionId });
  }

  promptSettled(outcome: PromptOutcome): void {
    this.agentFinished = true;
    if (outcome.ok) {
      const stopReason = isRecord(outcome.result) && typeof outcome.result.stopReason === 'string' ? outcome.result.stopReason : 'end_turn';
      this.emitTurnEnd(stopReason, outcome.seq);
      return;
    }
    if (this.aborted) {
      this.emitTurnEnd('cancelled');
      return;
    }
    this.fail(outcome.error instanceof AcpRpcError || outcome.error instanceof AcpTransportError ? new Error(outcome.error.message) : outcome.error);
  }

  async *drain(): AsyncGenerator<ChatEvent> {
    if (this.io.signal.aborted) this.queue.push({ kind: 'abort' });
    for (;;) {
      const item = await this.queue.next();
      switch (item.kind) {
        case 'event':
          yield item.event;
          if (item.event.type === 'turn-end') return;
          break;
        case 'error':
          throw item.error;
        case 'abort':
          this.beginCancel();
          break;
        case 'grace':
          yield { type: 'turn-end', stopReason: 'cancelled' };
          return;
      }
    }
  }

  private beginCancel(): void {
    if (this.aborted && this.graceTimer) return;
    this.aborted = true;
    this.cancelAgent();
    this.graceTimer = setTimeout(() => this.queue.push({ kind: 'grace' }), CANCEL_GRACE_MS);
  }

  private emitTurnEnd(stopReason: string, seq?: number): void {
    this.emit({ type: 'turn-end', stopReason: this.aborted ? 'cancelled' : stopReason }, seq);
  }

  /** The cursor is held back while a permission question is open so a cold restart replays it. */
  private tag(seq: number): number {
    let limit = seq;
    for (const pending of this.pendingRequestSeqs.values()) limit = Math.min(limit, pending - 1);
    return limit;
  }

  private emit(body: ChatEventBody, seq?: number): void {
    const event: ChatEvent = seq === undefined ? body : { ...body, seq: this.tag(seq) };
    this.queue.push({ kind: 'event', event });
  }

  private pushToolPatch(toolCallId: string, patch: ToolPatch, seq?: number): void {
    if (this.seenTools.has(toolCallId)) {
      this.emit({ type: 'tool-update', toolCallId, patch }, seq);
      return;
    }
    this.seenTools.add(toolCallId);
    this.emit({ type: 'tool-start', toolCallId, patch: { ...patch, name: patch.name ?? patch.title ?? patch.kind ?? 'tool' } }, seq);
  }

  private handleUpdate(notification: AcpSessionNotification, seq: number): void {
    if (this.sessionId && notification.sessionId !== this.sessionId) return;
    for (const body of mapSessionUpdate(notification.update)) {
      if (body.type === 'tool-start' || body.type === 'tool-update') this.seenTools.add(body.toolCallId);
      this.emit(body, seq);
    }
  }

  private handleUnmatchedResponse(message: JsonRpcMessage, seq: number): void {
    if (this.expectedPromptId === null || message.id !== this.expectedPromptId || this.agentFinished) return;
    if (message.error) {
      this.promptSettled({ ok: false, error: new AcpRpcError(message.error.code, message.error.message, message.error.data) });
      return;
    }
    this.promptSettled({ ok: true, result: message.result, seq });
  }

  private async handlePermission(params: unknown, context: AcpRequestContext): Promise<AcpPermissionOutcomeResult> {
    const cancelled: AcpPermissionOutcomeResult = { outcome: { outcome: 'cancelled' } };
    const request = parsePermissionRequest(params);
    if (!request || request.options.length === 0) return cancelled;
    if (this.sessionId && request.sessionId !== this.sessionId) return cancelled;

    const key = String(context.id);
    const { toolCall } = request;
    this.pendingRequestSeqs.set(key, context.seq);
    this.pushToolPatch(toolCall.toolCallId, { ...mapToolCallPatch(toolCall), status: 'awaiting-approval' }, context.seq);

    let optionId: string | null;
    try {
      const options: PermissionOption[] = request.options.map((option) => ({
        id: option.optionId,
        label: option.name,
        kind: option.kind,
      }));
      const decision = await this.io.requestPermission({
        toolCallId: toolCall.toolCallId,
        title: toolCall.title || 'Permission requested',
        description: describePermission(toolCall),
        options,
      });
      optionId = decision.optionId;
    } finally {
      this.pendingRequestSeqs.delete(key);
    }

    const chosen = optionId === null ? undefined : request.options.find((option) => option.optionId === optionId);
    if (!chosen) return cancelled;
    this.pushToolPatch(toolCall.toolCallId, { status: chosen.kind.startsWith('reject') ? 'rejected' : 'running' });
    return { outcome: { outcome: 'selected', optionId: chosen.optionId } };
  }
}

interface AcpPermissionOutcomeResult {
  outcome: AcpPermissionOutcome;
}

function noopInstall(): void {
  return undefined;
}

async function* runTurn(input: ChatRunInput): AsyncGenerator<ChatEvent> {
  const backend = requireAgentBackend(input.thread);
  if (input.signal.aborted) {
    yield { type: 'turn-end', stopReason: 'cancelled' };
    return;
  }

  const turn = new AgentTurn(input, backend.sessionId ?? null);
  let live: LiveAgentConnection | null = null;
  try {
    input.reportStatus?.('Connecting to the bridge…');
    const acquired = await turn.race(acquireConnection(input.thread, backend, { install: (acp) => turn.install(acp) }));
    if (acquired === ABORTED) {
      yield { type: 'turn-end', stopReason: 'cancelled' };
      return;
    }
    live = acquired;
    if (live.busy) throw new Error('This agent is still working on the previous message.');
    live.busy = true;
    turn.watchLink(live);

    const setup = await turn.race(ensureSession(live, backend));
    if (setup === ABORTED) {
      yield { type: 'turn-end', stopReason: 'cancelled' };
      return;
    }
    input.reportStatus?.(null);
    turn.sessionId = live.sessionId;

    yield {
      type: 'agent-state',
      sessionId: live.sessionId ?? undefined,
      connectionId: live.connectionId,
      ...modesToEvent(live.modes),
      ...(setup ? { seq: setup.seq } : {}),
    };

    const promptId = live.acp.reserveRequestId();
    turn.expectResponseFor(promptId);
    yield {
      type: 'agent-state',
      pendingPromptId: promptId,
      ...(turn.queue.size === 0 ? { seq: live.connection.lastSeq } : {}),
    };

    turn.promptSent = true;
    void live.acp
      .startRequest('session/prompt', { sessionId: live.sessionId, prompt: buildPrompt(input.userText, input.contexts) }, {
        id: promptId,
        timeoutMs: null,
        onSettled: (outcome) => turn.promptSettled(outcome),
      })
      .response.catch(() => undefined);

    yield* turn.drain();
  } finally {
    turn.cancelAgent();
    turn.dispose();
    if (live) live.busy = false;
  }
}

/** The user stopped a re-attach before it finished; the agent is still working, so tell it as soon as the link is up. */
function cancelOnceAttached(acquisition: Promise<LiveAgentConnection>, sessionId: string | null): void {
  acquisition.then(
    (live) => {
      const target = sessionId ?? live.sessionId;
      if (target) live.acp.notify('session/cancel', { sessionId: target });
    },
    () => undefined,
  );
}

async function* resumeTurn(input: Omit<ChatRunInput, 'userText' | 'contexts'>): AsyncGenerator<ChatEvent> {
  const backend = requireAgentBackend(input.thread);
  if (backend.pendingPromptId === undefined) {
    yield { type: 'turn-end', stopReason: 'end_turn' };
    return;
  }

  const turn = new AgentTurn(input, backend.sessionId ?? null);
  turn.expectResponseFor(backend.pendingPromptId);
  turn.promptSent = true;
  let live: LiveAgentConnection | null = null;
  try {
    input.reportStatus?.('Re-attaching to the agent…');
    const acquisition = acquireConnection(input.thread, backend, { install: (acp) => turn.install(acp), requireExisting: true });
    const acquired = await turn.race(acquisition);
    if (acquired === ABORTED) {
      cancelOnceAttached(acquisition, backend.sessionId ?? null);
      yield { type: 'turn-end', stopReason: 'cancelled' };
      return;
    }
    live = acquired;
    if (live.busy) throw new Error('This agent is already being followed by another turn.');
    live.busy = true;
    turn.sessionId = live.sessionId ?? turn.sessionId;
    turn.watchLink(live);
    input.reportStatus?.(null);
    yield* turn.drain();
  } finally {
    turn.cancelAgent();
    turn.dispose();
    if (live) live.busy = false;
  }
}

async function applyMode(thread: ChatThread, modeId: string): Promise<void> {
  const backend = requireAgentBackend(thread);
  const live = await acquireConnection(thread, backend, { install: noopInstall });
  await ensureSession(live, backend);
  await live.acp.request('session/set_mode', { sessionId: live.sessionId, modeId });
  if (live.modes) live.modes = { ...live.modes, currentModeId: modeId };
}

export const agentBackend: ChatBackend = {
  type: 'agent',
  run: runTurn,
  resume: resumeTurn,
  setMode: applyMode,
};
