const mockSave = jest.fn();
const mockSeed = jest.fn();
const mockUpsert = jest.fn();

jest.mock('@/services/chat/copy', () => ({ chatT: (key: string) => key }));
jest.mock('@/services/chat/storage/localThreadStorage', () => ({ localThreadStorage: { save: (t: unknown) => mockSave(t) } }));
jest.mock('@/services/chat/sessions', () => ({ seedChatSession: (t: unknown) => mockSeed(t) }));
jest.mock('@/stores/aiStore', () => ({ useAIStore: { getState: () => ({}) } }));
jest.mock('@/stores/chatStore', () => ({ useChatStore: { getState: () => ({ upsertSummary: (t: unknown) => mockUpsert(t) }) } }));

import { createDemoThread } from '@/services/chat/threads';

describe('createDemoThread', () => {
  it('creates a device-local demo thread and registers it', async () => {
    const thread = await createDemoThread();

    expect(thread.backend).toEqual({ type: 'demo' });
    expect(thread.title).toBe('chat.demoTitle');
    expect(mockSave).toHaveBeenCalledWith(thread);
    expect(mockSeed).toHaveBeenCalledWith(thread);
    expect(mockUpsert).toHaveBeenCalledWith(thread);
  });
});
