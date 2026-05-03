/**
 * API Gateway Service Tests
 */

const { ServiceBroker } = require('moleculer');
const ApiService = require('../services/api.service');
const DatasourceRegistryService = require('../services/datasource-registry.service');
const DatasourceCacheService = require('../services/datasource-cache.service');
const DatasourceDiscoveryService = require('../services/datasource-discovery.service');
const DatasourceClassifierService = require('../services/datasource-classifier.service');
const TokenManagerService = require('../services/token-manager.service');
const NbpMonitorService = require('../services/nbp-monitor.service');
const KnowledgeRagService = require('../services/knowledge-rag.service');
const { version: packageVersion } = require('../package.json');
const path = require('path');
const os = require('os');
const fs = require('fs');

describe('API Gateway Service', () => {
  let broker;
  let tokenStorageFile;

  beforeAll(async () => {
    tokenStorageFile = path.join(os.tmpdir(), `api-service-token-test-${Date.now()}.json`);

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
    broker.createService({
      ...TokenManagerService,
      settings: {
        ...TokenManagerService.settings,
        storageFile: tokenStorageFile,
      },
    });
    broker.createService({
      name: 'assets',
      actions: { all: { handler: () => [] } },
    });
    broker.createService({
      ...NbpMonitorService,
      settings: {
        ...NbpMonitorService.settings,
        parametersFile: path.join(os.tmpdir(), `api-nbp-params-${Date.now()}.json`),
      },
    });
    broker.createService(KnowledgeRagService);
    await broker.start();
  });

  afterAll(async () => {
    await broker.stop();
    if (fs.existsSync(tokenStorageFile)) {
      fs.unlinkSync(tokenStorageFile);
    }
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
      expect(schema.paths['/api/datasources/:id/classification'].patch.tags).toContain(
        'DataSources'
      );

      expect(schema.paths['/api/tokens']).toBeDefined();
      expect(schema.paths['/api/tokens/verify']).toBeDefined();
    });

    it('should include Knowledge RAG tag and routes', async () => {
      const schema = await broker.call('api.openapi');

      expect(schema.tags.some((tag) => tag.name === 'Knowledge RAG')).toBe(true);
      expect(schema.paths['/api/knowledge-rag/query']).toBeDefined();
      expect(schema.paths['/api/knowledge-rag/semantic']).toBeDefined();
      expect(schema.paths['/api/knowledge-rag/scroll']).toBeDefined();
      expect(schema.paths['/api/knowledge-rag/fetch']).toBeDefined();
      expect(schema.paths['/api/knowledge-rag/collection-info']).toBeDefined();

      expect(schema.paths['/api/knowledge-rag/query'].post.tags).toContain('Knowledge RAG');
      expect(schema.paths['/api/knowledge-rag/semantic'].post.tags).toContain('Knowledge RAG');
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

    it('should extract token from URL params with precedence over bearer token', async () => {
      const apiRoute = ApiService.settings.routes.find((r) => r.path === '/api');
      const ctx = { meta: {} };
      const req = {
        headers: { authorization: 'Bearer bearer-token' },
        query: { token: 'query-token' },
        body: {},
        params: {},
        $params: { token: 'query-token' },
        method: 'GET',
        url: '/api/agent/analyze',
      };

      await apiRoute.onBeforeCall.call(
        { logger: { debug: jest.fn() }, broker },
        ctx,
        apiRoute,
        req,
        {}
      );

      expect(ctx.meta.cernionToken).toBe('query-token');
      expect(req.query.token).toBeUndefined();
      expect(req.$params.token).toBeUndefined();
    });

    it('should extract token from body when provided', async () => {
      const apiRoute = ApiService.settings.routes.find((r) => r.path === '/api');
      const ctx = { meta: {} };
      const req = {
        headers: {},
        query: {},
        body: { token: 'body-token' },
        params: {},
        $params: { token: 'body-token' },
        method: 'POST',
        url: '/api/agent/execute',
      };

      await apiRoute.onBeforeCall.call(
        { logger: { debug: jest.fn() }, broker },
        ctx,
        apiRoute,
        req,
        {}
      );

      expect(ctx.meta.cernionToken).toBe('body-token');
      expect(req.body.token).toBeUndefined();
    });

    it('should accept valid full-access ck_ token for admin endpoints', async () => {
      const apiRoute = ApiService.settings.routes.find((r) => r.path === '/api');
      const created = await broker.call('token-manager.create', {
        name: 'Admin',
        scope: 'full-access',
      });

      const ctx = { meta: {} };
      const req = {
        headers: { authorization: `Bearer ${created.data.token}` },
        query: {},
        body: {},
        params: {},
        $params: {},
        method: 'DELETE',
        url: '/api/tokens/some-id',
      };

      await expect(
        apiRoute.onBeforeCall.call({ logger: { debug: jest.fn() }, broker }, ctx, apiRoute, req, {})
      ).resolves.toBeUndefined();
      expect(ctx.meta.apiToken.scope).toBe('full-access');
    });

    it('should reject read-only ck_ token on write endpoints', async () => {
      const apiRoute = ApiService.settings.routes.find((r) => r.path === '/api');
      const created = await broker.call('token-manager.create', {
        name: 'ReadOnly',
        scope: 'read-only',
      });

      const ctx = { meta: {} };
      const req = {
        headers: { authorization: `Bearer ${created.data.token}` },
        query: {},
        body: {},
        params: {},
        $params: {},
        method: 'PUT',
        url: '/api/vnb-monitor/thresholds',
      };

      await expect(
        apiRoute.onBeforeCall.call({ logger: { debug: jest.fn() }, broker }, ctx, apiRoute, req, {})
      ).rejects.toMatchObject({ code: 403 });
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

  describe('NBP Monitor routes (v0.9.7)', () => {
    it('should have explicit alias for GET /vnb-monitor/:bdewCode/nbp-monitor', () => {
      const apiRoute = ApiService.settings.routes.find((r) => r.path === '/api');
      const aliases = apiRoute?.aliases || {};
      expect(aliases['GET /vnb-monitor/:bdewCode/nbp-monitor']).toBe('nbp-monitor.snapshot');
    });

    it('should have explicit alias for GET /nbp-monitor/parameters', () => {
      const apiRoute = ApiService.settings.routes.find((r) => r.path === '/api');
      const aliases = apiRoute?.aliases || {};
      expect(aliases['GET /nbp-monitor/parameters']).toBe('nbp-monitor.getParameters');
    });

    it('should have explicit alias for PUT /nbp-monitor/parameters', () => {
      const apiRoute = ApiService.settings.routes.find((r) => r.path === '/api');
      const aliases = apiRoute?.aliases || {};
      expect(aliases['PUT /nbp-monitor/parameters']).toBe('nbp-monitor.setParameters');
    });

    it('should have explicit alias for DELETE /nbp-monitor/parameters', () => {
      const apiRoute = ApiService.settings.routes.find((r) => r.path === '/api');
      const aliases = apiRoute?.aliases || {};
      expect(aliases['DELETE /nbp-monitor/parameters']).toBe('nbp-monitor.resetParameters');
    });

    it('should include NBPMonitor tag in OpenAPI tags', () => {
      const tags = ApiService.settings.openapi.tags || [];
      expect(tags.some((t) => t.name === 'NBPMonitor')).toBe(true);
    });

    it('should document nbp-monitor endpoints in OpenAPI schema', async () => {
      const schema = await broker.call('api.openapi');
      const paths = Object.keys(schema.paths);
      // The nbp-monitor service auto-aliases appear under /api/nbp-monitor/...
      const hasNbpPath = paths.some((p) => p.includes('nbp-monitor'));
      expect(hasNbpPath).toBe(true);
    });

    it('should include token query parameter on nbp-monitor endpoints', async () => {
      const schema = await broker.call('api.openapi');
      const nbpPaths = Object.entries(schema.paths).filter(([p]) => p.includes('nbp-monitor'));
      expect(nbpPaths.length).toBeGreaterThan(0);
      nbpPaths.forEach(([, pathItem]) => {
        Object.values(pathItem).forEach((op) => {
          const hasToken = (op.parameters || []).some(
            (param) =>
              param.$ref === '#/components/parameters/TokenQuery' ||
              (param.name === 'token' && param.in === 'query')
          );
          expect(hasToken).toBe(true);
        });
      });
    });

    it('should reject read-only ck_ token on PUT /api/nbp-monitor/parameters', async () => {
      const apiRoute = ApiService.settings.routes.find((r) => r.path === '/api');
      const created = await broker.call('token-manager.create', {
        name: 'NbpReadOnly',
        scope: 'read-only',
      });
      const ctx = { meta: {} };
      const req = {
        headers: { authorization: `Bearer ${created.data.token}` },
        query: {},
        body: {},
        params: {},
        $params: {},
        method: 'PUT',
        url: '/api/nbp-monitor/parameters',
      };
      await expect(
        apiRoute.onBeforeCall.call({ logger: { debug: jest.fn() }, broker }, ctx, apiRoute, req, {})
      ).rejects.toMatchObject({ code: 403 });
    });

    // Regression test: POST /api/tokens/verify must NOT strip req.$params.token.
    // Before the fix, req.$params.token was deleted unconditionally, causing
    // Fastest-Validator to receive token=undefined and return 422 VALIDATION_ERROR
    // even for a valid ck_ token produced by POST /api/tokens.
    it('should preserve req.$params.token for POST /tokens/verify so the action receives it', async () => {
      const apiRoute = ApiService.settings.routes.find((r) => r.path === '/api');
      const created = await broker.call('token-manager.create', {
        name: 'VerifyRegressionToken',
        scope: 'read-only',
      });
      const rawToken = created.data.token; // ck_<32 hex chars> — no ck_live_ infix

      const ctx = { meta: {} };
      const req = {
        headers: {},
        query: {},
        // Moleculer merges body into $params before onBeforeCall runs
        body: { token: rawToken },
        params: {},
        $params: { token: rawToken, method: 'GET', path: '/api/tokens/verify' },
        method: 'POST',
        url: '/api/tokens/verify',
      };

      await apiRoute.onBeforeCall.call(
        { logger: { debug: jest.fn() }, broker },
        ctx,
        apiRoute,
        req,
        {}
      );

      // Token must survive in $params so the action validator can see it
      expect(req.$params.token).toBe(rawToken);

      // Calling the action with the preserved params must succeed (no 422)
      const result = await broker.call('token-manager.verify', req.$params);
      expect(result.valid).toBe(true);
      expect(result.tokenId).toBe(created.data.id);
    });
  });
});
