'use strict';

const fs = require('fs');
const os = require('os');
const path = require('path');
const { ServiceBroker } = require('moleculer');

const ObjectStoreService = require('../services/object-store.service');
const StadtwerkMauerSandboxRuntimeService = require('../services/stadtwerk-mauer-sandbox-runtime.service');

describe('stadtwerk-mauer-sandbox-runtime service', () => {
  let broker;
  let dbPath;

  beforeAll(async () => {
    dbPath = path.join(os.tmpdir(), `smm-sandbox-runtime-${Date.now()}`);
    broker = new ServiceBroker({ logger: false });
    broker.createService({
      ...ObjectStoreService,
      settings: {
        ...ObjectStoreService.settings,
        dbPath,
      },
    });
    broker.createService(StadtwerkMauerSandboxRuntimeService);
    await broker.start();
  });

  afterAll(async () => {
    await broker.stop();
    fs.rmSync(dbPath, { recursive: true, force: true });
  });

  it('ingests deterministic sandbox artifacts only for tenant stadtwerk-mauer', async () => {
    const result = await broker.call(
      'stadtwerk-mauer-sandbox-runtime.ingestEvent',
      {
        eventType: 'grid-connection-demo',
        caseId: 'case-268',
        payload: { assetId: 'asset-268' },
      },
      { meta: { tenantId: 'stadtwerk-mauer' } }
    );

    expect(result.success).toBe(true);
    expect(result.tenantId).toBe('stadtwerk-mauer');
    expect(result.derivedArtifactsCreated).toBe(5);
    expect(result.sourceActions.notCalled).toEqual(
      expect.arrayContaining(['mako.dispatch', 'device-control.execute', 'personal-agent.execute'])
    );

    const status = await broker.call(
      'stadtwerk-mauer-sandbox-runtime.status',
      {},
      { meta: { tenantId: 'stadtwerk-mauer' } }
    );

    expect(status.status).toBe('sandbox_state_mutated_needs_reset_proof');
    expect(status.eventCount).toBe(1);
    expect(status.artifactCount).toBe(6);
    expect(status.derivedStateInventory).toMatchObject({
      event_instance: 1,
      dossier_addition: 1,
      follow_up_proposal: 1,
      stub_transcript_placeholder: 1,
      outbox_queue_placeholder: 1,
      audit_artifact: 1,
    });
    expect(status.missingLifecycleEvidence.map((gap) => gap.missingDataPoint)).toContain(
      'reset_delete_proof'
    );
  });

  it('rejects non-sandbox tenant mutations and hides sandbox artifacts from that tenant', async () => {
    await expect(
      broker.call(
        'stadtwerk-mauer-sandbox-runtime.ingestEvent',
        { eventType: 'wrong-tenant-demo' },
        { meta: { tenantId: 'public' } }
      )
    ).rejects.toMatchObject({ type: 'SANDBOX_TENANT_REQUIRED' });

    const status = await broker.call(
      'stadtwerk-mauer-sandbox-runtime.status',
      { tenantId: 'public' },
      { meta: { tenantId: 'public' } }
    );

    expect(status.status).toBe('blocked_outside_sandbox_tenant');
    expect(status.sandboxBoundaryAllowed).toBe(false);
    expect(status.eventCount).toBe(0);
    expect(status.artifactCount).toBe(0);
    expect(status.missingLifecycleEvidence.map((gap) => gap.missingDataPoint)).toContain(
      'tenant_isolation_proof'
    );
  });

  it('records audited sandbox case annotations with duplicate-safe idempotency', async () => {
    const first = await broker.call(
      'stadtwerk-mauer-sandbox-runtime.recordCaseAnnotation',
      {
        caseId: 'smm-budibase-workbench',
        commandType: 'mark_reviewed_sandbox',
        note: 'Reviewed during handover',
        reason: 'demo proof',
        actorLabel: 'budibase:operator',
        sourceLabel: 'Cernion Stadtwerk Mauer Workbench',
        idempotencyKey: 'runtime-test-review',
      },
      { meta: { tenantId: 'stadtwerk-mauer' } }
    );

    expect(first.accepted).toBe(true);
    expect(first.duplicate).toBe(false);
    expect(first.currentDemoStatus).toBe('reviewed');
    expect(first.annotationRows[0]).toMatchObject({
      caseId: 'smm-budibase-workbench',
      commandType: 'mark_reviewed_sandbox',
      currentStatus: 'reviewed',
      dataClass: 'sandbox_runtime_artifact',
    });
    expect(first.auditRows[0]).toMatchObject({
      transitionLabel: 'needs_evidence -> reviewed',
      idempotencyKey: 'runtime-test-review',
    });

    const duplicate = await broker.call(
      'stadtwerk-mauer-sandbox-runtime.recordCaseAnnotation',
      {
        caseId: 'smm-budibase-workbench',
        commandType: 'mark_reviewed_sandbox',
        note: 'Reviewed during handover',
        reason: 'demo proof',
        actorLabel: 'budibase:operator',
        sourceLabel: 'Cernion Stadtwerk Mauer Workbench',
        idempotencyKey: 'runtime-test-review',
      },
      { meta: { tenantId: 'stadtwerk-mauer' } }
    );

    expect(duplicate.accepted).toBe(true);
    expect(duplicate.duplicate).toBe(true);
    expect(duplicate.commandId).toBe(first.commandId);

    const readback = await broker.call(
      'stadtwerk-mauer-sandbox-runtime.listCaseAnnotations',
      { caseId: 'smm-budibase-workbench' },
      { meta: { tenantId: 'stadtwerk-mauer' } }
    );

    expect(readback.status).toBe('case_annotations_ready');
    expect(readback.annotationCount).toBe(1);
    expect(readback.annotationRows[0].annotationId).toBe(first.commandId);
    expect(readback.auditRows[0].transitionLabel).toBe('needs_evidence -> reviewed');
  });

  it('returns structured safe rejections for invalid annotation commands', async () => {
    const wrongTenant = await broker.call(
      'stadtwerk-mauer-sandbox-runtime.recordCaseAnnotation',
      {
        tenantId: 'public',
        caseId: 'smm-budibase-workbench',
        commandType: 'mark_reviewed_sandbox',
        actorLabel: 'tester',
        idempotencyKey: 'wrong-tenant',
      },
      { meta: { tenantId: 'public' } }
    );
    expect(wrongTenant).toMatchObject({
      accepted: false,
      rejectionCode: 'SANDBOX_TENANT_REQUIRED',
    });

    const unknownCase = await broker.call(
      'stadtwerk-mauer-sandbox-runtime.recordCaseAnnotation',
      {
        caseId: 'unknown-case',
        commandType: 'mark_reviewed_sandbox',
        actorLabel: 'tester',
        idempotencyKey: 'unknown-case',
      },
      { meta: { tenantId: 'stadtwerk-mauer' } }
    );
    expect(unknownCase.rejectionCode).toBe('SANDBOX_CASE_REQUIRED');

    const badStatus = await broker.call(
      'stadtwerk-mauer-sandbox-runtime.recordCaseAnnotation',
      {
        caseId: 'smm-budibase-workbench',
        commandType: 'set_demo_status_sandbox',
        status: 'ship_to_production',
        actorLabel: 'tester',
        idempotencyKey: 'bad-status',
      },
      { meta: { tenantId: 'stadtwerk-mauer' } }
    );
    expect(badStatus.rejectionCode).toBe('UNSUPPORTED_STATUS');

    const missingAudit = await broker.call(
      'stadtwerk-mauer-sandbox-runtime.recordCaseAnnotation',
      {
        caseId: 'smm-budibase-workbench',
        commandType: 'add_operator_note_sandbox',
        idempotencyKey: 'missing-actor',
      },
      { meta: { tenantId: 'stadtwerk-mauer' } }
    );
    expect(missingAudit.rejectionCode).toBe('MISSING_AUDIT_METADATA');

    const overlong = await broker.call(
      'stadtwerk-mauer-sandbox-runtime.recordCaseAnnotation',
      {
        caseId: 'smm-budibase-workbench',
        commandType: 'add_operator_note_sandbox',
        note: 'x'.repeat(281),
        actorLabel: 'tester',
        idempotencyKey: 'overlong',
      },
      { meta: { tenantId: 'stadtwerk-mauer' } }
    );
    expect(overlong.rejectionCode).toBe('NOTE_TOO_LONG');
  });

  it('resets only sandbox-owned runtime artifacts and is idempotent', async () => {
    const firstReset = await broker.call(
      'stadtwerk-mauer-sandbox-runtime.reset',
      { reason: 'test-cleanup' },
      { meta: { tenantId: 'stadtwerk-mauer' } }
    );

    expect(firstReset.deletedArtifactCount).toBe(7);
    expect(firstReset.idempotent).toBe(true);

    const afterReset = await broker.call(
      'stadtwerk-mauer-sandbox-runtime.status',
      {},
      { meta: { tenantId: 'stadtwerk-mauer' } }
    );

    expect(afterReset.eventCount).toBe(0);
    expect(afterReset.artifactCount).toBe(0);
    expect(afterReset.lastResetResult.deletedArtifactCount).toBe(7);
    expect(afterReset.status).toBe('empty_sandbox_ready_for_seed');

    const secondReset = await broker.call(
      'stadtwerk-mauer-sandbox-runtime.reset',
      { reason: 'idempotency-proof' },
      { meta: { tenantId: 'stadtwerk-mauer' } }
    );

    expect(secondReset.deletedArtifactCount).toBe(0);
  });
});
