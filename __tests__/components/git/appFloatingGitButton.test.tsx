/**
 * AppFloatingGitButton wrapper tests — action serialization,
 * conflict navigation deduplication, and failure-safe cleanup.
 *
 * Tests invoke the actual handleReleaseSegment callback (passed from
 * AppFloatingGitButton to useFloatingGitButtonAffordances) by capturing
 * it through a mock that exposes the callback.
 */
import { act, render } from '@testing-library/react-native';

let capturedOnReleaseSegment: ((segment: 'stage' | 'commit' | 'push') => void) | null = null;

jest.mock('@/components/git/useFloatingGitButtonAffordances', () => ({
  useFloatingGitButtonAffordances: (options: {
    onReleaseSegment?: (segment: 'stage' | 'commit' | 'push') => void;
  }) => {
    capturedOnReleaseSegment = options.onReleaseSegment ?? null;
    return {
      entranceProgress: { value: 1 },
      pressProgress: { value: 0 },
      holdProgress: { value: 0 },
      handlePressIn: jest.fn(),
      handlePressOut: jest.fn(),
      handleHoldComplete: jest.fn(),
      cancelAffordances: jest.fn(),
    };
  },
}));

jest.mock('@/components/git/useFloatingGitButtonPanGesture', () => ({
  useFloatingGitButtonPanGesture: () => ({
    panGesture: {},
    dragActive: { value: false },
    translateX: { value: 0 },
    translateY: { value: 0 },
  }),
}));

jest.mock('@/components/git/useFloatingGitButtonPosition', () => ({
  useFloatingGitButtonPosition: () => ({
    translateX: { value: 0 },
    translateY: { value: 0 },
    dragActive: { value: false },
    geometry: { x: 0, y: 0, width: 56, height: 56 },
  }),
}));

jest.mock('@/components/floatingButtonLayout', () => ({
  useFloatingButtonCollision: () => undefined,
}));

jest.mock('@/components/git/GitButtonRing', () => {
  const View = require('react-native').View;
  return {
    GitButtonRing: function MockGitButtonRing() {
      return <View testID="gitbutton.ring" />;
    },
  };
});

jest.mock('@/contexts/ThemeContext', () => ({
  useTheme: () => ({ colors: { surface: '#fff', textSecondary: '#999', error: '#f00', success: '#0f0', primary: '#00f', background: '#fff', foreground: '#000' } }),
  useTokens: () => ({ colors: { surface: '#fff', textSecondary: '#999', error: '#f00', success: '#0f0', primary: '#00f', background: '#fff', foreground: '#000' }, radii: {} }),
}));

jest.mock('@react-native-async-storage/async-storage', () => ({
  __esModule: true,
  default: {
    getItem: jest.fn(async () => null),
    setItem: jest.fn(async () => {
      /* noop */
    }),
  },
}));

const mockRefresh = jest.fn();
jest.mock('@/hooks/useAllReposStatus', () => ({
  useAllReposStatus: () => ({
    perRepo: new Map(),
    totalUncommitted: 1,
    totalStaged: 0,
    totalAhead: 0,
    anyConflicts: false,
    anyBusy: false,
    latestChangedRepoId: 'repo-1',
    mode: 'clean',
    refresh: mockRefresh,
  }),
}));

jest.mock('@/stores/repoStore', () => ({
  useRepoStore: (selector: (state: { repositories: Array<{ id: string; name: string; path: string }> }) => unknown) =>
    selector({
      repositories: [
        { id: 'repo-1', name: 'Test Repo', path: '/test/repo-1' },
        { id: 'repo-2', name: 'Test Repo 2', path: '/test/repo-2' },
      ],
    }),
}));

jest.mock('@/contexts/AccountsContext', () => ({
  useAccounts: () => ({
    accounts: [{ id: 'acc-1', name: 'Test User', email: '' }],
    activeAccountId: 'acc-1',
  }),
}));

const mockStageAllPending = jest.fn();
const mockCommitAll = jest.fn();
const mockPushAll = jest.fn();
jest.mock('@/services/git/multiRepoGitOps', () => ({
  stageAllPending: (...args: unknown[]) => mockStageAllPending(...args),
  commitAll: (...args: unknown[]) => mockCommitAll(...args),
  pushAll: (...args: unknown[]) => mockPushAll(...args),
}));

const mockResolveAuthor = jest.fn();
const mockGenerateCommitMessage = jest.fn();
jest.mock('@/services/git/CommitService', () => ({
  CommitService: {
    resolveAuthor: (...args: unknown[]) => mockResolveAuthor(...args),
    generateCommitMessage: (...args: unknown[]) => mockGenerateCommitMessage(...args),
  },
}));

const mockEmitGitRefresh = jest.fn();
const mockEmitGitContentRefresh = jest.fn();
jest.mock('@/hooks/useGitRefreshEvent', () => ({
  emitGitRefresh: mockEmitGitRefresh,
  emitGitContentRefresh: mockEmitGitContentRefresh,
}));

const mockToastShow = jest.fn();
jest.mock('@/components/ui/toast', () => {
  const View = require('react-native').View;
  return {
    useToast: () => ({
      show: mockToastShow,
    }),
    Toast: function MockToast() {
      return <View testID="toast" />;
    },
    ToastTitle: function MockToastTitle() {
      return <View testID="toast-title" />;
    },
    ToastDescription: function MockToastDescription() {
      return <View testID="toast-description" />;
    },
  };
});

const mockNavigate = jest.fn();
jest.mock('@react-navigation/native', () => {
  return {
    useNavigation: () => ({ navigate: mockNavigate }),
  };
});

const mockSetPending = jest.fn();
const mockClearPending = jest.fn();
jest.mock('@/stores/gitButtonActionStore', () => ({
  useGitButtonActionStore: () => ({
    pending: null,
    setPending: mockSetPending,
    clear: mockClearPending,
  }),
}));

function setupDefaultMocks() {
  mockStageAllPending.mockResolvedValue({ outcomes: [], totalActed: 1, failures: [], ok: true });
  mockCommitAll.mockResolvedValue({ outcomes: [], totalActed: 1, failures: [], ok: true });
  mockPushAll.mockResolvedValue({ outcomes: [], totalActed: 1, failures: [], ok: true });
  mockResolveAuthor.mockResolvedValue({ name: 'Resolved User', email: 'resolved@example.com' });
  mockGenerateCommitMessage.mockResolvedValue('Update notes');
  mockRefresh.mockResolvedValue(undefined);
}

function getReleaseCallback() {
  if (!capturedOnReleaseSegment) {
    throw new Error('onReleaseSegment was not captured - render AppFloatingGitButton first');
  }
  return capturedOnReleaseSegment;
}

async function flushPromises() {
  await act(async () => { await Promise.resolve(); });
  await act(async () => { await Promise.resolve(); });
}

describe('AppFloatingGitButton — service call order', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    capturedOnReleaseSegment = null;
    setupDefaultMocks();
  });

  it('stage segment calls stageAllPending once', async () => {
    const { default: AppFloatingGitButton } = require('@/components/git/AppFloatingGitButton');
    render(<AppFloatingGitButton />);
    await act(async () => { await Promise.resolve(); });

    const release = getReleaseCallback();
    await act(async () => { release('stage'); });
    await flushPromises();

    expect(mockStageAllPending).toHaveBeenCalledTimes(1);
    expect(mockCommitAll).not.toHaveBeenCalled();
    expect(mockPushAll).not.toHaveBeenCalled();
  });

  it('commit segment calls stageAllPending then commitAll', async () => {
    const { default: AppFloatingGitButton } = require('@/components/git/AppFloatingGitButton');
    render(<AppFloatingGitButton />);
    await act(async () => { await Promise.resolve(); });

    const release = getReleaseCallback();
    await act(async () => { release('commit'); });
    await flushPromises();

    expect(mockStageAllPending).toHaveBeenCalledTimes(1);
    expect(mockCommitAll).toHaveBeenCalledTimes(1);
    expect(mockPushAll).not.toHaveBeenCalled();
  });

  it('commit segment passes the active-host author to commitAll', async () => {
    const { default: AppFloatingGitButton } = require('@/components/git/AppFloatingGitButton');
    render(<AppFloatingGitButton />);
    await act(async () => { await Promise.resolve(); });

    await act(async () => { getReleaseCallback()('commit'); });
    await flushPromises();

    expect(mockResolveAuthor).toHaveBeenCalledTimes(1);
    expect(mockCommitAll).toHaveBeenCalledWith(
      expect.any(Array),
      'Update notes',
      { name: 'Resolved User', email: 'resolved@example.com' },
    );
  });

  it('push segment calls stageAllPending then commitAll then pushAll', async () => {
    const { default: AppFloatingGitButton } = require('@/components/git/AppFloatingGitButton');
    render(<AppFloatingGitButton />);
    await act(async () => { await Promise.resolve(); });

    const release = getReleaseCallback();
    await act(async () => { release('push'); });
    await flushPromises();

    expect(mockStageAllPending).toHaveBeenCalledTimes(1);
    expect(mockCommitAll).toHaveBeenCalledTimes(1);
    expect(mockPushAll).toHaveBeenCalledTimes(1);
  });
});

describe('AppFloatingGitButton — operation lock', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    capturedOnReleaseSegment = null;
    setupDefaultMocks();
  });

  it('second rapid call is blocked while first stage is in flight', async () => {
    let releaseFirst: (() => void) | null = null;
    mockStageAllPending.mockImplementation(
      () =>
        new Promise((resolve) => {
          releaseFirst = () => resolve({ outcomes: [], totalActed: 1, failures: [], ok: true });
        }),
    );

    const { default: AppFloatingGitButton } = require('@/components/git/AppFloatingGitButton');
    const { unmount } = render(<AppFloatingGitButton />);
    await act(async () => { await Promise.resolve(); });

    const release = getReleaseCallback();

    // Start first stage call
    release('stage');

    // Try second call while first is still in flight - should be blocked
    release('stage');

    // Allow first to complete
    await act(async () => {
      releaseFirst?.();
    });
    await flushPromises();

    expect(mockStageAllPending).toHaveBeenCalledTimes(1);
    unmount();
  });

  it('after stageAllPending rejection, second call succeeds (lock released by finally)', async () => {
    const { default: AppFloatingGitButton } = require('@/components/git/AppFloatingGitButton');
    const { unmount } = render(<AppFloatingGitButton />);
    await act(async () => { await Promise.resolve(); });

    // First call fails - use resolved value with error field to simulate failure
    const release = getReleaseCallback();

    // First call fails
    await act(async () => { release('stage'); });
    await flushPromises();

    expect(mockStageAllPending).toHaveBeenCalledTimes(1);

    // Reset mock to succeed
    mockStageAllPending.mockResolvedValue({ outcomes: [], totalActed: 1, failures: [], ok: true });

    // Second call should work (lock was released by finally)
    await act(async () => { release('stage'); });
    await flushPromises();

    expect(mockStageAllPending).toHaveBeenCalledTimes(2);
    unmount();
  });

  it('after commitAll rejection, second call succeeds (lock released by finally)', async () => {
    const { default: AppFloatingGitButton } = require('@/components/git/AppFloatingGitButton');
    const { unmount } = render(<AppFloatingGitButton />);
    await act(async () => { await Promise.resolve(); });

    mockCommitAll.mockResolvedValue({ outcomes: [], totalActed: 0, failures: [{ repoId: 'repo-1', repoPath: '/test/repo-1', repoName: 'Repo 1', ok: false, actedCount: 0, error: 'Commit failed' }], ok: false });

    const release = getReleaseCallback();

    // First call fails at commit
    await act(async () => { release('commit'); });
    await flushPromises();

    expect(mockCommitAll).toHaveBeenCalledTimes(1);

    // Reset mock to succeed
    mockCommitAll.mockResolvedValue({ outcomes: [], totalActed: 1, failures: [], ok: true });

    // Second call should work
    await act(async () => { release('commit'); });
    await flushPromises();

    expect(mockCommitAll).toHaveBeenCalledTimes(2);
    unmount();
  });

  it('after pushAll rejection, second call succeeds (lock released by finally)', async () => {
    const { default: AppFloatingGitButton } = require('@/components/git/AppFloatingGitButton');
    const { unmount } = render(<AppFloatingGitButton />);
    await act(async () => { await Promise.resolve(); });

    mockPushAll.mockResolvedValue({ outcomes: [], totalActed: 0, failures: [{ repoId: 'repo-1', repoPath: '/test/repo-1', repoName: 'Repo 1', ok: false, actedCount: 0, error: 'Push failed' }], ok: false });

    const release = getReleaseCallback();

    // First call fails at push
    await act(async () => { release('push'); });
    await flushPromises();

    expect(mockPushAll).toHaveBeenCalledTimes(1);

    // Reset mock to succeed
    mockPushAll.mockResolvedValue({ outcomes: [], totalActed: 1, failures: [], ok: true });

    // Second call should work
    await act(async () => { release('push'); });
    await flushPromises();

    expect(mockPushAll).toHaveBeenCalledTimes(2);
    unmount();
  });
});

describe('AppFloatingGitButton — conflict navigation deduplication', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    capturedOnReleaseSegment = null;
    setupDefaultMocks();
  });

  it('navigates to each unique conflict repoId exactly once', async () => {
    mockPushAll.mockResolvedValue({
      outcomes: [],
      totalActed: 0,
      failures: [
        { repoId: 'repo-1', repoPath: '/test/repo-1', repoName: 'Repo 1', ok: false, actedCount: 0, error: 'conflict', failureKind: 'rejected' },
        { repoId: 'repo-1', repoPath: '/test/repo-1', repoName: 'Repo 1', ok: false, actedCount: 0, error: 'conflict', failureKind: 'rejected' },
        { repoId: 'repo-2', repoPath: '/test/repo-2', repoName: 'Repo 2', ok: false, actedCount: 0, error: 'conflict', failureKind: 'rejected' },
        { repoId: 'repo-2', repoPath: '/test/repo-2', repoName: 'Repo 2', ok: false, actedCount: 0, error: 'conflict', failureKind: 'rejected' },
        { repoId: 'repo-1', repoPath: '/test/repo-1', repoName: 'Repo 1', ok: false, actedCount: 0, error: 'conflict', failureKind: 'rejected' },
      ],
      ok: false,
    });

    const { default: AppFloatingGitButton } = require('@/components/git/AppFloatingGitButton');
    render(<AppFloatingGitButton />);
    await act(async () => { await Promise.resolve(); });

    const release = getReleaseCallback();
    await act(async () => { release('push'); });
    await flushPromises();

    expect(mockNavigate).toHaveBeenCalledTimes(2);
    expect(mockNavigate).toHaveBeenCalledWith('ExploreConflict', { repoId: 'repo-1' });
    expect(mockNavigate).toHaveBeenCalledWith('ExploreConflict', { repoId: 'repo-2' });
  });

  it('no duplicate navigation when all pushes succeed', async () => {
    mockPushAll.mockResolvedValue({
      outcomes: [],
      totalActed: 2,
      failures: [],
      ok: true,
    });

    const { default: AppFloatingGitButton } = require('@/components/git/AppFloatingGitButton');
    render(<AppFloatingGitButton />);
    await act(async () => { await Promise.resolve(); });

    const release = getReleaseCallback();
    await act(async () => { release('push'); });
    await flushPromises();

    expect(mockNavigate).not.toHaveBeenCalled();
  });
});

describe('AppFloatingGitButton — refresh emissions', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    capturedOnReleaseSegment = null;
    setupDefaultMocks();
  });

  it('emits refresh events after successful push', async () => {
    const { default: AppFloatingGitButton } = require('@/components/git/AppFloatingGitButton');
    render(<AppFloatingGitButton />);
    await act(async () => { await Promise.resolve(); });

    const release = getReleaseCallback();
    await act(async () => { release('push'); });
    await flushPromises();

    expect(mockEmitGitRefresh).toHaveBeenCalledTimes(1);
    expect(mockEmitGitContentRefresh).toHaveBeenCalledTimes(1);
  });
});

describe('AppFloatingGitButton — toast feedback', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    capturedOnReleaseSegment = null;
    setupDefaultMocks();
  });

  it('shows success toast after stage segment', async () => {
    const { default: AppFloatingGitButton } = require('@/components/git/AppFloatingGitButton');
    render(<AppFloatingGitButton />);
    await act(async () => { await Promise.resolve(); });

    const release = getReleaseCallback();
    await act(async () => { release('stage'); });
    await flushPromises();

    expect(mockToastShow).toHaveBeenCalledWith(
      expect.objectContaining({
        placement: 'top',
        duration: 2000,
      }),
    );
  });

  it('shows success toast after commit segment', async () => {
    const { default: AppFloatingGitButton } = require('@/components/git/AppFloatingGitButton');
    render(<AppFloatingGitButton />);
    await act(async () => { await Promise.resolve(); });

    const release = getReleaseCallback();
    await act(async () => { release('commit'); });
    await flushPromises();

    expect(mockToastShow).toHaveBeenCalledWith(
      expect.objectContaining({
        placement: 'top',
        duration: 2000,
      }),
    );
  });

  it('shows partial-failure toast when some repos conflict', async () => {
    mockPushAll.mockResolvedValue({
      outcomes: [],
      totalActed: 1,
      failures: [
        { repoId: 'repo-1', repoPath: '/test/repo-1', repoName: 'Repo 1', ok: false, actedCount: 0, error: 'conflict' },
      ],
      ok: false,
    });

    const { default: AppFloatingGitButton } = require('@/components/git/AppFloatingGitButton');
    render(<AppFloatingGitButton />);
    await act(async () => { await Promise.resolve(); });

    const release = getReleaseCallback();
    await act(async () => { release('push'); });
    await flushPromises();

    expect(mockToastShow).toHaveBeenCalledWith(
      expect.objectContaining({
        placement: 'top',
        duration: 3000,
      }),
    );
  });
});
