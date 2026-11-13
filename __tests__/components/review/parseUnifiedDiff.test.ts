import { parseUnifiedDiff } from '@/components/review/parseUnifiedDiff';

const PATCH = `diff --git a/a.ts b/a.ts
index 111..222 100644
--- a/a.ts
+++ b/a.ts
@@ -1,3 +1,4 @@ fn
 one
-two
+TWO
+three
 four
@@ -10 +11 @@
-x
\\ No newline at end of file
+y
`;

describe('parseUnifiedDiff', () => {
  it('parses hunks with line numbers and counts', () => {
    const parsed = parseUnifiedDiff(PATCH);
    expect(parsed.hunks).toHaveLength(2);
    expect(parsed.added).toBe(3);
    expect(parsed.removed).toBe(2);
    expect(parsed.hunks[0].lines.map((l) => [l.type, l.oldNo, l.newNo])).toEqual([
      ['ctx', 1, 1],
      ['del', 2, null],
      ['add', null, 2],
      ['add', null, 3],
      ['ctx', 3, 4],
    ]);
    expect(parsed.hunks[1].lines[0]).toMatchObject({ type: 'del', oldNo: 10, noNewline: true });
    expect(parsed.hunks[1].lines[1]).toMatchObject({ type: 'add', newNo: 11 });
  });

  it('captures renames without hunks', () => {
    const parsed = parseUnifiedDiff('diff --git a/o.ts b/n.ts\nsimilarity index 100%\nrename from o.ts\nrename to n.ts\n');
    expect(parsed).toMatchObject({ renameFrom: 'o.ts', renameTo: 'n.ts', hunks: [], binary: false });
  });

  it('flags binary patches', () => {
    expect(parseUnifiedDiff('diff --git a/i.png b/i.png\nBinary files a/i.png and b/i.png differ\n').binary).toBe(true);
  });

  it('caps rendered lines but counts all of them', () => {
    const body = Array.from({ length: 50 }, (_, i) => `+l${i}`).join('\n');
    const parsed = parseUnifiedDiff(`@@ -0,0 +1,50 @@\n${body}\n`, 10);
    expect(parsed.hunks[0].lines).toHaveLength(10);
    expect(parsed.hiddenLines).toBe(40);
    expect(parsed.added).toBe(50);
  });

  it('returns nothing for an empty patch', () => {
    expect(parseUnifiedDiff('').hunks).toEqual([]);
  });
});
