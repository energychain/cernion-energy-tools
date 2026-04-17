'use strict';

const {
  PRESETS,
  DEBOUNCE_MS,
  resolvePreset,
  parseCronExpression,
  matchField,
  isDue,
} = require('../src/mastr-monitor-scheduler');

describe('mastr-monitor-scheduler', () => {
  // ─── resolvePreset ───────────────────────────────────────────────────────

  test('resolvePreset returns cron expression for daily_morning', () => {
    expect(resolvePreset('daily_morning')).toBe('0 6 * * *');
  });

  test('resolvePreset returns cron expression for weekday_morning', () => {
    expect(resolvePreset('weekday_morning')).toBe('0 6 * * 1-5');
  });

  test('resolvePreset returns cron expression for weekly_monday', () => {
    expect(resolvePreset('weekly_monday')).toBe('0 6 * * 1');
  });

  test('resolvePreset returns cron expression for monthly_first', () => {
    expect(resolvePreset('monthly_first')).toBe('0 6 1 * *');
  });

  test('resolvePreset throws on unknown preset', () => {
    expect(() => resolvePreset('unknown_preset')).toThrow('Unknown schedule preset');
  });

  test('PRESETS object contains all 4 presets', () => {
    expect(Object.keys(PRESETS)).toHaveLength(4);
  });

  // ─── parseCronExpression ─────────────────────────────────────────────────

  test('parseCronExpression parses standard expression correctly', () => {
    const fields = parseCronExpression('0 6 * * 1-5');
    expect(fields).toEqual({
      minute: '0',
      hour: '6',
      dayOfMonth: '*',
      month: '*',
      dayOfWeek: '1-5',
    });
  });

  test('parseCronExpression throws on wrong field count', () => {
    expect(() => parseCronExpression('0 6 *')).toThrow('5 fields');
  });

  // ─── matchField ──────────────────────────────────────────────────────────

  test('matchField wildcard always matches', () => {
    expect(matchField('*', 0)).toBe(true);
    expect(matchField('*', 59)).toBe(true);
  });

  test('matchField exact value matches', () => {
    expect(matchField('6', 6)).toBe(true);
    expect(matchField('6', 7)).toBe(false);
  });

  test('matchField range matches values within range', () => {
    expect(matchField('1-5', 1)).toBe(true);
    expect(matchField('1-5', 3)).toBe(true);
    expect(matchField('1-5', 5)).toBe(true);
    expect(matchField('1-5', 0)).toBe(false);
    expect(matchField('1-5', 6)).toBe(false);
  });

  test('matchField comma-separated list matches any value in list', () => {
    expect(matchField('1,3,5', 1)).toBe(true);
    expect(matchField('1,3,5', 3)).toBe(true);
    expect(matchField('1,3,5', 5)).toBe(true);
    expect(matchField('1,3,5', 2)).toBe(false);
  });

  // ─── isDue ───────────────────────────────────────────────────────────────

  function makeDate(isoString) {
    return new Date(isoString);
  }

  const schedule = {
    type: 'preset',
    preset: 'weekday_morning',
    timezone: 'UTC',
  };

  test('isDue returns false when schedule is null', () => {
    expect(isDue(null, null, makeDate('2026-04-17T06:00:00Z'))).toBe(false);
  });

  test('isDue returns true for weekday_morning at exactly 06:00 UTC Monday', () => {
    // 2026-04-13 is a Monday
    const now = makeDate('2026-04-13T06:00:00Z');
    expect(isDue(schedule, null, now)).toBe(true);
  });

  test('isDue returns false for weekday_morning at 07:00 UTC', () => {
    const now = makeDate('2026-04-13T07:00:00Z');
    expect(isDue(schedule, null, now)).toBe(false);
  });

  test('isDue returns false for weekday_morning on Saturday', () => {
    // 2026-04-18 is a Saturday
    const now = makeDate('2026-04-18T06:00:00Z');
    expect(isDue(schedule, null, now)).toBe(false);
  });

  test('isDue returns false within debounce window', () => {
    const lastRun = '2026-04-13T05:30:00.000Z';
    const now = makeDate('2026-04-13T06:00:00Z');
    // only 30 minutes since last run → within DEBOUNCE_MS (1 hour)
    expect(isDue(schedule, lastRun, now)).toBe(false);
  });

  test('isDue returns true outside debounce window', () => {
    const lastRun = '2026-04-12T06:00:00.000Z';
    const now = makeDate('2026-04-13T06:00:00Z');
    expect(isDue(schedule, lastRun, now)).toBe(true);
  });

  test('isDue works with cron type schedule', () => {
    const cronSchedule = {
      type: 'cron',
      expression: '0 6 1 * *', // monthly_first
      timezone: 'UTC',
    };
    // 2026-05-01 06:00 UTC
    const now = makeDate('2026-05-01T06:00:00Z');
    expect(isDue(cronSchedule, null, now)).toBe(true);
  });

  test('isDue returns false for unknown preset without throwing', () => {
    const badSchedule = { type: 'preset', preset: 'bad_preset', timezone: 'UTC' };
    const now = makeDate('2026-04-13T06:00:00Z');
    expect(isDue(badSchedule, null, now)).toBe(false);
  });

  test('DEBOUNCE_MS is exactly 1 hour in milliseconds', () => {
    expect(DEBOUNCE_MS).toBe(3600000);
  });
});
