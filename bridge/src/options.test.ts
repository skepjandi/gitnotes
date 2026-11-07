import assert from 'node:assert/strict';
import { test } from 'node:test';
import { buildPairingLink, parseArgs, resolvePublicUrl } from './options.js';

test('the defaults bind to loopback and use the standard port', () => {
  const options = parseArgs([]);
  assert.equal(options.host, '127.0.0.1');
  assert.equal(options.port, 7878);
  assert.equal(options.maxConnections, 8);
  assert.equal(options.idleTtlMinutes, 720);
  assert.deepEqual(options.roots, []);
});

test('flags are read with a space or an equals sign', () => {
  const spaced = parseArgs(['--port', '9000', '--host', '0.0.0.0', '--root', '/a', '--root', '/b']);
  assert.equal(spaced.port, 9000);
  assert.equal(spaced.host, '0.0.0.0');
  assert.deepEqual(spaced.roots, ['/a', '/b']);

  const inline = parseArgs(['--port=9001', '--token=secret', '--idle-ttl-min=5']);
  assert.equal(inline.port, 9001);
  assert.equal(inline.token, 'secret');
  assert.equal(inline.idleTtlMinutes, 5);
});

test('invalid values are rejected', () => {
  assert.throws(() => parseArgs(['--port', 'abc']), /Invalid --port/);
  assert.throws(() => parseArgs(['--max-connections', '0']), /Invalid --max-connections/);
  assert.throws(() => parseArgs(['--idle-ttl-min', '0']), /Invalid --idle-ttl-min/);
  assert.throws(() => parseArgs(['--tls-cert', 'cert.pem']), /must be used together/);
  assert.throws(() => parseArgs(['--nope']), /Unknown option/);
  assert.throws(() => parseArgs(['--port']), /Missing value/);
});

test('the public url follows the host and the tls setting', () => {
  const loopback = parseArgs([]);
  assert.equal(resolvePublicUrl(loopback, 7878, false), 'ws://127.0.0.1:7878');
  assert.equal(resolvePublicUrl(loopback, 7878, true), 'wss://127.0.0.1:7878');

  const lan = parseArgs(['--host', '0.0.0.0']);
  const lanUrl = resolvePublicUrl(lan, 9000, false);
  assert.match(lanUrl, /^ws:\/\/(?!0\.0\.0\.0)\d+\.\d+\.\d+\.\d+:9000$/);

  const explicit = parseArgs(['--public-url', 'https://bridge.example.com']);
  assert.equal(resolvePublicUrl(explicit, 7878, false), 'wss://bridge.example.com');
  assert.throws(() => resolvePublicUrl(parseArgs(['--public-url', 'ftp://x']), 7878, false), /--public-url/);
});

test('the pairing link carries the url, the token and the name', () => {
  const link = buildPairingLink('ws://127.0.0.1:7878', 'tok en', 'My Laptop');
  assert.ok(link.startsWith('gitnotes://agents/pair?'));
  const params = new URLSearchParams(link.slice('gitnotes://agents/pair?'.length));
  assert.equal(params.get('url'), 'ws://127.0.0.1:7878');
  assert.equal(params.get('token'), 'tok en');
  assert.equal(params.get('name'), 'My Laptop');
});
