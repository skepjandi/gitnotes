import type { ChatThread, ChatThreadSummary } from '../../../models/Chat';
import * as ChatStorageService from '../../ChatStorageService';
import type { ThreadStorage } from './threadStorage';

export interface RepoLocation {
  owner: string;
  repo: string;
  branch: string;
}

/**
 * Chat-repo storage for model threads. A thin wrapper: typed `ChatStorageError`
 * classification, the AsyncStorage cache fallback and the per-repo write queue
 * all stay in `ChatStorageService`.
 */
export class RepoThreadStorage implements ThreadStorage {
  readonly kind = 'repo';

  constructor(private readonly location: RepoLocation) {}

  load(threadId: string): Promise<ChatThread | null> {
    const { owner, repo, branch } = this.location;
    return ChatStorageService.loadThread(owner, repo, threadId, branch);
  }

  save(thread: ChatThread): Promise<void> {
    return ChatStorageService.saveThread(thread);
  }

  async remove(threadId: string): Promise<void> {
    const { owner, repo, branch } = this.location;
    await ChatStorageService.deleteThread(owner, repo, threadId, branch);
  }

  listSummaries(): Promise<ChatThreadSummary[]> {
    const { owner, repo, branch } = this.location;
    return ChatStorageService.loadThreadSummaries(owner, repo, branch);
  }
}
