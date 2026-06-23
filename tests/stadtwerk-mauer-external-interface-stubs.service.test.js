'use strict';

const fs = require('fs');
const os = require('os');
const path = require('path');
const { ServiceBroker } = require('moleculer');

const ObjectStoreService = require('../services/object-store.service');
const SandboxRuntimeService = require('../services/stadtwerk-mauer-sandbox-runtime.service');
const ExternalInterfaceStubsService = require('../services/stadtwerk-mauer-external-interface-stubs.service');

describe('stadtwerk-mauer-external-interface-stubs service', () => {
  let broker;
  let dbPath;

  beforeAll(async () => {
    dbPath = path.join(os.tmpdir(), `smm-external-interface-stubs-${Date.now()}`);
    broker = new ServiceBroker({ logger: false });
    broker.createService({
      ...ObjectStoreService,
      settings: {
        ...ObjectStoreService.settings,
        dbPath,
      },
    });
    broker.createService(SandboxRuntimeService);
    broker.createService(ExternalInterfaceStubsService);
    await broker.start();
  });

  afterAll(async () => {
    await broker.stop();
    fs.rmSync(dbPath, { recursive: true, force: true });
  });

  it('creates deterministic sandbox stub transcripts and no-call guards', async () => {
    const mako = await broker.call(
      'stadtwerk-mauer-external-interface-stubs.callStub',
      {
        stubFamily: 'mako_lieferantenwechsel',
        caseId: 'case-267',
        request: { maloId: 'DE001', meloId: 'MELO-1', supplierRef: 'LF-ALT' },
      },
      { meta: { tenantId: 'stadtwerk-mauer' } }
    );
    const control = await broker.call(
      'stadtwerk-mauer-external-interface-stubs.callStub',
      {
        stubFamily: 'control_device_boundary',
        responseVariant: 'deadline_risk',
        request: { assetId: 'asset-267' },
      },
      { meta: { tenantId: 'stadtwerk-mauer' } }
    );

    expect(mako.success).toBe(true);
    expect(mako.transcript.responseVariant).toBe('success');
    expect(control.transcript.responseVariant).toBe('deadline_risk');
    expect(control.transcript.missingEvidence.map((gap) => gap.missingDataPoint)).toEqual(
      expect.arrayContaining(['controlScope', 'technicalBoundary'])
    );
    expect(mako.sourceActions.notCalled).toEqual(
      expect.arrayContaining([
        'mako.dispatch',
        'customer-service.send',
        'billing.release',
        'device-control.execute',
        'external.connector.call',
        'personal-agent.execute',
      ])
    );

    const status = await broker.call(
      'stadtwerk-mauer-external-interface-stubs.getStatus',
      {},
      { meta: { tenantId: 'stadtwerk-mauer' } }
    );

    expect(status.status).toBe('stub_transcripts_need_evidence');
    expect(status.transcriptCount).toBe(2);
    expect(status.artifactCount).toBe(8);
    expect(status.familyCounts.mako_lieferantenwechsel).toBe(1);
    expect(status.familyCounts.control_device_boundary).toBe(1);
    expect(status.variantCounts.success).toBe(1);
    expect(status.variantCounts.deadline_risk).toBe(1);
    expect(status.recentTranscripts[0]).toMatchObject({
      stubFamily: expect.any(String),
      responseVariant: expect.any(String),
    });
    expect(status.resetBoundary.service).toBe('stadtwerk-mauer-sandbox-runtime.reset');
  });

  it('rejects non-sandbox tenant mutations while keeping read-only status safe', async () => {
    await expect(
      broker.call(
        'stadtwerk-mauer-external-interface-stubs.callStub',
        { stubFamily: 'mako_lieferantenwechsel', request: {} },
        { meta: { tenantId: 'public' } }
      )
    ).rejects.toMatchObject({ type: 'SANDBOX_TENANT_REQUIRED' });

    const status = await broker.call(
      'stadtwerk-mauer-external-interface-stubs.getStatus',
      { tenantId: 'public' },
      { meta: { tenantId: 'public' } }
    );

    expect(status.status).toBe('blocked_outside_sandbox_tenant');
    expect(status.sandboxBoundaryAllowed).toBe(false);
    expect(status.transcriptCount).toBe(0);
    expect(status.missingEvidence.map((gap) => gap.missingDataPoint)).toContain(
      'stadtwerk_mauer_tenant_scope'
    );
  });

  it('uses the #268 sandbox reset boundary to delete stub artifacts', async () => {
    const reset = await broker.call(
      'stadtwerk-mauer-sandbox-runtime.reset',
      { reason: 'stub-cleanup-proof' },
      { meta: { tenantId: 'stadtwerk-mauer' } }
    );

    expect(reset.deletedArtifactCount).toBe(8);

    const status = await broker.call(
      'stadtwerk-mauer-external-interface-stubs.getStatus',
      {},
      { meta: { tenantId: 'stadtwerk-mauer' } }
    );

    expect(status.status).toBe('stub_layer_ready_for_transcripts');
    expect(status.transcriptCount).toBe(0);
    expect(status.artifactCount).toBe(0);
  });
});
