# Hooks Reference

> All custom React hooks catalogued with purpose. See [Architecture](./architecture.md) for how hooks fit with stores and services.

## Git / Sync Hooks

### `useGitRepoStatus(repoPath?: string)`

**Purpose:** Returns current sync status, pending changes count, last sync time for a repo.

**Returns:** `{ isDirty, unpushedCount, lastSyncAt, isSyncing }`

**Source:** `src/hooks/useGitRepoStatus.ts`

---

### `useGitBusy()`

**Purpose:** Returns whether a git operation is currently in flight (blocks the floating git button).

**Returns:** `boolean`

**Source:** `src/hooks/useGitBusy.ts`

---

### `useForegroundSyncSettings()`

**Purpose:** Returns foreground sync settings — whether auto-sync is enabled, sync interval.

**Returns:** `{ autoSyncEnabled, syncInterval }`

**Source:** `src/hooks/useForegroundSyncSettings.ts`

---

### `useForegroundSyncHealth()`

**Purpose:** Returns health status of foreground sync — any failures, error messages.

**Returns:** `{ hasError, errorMessage, lastErrorAt }`

**Source:** `src/hooks/useForegroundSyncHealth.ts`

---

### `useAllReposStatus()`

**Purpose:** Returns aggregated sync status across all repos — total pending changes, any conflicts.

**Returns:** `{ totalUnpushed, conflictCount, isAnySyncing }`

**Source:** `src/hooks/useAllReposStatus.ts`

---

### `useGitHostQueries()`

**Purpose:** React Query hooks for git host API calls — repo list, branches, commits.

**Returns:** TanStack Query results for `useRepoList`, `useBranches`, `useCommits`, etc.

**Source:** `src/hooks/useGitHostQueries.ts`

---

### `useGitHubQueries()`

**Purpose:** React Query hooks specifically for GitHub API — issues, PRs, notifications.

**Returns:** TanStack Query results for GitHub-specific queries.

**Source:** `src/hooks/useGitHubQueries.ts`

---

### `useBackgroundSync()`

**Purpose:** Manages background sync registration and lifecycle — registers `expo-background-task`.

**Returns:** `{ isRegistered, lastSyncAt }`

**Source:** `src/hooks/useBackgroundSync.ts`

---

## AI / Vision Hooks

### `useProviderAvailability(provider: AIProviderConfig | null | undefined)`

**Purpose:** Probes an AI provider to check availability — configured, credentials valid, quota remaining. Returns an `Availability` result.

**Returns:** `Availability` — `{ kind: 'available' } | { kind: 'unavailable', reason: { code, message } }`

**Source:** `src/hooks/useProviderAvailability.ts`

---

### `useRecognitionIndexing()`

**Purpose:** Wires `RecognizedTextService` to `AIMemoryIndexService` for chat recall — saves, lists, and deletes OCR text indexed from canvas images.

**Returns:** `{ saveRecognition, listRecognitions, deleteRecognition, isLoading, error }`

**Source:** `src/hooks/useRecognitionIndexing.ts`

---

### `useLongPressForVision()`

**Purpose:** Long-press gesture (500ms) on canvas region — composes atlas, encodes tiles to PNG, sends to vision model, stores result in `draftStore` for user accept/discard.

**Returns:** Gesture handler bindings for long-press

**Source:** `src/hooks/useLongPressForVision.ts`

---

## UI / UX Hooks

### `useResponsive()`

**Purpose:** Detects device form factor — phone vs tablet, portrait vs landscape, screen dimensions.

**Returns:** `{ isTablet, isLandscape, screenWidth, screenHeight }`

**Source:** `src/hooks/useResponsive.ts`

---

### `useProGate()`

**Purpose:** Returns Pro status and opens the paywall if a Pro feature is accessed by a free user.

**Returns:** `{ isPro, status, loading, openPaywall }`

**Source:** `src/hooks/useProGate.ts`

---

### `useProScreenGuard(screen: string)`

**Purpose:** Navigates away from a Pro-only screen if user is not Pro. Used to guard Pro screens.

**Returns:** `{ canAccess }`

**Source:** `src/hooks/useProScreenGuard.ts`

---

### `useSafeBack()`

**Purpose:** Safe back navigation — confirms if there are unsaved changes before navigating back.

**Returns:** `() => void` — a single function that safely navigates back; falls back to MainTabs if no previous screen is available.

**Source:** `src/hooks/useSafeBack.ts`

---

### `useSiteArtifact(notes: Note[], config: SiteConfig, debounceMs = 250)`

**Purpose:** Builds the Pro "Publish as website" `SiteArtifact` whenever the notes or site config change, debounced so slider and color edits don't rebuild on every frame. Stale builds are cancelled. `notes` must be referentially stable (memoize it). See [Site Publishing](./site-publishing.md).

**Returns:** `{ artifact: SiteArtifact | null, building: boolean, error: string | null }`

**Source:** `src/hooks/useSiteArtifact.ts`

---

### `useNetworkStatus()`

**Purpose:** Detects current network connectivity status.

**Returns:** `{ isConnected, isExpensive, isInternetReachable }`

**Source:** `src/hooks/useNetworkStatus.ts`

---

## Data / State Hooks

### `useAccounts()`

**Purpose:** Access account store — list of connected GitHub/GitLab/Gitea accounts.

**Returns:** `{ accounts, activeAccount, addAccount, removeAccount }`

**Source:** `src/hooks/useAccounts.ts`

**Note:** This hook is currently a stub — it returns hardcoded `{ accounts: [], activeAccount: null }` without consuming any context. Account management is handled via AccountStorage service directly.
<!-- OMO_INTERNAL_INITIATOR -->

---

### `useEntityFilter<Entity>()`

**Purpose:** Generic hook for filtering entities — notes, todos, canvases.

**Returns:** `{ filtered, setFilter, clearFilter }`

**Source:** `src/hooks/useEntityFilter.ts`

---

### `useEntityList<Entity>(options)`

**Purpose:** Generic hook for loading and managing a list of entities with pagination.

**Returns:** `{ entities, isLoading, error, loadMore, refresh }`

**Source:** `src/hooks/useEntityList.ts`

---

### `useNoteTags(repoPath?: string)`

**Purpose:** Returns all unique tags used in notes for the given repo (for tag autocomplete).

**Returns:** `string[]`

**Source:** `src/hooks/useNoteTags.ts`

---

### `useUndoRedo()`

**Purpose:** Manages undo/redo stack for note editor — stores change history.

**Returns:** `{ undo, redo, canUndo, canRedo, pushChange }`

**Source:** `src/hooks/useUndoRedo.ts`

---

### `useHardWrap()`

**Purpose:** Applies hard word-wrap to text input at a configurable column width.

**Returns:** Text with hard wraps applied

**Source:** `src/hooks/useHardWrap.ts`

---

### `useDailyQuote()`

**Purpose:** Returns today's philosopher quote from `DailyQuoteService`.

**Returns:** `{ quote, author, source, isLoading }`

**Source:** `src/hooks/useDailyQuote.ts`

---

### `useForegroundSyncAlert()`

**Purpose:** Displays an alert when foreground sync encounters a failure.

**Returns:** `{ hasSyncedThisSession }`

**Source:** `src/hooks/useForegroundSyncAlert.ts`

---

### `useGitRefreshEvent()`

**Purpose:** Subscribes to git refresh events (checkout, commit, pull) for reactive UI updates.

**Returns:** `{ lastRefreshAt: number | null }`

**Source:** `src/hooks/useGitRefreshEvent.ts`

---

## See Also

- [Services](./services.md) — Services called by hooks
- [Stores](./stores.md) — Zustand stores accessed by hooks
- [Architecture](./architecture.md) — Hook context
