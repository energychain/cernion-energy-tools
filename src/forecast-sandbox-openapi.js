'use strict';

/**
 * Isolated OpenAPI 3.x document for the Forecast Sandbox v0.1 endpoints only
 * (CR-CET-FORECAST-SANDBOX-V0.1 §5.2). Deliberately self-contained rather than a
 * filtered slice of the global `/api/openapi.json` — this document is meant to be
 * handed to an external lead as a small, standalone contract (Sales use, see
 * docs/forecast-sandbox.md), so it must stay valid and complete without pulling in
 * any other CET service's schemas.
 */

const { version: packageVersion } = require('../package.json');
const { SANDBOX_VERSION } = require('./forecast-sandbox-baseline');

const TAG_NAME = 'Forecast Sandbox';

const commercialBoundarySchema = {
  type: 'object',
  description: 'Evaluation-scope disclosure attached to every sandbox response.',
  properties: {
    scope: { type: 'string' },
    productionUse: { type: 'boolean', example: false },
    sla: { type: 'boolean', example: false },
    forecastQualityGuarantee: { type: 'boolean', example: false },
    balancingEnergyRiskReductionGuarantee: { type: 'boolean', example: false },
    nextCommercialStep: { type: 'string', example: 'paid_backtest_mini_check' },
  },
};

const consumptionValueSchema = {
  type: 'object',
  required: ['ts', 'value'],
  properties: {
    ts: { type: 'string', format: 'date-time', example: '2025-01-01T00:00:00+01:00' },
    value: { type: 'number', example: 12.34 },
  },
};

const errorResponseSchema = {
  type: 'object',
  required: ['status', 'sandboxVersion', 'error', 'commercialBoundary'],
  properties: {
    status: { type: 'string', enum: ['error'] },
    sandboxVersion: { type: 'string', example: SANDBOX_VERSION },
    error: {
      type: 'object',
      required: ['code', 'message'],
      properties: {
        code: {
          type: 'string',
          enum: [
            'INVALID_PAYLOAD',
            'INVALID_TIMESTAMP',
            'INVALID_GRANULARITY',
            'MISSING_VALUES',
            'DUPLICATE_INTERVALS',
            'INSUFFICIENT_HISTORY',
            'INVALID_BACKTEST_PERIOD',
            'ZERO_VALUES_FOR_MAPE',
            'UNSUPPORTED_UNIT',
            'INTERNAL_FORECAST_ERROR',
          ],
        },
        message: { type: 'string' },
        details: { type: 'object' },
      },
    },
    commercialBoundary: commercialBoundarySchema,
  },
};

const validateRequestSchema = {
  type: 'object',
  required: ['seriesId', 'granularity', 'timezone', 'unit', 'values'],
  properties: {
    seriesId: { type: 'string', example: 'cells-demo-001' },
    meteringType: { type: 'string', enum: ['RLM', 'iMSys'], example: 'RLM' },
    granularity: { type: 'string', enum: ['PT15M'], example: 'PT15M' },
    timezone: { type: 'string', example: 'Europe/Berlin' },
    unit: { type: 'string', enum: ['kWh', 'kW'], example: 'kWh' },
    values: { type: 'array', items: consumptionValueSchema },
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

const validateResponseSchema = {
  type: 'object',
  properties: {
    status: { type: 'string', enum: ['ok'] },
    sandboxVersion: { type: 'string', example: SANDBOX_VERSION },
    seriesId: { type: 'string' },
    validation: {
      type: 'object',
      properties: {
        accepted: { type: 'boolean' },
        detectedGranularity: { type: 'string' },
        timezone: { type: 'string' },
        valueCount: { type: 'integer' },
        from: { type: 'string', format: 'date-time', nullable: true },
        to: { type: 'string', format: 'date-time', nullable: true },
        missingIntervals: { type: 'integer' },
        duplicateIntervals: { type: 'integer' },
        negativeValues: { type: 'integer' },
        outlierCount: { type: 'integer' },
        coverageRatio: { type: 'number' },
      },
    },
    warnings: { type: 'array', items: { type: 'object' } },
    errors: { type: 'array', items: { type: 'object' } },
    commercialBoundary: commercialBoundarySchema,
  },
};

const dayAheadRequestSchema = {
  type: 'object',
  required: ['seriesId', 'forecastDate', 'granularity', 'timezone', 'unit', 'historicalValues'],
  properties: {
    seriesId: { type: 'string', example: 'cells-demo-001' },
    forecastDate: { type: 'string', format: 'date', example: '2026-09-16' },
    granularity: { type: 'string', enum: ['PT15M'] },
    timezone: { type: 'string', example: 'Europe/Berlin' },
    unit: { type: 'string', enum: ['kWh', 'kW'], example: 'kWh' },
    historicalValues: { type: 'array', items: consumptionValueSchema },
    options: {
      type: 'object',
      properties: {
        includeConfidenceBand: { type: 'boolean', default: true },
        includeQualityHints: { type: 'boolean', default: true },
        method: { type: 'string', enum: ['baseline'], default: 'baseline' },
      },
    },
  },
};

const dayAheadResponseSchema = {
  type: 'object',
  properties: {
    status: { type: 'string', enum: ['ok'] },
    sandboxVersion: { type: 'string', example: SANDBOX_VERSION },
    seriesId: { type: 'string' },
    forecastDate: { type: 'string', format: 'date' },
    granularity: { type: 'string' },
    timezone: { type: 'string' },
    unit: { type: 'string' },
    method: {
      type: 'object',
      properties: {
        id: { type: 'string', example: 'baseline_weekday_profile_v0' },
        description: { type: 'string' },
        productionModel: { type: 'boolean', example: false },
      },
    },
    forecast: {
      type: 'array',
      items: {
        type: 'object',
        properties: {
          ts: { type: 'string', format: 'date-time' },
          value: { type: 'number' },
          lower: { type: 'number' },
          upper: { type: 'number' },
        },
      },
    },
    summary: {
      type: 'object',
      properties: {
        intervals: { type: 'integer', example: 96 },
        totalKwh: { type: 'number' },
        minKwEquivalent: { type: 'number' },
        maxKwEquivalent: { type: 'number' },
      },
    },
    warnings: { type: 'array', items: { type: 'object' } },
    qualityHints: { type: 'array', items: { type: 'object' } },
    commercialBoundary: commercialBoundarySchema,
  },
};

const backtestRequestSchema = {
  type: 'object',
  required: [
    'seriesId',
    'granularity',
    'timezone',
    'unit',
    'trainFrom',
    'trainTo',
    'testFrom',
    'testTo',
    'historicalValues',
    'actualValues',
  ],
  properties: {
    seriesId: { type: 'string', example: 'cells-demo-001' },
    granularity: { type: 'string', enum: ['PT15M'] },
    timezone: { type: 'string', example: 'Europe/Berlin' },
    unit: { type: 'string', enum: ['kWh', 'kW'], example: 'kWh' },
    trainFrom: { type: 'string', format: 'date', example: '2021-01-01' },
    trainTo: { type: 'string', format: 'date', example: '2024-12-31' },
    testFrom: { type: 'string', format: 'date', example: '2025-01-01' },
    testTo: { type: 'string', format: 'date', example: '2025-12-31' },
    historicalValues: { type: 'array', items: consumptionValueSchema },
    actualValues: { type: 'array', items: consumptionValueSchema },
    options: {
      type: 'object',
      properties: {
        method: { type: 'string', enum: ['baseline'], default: 'baseline' },
        metrics: {
          type: 'array',
          items: { type: 'string', enum: ['MAE', 'RMSE', 'MAPE', 'BIAS', 'DAILY_ENERGY_ERROR'] },
        },
        includeDailyBreakdown: { type: 'boolean', default: true },
        includeAeRiskProxy: { type: 'boolean', default: true },
      },
    },
  },
};

const backtestResponseSchema = {
  type: 'object',
  properties: {
    status: { type: 'string', enum: ['ok'] },
    sandboxVersion: { type: 'string', example: SANDBOX_VERSION },
    seriesId: { type: 'string' },
    method: {
      type: 'object',
      properties: {
        id: { type: 'string', example: 'baseline_weekday_profile_v0' },
        productionModel: { type: 'boolean', example: false },
      },
    },
    period: {
      type: 'object',
      properties: {
        trainFrom: { type: 'string', format: 'date' },
        trainTo: { type: 'string', format: 'date' },
        testFrom: { type: 'string', format: 'date' },
        testTo: { type: 'string', format: 'date' },
      },
    },
    metrics: {
      type: 'object',
      properties: {
        maeKwh: { type: 'number' },
        rmseKwh: { type: 'number' },
        mapePercent: { type: 'number' },
        biasKwh: { type: 'number' },
        dailyEnergyErrorMeanPercent: { type: 'number' },
      },
    },
    aeRiskProxy: {
      type: 'object',
      properties: {
        available: { type: 'boolean' },
        method: { type: 'string', example: 'absolute_forecast_error_proxy_v0' },
        totalAbsoluteDeviationKwh: { type: 'number' },
        note: { type: 'string' },
      },
    },
    readiness: {
      type: 'object',
      properties: {
        backtestReady: { type: 'boolean' },
        dataQuality: { type: 'string', enum: ['usable', 'limited'] },
        recommendedNextStep: { type: 'string' },
      },
    },
    dailyBreakdown: {
      type: 'array',
      items: {
        type: 'object',
        properties: {
          date: { type: 'string', format: 'date' },
          actualKwh: { type: 'number' },
          forecastKwh: { type: 'number' },
          absoluteErrorKwh: { type: 'number' },
          mapePercent: { type: 'number' },
        },
      },
    },
    warnings: { type: 'array', items: { type: 'object' } },
    commercialBoundary: commercialBoundarySchema,
  },
};

function jsonOperation({ summary, description, requestSchema, responseSchema }) {
  return {
    summary,
    description,
    tags: [TAG_NAME],
    security: [{ BearerAuth: [] }],
    requestBody: {
      required: true,
      content: { 'application/json': { schema: requestSchema } },
    },
    responses: {
      200: {
        description: 'Sandbox request processed (see `status` for ok/error).',
        content: {
          'application/json': {
            schema: { oneOf: [responseSchema, { $ref: '#/components/schemas/SandboxError' }] },
          },
        },
      },
    },
  };
}

function buildIsolatedOpenApiSpec({ serverUrl } = {}) {
  return {
    openapi: '3.0.3',
    info: {
      title: 'Cernion Forecast Sandbox API',
      version: '0.1.0',
      description:
        'Sandbox API for validating quarter-hourly consumption series, generating baseline ' +
        'day-ahead consumption forecasts, and running forecast backtests. Evaluation use only. ' +
        'No production SLA, no forecast-quality guarantee, no balancing-energy-risk reduction ' +
        `guarantee. Part of Cernion Energy Tools ${packageVersion}.`,
    },
    servers: [{ url: serverUrl || 'https://api.cernion.de' }],
    tags: [
      {
        name: TAG_NAME,
        description:
          'Evaluation-only endpoints for RLM/iMSys day-ahead consumption forecast and backtest ' +
          'sandbox checks. No SLA, no forecast-quality guarantee.',
      },
    ],
    paths: {
      '/api/forecast-sandbox/consumption/validate': {
        post: jsonOperation({
          summary: 'Validate a quarter-hourly consumption series',
          description:
            'Checks a submitted PT15M consumption series for grid alignment, missing/duplicate ' +
            'intervals, negative values, and outliers before it is used for forecasting.',
          requestSchema: validateRequestSchema,
          responseSchema: validateResponseSchema,
        }),
      },
      '/api/forecast-sandbox/consumption/day-ahead': {
        post: jsonOperation({
          summary: 'Generate a baseline day-ahead consumption forecast',
          description:
            'Deterministic weekday-profile baseline forecast (method ' +
            '"baseline_weekday_profile_v0") for one calendar day, 96 quarter-hour intervals.',
          requestSchema: dayAheadRequestSchema,
          responseSchema: dayAheadResponseSchema,
        }),
      },
      '/api/forecast-sandbox/consumption/backtest': {
        post: jsonOperation({
          summary: 'Backtest the baseline forecast against historical actuals',
          description:
            'Trains the weekday-profile baseline on [trainFrom, trainTo] and evaluates it against ' +
            'actualValues in [testFrom, testTo], returning MAE/RMSE/MAPE/bias and a readiness verdict.',
          requestSchema: backtestRequestSchema,
          responseSchema: backtestResponseSchema,
        }),
      },
      '/api/forecast-sandbox/openapi.json': {
        get: {
          summary: 'Isolated OpenAPI document for the Forecast Sandbox endpoints',
          description: 'Returns this document.',
          tags: [TAG_NAME],
          security: [],
          responses: {
            200: {
              description: 'OpenAPI 3.x document scoped to the Forecast Sandbox endpoints.',
              content: { 'application/json': { schema: { type: 'object' } } },
            },
          },
        },
      },
    },
    components: {
      securitySchemes: {
        BearerAuth: {
          type: 'http',
          scheme: 'bearer',
          bearerFormat: 'JWT',
          description:
            'Cernion API token (full-access scope). Request one at https://cernion.de/cet-token/.',
        },
      },
      schemas: {
        ConsumptionValue: consumptionValueSchema,
        CommercialBoundary: commercialBoundarySchema,
        SandboxError: errorResponseSchema,
        ValidateRequest: validateRequestSchema,
        ValidateResponse: validateResponseSchema,
        DayAheadRequest: dayAheadRequestSchema,
        DayAheadResponse: dayAheadResponseSchema,
        BacktestRequest: backtestRequestSchema,
        BacktestResponse: backtestResponseSchema,
      },
    },
  };
}

module.exports = { buildIsolatedOpenApiSpec, TAG_NAME };
