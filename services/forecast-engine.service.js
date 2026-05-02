'use strict';

const { MoleculerClientError } = require('moleculer').Errors;
const {
  calculateLoadForecast,
  calculateResidualLoad,
  calculateForecastQuality,
  generateDayAheadSchedule,
  optimizeStorageDispatch,
} = require('../src/forecast-calculator');

const NS_SCHEDULES = 'schedules';
const OBIS_CONSUMPTION = '1-0:1.8.0';

function toIso(value) {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return null;
  return date.toISOString();
}

function toDateOnly(value) {
  return String(value || '').slice(0, 10);
}

function toNumber(value, fallback = 0) {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : fallback;
}

function parseRows(response) {
  if (!response) return [];
  if (Array.isArray(response.values)) return response.values;
  if (Array.isArray(response.data)) return response.data;
  if (Array.isArray(response.forecast)) return response.forecast;
  return [];
}

function createScheduleId(date) {
  const suffix = Math.random().toString(36).slice(2, 10);
  return `schedule_${toDateOnly(date)}_${suffix}`;
}

function toLoadKwSeries(values) {
  return (values || []).map((row) => ({
    ts: row.ts,
    value: toNumber(row.value, 0) * 4,
  }));
}

function detectSeasonCapacityFactor(installationType, date) {
  const month = new Date(`${toDateOnly(date)}T00:00:00.000Z`).getUTCMonth() + 1;
  if (installationType === 'wind') {
    if (month >= 11 || month <= 2) return 0.35;
    if (month >= 5 && month <= 8) return 0.15;
    return 0.25;
  }

  // solar and all fallback
  if (month >= 5 && month <= 8) return 0.25;
  if (month >= 11 || month <= 2) return 0.12;
  return 0.18;
}

function buildFallbackGenerationForecast(date, forecastDays, installationType) {
  const dayStart = new Date(`${toDateOnly(date)}T00:00:00.000Z`).getTime();
  const points = forecastDays * 96;
  const seasonFactor = detectSeasonCapacityFactor(installationType, date);
  const rows = [];

  for (let i = 0; i < points; i += 1) {
    const ts = new Date(dayStart + i * 15 * 60 * 1000).toISOString();
    const hour = new Date(ts).getUTCHours() + new Date(ts).getUTCMinutes() / 60;

    let normalized = 0;
    if (installationType === 'wind') {
      normalized = seasonFactor;
    } else {
      // simple solar bell curve (06:00–20:00)
      if (hour >= 6 && hour <= 20) {
        const x = (hour - 6) / 14;
        normalized = Math.sin(Math.PI * x) * seasonFactor;
      } else {
        normalized = 0;
      }
    }

    const estimatedKw = normalized * 100; // deterministic local fallback scale
    rows.push({ ts, value: toNumber(estimatedKw, 0), quality: 'forecast' });
  }

  return rows;
}

module.exports = {
  name: 'forecast-engine',
  timeout: 120000,
  dependencies: ['edm', 'slp'],

  settings: {
    defaultProfile: 'H0',
    defaultAnnualKwh: 3500,
    qualityThresholdMape: 20,
  },

  actions: {
    forecastLoad: {
      rest: 'POST /load',
      params: {
        meloId: { type: 'string', optional: true },
        profileId: { type: 'string', optional: true, default: 'H0' },
        date: { type: 'string' },
        annualConsumptionKwh: { type: 'number', optional: true, default: 3500, convert: true },
        temperatureCelsius: { type: 'number', optional: true, convert: true },
      },
      openapi: {
        summary: 'Generate load forecast for a day',
        tags: ['Forecast (Prognostik)'],
        description:
          'Generates a 96-point (15-min) load forecast based on SLP profiles with optional historical correction and temperature adjustment. KRITIS-compliant: no external dependencies.',
        requestBody: {
          required: true,
          content: {
            'application/json': {
              schema: {
                type: 'object',
                required: ['date'],
                properties: {
                  meloId: { type: 'string', example: 'DE0012345678901234567890123456789' },
                  profileId: { type: 'string', default: 'H0' },
                  date: { type: 'string', example: '2026-04-20' },
                  annualConsumptionKwh: { type: 'number', default: 3500 },
                  temperatureCelsius: { type: 'number', example: 12 },
                },
              },
              examples: {
                default: {
                  value: {
                    profileId: 'H0',
                    date: '2026-04-20',
                    annualConsumptionKwh: 3500,
                    temperatureCelsius: 12,
                  },
                },
              },
            },
          },
        },
      },
      async handler(ctx) {
        const {
          meloId,
          profileId = this.settings.defaultProfile,
          date,
          annualConsumptionKwh = this.settings.defaultAnnualKwh,
          temperatureCelsius,
        } = ctx.params;

        const slpResult = await ctx.call('slp.generateTimeseries', {
          profileId,
          date,
          annualConsumptionKwh,
        });

        const slpProfile = {
          values: Array.isArray(slpResult?.values) ? slpResult.values : [],
        };

        let historical = null;
        if (meloId) {
          const from = new Date(
            new Date(`${toDateOnly(date)}T00:00:00.000Z`).getTime() - 30 * 24 * 60 * 60 * 1000
          ).toISOString();
          const to = new Date(`${toDateOnly(date)}T00:00:00.000Z`).toISOString();

          const historicalResult = await ctx.call('edm.getTimeseries', {
            meloId,
            obis: OBIS_CONSUMPTION,
            from,
            to,
            resolution: '15min',
            format: 'json',
          });
          historical = parseRows(historicalResult);
        }

        const correctionEnabled = Array.isArray(historical) && historical.length > 0;

        const forecast = calculateLoadForecast(historical, slpProfile, {
          annualConsumptionKwh,
          profileId,
          date: toDateOnly(date),
          temperatureCelsius,
          correctionEnabled,
        });

        return { success: true, forecast };
      },
    },

    forecastGeneration: {
      rest: 'POST /generation',
      params: {
        gridOperatorMastrId: { type: 'string', optional: true },
        postleitzahl: { type: 'string', optional: true },
        installationType: {
          type: 'enum',
          values: ['solar', 'wind', 'all'],
          optional: true,
          default: 'solar',
        },
        date: { type: 'string' },
        forecastDays: {
          type: 'number',
          optional: true,
          default: 1,
          min: 1,
          max: 14,
          convert: true,
        },
      },
      openapi: {
        summary: 'Generate generation forecast (solar/wind)',
        tags: ['Forecast (Prognostik)'],
        description:
          'Wraps mastr_generation_forecast MCP tool with KRITIS-safe fallback. If MCP unavailable, uses installed capacity × typical capacity factor as estimate.',
        requestBody: {
          required: true,
          content: {
            'application/json': {
              schema: {
                type: 'object',
                required: ['date'],
                properties: {
                  gridOperatorMastrId: { type: 'string', example: 'SNB935578300972' },
                  postleitzahl: { type: 'string', example: '66989' },
                  installationType: {
                    type: 'string',
                    enum: ['solar', 'wind', 'all'],
                    default: 'solar',
                  },
                  date: { type: 'string', example: '2026-04-20' },
                  forecastDays: { type: 'number', default: 1 },
                },
              },
              examples: {
                default: {
                  value: {
                    postleitzahl: '66989',
                    installationType: 'solar',
                    date: '2026-04-20',
                    forecastDays: 1,
                  },
                },
              },
            },
          },
        },
      },
      async handler(ctx) {
        const {
          gridOperatorMastrId,
          postleitzahl,
          installationType = 'solar',
          date,
          forecastDays = 1,
        } = ctx.params;

        try {
          const mcpResult = await ctx.call(
            'forecast.generationForecast',
            {
              installationType,
              forecastDays,
              resolution: '15min',
              gridOperatorMastrId,
              postleitzahl,
              startDate: toDateOnly(date),
              format: 'json',
            },
            {
              meta: { cernionToken: ctx.meta.cernionToken },
            }
          );

          const rows = parseRows(mcpResult)
            .map((row) => ({
              ts: row.ts || row.timestamp,
              value: toNumber(row.value ?? row.generationMW ?? row.generationMWh ?? row.powerKw, 0),
              quality: 'forecast',
            }))
            .filter((row) => toIso(row.ts));

          if (rows.length > 0) {
            return {
              success: true,
              forecast: rows,
              source: 'mcp',
            };
          }
        } catch (_error) {
          // KRITIS fallback below
        }

        const rows = buildFallbackGenerationForecast(
          toDateOnly(date),
          forecastDays,
          installationType === 'all' ? 'solar' : installationType
        );

        return {
          success: true,
          forecast: rows,
          source: 'fallback',
        };
      },
    },

    forecastResidual: {
      rest: 'POST /residual',
      params: {
        loadForecast: { type: 'object', optional: true },
        generationForecast: { type: 'object', optional: true },
        meloId: { type: 'string', optional: true },
        profileId: { type: 'string', optional: true },
        annualConsumptionKwh: { type: 'number', optional: true, convert: true },
        postleitzahl: { type: 'string', optional: true },
        date: { type: 'string' },
      },
      openapi: {
        summary: 'Calculate residual load (consumption minus generation)',
        tags: ['Forecast (Prognostik)'],
        requestBody: {
          required: true,
          content: {
            'application/json': {
              schema: {
                type: 'object',
                required: ['date'],
                properties: {
                  loadForecast: { type: 'object', example: {} },
                  generationForecast: { type: 'object', example: {} },
                  meloId: { type: 'string', example: 'DE0012345678901234567890123456789' },
                  profileId: { type: 'string', example: 'H0' },
                  annualConsumptionKwh: { type: 'number', example: 3500 },
                  postleitzahl: { type: 'string', example: '66989' },
                  date: { type: 'string', example: '2026-04-20' },
                },
              },
              examples: {
                default: {
                  value: {
                    profileId: 'H0',
                    annualConsumptionKwh: 3500,
                    postleitzahl: '66989',
                    date: '2026-04-20',
                  },
                },
              },
            },
          },
        },
      },
      async handler(ctx) {
        const {
          loadForecast,
          generationForecast,
          meloId,
          profileId,
          annualConsumptionKwh,
          postleitzahl,
          date,
        } = ctx.params;

        let resolvedLoad = loadForecast;
        if (!resolvedLoad || !Array.isArray(resolvedLoad.values)) {
          resolvedLoad = (
            await ctx.call('forecast-engine.forecastLoad', {
              meloId,
              profileId: profileId || this.settings.defaultProfile,
              date,
              annualConsumptionKwh: annualConsumptionKwh || this.settings.defaultAnnualKwh,
            })
          ).forecast;
        }

        let resolvedGeneration = generationForecast;
        if (!resolvedGeneration || !Array.isArray(resolvedGeneration.forecast)) {
          resolvedGeneration = await ctx.call('forecast-engine.forecastGeneration', {
            postleitzahl,
            date,
            installationType: 'solar',
            forecastDays: 1,
          });
        }

        const loadKw = toLoadKwSeries(resolvedLoad.values || []);
        const generationKw = (resolvedGeneration.forecast || []).map((row) => ({
          ts: row.ts,
          value: toNumber(row.value, 0),
        }));

        const residual = calculateResidualLoad(loadKw, generationKw);

        return { success: true, residual };
      },
    },

    createSchedule: {
      rest: 'POST /schedule/day-ahead',
      params: {
        bilanzkreisId: { type: 'string', optional: true },
        meloId: { type: 'string', optional: true },
        profileId: { type: 'string', optional: true },
        annualConsumptionKwh: { type: 'number', optional: true, convert: true },
        postleitzahl: { type: 'string', optional: true },
        date: { type: 'string' },
        storageConfig: { type: 'object', optional: true },
        includeMarketPrices: { type: 'boolean', optional: true, default: false, convert: true },
      },
      openapi: {
        summary: 'Create Day-Ahead schedule with optional storage optimization',
        tags: ['Forecast (Prognostik)'],
        requestBody: {
          required: true,
          content: {
            'application/json': {
              schema: {
                type: 'object',
                required: ['date'],
                properties: {
                  bilanzkreisId: { type: 'string', example: 'bk_es_test' },
                  meloId: { type: 'string', example: 'DE0012345678901234567890123456789' },
                  profileId: { type: 'string', example: 'H0' },
                  annualConsumptionKwh: { type: 'number', example: 3500 },
                  postleitzahl: { type: 'string', example: '66989' },
                  date: { type: 'string', example: '2026-04-20' },
                  storageConfig: {
                    type: 'object',
                    example: {
                      capacityKwh: 10,
                      maxChargePowerKw: 5,
                      maxDischargePowerKw: 5,
                      efficiency: 0.92,
                      currentSocPercent: 50,
                    },
                  },
                  includeMarketPrices: { type: 'boolean', default: false },
                },
              },
              examples: {
                default: {
                  value: {
                    date: '2026-04-20',
                    profileId: 'H0',
                    annualConsumptionKwh: 3500,
                    postleitzahl: '66989',
                  },
                },
              },
            },
          },
        },
      },
      async handler(ctx) {
        const {
          bilanzkreisId,
          meloId,
          profileId,
          annualConsumptionKwh,
          postleitzahl,
          date,
          storageConfig,
          includeMarketPrices,
        } = ctx.params;

        const residualResult = await ctx.call('forecast-engine.forecastResidual', {
          meloId,
          profileId: profileId || this.settings.defaultProfile,
          annualConsumptionKwh: annualConsumptionKwh || this.settings.defaultAnnualKwh,
          postleitzahl,
          date,
        });

        let marketPrices = null;
        if (includeMarketPrices) {
          try {
            const pricesResult = await ctx.call(
              'entsoe.dayAheadPrices',
              {
                region: 'Germany',
                dateFrom: toDateOnly(date),
                dateTo: toDateOnly(date),
              },
              {
                meta: { cernionToken: ctx.meta.cernionToken },
              }
            );

            marketPrices =
              parseRows(pricesResult).length > 0
                ? parseRows(pricesResult)
                : Array.isArray(pricesResult?.prices)
                  ? pricesResult.prices
                  : null;
          } catch (_error) {
            marketPrices = null;
          }
        }

        const scheduleResult = generateDayAheadSchedule(
          residualResult.residual.intervals,
          marketPrices,
          storageConfig || null
        );

        const scheduleId = createScheduleId(date);
        const payload = {
          scheduleId,
          bilanzkreisId: bilanzkreisId || null,
          date: toDateOnly(date),
          schedule: scheduleResult.schedule,
          summary: scheduleResult.summary,
          createdAt: new Date().toISOString(),
        };

        await ctx.call('object-store.put', {
          namespace: NS_SCHEDULES,
          key: scheduleId,
          payload,
        });

        return {
          success: true,
          scheduleId,
          schedule: scheduleResult.schedule,
          summary: scheduleResult.summary,
        };
      },
    },

    getSchedule: {
      rest: 'GET /schedule/:scheduleId',
      params: {
        scheduleId: { type: 'string' },
      },
      openapi: {
        summary: 'Get stored day-ahead schedule',
        tags: ['Forecast (Prognostik)'],
        parameters: [
          {
            name: 'scheduleId',
            in: 'path',
            required: true,
            schema: { type: 'string', example: 'schedule_2026-04-20_ab12cd34' },
          },
        ],
      },
      async handler(ctx) {
        const result = await ctx.call('object-store.get', {
          namespace: NS_SCHEDULES,
          key: ctx.params.scheduleId,
        });

        return {
          success: true,
          scheduleId: ctx.params.scheduleId,
          payload: result?.payload || null,
        };
      },
    },

    evaluateQuality: {
      rest: 'POST /quality',
      params: {
        meloId: { type: 'string' },
        obis: { type: 'string', optional: true, default: OBIS_CONSUMPTION },
        from: { type: 'string' },
        to: { type: 'string' },
        profileId: { type: 'string', optional: true, default: 'H0' },
        annualConsumptionKwh: { type: 'number', optional: true, convert: true },
      },
      openapi: {
        summary: 'Evaluate forecast quality (RMSE/MAE/MAPE)',
        tags: ['Forecast (Prognostik)'],
        description:
          'Compares SLP-based forecast against actual EDM timeseries data. Returns quality metrics and rating.',
        requestBody: {
          required: true,
          content: {
            'application/json': {
              schema: {
                type: 'object',
                required: ['meloId', 'from', 'to'],
                properties: {
                  meloId: { type: 'string', example: 'DE0012345678901234567890123456789' },
                  obis: { type: 'string', default: OBIS_CONSUMPTION },
                  from: { type: 'string', example: '2026-04-13T00:00:00Z' },
                  to: { type: 'string', example: '2026-04-14T00:00:00Z' },
                  profileId: { type: 'string', default: 'H0' },
                  annualConsumptionKwh: { type: 'number', default: 3500 },
                },
              },
              examples: {
                default: {
                  value: {
                    meloId: 'DE0012345678901234567890123456789',
                    from: '2026-04-13T00:00:00Z',
                    to: '2026-04-14T00:00:00Z',
                    profileId: 'H0',
                    annualConsumptionKwh: 3500,
                  },
                },
              },
            },
          },
        },
      },
      async handler(ctx) {
        const {
          meloId,
          obis = OBIS_CONSUMPTION,
          from,
          to,
          profileId = this.settings.defaultProfile,
          annualConsumptionKwh = this.settings.defaultAnnualKwh,
        } = ctx.params;

        const fromIso = toIso(from);
        const toIsoValue = toIso(to);

        if (!fromIso || !toIsoValue || fromIso >= toIsoValue) {
          throw new MoleculerClientError('Invalid from/to range', 400, 'INVALID_PERIOD');
        }

        const actualResult = await ctx.call('edm.getTimeseries', {
          meloId,
          obis,
          from: fromIso,
          to: toIsoValue,
          resolution: '15min',
          format: 'json',
        });

        const actual = parseRows(actualResult);

        const forecastRows = [];
        const start = new Date(fromIso).getTime();
        const end = new Date(toIsoValue).getTime();

        for (let cursor = start; cursor < end; cursor += 24 * 60 * 60 * 1000) {
          const date = new Date(cursor).toISOString().slice(0, 10);
          const loadForecast = await ctx.call('forecast-engine.forecastLoad', {
            profileId,
            date,
            annualConsumptionKwh,
          });
          forecastRows.push(...(loadForecast.forecast.values || []));
        }

        const forecastFiltered = forecastRows.filter((row) => {
          const ts = toIso(row.ts);
          return ts && ts >= fromIso && ts < toIsoValue;
        });

        const quality = calculateForecastQuality(forecastFiltered, actual);

        return {
          success: true,
          quality,
        };
      },
    },

    storageDispatch: {
      rest: 'POST /storage-dispatch',
      params: {
        residualLoad: { type: 'array', optional: true, items: 'object' },
        meloId: { type: 'string', optional: true },
        profileId: { type: 'string', optional: true },
        annualConsumptionKwh: { type: 'number', optional: true, convert: true },
        postleitzahl: { type: 'string', optional: true },
        date: { type: 'string' },
        storageConfig: { type: 'object' },
        marketPrices: { type: 'array', optional: true, items: 'object' },
      },
      openapi: {
        summary: 'Optimize battery storage dispatch',
        tags: ['Forecast (Prognostik)'],
        requestBody: {
          required: true,
          content: {
            'application/json': {
              schema: {
                type: 'object',
                required: ['date', 'storageConfig'],
                properties: {
                  residualLoad: { type: 'array', items: { type: 'object' }, example: [] },
                  meloId: { type: 'string', example: 'DE0012345678901234567890123456789' },
                  profileId: { type: 'string', example: 'H0' },
                  annualConsumptionKwh: { type: 'number', example: 3500 },
                  postleitzahl: { type: 'string', example: '66989' },
                  date: { type: 'string', example: '2026-04-20' },
                  storageConfig: {
                    type: 'object',
                    example: {
                      capacityKwh: 10,
                      maxChargePowerKw: 5,
                      maxDischargePowerKw: 5,
                      efficiency: 0.92,
                      currentSocPercent: 50,
                    },
                  },
                  marketPrices: { type: 'array', items: { type: 'object' }, example: [] },
                },
              },
              examples: {
                default: {
                  value: {
                    date: '2026-04-20',
                    profileId: 'H0',
                    annualConsumptionKwh: 3500,
                    postleitzahl: '66989',
                    storageConfig: {
                      capacityKwh: 10,
                      maxChargePowerKw: 5,
                      maxDischargePowerKw: 5,
                      efficiency: 0.92,
                      currentSocPercent: 50,
                    },
                  },
                },
              },
            },
          },
        },
      },
      async handler(ctx) {
        const {
          residualLoad,
          meloId,
          profileId,
          annualConsumptionKwh,
          postleitzahl,
          date,
          storageConfig,
          marketPrices,
        } = ctx.params;

        let resolvedResidual = residualLoad;
        if (!Array.isArray(resolvedResidual) || resolvedResidual.length === 0) {
          const residualResult = await ctx.call('forecast-engine.forecastResidual', {
            meloId,
            profileId: profileId || this.settings.defaultProfile,
            annualConsumptionKwh: annualConsumptionKwh || this.settings.defaultAnnualKwh,
            postleitzahl,
            date,
          });
          resolvedResidual = residualResult.residual.intervals;
        }

        const dispatchPlan = optimizeStorageDispatch(
          resolvedResidual,
          storageConfig,
          marketPrices || null
        );

        return {
          success: true,
          dispatch: dispatchPlan.schedule,
          summary: dispatchPlan.summary,
        };
      },
    },

    listSchedules: {
      rest: 'GET /schedules',
      params: {
        bilanzkreisId: { type: 'string', optional: true },
        date: { type: 'string', optional: true },
      },
      openapi: {
        summary: 'List stored schedules',
        tags: ['Forecast (Prognostik)'],
        parameters: [
          {
            name: 'bilanzkreisId',
            in: 'query',
            required: false,
            schema: { type: 'string', example: 'bk_es_test' },
          },
          {
            name: 'date',
            in: 'query',
            required: false,
            schema: { type: 'string', example: '2026-04-20' },
          },
        ],
      },
      async handler(ctx) {
        const { bilanzkreisId, date } = ctx.params;
        const result = await ctx.call('object-store.list', {
          namespace: NS_SCHEDULES,
          limit: 1000,
        });

        const entries = Array.isArray(result?.data)
          ? result.data
          : Array.isArray(result)
            ? result
            : [];

        const filtered = entries.filter((entry) => {
          const payload = entry?.payload || {};
          if (bilanzkreisId && payload.bilanzkreisId !== bilanzkreisId) return false;
          if (date && payload.date !== toDateOnly(date)) return false;
          return true;
        });

        return {
          success: true,
          count: filtered.length,
          data: filtered,
        };
      },
    },
  },
};
