'use strict';

/**
 * RCS mass-load tests (v0.60.6 WP7).
 * Validates that portfolio simulation scales to 1K and 5K assets with
 * chunked parallel processing, traceMode='none', and mocked broker calls.
 * Uses --runInBand to avoid Jest worker memory pressure.
 */

const { ServiceBroker } = require('moleculer');

// ── Fixtures ──────────────────────────────────────────────────────────────────

function makeQuarterHourPrices(count = 96, priceEurMwh = 50, startTs = '2027-04-01T00:00:00Z') {
  const base = new Date(startTs).getTime();
  return Array.from({ length: count }, (_, i) => ({
    timestamp: new Date(base + i * 15 * 60000).toISOString(),
    priceEurMwh,
  }));
}

function makeInjectionSeries(count = 96, volumeKwh = 10, startTs = '2027-04-01T00:00:00Z') {
  const base = new Date(startTs).getTime();
  return Array.from({ length: count }, (_, i) => ({
    timestamp: new Date(base + i * 15 * 60000).toISOString(),
    volumeKwh,
  }));
}

const TIMEFRAME = { start: '2027-04-01T00:00:00Z', end: '2027-04-02T00:00:00Z' };
const PRICES_24H = makeQuarterHourPrices(96, 50);
const INJECTION_24H = makeInjectionSeries(96, 10);

const TECHNOLOGIES = ['solar', 'wind_onshore', 'biomass'];

function makeAsset(assetId) {
  const techIdx = parseInt(assetId.replace(/\D/g, '') || '0', 10) % TECHNOLOGIES.length;
  return {
    technology: TECHNOLOGIES[techIdx],
    awCentsPerKwh: 7.5 + techIdx * 1.5,
    capacityKw: 100 + techIdx * 500,
    commissioningDate: '2023-01-01',
    name: `Asset ${assetId}`,
  };
}

let broker;

beforeAll(async () => {
  broker = new ServiceBroker({ logger: false, transporter: null });

  broker.createService({
    name: 'assets',
    actions: {
      effective: {
        handler(ctx) {
          return makeAsset(ctx.params.assetId);
        },
      },
    },
  });

  broker.createService({
    name: 'energy-market',
    actions: {
      prices: {
        handler() {
          return PRICES_24H;
        },
      },
    },
  });

  broker.createService({
    name: 'edm',
    actions: {
      getTimeseries: {
        handler() {
          return INJECTION_24H;
        },
      },
    },
  });

  broker.loadService('./services/eeg-clawback-calculator.service.js');
  await broker.start();
}, 30000);

afterAll(async () => {
  await broker.stop();
});

// ── 1K asset load test ────────────────────────────────────────────────────────

describe('1K asset portfolio simulation', () => {
  test('1000 assets with chunkSize=100, traceMode=none completes within 60s', async () => {
    const assetIds = Array.from({ length: 1000 }, (_, i) => `asset-mass-${i}`);

    const r = await broker.call('eeg-clawback-calculator.simulatePortfolio', {
      assetIds,
      timeframe: TIMEFRAME,
      executionMode: 'sync',
      options: {
        chunkSize: 100,
        traceMode: 'none',
      },
    });

    expect(r.portfolioSummary.assetCount).toBe(1000);
    expect(r.portfolioSummary.successfulAssets).toBe(1000);
    expect(r.portfolioSummary.failedAssets).toBe(0);
    expect(r.portfolioSummary.totalBaselineAmountEur).toBeGreaterThan(0);
    expect(r.assetResultsTotal).toBe(1000);
    expect(r.errorCount).toBe(0);
    expect(r.workloadEstimate).toBeDefined();
    expect(r.workloadEstimate.assetCount).toBe(1000);
    expect(r.byTechnology.length).toBeGreaterThan(0);

    // All byTechnology asset counts should sum to successfulAssets
    const techSum = r.byTechnology.reduce((s, g) => s + g.assetCount, 0);
    expect(techSum).toBe(1000);
  }, 60000);

  test('1K simulation: workloadEstimate correctly pre-computed', async () => {
    const assetIds = Array.from({ length: 1000 }, (_, i) => `asset-mass-${i}`);
    const r = await broker.call('eeg-clawback-calculator.simulatePortfolio', {
      assetIds,
      timeframe: TIMEFRAME,
      executionMode: 'sync',
      options: { chunkSize: 100, traceMode: 'none' },
    });

    const w = r.workloadEstimate;
    expect(w.assetCount).toBe(1000);
    expect(w.expectedIntervalsPerAsset).toBe(96);
    expect(w.estimatedTotalIntervals).toBe(96000);
    expect(typeof w.estimatedRisk).toBe('string');
  });

  test('1K simulation: pagination works correctly', async () => {
    const assetIds = Array.from({ length: 1000 }, (_, i) => `asset-mass-${i}`);
    const r = await broker.call('eeg-clawback-calculator.simulatePortfolio', {
      assetIds,
      timeframe: TIMEFRAME,
      executionMode: 'sync',
      options: {
        chunkSize: 100,
        traceMode: 'none',
        assetResultsLimit: 50,
        assetResultsOffset: 0,
      },
    });

    expect(r.assetResults).toHaveLength(50);
    expect(r.assetResultsTotal).toBe(1000);
    expect(r.hasMoreAssetResults).toBe(true);
    // portfolioSummary covers all 1000 assets despite pagination
    expect(r.portfolioSummary.assetCount).toBe(1000);
  });

  test('1K simulation: no default maxAssets limit blocks execution', async () => {
    // WP1 verification: 1000 assets should not be blocked by a default limit
    const assetIds = Array.from({ length: 1000 }, (_, i) => `asset-wp1-${i}`);
    await expect(
      broker.call('eeg-clawback-calculator.simulatePortfolio', {
        assetIds,
        timeframe: TIMEFRAME,
        executionMode: 'sync',
        options: { chunkSize: 100, traceMode: 'none' },
      })
    ).resolves.toMatchObject({ portfolioSummary: { assetCount: 1000 } });
  });
}, 60000);

// ── 5K asset load test ────────────────────────────────────────────────────────

describe('5K asset portfolio simulation', () => {
  test('5000 assets with chunkSize=100, traceMode=none completes within 120s', async () => {
    const assetIds = Array.from({ length: 5000 }, (_, i) => `asset-mass5k-${i}`);

    const r = await broker.call('eeg-clawback-calculator.simulatePortfolio', {
      assetIds,
      timeframe: TIMEFRAME,
      executionMode: 'sync',
      options: {
        chunkSize: 100,
        traceMode: 'none',
        assetResultsLimit: 0, // suppress assetResults payload
      },
    });

    expect(r.portfolioSummary.assetCount).toBe(5000);
    expect(r.portfolioSummary.successfulAssets).toBe(5000);
    expect(r.portfolioSummary.failedAssets).toBe(0);
    expect(r.assetResultsTotal).toBe(5000);
    expect(r.workloadEstimate.estimatedTotalIntervals).toBe(480000);
  }, 120000);
});
