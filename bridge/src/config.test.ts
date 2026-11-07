import assert from 'node:assert/strict';
import { test } from 'node:test';
import { mkdtemp, stat, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { generateToken, readConfigFile, writeConfigFile } from './config.js';

test('generates a distinct 32 byte base64url token', () => {
  const token = generateToken();
  assert.equal(token.length, 43);
  assert.match(token, /^[A-Za-z0-9_-]+$/);
  assert.notEqual(token, generateToken());
});

test('stores the config with owner-only permissions and reads it back', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'bridge-config-'));
  const path = join(dir, 'nested', 'config.json');

  await writeConfigFile(path, { token: 'abc', roots: ['/tmp'] });

  const fileStats = await stat(path);
  assert.equal(fileStats.mode & 0o777, 0o600);
  const dirStats = await stat(join(dir, 'nested'));
  assert.equal(dirStats.mode & 0o777, 0o700);
  assert.deepEqual(await readConfigFile(path), { token: 'abc', roots: ['/tmp'] });
});

test('a missing config file reads as an empty config', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'bridge-config-'));
  assert.deepEqual(await readConfigFile(join(dir, 'missing.json')), {});
});

test('a broken config file fails loudly instead of silently resetting the token', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'bridge-config-'));
  const path = join(dir, 'config.json');
  await writeFile(path, '{ not json');
  await assert.rejects(() => readConfigFile(path), /not valid JSON/);
});
