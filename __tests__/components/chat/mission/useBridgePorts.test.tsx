import { act, renderHook } from '@testing-library/react-native';

import { PORTS_POLL_INTERVAL_MS, useBridgePorts } from '@/components/chat/mission/useBridgePorts';
import { bridgeTools } from '@/services/agent/bridgeTools';

jest.mock('@/services/agent/bridgeTools', () => ({
  bridgeTools: { features: jest.fn(), listPorts: jest.fn() },
}));

const tools = bridgeTools as jest.Mocked<typeof bridgeTools>;
const bridge = { bridgeId: 'b', cwd: '/w', connectionId: 'c1' };
const tick = (ms: number) => act(async () => { await jest.advanceTimersByTimeAsync(ms); });

describe('useBridgePorts', () => {
  beforeEach(() => {
    jest.useFakeTimers();
    jest.clearAllMocks();
    tools.features.mockResolvedValue(['ports']);
    tools.listPorts.mockResolvedValue([{ port: 3000, process: 'node' }]);
  });
  afterEach(() => jest.useRealTimers());

  it('polls every 5 seconds while active and stops on unmount', async () => {
    const { result, unmount } = renderHook(() => useBridgePorts(bridge, true));
    await tick(0);
    expect(result.current).toEqual([{ port: 3000, process: 'node' }]);
    expect(tools.listPorts).toHaveBeenCalledTimes(1);
    await tick(PORTS_POLL_INTERVAL_MS);
    expect(tools.listPorts).toHaveBeenCalledTimes(2);
    unmount();
    await tick(PORTS_POLL_INTERVAL_MS * 3);
    expect(tools.listPorts).toHaveBeenCalledTimes(2);
  });

  it('stops when no longer active', async () => {
    const { result, rerender } = renderHook(({ active }: { active: boolean }) => useBridgePorts(bridge, active), {
      initialProps: { active: true },
    });
    await tick(0);
    rerender({ active: false });
    expect(result.current).toEqual([]);
    await tick(PORTS_POLL_INTERVAL_MS * 2);
    expect(tools.listPorts).toHaveBeenCalledTimes(1);
  });

  it('does nothing when the bridge lacks the ports feature or a connection', async () => {
    tools.features.mockResolvedValue(['git']);
    renderHook(() => useBridgePorts(bridge, true));
    renderHook(() => useBridgePorts({ ...bridge, connectionId: undefined }, true));
    await tick(PORTS_POLL_INTERVAL_MS);
    expect(tools.listPorts).not.toHaveBeenCalled();
  });

  it('yields an empty list when listing fails', async () => {
    tools.listPorts.mockRejectedValue(new Error('unsupported'));
    const { result } = renderHook(() => useBridgePorts(bridge, true));
    await tick(0);
    expect(result.current).toEqual([]);
  });
});
