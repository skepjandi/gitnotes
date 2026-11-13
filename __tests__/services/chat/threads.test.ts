const mockSave = jest.fn();
const mockSeed = jest.fn();
const mockUpsert = jest.fn();
const mockLoad = jest.fn();
const mockSummaries = jest.fn();

jest.mock('@/services/chat/copy', () => ({ chatT: (key: string) => key }));
jest.mock('@/services/chat/storage/localThreadStorage', () => ({ localThreadStorage: { save: (t: unknown) => mockSave(t), load: (id: string) => mockLoad(id) } }));
jest.mock('@/services/chat/sessions', () => ({ seedChatSession: (t: unknown) => mockSeed(t) }));
jest.mock('@/stores/aiStore', () => ({ useAIStore: { getState: () => ({}) } }));
jest.mock('@/stores/chatStore', () => ({ useChatStore: { getState: () => ({ upsertSummary: (t: unknown) => mockUpsert(t), threads: mockSummaries() }) } }));

import { adoptAgentSession, createDemoThread, findAgentThreadIdsByConnection } from '@/services/chat/threads';
import type { AgentBridge, BridgeSessionInfo } from '@/services/agent/types';

describe('createDemoThread', () => {
  it('creates a device-local demo thread and registers it', async () => {
    const thread = await createDemoThread();

    expect(thread.backend).toMatchObject({ type: 'demo' });
    expect((thread.backend as { configOptions?: unknown[] }).configOptions?.length).toBeGreaterThan(0);
    expect(thread.title).toBe('chat.demoTitle');
    expect(mockSave).toHaveBeenCalledWith(thread);
    expect(mockSeed).toHaveBeenCalledWith(thread);
    expect(mockUpsert).toHaveBeenCalledWith(thread);
  });
});

describe('adoptAgentSession', () => {
  const bridge: AgentBridge = { id: 'b1', name: 'Dev box', url: 'wss://dev.example.net', addedAt: 1 };
  const session: BridgeSessionInfo = {
    connectionId: 'conn-1',
    agentId: 'claude',
    agentName: 'Claude Code',
    cwd: '/code/app',
    sessionId: 'sess-1',
    startedAt: 1000,
    headSeq: 42,
    attached: false,
  };

  beforeEach(() => {
    jest.clearAllMocks();
    mockSummaries.mockReturnValue([]);
    mockLoad.mockResolvedValue(null);
  });

  it('creates a device-local thread bound to the open session', async () => {
    const thread = await adoptAgentSession(bridge, session);

    expect(thread.backend).toEqual({
      type: 'agent',
      bridgeId: 'b1',
      agentId: 'claude',
      agentName: 'Claude Code',
      cwd: '/code/app',
      sessionId: 'sess-1',
      connectionId: 'conn-1',
      lastSeq: 42,
    });
    expect(thread.title).toBe('app · Claude Code');
    expect(thread.messages).toHaveLength(1);
    expect(thread.messages[0]).toMatchObject({ role: 'system', content: 'chat.adoptedNotice' });
    expect(thread.repoOwner).toBe('');
    expect(mockSave).toHaveBeenCalledWith(thread);
    expect(mockSeed).toHaveBeenCalledWith(thread);
    expect(mockUpsert).toHaveBeenCalledWith(thread);
  });

  it('returns the existing local thread for the same connection without creating another', async () => {
    const existing = {
      id: 'thread-1',
      backend: { type: 'agent', bridgeId: 'b1', connectionId: 'conn-1', agentId: 'claude', agentName: 'Claude Code', cwd: '/code/app' },
    };
    mockSummaries.mockReturnValue([{ id: 'thread-1', backend: 'agent' }]);
    mockLoad.mockResolvedValue(existing);

    await expect(adoptAgentSession(bridge, session)).resolves.toBe(existing);
    expect(mockSave).not.toHaveBeenCalled();
    expect(mockUpsert).not.toHaveBeenCalled();
  });

  it('does not match a thread of another bridge with the same connection id', async () => {
    mockSummaries.mockReturnValue([{ id: 'thread-2', backend: 'agent' }]);
    mockLoad.mockResolvedValue({
      id: 'thread-2',
      backend: { type: 'agent', bridgeId: 'other', connectionId: 'conn-1', agentId: 'claude', agentName: 'x', cwd: '/' },
    });

    const thread = await adoptAgentSession(bridge, session);

    expect(thread.id).not.toBe('thread-2');
    expect(mockSave).toHaveBeenCalledTimes(1);
  });

  it('rejects a session that has no cwd or session id yet', async () => {
    await expect(adoptAgentSession(bridge, { ...session, cwd: null })).rejects.toThrow('chat.adoptNoSession');
    await expect(adoptAgentSession(bridge, { ...session, sessionId: null })).rejects.toThrow('chat.adoptNoSession');
    expect(mockSave).not.toHaveBeenCalled();
  });

  it('maps connection ids to thread ids for one bridge', async () => {
    mockSummaries.mockReturnValue([
      { id: 'a', backend: 'agent' },
      { id: 'm', backend: 'model' },
    ]);
    mockLoad.mockResolvedValue({ id: 'a', backend: { type: 'agent', bridgeId: 'b1', connectionId: 'conn-9' } });

    const ids = await findAgentThreadIdsByConnection('b1');

    expect([...ids.entries()]).toEqual([['conn-9', 'a']]);
    expect(mockLoad).toHaveBeenCalledTimes(1);
  });
});
