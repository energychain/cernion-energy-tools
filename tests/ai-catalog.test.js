'use strict';

const Ajv2020 = require('ajv/dist/2020');
const addFormats = require('ajv-formats');
const { buildAiCatalog, serveAiCatalog } = require('../src/ai-catalog');

const services = [
  {
    name: 'meter',
    settings: { password: 'SECRET-SETTING' },
    actions: {
      'meter.read': { visibility: 'published' },
      'meter.internal': { visibility: 'protected' },
      'meter.hidden': { visibility: 'private' },
    },
  },
  { name: '$node', actions: { ping: {} } },
];
const spec = {
  openapi: '3.0.0',
  info: { title: 'CET', version: '1.2.3' },
  paths: {
    '/api/meter/read': {
      parameters: [{ name: 'account', in: 'query', schema: { type: 'string' } }],
      get: { operationId: 'meter_read', summary: 'Zählerstände prüfen', tags: ['EDM'] },
      post: { operationId: 'meter_internal' },
    },
    '/api/missing/read': { get: { operationId: 'missing_read' } },
    '/api/meter/hidden': { get: { operationId: 'meter_hidden' } },
  },
  components: { securitySchemes: { BearerAuth: { type: 'http', scheme: 'bearer' } } },
  security: [{ BearerAuth: [] }],
};
const build = (options = {}) =>
  buildAiCatalog({ spec, services, baseUrl: 'https://cet.example', ...options });

test('catalog conforms to pinned AI Catalog and ARD manifest schemas offline', () => {
  const ajv = new Ajv2020({ strict: false });
  addFormats(ajv);
  const catalog = build();
  const ai = ajv.compile(require('./fixtures/ai-catalog/ai-catalog.schema.json'));
  const ardSchema = require('./fixtures/ai-catalog/ard-entry.schema.json');
  const ard = ajv.compile({ ...ardSchema, $ref: '#/$defs/ArdManifest' });
  expect(ai(catalog)).toBe(true);
  expect(ai.errors).toBeNull();
  expect(ard(catalog)).toBe(true);
  expect(ard.errors).toBeNull();
});

test('only published loaded REST contracts are advertised, without settings or mutation', () => {
  const before = JSON.stringify({ spec, services });
  const catalog = build();
  expect(catalog.entries).toHaveLength(3);
  const meter = catalog.entries.find((entry) => entry.displayName === 'meter');
  expect(meter.capabilities).toEqual(['meter.read']);
  expect(meter.data.paths).toEqual({
    '/api/meter/read': {
      parameters: spec.paths['/api/meter/read'].parameters,
      get: spec.paths['/api/meter/read'].get,
    },
  });
  expect(meter.data.security).toEqual(spec.security);
  expect(meter.data.components).toEqual(spec.components);
  expect(JSON.stringify(catalog)).not.toMatch(
    /SECRET-SETTING|meter_internal|meter_hidden|missing_read/
  );
  expect(JSON.stringify({ spec, services })).toBe(before);
  expect(build({ services: [...services].reverse() })).toEqual(catalog);
});

test('custom operation IDs and registered capabilities are projected from canonical metadata', () => {
  const catalog = build({
    services: [
      {
        name: 'interface-placeholder',
        actions: { markGap: { openapi: { operationId: 'customGap' } } },
      },
    ],
    spec: {
      ...spec,
      paths: { '/api/gap': { post: { operationId: 'customGap', summary: 'Lücke melden' } } },
    },
  });
  const entry = catalog.entries.find((item) => item.displayName === 'interface-placeholder');
  expect(entry.capabilities).toContain('interface-placeholder.markGap');
  expect(new Set(catalog.entries.map((item) => item.identifier)).size).toBe(catalog.entries.length);
});

test.each([
  'file:///etc/passwd',
  'https://user:secret@cet.example',
  'https://cet.example/api',
  'https://cet.example/?token=secret',
])('rejects invalid canonical origin %s', (baseUrl) => {
  expect(() => build({ baseUrl })).toThrow();
});

test('metadata failure returns a short 503 without internal error details', async () => {
  const res = { writeHead: jest.fn(), end: jest.fn() };
  await serveAiCatalog.call(
    {
      broker: { call: jest.fn().mockRejectedValue(new Error('SECRET-FAILURE')) },
      logger: { warn: jest.fn() },
    },
    { headers: { host: 'cet.example' } },
    res
  );
  expect(res.writeHead).toHaveBeenCalledWith(503, expect.any(Object));
  expect(res.end).toHaveBeenCalledWith('{"error":"AI_CATALOG_UNAVAILABLE"}');
});
