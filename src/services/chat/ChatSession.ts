import { createStore, type StoreApi } from 'zustand/vanilla';
import type { AIContextItem } from '../../models/AIProvider';
import type { ChatMessage, ChatThread, ThreadBackend } from '../../models/Chat';
import { deriveChatTitleFromText, isDefaultChatTitle } from '../../utils/chatThreadSummary';
import { chatT } from './copy';
import { applyChatEvent, findToolMessage, settleInterruptedTools, type ReducerDeps } from './reducer';
import type { ThreadStorage } from './storage/threadStorage';
import type {
  ChatBackend,
  ChatEvent,
  ChatSessionActions,
  ChatSessionState,
  PermissionDecision,
  PermissionRequest,
  QueuedPrompt,
} from './types';

export interface ChatSessionDeps {
  loadThread(threadId: string): Promise<ChatThread | null>;
  storageFor(thread: ChatThread): ThreadStorage;
  resolveBackend(thread: ChatThread): ChatBackend;
  /** Called after every persistence attempt with the thread that was written. */
  onThreadChanged?(thread: ChatThread): void;
  now(): number;
  newId(): string;
  /** Text/thought deltas reach the store at most this often. */
  textFlushMs: number;
  /** Agent threads are persisted at most this often while a turn runs. */
  agentPersistIntervalMs: number;
  /** After `stop()`, how long the backend may keep emitting its closing events. */
  abortGraceMs: number;
}

export const DEFAULT_SESSION_TIMING = {
  textFlushMs: 50,
  agentPersistIntervalMs: 1500,
  abortGraceMs: 1000,
} as const;

type TurnSpec = { kind: 'prompt'; userText: string; contexts: AIContextItem[] } | { kind: 'resume' };

interface TurnHandle {
  token: number;
  controller: AbortController;
  queued?: { prompt: QueuedPrompt; messageId: string };
}

interface PendingDelta {
  type: 'text-delta' | 'thought-delta';
  text: string;
  seq?: number;
}

const INITIAL_STATE: ChatSessionState = {
  loadState: 'loading',
  loadError: null,
  thread: null,
  status: 'idle',
  error: null,
  streamStartedAt: 0,
  statusLine: null,
  pendingPermissions: [],
  retryable: false,
  queuedPrompts: [],
};

const noop = (): void => {
  /* noop */
};

type AgentBackend = Extract<ThreadBackend, { type: 'agent' }>;

function foldAgentState(
  backend: AgentBackend,
  event: Extract<ChatEvent, { type: 'agent-state' }>,
): AgentBackend {
  const next: AgentBackend = { ...backend };
  if (event.sessionId !== undefined) next.sessionId = event.sessionId;
  if (event.connectionId !== undefined) next.connectionId = event.connectionId;
  if (event.modeId !== undefined) next.modeId = event.modeId;
  if (event.availableModes !== undefined) next.availableModes = event.availableModes;
  if (event.availableCommands !== undefined) next.availableCommands = event.availableCommands;
  if (event.pendingPromptId === null) delete next.pendingPromptId;
  else if (event.pendingPromptId !== undefined) next.pendingPromptId = event.pendingPromptId;
  return next;
}

function withoutPendingPrompt<T extends ThreadBackend | undefined>(backend: T): T {
  if (backend?.type !== 'agent' || backend.pendingPromptId === undefined) return backend;
  const next: AgentBackend = { ...backend };
  delete next.pendingPromptId;
  return next as T;
}

/**
 * One chat thread's runtime. Lives outside React: leaving the screen never touches a
 * running turn, and the zustand store can be observed by any number of screens.
 */
export class ChatSession implements ChatSessionActions {
  readonly store: StoreApi<ChatSessionState> = createStore<ChatSessionState>(() => INITIAL_STATE);

  private controller: AbortController | null = null;
  private turnToken = 0;
  private loadPromise: Promise<void> | null = null;
  private disposed = false;

  private readonly permissionResolvers = new Map<string, (decision: PermissionDecision) => void>();

  private pendingDelta: PendingDelta | null = null;
  private flushTimer: ReturnType<typeof setTimeout> | undefined;

  private saveChain: Promise<void> = Promise.resolve();
  private queuedSave: Promise<void> | null = null;
  private persistTimer: ReturnType<typeof setTimeout> | undefined;
  private lastPersistAt = 0;
  private persistWarning: string | null = null;

  constructor(
    readonly threadId: string,
    private readonly deps: ChatSessionDeps,
  ) {}

  private get state(): ChatSessionState {
    return this.store.getState();
  }

  private get busy(): boolean {
    return this.state.status === 'running' || this.state.status === 'awaiting-permission';
  }

  /** Loads the thread once. Safe to call from every mount. */
  ensureLoaded(): Promise<void> {
    this.loadPromise ??= this.load();
    return this.loadPromise;
  }

  /** Retries a failed or not-found load. */
  reload(): Promise<void> {
    if (this.state.loadState === 'loading' || this.state.loadState === 'ready') return this.ensureLoaded();
    this.loadPromise = null;
    return this.ensureLoaded();
  }

  /** Adopts an already-built thread (freshly created, so there is nothing to load). */
  hydrate(thread: ChatThread): void {
    this.loadPromise = Promise.resolve();
    this.store.setState({ ...INITIAL_STATE, loadState: 'ready', thread });
  }

  /** Applies a rename made from the thread list and persists it with the session's newest state. False when not loaded. */
  rename(title: string): boolean {
    const thread = this.state.thread;
    if (!thread) return false;
    if (thread.title !== title) {
      this.store.setState({ thread: { ...thread, title } });
      void this.persist();
    }
    return true;
  }

  dispose(): void {
    this.disposed = true;
    this.abortTurn();
    this.clearTimers();
    this.pendingDelta = null;
    this.store.setState({ queuedPrompts: [] });
  }

  private async load(): Promise<void> {
    this.store.setState({ loadState: 'loading', loadError: null });
    let thread: ChatThread | null;
    try {
      thread = await this.deps.loadThread(this.threadId);
    } catch (error) {
      if (this.disposed) return;
      const message = error instanceof Error && error.message ? error.message : chatT('chat.threadNotLoaded');
      this.store.setState({ loadState: 'error', loadError: message });
      return;
    }
    if (this.disposed) return;
    if (!thread) {
      this.store.setState({ loadState: 'not-found' });
      return;
    }
    this.adopt(thread);
  }

  private adopt(loaded: ChatThread): void {
    const canResume =
      loaded.backend?.type === 'agent' &&
      loaded.backend.pendingPromptId !== undefined &&
      !!this.deps.resolveBackend(loaded).resume;

    const thread: ChatThread = canResume
      ? loaded
      : { ...loaded, messages: settleInterruptedTools(loaded.messages), backend: withoutPendingPrompt(loaded.backend) };

    this.store.setState({ ...INITIAL_STATE, loadState: 'ready', thread });
    if (canResume) void this.runTurn(this.beginTurn(), { kind: 'resume' });
  }

  // ---------------------------------------------------------------- actions

  send = async (text: string, contexts: AIContextItem[]): Promise<void> => {
    const thread = this.state.thread;
    const trimmed = text.trim();
    if (!thread || !trimmed) return;
    if (this.busy) {
      this.store.setState({
        queuedPrompts: [
          ...this.state.queuedPrompts,
          { id: this.deps.newId(), text: trimmed, contexts, state: 'queued' },
        ],
      });
      return;
    }

    const userMessage: ChatMessage = {
      id: this.deps.newId(),
      role: 'user',
      content: trimmed,
      timestamp: this.deps.now(),
      attachedContexts: contexts,
    };
    await this.startPrompt(this.withMessages(thread, [...thread.messages, userMessage]), trimmed, contexts);
  };

  stop = (): void => {
    if (!this.controller) return;
    this.abortTurn();
    this.flushDelta();
    void this.persist();
  };

  cancelQueued = (promptId: string): void => {
    const { queuedPrompts } = this.state;
    const target = queuedPrompts.find((p) => p.id === promptId);
    if (!target || target.state === 'sending') return;
    this.store.setState({ queuedPrompts: queuedPrompts.filter((p) => p.id !== promptId) });
  };

  retryQueued = (promptId: string): void => {
    const { queuedPrompts } = this.state;
    const target = queuedPrompts.find((p) => p.id === promptId);
    if (!target || target.state !== 'failed') return;
    this.store.setState({
      queuedPrompts: [{ ...target, state: 'queued' }, ...queuedPrompts.filter((p) => p.id !== promptId)],
    });
    void this.drainQueue();
  };

  retry = async (): Promise<void> => {
    const messages = this.state.thread?.messages ?? [];
    for (let i = messages.length - 1; i >= 0; i -= 1) {
      if (messages[i].role === 'user') return this.regenerate(messages[i].id);
    }
  };

  editAndResend = async (messageId: string, text: string): Promise<void> => {
    const thread = this.state.thread;
    const trimmed = text.trim();
    if (!thread || this.busy || !trimmed) return;
    const index = thread.messages.findIndex((m) => m.id === messageId && m.role === 'user');
    if (index < 0) return;

    const original = thread.messages[index];
    const edited: ChatMessage = {
      id: this.deps.newId(),
      role: 'user',
      content: trimmed,
      timestamp: this.deps.now(),
      attachedContexts: original.attachedContexts ?? [],
    };
    await this.startPrompt(
      this.withMessages(thread, [...thread.messages.slice(0, index), edited]),
      trimmed,
      edited.attachedContexts ?? [],
    );
  };

  regenerate = async (messageId: string): Promise<void> => {
    const thread = this.state.thread;
    if (!thread || this.busy) return;
    let index = thread.messages.findIndex((m) => m.id === messageId);
    while (index >= 0 && thread.messages[index].role !== 'user') index -= 1;
    if (index < 0) return;

    const prompt = thread.messages[index];
    await this.startPrompt(
      this.withMessages(thread, thread.messages.slice(0, index + 1)),
      prompt.content,
      prompt.attachedContexts ?? [],
    );
  };

  resolvePermission = (requestId: string, decision: PermissionDecision): void => {
    const resolve = this.permissionResolvers.get(requestId);
    if (!resolve) return;
    this.flushDelta();
    this.permissionResolvers.delete(requestId);

    const { pendingPermissions, thread } = this.state;
    const request = pendingPermissions.find((r) => r.id === requestId);
    const remaining = pendingPermissions.filter((r) => r.id !== requestId);
    const chosen = request?.options.find((o) => o.id === decision.optionId);
    const rejected = decision.optionId === null || chosen?.kind === 'reject_once' || chosen?.kind === 'reject_always';

    this.store.setState({
      pendingPermissions: remaining,
      status: remaining.length > 0 ? 'awaiting-permission' : 'running',
      thread: thread ? this.withToolStatus(thread, request?.toolCallId, rejected ? 'rejected' : 'running') : thread,
    });
    resolve(decision);
  };

  setMode = async (modeId: string): Promise<void> => {
    const thread = this.state.thread;
    if (!thread || thread.backend?.type !== 'agent') return;
    try {
      await this.deps.resolveBackend(thread).setMode?.(thread, modeId);
    } catch (error) {
      this.store.setState({ error: error instanceof Error ? error.message : chatT('chat.failedToSend') });
      return;
    }
    const latest = this.state.thread;
    if (!latest || latest.backend?.type !== 'agent') return;
    this.store.setState({ thread: { ...latest, backend: { ...latest.backend, modeId } } });
    void this.persist();
  };

  dismissError = (): void => {
    this.persistWarning = null;
    this.store.setState({
      error: null,
      retryable: false,
      status: this.state.status === 'error' ? 'idle' : this.state.status,
    });
  };

  // ------------------------------------------------------------------ turns

  private withMessages(thread: ChatThread, messages: ChatMessage[]): ChatThread {
    const title =
      isDefaultChatTitle(thread.title) && messages.length > 0
        ? deriveChatTitleFromText(messages.find((m) => m.role === 'user')?.content ?? '')
        : thread.title;
    return { ...thread, title, messages, updatedAt: this.deps.now() };
  }

  private beginTurn(thread?: ChatThread, queued?: TurnHandle['queued']): TurnHandle {
    this.controller?.abort();
    const controller = new AbortController();
    this.controller = controller;
    this.store.setState({
      ...(thread ? { thread } : null),
      status: 'running',
      error: null,
      retryable: false,
      streamStartedAt: this.deps.now(),
      statusLine: null,
      pendingPermissions: [],
    });
    return { token: ++this.turnToken, controller, queued };
  }

  /** Commits the prompt to the thread, persists it before the backend sees it, then runs the turn. */
  private async startPrompt(
    thread: ChatThread,
    userText: string,
    contexts: AIContextItem[],
    queued?: TurnHandle['queued'],
  ): Promise<void> {
    const handle = this.beginTurn(thread, queued);
    await this.persist();
    await this.runTurn(handle, { kind: 'prompt', userText, contexts });
  }

  private async runTurn(handle: TurnHandle, spec: TurnSpec): Promise<void> {
    const { controller, token } = handle;
    let failure: unknown = null;
    try {
      const thread = this.state.thread;
      if (!thread) throw new Error(chatT('chat.threadNotAvailable'));
      if (!controller.signal.aborted) {
        const backend = this.deps.resolveBackend(thread);
        const base = {
          thread,
          signal: controller.signal,
          requestPermission: (request: Omit<PermissionRequest, 'id'>) => this.requestPermission(handle, request),
          reportStatus: (status: string | null) => {
            if (token === this.turnToken) this.store.setState({ statusLine: status });
          },
        };
        let events: AsyncIterable<ChatEvent>;
        if (spec.kind === 'resume') {
          if (!backend.resume) throw new Error(chatT('chat.threadNotAvailable'));
          events = backend.resume(base);
        } else {
          events = backend.run({ ...base, userText: spec.userText, contexts: spec.contexts });
        }
        for await (const event of this.untilAborted(events, controller.signal)) {
          if (token !== this.turnToken) break;
          this.ingest(event);
        }
      }
    } catch (error) {
      failure = error;
    }
    await this.finishTurn(handle, failure);
  }

  private async finishTurn(handle: TurnHandle, failure: unknown): Promise<void> {
    if (handle.token !== this.turnToken) return;
    this.flushDelta();
    this.clearPersistTimer();
    const aborted = handle.controller.signal.aborted;
    this.rejectAllPending();

    let thread = this.state.thread;
    const failed = !aborted && failure !== null;
    const unanswered =
      failed && handle.queued && thread?.messages[thread.messages.length - 1]?.id === handle.queued.messageId;
    if (thread && unanswered && handle.queued) {
      thread = { ...thread, messages: thread.messages.slice(0, -1) };
      this.store.setState({
        thread,
        queuedPrompts: [{ ...handle.queued.prompt, state: 'failed' }, ...this.state.queuedPrompts],
      });
    }
    if (thread) {
      let messages = applyChatEvent(thread.messages, { type: 'turn-end', stopReason: 'finished' }, this.reducerDeps);
      if (aborted || failed) messages = settleInterruptedTools(messages);
      this.store.setState({
        thread: { ...thread, messages, backend: withoutPendingPrompt(thread.backend), updatedAt: this.deps.now() },
      });
    }

    const lastIsUser = thread?.messages.some((m) => m.role === 'user') ?? false;
    this.controller = null;
    this.store.setState({
      status: failed ? 'error' : 'idle',
      error: failed ? this.errorMessage(failure) : this.persistWarning,
      retryable: failed && lastIsUser && !unanswered,
      statusLine: null,
      streamStartedAt: 0,
      pendingPermissions: [],
    });
    await this.persist();
    if (!aborted && !failed) await this.drainQueue();
  }

  private async drainQueue(): Promise<void> {
    if (this.disposed || this.busy) return;
    const thread = this.state.thread;
    const next = this.state.queuedPrompts[0];
    if (!thread || !next || next.state !== 'queued') return;

    const userMessage: ChatMessage = {
      id: this.deps.newId(),
      role: 'user',
      content: next.text,
      timestamp: this.deps.now(),
      attachedContexts: next.contexts,
    };
    this.store.setState({ queuedPrompts: this.state.queuedPrompts.slice(1) });
    await this.startPrompt(
      this.withMessages(thread, [...thread.messages, userMessage]),
      next.text,
      next.contexts,
      { prompt: next, messageId: userMessage.id },
    );
  }

  private errorMessage(failure: unknown): string {
    if (failure instanceof Error && failure.message) return failure.message;
    return chatT('chat.failedToSend');
  }

  private abortTurn(): void {
    this.controller?.abort();
    this.rejectAllPending();
  }

  /**
   * Yields backend events until it ends. After an abort the backend still gets a short grace
   * period to deliver its closing events, then the iterator is released even if it never settles.
   */
  private async *untilAborted(source: AsyncIterable<ChatEvent>, signal: AbortSignal): AsyncGenerator<ChatEvent> {
    const iterator = source[Symbol.asyncIterator]();
    const graceElapsed = new Promise<'grace-elapsed'>((resolve) => {
      const arm = () => {
        setTimeout(() => resolve('grace-elapsed'), this.deps.abortGraceMs);
      };
      if (signal.aborted) arm();
      else signal.addEventListener('abort', arm, { once: true });
    });
    try {
      for (;;) {
        const next = await Promise.race([iterator.next(), graceElapsed]);
        if (next === 'grace-elapsed' || next.done) return;
        yield next.value;
      }
    } finally {
      iterator.return?.()?.then(noop, noop);
    }
  }

  // ----------------------------------------------------------- event folding

  private readonly reducerDeps: ReducerDeps = {
    now: () => this.deps.now(),
    newId: () => this.deps.newId(),
  };

  private ingest(event: ChatEvent): void {
    if (event.type === 'text-delta' || event.type === 'thought-delta') {
      const pending = this.pendingDelta;
      if (pending && pending.type === event.type) {
        pending.text += event.text;
        if (event.seq !== undefined) pending.seq = event.seq;
      } else {
        this.flushDelta();
        this.pendingDelta = { type: event.type, text: event.text, seq: event.seq };
      }
      this.flushTimer ??= setTimeout(() => this.flushDelta(), this.deps.textFlushMs);
      return;
    }
    this.flushDelta();
    this.applyEvent(event);
  }

  private flushDelta(): void {
    clearTimeout(this.flushTimer);
    this.flushTimer = undefined;
    const pending = this.pendingDelta;
    if (!pending) return;
    this.pendingDelta = null;
    this.applyEvent({ type: pending.type, text: pending.text, seq: pending.seq });
  }

  /** Messages and the replay cursor change in one `setState`, so any snapshot is self-consistent. */
  private applyEvent(event: ChatEvent): void {
    const thread = this.state.thread;
    if (!thread) return;

    const messages = applyChatEvent(thread.messages, event, this.reducerDeps);
    let backend = thread.backend;
    if (backend?.type === 'agent') {
      let next = backend;
      if (event.seq !== undefined && event.seq !== next.lastSeq) next = { ...next, lastSeq: event.seq };
      if (event.type === 'agent-state') next = foldAgentState(next, event);
      if (event.type === 'turn-end') next = withoutPendingPrompt(next);
      backend = next;
    }
    if (messages === thread.messages && backend === thread.backend) return;

    this.store.setState({
      thread: {
        ...thread,
        messages,
        backend,
        updatedAt: messages === thread.messages ? thread.updatedAt : this.deps.now(),
      },
    });
    if (backend?.type === 'agent') this.schedulePersist();
  }

  private withToolStatus(
    thread: ChatThread,
    toolCallId: string | undefined,
    status: 'rejected' | 'running' | 'awaiting-approval',
  ): ChatThread {
    if (!toolCallId || !findToolMessage(thread.messages, toolCallId)) return thread;
    const messages = applyChatEvent(thread.messages, { type: 'tool-update', toolCallId, patch: { status } }, this.reducerDeps);
    return messages === thread.messages ? thread : { ...thread, messages };
  }

  // ------------------------------------------------------------ permissions

  private requestPermission(handle: TurnHandle, request: Omit<PermissionRequest, 'id'>): Promise<PermissionDecision> {
    if (handle.controller.signal.aborted || handle.token !== this.turnToken) {
      return Promise.resolve({ optionId: null });
    }
    this.flushDelta();
    const id = this.deps.newId();
    return new Promise<PermissionDecision>((resolve) => {
      this.permissionResolvers.set(id, resolve);
      const { thread, pendingPermissions } = this.state;
      this.store.setState({
        pendingPermissions: [...pendingPermissions, { ...request, id }],
        status: 'awaiting-permission',
        thread: thread ? this.withToolStatus(thread, request.toolCallId, 'awaiting-approval') : thread,
      });
    });
  }

  private rejectAllPending(): void {
    if (this.permissionResolvers.size === 0 && this.state.pendingPermissions.length === 0) return;
    const resolvers = [...this.permissionResolvers.values()];
    this.permissionResolvers.clear();
    this.store.setState({
      pendingPermissions: [],
      status: this.state.status === 'awaiting-permission' ? 'running' : this.state.status,
    });
    for (const resolve of resolvers) resolve({ optionId: null });
  }

  // ------------------------------------------------------------ persistence

  /**
   * Saves the latest thread snapshot. Saves are chained so they never overlap (overlapping
   * writes are what produced GitHub 409s); a save still waiting its turn reads the newest
   * state when it runs, so requests arriving meanwhile share it. Never rejects.
   */
  private persist(): Promise<void> {
    if (this.queuedSave) return this.queuedSave;
    const run = this.saveChain.then(() => {
      this.queuedSave = null;
      return this.writeNow();
    });
    this.queuedSave = run;
    this.saveChain = run.then(noop, noop);
    return run;
  }

  private async writeNow(): Promise<void> {
    const thread = this.state.thread;
    if (!thread || this.disposed) return;
    this.lastPersistAt = this.deps.now();
    try {
      await this.deps.storageFor(thread).save(thread);
      if (this.persistWarning !== null && this.state.error === this.persistWarning) {
        this.store.setState({ error: null });
      }
      this.persistWarning = null;
    } catch (error) {
      const message = error instanceof Error && error.message ? error.message : chatT('chat.failedToSend');
      console.warn('[ChatSession] save failed:', message);
      this.persistWarning = message;
      if (this.state.status !== 'error') this.store.setState({ error: message });
    }
    this.deps.onThreadChanged?.(thread);
  }

  private schedulePersist(): void {
    if (this.persistTimer || this.disposed) return;
    const wait = Math.max(0, this.lastPersistAt + this.deps.agentPersistIntervalMs - this.deps.now());
    this.persistTimer = setTimeout(() => {
      this.persistTimer = undefined;
      void this.persist();
    }, wait);
  }

  private clearPersistTimer(): void {
    clearTimeout(this.persistTimer);
    this.persistTimer = undefined;
  }

  private clearTimers(): void {
    this.clearPersistTimer();
    clearTimeout(this.flushTimer);
    this.flushTimer = undefined;
  }
}
