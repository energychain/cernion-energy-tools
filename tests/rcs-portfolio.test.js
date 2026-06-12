'use strict';

const { ServiceBroker } = require('moleculer');

let broker;

// ── Mock data factories ───────────────────────────────────────────────────────

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
const PRICES_24H = makeQuarterHourPrices(96, 50); // 50 EUR/MWh, no clawback
const INJECTION_24H = makeInjectionSeries(96, 10);

// Mock assets: different technologies and AW values
const MOCK_ASSETS = {
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

// ── Broker setup with mocked dependencies ────────────────────────────────────

beforeAll(async () => {
  broker = new ServiceBroker({ logger: false, transporter: null });

  // Mock assets service
  broker.createService({
    name: 'assets',
    actions: {
      effective: {
        handler(ctx) {
          const { assetId } = ctx.params;
          if (assetId === 'asset-broken') throw new Error('Asset not found');
          if (MOCK_ASSETS[assetId]) return MOCK_ASSETS[assetId];
          throw new Error(`Unknown asset: ${assetId}`);
        },
      },
    },
  });

  // Mock energy-market service — returns 24h quarter-hour prices
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

  // Mock EDM service — returns 24h injection for known assets, empty for unknown
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

// ── simulatePortfolio — happy path ───────────────────────────────────────────

describe('simulatePortfolio — all assets successful', () => {
  const assetIds = Object.keys(MOCK_ASSETS);
  let result;

  beforeAll(async () => {
    result = await broker.call('eeg-clawback-calculator.simulatePortfolio', {
      assetIds,
      timeframe: TIMEFRAME,
      options: { includeIntervalTrace: false, includeReadiness: false },
    });
  });

  test('portfolioSummary.assetCount matches input', () => {
    expect(result.portfolioSummary.assetCount).toBe(assetIds.length);
  });

  test('all assets succeed', () => {
    expect(result.portfolioSummary.successfulAssets).toBe(assetIds.length);
    expect(result.portfolioSummary.failedAssets).toBe(0);
  });

  test('assetResults has one entry per asset', () => {
    expect(result.assetResults).toHaveLength(assetIds.length);
  });

  test('every assetResult has status success', () => {
    expect(result.assetResults.every((r) => r.status === 'success')).toBe(true);
  });

  test('totalBaselineAmountEur > 0', () => {
    expect(result.portfolioSummary.totalBaselineAmountEur).toBeGreaterThan(0);
  });

  test('totalClawbackAmountEur = 0 (price 50 EUR/MWh < AW for all)', () => {
    expect(result.portfolioSummary.totalClawbackAmountEur).toBe(0);
  });

  test('liquidityRiskIndex is low when no clawback', () => {
    expect(result.portfolioSummary.liquidityRiskIndex).toBe('low');
  });

  test('byTechnology groups are present', () => {
    expect(Array.isArray(result.byTechnology)).toBe(true);
    const techs = result.byTechnology.map((g) => g.technology);
    expect(techs).toContain('solar');
    expect(techs).toContain('wind_onshore');
  });

  test('byTechnology assetCount sums to total successful assets', () => {
    const sum = result.byTechnology.reduce((s, g) => s + g.assetCount, 0);
    expect(sum).toBe(result.portfolioSummary.successfulAssets);
  });

  test('topAssetsByDelta is an array', () => {
    expect(Array.isArray(result.topAssetsByDelta)).toBe(true);
  });

  test('ruleSetId is set', () => {
    expect(typeof result.ruleSetId).toBe('string');
  });

  test('includeIntervalTrace: false → no intervals in assetResults', () => {
    expect(result.assetResults.every((r) => r.intervals === undefined)).toBe(true);
  });
});

// ── simulatePortfolio — aggregate math verification ──────────────────────────

describe('simulatePortfolio — aggregate sum consistency', () => {
  const assetIds = ['asset-solar-01', 'asset-solar-02'];
  let portfolio;
  let individual1;
  let individual2;

  beforeAll(async () => {
    [portfolio, individual1, individual2] = await Promise.all([
      broker.call('eeg-clawback-calculator.simulatePortfolio', {
        assetIds,
        timeframe: TIMEFRAME,
        options: { includeIntervalTrace: false },
      }),
      broker.call('eeg-clawback-calculator.simulate', {
        assetId: 'asset-solar-01',
        timeframe: TIMEFRAME,
        options: { includeIntervalTrace: false },
      }),
      broker.call('eeg-clawback-calculator.simulate', {
        assetId: 'asset-solar-02',
        timeframe: TIMEFRAME,
        options: { includeIntervalTrace: false },
      }),
    ]);
  });

  test('portfolio totalBaselineAmountEur = sum of individual baselines', () => {
    const expected =
      (individual1.summary.calculatedUnderOldLaw.totalRevenueCents +
        individual2.summary.calculatedUnderOldLaw.totalRevenueCents) /
      100;
    expect(portfolio.portfolioSummary.totalBaselineAmountEur).toBeCloseTo(expected, 2);
  });

  test('portfolio totalClawbackAmountEur = sum of individual clawbacks', () => {
    const expected =
      (individual1.summary.calculatedUnderNewLaw.totalRefinancingContributionCents +
        individual2.summary.calculatedUnderNewLaw.totalRefinancingContributionCents) /
      100;
    expect(portfolio.portfolioSummary.totalClawbackAmountEur).toBeCloseTo(expected, 2);
  });
});

// ── simulatePortfolio — partial failure with continueOnAssetError ─────────────

describe('simulatePortfolio — asset error handling', () => {
  const assetIds = ['asset-solar-01', 'asset-broken', 'asset-solar-02'];
  let result;

  beforeAll(async () => {
    result = await broker.call('eeg-clawback-calculator.simulatePortfolio', {
      assetIds,
      timeframe: TIMEFRAME,
      options: { continueOnAssetError: true },
    });
  });

  test('run completes despite broken asset', () => {
    expect(result.portfolioSummary.assetCount).toBe(3);
  });

  test('successfulAssets = 2, failedAssets = 1', () => {
    expect(result.portfolioSummary.successfulAssets).toBe(2);
    expect(result.portfolioSummary.failedAssets).toBe(1);
  });

  test('errors array contains the broken asset', () => {
    expect(result.errors.some((e) => e.assetId === 'asset-broken')).toBe(true);
  });

  test('failed assetResult has status error and message', () => {
    const failed = result.assetResults.find((r) => r.assetId === 'asset-broken');
    expect(failed.status).toBe('error');
    expect(typeof failed.message).toBe('string');
  });
});

// ── simulatePortfolio — 10 mock assets ───────────────────────────────────────

describe('simulatePortfolio — 10 assets', () => {
  // Register 10 assets dynamically using existing known ones (cycling)
  const knownIds = Object.keys(MOCK_ASSETS);
  const assetIds = Array.from({ length: 10 }, (_, i) => knownIds[i % knownIds.length]);

  let result;

  beforeAll(async () => {
    result = await broker.call('eeg-clawback-calculator.simulatePortfolio', {
      assetIds,
      timeframe: TIMEFRAME,
      options: { includeIntervalTrace: false },
    });
  });

  test('portfolioSummary.assetCount = 10', () => {
    expect(result.portfolioSummary.assetCount).toBe(10);
  });

  test('all 10 assets succeed', () => {
    expect(result.portfolioSummary.successfulAssets).toBe(10);
  });

  test('assetResults has 10 entries', () => {
    expect(result.assetResults).toHaveLength(10);
  });
});

// ── simulatePortfolio — with readiness ───────────────────────────────────────

describe('simulatePortfolio — includeReadiness: true', () => {
  const assetIds = ['asset-solar-01', 'asset-no-data'];
  let result;

  beforeAll(async () => {
    result = await broker.call('eeg-clawback-calculator.simulatePortfolio', {
      assetIds,
      timeframe: TIMEFRAME,
      options: { includeReadiness: true, continueOnAssetError: true },
    });
  });

  test('asset-solar-01 has readinessStatus set', () => {
    const r = result.assetResults.find((r) => r.assetId === 'asset-solar-01');
    expect(['ready', 'partial', 'not_ready']).toContain(r.readinessStatus);
  });

  test('byReadinessStatus is present', () => {
    expect(Array.isArray(result.byReadinessStatus)).toBe(true);
    expect(result.byReadinessStatus.length).toBeGreaterThan(0);
  });
});

// ── assessPortfolioReadiness ──────────────────────────────────────────────────

describe('assessPortfolioReadiness', () => {
  const assetIds = ['asset-solar-01', 'asset-solar-02', 'asset-no-data'];
  let result;

  beforeAll(async () => {
    result = await broker.call('eeg-clawback-calculator.assessPortfolioReadiness', {
      assetIds,
      timeframe: TIMEFRAME,
    });
  });

  test('portfolioStatus is one of ready/partial/not_ready', () => {
    expect(['ready', 'partial', 'not_ready']).toContain(result.portfolioStatus);
  });

  test('assetCount matches input', () => {
    expect(result.assetCount).toBe(assetIds.length);
  });

  test('readyCount + partialCount + notReadyCount = assetCount', () => {
    expect(result.readyCount + result.partialCount + result.notReadyCount).toBe(result.assetCount);
  });

  test('readinessRatio is between 0 and 1', () => {
    expect(result.readinessRatio).toBeGreaterThanOrEqual(0);
    expect(result.readinessRatio).toBeLessThanOrEqual(1);
  });

  test('assetReports has one entry per asset', () => {
    expect(result.assetReports).toHaveLength(assetIds.length);
  });

  test('commonRecommendations is an array', () => {
    expect(Array.isArray(result.commonRecommendations)).toBe(true);
  });

  test('criticalFindings is an array', () => {
    expect(Array.isArray(result.criticalFindings)).toBe(true);
  });

  test('asset-no-data has not_ready overallStatus', () => {
    const report = result.assetReports.find((r) => r.assetId === 'asset-no-data');
    expect(report.overallStatus).toBe('not_ready');
  });
});
