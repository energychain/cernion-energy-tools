'use strict';

// Focused unit tests for energychain/cernion-energy-tools#498: routing generic
// MaKo/EDIFACT code-context questions through personal-agent.askCernionAgent's
// read-only Willi-Mako evidence enrichment (ctx.call('willi-mako.resolveStructure', ...)).
// All willi-mako calls are mocked — no live MCP/Qdrant calls.

const PersonalAgentService = require('../services/personal-agent.service');

function buildServiceHarness() {
  return {
    ...PersonalAgentService.methods,
  };
}

function buildBaseCtxCallMock({ williMakoResponse, williMakoSpy, williMakoImpl } = {}) {
  return jest.fn(async (action, params) => {
    if (action === 'query.search') {
      return { query: params.q, domain: params.domain, totalResults: 0, results: [] };
    }
    if (action === 'knowledge-rag.query') {
      return { success: true, data: { results: [] } };
    }
    if (action === 'datapoint.list') {
      return { datapoints: [] };
    }
    if (action === 'object-store.query') {
      return { docs: [] };
    }
    if (action === 'willi-mako.resolveStructure') {
      if (williMakoImpl) return williMakoImpl(params);
      williMakoSpy?.(params);
      if (williMakoResponse) return williMakoResponse;
      return {
        success: true,
        data: {
          topic: params.query,
          sources: [
            {
              id: 'wm-1',
              title: 'APERAK-Fehlercodes in der Marktkommunikation',
              url: 'https://stromhaltig.de/wissen/aperak-fehlercodes',
              score: 30,
            },
          ],
          structuralHints: [{ category: 'edifact', tags: ['APERAK'], hint: 'context hint' }],
          validationCandidates: [],
          noCallBoundaries: [
            'This response is not legally binding and is not an instruction to send a MaKo message.',
          ],
          confidence: 'low',
        },
      };
    }
    throw new Error(`unexpected action ${action}`);
  });
}

describe('askCernionAgent Willi-Mako MaKo/EDIFACT evidence (#498)', () => {
  const handler = PersonalAgentService.actions.askCernionAgent.handler;

  test.each([
    'was bedeutet eine Z17 in einer APERAK?',
    'APERAK Fehlercode Z18 erklären',
    'Welche UTILMD-Segmentstruktur ist für Lieferantenwechsel relevant?',
    'Was bedeutet ein MSCONS Prüfhinweis im MaKo-Kontext?',
  ])(
    'calls willi-mako.resolveStructure (read-only) for generic MaKo question: %s',
    async (question) => {
      const service = buildServiceHarness();
      const williMakoSpy = jest.fn();
      const ctx = {
        meta: { tenantId: 'tenant-a' },
        params: { question, domain: 'auto', maxEvidence: 5, context: {} },
        call: buildBaseCtxCallMock({ williMakoSpy }),
      };

      const result = await handler.call(service, ctx);

      expect(williMakoSpy).toHaveBeenCalledTimes(1);
      expect(williMakoSpy.mock.calls[0][0]).toMatchObject({ query: question });
      expect(williMakoSpy.mock.calls[0][0].limit).toBeLessThanOrEqual(5);

      expect(result.evidenceBySource.makoKnowledge.status).toBe('available');
      expect(result.evidenceBySource.makoKnowledge.hits.length).toBeGreaterThan(0);
      expect(result.evidenceBySource.makoKnowledge.hits[0].source).toBe('willi-mako');
      expect(result.processContext).toContain('makoKnowledge:available');

      // Read-only / advisory: no consequential MaKo action is ever surfaced.
      expect(result.forbiddenActions).toEqual(
        expect.arrayContaining(['execute', 'confirm', 'delete', 'override', 'sign', 'nominate'])
      );

      // Confidence is never overstated purely because Willi-Mako context exists —
      // this evidence source stays outside the confidence ladder (never 'high').
      expect(['low', 'medium']).toContain(result.confidence);
    }
  );

  test('does not call willi-mako.resolveStructure for a non-MaKo question (no unnecessary calls)', async () => {
    const service = buildServiceHarness();
    const williMakoSpy = jest.fn();
    const ctx = {
      meta: { tenantId: 'tenant-a' },
      params: {
        question: 'Welcher VNB ist in Wiesloch zuständig?',
        domain: 'auto',
        maxEvidence: 5,
        context: {},
      },
      call: buildBaseCtxCallMock({ williMakoSpy }),
    };

    const result = await handler.call(service, ctx);

    expect(williMakoSpy).not.toHaveBeenCalled();
    expect(result.evidenceBySource.makoKnowledge.status).toBe('skipped');
    expect(result.processContext).not.toContain(expect.stringMatching(/^makoKnowledge:/));
  });

  test('degrades gracefully to unavailable when willi-mako.resolveStructure fails, without failing the whole answer', async () => {
    const service = buildServiceHarness();
    const ctx = {
      meta: { tenantId: 'tenant-a' },
      params: {
        question: 'APERAK Fehlercode Z18 erklären',
        domain: 'auto',
        maxEvidence: 5,
        context: {},
      },
      call: buildBaseCtxCallMock({
        williMakoImpl: () => {
          throw new Error('MCP timeout');
        },
      }),
    };

    const result = await handler.call(service, ctx);

    expect(result.success).toBe(true);
    expect(result.evidenceBySource.makoKnowledge.status).toBe('unavailable');
    expect(result.evidenceBySource.makoKnowledge.hits).toEqual([]);
  });

  test('never sends, validates, or dispatches an EDIFACT message — only read-only structural context', async () => {
    const service = buildServiceHarness();
    const williMakoSpy = jest.fn();
    const ctx = {
      meta: { tenantId: 'tenant-a' },
      params: {
        question: 'APERAK Fehlercode Z18 erklären',
        domain: 'auto',
        maxEvidence: 5,
        context: {},
      },
      call: buildBaseCtxCallMock({ williMakoSpy }),
    };

    await handler.call(service, ctx);

    expect(ctx.call).not.toHaveBeenCalledWith(
      expect.stringMatching(/willi-mako\.(?!search|resolveStructure)/),
      expect.anything(),
      expect.anything()
    );
    const calledActions = ctx.call.mock.calls.map(([action]) => action);
    expect(calledActions).not.toContain('willi-mako.dispatch');
    expect(calledActions).not.toContain('willi-mako.send');
  });
});
