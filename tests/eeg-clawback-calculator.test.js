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
