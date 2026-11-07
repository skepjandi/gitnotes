import assert from 'node:assert/strict';
import { test } from 'node:test';
import { NdjsonDecoder } from './ndjson.js';

test('a chunk with several lines yields every line', () => {
  const decoder = new NdjsonDecoder();
  assert.deepEqual(decoder.push('{"a":1}\n{"b":2}\n'), ['{"a":1}', '{"b":2}']);
});

test('a line split across chunks is buffered until it is complete', () => {
  const decoder = new NdjsonDecoder();
  assert.deepEqual(decoder.push('{"a":'), []);
  assert.deepEqual(decoder.push('1}\n'), ['{"a":1}']);
});

test('CRLF line endings are tolerated', () => {
  const decoder = new NdjsonDecoder();
  assert.deepEqual(decoder.push('{"a":1}\r\n'), ['{"a":1}']);
});

test('blank lines are dropped', () => {
  const decoder = new NdjsonDecoder();
  assert.deepEqual(decoder.push('\n\n{"a":1}\n\n'), ['{"a":1}']);
});

test('a trailing line without a newline is flushed at the end of the stream', () => {
  const decoder = new NdjsonDecoder();
  assert.deepEqual(decoder.push('{"a":1}'), []);
  assert.deepEqual(decoder.flush(), ['{"a":1}']);
  assert.deepEqual(decoder.flush(), []);
});
