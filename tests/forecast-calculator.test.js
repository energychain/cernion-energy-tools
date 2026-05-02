'use strict';

const {
  calculateLoadForecast,
  calculateResidualLoad,
  calculateForecastQuality,
  generateDayAheadSchedule,
  optimizeStorageDispatch,
} = require('../src/forecast-calculator');

describe('forecast-calculator', () => {
  test('calculateLoadForecast: SLP-only generiert 96 Werte', () => {
    const slpProfile = { values: new Array(96).fill(0.1) };
    const result = calculateLoadForecast(null, slpProfile, {
      annualConsumptionKwh: 3500,
      date: '2026-04-15',
    });
    expect(result.values.length).toBe(96);
    expect(result.method).toBe('slp_only');
    expect(result.totalKwh).toBeGreaterThan(5);
    expect(result.totalKwh).toBeLessThan(20);
  });

  test('calculateLoadForecast: mit historischen Daten → slp_corrected', () => {
    const slpProfile = { values: new Array(96).fill(0.1) };
    const historical = new Array(96).fill(null).map((_, i) => ({
      ts:
        '2026-04-08T' +
        String(Math.floor(i / 4)).padStart(2, '0') +
        ':' +
        String((i % 4) * 15).padStart(2, '0') +
        ':00Z',
      value: 0.12,
    }));
    const result = calculateLoadForecast(historical, slpProfile, {
      annualConsumptionKwh: 3500,
      date: '2026-04-15',
    });
    expect(result.method).toBe('slp_corrected');
    expect(result.correctionFactor).toBeGreaterThan(1.0);
  });

  test('calculateLoadForecast: Temperaturkorrektur bei Kälte', () => {
    const slpProfile = { values: new Array(96).fill(0.1) };
    const resultWarm = calculateLoadForecast(null, slpProfile, {
      annualConsumptionKwh: 3500,
      date: '2026-04-15',
      temperatureCelsius: 20,
    });
    const resultCold = calculateLoadForecast(null, slpProfile, {
      annualConsumptionKwh: 3500,
      date: '2026-04-15',
      temperatureCelsius: 5,
    });
    expect(resultCold.totalKwh).toBeGreaterThan(resultWarm.totalKwh);
  });

  test('calculateResidualLoad: Export wenn Erzeugung > Last', () => {
    const load = [{ ts: '2026-04-15T00:00:00Z', value: 30 }];
    const generation = [{ ts: '2026-04-15T00:00:00Z', value: 100 }];
    const result = calculateResidualLoad(load, generation);
    expect(result.intervals[0].direction).toBe('export');
    expect(result.intervals[0].residual_kw).toBe(-70);
  });

  test('calculateResidualLoad: Import wenn Last > Erzeugung', () => {
    const load = [{ ts: '2026-04-15T00:00:00Z', value: 80 }];
    const generation = [{ ts: '2026-04-15T00:00:00Z', value: 20 }];
    const result = calculateResidualLoad(load, generation);
    expect(result.intervals[0].direction).toBe('import');
    expect(result.intervals[0].residual_kw).toBe(60);
  });

  test('calculateResidualLoad: autarkyRate berechnet', () => {
    const load = [
      { ts: '2026-04-15T00:00:00Z', value: 100 },
      { ts: '2026-04-15T00:15:00Z', value: 50 },
    ];
    const generation = [
      { ts: '2026-04-15T00:00:00Z', value: 80 },
      { ts: '2026-04-15T00:15:00Z', value: 30 },
    ];
    const result = calculateResidualLoad(load, generation);
    expect(result.summary.autarkyRate).toBeGreaterThan(0.5);
    expect(result.summary.autarkyRate).toBeLessThan(1.0);
  });

  test('calculateForecastQuality: perfekte Prognose → MAPE=0', () => {
    const forecast = [{ value: 10 }, { value: 20 }, { value: 30 }];
    const actual = [{ value: 10 }, { value: 20 }, { value: 30 }];
    const result = calculateForecastQuality(forecast, actual);
    expect(result.mape).toBe(0);
    expect(result.rating).toBe('excellent');
  });

  test('calculateForecastQuality: 15% Abweichung → good', () => {
    const forecast = [{ value: 100 }, { value: 200 }];
    const actual = [{ value: 115 }, { value: 170 }];
    const result = calculateForecastQuality(forecast, actual);
    expect(result.mape).toBeGreaterThan(5);
    expect(result.mape).toBeLessThan(20);
    expect(result.rating).toBe('good');
  });

  test('generateDayAheadSchedule: ohne Speicher = pure Residuallast', () => {
    const residual = [
      { ts: '2026-04-15T00:00:00Z', residual_kw: 50 },
      { ts: '2026-04-15T00:15:00Z', residual_kw: -30 },
    ];
    const result = generateDayAheadSchedule(residual, null, null);
    expect(result.schedule.length).toBe(2);
    expect(result.schedule[0].gridFlow_kw).toBe(50);
    expect(result.schedule[1].gridFlow_kw).toBe(-30);
  });

  test('optimizeStorageDispatch: lädt bei Überschuss, entlädt bei Bedarf', () => {
    const residual = [
      { ts: '2026-04-15T00:00:00Z', residual_kw: -100, direction: 'export' },
      { ts: '2026-04-15T00:15:00Z', residual_kw: -80, direction: 'export' },
      { ts: '2026-04-15T00:30:00Z', residual_kw: 50, direction: 'import' },
      { ts: '2026-04-15T00:45:00Z', residual_kw: 60, direction: 'import' },
    ];
    const storageConfig = {
      capacityKwh: 10,
      maxChargePowerKw: 5,
      maxDischargePowerKw: 5,
      efficiency: 0.92,
      currentSocPercent: 50,
    };
    const result = optimizeStorageDispatch(residual, storageConfig, null);
    const charges = result.schedule.filter((s) => s.storageAction === 'charge');
    const discharges = result.schedule.filter((s) => s.storageAction === 'discharge');
    expect(charges.length).toBeGreaterThan(0);
    expect(discharges.length).toBeGreaterThan(0);
  });
});
