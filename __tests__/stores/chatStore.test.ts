/**
 * Regression tests for chatStore — covers:
 * - Thread CRUD operations
 * - Message add/update/remove/truncate
 * - Storage adapter wiring
 * - Branch/account isolation via adapter
 * - Error handling
 */
jest.mock('@/services/ChatStorageService');

import { useChatStore } from '@/stores/chatStore';
import type { ChatThread, ChatThreadSummary, ChatMessage } from '@/models/Chat';

// ── Helpers ───────────────────────────────────────────────────────────────────

const OWNER = 'test-owner';
const REPO = 'test-repo';
const BRANCH = 'main';

function makeThread(overrides: Partial<ChatThread> = {}): ChatThread {
  const now = Date.now();
  return {
    id: `${now}-thread`,
    title: 'Test Thread',
    messages: [],
    createdAt: now,
    updatedAt: now,
    repoOwner: OWNER,
    repoName: REPO,
    branch: BRANCH,
    filePath: 'chat/test.json',
    ...overrides,
  };
}

function makeMessage(overrides: Partial<ChatMessage> = {}): ChatMessage {
  return {
    id: `msg-${Math.random().toString(36).slice(2, 8)}`,
    role: 'user',
    content: 'Test message',
    timestamp: Date.now(),
    ...overrides,
  };
}

function makeSummary(overrides: Partial<ChatThreadSummary> = {}): ChatThreadSummary {
  return {
    id: `thread-${Math.random().toString(36).slice(2, 8)}`,
    title: 'Test Thread',
    updatedAt: Date.now(),
    messageCount: 0,
    preview: 'No messages yet',
    ...overrides,
  };
}

// ── Mock adapter ─────────────────────────────────────────────────────────────

const mockLoadThreadSummaries = jest.fn();
const mockLoadThread = jest.fn();
const mockSaveThread = jest.fn();
const mockDeleteThread = jest.fn();

function createMockAdapter() {
  return {
    loadThreadSummaries: mockLoadThreadSummaries,
    loadThread: mockLoadThread,
    saveThread: mockSaveThread,
    deleteThread: mockDeleteThread,
  };
}

// ── Test suite ───────────────────────────────────────────────────────────────

describe('chatStore regression', () => {
  let adapter = createMockAdapter();

  beforeEach(() => {
    jest.clearAllMocks();
    adapter = createMockAdapter();
    useChatStore.setState({
      threads: [],
      activeThread: null,
      isLoading: false,
      error: null,
      isStreaming: false,
      storageAdapter: null,
    });
  });

  describe('setStorageAdapter', () => {
    it('accepts a storage adapter and makes it available', () => {
      useChatStore.getState().setStorageAdapter(adapter);

      expect(useChatStore.getState().storageAdapter).toBe(adapter);
    });
  });

  describe('loadThreads', () => {
    it('loads thread summaries via adapter', async () => {
      const summaries = [makeSummary(), makeSummary()];
      mockLoadThreadSummaries.mockResolvedValueOnce(summaries);
      useChatStore.getState().setStorageAdapter(adapter);

      await useChatStore.getState().loadThreads({ owner: OWNER, repo: REPO, branch: BRANCH });

      expect(mockLoadThreadSummaries).toHaveBeenCalledWith(OWNER, REPO, BRANCH);
      expect(useChatStore.getState().threads).toHaveLength(2);
      expect(useChatStore.getState().isLoading).toBe(false);
    });

    it('sets error when adapter is not set', async () => {
      await useChatStore.getState().loadThreads({ owner: OWNER, repo: REPO, branch: BRANCH });

      expect(useChatStore.getState().threads).toHaveLength(0);
      expect(mockLoadThreadSummaries).not.toHaveBeenCalled();
    });

    it('sets error state on adapter failure', async () => {
      mockLoadThreadSummaries.mockRejectedValueOnce(new Error('Network failure'));
      useChatStore.getState().setStorageAdapter(adapter);

      await useChatStore.getState().loadThreads({ owner: OWNER, repo: REPO, branch: BRANCH });

      expect(useChatStore.getState().error).toBe('Failed to load chat threads');
      expect(useChatStore.getState().isLoading).toBe(false);
    });
  });

  describe('loadThread', () => {
    it('loads thread via adapter and sets it as active', async () => {
      const thread = makeThread({ messages: [makeMessage({ role: 'user', content: 'Hello' })] });
      mockLoadThread.mockResolvedValueOnce(thread);
      useChatStore.getState().setStorageAdapter(adapter);

      const result = await useChatStore.getState().loadThread({ owner: OWNER, repo: REPO, branch: BRANCH, threadId: thread.id });

      expect(result?.id).toBe(thread.id);
      expect(useChatStore.getState().activeThread?.id).toBe(thread.id);
    });

    it('returns null when adapter is not set', async () => {
      const result = await useChatStore.getState().loadThread({ owner: OWNER, repo: REPO, branch: BRANCH, threadId: 'any-id' });

      expect(result).toBeNull();
    });

    it('updates existing thread in threads list when loaded', async () => {
      const existing = makeThread({ id: 'existing-id' });
      const updated = makeThread({ id: 'existing-id', title: 'Updated Title' });
      useChatStore.setState({ threads: [existing] });
      mockLoadThread.mockResolvedValueOnce(updated);
      useChatStore.getState().setStorageAdapter(adapter);

      await useChatStore.getState().loadThread({ owner: OWNER, repo: REPO, branch: BRANCH, threadId: 'existing-id' });

      const threads = useChatStore.getState().threads;
      expect(threads.find((t) => t.id === 'existing-id')?.title).toBe('Updated Title');
    });
  });

  describe('createThread', () => {
    it('creates a new thread and sets it as active', () => {
      const thread = useChatStore.getState().createThread({
        repoOwner: OWNER,
        repoName: REPO,
        branch: BRANCH,
        filePath: 'chat/new.json',
        title: 'New Chat',
      });

      expect(thread.id).toBeTruthy();
      expect(thread.title).toBe('New Chat');
      expect(useChatStore.getState().activeThread?.id).toBe(thread.id);
    });

    it('uses default title when none provided', () => {
      const thread = useChatStore.getState().createThread({
        repoOwner: OWNER,
        repoName: REPO,
        branch: BRANCH,
        filePath: 'chat/new.json',
      });

      expect(thread.title).toBe('New Chat');
    });

    it('adds thread to threads list', () => {
      const thread = useChatStore.getState().createThread({
        repoOwner: OWNER,
        repoName: REPO,
        branch: BRANCH,
        filePath: 'chat/new.json',
      });

      expect(useChatStore.getState().threads.some((t) => t.id === thread.id)).toBe(true);
    });
  });

  describe('addMessage', () => {
    it('appends a message to the active thread', () => {
      const thread = makeThread();
      useChatStore.setState({ activeThread: thread });

      const msg = makeMessage({ role: 'user', content: 'Hello there' });
      useChatStore.getState().addMessage(msg);

      expect(useChatStore.getState().activeThread?.messages).toHaveLength(1);
      expect(useChatStore.getState().activeThread?.messages[0].content).toBe('Hello there');
    });

    it('derives chat title from first user message when title is default', () => {
      const thread = makeThread({ title: 'New Chat' });
      useChatStore.setState({ activeThread: thread });

      const msg = makeMessage({ role: 'user', content: 'What is GitNotes?' });
      useChatStore.getState().addMessage(msg);

      // Title should now be derived from the message
      expect(useChatStore.getState().activeThread?.title).not.toBe('New Chat');
    });

    it('does nothing when no active thread', () => {
      useChatStore.setState({ activeThread: null });

      const msg = makeMessage();
      useChatStore.getState().addMessage(msg);

      expect(useChatStore.getState().threads).toHaveLength(0);
    });
  });

  describe('updateMessage', () => {
    it('updates an existing message', () => {
      const msg1 = makeMessage({ id: 'msg-1', content: 'Original' });
      const msg2 = makeMessage({ id: 'msg-2', content: 'Second' });
      const thread = makeThread({ messages: [msg1, msg2] });
      useChatStore.setState({ activeThread: thread });

      useChatStore.getState().updateMessage('msg-1', { content: 'Updated' });

      expect(useChatStore.getState().activeThread?.messages.find((m) => m.id === 'msg-1')?.content).toBe('Updated');
      expect(useChatStore.getState().activeThread?.messages.find((m) => m.id === 'msg-2')?.content).toBe('Second');
    });

    it('does nothing when message does not exist', () => {
      const thread = makeThread({ messages: [makeMessage({ id: 'msg-1' })] });
      useChatStore.setState({ activeThread: thread });

      useChatStore.getState().updateMessage('non-existent', { content: 'Updated' });

      expect(useChatStore.getState().activeThread?.messages[0].content).toBe('Test message');
    });
  });

  describe('removeMessage', () => {
    it('removes a message by id', () => {
      const msg1 = makeMessage({ id: 'msg-1' });
      const msg2 = makeMessage({ id: 'msg-2' });
      const thread = makeThread({ messages: [msg1, msg2] });
      useChatStore.setState({ activeThread: thread });

      useChatStore.getState().removeMessage('msg-1');

      expect(useChatStore.getState().activeThread?.messages).toHaveLength(1);
      expect(useChatStore.getState().activeThread?.messages[0].id).toBe('msg-2');
    });

    it('does nothing when thread has no messages', () => {
      const thread = makeThread({ messages: [] });
      useChatStore.setState({ activeThread: thread });

      useChatStore.getState().removeMessage('any-id');

      expect(useChatStore.getState().activeThread?.messages).toHaveLength(0);
    });
  });

  describe('truncateAfter', () => {
    it('removes all messages after the specified message (exclusive)', () => {
      const msgs = [
        makeMessage({ id: 'msg-1', role: 'user', content: 'First' }),
        makeMessage({ id: 'msg-2', role: 'assistant', content: 'Second' }),
        makeMessage({ id: 'msg-3', role: 'user', content: 'Third' }),
      ];
      const thread = makeThread({ messages: msgs });
      useChatStore.setState({ activeThread: thread });

      useChatStore.getState().truncateAfter('msg-2');

      const remaining = useChatStore.getState().activeThread?.messages ?? [];
      expect(remaining).toHaveLength(2);
      expect(remaining.map((m) => m.id)).toEqual(['msg-1', 'msg-2']);
    });

    it('removes specified message and all after when inclusive=true', () => {
      const msgs = [
        makeMessage({ id: 'msg-1' }),
        makeMessage({ id: 'msg-2' }),
        makeMessage({ id: 'msg-3' }),
      ];
      const thread = makeThread({ messages: msgs });
      useChatStore.setState({ activeThread: thread });

      useChatStore.getState().truncateAfter('msg-2', { inclusive: true });

      const remaining = useChatStore.getState().activeThread?.messages ?? [];
      expect(remaining).toHaveLength(1);
      expect(remaining[0].id).toBe('msg-1');
    });

    it('does nothing when message id not found', () => {
      const thread = makeThread({ messages: [makeMessage({ id: 'msg-1' })] });
      useChatStore.setState({ activeThread: thread });

      useChatStore.getState().truncateAfter('non-existent');

      expect(useChatStore.getState().activeThread?.messages).toHaveLength(1);
    });
  });

  describe('deleteThread', () => {
    it('removes thread via adapter and clears activeThread if it was selected', async () => {
      const thread = makeThread({ id: 'to-delete' });
      mockDeleteThread.mockResolvedValueOnce(true);
      useChatStore.setState({
        threads: [thread],
        activeThread: thread,
        storageAdapter: adapter,
      });

      const result = await useChatStore.getState().deleteThread({
        owner: OWNER,
        repo: REPO,
        branch: BRANCH,
        threadId: 'to-delete',
      });

      expect(result).toBe(true);
      expect(useChatStore.getState().threads.find((t) => t.id === 'to-delete')).toBeUndefined();
      expect(useChatStore.getState().activeThread).toBeNull();
    });

    it('returns false when adapter is not set', async () => {
      const result = await useChatStore.getState().deleteThread({
        owner: OWNER,
        repo: REPO,
        branch: BRANCH,
        threadId: 'any-id',
      });

      expect(result).toBe(false);
    });
  });

  describe('renameThread', () => {
    it('renames thread title in both activeThread and threads list', () => {
      const thread = makeThread({ id: 'thread-1', title: 'Old Title' });
      useChatStore.setState({
        threads: [thread],
        activeThread: thread,
      });

      useChatStore.getState().renameThread({ threadId: 'thread-1', title: 'New Title' });

      expect(useChatStore.getState().activeThread?.title).toBe('New Title');
      expect(useChatStore.getState().threads.find((t) => t.id === 'thread-1')?.title).toBe('New Title');
    });

    it('uses default title when given empty string', () => {
      const thread = makeThread({ id: 'thread-1' });
      useChatStore.setState({ threads: [thread], activeThread: thread });

      useChatStore.getState().renameThread({ threadId: 'thread-1', title: '' });

      expect(useChatStore.getState().activeThread?.title).toBe('New Chat');
    });
  });

  describe('setStreaming / clearActiveThread', () => {
    it('sets isStreaming flag', () => {
      expect(useChatStore.getState().isStreaming).toBe(false);

      useChatStore.getState().setStreaming(true);

      expect(useChatStore.getState().isStreaming).toBe(true);
    });

    it('clears activeThread and resets isStreaming', () => {
      const thread = makeThread();
      useChatStore.setState({ activeThread: thread, isStreaming: true });

      useChatStore.getState().clearActiveThread();

      expect(useChatStore.getState().activeThread).toBeNull();
      expect(useChatStore.getState().isStreaming).toBe(false);
    });
  });

  describe('clearError', () => {
    it('clears error state', () => {
      useChatStore.setState({ error: 'Some error' });

      useChatStore.getState().clearError();

      expect(useChatStore.getState().error).toBeNull();
    });
  });
});
