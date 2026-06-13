const path = require('path');
const os = require('os');
const { ServiceBroker } = require('moleculer');
const RedispatchDataGovernanceService = require('../services/redispatch-data-governance.service');

describe('redispatch-data-governance service', () => {
  let broker;

  beforeAll(async () => {
    broker = new ServiceBroker({ logger: false });

    broker.createService({
      ...RedispatchDataGovernanceService,
      settings: {
        ...RedispatchDataGovernanceService.settings,
        dbPath: path.join(os.tmpdir(), `rdg-test-db-${Date.now()}`),
      },
    });

    await broker.start();
  });

  afterAll(async () => {
    await broker.stop();
  });

  const defaultMeta = { tenantId: 'test-tenant' };

  function makePolicy(overrides = {}) {
    return {
      dataClass: 'redispatch-timeseries',
      processId: 'proc-a96',
      deadlineClass: 'monthly',
      ownerType: 'org-unit',
      ownerRef: 'Netzbetrieb',
      assignmentMode: 'rule',
      severityOnMiss: 'error',
      sourceOfRecordPriority: ['mastr', 'edi-portal'],
      policyVersion: '1.0',
      ...overrides,
    };
  }

  // ── createPolicy and retrieve it ─────────────────────────────────────────

  test('createPolicy and retrieve it', async () => {
    const policy = await broker.call('redispatch-data-governance.createPolicy', makePolicy(), {
      meta: defaultMeta,
    });

    expect(policy._id).toBeTruthy();
    expect(policy.dataClass).toBe('redispatch-timeseries');

    const fetched = await broker.call(
      'redispatch-data-governance.getPolicy',
      { id: policy._id },
      { meta: defaultMeta }
    );
    expect(fetched._id).toBe(policy._id);
  });

  // ── evaluate: no matching policy → RDG_GOVERNANCE_POLICY_MISSING ─────────

  test('evaluate with no matching policy → RDG_GOVERNANCE_POLICY_MISSING', async () => {
    const result = await broker.call(
      'redispatch-data-governance.evaluate',
      {
        dataClass: 'nonexistent-class',
        processId: 'nonexistent-proc',
        periodStart: '2025-01-01T00:00:00Z',
        periodEnd: '2025-01-31T23:59:59Z',
      },
      { meta: defaultMeta }
    );

    expect(result.status).toBe('blocked');
    expect(result.findings.some((f) => f.finding === 'RDG_GOVERNANCE_POLICY_MISSING')).toBe(true);
  });

  // ── evaluate: matching policy, fileMonitorStatus green → RDG_GOVERNANCE_COMPLIANT ──

  test('evaluate with matching policy and green file monitor → RDG_GOVERNANCE_COMPLIANT', async () => {
    await broker.call(
      'redispatch-data-governance.createPolicy',
      makePolicy({ dataClass: 'rd-ts-green', processId: 'proc-green' }),
      { meta: defaultMeta }
    );

    const result = await broker.call(
      'redispatch-data-governance.evaluate',
      {
        dataClass: 'rd-ts-green',
        processId: 'proc-green',
        periodStart: '2025-01-01T00:00:00Z',
        periodEnd: '2025-01-31T23:59:59Z',
        fileMonitorStatus: { status: 'green', lastScanAt: new Date().toISOString() },
        availableSources: ['mastr', 'edi-portal'],
      },
      { meta: defaultMeta }
    );

    expect(result.status).toBe('compliant');
    expect(result.findings.some((f) => f.finding === 'RDG_GOVERNANCE_COMPLIANT')).toBe(true);
  });

  // ── evaluate: fileMonitorStatus red → RDG_DEADLINE_MISSED ────────────────

  test('evaluate with fileMonitorStatus red → RDG_DEADLINE_MISSED', async () => {
    await broker.call(
      'redispatch-data-governance.createPolicy',
      makePolicy({ dataClass: 'rd-ts-red', processId: 'proc-red' }),
      { meta: defaultMeta }
    );

    const result = await broker.call(
      'redispatch-data-governance.evaluate',
      {
        dataClass: 'rd-ts-red',
        processId: 'proc-red',
        periodStart: '2025-01-01T00:00:00Z',
        periodEnd: '2025-01-31T23:59:59Z',
        fileMonitorStatus: { status: 'red' },
      },
      { meta: defaultMeta }
    );

    expect(result.status).toBe('blocked');
    expect(result.findings.some((f) => f.finding === 'RDG_DEADLINE_MISSED')).toBe(true);
  });

  // ── evaluate: missing ownerRef → RDG_OWNER_UNASSIGNED ────────────────────

  test('evaluate with missing ownerRef → RDG_OWNER_UNASSIGNED', async () => {
    await broker.call(
      'redispatch-data-governance.createPolicy',
      makePolicy({ dataClass: 'rd-ts-noowner', processId: 'proc-noowner', ownerRef: null }),
      { meta: defaultMeta }
    );

    const result = await broker.call(
      'redispatch-data-governance.evaluate',
      {
        dataClass: 'rd-ts-noowner',
        processId: 'proc-noowner',
        periodStart: '2025-01-01T00:00:00Z',
        periodEnd: '2025-01-31T23:59:59Z',
      },
      { meta: defaultMeta }
    );

    expect(result.findings.some((f) => f.finding === 'RDG_OWNER_UNASSIGNED')).toBe(true);
  });

  // ── evaluate: source not in availableSources → RDG_SOURCE_OF_RECORD_UNRESOLVED ──

  test('evaluate with source not available → RDG_SOURCE_OF_RECORD_UNRESOLVED', async () => {
    await broker.call(
      'redispatch-data-governance.createPolicy',
      makePolicy({ dataClass: 'rd-ts-src', processId: 'proc-src' }),
      { meta: defaultMeta }
    );

    const result = await broker.call(
      'redispatch-data-governance.evaluate',
      {
        dataClass: 'rd-ts-src',
        processId: 'proc-src',
        periodStart: '2025-01-01T00:00:00Z',
        periodEnd: '2025-01-31T23:59:59Z',
        availableSources: ['edi-portal'], // missing 'mastr' which is top priority
      },
      { meta: defaultMeta }
    );

    expect(result.findings.some((f) => f.finding === 'RDG_SOURCE_OF_RECORD_UNRESOLVED')).toBe(true);
  });

  // ── updatePolicy, deletePolicy ────────────────────────────────────────────

  test('updatePolicy changes fields', async () => {
    const policy = await broker.call(
      'redispatch-data-governance.createPolicy',
      makePolicy({ dataClass: 'rd-ts-upd', processId: 'proc-upd' }),
      { meta: defaultMeta }
    );

    const updated = await broker.call(
      'redispatch-data-governance.updatePolicy',
      { id: policy._id, policyVersion: '2.0', ownerRef: 'NewOwner' },
      { meta: defaultMeta }
    );

    expect(updated.policyVersion).toBe('2.0');
    expect(updated.ownerRef).toBe('NewOwner');
  });

  test('deletePolicy removes it', async () => {
    const policy = await broker.call(
      'redispatch-data-governance.createPolicy',
      makePolicy({ dataClass: 'rd-ts-del', processId: 'proc-del' }),
      { meta: defaultMeta }
    );

    const del = await broker.call(
      'redispatch-data-governance.deletePolicy',
      { id: policy._id },
      { meta: defaultMeta }
    );
    expect(del.success).toBe(true);

    await expect(
      broker.call('redispatch-data-governance.getPolicy', { id: policy._id }, { meta: defaultMeta })
    ).rejects.toMatchObject({ code: 404 });
  });

  // ── listEvaluations ───────────────────────────────────────────────────────

  test('listEvaluations returns created evaluations', async () => {
    await broker.call(
      'redispatch-data-governance.createPolicy',
      makePolicy({ dataClass: 'rd-ts-list', processId: 'proc-list' }),
      { meta: defaultMeta }
    );

    await broker.call(
      'redispatch-data-governance.evaluate',
      {
        dataClass: 'rd-ts-list',
        processId: 'proc-list',
        periodStart: '2025-02-01T00:00:00Z',
        periodEnd: '2025-02-28T23:59:59Z',
        availableSources: ['mastr'],
      },
      { meta: defaultMeta }
    );

    const list = await broker.call(
      'redispatch-data-governance.listEvaluations',
      { dataClass: 'rd-ts-list' },
      { meta: defaultMeta }
    );

    expect(list.evaluations.length).toBeGreaterThan(0);
    expect(list.evaluations[0].dataClass).toBe('rd-ts-list');
  });
});
