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

const crypto = require('crypto');
const fs = require('fs');
const path = require('path');

const JOBS_DIR = process.env.JOB_STORE_DIR || path.join(__dirname, '..', 'data', 'jobs');

const TTL_MS = parseInt(process.env.JOB_STORE_TTL_SECONDS || '86400', 10) * 1000;

// ─── Internal helpers ─────────────────────────────────────────────────────────

function ensureDir() {
  if (!fs.existsSync(JOBS_DIR)) {
    fs.mkdirSync(JOBS_DIR, { recursive: true });
  }
}

function progressPath(jobId) {
  return path.join(JOBS_DIR, `${jobId}.progress.json`);
}

function resultPath(jobId) {
  return path.join(JOBS_DIR, `${jobId}.result.json`);
}

// ─── Public CRUD API ──────────────────────────────────────────────────────────

/**
 * Create a new job record with status "queued". Returns the generated UUID jobId.
 * @param {Object} jobMeta - { service, action }
 * @returns {string} jobId
 */
function createJob({ service, action }) {
  ensureDir();
  const jobId = crypto.randomUUID();
  const job = {
    jobId,
    service: service || 'unknown',
    action: action || 'unknown',
    status: 'queued',
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
    completedAt: null,
    error: null,
    phase: null,
    percent: null,
    logs: [],
  };
  fs.writeFileSync(progressPath(jobId), JSON.stringify(job));
  return jobId;
}

/**
 * Merge updates into an existing job record. Returns updated job or null if not found.
 * @param {string} jobId
 * @param {Object} updates - fields to merge (e.g. { status: 'running', error: '...' })
 * @returns {Object|null}
 */
function updateJob(jobId, updates) {
  const job = getJob(jobId);
  if (!job) return null;
  const updated = { ...job, ...updates, updatedAt: new Date().toISOString() };
  fs.writeFileSync(progressPath(jobId), JSON.stringify(updated));
  return updated;
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
  if (!jobId) return null; // no-op for internal (non-gateway) worker calls
  const job = getJob(jobId);
  if (!job) return null;
  const logs = Array.isArray(job.logs) ? job.logs : [];
  logs.push({ timestamp: new Date().toISOString(), phase, percent, message });
  return updateJob(jobId, { logs, phase, percent });
}

/**
 * Persist the result payload and mark job as "completed".
 * @param {string} jobId
 * @param {*} result - any JSON-serializable value
 * @returns {Object} updated job record
 */
function saveResult(jobId, result) {
  ensureDir();
  fs.writeFileSync(resultPath(jobId), JSON.stringify(result));
  return updateJob(jobId, {
    status: 'completed',
    completedAt: new Date().toISOString(),
  });
}

/**
 * Read job progress record. Returns null if not found.
 * @param {string} jobId
 * @returns {Object|null}
 */
function getJob(jobId) {
  try {
    return JSON.parse(fs.readFileSync(progressPath(jobId), 'utf-8'));
  } catch {
    return null;
  }
}

/**
 * Read job result payload. Returns null if not found or TTL expired.
 * @param {string} jobId
 * @returns {*|null}
 */
function getResult(jobId) {
  try {
    return JSON.parse(fs.readFileSync(resultPath(jobId), 'utf-8'));
  } catch {
    return null;
  }
}

/**
 * Garbage-collect jobs older than the TTL. Safe to call at any time.
 * Errors are silently ignored to prevent GC failures from crashing the service.
 * @param {number} [ttlMs] - optional TTL override (used in tests)
 */
function gcExpired(ttlMs = TTL_MS) {
  try {
    ensureDir();
    const now = Date.now();
    const files = fs.readdirSync(JOBS_DIR).filter((f) => f.endsWith('.progress.json'));
    for (const f of files) {
      const id = f.replace('.progress.json', '');
      const job = getJob(id);
      if (job && now - new Date(job.createdAt).getTime() >= ttlMs) {
        try {
          fs.unlinkSync(progressPath(id));
        } catch {
          /* ignore */
        }
        try {
          fs.unlinkSync(resultPath(id));
        } catch {
          /* ignore */
        }
      }
    }
  } catch {
    // GC failures must never crash the application
  }
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

  // Fire-and-forget: do NOT await — return the 202 response immediately.
  // Worker receives jobId so it can call appendLog for progress tracking.
  worker(jobId)
    .then((result) => saveResult(jobId, result))
    .catch((err) => updateJob(jobId, { status: 'error', error: String(err.message || err) }));

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

module.exports = {
  createJob,
  updateJob,
  appendLog,
  saveResult,
  getJob,
  getResult,
  gcExpired,
  startJob,
  TTL_MS,
};
