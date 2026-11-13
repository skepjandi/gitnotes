import React from 'react';
import { act, fireEvent, render, waitFor } from '@testing-library/react-native';

import { NewChatPicker } from '@/components/agent/NewChatPicker';
import { BridgeError } from '@/services/agent/types';
import { useAgentBridgeStore } from '@/stores/agentBridgeStore';

const mockListBridgeAgents = jest.fn();
const mockListWorkspaces = jest.fn();
const mockCreateAgentThread = jest.fn();
const mockCreateDemoThread = jest.fn();
const mockListSessions = jest.fn();
const mockAdoptAgentSession = jest.fn();

jest.mock('@/services/agent/bridgeApi', () => ({
  listBridgeAgents: (...args: unknown[]) => mockListBridgeAgents(...args),
  listWorkspaces: (...args: unknown[]) => mockListWorkspaces(...args),
}));
jest.mock('@/services/agent/bridgeTools', () => ({
  bridgeTools: { listSessions: (...args: unknown[]) => mockListSessions(...args) },
}));
jest.mock('@/services/chat', () => ({
  adoptAgentSession: (...args: unknown[]) => mockAdoptAgentSession(...args),
  findAgentThreadIdsByConnection: () => Promise.resolve(new Map()),
  createAgentThread: (...args: unknown[]) => mockCreateAgentThread(...args),
  createDemoThread: () => mockCreateDemoThread(),
}));

const bridge = { id: 'b1', name: 'Dev box', url: 'wss://dev.example.net', addedAt: 1 };
const agents = [
  { id: 'claude', name: 'Claude Code', available: true, command: 'npx -y @agentclientprotocol/claude-agent-acp' },
  { id: 'pi', name: 'Pi', available: false, command: 'npx -y pi-acp' },
];
const workspaces = [
  { path: '/code', name: 'code', isRoot: true },
  { path: '/code/app', name: 'app', isRoot: false },
  { path: '/code/notes', name: 'notes', isRoot: false },
];

function renderPicker() {
  const handlers = { onClose: jest.fn(), onSelectModel: jest.fn(), onAgentThreadCreated: jest.fn() };
  const utils = render(<NewChatPicker visible {...handlers} />);
  return { ...utils, ...handlers };
}

describe('NewChatPicker', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockListBridgeAgents.mockResolvedValue({ hostname: 'dev', bridgeVersion: '1', agents, roots: ['/code'] });
    mockListWorkspaces.mockResolvedValue(workspaces);
    mockCreateAgentThread.mockResolvedValue({ id: 'thread-9' });
    mockListSessions.mockResolvedValue([]);
    useAgentBridgeStore.setState({ bridges: [bridge], setLastWorkspace: jest.fn() });
  });

  it('offers the in-app model and routes to it', async () => {
    const { getByTestId, onSelectModel } = renderPicker();

    fireEvent.press(getByTestId('new-chat-picker.model'));

    expect(onSelectModel).toHaveBeenCalledTimes(1);
    await waitFor(() => expect(getByTestId('new-chat-picker.agent.b1.claude')).toBeTruthy());
  });

  it('lists open sessions first and continues one', async () => {
    mockListSessions.mockResolvedValue([
      {
        connectionId: 'c1',
        agentId: 'claude',
        agentName: 'Claude Code',
        cwd: '/code/app',
        sessionId: 's1',
        startedAt: Date.now(),
        headSeq: 2,
        attached: false,
      },
    ]);
    mockAdoptAgentSession.mockResolvedValue({ id: 'thread-adopted' });
    const { findByTestId, onAgentThreadCreated } = renderPicker();

    fireEvent.press(await findByTestId('open-sessions.row.c1'));

    await waitFor(() => expect(onAgentThreadCreated).toHaveBeenCalledWith('thread-adopted'));
    expect(mockAdoptAgentSession).toHaveBeenCalledWith(bridge, expect.objectContaining({ connectionId: 'c1' }));
  });

  it('shows no open-sessions group when the bridge has none', async () => {
    const { findByTestId, queryByTestId } = renderPicker();

    await findByTestId('new-chat-picker.agent.b1.claude');
    expect(queryByTestId('open-sessions.b1')).toBeNull();
  });

  it('creates a demo thread without any bridge and reports it', async () => {
    useAgentBridgeStore.setState({ bridges: [] });
    mockCreateDemoThread.mockResolvedValue({ id: 'demo-1' });
    const { getByTestId, onAgentThreadCreated } = renderPicker();

    fireEvent.press(getByTestId('new-chat-picker.demo'));

    await waitFor(() => expect(onAgentThreadCreated).toHaveBeenCalledWith('demo-1'));
    expect(mockListBridgeAgents).not.toHaveBeenCalled();
  });

  it('lists agents per bridge and disables the ones that are not installed on the host', async () => {
    const { findByTestId } = renderPicker();

    const available = await findByTestId('new-chat-picker.agent.b1.claude');
    const missing = await findByTestId('new-chat-picker.agent.b1.pi');

    expect(available.props.accessibilityState?.disabled).toBeFalsy();
    expect(missing.props.accessibilityState?.disabled).toBe(true);
  });

  it('shows a retryable error for an unreachable bridge without hiding the model option', async () => {
    mockListBridgeAgents.mockRejectedValueOnce(new BridgeError('unreachable', 'down'));
    const { findByTestId, getByTestId } = renderPicker();

    expect(await findByTestId('new-chat-picker.error.b1')).toBeTruthy();
    expect(getByTestId('new-chat-picker.model')).toBeTruthy();
  });

  it('creates the agent thread for the chosen agent and workspace', async () => {
    const setLastWorkspace = jest.fn();
    useAgentBridgeStore.setState({ setLastWorkspace });
    const { findByTestId, onAgentThreadCreated } = renderPicker();

    fireEvent.press(await findByTestId('new-chat-picker.agent.b1.claude'));
    fireEvent.press(await findByTestId('new-chat-picker.workspace./code/app'));

    await waitFor(() => expect(onAgentThreadCreated).toHaveBeenCalledWith('thread-9'));
    expect(mockListWorkspaces).toHaveBeenCalledWith('b1', expect.any(AbortSignal));
    expect(mockCreateAgentThread).toHaveBeenCalledWith({
      bridgeId: 'b1',
      agentId: 'claude',
      agentName: 'Claude Code',
      cwd: '/code/app',
    });
    expect(setLastWorkspace).toHaveBeenCalledWith('b1', '/code/app');
  });

  it('puts the last used workspace first', async () => {
    useAgentBridgeStore.setState({ bridges: [{ ...bridge, lastWorkspace: '/code/notes' }] });
    const { findByTestId, getAllByTestId } = renderPicker();

    fireEvent.press(await findByTestId('new-chat-picker.agent.b1.claude'));
    await findByTestId('new-chat-picker.workspace./code/notes');

    const rows = getAllByTestId(/^new-chat-picker\.workspace\./);
    expect(rows[0].props.testID).toBe('new-chat-picker.workspace./code/notes');
  });

  it('keeps the user on the workspace step and shows the error when thread creation fails', async () => {
    mockCreateAgentThread.mockRejectedValue(new Error('disk full'));
    const { findByTestId, onAgentThreadCreated, getByText } = renderPicker();

    fireEvent.press(await findByTestId('new-chat-picker.agent.b1.claude'));
    const workspace = await findByTestId('new-chat-picker.workspace./code/app');
    await act(async () => {
      fireEvent.press(workspace);
    });

    expect(await findByTestId('new-chat-picker.create-error')).toBeTruthy();
    expect(getByText('disk full')).toBeTruthy();
    expect(onAgentThreadCreated).not.toHaveBeenCalled();
  });

  it('shows an empty state when the bridge has no workspaces', async () => {
    mockListWorkspaces.mockResolvedValue([]);
    const { findByTestId } = renderPicker();

    fireEvent.press(await findByTestId('new-chat-picker.agent.b1.claude'));

    expect(await findByTestId('new-chat-picker.workspaces.empty')).toBeTruthy();
  });
});

describe('NewChatPicker setup guide', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockListBridgeAgents.mockResolvedValue({ hostname: 'dev', bridgeVersion: '1', agents, roots: ['/code'] });
  });

  it('offers the guide only when no bridge is paired', () => {
    useAgentBridgeStore.setState({ bridges: [] });
    const empty = renderPicker();
    expect(empty.getByTestId('new-chat-picker.guide')).toBeTruthy();
    empty.unmount();

    useAgentBridgeStore.setState({ bridges: [bridge] });
    const paired = renderPicker();
    expect(paired.queryByTestId('new-chat-picker.guide')).toBeNull();
  });

  it('starts the demo thread from the guide', async () => {
    useAgentBridgeStore.setState({ bridges: [] });
    mockCreateDemoThread.mockResolvedValue({ id: 'demo-2' });
    const { getByTestId, onAgentThreadCreated } = renderPicker();

    fireEvent.press(getByTestId('new-chat-picker.guide'));
    fireEvent.press(getByTestId('bridge-guide.demo'));

    await waitFor(() => expect(onAgentThreadCreated).toHaveBeenCalledWith('demo-2'));
  });
});
