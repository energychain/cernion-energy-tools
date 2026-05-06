/**
 * Job Store Tests (v0.9.8+)
 *
 * Tests for the file-backed async job persistence layer.
 * Uses an isolated temp directory to avoid polluting the real .jobs/ directory.
 */

'use strict';

const os = require('os');
const fs = require('fs');
const path = require('path');

// ─── Helpers ──────────────────────────────────────────────────────────────────

let tempDir;
let jobStore;

function loadFreshModule() {
  jest.resetModules();
  // Point job-store at our temp directory
  process.env.JOB_STORE_DIR = tempDir;
  // eslint-disable-next-line global-require
  jobStore = require('../src/job-store');
}

beforeEach(() => {
  tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'job-store-test-'));
  loadFreshModule();
});

afterEach(() => {
  // Clean up temp directory
  try {
    fs.rmSync(tempDir, { recursive: true, force: true });
  } catch {
    // Ignore cleanup errors
  }
  delete process.env.JOB_STORE_DIR;
});

// ─── createJob ────────────────────────────────────────────────────────────────

describe('createJob', () => {
  it('should return a UUID string', () => {
    const id = jobStore.createJob({ service: 'test', action: 'run' });
    expect(typeof id).toBe('string');
    expect(id).toMatch(/^[0-9a-f-]{36}$/);
  });

  it('should write a progress file with status "queued"', () => {
    const id = jobStore.createJob({ service: 'svc', action: 'act' });
    const job = jobStore.getJob(id);
    expect(job).not.toBeNull();
    expect(job.status).toBe('queued');
    expect(job.service).toBe('svc');
    expect(job.action).toBe('act');
    expect(job.jobId).toBe(id);
  });

  it('should include ISO timestamp fields', () => {
    const id = jobStore.createJob({ service: 'x', action: 'y' });
    const job = jobStore.getJob(id);
    expect(job.createdAt).toBeDefined();
    expect(new Date(job.createdAt).toISOString()).toBe(job.createdAt);
    expect(job.completedAt).toBeNull();
    expect(job.error).toBeNull();
  });

  it('should create distinct job IDs for each call', () => {
    const id1 = jobStore.createJob({ service: 'a', action: 'b' });
    const id2 = jobStore.createJob({ service: 'a', action: 'b' });
    expect(id1).not.toBe(id2);
  });

  it('should default service/action when not provided', () => {
    const id = jobStore.createJob({});
    const job = jobStore.getJob(id);
    expect(job.service).toBe('unknown');
    expect(job.action).toBe('unknown');
  });

  it('exposes selected driver metadata (default file)', () => {
    const info = jobStore.getDriverInfo();
    expect(info.name).toBe('file');
  });
});

describe('driver selection', () => {
  afterEach(() => {
    delete process.env.JOB_STORE_DRIVER;
  });

  it('supports pouchdb driver selection via env', () => {
    process.env.JOB_STORE_DRIVER = 'pouchdb';
    loadFreshModule();
    const info = jobStore.getDriverInfo();
    expect(info.name).toBe('pouchdb');
  });

  it('supports redis-compat driver selection via env', () => {
    process.env.JOB_STORE_DRIVER = 'redis-compat';
    loadFreshModule();
    const info = jobStore.getDriverInfo();
    expect(info.name).toBe('redis-compat');
  });
});

// ─── updateJob ────────────────────────────────────────────────────────────────

describe('updateJob', () => {
  it('should merge updates into an existing job', () => {
    const id = jobStore.createJob({ service: 's', action: 'a' });
    const updated = jobStore.updateJob(id, { status: 'running' });
    expect(updated.status).toBe('running');
    expect(jobStore.getJob(id).status).toBe('running');
  });

  it('should update the updatedAt timestamp', async () => {
    const id = jobStore.createJob({ service: 's', action: 'a' });
    const before = jobStore.getJob(id).updatedAt;
    // Small delay to ensure timestamp differs
    await new Promise((r) => setTimeout(r, 5));
    jobStore.updateJob(id, { status: 'running' });
    const after = jobStore.getJob(id).updatedAt;
    expect(after >= before).toBe(true);
  });

  it('should return null for an unknown job ID', () => {
    expect(jobStore.updateJob('nonexistent-id', { status: 'running' })).toBeNull();
  });
});

// ─── saveResult ───────────────────────────────────────────────────────────────

describe('saveResult', () => {
  it('should set status to "completed" and write result file', () => {
    const id = jobStore.createJob({ service: 's', action: 'a' });
    jobStore.saveResult(id, { data: { value: 42 } });
    const job = jobStore.getJob(id);
    expect(job.status).toBe('completed');
    expect(job.completedAt).not.toBeNull();
  });

  it('should persist the result payload', () => {
    const id = jobStore.createJob({ service: 's', action: 'a' });
    const payload = { items: [1, 2, 3], total: 3 };
    jobStore.saveResult(id, payload);
    const result = jobStore.getResult(id);
    expect(result).toEqual(payload);
  });

  it('should handle complex nested result objects', () => {
    const id = jobStore.createJob({ service: 's', action: 'a' });
    const payload = { data: { nested: { deep: true } }, arr: [1, 2] };
    jobStore.saveResult(id, payload);
    expect(jobStore.getResult(id)).toEqual(payload);
  });
});

// ─── getJob ───────────────────────────────────────────────────────────────────

describe('getJob', () => {
  it('should return null for a completely unknown ID', () => {
    expect(jobStore.getJob('does-not-exist')).toBeNull();
  });

  it('should return the job record after creation', () => {
    const id = jobStore.createJob({ service: 's', action: 'a' });
    const job = jobStore.getJob(id);
    expect(job).not.toBeNull();
    expect(job.jobId).toBe(id);
  });
});

// ─── getResult ────────────────────────────────────────────────────────────────

describe('getResult', () => {
  it('should return null when no result file exists', () => {
    const id = jobStore.createJob({ service: 's', action: 'a' });
    expect(jobStore.getResult(id)).toBeNull();
  });

  it('should return the saved result payload', () => {
    const id = jobStore.createJob({ service: 's', action: 'a' });
    const payload = { ok: true };
    jobStore.saveResult(id, payload);
    expect(jobStore.getResult(id)).toEqual(payload);
  });

  it('should return null for an unknown job ID', () => {
    expect(jobStore.getResult('ghost-id')).toBeNull();
  });
});

// ─── gcExpired ────────────────────────────────────────────────────────────────

describe('gcExpired', () => {
  it('should leave recent jobs untouched', () => {
    const id = jobStore.createJob({ service: 's', action: 'a' });
    jobStore.gcExpired(60 * 60 * 1000); // TTL = 1 hour
    expect(jobStore.getJob(id)).not.toBeNull();
  });

  it('should remove jobs older than the TTL', () => {
    const id = jobStore.createJob({ service: 's', action: 'a' });
    jobStore.gcExpired(0); // TTL = 0 ms → everything is expired
    expect(jobStore.getJob(id)).toBeNull();
  });

  it('should also remove result files when purging', () => {
    const id = jobStore.createJob({ service: 's', action: 'a' });
    jobStore.saveResult(id, { ok: true });
    jobStore.gcExpired(0);
    expect(jobStore.getResult(id)).toBeNull();
  });

  it('should not throw when jobs directory is empty', () => {
    expect(() => jobStore.gcExpired(0)).not.toThrow();
  });
});

// ─── appendLog ────────────────────────────────────────────────────────────────

describe('appendLog', () => {
  it('appends a log entry to the logs array', () => {
    const id = jobStore.createJob({ service: 's', action: 'a' });
    jobStore.appendLog(id, 'pdf_parse', 10, 'Lese PDF...');
    const job = jobStore.getJob(id);
    expect(job.logs).toHaveLength(1);
    expect(job.logs[0].phase).toBe('pdf_parse');
    expect(job.logs[0].percent).toBe(10);
    expect(job.logs[0].message).toBe('Lese PDF...');
  });

  it('accumulates multiple log entries in order', () => {
    const id = jobStore.createJob({ service: 's', action: 'a' });
    jobStore.appendLog(id, 'step_a', 20, 'Step A done');
    jobStore.appendLog(id, 'step_b', 60, 'Step B done');
    jobStore.appendLog(id, 'done', 100, 'Finished');
    const job = jobStore.getJob(id);
    expect(job.logs).toHaveLength(3);
    expect(job.logs[2].phase).toBe('done');
    expect(job.percent).toBe(100);
    expect(job.phase).toBe('done');
  });

  it('includes an ISO timestamp on each log entry', () => {
    const id = jobStore.createJob({ service: 's', action: 'a' });
    jobStore.appendLog(id, 'step', 50, 'Mid-point');
    const { timestamp } = jobStore.getJob(id).logs[0];
    expect(new Date(timestamp).toISOString()).toBe(timestamp);
  });

  it('is a no-op and returns null when jobId is null', () => {
    const result = jobStore.appendLog(null, 'phase', 50, 'msg');
    expect(result).toBeNull();
  });

  it('returns null for an unknown job ID', () => {
    const result = jobStore.appendLog('no-such-id', 'phase', 50, 'msg');
    expect(result).toBeNull();
  });

  it('initialises logs[] to an empty array on createJob', () => {
    const id = jobStore.createJob({ service: 's', action: 'a' });
    const job = jobStore.getJob(id);
    expect(Array.isArray(job.logs)).toBe(true);
    expect(job.logs).toHaveLength(0);
  });
});

// ─── startJob ─────────────────────────────────────────────────────────────────

describe('startJob', () => {
  describe('internal call (no $gateway flag)', () => {
    it('should return the worker result synchronously', async () => {
      const ctx = { meta: {} };
      const result = await jobStore.startJob(
        ctx,
        { service: 'svc', action: 'act' },
        async (jobId) => {
          expect(jobId).toBeNull();
          return { data: 'direct' };
        }
      );
      expect(result).toEqual({ data: 'direct' });
    });

    it('should NOT set $statusCode on ctx.meta', async () => {
      const ctx = { meta: {} };
      await jobStore.startJob(ctx, { service: 's', action: 'a' }, async () => ({}));
      expect(ctx.meta.$statusCode).toBeUndefined();
    });

    it('should propagate worker errors', async () => {
      const ctx = { meta: {} };
      await expect(
        jobStore.startJob(ctx, { service: 's', action: 'a' }, async () => {
          throw new Error('worker-error');
        })
      ).rejects.toThrow('worker-error');
    });
  });

  describe('REST gateway call ($gateway = true)', () => {
    it('should return a 202 job descriptor immediately', async () => {
      const ctx = { meta: { $gateway: true } };
      const result = await jobStore.startJob(ctx, { service: 'svc', action: 'act' }, async () => ({
        data: 'result',
      }));
      expect(result.status).toBe('queued');
      expect(result.jobId).toBeDefined();
      expect(result.statusUrl).toMatch(/^\/api\/jobs\//);
      expect(result.resultUrl).toMatch(/^\/api\/jobs\//);
    });

    it('should set ctx.meta.$statusCode to 202', async () => {
      const ctx = { meta: { $gateway: true } };
      await jobStore.startJob(ctx, { service: 's', action: 'a' }, async () => ({}));
      expect(ctx.meta.$statusCode).toBe(202);
    });

    it('should set Location and Retry-After response headers', async () => {
      const ctx = { meta: { $gateway: true } };
      await jobStore.startJob(ctx, { service: 's', action: 'a' }, async () => ({}));
      expect(ctx.meta.$responseHeaders.Location).toMatch(/^\/api\/jobs\//);
      expect(ctx.meta.$responseHeaders['Retry-After']).toBe('5');
    });

    it('should create a job file on disk', async () => {
      const ctx = { meta: { $gateway: true } };
      const res = await jobStore.startJob(ctx, { service: 'svc', action: 'act' }, async () => ({
        ok: true,
      }));
      const { jobId } = res;
      const job = jobStore.getJob(jobId);
      expect(job).not.toBeNull();
      expect(job.service).toBe('svc');
      expect(job.action).toBe('act');
    });

    it('should eventually persist the result after worker resolves', async () => {
      const ctx = { meta: { $gateway: true } };
      const payload = { magic: 42 };
      // Worker resolves on next tick
      const res = await jobStore.startJob(ctx, { service: 's', action: 'a' }, () =>
        Promise.resolve(payload)
      );
      // Wait for fire-and-forget worker
      await new Promise((r) => setTimeout(r, 30));
      expect(jobStore.getResult(res.jobId)).toEqual(payload);
      expect(jobStore.getJob(res.jobId).status).toBe('completed');
    });

    it('should mark job as "error" when worker rejects', async () => {
      const ctx = { meta: { $gateway: true } };
      const res = await jobStore.startJob(ctx, { service: 's', action: 'a' }, () =>
        Promise.reject(new Error('boom'))
      );
      await new Promise((r) => setTimeout(r, 30));
      const job = jobStore.getJob(res.jobId);
      expect(job.status).toBe('error');
      expect(job.error).toContain('boom');
    });

    it('should preserve existing $responseHeaders when setting Location', async () => {
      const ctx = { meta: { $gateway: true, $responseHeaders: { 'X-Custom': 'yes' } } };
      await jobStore.startJob(ctx, { service: 's', action: 'a' }, async () => ({}));
      expect(ctx.meta.$responseHeaders['X-Custom']).toBe('yes');
      expect(ctx.meta.$responseHeaders.Location).toBeDefined();
    });
  });
});
