# Screens & Navigation

> All screens, navigation hierarchy, and deep link paths. See [Architecture](./architecture.md) for context.

## Navigation Hierarchy

```
AppNavigator (Native Stack Navigator)
│
├── OnboardingScreen              # First-run onboarding flow
├── QuickSetupScreen              # GitHub repository setup from Settings
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
| `QuickSetup` | `{ oauthState?: string | null }` |

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
- `NoteHistoryModal` — read-only Git history browser (bottom sheet)

**States:** Editing, Preview, Split (edit + preview side-by-side)

**History Feature:**

The `NoteHistoryModal` is accessible from both Preview mode (`NoteViewer`) and Edit mode (`EditorToolbar`). It displays a read-only view of the note's committed Git history without mutating HEAD, the working tree, or the sync queue.

**Entry points:**
- **Preview mode:** History icon button in `NoteViewer` header (visible only for eligible notes)
- **Edit mode:** History button in `EditorToolbar` (visible only for eligible notes)

**Eligibility:** A note is eligible for history viewing if it:
- Has a `filePath` (saved to Git, not a new note)
- Has a `repo` (clone-mode note)
- Has a `branch` (branch information available)
- Is not a PDF note

**Behavior:**
- Shows only commits affecting the note's current `filePath` on the active/recorded branch, newest first
- Displays a horizontal gesture slider with revision cards for browsing
- Selecting a revision loads and displays the exact file content at that commit (read-only, selectable text)
- Edit is disabled while viewing history; Close remains enabled
- A non-blocking notice appears when the editor has unsaved changes
- Pagination/load-more for histories beyond the initial window
- Closing the modal preserves all editor state (content, branch, HEAD, unsaved changes)

**Ineligible notes:** New notes, local-only notes, PDF/binary notes, and notes without repository/branch identity show no history button.

**No restoration:** The history feature is read-only. It does not implement restore, revert, checkout, diff editing, or any mutation of Git state.

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

**Purpose:** View and edit a file from the local working tree.

**Route params:** `{ repoId: string; path: string }`

**Navigation:** Tapped from `ExploreScreen` file tree.

**Preview and Edit modes:** Eligible text files show a Preview/Edit toggle in the header. Preview renders the file with a format-appropriate viewer; Edit exposes a plain-text multiline editor.

**Eligible files:** Markdown (`.md`, `.markdown`), Neorg (`.norg`), Org (`.org`), JSON (`.json`), and code files with recognized extensions (TypeScript, JavaScript, Python, Go, Rust, Swift, Java, Kotlin, C, C++, C#, Ruby, PHP, Lua, Shell, CSS, SCSS, LESS, HTML, XML, SVG, SQL, GraphQL, Protobuf, TOML, INI, YAML, Dockerfile, Makefile, `.dockerignore`, `.gitignore`, and others). Files with no recognized extension fall back to plain selectable text.

**Read-only files:**
- Binary files (images, archives, etc.) — shown with a "Binary file" message, no preview or edit control.
- LFS pointer files — shown with an "LFS pointer" message, no preview or edit control.

**Supported renderers:**
- Markdown → `react-native-marked` with frontmatter stripped.
- Neorg → `NeorgContentParser` + `StructuredRenderer`; wiki-link navigation preserved.
- Org → `OrgContentParser` + `StructuredRenderer`; wiki-link navigation preserved.
- JSON → `JsonRenderer` with formatted tree view.
- Code → regex tokenizer with syntax colors, line numbers, copy action, and theme-aware styling. Files larger than 256 KiB of UTF-8 content bypass tokenization and render as selectable plain text in Preview mode; Edit mode remains available for saving changes.
- Plain/unknown → selectable `Text` with no tokenization.

**Save behavior:** Save writes raw UTF-8 content directly to the working tree via `WorkingTreeDocumentService.update()` without staging, committing, or pushing. The file appears as an unstaged modification in the Git workspace. User reviews, stages, commits, and pushes from the existing Git workspace. The `WorkingTreeDocumentService` 5 MiB write guard is unchanged.

**No LSP:** This screen does not include a language server, LSP client, autocomplete, diagnostics, hover information, go-to-definition, references, rename, or formatting. The `FileLanguage.language` field is a stable forward reference for a future LSP service descriptor but no LSP behavior is wired.

**Controls:** Back button (top-left), Preview/Edit toggle (top-right, when eligible), Cancel and Save buttons (visible in Edit mode only, top-right). Dirty state triggers a discard confirmation before navigating away. Saving while a branch checkout is in progress is blocked.

---

### FileViewerScreen

**Purpose:** View a file from a remote GitHub repository (read-only). Content is fetched via `GitHubService.getFileContent()` and rendered with the shared `FileContentRenderer`. No editing, staging, or commit operations are available.

**Route params:** `{ owner: string; repo: string; branch?: string; path: string; title?: string; size?: number }`

**Navigation:** A remote file viewer accessible from GitHub browsing flows. Wiki-links inside rendered Neorg/Org content navigate to another `FileViewerScreen` instance. (This is distinct from `ExploreFileScreen` which handles local working-tree files; `ExploreScreen` Files section routes local files to `ExploreFile` and PDFs to `PdfViewer`.)

**Supported renderers (same as `ExploreFileScreen` preview):** Markdown (`react-native-marked`), Neorg (`NeorgContentParser` + `StructuredRenderer` with wiki-link navigation), Org (`OrgContentParser` + `StructuredRenderer` with wiki-link navigation), JSON (`JsonRenderer`), code (regex tokenizer with syntax colors and line numbers), and plain selectable text for unknown or oversized content.

**Read-only:** No Preview/Edit toggle, no save button, no mutation on row tap. Navigating away is instant with no discard prompt.

**No LSP:** No language server, autocomplete, diagnostics, or code intelligence. Same `FileLanguage.language` forward reference as `ExploreFileScreen` with no LSP wiring.

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

`SettingsContent.tsx` exposes a grouped UI style picker under the Appearance section. Theme rows are data-driven via `src/components/settings/styleOptions.ts`, which mirrors the pattern established by `referralAppIcons.ts`. The three localized subsection headers are `settings.styleGroups.default`, `settings.styleGroups.pro`, and `settings.styleGroups.referralRewards`.

Group structure and entitlement model:

| Group | Options | Access |
|-------|---------|--------|
| Default | Basic (`flat`), Neo-Brutalist (`neo-brutalist`) | Free for all users |
| Pro | Neumorphic (`neumorphic`), Retrofuturistic (`retrofuturistic`) | Pro only (paywall for free users) |
| Referral Rewards | Terminal Mono (`terminal-mono`), CRT Green (`crt-green`), Developer Desk (`developer-desk`) | Server-authoritative unlock via `RewardEntitlementService.isUnlocked(rewardKey)` — see `REFERRAL_REWARD_CATALOG` in `src/types/worker.ts` for milestone mapping (milestones 3, 10, 20 respectively) |

Behavior:
- Default styles call `setStyle()` directly on press.
- Pro styles call `promptProUpgrade()` when `isPro === false` (paywall); call `setStyle()` when Pro.
- Referral styles call `onOpenRewardCatalog` when `RewardEntitlementService.isUnlocked(rewardKey)` is false; call `setStyle()` when the server confirms unlock. Pro status alone does not bypass referral gating.
- A lock icon is shown on Pro and Referral options when their respective entitlement is not satisfied.
- The selected style is persisted to `@gitnotes:style` via `ThemeContext.setStyle()`.

---

### SyncStatusScreen

**Purpose:** Detailed sync status — pending changes, last sync time, push/pull controls.

**Navigation:** From `SettingsScreen` or floating git button.

---

### OnboardingScreen

**Purpose:** First-run setup for new users, with standard provider configuration and direct GitHub connection from the welcome step.

**Welcome actions:** `Connect to GitHub` starts the OAuth flow immediately. `Custom Setup` advances to the provider and token configuration path. Quick Setup is not embedded in first-run onboarding.

### QuickSetupScreen

**Purpose:** Dedicated GitHub repository setup launched from Settings. It is also the return target for OAuth callbacks started by this flow.

**Flow:** GitHub OAuth sign-in → editable private repo name (pre-filled from GitHub login as `gitnotes-<login>`) → private auto-initialized repository created via `POST /user/repos` with `{private:true, auto_init:true}` → clone of the new repo → one welcome note (`notes/welcome-to-gitnotes.md`) written locally through `noteStore.createNote()` → done. The welcome note is a local working-tree change subject to the normal stage/commit/push lifecycle, not a separate API upload. Errors (OAuth denial, name collision, 403, network failure) retain the appropriate retry step.

**Standard mode:** Provider picker (GitHub, GitLab, Gitea, Forgejo), then for GitHub: PAT / OAuth / GitHub App auth method selector. Non-GitHub providers use token entry with optional instance URL. After authentication, clone or skip. Then optional GitNotēs Pro promotion screen. Finally `HomeScreen`.

**Callback behavior:** OAuth callback (`gitnotes://oauth/callback`) is handled by `OAuthCallbackScreen`. The callback reads `pendingOAuthFlows.returnTo` and navigates back to either `OnboardingScreen` or `QuickSetupScreen`, preserving the OAuth state so the initiating screen consumes the matching result. Settings-launched OAuth continues to return to Settings.

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

### ImageViewerScreen / PdfViewerScreen / VideoViewerScreen

**Purpose:** Full-screen viewer for attachments.

**Supported formats:**
- Images: JPEG, PNG, GIF, WebP, HEIC
- PDF: multi-page PDF renderer (also reached from `ExploreScreen` Files section for PDF files)
- Video: MP4, MOV (native playback)

---

### BiometricLockScreen

**Purpose:** App lock screen shown on startup when the persisted lock is enabled or when the app returns from background after the configured timeout.

**Trigger:** `BiometricLockContext` — enabled in settings.

**Authentication:** The first biometric attempt starts automatically when the locked overlay appears and biometrics are available. The Unlock button remains available to retry after cancellation or failure.

---

## See Also

- [Navigation types](../../navigation/types.ts) — TypeScript type definitions for route params
- [Architecture](./architecture.md) — Context
