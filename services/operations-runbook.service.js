'use strict';

const crypto = require('crypto');
const { Errors } = require('moleculer');
const jobStore = require('../src/job-store');
const tracing = require('../src/tracing');
const { getTenantId } = require('../src/tenant-context');
const { hasRole } = require('../src/auth/rbac');

const OPENAPI_TAG = 'Operations Runbook';
const RUNBOOK_SCOPES = {
  read: 'rundeck-read',
  dryRun: 'rundeck-dry-run',
  ack: 'rundeck-ack',
  executeDev: 'rundeck-execute-dev',
};

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
    .map((value) => String(value || '').trim().toLowerCase())
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
          nextActions: total > 0 ? ['Acknowledge alarms after inspection', 'Resolve HITL items'] : [],
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

    async resolveOptions(ctx, name) {
      const normalized = String(name || '').trim().toLowerCase();
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
