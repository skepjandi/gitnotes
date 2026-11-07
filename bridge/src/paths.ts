import { realpath } from 'node:fs/promises';
import { isAbsolute, relative, resolve, sep } from 'node:path';

/**
 * Segment-aware containment: `/root-evil` is NOT inside `/root`.
 * Both arguments must already be absolute and resolved.
 */
export function isInsideRoot(candidate: string, root: string): boolean {
  const rel = relative(root, candidate);
  if (rel === '') return true;
  if (rel === '..' || rel.startsWith(`..${sep}`)) return false;
  return !isAbsolute(rel);
}

/** Absolute, symlink-resolved path, or null when the path does not exist. */
export async function realpathOrNull(target: string): Promise<string | null> {
  try {
    return await realpath(resolve(target));
  } catch {
    return null;
  }
}

/** Resolves every existing root; missing roots are dropped. */
export async function resolveRoots(roots: readonly string[]): Promise<string[]> {
  const resolved: string[] = [];
  for (const root of roots) {
    const real = await realpathOrNull(root);
    if (real) resolved.push(real);
  }
  return resolved;
}
