import assert from 'node:assert/strict';
import { test } from 'node:test';
import { connectClient, expectType, startTestBridge, waitFor } from './testHelpers.js';

test('connecting spawns the agent and rpc messages round-trip', async () => {
  const bridge = await startTestBridge();
  try {
    const client = await connectClient(bridge.url, bridge.token);
    await expectType(await client.frames.next(), 'ready');

    client.send({ type: 'connect', agent: 'fake' });
    const connected = expectType(await client.frames.next(), 'connected');
    assert.equal(connected.agent, 'fake');
    assert.equal(connected.resumed, false);
    assert.equal(connected.replayCount, 0);
    assert.equal(connected.headSeq, 0);
    assert.equal(connected.connectionId.length, 32);

    client.send({
      type: 'rpc',
      message: { jsonrpc: '2.0', id: 1, method: 'initialize', params: { protocolVersion: 1 } },
    });
    const reply = expectType(await client.frames.next(), 'rpc');
    assert.equal(reply.seq, 1);
    assert.equal(reply.message.id, 1);
    const result = reply.message.result as { agentCapabilities?: unknown };
    assert.ok(result.agentCapabilities);
  } finally {
    await bridge.close();
  }
});

test('an unknown agent is refused', async () => {
  const bridge = await startTestBridge();
  try {
    const client = await connectClient(bridge.url, bridge.token);
    await expectType(await client.frames.next(), 'ready');
    client.send({ type: 'connect', agent: 'nope' });
    const frame = expectType(await client.frames.next(), 'error');
    assert.equal(frame.code, 'unknown-agent');
  } finally {
    await bridge.close();
  }
});

test('an agent whose binary is missing is refused', async () => {
  const bridge = await startTestBridge();
  try {
    const client = await connectClient(bridge.url, bridge.token);
    await expectType(await client.frames.next(), 'ready');
    client.send({ type: 'connect', agent: 'not-installed' });
    const frame = expectType(await client.frames.next(), 'error');
    assert.equal(frame.code, 'agent-unavailable');
  } finally {
    await bridge.close();
  }
});

test('a broken agent command reports the operating system error', async () => {
  const bridge = await startTestBridge();
  try {
    const client = await connectClient(bridge.url, bridge.token);
    await expectType(await client.frames.next(), 'ready');
    client.send({ type: 'connect', agent: 'broken' });
    const frame = expectType(await client.frames.next(), 'error');
    assert.equal(frame.code, 'spawn-failed');
    assert.match(frame.message, /ENOENT|not found|Could not start/);
  } finally {
    await bridge.close();
  }
});

test('the number of concurrent agents is capped', async () => {
  const bridge = await startTestBridge({ maxConnections: 1 });
  try {
    const first = await connectClient(bridge.url, bridge.token);
    await expectType(await first.frames.next(), 'ready');
    first.send({ type: 'connect', agent: 'fake' });
    await expectType(await first.frames.next(), 'connected');

    const second = await connectClient(bridge.url, bridge.token);
    await expectType(await second.frames.next(), 'ready');
    second.send({ type: 'connect', agent: 'fake' });
    const frame = expectType(await second.frames.next(), 'error');
    assert.equal(frame.code, 'too-many-connections');
  } finally {
    await bridge.close();
  }
});

test('rpc frames on an unbound socket are refused', async () => {
  const bridge = await startTestBridge();
  try {
    const client = await connectClient(bridge.url, bridge.token);
    await expectType(await client.frames.next(), 'ready');
    client.send({ type: 'rpc', message: { jsonrpc: '2.0', id: 1, method: 'initialize' } });
    const frame = expectType(await client.frames.next(), 'error');
    assert.equal(frame.code, 'not-bound');
  } finally {
    await bridge.close();
  }
});

test('ping is answered on bound and unbound sockets', async () => {
  const bridge = await startTestBridge();
  try {
    const client = await connectClient(bridge.url, bridge.token);
    await expectType(await client.frames.next(), 'ready');
    client.send({ type: 'ping' });
    expectType(await client.frames.next(), 'pong');

    client.send({ type: 'connect', agent: 'fake' });
    await expectType(await client.frames.next(), 'connected');
    client.send({ type: 'ping' });
    expectType(await client.frames.next(), 'pong');
  } finally {
    await bridge.close();
  }
});

test('disconnect without kill leaves the agent running', async () => {
  const bridge = await startTestBridge();
  try {
    const client = await connectClient(bridge.url, bridge.token);
    await expectType(await client.frames.next(), 'ready');
    client.send({ type: 'connect', agent: 'fake' });
    const connected = expectType(await client.frames.next(), 'connected');

    client.send({ type: 'disconnect' });
    assert.equal(bridge.server.connectionCount(), 1);

    const resumed = await connectClient(bridge.url, bridge.token);
    await expectType(await resumed.frames.next(), 'ready');
    resumed.send({ type: 'resume', connectionId: connected.connectionId, lastSeq: 0 });
    const resumedFrame = expectType(await resumed.frames.next(), 'connected');
    assert.equal(resumedFrame.resumed, true);
  } finally {
    await bridge.close();
  }
});

test('disconnect with kill stops the agent', async () => {
  const bridge = await startTestBridge();
  try {
    const client = await connectClient(bridge.url, bridge.token);
    await expectType(await client.frames.next(), 'ready');
    client.send({ type: 'connect', agent: 'fake' });
    await expectType(await client.frames.next(), 'connected');

    client.send({ type: 'disconnect', kill: true });
    await waitFor(() => bridge.server.connectionCount() === 0);
  } finally {
    await bridge.close();
  }
});

test('the workspace list contains the roots and their git children', async () => {
  const bridge = await startTestBridge();
  try {
    const client = await connectClient(bridge.url, bridge.token);
    await expectType(await client.frames.next(), 'ready');
    client.send({ type: 'list-workspaces' });
    const frame = expectType(await client.frames.next(), 'workspaces');
    assert.equal(frame.items.length, 1);
    assert.equal(frame.items[0]?.path, bridge.root);
    assert.equal(frame.items[0]?.isRoot, true);
  } finally {
    await bridge.close();
  }
});

test('a malformed frame is answered with a bad-request error', async () => {
  const bridge = await startTestBridge();
  try {
    const client = await connectClient(bridge.url, bridge.token);
    await expectType(await client.frames.next(), 'ready');
    client.socket.send('this is not json');
    const frame = expectType(await client.frames.next(), 'error');
    assert.equal(frame.code, 'bad-request');
  } finally {
    await bridge.close();
  }
});
