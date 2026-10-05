import React from 'react';
import { render, waitFor, fireEvent, act, cleanup } from '@testing-library/react-native';
import { afterEach, beforeEach, describe, expect, it, jest } from '@jest/globals';

afterEach(() => {
  cleanup();
});

jest.mock('@/contexts/AccountsContext', () => ({
  useAccounts: () => ({
    accounts: [],
    activeAccountId: null,
    authState: {
      user: { login: 'github-user', name: 'GitHub User', email: '' },
    },
  }),
}));

jest.mock('@/contexts/ThemeContext', () => ({
  useTokens: () => ({
    colors: {
      accent: '#ff0000',
      background: '#ffffff',
      border: '#dddddd',
      card: '#ffffff',
      error: '#ff0000',
      text: '#000000',
    },
  }),
}));

jest.mock('react-i18next', () => ({
  useTranslation: () => ({ t: (key: string) => key }),
}));

jest.mock('@/services/git/engine/GitEngine', () => ({
  stage: jest.fn(),
  commit: jest.fn(),
}));

jest.mock('@/services/git/CommitService', () => ({
  CommitService: {
    resolveAuthor: jest.fn(),
  },
}));

jest.mock('@/services/AccountStorage', () => ({
  AccountStorage: {
    getRememberedCommitAuthor: jest.fn(),
    setRememberedCommitAuthor: jest.fn(),
    getRememberedCommitAuthorForRepo: jest.fn(),
    setRememberedCommitAuthorForRepo: jest.fn(),
  },
}));

jest.mock('@/services/git/activeHost', () => ({
  getActiveGitHost: jest.fn(),
}));

jest.mock('@/components/ui/text', () => ({
  Text: ({ children, ...props }: { children?: React.ReactNode; [key: string]: unknown }) => <span {...props}>{children}</span>,
}));

jest.mock('@/components/ui/heading', () => ({
  Heading: ({ children }: { children?: React.ReactNode }) => <span>{children}</span>,
}));

jest.mock('@/components/ui/Button', () => ({
  Button: ({ label, children, ...props }: { label?: string; children?: React.ReactNode; [key: string]: unknown }) => (
    <button {...props}>{label ?? children}</button>
  ),
}));

jest.mock('@/components/ui/Input', () => ({
  InputField: (props: Record<string, unknown>) => <input {...props} />,
}));

jest.mock('@/components/ui/textarea', () => ({
  TextareaInput: (props: Record<string, unknown>) => <textarea {...props} />,
}));

jest.mock('@expo/vector-icons', () => ({ Ionicons: () => null }));

jest.mock('@/components/explore/commitMessageDraft', () => ({
  buildCommitMessageDraft: () => '',
}));

import { CommitComposer } from '../../../src/components/explore/CommitComposer';
import { CommitService } from '../../../src/services/git/CommitService';
import { AccountStorage } from '../../../src/services/AccountStorage';
import { getActiveGitHost } from '../../../src/services/git/activeHost';
import * as GitEngine from '../../../src/services/git/engine/GitEngine';

describe('CommitComposer author identity', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    jest.mocked(getActiveGitHost).mockResolvedValue({
      provider: 'github' as const,
      baseUrl: 'https://api.github.com',
      token: 'tok',
      hostId: 'acc-1:github:default',
      instanceBaseUrl: null,
      host: {} as never,
    });
    jest.mocked(AccountStorage.getRememberedCommitAuthorForRepo).mockResolvedValue(null);
    jest.mocked(AccountStorage.getRememberedCommitAuthor).mockResolvedValue(null);
    jest.mocked(CommitService.resolveAuthor).mockResolvedValue({
      name: 'API Name',
      email: 'api@example.com',
    });
  });

  it('loads API email when no remembered email', async () => {
    const { getByTestId } = render(
      <CommitComposer
        repo={{ id: 'repo-1', localPath: '/repo', path: 'owner/repo', name: 'repo', branch: 'main' }}
        changedPaths={[]}
        statuses={[]}
        stagedCount={1}
        onCommitted={jest.fn()}
      />,
    );

    await waitFor(() => {
      expect(getByTestId('explore.commit-composer.author-email').props.value).toBe('api@example.com');
    });
  });

  it('loads remembered email when available', async () => {
    jest.mocked(AccountStorage.getRememberedCommitAuthorForRepo).mockResolvedValue({
      email: 'remembered@example.com',
      name: 'Remembered Name',
    });

    const { getByTestId } = render(
      <CommitComposer
        repo={{ id: 'repo-1', localPath: '/repo', path: 'owner/repo', name: 'repo', branch: 'main' }}
        changedPaths={[]}
        statuses={[]}
        stagedCount={1}
        onCommitted={jest.fn()}
      />,
    );

    await waitFor(() => {
      expect(getByTestId('explore.commit-composer.author-email').props.value).toBe('remembered@example.com');
    });
    expect(getByTestId('explore.commit-composer.author-name').props.value).toBe('Remembered Name');
  });

  it('does not overwrite manually edited email with async resolution', async () => {
    jest.mocked(CommitService.resolveAuthor).mockImplementation(
      () => new Promise((resolve) => setImmediate(() => resolve({ name: 'API Name', email: 'api@example.com' })))
    );

    const { getByTestId } = render(
      <CommitComposer
        repo={{ id: 'repo-1', localPath: '/repo', path: 'owner/repo', name: 'repo', branch: 'main' }}
        changedPaths={[]}
        statuses={[]}
        stagedCount={1}
        onCommitted={jest.fn()}
      />,
    );

    const emailInput = getByTestId('explore.commit-composer.author-email');
    await act(async () => {
      fireEvent.changeText(emailInput, 'user@manual.com');
    });

    await waitFor(() => {
      expect(getByTestId('explore.commit-composer.author-email').props.value).toBe('user@manual.com');
    });
  });

  it('returns empty email when API returns empty and no remembered email', async () => {
    jest.mocked(CommitService.resolveAuthor).mockResolvedValue({
      name: 'API Name',
      email: '',
    });

    const { getByTestId } = render(
      <CommitComposer
        repo={{ id: 'repo-1', localPath: '/repo', path: 'owner/repo', name: 'repo', branch: 'main' }}
        changedPaths={[]}
        statuses={[]}
        stagedCount={1}
        onCommitted={jest.fn()}
      />,
    );

    await waitFor(() => {
      expect(getByTestId('explore.commit-composer.author-email').props.value).toBe('');
    });
  });

  it('successfully commits with manual email when name is empty from API', async () => {
    jest.mocked(CommitService.resolveAuthor).mockResolvedValue({
      name: '',
      email: '',
    });
    jest.mocked(GitEngine.commit).mockResolvedValue({
      id: 'abc123',
      shortId: 'abc123',
      message: 'Test commit message',
      author: { name: 'Manual Name', email: 'manual@example.com' },
      timestamp: 0,
      summary: 'test',
      authorName: 'Manual Name',
      authorEmail: 'manual@example.com',
      authorTime: 0,
      parentCount: 0,
    });
    jest.mocked(GitEngine.stage).mockResolvedValue(undefined);

    const onCommitted = jest.fn();
    const { getByTestId } = render(
      <CommitComposer
        repo={{ id: 'repo-1', localPath: '/repo', path: 'owner/repo', name: 'repo', branch: 'main' }}
        changedPaths={['file.md']}
        statuses={[]}
        stagedCount={0}
        onCommitted={onCommitted}
      />,
    );

    const nameInput = getByTestId('explore.commit-composer.author-name');
    const emailInput = getByTestId('explore.commit-composer.author-email');
    const messageInput = getByTestId('explore.commit-composer.message.input');

    await act(async () => {
      fireEvent.changeText(messageInput, 'Test commit message');
    });
    await act(async () => {
      fireEvent.changeText(nameInput, 'Manual Name');
    });
    await act(async () => {
      fireEvent.changeText(emailInput, 'manual@example.com');
    });

    const commitButton = getByTestId('explore.commit-composer.stage-all-commit');
    await act(async () => {
      fireEvent.press(commitButton);
    });

    expect(GitEngine.commit).toHaveBeenCalledWith(
      '/repo',
      expect.any(String),
      { name: 'Manual Name', email: 'manual@example.com' },
    );
    expect(onCommitted).toHaveBeenCalled();
  });
});
