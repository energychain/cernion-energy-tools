'use strict';
const { methodSchema } = require('./forecast-portfolio-contract');
const prefix = '/api/forecast-sandbox/consumption/portfolio';
const string = { type: 'string' };
const date = { type: 'string', format: 'date' };
const bool = { type: 'boolean', default: false };
const dataset = {
  type: 'object',
  required: ['series_id', 'unit', 'timezone', 'values'],
  properties: {
    series_id: string,
    unit: { type: 'string', enum: ['kWh', 'kW'] },
    timezone: string,
    value_semantics: {
      type: 'string',
      enum: ['interval_energy', 'average_power'],
      description:
        'kWh per interval or mean kW; cumulative OBIS register readings must be differenced before upload.',
    },
    profile_label: { type: 'string', pattern: '^[a-zA-Z0-9_-]{1,64}$' },
    profile_available_at: { type: 'string', format: 'date-time' },
    period_from: date,
    period_until: date,
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
          reactive_power_kvar: {
            type: 'number',
            nullable: true,
            description:
              'Optional mean reactive power over the same quarter-hour; signed kvar. Missing is not zero.',
          },
          available_at: { type: 'string', format: 'date-time' },
        },
      },
    },
  },
};
const contracts = {
  history: {
    path: '/history',
    method: 'post',
    summary: 'Merge immutable, revision-aware meter history',
    required: [],
    properties: { dataset, dataset_id: string, historical_import: bool, allow_corrections: bool },
  },
  train: {
    path: '/train',
    method: 'post',
    summary: 'Fit and persist a portfolio model version at a past-only 07:00 origin',
    required: ['series_ids', 'forecast_for'],
    properties: {
      series_ids: { type: 'array', minItems: 1, maxItems: 16, uniqueItems: true, items: string },
      forecast_for: date,
      portfolio_method: methodSchema,
      strategy: {
        type: 'string',
        enum: ['portfolio', 'shared_baseline'],
        description:
          'One series defaults to shared_baseline; multiple series default to portfolio. Use shared_baseline for initial common corpus training and ongoing contributions. Do not combine with portfolio_method.',
      },
    },
  },
  predict: {
    path: '/predict',
    method: 'post',
    summary: 'Predict with a persisted model and optional incremental measurements',
    required: ['series_id', 'model_version', 'forecast_for'],
    properties: {
      series_id: string,
      model_version: string,
      forecast_for: date,
      recent_dataset: dataset,
      history_version: string,
      allow_corrections: bool,
      allow_stale_model: bool,
    },
  },
  inspect: {
    path: '/models/{model_version}',
    method: 'get',
    summary: 'Inspect immutable model, origin, selection and next refit date',
    keys: ['model_version'],
  },
  retrain: {
    path: '/retrain',
    method: 'post',
    summary: 'Retrain the model portfolio using its members and current history snapshots',
    required: ['model_version', 'forecast_for'],
    properties: { model_version: string, forecast_for: date },
  },
  resume: {
    path: '/runs/{run_id}/resume',
    method: 'post',
    summary: 'Resume compatible durable checkpoints or return the completed result manifest',
    keys: ['run_id'],
  },
  status: {
    path: '/runs/{run_id}',
    method: 'get',
    summary: 'Inspect durable run independently of job TTL',
    keys: ['run_id'],
  },
  series: {
    path: '/runs/{run_id}/series/{series_key}',
    method: 'get',
    summary: 'Stream one completed series result as JSON',
    keys: ['run_id', 'series_key'],
  },
};
function operation(name) {
  const c = contracts[name];
  return {
    summary: c.summary,
    description:
      'Live training/history/model access requires a credential bound to the tenant; a tenant header alone is insufficient. Shared-baseline contributors remain internal; only tenant-owned meter predictions are returned.',
    tags: ['Forecast Sandbox'],
    security: [{ BearerAuth: [] }],
    ...(c.keys
      ? {
          parameters: c.keys.map((key) => ({
            name: key,
            in: 'path',
            required: true,
            schema: string,
          })),
        }
      : {}),
    ...(c.properties
      ? {
          requestBody: {
            required: true,
            content: {
              'application/json': {
                schema: {
                  type: 'object',
                  required: c.required,
                  properties: c.properties,
                  additionalProperties: false,
                },
              },
            },
          },
        }
      : {}),
    responses: {
      200: {
        description: 'Result, immutable version, or durable result manifest',
        content: { 'application/json': { schema: { type: 'object' } } },
      },
      202: require('./forecast-job-openapi').accepted,
      401: { description: 'Credential with a bound tenant is required for live model operations' },
      400: { description: 'Invalid input, unknown tenant-owned artifact, or incompatible resume' },
    },
  };
}
function paths() {
  return Object.fromEntries(
    Object.keys(contracts).map((k) => [
      prefix + contracts[k].path,
      { [contracts[k].method]: operation(k) },
    ])
  );
}
module.exports = { operation, paths };
