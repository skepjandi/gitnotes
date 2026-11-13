import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdir, symlink, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { test } from 'node:test';
import type { ClientFrame, ServerFrame } from './protocol.js';
import {
  connectClient,
  expectType,
  startTestBridge,
  type TestBridge,
  type TestClient,
} from './testHelpers.js';

async function withClient(run: (client: TestClient, bridge: TestBridge) => Promise<void>): Promise<void> {
  const bridge = await startTestBridge();
  try {
    const client = await connectClient(bridge.url, bridge.token);
    await expectType(await client.frames.next(), 'ready');
    await run(client, bridge);
  } finally {
    await bridge.close();
  }
}

async function request<T extends ServerFrame['type']>(
  client: TestClient,
  frame: ClientFrame & { reqId: string },
  type: T,
): Promise<Extract<ServerFrame, { type: T }>> {
  client.send(frame);
  const reply = await client.frames.next(
    (candidate) => 'reqId' in candidate && candidate.reqId === frame.reqId,
  );
  return expectType(reply, type);
}

function git(cwd: string, ...args: string[]): string {
  return execFileSync('git', args, { cwd, encoding: 'utf8' });
}

function initRepo(cwd: string): void {
  git(cwd, 'init', '-q');
  git(cwd, 'config', 'user.email', 'test@example.com');
  git(cwd, 'config', 'user.name', 'Test');
  git(cwd, 'config', 'commit.gpgsign', 'false');
}

async function search(client: TestClient, cwd: string, query: string, limit?: number) {
  return request(client, { type: 'fs-search', reqId: `s-${query}`, cwd, query, limit }, 'fs-results');
}

test('ready advertises the features available on this host', async () => {
  const bridge = await startTestBridge();
  try {
    const client = await connectClient(bridge.url, bridge.token);
    const ready = expectType(await client.frames.next(), 'ready');
    assert.ok(ready.features?.includes('fs-search'));
    assert.ok(ready.features?.includes('git'));
  } finally {
    await bridge.close();
  }
});

test('fs-search ranks basename and prefix matches first and returns directories', async () => {
  await withClient(async (client, bridge) => {
    await mkdir(join(bridge.root, 'src/components'), { recursive: true });
    await writeFile(join(bridge.root, 'src/components/Button.tsx'), '');
    await writeFile(join(bridge.root, 'src/button-utils.ts'), '');
    await writeFile(join(bridge.root, 'docs-about-buttons.md'), '');
    await writeFile(join(bridge.root, 'README.md'), '');

    const reply = await search(client, bridge.root, 'BUTTON');
    assert.deepEqual(
      reply.items.map((item) => item.path),
      ['src/button-utils.ts', 'src/components/Button.tsx', 'docs-about-buttons.md'],
    );
    assert.equal(reply.truncated, false);

    const dirs = await search(client, bridge.root, 'components');
    assert.deepEqual(dirs.items[0], { path: 'src/components', isDir: true });

    const fuzzy = await search(client, bridge.root, 'rdm');
    assert.deepEqual(fuzzy.items.map((item) => item.path), ['README.md']);
  });
});

test('fs-search with an empty query lists top-level entries, directories first', async () => {
  await withClient(async (client, bridge) => {
    await mkdir(join(bridge.root, 'node_modules/pkg'), { recursive: true });
    await mkdir(join(bridge.root, 'src'));
    await writeFile(join(bridge.root, 'src/a.ts'), '');
    await writeFile(join(bridge.root, 'b.md'), '');
    const reply = await search(client, bridge.root, '');
    assert.deepEqual(reply.items, [
      { path: 'src', isDir: true },
      { path: 'b.md', isDir: false },
    ]);
  });
});

test('fs-search respects .gitignore in a git repo and skips node_modules outside one', async () => {
  await withClient(async (client, bridge) => {
    const repo = join(bridge.root, 'repo');
    await mkdir(join(repo, 'secret'), { recursive: true });
    await writeFile(join(repo, '.gitignore'), 'secret/\n');
    await writeFile(join(repo, 'secret/token.txt'), '');
    await writeFile(join(repo, 'token-notes.txt'), '');
    initRepo(repo);

    const reply = await search(client, repo, 'token');
    assert.deepEqual(reply.items.map((item) => item.path), ['token-notes.txt']);

    const plain = join(bridge.root, 'plain');
    await mkdir(join(plain, 'node_modules/dep'), { recursive: true });
    await writeFile(join(plain, 'node_modules/dep/index.js'), '');
    await writeFile(join(plain, 'index.js'), '');
    const walked = await search(client, plain, 'index');
    assert.deepEqual(walked.items.map((item) => item.path), ['index.js']);
  });
});

test('fs-search clamps the limit and flags truncation', async () => {
  await withClient(async (client, bridge) => {
    for (let index = 0; index < 5; index += 1) await writeFile(join(bridge.root, `file-${index}.txt`), '');
    const small = await search(client, bridge.root, 'file', 2);
    assert.equal(small.items.length, 2);
    assert.equal(small.truncated, true);

    for (let index = 0; index < 220; index += 1) await writeFile(join(bridge.root, `many-${index}.txt`), '');
    const capped = await search(client, bridge.root, 'many', 10_000);
    assert.equal(capped.items.length, 200);
    assert.equal(capped.truncated, true);

    const dflt = await search(client, bridge.root, 'many');
    assert.equal(dflt.items.length, 50);
  });
});

test('fs-search lists symlinks without following them', async () => {
  await withClient(async (client, bridge) => {
    await mkdir(join(bridge.root, 'real'));
    await writeFile(join(bridge.root, 'real/inner.txt'), '');
    await symlink(join(bridge.root, 'real'), join(bridge.root, 'link'));
    const reply = await search(client, bridge.root, 'inner');
    assert.deepEqual(reply.items.map((item) => item.path), ['real/inner.txt']);
  });
});

test('request frames reject a cwd outside the roots', async () => {
  await withClient(async (client) => {
    const outside = await request(
      client,
      { type: 'fs-search', reqId: 'x', cwd: '/', query: 'a' },
      'request-error',
    );
    assert.equal(outside.code, 'forbidden-cwd');
    const relative = await request(
      client,
      { type: 'git', reqId: 'y', cwd: 'relative', op: { kind: 'status' } },
      'request-error',
    );
    assert.equal(relative.code, 'forbidden-cwd');
    client.send({ type: 'ping' });
    await client.frames.nextOfType('pong');
  });
});

test('ill-formed request frames answer bad-request and keep the socket open', async () => {
  await withClient(async (client, bridge) => {
    const noQuery = await request(
      client,
      { type: 'fs-search', reqId: 'a', cwd: bridge.root } as unknown as ClientFrame & { reqId: string },
      'request-error',
    );
    assert.equal(noQuery.code, 'bad-request');
    const noOp = await request(
      client,
      { type: 'git', reqId: 'b', cwd: bridge.root, op: {} } as unknown as ClientFrame & {
        reqId: string;
      },
      'request-error',
    );
    assert.equal(noOp.code, 'bad-request');
    client.send({ type: 'git', cwd: bridge.root, op: { kind: 'status' } });
    const noReqId = expectType(await client.frames.next(), 'request-error');
    assert.equal(noReqId.code, 'bad-request');
    assert.equal(noReqId.reqId, '');
    client.send({ type: 'ping' });
    expectType(await client.frames.next(), 'pong');
  });
});

test('git outside a repository answers not-a-repo', async () => {
  await withClient(async (client, bridge) => {
    const reply = await request(
      client,
      { type: 'git', reqId: 'r', cwd: bridge.root, op: { kind: 'status' } },
      'request-error',
    );
    assert.equal(reply.reqId, 'r');
    assert.equal(reply.code, 'not-a-repo');
  });
});

test('git status, diff, stage, unstage and commit round trip on an unbound socket', async () => {
  await withClient(async (client, bridge) => {
    const cwd = bridge.root;
    initRepo(cwd);
    await writeFile(join(cwd, 'a.txt'), 'one\n');
    await writeFile(join(cwd, 'old name.txt'), 'rename me\nplease\nnow\n');
    git(cwd, 'add', '.');
    git(cwd, 'commit', '-q', '-m', 'init');

    let id = 0;
    const op = async <T extends ServerFrame['type']>(gitOp: Parameters<typeof runOp>[2], type: T) =>
      runOp(client, cwd, gitOp, type, `g${(id += 1)}`);

    await writeFile(join(cwd, 'a.txt'), 'one\ntwo\n');
    await writeFile(join(cwd, 'new.txt'), 'fresh\n');
    git(cwd, 'mv', 'old name.txt', 'renamed.txt');

    const status = (await op({ kind: 'status' }, 'git-result')).result;
    assert.ok(status.kind === 'status');
    assert.ok(status.branch);
    assert.equal(status.ahead, 0);
    const byPath = Object.fromEntries(status.files.map((file) => [file.path, file]));
    assert.deepEqual(byPath['a.txt'], { path: 'a.txt', status: 'modified', staged: false, unstaged: true });
    assert.deepEqual(byPath['new.txt'], { path: 'new.txt', status: 'untracked', staged: false, unstaged: true });
    assert.deepEqual(byPath['renamed.txt'], {
      path: 'renamed.txt',
      from: 'old name.txt',
      status: 'renamed',
      staged: true,
      unstaged: false,
    });

    const unstaged = (await op({ kind: 'diff', path: 'a.txt', staged: false }, 'git-result')).result;
    assert.ok(unstaged.kind === 'diff');
    assert.match(unstaged.patch, /\+two/);
    assert.equal(unstaged.truncated, false);

    const untracked = (await op({ kind: 'diff', path: 'new.txt', staged: false }, 'git-result')).result;
    assert.ok(untracked.kind === 'diff');
    assert.match(untracked.patch, /\+fresh/);

    assert.deepEqual((await op({ kind: 'stage', paths: ['a.txt', 'new.txt'] }, 'git-result')).result, {
      kind: 'ok',
    });
    const staged = (await op({ kind: 'diff', path: 'a.txt', staged: true }, 'git-result')).result;
    assert.ok(staged.kind === 'diff');
    assert.match(staged.patch, /\+two/);

    await op({ kind: 'unstage', paths: ['new.txt'] }, 'git-result');
    assert.match(git(cwd, 'status', '--porcelain'), /\?\? new\.txt/);

    const empty = await op({ kind: 'commit', message: '   ' }, 'request-error');
    assert.equal(empty.code, 'bad-request');

    const committed = (await op({ kind: 'commit', message: 'second commit\n\nbody' }, 'git-result')).result;
    assert.ok(committed.kind === 'commit');
    assert.equal(committed.summary, 'second commit');
    assert.equal(committed.hash, git(cwd, 'rev-parse', '--short', 'HEAD').trim());

    const nothing = await op({ kind: 'commit', message: 'again' }, 'request-error');
    assert.equal(nothing.code, 'git-failed');
    assert.ok(nothing.message.length > 0 && nothing.message.length <= 500);
  });
});

async function runOp<T extends ServerFrame['type']>(
  client: TestClient,
  cwd: string,
  op: Extract<ClientFrame, { type: 'git' }>['op'],
  type: T,
  reqId: string,
) {
  return request(client, { type: 'git', reqId, cwd, op }, type);
}

test('git unstage works in a repository without commits, from a subdirectory cwd', async () => {
  await withClient(async (client, bridge) => {
    initRepo(bridge.root);
    await mkdir(join(bridge.root, 'sub'));
    await writeFile(join(bridge.root, 'sub/f.txt'), 'x\n');
    git(bridge.root, 'add', '.');
    const cwd = join(bridge.root, 'sub');
    const ok = await runOp(client, cwd, { kind: 'unstage', paths: ['sub/f.txt'] }, 'git-result', 'u1');
    assert.deepEqual(ok.result, { kind: 'ok' });
    assert.match(git(bridge.root, 'status', '--porcelain'), /\?\? sub\//);
  });
});

test('git rejects unsafe paths', async () => {
  await withClient(async (client, bridge) => {
    initRepo(bridge.root);
    for (const path of ['../outside', '/etc/passwd', '-rf', 'a/../../b', '']) {
      const reply = await runOp(client, bridge.root, { kind: 'stage', paths: [path] }, 'request-error', `p-${path}`);
      assert.equal(reply.code, 'bad-request', path);
    }
    const diff = await runOp(client, bridge.root, { kind: 'diff', path: '../x', staged: false }, 'request-error', 'd');
    assert.equal(diff.code, 'bad-request');
  });
});

test('git truncates oversized patches', async () => {
  await withClient(async (client, bridge) => {
    initRepo(bridge.root);
    await writeFile(join(bridge.root, 'big.txt'), 'line of text\n'.repeat(40_000));
    const reply = await runOp(client, bridge.root, { kind: 'diff', path: 'big.txt', staged: false }, 'git-result', 'big');
    assert.ok(reply.result.kind === 'diff');
    assert.equal(reply.result.truncated, true);
    assert.equal(Buffer.byteLength(reply.result.patch), 200 * 1024);
  });
});

test('ports reports listening ports of the agent and its descendants', async () => {
  await withClient(async (client) => {
    client.send({ type: 'connect', agent: 'fake' });
    const connected = expectType(await client.frames.nextOfType('connected'), 'connected');

    const ask = async (id: number, method: string) => {
      client.send({ type: 'rpc', message: { jsonrpc: '2.0', id, method } });
      const frame = await client.frames.next(
        (candidate) => candidate.type === 'rpc' && candidate.message.id === id,
      );
      return expectType(frame, 'rpc').message.result as { port: number };
    };
    const own = await ask(1, 'fake/listen');
    const child = await ask(2, 'fake/listen-child');

    const reply = await request(
      client,
      { type: 'ports', reqId: 'p', connectionId: connected.connectionId },
      'ports-result',
    );
    const ports = reply.ports.map((entry) => entry.port);
    assert.ok(ports.includes(own.port), `own port ${own.port} in ${ports}`);
    assert.ok(ports.includes(child.port), `child port ${child.port} in ${ports}`);
    assert.deepEqual(ports, [...ports].sort((a, b) => a - b));
    assert.equal(new Set(ports).size, ports.length);

    const unknown = await request(
      client,
      { type: 'ports', reqId: 'q', connectionId: 'nope' },
      'request-error',
    );
    assert.equal(unknown.code, 'unknown-connection');
  });
});
