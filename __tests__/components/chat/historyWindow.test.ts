import { HISTORY_PAGE, earlierStartKey, windowTimeline } from '@/components/chat/historyWindow';
import type { TimelineItem } from '@/components/chat/timeline';
import type { ChatMessage } from '@/models/Chat';

const message = (id: string): ChatMessage => ({ id, role: 'assistant', content: id, timestamp: 1, kind: 'text' });
const reply = (index: number): TimelineItem => ({ kind: 'reply', key: `m${index}`, message: message(`m${index}`) });
const replies = (count: number) => Array.from({ length: count }, (_, index) => reply(index));

describe('windowTimeline', () => {
  it('keeps short transcripts whole with no Earlier row', () => {
    const { rows, start } = windowTimeline(replies(10), null);
    expect(rows).toHaveLength(10);
    expect(start).toBe(0);
  });

  it('renders only the newest page behind an Earlier row', () => {
    const { rows, start } = windowTimeline(replies(150), null);

    expect(HISTORY_PAGE).toBe(60);
    expect(start).toBe(90);
    expect(rows[0]).toEqual({ kind: 'earlier', key: 'earlier', hidden: 90 });
    expect(rows).toHaveLength(61);
    expect(rows[1].key).toBe('m90');
    expect(rows[60].key).toBe('m149');
  });

  it('starts at the pinned key once the user paged back, however long the transcript grows', () => {
    const { rows, start } = windowTimeline(replies(200), 'm30');
    expect(start).toBe(30);
    expect(rows).toHaveLength(171);
  });

  it('falls back to the newest page when the pinned key vanished', () => {
    expect(windowTimeline(replies(100), 'gone').start).toBe(40);
  });

  it('never hides an open approval or its work row', () => {
    const items = replies(150);
    items.splice(10, 0,
      { kind: 'work', key: 'work:t', messages: [message('t')] },
      { kind: 'needs', key: 'needs:p1', request: { id: 'p1', title: 'Run', options: [] } },
    );
    const { rows, start } = windowTimeline(items, null);

    expect(start).toBe(10);
    expect(rows.map((row) => row.key)).toEqual(expect.arrayContaining(['work:t', 'needs:p1']));
    expect(rows[0]).toMatchObject({ kind: 'earlier', hidden: 10 });
  });

  it('never hides an open elicitation', () => {
    const items = replies(150);
    items.splice(0, 0, { kind: 'elicitation', key: 'elicitation:e1', request: { mode: 'url', id: 'e1', message: 'm', url: 'https://x.dev' } });
    const { rows, start } = windowTimeline(items, null);

    expect(start).toBe(0);
    expect(rows[0].key).toBe('elicitation:e1');
  });
});

describe('earlierStartKey', () => {
  it('steps one page up and bottoms out at the first item', () => {
    const items = replies(150);
    expect(earlierStartKey(items, 90)).toBe('m30');
    expect(earlierStartKey(items, 30)).toBe('m0');
  });

  it('is null when nothing is hidden', () => {
    expect(earlierStartKey(replies(10), 0)).toBeNull();
  });
});
