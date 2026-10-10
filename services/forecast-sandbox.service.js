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
const {
  runEvaluation,
  validateEvaluation,
  EvaluationError,
  BOUNDARY,
} = require('../src/forecast-evaluation');
const { evaluationOperation } = require('../src/forecast-evaluation-openapi');
const {
  persistStateEvaluation,
  trainStateModel,
  inspectStateModel,
  predictStateModel,
} = require('../src/forecast-state-api');
const { prepareLiveWeather, prepareLiveContext } = require('../src/forecast-live-features');
const { liveFeatureOperation } = require('../src/forecast-live-openapi');
const { prepareWeatherDataset } = require('../src/forecast-weather-provider');
const { prepareContextDataset } = require('../src/forecast-context-provider');
const {
  startForecastJob,
  cancelForecastJob,
  stopForecastWorkers,
} = require('../src/forecast-evaluation-jobs');
const { cancelForecastOperation } = require('../src/forecast-job-openapi');
const { featureOperation } = require('../src/forecast-feature-openapi');
const { stateOperation } = require('../src/forecast-state-openapi');
const { portfolioOperation } = require('../src/forecast-portfolio-openapi');
const { savePortfolioDataset } = require('../src/forecast-portfolio-store');

const portfolioRuntime = require('../src/forecast-portfolio-runtime');
const portfolioRuntimeSpec = require('../src/forecast-portfolio-runtime-openapi');

function runEvaluationAction(ctx, compute) {
  try {
    return compute(ctx.params);
  } catch (err) {
    const expected = err instanceof EvaluationError;
    ctx.meta.$statusCode = expected ? (err.code === 'tenant_auth_required' ? 401 : 400) : 500;
    if (!expected) ctx.service.logger.error('Forecast evaluation failed:', err);
    return {
      status: expected ? err.code : 'forecast_failed',
      error: {
        code: expected ? err.code : 'forecast_failed',
        message: expected ? err.message : 'Forecast evaluation could not be completed.',
        details: expected ? err.details : {},
      },
      testcaseBoundary: BOUNDARY,
    };
  }
}

async function portfolioAction(ctx, compute) {
  try {
    return await compute(ctx.params);
  } catch (error) {
    return runEvaluationAction(ctx, () => {
      throw error;
    });
  }
}

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

  async started() {
    await require('../src/forecast-starter').bootstrap(this.logger);
  },

  stopped() {
    return stopForecastWorkers();
  },

  settings: {
    idField: '_id',
  },

  metadata: {
    scalable: true,
    priority: 5,
  },

  actions: {
    acquireLiveWeatherFeatures: {
      rest: 'POST /consumption/features/weather/live',
      params: {
        from: 'string',
        until: 'string',
        base_dataset_id: { type: 'string', optional: true },
      },
      openapi: liveFeatureOperation('weather'),
      async handler(ctx) {
        try {
          return await prepareLiveWeather(ctx.params, { token: process.env.CERNION_TOKEN });
        } catch (error) {
          return runEvaluationAction(ctx, () => {
            throw error;
          });
        }
      },
    },
    acquireLiveContextFeatures: {
      rest: 'POST /consumption/features/context/live',
      params: {
        from: 'string',
        until: 'string',
        base_dataset_id: { type: 'string', optional: true },
      },
      openapi: liveFeatureOperation('context'),
      async handler(ctx) {
        try {
          return await prepareLiveContext(ctx.params);
        } catch (error) {
          return runEvaluationAction(ctx, () => {
            throw error;
          });
        }
      },
    },
    prepareWeatherFeatures: {
      rest: 'POST /consumption/features/weather/prepare',
      params: {
        history_from: 'string',
        history_until: 'string',
        forecast_from: 'string',
        forecast_until: 'string',
        location: { type: 'string', optional: true },
      },
      openapi: featureOperation('weather'),
      async handler(ctx) {
        try {
          return await prepareWeatherDataset(ctx.params, { token: process.env.CERNION_TOKEN });
        } catch (error) {
          return runEvaluationAction(ctx, () => {
            throw error;
          });
        }
      },
    },
    prepareContextFeatures: {
      rest: 'POST /consumption/features/context/prepare',
      params: { from: 'string', until: 'string' },
      openapi: featureOperation('context'),
      async handler(ctx) {
        try {
          return await prepareContextDataset(ctx.params);
        } catch (error) {
          return runEvaluationAction(ctx, () => {
            throw error;
          });
        }
      },
    },
    trainStateModel: {
      params: {
        dataset: { type: 'object' },
        forecast_for: { type: 'string' },
        configuration: { type: 'object', optional: true },
      },
      rest: 'POST /consumption/state-model/train',
      openapi: stateOperation('train'),
      handler(ctx) {
        return runEvaluationAction(ctx, (p) => trainStateModel(p, ctx.meta));
      },
    },
    inspectStateModel: {
      params: { series_id: { type: 'string', min: 1 }, artifact_version: { type: 'string' } },
      rest: 'POST /consumption/state-model/inspect',
      openapi: stateOperation('inspect'),
      handler(ctx) {
        return runEvaluationAction(ctx, (p) => inspectStateModel(p, ctx.meta));
      },
    },
    predictStateModel: {
      params: {
        series_id: { type: 'string', min: 1 },
        artifact_version: { type: 'string' },
        forecast_for: { type: 'string' },
        recent_dataset: { type: 'object', optional: true },
        configuration: { type: 'object', optional: true },
      },
      rest: 'POST /consumption/state-model/predict',
      openapi: stateOperation('predict'),
      handler(ctx) {
        return runEvaluationAction(ctx, (p) => predictStateModel(p, ctx.meta));
      },
    },
    validateEvaluation: {
      rest: 'POST /consumption/evaluation/validate',
      params: { datasets: { type: 'array', min: 1, max: 10 } },
      openapi: evaluationOperation(false),
      handler(ctx) {
        return runEvaluationAction(ctx, validateEvaluation);
      },
    },
    uploadPortfolioDataset: {
      rest: 'POST /consumption/portfolio/datasets',
      params: { dataset: { type: 'object' } },
      openapi: portfolioOperation(true),
      handler(ctx) {
        return runEvaluationAction(ctx, (p) => savePortfolioDataset(p.dataset, ctx.meta));
      },
    },
    runPortfolioEvaluation: {
      rest: 'POST /consumption/portfolio/run',
      params: {
        dataset_ids: { type: 'array', min: 2, max: 16, items: 'string' },
        configuration: { type: 'object' },
        payload_fit_confirmed: { type: 'boolean' },
      },
      openapi: portfolioOperation(false),
      handler(ctx) {
        return portfolioAction(ctx, () => portfolioRuntime.backtest(ctx));
      },
    },
    portfolioHistory: {
      rest: 'POST /consumption/portfolio/history',
      params: {
        dataset: { type: 'object', optional: true },
        dataset_id: { type: 'string', optional: true },
        historical_import: { type: 'boolean', optional: true },
        allow_corrections: { type: 'boolean', optional: true },
      },
      openapi: portfolioRuntimeSpec.operation('history'),
      handler(ctx) {
        return portfolioAction(ctx, (p) => portfolioRuntime.ingest(p, ctx.meta));
      },
    },
    portfolioTrain: {
      rest: 'POST /consumption/portfolio/train',
      params: {
        series_ids: { type: 'array', min: 1, max: 16, items: 'string' },
        strategy: { type: 'enum', values: ['portfolio', 'shared_baseline'], optional: true },
        forecast_for: 'string',
        portfolio_method: { type: 'object', optional: true },
      },
      openapi: portfolioRuntimeSpec.operation('train'),
      handler(ctx) {
        return portfolioAction(ctx, (p) =>
          portfolioRuntime.begin(ctx, portfolioRuntime.taskForTrain(p, ctx.meta))
        );
      },
    },
    portfolioPredict: {
      rest: 'POST /consumption/portfolio/predict',
      params: {
        series_id: 'string',
        model_version: 'string',
        forecast_for: 'string',
        recent_dataset: { type: 'object', optional: true },
        history_version: { type: 'string', optional: true },
        allow_corrections: { type: 'boolean', optional: true },
        allow_stale_model: { type: 'boolean', optional: true },
      },
      openapi: portfolioRuntimeSpec.operation('predict'),
      handler(ctx) {
        return portfolioAction(ctx, (p) =>
          portfolioRuntime.begin(ctx, portfolioRuntime.taskForPredict(p, ctx.meta))
        );
      },
    },
    portfolioInspect: {
      rest: 'GET /consumption/portfolio/models/:model_version',
      params: { model_version: 'string' },
      openapi: portfolioRuntimeSpec.operation('inspect'),
      handler(ctx) {
        return runEvaluationAction(
          ctx,
          (p) => portfolioRuntime.model(ctx.meta, p.model_version).model
        );
      },
    },
    portfolioRetrain: {
      rest: 'POST /consumption/portfolio/retrain',
      params: { model_version: 'string', forecast_for: 'string' },
      openapi: portfolioRuntimeSpec.operation('retrain'),
      handler(ctx) {
        return portfolioAction(ctx, (p) => {
          const old = portfolioRuntime.model(ctx.meta, p.model_version).model;
          return portfolioRuntime.begin(
            ctx,
            portfolioRuntime.taskForTrain(
              {
                series_ids: Object.keys(old.identities),
                forecast_for: p.forecast_for,
                ...(old.strategy === 'shared_baseline'
                  ? { strategy: 'shared_baseline' }
                  : { strategy: 'portfolio', portfolio_method: old.benchmark_contract }),
              },
              ctx.meta
            )
          );
        });
      },
    },
    portfolioResume: {
      rest: 'POST /consumption/portfolio/runs/:run_id/resume',
      params: { run_id: 'string' },
      openapi: portfolioRuntimeSpec.operation('resume'),
      handler(ctx) {
        return portfolioAction(ctx, (p) => portfolioRuntime.launch(ctx, p.run_id));
      },
    },
    portfolioRunStatus: {
      rest: 'GET /consumption/portfolio/runs/:run_id',
      params: { run_id: 'string' },
      openapi: portfolioRuntimeSpec.operation('status'),
      handler(ctx) {
        return portfolioAction(ctx, () => portfolioRuntime.status(ctx));
      },
    },
    portfolioSeriesResult: {
      rest: 'GET /consumption/portfolio/runs/:run_id/series/:series_key',
      params: { run_id: 'string', series_key: 'string' },
      openapi: portfolioRuntimeSpec.operation('series'),
      handler(ctx) {
        return portfolioAction(ctx, () => portfolioRuntime.resultSeries(ctx));
      },
    },
    cancelEvaluationJob: {
      rest: 'POST /consumption/evaluation/jobs/:jobId/cancel',
      params: { jobId: { type: 'string', min: 1 } },
      openapi: cancelForecastOperation,
      handler(ctx) {
        return cancelForecastJob(ctx);
      },
    },
    runEvaluation: {
      rest: 'POST /consumption/evaluation/run',
      params: {
        datasets: { type: 'array', min: 1, max: 10 },
        configuration: { type: 'object' },
        payload_fit_confirmed: { type: 'boolean' },
      },
      openapi: evaluationOperation(true),
      handler(ctx) {
        if (!ctx.meta?.$gateway) {
          return runEvaluationAction(ctx, (payload) =>
            persistStateEvaluation(runEvaluation(payload), ctx.meta)
          );
        }
        return startForecastJob(ctx);
      },
    },
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
          '/api/forecast-sandbox/* paths plus the required /api/jobs polling paths — meant to be linked directly to a B2B lead, ' +
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
