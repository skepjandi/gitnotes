#!/usr/bin/env node
/**
 * Fake ACP agent used by the bridge tests. Speaks NDJSON on stdio:
 * answers `initialize`, streams numbered notifications, asks the client for
 * permission, and can write raw bytes to exercise the line decoder.
 */
import { createInterface } from 'node:readline';

const write = (message) => {
  process.stdout.write(`${JSON.stringify(message)}\n`);
};

const handle = (message) => {
  const { id, method, params } = message;

  if (!method) {
    write({ jsonrpc: '2.0', method: 'fake/answered', params: { id } });
    return;
  }

  switch (method) {
    case 'initialize':
      write({
        jsonrpc: '2.0',
        id,
        result: {
          protocolVersion: 1,
          agentCapabilities: {
            loadSession: true,
            promptCapabilities: { image: false, audio: false, embeddedContext: true },
          },
          authMethods: [],
        },
      });
      break;
    case 'session/new':
    case 'session/load':
    case 'session/resume':
    case 'session/fork':
      write({
        jsonrpc: '2.0',
        id,
        result: { sessionId: 'fake-session', cwd: params?.cwd ?? null },
      });
      break;
    case 'fake/echo':
      write({ jsonrpc: '2.0', id, result: params ?? null });
      break;
    case 'fake/stream': {
      const count = Number(params?.count ?? 3);
      const delay = Number(params?.delayMs ?? 5);
      for (let index = 1; index <= count; index += 1) {
        setTimeout(() => {
          write({ jsonrpc: '2.0', method: 'session/update', params: { index } });
        }, index * delay);
      }
      break;
    }
    case 'fake/request':
      write({
        jsonrpc: '2.0',
        id: params?.requestId ?? 'req-1',
        method: 'session/request_permission',
        params: { question: 'Allow this command?' },
      });
      break;
    case 'fake/raw': {
      const parts = Array.isArray(params?.parts) ? params.parts : [String(params?.text ?? '')];
      parts.forEach((part, index) => {
        setTimeout(() => {
          process.stdout.write(part);
        }, index * 10);
      });
      break;
    }
    case 'fake/stderr':
      process.stderr.write(`${params?.text ?? 'fake stderr line'}\n`);
      break;
    case 'fake/exit': {
      const code = Number(params?.code ?? 0);
      setTimeout(() => {
        process.exitCode = code;
        process.stdin.pause();
        process.stdin.destroy();
      }, 30);
      break;
    }
    default:
      if (id !== undefined) {
        write({
          jsonrpc: '2.0',
          id,
          error: { code: -32601, message: `unknown method ${method}` },
        });
      }
  }
};

createInterface({ input: process.stdin }).on('line', (line) => {
  const trimmed = line.trim();
  if (!trimmed) return;
  try {
    handle(JSON.parse(trimmed));
  } catch {
    /* the bridge only ever sends JSON */
  }
});
