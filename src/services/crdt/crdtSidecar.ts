import * as FileSystem from 'expo-file-system/legacy';

import { sidecarForSave } from './noteCrdt';

const SIDECAR_ROOT = '.gitnotes/crdt/';
const SIDECAR_SUFFIX = '.crdt';

/** CRDT merge applies to Markdown notes only; sidecars never get sidecars of their own. */
export function isCrdtNotePath(relPath: string): boolean {
  return relPath.toLowerCase().endsWith('.md') && !relPath.startsWith('.gitnotes/');
}

export function sidecarPathForNote(notePath: string): string {
  return `${SIDECAR_ROOT}${notePath}${SIDECAR_SUFFIX}`;
}

/** Inverse of `sidecarPathForNote`; null when `path` is not a sidecar. */
export function notePathForSidecar(path: string): string | null {
  if (!path.startsWith(SIDECAR_ROOT) || !path.endsWith(SIDECAR_SUFFIX)) return null;
  const notePath = path.slice(SIDECAR_ROOT.length, path.length - SIDECAR_SUFFIX.length);
  return isCrdtNotePath(notePath) ? notePath : null;
}

async function readIfExists(uri: string): Promise<string | null> {
  const info = await FileSystem.getInfoAsync(uri);
  return info.exists ? FileSystem.readAsStringAsync(uri) : null;
}

export function readSidecar(repoDir: string, notePath: string): Promise<string | null> {
  return readIfExists(`${repoDir}/${sidecarPathForNote(notePath)}`);
}

export async function writeSidecar(repoDir: string, notePath: string, sidecar: string): Promise<void> {
  const sidecarPath = sidecarPathForNote(notePath);
  const slash = sidecarPath.lastIndexOf('/');
  await FileSystem.makeDirectoryAsync(`${repoDir}/${sidecarPath.slice(0, slash)}`, {
    intermediates: true,
  });
  await FileSystem.writeAsStringAsync(`${repoDir}/${sidecarPath}`, sidecar);
}

/** Write the note and advance its sidecar with the edit, seeding from the on-disk text on first use. */
export async function writeNoteWithSidecar(
  repoDir: string,
  notePath: string,
  content: string,
): Promise<void> {
  const [previousText, sidecar] = await Promise.all([
    readIfExists(`${repoDir}/${notePath}`),
    readSidecar(repoDir, notePath),
  ]);
  const nextSidecar = sidecarForSave({ sidecar, previousText, content });
  await FileSystem.writeAsStringAsync(`${repoDir}/${notePath}`, content);
  await writeSidecar(repoDir, notePath, nextSidecar);
}

export function deleteSidecar(repoDir: string, notePath: string): Promise<void> {
  return FileSystem.deleteAsync(`${repoDir}/${sidecarPathForNote(notePath)}`, { idempotent: true });
}
