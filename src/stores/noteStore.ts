import { useMemo } from 'react';
import { create } from 'zustand';
import * as FileSystem from 'expo-file-system/legacy';
import { Note, NoteCreateInput, NoteUpdateInput, NoteFormat, sortNotesWithPinnedFirst, filterNotesBySearch } from '../models/Note';
import { StorageService } from '../services/StorageService';
import { NoteSyncQueueService, CloneSyncService, type MutationSucceededEvent, type DroppedMutationEvent, type SaveResult } from '../services/cloneSyncServiceImpl';
import { CommitService } from '../services/git/CommitService';
import { commitRename } from '../services/git/commitOps';
import { resolveDefaultFolder, resolveDefaultRepo } from '../services/git/defaultsPolicy';
import { recordDeleteFailure } from '../services/git/deleteFailures';
import { gitOperationRegistry, useGitOperationStore } from './gitOperationStore';
import type { GitOp } from './gitOperationStore';
import { slugifyLocal, getExtensionForFormat } from '../components/editor/editorShared';
import { parseRepoPath } from '../utils/gitPathParser';
import { applyNoteTagsToContent, applyNoteColorToContent } from '../services/NoteGitHubSyncService';

function pathsEqual(a: { owner: string; repo: string } | null, b: { owner: string; repo: string }): boolean {
  return !!a && a.owner === b.owner && a.repo === b.repo;
}

/**
 * Finds the first available collision-safe untitled filename in the repo clone.
 * Scans the given folder for existing `untitled<N>.<ext>` files and returns
 * the next available name, e.g. `untitled.md`, `untitled1.md`, `untitled2.md`.
 */
async function findUntitledFilePath(
  repoPath: string,
  branch: string,
  folderPath: string,
  format: NoteFormat,
): Promise<string> {
  const normalizedFolder = folderPath.replace(/\/+$/, '');
  const ext = getExtensionForFormat(format);
  const prefix = `${normalizedFolder}/untitled`;

  const tree = await CloneSyncService.listTree(repoPath, branch);
  const existing = new Set(
    tree
      .filter((e) => e.type === 'blob' && e.path.startsWith(prefix) && e.path.endsWith(ext))
      .map((e) => e.path),
  );

  let counter = 0;
  let candidate = `${prefix}${ext}`;
  while (existing.has(candidate)) {
    counter += 1;
    candidate = `${prefix}${counter}${ext}`;
  }
  return candidate;
}



interface NoteState {
  notes: Note[];
  isLoading: boolean;
  error: string | null;
  searchQuery: string;
}

interface NoteActions {
  setSearchQuery: (query: string) => void;
  loadNotes: () => Promise<void>;
  createNote: (input: NoteCreateInput) => Promise<Note | null>;
  updateNote: (input: NoteUpdateInput) => Promise<Note | null>;
  /**
   * Upsert a note's content to git via CloneSyncService.
   * Returns SaveResult — caller (editor screen) decides navigation based on success.
   */
  upsertNote: (input: NoteUpdateInput & {
    repoPath: string;
    branch: string;
    filePath: string;
    content: string;
  }) => Promise<SaveResult>;
  deleteNote: (id: string) => Promise<boolean>;
  dropByFilePaths: (repo: string, paths: string[]) => Promise<number>;
  clearAllNotes: () => Promise<boolean>;
  getNoteById: (id: string) => Note | undefined;
  togglePin: (id: string) => Promise<boolean>;
  refreshNotes: () => Promise<void>;
  /** Reload note content from git working tree and sync to AsyncStorage after discard. */
  reloadNoteFromFile: (repo: string, filePath: string) => Promise<void>;
  clearError: () => void;
}

export function deriveDefaultNotePath(note: Note): string | null {
  const title = (note.title ?? '').trim();
  if (!title) return null;
  const slug = slugifyLocal(title);
  const ext = getExtensionForFormat(note.format);
  return note.folderPath ? `${note.folderPath}/${slug}${ext}` : `${resolveDefaultFolder('note')}${slug}${ext}`;
}

export const useNoteStore = create<NoteState & NoteActions>()((set, get) => ({
  notes: [],
  isLoading: true,
  error: null,
  searchQuery: '',

  setSearchQuery: (query) => set({ searchQuery: query }),

  loadNotes: async () => {
    try {
      set({ isLoading: true, error: null });
      const [loadedNotes, savedRepos] = await Promise.all([
        StorageService.getAllNotes(),
        StorageService.getSavedRepositories(),
      ]);
      // Drop notes whose backing repo was removed from settings on a build
      // that didn't yet purge per-repo data (issue: ghost notes from a
      // disconnected repo kept showing up in the list). Local-only notes
      // (no `repo` field) are always kept.
      const repoPaths = new Set(savedRepos.map((r) => r.path));
      const orphans = loadedNotes.filter((n) => n.repo && !repoPaths.has(n.repo));
      const survivors = loadedNotes.filter((n) => !n.repo || repoPaths.has(n.repo));
      if (orphans.length > 0) {
        await Promise.all(orphans.map((n) => StorageService.deleteNote(n.id)));
      }
      set({ notes: sortNotesWithPinnedFirst(survivors), isLoading: false });
    } catch (err) {
      set({ error: 'Failed to load notes', isLoading: false });
      console.error('Error loading notes:', err);
    }
  },

  createNote: async (input) => {
    let repo: string;
    try {
      repo = input.repo ?? await resolveDefaultRepo();
    } catch {
      set({ error: 'No repository configured' });
      return null;
    }
    try {
      set({ error: null });

      const title = (input.title ?? '').trim();
      const folderPath = input.folderPath ?? resolveDefaultFolder('note');
      const normalizedFolderPath = folderPath.replace(/\/+$/, '');
      const format = input.format ?? 'markdown';

      let filePath: string;
      if (input.filePath) {
        filePath = input.filePath;
      } else if (title) {
        const slug = slugifyLocal(title);
        const ext = getExtensionForFormat(format);
        filePath = `${normalizedFolderPath}/${slug}${ext}`;
      } else {
        filePath = await findUntitledFilePath(repo, input.branch ?? 'main', normalizedFolderPath, format);
      }

      const saveResult = await CloneSyncService.save({
        repoPath: repo,
        branch: input.branch ?? 'main',
        filePath,
        content: input.content ?? '',
        message: `Create note: ${title || filePath}`,
        intent: 'upsert',
      });
      if (!saveResult.success) {
        set({ error: saveResult.error ?? 'Failed to write note to disk' });
        return null;
      }

      const newNote = await StorageService.createNote({ ...input, repo, filePath });
      set((state) => ({ notes: sortNotesWithPinnedFirst([...state.notes, newNote]) }));
      return newNote;
    } catch (err) {
      set({ error: 'Failed to create note' });
      console.error('Error creating note:', err);
      return null;
    }
  },

  updateNote: async (input) => {
    try {
      set({ error: null });

      // Detect title/folder changes that would alter the derived path (rename).
      // In clone mode, use CommitService.commit with prevFilePath to produce one
      // atomic rename commit instead of a delete+create pair.
      const existingNote = get().notes.find((n) => n.id === input.id);
      const titleChanged = input.title !== undefined && existingNote?.title !== input.title;
      const folderPathChanged = input.folderPath !== undefined && existingNote?.folderPath !== input.folderPath;

      if (existingNote?.repo && (titleChanged || folderPathChanged)) {
        const oldPath = existingNote.filePath ?? deriveDefaultNotePath(existingNote);
        // Virtual note with the updated title/folderPath to derive new path
        const virtualNote = {
          ...existingNote,
          title: input.title ?? existingNote.title,
          folderPath: input.folderPath ?? existingNote.folderPath,
          format: input.format ?? existingNote.format,
        };
        const newPath = input.filePath ?? deriveDefaultNotePath(virtualNote);

        if (oldPath && newPath && oldPath !== newPath) {
          const content = input.content ?? existingNote.content ?? '';
          const opId = gitOperationRegistry.begin({
            kind: 'rename',
            repo: existingNote.repo,
            branch: existingNote.branch ?? 'main',
            path: newPath,
            entityIds: [existingNote.id],
            status: 'running',
            attempts: 0,
          });
          try {
            const author = await CommitService.resolveAuthor();
            const commitResult = await commitRename({
              repo: existingNote.repo,
              branch: existingNote.branch ?? 'main',
              prevFilePath: oldPath,
              filePath: newPath,
              content,
              message: `Rename note: ${input.title ?? existingNote.title}`,
              author,
            });
            if (!commitResult.success) {
              gitOperationRegistry.fail(opId, commitResult.error ?? 'Failed to rename note');
              set({ error: commitResult.error ?? 'Failed to rename note' });
              return null;
            }
            gitOperationRegistry.succeed(opId);
          } catch (renameError) {
            gitOperationRegistry.fail(opId, renameError instanceof Error ? renameError.message : 'Rename failed');
            throw renameError;
          }
          // Commit succeeded — update filePath on the note so subsequent syncs
          // use the correct path and don't try to re-create the file.
          input = { ...input, filePath: newPath };
        }
      }

      const updatedNote = await StorageService.updateNote(input);
      if (updatedNote) {
        set((state) => ({
          notes: sortNotesWithPinnedFirst(
            state.notes.map((note) => (note.id === updatedNote.id ? updatedNote : note))
          ),
        }));
      }
      return updatedNote;
    } catch (err) {
      set({ error: 'Failed to update note' });
      console.error('Error updating note:', err);
      return null;
    }
  },

  upsertNote: async (input) => {
    const { repoPath, branch, filePath, content } = input;

    try {
      const taggedContent = applyNoteColorToContent(
        applyNoteTagsToContent(content ?? '', input.format, input.tags ?? []),
        input.format,
        input.color,
      );
      const saveResult = await CloneSyncService.save({
        repoPath,
        branch,
        filePath,
        content: taggedContent,
        message: `Update note: ${input.title ?? filePath}`,
        intent: 'upsert',
      });
      if (!saveResult.success) {
        return saveResult;
      }
      const updatedNote = await StorageService.updateNote(input);
      if (updatedNote) {
        set((state) => ({
          notes: sortNotesWithPinnedFirst(
            state.notes.map((note) => (note.id === updatedNote.id ? updatedNote : note))
          ),
        }));
      }
      return saveResult;
    } catch {
      return { success: false, error: 'unknown' };
    }
  },

  deleteNote: async (id) => {
    try {
      set({ error: null });

      const note = get().notes.find((n) => n.id === id);
      if (!note) return false;

      if (note.repo) {
        const repoPath = note.repo;
        const filePath = note.filePath ?? deriveDefaultNotePath(note);
          if (filePath) {
            armDeleteCompletionHandlers();
            const beginDeleteOp = () =>
            gitOperationRegistry.begin({
              kind: 'delete',
              repo: repoPath,
              branch: note.branch,
              path: filePath,
              entityIds: [id],
              status: 'running',
              attempts: 0,
            });
          const opId = beginDeleteOp();
          try {
            const saveResult = await CloneSyncService.save({
              repoPath,
              branch: note.branch ?? 'main',
              filePath,
              message: `Delete note: ${note.title ?? filePath}`,
              intent: 'delete',
            });
            if (!saveResult.success) {
              gitOperationRegistry.fail(opId, saveResult.error ?? 'Failed to delete note');
              set({ error: saveResult.error ?? 'Failed to delete note' });
              return false;
            }
          } catch (commitError) {
            const commitErrorMessage =
              commitError instanceof Error ? commitError.message : 'Failed to delete note';
            gitOperationRegistry.fail(opId, commitErrorMessage);
            set({ error: commitErrorMessage });
            return false;
          }
          const success = await StorageService.deleteNote(id);
          if (success) {
            set((state) => ({ notes: state.notes.filter((n) => n.id !== id) }));
            gitOperationRegistry.succeed(opId);
          } else {
            gitOperationRegistry.fail(opId, 'Failed to delete note locally');
          }
          return success;
        }
        // Repo-backed note with no derivable path: nothing to enqueue, so
        // fall through to the instant local delete below.
      }

      // Local-only notes delete instantly.
      const success = await StorageService.deleteNote(id);
      if (success) {
        set((state) => ({ notes: state.notes.filter((n) => n.id !== id) }));
      }
      return success;
    } catch (err) {
      set({ error: 'Failed to delete note' });
      console.error('Error deleting note:', err);
      return false;
    }
  },

  dropByFilePaths: async (repo, paths) => {
    try {
      set({ error: null });
      const pathSet = new Set(paths);
      const repoPaths = parseRepoPath(repo);
      const matches = get().notes.filter((note) => {
        if (!note.repo) return false;
        const sameRepo =
          note.repo === repo ||
          (!!repoPaths && pathsEqual(parseRepoPath(note.repo), repoPaths));
        if (!sameRepo) return false;
        const filePath = note.filePath ?? deriveDefaultNotePath(note);
        return !!filePath && pathSet.has(filePath);
      });
      if (matches.length === 0) return 0;
      await Promise.all(matches.map((note) => StorageService.deleteNote(note.id)));
      const ids = new Set(matches.map((n) => n.id));
      set((state) => ({ notes: state.notes.filter((n) => !ids.has(n.id)) }));
      return matches.length;
    } catch (err) {
      set({ error: 'Failed to drop notes' });
      console.error('Error dropping notes:', err);
      return 0;
    }
  },

  clearAllNotes: async () => {
    try {
      set({ error: null });
      await StorageService.clearAllNotes();
      set({ notes: [] });
      return true;
    } catch (err) {
      set({ error: 'Failed to clear notes' });
      console.error('Error clearing notes:', err);
      return false;
    }
  },

  getNoteById: (id) => get().notes.find((note) => note.id === id),

  togglePin: async (id) => {
    try {
      set({ error: null });
      const note = get().notes.find((n) => n.id === id);
      if (!note) return false;

      const updatedNote = await StorageService.updateNote({
        id,
        isPinned: !note.isPinned,
      });

      if (updatedNote) {
        set((state) => ({
          notes: sortNotesWithPinnedFirst(
            state.notes.map((n) => (n.id === id ? updatedNote : n))
          ),
        }));
        return true;
      }
      return false;
    } catch (err) {
      set({ error: 'Failed to toggle pin' });
      console.error('Error toggling pin:', err);
      return false;
    }
  },

  refreshNotes: async () => {
    await get().loadNotes();
  },

  reloadNoteFromFile: async (repo: string, filePath: string) => {
    const info = parseRepoPath(repo);
    if (!info) return;
    const relPath = filePath.replace(/^\/+/, '');
    const repoDir = `${FileSystem.documentDirectory ?? ''}GitNotes/${info.owner}/${info.repo}`;
    const fullPath = `${repoDir}/${relPath}`;
    try {
      const content = await FileSystem.readAsStringAsync(fullPath);
      const pathSet = new Set([relPath]);
      const matches = get().notes.filter((note) => {
        if (!note.repo) return false;
        const sameRepo =
          note.repo === repo || (!!info && pathsEqual(parseRepoPath(note.repo), info));
        if (!sameRepo) return false;
        const notePath = note.filePath ?? deriveDefaultNotePath(note);
        return !!notePath && pathSet.has(notePath);
      });
      for (const note of matches) {
        const updated = await StorageService.updateNote({ id: note.id, content });
        if (updated) {
          set((state) => ({
            notes: sortNotesWithPinnedFirst(
              state.notes.map((n) => (n.id === updated.id ? updated : n)),
            ),
          }));
        }
      }
    } catch {
      // File may not exist or be readable —silently ignore
    }
  },

  clearError: () => set({ error: null }),
}));

export const useFilteredNotes = () => {
  const notes = useNoteStore((s) => s.notes);
  const searchQuery = useNoteStore((s) => s.searchQuery);
  return useMemo(
    () => {
      // Hide json-format notes from the list — these are leftovers from a
      // previous version of RepoFileSyncService that imported `.json` files
      // (resume schemas, package.json, etc.) as notes. The source is fixed,
      // but storage may still hold them until the next reconcile drops them.
      const noteOnly = notes.filter((n) => n.format !== 'json');
      return searchQuery ? filterNotesBySearch(noteOnly, searchQuery) : noteOnly;
    },
    [notes, searchQuery],
  );
};

// ── Delete-completion handlers ────────────────────────────────────────
// The registry never removes a note's local row itself — queued deletes
// complete asynchronously, so noteStore listens ONCE for the queue's
// success/drop side channels and finishes the job there.

let deleteHandlersArmed = false;

function normalizeBranchForMatch(branch: string | undefined): string {
  return branch || 'main';
}

function findNoteForDelete(mutation: {
  repo?: string;
  branch?: string;
  filePath?: string;
  localNoteId?: string;
}): Note | undefined {
  const { repo, branch, filePath, localNoteId } = mutation;
  if (!repo || !filePath) return undefined;
  const notes = useNoteStore.getState().notes;
  if (localNoteId) return notes.find((n) => n.id === localNoteId);
  return notes.find(
    (n) =>
      n.repo === repo &&
      normalizeBranchForMatch(n.branch) === normalizeBranchForMatch(branch) &&
      (n.filePath === filePath || deriveDefaultNotePath(n) === filePath),
  );
}

function deleteOpMatches(
  op: GitOp,
  repo: string,
  branch: string | undefined,
  filePath: string,
  localNoteId: string | undefined,
): boolean {
  if (op.kind !== 'delete') return false;
  const pathMatch =
    op.repo === repo && normalizeBranchForMatch(op.branch) === normalizeBranchForMatch(branch) && op.path === filePath;
  const entityMatch = !!localNoteId && op.entityIds.includes(localNoteId);
  return pathMatch || entityMatch;
}

function succeedDeleteOps(
  repo: string,
  branch: string | undefined,
  filePath: string,
  localNoteId: string | undefined,
): void {
  const { ops } = useGitOperationStore.getState();
  for (const [id, op] of Object.entries(ops)) {
    if (deleteOpMatches(op, repo, branch, filePath, localNoteId)) {
      useGitOperationStore.getState().succeed(id);
    }
  }
}

function failDeleteOps(
  repo: string,
  branch: string | undefined,
  filePath: string,
  localNoteId: string | undefined,
  error: string,
): void {
  const { ops } = useGitOperationStore.getState();
  for (const [id, op] of Object.entries(ops)) {
    if (deleteOpMatches(op, repo, branch, filePath, localNoteId)) {
      useGitOperationStore.getState().fail(id, error);
    }
  }
}

function onDeleteMutationSucceeded(event: MutationSucceededEvent): void {
  const mutation = event.mutation;
  if (mutation.type !== 'note.delete') return;
  const note = findNoteForDelete(mutation.params);
  if (note) {
    void StorageService.deleteNote(note.id).catch(() => undefined);
    useNoteStore.setState((state) => ({ notes: state.notes.filter((n) => n.id !== note.id) }));
  }
  succeedDeleteOps(mutation.params.repo ?? '', mutation.params.branch, mutation.params.filePath ?? '', mutation.params.localNoteId);
}

function onDeleteMutationDropped(event: DroppedMutationEvent): void {
  const mutation = event.mutation;
  if (mutation.type !== 'note.delete') return;
  failDeleteOps(
    mutation.params.repo ?? '',
    mutation.params.branch,
    mutation.params.filePath ?? '',
    mutation.params.localNoteId,
    event.error || 'Delete failed',
  );
  void recordDeleteFailure(
    mutation.params.repo ?? '',
    mutation.params.branch,
    mutation.params.filePath ?? '',
    {
      error: event.error || 'Delete failed',
      kind: event.reason ?? 'unknown',
      at: Date.now(),
    },
  );
}

/**
 * Registers the success/drop handlers exactly once. Guarded so test suites
 * that mock NoteSyncQueueService without the side-channel methods can still
 * import this store without crashing.
 */
function armDeleteCompletionHandlers(): void {
  if (deleteHandlersArmed) return;
  if (typeof NoteSyncQueueService.onMutationSucceeded !== 'function') return;
  if (typeof NoteSyncQueueService.onDroppedMutation !== 'function') return;
  NoteSyncQueueService.onMutationSucceeded(onDeleteMutationSucceeded);
  NoteSyncQueueService.onDroppedMutation(onDeleteMutationDropped);
  deleteHandlersArmed = true;
}

armDeleteCompletionHandlers();
