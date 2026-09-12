'use strict';

const { ServiceBroker } = require('moleculer');
const ApiService = require('../services/api.service');
const ForecastSandboxService = require('../services/forecast-sandbox.service');

describe('Forecast Sandbox OpenAPI contract (CR-CET-FORECAST-SANDBOX-V0.1 §5)', () => {
  let broker;

  beforeAll(async () => {
    broker = new ServiceBroker({ logger: false, transporter: null });
    broker.createService({
      ...ApiService,
      settings: { ...ApiService.settings, port: 0 },
    });
    broker.createService(ForecastSandboxService);
    await broker.start();
  });

  afterAll(async () => {
    await broker.stop();
  });

  describe('global /api/openapi.json', () => {
    let openapi;

    beforeAll(async () => {
      openapi = await broker.call('api.openapi');
    });

    it('includes all three Forecast Sandbox consumption paths', () => {
      expect(openapi.paths['/api/forecast-sandbox/consumption/validate']).toBeDefined();
      expect(openapi.paths['/api/forecast-sandbox/consumption/day-ahead']).toBeDefined();
      expect(openapi.paths['/api/forecast-sandbox/consumption/backtest']).toBeDefined();
    });

    it('tags every Forecast Sandbox operation with "Forecast Sandbox"', () => {
      const paths = [
        openapi.paths['/api/forecast-sandbox/consumption/validate'].post,
        openapi.paths['/api/forecast-sandbox/consumption/day-ahead'].post,
        openapi.paths['/api/forecast-sandbox/consumption/backtest'].post,
      ];
      for (const operation of paths) {
        expect(operation.tags).toContain('Forecast Sandbox');
      }
    });

    it('documents the validate request body schema', () => {
      const operation = openapi.paths['/api/forecast-sandbox/consumption/validate'].post;
      const schema = operation.requestBody.content['application/json'].schema;
      expect(schema.required).toEqual(
        expect.arrayContaining(['seriesId', 'granularity', 'timezone', 'unit', 'values'])
      );
    });
  });

  describe('isolated GET /api/forecast-sandbox/openapi.json', () => {
    let isolated;

    beforeAll(async () => {
      isolated = await broker.call('forecast-sandbox.openapi');
    });

    it('is a valid OpenAPI 3.x document with info.title and info.version', () => {
      expect(isolated.openapi).toMatch(/^3\./);
      expect(isolated.info.title).toBe('Cernion Forecast Sandbox API');
      expect(isolated.info.version).toBe('0.1.0');
      expect(typeof isolated.info.description).toBe('string');
      expect(isolated.info.description).toMatch(/no production sla/i);
    });

    it('is JSON-serializable (round-trips through JSON.stringify/parse)', () => {
      expect(() => JSON.parse(JSON.stringify(isolated))).not.toThrow();
    });

    it('declares servers', () => {
      expect(Array.isArray(isolated.servers)).toBe(true);
      expect(isolated.servers.length).toBeGreaterThan(0);
      expect(isolated.servers[0].url).toMatch(/^https?:\/\//);
    });

    it('contains only Forecast Sandbox paths — no unrelated CET paths', () => {
      const paths = Object.keys(isolated.paths);
      expect(paths.length).toBe(4);
      for (const p of paths) {
        expect(p.startsWith('/api/forecast-sandbox/')).toBe(true);
      }
    });

    it('declares request and response schemas for each consumption endpoint', () => {
      for (const path of [
        '/api/forecast-sandbox/consumption/validate',
        '/api/forecast-sandbox/consumption/day-ahead',
        '/api/forecast-sandbox/consumption/backtest',
      ]) {
        const operation = isolated.paths[path].post;
        expect(operation.requestBody.content['application/json'].schema).toBeDefined();
        expect(operation.responses['200']).toBeDefined();
      }
    });

    it('declares a bearer security scheme', () => {
      expect(isolated.components.securitySchemes.BearerAuth).toMatchObject({
        type: 'http',
        scheme: 'bearer',
      });
    });

    it('declares an error schema covering all v0.1 error codes', () => {
      const errorSchema = isolated.components.schemas.SandboxError;
      expect(errorSchema).toBeDefined();
      const codes = errorSchema.properties.error.properties.code.enum;
      expect(codes).toEqual(
        expect.arrayContaining([
          'INVALID_PAYLOAD',
          'INVALID_TIMESTAMP',
          'INVALID_GRANULARITY',
          'MISSING_VALUES',
          'DUPLICATE_INTERVALS',
          'INSUFFICIENT_HISTORY',
          'INVALID_BACKTEST_PERIOD',
          'ZERO_VALUES_FOR_MAPE',
          'UNSUPPORTED_UNIT',
          'INTERNAL_FORECAST_ERROR',
        ])
      );
    });
  });
});
