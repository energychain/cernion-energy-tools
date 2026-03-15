/**
 * CSV Connector Plugin
 */

const fs = require('fs');
const iconv = require('iconv-lite');
const path = require('path');
const zlib = require('zlib');

function normalizeEncoding(encoding) {
  const normalized = String(encoding || 'utf-8')
    .trim()
    .toLowerCase();

  if (normalized === 'utf8') return 'utf-8';
  if (normalized === 'cp1252' || normalized === 'win1252') return 'windows-1252';
  return normalized;
}

function decodeBuffer(buffer, encoding) {
  const normalizedEncoding = normalizeEncoding(encoding);
  return iconv.decode(buffer, normalizedEncoding);
}

function parseRecords(content) {
  const normalized = String(content).replace(/\r\n/g, '\n').replace(/\r/g, '\n');

  const records = [];
  let current = '';
  let inQuotes = false;

  for (let i = 0; i < normalized.length; i++) {
    const ch = normalized[i];

    if (ch === '"') {
      current += ch;
      if (inQuotes && normalized[i + 1] === '"') {
        current += '"';
        i++;
      } else {
        inQuotes = !inQuotes;
      }
      continue;
    }

    if (ch === '\n' && !inQuotes) {
      if (current.trim().length > 0) records.push(current);
      current = '';
      continue;
    }

    current += ch;
  }

  if (current.trim().length > 0) records.push(current);
  return records;
}

function parseCsvLine(line, delimiter) {
  const values = [];
  let current = '';
  let inQuotes = false;

  for (let i = 0; i < line.length; i++) {
    const ch = line[i];
    if (ch === '"') {
      if (inQuotes && line[i + 1] === '"') {
        current += '"';
        i++;
      } else {
        inQuotes = !inQuotes;
      }
      continue;
    }

    if (ch === delimiter && !inQuotes) {
      values.push(current);
      current = '';
      continue;
    }

    current += ch;
  }

  values.push(current);
  return values;
}

function detectDelimiter(firstLine, preferredDelimiter) {
  if (preferredDelimiter) return preferredDelimiter;

  const candidates = [';', ',', '\t', '|'];
  let best = ',';
  let bestColumns = 1;

  for (const candidate of candidates) {
    const cols = parseCsvLine(firstLine, candidate).length;
    if (cols > bestColumns) {
      bestColumns = cols;
      best = candidate;
    }
  }

  return best;
}

function inferSchema(rows) {
  const fields = [];
  if (!rows.length) return { fields };
  const names = Object.keys(rows[0]);
  names.forEach((name) => {
    fields.push({
      name,
      type: 'string',
      example: rows[0][name] ?? null,
    });
  });
  return { fields };
}

module.exports = {
  type: 'csv',
  description: 'Read delimited text files (CSV, TSV) from local file system.',
  configSchema: {
    type: 'object',
    required: ['path'],
    properties: {
      path: {
        type: 'string',
        description: 'Absolute or relative path to the CSV/TSV file.',
      },
      delimiter: {
        type: 'string',
        description: 'Optional delimiter override. If omitted, the connector auto-detects it.',
      },
      encoding: {
        type: 'string',
        enum: ['utf-8', 'latin1', 'windows-1252'],
        default: 'utf-8',
        description: 'Text encoding used to decode the file contents.',
      },
      hasHeader: {
        type: 'boolean',
        default: true,
        description: 'Whether the first non-skipped row contains column headers.',
      },
      skipRows: {
        type: 'integer',
        minimum: 0,
        default: 0,
        description: 'Number of non-empty metadata rows to skip before reading the header row.',
      },
    },
  },

  async read(connectorConfig, options = {}) {
    const filePath = connectorConfig.path;
    const configuredDelimiter = connectorConfig.delimiter;
    const encoding = normalizeEncoding(connectorConfig.encoding || 'utf-8');
    const hasHeader = connectorConfig.hasHeader !== false;
    const parsedSkipRows = Number.parseInt(connectorConfig.skipRows, 10);
    const skipRows = Number.isInteger(parsedSkipRows) && parsedSkipRows > 0 ? parsedSkipRows : 0;

    const resolvedPath = path.resolve(filePath);
    let rawBuffer = fs.readFileSync(resolvedPath);

    if (resolvedPath.endsWith('.gz')) {
      rawBuffer = zlib.gunzipSync(rawBuffer);
    }

    const content = decodeBuffer(rawBuffer, encoding);
    const records = parseRecords(content).slice(skipRows);
    if (records.length === 0) {
      return { rows: [], inferredSchema: { fields: [] } };
    }

    const [firstRecord, ...restRecords] = records;
    const delimiter = detectDelimiter(firstRecord, configuredDelimiter);
    const headers = hasHeader
      ? parseCsvLine(firstRecord, delimiter).map((h) =>
          String(h)
            .replace(/^\uFEFF/, '')
            .trim()
        )
      : parseCsvLine(firstRecord, delimiter).map((_, index) => `column_${index + 1}`);

    const dataLines = hasHeader ? restRecords : [firstRecord, ...restRecords];
    const maxRows = Number.isInteger(options.limit) ? options.limit : undefined;
    const rows = [];

    for (const line of dataLines) {
      const cells = parseCsvLine(line, delimiter);
      const row = {};
      headers.forEach((header, index) => {
        row[header] = cells[index] !== undefined ? cells[index] : null;
      });
      rows.push(row);
      if (maxRows && rows.length >= maxRows) break;
    }

    return {
      rows,
      inferredSchema: inferSchema(rows),
    };
  },
};
