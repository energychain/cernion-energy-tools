'use strict';

const assert = require('node:assert/strict');
const { PassThrough } = require('node:stream');
const test = require('node:test');

const { BODY_TOO_LARGE, INVALID_JSON, readJsonBody } = require('./http-json');

function requestWith(body) {
  const req = new PassThrough();
  process.nextTick(() => req.end(body));
  return req;
}

test('readJsonBody parses bounded JSON and defaults an empty body to an object', async () => {
  assert.deepEqual(await readJsonBody(requestWith('{"ok":true}'), { maxBytes: 32 }), {
    ok: true,
  });
  assert.deepEqual(await readJsonBody(requestWith(''), { maxBytes: 32 }), {});
});

test('readJsonBody rejects invalid and oversized JSON with stable error codes', async () => {
  await assert.rejects(readJsonBody(requestWith('{'), { maxBytes: 32 }), {
    code: INVALID_JSON,
  });
  await assert.rejects(readJsonBody(requestWith('{"value":"too large"}'), { maxBytes: 8 }), {
    code: BODY_TOO_LARGE,
  });
});
