'use strict';

const {
  QUARTER_HOURS_PER_DAY,
  normalizeDayWindow,
  buildQuarterHourTimestamps,
  buildTimeseriesRows,
  buildRowsFromSlp,
} = require('../src/edm-virtual-meter');

describe('edm-virtual-meter helpers', () => {
  test('normalizeDayWindow returns UTC day range', () => {
    const result = normalizeDayWindow('2026-05-01');
    expect(result.day).toBe('2026-05-01');
    expect(result.from).toBe('2026-05-01T00:00:00.000Z');
    expect(result.to).toBe('2026-05-01T23:59:59.999Z');
  });

  test('buildQuarterHourTimestamps returns 96 values', () => {
    const values = buildQuarterHourTimestamps('2026-05-01');
    expect(values).toHaveLength(QUARTER_HOURS_PER_DAY);
    expect(values[0]).toBe('2026-05-01T00:00:00.000Z');
    expect(values[95]).toBe('2026-05-01T23:45:00.000Z');
  });

  test('buildTimeseriesRows maps values with quality/source', () => {
    const timestamps = buildQuarterHourTimestamps('2026-05-01');
    const rows = buildTimeseriesRows(
      timestamps,
      new Array(QUARTER_HOURS_PER_DAY).fill(1.25),
      { quality: 'synthetic', source: 'virtual:test' }
    );

    expect(rows).toHaveLength(QUARTER_HOURS_PER_DAY);
    expect(rows[0]).toEqual({
      ts: '2026-05-01T00:00:00.000Z',
      value: 1.25,
      quality: 'synthetic',
      source: 'virtual:test',
    });
  });

  test('buildRowsFromSlp returns quarter-hour rows', () => {
    const values = Array.from({ length: QUARTER_HOURS_PER_DAY }, (_, i) => i / 100);
    const rows = buildRowsFromSlp('2026-05-01', values);

    expect(rows).toHaveLength(QUARTER_HOURS_PER_DAY);
    expect(rows[10].value).toBeCloseTo(0.1, 9);
  });
});
