const path = require('path');
const os = require('os');
const { ServiceBroker } = require('moleculer');
const KnowledgeContinuityGovernanceGateService = require('../services/knowledge-continuity-governance-gate.service');

describe('knowledge-continuity-governance-gate service', () => {
  let broker;

  beforeAll(async () => {
    broker = new ServiceBroker({ logger: false });
    broker.createService({
      ...KnowledgeContinuityGovernanceGateService,
      settings: {
        ...KnowledgeContinuityGovernanceGateService.settings,
        dbPath: path.join(os.tmpdir(), `kcgg-test-db-${Date.now()}`),
      },
    });
    await broker.start();
  });

  afterAll(async () => {
    await broker.stop();
  });

  const meta = { tenantId: 'tenant-a' };

  function readyParams(overrides = {}) {
    return {
      criticalProcessId: 'knowledge-process:dispatch-handover-001',
      processName: 'Redispatch Rollenwechsel Leitwarte',
      mainFolderRef: 'sharepoint://netzprozesse/redispatch/hauptordner',
      permissionOwner: 'IT Berechtigungsmanagement',
      adminOwner: 'M365 Plattformbetrieb',
      guestAccessPolicy: 'Gastzugriffe quartalsweise pruefen',
      handoverDocumentRef: 'sharepoint://netzprozesse/redispatch/uebergabe.md',
      chatMailBoundary: 'Teams ist volatil; Beschluesse muessen in den Hauptordner',
      retentionPolicy: '10 Jahre fuer wissenskritische Prozessnachweise',
      deletionDeadline: '2036-12-31',
      itApprovalStatus: 'approved',
      roleChangeRisk: 'medium',
      blockedCapabilities: [],
      evidenceRefs: ['vdmi-evidence:main-folder', 'vdmi-evidence:handover'],
      sourceActions: [
        'vdmi.create',
        'vdmi-evidence.inject',
        'interface-placeholder.list',
        'hitl.create',
        'presentation.generate',
      ],
      ...overrides,
    };
  }

  test('evaluate stores a ready governance-gate evidence record without control execution', async () => {
    const result = await broker.call('knowledge-continuity-governance-gate.evaluate', readyParams(), {
      meta,
    });

    expect(result.governanceGateId).toMatch(/^kcgg:/);
    expect(result.evidenceStatus).toBe('ready');
    expect(result.validationFindings.some((f) => f.finding === 'KCGG_GOVERNANCE_GATE_READY')).toBe(true);
    expect(result.sourceActions).toContain('vdmi.create');
    expect(result.forbiddenAutomaticActions).toEqual(
      expect.arrayContaining(['permission-mutation', 'retention-policy-change', 'hitl-approval'])
    );
  });

  test('evaluate blocks when owners, durable boundary and retention evidence are missing', async () => {
    const result = await broker.call(
      'knowledge-continuity-governance-gate.evaluate',
      readyParams({
        criticalProcessId: 'knowledge-process:blocked-001',
        mainFolderRef: '',
        permissionOwner: '',
        adminOwner: '',
        handoverDocumentRef: '',
        chatMailBoundary: '',
        retentionPolicy: '',
        itApprovalStatus: '',
        sourceActions: [],
      }),
      { meta }
    );

    expect(result.evidenceStatus).toBe('blocked');
    expect(result.blockingFindings.map((f) => f.finding)).toEqual(
      expect.arrayContaining([
        'KCGG_DECISION_RIGHTS_MISSING',
        'KCGG_CONTROL_BOUNDARY_MISSING',
        'KCGG_ESCALATION_PATH_MISSING',
        'KCGG_GOVERNANCE_GATE_BLOCKED',
      ])
    );
    expect(result.missingDataPoints).toEqual(
      expect.arrayContaining([
        'mainFolderRef',
        'permissionOwner',
        'adminOwner',
        'handoverDocumentRef',
        'chatMailBoundary',
        'retentionPolicy',
        'itApprovalStatus',
        'source_action_references',
      ])
    );
    expect(result.positiveFollowUps).toContainEqual({
      missingDataPoint: 'permissionOwner',
      enablesDossierAddition: 'adds accountable permission owner and escalation path',
    });
  });

  test('listGates, getGate and getStatus expose tenant-scoped dossier-safe evidence', async () => {
    const created = await broker.call(
      'knowledge-continuity-governance-gate.evaluate',
      readyParams({ criticalProcessId: 'knowledge-process:status-001' }),
      { meta }
    );

    const list = await broker.call(
      'knowledge-continuity-governance-gate.listGates',
      { criticalProcessId: 'knowledge-process:status-001' },
      { meta }
    );
    expect(list.gates.some((gate) => gate._id === created.governanceGateId)).toBe(true);

    const gate = await broker.call(
      'knowledge-continuity-governance-gate.getGate',
      { governanceGateId: created.governanceGateId },
      { meta }
    );
    expect(gate.criticalProcessId).toBe('knowledge-process:status-001');

    const status = await broker.call(
      'knowledge-continuity-governance-gate.getStatus',
      { processId: 'knowledge-process:status-001' },
      { meta }
    );
    expect(status.found).toBe(true);
    expect(status.answerFacts.permissionOwner).toBe('IT Berechtigungsmanagement');
    expect(status.answerFacts.adminOwner).toBe('M365 Plattformbetrieb');
    expect(status.sourceActions).toContain('vdmi.create');
    expect(status.forbiddenAutomaticActions).toContain('external-collaboration-sync');
  });

  test('getStatus returns dossier-safe not-found state', async () => {
    const status = await broker.call(
      'knowledge-continuity-governance-gate.getStatus',
      { processId: 'knowledge-process:missing' },
      { meta }
    );

    expect(status).toEqual({
      found: false,
      criticalProcessId: 'knowledge-process:missing',
      message: 'No knowledge-continuity governance evidence is available for this tenant yet',
    });
  });

  test('getGate hides governance gates from other tenants', async () => {
    const created = await broker.call(
      'knowledge-continuity-governance-gate.evaluate',
      readyParams({ criticalProcessId: 'knowledge-process:tenant-secret' }),
      { meta }
    );

    await expect(
      broker.call(
        'knowledge-continuity-governance-gate.getGate',
        { governanceGateId: created.governanceGateId },
        { meta: { tenantId: 'tenant-b' } }
      )
    ).rejects.toMatchObject({ code: 404, type: 'GOVERNANCE_GATE_NOT_FOUND' });
  });
});
