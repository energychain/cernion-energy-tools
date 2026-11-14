'use strict';

const DEFAULT_STALE_AFTER_SECONDS = 300;
const PUBLIC_SOURCE_ID = /^(?:aggregate|source_[0-9a-f]{16})$/;
const PUBLIC_ERROR_CODES = new Set([
  'SOURCE_READ_FAILED',
  'SOURCE_LOAD_FAILED',
  'NO_SOURCES_AVAILABLE',
  'SOURCE_CHANGED_DURING_RUN',
  'RUN_BUDGET_EXCEEDED',
  'PROJECTION_BUILD_FAILED',
  'PRIVACY_CHECK_FAILED',
  'SOURCE_COVERAGE_CHECK_FAILED',
  'INTEGRITY_CHECK_FAILED',
  'SCHEMA_VERSION_MISMATCH',
  'SQLITE_SNAPSHOT_FAILED',
  'PROJECTION_CHILD_FAILED',
  'PROJECTION_CHILD_TERMINATED',
]);

function safeErrorCode(value) {
  const code = String(value || '');
  return PUBLIC_ERROR_CODES.has(code) ? code : null;
}

function buildProjectionHealth(options = {}) {
  const now = Number(options.now || Math.floor(Date.now() / 1000));
  const staleAfterSeconds = Number(options.staleAfterSeconds || DEFAULT_STALE_AFTER_SECONDS);
  const runs = Array.isArray(options.runs) ? options.runs : [];
  const sources = Array.isArray(options.sources) ? options.sources : [];
  const lastAttempt = runs[0] || null;
  const lastSuccess = runs.find((run) => ['success', 'degraded'].includes(run.status)) || null;
  const ageSeconds = lastSuccess?.completed_at ? Math.max(0, now - lastSuccess.completed_at) : null;
  const safeSources = sources.filter((source) =>
    PUBLIC_SOURCE_ID.test(String(source.source_id || ''))
  );
  const sourceErrors = safeSources
    .filter((source) => source.status !== 'healthy')
    .map((source) => ({
      sourceId: source.source_id,
      sourceType: 'kanban',
      status: 'error',
      errorCode: safeErrorCode(source.error_code) || 'SOURCE_READ_FAILED',
      observedAt: Number(source.observed_at || 0) || null,
    }));
  let status = 'fresh';
  if (!lastSuccess || ageSeconds === null || ageSeconds > staleAfterSeconds) status = 'stale';
  else if (
    lastAttempt?.status === 'failed' ||
    lastSuccess.status === 'degraded' ||
    sourceErrors.length ||
    Number(lastAttempt?.error_count || 0) > 0
  )
    status = 'degraded';
  const healthySourceCount = safeSources.filter((source) => source.status === 'healthy').length;
  return {
    status,
    possiblyIncomplete: status !== 'fresh',
    message: status === 'fresh' ? 'Lage aktuell' : 'Lage möglicherweise unvollständig',
    lastAttemptAt: lastAttempt?.completed_at || lastAttempt?.started_at || null,
    lastAttemptStatus: lastAttempt?.status || null,
    lastAttemptErrorCode: safeErrorCode(lastAttempt?.error_code),
    lastSuccessAt: lastSuccess?.completed_at || null,
    ageSeconds,
    lagSeconds: lastSuccess?.lag_seconds ?? null,
    sourceCount: safeSources.length,
    healthySourceCount,
    coverage: {
      healthy: healthySourceCount,
      total: safeSources.length,
      percent: safeSources.length ? Math.floor((healthySourceCount * 100) / safeSources.length) : 0,
    },
    errorCount: sourceErrors.length || Number(lastAttempt?.error_count || 0),
    sourceErrors,
  };
}

function assertFreshForWrite(health) {
  if (health?.status === 'fresh') return health;
  const error = new Error('management_projection_not_fresh');
  error.code = health?.status === 'stale' ? 'PROJECTION_STALE' : 'PROJECTION_DEGRADED';
  error.status = 409;
  throw error;
}

module.exports = {
  DEFAULT_STALE_AFTER_SECONDS,
  PUBLIC_ERROR_CODES,
  assertFreshForWrite,
  buildProjectionHealth,
};
