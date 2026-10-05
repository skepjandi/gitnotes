import { describe, expect, it, jest } from '@jest/globals';
import type { GitHostFullService, GitHostUser } from '../../../src/services/git/GitHost';

jest.mock('../../../src/services/git/activeHost', () => ({
  getActiveGitHost: jest.fn(),
  resolveHostService: jest.fn(),
  GIT_HOST_API_BASES: { github: 'https://api.github.com', gitlab: 'https://gitlab.com', gitea: 'https://gitea.com', forgejo: 'https://forgejo.com' },
}));

jest.mock('../../../src/services/AccountStorage', () => ({
  AccountStorage: {
    getRememberedCommitAuthor: jest.fn(),
    setRememberedCommitAuthor: jest.fn(),
    getRememberedCommitAuthorForRepo: jest.fn(),
    setRememberedCommitAuthorForRepo: jest.fn(),
    getHostConnection: jest.fn(),
    getHostToken: jest.fn(),
  },
}));

jest.mock('../../../src/services/StorageService', () => ({
  StorageService: {
    getSavedRepositories: jest.fn(),
  },
}));

import { getActiveGitHost, resolveHostService } from '../../../src/services/git/activeHost';
import { AccountStorage } from '../../../src/services/AccountStorage';
import { StorageService } from '../../../src/services/StorageService';
import { resolveStageAuthor, CommitService } from '../../../src/services/git/CommitService';

describe('resolveStageAuthor', () => {
  it('returns empty email when no active host', async () => {
    jest.mocked(getActiveGitHost).mockResolvedValue(null);

    await expect(resolveStageAuthor()).resolves.toEqual({
      name: 'gitnotes',
      email: '',
    });
  });

  it('returns remembered email when available for host', async () => {
    const mockHost = {
      provider: 'github' as const,
      baseUrl: 'https://api.github.com',
      token: 'tok',
      hostId: 'acc-1:github:default',
      instanceBaseUrl: null,
      host: {} as GitHostFullService,
    };
    jest.mocked(getActiveGitHost).mockResolvedValue(mockHost);
    jest.mocked(AccountStorage.getRememberedCommitAuthor).mockResolvedValue({
      email: 'remembered@example.com',
      name: 'Remembered Name',
    });

    await expect(resolveStageAuthor()).resolves.toEqual({
      name: 'Remembered Name',
      email: 'remembered@example.com',
    });
    expect(AccountStorage.getRememberedCommitAuthor).toHaveBeenCalledWith('acc-1:github:default');
  });

  it('returns API email when no remembered email', async () => {
    const getAuthenticatedUser = jest.fn<GitHostFullService['getAuthenticatedUser']>();
    getAuthenticatedUser.mockResolvedValue({
      id: 1,
      login: 'octocat',
      name: 'The Octocat',
      email: 'octocat@example.com',
      avatarUrl: null,
    } satisfies GitHostUser);

    const mockHost = {
      provider: 'github' as const,
      baseUrl: 'https://api.github.com',
      token: 'tok',
      hostId: 'acc-1:github:default',
      instanceBaseUrl: null,
      host: { getAuthenticatedUser } as unknown as GitHostFullService,
    };
    jest.mocked(getActiveGitHost).mockResolvedValue(mockHost);
    jest.mocked(AccountStorage.getRememberedCommitAuthor).mockResolvedValue(null);

    await expect(resolveStageAuthor()).resolves.toEqual({
      name: 'The Octocat',
      email: 'octocat@example.com',
    });
  });

  it('uses the GitHub noreply address when API returns empty and no remembered email', async () => {
    const getAuthenticatedUser = jest.fn<GitHostFullService['getAuthenticatedUser']>();
    getAuthenticatedUser.mockResolvedValue({
      id: 1,
      login: 'octocat',
      name: 'The Octocat',
      email: '',
      avatarUrl: null,
    } satisfies GitHostUser);

    const mockHost = {
      provider: 'github' as const,
      baseUrl: 'https://api.github.com',
      token: 'tok',
      hostId: 'acc-1:github:default',
      instanceBaseUrl: null,
      host: { getAuthenticatedUser } as unknown as GitHostFullService,
    };
    jest.mocked(getActiveGitHost).mockResolvedValue(mockHost);
    jest.mocked(AccountStorage.getRememberedCommitAuthor).mockResolvedValue(null);

    await expect(resolveStageAuthor()).resolves.toEqual({
      name: 'The Octocat',
      email: '1+octocat@users.noreply.github.com',
    });
  });

  it('falls back to login when name is empty', async () => {
    const getAuthenticatedUser = jest.fn<GitHostFullService['getAuthenticatedUser']>();
    getAuthenticatedUser.mockResolvedValue({
      id: 1,
      login: 'octocat',
      name: '',
      email: 'octocat@example.com',
      avatarUrl: null,
    } satisfies GitHostUser);

    const mockHost = {
      provider: 'github' as const,
      baseUrl: 'https://api.github.com',
      token: 'tok',
      hostId: 'acc-1:github:default',
      instanceBaseUrl: null,
      host: { getAuthenticatedUser } as unknown as GitHostFullService,
    };
    jest.mocked(getActiveGitHost).mockResolvedValue(mockHost);
    jest.mocked(AccountStorage.getRememberedCommitAuthor).mockResolvedValue(null);

    await expect(resolveStageAuthor()).resolves.toEqual({
      name: 'octocat',
      email: 'octocat@example.com',
    });
  });
});

describe('CommitService.resolveAuthor', () => {
  it('delegates to resolveStageAuthor', async () => {
    jest.mocked(getActiveGitHost).mockResolvedValue(null);

    const result = await CommitService.resolveAuthor();
    expect(result).toEqual({ name: 'gitnotes', email: '' });
  });

  it('passes repoId through to resolveStageAuthor', async () => {
    jest.mocked(getActiveGitHost).mockResolvedValue(null);
    jest.mocked(AccountStorage.getRememberedCommitAuthorForRepo).mockResolvedValue(null);
    jest.mocked(StorageService.getSavedRepositories).mockResolvedValue([]);

    const result = await CommitService.resolveAuthor('repo-123');
    expect(result).toEqual({ name: 'gitnotes', email: '' });
  });
});

describe('resolveStageAuthor with repoId', () => {
  it('returns repo-scoped remembered author when available', async () => {
    jest.mocked(AccountStorage.getRememberedCommitAuthorForRepo).mockResolvedValue({
      email: 'repo-remembered@example.com',
      name: 'Repo Remembered Name',
    });

    const result = await resolveStageAuthor('repo-123');
    expect(result).toEqual({
      name: 'Repo Remembered Name',
      email: 'repo-remembered@example.com',
    });
    expect(AccountStorage.getRememberedCommitAuthorForRepo).toHaveBeenCalledWith('repo-123');
  });

  it('falls back to host-scoped remembered author when repo-scoped is not set', async () => {
    const mockHost = {
      provider: 'github' as const,
      baseUrl: 'https://api.github.com',
      token: 'tok',
      hostId: 'acc-1:github:default',
      instanceBaseUrl: null,
      host: {} as GitHostFullService,
    };
    jest.mocked(getActiveGitHost).mockResolvedValue(mockHost);
    jest.mocked(AccountStorage.getRememberedCommitAuthorForRepo).mockResolvedValue(null);
    jest.mocked(AccountStorage.getRememberedCommitAuthor).mockResolvedValue({
      email: 'host-remembered@example.com',
      name: 'Host Remembered Name',
    });
    jest.mocked(StorageService.getSavedRepositories).mockResolvedValue([
      { id: 'repo-123', path: 'owner/repo', name: 'repo', hostId: 'acc-1:github:default' },
    ]);

    const result = await resolveStageAuthor('repo-123');
    expect(result).toEqual({
      name: 'Host Remembered Name',
      email: 'host-remembered@example.com',
    });
  });

  it('uses repo hostId for API identity when no remembered author', async () => {
    const getAuthenticatedUser = jest.fn<GitHostFullService['getAuthenticatedUser']>();
    getAuthenticatedUser.mockResolvedValue({
      id: 1,
      login: 'octocat',
      name: 'The Octocat',
      email: 'api@example.com',
      avatarUrl: null,
    } satisfies GitHostUser);

    const mockHost = {
      provider: 'github' as const,
      baseUrl: 'https://api.github.com',
      token: 'tok',
      hostId: 'acc-1:github:default',
      instanceBaseUrl: null,
      host: { getAuthenticatedUser } as unknown as GitHostFullService,
    };
    jest.mocked(getActiveGitHost).mockResolvedValue(mockHost);
    jest.mocked(AccountStorage.getRememberedCommitAuthorForRepo).mockResolvedValue(null);
    jest.mocked(AccountStorage.getRememberedCommitAuthor).mockResolvedValue(null);
    jest.mocked(AccountStorage.getHostConnection).mockResolvedValue({
      id: 'acc-1:github:default',
      accountId: 'acc-1',
      provider: 'github',
      instanceBaseUrl: null,
      hostLogin: 'octocat',
      hostUserId: 1,
      name: 'The Octocat',
      email: 'api@example.com',
      avatarUrl: null,
      addedAt: Date.now(),
    });
    jest.mocked(AccountStorage.getHostToken).mockResolvedValue('tok');
    jest.mocked(resolveHostService).mockReturnValue({ getAuthenticatedUser } as unknown as GitHostFullService);
    jest.mocked(StorageService.getSavedRepositories).mockResolvedValue([
      { id: 'repo-123', path: 'owner/repo', name: 'repo', hostId: 'acc-1:github:default' },
    ]);

    const result = await resolveStageAuthor('repo-123');
    expect(result).toEqual({
      name: 'The Octocat',
      email: 'api@example.com',
    });
  });

  it('returns empty email when repo has no hostId and no active host', async () => {
    jest.mocked(getActiveGitHost).mockResolvedValue(null);
    jest.mocked(AccountStorage.getRememberedCommitAuthorForRepo).mockResolvedValue(null);
    jest.mocked(StorageService.getSavedRepositories).mockResolvedValue([
      { id: 'repo-123', path: 'owner/repo', name: 'repo' },
    ]);

    const result = await resolveStageAuthor('repo-123');
    expect(result).toEqual({ name: 'gitnotes', email: '' });
  });

  it('generates GitHub noreply email when repo host API returns empty email', async () => {
    const getAuthenticatedUser = jest.fn<GitHostFullService['getAuthenticatedUser']>();
    getAuthenticatedUser.mockResolvedValue({
      id: 42,
      login: 'testuser',
      name: 'Test User',
      email: '',
      avatarUrl: null,
    } satisfies GitHostUser);

    const mockHost = {
      provider: 'github' as const,
      baseUrl: 'https://api.github.com',
      token: 'tok',
      hostId: 'acc-1:github:default',
      instanceBaseUrl: null,
      host: { getAuthenticatedUser } as unknown as GitHostFullService,
    };
    jest.mocked(getActiveGitHost).mockResolvedValue(mockHost);
    jest.mocked(AccountStorage.getRememberedCommitAuthorForRepo).mockResolvedValue(null);
    jest.mocked(AccountStorage.getRememberedCommitAuthor).mockResolvedValue(null);
    jest.mocked(AccountStorage.getHostConnection).mockResolvedValue({
      id: 'acc-1:github:default',
      accountId: 'acc-1',
      provider: 'github',
      instanceBaseUrl: null,
      hostLogin: 'testuser',
      hostUserId: 42,
      name: 'Test User',
      email: '',
      avatarUrl: null,
      addedAt: Date.now(),
    });
    jest.mocked(AccountStorage.getHostToken).mockResolvedValue('tok');
    jest.mocked(resolveHostService).mockReturnValue({ getAuthenticatedUser } as unknown as GitHostFullService);
    jest.mocked(StorageService.getSavedRepositories).mockResolvedValue([
      { id: 'repo-123', path: 'owner/repo', name: 'repo', hostId: 'acc-1:github:default' },
    ]);

    const result = await resolveStageAuthor('repo-123');
    expect(result).toEqual({
      name: 'Test User',
      email: '42+testuser@users.noreply.github.com',
    });
  });
});
