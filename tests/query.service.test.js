/**
 * Query Service Integration Tests
 *
 * Test the Query Tools microservice
 */

const { ServiceBroker } = require('moleculer');

jest.mock('../src/mcp-client', () => ({
  callWithNewSession: jest.fn(),
}));

jest.mock('../src/async-job-poller', () => ({
  callWithAutoPoll: jest.fn(),
}));

const { callWithNewSession } = require('../src/mcp-client');
const { callWithAutoPoll } = require('../src/async-job-poller');
const QueryService = require('../services/query.service');

describe('Query Service', () => {
  let broker;

  beforeAll(() => {
    callWithNewSession.mockImplementation(async (toolName, params) => ({
      success: true,
      toolName,
      params,
      data: {},
    }));

    callWithAutoPoll.mockImplementation(async (toolName, params) => ({
      success: true,
      toolName,
      params,
      data: {},
    }));

    broker = new ServiceBroker({ logger: false });
    broker.createService(QueryService);
    return broker.start();
  });

  afterAll(() => broker.stop());

  describe('ask action', () => {
    it('should validate required query parameter', async () => {
      await expect(broker.call('query.ask', {})).rejects.toThrow();
    });

    it('should accept valid query', async () => {
      const result = await broker.call('query.ask', {
        query: 'Wieviel PV-Leistung in Bayern?',
      });

      // Result structure depends on MCP response
      expect(result).toBeDefined();
    });

    it('should handle explain parameter', async () => {
      const result = await broker.call('query.ask', {
        query: 'Wieviel PV-Leistung in Bayern?',
        explain: true,
      });

      expect(result).toBeDefined();
    });
  });

  describe('askLearned action', () => {
    it('should validate confidence parameter range', async () => {
      await expect(
        broker.call('query.askLearned', {
          query: 'Test query',
          confidence: 1.5,
        })
      ).rejects.toThrow();
    });

    it('should accept valid learned query', async () => {
      const result = await broker.call('query.askLearned', {
        query: 'PV-Leistung in Hessen',
        confidence: 0.7,
      });

      expect(result).toBeDefined();
    });
  });

  describe('discover action', () => {
    it('should validate scope enum', async () => {
      await expect(
        broker.call('query.discover', {
          scope: 'invalid_scope',
        })
      ).rejects.toThrow();
    });

    it('should discover databases', async () => {
      const result = await broker.call('query.discover', {
        scope: 'databases',
      });

      expect(result).toBeDefined();
    });

    it('should discover tools', async () => {
      const result = await broker.call('query.discover', {
        scope: 'tools',
      });

      expect(result).toBeDefined();
    });
  });

  describe('search action (Copilot endpoint)', () => {
    it('requires q parameter', async () => {
      await expect(broker.call('query.search', {})).rejects.toThrow();
    });

    it('rejects q longer than 200 characters', async () => {
      await expect(broker.call('query.search', { q: 'x'.repeat(201) })).rejects.toThrow();
    });

    it('rejects invalid domain', async () => {
      await expect(broker.call('query.search', { q: 'Test', domain: 'invalid' })).rejects.toThrow();
      await expect(broker.call('query.search', { q: 'Test', domain: 'edm2' })).rejects.toThrow();
    });

    it('rejects limit out of range', async () => {
      await expect(broker.call('query.search', { q: 'Test', limit: 0 })).rejects.toThrow();
      await expect(broker.call('query.search', { q: 'Test', limit: 26 })).rejects.toThrow();
    });

    it('returns valid response shape when company service returns empty results', async () => {
      // Both company.list and edm.getMelo calls will fail (services not loaded),
      // error-catching in handler produces empty results array.
      const result = await broker.call('query.search', { q: 'Stadtwerke Heidelberg' });

      expect(result).toHaveProperty('query', 'Stadtwerke Heidelberg');
      expect(result).toHaveProperty('domain', 'all');
      expect(result).toHaveProperty('totalResults');
      expect(result).toHaveProperty('results');
      expect(Array.isArray(result.results)).toBe(true);
    });

    it('returns valid response shape for domain=companies', async () => {
      const result = await broker.call('query.search', { q: 'TestVNB', domain: 'companies' });

      expect(result.domain).toBe('companies');
      expect(Array.isArray(result.results)).toBe(true);
    });

    it('returns valid response shape for domain=vnb', async () => {
      const result = await broker.call('query.search', { q: 'Netze', domain: 'vnb' });

      expect(result.domain).toBe('vnb');
      expect(Array.isArray(result.results)).toBe(true);
    });

    it('skips edm lookup when q does not look like a MeLo ID', async () => {
      const result = await broker.call('query.search', { q: 'Heidelberg', domain: 'edm' });

      expect(result.domain).toBe('edm');
      expect(result.results).toHaveLength(0);
    });

    it('attempts edm lookup when q looks like a MeLo ID', async () => {
      // edm.getMelo will fail (service not loaded) — error caught, result is empty
      const result = await broker.call('query.search', {
        q: 'DE00012345678901234567890123456789',
        domain: 'edm',
      });

      expect(result.domain).toBe('edm');
      expect(Array.isArray(result.results)).toBe(true);
    });

    it('respects limit parameter', async () => {
      const result = await broker.call('query.search', { q: 'anything', limit: 5 });

      expect(result.results.length).toBeLessThanOrEqual(5);
    });

    it('supports body-style Copilot search wrapper', async () => {
      const result = await broker.call('query.searchCopilot', {
        q: 'Wiesloch',
        domain: 'vnb',
        limit: 5,
      });

      expect(result).toHaveProperty('query', 'Wiesloch');
      expect(result).toHaveProperty('domain', 'vnb');
      expect(Array.isArray(result.results)).toBe(true);
    });

    it('result items have the required Copilot schema shape when data is present', async () => {
      // Inject a live company service mock to verify result shape
      const fakeBroker = new (require('moleculer').ServiceBroker)({ logger: false });

      fakeBroker.createService(require('../services/query.service'));
      fakeBroker.createService({
        name: 'company',
        actions: {
          list: {
            handler() {
              return {
                companies: [
                  {
                    companyId: 'uuid-1',
                    displayName: 'Stadtwerke Teststadt',
                    legalName: 'Stadtwerke Teststadt GmbH',
                    status: 'active',
                    members: [
                      { bdewCode: '9900111000001', role: 'VNB', active: true },
                      { bdewCode: '9910111000002', role: 'Lieferant', active: true },
                    ],
                  },
                ],
              };
            },
          },
        },
      });

      await fakeBroker.start();
      try {
        const result = await fakeBroker.call('query.search', {
          q: 'Stadtwerke Teststadt',
          domain: 'companies',
        });

        expect(result.totalResults).toBe(1);
        const item = result.results[0];
        expect(item).toHaveProperty('id', 'uuid-1');
        expect(item).toHaveProperty('title', 'Stadtwerke Teststadt');
        expect(item).toHaveProperty('domain', 'companies');
        expect(item).toHaveProperty('type', 'company');
        expect(item).toHaveProperty('status', 'active');
        expect(item.url).toBe('/api/companies/uuid-1');
        expect(item.excerpt).toMatch(/VNB/);
        expect(item.metadata).toMatchObject({ memberCount: 2, hasVnb: true });
      } finally {
        await fakeBroker.stop();
      }
    });

    it('accepts new domain values: vdmi, grid_connection, znp', async () => {
      // All three call services that aren't loaded — errors are caught and return empty arrays
      const vdmiResult = await broker.call('query.search', { q: 'Test', domain: 'vdmi' });
      expect(vdmiResult.domain).toBe('vdmi');
      expect(Array.isArray(vdmiResult.results)).toBe(true);

      const gcResult = await broker.call('query.search', { q: 'Test', domain: 'grid_connection' });
      expect(gcResult.domain).toBe('grid_connection');
      expect(Array.isArray(gcResult.results)).toBe(true);

      const znpResult = await broker.call('query.search', { q: 'Test', domain: 'znp' });
      expect(znpResult.domain).toBe('znp');
      expect(Array.isArray(znpResult.results)).toBe(true);
    });

    it('vdmi result items have correct shape with type and status', async () => {
      const fakeBroker = new (require('moleculer').ServiceBroker)({ logger: false });
      fakeBroker.createService(require('../services/query.service'));
      fakeBroker.createService({
        name: 'vdmi',
        actions: {
          list: {
            handler() {
              return {
                items: [
                  {
                    id: 'vdmi-1',
                    name: 'Netzanschluss-Genehmigung PV',
                    scope: 'PV-Anlage Dach',
                    processType: 'standard',
                    status: 'active',
                    nominationStatus: 'pending',
                    evidenceCount: 2,
                  },
                ],
              };
            },
          },
        },
      });
      await fakeBroker.start();
      try {
        const result = await fakeBroker.call('query.search', {
          q: 'Netzanschluss',
          domain: 'vdmi',
        });
        expect(result.totalResults).toBe(1);
        const item = result.results[0];
        expect(item).toHaveProperty('id', 'vdmi-1');
        expect(item).toHaveProperty('domain', 'vdmi');
        expect(item).toHaveProperty('type', 'matrix');
        expect(item).toHaveProperty('status', 'active');
        expect(item.url).toBe('/api/vdmi/vdmi-1');
        expect(item.metadata).toMatchObject({
          processType: 'standard',
          nominationStatus: 'pending',
        });
      } finally {
        await fakeBroker.stop();
      }
    });

    it('grid_connection result items have correct shape with type and status', async () => {
      const fakeBroker = new (require('moleculer').ServiceBroker)({ logger: false });
      fakeBroker.createService(require('../services/query.service'));
      fakeBroker.createService({
        name: 'grid-connection',
        actions: {
          list: {
            handler() {
              return {
                validations: [
                  {
                    id: 'gc-report-1',
                    gridOperator: { name: 'STROMDAO Netze', mastrId: 'SNB123' },
                    decision: 'GO_CONDITIONAL',
                    createdAt: '2026-03-30T10:00:00Z',
                    findingsCount: 3,
                  },
                ],
              };
            },
          },
        },
      });
      await fakeBroker.start();
      try {
        const result = await fakeBroker.call('query.search', {
          q: 'STROMDAO',
          domain: 'grid_connection',
        });
        expect(result.totalResults).toBe(1);
        const item = result.results[0];
        expect(item).toHaveProperty('id', 'gc-report-1');
        expect(item).toHaveProperty('domain', 'grid_connection');
        expect(item).toHaveProperty('type', 'validation');
        expect(item).toHaveProperty('status', 'GO_CONDITIONAL');
        expect(item.url).toBe('/api/grid-connection/validations/gc-report-1');
        expect(item.metadata).toMatchObject({ gridOperatorName: 'STROMDAO Netze', findingsCount: 3 });
      } finally {
        await fakeBroker.stop();
      }
    });

    it('znp result items have correct shape with type and status', async () => {
      const fakeBroker = new (require('moleculer').ServiceBroker)({ logger: false });
      fakeBroker.createService(require('../services/query.service'));
      fakeBroker.createService({
        name: 'znp',
        actions: {
          listProjects: {
            handler() {
              return {
                projects: [
                  {
                    projectId: 'proj-lu-001',
                    name: 'Ludwigshafen Nord Q3-2026',
                    layers: ['layer0', 'layer1'],
                    graphStats: { nodes: 42, edges: 38 },
                    createdAt: '2026-05-01T08:00:00Z',
                  },
                ],
              };
            },
          },
        },
      });
      await fakeBroker.start();
      try {
        const result = await fakeBroker.call('query.search', { q: 'Ludwigshafen', domain: 'znp' });
        expect(result.totalResults).toBe(1);
        const item = result.results[0];
        expect(item).toHaveProperty('id', 'proj-lu-001');
        expect(item).toHaveProperty('domain', 'znp');
        expect(item).toHaveProperty('type', 'project');
        expect(item).toHaveProperty('status', 'active');
        expect(item.url).toBe('/api/znp/projects/proj-lu-001');
        expect(item.metadata).toMatchObject({ graphStats: { nodes: 42, edges: 38 } });
      } finally {
        await fakeBroker.stop();
      }
    });

    it('vdmi client-side filter excludes non-matching items', async () => {
      const fakeBroker = new (require('moleculer').ServiceBroker)({ logger: false });
      fakeBroker.createService(require('../services/query.service'));
      fakeBroker.createService({
        name: 'vdmi',
        actions: {
          list: {
            handler() {
              return {
                items: [
                  {
                    id: 'v1',
                    name: 'Netzanschluss PV',
                    scope: 'Dach',
                    processType: 'standard',
                    status: 'active',
                    nominationStatus: 'none',
                    evidenceCount: 0,
                  },
                  {
                    id: 'v2',
                    name: 'Zählerprüfung',
                    scope: 'Zählerplatz',
                    processType: 'adhoc',
                    status: 'draft',
                    nominationStatus: 'none',
                    evidenceCount: 0,
                  },
                ],
              };
            },
          },
        },
      });
      await fakeBroker.start();
      try {
        const result = await fakeBroker.call('query.search', {
          q: 'Netzanschluss',
          domain: 'vdmi',
        });
        expect(result.totalResults).toBe(1);
        expect(result.results[0].id).toBe('v1');
      } finally {
        await fakeBroker.stop();
      }
    });

    it('filters vnb domain to only return companies with VNB role', async () => {
      const fakeBroker = new (require('moleculer').ServiceBroker)({ logger: false });

      fakeBroker.createService(require('../services/query.service'));
      fakeBroker.createService({
        name: 'company',
        actions: {
          list: {
            handler() {
              return {
                companies: [
                  {
                    companyId: 'vnb-1',
                    displayName: 'Netzbetreiber AG',
                    legalName: 'Netzbetreiber AG',
                    status: 'active',
                    members: [{ bdewCode: '9900111000001', role: 'VNB', active: true }],
                  },
                  {
                    companyId: 'no-vnb',
                    displayName: 'Lieferant GmbH',
                    legalName: 'Lieferant GmbH',
                    status: 'active',
                    members: [{ bdewCode: '9910111000002', role: 'Lieferant', active: true }],
                  },
                ],
              };
            },
          },
        },
      });

      await fakeBroker.start();
      try {
        const result = await fakeBroker.call('query.search', { q: 'Test', domain: 'vnb' });

        expect(result.totalResults).toBe(1);
        expect(result.results[0].id).toBe('vnb-1');
      } finally {
        await fakeBroker.stop();
      }
    });
  });
});
