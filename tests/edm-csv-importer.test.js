'use strict';

const { parseCsvTimeseries } = require('../src/edm-csv-importer');

describe('edm-csv-importer', () => {
  test('parses German CSV (semicolon, DD.MM.YYYY HH:mm)', () => {
    const csv = 'Zeitstempel;Wert_kWh\n01.04.2026 00:00;12.4\n01.04.2026 00:15;11.8';
    const result = parseCsvTimeseries(csv, {
      delimiter: ';',
      timestampColumn: 'Zeitstempel',
      timestampFormat: 'DD.MM.YYYY HH:mm',
      valueColumn: 'Wert_kWh',
      timezone: 'Europe/Berlin',
    });

    expect(result.rows.length).toBe(2);
    expect(result.rows[0].value).toBe(12.4);
    expect(result.rows[0].ts).toContain('2026-03-31T22:00');
  });

  test('parses ISO CSV (comma delimiter)', () => {
    const csv = 'timestamp,value\n2026-04-01T00:00:00Z,12.4\n2026-04-01T00:15:00Z,11.8';
    const result = parseCsvTimeseries(csv, {
      delimiter: ',',
      timestampColumn: 'timestamp',
      timestampFormat: 'ISO',
      valueColumn: 'value',
    });

    expect(result.rows.length).toBe(2);
    expect(result.rows[0].ts).toBe('2026-04-01T00:00:00.000Z');
  });

  test('handles German decimal separator', () => {
    const csv = 'ts;val\n2026-04-01T00:00:00Z;12,4';
    const result = parseCsvTimeseries(csv, {
      delimiter: ';',
      timestampColumn: 'ts',
      valueColumn: 'val',
      decimalSeparator: ',',
      timestampFormat: 'ISO',
    });

    expect(result.rows[0].value).toBe(12.4);
  });

  test('handles missing values → quality: missing', () => {
    const csv = 'ts;val\n2026-04-01T00:00:00Z;\n2026-04-01T00:15:00Z;11.8';
    const result = parseCsvTimeseries(csv, {
      delimiter: ';',
      timestampColumn: 'ts',
      valueColumn: 'val',
      timestampFormat: 'ISO',
    });

    expect(result.rows[0].value).toBeNull();
    expect(result.rows[0].quality).toBe('missing');
    expect(result.rows[1].value).toBe(11.8);
  });

  test('skips empty lines', () => {
    const csv = 'ts;val\n2026-04-01T00:00:00Z;12.4\n\n2026-04-01T00:15:00Z;11.8\n';
    const result = parseCsvTimeseries(csv, {
      delimiter: ';',
      timestampColumn: 'ts',
      valueColumn: 'val',
      timestampFormat: 'ISO',
    });

    expect(result.rows.length).toBe(2);
  });

  test('skipRows skips additional header lines', () => {
    const csv = 'Exported: 2026-04-19\nUnit: kWh\nts;val\n2026-04-01T00:00:00Z;12.4';
    const result = parseCsvTimeseries(csv, {
      delimiter: ';',
      timestampColumn: 'ts',
      valueColumn: 'val',
      skipRows: 2,
      timestampFormat: 'ISO',
    });

    expect(result.rows.length).toBe(1);
  });

  test('returns stats and errors', () => {
    const csv = 'ts;val\n2026-04-01T00:00:00Z;12.4\nBAD_TS;11.8';
    const result = parseCsvTimeseries(csv, {
      delimiter: ';',
      timestampColumn: 'ts',
      valueColumn: 'val',
      timestampFormat: 'ISO',
    });

    expect(result.stats.parsed).toBe(1);
    expect(result.stats.skipped).toBeGreaterThanOrEqual(1);
    expect(result.errors.length).toBeGreaterThanOrEqual(1);
  });

  test('quality column is used when specified', () => {
    const csv = 'ts;val;q\n2026-04-01T00:00:00Z;12.4;validated';
    const result = parseCsvTimeseries(csv, {
      delimiter: ';',
      timestampColumn: 'ts',
      valueColumn: 'val',
      qualityColumn: 'q',
      timestampFormat: 'ISO',
    });

    expect(result.rows[0].quality).toBe('validated');
  });
});
