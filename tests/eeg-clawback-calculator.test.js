'use strict';

const {
  runCalculation,
  interpolatePricesToQuarterHour,
  TECHNOLOGY_FLOORS_EUR_MWH,
  RULE_ARM_REASONS,
} = require('../src/eeg-clawback-calculator');

// ── Helpers ───────────────────────────────────────────────────────────────────

function makeQhPrices(count, priceEurMwh, startTs = '2027-04-15T00:00:00Z') {
  const base = new Date(startTs).getTime();
  return Array.from({ length: count }, (_, i) => ({
    timestamp: new Date(base + i * 15 * 60000).toISOString(),
    priceEurMwh,
  }));
}

function makeInjection(prices, volumeKwh) {
  return prices.map((p) => ({ timestamp: p.timestamp, volumeKwh }));
}

// ─────────────────────────────────────────────────────────────────────────────
// Szenario 1: Konstante positive Preise — kein Clawback
// ─────────────────────────────────────────────────────────────────────────────
describe('eeg-clawback-calculator — Szenario 1: konstante positive Preise (50 EUR/MWh)', () => {
  // AW = 7.5 cents/kWh = 75 EUR/MWh > 50 EUR/MWh → price < AW → kein Clawback
  const asset = {
    technology: 'solar',
    capacityKw: 100,
    awCentsPerKwh: 7.5,
    commissioningDate: '2024-01-01',
  };
  const prices = makeQhPrices(96, 50); // 24h × 4 = 96 Intervalle
  const injection = makeInjection(prices, 10);

  let result;
  beforeAll(() => {
    result = runCalculation(asset, prices, injection);
  });

  test('totalRefinancingContributionCents ist exakt 0', () => {
    expect(result.summary.calculatedUnderNewLaw.totalRefinancingContributionCents).toBe(0);
  });

  test('kein Clawback-Intervall', () => {
    expect(result.summary.calculatedUnderNewLaw.clawbackTriggeredIntervalsCount).toBe(0);
  });

  test('clawbackActive ist für alle Intervalle false', () => {
    expect(result.intervals.every((iv) => !iv.clawbackActive)).toBe(true);
  });

  test('ruleArm ist "none" für alle Intervalle', () => {
    expect(result.intervals.every((iv) => iv.ruleArm === 'none')).toBe(true);
  });

  test('totalVolumeKwh korrekt', () => {
    expect(result.summary.totalVolumeKwh).toBeCloseTo(96 * 10, 2);
  });

  test('retainedRevenueCents entspricht AW × Gesamtmenge', () => {
    const expected = 96 * 10 * 7.5;
    expect(result.summary.calculatedUnderNewLaw.retainedRevenueCents).toBeCloseTo(expected, 2);
  });

  test('Summen-Rekonstruktion: aggregierte baselineAmountEur entspricht totalRevenueCents/100', () => {
    const sumBaseline = result.intervals.reduce((s, iv) => s + iv.baselineAmountEur, 0);
    expect(sumBaseline * 100).toBeCloseTo(
      result.summary.calculatedUnderOldLaw.totalRevenueCents,
      1
    );
  });

  test('Summen-Rekonstruktion: aggregierte clawbackAmountEur entspricht totalRefinancingContributionCents/100', () => {
    const sumClawback = result.intervals.reduce((s, iv) => s + iv.clawbackAmountEur, 0);
    expect(sumClawback * 100).toBeCloseTo(
      result.summary.calculatedUnderNewLaw.totalRefinancingContributionCents,
      1
    );
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// Szenario 2: 8 aufeinanderfolgende Negativpreis-Intervalle (−20 EUR/MWh)
// ─────────────────────────────────────────────────────────────────────────────
describe('eeg-clawback-calculator — Szenario 2: 8 aufeinanderfolgende Negativpreis-Intervalle', () => {
  const asset = {
    technology: 'solar',
    capacityKw: 500,
    awCentsPerKwh: 8.0,
    commissioningDate: '2023-06-01',
  };
  const negativePrices = makeQhPrices(8, -20, '2027-06-21T12:00:00Z');
  const positivePrices = makeQhPrices(8, 30, '2027-06-21T14:00:00Z');
  const prices = [...negativePrices, ...positivePrices];
  const injection = makeInjection(prices, 50);

  let result;
  beforeAll(() => {
    result = runCalculation(asset, prices, injection);
  });

  test('Clawback genau für 8 negative Intervalle aktiv', () => {
    expect(result.summary.calculatedUnderNewLaw.clawbackTriggeredIntervalsCount).toBe(8);
  });

  test('totalRefinancingContributionCents positiv', () => {
    expect(result.summary.calculatedUnderNewLaw.totalRefinancingContributionCents).toBeGreaterThan(
      0
    );
  });

  test('mathematischer Erwartungswert: negative Preise setzen Zahlung im MVP auf null', () => {
    const expectedRbCents = 8 * asset.awCentsPerKwh * 50;
    expect(result.summary.calculatedUnderNewLaw.totalRefinancingContributionCents).toBeCloseTo(
      expectedRbCents,
      2
    );
  });

  test('Retained Revenue ist in Negativpreisintervallen null', () => {
    const negIntervals = result.intervals.filter((iv) => iv.priceCentsPerKwh < 0);
    expect(negIntervals.every((iv) => iv.retainedAmountEur === 0)).toBe(true);
  });

  test('clawbackActive für alle 8 Negativpreisintervalle', () => {
    const negIntervals = result.intervals.filter((iv) => iv.priceCentsPerKwh < 0);
    expect(negIntervals.length).toBe(8);
    expect(negIntervals.every((iv) => iv.clawbackActive)).toBe(true);
  });

  test('ruleArm ist "negative_price" für alle negativen Intervalle', () => {
    const negIntervals = result.intervals.filter((iv) => iv.priceCentsPerKwh < 0);
    expect(negIntervals.every((iv) => iv.ruleArm === 'negative_price')).toBe(true);
  });

  test('Positive Preisintervalle: kein Clawback (Preis 3 c/kWh < AW 8 c/kWh)', () => {
    const posIntervals = result.intervals.filter((iv) => iv.priceCentsPerKwh > 0);
    expect(posIntervals.every((iv) => !iv.clawbackActive)).toBe(true);
  });

  test('ruleArmReason ist für negative_price gesetzt', () => {
    const negInterval = result.intervals.find((iv) => iv.ruleArm === 'negative_price');
    expect(typeof negInterval.ruleArmReason).toBe('string');
    expect(negInterval.ruleArmReason.length).toBeGreaterThan(0);
  });

  test('dataQualityFlags ist leer wenn Einspeisung > 0', () => {
    expect(result.intervals.every((iv) => iv.dataQualityFlags.length === 0)).toBe(true);
  });

  test('Intervall-Felder vollständig: injectionKwh, priceEurMwh, technology vorhanden', () => {
    const iv = result.intervals[0];
    expect(typeof iv.injectionKwh).toBe('number');
    expect(typeof iv.priceEurMwh).toBe('number');
    expect(iv.technology).toBe('solar');
    expect(typeof iv.awCentsPerKwh).toBe('number');
    expect(typeof iv.s51Active).toBe('boolean');
    expect(Array.isArray(iv.dataQualityFlags)).toBe(true);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// Szenario 3: Dynamic Floor (Mindesterlös Wind Onshore)
// ─────────────────────────────────────────────────────────────────────────────
describe('eeg-clawback-calculator — Szenario 3: dynamic floor (Wind Onshore)', () => {
  const floorEurMwh = TECHNOLOGY_FLOORS_EUR_MWH.wind_onshore; // 1.5 EUR/MWh env default
  const floorCentsKwh = floorEurMwh / 10;
  const asset = {
    technology: 'wind_onshore',
    capacityKw: 2000,
    awCentsPerKwh: 9.0,
    commissioningDate: '2022-03-15',
  };
  const volumeKwh = 100;

  function priceToInterval(priceEurMwh) {
    return runCalculation(
      asset,
      [{ timestamp: '2027-04-01T08:00:00Z', priceEurMwh }],
      [{ timestamp: '2027-04-01T08:00:00Z', volumeKwh }]
    ).intervals[0];
  }

  test('Preis knapp über Floor: kein Clawback', () => {
    const iv = priceToInterval(floorEurMwh + 0.1);
    expect(iv.clawbackActive).toBe(false);
    expect(iv.clawbackAmountEur).toBe(0);
  });

  test('Preis genau auf Floor: kein Clawback (Grenzwert)', () => {
    const iv = priceToInterval(floorEurMwh);
    expect(iv.clawbackActive).toBe(false);
  });

  test('Preis knapp unter Floor: sub_floor Clawback greift', () => {
    const iv = priceToInterval(floorEurMwh - 0.1);
    expect(iv.clawbackActive).toBe(true);
    expect(iv.ruleArm).toBe('sub_floor');
    expect(iv.clawbackAmountEur).toBeGreaterThan(0);
  });

  test('clawbackAmountEur bei sub-floor entspricht mathematischem Erwartungswert', () => {
    const belowFloor = floorEurMwh - 0.5; // 1.0 EUR/MWh = 0.1 cents/kWh
    const iv = priceToInterval(belowFloor);
    const expectedRbCents = (floorCentsKwh - belowFloor / 10) * volumeKwh;
    expect(iv.clawbackAmountEur * 100).toBeCloseTo(expectedRbCents, 4);
  });

  test('Preis über AW: excess_profit Clawback', () => {
    const iv = priceToInterval(95); // 95 EUR/MWh = 9.5 c/kWh > AW 9.0
    expect(iv.clawbackActive).toBe(true);
    expect(iv.ruleArm).toBe('excess_profit');
    const expectedRbCents = (9.5 - asset.awCentsPerKwh) * volumeKwh;
    expect(iv.clawbackAmountEur * 100).toBeCloseTo(expectedRbCents, 4);
  });

  test('Biomasse ist vom Refinanzierungsbeitrag ausgenommen', () => {
    const biomassAsset = {
      technology: 'biomass',
      capacityKw: 500,
      awCentsPerKwh: 9.0,
      commissioningDate: '2022-03-15',
    };
    const result = runCalculation(
      biomassAsset,
      [{ timestamp: '2027-04-01T08:00:00Z', priceEurMwh: 120 }],
      [{ timestamp: '2027-04-01T08:00:00Z', volumeKwh }]
    );
    expect(result.intervals[0].refinancingEligible).toBe(false);
    expect(result.intervals[0].clawbackActive).toBe(false);
    expect(result.summary.calculatedUnderNewLaw.totalRefinancingContributionCents).toBe(0);
  });

  test('Anlagen unter 100 kW sind im MVP nicht refinanzierungsbeitragspflichtig', () => {
    const smallAsset = {
      technology: 'solar',
      capacityKw: 99,
      awCentsPerKwh: 9.0,
      commissioningDate: '2022-03-15',
    };
    const result = runCalculation(
      smallAsset,
      [{ timestamp: '2027-04-01T08:00:00Z', priceEurMwh: 120 }],
      [{ timestamp: '2027-04-01T08:00:00Z', volumeKwh }]
    );
    expect(result.intervals[0].refinancingEligible).toBe(false);
    expect(result.intervals[0].clawbackActive).toBe(false);
  });

  test('technologyFloorEurMwh und technologyFloorCentsPerKwh werden übergeben', () => {
    const iv = priceToInterval(floorEurMwh + 1);
    expect(iv.technologyFloorEurMwh).toBeCloseTo(floorEurMwh, 4);
    expect(iv.technologyFloorCentsPerKwh).toBeCloseTo(floorCentsKwh, 4);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// Interpolation: stündliche → viertelstündliche Auflösung
// ─────────────────────────────────────────────────────────────────────────────
describe('interpolatePricesToQuarterHour', () => {
  test('stündlicher Eintrag wird auf 4 Viertelstunden expandiert', () => {
    const input = [{ timestamp: '2027-04-01T12:00:00Z', priceEurMwh: 42 }];
    const result = interpolatePricesToQuarterHour(input);
    expect(result).toHaveLength(4);
    expect(result.every((e) => e.priceEurMwh === 42)).toBe(true);
    expect(result[1].timestamp).toBe('2027-04-01T12:15:00.000Z');
  });

  test('viertelstündlicher Eintrag passiert unverändert', () => {
    const input = [{ timestamp: '2027-04-01T12:15:00Z', priceEurMwh: 55 }];
    const result = interpolatePricesToQuarterHour(input);
    expect(result).toHaveLength(1);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// Audit-Grade Interval Trace — Summen-Rekonstruktion + Datenqualität
// ─────────────────────────────────────────────────────────────────────────────
describe('eeg-clawback-calculator — Audit-Grade Interval Trace', () => {
  const asset = {
    technology: 'solar',
    capacityKw: 100,
    awCentsPerKwh: 7.5,
    commissioningDate: '2024-01-01',
  };

  test('Summen-Rekonstruktion: ∑retainedAmountEur ≈ retainedRevenueCents/100', () => {
    const prices = makeQhPrices(96, 50);
    const injection = makeInjection(prices, 10);
    const result = runCalculation(asset, prices, injection);
    const sumRetained = result.intervals.reduce((s, iv) => s + iv.retainedAmountEur, 0);
    expect(sumRetained * 100).toBeCloseTo(
      result.summary.calculatedUnderNewLaw.retainedRevenueCents,
      0
    );
  });

  test('Summen-Rekonstruktion: ∑clawbackAmountEur ≈ totalRefinancingContributionCents/100', () => {
    const prices = makeQhPrices(8, -20);
    const injection = makeInjection(prices, 50);
    const result = runCalculation(asset, prices, injection);
    const sumClawback = result.intervals.reduce((s, iv) => s + iv.clawbackAmountEur, 0);
    expect(sumClawback * 100).toBeCloseTo(
      result.summary.calculatedUnderNewLaw.totalRefinancingContributionCents,
      0
    );
  });

  test('deltaEur = retainedAmountEur − baselineAmountEur pro Intervall', () => {
    const prices = makeQhPrices(4, -10);
    const injection = makeInjection(prices, 20);
    const result = runCalculation(asset, prices, injection);
    for (const iv of result.intervals) {
      expect(iv.deltaEur).toBeCloseTo(iv.retainedAmountEur - iv.baselineAmountEur, 6);
    }
  });

  test('dataQualityFlags enthält zero_injection wenn kWh = 0', () => {
    const prices = makeQhPrices(1, 50);
    const injection = [{ timestamp: prices[0].timestamp, volumeKwh: 0 }];
    const result = runCalculation(asset, prices, injection);
    expect(result.intervals[0].dataQualityFlags).toContain('zero_injection');
  });

  test('dataQualityFlags ist leer bei normaler Einspeisung', () => {
    const prices = makeQhPrices(1, 50);
    const injection = makeInjection(prices, 100);
    const result = runCalculation(asset, prices, injection);
    expect(result.intervals[0].dataQualityFlags).toHaveLength(0);
  });

  test('RULE_ARM_REASONS deckt alle 4 Arme ab', () => {
    expect(RULE_ARM_REASONS.none).toBeTruthy();
    expect(RULE_ARM_REASONS.negative_price).toBeTruthy();
    expect(RULE_ARM_REASONS.sub_floor).toBeTruthy();
    expect(RULE_ARM_REASONS.excess_profit).toBeTruthy();
  });

  test('ruleArmReason stimmt mit RULE_ARM_REASONS überein', () => {
    const prices = makeQhPrices(1, -10);
    const injection = makeInjection(prices, 10);
    const result = runCalculation(asset, prices, injection);
    expect(result.intervals[0].ruleArmReason).toBe(RULE_ARM_REASONS.negative_price);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// ruleSet parameter overrides env-var defaults
// ─────────────────────────────────────────────────────────────────────────────
describe('runCalculation — options.ruleSet overrides', () => {
  const asset = {
    technology: 'wind_onshore',
    capacityKw: 1000,
    awCentsPerKwh: 9.0,
    commissioningDate: '2022-01-01',
  };
  const prices = [{ timestamp: '2027-04-01T08:00:00Z', priceEurMwh: 1.7 }];
  const injection = [{ timestamp: '2027-04-01T08:00:00Z', volumeKwh: 100 }];

  test('without ruleSet: uses env-var floor (1.5) → price 1.7 above floor, no clawback', () => {
    const result = runCalculation(asset, prices, injection);
    expect(result.intervals[0].clawbackActive).toBe(false);
  });

  test('with ruleSet (floor=2.0): price 1.7 triggers sub_floor clawback', () => {
    const ruleSet = {
      id: 'eeg2027-draft-2026-06',
      version: '1.0.0',
      parameters: {
        s51ConsecutiveNegHours: 4,
        technologyFloors: { solar: 0, wind_onshore: 2.0, wind_offshore: 0.5, biomass: 1.0 },
      },
    };
    const result = runCalculation(asset, prices, injection, { ruleSet });
    expect(result.intervals[0].clawbackActive).toBe(true);
    expect(result.intervals[0].ruleArm).toBe('sub_floor');
  });

  test('ruleSetId und ruleSetVersion im Result', () => {
    const ruleSet = {
      id: 'eeg2027-draft-2026-06',
      version: '1.0.0',
      parameters: { s51ConsecutiveNegHours: 4, technologyFloors: { wind_onshore: 2.0 } },
    };
    const result = runCalculation(asset, prices, injection, { ruleSet });
    expect(result.ruleSetId).toBe('eeg2027-draft-2026-06');
    expect(result.ruleSetVersion).toBe('1.0.0');
  });

  test('ruleSet can override refinancing contribution threshold and exclusions', () => {
    const biomassAsset = {
      technology: 'biomass',
      capacityKw: 50,
      awCentsPerKwh: 9.0,
      commissioningDate: '2022-01-01',
    };
    const ruleSet = {
      id: 'eeg2027-test',
      version: '1.0.0',
      parameters: {
        s51ConsecutiveNegHours: 4,
        technologyFloors: { biomass: 0 },
        refinancingContribution: {
          minCapacityKw: 10,
          excludedTechnologies: [],
        },
      },
    };
    const result = runCalculation(
      biomassAsset,
      [{ timestamp: '2027-04-01T08:00:00Z', priceEurMwh: 120 }],
      [{ timestamp: '2027-04-01T08:00:00Z', volumeKwh: 100 }],
      { ruleSet }
    );
    expect(result.intervals[0].refinancingEligible).toBe(true);
    expect(result.intervals[0].ruleArm).toBe('excess_profit');
  });

  test('s51 threshold from ruleSet changes curtailed interval count', () => {
    const base = new Date('2027-04-01T08:00:00Z').getTime();
    const negPrices = Array.from({ length: 16 }, (_, i) => ({
      timestamp: new Date(base + i * 15 * 60000).toISOString(),
      priceEurMwh: -5,
    }));
    const negInjection = negPrices.map((p) => ({ timestamp: p.timestamp, volumeKwh: 10 }));

    const defaultResult = runCalculation(asset, negPrices, negInjection);
    const ruleSet4h = {
      id: 'eeg2027-4h-test',
      parameters: { s51ConsecutiveNegHours: 4, technologyFloors: { wind_onshore: 0.0 } },
    };
    const result4h = runCalculation(asset, negPrices, negInjection, { ruleSet: ruleSet4h });
    expect(result4h.summary.calculatedUnderOldLaw.curtailedHoursCount).toBeGreaterThan(
      defaultResult.summary.calculatedUnderOldLaw.curtailedHoursCount
    );
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// includeIntervalTrace flag
// ─────────────────────────────────────────────────────────────────────────────
describe('runCalculation — includeIntervalTrace option', () => {
  const asset = {
    technology: 'solar',
    capacityKw: 100,
    awCentsPerKwh: 7.5,
    commissioningDate: '2024-01-01',
  };

  test('includeIntervalTrace: false omits intervals', () => {
    const prices = makeQhPrices(4, 50);
    const injection = makeInjection(prices, 10);
    const result = runCalculation(asset, prices, injection, { includeIntervalTrace: false });
    expect(result.intervals).toBeUndefined();
    expect(result.summary).toBeDefined();
  });

  test('includeIntervalTrace: true (default) includes intervals with all fields', () => {
    const prices = makeQhPrices(4, 50);
    const injection = makeInjection(prices, 10);
    const result = runCalculation(asset, prices, injection, { includeIntervalTrace: true });
    expect(Array.isArray(result.intervals)).toBe(true);
    expect(result.intervals).toHaveLength(4);
    const iv = result.intervals[0];
    // All required audit fields present
    expect(iv).toHaveProperty('injectionKwh');
    expect(iv).toHaveProperty('priceEurMwh');
    expect(iv).toHaveProperty('priceCentsPerKwh');
    expect(iv).toHaveProperty('technology');
    expect(iv).toHaveProperty('technologyFloorEurMwh');
    expect(iv).toHaveProperty('technologyFloorCentsPerKwh');
    expect(iv).toHaveProperty('awCentsPerKwh');
    expect(iv).toHaveProperty('marketValueProxyCentsPerKwh');
    expect(iv).toHaveProperty('refinancingEligible');
    expect(iv).toHaveProperty('s51Active');
    expect(iv).toHaveProperty('clawbackActive');
    expect(iv).toHaveProperty('ruleArm');
    expect(iv).toHaveProperty('ruleArmReason');
    expect(iv).toHaveProperty('baselineAmountEur');
    expect(iv).toHaveProperty('clawbackAmountEur');
    expect(iv).toHaveProperty('retainedAmountEur');
    expect(iv).toHaveProperty('deltaEur');
    expect(iv).toHaveProperty('dataQualityFlags');
  });
});
