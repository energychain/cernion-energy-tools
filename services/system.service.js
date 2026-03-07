/**
 * System Tools Service
 *
 * Status, discovery, job management, parameter validation
 */

const CernionMCPClient = require('../src/mcp-client');

module.exports = {
  name: 'system',

  settings: {
    defaultTimeout: 30000,
  },

  actions: {
    /**
     * System and provider status check
     * Tool: cernion_status
     */
    status: {
      rest: 'GET /status',
      params: {
        verbose: { type: 'boolean', optional: true, default: false },
      },
      openapi: {
        summary: 'System and provider status check',
        tags: ['System Tools'],
        description:
          'Check data provider connectivity (Powabase, ENTSO-E, SMARD, GrünstromIndex), cache statistics, and performance metrics',
        parameters: [
          {
            name: 'verbose',
            in: 'query',
            schema: { type: 'boolean', default: false },
            description: 'Include detailed provider diagnostics and cache stats',
          },
        ],
      },
      async handler(ctx) {
        return await CernionMCPClient.callWithNewSession(
          'cernion_status',
          ctx.params,
          ctx.meta.cernionToken
        );
      },
    },

    /**
     * Validate tool parameters before execution
     * Tool: cernion_validate_params
     */
    validateParams: {
      rest: 'POST /validate-params',
      params: {
        tool: { type: 'string', min: 1 },
        params: { type: 'object' },
      },
      openapi: {
        summary: 'Validate tool parameters before execution',
        tags: ['System Tools'],
        description:
          'Pre-validation before expensive operations, error prevention. Validates parameters for any MCP tool before running it, returning detailed error messages and suggestions for corrections.',
        requestBody: {
          required: true,
          content: {
            'application/json': {
              schema: {
                type: 'object',
                required: ['tool', 'params'],
                properties: {
                  tool: {
                    type: 'string',
                    description: 'MCP tool name to validate parameters for',
                    example: 'mastr_generation_forecast',
                  },
                  params: {
                    type: 'object',
                    description: 'Parameters object to validate against the tool schema',
                    example: { region: 'Bayern', forecastDays: 7 },
                  },
                },
              },
              examples: {
                validateForecast: {
                  summary: 'Validate generation forecast params',
                  value: {
                    tool: 'mastr_generation_forecast',
                    params: { bundesland: 'Bayern', installationType: 'solar', forecastDays: 7 },
                  },
                },
                validateResidualLoad: {
                  summary: 'Validate residual load params',
                  value: {
                    tool: 'mastr_net_residual_load',
                    params: { region: 'Ludwigshafen', resolution: 'hourly', forecastDays: 1 },
                  },
                },
              },
            },
          },
        },
        responses: {
          200: {
            description: 'Validation result',
            content: {
              'application/json': {
                schema: {
                  type: 'object',
                  properties: {
                    valid: { type: 'boolean', example: true },
                    errors: {
                      type: 'array',
                      items: { type: 'string' },
                      description: 'List of validation errors (empty when valid)',
                      example: [],
                    },
                    suggestions: {
                      type: 'array',
                      items: { type: 'string' },
                      description: 'Suggestions for fixing invalid parameters',
                    },
                  },
                },
              },
            },
          },
        },
      },
      async handler(ctx) {
        return await CernionMCPClient.callWithNewSession(
          'cernion_validate_params',
          ctx.params,
          ctx.meta.cernionToken
        );
      },
    },

    /**
     * Check status of async jobs
     * Tool: cernion_job_status
     */
    jobStatus: {
      rest: 'GET /job-status/:jobId',
      params: {
        jobId: { type: 'string', min: 1 },
      },
      openapi: {
        summary: 'Check status of async jobs',
        tags: ['System Tools'],
        description: 'Job states: queued, running, succeeded, failed',
        parameters: [
          {
            name: 'jobId',
            in: 'path',
            required: true,
            schema: { type: 'string', example: 'job_abc123' },
            description: 'Async job ID returned by a long-running endpoint',
          },
        ],
      },
      async handler(ctx) {
        return await CernionMCPClient.callWithNewSession(
          'cernion_job_status',
          {
            job_id: ctx.params.jobId,
          },
          ctx.meta.cernionToken
        );
      },
    },

    /**
     * Retrieve result of async job
     * Tool: cernion_job_result
     */
    jobResult: {
      rest: 'GET /job-result/:jobId',
      params: {
        jobId: { type: 'string', min: 1 },
      },
      openapi: {
        summary: 'Retrieve result of async job',
        tags: ['System Tools'],
        description: 'Polling for long-running operations, retrieve results after completion',
        parameters: [
          {
            name: 'jobId',
            in: 'path',
            required: true,
            schema: { type: 'string', example: 'job_abc123' },
            description: 'Async job ID returned by a long-running endpoint',
          },
        ],
      },
      async handler(ctx) {
        return await CernionMCPClient.callWithNewSession(
          'cernion_job_result',
          {
            job_id: ctx.params.jobId,
          },
          ctx.meta.cernionToken
        );
      },
    },
  },
};
