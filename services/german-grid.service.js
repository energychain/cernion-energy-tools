/**
 * German Grid Data Service
 *
 * Official German grid operator data from Netztransparenz.de
 * Spotprices, redispatch, forecasts
 */

const CernionMCPClient = require('../src/mcp-client');

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
                    description: 'Start date (YYYY-MM-DD)',
                    example: '2026-02-01',
                  },
                  dateTo: {
                    type: 'string',
                    description: 'End date',
                    example: '2026-02-07',
                  },
                  includeStatistics: {
                    type: 'boolean',
                    description: 'Include price statistics (min/max/avg)',
                    default: true,
                  },
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
              },
            },
          },
        },
      },
      async handler(ctx) {
        return await CernionMCPClient.callWithNewSession(
          'netztransparenz_spotprices',
          ctx.params,
          ctx.meta.cernionToken
        );
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
                    description: 'Start date',
                    example: '2026-01-01',
                  },
                  dateTo: {
                    type: 'string',
                    description: 'End date',
                    example: '2026-01-31',
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
              },
            },
          },
        },
      },
      async handler(ctx) {
        const result = await CernionMCPClient.callWithNewSession(
          'netztransparenz_negative_prices',
          ctx.params,
          ctx.meta.cernionToken
        );

        // ── Data-reliability check ─────────────────────────────────────
        // Netztransparenz.de sometimes returns "no data" for historical
        // periods where data simply isn't available yet (not a genuine 0).
        // Flag this so consumers / Gemini interpretation can treat it correctly.
        const contentText = result?.data?.content?.[0]?.text || '';
        if (contentText.includes('No Negative Price Periods Found')) {
          const { dateFrom, dateTo } = ctx.params;
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
                    description: 'Start date',
                    example: '2026-02-01',
                  },
                  dateTo: {
                    type: 'string',
                    description: 'End date',
                    example: '2026-02-07',
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
              },
            },
          },
        },
      },
      async handler(ctx) {
        return await CernionMCPClient.callWithNewSession(
          'netztransparenz_forecast',
          ctx.params,
          ctx.meta.cernionToken
        );
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
                    description: 'Start date',
                    example: '2026-01-01',
                  },
                  dateTo: {
                    type: 'string',
                    description: 'End date',
                    example: '2026-01-31',
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
              },
            },
          },
        },
      },
      async handler(ctx) {
        return await CernionMCPClient.callWithNewSession(
          'netztransparenz_redispatch',
          ctx.params,
          ctx.meta.cernionToken
        );
      },
    },
  },
};
