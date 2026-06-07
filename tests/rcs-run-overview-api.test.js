'use strict';

// Set unique DB path before any module is loaded so rcs-simulation-run picks it up
process.env.RCS_SIM_RUN_DB = `rcs-test-overview-${Date.now()}`;

const { ServiceBroker } = require('moleculer');

const TIMEFRAME = { start: '2027-04-01T00:00:00Z', end: '2027-04-02T00:00:00Z' };

let broker;

beforeAll(async () => {
  broker = new ServiceBroker({ logger: false, transporter: null });
  broker.loadService('./services/rcs-simulation-run.service.js');
  await broker.start();
});

afterAll(async () => {
  await broker.stop();
  // Clean up PouchDB directories
  const { rm } = require('fs/promises');
  await rm(process.env.RCS_SIM_RUN_DB, { recursive: true, force: true }).catch(() => {});
});

// ── Helper ────────────────────────────────────────────────────────────────────

async function createRun(overrides = {}) {
  return broker.call('rcs-simulation-run.saveRun', {
    assetId: `asset-test-${Math.random().toString(36).slice(2)}`,
    timeframe: TIMEFRAME,
    summary: { totalVolumeKwh: 100 },
    assetIds: ['asset-solar-01', 'asset-wind-01'],
    scope: 'portfolio',
    ruleSetId: 'eeg2027-draft-2026-06',
    ...overrides,
  });
}

// ── listRuns response shape ───────────────────────────────────────────────────

describe('listRuns response shape', () => {
  test('returns total, offset, limit, hasMore, items array', async () => {
    const r = await broker.call('rcs-simulation-run.listRuns', {});
    expect(typeof r.total).toBe('number');
    expect(typeof r.offset).toBe('number');
    expect(typeof r.limit).toBe('number');
    expect(typeof r.hasMore).toBe('boolean');
    expect(Array.isArray(r.items)).toBe(true);
  });

  test('each run item has links with self, assets, errors, readiness', async () => {
    await createRun();
    const r = await broker.call('rcs-simulation-run.listRuns', { limit: 1 });
    expect(r.items.length).toBeGreaterThan(0);
    const run = r.items[0];
    expect(run.links.self).toMatch(/\/api\/vnb\/rcs\/runs\//);
    expect(run.links.assets).toMatch(/\/assets$/);
    expect(run.links.errors).toMatch(/\/errors$/);
    expect(run.links.readiness).toMatch(/\/readiness$/);
  });

  test('run item with jobId gets job links', async () => {
    await createRun({ jobId: 'job-test-xyz' });
    const r = await broker.call('rcs-simulation-run.listRuns', {
      jobId: 'job-test-xyz',
      limit: 1,
    });
    expect(r.items.length).toBe(1);
    const run = r.items[0];
    expect(run.links.jobStatus).toContain('job-test-xyz');
    expect(run.links.jobProgress).toContain('job-test-xyz');
    expect(run.links.jobResult).toContain('job-test-xyz');
  });
});

// ── Pagination ────────────────────────────────────────────────────────────────

describe('listRuns pagination', () => {
  beforeAll(async () => {
    // Seed 5 more runs for pagination tests
    for (let i = 0; i < 5; i++) {
      await createRun({ ruleSetId: 'eeg2027-draft-2026-06' });
    }
  });

  test('limit restricts returned items', async () => {
    const r = await broker.call('rcs-simulation-run.listRuns', { limit: 2 });
    expect(r.items.length).toBeLessThanOrEqual(2);
  });

  test('offset skips items and hasMore reflects remaining', async () => {
    const all = await broker.call('rcs-simulation-run.listRuns', { limit: 100 });
    const total = all.total;
    if (total < 2) return; // not enough data

    const page1 = await broker.call('rcs-simulation-run.listRuns', { limit: 2, offset: 0 });
    const page2 = await broker.call('rcs-simulation-run.listRuns', { limit: 2, offset: 2 });

    expect(page1.items.length).toBe(2);
    expect(page1.hasMore).toBe(true);

    const ids1 = page1.items.map((r) => r.runId);
    const ids2 = page2.items.map((r) => r.runId);
    expect(ids1.some((id) => ids2.includes(id))).toBe(false);
  });

  test('hasMore is false when all items fit in one page', async () => {
    const all = await broker.call('rcs-simulation-run.listRuns', { limit: 100 });
    expect(all.hasMore).toBe(false);
  });

  test('total is consistent regardless of limit', async () => {
    const full = await broker.call('rcs-simulation-run.listRuns', { limit: 100 });
    const page = await broker.call('rcs-simulation-run.listRuns', { limit: 1 });
    expect(page.total).toBe(full.total);
  });
});

// ── Filters ───────────────────────────────────────────────────────────────────

describe('listRuns filters', () => {
  test('filter by ruleSetId returns only matching runs', async () => {
    await createRun({ ruleSetId: 'eeg2027-draft-2026-04' });
    const r = await broker.call('rcs-simulation-run.listRuns', {
      ruleSetId: 'eeg2027-draft-2026-04',
    });
    expect(r.items.every((i) => i.ruleSetId === 'eeg2027-draft-2026-04')).toBe(true);
    expect(r.items.length).toBeGreaterThan(0);
  });

  test('filter by status returns only matching runs', async () => {
    const r = await broker.call('rcs-simulation-run.listRuns', { status: 'completed' });
    expect(r.items.every((i) => i.status === 'completed')).toBe(true);
  });
});

// ── Soft-delete behavior ──────────────────────────────────────────────────────

describe('soft-delete behavior in listRuns', () => {
  test('deleted runs are hidden by default', async () => {
    const run = await createRun();
    await broker.call('rcs-simulation-run.deleteRun', { runId: run.runId });

    const r = await broker.call('rcs-simulation-run.listRuns', {});
    const ids = r.items.map((i) => i.runId);
    expect(ids).not.toContain(run.runId);
  });

  test('includeDeleted: true shows soft-deleted runs', async () => {
    const run = await createRun();
    await broker.call('rcs-simulation-run.deleteRun', { runId: run.runId });

    const r = await broker.call('rcs-simulation-run.listRuns', { includeDeleted: true });
    const ids = r.items.map((i) => i.runId);
    expect(ids).toContain(run.runId);
  });
});

// ── getRun detail ─────────────────────────────────────────────────────────────

describe('getRun detail', () => {
  test('returns enriched run with links', async () => {
    const run = await createRun();
    const detail = await broker.call('rcs-simulation-run.getRun', { runId: run.runId });
    expect(detail.runId).toBe(run.runId);
    expect(detail.links.self).toContain(run.runId);
    expect(detail.links.assets).toBeDefined();
  });

  test('getRun throws RCS_RUN_NOT_FOUND for unknown runId', async () => {
    await expect(
      broker.call('rcs-simulation-run.getRun', { runId: 'run-does-not-exist-xyz' })
    ).rejects.toMatchObject({ type: 'RCS_RUN_NOT_FOUND' });
  });
});
