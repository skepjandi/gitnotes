import React from 'react';
import { act, fireEvent, render, waitFor } from '@testing-library/react-native';

import { AddBridgeModal } from '@/components/agent/AddBridgeModal';
import { BridgeError } from '@/services/agent/types';
import { useAgentBridgeStore } from '@/stores/agentBridgeStore';

const mockProbeBridge = jest.fn();
jest.mock('@/services/agent/bridgeApi', () => ({
  probeBridge: (...args: unknown[]) => mockProbeBridge(...args),
}));

const addBridge = jest.fn();

const probeOk = { hostname: 'dev-box', bridgeVersion: '1.0.0', agents: [], roots: ['/code'] };

function renderModal(props: Partial<React.ComponentProps<typeof AddBridgeModal>> = {}) {
  const onClose = jest.fn();
  const onSaved = jest.fn();
  const utils = render(<AddBridgeModal visible onClose={onClose} onSaved={onSaved} {...props} />);
  return { ...utils, onClose, onSaved };
}

describe('AddBridgeModal', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    addBridge.mockImplementation(async (input: { name: string; url: string }) => ({
      id: 'b1',
      name: input.name,
      url: input.url,
      addedAt: 1,
    }));
    useAgentBridgeStore.setState({ bridges: [], addBridge });
  });

  it('never saves a pairing link without confirmation and shows the host first', async () => {
    const link = 'gitnotes://agents/pair?url=wss%3A%2F%2Fdev-box.tail1234.ts.net&token=secret-token&name=Dev%20box';
    const { getByTestId, queryByTestId } = renderModal();

    fireEvent.changeText(getByTestId('add-bridge.input.link'), link);
    fireEvent.press(getByTestId('add-bridge.button.continue'));

    expect(getByTestId('add-bridge.confirm.host').props.children).toBe('dev-box.tail1234.ts.net');
    expect(queryByTestId('add-bridge.confirm.cleartext')).toBeNull();
    expect(mockProbeBridge).not.toHaveBeenCalled();
    expect(addBridge).not.toHaveBeenCalled();
  });

  it('probes first, then saves with the chosen name, and reports the saved bridge', async () => {
    mockProbeBridge.mockResolvedValue(probeOk);
    const { getByTestId, onClose, onSaved } = renderModal({
      initialLink: { url: 'wss://dev-box.example.net', token: 'tok' },
    });

    fireEvent.changeText(getByTestId('add-bridge.input.name'), 'Work laptop');
    await act(async () => {
      fireEvent.press(getByTestId('add-bridge.button.connect'));
    });

    expect(mockProbeBridge).toHaveBeenCalledWith('wss://dev-box.example.net', 'tok');
    expect(addBridge).toHaveBeenCalledWith({ name: 'Work laptop', url: 'wss://dev-box.example.net', token: 'tok' });
    expect(onSaved).toHaveBeenCalledWith(expect.objectContaining({ id: 'b1', name: 'Work laptop' }));
    expect(onClose).toHaveBeenCalled();
  });

  it('falls back to the bridge hostname when the name is left empty', async () => {
    mockProbeBridge.mockResolvedValue(probeOk);
    const { getByTestId } = renderModal({ initialLink: { url: 'wss://x.example.net', token: 'tok' } });

    await act(async () => {
      fireEvent.press(getByTestId('add-bridge.button.connect'));
    });

    expect(addBridge).toHaveBeenCalledWith(expect.objectContaining({ name: 'dev-box' }));
  });

  it('does not save when the probe fails and shows the mapped error', async () => {
    mockProbeBridge.mockRejectedValue(new BridgeError('unauthorized', 'bad token'));
    const { getByTestId, onClose } = renderModal({ initialLink: { url: 'wss://x.example.net', token: 'wrong' } });

    await act(async () => {
      fireEvent.press(getByTestId('add-bridge.button.connect'));
    });

    await waitFor(() => expect(getByTestId('add-bridge.error')).toBeTruthy());
    expect(addBridge).not.toHaveBeenCalled();
    expect(onClose).not.toHaveBeenCalled();
  });

  it('warns about cleartext ws:// hosts on the confirm step', () => {
    const { getByTestId } = renderModal({ initialLink: { url: 'ws://192.168.1.20:7878', token: 'tok' } });

    expect(getByTestId('add-bridge.confirm.cleartext')).toBeTruthy();
  });

  it('flags a bridge that is already paired', () => {
    useAgentBridgeStore.setState({
      bridges: [{ id: 'old', name: 'Old', url: 'wss://x.example.net', addedAt: 1 }],
    });
    const { getByTestId } = renderModal({ initialLink: { url: 'wss://x.example.net', token: 'tok' } });

    expect(getByTestId('add-bridge.confirm.already-paired')).toBeTruthy();
  });

  it('rejects junk in link mode and a missing token in manual mode', () => {
    const { getByTestId, queryByTestId } = renderModal();

    fireEvent.changeText(getByTestId('add-bridge.input.link'), 'not a link');
    fireEvent.press(getByTestId('add-bridge.button.continue'));
    expect(getByTestId('add-bridge.error')).toBeTruthy();

    fireEvent.press(getByTestId('add-bridge.button.switch-mode'));
    expect(queryByTestId('add-bridge.error')).toBeNull();
    fireEvent.changeText(getByTestId('add-bridge.input.url'), 'dev-box.local:7878');
    fireEvent.press(getByTestId('add-bridge.button.continue'));
    expect(getByTestId('add-bridge.error')).toBeTruthy();
    expect(queryByTestId('add-bridge.confirm')).toBeNull();
  });
});
