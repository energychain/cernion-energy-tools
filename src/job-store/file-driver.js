'use strict';

const crypto = require('crypto');
const fs = require('fs');
const path = require('path');
const JobStoreDriver = require('./driver');

const DEFAULT_DIR = path.join(__dirname, '..', '..', 'data', 'jobs');

class FileJobStoreDriver extends JobStoreDriver {
  constructor(options = {}) {
    super();
    this.jobsDir = options.jobsDir || process.env.JOB_STORE_DIR || DEFAULT_DIR;
  }

  ensureDir() {
    if (!fs.existsSync(this.jobsDir)) {
      fs.mkdirSync(this.jobsDir, { recursive: true });
    }
  }

  progressPath(jobId) {
    return path.join(this.jobsDir, `${jobId}.progress.json`);
  }

  resultPath(jobId) {
    return path.join(this.jobsDir, `${jobId}.result.json`);
  }

  createJob({ service, action, idempotencyKey = null, tenantId = 'default', wakeContext = null }) {
    this.ensureDir();
    const jobId = crypto.randomUUID();
    const now = new Date().toISOString();
    const job = {
      jobId,
      service: service || 'unknown',
      action: action || 'unknown',
      tenantId: String(tenantId || 'default'),
      idempotencyKey,
      status: 'queued',
      createdAt: now,
      updatedAt: now,
      completedAt: null,
      error: null,
      phase: null,
      percent: null,
      missedLeases: 0,
      leaseState: null,
      leaseOwner: null,
      leaseExpiresAt: null,
      lastHeartbeatAt: null,
      wakeContext:
        wakeContext && typeof wakeContext === 'object'
          ? {
              service: wakeContext.service || service || 'unknown',
              action: wakeContext.action || action || 'unknown',
              params: wakeContext.params || null,
            }
          : null,
      wakeState: {
        status: 'idle',
        idempotencyKey,
        reason: null,
        actor: null,
        attempts: 0,
        lastRequestedAt: null,
        lastAttemptAt: null,
        lastError: null,
        wakeJobId: null,
      },
      alarms: [],
      logs: [],
      _rev: 1,
    };
    fs.writeFileSync(this.progressPath(jobId), JSON.stringify(job));
    return jobId;
  }

  findJobByIdempotencyKey(service, action, idempotencyKey) {
    if (!idempotencyKey) return null;
    try {
      this.ensureDir();
      const files = fs.readdirSync(this.jobsDir).filter((f) => f.endsWith('.progress.json'));
      const jobs = files
        .map((f) => this.getJob(f.replace('.progress.json', '')))
        .filter(Boolean)
        .filter(
          (j) =>
            j.idempotencyKey === idempotencyKey &&
            j.service === (service || 'unknown') &&
            j.action === (action || 'unknown')
        )
        .sort((a, b) => (b.updatedAt || '').localeCompare(a.updatedAt || ''));

      return jobs[0] || null;
    } catch {
      return null;
    }
  }

  updateJob(jobId, updates, options = {}) {
    const job = this.getJob(jobId);
    if (!job) return null;

    if (Object.prototype.hasOwnProperty.call(options, 'expectedRev')) {
      const expectedRev = options.expectedRev;
      const currentRev = job._rev;
      if (expectedRev !== currentRev) {
        const error = new Error(
          `Job revision conflict for ${jobId}: expected ${expectedRev}, current ${currentRev}`
        );
        error.code = 409;
        error.type = 'JOB_OCC_CONFLICT';
        error.data = {
          jobId,
          expectedRev,
          currentRev,
        };
        throw error;
      }
    }

    const updated = { ...job, ...updates, updatedAt: new Date().toISOString() };
    updated._rev = Number.isFinite(Number(job._rev)) ? Number(job._rev) + 1 : 1;
    fs.writeFileSync(this.progressPath(jobId), JSON.stringify(updated));
    return updated;
  }

  deleteJob(jobId) {
    const existing = this.getJob(jobId);
    if (!existing) return false;

    try {
      fs.unlinkSync(this.progressPath(jobId));
    } catch {
      // ignore
    }
    try {
      fs.unlinkSync(this.resultPath(jobId));
    } catch {
      // ignore
    }
    return true;
  }

  appendLog(jobId, phase, percent, message, details = {}) {
    if (!jobId) return null;
    const job = this.getJob(jobId);
    if (!job) return null;
    const logs = Array.isArray(job.logs) ? job.logs : [];
    const ts = new Date().toISOString();
    const step = Number.isFinite(details.step) ? details.step : null;
    const totalSteps = Number.isFinite(details.totalSteps) ? details.totalSteps : null;
    const payload =
      details.payload && typeof details.payload === 'object' && !Array.isArray(details.payload)
        ? details.payload
        : null;

    logs.push({
      id: String(logs.length + 1),
      timestamp: ts,
      phase,
      percent,
      message,
      step,
      totalSteps,
      payload,
    });

    const progress = {
      step,
      totalSteps,
      message: message || null,
      payload,
      phase: phase || null,
      percent: Number.isFinite(percent) ? percent : null,
      at: ts,
    };

    return this.updateJob(jobId, { logs, phase, percent, progress });
  }

  saveResult(jobId, result) {
    const current = this.getJob(jobId);
    if (!current) return null;
    this.ensureDir();
    fs.writeFileSync(this.resultPath(jobId), JSON.stringify(result));
    return this.updateJob(jobId, {
      status: 'completed',
      completedAt: new Date().toISOString(),
      leaseOwner: null,
      leaseExpiresAt: null,
      lastHeartbeatAt: null,
    });
  }

  getJob(jobId) {
    try {
      return JSON.parse(fs.readFileSync(this.progressPath(jobId), 'utf-8'));
    } catch {
      return null;
    }
  }

  getResult(jobId) {
    try {
      return JSON.parse(fs.readFileSync(this.resultPath(jobId), 'utf-8'));
    } catch {
      return null;
    }
  }

  listJobs() {
    try {
      this.ensureDir();
      const files = fs.readdirSync(this.jobsDir).filter((f) => f.endsWith('.progress.json'));
      return files
        .map((f) => this.getJob(f.replace('.progress.json', '')))
        .filter(Boolean)
        .sort((a, b) => String(b.updatedAt || '').localeCompare(String(a.updatedAt || '')));
    } catch {
      return [];
    }
  }

  gcExpired(ttlMs) {
    try {
      this.ensureDir();
      const now = Date.now();
      const files = fs.readdirSync(this.jobsDir).filter((f) => f.endsWith('.progress.json'));
      for (const f of files) {
        const id = f.replace('.progress.json', '');
        const job = this.getJob(id);
        if (job && now - new Date(job.createdAt).getTime() >= ttlMs) {
          try {
            fs.unlinkSync(this.progressPath(id));
          } catch {
            /* ignore */
          }
          try {
            fs.unlinkSync(this.resultPath(id));
          } catch {
            /* ignore */
          }
        }
      }
    } catch {
      // never crash app on GC failures
    }
  }

  getInfo() {
    return {
      name: 'file',
      jobsDir: this.jobsDir,
    };
  }
}

module.exports = FileJobStoreDriver;
