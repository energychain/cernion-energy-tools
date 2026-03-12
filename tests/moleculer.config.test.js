/**
 * Moleculer config hardening tests
 */

describe('moleculer.config environment toggles', () => {
  const originalEnv = { ...process.env };

  afterEach(() => {
    process.env = { ...originalEnv };
    jest.resetModules();
  });

  it('should use safe defaults when env vars are missing', () => {
    delete process.env.RETRY_POLICY_ENABLED;
    delete process.env.CIRCUIT_BREAKER_ENABLED;
    delete process.env.BULKHEAD_ENABLED;
    delete process.env.METRICS_ENABLED;
    delete process.env.TRACING_ENABLED;
    delete process.env.REQUEST_TIMEOUT_MS;

    const config = require('../moleculer.config');

    expect(config.requestTimeout).toBe(15 * 60 * 1000);
    expect(config.retryPolicy.enabled).toBe(false);
    expect(config.circuitBreaker.enabled).toBe(false);
    expect(config.bulkhead.enabled).toBe(false);
    expect(config.metrics.enabled).toBe(false);
    expect(config.tracing.enabled).toBe(false);
  });

  it('should parse boolean and numeric env vars for reliability controls', () => {
    process.env.REQUEST_TIMEOUT_MS = '120000';
    process.env.RETRY_POLICY_ENABLED = 'true';
    process.env.RETRY_POLICY_RETRIES = '7';
    process.env.CIRCUIT_BREAKER_ENABLED = '1';
    process.env.CIRCUIT_BREAKER_THRESHOLD = '0.3';
    process.env.BULKHEAD_ENABLED = 'yes';
    process.env.BULKHEAD_CONCURRENCY = '25';
    process.env.METRICS_ENABLED = 'on';
    process.env.TRACING_ENABLED = 'true';

    const config = require('../moleculer.config');

    expect(config.requestTimeout).toBe(120000);
    expect(config.retryPolicy.enabled).toBe(true);
    expect(config.retryPolicy.retries).toBe(7);
    expect(config.circuitBreaker.enabled).toBe(true);
    expect(config.circuitBreaker.threshold).toBe(0.3);
    expect(config.bulkhead.enabled).toBe(true);
    expect(config.bulkhead.concurrency).toBe(25);
    expect(config.metrics.enabled).toBe(true);
    expect(config.tracing.enabled).toBe(true);
  });
});
