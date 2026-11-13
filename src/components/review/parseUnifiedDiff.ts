export type PatchLineType = 'add' | 'del' | 'ctx';

export interface PatchLine {
  type: PatchLineType;
  text: string;
  oldNo: number | null;
  newNo: number | null;
  noNewline?: boolean;
}

export interface PatchHunk {
  header: string;
  lines: PatchLine[];
}

export interface ParsedPatch {
  binary: boolean;
  renameFrom: string | null;
  renameTo: string | null;
  hunks: PatchHunk[];
  added: number;
  removed: number;
  hiddenLines: number;
}

export const DEFAULT_MAX_PATCH_LINES = 1500;

const HUNK_HEADER = /^@@ -(\d+)(?:,\d+)? \+(\d+)(?:,\d+)? @@/;

export function parseUnifiedDiff(patch: string, maxLines = DEFAULT_MAX_PATCH_LINES): ParsedPatch {
  const result: ParsedPatch = {
    binary: false,
    renameFrom: null,
    renameTo: null,
    hunks: [],
    added: 0,
    removed: 0,
    hiddenLines: 0,
  };
  let hunk: PatchHunk | null = null;
  let oldNo = 0;
  let newNo = 0;
  let rendered = 0;
  let last: PatchLine | null = null;

  for (const raw of patch.split('\n')) {
    const header = HUNK_HEADER.exec(raw);
    if (header) {
      hunk = { header: raw, lines: [] };
      result.hunks.push(hunk);
      oldNo = Number(header[1]);
      newNo = Number(header[2]);
      last = null;
      continue;
    }
    if (!hunk) {
      if (raw.startsWith('rename from ')) result.renameFrom = raw.slice('rename from '.length);
      else if (raw.startsWith('rename to ')) result.renameTo = raw.slice('rename to '.length);
      else if (raw.startsWith('Binary files ') || raw.startsWith('GIT binary patch')) result.binary = true;
      continue;
    }
    if (raw.startsWith('\\')) {
      if (last) last.noNewline = true;
      continue;
    }
    const marker = raw[0];
    if (marker !== '+' && marker !== '-' && marker !== ' ') continue;
    const type: PatchLineType = marker === '+' ? 'add' : marker === '-' ? 'del' : 'ctx';
    if (type === 'add') result.added++;
    else if (type === 'del') result.removed++;
    const line: PatchLine = {
      type,
      text: raw.slice(1),
      oldNo: type === 'add' ? null : oldNo,
      newNo: type === 'del' ? null : newNo,
    };
    if (type !== 'add') oldNo++;
    if (type !== 'del') newNo++;
    if (rendered >= maxLines) {
      result.hiddenLines++;
      last = null;
      continue;
    }
    rendered++;
    hunk.lines.push(line);
    last = line;
  }

  if (result.hiddenLines > 0) result.hunks = result.hunks.filter((entry) => entry.lines.length > 0);
  return result;
}
