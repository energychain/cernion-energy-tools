'use strict';

const PersonalAgentService = require('../services/personal-agent.service');

function buildServiceHarness() {
  return {
    ...PersonalAgentService.methods,
  };
}

describe('askCernionAgent evidence bundle', () => {
  test('compiles Sidecar Blueprint plan from structured inputs while preserving context metadata', async () => {
    const service = buildServiceHarness();
    const handler = PersonalAgentService.actions.askCernionAgent.handler;
    const ctx = {
      params: {
        question: 'Liste alle Solaranlagen in 69168 zwischen 10 und 13 kW aus 2025',
        context: { tenantId: 'public' },
        inputs: {
          assetType: 'solar',
          location: '69168',
          minCapacity: 10,
          maxCapacity: 13,
          commissioningYear: 2025,
          limit: 100,
        },
      },
      broker: {
        registry: {
          getServiceList: () => [
            {
              name: 'assets',
              actions: {
                'assets.solar': { rest: 'GET /solar' },
              },
            },
          ],
        },
      },
      call: jest.fn(async () => {
        throw new Error('Blueprint plan path should not call the evidence fallback');
      }),
    };

    const result = await handler.call(service, ctx);

    expect(result.resolved).toEqual({
      kind: 'blueprint',
      id: 'mastr-asset-service-selection-v1',
      version: '1.0.0',
      source: 'blueprint_runtime',
    });
    expect(result.canonicalInputs).toEqual({
      assetType: 'solar',
      location: '69168',
      minCapacity: 10,
      maxCapacity: 13,
      commissioningYear: 2025,
      limit: 100,
    });
    expect(result.execution).toEqual({
      mode: 'read_only_rest_plan',
      method: 'GET',
      path: '/api/assets/solar',
      query: {
        location: '69168',
        minCapacityKW: 10,
        maxCapacityKW: 13,
        commissioningYear: 2025,
        limit: 100,
      },
    });
    expect(ctx.call).not.toHaveBeenCalled();
  });

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

  test('adds lightweight analysis planner evidence for location and load questions', async () => {
    const service = buildServiceHarness();
    const handler = PersonalAgentService.actions.askCernionAgent.handler;
    const calls = [];
    const ctx = {
      meta: { tenantId: 'tenant-a' },
      params: {
        question: 'Kann in 69256 ein Rechenzentrum mit 10 MW gebaut werden?',
        domain: 'auto',
        maxEvidence: 8,
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
                  id: 'dc-1',
                  source: 'Cernion Knowledge',
                  score: 0.88,
                  referenceText_L0:
                    'Für Rechenzentren sind Netzanschlussleistung, Netzkapazität, Lastprofil, VNB-Zuständigkeit und planerische Genehmigungsfragen getrennt zu prüfen.',
                  vectorText: 'Rechenzentrum 10 MW Netzanschluss VNB Netzkapazität Planung',
                  metadata: { docType: 'Cernion-Fachkontext' },
                },
                {
                  id: 'stromdao-leak',
                  source: 'knowledge-rag',
                  score: 0.91,
                  referenceText_L0:
                    'Anonymisierte Pattern-Card fuer N-1-Kapazitaetslogik, Headroom und Reserve.',
                  vectorText:
                    'N-1, 81 MVA, Kopplungspunkt, vorgelagertes Netz, STROMDAO Netze, Headroom',
                  metadata: { docType: 'Pattern-Card' },
                },
                {
                  id: 'irrelevant-regulatory',
                  source: 'BNetzA',
                  score: 0.53,
                  referenceText_L0:
                    'Laut NEP Szenariorahmen soll im deutschen Stromsystem bis 2045 eine volatile erneuerbare Erzeugungskapazität installiert sein.',
                  vectorText:
                    'Regel: Wenn Elektrolyseure nicht per se netzdienlich sind, dann sollte eine pauschale Befreiung differenziert werden.',
                  metadata: { docType: 'Festlegung' },
                },
              ],
            },
          };
        }

        if (action === 'grid-operations.vnbdigitalSearch') {
          return {
            results: [
              {
                title: '69256 Mauer, Baden',
                subtitle: 'Mauer, Baden, Baden-Württemberg',
                type: 'VNB',
                profileUrl: 'https://www.vnbdigital.de/example',
              },
            ],
          };
        }

        if (action === 'energy-market.installations') {
          return {
            data: {
              total: 2,
              installations: [
                {
                  name: 'PV Mauer Beispiel',
                  gemeinde: 'Mauer',
                  capacityKW: 750,
                  gridOperatorName: 'Netze BW GmbH',
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

    expect(knowledgeCall.params.query).toContain('Rechenzentrum Netzanschluss');
    expect(knowledgeCall.params.query).toContain('10 MW');
    expect(calls.some((entry) => entry.action === 'grid-operations.vnbdigitalSearch')).toBe(true);
    expect(calls.some((entry) => entry.action === 'energy-market.installations')).toBe(true);
    expect(result.groundingAnswer).toContain('Cernion Analysis Planner');
    expect(result.groundingAnswer).toContain('PLZ: 69256');
    expect(result.groundingAnswer).toContain('Leistung: 10 MW');
    expect(result.groundingAnswer).toContain('Standortauflösung: 69256 Mauer');
    expect(result.groundingAnswer).toContain('Standortaufloesungen aus der Evidence');
    expect(result.groundingAnswer).toContain('VNBdigital-Suche zur PLZ 69256');
    expect(result.groundingAnswer).toContain('keine Netzkapazitätsprüfung');
    expect(result.groundingAnswer).toContain('MaStR-Schnellcheck PLZ 69256');
    expect(result.groundingAnswer).not.toContain('81 MVA');
    expect(result.groundingAnswer).not.toContain('STROMDAO Netze');
    expect(result.groundingAnswer).not.toContain('Kopplungspunkt');
    expect(result.groundingAnswer).not.toContain('Elektrolyseure');
    expect(result.groundingAnswer).not.toContain('NEP Szenariorahmen');
    expect(result.evidenceBySource.planning.status).toBe('available');
  });

  test('keeps planner tool timeouts out of evidence while lowering answer certainty', () => {
    const service = buildServiceHarness();

    const result = service.buildCopilotSearchAnswer({
      question: 'Kann in 69256 ein Rechenzentrum mit 10 MW gebaut werden?',
      searchTerm:
        'Rechenzentrum Netzanschluss Anschlussleistung Netzkapazität VNB Genehmigung Planung 10 MW PLZ 69256',
      searchResult: { domain: 'all', totalResults: 0, results: [] },
      knowledgeEvidence: { status: 'missing', hits: [] },
      datapointEvidence: { status: 'missing', hits: [] },
      objectEvidence: { status: 'missing', hits: [] },
      planningEvidence: {
        status: 'available',
        hits: [
          {
            source: 'analysis-planner',
            value:
              'Cernion Analysis Planner: PLZ: 69256 · Asset-Klasse: data_center · Leistung: 10 MW',
            metadata: { kind: 'signals' },
          },
        ],
        trace: {
          toolCalls: [
            { kind: 'vnbdigital', status: 'unavailable' },
            { kind: 'mastr_installations', status: 'unavailable' },
          ],
        },
      },
      maxEvidence: 5,
    });

    expect(result.confidence).toBe('low');
    expect(result.shortAnswer).toContain('keine belastbare Kurzantwort');
    expect(result.risks).toContain(
      'Planner-Schnellcheck unvollständig: vnbdigital, mastr_installations nicht verfügbar.'
    );
    expect(result.risks).toContain(
      'Für diese Standort-/Leistungsfrage liegt keine belastbare Standort-, VNB- oder Netzkapazitäts-Evidence vor.'
    );
    expect(result.risks).toContain(
      'Nur Planner-Signal vorhanden; das ist ein Prüfplan, keine Machbarkeits- oder Kapazitätsevidenz.'
    );
    expect(result.openQuestions).toContain(
      'Liegt eine Rückmeldung, Zuständigkeitsklärung oder Kapazitätsprüfung des zuständigen VNB vor?'
    );
    expect(result.recommendedNextSteps).toContain(
      'Copilot soll klar sagen, dass aus dem Cernion-Kontext keine belastbare Machbarkeits- oder Kapazitätsaussage ableitbar ist, und nur die fehlenden Prüfpunkte nennen.'
    );
    expect(result.groundingAnswer).toContain('Planner-Schnellcheck unvollständig');
    expect(result.groundingAnswer).toContain('keine belastbare Machbarkeits- oder Kapazitätsaussage');
    expect(result.groundingAnswer).not.toContain('Request is timed out');
    expect(result.groundingAnswer).not.toContain('nicht verfügbar: Request');
  });

  test('filters weak unrelated regulatory hits for concrete data-center location checks', async () => {
    const service = buildServiceHarness();
    const handler = PersonalAgentService.actions.askCernionAgent.handler;
    const ctx = {
      meta: { tenantId: 'tenant-a' },
      params: {
        question: 'Kann in 69256 ein Rechenzentrum mit 10 MW gebaut werden?',
        domain: 'auto',
        maxEvidence: 6,
        context: {},
      },
      call: jest.fn(async (action, params) => {
        if (action === 'query.search') {
          return { query: params.q, domain: params.domain, totalResults: 0, results: [] };
        }

        if (action === 'knowledge-rag.query') {
          return {
            success: true,
            data: {
              results: [
                {
                  id: 'bnetza-ofgem',
                  source: 'BNetzA',
                  score: 0.527,
                  referenceText_L0:
                    'Ofgem RIIO-2 Final Determinations Finance Annex. Wir quantifizieren Vorfinanzierungskosten basierend auf 10 bp.',
                  vectorText:
                    'Regel: Wenn Regulatorische Evidenz verfügt, dann Vorfinanzierungskosten von 10 bp.',
                  metadata: { docType: 'Festlegung' },
                },
                {
                  id: 'bnetza-utilmd',
                  source: 'BNetzA',
                  score: 0.518,
                  referenceText_L0:
                    'UTILMD Anwendungshandbuch Strom Seite 470 von 1397 EDIFACT Struktur Beschreibung Änderung Rückmeldung.',
                  vectorText:
                    'Fachbegriffe: SG10, CCI 00249, CCI 7059, ZW5, ZW6.',
                  metadata: { docType: 'Festlegung' },
                },
                {
                  id: 'storage-process',
                  source: 'knowledge-rag',
                  score: 0.512,
                  referenceText_L0:
                    'Branchenwissen zu Grossspeichern, flexiblen Netzanschluessen und Mustervertraegen muss in ein Anschluss- und Fahrplan-Gate uebersetzt werden.',
                  vectorText:
                    'Suche nach Speicheranschluss, BESS, flexible Netzanschlussvereinbarung, Fahrplanmanagement',
                  metadata: { docType: 'Pattern-Card' },
                },
              ],
            },
          };
        }

        if (action === 'grid-operations.vnbdigitalSearch') {
          throw new Error('Request is timed out');
        }

        if (action === 'energy-market.installations') {
          throw new Error('Request is timed out');
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

    expect(result.confidence).toBe('low');
    expect(result.evidenceBySource.knowledge.status).toBe('missing');
    expect(result.groundingAnswer).toContain('Cernion Analysis Planner');
    expect(result.groundingAnswer).toContain('keine belastbare Machbarkeits- oder Kapazitätsaussage');
    expect(result.groundingAnswer).toContain(
      'Für diese Standort-/Leistungsfrage liegt keine belastbare Standort-, VNB- oder Netzkapazitäts-Evidence vor.'
    );
    expect(result.groundingAnswer).not.toContain('Ofgem');
    expect(result.groundingAnswer).not.toContain('UTILMD');
    expect(result.groundingAnswer).not.toContain('Grossspeichern');
    expect(result.groundingAnswer).not.toContain('Vorfinanzierungskosten');
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

  // issue #271 follow-up: the OpenClaw Sidecar sends canonical structured
  // values in `inputs`, separate from `context` (tenant/session metadata).
  // askCernionAgent must merge both for Blueprint REST-plan compilation.
  test('compiles a read-only Blueprint plan from inputs merged with context', async () => {
    const service = buildServiceHarness();
    const handler = PersonalAgentService.actions.askCernionAgent.handler;
    const fakeBroker = {
      registry: {
        getServiceList: () => [
          { name: 'assets', actions: { 'assets.solar': { rest: 'GET /solar' } } },
        ],
      },
    };
    const ctx = {
      meta: { tenantId: 'public' },
      broker: fakeBroker,
      params: {
        question: 'Liste alle Solaranlagen in 69168 zwischen 10 und 13 kW aus 2025',
        context: { tenantId: 'public' },
        inputs: {
          assetType: 'solar',
          location: '69168',
          minCapacity: 10,
          maxCapacity: 13,
          commissioningYear: 2025,
          limit: 100,
        },
      },
      call: jest.fn(async (action) => {
        throw new Error(`unexpected action ${action} — evidence planner must not run when a Blueprint plan compiles`);
      }),
    };

    const result = await handler.call(service, ctx);

    expect(result.resolved).toEqual({
      kind: 'blueprint',
      id: 'mastr-asset-service-selection-v1',
      version: '1.0.0',
      source: 'blueprint_runtime',
    });
    expect(result.execution).toEqual({
      mode: 'read_only_rest_plan',
      method: 'GET',
      path: '/api/assets/solar',
      query: {
        location: '69168',
        minCapacityKW: 10,
        maxCapacityKW: 13,
        commissioningYear: 2025,
        limit: 100,
      },
    });
    expect(ctx.call).not.toHaveBeenCalled();
  });
});
