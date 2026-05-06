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

const DRIVER = createDriver();
const LEASE_SECONDS = Number(process.env.JOB_STORE_LEASE_SECONDS || 30);
const HEARTBEAT_SECONDS = Number(process.env.JOB_STORE_HEARTBEAT_SECONDS || 10);

const TTL_MS = parseInt(process.env.JOB_STORE_TTL_SECONDS || '86400', 10) * 1000;

// ─── Internal helpers ─────────────────────────────────────────────────────────

function buildLeasePatch() {
  const now = Date.now();
  return {
    leaseOwner: `${process.pid}`,
    lastHeartbeatAt: new Date(now).toISOString(),
    leaseExpiresAt: new Date(now + LEASE_SECONDS * 1000).toISOString(),
  };
}

// ─── Public CRUD API ──────────────────────────────────────────────────────────

/**
 * Create a new job record with status "queued". Returns the generated UUID jobId.
 * @param {Object} jobMeta - { service, action }
 * @returns {string} jobId
 */
function createJob({ service, action }) {
  return DRIVER.createJob({ service, action });
}

/**
 * Merge updates into an existing job record. Returns updated job or null if not found.
 * @param {string} jobId
 * @param {Object} updates - fields to merge (e.g. { status: 'running', error: '...' })
 * @returns {Object|null}
 */
function updateJob(jobId, updates) {
  return DRIVER.updateJob(jobId, updates);
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
function appendLog(jobId, phase, percent, message) {
  return DRIVER.appendLog(jobId, phase, percent, message);
}

/**
 * Persist the result payload and mark job as "completed".
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
async function startJob(ctx, jobMeta, worker) {
  // ── Internal call (no gateway flag) — fall through to synchronous result ──
  if (!ctx.meta.$gateway) {
    return worker(null); // null jobId: appendLog calls are no-ops for internal callers
  }

  // ── REST call — create job, fire worker, return 202 immediately ───────────
  const jobId = createJob(jobMeta);
  updateJob(jobId, { status: 'running', ...buildLeasePatch() });

  let heartbeat = null;
  if (HEARTBEAT_SECONDS > 0) {
    heartbeat = setInterval(() => {
      updateJob(jobId, { ...buildLeasePatch() });
    }, HEARTBEAT_SECONDS * 1000);
    heartbeat.unref?.();
  }

  // Fire-and-forget: do NOT await — return the 202 response immediately.
  // Worker receives jobId so it can call appendLog for progress tracking.
  worker(jobId)
    .then((result) => saveResult(jobId, result))
    .catch((err) =>
      updateJob(jobId, {
        status: 'error',
        error: String(err.message || err),
        leaseOwner: null,
        leaseExpiresAt: null,
        lastHeartbeatAt: null,
      })
    )
    .finally(() => {
      if (heartbeat) clearInterval(heartbeat);
    });

  ctx.meta.$statusCode = 202;
  ctx.meta.$responseHeaders = Object.assign(ctx.meta.$responseHeaders || {}, {
    Location: `/api/jobs/${jobId}/status`,
    'Retry-After': '5',
  });

  return {
    success: true,
    jobId,
    status: 'queued',
    message: 'Job started. Poll /api/jobs/:jobId/status for progress.',
    statusUrl: `/api/jobs/${jobId}/status`,
    resultUrl: `/api/jobs/${jobId}/result`,
  };
}

function getDriverInfo() {
  return DRIVER.getInfo();
}

module.exports = {
  createJob,
  updateJob,
  appendLog,
  saveResult,
  getJob,
  getResult,
  gcExpired,
  startJob,
  getDriverInfo,
  TTL_MS,
};
