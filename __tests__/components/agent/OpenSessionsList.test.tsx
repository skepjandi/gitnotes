import React from 'react';
import { fireEvent, render, waitFor } from '@testing-library/react-native';

import { OpenSessionsList } from '@/components/agent/OpenSessionsList';
import { BridgeError, type AgentBridge, type BridgeSessionInfo } from '@/services/agent/types';

const mockListSessions = jest.fn();
const mockAdopt = jest.fn();
const mockFindThreads = jest.fn();

jest.mock('@/services/agent/bridgeTools', () => ({
  bridgeTools: { listSessions: (...args: unknown[]) => mockListSessions(...args) },
}));
jest.mock('@/services/chat', () => ({
  adoptAgentSession: (...args: unknown[]) => mockAdopt(...args),
  findAgentThreadIdsByConnection: (...args: unknown[]) => mockFindThreads(...args),
}));

const bridge: AgentBridge = { id: 'b1', name: 'Dev box', url: 'wss://dev.example.net', addedAt: 1 };

function session(overrides: Partial<BridgeSessionInfo> = {}): BridgeSessionInfo {
  return {
    connectionId: 'c1',
    agentId: 'claude',
    agentName: 'Claude Code',
    cwd: '/code/app',
    sessionId: 's1',
    startedAt: Date.now() - 5 * 60_000,
    headSeq: 3,
    attached: false,
    ...overrides,
  };
}

function renderList(props: Partial<React.ComponentProps<typeof OpenSessionsList>> = {}) {
  const onOpenThread = jest.fn();
  const utils = render(<OpenSessionsList bridge={bridge} refreshToken={0} onOpenThread={onOpenThread} {...props} />);
  return { ...utils, onOpenThread };
}

describe('OpenSessionsList', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockFindThreads.mockResolvedValue(new Map());
  });

  it('renders a row per open session and adopts then opens the thread on tap', async () => {
    mockListSessions.mockResolvedValue([session()]);
    mockAdopt.mockResolvedValue({ id: 'thread-1' });
    const { findByTestId, onOpenThread, getByText } = renderList();

    fireEvent.press(await findByTestId('open-sessions.row.c1'));

    await waitFor(() => expect(onOpenThread).toHaveBeenCalledWith('thread-1'));
    expect(mockAdopt).toHaveBeenCalledWith(bridge, expect.objectContaining({ connectionId: 'c1' }));
    expect(getByText('Claude Code')).toBeTruthy();
  });

  it('marks sessions that are in use and sessions that already have a local thread', async () => {
    mockListSessions.mockResolvedValue([
      session({ connectionId: 'c1', attached: true }),
      session({ connectionId: 'c2', cwd: '/code/notes' }),
    ]);
    mockFindThreads.mockResolvedValue(new Map([['c2', 'thread-2']]));
    const { findByTestId, queryByTestId } = renderList();

    expect(await findByTestId('open-sessions.in-use.c1')).toBeTruthy();
    expect(queryByTestId('open-sessions.in-use.c2')).toBeNull();
    expect(await findByTestId('open-sessions.thread.c2')).toBeTruthy();
    expect(queryByTestId('open-sessions.thread.c1')).toBeNull();
  });

  it('omits sessions that have no cwd or session id yet', async () => {
    mockListSessions.mockResolvedValue([session({ connectionId: 'c1', cwd: null }), session({ connectionId: 'c2', sessionId: null })]);
    const { queryByTestId } = renderList();

    await waitFor(() => expect(mockFindThreads).toHaveBeenCalled());
    expect(queryByTestId('open-sessions.b1')).toBeNull();
  });

  it('renders nothing when the bridge lacks the sessions feature', async () => {
    mockListSessions.mockRejectedValue(new BridgeError('unknown', 'unsupported', 'unsupported'));
    const { queryByTestId } = renderList();

    await waitFor(() => expect(mockListSessions).toHaveBeenCalled());
    expect(queryByTestId('open-sessions.b1')).toBeNull();
    expect(queryByTestId('open-sessions.error.b1')).toBeNull();
  });

  it('renders nothing when the bridge is unreachable', async () => {
    mockListSessions.mockRejectedValue(new BridgeError('unreachable', 'down'));
    const { queryByTestId } = renderList();

    await waitFor(() => expect(mockListSessions).toHaveBeenCalled());
    expect(queryByTestId('open-sessions.b1')).toBeNull();
  });

  it('shows a small inline error for other failures', async () => {
    mockListSessions.mockRejectedValue(new BridgeError('unknown', 'boom'));
    const { findByTestId } = renderList();

    expect(await findByTestId('open-sessions.error.b1')).toBeTruthy();
  });

  it('reloads when the refresh token changes', async () => {
    mockListSessions.mockResolvedValue([session()]);
    const { findByTestId, rerender, onOpenThread } = renderList();
    await findByTestId('open-sessions.row.c1');

    rerender(<OpenSessionsList bridge={bridge} refreshToken={1} onOpenThread={onOpenThread} />);

    await waitFor(() => expect(mockListSessions).toHaveBeenCalledTimes(2));
  });

  it('keeps the list and shows the error when adopting fails', async () => {
    mockListSessions.mockResolvedValue([session()]);
    mockAdopt.mockRejectedValue(new Error('no session'));
    const { findByTestId, getByText, onOpenThread } = renderList();

    fireEvent.press(await findByTestId('open-sessions.row.c1'));

    expect(await findByTestId('open-sessions.open-error.b1')).toBeTruthy();
    expect(getByText('no session')).toBeTruthy();
    expect(onOpenThread).not.toHaveBeenCalled();
  });
});
