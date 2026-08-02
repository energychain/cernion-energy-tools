const { ServiceBroker } = require('moleculer');

jest.mock('../src/mcp-client', () => ({
  callWithNewSession: jest.fn(),
}));

const { callWithNewSession } = require('../src/mcp-client');
const WilliFederatedService = require('../services/willi-federated.service');

describe('Willi-Federated Service', () => {
  let broker;

  beforeEach(() => {
    callWithNewSession.mockReset();
  });

  beforeAll(async () => {
    broker = new ServiceBroker({ logger: false });
    broker.createService(WilliFederatedService);
    await broker.start();
  });

  afterAll(async () => {
    await broker.stop();
  });

  describe('search action', () => {
    it('should be defined with the expected REST endpoint', () => {
      const action = broker.getLocalService('willi-federated').schema.actions.search;
      expect(action).toBeDefined();
      expect(action.rest).toBe('POST /search');
    });

    it('rejects when query is missing', async () => {
      await expect(broker.call('willi-federated.search', {})).rejects.toThrow();
    });

    it('rejects limit above 20', async () => {
      await expect(
        broker.call('willi-federated.search', { query: 'GPKE Frist', limit: 21 })
      ).rejects.toThrow();
    });

    it('normalizes an MCP success response with nested data.results[]', async () => {
      callWithNewSession.mockResolvedValue({
        success: true,
        data: {
          queryType: 'semantic',
          source: 'willi-federated-service',
          query: 'Welche Fristen gelten für den Lieferantenwechsel nach GPKE?',
          returned: 1,
          totalScanned: 1204,
          warning: null,
          results: [
            {
              id: 'wf-1',
              slug: 'gpke-lieferantenwechsel-fristen',
              title: 'GPKE: Fristen beim Lieferantenwechsel',
              score: 32,
              category: 'edifact',
              tags: ['GPKE', 'Frist'],
              excerpt: 'Kurzfassung...',
              url: 'https://stromhaltig.de/wissen/gpke-lieferantenwechsel-fristen',
              content: 'Volltext, der standardmaessig nicht zurueckgegeben wird...',
            },
          ],
        },
      });

      const result = await broker.call('willi-federated.search', {
        query: 'Welche Fristen gelten für den Lieferantenwechsel nach GPKE?',
        limit: 3,
      });

      expect(result.success).toBe(true);
      expect(result.data.returned).toBe(1);
      expect(result.data.totalScanned).toBe(1204);
      expect(result.data.results).toHaveLength(1);
      expect(result.data.results[0]).toMatchObject({
        id: 'wf-1',
        title: 'GPKE: Fristen beim Lieferantenwechsel',
        score: 32,
        category: 'edifact',
      });
      // includeContent defaults to false: raw content must not leak into the response.
      expect(result.data.results[0].content).toBeUndefined();

      expect(callWithNewSession).toHaveBeenCalledWith(
        'cernion_willi_federated_search',
        expect.objectContaining({
          query: 'Welche Fristen gelten für den Lieferantenwechsel nach GPKE?',
          limit: 3,
        }),
        undefined
      );
    });

    it('includes content when includeContent=true', async () => {
      callWithNewSession.mockResolvedValue({
        success: true,
        data: {
          results: [{ id: 'wf-2', title: 'Titel', content: 'Volltext sichtbar' }],
        },
      });

      const result = await broker.call('willi-federated.search', {
        query: 'Marktkommunikation Regulatorik',
        includeContent: true,
      });

      expect(result.data.results[0].content).toBe('Volltext sichtbar');
    });

    it('normalizes an MCP success response with a top-level results[] (backward compatibility)', async () => {
      callWithNewSession.mockResolvedValue({
        success: true,
        source: 'willi-federated-service',
        results: [{ id: 'wf-3', title: 'UTILMD/BNetzA Querbezug', score: 18 }],
      });

      const result = await broker.call('willi-federated.search', {
        query: 'UTILMD BNetzA Querbezug',
      });

      expect(result.success).toBe(true);
      expect(result.data.results).toHaveLength(1);
      expect(result.data.results[0]).toMatchObject({
        id: 'wf-3',
        title: 'UTILMD/BNetzA Querbezug',
      });
    });

    it('degrades to success:false without leaking secrets when the MCP token is missing', async () => {
      callWithNewSession.mockResolvedValue({
        success: false,
        error: { code: 'MISSING_TOKEN', message: 'CERNION_TOKEN environment variable not set.' },
      });

      const result = await broker.call('willi-federated.search', {
        query: 'MSCONS Bewegungsdaten',
      });

      expect(result.success).toBe(false);
      expect(result.error.code).toBe('MISSING_TOKEN');
      expect(JSON.stringify(result)).not.toMatch(/CERNION_TOKEN=|Bearer\s+\S+/);
    });

    it('degrades to success:false without leaking secrets when the MCP call throws', async () => {
      callWithNewSession.mockRejectedValue(new Error('upstream MCP connection reset'));

      const result = await broker.call('willi-federated.search', { query: 'APERAK' });

      expect(result.success).toBe(false);
      expect(result.error.code).toBe('MCP_ERROR');
      expect(result.error.message).toBe('upstream MCP connection reset');
      expect(JSON.stringify(result)).not.toMatch(/token|secret|password/i);
    });
  });

  describe('resolveStructure action', () => {
    it('should be defined with the expected REST endpoint', () => {
      const action = broker.getLocalService('willi-federated').schema.actions.resolveStructure;
      expect(action).toBeDefined();
      expect(action.rest).toBe('POST /resolve-structure');
    });

    it('returns conservative structural hints, validation candidates and no-call boundaries', async () => {
      callWithNewSession.mockResolvedValue({
        success: true,
        data: {
          results: [
            {
              id: 'wf-1',
              title: 'GPKE: Fristen beim Lieferantenwechsel',
              score: 32,
              category: 'edifact',
              tags: ['GPKE', 'Frist'],
              url: 'https://stromhaltig.de/wissen/gpke-lieferantenwechsel-fristen',
            },
            {
              id: 'wf-2',
              title: 'BNetzA Festlegung Übersicht',
              score: 20,
              category: 'regulatory',
              tags: ['BNetzA'],
              url: 'https://stromhaltig.de/wissen/bnetza-festlegung-uebersicht',
            },
          ],
        },
      });

      const result = await broker.call('willi-federated.resolveStructure', {
        query: 'Welche Fristen gelten für den Lieferantenwechsel nach GPKE?',
      });

      expect(result.success).toBe(true);
      expect(result.data.topic).toBe('Welche Fristen gelten für den Lieferantenwechsel nach GPKE?');
      expect(result.data.sources).toHaveLength(2);
      expect(result.data.structuralHints.length).toBeGreaterThan(0);
      expect(result.data.validationCandidates).toHaveLength(2);
      expect(result.data.validationCandidates[0]).toMatchObject({
        suggestedUse: 'structural_hint_only',
      });
      expect(result.data.noCallBoundaries).toEqual(
        expect.arrayContaining([
          expect.stringMatching(/not legally binding/i),
          expect.stringMatching(/MaKo message/i),
          expect.stringMatching(/regulatory process step/i),
        ])
      );
      expect(result.data.confidence).toBe('low');
    });

    it('reports confidence:none and no crash when no results are found', async () => {
      callWithNewSession.mockResolvedValue({ success: true, data: { results: [] } });

      const result = await broker.call('willi-federated.resolveStructure', {
        query: 'unbekanntes Thema',
      });

      expect(result.success).toBe(true);
      expect(result.data.sources).toHaveLength(0);
      expect(result.data.confidence).toBe('none');
      expect(result.data.noCallBoundaries.length).toBeGreaterThan(0);
    });

    it('propagates a degraded search result instead of throwing', async () => {
      callWithNewSession.mockResolvedValue({
        success: false,
        error: { code: 'MISSING_TOKEN', message: 'CERNION_TOKEN environment variable not set.' },
      });

      const result = await broker.call('willi-federated.resolveStructure', {
        query: 'GPKE',
      });

      expect(result.success).toBe(false);
      expect(result.error.code).toBe('MISSING_TOKEN');
    });
  });
});
