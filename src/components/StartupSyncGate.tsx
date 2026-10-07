import React, { useEffect, useMemo, useRef } from 'react';
import { AppState } from 'react-native';
import { GitHubService } from '../services/GitHubService';
import {
  isForegroundSyncInFlight,
  isForegroundSyncPaused,
  subscribeForegroundSync,
  acquireExternalSync,
} from '../services/ForegroundSyncService';
import { syncNow } from '../services/git/manualSync';
import { useNotes } from '../contexts/NoteContext';
import { useCanvases } from '../contexts/CanvasContext';
import { useTodos } from '../contexts/TodoContext';
import { useRepos } from '../contexts/RepoContext';

export function StartupSyncGate({ children }: { children: React.ReactNode }) {
  const { refreshNotes } = useNotes();
  const { refreshCanvases } = useCanvases();
  const { refreshTodos } = useTodos();
  const { repositories } = useRepos();
  const lastSyncedSignature = useRef<string | null>(null);
  const isSyncing = useRef(false);

  // Track repository identity (sorted set of paths), not just length.
  // Previously the count-based guard meant remove+re-add or swapping
  // never re-triggered a pull because length didn't grow.
  const repoSignature = useMemo(
    () => [...repositories.map((r) => r.path)].sort().join('|'),
    [repositories],
  );

  useEffect(() => {
    if (isSyncing.current) return;
    if (lastSyncedSignature.current === repoSignature) return;
    if (repositories.length === 0) {
      lastSyncedSignature.current = repoSignature;
      return;
    }
    if (isForegroundSyncInFlight()) return;

    isSyncing.current = true;
    const releaseExternalSync = acquireExternalSync();
    const targetSignature = repoSignature;

    (async () => {
      try {
        // initialize() must stay before the pull; do NOT hold a gate cycle
        // here — syncNow acquires it internally and would deadlock otherwise.
        await GitHubService.initialize();
        await syncNow({ source: 'startup' });
      } catch (error) {
        console.warn('[StartupSync] Pull failed:', error);
      } finally {
        await Promise.all([
          refreshNotes(),
          refreshCanvases(),
          refreshTodos(),
        ]);
        lastSyncedSignature.current = targetSignature;
        isSyncing.current = false;
        releaseExternalSync();
      }
    })();
  }, [repoSignature, repositories.length, refreshNotes, refreshCanvases, refreshTodos]);

  useEffect(() => {
    let drainInFlight = false;
    const drainAndPull = async () => {
      if (drainInFlight) return;
      if (isSyncing.current) return;
      if (isForegroundSyncPaused()) return;
      if (isForegroundSyncInFlight()) return;
      drainInFlight = true;
      const releaseExternalSync = acquireExternalSync();
      try {
        await GitHubService.initialize();
        if (!(await GitHubService.isAuthenticatedAsync())) return;
        // Do NOT wrap this in a gate cycle: syncNow acquires the cycle
        // itself, and holding one here would deadlock its acquisition.
        // 'startup' keeps these auto-pulls non-blocking for the sync UI.
        await syncNow({ source: 'startup' });
      } catch (error) {
        console.warn('[SyncDrain] Failed:', error);
      } finally {
        drainInFlight = false;
        releaseExternalSync();
      }
    };

    drainAndPull();
    const sub = AppState.addEventListener('change', (state) => {
      if (state === 'active' && !isSyncing.current && !isForegroundSyncInFlight()) drainAndPull();
    });
    return () => sub.remove();
  }, [refreshNotes]);

  // Refresh React state whenever the foreground auto-pull completes a tick
  // (#620 / #623). Without this, the periodic 60s pull and the AppState
  // pull both write fresh data to AsyncStorage but the in-memory notes /
  // todos / canvases arrays stay stale until the next manual pull-to-
  // refresh or cold launch — which is what the user observed as "auto-
  // sync doesn't work."
  useEffect(() => {
    let lastSeenInFlight = isForegroundSyncInFlight();
    return subscribeForegroundSync(() => {
      const nowInFlight = isForegroundSyncInFlight();
      // Only refresh on the trailing edge (true → false), i.e. the pull
      // just finished. Skipping the leading edge avoids a double-refresh
      // and a flicker before the new data is committed to storage.
      if (lastSeenInFlight && !nowInFlight) {
        void Promise.all([refreshNotes(), refreshCanvases(), refreshTodos()]).catch((error) => {
          console.warn('[StartupSync] post-foregroundsync refresh failed:', error);
        });
      }
      lastSeenInFlight = nowInFlight;
    });
  }, [refreshNotes, refreshCanvases, refreshTodos]);

  return <>{children}</>;
}
