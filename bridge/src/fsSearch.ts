import { readdir } from 'node:fs/promises';
import { basename } from 'node:path';
import { exec } from './exec.js';
import type { FileMatch } from './protocol.js';

export const DEFAULT_SEARCH_LIMIT = 50;
export const MAX_SEARCH_LIMIT = 200;
export const SEARCH_BUDGET_MS = 2000;
const MAX_WALK_ENTRIES = 50_000;
const WALK_SKIP = new Set(['node_modules', '.git', 'dist', 'build']);

interface Candidates {
  items: FileMatch[];
  truncated: boolean;
}

export function clampLimit(limit: number | undefined): number {
  if (limit === undefined || !Number.isFinite(limit)) return DEFAULT_SEARCH_LIMIT;
  return Math.min(Math.max(Math.floor(limit), 1), MAX_SEARCH_LIMIT);
}

export async function searchFiles(
  cwd: string,
  query: string,
  limit: number,
): Promise<{ items: FileMatch[]; truncated: boolean }> {
  const deadline = Date.now() + SEARCH_BUDGET_MS;
  const needle = query.trim().toLowerCase();

  if (needle === '') return listTopLevel(cwd, limit, deadline);

  const candidates = (await gitCandidates(cwd, deadline)) ?? (await walkCandidates(cwd, deadline));
  const scored: { item: FileMatch; score: number }[] = [];
  for (const item of candidates.items) {
    const score = scorePath(item.path, needle);
    if (score > 0) scored.push({ item, score });
  }
  scored.sort(
    (a, b) =>
      b.score - a.score || a.item.path.length - b.item.path.length || a.item.path.localeCompare(b.item.path),
  );
  return {
    items: scored.slice(0, limit).map((entry) => entry.item),
    truncated: scored.length > limit || candidates.truncated,
  };
}

function scorePath(path: string, needle: string): number {
  const lower = path.toLowerCase();
  const name = basename(lower);
  if (name === needle) return 1000;
  if (name.startsWith(needle)) return 900;
  if (lower.startsWith(needle)) return 800;
  const nameIndex = name.indexOf(needle);
  if (nameIndex !== -1) return 700 - Math.min(nameIndex, 99);
  const pathIndex = lower.indexOf(needle);
  if (pathIndex !== -1) return 500 - Math.min(pathIndex, 99);
  return subsequenceScore(name, needle) || subsequenceScore(lower, needle) / 2;
}

/** Characters of `needle` appear in order in `text`; tighter spans score higher. */
function subsequenceScore(text: string, needle: string): number {
  let position = 0;
  let first = -1;
  for (const char of needle) {
    const found = text.indexOf(char, position);
    if (found === -1) return 0;
    if (first === -1) first = found;
    position = found + 1;
  }
  return Math.max(1, 300 - (position - first - needle.length) - first);
}

async function listTopLevel(
  cwd: string,
  limit: number,
  deadline: number,
): Promise<{ items: FileMatch[]; truncated: boolean }> {
  const candidates = await gitCandidates(cwd, deadline);
  let items: FileMatch[];
  if (candidates) {
    const seen = new Map<string, boolean>();
    for (const item of candidates.items) {
      const slash = item.path.indexOf('/');
      const top = slash === -1 ? item.path : item.path.slice(0, slash);
      if (slash === -1) seen.set(top, item.isDir);
      else if (!seen.has(top)) seen.set(top, true);
    }
    items = [...seen].map(([path, isDir]) => ({ path, isDir }));
  } else {
    const entries = await readdir(cwd, { withFileTypes: true }).catch(() => []);
    items = entries
      .filter((entry) => !WALK_SKIP.has(entry.name))
      .map((entry) => ({ path: entry.name, isDir: entry.isDirectory() }));
  }
  items.sort((a, b) => Number(b.isDir) - Number(a.isDir) || a.path.localeCompare(b.path));
  return { items: items.slice(0, limit), truncated: items.length > limit };
}

/** Tracked plus untracked-not-ignored files, with their parent directories. Null when `cwd` is not a git work tree. */
async function gitCandidates(cwd: string, deadline: number): Promise<Candidates | null> {
  const result = await exec('git', ['ls-files', '-z', '--cached', '--others', '--exclude-standard'], {
    cwd,
    timeoutMs: Math.max(deadline - Date.now(), 100),
    maxBuffer: 64 * 1024 * 1024,
  });
  if (result.code !== 0 && !result.overflow) return null;

  const files = new Set<string>();
  for (const entry of result.stdout.toString('utf8').split('\0')) {
    if (entry && !entry.startsWith('../')) files.add(entry);
  }
  const dirs = new Set<string>();
  for (const file of files) {
    let slash = file.indexOf('/');
    while (slash !== -1) {
      dirs.add(file.slice(0, slash));
      slash = file.indexOf('/', slash + 1);
    }
  }
  const items: FileMatch[] = [
    ...[...dirs].map((path) => ({ path, isDir: true })),
    ...[...files].map((path) => ({ path, isDir: false })),
  ];
  return { items, truncated: result.overflow };
}

/** Breadth-first walk; symlinks are listed but never followed. */
async function walkCandidates(cwd: string, deadline: number): Promise<Candidates> {
  const items: FileMatch[] = [];
  const queue: string[] = [''];
  let truncated = false;
  while (queue.length > 0) {
    if (Date.now() > deadline || items.length >= MAX_WALK_ENTRIES) {
      truncated = true;
      break;
    }
    const dir = queue.shift() as string;
    const entries = await readdir(dir === '' ? cwd : `${cwd}/${dir}`, { withFileTypes: true }).catch(() => []);
    for (const entry of entries) {
      if (WALK_SKIP.has(entry.name)) continue;
      const path = dir === '' ? entry.name : `${dir}/${entry.name}`;
      const isDir = entry.isDirectory();
      items.push({ path, isDir });
      if (isDir) queue.push(path);
    }
  }
  return { items, truncated };
}
