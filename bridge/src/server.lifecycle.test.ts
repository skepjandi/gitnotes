import assert from 'node:assert/strict';
import { test } from 'node:test';
import { connectClient, expectType, startTestBridge, waitFor } from './testHelpers.js';

test('an agent that nobody watches is killed after the idle timeout', async () => {
  let clock = 1_000_000;
  const bridge = await startTestBridge({
    idleTtlMs: 60_000,
    idleSweepIntervalMs: 20,
    now: () => clock,
  });
  try {
    const client = await connectClient(bridge.url, bridge.token);
    await expectType(await client.frames.next(), 'ready');
    client.send({ type: 'connect', agent: 'fake' });
    const connected = expectType(await client.frames.next(), 'connected');

    client.socket.close();
    await waitFor(() => !bridge.server.isAttached(connected.connectionId));

    clock += 30_000;
    bridge.server.sweepIdle();
    assert.equal(bridge.server.connectionCount(), 1, 'the agent is still within the idle window');

    clock += 40_000;
    bridge.server.sweepIdle();
    assert.equal(bridge.server.connectionCount(), 0, 'the agent is torn down after the idle window');
  } finally {
    await bridge.close();
  }
});

test('a watched agent is never torn down by the idle sweep', async () => {
  let clock = 2_000_000;
  const bridge = await startTestBridge({
    idleTtlMs: 1_000,
    idleSweepIntervalMs: 20,
    now: () => clock,
  });
  try {
    const client = await connectClient(bridge.url, bridge.token);
    await expectType(await client.frames.next(), 'ready');
    client.send({ type: 'connect', agent: 'fake' });
    await expectType(await client.frames.next(), 'connected');

    clock += 10_000;
    bridge.server.sweepIdle();
    assert.equal(bridge.server.connectionCount(), 1);
  } finally {
    await bridge.close();
  }
});

test('agent output keeps an unwatched agent alive', async () => {
  let clock = 3_000_000;
  const bridge = await startTestBridge({
    idleTtlMs: 60_000,
    idleSweepIntervalMs: 20,
    now: () => clock,
  });
  try {
    const client = await connectClient(bridge.url, bridge.token);
    await expectType(await client.frames.next(), 'ready');
    client.send({ type: 'connect', agent: 'fake' });
    const connected = expectType(await client.frames.next(), 'connected');

    client.send({
      type: 'rpc',
      message: { jsonrpc: '2.0', id: 1, method: 'fake/stream', params: { count: 3, delayMs: 1 } },
    });
    for (let index = 0; index < 3; index += 1) {
      await client.frames.next((frame) => frame.type === 'rpc');
    }
    client.socket.close();
    await waitFor(() => !bridge.server.isAttached(connected.connectionId));

    clock += 30_000;
    bridge.server.sweepIdle();
    assert.equal(bridge.server.connectionCount(), 1, 'recent output postpones the teardown');
  } finally {
    await bridge.close();
  }
});

test('the exit of the agent is forwarded to the client', async () => {
  const bridge = await startTestBridge();
  try {
    const client = await connectClient(bridge.url, bridge.token);
    await expectType(await client.frames.next(), 'ready');
    client.send({ type: 'connect', agent: 'fake' });
    await expectType(await client.frames.next(), 'connected');

    client.send({
      type: 'rpc',
      message: { jsonrpc: '2.0', id: 1, method: 'fake/exit', params: { code: 3 } },
    });

    const exit = expectType(await client.frames.next(), 'agent-exit');
    assert.equal(exit.code, 3);
    assert.equal(exit.signal, null);
  } finally {
    await bridge.close();
  }
});

test('a late resume still sees the frames of an agent that already exited', async () => {
  const bridge = await startTestBridge();
  try {
    const client = await connectClient(bridge.url, bridge.token);
    await expectType(await client.frames.next(), 'ready');
    client.send({ type: 'connect', agent: 'fake' });
    const connected = expectType(await client.frames.next(), 'connected');

    client.send({
      type: 'rpc',
      message: { jsonrpc: '2.0', id: 1, method: 'fake/echo', params: { text: 'before exit' } },
    });
    await client.frames.next((frame) => frame.type === 'rpc');
    client.send({
      type: 'rpc',
      message: { jsonrpc: '2.0', id: 2, method: 'fake/exit', params: { code: 0 } },
    });
    await client.frames.next((frame) => frame.type === 'agent-exit');
    client.socket.close();

    const resumed = await connectClient(bridge.url, bridge.token);
    await expectType(await resumed.frames.next(), 'ready');
    resumed.send({ type: 'resume', connectionId: connected.connectionId, lastSeq: 0 });

    const resumedFrame = expectType(await resumed.frames.next(), 'connected');
    assert.equal(resumedFrame.replayCount, 1);
    const replayed = expectType(await resumed.frames.next(), 'rpc');
    const result = replayed.message.result as { text?: string };
    assert.equal(result.text, 'before exit');
    expectType(await resumed.frames.next(), 'agent-exit');
  } finally {
    await bridge.close();
  }
});

test('agent stderr arrives as log frames and is never replayed', async () => {
  const bridge = await startTestBridge();
  try {
    const client = await connectClient(bridge.url, bridge.token);
    await expectType(await client.frames.next(), 'ready');
    client.send({ type: 'connect', agent: 'fake' });
    const connected = expectType(await client.frames.next(), 'connected');

    client.send({
      type: 'rpc',
      message: { jsonrpc: '2.0', id: 1, method: 'fake/stderr', params: { text: 'warning from the agent' } },
    });

    const log = expectType(await client.frames.next(), 'log');
    assert.match(log.text, /warning from the agent/);

    client.socket.close();
    const resumed = await connectClient(bridge.url, bridge.token);
    await expectType(await resumed.frames.next(), 'ready');
    resumed.send({ type: 'resume', connectionId: connected.connectionId, lastSeq: 0 });
    const resumedFrame = expectType(await resumed.frames.next(), 'connected');
    assert.equal(resumedFrame.replayCount, 0);
  } finally {
    await bridge.close();
  }
});

test('output split across writes and CRLF endings are parsed as one frame', async () => {
  const bridge = await startTestBridge();
  try {
    const client = await connectClient(bridge.url, bridge.token);
    await expectType(await client.frames.next(), 'ready');
    client.send({ type: 'connect', agent: 'fake' });
    await expectType(await client.frames.next(), 'connected');

    client.send({
      type: 'rpc',
      message: {
        jsonrpc: '2.0',
        id: 1,
        method: 'fake/raw',
        params: { parts: ['{"jsonrpc":"2.0","method":"fake/par', 'tial","params":{"n":1}}\r\n'] },
      },
    });

    const frame = expectType(await client.frames.next(), 'rpc');
    assert.equal(frame.message.method, 'fake/partial');
    const params = frame.message.params as { n?: number };
    assert.equal(params.n, 1);
  } finally {
    await bridge.close();
  }
});

test('a line that is not JSON is reported as a log frame', async () => {
  const bridge = await startTestBridge();
  try {
    const client = await connectClient(bridge.url, bridge.token);
    await expectType(await client.frames.next(), 'ready');
    client.send({ type: 'connect', agent: 'fake' });
    await expectType(await client.frames.next(), 'connected');

    client.send({
      type: 'rpc',
      message: {
        jsonrpc: '2.0',
        id: 1,
        method: 'fake/raw',
        params: { parts: ['not json at all\n'] },
      },
    });

    const log = expectType(await client.frames.next(), 'log');
    assert.match(log.text, /not json at all/);
  } finally {
    await bridge.close();
  }
});
