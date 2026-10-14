/**
 * NoteHistoryModal.test.tsx
 *
 * Focused tests for NoteHistoryModal:
 * - Slider selection callbacks
 * - Accessible revision selection
 * - Loading/empty/error/unavailable states
 * - Selectable preview
 * - Edit disabled, Close enabled
 */

import React from 'react';
import { render, screen, fireEvent } from '@testing-library/react-native';

import { NoteHistoryModal } from '@/components/editor/NoteHistoryModal';
import type { UseNoteHistoryResult } from '@/hooks/useNoteHistory';
import type { FileHistoryEntry } from '@/services/note/NoteHistoryService';

jest.mock('@/contexts/ThemeContext', () => {
  const { SAFE_DEFAULT_TOKENS, SAFE_DEFAULT_THEME } = jest.requireActual(
    '@/contexts/ThemeContext',
  );
  return {
    useTheme: () => SAFE_DEFAULT_THEME,
    useTokens: () => SAFE_DEFAULT_TOKENS,
  };
});

jest.mock('@/utils/haptics', () => ({
  HapticService: { selection: jest.fn(), light: jest.fn() },
}));

jest.mock('react-i18next', () => ({
  useTranslation: () => ({ t: (key: string) => key }),
}));

jest.mock('@/components/ui/Modal', () => {
  const React = require('react');
  const { View } = require('react-native');
  return {
    Modal: function MockModal({ visible, children, ...rest }: { visible?: boolean; children?: React.ReactNode; [key: string]: unknown }) {
      if (!visible) return null;
      return <View {...rest}>{children}</View>;
    },
  };
});

jest.mock('react-native-reanimated', () => {
  const React = require('react');

  function StubView(props: Record<string, unknown>) {
    return React.createElement('View', props);
  }
  function StubScrollView(props: Record<string, unknown>) {
    return React.createElement('ScrollView', props);
  }

  return {
    __esModule: true,
    default: { View: StubView, createAnimatedComponent: (c: unknown) => c },
    View: StubView,
    useSharedValue: (initial: number) => ({ value: initial }),
    useAnimatedStyle: (cb: () => Record<string, unknown>) => cb(),
    useDerivedValue: (cb: () => number) => ({ value: cb() }),
    useAnimatedScrollHandler: (handlers: object) => handlers,
    withSpring: (v: number) => v,
    withTiming: (to: number, _opts?: unknown) => to,
    withDelay: (_d: unknown, anim: unknown) => anim,
    withSequence: (...anims: unknown[]) => anims[anims.length - 1] ?? anims[0],
    withRepeat: (anim: unknown) => anim,
    cancelAnimation: () => { /* noop */ },
    runOnJS: (fn: (...args: unknown[]) => void) => fn,
    interpolate: (value: number, inputRange: number[], outputRange: number[]) => {
      const clamped = Math.max(inputRange[0], Math.min(inputRange[inputRange.length - 1], value));
      let idx = 0;
      for (let i = 0; i < inputRange.length - 1; i++) {
        if (clamped >= inputRange[i] && clamped <= inputRange[i + 1]) { idx = i; break; }
      }
      const ratio = inputRange[idx + 1] !== inputRange[idx]
        ? (clamped - inputRange[idx]) / (inputRange[idx + 1] - inputRange[idx])
        : 0;
      return outputRange[idx] + ratio * (outputRange[idx + 1] - outputRange[idx]);
    },
    Easing: { linear: (v: number) => v, in: (v: number) => v, out: (v: number) => v, inOut: (v: number) => v },
    Animated: { ScrollView: StubScrollView, View: StubView },
  };
});

jest.mock('react-native-gesture-handler', () => ({
  GestureDetector: ({ children }: { children?: React.ReactNode }) => <>{children}</>,
  Gesture: {
    Pan: () => ({
      runOnJS: jest.fn().mockReturnThis(),
      activeOffsetX: jest.fn().mockReturnThis(),
      failOffsetY: jest.fn().mockReturnThis(),
      onStart: jest.fn().mockReturnThis(),
      onUpdate: jest.fn().mockReturnThis(),
      onEnd: jest.fn().mockReturnThis(),
      onFinalize: jest.fn().mockReturnThis(),
    }),
  },
}));

const makeHistoryResult = (overrides: Partial<UseNoteHistoryResult> = {}): UseNoteHistoryResult => ({
  state: { status: 'idle' },
  selectedCommitId: null,
  selectedBlob: null,
  isLoadingBlob: false,
  hasMore: false,
  identity: null,
  unavailableReason: null,
  isDirty: false,
  loadHistory: jest.fn(),
  selectCommit: jest.fn(),
  loadMore: jest.fn(),
  close: jest.fn(),
  ...overrides,
});

const sampleEntry: FileHistoryEntry = {
  id: 'abc123',
  shortId: 'abc123',
  message: 'Update note content',
  summary: 'Update note content',
  authorName: 'Test Author',
  authorEmail: 'test@example.com',
  authorTime: 1699876543,
  committerTime: 1699876543,
  parentCount: 1,
  parents: ['parent1'],
};

describe('NoteHistoryModal', () => {
  it('renders close button and calls onClose', () => {
    const onClose = jest.fn();
    const history = makeHistoryResult({ state: { status: 'idle' } });

    render(<NoteHistoryModal visible={true} history={history} onClose={onClose} />);

    const closeBtn = screen.getByTestId('note-history.button.close');
    expect(closeBtn).toBeTruthy();
    fireEvent.press(closeBtn);
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it('close button calls history.close then onClose', () => {
    const historyClose = jest.fn();
    const onClose = jest.fn();
    const history = makeHistoryResult({ state: { status: 'idle' }, close: historyClose });

    render(<NoteHistoryModal visible={true} history={history} onClose={onClose} />);

    fireEvent.press(screen.getByTestId('note-history.button.close'));
    expect(historyClose).toHaveBeenCalledTimes(1);
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it('edit button is disabled', () => {
    const history = makeHistoryResult();
    render(<NoteHistoryModal visible={true} history={history} onClose={jest.fn()} />);

    const editBtn = screen.getByTestId('note-history.button.edit');
    expect(editBtn).toBeTruthy();
    expect(editBtn.props.accessibilityState?.disabled).toBe(true);
  });

  it('shows loading state with activity indicator', () => {
    const history = makeHistoryResult({ state: { status: 'loading' } });
    render(<NoteHistoryModal visible={true} history={history} onClose={jest.fn()} />);
    expect(screen.getByText('noteHistory.loading')).toBeTruthy();
  });

  it('shows empty state with close button', () => {
    const onClose = jest.fn();
    const history = makeHistoryResult({ state: { status: 'empty', shallow: false } });
    render(<NoteHistoryModal visible={true} history={history} onClose={onClose} />);

    expect(screen.getByText('noteHistory.empty')).toBeTruthy();
    const closeBtn = screen.getByTestId('note-history.button.close-from-empty');
    fireEvent.press(closeBtn);
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it('shows unavailable state with reason message', () => {
    const history = makeHistoryResult({
      state: { status: 'unavailable', reason: 'NewNote' },
      unavailableReason: 'NewNote',
    });
    render(<NoteHistoryModal visible={true} history={history} onClose={jest.fn()} />);
    expect(screen.getByText('noteHistory.unavailable.NewNote')).toBeTruthy();
  });

  it('shows error state with error message', () => {
    const history = makeHistoryResult({
      state: { status: 'error', message: 'Git history unavailable' },
    });
    render(<NoteHistoryModal visible={true} history={history} onClose={jest.fn()} />);
    expect(screen.getByText('Git history unavailable')).toBeTruthy();
  });

  it('renders revision cards in ready state', () => {
    const entries: FileHistoryEntry[] = [
      { ...sampleEntry, id: 'commit1', summary: 'First commit' },
      { ...sampleEntry, id: 'commit2', summary: 'Second commit' },
    ];
    const history = makeHistoryResult({
      state: { status: 'ready', entries, shallow: false, hasMore: false },
    });
    render(<NoteHistoryModal visible={true} history={history} onClose={jest.fn()} />);

    expect(screen.getByTestId('note-history.card.0')).toBeTruthy();
    expect(screen.getByTestId('note-history.card.1')).toBeTruthy();
  });

  it('selected card has selected accessibility state', () => {
    const entries: FileHistoryEntry[] = [
      { ...sampleEntry, id: 'commit1', summary: 'First commit' },
      { ...sampleEntry, id: 'commit2', summary: 'Second commit' },
    ];
    const history = makeHistoryResult({
      state: { status: 'ready', entries, shallow: false, hasMore: false },
      selectedCommitId: 'commit1',
    });
    render(<NoteHistoryModal visible={true} history={history} onClose={jest.fn()} />);

    const card0 = screen.getByTestId('note-history.card.0');
    expect(card0.props.accessibilityState?.selected).toBe(true);
  });

  it('tapping a revision card calls selectCommit', () => {
    const selectCommit = jest.fn();
    const entries: FileHistoryEntry[] = [
      { ...sampleEntry, id: 'commit1', summary: 'First commit' },
      { ...sampleEntry, id: 'commit2', summary: 'Second commit' },
    ];
    const history = makeHistoryResult({
      state: { status: 'ready', entries, shallow: false, hasMore: false },
      selectCommit,
    });
    render(<NoteHistoryModal visible={true} history={history} onClose={jest.fn()} />);

    fireEvent.press(screen.getByTestId('note-history.card.1'));
    expect(selectCommit).toHaveBeenCalledWith('commit2');
  });

  it('shows selectable preview text when blob is loaded', () => {
    const history = makeHistoryResult({
      state: {
        status: 'ready',
        entries: [sampleEntry],
        shallow: false,
        hasMore: false,
      },
      selectedCommitId: 'abc123',
      selectedBlob: {
        kind: 'Content',
        content: '# Hello World\n\nThis is the note content.',
        oid: 'abc123',
        mimeType: 'text/markdown',
        truncated: false,
      },
    });
    render(<NoteHistoryModal visible={true} history={history} onClose={jest.fn()} />);

    const previewText = screen.getByTestId('note-history.preview.text');
    expect(previewText).toBeTruthy();
    expect(previewText.props.selectable).toBe(true);
    expect(previewText.props.children).toContain('# Hello World');
  });

  it('shows blob error message when blob read fails', () => {
    const history = makeHistoryResult({
      state: {
        status: 'ready',
        entries: [sampleEntry],
        shallow: false,
        hasMore: false,
      },
      selectedCommitId: 'abc123',
      selectedBlob: {
        kind: 'Error',
        errorKind: 'PathNotFound',
        message: 'File not found at this commit',
      },
    });
    render(<NoteHistoryModal visible={true} history={history} onClose={jest.fn()} />);
    expect(screen.getByText('noteHistory.blobError.PathNotFound')).toBeTruthy();
  });

  it('shows loading blob indicator when blob is loading', () => {
    const history = makeHistoryResult({
      state: {
        status: 'ready',
        entries: [sampleEntry],
        shallow: false,
        hasMore: false,
      },
      selectedCommitId: 'abc123',
      isLoadingBlob: true,
    });
    render(<NoteHistoryModal visible={true} history={history} onClose={jest.fn()} />);
    expect(screen.getByText('noteHistory.loadingBlob')).toBeTruthy();
  });

  it('calls loadHistory when modal becomes visible', () => {
    const loadHistory = jest.fn();
    const history = makeHistoryResult({ loadHistory });
    render(<NoteHistoryModal visible={true} history={history} onClose={jest.fn()} />);
    expect(loadHistory).toHaveBeenCalledTimes(1);
  });

  it('shows commit metadata when a commit is selected', () => {
    const entries: FileHistoryEntry[] = [
      { ...sampleEntry, id: 'abc123', message: 'Update note content', authorName: 'Jane Doe', authorTime: 1699876543 },
    ];
    const history = makeHistoryResult({
      state: { status: 'ready', entries, shallow: false, hasMore: false },
      selectedCommitId: 'abc123',
      selectedBlob: {
        kind: 'Content',
        content: 'Hello World',
        oid: 'abc123',
        mimeType: 'text/markdown',
        truncated: false,
      },
    });
    render(<NoteHistoryModal visible={true} history={history} onClose={jest.fn()} />);
    expect(screen.getAllByText('Update note content').length).toBeGreaterThanOrEqual(1);
    expect(screen.getByText(/Jane Doe/)).toBeTruthy();
    expect(screen.getByText(/abc123/)).toBeTruthy();
  });

  it('load more button calls loadMore when hasMore is true', () => {
    const loadMore = jest.fn();
    const entries: FileHistoryEntry[] = [{ ...sampleEntry, id: 'commit1' }];
    const history = makeHistoryResult({
      state: { status: 'ready', entries, shallow: false, hasMore: true },
      hasMore: true,
      loadMore,
    });
    render(<NoteHistoryModal visible={true} history={history} onClose={jest.fn()} />);

    const loadMoreBtn = screen.getByTestId('note-history.button.load-more');
    fireEvent.press(loadMoreBtn);
    expect(loadMore).toHaveBeenCalledTimes(1);
  });

  describe('dirty notice', () => {
    it('shows dirty notice when isDirty is true', () => {
      const history = makeHistoryResult({ isDirty: true });
      render(<NoteHistoryModal visible={true} history={history} onClose={jest.fn()} />);

      const notice = screen.getByTestId('note-history.notice.dirty');
      expect(notice).toBeTruthy();
      expect(screen.getByText('noteHistory.dirtyNotice')).toBeTruthy();
    });

    it('does not show dirty notice when isDirty is false', () => {
      const history = makeHistoryResult({ isDirty: false });
      render(<NoteHistoryModal visible={true} history={history} onClose={jest.fn()} />);

      expect(screen.queryByTestId('note-history.notice.dirty')).toBeNull();
    });

    it('does not show dirty notice when isDirty is not provided', () => {
      const history = makeHistoryResult();
      render(<NoteHistoryModal visible={true} history={history} onClose={jest.fn()} />);

      expect(screen.queryByTestId('note-history.notice.dirty')).toBeNull();
    });
  });

  describe('accessibility', () => {
    it('revision card has button accessibility role', () => {
      const entries: FileHistoryEntry[] = [
        { ...sampleEntry, id: 'commit1', summary: 'First commit' },
      ];
      const history = makeHistoryResult({
        state: { status: 'ready', entries, shallow: false, hasMore: false },
      });
      render(<NoteHistoryModal visible={true} history={history} onClose={jest.fn()} />);

      const card = screen.getByTestId('note-history.card.0');
      expect(card.props.accessibilityRole).toBe('button');
    });

    it('revision card has accessibilityLabel with date and summary', () => {
      const entries: FileHistoryEntry[] = [
        { ...sampleEntry, id: 'commit1', summary: 'First commit' },
      ];
      const history = makeHistoryResult({
        state: { status: 'ready', entries, shallow: false, hasMore: false },
      });
      render(<NoteHistoryModal visible={true} history={history} onClose={jest.fn()} />);

      const card = screen.getByTestId('note-history.card.0');
      const label = card.props.accessibilityLabel as string;
      expect(label).toContain('First commit');
    });

    it('edit button has disabled accessibilityState', () => {
      const history = makeHistoryResult();
      render(<NoteHistoryModal visible={true} history={history} onClose={jest.fn()} />);

      const editBtn = screen.getByTestId('note-history.button.edit');
      expect(editBtn.props.accessibilityState?.disabled).toBe(true);
    });

    it('close button has close accessibilityLabel', () => {
      const history = makeHistoryResult({ state: { status: 'idle' } });
      render(<NoteHistoryModal visible={true} history={history} onClose={jest.fn()} />);

      const closeBtn = screen.getByTestId('note-history.button.close');
      expect(closeBtn.props.accessibilityLabel).toBe('common.close');
    });
  });

  describe('preview content', () => {
    it('shows empty preview when no blob and no selection', () => {
      const history = makeHistoryResult({
        state: {
          status: 'ready',
          entries: [sampleEntry],
          shallow: false,
          hasMore: false,
        },
        selectedCommitId: null,
        selectedBlob: null,
      });
      render(<NoteHistoryModal visible={true} history={history} onClose={jest.fn()} />);

      expect(screen.getByText('noteHistory.noPreview')).toBeTruthy();
    });

    it('preview text has selectable prop enabled', () => {
      const history = makeHistoryResult({
        state: {
          status: 'ready',
          entries: [sampleEntry],
          shallow: false,
          hasMore: false,
        },
        selectedCommitId: 'abc123',
        selectedBlob: {
          kind: 'Content',
          content: '# Hello World\n',
          oid: 'abc123',
          mimeType: 'text/markdown',
          truncated: false,
        },
      });
      render(<NoteHistoryModal visible={true} history={history} onClose={jest.fn()} />);

      const previewText = screen.getByTestId('note-history.preview.text');
      expect(previewText.props.selectable).toBe(true);
    });
  });

  describe('position indicator', () => {
    it('shows position indicator with selected index and total', () => {
      const entries: FileHistoryEntry[] = [
        { ...sampleEntry, id: 'commit1', summary: 'First commit' },
        { ...sampleEntry, id: 'commit2', summary: 'Second commit' },
      ];
      const history = makeHistoryResult({
        state: { status: 'ready', entries, shallow: false, hasMore: false },
        selectedCommitId: 'commit2',
      });
      render(<NoteHistoryModal visible={true} history={history} onClose={jest.fn()} />);

      expect(screen.getByText('2 / 2')).toBeTruthy();
    });

    it('shows empty state instead of position indicator when no entries', () => {
      const history = makeHistoryResult({
        state: {
          status: 'empty',
          shallow: false,
        },
      });
      render(<NoteHistoryModal visible={true} history={history} onClose={jest.fn()} />);

      expect(screen.getByText('noteHistory.empty')).toBeTruthy();
    });
  });

  describe('close-from-error state', () => {
    it('shows error state with close button', () => {
      const onClose = jest.fn();
      const history = makeHistoryResult({
        state: { status: 'error', message: 'Git history unavailable' },
      });
      render(<NoteHistoryModal visible={true} history={history} onClose={onClose} />);

      const closeBtn = screen.getByTestId('note-history.button.close-from-error');
      fireEvent.press(closeBtn);
      expect(onClose).toHaveBeenCalledTimes(1);
    });
  });

  describe('close-from-unavailable state', () => {
    it('shows unavailable state with close button', () => {
      const onClose = jest.fn();
      const history = makeHistoryResult({
        state: { status: 'unavailable', reason: 'NewNote' },
        unavailableReason: 'NewNote',
      });
      render(<NoteHistoryModal visible={true} history={history} onClose={onClose} />);

      const closeBtn = screen.getByTestId('note-history.button.close-from-unavailable');
      fireEvent.press(closeBtn);
      expect(onClose).toHaveBeenCalledTimes(1);
    });
  });
});
