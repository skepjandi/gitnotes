import assert from 'node:assert/strict';
import { test } from 'node:test';
import { isInsideRoot } from './paths.js';

test('a path inside the root is contained', () => {
  assert.equal(isInsideRoot('/root', '/root'), true);
  assert.equal(isInsideRoot('/root/src/app.ts', '/root'), true);
  assert.equal(isInsideRoot('/root/nested/deep', '/root'), true);
});

test('a sibling with the same prefix is not contained', () => {
  assert.equal(isInsideRoot('/root-evil', '/root'), false);
  assert.equal(isInsideRoot('/root-evil/src', '/root'), false);
  assert.equal(isInsideRoot('/roots', '/root'), false);
});

test('the parent directory is not contained', () => {
  assert.equal(isInsideRoot('/', '/root'), false);
  assert.equal(isInsideRoot('/other', '/root'), false);
});

test('a child named with dots is contained', () => {
  assert.equal(isInsideRoot('/root/..data', '/root'), true);
});
