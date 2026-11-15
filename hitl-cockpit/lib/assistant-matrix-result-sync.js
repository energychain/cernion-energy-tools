'use strict';

// Without a durable cursor, a process restart forgets `next_batch` and the
// sync resumes from "now", silently skipping any structured agent result
// that was posted while the process was down or between deploys. The
// optional `cursor` dependency persists the token to disk after each batch
// that ingests cleanly, so a restarted listener resumes exactly where it
// left off instead of losing history. This stays fully backward compatible:
// without a `cursor`, behavior is unchanged (in-memory token only).
function createMatrixResultSync(options = {}) {
  const { runtime, ingest, cursor } = options;
  if (!runtime || typeof runtime.sync !== 'function' || typeof ingest !== 'function') {
    throw new Error('matrix_result_sync_dependencies_required');
  }
  let token = options.initialToken || (cursor ? cursor.read().since : null) || null;

  async function poll() {
    const batch = await runtime.sync({ since: token, timeoutMs: 0 });
    for (const event of batch.events || []) {
      if (!String(event.body || '').includes('---BEGIN AGENT RESULT---')) continue;
      await ingest(event);
    }
    token = batch.nextBatch || token;
    // Persisted only after every event in the batch ingested without
    // throwing, matching the existing at-least-once retry contract: a
    // crash mid-batch must re-fetch and re-attempt the same events, not
    // silently move past them.
    if (cursor) cursor.write(token);
    return { token, eventCount: (batch.events || []).length };
  }

  return { poll, token: () => token };
}

module.exports = { createMatrixResultSync };
