'use strict';

const { ServiceBroker } = require('moleculer');
const { normaliseTimestamp, interpolatePricesToQuarterHour } = require('../src/eeg-clawback-calculator');

// ── Shared fixtures ───────────────────────────────────────────────────────────

function makeQuarterHourPrices(count, priceEurMwh, startTs = '2027-04-01T00:00:00Z') {
  const base = new Date(startTs).getTime();
  return Array.from({ length: count }, (_, i) => ({
    timestamp: new Date(base + i * 15 * 60000).toISOString(),
    priceEurMwh,
  }));
}

function makeInjectionSeries(count, volumeKwh, startTs = '2027-04-01T00:00:00Z') {
  const base = new Date(startTs).getTime();
  return Array.from({ length: count }, (_, i) => ({
    timestamp: new Date(base + i * 15 * 60000).toISOString(),
    volumeKwh,
  }));
}

const TIMEFRAME = { start: '2027-04-01T00:00:00Z', end: '2027-04-02T00:00:00Z' };
const PRICES_24H = makeQuarterHourPrices(96, 50);
const INJECTION_24H = makeInjectionSeries(96, 10);

const BASE_ASSETS = {
  'asset-solar-01': {
    technology: 'solar',
    awCentsPerKwh: 7.5,
    capacityKw: 100,
    commissioningDate: '2024-01-01',
    name: 'Solar 01',
  },
  'asset-solar-02': {
    technology: 'solar',
    awCentsPerKwh: 8.0,
    capacityKw: 200,
    commissioningDate: '2023-06-01',
    name: 'Solar 02',
  },
  'asset-wind-01': {
    technology: 'wind_onshore',
    awCentsPerKwh: 9.0,
    capacityKw: 2000,
    commissioningDate: '2022-01-01',
    name: 'Wind 01',
  },
  'asset-wind-02': {
    technology: 'wind_onshore',
    awCentsPerKwh: 9.5,
    capacityKw: 3000,
    commissioningDate: '2021-06-01',
    name: 'Wind 02',
  },
  'asset-bio-01': {
    technology: 'biomass',
    awCentsPerKwh: 12.0,
    capacityKw: 500,
    commissioningDate: '2020-01-01',
    name: 'Biomasse 01',
  },
};

let broker;

beforeAll(async () => {
  broker = new ServiceBroker({ logger: false, transporter: null });

  broker.createService({
    name: 'assets',
    actions: {
      effective: {
        handler(ctx) {
          const { assetId } = ctx.params;
          if (assetId === 'asset-broken') throw new Error('Asset not found');
          if (BASE_ASSETS[assetId]) return BASE_ASSETS[assetId];
          // For dynamically named assets, cycle through base assets
          const keys = Object.keys(BASE_ASSETS);
          const idx = parseInt(assetId.replace(/[^0-9]/g, '') || '0', 10) % keys.length;
          return BASE_ASSETS[keys[idx]];
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
        handler(ctx) {
          const { meloId } = ctx.params;
          if (meloId === 'asset-broken') throw new Error('EDM unavailable');
          if (meloId === 'asset-no-data') return [];
          return INJECTION_24H;
        },
      },
    },
  });

  broker.loadService('./services/eeg-clawback-calculator.service.js');
  await broker.start();
});

afterAll(async () => {
  await broker.stop();
});

// ── WP D: traceMode governance ────────────────────────────────────────────────

describe('traceMode governance', () => {
  const assetIds = ['asset-solar-01', 'asset-solar-02', 'asset-wind-01'];

  test('traceMode: none — no intervals, ruleArmSummary present', async () => {
    const r = await broker.call('eeg-clawback-calculator.simulatePortfolio', {
      assetIds,
      timeframe: TIMEFRAME,
      options: { traceMode: 'none' },
    });
    expect(r.assetResults.every((a) => a.intervals === undefined)).toBe(true);
    expect(r.assetResults.every((a) => a.ruleArmSummary !== null)).toBe(true);
  });

  test('traceMode: summary — no intervals, ruleArmSummary present', async () => {
    const r = await broker.call('eeg-clawback-calculator.simulatePortfolio', {
      assetIds,
      timeframe: TIMEFRAME,
      options: { traceMode: 'summary' },
    });
    expect(r.assetResults.every((a) => a.intervals === undefined)).toBe(true);
    expect(r.assetResults.some((a) => a.ruleArmSummary !== null)).toBe(true);
  });

  test('traceMode: sample — limited intervals present', async () => {
    const r = await broker.call('eeg-clawback-calculator.simulatePortfolio', {
      assetIds,
      timeframe: TIMEFRAME,
      options: { traceMode: 'sample', traceSampleSize: 5 },
    });
    expect(r.assetResults.every((a) => Array.isArray(a.intervals))).toBe(true);
    expect(r.assetResults.every((a) => a.intervals.length <= 5)).toBe(true);
  });

  test('traceMode: full — all intervals present for small portfolio', async () => {
    const r = await broker.call('eeg-clawback-calculator.simulatePortfolio', {
      assetIds,
      timeframe: TIMEFRAME,
      options: { traceMode: 'full' },
    });
    expect(r.assetResults.every((a) => Array.isArray(a.intervals))).toBe(true);
    expect(r.assetResults.every((a) => a.intervals.length === 96)).toBe(true);
  });

  test('traceMode: full with >50 assets throws RCS_TRACE_PAYLOAD_TOO_LARGE', async () => {
    const bigPortfolio = Array.from({ length: 51 }, (_, i) => `asset-dyn-${i}`);
    await expect(
      broker.call('eeg-clawback-calculator.simulatePortfolio', {
        assetIds: bigPortfolio,
        timeframe: TIMEFRAME,
        options: { traceMode: 'full' },
      })
    ).rejects.toMatchObject({ type: 'RCS_TRACE_PAYLOAD_TOO_LARGE' });
  });

  test('traceMode: full with traceAssetIds ignores size guard', async () => {
    const bigPortfolio = Array.from({ length: 51 }, (_, i) => `asset-dyn-${i}`);
    const r = await broker.call('eeg-clawback-calculator.simulatePortfolio', {
      assetIds: bigPortfolio,
      timeframe: TIMEFRAME,
      options: { traceMode: 'full', traceAssetIds: ['asset-dyn-0', 'asset-dyn-1'] },
    });
    const traced = r.assetResults.filter((a) => a.intervals !== undefined);
    const untraced = r.assetResults.filter((a) => a.intervals === undefined);
    expect(traced.length).toBe(2);
    expect(untraced.length).toBe(49);
  });

  test('traceAssetIds: only listed assets receive intervals', async () => {
    const r = await broker.call('eeg-clawback-calculator.simulatePortfolio', {
      assetIds,
      timeframe: TIMEFRAME,
      options: { traceMode: 'full', traceAssetIds: ['asset-solar-01'] },
    });
    const withTrace = r.assetResults.find((a) => a.assetId === 'asset-solar-01');
    const withoutTrace = r.assetResults.find((a) => a.assetId === 'asset-solar-02');
    expect(Array.isArray(withTrace.intervals)).toBe(true);
    expect(withoutTrace.intervals).toBeUndefined();
  });

  test('topNTraceByDelta: only top-N-worst assets receive trace', async () => {
    const r = await broker.call('eeg-clawback-calculator.simulatePortfolio', {
      assetIds,
      timeframe: TIMEFRAME,
      options: { traceMode: 'full', topNTraceByDelta: 1 },
    });
    const traced = r.assetResults.filter((a) => a.intervals !== undefined);
    expect(traced.length).toBe(1);
  });
});

// ── WP D: ruleArmSummary ──────────────────────────────────────────────────────

describe('ruleArmSummary', () => {
  test('portfolio-level ruleArmSummary is always present', async () => {
    const r = await broker.call('eeg-clawback-calculator.simulatePortfolio', {
      assetIds: ['asset-solar-01'],
      timeframe: TIMEFRAME,
      options: { traceMode: 'none' },
    });
    expect(r.ruleArmSummary).toBeDefined();
    expect(typeof r.ruleArmSummary).toBe('object');
  });

  test('ruleArmSummary contains none arm (all prices 50 EUR/MWh, below AW)', async () => {
    const r = await broker.call('eeg-clawback-calculator.simulatePortfolio', {
      assetIds: ['asset-solar-01'],
      timeframe: TIMEFRAME,
    });
    expect(r.ruleArmSummary.none).toBeDefined();
    expect(r.ruleArmSummary.none.count).toBe(96);
    expect(r.ruleArmSummary.none.totalClawbackEur).toBe(0);
  });

  test('per-asset ruleArmSummary present in assetResults', async () => {
    const r = await broker.call('eeg-clawback-calculator.simulatePortfolio', {
      assetIds: ['asset-solar-01', 'asset-solar-02'],
      timeframe: TIMEFRAME,
    });
    expect(r.assetResults.every((a) => a.ruleArmSummary !== null)).toBe(true);
    expect(r.assetResults[0].ruleArmSummary.none.count).toBeGreaterThan(0);
  });
});

// ── WP C: chunked processing ──────────────────────────────────────────────────

describe('chunked processing', () => {
  test('chunkSize: 2 produces correct results for 5 assets', async () => {
    const assetIds = Object.keys(BASE_ASSETS);
    const r = await broker.call('eeg-clawback-calculator.simulatePortfolio', {
      assetIds,
      timeframe: TIMEFRAME,
      options: { chunkSize: 2, includeIntervalTrace: false },
    });
    expect(r.portfolioSummary.assetCount).toBe(5);
    expect(r.portfolioSummary.successfulAssets).toBe(5);
    expect(r.assetResults).toHaveLength(5);
  });

  test('maxIntervalsPerAsset truncates injection series', async () => {
    const r = await broker.call('eeg-clawback-calculator.simulatePortfolio', {
      assetIds: ['asset-solar-01'],
      timeframe: TIMEFRAME,
      options: { maxIntervalsPerAsset: 48, traceMode: 'full' },
    });
    // 48 injection intervals → 48 intervals in result
    expect(r.assetResults[0].intervals).toHaveLength(48);
  });

  test('large portfolio of 50 assets completes successfully', async () => {
    const assetIds = Array.from({ length: 50 }, (_, i) => `asset-dyn-${i}`);
    const r = await broker.call('eeg-clawback-calculator.simulatePortfolio', {
      assetIds,
      timeframe: TIMEFRAME,
      options: { chunkSize: 10, traceMode: 'none' },
    });
    expect(r.portfolioSummary.assetCount).toBe(50);
    expect(r.portfolioSummary.successfulAssets).toBe(50);
    expect(r.portfolioSummary.totalBaselineAmountEur).toBeGreaterThan(0);
  });
});

// ── WP E: Massendaten-sichere Ergebnisstruktur ────────────────────────────────

describe('Massendaten-sichere Ergebnisstruktur', () => {
  const assetIds = Object.keys(BASE_ASSETS);

  test('pagination: assetResultsLimit and assetResultsOffset', async () => {
    const page1 = await broker.call('eeg-clawback-calculator.simulatePortfolio', {
      assetIds,
      timeframe: TIMEFRAME,
      options: { assetResultsLimit: 2, assetResultsOffset: 0 },
    });
    const page2 = await broker.call('eeg-clawback-calculator.simulatePortfolio', {
      assetIds,
      timeframe: TIMEFRAME,
      options: { assetResultsLimit: 2, assetResultsOffset: 2 },
    });

    expect(page1.assetResults).toHaveLength(2);
    expect(page1.hasMoreAssetResults).toBe(true);
    expect(page1.assetResultsTotal).toBe(5);

    expect(page2.assetResults).toHaveLength(2);
    expect(page2.assetResultsOffset).toBe(2);

    // Pages should not overlap
    const ids1 = page1.assetResults.map((r) => r.assetId);
    const ids2 = page2.assetResults.map((r) => r.assetId);
    expect(ids1.some((id) => ids2.includes(id))).toBe(false);
  });

  test('hasMoreAssetResults is false when all results fit on one page', async () => {
    const r = await broker.call('eeg-clawback-calculator.simulatePortfolio', {
      assetIds,
      timeframe: TIMEFRAME,
    });
    expect(r.hasMoreAssetResults).toBe(false);
  });

  test('topAssetsByClawback is an array', async () => {
    const r = await broker.call('eeg-clawback-calculator.simulatePortfolio', {
      assetIds,
      timeframe: TIMEFRAME,
    });
    expect(Array.isArray(r.topAssetsByClawback)).toBe(true);
  });

  test('topAssetsByDataRisk is an array', async () => {
    const r = await broker.call('eeg-clawback-calculator.simulatePortfolio', {
      assetIds: [...assetIds, 'asset-broken'],
      timeframe: TIMEFRAME,
      options: { continueOnAssetError: true },
    });
    expect(Array.isArray(r.topAssetsByDataRisk)).toBe(true);
    expect(r.topAssetsByDataRisk.length).toBeGreaterThan(0);
    expect(r.topAssetsByDataRisk[0].assetId).toBe('asset-broken');
  });

  test('errorCount reflects failed assets count', async () => {
    const r = await broker.call('eeg-clawback-calculator.simulatePortfolio', {
      assetIds: ['asset-solar-01', 'asset-broken', 'asset-wind-01'],
      timeframe: TIMEFRAME,
      options: { continueOnAssetError: true },
    });
    expect(r.errorCount).toBe(1);
    expect(r.errors).toHaveLength(1);
  });

  test('assetResultsTotal matches full portfolio size regardless of limit', async () => {
    const r = await broker.call('eeg-clawback-calculator.simulatePortfolio', {
      assetIds,
      timeframe: TIMEFRAME,
      options: { assetResultsLimit: 1 },
    });
    expect(r.assetResultsTotal).toBe(assetIds.length);
    expect(r.assetResults).toHaveLength(1);
  });
});

// ── WP A: executionMode ───────────────────────────────────────────────────────

describe('executionMode', () => {
  test('executionMode: sync — returns result directly (no jobId)', async () => {
    const r = await broker.call('eeg-clawback-calculator.simulatePortfolio', {
      assetIds: ['asset-solar-01'],
      timeframe: TIMEFRAME,
      executionMode: 'sync',
    });
    expect(r.portfolioSummary).toBeDefined();
    expect(r.jobId).toBeUndefined();
  });

  test('executionMode: auto without gateway — runs synchronously', async () => {
    const r = await broker.call('eeg-clawback-calculator.simulatePortfolio', {
      assetIds: ['asset-solar-01'],
      timeframe: TIMEFRAME,
      executionMode: 'auto',
    });
    // Without gateway flag, auto falls back to synchronous execution
    expect(r.portfolioSummary).toBeDefined();
  });

  test('executionMode: async forces job system (returns queued descriptor)', async () => {
    const r = await broker.call(
      'eeg-clawback-calculator.simulatePortfolio',
      {
        assetIds: ['asset-solar-01'],
        timeframe: TIMEFRAME,
        executionMode: 'async',
      },
      { meta: {} } // no $gateway: async mode sets it internally
    );
    // Should get queued job descriptor
    expect(r.jobId).toBeDefined();
    expect(r.status).toBe('queued');
    expect(typeof r.statusUrl).toBe('string');
    expect(typeof r.resultUrl).toBe('string');
  });
});

// ── WP B: assessPortfolioReadiness executionMode ──────────────────────────────

describe('assessPortfolioReadiness — executionMode', () => {
  test('sync mode returns result directly', async () => {
    const r = await broker.call('eeg-clawback-calculator.assessPortfolioReadiness', {
      assetIds: ['asset-solar-01', 'asset-solar-02'],
      timeframe: TIMEFRAME,
      executionMode: 'sync',
    });
    expect(r.portfolioStatus).toBeDefined();
    expect(r.assetReports).toHaveLength(2);
  });

  test('async mode returns queued descriptor', async () => {
    const r = await broker.call(
      'eeg-clawback-calculator.assessPortfolioReadiness',
      {
        assetIds: ['asset-solar-01'],
        timeframe: TIMEFRAME,
        executionMode: 'async',
      },
      { meta: {} }
    );
    expect(r.jobId).toBeDefined();
    expect(r.status).toBe('queued');
  });
});

// ── WP G: DST hardening (normaliseTimestamp + interpolation) ──────────────────

describe('DST hardening — normaliseTimestamp', () => {
  test('ISO string with Z passes through unchanged', () => {
    const ts = '2025-03-30T01:00:00Z';
    expect(normaliseTimestamp(ts)).toBe('2025-03-30T01:00:00.000Z');
  });

  test('ISO string with +00:00 offset normalises correctly', () => {
    const ts = '2025-03-30T01:00:00+00:00';
    expect(normaliseTimestamp(ts)).toBe('2025-03-30T01:00:00.000Z');
  });

  test('timestamp without timezone treated as UTC (not local)', () => {
    const ts = '2025-03-30T02:00:00'; // ambiguous in CET/CEST
    const result = normaliseTimestamp(ts);
    expect(result).toBe('2025-03-30T02:00:00.000Z'); // treated as UTC
  });

  test('interpolatePricesToQuarterHour handles 23-hour spring-forward day correctly', () => {
    // Spring forward: 02:00 UTC+1 (01:00 UTC) → clocks jump to 03:00 (02:00 UTC)
    // Day has only 92 quarter-hour slots from local perspective, 96 from UTC
    const springPrices = [
      { timestamp: '2025-03-30T00:00:00Z', priceEurMwh: 40 },
      { timestamp: '2025-03-30T01:00:00Z', priceEurMwh: 45 },
      // gap in local time: 02:00 CET doesn't exist (clock springs forward)
      { timestamp: '2025-03-30T02:00:00Z', priceEurMwh: 50 }, // 03:00 CEST
      { timestamp: '2025-03-30T03:00:00Z', priceEurMwh: 55 },
    ];
    const expanded = interpolatePricesToQuarterHour(springPrices);
    expect(expanded).toHaveLength(16);
    expect(expanded[0].timestamp).toBe('2025-03-30T00:00:00.000Z');
    expect(expanded[4].priceEurMwh).toBe(45);
  });

  test('interpolatePricesToQuarterHour handles timestamps without timezone as UTC', () => {
    const prices = [
      { timestamp: '2025-10-26T01:00:00', priceEurMwh: 40 },
      { timestamp: '2025-10-26T02:00:00', priceEurMwh: 45 }, // first 02:xx (CEST)
      { timestamp: '2025-10-26T03:00:00', priceEurMwh: 50 },
    ];
    const expanded = interpolatePricesToQuarterHour(prices);
    // All treated as UTC → 3 hours × 4 = 12 intervals, deduplicated
    expect(expanded).toHaveLength(12);
  });
});

// ── v0.60.6 WP1: No default maxAssets limit ───────────────────────────────────

describe('WP1: No default maxAssets limit', () => {
  test('portfolios of >500 assets are not blocked without explicit maxAssets', async () => {
    // Previously the default was 500. WP1 removes the default — only explicit guard fires.
    const assetIds = Array.from({ length: 501 }, (_, i) => `asset-dyn-${i}`);
    const r = await broker.call('eeg-clawback-calculator.simulatePortfolio', {
      assetIds,
      timeframe: TIMEFRAME,
      options: { chunkSize: 50, traceMode: 'none' },
      executionMode: 'sync',
    });
    expect(r.portfolioSummary.assetCount).toBe(501);
    expect(r.portfolioSummary.successfulAssets).toBe(501);
  }, 30000);

  test('explicit maxAssets still enforced when provided', async () => {
    const assetIds = Array.from({ length: 5 }, (_, i) => `asset-dyn-${i}`);
    await expect(
      broker.call('eeg-clawback-calculator.simulatePortfolio', {
        assetIds,
        timeframe: TIMEFRAME,
        options: { maxAssets: 3 },
      })
    ).rejects.toMatchObject({ type: 'RCS_MAX_ASSETS_EXCEEDED' });
  });
});

// ── v0.60.6 WP2: workloadEstimate in every result ─────────────────────────────

describe('WP2: workloadEstimate', () => {
  test('workloadEstimate is present in sync portfolio result', async () => {
    const r = await broker.call('eeg-clawback-calculator.simulatePortfolio', {
      assetIds: ['asset-solar-01', 'asset-wind-01'],
      timeframe: TIMEFRAME,
      options: { traceMode: 'none' },
      executionMode: 'sync',
    });
    expect(r.workloadEstimate).toBeDefined();
    expect(r.workloadEstimate.assetCount).toBe(2);
    expect(typeof r.workloadEstimate.estimatedTotalIntervals).toBe('number');
    expect(r.workloadEstimate.estimatedTotalIntervals).toBeGreaterThan(0);
    expect(['low', 'medium', 'high']).toContain(r.workloadEstimate.estimatedRisk);
  });

  test('workloadEstimate is present in readiness assessment result', async () => {
    const r = await broker.call('eeg-clawback-calculator.assessPortfolioReadiness', {
      assetIds: ['asset-solar-01'],
      timeframe: TIMEFRAME,
      executionMode: 'sync',
    });
    expect(r.workloadEstimate).toBeDefined();
    expect(r.workloadEstimate.assetCount).toBe(1);
  });
});

// ── WP I: large portfolio stress test ────────────────────────────────────────

describe('large portfolio stress test', () => {
  test('100 assets, chunkSize 25, traceMode none — completes without error', async () => {
    const assetIds = Array.from({ length: 100 }, (_, i) => `asset-dyn-${i}`);
    const r = await broker.call('eeg-clawback-calculator.simulatePortfolio', {
      assetIds,
      timeframe: TIMEFRAME,
      options: { chunkSize: 25, traceMode: 'none' },
    });
    expect(r.portfolioSummary.assetCount).toBe(100);
    expect(r.portfolioSummary.successfulAssets).toBe(100);
    expect(r.portfolioSummary.totalBaselineAmountEur).toBeGreaterThan(0);
  });

  test('byTechnology groups sum correctly for large portfolio', async () => {
    const assetIds = Array.from({ length: 50 }, (_, i) => `asset-dyn-${i}`);
    const r = await broker.call('eeg-clawback-calculator.simulatePortfolio', {
      assetIds,
      timeframe: TIMEFRAME,
      options: { chunkSize: 10, traceMode: 'none' },
    });
    const techSum = r.byTechnology.reduce((s, g) => s + g.assetCount, 0);
    expect(techSum).toBe(r.portfolioSummary.successfulAssets);
  });
});
