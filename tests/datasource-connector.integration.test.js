'use strict';

/**
 * CR-DS-019: Integration tests for datasource connector plugins.
 *
 * These tests exercise each connector plugin directly (no broker mocks) against
 * real temporary files created in the OS temp directory. They verify that the
 * full read + inferredSchema pipeline works end-to-end for each supported format.
 */

const fs = require('fs');
const os = require('os');
const path = require('path');

// ── helpers ──────────────────────────────────────────────────────────────────

function tmpFile(name) {
  return path.join(os.tmpdir(), `cernion-test-${Date.now()}-${name}`);
}

function writeTmp(name, content, encoding = 'utf-8') {
  const filePath = tmpFile(name);
  fs.writeFileSync(filePath, content, encoding);
  return filePath;
}

const createdFiles = [];
function tracked(filePath) {
  createdFiles.push(filePath);
  return filePath;
}

afterAll(() => {
  createdFiles.forEach((f) => {
    try {
      fs.unlinkSync(f);
    } catch (_) {
      // best-effort cleanup
    }
  });
});

// ── CSV connector ─────────────────────────────────────────────────────────────

describe('CSV connector integration', () => {
  const csvConnector = require('../src/connectors/csv.connector');

  it('reads a semicolon-delimited CSV file and infers schema', async () => {
    const content = 'id;name;value\n1;Alice;42\n2;Bob;99\n';
    const filePath = tracked(writeTmp('data.csv', content));

    const result = await csvConnector.read({ path: filePath, delimiter: ';' }, {});

    expect(result.rows).toHaveLength(2);
    expect(result.rows[0]).toMatchObject({ id: '1', name: 'Alice', value: '42' });
    expect(result.rows[1]).toMatchObject({ id: '2', name: 'Bob', value: '99' });

    expect(result.inferredSchema.fields.map((f) => f.name)).toEqual(['id', 'name', 'value']);
  });

  it('respects options.limit', async () => {
    const lines = ['col\n', ...Array.from({ length: 20 }, (_, i) => `row${i}\n`)].join('');
    const filePath = tracked(writeTmp('large.csv', lines));

    const result = await csvConnector.read({ path: filePath, delimiter: ',' }, { limit: 5 });

    expect(result.rows).toHaveLength(5);
  });

  it('handles a tab-delimited TSV file', async () => {
    const content = 'a\tb\tc\n10\t20\t30\n';
    const filePath = tracked(writeTmp('data.tsv', content));

    const result = await csvConnector.read({ path: filePath, delimiter: '\t' }, {});

    expect(result.rows).toHaveLength(1);
    expect(result.rows[0]).toMatchObject({ a: '10', b: '20', c: '30' });
  });

  it('returns empty rows for a header-only file', async () => {
    const content = 'col1;col2\n';
    const filePath = tracked(writeTmp('empty.csv', content));

    const result = await csvConnector.read({ path: filePath, delimiter: ';' }, {});

    expect(result.rows).toHaveLength(0);
    expect(result.inferredSchema.fields).toEqual([]);
  });

  it('auto-detects comma delimiter when not configured', async () => {
    const content = 'Zeit,Leistung Bezug (W),Leistung Einspeisung (W)\n10.03.2026 00:00,1000,0\n';
    const filePath = tracked(writeTmp('autodetect-comma.csv', content));

    const result = await csvConnector.read({ path: filePath }, {});

    expect(result.rows).toHaveLength(1);
    expect(result.rows[0]).toMatchObject({
      Zeit: '10.03.2026 00:00',
      'Leistung Bezug (W)': '1000',
      'Leistung Einspeisung (W)': '0',
    });
    expect(result.inferredSchema.fields.map((f) => f.name)).toEqual(
      expect.arrayContaining(['Zeit', 'Leistung Bezug (W)', 'Leistung Einspeisung (W)'])
    );
  });

  it('handles quoted fields with embedded delimiters', async () => {
    const content = 'name;address\n"Smith, John";"123 Main St"\n';
    const filePath = tracked(writeTmp('quoted.csv', content));

    const result = await csvConnector.read({ path: filePath, delimiter: ';' }, {});

    expect(result.rows[0].name).toBe('Smith, John');
    expect(result.rows[0].address).toBe('123 Main St');
  });
});

// ── GeoJSON connector ─────────────────────────────────────────────────────────

describe('GeoJSON connector integration', () => {
  const geojsonConnector = require('../src/connectors/geojson.connector');

  it('reads a FeatureCollection and flattens properties', async () => {
    const geojson = {
      type: 'FeatureCollection',
      features: [
        {
          type: 'Feature',
          geometry: { type: 'Point', coordinates: [8.682, 50.11] },
          properties: { name: 'Frankfurt', population: 760000 },
        },
        {
          type: 'Feature',
          geometry: { type: 'Point', coordinates: [11.576, 48.137] },
          properties: { name: 'München', population: 1488000 },
        },
      ],
    };

    const filePath = tracked(writeTmp('cities.geojson', JSON.stringify(geojson)));
    const result = await geojsonConnector.read({ path: filePath }, {});

    expect(result.rows).toHaveLength(2);
    expect(result.rows[0]).toMatchObject({
      name: 'Frankfurt',
      population: 760000,
      geometry_type: 'Point',
      longitude: 8.682,
      latitude: 50.11,
    });
    expect(result.rows[1].name).toBe('München');
  });

  it('resolves nested featureCollection dot-path', async () => {
    const nested = {
      envelope: {
        type: 'FeatureCollection',
        features: [
          {
            type: 'Feature',
            geometry: { type: 'Point', coordinates: [13.405, 52.52] },
            properties: { city: 'Berlin' },
          },
        ],
      },
    };

    const filePath = tracked(writeTmp('nested.geojson', JSON.stringify(nested)));
    const result = await geojsonConnector.read(
      { path: filePath, featureCollection: 'envelope' },
      {}
    );

    expect(result.rows).toHaveLength(1);
    expect(result.rows[0].city).toBe('Berlin');
  });

  it('respects options.limit for feature count', async () => {
    const geojson = {
      type: 'FeatureCollection',
      features: Array.from({ length: 10 }, (_, i) => ({
        type: 'Feature',
        geometry: { type: 'Point', coordinates: [i, i] },
        properties: { index: i },
      })),
    };

    const filePath = tracked(writeTmp('many.geojson', JSON.stringify(geojson)));
    const result = await geojsonConnector.read({ path: filePath }, { limit: 3 });

    expect(result.rows).toHaveLength(3);
  });

  it('infers schema with longitude/latitude fields', async () => {
    const geojson = {
      type: 'FeatureCollection',
      features: [
        {
          type: 'Feature',
          geometry: { type: 'Polygon', coordinates: [[[9.0, 48.0], [9.1, 48.0], [9.0, 48.1]]] },
          properties: { region: 'BW' },
        },
      ],
    };

    const filePath = tracked(writeTmp('polygon.geojson', JSON.stringify(geojson)));
    const result = await geojsonConnector.read({ path: filePath }, {});

    const fieldNames = result.inferredSchema.fields.map((f) => f.name);
    expect(fieldNames).toContain('longitude');
    expect(fieldNames).toContain('latitude');
    expect(fieldNames).toContain('geometry_type');
  });
});

// ── XLSX connector ────────────────────────────────────────────────────────────

describe('XLSX connector integration', () => {
  const xlsxConnector = require('../src/connectors/xlsx.connector');
  const XLSX = require('xlsx');

  function createTestWorkbook(rows, sheetName = 'Sheet1') {
    const worksheet = XLSX.utils.json_to_sheet(rows);
    const workbook = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(workbook, worksheet, sheetName);
    return workbook;
  }

  it('reads rows from the default first sheet', async () => {
    const wb = createTestWorkbook([
      { kundennummer: '1001', name: 'Müller GmbH', verbrauch: 15000 },
      { kundennummer: '1002', name: 'Bauer AG', verbrauch: 8400 },
    ]);
    const filePath = tracked(tmpFile('customers.xlsx'));
    XLSX.writeFile(wb, filePath);

    const result = await xlsxConnector.read({ path: filePath }, {});

    expect(result.rows).toHaveLength(2);
    expect(result.rows[0].name).toBe('Müller GmbH');
    expect(result.inferredSchema.fields.map((f) => f.name)).toContain('kundennummer');
  });

  it('reads a named sheet', async () => {
    const wb = createTestWorkbook([{ col: 'a' }], 'Daten');
    const filePath = tracked(tmpFile('named-sheet.xlsx'));
    XLSX.writeFile(wb, filePath);

    const result = await xlsxConnector.read({ path: filePath, sheetName: 'Daten' }, {});

    expect(result.rows).toHaveLength(1);
  });

  it('applies columnMapping', async () => {
    const wb = createTestWorkbook([{ A: 'value1', B: 'value2' }]);
    const filePath = tracked(tmpFile('mapping.xlsx'));
    XLSX.writeFile(wb, filePath);

    const result = await xlsxConnector.read(
      { path: filePath, columnMapping: { A: 'alpha', B: 'beta' } },
      {}
    );

    expect(result.rows[0]).toMatchObject({ alpha: 'value1', beta: 'value2' });
  });

  it('respects options.limit', async () => {
    const rows = Array.from({ length: 20 }, (_, i) => ({ id: i, val: `row-${i}` }));
    const wb = createTestWorkbook(rows);
    const filePath = tracked(tmpFile('limit.xlsx'));
    XLSX.writeFile(wb, filePath);

    const result = await xlsxConnector.read({ path: filePath }, { limit: 4 });

    expect(result.rows).toHaveLength(4);
  });

  it('returns empty rows for a non-existent sheet name', async () => {
    const wb = createTestWorkbook([{ x: 1 }]);
    const filePath = tracked(tmpFile('nosheet.xlsx'));
    XLSX.writeFile(wb, filePath);

    const result = await xlsxConnector.read({ path: filePath, sheetName: 'Missing' }, {});

    expect(result.rows).toHaveLength(0);
  });
});

// ── REST connector ────────────────────────────────────────────────────────────
// The REST connector calls axios() as a direct function call, so we use
// jest.mock at module level with a factory and control via mockResolvedValue.

jest.mock('axios', () => jest.fn());

describe('REST connector integration', () => {
  const axios = require('axios');
  const restConnector = require('../src/connectors/rest.connector');

  afterEach(() => {
    axios.mockReset();
  });

  it('fetches JSON array from a mock endpoint via axios', async () => {
    axios.mockResolvedValue({
      data: [
        { id: 1, energy: 'solar' },
        { id: 2, energy: 'wind' },
      ],
    });

    const result = await restConnector.read({ url: 'https://mock.example.com/api/data' }, {});

    expect(result.rows).toHaveLength(2);
    expect(result.rows[0]).toMatchObject({ id: 1, energy: 'solar' });
    expect(result.inferredSchema.fields.map((f) => f.name)).toContain('energy');
  });

  it('normalises a JSON object with a data array via jsonPath', async () => {
    axios.mockResolvedValue({
      data: { result: [{ price: 45.5 }] },
    });

    const result = await restConnector.read(
      { url: 'https://mock.example.com/prices', jsonPath: 'result' },
      {}
    );

    expect(result.rows[0]).toMatchObject({ price: 45.5 });
  });
});

// ── Connector plugin meta ─────────────────────────────────────────────────────

describe('Connector plugin structure', () => {
  const plugins = ['csv', 'rest', 'geojson', 'xlsx', 'docx', 'scraper'];

  plugins.forEach((pluginType) => {
    it(`${pluginType} connector exports required fields`, () => {
      const plugin = require(`../src/connectors/${pluginType}.connector`);
      expect(typeof plugin.type).toBe('string');
      expect(plugin.type).toBe(pluginType);
      expect(typeof plugin.description).toBe('string');
      expect(typeof plugin.read).toBe('function');
    });
  });
});
