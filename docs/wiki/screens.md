# Screens & Navigation

> All screens, navigation hierarchy, and deep link paths. See [Architecture](./architecture.md) for context.

## Navigation Hierarchy

```
AppNavigator (Native Stack Navigator)
│
├── OnboardingScreen              # First-run onboarding flow
├── MainTabs (TabNavigator)       # Bottom tab navigator (5 tabs)
│   ├── HomeTab → HomeScreen
│   ├── NotesTab → NotesListScreen
│   ├── ExploreTab → ExploreScreen
│   ├── TodosTab → TodoListScreen
│   ├── SettingsTab → SettingsScreen
│   └── CanvasList → CanvasListScreen  (hidden tab)
│
├── NoteEditorScreen              # Stack screen — note/:noteId
├── CanvasEditorScreen            # Stack screen — canvas/:canvasId
├── ChatThreadListScreen          # Stack screen — chat
├── ChatScreen                   # Stack screen — chat/:threadId
├── SyncStatusScreen             # Stack screen
├── AddReminderScreen            # Stack screen
├── TemplateManagerScreen        # Stack screen
├── RenderStyleSettingsScreen    # Stack screen
├── RenderStyleEditorScreen      # Stack screen
├── GraphViewScreen              # Stack screen
├── PaywallScreen                # Stack screen (interstitial or direct)
├── ThoughtDumpScreen            # Stack screen — thought-dump
├── ImageViewerScreen            # Stack screen
├── FileViewerScreen             # Stack screen
├── PdfViewerScreen              # Stack screen
├── VideoViewerScreen            # Stack screen
├── ExploreCommitScreen          # Stack screen
├── ExploreDiffScreen           # Stack screen
├── ExploreFileScreen            # Stack screen
├── ExploreRepoInfoScreen        # Stack screen
├── ExploreIssuesScreen          # Stack screen
├── ExplorePullRequestsScreen    # Stack screen
└── NeumorphicGallery            # __dev__/neumorphic (dev only)
```

## Deep Linking

GitNotēs uses the custom scheme `gitnotes://` for deep links.

### URL Structure

| Route | URL Pattern | Example |
|-------|------------|---------|
| Note | `gitnotes://note/:noteId` | `gitnotes://note/1699876543-abc123` |
| Canvas | `gitnotes://canvas/:canvasId` | `gitnotes://canvas/1699876543-def456` |
| Chat thread list | `gitnotes://chat` | `gitnotes://chat` |
| Chat thread | `gitnotes://chat/:threadId` | `gitnotes://chat/1699876543-ghi789` |
| Home | `gitnotes://home` | `gitnotes://home` |
| Notes list | `gitnotes://notes` | `gitnotes://notes` |
| Explore | `gitnotes://explore` | `gitnotes://explore` |
| Settings | `gitnotes://settings` | `gitnotes://settings` |
| Thought dump | `gitnotes://thought-dump` | `gitnotes://thought-dump` |

> **Note:** Tab bar screens (Home, Notes, Explore, Todos, Settings) ARE reachable via `gitnotes://home`, `gitnotes://notes`, etc. Universal links (`https://gitnotes.app/...`) require associated domains entitlement configuration — see [Architecture](./architecture.md).

### Actual Route Param Types

The canonical route param types are in `src/navigation/types.ts`:

| Screen | Route Param Type |
|--------|-----------------|
| `NoteEditor` | `{ noteId?, format?, initialTitle?, initialContent?, initialTags?, repo?, branch?, folderPath?, anchor? }` |
| `CanvasEditor` | `{ canvasId?, canvasWidth?, canvasHeight?, canvasTitle? }` |
| `ChatScreen` | `{ threadId: string }` |
| `ThoughtDump` | `{ openVoiceOnMount? }` |
| `Explore` | `{ repoId? }` |
| `ExploreDiff` | `{ repoId: string; path: string }` |
| `ExploreCommit` | `{ repoId: string; commitId: string }` |
| `ExploreFile` | `{ repoId: string; path: string }` |
| `ConflictResolve` | `{ repoId: string; path: string }` *(in types, no screen component — navigation target only)* |
| `PdfViewer` | `{ owner: string; repo: string; branch?; path: string; title? }` |

## Screens

### HomeScreen

**Purpose:** Dashboard with quick access to recent notes, daily quote, and sync status.

**Key components:**
- `BentoRecent` — bento-grid layout of recent notes
- `DailyQuoteCard` — philosopher quote from `DailyQuoteService`
- `QuickAccessShelf` — pinned/favorite notes
- `FloatingGitButton` — floating sync button

---

### NotesListScreen

**Purpose:** Browse and search all notes in the selected repo/folder.

**Key components:**
- `NoteCard` — note preview card with title, excerpt, tags, color
- `NotesFilterModal` — filter by folder, tag, color, date
- `NotesViewModePicker` — list vs grid view toggle
- `ActiveFilterStrip` — shows active filters
- `BulkActionBar` — bulk delete, move, tag operations

**Navigation:** Tapping a note → `NoteEditorScreen`. Long-press → context menu.

---

### NoteEditorScreen

**Purpose:** Full note editing with toolbar, tag input, and AI assist.

**Key components:**
- `NoteEditorForm` — main editor (Markdown input)
- `EditorToolbar` — formatting toolbar (bold, italic, heading, list, code)
- `EditorHeader` — title input, folder breadcrumb
- `MarkdownBody` — rendered Markdown preview pane
- `TagInput` — tag editor
- `BacklinksSection` — notes that link to this note
- `FloatingAIButton` — AI assist trigger

**States:** Editing, Preview, Split (edit + preview side-by-side)

---

### TodoListScreen

**Purpose:** Browse, filter, and manage todos.

**Key components:**
- `TodoCard` — todo with checkbox, title, due date, tags
- `TodoEditorModal` — create/edit todo
- `TodosListHeader` — filter tabs (All, Today, Upcoming, Overdue)

---

### CanvasListScreen

**Purpose:** Browse all canvas documents.

**Key components:**
- `CanvasThumbnail` — grid thumbnail of canvas
- `CanvasPreview` — preview on tap
- `CanvasPickerModal` — embed canvas picker in note editor

**Navigation:** Tapping → `CanvasEditorScreen`

---

### CanvasEditorScreen

**Purpose:** Infinite canvas with tile-based layout, drawing, and AI vision.

**Key components:**
- Sparse tile canvas (handled by native Skia/canvas layer)
- `AtlasComposer` — tile composition
- `HotspotGrid` — tappable regions
- AI vision toolbar (OCR, object detection)

---

### ChatScreen

**Purpose:** AI chat with context from the current note or repo.

**Key components:**
- `ChatMessageBubble` — user and AI message bubbles
- `ChatInputBar` — message input with send button
- `FloatingAIHubMenu` — AI provider picker
- `ContextPickerModal` — pick which note/repo to chat about
- `ModelSelector` — pick AI model

**Tool-call continuation:** The controller uses a manual bounded multi-round continuation loop (not SDK auto-execution). Tool calls are wrapped in `executeWithTimeout` with a 30-second timeout (`TOOL_EXECUTION_TIMEOUT_MS`). The loop is capped at `MAX_TOOL_ROUNDS = 5` rounds per streaming session. Tool calls are deduplicated by `(toolName, argsJSON)` to prevent re-execution after a confirmation Apply. On confirmation prompt, the stream pauses and waits for user Apply/Cancel; Apply triggers a continuation round using `toContinuationMessages` to replay prior assistant and tool messages.

---

### ChatThreadListScreen

**Purpose:** List all AI chat threads.

**Key components:**
- `ChatThreadCard` — thread preview with last message, timestamp
- `ChatThreadContextMenu` — delete, rename thread

---

### ExploreScreen

**Purpose:** Git repository explorer — view commits, diffs, files, branches, and pull requests. Branch-aware: shows the active checked-out branch from `activeBranchStore`, and all branch operations are routed through `GitBranchCoordinator` for checkout safety.

**Wraps ExploreScreen** — gates mutation operations during branch checkout via `CheckoutSafetyProvider`. Components inside can call `useCheckoutSafety()` to access checkout state and show blocking overlays.

**Git → Branches ownership:** The Explore tab (Git UI) is the sole authority for branch operations. The Git tab owns all branch state — no external UI (note editors, sync services, or other tabs) may trigger or control branch switches. Note editing never triggers implicit branch switches.

**Branch UI:** Only the Explore screen exposes branch selection. No branch selector exists in the note editor or elsewhere. When checking out a remote branch, GitBranchCoordinator fetches the remote ref first and retries checkout locally.

**Sections:**
- `FilesSection` — repo file tree
- `ChangesSection` — unstaged/staged changes in working tree
- `StagingSection` — staged files ready to commit
- `CommitsSection` — recent commit history
- `BranchesSection` — local and remote branches; checkout via `GitBranchCoordinator`
- `RemotesSection` — configured remotes
- `ConflictsSection` — unresolved merge conflicts
- `PullRequestsSection` — open PRs (GitHub only)
- `IssuesSection` — repo issues (GitHub only)
- `RepoInfoSection` — repo metadata (name, URL, branch, ahead/behind)

---

### ExploreCommitScreen

**Purpose:** View a single commit — message, author, changed files, diff.

**Route params:** `{ repoId: string; commitId: string }`

**Navigation:** Tapped from `ExploreScreen` commit list.

---

### ExploreDiffScreen

**Purpose:** View diff between two commits or branch state.

**Route params:** `{ repoId: string; path: string }` — `path` is the file path

**Navigation:** Tapped from `ExploreScreen` changes list.

---

### ExploreFileScreen

**Purpose:** View and edit a text file from the local working tree. Binary files and LFS pointer files are read-only. Text files are editable as plain text via a multiline editor.

**Route params:** `{ repoId: string; path: string }`

**Save behavior:** Save writes raw UTF-8 content directly to the working tree without staging, committing, or pushing. The file appears as an unstaged modification in the Git workspace. User reviews, stages, commits, and pushes from the existing Git workspace.

**Navigation:** Tapped from `ExploreScreen` file tree.

---

### SettingsScreen

**Purpose:** App settings hub.

**Sections:**
- Account management (`AccountsContext`)
- GitHub connection (`GitHubAuthContext`)
- Theme selection (`ThemeContext`)
- App icon selection — choose between Default (base), Neon, Grayscale, or Gold launcher icons via `AppIconService`; persisted locally via AsyncStorage; available on iOS and Android; web shows unavailable
- Sync settings (`ForegroundSyncSettings`)
- Notification preferences
- Pro/paywall access (`PaywallScreen`)
- Biometric lock toggle (`BiometricLockContext`)
- Language (i18n)

**Quick Setup:** A dedicated Quick Setup row in Settings starts the GitHub repository setup flow without requiring users to restart onboarding.

**Appearance (UI Style) selector:**

`SettingsContent.tsx` exposes a four-way UI style picker under the Appearance section. Users choose one of:

| Option | Style key | Access |
|--------|-----------|--------|
| Basic | `flat` | Free |
| Neumorphic | `neumorphic` | Pro only (locked with paywall) |
| Neo-Brutalist | `neo-brutalist` | Free (no paywall) |
| Retrofuturistic | `retrofuturistic` | Pro only (locked with paywall) |

When a non-Pro user taps a Pro-locked style (Neumorphic or Retrofuturistic), `promptProUpgrade()` is called which opens the paywall. A lock icon is shown next to each Pro option when `isPro === false`. The selected style is persisted to `@gitnotes:style` via `ThemeContext.setStyle()`.

---

### SyncStatusScreen

**Purpose:** Detailed sync status — pending changes, last sync time, push/pull controls.

**Navigation:** From `SettingsScreen` or floating git button.

---

### OnboardingScreen

**Purpose:** First-run setup for new users, with two distinct paths:

**Mode selection:** On the welcome step, a "Quick Setup" banner offers a simplified path. The "Back" button (visible after entering Quick mode) returns to the standard flow.

**Quick mode:** GitHub OAuth sign-in → editable private repo name (pre-filled from GitHub login as `gitnotes-<login>`) → private auto-initialized repository created via `POST /user/repos` with `{private:true, auto_init:true}` → clone of the new repo → one welcome note (`notes/welcome-to-gitnotes.md`) written locally through `noteStore.createNote()` → done. The welcome note is a local working-tree change subject to the normal stage/commit/push lifecycle, not a separate API upload. Errors (OAuth denial, name collision, 403, network failure) are handled without losing onboarding progress and allow retry. Quick mode is also accessible from Settings via the Quick Setup row.

**Standard mode:** Provider picker (GitHub, GitLab, Gitea, Forgejo), then for GitHub: PAT / OAuth / GitHub App auth method selector. Non-GitHub providers use token entry with optional instance URL. After authentication, clone or skip. Then optional GitNotēs Pro promotion screen. Finally `HomeScreen`.

**Callback behavior:** OAuth callback (`gitnotes://oauth/callback`) is handled by `OAuthCallbackScreen`. In Quick mode the callback stores the result in `pendingOAuthFlows` and navigates back to `OnboardingScreen` with `fromOAuth=true` so the result is consumed and the appropriate Quick step is shown. In Standard mode the callback navigates to Settings.

---

### PaywallScreen

**Purpose:** Pro subscription purchase UI.

**Components:**
- `PaywallPlanGrid` — monthly/yearly/lifetime plan cards
- `PaywallFeatureGrid` — feature comparison (free vs Pro)
- Purchase flow handled by `RevenueCatService`
- Restore purchases button

---

### GraphViewScreen

**Purpose:** Note/wiki-link graph visualization.

---

### RenderStyleSettingsScreen / RenderStyleEditorScreen

**Purpose:** Configure how notes are rendered (Markdown, rich text, plaintext).

---

### TemplateManagerScreen

**Purpose:** Create and manage note templates.

**Key components:**
- `TemplateListItem` — template preview
- `TemplateEditorModal` — create/edit template

---

### ThoughtDumpScreen

**Purpose:** Rapid capture mode — voice or text input that dumps into a note as stream-of-consciousness.

**Flow:** User talks/types → captured as draft note → saved to selected repo.

---

### ImageViewerScreen / FileViewerScreen / PdfViewerScreen / VideoViewerScreen

**Purpose:** Full-screen viewer for attachments.

**Supported formats:**
- Images: JPEG, PNG, GIF, WebP, HEIC
- Files: generic file preview
- PDF: multi-page PDF renderer
- Video: MP4, MOV (native playback)

---

### BiometricLockScreen

**Purpose:** App lock screen shown when app returns from background.

**Trigger:** `BiometricLockContext` — enabled in settings.

---

## See Also

- [Navigation types](../../navigation/types.ts) — TypeScript type definitions for route params
- [Architecture](./architecture.md) — Context
