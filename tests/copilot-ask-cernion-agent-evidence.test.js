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
                  referenceText_L0:
                    'Netzanschlussanfragen in Wiesloch muessen anhand dokumentierter Betreiber- und Prozess-Evidenz beantwortet werden.',
                  referenceText: 'DO_NOT_LEAK_REFERENCE',
                  vectorText: 'Netzanschluss Wiesloch Betreiber Prozess Evidence',
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
    expect(result.shortAnswer).toContain('Netzanschluss-Validierung Wiesloch');
    expect(result.shortAnswer).not.toMatch(/Evidenztreffer .* gefunden/);
    expect(result.groundingAnswer).toContain('GROUNDING ANSWER FUER COPILOT');
    expect(result.groundingAnswer).toContain(
      'Welche Guardrails gelten fuer Netzanschluss Wiesloch?'
    );
    expect(result.groundingAnswer).toContain('KERNANTWORT AUS CERNION');
    expect(result.groundingAnswer).toContain('EVIDENZ');
    expect(result.groundingAnswer).toContain('Copilot Guardrail Wiesloch');
    expect(result.groundingAnswer).toContain(
      'Netzanschlussanfragen in Wiesloch muessen anhand dokumentierter Betreiber- und Prozess-Evidenz beantwortet werden.'
    );
    expect(result.groundingAnswer).toContain('RETRIEVAL-HINWEISE');
    expect(result.groundingAnswer).toContain(
      'Netzanschluss Wiesloch Betreiber Prozess Evidence'
    );
    expect(result.groundingAnswer).toContain('Evidence-Snippets als fachliche Grundlage');
    expect(result.groundingAnswer).toContain('Nicht aus Modellwissen auffuellen');
    expect(result.evidenceBySource.entities.status).toBe('available');
    expect(result.evidenceBySource.knowledge.status).toBe('available');
    expect(result.evidenceBySource.datapoints.status).toBe('available');
    expect(result.evidenceBySource.objects.status).toBe('available');
    expect(result.guardrails.join(' ')).toContain('Knowledge-RAG');
    expect(JSON.stringify(result)).toContain('netzanschluss-wiesloch-kpi');
    expect(JSON.stringify(result)).toContain('guardrail-wiesloch');
    expect(JSON.stringify(result)).not.toContain('DO_NOT_LEAK_REFERENCE');
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
    expect(result.shortAnswer).toContain('keine eindeutigen Evidenztreffer');
    expect(result.risks).toContain(
      'Knowledge-RAG nicht verfügbar: zentrale Guardrails konnten nicht geladen werden.'
    );
  });

  test('does not synthesize a confident shortAnswer from weak unrelated evidence hits', () => {
    const service = buildServiceHarness();

    const result = service.buildCopilotSearchAnswer({
      question: 'Wie ist Energy Sharing geregelt',
      searchTerm: 'Wie ist Energy Sharing geregelt',
      searchResult: { domain: 'all', totalResults: 0, results: [] },
      knowledgeEvidence: {
        source: 'knowledge-rag',
        status: 'available',
        hits: [
          {
            source: 'knowledge-rag',
            value: 'Knowledge hit · Score: 0.626',
          },
          {
            source: 'Gesetzgeber',
            value: 'MsbG § 1 · Dokumenttyp: Gesetz · Score: 0.596',
          },
          {
            source: 'BNetzA',
            value:
              'https://www.bundesnetzagentur.de/example.pdf · Dokumenttyp: Festlegung · Score: 0.590',
          },
          {
            source: 'BDEW',
            value:
              'PDF Gutachten: Berücksichtigung von Intraday-Optionalitäten im Rahmen der Redispatch-Vergütung · Dokumenttyp: Redispatch-Leitfaden · Score: 0.582',
          },
        ],
      },
      datapointEvidence: { status: 'missing', hits: [] },
      objectEvidence: { status: 'missing', hits: [] },
      maxEvidence: 5,
    });

    expect(result.success).toBe(true);
    expect(result.confidence).toBe('low');
    expect(result.evidence).toHaveLength(4);
    expect(result.shortAnswer).toContain('Treffer gefunden');
    expect(result.shortAnswer).toContain('keine belastbare Kurzantwort');
    expect(result.groundingAnswer).toContain('Wie ist Energy Sharing geregelt');
    expect(result.groundingAnswer).toContain(
      'Treffer vorhanden; sie sollten als indirekter Kontext genutzt'
    );
    expect(result.groundingAnswer).toContain(
      'verwertbare Snippet-Inhalte trotzdem zusammenfassen'
    );
    expect(result.groundingAnswer).toContain(
      'Welche konkrete Fundstelle, Rechtsquelle, Domäne oder Prozesssicht soll bei Bedarf vertieft werden?'
    );
    expect(result.risks).toContain(
      'Treffer vorhanden; sie sollten als indirekter Kontext genutzt und mit Unsicherheit eingeordnet werden.'
    );
    expect(result.openQuestions).toContain(
      'Welche konkrete Fundstelle, Rechtsquelle, Domäne oder Prozesssicht soll bei Bedarf vertieft werden?'
    );
    expect(result.shortAnswer).not.toContain('MsbG § 1');
    expect(result.shortAnswer).not.toContain('Redispatch');
    expect(result.shortAnswer).not.toContain('bundesnetzagentur.de/example.pdf');
  });

  test('expands neighbor electricity sharing questions to Energy Sharing search context', async () => {
    const service = buildServiceHarness();
    const handler = PersonalAgentService.actions.askCernionAgent.handler;
    const calls = [];
    const ctx = {
      meta: { tenantId: 'tenant-a' },
      params: {
        question: 'Was muss ich machen, um mit meinem Nachbarn Strom zu teilen?',
        domain: 'auto',
        maxEvidence: 3,
        context: {},
      },
      call: jest.fn(async (action, params) => {
        calls.push({ action, params });
        if (action === 'query.search') {
          return { query: params.q, domain: params.domain, totalResults: 0, results: [] };
        }

        if (action === 'knowledge-rag.query') {
          return {
            success: true,
            data: {
              results: [
                {
                  id: 'es-1',
                  source: 'Cernion Knowledge',
                  score: 0.91,
                  referenceText_L0:
                    'Energy Sharing ist fachlich von Mieterstrom und gemeinschaftlicher Gebäudeversorgung zu unterscheiden; für die Prüfung sind Marktrollen, Messung, Abrechnung und Netzgebiet einzuordnen.',
                  vectorText:
                    'Energy Sharing §42c EnWG Mieterstrom gemeinschaftliche Gebäudeversorgung Stromlieferung Nachbar',
                  metadata: {
                    docType: 'Cernion-Fachkontext',
                  },
                },
              ],
            },
          };
        }

        if (action === 'datapoint.list') {
          return { datapoints: [] };
        }

        if (action === 'object-store.query') {
          return { docs: [] };
        }

        throw new Error(`unexpected action ${action}`);
      }),
    };

    const result = await handler.call(service, ctx);
    const knowledgeCall = calls.find((entry) => entry.action === 'knowledge-rag.query');

    expect(knowledgeCall.params.query).toContain('Energy Sharing §42c EnWG');
    expect(knowledgeCall.params.query).toContain('Stromlieferung an Dritte');
    expect(result.groundingAnswer).toContain(
      'Energy Sharing ist fachlich von Mieterstrom und gemeinschaftlicher Gebäudeversorgung zu unterscheiden'
    );
    expect(result.groundingAnswer).toContain('RETRIEVAL-HINWEISE');
    expect(result.shortAnswer).not.toContain('keine belastbare Kurzantwort');
  });

  test('uses evidence-bearing object-store namespaces by default', async () => {
    const service = buildServiceHarness();
    const handler = PersonalAgentService.actions.askCernionAgent.handler;
    const queriedNamespaces = [];
    const ctx = {
      meta: { tenantId: 'tenant-a' },
      params: {
        question: 'Welche regulatorische Evidenz gibt es zum Netzanschluss?',
        domain: 'auto',
        maxEvidence: 4,
        context: {},
      },
      call: jest.fn(async (action, params) => {
        if (action === 'query.search') {
          return { query: params.q, domain: 'all', totalResults: 0, results: [] };
        }

        if (action === 'knowledge-rag.query') {
          return { success: true, data: { results: [] } };
        }

        if (action === 'datapoint.list') {
          return { datapoints: [] };
        }

        if (action === 'object-store.query') {
          queriedNamespaces.push(params.namespace);
          if (params.namespace !== 'cya_sessions') {
            return { docs: [] };
          }
          return {
            docs: [
              {
                namespace: params.namespace,
                key: 'cya-session-regulatory',
                payload: {
                  status: 'completed',
                  regulatory_graph: {
                    topic: 'Netzanschluss regulatorische Evidenz',
                  },
                },
                updatedAt: '2026-06-12T00:00:00.000Z',
              },
            ],
          };
        }

        throw new Error(`unexpected action ${action}`);
      }),
    };

    const result = await handler.call(service, ctx);

    expect(queriedNamespaces).toEqual(
      expect.arrayContaining(['cya_sessions', 'cya_profiles', 'finance_agent_memory'])
    );
    expect(result.evidenceBySource.objects.status).toBe('available');
    expect(result.evidenceBySource.objects.trace.namespaces).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          namespace: 'cya_sessions',
          scannedCount: 1,
          hitCount: 1,
        }),
      ])
    );
    expect(JSON.stringify(result.evidenceBySource.objects.hits)).toContain(
      'cya-session-regulatory'
    );
  });
});
