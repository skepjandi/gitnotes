import type { ChatThread } from '../../models/Chat';
import { useChatStore } from '../../stores/chatStore';
import { generateId } from '../../utils/ids';
import { resolveBackend } from './backends';
import { ChatSession, DEFAULT_SESSION_TIMING, type ChatSessionDeps } from './ChatSession';
import { loadThreadById, storageForThread } from './storage/threadStorage';
import { onThreadRemoved, onThreadRenamed } from './threadEvents';

const sessions = new Map<string, ChatSession>();

function defaultDeps(): ChatSessionDeps {
  return {
    loadThread: loadThreadById,
    storageFor: storageForThread,
    resolveBackend,
    onThreadChanged: (thread) => useChatStore.getState().upsertSummary(thread),
    now: Date.now,
    newId: generateId,
    ...DEFAULT_SESSION_TIMING,
  };
}

/** The live session for a thread; created on first use, shared by every screen that shows the thread. */
export function getChatSession(threadId: string): ChatSession {
  let session = sessions.get(threadId);
  if (!session) {
    session = new ChatSession(threadId, defaultDeps());
    sessions.set(threadId, session);
  }
  return session;
}

/** Registers a freshly created thread so its session never has to load it. */
export function seedChatSession(thread: ChatThread): ChatSession {
  const session = getChatSession(thread.id);
  session.hydrate(thread);
  return session;
}

/** Stops the thread's turn and forgets the session (thread deleted). */
export function disposeChatSession(threadId: string): void {
  sessions.get(threadId)?.dispose();
  sessions.delete(threadId);
}

onThreadRemoved(disposeChatSession);
onThreadRenamed((threadId, title) => sessions.get(threadId)?.rename(title) ?? false);
