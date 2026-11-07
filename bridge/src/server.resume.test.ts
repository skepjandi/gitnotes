import assert from 'node:assert/strict';
import { test } from 'node:test';
import { connectClient, expectType, startTestBridge, waitFor } from './testHelpers.js';

test('resume replays exactly the frames the client missed', async () => {
  const bridge = await startTestBridge();
  try {
    const client = await connectClient(bridge.url, bridge.token);
    await expectType(await client.frames.next(), 'ready');
    client.send({ type: 'connect', agent: 'fake' });
    const connected = expectType(await client.frames.next(), 'connected');

    client.send({
      type: 'rpc',
      message: { jsonrpc: '2.0', id: 1, method: 'fake/stream', params: { count: 10, delayMs: 5 } },
    });

    const seen: number[] = [];
    for (let index = 0; index < 3; index += 1) {
      const frame = expectType(await client.frames.next(), 'rpc');
      seen.push(frame.seq);
    }
    const lastSeq = seen[seen.length - 1] as number;
    client.socket.terminate();
    await waitFor(() => bridge.server.headSeq(connected.connectionId) === 10);

    const resumed = await connectClient(bridge.url, bridge.token);
    await expectType(await resumed.frames.next(), 'ready');
    resumed.send({ type: 'resume', connectionId: connected.connectionId, lastSeq });

    const resumedFrame = expectType(await resumed.frames.next(), 'connected');
    assert.equal(resumedFrame.resumed, true);
    assert.equal(resumedFrame.connectionId, connected.connectionId);
    assert.equal(resumedFrame.replayCount, 10 - lastSeq);

    const replayed: number[] = [];
    for (let index = 0; index < resumedFrame.replayCount; index += 1) {
      const frame = expectType(await resumed.frames.next(), 'rpc');
      replayed.push(frame.seq);
    }
    assert.deepEqual(replayed, [4, 5, 6, 7, 8, 9, 10]);
  } finally {
    await bridge.close();
  }
});

test('resume with an unknown connection id fails', async () => {
  const bridge = await startTestBridge();
  try {
    const client = await connectClient(bridge.url, bridge.token);
    await expectType(await client.frames.next(), 'ready');
    client.send({ type: 'resume', connectionId: 'nope', lastSeq: 0 });
    const frame = expectType(await client.frames.next(), 'error');
    assert.equal(frame.code, 'unknown-connection');
  } finally {
    await bridge.close();
  }
});

test('a cursor older than the replay window reports a replay gap', async () => {
  const bridge = await startTestBridge({ replayMaxFrames: 2 });
  try {
    const client = await connectClient(bridge.url, bridge.token);
    await expectType(await client.frames.next(), 'ready');
    client.send({ type: 'connect', agent: 'fake' });
    const connected = expectType(await client.frames.next(), 'connected');

    client.send({
      type: 'rpc',
      message: { jsonrpc: '2.0', id: 1, method: 'fake/stream', params: { count: 6, delayMs: 5 } },
    });
    for (let index = 0; index < 6; index += 1) {
      await client.frames.next((frame) => frame.type === 'rpc');
    }
    client.socket.terminate();

    const resumed = await connectClient(bridge.url, bridge.token);
    await expectType(await resumed.frames.next(), 'ready');
    resumed.send({ type: 'resume', connectionId: connected.connectionId, lastSeq: 0 });

    const frame = expectType(await resumed.frames.next(), 'error');
    assert.equal(frame.code, 'replay-gap');
  } finally {
    await bridge.close();
  }
});

test('a cursor inside the replay window still replays', async () => {
  const bridge = await startTestBridge({ replayMaxFrames: 3 });
  try {
    const client = await connectClient(bridge.url, bridge.token);
    await expectType(await client.frames.next(), 'ready');
    client.send({ type: 'connect', agent: 'fake' });
    const connected = expectType(await client.frames.next(), 'connected');

    client.send({
      type: 'rpc',
      message: { jsonrpc: '2.0', id: 1, method: 'fake/stream', params: { count: 6, delayMs: 5 } },
    });
    for (let index = 0; index < 6; index += 1) {
      await client.frames.next((frame) => frame.type === 'rpc');
    }
    client.socket.terminate();

    const resumed = await connectClient(bridge.url, bridge.token);
    await expectType(await resumed.frames.next(), 'ready');
    resumed.send({ type: 'resume', connectionId: connected.connectionId, lastSeq: 4 });

    const resumedFrame = expectType(await resumed.frames.next(), 'connected');
    assert.equal(resumedFrame.replayCount, 2);
  } finally {
    await bridge.close();
  }
});

test('answered agent requests are not replayed but unanswered ones are', async () => {
  const bridge = await startTestBridge();
  try {
    const client = await connectClient(bridge.url, bridge.token);
    await expectType(await client.frames.next(), 'ready');
    client.send({ type: 'connect', agent: 'fake' });
    const connected = expectType(await client.frames.next(), 'connected');

    client.send({
      type: 'rpc',
      message: { jsonrpc: '2.0', id: 10, method: 'fake/request', params: { requestId: 'req-1' } },
    });
    const first = expectType(await client.frames.next(), 'rpc');
    assert.equal(first.message.id, 'req-1');

    client.send({
      type: 'rpc',
      message: { jsonrpc: '2.0', id: 11, method: 'fake/request', params: { requestId: 'req-2' } },
    });
    const second = expectType(await client.frames.next(), 'rpc');
    assert.equal(second.message.id, 'req-2');

    client.send({
      type: 'rpc',
      message: { jsonrpc: '2.0', id: 'req-1', result: { outcome: { outcome: 'selected' } } },
    });
    await client.frames.next((frame) => frame.type === 'rpc' && frame.message.method === 'fake/answered');
    client.socket.terminate();

    const resumed = await connectClient(bridge.url, bridge.token);
    await expectType(await resumed.frames.next(), 'ready');
    resumed.send({ type: 'resume', connectionId: connected.connectionId, lastSeq: 0 });

    const resumedFrame = expectType(await resumed.frames.next(), 'connected');
    const replayed: Array<{ id?: unknown; method?: unknown }> = [];
    for (let index = 0; index < resumedFrame.replayCount; index += 1) {
      const frame = expectType(await resumed.frames.next(), 'rpc');
      replayed.push({ id: frame.message.id, method: frame.message.method });
    }

    assert.equal(
      replayed.some((message) => message.id === 'req-1'),
      false,
      'the answered request must not be replayed',
    );
    assert.equal(
      replayed.some((message) => message.id === 'req-2'),
      true,
      'the unanswered request must be replayed',
    );
  } finally {
    await bridge.close();
  }
});

test('a second socket that resumes kicks the first one with superseded', async () => {
  const bridge = await startTestBridge();
  try {
    const first = await connectClient(bridge.url, bridge.token);
    await expectType(await first.frames.next(), 'ready');
    first.send({ type: 'connect', agent: 'fake' });
    const connected = expectType(await first.frames.next(), 'connected');

    const second = await connectClient(bridge.url, bridge.token);
    await expectType(await second.frames.next(), 'ready');
    second.send({ type: 'resume', connectionId: connected.connectionId, lastSeq: 0 });

    expectType(await second.frames.next(), 'connected');
    const kicked = expectType(await first.frames.next(), 'error');
    assert.equal(kicked.code, 'superseded');
  } finally {
    await bridge.close();
  }
});

test('a closed socket does not stop the agent', async () => {
  const bridge = await startTestBridge();
  try {
    const client = await connectClient(bridge.url, bridge.token);
    await expectType(await client.frames.next(), 'ready');
    client.send({ type: 'connect', agent: 'fake' });
    const connected = expectType(await client.frames.next(), 'connected');

    client.socket.close();
    await waitFor(() => !bridge.server.isAttached(connected.connectionId));
    assert.equal(bridge.server.connectionCount(), 1);

    const resumed = await connectClient(bridge.url, bridge.token);
    await expectType(await resumed.frames.next(), 'ready');
    resumed.send({ type: 'resume', connectionId: connected.connectionId, lastSeq: 0 });
    expectType(await resumed.frames.next(), 'connected');
  } finally {
    await bridge.close();
  }
});
