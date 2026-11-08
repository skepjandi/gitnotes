# Sync Architecture

> Deep-dive on GitNotēs' clone sync. See [Architecture](./architecture.md) for context and [Services](./services.md) for the underlying services.

GitNotēs uses **clone mode**: local git working tree with working-tree-first saves and user-controlled commits.

## Clone Mode

Clone mode is designed for **offline-first** usage. Changes are written locally, then staged and committed by the user before being pushed asynchronously.

### Save Flow

```
User edits note
  → NoteEditorScreen saves
    → CloneSyncService.save({ intent: 'upsert', content, filePath, ... })
      → File written to working tree: <documentDir>/GitNotes/<owner>/<repo>/<path>.md
        → CloneSyncService returns { success: true }
          → User stages and commits from the Git workspace or floating Git button
```

Delete operations remove the working-tree file without staging the deletion, so the user can review, stage, and commit it from the Git workspace.

### Intentional Local Commits

Most user mutations remain unstaged so they can be reviewed in the Git workspace. The following flows intentionally create a local commit because they require an atomic or recovery transition:

- Note renames commit the old-path deletion and new-path write together.
- Conflict resolution commits the selected resolution after the conflict is marked resolved.
- Clone migration commits legacy local data into the newly initialized clone.

### Explore File Editing (Raw Working-Tree Write)

When editing a file from the Git → Files tab:
- `ExploreFileScreen` loads the file content from the local working tree
- Save writes the exact UTF-8 content back to the working tree via `WorkingTreeDocumentService`
- No staging, committing, pushing, queue enqueue, or branch checkout occurs
- The file appears as an unstaged modification in the Git workspace
- User reviews, stages, commits, and pushes from the existing Git workspace

### Push Triggers

After a local commit, push is triggered automatically by any of:

1. **Foreground-active transition** — `AppState` changes to `active`; the app came to the foreground
2. **Online transition** — `NetInfo` fires an event indicating the device is now online
3. **3-minute idle timer** — `ClonePushTriggers` fires after 3 minutes of no user activity
4. **OS background task** — On iOS/Android, `expo-background-task` runs a sync job (up to 50 files per invocation)

```
tryPushNow (8 second budget)
  → GitHub API push (git push origin <branch>)
    → Success: clear pending queue
    → 409 Conflict: → ConflictResolverScreen (blocks user)
    → Network error: → re-queue, retry on next trigger
```

### Offline Queue

When offline, mutations are queued in `NoteSyncQueueService` (persisted to AsyncStorage). **ClonePendingQueue is fictional — not implemented.**

Queue items explicitly track branch identity:

```typescript
interface QueueItem {
  id: string;
  repoId: string;
  repoPath: string;
  branch: string;         // ← branch identity required on every item
  entityType: EntityType; // 'note' | 'canvas' | 'todo' | 'journal'
  entityId: string;
  payload: Record<string, unknown>;
  status: 'pending' | 'paused' | 'done' | 'failed';
  createdAt: number;
  attempts: number;
}
```

**Branch-aware drain:** `dequeue(repoId, branch)` returns only items matching both `repoId` AND `branch`. On checkout, all non-active-branch items are paused via `pauseAllExcept(activeRepoId, activeBranch)`. This prevents cross-branch sync drift.

**Queue isolation:** When `GitBranchCoordinator.checkout()` succeeds, it calls `pauseAllExcept(activeRepoId, activeBranch)` to isolate the queue to the newly checked-out branch. Only items matching both the active `repoId` and `activeBranch` remain in `pending` status; all others are marked `paused`. Drained items are verified against local HEAD before processing.

**Preserved internal branch payloads:** Every `QueueItem` stores `branch` as a required field. This branch identity is preserved across pause/resume cycles and is never stripped or defaulted. On `resumeForBranch`, items are only resumed if local HEAD still matches the expected branch.

**Stale-state reconciliation:** If local HEAD has changed since an item was queued (e.g., user switched branches), the item is marked `paused` rather than processed, preventing mutations from being applied to the wrong branch.

```
CloneSyncService.save (offline)
  → NoteSyncQueueService.enqueue({ repoId, repoPath, branch, ... })
    → Returns { success: true, queued: true }

Network restored (NetInfo online-transition)
  → NoteSyncQueueService.drain(repoId, activeBranch)
    → Only items matching active branch are returned (and HEAD verified)
      → Push via tryPushNow
```

**Queue pause semantics:** When the user switches to a different branch, `pauseForBranchSwitch(branch)` marks all that branch's pending items as `paused`. They are resumed (marked `pending` again) only when the user switches back to that branch and HEAD still matches — stale branch state produces an error, not silent fallback to `main`.

### Clone Storage Location

All cloned repositories are stored under:

```
<documentDirectory>/GitNotes/<owner>/<repo>/
```

On iOS: `FileSystem.documentDirectory + "GitNotes/" + owner + "/" + repo + "/"`

### Conflict Resolution

When `git push` returns 409 (non-fast-forward) or the remote has diverged:

```
tryPushNow → 409 Conflict
  → Navigate to ConflictResolverScreen
    → User resolves: keep local / keep remote / manual merge
      → On keep-local: force push (`git push --force`)
      → On keep-remote: discard local changes, re-clone from remote
      → On manual merge: user edits the conflicting file directly, then re-saves to the working tree for review
```

### Push Marker Preflight/Postflight Coordination

`GitSyncGate` coordinates push/pull races via per-repo push markers:

- **`markPushActive(repo, branch)`** — set before a mutation flight (drain group, write); publishes a running op to the git-operation registry
- **`clearPushActive(repo, branch)`** — clear after push completes; registry op succeeds
- **`waitForIdle(repo?)`** — preflight wait; pull steps call this before reading origin to avoid the deleted-note resurrection window (pulling mid-push can resurrect deleted files)

Single-repo syncs wait only on that repo's markers; all-repos syncs wait app-wide because any push could affect the read.

```
manualSync / ForegroundSync
  → waitForIdle(repo)         # preflight: wait for in-flight pushes to clear
  → pullFromSingleRepo(repo)  # native GitEngine pull reads origin and updates the worktree
  → refresh stores
```

### Branch Checkout Refresh

`GitBranchCoordinator.checkout()` keeps branch-dependent app state aligned with
the newly checked-out working tree. After the checkout succeeds, it updates
`activeBranchStore`, pauses queued mutations for other repositories or
branches through `NoteSyncQueueService.pauseAllExcept`, and emits a checkout
content-refresh event. The note, todo, canvas, and folder providers reload
their stores from that event. Note, canvas, and Explore file editors subscribe
to the checkout event and navigate back to their list screen so they cannot
continue displaying content from the previous branch.

The event is distinct from the ordinary git-status refresh event. Status
refreshes update git metadata, while checkout content refreshes invalidate
branch-dependent UI and preserve queue branch isolation.

### Push Trigger Sources (code references)

| Trigger | Location |
|---------|----------|
| AppState active | `App.ts` / foreground sync hooks |
| NetInfo online | `useNetworkStatus` hook |
| Idle timer | `ClonePushTriggers` |
| Background task | `BackgroundSyncService` |

---

## Sync State Machine

```
                    ┌──────────────────────────────────────┐
                    │                                      │
    ┌──────┐      ┌▼────────┐     ┌──────┐    ┌────────▼────────┐
 ───►│ IDLE │──────►│ COMMITTING │───►│ PUSHING │───►│ PUSH_COMPLETE │
    └──┬───┘      └──────┬───┘     └──┬────┘    └─────────┬──────┘
       ▲                    │           │                    │
       │                    │ 409       │ error             │ pull
       │                    ▼           ▼                    ▼
       │              ┌──────────┐ ┌────────┐        ┌─────────┐
       └──────────────►│ CONFLICT │ │RETRY   │        │PULLING  │
                      │ (blocked)│ └────────┘        └────┬────┘
                      └──────────┘                          │
                                                             ▼
                                                        ┌─────────┐
                                ┌───────────────────────►│  IDLE  │
                                │                         └─────────┘
                                │ local changes
                                ▼
                          ┌───────────┐
                          │  DIRTY   │◄── new edit
                          └─────┬─────┘
                                │
                                ▼
(stage and commit from Git workspace)
```

---

## Optional CRDT Merge (per repository)

Off by default. **Settings → Repositories → Auto-merge note edits (CRDT)** sets `GitRepository.crdtMergeEnabled` for that repo only (`useRepoStore.setCrdtMergeEnabled`); other repos keep pure Git merge.

When on, `NoteGitHubSyncService` passes `crdtEnabled` to `CloneSyncService.save`. For Markdown notes it then also writes `.gitnotes/crdt/<note path>.crdt` — the base64 Yjs state of the note **body** (`src/services/crdt/`). Frontmatter is not merged by the CRDT; on conflict the side with the later `updatedAt` wins. Git stays the transport: the sidecar is a normal working-tree file that is staged, committed and pushed with the note.

On conflict (`ConflictResolveScreen`) the first option is **Use CRDT merge**: both sidecars (the index `ours`/`theirs` stages) are unioned (`mergeNoteSides`) and the merged body is offered as the resolution. Whatever final text the user picks, `resolveConflictAndSync` writes a sidecar holding the union of both histories plus that text, and resolves the conflicted sidecar with the note. Staging the note drops its conflict stages, so a retry after a failed commit/push (the screen stays open) no longer reads the stages: it reuses the sidecar written by the earlier attempt and records the final text on top. If only the sidecar conflicts (Git merged the note cleanly) the screen resolves it via `resolveSidecarConflictAndSync`.

**Auto-merge.** Before the conflict screen is ever shown, `autoMergeCrdtConflicts(repo)` runs from the two choke points of every pull and push: `GitFsService.pullWithFastForward` (when the native pull reports conflicts) and the `GitEngine.pushWithIntegrate` facade (when the result is `Conflicts`, then the push is retried). For a repo with CRDT on, when every conflicted path is a Markdown note with content on both stages (or the sidecar of one) it merges each note from both sidecars, stages note + sidecar, and commits once (`Auto-merge conflicts (CRDT): …`). Anything else (edit-vs-delete, non-note files, a merge error) leaves the index for `ConflictResolveScreen`, which still offers **Use CRDT merge**.

Notes without a sidecar are seeded from their text with a client id derived from that text, so devices that start from the same text share one history instead of duplicating it. Sidecars are reconciled to the note text by character diff, so edits made outside the app are not lost. Deleting a note deletes its sidecar; delete-vs-edit stays a Git structural conflict. Sidecar size is unbounded (no compaction yet).

---

## Key Services

| Service | Role |
|---------|------|
| `CloneSyncService` | Clone mode working-tree file writes; does not stage or commit |
| `NoteSyncQueueService` | AsyncStorage-backed branch-aware mutation queue; tracks `{ repoId, repoPath, branch }` per item; drains only active-branch items |
| `BackgroundSyncService` | OS background sync task |
| `ForegroundSyncService` | Foreground change monitoring |
| `RepoPullService` | Pull changes from remote |
| `ConflictResolverScreen` | User-facing conflict UI |
| `GitEngine.stage` | Stage files for commit (Rust) |
| `GitSyncGate` | App-wide cycle mutex + per-repo push markers; preflight wait before pull |
| `GitBranchCoordinator` | Checkout safety state machine; blocks checkout when files are staged/modified/conflicted |

---

## See Also

- [Services](./services.md) — All sync-related services
- [Stores](./stores.md) — RepoStore sync state
- [Architecture](./architecture.md) — Context
