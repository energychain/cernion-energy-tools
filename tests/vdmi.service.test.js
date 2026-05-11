'use strict';

const fs = require('fs');
const os = require('os');
const path = require('path');
const { ServiceBroker } = require('moleculer');

const VdmiService = require('../services/vdmi.service');

describe('vdmi.service', () => {
  let broker;
  let dbPath;

  beforeAll(async () => {
    dbPath = path.join(os.tmpdir(), `cernion-vdmi-test-${Date.now()}`);
    process.env.VDMI_DB_PATH = dbPath;

    broker = new ServiceBroker({ logger: false });

    broker.createService({
      name: 'hitl',
      actions: {
        create: {
          handler() {
            return { success: true, item: { id: 'hi-test-1' } };
          },
        },
      },
    });

    broker.createService(VdmiService);
    await broker.start();
  });

  afterAll(async () => {
    await broker.stop();
    fs.rmSync(dbPath, { recursive: true, force: true });
    delete process.env.VDMI_DB_PATH;
  });

  test('creates, patches and reverts matrix with audit-safe reason', async () => {
    const created = await broker.call(
      'vdmi.create',
      {
        name: 'Netzanschluss-Test',
        processId: 'job-100',
        processType: 'adhoc',
      },
      { meta: { tenantId: 'tenant-a', userId: 'u-1' } }
    );

    expect(created.success).toBe(true);
    expect(created.matrix.id).toBeDefined();

    const patched = await broker.call(
      'vdmi.update',
      {
        id: created.matrix.id,
        reason: 'Korrektur nach Fachreview',
        patch: { name: 'Netzanschluss-Test V2' },
      },
      { meta: { tenantId: 'tenant-a', userId: 'u-1' } }
    );

    expect(patched.matrix.name).toBe('Netzanschluss-Test V2');

    const reverted = await broker.call(
      'vdmi.revert',
      {
        id: created.matrix.id,
        reason: 'Rollback auf letzte freigegebene Fassung',
      },
      { meta: { tenantId: 'tenant-a', userId: 'u-1' } }
    );

    expect(reverted.success).toBe(true);
    expect(reverted.matrix.name).toBe('Netzanschluss-Test');
  });

  test('infers matrix from event sequence and exposes dossier/trace', async () => {
    const detected = await broker.call(
      'vdmi.detect',
      {
        processId: 'job-200',
        processType: 'grid-connection-approval',
        name: 'Auto Netzanschluss',
        events: [
          {
            eventName: 'agent.plan.step.executed',
            payload: { serviceId: 'grid-connection', taskId: 'task-1' },
          },
          {
            eventName: 'hitl.item.created',
            payload: { approver: 'grid_operator', taskId: 'task-1' },
          },
          {
            eventName: 'webhooks.delivered',
            payload: { recipient: 'applicant', taskId: 'task-1' },
          },
        ],
      },
      { meta: { tenantId: 'tenant-a' } }
    );

    const taskId = detected.matrix.tasks[0].taskId;

    const trace = await broker.call(
      'vdmi.negotiationTrace',
      { taskId },
      { meta: { tenantId: 'tenant-a' } }
    );
    expect(trace.success).toBe(true);
    expect(Array.isArray(trace.trace)).toBe(true);
    expect(trace.trace.length).toBeGreaterThan(0);

    const dossier = await broker.call(
      'vdmi.dossier',
      { taskId },
      { meta: { tenantId: 'tenant-a' } }
    );
    expect(dossier.success).toBe(true);
    expect(Array.isArray(dossier.dossier.options)).toBe(true);
    expect(dossier.dossier.options.length).toBe(2);
  });

  test('supports nomination and confirmation to template', async () => {
    const created = await broker.call(
      'vdmi.create',
      {
        name: 'Nomination Kandidat',
        processId: 'job-300',
        processType: 'redispatch-process',
      },
      { meta: { tenantId: 'tenant-a', userId: 'approver-1' } }
    );

    const nominated = await broker.call(
      'vdmi.nominate',
      {
        id: created.matrix.id,
        reason: 'Muster tritt stabil auf',
      },
      { meta: { tenantId: 'tenant-a', userId: 'approver-1' } }
    );
    expect(nominated.matrix.nominationStatus).toBe('pending');

    const confirmed = await broker.call(
      'vdmi.confirmNomination',
      {
        id: created.matrix.id,
        approved: true,
        reason: 'Freigabe durch HITL',
      },
      { meta: { tenantId: 'tenant-a', userId: 'approver-1' } }
    );

    expect(confirmed.success).toBe(true);
    expect(confirmed.matrix.nominationStatus).toBe('confirmed');
    expect(confirmed.template).toBeTruthy();

    const templates = await broker.call('vdmi.templates', {}, { meta: { tenantId: 'tenant-a' } });
    expect(templates.count).toBeGreaterThan(0);
  });

  test('creates and transitions governance findings', async () => {
    const events = Array.from({ length: 12 }).map((_, idx) => ({
      eventName: 'agent.plan.step.executed',
      payload: {
        serviceId: 'grid-connection',
        taskId: 'task-findings',
        round: idx + 1,
      },
    }));

    await broker.call(
      'vdmi.detect',
      {
        processId: 'job-400',
        processType: 'grid-connection-approval',
        name: 'Finding Trigger Matrix',
        events,
      },
      { meta: { tenantId: 'tenant-a' } }
    );

    await broker.call(
      'vdmi.negotiationTrace',
      { taskId: 'task-01' },
      { meta: { tenantId: 'tenant-a' } }
    );

    const findings = await broker.call(
      'vdmi.findings',
      { severity: 'K', status: 'open' },
      { meta: { tenantId: 'tenant-a' } }
    );

    expect(findings.success).toBe(true);
    expect(findings.count).toBeGreaterThan(0);

    const findingId = findings.findings[0].id;

    const mitigated = await broker.call(
      'vdmi.mitigateFinding',
      {
        findingId,
        owner: 'grid-lead',
        dueAt: '2026-12-31T00:00:00.000Z',
        plan: 'Ablösung des Schattenpfads durch API-Integration',
      },
      { meta: { tenantId: 'tenant-a', userId: 'manager-1' } }
    );
    expect(mitigated.finding.status).toBe('mitigated');

    const resolved = await broker.call(
      'vdmi.resolveFinding',
      {
        findingId,
        reason: 'Integration abgeschlossen',
        evidenceRef: 'ticket-123',
      },
      { meta: { tenantId: 'tenant-a', userId: 'manager-1' } }
    );
    expect(resolved.finding.status).toBe('resolved');
  });

  test('isolates tenant data on list reads', async () => {
    await broker.call(
      'vdmi.create',
      {
        name: 'Tenant B Matrix',
        processId: 'job-tenant-b',
      },
      { meta: { tenantId: 'tenant-b' } }
    );

    const tenantA = await broker.call('vdmi.list', {}, { meta: { tenantId: 'tenant-a' } });
    const tenantB = await broker.call('vdmi.list', {}, { meta: { tenantId: 'tenant-b' } });

    expect(tenantA.items.some((x) => x.name === 'Tenant B Matrix')).toBe(false);
    expect(tenantB.items.some((x) => x.name === 'Tenant B Matrix')).toBe(true);
  });

  test('tasks support dependsOn and blocks (Gap-5)', async () => {
    const created = await broker.call(
      'vdmi.create',
      {
        name: 'Dependency Matrix',
        processId: 'job-dep-1',
        tasks: [
          {
            taskId: 'task-1',
            taskName: 'Elektrische Pruefung',
            phase: 'execution',
            verantwortlich: [],
            durchfuehrend: [{ actorType: 'service', actorId: 'grid-connection' }],
            mitwirkend: [],
            information: [],
            dependsOn: [],
            blocks: ['task-2'],
          },
          {
            taskId: 'task-2',
            taskName: 'Transformator-Ausbau',
            phase: 'planning',
            verantwortlich: [],
            durchfuehrend: [{ actorType: 'user', actorId: 'netzplaner' }],
            mitwirkend: [],
            information: [],
            dependsOn: ['task-1'],
            blocks: [],
          },
        ],
      },
      { meta: { tenantId: 'tenant-a' } }
    );

    expect(created.success).toBe(true);
    expect(created.matrix.tasks).toHaveLength(2);

    const t1 = created.matrix.tasks.find((t) => t.taskId === 'task-1');
    const t2 = created.matrix.tasks.find((t) => t.taskId === 'task-2');

    expect(t1.dependsOn).toEqual([]);
    expect(t1.blocks).toEqual(['task-2']);
    expect(t2.dependsOn).toEqual(['task-1']);
    expect(t2.blocks).toEqual([]);

    // Verify round-trip via GET
    const fetched = await broker.call(
      'vdmi.get',
      { id: created.matrix.id },
      { meta: { tenantId: 'tenant-a' } }
    );
    const ft1 = fetched.matrix.tasks.find((t) => t.taskId === 'task-1');
    const ft2 = fetched.matrix.tasks.find((t) => t.taskId === 'task-2');
    expect(ft1.blocks).toEqual(['task-2']);
    expect(ft2.dependsOn).toEqual(['task-1']);
  });

  test('detected tasks include dependsOn and blocks arrays', async () => {
    const detected = await broker.call(
      'vdmi.detect',
      {
        processId: 'job-dep-2',
        processType: 'adhoc',
        name: 'Auto-detected dependencies',
        events: [
          {
            eventName: 'agent.plan.step.executed',
            payload: { serviceId: 'grid-connection' },
          },
        ],
      },
      { meta: { tenantId: 'tenant-a' } }
    );

    expect(detected.success).toBe(true);
    expect(detected.matrix.tasks).toHaveLength(1);
    expect(Array.isArray(detected.matrix.tasks[0].dependsOn)).toBe(true);
    expect(Array.isArray(detected.matrix.tasks[0].blocks)).toBe(true);
  });
});
