'use strict';

// Pack "netzbetrieb" (micro-agent tier, Phase 1). Every service below is a STUB with synthetic
// test data (tenant "t-test", identifiers marked TEST); no network, no LLM.

const { ServiceBroker } = require('moleculer');
const { MoleculerClientError } = require('moleculer').Errors;
const { packService } = require('../src/micro-agents/pack-service');

const TENANT = 't-test';
const UNIT = 'SSE900000000001';
const uuid = (n) => `00000000-0000-4000-8000-${String(n).padStart(12, '0')}`;
const ID = {
  projection: `rdar-proj:${uuid(1)}`,
  foreignProjection: `rdar-proj:${uuid(2)}`,
  gate: `brs:${uuid(3)}`,
  bess: `bess:${uuid(4)}`,
  special: `rscg:${uuid(5)}`,
  readiness: `rrg:${uuid(6)}`,
  rcsRun: 'run-1767225600000-0a1b2c3d',
};

let data;
let delays;

function syntheticData() {
  return {
    projections: [
      {
        _id: ID.projection,
        tenantId: TENANT,
        mastrId: UNIT,
        technicalResourceId: 'TR-TEST-1',
        maloId: '50000000000',
        capacityKw: 2000,
        hasConflict: false,
        findings: [
          { finding: 'RDAR_TEST', severity: 'warning', message: 'Testbefund Steuergruppe' },
        ],
      },
      { _id: ID.foreignProjection, tenantId: 'other', mastrId: 'SEE900000000009' },
    ],
    relationships: [
      {
        _id: 'rdar-rel:test-1',
        tenantId: TENANT,
        assetIdA: UNIT,
        assetIdB: 'SEE900000000002',
        relationshipType: 'co_location',
      },
    ],
    gates: [
      {
        _id: ID.gate,
        tenantId: TENANT,
        assetId: UNIT,
        bessScreeningId: ID.bess,
        evidenceStatus: 'blocked',
        missingDataPoints: ['meteringConceptId'],
        blockingFindings: [
          { finding: 'BRS_TEST', severity: 'error', message: 'Messkonzept fehlt (Testdaten)' },
        ],
        recommendedNextDecision: 'Testempfehlung',
      },
    ],
    specialRuns: [
      {
        _id: ID.special,
        tenantId: TENANT,
        mastrId: UNIT,
        status: 'blocked',
        periodStart: '2026-01-01',
        periodEnd: '2026-01-31',
        findings: [],
      },
    ],
    readiness: {
      _id: ID.readiness,
      tenantId: TENANT,
      processId: 'TEST-PROZESS',
      status: 'blocked',
      testCallStatus: 'missing',
      productionProofConfirmed: false,
      acceptanceDeadline: '2026-12-31',
      findings: [],
    },
    rcsRun: {
      runId: ID.rcsRun,
      tenantId: TENANT,
      assetId: 'TEST-ASSET',
      status: 'completed',
      ruleSetId: 'test-rules-2026',
    },
    ruleSet: {
      id: 'test-rules-2026',
      version: '1.0.0',
      status: 'active',
      legalStatus: 'entwurf',
      effectiveFrom: '2026-06-01',
      sourceReference: 'Synthetische Testquelle 2026',
    },
  };
}

const notFound = () => {
  throw new MoleculerClientError('not found', 404, 'NOT_FOUND');
};
const later = (name, value) =>
  new Promise((resolve) => setTimeout(() => resolve(value()), delays[name] || 0));

function stub(name, actions) {
  return {
    name,
    actions: Object.fromEntries(
      Object.entries(actions).map(([action, handler]) => [
        action,
        (ctx) => later(`${name}.${action}`, () => handler(ctx)),
      ])
    ),
  };
}

const own = (ctx, rows) => rows.filter((row) => row.tenantId === ctx.meta.tenantId);

const stubs = [
  stub('redispatch-asset-register', {
    listProjections: (ctx) => ({
      projections: own(ctx, data.projections).filter((row) => row.mastrId === ctx.params.mastrId),
    }),
    getProjection: (ctx) => data.projections.find((row) => row._id === ctx.params.id) || notFound(),
    listRelationships: (ctx) => ({
      relationships: own(ctx, data.relationships).filter(
        (row) => row.assetIdA === ctx.params.assetId || row.assetIdB === ctx.params.assetId
      ),
    }),
  }),
  stub('battery-redispatch-special-gate', {
    listGates: (ctx) => ({
      gates: own(ctx, data.gates).filter(
        (row) => !ctx.params.assetId || row.assetId === ctx.params.assetId
      ),
    }),
    getGate: (ctx) =>
      own(ctx, data.gates).find((row) => row._id === ctx.params.gateId) || notFound(),
  }),
  stub('redispatch-special-case-gate', {
    listRuns: (ctx) => ({
      runs: own(ctx, data.specialRuns).filter(
        (row) =>
          (!ctx.params.mastrId || row.mastrId === ctx.params.mastrId) &&
          (!ctx.params.status || row.status === ctx.params.status)
      ),
    }),
    getRun: (ctx) => data.specialRuns.find((row) => row._id === ctx.params.id) || notFound(),
  }),
  stub('redispatch-readiness-gate', {
    getStatus: () =>
      data.readiness
        ? {
            found: true,
            runId: data.readiness._id,
            processId: data.readiness.processId,
            overallStatus: data.readiness.status,
            testCallStatus: data.readiness.testCallStatus,
            productionProofConfirmed: data.readiness.productionProofConfirmed,
            acceptanceDeadline: data.readiness.acceptanceDeadline,
            findings: data.readiness.findings,
          }
        : { found: false },
    listRuns: (ctx) => ({
      runs:
        data.readiness && ctx.params.processId === data.readiness.processId ? [data.readiness] : [],
    }),
    getRun: (ctx) => (data.readiness?._id === ctx.params.id ? data.readiness : notFound()),
  }),
  stub('redispatch-settlement-sandbox', { getScenario: notFound }),
  stub('bess-screening', { get: notFound }),
  stub('flexibilitaetskosten-raster', { get: notFound, list: () => ({ grids: [] }) }),
  stub('flexibility-conductor-role-model', {
    getModel: notFound,
    listModels: () => ({ models: [] }),
  }),
  stub('rcs-simulation-run', {
    getRun: (ctx) => (data.rcsRun?.runId === ctx.params.runId ? data.rcsRun : notFound()),
  }),
  stub('rcs-rule-catalog', {
    getRuleSet: (ctx) => (data.ruleSet.id === ctx.params.ruleSetId ? data.ruleSet : notFound()),
    listRuleSets: () => ({ latestRuleSetId: data.ruleSet.id, items: [data.ruleSet] }),
  }),
];

describe('micro-agent pack netzbetrieb', () => {
  let broker;
  const expand = (object, context = {}, budget) =>
    broker.call(
      'micro-agent.netzbetrieb.expand',
      { object: { objectId: 'O1', ...object }, context, ...(budget ? { budget } : {}) },
      { meta: { tenantId: TENANT } }
    );

  beforeAll(async () => {
    broker = new ServiceBroker({ logger: false, transporter: null });
    broker.createService(packService('netzbetrieb'));
    for (const schema of stubs) broker.createService(schema);
    await broker.start();
  });
  afterAll(() => broker.stop());
  beforeEach(() => {
    data = syntheticData();
    delays = {};
  });

  test('describe lists the expanded kinds and the concern', async () => {
    const manifest = await broker.call('micro-agent.netzbetrieb.describe');
    expect(manifest.expands).toEqual(['flex.asset', 'grid.measure', 'concern']);
    expect(manifest.concern).toBe(true);
  });

  test('a flexible asset by MaStR number: facts with provenance and fixed follow-ups', async () => {
    const finding = await expand({ kind: 'flex.asset', value: `Speicher ${UNIT}` });
    const sources = new Set(finding.facts.map((fact) => fact.provenance.source));
    expect(sources).toEqual(
      new Set([
        'format:registerUnitNumbers',
        'redispatch-asset-register.listProjections',
        'redispatch-asset-register.listRelationships',
        'redispatch-special-case-gate.listRuns',
        'battery-redispatch-special-gate.listGates',
      ])
    );
    expect(finding.facts.every((fact) => fact.provenance.source)).toBe(true);
    expect(finding.facts).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ value: 'TR-TEST-1', role: 'identifier', basis: 'source' }),
        expect.objectContaining({ value: '2000', unit: 'kW', role: 'quantity' }),
        expect.objectContaining({
          value: 'blocked',
          provenance: expect.objectContaining({ ref: ID.gate }),
        }),
        expect.objectContaining({ value: UNIT, basis: 'parsed' }),
      ])
    );
    // The cost grids hold no record for the unit: a negative with its scope.
    expect(finding.negatives).toEqual([
      expect.objectContaining({
        searched: `Flexibilitätskosten-Raster zu ${UNIT}`,
        scope: expect.stringContaining(`Mandant ${TENANT}`),
        result: 'no_hit',
      }),
    ]);
    expect(finding.openQuestions).toEqual([]);

    const next = await broker.call('micro-agent.netzbetrieb.plan', {
      finding,
      object: { kind: 'flex.asset', value: UNIT },
    });
    expect(next.map((row) => `${row.kind}:${row.value}`)).toEqual(
      expect.arrayContaining([
        `plant.register_unit:${UNIT}`,
        'flex.asset:SEE900000000002',
        `flex.asset:${ID.bess}`,
      ])
    );
    expect(next.some((row) => row.value === UNIT && row.kind === 'flex.asset')).toBe(false);
  });

  test('a record of another tenant counts as not found', async () => {
    const finding = await expand({ kind: 'flex.asset', value: ID.foreignProjection });
    expect(finding.facts).toEqual([]);
    expect(finding.negatives).toEqual([
      {
        searched: ID.foreignProjection,
        scope: `redispatch-asset-register, Mandant ${TENANT}`,
        result: 'no_hit',
      },
    ]);
    expect(finding.openQuestions[0].resolves).toBe('flex.asset');
  });

  test('a measure by record identifiers: gate run, RCS run with its rule set', async () => {
    const finding = await expand({
      kind: 'grid.measure',
      value: `${ID.special} und ${ID.rcsRun}`,
    });
    expect(finding.facts).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          value: '2026-01-01 – 2026-01-31',
          role: 'period',
          provenance: expect.objectContaining({ source: 'redispatch-special-case-gate.getRun' }),
        }),
        expect.objectContaining({
          basis: 'rule',
          provenance: {
            source: 'rcs-rule-catalog.getRuleSet',
            ref: 'test-rules-2026',
            quote: 'Synthetische Testquelle 2026',
          },
        }),
      ])
    );
    const next = await broker.call('micro-agent.netzbetrieb.plan', {
      finding,
      object: { kind: 'grid.measure', value: ID.special },
    });
    expect(next.map((row) => `${row.kind}:${row.value}`)).toEqual([`flex.asset:${UNIT}`]);
  });

  test('a measure without identifier and without hit: negative with scope and a question', async () => {
    const finding = await expand({ kind: 'grid.measure', value: 'Abregelung letzte Woche' });
    expect(finding.facts).toEqual([]);
    expect(finding.negatives).toEqual([
      {
        searched: 'Readiness-Bewertungen zum Prozess Abregelung letzte Woche',
        scope: `redispatch-readiness-gate, Mandant ${TENANT}, höchstens 50 Einträge`,
        result: 'no_hit',
      },
    ]);
    expect(finding.openQuestions).toHaveLength(1);
  });

  test('an unsupported kind is refused', async () => {
    const finding = await expand({ kind: 'market.message', value: 'UTILMD' });
    expect(finding.skipped).toBe('kind_not_handled');
    expect(finding.facts).toEqual([]);
  });

  test('a slow source is reported as unavailable, a slow expander as timeout; neither throws', async () => {
    delays['redispatch-asset-register.listProjections'] = 2000;
    const finding = await expand({ kind: 'flex.asset', value: UNIT });
    expect(finding.failed).toBeUndefined();
    expect(finding.negatives).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          searched: `Assetprojektionen zu ${UNIT}`,
          result: 'source_unavailable',
        }),
      ])
    );
    const timedOut = await expand({ kind: 'flex.asset', value: UNIT }, {}, { timeoutMs: 100 });
    expect(timedOut.failed).toBe('timeout');
    expect(timedOut.facts).toEqual([]);
  });

  test('concern: the state of the area with a sourced deadline and the current rule set', async () => {
    const finding = await expand({ kind: 'concern', value: 'Wie steht es um Redispatch?' });
    expect(finding.facts).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          role: 'deadline',
          basis: 'source',
          value: '2026-12-31',
          provenance: expect.objectContaining({ source: 'redispatch-readiness-gate.getStatus' }),
        }),
        expect.objectContaining({
          basis: 'rule',
          provenance: expect.objectContaining({ source: 'rcs-rule-catalog.listRuleSets' }),
        }),
        expect.objectContaining({ role: 'quantity', value: '1' }),
      ])
    );
  });

  test('concern as consequence check: only what blocks, else a negative and a question', async () => {
    const blocking = await expand(
      { kind: 'concern', value: 'Frage' },
      { consequenceOf: 'Messkonzept geändert' }
    );
    expect(blocking.facts.length).toBeGreaterThan(0);
    expect(blocking.facts.some((fact) => fact.basis === 'rule')).toBe(false);

    data.gates = [];
    data.specialRuns = [];
    data.readiness = { ...data.readiness, status: 'ready' };
    const clear = await expand(
      { kind: 'concern', value: 'Frage' },
      { consequenceOf: 'Messkonzept geändert' }
    );
    expect(clear.facts).toEqual([]);
    expect(clear.negatives).toEqual([
      expect.objectContaining({
        searched: 'Blockierende Redispatch- und Flexibilitätsvorgänge',
        scope: expect.stringContaining(`Mandant ${TENANT}`),
      }),
    ]);
    expect(clear.openQuestions).toHaveLength(1);
  });
});
