'use strict';

const path = require('path');
const os = require('os');
const { ServiceBroker } = require('moleculer');

process.env.FINANCE_AGENT_DB_PATH = path.join(os.tmpdir(), `cernion-fa-test-${Date.now()}`);

// ---------------------------------------------------------------------------
// LLM client mock — deterministic responses for all three LLM-powered methods
// ---------------------------------------------------------------------------
jest.mock('../src/llm-client', () => {
  const SchemaType = {
    STRING: 'STRING',
    NUMBER: 'NUMBER',
    INTEGER: 'INTEGER',
    BOOLEAN: 'BOOLEAN',
    ARRAY: 'ARRAY',
    OBJECT: 'OBJECT',
  };

  const generateStructured = jest.fn().mockImplementation((_schema, prompt) => {
    const p = String(prompt || '');

    // --- Query Planner ---
    if (p.includes('Finance Query Planner')) {
      const isCapex = /CAPEX|capex|Investition/i.test(p);
      const isOpex = /OPEX|opex|Betriebskosten/i.test(p);
      const additionalIntents = [];
      const financeTags = [];
      if (isCapex) {
        financeTags.push('ceo:CapitalExpenditure');
        additionalIntents.push({
          name: 'capex-rules',
          query: 'Regulatorische CAPEX-Regeln im Verteilnetz und Bezug zu TOTEX',
          oeoAnchors: ['ceo:CapitalExpenditure'],
          legalAnchors: [],
        });
      }
      if (isOpex) {
        financeTags.push('ceo:OperatingExpenditure');
        additionalIntents.push({
          name: 'opex-rules',
          query: 'Regulatorische OPEX-Regeln im Verteilnetz und Bezug zu TOTEX',
          oeoAnchors: ['ceo:OperatingExpenditure'],
          legalAnchors: [],
        });
      }
      return Promise.resolve({ financeTags, additionalIntents });
    }

    // --- Evidence Arbiter ---
    if (p.includes('Evidence Arbiter')) {
      return Promise.resolve({ conflicts: [] });
    }

    // --- Synthesis ---
    if (p.includes('Regulatory Finance Synthesizer')) {
      const l1CountMatch = p.match(/L1_Rule evidence count: (\d+)/);
      const l1Count = l1CountMatch ? parseInt(l1CountMatch[1], 10) : 0;
      const selectedCountMatch = p.match(/Selected evidence count: (\d+)/);
      const selectedCount = selectedCountMatch ? parseInt(selectedCountMatch[1], 10) : 0;
      const hasLegal = !/Legal references: none/.test(p);
      const allowHypo = p.includes('allowHypotheticals: true');

      if (l1Count < 2 || selectedCount < 3 || !hasLegal) {
        if (allowHypo) {
          return Promise.resolve({
            status: 'hypothetical_scenario',
            summary:
              'Hypothetisches Szenario: Keine hinreichende L1-Regelbasis; Ergebnis basiert auf L2-/Historik-Evidenz.',
            answer:
              'Hypothetische Einordnung ohne hinreichende L1-Regelbasis. Nicht als verbindliche Rechtsauskunft zu interpretieren.',
            claims: [],
            assumptions: [
              'Unter der Annahme regulatorischer Kostenbeziehungen (CAPEX/OPEX/TOTEX) auf L2/Historik-Basis.',
            ],
          });
        }
        return Promise.resolve({
          status: 'needs_clarification',
          summary:
            'Evidenzlage f\u00fcr eine regulatorisch belastbare Antwort ist unzureichend. Bitte pr\u00e4zisieren.',
          answer:
            'F\u00fcr eine belastbare Einordnung fehlen hinreichende L1-Regeln oder explizite Rechtsreferenzen.',
          claims: [],
          assumptions: [],
        });
      }

      return Promise.resolve({
        status: 'ok',
        summary:
          'Belastbare Einordnung auf Basis von L1-Regeln + L2-Kontext: CAPEX/OPEX/TOTEX-Abh\u00e4ngigkeiten sind dargestellt.',
        answer:
          'LLM-Antwort: CAPEX und OPEX sind regulatorisch als TOTEX zusammengefasst. Rechtsanker: \u00a721a EnWG.',
        claims: [
          {
            id: 'C-1',
            statement: 'CAPEX flie\u00dft in TOTEX ein.',
            evidencePointId: 'fa-doc-1',
            level: 'L1_Rule',
          },
        ],
        assumptions: [],
      });
    }

    return Promise.resolve({});
  });

  return { SchemaType, generateText: jest.fn().mockResolvedValue('mock text'), generateStructured };
});

describe('finance-agent service', () => {
  let broker;
  let objectStoreDocs;
  let ragCalls;
  let createdDatapoints;
  let forceNoRuleEvidence;
  let hitlItems;

  beforeAll(async () => {
    objectStoreDocs = new Map();
    ragCalls = [];
    createdDatapoints = [];
    forceNoRuleEvidence = false;
    hitlItems = [];
    broker = new ServiceBroker({ logger: false });

    broker.createService(require('../services/finance-agent.service'));
    broker.createService({
      name: 'hitl',
      actions: {
        create: {
          async handler(ctx) {
            const item = {
              id: `hitl-${hitlItems.length + 1}`,
              kind: ctx.params.kind,
              status: 'pending',
              payload: ctx.params.payload,
            };
            hitlItems.push(item);
            return { success: true, item };
          },
        },
      },
    });

    broker.createService({
      name: 'knowledge-rag',
      actions: {
        query: {
          async handler(ctx) {
            const q = String(ctx.params.query || '');
            ragCalls.push({
              query: q,
              filter: ctx.params.filter,
              collection: ctx.params.collection,
            });

            if (forceNoRuleEvidence) {
              return {
                success: true,
                data: {
                  results: [
                    {
                      pointId: 'fa-doc-h1',
                      score: 0.62,
                      referenceText_L0:
                        'L2_HyDE: Angenommen, CAPEX-Gewichtung steigt in der Regulierungsperiode.',
                      metadata: {
                        extractionLevel: 'L2_HyDE',
                      },
                      oeoTags: ['ceo:CapitalExpenditure'],
                    },
                  ],
                },
              };
            }

            if (q.includes('Regulatorische CAPEX-Regeln') || q.includes('§21a EnWG')) {
              return {
                success: true,
                data: {
                  results: [
                    {
                      pointId: 'fa-doc-1',
                      score: 0.91,
                      referenceText_L0:
                        'Wenn Investitionen nach §21a EnWG anerkannt werden, geht der Anteil in die regulierte Kostenbasis ein.',
                      metadata: {
                        extractionLevel: 'L1_Rule',
                        legalReference: '§21a EnWG',
                      },
                      oeoTags: ['ceo:CapitalExpenditure'],
                    },
                    {
                      pointId: 'fa-doc-2',
                      score: 0.87,
                      referenceText_L0:
                        'Dann werden OPEX-Positionen über regulatorische Effizienzvorgaben bewertet.',
                      metadata: {
                        extractionLevel: 'L1_Rule',
                        legalReference: '§21a EnWG',
                      },
                      oeoTags: ['ceo:OperatingExpenditure'],
                    },
                    {
                      pointId: 'fa-doc-3',
                      score: 0.71,
                      referenceText_L0:
                        'L2_HyDE: Szenario einer stärkeren CAPEX-Gewichtung in der 5. Regulierungsperiode.',
                      metadata: {
                        extractionLevel: 'L2_HyDE',
                      },
                      oeoTags: ['ceo:TotalExpenditure'],
                    },
                  ],
                },
              };
            }

            return { success: true, data: { results: [] } };
          },
        },
      },
    });

    broker.createService({
      name: 'cya',
      actions: {
        getProfile: {
          async handler(ctx) {
            const profileId = ctx.params.profile_id || ctx.params.id;
            if (profileId !== 'stadtwerk_regulierung') {
              const error = new Error('not found');
              error.status = 404;
              error.type = 'NOT_FOUND';
              throw error;
            }
            return {
              success: true,
              profile_id: profileId,
              profile: {
                actor: { role: 'grid_operator' },
                strategic_goals: ['Rechtssicherheit', 'Investitionssicherheit'],
                targetLayers: ['L1_Rule'],
              },
            };
          },
        },
      },
    });

    broker.createService({
      name: 'object-store',
      actions: {
        get: {
          async handler(ctx) {
            const key = `${ctx.params.namespace}:${ctx.params.key}`;
            if (!objectStoreDocs.has(key)) {
              const error = new Error('not found');
              error.status = 404;
              error.type = 'OBJECT_NOT_FOUND';
              throw error;
            }
            const payload = objectStoreDocs.get(key);
            return { namespace: ctx.params.namespace, key: ctx.params.key, payload };
          },
        },
        put: {
          async handler(ctx) {
            const key = `${ctx.params.namespace}:${ctx.params.key}`;
            objectStoreDocs.set(key, ctx.params.payload);
            return {
              namespace: ctx.params.namespace,
              key: ctx.params.key,
              payload: ctx.params.payload,
            };
          },
        },
        query: {
          async handler(ctx) {
            const sessionId = ctx.params?.selector?.['payload.sessionId'];
            const docs = [];
            for (const [compound, payload] of objectStoreDocs.entries()) {
              const [namespace] = compound.split(':');
              if (namespace !== ctx.params.namespace) continue;
              if (sessionId && payload?.sessionId !== sessionId) continue;
              docs.push({ payload });
            }
            return { docs: docs.slice(0, ctx.params.limit || 50), totalDocs: docs.length };
          },
        },
      },
    });

    broker.createService({
      name: 'datapoint',
      actions: {
        list: {
          async handler() {
            return {
              count: 2,
              datapoints: [
                {
                  name: 'dp_finance_capex_twl',
                  description: 'Finance Datapoint for CAPEX benchmarking',
                  tags: ['finance', 'capex'],
                },
                {
                  name: 'dp_grid_voltage_generic',
                  description: 'Grid voltage datapoint',
                  tags: ['grid'],
                },
              ],
            };
          },
        },
        get: {
          async handler(ctx) {
            if (ctx.params.name === 'finance-capex-baseline-2025') {
              return {
                name: 'finance-capex-baseline-2025',
                tags: ['finance', 'ceo:CapitalExpenditure'],
                data: {
                  value: { capex: 1200000, year: 2025 },
                  oeoTags: ['ceo:CapitalExpenditure', 'ceo:RegulatoryPeriod'],
                  provenance: 'finance-agent',
                },
              };
            }
            const error = new Error('not found');
            error.status = 404;
            error.type = 'NOT_FOUND';
            throw error;
          },
        },
        create: {
          async handler(ctx) {
            createdDatapoints.push(ctx.params);
            return { success: true, name: ctx.params.name, _rev: '1-test' };
          },
        },
      },
    });

    objectStoreDocs.set('cya_a2a_messages:event-1', {
      sessionId: 'finance-session-1',
      eventName: 'cya.a2a.consensus.reached',
      payload: { note: 'consensus reached for totex allocation' },
    });

    await broker.start();
  });

  afterAll(async () => {
    await broker.stop();
  });

  it('exposes analyze/list/get/prompts actions', () => {
    const actions = broker.getLocalService('finance-agent').schema.actions;
    expect(actions.analyze.rest).toBe('POST /analyze');
    expect(actions.list.rest).toBe('GET /analyses');
    expect(actions.get.rest).toBe('GET /analyses/:id');
    expect(actions.prompts.rest).toBe('GET /prompts');
    expect(actions.remember.rest).toBe('POST /memory');
    expect(actions.memory.rest).toBe('GET /memory/:sessionId');
  });

  it('runs analysis in default rule_plus_hyde mode', async () => {
    const res = await broker.call('finance-agent.analyze', {
      query:
        'Wie verhalten sich CAPEX, OPEX und TOTEX je 1 EUR Investition in der 5. Regulierungsperiode?',
    });

    expect(res.success).toBe(true);
    expect(res.mode).toBe('rule_plus_hyde');
    expect(res.status).toBe('ok');
    expect(Array.isArray(res.evidence)).toBe(true);
    expect(res.evidence.length).toBeGreaterThan(1);
    expect(res.legalReferences).toContain('§21a EnWG');
    expect(res.findings.some((f) => f.finding === 'FA_RULE_EVIDENCE_USED')).toBe(true);
  });

  it('returns needs_clarification when evidence is insufficient', async () => {
    const res = await broker.call('finance-agent.analyze', {
      query: 'Bitte nur kurze Marktübersicht ohne Rechtsbezug in Stichworten',
      mode: 'rule_only',
      topK: 2,
      minScore: 0.8,
    });

    expect(res.success).toBe(true);
    expect(res.status).toBe('needs_clarification');
    expect(res.findings.some((f) => f.finding === 'FA_NEEDS_CLARIFICATION')).toBe(true);
  });

  it('persists analyses and returns them via list/get', async () => {
    const created = await broker.call('finance-agent.analyze', {
      query:
        'Bitte analysiere CAPEX/OPEX/TOTEX für einen VNB im Kontext der 5. Regulierungsperiode mit Rechtsbezug.',
    });

    const list = await broker.call('finance-agent.list', { limit: 5 });
    expect(list.count).toBeGreaterThan(0);
    expect(list.analyses.some((a) => a.id === created.id)).toBe(true);

    const single = await broker.call('finance-agent.get', { id: created.id });
    expect(single.success).toBe(true);
    expect(single.id).toBe(created.id);
  });

  it('returns internal prompt templates', async () => {
    const res = await broker.call('finance-agent.prompts');
    expect(res.success).toBe(true);
    expect(res.modeDefault).toBe('rule_plus_hyde');
    expect(res.prompts).toHaveProperty('queryPlanner');
    expect(res.prompts).toHaveProperty('evidenceArbiter');
    expect(res.prompts).toHaveProperty('synthesis');
  });

  it('stores and reads session memory', async () => {
    const write = await broker.call('finance-agent.remember', {
      sessionId: 'finance-session-1',
      memory: {
        summary: 'Vorwissen aus vorheriger Wirtschaftlichkeitsbetrachtung.',
        legalReferences: ['§21a EnWG'],
      },
    });

    expect(write.success).toBe(true);
    expect(write.sessionId).toBe('finance-session-1');
    expect(write.memory.summary).toContain('Vorwissen');

    const read = await broker.call('finance-agent.memory', {
      sessionId: 'finance-session-1',
    });
    expect(read.success).toBe(true);
    expect(read.memory.summary).toContain('Vorwissen');
    expect(read.memory.legalReferences).toContain('§21a EnWG');
  });

  it('loads context from memory, A2A and datapoints during analyze', async () => {
    await broker.call('finance-agent.remember', {
      sessionId: 'finance-session-1',
      memory: {
        summary: 'CAPEX/OPEX Sensitivität bereits für RP5 bewertet.',
        legalReferences: ['§21a EnWG'],
      },
    });

    const res = await broker.call('finance-agent.analyze', {
      sessionId: 'finance-session-1',
      query: 'Wie wirkt sich zusätzliche CAPEX auf TOTEX im regulatorischen Kontext aus?',
      includeDatapointsContext: true,
      includeA2AContext: true,
      includeMemoryContext: true,
    });

    expect(res.success).toBe(true);
    expect(res.metadata.context.sessionId).toBe('finance-session-1');
    expect(res.metadata.context.memoryLoaded).toBe(true);
    expect(res.metadata.context.a2aMessages).toBeGreaterThan(0);
    expect(res.metadata.context.datapoints).toBeGreaterThan(0);
  });

  it('applies CYA target layers and datapoint working memory in analyze', async () => {
    ragCalls.length = 0;

    const res = await broker.call('finance-agent.analyze', {
      profileId: 'stadtwerk_regulierung',
      datapointContext: ['finance-capex-baseline-2025'],
      query: 'Wie verändert CAPEX den TOTEX-Rahmen in RP5?',
      includeTrace: true,
    });

    expect(res.success).toBe(true);
    expect(res.metadata.context.profileLoaded).toBe(true);
    expect(res.metadata.context.datapointContextLoaded).toBeGreaterThan(0);
    expect(Array.isArray(res.trace.plan.targetLayers)).toBe(true);
    expect(res.trace.plan.targetLayers).toContain('L1_Rule');
    const hasLayerFilter = ragCalls.some((c) =>
      JSON.stringify(c.filter || {}).includes('metadata.extractionLevel')
    );
    expect(hasLayerFilter).toBe(true);
  });

  it('persists derived scenario datapoint when persistDatapoints is enabled', async () => {
    createdDatapoints.length = 0;

    const res = await broker.call('finance-agent.analyze', {
      query: 'Bitte berechne das CAPEX/OPEX Delta für RP5 mit Rechtsbezug.',
      persistDatapoints: true,
      datapointContext: ['finance-capex-baseline-2025'],
    });

    expect(res.success).toBe(true);
    expect(res.metadata.persistedDatapoint.persisted).toBe(true);
    expect(createdDatapoints.length).toBe(1);
    expect(createdDatapoints[0].provenance).toBe('finance-agent');
  });

  it('returns hypothetical_scenario when L1 evidence is missing and hypotheticals are allowed', async () => {
    forceNoRuleEvidence = true;

    const res = await broker.call('finance-agent.analyze', {
      query: 'What-if Analyse zur RP5 unter hypothetischen CAPEX Annahmen',
      allowHypotheticals: true,
      mode: 'rule_plus_hyde',
    });

    forceNoRuleEvidence = false;

    expect(res.success).toBe(true);
    expect(res.status).toBe('hypothetical_scenario');
    expect(res.hitlItem).toBeTruthy();
    expect(res.hitlItem.kind).toBe('finance-hypothetical-review');
    expect(Array.isArray(res.assumptions)).toBe(true);
    expect(res.assumptions.length).toBeGreaterThan(0);
  });

  it('does not return HITL item for evidence-backed result', async () => {
    const res = await broker.call('finance-agent.analyze', {
      query:
        'Wie verhalten sich CAPEX, OPEX und TOTEX je 1 EUR Investition in der 5. Regulierungsperiode?',
    });

    expect(res.success).toBe(true);
    expect(res.status).toBe('ok');
    expect(res.hitlItem).toBeNull();
  });

  it('falls back to static synthesis when LLM throws LLM_NOT_CONFIGURED', async () => {
    const { generateStructured } = require('../src/llm-client');
    // Force the synthesis call (3rd LLM call in the pipeline) to throw
    generateStructured
      .mockRejectedValueOnce(Object.assign(new Error('LLM_NOT_CONFIGURED'), { code: 503 }))
      .mockRejectedValueOnce(Object.assign(new Error('LLM_NOT_CONFIGURED'), { code: 503 }))
      .mockRejectedValueOnce(Object.assign(new Error('LLM_NOT_CONFIGURED'), { code: 503 }));

    const res = await broker.call('finance-agent.analyze', {
      query:
        'Wie verhalten sich CAPEX, OPEX und TOTEX je 1 EUR Investition in der 5. Regulierungsperiode?',
    });

    expect(res.success).toBe(true);
    // Fallback static logic produces a valid status
    expect(['ok', 'needs_clarification', 'hypothetical_scenario']).toContain(res.status);
  });
});
