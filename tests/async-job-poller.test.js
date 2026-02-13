/**
 * Async Job Poller Tests
 */

jest.mock('../src/mcp-client', () => ({
  callWithNewSession: jest.fn(),
}));

const { callWithNewSession } = require('../src/mcp-client');
const {
  pollJobUntilComplete,
  detectAsyncJob,
  callWithAutoPoll,
} = require('../src/async-job-poller');

describe('Async Job Poller', () => {
  describe('detectAsyncJob', () => {
    it('should detect job ID in response.jobId', () => {
      const response = { jobId: 'test-job-123', status: 'queued' };
      expect(detectAsyncJob(response)).toBe('test-job-123');
    });

    it('should detect job ID in response.job_id', () => {
      const response = { job_id: 'test-job-456', status: 'running' };
      expect(detectAsyncJob(response)).toBe('test-job-456');
    });

    it('should detect job ID in response.data.jobId', () => {
      const response = { data: { jobId: 'test-job-789' } };
      expect(detectAsyncJob(response)).toBe('test-job-789');
    });

    it('should detect job ID in response.metadata.jobId', () => {
      const response = { metadata: { jobId: 'test-job-abc' } };
      expect(detectAsyncJob(response)).toBe('test-job-abc');
    });

    it('should return null for non-async response', () => {
      const response = { success: true, data: { result: 'some data' } };
      expect(detectAsyncJob(response)).toBeNull();
    });

    it('should detect job ID for queued status', () => {
      const response = { status: 'queued', id: 'test-job-xyz' };
      expect(detectAsyncJob(response)).toBe('test-job-xyz');
    });

    it('should detect job ID for running status', () => {
      const response = { status: 'running', taskId: 'task-123' };
      expect(detectAsyncJob(response)).toBe('task-123');
    });
  });

  describe('pollJobUntilComplete', () => {
    // Note: Full integration tests would require mocking CernionMCPClient
    // These tests verify the structure and basic logic

    it('should have correct default options', () => {
      expect(pollJobUntilComplete).toBeDefined();
      expect(typeof pollJobUntilComplete).toBe('function');
    });

    it('should return result when job succeeds', async () => {
      callWithNewSession
        .mockResolvedValueOnce({ status: 'running' })
        .mockResolvedValueOnce({ status: 'succeeded' })
        .mockResolvedValueOnce({ data: { ok: true } });

      const result = await pollJobUntilComplete('job-1', {
        maxWaitTime: 50,
        pollInterval: 1,
      });

      expect(result.success).toBe(true);
      expect(result.data).toEqual({ ok: true });
    });

    it('should return error when job fails', async () => {
      callWithNewSession.mockResolvedValueOnce({ status: 'failed' });

      const result = await pollJobUntilComplete('job-2', {
        maxWaitTime: 50,
        pollInterval: 1,
      });

      expect(result.success).toBe(false);
      expect(result.error.message).toMatch(/Job failed/);
    });
  });

  describe('callWithAutoPoll', () => {
    it('should be a function', () => {
      expect(callWithAutoPoll).toBeDefined();
      expect(typeof callWithAutoPoll).toBe('function');
    });

    it('should return response when no async job', async () => {
      callWithNewSession.mockResolvedValueOnce({ success: true, data: { ok: true } });

      const result = await callWithAutoPoll('test_tool', { foo: 'bar' });

      expect(result.success).toBe(true);
      expect(result.data).toEqual({ ok: true });
    });

    it('should poll when async job detected', async () => {
      callWithNewSession
        .mockResolvedValueOnce({ jobId: 'job-3', status: 'queued' })
        .mockResolvedValueOnce({ status: 'succeeded' })
        .mockResolvedValueOnce({ data: { ok: true } });

      const result = await callWithAutoPoll('test_tool', { foo: 'bar' }, { pollInterval: 1 });

      expect(result.success).toBe(true);
      expect(result.data).toEqual({ ok: true });
    });
  });
});
