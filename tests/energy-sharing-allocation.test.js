'use strict';

/**
 * Tests for Energy Sharing Allocation Engine (v0.16.0)
 *
 * Suite 1: Pure unit tests — src/timeseries-allocation.js (no broker, no I/O)
 * Suite 2: Broker integration tests — services/energy-sharing-allocation.service.js
 */

const path = require('path');
const os = require('os');
const { ServiceBroker } = require('moleculer');

// ── MCP client mock — must be declared before any require() ──────────────────
jest.mock('../src/mcp-client', () => ({
  callWithNewSession: jest.fn(),
}));
const CernionMCPClient = require('../src/mcp-client');

// ── Unique PouchDB path to avoid parallel worker clashes ─────────────────────
const TEST_DB_PATH = path.join(os.tmpdir(), `cernion-alloc-test-${Date.now()}`);
process.env.ALLOCATION_ENGINE_DB_PATH = TEST_DB_PATH;
process.env.DATAPOINT_SCHEDULER_ENABLED = 'false';

const {
  round4,
  buildIntervalGrid,
  mergeGeneratorForecasts,
  applyRedispatchDeductions,
  allocateTimeseries,
  buildConsumerSummary,
  formatAsCsv,
  INTERVAL_MS,
  INTERVALS_PER_DAY,
  RECOMMENDED_MAX_DAYS,
} = require('../src/timeseries-allocation');

// ── Fixtures ──────────────────────────────────────────────────────────────────

const CONSUMER_A = {
  maloId: 'DE0001234567890123456789012345678',
  sharePercent: 30,
  name: 'Müller',
};
const CONSUMER_B = {
  maloId: 'DE0009876543210987654321098765432',
  sharePercent: 70,
  name: 'Schmidt',
};
const CONSUMERS_2 = [CONSUMER_A, CONSUMER_B];

const CONSUMER_C = {
  maloId: 'DE0005555555555555555555555555555',
  sharePercent: 20,
  name: 'Haus C',
};
const CONSUMERS_3 = [
  { ...CONSUMER_A, sharePercent: 30 },
  { ...CONSUMER_B, sharePercent: 50 },
  { ...CONSUMER_C, sharePercent: 20 },
];

const GENERATOR_1 = { mastrNummer: 'SEE904837264953', sharePercent: 100 };

/** Build a minimal valid allocate payload */
function makeAllocateParams(overrides = {}) {
  return {
    communityId: 'ES-2026-TEST-001',
    generators: [GENERATOR_1],
    consumers: CONSUMERS_2,
    dateFrom: '2026-06-01',
    dateTo: '2026-06-07',
    dataSource: 'forecast',
    includeRedispatchDeduction: false,
    ...overrides,
  };
}

/** Build a flat forecast response with constant generation (1 MW per interval) */
function makeForecastIntervals(dateFrom, dateTo, generationMW = 1.0) {
  const start = new Date(`${dateFrom}T00:00:00Z`).getTime();
  const end = new Date(`${dateTo}T00:00:00Z`).getTime() + 24 * 60 * 60 * 1000;
  const intervals = [];
  for (let t = start; t < end; t += INTERVAL_MS) {
    intervals.push({ timestamp: new Date(t).toISOString(), generationMW });
  }
  return intervals;
}

// =============================================================================
// Suite 1 — Pure unit tests: src/timeseries-allocation.js
// =============================================================================

describe('timeseries-allocation — pure unit tests', () => {
  // ── round4 ──────────────────────────────────────────────────────────────────
  describe('round4', () => {
    test('rounds to 4 decimal places', () => {
      expect(round4(1.23456789)).toBe(1.2346);
      expect(round4(0.00001)).toBe(0.0);
      expect(round4(0.00005)).toBe(0.0001);
    });

    test('handles exact values without drift', () => {
      expect(round4(10.0)).toBe(10.0);
      expect(round4(0)).toBe(0);
    });
  });

  // ── buildIntervalGrid ────────────────────────────────────────────────────────
  describe('buildIntervalGrid', () => {
    test('generates 96 intervals for a single day', () => {
      const grid = buildIntervalGrid('2026-06-01', '2026-06-01');
      expect(grid).toHaveLength(INTERVALS_PER_DAY);
    });

    test('generates 672 intervals for 7 days', () => {
      const grid = buildIntervalGrid('2026-06-01', '2026-06-07');
      expect(grid).toHaveLength(7 * INTERVALS_PER_DAY);
    });

    test('first interval timestamp is midnight UTC of dateFrom', () => {
      const grid = buildIntervalGrid('2026-06-01', '2026-06-01');
      expect(grid[0].timestamp).toBe('2026-06-01T00:00:00.000Z');
    });

    test('each interval is exactly 15 minutes after the previous', () => {
      const grid = buildIntervalGrid('2026-06-01', '2026-06-01');
      for (let i = 1; i < grid.length; i++) {
        const prev = new Date(grid[i - 1].timestamp).getTime();
        const curr = new Date(grid[i].timestamp).getTime();
        expect(curr - prev).toBe(INTERVAL_MS);
      }
    });

    test('all initial values are 0', () => {
      const grid = buildIntervalGrid('2026-06-01', '2026-06-01');
      for (const interval of grid) {
        expect(interval.generationKWh).toBe(0);
        expect(interval.redispatchDeductionKWh).toBe(0);
        expect(interval.netGenerationKWh).toBe(0);
      }
    });

    test('RECOMMENDED_MAX_DAYS constant is 31', () => {
      expect(RECOMMENDED_MAX_DAYS).toBe(31);
    });
  });

  // ── mergeGeneratorForecasts ──────────────────────────────────────────────────
  describe('mergeGeneratorForecasts', () => {
    test('converts 1 MW per interval to 0.25 kWh', () => {
      const grid = buildIntervalGrid('2026-06-01', '2026-06-01');
      const forecastIntervals = makeForecastIntervals('2026-06-01', '2026-06-01', 1.0);
      mergeGeneratorForecasts(grid, [{ sharePercent: 100, forecastIntervals }]);
      // 1 MW × 0.25 h = 0.25 kWh per interval
      expect(grid[0].generationKWh).toBe(0.25);
    });

    test('applies sharePercent weighting', () => {
      const grid = buildIntervalGrid('2026-06-01', '2026-06-01');
      const forecastIntervals = makeForecastIntervals('2026-06-01', '2026-06-01', 2.0);
      mergeGeneratorForecasts(grid, [{ sharePercent: 50, forecastIntervals }]);
      // 2 MW × 0.25 h × 50% = 0.25 kWh
      expect(grid[0].generationKWh).toBe(0.25);
    });

    test('adds multiple generators together', () => {
      const grid = buildIntervalGrid('2026-06-01', '2026-06-01');
      const fi = makeForecastIntervals('2026-06-01', '2026-06-01', 1.0);
      mergeGeneratorForecasts(grid, [
        { sharePercent: 60, forecastIntervals: fi },
        { sharePercent: 40, forecastIntervals: fi },
      ]);
      // 60% × 0.25 + 40% × 0.25 = 0.25
      expect(grid[0].generationKWh).toBe(0.25);
    });

    test('accepts pre-converted generationKWh values', () => {
      const grid = buildIntervalGrid('2026-06-01', '2026-06-01');
      const fi = [{ timestamp: grid[0].timestamp, generationKWh: 3.5 }];
      mergeGeneratorForecasts(grid, [{ sharePercent: 100, forecastIntervals: fi }]);
      expect(grid[0].generationKWh).toBe(3.5);
    });

    test('sets netGenerationKWh = generationKWh when no redispatch applied', () => {
      const grid = buildIntervalGrid('2026-06-01', '2026-06-01');
      const fi = makeForecastIntervals('2026-06-01', '2026-06-01', 1.0);
      mergeGeneratorForecasts(grid, [{ sharePercent: 100, forecastIntervals: fi }]);
      expect(grid[0].netGenerationKWh).toBe(grid[0].generationKWh);
    });

    test('ignores intervals with timestamps outside the grid', () => {
      const grid = buildIntervalGrid('2026-06-01', '2026-06-01');
      const fi = [{ timestamp: '2025-01-01T00:00:00.000Z', generationMW: 99 }];
      mergeGeneratorForecasts(grid, [{ sharePercent: 100, forecastIntervals: fi }]);
      expect(grid[0].generationKWh).toBe(0);
    });

    test('handles empty forecastIntervals without throwing', () => {
      const grid = buildIntervalGrid('2026-06-01', '2026-06-01');
      expect(() =>
        mergeGeneratorForecasts(grid, [{ sharePercent: 100, forecastIntervals: [] }])
      ).not.toThrow();
      expect(grid[0].generationKWh).toBe(0);
    });
  });

  // ── applyRedispatchDeductions ────────────────────────────────────────────────
  describe('applyRedispatchDeductions', () => {
    function makeGridWithGeneration(date, generationKWh = 1.0) {
      const grid = buildIntervalGrid(date, date);
      for (const i of grid) {
        i.generationKWh = generationKWh;
        i.netGenerationKWh = generationKWh;
      }
      return grid;
    }

    test('sets netGenerationKWh to 0 for intervals inside curtailment window', () => {
      const grid = makeGridWithGeneration('2026-06-01', 1.0);
      // Window covers first 15-min interval exactly
      const windows = [{ startTime: '2026-06-01T00:00:00Z', endTime: '2026-06-01T00:15:00Z' }];
      applyRedispatchDeductions(grid, windows);
      expect(grid[0].netGenerationKWh).toBe(0);
      expect(grid[0].redispatchDeductionKWh).toBe(1.0);
    });

    test('does not affect intervals outside the curtailment window', () => {
      const grid = makeGridWithGeneration('2026-06-01', 1.0);
      const windows = [{ startTime: '2026-06-01T00:00:00Z', endTime: '2026-06-01T00:15:00Z' }];
      applyRedispatchDeductions(grid, windows);
      // Second interval (00:15) should be untouched
      expect(grid[1].netGenerationKWh).toBe(1.0);
      expect(grid[1].redispatchDeductionKWh).toBe(0);
    });

    test('returns grid unchanged when no curtailment windows provided', () => {
      const grid = makeGridWithGeneration('2026-06-01', 1.0);
      applyRedispatchDeductions(grid, []);
      expect(grid[0].netGenerationKWh).toBe(1.0);
    });

    test('handles null curtailmentWindows gracefully', () => {
      const grid = makeGridWithGeneration('2026-06-01', 1.0);
      expect(() => applyRedispatchDeductions(grid, null)).not.toThrow();
    });

    test('zero-generation intervals are not affected', () => {
      const grid = buildIntervalGrid('2026-06-01', '2026-06-01'); // all zero
      const windows = [{ startTime: '2026-06-01T00:00:00Z', endTime: '2026-06-01T01:00:00Z' }];
      applyRedispatchDeductions(grid, windows);
      expect(grid[0].redispatchDeductionKWh).toBe(0);
    });
  });

  // ── allocateTimeseries ───────────────────────────────────────────────────────
  describe('allocateTimeseries', () => {
    function makeFilledGrid(date, netKWh = 10.0) {
      const grid = buildIntervalGrid(date, date);
      for (const i of grid) {
        i.generationKWh = netKWh;
        i.netGenerationKWh = netKWh;
      }
      return grid;
    }

    test('∑ allocations = netGenerationKWh per interval (2 consumers, 30/70 split)', () => {
      const grid = makeFilledGrid('2026-06-01', 10.0);
      allocateTimeseries(grid, CONSUMERS_2);
      for (const interval of grid) {
        const total = Object.values(interval.allocations).reduce((a, b) => a + b, 0);
        expect(Math.abs(total - interval.netGenerationKWh)).toBeLessThanOrEqual(0.0001);
      }
    });

    test('Restmengenempfänger (last consumer) absorbs rounding residual', () => {
      // Use a value that doesn't split cleanly: 1/3 split
      const consumers = [
        { maloId: 'DE0001111111111111111111111111111', sharePercent: 33.333 },
        { maloId: 'DE0002222222222222222222222222222', sharePercent: 33.333 },
        { maloId: 'DE0003333333333333333333333333333', sharePercent: 33.334 },
      ];
      const grid = makeFilledGrid('2026-06-01', 10.0);
      allocateTimeseries(grid, consumers);
      for (const interval of grid) {
        const total = Object.values(interval.allocations).reduce((a, b) => a + b, 0);
        expect(Math.abs(total - interval.netGenerationKWh)).toBeLessThanOrEqual(0.0001);
      }
    });

    test('100% to single consumer', () => {
      const consumers = [{ maloId: 'DE0001234567890123456789012345678', sharePercent: 100 }];
      const grid = makeFilledGrid('2026-06-01', 5.5);
      allocateTimeseries(grid, consumers);
      expect(grid[0].allocations['DE0001234567890123456789012345678']).toBe(5.5);
    });

    test('zero-generation intervals produce zero allocations', () => {
      const grid = buildIntervalGrid('2026-06-01', '2026-06-01'); // all zero
      allocateTimeseries(grid, CONSUMERS_2);
      for (const interval of grid) {
        for (const v of Object.values(interval.allocations)) {
          expect(v).toBe(0);
        }
      }
    });

    test('handles 3 consumers correctly', () => {
      const grid = makeFilledGrid('2026-06-01', 10.0);
      allocateTimeseries(grid, CONSUMERS_3);
      for (const interval of grid) {
        const total = Object.values(interval.allocations).reduce((a, b) => a + b, 0);
        expect(Math.abs(total - interval.netGenerationKWh)).toBeLessThanOrEqual(0.0001);
      }
    });
  });

  // ── buildConsumerSummary ──────────────────────────────────────────────────────
  describe('buildConsumerSummary', () => {
    test('computes totalKWh correctly for each consumer', () => {
      const grid = buildIntervalGrid('2026-06-01', '2026-06-01');
      for (const i of grid) {
        i.netGenerationKWh = 10.0;
        i.generationKWh = 10.0;
      }
      allocateTimeseries(grid, CONSUMERS_2);
      const summaries = buildConsumerSummary(grid, CONSUMERS_2);
      // Consumer A: 30% × 10.0 × 96 = 288 kWh
      expect(summaries[0].maloId).toBe(CONSUMER_A.maloId);
      expect(summaries[0].totalKWh).toBe(288.0);
      // Consumer B: 70% × 10.0 × 96 = 672 kWh (last consumer gets remainder)
      expect(summaries[1].totalKWh).toBe(672.0);
    });

    test('zeroIntervals counts intervals with 0 allocation', () => {
      // Night: first 24 intervals have 0 kWh, rest have 1 kWh
      const grid = buildIntervalGrid('2026-06-01', '2026-06-01');
      grid.forEach((i, idx) => {
        i.generationKWh = idx < 24 ? 0 : 1.0;
        i.netGenerationKWh = idx < 24 ? 0 : 1.0;
      });
      allocateTimeseries(grid, CONSUMERS_2);
      const summaries = buildConsumerSummary(grid, CONSUMERS_2);
      expect(summaries[0].zeroIntervals).toBe(24);
    });

    test('intervalCount matches grid length', () => {
      const grid = buildIntervalGrid('2026-06-01', '2026-06-07');
      allocateTimeseries(grid, CONSUMERS_2);
      const summaries = buildConsumerSummary(grid, CONSUMERS_2);
      expect(summaries[0].intervalCount).toBe(7 * INTERVALS_PER_DAY);
    });
  });

  // ── formatAsCsv ───────────────────────────────────────────────────────────────
  describe('formatAsCsv', () => {
    test('produces correct number of lines (header + intervals)', () => {
      const grid = buildIntervalGrid('2026-06-01', '2026-06-07');
      allocateTimeseries(grid, CONSUMERS_2);
      const csv = formatAsCsv(grid, CONSUMER_A.maloId);
      const lines = csv.split('\n');
      expect(lines).toHaveLength(7 * INTERVALS_PER_DAY + 1); // +1 for header
    });

    test('header row matches EDM column spec', () => {
      const grid = buildIntervalGrid('2026-06-01', '2026-06-01');
      allocateTimeseries(grid, CONSUMERS_2);
      const csv = formatAsCsv(grid, CONSUMER_A.maloId);
      const header = csv.split('\n')[0];
      expect(header).toBe(
        'timestamp;generation_kwh;redispatch_deduction_kwh;net_generation_kwh;allocation_kwh'
      );
    });

    test('uses semicolon delimiter', () => {
      const grid = buildIntervalGrid('2026-06-01', '2026-06-01');
      allocateTimeseries(grid, CONSUMERS_2);
      const csv = formatAsCsv(grid, CONSUMER_A.maloId);
      const dataRow = csv.split('\n')[1];
      expect(dataRow.split(';')).toHaveLength(5);
    });

    test('timestamps are ISO-8601', () => {
      const grid = buildIntervalGrid('2026-06-01', '2026-06-01');
      allocateTimeseries(grid, CONSUMERS_2);
      const csv = formatAsCsv(grid, CONSUMER_A.maloId);
      const ts = csv.split('\n')[1].split(';')[0];
      expect(() => new Date(ts).toISOString()).not.toThrow();
    });

    test('allocation_kwh column uses 4 decimal places', () => {
      const grid = buildIntervalGrid('2026-06-01', '2026-06-01');
      for (const i of grid) {
        i.generationKWh = 1.0;
        i.netGenerationKWh = 1.0;
      }
      allocateTimeseries(grid, CONSUMERS_2);
      const csv = formatAsCsv(grid, CONSUMER_A.maloId);
      const dataRow = csv.split('\n')[1];
      const allocField = dataRow.split(';')[4];
      expect(allocField).toMatch(/^\d+\.\d{4}$/);
    });
  });
});

// =============================================================================
// Suite 2 — Broker integration tests: energy-sharing-allocation.service
// =============================================================================

describe('energy-sharing-allocation service', () => {
  let broker;
  let allocService;

  beforeAll(async () => {
    broker = new ServiceBroker({ logger: false });

    allocService = broker.createService(require('../services/energy-sharing-allocation.service'));

    // Stub energy-sharing service for validationReportId lookups
    broker.createService({
      name: 'energy-sharing',
      actions: {
        get: {
          async handler(ctx) {
            if (ctx.params.id === 'report-approved') {
              return { success: true, id: 'report-approved', decision: 'APPROVED' };
            }
            if (ctx.params.id === 'report-rejected') {
              return { success: true, id: 'report-rejected', decision: 'REJECTED' };
            }
            throw new Error(`Validation ${ctx.params.id} not found`);
          },
        },
      },
    });

    // Stub datasource-cache for inhouse tests
    broker.createService({
      name: 'datasource-cache',
      actions: {
        query: {
          async handler(ctx) {
            if (ctx.params.sourceId === 'valid-inhouse-source') {
              const rows = makeForecastIntervals('2026-06-01', '2026-06-07', 1.0).map((fi) => ({
                timestamp: fi.timestamp,
                generation_kwh: (1.0 * 0.25).toFixed(4),
              }));
              return { data: { rows } };
            }
            if (ctx.params.sourceId === 'bad-schema-source') {
              return { data: { rows: [{ timestamp: '2026-06-01T00:00:00.000Z', power_mw: 1.0 }] } };
            }
            return { data: { rows: [] } };
          },
        },
      },
    });

    await broker.start();
  });

  afterAll(async () => {
    await broker.stop();
    const PouchDB = require('pouchdb');
    PouchDB.plugin(require('pouchdb-find'));
    await new PouchDB(TEST_DB_PATH).destroy().catch(() => {});
  });

  beforeEach(() => {
    CernionMCPClient.callWithNewSession.mockReset();

    // Default: successful forecast call for any generator
    CernionMCPClient.callWithNewSession.mockImplementation((toolName) => {
      if (toolName === 'mastr_generation_forecast') {
        const intervals = makeForecastIntervals('2026-06-01', '2026-06-07', 2.0);
        return Promise.resolve({ data: intervals });
      }
      if (toolName === 'netztransparenz_redispatch') {
        return Promise.resolve({ curtailmentEvents: [] });
      }
      return Promise.resolve({});
    });
  });

  // ── Service structure ────────────────────────────────────────────────────────
  test('service is named energy-sharing-allocation', () => {
    expect(allocService.schema.name).toBe('energy-sharing-allocation');
  });

  test('all 5 actions are defined with correct REST verbs', () => {
    const actions = allocService.schema.actions;
    expect(actions.allocate.rest).toBe('POST /allocate');
    expect(actions.list.rest).toBe('GET /allocations');
    expect(actions.get.rest).toBe('GET /allocations/:id');
    expect(actions.download.rest).toBe('GET /allocations/:id/download');
    expect(actions.remove.rest).toBe('DELETE /allocations/:id');
  });

  test('allocate has 120 s timeout', () => {
    expect(allocService.schema.actions.allocate.timeout).toBe(120_000);
  });

  test('all actions have openapi annotations with correct tag', () => {
    for (const [, action] of Object.entries(allocService.schema.actions)) {
      expect(action.openapi?.summary).toBeTruthy();
      expect(action.openapi?.tags).toContain('Energy Sharing Allocation');
    }
  });

  // ── allocate — happy path ────────────────────────────────────────────────────
  test('allocate returns success with 2 consumer summaries for 7-day forecast', async () => {
    const result = await broker.call('energy-sharing-allocation.allocate', makeAllocateParams());

    expect(result.success).toBe(true);
    expect(result.id).toBeTruthy();
    expect(result.consumers).toHaveLength(2);
    expect(result.summary.intervalCount).toBe(7 * INTERVALS_PER_DAY);
  });

  test('allocate consumer share sums match 100% of net generation', async () => {
    const result = await broker.call('energy-sharing-allocation.allocate', makeAllocateParams());

    const totalA = result.consumers.find((c) => c.maloId === CONSUMER_A.maloId).totalKWh;
    const totalB = result.consumers.find((c) => c.maloId === CONSUMER_B.maloId).totalKWh;
    expect(Math.abs(totalA + totalB - result.summary.totalNetGenerationKWh)).toBeLessThanOrEqual(
      0.001
    );
  });

  test('allocate persists document to PouchDB', async () => {
    const result = await broker.call('energy-sharing-allocation.allocate', makeAllocateParams());

    const getResult = await broker.call('energy-sharing-allocation.get', { id: result.id });
    expect(getResult.success).toBe(true);
    expect(getResult.id).toBe(result.id);
    expect(getResult.communityId).toBe('ES-2026-TEST-001');
  });

  // ── allocate — validationReportId ────────────────────────────────────────────
  test('allocate with approved validationReportId adds no warning', async () => {
    const result = await broker.call(
      'energy-sharing-allocation.allocate',
      makeAllocateParams({ validationReportId: 'report-approved' })
    );
    const reportWarning = result.warnings.find(
      (w) => w.code === 'ALLOC_VALIDATION_REPORT_NOT_APPROVED'
    );
    expect(reportWarning).toBeUndefined();
  });

  test('allocate with rejected validationReportId adds ALLOC_VALIDATION_REPORT_NOT_APPROVED warning', async () => {
    const result = await broker.call(
      'energy-sharing-allocation.allocate',
      makeAllocateParams({ validationReportId: 'report-rejected' })
    );
    const w = result.warnings.find((w) => w.code === 'ALLOC_VALIDATION_REPORT_NOT_APPROVED');
    expect(w).toBeDefined();
    expect(w.message).toContain('REJECTED');
  });

  test('allocate with unknown validationReportId adds ALLOC_VALIDATION_REPORT_NOT_FOUND warning and continues', async () => {
    const result = await broker.call(
      'energy-sharing-allocation.allocate',
      makeAllocateParams({ validationReportId: 'nonexistent-id-xyz' })
    );
    expect(result.success).toBe(true);
    const w = result.warnings.find((w) => w.code === 'ALLOC_VALIDATION_REPORT_NOT_FOUND');
    expect(w).toBeDefined();
  });

  // ── allocate — >31 day soft warning ─────────────────────────────────────────
  test('allocate >31 days adds ALLOC_WINDOW_EXCEEDS_RECOMMENDED warning but succeeds', async () => {
    const result = await broker.call(
      'energy-sharing-allocation.allocate',
      makeAllocateParams({ dateFrom: '2026-06-01', dateTo: '2026-07-15' }) // 45 days
    );
    expect(result.success).toBe(true);
    const w = result.warnings.find((w) => w.code === 'ALLOC_WINDOW_EXCEEDS_RECOMMENDED');
    expect(w).toBeDefined();
    expect(w.message).toMatch(/45 days/);
  });

  // ── allocate — input validation errors ──────────────────────────────────────
  test('allocate throws when generator shares do not sum to 100', async () => {
    await expect(
      broker.call(
        'energy-sharing-allocation.allocate',
        makeAllocateParams({ generators: [{ mastrNummer: 'SEE904837264953', sharePercent: 80 }] })
      )
    ).rejects.toThrow(/sum to 100/);
  });

  test('allocate throws when consumer shares do not sum to 100', async () => {
    await expect(
      broker.call(
        'energy-sharing-allocation.allocate',
        makeAllocateParams({
          consumers: [
            { maloId: 'DE0001234567890123456789012345678', sharePercent: 30, name: 'A' },
            { maloId: 'DE0009876543210987654321098765432', sharePercent: 30, name: 'B' },
          ],
        })
      )
    ).rejects.toThrow(/sum to 100/);
  });

  test('allocate throws when dateFrom > dateTo', async () => {
    await expect(
      broker.call(
        'energy-sharing-allocation.allocate',
        makeAllocateParams({ dateFrom: '2026-06-07', dateTo: '2026-06-01' })
      )
    ).rejects.toThrow(/dateFrom must be/);
  });

  test('allocate throws on invalid MaLo-ID format', async () => {
    await expect(
      broker.call(
        'energy-sharing-allocation.allocate',
        makeAllocateParams({
          consumers: [
            { maloId: 'INVALID-MALO', sharePercent: 50, name: 'A' },
            { maloId: 'DE0009876543210987654321098765432', sharePercent: 50, name: 'B' },
          ],
        })
      )
    ).rejects.toThrow(/Invalid MaLo-ID/);
  });

  test('allocate throws on duplicate MaLo-IDs', async () => {
    await expect(
      broker.call(
        'energy-sharing-allocation.allocate',
        makeAllocateParams({
          consumers: [
            { maloId: 'DE0001234567890123456789012345678', sharePercent: 50, name: 'A' },
            { maloId: 'DE0001234567890123456789012345678', sharePercent: 50, name: 'B (dupe)' },
          ],
        })
      )
    ).rejects.toThrow(/Duplicate MaLo-ID/);
  });

  // ── allocate — redispatch ────────────────────────────────────────────────────
  test('redispatch deduction applied when MCP returns curtailment windows', async () => {
    CernionMCPClient.callWithNewSession.mockImplementation((toolName) => {
      if (toolName === 'mastr_generation_forecast') {
        return Promise.resolve({ data: makeForecastIntervals('2026-06-01', '2026-06-07', 2.0) });
      }
      if (toolName === 'netztransparenz_redispatch') {
        return Promise.resolve({
          curtailmentEvents: [
            { startTime: '2026-06-01T06:00:00Z', endTime: '2026-06-01T07:00:00Z' },
          ],
        });
      }
      return Promise.resolve({});
    });

    const result = await broker.call(
      'energy-sharing-allocation.allocate',
      makeAllocateParams({ includeRedispatchDeduction: true })
    );

    expect(result.redispatchApplied).toBe(true);
    expect(result.summary.totalRedispatchDeductionKWh).toBeGreaterThan(0);
    const w = result.warnings.find((w) => w.code === 'ALLOC_REDISPATCH_DEDUCTION_APPLIED');
    expect(w).toBeDefined();
  });

  test('ALLOC_REDISPATCH_DATA_UNAVAILABLE warning when redispatch MCP fails', async () => {
    CernionMCPClient.callWithNewSession.mockImplementation((toolName) => {
      if (toolName === 'mastr_generation_forecast') {
        return Promise.resolve({ data: makeForecastIntervals('2026-06-01', '2026-06-07', 2.0) });
      }
      if (toolName === 'netztransparenz_redispatch') {
        return Promise.reject(new Error('MCP timeout'));
      }
      return Promise.resolve({});
    });

    const result = await broker.call(
      'energy-sharing-allocation.allocate',
      makeAllocateParams({ includeRedispatchDeduction: true })
    );

    expect(result.success).toBe(true);
    expect(result.redispatchApplied).toBe(false);
    const w = result.warnings.find((w) => w.code === 'ALLOC_REDISPATCH_DATA_UNAVAILABLE');
    expect(w).toBeDefined();
  });

  // ── allocate — forecast failure zero-profile fallback ───────────────────────
  test('forecast failure returns success with zero generation (conservative fallback)', async () => {
    CernionMCPClient.callWithNewSession.mockImplementation((toolName) => {
      if (toolName === 'mastr_generation_forecast') {
        return Promise.reject(new Error('MCP session error'));
      }
      return Promise.resolve({});
    });

    const result = await broker.call('energy-sharing-allocation.allocate', makeAllocateParams());

    expect(result.success).toBe(true);
    expect(result.summary.totalGenerationKWh).toBe(0);
  });

  // ── allocate — inhouse Stufe B ───────────────────────────────────────────────
  test('inhouse data source uses datasource-cache rows instead of forecast', async () => {
    const result = await broker.call(
      'energy-sharing-allocation.allocate',
      makeAllocateParams({
        dataSource: 'inhouse',
        inhouseSourceId: 'valid-inhouse-source',
        includeRedispatchDeduction: false,
      })
    );

    // forecast MCP should NOT have been called
    expect(CernionMCPClient.callWithNewSession).not.toHaveBeenCalledWith(
      'mastr_generation_forecast',
      expect.anything(),
      expect.anything()
    );
    expect(result.success).toBe(true);
    expect(result.summary.totalGenerationKWh).toBeGreaterThan(0);
  });

  test('inhouse with missing inhouseSourceId throws', async () => {
    await expect(
      broker.call(
        'energy-sharing-allocation.allocate',
        makeAllocateParams({ dataSource: 'inhouse', inhouseSourceId: '' })
      )
    ).rejects.toThrow(/inhouseSourceId is required/);
  });

  test('inhouse with bad CSV schema (missing generation_kwh) throws', async () => {
    await expect(
      broker.call(
        'energy-sharing-allocation.allocate',
        makeAllocateParams({ dataSource: 'inhouse', inhouseSourceId: 'bad-schema-source' })
      )
    ).rejects.toThrow(/generation_kwh/);
  });

  // ── list ──────────────────────────────────────────────────────────────────────
  test('list returns allocations sorted newest first', async () => {
    await broker.call(
      'energy-sharing-allocation.allocate',
      makeAllocateParams({ communityId: 'LIST-TEST-A' })
    );
    await broker.call(
      'energy-sharing-allocation.allocate',
      makeAllocateParams({ communityId: 'LIST-TEST-B' })
    );

    const result = await broker.call('energy-sharing-allocation.list', {});
    expect(result.count).toBeGreaterThanOrEqual(2);
    // Sorted newest first: first createdAt >= second createdAt
    if (result.allocations.length >= 2) {
      expect(result.allocations[0].createdAt >= result.allocations[1].createdAt).toBe(true);
    }
  });

  test('list filters by communityId', async () => {
    await broker.call(
      'energy-sharing-allocation.allocate',
      makeAllocateParams({ communityId: 'FILTER-UNIQUE-XYZ' })
    );

    const result = await broker.call('energy-sharing-allocation.list', {
      communityId: 'FILTER-UNIQUE-XYZ',
    });
    expect(result.count).toBeGreaterThanOrEqual(1);
    result.allocations.forEach((a) => expect(a.communityId).toBe('FILTER-UNIQUE-XYZ'));
  });

  test('list excludes soft-deleted records by default', async () => {
    const created = await broker.call(
      'energy-sharing-allocation.allocate',
      makeAllocateParams({ communityId: 'DELETE-TEST' })
    );
    await broker.call('energy-sharing-allocation.remove', { id: created.id });

    const result = await broker.call('energy-sharing-allocation.list', {
      communityId: 'DELETE-TEST',
    });
    const deleted = result.allocations.find((a) => a.id === created.id);
    expect(deleted).toBeUndefined();
  });

  test('list includes soft-deleted records when includeDeleted=true', async () => {
    const created = await broker.call(
      'energy-sharing-allocation.allocate',
      makeAllocateParams({ communityId: 'INCLUDE-DELETED-TEST' })
    );
    await broker.call('energy-sharing-allocation.remove', { id: created.id });

    const result = await broker.call('energy-sharing-allocation.list', {
      communityId: 'INCLUDE-DELETED-TEST',
      includeDeleted: true,
    });
    const found = result.allocations.find((a) => a.id === created.id);
    expect(found).toBeDefined();
    expect(found._deleted).toBe(true);
  });

  // ── get ───────────────────────────────────────────────────────────────────────
  test('get returns 404 for unknown ID', async () => {
    const result = await broker.call('energy-sharing-allocation.get', { id: 'nonexistent-uuid' });
    expect(result.success).toBe(false);
    expect(result.message).toMatch(/not found/i);
  });

  // ── remove (soft-delete) ─────────────────────────────────────────────────────
  test('remove soft-deletes: sets _deleted=true and deletedAt', async () => {
    const created = await broker.call('energy-sharing-allocation.allocate', makeAllocateParams());
    const removed = await broker.call('energy-sharing-allocation.remove', { id: created.id });

    expect(removed.success).toBe(true);
    expect(removed.deletedAt).toBeTruthy();

    // Document must still exist in PouchDB with markedDeleted=true (exposed as _deleted)
    const doc = await broker.call('energy-sharing-allocation.get', { id: created.id });
    expect(doc.markedDeleted).toBe(true);
    expect(doc.deletedAt).toBeTruthy();
  });

  test('remove is idempotent: second call returns success with already-deleted message', async () => {
    const created = await broker.call('energy-sharing-allocation.allocate', makeAllocateParams());
    await broker.call('energy-sharing-allocation.remove', { id: created.id });
    const secondRemove = await broker.call('energy-sharing-allocation.remove', { id: created.id });
    expect(secondRemove.success).toBe(true);
    expect(secondRemove.message).toMatch(/already deleted/);
  });

  test('remove returns 404 for unknown ID', async () => {
    const result = await broker.call('energy-sharing-allocation.remove', { id: 'ghost-id-xyz' });
    expect(result.success).toBe(false);
  });

  // ── download ─────────────────────────────────────────────────────────────────
  test('download returns CSV string with correct line count for 7-day period', async () => {
    const created = await broker.call('energy-sharing-allocation.allocate', makeAllocateParams());

    const csv = await broker.call('energy-sharing-allocation.download', {
      id: created.id,
      maloId: CONSUMER_A.maloId,
      format: 'csv',
    });

    expect(typeof csv).toBe('string');
    const lines = csv.split('\n');
    // header + 7 × 96 intervals = 673
    expect(lines).toHaveLength(7 * INTERVALS_PER_DAY + 1);
  });

  test('download CSV header matches EDM column spec', async () => {
    const created = await broker.call('energy-sharing-allocation.allocate', makeAllocateParams());
    const csv = await broker.call('energy-sharing-allocation.download', {
      id: created.id,
      maloId: CONSUMER_A.maloId,
      format: 'csv',
    });
    expect(csv.split('\n')[0]).toBe(
      'timestamp;generation_kwh;redispatch_deduction_kwh;net_generation_kwh;allocation_kwh'
    );
  });

  test('download returns 404 for maloId not in allocation', async () => {
    const created = await broker.call('energy-sharing-allocation.allocate', makeAllocateParams());
    const result = await broker.call('energy-sharing-allocation.download', {
      id: created.id,
      maloId: 'DE0005555555555555555555555555555',
      format: 'csv',
    });
    expect(result.success).toBe(false);
    expect(result.message).toMatch(/not part of/);
  });

  test('download returns 404 for soft-deleted allocation', async () => {
    const created = await broker.call('energy-sharing-allocation.allocate', makeAllocateParams());
    await broker.call('energy-sharing-allocation.remove', { id: created.id });

    const result = await broker.call('energy-sharing-allocation.download', {
      id: created.id,
      maloId: CONSUMER_A.maloId,
    });
    expect(result.success).toBe(false);
    expect(result.message).toMatch(/deleted/);
  });
});
