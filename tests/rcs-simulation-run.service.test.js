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

const TIMEFRAME = { start: '2027-04-01T00:00:00Z', end: '2027-04-02T00:00:00Z' };

const SAMPLE_RULE_SNAPSHOT = {
  id: 'eeg2027-draft-2026-06',
  version: '1.0.0',
  status: 'active',
  legalStatus: 'referentenentwurf',
  parameters: { s51ConsecutiveNegHours: 4, technologyFloors: { solar: 0, wind_onshore: 2.0 } },
};

const SAMPLE_ASSET_SNAPSHOT = {
  technology: 'solar',
  awCentsPerKwh: 7.5,
  capacityKw: 100,
};

beforeAll(async () => {
  broker = new ServiceBroker({ logger: false, transporter: null });
  process.env.RCS_SIM_RUN_DB = `rcs-test-runs-${Date.now()}`;
  broker.loadService('./services/rcs-simulation-run.service.js');
  await broker.start();
});

afterAll(async () => {
  await broker.stop();
});

// ── saveRun + getRun ──────────────────────────────────────────────────────────

describe('saveRun — base fields', () => {
  let saved;

  beforeAll(async () => {
    saved = await broker.call('rcs-simulation-run.saveRun', {
      assetId: 'test-asset-001',
      assetName: 'Test PV Anlage',
      timeframe: TIMEFRAME,
      summary: SAMPLE_SUMMARY,
      ruleSetId: 'eeg2027-draft-2026-06',
      ruleSetVersion: '1.0.0',
      legalStatus: 'referentenentwurf',
      blueprintId: 'rcs-eeg2027-clawback-v1',
      options: { includeIntervalTrace: false },
    });
  });

  test('returns a runId starting with "run-"', () => {
    expect(saved.runId.startsWith('run-')).toBe(true);
  });

  test('status is completed', () => {
    expect(saved.status).toBe('completed');
  });

  test('stores ruleSetId and ruleSetVersion', () => {
    expect(saved.ruleSetId).toBe('eeg2027-draft-2026-06');
    expect(saved.ruleSetVersion).toBe('1.0.0');
  });

  test('stores legalStatus', () => {
    expect(saved.legalStatus).toBe('referentenentwurf');
  });

  test('isDeleted is false on fresh run', () => {
    expect(saved.isDeleted).toBe(false);
  });
});

// ── Snapshots and Hashes ──────────────────────────────────────────────────────

describe('saveRun — snapshots and hashes', () => {
  const priceSeries = [{ timestamp: '2027-04-01T00:00:00Z', priceEurMwh: 50 }];
  const injectionSeries = [{ timestamp: '2027-04-01T00:00:00Z', volumeKwh: 10 }];

  let saved;

  beforeAll(async () => {
    saved = await broker.call('rcs-simulation-run.saveRun', {
      assetId: 'asset-hash-test',
      timeframe: TIMEFRAME,
      summary: SAMPLE_SUMMARY,
      ruleSetSnapshot: SAMPLE_RULE_SNAPSHOT,
      assetSnapshot: SAMPLE_ASSET_SNAPSHOT,
      priceSeries,
      injectionSeries,
    });
  });

  test('inputHash is set and starts with sha256:', () => {
    expect(typeof saved.inputHash).toBe('string');
    expect(saved.inputHash.startsWith('sha256:')).toBe(true);
  });

  test('priceSeriesHash is computed from priceSeries', () => {
    expect(typeof saved.priceSeriesHash).toBe('string');
    expect(saved.priceSeriesHash.startsWith('sha256:')).toBe(true);
  });

  test('injectionSeriesHash is computed from injectionSeries', () => {
    expect(typeof saved.injectionSeriesHash).toBe('string');
    expect(saved.injectionSeriesHash.startsWith('sha256:')).toBe(true);
  });

  test('ruleSetSnapshot is persisted', () => {
    expect(saved.ruleSetSnapshot?.id).toBe('eeg2027-draft-2026-06');
  });

  test('assetSnapshot is persisted', () => {
    expect(saved.assetSnapshot?.technology).toBe('solar');
  });

  test('pre-supplied inputHash is preserved', async () => {
    const custom = await broker.call('rcs-simulation-run.saveRun', {
      assetId: 'asset-custom-hash',
      timeframe: TIMEFRAME,
      summary: SAMPLE_SUMMARY,
      inputHash: 'sha256:custom-deterministic-hash',
    });
    expect(custom.inputHash).toBe('sha256:custom-deterministic-hash');
  });

  test('same inputs produce same hash deterministically', async () => {
    const run1 = await broker.call('rcs-simulation-run.saveRun', {
      assetId: 'asset-determ',
      timeframe: TIMEFRAME,
      summary: SAMPLE_SUMMARY,
      assetSnapshot: SAMPLE_ASSET_SNAPSHOT,
      priceSeries,
      injectionSeries,
    });
    const run2 = await broker.call('rcs-simulation-run.saveRun', {
      assetId: 'asset-determ',
      timeframe: TIMEFRAME,
      summary: SAMPLE_SUMMARY,
      assetSnapshot: SAMPLE_ASSET_SNAPSHOT,
      priceSeries,
      injectionSeries,
    });
    expect(run1.priceSeriesHash).toBe(run2.priceSeriesHash);
    expect(run1.injectionSeriesHash).toBe(run2.injectionSeriesHash);
  });
});

// ── getRun ────────────────────────────────────────────────────────────────────

describe('getRun', () => {
  let runId;

  beforeAll(async () => {
    const run = await broker.call('rcs-simulation-run.saveRun', {
      assetId: 'asset-get-test',
      timeframe: TIMEFRAME,
      summary: SAMPLE_SUMMARY,
    });
    runId = run.runId;
  });

  test('retrieves by runId', async () => {
    const fetched = await broker.call('rcs-simulation-run.getRun', { runId });
    expect(fetched.runId).toBe(runId);
  });

  test('throws 404 for unknown runId', async () => {
    await expect(
      broker.call('rcs-simulation-run.getRun', { runId: 'run-does-not-exist-xyz' })
    ).rejects.toMatchObject({ code: 404 });
  });
});

// ── listRuns + filters ────────────────────────────────────────────────────────

describe('listRuns — filters', () => {
  const UNIQUE_PREFIX = `filter-test-${Date.now()}`;

  beforeAll(async () => {
    await Promise.all([
      broker.call('rcs-simulation-run.saveRun', {
        assetId: `${UNIQUE_PREFIX}-alpha`,
        timeframe: TIMEFRAME,
        summary: SAMPLE_SUMMARY,
        ruleSetId: 'eeg2027-draft-2026-06',
      }),
      broker.call('rcs-simulation-run.saveRun', {
        assetId: `${UNIQUE_PREFIX}-alpha`,
        timeframe: TIMEFRAME,
        summary: SAMPLE_SUMMARY,
        ruleSetId: 'eeg2027-draft-2026-04',
      }),
      broker.call('rcs-simulation-run.saveRun', {
        assetId: `${UNIQUE_PREFIX}-beta`,
        timeframe: TIMEFRAME,
        summary: SAMPLE_SUMMARY,
        ruleSetId: 'eeg2027-draft-2026-06',
      }),
    ]);
  });

  test('filter by assetId returns only matching runs', async () => {
    const { items } = await broker.call('rcs-simulation-run.listRuns', {
      assetId: `${UNIQUE_PREFIX}-alpha`,
    });
    expect(items.every((r) => r.assetId === `${UNIQUE_PREFIX}-alpha`)).toBe(true);
    expect(items.length).toBeGreaterThanOrEqual(2);
  });

  test('filter by ruleSetId returns only matching runs', async () => {
    const { items } = await broker.call('rcs-simulation-run.listRuns', {
      ruleSetId: 'eeg2027-draft-2026-06',
    });
    expect(items.every((r) => r.ruleSetId === 'eeg2027-draft-2026-06')).toBe(true);
  });

  test('limit is respected', async () => {
    const { items } = await broker.call('rcs-simulation-run.listRuns', { limit: 1 });
    expect(items.length).toBeLessThanOrEqual(1);
  });

  test('list is sorted newest first', async () => {
    const { items } = await broker.call('rcs-simulation-run.listRuns', {});
    for (let i = 1; i < items.length; i++) {
      expect(items[i - 1].createdAt >= items[i].createdAt).toBe(true);
    }
  });
});

// ── Soft Delete ───────────────────────────────────────────────────────────────

describe('Soft Delete', () => {
  let runToDelete;

  beforeAll(async () => {
    runToDelete = await broker.call('rcs-simulation-run.saveRun', {
      assetId: 'soft-delete-asset',
      timeframe: TIMEFRAME,
      summary: SAMPLE_SUMMARY,
    });
  });

  test('deleteRun returns deleted: true', async () => {
    const result = await broker.call('rcs-simulation-run.deleteRun', {
      runId: runToDelete.runId,
      deletedBy: 'test-user',
      deleteReason: 'Unit test cleanup',
    });
    expect(result.deleted).toBe(true);
  });

  test('deleted run is NOT visible in default listRuns', async () => {
    const { items } = await broker.call('rcs-simulation-run.listRuns', {});
    const found = items.find((r) => r.runId === runToDelete.runId);
    expect(found).toBeUndefined();
  });

  test('deleted run IS visible with includeDeleted: true', async () => {
    const { items } = await broker.call('rcs-simulation-run.listRuns', { includeDeleted: true });
    const found = items.find((r) => r.runId === runToDelete.runId);
    expect(found).toBeDefined();
    expect(found.isDeleted).toBe(true);
  });

  test('getRun returns deleted run with isDeleted: true', async () => {
    const run = await broker.call('rcs-simulation-run.getRun', { runId: runToDelete.runId });
    expect(run.isDeleted).toBe(true);
    expect(run.deletedBy).toBe('test-user');
    expect(run.deleteReason).toBe('Unit test cleanup');
    expect(typeof run.deletedAt).toBe('string');
  });

  test('deleteRun is idempotent (second call returns alreadyDeleted: true)', async () => {
    const result = await broker.call('rcs-simulation-run.deleteRun', {
      runId: runToDelete.runId,
    });
    expect(result.alreadyDeleted).toBe(true);
  });

  test('deleteRun throws 404 for nonexistent runId', async () => {
    await expect(
      broker.call('rcs-simulation-run.deleteRun', { runId: 'run-ghost-xyz' })
    ).rejects.toMatchObject({ code: 404 });
  });
});
