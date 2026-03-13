/**
 * XLSX Connector Plugin
 */

const path = require('path');
const XLSX = require('xlsx');

function inferSchema(rows) {
  if (!rows.length) return { fields: [] };
  return {
    fields: Object.keys(rows[0]).map((name) => ({
      name,
      type: typeof rows[0][name] === 'number' ? 'number' : 'string',
      example: rows[0][name],
    })),
  };
}

module.exports = {
  type: 'xlsx',
  description: 'Read spreadsheet rows from XLSX workbooks.',
  configSchema: {
    type: 'object',
    required: ['path'],
    properties: {
      path: { type: 'string' },
      sheetName: { type: 'string' },
      sheetIndex: { type: 'integer' },
      headerRow: { type: 'integer' },
      dataStartRow: { type: 'integer' },
      columnMapping: { type: 'object' },
      password: { type: 'string' },
    },
  },

  async read(connectorConfig, options = {}) {
    const resolvedPath = path.resolve(connectorConfig.path);
    const workbook = XLSX.readFile(resolvedPath, {
      password: connectorConfig.password,
    });

    const sheetName =
      connectorConfig.sheetName ||
      workbook.SheetNames[Number.isInteger(connectorConfig.sheetIndex) ? connectorConfig.sheetIndex : 0];

    const worksheet = workbook.Sheets[sheetName];
    if (!worksheet) {
      return {
        rows: [],
        inferredSchema: { fields: [] },
      };
    }

    const rows = XLSX.utils.sheet_to_json(worksheet, {
      defval: null,
      raw: false,
    });

    let mappedRows = rows;
    if (connectorConfig.columnMapping && typeof connectorConfig.columnMapping === 'object') {
      mappedRows = rows.map((row) => {
        const out = {};
        Object.entries(row).forEach(([key, value]) => {
          out[connectorConfig.columnMapping[key] || key] = value;
        });
        return out;
      });
    }

    if (Number.isInteger(options.limit)) {
      mappedRows = mappedRows.slice(0, options.limit);
    }

    return {
      rows: mappedRows,
      inferredSchema: inferSchema(mappedRows),
    };
  },
};
