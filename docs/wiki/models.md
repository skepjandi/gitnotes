# Models Reference

> All TypeScript model interfaces. See [Architecture](./architecture.md) for how models relate to stores and services.

## Note

**File:** `src/models/Note.ts`

```typescript
interface Note {
  id: string;                    // Client-generated: Crypto.randomUUID() or timestamp+random fallback
  title: string;
  content: string;                // Raw content (Markdown, Neorg, Org, JSON)
  tags: string[];
  color?: NoteColor;              // 'red' | 'orange' | 'yellow' | 'green' | 'blue' | 'purple' | 'pink' | 'gray'
  repo?: string;                 // 'owner/repo' format
  branch?: string;                // git branch name
  commit?: string;               // git commit SHA of last save
  folderPath?: string;            // e.g. 'Work/Projects' (no leading slash)
  filePath?: string;             // Full path relative to repo root: 'Work/Projects/my-note.md'
  isPinned?: boolean;
  format?: NoteFormat;           // 'markdown' | 'neorg' | 'org' | 'pdf' | 'json'
  // NOTE: 'pdf' is retained in the type for legacy records that may exist in storage.
  // New PDF files are NOT imported as text notes (PDF was removed from NOTE_EXTS in RepoPullService).
  // Legacy PDF notes are searchable by title and tags only — body content is not scanned.
  attachments?: Attachment[];
  accountId?: string;             // Which account's repo this note belongs to
  createdAt: number;             // Unix timestamp ms
  updatedAt: number;              // Unix timestamp ms
}
```

**NoteColor:** `'red' | 'orange' | 'yellow' | 'green' | 'blue' | 'purple' | 'pink' | 'gray'`

**NoteFormat:** `'markdown' | 'neorg' | 'org' | 'pdf' | 'json'`

> **Legacy PDF note behaviour:** `'pdf'` is kept in the type to support records created by earlier versions of the app. New PDF files are **not** imported as text notes (the `pdf` extension was removed from `NOTE_EXTS` in `RepoPullService`). Legacy `'pdf'` notes are searchable by title and tags but their binary body content is skipped by `filterNotesBySearch` (the `note.format !== 'pdf'` guard).

**Key functions:** `createNote()`, `updateNote()`, `sortNotesByUpdated()`, `sortNotesWithPinnedFirst()`, `filterNotesBySearch()`, `filterNotesByFolder()`, `getNoteFileExtension()`

---

## Todo

**File:** `src/models/Todo.ts`

```typescript
interface Todo {
  id: string;
  title: string;
  content?: string;              // Optional extended description
  completed: boolean;
  dueDate?: number;             // Unix timestamp ms
  repo?: string;
  branch?: string;
  filePath?: string;
  tags: string[];
  createdAt: number;
  updatedAt: number;
}
```

---

## Canvas

**File:** `src/models/Canvas.ts`

```typescript
interface Canvas {
  id: string;
  title: string;
  tiles: CanvasTile[];          // Sparse tile data
  hotspots: Hotspot[];           // Interactive regions
  repo?: string;
  branch?: string;
  commit?: string;
  createdAt: number;
  updatedAt: number;
}

interface CanvasTile {
  id: string;
  x: number;
  y: number;
  width: number;
  height: number;
  type: 'image' | 'text' | 'drawing' | 'ai';
  content: string;              // JSON or base64 for images
  zIndex: number;
}

interface Hotspot {
  id: string;
  x: number;
  y: number;
  width: number;
  height: number;
  action: 'link' | 'note' | 'canvas' | 'url';
  target: string;               // Note ID, canvas ID, or URL
}
```

---

## Chat

**File:** `src/models/Chat.ts`

```typescript
interface ChatMessage {
  id: string;
  role: 'user' | 'assistant' | 'system';
  content: string;
  timestamp: number;
  kind?: 'text' | 'thought' | 'tool' | 'plan';   // absent on legacy messages
  toolCallId?: string; toolCallName?: string; toolCallArgs?: Record<string, unknown>; toolCallResult?: string;
  toolTitle?: string; toolKind?: ToolKind; toolStatus?: ToolStatus;   // pending | awaiting-approval | running | completed | failed | rejected
  toolDiffs?: ToolDiff[]; toolLocations?: ToolLocation[];
  plan?: PlanEntry[];
  attachedContexts?: AIContextItem[];
}

type ThreadBackend =
  | { type: 'model' }
  | { type: 'agent'; bridgeId; agentId; agentName; cwd; sessionId?; connectionId?; lastSeq?; pendingPromptId?; modeId?; availableModes? };

interface ChatThread {
  id; title; messages: ChatMessage[]; createdAt; updatedAt;
  repoOwner; repoName; branch; filePath;   // chat-repo location (model threads)
  backend?: ThreadBackend;                 // absent = model
}

interface ChatThreadSummary { id; title; updatedAt; messageCount; preview?; backend?: 'model' | 'agent'; agentName? }
```

`lastSeq` is persisted in the same snapshot as `messages`, so replaying a bridge after an app restart never duplicates or drops text.

---

## AIProvider

**File:** `src/models/AIProvider.ts`

```typescript
interface AIProvider {
  id: string;
  name: string;                  // 'Anthropic' | 'OpenAI' | 'Ollama' | 'AppleIntelligence'
  apiKey?: string;
  baseURL?: string;             // Custom endpoint for OpenAI-compatible providers
  model: string;                // e.g. 'claude-sonnet-4-20250514'
  isActive: boolean;
}
```

---

## Attachment

**File:** `src/models/Attachment.ts`

```typescript
interface Attachment {
  id: string;
  noteId: string;
  filename: string;              // Original filename
  mimeType: string;             // e.g. 'image/png'
  size: number;                 // bytes
  localPath?: string;           // Local cache path
  remotePath?: string;          // Git LFS pointer or CDN URL
  createdAt: number;
}
```

---

## Folder

**File:** `src/models/Folder.ts`

```typescript
interface Folder {
  id: string;
  name: string;                 // Display name, not the full path
  path: string;                 // Full path: 'Work/Projects/ClientA'
  repo: string;
  branch: string;
  parentPath?: string;           // Parent folder path
  noteCount: number;            // Cached count of notes in this folder
}
```

---

## Reminder

**File:** `src/models/Reminder.ts`

```typescript
interface Reminder {
  id: string;
  noteId?: string;              // Associated note (optional)
  title: string;
  dueDate: number;             // Unix timestamp ms
  repeatInterval?: 'daily' | 'weekly' | 'monthly';
  isCompleted: boolean;
  createdAt: number;
}
```

---

## ThoughtDump

**File:** `src/models/ThoughtDump.ts`

```typescript
interface ThoughtDump {
  id: string;
  content: string;              // Raw captured content
  targetRepo?: string;
  targetBranch?: string;
  targetFolder?: string;         // Where to save as a note
  createdAt: number;
}
```

---

## NeorgDocument

**File:** `src/models/NeorgDocument.ts`

```typescript
interface NeorgDocument {
  version: string;              // Neorg format version
  paragraphs: NeorgContent[];
  headings: NeorgHeading[];
  lists: NeorgList[];
  links: NeorgLink[];
  todoItems: NeorgTodoItem[];
  tags: string[];
}

interface NeorgHeading {
  level: 1 | 2 | 3 | 4 | 5 | 6;
  text: string;
  anchor?: string;
}

interface NeorgList {
  ordered: boolean;
  items: string[];
}

interface NeorgTodoItem {
  status: 'pending' | 'done' | 'pending_on' | 'running';
  content: string;
}
```

---

## NeorgContent

**File:** `src/models/NeorgContent.ts`

```typescript
interface NeorgContent {
  type: 'paragraph' | 'quote' | 'code' | 'divider';
  content: string;
  marks?: NeorgMark[];        // Bold, italic, code, etc.
}

interface NeorgMark {
  type: 'bold' | 'italic' | 'code' | 'underline' | 'strike';
  from: number;               // Start offset
  to: number;                 // End offset
}
```

---

## NeorgLink

**File:** `src/models/NeorgLink.ts`

```typescript
interface NeorgLink {
  type: 'wiki' | 'external' | 'anchor';
  target: string;              // 'Note Title' or 'https://...'
  displayText?: string;        // Custom display text
}
```

---

## NeorgInline

**File:** `src/models/NeorgInline.ts`

```typescript
interface NeorgInline {
  type: 'text' | 'mark' | 'link' | 'inlineMath' | 'inlineCode';
  content: string;
  from: number;
  to: number;
}
```

---

## See Also

- [Stores](./stores.md) — Zustand stores that hold model instances
- [Services](./services.md) — Services that create/update models
- [Architecture](./architecture.md) — Data flow
