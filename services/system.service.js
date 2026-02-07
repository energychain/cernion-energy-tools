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
        description: 'Pre-validation before expensive operations, error prevention',
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
