/**
 * useNoteHistory.ts
 *
 * React hook for note Git history.
 * Provides a stable state machine for loading, ready, empty, unavailable, and error states.
 * Manages pagination, commit selection, and blob loading with proper cleanup on unmount.
 */

import { useCallback, useEffect, useRef, useState } from 'react';
import type { Note } from '../models/Note';
import type {
  NoteHistoryIdentity,
  NoteHistoryState,
  NoteHistoryUnavailableReason,
  FileHistoryEntry,
  BlobReadOutcome,
} from '../services/note/NoteHistoryService';
import {
  getNoteHistoryIdentityOrUnavailable,
  loadNoteFileHistory,
  loadNoteBlobAtCommit,
} from '../services/note/NoteHistoryService';

const PAGE_SIZE = 50;

export interface UseNoteHistoryOptions {
  /** The note to show history for */
  note: Note | null;
  /** Whether the editor has unsaved changes (dirty) */
  isDirty?: boolean;
}

export interface UseNoteHistoryResult {
  /** Current state of the history view */
  state: NoteHistoryState;
  /** Selected commit ID, or null if none selected */
  selectedCommitId: string | null;
  /** Blob content of the selected commit */
  selectedBlob: BlobReadOutcome | null;
  /** Whether a blob load is in progress */
  isLoadingBlob: boolean;
  /** Whether more entries can be loaded */
  hasMore: boolean;
  /** The resolved identity, or null if not available */
  identity: NoteHistoryIdentity | null;
  /** Reason if unavailable, null otherwise */
  unavailableReason: NoteHistoryUnavailableReason | null;
  /** Whether the note has unsaved changes */
  isDirty: boolean;
  /** Load history for the current note */
  loadHistory: () => void;
  /** Select a commit and load its blob */
  selectCommit: (commitId: string) => void;
  /** Load the next page of history */
  loadMore: () => void;
  /** Close the history view and release resources */
  close: () => void;
}

/**
 * Hook for note Git history.
 *
 * Usage:
 * ```
 * const { state, selectCommit, loadMore, close } = useNoteHistory({ note, isDirty });
 * ```
 */
export function useNoteHistory(
  options: UseNoteHistoryOptions,
): UseNoteHistoryResult {
  const { note, isDirty = false } = options;

  // State
  const [state, setState] = useState<NoteHistoryState>({ status: 'idle' });
  const [identity, setIdentity] = useState<NoteHistoryIdentity | null>(null);
  const [unavailableReason, setUnavailableReason] = useState<NoteHistoryUnavailableReason | null>(null);
  const [selectedCommitId, setSelectedCommitId] = useState<string | null>(null);
  const [selectedBlob, setSelectedBlob] = useState<BlobReadOutcome | null>(null);
  const [isLoadingBlob, setIsLoadingBlob] = useState(false);
  const [hasMore, setHasMore] = useState(false);

  // Refs for cleanup / stale request handling
  const historyAbortRef = useRef<AbortionRef | null>(null);
  const blobAbortRef = useRef<AbortionRef | null>(null);
  const entriesRef = useRef<FileHistoryEntry[]>([]);
  const skipRef = useRef(0);

  // Reset when note changes
  useEffect(() => {
    setState({ status: 'idle' });
    setIdentity(null);
    setUnavailableReason(null);
    setSelectedCommitId(null);
    setSelectedBlob(null);
    setIsLoadingBlob(false);
    setHasMore(false);
    entriesRef.current = [];
    skipRef.current = 0;
  }, [note?.id]);

  /**
   * Load history for the current note.
   */
  const loadHistory = useCallback(async () => {
    if (!note) return;

    // Cancel any in-flight request
    historyAbortRef.current?.abort();
    const abort = new AbortionRef();
    historyAbortRef.current = abort;

    // Check eligibility
    const result = await getNoteHistoryIdentityOrUnavailable(note);
    if (abort.aborted) return;

    if (!result.available) {
      setUnavailableReason(result.reason);
      setState({ status: 'unavailable', reason: result.reason });
      setIdentity(null);
      return;
    }

    setIdentity(result.identity);
    setUnavailableReason(null);
    setState({ status: 'loading' });

    // Reset pagination state
    entriesRef.current = [];
    skipRef.current = 0;

    try {
      const historyResult = await loadNoteFileHistory(
        result.identity,
        { limit: PAGE_SIZE, skip: 0 },
      );

      if (abort.aborted) return;

      entriesRef.current = historyResult.entries;
      skipRef.current = historyResult.entries.length;
      setHasMore(historyResult.hasMore);

      if (historyResult.entries.length === 0) {
        setState({ status: 'empty', shallow: historyResult.shallow });
      } else {
        setState({
          status: 'ready',
          entries: historyResult.entries,
          shallow: historyResult.shallow,
          hasMore: historyResult.hasMore,
        });
      }
    } catch (err) {
      if (abort.aborted) return;
      const message = err instanceof Error ? err.message : 'Failed to load history';
      setState({ status: 'error', message });
    }
  }, [note]);

  /**
   * Select a commit and load its blob.
   */
  const selectCommit = useCallback(
    async (commitId: string) => {
      // Cancel any in-flight blob request
      blobAbortRef.current?.abort();

      if (!identity) return;

      setSelectedCommitId(commitId);
      setIsLoadingBlob(true);
      setSelectedBlob(null);

      const abort = new AbortionRef();
      blobAbortRef.current = abort;

      try {
        const blob = await loadNoteBlobAtCommit(identity, commitId);
        if (abort.aborted) return;
        setSelectedBlob(blob);
      } catch (err) {
        if (abort.aborted) return;
        setSelectedBlob({
          kind: 'Error',
          errorKind: 'NativeUnavailable',
          message: err instanceof Error ? err.message : 'Failed to load blob',
        });
      } finally {
        if (!abort.aborted) {
          setIsLoadingBlob(false);
        }
      }
    },
    [identity],
  );

  /**
   * Load the next page of history.
   */
  const loadMore = useCallback(async () => {
    if (!identity || state.status !== 'ready' || !hasMore) return;

    // Cancel any in-flight request
    historyAbortRef.current?.abort();
    const abort = new AbortionRef();
    historyAbortRef.current = abort;

    const currentState = state;
    if (currentState.status !== 'ready') return;

    setState({ ...currentState, status: 'loading' });

    try {
      const historyResult = await loadNoteFileHistory(
        identity,
        { limit: PAGE_SIZE, skip: skipRef.current },
      );

      if (abort.aborted) return;

      // Append deduplicated entries
      const existingIds = new Set(entriesRef.current.map((e) => e.id));
      const newEntries = historyResult.entries.filter(
        (e) => !existingIds.has(e.id),
      );
      entriesRef.current = [...entriesRef.current, ...newEntries];
      skipRef.current = entriesRef.current.length;

      setHasMore(historyResult.hasMore);

      setState({
        status: 'ready',
        entries: entriesRef.current,
        shallow: historyResult.shallow,
        hasMore: historyResult.hasMore,
      });
    }
    // eslint-disable-next-line @typescript-eslint/no-unused-vars
    catch (_err) {
      if (abort.aborted) return;
      // Restore previous state on error
      setState(currentState);
    }
  }, [identity, state, hasMore]);

  /**
   * Close the history view and release resources.
   */
  const close = useCallback(() => {
    // Abort any in-flight requests
    historyAbortRef.current?.abort();
    blobAbortRef.current?.abort();

    // Reset state
    setState({ status: 'idle' });
    setIdentity(null);
    setUnavailableReason(null);
    setSelectedCommitId(null);
    setSelectedBlob(null);
    setIsLoadingBlob(false);
    setHasMore(false);
    entriesRef.current = [];
    skipRef.current = 0;
  }, []);

  // Cleanup on unmount
  useEffect(() => {
    return () => {
      historyAbortRef.current?.abort();
      blobAbortRef.current?.abort();
    };
  }, []);

  return {
    state,
    selectedCommitId,
    selectedBlob,
    isLoadingBlob,
    hasMore,
    identity,
    unavailableReason,
    isDirty,
    loadHistory,
    selectCommit,
    loadMore,
    close,
  };
}

/**
 * Simple abortion helper for tracking request cancellation.
 */
class AbortionRef {
  private _aborted = false;

  get aborted(): boolean {
    return this._aborted;
  }

  abort(): void {
    this._aborted = true;
  }
}
