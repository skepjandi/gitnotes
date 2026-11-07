import { fireEvent, render, waitFor } from '@testing-library/react-native';
import { useRoute, useNavigation } from '@react-navigation/native';

import ConflictResolveScreen from '@/screens/ConflictResolveScreen';
import * as GitEngine from '@/services/git/engine/GitEngine';
import type { GitRepository } from '@/services/GitService';
import {
  computeCrdtMerge,
  computeSidecarOnlyMerge,
  resolveSidecarConflictAndSync,
} from '@/services/git/conflictResolution';

let mockRepositories: GitRepository[] = [];

jest.mock('@react-navigation/native', () => ({
  useNavigation: jest.fn(),
  useRoute: jest.fn(),
}));

jest.mock('@/stores/repoStore', () => ({
  useRepoStore: (selector: (state: { repositories: GitRepository[] }) => unknown) =>
    selector({ repositories: mockRepositories }),
}));

jest.mock('@/stores/gitButtonActionStore', () => ({
  useGitButtonActionStore: (selector: (state: { setPending: jest.Mock }) => unknown) =>
    selector({ setPending: jest.fn() }),
}));

jest.mock('@/contexts/ThemeContext', () => ({
  useTokens: () => ({
    colors: {
      background: '#fff',
      border: '#ddd',
      text: '#111',
      textSecondary: '#666',
      accent: '#00f',
      card: '#eee',
      error: '#f00',
      surface: '#fff',
    },
    type: { xs: 12, sm: 14, md: 16 },
  }),
  useTheme: () => ({ style: {} }),
}));

jest.mock('@expo/vector-icons', () => ({ Ionicons: 'Ionicons' }));

jest.mock('@/components/ui/Button', () => {
  const React = require('react');
  const { Pressable, Text } = require('react-native');
  return {
    Button: ({ children, onPress, disabled, testID }: {
      children: unknown;
      onPress?: () => void;
      disabled?: boolean;
      testID?: string;
    }) => React.createElement(Pressable, { onPress, disabled, testID }, children),
    ButtonText: ({ children }: { children: unknown }) => React.createElement(Text, null, children),
  };
});

jest.mock('@/services/git/GitFsService', () => ({
  GitFsService: { workingTreeUri: jest.fn(() => 'file:///repo') },
}));

jest.mock('@/services/git/engine/GitEngine', () => ({
  getConflictBlobs: jest.fn(),
  markConflictResolved: jest.fn(),
}));

jest.mock('@/services/git/conflictResolution', () => ({
  getConflictChoiceContent: jest.fn((blobs: { ours: string; theirs: string }, choice: string) => {
    if (choice === 'ours') return blobs.ours;
    if (choice === 'theirs') return blobs.theirs;
    if (choice === 'both') return `${blobs.ours}\n${blobs.theirs}`;
    return `<<<<<<< ours\n${blobs.ours}\n=======\n${blobs.theirs}\n>>>>>>> theirs\n`;
  }),
  resolveConflictAndSync: jest.fn(),
  computeCrdtMerge: jest.fn(),
  computeSidecarOnlyMerge: jest.fn(),
  resolveSidecarConflictAndSync: jest.fn(),
}));

describe('ConflictResolveScreen', () => {
  beforeEach(() => {
    mockRepositories = [];
    jest.clearAllMocks();
  });

  it('keeps the resolver body visible when the repository is unavailable', () => {
    (useNavigation as jest.Mock).mockReturnValue({ goBack: jest.fn(), navigate: jest.fn() });
    (useRoute as jest.Mock).mockReturnValue({ params: { repoId: 'repo-1', path: 'notes/hi2.md' } });

    const screen = render(<ConflictResolveScreen />);

    expect(screen.getByTestId('conflict-resolve.screen').props.style).toEqual(
      expect.objectContaining({ flex: 1 }),
    );
    expect(screen.getByText('Repository not found.')).toBeTruthy();
  });

  it('offers ours, theirs, both, and full edit choices', async () => {
    mockRepositories = [{ id: 'repo-1', path: 'owner/repo', name: 'repo', branch: 'main' }];
    (GitEngine.getConflictBlobs as jest.Mock).mockResolvedValue({
      ours: 'local',
      theirs: 'remote',
      base: 'common',
    });
    (useNavigation as jest.Mock).mockReturnValue({ goBack: jest.fn(), navigate: jest.fn() });
    (useRoute as jest.Mock).mockReturnValue({ params: { repoId: 'repo-1', path: 'notes/hi2.md' } });

    const screen = render(<ConflictResolveScreen />);

    await waitFor(() => expect(screen.getByTestId('conflict-resolve.accept-ours')).toBeTruthy());
    fireEvent.press(screen.getByTestId('conflict-resolve.accept-both'));

    expect(screen.getByTestId('conflict-resolve.accept-theirs')).toBeTruthy();
    expect(screen.getByTestId('conflict-resolve.full-edit')).toBeTruthy();
    expect(screen.getByTestId('conflict-resolve.editor').props.value).toBe('local\nremote');
  });

  it('does not offer CRDT merge unless the repository opted in', async () => {
    mockRepositories = [{ id: 'repo-1', path: 'owner/repo', name: 'repo', branch: 'main' }];
    (GitEngine.getConflictBlobs as jest.Mock).mockResolvedValue({ ours: 'a', theirs: 'b', base: '' });
    (useNavigation as jest.Mock).mockReturnValue({ goBack: jest.fn(), navigate: jest.fn() });
    (useRoute as jest.Mock).mockReturnValue({ params: { repoId: 'repo-1', path: 'notes/hi2.md' } });

    const screen = render(<ConflictResolveScreen />);

    await waitFor(() => expect(screen.getByTestId('conflict-resolve.accept-ours')).toBeTruthy());
    expect(screen.queryByTestId('conflict-resolve.use-crdt')).toBeNull();
    expect(computeCrdtMerge).not.toHaveBeenCalled();
  });

  it('preselects the CRDT merge and keeps the manual choices for an opted-in repository', async () => {
    mockRepositories = [
      { id: 'repo-1', path: 'owner/repo', name: 'repo', branch: 'main', crdtMergeEnabled: true },
    ];
    (GitEngine.getConflictBlobs as jest.Mock).mockResolvedValue({ ours: 'a', theirs: 'b', base: '' });
    (computeCrdtMerge as jest.Mock).mockResolvedValue('merged by crdt');
    (useNavigation as jest.Mock).mockReturnValue({ goBack: jest.fn(), navigate: jest.fn() });
    (useRoute as jest.Mock).mockReturnValue({ params: { repoId: 'repo-1', path: 'notes/hi2.md' } });

    const screen = render(<ConflictResolveScreen />);

    await waitFor(() => expect(screen.getByTestId('conflict-resolve.use-crdt')).toBeTruthy());
    expect(screen.getByTestId('conflict-resolve.editor').props.value).toBe('merged by crdt');
    fireEvent.press(screen.getByTestId('conflict-resolve.accept-theirs'));
    expect(screen.getByTestId('conflict-resolve.editor').props.value).toBe('b');
    fireEvent.press(screen.getByTestId('conflict-resolve.use-crdt'));
    expect(screen.getByTestId('conflict-resolve.editor').props.value).toBe('merged by crdt');
  });

  it('falls back to the manual choices when the CRDT merge fails', async () => {
    mockRepositories = [
      { id: 'repo-1', path: 'owner/repo', name: 'repo', branch: 'main', crdtMergeEnabled: true },
    ];
    (GitEngine.getConflictBlobs as jest.Mock).mockResolvedValue({ ours: 'a', theirs: 'b', base: '' });
    (computeCrdtMerge as jest.Mock).mockRejectedValue(new Error('bad sidecar'));
    (useNavigation as jest.Mock).mockReturnValue({ goBack: jest.fn(), navigate: jest.fn() });
    (useRoute as jest.Mock).mockReturnValue({ params: { repoId: 'repo-1', path: 'notes/hi2.md' } });
    jest.spyOn(console, 'warn').mockImplementation(() => undefined);

    const screen = render(<ConflictResolveScreen />);

    await waitFor(() => expect(screen.getByTestId('conflict-resolve.accept-ours')).toBeTruthy());
    await waitFor(() => expect(computeCrdtMerge).toHaveBeenCalled());
    expect(screen.queryByTestId('conflict-resolve.use-crdt')).toBeNull();
  });

  it('resolves a sidecar-only conflict through the CRDT merge of its note', async () => {
    mockRepositories = [
      { id: 'repo-1', path: 'owner/repo', name: 'repo', branch: 'main', crdtMergeEnabled: true },
    ];
    (computeSidecarOnlyMerge as jest.Mock).mockResolvedValue('merged note');
    (useNavigation as jest.Mock).mockReturnValue({ goBack: jest.fn(), navigate: jest.fn() });
    (useRoute as jest.Mock).mockReturnValue({
      params: { repoId: 'repo-1', path: '.gitnotes/crdt/notes/hi2.md.crdt' },
    });

    const screen = render(<ConflictResolveScreen />);

    await waitFor(() => expect(screen.getByTestId('conflict-resolve.use-crdt')).toBeTruthy());
    expect(computeSidecarOnlyMerge).toHaveBeenCalledWith(mockRepositories[0], 'notes/hi2.md');
    expect(screen.queryByTestId('conflict-resolve.accept-ours')).toBeNull();
    fireEvent.press(screen.getByTestId('conflict-resolve.save'));
    await waitFor(() =>
      expect(resolveSidecarConflictAndSync).toHaveBeenCalledWith(
        mockRepositories[0],
        'notes/hi2.md',
        'merged note',
      ),
    );
    expect(GitEngine.getConflictBlobs).not.toHaveBeenCalled();
  });
});
