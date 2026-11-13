import { matchSlashCommands } from '@/components/chat/slashCommands';

const commands = [
  { name: 'compact', description: 'Summarize the conversation' },
  { name: 'review' },
  { name: 'init', hint: 'path' },
  { name: 'recompact' },
];

describe('matchSlashCommands', () => {
  it('suggests everything for a bare slash, prefix matches before substring matches', () => {
    expect(matchSlashCommands('/', commands).map((c) => c.name)).toEqual(['compact', 'review', 'init', 'recompact']);
    expect(matchSlashCommands('/com', commands).map((c) => c.name)).toEqual(['compact', 'recompact']);
  });

  it('is case-insensitive', () => {
    expect(matchSlashCommands('/REV', commands).map((c) => c.name)).toEqual(['review']);
  });

  it('suggests nothing once an argument or other text follows, or without commands', () => {
    expect(matchSlashCommands('/init src', commands)).toEqual([]);
    expect(matchSlashCommands('fix /init', commands)).toEqual([]);
    expect(matchSlashCommands('/', undefined)).toEqual([]);
    expect(matchSlashCommands('/', [])).toEqual([]);
  });

  it('caps the list', () => {
    const many = Array.from({ length: 20 }, (_, i) => ({ name: `cmd${i}` }));
    expect(matchSlashCommands('/cmd', many)).toHaveLength(8);
  });
});
