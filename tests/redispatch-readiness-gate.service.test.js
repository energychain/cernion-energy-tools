const path = require('path');
const os = require('os');
const { ServiceBroker } = require('moleculer');
const RedispatchReadinessGateService = require('../services/redispatch-readiness-gate.service');

describe('redispatch-readiness-gate service', () => {
  let broker;

  beforeAll(async () => {
    broker = new ServiceBroker({ logger: false });
    broker.createService({
      ...RedispatchReadinessGateService,
      settings: {
        ...RedispatchReadinessGateService.settings,
        dbPath: path.join(os.tmpdir(), `rrg-test-db-${Date.now()}`),
      },
    });
    await broker.start();
  });

  afterAll(async () => {
    await broker.stop();
  });

  const meta = { tenantId: 'test-tenant' };

  function readyParams(overrides = {}) {
    return {
      processId: 'rd2-ready-001',
      accessMatrix: {
        gui: { granted: true },
        sftp: { granted: true },
        testsystem: { granted: true },
        produktivsystem: { granted: true },
      },
      testCallStatus: 'passed',
      productionProofConfirmed: true,
      templateVersion: '2026.1',
      requiredTemplateVersion: '2026.1',
      openQuestions: [],
      responsibleRole: 'Redispatch IT/Fachkoordination',
      acceptanceDeadline: '2099-07-01',
      ...overrides,
    };
  }

  test('evaluate returns ready when all operational readiness criteria are met', async () => {
    const result = await broker.call('redispatch-readiness-gate.evaluate', readyParams(), {
      meta,
    });

    expect(result.status).toBe('ready');
    expect(result.findings.some((f) => f.finding === 'RRG_GATE_READY')).toBe(true);
    expect(result.findings.some((f) => f.finding === 'RRG_ACCESS_MATRIX_COMPLETE')).toBe(true);
  });

  test('evaluate blocks when access, test call or production proof is missing', async () => {
    const result = await broker.call(
      'redispatch-readiness-gate.evaluate',
      readyParams({
        processId: 'rd2-blocked-001',
        accessMatrix: { gui: { granted: true }, sftp: { granted: false } },
        testCallStatus: 'failed',
        productionProofConfirmed: false,
      }),
      { meta }
    );

    expect(result.status).toBe('blocked');
    expect(result.findings.some((f) => f.finding === 'RRG_ACCESS_MATRIX_INCOMPLETE')).toBe(true);
    expect(result.findings.some((f) => f.finding === 'RRG_TEST_CALL_FAILED')).toBe(true);
    expect(result.findings.some((f) => f.finding === 'RRG_PRODUCTION_PROOF_MISSING')).toBe(true);
    expect(result.findings.some((f) => f.finding === 'RRG_GATE_BLOCKED')).toBe(true);
  });

  test('evaluate returns ready_with_warnings for non-blocking readiness gaps', async () => {
    const result = await broker.call(
      'redispatch-readiness-gate.evaluate',
      readyParams({
        processId: 'rd2-warning-001',
        testCallStatus: 'pending',
        templateVersion: '2025.4',
        requiredTemplateVersion: '2026.1',
        openQuestions: ['Who confirms SFTP cutover?'],
        responsibleRole: '',
      }),
      { meta }
    );

    expect(result.status).toBe('ready_with_warnings');
    expect(result.findings.some((f) => f.finding === 'RRG_TEST_CALL_MISSING')).toBe(true);
    expect(result.findings.some((f) => f.finding === 'RRG_TEMPLATE_VERSION_OUTDATED')).toBe(true);
    expect(result.findings.some((f) => f.finding === 'RRG_OPEN_QUESTIONS_PRESENT')).toBe(true);
    expect(result.findings.some((f) => f.finding === 'RRG_GATE_READY_WITH_WARNINGS')).toBe(true);
  });

  test('listRuns, getRun and getStatus expose the latest tenant-scoped run', async () => {
    const evalResult = await broker.call(
      'redispatch-readiness-gate.evaluate',
      readyParams({ processId: 'rd2-status-001' }),
      { meta }
    );

    const list = await broker.call(
      'redispatch-readiness-gate.listRuns',
      { processId: 'rd2-status-001' },
      { meta }
    );
    expect(list.runs.some((r) => r._id === evalResult.gateRunId)).toBe(true);

    const run = await broker.call(
      'redispatch-readiness-gate.getRun',
      { id: evalResult.gateRunId },
      { meta }
    );
    expect(run.processId).toBe('rd2-status-001');

    const status = await broker.call(
      'redispatch-readiness-gate.getStatus',
      { processId: 'rd2-status-001' },
      { meta }
    );
    expect(status.found).toBe(true);
    expect(status.overallStatus).toBe('ready');
    expect(status.accessMatrixStatus).toBe('complete');
    expect(status.productionProofConfirmed).toBe(true);
  });

  test('getStatus returns dossier-safe not-found state without writing a run', async () => {
    const status = await broker.call(
      'redispatch-readiness-gate.getStatus',
      { processId: 'rd2-missing' },
      { meta }
    );

    expect(status).toEqual({
      found: false,
      message: 'No Redispatch readiness evaluation is available for this tenant yet',
    });
  });
});
