'use strict';
function featureOperation(kind) {
  const weather = kind === 'weather';
  const dates = weather
    ? ['history_from', 'history_until', 'forecast_from', 'forecast_until']
    : ['from', 'until'];
  return {
    summary: `Prepare immutable historical ${kind} features`,
    tags: ['Forecast Sandbox'],
    description:
      'Cached historical feature preparation. Inspect availability_policy: final exports and reconstructed publication times are not verified historical vintages. IDs can be used by evaluation and state-model APIs. Weather connector supports Kempten.',
    security: [{ BearerAuth: [] }],
    requestBody: {
      required: true,
      content: {
        'application/json': {
          schema: {
            type: 'object',
            required: dates,
            properties: {
              ...Object.fromEntries(dates.map((d) => [d, { type: 'string', format: 'date' }])),
              ...(weather
                ? { location: { type: 'string', enum: ['kempten'], default: 'kempten' } }
                : {}),
            },
          },
        },
      },
    },
    responses: {
      200: {
        description: 'Immutable dataset ID, provenance, coverage and availability assumptions.',
        content: { 'application/json': { schema: { type: 'object' } } },
      },
      400: { description: 'Invalid preparation request.' },
      500: { description: 'Feature provider failed; no fabricated data.' },
    },
  };
}
module.exports = { featureOperation };
