/**
 * CSV Connector Plugin
 */

const fs = require('fs');
const path = require('path');
const zlib = require('zlib');

function parseLines(content) {
  return String(content)
    .replace(/\r\n/g, '\n')
    .replace(/\r/g, '\n')
    .split('\n')
    .filter((line) => line.trim().length > 0);
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
      path: { type: 'string' },
      delimiter: { type: 'string' },
      encoding: { type: 'string' },
      hasHeader: { type: 'boolean' },
      skipRows: { type: 'integer' },
    },
  },

  async read(connectorConfig, options = {}) {
    const filePath = connectorConfig.path;
    const configuredDelimiter = connectorConfig.delimiter;
    const encoding = connectorConfig.encoding || 'utf-8';
    const hasHeader = connectorConfig.hasHeader !== false;
    const skipRows = Number.isInteger(connectorConfig.skipRows) ? connectorConfig.skipRows : 0;

    const resolvedPath = path.resolve(filePath);
    let rawBuffer = fs.readFileSync(resolvedPath);

    if (resolvedPath.endsWith('.gz')) {
      rawBuffer = zlib.gunzipSync(rawBuffer);
    }

    const content = rawBuffer.toString(encoding);
    const lines = parseLines(content).slice(skipRows);
    if (lines.length === 0) {
      return { rows: [], inferredSchema: { fields: [] } };
    }

    const [firstLine, ...restLines] = lines;
    const delimiter = detectDelimiter(firstLine, configuredDelimiter);
    const headers = hasHeader
      ? parseCsvLine(firstLine, delimiter).map((h) => String(h).replace(/^\uFEFF/, '').trim())
      : parseCsvLine(firstLine, delimiter).map((_, index) => `column_${index + 1}`);

    const dataLines = hasHeader ? restLines : [firstLine, ...restLines];
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
