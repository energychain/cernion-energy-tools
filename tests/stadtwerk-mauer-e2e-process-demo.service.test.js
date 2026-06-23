'use strict';

const fs = require('fs');
const os = require('os');
const path = require('path');
const { ServiceBroker } = require('moleculer');

const ObjectStoreService = require('../services/object-store.service');
const SandboxRuntimeService = require('../services/stadtwerk-mauer-sandbox-runtime.service');
const ExternalInterfaceStubsService = require('../services/stadtwerk-mauer-external-interface-stubs.service');
const E2eProcessDemoService = require('../services/stadtwerk-mauer-e2e-process-demo.service');

describe('stadtwerk-mauer-e2e-process-demo service', () => {
  let broker;
  let dbPath;

  beforeAll(async () => {
    dbPath = path.join(os.tmpdir(), `smm-e2e-process-demo-${Date.now()}`);
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
    broker.createService(E2eProcessDemoService);
    await broker.start();
  });

  afterAll(async () => {
    await broker.stop();
    fs.rmSync(dbPath, { recursive: true, force: true });
  });

  it('runs the PV Anmeldung demo trace with missing NAP evidence and no-call guards', async () => {
    const result = await broker.call(
      'stadtwerk-mauer-e2e-process-demo.runDemo',
      {
        caseId: 'case-266',
        electricianRegistrationRef: 'EL-42',
        contactRef: 'customer-266',
        messageTemplate: 'pv_registration_missing_nap_request',
      },
      { meta: { tenantId: 'stadtwerk-mauer' } }
    );

    expect(result.success).toBe(true);
    expect(result.demoPath).toBe('pv_registration_electrician_missing_nap');
    expect(result.trace.caseId).toBe('case-266');
    expect(result.trace.eventId).toMatch(/^smm-event:/);
    expect(result.trace.transcriptId).toMatch(/^smm-stub:/);
    expect(result.trace.rolesAndCapabilities.map((item) => item.role)).toEqual(
      expect.arrayContaining(['Elektriker', 'Netzanschluss', 'Kundenkommunikation', 'VDMI Dossier'])
    );
    expect(result.trace.missingEvidence.map((gap) => gap.missingDataPoint)).toEqual(
      expect.arrayContaining(['napReference', 'maloId', 'meloId', 'customerConsentStatus', 'meterId'])
    );
    expect(result.sourceActions.notCalled).toEqual(
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
      'stadtwerk-mauer-e2e-process-demo.getStatus',
      { caseId: 'case-266' },
      { meta: { tenantId: 'stadtwerk-mauer' } }
    );

    expect(status.status).toBe('e2e_demo_trace_needs_evidence');
    expect(status.traceCount).toBe(1);
    expect(status.artifactCount).toBe(5);
    expect(status.recentTraces[0]).toMatchObject({
      caseId: 'case-266',
      demoPath: 'pv_registration_electrician_missing_nap',
      transcriptId: result.trace.transcriptId,
    });
    expect(status.resetBoundary.service).toBe('stadtwerk-mauer-sandbox-runtime.reset');
    expect(status.dossierEvidence.rolesAndCapabilities.length).toBeGreaterThan(0);
  });

  it('rejects non-sandbox tenant demo mutations while keeping read-only status safe', async () => {
    await expect(
      broker.call(
        'stadtwerk-mauer-e2e-process-demo.runDemo',
        { caseId: 'wrong-tenant' },
        { meta: { tenantId: 'public' } }
      )
    ).rejects.toMatchObject({ type: 'SANDBOX_TENANT_REQUIRED' });

    const status = await broker.call(
      'stadtwerk-mauer-e2e-process-demo.getStatus',
      { tenantId: 'public' },
      { meta: { tenantId: 'public' } }
    );

    expect(status.status).toBe('blocked_outside_sandbox_tenant');
    expect(status.sandboxBoundaryAllowed).toBe(false);
    expect(status.traceCount).toBe(0);
    expect(status.missingEvidence.map((gap) => gap.missingDataPoint)).toContain(
      'stadtwerk_mauer_tenant_scope'
    );
  });

  it('uses the #268 sandbox reset boundary to delete demo and stub artifacts', async () => {
    const reset = await broker.call(
      'stadtwerk-mauer-sandbox-runtime.reset',
      { reason: 'e2e-demo-cleanup-proof' },
      { meta: { tenantId: 'stadtwerk-mauer' } }
    );

    expect(reset.deletedArtifactCount).toBe(15);

    const status = await broker.call(
      'stadtwerk-mauer-e2e-process-demo.getStatus',
      { caseId: 'case-266' },
      { meta: { tenantId: 'stadtwerk-mauer' } }
    );

    expect(status.status).toBe('e2e_demo_ready_for_run');
    expect(status.traceCount).toBe(0);
    expect(status.artifactCount).toBe(0);
  });
});
