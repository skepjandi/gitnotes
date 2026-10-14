/**
 * NoteHistoryService.ts
 *
 * Read-only data service for note Git history.
 * Provides paginated file history and historical blob content without
 * mutating the note store or Git state.
 *
 * Key behaviors:
 * - Resolves note identity (repo, branch, filePath) from the Note model
 * - Uses the recorded/active branch consistently (never switches branches)
 * - Committed history only — dirty editor content is never sent as history
 * - Ephemeral blob state — closing/unmounting releases blob memory
 * - Deduplicated pagination preserving newest-first order
 */

import type { Note } from '../../models/Note';
import { GitFsService } from '../git/GitFsService';
import { getActiveBranch } from '../git/activeBranchStore';
import * as GitEngine from '../git/engine/GitEngine';
import type { BlobReadOutcome } from '../git/engine/GitEngine';
import { StorageService } from '../StorageService';
import type { GitRepository } from '../GitService';
import type { FileHistoryEntry } from '../../../modules/GitEngine/src/GitEngine.types';

// Re-export native types for consumers
export type { BlobReadOutcome } from '../git/engine/GitEngine';
export type { FileHistoryEntry } from '../../../modules/GitEngine/src/GitEngine.types';

/** Why a note is not eligible for history viewing */
export type NoteHistoryUnavailableReason =
  | 'NewNote'           // Note has no filePath (not yet saved to Git)
  | 'PdfNote'           // PDF notes are not supported
  | 'MissingRepo'       // Note has no repo (not a clone-mode note)
  | 'MissingBranch'     // Note has repo but no branch
  | 'NoRepositoryFound' // Could not find the repository in saved repos
  | 'ShallowClone';     // Repository was cloned with depth=1 (shallow)

/** UI-facing state for the history view */
export type NoteHistoryState =
  | { status: 'idle' }
  | { status: 'unavailable'; reason: NoteHistoryUnavailableReason }
  | { status: 'loading' }
  | { status: 'ready'; entries: FileHistoryEntry[]; shallow: boolean; hasMore: boolean }
  | { status: 'empty'; shallow: boolean }
  | { status: 'error'; message: string };

/** Resolved identity for a note's Git history */
export interface NoteHistoryIdentity {
  repoPath: string;       // "owner/repo"
  repoId: string;         // UUID of the repository
  branch: string;         // Branch to query (recorded/active)
  filePath: string;       // Repo-relative path of the note file
  workingTreePath: string; // Absolute path to the working tree
}

/** Pagination params for file history */
export interface FileHistoryPage {
  limit: number;
  skip: number;
}

const DEFAULT_PAGE_SIZE = 50;

/**
 * Check if a note is eligible for history viewing.
 * Returns the reason if unavailable, or null if eligible.
 */
export function getNoteHistoryEligibility(
  note: Note,
): NoteHistoryUnavailableReason | null {
  // New notes have no filePath
  if (!note.filePath) {
    return 'NewNote';
  }

  // Notes without a repo are not clone-mode notes
  if (!note.repo) {
    return 'MissingRepo';
  }

  // Notes without a branch are local-only or malformed
  if (!note.branch) {
    return 'MissingBranch';
  }

  // PDF notes are binary and not supported
  if (note.format === 'pdf') {
    return 'PdfNote';
  }

  return null;
}

/**
 * Check if a note is eligible for history viewing.
 * Returns true if eligible, false otherwise.
 */
export function isNoteEligibleForHistory(note: Note): boolean {
  return getNoteHistoryEligibility(note) === null;
}

/**
 * Resolve the Git identity for a note's history.
 * Throws if the note is not eligible (caller should check first).
 */
export async function resolveNoteHistoryIdentity(
  note: Note,
): Promise<NoteHistoryIdentity> {
  const repoPath = note.repo!;
  const branch = note.branch!;
  const filePath = note.filePath!;

  // Find the repository to get its ID
  const repos = await StorageService.getSavedRepositories();
  const repo = repos.find((r: GitRepository) => r.path === repoPath);
  if (!repo) {
    throw new Error(`Repository not found: ${repoPath}`);
  }
  const repoId = repo.id;

  // Get the active branch from the store, falling back to note.branch
  const activeBranchState = await getActiveBranch(repoId);
  const activeBranch = activeBranchState?.activeBranch ?? branch;

  // Get the working tree path
  const workingTreePath = GitFsService.workingTreeUri({ repoPath });

  return {
    repoPath,
    repoId,
    branch: activeBranch,
    filePath,
    workingTreePath,
  };
}

/**
 * Load paginated file history for a note.
 * Returns history entries with pagination metadata.
 */
export async function loadNoteFileHistory(
  identity: NoteHistoryIdentity,
  page: FileHistoryPage = { limit: DEFAULT_PAGE_SIZE, skip: 0 },
): Promise<{ entries: FileHistoryEntry[]; shallow: boolean; hasMore: boolean }> {
  const { workingTreePath, branch, filePath } = identity;
  const { limit, skip } = page;

  const result = await GitEngine.fileHistory(
    workingTreePath,
    branch,
    filePath,
    limit,
    skip,
  );

  // Deduplicate by commit ID (same commit can appear in multiple pages)
  const seen = new Set<string>();
  const uniqueEntries: FileHistoryEntry[] = [];
  for (const entry of result.entries) {
    if (!seen.has(entry.id)) {
      seen.add(entry.id);
      uniqueEntries.push(entry);
    }
  }

  // hasMore is true only when:
  // - Repository is NOT shallow (shallow clones cannot load more history)
  // - AND we received a full page (entries.length === limit means there might be more)
  // If entries.length < limit, we've exhausted history (got a partial last page)
  const hasMore = !result.shallow && result.entries.length === limit;

  return {
    entries: uniqueEntries,
    shallow: result.shallow,
    hasMore,
  };
}

/**
 * Load blob content at a specific commit.
 * Returns the content or an error result.
 */
export async function loadNoteBlobAtCommit(
  identity: NoteHistoryIdentity,
  commitId: string,
): Promise<BlobReadOutcome> {
  const { workingTreePath, filePath } = identity;

  return GitEngine.readBlobAtRef(workingTreePath, commitId, filePath);
}

/**
 * Resolve note identity and check eligibility in one call.
 * Returns identity if eligible, or { unavailable, reason } if not.
 */
export async function getNoteHistoryIdentityOrUnavailable(
  note: Note,
): Promise<{ available: true; identity: NoteHistoryIdentity } | { available: false; reason: NoteHistoryUnavailableReason }> {
  const eligibility = getNoteHistoryEligibility(note);
  if (eligibility !== null) {
    return { available: false, reason: eligibility };
  }

  try {
    const identity = await resolveNoteHistoryIdentity(note);
    return { available: true, identity };
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    if (msg.includes('Repository not found')) {
      return { available: false, reason: 'NoRepositoryFound' };
    }
    throw err;
  }
}
