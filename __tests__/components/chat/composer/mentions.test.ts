import { applyMention, findMentionAtCaret } from '@/components/chat/composer/mentions';

describe('findMentionAtCaret', () => {
  it('finds the token ending at the caret', () => {
    expect(findMentionAtCaret('look at @src/ap', 15)).toEqual({ start: 8, end: 15, query: 'src/ap' });
  });

  it('matches a bare @ at the start of the text', () => {
    expect(findMentionAtCaret('@', 1)).toEqual({ start: 0, end: 1, query: '' });
  });

  it('only looks left of the caret', () => {
    expect(findMentionAtCaret('fix @src/app now', 8)).toEqual({ start: 4, end: 8, query: 'src' });
  });

  it('ignores an @ inside a word such as an email address', () => {
    expect(findMentionAtCaret('mail me@host.com', 16)).toBeNull();
  });

  it('stops at whitespace between the @ and the caret', () => {
    expect(findMentionAtCaret('@src and more', 13)).toBeNull();
  });

  it('is null when there is no @ before the caret', () => {
    expect(findMentionAtCaret('plain text', 10)).toBeNull();
    expect(findMentionAtCaret('a @b', 0)).toBeNull();
  });

  it('clamps an out-of-range caret', () => {
    expect(findMentionAtCaret('@a', 99)).toEqual({ start: 0, end: 2, query: 'a' });
  });
});

describe('applyMention', () => {
  const text = 'check @sr please';
  const mention = { start: 6, end: 9, query: 'sr' };

  it('inserts a file path followed by a space and moves the caret after it', () => {
    expect(applyMention(text, mention, 'src/index.ts', false)).toEqual({
      text: 'check @src/index.ts  please',
      caret: 6 + '@src/index.ts '.length,
    });
  });

  it('inserts a directory with a trailing slash and no space so the next segment can follow', () => {
    expect(applyMention(text, mention, 'src', true)).toEqual({ text: 'check @src/ please', caret: 11 });
    expect(applyMention(text, mention, 'src/', true).text).toBe('check @src/ please');
  });
});
