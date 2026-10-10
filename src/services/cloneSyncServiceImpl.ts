/**
 * Stub implementations for deleted sync services.
 * These services are no-ops as the sync architecture has evolved —
 * except CloneSyncService.save, which performs the real worktree write that
 * clone-mode saves depend on.
 */

import * as FileSystem from 'expo-file-system/legacy';
import { parseRepoPath } from '../utils/gitPathParser';
import { GitFsService } from './git/GitFsService';

const CLONES_SUBDIR = 'GitNotes/';

/** Root directory holding all cloned repos: `<documentDirectory>/GitNotes/`. */
function clonesRoot(): string {
  const docDir = FileSystem.documentDirectory;
  if (!docDir) {
    throw new Error('expo-file-system documentDirectory is not available in this environment');
  }
  return docDir.endsWith('/') ? docDir + CLONES_SUBDIR : `${docDir}/${CLONES_SUBDIR}`;
}

function toRepoRelativePath(filePath: string): string | null {
  const relativePath = filePath.replaceAll('\\', '/').replace(/^\/+/, '');
  if (!relativePath || relativePath.split('/').some((segment) => segment === '..')) {
    return null;
  }
  return relativePath;
}

// NoteSyncQueueService stubs
export interface NoteDeleteParams {
  repo: string;
  branch?: string;
  filePath: string;
  title?: string;
  accountId?: string;
  localNoteId?: string;
}

export interface QueuedMutation {
  id: string;
  type: string;
  params: {
    repo: string;
    branch?: string;
    filePath?: string;
    localNoteId?: string;
    [key: string]: unknown;
  };
  createdAt: number;
  lastError?: string;
  attempts?: number;
  localNoteId?: string;
}

export interface MutationSucceededEvent {
  mutation: QueuedMutation;
  result: unknown;
}

export interface DroppedMutationEvent {
  mutation: QueuedMutation;
  error?: string;
  reason?: string;
}

export const NoteSyncQueueService = {
  async enqueueNoteUpsert(
    _params: {
      repo: string;
      branch?: string;
      filePath?: string;
      title?: string;
      content?: string;
      format?: string;
      tags?: string[];
      accountId?: string | undefined;
      color?: string | null | undefined;
    },
    _noteId?: string,
  ): Promise<void> {
    // noop
  },

  async enqueueNoteDelete(_params: NoteDeleteParams): Promise<void> {
    // noop
  },
  async enqueueNoteDeletes(_params: NoteDeleteParams[]): Promise<void> {
    // noop
  },
  async drain(): Promise<void> {
    // noop
  },
  async getAll(): Promise<QueuedMutation[]> {
    return [];
  },
  async isTombstoned(
    _repoPath: string,
    _branch: string,
    _path: string,
  ): Promise<boolean> {
    return false;
  },
  async pendingCount(): Promise<number> {
    return 0;
  },
  subscribe(_callback: () => void): () => void {
    return () => {
      // noop
    };
  },
  onDroppedMutation(
    _callback: (event: DroppedMutationEvent) => void,
  ): () => void {
    return () => {
      // noop
    };
  },
  onMutationSucceeded(
    _callback: (event: MutationSucceededEvent) => void,
  ): () => void {
    return () => {
      // noop
    };
  },
  async purgeForRepo(_repoPath: string): Promise<void> {
    // noop
  },
};

// CloneSyncService stubs
export interface SaveResult {
  success: boolean;
  error?: string;
}

export interface CloneSyncServiceSaveParams {
  repoPath: string;
  branch: string;
  filePath: string;
  content?: string | undefined;
  message: string;
  intent: 'upsert' | 'delete';
}

export const CloneSyncService = {
  async save(params: CloneSyncServiceSaveParams): Promise<SaveResult> {
    const { repoPath, filePath, content, intent } = params;

    const info = parseRepoPath(repoPath);
    if (!info) {
      return { success: false, error: `Invalid repo path: ${repoPath}` };
    }

    const relPath = toRepoRelativePath(filePath);
    if (!relPath) {
      return { success: false, error: 'Missing filePath' };
    }

    const repoDir = `${clonesRoot()}${info.owner}/${info.repo}`;
    const fullPath = `${repoDir}/${relPath}`;

    try {
      if (intent === 'delete') {
        await FileSystem.deleteAsync(fullPath, { idempotent: true });
        return { success: true };
      }

      const lastSlash = relPath.lastIndexOf('/');
      const dirPath = lastSlash === -1 ? repoDir : `${repoDir}/${relPath.slice(0, lastSlash)}`;
      await FileSystem.makeDirectoryAsync(dirPath, { intermediates: true });
      await FileSystem.writeAsStringAsync(fullPath, content ?? '');
      return { success: true };
    } catch (error) {
      return { success: false, error: error instanceof Error ? error.message : String(error) };
    }
  },

  async listTree(repoPath: string, ref: string) {
    return GitFsService.listTree({ repoPath, ref });
  },
};
