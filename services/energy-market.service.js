/**
 * Energy Market Data Service
 *
 * Prices, production, forecasts, installations
 * Maps to Cernion MCP energy market data category
 */

const CernionMCPClient = require('../src/mcp-client');
const { MoleculerClientError } = require('moleculer').Errors;
const { resolveMunicipalityProfile, gemeindenData } = require('../src/municipality-resolver');
const { resolveLocationFromText } = require('../src/location-resolution');
const { normalizeMarketPartner, extractCandidates } = require('../src/market-role-classifier');
const { extractFirstOfType } = require('../src/utils/energy-id-extractor');
const { callWithAutoPoll } = require('../src/async-job-poller');
const jobStore = require('../src/job-store');
const {
  applyFormat,
  convertToCSV,
  FORMAT_PARAM_SCHEMA,
  FORMAT_RESPONSE_CONTENT,
} = require('../src/format-response');

const SUPPORTED_INSTALLATION_TYPES = ['solar', 'wind', 'storage', 'biomass', 'hydro', 'combustion'];

// ── Portfolio Backtest helpers ─────────────────────────────────────────────────

const BACKTEST_ASSUMPTION_FULL_LOAD_HOURS = { biomass: 7500, hydro: 4200, combustion: 3500 };
const BACKTEST_WEATHER_TYPES = new Set(['solar', 'wind']);
const BACKTEST_MAX_ASSETS = 50;
const BACKTEST_MAX_DAYS = 365;
// Reference orientation yield per type (kWh/kW/year, Germany, standard conditions).
// Solar: south-facing 30° tilt, no shading. Wind onshore: typical hub height, open terrain.
// Used as plausibility comparator — actual yield depends on site orientation, shading, losses.
const BACKTEST_ORIENTATION_YIELD_KWH_KW = {
  solar: 950,
  wind: 1800,
  wind_onshore: 1800,
  wind_offshore: 3500,
};

const CO2_FORECAST_VALUE_FIELDS = [
  'co2_avg',
  'co2_g_standard',
  'co2_intensity_gco2eq_kwh',
  'gCO2eqPerKWh',
  'co2gPerKWh',
  'co2Intensity',
  'value',
  'co2_g_oekostrom',
];

function _co2FiniteNumber(value) {
  if (value === null || value === undefined || value === '') return null;
  const numeric = Number(value);
  return Number.isFinite(numeric) ? numeric : null;
}

function _co2PickForecastValue(point) {
  if (typeof point !== 'object' || point === null) {
    const value = _co2FiniteNumber(point);
    return value === null ? null : { value };
  }

  for (const field of CO2_FORECAST_VALUE_FIELDS) {
    const value = _co2FiniteNumber(point[field]);
    if (value !== null) return { value, sourceField: field };
  }
  return null;
}

function _co2BuildForecastPoint(point, index, baseDate, hasValidBaseDate) {
  const picked = _co2PickForecastValue(point);
  if (!picked) return null;
  const explicitTimestamp =
    typeof point === 'object' && point !== null ? point.timestamp || point.ts || point.date : null;
  const explicitDate = explicitTimestamp ? new Date(explicitTimestamp) : null;
  const hasExplicitDate = explicitDate && !isNaN(explicitDate.getTime());
  const timestamp = hasExplicitDate
    ? explicitDate.toISOString()
    : hasValidBaseDate
      ? new Date(baseDate.getTime() + index * 60 * 60 * 1000).toISOString()
      : null;
  return {
    timestamp,
    gCO2eqPerKWh: picked.value,
    ...(picked.sourceField ? { sourceField: picked.sourceField } : {}),
  };
}

function _co2UnavailableResult(result, mcpParams, warning) {
  return {
    ...result,
    success: false,
    status: 'unavailable',
    degraded: true,
    co2_intensity_gco2eq_kwh: null,
    average_today_gco2eq_kwh: null,
    warnings: Array.from(new Set([...(result?.warnings || []), warning])),
    data: {
      ...(result?.data || {}),
      location: result?.data?.location || result?.location || mcpParams.location,
      timestamp: result?.data?.timestamp || result?.timestamp || null,
      forecast: [],
    },
  };
}

function _co2NormalizeResult(result, mcpParams) {
  const forecastValues =
    result?.data?.forecast_next_24h_gco2eq_kwh || result?.forecast_next_24h_gco2eq_kwh || null;

  if (!Array.isArray(forecastValues)) return result;

  const baseTimestamp = result?.data?.timestamp || result?.timestamp;
  const baseDate = baseTimestamp ? new Date(baseTimestamp) : null;
  const hasValidBaseDate = baseDate && !isNaN(baseDate.getTime());
  const hasObjectForecastRows = forecastValues.some(
    (value) => typeof value === 'object' && value !== null
  );
  const numericForecastValues = forecastValues
    .map(_co2FiniteNumber)
    .filter((value) => value !== null);
  const currentValue = _co2FiniteNumber(result?.co2_intensity_gco2eq_kwh);
  const averageToday = _co2FiniteNumber(result?.average_today_gco2eq_kwh);
  const allNumericForecastZeros =
    numericForecastValues.length > 0 && numericForecastValues.every((value) => value === 0);

  const forecast = forecastValues
    .map((value, index) => _co2BuildForecastPoint(value, index, baseDate, hasValidBaseDate))
    .filter(Boolean);

  if (forecast.length === 0 && hasObjectForecastRows) {
    return _co2UnavailableResult(
      result,
      mcpParams,
      'co2_forecast_unavailable_no_numeric_source_field'
    );
  }

  if (
    allNumericForecastZeros &&
    currentValue === null &&
    (averageToday === null || averageToday === 0) &&
    forecastValues.length > 1
  ) {
    return _co2UnavailableResult(result, mcpParams, 'co2_forecast_unavailable_all_zero_guard');
  }

  const fallbackFields = new Set(
    forecast.map((point) => point.sourceField).filter((field) => field === 'co2_g_oekostrom')
  );
  const usedOekostromFallback = fallbackFields.size > 0;
  const forecastAverage =
    forecast.length > 0
      ? forecast.reduce((sum, point) => sum + point.gCO2eqPerKWh, 0) / forecast.length
      : null;

  return {
    ...result,
    ...(usedOekostromFallback ? { degraded: true, fallback_co2_field: 'co2_g_oekostrom' } : {}),
    warnings: usedOekostromFallback
      ? Array.from(
          new Set([
            ...(result?.warnings || []),
            'co2_standard_fields_null_using_oekostrom_fallback',
          ])
        )
      : result?.warnings,
    co2_intensity_gco2eq_kwh:
      currentValue !== null
        ? currentValue
        : forecast[0]
          ? forecast[0].gCO2eqPerKWh
          : result?.co2_intensity_gco2eq_kwh,
    average_today_gco2eq_kwh:
      averageToday !== null && !(usedOekostromFallback && averageToday === 0)
        ? averageToday
        : forecastAverage,
    data: {
      ...(result.data || {}),
      location: result?.data?.location || result?.location || mcpParams.location,
      timestamp: result?.data?.timestamp || result?.timestamp || null,
      forecast,
    },
  };
}

function _btHourTimestamp(timestamp) {
  const d = new Date(timestamp);
  if (!Number.isFinite(d.getTime())) return null;
  d.setUTCMinutes(0, 0, 0);
  return d.toISOString();
}

function _btNormalisePrices(raw) {
  // entsoe_day_ahead_prices returns { dataPoints: [{timestamp, priceEURperMWh}] }
  // cernion_energy_prices returns { prices: [{timestamp, priceEURMWh}] } or { data: { prices: [...] } }
  const arr = Array.isArray(raw?.dataPoints)
    ? raw.dataPoints
    : Array.isArray(raw)
      ? raw
      : Array.isArray(raw?.prices)
        ? raw.prices
        : Array.isArray(raw?.data?.prices)
          ? raw.data.prices
          : Array.isArray(raw?.data)
            ? raw.data
            : [];
  const byHour = new Map();
  for (const r of arr
    .map((r) => ({
      timestamp: r.timestamp ?? r.hour ?? r.ts,
      priceEurMwh: Number(
        r.priceEURperMWh ??
          r.price ??
          r.priceEURMWh ??
          r.priceEurMwh ??
          r.price_eur_mwh ??
          r.value ??
          NaN
      ),
    }))
    .filter((r) => r.timestamp && Number.isFinite(r.priceEurMwh))) {
    const hour = _btHourTimestamp(r.timestamp);
    if (!hour) continue;
    const bucket = byHour.get(hour) || { timestamp: hour, sum: 0, count: 0 };
    bucket.sum += r.priceEurMwh;
    bucket.count += 1;
    byHour.set(hour, bucket);
  }
  return Array.from(byHour.values())
    .sort((a, b) => a.timestamp.localeCompare(b.timestamp))
    .map((b) => ({ timestamp: b.timestamp, priceEurMwh: b.sum / b.count }));
}

function _btNormaliseForecast(result) {
  // mastr_generation_forecast returns top-level { forecasts: [...] }
  // Each item: { timestamp, generationMW, capacityFactor, weather: {...} }
  // generationMW is average power in MW over the hour → MWh = MW × 1h
  const arr = Array.isArray(result?.forecasts)
    ? result.forecasts
    : Array.isArray(result?.data?.forecasts)
      ? result.data.forecasts
      : Array.isArray(result?.data)
        ? result.data
        : [];
  return arr
    .map((r) => ({
      timestamp: _btHourTimestamp(r.timestamp ?? r.ts),
      generationMwh:
        r.generationMwh != null
          ? Number(r.generationMwh)
          : r.generationMW != null
            ? Number(r.generationMW) // MW × 1h = MWh for hourly resolution
            : r.generation_mwh != null
              ? Number(r.generation_mwh)
              : r.generationKwh != null
                ? Number(r.generationKwh) / 1000
                : Number(r.value ?? 0),
    }))
    .filter((r) => r.timestamp);
}

function _btBuildAssumptionSeries(asset, priceTimestamps) {
  const hoursPerYear = BACKTEST_ASSUMPTION_FULL_LOAD_HOURS[asset.type] || 0;
  const genPerHourMwh = ((asset.capacityKw || 0) * hoursPerYear) / 8760 / 1000;
  return priceTimestamps.map((ts) => ({ timestamp: ts, generationMwh: genPerHourMwh }));
}

function _btApplyCommissioningDate(series, commissioningDate) {
  if (!commissioningDate) return { series, warnings: ['commissioning_date_missing'] };
  const cutoffMs = new Date(commissioningDate).getTime();
  let zeroed = false;
  return {
    series: series.map((r) => {
      if (new Date(r.timestamp).getTime() < cutoffMs) {
        zeroed = true;
        return { ...r, generationMwh: 0 };
      }
      return r;
    }),
    warnings: zeroed ? ['pre_commissioning_period_zeroed'] : [],
  };
}

function _btMergeIntervals(genSeries, prices) {
  const genMap = new Map(genSeries.map((r) => [r.timestamp, r.generationMwh]));
  return prices.map((p) => {
    const gen = genMap.get(p.timestamp) ?? 0;
    return {
      timestamp: p.timestamp,
      generationMwh: gen,
      priceEurPerMwh: p.priceEurMwh,
      marketValueEur: gen * p.priceEurMwh,
    };
  });
}

function _btAssetKpis(intervals) {
  let genMwh = 0,
    valueEur = 0,
    curtailedEur = 0;
  let negHours = 0,
    genDuringNegMwh = 0,
    valueDuringNegEur = 0;
  for (const iv of intervals) {
    genMwh += iv.generationMwh;
    valueEur += iv.marketValueEur;
    curtailedEur += iv.priceEurPerMwh < 0 ? 0 : iv.marketValueEur;
    if (iv.priceEurPerMwh < 0) {
      negHours += 1;
      genDuringNegMwh += iv.generationMwh;
      valueDuringNegEur += iv.marketValueEur;
    }
  }
  return {
    generationMwh: Math.round(genMwh * 1000) / 1000,
    marketValueEur: Math.round(valueEur * 100) / 100,
    curtailedMarketValueEur: Math.round(curtailedEur * 100) / 100,
    negativePriceAvoidableLossEur: Math.round((curtailedEur - valueEur) * 100) / 100,
    negativePriceHours: negHours,
    generationDuringNegativePricesMwh: Math.round(genDuringNegMwh * 1000) / 1000,
    valueDuringNegativePricesEur: Math.round(valueDuringNegEur * 100) / 100,
  };
}

const _btBerlinMonthFmt = new Intl.DateTimeFormat('de-DE', {
  timeZone: 'Europe/Berlin',
  year: 'numeric',
  month: '2-digit',
});

function _btBerlinMonth(isoTimestamp) {
  const parts = _btBerlinMonthFmt.formatToParts(new Date(isoTimestamp));
  const y = parts.find((p) => p.type === 'year').value;
  const mo = parts.find((p) => p.type === 'month').value;
  return `${y}-${mo}`;
}

function _btMonthlyAggregation(intervals, dateFrom, dateTo) {
  const months = {};
  for (const iv of intervals) {
    const m = _btBerlinMonth(iv.timestamp);
    if (!months[m]) {
      months[m] = {
        month: m,
        generationMwh: 0,
        marketValueEur: 0,
        curtailedMarketValueEur: 0,
        negativePriceHours: 0,
        _priceSum: 0,
        _priceCount: 0,
      };
    }
    months[m].generationMwh += iv.generationMwh;
    months[m].marketValueEur += iv.marketValueEur;
    months[m].curtailedMarketValueEur += iv.priceEurPerMwh < 0 ? 0 : iv.marketValueEur;
    if (iv.priceEurPerMwh < 0) months[m].negativePriceHours += 1;
    months[m]._priceSum += iv.priceEurPerMwh;
    months[m]._priceCount += 1;
  }

  // Build scaffold of every calendar month from dateFrom to dateTo
  const scaffold = [];
  let cur = new Date(
    Date.UTC(parseInt(dateFrom.slice(0, 4)), parseInt(dateFrom.slice(5, 7)) - 1, 1)
  );
  const endYM = dateTo.slice(0, 7);
  while (true) {
    const ym = cur.toISOString().slice(0, 7);
    scaffold.push(ym);
    if (ym >= endYM) break;
    cur = new Date(Date.UTC(cur.getUTCFullYear(), cur.getUTCMonth() + 1, 1));
  }

  return scaffold.map((m) => {
    const d = months[m] || {
      month: m,
      generationMwh: 0,
      marketValueEur: 0,
      curtailedMarketValueEur: 0,
      negativePriceHours: 0,
      _priceSum: 0,
      _priceCount: 0,
    };
    const { _priceSum, _priceCount, ...rest } = d;
    return {
      ...rest,
      generationMwh: Math.round(rest.generationMwh * 1000) / 1000,
      marketValueEur: Math.round(rest.marketValueEur * 100) / 100,
      curtailedMarketValueEur: Math.round(rest.curtailedMarketValueEur * 100) / 100,
      averageSpotPriceEurPerMwh:
        _priceCount > 0 ? Math.round((_priceSum / _priceCount) * 100) / 100 : 0,
      weightedMarketValueEurPerMwh:
        rest.generationMwh > 0
          ? Math.round((rest.marketValueEur / rest.generationMwh) * 100) / 100
          : 0,
    };
  });
}

function _btDailyAggregation(intervals) {
  const days = {};
  for (const iv of intervals) {
    const day = iv.timestamp.slice(0, 10);
    if (!days[day]) {
      days[day] = {
        timestamp: `${day}T00:00:00Z`,
        generationMwh: 0,
        marketValueEur: 0,
        _priceSum: 0,
        _priceCount: 0,
      };
    }
    days[day].generationMwh += iv.generationMwh;
    days[day].marketValueEur += iv.marketValueEur;
    days[day]._priceSum += iv.priceEurPerMwh;
    days[day]._priceCount += 1;
  }
  return Object.values(days)
    .sort((a, b) => a.timestamp.localeCompare(b.timestamp))
    .map(({ _priceSum, _priceCount, ...d }) => ({
      ...d,
      generationMwh: Math.round(d.generationMwh * 1000) / 1000,
      priceEurPerMwh: _priceCount > 0 ? Math.round((_priceSum / _priceCount) * 100) / 100 : 0,
      marketValueEur: Math.round(d.marketValueEur * 100) / 100,
    }));
}

function computeInstallationStats(installations) {
  const count = installations.length;
  const totalCapacity = installations.reduce((sum, installation) => {
    return sum + Number(installation.bruttoleistung || installation.capacityKW || 0);
  }, 0);

  return {
    count,
    totalCapacity,
    avgCapacity: count > 0 ? totalCapacity / count : 0,
  };
}

module.exports = {
  name: 'energy-market',

  settings: {
    defaultTimeout: 30000,
  },

  actions: {
    /**
     * Day-ahead electricity prices
     * Tool: cernion_energy_prices
     */
    prices: {
      rest: 'POST /prices',
      params: {
        market: { type: 'enum', values: ['day-ahead', 'intraday', 'futures'] },
        region: { type: 'string', min: 1 },
        date: { type: 'string', optional: true },
        startDate: { type: 'string', optional: true },
        endDate: { type: 'string', optional: true },
        format: {
          type: 'enum',
          values: ['json', 'csv', 'xlsx', 'xls'],
          optional: true,
          default: 'json',
        },
      },
      openapi: {
        summary: 'Electricity market prices (day-ahead, intraday, futures)',
        tags: ['Energy Market Data'],
        // @OpenEnergyPlatform/ontology — OEO_00020069 market exchange, OEO_00010082 trade
        'x-oeo-class': [
          'https://openenergyplatform.org/ontology/oeo/OEO_00020069',
          'https://openenergyplatform.org/ontology/oeo/OEO_00010082',
        ],
        description: `Query electricity prices from ENTSO-E Transparency Platform and SMARD.de.

**All parameters are required.**

**Parameter Details:**
- **market**: Price type - "day-ahead" (next day auction), "intraday" (same-day trading), "futures" (forward contracts)
- **region**: Market area - "Deutschland", "Germany", "AT" (Austria), "FR" (France), "NL" (Netherlands), "BE" (Belgium), "CH" (Switzerland)
- **date**: Single date query (YYYY-MM-DD) - mutually exclusive with startDate/endDate
- **startDate**: Range start (YYYY-MM-DD) - use with endDate
- **endDate**: Range end (YYYY-MM-DD) - use with startDate

**Use Cases:**
- Dynamic tariff calculation
- Trading strategy analysis
- Price forecasting and arbitrage`,
        requestBody: {
          content: {
            'application/json': {
              schema: {
                type: 'object',
                required: ['market', 'region'],
                properties: {
                  market: {
                    type: 'string',
                    enum: ['day-ahead', 'intraday', 'futures'],
                    description: 'Market type',
                    example: 'day-ahead',
                  },
                  region: {
                    type: 'string',
                    description: 'Market region (country name or ISO code)',
                    example: 'Deutschland',
                  },
                  date: {
                    type: 'string',
                    format: 'date',
                    description: 'Single date (YYYY-MM-DD)',
                    example: '2026-02-07',
                  },
                  startDate: {
                    type: 'string',
                    format: 'date',
                    description: 'Range start date (YYYY-MM-DD)',
                    example: '2026-02-01',
                  },
                  endDate: {
                    type: 'string',
                    format: 'date',
                    description: 'Range end date (YYYY-MM-DD)',
                    example: '2026-02-07',
                  },
                  format: FORMAT_PARAM_SCHEMA,
                },
              },
              examples: {
                singleDay: {
                  summary: 'Day-ahead prices for one day',
                  value: {
                    market: 'day-ahead',
                    region: 'Deutschland',
                    date: '2026-02-07',
                  },
                },
                weekRange: {
                  summary: 'Day-ahead prices for date range',
                  value: {
                    market: 'day-ahead',
                    region: 'Deutschland',
                    startDate: '2026-02-01',
                    endDate: '2026-02-07',
                  },
                },
                intraday: {
                  summary: 'Intraday prices',
                  value: {
                    market: 'intraday',
                    region: 'Deutschland',
                    date: '2026-02-07',
                  },
                },
                csvExport: {
                  summary: 'Export prices as CSV',
                  value: {
                    market: 'day-ahead',
                    region: 'Deutschland',
                    startDate: '2026-02-01',
                    endDate: '2026-02-07',
                    format: 'csv',
                  },
                },
              },
            },
          },
        },
        responses: {
          200: {
            description: 'Price data retrieved successfully',
            content: {
              'application/json': {
                example: {
                  success: true,
                  data: {
                    market: 'day-ahead',
                    region: 'Deutschland',
                    prices: [
                      { timestamp: '2026-02-07T00:00:00Z', priceEURMWh: 45.23 },
                      { timestamp: '2026-02-07T01:00:00Z', priceEURMWh: 38.67 },
                    ],
                  },
                },
              },
              ...FORMAT_RESPONSE_CONTENT,
            },
          },
        },
      },
      async handler(ctx) {
        // Normalize ENTSO-E bidding zone codes to the human-readable region name the
        // cernion_energy_prices tool expects.  Gemini sometimes emits "DE-LU" or
        // "DE-AT-LU" instead of "Deutschland", which causes the MCP tool to route
        // to the wrong data source.
        const REGION_ALIASES = {
          'de-lu': 'Deutschland',
          'de-at-lu': 'Deutschland',
          de: 'Deutschland',
          germany: 'Deutschland',
          '10y1001a1001a63l': 'Deutschland',
          '10y1001a1001a82h': 'Deutschland',
        };
        const { format, ...restParams } = ctx.params;
        const regionRaw = restParams.region || '';
        const regionNorm = REGION_ALIASES[regionRaw.toLowerCase()] || regionRaw;
        const params = { ...restParams, region: regionNorm };

        try {
          const result = await CernionMCPClient.callWithNewSession(
            'cernion_energy_prices',
            params,
            ctx.meta.cernionToken
          );

          // Backend (v2+) always returns { success: false, error: { code, message, source } }
          // for all failure paths — no markdown table parsing needed.
          return applyFormat(ctx, result, format, 'prices', 'Prices');
        } catch (error) {
          this.logger.error('energy-market.prices failed:', error);
          return {
            success: false,
            error: {
              code: 'PRICE_DATA_UNAVAILABLE',
              message: error.message || 'Failed to fetch EPEX price data',
            },
          };
        }
      },
    },

    /**
     * Electricity generation data by source
     * Tool: cernion_energy_production
     */
    production: {
      rest: 'POST /production',
      params: {
        energySource: {
          type: 'enum',
          values: ['Solar', 'Wind', 'Biomass', 'Nuclear', 'Gas', 'Coal', 'Hydro', 'all'],
        },
        region: { type: 'string', min: 1 },
        startDate: { type: 'string' },
        endDate: { type: 'string' },
        resolution: {
          type: 'enum',
          values: ['quarterhour', 'hour', 'day', 'week', 'month', 'year'],
          optional: true,
        },
        format: {
          type: 'enum',
          values: ['json', 'csv', 'xlsx', 'xls'],
          optional: true,
          default: 'json',
        },
      },
      openapi: {
        summary: 'Electricity generation data by energy source',
        tags: ['Energy Market Data'],
        // @OpenEnergyPlatform/ontology — OEO_00000139 electrical energy, OEO_00000031 power plant
        'x-oeo-class': [
          'https://openenergyplatform.org/ontology/oeo/OEO_00000139',
          'https://openenergyplatform.org/ontology/oeo/OEO_00000031',
        ],
        description: `Query generation data from SMARD.de and ENTSO-E Transparency Platform.

**All parameters are required except resolution.**

**Parameter Details:**
- **energySource**: Energy source type - "Solar", "Wind", "Biomass", "Nuclear", "Gas", "Coal", "Hydro", "all" (aggregated)
- **region**: Region name - "Deutschland", "Bayern", "Baden-Württemberg", "Nordrhein-Westfalen", etc.
- **startDate**: Start date (YYYY-MM-DD)
- **endDate**: End date (YYYY-MM-DD)
- **resolution**: Time granularity - "quarterhour" (15min), "hour", "day", "week", "month", "year" (default: "hour")

**Use Cases:**
- Renewable energy analysis
- Generation forecasting
- Grid planning and balancing`,
        requestBody: {
          content: {
            'application/json': {
              schema: {
                type: 'object',
                required: ['energySource', 'region', 'startDate', 'endDate'],
                properties: {
                  energySource: {
                    type: 'string',
                    enum: ['Solar', 'Wind', 'Biomass', 'Nuclear', 'Gas', 'Coal', 'Hydro', 'all'],
                    description: 'Energy source type',
                    example: 'Solar',
                  },
                  region: {
                    type: 'string',
                    description: 'Region name (country or state)',
                    example: 'Deutschland',
                  },
                  startDate: {
                    type: 'string',
                    format: 'date',
                    description: 'Start date (YYYY-MM-DD)',
                    example: '2026-02-01',
                  },
                  endDate: {
                    type: 'string',
                    format: 'date',
                    description: 'End date (YYYY-MM-DD)',
                    example: '2026-02-07',
                  },
                  resolution: {
                    type: 'string',
                    enum: ['quarterhour', 'hour', 'day', 'week', 'month', 'year'],
                    description: 'Time resolution (default: hour)',
                    default: 'hour',
                  },
                  format: FORMAT_PARAM_SCHEMA,
                },
              },
              examples: {
                solarWeek: {
                  summary: 'Solar production for one week',
                  value: {
                    energySource: 'Solar',
                    region: 'Deutschland',
                    startDate: '2026-02-01',
                    endDate: '2026-02-07',
                    resolution: 'hour',
                  },
                },
                windDaily: {
                  summary: 'Wind production aggregated by day',
                  value: {
                    energySource: 'Wind',
                    region: 'Bayern',
                    startDate: '2026-01-01',
                    endDate: '2026-01-31',
                    resolution: 'day',
                  },
                },
                allSources: {
                  summary: 'All sources combined',
                  value: {
                    energySource: 'all',
                    region: 'Deutschland',
                    startDate: '2026-02-07',
                    endDate: '2026-02-07',
                  },
                },
                csvExport: {
                  summary: 'Export production time-series as CSV',
                  value: {
                    energySource: 'Solar',
                    region: 'Deutschland',
                    startDate: '2026-02-01',
                    endDate: '2026-02-07',
                    format: 'csv',
                  },
                },
              },
            },
          },
        },
        responses: {
          200: {
            description: 'Production data retrieved successfully',
            content: {
              'application/json': {
                example: {
                  success: true,
                  data: {
                    energySource: 'Solar',
                    region: 'Deutschland',
                    timeSeries: [{ timestamp: '2026-02-07T12:00:00Z', productionMW: 12543.5 }],
                  },
                },
              },
              ...FORMAT_RESPONSE_CONTENT,
            },
          },
        },
      },
      async handler(ctx) {
        const { format, ...mcpParams } = ctx.params;
        const result = await CernionMCPClient.callWithNewSession(
          'cernion_energy_production',
          mcpParams,
          ctx.meta.cernionToken
        );
        return applyFormat(ctx, result, format, 'production', 'Production');
      },
    },

    /**
     * Regional CO₂ intensity forecasts
     * Tool: cernion_co2_intensity
     */
    co2Intensity: {
      rest: 'POST /co2-intensity',
      params: {
        location: { type: 'string', min: 1 },
        timestamp: { type: 'string', optional: true },
        forecast: { type: 'boolean', optional: true, default: false },
        format: {
          type: 'enum',
          values: ['json', 'csv', 'xlsx', 'xls'],
          optional: true,
          default: 'json',
        },
      },
      openapi: {
        summary: 'Regional CO₂ intensity forecasts (GrünstromIndex)',
        tags: ['Energy Market Data'],
        // @OpenEnergyPlatform/ontology — OEO_00260007 CO2 emission, OEO_00010411 forecast
        'x-oeo-class': [
          'https://openenergyplatform.org/ontology/oeo/OEO_00260007',
          'https://openenergyplatform.org/ontology/oeo/OEO_00010411',
        ],
        description: `Query CO2 intensity for a specific location in Germany from GrünstromIndex.

**'location' is required** — provide a German city name or 5-digit postal code.

**Parameter Details:**
- **location**: German city name or postal code (required, e.g. a city name or 5-digit postal code)
- **timestamp**: Specific timestamp (ISO 8601 or natural language like "now", "tomorrow 14:00")
- **forecast**: Get 36-hour forecast instead of current value (default: false)
- **format**: Output format — "json" (default), "csv", "xlsx"/"xls". CSV includes \`# Location\`, \`# Current CO2 Intensity\`, \`# Average Today\` header comments followed by the hourly forecast rows.

**Use Cases:**
- CO₂-optimized dynamic tariffs
- Smart EV charging (charge when grid is greenest)
- Load shifting for industrial consumers
- Green energy certificates
- Power BI / Excel import with \`format=csv\`

**Reliability note:** When GrünstromIndex returns nullable standard CO₂ fields, CET uses populated
\`co2_g_oekostrom\` values as an explicitly marked degraded fallback. If no numeric CO₂ source field
is available, the response is \`success:false\`/\`status:"unavailable"\` with warnings instead of a
fabricated all-zero forecast.

**Data Source:** GrünstromIndex provides regional green energy forecasts with 36-hour horizon, factoring in renewable generation, grid mix, and transmission constraints.`,
        requestBody: {
          content: {
            'application/json': {
              schema: {
                type: 'object',
                required: ['location'],
                properties: {
                  location: {
                    type: 'string',
                    description: 'German city name or postal code',
                    example: 'Heidelberg',
                  },
                  timestamp: {
                    type: 'string',
                    description: 'Timestamp (ISO 8601 or natural language)',
                    example: '2026-02-07T14:00:00Z',
                  },
                  forecast: {
                    type: 'boolean',
                    description: 'Get 36-hour forecast',
                    default: false,
                  },
                  format: FORMAT_PARAM_SCHEMA,
                },
              },
              examples: {
                currentByCity: {
                  summary: 'Current CO₂ intensity by city',
                  value: {
                    location: 'Heidelberg',
                  },
                },
                currentByPostal: {
                  summary: 'Current CO₂ intensity by postal code',
                  value: {
                    location: '69115',
                  },
                },
                forecast36h: {
                  summary: '36-hour forecast',
                  value: {
                    location: 'München',
                    forecast: true,
                  },
                },
                forecastCsv: {
                  summary: '36-hour forecast as CSV (for Power BI / Excel)',
                  value: {
                    location: 'Ludwigshafen',
                    forecast: true,
                    format: 'csv',
                  },
                },
                specificTime: {
                  summary: 'CO₂ intensity at specific time',
                  value: {
                    location: 'Berlin',
                    timestamp: '2026-02-07T14:00:00Z',
                  },
                },
              },
            },
          },
        },
        responses: {
          200: {
            description: 'CO2 intensity data retrieved',
            content: {
              'application/json': {
                example: {
                  success: true,
                  degraded: false,
                  co2_intensity_gco2eq_kwh: 380,
                  average_today_gco2eq_kwh: 364.5,
                  data: {
                    location: 'Heidelberg',
                    timestamp: '2026-02-07T14:00:00Z',
                    forecast: [
                      { timestamp: '2026-02-07T14:00:00Z', gCO2eqPerKWh: 380 },
                      { timestamp: '2026-02-07T15:00:00Z', gCO2eqPerKWh: 275 },
                    ],
                  },
                },
              },
              ...FORMAT_RESPONSE_CONTENT,
            },
          },
        },
      },
      async handler(ctx) {
        // Strip `format` before forwarding to MCP tool — it has no such parameter.
        const { format, ...mcpParams } = ctx.params;

        let result = await CernionMCPClient.callWithNewSession(
          'cernion_co2_intensity',
          mcpParams,
          ctx.meta.cernionToken
        );

        // Normalise forecast array. MCP historically returns raw numbers under
        // forecast_next_24h_gco2eq_kwh; newer/raw GSI-shaped fixtures may contain
        // rows with nullable co2_avg/co2_g_standard and populated co2_g_oekostrom.
        // Never turn unavailable/null CO2 source fields into fabricated zero forecasts.
        result = _co2NormalizeResult(result, mcpParams);

        // CSV export: forecast rows + scalar metadata as # comment lines
        if (format === 'csv') {
          const rows = result?.data?.forecast || [];
          const currentValue = result?.co2_intensity_gco2eq_kwh ?? '';
          const avgToday = result?.average_today_gco2eq_kwh ?? '';
          const location = result?.data?.location || mcpParams.location || '';
          ctx.meta.$responseHeaders = {
            'Content-Type': 'text/csv; charset=utf-8',
            'Content-Disposition': `attachment; filename="co2-intensity-${Date.now()}.csv"`,
          };
          const dataSource = result?.data_source || '';
          const generated =
            result?.timestamp || result?.data?.timestamp || new Date().toISOString();
          const metadata = [
            `# CO2 Intensity Export`,
            `# Location: ${location}`,
            `# Current CO2 Intensity (gCO2eq/kWh): ${currentValue}`,
            `# Average Today (gCO2eq/kWh): ${avgToday}`,
            ...(dataSource ? [`# Source: ${dataSource}`] : []),
            `# Generated: ${generated}`,
          ].join('\n');
          return `${metadata}\n${convertToCSV(rows)}`;
        }

        // XLSX export: forecast rows as worksheet
        if (format === 'xlsx' || format === 'xls') {
          const rows = result?.data?.forecast || [];
          return applyFormat(ctx, result, format, 'co2-intensity', 'CO2 Intensity', rows);
        }

        return result;
      },
    },

    /**
     * Search energy installations in MaStR
     * Tool: cernion_installations
     */
    installations: {
      timeout: 15 * 60 * 1000, // 15 minutes - paginated query with callWithAutoPoll for each page
      rest: 'POST /installations',
      params: {
        installationType: {
          type: 'enum',
          values: [...SUPPORTED_INSTALLATION_TYPES, 'all'],
          description:
            'Required. Type of installation — solar (PV), wind, storage (batteries/BESS), biomass, hydro, combustion (CHP / gas turbines), or all (aggregated query across all supported types).',
        },
        location: {
          type: 'string',
          optional: true,
          min: 1,
          trim: true,
          description:
            'Unique municipality name, five-digit postal code, or PLZ + place (e.g. 69256 Mauer). All known postal codes are searched for a municipality. Ambiguous names and district/region text require explicit postleitzahl (400).',
        },
        postleitzahl: {
          type: 'string',
          optional: true,
          pattern: /^\d{5}$/,
          description:
            'Exact five-digit German postal code, including leading zeros; overrides location (e.g. 01067).',
        },
        postleitzahlNot: { type: 'string', optional: true, min: 2, max: 6 },
        limit: { type: 'any', optional: true },
        offset: { type: 'number', optional: true, min: 0, default: 0, convert: true },
        minCapacityKW: { type: 'number', optional: true, min: 0, convert: true },
        maxCapacityKW: { type: 'number', optional: true, min: 0, convert: true },
        commissioningYear: { type: 'number', optional: true, min: 1900, max: 2100, convert: true },
        gridOperatorId: { type: 'string', optional: true, min: 1 },
        gridOperatorMastrId: { type: 'string', optional: true, min: 1 },
        gridOperatorName: {
          type: 'string',
          optional: true,
          min: 1,
          trim: true,
          description:
            'Full or partial operator name (e.g. Netze BW). Must resolve uniquely; otherwise 400. Prefer gridOperatorMastrId or gridOperatorBdewCode. Explicit IDs take precedence.',
        },
        gridOperatorBdewCode: { type: 'string', optional: true, min: 1 },
        operationalStatus: {
          type: 'string',
          optional: true,
          default: '35',
          pattern: /^(all|(?:31|35|37|38)(?:,(?:31|35|37|38))*)$/,
          description:
            'MaStR status code: 31 planned, 35 active, 37 temporarily closed, 38 permanently closed. Comma-separated codes or all.',
        },
        netzbetreiberPruefungStatus: { type: 'string', optional: true },
        includeNapData: { type: 'boolean', optional: true, default: true },
        updatedAfter: {
          type: 'string',
          optional: true,
          description:
            'ISO date string (e.g. "2026-03-24"). Returns only installations where lastUpdatedAt (MaStR DatumLetzteMeldung, stored in MongoDB as lastUpdatedAt) is after this date.',
        },
        format: {
          type: 'enum',
          values: ['json', 'csv', 'xlsx', 'xls'],
          optional: true,
          default: 'json',
        },
      },
      openapi: {
        summary: 'Search energy installations in German registry (MaStR)',
        tags: ['Energy Market Data'],
        // @OpenEnergyPlatform/ontology — OEO_00000031 power plant, OEO_00000034 solar power unit
        'x-oeo-class': [
          'https://openenergyplatform.org/ontology/oeo/OEO_00000031',
          'https://openenergyplatform.org/ontology/oeo/OEO_00000034',
        ],
        description: `Search Marktstammdatenregister (MaStR) for energy installations.

**'installationType' is required.**

**Parameter Details:**
- **installationType**: Installation type - "solar" (PV), "wind", "storage" (batteries), "biomass", "hydro", "combustion" (CHP, gas turbines), or "all" (aggregated across all supported types)
- **location**: Unique municipality name, five-digit PLZ, or "PLZ Ort". Searches all known PLZ for a municipality. Explicit postleitzahl takes precedence. Ambiguous names and "Ort, Landkreis" require postleitzahl (HTTP 400).
- **operationalStatus**: Operational status filter - Default: "35" (only active/in operation). Values: "31" (planned), "35" (in operation), "37" (temporarily decommissioned), "38" (permanently decommissioned), "all" (all statuses), or comma-separated list (e.g., "35,37")
- **limit**: Max results (optional)
- **minCapacityKW**: Minimum installed capacity in kW (e.g., 5 for small installations, 100 for commercial)
- **maxCapacityKW**: Maximum installed capacity in kW
- **commissioningYear**: Filter by year of grid connection (1900-2100)
- **gridOperatorId**: MaStR Netzbetreiber-ID (SNB/GNB...), comma-separated (deprecated)
- **gridOperatorMastrId**: MaStR Netzbetreiber-ID (SNB/GNB...), preferred
- **gridOperatorName**: Full or partial operator name resolved via marketPartners; must identify one operator. Unresolved/ambiguous names return HTTP 400; explicit IDs take precedence.
- **gridOperatorBdewCode**: BDEW code (resolved to MaStR Netzbetreiber)
- **includeNapData**: Include NAP (Netzanschlusspunkt) data per installation (default: \`true\`). Uses a single \`$in\` query — no N+1; typically < 50 ms overhead for 1,000 results. ~48 % of older installations have no MeLo on record — \`napData\` is \`undefined\` for those. Set to \`false\` to skip enrichment for faster responses on large result sets.

**NAP data fields (when present):**
| Field | Description |
|---|---|
| \`napMastrNummer\` | NAP identifier (SAN...) |
| \`messlokation\` | MeLo-ID (DE000...) for billing and metering systems |
| \`spannungsebene\` | Voltage level code from MaStR |
| \`spannungsebeneLabel\` | Human-readable: Niederspannung (LV) / Mittelspannung (MV) / Hochspannung (HV) / Höchstspannung (EHV) |
| \`nettoengpassleistung\` | Net transfer capacity at NAP in kW |
| \`netzMastrNummer\` | Grid MaStR-ID (SNE...) |
| \`netzbetreiberMastrNummer\` | Grid operator MaStR-ID (SNB...) |

**New fields on all installation objects:** \`latitude\`, \`longitude\` (GPS coordinates), \`netzbetreiberpruefungStatus\` (grid operator verification status)

| \`netzbetreiberpruefungStatus\` code | Meaning |
|---|---|
| \`2954\` | Geprüft ✅ — confirmed by grid operator |
| \`2955\` | In Prüfung ⏳ — review in progress |
| \`3075\` | Nicht vorgesehen — no verification applicable |
| \`null\` | Not available for this record (older data) |

**Wind turbines:** additionally \`typenbezeichnung\` (turbine model, e.g. "E-115"), \`hersteller\` (manufacturer, e.g. "Enercon")
**Storage systems:** additionally \`batterietechnologie\`, \`acDcKoppelung\`, \`wechselrichterleistung\`, \`einsatzort\`

**Use Cases:**
- Portfolio analysis and benchmarking
- Site selection for new installations
- Market research and competitor analysis
- Grid planning (DSO/TSO)
- Redispatch 2.0 eligible installations
- Billing/metering system setup (MeLo lookup via napData)

**MaStR Database:** Official registry of all power plants, solar systems, wind turbines, and storage facilities in Germany maintained by Bundesnetzagentur.`,
        requestBody: {
          content: {
            'application/json': {
              schema: {
                type: 'object',
                required: ['installationType'],
                properties: {
                  installationType: {
                    type: 'string',
                    enum: [...SUPPORTED_INSTALLATION_TYPES, 'all'],
                    description: 'Type of energy installation',
                    example: 'solar',
                  },
                  postleitzahl: {
                    type: 'string',
                    pattern: '^\\d{5}$',
                    description:
                      'Exact five-digit German postal code; overrides location. Keep leading zeros.',
                    example: '01067',
                  },
                  operationalStatus: {
                    type: 'string',
                    pattern: '^(all|(?:31|35|37|38)(?:,(?:31|35|37|38))*)$',
                    description:
                      '31 planned, 35 active, 37 temporarily closed, 38 permanently closed; comma-separated or all.',
                    default: '35',
                    example: '35,37',
                  },
                  location: {
                    type: 'string',
                    description:
                      'Unique municipality name, five-digit PLZ, or PLZ + place. Searches all municipality postal codes. District/region or ambiguous text requires explicit postleitzahl (400).',
                    example: 'Heidelberg',
                  },
                  limit: {
                    oneOf: [
                      { type: 'integer', minimum: 1 },
                      { type: 'string', enum: ['all'] },
                    ],
                    description:
                      'Maximum total number of results across types and resolved postal codes. Omit or use `"all"` for all results; internal MCP pagination is automatic. Set a numeric limit to bound response size.',
                    example: 1000,
                  },
                  offset: {
                    type: 'integer',
                    description:
                      'Number of records to skip per installation type and postal code. For stable client pagination, use one type and an explicit postleitzahl. Example: offset=1000, limit=1000.',
                    minimum: 0,
                    default: 0,
                    example: 0,
                  },
                  minCapacityKW: {
                    type: 'number',
                    description: 'Minimum capacity in kW',
                    minimum: 0,
                    example: 5,
                  },
                  maxCapacityKW: {
                    type: 'number',
                    description: 'Maximum capacity in kW',
                    minimum: 0,
                    example: 100,
                  },
                  commissioningYear: {
                    type: 'integer',
                    description: 'Year of grid connection',
                    minimum: 1900,
                    maximum: 2100,
                    example: 2023,
                  },
                  gridOperatorId: {
                    type: 'string',
                    description: 'MaStR Netzbetreiber-ID (SNB/GNB...), comma-separated',
                    example: 'SNB935578300972',
                  },
                  gridOperatorMastrId: {
                    type: 'string',
                    description: 'MaStR Netzbetreiber-ID (SNB/GNB...), preferred',
                    example: 'SNB935578300972',
                  },
                  gridOperatorName: {
                    type: 'string',
                    description:
                      'Full or partial operator name; must resolve uniquely (otherwise 400). Prefer explicit gridOperatorMastrId or gridOperatorBdewCode, which override the name.',
                    example: 'Netze BW',
                  },
                  gridOperatorBdewCode: {
                    type: 'string',
                    description: 'BDEW code (resolved to MaStR Netzbetreiber)',
                    example: '9900992720003',
                  },
                  netzbetreiberPruefungStatus: {
                    type: 'string',
                    description:
                      'Filter by grid operator verification status code(s), comma-separated. Values: **2954**=Geprüft ✅, **2955**=In Prüfung ⏳, **3075**=Nicht vorgesehen. Example: `"2955"` or `"2954,2955"`.',
                    example: '2955',
                  },
                  includeNapData: {
                    type: 'boolean',
                    description:
                      'Include NAP data per installation (MeLo-ID, voltage level, grid operator MaStR-IDs). Default: true. Set to false to skip enrichment for faster responses on large result sets.',
                    default: true,
                    example: true,
                  },
                  format: FORMAT_PARAM_SCHEMA,
                },
              },
              examples: {
                rooftopSolar: {
                  summary: 'Rooftop solar in Heidelberg',
                  value: {
                    installationType: 'solar',
                    location: 'Heidelberg',
                    minCapacityKW: 5,
                    maxCapacityKW: 30,
                    limit: 20,
                  },
                },
                commercialSolar: {
                  summary: 'Commercial solar installations',
                  value: {
                    installationType: 'solar',
                    minCapacityKW: 100,
                    commissioningYear: 2023,
                    limit: 50,
                  },
                },
                gridOperatorFilter: {
                  summary: 'Filter by grid operator (BDEW)',
                  value: {
                    installationType: 'solar',
                    gridOperatorBdewCode: '9900992720003',
                    limit: 20,
                  },
                },
                windTurbines: {
                  summary: 'Wind turbines in region',
                  value: {
                    installationType: 'wind',
                    minCapacityKW: 1000,
                    limit: 30,
                  },
                },
                batteryStorage: {
                  summary: 'Battery storage systems',
                  value: {
                    installationType: 'storage',
                    limit: 15,
                  },
                },
                allTypes: {
                  summary: 'Aggregate all supported installation types',
                  value: {
                    installationType: 'all',
                    gridOperatorBdewCode: '9900992720003',
                    limit: 100,
                  },
                },
                withNapData: {
                  summary: 'Solar with NAP/MeLo data (default on)',
                  value: {
                    installationType: 'solar',
                    gridOperatorBdewCode: '9900992720003',
                    limit: 10,
                    includeNapData: true,
                  },
                },
                withoutNapData: {
                  summary: 'Wind turbines — skip NAP enrichment for speed',
                  value: {
                    installationType: 'wind',
                    minCapacityKW: 1000,
                    limit: 50,
                    includeNapData: false,
                  },
                },
                csvExport: {
                  summary: 'Export installations as CSV',
                  value: {
                    installationType: 'solar',
                    gridOperatorBdewCode: '9900992720003',
                    limit: 100,
                    format: 'csv',
                  },
                },
              },
            },
          },
        },
        responses: {
          400: {
            description:
              'Operator or location could not be resolved uniquely, or MaStR rejected an operator-name search. Pass an explicit gridOperatorMastrId/gridOperatorBdewCode or five-digit postleitzahl.',
          },
          502: { description: 'MaStR backend failed to execute the installations search.' },
          200: {
            description: 'Installation data retrieved',
            content: {
              'application/json': {
                example: {
                  success: true,
                  data: {
                    results: [
                      {
                        mastrNumber: 'SEE988149395570',
                        name: 'PV 2 Weiler',
                        installationType: 'solar',
                        capacityKW: 6.15,
                        commissioningDate: '2021-03-10',
                        location: 'Weiler',
                        postalCode: '67063',
                        latitude: 49.4744,
                        longitude: 8.4349,
                        netzbetreiberpruefungStatus: 2954,
                        napData: {
                          napMastrNummer: 'SAN914634531048',
                          messlokation: 'DE0003976706990000000000000073131',
                          spannungsebene: 354,
                          spannungsebeneLabel: 'Niederspannung (LV)',
                          nettoengpassleistung: 6.15,
                          netzMastrNummer: 'SNE985057905075',
                          netzbetreiberMastrNummer: 'SNB935578300972',
                        },
                      },
                      {
                        mastrNumber: 'SEE900000000002',
                        name: 'PV Altanlage 2003',
                        installationType: 'solar',
                        capacityKW: 3.8,
                        commissioningDate: '2003-06-01',
                        location: 'Heidelberg',
                        postalCode: '69115',
                        latitude: 49.4093,
                        longitude: 8.6942,
                        netzbetreiberpruefungStatus: null,
                        napData: undefined,
                      },
                    ],
                    count: 2,
                    limit: 20,
                  },
                },
              },
              ...FORMAT_RESPONSE_CONTENT,
            },
          },
        },
      },
      async handler(ctx) {
        const MCP_PAGE_SIZE = 10000;
        // Keep malformed replies and polling exceptions inside this tool's
        // actionable error contract, rather than leaking a generic HTTP 500.
        const callTool = async (toolName, toolParams, pollOptions = {}) => {
          try {
            const response = await callWithAutoPoll(
              toolName,
              toolParams,
              pollOptions,
              ctx.meta.cernionToken
            );
            return response && typeof response === 'object' && !Array.isArray(response)
              ? response
              : { success: false };
          } catch (_error) {
            return { success: false };
          }
        };
        const { format, ...params } = ctx.params;
        const requestedTypes =
          params.installationType === 'all'
            ? SUPPORTED_INSTALLATION_TYPES
            : [params.installationType];
        const operationalStatus = params.operationalStatus || '35';
        const nbpStatus = params.netzbetreiberPruefungStatus;
        const updatedAfter = params.updatedAfter ? new Date(params.updatedAfter) : null;
        const startOffset = params.offset || 0;

        // Parse limit: accept number, numeric string, or 'all' / undefined (= fetch everything)
        const rawLimit = params.limit;
        const isUnlimited = rawLimit === undefined || rawLimit === null || rawLimit === 'all';
        // Bug fix: removed '|| 1000' fallback — invalid limit strings must not silently cap at
        // 1000. The Moleculer validator rejects non-numeric values; undefined/null/"all" → Infinity.
        const requestedLimit = isUnlimited ? Infinity : Math.max(1, Number(rawLimit));

        // Bug fix: normalise BDEW code — strip all whitespace so "9900 599000003" becomes
        // "9900599000003". Mixed-format codes from callers fail exact matching in the MCP tool.
        const rawBdewCode = params.gridOperatorBdewCode;
        const normalizedBdewCode = rawBdewCode
          ? String(rawBdewCode).replace(/\s+/g, '').trim() || undefined
          : undefined;

        // The local installations tool accepts operator IDs, not fuzzy names. Never
        // drop a requested operator filter when its identity cannot be resolved.
        let resolvedGridOperatorId = params.gridOperatorMastrId || params.gridOperatorId || null;
        let resolvedBdewCode = normalizedBdewCode || null;
        const operatorError = () =>
          new MoleculerClientError(
            `gridOperatorName "${params.gridOperatorName}" could not be resolved uniquely. ` +
              'Use a more specific name, gridOperatorMastrId (SNB/GNB...), or a 13-digit gridOperatorBdewCode.',
            400,
            'GRID_OPERATOR_UNRESOLVED'
          );

        if (!resolvedGridOperatorId && !resolvedBdewCode && params.gridOperatorName) {
          const mpResult = await callTool(
            'cernion_market_partners',
            { query: params.gridOperatorName.trim(), limit: 20 },
            { maxWaitTime: 2 * 60 * 1000, pollInterval: 2000 }
          );
          if (mpResult?.success === false || mpResult?.isError || mpResult?.data?.isError) {
            throw operatorError();
          }
          // MCP JSON content is returned flat; older responses use a data wrapper.
          const mpData = mpResult?.data?.data || mpResult?.data || mpResult;
          const candidates = extractCandidates(mpResult);
          const matches = candidates.length ? candidates : mpData?.marketPartners || [];
          const identities = new Map();
          for (const match of Array.isArray(matches) ? matches : []) {
            const partner = normalizeMarketPartner(match);
            if (!partner) continue;
            const rawId =
              partner.mastrId ||
              match.mastrNetzbetreiberId ||
              match.mastr_id ||
              match.mastrIds?.snb ||
              match.mastrIds?.gnb;
            const extractedId = extractFirstOfType(String(rawId || ''), 'mastrId');
            const id = /^(SNB|GNB)/i.test(extractedId || '') ? extractedId.toUpperCase() : null;
            const bdew = String(partner.bdew || '').replace(/\s+/g, '');
            if (id) identities.set(id, { id, bdew: null });
            else if (extractFirstOfType(bdew, 'bdewCode') === bdew) {
              identities.set(bdew, { id: null, bdew });
            }
          }
          if (identities.size !== 1 || matches.length >= 20) throw operatorError();
          const identity = identities.values().next().value;
          resolvedGridOperatorId = identity.id;
          resolvedBdewCode = identity.bdew;
        }

        let postalCodes = [params.postleitzahl];
        if (!params.postleitzahl && params.location) {
          const embeddedPlz = resolveLocationFromText(params.location).postalCode;
          if (embeddedPlz) {
            postalCodes = [embeddedPlz];
          } else {
            const place = params.location.trim();
            const exactMatches = gemeindenData.filter(
              (entry) => entry.name.toLowerCase() === place.toLowerCase()
            );
            const profile = resolveMunicipalityProfile({ municipality: place });
            // The existing directory has no district disambiguation. Refuse fuzzy
            // or ambiguous matches instead of choosing its largest-population default.
            if (
              !profile.found ||
              profile.name.toLowerCase() !== place.toLowerCase() ||
              exactMatches.length > 1 ||
              !profile.postalCodes.length
            ) {
              throw new MoleculerClientError(
                `Location "${params.location}" could not be resolved uniquely. ` +
                  'Pass postleitzahl as exactly five digits (e.g. "69256") or location as ' +
                  'a unique municipality name or "69256 Mauer". District/region text ' +
                  '("Ort, Landkreis") requires an explicit postleitzahl.',
                400,
                'LOCATION_UNRESOLVED'
              );
            }
            postalCodes = profile.postalCodes;
          }
        }

        let allInstallations = [];
        let firstResult = null;
        let dataExhausted = true;
        let resultTruncated = false;

        const scopes = requestedTypes.flatMap((installationType) =>
          postalCodes.map((postleitzahl) => ({ installationType, postleitzahl }))
        );
        for (const { installationType, postleitzahl } of scopes) {
          const baseToolParams = {
            type: installationType,
            postleitzahl,
            minCapacity: params.minCapacityKW,
            maxCapacity: params.maxCapacityKW,
            commissioningYear: params.commissioningYear,
            gridOperatorMastrId: resolvedGridOperatorId || undefined,
            gridOperatorBdewCode: resolvedBdewCode || undefined,
            postleitzahlNot: params.postleitzahlNot,
            includeNapData: params.includeNapData,
            netzbetreiberPruefungStatus: nbpStatus,
            status:
              operationalStatus && operationalStatus !== 'all' ? operationalStatus : undefined,
            format: 'detailed',
          };

          let currentOffset = startOffset;

          while (true) {
            const remainingLimit = isUnlimited
              ? MCP_PAGE_SIZE
              : requestedLimit - allInstallations.length;
            const pageLimit = isUnlimited ? MCP_PAGE_SIZE : Math.min(remainingLimit, MCP_PAGE_SIZE);

            if (pageLimit <= 0) {
              resultTruncated = true;
              dataExhausted = false;
              break;
            }

            const pageResult = await callTool('cernion_installations_local', {
              ...baseToolParams,
              limit: pageLimit,
              offset: currentOffset,
            });

            if (pageResult?.success === false || pageResult?.isError || pageResult?.data?.isError) {
              if (params.gridOperatorName) {
                throw new MoleculerClientError(
                  'MaStR rejected the installations search for the resolved gridOperatorName. ' +
                    'Check the filters or pass gridOperatorMastrId (SNB/GNB...) or a 13-digit gridOperatorBdewCode.',
                  400,
                  'GRID_OPERATOR_SEARCH_FAILED'
                );
              }
              throw new MoleculerClientError(
                'MaStR installations search failed upstream. Retry or verify the supplied filters.',
                502,
                'INSTALLATIONS_UPSTREAM_FAILED'
              );
            }

            if (!firstResult) firstResult = pageResult;

            if (pageResult && !pageResult.data && Array.isArray(pageResult.installations)) {
              pageResult.data = {
                installations: pageResult.installations,
                stats: pageResult.stats || {},
              };
            }

            const pageRows = pageResult?.data?.installations || [];
            allInstallations.push(...pageRows);
            currentOffset += pageRows.length;

            if (pageRows.length < pageLimit) {
              break;
            }

            if (!isUnlimited && allInstallations.length >= requestedLimit) {
              resultTruncated = true;
              dataExhausted = false;
              break;
            }
          }

          if (!isUnlimited && allInstallations.length >= requestedLimit) {
            break;
          }
        }

        // Merge all pages into a single result object
        const result = firstResult || { success: true, data: { installations: [], stats: {} } };
        if (result?.data) {
          result.data.installations = allInstallations;
        }

        // Post-filter by operational status (default: only active status 35).
        // einheitBetriebsstatus is stored as a number in MongoDB; normalise both
        // sides to string so the comparison works regardless of the stored type.
        if (operationalStatus && operationalStatus !== 'all' && result?.data?.installations) {
          const allowedStatuses = operationalStatus.split(',').map((s) => s.trim());
          result.data.installations = result.data.installations.filter((inst) =>
            allowedStatuses.includes(String(inst.einheitBetriebsstatus))
          );
        }

        // Post-filter by netzbetreiberPruefungStatus (fallback if MCP did not apply it)
        if (nbpStatus && result?.data?.installations) {
          const allowedNbp = String(nbpStatus)
            .split(',')
            .map((s) => Number(s.trim()))
            .filter((n) => !isNaN(n));
          if (allowedNbp.length > 0) {
            result.data.installations = result.data.installations.filter((inst) =>
              allowedNbp.includes(inst.netzbetreiberpruefungStatus)
            );
          }
        }

        // Defensive post-filter by grid operator MaStR ID.
        // Rationale: If upstream filtering is ignored or partially applied,
        // this enforces consistency using installation/NAP operator fields.
        if (resolvedGridOperatorId && result?.data?.installations) {
          const targetId = String(resolvedGridOperatorId).trim();

          const extractOperatorIds = (inst) => {
            const values = [
              inst?.netzbetreiberMastrNummer,
              inst?.NetzbetreiberMastrNummer,
              inst?.anschlussnetzbetreiberMastrNummer,
              inst?.AnschlussnetzbetreiberMastrNummer,
              inst?.napData?.netzbetreiberMastrNummer,
            ];

            return values
              .map((v) => (v == null ? null : String(v).trim()))
              .filter((v) => Boolean(v));
          };

          result.data.installations = result.data.installations.filter((inst) => {
            const ids = extractOperatorIds(inst);
            if (ids.length === 0) {
              // Keep records without operator IDs as fallback for older MaStR records.
              return true;
            }
            return ids.includes(targetId);
          });
        }

        // Post-filter by updatedAfter — checks lastUpdatedAt (MongoDB field for MaStR DatumLetzteMeldung)
        if (updatedAfter && !isNaN(updatedAfter.getTime()) && result?.data?.installations) {
          result.data.installations = result.data.installations.filter((inst) => {
            const dateStr = inst.lastUpdatedAt || inst.DatumLetzteMeldung;
            if (!dateStr) return false;
            return new Date(dateStr) > updatedAfter;
          });
        }

        const rows = result?.data?.installations || [];

        if (result?.data) {
          result.data.stats = computeInstallationStats(rows);
          result.data.requestedTypes = requestedTypes;
        }

        // Pagination metadata: hasMore=true only when we stopped at the requested limit
        // (not when data was exhausted or unlimited fetch completed)
        if (result?.data) {
          result.data.pagination = {
            offset: startOffset,
            limit: isUnlimited ? 'all' : requestedLimit,
            count: rows.length,
            hasMore: !isUnlimited && (!dataExhausted || resultTruncated),
          };
        }

        // For CSV / XLSX export flatten nested napData into top-level scalar fields.
        // Without this, convertToCSV would JSON-encode napData as a blob string,
        // producing "JSON as result" in downloaded files and in the Live CSV endpoint.
        let exportRows = rows;
        if (format === 'csv' || format === 'xlsx' || format === 'xls') {
          exportRows = rows.map(({ napData, ...rest }) => {
            if (!napData || typeof napData !== 'object') return rest;
            return {
              ...rest,
              napMastrNummer: napData.napMastrNummer || '',
              messlokation: napData.messlokation || '',
              spannungsebene: napData.spannungsebeneLabel || String(napData.spannungsebene || ''),
              netzMastrNummer: napData.netzMastrNummer || '',
              netzbetreiberMastrNummer: napData.netzbetreiberMastrNummer || '',
            };
          });
        }

        return applyFormat(ctx, result, format, 'installations', 'Installations', exportRows);
      },
    },

    /**
     * Historical portfolio market value backtest
     * POST /api/energy-market/portfolio-backtest
     */
    portfolioBacktest: {
      rest: 'POST /portfolio-backtest',
      params: {
        assets: { type: 'array', min: 1, max: BACKTEST_MAX_ASSETS, items: { type: 'object' } },
        dateFrom: { type: 'string', optional: true, pattern: /^\d{4}-\d{2}-\d{2}$/ },
        dateTo: { type: 'string', optional: true, pattern: /^\d{4}-\d{2}-\d{2}$/ },
        resolution: {
          type: 'enum',
          values: ['hourly', 'daily'],
          optional: true,
          default: 'hourly',
        },
        market: { type: 'string', optional: true, default: 'day-ahead' },
        region: { type: 'string', optional: true, default: 'Deutschland' },
        includeTimeseries: { type: 'boolean', optional: true, default: false },
      },
      openapi: {
        summary: 'Historical portfolio market value backtest (Day-Ahead)',
        tags: ['Energy Market Data'],
        description: `Computes the historical spot market value for a portfolio of energy installations.

Combines generation timeseries (inline upload, MaStR-based historical reconstruction, or technology assumption) with Day-Ahead prices over a selectable period (default: last 365 complete days).

**Data quality priority per asset:**
1. \`uploaded_timeseries\` — inline \`timeseries\` array in request
2. \`mastr_historical_reconstruction\` — solar/wind with \`mastrNumber\`, weather-based historical model
3. \`assumption\` — biomass (7 500 h/a), hydro (4 200 h/a), combustion (3 500 h/a): flat profile
4. \`missing_profile\` — storage and unknown types: generation = 0, warning emitted

**Negative price handling:** \`marketValueEur\` reflects physical generation including negative intervals; \`curtailedMarketValueEur\` shows the value under ideal curtailment; \`negativePriceAvoidableLossEur\` is the difference.

**Limits:** max 50 assets per request, max 365 days, region \`Deutschland\` only in v1.`,
        requestBody: {
          content: {
            'application/json': {
              schema: {
                type: 'object',
                required: ['assets'],
                properties: {
                  assets: {
                    type: 'array',
                    maxItems: 50,
                    description: 'Portfolio of energy installations',
                    items: {
                      type: 'object',
                      properties: {
                        mastrNumber: {
                          type: 'string',
                          description: 'MaStR unit ID (SEE…=solar, SWE…=wind)',
                        },
                        type: {
                          type: 'string',
                          enum: [
                            'solar',
                            'wind',
                            'biomass',
                            'hydro',
                            'combustion',
                            'storage',
                            'other',
                          ],
                          description: 'Technology type',
                        },
                        capacityKw: { type: 'number', description: 'Installed capacity in kW' },
                        postleitzahl: {
                          type: 'string',
                          description: 'Postal code (used as fallback location)',
                        },
                        commissioningDate: {
                          type: 'string',
                          format: 'date',
                          description: 'Grid connection date — intervals before this are zeroed',
                        },
                        timeseries: {
                          type: 'array',
                          description: 'Optional inline generation timeseries (highest priority)',
                          items: {
                            type: 'object',
                            properties: {
                              timestamp: { type: 'string' },
                              generationMwh: { type: 'number' },
                            },
                          },
                        },
                      },
                    },
                  },
                  dateFrom: {
                    type: 'string',
                    format: 'date',
                    description: 'Start date (YYYY-MM-DD). Default: today − 365 days',
                    example: '2025-07-01',
                  },
                  dateTo: {
                    type: 'string',
                    format: 'date',
                    description: 'End date inclusive (YYYY-MM-DD). Default: yesterday',
                    example: '2026-06-30',
                  },
                  resolution: {
                    type: 'string',
                    enum: ['hourly', 'daily'],
                    default: 'hourly',
                    description: 'Response resolution',
                  },
                  market: { type: 'string', default: 'day-ahead', description: 'Market type' },
                  region: {
                    type: 'string',
                    default: 'Deutschland',
                    description: 'Market region (only "Deutschland" supported in v1)',
                  },
                  includeTimeseries: {
                    type: 'boolean',
                    default: false,
                    description: 'Include full hourly timeseries in response',
                  },
                },
              },
              examples: {
                minimal: {
                  summary: 'Single solar asset, default 365-day period',
                  value: {
                    assets: [
                      {
                        mastrNumber: 'SEE123456789012',
                        type: 'solar',
                        capacityKw: 742.5,
                        postleitzahl: '69115',
                        commissioningDate: '2020-06-01',
                      },
                    ],
                  },
                },
                mixedPortfolio: {
                  summary: 'Mixed portfolio with inline biomass timeseries',
                  value: {
                    assets: [
                      {
                        mastrNumber: 'SEE123456789012',
                        type: 'solar',
                        capacityKw: 500,
                        commissioningDate: '2021-01-01',
                      },
                      {
                        type: 'biomass',
                        capacityKw: 500,
                        commissioningDate: '2019-03-15',
                        timeseries: [{ timestamp: '2025-07-01T00:00:00Z', generationMwh: 0.42 }],
                      },
                    ],
                    dateFrom: '2025-07-01',
                    dateTo: '2026-06-30',
                    includeTimeseries: false,
                  },
                },
              },
            },
          },
        },
        responses: {
          202: {
            description:
              'Job accepted — poll `/api/jobs/{jobId}/status`, fetch result from `/api/jobs/{jobId}/result`',
            content: {
              'application/json': {
                example: {
                  success: true,
                  jobId: 'a3f8b2c1-0000-0000-0000-000000000001',
                  status: 'queued',
                  message: 'Job started. Poll /api/jobs/:jobId/status for progress.',
                  statusUrl: '/api/jobs/a3f8b2c1-0000-0000-0000-000000000001/status',
                  resultUrl: '/api/jobs/a3f8b2c1-0000-0000-0000-000000000001/result',
                },
              },
            },
          },
          200: {
            description:
              'Backtest result (from `/api/jobs/{jobId}/result` once status is `completed`)',
            content: {
              'application/json': {
                example: {
                  success: true,
                  period: {
                    dateFrom: '2025-07-01',
                    dateTo: '2026-06-30',
                    days: 365,
                    resolution: 'hourly',
                  },
                  market: {
                    type: 'day-ahead',
                    region: 'Deutschland',
                    currency: 'EUR',
                    priceUnit: 'EUR/MWh',
                  },
                  portfolio: {
                    assetCount: 1,
                    totalCapacityKw: 742.5,
                    generationMwh: 721.4,
                    marketValueEur: 54321.1,
                    weightedMarketValueEurPerMwh: 75.3,
                    averageSpotPriceEurPerMwh: 82.1,
                    captureRate: 0.917,
                    negativePriceHours: 24,
                    generationDuringNegativePricesMwh: 18.2,
                    valueDuringNegativePricesEur: -145.6,
                    curtailedMarketValueEur: 54466.7,
                    negativePriceAvoidableLossEur: 145.6,
                  },
                  monthly: [
                    {
                      month: '2025-07',
                      generationMwh: 82.1,
                      marketValueEur: 6234.5,
                      curtailedMarketValueEur: 6280.0,
                      averageSpotPriceEurPerMwh: 78.4,
                      weightedMarketValueEurPerMwh: 75.9,
                      negativePriceHours: 3,
                    },
                  ],
                  assets: [
                    {
                      mastrNumber: 'SEE123456789012',
                      type: 'solar',
                      capacityKw: 742.5,
                      dataQuality: 'mastr_historical_reconstruction',
                      generationMwh: 721.4,
                      marketValueEur: 54321.1,
                      weightedMarketValueEurPerMwh: 75.3,
                      curtailedMarketValueEur: 54466.7,
                      negativePriceAvoidableLossEur: 145.6,
                      negativePriceHours: 24,
                      warnings: [],
                    },
                  ],
                  methodology: {
                    timezone: 'UTC',
                    priceAlignment: 'hourly',
                    fallbackPolicy: 'assumption_if_no_forecast_or_uploaded_profile',
                    captureRateDefinition:
                      'weightedMarketValueEurPerMwh / timeWeightedAverageSpotPrice',
                  },
                },
              },
            },
          },
        },
      },
      async handler(ctx) {
        const { assets, market, region, includeTimeseries } = ctx.params;

        // Region guard (v1: Deutschland only) — fast synchronous rejection, no job needed
        if (region && region !== 'Deutschland') {
          return {
            success: false,
            error: {
              code: 'UNSUPPORTED_REGION',
              message: `Region "${region}" is not supported. Only "Deutschland" is available in v1.`,
            },
          };
        }

        // Date defaults: last 365 complete days
        const todayMs = Date.now();
        const yesterday = new Date(todayMs - 24 * 3600 * 1000);
        const defaultDateTo = yesterday.toISOString().slice(0, 10);
        const defaultDateFrom = new Date(todayMs - 365 * 24 * 3600 * 1000)
          .toISOString()
          .slice(0, 10);
        const dateFrom = ctx.params.dateFrom || defaultDateFrom;
        const dateTo = ctx.params.dateTo || defaultDateTo;

        const fromMs = new Date(dateFrom).getTime();
        const toMs = new Date(dateTo).getTime();
        if (!Number.isFinite(fromMs) || !Number.isFinite(toMs) || fromMs > toMs) {
          return {
            success: false,
            error: {
              code: 'INVALID_DATE_RANGE',
              message: `Invalid date range: ${dateFrom} to ${dateTo}.`,
            },
          };
        }
        const daysDiff = Math.round((toMs - fromMs) / (24 * 3600 * 1000)) + 1;

        if (daysDiff > BACKTEST_MAX_DAYS) {
          return {
            success: false,
            error: {
              code: 'DATE_RANGE_TOO_LARGE',
              message: `Maximum date range is ${BACKTEST_MAX_DAYS} days. Requested: ${daysDiff} days.`,
            },
          };
        }

        // Long-running computation runs as a background job when called from the REST gateway.
        // Internal Moleculer callers (no ctx.meta.$gateway) get the synchronous result directly.
        return jobStore.startJob(
          ctx,
          { service: 'energy-market', action: 'portfolioBacktest' },
          async (jobId) => {
            const todayStr = new Date().toISOString().slice(0, 10);

            // 1. Fetch Day-Ahead prices for the full period.
            // entsoe_day_ahead_prices returns exactly one German calendar day per call
            // regardless of dateTo, so we iterate day-by-day in parallel batches of 30.
            let prices = [];
            let priceFetchError = null;
            try {
              const priceDates = [];
              let curDay = new Date(dateFrom + 'T00:00:00Z');
              const endDay = new Date(dateTo + 'T00:00:00Z');
              while (curDay <= endDay) {
                priceDates.push(curDay.toISOString().slice(0, 10));
                curDay = new Date(curDay.getTime() + 24 * 3600 * 1000);
              }
              const PRICE_BATCH = 30;
              if (jobId)
                jobStore.appendLog(
                  jobId,
                  'prices',
                  5,
                  `Fetching Day-Ahead prices for ${priceDates.length} days (${Math.ceil(priceDates.length / PRICE_BATCH)} batches, cache-first)`
                );
              this.logger.info(
                `portfolioBacktest: fetching prices for ${priceDates.length} days in ${Math.ceil(priceDates.length / PRICE_BATCH)} batches`
              );

              // Returns normalized hourly prices for one calendar day.
              // Past days are served from the object-store cache (EPEX Spot prices are
              // immutable once the day-ahead auction closes). Cache misses and write
              // failures are swallowed so a degraded object-store never blocks the response.
              const fetchDayPrices = async (d) => {
                const isPast = d < todayStr;
                if (isPast) {
                  try {
                    const cached = await ctx.call('object-store.get', {
                      namespace: 'epex_spot_prices',
                      key: d,
                    });
                    if (
                      Array.isArray(cached?.payload?.prices) &&
                      cached.payload.prices.length > 0
                    ) {
                      return cached.payload.prices;
                    }
                  } catch (_) {
                    /* cache miss — fall through to MCP fetch */
                  }
                }
                const raw = await CernionMCPClient.callWithNewSession('entsoe_day_ahead_prices', {
                  region: 'Germany',
                  dateFrom: d,
                  dateTo: d,
                  includeStatistics: false,
                  format: 'json',
                });
                const normalized = _btNormalisePrices(raw);
                if (isPast && normalized.length > 0) {
                  ctx
                    .call('object-store.put', {
                      namespace: 'epex_spot_prices',
                      key: d,
                      payload: { prices: normalized },
                    })
                    .catch((e) =>
                      this.logger.warn(`[epex-cache] write failed for ${d}: ${e.message}`)
                    );
                }
                return normalized;
              };

              const allRaw = [];
              const missingPriceDates = [];
              const priceFetchFailures = {};
              for (let i = 0; i < priceDates.length; i += PRICE_BATCH) {
                const chunk = priceDates.slice(i, i + PRICE_BATCH);
                const results = await Promise.allSettled(chunk.map(fetchDayPrices));
                for (let j = 0; j < results.length; j++) {
                  const r = results[j];
                  const priceDate = chunk[j];
                  if (r.status === 'fulfilled' && Array.isArray(r.value) && r.value.length > 0) {
                    allRaw.push(...r.value);
                    continue;
                  }
                  missingPriceDates.push(priceDate);
                  if (r.status === 'rejected') {
                    priceFetchFailures[priceDate] =
                      r.reason?.message || String(r.reason || 'price fetch failed');
                  }
                }
              }
              if (missingPriceDates.length > 0) {
                return {
                  success: false,
                  error: {
                    code: 'PRICE_DATA_UNAVAILABLE',
                    message: `Day-Ahead price data is incomplete for ${dateFrom}–${dateTo}. Missing usable hourly prices for ${missingPriceDates.length} day(s).`,
                    missingPriceDates,
                    priceCoverage: {
                      policy: 'fail_on_missing_price_day',
                      requestedDays: priceDates.length,
                      coveredDays: priceDates.length - missingPriceDates.length,
                      missingDays: missingPriceDates.length,
                      failures: priceFetchFailures,
                    },
                    positiveFollowUp:
                      'Complete hourly Day-Ahead price coverage for all requested dates enables portfolio, monthly, asset, negative-price, and curtailed-value KPIs for the declared period.',
                  },
                };
              }
              // Deduplicate by timestamp (adjacent days share a UTC midnight boundary)
              const seen = new Set();
              prices = allRaw.filter((p) => {
                if (seen.has(p.timestamp)) return false;
                seen.add(p.timestamp);
                return true;
              });
            } catch (err) {
              priceFetchError = err.message;
              this.logger.warn(`portfolioBacktest: price fetch failed: ${err.message}`);
            }

            if (prices.length === 0) {
              return {
                success: false,
                error: {
                  code: 'PRICE_DATA_UNAVAILABLE',
                  message: `No Day-Ahead price data available for ${dateFrom}–${dateTo}.${priceFetchError ? ` Detail: ${priceFetchError}` : ''}`,
                },
              };
            }

            if (jobId)
              jobStore.appendLog(
                jobId,
                'prices',
                30,
                `Prices ready: ${prices.length} hourly slots`
              );
            const priceTimestamps = prices.map((p) => p.timestamp);
            const avgSpotPrice =
              prices.length > 0 ? prices.reduce((s, p) => s + p.priceEurMwh, 0) / prices.length : 0;

            // 2. Process each asset
            if (jobId)
              jobStore.appendLog(jobId, 'assets', 35, `Processing ${assets.length} asset(s)`);
            const assetResults = [];
            for (let i = 0; i < assets.length; i++) {
              const asset = assets[i];
              const assetType = (asset.type || 'other').toLowerCase();
              const mastrId = asset.mastrNumber || asset.installationMastrNummer;
              let genSeries = [];
              let dataQuality;
              const warnings = [];
              let genCacheHits = 0;
              let genBatchCount = 0;

              // Priority 1: inline timeseries
              if (Array.isArray(asset.timeseries) && asset.timeseries.length > 0) {
                const uploadedByHour = new Map();
                for (const r of asset.timeseries) {
                  const timestamp = _btHourTimestamp(r.timestamp);
                  if (!timestamp) continue;
                  uploadedByHour.set(
                    timestamp,
                    (uploadedByHour.get(timestamp) || 0) + Number(r.generationMwh ?? r.value ?? 0)
                  );
                }
                genSeries = Array.from(uploadedByHour.entries()).map(
                  ([timestamp, generationMwh]) => ({
                    timestamp,
                    generationMwh,
                  })
                );
                dataQuality = 'uploaded_timeseries';
              }
              // Priority 2: solar/wind with MaStR ID → historical weather model
              // mastr_generation_forecast does not support endDate; fetch in 14-day batches.
              // Fully-past batches (last day < today) are cached in the object store since
              // historical generation profiles do not change after the fact.
              else if (BACKTEST_WEATHER_TYPES.has(assetType) && mastrId) {
                try {
                  const BATCH_DAYS = 14;
                  const allForecasts = [];
                  let batchStart = new Date(dateFrom);
                  const endMs = new Date(dateTo).getTime();

                  while (batchStart.getTime() <= endMs) {
                    const batchStartStr = batchStart.toISOString().slice(0, 10);
                    const batchLastDayStr = new Date(
                      batchStart.getTime() + (BATCH_DAYS - 1) * 24 * 3600 * 1000
                    )
                      .toISOString()
                      .slice(0, 10);
                    const batchIsPast = batchLastDayStr < todayStr;
                    const genCacheKey = `${mastrId}:${batchStartStr}`;
                    genBatchCount++;

                    let batchForecasts = null;
                    if (batchIsPast) {
                      try {
                        const cached = await ctx.call('object-store.get', {
                          namespace: 'mastr_gen_cache',
                          key: genCacheKey,
                        });
                        if (
                          Array.isArray(cached?.payload?.forecasts) &&
                          cached.payload.forecasts.length > 0
                        ) {
                          batchForecasts = cached.payload.forecasts;
                          genCacheHits++;
                        }
                      } catch (_) {
                        /* cache miss — fall through to MCP fetch */
                      }
                    }

                    if (!batchForecasts) {
                      const batchResult = await CernionMCPClient.callWithNewSession(
                        'mastr_generation_forecast',
                        {
                          installationMastrNummer: mastrId,
                          startDate: batchStartStr,
                          forecastDays: BATCH_DAYS,
                          resolution: 'hourly',
                        },
                        ctx.meta.cernionToken
                      );
                      if (batchResult?.data?.isError) {
                        throw new Error(
                          batchResult?.data?.content?.[0]?.text || 'mastr_generation_forecast error'
                        );
                      }
                      batchForecasts = _btNormaliseForecast(batchResult);
                      if (batchIsPast && batchForecasts.length > 0) {
                        ctx
                          .call('object-store.put', {
                            namespace: 'mastr_gen_cache',
                            key: genCacheKey,
                            payload: { forecasts: batchForecasts },
                          })
                          .catch((e) =>
                            this.logger.warn(
                              `[mastr-cache] write failed for ${genCacheKey}: ${e.message}`
                            )
                          );
                      }
                    }

                    allForecasts.push(...batchForecasts);
                    batchStart = new Date(batchStart.getTime() + BATCH_DAYS * 24 * 3600 * 1000);
                  }

                  // Deduplicate by timestamp (batches may overlap at boundaries)
                  const seen = new Set();
                  genSeries = allForecasts.filter((r) => {
                    if (seen.has(r.timestamp)) return false;
                    seen.add(r.timestamp);
                    return true;
                  });
                  dataQuality = 'mastr_historical_reconstruction';
                } catch (err) {
                  this.logger.warn(
                    `portfolioBacktest: forecast failed for ${mastrId}: ${err.message}`
                  );
                  warnings.push('forecast_unavailable');
                  dataQuality = 'missing_profile';
                  genSeries = priceTimestamps.map((ts) => ({ timestamp: ts, generationMwh: 0 }));
                }
              }
              // Priority 3: dispatchable types with known assumption
              else if (BACKTEST_ASSUMPTION_FULL_LOAD_HOURS[assetType] !== undefined) {
                genSeries = _btBuildAssumptionSeries(asset, priceTimestamps);
                dataQuality = 'assumption';
                warnings.push('assumption_used');
              }
              // Priority 4: storage / unknown → no profile
              else {
                genSeries = priceTimestamps.map((ts) => ({ timestamp: ts, generationMwh: 0 }));
                dataQuality = 'missing_profile';
                warnings.push('generation_profile_missing');
              }

              // Apply commissioningDate: zero intervals before grid connection
              const { series: zeroed, warnings: cdWarnings } = _btApplyCommissioningDate(
                genSeries,
                asset.commissioningDate
              );
              genSeries = zeroed;
              if (cdWarnings.length > 0) warnings.push(...cdWarnings);

              const intervals = _btMergeIntervals(genSeries, prices);
              const kpis = _btAssetKpis(intervals);
              const weightedMvPerMwh =
                kpis.generationMwh > 0
                  ? Math.round((kpis.marketValueEur / kpis.generationMwh) * 100) / 100
                  : 0;

              const assetCapacityKw = Number(asset.capacityKw || 0);
              const orientationYield = BACKTEST_ORIENTATION_YIELD_KWH_KW[assetType] ?? null;
              const specificYield =
                assetCapacityKw > 0
                  ? Math.round(((kpis.generationMwh * 1000) / assetCapacityKw) * 10) / 10
                  : null;
              const nonZeroSlots = intervals.filter((iv) => iv.generationMwh > 0).length;
              const genCoverage =
                intervals.length > 0
                  ? Math.round((nonZeroSlots / intervals.length) * 1000) / 1000
                  : null;

              assetResults.push({
                mastrNumber: mastrId || undefined,
                type: assetType,
                capacityKw: asset.capacityKw,
                dataQuality,
                warnings,
                generationMwh: kpis.generationMwh,
                marketValueEur: kpis.marketValueEur,
                weightedMarketValueEurPerMwh: weightedMvPerMwh,
                curtailedMarketValueEur: kpis.curtailedMarketValueEur,
                negativePriceAvoidableLossEur: kpis.negativePriceAvoidableLossEur,
                negativePriceHours: kpis.negativePriceHours,
                plausibility: {
                  specificYieldKwhPerKw: specificYield,
                  orientationYieldKwhPerKw: orientationYield,
                  // yieldRatio < 1 is expected for non-standard orientation, shading, or large-array losses.
                  yieldRatio:
                    orientationYield && specificYield != null
                      ? Math.round((specificYield / orientationYield) * 1000) / 1000
                      : null,
                  generationCoverage: genCoverage,
                  capacityBasis: 'capacityKw_from_request',
                },
                _intervals: intervals,
              });
              if (jobId)
                jobStore.appendLog(
                  jobId,
                  'assets',
                  Math.round(35 + ((i + 1) / assets.length) * 55),
                  `Asset ${i + 1}/${assets.length} processed (${dataQuality}${genBatchCount > 0 ? `, ${genCacheHits}/${genBatchCount} gen batches cached` : ''})`
                );
            }

            // 3. Aggregate portfolio across all intervals
            if (jobId) jobStore.appendLog(jobId, 'aggregate', 92, 'Aggregating portfolio KPIs');
            const allIntervals = [];
            {
              // Sum generation across assets per timestamp slot using the shared price grid
              const genByTs = {};
              for (const ar of assetResults) {
                for (const iv of ar._intervals) {
                  if (!genByTs[iv.timestamp]) {
                    genByTs[iv.timestamp] = {
                      timestamp: iv.timestamp,
                      generationMwh: 0,
                      priceEurPerMwh: iv.priceEurPerMwh,
                    };
                  }
                  genByTs[iv.timestamp].generationMwh += iv.generationMwh;
                }
              }
              for (const ts of priceTimestamps) {
                const slot = genByTs[ts];
                if (slot) {
                  allIntervals.push({
                    ...slot,
                    marketValueEur: slot.generationMwh * slot.priceEurPerMwh,
                  });
                }
              }
            }

            const pfKpis = _btAssetKpis(allIntervals);
            const pfWeightedMvPerMwh =
              pfKpis.generationMwh > 0
                ? Math.round((pfKpis.marketValueEur / pfKpis.generationMwh) * 100) / 100
                : 0;
            const captureRate =
              avgSpotPrice !== 0
                ? Math.round((pfWeightedMvPerMwh / avgSpotPrice) * 10000) / 10000
                : null;

            const monthly = _btMonthlyAggregation(allIntervals, dateFrom, dateTo);

            // 4. Build response
            const assetSummaries = assetResults.map(({ _intervals, ...rest }) => rest);

            // Portfolio-level plausibility: capacity-weighted reference yield and aggregate coverage
            const pfCapacityKw = assets.reduce((s, a) => s + Number(a.capacityKw || 0), 0);
            const pfSpecificYield =
              pfCapacityKw > 0
                ? Math.round(((pfKpis.generationMwh * 1000) / pfCapacityKw) * 10) / 10
                : null;
            const pfOrientationYield =
              pfCapacityKw > 0
                ? Math.round(
                    assets.reduce((s, a) => {
                      const ref =
                        BACKTEST_ORIENTATION_YIELD_KWH_KW[(a.type || '').toLowerCase()] ?? 0;
                      return s + ref * Number(a.capacityKw || 0);
                    }, 0) / pfCapacityKw
                  )
                : null;
            const pfNonZeroSlots = allIntervals.filter((iv) => iv.generationMwh > 0).length;
            const pfGenCoverage =
              allIntervals.length > 0
                ? Math.round((pfNonZeroSlots / allIntervals.length) * 1000) / 1000
                : null;

            const response = {
              success: true,
              period: {
                dateFrom,
                dateTo,
                days: daysDiff,
                resolution: ctx.params.resolution || 'hourly',
              },
              market: {
                type: market || 'day-ahead',
                region: 'Deutschland',
                currency: 'EUR',
                priceUnit: 'EUR/MWh',
              },
              portfolio: {
                assetCount: assets.length,
                totalCapacityKw: pfCapacityKw,
                generationMwh: pfKpis.generationMwh,
                marketValueEur: pfKpis.marketValueEur,
                weightedMarketValueEurPerMwh: pfWeightedMvPerMwh,
                averageSpotPriceEurPerMwh: Math.round(avgSpotPrice * 100) / 100,
                captureRate,
                negativePriceHours: pfKpis.negativePriceHours,
                generationDuringNegativePricesMwh: pfKpis.generationDuringNegativePricesMwh,
                valueDuringNegativePricesEur: pfKpis.valueDuringNegativePricesEur,
                curtailedMarketValueEur: pfKpis.curtailedMarketValueEur,
                negativePriceAvoidableLossEur: pfKpis.negativePriceAvoidableLossEur,
                plausibility: {
                  specificYieldKwhPerKw: pfSpecificYield,
                  orientationYieldKwhPerKw: pfOrientationYield,
                  yieldRatio:
                    pfOrientationYield && pfSpecificYield != null
                      ? Math.round((pfSpecificYield / pfOrientationYield) * 1000) / 1000
                      : null,
                  generationCoverage: pfGenCoverage,
                  capacityBasis: 'sum_of_asset_capacityKw',
                },
              },
              monthly,
              assets: assetSummaries,
              methodology: {
                timezone: 'UTC',
                priceAlignment: 'hourly',
                fallbackPolicy: 'assumption_if_no_forecast_or_uploaded_profile',
                captureRateDefinition:
                  'weightedMarketValueEurPerMwh / timeWeightedAverageSpotPrice',
                commissioningDatePolicy:
                  'full_period_used_if_commissioningDate_missing — warning commissioning_date_missing is set but no generation is zeroed',
                generationModel:
                  'mastr_generation_forecast_historical_mode — weather-based reconstruction via MaStR MCP; actual yield reflects site-specific orientation, tilt, shading, and array losses; south-30deg orientation yield used as plausibility reference only',
                orientationYieldBasis:
                  'Germany_typical_conditions (solar: 950 kWh/kW/a south-30deg; wind_onshore: 1800 kWh/kW/a)',
                assumptions: assetResults
                  .filter((a) => a.dataQuality === 'assumption')
                  .map((a) => ({
                    assetType: a.type,
                    fullLoadHoursPerYear: BACKTEST_ASSUMPTION_FULL_LOAD_HOURS[a.type],
                    profile: 'flat_base_generation',
                  })),
              },
              sources: [
                { key: 'spot_market_prices', reference: '/api/energy-market/prices' },
                {
                  key: 'generation_forecast',
                  reference: 'mastr_generation_forecast (historical mode)',
                },
              ],
            };

            if (includeTimeseries) {
              response.timeseries =
                response.period.resolution === 'daily'
                  ? _btDailyAggregation(allIntervals)
                  : allIntervals.map((iv) => ({
                      timestamp: iv.timestamp,
                      generationMwh: Math.round(iv.generationMwh * 1000) / 1000,
                      priceEurPerMwh: iv.priceEurPerMwh,
                      marketValueEur: Math.round(iv.marketValueEur * 100) / 100,
                    }));
            }

            if (jobId) jobStore.appendLog(jobId, 'completed', 100, 'Backtest complete');
            return response;
          } // end worker
        ); // end startJob
      },
    },
  },
};
