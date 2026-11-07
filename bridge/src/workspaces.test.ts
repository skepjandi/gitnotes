import assert from 'node:assert/strict';
import { test } from 'node:test';
import { mkdir, mkdtemp, realpath, symlink, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { basename, join } from 'node:path';
import { listWorkspaces } from './workspaces.js';

async function makeRepo(path: string): Promise<void> {
  await mkdir(join(path, '.git'), { recursive: true });
  await writeFile(join(path, '.git', 'HEAD'), 'ref: refs/heads/main\n');
}

test('lists the roots and their direct git children', async () => {
  const root = await realpath(await mkdtemp(join(tmpdir(), 'bridge-workspaces-')));
  await makeRepo(join(root, 'alpha'));
  await mkdir(join(root, 'plain'));

  const items = await listWorkspaces([root]);

  assert.deepEqual(
    items.map((item) => [item.name, item.isRoot]),
    [
      [basename(root), true],
      ['alpha', false],
    ],
  );
  assert.equal(items[1]?.path, join(root, 'alpha'));
});

test('skips children that resolve outside their root', async () => {
  const base = await realpath(await mkdtemp(join(tmpdir(), 'bridge-workspaces-')));
  const root = join(base, 'root');
  const outside = join(base, 'outside');
  await mkdir(root, { recursive: true });
  await makeRepo(outside);
  await symlink(outside, join(root, 'escape'), 'dir');

  const items = await listWorkspaces([root]);

  assert.deepEqual(
    items.map((item) => item.name),
    ['root'],
  );
});

test('missing roots are ignored', async () => {
  const items = await listWorkspaces([join(tmpdir(), 'bridge-does-not-exist-1234')]);
  assert.deepEqual(items, []);
});

test('the list is capped', async () => {
  const root = await realpath(await mkdtemp(join(tmpdir(), 'bridge-workspaces-')));
  for (let index = 0; index < 5; index += 1) {
    await makeRepo(join(root, `repo-${index}`));
  }
  const items = await listWorkspaces([root], 3);
  assert.equal(items.length, 3);
});
