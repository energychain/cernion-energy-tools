'use strict';

const {
  getEegTariff,
  getPostEegRate,
  isPostEeg,
} = require('../src/eeg-tariff-tables');

describe('eeg-tariff-tables', () => {
  test('getEegTariff: PV 10 kWp IBN 2024-03 → 8.11 Cent/kWh', () => {
    const tariff = getEegTariff('2024-03-15', 10, 'solar');
    expect(tariff).toBe(8.11);
  });

  test('getEegTariff: PV 50 kWp IBN 2024-03 → 7.03 Cent/kWh', () => {
    const tariff = getEegTariff('2024-03-15', 50, 'solar');
    expect(tariff).toBe(7.03);
  });

  test('getEegTariff: PV 200 kWp IBN 2025-03 → 5.61 Cent/kWh', () => {
    const tariff = getEegTariff('2025-03-15', 200, 'solar');
    expect(tariff).toBe(5.61);
  });

  test('isPostEeg: IBN 2004 → true (>20 Jahre)', () => {
    expect(isPostEeg('2004-01-01')).toBe(true);
  });

  test('isPostEeg: IBN 2020 → false (<20 Jahre)', () => {
    expect(isPostEeg('2020-01-01')).toBe(false);
  });

  test('getPostEegRate: solar → Marktwert (aktuell ~3-5 Cent/kWh)', () => {
    const rate = getPostEegRate('solar');
    expect(rate).toBeGreaterThan(0);
    expect(rate).toBeLessThan(10);
  });
});
