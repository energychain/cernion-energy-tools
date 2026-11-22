'use strict';

/**
 * Pack "Finanzen und Controlling" (micro-agent tier, Phase 1). All service data below is
 * synthetic TEST DATA; the source services are stubs, the model is mocked.
 */

jest.mock('../src/llm-client', () => ({ generateStructured: jest.fn() }));

const { ServiceBroker } = require('moleculer');
const llm = require('../src/llm-client');

const TENANT = 'test-tenant-fin';
const OTHER_TENANT = 'test-tenant-other';

// TEST DATA – synthetic CAPEX prioritization analyses.
const ANALYSES = [
  {
    _id: 'capex:TEST-A2',
    type: 'capex-prioritization-analysis',
    tenantId: TENANT,
    gridOperatorId: 'TESTVNB1',
    label: 'Testplan 2027',
    createdAt: '2026-10-01T08:00:00.000Z',
    summary: {
      totalMeasures: 2,
      nonNegotiableCount: 1,
      totalCapexEur: 3500000,
      totalCapexNonNegotiableEur: 2500000,
    },
    classifiedMeasures: [
      {
        measureId: 'TM-101',
        description: 'Testmaßnahme Ersatz Umspanner Testfeld Nord',
        classification: 'NON_NEGOTIABLE_PHYSICAL',
        urgency: 'CRITICAL',
        priorityScore: 100,
        capexEur: 2500000,
      },
      {
        measureId: 'TM-102',
        description: 'Testmaßnahme Flexibilitätsvertrag Teststrang Süd',
        classification: 'FLEXIBILITY_BRIDGE',
        urgency: 'MEDIUM',
        priorityScore: 50,
        capexEur: 1000000,
        physicalMeasurePlannedDate: '2028-06-30',
      },
    ],
    clevelTemplate: {
      headline: '1 Maßnahme(n) sind nicht durch Marktflexibilität ersetzbar',
      nonNegotiableSummary: 'CAPEX-Pflichtblock: 2.5 Mio. €',
      decisionRequired: true,
    },
  },
  // Another tenant's document must never surface, even if a service returned it.
  {
    _id: 'capex:TEST-X',
    tenantId: OTHER_TENANT,
    gridOperatorId: 'TESTVNB9',
    summary: { totalCapexEur: 999 },
    classifiedMeasures: [
      { measureId: 'TM-101', description: 'fremd', classification: 'COMMERCIAL_OPTION' },
    ],
  },
];

// TEST DATA – synthetic EOG datapoints.
const EOG_DATAPOINTS = [
  {
    id: `${TENANT}:TESTVNB1:controllable_costs:strom:2026:na`,
    key: 'controllable_costs',
    typedKey: 'eog.controllable_costs',
    value: 1200000,
    unit: 'EUR',
    periodYear: 2026,
    sector: 'strom',
    source: 'tenant_uploaded',
    confidence: 'confirmed',
  },
];

const calls = [];
let mode = 'normal';

function stubs() {
  return [
    {
      name: 'capex-prioritization',
      actions: {
        async list(ctx) {
          calls.push({ action: 'capex-prioritization.list', meta: ctx.meta, params: ctx.params });
          if (mode === 'slow') await new Promise((resolve) => setTimeout(resolve, 3000).unref());
          if (mode === 'empty') return { analyses: [] };
          if (mode === 'down') throw new Error('test: service down');
          return { analyses: ANALYSES };
        },
      },
    },
    {
      name: 'eog-calculator',
      actions: {
        getModel(ctx) {
          calls.push({ action: 'eog-calculator.getModel', params: ctx.params });
          return {
            success: true,
            scope: ctx.params,
            datapoints: ctx.params.tenantId === TENANT ? EOG_DATAPOINTS : [],
          };
        },
        inputStatus(ctx) {
          calls.push({ action: 'eog-calculator.inputStatus', params: ctx.params });
          return {
            success: true,
            dataStatus: 'partial',
            confidence: 'confirmed',
            missing: [
              {
                key: 'efficiency_value',
                typedKey: 'eog.efficiency_value',
                explanation: 'Testerklärung: ohne Effizienzwert kein Abbaupfad.',
              },
            ],
          };
        },
      },
    },
  ];
}

const budget = (value, objectId = 'O1') => ({ objectId, kind: 'finance.budget', value });
const concern = (value) => ({ objectId: 'C1', kind: 'concern', value });

describe('micro-agent pack finanzen', () => {
  let broker;
  const expand = (object, context = { tenantId: TENANT }, extra = {}) =>
    broker.call('micro-agent.finanzen.expand', { object, context, ...extra });

  beforeAll(async () => {
    broker = new ServiceBroker({ logger: false, transporter: null });
    broker.createService(require('../services/micro-agent-finanzen.service'));
    for (const schema of stubs()) broker.createService(schema);
    await broker.start();
  });
  afterAll(() => broker.stop());
  beforeEach(() => {
    calls.length = 0;
    mode = 'normal';
    llm.generateStructured.mockReset();
    llm.generateStructured.mockResolvedValue({ measures: [] });
  });

  test('describe lists the declared kind and the concern', async () => {
    const manifest = await broker.call('micro-agent.finanzen.describe');
    expect(manifest.expands).toEqual(expect.arrayContaining(['finance.budget', 'concern']));
    expect(manifest.concern).toBe(true);
  });

  test('a budget mention yields CAPEX and EOG facts with provenance, scoped to the tenant', async () => {
    const finding = await expand(budget('TM-101'));
    const measure = finding.facts.find((fact) => fact.role === 'classification');
    expect(measure.statement).toContain('TM-101');
    expect(measure.provenance.source).toBe('capex-prioritization.list');
    expect(measure.provenance.ref).toBe('capex-prioritization.list:capex:TEST-A2#TM-101');
    expect(measure.provenance.quote).toBe('Testmaßnahme Ersatz Umspanner Testfeld Nord');
    const capex = finding.facts.find((fact) => fact.value === '2500000' && fact.unit === 'EUR');
    expect(capex).toBeTruthy();
    expect(capex.basis).toBe('source');
    // EOG values and missing inputs, read with the conversation's tenant.
    const eog = finding.facts.find((fact) => fact.provenance.source === 'eog-calculator.getModel');
    expect(eog.value).toBe('1200000');
    expect(
      finding.facts.some(
        (fact) =>
          fact.provenance.source === 'eog-calculator.inputStatus' &&
          fact.value === 'eog.efficiency_value'
      )
    ).toBe(true);
    expect(calls.find((row) => row.action === 'capex-prioritization.list').meta.tenantId).toBe(
      TENANT
    );
    for (const row of calls.filter((entry) => entry.action.startsWith('eog-calculator.')))
      expect(row.params).toEqual({ tenantId: TENANT, vnbId: 'TESTVNB1' });
    // No fact of the other tenant.
    expect(finding.facts.some((fact) => fact.value === '999')).toBe(false);
    expect(finding.facts.every((fact) => fact.provenance.source)).toBe(true);
    expect(finding.relations).toContainEqual({
      from: 'O1',
      rel: 'refers_to',
      to: 'capex-prioritization.list:capex:TEST-A2#TM-101',
    });
    expect(llm.generateStructured).not.toHaveBeenCalled();
  });

  test('a planned date stays a date, never a deadline', async () => {
    const finding = await expand(budget('Flexibilitätsvertrag Teststrang'));
    const date = finding.facts.find((fact) => fact.value === '2028-06-30');
    expect(date.role).toBe('date');
    expect(finding.facts.some((fact) => fact.role === 'deadline')).toBe(false);
  });

  test('the playbook hands a matched CAPEX measure to asset management', async () => {
    const object = budget('TM-101');
    const finding = await expand(object);
    const next = await broker.call('micro-agent.finanzen.plan', { finding, object });
    expect(next).toEqual([expect.objectContaining({ kind: 'asset.investment', value: 'TM-101' })]);
  });

  test('an unsupported kind is refused', async () => {
    const finding = await expand({ objectId: 'X1', kind: 'grid.node', value: 'K-1' });
    expect(finding.skipped).toBe('kind_not_handled');
    expect(finding.facts).toEqual([]);
  });

  test('no match is a negative with scope; a model pick counts only with a verbatim quote', async () => {
    llm.generateStructured.mockResolvedValueOnce({
      measures: [{ measureId: 'TM-101', quote: 'erfundene Passage' }],
    });
    const finding = await expand(budget('Budget für Leitstellen-Software'));
    expect(finding.facts.some((fact) => fact.role === 'classification')).toBe(false);
    const negative = finding.negatives.find((row) => row.result === 'no_hit');
    expect(negative.searched).toContain('Leitstellen-Software');
    expect(negative.scope).toContain(TENANT);
    expect(llm.generateStructured).toHaveBeenCalledWith(
      expect.any(Object),
      expect.any(String),
      expect.objectContaining({ phase: 'micro_agent_finanzen', tenantId: TENANT })
    );

    llm.generateStructured.mockResolvedValueOnce({
      measures: [{ measureId: 'TM-101', quote: 'Ersatz Umspanner' }],
    });
    const picked = await expand(budget('Budget Transformatorwechsel'));
    const measure = picked.facts.find((fact) => fact.role === 'classification');
    expect(measure.provenance.quote).toBe('Ersatz Umspanner');
  });

  test('a tenant without analyses gets a scoped negative and the open question for the VNB', async () => {
    mode = 'empty';
    const finding = await expand(budget('TM-101'));
    expect(finding.facts).toEqual([]);
    expect(finding.negatives[0]).toEqual(
      expect.objectContaining({ result: 'no_analyses', scope: expect.stringContaining(TENANT) })
    );
    expect(finding.openQuestions[0].question).toContain('VNB');
    expect(calls.some((row) => row.action.startsWith('eog-calculator.'))).toBe(false);
  });

  test('a failing source is an honest negative, not an error', async () => {
    mode = 'down';
    const finding = await expand(budget('TM-101'));
    expect(finding.failed).toBeUndefined();
    expect(finding.negatives[0].result).toBe('unavailable');
  });

  test('a slow source never throws, within the budget', async () => {
    mode = 'slow';
    const finding = await expand(
      budget('TM-101'),
      { tenantId: TENANT },
      {
        budget: { timeoutMs: 800 },
      }
    );
    expect(finding.facts).toEqual([]);
    expect(finding.failed || finding.negatives[0]?.result).toBeTruthy();
  }, 10000);

  test('the concern without consequenceOf reads measures it names', async () => {
    const finding = await expand(concern('Was kostet die Maßnahme TM-102 im Plan?'));
    const measure = finding.facts.find((fact) => fact.role === 'classification');
    expect(measure.statement).toContain('TM-102');
    expect(finding.relations[0].rel).toBe('refers_to');
    // The concern reads the EOG status only, not the values.
    expect(calls.some((row) => row.action === 'eog-calculator.getModel')).toBe(false);
    expect(calls.some((row) => row.action === 'eog-calculator.inputStatus')).toBe(true);
  });

  test('the concern with consequenceOf marks the measures the other finding affects', async () => {
    const finding = await expand(concern('Ist das Netz Nord betroffen?'), {
      tenantId: TENANT,
      consequenceOf: 'Netzplanung: Überlast am Umspanner, Maßnahme TM-101 betroffen',
    });
    expect(finding.relations).toContainEqual({
      from: 'C1',
      rel: 'affects',
      to: 'capex-prioritization.list:capex:TEST-A2#TM-101',
    });
    expect(finding.facts.some((fact) => fact.statement.includes('Pflichtblock'))).toBe(true);
  });
});
