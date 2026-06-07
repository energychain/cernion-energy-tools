'use strict';

// Technology-specific dynamic-floor values (EUR/MWh), configurable via env vars.
const TECHNOLOGY_FLOORS_EUR_MWH = {
  solar: parseFloat(process.env.EEG_FLOOR_SOLAR_EUR_MWH ?? '0.0'),
  wind_onshore: parseFloat(process.env.EEG_FLOOR_WIND_ONSHORE_EUR_MWH ?? '1.5'),
  wind_offshore: parseFloat(process.env.EEG_FLOOR_WIND_OFFSHORE_EUR_MWH ?? '0.0'),
  biomass: parseFloat(process.env.EEG_FLOOR_BIOMASS_EUR_MWH ?? '0.0'),
};

// §51 consecutive negative-price threshold in hours (default: 6h).
const S51_NEG_HOURS_THRESHOLD = parseFloat(process.env.EEG_S51_CONSECUTIVE_NEG_HOURS ?? '6');

function round4(n) {
  return Math.round(n * 10000) / 10000;
}

function round2(n) {
  return Math.round(n * 100) / 100;
}

/**
 * Expand hourly price entries to 15-minute resolution by flat-holding the hour value
 * across all four quarter-hour slots. Already-quarterly entries pass through unchanged.
 * Deduplication ensures no double-counting when both granularities are mixed.
 */
function interpolatePricesToQuarterHour(prices) {
  const expanded = [];
  for (const entry of prices) {
    const ts = new Date(entry.timestamp);
    if (ts.getMinutes() === 0 && ts.getSeconds() === 0) {
      for (let q = 0; q < 4; q++) {
        expanded.push({
          timestamp: new Date(ts.getTime() + q * 15 * 60000).toISOString(),
          priceEurMwh: entry.priceEurMwh,
        });
      }
    } else {
      expanded.push({ timestamp: new Date(ts).toISOString(), priceEurMwh: entry.priceEurMwh });
    }
  }
  // Deduplicate: keep first occurrence per timestamp (quarterly entry wins over expansion).
  const seen = new Map();
  for (const e of expanded) {
    if (!seen.has(e.timestamp)) seen.set(e.timestamp, e);
  }
  return [...seen.values()].sort((a, b) => new Date(a.timestamp) - new Date(b.timestamp));
}

/**
 * Build an aligned array [{timestamp, priceEurMwh, volumeKwh}] from the quarter-hour
 * price series and the injection series. Missing injection slots default to 0 kWh.
 */
function alignInjectionToPrices(priceIntervals, injection) {
  const injMap = new Map();
  for (const entry of injection) {
    injMap.set(new Date(entry.timestamp).toISOString(), Number(entry.volumeKwh ?? 0));
  }
  return priceIntervals.map((p) => ({
    timestamp: p.timestamp,
    priceEurMwh: p.priceEurMwh,
    volumeKwh: injMap.get(p.timestamp) ?? 0,
  }));
}

function computeLiquidityRiskIndex(retainedCents, oldLawCents) {
  if (!oldLawCents || oldLawCents <= 0) return 'low';
  const ratio = retainedCents / oldLawCents;
  if (ratio >= 0.9) return 'low';
  if (ratio >= 0.7) return 'medium';
  return 'high';
}

const RULE_ARM_REASONS = {
  none: 'No clawback applies — market price is positive, above floor, and below AW.',
  negative_price: 'Market price is negative; full absolute-price burden is clawed back.',
  sub_floor: 'Market price is positive but below the technology-specific dynamic floor.',
  excess_profit: 'Market price exceeds the anzulegender Wert (AW); excess profit is clawed back.',
};

/**
 * Core EEG Claw-Back calculation.
 *
 * @param {object} asset   - { technology, capacityKw, awCentsPerKwh, commissioningDate }
 * @param {Array}  prices  - [{ timestamp, priceEurMwh }]
 * @param {Array}  injection - [{ timestamp, volumeKwh }]
 * @param {object} [options]
 * @param {object} [options.ruleSet]                    - Versioned rule set; overrides env defaults.
 * @param {boolean} [options.includeIntervalTrace=true] - Set false to omit intervals (smaller payload).
 * @returns {{ summary, intervals?, ruleSetId?, ruleSetVersion? }}
 */
function runCalculation(asset, prices, injection, options = {}) {
  const { ruleSet, includeIntervalTrace = true } = options;

  const awCentsPerKwh = Number(asset.awCentsPerKwh);

  // Resolve floors + threshold: rule set parameters take priority over env-var constants.
  const floors = ruleSet?.parameters?.technologyFloors ?? TECHNOLOGY_FLOORS_EUR_MWH;
  const s51Threshold = ruleSet?.parameters?.s51ConsecutiveNegHours ?? S51_NEG_HOURS_THRESHOLD;

  const floorEurMwh = floors[asset.technology] ?? 0;
  const floorCentsKwh = floorEurMwh / 10;

  const priceIntervals = interpolatePricesToQuarterHour(prices);
  const aligned = alignInjectionToPrices(priceIntervals, injection);

  // Running accumulators
  let totalVolumeKwh = 0;
  // §51 Scenario A (old law)
  let totalRevenueCentsA = 0;
  let curtailedIntervalsCount = 0;
  // EEG 2027 Scenario B (new law)
  let totalRbCents = 0;
  let totalRetainedCentsB = 0;
  let clawbackTriggeredIntervalsCount = 0;

  const intervals = [];
  let negativeHoursAccum = 0; // accumulated consecutive negative-price hours

  for (const entry of aligned) {
    const { timestamp, priceEurMwh, volumeKwh } = entry;
    const priceCentsPerKwh = priceEurMwh / 10;
    totalVolumeKwh += volumeKwh;

    // ── Scenario A: §51 consecutive-negative-price curtailment ──────────
    if (priceCentsPerKwh < 0) {
      negativeHoursAccum += 0.25; // each 15-min interval = 0.25 h
    } else {
      negativeHoursAccum = 0;
    }
    const s51Active = priceCentsPerKwh < 0 && negativeHoursAccum >= s51Threshold;
    const payableVolumeA = s51Active ? 0 : volumeKwh;
    const revenueACents = payableVolumeA * awCentsPerKwh;
    totalRevenueCentsA += revenueACents;
    if (s51Active) curtailedIntervalsCount += 1;

    // ── Scenario B: EEG 2027 dynamic claw-back ──────────────────────────
    // RB_t = max(JW_t − AW_t, 0) × Q_t  (Anlage 4.2 interpretation):
    //   • price < 0              → negative-price burden
    //   • floor > price ≥ 0     → sub-floor adjustment
    //   • price > AW             → excess-profit
    let rbCents = 0;
    let clawbackActive = false;
    let ruleArm = 'none';

    if (priceCentsPerKwh < 0) {
      rbCents = Math.abs(priceCentsPerKwh) * volumeKwh;
      clawbackActive = true;
      ruleArm = 'negative_price';
    } else if (floorCentsKwh > 0 && priceCentsPerKwh < floorCentsKwh) {
      rbCents = (floorCentsKwh - priceCentsPerKwh) * volumeKwh;
      clawbackActive = true;
      ruleArm = 'sub_floor';
    } else if (priceCentsPerKwh > awCentsPerKwh) {
      rbCents = (priceCentsPerKwh - awCentsPerKwh) * volumeKwh;
      clawbackActive = true;
      ruleArm = 'excess_profit';
    }

    const retainedCentsBInterval = awCentsPerKwh * volumeKwh - rbCents;
    totalRbCents += rbCents;
    totalRetainedCentsB += retainedCentsBInterval;
    if (clawbackActive) clawbackTriggeredIntervalsCount += 1;

    // Data quality: flag zero injection so summation traces remain unambiguous.
    const dataQualityFlags = volumeKwh === 0 ? ['zero_injection'] : [];

    intervals.push({
      timestamp,
      injectionKwh: round4(volumeKwh),
      priceEurMwh: round4(priceEurMwh),
      priceCentsPerKwh: round4(priceCentsPerKwh),
      technology: asset.technology,
      technologyFloorEurMwh: round4(floorEurMwh),
      technologyFloorCentsPerKwh: round4(floorCentsKwh),
      awCentsPerKwh: round4(awCentsPerKwh),
      s51Active,
      clawbackActive,
      ruleArm,
      ruleArmReason: RULE_ARM_REASONS[ruleArm],
      // EUR amounts: baseline = what old law would pay; clawback = RB burden; delta = retained − baseline
      baselineAmountEur: round4(revenueACents / 100),
      clawbackAmountEur: round4(rbCents / 100),
      retainedAmountEur: round4(retainedCentsBInterval / 100),
      deltaEur: round4((retainedCentsBInterval - revenueACents) / 100),
      dataQualityFlags,
    });
  }

  const summary = {
    totalVolumeKwh: round2(totalVolumeKwh),
    calculatedUnderOldLaw: {
      totalRevenueCents: round2(totalRevenueCentsA),
      marketPremiumCents: 0, // derived from monthly Marktwert — not computed here
      curtailedHoursCount: curtailedIntervalsCount * 0.25,
    },
    calculatedUnderNewLaw: {
      totalRefinancingContributionCents: round2(totalRbCents),
      retainedRevenueCents: round2(totalRetainedCentsB),
      clawbackTriggeredIntervalsCount,
    },
    deltaCents: round2(totalRetainedCentsB - totalRevenueCentsA),
    liquidityRiskIndex: computeLiquidityRiskIndex(totalRetainedCentsB, totalRevenueCentsA),
  };

  const result = { summary };
  if (includeIntervalTrace) result.intervals = intervals;
  if (ruleSet?.id) result.ruleSetId = ruleSet.id;
  if (ruleSet?.version) result.ruleSetVersion = ruleSet.version;
  return result;
}

module.exports = {
  runCalculation,
  interpolatePricesToQuarterHour,
  alignInjectionToPrices,
  computeLiquidityRiskIndex,
  TECHNOLOGY_FLOORS_EUR_MWH,
  S51_NEG_HOURS_THRESHOLD,
  RULE_ARM_REASONS,
};
