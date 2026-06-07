'use strict';

const { ServiceBroker } = require('moleculer');

let broker;

const SAMPLE_SUMMARY = {
  totalVolumeKwh: 960,
  calculatedUnderOldLaw: { totalRevenueCents: 7200, marketPremiumCents: 0, curtailedHoursCount: 0 },
  calculatedUnderNewLaw: { totalRefinancingContributionCents: 0, retainedRevenueCents: 7200, clawbackTriggeredIntervalsCount: 0 },
  deltaCents: 0,
  liquidityRiskIndex: 'low',
};

const SAMPLE_TIMEFRAME = { start: '2027-04-01T00:00:00Z', end: '2027-04-02T00:00:00Z' };

beforeAll(async () => {
  broker = new ServiceBroker({ logger: false, transporter: null });
  // Use in-memory PouchDB for tests
  process.env.RCS_SIM_RUN_DB = `rcs-test-runs-${Date.now()}`;
  broker.loadService('./services/rcs-simulation-run.service.js');
  await broker.start();
});

afterAll(async () => {
  await broker.stop();
});

// ── saveRun + getRun ──────────────────────────────────────────────────────────

describe('rcs-simulation-run — saveRun and getRun', () => {
  let savedRun;

  beforeAll(async () => {
    savedRun = await broker.call('rcs-simulation-run.saveRun', {
      assetId: 'test-asset-001',
      assetName: 'Test PV Anlage',
      timeframe: SAMPLE_TIMEFRAME,
      summary: SAMPLE_SUMMARY,
      ruleSetId: 'eeg2027-draft-2026-06',
      blueprintId: 'rcs-eeg2027-clawback-v1',
      options: { includeIntervalTrace: false },
    });
  });

  test('saveRun returns a runId', () => {
    expect(typeof savedRun.runId).toBe('string');
    expect(savedRun.runId.startsWith('run-')).toBe(true);
  });

  test('saveRun returns correct assetId', () => {
    expect(savedRun.assetId).toBe('test-asset-001');
  });

  test('saveRun returns status=completed', () => {
    expect(savedRun.status).toBe('completed');
  });

  test('saveRun stores ruleSetId', () => {
    expect(savedRun.ruleSetId).toBe('eeg2027-draft-2026-06');
  });

  test('getRun retrieves the same record', async () => {
    const fetched = await broker.call('rcs-simulation-run.getRun', { runId: savedRun.runId });
    expect(fetched.runId).toBe(savedRun.runId);
    expect(fetched.assetId).toBe('test-asset-001');
  });

  test('getRun includes summary', async () => {
    const fetched = await broker.call('rcs-simulation-run.getRun', { runId: savedRun.runId });
    expect(fetched.summary.totalVolumeKwh).toBe(960);
  });

  test('getRun throws 404 for unknown runId', async () => {
    await expect(
      broker.call('rcs-simulation-run.getRun', { runId: 'run-does-not-exist-xyz' })
    ).rejects.toMatchObject({ code: 404 });
  });
});

// ── listRuns ──────────────────────────────────────────────────────────────────

describe('rcs-simulation-run — listRuns', () => {
  beforeAll(async () => {
    // Save two more runs with different assetIds
    await broker.call('rcs-simulation-run.saveRun', {
      assetId: 'asset-alpha',
      timeframe: SAMPLE_TIMEFRAME,
      summary: SAMPLE_SUMMARY,
    });
    await broker.call('rcs-simulation-run.saveRun', {
      assetId: 'asset-beta',
      timeframe: SAMPLE_TIMEFRAME,
      summary: SAMPLE_SUMMARY,
    });
  });

  test('listRuns returns all saved runs', async () => {
    const list = await broker.call('rcs-simulation-run.listRuns', {});
    expect(list.length).toBeGreaterThanOrEqual(3);
  });

  test('listRuns filters by assetId', async () => {
    const list = await broker.call('rcs-simulation-run.listRuns', { assetId: 'asset-alpha' });
    expect(list.every((r) => r.assetId === 'asset-alpha')).toBe(true);
    expect(list.length).toBeGreaterThanOrEqual(1);
  });

  test('listRuns respects limit', async () => {
    const list = await broker.call('rcs-simulation-run.listRuns', { limit: 2 });
    expect(list.length).toBeLessThanOrEqual(2);
  });
});

// ── deleteRun ─────────────────────────────────────────────────────────────────

describe('rcs-simulation-run — deleteRun', () => {
  let runToDelete;

  beforeAll(async () => {
    runToDelete = await broker.call('rcs-simulation-run.saveRun', {
      assetId: 'delete-me-asset',
      timeframe: SAMPLE_TIMEFRAME,
      summary: SAMPLE_SUMMARY,
    });
  });

  test('deleteRun removes the record', async () => {
    const result = await broker.call('rcs-simulation-run.deleteRun', { runId: runToDelete.runId });
    expect(result.deleted).toBe(true);
  });

  test('getRun returns 404 after deletion', async () => {
    await expect(
      broker.call('rcs-simulation-run.getRun', { runId: runToDelete.runId })
    ).rejects.toMatchObject({ code: 404 });
  });

  test('deleteRun throws 404 for nonexistent runId', async () => {
    await expect(
      broker.call('rcs-simulation-run.deleteRun', { runId: 'run-ghost-xyz' })
    ).rejects.toMatchObject({ code: 404 });
  });
});
