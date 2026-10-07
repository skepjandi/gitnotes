jest.mock('axios');

const mockRequest = jest.fn<() => Promise<unknown>>();
const mockAxiosInstance = {
  request: mockRequest,
  get: jest.fn(),
  post: jest.fn(),
  put: jest.fn(),
  delete: jest.fn(),
  interceptors: { request: { use: jest.fn() }, response: { use: jest.fn() } },
};
(jest.requireMock('axios') as typeof import('axios')).create = jest.fn(() => mockAxiosInstance);
(jest.requireMock('axios') as typeof import('axios')).request = mockRequest;
(jest.requireMock('axios') as typeof import('axios')).interceptors = {
  request: { use: jest.fn(), eject: jest.fn(), clear: jest.fn() },
  response: { use: jest.fn(), eject: jest.fn(), clear: jest.fn() },
};
(jest.requireMock('axios') as typeof import('axios')).isAxiosError = jest.fn((error: unknown) =>
  Boolean(error && typeof error === 'object' && (error as Record<string, unknown>).isAxiosError === true),
);

jest.mock('@/services/http', () => ({
  default: { interceptors: { request: { use: jest.fn() }, response: { use: jest.fn() } } },
}));
jest.mock('@/services/GitHubService', () => ({
  GitHubService: {
    isAuthenticated: jest.fn(() => true),
    isAuthenticatedAsync: jest.fn(() => Promise.resolve(true)),
  },
}));
jest.mock('@/services/AuthService');
const MockAuthService = require('@/services/AuthService');
MockAuthService.default.getToken = jest.fn(() => Promise.resolve('test-token'));
MockAuthService.getToken = MockAuthService.default.getToken;
MockAuthService.default.getTokenById = jest.fn(() => Promise.resolve('test-token'));
MockAuthService.getTokenById = MockAuthService.default.getTokenById;
MockAuthService.default.getActiveSummary = jest.fn(() => Promise.resolve(null));
MockAuthService.getActiveSummary = MockAuthService.default.getActiveSummary;
MockAuthService.default.listAccountSummaries = jest.fn(() => Promise.resolve([]));
MockAuthService.listAccountSummaries = MockAuthService.default.listAccountSummaries;
jest.mock('@/services/AccountStorage');
const MockAccountStorage = require('@/services/AccountStorage');
MockAccountStorage.AccountStorage.getOAuthCredential = jest.fn(() => Promise.resolve(null));

import AsyncStorage from '@react-native-async-storage/async-storage';
import type { ChatThread, ChatThreadSummary } from '@/models/Chat';
import type { AccountSummary } from '@/services/AuthService';
import type { GitHubOAuthCredentialRecord } from '@/services/git/contracts';

import * as ChatStorageService from '@/services/ChatStorageService';
import { GitHubService } from '@/services/GitHubService';
import AuthService from '@/services/AuthService';
import { AccountStorage } from '@/services/AccountStorage';

const OWNER = 'test-owner';
const REPO = 'test-repo';
const BRANCH = 'test-branch';
const THREAD_ID = 'thread-123';

function createAxiosError(message: string, status: number) {
  return { name: 'AxiosError', message, response: { status }, isAxiosError: true };
}

function makeThread(overrides: Partial<ChatThread> = {}): ChatThread {
  return {
    id: THREAD_ID,
    title: 'Test Thread',
    branch: BRANCH,
    messages: [],
    createdAt: Date.now(),
    updatedAt: Date.now(),
    repoOwner: OWNER,
    repoName: REPO,
    filePath: `chat/${THREAD_ID}.json`,
    ...overrides,
  };
}

function btoaEncode(str: string): string {
  return Buffer.from(str, 'utf8').toString('base64');
}

function mockGitHubFileResponse(content: string) {
  return { data: { content: btoaEncode(content), sha: 'test-sha' } };
}

beforeEach(async () => {
  jest.clearAllMocks();
  await AsyncStorage.clear();
});

describe('ChatStorageService regression', () => {
  describe('loadThread — valid reopen with cache fallback', () => {
    it('loads a thread from GitHub API when network succeeds', async () => {
      const thread = makeThread({ title: 'Existing Thread' });
      mockRequest.mockResolvedValueOnce(mockGitHubFileResponse(JSON.stringify(thread)));
      const result = await ChatStorageService.loadThread(OWNER, REPO, THREAD_ID, BRANCH);
      expect(result).not.toBeNull();
      expect(result?.id).toBe(THREAD_ID);
      expect(result?.title).toBe('Existing Thread');
      expect(mockRequest).toHaveBeenCalledWith(
        expect.objectContaining({ url: expect.stringContaining(`chat/${THREAD_ID}.json`) }),
      );
    });

    it('removes cache and returns null when GitHub returns 404', async () => {
      const thread = makeThread({ title: 'Cached Thread' });
      await AsyncStorage.setItem(`chat-thread-${OWNER}-${REPO}-${BRANCH}-${THREAD_ID}`, JSON.stringify(thread));
      mockRequest.mockResolvedValueOnce(createAxiosError('Not Found', 404));
      const result = await ChatStorageService.loadThread(OWNER, REPO, THREAD_ID, BRANCH);
      expect(result).toBeNull();
    });

    it('falls back to AsyncStorage cache when GitHub throws network error', async () => {
      const thread = makeThread({ title: 'Cached Thread' });
      await AsyncStorage.setItem(`chat-thread-${OWNER}-${REPO}-${BRANCH}-${THREAD_ID}`, JSON.stringify(thread));
      mockRequest.mockRejectedValueOnce(new Error('Network error'));
      const result = await ChatStorageService.loadThread(OWNER, REPO, THREAD_ID, BRANCH);
      expect(result).not.toBeNull();
      expect(result?.title).toBe('Cached Thread');
    });

    it('returns null and clears cache when thread not found and no cache', async () => {
      mockRequest.mockResolvedValueOnce(createAxiosError('Not Found', 404));
      const result = await ChatStorageService.loadThread(OWNER, REPO, THREAD_ID, BRANCH);
      expect(result).toBeNull();
    });
  });

  describe('loadThread — auth/network errors', () => {
    it('throws when GitHub token is not available', async () => {
      jest.spyOn(GitHubService, 'isAuthenticated').mockReturnValueOnce(false);
      await expect(ChatStorageService.loadThread(OWNER, REPO, THREAD_ID, BRANCH)).rejects.toThrow('GitHub not authenticated');
      jest.restoreAllMocks();
    });

    it('re-throws non-404 network errors after exhausting cache', async () => {
      mockRequest.mockRejectedValueOnce(new Error('Server error'));
      await expect(ChatStorageService.loadThread(OWNER, REPO, THREAD_ID, BRANCH)).rejects.toThrow('Server error');
    });
  });

  describe('loadThread — branch/account isolation', () => {
    it('uses different cache keys for different branches', async () => {
      const threadMain = makeThread({ title: 'Main Branch Thread' });
      const threadFeature = makeThread({ title: 'Feature Branch Thread', branch: 'feature' });
      await AsyncStorage.setItem(`chat-thread-${OWNER}-${REPO}-main-${THREAD_ID}`, JSON.stringify(threadMain));
      await AsyncStorage.setItem(`chat-thread-${OWNER}-${REPO}-feature-${THREAD_ID}`, JSON.stringify(threadFeature));
      mockRequest.mockRejectedValueOnce(new Error('Network error'));
      const mainResult = await ChatStorageService.loadThread(OWNER, REPO, THREAD_ID, 'main');
      expect(mainResult?.title).toBe('Main Branch Thread');
      mockRequest.mockRejectedValueOnce(new Error('Network error'));
      const featureResult = await ChatStorageService.loadThread(OWNER, REPO, THREAD_ID, 'feature');
      expect(featureResult?.title).toBe('Feature Branch Thread');
    });

    it('uses account-scoped token when setChatRepoAccount is called', async () => {
      const thread = makeThread();
      mockRequest.mockResolvedValueOnce(mockGitHubFileResponse(JSON.stringify(thread)));
      ChatStorageService.setChatRepoAccount('account-123');
      jest.spyOn(AuthService, 'getTokenById').mockResolvedValueOnce('account-scoped-token');
      await ChatStorageService.loadThread(OWNER, REPO, THREAD_ID, BRANCH);
      expect(AuthService.getTokenById).toHaveBeenCalledWith('account-123');
      expect(AuthService.getToken).not.toHaveBeenCalled();
      jest.restoreAllMocks();
    });
  });

  describe('loadThread — first-message persistence', () => {
    it('persists loaded thread to AsyncStorage cache', async () => {
      const thread = makeThread({ messages: [{ id: 'msg-1', role: 'user', content: 'Hello', timestamp: Date.now() }] });
      mockRequest.mockResolvedValueOnce(mockGitHubFileResponse(JSON.stringify(thread)));
      await ChatStorageService.loadThread(OWNER, REPO, THREAD_ID, BRANCH);
      const cached = await AsyncStorage.getItem(`chat-thread-${OWNER}-${REPO}-${BRANCH}-${THREAD_ID}`);
      expect(cached).not.toBeNull();
      const parsed = JSON.parse(cached!) as ChatThread;
      expect(parsed.messages.length).toBe(1);
    });
  });

  describe('loadThreadSummaries — index handling', () => {
    it('returns empty array and caches when index is 404', async () => {
      mockRequest.mockRejectedValueOnce(createAxiosError('Not Found', 404));
      const result = await ChatStorageService.loadThreadSummaries(OWNER, REPO, BRANCH);
      expect(result).toEqual([]);
      const cached = await AsyncStorage.getItem(`chat-index-${OWNER}-${REPO}-${BRANCH}`);
      expect(cached).toBe('[]');
    });

    it('parses valid index with non-default titles without triggering repair', async () => {
      const summaries: ChatThreadSummary[] = [
        { id: 'thread-1', title: 'Discussion About Git', updatedAt: Date.now(), messageCount: 3, preview: 'Last message here' },
        { id: 'thread-2', title: 'Custom Title', updatedAt: Date.now(), messageCount: 2, preview: 'Another preview' },
      ];
      mockRequest.mockResolvedValueOnce(mockGitHubFileResponse(JSON.stringify({ threads: summaries })));
      const result = await ChatStorageService.loadThreadSummaries(OWNER, REPO, BRANCH);
      const titles = result.map((s) => s.title);
      expect(titles).toContain('Discussion About Git');
      expect(titles).toContain('Custom Title');
    });
  });

  describe('saveThread — persistence', () => {
    it('saves thread to GitHub and updates index', async () => {
      const thread = makeThread({ messages: [{ id: 'msg-1', role: 'user', content: 'Hello', timestamp: Date.now() }] });
      mockRequest
        .mockRejectedValueOnce(createAxiosError('Not Found', 404))
        .mockResolvedValueOnce(mockGitHubFileResponse(JSON.stringify({ threads: [] })))
        .mockResolvedValueOnce(mockGitHubFileResponse(JSON.stringify({ threads: [] })))
        .mockResolvedValueOnce(mockGitHubFileResponse(JSON.stringify({ threads: [] })))
        .mockResolvedValueOnce({ data: null });
      await ChatStorageService.saveThread(thread);
      expect(mockRequest.mock.calls.length).toBeGreaterThanOrEqual(4);
    });

    it('persists thread to AsyncStorage after save', async () => {
      const thread = makeThread({ messages: [{ id: 'msg-1', role: 'user', content: 'Hello', timestamp: Date.now() }] });
      mockRequest
        .mockRejectedValueOnce(createAxiosError('Not Found', 404))
        .mockResolvedValueOnce(mockGitHubFileResponse(JSON.stringify({ threads: [] })))
        .mockResolvedValueOnce(mockGitHubFileResponse(JSON.stringify({ threads: [] })))
        .mockResolvedValueOnce(mockGitHubFileResponse(JSON.stringify({ threads: [] })))
        .mockResolvedValueOnce({ data: null });
      await ChatStorageService.saveThread(thread);
      const cached = await AsyncStorage.getItem(`chat-thread-${OWNER}-${REPO}-${BRANCH}-${THREAD_ID}`);
      expect(cached).not.toBeNull();
    });
  });

  describe('deleteThread', () => {
    it('removes thread from GitHub and index', async () => {
      mockRequest
        .mockRejectedValueOnce(createAxiosError('Not Found', 404))
        .mockResolvedValueOnce(mockGitHubFileResponse(JSON.stringify({ threads: [] })))
        .mockResolvedValueOnce(mockGitHubFileResponse(JSON.stringify({ threads: [] })))
        .mockResolvedValueOnce(mockGitHubFileResponse(JSON.stringify({ threads: [] })))
        .mockResolvedValueOnce({ data: null });
      await ChatStorageService.deleteThread(OWNER, REPO, THREAD_ID, BRANCH);
      expect(mockRequest.mock.calls.length).toBeGreaterThanOrEqual(3);
    });

    it('clears AsyncStorage cache after deletion', async () => {
      const thread = makeThread();
      await AsyncStorage.setItem(`chat-thread-${OWNER}-${REPO}-${BRANCH}-${THREAD_ID}`, JSON.stringify(thread));
      mockRequest
        .mockRejectedValueOnce(createAxiosError('Not Found', 404))
        .mockResolvedValueOnce(mockGitHubFileResponse(JSON.stringify({ threads: [] })))
        .mockResolvedValueOnce(mockGitHubFileResponse(JSON.stringify({ threads: [] })))
        .mockResolvedValueOnce(mockGitHubFileResponse(JSON.stringify({ threads: [] })))
        .mockResolvedValueOnce({ data: null });
      await ChatStorageService.deleteThread(OWNER, REPO, THREAD_ID, BRANCH);
      const cached = await AsyncStorage.getItem(`chat-thread-${OWNER}-${REPO}-${BRANCH}-${THREAD_ID}`);
      expect(cached).toBeNull();
    });
  });

  describe('isChatStorageInitialized', () => {
    it('returns true when index exists', async () => {
      mockRequest.mockResolvedValueOnce({ data: { sha: 'index-sha' } });
      const result = await ChatStorageService.isChatStorageInitialized(OWNER, REPO, BRANCH);
      expect(result).toBe(true);
    });

    it('returns false when index returns 404', async () => {
      mockRequest.mockRejectedValueOnce(createAxiosError('Not Found', 404));
      const result = await ChatStorageService.isChatStorageInitialized(OWNER, REPO, BRANCH);
      expect(result).toBe(false);
    });

    it('throws on non-404 network errors', async () => {
      mockRequest.mockReset();
      mockRequest.mockRejectedValueOnce(new Error('Server error'));
      await expect(ChatStorageService.isChatStorageInitialized(OWNER, REPO, BRANCH)).rejects.toThrow('Server error');
    });
  });

  describe('OAuth-only user regression', () => {
    const oauthCredential = {
      kind: 'oauth' as const,
      accessToken: 'oauth-access-token-123',
      expiresAt: Date.now() + 3600 * 1000,
      userId: 12345,
      renewal: {
        refreshToken: 'refresh-token',
        backendUrl: 'https://gitnotes-backend.example.com',
        refreshExpiresAt: Date.now() + 86400 * 1000,
      },
    };

    const activeSummary = {
      account: { id: 'account-123', login: 'testuser', name: 'Test User', email: 'test@test.com', avatarUrl: '', hostIds: ['host-1'] },
      hosts: [{
        id: 'host-1',
        accountId: 'account-123',
        provider: 'github' as const,
        hostLogin: 'testuser',
        hostUserId: 12345,
        name: 'Test User',
        email: 'test@test.com',
        avatarUrl: '',
        instanceBaseUrl: null,
        addedAt: Date.now(),
      }],
      activeHostId: 'host-1',
    };

    beforeEach(async () => {
      jest.clearAllMocks();
      mockRequest.mockReset();
      mockRequest.mockResolvedValue(undefined);
      await AsyncStorage.clear();
      ChatStorageService.setChatRepoAccount(null);
    });

    it('falls back to OAuth token when no singleton token exists', async () => {
      jest.spyOn(GitHubService, 'isAuthenticated').mockReturnValueOnce(false);
      jest.spyOn(GitHubService, 'isAuthenticatedAsync').mockResolvedValueOnce(true);
      jest.spyOn(AuthService, 'listAccountSummaries').mockResolvedValueOnce([activeSummary as AccountSummary]);
      jest.spyOn(AccountStorage, 'getOAuthCredential').mockResolvedValueOnce(oauthCredential as GitHubOAuthCredentialRecord);

      const thread = makeThread();
      mockRequest.mockResolvedValueOnce(mockGitHubFileResponse(JSON.stringify(thread)));

      const result = await ChatStorageService.loadThread(OWNER, REPO, THREAD_ID, BRANCH);

      expect(result).not.toBeNull();
      expect(result?.id).toBe(THREAD_ID);
      expect(mockRequest).toHaveBeenCalledWith(
        expect.objectContaining({
          headers: expect.objectContaining({
            Authorization: 'token oauth-access-token-123',
          }),
        }),
      );
    });

    it('uses OAuth token when setChatRepoAccount is called with OAuth-only active account', async () => {
      jest.spyOn(GitHubService, 'isAuthenticated').mockReturnValueOnce(false);
      jest.spyOn(AuthService, 'getTokenById').mockResolvedValueOnce(null);
      jest.spyOn(GitHubService, 'isAuthenticatedAsync').mockResolvedValueOnce(true);
      jest.spyOn(AuthService, 'listAccountSummaries').mockResolvedValueOnce([activeSummary as AccountSummary]);
      jest.spyOn(AccountStorage, 'getOAuthCredential').mockResolvedValueOnce(oauthCredential as GitHubOAuthCredentialRecord);

      ChatStorageService.setChatRepoAccount('account-123');

      const thread = makeThread();
      mockRequest.mockResolvedValueOnce(mockGitHubFileResponse(JSON.stringify(thread)));

      const result = await ChatStorageService.loadThread(OWNER, REPO, THREAD_ID, BRANCH);

      expect(result).not.toBeNull();
      expect(result?.id).toBe(THREAD_ID);
      expect(AccountStorage.getOAuthCredential).toHaveBeenCalledWith('host-1');
    });

    it('throws when OAuth is not available and no singleton token exists', async () => {
      jest.spyOn(GitHubService, 'isAuthenticated').mockReturnValueOnce(false);
      jest.spyOn(GitHubService, 'isAuthenticatedAsync').mockResolvedValueOnce(false);

      await expect(ChatStorageService.loadThread(OWNER, REPO, THREAD_ID, BRANCH))
        .rejects.toThrow('GitHub not authenticated');
    });
  });
});
