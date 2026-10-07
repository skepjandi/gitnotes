import * as BackgroundTask from 'expo-background-task';
import * as TaskManager from 'expo-task-manager';
import { GitHubService } from './GitHubService';
import { StorageService } from './StorageService';
import { NoteSyncQueueService } from './cloneSyncServiceImpl';
import { pullAllFromRepos } from './RepoPullService';
import { GitSyncGate } from './git/GitSyncGate';
import { NotificationService } from './NotificationService';

const TASK_NAME = 'background-sync';
const MIN_BACKGROUND_INTERVAL_MS = 30 * 60 * 1000;

let taskRegistered = false;
let lastBackgroundPullAt = 0;

// Must live in module-global scope per expo-background-task docs: the OS may
// re-launch the app cold to run the task, and the bundle's top-level code is
// what re-registers the handler.
TaskManager.defineTask(TASK_NAME, async () => {
  try {
    // SECURITY: load token from storage first — on OS cold-launch the
    // singleton hasn't been initialized, so the auth check would silently no-op.
    await GitHubService.initialize();
    if (!(await GitHubService.isAuthenticatedAsync())) {
      return BackgroundTask.BackgroundTaskResult.Success;
    }

    const repos = await StorageService.getSavedRepositories();
    if (repos.length === 0) {
      return BackgroundTask.BackgroundTaskResult.Success;
    }

    // Throttle: skip if less than 30 minutes since last background pull
    if (lastBackgroundPullAt > 0 && Date.now() - lastBackgroundPullAt < MIN_BACKGROUND_INTERVAL_MS) {
      return BackgroundTask.BackgroundTaskResult.Success;
    }

    // ONE cycle spans the drain+pull pair; drain() sees the held cycle and
    // skips its own acquisition (no self-deadlock).
    const releaseCycle = await GitSyncGate.acquireCycle('background');
    try {
      await NoteSyncQueueService.drain();
      const result = await pullAllFromRepos();

      const pulled = result.notes + result.canvases + result.todos + result.templates;
      if (pulled > 0) {
        try {
          await NotificationService.schedulePushProgress(
            'Synced with origin',
            `Pulled ${pulled} changed item(s)`,
            { kind: 'background-pull' },
          );
        } catch (error) {
          console.warn('[BackgroundSync] push-progress notification failed:', error);
        }
      }
    } finally {
      releaseCycle();
    }

    lastBackgroundPullAt = Date.now();
    return BackgroundTask.BackgroundTaskResult.Success;
  } catch (error) {
    console.warn('[BackgroundSync] task failed:', error);
    return BackgroundTask.BackgroundTaskResult.Failed;
  }
});

export async function startBackgroundSync(): Promise<void> {
  if (taskRegistered) return;

  // Throws on builds without the BGTaskScheduler Info.plist entries (Expo Go,
  // dev clients built before the keys were added). Swallow so app boot is not
  // blocked; the periodic sync just won't run in those environments.
  try {
    await BackgroundTask.registerTaskAsync(TASK_NAME);
    taskRegistered = true;
  } catch (error) {
    console.warn('[BackgroundSync] registration unavailable in this build:', error);
  }
}

export async function stopBackgroundSync(): Promise<void> {
  if (!taskRegistered) return;

  try {
    await BackgroundTask.unregisterTaskAsync(TASK_NAME);
  } catch (error) {
    console.warn('[BackgroundSync] failed to unregister:', error);
  }

  taskRegistered = false;
}

export function isBackgroundSyncRegistered(): boolean {
  return taskRegistered;
}
