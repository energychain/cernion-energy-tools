/**
 * Date Utilities Tests
 * src/date-utils.js
 */

const { resolveDateAlias, resolveDateParams } = require('../src/date-utils');

/**
 * Returns today's date as YYYY-MM-DD in UTC, offset by `days` days.
 */
function utcDateString(days = 0) {
  const now = new Date();
  const d = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate()));
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
}

describe('resolveDateAlias', () => {
  describe('today alias', () => {
    it('should resolve "today" to current UTC date', () => {
      expect(resolveDateAlias('today')).toBe(utcDateString(0));
    });

    it('should resolve "TODAY" (uppercase) to current UTC date', () => {
      expect(resolveDateAlias('TODAY')).toBe(utcDateString(0));
    });

    it('should resolve "Today" (mixed case) to current UTC date', () => {
      expect(resolveDateAlias('Today')).toBe(utcDateString(0));
    });

    it('should resolve "  today  " (whitespace) to current UTC date', () => {
      expect(resolveDateAlias('  today  ')).toBe(utcDateString(0));
    });
  });

  describe('yesterday / tomorrow aliases', () => {
    it('should resolve "yesterday" to today - 1 day', () => {
      expect(resolveDateAlias('yesterday')).toBe(utcDateString(-1));
    });

    it('should resolve "tomorrow" to today + 1 day', () => {
      expect(resolveDateAlias('tomorrow')).toBe(utcDateString(1));
    });

    it('should resolve "YESTERDAY" (uppercase)', () => {
      expect(resolveDateAlias('YESTERDAY')).toBe(utcDateString(-1));
    });

    it('should resolve "TOMORROW" (uppercase)', () => {
      expect(resolveDateAlias('TOMORROW')).toBe(utcDateString(1));
    });
  });

  describe('today+N / today-N aliases', () => {
    it('should resolve "today+1" to tomorrow', () => {
      expect(resolveDateAlias('today+1')).toBe(utcDateString(1));
    });

    it('should resolve "today+2" to today + 2 days', () => {
      expect(resolveDateAlias('today+2')).toBe(utcDateString(2));
    });

    it('should resolve "today+7" to today + 7 days', () => {
      expect(resolveDateAlias('today+7')).toBe(utcDateString(7));
    });

    it('should resolve "today+30" to today + 30 days', () => {
      expect(resolveDateAlias('today+30')).toBe(utcDateString(30));
    });

    it('should resolve "today-1" to yesterday', () => {
      expect(resolveDateAlias('today-1')).toBe(utcDateString(-1));
    });

    it('should resolve "today-3" to today - 3 days', () => {
      expect(resolveDateAlias('today-3')).toBe(utcDateString(-3));
    });

    it('should resolve "today-7" to today - 7 days', () => {
      expect(resolveDateAlias('today-7')).toBe(utcDateString(-7));
    });

    it('should resolve "today-30" to today - 30 days', () => {
      expect(resolveDateAlias('today-30')).toBe(utcDateString(-30));
    });

    it('should resolve "today-90" to today - 90 days', () => {
      expect(resolveDateAlias('today-90')).toBe(utcDateString(-90));
    });

    it('should resolve "TODAY+2" (uppercase)', () => {
      expect(resolveDateAlias('TODAY+2')).toBe(utcDateString(2));
    });

    it('should resolve "TODAY-7" (uppercase)', () => {
      expect(resolveDateAlias('TODAY-7')).toBe(utcDateString(-7));
    });
  });

  describe('today+N consistency with named aliases', () => {
    it('today-1 should equal yesterday', () => {
      expect(resolveDateAlias('today-1')).toBe(resolveDateAlias('yesterday'));
    });

    it('today+1 should equal tomorrow', () => {
      expect(resolveDateAlias('today+1')).toBe(resolveDateAlias('tomorrow'));
    });

    it('today+0 should equal today', () => {
      expect(resolveDateAlias('today+0')).toBe(resolveDateAlias('today'));
    });
  });

  describe('pass-through for literal ISO dates', () => {
    it('should return a YYYY-MM-DD string unchanged', () => {
      expect(resolveDateAlias('2026-01-01')).toBe('2026-01-01');
    });

    it('should return "2026-03-15" unchanged', () => {
      expect(resolveDateAlias('2026-03-15')).toBe('2026-03-15');
    });

    it('should return unknown aliases unchanged', () => {
      expect(resolveDateAlias('last-week')).toBe('last-week');
    });

    it('should return partial aliases unchanged (e.g. "tod")', () => {
      expect(resolveDateAlias('tod')).toBe('tod');
    });
  });

  describe('safe handling of edge-case inputs', () => {
    it('should return undefined unchanged', () => {
      expect(resolveDateAlias(undefined)).toBeUndefined();
    });

    it('should return null unchanged', () => {
      expect(resolveDateAlias(null)).toBeNull();
    });

    it('should return empty string unchanged', () => {
      expect(resolveDateAlias('')).toBe('');
    });

    it('should return numbers unchanged', () => {
      expect(resolveDateAlias(20260101)).toBe(20260101);
    });

    it('should return objects unchanged', () => {
      const obj = {};
      expect(resolveDateAlias(obj)).toBe(obj);
    });
  });

  describe('output format', () => {
    it('should always return a YYYY-MM-DD formatted string for aliases', () => {
      const result = resolveDateAlias('today');
      expect(result).toMatch(/^\d{4}-\d{2}-\d{2}$/);
    });

    it('today+30 should return a valid YYYY-MM-DD string', () => {
      const result = resolveDateAlias('today+30');
      expect(result).toMatch(/^\d{4}-\d{2}-\d{2}$/);
    });

    it('today-90 should return a valid YYYY-MM-DD string', () => {
      const result = resolveDateAlias('today-90');
      expect(result).toMatch(/^\d{4}-\d{2}-\d{2}$/);
    });
  });
});

describe('resolveDateParams', () => {
  it('should resolve dateFrom and dateTo aliases in a params object', () => {
    const params = { dateFrom: 'today', dateTo: 'today+6', includeStatistics: true };
    const result = resolveDateParams(params);
    expect(result.dateFrom).toBe(utcDateString(0));
    expect(result.dateTo).toBe(utcDateString(6));
    expect(result.includeStatistics).toBe(true);
  });

  it('should mutate and return the same object reference', () => {
    const params = { dateFrom: 'today', dateTo: 'tomorrow' };
    const result = resolveDateParams(params);
    expect(result).toBe(params);
  });

  it('should leave non-alias ISO dates unchanged', () => {
    const params = { dateFrom: '2026-01-01', dateTo: '2026-01-31' };
    resolveDateParams(params);
    expect(params.dateFrom).toBe('2026-01-01');
    expect(params.dateTo).toBe('2026-01-31');
  });

  it('should be safe when dateFrom is missing', () => {
    const params = { dateTo: 'today' };
    resolveDateParams(params);
    expect(params.dateTo).toBe(utcDateString(0));
    expect(params.dateFrom).toBeUndefined();
  });

  it('should be safe when dateTo is missing', () => {
    const params = { dateFrom: 'yesterday' };
    resolveDateParams(params);
    expect(params.dateFrom).toBe(utcDateString(-1));
    expect(params.dateTo).toBeUndefined();
  });

  it('should return null unchanged', () => {
    expect(resolveDateParams(null)).toBeNull();
  });

  it('should return undefined unchanged', () => {
    expect(resolveDateParams(undefined)).toBeUndefined();
  });

  it('should handle empty params object', () => {
    const params = {};
    resolveDateParams(params);
    expect(params).toEqual({});
  });
});
