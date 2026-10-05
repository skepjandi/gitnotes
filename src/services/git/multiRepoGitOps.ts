import * as GitEngine from '@/services/git/engine/GitEngine';
import { GitFsService } from './GitFsService';
import { GitSyncGate } from './GitSyncGate';
import { gitOperationRegistry } from '@/stores/gitOperationStore';
import type { GitRepository } from '@/services/GitService';
import type { Author } from '@/services/git/engine/GitEngine';
import { classifyPushError, type PushErrorKind } from '@/components/git/pushErrors';

export type { PushErrorKind };

export interface RepoOpOutcome {
  repoId: string;
  repoPath: string;
  repoName: string;
  ok: boolean;
  actedCount: number;
  error?: string;
  /** Push-specific failure kind, present when ok === false and the op was a push. */
  failureKind?: PushErrorKind;
}

export interface AggregateOpOutcome {
  outcomes: RepoOpOutcome[];
  totalActed: number;
  failures: RepoOpOutcome[];
  ok: boolean;
}

export async function stageAllPending(
  repos: readonly GitRepository[],
): Promise<AggregateOpOutcome> {
  const outcomes = await Promise.all(
    repos.map(async (repo): Promise<RepoOpOutcome> => {
      try {
        const localPath = GitFsService.workingTreeUri({ repoPath: repo.path });
        const files = await GitEngine.statuses(localPath);
        const toStage = files
          .filter((file) => !file.staged && file.status !== 'Unmodified')
          .map((file) => file.path);
        if (toStage.length === 0) {
          return { repoId: repo.id, repoPath: repo.path, repoName: repo.name, ok: true, actedCount: 0 };
        }
        await GitEngine.stage(localPath, toStage);
        return { repoId: repo.id, repoPath: repo.path, repoName: repo.name, ok: true, actedCount: toStage.length };
      } catch (err) {
        return { repoId: repo.id, repoPath: repo.path, repoName: repo.name, ok: false, actedCount: 0, error: err instanceof Error ? err.message : String(err) };
      }
    }),
  );
  return summarize(outcomes);
}

export async function commitAll(
  repos: readonly GitRepository[],
  message: string,
  author: Author | ((repo: GitRepository) => Author | null | Promise<Author | null>),
): Promise<AggregateOpOutcome> {
  const outcomes = await Promise.all(
    repos.map(async (repo): Promise<RepoOpOutcome> => {
      try {
        const localPath = GitFsService.workingTreeUri({ repoPath: repo.path });
        const files = await GitEngine.statuses(localPath);
        const stagedCount = files.filter((file) => file.staged).length;
        if (stagedCount === 0) {
          return { repoId: repo.id, repoPath: repo.path, repoName: repo.name, ok: true, actedCount: 0 };
        }
        const resolvedAuthor = typeof author === 'function' ? await author(repo) : author;
        if (!resolvedAuthor || !resolvedAuthor.name.trim() || !resolvedAuthor.email.trim()) {
          return {
            repoId: repo.id,
            repoPath: repo.path,
            repoName: repo.name,
            ok: false,
            actedCount: 0,
            error: 'Missing commit author',
          };
        }
        await GitEngine.commit(localPath, message, resolvedAuthor);
        return { repoId: repo.id, repoPath: repo.path, repoName: repo.name, ok: true, actedCount: 1 };
      } catch (err) {
        return { repoId: repo.id, repoPath: repo.path, repoName: repo.name, ok: false, actedCount: 0, error: err instanceof Error ? err.message : String(err) };
      }
    }),
  );
  return summarize(outcomes);
}

export async function pushAll(
  repos: readonly GitRepository[],
): Promise<AggregateOpOutcome> {
  const outcomes = await Promise.all(
    repos.map(async (repo): Promise<RepoOpOutcome> => {
      try {
        const localPath = GitFsService.workingTreeUri({ repoPath: repo.path });
        const status = await GitEngine.status(repo.id, localPath).catch(() => null);
        const preflight = await GitSyncGate.capturePreflight(repo.id, localPath);
        const headOid = preflight?.headOid ?? '';
        const branch = status?.currentBranch ?? preflight?.activeBranch;
        GitSyncGate.markPushActive(repo.id, branch ?? undefined, headOid);
        const registryOpId = gitOperationRegistry.begin({
          kind: 'push',
          repo: repo.id,
          branch: branch ?? undefined,
          entityIds: [],
          attempts: 0,
          status: 'running',
        });
        try {
          const result = await GitEngine.pushWithIntegrate(localPath, 'origin', repo.id);
          if (result.kind === 'Conflicts' || (result.conflicts?.length ?? 0) > 0) {
            gitOperationRegistry.fail(registryOpId, `Push conflicts: ${(result.conflicts ?? []).map((c) => c.path).join(', ')}`);
            const conflictError = new Error(`Push conflicts: ${(result.conflicts ?? []).map((c) => c.path).join(', ')}`);
            return { repoId: repo.id, repoPath: repo.path, repoName: repo.name, ok: false, actedCount: 0, error: conflictError.message, failureKind: 'rejected' };
          }
          const postflightResult = preflight
            ? await GitSyncGate.verifyPostflight(preflight, registryOpId)
            : { ok: true as const };
          if (!postflightResult.ok) {
            const reasonError = new Error(`Branch state changed during push (${postflightResult.reason})`);
            const failure = classifyPushError(reasonError);
            gitOperationRegistry.fail(registryOpId, reasonError.message);
            return { repoId: repo.id, repoPath: repo.path, repoName: repo.name, ok: false, actedCount: 0, error: failure.message, failureKind: failure.kind };
          }
          gitOperationRegistry.succeed(registryOpId);
          const succeeded = result.pushed > 0;
          return { repoId: repo.id, repoPath: repo.path, repoName: repo.name, ok: succeeded, actedCount: result.pushed, error: succeeded ? undefined : result.message };
        } catch (err) {
          gitOperationRegistry.fail(registryOpId, err instanceof Error ? err.message : String(err));
          const failure = classifyPushError(err);
          return { repoId: repo.id, repoPath: repo.path, repoName: repo.name, ok: false, actedCount: 0, error: failure.message, failureKind: failure.kind };
        } finally {
          GitSyncGate.clearPushActive(repo.id, branch ?? undefined);
          if (preflight) GitSyncGate.clearPreflight(repo.id);
        }
      } catch (err) {
        GitSyncGate.releasePushMarker(repo.id);
        return { repoId: repo.id, repoPath: repo.path, repoName: repo.name, ok: false, actedCount: 0, error: err instanceof Error ? err.message : String(err) };
      }
    }),
  );
  return summarize(outcomes);
}

/**
 * Convenience: commit + push in one call. Runs commitAll first; if a repo
 * fails to commit, it is excluded from the push phase. Then pushAll runs across
 * repos that successfully committed. Returns the combined aggregate (sums of
 * actedCount from each phase; failures from either phase land in `failures`).
 */
export async function commitAndPushAll(
  repos: readonly GitRepository[],
  message: string,
  author: Author | ((repo: GitRepository) => Author | null | Promise<Author | null>),
): Promise<AggregateOpOutcome> {
  const commitResult = await commitAll(repos, message, author);
  const successfulRepos = repos.filter((repo) => {
    const outcome = commitResult.outcomes.find((o) => o.repoId === repo.id);
    return outcome?.ok === true;
  });
  const pushResult = successfulRepos.length > 0 ? await pushAll(successfulRepos) : { outcomes: [], totalActed: 0, failures: [], ok: true };
  return {
    outcomes: [...commitResult.outcomes, ...pushResult.outcomes],
    totalActed: commitResult.totalActed + pushResult.totalActed,
    failures: [...commitResult.failures, ...pushResult.failures],
    ok: commitResult.ok && pushResult.ok,
  };
}

function summarize(outcomes: RepoOpOutcome[]): AggregateOpOutcome {
  return {
    outcomes,
    totalActed: outcomes.reduce((sum, o) => sum + o.actedCount, 0),
    failures: outcomes.filter((o) => !o.ok),
    ok: outcomes.every((o) => o.ok),
  };
}
