'use strict';

// Assetmanagement pack (micro-agent tier, Phase 1). All data below is SYNTHETIC TEST DATA: the
// stub services stand in for the read actions the expanders call; no network, no model.

const { ServiceBroker } = require('moleculer');

const TENANT = 'test-tenant-asset';
const ASSET = 'TEST-TRAFO-0001';
const ASSET_SLOW = 'TEST-TRAFO-SLOW';
const UNIT = 'SEE900000000077';
const PLAN_ID = 'test-plan-0001';
const MEASURE = 'test-m-001';
const CAPEX_MEASURE = 'test-cx-007';
const CASE = 'test-case-42';

const seenTenants = [];
const writes = [];
const seen = (ctx) => seenTenants.push(ctx.meta.tenantId);
// Any write action that an expander might call by mistake is recorded here.
const forbidden = (name) => () => {
  writes.push(name);
  return { success: true };
};

const stubs = [
  {
    name: 'investment-planning',
    actions: {
      listPlans(ctx) {
        seen(ctx);
        return {
          success: true,
          count: 1,
          plans: [
            {
              id: PLAN_ID,
              tenantId: TENANT,
              decisionStatus: 'blocked',
              planVsActual: {
                sollEur: 1000000,
                istEur: 1250000,
                deltaEur: 250000,
                deltaPercent: 25,
              },
              mandateAlignment: { missingRoles: ['ROLE_NETZPLANUNG'], aligned: false },
              triggerPolicy: {
                thresholdEur: 1000000,
                semantics: 'strict_greater_than_per_measure',
              },
              triggeredMeasures: [
                {
                  measureId: MEASURE,
                  name: 'Testmaßnahme Umspannwerk Süd',
                  projectId: 'test-proj-9',
                  capexEur: 1200000,
                  avoidedCostsEur: 150000,
                  triggerAmountEur: 1200000,
                  thresholdEur: 1000000,
                  requiresHitl: true,
                },
              ],
              hitlItemIds: ['test-hitl-1'],
              createdAt: '2026-10-01T08:00:00.000Z',
            },
          ],
        };
      },
      createPlan: forbidden('investment-planning.createPlan'),
    },
  },
  {
    name: 'capex-prioritization',
    actions: {
      list(ctx) {
        seen(ctx);
        return {
          analyses: [
            {
              _id: 'capex:test-1',
              tenantId: TENANT,
              createdAt: '2026-10-02T08:00:00.000Z',
              summary: {
                totalMeasures: 2,
                nonNegotiableCount: 1,
                regulatoryCount: 1,
                totalCapexEur: 3000000,
                totalCapexNonNegotiableEur: 2000000,
              },
              classifiedMeasures: [
                {
                  measureId: CAPEX_MEASURE,
                  description: 'Testleitung Nord N-1',
                  regulatoryBasis: '§ 11 EnWG',
                  capexEur: 2000000,
                  classification: 'REGULATORY_OBLIGATION',
                  canBeReplacedByFlex: false,
                  urgency: 'CRITICAL',
                  priorityScore: 100,
                  findings: [
                    {
                      code: 'REGULATORY_MANDATORY',
                      message: 'Gesetzliche Verpflichtung (Testtext)',
                    },
                  ],
                },
              ],
            },
          ],
        };
      },
      analyze: forbidden('capex-prioritization.analyze'),
    },
  },
  {
    name: 'investment-maturity-off-balance-gate',
    actions: {
      listGates(ctx) {
        seen(ctx);
        return {
          gates: [
            {
              _id: 'imob:test-1',
              tenantId: TENANT,
              investmentCaseId: CASE,
              investmentPlanId: PLAN_ID,
              evidenceStatus: 'blocked',
              maturityLevel: null,
              additionalFinancingCostEur: 50000,
              missingDataPoints: ['maturity_model', 'decision_forum'],
              createdAt: '2026-10-03T08:00:00.000Z',
            },
          ],
        };
      },
      evaluate: forbidden('investment-maturity-off-balance-gate.evaluate'),
    },
  },
  {
    name: 'reinvest-signal',
    actions: {
      list(ctx) {
        seen(ctx);
        return {
          analyses: [
            {
              _id: 'ris:test-1',
              tenantId: TENANT,
              fotojahr: 2026,
              createdAt: '2026-10-04T08:00:00.000Z',
              summary: {
                signalCount: 1,
                fotojahrQualifiedCount: 1,
                highAregRelevanceCount: 1,
                fotojahrCapexEur: 80000,
              },
              signals: [
                {
                  assetId: ASSET,
                  assetLabel: 'Testtrafo T1 Ortsnetzstation West',
                  eventDate: '2026-03-15',
                  eventType: 'UNPLANNED_OUTAGE',
                  category: 'EMERGENCY_REINVESTMENT',
                  aregRelevance: 'HIGH',
                  reinvestScore: 100,
                  estimatedCapexEur: 80000,
                  qualifiesForFotojahr: true,
                  actionRequired: 'Sofort als CAPEX-Antrag einreichen',
                },
              ],
            },
          ],
        };
      },
      analyze: forbidden('reinvest-signal.analyze'),
    },
  },
  {
    name: 'ghost-asset-alert',
    actions: {
      list(ctx) {
        seen(ctx);
        return {
          scans: [
            {
              _id: 'gaa:test-1',
              tenantId: TENANT,
              createdAt: '2026-10-05T08:00:00.000Z',
              params: { distanceThresholdKm: 2 },
              summary: {
                totalInstallations: 10,
                ghostCount: 1,
                boundaryCount: 0,
                noCoordinatesCount: 2,
              },
              findings: [
                {
                  findingCode: 'GHOST_ASSET_SUSPECTED',
                  mastrNummer: UNIT,
                  distanceKm: 12.5,
                  status: 'OUTSIDE_TERRITORY',
                  severity: 'HIGH',
                  actionRequired: 'VERIFY_PHYSICAL_CONNECTION_POINT',
                },
              ],
            },
          ],
        };
      },
      scan: forbidden('ghost-asset-alert.scan'),
      forwardToEdm: forbidden('ghost-asset-alert.forwardToEdm'),
    },
  },
  {
    name: 'altdaten-assessment',
    actions: {
      // An empty store: the overview reports it as a negative with its scope.
      list(ctx) {
        seen(ctx);
        return { assessments: [] };
      },
      assess: forbidden('altdaten-assessment.assess'),
    },
  },
  {
    name: 'assets',
    actions: {
      async overrides(ctx) {
        seen(ctx);
        // An unref timer, so the slow source does not keep jest alive after the run.
        if (ctx.params.assetId === ASSET_SLOW)
          await new Promise((resolve) => setTimeout(resolve, 5000).unref());
        if (ctx.params.assetId !== ASSET) return { success: true, count: 0, overrides: [] };
        return {
          success: true,
          count: 1,
          overrides: [
            {
              id: 'ovr_test_1',
              assetId: ASSET,
              field: 'Bruttoleistung',
              value: 630,
              previousValue: 400,
              approvalStatus: 'approved',
              createdAt: '2026-09-01T08:00:00.000Z',
            },
          ],
        };
      },
      override: forbidden('assets.override'),
      applyOverride: forbidden('assets.applyOverride'),
    },
  },
];

const expand = (broker, object, { context = {}, budget } = {}) =>
  broker.call(
    'micro-agent.asset.expand',
    { object, context, ...(budget ? { budget } : {}) },
    { meta: { tenantId: TENANT } }
  );

const statements = (finding) => finding.facts.map((fact) => fact.statement).join('\n');

describe('micro-agent pack asset', () => {
  let broker;
  beforeAll(async () => {
    broker = new ServiceBroker({ logger: false, transporter: null });
    for (const stub of stubs) broker.createService(stub);
    broker.createService(require('../services/micro-agent-asset.service'));
    await broker.start();
  });
  afterAll(() => broker.stop());
  afterEach(() => expect(writes).toEqual([]));

  test('describe declares the kinds and the concern', async () => {
    const manifest = await broker.call('micro-agent.asset.describe');
    expect(manifest.expands).toEqual(
      expect.arrayContaining(['asset.equipment', 'asset.investment', 'concern'])
    );
    expect(manifest.concern).toBe(true);
  });

  test('equipment: re-invest signal and override facts with provenance', async () => {
    seenTenants.length = 0;
    const finding = await expand(broker, { kind: 'asset.equipment', value: ASSET });
    expect(statements(finding)).toMatch(/Kategorie EMERGENCY_REINVESTMENT/u);
    expect(statements(finding)).toMatch(/Feld Bruttoleistung = 630/u);
    expect(finding.facts.every((fact) => fact.provenance.source && fact.basis === 'source')).toBe(
      true
    );
    const sources = finding.facts.map((fact) => fact.provenance.source);
    expect(sources).toEqual(expect.arrayContaining(['reinvest-signal.list', 'assets.overrides']));
    const money = finding.facts.find((fact) => fact.role === 'monetary');
    expect(money).toMatchObject({ value: '80000', unit: 'EUR' });
    expect(money.provenance.ref).toMatch(/ris:test-1/u);
    // The ghost scan has no hit for this id: a negative with its scope.
    expect(finding.negatives).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          searched: ASSET,
          scope: expect.stringMatching(/^ghost-asset-alert\.list: 1 gespeicherte/u),
          result: 'no_hit',
        }),
        expect.objectContaining({ result: 'no_source' }),
      ])
    );
    expect(seenTenants.every((tenant) => tenant === TENANT)).toBe(true);
  });

  test('equipment: a label mention matches the stored asset label', async () => {
    const finding = await expand(broker, { kind: 'asset.equipment', value: 'Testtrafo T1' });
    expect(statements(finding)).toMatch(/Re-Invest-Signal für Testtrafo T1/u);
  });

  test('equipment: a MaStR unit from a ghost-asset scan', async () => {
    const finding = await expand(broker, { kind: 'asset.equipment', value: UNIT });
    expect(statements(finding)).toMatch(/GHOST_ASSET_SUSPECTED/u);
    expect(finding.facts.find((fact) => fact.unit === 'km')).toMatchObject({ value: '2' });
  });

  test('equipment without any hit: negatives with scope and an open question', async () => {
    const finding = await expand(broker, { kind: 'asset.equipment', value: 'TEST-UNKNOWN-9' });
    expect(finding.facts).toEqual([]);
    expect(finding.negatives.length).toBeGreaterThanOrEqual(3);
    expect(finding.negatives.every((row) => row.searched && row.scope)).toBe(true);
    expect(finding.openQuestions).toHaveLength(1);
  });

  test('investment: a measure of a plan, its threshold as rule and the relation', async () => {
    const finding = await expand(broker, { kind: 'asset.investment', value: MEASURE });
    expect(statements(finding)).toMatch(/Entscheidungsstatus blocked/u);
    const threshold = finding.facts.find((fact) => fact.basis === 'rule');
    expect(threshold).toMatchObject({
      value: '1000000',
      provenance: {
        source: 'investment-planning.listPlans',
        ref: `Plan ${PLAN_ID}, triggerPolicy`,
      },
    });
    expect(finding.relations).toEqual(
      expect.arrayContaining([
        { from: MEASURE, rel: 'belongs_to', to: `investment-plan:${PLAN_ID}` },
      ])
    );
    // CAPEX prioritization and gates have no record of this measure.
    expect(finding.negatives.map((row) => row.scope.split(':')[0])).toEqual(
      expect.arrayContaining([
        'capex-prioritization.list',
        'investment-maturity-off-balance-gate.listGates',
      ])
    );
  });

  test('investment: a capex measure cites a section, the playbook hands it on', async () => {
    const finding = await expand(broker, { kind: 'asset.investment', value: CAPEX_MEASURE });
    expect(statements(finding)).toMatch(/Klasse REGULATORY_OBLIGATION/u);
    expect(
      finding.facts.some((fact) => fact.provenance.quote === 'Gesetzliche Verpflichtung (Testtext)')
    ).toBe(true);
    const next = await broker.call('micro-agent.asset.plan', {
      finding,
      object: { kind: 'asset.investment', value: CAPEX_MEASURE },
    });
    expect(next).toEqual([expect.objectContaining({ kind: 'reg.section', value: '§ 11 EnWG' })]);
  });

  test('investment: a gate names its plan, the playbook expands the plan', async () => {
    const finding = await expand(broker, { kind: 'asset.investment', value: CASE });
    expect(statements(finding)).toMatch(/Reifegrad-Gate imob:test-1/u);
    expect(finding.openQuestions.length).toBeGreaterThan(0);
    const next = await broker.call('micro-agent.asset.plan', {
      finding,
      object: { kind: 'asset.investment', value: CASE },
    });
    expect(next).toEqual([expect.objectContaining({ kind: 'asset.investment', value: PLAN_ID })]);
  });

  test('a slow source does not throw; the other sources still answer', async () => {
    const finding = await expand(
      broker,
      { kind: 'asset.equipment', value: ASSET_SLOW },
      { budget: { timeoutMs: 1000 } }
    );
    expect(finding.failed).toBeUndefined();
    expect(finding.negatives).toEqual(
      expect.arrayContaining([
        { searched: ASSET_SLOW, scope: 'assets.overrides', result: 'source_unavailable' },
      ])
    );
  });

  test('a budget too short for any read: no throw, every source reported unavailable', async () => {
    const finding = await expand(
      broker,
      { kind: 'asset.investment', value: MEASURE },
      { budget: { timeoutMs: 50 } }
    );
    expect(finding.facts).toEqual([]);
    expect(finding.negatives).toHaveLength(3);
    expect(finding.negatives.every((row) => row.result === 'source_unavailable')).toBe(true);
  });

  test('an unsupported kind is refused', async () => {
    const finding = await expand(broker, { kind: 'billing.invoice', value: 'R-1' });
    expect(finding.skipped).toBe('kind_not_handled');
    expect(finding.facts).toEqual([]);
  });

  test('concern without consequence: identifiers in the question and the area state', async () => {
    const finding = await expand(broker, {
      kind: 'concern',
      value: `Wie steht es um ${MEASURE} und die Reinvestitionen?`,
    });
    const text = statements(finding);
    expect(text).toMatch(new RegExp(`Maßnahme .*\\(${MEASURE}\\)`, 'u'));
    expect(text).toMatch(/1 Investitionspläne gespeichert, davon 1/u);
    expect(text).toMatch(/Re-Invest-Analyse ris:test-1/u);
    expect(text).toMatch(/Ghost-Asset-Scan gaa:test-1/u);
    expect(finding.negatives).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          searched: 'Altdatenbewertungen',
          scope: expect.stringMatching(/^altdaten-assessment\.list/u),
          result: 'no_hit',
        }),
      ])
    );
    expect(finding.relations.some((row) => row.rel === 'affects')).toBe(false);
  });

  test('concern with consequence: a named record is affected, otherwise an open question', async () => {
    const hit = await expand(
      broker,
      { kind: 'concern', value: 'Was folgt daraus?' },
      { context: { consequenceOf: `Mehrkosten betreffen Plan ${PLAN_ID}` } }
    );
    expect(hit.relations).toEqual(
      expect.arrayContaining([
        { from: PLAN_ID, rel: 'affects', to: `Mehrkosten betreffen Plan ${PLAN_ID}` },
      ])
    );
    expect(statements(hit)).toMatch(new RegExp(`Investitionsplan ${PLAN_ID}`, 'u'));

    const miss = await expand(
      broker,
      { kind: 'concern', value: 'Was folgt daraus?' },
      { context: { consequenceOf: 'Höhere Redispatchkosten im Netzgebiet' } }
    );
    expect(miss.relations.filter((row) => row.rel === 'affects')).toEqual([]);
    expect(miss.openQuestions).toHaveLength(1);
    expect(miss.facts.length).toBeGreaterThan(0);
  });
});
