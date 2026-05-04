'use strict';

const { MoleculerClientError } = require('moleculer').Errors;

const observabilityStore = require('../src/observability-store');

const OPENAPI_TAG = 'Observability';
const LEVEL_VALUES = ['fatal', 'error', 'warn', 'info', 'debug', 'trace'];
const STATUS_VALUES = ['success', 'error'];

module.exports = {
  name: 'observability',

  settings: {
    dbPath: process.env.OBSERVABILITY_DB_PATH || './data/observability',
    defaultLimit: 50,
    maxLimit: 200,
    defaultSinceMinutes: 60,
    defaultMetricWindowMinutes: 24 * 60,
    defaultSlowActionThresholdMs: 1000,
  },

  created() {
    observabilityStore.configure({ dbPath: this.settings.dbPath });
  },

  async started() {
    await observabilityStore.init();
    this.logger.info(`Observability DB initialized at ${this.settings.dbPath}`);
  },

  actions: {
    logs: {
      rest: 'GET /logs',
      params: {
        level: { type: 'enum', values: LEVEL_VALUES, optional: true },
        service: { type: 'string', optional: true, trim: true },
        action: { type: 'string', optional: true, trim: true },
        contains: { type: 'string', optional: true, trim: true },
        limit: { type: 'number', integer: true, optional: true, min: 1, max: 200, convert: true },
        sinceMinutes: {
          type: 'number',
          integer: true,
          optional: true,
          min: 1,
          max: 7 * 24 * 60,
          convert: true,
        },
        since: { type: 'string', optional: true },
        until: { type: 'string', optional: true },
      },
      openapi: {
        tags: [OPENAPI_TAG],
        summary: 'Retrieve captured broker and service log output',
        description:
          'Returns recently captured logger output from the Moleculer broker and loaded services. ' +
          'Messages are persisted locally in PouchDB with token and PII redaction for production-safe debugging.',
        parameters: [
          {
            name: 'level',
            in: 'query',
            schema: { type: 'string', enum: LEVEL_VALUES, example: 'error' },
          },
          { name: 'service', in: 'query', schema: { type: 'string', example: 'finance-agent' } },
          {
            name: 'action',
            in: 'query',
            schema: { type: 'string', example: 'finance-agent.analyze' },
          },
          { name: 'contains', in: 'query', schema: { type: 'string', example: 'timeout' } },
          { name: 'limit', in: 'query', schema: { type: 'integer', default: 50, minimum: 1, maximum: 200 } },
          { name: 'sinceMinutes', in: 'query', schema: { type: 'integer', default: 60, minimum: 1 } },
          {
            name: 'since',
            in: 'query',
            schema: { type: 'string', format: 'date-time', example: '2026-05-04T08:00:00.000Z' },
          },
          {
            name: 'until',
            in: 'query',
            schema: { type: 'string', format: 'date-time', example: '2026-05-04T12:00:00.000Z' },
          },
        ],
        responses: {
          200: {
            description: 'Captured log messages',
            content: {
              'application/json': {
                schema: {
                  type: 'object',
                  properties: {
                    count: { type: 'integer', example: 12 },
                    generatedAt: { type: 'string', format: 'date-time' },
                    logs: {
                      type: 'array',
                      items: {
                        type: 'object',
                        properties: {
                          timestamp: { type: 'string', format: 'date-time' },
                          level: { type: 'string', example: 'error' },
                          service: { type: 'string', example: 'finance-agent' },
                          action: { type: 'string', nullable: true, example: 'finance-agent.analyze' },
                          source: { type: 'string', example: 'service' },
                          nodeID: { type: 'string', nullable: true },
                          requestOrigin: { type: 'string', nullable: true, example: 'gateway' },
                          errorType: { type: 'string', nullable: true, example: 'VALIDATION_ERROR' },
                          message: { type: 'string' },
                        },
                      },
                    },
                  },
                },
              },
            },
          },
        },
      },
      async handler(ctx) {
        this.validateRange(ctx.params.since, ctx.params.until);
        const logs = await observabilityStore.listLogs({
          ...ctx.params,
          limit: this.normalizeLimit(ctx.params.limit),
          sinceMinutes: ctx.params.sinceMinutes ?? this.settings.defaultSinceMinutes,
        });

        return {
          count: logs.length,
          generatedAt: new Date().toISOString(),
          logs,
        };
      },
    },

    metrics: {
      rest: 'GET /metrics',
      params: {
        service: { type: 'string', optional: true, trim: true },
        action: { type: 'string', optional: true, trim: true },
        status: { type: 'enum', values: STATUS_VALUES, optional: true },
        limit: { type: 'number', integer: true, optional: true, min: 1, max: 200, convert: true },
        sinceMinutes: {
          type: 'number',
          integer: true,
          optional: true,
          min: 1,
          max: 30 * 24 * 60,
          convert: true,
        },
        since: { type: 'string', optional: true },
        until: { type: 'string', optional: true },
        slowActionThresholdMs: {
          type: 'number',
          integer: true,
          optional: true,
          min: 1,
          max: 600000,
          convert: true,
        },
        includeRaw: { type: 'boolean', optional: true, default: false },
      },
      openapi: {
        tags: [OPENAPI_TAG],
        summary: 'Retrieve aggregated action performance metrics',
        description:
          'Returns per-action performance statistics captured at broker level for local and gateway-triggered Moleculer actions. ' +
          'Metrics include durations, success/error counts, and slow-action detection.',
        parameters: [
          { name: 'service', in: 'query', schema: { type: 'string', example: 'demo-ops' } },
          {
            name: 'action',
            in: 'query',
            schema: { type: 'string', example: 'demo-ops.success' },
          },
          {
            name: 'status',
            in: 'query',
            schema: { type: 'string', enum: STATUS_VALUES, example: 'success' },
          },
          { name: 'limit', in: 'query', schema: { type: 'integer', default: 50, minimum: 1, maximum: 200 } },
          { name: 'sinceMinutes', in: 'query', schema: { type: 'integer', default: 1440, minimum: 1 } },
          {
            name: 'since',
            in: 'query',
            schema: { type: 'string', format: 'date-time', example: '2026-05-03T12:00:00.000Z' },
          },
          {
            name: 'until',
            in: 'query',
            schema: { type: 'string', format: 'date-time', example: '2026-05-04T12:00:00.000Z' },
          },
          { name: 'slowActionThresholdMs', in: 'query', schema: { type: 'integer', default: 1000, minimum: 1 } },
          { name: 'includeRaw', in: 'query', schema: { type: 'boolean', default: false } },
        ],
        responses: {
          200: {
            description: 'Aggregated action metrics',
            content: {
              'application/json': {
                schema: {
                  type: 'object',
                  properties: {
                    count: { type: 'integer' },
                    generatedAt: { type: 'string', format: 'date-time' },
                    summary: { type: 'object' },
                    actions: { type: 'array', items: { type: 'object' } },
                    recent: { type: 'array', items: { type: 'object' } },
                  },
                },
              },
            },
          },
        },
      },
      async handler(ctx) {
        this.validateRange(ctx.params.since, ctx.params.until);
        const threshold =
          ctx.params.slowActionThresholdMs ?? this.settings.defaultSlowActionThresholdMs;
        const metrics = await observabilityStore.listMetrics({
          ...ctx.params,
          limit: this.normalizeLimit(ctx.params.limit),
          sinceMinutes: ctx.params.sinceMinutes ?? this.settings.defaultMetricWindowMinutes,
        });

        return {
          count: metrics.length,
          generatedAt: new Date().toISOString(),
          summary: this.buildMetricOverview(metrics, threshold),
          actions: this.buildActionBreakdown(metrics, threshold),
          recent: ctx.params.includeRaw ? metrics : [],
        };
      },
    },

    summary: {
      rest: 'GET /summary',
      params: {
        limit: { type: 'number', integer: true, optional: true, min: 1, max: 50, convert: true },
        sinceMinutes: {
          type: 'number',
          integer: true,
          optional: true,
          min: 1,
          max: 30 * 24 * 60,
          convert: true,
        },
        slowActionThresholdMs: {
          type: 'number',
          integer: true,
          optional: true,
          min: 1,
          max: 600000,
          convert: true,
        },
      },
      openapi: {
        tags: [OPENAPI_TAG],
        summary: 'Retrieve an operational overview for recent logs and performance',
        description:
          'Returns a compact production-feedback overview containing recent log volume, latest errors, ' +
          'action throughput, and slowest actions over a configurable time window.',
        parameters: [
          { name: 'limit', in: 'query', schema: { type: 'integer', default: 50, minimum: 1, maximum: 50 } },
          { name: 'sinceMinutes', in: 'query', schema: { type: 'integer', default: 60, minimum: 1 } },
          { name: 'slowActionThresholdMs', in: 'query', schema: { type: 'integer', default: 1000, minimum: 1 } },
        ],
        responses: {
          200: {
            description: 'Operational overview',
            content: {
              'application/json': {
                schema: {
                  type: 'object',
                  properties: {
                    generatedAt: { type: 'string', format: 'date-time' },
                    window: { type: 'object' },
                    retention: { type: 'object' },
                    logs: { type: 'object' },
                    metrics: { type: 'object' },
                  },
                },
              },
            },
          },
        },
      },
      async handler(ctx) {
        const limit = Math.min(this.normalizeLimit(ctx.params.limit), 50);
        const sinceMinutes = ctx.params.sinceMinutes ?? this.settings.defaultSinceMinutes;
        const threshold =
          ctx.params.slowActionThresholdMs ?? this.settings.defaultSlowActionThresholdMs;
        const retentionConfig = observabilityStore.getConfig();
        const [logs, metrics] = await Promise.all([
          observabilityStore.listLogs({ limit: Math.max(limit * 4, 50), sinceMinutes }),
          observabilityStore.listMetrics({ limit: 500, sinceMinutes }),
        ]);

        return {
          generatedAt: new Date().toISOString(),
          window: { sinceMinutes, slowActionThresholdMs: threshold },
          retention: {
            logRetentionDays: retentionConfig.logRetentionDays,
            metricRetentionDays: retentionConfig.metricRetentionDays,
            maxLogMessageLength: retentionConfig.maxLogMessageLength,
          },
          logs: {
            total: logs.length,
            byLevel: this.countBy(logs, 'level'),
            recentErrors: logs.filter((entry) => entry.level === 'error').slice(0, limit),
          },
          metrics: {
            total: metrics.length,
            overview: this.buildMetricOverview(metrics, threshold),
            slowestActions: this.buildActionBreakdown(metrics, threshold).slice(0, limit),
          },
        };
      },
    },
  },

  methods: {
    normalizeLimit(limit) {
      const numericLimit = Number(limit);
      if (!Number.isFinite(numericLimit)) return this.settings.defaultLimit;
      return Math.min(this.settings.maxLimit, Math.max(1, Math.round(numericLimit)));
    },

    validateRange(since, until) {
      const start = since ? Date.parse(since) : null;
      const end = until ? Date.parse(until) : null;
      if (since && !Number.isFinite(start)) {
        throw new MoleculerClientError('Invalid since timestamp. Use ISO-8601 date-time.', 422);
      }
      if (until && !Number.isFinite(end)) {
        throw new MoleculerClientError('Invalid until timestamp. Use ISO-8601 date-time.', 422);
      }
      if (start && end && start > end) {
        throw new MoleculerClientError('Invalid time range: since must be before until.', 422);
      }
    },

    countBy(entries, key) {
      return entries.reduce((acc, entry) => {
        const bucket = entry?.[key] || 'unknown';
        acc[bucket] = (acc[bucket] || 0) + 1;
        return acc;
      }, {});
    },

    buildMetricOverview(metrics, slowActionThresholdMs) {
      if (!metrics.length) {
        return {
          totalCalls: 0,
          successCount: 0,
          errorCount: 0,
          avgDurationMs: null,
          p95DurationMs: null,
          slowCallCount: 0,
        };
      }

      const durations = metrics
        .map((entry) => Number(entry.durationMs) || 0)
        .sort((a, b) => a - b);
      const totalDuration = durations.reduce((sum, value) => sum + value, 0);
      const successCount = metrics.filter((entry) => entry.status === 'success').length;
      const errorCount = metrics.filter((entry) => entry.status === 'error').length;
      const p95Index = Math.min(durations.length - 1, Math.ceil(durations.length * 0.95) - 1);

      return {
        totalCalls: metrics.length,
        successCount,
        errorCount,
        avgDurationMs: Math.round(totalDuration / metrics.length),
        p95DurationMs: durations[p95Index] ?? durations[durations.length - 1] ?? null,
        slowCallCount: metrics.filter((entry) => entry.durationMs >= slowActionThresholdMs).length,
        byOrigin: this.countBy(metrics, 'requestOrigin'),
      };
    },

    buildActionBreakdown(metrics, slowActionThresholdMs) {
      const grouped = new Map();

      for (const metric of metrics) {
        const key = metric.action || `${metric.service}.unknown`;
        const current = grouped.get(key) || {
          service: metric.service,
          action: key,
          calls: 0,
          successCount: 0,
          errorCount: 0,
          totalDurationMs: 0,
          maxDurationMs: 0,
          lastSeenAt: metric.timestamp,
          lastErrorType: null,
        };

        current.calls += 1;
        current.totalDurationMs += Number(metric.durationMs) || 0;
        current.maxDurationMs = Math.max(current.maxDurationMs, Number(metric.durationMs) || 0);
        current.lastSeenAt = !current.lastSeenAt || metric.timestamp > current.lastSeenAt
          ? metric.timestamp
          : current.lastSeenAt;
        if (metric.status === 'error') {
          current.errorCount += 1;
          current.lastErrorType = metric.errorType || current.lastErrorType;
        } else {
          current.successCount += 1;
        }

        grouped.set(key, current);
      }

      return Array.from(grouped.values())
        .map((entry) => ({
          service: entry.service,
          action: entry.action,
          calls: entry.calls,
          successCount: entry.successCount,
          errorCount: entry.errorCount,
          avgDurationMs: Math.round(entry.totalDurationMs / entry.calls),
          maxDurationMs: entry.maxDurationMs,
          slow: entry.maxDurationMs >= slowActionThresholdMs,
          lastSeenAt: entry.lastSeenAt,
          lastErrorType: entry.lastErrorType,
        }))
        .sort((left, right) => {
          if (right.maxDurationMs !== left.maxDurationMs) {
            return right.maxDurationMs - left.maxDurationMs;
          }
          return right.calls - left.calls;
        });
    },
  },
};
