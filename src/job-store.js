/**
 * File-backed job store for async REST API pattern (v0.9.8+).
 *
 * Jobs are persisted as JSON files in the .jobs directory:
 *   .jobs/{jobId}.progress.json  — status tracking (created, updated, error)
 *   .jobs/{jobId}.result.json    — completed result payload
 *
 * Environment variables:
 *   JOB_STORE_DIR          Override storage directory (default: .jobs/ in project root)
 *   JOB_STORE_TTL_SECONDS  Job TTL in seconds (default: 86400 = 24 h)
 */

const { createDriver } = require('./job-store/factory');
const rateQuotaStore = require('./rate-quota-store');
const metrics = require('./metrics');
const { Errors } = require('moleculer');

const DRIVER = createDriver();
const LEASE_SECONDS = Number(process.env.JOB_STORE_LEASE_SECONDS || 30);
const HEARTBEAT_SECONDS = Number(process.env.JOB_STORE_HEARTBEAT_SECONDS || 10);
const MAX_CONCURRENT_PER_TENANT = Math.max(
  1,
  Number(process.env.JOB_STORE_MAX_CONCURRENT_PER_TENANT || 2)
);
const MAX_MISSED_LEASES = Math.max(1, Number(process.env.JOB_STORE_MAX_MISSED_LEASES || 3));

const TTL_MS = parseInt(process.env.JOB_STORE_TTL_SECONDS || '86400', 10) * 1000;

const JOB_STATUS = {
  QUEUED: 'queued',
  RUNNING: 'running',
  COMPLETED: 'completed',
  ERROR: 'error',
  RECOVERY_PENDING: 'recovery_pending',
};

const ALARM_STATUS = {
  OPEN: 'open',
  ACKNOWLEDGED: 'acknowledged',
  RESOLVED: 'resolved',
};

const pendingJobsByTenant = new Map();
const runningJobsByTenant = new Map();
const wakeUpQueueByIdempotencyKey = new Map();
let roundRobinOffset = 0;
let dispatchScheduled = false;
let wakeDispatchScheduled = false;

async function emitRateQuotaEvents(ctx, events, extra = {}) {
  if (
    !ctx?.broker ||
    typeof ctx.broker.emit !== 'function' ||
    !Array.isArray(events) ||
    events.length === 0
  ) {
    return;
  }

  for (const event of events) {
    await ctx.broker.emit(event.type, {
      eventId: event.id,
      tenantId: ctx?.meta?.tenantId || 'default',
      resource: event.resource,
      window: event.window,
      limit: event.limit,
      used: event.used,
      threshold: event.threshold,
      ...extra,
    });
  }
}

// ─── Internal helpers ─────────────────────────────────────────────────────────

function buildLeasePatch() {
  const now = Date.now();
  return {
    leaseOwner: `${process.pid}`,
    lastHeartbeatAt: new Date(now).toISOString(),
    leaseExpiresAt: new Date(now + LEASE_SECONDS * 1000).toISOString(),
  };
}

function nowIso() {
  return new Date().toISOString();
}

function listJobs() {
  if (typeof DRIVER.listJobs !== 'function') return [];
  return DRIVER.listJobs();
}

function isLeaseExpired(job, now = Date.now()) {
  if (!job?.leaseExpiresAt) return false;
  const expiresAt = Date.parse(job.leaseExpiresAt);
  if (Number.isNaN(expiresAt)) return false;
  return expiresAt <= now;
}

function ensureArray(value) {
  return Array.isArray(value) ? value : [];
}

function buildQueuedDescriptor(
  jobId,
  message = 'Job started. Poll /api/jobs/:jobId/status for progress.'
) {
  return {
    success: true,
    jobId,
    status: 'queued',
    message,
    statusUrl: `/api/jobs/${jobId}/status`,
    resultUrl: `/api/jobs/${jobId}/result`,
    progressUrl: `/api/jobs/${jobId}/progress`,
  };
}

function getRunningCount(tenantId) {
  return Number(runningJobsByTenant.get(tenantId) || 0);
}

function incRunningCount(tenantId) {
  runningJobsByTenant.set(tenantId, getRunningCount(tenantId) + 1);
}

function decRunningCount(tenantId) {
  const next = Math.max(0, getRunningCount(tenantId) - 1);
  if (next === 0) {
    runningJobsByTenant.delete(tenantId);
    return;
  }
  runningJobsByTenant.set(tenantId, next);
}

function enqueuePendingJob(entry) {
  const tenantId = String(entry.tenantId || 'default');
  const queue = pendingJobsByTenant.get(tenantId) || [];
  queue.push(entry);
  pendingJobsByTenant.set(tenantId, queue);
}

function toAlarmRecord(input = {}) {
  const ts = nowIso();
  return {
    alarmId: String(input.alarmId || `alarm_${Math.random().toString(36).slice(2, 12)}`),
    code: String(input.code || 'ASYNC_GENERIC_ALARM'),
    severity: String(input.severity || 'warning'),
    status: String(input.status || ALARM_STATUS.OPEN),
    message: String(input.message || 'Async job watchdog event.'),
    dedupeKey: input.dedupeKey ? String(input.dedupeKey) : null,
    metadata: input.metadata && typeof input.metadata === 'object' ? input.metadata : {},
    actor: input.actor ? String(input.actor) : 'system',
    createdAt: input.createdAt || ts,
    updatedAt: ts,
    acknowledgedAt: input.acknowledgedAt || null,
    resolvedAt: input.resolvedAt || null,
    note: input.note ? String(input.note) : null,
  };
}

function createAlarmEvent(jobId, alarmInput = {}) {
  const job = getJob(jobId);
  if (!job) return null;

  const alarms = ensureArray(job.alarms);
  const dedupeKey = alarmInput.dedupeKey ? String(alarmInput.dedupeKey) : null;

  if (dedupeKey) {
    const existing = alarms.find(
      (alarm) =>
        alarm?.dedupeKey === dedupeKey &&
        [ALARM_STATUS.OPEN, ALARM_STATUS.ACKNOWLEDGED].includes(String(alarm?.status || ''))
    );
    if (existing) return existing;
  }

  const alarm = toAlarmRecord(alarmInput);
  alarms.push(alarm);
  updateJob(jobId, { alarms });
  metrics.recordAsyncAlarm({ status: alarm.status, code: alarm.code, severity: alarm.severity });
  return alarm;
}

function updateAlarmStatus(alarmId, status, options = {}) {
  if (!alarmId || !status) return null;
  if (
    ![ALARM_STATUS.OPEN, ALARM_STATUS.ACKNOWLEDGED, ALARM_STATUS.RESOLVED].includes(String(status))
  ) {
    return null;
  }

  const jobs = listJobs();
  for (const job of jobs) {
    const alarms = ensureArray(job?.alarms);
    const index = alarms.findIndex((entry) => entry?.alarmId === alarmId);
    if (index < 0) continue;

    const current = alarms[index];
    if (String(current.status) === String(status)) {
      return { jobId: job.jobId, alarm: current };
    }

    const next = {
      ...current,
      status,
      actor: options.actor ? String(options.actor) : current.actor || 'system',
      updatedAt: nowIso(),
      note: options.note ? String(options.note) : current.note || null,
    };
    if (status === ALARM_STATUS.ACKNOWLEDGED && !next.acknowledgedAt) {
      next.acknowledgedAt = nowIso();
    }
    if (status === ALARM_STATUS.RESOLVED && !next.resolvedAt) {
      next.resolvedAt = nowIso();
    }

    alarms[index] = next;
    updateJob(job.jobId, { alarms });
    metrics.recordAsyncAlarm({ status: next.status, code: next.code, severity: next.severity });
    return { jobId: job.jobId, alarm: next };
  }

  return null;
}

function listAlarmEvents(filters = {}) {
  const jobs = listJobs();
  const statusFilter = filters?.status ? String(filters.status) : null;
  const jobIdFilter = filters?.jobId ? String(filters.jobId) : null;

  const events = [];
  for (const job of jobs) {
    if (jobIdFilter && String(job?.jobId) !== jobIdFilter) continue;
    for (const alarm of ensureArray(job?.alarms)) {
      if (statusFilter && String(alarm?.status) !== statusFilter) continue;
      events.push({
        jobId: job.jobId,
        service: job.service,
        action: job.action,
        idempotencyKey: job.idempotencyKey || null,
        alarm,
      });
    }
  }

  return events.sort((a, b) =>
    String(b.alarm?.updatedAt || '').localeCompare(String(a.alarm?.updatedAt || ''))
  );
}

function enqueueWakeUp(entry) {
  const idempotencyKey = String(entry?.idempotencyKey || '').trim();
  if (!idempotencyKey) return false;
  if (wakeUpQueueByIdempotencyKey.has(idempotencyKey)) return false;
  wakeUpQueueByIdempotencyKey.set(idempotencyKey, entry);
  return true;
}

function pickNextTenantForDispatch() {
  const tenants = Array.from(pendingJobsByTenant.entries())
    .filter(
      ([tenantId, queue]) =>
        Array.isArray(queue) &&
        queue.length > 0 &&
        getRunningCount(tenantId) < MAX_CONCURRENT_PER_TENANT
    )
    .map(([tenantId]) => tenantId);

  if (tenants.length === 0) return null;

  if (roundRobinOffset >= tenants.length) roundRobinOffset = 0;
  const tenantId = tenants[roundRobinOffset];
  roundRobinOffset = (roundRobinOffset + 1) % tenants.length;
  return tenantId;
}

function runQueuedJob(entry) {
  const tenantId = String(entry.tenantId || 'default');
  const jobId = entry.jobId;

  incRunningCount(tenantId);
  updateJob(jobId, {
    status: JOB_STATUS.RUNNING,
    missedLeases: 0,
    leaseState: 'active',
    wakeState: {
      status: 'idle',
      idempotencyKey: entry.idempotencyKey || null,
      reason: null,
      actor: null,
      attempts: 0,
      lastRequestedAt: null,
      lastAttemptAt: null,
      lastError: null,
      wakeJobId: null,
    },
    ...buildLeasePatch(),
  });

  // B) Automatic status-transition log: queued → running
  //    Only emitted for jobs that carry expectedDuration (Personal Agent / observable jobs).
  //    Other services (CYA, ZNP) own their own phase logs and must not be interfered with.
  if (entry.expectedDuration) {
    appendLog(jobId, 'status_running', 0, `Job started (tenant=${tenantId})`, {
      service: entry.service || null,
      action: entry.action || null,
      tenantId,
    });
  }

  let heartbeat = null;
  if (HEARTBEAT_SECONDS > 0) {
    heartbeat = setInterval(() => {
      updateJob(jobId, { ...buildLeasePatch() });
    }, HEARTBEAT_SECONDS * 1000);
    heartbeat.unref?.();
  }

  Promise.resolve()
    .then(() => entry.worker(jobId))
    .then((result) => {
      // B) Automatic status-transition log: running → completed
      //    Only emitted for observable jobs (those with expectedDuration set).
      if (entry.expectedDuration) {
        const job = getJob(jobId);
        appendLog(jobId, 'status_completed', 100, 'Job completed successfully', {
          elapsedMs: job && job.createdAt ? Date.now() - new Date(job.createdAt).getTime() : null,
        });
      }
      return saveResult(jobId, result);
    })
    .catch((err) => {
      const errMsg = String(err.message || err);
      // B) Automatic status-transition log: running → error
      //    Only emitted for observable jobs (those with expectedDuration set).
      if (entry.expectedDuration) {
        appendLog(jobId, 'status_error', 0, `Job failed: ${errMsg}`, {
          error: errMsg,
        });
      }
      updateJob(jobId, {
        status: JOB_STATUS.ERROR,
        error: errMsg,
        leaseOwner: null,
        leaseExpiresAt: null,
        lastHeartbeatAt: null,
      });
    })
    .finally(() => {
      if (heartbeat) clearInterval(heartbeat);
      decRunningCount(tenantId);
      scheduleDispatch();
    });
}

function dispatchPendingJobs() {
  while (true) {
    const tenantId = pickNextTenantForDispatch();
    if (!tenantId) break;

    const queue = pendingJobsByTenant.get(tenantId) || [];
    const next = queue.shift();
    if (queue.length > 0) {
      pendingJobsByTenant.set(tenantId, queue);
    } else {
      pendingJobsByTenant.delete(tenantId);
    }

    if (!next) continue;
    runQueuedJob(next);
  }
}

function scheduleDispatch() {
  if (dispatchScheduled) return;
  dispatchScheduled = true;
  setImmediate(() => {
    dispatchScheduled = false;
    dispatchPendingJobs();
  });
}

async function runWakeUpJob(entry) {
  const idempotencyKey = String(entry?.idempotencyKey || '').trim();
  if (!idempotencyKey) return;

  const job = getJob(entry.jobId);
  if (!job) {
    metrics.recordAsyncWakeup('missing_job');
    return;
  }

  const wakeContext = job.wakeContext || {};
  const service = String(wakeContext.service || '').trim();
  const action = String(wakeContext.action || '').trim();
  if (!entry?.broker || !service || !action) {
    createAlarmEvent(job.jobId, {
      code: 'WAKEUP_CONTEXT_MISSING',
      severity: 'critical',
      message: 'Wake-up skipped because broker or wakeContext is missing.',
      actor: entry?.actor || 'watchdog',
      dedupeKey: `wake-context-missing:${job.jobId}`,
    });
    metrics.recordAsyncWakeup('failed');
    return;
  }

  const now = nowIso();
  const attempts = Number(job?.wakeState?.attempts || 0) + 1;
  updateJob(job.jobId, {
    wakeState: {
      status: 'running',
      idempotencyKey,
      reason: entry.reason || 'watchdog',
      attempts,
      actor: entry.actor || 'watchdog',
      lastRequestedAt: job?.wakeState?.lastRequestedAt || now,
      lastAttemptAt: now,
      lastError: null,
      wakeJobId: null,
    },
  });

  try {
    const result = await entry.broker.call(`${service}.${action}`, wakeContext.params || {}, {
      meta: {
        $gateway: true,
        tenantId: job.tenantId || 'default',
        requestHeaders: {
          'x-idempotency-key': idempotencyKey,
        },
        wakeUp: true,
        wakeUpReason: entry.reason || 'watchdog',
      },
    });

    updateJob(job.jobId, {
      wakeState: {
        status: 'completed',
        idempotencyKey,
        reason: entry.reason || 'watchdog',
        attempts,
        actor: entry.actor || 'watchdog',
        lastRequestedAt: job?.wakeState?.lastRequestedAt || now,
        lastAttemptAt: now,
        completedAt: nowIso(),
        lastError: null,
        wakeJobId: result?.jobId || null,
        reused: Boolean(result?.reused),
      },
      recovery: {
        status: 'woken',
        at: nowIso(),
        reason: entry.reason || 'watchdog',
      },
    });

    for (const candidate of ensureArray(job.alarms)) {
      if (
        [ALARM_STATUS.OPEN, ALARM_STATUS.ACKNOWLEDGED].includes(String(candidate?.status || '')) &&
        ['LEASE_MISSES_EXCEEDED', 'STARTUP_REHYDRATION_REQUIRED', 'WAKEUP_FAILED'].includes(
          String(candidate?.code || '')
        )
      ) {
        updateAlarmStatus(candidate.alarmId, ALARM_STATUS.RESOLVED, {
          actor: entry.actor || 'watchdog',
          note: 'Resolved automatically after successful wake-up.',
        });
      }
    }

    metrics.recordAsyncWakeup(result?.reused ? 'reused' : 'success');
  } catch (err) {
    const message = String(err?.message || err || 'Unknown wake-up error');
    updateJob(job.jobId, {
      wakeState: {
        status: 'error',
        idempotencyKey,
        reason: entry.reason || 'watchdog',
        attempts,
        actor: entry.actor || 'watchdog',
        lastRequestedAt: job?.wakeState?.lastRequestedAt || now,
        lastAttemptAt: now,
        lastError: message,
        wakeJobId: null,
      },
    });

    createAlarmEvent(job.jobId, {
      code: 'WAKEUP_FAILED',
      severity: 'critical',
      message: `Wake-up execution failed: ${message}`,
      actor: entry.actor || 'watchdog',
      dedupeKey: `wakeup-failed:${job.jobId}`,
      metadata: {
        reason: entry.reason || 'watchdog',
        idempotencyKey,
      },
    });
    metrics.recordAsyncWakeup('failed');
  }
}

function dispatchWakeUps() {
  if (wakeUpQueueByIdempotencyKey.size === 0) return;

  const entries = Array.from(wakeUpQueueByIdempotencyKey.values());
  wakeUpQueueByIdempotencyKey.clear();
  for (const entry of entries) {
    Promise.resolve()
      .then(() => runWakeUpJob(entry))
      .catch(() => {
        metrics.recordAsyncWakeup('failed');
      });
  }
}

function scheduleWakeDispatch() {
  if (wakeDispatchScheduled) return;
  wakeDispatchScheduled = true;
  setImmediate(() => {
    wakeDispatchScheduled = false;
    dispatchWakeUps();
  });
}

function requestWakeUp(jobId, options = {}) {
  const job = getJob(jobId);
  if (!job) {
    return { accepted: false, reason: 'job_not_found' };
  }

  const idempotencyKey =
    typeof options.idempotencyKey === 'string' && options.idempotencyKey.trim()
      ? options.idempotencyKey.trim()
      : String(job.idempotencyKey || '').trim();

  if (!idempotencyKey) {
    createAlarmEvent(jobId, {
      code: 'WAKEUP_IDEMPOTENCY_KEY_REQUIRED',
      severity: 'warning',
      message: 'Wake-up cannot be started without an idempotencyKey.',
      actor: options.actor || 'watchdog',
      dedupeKey: `wakeup-idempotency-missing:${jobId}`,
    });
    return { accepted: false, reason: 'missing_idempotency_key' };
  }

  const wakeState = job.wakeState || {};
  if (
    wakeState.idempotencyKey === idempotencyKey &&
    ['queued', 'running', 'completed'].includes(String(wakeState.status || ''))
  ) {
    return {
      accepted: true,
      reused: true,
      idempotencyKey,
      status: wakeState.status,
      wakeJobId: wakeState.wakeJobId || null,
    };
  }

  const queued = enqueueWakeUp({
    jobId,
    idempotencyKey,
    reason: options.reason || 'watchdog',
    actor: options.actor || 'watchdog',
    broker: options.broker || null,
  });
  if (!queued) {
    return { accepted: true, reused: true, idempotencyKey, status: 'queued' };
  }

  updateJob(jobId, {
    wakeState: {
      status: 'queued',
      idempotencyKey,
      reason: options.reason || 'watchdog',
      actor: options.actor || 'watchdog',
      attempts: Number(wakeState.attempts || 0),
      lastRequestedAt: nowIso(),
      lastAttemptAt: wakeState.lastAttemptAt || null,
      lastError: null,
      wakeJobId: wakeState.wakeJobId || null,
    },
  });
  scheduleWakeDispatch();
  metrics.recordAsyncWakeup('queued');
  return { accepted: true, reused: false, idempotencyKey, status: 'queued' };
}

function markJobRecoveryPending(jobId, reason, actor = 'watchdog') {
  const job = getJob(jobId);
  if (!job) return null;
  if (String(job.status) === JOB_STATUS.RECOVERY_PENDING) return job;

  return updateJob(jobId, {
    status: JOB_STATUS.RECOVERY_PENDING,
    leaseOwner: null,
    leaseExpiresAt: null,
    lastHeartbeatAt: null,
    recovery: {
      status: 'pending',
      reason: String(reason || 'unknown'),
      at: nowIso(),
      actor: String(actor || 'watchdog'),
    },
  });
}

function watchdogSweep(options = {}) {
  const broker = options.broker || null;
  const actor = options.actor || 'watchdog';
  const now = Date.now();
  const jobs = listJobs();
  const summary = {
    scanned: jobs.length,
    leaseExpired: 0,
    escalated: 0,
    wakeQueued: 0,
  };

  for (const job of jobs) {
    if (String(job?.status) !== JOB_STATUS.RUNNING) continue;
    if (!isLeaseExpired(job, now)) continue;

    summary.leaseExpired += 1;
    metrics.recordAsyncLeaseMiss('expired');
    const missedLeases = Number(job?.missedLeases || 0) + 1;
    updateJob(job.jobId, {
      missedLeases,
      lastLeaseCheckAt: nowIso(),
      leaseState: 'expired',
    });

    if (missedLeases < MAX_MISSED_LEASES) {
      continue;
    }

    summary.escalated += 1;
    markJobRecoveryPending(job.jobId, 'lease_expired', actor);
    createAlarmEvent(job.jobId, {
      code: 'LEASE_MISSES_EXCEEDED',
      severity: 'critical',
      message: `Lease expired ${missedLeases} times (max ${MAX_MISSED_LEASES}).`,
      actor,
      dedupeKey: `lease-misses:${job.jobId}`,
      metadata: {
        missedLeases,
        maxMissedLeases: MAX_MISSED_LEASES,
      },
    });

    const wakeResult = requestWakeUp(job.jobId, {
      broker,
      reason: 'lease_expired',
      actor,
    });
    if (wakeResult.accepted) {
      summary.wakeQueued += 1;
    }
  }

  return summary;
}

function rehydrateOnStartup(options = {}) {
  const broker = options.broker || null;
  const actor = options.actor || 'startup';
  const jobs = listJobs();
  const summary = {
    scanned: jobs.length,
    movedToRecoveryPending: 0,
    wakeQueued: 0,
  };

  for (const job of jobs) {
    const status = String(job?.status || '');
    if (![JOB_STATUS.QUEUED, JOB_STATUS.RUNNING, JOB_STATUS.RECOVERY_PENDING].includes(status)) {
      continue;
    }

    if (status !== JOB_STATUS.RECOVERY_PENDING) {
      markJobRecoveryPending(job.jobId, 'startup_rehydration', actor);
      summary.movedToRecoveryPending += 1;
    }

    createAlarmEvent(job.jobId, {
      code: 'STARTUP_REHYDRATION_REQUIRED',
      severity: 'warning',
      message: 'Job moved to recovery_pending during startup rehydration.',
      actor,
      dedupeKey: `startup-rehydrate:${job.jobId}`,
      metadata: { originalStatus: status },
    });

    const wakeResult = requestWakeUp(job.jobId, {
      broker,
      reason: 'startup_rehydration',
      actor,
    });
    if (wakeResult.accepted) {
      summary.wakeQueued += 1;
    }
  }

  return summary;
}

function resetDispatchStateForTests() {
  pendingJobsByTenant.clear();
  runningJobsByTenant.clear();
  wakeUpQueueByIdempotencyKey.clear();
  roundRobinOffset = 0;
  dispatchScheduled = false;
  wakeDispatchScheduled = false;
}

// ─── Public CRUD API ──────────────────────────────────────────────────────────

/**
 * Create a new job record with status "queued". Returns the generated UUID jobId.
 * @param {Object} jobMeta - { service, action, tenantId, wakeContext }
 * @returns {string} jobId
 */
function createJob({
  service,
  action,
  idempotencyKey = null,
  tenantId = 'default',
  wakeContext = null,
  expectedDuration = null,
  deadlineAt = null,
}) {
  return DRIVER.createJob({
    service,
    action,
    idempotencyKey,
    tenantId,
    wakeContext,
    expectedDuration,
    deadlineAt,
  });
}

function findJobByIdempotencyKey(service, action, idempotencyKey) {
  if (typeof DRIVER.findJobByIdempotencyKey !== 'function') return null;
  return DRIVER.findJobByIdempotencyKey(service, action, idempotencyKey);
}

/**
 * Merge updates into an existing job record. Returns updated job or null if not found.
 * @param {string} jobId
 * @param {Object} updates - fields to merge (e.g. { status: 'running', error: '...' })
 * @param {Object} [options] - optional update controls, e.g. { expectedRev: 4 }
 * @returns {Object|null}
 */
function updateJob(jobId, updates, options = {}) {
  return DRIVER.updateJob(jobId, updates, options);
}

/**
 * Delete a job (progress + result) from storage.
 * @param {string} jobId
 * @returns {boolean}
 */
function deleteJob(jobId) {
  if (typeof DRIVER.deleteJob !== 'function') return false;
  return DRIVER.deleteJob(jobId);
}

/**
 * Append a structured log entry to the job's logs[] array.
 * Also updates the phase and percent fields for progress tracking.
 * Safe to call when jobId is null (no-op — used by internal worker calls).
 *
 * @param {string|null} jobId
 * @param {string}  phase    - Short phase identifier, e.g. 'pdf_parse'
 * @param {number}  percent  - Progress 0–100
 * @param {string}  message  - Human-readable log message
 * @returns {Object|null}
 */
function appendLog(jobId, phase, percent, message, details = {}) {
  return DRIVER.appendLog(jobId, phase, percent, message, details);
}

/**
 * Check if a job deadline has been exceeded.
 * @param {string} jobId
 * @returns {boolean} true if deadline is in the past
 */
function isDeadlineExceeded(jobId) {
  const job = getJob(jobId);
  if (!job?.deadlineAt) return false;
  return new Date(job.deadlineAt).getTime() <= Date.now();
}

/**
 * Get remaining time until job deadline in milliseconds.
 * Returns null if no deadline, -1 if exceeded.
 * @param {string} jobId
 * @returns {number|null}
 */
function getTimeUntilDeadline(jobId) {
  const job = getJob(jobId);
  if (!job?.deadlineAt) return null;
  const remaining = new Date(job.deadlineAt).getTime() - Date.now();
  return remaining > 0 ? remaining : -1;
}

/**
 * Save a result payload and mark job as "completed".
 * @param {string} jobId
 * @param {*} result - any JSON-serializable value
 * @returns {Object} updated job record
 */
function saveResult(jobId, result) {
  return DRIVER.saveResult(jobId, result);
}

/**
 * Read job progress record. Returns null if not found.
 * @param {string} jobId
 * @returns {Object|null}
 */
function getJob(jobId) {
  return DRIVER.getJob(jobId);
}

/**
 * Read job result payload. Returns null if not found or TTL expired.
 * @param {string} jobId
 * @returns {*|null}
 */
function getResult(jobId) {
  return DRIVER.getResult(jobId);
}

/**
 * Garbage-collect jobs older than the TTL. Safe to call at any time.
 * Errors are silently ignored to prevent GC failures from crashing the service.
 * @param {number} [ttlMs] - optional TTL override (used in tests)
 */
function gcExpired(ttlMs = TTL_MS) {
  DRIVER.gcExpired(ttlMs);
}

// ─── High-level helper ────────────────────────────────────────────────────────

/**
 * Start an async job with the file-backed store.
 *
 * **Gateway detection**: when a request arrives from the REST API gateway,
 * `ctx.meta.$gateway` is set to `true` (by `api.service.js` onBeforeCall).
 * Internal Moleculer service-to-service calls do NOT set this flag, so they
 * receive the synchronous result directly — preserving backward-compatibility.
 *
 * **REST callers** receive HTTP 202 + Location header + { jobId, status: 'queued' }.
 * The worker runs fire-and-forget; callers poll GET /api/jobs/:jobId/status.
 *
 * @param {Object} ctx      - Moleculer action context
 * @param {Object} jobMeta  - { service, action } metadata stored with the job
 * @param {Function} worker - () => Promise<result>  (the actual async work)
 * @returns {Promise<Object>} queued job descriptor OR direct worker result
 */
async function startJob(ctx, jobMeta, worker, options = {}) {
  // ── Internal call (no gateway flag) — fall through to synchronous result ──
  if (!ctx.meta.$gateway) {
    return worker(null); // null jobId: appendLog calls are no-ops for internal callers
  }

  const idempotencyKey =
    typeof options.idempotencyKey === 'string' && options.idempotencyKey.trim()
      ? options.idempotencyKey.trim()
      : null;

  if (idempotencyKey) {
    const existing = findJobByIdempotencyKey(jobMeta?.service, jobMeta?.action, idempotencyKey);
    if (existing && (existing.status === 'queued' || existing.status === 'running')) {
      const descriptor = buildQueuedDescriptor(
        existing.jobId,
        'Existing idempotent job reused. Poll /api/jobs/:jobId/status for progress.'
      );
      descriptor.reused = true;
      ctx.meta.$statusCode = 202;
      ctx.meta.$responseHeaders = Object.assign(ctx.meta.$responseHeaders || {}, {
        Location: `/api/jobs/${existing.jobId}/status`,
        'Retry-After': '5',
      });
      return descriptor;
    }
  }

  const tenantId = ctx?.meta?.tenantId || 'default';
  const wakeContext =
    options.wakeContext && typeof options.wakeContext === 'object'
      ? {
          service: options.wakeContext.service || jobMeta?.service,
          action: options.wakeContext.action || jobMeta?.action,
          params: options.wakeContext.params || null,
        }
      : null;
  const quotaCheck = rateQuotaStore.checkAsyncJobQuota({ tenantId, required: 1 });
  await emitRateQuotaEvents(ctx, quotaCheck.newEvents || [], {
    service: jobMeta?.service || 'unknown',
    action: jobMeta?.action || 'unknown',
  });
  if (!quotaCheck.allowed) {
    throw new Errors.MoleculerError(
      'Async job quota exceeded for tenant.',
      429,
      'ASYNC_JOB_QUOTA_EXCEEDED',
      {
        tenantId,
        resource: quotaCheck.resource,
        limit: quotaCheck.limit,
        used: quotaCheck.used,
        remaining: quotaCheck.remaining,
        retryAfter: quotaCheck.retryAfter,
        responseHeaders: quotaCheck.responseHeaders,
      }
    );
  }

  const quotaSnapshot = rateQuotaStore.recordAsyncJobUsage({
    tenantId,
    service: jobMeta?.service,
    action: jobMeta?.action,
    count: 1,
  });
  await emitRateQuotaEvents(ctx, quotaSnapshot.newEvents || [], {
    service: jobMeta?.service || 'unknown',
    action: jobMeta?.action || 'unknown',
  });

  // ── REST call — create job, enqueue worker, return 202 immediately ────────
  const jobId = createJob({
    ...jobMeta,
    tenantId,
    idempotencyKey,
    wakeContext,
  });
  enqueuePendingJob({
    tenantId,
    jobId,
    idempotencyKey,
    worker,
  });
  scheduleDispatch();

  ctx.meta.$statusCode = 202;
  ctx.meta.$responseHeaders = Object.assign(ctx.meta.$responseHeaders || {}, {
    Location: `/api/jobs/${jobId}/status`,
    'Retry-After': '5',
  });

  return buildQueuedDescriptor(jobId);
}

function getDriverInfo() {
  return DRIVER.getInfo();
}

module.exports = {
  createJob,
  findJobByIdempotencyKey,
  listJobs,
  updateJob,
  deleteJob,
  appendLog,
  saveResult,
  getJob,
  getResult,
  createAlarmEvent,
  updateAlarmStatus,
  listAlarmEvents,
  requestWakeUp,
  watchdogSweep,
  rehydrateOnStartup,
  gcExpired,
  startJob,
  resetDispatchStateForTests,
  getDriverInfo,
  isDeadlineExceeded,
  getTimeUntilDeadline,
  JOB_STATUS,
  ALARM_STATUS,
  MAX_MISSED_LEASES,
  TTL_MS,
};
