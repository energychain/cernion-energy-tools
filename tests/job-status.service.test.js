/**
 * Job Status Service Tests (v0.9.8+)
 *
 * Tests for GET /api/jobs/:jobId/status and GET /api/jobs/:jobId/result endpoints.
 * The jobStore module is mocked so no real files are written.
 */

'use strict';

const { ServiceBroker } = require('moleculer');

// ─── Mock job-store ───────────────────────────────────────────────────────────

jest.mock('../src/job-store', () => ({
  getJob: jest.fn(),
  getResult: jest.fn(),
  gcExpired: jest.fn(),
}));

const jobStore = require('../src/job-store');
const JobStatusService = require('../services/job-status.service');

// ─── Test broker setup ────────────────────────────────────────────────────────

describe('Job Status Service', () => {
  let broker;

  beforeAll(async () => {
    broker = new ServiceBroker({ logger: false, transporter: null });
    broker.createService(JobStatusService);
    await broker.start();
  });

  afterAll(async () => {
    await broker.stop();
  });

  beforeEach(() => {
    jest.clearAllMocks();
  });

  // ─── Service registration ──────────────────────────────────────────────────

  describe('service registration', () => {
    it('should register as "job-status"', () => {
      const svc = broker.getLocalService('job-status');
      expect(svc).toBeDefined();
    });

    it('should expose a "status" action', () => {
      const svc = broker.getLocalService('job-status');
      expect(svc.actions.status).toBeDefined();
    });

    it('should expose a "result" action', () => {
      const svc = broker.getLocalService('job-status');
      expect(svc.actions.result).toBeDefined();
    });

    it('should expose a "progress" action', () => {
      const svc = broker.getLocalService('job-status');
      expect(svc.actions.progress).toBeDefined();
    });

    it('should have correct REST endpoints', () => {
      const schema = broker.getLocalService('job-status').schema;
      expect(schema.actions.status.rest).toBe('GET /:jobId/status');
      expect(schema.actions.progress.rest).toBe('GET /:jobId/progress');
      expect(schema.actions.result.rest).toBe('GET /:jobId/result');
    });

    it('should call gcExpired when started() is invoked', async () => {
      // Verify gcExpired is called during the started() lifecycle hook.
      // We invoke it directly (rather than relying on broker.start() timing
      // which is cleared by beforeEach clearAllMocks).
      jest.clearAllMocks();
      const svc = broker.getLocalService('job-status');
      await svc.schema.started.call(svc);
      expect(jobStore.gcExpired).toHaveBeenCalledTimes(1);
    });
  });

  // ─── status action ────────────────────────────────────────────────────────

  describe('status action', () => {
    it('should return 404 for an unknown job ID', async () => {
      jobStore.getJob.mockReturnValue(null);
      const ctx = { params: { jobId: 'unknown-id' }, meta: {} };
      const result = await broker.call('job-status.status', ctx.params, { meta: ctx.meta });
      expect(ctx.meta.$statusCode).toBe(404);
      expect(result.success).toBe(false);
    });

    it('should return queued job record with location fields', async () => {
      const jobId = 'test-job-queued';
      jobStore.getJob.mockReturnValue({
        jobId,
        service: 'grid-operations',
        action: 'gridData',
        status: 'queued',
        createdAt: '2026-01-01T00:00:00.000Z',
        updatedAt: '2026-01-01T00:00:00.000Z',
        completedAt: null,
        error: null,
      });
      const meta = {};
      const result = await broker.call('job-status.status', { jobId }, { meta });
      expect(result.jobId).toBe(jobId);
      expect(result.status).toBe('queued');
      expect(result.location).toBe(`/api/jobs/${jobId}/status`);
      expect(result.resultUrl).toBeNull();
    });

    it('should include resultUrl when job is completed', async () => {
      const jobId = 'test-job-done';
      jobStore.getJob.mockReturnValue({
        jobId,
        service: 'grid-operations',
        action: 'gridData',
        status: 'completed',
        createdAt: '2026-01-01T00:00:00.000Z',
        updatedAt: '2026-01-01T00:08:00.000Z',
        completedAt: '2026-01-01T00:08:00.000Z',
        error: null,
      });
      const meta = {};
      const result = await broker.call('job-status.status', { jobId }, { meta });
      expect(result.status).toBe('completed');
      expect(result.resultUrl).toBe(`/api/jobs/${jobId}/result`);
    });

    it('should not set $statusCode for found jobs (defaults to 200)', async () => {
      const jobId = 'test-job-200';
      jobStore.getJob.mockReturnValue({
        jobId,
        status: 'running',
        service: 's',
        action: 'a',
        createdAt: '2026-01-01T00:00:00.000Z',
        updatedAt: '2026-01-01T00:00:01.000Z',
        completedAt: null,
        error: null,
      });
      const meta = {};
      await broker.call('job-status.status', { jobId }, { meta });
      expect(meta.$statusCode).toBeUndefined();
    });

    it('should require jobId parameter', async () => {
      await expect(broker.call('job-status.status', {})).rejects.toThrow();
    });
  });

  // ─── result action ────────────────────────────────────────────────────────

  describe('result action', () => {
    it('should return 404 for an unknown job ID', async () => {
      jobStore.getJob.mockReturnValue(null);
      const meta = {};
      const result = await broker.call('job-status.result', { jobId: 'ghost' }, { meta });
      expect(meta.$statusCode).toBe(404);
      expect(result.success).toBe(false);
    });

    it('should return 202 when job is still queued', async () => {
      const jobId = 'still-queued';
      jobStore.getJob.mockReturnValue({ jobId, status: 'queued', error: null });
      const meta = {};
      const result = await broker.call('job-status.result', { jobId }, { meta });
      expect(meta.$statusCode).toBe(202);
      expect(result.success).toBe(false);
      expect(result.status).toBe('queued');
      expect(result.location).toBe(`/api/jobs/${jobId}/status`);
    });

    it('should return 202 when job is running', async () => {
      const jobId = 'running-job';
      jobStore.getJob.mockReturnValue({ jobId, status: 'running', error: null });
      const meta = {};
      const result = await broker.call('job-status.result', { jobId }, { meta });
      expect(meta.$statusCode).toBe(202);
      expect(result.status).toBe('running');
    });

    it('should return 200 with result payload when job is completed', async () => {
      const jobId = 'completed-job';
      const payload = { success: true, data: { count: 5 } };
      jobStore.getJob.mockReturnValue({
        jobId,
        status: 'completed',
        completedAt: '2026-01-01T00:08:00.000Z',
        error: null,
      });
      jobStore.getResult.mockReturnValue(payload);
      const meta = {};
      const result = await broker.call('job-status.result', { jobId }, { meta });
      expect(meta.$statusCode).toBeUndefined(); // 200 is the default, no override needed
      expect(result).toEqual(payload);
    });

    it('should return 404 when result file is missing despite completed status', async () => {
      const jobId = 'no-result-file';
      jobStore.getJob.mockReturnValue({ jobId, status: 'completed', error: null });
      jobStore.getResult.mockReturnValue(null);
      const meta = {};
      const result = await broker.call('job-status.result', { jobId }, { meta });
      expect(meta.$statusCode).toBe(404);
      expect(result.success).toBe(false);
    });

    it('should require jobId parameter', async () => {
      await expect(broker.call('job-status.result', {})).rejects.toThrow();
    });
  });

  describe('progress action', () => {
    it('returns 404 for unknown job', async () => {
      jobStore.getJob.mockReturnValue(null);
      const meta = {};
      const result = await broker.call('job-status.progress', { jobId: 'ghost' }, { meta });
      expect(meta.$statusCode).toBe(404);
      expect(result.success).toBe(false);
    });

    it('returns normalized JSON progress payload by default', async () => {
      jobStore.getJob.mockReturnValue({
        jobId: 'job-1',
        status: 'running',
        logs: [
          {
            id: '1',
            timestamp: '2026-01-01T00:00:00.000Z',
            phase: 'step_a',
            percent: 25,
            message: 'Step A',
            step: 1,
            totalSteps: 4,
            payload: { a: true },
          },
        ],
      });

      const result = await broker.call('job-status.progress', { jobId: 'job-1' }, { meta: {} });
      expect(result.success).toBe(true);
      expect(result.progress).toEqual(
        expect.objectContaining({ step: 1, totalSteps: 4, message: 'Step A' })
      );
      expect(result.events).toHaveLength(1);
    });

    it('returns SSE payload and replays events after Last-Event-ID', async () => {
      jobStore.getJob.mockReturnValue({
        jobId: 'job-2',
        status: 'running',
        logs: [
          { id: '1', timestamp: '2026-01-01T00:00:00.000Z', phase: 'a', percent: 10, message: 'A' },
          { id: '2', timestamp: '2026-01-01T00:00:01.000Z', phase: 'b', percent: 50, message: 'B' },
          { id: '3', timestamp: '2026-01-01T00:00:02.000Z', phase: 'c', percent: 90, message: 'C' },
        ],
      });

      const meta = {
        requestHeaders: {
          accept: 'text/event-stream',
          'last-event-id': '2',
        },
      };

      const result = await broker.call('job-status.progress', { jobId: 'job-2' }, { meta });
      expect(meta.$responseType).toContain('text/event-stream');
      expect(result).toContain('event: progress');
      expect(result).toContain('id: 3');
      expect(result).not.toContain('id: 1');
    });
  });
});
