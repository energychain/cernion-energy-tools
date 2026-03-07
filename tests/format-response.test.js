/**
 * Format Response Helper Tests
 *
 * Unit tests for src/format-response.js
 * Covers: extractRows, convertToCSV, convertToXLSX, applyFormat
 */

const XLSX = require('xlsx');
const {
  extractRows,
  convertToCSV,
  convertToXLSX,
  applyFormat,
  FORMAT_PARAM_SCHEMA,
  FORMAT_RESPONSE_CONTENT,
} = require('../src/format-response');

// ─── Fixtures ─────────────────────────────────────────────────────────────────

const SAMPLE_ROWS = [
  { timestamp: '2026-01-01T00:00:00Z', price: 45.5, unit: 'EUR/MWh' },
  { timestamp: '2026-01-01T01:00:00Z', price: 42.3, unit: 'EUR/MWh' },
  { timestamp: '2026-01-01T02:00:00Z', price: 39.1, unit: 'EUR/MWh' },
];

const SAMPLE_WITH_NESTED = [
  { name: 'Operator A', country: 'DE', meta: { code: '21X', valid: true } },
  { name: 'Operator B', country: 'FR', meta: { code: '22Y', valid: false } },
];

function makeMockCtx() {
  return { meta: {} };
}

// ─── extractRows ──────────────────────────────────────────────────────────────

describe('extractRows', () => {
  it('should return empty array for null or undefined', () => {
    expect(extractRows(null)).toEqual([]);
    expect(extractRows(undefined)).toEqual([]);
  });

  it('should return empty array for non-array result with no known keys', () => {
    expect(extractRows({ foo: 'bar' })).toEqual([]);
  });

  it('should extract top-level "prices" array', () => {
    const result = { prices: SAMPLE_ROWS, metadata: {} };
    expect(extractRows(result)).toBe(SAMPLE_ROWS);
  });

  it('should extract top-level "results" array', () => {
    const result = { results: SAMPLE_ROWS, count: 3 };
    expect(extractRows(result)).toBe(SAMPLE_ROWS);
  });

  it('should extract top-level "operators" array', () => {
    const result = { operators: SAMPLE_ROWS };
    expect(extractRows(result)).toBe(SAMPLE_ROWS);
  });

  it('should extract top-level "facilities" array', () => {
    const result = { facilities: SAMPLE_ROWS };
    expect(extractRows(result)).toBe(SAMPLE_ROWS);
  });

  it('should return result.data directly when it is an array', () => {
    const result = { success: true, data: SAMPLE_ROWS };
    expect(extractRows(result)).toBe(SAMPLE_ROWS);
  });

  it('should extract nested "prices" inside result.data', () => {
    const result = { data: { prices: SAMPLE_ROWS, currency: 'EUR' } };
    expect(extractRows(result)).toBe(SAMPLE_ROWS);
  });

  it('should extract nested "results" inside result.data', () => {
    const result = { data: { results: SAMPLE_ROWS, count: 3 } };
    expect(extractRows(result)).toBe(SAMPLE_ROWS);
  });

  it('should extract nested "operators" inside result.data', () => {
    const result = { data: { operators: SAMPLE_ROWS } };
    expect(extractRows(result)).toBe(SAMPLE_ROWS);
  });

  it('should prefer top-level array over result.data', () => {
    const other = [{ a: 1 }];
    const result = { prices: SAMPLE_ROWS, data: other };
    expect(extractRows(result)).toBe(SAMPLE_ROWS);
  });

  it('should return empty array when result.data is a non-array object with no known keys', () => {
    const result = { data: { summary: 'only a string', count: 5 } };
    expect(extractRows(result)).toEqual([]);
  });

  it('should extract top-level "dataPoints" array (ENTSO-E day-ahead prices)', () => {
    const result = {
      success: true,
      region: 'Deutschland',
      eicCode: '10Y1001A1001A82H',
      dataPoints: SAMPLE_ROWS,
      statistics: { minPrice: 39.1, maxPrice: 45.5 },
    };
    expect(extractRows(result)).toBe(SAMPLE_ROWS);
  });

  it('should extract nested "dataPoints" inside result.data', () => {
    const result = { data: { dataPoints: SAMPLE_ROWS, resolution: 'PT60M' } };
    expect(extractRows(result)).toBe(SAMPLE_ROWS);
  });
});

// ─── convertToCSV ─────────────────────────────────────────────────────────────

describe('convertToCSV', () => {
  it('should return empty string for empty array', () => {
    expect(convertToCSV([])).toBe('');
  });

  it('should return empty string for null/undefined', () => {
    expect(convertToCSV(null)).toBe('');
    expect(convertToCSV(undefined)).toBe('');
  });

  it('should produce a header row from object keys', () => {
    const csv = convertToCSV(SAMPLE_ROWS);
    const lines = csv.split('\n');
    expect(lines[0]).toBe('"timestamp","price","unit"');
  });

  it('should produce one data row per object', () => {
    const csv = convertToCSV(SAMPLE_ROWS);
    const lines = csv.split('\n');
    expect(lines).toHaveLength(SAMPLE_ROWS.length + 1); // header + rows
  });

  it('should not quote numeric values', () => {
    const csv = convertToCSV([{ value: 42.5 }]);
    expect(csv).toContain('42.5');
    // Number should appear without quotes
    expect(csv.split('\n')[1]).toBe('42.5');
  });

  it('should quote string values and escape internal quotes', () => {
    const csv = convertToCSV([{ name: 'He said "hello"' }]);
    expect(csv).toContain('"He said ""hello"""');
  });

  it('should JSON-encode nested objects in a quoted cell', () => {
    const csv = convertToCSV(SAMPLE_WITH_NESTED);
    expect(csv).toContain('"meta"');
    // RFC 4180: inner double-quotes are escaped as "" inside a quoted cell
    // e.g. "{""code"":""21X"",""valid"":true}"
    expect(csv).toContain('21X');
    expect(csv).toContain('""code""');
  });

  it('should handle null/undefined cell values as empty', () => {
    const csv = convertToCSV([{ a: 1, b: null, c: undefined }]);
    const dataRow = csv.split('\n')[1];
    expect(dataRow).toBe('1,,');
  });

  it('should unify columns across rows with different keys', () => {
    const rows = [{ a: 1 }, { b: 2 }, { a: 3, b: 4 }];
    const csv = convertToCSV(rows);
    const header = csv.split('\n')[0];
    expect(header).toBe('"a","b"');
    const lines = csv.split('\n');
    expect(lines[1]).toBe('1,');
    expect(lines[2]).toBe(',2');
    expect(lines[3]).toBe('3,4');
  });
});

// ─── convertToXLSX ────────────────────────────────────────────────────────────

describe('convertToXLSX', () => {
  it('should return a Buffer', () => {
    const buf = convertToXLSX(SAMPLE_ROWS, 'Prices');
    expect(buf).toBeInstanceOf(Buffer);
    expect(buf.length).toBeGreaterThan(0);
  });

  it('should produce a valid XLSX workbook with the given sheet name', () => {
    const buf = convertToXLSX(SAMPLE_ROWS, 'MySheet');
    const wb = XLSX.read(buf, { type: 'buffer' });
    expect(wb.SheetNames).toContain('MySheet');
  });

  it('should use "Data" as default sheet name', () => {
    const buf = convertToXLSX(SAMPLE_ROWS);
    const wb = XLSX.read(buf, { type: 'buffer' });
    expect(wb.SheetNames).toContain('Data');
  });

  it('should write correct data rows', () => {
    const buf = convertToXLSX(SAMPLE_ROWS, 'Prices');
    const wb = XLSX.read(buf, { type: 'buffer' });
    const rows = XLSX.utils.sheet_to_json(wb.Sheets['Prices']);
    expect(rows).toHaveLength(3);
    expect(rows[0].price).toBe(45.5);
    expect(rows[0].unit).toBe('EUR/MWh');
  });

  it('should handle empty data array', () => {
    const buf = convertToXLSX([], 'Empty');
    expect(buf).toBeInstanceOf(Buffer);
    const wb = XLSX.read(buf, { type: 'buffer' });
    expect(wb.SheetNames).toContain('Empty');
  });

  it('should handle null/undefined data', () => {
    expect(() => convertToXLSX(null, 'Sheet')).not.toThrow();
    expect(() => convertToXLSX(undefined, 'Sheet')).not.toThrow();
  });
});

// ─── applyFormat ──────────────────────────────────────────────────────────────

describe('applyFormat', () => {
  describe('JSON (default)', () => {
    it('should return result unchanged when format is undefined', () => {
      const ctx = makeMockCtx();
      const result = { data: SAMPLE_ROWS };
      expect(applyFormat(ctx, result)).toBe(result);
    });

    it('should return result unchanged when format is "json"', () => {
      const ctx = makeMockCtx();
      const result = { data: SAMPLE_ROWS };
      expect(applyFormat(ctx, result, 'json')).toBe(result);
    });

    it('should not set any response headers for json format', () => {
      const ctx = makeMockCtx();
      applyFormat(ctx, { prices: SAMPLE_ROWS }, 'json', 'prices', 'Prices');
      expect(ctx.meta.$responseHeaders).toBeUndefined();
    });
  });

  describe('CSV', () => {
    it('should return a string for format=csv', () => {
      const ctx = makeMockCtx();
      const result = { prices: SAMPLE_ROWS };
      const output = applyFormat(ctx, result, 'csv', 'prices', 'Prices');
      expect(typeof output).toBe('string');
    });

    it('should set Content-Type header to text/csv', () => {
      const ctx = makeMockCtx();
      applyFormat(ctx, { prices: SAMPLE_ROWS }, 'csv', 'prices', 'Prices');
      expect(ctx.meta.$responseHeaders['Content-Type']).toBe('text/csv; charset=utf-8');
    });

    it('should set Content-Disposition header with correct filename and .csv extension', () => {
      const ctx = makeMockCtx();
      applyFormat(ctx, { prices: SAMPLE_ROWS }, 'csv', 'day-ahead-prices', 'Prices');
      expect(ctx.meta.$responseHeaders['Content-Disposition']).toMatch(
        /^attachment; filename="day-ahead-prices-\d+\.csv"$/
      );
    });

    it('should contain CSV header and data rows from auto-detected array', () => {
      const ctx = makeMockCtx();
      const output = applyFormat(ctx, { prices: SAMPLE_ROWS }, 'csv', 'prices', 'Prices');
      expect(output).toContain('"timestamp"');
      expect(output).toContain('2026-01-01T00:00:00Z');
      expect(output).toContain('45.5');
    });

    it('should use customRows when provided', () => {
      const ctx = makeMockCtx();
      const customRows = [{ a: 1 }, { a: 2 }];
      const result = { data: { something_else: [] } };
      const output = applyFormat(ctx, result, 'csv', 'export', 'Sheet', customRows);
      expect(output).toContain('"a"');
      expect(output).toContain('1');
    });

    it('should return empty string for csv when no rows found and no error', () => {
      const ctx = makeMockCtx();
      const output = applyFormat(ctx, { unrelated: 'data' }, 'csv', 'export', 'Sheet');
      expect(output).toBe('');
    });

    it('should throw when result.data.isError is true (csv format)', () => {
      const ctx = makeMockCtx();
      const result = {
        success: true,
        data: {
          content: [{ type: 'text', text: 'No price data available for the requested period' }],
          isError: true,
        },
      };
      expect(() => applyFormat(ctx, result, 'csv', 'export', 'Sheet')).toThrow(
        'No price data available for the requested period'
      );
    });

    it('should throw when result.data.isError is true (json format)', () => {
      const ctx = makeMockCtx();
      const result = {
        data: { content: [{ type: 'text', text: 'Something went wrong' }], isError: true },
      };
      expect(() => applyFormat(ctx, result, 'json')).toThrow('Something went wrong');
    });

    it('should throw when result.data.isError is true (xlsx format)', () => {
      const ctx = makeMockCtx();
      const result = {
        data: { content: [{ type: 'text', text: 'Service unavailable' }], isError: true },
      };
      expect(() => applyFormat(ctx, result, 'xlsx')).toThrow('Service unavailable');
    });

    it('should throw with fallback message when isError has no content text', () => {
      const ctx = makeMockCtx();
      const result = { data: { isError: true } };
      expect(() => applyFormat(ctx, result)).toThrow(
        'Upstream tool returned an error with no details'
      );
    });
  });

  describe('XLSX', () => {
    it('should return a Buffer for format=xlsx', () => {
      const ctx = makeMockCtx();
      const result = { prices: SAMPLE_ROWS };
      const output = applyFormat(ctx, result, 'xlsx', 'prices', 'Prices');
      expect(output).toBeInstanceOf(Buffer);
    });

    it('should return a Buffer for format=xls (alias)', () => {
      const ctx = makeMockCtx();
      const result = { prices: SAMPLE_ROWS };
      const output = applyFormat(ctx, result, 'xls', 'prices', 'Prices');
      expect(output).toBeInstanceOf(Buffer);
    });

    it('should set Content-Type header for XLSX', () => {
      const ctx = makeMockCtx();
      applyFormat(ctx, { prices: SAMPLE_ROWS }, 'xlsx', 'prices', 'Prices');
      expect(ctx.meta.$responseHeaders['Content-Type']).toBe(
        'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'
      );
    });

    it('should set Content-Disposition header with correct filename and .xlsx extension', () => {
      const ctx = makeMockCtx();
      applyFormat(ctx, { prices: SAMPLE_ROWS }, 'xlsx', 'my-data', 'Data');
      expect(ctx.meta.$responseHeaders['Content-Disposition']).toMatch(
        /^attachment; filename="my-data-\d+\.xlsx"$/
      );
    });

    it('should produce a valid workbook with correct sheet name', () => {
      const ctx = makeMockCtx();
      const output = applyFormat(ctx, { prices: SAMPLE_ROWS }, 'xlsx', 'prices', 'PriceSheet');
      const wb = XLSX.read(output, { type: 'buffer' });
      expect(wb.SheetNames).toContain('PriceSheet');
    });

    it('should write data rows into the workbook', () => {
      const ctx = makeMockCtx();
      const output = applyFormat(ctx, { prices: SAMPLE_ROWS }, 'xlsx', 'prices', 'Prices');
      const wb = XLSX.read(output, { type: 'buffer' });
      const rows = XLSX.utils.sheet_to_json(wb.Sheets['Prices']);
      expect(rows).toHaveLength(3);
      expect(rows[0].price).toBe(45.5);
    });

    it('should use customRows when provided', () => {
      const ctx = makeMockCtx();
      const customRows = [{ x: 10 }, { x: 20 }];
      const output = applyFormat(ctx, {}, 'xlsx', 'export', 'MySheet', customRows);
      const wb = XLSX.read(output, { type: 'buffer' });
      const rows = XLSX.utils.sheet_to_json(wb.Sheets['MySheet']);
      expect(rows).toHaveLength(2);
      expect(rows[0].x).toBe(10);
    });
  });
});

// ─── OpenAPI constants ────────────────────────────────────────────────────────

describe('FORMAT_PARAM_SCHEMA', () => {
  it('should be an object with enum containing json, csv, xlsx, xls', () => {
    expect(FORMAT_PARAM_SCHEMA.enum).toEqual(['json', 'csv', 'xlsx', 'xls']);
  });

  it('should have default value of "json"', () => {
    expect(FORMAT_PARAM_SCHEMA.default).toBe('json');
  });

  it('should have type "string"', () => {
    expect(FORMAT_PARAM_SCHEMA.type).toBe('string');
  });
});

describe('FORMAT_RESPONSE_CONTENT', () => {
  it('should contain a text/csv entry', () => {
    expect(FORMAT_RESPONSE_CONTENT['text/csv']).toBeDefined();
  });

  it('should contain an application/vnd.openxmlformats-officedocument.spreadsheetml.sheet entry', () => {
    expect(
      FORMAT_RESPONSE_CONTENT['application/vnd.openxmlformats-officedocument.spreadsheetml.sheet']
    ).toBeDefined();
  });
});
