import AsyncStorage from '@react-native-async-storage/async-storage';
import { getBridgeToken } from '../../src/services/agent/bridgeSecrets';
import { AGENT_BRIDGE_STORAGE_KEY, useAgentBridgeStore } from '../../src/stores/agentBridgeStore';

describe('agentBridgeStore', () => {
  beforeEach(async () => {
    useAgentBridgeStore.setState({ bridges: [] });
    await AsyncStorage.clear();
  });

  it('keeps the token in secure storage and out of the persisted bridge list', async () => {
    const bridge = await useAgentBridgeStore.getState().addBridge({ name: ' Work Mac ', url: 'my-mac.local', token: 's3cret-token' });

    expect(bridge).toMatchObject({ name: 'Work Mac', url: 'ws://my-mac.local:7878' });
    expect(await getBridgeToken(bridge.id)).toBe('s3cret-token');

    const persisted = await AsyncStorage.getItem(AGENT_BRIDGE_STORAGE_KEY);
    expect(persisted).toContain('Work Mac');
    expect(persisted).not.toContain('s3cret-token');
  });

  it('refreshes the token of an already paired URL instead of duplicating the bridge', async () => {
    const first = await useAgentBridgeStore.getState().addBridge({ name: 'Mac', url: 'ws://10.0.0.2:7878/', token: 'old' });
    const second = await useAgentBridgeStore.getState().addBridge({ name: 'Mac (new token)', url: 'ws://10.0.0.2:7878', token: 'new' });

    expect(second.id).toBe(first.id);
    expect(useAgentBridgeStore.getState().bridges).toHaveLength(1);
    expect(useAgentBridgeStore.getState().bridges[0]?.name).toBe('Mac (new token)');
    expect(await getBridgeToken(first.id)).toBe('new');
  });

  it('rejects junk addresses without storing anything', async () => {
    await expect(useAgentBridgeStore.getState().addBridge({ name: 'x', url: 'ftp://nope', token: 't' })).rejects.toThrow();
    expect(useAgentBridgeStore.getState().bridges).toEqual([]);
  });

  it('updates name, url and token independently and normalises the url', async () => {
    const bridge = await useAgentBridgeStore.getState().addBridge({ name: 'Mac', url: 'ws://a:1', token: 'one' });

    await useAgentBridgeStore.getState().updateBridge(bridge.id, { name: 'Renamed' });
    expect(useAgentBridgeStore.getState().bridges[0]).toMatchObject({ name: 'Renamed', url: 'ws://a:1' });
    expect(await getBridgeToken(bridge.id)).toBe('one');

    await useAgentBridgeStore.getState().updateBridge(bridge.id, { url: 'wss://b.example.com/', token: 'two' });
    expect(useAgentBridgeStore.getState().bridges[0]).toMatchObject({ name: 'Renamed', url: 'wss://b.example.com' });
    expect(await getBridgeToken(bridge.id)).toBe('two');

    await useAgentBridgeStore.getState().updateBridge('does-not-exist', { name: 'ghost' });
    expect(useAgentBridgeStore.getState().bridges).toHaveLength(1);
  });

  it('removes the token together with the bridge', async () => {
    const bridge = await useAgentBridgeStore.getState().addBridge({ name: 'Mac', url: 'ws://a:1', token: 'tok' });
    await useAgentBridgeStore.getState().removeBridge(bridge.id);

    expect(useAgentBridgeStore.getState().bridges).toEqual([]);
    expect(await getBridgeToken(bridge.id)).toBeNull();
  });

  it('remembers the last workspace per bridge', async () => {
    const a = await useAgentBridgeStore.getState().addBridge({ name: 'A', url: 'ws://a:1', token: 't' });
    const b = await useAgentBridgeStore.getState().addBridge({ name: 'B', url: 'ws://b:1', token: 't' });
    useAgentBridgeStore.getState().setLastWorkspace(a.id, '/work/app');

    const bridges = useAgentBridgeStore.getState().bridges;
    expect(bridges.find((bridge) => bridge.id === a.id)?.lastWorkspace).toBe('/work/app');
    expect(bridges.find((bridge) => bridge.id === b.id)?.lastWorkspace).toBeUndefined();
  });

  it('restores bridges from storage and flips hydrated', async () => {
    useAgentBridgeStore.setState({ hydrated: false, bridges: [] });
    await AsyncStorage.clear();
    await AsyncStorage.setItem(
      AGENT_BRIDGE_STORAGE_KEY,
      JSON.stringify({ state: { bridges: [{ id: 'bridge_1', name: 'Saved', url: 'ws://saved:1', addedAt: 5 }] }, version: 0 }),
    );

    await useAgentBridgeStore.persist.rehydrate();

    expect(useAgentBridgeStore.getState().hydrated).toBe(true);
    expect(useAgentBridgeStore.getState().bridges.map((bridge) => bridge.name)).toEqual(['Saved']);
  });
});
