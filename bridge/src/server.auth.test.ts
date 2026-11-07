import assert from 'node:assert/strict';
import { test } from 'node:test';
import { connectClient, expectType, startTestBridge, waitForClose } from './testHelpers.js';

test('a wrong token is rejected and the socket is closed', async () => {
  const bridge = await startTestBridge();
  try {
    const client = await connectClient(bridge.url, 'not-the-token');
    const frame = expectType(await client.frames.next(), 'error');
    assert.equal(frame.code, 'unauthorized');
    await waitForClose(client.socket);
  } finally {
    await bridge.close();
  }
});

test('a mismatched protocol version is rejected', async () => {
  const bridge = await startTestBridge();
  try {
    const client = await connectClient(bridge.url, bridge.token, false);
    client.send({ type: 'auth', token: bridge.token, protocol: 99 });
    const frame = expectType(await client.frames.next(), 'error');
    assert.equal(frame.code, 'protocol-mismatch');
    await waitForClose(client.socket);
  } finally {
    await bridge.close();
  }
});

test('the first frame must be auth', async () => {
  const bridge = await startTestBridge();
  try {
    const client = await connectClient(bridge.url, bridge.token, false);
    client.send({ type: 'ping' });
    const frame = expectType(await client.frames.next(), 'error');
    assert.equal(frame.code, 'unauthorized');
    await waitForClose(client.socket);
  } finally {
    await bridge.close();
  }
});

test('a socket that never authenticates is closed after the timeout', async () => {
  const bridge = await startTestBridge({ authTimeoutMs: 150 });
  try {
    const client = await connectClient(bridge.url, bridge.token, false);
    const frame = expectType(await client.frames.next(), 'error');
    assert.equal(frame.code, 'unauthorized');
    await waitForClose(client.socket);
  } finally {
    await bridge.close();
  }
});

test('a valid token yields a ready frame with the agents and roots', async () => {
  const bridge = await startTestBridge();
  try {
    const client = await connectClient(bridge.url, bridge.token);
    const ready = expectType(await client.frames.next(), 'ready');
    assert.equal(ready.protocol, 1);
    assert.equal(ready.agents.some((agent) => agent.id === 'fake'), true);
    assert.equal(ready.agents.find((agent) => agent.id === 'fake')?.available, true);
    assert.deepEqual(ready.roots, [bridge.root]);
  } finally {
    await bridge.close();
  }
});

test('five failed attempts block the ip for a while', async () => {
  const bridge = await startTestBridge({ authBlockMs: 60_000 });
  try {
    for (let attempt = 0; attempt < 5; attempt += 1) {
      const client = await connectClient(bridge.url, 'wrong');
      const frame = expectType(await client.frames.next(), 'error');
      assert.equal(frame.code, 'unauthorized');
      await waitForClose(client.socket);
    }

    const blocked = await connectClient(bridge.url, bridge.token);
    const frame = expectType(await blocked.frames.next(), 'error');
    assert.equal(frame.code, 'unauthorized');
    await waitForClose(blocked.socket);
  } finally {
    await bridge.close();
  }
});

test('a successful authentication resets the failure counter', async () => {
  const bridge = await startTestBridge();
  try {
    for (let attempt = 0; attempt < 4; attempt += 1) {
      const client = await connectClient(bridge.url, 'wrong');
      await client.frames.next();
      await waitForClose(client.socket);
    }

    const good = await connectClient(bridge.url, bridge.token);
    expectType(await good.frames.next(), 'ready');

    for (let attempt = 0; attempt < 4; attempt += 1) {
      const client = await connectClient(bridge.url, 'wrong');
      await client.frames.next();
      await waitForClose(client.socket);
    }

    const stillGood = await connectClient(bridge.url, bridge.token);
    expectType(await stillGood.frames.next(), 'ready');
  } finally {
    await bridge.close();
  }
});
