# Contexts Reference

> All React contexts and their provider hierarchy. See [Architecture](./architecture.md) for how contexts relate to screens and stores.

## Context Provider Hierarchy

The canonical nesting is in `App.tsx`. From outermost to innermost:

```
App
├── QueryClientProvider         (TanStack Query)
├── SafeAreaProvider
├── ThemeProvider
├── NativeWindThemeProvider
├── AccountsContext.Provider
│   └── HostAuthContext.Provider
│       └── RepoContext.Provider
│           └── FolderContext.Provider
│               └── NoteContext.Provider
│                   └── BacklinksContext.Provider
│                       └── TodoContext.Provider
│                           └── CanvasContext.Provider
│                               └── ViewModeContext.Provider
│                                   └── BiometricLockContext.Provider
│                                       ├── StatusBar
│                                       ├── StartupSyncGate
│                                       │   ├── CheckoutSafetyProvider
│                                       │   │   └── AppNavigator
│                                       │   │       └── ExploreScreen
│                                       ├── GitHubActivityIndicator
│                                       ├── SyncBlockOverlay
│                                       └── BiometricLockScreen
```

> **Note:** `AuthContext` (app-level auth lock) and `GitHubAuthContext` (GitHub OAuth) are NOT in the provider tree in App.tsx. They are consumed directly by screens that need them.

## AccountsContext

**Purpose:** Provides access to all connected accounts (GitHub, GitLab, Gitea).

**Provides:**
```typescript
{
  accounts: Account[];
  activeAccount: Account | null;
  addAccount: (account: Account) => void;
  removeAccount: (accountId: string) => void;
  setActiveAccount: (accountId: string) => void;
}
```

**Consumed by:** `useAccounts()` hook, `AddRepoModal`, `SettingsScreen`

---

## AuthContext

**Purpose:** App-level authentication state — whether the user has unlocked the app.

**Provides:**
```typescript
{
  isAuthenticated: boolean;
  isLocked: boolean;
  authenticate: (method: 'biometric' | 'pin') => Promise<boolean>;
  lock: () => void;
}
```

**Consumed by:** `BiometricLockScreen`, `AppNavigator`

---

## HostAuthContext

**Purpose:** Authentication for the currently active git host (GitHub, GitLab, Gitea).

**Provides:**
```typescript
{
  hostAuth: HostAuth | null;
  isAuthenticated: boolean;
  authenticate: (host: GitHost, token: string) => Promise<void>;
  signOut: (host: GitHost) => Promise<void>;
}
```

**Consumed by:** `AddRepoModal`, `CloneProgressModal`, `RepoTreeItem`

---

## GitHubAuthContext

**Purpose:** GitHub-specific OAuth authentication.

**Provides:**
```typescript
{
  githubToken: string | null;
  isAuthenticated: boolean;
  signIn: () => Promise<void>;
  signOut: () => Promise<void>;
}
```

**Consumed by:** `OnboardingScreen`, `ExploreScreen` (for GitHub API queries)

---

## BiometricLockContext

**Purpose:** Manages the optional biometric lock state, biometric availability metadata, and unlock prompt.

**Provides:**
```typescript
{
  isLockEnabled: boolean;
  setIsLockEnabled: (enabled: boolean) => Promise<boolean>;
  lockTimeout: LockTimeout;
  setLockTimeout: (timeout: LockTimeout) => void;
  isLocked: boolean;
  isBiometricAvailable: boolean;
  biometricKind: BiometricKind;
  biometricLabel: string;
  authenticate: () => Promise<boolean>;
}
```

**Behavior:** Persisted lock settings restore `isLocked` during provider initialization. `BiometricLockScreen` automatically starts one biometric attempt for each lock session when biometrics are available; its Unlock button remains available for retry after cancellation or failure.

**Consumed by:** `BiometricLockScreen` (rendered as an app-level overlay by `App.tsx`)

---

## RepoContext

**Purpose:** Provides the currently selected repository.

**Provides:**
```typescript
{
  selectedRepo: Repo | null;
  repos: Repo[];
  selectRepo: (repoId: string) => void;
  addRepo: (repo: Repo) => void;
  removeRepo: (repoId: string) => void;
  refreshRepos: () => Promise<void>;
}
```

**Consumed by:** `useRepoStore()`, `RepoFileBrowser`, `NoteEditorScreen`, `NotesListScreen`

---

## FolderContext

**Purpose:** Provides the currently selected folder within the active repo.

**Provides:**
```typescript
{
  selectedFolderPath: string | null;
  folders: Folder[];
  selectFolder: (path: string | null) => void;
  createFolder: (path: string) => Promise<void>;
  deleteFolder: (path: string) => Promise<void>;
}
```

**Consumed by:** `NotesListScreen`, `NoteEditorScreen`, `RepoFileBrowser`

---

## NoteContext

**Purpose:** Provides the currently selected note and CRUD operations.

**Provides:**
```typescript
{
  selectedNote: Note | null;
  notes: Note[];
  selectNote: (noteId: string | null) => void;
  createNote: (input: NoteCreateInput) => Promise<Note>;
  updateNote: (id: string, input: NoteUpdateInput) => Promise<Note>;
  deleteNote: (id: string) => Promise<void>;
  reloadNotes: () => Promise<void>;
}
```

**Consumed by:** `NoteEditorScreen`, `BacklinksSection`, `NotesListScreen`

---

## BacklinksContext

**Purpose:** Computes and caches notes that link to the current note.

**Provides:**
```typescript
{
  backlinks: Note[];
  isLoading: boolean;
  refreshBacklinks: (noteId: string) => Promise<void>;
}
```

**Consumed by:** `BacklinksSection` component in `NoteEditorScreen`

---

## TodoContext

**Purpose:** Provides the currently selected todo and CRUD operations.

**Provides:**
```typescript
{
  selectedTodo: Todo | null;
  todos: Todo[];
  selectTodo: (todoId: string | null) => void;
  createTodo: (input: TodoCreateInput) => Promise<Todo>;
  updateTodo: (id: string, input: TodoUpdateInput) => Promise<Todo>;
  deleteTodo: (id: string) => Promise<void>;
  toggleComplete: (id: string) => Promise<void>;
}
```

**Consumed by:** `TodoListScreen`, `TodoEditorModal`

---

## CanvasContext

**Purpose:** Provides the currently selected canvas and tile operations.

**Provides:**
```typescript
{
  selectedCanvas: Canvas | null;
  canvases: Canvas[];
  selectCanvas: (canvasId: string | null) => void;
  createCanvas: (input: CanvasCreateInput) => Promise<Canvas>;
  updateCanvas: (id: string, input: CanvasUpdateInput) => Promise<Canvas>;
  deleteCanvas: (id: string) => Promise<void>;
  updateTile: (canvasId: string, tile: CanvasTile) => void;
}
```

**Consumed by:** `CanvasEditorScreen`, `CanvasListScreen`

---

## ThemeContext

**Purpose:** Provides theme colors, style, and dark mode state, plus an optional global accent color override.

**Provides:**
```typescript
{
  theme: 'light' | 'dark' | 'system';
  isDark: boolean;
  style: 'neumorphic' | 'flat';
  colors: Palette;
  accentColor: string | null;
  setTheme: (theme: 'light' | 'dark' | 'system') => void;
  setStyle: (style: 'neumorphic' | 'flat') => void;
  setAccentColor: (color: string | null) => void;
  tokens: Tokens;
}
```

**Palette:** `{ bg, surface, highlight, shadow, text, textSecondary, accent, accentMuted, error, success, warning, background, surfaceSecondary, primary, border, card, elevated }`

**Accent color override:** `accentColor` is `null` by default, meaning no custom override is applied. When set to a valid six-digit hex color, both `accent` and `primary` in the palette are replaced with that color, and `accentMuted` is derived deterministically using HSL math that preserves hue while shifting lightness based on dark/light mode. Setting to `null` resets to the active theme's built-in defaults. The value persists locally via AsyncStorage under `@gitnotes:accent`.

**Tokens:** `{ colors: Palette, radii, spacing, type }` — the full design token set derived from the current palette.

**Consumed by:** All screens and components via `useTheme()` hook

---

## ViewModeContext

**Purpose:** Provides global view mode preferences (list vs grid, sort order).

**Provides:**
```typescript
{
  notesViewMode: 'list' | 'grid';
  todosViewMode: 'list' | 'grid';
  notesSortOrder: SortOrder;
  todosSortOrder: SortOrder;
  setNotesViewMode: (mode: 'list' | 'grid') => void;
  setTodosViewMode: (mode: 'list' | 'grid') => void;
  setNotesSortOrder: (order: SortOrder) => void;
  setTodosSortOrder: (order: SortOrder) => void;
}
```

**Consumed by:** `NotesListScreen`, `TodoListScreen`, `SettingsScreen`

---

## See Also

- [Stores](./stores.md) — Zustand stores often wrapped by contexts
- [Architecture](./architecture.md) — Provider hierarchy diagram
- [Screens](./screens.md) — Screens that consume contexts
