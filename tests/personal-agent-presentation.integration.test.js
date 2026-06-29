'use strict';

const fs = require('fs');
const os = require('os');
const path = require('path');
const { ServiceBroker } = require('moleculer');
const ObjectStoreService = require('../services/object-store.service');
const PresentationService = require('../services/presentation.service');
const PersonalAgentService = require('../services/personal-agent.service');
const triwoFixture = require('./fixtures/presentation/triwo-vdmi-decision.fixture');
const pvKpiFixture = require('./fixtures/presentation/pv-wiesloch-kpi.fixture');
const comparisonFixture = require('./fixtures/presentation/vnb-benchmark-comparison.fixture');
const bessDdFixture = require('./fixtures/presentation/bess-financier-due-diligence.fixture');

describe('personal-agent presentation integration (Prompt 6)', () => {
  let broker;
  let objectStorePath;
  let svc;
  let originalHandleExecutionWithOnboarding;

  const deterministicPlan = {
    status: 'ready',
    source: 'test',
    routeKey: 'vdmi_grid_connection_decision_governance',
    routeLabel: 'vdmi_grid_connection_decision_governance',
    primaryIntent: 'vdmi_grid_connection_decision_governance',
    secondaryIntents: [],
    requestedDomains: ['grid-connection'],
    unsupportedDomains: [],
    warnings: [],
    steps: [
      {
        step: 1,
        action: 'vdmi.dossier',
        source: 'test',
      },
    ],
  };

  beforeEach(async () => {
    objectStorePath = path.join(os.tmpdir(), `pa-pres-v2-${Date.now()}-${Math.random()}`);
    broker = new ServiceBroker({ logger: false });

    broker.createService({
      ...ObjectStoreService,
      settings: {
        ...ObjectStoreService.settings,
        dbPath: objectStorePath,
      },
    });

    broker.createService(PresentationService);

    // lightweight broker for deterministic planning
    broker.createService({
      name: 'capability-broker',
      actions: {
        recommend: {
          handler() {
            return {
              recommendation: 'test',
              capabilities: [],
            };
          },
        },
      },
    });

    broker.createService(PersonalAgentService);
    await broker.start();
    svc = broker.getLocalService('personal-agent');
    originalHandleExecutionWithOnboarding = svc.handleExecutionWithOnboarding;
  });

  afterEach(async () => {
    if (svc && originalHandleExecutionWithOnboarding) {
      svc.handleExecutionWithOnboarding = originalHandleExecutionWithOnboarding;
    }
    await broker.stop();
    fs.rmSync(objectStorePath, { recursive: true, force: true });
  });

  function setExecutionResult(execution) {
    svc.handleExecutionWithOnboarding = async () => execution;
  }

  test('PA-PRES-01: completed VDMI execution applies presentation markdown to reply', async () => {
    const execution = {
      status: 'completed',
      plan: deterministicPlan,
      steps: [
        {
          action: 'vdmi.dossier',
          result: {
            matrixId: 'matrix-triwo-001',
            taskId: 'triwo-04-network-operator-decision',
            dossier: {
              task: {
                taskId: 'triwo-04-network-operator-decision',
                taskName: 'Network Operator Decision',
                verantwortlich: [{ actorId: 'DSO_GATEKEEPER' }],
                durchfuehrend: [{ actorId: 'EXISTING_AREAL_GRID_OPERATOR' }],
                mitwirkend: [{ actorId: 'GROUP_ENERGY_PROJECT_OWNER' }],
                information: [{ actorId: 'AREAL_OWNER' }],
              },
              evidenceGaps: [{ id: 'formal-request', label: 'Vollständiger §17-Antrag' }],
              forbiddenAssumptions: ['Keine belastbare Anschlusszusage ohne formalen Antrag'],
              nextActions: [{ id: 'na-1', label: 'Formalen Antrag einreichen' }],
            },
          },
        },
      ],
      stopPoint: null,
    };
    setExecutionResult(execution);

    let presentationRenderCalls = 0;
    const originalCall = broker.call.bind(broker);
    broker.call = async (actionName, params, opts) => {
      if (actionName === 'presentation.render') {
        presentationRenderCalls += 1;
      }
      return originalCall(actionName, params, opts);
    };

    try {
      const result = await broker.call(
        'personal-agent.chat',
        { message: 'VDMI Decision?', executionMode: 'auto', chatMode: 'execution' },
        { meta: { tenantId: 'tenant-pa-pres-01', authUser: { userId: 'user-1' } } }
      );

      expect(result.success).toBe(true);
      expect(presentationRenderCalls).toBeGreaterThan(0);
      expect(result.presentationApplied).toBe(true);
      expect(result.presentationType).toBe('vdmi_matrix_table');
      expect(result.presentationGrounding.allowedTypes).toContain('vdmi_matrix_table');
      expect(result.presentationGrounding.blockedReason).toBeNull();
      expect(result.reply).toBe(result.presentation.markdown);
      expect(result.reply).toContain(
        '| Beschreibung des Schrittes | Verantwortlich | Durchführend | Mitwirkend | Informiert |'
      );
      expect(result.reply).toContain('Network Operator Decision');
      expect(result.reply).not.toContain('Plan abgeschlossen:');
    } finally {
      broker.call = originalCall;
    }
  });

  test('PA-PRES-02: completed KPI execution applies kpi_fact presentation', async () => {
    setExecutionResult({
      status: 'completed',
      plan: {
        ...deterministicPlan,
        routeKey: 'asset_count_query',
        routeLabel: 'asset_count_query',
        primaryIntent: 'asset_count_query',
      },
      steps: [
        {
          action: 'mock.kpi',
          result: {
            count: 312,
            unit: 'Anlagen',
            answer: '312',
            source: 'Marktstammdatenregister (MaStR)',
            asOf: '2026-05-18',
          },
        },
      ],
      stopPoint: null,
    });

    const result = await broker.call(
      'personal-agent.chat',
      { message: 'Wie viele PV-Anlagen?', executionMode: 'auto', chatMode: 'execution' },
      { meta: { tenantId: 'tenant-pa-pres-02', authUser: { userId: 'user-1' } } }
    );

    expect(result.success).toBe(true);
    expect(result.presentationApplied).toBe(true);
    expect(result.presentationType).toBe('kpi_fact');
    expect(result.presentationGrounding.allowedTypes).toContain('kpi_fact');
    expect(result.reply).toBe(result.presentation.markdown);
    expect(result.reply).toContain('| Feld | Wert |');
  });

  test('PA-PRES-02b: capability hint cannot force ungrounded VDMI renderer', async () => {
    setExecutionResult({
      status: 'completed',
      plan: deterministicPlan,
      steps: [
        {
          action: 'mock.kpi',
          result: {
            count: 3,
            unit: 'Nachweise',
            source: 'mock.kpi',
            asOf: '2026-06-19',
          },
        },
      ],
      stopPoint: null,
    });

    const result = await broker.call(
      'personal-agent.chat',
      { message: 'VDMI Decision?', executionMode: 'auto', chatMode: 'execution' },
      { meta: { tenantId: 'tenant-pa-pres-02b', authUser: { userId: 'user-1' } } }
    );

    expect(result.success).toBe(true);
    expect(result.presentationApplied).toBe(true);
    expect(result.presentationType).toBe('kpi_fact');
    expect(result.presentationGrounding.blockedReason).toBe(
      'requested_renderer_not_grounded:vdmi_matrix_table'
    );
    expect(result.presentationGrounding.sourceActions).toContain('mock.kpi');
    expect(result.presentationGrounding.allowedTypes).not.toContain('vdmi_matrix_table');
    expect(result.presentation.warnings).toContain(
      'presentation_grounding_blocked:vdmi_matrix_table'
    );
  });

  test('PA-PRES-03: presentation failure is non-blocking and falls back', async () => {
    setExecutionResult({
      status: 'completed',
      plan: deterministicPlan,
      steps: [
        {
          action: 'mock.vdmi',
          result: {
            matrix: {
              tasks: [
                {
                  taskName: 'Task',
                  verantwortlich: ['V'],
                  durchfuehrend: ['D'],
                  mitwirkend: ['M'],
                  information: ['I'],
                },
              ],
            },
          },
        },
      ],
      stopPoint: null,
    });

    const originalCall = broker.call.bind(broker);
    broker.call = async (actionName, params, opts) => {
      if (actionName === 'presentation.render') {
        throw new Error('simulated_render_failure');
      }
      return originalCall(actionName, params, opts);
    };

    try {
      const result = await broker.call(
        'personal-agent.chat',
        { message: 'Render with failure', executionMode: 'auto', chatMode: 'execution' },
        { meta: { tenantId: 'tenant-pa-pres-03', authUser: { userId: 'user-1' } } }
      );

      expect(result.success).toBe(true);
      expect(result.presentationApplied).toBe(false);
      expect(result.presentationType).toBeNull();
      expect(result.presentation).toBeNull();
      expect(result.reply).toContain('Plan abgeschlossen:');
    } finally {
      broker.call = originalCall;
    }
  });

  test('PA-PRES-04: plain text-only execution does not force presentation rendering', async () => {
    setExecutionResult({
      status: 'completed',
      plan: deterministicPlan,
      steps: [
        {
          action: 'mock.text',
          result: {
            summary: 'Nur textuell',
            note: 'kein strukturiertes Feld',
          },
        },
      ],
      stopPoint: null,
    });

    let presentationRenderCalls = 0;
    const originalCall = broker.call.bind(broker);
    broker.call = async (actionName, params, opts) => {
      if (actionName === 'presentation.render') {
        presentationRenderCalls += 1;
      }
      return originalCall(actionName, params, opts);
    };

    try {
      const result = await broker.call(
        'personal-agent.chat',
        { message: 'Plain text execution', executionMode: 'auto', chatMode: 'execution' },
        { meta: { tenantId: 'tenant-pa-pres-04', authUser: { userId: 'user-1' } } }
      );

      expect(result.success).toBe(true);
      expect(presentationRenderCalls).toBe(0);
      expect(result.presentationApplied).toBe(false);
      expect(result.presentationType).toBeNull();
      expect(result.presentation).toBeNull();
    } finally {
      broker.call = originalCall;
    }
  });

  test('PA-PRES-05/06: metadata passthrough and backward-compatible fields exist', async () => {
    setExecutionResult({
      status: 'completed',
      plan: deterministicPlan,
      steps: [
        {
          action: 'mock.vdmi',
          result: {
            matrix: {
              tasks: [
                {
                  taskName: 'Task Metadata',
                  verantwortlich: ['V'],
                  durchfuehrend: ['D'],
                  mitwirkend: ['M'],
                  information: ['I'],
                },
              ],
            },
          },
        },
      ],
      stopPoint: null,
    });

    const result = await broker.call(
      'personal-agent.chat',
      { message: 'Metadata test', executionMode: 'auto', chatMode: 'execution' },
      { meta: { tenantId: 'tenant-pa-pres-05', authUser: { userId: 'user-1' } } }
    );

    expect(result.success).toBe(true);
    expect(result.presentationApplied).toBe(true);
    expect(result.presentationType).toBe(result.presentation.type);
    expect(result.presentation).toHaveProperty('type');
    expect(result.presentation).toHaveProperty('markdown');
    expect(result.presentation).toHaveProperty('warnings');
    expect(Array.isArray(result.presentation.warnings)).toBe(true);

    expect(result).toHaveProperty('routing');
    expect(result).toHaveProperty('plan');
    expect(result).toHaveProperty('execution');
    expect(result).toHaveProperty('reply');
  });

  test('PA-PRES-07: session persistence keeps L4 guardrails (no raw execution/presentation payload)', async () => {
    setExecutionResult({
      status: 'completed',
      plan: deterministicPlan,
      steps: [
        {
          action: 'mock.vdmi',
          result: {
            matrix: {
              tasks: [
                {
                  taskName: 'Task Persist',
                  verantwortlich: ['V'],
                  durchfuehrend: ['D'],
                  mitwirkend: ['M'],
                  information: ['I'],
                },
              ],
            },
            responseRaw: {
              huge: 'payload-that-must-not-be-persisted-as-l4',
            },
          },
        },
      ],
      stopPoint: null,
    });

    const result = await broker.call(
      'personal-agent.chat',
      { message: 'Persist test', executionMode: 'auto', chatMode: 'execution' },
      { meta: { tenantId: 'tenant-pa-pres-07', authUser: { userId: 'user-1' } } }
    );

    expect(result.success).toBe(true);
    const session = await broker.call(
      'personal-agent.getSession',
      { sessionId: result.sessionId },
      { meta: { tenantId: 'tenant-pa-pres-07', authUser: { userId: 'user-1' } } }
    );

    expect(session.success).toBe(true);
    expect(session).not.toHaveProperty('presentation');
    expect(session.l3).not.toHaveProperty('presentation');

    const persistedDump = JSON.stringify(session);
    expect(persistedDump).not.toMatch(/"responseRaw"/);
    expect(persistedDump).not.toMatch(/payload-that-must-not-be-persisted-as-l4/);
  });

  test('PA-PRES-TRIWO-01: completed Triwo execution returns vdmi_matrix_table markdown as final reply', async () => {
    setExecutionResult({
      status: 'completed',
      plan: deterministicPlan,
      steps: [
        {
          action: 'vdmi.dossier',
          result: triwoFixture.domainResult,
        },
      ],
      stopPoint: null,
    });

    const result = await broker.call(
      'personal-agent.chat',
      {
        message: 'Zeige #Triwo Step 3 als Human View',
        executionMode: 'auto',
        chatMode: 'execution',
      },
      { meta: { tenantId: 'tenant-pa-pres-triwo-01', authUser: { userId: 'user-1' } } }
    );

    expect(result.success).toBe(true);
    expect(result.presentationApplied).toBe(true);
    expect(result.presentationType).toBe('vdmi_matrix_table');
    expect(result.reply).toBe(result.presentation.markdown);
    expect(result.reply).toContain(
      '| Beschreibung des Schrittes | Verantwortlich | Durchführend | Mitwirkend | Informiert |'
    );
    expect(result.reply).toContain('STROMDAO Netze');
  });

  test('PA-PRES-COMP-01: completed comparison execution returns comparison presentation metadata', async () => {
    setExecutionResult({
      status: 'completed',
      plan: {
        ...deterministicPlan,
        routeKey: 'vnb_benchmark_comparison',
        routeLabel: 'vnb_benchmark_comparison',
        primaryIntent: 'vnb_benchmark_comparison',
      },
      steps: [
        {
          action: 'mock.comparison',
          result: comparisonFixture.domainResult,
        },
      ],
      stopPoint: null,
    });

    const result = await broker.call(
      'personal-agent.chat',
      { message: 'Vergleiche VNB Benchmarks', executionMode: 'auto', chatMode: 'execution' },
      { meta: { tenantId: 'tenant-pa-pres-comp-01', authUser: { userId: 'user-1' } } }
    );

    expect(result.success).toBe(true);
    expect(result.presentationApplied).toBe(true);
    expect(result.presentationType).toBe('comparison_table');
    expect(result.reply).toContain(result.presentation.markdown);
    expect(result.reply).toContain('| Eintrag | Wert |');
  });

  test('PA-PRES-BANK-DD-01: completed due-diligence execution uses presentation markdown as final reply', async () => {
    setExecutionResult({
      status: 'completed',
      plan: {
        ...deterministicPlan,
        routeKey: bessDdFixture.intent,
        routeLabel: bessDdFixture.intent,
        primaryIntent: bessDdFixture.intent,
      },
      steps: [
        {
          action: 'mock.bank-dd',
          result: bessDdFixture.domainResult,
        },
      ],
      stopPoint: null,
    });

    const result = await broker.call(
      'personal-agent.chat',
      {
        message: 'Erstelle Due-Diligence View für Kreditkomitee',
        executionMode: 'auto',
        chatMode: 'execution',
      },
      { meta: { tenantId: 'tenant-pa-pres-bank-dd-01', authUser: { userId: 'user-1' } } }
    );

    expect(result.success).toBe(true);
    expect(result.presentationApplied).toBe(true);
    expect(result.presentationType).toBe('decision_brief');
    expect(result.reply).toBe(result.presentation.markdown);
    expect(result.reply).toContain('Grid connection confirmation as payout condition');
    expect(result.reply).toContain('Evidenz und offene Lücken');
  });

  test('PA-PRES-KPI-01: completed KPI fixture execution uses presentation markdown as final reply', async () => {
    setExecutionResult({
      status: 'completed',
      plan: {
        ...deterministicPlan,
        routeKey: pvKpiFixture.intent,
        routeLabel: pvKpiFixture.intent,
        primaryIntent: pvKpiFixture.intent,
      },
      steps: [
        {
          action: 'mock.kpi.fixture',
          result: pvKpiFixture.domainResult,
        },
      ],
      stopPoint: null,
    });

    const result = await broker.call(
      'personal-agent.chat',
      { message: 'Zeige PV KPI', executionMode: 'auto', chatMode: 'execution' },
      { meta: { tenantId: 'tenant-pa-pres-kpi-01', authUser: { userId: 'user-1' } } }
    );

    expect(result.success).toBe(true);
    expect(result.presentationApplied).toBe(true);
    expect(result.presentationType).toBe('kpi_fact');
    expect(result.reply).toBe(result.presentation.markdown);
  });
});
