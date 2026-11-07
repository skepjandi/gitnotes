import assert from 'node:assert/strict';
import { test } from 'node:test';
import { mkdir, mkdtemp, realpath, symlink } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { connectClient, expectType, startTestBridge } from './testHelpers.js';

async function expectRejectedCwd(cwd: string): Promise<void> {
  const bridge = await startTestBridge();
  try {
    const client = await connectClient(bridge.url, bridge.token);
    await expectType(await client.frames.next(), 'ready');
    client.send({ type: 'connect', agent: 'fake' });
    await expectType(await client.frames.next(), 'connected');

    client.send({
      type: 'rpc',
      message: { jsonrpc: '2.0', id: 7, method: 'session/new', params: { cwd } },
    });

    const error = expectType(await client.frames.next(), 'error');
    assert.equal(error.code, 'forbidden-cwd');

    const reply = expectType(await client.frames.next(), 'rpc');
    assert.equal(reply.message.id, 7);
    assert.equal(reply.message.result, undefined);
    const rpcError = reply.message.error;
    assert.ok(rpcError);
    assert.equal(rpcError.code, -32602);
    assert.match(rpcError.message, /cwd/);
  } finally {
    await bridge.close();
  }
}

test('a cwd inside the root reaches the agent', async () => {
  const bridge = await startTestBridge();
  try {
    const client = await connectClient(bridge.url, bridge.token);
    await expectType(await client.frames.next(), 'ready');
    client.send({ type: 'connect', agent: 'fake' });
    await expectType(await client.frames.next(), 'connected');

    client.send({
      type: 'rpc',
      message: { jsonrpc: '2.0', id: 3, method: 'session/new', params: { cwd: bridge.root } },
    });

    const reply = expectType(await client.frames.next(), 'rpc');
    const result = reply.message.result as { cwd?: string };
    assert.equal(result.cwd, bridge.root);
  } finally {
    await bridge.close();
  }
});

test('a cwd below the root reaches the agent', async () => {
  const bridge = await startTestBridge();
  try {
    const child = join(bridge.root, 'project');
    await mkdir(child, { recursive: true });

    const client = await connectClient(bridge.url, bridge.token);
    await expectType(await client.frames.next(), 'ready');
    client.send({ type: 'connect', agent: 'fake' });
    await expectType(await client.frames.next(), 'connected');

    client.send({
      type: 'rpc',
      message: { jsonrpc: '2.0', id: 4, method: 'session/load', params: { cwd: child } },
    });

    const reply = expectType(await client.frames.next(), 'rpc');
    const result = reply.message.result as { cwd?: string };
    assert.equal(result.cwd, child);
  } finally {
    await bridge.close();
  }
});

test('a cwd outside the root is refused', async () => {
  await expectRejectedCwd('/etc');
});

test('a relative cwd is refused', async () => {
  await expectRejectedCwd('relative/path');
});

test('a cwd that does not exist is refused', async () => {
  await expectRejectedCwd('/definitely/not/here/gitnotes-bridge');
});

test('a sibling directory with the same prefix is refused', async () => {
  const base = await realpath(await mkdtemp(join(tmpdir(), 'bridge-cwd-')));
  const root = join(base, 'root');
  const sibling = join(base, 'root-evil');
  await mkdir(root, { recursive: true });
  await mkdir(sibling, { recursive: true });

  const bridge = await startTestBridge({ roots: [root] });
  try {
    const client = await connectClient(bridge.url, bridge.token);
    await expectType(await client.frames.next(), 'ready');
    client.send({ type: 'connect', agent: 'fake' });
    await expectType(await client.frames.next(), 'connected');

    client.send({
      type: 'rpc',
      message: { jsonrpc: '2.0', id: 5, method: 'session/new', params: { cwd: sibling } },
    });

    const error = expectType(await client.frames.next(), 'error');
    assert.equal(error.code, 'forbidden-cwd');
  } finally {
    await bridge.close();
  }
});

test('a symlink that escapes the root is refused', async () => {
  const base = await realpath(await mkdtemp(join(tmpdir(), 'bridge-cwd-')));
  const root = join(base, 'root');
  const outside = join(base, 'outside');
  await mkdir(root, { recursive: true });
  await mkdir(outside, { recursive: true });
  await symlink(outside, join(root, 'escape'), 'dir');

  const bridge = await startTestBridge({ roots: [root] });
  try {
    const client = await connectClient(bridge.url, bridge.token);
    await expectType(await client.frames.next(), 'ready');
    client.send({ type: 'connect', agent: 'fake' });
    await expectType(await client.frames.next(), 'connected');

    client.send({
      type: 'rpc',
      message: {
        jsonrpc: '2.0',
        id: 6,
        method: 'session/new',
        params: { cwd: join(root, 'escape') },
      },
    });

    const error = expectType(await client.frames.next(), 'error');
    assert.equal(error.code, 'forbidden-cwd');
  } finally {
    await bridge.close();
  }
});

test('messages that do not pick a working directory are forwarded untouched', async () => {
  const bridge = await startTestBridge();
  try {
    const client = await connectClient(bridge.url, bridge.token);
    await expectType(await client.frames.next(), 'ready');
    client.send({ type: 'connect', agent: 'fake' });
    await expectType(await client.frames.next(), 'connected');

    client.send({
      type: 'rpc',
      message: { jsonrpc: '2.0', id: 8, method: 'fake/echo', params: { text: 'hello' } },
    });

    const reply = expectType(await client.frames.next(), 'rpc');
    const result = reply.message.result as { text?: string };
    assert.equal(result.text, 'hello');
  } finally {
    await bridge.close();
  }
});
