'use strict';

const PersonalAgentService = require('../services/personal-agent.service');

function buildServiceHarness() {
  return {
    ...PersonalAgentService.methods,
  };
}

describe('askCernionAgent evidence bundle', () => {
  test('collects entity, knowledge, datapoint and object-store evidence for Copilot', async () => {
    const service = buildServiceHarness();
    const handler = PersonalAgentService.actions.askCernionAgent.handler;
    const ctx = {
      meta: { tenantId: 'tenant-a' },
      params: {
        question: 'Welche Guardrails gelten fuer Netzanschluss Wiesloch?',
        domain: 'grid-connection',
        maxEvidence: 4,
        context: {
          objectNamespaces: ['copilot_context'],
        },
      },
      call: jest.fn(async (action, params) => {
        if (action === 'query.search') {
          return {
            query: params.q,
            domain: params.domain,
            totalResults: 1,
            results: [
              {
                title: 'Netzanschluss-Validierung Wiesloch',
                excerpt: 'Entscheidung: GO_CONDITIONAL',
                domain: 'grid_connection',
                type: 'validation',
                status: 'GO_CONDITIONAL',
              },
            ],
          };
        }

        if (action === 'knowledge-rag.query') {
          return {
            success: true,
            data: {
              results: [
                {
                  id: 'rag-1',
                  score: 0.93,
                  referenceText: 'DO_NOT_LEAK_REFERENCE',
                  vectorText: 'DO_NOT_LEAK_VECTOR',
                  metadata: {
                    title: 'BNetzA Netzanschluss Guardrail',
                    docType: 'Festlegung',
                    authority: 'BNetzA',
                    publishedAt: '2026-01-01T00:00:00.000Z',
                  },
                },
              ],
            },
          };
        }

        if (action === 'datapoint.list') {
          return {
            datapoints: [
              {
                name: 'netzanschluss-wiesloch-kpi',
                description: 'Bekannter Datenpunkt fuer Netzanschluss Wiesloch',
                tags: ['netzanschluss', 'wiesloch'],
                sourceType: 'agent-session',
                health: { status: 'fresh' },
                createdAt: '2026-06-01T00:00:00.000Z',
              },
            ],
          };
        }

        if (action === 'object-store.query') {
          return {
            docs: [
              {
                namespace: params.namespace,
                key: 'guardrail-wiesloch',
                payload: {
                  title: 'Copilot Guardrail Wiesloch',
                  status: 'active',
                  note: 'Wiesloch Netzanschluss nur mit Evidence beantworten',
                },
                updatedAt: '2026-06-10T00:00:00.000Z',
              },
            ],
          };
        }

        throw new Error(`unexpected action ${action}`);
      }),
    };

    const result = await handler.call(service, ctx);

    expect(result.success).toBe(true);
    expect(result.evidenceBySource.entities.status).toBe('available');
    expect(result.evidenceBySource.knowledge.status).toBe('available');
    expect(result.evidenceBySource.datapoints.status).toBe('available');
    expect(result.evidenceBySource.objects.status).toBe('available');
    expect(result.guardrails.join(' ')).toContain('Knowledge-RAG');
    expect(JSON.stringify(result)).toContain('netzanschluss-wiesloch-kpi');
    expect(JSON.stringify(result)).toContain('guardrail-wiesloch');
    expect(JSON.stringify(result)).not.toContain('DO_NOT_LEAK_REFERENCE');
    expect(JSON.stringify(result)).not.toContain('DO_NOT_LEAK_VECTOR');
  });

  test('degrades gracefully when supplemental evidence services are unavailable', async () => {
    const service = buildServiceHarness();
    const handler = PersonalAgentService.actions.askCernionAgent.handler;
    const ctx = {
      meta: {},
      params: {
        question: 'Welche Evidenz gibt es?',
        domain: 'auto',
        maxEvidence: 2,
        context: {},
      },
      call: jest.fn(async (action) => {
        if (action === 'query.search') {
          return { query: 'Evidenz', domain: 'all', totalResults: 0, results: [] };
        }
        const err = new Error('Service not found');
        err.type = 'SERVICE_NOT_FOUND';
        throw err;
      }),
    };

    const result = await handler.call(service, ctx);

    expect(result.success).toBe(true);
    expect(result.evidenceBySource.knowledge.status).toBe('unavailable');
    expect(result.evidenceBySource.datapoints.status).toBe('unavailable');
    expect(result.evidenceBySource.objects.status).toBe('unavailable');
    expect(result.risks).toContain(
      'Knowledge-RAG nicht verfügbar: zentrale Guardrails konnten nicht geladen werden.'
    );
  });
});
