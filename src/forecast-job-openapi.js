'use strict';
const accepted = {
  description:
    'Forecast job accepted. Poll statusUrl/progressUrl; fetch resultUrl once completed. CPU work runs in a separate worker.',
  headers: {
    Location: { schema: { type: 'string' } },
    'Retry-After': { schema: { type: 'string' } },
  },
  content: {
    'application/json': {
      schema: {
        type: 'object',
        required: ['jobId', 'status', 'statusUrl', 'progressUrl', 'resultUrl'],
        properties: Object.fromEntries(
          ['jobId', 'status', 'statusUrl', 'progressUrl', 'resultUrl'].map((name) => [
            name,
            { type: 'string' },
          ])
        ),
      },
    },
  },
};
const cancelForecastOperation = {
  summary: 'Cancel a queued or running forecast evaluation job',
  tags: ['Forecast Sandbox'],
  description:
    'Terminates the forecast worker. Uses the existing job error state with error forecast_cancelled; scoped to the trusted gateway tenant. Completed results remain unchanged.',
  security: [{ BearerAuth: [] }],
  parameters: [{ name: 'jobId', in: 'path', required: true, schema: { type: 'string' } }],
  responses: {
    200: { description: 'Cancellation recorded or job already terminal.' },
    404: { description: 'Forecast job not found.' },
  },
};
module.exports = { accepted, cancelForecastOperation };
