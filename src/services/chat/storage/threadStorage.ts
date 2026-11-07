import type { ChatThread, ChatThreadSummary } from '../../../models/Chat';
import { useAIStore } from '../../../stores/aiStore';
import { chatT } from '../copy';
import { localThreadStorage } from './localThreadStorage';
import { RepoThreadStorage } from './repoThreadStorage';

export interface ThreadStorage {
  readonly kind: 'repo' | 'local';
  load(threadId: string): Promise<ChatThread | null>;
  save(thread: ChatThread): Promise<void>;
  remove(threadId: string): Promise<void>;
  listSummaries(): Promise<ChatThreadSummary[]>;
}

/** The chat repo the user configured for model threads, or null when none is set. */
export function configuredRepoStorage(): RepoThreadStorage | null {
  const { chatRepoOwner, chatRepoName, chatRepoBranch } = useAIStore.getState();
  if (!chatRepoOwner || !chatRepoName) return null;
  return new RepoThreadStorage({ owner: chatRepoOwner, repo: chatRepoName, branch: chatRepoBranch || 'main' });
}

/** Where a thread is (or will be) stored. Agent threads never leave the device. */
export function storageForThread(thread: ChatThread): ThreadStorage {
  if (thread.backend?.type === 'agent') return localThreadStorage;
  return new RepoThreadStorage({
    owner: thread.repoOwner,
    repo: thread.repoName,
    branch: thread.branch || 'main',
  });
}

/** Loads a thread whose kind is not known yet: device-local agent threads first, then the chat repo. */
export async function loadThreadById(threadId: string): Promise<ChatThread | null> {
  const local = await localThreadStorage.load(threadId);
  if (local) return local;
  const repoStorage = configuredRepoStorage();
  if (!repoStorage) throw new Error(chatT('chat.storageRepoNotConfigured'));
  return repoStorage.load(threadId);
}
