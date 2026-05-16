/**
 * Job Status Service (v0.9.8+)
 *
 * Exposes REST endpoints for polling async job status and retrieving results.
 * Jobs are created by long-running actions in grid-operations and
 * business-intelligence services when called from the REST API gateway.
 *
 * Endpoints:
 *   GET /api/jobs/:jobId/status  — poll job status (queued / running / completed / error)
 *   GET /api/jobs/:jobId/result  — retrieve completed result payload
 */

const jobStore = require('../src/job-store');

function toProgressEvents(job) {
  const logs = Array.isArray(job?.logs) ? job.logs : [];
  return logs.map((entry, index) => {
    const id = String(entry?.id || index + 1);
    const step = Number.isFinite(entry?.step) ? entry.step : null;
    const totalSteps = Number.isFinite(entry?.totalSteps) ? entry.totalSteps : null;
    const payload =
      entry?.payload && typeof entry.payload === 'object' && !Array.isArray(entry.payload)
        ? entry.payload
        : null;
    return {
      id,
      at: entry?.timestamp || null,
      phase: entry?.phase || null,
      percent: Number.isFinite(entry?.percent) ? entry.percent : null,
      step,
      totalSteps,
      message: entry?.message || null,
      payload,
    };
  });
}

function toProgressSnapshot(job) {
  const events = toProgressEvents(job);
  const latestEvent = events.length > 0 ? events[events.length - 1] : null;
  const progress = {
    step: Number.isFinite(job?.progress?.step)
      ? job.progress.step
      : Number.isFinite(latestEvent?.step)
        ? latestEvent.step
        : null,
    totalSteps: Number.isFinite(job?.progress?.totalSteps)
      ? job.progress.totalSteps
      : Number.isFinite(latestEvent?.totalSteps)
        ? latestEvent.totalSteps
        : null,
    message: job?.progress?.message || latestEvent?.message || null,
    payload: job?.progress?.payload || latestEvent?.payload || null,
  };

  return {
    progress,
    events,
  };
}

module.exports = {
  name: 'job-status',

  async started() {
    // Garbage-collect expired jobs from previous runs on startup
    jobStore.gcExpired();
    this._rehydrationSummary = jobStore.rehydrateOnStartup({
      broker: this.broker,
      actor: 'job-status.startup',
    });

    const intervalSeconds = Math.max(5, Number(process.env.JOB_STORE_WATCHDOG_INTERVAL_SECONDS || 15));
    this._watchdogInterval = setInterval(() => {
      try {
        this._watchdogSummary = jobStore.watchdogSweep({
          broker: this.broker,
          actor: 'job-status.watchdog',
        });
      } catch (err) {
        this.logger.warn('[job-status] watchdog sweep failed:', err.message);
      }
    }, intervalSeconds * 1000);
    this._watchdogInterval.unref?.();
  },

  stopped() {
    if (this._watchdogInterval) {
      clearInterval(this._watchdogInterval);
      this._watchdogInterval = null;
    }
  },

  actions: {
    /**
     * Poll the status of an async job.
     */
    status: {
      rest: 'GET /:jobId/status',
      params: {
        jobId: { type: 'string', min: 1 },
      },
      openapi: {
        summary: 'Poll async job status',
        tags: ['Jobs'],
        description: `Poll the status of a background job started by a long-running endpoint (v0.9.8+).

**Status values**:
- **queued** — job is registered, worker starting soon
- **running** — worker is executing (MCP polling in progress)
- **completed** — result is available at \`resultUrl\`
- **error** — worker failed; see \`error\` field

**Polling strategy**: start polling 5 s after submission, then every 10–30 s.
Most jobs complete within 8–12 minutes.`,
        parameters: [
          {
            name: 'jobId',
            in: 'path',
            required: true,
            schema: { type: 'string', example: 'a3f8b2c1-...' },
            description: 'Job UUID returned by the 202 response',
          },
        ],
        responses: {
          200: {
            description: 'Job status record',
            content: {
              'application/json': {
                schema: {
                  type: 'object',
                  properties: {
                    jobId: { type: 'string' },
                    service: { type: 'string', description: 'Originating service name' },
                    action: { type: 'string', description: 'Originating action name' },
                    status: {
                      type: 'string',
                      enum: ['queued', 'running', 'recovery_pending', 'completed', 'error'],
                    },
                    createdAt: { type: 'string', format: 'date-time' },
                    updatedAt: { type: 'string', format: 'date-time' },
                    completedAt: { type: 'string', format: 'date-time', nullable: true },
                    error: { type: 'string', nullable: true },
                    location: {
                      type: 'string',
                      description: 'URL of this status endpoint (for polling)',
                    },
                    resultUrl: {
                      type: 'string',
                      nullable: true,
                      description: 'Result URL — only set when status is "completed"',
                    },
                  },
                },
                examples: {
                  queued: {
                    summary: 'Job queued',
                    value: {
                      jobId: 'a3f8b2c1-0000-0000-0000-000000000001',
                      service: 'grid-operations',
                      action: 'gridData',
                      status: 'queued',
                      createdAt: '2026-03-19T10:00:00.000Z',
                      updatedAt: '2026-03-19T10:00:00.000Z',
                      completedAt: null,
                      error: null,
                      location: '/api/jobs/a3f8b2c1-0000-0000-0000-000000000001/status',
                      resultUrl: null,
                    },
                  },
                  completed: {
                    summary: 'Job completed',
                    value: {
                      jobId: 'a3f8b2c1-0000-0000-0000-000000000001',
                      service: 'grid-operations',
                      action: 'gridData',
                      status: 'completed',
                      createdAt: '2026-03-19T10:00:00.000Z',
                      updatedAt: '2026-03-19T10:08:00.000Z',
                      completedAt: '2026-03-19T10:08:00.000Z',
                      error: null,
                      location: '/api/jobs/a3f8b2c1-0000-0000-0000-000000000001/status',
                      resultUrl: '/api/jobs/a3f8b2c1-0000-0000-0000-000000000001/result',
                    },
                  },
                },
              },
            },
          },
          404: {
            description: 'Job not found (unknown ID or TTL expired)',
            content: {
              'application/json': {
                schema: {
                  type: 'object',
                  properties: {
                    success: { type: 'boolean', example: false },
                    message: { type: 'string' },
                  },
                },
              },
            },
          },
        },
      },
      handler(ctx) {
        const { jobId } = ctx.params;
        const job = jobStore.getJob(jobId);
        if (!job) {
          ctx.meta.$statusCode = 404;
          return { success: false, message: `Job not found: ${jobId}` };
        }
        return {
          ...job,
          location: `/api/jobs/${jobId}/status`,
          resultUrl: job.status === 'completed' ? `/api/jobs/${jobId}/result` : null,
        };
      },
    },

    /**
     * Unified progress endpoint.
     * - Default: JSON polling payload
     * - stream=true OR Accept:text/event-stream: SSE payload
     */
    progress: {
      rest: 'GET /:jobId/progress',
      params: {
        jobId: { type: 'string', min: 1 },
        stream: { type: 'boolean', optional: true, default: false, convert: true },
        lastEventId: { type: 'string', optional: true },
      },
      openapi: {
        summary: 'Get job progress (JSON polling or SSE)',
        tags: ['Jobs'],
        description:
          'Returns normalized job progress. Use query `stream=true` for text/event-stream output. ' +
          'SSE supports `Last-Event-ID` replay (or `lastEventId` query fallback).',
        parameters: [
          {
            name: 'jobId',
            in: 'path',
            required: true,
            schema: { type: 'string', example: 'a3f8b2c1-...' },
          },
          {
            name: 'stream',
            in: 'query',
            required: false,
            schema: { type: 'boolean', default: false },
            description: 'Set true to receive text/event-stream output.',
          },
          {
            name: 'lastEventId',
            in: 'query',
            required: false,
            schema: { type: 'string', example: '3' },
            description: 'Optional replay cursor when headers cannot be set by the client.',
          },
          {
            name: 'Last-Event-ID',
            in: 'header',
            required: false,
            schema: { type: 'string', example: '3' },
            description: 'SSE replay cursor. Events with greater IDs are returned.',
          },
        ],
        responses: {
          200: {
            description: 'Progress payload (JSON) or SSE stream (text/event-stream)',
          },
          404: {
            description: 'Job not found (unknown ID or TTL expired)',
          },
        },
      },
      handler(ctx) {
        const { jobId } = ctx.params;
        const job = jobStore.getJob(jobId);

        if (!job) {
          ctx.meta.$statusCode = 404;
          return { success: false, message: `Job not found: ${jobId}` };
        }

        const snapshot = toProgressSnapshot(job);
        const headers = ctx.meta?.requestHeaders || {};
        const acceptHeader = String(headers.accept || headers.Accept || '').toLowerCase();
        const headerLastEventId = String(headers['last-event-id'] || headers['Last-Event-ID'] || '').trim();
        const lastEventId = (ctx.params.lastEventId || headerLastEventId || '').trim();
        const streamRequested = ctx.params.stream || acceptHeader.includes('text/event-stream');

        if (!streamRequested) {
          return {
            success: true,
            jobId,
            status: job.status,
            progress: snapshot.progress,
            latestEventId: snapshot.events.length ? snapshot.events[snapshot.events.length - 1].id : null,
            eventCount: snapshot.events.length,
            events: snapshot.events,
          };
        }

        const cursor = Number.parseInt(lastEventId, 10);
        const replayFrom = Number.isFinite(cursor) ? cursor : 0;
        const replayEvents = snapshot.events.filter((evt) => Number.parseInt(evt.id, 10) > replayFrom);

        const lines = ['retry: 5000'];
        for (const evt of replayEvents) {
          lines.push(`id: ${evt.id}`);
          lines.push('event: progress');
          lines.push(`data: ${JSON.stringify(evt)}`);
          lines.push('');
        }

        const stateId = snapshot.events.length
          ? snapshot.events[snapshot.events.length - 1].id
          : String(replayFrom || 0);
        lines.push(`id: ${stateId}`);
        lines.push('event: state');
        lines.push(
          `data: ${JSON.stringify({ jobId, status: job.status, progress: snapshot.progress, done: ['completed', 'error'].includes(job.status) })}`
        );
        lines.push('');

        ctx.meta.$responseType = 'text/event-stream; charset=utf-8';
        ctx.meta.$responseHeaders = Object.assign(ctx.meta.$responseHeaders || {}, {
          'Cache-Control': 'no-cache',
          Connection: 'keep-alive',
          'X-Accel-Buffering': 'no',
        });

        return `${lines.join('\n')}\n`;
      },
    },

    /**
     * Retrieve the result payload of a completed async job.
     */
    result: {
      rest: 'GET /:jobId/result',
      params: {
        jobId: { type: 'string', min: 1 },
      },
      openapi: {
        summary: 'Retrieve async job result',
        tags: ['Jobs'],
        description: `Retrieve the full result payload of a completed async job.

Returns **202** if the job is still running — poll \`/status\` first.
Returns **404** if the job ID is unknown or the result has expired (24 h TTL).`,
        parameters: [
          {
            name: 'jobId',
            in: 'path',
            required: true,
            schema: { type: 'string', example: 'a3f8b2c1-...' },
            description: 'Job UUID returned by the 202 response',
          },
        ],
        responses: {
          200: {
            description: 'Job result payload (original MCP tool response)',
            content: {
              'application/json': {
                schema: { type: 'object' },
              },
            },
          },
          202: {
            description: 'Job not yet completed — poll status endpoint',
            content: {
              'application/json': {
                schema: {
                  type: 'object',
                  properties: {
                    success: { type: 'boolean', example: false },
                    status: { type: 'string' },
                    message: { type: 'string' },
                    location: { type: 'string' },
                  },
                },
              },
            },
          },
          404: {
            description: 'Job not found or result expired',
            content: {
              'application/json': {
                schema: {
                  type: 'object',
                  properties: {
                    success: { type: 'boolean', example: false },
                    message: { type: 'string' },
                  },
                },
              },
            },
          },
        },
      },
      handler(ctx) {
        const { jobId } = ctx.params;
        const job = jobStore.getJob(jobId);

        if (!job) {
          ctx.meta.$statusCode = 404;
          return { success: false, message: `Job not found: ${jobId}` };
        }

        if (job.status !== 'completed') {
          ctx.meta.$statusCode = 202;
          return {
            success: false,
            status: job.status,
            message: 'Job not yet completed. Poll /api/jobs/:jobId/status for updates.',
            location: `/api/jobs/${jobId}/status`,
          };
        }

        if (job.status === 'error') {
          ctx.meta.$statusCode = 500;
          return { success: false, status: 'error', error: job.error };
        }

        const result = jobStore.getResult(jobId);
        if (!result) {
          ctx.meta.$statusCode = 404;
          return {
            success: false,
            message: 'Result not found — job may have expired (24 h TTL).',
          };
        }

        return result;
      },
    },

    listAlarms: {
      rest: 'GET /alarms',
      params: {
        status: {
          type: 'enum',
          optional: true,
          values: ['open', 'acknowledged', 'resolved'],
          default: 'open',
          example: 'open',
        },
        jobId: { type: 'string', optional: true, min: 1, example: 'a3f8b2c1-0000-0000-0000-000000000001' },
        limit: { type: 'number', optional: true, default: 100, min: 1, max: 1000, convert: true },
      },
      openapi: {
        summary: 'List persistent async watchdog alarms',
        tags: ['Jobs'],
        parameters: [
          {
            name: 'status',
            in: 'query',
            required: false,
            schema: { type: 'string', enum: ['open', 'acknowledged', 'resolved'], default: 'open', example: 'open' },
          },
          {
            name: 'jobId',
            in: 'query',
            required: false,
            schema: { type: 'string', example: 'a3f8b2c1-0000-0000-0000-000000000001' },
          },
          {
            name: 'limit',
            in: 'query',
            required: false,
            schema: { type: 'number', default: 100, minimum: 1, maximum: 1000 },
          },
        ],
      },
      handler(ctx) {
        const items = jobStore.listAlarmEvents({
          status: ctx.params.status,
          jobId: ctx.params.jobId,
        });
        return {
          success: true,
          count: items.length,
          alarms: items.slice(0, ctx.params.limit),
        };
      },
    },

    acknowledgeAlarm: {
      rest: 'POST /alarms/:alarmId/ack',
      params: {
        alarmId: { type: 'string', min: 1, example: 'alarm_abc123' },
        actor: { type: 'string', optional: true, max: 120, example: 'hitl-user' },
        note: { type: 'string', optional: true, max: 1000, example: 'Investigating this alert.' },
      },
      openapi: {
        summary: 'Acknowledge persistent async watchdog alarm',
        tags: ['Jobs'],
        requestBody: {
          required: false,
          content: {
            'application/json': {
              examples: {
                default: {
                  value: {
                    alarmId: 'alarm_abc123',
                    actor: 'hitl-user',
                    note: 'Investigating this alert.',
                  },
                },
              },
              schema: {
                type: 'object',
                required: ['alarmId'],
                properties: {
                  alarmId: { type: 'string', example: 'alarm_abc123' },
                  actor: { type: 'string', maxLength: 120, example: 'hitl-user' },
                  note: { type: 'string', maxLength: 1000, example: 'Investigating this alert.' },
                },
              },
            },
          },
        },
      },
      handler(ctx) {
        const updated = jobStore.updateAlarmStatus(ctx.params.alarmId, jobStore.ALARM_STATUS.ACKNOWLEDGED, {
          actor: ctx.params.actor || 'user',
          note: ctx.params.note || null,
        });
        if (!updated) {
          ctx.meta.$statusCode = 404;
          return { success: false, message: `Alarm not found: ${ctx.params.alarmId}` };
        }
        return { success: true, ...updated };
      },
    },

    resolveAlarm: {
      rest: 'POST /alarms/:alarmId/resolve',
      params: {
        alarmId: { type: 'string', min: 1, example: 'alarm_abc123' },
        actor: { type: 'string', optional: true, max: 120, example: 'problem-solver-agent' },
        note: { type: 'string', optional: true, max: 1000, example: 'Recovery completed successfully.' },
      },
      openapi: {
        summary: 'Resolve persistent async watchdog alarm',
        tags: ['Jobs'],
        requestBody: {
          required: false,
          content: {
            'application/json': {
              examples: {
                default: {
                  value: {
                    alarmId: 'alarm_abc123',
                    actor: 'problem-solver-agent',
                    note: 'Recovery completed successfully.',
                  },
                },
              },
              schema: {
                type: 'object',
                required: ['alarmId'],
                properties: {
                  alarmId: { type: 'string', example: 'alarm_abc123' },
                  actor: { type: 'string', maxLength: 120, example: 'problem-solver-agent' },
                  note: { type: 'string', maxLength: 1000, example: 'Recovery completed successfully.' },
                },
              },
            },
          },
        },
      },
      handler(ctx) {
        const updated = jobStore.updateAlarmStatus(ctx.params.alarmId, jobStore.ALARM_STATUS.RESOLVED, {
          actor: ctx.params.actor || 'user',
          note: ctx.params.note || null,
        });
        if (!updated) {
          ctx.meta.$statusCode = 404;
          return { success: false, message: `Alarm not found: ${ctx.params.alarmId}` };
        }
        return { success: true, ...updated };
      },
    },

    wakeUp: {
      rest: 'POST /:jobId/wake-up',
      params: {
        jobId: { type: 'string', min: 1, example: 'a3f8b2c1-0000-0000-0000-000000000001' },
        idempotencyKey: { type: 'string', optional: true, trim: true, max: 256, example: 'ck:wakeup:tenant-1:monitor:123' },
        reason: { type: 'string', optional: true, max: 120, example: 'manual' },
      },
      openapi: {
        summary: 'Trigger idempotent wake-up for a recovery_pending async job',
        tags: ['Jobs'],
        requestBody: {
          required: false,
          content: {
            'application/json': {
              examples: {
                default: {
                  value: {
                    jobId: 'a3f8b2c1-0000-0000-0000-000000000001',
                    idempotencyKey: 'ck:wakeup:tenant-1:monitor:123',
                    reason: 'manual',
                  },
                },
              },
              schema: {
                type: 'object',
                required: ['jobId'],
                properties: {
                  jobId: { type: 'string', example: 'a3f8b2c1-0000-0000-0000-000000000001' },
                  idempotencyKey: { type: 'string', maxLength: 256, example: 'ck:wakeup:tenant-1:monitor:123' },
                  reason: { type: 'string', maxLength: 120, example: 'manual' },
                },
              },
            },
          },
        },
      },
      handler(ctx) {
        const wake = jobStore.requestWakeUp(ctx.params.jobId, {
          broker: this.broker,
          actor: 'job-status.wakeup',
          reason: ctx.params.reason || 'manual',
          idempotencyKey: ctx.params.idempotencyKey || null,
        });
        if (!wake.accepted) {
          ctx.meta.$statusCode = 400;
          return { success: false, ...wake };
        }
        return { success: true, ...wake };
      },
    },
  },
};
