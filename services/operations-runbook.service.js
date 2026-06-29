'use strict';

const crypto = require('crypto');
const { Errors } = require('moleculer');
const jobStore = require('../src/job-store');
const tracing = require('../src/tracing');
const { getTenantId } = require('../src/tenant-context');
const { hasRole } = require('../src/auth/rbac');
const {
  buildWorkbenchClarificationItems,
  getVdmiBlueprintPackSeed,
  validateVdmiBlueprintPackSeed,
} = require('../src/vdmi-blueprint-pack-seeds');

const OPENAPI_TAG = 'Operations Runbook';
const RUNBOOK_SCOPES = {
  read: 'rundeck-read',
  dryRun: 'rundeck-dry-run',
  ack: 'rundeck-ack',
  executeDev: 'rundeck-execute-dev',
};
const STADTWERK_MAUER_TENANT_ID = 'stadtwerk-mauer';
const STADTWERK_MAUER_DEMO_PATH = 'pv_registration_electrician_missing_nap';
const STADTWERK_MAUER_BLUEPRINT_SEED_ID = 'stadtwerk-mauer-pv-missing-nap-v1';

function nowIso() {
  return new Date().toISOString();
}

function normalizeString(value, fallback = '') {
  const raw = String(value ?? '').trim();
  return raw || fallback;
}

function countBy(items, field) {
  return (Array.isArray(items) ? items : []).reduce((acc, item) => {
    const value = normalizeString(item?.[field], 'unknown');
    acc[value] = (acc[value] || 0) + 1;
    return acc;
  }, {});
}

function isProductionLike() {
  const markers = [
    process.env.CERNION_RUNDECK_EXECUTION_ENV,
    process.env.CERNION_ENV,
    process.env.CERNION_RUNTIME_ENV,
    process.env.APP_ENV,
    process.env.NODE_ENV,
  ]
    .map((value) =>
      String(value || '')
        .trim()
        .toLowerCase()
    )
    .filter(Boolean);
  return markers.some((value) => ['prod', 'production'].includes(value));
}

module.exports = {
  name: 'operations-runbook',

  settings: {
    defaultGrafanaUrl: process.env.CERNION_GRAFANA_URL || null,
    defaultJaegerUrl: process.env.CERNION_JAEGER_URL || null,
  },

  actions: {
    manifest: {
      rest: 'GET /manifest',
      openapi: {
        summary: 'List curated Cernion operations runbooks',
        tags: [OPENAPI_TAG],
      },
      handler(ctx) {
        this.requireScope(ctx, RUNBOOK_SCOPES.read);
        return this.buildEnvelope(ctx, {
          runbookId: 'manifest',
          status: 'completed',
          riskClass: 'read_only',
          title: 'Operations runbook manifest',
          markdown: this.buildManifestMarkdown(),
          counts: { runbooks: this.getManifest().runbooks.length },
          data: this.getManifest(),
          nextActions: ['Run day-start-brief', 'Inspect blocked-work'],
        });
      },
    },

    dayStartBrief: {
      rest: 'POST /day-start-brief',
      params: {
        correlationId: { type: 'string', optional: true, trim: true, max: 160 },
        requestedBy: { type: 'string', optional: true, trim: true, max: 160 },
        sinceMinutes: {
          type: 'number',
          integer: true,
          optional: true,
          min: 1,
          max: 7 * 24 * 60,
          convert: true,
        },
      },
      openapi: {
        summary: 'Build a concise day-start operations brief',
        tags: [OPENAPI_TAG],
      },
      async handler(ctx) {
        this.requireScope(ctx, RUNBOOK_SCOPES.read);
        const [system, observability, hitl, alarms] = await Promise.all([
          this.safeCall(ctx, 'system.status', { verbose: false }),
          this.safeCall(ctx, 'observability.summary', {
            sinceMinutes: ctx.params.sinceMinutes || 60,
            limit: 5,
          }),
          this.safeCall(ctx, 'hitl.summary', { sinceDays: 30 }),
          this.safeCall(ctx, 'job-status.listAlarms', { status: 'open', limit: 25 }),
        ]);

        const alarmCount = Number(alarms?.count ?? alarms?.alarms?.length ?? 0);
        const hitlPending = Number(hitl?.currentQueue?.pending ?? 0);
        const hitlOverdue = Number(hitl?.currentQueue?.overdue ?? 0);
        const errorCount = Number(observability?.logs?.byLevel?.error ?? 0);
        const status = alarmCount || hitlOverdue || errorCount ? 'blocked' : 'completed';
        const markdown = [
          '## Cernion day-start brief',
          `- System: ${system?.status || system?.signal || 'unknown'}`,
          `- Open async alarms: ${alarmCount}`,
          `- HITL pending / overdue: ${hitlPending} / ${hitlOverdue}`,
          `- Recent observability errors: ${errorCount}`,
        ].join('\n');

        return this.buildEnvelope(ctx, {
          runbookId: 'day-start-brief',
          status,
          riskClass: 'read_only',
          title: 'Day-start brief',
          markdown,
          counts: {
            asyncAlarms: alarmCount,
            hitlPending,
            hitlOverdue,
            observabilityErrors: errorCount,
          },
          data: { system, observability, hitl, alarms },
          nextActions: alarmCount || hitlPending ? ['Open blocked-work'] : [],
        });
      },
    },

    listBlockedWork: {
      rest: 'GET /blocked-work',
      params: {
        limit: { type: 'number', integer: true, optional: true, min: 1, max: 100, convert: true },
      },
      openapi: {
        summary: 'List grouped operational blockers for human operators',
        tags: [OPENAPI_TAG],
      
        parameters: [
          { in: 'query', name: 'limit', schema: { type: 'number' } },
        ],
      },
      async handler(ctx) {
        this.requireScope(ctx, RUNBOOK_SCOPES.read);
        const limit = ctx.params.limit || 50;
        const [hitl, alarms, observability] = await Promise.all([
          this.safeCall(ctx, 'hitl.list', { status: 'pending', limit }),
          this.safeCall(ctx, 'job-status.listAlarms', { status: 'open', limit }),
          this.safeCall(ctx, 'observability.summary', { limit: 10, sinceMinutes: 60 }),
        ]);

        const groups = this.buildBlockedWorkGroups({ hitl, alarms, observability });
        const markdown = this.buildBlockedWorkMarkdown(groups);
        const total = groups.reduce((sum, group) => sum + group.count, 0);

        return this.buildEnvelope(ctx, {
          runbookId: 'blocked-work',
          status: total > 0 ? 'blocked' : 'completed',
          riskClass: 'read_only',
          title: 'Blocked work',
          markdown,
          counts: {
            total,
            byGroup: groups.reduce((acc, group) => {
              acc[group.group] = group.count;
              return acc;
            }, {}),
          },
          data: { groups },
          nextActions:
            total > 0 ? ['Acknowledge alarms after inspection', 'Resolve HITL items'] : [],
        });
      },
    },

    optionValues: {
      rest: 'GET /options/:name',
      params: {
        name: { type: 'string', min: 1, trim: true },
        tenantId: { type: 'string', optional: true, trim: true },
        state: { type: 'string', optional: true, trim: true },
      },
      openapi: {
        summary: 'Return simple option values for Rundeck job prompts',
        tags: [OPENAPI_TAG],
      
        parameters: [
          { in: 'path', name: 'name', required: true, schema: { type: 'string' } },
          { in: 'query', name: 'tenantId', schema: { type: 'string' } },
          { in: 'query', name: 'state', schema: { type: 'string' } },
        ],
      },
      async handler(ctx) {
        this.requireScope(ctx, RUNBOOK_SCOPES.read);
        const values = await this.resolveOptions(ctx, ctx.params.name);
        return values;
      },
    },

    acknowledgeAlarm: {
      rest: 'POST /alarms/:alarmId/ack',
      params: {
        alarmId: { type: 'string', min: 1, trim: true },
        correlationId: { type: 'string', optional: true, trim: true, max: 160 },
        requestedBy: { type: 'string', optional: true, trim: true, max: 160 },
        reason: { type: 'string', optional: true, trim: true, max: 1000 },
      },
      openapi: {
        summary: 'Acknowledge an async watchdog alarm through the runbook facade',
        tags: [OPENAPI_TAG],
      },
      async handler(ctx) {
        this.requireScope(ctx, RUNBOOK_SCOPES.ack);
        const result = await ctx.call('job-status.acknowledgeAlarm', {
          alarmId: ctx.params.alarmId,
          actor: ctx.params.requestedBy || this.getActor(ctx),
          note: ctx.params.reason || 'Acknowledged via operations-runbook',
        });
        const success = Boolean(result?.success);
        return this.buildEnvelope(ctx, {
          runbookId: 'alarm-ack',
          status: success ? 'executed' : 'blocked',
          riskClass: 'acknowledge',
          title: 'Alarm acknowledgement',
          markdown: success
            ? `Acknowledged alarm ${ctx.params.alarmId}.`
            : `Alarm ${ctx.params.alarmId} could not be acknowledged.`,
          counts: { acknowledged: success ? 1 : 0 },
          data: result,
          warnings: success ? [] : [result?.message || 'alarm_not_found'],
        });
      },
    },

    revalidationDryRun: {
      rest: 'POST /revalidation/:taskId/dry-run',
      params: {
        taskId: { type: 'string', min: 1, trim: true },
        correlationId: { type: 'string', optional: true, trim: true, max: 160 },
        requestedBy: { type: 'string', optional: true, trim: true, max: 160 },
        reason: { type: 'string', optional: true, trim: true, max: 1000 },
      },
      openapi: {
        summary: 'Preview a curated DevServer revalidation action',
        tags: [OPENAPI_TAG],
      },
      handler(ctx) {
        this.requireScope(ctx, RUNBOOK_SCOPES.dryRun);
        const task = jobStore.getJob(ctx.params.taskId);
        const blocked = !task;
        return this.buildEnvelope(ctx, {
          runbookId: 'revalidation-dry-run',
          status: blocked ? 'blocked' : 'dry_run',
          riskClass: 'dry_run',
          title: 'Revalidation dry-run',
          markdown: blocked
            ? `Task ${ctx.params.taskId} was not found; no revalidation would run.`
            : `Task ${ctx.params.taskId} would request a controlled wake-up/revalidation.`,
          counts: { tasksFound: blocked ? 0 : 1 },
          data: {
            taskId: ctx.params.taskId,
            task: task
              ? {
                  jobId: task.jobId,
                  service: task.service,
                  action: task.action,
                  status: task.status,
                  idempotencyKey: task.idempotencyKey || null,
                }
              : null,
          },
          warnings: blocked ? ['task_not_found'] : [],
        });
      },
    },

    executeRevalidationDev: {
      rest: 'POST /revalidation/:taskId/execute',
      params: {
        taskId: { type: 'string', min: 1, trim: true },
        dryRun: { type: 'boolean', optional: true, convert: true },
        executionMode: { type: 'string', optional: true, trim: true },
        idempotencyKey: { type: 'string', optional: true, trim: true, max: 256 },
        correlationId: { type: 'string', optional: true, trim: true, max: 160 },
        requestedBy: { type: 'string', optional: true, trim: true, max: 160 },
        reason: { type: 'string', optional: true, trim: true, max: 1000 },
      },
      openapi: {
        summary: 'Execute a guarded DevServer revalidation action',
        tags: [OPENAPI_TAG],
      },
      handler(ctx) {
        this.requireScope(ctx, RUNBOOK_SCOPES.executeDev);
        this.assertTenantBound(ctx);
        if (ctx.params.dryRun !== false) {
          throw new Errors.MoleculerClientError(
            'Dev controlled execution requires dryRun:false.',
            400,
            'RUNBOOK_DRY_RUN_REQUIRED_FALSE'
          );
        }
        if (ctx.params.executionMode !== 'dev-controlled') {
          throw new Errors.MoleculerClientError(
            'Dev controlled execution requires executionMode:"dev-controlled".',
            400,
            'RUNBOOK_EXECUTION_MODE_REQUIRED'
          );
        }
        if (!ctx.params.idempotencyKey) {
          throw new Errors.MoleculerClientError(
            'Dev controlled execution requires idempotencyKey.',
            400,
            'RUNBOOK_IDEMPOTENCY_KEY_REQUIRED'
          );
        }
        if (isProductionLike()) {
          throw new Errors.MoleculerClientError(
            'Dev controlled execution is disabled in production-like environments.',
            403,
            'RUNBOOK_PRODUCTION_GUARD'
          );
        }

        const result = jobStore.requestWakeUp(ctx.params.taskId, {
          broker: this.broker,
          actor: ctx.params.requestedBy || this.getActor(ctx),
          reason: ctx.params.reason || 'rundeck-dev-controlled-revalidation',
          idempotencyKey: ctx.params.idempotencyKey,
        });

        const accepted = Boolean(result?.accepted);
        const reused = Boolean(result?.reused);
        return this.buildEnvelope(ctx, {
          runbookId: 'revalidation-execute-dev',
          status: accepted ? (reused ? 'completed' : 'executed') : 'blocked',
          riskClass: 'controlled_write',
          title: 'Dev controlled revalidation',
          markdown: accepted
            ? `Accepted DevServer revalidation for task ${ctx.params.taskId}.`
            : `DevServer revalidation for task ${ctx.params.taskId} was blocked: ${result?.reason || 'unknown'}.`,
          counts: { accepted: accepted ? 1 : 0, reused: reused ? 1 : 0 },
          data: {
            taskId: ctx.params.taskId,
            idempotencyKey: ctx.params.idempotencyKey,
            result,
          },
          job: accepted
            ? {
                jobId: result.wakeJobId || ctx.params.taskId,
                statusUrl: `/api/jobs/${ctx.params.taskId}/status`,
                progressUrl: `/api/jobs/${ctx.params.taskId}/progress`,
                resultUrl: `/api/jobs/${ctx.params.taskId}/result`,
              }
            : null,
          warnings: accepted ? [] : [result?.reason || 'execution_blocked'],
        });
      },
    },

    stadtwerkMauerE2eSmoke: {
      rest: 'POST /stadtwerk-mauer/e2e-smoke',
      params: {
        tenantId: { type: 'string', optional: true, trim: true },
        caseId: { type: 'string', optional: true, trim: true, max: 160 },
        dryRun: { type: 'boolean', optional: true, convert: true },
        executionMode: { type: 'string', optional: true, trim: true },
        idempotencyKey: { type: 'string', optional: true, trim: true, max: 256 },
        correlationId: { type: 'string', optional: true, trim: true, max: 160 },
        requestedBy: { type: 'string', optional: true, trim: true, max: 160 },
        resetBeforeRun: { type: 'boolean', optional: true, convert: true },
        finalReset: { type: 'boolean', optional: true, convert: true },
      },
      openapi: {
        summary: 'Run the Stadtwerk Mauer sandbox E2E demo smoke sequence',
        tags: [OPENAPI_TAG],
      },
      async handler(ctx) {
        this.requireScope(ctx, RUNBOOK_SCOPES.executeDev);
        this.assertTenantBound(ctx);
        if (ctx.params.dryRun !== false) {
          throw new Errors.MoleculerClientError(
            'Stadtwerk Mauer E2E smoke requires dryRun:false.',
            400,
            'RUNBOOK_DRY_RUN_REQUIRED_FALSE'
          );
        }
        if (ctx.params.executionMode !== 'dev-controlled') {
          throw new Errors.MoleculerClientError(
            'Stadtwerk Mauer E2E smoke requires executionMode:"dev-controlled".',
            400,
            'RUNBOOK_EXECUTION_MODE_REQUIRED'
          );
        }
        if (!ctx.params.idempotencyKey) {
          throw new Errors.MoleculerClientError(
            'Stadtwerk Mauer E2E smoke requires idempotencyKey.',
            400,
            'RUNBOOK_IDEMPOTENCY_KEY_REQUIRED'
          );
        }
        if (isProductionLike()) {
          throw new Errors.MoleculerClientError(
            'Stadtwerk Mauer E2E smoke is disabled in production-like environments.',
            403,
            'RUNBOOK_PRODUCTION_GUARD'
          );
        }

        const tenantId = ctx.params.tenantId || STADTWERK_MAUER_TENANT_ID;
        if (tenantId !== STADTWERK_MAUER_TENANT_ID) {
          throw new Errors.MoleculerClientError(
            'Stadtwerk Mauer E2E smoke can run only for tenant stadtwerk-mauer.',
            403,
            'RUNBOOK_STADTWERK_MAUER_TENANT_REQUIRED',
            { tenantId, requiredTenantId: STADTWERK_MAUER_TENANT_ID }
          );
        }

        const finalReset = ctx.params.finalReset !== false;
        const resetBeforeRun = ctx.params.resetBeforeRun !== false;
        const caseId =
          ctx.params.caseId ||
          `smm-rundeck:${crypto
            .createHash('sha256')
            .update(ctx.params.idempotencyKey)
            .digest('hex')
            .slice(0, 12)}`;

        const initialStatus = await ctx.call('stadtwerk-mauer-e2e-process-demo.getStatus', {
          tenantId,
          caseId,
          limit: 5,
        });

        const preReset = resetBeforeRun
          ? await ctx.call('stadtwerk-mauer-sandbox-runtime.reset', {
              tenantId,
              reason: 'rundeck-stadtwerk-mauer-e2e-smoke-pre-reset',
            })
          : null;

        const demo = await ctx.call('stadtwerk-mauer-e2e-process-demo.runDemo', {
          tenantId,
          caseId,
          demoPath: STADTWERK_MAUER_DEMO_PATH,
          resetBeforeRun: false,
          electricianRegistrationRef: 'rundeck-demo-electrician-registration',
          contactRef: 'rundeck-demo-contact-placeholder',
          messageTemplate: 'pv_registration_missing_nap_request',
          pvPlantKw: 42,
        });

        const afterRunStatus = await ctx.call('stadtwerk-mauer-e2e-process-demo.getStatus', {
          tenantId,
          caseId,
          limit: 5,
        });

        const postReset = finalReset
          ? await ctx.call('stadtwerk-mauer-sandbox-runtime.reset', {
              tenantId,
              reason: 'rundeck-stadtwerk-mauer-e2e-smoke-final-reset',
            })
          : null;

        const finalStatus = await ctx.call('stadtwerk-mauer-e2e-process-demo.getStatus', {
          tenantId,
          caseId,
          limit: 5,
        });

        return this.buildEnvelope(ctx, {
          runbookId: 'stadtwerk-mauer-e2e-smoke',
          status: finalReset && Number(finalStatus.traceCount || 0) !== 0 ? 'blocked' : 'executed',
          riskClass: 'controlled_write',
          title: 'Stadtwerk Mauer E2E smoke',
          markdown: this.buildStadtwerkMauerSmokeMarkdown({
            caseId,
            initialStatus,
            preReset,
            demo,
            afterRunStatus,
            postReset,
            finalStatus,
          }),
          counts: {
            initialTraceCount: Number(initialStatus.traceCount || 0),
            traceCountAfterRun: Number(afterRunStatus.traceCount || 0),
            artifactCountAfterRun: Number(afterRunStatus.artifactCount || 0),
            finalTraceCount: Number(finalStatus.traceCount || 0),
            finalResetDeleted: Number(postReset?.deletedArtifactCount || 0),
          },
          data: {
            tenantId,
            caseId,
            demoPath: STADTWERK_MAUER_DEMO_PATH,
            idempotencyKey: ctx.params.idempotencyKey,
            resetBeforeRun,
            finalReset,
            initialStatus,
            preReset,
            demo,
            afterRunStatus,
            postReset,
            finalStatus,
          },
          warnings:
            finalReset && Number(finalStatus.traceCount || 0) !== 0
              ? ['final_reset_left_traces']
              : [],
        });
      },
    },

    verifyVdmiBlueprintPackSeed: {
      rest: 'GET /vdmi-blueprint-packs/verify',
      params: {
        tenantId: { type: 'string', optional: true, trim: true },
        seedId: { type: 'string', optional: true, trim: true },
        correlationId: { type: 'string', optional: true, trim: true, max: 160 },
        requestedBy: { type: 'string', optional: true, trim: true, max: 160 },
      },
      openapi: {
        summary: 'Verify a read-only VDMI Blueprint Pack seed for Rundeck and Budibase',
        tags: [OPENAPI_TAG],
      
        parameters: [
          { in: 'query', name: 'tenantId', schema: { type: 'string' } },
          { in: 'query', name: 'seedId', schema: { type: 'string' } },
          { in: 'query', name: 'correlationId', schema: { type: 'string' } },
          { in: 'query', name: 'requestedBy', schema: { type: 'string' } },
        ],
      },
      handler(ctx) {
        this.requireScope(ctx, RUNBOOK_SCOPES.read);
        const tenantId = ctx.params.tenantId || STADTWERK_MAUER_TENANT_ID;
        const seedId = ctx.params.seedId || STADTWERK_MAUER_BLUEPRINT_SEED_ID;
        const seed = getVdmiBlueprintPackSeed(seedId);
        const validation = validateVdmiBlueprintPackSeed(seed);
        const verification = this.buildVdmiBlueprintPackVerification({
          tenantId,
          seedId,
          seed,
          validation,
        });
        return this.buildEnvelope(ctx, {
          runbookId: 'vdmi-blueprint-pack-verify',
          status: validation.valid ? 'completed' : 'blocked',
          riskClass: 'read_only',
          title: 'VDMI Blueprint Pack verification',
          markdown: this.buildVdmiBlueprintPackVerifyMarkdown(verification),
          counts: verification.counts,
          data: verification.data,
          warnings: verification.warnings,
          nextActions: verification.nextActions,
        });
      },
    },
  },

  methods: {
    getManifest() {
      return {
        generatedAt: nowIso(),
        service: 'operations-runbook',
        scopes: RUNBOOK_SCOPES,
        brokerDossierHydration: {
          exposed: false,
          reason: 'This slice is an operations facade; dossier exposure is intentionally deferred.',
        },
        runbooks: [
          {
            id: 'day-start-brief',
            method: 'POST',
            path: '/api/operations-runbook/day-start-brief',
            riskClass: 'read_only',
            requiredScope: RUNBOOK_SCOPES.read,
          },
          {
            id: 'blocked-work',
            method: 'GET',
            path: '/api/operations-runbook/blocked-work',
            riskClass: 'read_only',
            requiredScope: RUNBOOK_SCOPES.read,
          },
          {
            id: 'alarm-ack',
            method: 'POST',
            path: '/api/operations-runbook/alarms/:alarmId/ack',
            riskClass: 'acknowledge',
            requiredScope: RUNBOOK_SCOPES.ack,
          },
          {
            id: 'revalidation-dry-run',
            method: 'POST',
            path: '/api/operations-runbook/revalidation/:taskId/dry-run',
            riskClass: 'dry_run',
            requiredScope: RUNBOOK_SCOPES.dryRun,
          },
          {
            id: 'revalidation-execute-dev',
            method: 'POST',
            path: '/api/operations-runbook/revalidation/:taskId/execute',
            riskClass: 'controlled_write',
            requiredScope: RUNBOOK_SCOPES.executeDev,
          },
          {
            id: 'stadtwerk-mauer-e2e-smoke',
            method: 'POST',
            path: '/api/operations-runbook/stadtwerk-mauer/e2e-smoke',
            riskClass: 'controlled_write',
            requiredScope: RUNBOOK_SCOPES.executeDev,
          },
          {
            id: 'vdmi-blueprint-pack-verify',
            method: 'GET',
            path: '/api/operations-runbook/vdmi-blueprint-packs/verify',
            riskClass: 'read_only',
            requiredScope: RUNBOOK_SCOPES.read,
          },
        ],
        options: ['tenants', 'runbooks', 'blocked-work', 'revalidation-tasks', 'open-hitl-kinds'],
      };
    },

    requireScope(ctx, scope) {
      const roles = ctx?.meta?.authUser?.roles || [];
      if (hasRole(roles, scope)) return;
      throw new Errors.MoleculerClientError(
        `Role required: ${scope} for operations-runbook action.`,
        403,
        'RUNBOOK_SCOPE_REQUIRED'
      );
    },

    assertTenantBound(ctx) {
      const token = ctx?.meta?.apiToken;
      const user = ctx?.meta?.authUser;
      if (token?.tenantId || user?.tenantId || ctx?.meta?.tenantId) return;
      throw new Errors.MoleculerClientError(
        'Dev controlled execution requires tenant-bound auth.',
        403,
        'RUNBOOK_TENANT_REQUIRED'
      );
    },

    getActor(ctx) {
      return (
        ctx?.meta?.authUser?.userId ||
        ctx?.meta?.apiToken?.userId ||
        ctx?.meta?.apiToken?.name ||
        'rundeck-operator'
      );
    },

    buildEnvelope(ctx, options) {
      const correlationId =
        normalizeString(ctx?.params?.correlationId) ||
        normalizeString(ctx?.meta?.correlationId) ||
        tracing.ensureCorrelationId(ctx.meta);
      ctx.meta.correlationId = correlationId;
      const traceId = normalizeString(ctx?.meta?.traceId) || crypto.randomUUID();
      const tenantId = getTenantId(ctx);
      return {
        success: options.status !== 'failed',
        runbookId: options.runbookId,
        status: options.status,
        riskClass: options.riskClass,
        tenantId,
        correlationId,
        traceId,
        generatedAt: nowIso(),
        job: options.job || null,
        summary: {
          title: options.title,
          markdown: options.markdown,
          counts: options.counts || {},
        },
        links: this.buildLinks(traceId),
        nextActions: options.nextActions || [],
        warnings: options.warnings || [],
        data: options.data || {},
      };
    },

    buildLinks(traceId) {
      const links = { openApiUrl: '/api/docs' };
      if (this.settings.defaultGrafanaUrl) links.grafanaUrl = this.settings.defaultGrafanaUrl;
      if (this.settings.defaultJaegerUrl) {
        links.jaegerTraceUrl = `${this.settings.defaultJaegerUrl.replace(/\/$/, '')}/trace/${traceId}`;
      }
      return links;
    },

    buildManifestMarkdown() {
      return this.getManifest()
        .runbooks.map((runbook) => `- ${runbook.id}: ${runbook.riskClass}`)
        .join('\n');
    },

    buildBlockedWorkGroups({ hitl, alarms, observability }) {
      const hitlItems = Array.isArray(hitl?.items) ? hitl.items : [];
      const alarmItems = Array.isArray(alarms?.alarms) ? alarms.alarms : [];
      const recentErrors = Array.isArray(observability?.logs?.recentErrors)
        ? observability.logs.recentErrors
        : [];
      const groups = [];
      if (hitlItems.length > 0) {
        groups.push({
          group: 'human_review',
          count: hitlItems.length,
          counts: {
            byKind: countBy(hitlItems, 'kind'),
            bySeverity: countBy(hitlItems, 'severity'),
          },
          items: hitlItems,
        });
      }
      if (alarmItems.length > 0) {
        groups.push({
          group: 'async_alarm',
          count: alarmItems.length,
          counts: {
            bySeverity: countBy(
              alarmItems.map((item) => item.alarm || item),
              'severity'
            ),
          },
          items: alarmItems,
        });
      }
      if (recentErrors.length > 0) {
        groups.push({
          group: 'observability',
          count: recentErrors.length,
          counts: { byService: countBy(recentErrors, 'service') },
          items: recentErrors,
        });
      }
      return groups;
    },

    buildBlockedWorkMarkdown(groups) {
      if (!Array.isArray(groups) || groups.length === 0) {
        return 'No blocked operational work is currently visible through the runbook facade.';
      }
      return ['## Blocked work']
        .concat(groups.map((group) => `- ${group.group}: ${group.count}`))
        .join('\n');
    },

    buildStadtwerkMauerSmokeMarkdown({
      caseId,
      initialStatus,
      preReset,
      demo,
      afterRunStatus,
      postReset,
      finalStatus,
    }) {
      const missingEvidence = Array.isArray(afterRunStatus?.missingEvidence)
        ? afterRunStatus.missingEvidence.map((item) => item.missingDataPoint).filter(Boolean)
        : [];
      const notCalled = Array.isArray(afterRunStatus?.sourceActions?.notCalled)
        ? afterRunStatus.sourceActions.notCalled
        : [];
      const recentTrace = Array.isArray(afterRunStatus?.recentTraces)
        ? afterRunStatus.recentTraces[0]
        : null;
      return [
        '## Stadtwerk Mauer E2E smoke',
        `- Case: ${caseId}`,
        `- Initial status: ${initialStatus?.status || 'unknown'} (${initialStatus?.traceCount || 0} traces)`,
        `- Pre-reset deleted: ${preReset ? preReset.deletedArtifactCount : 0}`,
        `- Demo run: ${demo?.success ? 'success' : 'unknown'}`,
        `- Trace after run: ${recentTrace?.traceId || demo?.trace?.traceId || 'missing'}`,
        `- Status after run: ${afterRunStatus?.status || 'unknown'} (${afterRunStatus?.traceCount || 0} traces, ${afterRunStatus?.artifactCount || 0} artifacts)`,
        `- Missing evidence: ${missingEvidence.length ? missingEvidence.join(', ') : 'none'}`,
        `- No-call guards: ${notCalled.length}`,
        `- Final reset deleted: ${postReset ? postReset.deletedArtifactCount : 0}`,
        `- Final status: ${finalStatus?.status || 'unknown'} (${finalStatus?.traceCount || 0} traces)`,
      ].join('\n');
    },

    buildVdmiBlueprintPackVerification({ tenantId, seedId, seed, validation }) {
      const warnings = validation.valid ? [] : validation.errors;
      const evidenceRequirements = Array.isArray(seed?.evidenceRequirements)
        ? seed.evidenceRequirements
        : [];
      const roles = Array.isArray(seed?.roles) ? seed.roles : [];
      const forbiddenActions = Array.isArray(seed?.forbiddenActions) ? seed.forbiddenActions : [];
      const commandHints = Array.isArray(seed?.allowedCommandHints) ? seed.allowedCommandHints : [];
      const clarificationItems = seed ? buildWorkbenchClarificationItems(seed) : [];
      const dataClasses = seed?.dataClasses || {};
      const requiredEvidence = evidenceRequirements.map((item) => item.id).filter(Boolean);
      const missingEvidence = evidenceRequirements
        .filter((item) => item.required !== false)
        .map((item) => ({
          missingDataPoint: item.id,
          state: item.missingState || 'evidence_gap',
          enablesDossierAddition: item.enablesDossierAddition || null,
        }));
      const budibaseHint = commandHints.find((hint) =>
        String(hint.id || '').startsWith('budibase:')
      );
      const runbookHint = commandHints.find((hint) => String(hint.id || '').startsWith('rundeck:'));
      const publicContextLayer = {
        present: Boolean(dataClasses.publicContextLayer),
        mutable: false,
        description: dataClasses.publicContextLayer?.description || null,
        examples: dataClasses.publicContextLayer?.examples || [],
      };
      const syntheticTenantSeed = {
        present: Boolean(dataClasses.syntheticTenantSeed),
        syntheticOnly: seed?.realWorldClaim === 'synthetic_demo_only',
        description: dataClasses.syntheticTenantSeed?.description || null,
        examples: dataClasses.syntheticTenantSeed?.examples || [],
      };
      const sandboxRuntimeArtifacts = {
        present: Boolean(dataClasses.sandboxRuntimeArtifact),
        ignoredByVerify: true,
        resettable: true,
        description: dataClasses.sandboxRuntimeArtifact?.description || null,
        examples: dataClasses.sandboxRuntimeArtifact?.examples || [],
      };
      const data = {
        seedId,
        tenantId,
        seedFound: Boolean(seed),
        classification: seed?.demoTenant?.classification || null,
        processFamily: seed?.processFamily || null,
        controlCase: seed?.controlCase || null,
        safetyClassification: 'read_only',
        requiredScope: RUNBOOK_SCOPES.read,
        validation,
        publicContextLayer,
        syntheticTenantSeed,
        sandboxRuntimeArtifacts,
        requiredEvidence,
        missingEvidence,
        roleRelations: roles.map((role) => ({
          roleId: role.roleId,
          relation: role.relation,
          responsibility: role.responsibility,
        })),
        workbenchClarificationItems: clarificationItems,
        workbenchProjectionHint: {
          role: 'ROLE_NETZPLANUNG',
          targetEndpoint: '/api/governance/role-workbench',
          sourceSeedId: seed?.id || seedId,
        },
        budibaseRenderTarget: budibaseHint?.id || 'budibase:stadtwerk-mauer-workbench',
        rundeckHint: runbookHint?.id || null,
        forbiddenActions,
        sourceActions: {
          notCalled: [
            'blueprint-pack.load',
            'tenant.provision',
            'seed.import',
            'sandbox.reset',
            'rundeck.execute',
            'budibase.api.call',
            'hitl.create',
            'external.connector.call',
            'mako.write',
            'billing.prepare',
            'settlement.export',
            'tariff.mutate',
            'device-control.execute',
            'public-context.mutate',
            'personal-agent.execute',
          ],
        },
        brokerDossierHydration: {
          exposed: false,
          reason:
            'Runbook-only verify slice; Capability Broker and Hydration Registry exposure is intentionally deferred.',
        },
      };
      return {
        data,
        warnings,
        counts: {
          seedsFound: seed ? 1 : 0,
          validationErrors: validation.errors.length,
          requiredEvidence: requiredEvidence.length,
          roleRelations: roles.length,
          forbiddenActions: forbiddenActions.length,
          workbenchClarificationItems: clarificationItems.length,
        },
        nextActions: validation.valid
          ? [
              'Render the verify read model in Budibase',
              'Use /api/governance/role-workbench for role-specific case projection',
            ]
          : ['Fix the Blueprint Pack seed contract before exposing it to Rundeck or Budibase'],
      };
    },

    buildVdmiBlueprintPackVerifyMarkdown(verification) {
      const data = verification.data;
      return [
        '## VDMI Blueprint Pack verification',
        `- Seed: ${data.seedId}`,
        `- Tenant: ${data.tenantId}`,
        `- Status: ${data.validation.valid ? 'valid' : 'blocked'}`,
        `- Public context: ${data.publicContextLayer.present ? 'present/read-only' : 'missing'}`,
        `- Synthetic tenant seed: ${data.syntheticTenantSeed.present ? 'present' : 'missing'}`,
        `- Sandbox artifacts: ${data.sandboxRuntimeArtifacts.present ? 'separate/resettable/ignored' : 'missing'}`,
        `- Required evidence: ${data.requiredEvidence.length}`,
        `- Role relations: ${data.roleRelations.length}`,
        `- Forbidden actions: ${data.forbiddenActions.length}`,
        `- Budibase render target: ${data.budibaseRenderTarget}`,
        `- No-call guards: ${data.sourceActions.notCalled.length}`,
      ].join('\n');
    },

    async resolveOptions(ctx, name) {
      const normalized = String(name || '')
        .trim()
        .toLowerCase();
      if (normalized === 'runbooks') {
        return this.getManifest().runbooks.map((runbook) => ({
          name: runbook.id,
          value: runbook.id,
        }));
      }
      if (normalized === 'tenants') {
        const tenantId = getTenantId(ctx);
        return [{ name: tenantId, value: tenantId }];
      }
      if (normalized === 'blocked-work') {
        const blocked = await ctx.call('job-status.listAlarms', { status: 'open', limit: 50 });
        return (blocked?.alarms || []).map((entry) => ({
          name: `${entry.alarm?.severity || 'alarm'} ${entry.alarm?.code || entry.alarm?.alarmId}`,
          value: entry.alarm?.alarmId,
        }));
      }
      if (normalized === 'revalidation-tasks') {
        return jobStore
          .listJobs()
          .filter((job) => ['recovery_pending', 'error', 'queued', 'running'].includes(job.status))
          .slice(0, 50)
          .map((job) => ({
            name: `${job.service || 'service'}.${job.action || 'action'} ${job.status}`,
            value: job.jobId,
          }));
      }
      if (normalized === 'open-hitl-kinds') {
        const hitl = await ctx.call('hitl.list', { status: 'pending', limit: 100 });
        return Object.keys(countBy(hitl?.items || [], 'kind')).map((kind) => ({
          name: kind,
          value: kind,
        }));
      }
      return [];
    },

    async safeCall(ctx, action, params) {
      try {
        return await ctx.call(action, params);
      } catch (error) {
        this.logger.warn(`[operations-runbook] ${action} failed: ${error.message}`);
        return {
          success: false,
          error: error.message,
        };
      }
    },
  },
};
