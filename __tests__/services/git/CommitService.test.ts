import { describe, expect, it, jest } from '@jest/globals';
import type { GitHostFullService, GitHostUser } from '../../../src/services/git/GitHost';

jest.mock('../../../src/services/git/activeHost', () => ({
  getActiveGitHost: jest.fn(),
}));

jest.mock('../../../src/services/AccountStorage', () => ({
  AccountStorage: {
    getRememberedCommitAuthor: jest.fn(),
    setRememberedCommitAuthor: jest.fn(),
  },
}));

import { getActiveGitHost } from '../../../src/services/git/activeHost';
import { AccountStorage } from '../../../src/services/AccountStorage';
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
});
