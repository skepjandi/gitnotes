import { create } from 'zustand';
import { ChatMessage, ChatThread, ChatThreadSummary } from '../models/Chat';
import { ChatStorageError } from '../services/ChatStorageService';
import { formatSyncError } from '../services/git/formatSyncError';
import { buildThreadSummary, deriveChatTitleFromText, isDefaultChatTitle } from '../utils/chatThreadSummary';

export interface ChatStorageAdapter {
  loadThreadSummaries: (owner: string, repo: string, branch: string) => Promise<ChatThreadSummary[]>;
  loadThread: (owner: string, repo: string, branch: string, threadId: string) => Promise<ChatThread | null>;
  saveThread: (thread: ChatThread) => Promise<void>;
  deleteThread: (owner: string, repo: string, branch: string, threadId: string) => Promise<void>;
}

interface ChatState {
  threads: ChatThreadSummary[];
  activeThread: ChatThread | null;
  isLoading: boolean;
  error: string | null;
  isStreaming: boolean;
  storageAdapter: ChatStorageAdapter | null;
}

interface CreateThreadInput {
  repoOwner: string;
  repoName: string;
  branch: string;
  filePath: string;
  title?: string;
}

interface RenameThreadInput {
  threadId: string;
  title: string;
}

interface ThreadLookupInput {
  owner: string;
  repo: string;
  branch: string;
  threadId: string;
}

interface ThreadListInput {
  owner: string;
  repo: string;
  branch: string;
}

interface ChatActions {
  loadThreads: (input: ThreadListInput) => Promise<void>;
  loadThread: (input: ThreadLookupInput) => Promise<ChatThread | null>;
  createThread: (input: CreateThreadInput) => ChatThread;
  deleteThread: (input: ThreadLookupInput) => Promise<boolean>;
  renameThread: (input: RenameThreadInput) => void;
  addMessage: (message: ChatMessage) => void;
  updateMessage: (messageId: string, updates: Partial<ChatMessage>) => void;
  removeMessage: (messageId: string) => void;
  truncateAfter: (messageId: string, options?: { inclusive?: boolean }) => void;
  setStreaming: (isStreaming: boolean) => void;
  clearActiveThread: () => void;
  clearError: () => void;
  setStorageAdapter: (adapter: ChatStorageAdapter) => void;
}

const sortThreadSummaries = (threads: ChatThreadSummary[]): ChatThreadSummary[] =>
  [...threads].sort((a, b) => b.updatedAt - a.updatedAt);

const upsertThreadSummary = (
  summaries: ChatThreadSummary[],
  thread: ChatThread,
): ChatThreadSummary[] => {
  const summary = buildThreadSummary(thread);
  const existingIndex = summaries.findIndex((item) => item.id === thread.id);

  if (existingIndex === -1) {
    return sortThreadSummaries([summary, ...summaries]);
  }

  return sortThreadSummaries(
    summaries.map((item) => (item.id === thread.id ? summary : item)),
  );
};

export const useChatStore = create<ChatState & ChatActions>()((set, get) => ({
  threads: [],
  activeThread: null,
  isLoading: false,
  error: null,
  isStreaming: false,
  storageAdapter: null,

  loadThreads: async ({ owner, repo, branch }) => {
    const { storageAdapter } = get();
    if (!storageAdapter) {
      return;
    }

    try {
      set({ isLoading: true, error: null });
      const threads = await storageAdapter.loadThreadSummaries(owner, repo, branch);
      set({ threads: sortThreadSummaries(threads), isLoading: false });
    } catch (err) {
      if (err instanceof ChatStorageError && err.cachedData !== undefined) {
        set({
          threads: sortThreadSummaries(err.cachedData),
          error: err.warning ?? err.message,
          isLoading: false,
        });
        return;
      }
      const errorMessage = err instanceof ChatStorageError
        ? err.message
        : 'Failed to load chat threads';
      set({ error: errorMessage, isLoading: false });
      console.error('Error loading chat threads:', err);
    }
  },

  loadThread: async ({ owner, repo, branch, threadId }) => {
    const { storageAdapter } = get();
    if (!storageAdapter) {
      return null;
    }

    try {
      set({ isLoading: true, error: null });
      const thread = await storageAdapter.loadThread(owner, repo, branch, threadId);
      set((state) => ({
        activeThread: thread,
        threads: thread ? upsertThreadSummary(state.threads, thread) : state.threads,
        isLoading: false,
      }));
      return thread;
    } catch (err) {
      const errorMessage = err instanceof ChatStorageError
        ? err.message
        : 'Failed to load chat thread';
      set({ error: errorMessage, isLoading: false });
      console.error('Error loading chat thread:', err);
      return null;
    }
  },

  createThread: ({ repoOwner, repoName, branch, filePath, title }) => {
    const now = Date.now();
    const thread: ChatThread = {
      id: `${now}-${Math.random().toString(36).substring(2, 11)}`,
      title: title?.trim() || 'New Chat',
      messages: [],
      createdAt: now,
      updatedAt: now,
      repoOwner,
      repoName,
      branch,
      filePath,
    };

    set((state) => ({
      activeThread: thread,
      threads: upsertThreadSummary(state.threads, thread),
      error: null,
    }));

    return thread;
  },

  deleteThread: async ({ owner, repo, branch, threadId }) => {
    const { storageAdapter } = get();
    if (!storageAdapter) {
      return false;
    }

    try {
      set({ error: null });
      await storageAdapter.deleteThread(owner, repo, branch, threadId);
      set((state) => ({
        threads: state.threads.filter((thread) => thread.id !== threadId),
        activeThread: state.activeThread?.id === threadId ? null : state.activeThread,
      }));
      return true;
    } catch (err) {
      const raw = err instanceof Error ? err.message : typeof err === 'string' ? err : String(err);
      set({ error: formatSyncError(raw, 'delete') });
      console.error('Error deleting chat thread:', err);
      return false;
    }
  },

  renameThread: ({ threadId, title }) => {
    const trimmedTitle = title.trim() || 'New Chat';

    set((state) => {
      const updatedAt = Date.now();
      const activeThread =
        state.activeThread?.id === threadId
          ? {
              ...state.activeThread,
              title: trimmedTitle,
              updatedAt,
            }
          : state.activeThread;

      return {
        activeThread,
        threads: sortThreadSummaries(
          state.threads.map((thread) =>
            thread.id === threadId
              ? {
                  ...thread,
                  title: trimmedTitle,
                  updatedAt,
                }
              : thread,
          ),
        ),
      };
    });
  },

  addMessage: (message) => {
    set((state) => {
      if (!state.activeThread) {
        return state;
      }

      const nextTitle =
        message.role === 'user' && isDefaultChatTitle(state.activeThread.title)
          ? deriveChatTitleFromText(message.content)
          : state.activeThread.title;

      const updatedThread: ChatThread = {
        ...state.activeThread,
        title: nextTitle,
        messages: [...state.activeThread.messages, message],
        updatedAt: Math.max(message.timestamp, Date.now()),
      };

      return {
        activeThread: updatedThread,
        threads: upsertThreadSummary(state.threads, updatedThread),
      };
    });
  },

  updateMessage: (messageId, updates) => {
    set((state) => {
      if (!state.activeThread) {
        return state;
      }

      const messageExists = state.activeThread.messages.some((message) => message.id === messageId);
      if (!messageExists) {
        return state;
      }

      const updatedThread: ChatThread = {
        ...state.activeThread,
        messages: state.activeThread.messages.map((message) =>
          message.id === messageId
            ? {
                ...message,
                ...updates,
              }
            : message,
        ),
        updatedAt: Date.now(),
      };

      return {
        activeThread: updatedThread,
        threads: upsertThreadSummary(state.threads, updatedThread),
      };
    });
  },

  removeMessage: (messageId) => {
    set((state) => {
      if (!state.activeThread) return state;
      const messages = state.activeThread.messages;
      if (!messages.some((message) => message.id === messageId)) return state;
      const updatedThread: ChatThread = {
        ...state.activeThread,
        messages: messages.filter((message) => message.id !== messageId),
        updatedAt: Date.now(),
      };
      return {
        activeThread: updatedThread,
        threads: upsertThreadSummary(state.threads, updatedThread),
      };
    });
  },

  truncateAfter: (messageId, options) => {
    set((state) => {
      if (!state.activeThread) return state;
      const messages = state.activeThread.messages;
      const index = messages.findIndex((m) => m.id === messageId);
      if (index < 0) return state;
      const cutoff = options?.inclusive ? index : index + 1;
      if (cutoff >= messages.length) return state;
      const updatedThread: ChatThread = {
        ...state.activeThread,
        messages: messages.slice(0, cutoff),
        updatedAt: Date.now(),
      };
      return {
        activeThread: updatedThread,
        threads: upsertThreadSummary(state.threads, updatedThread),
      };
    });
  },

  setStreaming: (isStreaming) => set({ isStreaming }),

  clearActiveThread: () => set({ activeThread: null, isStreaming: false }),

  clearError: () => set({ error: null }),

  setStorageAdapter: (adapter) => set({ storageAdapter: adapter }),
}));
