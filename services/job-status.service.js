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

module.exports = {
  name: 'job-status',

  async started() {
    // Garbage-collect expired jobs from previous runs on startup
    jobStore.gcExpired();
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
                      enum: ['queued', 'running', 'completed', 'error'],
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
  },
};
