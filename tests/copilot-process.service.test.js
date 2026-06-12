/**
 * Copilot Process Service Tests
 *
 * Covers all 7 Phase-2 process actions:
 *   Read-only: getVdmiContext, listOpenResponsibilities, getZnpProjectStatus, getGridConnectionValidation
 *   Draft:     prepareVdmiValidation, draftVdmiEvidence, prepareGridConnectionValidation
 */

const { ServiceBroker } = require('moleculer');
const CopilotProcessService = require('../services/copilot-process.service');

// ── Shared mock data ──────────────────────────────────────────────────────────

const MOCK_MATRIX = {
  id: 'vdmi-test-1',
  name: 'Netzanschluss-Genehmigung PV',
  status: 'active',
  processType: 'adhoc',
  scope: '§8 NAV',
  nominationStatus: 'none',
  regulatoryBasis: ['§8 NAV'],
  evidenceCount: 1,
  findingCount: 0,
  createdAt: '2026-01-01T08:00:00Z',
  tasks: [
    {
      id: 't1',
      label: 'Unterlagen prüfen',
      status: 'open',
      verantwortlich: [{ actorId: 'grid_operator' }],
    },
    { id: 't2', label: 'Netzanschluss freigeben', status: 'done', verantwortlich: [] },
  ],
};

const MOCK_ZNP_PROJECT = {
  projectId: 'znp-proj-1',
  name: 'Ludwigshafen Nord Q3-2026',
  layers: ['layer0', 'layer1'],
  graphStats: { nodes: 42, edges: 38 },
  createdAt: '2026-05-01T08:00:00Z',
};

const MOCK_GRID_REPORT = {
  success: true,
  id: 'gc-report-1',
  gridOperator: { name: 'TWL Netze', mastrId: 'SNB123' },
  decision: 'GO_CONDITIONAL',
  findings: [{ code: 'CAP_WARN' }, { code: 'DELTA_MISS' }],
  createdAt: '2026-03-30T10:00:00Z',
};

// ── Helper: build isolated broker with mocked dependencies ────────────────────

async function buildBroker({
  vdmiMatrix,
  vdmiMatrixNotFound,
  znpProject,
  gridReport,
  vnbItems,
} = {}) {
  const broker = new ServiceBroker({ logger: false });
  broker.createService(CopilotProcessService);

  broker.createService({
    name: 'vdmi',
    actions: {
      get: {
        handler(ctx) {
          if (vdmiMatrixNotFound || ctx.params.id === 'notfound') {
            return Promise.reject(Object.assign(new Error('not found'), { code: 404 }));
          }
          return { success: true, matrix: vdmiMatrix || MOCK_MATRIX };
        },
      },
      list: {
        handler() {
          return { items: vnbItems || [vdmiMatrix || MOCK_MATRIX] };
        },
      },
      myResponsibilities: {
        handler() {
          return { success: true, count: 1, items: [vdmiMatrix || MOCK_MATRIX] };
        },
      },
    },
  });

  broker.createService({
    name: 'znp',
    actions: {
      getProjectMeta: {
        handler(ctx) {
          if (ctx.params.projectId === 'notfound') {
            return Promise.reject(Object.assign(new Error('not found'), { code: 404 }));
          }
          return znpProject || MOCK_ZNP_PROJECT;
        },
      },
    },
  });

  broker.createService({
    name: 'grid-connection',
    actions: {
      get: {
        handler(ctx) {
          if (ctx.params.id === 'notfound') {
            return { success: false, message: 'Validation notfound not found' };
          }
          return gridReport || MOCK_GRID_REPORT;
        },
      },
    },
  });

  await broker.start();
  return broker;
}

// ── Test suites ───────────────────────────────────────────────────────────────

describe('copilot-process service', () => {
  // ── getVdmiContext ──────────────────────────────────────────────────────────
  describe('getVdmiContext (read-only)', () => {
    let broker;
    beforeAll(async () => {
      broker = await buildBroker();
    });
    afterAll(() => broker.stop());

    it('requires matrixId', async () => {
      await expect(broker.call('copilot-process.getVdmiContext', {})).rejects.toThrow();
    });

    it('returns full context shape', async () => {
      const result = await broker.call('copilot-process.getVdmiContext', {
        matrixId: 'vdmi-test-1',
      });

      expect(result).toHaveProperty('matrixId', 'vdmi-test-1');
      expect(result).toHaveProperty('name', 'Netzanschluss-Genehmigung PV');
      expect(result).toHaveProperty('status', 'active');
      expect(result).toHaveProperty('openTaskCount', 1);
      expect(result).toHaveProperty('totalTaskCount', 2);
      expect(result).toHaveProperty('evidenceCount', 1);
      expect(result).toHaveProperty('findingCount', 0);
      expect(result).toHaveProperty('summary');
      expect(typeof result.summary).toBe('string');
      expect(result.summary.length).toBeGreaterThan(0);
      expect(result).toHaveProperty('detailUrl', '/api/vdmi/vdmi-test-1');
    });

    it('counts only non-done tasks as open', async () => {
      const result = await broker.call('copilot-process.getVdmiContext', {
        matrixId: 'vdmi-test-1',
      });
      // MOCK_MATRIX has t1=open, t2=done → openTaskCount=1
      expect(result.openTaskCount).toBe(1);
    });

    it('includes nominationStatus in result', async () => {
      const result = await broker.call('copilot-process.getVdmiContext', {
        matrixId: 'vdmi-test-1',
      });
      expect(result).toHaveProperty('nominationStatus');
    });

    it('propagates 404 from vdmi.get', async () => {
      const broker2 = await buildBroker({ vdmiMatrixNotFound: true });
      await expect(
        broker2.call('copilot-process.getVdmiContext', { matrixId: 'notfound' })
      ).rejects.toThrow();
      await broker2.stop();
    });
  });

  // ── listOpenResponsibilities ────────────────────────────────────────────────
  describe('listOpenResponsibilities (read-only)', () => {
    let broker;
    beforeAll(async () => {
      broker = await buildBroker();
    });
    afterAll(() => broker.stop());

    it('returns count and responsibilities array', async () => {
      const result = await broker.call('copilot-process.listOpenResponsibilities', {});
      expect(result).toHaveProperty('count');
      expect(result).toHaveProperty('responsibilities');
      expect(Array.isArray(result.responsibilities)).toBe(true);
    });

    it('filters to matrices with at least one open task', async () => {
      const result = await broker.call('copilot-process.listOpenResponsibilities', {});
      for (const r of result.responsibilities) {
        expect(r.openTaskCount).toBeGreaterThan(0);
      }
    });

    it('each responsibility has required fields', async () => {
      const result = await broker.call('copilot-process.listOpenResponsibilities', {});
      if (result.responsibilities.length > 0) {
        const r = result.responsibilities[0];
        expect(r).toHaveProperty('matrixId');
        expect(r).toHaveProperty('name');
        expect(r).toHaveProperty('status');
        expect(r).toHaveProperty('openTaskCount');
        expect(r).toHaveProperty('detailUrl');
      }
    });

    it('uses myResponsibilities when userId is supplied', async () => {
      const result = await broker.call('copilot-process.listOpenResponsibilities', {
        userId: 'grid_operator',
      });
      expect(result).toHaveProperty('count');
      expect(Array.isArray(result.responsibilities)).toBe(true);
    });

    it('returns empty when all tasks are done', async () => {
      const allDoneMatrix = {
        ...MOCK_MATRIX,
        tasks: [{ id: 't1', label: 'Task', status: 'done' }],
      };
      const broker2 = await buildBroker({ vdmiMatrix: allDoneMatrix, vnbItems: [allDoneMatrix] });
      const result = await broker2.call('copilot-process.listOpenResponsibilities', {});
      expect(result.count).toBe(0);
      await broker2.stop();
    });
  });

  // ── getZnpProjectStatus ─────────────────────────────────────────────────────
  describe('getZnpProjectStatus (read-only)', () => {
    let broker;
    beforeAll(async () => {
      broker = await buildBroker();
    });
    afterAll(() => broker.stop());

    it('requires projectId', async () => {
      await expect(broker.call('copilot-process.getZnpProjectStatus', {})).rejects.toThrow();
    });

    it('returns project status shape', async () => {
      const result = await broker.call('copilot-process.getZnpProjectStatus', {
        projectId: 'znp-proj-1',
      });

      expect(result).toHaveProperty('projectId', 'znp-proj-1');
      expect(result).toHaveProperty('name', 'Ludwigshafen Nord Q3-2026');
      expect(result.layers).toEqual(['layer0', 'layer1']);
      expect(result.graphStats).toMatchObject({ nodes: 42, edges: 38 });
      expect(result).toHaveProperty('summary');
      expect(result.summary).toMatch(/Ludwigshafen/);
      expect(result).toHaveProperty('detailUrl', '/api/znp/projects/znp-proj-1');
    });

    it('propagates 404 from znp.getProjectMeta', async () => {
      await expect(
        broker.call('copilot-process.getZnpProjectStatus', { projectId: 'notfound' })
      ).rejects.toThrow();
    });
  });

  // ── getGridConnectionValidation ─────────────────────────────────────────────
  describe('getGridConnectionValidation (read-only)', () => {
    let broker;
    beforeAll(async () => {
      broker = await buildBroker();
    });
    afterAll(() => broker.stop());

    it('requires validationId', async () => {
      await expect(
        broker.call('copilot-process.getGridConnectionValidation', {})
      ).rejects.toThrow();
    });

    it('returns validation summary shape', async () => {
      const result = await broker.call('copilot-process.getGridConnectionValidation', {
        validationId: 'gc-report-1',
      });

      expect(result).toHaveProperty('validationId', 'gc-report-1');
      expect(result).toHaveProperty('decision', 'GO_CONDITIONAL');
      expect(result).toHaveProperty('gridOperatorName', 'TWL Netze');
      expect(result).toHaveProperty('gridOperatorId', 'SNB123');
      expect(result).toHaveProperty('findingsCount', 2);
      expect(result).toHaveProperty('summary');
      expect(result.summary).toMatch(/GO_CONDITIONAL/);
      expect(result).toHaveProperty('detailUrl');
    });

    it('throws 404 when report not found', async () => {
      await expect(
        broker.call('copilot-process.getGridConnectionValidation', { validationId: 'notfound' })
      ).rejects.toThrow(/not found/i);
    });
  });

  // ── prepareVdmiValidation ───────────────────────────────────────────────────
  describe('prepareVdmiValidation (draft)', () => {
    let broker;
    beforeAll(async () => {
      broker = await buildBroker();
    });
    afterAll(() => broker.stop());

    it('requires matrixId and reason', async () => {
      await expect(
        broker.call('copilot-process.prepareVdmiValidation', { matrixId: 'vdmi-test-1' })
      ).rejects.toThrow();
      await expect(
        broker.call('copilot-process.prepareVdmiValidation', { reason: 'test' })
      ).rejects.toThrow();
    });

    it('returns full draft shape', async () => {
      const result = await broker.call('copilot-process.prepareVdmiValidation', {
        matrixId: 'vdmi-test-1',
        reason: 'Jahresprüfung abgeschlossen',
      });

      expect(result).toHaveProperty('draftId');
      expect(typeof result.draftId).toBe('string');
      expect(result).toHaveProperty('action', 'nominate_vdmi_matrix');
      expect(result.target).toMatchObject({
        matrixId: 'vdmi-test-1',
        matrixName: 'Netzanschluss-Genehmigung PV',
      });
      expect(result).toHaveProperty('proposedChange');
      expect(result.proposedChange).toHaveProperty('nominationStatus', 'pending');
      expect(result).toHaveProperty('summary');
      expect(result).toHaveProperty('confirmationMessage');
      expect(result).toHaveProperty('requiredConfirmation', true);
      expect(result).toHaveProperty('readyToExecute');
      expect(result).toHaveProperty('consequentialAction');
      expect(result.consequentialAction).toHaveProperty('operationId', 'executeVdmiNomination');
    });

    it('includes audit trail with requestedAt and correlationId', async () => {
      const result = await broker.call('copilot-process.prepareVdmiValidation', {
        matrixId: 'vdmi-test-1',
        reason: 'Test',
        correlationId: 'corr-abc',
      });
      expect(result.auditTrail).toHaveProperty('requestedAt');
      expect(result.auditTrail).toHaveProperty('correlationId', 'corr-abc');
      expect(result.auditTrail).toHaveProperty('reason', 'Test');
    });

    it('passes idempotencyKey through to audit trail', async () => {
      const result = await broker.call('copilot-process.prepareVdmiValidation', {
        matrixId: 'vdmi-test-1',
        reason: 'Test',
        idempotencyKey: 'idem-xyz',
      });
      expect(result.auditTrail.idempotencyKey).toBe('idem-xyz');
    });

    it('readyToExecute is false when open tasks remain', async () => {
      const result = await broker.call('copilot-process.prepareVdmiValidation', {
        matrixId: 'vdmi-test-1',
        reason: 'Test',
      });
      // MOCK_MATRIX has 1 open task
      expect(result.readyToExecute).toBe(false);
      expect(result.warningIfAny).toBeTruthy();
    });

    it('readyToExecute is true when no open tasks', async () => {
      const allDoneMatrix = { ...MOCK_MATRIX, tasks: [{ id: 't1', status: 'done' }] };
      const broker2 = await buildBroker({ vdmiMatrix: allDoneMatrix });
      const result = await broker2.call('copilot-process.prepareVdmiValidation', {
        matrixId: 'vdmi-test-1',
        reason: 'All done',
      });
      expect(result.readyToExecute).toBe(true);
      expect(result.warningIfAny).toBeNull();
      await broker2.stop();
    });

    it('throws 422 for invalid status transition', async () => {
      const completedMatrix = { ...MOCK_MATRIX, status: 'completed' };
      const broker2 = await buildBroker({ vdmiMatrix: completedMatrix });
      await expect(
        broker2.call('copilot-process.prepareVdmiValidation', {
          matrixId: 'vdmi-test-1',
          reason: 'Test',
        })
      ).rejects.toThrow(/does not allow nomination/);
      await broker2.stop();
    });

    it('each call produces a unique draftId', async () => {
      const [r1, r2] = await Promise.all([
        broker.call('copilot-process.prepareVdmiValidation', {
          matrixId: 'vdmi-test-1',
          reason: 'A',
        }),
        broker.call('copilot-process.prepareVdmiValidation', {
          matrixId: 'vdmi-test-1',
          reason: 'B',
        }),
      ]);
      expect(r1.draftId).not.toBe(r2.draftId);
    });
  });

  // ── draftVdmiEvidence ───────────────────────────────────────────────────────
  describe('draftVdmiEvidence (draft)', () => {
    let broker;
    beforeAll(async () => {
      broker = await buildBroker();
    });
    afterAll(() => broker.stop());

    it('requires matrixId', async () => {
      await expect(broker.call('copilot-process.draftVdmiEvidence', {})).rejects.toThrow();
    });

    it('returns evidence suggestions for open tasks', async () => {
      const result = await broker.call('copilot-process.draftVdmiEvidence', {
        matrixId: 'vdmi-test-1',
      });

      expect(result).toHaveProperty('draftId');
      expect(result).toHaveProperty('action', 'draft_evidence_for_vdmi');
      expect(result.target).toMatchObject({ matrixId: 'vdmi-test-1' });
      expect(Array.isArray(result.evidenceSuggestions)).toBe(true);
      expect(result.evidenceSuggestions.length).toBe(1); // 1 open task
      expect(result.evidenceSuggestions[0]).toHaveProperty('taskLabel');
      expect(result.evidenceSuggestions[0]).toHaveProperty('suggestion');
      expect(result).toHaveProperty('openTaskCount', 1);
      expect(result).toHaveProperty('requiredConfirmation', false);
    });

    it('returns empty suggestions when all tasks done', async () => {
      const allDoneMatrix = { ...MOCK_MATRIX, tasks: [{ id: 't1', status: 'done' }] };
      const broker2 = await buildBroker({ vdmiMatrix: allDoneMatrix });
      const result = await broker2.call('copilot-process.draftVdmiEvidence', {
        matrixId: 'vdmi-test-1',
      });
      expect(result.openTaskCount).toBe(0);
      expect(result.evidenceSuggestions).toHaveLength(0);
      expect(result.summary).toMatch(/abgeschlossen/);
      await broker2.stop();
    });

    it('includes auditTrail with requestedAt', async () => {
      const result = await broker.call('copilot-process.draftVdmiEvidence', {
        matrixId: 'vdmi-test-1',
        correlationId: 'corr-ev-1',
      });
      expect(result.auditTrail).toHaveProperty('requestedAt');
      expect(result.auditTrail).toHaveProperty('correlationId', 'corr-ev-1');
    });

    it('requiredConfirmation is always false for draft evidence', async () => {
      const result = await broker.call('copilot-process.draftVdmiEvidence', {
        matrixId: 'vdmi-test-1',
      });
      expect(result.requiredConfirmation).toBe(false);
    });
  });

  // ── prepareGridConnectionValidation ────────────────────────────────────────
  describe('prepareGridConnectionValidation (draft)', () => {
    let broker;
    beforeAll(async () => {
      broker = await buildBroker();
    });
    afterAll(() => broker.stop());

    it('requires reason', async () => {
      await expect(
        broker.call('copilot-process.prepareGridConnectionValidation', {
          gridOperatorName: 'TWL Netze',
        })
      ).rejects.toThrow();
    });

    it('rejects when no grid operator identifier given', async () => {
      await expect(
        broker.call('copilot-process.prepareGridConnectionValidation', { reason: 'Test' })
      ).rejects.toThrow(/gridOperatorId|gridOperatorBdew|gridOperatorName/);
    });

    it('returns draft validation proposal with all fields', async () => {
      const result = await broker.call('copilot-process.prepareGridConnectionValidation', {
        gridOperatorName: 'TWL Netze',
        gridOperatorId: 'SNB935578300972',
        reason: 'Jahresprüfung Q2 2026',
      });

      expect(result).toHaveProperty('draftId');
      expect(result).toHaveProperty('action', 'run_grid_connection_validation');
      expect(result.target).toMatchObject({
        gridOperatorName: 'TWL Netze',
        gridOperatorId: 'SNB935578300972',
      });
      expect(result).toHaveProperty('proposedValidation');
      expect(result.proposedValidation).toHaveProperty('gridOperatorName', 'TWL Netze');
      expect(result).toHaveProperty('summary');
      expect(result.summary).toMatch(/TWL Netze/);
      expect(result).toHaveProperty('confirmationMessage');
      expect(result).toHaveProperty('requiredConfirmation', true);
      expect(result.consequentialAction).toHaveProperty('operationId', 'executeProcessIntent');
    });

    it('accepts gridOperatorBdew as sole identifier', async () => {
      const result = await broker.call('copilot-process.prepareGridConnectionValidation', {
        gridOperatorBdew: '9907473000008',
        reason: 'Test',
      });
      expect(result).toHaveProperty('draftId');
      expect(result.target.gridOperatorBdew).toBe('9907473000008');
    });

    it('includes audit trail and idempotencyKey', async () => {
      const result = await broker.call('copilot-process.prepareGridConnectionValidation', {
        gridOperatorName: 'TWL Netze',
        reason: 'Test',
        idempotencyKey: 'idem-twl-001',
        correlationId: 'corr-gc-1',
      });
      expect(result.auditTrail.idempotencyKey).toBe('idem-twl-001');
      expect(result.auditTrail.correlationId).toBe('corr-gc-1');
      expect(result.auditTrail).toHaveProperty('requestedAt');
      expect(result.auditTrail.reason).toBe('Test');
    });

    it('includeCapacityCheck defaults to false', async () => {
      const result = await broker.call('copilot-process.prepareGridConnectionValidation', {
        gridOperatorName: 'TWL',
        reason: 'Test',
      });
      expect(result.proposedValidation.includeCapacityCheck).toBe(false);
    });

    it('includes includeCapacityCheck when true', async () => {
      const result = await broker.call('copilot-process.prepareGridConnectionValidation', {
        gridOperatorName: 'TWL',
        reason: 'Test',
        includeCapacityCheck: true,
      });
      expect(result.proposedValidation.includeCapacityCheck).toBe(true);
      expect(result.summary).toMatch(/ja/);
    });
  });
});
