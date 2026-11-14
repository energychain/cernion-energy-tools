'use strict';

function createMatrixResultSync(options = {}) {
  const { runtime, ingest } = options;
  if (!runtime || typeof runtime.sync !== 'function' || typeof ingest !== 'function') {
    throw new Error('matrix_result_sync_dependencies_required');
  }
  let token = options.initialToken || null;

  async function poll() {
    const batch = await runtime.sync({ since: token, timeoutMs: 0 });
    for (const event of batch.events || []) {
      if (!String(event.body || '').includes('---BEGIN AGENT RESULT---')) continue;
      await ingest(event);
    }
    token = batch.nextBatch || token;
    return { token, eventCount: (batch.events || []).length };
  }

  return { poll, token: () => token };
}

module.exports = { createMatrixResultSync };
