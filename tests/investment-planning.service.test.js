const path = require('path');
const os = require('os');
const { ServiceBroker } = require('moleculer');
const InvestmentPlanningService = require('../services/investment-planning.service');

describe('investment-planning service', () => {
  let broker;
  const placeholderGaps = [];
  const hitlItems = [];
  const vdmiMatrices = [];
  const redispatchAudits = [];

  beforeAll(async () => {
    broker = new ServiceBroker({ logger: false });

    broker.createService({
      ...InvestmentPlanningService,
      settings: {
        ...InvestmentPlanningService.settings,
        dbPath: path.join(os.tmpdir(), `investment-planning-test-${Date.now()}`),
      },
    });

    broker.createService({
      name: 'redispatch-expost',
      actions: {
        list: {
          handler(ctx) {
            const gridOperatorId = ctx.params.gridOperatorId;
            const filtered = gridOperatorId
              ? redispatchAudits.filter((audit) => audit.gridOperator?.mastrId === gridOperatorId)
              : redispatchAudits;
            return { audits: filtered };
          },
        },
        get: {
          handler(ctx) {
            const found = redispatchAudits.find((audit) => audit.id === ctx.params.id);
            if (!found) {
              return { success: false };
            }
            return { success: true, ...found };
          },
        },
      },
    });

    broker.createService({
      name: 'vdmi',
      actions: {
        list: {
          handler() {
            return { success: true, items: vdmiMatrices };
          },
        },
      },
    });

    broker.createService({
      name: 'hitl',
      actions: {
        create: {
          handler(ctx) {
            const item = {
              id: `hitl-${hitlItems.length + 1}`,
              kind: ctx.params.kind,
              payload: ctx.params.payload,
            };
            hitlItems.push(item);
            return { success: true, item };
          },
        },
      },
    });

    broker.createService({
      name: 'interface-placeholder',
      actions: {
        listGaps: {
          handler() {
            return { placeholders: [...placeholderGaps] };
          },
        },
        markGap: {
          handler(ctx) {
            const placeholder = {
              placeholderId: `ph-${placeholderGaps.length + 1}`,
              status: 'placeholder_gap',
              blockingLevel: ctx.params.blockingLevel,
              placeholderGapKey: ctx.params.placeholderGapKey,
              requiredResolverRoles: ctx.params.requiredResolverRoles,
            };
            placeholderGaps.push(placeholder);
            return { success: true, placeholder };
          },
        },
      },
    });

    await broker.start();
  });

  beforeEach(() => {
    placeholderGaps.length = 0;
    hitlItems.length = 0;
    vdmiMatrices.length = 0;
    redispatchAudits.length = 0;
  });

  afterAll(async () => {
    await broker.stop();
  });

  it('creates plan with hybrid baseline provenance and Soll-Ist result', async () => {
    redispatchAudits.push({
      id: 'rd-1',
      gridOperator: { mastrId: 'SNB1' },
      riskAssessment: { estimatedLostCompensationEur: 900000 },
    });
    vdmiMatrices.push({
      tasks: [
        {
          verantwortlich: [{ actorId: 'ROLE_KAUFMAENNISCHE_LEITUNG' }],
          durchfuehrend: [{ actorId: 'ROLE_NETZPLANUNG' }],
          mitwirkend: [],
          information: [],
        },
      ],
    });

    const result = await broker.call('investment-planning.createPlan', {
      gridOperatorId: 'SNB1',
      redispatchTargetEur: 1000000,
      financeBudgetEur: 1100000,
      measures: [{ measureId: 'm1', capexEur: 500000, avoidedCostsEur: 200000 }],
    });

    expect(result.success).toBe(true);
    expect(result.portfolio.weg).toBe('hybrid_baseline_v1');
    expect(result.portfolio.provenanceFlags.map((item) => item.provenance)).toEqual(
      expect.arrayContaining(['redispatch_target', 'finance_budget'])
    );
    expect(result.planVsActual.sollEur).toBe(1050000);
    expect(result.planVsActual.istEur).toBe(900000);
    expect(result.decisionStatus).toBe('ready');
  });

  it('creates interface placeholders when mandate roles are missing', async () => {
    redispatchAudits.push({
      id: 'rd-2',
      gridOperator: { mastrId: 'SNB2' },
      riskAssessment: { estimatedLostCompensationEur: 1200000 },
    });

    const result = await broker.call('investment-planning.createPlan', {
      gridOperatorId: 'SNB2',
      redispatchTargetEur: 1100000,
      financeBudgetEur: 1000000,
      measures: [],
    });

    expect(result.decisionStatus).toBe('blocked');
    expect(result.governance.roleGaps.length).toBeGreaterThan(0);
    expect(result.governance.roleGaps[0].blockingLevel).toBe('hard');
  });

  it('fires HITL trigger only for measures greater than 1M EUR', async () => {
    redispatchAudits.push({
      id: 'rd-3',
      gridOperator: { mastrId: 'SNB3' },
      riskAssessment: { estimatedLostCompensationEur: 600000 },
    });
    vdmiMatrices.push({
      tasks: [
        {
          verantwortlich: [{ actorId: 'ROLE_KAUFMAENNISCHE_LEITUNG' }],
          durchfuehrend: [{ actorId: 'ROLE_NETZPLANUNG' }],
          mitwirkend: [],
          information: [],
        },
      ],
    });

    const result = await broker.call('investment-planning.createPlan', {
      gridOperatorId: 'SNB3',
      redispatchTargetEur: 700000,
      financeBudgetEur: 650000,
      measures: [
        { measureId: 'below', capexEur: 1000000, avoidedCostsEur: 0 },
        { measureId: 'above', capexEur: 1000001, avoidedCostsEur: 0 },
      ],
    });

    expect(result.triggeredMeasures).toHaveLength(1);
    expect(result.triggeredMeasures[0].measureId).toBe('above');
    expect(result.hitlItems).toHaveLength(1);
    expect(result.hitlItems[0].kind).toBe('investment-shift-over-1m');
  });

  it('enforces tenant isolation for get/list', async () => {
    redispatchAudits.push({
      id: 'rd-4',
      gridOperator: { mastrId: 'SNB4' },
      riskAssessment: { estimatedLostCompensationEur: 500000 },
    });
    vdmiMatrices.push({
      tasks: [
        {
          verantwortlich: [{ actorId: 'ROLE_KAUFMAENNISCHE_LEITUNG' }],
          durchfuehrend: [{ actorId: 'ROLE_NETZPLANUNG' }],
          mitwirkend: [],
          information: [],
        },
      ],
    });

    const created = await broker.call(
      'investment-planning.createPlan',
      {
        gridOperatorId: 'SNB4',
        redispatchTargetEur: 600000,
        financeBudgetEur: 650000,
      },
      { meta: { tenantId: 'tenant-a' } }
    );

    const listA = await broker.call(
      'investment-planning.listPlans',
      {},
      { meta: { tenantId: 'tenant-a' } }
    );
    expect(listA.count).toBe(1);

    const listB = await broker.call(
      'investment-planning.listPlans',
      {},
      { meta: { tenantId: 'tenant-b' } }
    );
    expect(listB.count).toBe(0);

    await expect(
      broker.call(
        'investment-planning.getPlan',
        { id: created.id },
        { meta: { tenantId: 'tenant-b' } }
      )
    ).rejects.toMatchObject({ code: 404, type: 'INVESTMENT_PLAN_NOT_FOUND' });
  });
});
