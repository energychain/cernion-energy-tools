'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { test } = require('node:test');
const { createMatrixListenerCursor } = require('../lib/matrix-listener-cursor');

function tempFile() {
  return path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'cursor-test-')), 'cursor.json');
}

test('missing cursor file starts from since: null without throwing', () => {
  const cursor = createMatrixListenerCursor({ file: tempFile() });
  assert.deepEqual(cursor.read(), { since: null });
});

test('written cursor round-trips through read with 0600 permissions', () => {
  const file = tempFile();
  const cursor = createMatrixListenerCursor({ file });
  cursor.write('batch-42');
  assert.deepEqual(cursor.read(), { since: 'batch-42' });
  const mode = fs.statSync(file).mode & 0o777;
  assert.equal(mode, 0o600);
});

test('corrupt cursor file is treated as a fresh start, not a crash', () => {
  const file = tempFile();
  fs.writeFileSync(file, 'not json{{{');
  const cursor = createMatrixListenerCursor({ file });
  assert.deepEqual(cursor.read(), { since: null });
});

test('write is atomic: no partial file is ever visible to a concurrent reader', () => {
  const file = tempFile();
  const cursor = createMatrixListenerCursor({ file });
  cursor.write('batch-1');
  // Simulate a reader racing a second write: it must see either the old or
  // the new complete value, never a half-written temp artifact left behind.
  cursor.write('batch-2');
  const leftoverTemp = fs
    .readdirSync(path.dirname(file))
    .filter((name) => name.startsWith(`${path.basename(file)}.`) && name.endsWith('.tmp'));
  assert.deepEqual(leftoverTemp, []);
  assert.deepEqual(cursor.read(), { since: 'batch-2' });
});

test('write(null) clears the cursor to restart from current position', () => {
  const file = tempFile();
  const cursor = createMatrixListenerCursor({ file });
  cursor.write('batch-1');
  cursor.write(null);
  assert.deepEqual(cursor.read(), { since: null });
});

test('rejects a non-string, non-null cursor value', () => {
  const cursor = createMatrixListenerCursor({ file: tempFile() });
  assert.throws(() => cursor.write(42), /matrix_listener_cursor_invalid/);
});
