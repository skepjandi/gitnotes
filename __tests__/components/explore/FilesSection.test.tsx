import React from 'react';
import { act, render, fireEvent, waitFor } from '@testing-library/react-native';
import { Text } from 'react-native';

const TEST_FILES = [
  'readme.md',
  'test.txt',
  'index.ts',
  'util.ts',
  'guide.txt',
  'screenshot.jpg',
  'logo.png',
  'archive.tar.gz',
  'icon.woff2',
  'Makefile',
  'package.json',
  'test.norg',
  'tasks.org',
  'document.pdf',
];

jest.mock('@/components/explore/exploreShared', () => {
  const actual = jest.requireActual('@/components/explore/exploreShared');
  return {
    ...actual,
    walkWorkingTree: jest.fn(() => ({ files: TEST_FILES, truncated: false })),
  };
});

jest.mock('@/components/ui/flat-list', () => {
  const React = require('react');
  const { View } = require('react-native');
  return {
    FlatList: React.forwardRef(function MockFlatList({
      data,
      renderItem,
      ListHeaderComponent,
      ListEmptyComponent,
      testID,
      ...props
    }: {
      data?: unknown[];
      renderItem?: (args: { item: unknown; index: number }) => React.ReactElement | null;
      ListHeaderComponent?: React.ReactElement | null;
      ListEmptyComponent?: React.ReactElement | null;
      testID?: string;
      [key: string]: unknown;
    }, _ref: React.Ref<unknown>) {
      const items = data ?? [];
      return React.createElement(View, { testID, ...props },
        ListHeaderComponent,
        items.length === 0 && ListEmptyComponent,
        items.map((item, index) =>
          renderItem ? React.createElement(React.Fragment, { key: index }, renderItem({ item, index })) : null
        )
      );
    }),
  };
});

jest.mock('@/services/git/engine/GitEngine', () => {
  const actual = jest.requireActual('@/services/git/engine/GitEngine');
  return { ...actual, statuses: jest.fn(), stage: jest.fn() };
});

jest.mock('@/services/git/GitFsService', () => ({
  GitFsService: { isCloned: jest.fn() },
}));

jest.mock('@/services/GitHubService', () => {
  return {
    GitHubService: {
      getTreeRecursiveOrThrow: jest.fn(() => Promise.resolve([])),
    },
  };
});

const mockNavigate = jest.fn();
jest.mock('@react-navigation/native', () => ({
  useNavigation: () => ({ navigate: mockNavigate }),
  useFocusEffect: jest.fn((cb: () => void) => cb()),
}));

let mockColors = {
  background: '#ffffff', card: '#f0f0f0', border: '#cccccc',
  text: '#000000', textSecondary: '#666666', accent: '#007AFF',
  success: '#34C759', error: '#FF3B30', warning: '#FF9500',
  surface: '#e5e5ea', surfaceSecondary: '#e5e5ea',
};

jest.mock('@/contexts/ThemeContext', () => ({
  useTheme: () => ({ colors: mockColors }),
  useTokens: () => ({ colors: mockColors }),
}));

import { FilesSection } from '@/components/explore/FilesSection';
import * as GitEngine from '@/services/git/engine/GitEngine';
import { GitFsService } from '@/services/git/GitFsService';
import { GitHubService } from '@/services/GitHubService';
import { isBinaryPath } from '@/components/explore/exploreShared';

const mockRepo = {
  id: 'test-repo-id', path: 'owner/test-repo', name: 'test-repo',
  localPath: '/mock/repos/test-repo', branch: 'main',
};

class TestErrorBoundary extends React.Component<
  { children: React.ReactNode },
  { error: Error | null }
> {
  state = { error: null };

  static getDerivedStateFromError(error: Error) {
    return { error };
  }

  render() {
    if (this.state.error) return <Text>{this.state.error.message}</Text>;
    return this.props.children;
  }
}

describe('FilesSection row navigation', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockColors = {
      background: '#ffffff', card: '#f0f0f0', border: '#cccccc',
      text: '#000000', textSecondary: '#666666', accent: '#007AFF',
      success: '#34C759', error: '#FF3B30', warning: '#FF9500',
      surface: '#e5e5ea', surfaceSecondary: '#e5e5ea',
    };
    (GitFsService.isCloned as jest.Mock).mockResolvedValue(true);
    (GitEngine.statuses as jest.Mock).mockResolvedValue([]);
  });

  describe('non-binary file rows', () => {
    const cases = [
      { path: 'readme.md', desc: 'markdown' },
      { path: 'index.ts', desc: 'typescript' },
      { path: 'guide.txt', desc: 'text' },
      { path: 'Makefile', desc: 'extensionless' },
      { path: 'package.json', desc: 'json' },
      { path: 'test.norg', desc: 'neorg' },
      { path: 'tasks.org', desc: 'org' },
    ];

    it.each(cases)('navigates to ExploreFile for $desc ($path)', async ({ path }) => {
      expect(isBinaryPath(path)).toBe(false);
      const { getByTestId } = render(
        <FilesSection repo={mockRepo} active={true} onChanged={jest.fn()} status={null} />
      );
      await waitFor(() => expect(getByTestId(`explore.file.${path}`)).toBeTruthy());
      fireEvent.press(getByTestId(`explore.file.${path}`));
      expect(mockNavigate).toHaveBeenCalledTimes(1);
      expect(mockNavigate).toHaveBeenCalledWith('ExploreFile', { repoId: mockRepo.id, path });
    });
  });

  describe('binary file rows', () => {
    const cases = [
      { path: 'screenshot.jpg', desc: 'JPEG' },
      { path: 'logo.png', desc: 'PNG' },
      { path: 'archive.tar.gz', desc: 'archive' },
      { path: 'icon.woff2', desc: 'font' },
      { path: 'document.pdf', desc: 'PDF' },
    ];

    it.each(cases)('shows binary badge for $desc ($path)', async ({ path }) => {
      expect(isBinaryPath(path)).toBe(true);
      const { getByTestId, getAllByText } = render(
        <FilesSection repo={mockRepo} active={true} onChanged={jest.fn()} status={null} />
      );
      await waitFor(() => expect(getByTestId(`explore.file.${path}`)).toBeTruthy());
      const badges = getAllByText('binary');
      expect(badges.length).toBeGreaterThan(0);
    });

    it('PDF navigates to PdfViewer (not ExploreFile) on row tap', async () => {
      const { getByTestId } = render(
        <FilesSection repo={mockRepo} active={true} onChanged={jest.fn()} status={null} />
      );
      await waitFor(() => expect(getByTestId('explore.file.document.pdf')).toBeTruthy());
      fireEvent.press(getByTestId('explore.file.document.pdf'));
      expect(mockNavigate).toHaveBeenCalledTimes(1);
      expect(mockNavigate).toHaveBeenCalledWith('PdfViewer', {
        owner: 'owner',
        repo: 'test-repo',
        branch: 'main',
        path: 'document.pdf',
        title: 'document.pdf',
      });
    });

    it('non-PDF binary navigates to ExploreFile on row tap', async () => {
      const { getByTestId } = render(
        <FilesSection repo={mockRepo} active={true} onChanged={jest.fn()} status={null} />
      );
      await waitFor(() => expect(getByTestId('explore.file.screenshot.jpg')).toBeTruthy());
      fireEvent.press(getByTestId('explore.file.screenshot.jpg'));
      expect(mockNavigate).toHaveBeenCalledTimes(1);
      expect(mockNavigate).toHaveBeenCalledWith('ExploreFile', { repoId: mockRepo.id, path: 'screenshot.jpg' });
    });
  });

  describe('no mutation on row tap', () => {
    it('does not call GitHubService on file row tap', async () => {
      const { getByTestId } = render(
        <FilesSection repo={mockRepo} active={true} onChanged={jest.fn()} status={null} />
      );
      await waitFor(() => expect(getByTestId('explore.file.readme.md')).toBeTruthy());
      fireEvent.press(getByTestId('explore.file.readme.md'));
      expect(GitHubService.getTreeRecursiveOrThrow).not.toHaveBeenCalled();
    });

    it('does not call GitEngine.stage on file row tap', async () => {
      const { getByTestId } = render(
        <FilesSection repo={mockRepo} active={true} onChanged={jest.fn()} status={null} />
      );
      await waitFor(() => expect(getByTestId('explore.file.readme.md')).toBeTruthy());
      fireEvent.press(getByTestId('explore.file.readme.md'));
      expect(GitEngine.stage).not.toHaveBeenCalled();
    });
  });

  describe('directory rows', () => {
    it('toggling a directory does not navigate to ExploreFile', async () => {
      const { getByTestId } = render(
        <FilesSection repo={mockRepo} active={true} onChanged={jest.fn()} status={null} />
      );
      await waitFor(() => expect(getByTestId('explore.file.readme.md')).toBeTruthy());
      expect(mockNavigate).not.toHaveBeenCalled();
    });
  });

  it('does not change hook count when loading changes to the not-cloned state', async () => {
    (GitFsService.isCloned as jest.Mock).mockResolvedValueOnce(false);

    const { findByText } = render(
      <TestErrorBoundary>
        <FilesSection repo={mockRepo} active={true} onChanged={jest.fn()} status={null} />,
      </TestErrorBoundary>,
    );

    await findByText('Clone required');
  });

  it('keeps loading content below the Git header', async () => {
    let resolveClone: (cloned: boolean) => void = () => undefined;
    (GitFsService.isCloned as jest.Mock).mockReturnValueOnce(
      new Promise<boolean>((resolve) => {
        resolveClone = resolve;
      }),
    );

    const { getByTestId } = render(
      <FilesSection repo={mockRepo} active={true} onChanged={jest.fn()} chromeTopInset={128} status={null} />,
    );

    expect(getByTestId('explore.files.list').props.contentContainerStyle.paddingTop).toBe(128);
    await act(async () => {
      resolveClone(true);
    });
  });

  it('keeps the not-cloned message below the Git header', async () => {
    (GitFsService.isCloned as jest.Mock).mockResolvedValueOnce(false);

    const { findByText, findByTestId } = render(
      <FilesSection repo={mockRepo} active={true} onChanged={jest.fn()} chromeTopInset={128} status={null} />,
    );

    const message = await findByText('Clone required');
    expect(message).toBeTruthy();
    const state = await findByTestId('explore.files.not-cloned');
    expect(state.props.style.paddingTop).toBe(128);
  });

  it('updates file row colors when the theme palette changes', async () => {
    const { getByTestId, rerender } = render(
      <FilesSection repo={mockRepo} active={true} onChanged={jest.fn()} status={null} />,
    );

    await waitFor(() => expect(getByTestId('explore.file.readme.md')).toBeTruthy());
    expect(getByTestId('explore.file.readme.md').props.style.backgroundColor).toBe('#f0f0f0');

    mockColors = {
      ...mockColors,
      card: '#1c1c1e',
      border: '#3a3a3c',
      text: '#ffffff',
    };
    rerender(<FilesSection repo={mockRepo} active={true} onChanged={jest.fn()} status={null} />);

    expect(getByTestId('explore.file.readme.md').props.style.backgroundColor).toBe('#1c1c1e');
  });
});
