import { useEffect, useState } from 'react';
import { bridgeTools, type ListeningPort } from '../../../services/agent/bridgeTools';

export const PORTS_POLL_INTERVAL_MS = 5000;

export interface MissionBridge {
  bridgeId: string;
  cwd: string;
  connectionId?: string;
}

export function useBridgePorts(bridge: MissionBridge | null | undefined, active: boolean): ListeningPort[] {
  const [ports, setPorts] = useState<ListeningPort[]>([]);
  const bridgeId = bridge?.bridgeId;
  const connectionId = bridge?.connectionId;

  useEffect(() => {
    if (!active || !bridgeId || !connectionId) {
      setPorts([]);
      return;
    }
    let cancelled = false;
    let timer: ReturnType<typeof setTimeout> | undefined;

    const poll = async () => {
      try {
        const next = await bridgeTools.listPorts(bridgeId, connectionId);
        if (!cancelled) setPorts(next);
      } catch {
        if (!cancelled) setPorts([]);
      }
      if (!cancelled) timer = setTimeout(() => void poll(), PORTS_POLL_INTERVAL_MS);
    };

    bridgeTools.features(bridgeId).then(
      (features) => {
        if (!cancelled && features.includes('ports')) void poll();
      },
      () => undefined,
    );

    return () => {
      cancelled = true;
      if (timer) clearTimeout(timer);
    };
  }, [active, bridgeId, connectionId]);

  return ports;
}
