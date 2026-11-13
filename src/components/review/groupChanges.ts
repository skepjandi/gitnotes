import type { GitFileChange } from '../../services/agent/bridgeTools';

export interface GroupedChanges {
  staged: GitFileChange[];
  changes: GitFileChange[];
  untracked: GitFileChange[];
}

const byPath = (a: GitFileChange, b: GitFileChange) => a.path.localeCompare(b.path);

export function groupChanges(files: GitFileChange[]): GroupedChanges {
  const grouped: GroupedChanges = { staged: [], changes: [], untracked: [] };
  for (const file of files) {
    if (file.status === 'untracked') {
      grouped.untracked.push(file);
      continue;
    }
    if (file.staged) grouped.staged.push(file);
    if (file.unstaged || file.status === 'conflicted' || !file.staged) grouped.changes.push(file);
  }
  grouped.staged.sort(byPath);
  grouped.changes.sort(byPath);
  grouped.untracked.sort(byPath);
  return grouped;
}
