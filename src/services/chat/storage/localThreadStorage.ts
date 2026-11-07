import AsyncStorage from '@react-native-async-storage/async-storage';
import type { ChatThread, ChatThreadSummary } from '../../../models/Chat';
import { buildThreadSummary } from '../../../utils/chatThreadSummary';
import type { ThreadStorage } from './threadStorage';

const THREAD_KEY_PREFIX = 'gitnotes.agentChat.thread.';
const INDEX_KEY = 'gitnotes.agentChat.index';

const threadKey = (threadId: string): string => `${THREAD_KEY_PREFIX}${threadId}`;

function isSummary(value: unknown): value is ChatThreadSummary {
  if (!value || typeof value !== 'object') return false;
  const candidate = value as Partial<ChatThreadSummary>;
  return (
    typeof candidate.id === 'string' &&
    typeof candidate.title === 'string' &&
    typeof candidate.updatedAt === 'number' &&
    typeof candidate.messageCount === 'number'
  );
}

function isThread(value: unknown): value is ChatThread {
  if (!value || typeof value !== 'object') return false;
  const candidate = value as Partial<ChatThread>;
  return typeof candidate.id === 'string' && Array.isArray(candidate.messages);
}

const byRecency = (a: ChatThreadSummary, b: ChatThreadSummary): number => b.updatedAt - a.updatedAt;

/**
 * Device-only storage for agent threads (transcripts may contain host secrets).
 *
 * One AsyncStorage entry per thread plus a summary index. Saves write the thread
 * first, removals delete it first, so a crash between the two writes can only leave
 * an index that disagrees with the thread entries. `listSummaries` detects that and
 * rebuilds the index from the entries, which are the source of truth.
 */
export class LocalThreadStorage implements ThreadStorage {
  readonly kind = 'local';

  /** Serialises every index read-modify-write so concurrent saves never drop each other's rows. */
  private indexChain: Promise<unknown> = Promise.resolve();

  async load(threadId: string): Promise<ChatThread | null> {
    let raw: string | null;
    try {
      raw = await AsyncStorage.getItem(threadKey(threadId));
    } catch (error) {
      console.warn('[LocalThreadStorage] read failed:', error);
      return null;
    }
    if (!raw) return null;
    try {
      const parsed: unknown = JSON.parse(raw);
      return isThread(parsed) ? parsed : null;
    } catch (error) {
      console.warn(`[LocalThreadStorage] corrupt thread ${threadId}:`, error);
      return null;
    }
  }

  async save(thread: ChatThread): Promise<void> {
    await AsyncStorage.setItem(threadKey(thread.id), JSON.stringify(thread));
    await this.serialized(async () => {
      const current = (await this.readIndex()) ?? (await this.rebuildIndex());
      await this.writeIndex([...current.filter((s) => s.id !== thread.id), buildThreadSummary(thread)]);
    });
  }

  async remove(threadId: string): Promise<void> {
    await AsyncStorage.removeItem(threadKey(threadId));
    await this.serialized(async () => {
      const current = (await this.readIndex()) ?? (await this.rebuildIndex());
      await this.writeIndex(current.filter((s) => s.id !== threadId));
    });
  }

  listSummaries(): Promise<ChatThreadSummary[]> {
    return this.serialized(() => this.consistentIndex());
  }

  private serialized<T>(work: () => Promise<T>): Promise<T> {
    const run = this.indexChain.then(work);
    this.indexChain = run.catch(() => undefined);
    return run;
  }

  private async writeIndex(summaries: ChatThreadSummary[]): Promise<void> {
    await AsyncStorage.setItem(INDEX_KEY, JSON.stringify([...summaries].sort(byRecency)));
  }

  /** The index when it agrees with the stored thread entries, otherwise a rebuilt (and persisted) one. */
  private async consistentIndex(): Promise<ChatThreadSummary[]> {
    const threadIds = await this.storedThreadIds();
    const index = await this.readIndex();
    if (index) {
      const indexed = new Set(index.map((summary) => summary.id));
      if (threadIds.length === indexed.size && threadIds.every((id) => indexed.has(id))) return index;
    }
    const rebuilt = await this.rebuildIndex(threadIds);
    await this.writeIndex(rebuilt);
    return rebuilt;
  }

  private async storedThreadIds(): Promise<string[]> {
    return (await AsyncStorage.getAllKeys())
      .filter((key) => key.startsWith(THREAD_KEY_PREFIX))
      .map((key) => key.slice(THREAD_KEY_PREFIX.length));
  }

  /** Parsed index sorted newest first, or null when missing, malformed or holding invalid rows. */
  private async readIndex(): Promise<ChatThreadSummary[] | null> {
    const raw = await AsyncStorage.getItem(INDEX_KEY);
    if (!raw) return null;
    try {
      const parsed: unknown = JSON.parse(raw);
      if (!Array.isArray(parsed) || !parsed.every(isSummary)) return null;
      return [...parsed].sort(byRecency);
    } catch {
      return null;
    }
  }

  /** Summaries derived from the thread entries themselves. Does not write. */
  private async rebuildIndex(threadIds?: string[]): Promise<ChatThreadSummary[]> {
    const ids = threadIds ?? (await this.storedThreadIds());
    const summaries: ChatThreadSummary[] = [];
    for (const id of ids) {
      const thread = await this.load(id);
      if (thread) summaries.push(buildThreadSummary(thread));
    }
    return summaries.sort(byRecency);
  }
}

export const localThreadStorage = new LocalThreadStorage();
