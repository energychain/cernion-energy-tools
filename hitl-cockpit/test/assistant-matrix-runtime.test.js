'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { afterEach, test } = require('node:test');
const {
  createAssistantMatrixRuntime,
  matrixEndpoint,
  parseEnvFile,
} = require('../lib/assistant-matrix-runtime');

const roots = [];
afterEach(() => {
  global.fetch = undefined;
  for (const root of roots.splice(0)) fs.rmSync(root, { recursive: true, force: true });
});

function profile() {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'assistant-matrix-runtime-'));
  roots.push(root);
  fs.writeFileSync(
    path.join(root, '.env'),
    ['MATRIX_HOMESERVER="https://matrix.example.test"', "MATRIX_ACCESS_TOKEN='secret-token'"].join(
      '\n'
    ),
    { mode: 0o600 }
  );
  return root;
}

test('parses the bounded profile environment without exporting secrets', () => {
  const file = path.join(profile(), '.env');
  assert.deepEqual(parseEnvFile(file), {
    MATRIX_HOMESERVER: 'https://matrix.example.test',
    MATRIX_ACCESS_TOKEN: 'secret-token',
  });
});

test('rejects non-loopback plaintext Matrix homeservers', () => {
  assert.throws(
    () => matrixEndpoint('http://matrix.example.test', '/_matrix/client/v3/sync'),
    /matrix_homeserver_insecure/
  );
  assert.match(
    matrixEndpoint('http://127.0.0.1:8008', '/_matrix/client/v3/sync'),
    /^http:\/\/127\.0\.0\.1:8008\//
  );
});

test('sends idempotently and reads the exact event back', async () => {
  const calls = [];
  global.fetch = async (url, options) => {
    calls.push({ url, options });
    return {
      ok: true,
      async json() {
        return options.method === 'PUT'
          ? { event_id: '$event' }
          : { event_id: '$event', content: { body: 'stored' } };
      },
    };
  };
  const runtime = createAssistantMatrixRuntime({ profileHome: profile() });
  const sent = await runtime.sender({
    roomRef: '!room:example.test',
    content: { msgtype: 'm.text', body: 'message' },
    handoffId: 'proposal_123',
  });
  const observed = await runtime.readback({
    roomRef: '!room:example.test',
    eventId: sent.event_id,
  });
  assert.equal(observed.event_id, '$event');
  assert.equal(calls.length, 2);
  assert.equal(calls[0].options.method, 'PUT');
  assert.match(calls[0].url, /\/send\/m\.room\.message\/[0-9a-f]{64}$/);
  assert.equal(calls[0].options.headers.authorization, 'Bearer secret-token');
  assert.equal(calls[1].options.method, 'GET');
  assert.match(calls[1].url, /\/event\/%24event$/);
});

test('sync returns bounded message events with reply correlation', async () => {
  const requests = [];
  global.fetch = async (url, options) => {
    requests.push({ url: String(url), options });
    return {
      ok: true,
      async json() {
        return {
          next_batch: 'next-token',
          rooms: {
            join: {
              '!room:example.test': {
                timeline: {
                  events: [
                    {
                      type: 'm.room.message',
                      event_id: '$result',
                      sender: '@felix:example.test',
                      content: {
                        body: '---BEGIN AGENT RESULT---',
                        'm.relates_to': { 'm.in_reply_to': { event_id: '$handoff' } },
                      },
                    },
                    { type: 'm.room.member', event_id: '$ignored', content: {} },
                  ],
                },
              },
            },
          },
        };
      },
    };
  };
  const runtime = createAssistantMatrixRuntime({ profileHome: profile() });
  const result = await runtime.sync({ since: 'previous-token', timeoutMs: 5000, limit: 500 });
  assert.equal(result.nextBatch, 'next-token');
  assert.deepEqual(result.events, [
    {
      roomId: '!room:example.test',
      eventId: '$result',
      sender: '@felix:example.test',
      body: '---BEGIN AGENT RESULT---',
      eventType: 'm.room.message',
      msgtype: null,
      originServerTs: null,
      relationType: null,
      redacted: false,
      replyToEventId: '$handoff',
    },
  ]);
  const requestUrl = new URL(requests[0].url);
  assert.equal(requestUrl.pathname, '/_matrix/client/v3/sync');
  assert.equal(requestUrl.searchParams.get('since'), 'previous-token');
  assert.equal(requestUrl.searchParams.get('timeout'), '5000');
  assert.equal(JSON.parse(requestUrl.searchParams.get('filter')).room.timeline.limit, 50);
});

test('fails closed when the profile has no Matrix credentials', () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'assistant-matrix-runtime-empty-'));
  roots.push(root);
  fs.writeFileSync(path.join(root, '.env'), 'MATRIX_HOMESERVER=https://matrix.example.test\n');
  assert.throws(
    () => createAssistantMatrixRuntime({ profileHome: root }),
    /matrix_profile_not_configured/
  );
});
