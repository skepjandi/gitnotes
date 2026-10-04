import * as FileSystem from 'expo-file-system/legacy';
import { parseRepoPath } from '../../utils/gitPathParser';
import { makeGitFs as buildGitFs } from './gitFs';
import { gitHttp } from './gitHttp';
import { LocalGitWriter, isCorruptionError } from './LocalGitWriter';
import { getActiveGitHost } from './activeHost';
import type { GitHostUser } from './GitHost';
import { repairHeadRef } from './GitFsService';
import { useGitActivityStore } from '../../stores/gitActivityStore';
import { StorageService } from '../StorageService';
import { AccountStorage } from '../AccountStorage';

// ─── minimal git stub (no-op until Rust engine is wired) ───────────────────
const git = {
  async remove(_opts: { fs: unknown; dir: string; filepath: string }): Promise<void> { /* noop */ },
  async add(_opts: { fs: unknown; dir: string; filepath: string }): Promise<void> { /* noop */ },
  async commit(_opts: {
    fs: unknown; dir: string; message: string; author: { name: string; email: string }; parent?: string[];
  }): Promise<string> { return ''; },
  async currentBranch(_opts: { fs: unknown; dir: string; fullname: boolean }): Promise<string | null> { return null; },
  async checkout(_opts: { fs: unknown; dir: string; ref: string }): Promise<void> { /* noop */ },
  async fetch(_opts: {
    fs: unknown; http: unknown; dir: string; ref: string; singleBranch: boolean; depth: number; tags: boolean; onAuth: unknown;
  }): Promise<void> { /* noop */ },
};

const CLONES_SUBDIR = 'GitNotes/';

function clonesRoot(): string {
  const docDir = FileSystem.documentDirectory;
  if (!docDir) {
    throw new Error('expo-file-system documentDirectory is not available');
  }
  return docDir.endsWith('/') ? docDir + CLONES_SUBDIR : `${docDir}/${CLONES_SUBDIR}`;
}

function repoDirVirtual(owner: string, repo: string): string {
  return `/${owner}/${repo}`;
}

function toRepoRelativePath(filePath: string): string {
  return filePath.replace(/^\/+/, '');
}
function makeRepoFs() {
  return buildGitFs(clonesRoot());
}

function tokenAuth(token: string | undefined) {
  if (!token) return undefined;
  return () => ({ username: 'x-access-token', password: token });
}

export async function resolveStageAuthor(): Promise<{ name: string; email: string }> {
  const activeHost = await getActiveGitHost();
  if (!activeHost) {
    return { name: 'gitnotes', email: '' };
  }

  const remembered = await AccountStorage.getRememberedCommitAuthor(activeHost.hostId);
  if (remembered) {
    return {
      name: remembered.name?.trim() || 'gitnotes',
      email: remembered.email.trim(),
    };
  }

  const user: GitHostUser | null = await activeHost.host.getAuthenticatedUser();
  const login = user?.login?.trim() || 'gitnotes';
  return {
    name: user?.name?.trim() || login,
    email: user?.email?.trim() || '',
  };
}

async function ensureParentDirs(rootDir: string, virtualPath: string): Promise<void> {
  const parts = virtualPath.split('/').filter(Boolean);
  parts.pop();
  let acc = rootDir;
  for (const part of parts) {
    acc = acc + (acc.endsWith('/') ? '' : '/') + part;
    const info = await FileSystem.getInfoAsync(acc);
    if (!info.exists) {
      await FileSystem.makeDirectoryAsync(acc, { intermediates: true });
    }
  }
}

export interface CommitParams {
  repo: string;
  branch: string;
  filePath: string;
  content?: string;
  message: string;
  author?: { name: string; email: string };
  delete?: boolean;
  prevFilePath?: string;
}

export interface CommitResult {
  success: boolean;
  oid?: string;
  error?: string;
}

/**
 * Commit-on-save primitive for clone mode. Replaces the stage-then-push
 * pattern with direct local commits: no push on save, no "staging" layer.
 *
 * - Upsert  (filePath + content, no prevFilePath, no delete): writes file,
 *   stages it, commits locally.
 * - Delete  (delete: true): delegates to LocalGitWriter.deleteAndCommit.
 * - Rename  (prevFilePath + filePath + content): produces ONE commit by
 *   orchestrating the index directly: git.remove(old) → write(new) →
 *   git.add(new) → git.commit.
 *
 * This service handles clone-mode commits.
 */
export class CommitService {
  /**
   * Resolve the author for a commit. Uses the GitHostService to get the
   * authenticated user's name and email. Falls back to 'gitnotes' if
   * no user info is available.
   */
  static async resolveAuthor(): Promise<{ name: string; email: string }> {
    return resolveStageAuthor();
  }

  /**
   * Generate a context-aware commit message for auto-commit operations.
   * Looks up the repo by ID to produce per-repo messages like
   * "Update 3 notes in owner/repo". Falls back to a generic message
   * if the repo is not found.
   */
  static async generateCommitMessage(repoId: string, changedFileCount: number): Promise<string> {
    try {
      const repos = await StorageService.getSavedRepositories();
      const repo = repos.find((r) => r.id === repoId);
      if (repo) {
        return `Update ${changedFileCount} note${changedFileCount !== 1 ? 's' : ''} in ${repo.path}`;
      }
    } catch { /* fall through */ }
    return `Sync: stage ${changedFileCount} file(s)`;
  }

  static async commit(params: CommitParams): Promise<CommitResult> {
    const { repo, branch, filePath, content, message, delete: isDelete, prevFilePath } = params;
    const resolvedAuthor = params.author ?? (await resolveStageAuthor());

    // Delete
    if (isDelete) {
      const result = await LocalGitWriter.deleteAndCommit({
        repoPath: repo,
        branch,
        filePath,
        message,
        author: resolvedAuthor,
        push: false,
      });
      if (!result.success) return { success: false, error: result.error };
      return { success: true };
    }

    if (content === undefined) {
      return { success: false, error: 'content is required for upsert and rename commits' };
    }

    // Rename: prevFilePath + filePath + content → one commit via index orchestration
    if (prevFilePath) {
      return this.commitRename({
        repo,
        branch,
        prevFilePath,
        filePath,
        content,
        message,
        author: resolvedAuthor,
      });
    }

    // Upsert (plain write)
    const result = await LocalGitWriter.writeAndCommit({
      repoPath: repo,
      branch,
      filePath,
      content,
      message,
      author: resolvedAuthor,
      push: false,
    });
    if (!result.success) return { success: false, error: result.error };
    return { success: true };
  }

  /**
   * Produce a single commit that represents a rename: the old path is deleted
   * and the new path is created in one atomic commit via explicit index
   * manipulation. The commit consumes the full index, so both
   * staged changes land in one commit.
   *
   * Sequence:
   * 1. git.remove(prevFilePath) — stages deletion of the old file
   * 2. FileSystem.writeAsStringAsync(newAbsUri, content) — write new file to disk
   * 3. git.add(filePath) — stage the new file
   * 4. git.commit({ message, author }) — commit both staged changes in one commit
   */
  private static async commitRename(opts: {
    repo: string;
    branch: string;
    prevFilePath: string;
    filePath: string;
    content: string;
    message: string;
    author: { name: string; email: string };
  }): Promise<CommitResult> {
    const info = parseRepoPath(opts.repo);
    if (!info) return { success: false, error: `Invalid repo path: ${opts.repo}` };

    const prevRelPath = toRepoRelativePath(opts.prevFilePath);
    const newRelPath = toRepoRelativePath(opts.filePath);

    const dir = repoDirVirtual(info.owner, info.repo);
    const fs = makeRepoFs();
    const fsRoot = clonesRoot();

    try {
      await ensureOnBranch(fs, dir, opts.branch);

      // 1. Stage deletion of the old file
      try {
        await git.remove({ fs, dir, filepath: prevRelPath });
      } catch (removeError) {
        const code = (removeError as { code?: string }).code;
        const errorMsg = removeError instanceof Error ? removeError.message : String(removeError);
        if (code === 'NotFoundError' || code === 'ENOENT') {
          if (isCorruptionError(errorMsg)) throw removeError;
          console.warn('[CommitService] commitRename: old file already gone, skipping remove:', prevRelPath);
        } else {
          throw removeError;
        }
      }

      // 2. Write the new file to disk
      const newAbsVirtual = `${dir}/${newRelPath}`;
      const newAbsUri = `${fsRoot}${newAbsVirtual.replace(/^\//, '')}`;
      await ensureParentDirs(fsRoot, newAbsVirtual);
      await FileSystem.writeAsStringAsync(newAbsUri, opts.content);

      // 3. Stage the new file
      await git.add({ fs, dir, filepath: newRelPath });

      // 4. Commit both staged changes in one commit
      const sha = await git.commit({
        fs,
        dir,
        message: opts.message,
        author: { name: opts.author.name, email: opts.author.email },
      });

      useGitActivityStore.getState().incrementRevision();
      return { success: true, oid: sha };
    } catch (e) {
      const raw = e instanceof Error ? e.message : String(e);
      console.warn('[CommitService] commitRename failed:', raw);
      return { success: false, error: raw };
    }
  }
}

async function ensureOnBranch(
  fs: ReturnType<typeof makeRepoFs>,
  dir: string,
  branch: string,
): Promise<void> {
  await repairHeadRef(fs, dir, branch);

  const current = await git.currentBranch({ fs, dir, fullname: false }).catch(() => null);
  if (current === branch) return;

  try {
    await git.checkout({ fs, dir, ref: branch });
    return;
  } catch {
    // local branch ref is missing - fetch then retry checkout below.
  }

  await git.fetch({
    fs,
    http: gitHttp,
    dir,
    ref: branch,
    singleBranch: true,
    depth: 1,
    tags: false,
    onAuth: tokenAuth(undefined),
  });
  await git.checkout({ fs, dir, ref: branch });
}
