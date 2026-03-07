/**
 * Format Response Helper
 *
 * Shared CSV / XLSX export utilities for all tabular-data endpoints.
 * Keeps format logic out of individual services and avoids copy-paste.
 *
 * Usage:
 *   const { applyFormat } = require('../src/format-response');
 *   // In action handler:
 *   const { format, ...mcpParams } = ctx.params;
 *   const result = await CernionMCPClient.callWithNewSession(tool, mcpParams, token);
 *   return applyFormat(ctx, result, format, 'my-data', 'Sheet1');
 */

const XLSX = require('xlsx');

// ─── Candidate array field names tried in order ───────────────────────────────
const TOP_LEVEL_ARRAY_KEYS = [
  'prices',
  'dataPoints',
  'generation',
  'forecasts',
  'unavailabilities',
  'flows',
  'loads',
  'results',
  'entries',
  'timeSeries',
  'operators',
  'facilities',
  'installations',
  'types',
];

const NESTED_ARRAY_KEYS = [
  'prices',
  'dataPoints',
  'timeSeries',
  'results',
  'installations',
  'comparison',
  'operators',
  'facilities',
  'entries',
  'generation',
  'forecasts',
  'flows',
  'loads',
  'types',
];

// ─── Row extraction ────────────────────────────────────────────────────────────

/**
 * Find the first array-valued field in a MCP tool result.
 *
 * Search order:
 *  1. Top-level array fields (result.prices, result.generation, …)
 *  2. result.data directly if it is an array
 *  3. Nested fields inside result.data (result.data.timeSeries, …)
 *
 * @param {object} result  Raw MCP response
 * @returns {Array}        Extracted rows (may be empty)
 */
function extractRows(result) {
  if (!result) return [];

  // 1. top-level array fields
  for (const key of TOP_LEVEL_ARRAY_KEYS) {
    if (Array.isArray(result[key])) return result[key];
  }

  // 2. result.data is already an array
  if (Array.isArray(result.data)) return result.data;

  // 3. array fields nested inside result.data
  if (result.data && typeof result.data === 'object') {
    for (const key of NESTED_ARRAY_KEYS) {
      if (Array.isArray(result.data[key])) return result.data[key];
    }
  }

  return [];
}

// ─── CSV serialiser ────────────────────────────────────────────────────────────

/**
 * Convert an array of plain objects to a RFC 4180–compliant CSV string.
 *
 * Column order follows the union of all keys found across all rows, preserving
 * the key insertion order of the first row (subsequent rows may add extra cols).
 *
 * @param {Array<object>} data
 * @returns {string}
 */
function convertToCSV(data) {
  if (!data || data.length === 0) return '';

  // Build ordered, deduplicated column list
  const allKeys = [...new Set(data.flatMap((obj) => Object.keys(obj)))];

  const header = allKeys.map((key) => `"${key}"`).join(',');

  const rows = data.map((obj) =>
    allKeys
      .map((key) => {
        const value = obj[key];
        if (value === null || value === undefined) return '';
        if (typeof value === 'number') return value;
        // Nested objects / arrays → JSON-encode inside quoted cell
        if (typeof value === 'object') return `"${JSON.stringify(value).replace(/"/g, '""')}"`;
        return `"${String(value).replace(/"/g, '""')}"`;
      })
      .join(',')
  );

  return [header, ...rows].join('\n');
}

// ─── XLSX serialiser ───────────────────────────────────────────────────────────

/**
 * Convert an array of plain objects to an XLSX Buffer.
 *
 * @param {Array<object>} data
 * @param {string}        [sheetName='Data']  Name of the worksheet
 * @returns {Buffer}
 */
function convertToXLSX(data, sheetName = 'Data') {
  const wb = XLSX.utils.book_new();

  if (!data || data.length === 0) {
    const ws = XLSX.utils.aoa_to_sheet([['No data available']]);
    XLSX.utils.book_append_sheet(wb, ws, sheetName);
    return XLSX.write(wb, { type: 'buffer', bookType: 'xlsx' });
  }

  const ws = XLSX.utils.json_to_sheet(data);

  // Auto-size columns (cap at 50 chars)
  const range = XLSX.utils.decode_range(ws['!ref']);
  const colWidths = [];
  for (let C = range.s.c; C <= range.e.c; ++C) {
    let maxWidth = 10;
    for (let R = range.s.r; R <= range.e.r; ++R) {
      const cell = ws[XLSX.utils.encode_cell({ r: R, c: C })];
      if (cell && cell.v != null) {
        maxWidth = Math.max(maxWidth, String(cell.v).length);
      }
    }
    colWidths.push({ wch: Math.min(maxWidth + 2, 50) });
  }
  ws['!cols'] = colWidths;

  XLSX.utils.book_append_sheet(wb, ws, sheetName);
  return XLSX.write(wb, { type: 'buffer', bookType: 'xlsx' });
}

// ─── Main entry point ─────────────────────────────────────────────────────────

/**
 * Apply the requested output format to a MCP result.
 *
 * - 'json' (default): return the result object unchanged
 * - 'csv':  extract rows → CSV string, set Content-* headers
 * - 'xlsx' / 'xls': extract rows → XLSX buffer, set Content-* headers
 *
 * @param {object} ctx          Moleculer context
 * @param {object} result       Raw MCP response
 * @param {string} [format]     'json' | 'csv' | 'xlsx' | 'xls'  (default 'json')
 * @param {string} [filename]   Base filename without extension  (default 'export')
 * @param {string} [sheetName]  XLSX sheet name                  (default 'Data')
 * @param {Array}  [rows]       Pre-extracted rows (skips auto-detection when provided)
 * @returns {object|string|Buffer}
 */
function applyFormat(
  ctx,
  result,
  format,
  filename = 'export',
  sheetName = 'Data',
  customRows = null
) {
  // Surface upstream tool errors regardless of the requested output format.
  // Without this guard, CSV/XLSX requests silently return a 0-byte file,
  // making it impossible for the caller to distinguish "no data" from an error.
  if (result?.data?.isError === true) {
    const errorText =
      result?.data?.content?.[0]?.text || 'Upstream tool returned an error with no details';
    throw new Error(errorText);
  }

  if (format === 'csv') {
    const data = customRows !== null ? customRows : extractRows(result);
    ctx.meta.$responseHeaders = {
      'Content-Type': 'text/csv; charset=utf-8',
      'Content-Disposition': `attachment; filename="${filename}-${Date.now()}.csv"`,
    };
    return convertToCSV(data);
  }

  if (format === 'xlsx' || format === 'xls') {
    const data = customRows !== null ? customRows : extractRows(result);
    ctx.meta.$responseHeaders = {
      'Content-Type': 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
      'Content-Disposition': `attachment; filename="${filename}-${Date.now()}.xlsx"`,
    };
    return convertToXLSX(data, sheetName);
  }

  // Default: JSON pass-through
  return result;
}

// ─── OpenAPI helpers ──────────────────────────────────────────────────────────

/**
 * OpenAPI schema fragment for the `format` request-body property.
 * Add this to every action's requestBody schema.properties.
 */
const FORMAT_PARAM_SCHEMA = {
  type: 'string',
  enum: ['json', 'csv', 'xlsx', 'xls'],
  description: 'Output format. "csv" and "xls"/"xlsx" trigger a file download.',
  default: 'json',
};

/**
 * OpenAPI response content entries for CSV and XLSX.
 * Merge these alongside 'application/json' in responses[200].content.
 */
const FORMAT_RESPONSE_CONTENT = {
  'text/csv': {
    description: 'CSV download (when format=csv)',
    schema: { type: 'string' },
  },
  'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet': {
    description: 'Excel XLSX download (when format=xlsx or format=xls)',
    schema: { type: 'string', format: 'binary' },
  },
};

module.exports = {
  extractRows,
  convertToCSV,
  convertToXLSX,
  applyFormat,
  FORMAT_PARAM_SCHEMA,
  FORMAT_RESPONSE_CONTENT,
};
