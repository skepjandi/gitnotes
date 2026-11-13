import { create } from 'zustand';
import type { ChatThread, ChatThreadSummary } from '../models/Chat';
import { ChatStorageError } from '../services/ChatStorageService';
import { formatSyncError } from '../services/git/formatSyncError';
import { releaseAgentConnection } from '../services/chat/backends/agentBackend';
import { chatT } from '../services/chat/copy';
import { localThreadStorage } from '../services/chat/storage/localThreadStorage';
import { configuredRepoStorage } from '../services/chat/storage/threadStorage';
import { emitThreadRemoved, emitThreadRenamed } from '../services/chat/threadEvents';
import { buildThreadSummary, DEFAULT_CHAT_TITLE } from '../utils/chatThreadSummary';

interface ChatState {
  threads: ChatThreadSummary[];
  isLoading: boolean;
  error: string | null;
}

interface RenameThreadInput {
  threadId: string;
  title: string;
}

interface ChatActions {
  /** Chat-repo summaries (when a chat repo is configured) merged with device-local agent summaries. */
  loadThreads: () => Promise<void>;
  deleteThread: (summary: ChatThreadSummary) => Promise<boolean>;
  /** Updates the list and persists the new title for the thread's own storage. */
  renameThread: (input: RenameThreadInput) => void;
  upsertSummary: (thread: ChatThread) => void;
  clearError: () => void;
}

const sortThreadSummaries = (threads: ChatThreadSummary[]): ChatThreadSummary[] =>
  [...threads].sort((a, b) => b.updatedAt - a.updatedAt);

const isAgentSummary = (summary: ChatThreadSummary): boolean => summary.backend === 'agent' || summary.backend === 'demo';

async function releaseAgentConnectionFor(threadId: string): Promise<void> {
  try {
    await releaseAgentConnection(threadId);
  } catch (error) {
    console.warn('[chatStore] releasing agent connection failed:', error);
  }
}

export const useChatStore = create<ChatState & ChatActions>()((set, get) => ({
  threads: [],
  isLoading: false,
  error: null,

  loadThreads: async () => {
    set({ isLoading: true, error: null });

    const localSummaries = await localThreadStorage.listSummaries().catch((error: unknown) => {
      console.warn('[chatStore] loading device-local chats failed:', error);
      return [] as ChatThreadSummary[];
    });

    let repoSummaries = get().threads.filter((summary) => !isAgentSummary(summary));
    let error: string | null = null;
    const repoStorage = configuredRepoStorage();
    if (repoStorage) {
      try {
        repoSummaries = await repoStorage.listSummaries();
      } catch (err) {
        if (err instanceof ChatStorageError && err.cachedData !== undefined) {
          repoSummaries = err.cachedData;
          error = err.warning ?? err.message;
        } else {
          error = err instanceof ChatStorageError ? err.message : 'Failed to load chat threads';
          console.error('Error loading chat threads:', err);
        }
      }
    } else {
      repoSummaries = [];
    }

    set({ threads: sortThreadSummaries([...repoSummaries, ...localSummaries]), isLoading: false, error });
  },

  deleteThread: async (summary) => {
    set({ error: null });
    // Stop the thread's session first so a running turn cannot save the thread back after it is gone.
    emitThreadRemoved(summary.id);
    try {
      if (isAgentSummary(summary)) {
        await localThreadStorage.remove(summary.id);
        await releaseAgentConnectionFor(summary.id);
      } else {
        const repoStorage = configuredRepoStorage();
        if (!repoStorage) throw new Error(chatT('chat.storageRepoNotConfigured'));
        await repoStorage.remove(summary.id);
      }
      set((state) => ({ threads: state.threads.filter((thread) => thread.id !== summary.id) }));
      return true;
    } catch (err) {
      const raw = err instanceof Error ? err.message : typeof err === 'string' ? err : String(err);
      set({ error: formatSyncError(raw, 'delete') });
      console.error('Error deleting chat thread:', err);
      return false;
    }
  },

  renameThread: ({ threadId, title }) => {
    const trimmedTitle = title.trim() || DEFAULT_CHAT_TITLE;
    const updatedAt = Date.now();
    const summary = get().threads.find((thread) => thread.id === threadId);

    set((state) => ({
      threads: sortThreadSummaries(
        state.threads.map((thread) => (thread.id === threadId ? { ...thread, title: trimmedTitle, updatedAt } : thread)),
      ),
    }));

    // A live session saves its own (newest) state; only persist from storage when there is none.
    if (emitThreadRenamed(threadId, trimmedTitle) || !summary) return;
    const storage = isAgentSummary(summary) ? localThreadStorage : configuredRepoStorage();
    if (!storage) return;
    void (async () => {
      try {
        const stored = await storage.load(threadId);
        if (stored) await storage.save({ ...stored, title: trimmedTitle, updatedAt });
      } catch (err) {
        const raw = err instanceof Error ? err.message : String(err);
        set({ error: formatSyncError(raw, 'upsert') });
      }
    })();
  },

  upsertSummary: (thread) => {
    const summary = buildThreadSummary(thread);
    set((state) => ({
      threads: sortThreadSummaries([...state.threads.filter((item) => item.id !== thread.id), summary]),
    }));
  },

  clearError: () => set({ error: null }),
}));
