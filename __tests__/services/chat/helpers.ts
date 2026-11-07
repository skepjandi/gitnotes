import type { ChatMessage, ChatThread } from '@/models/Chat';
import { ChatSession, type ChatSessionDeps } from '@/services/chat/ChatSession';
import type { ThreadStorage } from '@/services/chat/storage/threadStorage';
import type { ChatBackend, ChatEvent, ChatRunInput } from '@/services/chat/types';

export function makeThread(overrides: Partial<ChatThread> = {}): ChatThread {
  return {
    id: 'thread-1',
    title: 'New Chat',
    messages: [],
    createdAt: 1,
    updatedAt: 1,
    repoOwner: 'o',
    repoName: 'r',
    branch: 'main',
    filePath: 'chats/1.json',
    ...overrides,
  };
}

export function makeAgentThread(overrides: Partial<ChatThread> = {}): ChatThread {
  return makeThread({
    repoOwner: '',
    repoName: '',
    branch: '',
    filePath: '',
    backend: { type: 'agent', bridgeId: 'b', agentId: 'claude', agentName: 'Claude Code', cwd: '/work' },
    ...overrides,
  });
}

export const textOf = (messages: ChatMessage[]): string =>
  messages
    .filter((m) => m.role === 'assistant' && m.kind === 'text')
    .map((m) => m.content)
    .join('|');

/** In-memory storage that records deep snapshots of every save and can be slowed down or broken. */
export class MemoryStorage implements ThreadStorage {
  readonly kind = 'local';
  saved: ChatThread[] = [];
  stored = new Map<string, ChatThread>();
  saveDelayMs = 0;
  failNextSave: Error | null = null;
  active = 0;
  maxActive = 0;
  events: string[] = [];

  async load(threadId: string): Promise<ChatThread | null> {
    return this.stored.get(threadId) ?? null;
  }

  async save(thread: ChatThread): Promise<void> {
    this.active += 1;
    this.maxActive = Math.max(this.maxActive, this.active);
    this.events.push('save');
    try {
      if (this.saveDelayMs > 0) await new Promise((r) => setTimeout(r, this.saveDelayMs));
      if (this.failNextSave) {
        const error = this.failNextSave;
        this.failNextSave = null;
        throw error;
      }
      const snapshot = JSON.parse(JSON.stringify(thread)) as ChatThread;
      this.saved.push(snapshot);
      this.stored.set(thread.id, snapshot);
    } finally {
      this.active -= 1;
    }
  }

  async remove(threadId: string): Promise<void> {
    this.stored.delete(threadId);
  }

  async listSummaries() {
    return [];
  }

  get last(): ChatThread {
    return this.saved[this.saved.length - 1];
  }
}

/** Backend whose events are pushed by the test. */
export class ScriptedBackend implements ChatBackend {
  readonly type: 'model' | 'agent';
  inputs: ChatRunInput[] = [];
  resumeInputs: Array<Omit<ChatRunInput, 'userText' | 'contexts'>> = [];
  private queue: Array<{ event?: ChatEvent; error?: Error; end?: boolean }> = [];
  private wake: (() => void) | null = null;
  /** When true the stream ends with `turn-end cancelled` as soon as the run's signal aborts. */
  endsOnAbort = true;
  onRun: (() => void) | null = null;
  resume?: ChatBackend['resume'];
  setMode?: ChatBackend['setMode'];

  constructor(type: 'model' | 'agent' = 'model', withResume = false) {
    this.type = type;
    if (withResume) {
      this.resume = (input) => {
        this.resumeInputs.push(input);
        return this.stream(input.signal);
      };
    }
  }

  push(...events: ChatEvent[]): void {
    for (const event of events) this.queue.push({ event });
    this.wake?.();
  }

  end(stopReason = 'end_turn'): void {
    this.queue.push({ event: { type: 'turn-end', stopReason } }, { end: true });
    this.wake?.();
  }

  fail(error: Error): void {
    this.queue.push({ error });
    this.wake?.();
  }

  run(input: ChatRunInput): AsyncIterable<ChatEvent> {
    this.inputs.push(input);
    this.events.push('run');
    this.onRun?.();
    return this.stream(input.signal);
  }

  events: string[] = [];

  private async *stream(signal: AbortSignal): AsyncGenerator<ChatEvent> {
    const onAbort = () => this.wake?.();
    signal.addEventListener('abort', onAbort);
    try {
      for (;;) {
        if (signal.aborted && this.endsOnAbort) {
          yield { type: 'turn-end', stopReason: 'cancelled' };
          return;
        }
        const next = this.queue.shift();
        if (!next) {
          await new Promise<void>((resolve) => {
            this.wake = resolve;
          });
          this.wake = null;
          continue;
        }
        if (next.error) throw next.error;
        if (next.end) return;
        if (next.event) yield next.event;
      }
    } finally {
      signal.removeEventListener('abort', onAbort);
    }
  }
}

export interface Harness {
  session: ChatSession;
  storage: MemoryStorage;
  backend: ScriptedBackend;
  changed: ChatThread[];
}

export function makeSession(
  thread: ChatThread,
  options: {
    backend?: ScriptedBackend;
    storage?: MemoryStorage;
    deps?: Partial<ChatSessionDeps>;
    /** Skip `hydrate` so the test can drive `ensureLoaded` (the thread must then be in `storage.stored`). */
    hydrate?: boolean;
  } = {},
): Harness {
  const storage = options.storage ?? new MemoryStorage();
  const backend = options.backend ?? new ScriptedBackend(thread.backend?.type === 'agent' ? 'agent' : 'model');
  const changed: ChatThread[] = [];
  let counter = 0;
  const session = new ChatSession(thread.id, {
    loadThread: async (id) => storage.stored.get(id) ?? null,
    storageFor: () => storage,
    resolveBackend: () => backend,
    onThreadChanged: (t) => changed.push(t),
    now: () => 10_000 + counter,
    newId: () => `id-${(counter += 1)}`,
    textFlushMs: 50,
    agentPersistIntervalMs: 1500,
    abortGraceMs: 200,
    ...options.deps,
  });
  if (options.hydrate === false) storage.stored.set(thread.id, thread);
  else session.hydrate(thread);
  return { session, storage, backend, changed };
}

/** Lets pending promise callbacks (not timers) run. */
export const flushMicrotasks = async (rounds = 20): Promise<void> => {
  for (let i = 0; i < rounds; i += 1) await Promise.resolve();
};
