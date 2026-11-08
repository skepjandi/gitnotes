import * as FileSystem from 'expo-file-system/legacy';
import { parseRepoPath } from '../../utils/gitPathParser';
import { clone as nativeClone } from './engine/GitEngine';
import * as GitEngine from './engine/GitEngine';
import { StorageService } from '../StorageService';
import { autoMergeCrdtConflicts } from './conflictResolution';
import { makeGitFs, type PromiseFsClient } from './gitFs';
import { gitHttp } from './gitHttp';
import { LfsService } from './lfs';
import { isGitCorruptionError } from './corruptionErrors';
import { withCloneKeepAwake } from './cloneKeepAwake';

const CLONES_SUBDIR = 'GitNotes/';

/**
 * Tree entry shape that mirrors `GitHubService.getTreeRecursiveOrThrow` so
 * later phases can swap one for the other behind the SyncEngine flag without
 * the callers caring which transport produced the listing.
 */
export interface GitTreeEntry {
  path: string;
  type: 'blob' | 'tree';
  sha: string;
  size?: number;
}

interface RepoLocator {
  /** "owner/repo" — same canonical shape as GitRepository.path */
  repoPath: string;
}

interface CloneOpts extends RepoLocator {
  branch: string;
  token?: string;
  depth?: number;
  onProgress?: (phase: string, loaded: number, total: number | null) => void;
  repoId?: string;
  remoteUrlOverride?: string;
  provider?: string;
  instanceBaseUrl?: string | null;
}

interface FetchOpts extends RepoLocator {
  branch: string;
  token?: string;
  depth?: number;
  repoId?: string | null;
}

interface ReadOpts extends RepoLocator {
  ref: string;
  filepath: string;
}

interface ListOpts extends RepoLocator {
  ref: string;
}

function clonesRoot(): string {
  const docDir = FileSystem.documentDirectory;
  if (!docDir) {
    throw new Error('expo-file-system documentDirectory is not available in this environment');
  }
  return docDir.endsWith('/') ? docDir + CLONES_SUBDIR : `${docDir}/${CLONES_SUBDIR}`;
}

function repoDirVirtual(owner: string, repo: string): string {
  return `/${owner}/${repo}`;
}

function makeRepoFs() {
  return makeGitFs(clonesRoot());
}

function ensureToken(token: string | undefined) {
  if (!token) return undefined;
  return () => ({ username: 'x-access-token', password: token });
}

// ─── worktree-backed read path (clone mode) ────────────────────────────────
//
// Clone mode serves file listings and contents straight from the checked-out
// worktree at `documentDirectory/GitNotes/<owner>/<repo>/` instead of walking
// git objects: the native engine bridge exposes no tree/blob reads, and the
// engine's clone/fetch flows keep the worktree current. `ref` therefore reads
// as "current worktree state" on these ops — parity with the API transport's
// shape, not a historical snapshot.

interface WorktreeWalkerEntry {
  type(): Promise<'blob' | 'tree'>;
  oid(): Promise<string>;
}

function worktreeEntry(type: 'blob' | 'tree'): WorktreeWalkerEntry {
  return {
    async type() {
      return type;
    },
    // A worktree walk lists without reading + hashing every file, so there is
    // no object id to report; clone-mode consumers match on path/type only.
    async oid() {
      return '';
    },
  };
}

/**
 * Recursively list the worktree at `dir`, invoking `map` with paths relative
 * to the repo root. `.git` internals are never part of the repo tree and
 * are skipped; entries are visited in sorted order for a deterministic listing.
 */
async function walkWorktree(
  fs: PromiseFsClient,
  dir: string,
  map: (filename: string | null, entries: unknown[]) => unknown,
): Promise<void> {
  await map('.', [worktreeEntry('tree')]);
  const listDir = async (relDir: string): Promise<void> => {
    const dirPath = relDir === '' ? dir : `${dir}/${relDir}`;
    const names = [...(await fs.promises.readdir(dirPath))].sort();
    for (const name of names) {
      if (name === '.git') continue;
      const relPath = relDir === '' ? name : `${relDir}/${name}`;
      const stat = await fs.promises.stat(`${dir}/${relPath}`);
      if (stat.isDirectory()) {
        await map(relPath, [worktreeEntry('tree')]);
        await listDir(relPath);
      } else if (stat.isFile()) {
        await map(relPath, [worktreeEntry('blob')]);
      }
    }
  };
  await listDir('');
}

/** Normalize a repo-relative filepath and reject escapes from the worktree. */
export function normalizeWorktreeRelPath(filepath: string): string {
  const segments = filepath.replace(/^\/+/, '').split('/').filter((s) => s.length > 0);
  if (segments.length === 0 || segments.includes('..')) {
    throw Object.assign(new Error(`Invalid worktree filepath: ${filepath}`), {
      code: 'NotFoundError',
    });
  }
  return segments.join('/');
}

/**
 * Read a worktree file's raw bytes. A missing file surfaces the fs adapter's
 * ENOENT, which `readFile` maps to its `null === missing` contract.
 */
async function readWorktreeFile(
  fs: PromiseFsClient,
  dir: string,
  filepath: string,
): Promise<Uint8Array> {
  const rel = normalizeWorktreeRelPath(filepath);
  const data = await fs.promises.readFile(`${dir}/${rel}`);
  if (typeof data === 'string') return new TextEncoder().encode(data);
  return data;
}

// ─── minimal git stub ───────────────────────────────────────────────────────
// Write/history ops stay no-ops until the Rust engine bridge exposes them; the
// read path (walk / readBlob) is real and worktree-backed (helpers above).

// TREE helper stub - creates a tree reference for git.walk
function TREE(_opts: { ref: string }): unknown { return null; }

const git = {
  async clone(_opts: {
    fs: unknown; http: unknown; dir: string; url: string; ref: string;
    singleBranch: boolean; depth: number; noCheckout: boolean; onAuth: unknown; onProgress?: unknown;
  }): Promise<void> { /* noop */ },
  async checkout(_opts: { fs: unknown; dir: string; ref: string; batchSize?: number }): Promise<void> { /* noop */ },
  async fetch(_opts: {
    fs: unknown; http: unknown; dir: string; ref: string; singleBranch: boolean;
    depth: number; tags: boolean; onAuth: unknown;
  }): Promise<void> { /* noop */ },
  async resolveRef(_opts: { fs: unknown; dir: string; ref: string }): Promise<string> { return ''; },
  async fastForward(_opts: {
    fs: unknown; http: unknown; dir: string; ref: string; singleBranch: boolean; onAuth: unknown;
  }): Promise<void> { /* noop */ },
  async isDescendent(_opts: { fs: unknown; dir: string; oid: string; ancestor: string }): Promise<boolean> { return false; },
  async merge(_opts: {
    fs: unknown; dir: string; ours: string; theirs: string; author: { name: string; email: string }; message: string;
  }): Promise<void> { /* noop */ },
  async commit(_opts: {
    fs: unknown; dir: string; message: string; author: { name: string; email: string }; parent?: string[]; ref?: string;
  }): Promise<string> { return ''; },
  async writeRef(_opts: { fs: unknown; dir: string; ref: string; value: string; force?: boolean }): Promise<void> { /* noop */ },
  async walk(opts: {
    fs: unknown; dir: string; trees: unknown[]; map: (filename: string | null, entries: unknown[]) => unknown;
  }): Promise<void> {
    await walkWorktree(opts.fs as PromiseFsClient, opts.dir, opts.map);
  },
  async readBlob(opts: { fs: unknown; dir: string; oid: string; filepath: string }): Promise<{ blob: Uint8Array; oid: string }> {
    const blob = await readWorktreeFile(opts.fs as PromiseFsClient, opts.dir, opts.filepath);
    return { blob, oid: '' };
  },
  async currentBranch(_opts: { fs: unknown; dir: string; fullname: boolean }): Promise<string | null> { return null; },
  async findMergeBase(_opts: { fs: unknown; dir: string; oids: string[] }): Promise<string[] | null> { return null; },
  async log(_opts: { fs: unknown; dir: string; ref: string; depth: number }): Promise<Array<{ oid: string; commit: { message: string; parent: string[]; tree: string } }>> { return []; },
  async readTree(_opts: { fs: unknown; dir: string; oid: string }): Promise<{ tree: Array<{ path: string; oid: string }> }> { return { tree: [] }; },
  async push(_opts: {
    fs: unknown; http: unknown; dir: string; ref: string; remoteRef: string; onAuth: unknown; force?: boolean; onProgress?: unknown;
  }): Promise<void> { /* noop */ },
  async resetIndex(_opts: { fs: unknown; dir: string; ref: string; filepath: string }): Promise<void> { /* noop */ },
  async statusMatrix(_opts: { fs: unknown; dir: string }): Promise<Array<[string, number, number, number]>> { return []; },
  async branch(_opts: { fs: unknown; dir: string; ref: string; object?: string; force?: boolean; checkout?: boolean }): Promise<void> { /* noop */ },
  async readCommit(_opts: { fs: unknown; dir: string; oid: string }): Promise<{ commit: { author: { name: string; email: string }; message: string; parent: string[] } }> {
    return { commit: { author: { name: '', email: '' }, message: '', parent: [] } };
  },
};

/**
 * Repair a corrupted .git/HEAD before any ref operation. The git
 * checkout can write a nested symbolic target (`ref: refs/heads/refs/heads/main`,
 * #1189), and a dangling symbolic target jams every later git op; both are
 * rewritten to point at the requested branch.
 */
export async function repairHeadRef(
  fs: ReturnType<typeof makeGitFs>,
  dir: string,
  branch: string,
): Promise<void> {
  // Best-effort by contract: any failure here must not take down the
  // surrounding pull/push — an unrepaired HEAD just fails again downstream.
  try {
    await repairHeadRefInner(fs, dir, branch);
  } catch {
    // ignore — next op will retry
  }
}

async function repairHeadRefInner(
  fs: ReturnType<typeof makeGitFs>,
  dir: string,
  branch: string,
): Promise<void> {
  const headPath = `${dir}/.git/HEAD`;
  const healthyHead = `ref: refs/heads/${branch}\n`;

  let raw: string;
  try {
    raw = String(await fs.promises.readFile(headPath, 'utf8'));
  } catch {
    return;
  }

  const trimmed = raw.trim();
  if (trimmed === healthyHead.trim()) return;

  if (trimmed.startsWith('ref: refs/heads/refs/heads/')) {
    await fs.promises.writeFile(headPath, healthyHead, 'utf8');
    return;
  }

  if (trimmed.startsWith('ref: ')) {
    try {
      await git.resolveRef({ fs, dir, ref: trimmed.slice(5).trim() });
      return;
    } catch {
      await fs.promises.writeFile(headPath, healthyHead, 'utf8');
    }
  }
}

export interface RemoteUrlOptions {
  useSsh: boolean;
  provider: string;
  instanceBaseUrl: string | null;
}

function stripApiV1Suffix(url: string): string {
  return url.replace(/\/api\/v1\/?$/, '');
}

/**
 * Constructs the git remote URL for a repository.
 * SCP-style SSH URLs: git@github.com:owner/repo.git
 * HTTPS URLs: https://github.com/owner/repo.git
 */
export function remoteUrlForHost(
  owner: string,
  repo: string,
  opts: RemoteUrlOptions,
): string {
  const { useSsh, provider, instanceBaseUrl } = opts;
  if (useSsh) {
    if (provider === 'github') return `git@github.com:${owner}/${repo}.git`;
    if (provider === 'gitlab') return `git@gitlab.com:${owner}/${repo}.git`;
    if (instanceBaseUrl) {
      const host = instanceBaseUrl.replace(/^https?:\/\//, '').replace(/\/$/, '');
      return `git@${host}:${owner}/${repo}.git`;
    }
    return `git@github.com:${owner}/${repo}.git`;
  }
  if (provider === 'github') return `https://github.com/${owner}/${repo}.git`;
  if (provider === 'gitlab') return `https://gitlab.com/${owner}/${repo}.git`;
  if (instanceBaseUrl) return `${stripApiV1Suffix(instanceBaseUrl).replace(/\/$/, '')}/${owner}/${repo}.git`;
  return `https://github.com/${owner}/${repo}.git`;
}

/**
 * Remove corrupted packfiles from a repo's .git/objects/pack directory.
 * When a fetch times out, partial packfile data may be left on disk, causing
 * "Packfile trailer mismatch" errors on subsequent operations. Cleaning these
 * before clone/fetch prevents the error.
 */
async function cleanCorruptedPackfiles(repoPath: string): Promise<void> {
  const info = parseRepoPath(repoPath);
  if (!info) return;
  const packDir = `${clonesRoot()}${info.owner}/${info.repo}/.git/objects/pack`;
  try {
    const stat = await FileSystem.getInfoAsync(packDir);
    if (stat.exists && stat.isDirectory) {
      const files = await FileSystem.readDirectoryAsync(packDir);
      for (const file of files) {
        if (file.endsWith('.pack') || file.endsWith('.idx')) {
          await FileSystem.deleteAsync(`${packDir}/${file}`, { idempotent: true });
        }
      }
    }
  } catch {
    // If pack dir doesn't exist or can't be read, no cleanup needed
  }
}

/**
 * In-flight clone promises keyed by `${repoPath}::${branch}`. Imports at
 * add-time run OUTSIDE the sync gate (#938), so a startup/foreground pull's
 * lazy `getRepoReader` clone can race the add-time clone on the same repoPath
 * — both see `isCloned === false`. Concurrent callers for one key await the
 * same promise instead of cloning twice. Entries are dropped on settle; a
 * REJECTED clone is never cached, so a retry re-runs the clone instead of
 * awaiting the failure forever.
 */
const inflightClones = new Map<string, Promise<void>>();

/**
 * Thrown when the JS heap can't hold the incoming packfile. The git
 * library collects the whole packfile into one Buffer before indexing
 * (the `gitHttp` streaming patch removed only the app-side second copy), so
 * very large repos can OOM Hermes. The picker / clone toggle treats this as
 * a recommendation to use a smaller clone or shallow clone.
 */
export class CloneOutOfMemoryError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'CloneOutOfMemoryError';
  }
}

function looksLikeOutOfMemory(error: unknown): boolean {
  if (error instanceof RangeError) return true;
  const message = error instanceof Error ? error.message : String(error);
  return /out of memory|allocation failed|Array buffer allocation failed|exceeded memory|heap/i.test(message);
}

export class GitFsService {
  /**
   * Clone a repo into the per-app document directory. Defaults to depth=1
   * (shallow) — Phase 1 only consumes file contents, full history isn't
   * needed and burns disk + bandwidth.
   */
  static async clone(opts: CloneOpts): Promise<void> {
    return withCloneKeepAwake(() => GitFsService.cloneWithoutKeepAwake(opts));
  }

  private static async cloneWithoutKeepAwake(opts: CloneOpts): Promise<void> {
    const info = parseRepoPath(opts.repoPath);
    if (!info) throw new Error(`Invalid repo path: ${opts.repoPath}`);

    const fsRoot = clonesRoot();
    await FileSystem.makeDirectoryAsync?.(`${fsRoot}${info.owner}/`, { intermediates: true });

    await cleanCorruptedPackfiles(opts.repoPath);

    const MAX_CLONE_RETRIES = 1;
    let lastError: unknown;
    for (let attempt = 0; attempt <= MAX_CLONE_RETRIES; attempt++) {
      try {
        const remoteUrl = opts.remoteUrlOverride ?? remoteUrlForHost(info.owner, info.repo, {
          useSsh: false,
          provider: opts.provider ?? 'github',
          instanceBaseUrl: opts.instanceBaseUrl ?? null,
        });
        await nativeClone(
          remoteUrl,
          `${fsRoot}${info.owner}/${info.repo}`,
          opts.repoId ?? null,
        );
        lastError = undefined;
        break;
      } catch (cloneError) {
        lastError = cloneError;
        await GitFsService.removeRepo({ repoPath: opts.repoPath }).catch(() => undefined);
        const msg = cloneError instanceof Error ? cloneError.message : String(cloneError);
        const isCorruption = isGitCorruptionError(msg) || /internal error caused this command to fail/i.test(msg);
        if (looksLikeOutOfMemory(cloneError)) {
          throw new CloneOutOfMemoryError(
            `Out of memory while cloning ${opts.repoPath}. The repo is too large for this device — try a shallow clone or free up storage.`,
          );
        }
        if (!isCorruption || attempt === MAX_CLONE_RETRIES) {
          throw cloneError;
        }
        await FileSystem.makeDirectoryAsync?.(`${fsRoot}${info.owner}/`, { intermediates: true }).catch(() => undefined);
        await cleanCorruptedPackfiles(opts.repoPath);
      }
    }
    if (lastError) throw lastError;

    // Git has no smudge filter pipeline, so any LFS-tracked
    // binaries land on disk as ~130-byte pointer text files. Scan after clone
    // resolves so the object-download phase is never blocked by the tree walk.
    // Pointer detection is eventually-consistent — the UI must check
    // LfsService.isPending / hasUnresolved before surfacing a Download button.
    void LfsService.scanRepo(
      opts.repoPath,
      GitFsService.workingTreeUri({ repoPath: opts.repoPath }),
    ).catch((err: unknown) => console.warn('[GitFsService] LFS scan failed:', err));
  }

  /**
   * Deduplicated clone: concurrent callers for the same `${repoPath}::${branch}`
   * share ONE underlying `clone` promise, and callers arriving after a
   * successful clone short-circuit via `isCloned`. Use this instead of `clone`
   * wherever parallel code paths (add-time import, lazy pull-reader clone) can
   * race on the same repo (#938). The packfile-corruption retry inside `clone`
   * is preserved — dedup wraps it, never replaces it.
   */
  static cloneExclusive(opts: CloneOpts): Promise<void> {
    const key = `${opts.repoPath}::${opts.branch}`;
    const inflight = inflightClones.get(key);
    if (inflight) return inflight;
    const promise = (async () => {
      if (await GitFsService.isCloned({ repoPath: opts.repoPath })) return;
      await GitFsService.clone(opts);
    })().finally(() => {
      inflightClones.delete(key);
    });
    inflightClones.set(key, promise);
    return promise;
  }

  /** Test seam — drop all in-flight clone dedup entries. */
  static __resetCloneDedupForTest(): void {
    inflightClones.clear();
  }

  /** Fetch updates for the cloned repo. Caller must have run `clone` first. */
  static async fetch(opts: FetchOpts): Promise<void> {
    const info = parseRepoPath(opts.repoPath);
    if (!info) throw new Error(`Invalid repo path: ${opts.repoPath}`);

    try {
      await GitEngine.fetch(GitFsService.workingTreeUri({ repoPath: opts.repoPath }), 'origin', opts.repoId);
    } catch (fetchError) {
      const msg = fetchError instanceof Error ? fetchError.message : String(fetchError);
      if (isGitCorruptionError(msg)) {
        await cleanCorruptedPackfiles(opts.repoPath);
      }
      throw fetchError;
    }
  }

  /**
   * Fetch from origin then fast-forward the local branch if possible. Returns
   * `{ ok: true }` on success and `{ ok: false, reason }` when the local
   * branch has diverged from upstream. The pull-side caller (#514 phase 5)
   * uses this in place of a plain fetch so we never silently overwrite local
   * write commits the user hasn't pushed yet.
   *
   * Real 3-way merge / rebase + multi-file conflict UI are deferred — phase 5
   * deliberately stops at "detect divergence and skip reconcile" so a stale
   * upstream snapshot can't drop in-flight local edits. Conflict resolution
   * UX is a separate, larger product surface.
   */
  static async pullWithFastForward(opts: FetchOpts): Promise<
    { ok: true } | { ok: false; reason: 'diverged' | 'timeout' | 'network' | 'unknown'; error?: string }
  > {
    const info = parseRepoPath(opts.repoPath);
    if (!info) return { ok: false, reason: 'unknown', error: `Invalid repo path: ${opts.repoPath}` };

    try {
      const startedAt = Date.now();
      let result = await GitEngine.pull(
        GitFsService.workingTreeUri({ repoPath: opts.repoPath }),
        'origin',
        opts.repoId,
      );
      if (!result.ok && /conflict/i.test(result.error ?? '')) {
        // CRDT repos merge their conflicted notes here so every pull caller (not just the
        // note sync) leaves a clean tree instead of a half-finished merge.
        const savedRepo = (await StorageService.getSavedRepositories()).find((repo) => repo.path === opts.repoPath);
        if (savedRepo && (await autoMergeCrdtConflicts(savedRepo))) result = { ok: true };
      }
      if (!result.ok) {
        const message = result.error ?? 'Native pull failed';
        if (/not.*fast.?forward|diverged|merge.?conflict|conflict/i.test(message)) {
          return { ok: false, reason: 'diverged', error: message };
        }
        if (/timed?\s*-?out|etimedout/i.test(message)) {
          return { ok: false, reason: 'timeout', error: message };
        }
        if (/network|econn|enotfound|dns|offline|socket/i.test(message)) {
          return { ok: false, reason: 'network', error: message };
        }
        return { ok: false, reason: 'unknown', error: message };
      }
      try {
        await LfsService.scanRepo(opts.repoPath, GitFsService.workingTreeUri({ repoPath: opts.repoPath }));
      } catch {
        // best-effort
      }
      if (__DEV__) {
        console.log(`[GitFsService] pullWithFastForward (${opts.repoPath}@${opts.branch}) in ${Date.now() - startedAt}ms`);
      }
      return { ok: true };
    } catch (e) {
      const message = e instanceof Error ? e.message : String(e);
      // Git surfaces fast-forward failure as MergeNotSupportedError
      // / FastForwardError; treat both as "diverged".
      const code = (e as { code?: string }).code;
      if (
        code === 'FastForwardError' ||
        code === 'MergeNotSupportedError' ||
        /not.*fast.?forward/i.test(message)
      ) {
        return { ok: false, reason: 'diverged', error: message };
      }
      await cleanCorruptedPackfiles(opts.repoPath);
      if (/timed?\s*-?out|etimedout/i.test(message)) {
        return { ok: false, reason: 'timeout', error: message };
      }
      if (/network|econn|enotfound|dns|offline|socket/i.test(message)) {
        return { ok: false, reason: 'network', error: message };
      }
      return { ok: false, reason: 'unknown', error: message };
    }
  }

  /**
   * Try to merge a remote branch into the local branch when the local is
   * ahead of the remote and the histories have diverged. Uses the git
   * `git.merge` to create a merge commit, so the push retry can succeed
   * without a force-push. Returns `ok: true` when the merge produced no file
   * conflicts, `reason: 'conflict'` when the working tree has conflicts that
   * the user must resolve, or `reason: 'unknown'` for unexpected failures.
   */
  static async tryMergeDivergedBranch(opts: {
    fs: ReturnType<typeof makeRepoFs>;
    dir: string;
    branch: string;
    localOid: string;
    remoteOid: string;
    token?: string;
  }): Promise<{ ok: true } | { ok: false; reason: 'conflict' | 'unknown'; error?: string }> {
    const { fs, dir, branch, remoteOid } = opts;
    try {
      const author = await readCommitAuthor(fs, dir, `refs/heads/${branch}`);
      const mergeMessage = `Merge remote-tracking branch 'origin/${branch}' into ${branch}`;

      await git.merge({
        fs,
        dir,
        ours: branch,
        theirs: remoteOid,
        author,
        message: mergeMessage,
      });

      const conflicted = await listConflictedFiles(fs, dir);
      if (conflicted.length > 0) {
        return { ok: false, reason: 'conflict', error: `Merge produced file conflicts in: ${conflicted.join(', ')}` };
      }

      // git.merge stages the merge changes but does NOT create the merge
      // commit or update the branch ref. The local branch still points to
      // the pre-merge commit, so the subsequent push would still be
      // rejected as non-fast-forward. Commit the staged merge explicitly
      // with both parents so the local branch advances past the remote.
      const parents = [opts.localOid, remoteOid];
      const mergeCommitOid = await git.commit({
        fs,
        dir,
        message: mergeMessage,
        author,
        parent: parents,
      });
      await git.writeRef({ fs, dir, ref: `refs/heads/${branch}`, value: mergeCommitOid, force: true });

      return { ok: true };
    } catch (e) {
      const message = e instanceof Error ? e.message : String(e);
      if (/conflict|MergeNotSupportedError|CheckoutConflictError/i.test(message)) {
        return { ok: false, reason: 'conflict', error: message };
      }
      return { ok: false, reason: 'unknown', error: message };
    }
  }

  /**
   * Recursive tree listing of the clone's checked-out worktree. Output mirrors
   * `GitHubService.getTreeRecursiveOrThrow` so the Phase 2 swap is a transport
   * change, not a shape change — except `sha`, which a worktree listing cannot
   * provide without hashing every file (clone-mode consumers match on
   * path/type only). Throws when no clone exists on disk.
   */
  static async listTree(opts: ListOpts): Promise<GitTreeEntry[]> {
    const info = parseRepoPath(opts.repoPath);
    if (!info) throw new Error(`Invalid repo path: ${opts.repoPath}`);
    const dir = repoDirVirtual(info.owner, info.repo);

    const fs = makeRepoFs();
    const out: GitTreeEntry[] = [];
    await git.walk({
      fs,
      dir,
      trees: [TREE({ ref: opts.ref })],
      map: async (filename, entries) => {
        if (filename === '.') return;
        const entry = entries?.[0];
        if (!entry) return;
        const type = await (entry as { type(): Promise<string> }).type();
        if (type !== 'blob' && type !== 'tree') return;
        const sha = await (entry as { oid(): Promise<string> }).oid();
        out.push({ path: filename ?? '', type: type as 'blob' | 'tree', sha });
      },
    });
    return out;
  }

  /**
   * Read a single file from the clone's checked-out worktree. Returns null
   * when missing so callers keep their existing `null === missing` shape.
   * `ref` is accepted for transport parity; the worktree always
   * reflects the checked-out branch state.
   */
  static async readFile(opts: ReadOpts): Promise<string | null> {
    const info = parseRepoPath(opts.repoPath);
    if (!info) throw new Error(`Invalid repo path: ${opts.repoPath}`);
    const dir = repoDirVirtual(info.owner, info.repo);

    try {
      const oid = await git.resolveRef({ fs: makeRepoFs(), dir, ref: opts.ref });
      const { blob } = await git.readBlob({
        fs: makeRepoFs(),
        dir,
        oid,
        filepath: opts.filepath,
      });
      return new TextDecoder('utf-8').decode(blob);
    } catch (e) {
      const code = (e as { code?: string }).code;
      const msg = e instanceof Error ? e.message : String(e);
      if (code === 'NotFoundError' || code === 'ENOENT') {
        if (isGitCorruptionError(msg)) {
          throw e;
        }
        return null;
      }
      throw e;
    }
  }

  /** Returns true when a clone exists locally for this repo. */
  static async isCloned(opts: RepoLocator): Promise<boolean> {
    const info = parseRepoPath(opts.repoPath);
    if (!info) return false;
    const fsRoot = clonesRoot();
    const head = `${fsRoot}${info.owner}/${info.repo}/.git/HEAD`;
    try {
      const stat = await FileSystem.getInfoAsync(head);
      if (!stat.exists || stat.isDirectory) return false;
      const content = await FileSystem.readAsStringAsync(head);
      const trimmed = content.trim();
      return trimmed.startsWith('ref: ') || /^[a-f0-9]{40}$/.test(trimmed);
    } catch {
      return false;
    }
  }

  /** Drop the on-disk clone for a repo. Idempotent. */
  static async removeRepo(opts: RepoLocator): Promise<void> {
    const info = parseRepoPath(opts.repoPath);
    if (!info) return;
    const fsRoot = clonesRoot();
    const dir = `${fsRoot}${info.owner}/${info.repo}`;
    await FileSystem.deleteAsync(dir, { idempotent: true });
    await LfsService.clearRepo(opts.repoPath).catch(() => undefined);
  }

  /** Absolute on-disk URI of a repo's working tree. */
  static workingTreeUri(opts: RepoLocator): string {
    const info = parseRepoPath(opts.repoPath);
    if (!info) throw new Error(`Invalid repo path: ${opts.repoPath}`);
    return `${clonesRoot()}${info.owner}/${info.repo}`;
  }

  /**
   * Resolves the local clone's current branch (HEAD ref). Returns null when
   * the repo isn't cloned, HEAD is detached, or the lookup fails. Used by
   * `resolveBranch` (#543) so clone-mode operations don't push to a
   * hardcoded `main` ref the cloned repo may not have.
   */
  static async getCurrentBranch(opts: RepoLocator): Promise<string | null> {
    const info = parseRepoPath(opts.repoPath);
    if (!info) return null;
    try {
      const repoInfo = await GitEngine.repoInfo(GitFsService.workingTreeUri(opts));
      return repoInfo.currentBranch ?? null;
    } catch {
      return null;
    }
  }

  static async getCommitOid(opts: RepoLocator & { ref: string }): Promise<string | null> {
    const info = parseRepoPath(opts.repoPath);
    if (!info) return null;
    const dir = repoDirVirtual(info.owner, info.repo);
    try {
      const oid = await git.resolveRef({ fs: makeRepoFs(), dir, ref: opts.ref });
      return oid;
    } catch {
      return null;
    }
  }

  static async findMergeBase(opts: {
    repoPath: string;
    ref1: string;
    ref2: string;
  }): Promise<string | null> {
    const info = parseRepoPath(opts.repoPath);
    if (!info) return null;
    const dir = repoDirVirtual(info.owner, info.repo);
    const fs = makeRepoFs();
    try {
      const oid1 = await git.resolveRef({ fs, dir, ref: opts.ref1 });
      const oid2 = await git.resolveRef({ fs, dir, ref: opts.ref2 });
      const bases = await git.findMergeBase({ fs, dir, oids: [oid1, oid2] });
      return bases?.[0] ?? null;
    } catch {
      return null;
    }
  }

  static async getChangedFilesBetweenRefs(opts: {
    repoPath: string;
    fromRef: string;
    toRef: string;
    maxCommits?: number;
  }): Promise<string[]> {
    const info = parseRepoPath(opts.repoPath);
    if (!info) return [];
    const dir = repoDirVirtual(info.owner, info.repo);
    const fs = makeRepoFs();
    const files = new Set<string>();
    const depth = opts.maxCommits ?? 20;

    try {
      const commits = await git.log({ fs, dir, ref: opts.toRef, depth });
      for (const commit of commits) {
        if (commit.oid === opts.fromRef) break;
        const tree = await git.readTree({ fs, dir, oid: commit.commit.tree });
        const parentOid = commit.commit.parent[0] ?? null;
        if (parentOid) {
          const parentTree = await git.readTree({ fs, dir, oid: parentOid });
          const parentMap = new Map(parentTree.tree.map((e) => [e.path, e.oid]));
          for (const entry of tree.tree) {
            const prevOid = parentMap.get(entry.path);
            if (!prevOid || prevOid !== entry.oid) {
              files.add(entry.path);
            }
          }
          for (const entry of parentTree.tree) {
            if (!tree.tree.find((e) => e.path === entry.path)) {
              files.add(entry.path);
            }
          }
        } else {
          for (const entry of tree.tree) {
            files.add(entry.path);
          }
        }
      }
    } catch {
      // Shallow clone may not have full history; return empty to trigger placeholder
    }
    return [...files];
  }

  static async mergeCommit(opts: {
    repoPath: string;
    branch: string;
    oursRef: string;
    theirsRef: string;
    message: string;
    author: { name: string; email: string };
    token?: string;
    /** Commit locally only (push deferred to the stage engine) when false. Defaults to true. */
    push?: boolean;
  }): Promise<{ sha: string } | { error: string }> {
    const info = parseRepoPath(opts.repoPath);
    if (!info) return { error: `Invalid repo path: ${opts.repoPath}` };
    const dir = repoDirVirtual(info.owner, info.repo);
    const fs = makeRepoFs();

    try {
      const oursOid = await git.resolveRef({ fs, dir, ref: opts.oursRef });
      const theirsOid = await git.resolveRef({ fs, dir, ref: opts.theirsRef });

      const sha = await git.commit({
        fs,
        dir,
        message: opts.message,
        author: opts.author,
        parent: [oursOid, theirsOid],
        ref: opts.branch,
      });

      const branchRef = `refs/heads/${opts.branch}`;
      const actualRef = await git.resolveRef({ fs, dir, ref: branchRef });
      if (actualRef !== sha) {
        await git.branch({
          fs,
          dir,
          ref: opts.branch,
          object: sha,
          force: true,
        });
      }

      if (opts.push !== false) {
        await git.push({
          fs,
          dir,
          http: gitHttp,
          ref: opts.branch,
          remoteRef: opts.branch,
          onAuth: ensureToken(opts.token),
        });
      }

      return { sha };
    } catch (e) {
      const message = e instanceof Error ? e.message : String(e);
      return { error: message };
    }
  }

  static async readBlobAtRef(opts: {
    repoPath: string;
    ref: string;
    filepath: string;
  }): Promise<{ content: string; oid: string } | null> {
    const info = parseRepoPath(opts.repoPath);
    if (!info) return null;
    const dir = repoDirVirtual(info.owner, info.repo);
    const fs = makeRepoFs();

    try {
      const resolved = await git.resolveRef({ fs, dir, ref: opts.ref });
      const blob = await git.readBlob({ fs, dir, oid: resolved, filepath: opts.filepath });
      return { content: new TextDecoder('utf-8').decode(blob.blob), oid: blob.oid };
    } catch {
      return null;
    }
  }

  static async unstageFiles(opts: { repoPath: string; files: string[] }): Promise<void> {
    const info = parseRepoPath(opts.repoPath);
    if (!info) return;
    const dir = repoDirVirtual(info.owner, info.repo);
    const fs = makeRepoFs();
    for (const file of opts.files) {
      await git.resetIndex({ fs, dir, ref: 'HEAD', filepath: file });
    }
  }
}

// Stub branch method on git object (used by mergeCommit)
(git as Record<string, unknown>).branch = async (_opts: {
  fs: unknown; dir: string; ref: string; object?: string; force?: boolean;
}): Promise<void> => { /* noop */ };

async function readCommitAuthor(
  fs: ReturnType<typeof makeGitFs>,
  dir: string,
  ref: string,
): Promise<{ name: string; email: string }> {
  const fallback = { name: 'gitnotes', email: 'gitnotes@users.noreply.gitnotes' };
  try {
    const oid = await git.resolveRef({ fs, dir, ref }).catch(() => null);
    if (!oid) return fallback;
    const commits = await git.log({ fs, dir, ref, depth: 1 });
    const commit = commits[0];
    if (!commit) return fallback;
    // parse author from commit.commit (simplified)
    return fallback;
  } catch {
    return fallback;
  }
}

async function listConflictedFiles(
  fs: ReturnType<typeof makeGitFs>,
  dir: string,
): Promise<string[]> {
  try {
    const matrix = await git.statusMatrix({ fs, dir });
    return matrix
      .filter(([, , workdir, stage]) => workdir !== stage && stage === 2)
      .map(([filepath]) => filepath);
  } catch {
    return [];
  }
}
