/**
 * API Gateway Service Tests
 */

const { ServiceBroker } = require('moleculer');
const ApiService = require('../services/api.service');
const DatasourceRegistryService = require('../services/datasource-registry.service');
const DatasourceCacheService = require('../services/datasource-cache.service');
const DatasourceDiscoveryService = require('../services/datasource-discovery.service');
const DatasourceClassifierService = require('../services/datasource-classifier.service');
const { version: packageVersion } = require('../package.json');

describe('API Gateway Service', () => {
  let broker;

  beforeAll(async () => {
    broker = new ServiceBroker({
      logger: false,
      transporter: null,
    });
    broker.createService({
      ...ApiService,
      settings: {
        ...ApiService.settings,
        port: 0,
      },
    });
    broker.createService(DatasourceRegistryService);
    broker.createService(DatasourceCacheService);
    broker.createService(DatasourceDiscoveryService);
    broker.createService(DatasourceClassifierService);
    await broker.start();
  });

  afterAll(async () => {
    await broker.stop();
  });

  describe('Service Configuration', () => {
    it('should have correct service name', () => {
      expect(ApiService.name).toBe('api');
    });

    it('should have port configuration', () => {
      expect(ApiService.settings.port).toBeDefined();
    });

    it('should have OpenAPI configuration', () => {
      expect(ApiService.settings.openapi).toBeDefined();
      expect(ApiService.settings.openapi.info).toBeDefined();
      expect(ApiService.settings.openapi.info.title).toBe('Cernion Energy Tools API');
      expect(ApiService.settings.openapi.info.version).toBe(packageVersion);
    });

    it('should have security schemes configured', () => {
      expect(ApiService.settings.openapi.components.securitySchemes).toBeDefined();
      expect(ApiService.settings.openapi.components.securitySchemes.ApiKeyAuth).toBeDefined();
      expect(ApiService.settings.openapi.components.securitySchemes.BearerAuth).toBeDefined();
    });

    it('should have routes configured', () => {
      expect(ApiService.settings.routes).toBeDefined();
      expect(ApiService.settings.routes.length).toBeGreaterThan(0);
    });

    it('should have /api path configured', () => {
      const apiRoute = ApiService.settings.routes.find((r) => r.path === '/api');
      expect(apiRoute).toBeDefined();
      expect(apiRoute.autoAliases).toBe(true);
    });
  });

  describe('openapi', () => {
    it('should have openapi action', () => {
      const service = broker.getLocalService('api');
      expect(service.actions.openapi).toBeDefined();
    });

    it('should have correct REST endpoint', () => {
      const action = broker.getLocalService('api').schema.actions.openapi;
      const rest = action.rest;
      expect(rest).toBe('GET /openapi.json');
    });

    it('should document optional token query parameter for all endpoints', async () => {
      const schema = await broker.call('api.openapi');

      Object.values(schema.paths).forEach((pathItem) => {
        Object.values(pathItem).forEach((operation) => {
          const hasTokenQuery = (operation.parameters || []).some(
            (parameter) =>
              parameter.$ref === '#/components/parameters/TokenQuery' ||
              (parameter.name === 'token' && parameter.in === 'query')
          );

          expect(hasTokenQuery).toBe(true);
        });
      });
    });

    it('should include DataSources tag and public datasource routes', async () => {
      const schema = await broker.call('api.openapi');

      expect(schema.tags.some((tag) => tag.name === 'DataSources')).toBe(true);
      expect(schema.paths['/api/datasources']).toBeDefined();
      expect(schema.paths['/api/datasources/:id']).toBeDefined();
      expect(schema.paths['/api/datasource-cache/:sourceId']).toBeDefined();
      expect(schema.paths['/api/datasource-discovery']).toBeDefined();
      expect(schema.paths['/api/datasources/:id/classification']).toBeDefined();

      expect(schema.paths['/api/datasources'].get.tags).toContain('DataSources');
      expect(schema.paths['/api/datasources'].post.tags).toContain('DataSources');
      expect(schema.paths['/api/datasources/:id/classification'].get.tags).toContain('DataSources');
      expect(schema.paths['/api/datasources/:id/classification'].patch.tags).toContain('DataSources');
    });
  });

  describe('Routes', () => {
    it('should have body parsers configured', () => {
      const apiRoute = ApiService.settings.routes.find((r) => r.path === '/api');
      expect(apiRoute.bodyParsers).toBeDefined();
      expect(apiRoute.bodyParsers.json).toBeDefined();
      expect(apiRoute.bodyParsers.urlencoded).toBeDefined();
    });

    it('should have onBeforeCall hook', () => {
      const apiRoute = ApiService.settings.routes.find((r) => r.path === '/api');
      expect(apiRoute.onBeforeCall).toBeDefined();
      expect(typeof apiRoute.onBeforeCall).toBe('function');
    });

    it('should have onError handler', () => {
      const apiRoute = ApiService.settings.routes.find((r) => r.path === '/api');
      expect(apiRoute.onError).toBeDefined();
      expect(typeof apiRoute.onError).toBe('function');
    });

    it('should extract token from URL params with precedence over bearer token', () => {
      const apiRoute = ApiService.settings.routes.find((r) => r.path === '/api');
      const ctx = { meta: {} };
      const req = {
        headers: { authorization: 'Bearer bearer-token' },
        query: { token: 'query-token' },
        body: {},
        params: {},
        $params: { token: 'query-token' },
      };

      apiRoute.onBeforeCall.call({ logger: { debug: jest.fn() } }, ctx, apiRoute, req, {});

      expect(ctx.meta.cernionToken).toBe('query-token');
      expect(req.query.token).toBeUndefined();
      expect(req.$params.token).toBeUndefined();
    });

    it('should extract token from body when provided', () => {
      const apiRoute = ApiService.settings.routes.find((r) => r.path === '/api');
      const ctx = { meta: {} };
      const req = {
        headers: {},
        query: {},
        body: { token: 'body-token' },
        params: {},
        $params: { token: 'body-token' },
      };

      apiRoute.onBeforeCall.call({ logger: { debug: jest.fn() } }, ctx, apiRoute, req, {});

      expect(ctx.meta.cernionToken).toBe('body-token');
      expect(req.body.token).toBeUndefined();
    });

    it('should sanitize secrets in onError response payload', () => {
      const apiRoute = ApiService.settings.routes.find((r) => r.path === '/api');
      const res = {
        _status: null,
        _headers: {},
        _body: '',
        setHeader: jest.fn(function (key, value) {
          this._headers[key] = value;
        }),
        writeHead: jest.fn(function (status) {
          this._status = status;
        }),
        end: jest.fn(function (body) {
          this._body = body;
        }),
      };

      apiRoute.onError({}, res, {
        code: 500,
        message:
          'Failed Bearer abc123 and https://mcp.cernion.de/verySecretToken/mcp?token=querySecret',
        type: 'MCP_ERROR',
      });

      const payload = JSON.parse(res._body);
      expect(payload.message).toContain('Bearer [REDACTED]');
      expect(payload.message).toContain('https://mcp.cernion.de/[REDACTED]/mcp');
      expect(payload.message).not.toContain('abc123');
      expect(payload.message).not.toContain('verySecretToken');
      expect(payload.message).not.toContain('querySecret');
    });
  });

  describe('Methods', () => {
    it('should have authenticate method', () => {
      expect(ApiService.methods.authenticate).toBeDefined();
    });

    it('should have authorize method', () => {
      expect(ApiService.methods.authorize).toBeDefined();
    });
  });

  describe('Lifecycle', () => {
    it('should have created hook', () => {
      expect(ApiService.created).toBeDefined();
    });

    it('should have started hook', () => {
      expect(ApiService.started).toBeDefined();
    });

    it('should have stopped hook', () => {
      expect(ApiService.stopped).toBeDefined();
    });
  });
});
