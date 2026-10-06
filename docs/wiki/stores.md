# Stores Reference

> All Zustand state stores with their state shape and key actions. See [Architecture](./architecture.md) for how stores relate to services.

## Note Store (`src/stores/noteStore.ts`)

**Purpose:** Manages the notes collection, selection, filtering, and CRUD operations.

**State:**
- `notes: Note[]` — all loaded notes
- `selectedNoteId: string | null` — currently selected note
- `filter: NoteFilter` — active filter (folder, tag, color, search)
- `sortOrder: SortOrder` — current sort (updated, created, title, pin)
- `viewMode: 'list' | 'grid'` — list vs grid display
- `isLoading: boolean`
- `error: string | null`

**Key Actions:** `loadNotes`, `createNote`, `updateNote`, `deleteNote`, `selectNote`, `setFilter`, `setSortOrder`

---

## Todo Store (`src/stores/todoStore.ts`)

**Purpose:** Manages todo items, completion state, and filtering.

**State:**
- `todos: Todo[]`
- `selectedTodoId: string | null`
- `filter: TodoFilter`
- `sortOrder: SortOrder`
- `isLoading: boolean`
- `error: string | null`

**Key Actions:** `loadTodos`, `createTodo`, `updateTodo`, `deleteTodo`, `toggleComplete`, `selectTodo`

---

## Canvas Store (`src/stores/canvasStore.ts`)

**Purpose:** Manages canvas documents and their local-first document lifecycle.

**State:**
- `canvases: Canvas[]`
- `isLoading: boolean`
- `error: string | null`

**Key Actions:** `loadCanvases`, `createCanvas`, `updateCanvas`, `deleteCanvas`, `refreshCanvases`, `clearError`

---

## Chat Store (`src/stores/chatStore.ts`)

**Purpose:** Manages AI chat threads and messages.

**State:**
- `threads: ChatThreadSummary[]` — loaded thread summaries
- `activeThread: ChatThread | null` — currently open thread (null if none)
- `isLoading: boolean`
- `error: string | null`
- `isStreaming: boolean`
- `storageAdapter: ChatStorageAdapter | null`

**Key Actions:** `loadThreads`, `loadThread`, `createThread`, `deleteThread`, `renameThread`, `addMessage`, `updateMessage`, `removeMessage`, `truncateAfter`, `setStreaming`, `clearActiveThread`, `clearError`, `setStorageAdapter`

**Error handling with cached summaries:** When `loadThreads` encounters a `ChatStorageError` with cached data (transient network or 5xx error from `ChatStorageService`), it preserves the cached thread list and surfaces the warning via `error` while still displaying available threads. First-message persistence: new user messages are persisted via `persistPrimedThread` before the assistant response begins streaming.

---

## Repo Store (`src/stores/repoStore.ts`)

**Purpose:** Manages the repository collection, selected repo, and sync state.

**State:**
- `repos: Repo[]`
- `selectedRepoId: string | null`
- `syncState: SyncState` — 'idle' | 'syncing' | 'error'
- `lastSyncAt: number | null`
- `pendingChanges: number`

**Key Actions:** `loadRepos`, `addRepo`, `removeRepo`, `selectRepo`, `triggerSync`

---

## AI Store (`src/stores/aiStore.ts`)

**Purpose:** Configures the active AI provider, model, and chat context.

**State:**
- `provider: AIProvider | null`
- `model: string`
- `chatRepoOwner: string | null`
- `chatRepoName: string | null`
- `isConfigured: boolean`

**Key Actions:** `setProvider`, `setModel`, `setChatContext`

---

## Pro Store (`src/stores/proStore.ts`)

**Purpose:** Manages Pro subscription state, entitlements, and paywall display.

**State:**
- `status: 'loading' | 'pro' | 'free'`
- `entitlementActive: boolean`
- `trialActive: boolean`
- `trialEndsAt: number | null`
- `entitlementExpiresAt: number | null`
- `offeringsReady: boolean`
- `monthlyPackage: PurchasesPackage | null`
- `yearlyPackage: PurchasesPackage | null`
- `lifetimePackage: PurchasesPackage | null`
- `currentOffering: PurchasesOffering | null`
- `isPurchasing: boolean`
- `isRestoring: boolean`
- `error: string | null`
- `interstitialEligible: boolean`
- `configured: boolean`

**Key Actions:**
- `initialize` — configures RevenueCat and resolves entitlement
- `refresh` — re-fetches customer info
- `purchaseMonthly`, `purchaseYearly`, `purchaseLifetime`
- `restore` — restores purchases from App Store
- `loadOfferingsIfNeeded`
- `markInterstitialShown`
- `bindAccount`, `unbindAccount`

**DEV_FORCE_PRO:** In `__DEV__` on iOS Simulator, Pro gate is forced open via `EXPO_PUBLIC_FORCE_ENABLE_PRO_ON_SIMULATOR` env var for QA testing without real IAP.

---

## Account Store (`src/stores/accountStore.ts`)

**Purpose:** Manages user accounts (GitHub, GitLab, etc.) and authentication tokens.

**State:**
- `accounts: Account[]`
- `activeAccountId: string | null`

**Key Actions:** `addAccount`, `removeAccount`, `setActiveAccount`

---

## Folder Store (`src/stores/folderStore.ts`)

**Purpose:** Manages folder tree and folder selection for note organization.

**State:**
- `folders: Folder[]`
- `selectedFolderPath: string | null`
- `expandedFolderIds: string[]`

**Key Actions:** `loadFolders`, `createFolder`, `deleteFolder`, `selectFolder`

---

## Reminder Store (`src/stores/reminderStore.ts`)

**Purpose:** Manages scheduled reminders for notes and todos.

**State:**
- `reminders: Reminder[]`
- `isLoading: boolean`

**Key Actions:** `loadReminders`, `createReminder`, `deleteReminder`, `snoozeReminder`

---

## Template Store (`src/stores/templateStore.ts`)

**Purpose:** Manages note templates.

**State:**
- `templates: Template[]`
- `isLoading: boolean`

**Key Actions:** `loadTemplates`, `createTemplate`, `deleteTemplate`, `applyTemplate`

---

## Render Style Store (`src/stores/renderStyleStore.ts`)

**Purpose:** Manages per-note render style preferences (markdown, rich text, plaintext).

**State:**
- `defaultStyle: RenderStyle`
- `perNoteOverrides: Record<string, RenderStyle>`

**Key Actions:** `setDefaultStyle`, `setNoteOverride`

---

## Conflict Store (`src/stores/conflictStore.ts`)

**Purpose:** Manages sync conflicts requiring user resolution.

**State:**
- `conflicts: Conflict[]`
- `selectedConflictId: string | null`
- `isResolving: boolean`

**Key Actions:** `loadConflicts`, `resolveConflict`, `dismissConflict`

---

## Git Activity Store (`src/stores/gitActivityStore.ts`)

**Purpose:** Tracks recent git operations for display in the UI.

**State:**
- `recentCommits: Commit[]`
- `recentPushes: Push[]`
- `unpushedCount: number`

**Key Actions:** `recordCommit`, `recordPush`, `clearHistory`

---

## Floating Git Button Store (`src/stores/floatingGitButtonStore.ts`)

**Purpose:** Controls visibility and state of the floating git sync button.

**State:**
- `visible: boolean`
- `hydrated: boolean`
- `unpushedCount: number`

**Key Actions:** `show`, `hide`, `hydrate`

---

## Git Operation Store (`src/stores/gitOperationStore.ts`)

**Purpose:** Tracks in-flight git operations for progress display.

**State:**
- `operations: GitOperation[]`
- `isAnyRunning: boolean`

**Key Actions:** `startOperation`, `endOperation`, `cancelOperation`

---

## Draft Store (`src/stores/draftStore.ts`)

**Purpose:** Stores unsaved edits as drafts for recovery.

**State:**
- `drafts: Record<string, string>` — noteId → draft content
- `lastSavedAt: Record<string, number>`

**Key Actions:** `saveDraft`, `loadDraft`, `clearDraft`

---

## AI Hub Store (`src/stores/aiHubStore.ts`)

**Purpose:** Manages AI Hub (multi-provider AI chat) state and picker visibility.

**State:**
- `pickerVisible: boolean`
- `selectedProviders: AIProvider[]`

**Key Actions:** `openPicker`, `closePicker`, `selectProvider`

---

## GitHub Activity Store (`src/stores/githubActivityStore.ts`)

**Purpose:** Tracks GitHub notifications and activity for the Explore screen.

**State:**
- `notifications: GitHubNotification[]`
- `lastFetchedAt: number | null`

**Key Actions:** `fetchNotifications`, `markRead`

---

## Git Button Action Store (`src/stores/gitButtonActionStore.ts`)

**Purpose:** Queues actions triggered by the floating git button (push, pull, sync).

**State:**
- `queuedAction: GitButtonAction | null`
- `isHolding: boolean`
- `holdProgress: number`

**Key Actions:** `queueAction`, `setHolding`, `setProgress`

---

## See Also

- [Services](./services.md) — Business logic layer that updates stores
- [Architecture](./architecture.md) — Overall data flow
- [Screens](./screens.md) — UI components that consume stores
