import assert from 'node:assert/strict';
import { mkdir } from 'node:fs/promises';
import { join } from 'node:path';
import { test } from 'node:test';
import type { BridgeSessionInfo } from './protocol.js';
import {
  connectClient,
  expectType,
  startTestBridge,
  type TestBridge,
  type TestClient,
} from './testHelpers.js';

async function openClient(bridge: TestBridge): Promise<TestClient> {
  const client = await connectClient(bridge.url, bridge.token);
  await expectType(await client.frames.next(), 'ready');
  return client;
}

async function listSessions(client: TestClient, reqId: string): Promise<BridgeSessionInfo[]> {
  client.send({ type: 'list-sessions', reqId });
  const reply = await client.frames.next((frame) => 'reqId' in frame && frame.reqId === reqId);
  return expectType(reply, 'sessions-result').sessions;
}

test('ready always advertises the sessions feature', async () => {
  const bridge = await startTestBridge();
  try {
    const client = await connectClient(bridge.url, bridge.token);
    const ready = expectType(await client.frames.next(), 'ready');
    assert.ok(ready.features?.includes('sessions'));
  } finally {
    await bridge.close();
  }
});

test('a connection without a session reports null cwd and sessionId', async () => {
  const bridge = await startTestBridge();
  try {
    const client = await openClient(bridge);
    client.send({ type: 'connect', agent: 'fake' });
    const connected = expectType(await client.frames.next(), 'connected');

    const sessions = await listSessions(client, 'a');
    assert.equal(sessions.length, 1);
    const [info] = sessions;
    assert.equal(info?.connectionId, connected.connectionId);
    assert.equal(info?.agentId, 'fake');
    assert.equal(info?.cwd, null);
    assert.equal(info?.sessionId, null);
    assert.equal(info?.attached, true);
    assert.equal(typeof info?.startedAt, 'number');
  } finally {
    await bridge.close();
  }
});

test('session/new records the session id from the response and the cwd from the request', async () => {
  const bridge = await startTestBridge();
  try {
    const project = join(bridge.root, 'project');
    await mkdir(project);
    const client = await openClient(bridge);
    client.send({ type: 'connect', agent: 'fake' });
    await expectType(await client.frames.next(), 'connected');
    client.send({
      type: 'rpc',
      message: { jsonrpc: '2.0', id: 11, method: 'session/new', params: { cwd: project } },
    });
    await client.frames.next((frame) => frame.type === 'rpc' && frame.message.id === 11);

    const [info] = await listSessions(client, 'b');
    assert.equal(info?.sessionId, 'fake-session');
    assert.equal(info?.cwd, project);
    assert.ok((info?.headSeq ?? 0) >= 1);
  } finally {
    await bridge.close();
  }
});

test('session/load records the requested session id and cwd', async () => {
  const bridge = await startTestBridge();
  try {
    const client = await openClient(bridge);
    client.send({ type: 'connect', agent: 'fake' });
    await expectType(await client.frames.next(), 'connected');
    client.send({
      type: 'rpc',
      message: {
        jsonrpc: '2.0',
        id: 12,
        method: 'session/load',
        params: { sessionId: 'loaded-1', cwd: bridge.root },
      },
    });
    await client.frames.next((frame) => frame.type === 'rpc' && frame.message.id === 12);

    const [info] = await listSessions(client, 'c');
    assert.equal(info?.sessionId, 'loaded-1');
    assert.equal(info?.cwd, bridge.root);
  } finally {
    await bridge.close();
  }
});

test('a rejected session/new does not record a session', async () => {
  const bridge = await startTestBridge();
  try {
    const client = await openClient(bridge);
    client.send({ type: 'connect', agent: 'fake' });
    await expectType(await client.frames.next(), 'connected');
    client.send({
      type: 'rpc',
      message: { jsonrpc: '2.0', id: 13, method: 'session/new', params: { cwd: '/' } },
    });
    await client.frames.next((frame) => frame.type === 'rpc' && frame.message.id === 13);

    const [info] = await listSessions(client, 'd');
    assert.equal(info?.sessionId, null);
    assert.equal(info?.cwd, null);
  } finally {
    await bridge.close();
  }
});

test('a detached connection is listed from another socket as not attached', async () => {
  const bridge = await startTestBridge();
  try {
    const first = await openClient(bridge);
    first.send({ type: 'connect', agent: 'fake' });
    await expectType(await first.frames.next(), 'connected');
    first.send({ type: 'disconnect' });

    const second = await openClient(bridge);
    const sessions = await listSessions(second, 'e');
    assert.equal(sessions.length, 1);
    assert.equal(sessions[0]?.attached, false);
  } finally {
    await bridge.close();
  }
});

test('a connection whose agent exited is not listed', async () => {
  const bridge = await startTestBridge();
  try {
    const client = await openClient(bridge);
    client.send({ type: 'connect', agent: 'fake' });
    await expectType(await client.frames.next(), 'connected');
    client.send({
      type: 'rpc',
      message: { jsonrpc: '2.0', id: 14, method: 'fake/exit', params: { code: 0 } },
    });
    await client.frames.next((frame) => frame.type === 'agent-exit');

    assert.deepEqual(await listSessions(client, 'f'), []);
  } finally {
    await bridge.close();
  }
});

test('list-sessions without a reqId is a bad-request', async () => {
  const bridge = await startTestBridge();
  try {
    const client = await openClient(bridge);
    client.send({ type: 'list-sessions' });
    const reply = expectType(await client.frames.next(), 'request-error');
    assert.equal(reply.code, 'bad-request');
  } finally {
    await bridge.close();
  }
});
