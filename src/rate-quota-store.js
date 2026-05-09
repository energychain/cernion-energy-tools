'use strict';

const crypto = require('crypto');
const { createDriver } = require('./rate-quota/factory');
const metrics = require('./metrics');
const { DEFAULT_TENANT, validateTenantId } = require('./tenant-context');

const RATE_LIMIT_DEFAULTS = {
  read: Number(process.env.RATE_LIMIT_READ_PER_MINUTE || 600),
  write: Number(process.env.RATE_LIMIT_WRITE_PER_MINUTE || 60),
  compute: Number(process.env.RATE_LIMIT_COMPUTE_PER_MINUTE || 30),
};

const QUOTA_DEFAULTS = {
  llm_tokens_per_day: Number(process.env.QUOTA_LLM_TOKENS_PER_DAY || 250000),
  llm_tokens_per_month: Number(process.env.QUOTA_LLM_TOKENS_PER_MONTH || 5000000),
  max_async_jobs_per_day: Number(process.env.QUOTA_MAX_ASYNC_JOBS_PER_DAY || 250),
  max_rag_chunks_per_month: Number(process.env.QUOTA_MAX_RAG_CHUNKS_PER_MONTH || 100000),
};

const RESOURCE_PERIODS = {
  llm_tokens_per_day: 'day',
  llm_tokens_per_month: 'month',
  max_async_jobs_per_day: 'day',
  max_rag_chunks_per_month: 'month',
};

const RATE_LIMIT_WINDOW_MS = 60_000;

let driver = null;

function getDriver() {
  if (!driver) driver = createDriver();
  return driver;
}

function toFinitePositive(value, fallback = 0) {
  const numeric = Number(value);
  return Number.isFinite(numeric) && numeric >= 0 ? numeric : fallback;
}

function nowIso() {
  return new Date().toISOString();
}

function normalizeTenantId(tenantId) {
  const normalized = String(tenantId || DEFAULT_TENANT).trim() || DEFAULT_TENANT;
  if (normalized !== DEFAULT_TENANT) validateTenantId(normalized);
  return normalized;
}

function getDayWindow(date = new Date()) {
  return date.toISOString().slice(0, 10);
}

function getMonthWindow(date = new Date()) {
  return date.toISOString().slice(0, 7);
}

function buildDefaultConfig() {
  return {
    rateLimits: { ...RATE_LIMIT_DEFAULTS },
    quotas: { ...QUOTA_DEFAULTS },
    updatedAt: nowIso(),
  };
}

function buildDefaultState(tenantId) {
  return {
    tenantId,
    config: buildDefaultConfig(),
    usage: {},
    rateBuckets: {},
    events: [],
    updatedAt: nowIso(),
  };
}

function clone(value) {
  return JSON.parse(JSON.stringify(value));
}

function getTenantState(tenantId) {
  const normalizedTenantId = normalizeTenantId(tenantId);
  const existing = getDriver().getTenantState(normalizedTenantId);
  if (!existing) return buildDefaultState(normalizedTenantId);

  return {
    ...buildDefaultState(normalizedTenantId),
    ...existing,
    tenantId: normalizedTenantId,
    config: {
      ...buildDefaultConfig(),
      ...(existing.config || {}),
      rateLimits: {
        ...RATE_LIMIT_DEFAULTS,
        ...(existing.config?.rateLimits || {}),
      },
      quotas: {
        ...QUOTA_DEFAULTS,
        ...(existing.config?.quotas || {}),
      },
    },
    usage: existing.usage || {},
    rateBuckets: existing.rateBuckets || {},
    events: Array.isArray(existing.events) ? existing.events : [],
  };
}

function saveTenantState(tenantId, state) {
  const normalizedTenantId = normalizeTenantId(tenantId);
  const payload = {
    ...state,
    tenantId: normalizedTenantId,
    updatedAt: nowIso(),
  };
  return getDriver().saveTenantState(normalizedTenantId, payload);
}

function resolveWindowKey(period, date = new Date()) {
  return period === 'month' ? getMonthWindow(date) : getDayWindow(date);
}

function estimateTextTokens(value) {
  if (Array.isArray(value)) {
    return value.reduce((sum, item) => sum + estimateTextTokens(item), 0);
  }

  const text = typeof value === 'string' ? value : JSON.stringify(value || '');
  const trimmed = String(text || '').trim();
  if (!trimmed) return 0;
  return Math.max(1, Math.ceil(trimmed.length / 4));
}

function createEventFingerprint(event) {
  return [event.type, event.resource, event.window, event.threshold || ''].join(':');
}

function appendEvent(state, event) {
  const fingerprint = createEventFingerprint(event);
  const existing = (state.events || []).find((item) => item.fingerprint === fingerprint);
  if (existing) return;

  state.events.unshift({
    id: crypto.randomUUID(),
    createdAt: nowIso(),
    ...event,
    fingerprint,
  });
  state.events = state.events.slice(0, 200);
  return state.events[0];
}

function captureEventIds(state) {
  return new Set((state.events || []).map((item) => item.id));
}

function collectNewEvents(state, previousIds) {
  return (state.events || []).filter((item) => !previousIds.has(item.id));
}

function boundaryAfter(period, date = new Date()) {
  const ts = new Date(date.getTime());
  if (period === 'month') {
    return new Date(Date.UTC(ts.getUTCFullYear(), ts.getUTCMonth() + 1, 1, 0, 0, 0, 0));
  }
  return new Date(Date.UTC(ts.getUTCFullYear(), ts.getUTCMonth(), ts.getUTCDate() + 1, 0, 0, 0, 0));
}

function buildCurrentUsageEntry(state, resource, date = new Date()) {
  const period = RESOURCE_PERIODS[resource] || 'day';
  const window = resolveWindowKey(period, date);
  const entry = state.usage?.[resource];
  if (entry && entry.window === window) {
    return {
      ...entry,
      limit: toFinitePositive(state.config?.quotas?.[resource], 0),
      remaining:
        toFinitePositive(state.config?.quotas?.[resource], 0) > 0
          ? Math.max(0, toFinitePositive(state.config?.quotas?.[resource], 0) - entry.used)
          : null,
    };
  }

  const limit = toFinitePositive(state.config?.quotas?.[resource], 0);
  return {
    resource,
    period,
    window,
    limit,
    used: 0,
    estimatedUsed: 0,
    actualUsed: 0,
    remaining: limit,
    updatedAt: null,
    lastMeta: null,
  };
}

function buildQuotaCheckResult(entry, required = 0, date = new Date()) {
  const limit = toFinitePositive(entry.limit, 0);
  const used = toFinitePositive(entry.used, 0);
  const remaining = limit > 0 ? Math.max(0, limit - used) : 0;
  const resetAt = boundaryAfter(entry.period, date).toISOString();
  const retryAfter = Math.max(
    1,
    Math.ceil((Date.parse(resetAt) - date.getTime()) / 1000)
  );

  return {
    allowed: required <= 0 || (limit > 0 && used + required <= limit),
    resource: entry.resource,
    period: entry.period,
    window: entry.window,
    limit,
    used,
    remaining,
    resetAt,
    retryAfter,
  };
}

function updateUsageEntry(state, resource, delta, meta = {}) {
  const period = RESOURCE_PERIODS[resource] || 'day';
  const window = resolveWindowKey(period);
  const limit = toFinitePositive(state.config?.quotas?.[resource], 0);
  const current = state.usage?.[resource];
  const base = current && current.window === window
    ? current
    : {
        resource,
        period,
        window,
        used: 0,
        estimatedUsed: 0,
        actualUsed: 0,
        limit,
        remaining: limit,
        updatedAt: nowIso(),
        lastMeta: null,
      };

  const usageDelta = toFinitePositive(delta.used, 0);
  const estimatedDelta = toFinitePositive(delta.estimatedUsed, 0);
  const actualDelta = toFinitePositive(delta.actualUsed, 0);

  const next = {
    ...base,
    limit,
    used: base.used + usageDelta,
    estimatedUsed: base.estimatedUsed + estimatedDelta,
    actualUsed: base.actualUsed + actualDelta,
    remaining: limit > 0 ? Math.max(0, limit - (base.used + usageDelta)) : null,
    updatedAt: nowIso(),
    lastMeta: meta,
  };

  state.usage[resource] = next;
  metrics.recordQuotaUsage({
    tenantId: state.tenantId,
    resource,
    window,
    used: next.used,
  });

  if (limit > 0) {
    const ratio = next.used / limit;
    if (ratio >= 1) {
      appendEvent(state, {
        type: 'quota.exhausted',
        resource,
        window,
        threshold: '100',
        limit,
        used: next.used,
        estimated: next.estimatedUsed > 0 && next.actualUsed === 0,
      });
    } else if (ratio >= 0.9) {
      appendEvent(state, {
        type: 'quota.threshold.reached',
        resource,
        window,
        threshold: '90',
        limit,
        used: next.used,
        estimated: next.estimatedUsed > 0 && next.actualUsed === 0,
      });
    }
  }

  return next;
}

function checkQuotaLimit({ tenantId, resource, required = 0, meta = {} }) {
  const state = getTenantState(tenantId);
  const beforeEventIds = captureEventIds(state);
  const entry = buildCurrentUsageEntry(state, resource);
  const result = buildQuotaCheckResult(entry, required);

  if (!result.allowed) {
    appendEvent(state, {
      type: 'quota.exhausted',
      resource,
      window: result.window,
      threshold: '100',
      limit: result.limit,
      used: result.used,
      required,
      meta,
      estimated: meta.isEstimated === true,
    });
    saveTenantState(state.tenantId, state);
  }

  return {
    ...result,
    tenantId: state.tenantId,
    responseHeaders: {
      'Retry-After': String(result.retryAfter),
      'X-RateLimit-Reset': String(Math.ceil(Date.parse(result.resetAt) / 1000)),
    },
    newEvents: collectNewEvents(state, beforeEventIds),
  };
}

function acquireRateLimitToken({ tenantId, endpointClass, now = new Date(), cost = 1 }) {
  const state = getTenantState(tenantId);
  const beforeEventIds = captureEventIds(state);
  const normalizedClass = String(endpointClass || 'read').trim() || 'read';
  const limit = toFinitePositive(state.config?.rateLimits?.[normalizedClass], RATE_LIMIT_DEFAULTS.read);

  if (!state.rateBuckets || typeof state.rateBuckets !== 'object') {
    state.rateBuckets = {};
  }

  const previous = state.rateBuckets[normalizedClass] || {
    tokens: limit,
    lastRefillAt: now.toISOString(),
  };
  const previousLimit = toFinitePositive(previous.limit, limit);
  const previousTokens = Math.min(limit, Number(previous.tokens ?? limit), previousLimit || limit);
  const elapsedMs = Math.max(0, now.getTime() - Date.parse(previous.lastRefillAt || now.toISOString()));
  const refillPerMs = limit > 0 ? limit / RATE_LIMIT_WINDOW_MS : 0;
  const refilledTokens = limit > 0 ? Math.min(limit, previousTokens + elapsedMs * refillPerMs) : 0;
  const allowed = cost <= 0 || (limit > 0 && refilledTokens >= cost);
  const tokensAfter = allowed ? Math.max(0, refilledTokens - cost) : refilledTokens;
  const ratePerSecond = limit > 0 ? limit / 60 : 0;
  const waitSeconds =
    !allowed && ratePerSecond > 0 ? Math.max(1, Math.ceil((cost - refilledTokens) / ratePerSecond)) : 0;
  const resetSeconds =
    limit > 0 && refillPerMs > 0
      ? Math.ceil(
          (now.getTime() + Math.max(0, ((limit - tokensAfter) / refillPerMs))) / 1000
        )
      : Math.ceil(now.getTime() / 1000);

  state.rateBuckets[normalizedClass] = {
    tokens: limit > 0 ? tokensAfter : 0,
    lastRefillAt: now.toISOString(),
    limit,
  };

  if (!allowed) {
    appendEvent(state, {
      type: 'rate_limit.exceeded',
      resource: normalizedClass,
      window: now.toISOString().slice(0, 16),
      threshold: '100',
      limit,
      used: Math.max(0, Math.ceil(limit - tokensAfter)),
      retryAfter: waitSeconds,
    });
    metrics.recordRateLimitHit({ tenantId: state.tenantId, endpointClass: normalizedClass });
  }

  saveTenantState(state.tenantId, state);

  return {
    allowed,
    tenantId: state.tenantId,
    endpointClass: normalizedClass,
    limit,
    remaining: limit > 0 ? Math.max(0, Math.floor(tokensAfter)) : 0,
    retryAfter: waitSeconds,
    resetAt: resetSeconds,
    responseHeaders: {
      'X-RateLimit-Limit': String(limit),
      'X-RateLimit-Remaining': String(limit > 0 ? Math.max(0, Math.floor(tokensAfter)) : 0),
      'X-RateLimit-Reset': String(resetSeconds),
      ...(waitSeconds > 0 ? { 'Retry-After': String(waitSeconds) } : {}),
    },
    newEvents: collectNewEvents(state, beforeEventIds),
  };
}

function buildQuotaSnapshot(tenantId) {
  const state = getTenantState(tenantId);
  const currentDay = getDayWindow();
  const currentMonth = getMonthWindow();

  const usage = Object.fromEntries(
    Object.keys(QUOTA_DEFAULTS).map((resource) => {
      const entry = state.usage?.[resource] || null;
      const period = RESOURCE_PERIODS[resource] || 'day';
      const expectedWindow = period === 'month' ? currentMonth : currentDay;
      if (!entry || entry.window !== expectedWindow) {
        return [
          resource,
          {
            resource,
            period,
            window: expectedWindow,
            limit: state.config.quotas[resource],
            used: 0,
            estimatedUsed: 0,
            actualUsed: 0,
            remaining: state.config.quotas[resource],
            updatedAt: null,
            lastMeta: null,
          },
        ];
      }
      return [resource, entry];
    })
  );

  return {
    tenantId: state.tenantId,
    generatedAt: nowIso(),
    driver: getDriver().getInfo(),
    config: clone(state.config),
    usage,
    recentEvents: (state.events || []).slice(0, 20).map((item) => ({ ...item })),
  };
}

function recordLlmUsage({ tenantId, provider, model, operation, prompt, completion, usage = {} }) {
  const state = getTenantState(tenantId);
  const beforeEventIds = captureEventIds(state);
  const promptActual = toFinitePositive(usage.promptTokens, NaN);
  const completionActual = toFinitePositive(usage.completionTokens, NaN);
  const promptEstimated = estimateTextTokens(prompt);
  const completionEstimated = estimateTextTokens(completion);
  const promptTokens = Number.isFinite(promptActual) ? promptActual : promptEstimated;
  const completionTokens = Number.isFinite(completionActual) ? completionActual : completionEstimated;
  const totalTokens = promptTokens + completionTokens;
  const estimatedTokens =
    (Number.isFinite(promptActual) ? 0 : promptEstimated) +
    (Number.isFinite(completionActual) ? 0 : completionEstimated);
  const actualTokens =
    (Number.isFinite(promptActual) ? promptActual : 0) +
    (Number.isFinite(completionActual) ? completionActual : 0);

  updateUsageEntry(
    state,
    'llm_tokens_per_day',
    {
      used: totalTokens,
      estimatedUsed: estimatedTokens,
      actualUsed: actualTokens,
    },
    {
      provider: provider || 'unknown',
      model: model || 'default',
      operation: operation || 'unknown',
      isEstimated: estimatedTokens > 0,
      hasActual: actualTokens > 0,
    }
  );

  updateUsageEntry(
    state,
    'llm_tokens_per_month',
    {
      used: totalTokens,
      estimatedUsed: estimatedTokens,
      actualUsed: actualTokens,
    },
    {
      provider: provider || 'unknown',
      model: model || 'default',
      operation: operation || 'unknown',
      isEstimated: estimatedTokens > 0,
      hasActual: actualTokens > 0,
    }
  );

  saveTenantState(state.tenantId, state);
  return {
    ...buildQuotaSnapshot(state.tenantId),
    newEvents: collectNewEvents(state, beforeEventIds),
  };
}

function checkLlmQuota({ tenantId, requiredTokens = 0 }) {
  const day = checkQuotaLimit({
    tenantId,
    resource: 'llm_tokens_per_day',
    required: requiredTokens,
    meta: { isEstimated: true },
  });
  if (!day.allowed) return { ...day, type: 'LLM_QUOTA_EXCEEDED' };

  const month = checkQuotaLimit({
    tenantId,
    resource: 'llm_tokens_per_month',
    required: requiredTokens,
    meta: { isEstimated: true },
  });
  if (!month.allowed) return { ...month, type: 'LLM_QUOTA_EXCEEDED' };

  return {
    allowed: true,
    tenantId: day.tenantId,
    newEvents: [...(day.newEvents || []), ...(month.newEvents || [])],
  };
}

function checkAsyncJobQuota({ tenantId, required = 1 }) {
  return checkQuotaLimit({ tenantId, resource: 'max_async_jobs_per_day', required });
}

function recordAsyncJobUsage({ tenantId, service, action, count = 1 }) {
  const state = getTenantState(tenantId);
  const beforeEventIds = captureEventIds(state);
  updateUsageEntry(
    state,
    'max_async_jobs_per_day',
    { used: count, estimatedUsed: 0, actualUsed: count },
    { service: service || 'unknown', action: action || 'unknown', hasActual: true, isEstimated: false }
  );
  saveTenantState(state.tenantId, state);
  return {
    ...buildQuotaSnapshot(state.tenantId),
    newEvents: collectNewEvents(state, beforeEventIds),
  };
}

function checkRagChunkQuota({ tenantId, chunkCount = 0 }) {
  return checkQuotaLimit({ tenantId, resource: 'max_rag_chunks_per_month', required: chunkCount });
}

function recordRagChunkUsage({ tenantId, collection, chunkCount = 0 }) {
  const state = getTenantState(tenantId);
  const beforeEventIds = captureEventIds(state);
  updateUsageEntry(
    state,
    'max_rag_chunks_per_month',
    { used: chunkCount, estimatedUsed: 0, actualUsed: chunkCount },
    { collection: collection || 'unknown', hasActual: true, isEstimated: false }
  );
  saveTenantState(state.tenantId, state);
  return {
    ...buildQuotaSnapshot(state.tenantId),
    newEvents: collectNewEvents(state, beforeEventIds),
  };
}

function listTenantEvents(tenantId, options = {}) {
  const limit = Math.min(Math.max(Number(options.limit || 50), 1), 200);
  const type = options.type ? String(options.type).trim() : null;
  const state = getTenantState(tenantId);
  const events = (state.events || [])
    .filter((item) => !type || item.type === type)
    .slice(0, limit)
    .map((item) => ({ ...item }));

  return {
    tenantId: state.tenantId,
    generatedAt: nowIso(),
    count: events.length,
    events,
  };
}

function getDriverInfo() {
  return getDriver().getInfo();
}

function resetForTests() {
  driver = null;
}

module.exports = {
  RATE_LIMIT_DEFAULTS,
  QUOTA_DEFAULTS,
  buildQuotaSnapshot,
  acquireRateLimitToken,
  checkAsyncJobQuota,
  checkLlmQuota,
  checkRagChunkQuota,
  estimateTextTokens,
  getDriverInfo,
  getTenantState,
  listTenantEvents,
  recordAsyncJobUsage,
  recordLlmUsage,
  recordRagChunkUsage,
  resetForTests,
  saveTenantState,
};
