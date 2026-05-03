'use strict';

const path = require('path');
const os = require('os');
const { ServiceBroker } = require('moleculer');

process.env.FINANCE_AGENT_DB_PATH = path.join(os.tmpdir(), `cernion-fa-test-${Date.now()}`);

describe('finance-agent service', () => {
  let broker;

  beforeAll(async () => {
    broker = new ServiceBroker({ logger: false });

    broker.createService(require('../services/finance-agent.service'));

    broker.createService({
      name: 'knowledge-rag',
      actions: {
        query: {
          async handler(ctx) {
            const q = String(ctx.params.query || '');

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
});
