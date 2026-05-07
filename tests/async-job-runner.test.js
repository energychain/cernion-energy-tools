'use strict';

jest.mock('../src/job-store', () => ({
  startJob: jest.fn(),
}));

const jobStore = require('../src/job-store');
const { runAsync, resolveClientKey, buildIdempotencyKey } = require('../src/async-job-runner');

describe('async-job-runner', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    jobStore.startJob.mockResolvedValue({ success: true, status: 'queued', jobId: 'job-1' });
  });

  it('prioritizes explicit client key over header values', () => {
    const key = resolveClientKey(
      {
        params: { clientKey: 'param-key' },
        meta: { requestHeaders: { 'x-client-key': 'header-key' } },
      },
      'explicit-key'
    );
    expect(key).toBe('explicit-key');
  });

  it('uses x-client-key header when provided', () => {
    const key = resolveClientKey(
      {
        meta: { requestHeaders: { 'x-client-key': 'header-key' } },
      },
      null
    );
    expect(key).toBe('header-key');
  });

  it('builds stable hash-based key without client key', () => {
    const keyA = buildIdempotencyKey({
      service: 'svc',
      action: 'act',
      params: { b: 2, a: 1 },
      clientKey: '',
    });
    const keyB = buildIdempotencyKey({
      service: 'svc',
      action: 'act',
      params: { a: 1, b: 2 },
      clientKey: '',
    });
    expect(keyA).toBe(keyB);
    expect(keyA.startsWith('hash:svc:act:')).toBe(true);
  });

  it('passes computed idempotency key into job-store.startJob', async () => {
    const ctx = {
      params: { foo: 'bar' },
      meta: { requestHeaders: { 'x-client-key': 'client-123' } },
    };
    const worker = jest.fn();

    await runAsync(ctx, {
      service: 'grid-connection',
      action: 'validate',
      params: ctx.params,
      worker,
    });

    expect(jobStore.startJob).toHaveBeenCalledTimes(1);
    expect(jobStore.startJob).toHaveBeenCalledWith(
      ctx,
      { service: 'grid-connection', action: 'validate' },
      worker,
      expect.objectContaining({
        idempotencyKey: expect.stringContaining('ck:client-123:grid-connection:validate:'),
      })
    );
  });
});
