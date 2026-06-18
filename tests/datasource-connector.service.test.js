/**
 * Datasource Connector Service Tests
 */

const fs = require('fs');
const os = require('os');
const path = require('path');
const http = require('http');
const XLSX = require('xlsx');
const { ServiceBroker } = require('moleculer');

const DatasourceConnectorService = require('../services/datasource-connector.service');

describe('Datasource Connector Service', () => {
  let broker;

  beforeAll(async () => {
    broker = new ServiceBroker({ logger: false, transporter: null });
    broker.createService(DatasourceConnectorService);
    await broker.start();
  });

  afterAll(async () => {
    await broker.stop();
  });

  it('should load built-in plugins', async () => {
    const result = await broker.call('datasource-connector.listPlugins', {});

    expect(result.success).toBe(true);
    const pluginTypes = result.data.map((plugin) => plugin.type);
    expect(pluginTypes).toContain('csv');
    expect(pluginTypes).toContain('rest');
    expect(pluginTypes).toContain('geojson');
    expect(pluginTypes).toContain('docx');
    expect(pluginTypes).toContain('xlsx');
    expect(pluginTypes).toContain('scraper');
  });

  it('should validate required config for csv plugin', async () => {
    const invalid = await broker.call('datasource-connector.validateConfig', {
      connectorType: 'csv',
      connectorConfig: {},
    });

    expect(invalid.valid).toBe(false);
    expect(invalid.errors.join(' ')).toContain('path');

    const valid = await broker.call('datasource-connector.validateConfig', {
      connectorType: 'csv',
      connectorConfig: { path: '/tmp/example.csv' },
    });

    expect(valid.valid).toBe(true);
  });

  it('should expose csv encoding and skipRows in config schema', async () => {
    const result = await broker.call('datasource-connector.listPlugins', {});
    const csvPlugin = result.data.find((plugin) => plugin.type === 'csv');

    expect(csvPlugin).toBeDefined();
    expect(csvPlugin.configSchema.properties.encoding).toMatchObject({
      type: 'string',
      default: 'utf-8',
      enum: ['utf-8', 'latin1', 'windows-1252'],
    });
    expect(csvPlugin.configSchema.properties.skipRows).toMatchObject({
      type: 'integer',
      default: 0,
      minimum: 0,
    });
  });

  it('should reject negative skipRows for csv plugin', async () => {
    const invalid = await broker.call('datasource-connector.validateConfig', {
      connectorType: 'csv',
      connectorConfig: { path: '/tmp/example.csv', skipRows: -1 },
    });

    expect(invalid.valid).toBe(false);
    expect(invalid.errors).toContain('Invalid value for skipRows: expected >= 0');
  });

  it('should read rows from csv connector', async () => {
    const tmpFile = path.join(os.tmpdir(), `cernion-ds-${Date.now()}.csv`);
    fs.writeFileSync(tmpFile, ['name;value', 'A;1', 'B;2'].join('\n'), 'utf-8');

    const result = await broker.call('datasource-connector.read', {
      sourceId: 'test-source',
      connectorType: 'csv',
      connectorConfig: {
        path: tmpFile,
        delimiter: ';',
      },
      options: {
        limit: 1,
      },
    });

    expect(result.success).toBe(true);
    expect(result.sourceId).toBe('test-source');
    expect(result.rows).toHaveLength(1);
    expect(result.rows[0]).toEqual({ name: 'A', value: '1' });

    fs.unlinkSync(tmpFile);
  });

  it('should infer schema from csv connector', async () => {
    const tmpFile = path.join(os.tmpdir(), `cernion-ds-infer-${Date.now()}.csv`);
    fs.writeFileSync(tmpFile, ['field_a;field_b', 'X;10'].join('\n'), 'utf-8');

    const result = await broker.call('datasource-connector.inferSchema', {
      connectorType: 'csv',
      connectorConfig: {
        path: tmpFile,
      },
      sampleRows: 10,
    });

    expect(result.success).toBe(true);
    expect(result.inferredSchema.fields.map((f) => f.name)).toEqual(
      expect.arrayContaining(['field_a', 'field_b'])
    );

    fs.unlinkSync(tmpFile);
  });

  it('should skip metadata rows before reading the csv header', async () => {
    const tmpFile = path.join(os.tmpdir(), `cernion-ds-skip-${Date.now()}.csv`);
    fs.writeFileSync(
      tmpFile,
      ['Export erstellt am 2026-03-14', 'Mandant: STROMDAO', 'name;value', 'A;1', 'B;2'].join('\n'),
      'utf-8'
    );

    const result = await broker.call('datasource-connector.read', {
      connectorType: 'csv',
      connectorConfig: {
        path: tmpFile,
        delimiter: ';',
        skipRows: 2,
      },
    });

    expect(result.success).toBe(true);
    expect(result.rows).toHaveLength(2);
    expect(result.rows[0]).toEqual({ name: 'A', value: '1' });

    fs.unlinkSync(tmpFile);
  });

  it('should decode latin1 csv files when configured', async () => {
    const tmpFile = path.join(os.tmpdir(), `cernion-ds-latin1-${Date.now()}.csv`);
    fs.writeFileSync(tmpFile, ['name;city', 'Jürgen;München'].join('\n'), 'latin1');

    const result = await broker.call('datasource-connector.read', {
      connectorType: 'csv',
      connectorConfig: {
        path: tmpFile,
        delimiter: ';',
        encoding: 'latin1',
      },
    });

    expect(result.success).toBe(true);
    expect(result.rows[0]).toEqual({ name: 'Jürgen', city: 'München' });

    fs.unlinkSync(tmpFile);
  });

  it('should read JSON rows from rest connector', async () => {
    const server = http.createServer((req, res) => {
      if (req.url === '/items') {
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ data: { items: [{ id: 1, name: 'alpha' }] } }));
        return;
      }
      res.writeHead(404, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ error: 'not found' }));
    });

    await new Promise((resolve) => server.listen(0, resolve));
    const address = server.address();
    const port = typeof address === 'object' && address ? address.port : null;

    const result = await broker.call('datasource-connector.read', {
      connectorType: 'rest',
      connectorConfig: {
        url: `http://127.0.0.1:${port}/items`,
        responseType: 'json',
        jsonPath: 'data.items',
      },
    });

    expect(result.success).toBe(true);
    expect(result.rows).toHaveLength(1);
    expect(result.rows[0].name).toBe('alpha');

    await new Promise((resolve) => server.close(resolve));
  });

  it('should read rows from geojson connector', async () => {
    const tmpFile = path.join(os.tmpdir(), `cernion-ds-geojson-${Date.now()}.geojson`);
    const payload = {
      type: 'FeatureCollection',
      features: [
        {
          type: 'Feature',
          geometry: { type: 'Point', coordinates: [8.47, 49.49] },
          properties: { anschlussnummer: 'STROMDAO-1', leistung_kw: 12.5 },
        },
      ],
    };
    fs.writeFileSync(tmpFile, JSON.stringify(payload), 'utf-8');

    const result = await broker.call('datasource-connector.read', {
      connectorType: 'geojson',
      connectorConfig: {
        path: tmpFile,
      },
    });

    expect(result.success).toBe(true);
    expect(result.rows).toHaveLength(1);
    expect(result.rows[0].anschlussnummer).toBe('STROMDAO-1');
    expect(result.rows[0].longitude).toBe(8.47);

    fs.unlinkSync(tmpFile);
  });

  it('should read rows from xlsx connector', async () => {
    const tmpFile = path.join(os.tmpdir(), `cernion-ds-xlsx-${Date.now()}.xlsx`);
    const worksheet = XLSX.utils.json_to_sheet([
      { anschlussnummer: 'STROMDAO-100', leistung_kw: 22 },
      { anschlussnummer: 'STROMDAO-101', leistung_kw: 31 },
    ]);
    const workbook = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(workbook, worksheet, 'Data');
    XLSX.writeFile(workbook, tmpFile);

    const result = await broker.call('datasource-connector.read', {
      connectorType: 'xlsx',
      connectorConfig: {
        path: tmpFile,
        sheetName: 'Data',
      },
      options: {
        limit: 1,
      },
    });

    expect(result.success).toBe(true);
    expect(result.rows).toHaveLength(1);
    expect(result.rows[0].anschlussnummer).toBe('STROMDAO-100');

    fs.unlinkSync(tmpFile);
  });

  // ── CR-UI-013: REST route + OpenAPI annotation ─────────────────────
  describe('listPlugins REST route and OpenAPI annotation', () => {
    it('should expose a REST GET route on the listPlugins action', () => {
      const action = DatasourceConnectorService.actions.listPlugins;
      expect(action).toBeDefined();
      expect(action.rest).toBeDefined();
      expect(typeof action.rest).toBe('string');
      expect(action.rest.toLowerCase()).toContain('get');
      expect(action.rest).toContain('connector-types');
    });

    it('should have an openapi annotation tagged DataSources', () => {
      const action = DatasourceConnectorService.actions.listPlugins;
      expect(action.openapi).toBeDefined();
      expect(action.openapi.tags).toBeDefined();
      expect(Array.isArray(action.openapi.tags)).toBe(true);
      expect(action.openapi.tags).toContain('DataSources');
      expect(typeof action.openapi.summary).toBe('string');
      expect(action.openapi.summary.length).toBeGreaterThan(0);
    });

    it('should have a 200 response schema in openapi annotation', () => {
      const action = DatasourceConnectorService.actions.listPlugins;
      const responses = action.openapi?.responses;
      expect(responses).toBeDefined();
      expect(responses[200]).toBeDefined();
      const schema = responses[200]?.content?.['application/json']?.schema;
      expect(schema).toBeDefined();
      expect(schema.type).toBe('object');
      expect(schema.properties.success).toBeDefined();
      expect(schema.properties.data).toBeDefined();
      expect(schema.properties.data.type).toBe('array');
    });

    it('should return connector types including csv and rest via listPlugins action', async () => {
      const result = await broker.call('datasource-connector.listPlugins', {});
      expect(result.success).toBe(true);
      expect(result.count).toBeGreaterThan(0);
      const types = result.data.map((p) => p.type);
      expect(types).toContain('csv');
      expect(types).toContain('rest');
      // Each entry must have the fields the UI form expects
      result.data.forEach((plugin) => {
        expect(typeof plugin.type).toBe('string');
        expect(typeof plugin.description).toBe('string');
        expect(typeof plugin.configSchema).toBe('object');
        expect(typeof plugin.source).toBe('string');
      });
    });
  });
});
