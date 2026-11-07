const mockLocal = {
  listSummaries: jest.fn(),
  remove: jest.fn(),
  load: jest.fn(),
  save: jest.fn(),
};
const mockRepo = {
  listSummaries: jest.fn(),
  remove: jest.fn(),
  load: jest.fn(),
  save: jest.fn(),
};
let mockRepoConfigured = true;
const mockRelease = jest.fn();

jest.mock('@/services/chat/storage/localThreadStorage', () => ({
  get localThreadStorage() {
    return mockLocal;
  },
}));
jest.mock('@/services/chat/storage/threadStorage', () => ({
  configuredRepoStorage: () => (mockRepoConfigured ? mockRepo : null),
}));
jest.mock('@/services/chat/backends/agentBackend', () => ({ releaseAgentConnection: (id: string) => mockRelease(id) }));
jest.mock('@/services/ChatStorageService', () => {
  class ChatStorageError extends Error {
    cachedData?: unknown;
    warning?: string;
  }
  return { ChatStorageError };
});

import { useChatStore } from '@/stores/chatStore';
import { ChatStorageError } from '@/services/ChatStorageService';
import { onThreadRemoved, onThreadRenamed } from '@/services/chat/threadEvents';
import type { ChatThreadSummary } from '@/models/Chat';

const summary = (overrides: Partial<ChatThreadSummary> & { id: string }): ChatThreadSummary => ({
  title: overrides.id,
  updatedAt: 1,
  messageCount: 1,
  ...overrides,
});

describe('chatStore thread list', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockRepoConfigured = true;
    mockLocal.listSummaries.mockResolvedValue([]);
    mockRepo.listSummaries.mockResolvedValue([]);
    mockLocal.remove.mockResolvedValue(undefined);
    mockRepo.remove.mockResolvedValue(undefined);
    useChatStore.setState({ threads: [], isLoading: false, error: null });
  });

  describe('loadThreads', () => {
    it('merges repo and device-local summaries newest first', async () => {
      mockRepo.listSummaries.mockResolvedValue([summary({ id: 'model-old', updatedAt: 10 })]);
      mockLocal.listSummaries.mockResolvedValue([summary({ id: 'agent-new', updatedAt: 20, backend: 'agent' })]);

      await useChatStore.getState().loadThreads();

      expect(useChatStore.getState().threads.map((t) => t.id)).toEqual(['agent-new', 'model-old']);
      expect(useChatStore.getState().error).toBeNull();
    });

    it('still lists agent chats when no chat repo is configured', async () => {
      mockRepoConfigured = false;
      mockLocal.listSummaries.mockResolvedValue([summary({ id: 'agent-1', backend: 'agent' })]);

      await useChatStore.getState().loadThreads();

      expect(useChatStore.getState().threads.map((t) => t.id)).toEqual(['agent-1']);
      expect(mockRepo.listSummaries).not.toHaveBeenCalled();
    });

    it('keeps cached repo summaries and surfaces a warning on transient repo failure', async () => {
      const failure = new ChatStorageError('offline');
      failure.cachedData = [summary({ id: 'cached', updatedAt: 5 })];
      failure.warning = 'Showing cached chats';
      mockRepo.listSummaries.mockRejectedValue(failure);
      mockLocal.listSummaries.mockResolvedValue([summary({ id: 'agent-1', updatedAt: 6, backend: 'agent' })]);

      await useChatStore.getState().loadThreads();

      expect(useChatStore.getState().threads.map((t) => t.id)).toEqual(['agent-1', 'cached']);
      expect(useChatStore.getState().error).toBe('Showing cached chats');
      expect(useChatStore.getState().isLoading).toBe(false);
    });

    it('does not lose agent chats when the repo fails without cache', async () => {
      mockRepo.listSummaries.mockRejectedValue(new Error('boom'));
      mockLocal.listSummaries.mockResolvedValue([summary({ id: 'agent-1', backend: 'agent' })]);
      jest.spyOn(console, 'error').mockImplementation(() => undefined);

      await useChatStore.getState().loadThreads();

      expect(useChatStore.getState().threads.map((t) => t.id)).toEqual(['agent-1']);
      expect(useChatStore.getState().error).toBe('Failed to load chat threads');
    });
  });

  describe('deleteThread', () => {
    it('removes an agent chat locally, stops its session and releases the bridge connection', async () => {
      const removed = jest.fn();
      const off = onThreadRemoved(removed);
      const agent = summary({ id: 'agent-1', backend: 'agent' });
      useChatStore.setState({ threads: [agent, summary({ id: 'model-1' })] });

      const ok = await useChatStore.getState().deleteThread(agent);
      off();

      expect(ok).toBe(true);
      expect(mockLocal.remove).toHaveBeenCalledWith('agent-1');
      expect(mockRepo.remove).not.toHaveBeenCalled();
      expect(mockRelease).toHaveBeenCalledWith('agent-1');
      expect(removed).toHaveBeenCalledWith('agent-1');
      expect(useChatStore.getState().threads.map((t) => t.id)).toEqual(['model-1']);
    });

    it('keeps the thread listed and reports an error when the repo delete fails', async () => {
      const model = summary({ id: 'model-1' });
      useChatStore.setState({ threads: [model] });
      mockRepo.remove.mockRejectedValue(new Error('network down'));
      jest.spyOn(console, 'error').mockImplementation(() => undefined);

      const ok = await useChatStore.getState().deleteThread(model);

      expect(ok).toBe(false);
      expect(useChatStore.getState().threads).toHaveLength(1);
      expect(useChatStore.getState().error).toBeTruthy();
    });

    it('fails a model chat delete when no chat repo is configured', async () => {
      mockRepoConfigured = false;
      const model = summary({ id: 'model-1' });
      useChatStore.setState({ threads: [model] });
      jest.spyOn(console, 'error').mockImplementation(() => undefined);

      expect(await useChatStore.getState().deleteThread(model)).toBe(false);
      expect(useChatStore.getState().threads).toHaveLength(1);
    });
  });

  describe('renameThread', () => {
    it('falls back to the default title for blank input', () => {
      useChatStore.setState({ threads: [summary({ id: 'a', title: 'Custom' })] });
      mockLocal.load.mockResolvedValue(null);
      mockRepo.load.mockResolvedValue(null);

      useChatStore.getState().renameThread({ threadId: 'a', title: '   ' });

      expect(useChatStore.getState().threads[0].title).toBe('New Chat');
    });

    it('lets a live session persist the rename instead of writing storage', () => {
      const renamed = jest.fn();
      const off = onThreadRenamed((id, title) => {
        renamed(id, title);
        return true;
      });
      useChatStore.setState({ threads: [summary({ id: 'a' })] });

      useChatStore.getState().renameThread({ threadId: 'a', title: 'Renamed' });
      off();

      expect(renamed).toHaveBeenCalledWith('a', 'Renamed');
      expect(mockRepo.load).not.toHaveBeenCalled();
      expect(mockLocal.load).not.toHaveBeenCalled();
    });

    it('persists the new title through the owning storage when no session is live', async () => {
      useChatStore.setState({ threads: [summary({ id: 'agent-1', backend: 'agent' })] });
      const stored = { id: 'agent-1', title: 'old', messages: [] };
      mockLocal.load.mockResolvedValue(stored);

      useChatStore.getState().renameThread({ threadId: 'agent-1', title: 'Fix login' });
      await new Promise((resolve) => setImmediate(resolve));

      expect(mockLocal.save).toHaveBeenCalledWith(expect.objectContaining({ id: 'agent-1', title: 'Fix login' }));
      expect(mockRepo.save).not.toHaveBeenCalled();
    });
  });

  describe('upsertSummary', () => {
    it('replaces an existing summary rather than duplicating it', () => {
      useChatStore.setState({ threads: [summary({ id: 'a', title: 'old', updatedAt: 1 })] });

      useChatStore.getState().upsertSummary({
        id: 'a',
        title: 'new',
        messages: [{ id: 'm', role: 'user', content: 'hi', timestamp: 2 }],
        createdAt: 1,
        updatedAt: 2,
        repoOwner: '',
        repoName: '',
        branch: '',
        filePath: '',
      });

      const threads = useChatStore.getState().threads;
      expect(threads).toHaveLength(1);
      expect(threads[0].title).toBe('new');
      expect(threads[0].messageCount).toBe(1);
    });
  });
});
