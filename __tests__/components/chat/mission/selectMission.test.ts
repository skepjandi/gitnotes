import type { ChatMessage } from '@/models/Chat';
import { selectMission } from '@/components/chat/mission/selectMission';

const base = { pendingPermissions: [], backend: { type: 'model' as const }, status: 'idle' as const, streamStartedAt: 0, now: 10_000 };

const tool = (id: string, extra: Partial<ChatMessage>): ChatMessage => ({
  id,
  role: 'assistant',
  content: '',
  timestamp: 1,
  kind: 'tool',
  ...extra,
});

describe('selectMission', () => {
  it('returns no sections for an empty idle model thread', () => {
    expect(selectMission({ ...base, messages: [] }).sections).toEqual([]);
  });

  it('omits sections without data and keeps a fixed order', () => {
    const messages: ChatMessage[] = [
      tool('t1', { toolKind: 'execute' }),
      { id: 'p', role: 'assistant', content: '', timestamp: 1, kind: 'plan', plan: [{ content: 'a', status: 'completed' }, { content: 'b', status: 'pending' }] },
      tool('t2', { toolKind: 'edit', toolDiffs: [{ path: 'a.ts', oldText: null, newText: 'x' }] }),
    ];
    const mission = selectMission({
      ...base,
      messages,
      pendingPermissions: [{ id: 'r', title: 'Run', options: [] }],
    });
    expect(mission.sections.map((s) => s.type)).toEqual(['needsYou', 'plan', 'changes', 'activity', 'status']);
    const plan = mission.sections[1];
    expect(plan).toMatchObject({ completed: 1, total: 2 });
  });

  it('uses the latest plan message', () => {
    const plan = (id: string, status: 'pending' | 'completed') =>
      ({ id, role: 'assistant', content: '', timestamp: 1, kind: 'plan', plan: [{ content: 'a', status }] }) as ChatMessage;
    const section = selectMission({ ...base, messages: [plan('p1', 'pending'), plan('p2', 'completed')] }).sections.find(
      (s) => s.type === 'plan',
    );
    expect(section).toMatchObject({ completed: 1, total: 1 });
  });

  it('aggregates changes by path keeping the newest diff', () => {
    const messages = [
      tool('t1', { toolDiffs: [{ path: 'a.md', oldText: null, newText: 'one\ntwo' }] }),
      tool('t2', { toolDiffs: [{ path: 'b.md', oldText: 'x', newText: 'y' }] }),
      tool('t3', { toolDiffs: [{ path: 'a.md', oldText: 'one\ntwo', newText: 'one\ntwo\nthree' }] }),
    ];
    const section = selectMission({ ...base, messages }).sections.find((s) => s.type === 'changes');
    if (section?.type !== 'changes') throw new Error('missing');
    expect(section.changes.map((c) => c.path)).toEqual(['b.md', 'a.md']);
    expect(section.changes[1]).toMatchObject({ status: 'edited', added: 1, removed: 0, messageId: 't3' });
    expect(section.changes[0]).toMatchObject({ status: 'edited', added: 1, removed: 1, messageId: 't2' });
  });

  it('counts activity by tool kind and failures', () => {
    const messages = [
      tool('1', { toolKind: 'execute' }),
      tool('2', { toolKind: 'execute', toolStatus: 'failed' }),
      tool('3', { toolKind: 'read' }),
      tool('4', { toolKind: 'edit' }),
      tool('5', { toolKind: 'search' }),
      { id: 'u', role: 'user', content: 'hi', timestamp: 1 } as ChatMessage,
    ];
    const section = selectMission({ ...base, messages }).sections.find((s) => s.type === 'activity');
    expect(section).toMatchObject({
      activity: { commands: 2, filesRead: 1, filesEdited: 1, searches: 1, failed: 1 },
    });
  });

  it('describes the agent status with elapsed time while running', () => {
    const mission = selectMission({
      ...base,
      messages: [{ id: 'u', role: 'user', content: 'hi', timestamp: 1 }],
      status: 'running',
      streamStartedAt: 4_000,
      backend: {
        type: 'agent',
        bridgeId: 'b',
        agentId: 'claude',
        agentName: 'Claude Code',
        cwd: '/home/me/project',
        modeId: 'plan',
        availableModes: [{ id: 'plan', name: 'Plan' }],
      },
    });
    expect(mission.sections[mission.sections.length - 1]).toEqual({
      type: 'status',
      agentName: 'Claude Code',
      workspace: 'project',
      modeName: 'Plan',
      state: 'running',
      elapsedMs: 6_000,
      messageCount: 1,
    });
  });
});
