'use strict';

/**
 * Forecast Sandbox API v0.1 (CR-CET-FORECAST-SANDBOX-V0.1)
 *
 * Generic CET sandbox/evaluation path for RLM/iMSys day-ahead consumption forecasting:
 * validate a submitted PT15M series, generate a deterministic weekday-profile baseline
 * day-ahead forecast, and backtest that baseline against historical actuals. Sales-facing
 * (see docs/forecast-sandbox.md) — explicitly no SLA, no forecast-quality guarantee, no
 * balancing-energy-risk-reduction guarantee (see `commercialBoundary` on every response).
 *
 * Stateless by design: nothing submitted here is persisted (no PouchDB, no own storage),
 * which is also what keeps it usable without any personally-identifying customer data —
 * seriesId is expected to be pseudonymous.
 *
 * All business logic lives in src/forecast-sandbox-baseline.js (reuses
 * calculateForecastQuality from src/forecast-calculator.js for MAE/RMSE/MAPE/bias) and
 * src/forecast-sandbox-openapi.js (isolated OpenAPI document); this service is a thin
 * Moleculer/REST wrapper around them.
 */

const {
  ERROR_CODES,
  SandboxRequestError,
  validateConsumptionSeries,
  dayAheadConsumption,
  backtestConsumption,
  toErrorResponse,
} = require('../src/forecast-sandbox-baseline');
const { buildIsolatedOpenApiSpec, TAG_NAME } = require('../src/forecast-sandbox-openapi');

const consumptionValueParams = {
  type: 'array',
  min: 1,
  items: {
    type: 'object',
    props: {
      ts: { type: 'string', min: 1 },
      value: { type: 'number', convert: true },
    },
  },
};

function statusCodeFor(code) {
  return code === ERROR_CODES.INTERNAL_FORECAST_ERROR ? 500 : 400;
}

// Runs a baseline computation and normalises both the SandboxRequestError case and any
// unexpected exception into the same {status:'error', ...} envelope, with the matching
// HTTP status set via ctx.meta.$statusCode — this endpoint must never crash the gateway,
// per CR §7 ("Sommerzeitfälle nicht crashen lassen").
function runSandboxAction(ctx, computeFn) {
  try {
    return computeFn(ctx.params);
  } catch (err) {
    if (!(err instanceof SandboxRequestError)) {
      ctx.service.logger.error('Forecast sandbox internal error:', err);
    }
    ctx.meta.$statusCode = statusCodeFor(
      err instanceof SandboxRequestError ? err.code : ERROR_CODES.INTERNAL_FORECAST_ERROR
    );
    return toErrorResponse(err);
  }
}

const validateRequestBodySchema = {
  type: 'object',
  required: ['seriesId', 'granularity', 'timezone', 'unit', 'values'],
  properties: {
    seriesId: { type: 'string', example: 'cells-demo-001' },
    meteringType: { type: 'string', enum: ['RLM', 'iMSys'], example: 'RLM' },
    granularity: { type: 'string', enum: ['PT15M'], example: 'PT15M' },
    timezone: { type: 'string', example: 'Europe/Berlin' },
    unit: { type: 'string', enum: ['kWh', 'kW'], example: 'kWh' },
    values: {
      type: 'array',
      items: {
        type: 'object',
        properties: {
          ts: { type: 'string', format: 'date-time', example: '2025-01-01T00:00:00+01:00' },
          value: { type: 'number', example: 12.34 },
        },
      },
    },
    options: {
      type: 'object',
      properties: {
        allowNegativeValues: { type: 'boolean', default: false },
        detectOutliers: { type: 'boolean', default: true },
        strictQuarterHourGrid: { type: 'boolean', default: true },
      },
    },
  },
};

module.exports = {
  name: 'forecast-sandbox',

  settings: {
    idField: '_id',
  },

  metadata: {
    scalable: true,
    priority: 5,
  },

  actions: {
    validateConsumptionSeries: {
      rest: 'POST /consumption/validate',
      params: {
        seriesId: { type: 'string', min: 1 },
        meteringType: { type: 'enum', values: ['RLM', 'iMSys'], optional: true },
        granularity: { type: 'string', min: 1 },
        timezone: { type: 'string', min: 1 },
        unit: { type: 'string', min: 1 },
        values: consumptionValueParams,
        options: {
          type: 'object',
          optional: true,
          props: {
            allowNegativeValues: { type: 'boolean', optional: true, convert: true },
            detectOutliers: { type: 'boolean', optional: true, convert: true },
            strictQuarterHourGrid: { type: 'boolean', optional: true, convert: true },
          },
        },
      },
      openapi: {
        summary: 'Validate a quarter-hourly consumption series',
        tags: [TAG_NAME],
        description:
          'Checks whether a submitted PT15M consumption series is technically fit for a ' +
          'forecast/backtest path: grid alignment, missing/duplicate intervals, negative ' +
          'values, and outliers. Sandbox/evaluation use only — see `commercialBoundary`.',
        requestBody: {
          required: true,
          content: { 'application/json': { schema: validateRequestBodySchema } },
        },
        responses: {
          200: { description: 'Validation processed (see `validation.accepted` and `errors`).' },
        },
      },
      handler(ctx) {
        return runSandboxAction(ctx, validateConsumptionSeries);
      },
    },

    dayAheadConsumption: {
      rest: 'POST /consumption/day-ahead',
      params: {
        seriesId: { type: 'string', min: 1 },
        forecastDate: { type: 'string', pattern: /^\d{4}-\d{2}-\d{2}$/ },
        granularity: { type: 'string', min: 1 },
        timezone: { type: 'string', min: 1 },
        unit: { type: 'string', min: 1 },
        historicalValues: consumptionValueParams,
        options: {
          type: 'object',
          optional: true,
          props: {
            includeConfidenceBand: { type: 'boolean', optional: true, convert: true },
            includeQualityHints: { type: 'boolean', optional: true, convert: true },
            method: { type: 'enum', values: ['baseline'], optional: true },
          },
        },
      },
      openapi: {
        summary: 'Generate a baseline day-ahead consumption forecast',
        tags: [TAG_NAME],
        description:
          'Deterministic weekday-profile baseline forecast (method ' +
          '`baseline_weekday_profile_v0`) for one calendar day, from historical PT15M ' +
          'consumption values. Baseline only — no ML, no production commitment.',
        responses: {
          200: { description: 'Forecast generated (see `method` for the baseline method used).' },
        },
      },
      handler(ctx) {
        return runSandboxAction(ctx, dayAheadConsumption);
      },
    },

    backtestConsumption: {
      rest: 'POST /consumption/backtest',
      params: {
        seriesId: { type: 'string', min: 1 },
        granularity: { type: 'string', min: 1 },
        timezone: { type: 'string', min: 1 },
        unit: { type: 'string', min: 1 },
        trainFrom: { type: 'string', pattern: /^\d{4}-\d{2}-\d{2}$/ },
        trainTo: { type: 'string', pattern: /^\d{4}-\d{2}-\d{2}$/ },
        testFrom: { type: 'string', pattern: /^\d{4}-\d{2}-\d{2}$/ },
        testTo: { type: 'string', pattern: /^\d{4}-\d{2}-\d{2}$/ },
        historicalValues: consumptionValueParams,
        actualValues: consumptionValueParams,
        options: {
          type: 'object',
          optional: true,
          props: {
            method: { type: 'enum', values: ['baseline'], optional: true },
            metrics: { type: 'array', optional: true, items: 'string' },
            includeDailyBreakdown: { type: 'boolean', optional: true, convert: true },
            includeAeRiskProxy: { type: 'boolean', optional: true, convert: true },
          },
        },
      },
      openapi: {
        summary: 'Backtest the baseline forecast against historical actuals',
        tags: [TAG_NAME],
        description:
          'Trains the weekday-profile baseline on [trainFrom, trainTo] and evaluates it ' +
          'against actualValues in [testFrom, testTo]. Returns MAE/RMSE/MAPE/bias (via the ' +
          'same calculateForecastQuality helper used by /api/forecast/quality), an ' +
          'absolute-error-only aeRiskProxy, and a readiness verdict. No cost/€ guarantee.',
        responses: {
          200: { description: 'Backtest computed (see `metrics` and `readiness`).' },
        },
      },
      handler(ctx) {
        return runSandboxAction(ctx, backtestConsumption);
      },
    },

    openapi: {
      rest: 'GET /openapi.json',
      openapi: {
        summary: 'Isolated OpenAPI document for the Forecast Sandbox endpoints',
        tags: [TAG_NAME],
        description:
          'Returns a standalone OpenAPI 3.x document containing only the ' +
          '/api/forecast-sandbox/* paths — meant to be linked directly to a B2B lead, ' +
          'without the rest of the CET API surface.',
        responses: { 200: { description: 'OpenAPI 3.x document.' } },
      },
      handler(ctx) {
        ctx.meta.$responseHeaders = { 'Cache-Control': 'no-cache' };
        return buildIsolatedOpenApiSpec();
      },
    },
  },
};
