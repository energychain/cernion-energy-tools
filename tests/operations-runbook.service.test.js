'use strict';

const fs = require('fs');
const os = require('os');
const path = require('path');
const { ServiceBroker } = require('moleculer');

const tempJobDir = fs.mkdtempSync(path.join(os.tmpdir(), 'operations-runbook-jobs-'));
process.env.JOB_STORE_DIR = tempJobDir;

const OperationsRunbookService = require('../services/operations-runbook.service');
const jobStore = require('../src/job-store');

describe('operations-runbook.service', () => {
  let broker;
  let stadtwerkMauerState;

  beforeEach(async () => {
    jobStore.resetDispatchStateForTests();
    for (const file of fs.readdirSync(tempJobDir)) {
      fs.rmSync(path.join(tempJobDir, file), { recursive: true, force: true });
    }
    stadtwerkMauerState = { traces: [] };
    broker = new ServiceBroker({ logger: false });
    broker.createService(OperationsRunbookService);
    broker.createService({
      name: 'system',
      actions: {
        status: {
          handler: () => ({ status: 'ok', signal: 'green' }),
        },
      },
    });
    broker.createService({
      name: 'observability',
      actions: {
        summary: {
          handler: () => ({
            logs: { byLevel: { error: 1 }, recentErrors: [{ service: 'svc', level: 'error' }] },
            metrics: { overview: {} },
          }),
        },
      },
    });
    broker.createService({
      name: 'hitl',
      actions: {
        summary: {
          handler: () => ({
            currentQueue: { pending: 2, overdue: 1 },
            byKind: { review: 2 },
          }),
        },
        list: {
          handler: () => ({
            success: true,
            count: 1,
            items: [{ id: 'hi-1', kind: 'review', severity: 'warning', status: 'pending' }],
          }),
        },
      },
    });
    broker.createService({
      name: 'job-status',
      actions: {
        listAlarms: {
          handler: () => ({
            success: true,
            count: 1,
            alarms: [
              {
                jobId: 'job-1',
                alarm: {
                  alarmId: 'alarm-1',
                  code: 'TEST_ALARM',
                  severity: 'warning',
                  status: 'open',
                },
              },
            ],
          }),
        },
        acknowledgeAlarm: {
          handler: (ctx) => ({ success: true, alarm: { alarmId: ctx.params.alarmId } }),
        },
      },
    });
    broker.createService({
      name: 'stadtwerk-mauer-sandbox-runtime',
      actions: {
        reset: {
          handler: (ctx) => {
            const deletedArtifactCount = stadtwerkMauerState.traces.length * 5;
            stadtwerkMauerState.traces = [];
            return {
              resetId: 'smm-reset-test',
              tenantId: ctx.params.tenantId,
              deletedArtifactCount,
              deletedKeys: [],
              reason: ctx.params.reason,
            };
          },
        },
      },
    });
    broker.createService({
      name: 'stadtwerk-mauer-e2e-process-demo',
      actions: {
        runDemo: {
          handler: (ctx) => {
            const trace = {
              traceId: 'smm-trace-test',
              caseId: ctx.params.caseId,
              demoPath: ctx.params.demoPath,
              eventId: 'smm-event-test',
              transcriptId: 'smm-transcript-test',
              missingEvidence: [{ missingDataPoint: 'napReference' }],
            };
            stadtwerkMauerState.traces.push(trace);
            return {
              success: true,
              tenantId: ctx.params.tenantId,
              caseId: ctx.params.caseId,
              demoPath: ctx.params.demoPath,
              trace,
            };
          },
        },
        getStatus: {
          handler: (ctx) => {
            const recentTraces = stadtwerkMauerState.traces.filter(
              (trace) => !ctx.params.caseId || trace.caseId === ctx.params.caseId
            );
            return {
              capabilityKey: 'stadtwerk_mauer_e2e_process_demo',
              tenantId: ctx.params.tenantId,
              status:
                recentTraces.length > 0
                  ? 'e2e_demo_trace_needs_evidence'
                  : 'e2e_demo_ready_for_run',
              traceCount: recentTraces.length,
              artifactCount: recentTraces.length * 5,
              recentTraces,
              missingEvidence:
                recentTraces.length > 0
                  ? [{ missingDataPoint: 'napReference' }]
                  : [{ missingDataPoint: 'e2e_demo_trace' }],
              sourceActions: { notCalled: ['device-control.execute', 'mako.dispatch'] },
            };
          },
        },
      },
    });
    await broker.start();
  });

  afterEach(async () => {
    await broker.stop();
    delete process.env.CERNION_RUNDECK_EXECUTION_ENV;
  });

  afterAll(() => {
    fs.rmSync(tempJobDir, { recursive: true, force: true });
    delete process.env.JOB_STORE_DIR;
  });

  function meta(roles = ['rundeck-read']) {
    return {
      meta: {
        tenantId: 'stadtwerk-a',
        apiToken: {
          tenantId: 'stadtwerk-a',
          userId: 'svc:rundeck',
          scopes: roles,
        },
        authUser: {
          userId: 'svc:rundeck',
          tenantId: 'stadtwerk-a',
          roles,
        },
      },
    };
  }

  it('returns manifest metadata with runbook scopes and no dossier exposure', async () => {
    const result = await broker.call('operations-runbook.manifest', {}, meta(['rundeck-read']));
    expect(result.runbookId).toBe('manifest');
    expect(result.riskClass).toBe('read_only');
    expect(result.summary.markdown).toContain('day-start-brief');
    expect(result.summary.markdown).toContain('stadtwerk-mauer-e2e-smoke');
    expect(result.data.brokerDossierHydration.exposed).toBe(false);
  });

  it('returns a standard day-start brief envelope', async () => {
    const result = await broker.call(
      'operations-runbook.dayStartBrief',
      { correlationId: 'rundeck:test' },
      meta(['rundeck-read'])
    );
    expect(result.runbookId).toBe('day-start-brief');
    expect(result.correlationId).toBe('rundeck:test');
    expect(result.summary.markdown).toContain('Cernion day-start brief');
    expect(result.summary.counts.asyncAlarms).toBe(1);
    expect(result.status).toBe('blocked');
  });

  it('groups blocked work from HITL, alarms, and observability', async () => {
    const result = await broker.call(
      'operations-runbook.listBlockedWork',
      {},
      meta(['rundeck-read'])
    );
    expect(result.runbookId).toBe('blocked-work');
    expect(result.data.groups.map((group) => group.group)).toEqual([
      'human_review',
      'async_alarm',
      'observability',
    ]);
  });

  it('rejects ack without the dedicated rundeck-ack scope', async () => {
    await expect(
      broker.call(
        'operations-runbook.acknowledgeAlarm',
        { alarmId: 'alarm-1' },
        meta(['rundeck-read'])
      )
    ).rejects.toMatchObject({ code: 403, type: 'RUNBOOK_SCOPE_REQUIRED' });
  });

  it('acknowledges alarms with the dedicated rundeck-ack scope', async () => {
    const result = await broker.call(
      'operations-runbook.acknowledgeAlarm',
      { alarmId: 'alarm-1', reason: 'seen' },
      meta(['rundeck-ack'])
    );
    expect(result.status).toBe('executed');
    expect(result.riskClass).toBe('acknowledge');
  });

  it('rejects execute-dev without idempotency key, mode, tenant, or scope', async () => {
    const jobId = jobStore.createJob({
      service: 'svc',
      action: 'act',
      idempotencyKey: 'seed',
      wakeContext: { service: 'svc', action: 'act', params: {} },
      tenantId: 'stadtwerk-a',
    });
    await expect(
      broker.call(
        'operations-runbook.executeRevalidationDev',
        { taskId: jobId, dryRun: false, executionMode: 'dev-controlled' },
        meta(['rundeck-execute-dev'])
      )
    ).rejects.toMatchObject({ code: 400, type: 'RUNBOOK_IDEMPOTENCY_KEY_REQUIRED' });

    await expect(
      broker.call(
        'operations-runbook.executeRevalidationDev',
        {
          taskId: jobId,
          dryRun: false,
          executionMode: 'dev-controlled',
          idempotencyKey: 'rundeck:1',
        },
        meta(['rundeck-read'])
      )
    ).rejects.toMatchObject({ code: 403, type: 'RUNBOOK_SCOPE_REQUIRED' });
  });

  it('reuses the same descriptor for repeated execute-dev calls with one idempotency key', async () => {
    const jobId = jobStore.createJob({
      service: 'svc',
      action: 'act',
      idempotencyKey: 'seed',
      wakeContext: { service: 'svc', action: 'act', params: {} },
      tenantId: 'stadtwerk-a',
    });
    jobStore.updateJob(jobId, { status: 'recovery_pending' });

    const params = {
      taskId: jobId,
      dryRun: false,
      executionMode: 'dev-controlled',
      idempotencyKey: 'rundeck:job:1',
    };
    const first = await broker.call(
      'operations-runbook.executeRevalidationDev',
      params,
      meta(['rundeck-execute-dev'])
    );
    const second = await broker.call(
      'operations-runbook.executeRevalidationDev',
      params,
      meta(['rundeck-execute-dev'])
    );

    expect(first.status).toBe('executed');
    expect(second.status).toBe('completed');
    expect(second.data.result.reused).toBe(true);
    expect(second.job.jobId).toBe(first.job.jobId);
  });

  it('blocks execute-dev in production-like environments', async () => {
    process.env.CERNION_RUNDECK_EXECUTION_ENV = 'production';
    const jobId = jobStore.createJob({
      service: 'svc',
      action: 'act',
      idempotencyKey: 'seed',
      wakeContext: { service: 'svc', action: 'act', params: {} },
      tenantId: 'stadtwerk-a',
    });
    await expect(
      broker.call(
        'operations-runbook.executeRevalidationDev',
        {
          taskId: jobId,
          dryRun: false,
          executionMode: 'dev-controlled',
          idempotencyKey: 'rundeck:blocked',
        },
        meta(['rundeck-execute-dev'])
      )
    ).rejects.toMatchObject({ code: 403, type: 'RUNBOOK_PRODUCTION_GUARD' });
  });

  it('runs the Stadtwerk Mauer E2E smoke sequence through the runbook facade', async () => {
    const result = await broker.call(
      'operations-runbook.stadtwerkMauerE2eSmoke',
      {
        dryRun: false,
        executionMode: 'dev-controlled',
        idempotencyKey: 'rundeck:smm:1',
        caseId: 'smm-case-1',
      },
      meta(['rundeck-execute-dev'])
    );

    expect(result.runbookId).toBe('stadtwerk-mauer-e2e-smoke');
    expect(result.riskClass).toBe('controlled_write');
    expect(result.status).toBe('executed');
    expect(result.summary.markdown).toContain('Stadtwerk Mauer E2E smoke');
    expect(result.summary.counts.traceCountAfterRun).toBe(1);
    expect(result.summary.counts.finalTraceCount).toBe(0);
    expect(result.data.demo.success).toBe(true);
    expect(result.data.finalStatus.traceCount).toBe(0);
  });

  it('verifies the Stadtwerk Mauer Blueprint Pack seed as a read-only runbook', async () => {
    const result = await broker.call(
      'operations-runbook.verifyVdmiBlueprintPackSeed',
      {
        tenantId: 'stadtwerk-mauer',
        seedId: 'stadtwerk-mauer-pv-missing-nap-v1',
      },
      meta(['rundeck-read'])
    );

    expect(result.runbookId).toBe('vdmi-blueprint-pack-verify');
    expect(result.status).toBe('completed');
    expect(result.riskClass).toBe('read_only');
    expect(result.summary.markdown).toContain('VDMI Blueprint Pack verification');
    expect(result.summary.counts.requiredEvidence).toBe(5);
    expect(result.summary.counts.roleRelations).toBe(3);
    expect(result.data.validation).toEqual({ valid: true, errors: [] });
    expect(result.data.publicContextLayer).toMatchObject({ present: true, mutable: false });
    expect(result.data.syntheticTenantSeed).toMatchObject({ present: true, syntheticOnly: true });
    expect(result.data.sandboxRuntimeArtifacts).toMatchObject({
      present: true,
      ignoredByVerify: true,
      resettable: true,
    });
    expect(result.data.requiredEvidence).toEqual(
      expect.arrayContaining([
        'napReference',
        'maloId',
        'meloId',
        'meterId',
        'customerConsentStatus',
      ])
    );
    expect(result.data.roleRelations).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ roleId: 'ROLE_NETZPLANUNG', relation: 'verantwortlich' }),
        expect.objectContaining({ roleId: 'ROLE_GRID_OPERATOR', relation: 'mitwirkend' }),
        expect.objectContaining({ roleId: 'ROLE_COMMERCIAL_AUDIT', relation: 'information' }),
      ])
    );
    expect(result.data.workbenchProjectionHint.targetEndpoint).toBe(
      '/api/governance/role-workbench'
    );
    expect(result.data.budibaseRenderTarget).toBe('budibase:stadtwerk-mauer-workbench');
    expect(result.data.sourceActions.notCalled).toEqual(
      expect.arrayContaining([
        'blueprint-pack.load',
        'tenant.provision',
        'seed.import',
        'sandbox.reset',
        'rundeck.execute',
        'budibase.api.call',
        'hitl.create',
        'external.connector.call',
        'mako.write',
        'public-context.mutate',
        'personal-agent.execute',
      ])
    );
    expect(result.data.brokerDossierHydration.exposed).toBe(false);
  });

  it('blocks unknown Blueprint Pack seed verification without write-side effects', async () => {
    const result = await broker.call(
      'operations-runbook.verifyVdmiBlueprintPackSeed',
      { tenantId: 'stadtwerk-mauer', seedId: 'missing-seed' },
      meta(['rundeck-read'])
    );

    expect(result.status).toBe('blocked');
    expect(result.riskClass).toBe('read_only');
    expect(result.summary.counts.seedsFound).toBe(0);
    expect(result.summary.counts.validationErrors).toBeGreaterThan(0);
    expect(result.warnings).toContain('seed must be an object');
    expect(result.data.seedFound).toBe(false);
    expect(result.data.sourceActions.notCalled).toEqual(
      expect.arrayContaining(['blueprint-pack.load', 'tenant.provision', 'external.connector.call'])
    );
  });

  it('rejects Stadtwerk Mauer E2E smoke without execute-dev scope or dev mode', async () => {
    await expect(
      broker.call(
        'operations-runbook.stadtwerkMauerE2eSmoke',
        {
          dryRun: false,
          executionMode: 'dev-controlled',
          idempotencyKey: 'rundeck:smm:2',
        },
        meta(['rundeck-read'])
      )
    ).rejects.toMatchObject({ code: 403, type: 'RUNBOOK_SCOPE_REQUIRED' });

    await expect(
      broker.call(
        'operations-runbook.stadtwerkMauerE2eSmoke',
        {
          dryRun: true,
          executionMode: 'dev-controlled',
          idempotencyKey: 'rundeck:smm:3',
        },
        meta(['rundeck-execute-dev'])
      )
    ).rejects.toMatchObject({ code: 400, type: 'RUNBOOK_DRY_RUN_REQUIRED_FALSE' });
  });
});
