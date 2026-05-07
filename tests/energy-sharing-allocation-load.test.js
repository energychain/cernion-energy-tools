'use strict';

/**
 * tests/energy-sharing-allocation-load.test.js
 *
 * Sub-Track D — Allokations-Engine Last-Test (v0.47.0)
 *
 * Tests:
 *   1. CSV-Export deterministisch (Byte-identisch bei Wiederholung)
 *   2. SLA-Prüfung: 365d × 96 Slots × 100 Consumer × 20 Generator unter 30s p95
 *      (vereinfacht: 30d × 96 Slots × 100 Consumer × 5 Generator in Jest-Umgebung,
 *       da Volltest nur in Perf-Umgebung — Kommentar mit echten SLA-Zielwerten)
 *   3. Memory-Peak unter 512MB für 30-Tage-Lauf
 *   4. Worker-Pool: ALLOC_MAX_WORKERS env var dokumentiert (Konformitäts-Check)
 *
 * Regulatory basis: § 42c EnWG, § 12 StromNZV
 */

const {
  buildIntervalGrid,
  mergeGeneratorForecasts,
  allocateTimeseries,
  buildConsumerSummary,
  formatAsCsv,
} = require('../src/timeseries-allocation');

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function buildGenerators(n) {
  return Array.from({ length: n }, (_, i) => ({
    mastrNummer: `SEE${String(i).padStart(12, '0')}`,
    sharePercent: parseFloat((100 / n).toFixed(4)),
  }));
}

function buildConsumers(n) {
  const sharePercent = parseFloat((100 / n).toFixed(4));
  return Array.from({ length: n }, (_, i) => ({
    maloId: `DE${String(i).padStart(31, '0')}`,
    sharePercent,
    name: `Consumer ${i}`,
  }));
}

/**
 * Build a synthetic generation grid with constant 1 kW per interval per generator.
 */
function buildSyntheticGrid(dateFrom, dateTo, generators) {
  const grid = buildIntervalGrid(dateFrom, dateTo);
  const genKwh = generators.length * 0.25; // 1 kW × 0.25 h = 0.25 kWh per generator per slot
  for (const slot of grid) {
    slot.generationKWh = genKwh;
    slot.redispatchDeductionKWh = 0;
    slot.netGenerationKWh = genKwh;
  }
  return grid;
}

// ---------------------------------------------------------------------------
// Test Suite
// ---------------------------------------------------------------------------

describe('Sub-Track D — Allocation Engine Load & Determinism Tests', () => {
  const DATE_FROM_30D = '2026-06-01';
  const DATE_TO_30D = '2026-06-30';
  const GENERATORS_5 = buildGenerators(5);
  const CONSUMERS_100 = buildConsumers(100);

  // ─────────────────────────────────────────────────────────────────────────
  // D-1: CSV-Export deterministisch (Byte-identisch bei Wiederholung)
  // ─────────────────────────────────────────────────────────────────────────
  describe('D-1: CSV Export Determinism', () => {
    test('formatAsCsv is byte-identical on two runs for same grid and maloId', () => {
      const generators = buildGenerators(2);
      const consumers = buildConsumers(5);
      const grid = buildSyntheticGrid(DATE_FROM_30D, '2026-06-07', generators);

      allocateTimeseries(grid, consumers);

      const maloId = consumers[0].maloId;
      const csv1 = formatAsCsv(grid, maloId);
      const csv2 = formatAsCsv(grid, maloId);

      expect(typeof csv1).toBe('string');
      expect(csv1.length).toBeGreaterThan(0);
      expect(csv1).toBe(csv2); // Byte-identical
    });

    test('CSV output is stable across independent grid computations with same seed', () => {
      const generators = buildGenerators(3);
      const consumers = buildConsumers(10);
      const maloId = consumers[2].maloId;

      function computeCsv() {
        const grid = buildSyntheticGrid(DATE_FROM_30D, '2026-06-03', generators);
        allocateTimeseries(grid, consumers);
        return formatAsCsv(grid, maloId);
      }

      const run1 = computeCsv();
      const run2 = computeCsv();
      expect(run1).toBe(run2);
    });

    test('CSV contains header row and data rows', () => {
      const generators = buildGenerators(1);
      const consumers = buildConsumers(2);
      const grid = buildSyntheticGrid('2026-06-01', '2026-06-02', generators);
      allocateTimeseries(grid, consumers);
      const csv = formatAsCsv(grid, consumers[0].maloId);

      const lines = csv.split('\n').filter((l) => l.trim().length > 0);
      expect(lines.length).toBeGreaterThan(1); // header + at least 1 data row
      // Header contains expected column names
      expect(lines[0]).toMatch(/ts|timestamp|time/i);
    });
  });

  // ─────────────────────────────────────────────────────────────────────────
  // D-2: Performance SLA (30 days in Jest, targeting 365d in production)
  //
  // Production target (measured outside CI):
  //   365d × 96 slots × 100 consumers × 20 generators → p95 < 30 000ms
  //
  // CI target (this test): 30d × 96 × 100 × 5 → < 10 000ms
  // ─────────────────────────────────────────────────────────────────────────
  describe('D-2: Performance SLA (CI subset)', () => {
    test('30d × 96 × 100 consumers × 5 generators completes under 10s', () => {
      const generators = buildGenerators(5);
      const consumers = buildConsumers(100);

      const t0 = Date.now();
      const grid = buildSyntheticGrid(DATE_FROM_30D, DATE_TO_30D, generators);
      allocateTimeseries(grid, consumers);
      buildConsumerSummary(grid, consumers);
      const elapsed = Date.now() - t0;

      // 30d = 2880 slots × 100 consumers × 5 generators
      expect(grid.length).toBe(30 * 96);
      expect(elapsed).toBeLessThan(10_000);

      console.log(
        `[D-2] 30d allocation: ${grid.length} slots × ${consumers.length} consumers × ${generators.length} generators — ${elapsed}ms`
      );
    });

    test('interval count matches 30d × 96 slots', () => {
      const grid = buildIntervalGrid(DATE_FROM_30D, DATE_TO_30D);
      expect(grid.length).toBe(30 * 96);
    });
  });

  // ─────────────────────────────────────────────────────────────────────────
  // D-3: Memory check (30-day run stays under 512 MB heap delta)
  // ─────────────────────────────────────────────────────────────────────────
  describe('D-3: Memory Profile', () => {
    test('30d grid for 100 consumers × 5 generators uses < 512 MB additional heap', () => {
      const generators = buildGenerators(5);
      const consumers = buildConsumers(100);

      if (global.gc) global.gc(); // Force GC if available (--expose-gc)
      const heapBefore = process.memoryUsage().heapUsed;

      const grid = buildSyntheticGrid(DATE_FROM_30D, DATE_TO_30D, generators);
      allocateTimeseries(grid, consumers);
      buildConsumerSummary(grid, consumers);

      const heapAfter = process.memoryUsage().heapUsed;
      const deltaMB = (heapAfter - heapBefore) / 1024 / 1024;

      console.log(`[D-3] Heap delta for 30d × 100 × 5: ${deltaMB.toFixed(1)} MB`);
      // Production target <1 GB; CI gate at 512 MB (conservative)
      expect(deltaMB).toBeLessThan(512);
    });
  });

  // ─────────────────────────────────────────────────────────────────────────
  // D-4: Share sum validation (allocation math correctness)
  // ─────────────────────────────────────────────────────────────────────────
  describe('D-4: Allocation Correctness', () => {
    test('total allocated kWh equals total generation kWh (lossless)', () => {
      const generators = buildGenerators(3);
      const consumers = buildConsumers(10);
      const grid = buildSyntheticGrid('2026-06-01', '2026-06-03', generators);

      allocateTimeseries(grid, consumers);
      const summaries = buildConsumerSummary(grid, consumers);

      const totalAlloc = summaries.reduce((s, c) => s + (c.totalKWh || 0), 0);
      const totalGen = grid.reduce((s, slot) => s + (slot.netGenerationKWh || 0), 0);

      // Allow floating-point tolerance
      expect(Math.abs(totalAlloc - totalGen)).toBeLessThan(totalGen * 0.001);
    });

    test('each consumer receives positive kWh', () => {
      const generators = buildGenerators(2);
      const consumers = buildConsumers(5);
      const grid = buildSyntheticGrid('2026-06-01', '2026-06-02', generators);

      allocateTimeseries(grid, consumers);
      const summaries = buildConsumerSummary(grid, consumers);

      for (const summary of summaries) {
        expect(summary.totalKWh).toBeGreaterThan(0);
      }
    });
  });

  // ─────────────────────────────────────────────────────────────────────────
  // D-5: Worker-Pool configuration conformance
  // ─────────────────────────────────────────────────────────────────────────
  describe('D-5: Worker-Pool Configuration', () => {
    test('ALLOC_MAX_WORKERS env var is documented (default undefined = sequential)', () => {
      // Allocation engine is currently single-threaded (sequential).
      // Worker-pool is opt-in via ALLOC_MAX_WORKERS for future parallelisation.
      // This test verifies the env var does not break allocation when set.
      const origEnv = process.env.ALLOC_MAX_WORKERS;
      process.env.ALLOC_MAX_WORKERS = '4';

      const generators = buildGenerators(2);
      const consumers = buildConsumers(5);
      const grid = buildSyntheticGrid('2026-06-01', '2026-06-02', generators);
      allocateTimeseries(grid, consumers);
      const summaries = buildConsumerSummary(grid, consumers);

      expect(summaries.length).toBe(5);

      if (origEnv === undefined) {
        delete process.env.ALLOC_MAX_WORKERS;
      } else {
        process.env.ALLOC_MAX_WORKERS = origEnv;
      }
    });
  });
});
