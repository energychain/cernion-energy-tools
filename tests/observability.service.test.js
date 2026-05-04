'use strict';

const fs = require('fs');
const os = require('os');
const path = require('path');
const { ServiceBroker } = require('moleculer');

async function waitFor(checkFn, { timeoutMs = 4000, intervalMs = 50 } = {}) {
  const start = Date.now();
  let lastError = null;

  while (Date.now() - start < timeoutMs) {
    try {
      return await checkFn();
    } catch (err) {
      lastError = err;
      await new Promise((resolve) => setTimeout(resolve, intervalMs));
    }
  }

  throw lastError || new Error('Timed out while waiting for observability data');
}

describe('observability.service', () => {
  let broker;
  let dbPath;
  let originalDbPath;

  beforeAll(async () => {
    originalDbPath = process.env.OBSERVABILITY_DB_PATH;
    dbPath = path.join(os.tmpdir(), `observability-test-${Date.now()}`);
    process.env.OBSERVABILITY_DB_PATH = dbPath;

    jest.resetModules();

    const config = require('../moleculer.config');
    const ObservabilityService = require('../services/observability.service');

    broker = new ServiceBroker({
      ...config,
      logger: {
        type: 'Console',
        options: {
          level: 'fatal',
          colors: false,
          moduleColors: false,
          formatter: 'full',
          autoPadding: false,
        },
      },
      transporter: null,
      hotReload: false,
    });

    broker.createService(ObservabilityService);
    broker.createService({
      name: 'demo-ops',
      actions: {
        success: {
          async handler() {
            this.logger.info('demo info ck_secret_token_12345678');
            return { ok: true };
          },
        },
        failure: {
          async handler() {
            this.logger.error('demo failure Bearer very-secret-token');
            throw new Error('boom');
          },
        },
      },
    });

    await broker.start();
    await broker.call('demo-ops.success');
    await broker.call('demo-ops.failure').catch(() => null);
  });

  afterAll(async () => {
    if (broker) {
      await broker.stop();
    }
    if (originalDbPath === undefined) {
      delete process.env.OBSERVABILITY_DB_PATH;
    } else {
      process.env.OBSERVABILITY_DB_PATH = originalDbPath;
    }
    fs.rmSync(dbPath, { recursive: true, force: true });
  });

  it('captures redacted service logger output', async () => {
    const response = await waitFor(async () => {
      const result = await broker.call('observability.logs', {
        service: 'demo-ops',
        limit: 10,
        sinceMinutes: 10,
      });
      const hasInfo = result.logs.some((entry) => entry.level === 'info');
      const hasError = result.logs.some((entry) => entry.level === 'error');
      if (!hasInfo || !hasError) {
        throw new Error('Waiting for captured info+error logs');
      }
      return result;
    });

    expect(response.logs.some((entry) => entry.level === 'info')).toBe(true);
    expect(response.logs.some((entry) => entry.level === 'error')).toBe(true);

    const joinedMessages = response.logs.map((entry) => entry.message).join(' ');
    expect(joinedMessages).toContain('ck_[REDACTED]');
    expect(joinedMessages).toContain('Bearer [REDACTED]');
    expect(joinedMessages).not.toContain('very-secret-token');
  });

  it('aggregates action performance metrics by action', async () => {
    const response = await waitFor(async () => {
      const result = await broker.call('observability.metrics', {
        service: 'demo-ops',
        limit: 20,
        sinceMinutes: 10,
        includeRaw: true,
      });
      const hasSuccess = result.actions.some((entry) => entry.action === 'demo-ops.success');
      const hasFailure = result.actions.some((entry) => entry.action === 'demo-ops.failure');
      if (!hasSuccess || !hasFailure) {
        throw new Error('Waiting for captured metrics');
      }
      return result;
    });

    const successEntry = response.actions.find((entry) => entry.action === 'demo-ops.success');
    const failureEntry = response.actions.find((entry) => entry.action === 'demo-ops.failure');

    expect(response.summary.totalCalls).toBeGreaterThanOrEqual(2);
    expect(successEntry.successCount).toBeGreaterThanOrEqual(1);
    expect(failureEntry.errorCount).toBeGreaterThanOrEqual(1);
    expect(response.recent.some((entry) => entry.requestOrigin === 'internal')).toBe(true);
  });

  it('returns a compact overview for recent operational feedback', async () => {
    const response = await broker.call('observability.summary', {
      limit: 5,
      sinceMinutes: 10,
      slowActionThresholdMs: 1,
    });

    expect(response.logs.total).toBeGreaterThanOrEqual(2);
    expect(response.logs.byLevel.error).toBeGreaterThanOrEqual(1);
    expect(response.metrics.overview.totalCalls).toBeGreaterThanOrEqual(2);
    expect(response.metrics.slowestActions.length).toBeGreaterThan(0);
    expect(response.retention.logRetentionDays).toBeGreaterThan(0);
  });

  it('builds an agent-ready debugging prompt from current observability data', async () => {
    const response = await broker.call('observability.agentPrompt', {
      sinceMinutes: 10,
      slowActionThresholdMs: 1,
      limit: 3,
    });

    expect(typeof response.prompt).toBe('string');
    expect(response.prompt).toContain('operations debugging agent');
    expect(response.prompt).toContain('Recent errors:');
    expect(response.prompt).toContain('Slowest actions:');
    expect(response.context.logs.total).toBeGreaterThanOrEqual(2);
    expect(response.context.metrics.overview.totalCalls).toBeGreaterThanOrEqual(2);
  });
});
