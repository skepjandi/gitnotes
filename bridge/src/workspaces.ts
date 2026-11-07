import { readdir, stat } from 'node:fs/promises';
import { basename, join } from 'node:path';
import type { WorkspaceInfo } from './protocol.js';
import { isInsideRoot, realpathOrNull } from './paths.js';

export const MAX_WORKSPACES = 200;

async function statOrNull(target: string) {
  try {
    return await stat(target);
  } catch {
    return null;
  }
}

async function hasGitMarker(dir: string): Promise<boolean> {
  return (await statOrNull(join(dir, '.git'))) !== null;
}

/**
 * The configured roots plus their direct children that are git repositories.
 * Children that resolve (through symlinks) outside their root are skipped so
 * every listed workspace is usable by the cwd guard.
 */
export async function listWorkspaces(
  roots: readonly string[],
  limit = MAX_WORKSPACES,
): Promise<WorkspaceInfo[]> {
  const items: WorkspaceInfo[] = [];

  for (const root of roots) {
    const rootReal = await realpathOrNull(root);
    if (!rootReal) continue;
    items.push({ path: rootReal, name: basename(rootReal), isRoot: true });

    let entries;
    try {
      entries = await readdir(rootReal, { withFileTypes: true });
    } catch {
      continue;
    }

    for (const entry of entries) {
      if (entry.name === '.git') continue;
      const childReal = await realpathOrNull(join(rootReal, entry.name));
      if (!childReal || !isInsideRoot(childReal, rootReal)) continue;
      const stats = await statOrNull(childReal);
      if (!stats?.isDirectory()) continue;
      if (!(await hasGitMarker(childReal))) continue;
      items.push({ path: childReal, name: entry.name, isRoot: false });
    }
  }

  items.sort((a, b) => a.path.localeCompare(b.path));
  return items.slice(0, limit);
}
