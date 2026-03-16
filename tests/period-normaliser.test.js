const { normalisePeriod, isPeriodColumn } = require('../src/period-normaliser');

describe('period-normaliser', () => {
  describe('normalisePeriod', () => {
    it('normalises month + year format', () => {
      expect(normalisePeriod('Jan 2026')).toBe('2026-01-01');
      expect(normalisePeriod('Feb 2026')).toBe('2026-02-01');
      expect(normalisePeriod('Mar 2026')).toBe('2026-03-01');
    });

    it('normalises quarter format to quarter start', () => {
      expect(normalisePeriod('2026-Q1')).toBe('2026-01-01');
      expect(normalisePeriod('2026-Q2')).toBe('2026-04-01');
      expect(normalisePeriod('2026-Q3')).toBe('2026-07-01');
      expect(normalisePeriod('2026-Q4')).toBe('2026-10-01');
    });

    it('normalises YYYY-MM and preserves valid ISO date', () => {
      expect(normalisePeriod('2026-02')).toBe('2026-02-01');
      expect(normalisePeriod('2024-02-29')).toBe('2024-02-29');
    });

    it('returns null for unknown or invalid dates', () => {
      expect(normalisePeriod('Q1 2026')).toBeNull();
      expect(normalisePeriod('2026-13')).toBeNull();
      expect(normalisePeriod('2026-02-30')).toBeNull();
      expect(normalisePeriod('')).toBeNull();
      expect(normalisePeriod(null)).toBeNull();
    });
  });

  describe('isPeriodColumn', () => {
    it('detects period-like columns when majority is mixed period format', () => {
      const rows = [
        { Lieferperiode: 'Jan 2026' },
        { Lieferperiode: '2026-Q1' },
        { Lieferperiode: '2026-03' },
        { Lieferperiode: '2026-03-15' },
      ];
      expect(isPeriodColumn(rows, 'Lieferperiode')).toBe(true);
    });

    it('does not mark pure ISO timestamp columns as period format', () => {
      const rows = [{ Zeit: '2026-03-10T00:00:00Z' }, { Zeit: '2026-03-10T01:00:00Z' }];
      expect(isPeriodColumn(rows, 'Zeit')).toBe(false);
    });
  });
});
