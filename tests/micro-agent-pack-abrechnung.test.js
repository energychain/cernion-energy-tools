'use strict';

// Pack "abrechnung" (micro-agent tier, Phase 1). Every service below is a STUB with synthetic
// TEST DATA; no network, no real model.

jest.mock('../src/llm-client', () => ({ generateStructured: jest.fn() }));

const { ServiceBroker, Errors } = require('moleculer');
const llm = require('../src/llm-client');
const { packService } = require('../src/micro-agents/pack-service');
const { READ_ACTIONS } = require('../src/micro-agents/packs/abrechnung.expanders');

const TENANT = 'test-tenant';
const meta = { tenantId: TENANT };
const notFound = () => new Errors.MoleculerClientError('not found', 404, 'NOT_FOUND');

// Synthetic test data.
const EEG_ID = 'eeg_2026q2_SEE900000000001';
const SLOW_ID = 'eeg_2026q3_SEE900000000002';
const REDISPATCH_ID = 'redispatch_2026q1_SEE900000000003';
const RULE_ID = 'rel:00000000-0000-4000-8000-000000000001';
const FOREIGN_RULE_ID = 'rel:00000000-0000-4000-8000-000000000002';
const FEE_CALC_ID = 're4de-vgf:00000000-0000-4000-8000-000000000003';
const MELO = `DE${'0'.repeat(30)}1`;
const RULE_SET = {
  _id: RULE_ID,
  tenantId: TENANT,
  type: 'regulatorische-entgeltlogik',
  gridOperatorId: 'TEST-VNB-1',
  ruleType: 'NETWORK_USAGE_FEE',
  effectiveFrom: '2026-01-01',
  effectiveTo: null,
  label: 'Testpreisblatt Netznutzung Niederspannung',
  legalBasis: '§ 21 EnWG (Testangabe)',
  formulaDefinition: { formula: 'LINEAR', baseRate: 1.5, fixedCharge: 10 },
  testResults: { total: 2, passed: 2 },
};
const EEG_RULE = {
  id: 'test-eeg-rule-2027',
  version: '0.1',
  status: 'active',
  legalStatus: 'referentenentwurf',
  effectiveFrom: '2026-06-01',
  effectiveTo: null,
  calculationMode: 'eeg2027_clawback',
  sourceReference: 'Testquelle Referentenentwurf',
  sourceUrl: 'https://example.invalid/test',
  notes: [],
};

const calls = [];
const writes = [];
const record = (name) => (ctx) => {
  calls.push({ name, params: ctx.params, tenantId: ctx.meta.tenantId });
};
// Write actions of the same services: present so a wrong call would succeed silently, recorded so
// the test can assert none happened.
const writeStub = (name) => ({
  handler(ctx) {
    writes.push(name);
    return { ok: true, params: ctx.params };
  },
});

const stubs = [
  {
    name: 'settlement',
    actions: {
      getEegReport(ctx) {
        record('settlement.getEegReport')(ctx);
        if (ctx.params.settlementId === SLOW_ID)
          return new Promise((resolve) => setTimeout(() => resolve({ type: 'eeg' }), 3000).unref());
        if (ctx.params.settlementId !== EEG_ID) throw notFound();
        return {
          settlementId: EEG_ID,
          type: 'eeg',
          mastrNummer: 'SEE900000000001',
          meloId: MELO,
          tariff: 7.94,
          tariffCentPerKwh: 7.94,
          feedinKwh: 1234.5,
          revenue_eur: 98.02,
          period: { from: '2026-04-01T00:00:00.000Z', to: '2026-06-30T23:59:59.999Z' },
          createdAt: '2026-07-02T08:00:00.000Z',
        };
      },
      getRedispatchReport(ctx) {
        record('settlement.getRedispatchReport')(ctx);
        if (ctx.params.settlementId !== REDISPATCH_ID) throw notFound();
        return {
          settlementId: REDISPATCH_ID,
          type: 'redispatch',
          period: { from: '2026-01-01T00:00:00.000Z', to: '2026-03-31T23:59:59.999Z' },
          events: [{ installationMastrNummer: 'SEE900000000003' }],
          summary: { totalEvents: 1, totalLostKwh: 50, totalCompensation_eur: 4.1 },
        };
      },
      listSettlements(ctx) {
        record('settlement.listSettlements')(ctx);
        if (ctx.params.period !== '2026q2') return { success: true, count: 0, data: [] };
        return {
          success: true,
          count: 1,
          data: [{ key: EEG_ID, type: 'eeg', period: { from: '2026-04-01', to: '2026-06-30' } }],
        };
      },
      calculateEeg: writeStub('settlement.calculateEeg'),
      calculateRedispatch: writeStub('settlement.calculateRedispatch'),
      prepareA96: writeStub('settlement.prepareA96'),
      reconcileA96: writeStub('settlement.reconcileA96'),
    },
  },
  {
    name: 're4de-variable-grid-fee',
    actions: {
      getEvidence(ctx) {
        record('re4de-variable-grid-fee.getEvidence')(ctx);
        if (ctx.params.calculationId !== FEE_CALC_ID) return { found: false };
        return {
          found: true,
          evidenceId: `evidence:${FEE_CALC_ID}`,
          calculationId: FEE_CALC_ID,
          tariffSheetId: 'TEST-SHEET',
          tariffSheetVersion: '1',
          gridAreaId: 'TEST-AREA',
          period: { from: '2026-01-01T00:00:00.000Z', to: '2026-02-01T00:00:00.000Z' },
          totalKwh: 300,
          variableFeeEur: 21.3,
          basePriceEur: 5.1,
          totalEur: 26.4,
          section14aApplied: false,
          validationFindings: [],
        };
      },
      calculate: writeStub('re4de-variable-grid-fee.calculate'),
    },
  },
  {
    name: 'regulatorische-entgeltlogik',
    actions: {
      get(ctx) {
        record('regulatorische-entgeltlogik.get')(ctx);
        if (ctx.params.id === RULE_ID) return RULE_SET;
        if (ctx.params.id === FOREIGN_RULE_ID)
          return { ...RULE_SET, _id: FOREIGN_RULE_ID, tenantId: 'other-tenant' };
        throw notFound();
      },
      list(ctx) {
        record('regulatorische-entgeltlogik.list')(ctx);
        return { ruleSets: [RULE_SET] };
      },
      registerRuleSet: writeStub('regulatorische-entgeltlogik.registerRuleSet'),
    },
  },
  {
    name: 'rcs-rule-catalog',
    actions: {
      listRuleSets(ctx) {
        record('rcs-rule-catalog.listRuleSets')(ctx);
        return { success: true, latestRuleSetId: EEG_RULE.id, total: 1, items: [EEG_RULE] };
      },
    },
  },
  {
    name: 'eog-calculator',
    actions: {
      getModel(ctx) {
        record('eog-calculator.getModel')(ctx);
        if (ctx.params.vnbId !== 'TEST-VNB-1') return { success: true, datapoints: [] };
        return {
          success: true,
          datapoints: [
            {
              id: 'test-dp-1',
              key: 'approved_revenue_cap',
              value: 1000000,
              unit: 'EUR',
              periodYear: 2026,
              source: 'tenant_uploaded',
              confidence: 'confirmed',
            },
            { id: 'test-dp-2', key: 'efficiency_value', value: 97, unit: '%' },
          ],
        };
      },
      calculate: writeStub('eog-calculator.calculate'),
      commitDatapoints: writeStub('eog-calculator.commitDatapoints'),
      validateDatapoints: writeStub('eog-calculator.validateDatapoints'),
    },
  },
];

describe('micro-agent pack abrechnung', () => {
  let broker;
  const expand = (object, context, budget) =>
    broker.call('micro-agent.abrechnung.expand', { object, context, budget }, { meta });

  beforeAll(async () => {
    broker = new ServiceBroker({ logger: false, transporter: null });
    broker.createService(packService('abrechnung'));
    for (const stub of stubs) broker.createService(stub);
    await broker.start();
  });
  afterAll(() => broker.stop());
  beforeEach(() => {
    calls.length = 0;
    llm.generateStructured.mockReset();
  });
  afterEach(() => expect(writes).toEqual([]));

  test('only actions that are data_read without side effects in the capability index', () => {
    const index = require('../operation-capability-index.json');
    for (const action of Object.values(READ_ACTIONS)) {
      const entry = index.operations.find((row) => row.action === action);
      expect({ action, kind: entry?.operationKind }).toEqual({ action, kind: 'data_read' });
      expect(entry.sideEffects).toEqual([]);
      expect(entry.writesTo).toEqual([]);
    }
  });

  test('detects settlement keys and fee record ids by format', async () => {
    const found = await broker.call('micro-agent.abrechnung.detect', {
      text: `Bitte ${EEG_ID} und ${FEE_CALC_ID} prüfen, nicht eeg_2026_x.`,
    });
    expect(found.map((row) => [row.kind, row.value])).toEqual([
      ['billing.invoice', EEG_ID],
      ['billing.fee', FEE_CALC_ID],
    ]);
  });

  test('a settlement key yields facts with provenance and follow-ups to unit and location', async () => {
    const finding = await expand({ kind: 'billing.invoice', value: EEG_ID });
    expect(finding.failed).toBeUndefined();
    const revenue = finding.facts.find((row) => row.unit === 'EUR');
    expect(revenue).toMatchObject({
      value: '98.02',
      role: 'monetary',
      basis: 'source',
      provenance: { source: 'settlement.getEegReport', ref: EEG_ID },
    });
    expect(finding.facts.every((row) => row.provenance.source)).toBe(true);
    expect(calls.find((row) => row.name === 'settlement.getEegReport').tenantId).toBe(TENANT);
    const next = await broker.call('micro-agent.abrechnung.plan', {
      finding,
      object: { kind: 'billing.invoice' },
    });
    expect(next.map((row) => [row.kind, row.value])).toEqual([
      ['plant.register_unit', 'SEE900000000001'],
      ['mako.location_id', MELO],
    ]);
  });

  test('an unknown settlement key is a negative with scope', async () => {
    const finding = await expand({
      kind: 'billing.invoice',
      value: 'redispatch_2025q4_SEE900000000009',
    });
    expect(finding.facts).toEqual([]);
    expect(finding.negatives).toEqual([
      expect.objectContaining({
        searched: 'redispatch_2025q4_SEE900000000009',
        result: 'not_found',
        scope: expect.stringContaining('settlement.getRedispatchReport'),
      }),
    ]);
    expect(finding.openQuestions.length).toBeGreaterThan(0);
  });

  test('an invoice by period lists stored settlements; an empty period is a scoped negative', async () => {
    const hit = await expand({ kind: 'billing.invoice', value: 'Abrechnung vom 15.05.2026' });
    expect(hit.facts[0]).toMatchObject({
      value: EEG_ID,
      provenance: { source: 'settlement.listSettlements' },
    });
    const miss = await expand({ kind: 'billing.invoice', value: 'Rechnung 2019' });
    expect(miss.negatives[0]).toMatchObject({ result: 'no_hit' });
    expect(miss.negatives[0].scope).toMatch(/2019/u);
  });

  test('a fee calculation id yields the dossier-safe evidence', async () => {
    const finding = await expand({ kind: 'billing.fee', value: FEE_CALC_ID });
    expect(
      finding.facts.find((row) => row.statement.startsWith('Netzentgelt gesamt'))
    ).toMatchObject({
      value: '26.4',
      unit: 'EUR',
      provenance: { source: 're4de-variable-grid-fee.getEvidence' },
    });
  });

  test('a rule set id yields the rule, its revenue cap and a follow-up to its legal basis', async () => {
    const finding = await expand({ kind: 'billing.fee', value: RULE_ID });
    expect(finding.facts.map((row) => row.provenance.source)).toEqual(
      expect.arrayContaining(['regulatorische-entgeltlogik.get', 'eog-calculator.getModel'])
    );
    const cap = finding.facts.find((row) => row.provenance.source === 'eog-calculator.getModel');
    expect(cap).toMatchObject({ value: '1000000', unit: 'EUR', role: 'monetary' });
    expect(calls.find((row) => row.name === 'eog-calculator.getModel').params).toEqual({
      tenantId: TENANT,
      vnbId: 'TEST-VNB-1',
    });
    const next = await broker.call('micro-agent.abrechnung.plan', {
      finding,
      object: { kind: 'billing.fee' },
    });
    expect(next).toEqual([expect.objectContaining({ kind: 'reg.section', value: '§ 21 EnWG' })]);
  });

  test("another tenant's rule set is not reported", async () => {
    const finding = await expand({ kind: 'billing.fee', value: FOREIGN_RULE_ID });
    expect(finding.facts).toEqual([]);
    expect(finding.negatives[0]).toMatchObject({ searched: FOREIGN_RULE_ID, result: 'not_found' });
  });

  test('a fee without id is picked by the model only with a verbatim quote', async () => {
    llm.generateStructured.mockResolvedValueOnce({
      picks: [
        { id: RULE_ID, quote: 'Netznutzung Niederspannung' },
        { id: EEG_RULE.id, quote: 'nicht im Kandidaten' },
      ],
    });
    const finding = await expand({ kind: 'billing.fee', value: 'Netzentgelt Niederspannung' });
    expect(llm.generateStructured).toHaveBeenCalledWith(
      expect.any(Object),
      expect.any(String),
      expect.objectContaining({ phase: 'micro_agent_abrechnung', tenantId: TENANT })
    );
    const sources = finding.facts.map((row) => row.provenance.source);
    expect(sources).toContain('regulatorische-entgeltlogik.list');
    expect(sources).not.toContain('rcs-rule-catalog.listRuleSets');
    expect(finding.facts[0].provenance.quote).toBe('Netznutzung Niederspannung');
  });

  test('the concern without consequenceOf: no pick is a negative with scope', async () => {
    llm.generateStructured.mockResolvedValueOnce({ picks: [] });
    const finding = await expand({ kind: 'concern', value: 'Wie hoch ist die Konzessionsabgabe?' });
    expect(finding.facts).toEqual([]);
    expect(finding.negatives[0]).toMatchObject({ result: 'no_match' });
    expect(finding.negatives[0].scope).toMatch(/regulatorische-entgeltlogik\.list \(1 /u);
    expect(finding.negatives[0].scope).toMatch(/rcs-rule-catalog\.listRuleSets \(1 /u);
  });

  test('the concern with consequenceOf relates the picked rule to the consequence', async () => {
    llm.generateStructured.mockResolvedValueOnce({
      picks: [{ id: EEG_RULE.id, quote: 'Testquelle Referentenentwurf' }],
    });
    const finding = await expand(
      { kind: 'concern', value: 'Was ändert sich für unsere PV-Einspeiser?' },
      { consequenceOf: 'Negative Preise in Testzeitraum' }
    );
    expect(finding.facts[0]).toMatchObject({
      value: EEG_RULE.id,
      provenance: {
        source: 'rcs-rule-catalog.listRuleSets',
        quote: 'Testquelle Referentenentwurf',
      },
    });
    expect(finding.relations).toEqual([
      { from: EEG_RULE.id, rel: 'affects', to: 'Negative Preise in Testzeitraum' },
    ]);
    expect(JSON.parse(llm.generateStructured.mock.calls[0][1]).question).toMatch(
      /Negative Preise in Testzeitraum/u
    );
  });

  test('a failing model gives an open question, not a negative', async () => {
    llm.generateStructured.mockRejectedValueOnce(new Error('model down'));
    const finding = await expand({ kind: 'concern', value: 'Welche Umlagen gelten?' });
    expect(finding.failed).toBeUndefined();
    expect(finding.negatives).toEqual([]);
    expect(finding.openQuestions[0].question).toMatch(/registrierten Regelwerke/u);
  });

  test('unsupported kinds are refused', async () => {
    const finding = await expand({ kind: 'asset.equipment', value: 'Trafo 1' });
    expect(finding.skipped).toBe('kind_not_handled');
    expect(finding.facts).toEqual([]);
  });

  test('a slow service call is a scoped negative, a slow expander an empty finding', async () => {
    const slowCall = await expand({ kind: 'billing.invoice', value: SLOW_ID });
    expect(slowCall.failed).toBeUndefined();
    expect(slowCall.negatives[0]).toMatchObject({ searched: SLOW_ID, result: 'unavailable' });
    const slowExpander = await expand(
      { kind: 'billing.invoice', value: SLOW_ID },
      {},
      {
        timeoutMs: 50,
      }
    );
    expect(slowExpander.failed).toBe('timeout');
    expect(slowExpander.facts).toEqual([]);
  });
});
