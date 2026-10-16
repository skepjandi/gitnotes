import React from 'react';
import { render, fireEvent, waitFor } from '@testing-library/react-native';
import { Alert } from 'react-native';

import type { CommitInfo } from '@/services/git/engine/GitEngine';

const PAGE_SIZE = 20;

const makeCommit = (index: number): CommitInfo => ({
  id: `commit-${index}`,
  message: `Commit ${index}`,
  author: { name: 'Test Author', email: 'test@example.com' },
  timestamp: index,
  shortId: `commit-${index}`,
  summary: `Commit ${index}`,
  authorName: 'Test Author',
  authorEmail: 'test@example.com',
  authorTime: index,
  parentCount: 1,
});

const initialPage = Array.from({ length: PAGE_SIZE }, (_, index) => makeCommit(index));
const repeatedPage = Array.from({ length: PAGE_SIZE }, (_, index) => makeCommit(PAGE_SIZE + index));

jest.mock('expo-file-system', () => ({}));

jest.mock('@/components/ui/flat-list', () => {
  const React = require('react');
  const { Pressable, View } = require('react-native');

  type MockFlatListProps = {
    data: CommitInfo[];
    onEndReached?: () => void;
    ListHeaderComponent?: React.ReactNode;
  };

  return {
    FlatList: ({ data, onEndReached, ListHeaderComponent }: MockFlatListProps) => (
      <View>
        {ListHeaderComponent}
        <Pressable testID="trigger-load-more" onPress={() => {
          onEndReached?.();
          onEndReached?.();
        }} />
        {data.map((item, index) => (
          <View key={`${item.id}-${index}`} testID={`commit-row-${item.id}`} />
        ))}
      </View>
    ),
  };
});

jest.mock('@/services/git/engine/GitEngine', () => ({
  log: jest.fn(),
  pushWithIntegrate: jest.fn(),
}));

jest.mock('@/services/git/GitFsService', () => ({
  GitFsService: { isCloned: jest.fn() },
}));

jest.mock('@react-navigation/native', () => {
  const React = require('react');
  return {
    useNavigation: () => ({ navigate: jest.fn() }),
    useFocusEffect: jest.fn((callback: () => void) => React.useEffect(callback, [callback])),
  };
});

jest.mock('@/contexts/ThemeContext', () => ({
  useTokens: () => ({
    colors: {
      background: '#ffffff', card: '#f0f0f0', border: '#cccccc',
      text: '#000000', textSecondary: '#666666', accent: '#007AFF',
      success: '#34C759', error: '#FF3B30', warning: '#FF9500',
      elevated: '#e5e5ea',
    },
  }),
}));

jest.mock('@/components/ui/toast', () => ({
  Toast: ({ children }: { children: React.ReactNode }) => <>{children}</>,
  ToastDescription: ({ children }: { children: React.ReactNode }) => <>{children}</>,
  ToastTitle: ({ children }: { children: React.ReactNode }) => <>{children}</>,
  useToast: jest.fn(),
}));

jest.mock('@/components/ui/Button', () => ({
  Button: ({
    children,
    label,
    onPress,
    testID,
  }: {
    children?: React.ReactNode;
    label?: string;
    onPress?: () => void;
    testID?: string;
  }) => {
    const { Pressable } = require('react-native');
    return (
      <Pressable testID={testID} onPress={onPress}>
      {label ?? children}
      </Pressable>
    );
  },
  ButtonText: ({ children }: { children: React.ReactNode }) => <>{children}</>,
}));

import { CommitsSection } from '@/components/explore/CommitsSection';
import * as GitEngine from '@/services/git/engine/GitEngine';
import { GitFsService } from '@/services/git/GitFsService';
import { useToast } from '@/components/ui/toast';

const mockRepo = {
  id: 'test-repo-id',
  path: 'owner/test-repo',
  name: 'test-repo',
  localPath: '/mock/repos/test-repo',
  branch: 'main',
};

const forgejoRepo = { ...mockRepo, provider: 'forgejo' };

describe('CommitsSection pagination', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    (GitFsService.isCloned as jest.Mock).mockResolvedValue(true);
    (GitEngine.log as jest.Mock)
      .mockResolvedValueOnce(initialPage)
      .mockResolvedValue(repeatedPage);
  });

  it('does not render duplicate commits when pagination fires twice rapidly', async () => {
    const { getByTestId, getAllByTestId } = render(
      <CommitsSection repo={mockRepo} active={true} onChanged={jest.fn()} status={null} />,
    );

    await waitFor(() => expect(getAllByTestId(/^commit-row-/)).toHaveLength(PAGE_SIZE));

    fireEvent.press(getByTestId('trigger-load-more'));

    await waitFor(() => expect(GitEngine.log).toHaveBeenCalledTimes(2));
    expect(getAllByTestId(/^commit-row-/)).toHaveLength(PAGE_SIZE * 2);
    expect(GitEngine.log).toHaveBeenLastCalledWith(mockRepo.localPath, PAGE_SIZE, PAGE_SIZE);
  });

  it('does not paginate while the initial commit page is loading', async () => {
    let resolveInitial: ((commits: CommitInfo[]) => void) | undefined;
    (GitEngine.log as jest.Mock).mockReset();
    (GitEngine.log as jest.Mock).mockImplementationOnce(
      () => new Promise<CommitInfo[]>((resolve) => {
        resolveInitial = resolve;
      }),
    );

    const { getByTestId, getAllByTestId } = render(
      <CommitsSection repo={mockRepo} active={true} onChanged={jest.fn()} status={null} />,
    );

    await waitFor(() => expect(GitEngine.log).toHaveBeenCalledTimes(1));
    fireEvent.press(getByTestId('trigger-load-more'));
    expect(GitEngine.log).toHaveBeenCalledTimes(1);

    resolveInitial?.(initialPage);
    await waitFor(() => expect(getAllByTestId(/^commit-row-/)).toHaveLength(PAGE_SIZE));
  });
});

describe('CommitsSection push', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    (GitFsService.isCloned as jest.Mock).mockResolvedValue(true);
    (GitEngine.log as jest.Mock).mockResolvedValue([]);
  });

  it('shows a readable error when native push returns an empty failure message', async () => {
    const show = jest.fn();
    (useToast as jest.Mock).mockReturnValue({ show });
    (GitEngine.pushWithIntegrate as jest.Mock).mockResolvedValue({
      ok: false,
      kind: 'Error',
      message: '',
      conflicts: [],
      pushed: 0,
    });

    const { getByTestId } = render(
      <CommitsSection repo={mockRepo} active={true} onChanged={jest.fn()} status={null} />,
    );

    await waitFor(() => expect(getByTestId('explore.commits.push')).toBeTruthy());
    fireEvent.press(getByTestId('explore.commits.push'));

    await waitFor(() => expect(show).toHaveBeenCalled());
    const renderToast = show.mock.calls[0][0].render;
    const toast = renderToast({ id: 'push-failure' });
    expect(toast.props.action).toBe('error');
    expect(toast.props.children[1].props.children).toBe('Push failed — check credentials');
  });

  it('shows an actionable alert when native push rejects', async () => {
    const show = jest.fn();
    const alert = jest.spyOn(Alert, 'alert').mockImplementation(() => undefined);
    (useToast as jest.Mock).mockReturnValue({ show });
    (GitEngine.pushWithIntegrate as jest.Mock).mockRejectedValue(new Error('No credentials found for repo test-repo-id'));

    const { getByTestId } = render(
      <CommitsSection repo={mockRepo} active={true} onChanged={jest.fn()} status={null} />,
    );

    await waitFor(() => expect(getByTestId('explore.commits.push')).toBeTruthy());
    fireEvent.press(getByTestId('explore.commits.push'));

    await waitFor(() => expect(alert).toHaveBeenCalledWith('Push failed', 'No credentials found for repo test-repo-id'));
    expect(GitEngine.pushWithIntegrate).toHaveBeenCalledWith(mockRepo.localPath, 'origin', mockRepo.id);
    alert.mockRestore();
  });

  it('explains how to fix Forgejo permission failures returned by native push', async () => {
    const show = jest.fn();
    (useToast as jest.Mock).mockReturnValue({ show });
    (GitEngine.pushWithIntegrate as jest.Mock).mockResolvedValue({
      ok: false,
      kind: 'Error',
      message: 'remote rejected: HTTP 403 Forbidden',
      conflicts: [],
      pushed: 0,
    });

    const { getByTestId } = render(
      <CommitsSection repo={forgejoRepo} active={true} onChanged={jest.fn()} status={null} />,
    );

    await waitFor(() => expect(getByTestId('explore.commits.push')).toBeTruthy());
    fireEvent.press(getByTestId('explore.commits.push'));

    await waitFor(() => expect(show).toHaveBeenCalled());
    const renderToast = show.mock.calls[0][0].render;
    const toast = renderToast({ id: 'forgejo-permission-failure' });
    expect(toast.props.children[1].props.children).toBe(
      'Grant the Forgejo account/token write permission for owner/test-repo.',
    );
  });

  it('explains how to fix Forgejo permission failures thrown by native push', async () => {
    const show = jest.fn();
    const alert = jest.spyOn(Alert, 'alert').mockImplementation(() => undefined);
    (useToast as jest.Mock).mockReturnValue({ show });
    (GitEngine.pushWithIntegrate as jest.Mock).mockRejectedValue(new Error('HTTP 403 Forbidden'));

    const { getByTestId } = render(
      <CommitsSection repo={forgejoRepo} active={true} onChanged={jest.fn()} status={null} />,
    );

    await waitFor(() => expect(getByTestId('explore.commits.push')).toBeTruthy());
    fireEvent.press(getByTestId('explore.commits.push'));

    await waitFor(() => expect(alert).toHaveBeenCalledWith(
      'Push failed',
      'Grant the Forgejo account/token write permission for owner/test-repo.',
    ));
    alert.mockRestore();
  });
});
