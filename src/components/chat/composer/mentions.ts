export interface MentionMatch {
  /** Index of the `@`. */
  start: number;
  /** Caret position; the mention token spans `[start, end)`. */
  end: number;
  /** Text between the `@` and the caret. */
  query: string;
}

/** The `@token` the caret sits at the end of, if the `@` starts the text or follows whitespace. */
export function findMentionAtCaret(text: string, caret: number): MentionMatch | null {
  const end = Math.min(Math.max(caret, 0), text.length);
  for (let index = end - 1; index >= 0; index -= 1) {
    const char = text[index];
    if (/\s/.test(char)) return null;
    if (char === '@') {
      const previous = index === 0 ? '' : text[index - 1];
      if (previous !== '' && !/\s/.test(previous)) return null;
      return { start: index, end, query: text.slice(index + 1, end) };
    }
  }
  return null;
}

/** Replaces the mention with `@path`; files get a trailing space, directories end in `/` so the next segment can follow. */
export function applyMention(
  text: string,
  mention: MentionMatch,
  path: string,
  isDir: boolean,
): { text: string; caret: number } {
  const normalized = isDir && !path.endsWith('/') ? `${path}/` : path;
  const insertion = isDir ? `@${normalized}` : `@${normalized} `;
  return {
    text: text.slice(0, mention.start) + insertion + text.slice(mention.end),
    caret: mention.start + insertion.length,
  };
}
