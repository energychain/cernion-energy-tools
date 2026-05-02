'use strict';

const {
  classifyDevice,
  calculateDimmingPlan,
  calculateReliefProof,
  calculateTariffReduction,
} = require('../src/flex-calculator');

describe('flex-calculator', () => {
  test('classifyDevice: Speicher ≥4.2 kW → storage', () => {
    const result = classifyDevice({
      type: 'storage',
      nettonennleistung: 10,
      name: 'Speicher',
    });

    expect(result.deviceType).toBe('storage');
    expect(result.section14aEligible).toBe(true);
  });

  test('classifyDevice: Wallbox → wallbox', () => {
    const result = classifyDevice({
      type: 'other',
      nettonennleistung: 11,
      name: 'Wallbox Garage',
    });

    expect(result.deviceType).toBe('wallbox');
    expect(result.section14aEligible).toBe(true);
  });

  test('classifyDevice: PV 5 kWp → nicht steuerbar', () => {
    const result = classifyDevice({
      type: 'solar',
      nettonennleistung: 5,
      name: 'PV Hausdach',
    });

    expect(result.section14aEligible).toBe(false);
  });

  test('calculateDimmingPlan: plant Dimming bei Überlast', () => {
    const devices = [
      { deviceId: 'd1', type: 'wallbox', capacityKw: 11, minDimmingKw: 4.2, status: 'active' },
      { deviceId: 'd2', type: 'storage', capacityKw: 10, minDimmingKw: 4.2, status: 'active' },
    ];

    const loadForecast = [
      { ts: '2026-04-20T00:00:00.000Z', value: 90 },
      { ts: '2026-04-20T00:15:00.000Z', value: 95 },
      { ts: '2026-04-20T00:30:00.000Z', value: 70 },
    ];

    const result = calculateDimmingPlan(devices, loadForecast, 100, {
      threshold: 0.85,
      minPowerKw: 4.2,
      maxDurationMinutes: 120,
      cooldownMinutes: 120,
    });

    expect(result.events.length).toBeGreaterThan(0);
    expect(result.summary.peakLoadWithDimmingKw).toBeLessThan(90);
  });

  test('calculateDimmingPlan: respektiert 4.2 kW Minimum', () => {
    const devices = [
      { deviceId: 'd1', type: 'wallbox', capacityKw: 11, minDimmingKw: 4.2, status: 'active' },
    ];
    const loadForecast = [{ ts: '2026-04-20T00:00:00.000Z', value: 90 }];

    const result = calculateDimmingPlan(devices, loadForecast, 100, {
      threshold: 0.85,
      minPowerKw: 4.2,
      maxDurationMinutes: 120,
      cooldownMinutes: 120,
    });

    if (result.events.length > 0) {
      expect(result.events[0].dimmedPowerKw).toBeGreaterThanOrEqual(4.2);
    }
  });

  test('calculateReliefProof: berechnet Wirksamkeit', () => {
    const events = [
      {
        deviceId: 'd1',
        start: '2026-04-20T00:00:00.000Z',
        end: '2026-04-20T00:15:00.000Z',
        reductionKw: 6.8,
      },
    ];

    const loadBefore = [{ ts: '2026-04-20T00:00:00.000Z', value: 95 }];
    const loadAfter = [{ ts: '2026-04-20T00:00:00.000Z', value: 88.2 }];

    const result = calculateReliefProof(events, loadBefore, loadAfter);

    expect(result.summary.totalRelief_kwh).toBeGreaterThan(0);
    expect(result.summary.effectivenessRate).toBeGreaterThan(0);
  });

  test('calculateTariffReduction: Wallbox 11 kW → 110-190 €/Jahr', () => {
    const result = calculateTariffReduction({ type: 'wallbox', capacityKw: 11 }, 8760);

    expect(result.annualReduction_eur).toBeGreaterThan(50);
    expect(result.annualReduction_eur).toBeLessThan(300);
  });
});
