import * as FileSystem from 'expo-file-system/legacy';

import type { GitRepository } from '../GitService';
import type * as ManualSync from './manualSync';
import * as GitEngine from './engine/GitEngine';
import { GitFsService } from './GitFsService';
import { CommitService } from './CommitService';
import {
  isCrdtNotePath,
  notePathForSidecar,
  readSidecar,
  sidecarPathForNote,
  writeSidecar,
} from '../crdt/crdtSidecar';
import {
  mergeNoteSides,
  sidecarForResolvedText,
  sidecarForSave,
  sidecarMatchesText,
  splitNote,
  type NoteSide,
} from '../crdt/noteCrdt';

export type ConflictChoice = 'ours' | 'theirs' | 'both' | 'edit';

export function getConflictChoiceContent(
  blobs: GitEngine.ConflictBlobs,
  choice: ConflictChoice,
): string {
  switch (choice) {
    case 'ours':
      return blobs.ours;
    case 'theirs':
      return blobs.theirs;
    case 'both':
      return [blobs.ours, blobs.theirs].filter((content) => content.length > 0).join('\n');
    case 'edit': {
      const ours = blobs.ours.endsWith('\n') ? blobs.ours : `${blobs.ours}\n`;
      const theirs = blobs.theirs.endsWith('\n') ? blobs.theirs : `${blobs.theirs}\n`;
      return `<<<<<<< ours\n${ours}=======\n${theirs}>>>>>>> theirs\n`;
    }
  }
}

interface SidecarSides {
  ours: string | null;
  theirs: string | null;
}

/**
 * Both sidecar versions. When the sidecar did not conflict, Git kept the single copy that one
 * device changed; `texts` identifies which side's note it belongs to so the other side is
 * rebuilt from the base instead of being rolled back to this copy.
 */
async function loadSidecarSides(
  localPath: string,
  notePath: string,
  texts?: { ours: string; theirs: string },
): Promise<SidecarSides> {
  const sidecarPath = sidecarPathForNote(notePath);
  const conflicted = (await GitEngine.conflicts(localPath)).some((entry) => entry.path === sidecarPath);
  if (conflicted) {
    const blobs = await GitEngine.getConflictBlobs(localPath, sidecarPath);
    return { ours: blobs.ours || null, theirs: blobs.theirs || null };
  }
  const current = await readSidecar(localPath, notePath);
  if (!texts) return { ours: current, theirs: current };
  return {
    ours: sidecarMatchesText(current, texts.ours) ? current : null,
    theirs: sidecarMatchesText(current, texts.theirs) ? current : null,
  };
}

interface NoteConflictSides {
  base: string;
  ours: NoteSide;
  theirs: NoteSide;
}

async function loadNoteConflict(localPath: string, notePath: string): Promise<NoteConflictSides> {
  const blobs = await GitEngine.getConflictBlobs(localPath, notePath);
  const sidecars = await loadSidecarSides(localPath, notePath, {
    ours: blobs.ours,
    theirs: blobs.theirs,
  });
  return {
    base: blobs.base || '',
    ours: { text: blobs.ours, sidecar: sidecars.ours },
    theirs: { text: blobs.theirs, sidecar: sidecars.theirs },
  };
}

/** Auto-merged note text for a conflicted Markdown note, combining both devices' CRDT histories. */
export async function computeCrdtMerge(repo: Pick<GitRepository, 'path'>, notePath: string): Promise<string> {
  const localPath = GitFsService.workingTreeUri({ repoPath: repo.path });
  return mergeNoteSides(await loadNoteConflict(localPath, notePath)).text;
}

interface SidecarOnlyConflict {
  base: string;
  head: string;
  ours: NoteSide;
  theirs: NoteSide;
}

/**
 * A sidecar can conflict while Git merged the note cleanly (both devices edited different
 * lines). The note on disk then serves as the seed for any side missing a sidecar.
 */
async function loadSidecarOnlyConflict(
  localPath: string,
  notePath: string,
): Promise<SidecarOnlyConflict> {
  const [current, sidecars] = await Promise.all([
    FileSystem.readAsStringAsync(`${localPath}/${notePath}`),
    loadSidecarSides(localPath, notePath),
  ]);
  return {
    base: current,
    head: splitNote(current).head,
    ours: { text: null, sidecar: sidecars.ours },
    theirs: { text: null, sidecar: sidecars.theirs },
  };
}

/** Merged note text when only the CRDT sidecar conflicted. */
export async function computeSidecarOnlyMerge(repo: GitRepository, notePath: string): Promise<string> {
  const localPath = GitFsService.workingTreeUri({ repoPath: repo.path });
  const { base, head, ours, theirs } = await loadSidecarOnlyConflict(localPath, notePath);
  return head + mergeNoteSides({ base, ours, theirs }).text;
}

async function commitResolution(
  repo: Pick<GitRepository, 'id'>,
  localPath: string,
  message: string,
): Promise<void> {
  const resolved = await CommitService.resolveAuthor(repo.id);
  // resolveAuthor can return an empty email (no saved author, no host profile); git rejects that.
  const author = {
    name: resolved.name.trim() || 'GitNotes',
    email: resolved.email.trim() || 'gitnotes@local',
  };
  await GitEngine.commit(localPath, message, author);
}

async function commitPushAndPull(
  repo: GitRepository,
  localPath: string,
  filePath: string,
): Promise<void> {
  await commitResolution(repo, localPath, `Resolve conflict: ${filePath}`);

  const pushResult = await GitEngine.push(localPath, 'origin', repo.id);
  if (!pushResult.ok) {
    throw new Error(pushResult.error ?? 'Failed to push resolved conflict');
  }

  // Lazy: manualSync -> RepoPullService -> stores -> cloneSyncService -> GitFsService, and GitFsService
  // imports this module for the pull-time CRDT auto-merge, so a static import is a load-time cycle.
  const { syncNow } = require('./manualSync') as typeof ManualSync;
  const pullResult = await syncNow({ repos: [repo.path], source: 'manual' });
  if (!pullResult.ok) {
    throw new Error(pullResult.error ?? 'Resolved conflict pushed, but pull failed');
  }
}

async function writeResolvedNote(
  localPath: string,
  notePath: string,
  content: string,
  sidecar: string | null,
): Promise<void> {
  // Both files reach disk before either is staged: a failed write leaves the conflict stages intact.
  await FileSystem.writeAsStringAsync(`${localPath}/${notePath}`, content);
  if (sidecar !== null) await writeSidecar(localPath, notePath, sidecar);
  await GitEngine.markConflictResolved(localPath, notePath);
  if (sidecar !== null) await GitEngine.markConflictResolved(localPath, sidecarPathForNote(notePath));
}

/**
 * Sidecar recording `content` as the resolved text. Staging a note drops its conflict stages, so when
 * an earlier attempt already staged it (commit/push failed and the user retries) both sides are gone
 * from the index; the sidecar that attempt wrote holds their union and just takes the new text on top.
 */
async function sidecarForResolution(
  localPath: string,
  notePath: string,
  content: string,
): Promise<string> {
  const stillConflicted = (await GitEngine.conflicts(localPath)).some((entry) => entry.path === notePath);
  if (stillConflicted) {
    return sidecarForResolvedText({
      ...(await loadNoteConflict(localPath, notePath)),
      finalText: content,
    });
  }
  return sidecarForSave({
    sidecar: await readSidecar(localPath, notePath),
    previousText: content,
    content,
  });
}

export async function resolveConflictAndSync(
  repo: GitRepository,
  filePath: string,
  content: string,
): Promise<void> {
  const localPath = GitFsService.workingTreeUri({ repoPath: repo.path });
  const sidecar = repo.crdtMergeEnabled === true && isCrdtNotePath(filePath)
    ? await sidecarForResolution(localPath, filePath, content)
    : null;
  await writeResolvedNote(localPath, filePath, content, sidecar);
  await commitPushAndPull(repo, localPath, filePath);
}

/**
 * Stage a note whose only conflict is its CRDT sidecar. `content` is the final text; when omitted
 * the CRDT merge of both sidecars is used. Returns the text that was staged.
 */
async function stageSidecarOnlyResolution(
  localPath: string,
  notePath: string,
  content?: string,
): Promise<string> {
  const { base, head, ours, theirs } = await loadSidecarOnlyConflict(localPath, notePath);
  const finalText = content ?? head + mergeNoteSides({ base, ours, theirs }).text;
  const sidecar = sidecarForResolvedText({ base, ours, theirs, finalText });
  await writeResolvedNote(localPath, notePath, finalText, sidecar);
  return finalText;
}

/** Resolve a note whose only conflict is its CRDT sidecar, recording `content` as the final text. */
export async function resolveSidecarConflictAndSync(
  repo: GitRepository,
  notePath: string,
  content: string,
): Promise<void> {
  const localPath = GitFsService.workingTreeUri({ repoPath: repo.path });
  await stageSidecarOnlyResolution(localPath, notePath, content);
  await commitPushAndPull(repo, localPath, notePath);
}

/**
 * Merge every conflict a pull or push-integrate left behind without asking the user, when the
 * repository opted into CRDT merge and all conflicts are mergeable notes (or their sidecars).
 * Stages the merged notes and records one merge commit; the caller pushes. Returns true only when
 * the working tree has no conflicts left. Anything structural (edit-vs-delete, non-note files, a
 * merge error) leaves the index for the conflict screen.
 */
export async function autoMergeCrdtConflicts(
  repo: Pick<GitRepository, 'id' | 'path' | 'crdtMergeEnabled'>,
): Promise<boolean> {
  if (repo.crdtMergeEnabled !== true) return false;
  const localPath = GitFsService.workingTreeUri({ repoPath: repo.path });
  try {
    const entries = await GitEngine.conflicts(localPath);
    if (entries.length === 0) return false;

    const conflicted = new Set(entries.map((entry) => entry.path));
    const notes: string[] = [];
    const sidecarOnly: string[] = [];
    for (const { path } of entries) {
      const noteOfSidecar = notePathForSidecar(path);
      if (noteOfSidecar !== null) {
        if (!conflicted.has(noteOfSidecar)) sidecarOnly.push(noteOfSidecar);
        continue;
      }
      if (!isCrdtNotePath(path)) return false;
      // A missing stage reads as empty: that side deleted the note, which stays the user's call.
      const blobs = await GitEngine.getConflictBlobs(localPath, path);
      if (!blobs.ours || !blobs.theirs) return false;
      notes.push(path);
    }

    for (const notePath of notes) {
      const merged = await computeCrdtMerge(repo, notePath);
      await writeResolvedNote(localPath, notePath, merged, await sidecarForResolution(localPath, notePath, merged));
    }
    for (const notePath of sidecarOnly) {
      await stageSidecarOnlyResolution(localPath, notePath);
    }
    if ((await GitEngine.conflicts(localPath)).length > 0) return false;
    await commitResolution(repo, localPath, `Auto-merge conflicts (CRDT): ${[...notes, ...sidecarOnly].join(', ')}`);
    return true;
  } catch (caught) {
    // Notes staged so far stay resolved; the conflict screen finishes the rest.
    console.warn('[ConflictResolve] CRDT auto-merge failed:', caught);
    return false;
  }
}
