import assert from 'node:assert/strict';
import { mkdtemp, realpath, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { WebSocket } from 'ws';
import type { AgentDefinition } from './agents.js';
import type { ServerFrame } from './protocol.js';
import { BridgeServer, type BridgeServerOptions } from './server.js';

export const FIXTURE_PATH = fileURLToPath(new URL('../test/fixtures/fake-agent.js', import.meta.url));

export function fakeAgent(overrides: Partial<AgentDefinition> = {}): AgentDefinition {
  return {
    id: 'fake',
    name: 'Fake ACP agent',
    command: process.execPath,
    args: [FIXTURE_PATH],
    env: {},
    probe: process.execPath,
    ...overrides,
  };
}

export interface TestBridge {
  server: BridgeServer;
  url: string;
  token: string;
  root: string;
  close(): Promise<void>;
}

export async function startTestBridge(
  options: Partial<BridgeServerOptions> = {},
): Promise<TestBridge> {
  const root = await realpath(await mkdtemp(join(tmpdir(), 'gitnotes-bridge-test-')));
  const token = options.token ?? 'test-token';
  const server = new BridgeServer({
    host: '127.0.0.1',
    port: 0,
    token,
    roots: [root],
    agents: [
      fakeAgent(),
      fakeAgent({ id: 'not-installed', probe: 'gitnotes-bridge-missing-binary' }),
      fakeAgent({ id: 'broken', command: '/nonexistent/gitnotes-bridge/acp' }),
    ],
    ...options,
  });
  const { port } = await server.listen();
  return {
    server,
    url: `ws://127.0.0.1:${port}`,
    token,
    root,
    close: async () => {
      await server.close();
      await rm(root, { recursive: true, force: true });
    },
  };
}

interface FrameWaiter {
  predicate: (frame: ServerFrame) => boolean;
  resolve: (frame: ServerFrame) => void;
  timer: NodeJS.Timeout;
}

/** Buffers server frames so tests can await the next one that matches. */
export class FrameCollector {
  private readonly frames: ServerFrame[] = [];
  private readonly waiters: FrameWaiter[] = [];

  constructor(socket: WebSocket) {
    socket.on('message', (data) => {
      this.deliver(JSON.parse(rawToText(data)) as ServerFrame);
    });
  }

  private deliver(frame: ServerFrame): void {
    const index = this.waiters.findIndex((waiter) => waiter.predicate(frame));
    const waiter = index === -1 ? undefined : this.waiters.splice(index, 1)[0];
    if (!waiter) {
      this.frames.push(frame);
      return;
    }
    clearTimeout(waiter.timer);
    waiter.resolve(frame);
  }

  next(predicate: (frame: ServerFrame) => boolean = () => true, timeoutMs = 5000): Promise<ServerFrame> {
    const index = this.frames.findIndex(predicate);
    const buffered = index === -1 ? undefined : this.frames.splice(index, 1)[0];
    if (buffered) return Promise.resolve(buffered);

    return new Promise<ServerFrame>((resolve, reject) => {
      const timer = setTimeout(() => {
        const waiterIndex = this.waiters.findIndex((candidate) => candidate.timer === timer);
        if (waiterIndex !== -1) this.waiters.splice(waiterIndex, 1);
        reject(new Error(`Timed out waiting for a frame. Received: ${JSON.stringify(this.frames)}`));
      }, timeoutMs);
      this.waiters.push({ predicate, resolve, timer });
    });
  }

  nextOfType(type: ServerFrame['type'], timeoutMs = 5000): Promise<ServerFrame> {
    return this.next((frame) => frame.type === type, timeoutMs);
  }
}

export interface TestClient {
  socket: WebSocket;
  frames: FrameCollector;
  send(frame: unknown): void;
}

export async function connectClient(url: string, token: string, auth = true): Promise<TestClient> {
  const socket = new WebSocket(url);
  // The listener is attached before the handshake so no early frame is lost.
  const frames = new FrameCollector(socket);
  await new Promise<void>((resolve, reject) => {
    socket.once('open', () => resolve());
    socket.once('error', reject);
  });
  const client: TestClient = {
    socket,
    frames,
    send: (frame: unknown) => socket.send(JSON.stringify(frame)),
  };
  if (auth) client.send({ type: 'auth', token, protocol: 1 });
  return client;
}

export function waitForClose(socket: WebSocket, timeoutMs = 5000): Promise<void> {
  return new Promise<void>((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error('Socket did not close')), timeoutMs);
    socket.once('close', () => {
      clearTimeout(timer);
      resolve();
    });
  });
}

export function delay(ms: number): Promise<void> {
  return new Promise<void>((resolve) => {
    const timer = setTimeout(resolve, ms);
    timer.unref?.();
  });
}

/** Polls until the condition holds; used instead of guessing a sleep duration. */
export async function waitFor(condition: () => boolean, timeoutMs = 5000): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  while (!condition()) {
    if (Date.now() > deadline) throw new Error('Timed out waiting for the condition');
    await delay(10);
  }
}

/** Narrows a frame to the union member with the given discriminator. */
export function expectType<T extends ServerFrame['type']>(
  frame: ServerFrame,
  type: T,
): Extract<ServerFrame, { type: T }> {
  assert.strictEqual(frame.type, type, `expected a "${type}" frame, got "${frame.type}"`);
  // The assertion above proves the discriminator, the cast carries it to the caller.
  return frame as Extract<ServerFrame, { type: T }>;
}

function rawToText(data: WebSocket.RawData): string {
  if (typeof data === 'string') return data;
  if (Buffer.isBuffer(data)) return data.toString('utf8');
  if (Array.isArray(data)) return Buffer.concat(data).toString('utf8');
  return Buffer.from(data).toString('utf8');
}
