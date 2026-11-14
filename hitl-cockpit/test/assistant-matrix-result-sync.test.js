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
