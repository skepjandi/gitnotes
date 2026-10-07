# Architecture

> GitNotēs project structure, tech stack, data flow, and key modules. For detailed service docs see [Services](./services.md). For sync internals see [Sync Architecture](./sync-architecture.md).

## What is GitNotēs?

GitNotēs is a mobile notes/todos/canvases app backed by a **Git repository** (GitHub, GitLab, Gitea). Notes are plain Markdown/Neorg/Org/JSON files with YAML frontmatter — no database lock-in, full version history, works offline.

**Core promise:** Your data is in a git repo you own. Export by cloning. Edit with any text editor. Sync anywhere.

**Local-first note storage:** Notes are files on disk with YAML-ish frontmatter (`---` block). A SQLite index (`DocumentIndex`) mirrors metadata for fast listing/search, but the file is always the source of truth. See [Note File Format](./note-file-format.md) for full details.

---

## Tech Stack

### Framework & Runtime

| Layer | Technology |
|-------|-------------|
| Framework | Expo SDK 56 |
| Runtime | React Native 0.85.3 |
| Language | TypeScript 6 (strict mode, no `any` without justification) |
| Package manager | Yarn 1.22 |
| Node engine | >= 20.18 |

### Navigation

| Technology | Purpose |
|-----------|---------|
| React Navigation v7 (`@react-navigation/native`, `native-stack`, `bottom-tabs`) | Root native stack + bottom tabs |
| Deep linking | `gitnotes://` custom scheme |

### State Management

| Technology | Purpose |
|-----------|---------|
| Zustand v5 | All client state — notes, todos, canvases, repos, AI chat, Pro status, theme |
| React Context | Auth, accounts, theme, view mode (wraps Zustand) |
| TanStack Query v5 | Server state — git host API calls, GitHub GraphQL |

### Styling & UI

| Technology | Purpose |
|-----------|---------|
| NativeWind v5 | Tailwind CSS for React Native |
| Reanimated v4 | Animations, gestures, shared transitions |
| FlashList v2 | Performant list rendering |
| Expo Blur | Frosted glass effects in Neumorphic UI |
| React Native Skia | Canvas rendering (tiles, shapes) |

### Git

| Technology | Purpose |
|-----------|---------|
| `gitnotes-git-engine` | Custom Rust library (git2-based) — clone, stage, commit, push, pull |
| Turbo Modules (New Architecture) | JS↔Rust bindings |

### AI

| Technology | Purpose |
|-----------|---------|
| Vercel AI SDK v6 | Provider abstraction (Anthropic, OpenAI, Apple Intelligence, Llama) |
| `@react-native-ai/llama` | On-device Llama for offline AI |
| `@react-native-ai/apple` | Apple Intelligence integration |

### Storage & Sync

| Technology | Purpose |
|-----------|---------|
| AsyncStorage | Local key-value storage |
| Expo Secure Store | Auth tokens |
| Expo File System | Working tree files |
| Expo SQLite | Local document metadata and FTS5 body index |

### Platform Services

| Technology | Purpose |
|-----------|---------|
| Expo Notifications | Local + push notifications |
| Expo Background Task | Background sync |
| Expo Local Authentication | Biometric lock |
| Expo Document Picker | Import files |
| RevenueCat / StoreKit 2 | Pro subscription purchases |
| i18next | Internationalization (EN, ES, FR, DE, JA, KO) |

### Build & Deploy

| Technology | Purpose |
|-----------|---------|
| EAS Build / Expo Run | Native iOS/Android builds |
| EAS Update | Over-the-air JS updates |
| GitHub Actions | CI + Wiki sync |

---

## Project Structure

```
gitnotes/
├── src/
│   ├── components/          # Reusable UI components
│   │   ├── ai/             # AI chat components (bubbles, input, provider picker)
│   │   ├── editor/         # Note editor components (toolbar, viewer, backlinks)
│   │   ├── git/            # Floating git button, sync progress
│   │   ├── home/           # Bento grid, daily quote
│   │   ├── notes/          # Note cards, filters, list header
│   │   ├── paywall/        # Paywall plan grid, feature grid
│   │   ├── repo/           # Repo tree, file browser
│   │   ├── settings/       # Settings modals, clone progress
│   │   ├── todos/          # Todo cards, editor modal
│   │   └── ...
│   ├── contexts/           # React Context providers (14 contexts)
│   ├── data/               # Static data (philosopher quotes JSON)
│   ├── hooks/              # Custom React hooks (25 hooks)
│   ├── i18n/               # i18n translations (6 languages)
│   ├── lib/                # Shared utilities — `cn()` (clsx + tailwind-merge for Tailwind class composition) |
│   ├── models/             # TypeScript interfaces (14 models)
│   ├── navigation/         # AppNavigator + TabNavigator
│   ├── screens/            # Screen components (30+ screens)
│   ├── services/           # Business logic (100+ service files)
│   │   ├── git/            # Git host services, commit ops, sync gate
│   │   ├── canvas/         # Sparse tile canvas, AI vision
│   │   ├── documents/      # Document service, working tree
│   │   ├── git/engine/GitEngine.ts  # Rust GitEngine TypeScript facade
│   ├── stores/             # Zustand stores (20 stores)
│   ├── theme/              # NativeWind theme, color tokens
│   └── types/              # Shared type definitions
├── modules/
│   └── GitEngine/           # Rust crate (git2-based native Git module)
│       ├── src/lib.rs
│       └── Cargo.toml
├── docs/wiki/               # THIS WIKI — source-controlled, auto-synced
├── scripts/                 # Build scripts (Rust build, asset regeneration)
├── __tests__/               # Jest tests
└── .github/workflows/       # CI + Wiki sync
```

---

## Data Flow

### Note Save → Sync (Clone Mode)

```
User edits note
  → NoteEditorScreen.save()
    → noteStore.updateNote()
      → CloneSyncService.save({ intent: 'upsert', content, filePath, ... })
        → FileSystem.writeAsStringAsync(fullPath, content)
          → User stages and commits from the Git workspace or floating Git button
      → ForegroundSyncService / BackgroundSyncService triggers push
        → GitEngine.push(repoDir, 'origin', branch)
          → 409 Conflict → ConflictResolverScreen
```

> **Note:** `CloneSyncService.save()` writes the working-tree file without staging it. Users stage and commit from the Git workspace or floating Git button, then push through the normal clone-mode triggers. See [Sync Architecture](./sync-architecture.md) for full push trigger details.

### Note Load

```
User opens NotesListScreen
  → noteStore.loadNotes()
    → DocumentIndex.scan(repoDir)        # Walk working tree
      → DocumentService.readNote(filePath)  # Read + parse .md files
        → noteStore.setNotes(notes)
```

### AI Chat

```
User sends message in ChatScreen
  → chatStore.sendMessage()
    → aiStore.provider.chat()              # Vercel AI SDK call
      → Render streamed response
        → chatStore.appendMessage()
          → ChatStorageService.persist()  # Save to AsyncStorage
```

---

## Navigation

### AppNavigator (`src/navigation/AppNavigator.tsx`)

Root native stack. Handles:
- Deep linking (`gitnotes://` scheme)
- Onboarding flow
- Deferred paywall interstitial
- Floating overlays (AI button, git button)

### TabNavigator (`src/navigation/TabNavigator.tsx`)

Bottom tab bar with 5 tabs: Home, Notes, Explore, Todos, Settings.

Three tab bar variants:
- **Neumorphic** (iPhone, flat style off) — raised button look
- **Flat** (iPhone, flat style on) — standard iOS tab bar
- **Tablet rail** (iPad) — horizontal rail along the side

---

## Theme System

**Two styles**, each with **light + dark**:

| Style | Description |
|-------|-------------|
| `neumorphic` | Soft "pressed clay" look — light gray surface, off-white background, subtle shadows |
| `flat` | Standard iOS look — system colors, clean |

**Color tokens** (defined in `src/theme/tokens.ts`):
`bg`, `surface`, `highlight`, `shadow`, `text`, `textSecondary`, `accent`, `accentMuted`, `error`, `success`, `warning`, `background`, `surfaceSecondary`, `primary`, `border`, `card`, `elevated`

**Note color palette** (user-assignable labels, not theme-aware):
`red`, `orange`, `yellow`, `green`, `blue`, `purple`, `pink`, `gray`

---

## Sync Architecture

GitNotēs uses **clone mode**: local git working tree with commit-on-save and write-through push. See [Sync Architecture](./sync-architecture.md) for full details.

---

## Pro / Paywall

GitNotēs Pro is powered by **RevenueCat** with **StoreKit 2** on iOS.

- Entitlement ID: `GitNotēs Pro`
- Packages: Monthly, Yearly, Lifetime (configurable in RevenueCat dashboard)
- Feature gates: `useProGate()`, `useProScreenGuard()`
- Dev paywall override: `EXPO_PUBLIC_FORCE_ENABLE_PRO_ON_SIMULATOR` controls the Pro bypass on iOS Simulator and Android; `false` forces Free only on iOS Simulator and leaves Android on the real entitlement

See [Paywall & Pro Tier](./paywall.md) for full details.

---

## i18n

Six languages: **English, Spanish, French, German, Japanese, Korean**.

Translation files in `src/i18n/`. i18next framework. User preference stored in AsyncStorage.

---

## Key Conventions

| Convention | Rule |
|-----------|------|
| TypeScript | Strict mode — no `any` without justification |
| State | Zustand for all client state; React Context only for auth/theme |
| Services | Single-responsibility; all business logic in `src/services/` |
| Git worktrees | All agent work in `.worktrees/<branch>` — never edit main directly |
| Tests | Jest; new features get `__tests__/` mirrors of `src/` structure |
| Commits | Conventional Commits (`feat:`, `fix:`, `docs:`, etc.) |
| Lint | ESLint + Prettier; `lint-staged` on pre-commit |

---

## See Also

- [Services](./services.md) — Every service file catalogued
- [Stores](./stores.md) — Every Zustand store documented
- [Screens & Navigation](./screens.md) — All screens and route params
- [Hooks](./hooks.md) — Every custom hook
- [Models](./models.md) — Every TypeScript interface
- [Contexts](./contexts.md) — React context provider hierarchy
- [Sync Architecture](./sync-architecture.md) — Clone sync deep-dive
- [Git Engine](./git-engine.md) — Rust native module
- [Paywall & Pro Tier](./paywall.md) — RevenueCat and entitlements
