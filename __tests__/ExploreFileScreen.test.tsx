jest.mock('expo-sqlite', () => ({
  openDatabaseAsync: jest.fn(),
}));

jest.mock('react-native-marked', () => ({
  useMarkdown: jest.fn(() => []),
}));

const mockAlert = jest.fn();
const mockFileText = jest.fn();
const mockFileExists = jest.fn().mockReturnValue(true);
const mockFileWrite = jest.fn();

jest.mock('expo-file-system', () => ({
  File: function MockFile(_path: string) {
    return {
      exists: mockFileExists(),
      text: () => mockFileText(),
      write: () => mockFileWrite(),
    };
  },
}));

jest.mock('react-native', () => {
  const fn = jest.fn();
  const React = require('react');
  return {
    __esModule: true,
    View: 'View',
    Text: 'Text',
    TextInput: ({ testID, ...rest }: { testID?: string; [key: string]: unknown }) =>
      React.createElement('TextInput', { testID, ...rest }),
    ScrollView: 'ScrollView',
    Pressable: 'Pressable',
    ActivityIndicator: 'ActivityIndicator',
    SafeAreaView: 'SafeAreaView',
    Alert: { alert: mockAlert },
    Platform: { OS: 'ios', select: (obj: Record<string, unknown>) => (obj.ios ?? obj.default) },
    StyleSheet: { create: (style: unknown) => style, flatten: fn },
    AppState: { addEventListener: fn, removeEventListener: fn, currentState: 'active' },
    Keyboard: { dismiss: fn, addListener: fn, removeListener: fn },
    KeyboardAvoidingView: 'KeyboardAvoidingView',
    TouchableOpacity: 'TouchableOpacity',
    Image: 'Image',
    FlatList: 'FlatList',
    SectionList: 'SectionList',
    RefreshControl: 'RefreshControl',
    Modal: 'Modal',
    StatusBar: 'StatusBar',
    Switch: 'Switch',
    Dimensions: { get: () => ({ width: 375, height: 812 }), addEventListener: fn, removeEventListener: fn },
    PixelRatio: { get: () => 2, getFontScale: () => 1 },
    NativeModules: {},
    DevMenu: {},
    DevSettings: {},
  };
});

function getFileMock() {
  return { mockFileText, mockFileExists, mockFileWrite };
}

import React from 'react';
import { fireEvent, render, waitFor, act } from '@testing-library/react-native';
import { TextInput } from 'react-native';
import { useNavigation, useRoute } from '@react-navigation/native';

import ExploreFileScreen from '@/screens/ExploreFileScreen';
import { GitFsService } from '@/services/git/GitFsService';
import { WorkingTreeDocumentService } from '@/services/documents/WorkingTreeDocumentService';
import { GitBranchCoordinator } from '@/services/git/GitBranchCoordinator';

// ─── mock external dependencies ────────────────────────────────────────────────

const mockNavigate = jest.fn();
const mockGoBack = jest.fn();

jest.mock('@react-navigation/native', () => ({
  useNavigation: () => ({ navigate: mockNavigate, goBack: mockGoBack }),
  useRoute: jest.fn(),
}));

let mockRepositories: { id: string; path: string; name: string; localPath: string; branch: string }[] = [];
jest.mock('@/stores/repoStore', () => ({
  useRepoStore: (selector: (state: { repositories: { id: string; path: string; name: string; localPath: string; branch: string }[] }) => unknown) =>
    selector({ repositories: mockRepositories }),
}));

const mockWorkingTreeUri = 'file:///repo/owner/repo';
jest.mock('@/services/git/GitFsService', () => ({
  GitFsService: { workingTreeUri: jest.fn(() => mockWorkingTreeUri) },
}));

jest.mock('@/contexts/ThemeContext', () => ({
  useTokens: () => ({
    colors: {
      background: '#fff',
      border: '#ddd',
      text: '#111',
      textSecondary: '#666',
      accent: '#007AFF',
      error: '#FF3B30',
      surface: '#fff',
    },
    type: { xs: 12, sm: 14, md: 16 },
  }),
  useTheme: () => ({ isDark: false, style: {} }),
}));

jest.mock('@/contexts/CheckoutSafetyContext', () => ({
  useCheckoutSafety: jest.fn(() => ({ isCheckingOut: false })),
}));

jest.mock('@/services/git/lfs', () => ({
  parseLfsPointer: jest.fn((content: string) => {
    if (content.includes('git-lfs.github.com/spec/v1')) {
      return { oid: 'abc123'.padEnd(64, '0'), size: 123456 };
    }
    return null;
  }),
}));

const mockServiceUpdate = jest.fn();
jest.mock('@/services/documents/WorkingTreeDocumentService', () => ({
  WorkingTreeDocumentService: jest.fn().mockImplementation(() => ({
    update: mockServiceUpdate,
  })),
  workingTreeDocument: jest.fn((path: string, body: string, tag: string) => ({
    id: `working-tree:${path}`,
    type: 'note',
    path,
    title: path.split('/').pop() ?? path,
    slug: path.split('/').pop() ?? path,
    folder: null,
    tags: [tag],
    createdAt: 1000,
    updatedAt: 1000,
    isPinned: false,
    deleted: false,
    body,
    raw: body,
  })),
}));

jest.spyOn(GitBranchCoordinator, 'getState').mockReturnValue('idle');
jest.spyOn(GitBranchCoordinator, 'onStateChange').mockReturnValue(jest.fn());

jest.mock('@expo/vector-icons', () => ({ Ionicons: 'Ionicons' }));

jest.mock('@/components/ui/text', () => {
  const React = require('react');
  return {
    Text: ({ children, testID }: { children?: React.ReactNode; testID?: string }) => {
      if (testID) {
        return React.createElement('Text', { testID }, children ?? '');
      }
      return children != null ? React.createElement('Text', null, children) : null;
    },
  };
});

jest.mock('@/components/ui/heading', () => {
  const React = require('react');
  return {
    Heading: ({ children, testID }: { children?: React.ReactNode; testID?: string }) => {
      if (testID) {
        return React.createElement('Text', { testID }, children ?? '');
      }
      return children != null ? React.createElement('Text', null, children) : null;
    },
  };
});

jest.mock('@/components/FileContentRenderer', () => {
  const React = require('react');
  return {
    __esModule: true,
    default: ({ testID }: { testID?: string }) =>
      React.createElement('View', { testID: testID ?? 'file-content-renderer.root' }),
  };
});

jest.mock('@/utils/fileLanguage', () => ({
  classifyFile: (path: string) => {
    const result = jest.requireActual('@/utils/fileLanguage').classifyFile(path);
    return result;
  },
}));

function setupRoute(repoId: string, path: string) {
  (useRoute as jest.Mock).mockReturnValue({ params: { repoId, path } });
}

const mockRepo = {
  id: 'repo-1',
  path: 'owner/repo',
  name: 'repo',
  localPath: '/repo/owner/repo',
  branch: 'main',
};

// ─── tests ────────────────────────────────────────────────────────────────────

describe('ExploreFileScreen', () => {
  beforeEach(() => {
    mockRepositories = [mockRepo];
    mockFileExists.mockReturnValue(true);
    mockFileText.mockResolvedValue('Hello world');
    mockServiceUpdate.mockResolvedValue(undefined);
    mockServiceUpdate.mockClear();
  });

  describe('happy path', () => {
    it('renders preview content for a markdown file by default', async () => {
      setupRoute('repo-1', 'notes/hello.md');

      const { getByTestId } = render(<ExploreFileScreen />);

      const preview = await waitFor(
        () => getByTestId('explore-file.preview-content'),
        { timeout: 3000 },
      );
      expect(preview).toBeTruthy();
      expect(preview.props.contentContainerClassName).toBe('px-4 pb-10');
    });

    it('calls writer with exact new value when save is pressed after entering Edit', async () => {
      setupRoute('repo-1', 'notes/hello.md');

      const { getByTestId } = render(<ExploreFileScreen />);

      // File loads in preview mode — enter Edit via toggle
      await waitFor(() => getByTestId('explore-file.preview-content'), { timeout: 3000 });
      const toggle = getByTestId('explore-file.mode-toggle');
      await act(async () => { fireEvent.press(toggle); });

      const editor = await waitFor(
        () => getByTestId('explore-file.editor'),
        { timeout: 3000 },
      );

      const textInput = editor as unknown as TextInput;

      fireEvent(textInput, 'changeText', 'Modified content');

      const saveButton = getByTestId('explore-file.save');
      await act(async () => {
        fireEvent.press(saveButton);
      });

      expect(mockServiceUpdate).toHaveBeenCalledWith(
        expect.any(String),
        { body: 'Modified content' },
      );
    });

    it('screen stays visible after save', async () => {
      setupRoute('repo-1', 'notes/hello.md');

      const { getByTestId } = render(<ExploreFileScreen />);

      // Enter Edit mode
      await waitFor(() => getByTestId('explore-file.preview-content'), { timeout: 3000 });
      await act(async () => { fireEvent.press(getByTestId('explore-file.mode-toggle')); });

      const editor = await waitFor(
        () => getByTestId('explore-file.editor'),
        { timeout: 3000 },
      );

      const textInput = editor as unknown as TextInput;

      fireEvent(textInput, 'changeText', 'New content');

      const saveButton = getByTestId('explore-file.save');
      await act(async () => {
        fireEvent.press(saveButton);
      });

      expect(getByTestId('explore-file.root')).toBeTruthy();
    });
  });

  describe('binary file', () => {
    it('shows binary-message and no editor', async () => {
      setupRoute('repo-1', 'image.png');

      const { getByTestId, queryByTestId } = render(<ExploreFileScreen />);

      const binaryMessage = await waitFor(
        () => getByTestId('explore-file.binary-message'),
        { timeout: 3000 },
      );
      expect(binaryMessage).toBeTruthy();

      expect(queryByTestId('explore-file.editor')).toBeNull();
      expect(queryByTestId('explore-file.save')).toBeNull();
    });
  });

  describe('LFS pointer', () => {
    it('shows lfs-pointer-message when content is an LFS pointer', async () => {
      setupRoute('repo-1', 'large.txt');

      mockFileText.mockResolvedValue(
        'version https://git-lfs.github.com/spec/v1\noid sha256:abc123\nsize 123456\n',
      );

      const { getByTestId, queryByTestId } = render(<ExploreFileScreen />);

      const lfsMessage = await waitFor(
        () => getByTestId('explore-file.lfs-pointer-message'),
        { timeout: 3000 },
      );
      expect(lfsMessage).toBeTruthy();

      expect(queryByTestId('explore-file.editor')).toBeNull();
      expect(queryByTestId('explore-file.save')).toBeNull();
    });
  });

  describe('writer rejection', () => {
    it('shows save-error when writer throws', async () => {
      setupRoute('repo-1', 'notes/hello.md');

      mockServiceUpdate.mockRejectedValue(new Error('disk full'));

      const { getByTestId } = render(<ExploreFileScreen />);

      // Enter Edit mode for eligible file
      await waitFor(() => getByTestId('explore-file.preview-content'), { timeout: 3000 });
      await act(async () => { fireEvent.press(getByTestId('explore-file.mode-toggle')); });

      const editor = await waitFor(
        () => getByTestId('explore-file.editor'),
        { timeout: 3000 },
      );

      const textInput = editor as unknown as TextInput;

      fireEvent(textInput, 'changeText', 'New content');

      const saveButton = getByTestId('explore-file.save');
      await act(async () => {
        fireEvent.press(saveButton);
      });

      const saveError = await waitFor(
        () => getByTestId('explore-file.save-error'),
        { timeout: 3000 },
      );
      expect(saveError).toBeTruthy();
    });

    it('retains edited text after writer rejection', async () => {
      setupRoute('repo-1', 'notes/hello.md');

      mockServiceUpdate.mockRejectedValue(new Error('write failed'));

      const { getByTestId } = render(<ExploreFileScreen />);

      // Enter Edit mode for eligible file
      await waitFor(() => getByTestId('explore-file.preview-content'), { timeout: 3000 });
      await act(async () => { fireEvent.press(getByTestId('explore-file.mode-toggle')); });

      const editor = await waitFor(
        () => getByTestId('explore-file.editor'),
        { timeout: 3000 },
      );

      const textInput = editor as unknown as TextInput;

      fireEvent(textInput, 'changeText', 'Should be retained');

      const saveButton = getByTestId('explore-file.save');
      await act(async () => {
        fireEvent.press(saveButton);
      });

      await waitFor(
        () => getByTestId('explore-file.save-error'),
        { timeout: 3000 },
      );

      expect(textInput.props.value).toBe('Should be retained');
    });
  });

  describe('missing repo', () => {
    it('shows "Repository not found" without crashing', async () => {
      mockRepositories = [];
      setupRoute('nonexistent-repo', 'notes/hello.md');

      const { getAllByText } = render(<ExploreFileScreen />);
      const allMatching = getAllByText('Repository not found.');
      expect(allMatching.length).toBeGreaterThan(0);
    });
  });

  describe('missing file', () => {
    it('shows error message when file does not exist', async () => {
      mockFileExists.mockReturnValue(false);
      setupRoute('repo-1', 'notes/doesnotexist.md');

      const { getByTestId } = render(<ExploreFileScreen />);

      const errorEl = await waitFor(
        () => getByTestId('explore-file.error'),
        { timeout: 3000 },
      );
      expect(errorEl).toBeTruthy();
    });
  });

  describe('cancel dirty state', () => {
    it('shows Alert when cancel is pressed with dirty state', async () => {
      const ReactNative = require('react-native');
      ReactNative.Alert.alert = mockAlert;

      setupRoute('repo-1', 'notes/hello.md');

      const { getByTestId } = render(<ExploreFileScreen />);

      // Enter Edit mode for eligible file
      await waitFor(() => getByTestId('explore-file.preview-content'), { timeout: 3000 });
      await act(async () => { fireEvent.press(getByTestId('explore-file.mode-toggle')); });

      const editor = await waitFor(
        () => getByTestId('explore-file.editor'),
        { timeout: 3000 },
      );

      const textInput = editor as unknown as TextInput;

      fireEvent(textInput, 'changeText', 'Dirty content');

      const cancelButton = getByTestId('explore-file.cancel');
      await act(async () => {
        fireEvent.press(cancelButton);
      });

      expect(mockAlert).toHaveBeenCalledWith(
        'Discard changes?',
        'You have unsaved changes that will be lost.',
        expect.arrayContaining([
          expect.objectContaining({ text: 'Keep Editing' }),
          expect.objectContaining({ text: 'Discard' }),
        ]),
      );
    });
  });

  describe('checkout blocking', () => {
    afterEach(() => {
      const { useCheckoutSafety } = require('@/contexts/CheckoutSafetyContext');
      (useCheckoutSafety as jest.Mock).mockReturnValue({ isCheckingOut: false });
    });

    it('disables Save button when isCheckingOut is true', async () => {
      mockRepositories = [mockRepo];
      mockFileExists.mockReturnValue(true);
      mockFileText.mockResolvedValue('Hello world');
      mockServiceUpdate.mockResolvedValue(undefined);

      // Override CheckoutSafetyContext mock to simulate isCheckingOut = true
      const { useCheckoutSafety } = require('@/contexts/CheckoutSafetyContext');
      (useCheckoutSafety as jest.Mock).mockReturnValue({ isCheckingOut: true });

      setupRoute('repo-1', 'notes/hello.md');

      const { getByTestId } = render(<ExploreFileScreen />);

      // Enter Edit mode for eligible file
      await waitFor(() => getByTestId('explore-file.preview-content'), { timeout: 3000 });
      await act(async () => { fireEvent.press(getByTestId('explore-file.mode-toggle')); });

      const editor = await waitFor(
        () => getByTestId('explore-file.editor'),
        { timeout: 3000 },
      );

      const textInput = editor as unknown as TextInput;

      fireEvent(textInput, 'changeText', 'Dirty content');

      const saveButton = getByTestId('explore-file.save');
      await act(async () => {
        fireEvent.press(saveButton);
      });
      expect(mockServiceUpdate).not.toHaveBeenCalled();
    });
  });

  describe('preview/edit mode', () => {
    it('defaults to preview mode for a markdown file', async () => {
      setupRoute('repo-1', 'notes/hello.md');

      const { getByTestId, queryByTestId } = render(<ExploreFileScreen />);

      const preview = await waitFor(
        () => getByTestId('explore-file.preview-content'),
        { timeout: 3000 },
      );
      expect(preview).toBeTruthy();
      // Editor should not appear without explicit toggle
      expect(queryByTestId('explore-file.editor')).toBeNull();
    });

    it('defaults to preview mode for a JSON file', async () => {
      setupRoute('repo-1', 'notes/hello.json');

      const { getByTestId, queryByTestId } = render(<ExploreFileScreen />);

      const preview = await waitFor(
        () => getByTestId('explore-file.preview-content'),
        { timeout: 3000 },
      );
      expect(preview).toBeTruthy();
      expect(queryByTestId('explore-file.editor')).toBeNull();
    });

    it('defaults to preview mode for a code file', async () => {
      setupRoute('repo-1', 'notes/hello.ts');

      const { getByTestId, queryByTestId } = render(<ExploreFileScreen />);

      const preview = await waitFor(
        () => getByTestId('explore-file.preview-content'),
        { timeout: 3000 },
      );
      expect(preview).toBeTruthy();
      expect(queryByTestId('explore-file.editor')).toBeNull();
    });

    it('defaults to edit mode for a plain text file', async () => {
      setupRoute('repo-1', 'notes/hello.txt');

      const { getByTestId } = render(<ExploreFileScreen />);

      const editor = await waitFor(
        () => getByTestId('explore-file.editor'),
        { timeout: 3000 },
      );
      expect(editor).toBeTruthy();
    });

    it('shows mode toggle for a markdown file', async () => {
      setupRoute('repo-1', 'notes/hello.md');

      const { getByTestId, queryByTestId } = render(<ExploreFileScreen />);

      await waitFor(() => getByTestId('explore-file.root'), { timeout: 3000 });

      const toggle = queryByTestId('explore-file.mode-toggle');
      expect(toggle).toBeTruthy();
    });

    it('shows mode toggle for a code file', async () => {
      setupRoute('repo-1', 'notes/hello.ts');

      const { getByTestId, queryByTestId } = render(<ExploreFileScreen />);

      await waitFor(() => getByTestId('explore-file.root'), { timeout: 3000 });

      const toggle = queryByTestId('explore-file.mode-toggle');
      expect(toggle).toBeTruthy();
    });

    it('shows mode toggle for a json file', async () => {
      setupRoute('repo-1', 'notes/hello.json');

      const { getByTestId, queryByTestId } = render(<ExploreFileScreen />);

      await waitFor(() => getByTestId('explore-file.root'), { timeout: 3000 });

      const toggle = queryByTestId('explore-file.mode-toggle');
      expect(toggle).toBeTruthy();
    });

    it('does NOT show mode toggle for a plain text file', async () => {
      setupRoute('repo-1', 'notes/hello.txt');

      const { getByTestId, queryByTestId } = render(<ExploreFileScreen />);

      await waitFor(() => getByTestId('explore-file.root'), { timeout: 3000 });

      const toggle = queryByTestId('explore-file.mode-toggle');
      expect(toggle).toBeNull();
    });

    it('does NOT show mode toggle for a binary file', async () => {
      setupRoute('repo-1', 'image.png');

      const { getByTestId, queryByTestId } = render(<ExploreFileScreen />);

      await waitFor(
        () => getByTestId('explore-file.binary-message'),
        { timeout: 3000 },
      );

      const toggle = queryByTestId('explore-file.mode-toggle');
      expect(toggle).toBeNull();
    });

    it('does NOT show mode toggle for an LFS pointer file', async () => {
      setupRoute('repo-1', 'large.txt');

      mockFileText.mockResolvedValue(
        'version https://git-lfs.github.com/spec/v1\noid sha256:abc123\nsize 123456\n',
      );

      const { getByTestId, queryByTestId } = render(<ExploreFileScreen />);

      await waitFor(
        () => getByTestId('explore-file.lfs-pointer-message'),
        { timeout: 3000 },
      );

      const toggle = queryByTestId('explore-file.mode-toggle');
      expect(toggle).toBeNull();
    });

    it('entering Preview shows FileContentRenderer', async () => {
      setupRoute('repo-1', 'notes/hello.md');

      const { getByTestId } = render(<ExploreFileScreen />);

      await waitFor(
        () => getByTestId('explore-file.preview-content'),
        { timeout: 3000 },
      );

      const toggle = getByTestId('explore-file.mode-toggle');
      await act(async () => {
        fireEvent.press(toggle);
      });

      await waitFor(
        () => getByTestId('explore-file.editor'),
        { timeout: 3000 },
      );

      await act(async () => {
        fireEvent.press(toggle);
      });

      const preview = await waitFor(
        () => getByTestId('explore-file.preview-content'),
        { timeout: 3000 },
      );
      expect(preview).toBeTruthy();
    });

    it('entering Edit and returning to Preview restores the rendered content', async () => {
      setupRoute('repo-1', 'notes/hello.md');

      const { getByTestId } = render(<ExploreFileScreen />);

      await waitFor(
        () => getByTestId('explore-file.preview-content'),
        { timeout: 3000 },
      );

      const toggle = getByTestId('explore-file.mode-toggle');
      await act(async () => {
        fireEvent.press(toggle);
      });

      expect(await waitFor(() => getByTestId('explore-file.editor'), { timeout: 3000 })).toBeTruthy();

      await act(async () => {
        fireEvent.press(toggle);
      });

      const preview = await waitFor(
        () => getByTestId('explore-file.preview-content'),
        { timeout: 3000 },
      );
      expect(preview).toBeTruthy();
    });

    it('save and cancel buttons are absent in preview mode', async () => {
      setupRoute('repo-1', 'notes/hello.md');

      const { getByTestId, queryByTestId } = render(<ExploreFileScreen />);

      await waitFor(
        () => getByTestId('explore-file.preview-content'),
        { timeout: 3000 },
      );

      expect(queryByTestId('explore-file.save')).toBeNull();
      expect(queryByTestId('explore-file.cancel')).toBeNull();
    });

    it('save and cancel buttons are present in edit mode', async () => {
      setupRoute('repo-1', 'notes/hello.md');

      const { getByTestId } = render(<ExploreFileScreen />);

      await waitFor(() => getByTestId('explore-file.preview-content'), { timeout: 3000 });

      const toggle = getByTestId('explore-file.mode-toggle');
      await act(async () => { fireEvent.press(toggle); });

      await waitFor(() => getByTestId('explore-file.editor'), { timeout: 3000 });

      expect(getByTestId('explore-file.save')).toBeTruthy();
      expect(getByTestId('explore-file.cancel')).toBeTruthy();
    });

    it('dirty state is preserved when switching from edit to preview and back', async () => {
      setupRoute('repo-1', 'notes/hello.md');

      const { getByTestId } = render(<ExploreFileScreen />);

      await waitFor(
        () => getByTestId('explore-file.preview-content'),
        { timeout: 3000 },
      );

      const toggle = getByTestId('explore-file.mode-toggle');
      await act(async () => { fireEvent.press(toggle); });

      const editor = await waitFor(() => getByTestId('explore-file.editor'), { timeout: 3000 });
      const textInput = editor as unknown as TextInput;
      fireEvent(textInput, 'changeText', 'Dirty content');

      await act(async () => {
        fireEvent.press(toggle);
      });

      await waitFor(
        () => getByTestId('explore-file.preview-content'),
        { timeout: 3000 },
      );

      await act(async () => {
        fireEvent.press(toggle);
      });

      const restoredEditor = await waitFor(
        () => getByTestId('explore-file.editor'),
        { timeout: 3000 },
      );
      const restoredInput = restoredEditor as unknown as TextInput;
      expect(restoredInput.props.value).toBe('Dirty content');
    });

    it('preview mode for markdown file shows markdown renderer testID', async () => {
      setupRoute('repo-1', 'notes/hello.md');

      const { getByTestId, queryByTestId } = render(<ExploreFileScreen />);

      await waitFor(
        () => getByTestId('explore-file.preview-content'),
        { timeout: 3000 },
      );

      const rendererRoot = queryByTestId('file-content-renderer.root');
      expect(rendererRoot).toBeTruthy();
    });

    it('preview mode for json file shows json renderer testID', async () => {
      setupRoute('repo-1', 'notes/hello.json');

      const { getByTestId, queryByTestId } = render(<ExploreFileScreen />);

      await waitFor(
        () => getByTestId('explore-file.preview-content'),
        { timeout: 3000 },
      );

      const rendererRoot = queryByTestId('file-content-renderer.root');
      expect(rendererRoot).toBeTruthy();
    });

    it('preview mode for code file shows code renderer testID', async () => {
      setupRoute('repo-1', 'notes/hello.ts');

      const { getByTestId, queryByTestId } = render(<ExploreFileScreen />);

      await waitFor(
        () => getByTestId('explore-file.preview-content'),
        { timeout: 3000 },
      );

      const rendererRoot = queryByTestId('file-content-renderer.root');
      expect(rendererRoot).toBeTruthy();
    });

    it('mode toggle label is Edit when in preview', async () => {
      setupRoute('repo-1', 'notes/hello.md');

      const { getByTestId } = render(<ExploreFileScreen />);

      // File loads in preview by default — toggle should say "Edit"
      await waitFor(() => getByTestId('explore-file.preview-content'), { timeout: 3000 });

      const toggle = getByTestId('explore-file.mode-toggle');
      expect(toggle).toBeTruthy();

      await act(async () => {
        fireEvent.press(toggle);
      });

      await waitFor(
        () => getByTestId('explore-file.editor'),
        { timeout: 3000 },
      );

      const toggleAgain = getByTestId('explore-file.mode-toggle');
      expect(toggleAgain).toBeTruthy();
    });
  });
});
