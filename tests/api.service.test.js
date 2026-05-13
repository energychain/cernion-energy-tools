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
const FinanceAgentService = require('../services/finance-agent.service');
const ObservabilityService = require('../services/observability.service');
const TenantQuotaService = require('../services/tenant-quota.service');
const rateQuotaStore = require('../src/rate-quota-store');
const { version: packageVersion } = require('../package.json');
const metrics = require('../src/metrics');
const path = require('path');
const os = require('os');
const fs = require('fs');

describe('API Gateway Service', () => {
  let broker;
  let tokenStorageFile;
  let rateQuotaDir;

  beforeAll(async () => {
    tokenStorageFile = path.join(os.tmpdir(), `api-service-token-test-${Date.now()}.json`);
    rateQuotaDir = path.join(os.tmpdir(), `api-rate-quotas-${Date.now()}`);
    process.env.RATE_QUOTA_DIR = rateQuotaDir;

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
    broker.createService({
      ...FinanceAgentService,
      settings: {
        ...FinanceAgentService.settings,
        dbPath: path.join(os.tmpdir(), `api-finance-agent-${Date.now()}`),
      },
    });
    broker.createService({
      ...ObservabilityService,
      settings: {
        ...ObservabilityService.settings,
        dbPath: path.join(os.tmpdir(), `api-observability-${Date.now()}`),
      },
    });
    broker.createService(TenantQuotaService);
    await broker.start();
  });

  afterAll(async () => {
    await broker.stop();
    rateQuotaStore.resetForTests();
    if (fs.existsSync(tokenStorageFile)) {
      fs.unlinkSync(tokenStorageFile);
    }
    fs.rmSync(rateQuotaDir, { recursive: true, force: true });
    delete process.env.RATE_QUOTA_DIR;
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

      expect(schema.paths['/api/datapoints']).toBeDefined();
      expect(schema.paths['/api/datapoints'].get.tags).toContain('Datapoints');
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

    it('should include Finance Agent tag and routes', async () => {
      const schema = await broker.call('api.openapi');

      expect(schema.tags.some((tag) => tag.name === 'Finance Agent')).toBe(true);
      expect(schema.paths['/api/finance-agent/analyze']).toBeDefined();
      expect(schema.paths['/api/finance-agent/analyses']).toBeDefined();
      expect(schema.paths['/api/finance-agent/analyses/:id']).toBeDefined();
      expect(schema.paths['/api/finance-agent/prompts']).toBeDefined();
      expect(schema.paths['/api/finance-agent/memory']).toBeDefined();
      expect(schema.paths['/api/finance-agent/memory/:sessionId']).toBeDefined();

      expect(schema.paths['/api/finance-agent/analyze'].post.tags).toContain('Finance Agent');
    });

    it('should include CYA, Cookbook, Dashboard API, and MaStR Quality routes', async () => {
      const schema = await broker.call('api.openapi');

      expect(schema.paths['/api/cya/profile']).toBeDefined();
      expect(schema.paths['/api/cookbook']).toBeDefined();
      expect(schema.paths['/api/dashboard/vnb-overview']).toBeDefined();
      expect(schema.paths['/api/dashboard/observability-mini']).toBeDefined();
      expect(schema.paths['/api/observability/logs']).toBeDefined();
      expect(schema.paths['/api/observability/agent-prompt']).toBeDefined();
      expect(schema.paths['/api/mastr-quality/audit']).toBeDefined();

      expect(schema.paths['/api/cya/profile'].post).toBeDefined();
      expect(schema.paths['/api/cookbook'].get).toBeDefined();
      expect(schema.paths['/api/dashboard/vnb-overview'].get).toBeDefined();
      expect(schema.paths['/api/dashboard/observability-mini'].get).toBeDefined();
      expect(schema.paths['/api/observability/logs'].get).toBeDefined();
      expect(schema.paths['/api/observability/agent-prompt'].get).toBeDefined();
      expect(schema.paths['/api/mastr-quality/audit'].post).toBeDefined();

      expect(schema.paths['/api/cya/profile'].post.tags).toContain('CYA Agent');
      expect(schema.paths['/api/cookbook'].get.tags).toContain('Cookbook');
      expect(schema.paths['/api/dashboard/vnb-overview'].get.tags).toContain('Dashboard API');
      expect(schema.paths['/api/dashboard/observability-mini'].get.tags).toContain('Dashboard API');
      expect(schema.paths['/api/observability/logs'].get.tags).toContain('Observability');
      expect(schema.paths['/api/observability/agent-prompt'].get.tags).toContain('Observability');
      expect(schema.paths['/api/mastr-quality/audit'].post.tags).toContain('MaStR Data Quality');
    });

    it('should include ZNP portfolio assessment route in OpenAPI', async () => {
      const schema = await broker.call('api.openapi');

      expect(schema.paths['/api/znp/projects/:projectId/portfolio']).toBeDefined();
      expect(schema.paths['/api/znp/projects/:projectId/portfolio'].get).toBeDefined();
      expect(schema.paths['/api/znp/projects/:projectId/portfolio'].get.tags).toContain('znp');
    });

    it('should include Investment Planning routes in OpenAPI', async () => {
      const schema = await broker.call('api.openapi');

      expect(schema.tags.some((tag) => tag.name === 'Investment Planning')).toBe(true);
      expect(schema.paths['/api/investment-planning/plans']).toBeDefined();
      expect(schema.paths['/api/investment-planning/plans'].post).toBeDefined();
      expect(schema.paths['/api/investment-planning/plans'].get).toBeDefined();
      expect(schema.paths['/api/investment-planning/plans/:id']).toBeDefined();
      expect(schema.paths['/api/investment-planning/plans/:id'].get).toBeDefined();
    });

    it('should include HITL and Webhooks tags and routes', async () => {
      const schema = await broker.call('api.openapi');

      expect(schema.tags.some((tag) => tag.name === 'HITL')).toBe(true);
      expect(schema.tags.some((tag) => tag.name === 'Webhooks')).toBe(true);
      expect(schema.paths['/api/hitl/items']).toBeDefined();
      expect(schema.paths['/api/hitl/summary']).toBeDefined();
      expect(schema.paths['/api/hitl/sla-heatmap']).toBeDefined();
      expect(schema.paths['/api/webhooks']).toBeDefined();
      expect(schema.paths['/api/webhooks/:id/deliveries/:deliveryId/replay']).toBeDefined();
    });

    it('should include Tenant Quotas tag and routes', async () => {
      const schema = await broker.call('api.openapi');

      expect(schema.tags.some((tag) => tag.name === 'Tenant Quotas')).toBe(true);
      expect(schema.paths['/api/tenants/:id/quotas']).toBeDefined();
      expect(schema.paths['/api/tenants/:id/rate-limit-events']).toBeDefined();
      expect(schema.paths['/api/tenants/:id/quotas'].get.tags).toContain('Tenant Quotas');
      expect(schema.paths['/api/tenants/:id/quotas'].put.tags).toContain('Tenant Quotas');
    });

    it('should have explicit aliases for Knowledge RAG routes', () => {
      const apiRoute = ApiService.settings.routes.find((r) => r.path === '/api');
      const aliases = apiRoute?.aliases || {};

      expect(aliases['POST /knowledge-rag/query']).toBe('knowledge-rag.query');
      expect(aliases['POST /knowledge-rag/semantic']).toBe('knowledge-rag.semantic');
      expect(aliases['POST /knowledge-rag/scroll']).toBe('knowledge-rag.scroll');
      expect(aliases['POST /knowledge-rag/fetch']).toBe('knowledge-rag.fetch');
      expect(aliases['POST /knowledge-rag/collection-info']).toBe('knowledge-rag.collectionInfo');
    });

    it('should have explicit aliases for Finance Agent routes', () => {
      const apiRoute = ApiService.settings.routes.find((r) => r.path === '/api');
      const aliases = apiRoute?.aliases || {};

      expect(aliases['POST /finance-agent/analyze']).toBe('finance-agent.analyze');
      expect(aliases['GET /finance-agent/analyses']).toBe('finance-agent.list');
      expect(aliases['GET /finance-agent/analyses/:id']).toBe('finance-agent.get');
      expect(aliases['GET /finance-agent/prompts']).toBe('finance-agent.prompts');
      expect(aliases['POST /finance-agent/memory']).toBe('finance-agent.remember');
      expect(aliases['GET /finance-agent/memory/:sessionId']).toBe('finance-agent.memory');
    });

    it('should have explicit aliases for Dashboard API and Observability routes', () => {
      const apiRoute = ApiService.settings.routes.find((r) => r.path === '/api');
      const aliases = apiRoute?.aliases || {};

      expect(aliases['GET /dashboard/observability-mini']).toBe('dashboard-api.observabilityMini');
      expect(aliases['GET /observability/logs']).toBe('observability.logs');
      expect(aliases['GET /observability/metrics']).toBe('observability.metrics');
      expect(aliases['GET /observability/summary']).toBe('observability.summary');
      expect(aliases['GET /observability/agent-prompt']).toBe('observability.agentPrompt');
    });

    it('should have explicit aliases for HITL and Webhooks routes', () => {
      const apiRoute = ApiService.settings.routes.find((r) => r.path === '/api');
      const aliases = apiRoute?.aliases || {};

      expect(aliases['POST /hitl/items']).toBe('hitl.create');
      expect(aliases['GET /hitl/summary']).toBe('hitl.summary');
      expect(aliases['GET /hitl/sla-heatmap']).toBe('hitl.slaHeatmap');
      expect(aliases['POST /hitl/items/:id/approve']).toBe('hitl.approve');
      expect(aliases['POST /hitl/items/bulk-approve']).toBe('hitl.bulkApprove');
      expect(aliases['POST /hitl/items/bulk-reject']).toBe('hitl.bulkReject');
      expect(aliases['POST /hitl/items/bulk-escalate']).toBe('hitl.bulkEscalate');
      expect(aliases['POST /webhooks']).toBe('webhooks.create');
      expect(aliases['GET /webhooks']).toBe('webhooks.list');
      expect(aliases['POST /webhooks/:id/deliveries/:deliveryId/replay']).toBe('webhooks.replay');
    });

    it('should have explicit aliases for tenant quota routes', () => {
      const apiRoute = ApiService.settings.routes.find((r) => r.path === '/api');
      const aliases = apiRoute?.aliases || {};

      expect(aliases['GET /tenants/:id/quotas']).toBe('tenant-quota.getQuotas');
      expect(aliases['PUT /tenants/:id/quotas']).toBe('tenant-quota.setQuotas');
      expect(aliases['GET /tenants/:id/rate-limit-events']).toBe('tenant-quota.listEvents');
    });

    it('should have explicit alias for ZNP portfolio assessment route', () => {
      const apiRoute = ApiService.settings.routes.find((r) => r.path === '/api');
      const aliases = apiRoute?.aliases || {};

      expect(aliases['GET /znp/projects/:projectId/portfolio']).toBe('znp.assessPortfolio');
    });

    it('should have explicit aliases for Investment Planning routes', () => {
      const apiRoute = ApiService.settings.routes.find((r) => r.path === '/api');
      const aliases = apiRoute?.aliases || {};

      expect(aliases['POST /investment-planning/plans']).toBe('investment-planning.createPlan');
      expect(aliases['GET /investment-planning/plans']).toBe('investment-planning.listPlans');
      expect(aliases['GET /investment-planning/plans/:id']).toBe('investment-planning.getPlan');
    });

    it('should have explicit aliases for OSM Geo routes', () => {
      const apiRoute = ApiService.settings.routes.find((r) => r.path === '/api');
      const aliases = apiRoute?.aliases || {};

      expect(aliases['POST /osm-geo/validate']).toBe('osm-geo.validate');
      expect(aliases['POST /osm-geo/infrastructure-nearby']).toBe(
        'osm-geo.infrastructureNearby'
      );
      expect(aliases['POST /osm-geo/substation-finder']).toBe('osm-geo.substationFinder');
      expect(aliases['POST /osm-geo/grid-topology']).toBe('osm-geo.gridTopology');
    });
  });

  describe('Routes', () => {
    afterEach(() => {
      delete process.env.METRICS_PUBLIC;
    });

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

    it('should reject read-only ck_ token on tenant quota admin endpoints', async () => {
      const apiRoute = ApiService.settings.routes.find((r) => r.path === '/api');
      const created = await broker.call('token-manager.create', {
        name: 'QuotaReadOnly',
        scope: 'read-only',
        tenantId: 'tenant-a',
      });

      const ctx = { meta: {} };
      const req = {
        headers: { authorization: `Bearer ${created.data.token}` },
        query: {},
        body: {},
        params: {},
        $params: {},
        method: 'GET',
        url: '/api/tenants/tenant-a/quotas',
      };

      await expect(
        apiRoute.onBeforeCall.call({ logger: { debug: jest.fn() }, broker }, ctx, apiRoute, req, {})
      ).rejects.toMatchObject({ code: 403, type: 'TOKEN_SCOPE_VIOLATION' });

      const putCtx = { meta: {} };
      const putReq = {
        headers: { authorization: `Bearer ${created.data.token}` },
        query: {},
        body: { quotas: { llm_tokens_per_day: 1000 } },
        params: {},
        $params: {},
        method: 'PUT',
        url: '/api/tenants/tenant-a/quotas',
      };

      await expect(
        apiRoute.onBeforeCall.call({ logger: { debug: jest.fn() }, broker }, putCtx, apiRoute, putReq, {})
      ).rejects.toMatchObject({ code: 403, type: 'TOKEN_SCOPE_VIOLATION' });
    });

    it('should set rate-limit headers and reject the next request after limit exhaustion', async () => {
      const apiRoute = ApiService.settings.routes.find((r) => r.path === '/api');
      const created = await broker.call('token-manager.create', {
        name: 'QuotaAdmin',
        scope: 'full-access',
        tenantId: 'tenant-rate',
      });

      const state = rateQuotaStore.getTenantState('tenant-rate');
      state.config.rateLimits.read = 1;
      rateQuotaStore.saveTenantState('tenant-rate', state);

      const firstCtx = { meta: {} };
      const req = {
        headers: { authorization: `Bearer ${created.data.token}` },
        query: {},
        body: {},
        params: {},
        $params: {},
        method: 'GET',
        url: '/api/tenants/tenant-rate/quotas',
      };

      await apiRoute.onBeforeCall.call({ logger: { debug: jest.fn() }, broker }, firstCtx, apiRoute, req, {});
      expect(firstCtx.meta.$responseHeaders['X-RateLimit-Limit']).toBe('1');
      expect(firstCtx.meta.$responseHeaders['X-RateLimit-Remaining']).toBe('0');
      expect(firstCtx.meta.$responseHeaders['X-RateLimit-Reset']).toBeDefined();

      const secondCtx = { meta: {} };
      await expect(
        apiRoute.onBeforeCall.call({ logger: { debug: jest.fn() }, broker }, secondCtx, apiRoute, req, {})
      ).rejects.toMatchObject({ code: 429, type: 'RATE_LIMIT_EXCEEDED' });
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

    it('should expose GET /metrics publicly when METRICS_PUBLIC=true', async () => {
      process.env.METRICS_PUBLIC = 'true';
      const rootRoute = ApiService.settings.routes.find((r) => r.path === '/');
      const handler = rootRoute.aliases['GET /metrics'];
      const req = { headers: {}, query: {}, url: '/metrics', method: 'GET' };
      const res = {
        _status: null,
        _headers: {},
        _body: '',
        setHeader: jest.fn(function (key, value) {
          this._headers[key] = value;
        }),
        writeHead: jest.fn(function (status, headers) {
          this._status = status;
          Object.assign(this._headers, headers || {});
        }),
        end: jest.fn(function (body) {
          this._body = body;
        }),
      };

      metrics.resetForTests();
      await handler.call({ broker }, req, res);

      expect(res._status).toBeNull();
      expect(res._headers['Content-Type']).toContain('text/plain');
      expect(res._body).toContain('cernion_action_calls_total');
    });

    it('should require a full-access token for GET /metrics when not public', async () => {
      process.env.METRICS_PUBLIC = 'false';
      const rootRoute = ApiService.settings.routes.find((r) => r.path === '/');
      const handler = rootRoute.aliases['GET /metrics'];
      const req = { headers: {}, query: {}, url: '/metrics', method: 'GET' };
      const res = {
        _status: null,
        _headers: {},
        _body: '',
        setHeader: jest.fn(function (key, value) {
          this._headers[key] = value;
        }),
        writeHead: jest.fn(function (status, headers) {
          this._status = status;
          Object.assign(this._headers, headers || {});
        }),
        end: jest.fn(function (body) {
          this._body = body;
        }),
      };

      await handler.call({ broker }, req, res);

      expect(res._status).toBe(401);
      expect(JSON.parse(res._body).message).toContain('Full-access API token required');
    });

    it('should reject read-only tokens for GET /metrics', async () => {
      process.env.METRICS_PUBLIC = 'false';
      const rootRoute = ApiService.settings.routes.find((r) => r.path === '/');
      const handler = rootRoute.aliases['GET /metrics'];
      const created = await broker.call('token-manager.create', {
        name: 'MetricsReadOnly',
        scope: 'read-only',
      });
      const req = {
        headers: { authorization: `Bearer ${created.data.token}` },
        query: {},
        url: '/metrics',
        method: 'GET',
      };
      const res = {
        _status: null,
        _headers: {},
        _body: '',
        setHeader: jest.fn(function (key, value) {
          this._headers[key] = value;
        }),
        writeHead: jest.fn(function (status, headers) {
          this._status = status;
          Object.assign(this._headers, headers || {});
        }),
        end: jest.fn(function (body) {
          this._body = body;
        }),
      };

      await handler.call({ broker }, req, res);

      expect(res._status).toBe(403);
      expect(JSON.parse(res._body).message).toContain('Full-access API token required');
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

  describe('Tenant quota service', () => {
    it('should return quota snapshot for matching tenant context', async () => {
      await broker.call('tenant-quota.getQuotas', { id: 'tenant-a' }, { meta: { tenantId: 'tenant-a' } });
      await broker.call('tenant-quota.listEvents', { id: 'tenant-a' }, { meta: { tenantId: 'tenant-a' } });
    });

    it('should reject cross-tenant quota reads for tenant-scoped meta', async () => {
      await expect(
        broker.call('tenant-quota.getQuotas', { id: 'tenant-b' }, { meta: { tenantId: 'tenant-a' } })
      ).rejects.toMatchObject({ code: 403, type: 'TENANT_SCOPE_VIOLATION' });
    });

    it('should update tenant quota config via setQuotas', async () => {
      const updated = await broker.call(
        'tenant-quota.setQuotas',
        {
          id: 'tenant-a',
          quotas: { llm_tokens_per_day: 1234, max_async_jobs_per_day: 9 },
          rateLimits: { read: 42 },
        },
        { meta: { tenantId: 'tenant-a' } }
      );

      expect(updated.success).toBe(true);
      expect(updated.data.config.quotas.llm_tokens_per_day).toBe(1234);
      expect(updated.data.config.quotas.max_async_jobs_per_day).toBe(9);
      expect(updated.data.config.rateLimits.read).toBe(42);
    });

    it('should reject cross-tenant quota updates for tenant-scoped meta', async () => {
      await expect(
        broker.call(
          'tenant-quota.setQuotas',
          { id: 'tenant-b', quotas: { llm_tokens_per_day: 999 } },
          { meta: { tenantId: 'tenant-a' } }
        )
      ).rejects.toMatchObject({ code: 403, type: 'TENANT_SCOPE_VIOLATION' });
    });

    it('should reject invalid quota payload keys on setQuotas', async () => {
      await expect(
        broker.call(
          'tenant-quota.setQuotas',
          { id: 'tenant-a', quotas: { not_a_real_quota: 1 } },
          { meta: { tenantId: 'tenant-a' } }
        )
      ).rejects.toMatchObject({ code: 422, type: 'VALIDATION_ERROR' });
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
