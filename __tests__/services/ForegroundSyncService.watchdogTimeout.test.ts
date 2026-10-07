/**
 * Regression test: foreground pull outlives the 60-second watchdog but resolves
 * successfully must be recorded as ok, not timedout.
 */

import { reconcileThoughtDumps } from '@/services/ai/thoughtDumpIndexing';

jest.mock('@/services/ai/thoughtDumpIndexing', () => ({
  reconcileThoughtDumps: jest.fn(),
}));

jest.mock('@/services/GitHubService', () => ({
  GitHubService: {
    isAuthenticated: jest.fn(),
    isAuthenticatedAsync: jest.fn(),
  },
}));

jest.mock('@/services/StorageService', () => ({
  StorageService: { getSavedRepositories: jest.fn() },
}));

jest.mock('@/services/RepoPullService', () => ({
  pullAllFromRepos: jest.fn(),
}));

jest.mock('@react-native-community/netinfo', () => ({
  __esModule: true,
  default: {
    fetch: jest.fn(),
    addEventListener: jest.fn(() => ({ remove: jest.fn() })),
  },
}));

jest.mock('react-native', () => ({
  AppState: {
    addEventListener: jest.fn(() => ({ remove: jest.fn() })),
    currentState: 'active',
  },
}));

jest.mock('@/services/git/GitSyncGate', () => ({
  GitSyncGate: {
    acquireCycle: jest.fn(() => Promise.resolve(jest.fn())),
    __resetForTest: jest.fn(),
  },
}));

import { AppState } from 'react-native';
import NetInfo from '@react-native-community/netinfo';
import { GitHubService } from '@/services/GitHubService';
import { StorageService } from '@/services/StorageService';
import { pullAllFromRepos } from '@/services/RepoPullService';
import { GitSyncGate } from '@/services/git/GitSyncGate';
import {
  __resetForegroundSyncForTest,
  getForegroundSyncHealth,
  __runPullForTest,
} from '@/services/ForegroundSyncService';

const PULL_WATCHDOG_MS = 60_000;

describe('ForegroundSyncService watchdog vs success regression', () => {
  let pullResolve: (value: unknown) => void;
  let pullAllFromReposDeferredPromise: Promise<unknown>;

  beforeEach(() => {
    __resetForegroundSyncForTest();

    pullAllFromReposDeferredPromise = new Promise((resolve) => {
      pullResolve = resolve;
    });

    jest.mocked(GitHubService.isAuthenticated).mockReturnValue(true);
    jest.mocked(GitHubService.isAuthenticatedAsync).mockResolvedValue(true);
    jest.mocked(StorageService.getSavedRepositories).mockResolvedValue([
      { id: 'r1', path: 'me/my-repo', branch: 'main', provider: 'github', hostId: 'h1' },
    ]);
    jest.mocked(NetInfo.fetch).mockResolvedValue({ isInternetReachable: true, isConnected: true });
    jest.mocked(pullAllFromRepos).mockReturnValue(
      pullAllFromReposDeferredPromise as ReturnType<typeof pullAllFromRepos>,
    );
    jest.mocked(reconcileThoughtDumps).mockResolvedValue(undefined);
    jest.mocked(GitSyncGate.acquireCycle).mockResolvedValue(jest.fn());
    jest.mocked(AppState.addEventListener).mockReturnValue({ remove: jest.fn() });

    jest.spyOn(console, 'warn').mockReturnValue();
    jest.spyOn(console, 'log').mockReturnValue();
  });

  afterEach(() => {
    jest.restoreAllMocks();
  });

  it('records pull as ok when pull outlives watchdog but resolves successfully', async () => {
    jest.useFakeTimers();
    try {
      const pullPromise = __runPullForTest('test');

      await jest.advanceTimersByTimeAsync(PULL_WATCHDOG_MS + 1);

      pullResolve!({ repos: 1, notes: 0, canvases: 0, todos: 0, templates: 0 });

      await pullPromise;
      expect(getForegroundSyncHealth().status).toBe('ok');
    } finally {
      jest.useRealTimers();
    }
  });
});
