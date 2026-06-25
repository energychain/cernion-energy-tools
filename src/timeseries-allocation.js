'use strict';

/**
 * Timeseries Allocation — pure calculation module (v0.16.0)
 *
 * No I/O, no Moleculer dependencies, no MCP calls.
 * All functions are deterministic: identical inputs → identical outputs.
 *
 * Regulatory basis: § 42c EnWG, § 12 StromNZV (15-min resolution).
 */

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

/** Duration of one allocation interval in milliseconds (15 minutes). */
const INTERVAL_MS = 15 * 60 * 1000;

/** Number of 15-min intervals per day. */
const INTERVALS_PER_DAY = 96;

/** Recommended maximum window in days (soft limit — triggers warning, not abort). */
const RECOMMENDED_MAX_DAYS = 31;

// ---------------------------------------------------------------------------
// Exports
// ---------------------------------------------------------------------------

module.exports = {
  INTERVAL_MS,
  INTERVALS_PER_DAY,
  RECOMMENDED_MAX_DAYS,
  round4,
  buildIntervalGrid,
  mergeGeneratorForecasts,
  applyRedispatchDeductions,
  allocateTimeseries,
  allocateTimeseriesCappedByConsumption,
  buildConsumerSummary,
  buildConsumptionAwareConsumerSummary,
  buildTotalSummary,
  formatAsCsv,
};

// ---------------------------------------------------------------------------
// round4
// ---------------------------------------------------------------------------

/**
 * Round a number to 4 decimal places (kWh billing accuracy).
 * @param {number} n
 * @returns {number}
 */
function round4(n) {
  return Math.round(n * 10000) / 10000;
}

// ---------------------------------------------------------------------------
// buildIntervalGrid
// ---------------------------------------------------------------------------

/**
 * Build an empty array of 15-min interval skeletons between two ISO-8601 dates
 * (inclusive of `dateFrom` 00:00:00Z, exclusive of `dateTo+1` 00:00:00Z).
 *
 * Each interval carries zero-values so callers can merge data in later steps.
 *
 * @param {string} dateFrom  — ISO-8601 date string, e.g. "2026-06-01"
 * @param {string} dateTo    — ISO-8601 date string, e.g. "2026-06-07"
 * @returns {Array<{timestamp: string, generationKWh: number, redispatchDeductionKWh: number, netGenerationKWh: number}>}
 */
function buildIntervalGrid(dateFrom, dateTo) {
  const start = new Date(`${dateFrom}T00:00:00Z`).getTime();
  // dateTo is inclusive — advance to end of that day
  const end = new Date(`${dateTo}T00:00:00Z`).getTime() + 24 * 60 * 60 * 1000;

  const intervals = [];
  for (let t = start; t < end; t += INTERVAL_MS) {
    intervals.push({
      timestamp: new Date(t).toISOString(),
      generationKWh: 0,
      redispatchDeductionKWh: 0,
      netGenerationKWh: 0,
    });
  }
  return intervals;
}

// ---------------------------------------------------------------------------
// mergeGeneratorForecasts
// ---------------------------------------------------------------------------

/**
 * Merge one or more generator forecast arrays into a single interval grid,
 * weighted by each generator's sharePercent.
 *
 * Forecast values are expected in MW per 15-min interval.
 * They are converted to kWh: MW × 0.25h = kWh.
 *
 * @param {Array<{timestamp: string, generationKWh: number, generationMW?: number}>} grid
 *   — The base interval grid produced by `buildIntervalGrid`.
 * @param {Array<{sharePercent: number, forecastIntervals: Array<{timestamp: string, generationMW?: number, generationKWh?: number}>}>} generators
 *   — One entry per generator. `forecastIntervals` contains the raw forecast data.
 * @returns {Array} — The same grid array, mutated with summed generationKWh values.
 */
function mergeGeneratorForecasts(grid, generators) {
  // Build a lookup map from timestamp → grid index for O(1) merging
  const indexMap = new Map();
  for (let i = 0; i < grid.length; i++) {
    indexMap.set(grid[i].timestamp, i);
  }

  for (const gen of generators) {
    if (!gen.forecastIntervals || gen.forecastIntervals.length === 0) continue;
    const weight = (gen.sharePercent || 100) / 100;

    for (const fi of gen.forecastIntervals) {
      const idx = indexMap.get(fi.timestamp);
      if (idx === undefined) continue;

      // Accept pre-converted kWh or raw MW (convert MW → kWh for 15-min interval)
      const kwh =
        fi.generationKWh != null
          ? fi.generationKWh
          : fi.generationMW != null
            ? fi.generationMW * 0.25
            : 0;

      grid[idx].generationKWh = round4(grid[idx].generationKWh + kwh * weight);
    }
  }

  // Compute netGenerationKWh (redispatch starts at 0 here; applied separately)
  for (const interval of grid) {
    interval.netGenerationKWh = round4(interval.generationKWh - interval.redispatchDeductionKWh);
  }

  return grid;
}

// ---------------------------------------------------------------------------
// applyRedispatchDeductions
// ---------------------------------------------------------------------------

/**
 * Apply redispatch deductions to intervals that fall within curtailment windows.
 *
 * Conservative approach (v0.16): if a curtailment window overlaps an interval
 * timestamp, the full generation for that interval is set to 0 (worst-case).
 * The `redispatchDeductionKWh` field records the amount subtracted.
 *
 * @param {Array} grid — interval grid (mutated in-place)
 * @param {Array<{startTime: string, endTime: string}>} curtailmentWindows
 *   — Each entry has ISO-8601 `startTime` and `endTime`.
 * @returns {Array} — the same grid, mutated.
 */
function applyRedispatchDeductions(grid, curtailmentWindows) {
  if (!curtailmentWindows || curtailmentWindows.length === 0) return grid;

  // Pre-parse windows once
  const windows = curtailmentWindows.map((w) => ({
    start: new Date(w.startTime).getTime(),
    end: new Date(w.endTime).getTime(),
  }));

  for (const interval of grid) {
    const t = new Date(interval.timestamp).getTime();
    const tEnd = t + INTERVAL_MS;

    const overlaps = windows.some((w) => t < w.end && tEnd > w.start);
    if (overlaps && interval.generationKWh > 0) {
      interval.redispatchDeductionKWh = round4(interval.generationKWh);
      interval.netGenerationKWh = 0;
    } else {
      interval.netGenerationKWh = round4(interval.generationKWh - interval.redispatchDeductionKWh);
    }
  }

  return grid;
}

// ---------------------------------------------------------------------------
// allocateTimeseries
// ---------------------------------------------------------------------------

/**
 * Core allocation step — distributes net generation per interval across consumers
 * according to their sharePercent.
 *
 * Rounding strategy:
 *   - Each consumer (except the last) receives: round4(net × share / 100)
 *   - The LAST consumer receives the remainder: net − ∑previous allocations
 *     (Restmengenempfänger pattern — guarantees ∑allocations = netGenerationKWh)
 *
 * @param {Array} grid — interval grid with netGenerationKWh filled
 * @param {Array<{maloId: string, sharePercent: number, name?: string}>} consumers
 * @returns {Array} — same grid, each interval now has an `allocations` object
 *   keyed by maloId → kWh (rounded to 4 dp).
 */
function allocateTimeseries(grid, consumers) {
  if (!consumers || consumers.length === 0) return grid;

  for (const interval of grid) {
    const net = interval.netGenerationKWh;
    const allocations = {};
    let allocated = 0;

    for (let i = 0; i < consumers.length; i++) {
      const consumer = consumers[i];
      if (i === consumers.length - 1) {
        // Last consumer: assign remainder to eliminate rounding drift
        allocations[consumer.maloId] = round4(net - allocated);
      } else {
        const share = round4((net * consumer.sharePercent) / 100);
        allocations[consumer.maloId] = share;
        allocated += share;
      }
    }

    interval.allocations = allocations;
  }

  return grid;
}

// ---------------------------------------------------------------------------
// allocateTimeseriesCappedByConsumption
// ---------------------------------------------------------------------------

/**
 * Consumption-capped allocation (issue #282, gap identified in #280's gap
 * analysis): like `allocateTimeseries`, but a consumer's actual measured
 * consumption per interval caps how much of their quota share they actually
 * receive — the defining behavior of a real internal-PV-sharing model that
 * the plain quota split in `allocateTimeseries` does not have.
 *
 * Per interval, per consumer:
 *   quotaKWh     = same percentage split as `allocateTimeseries`
 *                  (remainder-to-last-consumer rounding — Σquota = net exactly)
 *   allocatedKWh = round4(min(quotaKWh, consumptionKWh))
 *   surplusKWh   = round4(quotaKWh - allocatedKWh)   — quota the consumer did
 *                  not use this interval (their "unclaimed" solar share)
 *   deficitKWh   = round4(consumptionKWh - allocatedKWh) — consumption not
 *                  covered by their solar share (grid draw)
 *
 * Invariant: Σ(allocatedKWh) + Σ(surplusKWh) = Σ(quotaKWh) = netGenerationKWh
 * (within round4's 4-decimal-place tolerance). `deficitKWh` is NOT part of
 * this invariant — it is independent grid consumption, not generation.
 *
 * Missing consumption data for a consumer/interval (no EDM row for that
 * timestamp — see #281's stepFetchConsumptionEdm) is NOT treated as zero
 * consumption. It falls back to the consumer's full quota for that interval
 * (allocatedKWh = quotaKWh, surplusKWh = 0) and marks `consumptionDataMissing
 * = true` for that interval/consumer — deficit is `null` (unknown), never 0,
 * since we have no basis to claim there was no grid draw.
 *
 * Cross-participant redistribution of one consumer's surplus to another
 * consumer's deficit is deliberately NOT implemented here — the #282 issue
 * scoped that as a separate, open design question (priority vs. proportional
 * vs. configurable redistribution order). `surplusKWh`/`deficitKWh` are
 * reported per consumer; redistributing them is left to a future iteration.
 *
 * @param {Array} grid — interval grid with netGenerationKWh filled (same shape
 *   `allocateTimeseries` expects)
 * @param {Array<{maloId: string, sharePercent: number, name?: string}>} consumers
 * @param {Map<string, Array<{ts: string, value: number}>>} consumptionByMalo
 *   — per-consumer consumption series, e.g. from #281's stepFetchConsumptionEdm
 * @returns {Array} — same grid, each interval now additionally has
 *   `quotaAllocations`, `cappedAllocations`, `surplus`, `deficit`, and
 *   `consumptionDataMissing` objects (all keyed by maloId). The pre-existing
 *   `allocations` field (if `allocateTimeseries` was also run on this grid)
 *   is left untouched.
 */
function allocateTimeseriesCappedByConsumption(grid, consumers, consumptionByMalo) {
  if (!consumers || consumers.length === 0) return grid;

  // Per-consumer timestamp → value lookup, built once.
  const consumptionIndex = new Map();
  for (const consumer of consumers) {
    const series = consumptionByMalo?.get(consumer.maloId) || [];
    const byTimestamp = new Map();
    for (const row of series) {
      byTimestamp.set(row.ts, Number(row.value) || 0);
    }
    consumptionIndex.set(consumer.maloId, byTimestamp);
  }

  for (const interval of grid) {
    const net = interval.netGenerationKWh;

    // Step A: quota shares — identical rule to allocateTimeseries (remainder
    // to the last consumer, guarantees Σquota = net exactly).
    const quotaAllocations = {};
    let quotaAllocated = 0;
    for (let i = 0; i < consumers.length; i++) {
      const consumer = consumers[i];
      if (i === consumers.length - 1) {
        quotaAllocations[consumer.maloId] = round4(net - quotaAllocated);
      } else {
        const share = round4((net * consumer.sharePercent) / 100);
        quotaAllocations[consumer.maloId] = share;
        quotaAllocated += share;
      }
    }

    // Step B: cap each consumer's quota at their actual consumption.
    const cappedAllocations = {};
    const surplus = {};
    const deficit = {};
    const consumptionDataMissing = {};

    for (const consumer of consumers) {
      const quotaKWh = quotaAllocations[consumer.maloId];
      const byTimestamp = consumptionIndex.get(consumer.maloId);
      const consumptionKWh = byTimestamp ? byTimestamp.get(interval.timestamp) : undefined;

      if (consumptionKWh === undefined) {
        cappedAllocations[consumer.maloId] = quotaKWh;
        surplus[consumer.maloId] = 0;
        deficit[consumer.maloId] = null;
        consumptionDataMissing[consumer.maloId] = true;
        continue;
      }

      const allocated = round4(Math.min(quotaKWh, consumptionKWh));
      cappedAllocations[consumer.maloId] = allocated;
      surplus[consumer.maloId] = round4(quotaKWh - allocated);
      deficit[consumer.maloId] = round4(consumptionKWh - allocated);
      consumptionDataMissing[consumer.maloId] = false;
    }

    interval.quotaAllocations = quotaAllocations;
    interval.cappedAllocations = cappedAllocations;
    interval.surplus = surplus;
    interval.deficit = deficit;
    interval.consumptionDataMissing = consumptionDataMissing;
  }

  return grid;
}

// ---------------------------------------------------------------------------
// buildConsumerSummary
// ---------------------------------------------------------------------------

/**
 * Aggregate per-consumer statistics across all intervals.
 *
 * @param {Array} grid — fully allocated interval grid
 * @param {Array<{maloId: string, sharePercent: number, name?: string}>} consumers
 * @returns {Array<{maloId, name, sharePercent, totalKWh, peakKW, zeroIntervals, intervalCount, avgKWhPerInterval}>}
 */
function buildConsumerSummary(grid, consumers) {
  return consumers.map((consumer) => {
    let totalKWh = 0;
    let peakKWh = 0;
    let zeroIntervals = 0;

    for (const interval of grid) {
      const kwh = interval.allocations?.[consumer.maloId] ?? 0;
      totalKWh += kwh;
      if (kwh > peakKWh) peakKWh = kwh;
      if (kwh === 0) zeroIntervals++;
    }

    const count = grid.length;
    return {
      maloId: consumer.maloId,
      name: consumer.name || null,
      sharePercent: consumer.sharePercent,
      totalKWh: round4(totalKWh),
      // kW = kWh / 0.25h (15-min interval → multiply by 4)
      peakKW: round4(peakKWh * 4),
      zeroIntervals,
      intervalCount: count,
      avgKWhPerInterval: count > 0 ? round4(totalKWh / count) : 0,
    };
  });
}

// ---------------------------------------------------------------------------
// buildConsumptionAwareConsumerSummary
// ---------------------------------------------------------------------------

/**
 * Aggregate per-consumer Restmenge/Überschuss statistics over a fully
 * allocated grid (issue #283, gap identified in #280's gap analysis —
 * builds on #282's allocateTimeseriesCappedByConsumption per-interval
 * output: `cappedAllocations`, `surplus`, `deficit`, `consumptionDataMissing`).
 *
 * Aggregates are computed over KNOWN intervals only (where consumption data
 * existed for that consumer) — intervals with `consumptionDataMissing` are
 * excluded from the sums, not treated as zero consumption. This keeps the
 * consistency invariant exact: allocatedKWh + remainderKWh = consumptionKWh.
 *
 * If a consumer has ZERO known intervals across the whole period (no
 * consumption data at all), every consumption-derived field is `null` — never
 * silently 0 — per the issue's explicit requirement that "not computable"
 * must not be masked as zero. `dataCompleteness` always reports the interval
 * counts so a caller can see partial coverage even when some metrics are
 * still computable from the intervals that do have data.
 *
 * @param {Array} grid — grid that has been run through
 *   allocateTimeseriesCappedByConsumption (#282)
 * @param {Array<{maloId: string, sharePercent: number, name?: string}>} consumers
 * @returns {Array<{maloId, name, allocatedKWh, surplusKWh, remainderKWh,
 *   consumptionKWh, solarSharePercent, dataCompleteness}>}
 */
function buildConsumptionAwareConsumerSummary(grid, consumers) {
  return consumers.map((consumer) => {
    let allocatedKWh = 0;
    let surplusKWh = 0;
    let remainderKWh = 0;
    let knownIntervals = 0;
    let missingIntervals = 0;

    for (const interval of grid) {
      const missing = interval.consumptionDataMissing?.[consumer.maloId];
      if (missing) {
        missingIntervals++;
        continue;
      }
      knownIntervals++;
      allocatedKWh += interval.cappedAllocations?.[consumer.maloId] ?? 0;
      surplusKWh += interval.surplus?.[consumer.maloId] ?? 0;
      remainderKWh += interval.deficit?.[consumer.maloId] ?? 0;
    }

    const hasAnyData = knownIntervals > 0;
    const consumptionKWh = hasAnyData ? round4(allocatedKWh + remainderKWh) : null;
    // consumptionKWh === 0 (genuinely zero measured usage, e.g. vacant period) makes the
    // ratio 0/0 — mathematically undefined, reported as null rather than a misleading 0%.
    const solarSharePercent =
      hasAnyData && consumptionKWh > 0
        ? round4((round4(allocatedKWh) / consumptionKWh) * 100)
        : null;

    return {
      maloId: consumer.maloId,
      name: consumer.name || null,
      allocatedKWh: hasAnyData ? round4(allocatedKWh) : null,
      surplusKWh: hasAnyData ? round4(surplusKWh) : null,
      remainderKWh: hasAnyData ? round4(remainderKWh) : null,
      consumptionKWh,
      solarSharePercent,
      dataCompleteness: {
        totalIntervals: grid.length,
        knownIntervals,
        missingIntervals,
        complete: missingIntervals === 0,
      },
    };
  });
}

// ---------------------------------------------------------------------------
// buildTotalSummary
// ---------------------------------------------------------------------------

/**
 * Build the overall allocation summary.
 *
 * @param {Array} grid — fully allocated interval grid
 * @param {string} dateFrom
 * @param {string} dateTo
 * @param {string} dataSource — "forecast" | "inhouse"
 * @param {number} durationMs
 * @returns {object}
 */
function buildTotalSummary(grid, dateFrom, dateTo, dataSource, durationMs) {
  let totalGenerationKWh = 0;
  let totalRedispatchDeductionKWh = 0;
  let totalNetGenerationKWh = 0;

  for (const interval of grid) {
    totalGenerationKWh += interval.generationKWh;
    totalRedispatchDeductionKWh += interval.redispatchDeductionKWh;
    totalNetGenerationKWh += interval.netGenerationKWh;
  }

  return {
    totalGenerationKWh: round4(totalGenerationKWh),
    totalRedispatchDeductionKWh: round4(totalRedispatchDeductionKWh),
    totalNetGenerationKWh: round4(totalNetGenerationKWh),
    intervalCount: grid.length,
    dateFrom,
    dateTo,
    dataSource,
    durationMs,
  };
}

// ---------------------------------------------------------------------------
// formatAsCsv
// ---------------------------------------------------------------------------

/**
 * Render the time-series allocation for a single consumer as an EDM-importable
 * semicolon-delimited CSV string.
 *
 * Columns: timestamp;generation_kwh;redispatch_deduction_kwh;net_generation_kwh;allocation_kwh
 *
 * @param {Array} grid — fully allocated interval grid
 * @param {string} maloId — the consumer MaLo-ID to extract allocations for
 * @returns {string} — CSV string with header + one row per interval
 */
function formatAsCsv(grid, maloId) {
  const header =
    'timestamp;generation_kwh;redispatch_deduction_kwh;net_generation_kwh;allocation_kwh';
  const rows = grid.map((interval) => {
    const alloc = interval.allocations?.[maloId] ?? 0;
    return [
      interval.timestamp,
      interval.generationKWh.toFixed(4),
      interval.redispatchDeductionKWh.toFixed(4),
      interval.netGenerationKWh.toFixed(4),
      alloc.toFixed(4),
    ].join(';');
  });
  return [header, ...rows].join('\n');
}
