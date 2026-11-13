import { bridgeTools } from '../../../src/services/agent/bridgeTools';
import { BridgeError } from '../../../src/services/agent/types';
import { useAgentBridgeStore } from '../../../src/stores/agentBridgeStore';
import { installNodeWebSocket, pairFakeBridge } from '../../helpers/agentChat';
import { FakeBridge, type RequestFrame } from '../../helpers/fakeBridge';

describe('bridgeTools', () => {
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

  async function pair(features?: ('fs-search' | 'git' | 'ports')[]) {
    bridge = await FakeBridge.start({ features: features as never });
    return pairFakeBridge(bridge);
  }

  it('reports the bridge features and caches them for the session', async () => {
    const paired = await pair(['git', 'ports']);

    expect(await bridgeTools.features(paired.id)).toEqual(['git', 'ports']);
    expect(await bridgeTools.features(paired.id)).toEqual(['git', 'ports']);
    expect((bridge as FakeBridge).socketsAccepted).toBe(1);
  });

  it('treats a bridge without features as supporting none', async () => {
    const paired = await pair();
    expect(await bridgeTools.features(paired.id)).toEqual([]);
  });

  it('searches files and returns the matches', async () => {
    const paired = await pair(['fs-search']);
    const b = bridge as FakeBridge;
    b.requestHandler = (frame: RequestFrame) => {
      if (frame.type !== 'fs-search') return null;
      return { type: 'fs-results', items: [{ path: 'src/a.ts', isDir: false }], truncated: true };
    };

    const result = await bridgeTools.searchFiles(paired.id, '/work', 'a', 10);
    expect(result).toEqual({ items: [{ path: 'src/a.ts', isDir: false }], truncated: true });
    expect((bridge as FakeBridge).requestFrames[0]).toMatchObject({ type: 'fs-search', cwd: '/work', query: 'a', limit: 10 });
  });

  it('reads the git status', async () => {
    const paired = await pair(['git']);
    const b = bridge as FakeBridge;
    b.requestHandler = (frame: RequestFrame) => {
      if (frame.type !== 'git') return null;
      return {
        type: 'git-result',
        result: {
          kind: 'status',
          branch: 'main',
          ahead: 1,
          behind: 0,
          files: [{ path: 'a.ts', status: 'modified', staged: false, unstaged: true }],
        },
      };
    };

    const status = await bridgeTools.gitStatus(paired.id, '/work');
    expect(status.branch).toBe('main');
    expect(status.files).toHaveLength(1);
    expect((bridge as FakeBridge).requestFrames[0]).toMatchObject({ type: 'git', op: { kind: 'status' } });
  });

  it('stages, unstages and commits', async () => {
    const paired = await pair(['git']);
    const b = bridge as FakeBridge;
    b.requestHandler = (frame: RequestFrame) => {
      if (frame.type !== 'git') return null;
      if (frame.op.kind === 'commit') return { type: 'git-result', result: { kind: 'commit', hash: 'abc123', summary: 'done' } };
      return { type: 'git-result', result: { kind: 'ok' } };
    };

    await expect(bridgeTools.gitStage(paired.id, '/work', ['a.ts'])).resolves.toBeUndefined();
    await expect(bridgeTools.gitUnstage(paired.id, '/work', ['a.ts'])).resolves.toBeUndefined();
    await expect(bridgeTools.gitCommit(paired.id, '/work', 'message')).resolves.toEqual({ hash: 'abc123', summary: 'done' });
    expect((bridge as FakeBridge).requestFrames.map((frame) => (frame.type === 'git' ? frame.op.kind : ''))).toEqual(['stage', 'unstage', 'commit']);
  });

  it('reads a diff', async () => {
    const paired = await pair(['git']);
    const b = bridge as FakeBridge;
    b.requestHandler = (frame: RequestFrame) =>
      frame.type === 'git'
        ? { type: 'git-result', result: { kind: 'diff', path: 'a.ts', staged: false, patch: '@@', truncated: false } }
        : null;

    await expect(bridgeTools.gitDiff(paired.id, '/work', 'a.ts', false)).resolves.toEqual({
      path: 'a.ts',
      staged: false,
      patch: '@@',
      truncated: false,
    });
  });

  it('lists the ports of an agent connection', async () => {
    const paired = await pair(['ports']);
    const b = bridge as FakeBridge;
    b.requestHandler = (frame: RequestFrame) =>
      frame.type === 'ports' ? { type: 'ports-result', ports: [{ port: 3000, process: 'node' }] } : null;

    await expect(bridgeTools.listPorts(paired.id, 'conn-1')).resolves.toEqual([{ port: 3000, process: 'node' }]);
  });

  it('maps a bridge failure to a BridgeError with the bridge code', async () => {
    const paired = await pair(['git']);
    const b = bridge as FakeBridge;
    b.requestHandler = () => null;

    await expect(bridgeTools.gitStatus(paired.id, '/work')).rejects.toMatchObject({
      name: 'BridgeError',
      code: 'unsupported',
    });
  });

  it('rejects with a BridgeError when the bridge is gone', async () => {
    const paired = await pair(['git']);
    await bridge?.stop();
    bridge = null;

    await expect(bridgeTools.gitStatus(paired.id, '/work')).rejects.toBeInstanceOf(BridgeError);
  });

  it('rejects when the bridge is not paired', async () => {
    await expect(bridgeTools.features('nope')).rejects.toBeInstanceOf(BridgeError);
  });
});
