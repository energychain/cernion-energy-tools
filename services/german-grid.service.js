/**
 * German Grid Data Service
 *
 * Official German grid operator data from Netztransparenz.de
 * Spotprices, redispatch, forecasts
 */

const CernionMCPClient = require('../src/mcp-client');
const {
  applyFormat,
  convertToCSV,
  FORMAT_PARAM_SCHEMA,
  FORMAT_RESPONSE_CONTENT,
} = require('../src/format-response');
const { resolveDateAlias } = require('../src/date-utils');

// ─── Helpers for redispatch text-narrative responses ──────────────────────────

/**
 * Extract the human-readable narrative text from a redispatch MCP result.
 */
function extractRedispatchText(result) {
  if (!result) return '';
  if (result.data && typeof result.data === 'object') {
    const content = result.data.content;
    if (Array.isArray(content) && content[0] && content[0].text) return content[0].text;
  }
  if (typeof result.data === 'string') return result.data;
  if (typeof result === 'string') return result;
  return '';
}

/**
 * Parse the narrative text from netztransparenz_redispatch.
 * Returns aggregated summary metadata (totalMeasures, totalEnergyMWh, highCongestion,
 * topReasons[]) — the MCP tool returns only a 10-row preview of individual measures,
 * so we expose the richer aggregated summary instead for CSV/XLSX consumers.
 */
function parseRedispatchMeasuresText(text) {
  const metadata = {};

  // Total measure count — try multiple patterns for resilience against MCP tool wording changes
  const foundMatch =
    text.match(/\*\*Found\*\*:\s*([\d,. ]+)\s*measures?/i) ||
    text.match(/Found\s*:\s*([\d,. ]+)\s*measures?/i);
  if (foundMatch) metadata.totalMeasures = parseInt(foundMatch[1].replace(/[,. ]/g, ''), 10);

  // Total energy — actual MCP tool may say "Total volume:" or "Total energy:" (probe varies)
  const energyMatch =
    text.match(/Total\s+(?:energy|volume)\s*:\s*([\d,. ]+)\s*MWh/i) ||
    text.match(/Gesamtvolumen\s*:\s*([\d,. ]+)\s*MWh/i) ||
    text.match(/Gesamtenergie\s*:\s*([\d,. ]+)\s*MWh/i);
  if (energyMatch) metadata.totalEnergyMWh = parseInt(energyMatch[1].replace(/[,. ]/g, ''), 10);

  metadata.highCongestion = /High grid congestion|⚠️.*congestion/i.test(text);

  // Parse top-reason lines: "  - Reason Name: 922805 MWh (73.9%)"
  const reasons = [];
  const reasonRegex = /^\s+-\s+(.+?):\s+([\d,. ]+)\s+MWh\s+\(([\d.]+)%\)/gm;
  let m;
  while ((m = reasonRegex.exec(text)) !== null) {
    reasons.push({
      reason: m[1].trim(),
      energyMWh: parseInt(m[2].replace(/[,. ]/g, ''), 10),
      sharePct: parseFloat(m[3]),
    });
  }
  metadata.topReasons = reasons;

  return { metadata };
}

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
        format: {
          type: 'enum',
          values: ['json', 'csv', 'xlsx', 'xls'],
          optional: true,
          default: 'json',
        },
      },
      openapi: {
        summary: 'German spotmarket prices (EPEX/EEX) for dynamic tariffs',
        tags: ['German Grid Data'],
        description:
          'Official data from Netztransparenz.de, OAuth2 authenticated. **Automatic ENTSO-E fallback**: when Netztransparenz.de has no data or returns an API error (e.g. for recent/future dates), the endpoint transparently retries with ENTSO-E day-ahead prices (hourly, DE bidding zone). The response is annotated with `data.fallback: true` and `data.fallbackSource: "entsoe_day_ahead_prices"` when the fallback is used.',
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
                    description:
                      'Start date. ISO format (YYYY-MM-DD) or relative alias: `today`, `today+N`, `today-N`, `tomorrow`, `yesterday`.',
                    example: 'today',
                  },
                  dateTo: {
                    type: 'string',
                    description:
                      'End date. ISO format (YYYY-MM-DD) or relative alias: `today`, `today+N`, `today-N`, `tomorrow`, `yesterday`.',
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
                  summary: "Today's prices using relative date alias",
                  value: { dateFrom: 'today', dateTo: 'today', includeStatistics: true },
                },
                recentWeek: {
                  summary: 'Last 7 days using relative aliases',
                  value: {
                    dateFrom: 'today-6',
                    dateTo: 'today',
                    includeStatistics: true,
                    format: 'csv',
                  },
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

        let result = await CernionMCPClient.callWithNewSession(
          'netztransparenz_spotprices',
          mcpParams,
          ctx.meta.cernionToken
        );

        // ── ENTSO-E fallback ────────────────────────────────────────
        // Netztransparenz.de has data only up to ~4 days ago and can return
        // API 500s during outages. When the primary source fails, retry with
        // ENTSO-E day-ahead prices (hourly, DE bidding zone).
        // Note: ENTSO-E provides hourly values; Netztransparenz 15-min values.
        if (result?.data?.isError === true) {
          const primaryError =
            result?.data?.content?.[0]?.text || 'Netztransparenz.de returned an error';
          let combinedError = null;
          try {
            const fallbackResult = await CernionMCPClient.callWithNewSession(
              'entsoe_day_ahead_prices',
              {
                region: 'Deutschland',
                dateFrom: mcpParams.dateFrom,
                dateTo: mcpParams.dateTo,
                includeStatistics: mcpParams.includeStatistics ?? true,
              },
              ctx.meta.cernionToken
            );
            if (fallbackResult?.data?.isError !== true) {
              // Annotate so callers know this is fallback data
              if (fallbackResult?.data?.content?.[0]?.text !== undefined) {
                fallbackResult.data.content[0].text =
                  `⚠️ **Datenquelle: ENTSO-E (Fallback)** ` +
                  `(Netztransparenz.de nicht verfügbar: ${primaryError})\n` +
                  `_Hinweis: ENTSO-E liefert Stundenwerte (Day-Ahead), Netztransparenz 15-Minuten-Werte._\n\n` +
                  fallbackResult.data.content[0].text;
              }
              fallbackResult.data = {
                ...(fallbackResult.data || {}),
                fallback: true,
                fallbackSource: 'entsoe_day_ahead_prices',
                primaryError,
              };
              result = fallbackResult;
            } else {
              // Both sources failed — build combined error outside try/catch
              const entsoeError =
                fallbackResult?.data?.content?.[0]?.text || 'ENTSO-E returned an error';
              combinedError =
                `Beide Datenquellen nicht verfügbar.\n` +
                `Netztransparenz.de: ${primaryError}\n` +
                `ENTSO-E Fallback: ${entsoeError}`;
            }
          } catch {
            // ENTSO-E call itself threw — keep original isError result so
            // applyFormat surfaces the primary error.
          }
          if (combinedError) throw new Error(combinedError);
        }

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
        format: {
          type: 'enum',
          values: ['json', 'csv', 'xlsx', 'xls'],
          optional: true,
          default: 'json',
        },
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
                    description:
                      'Start date. ISO format (YYYY-MM-DD) or relative alias: `today`, `today+N`, `today-N`, `tomorrow`, `yesterday`.',
                    example: 'today-30',
                  },
                  dateTo: {
                    type: 'string',
                    description:
                      'End date. ISO format (YYYY-MM-DD) or relative alias: `today`, `today+N`, `today-N`, `tomorrow`, `yesterday`.',
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
                  format: FORMAT_PARAM_SCHEMA,
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
                csvExport: {
                  summary: 'Export negative price periods as CSV (Power Automate)',
                  value: {
                    dateFrom: 'today-30',
                    dateTo: 'today',
                    logic: 6,
                    includeEegCompliance: true,
                    format: 'csv',
                  },
                },
              },
            },
          },
        },
        responses: {
          200: {
            description: 'Negative price analysis retrieved successfully',
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
        const { format, ...rawParams } = ctx.params;
        const resolvedParams = {
          ...rawParams,
          dateFrom: resolveDateAlias(rawParams.dateFrom),
          dateTo: resolveDateAlias(rawParams.dateTo),
        };
        const result = await CernionMCPClient.callWithNewSession(
          'netztransparenz_negative_prices',
          resolvedParams,
          ctx.meta.cernionToken
        );

        // ── Upstream error check ───────────────────────────────────────
        // Surface tool-level errors so callers get a real HTTP 500 with a
        // message, not a silent empty/misleading JSON response.
        if (result?.data?.isError === true) {
          const errorText =
            result?.data?.content?.[0]?.text || 'Upstream tool returned an error with no details';
          throw new Error(errorText);
        }

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

        // ── Format: CSV / XLSX ────────────────────────────────────────
        // The MCP tool returns a narrative text block, not a data table.
        // For CSV/XLSX consumers (e.g. Power Automate) we produce one row
        // per result with the key fields and the full analysis text.
        if (format && format !== 'json') {
          const customRows = [
            {
              dateFrom: resolvedParams.dateFrom,
              dateTo: resolvedParams.dateTo,
              logic: resolvedParams.logic ?? 6,
              includeEegCompliance: resolvedParams.includeEegCompliance ?? true,
              analysis: result?.data?.content?.[0]?.text ?? '',
              dataReliabilityWarning: result?.data?.dataReliabilityWarning ?? false,
            },
          ];
          return applyFormat(ctx, result, format, 'negative-prices', 'NegativePrices', customRows);
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
        format: {
          type: 'enum',
          values: ['json', 'csv', 'xlsx', 'xls'],
          optional: true,
          default: 'json',
        },
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
                    description:
                      'Start date. ISO format (YYYY-MM-DD) or relative alias: `today`, `today+N`, `today-N`, `tomorrow`, `yesterday`.',
                    example: 'tomorrow',
                  },
                  dateTo: {
                    type: 'string',
                    description:
                      'End date. ISO format (YYYY-MM-DD) or relative alias: `today`, `today+N`, `today-N`, `tomorrow`, `yesterday`.',
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
                  value: {
                    product: 'Solar',
                    dateFrom: 'tomorrow',
                    dateTo: 'today+7',
                    includeOnline: true,
                  },
                },
                csvExport: {
                  summary: 'Export forecast as CSV',
                  value: {
                    product: 'Solar',
                    dateFrom: '2026-02-08',
                    dateTo: '2026-02-14',
                    format: 'csv',
                  },
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
        format: {
          type: 'enum',
          values: ['json', 'csv', 'xlsx', 'xls'],
          optional: true,
          default: 'json',
        },
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
                    description:
                      'Start date. ISO format (YYYY-MM-DD) or relative alias: `today`, `today+N`, `today-N`, `tomorrow`, `yesterday`.',
                    example: 'today-30',
                  },
                  dateTo: {
                    type: 'string',
                    description:
                      'End date. ISO format (YYYY-MM-DD) or relative alias: `today`, `today+N`, `today-N`, `tomorrow`, `yesterday`.',
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
                  value: {
                    dateFrom: 'today-30',
                    dateTo: 'today',
                    includeAnalysis: true,
                    includeCurtailment: true,
                  },
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

        // Guard: null / error result from MCP tool
        if (!result) {
          throw new Error(
            `No redispatch data returned for ${mcpParams.dateFrom} – ${mcpParams.dateTo}`
          );
        }
        if (result.success === false) {
          const errMsg =
            result.error?.message ||
            result.data?.content?.[0]?.text ||
            'Upstream tool returned an error';
          throw new Error(errMsg);
        }

        // Guard: MCP-level error flag (isError: true) — e.g. Netztransparenz API 500
        if (result.data?.isError) {
          const errText = extractRedispatchText(result);
          throw new Error(
            errText
              .replace(/^[❌\s*⚡]+/, '')
              .trim()
              .substring(0, 300) || 'Netztransparenz API error'
          );
        }

        // CSV / XLSX: the MCP tool returns a 10-row preview with all rows sharing
        // the same timestamp (first time slot of the period). Instead of exposing
        // that misleading preview, we return a single aggregated SUMMARY row per
        // API call — identical to the negativePrices approach.
        // For monthly trend analysis in PowerBI: call with monthly date ranges.
        if (format === 'csv' || format === 'xlsx' || format === 'xls') {
          const text = extractRedispatchText(result);
          const { metadata } = parseRedispatchMeasuresText(text);
          const r = metadata.topReasons || [];

          const summaryRow = {
            dateFrom: mcpParams.dateFrom,
            dateTo: mcpParams.dateTo,
            totalMeasures: metadata.totalMeasures ?? null,
            totalEnergyMWh: metadata.totalEnergyMWh ?? null,
            highCongestion: metadata.highCongestion ?? false,
            topReason1: r[0]?.reason ?? '',
            topReason1MWh: r[0]?.energyMWh ?? null,
            topReason1PctStr: r[0] != null ? `${r[0].sharePct}%` : '',
            topReason2: r[1]?.reason ?? '',
            topReason2MWh: r[1]?.energyMWh ?? null,
            topReason2PctStr: r[1] != null ? `${r[1].sharePct}%` : '',
            topReason3: r[2]?.reason ?? '',
            topReason3MWh: r[2]?.energyMWh ?? null,
            topReason3PctStr: r[2] != null ? `${r[2].sharePct}%` : '',
            source: 'Netztransparenz.de',
          };

          const preambleLines = [
            '# Redispatch Measures Export',
            `# Period: ${mcpParams.dateFrom} to ${mcpParams.dateTo}`,
            ...(metadata.totalMeasures != null
              ? [`# Total Measures: ${metadata.totalMeasures}`]
              : []),
            ...(metadata.totalEnergyMWh != null
              ? [`# Total Energy: ${metadata.totalEnergyMWh} MWh`]
              : []),
            `# Generated: ${new Date().toISOString()}`,
            '# Note: Aggregated summary per period. For monthly trend analysis',
            '#       call with monthly date ranges (e.g. 2026-01-01 to 2026-01-31).',
          ];
          const preamble = preambleLines.join('\n');

          if (format === 'csv') {
            ctx.meta.$responseHeaders = {
              'Content-Type': 'text/csv; charset=utf-8',
              'Content-Disposition': `attachment; filename="redispatch-${Date.now()}.csv"`,
            };
            return `${preamble}\n${convertToCSV([summaryRow])}`;
          }
          // xlsx / xls
          return applyFormat(ctx, result, format, 'redispatch', 'Redispatch', [summaryRow]);
        }

        return applyFormat(ctx, result, format, 'redispatch', 'Redispatch');
      },
    },
  },
};
