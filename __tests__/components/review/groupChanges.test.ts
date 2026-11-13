import { groupChanges } from '@/components/review/groupChanges';
import type { GitFileChange } from '@/services/agent/bridgeTools';

const f = (path: string, status: GitFileChange['status'], staged: boolean, unstaged: boolean): GitFileChange => ({
  path,
  status,
  staged,
  unstaged,
});

describe('groupChanges', () => {
  it('splits files into staged, changes and untracked, sorted by path', () => {
    const grouped = groupChanges([
      f('z.ts', 'modified', true, false),
      f('b.ts', 'modified', false, true),
      f('both.ts', 'modified', true, true),
      f('new.txt', 'untracked', false, false),
      f('c.ts', 'conflicted', false, false),
    ]);
    expect(grouped.staged.map((x) => x.path)).toEqual(['both.ts', 'z.ts']);
    expect(grouped.changes.map((x) => x.path)).toEqual(['b.ts', 'both.ts', 'c.ts']);
    expect(grouped.untracked.map((x) => x.path)).toEqual(['new.txt']);
  });
});
