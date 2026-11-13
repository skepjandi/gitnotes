import { useEffect, useState } from 'react';
import type { FileMatch } from '../../../services/agent/bridgeTools';
import { findMentionAtCaret, type MentionMatch } from './mentions';

export const MENTION_DEBOUNCE_MS = 150;
const MAX_RESULTS = 8;

export type FileSearch = (query: string) => Promise<FileMatch[]>;

export interface FileMentions {
  mention: MentionMatch | null;
  results: FileMatch[];
}

/** Debounced file search for the `@token` at the caret; answers to superseded queries are dropped. */
export function useFileMentions(text: string, caret: number, search: FileSearch | undefined, enabled: boolean): FileMentions {
  const mention = enabled && search ? findMentionAtCaret(text, caret) : null;
  const query = mention?.query ?? null;
  const [answer, setAnswer] = useState<{ query: string; results: FileMatch[] } | null>(null);

  useEffect(() => {
    if (query === null || !search) return;
    let stale = false;
    const timer = setTimeout(() => {
      search(query).then(
        (items) => {
          if (!stale) setAnswer({ query, results: items.slice(0, MAX_RESULTS) });
        },
        () => {
          if (!stale) setAnswer({ query, results: [] });
        },
      );
    }, MENTION_DEBOUNCE_MS);
    return () => {
      stale = true;
      clearTimeout(timer);
    };
  }, [query, search]);

  const results = query !== null && answer?.query === query ? answer.results : [];
  return { mention: results.length > 0 ? mention : null, results };
}
