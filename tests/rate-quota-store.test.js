'use strict';

const fs = require('fs');
const os = require('os');
const path = require('path');

let rateQuotaStore;
let tempDir;

function loadFreshModule() {
  jest.resetModules();
  rateQuotaStore = require('../src/rate-quota-store');
}

beforeEach(() => {
  tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'rate-quota-store-'));
  process.env.RATE_QUOTA_DIR = tempDir;
  delete process.env.RATE_QUOTA_DRIVER;
  loadFreshModule();
});

afterEach(() => {
  rateQuotaStore.resetForTests();
  delete process.env.RATE_QUOTA_DIR;
  delete process.env.RATE_QUOTA_DRIVER;
  fs.rmSync(tempDir, { recursive: true, force: true });
});

describe('rate-quota-store', () => {
  it('uses redis-compat driver by default', () => {
    const info = rateQuotaStore.getDriverInfo();
    expect(info.name).toBe('redis-compat');
    expect(info.mode).toBe('compat-shim');
  });

  it('supports explicit file driver selection', () => {
    process.env.RATE_QUOTA_DRIVER = 'file';
    loadFreshModule();

    const info = rateQuotaStore.getDriverInfo();
    expect(info.name).toBe('file');
  });

  it('records llm usage into day and month windows', () => {
    const snapshot = rateQuotaStore.recordLlmUsage({
      tenantId: 'tenant-a',
      provider: 'gemini',
      model: 'default',
      operation: 'generate_text',
      prompt: 'hello world',
      completion: 'response',
    });

    expect(snapshot.usage.llm_tokens_per_day.used).toBeGreaterThan(0);
    expect(snapshot.usage.llm_tokens_per_month.used).toBeGreaterThan(0);
    expect(snapshot.usage.llm_tokens_per_day.lastMeta).toEqual(
      expect.objectContaining({ operation: 'generate_text', isEstimated: true })
    );
  });

  it('creates threshold events once quota reaches 90 percent', () => {
    const largePrompt = 'x'.repeat(900000);
    rateQuotaStore.recordLlmUsage({
      tenantId: 'tenant-a',
      provider: 'gemini',
      model: 'default',
      operation: 'generate_text',
      prompt: largePrompt,
      completion: 'done',
    });

    const events = rateQuotaStore.listTenantEvents('tenant-a');
    expect(events.events.some((item) => item.type === 'quota.threshold.reached')).toBe(true);
  });

  it('enforces token-bucket rate limits and returns retry metadata', () => {
    const first = rateQuotaStore.acquireRateLimitToken({ tenantId: 'tenant-a', endpointClass: 'read' });
    expect(first.allowed).toBe(true);

    const state = rateQuotaStore.getTenantState('tenant-a');
    state.config.rateLimits.read = 1;
    rateQuotaStore.saveTenantState('tenant-a', state);

    const second = rateQuotaStore.acquireRateLimitToken({ tenantId: 'tenant-a', endpointClass: 'read' });
    const third = rateQuotaStore.acquireRateLimitToken({ tenantId: 'tenant-a', endpointClass: 'read' });

    expect(second.allowed).toBe(true);
    expect(third.allowed).toBe(false);
    expect(third.retryAfter).toBeGreaterThan(0);
    expect(third.responseHeaders['X-RateLimit-Limit']).toBe('1');
  });
});
