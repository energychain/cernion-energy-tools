/**
 * Copilot Process Service — Phase 3 Tests
 *
 * Tests for the ProcessExecutionIntent lifecycle:
 *   prepare* → creates intent (no write, returns intentId)
 *   executeProcessIntent → executes confirmed intent (checks status, expiry, etc.)
 *   rejectProcessIntent → rejects intent
 *   getProcessIntent / listProcessIntents → read intents
 */

'use strict';

const { ServiceBroker } = require('moleculer');
const CopilotProcessService = require('../services/copilot-process.service');

// ── Shared mock data ──────────────────────────────────────────────────────────

const MOCK_MATRIX = {
  id: 'vdmi-test-p3',
  name: 'Phase-3-Matrix PV',
  status: 'active',
  processType: 'adhoc',
  scope: '§8 NAV',
  nominationStatus: 'none',
  regulatoryBasis: ['§8 NAV'],
  evidenceCount: 0,
  findingCount: 0,
  createdAt: '2026-01-01T08:00:00Z',
  tasks: [{ id: 't1', label: 'Unterlagen prüfen', status: 'open' }],
};

const MOCK_ZNP_PROJECT = {
  projectId: 'znp-p3-proj-1',
  name: 'Mannheim Süd Q3-2026',
  layers: ['layer0'],
  graphStats: { nodes: 10, edges: 8 },
  createdAt: '2026-05-01T08:00:00Z',
};

const MOCK_FINDING = {
  id: 'finding-p3-1',
  code: 'VD_GOV_RECURRENCE_K',
  severity: 'H',
  status: 'open',
};

// ── Helper: build isolated broker with mocked dependencies ────────────────────

async function buildBroker({ vdmiMatrixNotFound, znpProjectNotFound } = {}) {
  const broker = new ServiceBroker({ logger: false });
  broker.createService(CopilotProcessService);

  // Track calls to write actions so we can assert they were NOT called during prepare
  const writeCalls = {
    vdmiEvidence: 0,
    znpAddAssumption: 0,
    gcValidate: 0,
    creCreate: 0,
    vdmiMitigateFinding: 0,
    vdmiResolveFinding: 0,
  };

  broker.createService({
    name: 'vdmi',
    actions: {
      get: {
        handler(ctx) {
          if (vdmiMatrixNotFound || ctx.params.id === 'notfound') {
            return Promise.reject(Object.assign(new Error('not found'), { code: 404 }));
          }
          return { success: true, matrix: MOCK_MATRIX };
        },
      },
      evidence: {
        handler() {
          writeCalls.vdmiEvidence++;
          return { success: true, evidenceId: 'ev-001' };
        },
      },
      findings: {
        handler() {
          return { success: true, count: 1, findings: [MOCK_FINDING] };
        },
      },
      mitigateFinding: {
        handler() {
          writeCalls.vdmiMitigateFinding++;
          return { success: true, finding: { ...MOCK_FINDING, status: 'mitigated' } };
        },
      },
      resolveFinding: {
        handler() {
          writeCalls.vdmiResolveFinding++;
          return { success: true, finding: { ...MOCK_FINDING, status: 'resolved' } };
        },
      },
    },
  });

  broker.createService({
    name: 'znp',
    actions: {
      getProjectMeta: {
        handler(ctx) {
          if (znpProjectNotFound || ctx.params.projectId === 'notfound') {
            return Promise.reject(Object.assign(new Error('not found'), { code: 404 }));
          }
          return MOCK_ZNP_PROJECT;
        },
      },
      addAssumption: {
        handler() {
          writeCalls.znpAddAssumption++;
          return { success: true, assumptionId: 'as-001' };
        },
      },
    },
  });

  broker.createService({
    name: 'grid-connection',
    actions: {
      validate: {
        handler() {
          writeCalls.gcValidate++;
          return { success: true, reportId: 'gc-report-001' };
        },
      },
    },
  });

  broker.createService({
    name: 'connection-rejection-evidence',
    actions: {
      create: {
        handler() {
          writeCalls.creCreate++;
          return { success: true, packageId: 'pkg-001' };
        },
      },
    },
  });

  await broker.start();
  return { broker, writeCalls };
}

// ── Test suites ───────────────────────────────────────────────────────────────

describe('copilot-process service — Phase 3', () => {
  // ── prepareVdmiEvidence ─────────────────────────────────────────────────────
  describe('prepareVdmiEvidence', () => {
    let broker;
    let writeCalls;

    beforeAll(async () => {
      ({ broker, writeCalls } = await buildBroker());
    });
    afterAll(() => broker.stop());

    const VALID_PARAMS = {
      matrixId: 'vdmi-test-p3',
      evidenceType: 'aktenvermerk',
      reference: 'REF-2026-001',
      reason: 'Jahresprüfung abgeschlossen',
    };

    it('returns intentId and status pending_confirmation', async () => {
      const result = await broker.call('copilot-process.prepareVdmiEvidence', VALID_PARAMS);
      expect(result).toHaveProperty('intentId');
      expect(typeof result.intentId).toBe('string');
      expect(result.intentId.length).toBeGreaterThan(0);
      expect(result).toHaveProperty('status', 'pending_confirmation');
    });

    it('contains required fields (intentId, operationFamily, proposedAction, targetId, status, expiresAt, auditTrail)', async () => {
      const result = await broker.call('copilot-process.prepareVdmiEvidence', VALID_PARAMS);
      expect(result).toHaveProperty('intentId');
      expect(result).toHaveProperty('operationFamily');
      expect(result).toHaveProperty('proposedAction');
      expect(result).toHaveProperty('status');
      expect(result).toHaveProperty('expiresAt');
      expect(result).toHaveProperty('auditTrail');
      expect(result).toHaveProperty('target');
      expect(result.target).toHaveProperty('matrixId', 'vdmi-test-p3');
    });

    it('operationFamily is vdmi', async () => {
      const result = await broker.call('copilot-process.prepareVdmiEvidence', VALID_PARAMS);
      expect(result.operationFamily).toBe('vdmi');
    });

    it('proposedAction is inject_evidence', async () => {
      const result = await broker.call('copilot-process.prepareVdmiEvidence', VALID_PARAMS);
      expect(result.proposedAction).toBe('inject_evidence');
    });

    it('auditTrail has prepared entry with createdBy', async () => {
      const result = await broker.call('copilot-process.prepareVdmiEvidence', VALID_PARAMS);
      // auditTrail is on the returned object
      expect(result.auditTrail).toHaveProperty('requestedAt');
      expect(result.auditTrail).toHaveProperty('requestedBy');
    });

    it('does NOT call vdmi.evidence during prepare (no write)', async () => {
      const callsBefore = writeCalls.vdmiEvidence;
      await broker.call('copilot-process.prepareVdmiEvidence', VALID_PARAMS);
      expect(writeCalls.vdmiEvidence).toBe(callsBefore);
    });

    it('throws 404 if matrix not found', async () => {
      await expect(
        broker.call('copilot-process.prepareVdmiEvidence', {
          ...VALID_PARAMS,
          matrixId: 'notfound',
        })
      ).rejects.toThrow();
    });

    it('each call produces a unique intentId', async () => {
      const [r1, r2] = await Promise.all([
        broker.call('copilot-process.prepareVdmiEvidence', VALID_PARAMS),
        broker.call('copilot-process.prepareVdmiEvidence', VALID_PARAMS),
      ]);
      expect(r1.intentId).not.toBe(r2.intentId);
    });

    it('requires evidenceType, reference, and reason', async () => {
      await expect(
        broker.call('copilot-process.prepareVdmiEvidence', {
          matrixId: 'vdmi-test-p3',
          evidenceType: 'x',
          reference: 'REF-001',
        })
      ).rejects.toThrow();
      await expect(
        broker.call('copilot-process.prepareVdmiEvidence', {
          matrixId: 'vdmi-test-p3',
          evidenceType: 'x',
          reason: 'test',
        })
      ).rejects.toThrow();
    });
  });

  // ── prepareZnpAssumption ────────────────────────────────────────────────────
  describe('prepareZnpAssumption', () => {
    let broker;
    beforeAll(async () => {
      ({ broker } = await buildBroker());
    });
    afterAll(() => broker.stop());

    const VALID_PARAMS = {
      projectId: 'znp-p3-proj-1',
      text: 'Annahme: Netzkapazität ausreichend für Q3 2026 und folgende Perioden.',
      reason: 'Planungsstand Q2 2026',
    };

    it('returns intentId', async () => {
      const result = await broker.call('copilot-process.prepareZnpAssumption', VALID_PARAMS);
      expect(result).toHaveProperty('intentId');
      expect(typeof result.intentId).toBe('string');
    });

    it('operationFamily is znp', async () => {
      const result = await broker.call('copilot-process.prepareZnpAssumption', VALID_PARAMS);
      expect(result.operationFamily).toBe('znp');
    });

    it('proposedAction is add_assumption', async () => {
      const result = await broker.call('copilot-process.prepareZnpAssumption', VALID_PARAMS);
      expect(result.proposedAction).toBe('add_assumption');
    });

    it('status is pending_confirmation', async () => {
      const result = await broker.call('copilot-process.prepareZnpAssumption', VALID_PARAMS);
      expect(result.status).toBe('pending_confirmation');
    });

    it('throws 404 if project not found', async () => {
      await expect(
        broker.call('copilot-process.prepareZnpAssumption', {
          ...VALID_PARAMS,
          projectId: 'notfound',
        })
      ).rejects.toThrow();
    });

    it('requires text of at least 10 chars', async () => {
      await expect(
        broker.call('copilot-process.prepareZnpAssumption', {
          projectId: 'znp-p3-proj-1',
          text: 'short',
          reason: 'test',
        })
      ).rejects.toThrow();
    });
  });

  // ── prepareVdmiFindingMitigation ────────────────────────────────────────────
  describe('prepareVdmiFindingMitigation', () => {
    let broker;
    beforeAll(async () => {
      ({ broker } = await buildBroker());
    });
    afterAll(() => broker.stop());

    const VALID_PARAMS = {
      findingId: 'finding-p3-1',
      owner: 'grid-lead',
      dueAt: '2026-12-31T00:00:00.000Z',
      plan: 'Ablösung des Schattenpfads durch API-Integration',
      reason: 'Mitigation nach Governance-Review',
    };

    it('returns intentId and status pending_confirmation', async () => {
      const result = await broker.call(
        'copilot-process.prepareVdmiFindingMitigation',
        VALID_PARAMS
      );
      expect(result).toHaveProperty('intentId');
      expect(result).toHaveProperty('status', 'pending_confirmation');
    });

    it('operationFamily is vdmiFindingMitigation', async () => {
      const result = await broker.call(
        'copilot-process.prepareVdmiFindingMitigation',
        VALID_PARAMS
      );
      expect(result.operationFamily).toBe('vdmiFindingMitigation');
    });

    it('proposedAction is mitigate_finding', async () => {
      const result = await broker.call(
        'copilot-process.prepareVdmiFindingMitigation',
        VALID_PARAMS
      );
      expect(result.proposedAction).toBe('mitigate_finding');
    });

    it('throws 404 if finding not found', async () => {
      await expect(
        broker.call('copilot-process.prepareVdmiFindingMitigation', {
          ...VALID_PARAMS,
          findingId: 'notfound',
        })
      ).rejects.toMatchObject({ code: 404 });
    });

    it('requires owner, dueAt, plan, and reason', async () => {
      await expect(
        broker.call('copilot-process.prepareVdmiFindingMitigation', {
          findingId: 'finding-p3-1',
        })
      ).rejects.toThrow();
    });
  });

  // ── prepareVdmiFindingResolution ────────────────────────────────────────────
  describe('prepareVdmiFindingResolution', () => {
    let broker;
    beforeAll(async () => {
      ({ broker } = await buildBroker());
    });
    afterAll(() => broker.stop());

    const VALID_PARAMS = {
      findingId: 'finding-p3-1',
      resolutionReason: 'Integration abgeschlossen',
      evidenceRef: 'ticket-123',
      reason: 'Abschluss nach Governance-Review',
    };

    it('returns intentId and status pending_confirmation', async () => {
      const result = await broker.call(
        'copilot-process.prepareVdmiFindingResolution',
        VALID_PARAMS
      );
      expect(result).toHaveProperty('intentId');
      expect(result).toHaveProperty('status', 'pending_confirmation');
    });

    it('operationFamily is vdmiFindingResolution', async () => {
      const result = await broker.call(
        'copilot-process.prepareVdmiFindingResolution',
        VALID_PARAMS
      );
      expect(result.operationFamily).toBe('vdmiFindingResolution');
    });

    it('proposedAction is resolve_finding', async () => {
      const result = await broker.call(
        'copilot-process.prepareVdmiFindingResolution',
        VALID_PARAMS
      );
      expect(result.proposedAction).toBe('resolve_finding');
    });

    it('throws 404 if finding not found', async () => {
      await expect(
        broker.call('copilot-process.prepareVdmiFindingResolution', {
          ...VALID_PARAMS,
          findingId: 'notfound',
        })
      ).rejects.toMatchObject({ code: 404 });
    });

    it('requires resolutionReason and reason', async () => {
      await expect(
        broker.call('copilot-process.prepareVdmiFindingResolution', {
          findingId: 'finding-p3-1',
        })
      ).rejects.toThrow();
    });
  });

  // ── prepareConnectionRejectionEvidence ──────────────────────────────────────
  describe('prepareConnectionRejectionEvidence', () => {
    let broker;
    beforeAll(async () => {
      ({ broker } = await buildBroker());
    });
    afterAll(() => broker.stop());

    const VALID_PARAMS = {
      gridOperatorId: 'SNB935578300972',
      applicantReference: 'APP-2026-001',
      loadAssumptionKw: 150,
      netzverknuepfungspunktId: 'NVP-001',
      voltageLevel: 'NS',
      bottleneckDescription: 'Trafoüberlastung bei Spitzenlast',
      n1QualityStatus: 'NON_COMPLIANT',
      decision: 'REJECTED',
      reason: 'Netzkapazität nicht ausreichend',
    };

    it('returns intentId', async () => {
      const result = await broker.call(
        'copilot-process.prepareConnectionRejectionEvidence',
        VALID_PARAMS
      );
      expect(result).toHaveProperty('intentId');
      expect(typeof result.intentId).toBe('string');
    });

    it('operationFamily is connectionRejectionEvidence', async () => {
      const result = await broker.call(
        'copilot-process.prepareConnectionRejectionEvidence',
        VALID_PARAMS
      );
      expect(result.operationFamily).toBe('connectionRejectionEvidence');
    });

    it('proposedAction is create_package', async () => {
      const result = await broker.call(
        'copilot-process.prepareConnectionRejectionEvidence',
        VALID_PARAMS
      );
      expect(result.proposedAction).toBe('create_package');
    });

    it('status is pending_confirmation', async () => {
      const result = await broker.call(
        'copilot-process.prepareConnectionRejectionEvidence',
        VALID_PARAMS
      );
      expect(result.status).toBe('pending_confirmation');
    });

    it('requires all mandatory params', async () => {
      await expect(
        broker.call('copilot-process.prepareConnectionRejectionEvidence', {
          gridOperatorId: 'SNB123',
          // missing many fields
        })
      ).rejects.toThrow();
    });

    it('validates n1QualityStatus enum', async () => {
      await expect(
        broker.call('copilot-process.prepareConnectionRejectionEvidence', {
          ...VALID_PARAMS,
          n1QualityStatus: 'INVALID_VALUE',
        })
      ).rejects.toThrow();
    });

    it('accepts all valid n1QualityStatus values', async () => {
      for (const status of ['COMPLIANT', 'NON_COMPLIANT', 'CONDITIONALLY_COMPLIANT', 'UNKNOWN']) {
        const result = await broker.call('copilot-process.prepareConnectionRejectionEvidence', {
          ...VALID_PARAMS,
          n1QualityStatus: status,
        });
        expect(result).toHaveProperty('intentId');
      }
    });
  });

  // ── executeProcessIntent ────────────────────────────────────────────────────
  describe('executeProcessIntent', () => {
    let broker;
    let writeCalls;

    beforeEach(async () => {
      ({ broker, writeCalls } = await buildBroker());
    });
    afterEach(() => broker.stop());

    async function prepareVdmiIntent() {
      const result = await broker.call('copilot-process.prepareVdmiEvidence', {
        matrixId: 'vdmi-test-p3',
        evidenceType: 'aktenvermerk',
        reference: 'REF-2026-001',
        reason: 'Test intent',
      });
      return result.intentId;
    }

    async function prepareZnpIntent() {
      const result = await broker.call('copilot-process.prepareZnpAssumption', {
        projectId: 'znp-p3-proj-1',
        text: 'Annahme für Planungszwecke mit ausreichend Text zum Erfüllen der Mindestlänge.',
        reason: 'Test',
      });
      return result.intentId;
    }

    async function prepareGridConnectionIntent() {
      const result = await broker.call('copilot-process.prepareGridConnectionValidation', {
        gridOperatorId: 'SNB935578300972',
        reason: 'Jahresprüfung Q2 2026',
      });
      return result.intentId;
    }

    async function prepareCreIntent() {
      const result = await broker.call('copilot-process.prepareConnectionRejectionEvidence', {
        gridOperatorId: 'SNB935578300972',
        applicantReference: 'APP-2026-001',
        loadAssumptionKw: 150,
        netzverknuepfungspunktId: 'NVP-001',
        voltageLevel: 'NS',
        bottleneckDescription: 'Trafoüberlastung',
        n1QualityStatus: 'NON_COMPLIANT',
        decision: 'REJECTED',
        reason: 'Test',
      });
      return result.intentId;
    }

    async function prepareVdmiFindingMitigationIntent() {
      const result = await broker.call('copilot-process.prepareVdmiFindingMitigation', {
        findingId: 'finding-p3-1',
        owner: 'grid-lead',
        dueAt: '2026-12-31T00:00:00.000Z',
        plan: 'Ablösung des Schattenpfads durch API-Integration',
        reason: 'Test',
      });
      return result.intentId;
    }

    async function prepareVdmiFindingResolutionIntent() {
      const result = await broker.call('copilot-process.prepareVdmiFindingResolution', {
        findingId: 'finding-p3-1',
        resolutionReason: 'Integration abgeschlossen',
        reason: 'Test',
      });
      return result.intentId;
    }

    it('executes a pending_confirmation vdmi intent successfully', async () => {
      const intentId = await prepareVdmiIntent();
      const result = await broker.call('copilot-process.executeProcessIntent', { intentId });
      expect(result).toHaveProperty('intentId', intentId);
      expect(result).toHaveProperty('status', 'executed');
      expect(result).toHaveProperty('operationFamily', 'vdmi');
      expect(result).toHaveProperty('executedAt');
    });

    it('status becomes executed after successful execution', async () => {
      const intentId = await prepareVdmiIntent();
      await broker.call('copilot-process.executeProcessIntent', { intentId });
      const intent = await broker.call('copilot-process.getProcessIntent', { intentId });
      expect(intent.status).toBe('executed');
    });

    it('auditTrail has executed entry after execution', async () => {
      const intentId = await prepareVdmiIntent();
      const result = await broker.call('copilot-process.executeProcessIntent', { intentId });
      const executedEntry = result.auditTrail.find((e) => e.action === 'executed');
      expect(executedEntry).toBeDefined();
      expect(executedEntry.reason).toBe('Human-confirmed execution');
    });

    it('throws 404 for non-existent intentId', async () => {
      await expect(
        broker.call('copilot-process.executeProcessIntent', { intentId: 'nonexistent-uuid' })
      ).rejects.toMatchObject({ code: 404 });
    });

    it('throws 410 for expired intent', async () => {
      const intentId = await prepareVdmiIntent();
      // Force expiry by setting expiresAt to the past
      const svc = broker.getLocalService('copilot-process');
      svc.intentStore._store.get(intentId).expiresAt = new Date(0).toISOString();
      await expect(
        broker.call('copilot-process.executeProcessIntent', { intentId })
      ).rejects.toMatchObject({ code: 410 });
    });

    it('throws 409 for rejected intent', async () => {
      const intentId = await prepareVdmiIntent();
      await broker.call('copilot-process.rejectProcessIntent', { intentId, reason: 'Not needed' });
      await expect(
        broker.call('copilot-process.executeProcessIntent', { intentId })
      ).rejects.toMatchObject({ code: 409 });
    });

    it('throws 409 for already-executed intent', async () => {
      const intentId = await prepareVdmiIntent();
      await broker.call('copilot-process.executeProcessIntent', { intentId });
      await expect(
        broker.call('copilot-process.executeProcessIntent', { intentId })
      ).rejects.toMatchObject({ code: 409 });
    });

    it('dispatches vdmi.evidence for vdmi operationFamily', async () => {
      const intentId = await prepareVdmiIntent();
      const callsBefore = writeCalls.vdmiEvidence;
      await broker.call('copilot-process.executeProcessIntent', { intentId });
      expect(writeCalls.vdmiEvidence).toBe(callsBefore + 1);
    });

    it('dispatches znp.addAssumption for znp operationFamily', async () => {
      const intentId = await prepareZnpIntent();
      const callsBefore = writeCalls.znpAddAssumption;
      await broker.call('copilot-process.executeProcessIntent', { intentId });
      expect(writeCalls.znpAddAssumption).toBe(callsBefore + 1);
    });

    it('dispatches grid-connection.validate for gridConnection operationFamily', async () => {
      const intentId = await prepareGridConnectionIntent();
      const callsBefore = writeCalls.gcValidate;
      await broker.call('copilot-process.executeProcessIntent', { intentId });
      expect(writeCalls.gcValidate).toBe(callsBefore + 1);
    });

    it('dispatches connection-rejection-evidence.create for connectionRejectionEvidence operationFamily', async () => {
      const intentId = await prepareCreIntent();
      const callsBefore = writeCalls.creCreate;
      await broker.call('copilot-process.executeProcessIntent', { intentId });
      expect(writeCalls.creCreate).toBe(callsBefore + 1);
    });

    it('dispatches vdmi.mitigateFinding for vdmiFindingMitigation operationFamily', async () => {
      const intentId = await prepareVdmiFindingMitigationIntent();
      const callsBefore = writeCalls.vdmiMitigateFinding;
      const result = await broker.call('copilot-process.executeProcessIntent', { intentId });
      expect(writeCalls.vdmiMitigateFinding).toBe(callsBefore + 1);
      expect(result.status).toBe('executed');
    });

    it('dispatches vdmi.resolveFinding for vdmiFindingResolution operationFamily', async () => {
      const intentId = await prepareVdmiFindingResolutionIntent();
      const callsBefore = writeCalls.vdmiResolveFinding;
      const result = await broker.call('copilot-process.executeProcessIntent', { intentId });
      expect(writeCalls.vdmiResolveFinding).toBe(callsBefore + 1);
      expect(result.status).toBe('executed');
    });
  });

  // ── rejectProcessIntent ─────────────────────────────────────────────────────
  describe('rejectProcessIntent', () => {
    let broker;

    beforeEach(async () => {
      ({ broker } = await buildBroker());
    });
    afterEach(() => broker.stop());

    async function prepareIntent() {
      const result = await broker.call('copilot-process.prepareVdmiEvidence', {
        matrixId: 'vdmi-test-p3',
        evidenceType: 'aktenvermerk',
        reference: 'REF-001',
        reason: 'Test',
      });
      return result.intentId;
    }

    it('rejects a pending_confirmation intent', async () => {
      const intentId = await prepareIntent();
      const result = await broker.call('copilot-process.rejectProcessIntent', {
        intentId,
        reason: 'Not approved by management',
      });
      expect(result).toHaveProperty('intentId', intentId);
      expect(result).toHaveProperty('status', 'rejected');
      expect(result).toHaveProperty('reason', 'Not approved by management');
    });

    it('status becomes rejected after rejection', async () => {
      const intentId = await prepareIntent();
      await broker.call('copilot-process.rejectProcessIntent', { intentId, reason: 'Rejected' });
      const intent = await broker.call('copilot-process.getProcessIntent', { intentId });
      expect(intent.status).toBe('rejected');
    });

    it('throws 404 for non-existent intent', async () => {
      await expect(
        broker.call('copilot-process.rejectProcessIntent', {
          intentId: 'nonexistent',
          reason: 'No',
        })
      ).rejects.toMatchObject({ code: 404 });
    });

    it('throws 409 when rejecting an already-rejected intent', async () => {
      const intentId = await prepareIntent();
      await broker.call('copilot-process.rejectProcessIntent', {
        intentId,
        reason: 'First rejection',
      });
      await expect(
        broker.call('copilot-process.rejectProcessIntent', { intentId, reason: 'Second rejection' })
      ).rejects.toMatchObject({ code: 409 });
    });
  });

  // ── getProcessIntent ────────────────────────────────────────────────────────
  describe('getProcessIntent', () => {
    let broker;

    beforeAll(async () => {
      ({ broker } = await buildBroker());
    });
    afterAll(() => broker.stop());

    it('returns intent by ID', async () => {
      const prepared = await broker.call('copilot-process.prepareVdmiEvidence', {
        matrixId: 'vdmi-test-p3',
        evidenceType: 'aktenvermerk',
        reference: 'REF-001',
        reason: 'Test',
      });
      const intent = await broker.call('copilot-process.getProcessIntent', {
        intentId: prepared.intentId,
      });
      expect(intent).toHaveProperty('intentId', prepared.intentId);
      expect(intent).toHaveProperty('operationFamily', 'vdmi');
      expect(intent).toHaveProperty('status', 'pending_confirmation');
      expect(intent).toHaveProperty('auditTrail');
      expect(Array.isArray(intent.auditTrail)).toBe(true);
    });

    it('throws 404 for unknown ID', async () => {
      await expect(
        broker.call('copilot-process.getProcessIntent', { intentId: 'does-not-exist' })
      ).rejects.toMatchObject({ code: 404 });
    });
  });

  // ── listProcessIntents ──────────────────────────────────────────────────────
  describe('listProcessIntents', () => {
    let broker;

    beforeAll(async () => {
      ({ broker } = await buildBroker());
      // Create a few intents
      await broker.call('copilot-process.prepareVdmiEvidence', {
        matrixId: 'vdmi-test-p3',
        evidenceType: 'aktenvermerk',
        reference: 'REF-001',
        reason: 'List test A',
      });
      await broker.call('copilot-process.prepareZnpAssumption', {
        projectId: 'znp-p3-proj-1',
        text: 'Planungsannahme für den Listtest mit ausreichend Text hier.',
        reason: 'List test B',
      });
    });
    afterAll(() => broker.stop());

    it('returns list with count', async () => {
      const result = await broker.call('copilot-process.listProcessIntents', {});
      expect(result).toHaveProperty('count');
      expect(result).toHaveProperty('intents');
      expect(Array.isArray(result.intents)).toBe(true);
      expect(result.count).toBeGreaterThanOrEqual(2);
    });

    it('filters by operationFamily', async () => {
      const result = await broker.call('copilot-process.listProcessIntents', {
        operationFamily: 'znp',
      });
      expect(result.count).toBeGreaterThanOrEqual(1);
      for (const intent of result.intents) {
        expect(intent.operationFamily).toBe('znp');
      }
    });

    it('filters by status', async () => {
      const result = await broker.call('copilot-process.listProcessIntents', {
        status: 'pending_confirmation',
      });
      for (const intent of result.intents) {
        expect(intent.status).toBe('pending_confirmation');
      }
    });

    it('count matches intents array length', async () => {
      const result = await broker.call('copilot-process.listProcessIntents', {});
      expect(result.count).toBe(result.intents.length);
    });
  });

  // ── Safety boundaries ───────────────────────────────────────────────────────
  describe('Safety boundaries (x-openai-isConsequential)', () => {
    it('executeProcessIntent action has x-openai-isConsequential: true in service definition', () => {
      const action = CopilotProcessService.actions.executeProcessIntent;
      expect(action.openapi['x-openai-isConsequential']).toBe(true);
    });

    it('getProcessIntent action has x-openai-isConsequential: false', () => {
      const action = CopilotProcessService.actions.getProcessIntent;
      expect(action.openapi['x-openai-isConsequential']).toBe(false);
    });

    it('listProcessIntents action has x-openai-isConsequential: false', () => {
      const action = CopilotProcessService.actions.listProcessIntents;
      expect(action.openapi['x-openai-isConsequential']).toBe(false);
    });

    it('prepareVdmiEvidence action has x-openai-isConsequential: false', () => {
      const action = CopilotProcessService.actions.prepareVdmiEvidence;
      expect(action.openapi['x-openai-isConsequential']).toBe(false);
    });

    it('prepareZnpAssumption action has x-openai-isConsequential: false', () => {
      const action = CopilotProcessService.actions.prepareZnpAssumption;
      expect(action.openapi['x-openai-isConsequential']).toBe(false);
    });

    it('prepareConnectionRejectionEvidence action has x-openai-isConsequential: false', () => {
      const action = CopilotProcessService.actions.prepareConnectionRejectionEvidence;
      expect(action.openapi['x-openai-isConsequential']).toBe(false);
    });

    it('prepareVdmiFindingMitigation action has x-openai-isConsequential: false', () => {
      const action = CopilotProcessService.actions.prepareVdmiFindingMitigation;
      expect(action.openapi['x-openai-isConsequential']).toBe(false);
    });

    it('prepareVdmiFindingResolution action has x-openai-isConsequential: false', () => {
      const action = CopilotProcessService.actions.prepareVdmiFindingResolution;
      expect(action.openapi['x-openai-isConsequential']).toBe(false);
    });

    it('rejectProcessIntent action has x-openai-isConsequential: false', () => {
      const action = CopilotProcessService.actions.rejectProcessIntent;
      expect(action.openapi['x-openai-isConsequential']).toBe(false);
    });
  });

  // ── Intent isolation ────────────────────────────────────────────────────────
  describe('Intent isolation (per-broker store)', () => {
    it('two brokers have independent intent stores', async () => {
      const { broker: broker1 } = await buildBroker();
      const { broker: broker2 } = await buildBroker();

      const r1 = await broker1.call('copilot-process.prepareVdmiEvidence', {
        matrixId: 'vdmi-test-p3',
        evidenceType: 'aktenvermerk',
        reference: 'REF-001',
        reason: 'Test isolation',
      });

      // broker2 should not find broker1's intent
      await expect(
        broker2.call('copilot-process.getProcessIntent', { intentId: r1.intentId })
      ).rejects.toMatchObject({ code: 404 });

      await broker1.stop();
      await broker2.stop();
    });
  });
});
