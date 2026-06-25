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
const PersonalAgentService = require('../services/personal-agent.service');
const CommunityService = require('../services/community.service');
const AgentPersonaService = require('../services/agent-persona.service');
const ObservabilityService = require('../services/observability.service');
const OperationsRunbookService = require('../services/operations-runbook.service');
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
  let agentPersonaDbPath;

  beforeAll(async () => {
    tokenStorageFile = path.join(os.tmpdir(), `api-service-token-test-${Date.now()}.json`);
    rateQuotaDir = path.join(os.tmpdir(), `api-rate-quotas-${Date.now()}`);
    agentPersonaDbPath = path.join(os.tmpdir(), `api-agent-persona-${Date.now()}`);
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
    broker.createService(PersonalAgentService);
    broker.createService({
      ...AgentPersonaService,
      settings: {
        ...AgentPersonaService.settings,
        dbPath: agentPersonaDbPath,
      },
    });
    broker.createService({
      ...ObservabilityService,
      settings: {
        ...ObservabilityService.settings,
        dbPath: path.join(os.tmpdir(), `api-observability-${Date.now()}`),
      },
    });
    broker.createService(OperationsRunbookService);
    broker.createService(TenantQuotaService);
    broker.createService(CommunityService);
    await broker.start();
  });

  afterAll(async () => {
    await broker.stop();
    rateQuotaStore.resetForTests();
    if (fs.existsSync(tokenStorageFile)) {
      fs.unlinkSync(tokenStorageFile);
    }
    fs.rmSync(agentPersonaDbPath, { recursive: true, force: true });
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

    it('should allow Power Platform origins for custom connector tests', () => {
      const apiRoute = ApiService.settings.routes.find((r) => r.path === '/api');
      expect(apiRoute.cors.origin('https://make.powerautomate.com')).toBe(true);
      expect(apiRoute.cors.origin('https://emea.flow.microsoft.com')).toBe(true);
      expect(apiRoute.cors.origin('https://make.powerapps.com')).toBe(true);
    });

    it('should expose curated operations-runbook aliases', () => {
      const apiRoute = ApiService.settings.routes.find((r) => r.path === '/api');
      expect(apiRoute.aliases['GET /operations-runbook/manifest']).toBe(
        'operations-runbook.manifest'
      );
      expect(apiRoute.aliases['POST /operations-runbook/revalidation/:taskId/execute']).toBe(
        'operations-runbook.executeRevalidationDev'
      );
    });
  });

  describe('openapi', () => {
    it('should have openapi action', () => {
      const service = broker.getLocalService('api');
      expect(service.actions.openapi).toBeDefined();
    });

    it('should have openapiCopilot action', () => {
      const service = broker.getLocalService('api');
      expect(service.actions.openapiCopilot).toBeDefined();
    });

    it('should have correct REST endpoint', () => {
      const action = broker.getLocalService('api').schema.actions.openapi;
      const rest = action.rest;
      expect(rest).toBe('GET /openapi.json');
    });

    it('should have correct Copilot OpenAPI REST endpoint', () => {
      const action = broker.getLocalService('api').schema.actions.openapiCopilot;
      expect(action.rest).toBe('GET /openapi-copilot.json');
    });

    it('should expose Copilot OpenAPI aliases under /api and root', () => {
      const rootRoute = ApiService.settings.routes.find((r) => r.path === '/');
      const apiRoute = ApiService.settings.routes.find((r) => r.path === '/api');

      expect(rootRoute?.aliases?.['GET /openapi-copilot.json']).toBeInstanceOf(Function);
      expect(apiRoute?.aliases?.['GET /openapi-copilot.json']).toBe('api.openapiCopilot');
    });

    it('should return the generated Copilot OpenAPI subset', async () => {
      const schema = await broker.call('api.openapiCopilot');

      expect(schema.openapi).toBe('3.0.0');
      expect(schema['x-copilot-subset']).toBe(true);
      expect(schema.paths).toBeDefined();
      expect(
        Object.values(schema.paths).some((pathItem) =>
          Object.values(pathItem).some((operation) => operation.operationId === 'searchCernionData')
        )
      ).toBe(true);
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

    it('should include Personal Agent tag and routes', async () => {
      const schema = await broker.call('api.openapi');

      expect(schema.tags.some((tag) => tag.name === 'Personal Agent')).toBe(true);
      expect(schema.paths['/api/personal-agent/chat']).toBeDefined();
      expect(schema.paths['/api/personal-agent/session/:sessionId']).toBeDefined();
      expect(schema.paths['/api/personal-agent/session/:sessionId/reset']).toBeDefined();

      expect(schema.paths['/api/personal-agent/chat'].post.tags).toContain('Personal Agent');
      expect(schema.paths['/api/personal-agent/session/:sessionId'].get.tags).toContain(
        'Personal Agent'
      );
    });

    it('should include CYA, Cookbook, Dashboard API, and MaStR Quality routes', async () => {
      const schema = await broker.call('api.openapi');

      expect(schema.paths['/api/cya/profile']).toBeDefined();
      expect(schema.paths['/api/cookbook']).toBeDefined();
      expect(schema.paths['/api/dashboard/vnb-overview']).toBeDefined();
      expect(schema.paths['/api/dashboard/redispatch-metering-cockpit']).toBeDefined();
      expect(schema.paths['/api/dashboard/load-profile-stream-monitor']).toBeDefined();
      expect(schema.paths['/api/dashboard/controllability-asset-handover']).toBeDefined();
      expect(schema.paths['/api/dashboard/legal-clarification-operating-model']).toBeDefined();
      expect(schema.paths['/api/dashboard/regulatory-change-readiness']).toBeDefined();
      expect(schema.paths['/api/dashboard/nova-decision-lifecycle-readiness']).toBeDefined();
      expect(schema.paths['/api/dashboard/observability-mini']).toBeDefined();
      expect(schema.paths['/api/observability/logs']).toBeDefined();
      expect(schema.paths['/api/observability/agent-prompt']).toBeDefined();
      expect(schema.paths['/api/mastr-quality/audit']).toBeDefined();

      expect(schema.paths['/api/cya/profile'].post).toBeDefined();
      expect(schema.paths['/api/cookbook'].get).toBeDefined();
      expect(schema.paths['/api/dashboard/vnb-overview'].get).toBeDefined();
      expect(schema.paths['/api/dashboard/redispatch-metering-cockpit'].get).toBeDefined();
      expect(schema.paths['/api/dashboard/load-profile-stream-monitor'].get).toBeDefined();
      expect(schema.paths['/api/dashboard/controllability-asset-handover'].get).toBeDefined();
      expect(schema.paths['/api/dashboard/legal-clarification-operating-model'].get).toBeDefined();
      expect(schema.paths['/api/dashboard/regulatory-change-readiness'].get).toBeDefined();
      expect(schema.paths['/api/dashboard/nova-decision-lifecycle-readiness'].get).toBeDefined();
      expect(schema.paths['/api/dashboard/observability-mini'].get).toBeDefined();
      expect(schema.paths['/api/observability/logs'].get).toBeDefined();
      expect(schema.paths['/api/observability/agent-prompt'].get).toBeDefined();
      expect(schema.paths['/api/mastr-quality/audit'].post).toBeDefined();

      expect(schema.paths['/api/cya/profile'].post.tags).toContain('CYA Agent');
      expect(schema.paths['/api/cookbook'].get.tags).toContain('Cookbook');
      expect(schema.paths['/api/dashboard/vnb-overview'].get.tags).toContain('Dashboard API');
      expect(schema.paths['/api/dashboard/redispatch-metering-cockpit'].get.tags).toContain(
        'Dashboard API'
      );
      expect(schema.paths['/api/dashboard/load-profile-stream-monitor'].get.tags).toContain(
        'Dashboard API'
      );
      expect(schema.paths['/api/dashboard/controllability-asset-handover'].get.tags).toContain(
        'Dashboard API'
      );
      expect(schema.paths['/api/dashboard/legal-clarification-operating-model'].get.tags).toContain(
        'Dashboard API'
      );
      expect(schema.paths['/api/dashboard/regulatory-change-readiness'].get.tags).toContain(
        'Dashboard API'
      );
      expect(schema.paths['/api/dashboard/nova-decision-lifecycle-readiness'].get.tags).toContain(
        'Dashboard API'
      );
      expect(schema.paths['/api/dashboard/observability-mini'].get.tags).toContain('Dashboard API');
      expect(schema.paths['/api/observability/logs'].get.tags).toContain('Observability');
      expect(schema.paths['/api/observability/agent-prompt'].get.tags).toContain('Observability');
      expect(schema.paths['/api/mastr-quality/audit'].post.tags).toContain('MaStR Data Quality');
    });

    it('should include Agent Receipts tag and routes', async () => {
      const schema = await broker.call('api.openapi');

      expect(schema.tags.some((tag) => tag.name === 'Agent Receipts')).toBe(true);
      expect(schema.paths['/api/agent-receipts']).toBeDefined();
      expect(schema.paths['/api/agent-receipts'].get).toBeDefined();
      expect(schema.paths['/api/agent-receipts'].post).toBeDefined();
      expect(schema.paths['/api/agent-receipts/select']).toBeDefined();
      expect(schema.paths['/api/agent-receipts/validate']).toBeDefined();
      expect(schema.paths['/api/agent-receipts/:id']).toBeDefined();
      expect(schema.paths['/api/agent-receipts/:id/status']).toBeDefined();

      expect(schema.paths['/api/agent-receipts'].get.tags).toContain('Agent Receipts');
      expect(schema.paths['/api/agent-receipts'].post.tags).toContain('Agent Receipts');
      expect(schema.paths['/api/agent-receipts/select'].post.tags).toContain('Agent Receipts');
      expect(schema.paths['/api/agent-receipts/validate'].post.tags).toContain('Agent Receipts');
      expect(schema.paths['/api/agent-receipts/:id'].get.tags).toContain('Agent Receipts');
    });

    it('should include Actor Personas tag and routes', async () => {
      const schema = await broker.call('api.openapi');

      expect(schema.tags.some((tag) => tag.name === 'Actor Personas')).toBe(true);
      expect(schema.paths['/api/agent-personas']).toBeDefined();
      expect(schema.paths['/api/agent-personas/:id']).toBeDefined();
      expect(schema.paths['/api/agent-personas/by-role/:role']).toBeDefined();
      expect(schema.paths['/api/agent-personas/resolve-by-role/:role']).toBeDefined();

      expect(schema.paths['/api/agent-personas'].get.tags).toContain('Actor Personas');
      expect(schema.paths['/api/agent-personas'].post.tags).toContain('Actor Personas');
      expect(schema.paths['/api/agent-personas/:id'].get.tags).toContain('Actor Personas');
      expect(schema.paths['/api/agent-personas/by-role/:role'].get.tags).toContain(
        'Actor Personas'
      );

      const createParameters = schema.paths['/api/agent-personas'].post.parameters || [];
      expect(
        createParameters.some(
          (parameter) => parameter.name === 'X-Tenant-Id' && parameter.in === 'header'
        )
      ).toBe(true);
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

    it('should include Blindflug Radar routes in OpenAPI', async () => {
      const schema = await broker.call('api.openapi');

      expect(schema.tags.some((tag) => tag.name === 'Blindflug Radar')).toBe(true);
      expect(schema.paths['/api/blindflug-radar/scan']).toBeDefined();
      expect(schema.paths['/api/blindflug-radar/scan'].post).toBeDefined();
      expect(schema.paths['/api/blindflug-radar/recommendations']).toBeDefined();
      expect(schema.paths['/api/blindflug-radar/recommendations'].post).toBeDefined();
      expect(schema.paths['/api/blindflug-radar/scans']).toBeDefined();
      expect(schema.paths['/api/blindflug-radar/scans'].get).toBeDefined();
      expect(schema.paths['/api/blindflug-radar/scans/:id']).toBeDefined();
      expect(schema.paths['/api/blindflug-radar/scans/:id'].get).toBeDefined();
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

    it('should have explicit aliases for Personal Agent routes', () => {
      const apiRoute = ApiService.settings.routes.find((r) => r.path === '/api');
      const aliases = apiRoute?.aliases || {};

      expect(aliases['POST /personal-agent/chat']).toBe('personal-agent.chat');
      expect(aliases['GET /personal-agent/session/:sessionId']).toBe('personal-agent.getSession');
      expect(aliases['POST /personal-agent/session/:sessionId/reset']).toBe(
        'personal-agent.resetSession'
      );
      expect(aliases['POST /community/consult']).toBe('community.consult');
    });

    it('should have explicit aliases for Dashboard API and Observability routes', () => {
      const apiRoute = ApiService.settings.routes.find((r) => r.path === '/api');
      const aliases = apiRoute?.aliases || {};

      expect(aliases['GET /dashboard/redispatch-metering-cockpit']).toBe(
        'dashboard-api.redispatchMeteringCockpit'
      );
      expect(aliases['GET /dashboard/load-profile-stream-monitor']).toBe(
        'dashboard-api.loadProfileStreamMonitor'
      );
      expect(aliases['GET /dashboard/controllability-asset-handover']).toBe(
        'dashboard-api.controllabilityAssetHandoverStatus'
      );
      expect(aliases['GET /dashboard/legal-clarification-operating-model']).toBe(
        'dashboard-api.legalClarificationOperatingModelStatus'
      );
      expect(aliases['GET /dashboard/dr-readiness-evidence']).toBe(
        'dashboard-api.drReadinessEvidenceStatus'
      );
      expect(aliases['GET /dashboard/special-grid-usage-impact-map']).toBe(
        'dashboard-api.specialGridUsageImpactMapStatus'
      );
      expect(aliases['GET /dashboard/liquidity-planning-governance']).toBe(
        'dashboard-api.liquidityPlanningGovernanceStatus'
      );
      expect(aliases['GET /dashboard/energy-sharing-simulation-gate']).toBe(
        'dashboard-api.energySharingSimulationGateStatus'
      );
      expect(aliases['GET /dashboard/energy-sharing-42c-cutover-readiness']).toBe(
        'dashboard-api.energySharing42cCutoverReadinessStatus'
      );
      expect(aliases['GET /dashboard/nova-decision-lifecycle-readiness']).toBe(
        'dashboard-api.novaDecisionLifecycleReadinessStatus'
      );
      expect(aliases['GET /dashboard/stadtwerk-mauer-sandbox-runtime']).toBe(
        'dashboard-api.stadtwerkMauerSandboxRuntimeStatus'
      );
      expect(aliases['GET /dashboard/stadtwerk-mauer-external-interface-stubs']).toBe(
        'dashboard-api.stadtwerkMauerExternalInterfaceStubsStatus'
      );
      expect(aliases['GET /dashboard/stadtwerk-mauer-e2e-process-demo']).toBe(
        'dashboard-api.stadtwerkMauerE2eProcessDemoStatus'
      );
      expect(aliases['GET /dashboard/stadtwerk-mauer-mastr-data-overlay']).toBe(
        'dashboard-api.stadtwerkMauerMastrDataOverlayStatus'
      );
      expect(aliases['GET /dashboard/fnav-fast-track-contract-gate']).toBe(
        'dashboard-api.fnavFastTrackContractGateStatus'
      );
      expect(aliases['GET /dashboard/cross-channel-vnb-signal-queue']).toBe(
        'dashboard-api.crossChannelVnbSignalQueueStatus'
      );
      expect(aliases['GET /dashboard/asset-valuation-transformation-gate']).toBe(
        'dashboard-api.assetValuationTransformationGateStatus'
      );
      expect(aliases['GET /dashboard/gas-capacity-booking-review-gate']).toBe(
        'dashboard-api.gasCapacityBookingReviewGateStatus'
      );
      expect(aliases['GET /dashboard/gas-network-decision-chain']).toBe(
        'dashboard-api.gasNetworkDecisionChainStatus'
      );
      expect(aliases['GET /dashboard/water-pricing-net-investment-alignment']).toBe(
        'dashboard-api.waterPricingNetInvestmentAlignmentStatus'
      );
      expect(aliases['GET /dashboard/areal-network-integration-offer-gate']).toBe(
        'dashboard-api.arealNetworkIntegrationOfferGateStatus'
      );
      expect(aliases['GET /dashboard/transformation-financing-scenario-view']).toBe(
        'dashboard-api.transformationFinancingScenarioViewStatus'
      );
      expect(aliases['GET /dashboard/investment-owner-deadline-budget-gate']).toBe(
        'dashboard-api.investmentOwnerDeadlineBudgetGateStatus'
      );
      expect(aliases['GET /dashboard/no-regret-measure-definition-gate']).toBe(
        'dashboard-api.noRegretMeasureDefinitionGateStatus'
      );
      expect(aliases['GET /dashboard/gas-grid-transformation-asset-cockpit']).toBe(
        'dashboard-api.gasGridTransformationAssetCockpitStatus'
      );
      expect(aliases['GET /dashboard/leadership-delta-cockpit']).toBe(
        'dashboard-api.leadershipDeltaCockpitStatus'
      );
      expect(aliases['GET /dashboard/live-update-stream-contract']).toBe(
        'dashboard-api.liveUpdateStreamContractStatus'
      );
      expect(aliases['GET /dashboard/smgw-connector-readiness']).toBe(
        'dashboard-api.smgwConnectorReadinessStatus'
      );
      expect(aliases['POST /stadtwerk-mauer-sandbox-runtime/events']).toBe(
        'stadtwerk-mauer-sandbox-runtime.ingestEvent'
      );
      expect(aliases['POST /stadtwerk-mauer-sandbox-runtime/reset']).toBe(
        'stadtwerk-mauer-sandbox-runtime.reset'
      );
      expect(aliases['GET /stadtwerk-mauer-sandbox-runtime/status']).toBe(
        'stadtwerk-mauer-sandbox-runtime.status'
      );
      expect(aliases['POST /stadtwerk-mauer/external-interface-stubs/call']).toBe(
        'stadtwerk-mauer-external-interface-stubs.callStub'
      );
      expect(aliases['GET /stadtwerk-mauer/external-interface-stubs/status']).toBe(
        'stadtwerk-mauer-external-interface-stubs.getStatus'
      );
      expect(aliases['POST /stadtwerk-mauer/e2e-process-demo/run']).toBe(
        'stadtwerk-mauer-e2e-process-demo.runDemo'
      );
      expect(aliases['GET /stadtwerk-mauer/e2e-process-demo/status']).toBe(
        'stadtwerk-mauer-e2e-process-demo.getStatus'
      );
      expect(aliases['GET /stadtwerk-mauer/mastr-data-overlay/status']).toBe(
        'stadtwerk-mauer-mastr-data-overlay.getStatus'
      );
      expect(aliases['GET /dashboard/regulatory-change-readiness']).toBe(
        'dashboard-api.regulatoryChangeReadinessStatus'
      );
      expect(aliases['GET /dashboard/investment-two-track-control']).toBe(
        'dashboard-api.investmentTwoTrackControlStatus'
      );
      expect(aliases['GET /dashboard/sap-budget-psp-gate']).toBe(
        'dashboard-api.sapBudgetPspGateStatus'
      );
      expect(aliases['GET /dashboard/energy-tax-information-package']).toBe(
        'dashboard-api.energyTaxInformationPackageStatus'
      );
      expect(aliases['GET /dashboard/investment-risk-translation']).toBe(
        'dashboard-api.investmentRiskTranslationStatus'
      );
      expect(aliases['GET /dashboard/budget-waterfall-governance']).toBe(
        'dashboard-api.budgetWaterfallGovernanceStatus'
      );
      expect(aliases['GET /dashboard/gas-decommissioning-roadmap']).toBe(
        'dashboard-api.gasDecommissioningRoadmapStatus'
      );
      expect(aliases['GET /dashboard/jour-fixe-decision-closure']).toBe(
        'dashboard-api.jourFixeDecisionClosureStatus'
      );
      expect(aliases['GET /dashboard/off-balancing-metering-pruefmatrix']).toBe(
        'dashboard-api.offBalancingMeteringPruefmatrixStatus'
      );
      expect(aliases['GET /dashboard/automation-requirements-decision-value']).toBe(
        'dashboard-api.automationRequirementsDecisionValueStatus'
      );
      expect(aliases['GET /dashboard/smart-meter-off-balancing-purpose-lock']).toBe(
        'dashboard-api.smartMeterOffBalancingPurposeLockStatus'
      );
      expect(aliases['GET /dashboard/imsys-schedule-value-chain-readiness']).toBe(
        'dashboard-api.imsysScheduleValueChainReadinessStatus'
      );
      expect(aliases['GET /dashboard/cls-digital-twin-compliance-gate']).toBe(
        'dashboard-api.clsDigitalTwinComplianceGateStatus'
      );
      expect(aliases['GET /dashboard/legacy-control-technology-transition']).toBe(
        'dashboard-api.legacyControlTechnologyTransitionStatus'
      );
      expect(aliases['GET /dashboard/controllability-submission-cockpit']).toBe(
        'dashboard-api.controllabilitySubmissionCockpitStatus'
      );
      expect(aliases['GET /dashboard/crisis-decision-routine']).toBe(
        'dashboard-api.crisisDecisionRoutineStatus'
      );
      expect(aliases['GET /dashboard/investment-committee-steering-cards']).toBe(
        'dashboard-api.investmentCommitteeSteeringCardsStatus'
      );
      expect(aliases['GET /dashboard/investment-data-review-queue']).toBe(
        'dashboard-api.investmentDataReviewQueueStatus'
      );
      expect(aliases['GET /dashboard/flex-strategic-demand-intake']).toBe(
        'dashboard-api.flexStrategicDemandIntakeStatus'
      );
      expect(aliases['GET /dashboard/gas-infrastructure-risk-governance']).toBe(
        'dashboard-api.gasInfrastructureRiskGovernanceStatus'
      );
      expect(aliases['GET /dashboard/metering-rollout-process-indicator']).toBe(
        'dashboard-api.meteringRolloutProcessIndicatorStatus'
      );
      expect(aliases['GET /dashboard/heat-transformation-line-asset-model']).toBe(
        'dashboard-api.heatTransformationLineAssetModelStatus'
      );
      expect(aliases['GET /dashboard/process-sensitization-readiness-map']).toBe(
        'dashboard-api.processSensitizationReadinessMapStatus'
      );
      expect(aliases['GET /dashboard/netzprozess-readiness-gate']).toBe(
        'dashboard-api.netzprozessReadinessGateStatus'
      );
      expect(aliases['GET /dashboard/grossspeicher-anschluss-readiness-gate']).toBe(
        'dashboard-api.grossspeicherAnschlussReadinessGateStatus'
      );
      expect(aliases['GET /dashboard/role-permission-access-readiness-gate']).toBe(
        'dashboard-api.rolePermissionAccessReadinessGateStatus'
      );
      expect(aliases['GET /dashboard/owner-deadline-evidence-gate']).toBe(
        'dashboard-api.ownerDeadlineEvidenceGateStatus'
      );
      expect(aliases['GET /dashboard/automation-risk-gate']).toBe(
        'dashboard-api.automationRiskGateStatus'
      );
      expect(aliases['GET /dashboard/redispatch-project-controlling-kpi-cockpit']).toBe(
        'dashboard-api.redispatchProjectControllingKpiCockpitStatus'
      );
      expect(aliases['GET /dashboard/stadtwerk-mauer-vdmi-profile']).toBe(
        'dashboard-api.stadtwerkMauerVdmiProfileStatus'
      );
      expect(aliases['GET /dashboard/stadtwerk-mauer-capability-projection']).toBe(
        'dashboard-api.stadtwerkMauerCapabilityProjectionStatus'
      );
      expect(aliases['GET /dashboard/stadtwerk-mauer-event-replay-preview']).toBe(
        'dashboard-api.stadtwerkMauerEventReplayPreviewStatus'
      );
      expect(aliases['GET /znp/projects/:projectId/production-readiness/status']).toBe(
        'znp.productionReadinessStatus'
      );
      expect(aliases['GET /agent-sidecar/tools']).toBe('agent-sidecar.listTools');
      expect(aliases['POST /agent-sidecar/tools/:name/call']).toBe('agent-sidecar.callTool');
      expect(aliases['GET /agent-sidecar/descriptor']).toBe('agent-sidecar.descriptor');
      expect(aliases['GET /agent-sidecar/mcp/tools']).toBe('agent-sidecar.mcpListTools');
      expect(aliases['POST /agent-sidecar/mcp/tools/:name/call']).toBe(
        'agent-sidecar.mcpCallTool'
      );
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

    it('should have explicit aliases for Blindflug Radar routes', () => {
      const apiRoute = ApiService.settings.routes.find((r) => r.path === '/api');
      const aliases = apiRoute?.aliases || {};

      expect(aliases['POST /blindflug-radar/scan']).toBe('blindflug-radar.scanBlindflug');
      expect(aliases['POST /blindflug-radar/recommendations']).toBe(
        'blindflug-radar.recommendFromDisturbances'
      );
      expect(aliases['GET /blindflug-radar/scans']).toBe('blindflug-radar.listScans');
      expect(aliases['GET /blindflug-radar/scans/:id']).toBe('blindflug-radar.getScan');
    });

    it('should have explicit aliases for OSM Geo routes', () => {
      const apiRoute = ApiService.settings.routes.find((r) => r.path === '/api');
      const aliases = apiRoute?.aliases || {};

      expect(aliases['POST /osm-geo/validate']).toBe('osm-geo.validate');
      expect(aliases['POST /osm-geo/infrastructure-nearby']).toBe('osm-geo.infrastructureNearby');
      expect(aliases['POST /osm-geo/substation-finder']).toBe('osm-geo.substationFinder');
      expect(aliases['POST /osm-geo/grid-topology']).toBe('osm-geo.gridTopology');
    });

    it('should have explicit aliases for Agent Receipts routes', () => {
      const apiRoute = ApiService.settings.routes.find((r) => r.path === '/api');
      const aliases = apiRoute?.aliases || {};

      expect(aliases['GET /agent-receipts']).toBe('agent-receipts.list');
      expect(aliases['POST /agent-receipts']).toBe('agent-receipts.create');
      expect(aliases['POST /agent-receipts/select']).toBe('agent-receipts.select');
      expect(aliases['POST /agent-receipts/validate']).toBe('agent-receipts.validate');
      expect(aliases['GET /agent-receipts/:id']).toBe('agent-receipts.get');
      expect(aliases['PUT /agent-receipts/:id']).toBe('agent-receipts.update');
      expect(aliases['POST /agent-receipts/:id/status']).toBe('agent-receipts.setStatus');
      expect(aliases['DELETE /agent-receipts/:id']).toBe('agent-receipts.archive');
    });

    it('should have explicit aliases for Actor Persona routes in non-shadowing order', () => {
      const apiRoute = ApiService.settings.routes.find((r) => r.path === '/api');
      const aliases = apiRoute?.aliases || {};
      const aliasKeys = Object.keys(aliases);

      expect(aliases['GET /agent-personas']).toBe('agent-persona.list');
      expect(aliases['POST /agent-personas']).toBe('agent-persona.create');
      expect(aliases['GET /agent-personas/by-role/:role']).toBe('agent-persona.listByRole');
      expect(aliases['GET /agent-personas/resolve-by-role/:role']).toBe(
        'agent-persona.resolveByRole'
      );
      expect(aliases['GET /agent-personas/:id']).toBe('agent-persona.get');
      expect(aliases['PUT /agent-personas/:id']).toBe('agent-persona.update');
      expect(aliases['DELETE /agent-personas/:id']).toBe('agent-persona.remove');

      expect(aliasKeys.indexOf('GET /agent-personas/by-role/:role')).toBeLessThan(
        aliasKeys.indexOf('GET /agent-personas/:id')
      );
      expect(aliasKeys.indexOf('GET /agent-personas/resolve-by-role/:role')).toBeLessThan(
        aliasKeys.indexOf('GET /agent-personas/:id')
      );
    });

    it('should include Netzfahrplan / fNAV tag in OpenAPI', async () => {
      const apiRoute = ApiService.settings.routes.find((r) => r.path === '/api');
      expect(apiRoute).toBeDefined();
      const tags =
        ApiService.settings.routes.find((r) => r.path === '/api')?.openApiService?.tags || [];
      // Verify the tag exists in the api service definition (tags are in the service schema)
      const apiServiceTags = ApiService.settings?.tags || [];
      // Check via aliases — the 3 routes must be present
      const aliases = apiRoute?.aliases || {};
      expect(aliases['POST /netzfahrplan/generate']).toBe('grid-operations.netzfahrplanGenerate');
      expect(aliases['POST /grid-connection/fnav/validate']).toBe('grid-connection.fnavValidate');
      expect(aliases['POST /finance-agent/fnav/economics']).toBe('finance-agent.fnavEconomics');
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

    it('should configure multipart upload limits for personal-agent chat', () => {
      const apiRoute = ApiService.settings.routes.find((r) => r.path === '/api');
      expect(apiRoute.busboyConfig).toBeDefined();
      expect(apiRoute.busboyConfig.limits.files).toBe(5);
      expect(apiRoute.busboyConfig.limits.fileSize).toBe(10 * 1024 * 1024);
      expect(apiRoute.busboyConfig.limits.fields).toBe(16);
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

    it('should normalize multipart personal-agent chat params into ctx.params.fileAttachments', async () => {
      const apiRoute = ApiService.settings.routes.find((r) => r.path === '/api');
      const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'api-multipart-'));
      const uploadPath = path.join(tmpDir, 'test.csv');
      fs.writeFileSync(uploadPath, 'A,B\n1,2\n');

      const ctx = { meta: {} };
      const req = {
        headers: { 'x-tenant-id': 'tenant-upload' },
        query: {},
        body: {},
        params: {},
        method: 'POST',
        url: '/api/personal-agent/chat',
        $multipart: true,
        $params: {
          message: 'Analysiere diese CSV',
          executionMode: 'auto',
          chatMode: 'consultation',
          forceReceipt: 'vnb-lookup-v1',
          preferredReceipts: '["vnb-lookup-v1","fallback-v1"]',
          allowDraftReceipts: 'true',
          explainReceiptSelection: 'true',
          disableReceiptSelection: 'false',
          fileAttachments: [
            {
              path: uploadPath,
              originalname: 'test.csv',
              mimetype: 'text/csv',
              size: 8,
            },
          ],
        },
      };

      await apiRoute.onBeforeCall.call(
        { logger: { debug: jest.fn(), warn: jest.fn() }, broker },
        ctx,
        apiRoute,
        req,
        {}
      );

      expect(ctx.params.message).toBe('Analysiere diese CSV');
      expect(ctx.params.chatMode).toBe('consultation');
      expect(ctx.params.forceReceipt).toBe('vnb-lookup-v1');
      expect(ctx.params.preferredReceipts).toEqual(['vnb-lookup-v1', 'fallback-v1']);
      expect(ctx.params.allowDraftReceipts).toBe(true);
      expect(ctx.params.explainReceiptSelection).toBe(true);
      expect(ctx.params.disableReceiptSelection).toBe(false);
      expect(ctx.params.fileAttachments).toHaveLength(1);
      expect(ctx.params.fileAttachments[0].attachmentId).toMatch(/^fa_/);
      expect(ctx.params.fileAttachments[0].tempPath).toContain(
        path.join('uploads', 'tenant-upload')
      );
      expect(fs.existsSync(ctx.params.fileAttachments[0].tempPath)).toBe(true);

      fs.rmSync(tmpDir, { recursive: true, force: true });
      fs.rmSync(path.dirname(path.dirname(ctx.params.fileAttachments[0].tempPath)), {
        recursive: true,
        force: true,
      });
    });

    it('should reject multipart chat when total upload size exceeds 50MB', async () => {
      const apiRoute = ApiService.settings.routes.find((r) => r.path === '/api');
      const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'api-multipart-big-'));
      const p1 = path.join(tmpDir, 'a.csv');
      const p2 = path.join(tmpDir, 'b.csv');
      fs.writeFileSync(p1, 'A,B\n1,2\n');
      fs.writeFileSync(p2, 'A,B\n3,4\n');

      const ctx = { meta: {} };
      const req = {
        headers: { 'x-tenant-id': 'tenant-upload' },
        query: {},
        body: {},
        params: {},
        method: 'POST',
        url: '/api/personal-agent/chat',
        $multipart: true,
        $params: {
          message: 'Analysiere diese Dateien',
          fileAttachments: [
            { path: p1, originalname: 'a.csv', mimetype: 'text/csv', size: 30 * 1024 * 1024 },
            { path: p2, originalname: 'b.csv', mimetype: 'text/csv', size: 30 * 1024 * 1024 },
          ],
        },
      };

      await expect(
        apiRoute.onBeforeCall.call(
          { logger: { debug: jest.fn(), warn: jest.fn() }, broker },
          ctx,
          apiRoute,
          req,
          {}
        )
      ).rejects.toMatchObject({ code: 413, type: 'FILE_TOO_LARGE' });

      fs.rmSync(tmpDir, { recursive: true, force: true });
    });

    it('should inject header tenantId into agent-persona params before action validation', async () => {
      const apiRoute = ApiService.settings.routes.find((r) => r.path === '/api');
      const ctx = { meta: {} };
      const req = {
        headers: { 'x-tenant-id': 'tenant-rest' },
        query: {},
        body: {
          tenantId: 'wrong-tenant',
          id: 'rest-persona',
          personaName: 'REST Persona',
          personaType: 'human',
          assignedRoles: ['management'],
          communicationChannels: [{ type: 'email', address: 'rest@example.com' }],
        },
        params: {},
        $params: {
          tenantId: 'wrong-tenant',
          id: 'rest-persona',
          personaName: 'REST Persona',
          personaType: 'human',
          assignedRoles: ['management'],
          communicationChannels: [{ type: 'email', address: 'rest@example.com' }],
        },
        method: 'POST',
        url: '/api/agent-personas',
      };

      await apiRoute.onBeforeCall.call(
        { logger: { debug: jest.fn(), warn: jest.fn() }, broker },
        ctx,
        apiRoute,
        req,
        {}
      );

      expect(ctx.meta.tenantId).toBe('tenant-rest');
      expect(req.$params.tenantId).toBe('tenant-rest');

      const result = await broker.call('agent-persona.create', req.$params, { meta: ctx.meta });
      expect(result.success).toBe(true);
      expect(result.item.tenantId).toBe('tenant-rest');
      expect(result.item.id).toBe('rest-persona');
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

    it('should reject unauthenticated token-management endpoints before handlers', async () => {
      const apiRoute = ApiService.settings.routes.find((r) => r.path === '/api');
      const protectedRequests = [
        { method: 'GET', url: '/api/tokens' },
        { method: 'POST', url: '/api/tokens' },
        { method: 'DELETE', url: '/api/tokens/token-id' },
        { method: 'GET', url: '/api/tokens/tenants' },
      ];

      for (const request of protectedRequests) {
        const ctx = { meta: {} };
        const req = {
          headers: {},
          query: {},
          body: {},
          params: {},
          $params: {},
          method: request.method,
          url: request.url,
        };

        await expect(
          apiRoute.onBeforeCall.call(
            { logger: { debug: jest.fn(), warn: jest.fn() }, broker },
            ctx,
            apiRoute,
            req,
            {}
          )
        ).rejects.toMatchObject({ code: 401, type: 'AUTH_REQUIRED' });
      }
    });

    it('should keep token verification endpoint open for token payload verification', async () => {
      const apiRoute = ApiService.settings.routes.find((r) => r.path === '/api');
      const ctx = { meta: {} };
      const req = {
        headers: {},
        query: {},
        body: { token: 'ck_verifyonlytoken' },
        params: {},
        $params: { token: 'ck_verifyonlytoken' },
        method: 'POST',
        url: '/api/tokens/verify',
      };

      await expect(
        apiRoute.onBeforeCall.call(
          { logger: { debug: jest.fn(), warn: jest.fn() }, broker },
          ctx,
          apiRoute,
          req,
          {}
        )
      ).resolves.toBeUndefined();
      expect(req.$params.token).toBe('ck_verifyonlytoken');
      expect(req.body.token).toBe('ck_verifyonlytoken');
    });

    it('should accept valid full-access ck_ token for admin endpoints', async () => {
      const apiRoute = ApiService.settings.routes.find((r) => r.path === '/api');
      const created = await broker.call('token-manager.create', {
        name: 'Admin',
        scope: 'full-access',
        tenantId: 'public',
        userId: 'admin',
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
        tenantId: 'public',
        userId: 'readonly-tester',
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

    it('should allow read-only ck_ token on the policy-gated sidecar tool call endpoint', async () => {
      const apiRoute = ApiService.settings.routes.find((r) => r.path === '/api');
      const created = await broker.call('token-manager.create', {
        name: 'OpenClawSidecarReadOnly',
        scope: 'read-only',
        tenantId: 'public',
        userId: 'svc:openclaw',
      });

      const ctx = { meta: {} };
      const req = {
        headers: { authorization: `Bearer ${created.data.token}` },
        query: {},
        body: { input: { context: { tenantId: 'public' } } },
        params: { name: 'cernion.list_readonly_capabilities' },
        $params: {
          name: 'cernion.list_readonly_capabilities',
          input: { context: { tenantId: 'public' } },
        },
        method: 'POST',
        url: '/api/agent-sidecar/tools/cernion.list_readonly_capabilities/call',
      };

      await expect(
        apiRoute.onBeforeCall.call({ logger: { debug: jest.fn() }, broker }, ctx, apiRoute, req, {})
      ).resolves.toBeUndefined();
      expect(ctx.meta.apiToken.scope).toBe('read-only');
      expect(ctx.meta.apiToken.tenantId).toBe('public');
    });

    it('should allow read-only ck_ token on the MCP-like sidecar bridge call endpoint', async () => {
      const apiRoute = ApiService.settings.routes.find((r) => r.path === '/api');
      const created = await broker.call('token-manager.create', {
        name: 'OpenClawMcpSidecarReadOnly',
        scope: 'read-only',
        tenantId: 'public',
        userId: 'svc:openclaw',
      });

      const ctx = { meta: {} };
      const req = {
        headers: { authorization: `Bearer ${created.data.token}` },
        query: {},
        body: { arguments: { context: { tenantId: 'public' } } },
        params: { name: 'cernion.list_readonly_capabilities' },
        $params: {
          name: 'cernion.list_readonly_capabilities',
          arguments: { context: { tenantId: 'public' } },
        },
        method: 'POST',
        url: '/api/agent-sidecar/mcp/tools/cernion.list_readonly_capabilities/call',
      };

      await expect(
        apiRoute.onBeforeCall.call({ logger: { debug: jest.fn() }, broker }, ctx, apiRoute, req, {})
      ).resolves.toBeUndefined();
      expect(ctx.meta.apiToken.scope).toBe('read-only');
      expect(ctx.meta.apiToken.tenantId).toBe('public');
    });

    it('should reject read-only ck_ token on tenant quota admin endpoints', async () => {
      const apiRoute = ApiService.settings.routes.find((r) => r.path === '/api');
      const created = await broker.call('token-manager.create', {
        name: 'QuotaReadOnly',
        scope: 'read-only',
        tenantId: 'tenant-a',
        userId: 'quota-readonly-tester',
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
        apiRoute.onBeforeCall.call(
          { logger: { debug: jest.fn() }, broker },
          putCtx,
          apiRoute,
          putReq,
          {}
        )
      ).rejects.toMatchObject({ code: 403, type: 'TOKEN_SCOPE_VIOLATION' });
    });

    it('should set rate-limit headers and reject the next request after limit exhaustion', async () => {
      const apiRoute = ApiService.settings.routes.find((r) => r.path === '/api');
      const created = await broker.call('token-manager.create', {
        name: 'QuotaAdmin',
        scope: 'full-access',
        tenantId: 'tenant-rate',
        userId: 'quota-admin-tester',
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

      await apiRoute.onBeforeCall.call(
        { logger: { debug: jest.fn() }, broker },
        firstCtx,
        apiRoute,
        req,
        {}
      );
      expect(firstCtx.meta.$responseHeaders['X-RateLimit-Limit']).toBe('1');
      expect(firstCtx.meta.$responseHeaders['X-RateLimit-Remaining']).toBe('0');
      expect(firstCtx.meta.$responseHeaders['X-RateLimit-Reset']).toBeDefined();

      const secondCtx = { meta: {} };
      await expect(
        apiRoute.onBeforeCall.call(
          { logger: { debug: jest.fn() }, broker },
          secondCtx,
          apiRoute,
          req,
          {}
        )
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

    it('should use numeric status for onError when error code is symbolic', () => {
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
        code: 'ERR_DLOPEN_FAILED',
        status: 503,
        message: 'Module did not self-register',
        type: 'EDM_SQLITE_UNAVAILABLE',
      });

      expect(res._status).toBe(503);
      const payload = JSON.parse(res._body);
      expect(payload.code).toBe('ERR_DLOPEN_FAILED');
      expect(payload.type).toBe('EDM_SQLITE_UNAVAILABLE');
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
        tenantId: 'public',
        userId: 'metrics-readonly-tester',
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
      await broker.call(
        'tenant-quota.getQuotas',
        { id: 'tenant-a' },
        { meta: { tenantId: 'tenant-a' } }
      );
      await broker.call(
        'tenant-quota.listEvents',
        { id: 'tenant-a' },
        { meta: { tenantId: 'tenant-a' } }
      );
    });

    it('should reject cross-tenant quota reads for tenant-scoped meta', async () => {
      await expect(
        broker.call(
          'tenant-quota.getQuotas',
          { id: 'tenant-b' },
          { meta: { tenantId: 'tenant-a' } }
        )
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
        tenantId: 'public',
        userId: 'nbp-readonly-tester',
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
        tenantId: 'public',
        userId: 'verify-regression-tester',
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
