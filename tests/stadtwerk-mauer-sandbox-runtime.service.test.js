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

  it('resets only sandbox-owned runtime artifacts and is idempotent', async () => {
    const firstReset = await broker.call(
      'stadtwerk-mauer-sandbox-runtime.reset',
      { reason: 'test-cleanup' },
      { meta: { tenantId: 'stadtwerk-mauer' } }
    );

    expect(firstReset.deletedArtifactCount).toBe(6);
    expect(firstReset.idempotent).toBe(true);

    const afterReset = await broker.call(
      'stadtwerk-mauer-sandbox-runtime.status',
      {},
      { meta: { tenantId: 'stadtwerk-mauer' } }
    );

    expect(afterReset.eventCount).toBe(0);
    expect(afterReset.artifactCount).toBe(0);
    expect(afterReset.lastResetResult.deletedArtifactCount).toBe(6);
    expect(afterReset.status).toBe('empty_sandbox_ready_for_seed');

    const secondReset = await broker.call(
      'stadtwerk-mauer-sandbox-runtime.reset',
      { reason: 'idempotency-proof' },
      { meta: { tenantId: 'stadtwerk-mauer' } }
    );

    expect(secondReset.deletedArtifactCount).toBe(0);
  });
});
