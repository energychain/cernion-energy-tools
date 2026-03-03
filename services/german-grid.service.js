/**
 * German Grid Data Service
 *
 * Official German grid operator data from Netztransparenz.de
 * Spotprices, redispatch, forecasts
 */

const CernionMCPClient = require('../src/mcp-client');
const { applyFormat, FORMAT_PARAM_SCHEMA, FORMAT_RESPONSE_CONTENT } = require('../src/format-response');
const { resolveDateAlias } = require('../src/date-utils');

module.exports = {
  name: 'german-grid',

  settings: {
    defaultTimeout: 30000,
  },

  actions: {
    /**
     * German spotmarket prices (EPEX/EEX)
     * Tool: netztransparenz_spotprices
     */
    spotprices: {
      rest: 'POST /spotprices',
      params: {
        dateFrom: { type: 'string' },
        dateTo: { type: 'string' },
        includeStatistics: { type: 'boolean', optional: true, default: true },
        format: { type: 'enum', values: ['json', 'csv', 'xlsx', 'xls'], optional: true, default: 'json' },
      },
      openapi: {
        summary: 'German spotmarket prices (EPEX/EEX) for dynamic tariffs',
        tags: ['German Grid Data'],
        description: 'Official data from Netztransparenz.de, OAuth2 authenticated',
        requestBody: {
          required: true,
          content: {
            'application/json': {
              schema: {
                type: 'object',
                required: ['dateFrom', 'dateTo'],
                properties: {
                  dateFrom: {
                    type: 'string',
                    description: 'Start date. ISO format (YYYY-MM-DD) or relative alias: `today`, `today+N`, `today-N`, `tomorrow`, `yesterday`.',
                    example: 'today',
                  },
                  dateTo: {
                    type: 'string',
                    description: 'End date. ISO format (YYYY-MM-DD) or relative alias: `today`, `today+N`, `today-N`, `tomorrow`, `yesterday`.',
                    example: 'today',
                  },
                  includeStatistics: {
                    type: 'boolean',
                    description: 'Include price statistics (min/max/avg)',
                    default: true,
                  },
                  format: FORMAT_PARAM_SCHEMA,
                },
              },
              examples: {
                weekPrices: {
                  summary: 'Week of spot prices',
                  value: {
                    dateFrom: '2026-02-01',
                    dateTo: '2026-02-07',
                    includeStatistics: true,
                  },
                },
                monthPrices: {
                  summary: 'Full month analysis',
                  value: {
                    dateFrom: '2026-01-01',
                    dateTo: '2026-01-31',
                    includeStatistics: true,
                  },
                },
                singleDay: {
                  summary: 'Single day prices',
                  value: {
                    dateFrom: '2026-02-01',
                    dateTo: '2026-02-01',
                    includeStatistics: false,
                  },
                },
                relativeAlias: {
                  summary: 'Today\'s prices using relative date alias',
                  value: { dateFrom: 'today', dateTo: 'today', includeStatistics: true },
                },
                recentWeek: {
                  summary: 'Last 7 days using relative aliases',
                  value: { dateFrom: 'today-6', dateTo: 'today', includeStatistics: true, format: 'csv' },
                },
                csvExport: {
                  summary: 'Export spot prices as CSV',
                  value: { dateFrom: '2026-02-01', dateTo: '2026-02-07', format: 'csv' },
                },
              },
            },
          },
        },
        responses: {
          200: {
            description: 'Spot price data retrieved successfully',
            content: {
              'application/json': {
                schema: { type: 'object' },
              },
              ...FORMAT_RESPONSE_CONTENT,
            },
          },
        },
      },
      async handler(ctx) {
        const { format, ...mcpParams } = ctx.params;
        mcpParams.dateFrom = resolveDateAlias(mcpParams.dateFrom);
        mcpParams.dateTo = resolveDateAlias(mcpParams.dateTo);
        const result = await CernionMCPClient.callWithNewSession(
          'netztransparenz_spotprices',
          mcpParams,
          ctx.meta.cernionToken
        );
        return applyFormat(ctx, result, format, 'spotprices', 'Spotprices');
      },
    },

    /**
     * Negative price analysis for §51 EEG 2023 compliance
     * Tool: netztransparenz_negative_prices
     */
    negativePrices: {
      rest: 'POST /negative-prices',
      params: {
        dateFrom: { type: 'string' },
        dateTo: { type: 'string' },
        logic: { type: 'enum', values: [1, 2, 3, 4, 6, 15], optional: true, default: 6 },
        includeEegCompliance: { type: 'boolean', optional: true, default: true },
      },
      openapi: {
        summary: 'Negative price analysis for §51 EEG 2023 compliance',
        tags: ['German Grid Data'],
        description: `Analyze negative price periods for EEG direct marketing compliance and prosumer advisory. **Critical for §51 EEG 2023 compliance.**

**§51 EEG 2023 Regulation**:
- **No compensation** during ≥6 consecutive hours of negative spot prices
- Applies to: EEG direct marketing (Direktvermarktung)
- Affects: Installations in direct marketing, prosumers considering switch
- Penalty: Zero compensation for entire negative price period (can be \u20ac100-500+ loss per event)

**Logic Parameter (consecutive hours)**:
- **1 hour**: Any negative price (strictest - for sensitivity analysis)
- **4 hours**: Pre-warning threshold (monitor market conditions)
- **6 hours** (**DEFAULT**): §51 EEG 2023 legal threshold
- **15 hours**: Extreme events only (rare, <5 events/year)

**Use Cases**:

1. **EEG Direct Marketing Compliance** (energy suppliers)
   - Track zero-compensation periods
   - Calculate financial impact (MWh affected × market value)
   - Risk assessment for new direct marketing contracts
   - Monthly compliance reporting to customers

2. **Prosumer Advisory** (self-consumption vs. direct marketing)
   - Risk evaluation: "Is direct marketing worth it for my 30 kWp installation?"
   - Calculate: (EEG revenue gain) - (negative price penalties) - (direct marketing costs)
   - Decision support: Stay in fixed feed-in vs. switch to direct marketing
   - **Critical threshold: <10 events/year = safe, >20 events/year = risky**

3. **Risk Management** (energy suppliers)
   - Identify high-risk months (typically: Mar-Apr, Oct-Nov = high wind + low demand)
   - Portfolio exposure: Total installed capacity × negative price hours
   - Hedge strategies: Battery storage, demand response, curtailment agreements

4. **Market Analysis**:
   - Negative price frequency trends (increasing = more renewables, more risk)
   - Seasonal patterns (spring/fall = highest risk due to wind + low demand)
   - Geographic differences (northern Germany = more wind = more negative prices)

**Typical Negative Price Events** (Germany):
- **Frequency**: 10-30 events/year (≥6 consecutive hours)
- **Seasons**: Spring (Mar-May) and Fall (Sep-Nov) highest risk
- **Causes**: High renewable generation + low demand + limited export capacity
- **Duration**: Typically 6-12 hours, occasionally up to 24 hours
- **Price range**: -50 to -200 €/MWh (extreme: -500 €/MWh)

**Financial Impact Example**:
- 100 kWp installation in direct marketing
- 15 negative price events/year × 8 hours avg × 100 kW × 100 €/MWh market price
- **Potential loss: 12,000 €/year** if not managed
- Mitigation: Self-consumption during negative prices (reduces loss to ~3,000 €/year)

**Best Practices**:
- Monitor monthly (identify trends early)
- Advise prosumers: Direct marketing only if <15 events/year + >30 kWp capacity
- Include negative price risk in direct marketing contracts
- Combine with §14a EnWG controllable devices (reduce grid impact during negative prices)`,
        requestBody: {
          required: true,
          content: {
            'application/json': {
              schema: {
                type: 'object',
                required: ['dateFrom', 'dateTo'],
                properties: {
                  dateFrom: {
                    type: 'string',
                    description: 'Start date. ISO format (YYYY-MM-DD) or relative alias: `today`, `today+N`, `today-N`, `tomorrow`, `yesterday`.',
                    example: 'today-30',
                  },
                  dateTo: {
                    type: 'string',
                    description: 'End date. ISO format (YYYY-MM-DD) or relative alias: `today`, `today+N`, `today-N`, `tomorrow`, `yesterday`.',
                    example: 'today',
                  },
                  logic: {
                    type: 'number',
                    enum: [1, 2, 3, 4, 6, 15],
                    description: 'Consecutive hours threshold (§51 EEG 2023 uses 6)',
                    default: 6,
                  },
                  includeEegCompliance: {
                    type: 'boolean',
                    description: 'Include EEG compliance analysis',
                    default: true,
                  },
                },
              },
              examples: {
                eegCompliance: {
                  summary: '§51 EEG 2023 compliance check (6h threshold)',
                  value: {
                    dateFrom: '2026-01-01',
                    dateTo: '2026-01-31',
                    logic: 6,
                    includeEegCompliance: true,
                  },
                },
                quarterAnalysis: {
                  summary: 'Q1 negative price analysis',
                  value: {
                    dateFrom: '2026-01-01',
                    dateTo: '2026-03-31',
                    logic: 6,
                    includeEegCompliance: true,
                  },
                },
                customThreshold: {
                  summary: 'Custom 4-hour threshold',
                  value: {
                    dateFrom: '2026-02-01',
                    dateTo: '2026-02-28',
                    logic: 4,
                  },
                },
                relativeAlias: {
                  summary: 'Last 30 days using relative date alias',
                  value: {
                    dateFrom: 'today-30',
                    dateTo: 'today',
                    logic: 6,
                    includeEegCompliance: true,
                  },
                },
              },
            },
          },
        },
      },
      async handler(ctx) {
        const resolvedParams = {
          ...ctx.params,
          dateFrom: resolveDateAlias(ctx.params.dateFrom),
          dateTo: resolveDateAlias(ctx.params.dateTo),
        };
        const result = await CernionMCPClient.callWithNewSession(
          'netztransparenz_negative_prices',
          resolvedParams,
          ctx.meta.cernionToken
        );

        // ── Data-reliability check ─────────────────────────────────────
        // Netztransparenz.de sometimes returns "no data" for historical
        // periods where data simply isn't available yet (not a genuine 0).
        // Flag this so consumers / Gemini interpretation can treat it correctly.
        const contentText = result?.data?.content?.[0]?.text || '';
        if (contentText.includes('No Negative Price Periods Found')) {
          const { dateFrom, dateTo } = resolvedParams;
          if (dateFrom && dateTo) {
            const from = new Date(dateFrom);
            const to = new Date(dateTo);
            const today = new Date();
            const daysDiff = (to - from) / (1000 * 60 * 60 * 24);
            const isPastPeriod = to < today;
            if (daysDiff > 90 && isPastPeriod) {
              result.data.content[0].text +=
                '\n\n⚠️ **Plausibilitäts-Hinweis (Datenqualität)**: Für einen Zeitraum' +
                ' von über 90 Tagen wurde 0 Stunden negativer Preise zurückgemeldet.' +
                ' Dies deutet wahrscheinlich auf fehlende oder noch nicht verfügbare' +
                ' historische Daten im Netztransparenz.de-API hin – NICHT auf eine' +
                ' tatsächliche Null. Zur Referenz: In Deutschland gab es 2024 über' +
                ' 300 Stunden negativer Strompreise. Das Ergebnis sollte als' +
                ' **"Daten nicht verfügbar"** interpretiert werden.';
              result.data.dataReliabilityWarning = true;
            }
          }
        }

        return result;
      },
    },

    /**
     * Solar/wind generation forecasts
     * Tool: netztransparenz_forecast
     */
    forecast: {
      rest: 'POST /forecast',
      params: {
        product: { type: 'enum', values: ['Solar', 'Wind'] },
        dateFrom: { type: 'string' },
        dateTo: { type: 'string' },
        includeActual: { type: 'boolean', optional: true, default: false },
        includeOnline: { type: 'boolean', optional: true, default: false },
        format: { type: 'enum', values: ['json', 'csv', 'xlsx', 'xls'], optional: true, default: 'json' },
      },
      openapi: {
        summary: 'Solar/wind generation forecasts for grid planning and load forecasting',
        tags: ['German Grid Data'],
        description: 'Official forecasts from German transmission system operators',
        requestBody: {
          required: true,
          content: {
            'application/json': {
              schema: {
                type: 'object',
                required: ['product', 'dateFrom', 'dateTo'],
                properties: {
                  product: {
                    type: 'string',
                    enum: ['Solar', 'Wind'],
                    description: 'Renewable energy type to forecast',
                    example: 'Solar',
                  },
                  dateFrom: {
                    type: 'string',
                    description: 'Start date. ISO format (YYYY-MM-DD) or relative alias: `today`, `today+N`, `today-N`, `tomorrow`, `yesterday`.',
                    example: 'tomorrow',
                  },
                  dateTo: {
                    type: 'string',
                    description: 'End date. ISO format (YYYY-MM-DD) or relative alias: `today`, `today+N`, `today-N`, `tomorrow`, `yesterday`.',
                    example: 'today+6',
                  },
                  includeActual: {
                    type: 'boolean',
                    description: 'Include actual generation data for comparison',
                    default: false,
                  },
                  includeOnline: {
                    type: 'boolean',
                    description: 'Include online capacity data',
                    default: false,
                  },
                  format: FORMAT_PARAM_SCHEMA,
                },
              },
              examples: {
                solarWeekForecast: {
                  summary: 'Solar generation forecast (1 week)',
                  value: {
                    product: 'Solar',
                    dateFrom: '2026-02-08',
                    dateTo: '2026-02-14',
                    includeActual: false,
                    includeOnline: true,
                  },
                },
                windMonthWithActual: {
                  summary: 'Wind forecast + actual comparison',
                  value: {
                    product: 'Wind',
                    dateFrom: '2026-01-01',
                    dateTo: '2026-01-31',
                    includeActual: true,
                    includeOnline: true,
                  },
                },
                solarDayAhead: {
                  summary: 'Solar day-ahead forecast',
                  value: {
                    product: 'Solar',
                    dateFrom: '2026-02-08',
                    dateTo: '2026-02-08',
                    includeOnline: false,
                  },
                },
                relativeAlias: {
                  summary: 'Solar forecast for next 7 days using relative aliases',
                  value: { product: 'Solar', dateFrom: 'tomorrow', dateTo: 'today+7', includeOnline: true },
                },
                csvExport: {
                  summary: 'Export forecast as CSV',
                  value: { product: 'Solar', dateFrom: '2026-02-08', dateTo: '2026-02-14', format: 'csv' },
                },
              },
            },
          },
        },
        responses: {
          200: {
            description: 'Generation forecast data retrieved successfully',
            content: {
              'application/json': {
                schema: { type: 'object' },
              },
              ...FORMAT_RESPONSE_CONTENT,
            },
          },
        },
      },
      async handler(ctx) {
        const { format, ...mcpParams } = ctx.params;
        mcpParams.dateFrom = resolveDateAlias(mcpParams.dateFrom);
        mcpParams.dateTo = resolveDateAlias(mcpParams.dateTo);
        const result = await CernionMCPClient.callWithNewSession(
          'netztransparenz_forecast',
          mcpParams,
          ctx.meta.cernionToken
        );
        return applyFormat(ctx, result, format, 'grid-forecast', 'Forecast');
      },
    },

    /**
     * Redispatch measures and grid congestion analysis
     * Tool: netztransparenz_redispatch
     */
    redispatch: {
      rest: 'POST /redispatch',
      params: {
        dateFrom: { type: 'string' },
        dateTo: { type: 'string' },
        includeAnalysis: { type: 'boolean', optional: true, default: true },
        includeCurtailment: { type: 'boolean', optional: true, default: false },
        format: { type: 'enum', values: ['json', 'csv', 'xlsx', 'xls'], optional: true, default: 'json' },
      },
      openapi: {
        summary: 'Redispatch measures and grid congestion analysis',
        tags: ['German Grid Data'],
        description:
          'Grid congestion analysis, curtailment risk assessment, NEST project justification',
        requestBody: {
          required: true,
          content: {
            'application/json': {
              schema: {
                type: 'object',
                required: ['dateFrom', 'dateTo'],
                properties: {
                  dateFrom: {
                    type: 'string',
                    description: 'Start date. ISO format (YYYY-MM-DD) or relative alias: `today`, `today+N`, `today-N`, `tomorrow`, `yesterday`.',
                    example: 'today-30',
                  },
                  dateTo: {
                    type: 'string',
                    description: 'End date. ISO format (YYYY-MM-DD) or relative alias: `today`, `today+N`, `today-N`, `tomorrow`, `yesterday`.',
                    example: 'today',
                  },
                  includeAnalysis: {
                    type: 'boolean',
                    description: 'Include congestion analysis',
                    default: true,
                  },
                  includeCurtailment: {
                    type: 'boolean',
                    description: 'Include curtailment data',
                    default: false,
                  },
                  format: FORMAT_PARAM_SCHEMA,
                },
              },
              examples: {
                monthlyAnalysis: {
                  summary: 'Monthly redispatch analysis',
                  value: {
                    dateFrom: '2026-01-01',
                    dateTo: '2026-01-31',
                    includeAnalysis: true,
                    includeCurtailment: true,
                  },
                },
                quarterOverview: {
                  summary: 'Q1 congestion overview',
                  value: {
                    dateFrom: '2026-01-01',
                    dateTo: '2026-03-31',
                    includeAnalysis: true,
                    includeCurtailment: false,
                  },
                },
                weekCurtailment: {
                  summary: 'Weekly curtailment analysis',
                  value: {
                    dateFrom: '2026-02-01',
                    dateTo: '2026-02-07',
                    includeCurtailment: true,
                  },
                },
                relativeAlias: {
                  summary: 'Last 30 days using relative date alias',
                  value: { dateFrom: 'today-30', dateTo: 'today', includeAnalysis: true, includeCurtailment: true },
                },
                csvExport: {
                  summary: 'Export redispatch data as CSV',
                  value: { dateFrom: '2026-01-01', dateTo: '2026-01-31', format: 'csv' },
                },
              },
            },
          },
        },
        responses: {
          200: {
            description: 'Redispatch data retrieved successfully',
            content: {
              'application/json': {
                schema: { type: 'object' },
              },
              ...FORMAT_RESPONSE_CONTENT,
            },
          },
        },
      },
      async handler(ctx) {
        const { format, ...mcpParams } = ctx.params;
        mcpParams.dateFrom = resolveDateAlias(mcpParams.dateFrom);
        mcpParams.dateTo = resolveDateAlias(mcpParams.dateTo);
        const result = await CernionMCPClient.callWithNewSession(
          'netztransparenz_redispatch',
          mcpParams,
          ctx.meta.cernionToken
        );
        return applyFormat(ctx, result, format, 'redispatch', 'Redispatch');
      },
    },
  },
};
