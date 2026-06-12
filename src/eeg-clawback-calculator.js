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
 * Normalize a timestamp string to UTC ISO-8601.
 * Strings without a timezone indicator are treated as UTC (not local time),
 * preventing DST ambiguity when providers omit the timezone offset.
 */
function normaliseTimestamp(ts) {
  if (typeof ts !== 'string') return new Date(Number(ts)).toISOString();
  // Already has timezone info (Z or ±HH:MM or ±HHmm)
  if (/Z$|[+-]\d{2}:?\d{2}$/.test(ts.trim())) return new Date(ts).toISOString();
  // No timezone: treat as UTC to avoid DST-ambiguous local-time parsing
  return new Date(ts + 'Z').toISOString();
}

/**
 * Expand hourly price entries to 15-minute resolution by flat-holding the hour value
 * across all four quarter-hour slots. Already-quarterly entries pass through unchanged.
 * Deduplication ensures no double-counting when both granularities are mixed.
 * DST-safe: all arithmetic is UTC-based; timestamps without timezone are treated as UTC.
 */
function interpolatePricesToQuarterHour(prices) {
  const expanded = [];
  for (const entry of prices) {
    const normTs = normaliseTimestamp(entry.timestamp);
    const ts = new Date(normTs);
    const ms = ts.getTime();
    // Detect hourly entries: minute and second are zero in UTC
    const minuteUtc = Math.floor((ms % 3600000) / 60000);
    const secondUtc = Math.floor((ms % 60000) / 1000);
    if (minuteUtc === 0 && secondUtc === 0) {
      for (let q = 0; q < 4; q++) {
        expanded.push({
          timestamp: new Date(ms + q * 15 * 60000).toISOString(),
          priceEurMwh: entry.priceEurMwh,
        });
      }
    } else {
      expanded.push({ timestamp: normTs, priceEurMwh: entry.priceEurMwh });
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
    injMap.set(normaliseTimestamp(entry.timestamp), Number(entry.volumeKwh ?? 0));
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
  none: 'No refinancing contribution applies for this interval under the current scenario assumptions.',
  negative_price:
    'Market price is negative; EEG payment claim/payment obligation is modelled as zero for this interval.',
  sub_floor: 'Market price is positive but below the technology-specific dynamic floor.',
  excess_profit:
    'Market value proxy exceeds the anzulegender Wert (AW); excess value is modelled as refinancing contribution.',
};

const DEFAULT_REFINANCING_CONFIG = {
  minCapacityKw: 100,
  excludedTechnologies: ['biomass'],
  marketValueMode: 'timeframe_weighted_average',
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
  const { ruleSet, includeIntervalTrace = true, maxIntervals } = options;

  const awCentsPerKwh = Number(asset.awCentsPerKwh);

  // Resolve floors + threshold: rule set parameters take priority over env-var constants.
  const floors = ruleSet?.parameters?.technologyFloors ?? TECHNOLOGY_FLOORS_EUR_MWH;
  const s51Threshold = ruleSet?.parameters?.s51ConsecutiveNegHours ?? S51_NEG_HOURS_THRESHOLD;
  const refinancingConfig = {
    ...DEFAULT_REFINANCING_CONFIG,
    ...(ruleSet?.parameters?.refinancingContribution ?? {}),
  };

  const floorEurMwh = floors[asset.technology] ?? 0;
  const floorCentsKwh = floorEurMwh / 10;
  const excludedTechnologies = new Set(refinancingConfig.excludedTechnologies ?? []);
  const refinancingEligible =
    Number(asset.capacityKw ?? 0) >= Number(refinancingConfig.minCapacityKw ?? 100) &&
    !excludedTechnologies.has(asset.technology);

  const priceIntervals = interpolatePricesToQuarterHour(prices);
  const fullAligned = alignInjectionToPrices(priceIntervals, injection);
  // maxIntervals caps both the price grid and injection in one place (used for large-portfolio chunking)
  const aligned = maxIntervals ? fullAligned.slice(0, maxIntervals) : fullAligned;

  const marketValueNumerator = aligned.reduce(
    (sum, entry) => sum + (entry.priceEurMwh / 10) * Math.max(0, Number(entry.volumeKwh ?? 0)),
    0
  );
  const marketValueDenominator = aligned.reduce(
    (sum, entry) => sum + Math.max(0, Number(entry.volumeKwh ?? 0)),
    0
  );
  const marketValueProxyCentsPerKwh =
    marketValueDenominator > 0 ? marketValueNumerator / marketValueDenominator : 0;
  const marketValueExcessCentsPerKwh = refinancingEligible
    ? Math.max(marketValueProxyCentsPerKwh - awCentsPerKwh, 0)
    : 0;

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

    // ── Scenario B: EEG 2027 scenario model ─────────────────────────────
    // MVP assumptions:
    //   • negative spot prices reduce the payment claim/payment obligation to zero
    //   • refinancing contribution applies from 100 kW unless the technology is excluded
    //   • annual market value is approximated by the weighted market value over the
    //     requested simulation timeframe (not a paragraph-exact legal calculation)
    let rbCents = 0;
    let clawbackActive = false;
    let ruleArm = 'none';
    let retainedCentsBInterval = awCentsPerKwh * volumeKwh;

    if (priceCentsPerKwh < 0) {
      rbCents = awCentsPerKwh * volumeKwh;
      retainedCentsBInterval = 0;
      clawbackActive = true;
      ruleArm = 'negative_price';
    } else if (refinancingEligible && floorCentsKwh > 0 && priceCentsPerKwh < floorCentsKwh) {
      rbCents = (floorCentsKwh - priceCentsPerKwh) * volumeKwh;
      retainedCentsBInterval = awCentsPerKwh * volumeKwh - rbCents;
      clawbackActive = true;
      ruleArm = 'sub_floor';
    } else if (marketValueExcessCentsPerKwh > 0) {
      rbCents = marketValueExcessCentsPerKwh * volumeKwh;
      retainedCentsBInterval = awCentsPerKwh * volumeKwh - rbCents;
      clawbackActive = true;
      ruleArm = 'excess_profit';
    }

    totalRbCents += rbCents;
    totalRetainedCentsB += retainedCentsBInterval;
    if (clawbackActive) clawbackTriggeredIntervalsCount += 1;

    // Data quality: flag anomalous injection values so traces remain unambiguous.
    const dataQualityFlags = [];
    if (volumeKwh === 0) dataQualityFlags.push('zero_injection');
    // Negative injection is metering data that inverts the expected energy flow direction.
    if (volumeKwh < 0) dataQualityFlags.push('negative_injection');

    intervals.push({
      timestamp,
      injectionKwh: round4(volumeKwh),
      priceEurMwh: round4(priceEurMwh),
      priceCentsPerKwh: round4(priceCentsPerKwh),
      technology: asset.technology,
      technologyFloorEurMwh: round4(floorEurMwh),
      technologyFloorCentsPerKwh: round4(floorCentsKwh),
      awCentsPerKwh: round4(awCentsPerKwh),
      marketValueProxyCentsPerKwh: round4(marketValueProxyCentsPerKwh),
      refinancingEligible,
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
    assumptions: {
      calculationBasis: 'mvp_scenario_model',
      marketValueMode: refinancingConfig.marketValueMode,
      marketValueProxyCentsPerKwh: round4(marketValueProxyCentsPerKwh),
      minCapacityKw: Number(refinancingConfig.minCapacityKw ?? 100),
      excludedTechnologies: [...excludedTechnologies],
      note: 'Approximates EEG-2027 draft effects for demo purposes; not a paragraph-exact legal calculation.',
    },
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
  normaliseTimestamp,
  computeLiquidityRiskIndex,
  TECHNOLOGY_FLOORS_EUR_MWH,
  S51_NEG_HOURS_THRESHOLD,
  RULE_ARM_REASONS,
};
