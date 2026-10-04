import { AuthService } from './AuthService';
import { AccountStorage } from './AccountStorage';
import { setCredential } from './git/engine/GitEngine';
import { pullFromSingleRepo, type PullResult } from './RepoPullService';
import { StorageService } from './StorageService';
import { resolveBranch } from './git/branchResolver';
import { parseRepoPath } from '../utils/gitPathParser';
import { GitFsService, remoteUrlForHost } from './git/GitFsService';
import {
  DEV_BUNDLE_LOAD_RETRY_MESSAGE,
  isDevBundleLoadError,
} from './git/devBundleError';

export type CloneProgressCallback = (phase: string, loaded: number, total: number | null) => void;

export type ImportRepoResult =
  | { ok: true; counts: PullResult }
  | { ok: false; error: string; retryable: boolean };

const EMPTY_REPO_COUNTS: PullResult = { repos: 1, notes: 0, canvases: 0, todos: 0, templates: 0 };

const RETRYABLE_STATUS = new Set([408, 425, 429, 500, 502, 503, 504]);
const NON_RETRYABLE_STATUS = new Set([401, 403, 404, 410]);

const RETRYABLE_MESSAGE =
  /ECONNREFUSED|ECONNRESET|ETIMEDOUT|ENETUNREACH|EHOSTUNREACH|EAI_AGAIN|ENOTFOUND|network|failed to fetch|fetch failed|socket hang up|timed? ?out|offline|temporarily unavailable|packfile trailer mismatch/i;
const NON_RETRYABLE_MESSAGE =
  /invalid repo path|not found|does not exist|was deleted|bad credentials|invalid (token|credentials)|authentication failed|could not read username|permission denied|access denied|revoked/i;

function extractStatusCode(error: unknown): number | undefined {
  const candidate =
    (error as { status?: unknown })?.status ?? (error as { statusCode?: unknown })?.statusCode;
  return typeof candidate === 'number' ? candidate : undefined;
}

function classifyImportError(error: unknown): { message: string; retryable: boolean } {
  const message = error instanceof Error ? error.message : String(error);
  const status = extractStatusCode(error);
  if (status !== undefined) {
    if (RETRYABLE_STATUS.has(status)) return { message, retryable: true };
    if (NON_RETRYABLE_STATUS.has(status)) return { message, retryable: false };
  }
  if (/rate.?limit/i.test(message)) return { message, retryable: true };
  if (/\bHTTP\s+(401|403|404|410)\b/i.test(message)) return { message, retryable: false };
  if (/\bHTTP\s+(408|429|5\d\d)\b/i.test(message)) return { message, retryable: true };
  if (NON_RETRYABLE_MESSAGE.test(message)) return { message, retryable: false };
  if (RETRYABLE_MESSAGE.test(message)) return { message, retryable: true };
  return { message, retryable: true };
}

/**
 * Per-repoPath import dedup. `importRepoAtAdd` acquires NO sync-gate cycle —
 * imports run outside the gate by design (#938) — so concurrent triggers for
 * the same repo (double add paths, add-time import racing a startup pull)
 * share one import run instead of double-cloning / double-pulling. The entry
 * is dropped on settle, so a retry after failure always runs fresh.
 */
const inflightImports = new Map<string, Promise<ImportRepoResult>>();

/**
 * Deterministic content import for a repository right after it is added
 * (#938). Clone mode: resolve the branch with the SAME resolver pullFromSingleRepo
 * uses (never hardcoded 'main'), clone via the deduped
 * `GitFsService.cloneExclusive` (skipped when already cloned — idempotent
 * re-add), then pull through `pullFromSingleRepo` against the local clone.
 *
 * EMPTY repos succeed quietly: a fresh clone of an empty GitHub repo has no
 * refs, so `getCommitOid(refs/heads/<branch>)` is null and we return zero
 * counts WITHOUT pulling (a pull would throw on the ref-less clone).
 */
export function importRepoAtAdd(
  repoPath?: string,
  repoName?: string,
  onProgress?: CloneProgressCallback,
): Promise<ImportRepoResult> {
  if (!repoPath) {
    return Promise.resolve({ ok: false, error: 'Missing repository path', retryable: false });
  }
  const inflight = inflightImports.get(repoPath);
  if (inflight) return inflight;
  const promise = runImport(repoPath, repoName, onProgress).finally(() => {
    inflightImports.delete(repoPath);
  });
  inflightImports.set(repoPath, promise);
  return promise;
}

async function runImport(
  repoPath: string,
  repoName: string | undefined,
  onProgress: CloneProgressCallback | undefined,
): Promise<ImportRepoResult> {
  const label = repoName ?? repoPath;
  try {
    const repos = await StorageService.getSavedRepositories();
    const repo = repos.find((entry) => entry.path === repoPath);
    const branch = await resolveBranch(repoPath, repo?.branch);
    const activeToken = (await AuthService.getToken()) ?? undefined;

    if (!(await GitFsService.isCloned({ repoPath }))) {
      let remoteUrlOverride: string | undefined;
      const hostConnection =
        (repo?.hostId ? await AccountStorage.getHostConnection(repo.hostId) : null) ??
        (await AccountStorage.getActiveHostConnection());
      const token = hostConnection
        ? ((await AccountStorage.getHostToken(hostConnection.id)) ?? undefined)
        : activeToken;
      if (token && repo?.id) {
        await setCredential(repo.id, {
          kind: 'token',
          username: hostConnection?.provider === 'github' ? 'x-access-token' : hostConnection?.hostLogin ?? 'git',
          token,
        });
      }
      if (hostConnection) {
        const useSsh = await AccountStorage.getHostUseSsh(hostConnection.id);
        if (useSsh && repo?.id) {
          const sshKeys = await AccountStorage.getSshKey(hostConnection.id);
          if (sshKeys) {
            await setCredential(repo.id, {
              kind: 'SSH',
              username: 'git',
              privateKey: sshKeys.privateKey,
              publicKey: sshKeys.publicKey,
              passphrase: null,
            });
            const info = parseRepoPath(repoPath);
            if (info) {
              remoteUrlOverride = remoteUrlForHost(info.owner, info.repo, {
                useSsh: true,
                provider: hostConnection.provider,
                instanceBaseUrl: hostConnection.instanceBaseUrl,
              });
            }
          }
        }
      }
      await GitFsService.cloneExclusive({
        repoPath,
        branch,
        token,
        onProgress,
        repoId: repo?.id,
        remoteUrlOverride,
        provider: repo?.provider ?? hostConnection?.provider,
        instanceBaseUrl: hostConnection?.instanceBaseUrl,
      });
    }

    const headOid = await GitFsService.getCommitOid({ repoPath, ref: `refs/heads/${branch}` });
    if (headOid === null) {
      return { ok: true, counts: EMPTY_REPO_COUNTS };
    }
    return { ok: true, counts: await pullFromSingleRepo(repoPath, onProgress) };
  } catch (error) {
    const classified = classifyImportError(error);
    if (isDevBundleLoadError(error)) {
      return { ok: false, error: `${label}: ${DEV_BUNDLE_LOAD_RETRY_MESSAGE}`, retryable: true };
    }
    return { ok: false, error: `${label}: ${classified.message}`, retryable: classified.retryable };
  }
}

/** Test seam — drop all in-flight import dedup entries. */
export function __resetImportDedupForTest(): void {
  inflightImports.clear();
}
