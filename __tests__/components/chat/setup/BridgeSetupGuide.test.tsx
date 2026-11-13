import React from 'react';
import { act, fireEvent, render, waitFor } from '@testing-library/react-native';
import * as Clipboard from 'expo-clipboard';
import {
  BRIDGE_INSTALL_COMMAND,
  BridgeSetupGuide,
} from '@/components/chat/setup/BridgeSetupGuide';
import { BridgeError } from '@/services/agent/types';
import { useAgentBridgeStore } from '@/stores/agentBridgeStore';

const mockProbeBridge = jest.fn();
const mockGetBridgeToken = jest.fn();

jest.mock('@/services/agent/bridgeApi', () => ({
  probeBridge: (...args: unknown[]) => mockProbeBridge(...args),
}));
jest.mock('@/services/agent/bridgeSecrets', () => ({
  getBridgeToken: (...args: unknown[]) => mockGetBridgeToken(...args),
}));
jest.mock('expo-clipboard', () => ({ setStringAsync: jest.fn().mockResolvedValue(true) }));

const bridge = { id: 'b1', name: 'Dev box', url: 'wss://dev.example.net', addedAt: 1 };
const agents = [
  { id: 'claude', name: 'Claude Code', available: true, command: 'claude' },
  { id: 'pi', name: 'Pi', available: false, command: 'pi-acp' },
];

describe('BridgeSetupGuide', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockGetBridgeToken.mockResolvedValue('secret');
    useAgentBridgeStore.setState({ bridges: [bridge] });
  });

  it('copies the install command', async () => {
    const { getByTestId } = render(<BridgeSetupGuide visible onClose={jest.fn()} />);

    expect(getByTestId('bridge-guide.install.command').props.children).toBe(BRIDGE_INSTALL_COMMAND);
    await act(async () => {
      fireEvent.press(getByTestId('bridge-guide.install.copy'));
    });
    expect(Clipboard.setStringAsync).toHaveBeenCalledWith(BRIDGE_INSTALL_COMMAND);
  });

  it('lists the three ways to reach the bridge', () => {
    const { getByTestId } = render(<BridgeSetupGuide visible onClose={jest.fn()} />);
    for (const route of ['tailscale', 'lan', 'tunnel']) expect(getByTestId(`bridge-guide.route.${route}`)).toBeTruthy();
  });

  it('shows agent availability and advertised features after a successful check', async () => {
    mockProbeBridge.mockResolvedValue({ hostname: 'dev', bridgeVersion: '1.2.0', agents, roots: [], features: ['git'] });
    const { getByTestId, queryByTestId } = render(<BridgeSetupGuide visible onClose={jest.fn()} />);

    fireEvent.press(getByTestId('bridge-guide.check.b1'));

    await waitFor(() => expect(getByTestId('bridge-guide.reachable.b1')).toBeTruthy());
    expect(mockProbeBridge).toHaveBeenCalledWith('wss://dev.example.net', 'secret');
    expect(getByTestId('bridge-guide.protocol.b1')).toBeTruthy();
    expect(getByTestId('bridge-guide.agent.b1.claude')).toBeTruthy();
    expect(getByTestId('bridge-guide.agent.b1.pi')).toBeTruthy();
    expect(getByTestId('bridge-guide.feature.b1.git')).toBeTruthy();
    expect(getByTestId('bridge-guide.feature.b1.fs-search')).toBeTruthy();
    expect(getByTestId('bridge-guide.update-hint.b1')).toBeTruthy();
    expect(queryByTestId('bridge-guide.checking.b1')).toBeNull();
  });

  it('treats a bridge without a features list as old and hints to update', async () => {
    mockProbeBridge.mockResolvedValue({ hostname: 'dev', bridgeVersion: '0.9', agents: [], roots: [] });
    const { getByTestId } = render(<BridgeSetupGuide visible onClose={jest.fn()} />);

    fireEvent.press(getByTestId('bridge-guide.check.b1'));

    await waitFor(() => expect(getByTestId('bridge-guide.update-hint.b1')).toBeTruthy());
  });

  it('omits the update hint when every feature is advertised', async () => {
    mockProbeBridge.mockResolvedValue({ hostname: 'dev', bridgeVersion: '2', agents, roots: [], features: ['fs-search', 'git', 'ports'] });
    const { getByTestId, queryByTestId } = render(<BridgeSetupGuide visible onClose={jest.fn()} />);

    fireEvent.press(getByTestId('bridge-guide.check.b1'));

    await waitFor(() => expect(getByTestId('bridge-guide.feature.b1.ports')).toBeTruthy());
    expect(queryByTestId('bridge-guide.update-hint.b1')).toBeNull();
  });

  it('reports an unreachable bridge', async () => {
    mockProbeBridge.mockRejectedValue(new BridgeError('unreachable', 'nope'));
    const { getByTestId, queryByTestId } = render(<BridgeSetupGuide visible onClose={jest.fn()} />);

    fireEvent.press(getByTestId('bridge-guide.check.b1'));

    await waitFor(() => expect(getByTestId('bridge-guide.reachable.b1')).toBeTruthy());
    expect(queryByTestId('bridge-guide.protocol.b1')).toBeNull();
    expect(queryByTestId('bridge-guide.agent.b1.claude')).toBeNull();
  });

  it('reports a protocol mismatch as reachable but incompatible', async () => {
    mockProbeBridge.mockRejectedValue(new BridgeError('protocol-mismatch', 'old'));
    const { getByTestId } = render(<BridgeSetupGuide visible onClose={jest.fn()} />);

    fireEvent.press(getByTestId('bridge-guide.check.b1'));

    await waitFor(() => expect(getByTestId('bridge-guide.protocol.b1')).toBeTruthy());
  });

  it('fails the check when no token is stored', async () => {
    mockGetBridgeToken.mockResolvedValue(null);
    const { getByTestId } = render(<BridgeSetupGuide visible onClose={jest.fn()} />);

    fireEvent.press(getByTestId('bridge-guide.check.b1'));

    await waitFor(() => expect(getByTestId('bridge-guide.reachable.b1')).toBeTruthy());
    expect(mockProbeBridge).not.toHaveBeenCalled();
  });

  it('shows the demo button only when a handler is given', () => {
    const onTryDemo = jest.fn();
    const withDemo = render(<BridgeSetupGuide visible onClose={jest.fn()} onTryDemo={onTryDemo} />);
    fireEvent.press(withDemo.getByTestId('bridge-guide.demo'));
    expect(onTryDemo).toHaveBeenCalledTimes(1);
    withDemo.unmount();

    const without = render(<BridgeSetupGuide visible onClose={jest.fn()} />);
    expect(without.queryByTestId('bridge-guide.demo')).toBeNull();
  });

  it('has no diagnostics block without paired bridges', () => {
    useAgentBridgeStore.setState({ bridges: [] });
    const { queryByTestId } = render(<BridgeSetupGuide visible onClose={jest.fn()} />);
    expect(queryByTestId('bridge-guide.bridge.b1')).toBeNull();
  });
});
