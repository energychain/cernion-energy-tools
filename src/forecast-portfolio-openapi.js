'use strict';
const { methodSchema } = require('./forecast-portfolio-contract');
const { evaluationOperation } = require('./forecast-evaluation-openapi');
const dataset =
  evaluationOperation(false).requestBody.content['application/json'].schema.properties.datasets
    .items;
const configuration = {
  type: 'object',
  additionalProperties: false,
  required: [
    'model_family',
    'mode',
    'relationship_mode',
    'issue_time',
    'feature_set',
    'forecast_period_from',
    'forecast_period_until',
  ],
  properties: {
    portfolio_method: methodSchema,
    model_family: { type: 'string', enum: ['portfolio_catboost'] },
    mode: { type: 'string', enum: ['rolling_day_ahead'] },
    relationship_mode: { type: 'string', enum: ['auto'] },
    issue_time: { type: 'string', enum: ['07:00'] },
    feature_set: {
      type: 'array',
      minItems: 2,
      maxItems: 2,
      uniqueItems: true,
      items: { type: 'string', enum: ['history', 'calendar'] },
    },
    forecast_period_from: { type: 'string', format: 'date' },
    forecast_period_until: { type: 'string', format: 'date' },
    history_from: { type: 'string', format: 'date' },
    portfolio_stress_test: {
      type: 'boolean',
      default: true,
      description:
        'Evaluate input-only 5% point, latest eligible day and three-day outages; evaluation actuals unchanged.',
    },
  },
};
function portfolioOperation(upload) {
  return {
    summary: upload
      ? 'Stage one validated portfolio time series'
      : 'Backtest a joint CatBoost portfolio at D-1 07:00',
    description: upload
      ? 'Tenant-scoped immutable dataset stored locally by SHA-256. Submit each XLS separately, then use all dataset IDs in one portfolio run.'
      : 'Serial asynchronous forecast job; common chronological discovery/confirmation boundaries for 2–16 series. Weekly/two-week/weekday mean/median references, global/local/two-part CatBoost and local HGB. Versioned D-3 (default) or D-2 availability. MAE selection by default; optional RMSE ablation. Model selection is past-only; no quality guarantee.',
    tags: ['Forecast Sandbox'],
    security: [{ BearerAuth: [] }],
    requestBody: {
      required: true,
      content: {
        'application/json': {
          schema: upload
            ? { type: 'object', required: ['dataset'], properties: { dataset } }
            : {
                type: 'object',
                required: ['dataset_ids', 'configuration', 'payload_fit_confirmed'],
                properties: {
                  dataset_ids: {
                    type: 'array',
                    minItems: 2,
                    maxItems: 16,
                    uniqueItems: true,
                    items: { type: 'string', pattern: '^[a-f0-9]{64}$' },
                  },
                  configuration,
                  payload_fit_confirmed: { type: 'boolean', enum: [true] },
                },
              },
        },
      },
    },
    responses: {
      ...(upload
        ? {
            200: {
              description: 'Dataset ID and validation result.',
              content: {
                'application/json': {
                  schema: {
                    type: 'object',
                    required: ['status', 'dataset_id', 'series_id', 'validation'],
                    properties: {
                      status: { type: 'string' },
                      dataset_id: { type: 'string' },
                      series_id: { type: 'string' },
                      validation: { type: 'object' },
                    },
                  },
                },
              },
            },
          }
        : {
            200: {
              description:
                'Completed immutable run reused; result_manifest contains per-series result URLs.',
            },
            202: require('./forecast-job-openapi').accepted,
          }),
      400: { description: 'Invalid or unavailable dataset/configuration.' },
      500: { description: 'Portfolio execution unavailable.' },
    },
  };
}
module.exports = { portfolioOperation };
