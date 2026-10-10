'use strict';

const valueSchema = {
  type: 'object',
  required: ['timestamp', 'value'],
  properties: {
    timestamp: {
      type: 'string',
      format: 'date-time',
      description: 'Interval start with explicit offset or Z.',
    },
    value: { type: 'number', nullable: true },
    available_at: {
      type: 'string',
      format: 'date-time',
      description: 'Actual historical availability of this measurement/revision.',
    },
    quality_flag: { type: 'string' },
  },
};
const datasetSchema = {
  type: 'object',
  required: ['series_id', 'timezone', 'unit', 'values'],
  properties: {
    series_id: { type: 'string', description: 'Pseudonymous identifier; no personal data.' },
    timezone: { type: 'string', example: 'Europe/Berlin' },
    unit: { type: 'string', enum: ['kW', 'kWh'] },
    customer_type: { type: 'string' },
    segment: { type: 'string' },
    weather_region: { type: 'string' },
    period_from: { type: 'string', format: 'date', default: '2020-01-01' },
    period_until: { type: 'string', format: 'date', default: '2025-12-31' },
    field_mapping: {
      type: 'object',
      properties: { timestamp: { type: 'string' }, value: { type: 'string' } },
    },
    values: { type: 'array', minItems: 1, maxItems: 220000, items: valueSchema },
  },
};
const weatherValue = {
  type: 'object',
  required: ['timestamp'],
  properties: {
    timestamp: { type: 'string', format: 'date-time' },
    temperature: { type: 'number', description: 'Degrees Celsius.' },
    heating_degree_days_18: {
      type: 'number',
      description: 'Daily mean heating deficit, base 18 Celsius, K.d.',
    },
    humidity: { type: 'number', description: 'Relative humidity in percent.' },
    wind_speed: { type: 'number', description: 'Metres per second.' },
    global_radiation: { type: 'number', description: 'Watts per square metre.' },
    cloud_cover: { type: 'number', description: 'Cloud cover in percent.' },
    precipitation: { type: 'number', description: 'Millimetres per PT15M interval.' },
    issued_at: { type: 'string', format: 'date-time' },
    available_at: { type: 'string', format: 'date-time' },
  },
};
const configurationSchema = {
  type: 'object',
  required: ['mode', 'forecast_period_from', 'forecast_period_until'],
  properties: {
    extended_features: {
      type: 'boolean',
      default: false,
      description: 'Include season in automatic candidate selection.',
    },
    issue_time: {
      type: 'string',
      enum: ['00:00', '07:00', '18:00'],
      default: '00:00',
      description: 'Local D-1 issue time; meter history always ends D-2.',
    },
    weather_dataset_id: { type: 'string', pattern: '^[a-f0-9]{64}$' },
    context_dataset_id: { type: 'string', pattern: '^[a-f0-9]{64}$' },
    context: {
      type: 'object',
      description:
        'Versioned source/region plus rows with timestamp, available_at, day_ahead_price EUR/MWh or grid_load_lag2 MW and source_period_until.',
    },
    mode: { type: 'string', enum: ['static_year_forecast', 'rolling_day_ahead'] },
    model_family: {
      type: 'string',
      enum: ['relationship', 'learned_states'],
      default: 'relationship',
      description:
        'learned_states: nonnegative rolling auto forecast; version relationship_state_correction_v2 adds a past-validated state correction to automatic calendar/recency selection. RMSE gate and MAE guard every 28 days; daily reference fits. API persists the combined snapshot. Version relationship_state_context_guard_v4 supports optional weather/context and 18:00 origins; additional features must improve on the existing automatic model.',
    },
    relationship_mode: {
      type: 'string',
      enum: ['auto', 'manual'],
      default: 'auto',
      description:
        'Per-series automatic predictor selection using historical forward validation, independent confirmation and conditional ablation. Manual retains the original configured profile baseline.',
    },
    history_from: { type: 'string', format: 'date', default: '2020-01-01' },
    selection_policy: {
      type: 'string',
      enum: ['adaptive_rmse_v1'],
      description:
        'Opt-in RMSE objective; compare 28/84/365 days and all eligible history with temporal confirmation and MAE guard.',
    },
    prediction_threshold_w: require('./forecast-prediction-threshold').thresholdSchema,
    activity_model: {
      type: 'boolean',
      default: false,
      description:
        'With adaptive_rmse_v1, test separate activity-probability and positive-amount models for nonnegative histories with at least 20% zeros. Persisted and enabled only after confirmation.',
    },
    activity_labeling: {
      type: 'string',
      enum: ['learned_low_load_v1'],
      description:
        'Opt-in training-only near-zero labels, activity classifier and separate low/active amount trees. Requires activity_model and adaptive_rmse_v1. Each historical fold learns its own threshold; held-out RMSE gain and no MAE regression required. Negative net flows are excluded. Omit to retain exact-zero activity modeling.',
    },
    selection_metric: {
      type: 'string',
      enum: ['mae', 'rmse'],
      default: 'mae',
      description:
        'Automatic selection objective, consistently used for discovery, confirmation and conditional ablation. Both MAE and RMSE are always reported.',
    },
    recent_window_days: {
      type: 'integer',
      enum: [28, 84],
      default: 84,
      description:
        'Alternative recent-history window tested against full eligible history. It is used only if independently confirmed; this does not alter D-2.',
    },
    forecast_period_from: {
      type: 'string',
      format: 'date',
      example: '2025-01-01',
      description:
        'Rolling historical backtests support 2020–2025; static forecasts require 2025. Training remains strictly prior to each forecast cutoff.',
    },
    forecast_period_until: { type: 'string', format: 'date', example: '2025-12-31' },
    feature_set: {
      type: 'array',
      items: { type: 'string', enum: ['history', 'calendar', 'weather', 'context'] },
      description:
        'Allowed feature families. Auto default: history and derived calendar, plus weather when supplied. Supplying history alone intentionally disables calendar/weather discovery.',
    },
    calendar: {
      type: 'object',
      required: ['source', 'version', 'country', 'region'],
      properties: {
        source: { type: 'string' },
        version: { type: 'string' },
        country: { type: 'string' },
        region: { type: 'string' },
        features: {
          type: 'array',
          items: {
            type: 'string',
            enum: [
              'weekday',
              'weekend',
              'holiday',
              'working_day',
              'month',
              'season',
              'calendar_week',
              'bridge_day',
              'school_holiday',
              'special_day',
            ],
          },
        },
        days: {
          type: 'array',
          items: {
            type: 'object',
            required: ['date'],
            properties: {
              date: { type: 'string', format: 'date' },
              holiday: { type: 'boolean' },
              special_day: { type: 'string' },
              bridge_day: { type: 'boolean' },
              school_holiday: { type: 'boolean' },
              known_at: { type: 'string', format: 'date-time' },
            },
          },
        },
      },
    },
    weather: {
      type: 'object',
      required: ['source', 'version', 'region'],
      properties: {
        source: { type: 'string' },
        version: { type: 'string' },
        region: { type: 'string' },
        observations: {
          type: 'array',
          description: 'Requires available_at per observation.',
          items: weatherValue,
        },
        forecasts: {
          type: 'array',
          description: 'Archived forecasts; requires issued_at per forecast.',
          items: weatherValue,
        },
      },
    },
  },
};
const validationRequest = {
  type: 'object',
  required: ['datasets'],
  properties: {
    datasets: { type: 'array', minItems: 1, maxItems: 10, items: datasetSchema },
  },
};
const runRequest = {
  type: 'object',
  required: ['datasets', 'configuration', 'payload_fit_confirmed'],
  properties: {
    ...validationRequest.properties,
    payload_fit_confirmed: {
      type: 'boolean',
      description: 'Explicit confirmation after reviewing validation.',
    },
    configuration: configurationSchema,
  },
};
const responseSchema = {
  type: 'object',
  required: ['status', 'testcaseBoundary'],
  properties: {
    status: { type: 'string' },
    testcaseBoundary: { type: 'object' },
    validations: { type: 'array', items: { type: 'object' } },
    results: {
      type: 'array',
      items: {
        type: 'object',
        properties: {
          forecast_run: { type: 'object' },
          validation: { type: 'object' },
          forecast_values: {
            type: 'array',
            items: {
              type: 'object',
              properties: {
                timestamp: { type: 'string', format: 'date-time' },
                predicted_value: {
                  type: 'number',
                  description: 'Final prediction after optional threshold filtering.',
                },
                raw_predicted_value: {
                  type: 'number',
                  description: 'Unfiltered prediction; present when prediction_threshold_w > 0.',
                },
                prediction_zeroed: {
                  type: 'boolean',
                  description: 'True only when a nonzero raw prediction was set to zero.',
                },
                actual_value: { type: 'number', nullable: true },
                deviation: { type: 'number', nullable: true },
                training_data_until: { type: 'string', format: 'date-time' },
              },
            },
          },
          daily_results: { type: 'array', items: { type: 'object' } },
          backtest: {
            type: 'object',
            description: 'Metrics for final predictions against unchanged actual measurements.',
          },
          filter_evaluation: {
            type: 'object',
            description:
              'Present when filtering is enabled: threshold_w, threshold_value, unit, changed_intervals, actuals_modified=false, raw_backtest and filtered_backtest.',
          },
          deviation_energy: { type: 'object' },
          readiness_dossier: { type: 'object' },
          relationship_analysis: {
            type: 'object',
            nullable: true,
            properties: {
              version: { type: 'string' },
              causal_claim: { type: 'boolean', example: false },
              selections: {
                type: 'array',
                items: {
                  type: 'object',
                  properties: {
                    selection_id: { type: 'string' },
                    as_of: { type: 'string', format: 'date-time' },
                    status: {
                      type: 'string',
                      enum: [
                        'validated_relationships',
                        'baseline_retained',
                        'insufficient_evidence',
                      ],
                    },
                    selected_groups: { type: 'array', items: { type: 'string' } },
                    selected_window_days: {
                      type: 'integer',
                      nullable: true,
                      description: 'Null means all eligible history, no arbitrary truncation.',
                    },
                    historical_quality: {
                      type: 'object',
                      description:
                        'Untouched historical confirmation MSE/RMSE/MAE; available without 2025 actuals when history is sufficient.',
                    },
                    relationships: { type: 'array', items: { type: 'object' } },
                    candidates: { type: 'array', items: { type: 'object' } },
                  },
                },
              },
            },
          },
        },
      },
    },
  },
};
function evaluationOperation(run) {
  return {
    summary: run
      ? 'Evaluate static 2025 forecasts or rolling D-2 historical backtests within 2020–2025'
      : 'Validate pseudonymous 2020–2025 PT15M datasets',
    description:
      (run
        ? 'REST returns HTTP 202 and the standard /api/jobs status/progress/result URLs. Poll until completed or error; progress reports completed forecast days, not elapsed-time estimates. Internal broker calls await the result. '
        : '') +
      'Stateless sandbox evaluation. Explicit timezone, DST-aware local days. JSON export includes curves, training cutoffs, metrics and readiness dossier. No SLA or commercial commitment. API body limit: 25 MB; split series across requests when necessary.',
    tags: ['Forecast Sandbox'],
    security: [{ BearerAuth: [] }],
    requestBody: {
      required: true,
      content: { 'application/json': { schema: run ? runRequest : validationRequest } },
    },
    responses: {
      ...(run ? { 202: require('./forecast-job-openapi').accepted } : {}),
      200: {
        description: 'Evaluation or data validation result.',
        content: { 'application/json': { schema: responseSchema } },
      },
      400: {
        description:
          'Structured validation/configuration failure with status, error and testcaseBoundary.',
      },
      500: { description: 'Unexpected evaluation failure; internal details are not returned.' },
    },
  };
}
module.exports = { evaluationOperation };
