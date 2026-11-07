#!/usr/bin/env node
/**
 * Smoke test against the real `opencode acp` agent.
 * Skips (exit code 0) when opencode is not installed on this host.
 */
import { WebSocket } from 'ws';
import { isExecutableOnPath, resolveAgents } from '../dist/agents.js';
import { BridgeServer } from '../dist/server.js';

const TOKEN = 'smoke-token';
const TIMEOUT_MS = 60_000;

const opencode = resolveAgents().find((agent) => agent.id === 'opencode');
if (!opencode || !isExecutableOnPath(opencode.probe)) {
  console.log('SKIP: opencode is not on PATH, nothing to smoke test.');
  process.exit(0);
}

const server = new BridgeServer({
  host: '127.0.0.1',
  port: 0,
  token: TOKEN,
  roots: [process.cwd()],
  agents: [opencode],
});
const { port } = await server.listen();
const url = `ws://127.0.0.1:${port}`;

const socket = new WebSocket(url);
const frames = [];
const waiters = [];

socket.on('message', (data) => {
  const frame = JSON.parse(data.toString());
  frames.push(frame);
  const index = waiters.findIndex((waiter) => waiter.predicate(frame));
  if (index !== -1) {
    const [waiter] = waiters.splice(index, 1);
    clearTimeout(waiter.timer);
    waiter.resolve(frame);
  }
});

const next = (predicate, timeoutMs = TIMEOUT_MS) =>
  new Promise((resolve, reject) => {
    const existing = frames.findIndex(predicate);
    if (existing !== -1) {
      const [frame] = frames.splice(existing, 1);
      resolve(frame);
      return;
    }
    const timer = setTimeout(
      () => reject(new Error(`Timed out. Frames so far: ${JSON.stringify(frames, null, 2)}`)),
      timeoutMs,
    );
    waiters.push({ predicate, resolve, timer });
  });

const send = (frame) => socket.send(JSON.stringify(frame));

try {
  await new Promise((resolve, reject) => {
    socket.once('open', resolve);
    socket.once('error', reject);
  });

  send({ type: 'auth', token: TOKEN, protocol: 1 });
  const ready = await next((frame) => frame.type === 'ready');
  console.log('ready:', JSON.stringify(ready.agents));

  send({ type: 'connect', agent: 'opencode' });
  const connected = await next((frame) => frame.type === 'connected');
  console.log('connected:', JSON.stringify(connected));

  send({
    type: 'rpc',
    message: {
      jsonrpc: '2.0',
      id: 1,
      method: 'initialize',
      params: {
        protocolVersion: 1,
        clientCapabilities: {
          fs: { readTextFile: false, writeTextFile: false },
          terminal: false,
        },
      },
    },
  });

  const reply = await next((frame) => frame.type === 'rpc');
  console.log('initialize reply:', JSON.stringify(reply, null, 2));

  const result = reply.message?.result;
  if (!result || typeof result !== 'object') {
    throw new Error('The agent did not answer initialize with a result');
  }
  if (!('agentCapabilities' in result)) {
    throw new Error('The initialize result does not carry agentCapabilities');
  }

  console.log('SMOKE OK: opencode answered initialize with agentCapabilities.');
} catch (error) {
  console.error(`SMOKE FAILED: ${error.message}`);
  process.exitCode = 1;
} finally {
  socket.close();
  await server.close();
}
