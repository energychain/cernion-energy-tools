'use strict';

const assert = require('node:assert/strict');
const { test } = require('node:test');
const { createMatrixResultSync } = require('../lib/assistant-matrix-result-sync');

test('does not advance sync token when any structured result ingest fails and retries the same batch', async () => {
  const since = [];
  let ingestAttempts = 0;
  const runtime = {
    async sync(input) {
      since.push(input.since);
      return {
        nextBatch: 'batch-2',
        events: [
          { eventId: '$hint', body: 'DONE' },
          { eventId: '$result', body: '---BEGIN AGENT RESULT---\n{}\n---END AGENT RESULT---' },
        ],
      };
    },
  };
  const sync = createMatrixResultSync({
    runtime,
    async ingest(event) {
      ingestAttempts += 1;
      assert.equal(event.eventId, '$result');
      if (ingestAttempts === 1) throw new Error('temporary_ingest_failure');
    },
  });

  await assert.rejects(sync.poll(), /temporary_ingest_failure/);
  assert.equal(sync.token(), null);
  await sync.poll();
  assert.equal(sync.token(), 'batch-2');
  assert.deepEqual(since, [null, null]);
  assert.equal(ingestAttempts, 2);
});

test('persists the sync token to the cursor only after a batch fully ingests', async () => {
  const writes = [];
  const cursor = {
    read: () => ({ since: null }),
    write: (value) => writes.push(value),
  };
  const runtime = {
    async sync({ since }) {
      // The failing batch must be re-served as long as the token has not
      // advanced past it, exactly as a real homeserver replays the same
      // `since` position until the caller moves forward.
      if (since == null) {
        return {
          nextBatch: 'batch-fails',
          events: [{ eventId: '$a', body: '---BEGIN AGENT RESULT---\n{}\n---END AGENT RESULT---' }],
        };
      }
      return { nextBatch: 'batch-ok', events: [] };
    },
  };
  let attempt = 0;
  const sync = createMatrixResultSync({
    runtime,
    cursor,
    async ingest() {
      attempt += 1;
      if (attempt === 1) throw new Error('temporary_ingest_failure');
    },
  });

  await assert.rejects(sync.poll(), /temporary_ingest_failure/);
  // A failed batch must never reach the disk cursor, otherwise a restart
  // would resume past the exact event that still needs a retry.
  assert.deepEqual(writes, []);
  assert.equal(sync.token(), null);
  await sync.poll();
  assert.deepEqual(writes, ['batch-fails']);
  await sync.poll();
  assert.deepEqual(writes, ['batch-fails', 'batch-ok']);
});

test('resumes from the persisted cursor instead of the in-memory default after a restart', async () => {
  const cursor = { read: () => ({ since: 'batch-from-disk' }), write: () => undefined };
  const seen = [];
  const runtime = {
    async sync(input) {
      seen.push(input.since);
      return { nextBatch: 'batch-next', events: [] };
    },
  };
  const sync = createMatrixResultSync({ runtime, cursor, async ingest() {} });
  assert.equal(sync.token(), 'batch-from-disk');
  await sync.poll();
  assert.deepEqual(seen, ['batch-from-disk']);
});

test('remains fully backward compatible when no cursor dependency is supplied', async () => {
  const runtime = {
    async sync() {
      return { nextBatch: 'batch-1', events: [] };
    },
  };
  const sync = createMatrixResultSync({ runtime, async ingest() {} });
  await sync.poll();
  assert.equal(sync.token(), 'batch-1');
});
