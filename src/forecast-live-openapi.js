'use strict';
function liveFeatureOperation(kind) {
  return {
    summary: `Acquire published live ${kind} features`,
    tags: ['Forecast Sandbox'],
    description:
      'Fetch before the configured forecast origin. available_at is the actual completed acquisition time and is never backdated. Weather: Kempten, up to 14 days including today. Market context: today/tomorrow, quarter-hour DE-LU prices and completed D-2 German load. Missing/unpublished values remain missing. An optional historical base ID retains training/validation inputs.',
    security: [{ BearerAuth: [] }],
    requestBody: {
      required: true,
      content: {
        'application/json': {
          schema: {
            type: 'object',
            required: ['from', 'until'],
            properties: {
              from: { type: 'string', format: 'date' },
              until: { type: 'string', format: 'date' },
              base_dataset_id: { type: 'string', pattern: '^[a-f0-9]{64}$' },
            },
          },
        },
      },
    },
    responses: {
      200: {
        description: 'Immutable dataset ID, acquisition provenance, coverage and warnings.',
        content: { 'application/json': { schema: { type: 'object' } } },
      },
      500: {
        description:
          'Input/provider preparation failed; observations are never substituted for future weather.',
      },
    },
  };
}
module.exports = { liveFeatureOperation };
