import { BRIDGE_PROTOCOL_VERSION } from '../../../bridge/src/protocol';
import { useAgentBridgeStore } from '../../stores/agentBridgeStore';
import { BridgeConnection, type ReadyFrame } from './BridgeConnection';
import { getBridgeToken } from './bridgeSecrets';
import { normalizeBridgeUrl } from './pairing';
import { BridgeError, type BridgeProbeResult, type WorkspaceInfo } from './types';

export const PROBE_TIMEOUT_MS = 8_000;

function toProbeResult(ready: ReadyFrame): BridgeProbeResult {
  if (ready.protocol !== BRIDGE_PROTOCOL_VERSION) {
    throw new BridgeError(
      'protocol-mismatch',
      `This bridge speaks protocol ${ready.protocol}, the app speaks ${BRIDGE_PROTOCOL_VERSION}. Update the older side.`,
    );
  }
  return { hostname: ready.hostname, bridgeVersion: ready.bridgeVersion, agents: ready.agents, roots: ready.roots };
}

function asBridgeError(error: unknown): BridgeError {
  if (error instanceof BridgeError) return error;
  return new BridgeError('unknown', error instanceof Error ? error.message : 'Bridge request failed');
}

/** Rejects and closes `connection` as soon as `signal` aborts. */
function closeOnAbort(connection: BridgeConnection, signal: AbortSignal | undefined): () => void {
  if (!signal) return () => undefined;
  const onAbort = () => connection.close();
  if (signal.aborted) onAbort();
  signal.addEventListener('abort', onAbort, { once: true });
  return () => signal.removeEventListener('abort', onAbort);
}

async function withOpenConnection<T>(
  url: string,
  token: string,
  signal: AbortSignal | undefined,
  timeoutMs: number,
  use: (connection: BridgeConnection, ready: ReadyFrame) => Promise<T>,
): Promise<T> {
  const connection = new BridgeConnection({ url, token, handshakeTimeoutMs: timeoutMs });
  const stopWatching = closeOnAbort(connection, signal);
  try {
    const ready = await connection.open();
    return await use(connection, ready);
  } catch (error) {
    if (signal?.aborted) throw new BridgeError('unknown', 'Cancelled');
    throw asBridgeError(error);
  } finally {
    stopWatching();
    connection.close();
  }
}

/** Opens a socket, authenticates, reads `ready` and hangs up. */
export async function probeBridge(
  url: string,
  token: string,
  signal?: AbortSignal,
  timeoutMs = PROBE_TIMEOUT_MS,
): Promise<BridgeProbeResult> {
  let normalized: string;
  try {
    normalized = normalizeBridgeUrl(url);
  } catch (error) {
    throw new BridgeError('unreachable', error instanceof Error ? error.message : 'Invalid bridge address');
  }
  return withOpenConnection(normalized, token, signal, timeoutMs, async (_connection, ready) => toProbeResult(ready));
}

/** The URL and token of a paired bridge, or a `BridgeError` when it was removed / lost its token. */
export async function loadBridgeCredentials(bridgeId: string): Promise<{ url: string; token: string; name: string }> {
  const bridge = useAgentBridgeStore.getState().bridges.find((candidate) => candidate.id === bridgeId);
  if (!bridge) throw new BridgeError('unknown', 'This bridge is no longer paired. Pair it again in Settings.');
  const token = await getBridgeToken(bridgeId);
  if (!token) throw new BridgeError('unauthorized', 'The access token for this bridge is missing. Pair it again.');
  return { url: bridge.url, token, name: bridge.name };
}

export async function listWorkspaces(bridgeId: string, signal?: AbortSignal): Promise<WorkspaceInfo[]> {
  const { url, token } = await loadBridgeCredentials(bridgeId);
  return withOpenConnection(url, token, signal, PROBE_TIMEOUT_MS, (connection) => connection.listWorkspaces());
}

export async function listBridgeAgents(bridgeId: string, signal?: AbortSignal): Promise<BridgeProbeResult> {
  const { url, token } = await loadBridgeCredentials(bridgeId);
  return probeBridge(url, token, signal);
}
