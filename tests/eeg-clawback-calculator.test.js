'use strict';

const {
  runCalculation,
  interpolatePricesToQuarterHour,
  TECHNOLOGY_FLOORS_EUR_MWH,
} = require('../src/eeg-clawback-calculator');

// ── Helper: build a flat price series of N intervals at a constant EUR/MWh ──
function makeQuarterHourPrices(count, priceEurMwh, startTs = '2027-04-15T00:00:00Z') {
  const base = new Date(startTs).getTime();
  return Array.from({ length: count }, (_, i) => ({
    timestamp: new Date(base + i * 15 * 60000).toISOString(),
    priceEurMwh,
  }));
}

// ── Helper: build a flat injection series (volumeKwh per 15-min slot) ──
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
  const prices = makeQuarterHourPrices(96, 50); // 24 Stunden × 4 = 96 Intervalle
  const injection = makeInjection(prices, 10); // 10 kWh/Viertelstunde

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

  test('isClawbackActive ist für alle Intervalle false', () => {
    expect(result.intervals.every((iv) => !iv.isClawbackActive)).toBe(true);
  });

  test('totalVolumeKwh korrekt', () => {
    expect(result.summary.totalVolumeKwh).toBeCloseTo(96 * 10, 2);
  });

  test('retainedRevenueCents entspricht AW × Gesamtmenge', () => {
    const expected = 96 * 10 * 7.5; // kWh × cents/kWh
    expect(result.summary.calculatedUnderNewLaw.retainedRevenueCents).toBeCloseTo(expected, 2);
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
  // 8 Viertelstunden bei −20 EUR/MWh, danach wieder positiv
  const negativePrices = makeQuarterHourPrices(8, -20, '2027-06-21T12:00:00Z');
  const positivePrices = makeQuarterHourPrices(8, 30, '2027-06-21T14:00:00Z');
  const prices = [...negativePrices, ...positivePrices];
  const injection = makeInjection(prices, 50); // 50 kWh/Viertelstunde

  let result;
  beforeAll(() => {
    result = runCalculation(asset, prices, injection);
  });

  test('Clawback tritt bei Negativpreisintervallen auf', () => {
    expect(result.summary.calculatedUnderNewLaw.clawbackTriggeredIntervalsCount).toBeGreaterThan(0);
  });

  test('Clawback genau für 8 negative Intervalle aktiv', () => {
    expect(result.summary.calculatedUnderNewLaw.clawbackTriggeredIntervalsCount).toBe(8);
  });

  test('totalRefinancingContributionCents ist positiv', () => {
    expect(result.summary.calculatedUnderNewLaw.totalRefinancingContributionCents).toBeGreaterThan(
      0
    );
  });

  test('mathematischer Erwartungswert: RB = abs(−2 cents/kWh) × 50 kWh × 8 Intervalle', () => {
    // priceCentsKwh = −20 / 10 = −2 cents/kWh
    // RB_t = abs(−2) × 50 = 100 cents pro Intervall
    // ∑RB = 8 × 100 = 800 cents
    const expectedRbCents = 8 * Math.abs(-20 / 10) * 50;
    expect(result.summary.calculatedUnderNewLaw.totalRefinancingContributionCents).toBeCloseTo(
      expectedRbCents,
      2
    );
  });

  test('Intervall-Protokoll: isClawbackActive für alle 8 Negativpreisintervalle', () => {
    const negIntervals = result.intervals.filter((iv) => iv.priceCentsKwh < 0);
    expect(negIntervals.length).toBe(8);
    expect(negIntervals.every((iv) => iv.isClawbackActive)).toBe(true);
  });

  test('Positive Preisintervalle haben keinen Clawback (Preis < AW)', () => {
    // 30 EUR/MWh = 3 cents/kWh < AW = 8 cents/kWh → kein Clawback
    const posIntervals = result.intervals.filter((iv) => iv.priceCentsKwh > 0);
    expect(posIntervals.every((iv) => !iv.isClawbackActive)).toBe(true);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// Szenario 3: Grenzpreis-Triggereffekt (Mindesterlös / dynamic floor)
// ─────────────────────────────────────────────────────────────────────────────
describe('eeg-clawback-calculator — Szenario 3: dynamic floor (Mindesterlös Wind Onshore)', () => {
  // Wind Onshore floor = 1.5 EUR/MWh = 0.15 cents/kWh
  const floorEurMwh = TECHNOLOGY_FLOORS_EUR_MWH.wind_onshore;
  const floorCentsKwh = floorEurMwh / 10;
  const asset = {
    technology: 'wind_onshore',
    capacityKw: 2000,
    awCentsPerKwh: 9.0,
    commissioningDate: '2022-03-15',
  };
  const volumeKwh = 100;

  // 4 Preisszenarien: knapp über Floor, genau auf Floor, knapp unter Floor, weit über AW
  function priceToInterval(priceEurMwh) {
    return runCalculation(
      asset,
      [{ timestamp: '2027-04-01T08:00:00Z', priceEurMwh }],
      [{ timestamp: '2027-04-01T08:00:00Z', volumeKwh }]
    ).intervals[0];
  }

  test('Preis knapp über Floor: kein Clawback', () => {
    const aboveFloor = floorEurMwh + 0.1; // 1.6 EUR/MWh
    const iv = priceToInterval(aboveFloor);
    expect(iv.isClawbackActive).toBe(false);
    expect(iv.calculatedRbCents).toBe(0);
  });

  test('Preis genau auf Floor: kein Clawback (Grenzwert)', () => {
    const iv = priceToInterval(floorEurMwh);
    expect(iv.isClawbackActive).toBe(false);
    expect(iv.calculatedRbCents).toBe(0);
  });

  test('Preis knapp unter Floor: Clawback greift', () => {
    const belowFloor = floorEurMwh - 0.1; // 1.4 EUR/MWh
    const iv = priceToInterval(belowFloor);
    expect(iv.isClawbackActive).toBe(true);
    expect(iv.calculatedRbCents).toBeGreaterThan(0);
  });

  test('Beitrag bei sub-floor-Preis entspricht mathematischem Erwartungswert', () => {
    const belowFloor = floorEurMwh - 0.5; // 1.0 EUR/MWh = 0.1 cents/kWh
    const iv = priceToInterval(belowFloor);
    // RB = (floor − price) × volume = (0.15 − 0.1) × 100 = 5 cents
    const expectedRb = (floorCentsKwh - belowFloor / 10) * volumeKwh;
    expect(iv.calculatedRbCents).toBeCloseTo(expectedRb, 4);
  });

  test('Preis über AW: Excess-Profit-Clawback greift', () => {
    const aboveAw = 95; // 95 EUR/MWh = 9.5 cents/kWh > AW = 9 cents/kWh
    const iv = priceToInterval(aboveAw);
    expect(iv.isClawbackActive).toBe(true);
    const expectedRb = (9.5 - asset.awCentsPerKwh) * volumeKwh; // (9.5 − 9.0) × 100 = 50 cents
    expect(iv.calculatedRbCents).toBeCloseTo(expectedRb, 4);
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
    expect(result[0].priceEurMwh).toBe(55);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// P0.1 — ruleSet parameter overrides env-var defaults
// ─────────────────────────────────────────────────────────────────────────────
describe('runCalculation — options.ruleSet overrides', () => {
  const asset = {
    technology: 'wind_onshore',
    capacityKw: 1000,
    awCentsPerKwh: 9.0,
    commissioningDate: '2022-01-01',
  };

  // AW-loser Preis zwischen altem Floor (1.5 EUR/MWh) und neuem Floor (2.0 EUR/MWh)
  // With floor=1.5: 1.7 EUR/MWh is ABOVE floor → no sub_floor clawback
  // With floor=2.0: 1.7 EUR/MWh is BELOW floor → sub_floor clawback
  const prices = [{ timestamp: '2027-04-01T08:00:00Z', priceEurMwh: 1.7 }];
  const injection = [{ timestamp: '2027-04-01T08:00:00Z', volumeKwh: 100 }];

  test('without ruleSet: uses env-var floor (1.5) → price 1.7 is above floor, no clawback', () => {
    const result = runCalculation(asset, prices, injection);
    // env default wind_onshore floor = 1.5 EUR/MWh; 1.7 > 1.5 → no sub_floor arm
    expect(result.intervals[0].isClawbackActive).toBe(false);
  });

  test('with june ruleSet (floor=2.0): price 1.7 triggers sub_floor clawback', () => {
    const juneRuleSet = {
      id: 'eeg2027-draft-2026-06',
      parameters: {
        s51ConsecutiveNegHours: 4,
        technologyFloors: { solar: 0, wind_onshore: 2.0, wind_offshore: 0.5, biomass: 1.0 },
      },
    };
    const result = runCalculation(asset, prices, injection, { ruleSet: juneRuleSet });
    expect(result.intervals[0].isClawbackActive).toBe(true);
    expect(result.intervals[0].ruleArm).toBe('sub_floor');
  });

  test('ruleSetId is included in result when ruleSet has an id', () => {
    const ruleSet = {
      id: 'eeg2027-draft-2026-06',
      parameters: { s51ConsecutiveNegHours: 4, technologyFloors: { wind_onshore: 2.0 } },
    };
    const result = runCalculation(asset, prices, injection, { ruleSet });
    expect(result.ruleSetId).toBe('eeg2027-draft-2026-06');
  });

  test('s51 threshold from ruleSet is used (4h vs. 6h env default)', () => {
    // Build 16 × 15-min negative-price intervals (= 4 hours) at the 4h threshold boundary
    const base = new Date('2027-04-01T08:00:00Z').getTime();
    const negPrices = Array.from({ length: 16 }, (_, i) => ({
      timestamp: new Date(base + i * 15 * 60000).toISOString(),
      priceEurMwh: -5,
    }));
    const negInjection = negPrices.map((p) => ({ timestamp: p.timestamp, volumeKwh: 10 }));

    // With env default (6h threshold): at 4h accumulated, curtailment NOT yet active for §51
    // (§51 Scenario A), but Scenario B clawback is always active for negative prices.
    // The s51 threshold affects Scenario A curtailment, not Scenario B clawback.
    // Let's verify: last interval is the 16th = exactly 4h. With 6h threshold → NOT curtailed.
    const defaultResult = runCalculation(asset, negPrices, negInjection);
    const lastDefaultIv = defaultResult.intervals[15];
    expect(lastDefaultIv.isClawbackActive).toBe(true); // B is always active for neg prices

    // With 4h ruleSet threshold → same behavior for Scenario B
    const ruleSet4h = {
      id: 'eeg2027-4h-test',
      parameters: { s51ConsecutiveNegHours: 4, technologyFloors: { wind_onshore: 0.0 } },
    };
    const result4h = runCalculation(asset, negPrices, negInjection, { ruleSet: ruleSet4h });
    expect(result4h.intervals[15].isClawbackActive).toBe(true);
    // Scenario A: old law curtailed hours — with 4h threshold, at the 16th slot (4h) curtailed
    // With env default (6h threshold), at 4h NOT curtailed
    // curtailedHoursCount changes based on threshold
    expect(result4h.summary.calculatedUnderOldLaw.curtailedHoursCount).toBeGreaterThan(
      defaultResult.summary.calculatedUnderOldLaw.curtailedHoursCount
    );
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// P0.3 — ruleArm enum + includeIntervalTrace
// ─────────────────────────────────────────────────────────────────────────────
describe('runCalculation — P0.3 interval trace options', () => {
  const asset = {
    technology: 'solar',
    capacityKw: 100,
    awCentsPerKwh: 7.5,
    commissioningDate: '2024-01-01',
  };

  function makeQhPrices(count, priceEurMwh, start = '2027-04-15T00:00:00Z') {
    const base = new Date(start).getTime();
    return Array.from({ length: count }, (_, i) => ({
      timestamp: new Date(base + i * 15 * 60000).toISOString(),
      priceEurMwh,
    }));
  }

  test('ruleArm is "none" when price is between 0 and AW', () => {
    const prices = makeQhPrices(1, 50); // 50 EUR/MWh = 5 cents/kWh < AW 7.5 → no arm
    const injection = [{ timestamp: prices[0].timestamp, volumeKwh: 10 }];
    const result = runCalculation(asset, prices, injection);
    expect(result.intervals[0].ruleArm).toBe('none');
  });

  test('ruleArm is "negative_price" when price < 0', () => {
    const prices = makeQhPrices(1, -10);
    const injection = [{ timestamp: prices[0].timestamp, volumeKwh: 10 }];
    const result = runCalculation(asset, prices, injection);
    expect(result.intervals[0].ruleArm).toBe('negative_price');
  });

  test('ruleArm is "excess_profit" when price > AW', () => {
    const prices = makeQhPrices(1, 80); // 80 EUR/MWh = 8 cents/kWh > AW 7.5
    const injection = [{ timestamp: prices[0].timestamp, volumeKwh: 10 }];
    const result = runCalculation(asset, prices, injection);
    expect(result.intervals[0].ruleArm).toBe('excess_profit');
  });

  test('includeIntervalTrace: false omits intervals from result', () => {
    const prices = makeQhPrices(4, 50);
    const injection = prices.map((p) => ({ timestamp: p.timestamp, volumeKwh: 10 }));
    const result = runCalculation(asset, prices, injection, { includeIntervalTrace: false });
    expect(result.intervals).toBeUndefined();
    expect(result.summary).toBeDefined();
  });

  test('includeIntervalTrace: true (default) includes intervals', () => {
    const prices = makeQhPrices(4, 50);
    const injection = prices.map((p) => ({ timestamp: p.timestamp, volumeKwh: 10 }));
    const result = runCalculation(asset, prices, injection, { includeIntervalTrace: true });
    expect(Array.isArray(result.intervals)).toBe(true);
    expect(result.intervals).toHaveLength(4);
  });
});
