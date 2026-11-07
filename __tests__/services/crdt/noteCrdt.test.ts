import {
  mergeNoteSides,
  sidecarForResolvedText,
  sidecarForSave,
  splitNote,
} from '@/services/crdt/noteCrdt';

const frontmatter = (updatedAt: string) =>
  `---\nid: n1\ntitle: Note\nupdatedAt: ${updatedAt}\n---\n`;

describe('noteCrdt', () => {
  it('keeps concurrent edits in different regions of a note started from the same base', () => {
    const base = `${frontmatter('2024-01-01')}line one\nline two\nline three\n`;
    const oursText = `${frontmatter('2024-01-02')}line one!\nline two\nline three\n`;
    const theirsText = `${frontmatter('2024-01-03')}line one\nline two\nline three?\n`;

    const merged = mergeNoteSides({
      base,
      ours: { text: oursText, sidecar: sidecarForSave({ sidecar: null, previousText: base, content: oursText }) },
      theirs: {
        text: theirsText,
        sidecar: sidecarForSave({ sidecar: null, previousText: base, content: theirsText }),
      },
    });

    expect(splitNote(merged.text).body).toBe('line one!\nline two\nline three?\n');
  });

  it('does not duplicate the base text when neither side has a sidecar yet', () => {
    const base = 'shared body\n';
    const merged = mergeNoteSides({
      base,
      ours: { text: 'shared body\nours\n', sidecar: null },
      theirs: { text: 'shared body\ntheirs\n', sidecar: null },
    });

    expect(merged.text.match(/shared body/g)).toHaveLength(1);
    expect(merged.text).toContain('ours');
    expect(merged.text).toContain('theirs');
  });

  it('is order independent', () => {
    const base = 'a b c\n';
    const ours = { text: 'a X c\n', sidecar: null };
    const theirs = { text: 'a b Y\n', sidecar: null };

    const forward = mergeNoteSides({ base, ours, theirs });
    const reverse = mergeNoteSides({ base, ours: theirs, theirs: ours });

    expect(forward.text).toBe(reverse.text);
  });

  it('takes frontmatter from the side with the newer updatedAt', () => {
    const base = `${frontmatter('2024-01-01')}body\n`;
    const oursText = `${frontmatter('2024-01-05')}body\n`;
    const theirsText = `${frontmatter('2024-01-02')}body\n`;

    const merged = mergeNoteSides({
      base,
      ours: { text: oursText, sidecar: null },
      theirs: { text: theirsText, sidecar: null },
    });

    expect(splitNote(merged.text).head).toBe(frontmatter('2024-01-05'));
  });

  it('falls back to the base seed when a sidecar is corrupt', () => {
    const merged = mergeNoteSides({
      base: 'base\n',
      ours: { text: 'base\nours\n', sidecar: '!!not base64!!' },
      theirs: { text: 'base\n', sidecar: 'Zm9vYmFy' },
    });

    expect(merged.text).toBe('base\nours\n');
  });

  it('merges from sidecars alone when the note text is unavailable', () => {
    const base = 'one\ntwo\n';
    const ours = sidecarForSave({ sidecar: null, previousText: base, content: 'ONE\ntwo\n' });
    const theirs = sidecarForSave({ sidecar: null, previousText: base, content: 'one\nTWO\n' });

    const merged = mergeNoteSides({
      base,
      ours: { text: null, sidecar: ours },
      theirs: { text: null, sidecar: theirs },
    });

    expect(merged.text).toBe('ONE\nTWO\n');
  });

  it('records a user-chosen final text on top of both histories', () => {
    const base = 'one\n';
    const ours = { text: 'one ours\n', sidecar: null };
    const theirs = { text: 'one theirs\n', sidecar: null };

    const sidecar = sidecarForResolvedText({ base, ours, theirs, finalText: 'chosen\n' });
    const next = mergeNoteSides({
      base: 'chosen\n',
      ours: { text: null, sidecar },
      theirs: { text: null, sidecar },
    });

    expect(next.text).toBe('chosen\n');
  });

  it('rebuilds state from an existing sidecar and external edits', () => {
    const first = sidecarForSave({ sidecar: null, previousText: null, content: 'hello\n' });
    const second = sidecarForSave({ sidecar: first, previousText: 'hello\n', content: 'hello world\n' });
    const merged = mergeNoteSides({
      base: 'hello\n',
      ours: { text: 'hello world\n', sidecar: second },
      theirs: { text: 'hello\n', sidecar: first },
    });

    expect(merged.text).toBe('hello world\n');
  });
});
