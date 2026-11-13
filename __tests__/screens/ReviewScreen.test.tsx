import React from 'react';
import { act, fireEvent, render, waitFor } from '@testing-library/react-native';

import ReviewScreen from '@/screens/ReviewScreen';
import { bridgeTools, type GitStatus } from '@/services/agent/bridgeTools';
import { BridgeError } from '@/services/agent/types';
import { HapticService } from '@/utils/haptics';

jest.mock('@/services/agent/bridgeTools', () => ({
  bridgeTools: {
    features: jest.fn(),
    gitStatus: jest.fn(),
    gitDiff: jest.fn(),
    gitStage: jest.fn(),
    gitUnstage: jest.fn(),
    gitCommit: jest.fn(),
    listPorts: jest.fn(),
    searchFiles: jest.fn(),
  },
}));
jest.mock('@/utils/haptics', () => ({ HapticService: { success: jest.fn(), error: jest.fn() } }));
jest.mock('@/hooks/useSafeBack', () => ({ useSafeBack: () => jest.fn() }));
jest.mock('@react-navigation/native', () => ({
  useRoute: () => ({ params: { bridgeId: 'b1', cwd: '/home/me/proj' } }),
}));

const tools = bridgeTools as jest.Mocked<typeof bridgeTools>;

const status: GitStatus = {
  branch: 'main',
  ahead: 2,
  behind: 1,
  files: [
    { path: 'staged.ts', status: 'added', staged: true, unstaged: false },
    { path: 'edit.ts', status: 'modified', staged: false, unstaged: true },
    { path: 'new.txt', status: 'untracked', staged: false, unstaged: false },
  ],
};

const flush = () => act(async () => {});

describe('ReviewScreen', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    tools.gitStatus.mockResolvedValue(status);
    tools.gitStage.mockResolvedValue();
    tools.gitUnstage.mockResolvedValue();
    tools.gitDiff.mockResolvedValue({ path: 'edit.ts', staged: false, truncated: false, patch: '@@ -1 +1 @@\n-a\n+b\n' });
  });

  it('shows sections, branch and a diff on tap', async () => {
    const { getByTestId, getByText } = render(<ReviewScreen />);
    await flush();
    expect(getByTestId('review.section.staged')).toBeTruthy();
    expect(getByTestId('review.section.changes')).toBeTruthy();
    expect(getByTestId('review.section.untracked')).toBeTruthy();
    expect(getByText('main ↑2 ↓1')).toBeTruthy();
    expect(getByTestId('review.glyph.new.txt').props.children).toBe('?');

    fireEvent.press(getByTestId('review.file-toggle.changes.edit.ts'));
    await flush();
    expect(tools.gitDiff).toHaveBeenCalledWith('b1', '/home/me/proj', 'edit.ts', false);
    expect(getByTestId('review.patch.line.add')).toBeTruthy();
    expect(getByTestId('review.patch.line.del')).toBeTruthy();
  });

  it('stages, unstages and bulk-stages, refreshing status each time', async () => {
    const { getByTestId } = render(<ReviewScreen />);
    await flush();
    fireEvent.press(getByTestId('review.file-action.changes.edit.ts'));
    await flush();
    expect(tools.gitStage).toHaveBeenCalledWith('b1', '/home/me/proj', ['edit.ts']);
    fireEvent.press(getByTestId('review.file-action.staged.staged.ts'));
    await flush();
    expect(tools.gitUnstage).toHaveBeenCalledWith('b1', '/home/me/proj', ['staged.ts']);
    fireEvent.press(getByTestId('review.stage-all'));
    await flush();
    expect(tools.gitStage).toHaveBeenLastCalledWith('b1', '/home/me/proj', ['edit.ts']);
    fireEvent.press(getByTestId('review.unstage-all'));
    await flush();
    expect(tools.gitUnstage).toHaveBeenLastCalledWith('b1', '/home/me/proj', ['staged.ts']);
    expect(tools.gitStatus).toHaveBeenCalledTimes(5);
  });

  it('commits only with staged files and a message, then clears and refreshes', async () => {
    tools.gitCommit.mockResolvedValue({ hash: 'abc', summary: 'x' });
    const { getByTestId } = render(<ReviewScreen />);
    await flush();
    expect(getByTestId('review.commit').props.accessibilityState.disabled).toBe(true);
    fireEvent.changeText(getByTestId('review.commit-message'), '  fix thing  ');
    await flush();
    fireEvent.press(getByTestId('review.commit'));
    await flush();
    expect(tools.gitCommit).toHaveBeenCalledWith('b1', '/home/me/proj', 'fix thing');
    expect(HapticService.success).toHaveBeenCalled();
    expect(getByTestId('review.commit-message').props.value).toBe('');
    expect(tools.gitStatus).toHaveBeenCalledTimes(2);
  });

  it('does not commit with an empty message', async () => {
    const { getByTestId } = render(<ReviewScreen />);
    await flush();
    expect(getByTestId('review.commit').props.accessibilityState.disabled).toBe(true);
    fireEvent.changeText(getByTestId('review.commit-message'), 'msg');
    await flush();
    expect(getByTestId('review.commit').props.accessibilityState.disabled).toBe(false);
  });

  it('shows git failure messages in a banner', async () => {
    tools.gitCommit.mockRejectedValue(new BridgeError('unknown', 'nothing to commit hooks failed', 'git-failed'));
    const { getByTestId } = render(<ReviewScreen />);
    await flush();
    fireEvent.changeText(getByTestId('review.commit-message'), 'msg');
    await flush();
    fireEvent.press(getByTestId('review.commit'));
    await flush();
    expect(getByTestId('review.banner').props.children).toBe('nothing to commit hooks failed');
    expect(HapticService.error).toHaveBeenCalled();
  });

  it('renders the clean state', async () => {
    tools.gitStatus.mockResolvedValue({ ...status, files: [] });
    const { getByTestId, queryByTestId } = render(<ReviewScreen />);
    await flush();
    expect(getByTestId('review.clean')).toBeTruthy();
    expect(queryByTestId('review.commit')).toBeNull();
  });

  it('renders not-a-repo and unsupported states', async () => {
    tools.gitStatus.mockRejectedValue(new BridgeError('unknown', 'no', 'not-a-repo'));
    const first = render(<ReviewScreen />);
    await flush();
    expect(first.getByTestId('review.notARepo')).toBeTruthy();
    first.unmount();

    tools.gitStatus.mockRejectedValue(new BridgeError('unknown', 'old', 'unsupported'));
    const second = render(<ReviewScreen />);
    await flush();
    expect(second.getByTestId('review.unsupported')).toBeTruthy();
  });

  it('retries after a generic load failure', async () => {
    tools.gitStatus.mockRejectedValueOnce(new BridgeError('unreachable', 'offline'));
    const { getByTestId } = render(<ReviewScreen />);
    await flush();
    expect(getByTestId('review.error')).toBeTruthy();
    fireEvent.press(getByTestId('review.retry'));
    await waitFor(() => expect(getByTestId('review.section.staged')).toBeTruthy());
  });

  it('refreshes on pull-to-refresh', async () => {
    const { getByTestId } = render(<ReviewScreen />);
    await flush();
    await act(async () => {
      getByTestId('review.scroll').props.refreshControl.props.onRefresh();
    });
    expect(tools.gitStatus).toHaveBeenCalledTimes(2);
  });
});
