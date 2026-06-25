'use strict';

const fs = require('fs');
const os = require('os');
const path = require('path');
const { ServiceBroker } = require('moleculer');

const VdmiService = require('../services/vdmi.service');
const VdmiEvidenceService = require('../services/vdmi-evidence.service');
const VdmiSpectatorService = require('../services/vdmi-spectator.service');
const VdmiHumanOverrideService = require('../services/vdmi-human-override.service');

const repoRoot = path.resolve(__dirname, '..');

describe('VDMI satellite facade alignment (#297)', () => {
  let broker;
  let dbPath;
  let previousCwd;

  beforeAll(async () => {
    previousCwd = process.cwd();
    process.chdir(repoRoot);
    fs.rmSync(path.join(repoRoot, 'data'), { recursive: true, force: true });
    fs.mkdirSync(path.join(repoRoot, 'data'), { recursive: true });

    dbPath = path.join(os.tmpdir(), `cernion-vdmi-satellite-${Date.now()}`);
    process.env.VDMI_DB_PATH = dbPath;

    broker = new ServiceBroker({ logger: false });
    broker.createService({
      name: 'hitl',
      actions: {
        create: {
          handler() {
            return { success: true, item: { id: 'hi-vdmi-satellite-1' } };
          },
        },
      },
    });
    broker.createService(VdmiService);
    new VdmiEvidenceService(broker);
    new VdmiSpectatorService(broker);
    new VdmiHumanOverrideService(broker);
    await broker.start();
  });

  afterAll(async () => {
    await broker.stop();
    process.chdir(previousCwd);
    fs.rmSync(dbPath, { recursive: true, force: true });
    fs.rmSync(path.join(repoRoot, 'data'), { recursive: true, force: true });
    delete process.env.VDMI_DB_PATH;
  });

  async function createMatrix() {
    return broker.call(
      'vdmi.create',
      {
        name: 'Satellite facade matrix',
        processId: 'job-satellite-297',
        processType: 'adhoc',
        tasks: [
          {
            taskId: 'task-satellite-297',
            taskName: 'Satellite facade task',
            executionTrace: [
              {
                eventName: 'agent.plan.step.executed',
                timestamp: '2026-06-25T13:00:00.000Z',
                payload: { serviceId: 'vdmi-test' },
                candidates: [{ role: 'D', actorId: 'vdmi-test' }],
              },
            ],
          },
        ],
      },
      { meta: { tenantId: 'tenant-a', userId: 'u-1' } }
    );
  }

  test('spectator trace delegates to canonical vdmi.negotiationTrace', async () => {
    await createMatrix();

    const result = await broker.call(
      'vdmi-spectator.negotiationTrace',
      { tenantId: 'tenant-a', taskId: 'task-satellite-297' },
      { meta: { tenantId: 'tenant-a', userRole: 'spectator', userId: 'u-1' } }
    );

    expect(result.success).toBe(true);
    expect(result.taskId).toBe('task-satellite-297');
    expect(result.trace).toHaveLength(1);
    expect(result.trace[0].eventName).toBe('agent.plan.step.executed');
  });

  test('evidence injection uses canonical vdmi.evidence when matrixId is supplied', async () => {
    const created = await createMatrix();

    const result = await broker.call(
      'vdmi-evidence.inject',
      {
        tenantId: 'tenant-a',
        taskId: 'task-satellite-297',
        evidenceType: 'manual_confirmation',
        category: 'manager_attestation',
        data: { confirmingPerson: 'manager@example.test' },
        affectedMatrix: { matrixId: created.matrix.id },
        sourceQuality: 'high',
        signatureRequired: false,
        rationale: 'Manager attestation is attached for facade alignment test',
      },
      { meta: { tenantId: 'tenant-a', userId: 'u-1' } }
    );

    expect(result.evidence.id).toMatch(/^vdmi-evidence:tenant-a:task-satellite-297:/);
    expect(result.matrixImpact.matrixId).toBe(created.matrix.id);
    expect(result.coreEvidence.reference).toBe(result.evidence.id);

    const matrix = await broker.call(
      'vdmi.get',
      { id: created.matrix.id },
      { meta: { tenantId: 'tenant-a' } }
    );
    expect(matrix.matrix.evidenceCount).toBe(1);
  });

  test('legacy task-scoped evidence without matrixId fails closed', async () => {
    await expect(
      broker.call(
        'vdmi-evidence.inject',
        {
          tenantId: 'tenant-a',
          taskId: 'task-satellite-297',
          evidenceType: 'manual_confirmation',
          category: 'manager_attestation',
          data: {},
          rationale: 'Missing matrix id must not call legacy task actions',
        },
        { meta: { tenantId: 'tenant-a', userId: 'u-1' } }
      )
    ).rejects.toMatchObject({ code: 410, type: 'VDMI_LEGACY_TASK_EVIDENCE_RETIRED' });
  });

  test('legacy role-object override fails closed instead of patching wrong matrix shape', async () => {
    const created = await createMatrix();

    await expect(
      broker.call(
        'vdmi-human-override.override',
        {
          tenantId: 'tenant-a',
          matrixId: created.matrix.id,
          overrides: {
            roles: [
              {
                roleId: 'ROLE_APP_OWNER_DEV',
                assignments: { accountable: 'owner@example.test' },
              },
            ],
          },
          rationale: 'Legacy role override lacks canonical VDMI row schema',
          changeCategory: 'data_correction',
        },
        { meta: { tenantId: 'tenant-a', userRole: 'matrix-admin', userId: 'u-1' } }
      )
    ).rejects.toMatchObject({ code: 410, type: 'VDMI_LEGACY_ROLE_OVERRIDE_RETIRED' });
  });
});
