import type { ChatThreadSummary } from '@/models/Chat';
import { buildThreadSections, matchesThreadQuery, workspaceName } from '@/components/chat/threadSections';

const t = (id: string, overrides: Partial<ChatThreadSummary> = {}): ChatThreadSummary => ({
  id,
  title: id,
  updatedAt: 1,
  messageCount: 1,
  ...overrides,
});

describe('threadSections', () => {
  it('takes the last cwd segment as workspace name', () => {
    expect(workspaceName('/Users/me/code/app/')).toBe('app');
    expect(workspaceName(undefined)).toBe('');
  });

  it('groups needs-you first, then workspaces, chats and demo, newest first', () => {
    const threads = [
      t('chat-old', { updatedAt: 1 }),
      t('chat-new', { updatedAt: 5 }),
      t('agent-b', { backend: 'agent', cwd: '/w/beta', updatedAt: 2 }),
      t('agent-a1', { backend: 'agent', cwd: '/w/alpha', updatedAt: 3 }),
      t('agent-a2', { backend: 'agent', cwd: '/x/alpha', updatedAt: 4 }),
      t('agent-wait', { backend: 'agent', cwd: '/w/beta', updatedAt: 0 }),
      t('demo-1', { backend: 'demo' }),
    ];
    const sections = buildThreadSections(threads, { 'agent-wait': 'awaiting-permission', 'chat-old': 'running' });

    expect(sections.map((section) => section.key)).toEqual(['needs-you', 'workspace:alpha', 'workspace:beta', 'chats', 'demo']);
    expect(sections[0].data.map((item) => item.id)).toEqual(['agent-wait']);
    expect(sections[1].data.map((item) => item.id)).toEqual(['agent-a2', 'agent-a1']);
    expect(sections[3].data.map((item) => item.id)).toEqual(['chat-new', 'chat-old']);
  });

  it('filters by title, preview and agent name and drops empty sections', () => {
    const threads = [
      t('one', { title: 'Fix login', backend: 'agent', agentName: 'Claude Code', cwd: '/w/app' }),
      t('two', { title: 'Groceries', preview: 'buy milk' }),
    ];

    expect(buildThreadSections(threads, {}, 'claude').map((section) => section.key)).toEqual(['workspace:app']);
    expect(buildThreadSections(threads, {}, 'MILK').map((section) => section.key)).toEqual(['chats']);
    expect(buildThreadSections(threads, {}, 'zzz')).toEqual([]);
    expect(matchesThreadQuery(threads[0], '  ')).toBe(true);
  });
});
