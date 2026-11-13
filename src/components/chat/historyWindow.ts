import type { TimelineItem } from './timeline';

export const HISTORY_PAGE = 60;

export interface EarlierRow {
  kind: 'earlier';
  key: 'earlier';
  hidden: number;
}

export type ListRow = TimelineItem | EarlierRow;

export interface HistoryWindow {
  rows: ListRow[];
  /** Index into the full timeline of the first rendered item. */
  start: number;
}

function anchorsOpenRequest(item: TimelineItem): boolean {
  return item.kind === 'needs' || item.kind === 'elicitation';
}

/**
 * Newest `pageSize` rows, or everything from `startKey` on once the user paged back. An open
 * approval/elicitation (and the work row it hangs off) is never cut off, however far up it sits.
 */
export function windowTimeline(
  items: readonly TimelineItem[],
  startKey: string | null,
  pageSize: number = HISTORY_PAGE,
): HistoryWindow {
  const pinned = startKey === null ? -1 : items.findIndex((item) => item.key === startKey);
  let start = pinned === -1 ? Math.max(0, items.length - pageSize) : pinned;
  const firstOpen = items.findIndex(anchorsOpenRequest);
  if (firstOpen !== -1 && firstOpen - 1 < start) start = Math.max(0, firstOpen - 1);
  const visible = start === 0 ? [...items] : items.slice(start);
  return {
    rows: start > 0 ? [{ kind: 'earlier', key: 'earlier', hidden: start }, ...visible] : visible,
    start,
  };
}

/** Key of the item that opens one more page above the current window; `null` when nothing is hidden. */
export function earlierStartKey(
  items: readonly TimelineItem[],
  start: number,
  pageSize: number = HISTORY_PAGE,
): string | null {
  if (start <= 0) return null;
  return items[Math.max(0, start - pageSize)].key;
}
