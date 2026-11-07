import { listBridgeAgents, listWorkspaces, probeBridge } from '../../../src/services/agent/bridgeApi';
import { setBridgeToken } from '../../../src/services/agent/bridgeSecrets';
import { BridgeError } from '../../../src/services/agent/types';
import { useAgentBridgeStore } from '../../../src/stores/agentBridgeStore';
import { installNodeWebSocket, pairFakeBridge } from '../../helpers/agentChat';
import { FakeBridge } from '../../helpers/fakeBridge';

async function rejection(promise: Promise<unknown>): Promise<BridgeError> {
  try {
    await promise;
  } catch (error) {
    if (error instanceof BridgeError) return error;
    throw error;
  }
  throw new Error('expected the promise to reject');
}

describe('bridgeApi', () => {
  let restoreWebSocket: () => void;
  let bridge: FakeBridge | null = null;

  beforeAll(() => {
    restoreWebSocket = installNodeWebSocket();
  });
  afterAll(() => restoreWebSocket());
  afterEach(async () => {
    await bridge?.stop();
    bridge = null;
    useAgentBridgeStore.setState({ bridges: [] });
  });

  it('probes a bridge: authenticates, reads ready and hangs up', async () => {
    bridge = await FakeBridge.start({ roots: ['/srv', '/home/me'] });
    const result = await probeBridge(bridge.url, bridge.token);
    expect(result).toEqual({
      hostname: 'fake-host',
      bridgeVersion: '0.0.0-test',
      agents: [
        { id: 'fake', name: 'Fake Agent', available: true, command: 'fake-agent --acp' },
        { id: 'missing', name: 'Missing Agent', available: false, command: 'missing-agent' },
      ],
      roots: ['/srv', '/home/me'],
    });
    expect(bridge.connections.size).toBe(0);
  });

  it('accepts addresses without a scheme', async () => {
    bridge = await FakeBridge.start();
    const result = await probeBridge(bridge.url.replace('ws://', ''), bridge.token);
    expect(result.hostname).toBe('fake-host');
  });

  it('maps a wrong token to unauthorized', async () => {
    bridge = await FakeBridge.start();
    const error = await rejection(probeBridge(bridge.url, 'not-the-token'));
    expect(error.kind).toBe('unauthorized');
  });

  it('maps a protocol version it does not speak to protocol-mismatch', async () => {
    bridge = await FakeBridge.start({ protocol: 99 });
    const error = await rejection(probeBridge(bridge.url, bridge.token));
    expect(error.kind).toBe('protocol-mismatch');
  });

  it('times out when the bridge never answers', async () => {
    bridge = await FakeBridge.start({ silentAuth: true });
    const error = await rejection(probeBridge(bridge.url, bridge.token, undefined, 150));
    expect(error.kind).toBe('timeout');
  });

  it('reports an unreachable host', async () => {
    bridge = await FakeBridge.start();
    const deadUrl = bridge.url;
    await bridge.stop();
    bridge = null;
    const error = await rejection(probeBridge(deadUrl, 'token'));
    expect(error.kind).toBe('unreachable');
  });

  it('rejects a malformed address as unreachable without opening a socket', async () => {
    const error = await rejection(probeBridge('ftp://nope', 'token'));
    expect(error.kind).toBe('unreachable');
  });

  it('stops probing when the signal aborts', async () => {
    bridge = await FakeBridge.start({ silentAuth: true });
    const controller = new AbortController();
    const pending = rejection(probeBridge(bridge.url, bridge.token, controller.signal));
    setTimeout(() => controller.abort(), 30);
    const error = await pending;
    expect(error.message).toBe('Cancelled');
  });

  it('lists workspaces and agents of a paired bridge using its stored token', async () => {
    bridge = await FakeBridge.start({
      workspaces: [
        { path: '/work', name: 'work', isRoot: true },
        { path: '/work/app', name: 'app', isRoot: false },
      ],
    });
    const paired = await pairFakeBridge(bridge);
    expect(await listWorkspaces(paired.id)).toHaveLength(2);
    expect((await listBridgeAgents(paired.id)).agents.map((agent) => agent.id)).toEqual(['fake', 'missing']);
  });

  it('explains a bridge that was removed or lost its token', async () => {
    const missing = await rejection(listWorkspaces('bridge_gone'));
    expect(missing.message).toMatch(/no longer paired/i);

    bridge = await FakeBridge.start();
    const paired = await pairFakeBridge(bridge);
    await setBridgeToken(paired.id, '');
    const tokenless = await rejection(listWorkspaces(paired.id));
    expect(tokenless.kind).toBe('unauthorized');
  });
});
