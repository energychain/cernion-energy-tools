'use strict';

const { MoleculerClientError } = require('moleculer').Errors;
const {
  getEegTariff,
  getPostEegRate,
  isPostEeg,
} = require('../src/eeg-tariff-tables');
const {
  calculateRedispatchCompensation,
  calculateEegRevenue,
  prepareA96Export,
} = require('../src/settlement-calculator');

const NAMESPACE = 'settlements';
const FEEDIN_OBIS = '1-0:2.8.0';

function toIsoStart(value) {
  if (/^\d{4}-\d{2}-\d{2}$/.test(String(value || ''))) {
    return `${value}T00:00:00.000Z`;
  }
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return null;
  return date.toISOString();
}

function toIsoEnd(value) {
  if (/^\d{4}-\d{2}-\d{2}$/.test(String(value || ''))) {
    return `${value}T23:59:59.999Z`;
  }
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return null;
  return date.toISOString();
}

function toNumber(value, fallback = 0) {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : fallback;
}

function round(value, decimals = 2) {
  const factor = 10 ** decimals;
  return Math.round(toNumber(value) * factor) / factor;
}

function periodKey(fromDate) {
  const date = new Date(fromDate);
  const quarter = Math.floor(date.getUTCMonth() / 3) + 1;
  return `${date.getUTCFullYear()}q${quarter}`;
}

function dayDiff(fromIso, toIso) {
  const from = new Date(fromIso).getTime();
  const to = new Date(toIso).getTime();
  return Math.max(1, Math.ceil((to - from) / 86400000));
}

function parseTimeseriesResponse(response) {
  return Array.isArray(response?.values) ? response.values : [];
}

function mapPriceRows(result) {
  const rows = Array.isArray(result?.prices)
    ? result.prices
    : Array.isArray(result?.data?.prices)
      ? result.data.prices
      : [];

  return rows.map((row) => ({
    hour: row.timestamp || row.hour || row.ts,
    price_eur_mwh: toNumber(row.price ?? row.value),
  })).filter((row) => row.hour);
}

function parseForecastRows(result) {
  const rows = Array.isArray(result?.values)
    ? result.values
    : Array.isArray(result?.data)
      ? result.data
      : Array.isArray(result?.forecast)
        ? result.forecast
        : [];

  return rows
    .map((row) => ({
      ts: row.ts || row.timestamp,
      value: toNumber(row.value ?? row.generationMWh ?? row.generationMW ?? row.powerKw),
    }))
    .filter((row) => row.ts);
}

function toCsv(rows) {
  const columns = [
    'rowId',
    'format',
    'mastrNummer',
    'meloId',
    'from',
    'to',
    'forecast_kwh',
    'actual_kwh',
    'lost_kwh',
    'marketPrice_eur_mwh',
    'eegTariff_cent_kwh',
    'compensation_eur',
    'method',
  ];

  const lines = [columns.join(';')];
  for (const row of rows) {
    lines.push(columns.map((column) => `${row[column] ?? ''}`).join(';'));
  }
  return lines.join('\n');
}

module.exports = {
  name: 'settlement',
  timeout: 120000,
  dependencies: ['edm'],

  settings: {
    defaultMarketPriceSource: 'entsoe_day_ahead',
    defaultCurrency: 'EUR',
    defaultMarketPriceEurMwh: 50,
    defaultSlpProfileId: 'H0',
  },

  actions: {
    calculateRedispatch: {
      rest: 'POST /redispatch/calculate',
      params: {
        installations: {
          type: 'array',
          min: 1,
          items: {
            type: 'object',
            props: {
              mastrNummer: { type: 'string' },
              meloId: { type: 'string', optional: true },
              capacityKw: { type: 'number', optional: true, convert: true },
              commissioningDate: { type: 'string', optional: true },
              type: { type: 'enum', values: ['solar', 'wind', 'biomass'], optional: true },
              curtailmentEvents: {
                type: 'array',
                min: 1,
                items: {
                  type: 'object',
                  props: {
                    start: { type: 'string' },
                    end: { type: 'string' },
                    reason: { type: 'string', optional: true },
                    orderedReductionKw: { type: 'number', optional: true, convert: true },
                  },
                },
              },
            },
          },
        },
        period: {
          type: 'object',
          props: {
            from: { type: 'string' },
            to: { type: 'string' },
          },
        },
        compensationMethod: {
          type: 'enum',
          values: ['market_price', 'eeg_minimum', 'actual_loss'],
          optional: true,
          default: 'actual_loss',
        },
      },
      openapi: {
        summary: 'Calculate Redispatch compensation (§13a/14 EnWG)',
        tags: ['Settlement (Abrechnung)'],
        description:
          'Calculates compensation for curtailment events based on forecast vs. actual generation and market prices. Supports market_price, eeg_minimum and actual_loss (max of both).',
        requestBody: {
          required: true,
          content: {
            'application/json': {
              schema: {
                type: 'object',
                required: ['installations', 'period'],
                properties: {
                  installations: {
                    type: 'array',
                    example: [{ mastrNummer: 'SEE999952467552', meloId: 'DE0003966698900000000000052335107', curtailmentEvents: [{ start: '2026-04-01T10:00:00Z', end: '2026-04-01T12:00:00Z' }] }],
                    items: { type: 'object' },
                  },
                  period: {
                    type: 'object',
                    example: { from: '2026-04-01', to: '2026-04-30' },
                    properties: {
                      from: { type: 'string', example: '2026-04-01' },
                      to: { type: 'string', example: '2026-04-30' },
                    },
                  },
                  compensationMethod: {
                    type: 'string',
                    enum: ['market_price', 'eeg_minimum', 'actual_loss'],
                    default: 'actual_loss',
                  },
                },
              },
              examples: {
                default: {
                  value: {
                    installations: [{
                      mastrNummer: 'SEE999952467552',
                      meloId: 'DE0003966698900000000000052335107',
                      capacityKw: 2103.7,
                      commissioningDate: '2009-12-16',
                      type: 'solar',
                      curtailmentEvents: [{
                        start: '2026-04-01T10:00:00Z',
                        end: '2026-04-01T12:00:00Z',
                        reason: 'grid_congestion',
                      }],
                    }],
                    period: { from: '2026-04-01', to: '2026-04-30' },
                    compensationMethod: 'actual_loss',
                  },
                },
              },
            },
          },
        },
      },
      async handler(ctx) {
        const { installations, period, compensationMethod } = ctx.params;
        const from = toIsoStart(period.from);
        const to = toIsoEnd(period.to);

        if (!from || !to) {
          throw new MoleculerClientError('Invalid period', 400, 'INVALID_PERIOD');
        }

        const allEvents = [];
        const marketPrices = await this.getMarketPrices(ctx, period.from, period.to);

        for (const installation of installations) {
          const installationType = installation.type || 'solar';
          const meloId = installation.meloId || await this.resolveMeloId(ctx, installation.mastrNummer);
          if (!meloId) {
            throw new MoleculerClientError(
              `MeLo not found for installation ${installation.mastrNummer}`,
              404,
              'MELO_NOT_FOUND'
            );
          }

          const actualData = await this.getActualFeedin(ctx, meloId, from, to);
          const forecastData = await this.getForecastData(
            ctx,
            installation,
            { from, to, periodFrom: period.from, periodTo: period.to },
            actualData
          );

          const eegTariff = this.resolveEegTariff(
            installation.commissioningDate,
            installation.capacityKw,
            installationType
          );

          const events = installation.curtailmentEvents.map((event) => ({
            ...event,
            installationMastrNummer: installation.mastrNummer,
            eegTariff_cent_kwh: eegTariff,
            compensationMethod,
          }));

          const result = calculateRedispatchCompensation(
            events,
            forecastData,
            actualData,
            marketPrices
          );

          allEvents.push(...result.events);
        }

        const totalLostKwh = allEvents.reduce((sum, event) => sum + toNumber(event.lost_kwh), 0);
        const totalCompensation = allEvents.reduce(
          (sum, event) => sum + toNumber(event.compensation_eur),
          0
        );

        const installationId = installations.length === 1 ? installations[0].mastrNummer : 'multi';
        const settlementId = `redispatch_${periodKey(from)}_${installationId}`;

        const payload = {
          success: true,
          settlementId,
          type: 'redispatch',
          period: { from, to },
          events: allEvents,
          summary: {
            totalEvents: allEvents.length,
            totalLostKwh: round(totalLostKwh, 4),
            totalCompensation_eur: round(totalCompensation, 2),
            avgMarketPrice_eur_mwh: round(
              marketPrices.length
                ? marketPrices.reduce((sum, item) => sum + toNumber(item.price_eur_mwh), 0) / marketPrices.length
                : this.settings.defaultMarketPriceEurMwh,
              4
            ),
            period: { from, to },
          },
          createdAt: new Date().toISOString(),
        };

        await this.saveSettlement(ctx, settlementId, payload);
        return payload;
      },
    },

    getRedispatchReport: {
      rest: 'GET /redispatch/report/:settlementId',
      params: {
        settlementId: { type: 'string' },
      },
      openapi: {
        summary: 'Get a stored Redispatch settlement report',
        tags: ['Settlement (Abrechnung)'],
        parameters: [
          {
            name: 'settlementId',
            in: 'path',
            required: true,
            schema: { type: 'string', example: 'redispatch_2026q2_SEE999952467552' },
          },
        ],
      },
      async handler(ctx) {
        const report = await this.loadSettlement(ctx, ctx.params.settlementId);
        if (!report || report.type !== 'redispatch') {
          throw new MoleculerClientError('Settlement not found', 404, 'SETTLEMENT_NOT_FOUND');
        }
        return report;
      },
    },

    calculateEeg: {
      rest: 'POST /eeg/calculate',
      params: {
        mastrNummer: { type: 'string' },
        meloId: { type: 'string', optional: true },
        period: {
          type: 'object',
          props: {
            from: { type: 'string' },
            to: { type: 'string' },
          },
        },
        commissioningDate: { type: 'string', optional: true },
        capacityKwp: { type: 'number', optional: true, convert: true },
        type: {
          type: 'enum',
          values: ['solar', 'wind', 'biomass'],
          optional: true,
          default: 'solar',
        },
      },
      openapi: {
        summary: 'Calculate EEG revenue for an installation',
        tags: ['Settlement (Abrechnung)'],
        requestBody: {
          required: true,
          content: {
            'application/json': {
              schema: {
                type: 'object',
                required: ['mastrNummer', 'period'],
                properties: {
                  mastrNummer: { type: 'string', example: 'SEE999952467552' },
                  meloId: { type: 'string', example: 'DE0003966698900000000000052335107' },
                  period: {
                    type: 'object',
                    example: { from: '2026-04-01', to: '2026-04-30' },
                    properties: {
                      from: { type: 'string', example: '2026-04-01' },
                      to: { type: 'string', example: '2026-04-30' },
                    },
                  },
                  commissioningDate: { type: 'string', example: '2010-05-12' },
                  capacityKwp: { type: 'number', example: 9.8 },
                  type: { type: 'string', enum: ['solar', 'wind', 'biomass'], example: 'solar' },
                },
              },
              examples: {
                default: {
                  value: {
                    mastrNummer: 'SEE999952467552',
                    meloId: 'DE0003966698900000000000052335107',
                    period: { from: '2026-04-01', to: '2026-04-30' },
                    commissioningDate: '2009-12-16',
                    capacityKwp: 2103.7,
                    type: 'solar',
                  },
                },
              },
            },
          },
        },
      },
      async handler(ctx) {
        const { mastrNummer, period, commissioningDate, capacityKwp, type } = ctx.params;
        const from = toIsoStart(period.from);
        const to = toIsoEnd(period.to);

        if (!from || !to) {
          throw new MoleculerClientError('Invalid period', 400, 'INVALID_PERIOD');
        }

        const installationMeta = await this.getInstallationMeta(ctx, mastrNummer);

        const resolvedCommissioningDate = commissioningDate || installationMeta.commissioningDate;
        const resolvedCapacityKwp = capacityKwp ?? installationMeta.capacityKwp ?? 0;
        const resolvedType = type || installationMeta.type || 'solar';

        const tariff = this.resolveEegTariff(
          resolvedCommissioningDate,
          resolvedCapacityKwp,
          resolvedType
        );

        const meloId = ctx.params.meloId || installationMeta.meloId || await this.resolveMeloId(ctx, mastrNummer);
        if (!meloId) {
          throw new MoleculerClientError(
            `MeLo not found for installation ${mastrNummer}`,
            404,
            'MELO_NOT_FOUND'
          );
        }

        const feedinData = await this.getActualFeedin(ctx, meloId, from, to);
        const eeg = calculateEegRevenue(feedinData, tariff, dayDiff(from, to));

        const settlementId = `eeg_${periodKey(from)}_${mastrNummer}`;
        const payload = {
          success: true,
          settlementId,
          type: 'eeg',
          mastrNummer,
          meloId,
          tariff,
          period: { from, to },
          ...eeg,
          createdAt: new Date().toISOString(),
        };

        await this.saveSettlement(ctx, settlementId, payload);

        return {
          success: true,
          settlementId,
          revenue_eur: eeg.revenue_eur,
          feedinKwh: eeg.feedinKwh,
          tariff,
          period: { from, to },
        };
      },
    },

    getEegReport: {
      rest: 'GET /eeg/report/:settlementId',
      params: {
        settlementId: { type: 'string' },
      },
      openapi: {
        summary: 'Get a stored EEG settlement report',
        tags: ['Settlement (Abrechnung)'],
        parameters: [
          {
            name: 'settlementId',
            in: 'path',
            required: true,
            schema: { type: 'string', example: 'eeg_2026q2_SEE999952467552' },
          },
        ],
      },
      async handler(ctx) {
        const report = await this.loadSettlement(ctx, ctx.params.settlementId);
        if (!report || report.type !== 'eeg') {
          throw new MoleculerClientError('Settlement not found', 404, 'SETTLEMENT_NOT_FOUND');
        }
        return report;
      },
    },

    prepareA96: {
      rest: 'POST /a96/prepare',
      params: {
        settlementId: { type: 'string' },
      },
      openapi: {
        summary: 'Prepare A96 export rows from a Redispatch settlement',
        tags: ['Settlement (Abrechnung)'],
        requestBody: {
          required: true,
          content: {
            'application/json': {
              schema: {
                type: 'object',
                required: ['settlementId'],
                properties: {
                  settlementId: { type: 'string', example: 'redispatch_2026q2_SEE999952467552' },
                },
              },
              examples: {
                default: {
                  value: {
                    settlementId: 'redispatch_2026q2_SEE999952467552',
                  },
                },
              },
            },
          },
        },
      },
      async handler(ctx) {
        const settlement = await this.loadSettlement(ctx, ctx.params.settlementId);
        if (!settlement || settlement.type !== 'redispatch') {
          throw new MoleculerClientError('Settlement not found', 404, 'SETTLEMENT_NOT_FOUND');
        }

        const rows = prepareA96Export(settlement, {});
        return {
          success: true,
          settlementId: settlement.settlementId,
          rows,
          format: 'a96',
          ready: true,
        };
      },
    },

    exportA96: {
      rest: 'GET /a96/export/:settlementId',
      params: {
        settlementId: { type: 'string' },
        format: {
          type: 'enum',
          values: ['csv', 'json'],
          optional: true,
          default: 'csv',
        },
      },
      openapi: {
        summary: 'Export A96 rows as CSV or JSON',
        tags: ['Settlement (Abrechnung)'],
        parameters: [
          {
            name: 'settlementId',
            in: 'path',
            required: true,
            schema: { type: 'string', example: 'redispatch_2026q2_SEE999952467552' },
          },
          {
            name: 'format',
            in: 'query',
            required: false,
            schema: { type: 'string', enum: ['csv', 'json'], default: 'csv' },
          },
        ],
      },
      async handler(ctx) {
        const settlement = await this.loadSettlement(ctx, ctx.params.settlementId);
        if (!settlement || settlement.type !== 'redispatch') {
          throw new MoleculerClientError('Settlement not found', 404, 'SETTLEMENT_NOT_FOUND');
        }

        const rows = prepareA96Export(settlement, {});
        if (ctx.params.format === 'json') {
          return {
            success: true,
            settlementId: settlement.settlementId,
            format: 'json',
            rows,
          };
        }

        return toCsv(rows);
      },
    },

    lookupEegTariff: {
      rest: 'GET /eeg-tariff',
      params: {
        commissioningDate: { type: 'string' },
        capacityKwp: { type: 'number', convert: true },
        type: { type: 'enum', values: ['solar', 'wind', 'biomass'] },
      },
      openapi: {
        summary: 'Read-only EEG tariff lookup',
        tags: ['Settlement (Abrechnung)'],
        parameters: [
          {
            name: 'commissioningDate',
            in: 'query',
            required: true,
            schema: { type: 'string', example: '2024-03-15' },
          },
          {
            name: 'capacityKwp',
            in: 'query',
            required: true,
            schema: { type: 'number', example: 10 },
          },
          {
            name: 'type',
            in: 'query',
            required: true,
            schema: { type: 'string', enum: ['solar', 'wind', 'biomass'], example: 'solar' },
          },
        ],
      },
      handler(ctx) {
        const tariff = this.resolveEegTariff(
          ctx.params.commissioningDate,
          ctx.params.capacityKwp,
          ctx.params.type
        );

        return {
          success: true,
          commissioningDate: ctx.params.commissioningDate,
          capacityKwp: ctx.params.capacityKwp,
          type: ctx.params.type,
          tariff,
          postEeg: isPostEeg(ctx.params.commissioningDate),
        };
      },
    },

    listSettlements: {
      rest: 'GET /',
      params: {
        type: {
          type: 'enum',
          values: ['redispatch', 'eeg', 'all'],
          optional: true,
          default: 'all',
        },
        period: { type: 'string', optional: true },
      },
      openapi: {
        summary: 'List stored settlements',
        tags: ['Settlement (Abrechnung)'],
        parameters: [
          {
            name: 'type',
            in: 'query',
            required: false,
            schema: { type: 'string', enum: ['redispatch', 'eeg', 'all'], default: 'all' },
          },
          {
            name: 'period',
            in: 'query',
            required: false,
            schema: { type: 'string', example: '2026q2' },
          },
        ],
      },
      async handler(ctx) {
        const queryResult = await ctx.call('object-store.query', {
          namespace: NAMESPACE,
          selector: {},
          limit: 1000,
          skip: 0,
        });

        const docs = Array.isArray(queryResult?.docs) ? queryResult.docs : [];
        const filtered = docs.filter((doc) => {
          const key = doc.key || '';
          const payloadType = doc.payload?.type || null;
          const typeMatches = ctx.params.type === 'all'
            ? true
            : payloadType === ctx.params.type || key.startsWith(`${ctx.params.type}_`);
          const periodMatches = ctx.params.period
            ? key.includes(ctx.params.period) || String(doc.payload?.period?.from || '').includes(ctx.params.period)
            : true;
          return typeMatches && periodMatches;
        });

        return {
          success: true,
          count: filtered.length,
          data: filtered.map((item) => ({
            key: item.key,
            type: item.payload?.type || null,
            period: item.payload?.period || null,
            createdAt: item.payload?.createdAt || null,
            summary: item.payload?.summary || null,
          })),
        };
      },
    },
  },

  methods: {
    async getActualFeedin(ctx, meloId, from, to) {
      const result = await ctx.call('edm.getTimeseries', {
        meloId,
        obis: FEEDIN_OBIS,
        from,
        to,
        resolution: '15min',
        format: 'json',
      });
      return parseTimeseriesResponse(result);
    },

    async getMarketPrices(ctx, dateFrom, dateTo) {
      try {
        const result = await ctx.call('entsoe.dayAheadPrices', {
          region: 'Germany',
          dateFrom,
          dateTo,
          includeStatistics: true,
          format: 'json',
        }, { meta: { cernionToken: ctx.meta.cernionToken } });

        const prices = mapPriceRows(result);
        if (prices.length > 0) return prices;
      } catch (error) {
        this.logger.warn(`ENTSO-E prices unavailable, fallback active: ${error.message}`);
      }

      return [{
        hour: `${dateFrom}T00:00:00.000Z`,
        price_eur_mwh: this.settings.defaultMarketPriceEurMwh,
      }];
    },

    async getForecastData(ctx, installation, period, actualData) {
      const forecast = await this.tryForecastTool(ctx, installation, period);
      if (forecast.length > 0) return forecast;

      const slpForecast = await this.trySlpFallback(ctx, installation, period, actualData);
      if (slpForecast.length > 0) return slpForecast;

      return (actualData || []).map((row) => ({
        ts: row.ts,
        value: round(toNumber(row.value) * 1.2, 4),
      }));
    },

    async tryForecastTool(ctx, installation, period) {
      try {
        const result = await ctx.call('forecast.generationForecast', {
          installationMastrNummer: installation.mastrNummer,
          installationType: installation.type || 'solar',
          resolution: '15min',
          startDate: period.from.slice(0, 10),
          forecastDays: dayDiff(period.from, period.to),
          format: 'json',
        }, { meta: { cernionToken: ctx.meta.cernionToken } });

        return parseForecastRows(result);
      } catch (error) {
        this.logger.warn(`Forecast tool unavailable, fallback active: ${error.message}`);
        return [];
      }
    },

    async trySlpFallback(ctx, installation, period, actualData) {
      try {
        const start = new Date(period.from);
        const end = new Date(period.to);
        const rows = [];

        const targetAverage = average((actualData || []).map((row) => toNumber(row.value)), 5);

        for (let day = new Date(start); day <= end; day.setUTCDate(day.getUTCDate() + 1)) {
          const date = day.toISOString().slice(0, 10);
          const result = await ctx.call('slp.generateTimeseries', {
            profileId: this.settings.defaultSlpProfileId,
            date,
            annualConsumptionKwh: Math.max(1200, toNumber(installation.capacityKw, 10) * 1000),
          });

          const values = Array.isArray(result?.values) ? result.values : [];
          for (let i = 0; i < values.length; i += 1) {
            const ts = new Date(`${date}T00:00:00.000Z`).getTime() + i * 900000;
            rows.push({
              ts: new Date(ts).toISOString(),
              value: round(toNumber(values[i]) + targetAverage, 4),
            });
          }
        }

        return rows.filter((row) => row.ts >= period.from && row.ts <= period.to);
      } catch (error) {
        this.logger.warn(`SLP fallback unavailable: ${error.message}`);
        return [];
      }
    },

    async resolveMeloId(ctx, mastrNummer) {
      try {
        const result = await ctx.call('energy-market.installations', {
          mastrNummer,
          limit: 1,
          includeNapData: true,
          format: 'detailed',
        }, { meta: { cernionToken: ctx.meta.cernionToken } });

        const installation = Array.isArray(result?.data?.installations)
          ? result.data.installations[0]
          : Array.isArray(result?.installations)
            ? result.installations[0]
            : null;

        if (installation?.napData?.messlokation) {
          return installation.napData.messlokation;
        }
      } catch (_error) {
        // ignore: fallback to EDM registry scan
      }

      const melos = await ctx.call('edm.listMelos', { limit: 5000, offset: 0 });
      const row = (melos?.data || []).find((item) => item.installationMastrNummer === mastrNummer);
      return row?.meloId || null;
    },

    async getInstallationMeta(ctx, mastrNummer) {
      try {
        const result = await ctx.call('energy-market.installations', {
          mastrNummer,
          limit: 1,
          includeNapData: true,
          format: 'detailed',
        }, { meta: { cernionToken: ctx.meta.cernionToken } });

        const installation = Array.isArray(result?.data?.installations)
          ? result.data.installations[0]
          : Array.isArray(result?.installations)
            ? result.installations[0]
            : null;

        if (!installation) return {};

        return {
          commissioningDate:
            installation.inbetriebnahmedatum || installation.Inbetriebnahmedatum || null,
          capacityKwp:
            toNumber(
              installation.nettonennleistung ||
              installation.Nettonennleistung ||
              installation.powerKw,
              0
            ),
          type: installation.type || installation.installationType || 'solar',
          meloId: installation?.napData?.messlokation || null,
        };
      } catch (_error) {
        return {};
      }
    },

    resolveEegTariff(commissioningDate, capacityKwp, type) {
      const tariff = getEegTariff(commissioningDate, capacityKwp, type);
      if (tariff !== null) return tariff;
      return getPostEegRate(type);
    },

    async saveSettlement(ctx, key, payload) {
      await ctx.call('object-store.put', {
        namespace: NAMESPACE,
        key,
        payload,
      });
    },

    async loadSettlement(ctx, key) {
      const result = await ctx.call('object-store.get', {
        namespace: NAMESPACE,
        key,
      });
      return result?.payload || null;
    },
  },
};
