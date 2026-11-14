'use strict';

const assert = require('node:assert/strict');
const { test } = require('node:test');
const { buildProjectionHealth, assertFreshForWrite } = require('../lib/projection-health');

const sourceId = 'source_0123456789abcdef';

test('health exposes attempt, success, age, lag, coverage and allowlisted opaque errors', () => {
  const now = 2_000;
  const fresh = buildProjectionHealth({
    now,
    staleAfterSeconds: 300,
    runs: [
      {
        status: 'success',
        completed_at: 1_900,
        lag_seconds: 20,
        source_count: 4,
        projected_count: 4,
        error_count: 0,
        error_code: null,
      },
    ],
    sources: [
      {
        source_id: sourceId,
        source_type: 'kanban',
        observed_at: 1_900,
        last_event_at: 1_880,
        status: 'healthy',
        error_code: null,
        source_count: 4,
      },
    ],
  });
  assert.equal(fresh.status, 'fresh');
  assert.equal(fresh.lastAttemptStatus, 'success');
  assert.equal(fresh.lastSuccessAt, 1900);
  assert.equal(fresh.ageSeconds, 100);
  assert.equal(fresh.lagSeconds, 20);
  assert.deepEqual(fresh.coverage, { healthy: 1, total: 1, percent: 100 });
  assert.equal('backlog' in fresh, false);
  assert.doesNotThrow(() => assertFreshForWrite(fresh));

  const degraded = buildProjectionHealth({
    now,
    staleAfterSeconds: 300,
    runs: [
      { status: 'failed', completed_at: 1_990, error_count: 1, error_code: 'SOURCE_LOAD_FAILED' },
      { status: 'success', completed_at: 1_900, lag_seconds: 20, error_count: 0 },
    ],
    sources: [
      {
        source_id: sourceId,
        source_type: 'kanban',
        observed_at: 1_990,
        status: 'error',
        error_code: 'SOURCE_READ_FAILED',
        error: 'private path /secret',
      },
    ],
  });
  assert.equal(degraded.status, 'degraded');
  assert.equal(degraded.lastAttemptErrorCode, 'SOURCE_LOAD_FAILED');
  assert.equal(JSON.stringify(degraded).includes('/secret'), false);
  assert.throws(
    () => assertFreshForWrite(degraded),
    (error) => error.code === 'PROJECTION_DEGRADED'
  );
});

test('health drops raw or unknown identifiers and unknown error codes', () => {
  const health = buildProjectionHealth({
    now: 2_000,
    runs: [
      {
        status: 'failed',
        completed_at: 1_990,
        error_count: 1,
        error_code: 'SECRET_CUSTOMER_BOARD',
      },
    ],
    sources: [{ source_id: 'customer-private-board', status: 'error', error_code: 'SECRET_PATH' }],
  });
  assert.equal(health.sourceCount, 0);
  assert.equal(health.sourceErrors.length, 0);
  assert.equal(health.lastAttemptErrorCode, null);
  assert.equal(JSON.stringify(health).includes('customer-private-board'), false);
});

test('zero-source failure is public, stale and blocks writes', () => {
  const health = buildProjectionHealth({
    now: 2_000,
    runs: [
      { status: 'failed', completed_at: 1_999, error_count: 1, error_code: 'NO_SOURCES_AVAILABLE' },
    ],
    sources: [
      {
        source_id: 'aggregate',
        status: 'error',
        observed_at: 1_999,
        error_code: 'NO_SOURCES_AVAILABLE',
      },
    ],
  });
  assert.equal(health.status, 'stale');
  assert.equal(health.lastAttemptErrorCode, 'NO_SOURCES_AVAILABLE');
  assert.equal(health.sourceErrors[0].errorCode, 'NO_SOURCES_AVAILABLE');
  assert.throws(
    () => assertFreshForWrite(health),
    (error) => error.code === 'PROJECTION_STALE'
  );
});

test('stale health rejects writes with conflict', () => {
  const stale = buildProjectionHealth({
    now: 2_000,
    staleAfterSeconds: 300,
    runs: [{ status: 'success', completed_at: 1_000, error_count: 0 }],
    sources: [],
  });
  assert.equal(stale.status, 'stale');
  assert.throws(
    () => assertFreshForWrite(stale),
    (error) => error.code === 'PROJECTION_STALE' && error.status === 409
  );
});
