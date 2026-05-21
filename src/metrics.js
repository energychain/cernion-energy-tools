'use strict';

const crypto = require('crypto');
const fs = require('fs');
const path = require('path');
const client = require('prom-client');

const GLOBAL_KEY = Symbol.for('cernion.metrics.state');

function createState() {
  const register = new client.Registry();
  const state = {
    register,
    defaultMetricsEnabled: false,
    brokerRegistered: false,
  };

  state.serviceLoadedGauge = new client.Gauge({
    name: 'cernion_service_loaded',
    help: 'Loaded services known to the broker',
    labelNames: ['service'],
    registers: [register],
  });

  state.actionRegisteredGauge = new client.Gauge({
    name: 'cernion_action_registered',
    help: 'Registered Moleculer actions known to the broker',
    labelNames: ['service', 'action'],
    registers: [register],
  });

  state.actionCallsTotal = new client.Counter({
    name: 'cernion_action_calls_total',
    help: 'Total Moleculer action calls',
    labelNames: ['service', 'action', 'status', 'origin'],
    registers: [register],
  });

  state.actionDurationSeconds = new client.Histogram({
    name: 'cernion_action_duration_seconds',
    help: 'Moleculer action duration in seconds',
    labelNames: ['service', 'action', 'status'],
    buckets: [0.01, 0.05, 0.1, 0.25, 0.5, 1, 2.5, 5, 10, 30, 60],
    registers: [register],
  });

  state.logsTotal = new client.Counter({
    name: 'cernion_logs_total',
    help: 'Structured logs emitted by service and level',
    labelNames: ['service', 'level', 'source'],
    registers: [register],
  });

  state.auditPipelineDurationSeconds = new client.Histogram({
    name: 'cernion_audit_pipeline_duration_seconds',
    help: 'Audit pipeline duration in seconds',
    labelNames: ['agent', 'step', 'status'],
    buckets: [0.1, 0.5, 1, 2, 5, 10, 30, 60, 120, 300],
    registers: [register],
  });

  state.a2aNegotiationRounds = new client.Histogram({
    name: 'cernion_a2a_negotiation_rounds',
    help: 'Negotiation rounds observed in A2A conflict resolution',
    labelNames: ['outcome'],
    buckets: [0, 1, 2, 3, 4, 5],
    registers: [register],
  });

  state.ragQueryHitCount = new client.Counter({
    name: 'cernion_rag_query_hit_count',
    help: 'RAG query hit counts bucketed by collection',
    labelNames: ['collection', 'hit_bucket'],
    registers: [register],
  });

  state.mastrDeltaCount = new client.Counter({
    name: 'cernion_mastr_delta_count',
    help: 'Detected MaStR delta events grouped by derived severity',
    labelNames: ['severity'],
    registers: [register],
  });

  state.asyncJobQueueDepth = new client.Gauge({
    name: 'cernion_async_job_queue_depth',
    help: 'Current number of queued/running async jobs by service',
    labelNames: ['service'],
    registers: [register],
    collect() {
      this.reset();
      const dir = process.env.JOB_STORE_DIR || path.join(__dirname, '..', 'data', 'jobs');
      if (!fs.existsSync(dir)) return;
      const files = fs.readdirSync(dir).filter((entry) => entry.endsWith('.progress.json'));
      const counts = new Map();
      for (const file of files) {
        try {
          const job = JSON.parse(fs.readFileSync(path.join(dir, file), 'utf8'));
          if (!['queued', 'running'].includes(String(job.status || ''))) continue;
          const service = String(job.service || 'unknown');
          counts.set(service, (counts.get(service) || 0) + 1);
        } catch {
          // ignore malformed files for metric collection
        }
      }
      for (const [service, count] of counts.entries()) {
        this.labels(service).set(count);
      }
    },
  });

  state.asyncLeaseMissesTotal = new client.Counter({
    name: 'cernion_async_lease_misses_total',
    help: 'Detected async job lease misses grouped by reason',
    labelNames: ['reason'],
    registers: [register],
  });

  state.asyncWakeupsTotal = new client.Counter({
    name: 'cernion_async_wakeups_total',
    help: 'Async wake-up attempts grouped by status',
    labelNames: ['status'],
    registers: [register],
  });

  state.asyncAlarmsTotal = new client.Counter({
    name: 'cernion_async_alarm_events_total',
    help: 'Persistent async alarm lifecycle events grouped by status/code/severity',
    labelNames: ['status', 'code', 'severity'],
    registers: [register],
  });

  state.llmRequestTotal = new client.Counter({
    name: 'cernion_llm_request_total',
    help: 'LLM requests by provider/model/operation/status',
    labelNames: ['provider', 'model', 'operation', 'status'],
    registers: [register],
  });

  state.llmRequestDurationSeconds = new client.Histogram({
    name: 'cernion_llm_request_duration_seconds',
    help: 'LLM request latency in seconds',
    labelNames: ['provider', 'model', 'operation', 'status'],
    buckets: [0.05, 0.1, 0.25, 0.5, 1, 2, 5, 10, 30, 60],
    registers: [register],
  });

  state.mcpRequestTotal = new client.Counter({
    name: 'cernion_mcp_request_total',
    help: 'MCP tool requests by tool/status',
    labelNames: ['tool', 'status'],
    registers: [register],
  });

  state.mcpRequestDurationSeconds = new client.Histogram({
    name: 'cernion_mcp_request_duration_seconds',
    help: 'MCP tool request duration in seconds',
    labelNames: ['tool', 'status'],
    buckets: [0.05, 0.1, 0.25, 0.5, 1, 2, 5, 10, 30, 60, 120],
    registers: [register],
  });

  state.utilityReportPhaseDurationSeconds = new client.Histogram({
    name: 'cernion_utility_report_phase_duration_seconds',
    help: 'Utility report phase duration in seconds',
    labelNames: ['phase', 'status'],
    buckets: [0.1, 0.5, 1, 2, 5, 10, 30, 60, 120, 300],
    registers: [register],
  });

  state.utilityReportRetryAttemptsTotal = new client.Counter({
    name: 'cernion_utility_report_retry_attempts_total',
    help: 'Utility report retry attempts by action and outcome',
    labelNames: ['action', 'outcome'],
    registers: [register],
  });

  state.rateLimitHits = new client.Counter({
    name: 'cernion_rate_limit_hits',
    help: 'Rate-limit hits grouped by tenant hash and endpoint class',
    labelNames: ['tenant_hash', 'endpoint_class'],
    registers: [register],
  });

  state.quotaUsage = new client.Gauge({
    name: 'cernion_quota_usage',
    help: 'Current quota usage grouped by tenant hash, resource, and window',
    labelNames: ['tenant_hash', 'resource', 'window'],
    registers: [register],
  });

  return state;
}

const state = global[GLOBAL_KEY] || (global[GLOBAL_KEY] = createState());

function initMetrics() {
  if (state.defaultMetricsEnabled) return state.register;
  client.collectDefaultMetrics({ register: state.register, prefix: 'cernion_' });
  state.defaultMetricsEnabled = true;
  return state.register;
}

function safeLabel(value, fallback = 'unknown') {
  const stringValue = String(value == null || value === '' ? fallback : value);
  return stringValue.replace(/[^a-zA-Z0-9:_-]+/g, '_').slice(0, 120) || fallback;
}

function bucketHits(hitCount) {
  const count = Number(hitCount) || 0;
  if (count <= 0) return '0';
  if (count <= 3) return '1_3';
  if (count <= 10) return '4_10';
  return '11_plus';
}

function sanitizeCollectionLabel(collection) {
  const value = String(collection || 'default').trim();
  if (!value) return 'default';
  if (value.startsWith('tenant:')) return 'tenant_scoped';
  return safeLabel(value);
}

function tenantHashLabel(tenantId) {
  const normalized = String(tenantId || 'default').trim() || 'default';
  if (normalized === 'default') return 'default';
  return crypto.createHash('sha256').update(normalized).digest('hex').slice(0, 12);
}

function registerBroker(broker) {
  initMetrics();
  if (!broker) return;

  state.serviceLoadedGauge.reset();
  state.actionRegisteredGauge.reset();

  for (const service of broker.services || []) {
    if (!service?.name || String(service.name).startsWith('$')) continue;
    const serviceName = safeLabel(service.name);
    state.serviceLoadedGauge.labels(serviceName).set(1);

    const actions = service.schema?.actions || {};
    for (const [actionName] of Object.entries(actions)) {
      state.actionRegisteredGauge
        .labels(serviceName, safeLabel(`${service.name}.${String(actionName).split('.').pop()}`))
        .set(1);
    }
  }

  state.brokerRegistered = true;
}

function recordActionMetric(entry = {}) {
  initMetrics();
  const service = safeLabel(entry.service);
  const action = safeLabel(entry.action);
  const status = safeLabel(entry.status || 'success');
  const origin = safeLabel(entry.requestOrigin || 'internal');
  const durationSeconds = Math.max(0, Number(entry.durationMs || 0) / 1000);

  state.actionCallsTotal.labels(service, action, status, origin).inc();
  state.actionDurationSeconds.labels(service, action, status).observe(durationSeconds);
}

function recordLogEvent(entry = {}) {
  initMetrics();
  state.logsTotal
    .labels(
      safeLabel(entry.service),
      safeLabel(entry.level || 'info'),
      safeLabel(entry.source || 'service')
    )
    .inc();
}

function recordAuditPipeline(agent, step, status, durationMs) {
  initMetrics();
  state.auditPipelineDurationSeconds
    .labels(safeLabel(agent), safeLabel(step || 'pipeline'), safeLabel(status || 'success'))
    .observe(Math.max(0, Number(durationMs || 0) / 1000));
}

function recordA2ANegotiation(outcome, rounds) {
  initMetrics();
  state.a2aNegotiationRounds.labels(safeLabel(outcome)).observe(Number(rounds || 0));
}

function recordRagQuery(collection, hitCount) {
  initMetrics();
  state.ragQueryHitCount.labels(sanitizeCollectionLabel(collection), bucketHits(hitCount)).inc();
}

function recordMastrDelta(summary = {}) {
  initMetrics();
  const added = Number(summary.added || 0);
  const changed = Number(summary.changed || 0);
  const removed = Number(summary.removed || 0);
  let severity = 'info';
  if (removed > 0) severity = 'critical';
  else if (changed > 0) severity = 'warning';
  else if (added > 0) severity = 'info';
  state.mastrDeltaCount.labels(severity).inc();
}

function recordLlmRequest({ provider, model, operation, status, durationMs }) {
  initMetrics();
  const labels = [
    safeLabel(provider || 'unknown'),
    safeLabel(model || 'default'),
    safeLabel(operation || 'text'),
    safeLabel(status || 'success'),
  ];
  state.llmRequestTotal.labels(...labels).inc();
  state.llmRequestDurationSeconds
    .labels(...labels)
    .observe(Math.max(0, Number(durationMs || 0) / 1000));
}

function recordMcpRequest({ tool, status, durationMs }) {
  initMetrics();
  const labels = [safeLabel(tool || 'unknown'), safeLabel(status || 'success')];
  state.mcpRequestTotal.labels(...labels).inc();
  state.mcpRequestDurationSeconds
    .labels(...labels)
    .observe(Math.max(0, Number(durationMs || 0) / 1000));
}

function recordUtilityReportPhase(phase, status, durationMs) {
  initMetrics();
  state.utilityReportPhaseDurationSeconds
    .labels(safeLabel(phase), safeLabel(status || 'success'))
    .observe(Math.max(0, Number(durationMs || 0) / 1000));
}

function recordUtilityReportRetry(action, outcome) {
  initMetrics();
  state.utilityReportRetryAttemptsTotal.labels(safeLabel(action), safeLabel(outcome)).inc();
}

function recordRateLimitHit({ tenantId, endpointClass }) {
  initMetrics();
  state.rateLimitHits
    .labels(tenantHashLabel(tenantId), safeLabel(endpointClass || 'unknown'))
    .inc();
}

function recordQuotaUsage({ tenantId, resource, window, used }) {
  initMetrics();
  state.quotaUsage
    .labels(
      tenantHashLabel(tenantId),
      safeLabel(resource || 'unknown'),
      safeLabel(window || 'current')
    )
    .set(Math.max(0, Number(used || 0)));
}

function recordAsyncLeaseMiss(reason) {
  initMetrics();
  state.asyncLeaseMissesTotal.labels(safeLabel(reason || 'expired')).inc();
}

function recordAsyncWakeup(status) {
  initMetrics();
  state.asyncWakeupsTotal.labels(safeLabel(status || 'queued')).inc();
}

function recordAsyncAlarm({ status, code, severity }) {
  initMetrics();
  state.asyncAlarmsTotal
    .labels(
      safeLabel(status || 'open'),
      safeLabel(code || 'unknown_alarm'),
      safeLabel(severity || 'warning')
    )
    .inc();
}

async function renderMetrics() {
  initMetrics();
  return state.register.metrics();
}

function contentType() {
  return state.register.contentType;
}

function resetForTests() {
  state.register.resetMetrics();
}

module.exports = {
  initMetrics,
  registerBroker,
  recordActionMetric,
  recordLogEvent,
  recordAuditPipeline,
  recordA2ANegotiation,
  recordRagQuery,
  recordMastrDelta,
  recordLlmRequest,
  recordMcpRequest,
  recordUtilityReportPhase,
  recordUtilityReportRetry,
  recordRateLimitHit,
  recordQuotaUsage,
  recordAsyncLeaseMiss,
  recordAsyncWakeup,
  recordAsyncAlarm,
  renderMetrics,
  contentType,
  resetForTests,
};
