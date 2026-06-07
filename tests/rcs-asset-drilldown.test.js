'use strict';

// Unique DB path for drilldown tests
process.env.RCS_SIM_RUN_DB = `rcs-test-drilldown-${Date.now()}`;

const { ServiceBroker } = require('moleculer');

const TIMEFRAME = { start: '2027-04-01T00:00:00Z', end: '2027-04-02T00:00:00Z' };

function makeQuarterHourPrices(count = 96, priceEurMwh = 50) {
  const base = new Date(TIMEFRAME.start).getTime();
  return Array.from({ length: count }, (_, i) => ({
    timestamp: new Date(base + i * 15 * 60000).toISOString(),
    priceEurMwh,
  }));
}

function makeInjectionSeries(count = 96, volumeKwh = 10) {
  const base = new Date(TIMEFRAME.start).getTime();
  return Array.from({ length: count }, (_, i) => ({
    timestamp: new Date(base + i * 15 * 60000).toISOString(),
    volumeKwh,
  }));
}

const PRICES_24H = makeQuarterHourPrices();
const INJECTION_24H = makeInjectionSeries();

const SOLAR_ASSET = {
  technology: 'solar',
  awCentsPerKwh: 7.5,
  capacityKw: 100,
  commissioningDate: '2024-01-01',
  name: 'Solar Test',
};

let broker;
let testRun; // seeded in beforeAll

beforeAll(async () => {
  broker = new ServiceBroker({ logger: false, transporter: null });

  broker.createService({
    name: 'assets',
    actions: {
      effective: {
        handler(ctx) {
          if (ctx.params.assetId === 'asset-not-existing') throw new Error('Asset not found');
          return SOLAR_ASSET;
        },
      },
    },
  });

  broker.createService({
    name: 'energy-market',
    actions: {
      prices: { handler: () => PRICES_24H },
    },
  });

  broker.createService({
    name: 'edm',
    actions: {
      getTimeseries: { handler: () => INJECTION_24H },
    },
  });

  broker.loadService('./services/rcs-simulation-run.service.js');
  broker.loadService('./services/eeg-clawback-calculator.service.js');
  await broker.start();

  // Seed a completed run with assetIds
  testRun = await broker.call('rcs-simulation-run.saveRun', {
    assetId: 'asset-solar-01',
    assetIds: ['asset-solar-01', 'asset-wind-01'],
    timeframe: TIMEFRAME,
    summary: { totalVolumeKwh: 100 },
    scope: 'portfolio',
    ruleSetId: 'eeg2027-draft-2026-06',
  });
});

afterAll(async () => {
  await broker.stop();
  const { rm } = require('fs/promises');
  await rm(process.env.RCS_SIM_RUN_DB, { recursive: true, force: true }).catch(() => {});
});

// ── Sync drilldown ────────────────────────────────────────────────────────────

describe('drilldownAsset — sync', () => {
  test('returns full trace for a known asset in the run', async () => {
    const r = await broker.call('eeg-clawback-calculator.drilldownAsset', {
      runId: testRun.runId,
      assetId: 'asset-solar-01',
      persistTrace: false,
      executionMode: 'sync',
    });

    expect(r.runId).toBe(testRun.runId);
    expect(r.assetId).toBe('asset-solar-01');
    expect(r.traceMode).toBe('full');
    expect(Array.isArray(r.intervals)).toBe(true);
    expect(r.intervals.length).toBe(96);
    expect(r.summary).toBeDefined();
    expect(r.ruleArmSummary).toBeDefined();
  });

  test('result includes navigation links', async () => {
    const r = await broker.call('eeg-clawback-calculator.drilldownAsset', {
      runId: testRun.runId,
      assetId: 'asset-solar-01',
      persistTrace: false,
      executionMode: 'sync',
    });
    expect(r.links.self).toContain('drilldown');
    expect(r.links.trace).toContain('trace');
    expect(r.links.asset).toContain(testRun.runId);
    expect(r.links.run).toContain(testRun.runId);
  });

  test('uses same ruleSetId as the original run', async () => {
    const r = await broker.call('eeg-clawback-calculator.drilldownAsset', {
      runId: testRun.runId,
      assetId: 'asset-solar-01',
      persistTrace: false,
      executionMode: 'sync',
    });
    expect(r.ruleSetId).toBe('eeg2027-draft-2026-06');
  });

  test('intervals include ruleArm and dataQualityFlags', async () => {
    const r = await broker.call('eeg-clawback-calculator.drilldownAsset', {
      runId: testRun.runId,
      assetId: 'asset-solar-01',
      persistTrace: false,
      executionMode: 'sync',
    });
    expect(r.intervals[0]).toHaveProperty('ruleArm');
    expect(r.intervals[0]).toHaveProperty('dataQualityFlags');
  });

  test('result includes drilldownSemantics with correct fields', async () => {
    const r = await broker.call('eeg-clawback-calculator.drilldownAsset', {
      runId: testRun.runId,
      assetId: 'asset-solar-01',
      persistTrace: false,
      executionMode: 'sync',
    });
    expect(r.drilldownSemantics).toBeDefined();
    expect(r.drilldownSemantics.mode).toBe('recomputed_from_current_source_data');
    expect(r.drilldownSemantics.baseRunId).toBe(testRun.runId);
    expect(r.drilldownSemantics.ruleSetId).toBe('eeg2027-draft-2026-06');
    expect(r.drilldownSemantics.usesOriginalRuleSet).toBe(true);
    expect(r.drilldownSemantics.usesOriginalAssetSnapshot).toBe(false);
    expect(r.drilldownSemantics.usesOriginalTimeseriesSnapshot).toBe(false);
    expect(typeof r.drilldownSemantics.computedAt).toBe('string');
  });
});

// ── Asset not in run ──────────────────────────────────────────────────────────

describe('drilldownAsset — asset not in run', () => {
  test('throws RCS_ASSET_NOT_IN_RUN when asset is not in run.assetIds', async () => {
    await expect(
      broker.call('eeg-clawback-calculator.drilldownAsset', {
        runId: testRun.runId,
        assetId: 'asset-completely-unknown-xyz',
        executionMode: 'sync',
      })
    ).rejects.toMatchObject({ type: 'RCS_ASSET_NOT_IN_RUN' });
  });

  test('throws RCS_RUN_NOT_FOUND for non-existent run', async () => {
    await expect(
      broker.call('eeg-clawback-calculator.drilldownAsset', {
        runId: 'run-does-not-exist-abc',
        assetId: 'asset-solar-01',
        executionMode: 'sync',
      })
    ).rejects.toMatchObject({ type: 'RCS_RUN_NOT_FOUND' });
  });
});

// ── Async drilldown ───────────────────────────────────────────────────────────

describe('drilldownAsset — async mode', () => {
  test('async mode returns queued job descriptor', async () => {
    const r = await broker.call(
      'eeg-clawback-calculator.drilldownAsset',
      {
        runId: testRun.runId,
        assetId: 'asset-solar-01',
        persistTrace: false,
        executionMode: 'async',
      },
      { meta: {} }
    );
    expect(r.jobId).toBeDefined();
    expect(r.status).toBe('queued');
  });
});

// ── Trace persistence ─────────────────────────────────────────────────────────

describe('trace persistence', () => {
  test('persistTrace: true saves a retrievable trace', async () => {
    await broker.call('eeg-clawback-calculator.drilldownAsset', {
      runId: testRun.runId,
      assetId: 'asset-wind-01',
      persistTrace: true,
      executionMode: 'sync',
    });

    // Wait briefly for safeRunCall to complete (it's fire-and-forget)
    await new Promise((resolve) => setTimeout(resolve, 100));

    const trace = await broker.call('rcs-simulation-run.getTrace', {
      runId: testRun.runId,
      assetId: 'asset-wind-01',
    });

    expect(trace.runId).toBe(testRun.runId);
    expect(trace.assetId).toBe('asset-wind-01');
    expect(Array.isArray(trace.intervals)).toBe(true);
    expect(trace.traceHash).toBeDefined();
    expect(trace.links.drilldown).toContain('drilldown');
  });

  test('persisted trace includes drilldownSemantics', async () => {
    await new Promise((resolve) => setTimeout(resolve, 150));
    const trace = await broker.call('rcs-simulation-run.getTrace', {
      runId: testRun.runId,
      assetId: 'asset-wind-01',
    });
    expect(trace.drilldownSemantics).toBeDefined();
    expect(trace.drilldownSemantics.mode).toBe('recomputed_from_current_source_data');
    expect(trace.drilldownSemantics.baseRunId).toBe(testRun.runId);
    expect(trace.drilldownSemantics.usesOriginalRuleSet).toBe(true);
  });

  test('getTrace throws RCS_TRACE_NOT_FOUND when no trace exists', async () => {
    await expect(
      broker.call('rcs-simulation-run.getTrace', {
        runId: testRun.runId,
        assetId: 'asset-no-trace-xyz',
      })
    ).rejects.toMatchObject({ type: 'RCS_TRACE_NOT_FOUND' });
  });

  test('persistTrace: false does not save a trace', async () => {
    const uniqueAssetId = `asset-no-persist-${Date.now()}`;

    // Create a run that includes this unique asset
    const run2 = await broker.call('rcs-simulation-run.saveRun', {
      assetId: uniqueAssetId,
      assetIds: [uniqueAssetId],
      timeframe: TIMEFRAME,
      summary: {},
      scope: 'portfolio',
    });

    await broker.call('eeg-clawback-calculator.drilldownAsset', {
      runId: run2.runId,
      assetId: uniqueAssetId,
      persistTrace: false,
      executionMode: 'sync',
    });

    await expect(
      broker.call('rcs-simulation-run.getTrace', {
        runId: run2.runId,
        assetId: uniqueAssetId,
      })
    ).rejects.toMatchObject({ type: 'RCS_TRACE_NOT_FOUND' });
  });

  test('getRunAsset hasTrace is true after drilldown with persistTrace', async () => {
    // asset-wind-01 was traced in the earlier test (persistTrace: true)
    await new Promise((resolve) => setTimeout(resolve, 200));

    // We need an asset result doc saved first
    await broker.call('rcs-simulation-run.saveAssetResults', {
      runId: testRun.runId,
      results: [
        {
          assetId: 'asset-wind-01',
          assetName: 'Wind 01',
          status: 'success',
          technology: 'wind_onshore',
          summary: { totalVolumeKwh: 100 },
        },
      ],
    });

    const detail = await broker.call('rcs-simulation-run.getRunAsset', {
      runId: testRun.runId,
      assetId: 'asset-wind-01',
    });

    expect(detail.hasTrace).toBe(true);
    expect(detail.links.drilldown).toContain('drilldown');
    expect(detail.links.trace).toContain('trace');
  });
});
