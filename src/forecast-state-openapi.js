'use strict';

function stateOperation(action) {
  const dataset = {
    type: 'object',
    required: ['series_id', 'unit', 'timezone', 'period_from', 'period_until', 'values'],
    properties: {
      series_id: { type: 'string' },
      unit: { type: 'string', enum: ['kWh', 'kW'] },
      timezone: { type: 'string' },
      weather_region: { type: 'string' },
      period_from: { type: 'string', format: 'date' },
      period_until: { type: 'string', format: 'date' },
      values: {
        type: 'array',
        minItems: 1,
        maxItems: 220000,
        items: {
          type: 'object',
          required: ['timestamp', 'value'],
          properties: {
            timestamp: { type: 'string', format: 'date-time' },
            value: { type: 'number', minimum: 0 },
            available_at: { type: 'string', format: 'date-time' },
          },
        },
      },
    },
  };
  return {
    summary: `${action} a versioned per-series daily-state forecast model`,
    tags: ['Forecast Sandbox'],
    description:
      'Sandbox only. History/calendar training uses relationship_state_correction_v2; extended features use relationship_state_context_guard_v4 with a protected automatic reference. Both combine: automatic calendar/recency reference plus historically validated state correction. Existing v1/v2/v3 artifacts remain readable. Historical labels and transition models use D-2 availability. Immutable tenant-scoped artifacts. Train requires at least 14 complete days; activating state features requires historical validation. Predict reloads frozen parameters and can persist recent complete-day context without retraining. Live dates beyond 2025 supported; no future knowledge origins.',
    security: [{ BearerAuth: [] }],
    requestBody: {
      required: true,
      content: {
        'application/json': {
          schema: {
            type: 'object',
            required:
              action === 'train'
                ? ['dataset', 'forecast_for']
                : action === 'predict'
                  ? ['series_id', 'artifact_version', 'forecast_for']
                  : ['series_id', 'artifact_version'],
            properties:
              action === 'train'
                ? {
                    dataset,
                    forecast_for: { type: 'string', format: 'date' },
                    configuration: {
                      type: 'object',
                      description:
                        'Optional issue_time, extended_features, feature_set, weather_dataset_id/context_dataset_id or inline weather/context. Prediction threshold is saved with the artifact and applied during inference.',
                      properties: {
                        prediction_threshold_w: require('./forecast-prediction-threshold')
                          .thresholdSchema,
                      },
                    },
                  }
                : {
                    series_id: { type: 'string' },
                    artifact_version: { type: 'string', pattern: '^[a-f0-9]{64}$' },
                    ...(action === 'predict'
                      ? {
                          forecast_for: { type: 'string', format: 'date' },
                          recent_dataset: dataset,
                          configuration: {
                            type: 'object',
                            description:
                              'Refresh weather/context or immutable dataset IDs only. Model parameters and issue_time remain frozen.',
                          },
                        }
                      : {}),
                  },
          },
        },
      },
    },
    responses: {
      200: {
        description:
          'Version metadata, validation or PT15M forecasts; inspect warnings and state_features_enabled.',
        content: {
          'application/json': {
            schema: {
              type: 'object',
              properties: {
                series_id: { type: 'string' },
                artifact_version: { type: 'string' },
                model_version: { type: 'string' },
                forecast_values: { type: 'array', items: { type: 'object' } },
                validation: { type: 'object' },
                warnings: { type: 'array', items: { type: 'string' } },
              },
            },
          },
        },
      },
      400: { description: 'Invalid dataset, missing model or incompatible historical origin.' },
      500: { description: 'Internal forecast/storage error.' },
    },
  };
}
module.exports = { stateOperation };
