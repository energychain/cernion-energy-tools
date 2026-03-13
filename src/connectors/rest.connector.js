/**
 * REST Connector Plugin
 */

const axios = require('axios');

function pickJsonPath(payload, pathExpression) {
  if (!pathExpression) return payload;
  return pathExpression.split('.').reduce((acc, key) => (acc ? acc[key] : undefined), payload);
}

function parseCsv(text, delimiter = ';') {
  const lines = String(text)
    .replace(/\r\n/g, '\n')
    .replace(/\r/g, '\n')
    .split('\n')
    .filter((line) => line.trim().length > 0);

  if (!lines.length) return [];

  const headers = lines[0].split(delimiter).map((h) => h.trim());
  return lines.slice(1).map((line) => {
    const values = line.split(delimiter);
    const row = {};
    headers.forEach((header, idx) => {
      row[header] = values[idx] !== undefined ? values[idx] : null;
    });
    return row;
  });
}

function inferSchema(rows) {
  if (!rows.length) return { fields: [] };
  const fields = Object.keys(rows[0]).map((name) => ({
    name,
    type: 'string',
    example: rows[0][name] ?? null,
  }));
  return { fields };
}

module.exports = {
  type: 'rest',
  description: 'Fetch structured data from HTTP/HTTPS endpoints (JSON or CSV).',
  configSchema: {
    type: 'object',
    required: ['url'],
    properties: {
      url: { type: 'string' },
      method: { type: 'string' },
      headers: { type: 'object' },
      body: { type: 'object' },
      responseType: { type: 'string', enum: ['json', 'csv'] },
      jsonPath: { type: 'string' },
      authType: { type: 'string', enum: ['none', 'bearer', 'basic', 'apikey'] },
      authConfig: { type: 'object' },
      delimiter: { type: 'string' },
    },
  },

  async read(connectorConfig, options = {}) {
    const method = (connectorConfig.method || 'GET').toUpperCase();
    const headers = { ...(connectorConfig.headers || {}) };

    if (connectorConfig.authType === 'bearer' && connectorConfig.authConfig?.token) {
      headers.Authorization = `Bearer ${connectorConfig.authConfig.token}`;
    }

    const response = await axios({
      method,
      url: connectorConfig.url,
      headers,
      data: connectorConfig.body,
      timeout: options.timeoutMs || 30000,
    });

    let rows;
    if (connectorConfig.responseType === 'csv') {
      rows = parseCsv(response.data, connectorConfig.delimiter || ';');
    } else {
      const selected = pickJsonPath(response.data, connectorConfig.jsonPath);
      if (Array.isArray(selected)) {
        rows = selected;
      } else if (selected && typeof selected === 'object') {
        rows = [selected];
      } else {
        rows = [];
      }
    }

    if (Number.isInteger(options.limit)) {
      rows = rows.slice(0, options.limit);
    }

    return {
      rows,
      inferredSchema: inferSchema(rows),
    };
  },
};
