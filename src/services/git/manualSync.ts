import { pullAllFromRepos, pullFromSingleRepo } from '../RepoPullService';
import { useCanvasStore } from '../../stores/canvasStore';
import { useNoteStore } from '../../stores/noteStore';
import { useTodoStore } from '../../stores/todoStore';
import { GitSyncGate, type CycleSource } from './GitSyncGate';
import { parseRepoPath } from '../../utils/gitPathParser';
import { StorageService } from '../StorageService';
import { telemetryService } from '../TelemetryService';
import type { PullResult } from '../RepoPullService';

/**
 * Single manual-sync entry point ("sync now") for user-facing pulls:
 * pull-to-refresh swipes and the cloud-icon sync button. Acquires the
 * app-wide gate cycle, waits for in-flight push markers to settle, pulls
 * remote state, and refreshes all three stores before releasing the cycle.
 *
 * Reentrancy: exactly one syncNow runs at a time. Overlapping manual
 * calls return `{ok:false, error:'already-running'}` immediately instead
 * of queueing — the gesture already ran once, and stacking another pull
 * behind a long one only adds latency. (Auto paths — ForegroundSync
 * runPull / BackgroundSyncService — keep their own gate-wrapped internals
 * and never route through here.)
 *
 * Callers MUST NOT hold a gate cycle before calling syncNow: it acquires
 * the cycle itself, and a held cycle would make that acquisition queue
 * behind the caller's own lock forever.
 *
 * Timeout: the 60s race rejects with 'Sync timed out', but the cycle work
 * keeps running and holds the cycle until it actually settles — the
 * release lives with the work (mirroring ForegroundSyncService.runPull),
 * never with the race, so a timed-out pull cannot interleave with the
 * next cycle.
 */

export interface SyncNowOptions {
  /** Pull exactly one repo path instead of every tracked repo. */
  repos?: string[];
  /** Cycle origin tag for the blocking-UI gate; user gestures default to 'manual'. */
  source?: CycleSource;
}

export interface SyncNowResult {
  ok: boolean;
  error?: string;
}

const SYNC_TIMEOUT_MS = 60_000;

let running = false;

/** Observable manual-sync activity flag (used by UI guards). */
export function isSyncNowRunning(): boolean {
  return running;
}

/**
 * Wait for in-flight push markers before reading origin. Single-repo syncs
 * wait only on that repo — a push on an unrelated repo never blocks a
 * targeted pull. The all-repos path waits app-wide on ANY marker because
 * it is about to read every repo, and pulling any repo mid-push opens the
 * deleted-note resurrection window. `waitForIdle(false)` (its own 60s
 * budget elapsed) logs and proceeds: a manual sync must remain bounded,
 * and the marker watchdog clears stuck markers within 10 minutes.
 */
async function waitForPushesToSettle(repos?: string[]): Promise<void> {
  const idle =
    repos?.length === 1
      ? await GitSyncGate.waitForIdle(repos[0])
      : await GitSyncGate.waitForIdle();
  if (!idle) {
    console.warn('[Sync] push markers still active after waitForIdle budget; pulling anyway');
  }
}

async function refreshAllStores(): Promise<void> {
  await Promise.all([
    useNoteStore.getState().refreshNotes(),
    useCanvasStore.getState().refreshCanvases(),
    useTodoStore.getState().refreshTodos(),
  ]);
}

async function runSyncCycle(repos: string[] | undefined, source: CycleSource): Promise<PullResult> {
  // ONE cycle acquisition spans the push-settle wait + pull + refresh.
  const releaseCycle = await GitSyncGate.acquireCycle(source);
  try {
    await waitForPushesToSettle(repos);
    if (repos?.length === 1) {
      return await pullFromSingleRepo(repos[0]);
    } else {
      // A multi-repo selection falls back to the all-repos pull — the
      // pull service has no subset path, and pulling everything is the
      // safe superset of any selection.
      return await pullAllFromRepos();
    }
  } finally {
    // Refresh even when the pull failed so the UI reflects whatever made
    // it into storage (partial pulls land before the failure).
    try {
      await refreshAllStores();
    } catch (error) {
      console.warn('[Sync] store refresh failed:', error);
    }
    releaseCycle();
  }
}

async function recordManualHostActions(repoPaths: string[] | undefined, repoCount: number): Promise<void> {
  const savedRepos = await StorageService.getSavedRepositories();
  const selectedRepos = repoPaths?.length === 1
    ? savedRepos.filter((repo) => repo.path === repoPaths[0])
    : savedRepos;
  let recorded = 0;
  for (const repo of selectedRepos) {
    if (!parseRepoPath(repo.path)) continue;
    telemetryService.trackGitHostAction(repo.provider ?? 'github');
    recorded += 1;
    if (recorded === repoCount) break;
  }
}

export async function syncNow(options?: SyncNowOptions): Promise<SyncNowResult> {
  if (running) {
    return { ok: false, error: 'already-running' };
  }
  running = true;

  let timeoutId: ReturnType<typeof setTimeout> | null = null;
  const source = options?.source ?? 'manual';
  try {
    const result = await Promise.race([
      runSyncCycle(options?.repos, source),
      new Promise<never>((_, reject) => {
        timeoutId = setTimeout(() => reject(new Error('Sync timed out')), SYNC_TIMEOUT_MS);
      }),
    ]);
    if (source === 'manual' && result.repos > 0) {
      void recordManualHostActions(options?.repos, result.repos);
    }
    return { ok: true };
  } catch (error) {
    console.warn('[Sync] syncNow failed:', error);
    return { ok: false, error: error instanceof Error ? error.message : 'Sync failed' };
  } finally {
    if (timeoutId !== null) clearTimeout(timeoutId);
    running = false;
  }
}
