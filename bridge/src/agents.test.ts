import assert from 'node:assert/strict';
import { test } from 'node:test';
import { chmod, mkdtemp, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { AGENT_PRESETS, isExecutableOnPath, resolveAgents, toAgentInfo } from './agents.js';

test('finds an executable through PATH', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'bridge-path-'));
  const binary = join(dir, 'mytool');
  await writeFile(binary, '#!/bin/sh\n');
  await chmod(binary, 0o755);

  assert.equal(isExecutableOnPath('mytool', dir), true);
  assert.equal(isExecutableOnPath('mytool', `${dir}:/nowhere`), true);
  assert.equal(isExecutableOnPath('mytool', '/nowhere'), false);
  assert.equal(isExecutableOnPath('missing', dir), false);
});

test('a file without the execute bit is not available', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'bridge-path-'));
  const binary = join(dir, 'notrunnable');
  await writeFile(binary, '#!/bin/sh\n');
  await chmod(binary, 0o644);

  assert.equal(isExecutableOnPath('notrunnable', dir), false);
});

test('an absolute path is checked directly', async () => {
  assert.equal(isExecutableOnPath(process.execPath), true);
  assert.equal(isExecutableOnPath(join(tmpdir(), 'definitely-not-here')), false);
});

test('every preset ships a command line and a probe binary', () => {
  for (const preset of AGENT_PRESETS) {
    assert.ok(preset.id.length > 0);
    assert.ok(preset.command.length > 0);
    assert.ok(preset.probe.length > 0);
  }
  assert.deepEqual(
    AGENT_PRESETS.map((preset) => preset.id),
    ['claude', 'opencode', 'pi', 'codex', 'gemini'],
  );
});

test('config agents extend the presets', () => {
  const agents = resolveAgents([{ id: 'my-agent', name: 'Mine', command: 'my-acp', args: ['--stdio'] }]);
  const mine = agents.find((agent) => agent.id === 'my-agent');
  assert.ok(mine);
  assert.equal(mine.command, 'my-acp');
  assert.deepEqual(mine.args, ['--stdio']);
  assert.equal(agents.length, AGENT_PRESETS.length + 1);
});

test('config agents override a preset by id but keep its probe binary', () => {
  const agents = resolveAgents([
    { id: 'claude', name: 'Claude (local)', command: 'npx', args: ['-y', 'other-acp'] },
  ]);
  const claude = agents.find((agent) => agent.id === 'claude');
  assert.ok(claude);
  assert.equal(claude.name, 'Claude (local)');
  assert.deepEqual(claude.args, ['-y', 'other-acp']);
  assert.equal(claude.probe, 'claude');
  assert.equal(agents.length, AGENT_PRESETS.length);
});

test('overriding a preset with another binary switches the probe', () => {
  const agents = resolveAgents([{ id: 'claude', command: '/opt/acp/claude' }]);
  const claude = agents.find((agent) => agent.id === 'claude');
  assert.ok(claude);
  assert.equal(claude.probe, '/opt/acp/claude');
});

test('the agent info carries the full command line and availability', () => {
  const info = toAgentInfo({
    id: 'opencode',
    name: 'OpenCode',
    command: 'opencode',
    args: ['acp'],
    env: {},
    probe: process.execPath,
  });
  assert.equal(info.command, 'opencode acp');
  assert.equal(info.available, true);
});
