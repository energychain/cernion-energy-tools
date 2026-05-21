const path = require('path');
const os = require('os');
const { ServiceBroker } = require('moleculer');
const BlindflugRadarService = require('../services/blindflug-radar.service');

describe('blindflug-radar service', () => {
  let broker;
  const redispatchAudits = [];
  const mastrWatches = [];
  const mastrDeltasByWatch = new Map();
  const qualityAudits = [];
  const znpProjects = [];
  const hitlItems = [];
  const placeholderGaps = [];

  beforeAll(async () => {
    broker = new ServiceBroker({ logger: false });

    broker.createService({
      ...BlindflugRadarService,
      settings: {
        ...BlindflugRadarService.settings,
        dbPath: path.join(os.tmpdir(), `blindflug-radar-test-${Date.now()}`),
      },
    });

    broker.createService({
      name: 'redispatch-expost',
      actions: {
        list: {
          handler(ctx) {
            if (!ctx.params.gridOperatorId) return { audits: [...redispatchAudits] };
            return {
              audits: redispatchAudits.filter(
                (audit) => audit.gridOperator?.mastrId === ctx.params.gridOperatorId
              ),
            };
          },
        },
      },
    });

    broker.createService({
      name: 'mastr-monitor',
      actions: {
        listWatches: {
          handler() {
            return { watches: [...mastrWatches] };
          },
        },
        getDeltas: {
          handler(ctx) {
            return { deltas: [...(mastrDeltasByWatch.get(ctx.params.watchId) || [])] };
          },
        },
      },
    });

    broker.createService({
      name: 'mastr-quality',
      actions: {
        list: {
          handler(ctx) {
            if (!ctx.params.gridOperatorId) return { audits: [...qualityAudits] };
            return {
              audits: qualityAudits.filter(
                (audit) => audit.gridOperator?.mastrId === ctx.params.gridOperatorId
              ),
            };
          },
        },
      },
    });

    broker.createService({
      name: 'znp',
      actions: {
        listProjects: {
          handler() {
            return { projects: [...znpProjects] };
          },
        },
        assessPortfolio: {
          handler(ctx) {
            return {
              decisionStatus: 'ready',
              overallScore: 0.81,
              portfolio: { weg: 'hybrid_layered_v1' },
              governance: { hardBlockers: [] },
              projectId: ctx.params.projectId,
            };
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
    redispatchAudits.length = 0;
    mastrWatches.length = 0;
    mastrDeltasByWatch.clear();
    qualityAudits.length = 0;
    znpProjects.length = 0;
    hitlItems.length = 0;
    placeholderGaps.length = 0;
  });

  afterAll(async () => {
    await broker.stop();
  });

  it('creates signals and confidence-threshold proposals from Redispatch+MaStR+findings', async () => {
    znpProjects.push({ projectId: 'proj-1' });
    redispatchAudits.push(
      {
        id: 'rd-1',
        createdAt: '2026-03-01T00:00:00.000Z',
        gridOperator: { mastrId: 'SNB1', name: 'Grid One' },
        riskAssessment: { riskLevel: 'high', estimatedLostCompensationEur: 1800000 },
        settlementReadiness: { readinessPercent: 61 },
      },
      {
        id: 'rd-2',
        createdAt: '2026-03-20T00:00:00.000Z',
        gridOperator: { mastrId: 'SNB1', name: 'Grid One' },
        riskAssessment: { riskLevel: 'high', estimatedLostCompensationEur: 1700000 },
        settlementReadiness: { readinessPercent: 63 },
      },
      {
        id: 'rd-3',
        createdAt: '2026-04-10T00:00:00.000Z',
        gridOperator: { mastrId: 'SNB1', name: 'Grid One' },
        riskAssessment: { riskLevel: 'high', estimatedLostCompensationEur: 1900000 },
        settlementReadiness: { readinessPercent: 60 },
      }
    );

    mastrWatches.push({ watchId: 'watch-1', name: 'Nord' });
    mastrDeltasByWatch.set('watch-1', [
      {
        timestamp: '2026-03-15T00:00:00.000Z',
        summary: { added: 1, changed: 5, removed: 1 },
      },
      {
        timestamp: '2026-04-18T00:00:00.000Z',
        summary: { added: 0, changed: 4, removed: 2 },
      },
      {
        timestamp: '2026-04-29T00:00:00.000Z',
        summary: { added: 0, changed: 3, removed: 1 },
      },
    ]);

    qualityAudits.push(
      {
        id: 'mq-1',
        createdAt: '2026-03-12T00:00:00.000Z',
        gridOperator: { mastrId: 'SNB1', name: 'Grid One' },
        qualityScore: 71,
        findingsCount: { info: 2, warning: 4, error: 1 },
      },
      {
        id: 'mq-2',
        createdAt: '2026-04-11T00:00:00.000Z',
        gridOperator: { mastrId: 'SNB1', name: 'Grid One' },
        qualityScore: 70,
        findingsCount: { info: 2, warning: 3, error: 2 },
      },
      {
        id: 'mq-3',
        createdAt: '2026-04-27T00:00:00.000Z',
        gridOperator: { mastrId: 'SNB1', name: 'Grid One' },
        qualityScore: 68,
        findingsCount: { info: 1, warning: 2, error: 1 },
      }
    );

    const result = await broker.call('blindflug-radar.scanBlindflug', {
      gridOperatorId: 'SNB1',
      projectId: 'proj-1',
      watchIds: ['watch-1'],
      minEvents: 3,
      timeWindowDays: 120,
      confidenceThreshold: 0.7,
    });

    expect(result.success).toBe(true);
    expect(result.signals.length).toBeGreaterThan(0);
    expect(result.proposals.length).toBeGreaterThan(0);
    expect(result.proposals.some((proposal) => proposal.autoProposal)).toBe(true);
    expect(result.znpContext.projectId).toBe('proj-1');
    expect(result.decisionStatus).toBe('ready');
  });

  it('creates evidence placeholder when there are no disturbance events', async () => {
    const result = await broker.call('blindflug-radar.scanBlindflug', {
      gridOperatorId: 'SNB-EMPTY',
      minEvents: 3,
      timeWindowDays: 90,
    });

    expect(result.success).toBe(true);
    expect(result.signals).toHaveLength(0);
    expect(result.placeholders.length).toBeGreaterThan(0);
    expect(result.decisionStatus).toBe('blocked');
  });

  it('enforces tenant isolation for get/list actions', async () => {
    redispatchAudits.push({
      id: 'rd-tenant',
      createdAt: '2026-03-01T00:00:00.000Z',
      gridOperator: { mastrId: 'SNB-TENANT', name: 'Tenant Grid' },
      riskAssessment: { riskLevel: 'high', estimatedLostCompensationEur: 1200000 },
      settlementReadiness: { readinessPercent: 62 },
    });

    const created = await broker.call(
      'blindflug-radar.scanBlindflug',
      {
        gridOperatorId: 'SNB-TENANT',
        minEvents: 2,
      },
      { meta: { tenantId: 'tenant-a' } }
    );

    const listA = await broker.call(
      'blindflug-radar.listScans',
      {},
      { meta: { tenantId: 'tenant-a' } }
    );
    expect(listA.count).toBe(1);

    const listB = await broker.call(
      'blindflug-radar.listScans',
      {},
      { meta: { tenantId: 'tenant-b' } }
    );
    expect(listB.count).toBe(0);

    await expect(
      broker.call('blindflug-radar.getScan', { id: created.id }, { meta: { tenantId: 'tenant-b' } })
    ).rejects.toMatchObject({ code: 404, type: 'BLINDFLUG_SCAN_NOT_FOUND' });
  });

  it('supports recommendation retrieval from latest scan with confidence filter', async () => {
    redispatchAudits.push(
      {
        id: 'rd-latest-1',
        createdAt: '2026-03-01T00:00:00.000Z',
        gridOperator: { mastrId: 'SNB2', name: 'Grid Two' },
        riskAssessment: { riskLevel: 'high', estimatedLostCompensationEur: 1300000 },
      },
      {
        id: 'rd-latest-2',
        createdAt: '2026-03-15T00:00:00.000Z',
        gridOperator: { mastrId: 'SNB2', name: 'Grid Two' },
        riskAssessment: { riskLevel: 'high', estimatedLostCompensationEur: 1400000 },
      },
      {
        id: 'rd-latest-3',
        createdAt: '2026-04-01T00:00:00.000Z',
        gridOperator: { mastrId: 'SNB2', name: 'Grid Two' },
        riskAssessment: { riskLevel: 'high', estimatedLostCompensationEur: 1500000 },
      }
    );

    const created = await broker.call('blindflug-radar.scanBlindflug', {
      gridOperatorId: 'SNB2',
      minEvents: 3,
      confidenceThreshold: 0.75,
    });

    const rec = await broker.call('blindflug-radar.recommendFromDisturbances', {
      scanId: created.id,
      confidenceThreshold: 0.8,
    });

    expect(rec.success).toBe(true);
    expect(rec.sourceScanId).toBe(created.id);
    expect(Array.isArray(rec.proposals)).toBe(true);
    expect(rec.autoProposedCount).toBe(rec.proposals.filter((item) => item.autoProposal).length);
  });
});
