# Services Reference

> Every service file in `src/services/` catalogued with its purpose. Grouped by domain. See [Architecture](./architecture.md) for how these fit together.

## Git / Clone Operations (`src/services/git/`)

### Host Services

| File | Purpose |
|------|---------|
| `GitHost.ts` | Core host interface — abstract interface defining clone/push/pull/fetch/commit operations. All host services implement this. |
| `GitHubHostService.ts` | GitHub-specific implementation of GitHost. Handles GitHub API authentication, rate limits, and GitHub-specific sync logic. |
| `GitLabService.ts` | GitLab-specific implementation of GitHost. Handles GitLab API authentication and GitLab sync logic. |
| `GiteaLikeHostService.ts` | Gitea/Forgejo implementation of GitHost. Handles Gitea-compatible API authentication and sync logic. |
| `HostService.ts` | Factory/registry for GitHost implementations. Resolves which host service to use based on repo URL. |
| `activeHost.ts` | Tracks the currently active host service for the selected repository. |

### Core Git Operations

| File | Purpose |
|------|---------|
| `CommitService.ts` | Creates git commits with metadata (author, message, timestamp). Handles commit message generation. |
| `BatchGitOperations.ts` | Batches multiple git operations (stage, commit, push) for efficiency. Reduces round-trips. |
| `GitFsService.ts` | Git filesystem operations — read/write files in working tree, list directory contents. |
| `LocalGitWriter.ts` | Writes changes to the local working tree and stages them for commit. Coordinates with CloneSyncService. |
| `GitSyncGate.ts` | Gate/keeper that prevents concurrent sync operations. Ensures push/pull don't race each other. |
| `lfs.ts` | Git LFS (Large File Storage) support — tracks LFS pointers, handles LFS file uploads/downloads. |
| `gitHttp.ts` | Low-level HTTP transport for Git smart protocol over HTTP/HTTPS. |

### Branch & Repo Management

| File | Purpose |
|------|---------|
| `GitBranchCoordinator.ts` | State machine for checkout safety in Git-tab. Enforces idle-state invariant: no staged/modified files block checkout, mutations rejected during checkout-running state. Coordinates with `GitSyncGate` for cycle acquisition, pauses non-active queue items after checkout, and emits the branch content-refresh event. |
| `activeBranchStore.ts` | Tracks the active checked-out branch per repository. Reconciles persisted state against local HEAD on every read; marks stale when HEAD differs from persisted value. Git-tab checkout is authoritative app-wide. |
| `resolveBranch.ts` | Resolves which branch to sync to based on repo config, user preference, and conflict state. Re-exports from `branchResolver.ts`. |
| `RepoRemovalCascade.ts` | Handles complete removal of a cloned repository — deletes files, clears caches, removes from store. |
| `RepoAccessPreflight.ts` | Pre-flight checks before granting access to a repo — verifies credentials, permissions, API availability. |

#### Branch Model

GitNotēs uses a **centralized branch model** for clone-mode repositories:

- **Git → Branches ownership.** The Explore tab (Git UI) is the sole authority for branch operations. No external UI (note editors, sync services, or other tabs) may trigger or control branch switches. Only `GitBranchCoordinator.checkout()` transitions HEAD.
- **One active checked-out branch per clone.** All other services read branch state from `activeBranchStore`.
- **No external branch UI.** Branch selection exists only in the Explore screen. Note editors and sync services have no branch controls.
- **Remote checkout behavior.** When checking out a remote tracking branch (e.g., `origin/feature`), `GitBranchCoordinator.checkout()` first fetches the remote ref if the local checkout fails with "ref not found", then retries. This enables seamless remote-to-local branch checkout.
- **Retained internal branch identity.** Queue items preserve full `branch` identity in their payload. On branch switch, `pauseAllExcept(activeRepoId, activeBranch)` pauses all non-active-branch items, preventing cross-branch sync drift.
- **Operation state/locking.** `GitBranchCoordinator` maintains a state machine (`idle | checkout-running | mutation-running | failed`). Mutations (stage, commit, discard) are rejected while `checkout-running`; checkout is rejected when files are staged/modified/conflicted.
- **Queue pause semantics.** `NoteSyncQueueService` tracks `{ repoId, repoPath, branch }` on every queue item. On branch switch, all non-active-branch items are paused; only the active branch's pending items drain.

### Sync & Recovery

| File | Purpose |
|------|---------|
| `Recovery.ts` | Detects and recovers from corrupted git state, stranded commits, and partial sync failures. |
| `syncFailure.ts` | Classifies sync failures (network, auth, conflict, corruption) and routes to appropriate recovery. |
| `SyncTiming.ts` | Timing/throttling for sync operations — enforces minimum intervals between pushes, debounces rapid changes. |
| `StrandedCommits.ts` | Detects commits that exist in the local repo but are not connected to the current branch head. |
| `MultiRepoGitOps.ts` | Coordinates sync operations across multiple repositories simultaneously. |
| `ManualSync.ts` | User-triggered manual sync (pull, push, full reload). Bypasses automatic sync triggers. |
| `DeleteFailures.ts` | Tracks and retries failed file deletions. Handles cases where delete fails due to permissions or lock. |
| `RetryDeleteFailure.ts` | Retries delete operations that failed due to transient errors (network timeout, file locked). |
| `DefaultsPolicy.ts` | Defines default sync policy when no per-repo override exists — default mode, push frequency, conflict behavior. |

### Migration & Progress

| File | Purpose |
|------|---------|
| `CloneMigrationService.ts` | Migrates old-style cloned repos to the current GitEngine format. Handles schema upgrades. |

## Canvas (`src/services/canvas/`)

| File | Purpose |
|------|---------|
| `AtlasComposer.ts` | Composes multiple canvas tiles into a single canvas document. Handles tile layout and z-ordering. |
| `SparseTileService.ts` | Manages sparse tile storage — only stores tiles that have content, not empty space. |
| `CanvasVisionService.ts` | Vision/AI capabilities for canvas — OCR, object detection, smart tile placement. |
| `TilePersistenceService.ts` | Persists individual canvas tiles to disk/cache. Handles tile serialization and deserialization. |
| `VisionCapabilityChecker.ts` | Checks device capability for vision features (ONNX runtime availability, memory). |
| `RecognizedTextService.ts` | Extracts and indexes text recognized from canvas images via OCR. |
| `VisionResponseParser.ts` | Parses AI/vision model responses into structured canvas data (shapes, text, connections). |
| `HotspotGrid.ts` | Manages interactive hotspot grid on canvases — regions that trigger actions when tapped. |
| `AtlasEncoder.ts` | Encodes canvas data to/from the atlas format used for storage and transmission. |

## Documents (`src/services/documents/`)

> **Local-first architecture:** Files are the source of truth. `DocumentIndex` mirrors frontmatter metadata in SQLite for fast listing/search and indexes document bodies in the `documents_fts` FTS5 virtual table for full-text search.

| File | Purpose |
|------|---------|
| `DocumentService.ts` | Core local-first document service. Creates/reads/updates/deletes files with YAML-ish frontmatter (`---` delimiter). All note content is a plain file on disk. |
| `WorkingTreeDocumentService.ts` | Document operations scoped to the current git working tree. |
| `DocumentIndex.ts` | SQLite index of document metadata (id, title, folder, tags, timestamps) plus an FTS5 body index. Used for fast listing, folder tree, tag autocomplete, and full-text search. |

## Sync (`src/services/`)

| File | Purpose |
|------|---------|
| `CloneSyncService.ts` | Clone mode sync — writes files to the local working tree without staging or committing. |
| `NoteSyncQueueService.ts` | Re-export stub — actual implementation is `src/services/git/NoteSyncQueueService.ts`. Queues note mutations when offline. Drains queue when connectivity returns. |
| `BackgroundSyncService.ts` | OS background task for sync — syncs when app is backgrounded, pulls from all repos at a minimum 30-minute interval. |
| `ForegroundSyncService.ts` | Active sync when app is in foreground — monitors file changes, triggers incremental sync. |
| `RepoFileSyncService.ts` | Syncs individual files to/from the repo — handles note files, attachment files, canvas files. |
| `RepoPullService.ts` | Pulls changes from remote through the native GitEngine into the local working tree. |

## GitHub Sync (`src/services/`)

| File | Purpose |
|------|---------|
| `NoteGitHubSyncService.ts` | Syncs note content to GitHub — handles note-to-file mapping, conflict detection. |
| `TodoGitHubSyncService.ts` | Syncs todo items to GitHub issues/checklists. Maps todos to GitHub issue comments. |
| `CanvasGitHubSyncService.ts` | Syncs canvas data to GitHub — active clone-mode path using CloneSyncService.save(). Handles canvas file creation, updates, and deletion. |
| `TemplateGitHubSyncService.ts` | Syncs templates to GitHub — imports/exports note templates from the repo. |
| `ThoughtDumpService.ts` | Captures rapid thought dumps and syncs them as notes. Batch-optimized for quick capture. |
| `TemplateRepoPreferenceService.ts` | Stores per-repo template preferences in GitHub Gist or repo config. |
| `ThoughtDumpRepoPreferenceService.ts` | Stores per-repo thought dump preferences. |

## Parsers (`src/services/`)

| File | Purpose |
|------|---------|
| `NeorgParser.ts` | Parses `.norg` Neorg format notes into Note model. Handles todo items, headings, links. |
| `NeorgContentParser.ts` | Parses Neorg document content blocks (paragraphs, lists, quotes). |
| `NeorgLinkParser.ts` | Parses Neorg `[[wiki-links]]` and `[[#anchors]]`. Resolves link targets. |
| `OrgContentParser.ts` | Parses Org mode (`.org`) files into Note model. Handles org headlines, properties, deadlines. |
| `OrgInlineParser.ts` | Parses inline Org elements — bold, italic, code, links within Org documents. |
| `NeorgInlineParser.ts` | Parses inline Neorg elements — bold, italic, code, links within Neorg documents. |

## AI (`src/services/ai/`)

| File | Purpose |
|------|---------|
| `providerFactory.ts` | Factory for AI providers (Anthropic, OpenAI-compatible, Apple Intelligence, Llama on-device). Configures model defaults, rate limits, and token budgets. |
| `providerAvailability.ts` | Probes provider availability — configured, credentials valid, quota remaining. |
| `config.ts` | AI service configuration — API base URLs, default models per provider. |
| `modelLimits.ts` | Token and rate limits per AI model. |
| `thoughtDumpIndexing.ts` | Indexes thought dumps for chat recall. |
| `AIMemoryIndexService.ts` | In-memory index for AI chat context. |
| Other AI services | Tool execution (`tools.ts`), system prompts (`systemPrompt.ts`), action execution (`actionExecutor.ts`). |

## Top-Level Services

| File | Purpose |
|------|---------|
| `AuthService.ts` | Handles app authentication (biometric, PIN). Manages auth state and lock screen. |
| `GitHubService.ts` | GitHub REST API client — read/write files, repos, issues, PRs, and more via the GitHub API. Implements `createRepository({ name })` which POSTs to `/user/repos` with `{ name, private: true, auto_init: true }` to create a private, auto-initialized repository for the authenticated user. Errors (401/403/422/transport) are re-thrown so callers can present appropriate recovery UX. |
| `AccountStorage.ts` | Secure account credential storage — SSH keys, tokens, host connections via SecureStore; managed by AccountStorage class |
| `AppIconService.ts` | Manages alternate app icon selection and persistence. Provides `hydrate()`, `current()`, `set()`, `reset()`, and `isSupported()` for switching between Default, Neon, Grayscale, and Gold launcher icons on iOS and Android. Persists selection via AsyncStorage under `@gitnotes:app_icon`; web/unsupported platforms return unavailable. All-user, no Pro gate. |
| `OnboardingService.ts` | Manages first-run onboarding flow — repo selection, initial clone, preferences. |
| `StorageService.ts` | Wraps AsyncStorage for app preferences and local settings. |
| `RevenueCatService.ts` | RevenueCat SDK wrapper — configures StoreKit 2, handles purchases, entitlements, customer info. |
| `PushNotificationService.ts` | Registers for and handles push notifications from GitHub (PR mentions, sync alerts). |
| `NotificationService.ts` | Local notification scheduling and delivery — reminders, sync reminders, conflict alerts. |
| `DailyQuoteService.ts` | Serves the daily philosopher quote from `src/data/philosopher_quotes.json`. |
| `ChatStorageService.ts` | Persists AI chat threads and messages locally. Classifies GitHub API errors into nine typed codes (`NETWORK_ERROR`, `SERVER_ERROR`, `UNAUTHORIZED`, `FORBIDDEN`, `RATE_LIMITED`, `NOT_FOUND`, `INVALID_PAYLOAD`, `PARSE_ERROR`, `UNKNOWN`). Uses cached summaries as fallback only for transient network or 5xx errors, surfacing a warning with stale data. Auth errors (401/403), rate limits (429), and parse errors do not use cache. Branch-scoped via `chat-index-{owner}-{repo}-{branch}` cache key. |
| `BacklinksService.ts` | Computes and caches backlinks — notes that link to the current note via `[[wiki-links]]`. |
| `ExportService.ts` | Exports notes/canvases to PDF, plain text, JSON, or GitHub-flavoured Markdown. |
| `ShareService.ts` | Native share sheet integration — share notes via iOS/Android share UI. |
| `TemplateService.ts` | Manages note templates — create from template, template metadata, template storage. |
| `TierLimits.ts` | Enforces per-tier feature limits (free vs Pro). Checks entitlement before Pro features. |
| `PaywallAnalytics.ts` | Tracks paywall events in RevenueCat — impressions, purchase attempts, outcomes, restores. |
| `ReminderService.ts` | Schedules and fires local notifications for note/todo reminders. |
| `RenderStyleService.ts` | Manages render style preferences (markdown vs rich text vs plaintext). |
| `FeatureFlags.ts` | Feature flag provider — enables/disables features per user, cohort, or experiment. |
| `http.ts` | GitHub API axios instance — handles auth headers (Bearer token), timeouts (120s), and request auth overrides for the GitHub API. |

## Worker API — OAuth/App Boundary (`src/services/`)

> The OAuth and GitHub App boundary handles GitHub credential acquisition. OAuth UI is shipped and used in Simple onboarding; GitHub App installation is also available.

| File | Purpose |
|------|---------|
| `workerApi.ts` | Typed HTTP client for the Cloudflare Worker backend. Uses `EXPO_PUBLIC_GITNOTES_BACKEND_URL` with production fallback `https://worker.gitnotes.org/api/v1`. |
| `GitHubOAuthService.ts` | GitHub OAuth PKCE flow — generates verifier/challenge, initiates via backend, opens authorization URL in system browser, exchanges codes, stores credentials. Default scope: `['read:user', 'user:email', 'repo']`. |
| `GitHubAppService.ts` | GitHub App installation flow — generates signed JWS handoffs, exchanges installation tokens, renews via one-time grant tokens. |

**Environment variables (from `.env.example`):**

| Variable | Purpose | Default |
|----------|---------|---------|
| `EXPO_PUBLIC_GITNOTES_BACKEND_URL` | Worker API base URL | `https://worker.gitnotes.org/api/v1` |
| `EXPO_PUBLIC_GITHUB_OAUTH_CLIENT_ID` | GitHub OAuth app client ID (public, non-secret) | — |

**Callbacks (fixed deep links):**
- OAuth: `gitnotes://oauth/callback`
- App: `gitnotes://app/callback`

### Simple onboarding lifecycle

Simple onboarding (visible on the welcome screen's "Quick Setup" banner) uses GitHub OAuth to create a private notes repository in one streamlined flow:

1. **OAuth sign-in:** `OnboardingScreen` initiates OAuth via `GitHubOAuthService.initiate({ returnTo: 'onboarding' })`. The pending flow is stored in `pendingOAuthFlows` keyed by state. `OAuthCallbackScreen` receives the deep link, calls `GitHubOAuthService.exchangeCode()`, stores the result in the pending flow, and navigates back to `OnboardingScreen` with `fromOAuth=true`.
2. **Repository creation:** `GitHubService.createRepository({ name })` sends `POST /user/repos` with `{ name, private: true, auto_init: true }`. Errors (401/403/422/transport) are re-thrown so the UI can show appropriate recovery options.
3. **Clone:** `repoStore.addRepository()` registers and clones the canonical `owner/repo`.
4. **Welcome note:** `noteStore.createNote()` writes `notes/welcome-to-gitnotes.md` locally through the working-tree path. The note is a local working-tree change subject to the normal stage/commit/push lifecycle.
5. **Error recovery:** If repo creation fails with 422 (name collision), the user is returned to the name-entry step. If cloning fails, the created remote repo is retained so retry does not create a duplicate. If note seeding fails, the user is offered retry without re-creating the repo.

**Existing auth (unchanged):** Host connections (`AccountsContext`, `HostAuthContext`) use PAT-based `GitHubService.setToken()` / `AuthService.connectHost()`. PAT, OAuth, and GitHub App credentials coexist on the same host. SSH key and credential management is unchanged.

## See Also

- [Architecture](./architecture.md) — How these services fit together
- [Sync Architecture](./sync-architecture.md) — Clone vs API sync modes
- [Stores](./stores.md) — State managed by these services
