import { AppState, type AppStateStatus, type NativeEventSubscription } from 'react-native';
import NetInfo, { type NetInfoSubscription } from '@react-native-community/netinfo';
import { GitHubService } from './GitHubService';
import { StorageService } from './StorageService';
import { pullAllFromRepos } from './RepoPullService';
import { reconcileThoughtDumps } from './ai/thoughtDumpIndexing';
import { GitSyncGate } from './git/GitSyncGate';
import { __recordAndMaybePrompt } from './ReviewPromptService';

/**
 * Foreground auto-pull driver: pulls every tracked repo when the app becomes
 * active, when network transitions offline → online, and on a configurable
 * interval while the app is in the foreground. This complements
 * `BackgroundSyncService` (which runs at OS-scheduled intervals) and is the
 * mitigation for issue #563 — multi-device users no longer have to pull-to-
 * refresh every time they switch phones.
 *
 * All triggers funnel through `runPull()`, which:
 *   - skips if no GitHub token / no repos
 *   - skips if offline (`NetInfo.fetch()`)
 *   - coalesces overlapping triggers via `inFlight` and a 2-second debounce
 *     so that AppState→active and online→online firing together don't queue
 *     two pulls back-to-back
 *   - backs off after failures to prevent continuous UI blocking
 */

const COALESCE_WINDOW_MS = 2000;
const SKIP_LOG_THROTTLE_MS = 10_000;
const SKIP_BACKOFF_MAX_MS = 120_000;
const FIXED_INTERVAL_MS = 30 * 60 * 1000;

type Listener = () => void;

let appStateSub: NativeEventSubscription | null = null;
let netInfoUnsub: NetInfoSubscription | null = null;
let intervalHandle: ReturnType<typeof setTimeout> | null = null;

let inFlight = false;
let pendingBackgroundWork = false;
let backgroundWork: Promise<void> | null = null;
let externalSyncCount = 0;
let lastRunAt = 0;

let currentSyncPaused = false;

let lastNetReachable: boolean | null = null;
let lastAppState: AppStateStatus = AppState.currentState;

let consecutiveFailures = 0;
let lastFailedAt = 0;
const BASE_BACKOFF_MS = 30_000;
const MAX_BACKOFF_MS = 300_000;

export type ForegroundSyncHealthStatus = 'idle' | 'syncing' | 'ok' | 'failed' | 'timedout';

export interface ForegroundSyncHealth {
  status: ForegroundSyncHealthStatus;
  lastRunAt: number;
  lastCompletedAt: number;
  lastFailedAt: number;
  consecutiveFailures: number;
}

const INITIAL_HEALTH: ForegroundSyncHealth = {
  status: 'idle',
  lastRunAt: 0,
  lastCompletedAt: 0,
  lastFailedAt: 0,
  consecutiveFailures: 0,
};

let health: ForegroundSyncHealth = { ...INITIAL_HEALTH };

// Busy-skip state: consecutive interval cycles that find a pull still in
// flight (or a timed-out pull still pending) grow the next-check delay
// exponentially with jitter, and the skip log line is throttled, so a stuck
// pull can't turn into a console-spamming busy-loop (#984).
let consecutiveSkips = 0;
let lastSkipLogAt = 0;

const listeners = new Set<Listener>();

function notify(): void {
  for (const listener of listeners) {
    try {
      listener();
    } catch (error) {
      console.warn('[ForegroundSync] listener failed:', error);
    }
  }
}

function logSkip(reason: string, detail: string): void {
  if (!__DEV__) return;
  const now = Date.now();
  if (now - lastSkipLogAt < SKIP_LOG_THROTTLE_MS) return;
  lastSkipLogAt = now;
  console.log(`[ForegroundSync] skip (${reason}): ${detail}`);
}

function markBusySkip(reason: string, detail: string): void {
  consecutiveSkips++;
  logSkip(reason, detail);
}

async function shouldPull(): Promise<boolean> {
  if (!(await GitHubService.isAuthenticatedAsync())) return false;
  const repos = await StorageService.getSavedRepositories();
  if (repos.length === 0) return false;
  const net = await NetInfo.fetch();
  const reachable = net.isInternetReachable ?? net.isConnected ?? false;
  return reachable;
}

const PULL_WATCHDOG_MS = 60_000;

async function runPull(reason: string): Promise<void> {
  if (currentSyncPaused) {
    logSkip(reason, 'paused');
    return;
  }
  if (inFlight) {
    markBusySkip(reason, 'already in flight');
    return;
  }
  if (pendingBackgroundWork) {
    markBusySkip(reason, 'background work still pending');
    return;
  }
  if (Date.now() - lastRunAt < COALESCE_WINDOW_MS) {
    logSkip(reason, 'coalesce window');
    return;
  }
  if (!(await shouldPull())) {
    logSkip(reason, 'shouldPull=false');
    return;
  }

  if (consecutiveFailures > 0) {
    const backoffMs = Math.min(BASE_BACKOFF_MS * Math.pow(2, consecutiveFailures - 1), MAX_BACKOFF_MS);
    if (Date.now() - lastFailedAt < backoffMs) {
      logSkip(reason, `backoff ${Math.round(backoffMs / 1000)}s`);
      return;
    }
  }

  consecutiveSkips = 0;
  inFlight = true;
  lastRunAt = Date.now();
  health = { ...health, status: 'syncing', lastRunAt };
  notify();

  let watchdogTimedOut = false;
  let watchdog: ReturnType<typeof setTimeout> | null = null;
  let pullTimeout: ReturnType<typeof setTimeout> | null = null;
  watchdog = setTimeout(() => {
    watchdogTimedOut = true;
    console.warn(`[ForegroundSync] pull (${reason}) exceeded ${PULL_WATCHDOG_MS}ms`);
  }, PULL_WATCHDOG_MS);

  const startedAt = Date.now();
  let success = false;
  const PULL_TIMEOUT_MS = 600_000;
  backgroundWork = (async () => {
    // ONE cycle acquisition spans the pull; the release lives with the work
    // itself, not the timeout race below, so a timed-out pull keeps owning
    // the cycle until it actually settles.
    const releaseCycle = await GitSyncGate.acquireCycle('startup');
    try {
      await pullAllFromRepos();
    } finally {
      releaseCycle();
    }
  })().finally(() => {
    pendingBackgroundWork = false;
    backgroundWork = null;
  });
  try {
    await Promise.race([
      backgroundWork,
      new Promise<void>((_, reject) => {
        pullTimeout = setTimeout(
          () => {
            pendingBackgroundWork = true;
            reject(new Error(`Pull timed out after ${PULL_TIMEOUT_MS}ms`));
          },
          PULL_TIMEOUT_MS,
        );
      }),
    ]);
    success = true;
    if (__DEV__) {
      console.log(`[ForegroundSync] pull (${reason}) ok in ${Date.now() - startedAt}ms`);
    }
    void reconcileThoughtDumps().catch((err) => {
      if (__DEV__) console.warn('[ForegroundSync] thought dump reconcile failed:', err);
    });
  } catch (error) {
    console.warn(`[ForegroundSync] pull (${reason}) failed after ${Date.now() - startedAt}ms:`, error);
  } finally {
    if (watchdog !== null) clearTimeout(watchdog);
    if (pullTimeout !== null) clearTimeout(pullTimeout);
    inFlight = false;
    lastRunAt = Date.now();
    if (success) {
      consecutiveFailures = 0;
      health = { ...health, status: 'ok', lastCompletedAt: Date.now(), consecutiveFailures: 0 };
      void __recordAndMaybePrompt('sync');
    } else {
      consecutiveFailures++;
      lastFailedAt = Date.now();
      health = {
        ...health,
        status: watchdogTimedOut ? 'timedout' : 'failed',
        lastFailedAt: Date.now(),
        consecutiveFailures,
      };
    }
    notify();
  }
}

function scheduleIntervalTick(): void {
  if (intervalHandle) {
    clearTimeout(intervalHandle);
    intervalHandle = null;
  }
  if (lastAppState !== 'active') return;

  const baseMs = FIXED_INTERVAL_MS;
  const busyBackoffMs =
    consecutiveSkips > 0
      ? Math.min(baseMs * Math.pow(2, consecutiveSkips), SKIP_BACKOFF_MAX_MS)
      : baseMs;
  const jitteredDelayMs = Math.round(busyBackoffMs * (0.9 + Math.random() * 0.2));

  intervalHandle = setTimeout(() => {
    intervalHandle = null;
    void runPull('interval').finally(() => {
      scheduleIntervalTick();
    });
  }, jitteredDelayMs);
}

function restartInterval(): void {
  if (intervalHandle) {
    clearTimeout(intervalHandle);
    intervalHandle = null;
  }
  consecutiveSkips = 0;
  scheduleIntervalTick();
}

function handleAppStateChange(state: AppStateStatus): void {
  const wasInactive = lastAppState !== 'active';
  lastAppState = state;
  if (state === 'active') {
    if (wasInactive) {
      void runPull('appstate-active');
    }
    restartInterval();
  } else if (intervalHandle) {
    clearTimeout(intervalHandle);
    intervalHandle = null;
  }
}

function handleNetInfo(reachable: boolean): void {
  // SECURITY: don't pull while backgrounded — the OS suspends JS mid-pull,
  // leaving inFlight stuck true and the cycle held for ~10 minutes.
  if (lastAppState !== 'active') return;
  const cameOnline = lastNetReachable === false && reachable === true;
  lastNetReachable = reachable;
  if (cameOnline) void runPull('online');
}

/** Debug/testing escape hatch (#1174): stops every automatic pull trigger. */
export function isForegroundSyncPaused(): boolean {
  return currentSyncPaused;
}

export interface ForegroundSyncConfig {
  syncPaused?: boolean;
}

export function startForegroundWatcher(config: ForegroundSyncConfig): void {
  currentSyncPaused = config.syncPaused ?? false;

  if (!appStateSub) {
    appStateSub = AppState.addEventListener('change', handleAppStateChange);
  }
  if (!netInfoUnsub) {
    netInfoUnsub = NetInfo.addEventListener((state) => {
      const reachable = state.isInternetReachable ?? state.isConnected ?? false;
      handleNetInfo(reachable);
    });
    NetInfo.fetch()
      .then((state) => {
        lastNetReachable = state.isInternetReachable ?? state.isConnected ?? false;
      })
      .catch(() => undefined);
  }

  restartInterval();
}

export function updateForegroundWatcherConfig(config: ForegroundSyncConfig): void {
  currentSyncPaused = config.syncPaused ?? false;
  restartInterval();
}

export function stopForegroundWatcher(): void {
  if (appStateSub) {
    appStateSub.remove();
    appStateSub = null;
  }
  if (netInfoUnsub) {
    netInfoUnsub();
    netInfoUnsub = null;
  }
  if (intervalHandle) {
    clearTimeout(intervalHandle);
    intervalHandle = null;
  }
  lastNetReachable = null;
  lastAppState = AppState.currentState;
}

export function isForegroundSyncInFlight(): boolean {
  return inFlight || externalSyncCount > 0;
}

export function getForegroundSyncHealth(): ForegroundSyncHealth {
  return { ...health };
}

export function acquireExternalSync(): () => void {
  externalSyncCount++;
  if (externalSyncCount === 1) {
    notify();
  }
  let released = false;
  return () => {
    if (released) return;
    released = true;
    externalSyncCount--;
    if (externalSyncCount === 0) {
      notify();
    }
  };
}

export function subscribeForegroundSync(listener: Listener): () => void {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

export async function __runPullForTest(reason = 'test'): Promise<void> {
  await runPull(reason);
}

export function __resetForegroundSyncForTest(): void {
  stopForegroundWatcher();
  GitSyncGate.__resetForTest();
  inFlight = false;
  pendingBackgroundWork = false;
  backgroundWork = null;
  externalSyncCount = 0;
  lastRunAt = 0;
  currentSyncPaused = false;
  consecutiveFailures = 0;
  lastFailedAt = 0;
  consecutiveSkips = 0;
  lastSkipLogAt = 0;
  health = { ...INITIAL_HEALTH };
  listeners.clear();
}
