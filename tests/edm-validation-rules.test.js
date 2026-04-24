'use strict';

const {
  VALIDATION_RULES,
  findGaps,
  interpolateLinear,
  calculateRMSE,
} = require('../src/edm-validation-rules');

describe('edm-validation-rules', () => {
  test('BANDWIDTH_CHECK: Wert innerhalb Grenze → OK', () => {
    const rule = VALIDATION_RULES.find((item) => item.id === 'BANDWIDTH_CHECK');
    expect(rule.check(2.0, { capacityKw: 10, obis: '1-0:2.8.0' })).toBe(true);
  });

  test('BANDWIDTH_CHECK: Wert über Grenze → Verletzung', () => {
    const rule = VALIDATION_RULES.find((item) => item.id === 'BANDWIDTH_CHECK');
    expect(rule.check(5.0, { capacityKw: 10, obis: '1-0:2.8.0' })).toBe(false);
  });

  test('GAP_DETECTION: findet fehlende Timestamps', () => {
    const timestamps = [
      '2026-04-01T00:00:00Z',
      '2026-04-01T00:15:00Z',
      '2026-04-01T00:45:00Z',
    ];

    const gaps = findGaps(timestamps, 900);
    expect(gaps.length).toBe(1);
    expect(gaps[0]).toContain('00:30');
  });

  test('GAP_DETECTION: keine Lücken → leer', () => {
    const timestamps = [
      '2026-04-01T00:00:00Z',
      '2026-04-01T00:15:00Z',
      '2026-04-01T00:30:00Z',
    ];

    expect(findGaps(timestamps, 900).length).toBe(0);
  });

  test('MONOTONY_CHECK: steigender Zählerstand → OK', () => {
    const rule = VALIDATION_RULES.find((item) => item.id === 'MONOTONY_CHECK');
    expect(rule.check(100, { previousValue: 99, obis: '1-0:1.8.0' })).toBe(true);
  });

  test('MONOTONY_CHECK: sinkender Zählerstand → Verletzung', () => {
    const rule = VALIDATION_RULES.find((item) => item.id === 'MONOTONY_CHECK');
    expect(rule.check(98, { previousValue: 100, obis: '1-0:1.8.0' })).toBe(false);
  });

  test('NEGATIVE_VALUE_CHECK: negative kWh → Verletzung', () => {
    const rule = VALIDATION_RULES.find((item) => item.id === 'NEGATIVE_VALUE_CHECK');
    expect(rule.check(-5, { obis: '1-0:1.8.0' })).toBe(false);
  });

  test('NEGATIVE_VALUE_CHECK: 0 kWh → OK', () => {
    const rule = VALIDATION_RULES.find((item) => item.id === 'NEGATIVE_VALUE_CHECK');
    expect(rule.check(0, { obis: '1-0:1.8.0' })).toBe(true);
  });

  test('interpolateLinear berechnet Mittelpunkt', () => {
    const result = interpolateLinear(
      { ts: '2026-04-01T00:00:00Z', value: 10 },
      { ts: '2026-04-01T00:30:00Z', value: 20 },
      '2026-04-01T00:15:00Z'
    );

    expect(result).toBeCloseTo(15, 1);
  });

  test('calculateRMSE berechnet korrekt', () => {
    const actual = [10, 20, 30];
    const expected = [12, 18, 33];
    const rmse = calculateRMSE(actual, expected);

    expect(rmse).toBeGreaterThan(0);
    expect(rmse).toBeLessThan(5);
  });
});
