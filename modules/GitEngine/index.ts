import type { EventSubscription } from 'expo-modules-core';

import GitEngineModule from './src/GitEngineModule';
import type { GitProgressEvent } from './src/GitEngine.types';

export type {
  Author,
  BlobReadResult,
  BlobReadErrorKind,
  BlobReadError,
  BlobContent,
  BranchInfo,
  CommitInfo,
  ConflictBlobs,
  ConflictEntry,
  ConflictFile,
  DiffLine,
  DiffLineOrigin,
  FileDiff,
  FileHistoryEntry,
  FileHistoryResult,
  FileStatus,
  FileStatusKind,
  GeneratedKey,
  GitEngineError,
  GitProgressEvent,
  GitProgressKind,
  HunkSelection,
  NativeCredential,
  NativeCredentialKind,
  PullKind,
  PullResult,
  PushIntegrateKind,
  PushIntegrateResult,
  PushResult,
  RemoteInfo,
  RepairReport,
  RepoInfo,
  RepoStatus,
} from './src/GitEngine.types';

/** Rust crate version of the git2 engine. */
export async function version(): Promise<string> {
  return await GitEngineModule.version();
}

/** Stable engine identifier (`gitnotes-git2`). */
export async function engineName(): Promise<string> {
  return await GitEngineModule.engineName();
}

export function addEngineProgressListener(
  listener: (event: GitProgressEvent) => void,
): EventSubscription {
  return GitEngineModule.addListener('onEngineProgress', listener as (...args: unknown[]) => void);
}
