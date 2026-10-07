import AsyncStorage from '@react-native-async-storage/async-storage';
import axios from 'axios';

import { ChatThread, ChatThreadSummary } from '../models/Chat';
import { buildThreadSummary, isDefaultChatTitle } from '../utils/chatThreadSummary';
import { GitHubService } from './GitHubService';
import { AccountStorage } from './AccountStorage';

const GITHUB_API = 'https://api.github.com';
const CHAT_DIR = 'chat';
const INDEX_PATH = `${CHAT_DIR}/index.json`;
import AuthService from './AuthService';
import { GITHUB_WRITE_RETRIES } from './ai/config';

interface GitHubContentResponse {
  content?: string;
  sha?: string;
}

interface ChatIndex {
  threads: ChatThreadSummary[];
}

interface LoadThreadOptions {
  persistRepair?: boolean;
}

const repoWriteQueue = new Map<string, Promise<unknown>>();

function getIndexCacheKey(owner: string, repo: string): string {
  return `chat-index-${owner}-${repo}`;
}

function getScopedIndexCacheKey(owner: string, repo: string, branch: string): string {
  return `${getIndexCacheKey(owner, repo)}-${branch}`;
}

function getThreadCacheKey(owner: string, repo: string, branch: string, threadId: string): string {
  return `chat-thread-${owner}-${repo}-${branch}-${threadId}`;
}

function getRepoWriteQueueKey(owner: string, repo: string, branch: string): string {
  return `${owner}/${repo}/${branch}`;
}

function encodePath(path: string): string {
  return path.split('/').map(encodeURIComponent).join('/');
}

function contentUrl(owner: string, repo: string, path: string): string {
  return `${GITHUB_API}/repos/${owner}/${repo}/contents/${encodePath(path)}`;
}

function toBase64(value: string): string {
  const bytes = new TextEncoder().encode(value);
  let binary = '';
  bytes.forEach((byte) => {
    binary += String.fromCharCode(byte);
  });
  return btoa(binary);
}

function fromBase64(value: string): string {
  const binary = atob(value.replace(/\n/g, ''));
  const bytes = Uint8Array.from(binary, (char) => char.charCodeAt(0));
  return new TextDecoder('utf-8').decode(bytes);
}

function getStatus(error: unknown): number | undefined {
  return axios.isAxiosError(error) ? error.response?.status : undefined;
}

let chatRepoAccountId: string | null = null;

/**
 * Bind chat-repo requests to a specific account's token. When set, all
 * ChatStorageService GitHub calls use that account's token regardless of
 * which account is currently active in the app.
 */
export function setChatRepoAccount(accountId: string | null): void {
  chatRepoAccountId = accountId;
}

async function getOAuthToken(accountId?: string | null): Promise<string | null> {
  const summaries = await AuthService.listAccountSummaries();
  const hosts = summaries
    .filter((summary) => !accountId || summary.account.id === accountId)
    .flatMap((summary) => summary.hosts.filter((host) => host.provider === 'github'));
  for (const host of hosts) {
    const oauthCred = await AccountStorage.getOAuthCredential(host.id);
    if (oauthCred?.accessToken) return oauthCred.accessToken;
  }
  return null;
}

async function getToken(): Promise<string> {
  if (chatRepoAccountId) {
    const scoped = await AuthService.getTokenById(chatRepoAccountId);
    if (scoped) return scoped;
    if (await GitHubService.isAuthenticatedAsync()) {
      const oauthToken = await getOAuthToken(chatRepoAccountId);
      if (oauthToken) return oauthToken;
    }
    throw new Error('GitHub not authenticated');
  }

  if (GitHubService.isAuthenticated()) {
    const token = await AuthService.getToken();
    if (token) return token;
  }

  if (await GitHubService.isAuthenticatedAsync()) {
    const oauthToken = await getOAuthToken();
    if (oauthToken) return oauthToken;
  }

  throw new Error('GitHub not authenticated');
}

async function githubRequest<T>(params: {
  owner: string;
  repo: string;
  path: string;
  method?: 'GET' | 'PUT' | 'DELETE';
  branch?: string;
  data?: Record<string, unknown>;
}): Promise<T> {
  const token = await getToken();
  const { owner, repo, path, method = 'GET', branch, data } = params;
  const url = contentUrl(owner, repo, path);
  const response = await axios.request<T>({
    url,
    method,
    headers: {
      Accept: 'application/vnd.github+json',
      Authorization: `token ${token}`,
      'X-GitHub-Api-Version': '2022-11-28',
    },
    params: method === 'GET' && branch ? { ref: branch } : undefined,
    data,
  });
  return response.data;
}

async function getFile(owner: string, repo: string, path: string, branch: string): Promise<GitHubContentResponse | null> {
  try {
    return await githubRequest<GitHubContentResponse>({ owner, repo, path, branch });
  } catch (error) {
    if (getStatus(error) === 404) {
      return null;
    }
    throw error;
  }
}

async function putFile(params: {
  owner: string;
  repo: string;
  path: string;
  branch: string;
  message: string;
  content: string;
  sha?: string;
}): Promise<void> {
  const { owner, repo, path, branch, message, content } = params;
  let sha = params.sha;

  for (let attempt = 0; attempt < GITHUB_WRITE_RETRIES; attempt++) {
    try {
      await githubRequest({
        owner,
        repo,
        path,
        method: 'PUT',
        data: {
          message,
          content: toBase64(content),
          branch,
          ...(sha ? { sha } : {}),
        },
      });
      return;
    } catch (error) {
      const status = getStatus(error);
      if ((status === 409 || status === 422) && attempt < GITHUB_WRITE_RETRIES - 1) {
        const latest = await getFile(owner, repo, path, branch);
        sha = latest?.sha;
        await new Promise((r) => setTimeout(r, 250 * (attempt + 1)));
        continue;
      }
      throw error;
    }
  }
}

async function deleteFile(params: {
  owner: string;
  repo: string;
  path: string;
  branch: string;
  message: string;
  sha: string;
}): Promise<void> {
  const { owner, repo, path, branch, message } = params;
  let sha = params.sha;

  for (let attempt = 0; attempt < GITHUB_WRITE_RETRIES; attempt++) {
    try {
      await githubRequest({
        owner,
        repo,
        path,
        method: 'DELETE',
        data: { message, sha, branch },
      });
      return;
    } catch (error) {
      const status = getStatus(error);
      if (status === 404) {
        return;
      }
      if ((status === 409 || status === 422) && attempt < GITHUB_WRITE_RETRIES - 1) {
        const latest = await getFile(owner, repo, path, branch);
        if (!latest?.sha) {
          return;
        }
        sha = latest.sha;
        await new Promise((r) => setTimeout(r, 250 * (attempt + 1)));
        continue;
      }
      throw error;
    }
  }
}

async function writeIndex(owner: string, repo: string, branch: string, threads: ChatThreadSummary[]): Promise<void> {
  const sortedThreads = sortThreads(threads);
  const existingIndex = await getFile(owner, repo, INDEX_PATH, branch);
  await putFile({
    owner,
    repo,
    path: INDEX_PATH,
    branch,
    message: 'Update chat index',
    content: JSON.stringify({ threads: sortedThreads }, null, 2),
    sha: existingIndex?.sha,
  });
  await AsyncStorage.setItem(getScopedIndexCacheKey(owner, repo, branch), JSON.stringify(sortedThreads));
}

function sortThreads(threads: ChatThreadSummary[]): ChatThreadSummary[] {
  return [...threads].sort((a, b) => b.updatedAt - a.updatedAt);
}

async function repairSummaryIfNeeded(
  owner: string,
  repo: string,
  branch: string,
  summary: ChatThreadSummary,
): Promise<ChatThreadSummary> {
  const needsTitleRepair = isDefaultChatTitle(summary.title);
  const needsPreviewRepair = summary.messageCount > 0 && (!summary.preview || summary.preview === 'No messages yet');

  if (!needsTitleRepair && !needsPreviewRepair) {
    return summary;
  }

  const thread = await loadThread(owner, repo, summary.id, branch, { persistRepair: false });
  return thread ? buildThreadSummary(thread) : summary;
}

async function repairCachedSummaryIfNeeded(
  owner: string,
  repo: string,
  branch: string,
  summary: ChatThreadSummary,
): Promise<ChatThreadSummary> {
  const needsTitleRepair = isDefaultChatTitle(summary.title);
  const needsPreviewRepair = summary.messageCount > 0 && (!summary.preview || summary.preview === 'No messages yet');

  if (!needsTitleRepair && !needsPreviewRepair) {
    return summary;
  }

  const cachedThread = await AsyncStorage.getItem(getThreadCacheKey(owner, repo, branch, summary.id));
  if (!cachedThread) {
    return summary;
  }

  try {
    return buildThreadSummary(normalizeLoadedThread(JSON.parse(cachedThread) as ChatThread));
  } catch (error) {
    console.warn('[ChatStorageService] Failed to parse thread summary:', error);
    return summary;
  }
}

async function enqueueRepoWrite<T>(
  owner: string,
  repo: string,
  branch: string,
  work: () => Promise<T>,
): Promise<T> {
  const key = getRepoWriteQueueKey(owner, repo, branch);
  const previous = repoWriteQueue.get(key) ?? Promise.resolve();
  const next = previous.catch(() => {
    // error handled by tracked promise below
  }).then(work);
  const tracked = next.then(() => undefined, () => undefined).finally(() => {
    if (repoWriteQueue.get(key) === tracked) {
      repoWriteQueue.delete(key);
    }
  });

  repoWriteQueue.set(key, tracked);
  return next;
}

function normalizeLoadedThread(thread: ChatThread): ChatThread {
  const derivedTitle = buildThreadSummary(thread).title;
  if (derivedTitle === thread.title) {
    return thread;
  }

  return {
    ...thread,
    title: derivedTitle,
  };
}

async function persistThreadRepairNow(
  thread: ChatThread,
  existingThreadSha: string | undefined,
): Promise<void> {
  const owner = thread.repoOwner;
  const repo = thread.repoName;
  const branch = thread.branch || 'main';
  const path = `${CHAT_DIR}/${thread.id}.json`;

  await putFile({
    owner,
    repo,
    path,
    branch,
    message: `Repair chat thread title: ${thread.title}`,
    content: JSON.stringify(thread, null, 2),
    sha: existingThreadSha,
  });

  const existingIndex = await getFile(owner, repo, INDEX_PATH, branch);
  const parsedIndex = existingIndex?.content
    ? (JSON.parse(fromBase64(existingIndex.content)) as ChatIndex)
    : { threads: [] };
  const nextSummaries = sortThreads([
    ...(Array.isArray(parsedIndex.threads) ? parsedIndex.threads : []).filter((summary) => summary.id !== thread.id),
    buildThreadSummary(thread),
  ]);
  await writeIndex(owner, repo, branch, nextSummaries);
  await AsyncStorage.setItem(getThreadCacheKey(owner, repo, branch, thread.id), JSON.stringify(thread));
}

async function persistThreadRepair(
  thread: ChatThread,
  existingThreadSha: string | undefined,
): Promise<void> {
  await enqueueRepoWrite(thread.repoOwner, thread.repoName, thread.branch || 'main', () =>
    persistThreadRepairNow(thread, existingThreadSha),
  );
}

export async function initializeChatStorage(owner: string, repo: string, branch: string = 'main'): Promise<boolean> {
  if (!await GitHubService.isAuthenticatedAsync()) {
    return false;
  }

  const files = [
    {
      path: `${CHAT_DIR}/.gitkeep`,
      message: 'Initialize chat storage',
      content: '',
    },
    {
      path: INDEX_PATH,
      message: 'Initialize chat index',
      content: JSON.stringify({ threads: [] }, null, 2),
    },
  ];

  for (const file of files) {
    try {
      await putFile({ owner, repo, path: file.path, branch, message: file.message, content: file.content });
    } catch (error) {
      const status = getStatus(error);
      if (status !== 409 && status !== 422) {
        throw error;
      }
    }
  }

  await AsyncStorage.setItem(getScopedIndexCacheKey(owner, repo, branch), JSON.stringify([]));
  return true;
}

/**
 * Error codes for chat storage operations.
 * Used to classify errors for appropriate recovery strategies.
 */
export enum ChatStorageErrorCode {
  /** GitHub API returned 404 - index doesn't exist yet */
  NOT_FOUND = 'NOT_FOUND',
  /** GitHub API returned 401 - credentials invalid or expired */
  UNAUTHORIZED = 'UNAUTHORIZED',
  /** GitHub API returned 403 - token lacks required permissions */
  FORBIDDEN = 'FORBIDDEN',
  /** GitHub API returned 429 - rate limit exceeded */
  RATE_LIMITED = 'RATE_LIMITED',
  /** GitHub API returned 5xx - server error, may be transient */
  SERVER_ERROR = 'SERVER_ERROR',
  /** Network-level failure (no connection, timeout, etc) */
  NETWORK_ERROR = 'NETWORK_ERROR',
  /** Response body was valid JSON but payload shape was invalid */
  INVALID_PAYLOAD = 'INVALID_PAYLOAD',
  /** Response body was not valid JSON */
  PARSE_ERROR = 'PARSE_ERROR',
  /** Unknown error */
  UNKNOWN = 'UNKNOWN',
}

export class ChatStorageError extends Error {
  code: ChatStorageErrorCode;
  status?: number;
  warning?: string;
  cachedData?: ChatThreadSummary[];

  constructor(code: ChatStorageErrorCode, message: string, status?: number, warning?: string, cachedData?: ChatThreadSummary[]) {
    super(message);
    this.name = 'ChatStorageError';
    this.code = code;
    this.status = status;
    this.warning = warning;
    this.cachedData = cachedData;
  }
}

/**
 * Classifies a GitHub API error by examining status codes and error types.
 * Returns a typed ChatStorageError with appropriate error code.
 */
function classifyError(error: unknown, fallbackMessage?: string): ChatStorageError {
  const message = fallbackMessage ?? (error instanceof Error ? error.message : String(error));
  const status = getStatus(error);

  if (status === 404) {
    return new ChatStorageError(ChatStorageErrorCode.NOT_FOUND, 'Chat index not found', status);
  }
  if (status === 401) {
    return new ChatStorageError(ChatStorageErrorCode.UNAUTHORIZED, 'GitHub credentials are invalid or expired', status);
  }
  if (status === 403) {
    return new ChatStorageError(ChatStorageErrorCode.FORBIDDEN, 'Token lacks repository access permissions', status);
  }
  if (status === 429) {
    return new ChatStorageError(ChatStorageErrorCode.RATE_LIMITED, 'GitHub API rate limit exceeded', status);
  }
  if (status !== undefined && status >= 500) {
    return new ChatStorageError(ChatStorageErrorCode.SERVER_ERROR, 'GitHub server error', status);
  }
  if (error instanceof TypeError || (error instanceof Error && error.message.includes('network'))) {
    return new ChatStorageError(ChatStorageErrorCode.NETWORK_ERROR, 'Network error');
  }
  return new ChatStorageError(ChatStorageErrorCode.UNKNOWN, message);
}

/**
 * Returns true if the error code warrants using cached data as fallback.
 * Only network/5xx errors should use cache fallback.
 */
function isCacheableError(error: ChatStorageError): boolean {
  return error.code === ChatStorageErrorCode.NETWORK_ERROR || error.code === ChatStorageErrorCode.SERVER_ERROR;
}

/**
 * Validates that the parsed index has the expected { threads: ChatThreadSummary[] } shape.
 * Throws ChatStorageError with INVALID_PAYLOAD if validation fails.
 */
function validateChatIndex(parsed: unknown): asserts parsed is ChatIndex {
  if (parsed === null || typeof parsed !== 'object') {
    throw new ChatStorageError(ChatStorageErrorCode.INVALID_PAYLOAD, 'Invalid chat index: not an object');
  }
  const obj = parsed as Record<string, unknown>;
  if (!('threads' in obj)) {
    throw new ChatStorageError(ChatStorageErrorCode.INVALID_PAYLOAD, 'Invalid chat index: missing threads property');
  }
  if (!Array.isArray(obj.threads)) {
    throw new ChatStorageError(ChatStorageErrorCode.INVALID_PAYLOAD, 'Invalid chat index: threads is not an array');
  }
}

async function loadThreadSummariesInternal(owner: string, repo: string, branch: string = 'main'): Promise<ChatThreadSummary[]> {
  const cacheKey = getScopedIndexCacheKey(owner, repo, branch);

  try {
    const indexFile = await getFile(owner, repo, INDEX_PATH, branch);
    if (!indexFile?.content) {
      await AsyncStorage.setItem(cacheKey, JSON.stringify([]));
      return [];
    }

    let parsed: unknown;
    try {
      parsed = JSON.parse(fromBase64(indexFile.content));
    } catch {
      throw new ChatStorageError(ChatStorageErrorCode.PARSE_ERROR, 'Failed to parse chat index JSON');
    }

    validateChatIndex(parsed);

    const typedParsed = parsed as ChatIndex;
    const threads = sortThreads(typedParsed.threads);
    const repairedThreads = sortThreads(
      await Promise.all(threads.map((summary) => repairSummaryIfNeeded(owner, repo, branch, summary))),
    );
    const changed = JSON.stringify(repairedThreads) !== JSON.stringify(threads);
    if (changed) {
      await writeIndex(owner, repo, branch, repairedThreads);
    } else {
      await AsyncStorage.setItem(cacheKey, JSON.stringify(repairedThreads));
    }
    return repairedThreads;
  } catch (error) {
    if (error instanceof Error && 'code' in error) {
      const chatError = error as ChatStorageError;
      if (chatError.code === ChatStorageErrorCode.NOT_FOUND) {
        await AsyncStorage.setItem(cacheKey, JSON.stringify([]));
        return [];
      }
      if (isCacheableError(chatError)) {
        const cached = await AsyncStorage.getItem(cacheKey);
        if (cached) {
          try {
            const parsedCache = JSON.parse(cached);
            validateChatIndex(parsedCache);
            const parsed = parsedCache as ChatIndex;
            const cachedThreads = await Promise.all(parsed.threads.map((summary) => repairCachedSummaryIfNeeded(owner, repo, branch, summary)));
            throw new ChatStorageError(
              chatError.code,
              'Using cached thread list - data may be stale due to network issue',
              chatError.status,
              'Using cached thread list - data may be stale due to network issue',
              cachedThreads
            );
          } catch (cacheError) {
            if (cacheError instanceof ChatStorageError) throw cacheError;
            console.warn('[ChatStorageService] Failed to parse cached thread summaries:', error);
            await AsyncStorage.removeItem(cacheKey);
          }
        }
        return [];
      }
      // Non-cacheable errors (auth/429/parse/invalid) should not use cache
      throw error;
    }

    const classified = classifyError(error);
    if (classified.code === ChatStorageErrorCode.NOT_FOUND) {
      await AsyncStorage.setItem(cacheKey, JSON.stringify([]));
      return [];
    }
    if (isCacheableError(classified)) {
      const cached = await AsyncStorage.getItem(cacheKey);
      if (cached) {
        try {
          const parsed = JSON.parse(cached);
          validateChatIndex(parsed);
          const typedParsed = parsed as ChatIndex;
          const cachedThreads = await Promise.all(typedParsed.threads.map((summary) => repairCachedSummaryIfNeeded(owner, repo, branch, summary)));
          throw new ChatStorageError(
            classified.code,
            'Using cached thread list - data may be stale due to network issue',
            classified.status,
            'Using cached thread list - data may be stale due to network issue',
            cachedThreads
          );
        } catch (cacheError) {
          if (cacheError instanceof ChatStorageError) throw cacheError;
          await AsyncStorage.removeItem(cacheKey);
        }
      }
      return [];
    }
    throw classified;
  }
}

export async function loadThreadSummaries(owner: string, repo: string, branch: string = 'main'): Promise<ChatThreadSummary[]> {
  return enqueueRepoWrite(owner, repo, branch, () => loadThreadSummariesInternal(owner, repo, branch));
}

export async function loadThread(
  owner: string,
  repo: string,
  threadId: string,
  branch: string = 'main',
  options: LoadThreadOptions = {},
): Promise<ChatThread | null> {
  const cacheKey = getThreadCacheKey(owner, repo, branch, threadId);
  const path = `${CHAT_DIR}/${threadId}.json`;
  const persistRepair = options.persistRepair ?? true;

  try {
    const file = await getFile(owner, repo, path, branch);
    if (!file?.content) {
      return null;
    }

    const thread = JSON.parse(fromBase64(file.content)) as ChatThread;
    const normalizedThread = normalizeLoadedThread(thread);
    await AsyncStorage.setItem(cacheKey, JSON.stringify(normalizedThread));
    if (persistRepair && normalizedThread.title !== thread.title) {
      await persistThreadRepair(normalizedThread, file.sha);
    }
    return normalizedThread;
  } catch (error) {
    if (getStatus(error) === 404) {
      await AsyncStorage.removeItem(cacheKey);
      return null;
    }

    const cached = await AsyncStorage.getItem(cacheKey);
    if (cached) {
      try {
        const cachedThread = JSON.parse(cached) as ChatThread;
        const normalizedThread = normalizeLoadedThread(cachedThread);
        if (normalizedThread.title !== cachedThread.title) {
          await AsyncStorage.setItem(cacheKey, JSON.stringify(normalizedThread));
        }
        return normalizedThread;
      } catch (error) {
        console.warn('[ChatStorageService] Failed to repair summary:', error);
        await AsyncStorage.removeItem(cacheKey);
      }
    }

    throw error;
  }
}

async function saveThreadNow(thread: ChatThread): Promise<void> {
  const owner = thread.repoOwner;
  const repo = thread.repoName;
  const branch = thread.branch || 'main';
  const path = `${CHAT_DIR}/${thread.id}.json`;

  const existingThread = await getFile(owner, repo, path, branch);
  await putFile({
    owner,
    repo,
    path,
    branch,
    message: existingThread?.sha ? `Update chat thread: ${thread.title}` : `Create chat thread: ${thread.title}`,
    content: JSON.stringify(thread, null, 2),
    sha: existingThread?.sha,
  });

  const summaries = await loadThreadSummariesInternal(owner, repo, branch);
  const nextSummaries = sortThreads([
    ...summaries.filter((summary) => summary.id !== thread.id),
    buildThreadSummary(thread),
  ]);

  await writeIndex(owner, repo, branch, nextSummaries);
  await AsyncStorage.setItem(getThreadCacheKey(owner, repo, branch, thread.id), JSON.stringify(thread));
}

export async function saveThread(thread: ChatThread): Promise<void> {
  await enqueueRepoWrite(thread.repoOwner, thread.repoName, thread.branch || 'main', () => saveThreadNow(thread));
}

export async function deleteThread(
  owner: string,
  repo: string,
  threadId: string,
  branch: string = 'main',
): Promise<boolean> {
  return enqueueRepoWrite(owner, repo, branch, async () => {
    const path = `${CHAT_DIR}/${threadId}.json`;
    const existingThread = await getFile(owner, repo, path, branch);

    if (!existingThread?.sha) {
      const summaries = await loadThreadSummariesInternal(owner, repo, branch);
      const nextSummaries = summaries.filter((summary) => summary.id !== threadId);
      await writeIndex(owner, repo, branch, nextSummaries);
      await AsyncStorage.removeItem(getThreadCacheKey(owner, repo, branch, threadId));
      return false;
    }

    await deleteFile({
      owner,
      repo,
      path,
      branch,
      message: `Delete chat thread: ${threadId}`,
      sha: existingThread.sha,
    });

    const latestSummaries = await loadThreadSummariesInternal(owner, repo, branch);
    const nextSummaries = latestSummaries.filter((summary) => summary.id !== threadId);
    await writeIndex(owner, repo, branch, nextSummaries);
    await AsyncStorage.removeItem(getThreadCacheKey(owner, repo, branch, threadId));
    return true;
  });
}

export async function isChatStorageInitialized(
  owner: string,
  repo: string,
  branch: string = 'main',
): Promise<boolean> {
  try {
    const file = await getFile(owner, repo, INDEX_PATH, branch);
    return !!file;
  } catch (error) {
    if (getStatus(error) === 404) {
      return false;
    }
    throw error;
  }
}
