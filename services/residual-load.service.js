/**
 * Residual Load Service
 *
 * Net residual load calculation and regional load forecasting
 * - mastr_net_residual_load: real SMARD × population scaling + MaStR EE capacity + Visual Crossing weather
 * - cernion_load_forecast_regional: LLM-based load forecast with real MaStR capacity anchors
 */

const CernionMCPClient = require('../src/mcp-client');
const XLSX = require('xlsx');

module.exports = {
  name: 'residual-load',

  settings: {
    defaultTimeout: 120000, // 2 minutes — SMARD + MaStR + weather API calls
  },

  actions: {
    /**
     * Net residual load = Regional load − PV − Wind (real data)
     * Tool: mastr_net_residual_load
     *
     * Data sources: SMARD.de (national load × population ratio),
     * MaStR installed capacity, Visual Crossing weather forecast (IEC 61853/61400).
     */
    netResidualLoad: {
      rest: 'POST /net-residual-load',
      params: {
        region: { type: 'string', optional: true, min: 1 },
        bundesland: { type: 'string', optional: true },
        landkreis: { type: 'string', optional: true },
        gemeinde: { type: 'string', optional: true },
        postleitzahl: { type: 'string', optional: true },
        latitude: { type: 'number', optional: true, convert: true },
        longitude: { type: 'number', optional: true, convert: true },
        gridOperatorMastrId: { type: 'string', optional: true },
        populationOverride: { type: 'number', optional: true, min: 1, convert: true },
        forecastDays: {
          type: 'number',
          optional: true,
          min: 1,
          max: 14,
          default: 1,
          convert: true,
        },
        resolution: {
          type: 'enum',
          values: ['hourly', 'hour', '15min'],
          optional: true,
          default: 'hourly',
        },
        installationType: {
          type: 'enum',
          values: ['solar', 'wind', 'all'],
          optional: true,
          default: 'all',
        },
        startDate: {
          type: 'string',
          optional: true,
          pattern: /^[0-9]{4}-[0-9]{2}-[0-9]{2}$/,
          description:
            'Optional start date (YYYY-MM-DD). Defaults to tomorrow. Past dates use SMARD filter 410 (realised load) and observed weather data.',
        },
        format: { type: 'enum', values: ['json', 'csv', 'xlsx'], optional: true, default: 'json' },
      },
      openapi: {
        summary: 'Net residual load forecast (SMARD load − MaStR EE generation)',
        tags: ['Residual Load'],
        description: `Calculates **net residual load** for a grid area or region — the electricity volume a Stadtwerk or EVU must procure on the EPEX spot market:

**Residual Load = Regional Load − PV Generation − Wind Generation**

**Data sources (all real API data, no LLM estimates):**
- **Regional load**: SMARD.de national load × population ratio (no API key required)
- **PV generation**: MaStR installed capacity × IEC 61853 solar model + Visual Crossing weather
- **Wind generation**: MaStR installed capacity × IEC 61400 wind model + Visual Crossing weather

**Time resolutions:**
- \`"hourly"\` (default): 24 data points/day — intraday dispatch planning, trading
- \`"15min"\`: 96 data points/day — §12 StromNZV Fahrplanlieferung and Bilanzkreisabrechnung

**SMARD data availability:**
| Period | Source | isActualData |
|--------|--------|--------------|
| Past/today | Filter 410 (realised, ~1h delay) | true |
| D+1 | Filter 411 (day-ahead TSO forecast) | true |
| D+2–D+14 | Filter 410, reference week −7 days | false |

**⚠️ Known limitations:**
- Load is approximated via population ratio — good for residential/SME, not large industrial consumers
- Use \`populationOverride\` for known population figures (improves scaling accuracy)
- EE accuracy ±10–20 % depending on weather forecast quality (degrades D+3 and beyond)
**Historical mode (\`startDate\` in the past):**
- SMARD automatically switches to filter 410 (realised load, no extra parameter needed)
- Visual Crossing returns observed weather instead of a forecast — identical IEC calculation
- Response gains \`summary.isHistorical: true\` and \`summary.dataMode: "historical_observation"\`
- Historical responses are cached for **30 days** (immutable data, no additional API quota)
**Use cases:**
- **Day-ahead procurement**: Determine how much to buy on EPEX (residual load = required purchase)
- **Intraday management**: Hourly/15-min profile for dispatch optimisation
- **Grid planning**: Identify peak residual load periods for capacity planning
- **Billing groups (§12 StromNZV)**: 15-min Fahrplan delivery to TSO/DSO`,
        requestBody: {
          required: true,
          content: {
            'application/json': {
              schema: {
                type: 'object',
                required: [],
                properties: {
                  region: {
                    type: 'string',
                    description:
                      'City or region name for SMARD population scaling (e.g. "Ludwigshafen", "Bayern", "Heidelberg")',
                    example: 'Ludwigshafen',
                  },
                  gridOperatorMastrId: {
                    type: 'string',
                    description:
                      'MaStR Netzbetreiber-ID (SNB/GNB...) for EE capacity query. Resolve via cernion_vnb_lookup.',
                    example: 'SNB935578300972',
                  },
                  bundesland: {
                    type: 'string',
                    description: 'Federal state',
                    example: 'Rheinland-Pfalz',
                  },
                  landkreis: {
                    type: 'string',
                    description: 'Landkreis name',
                    example: 'Ludwigshafen am Rhein',
                  },
                  gemeinde: {
                    type: 'string',
                    description: 'Municipality name',
                    example: 'Ludwigshafen',
                  },
                  postleitzahl: {
                    type: 'string',
                    pattern: '^[0-9]{5}$',
                    description: '5-digit postal code',
                    example: '67059',
                  },
                  latitude: {
                    type: 'number',
                    description: 'Latitude for weather data',
                    example: 49.4744,
                  },
                  longitude: {
                    type: 'number',
                    description: 'Longitude for weather data',
                    example: 8.4349,
                  },
                  populationOverride: {
                    type: 'number',
                    description:
                      'Known population of the grid area. Overrides internal lookup. Important for industrial locations (e.g. BASF/Ludwigshafen).',
                    example: 170000,
                  },
                  forecastDays: {
                    type: 'number',
                    minimum: 1,
                    maximum: 14,
                    default: 1,
                    description: 'Number of forecast days (1–14)',
                    example: 1,
                  },
                  resolution: {
                    type: 'string',
                    enum: ['hourly', 'hour', '15min'],
                    default: 'hourly',
                    description:
                      '`"hourly"` / `"hour"` = 24 pts/day (trading); `"15min"` = 96 pts/day (§12 StromNZV Fahrplan). `"hour"` is accepted as an alias for `"hourly"`.',
                    example: 'hourly',
                  },
                  installationType: {
                    type: 'string',
                    enum: ['solar', 'wind', 'all'],
                    default: 'all',
                    description: 'Which EE types to subtract from load',
                    example: 'all',
                  },
                  startDate: {
                    type: 'string',
                    pattern: '^[0-9]{4}-[0-9]{2}-[0-9]{2}$',
                    description:
                      'Optional start date (YYYY-MM-DD). Omit for default tomorrow behaviour. Past dates switch to historical observation mode: SMARD filter 410 (realised) + observed weather, 30-day cache.',
                    example: '2026-02-10',
                  },
                  format: {
                    type: 'string',
                    enum: ['json', 'csv', 'xlsx'],
                    default: 'json',
                    description: 'Output format',
                    example: 'json',
                  },
                },
              },
              examples: {
                dayAheadProcurement: {
                  summary: 'TWL day-ahead procurement (15-min, tomorrow)',
                  value: {
                    region: 'Ludwigshafen',
                    gridOperatorMastrId: 'SNB935578300972',
                    forecastDays: 1,
                    resolution: '15min',
                    installationType: 'all',
                  },
                },
                weeklyBavaria: {
                  summary: 'Weekly residual load for Bavaria (hourly)',
                  value: {
                    region: 'Bayern',
                    bundesland: 'Bayern',
                    forecastDays: 7,
                    resolution: 'hourly',
                  },
                },
                industrialSite: {
                  summary: 'Industrial site with known population override',
                  value: {
                    region: 'Mannheim',
                    populationOverride: 320000,
                    forecastDays: 2,
                    resolution: '15min',
                  },
                },
                csvExport: {
                  summary: 'Download residual load profile as CSV',
                  value: {
                    region: 'Heidelberg',
                    postleitzahl: '69115',
                    forecastDays: 1,
                    resolution: 'hourly',
                    format: 'csv',
                  },
                },
                xlsxExport: {
                  summary: 'Download residual load profile as Excel',
                  value: {
                    region: 'Bayern',
                    bundesland: 'Bayern',
                    forecastDays: 3,
                    resolution: '15min',
                    format: 'xlsx',
                  },
                },
                historicalResidualLoad: {
                  summary: 'Historical residual load analysis (past date, realised SMARD data)',
                  value: {
                    region: 'Ludwigshafen',
                    gridOperatorMastrId: 'SNB935578300972',
                    startDate: '2026-02-10',
                    forecastDays: 7,
                    resolution: 'hourly',
                  },
                },
              },
            },
          },
        },
        responses: {
          200: {
            description: 'Residual load forecast generated successfully',
            content: {
              'application/json': {
                schema: {
                  type: 'object',
                  properties: {
                    summary: {
                      type: 'object',
                      properties: {
                        region: { type: 'string', example: 'Ludwigshafen' },
                        isHistorical: {
                          type: 'boolean',
                          description:
                            'true when startDate is in the past (SMARD filter 410 + observed weather used)',
                          example: false,
                        },
                        dataMode: {
                          type: 'string',
                          enum: ['weather_forecast', 'historical_observation'],
                          description:
                            '"weather_forecast" for future dates, "historical_observation" for past dates',
                          example: 'weather_forecast',
                        },
                        forecastPeriod: {
                          type: 'object',
                          properties: {
                            start: { type: 'string', format: 'date-time' },
                            end: { type: 'string', format: 'date-time' },
                          },
                        },
                        resolution: { type: 'string', example: 'hourly' },
                        dataPoints: { type: 'number', example: 24 },
                        installedCapacity: {
                          type: 'object',
                          properties: {
                            totalPV_MW: { type: 'number', example: 42.7 },
                            totalWind_MW: { type: 'number', example: 8.1 },
                            pvInstallations: { type: 'number', example: 1203 },
                            windInstallations: { type: 'number', example: 12 },
                          },
                        },
                        loadScaling: {
                          type: 'object',
                          properties: {
                            populationUsed: { type: 'string', example: '170.000' },
                            scalingFactorPct: { type: 'string', example: '0.202%' },
                            isActualData: { type: 'boolean', example: true },
                            dataSource: { type: 'string', example: 'SMARD filter 410 (realized)' },
                          },
                        },
                        kpis: {
                          type: 'object',
                          properties: {
                            peakResidualLoadMW: { type: 'number', example: 87.4 },
                            peakResidualAt: { type: 'string', format: 'date-time' },
                            minResidualLoadMW: { type: 'number', example: 31.2 },
                            avgResidualLoadMW: { type: 'number', example: 58.9 },
                            totalLoadMWh: { type: 'number', example: 1413.6 },
                            totalEEGenerationMWh: { type: 'number', example: 38.2 },
                            totalResidualLoadMWh: { type: 'number', example: 1375.4 },
                            avgEESharePct: { type: 'number', example: 2.7 },
                          },
                        },
                      },
                    },
                    forecast: {
                      type: 'array',
                      items: {
                        type: 'object',
                        properties: {
                          timestamp: { type: 'string', format: 'date-time' },
                          loadMW: { type: 'number', description: 'Regional load in MW' },
                          pvGenerationMW: { type: 'number', description: 'PV generation in MW' },
                          windGenerationMW: {
                            type: 'number',
                            description: 'Wind generation in MW',
                          },
                          eeGenerationMW: {
                            type: 'number',
                            description: 'Total EE generation in MW',
                          },
                          residualLoadMW: {
                            type: 'number',
                            description: 'Net residual load in MW (= loadMW − eeGenerationMW)',
                          },
                          eeSharePct: {
                            type: 'number',
                            description: 'EE share of total load in %',
                          },
                        },
                      },
                    },
                    methodology: {
                      type: 'object',
                      properties: {
                        loadModel: { type: 'string' },
                        eeModel: { type: 'string' },
                        residualFormula: {
                          type: 'string',
                          example: 'Residuallast = RegionaleLast − PV − Wind',
                        },
                        interpolation: { type: 'string' },
                      },
                    },
                  },
                },
              },
              'text/csv': {
                description: 'CSV with metadata comments (when format=csv)',
                example:
                  '# Net Residual Load Forecast\n# Region: Ludwigshafen\nTimestamp,Load (MW),PV Generation (MW),Wind Generation (MW),EE Generation (MW),Residual Load (MW),EE Share (%)',
              },
              'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet': {
                description: 'Excel XLSX with Forecast + Summary sheets (when format=xlsx)',
                schema: { type: 'string', format: 'binary' },
              },
            },
          },
          400: {
            description: 'Invalid request parameters',
            content: {
              'application/json': {
                example: {
                  success: false,
                  error: { code: 'RESIDUAL_LOAD_ERROR', message: 'region is required' },
                },
              },
            },
          },
        },
      },
      async handler(ctx) {
        try {
          const {
            format,
            bundesland,
            landkreis,
            gemeinde,
            postleitzahl,
            latitude,
            longitude,
            startDate,
            ...rest
          } = ctx.params;

          // Normalise resolution alias: 'hour' → 'hourly'
          if (rest.resolution === 'hour') rest.resolution = 'hourly';

          const locationObj = this.buildLocationObj({
            bundesland,
            landkreis,
            gemeinde,
            postleitzahl,
            latitude,
            longitude,
          });
          const mcpParams = { ...rest };
          if (startDate) mcpParams.startDate = startDate;
          if (Object.keys(locationObj).length > 0) {
            mcpParams.location = locationObj;
          }

          // Auto-derive region for SMARD population scaling when the caller
          // omitted region.  Priority order:
          //  1. gemeinde / landkreis / bundesland from request params
          //  2. Lookup one sample installation from cernion_installations_local
          //     using gridOperatorMastrId and extract its municipality
          //  3. Return a structured error (never pass undefined to the MCP tool —
          //     mastr_net_residual_load calls .toLowerCase() on region and crashes)
          if (!mcpParams.region) {
            const locationDerived = gemeinde || landkreis || bundesland;
            if (locationDerived) {
              mcpParams.region = locationDerived;
              this.logger.warn(
                `residual-load: region not provided; auto-derived from location fields: "${locationDerived}"`
              );
            } else if (mcpParams.gridOperatorMastrId) {
              const lookedUpRegion = await this.resolveRegionFromOperatorId(
                mcpParams.gridOperatorMastrId,
                ctx.meta.cernionToken
              );
              if (lookedUpRegion) {
                mcpParams.region = lookedUpRegion;
                this.logger.info(
                  `residual-load: region auto-derived from operator ${mcpParams.gridOperatorMastrId}: "${lookedUpRegion}"`
                );
              } else {
                this.logger.warn(
                  `residual-load: could not resolve region for operator ${mcpParams.gridOperatorMastrId} — returning structured error.`
                );
                return {
                  success: false,
                  error: {
                    code: 'RESIDUAL_LOAD_MISSING_REGION',
                    message:
                      `Could not auto-derive region for gridOperatorMastrId "${mcpParams.gridOperatorMastrId}". ` +
                      'Please provide a region name (city, Landkreis, or Bundesland) explicitly.',
                  },
                };
              }
            } else {
              this.logger.warn(
                'residual-load.netResidualLoad called without region or any location field — ' +
                  'returning structured error to avoid MCP crash.'
              );
              return {
                success: false,
                error: {
                  code: 'RESIDUAL_LOAD_MISSING_REGION',
                  message:
                    'region is required for SMARD population scaling. ' +
                    'Provide a region name (city, Landkreis, or Bundesland), ' +
                    'gridOperatorMastrId, or a location field (bundesland, landkreis, gemeinde, postleitzahl). ' +
                    'For single-installation forecasts use forecast.generationForecast instead.',
                },
              };
            }
          }

          let result = await CernionMCPClient.callWithNewSession(
            'mastr_net_residual_load',
            mcpParams,
            ctx.meta.cernionToken
          );

          // Detect MCP tool error returned as text content (e.g. "Error: Cannot read...").
          // The MCP client wraps tool errors as { data: [{ type: 'text', text: 'Error: ...' }] }.
          if (
            Array.isArray(result?.data) &&
            result.data[0]?.type === 'text' &&
            result.data[0]?.text?.startsWith('Error:')
          ) {
            throw new Error(result.data[0].text);
          }

          // Detect all-zero loadMW — SMARD filter 411 (day-ahead load forecast) is only
          // published by the German TSOs once per day (typically after ~14:00 CET). Before
          // publication the file contains `null` values which the MCP tool maps to 0.
          // Fix: automatically retry with startDate = D-7 (same weekday, reference week)
          // which uses SMARD filter 410 (realised load) — always available.
          // The D-7 reference week is also what the MCP tool uses internally for D+2–D+14
          // requests, so this is consistent with the documented fallback strategy.
          if (result && Array.isArray(result.forecast) && result.forecast.length > 0) {
            const allZeroLoad = result.forecast.every((p) => (p.loadMW ?? 0) === 0);
            if (allZeroLoad) {
              // Compute intended start date (tomorrow when no startDate given)
              const intendedStartStr =
                startDate ||
                (() => {
                  const d = new Date();
                  d.setDate(d.getDate() + 1);
                  return d.toISOString().split('T')[0];
                })();
              const intendedStart = new Date(intendedStartStr);
              const today = new Date();
              today.setHours(0, 0, 0, 0);

              if (intendedStart >= today) {
                // Future/today date with null load → filter 411 not yet published.
                // Retry with D-7 (same weekday, realised load via filter 410).
                const fallbackDate = new Date(intendedStart);
                fallbackDate.setDate(fallbackDate.getDate() - 7);
                const fallbackDateStr = fallbackDate.toISOString().split('T')[0];

                this.logger.warn(
                  `residual-load: SMARD filter 411 returned null for "${intendedStartStr}" ` +
                    `(day-ahead forecast not yet published). ` +
                    `Retrying with D-7 reference week startDate="${fallbackDateStr}".`
                );

                const fallbackResult = await CernionMCPClient.callWithNewSession(
                  'mastr_net_residual_load',
                  { ...mcpParams, startDate: fallbackDateStr },
                  ctx.meta.cernionToken
                );

                const fallbackHasLoad =
                  Array.isArray(fallbackResult?.forecast) &&
                  fallbackResult.forecast.some((p) => (p.loadMW ?? 0) > 0);

                if (fallbackHasLoad) {
                  result = fallbackResult;
                  result.loadFallbackWarning = true;
                  result.loadFallbackNote =
                    `SMARD filter 411 (day-ahead load forecast) not yet published for ${intendedStartStr}. ` +
                    `Load and generation data use reference week ${fallbackDateStr} (same weekday, D-7) ` +
                    `via SMARD filter 410 (realised load). ` +
                    `Re-request after ~14:00 CET for the actual day-ahead load forecast.`;
                } else {
                  // D-7 fallback also failed — surface the original warning
                  result.dataQualityWarning = true;
                  result.dataQualityMessage =
                    `SMARD load data unavailable for both "${intendedStartStr}" and D-7 reference week "${fallbackDateStr}". ` +
                    'Provide "populationOverride" with the known population of the grid area.';
                }
              } else {
                // Historical date with all-zero load → population scaling issue
                result.dataQualityWarning = true;
                result.dataQualityMessage =
                  'SMARD population scaling returned loadMW=0 for all forecast points. ' +
                  'The region may not be found in the SMARD population database. ' +
                  'Provide "populationOverride" with the city\'s known population (e.g. 247000 for Kiel) to fix scaling.';
              }
            }
          }

          if (format === 'csv') {
            return this.handleCsvResponse(ctx, result?.forecast || [], result?.summary);
          }

          if (format === 'xlsx') {
            return this.handleXlsxResponse(
              ctx,
              result?.forecast || [],
              result?.summary,
              result?.methodology
            );
          }

          return result;
        } catch (error) {
          this.logger.error('Net residual load failed:', error);
          return {
            success: false,
            error: {
              code: 'RESIDUAL_LOAD_ERROR',
              message: error.message || 'Failed to calculate residual load',
            },
          };
        }
      },
    },

    /**
     * Regional load forecast (LLM-based with real MaStR capacity anchors)
     * Tool: cernion_load_forecast_regional
     *
     * Unlike mastr_net_residual_load, this tool uses LLM reasoning anchored to real
     * installed capacity from MaStR and SMARD population scaling. Returns a structured
     * analysis with load profile, procurement recommendations, and AI reasoning.
     * MaStR data injection is transparent — parameter interface is unchanged.
     */
    loadForecastRegional: {
      rest: 'POST /load-forecast-regional',
      params: {
        region: { type: 'string', optional: true, min: 1 },
        forecastDays: { type: 'number', optional: true, min: 1, max: 7, default: 1, convert: true },
        populationOverride: { type: 'number', optional: true, min: 1, convert: true },
        gridOperatorMastrId: { type: 'string', optional: true },
        bundesland: { type: 'string', optional: true },
        postleitzahl: { type: 'string', optional: true },
        additionalContext: { type: 'string', optional: true },
      },
      openapi: {
        summary: 'Regional load forecast with LLM reasoning and real MaStR capacity anchors',
        tags: ['Residual Load'],
        description: `LLM-based regional load forecast enriched with **real MaStR installation data** injected into the reasoning prompt.

**What is real vs. LLM-estimated:**
| Component | Data source |
|-----------|-------------|
| Installed PV capacity (MW, installation count) | MaStR (real) |
| Installed wind capacity (MW, installation count) | MaStR (real) |
| SMARD population scaling factor | SMARD.de (real) |
| Load profile shape, calendar effects, procurement recommendation | LLM reasoning |

**Graceful degradation:** If MaStR queries time out, the tool falls back to placeholder values and the LLM call still completes.

**Use cases:**
- Stadtwerk procurement planning with natural-language recommendations
- KPI summaries for management dashboards
- When full hour-by-hour time-series (see \`netResidualLoad\`) is not needed`,
        requestBody: {
          required: true,
          content: {
            'application/json': {
              schema: {
                type: 'object',
                required: [],
                properties: {
                  region: {
                    type: 'string',
                    description: 'City or region name',
                    example: 'Mannheim',
                  },
                  forecastDays: {
                    type: 'number',
                    minimum: 1,
                    maximum: 7,
                    default: 1,
                    description: 'Number of days to forecast (1–7)',
                    example: 1,
                  },
                  populationOverride: {
                    type: 'number',
                    description:
                      'Known population of the grid area. Improves load scaling accuracy.',
                    example: 320000,
                  },
                  gridOperatorMastrId: {
                    type: 'string',
                    description: 'MaStR Netzbetreiber-ID for EE capacity lookup',
                    example: 'SNB935578300972',
                  },
                  bundesland: {
                    type: 'string',
                    description: 'Federal state for MaStR capacity query',
                    example: 'Baden-Württemberg',
                  },
                  postleitzahl: {
                    type: 'string',
                    description: '5-digit postal code for MaStR capacity query',
                    example: '68159',
                  },
                  additionalContext: {
                    type: 'string',
                    description:
                      'Extra context for the LLM (e.g. "large BASF industrial plant in area")',
                    example: 'Large chemical plant (BASF) adds ~200 MW industrial base load',
                  },
                },
              },
              examples: {
                dayAheadMannheim: {
                  summary: 'Day-ahead load forecast for Mannheim',
                  value: {
                    region: 'Mannheim',
                    populationOverride: 320000,
                    forecastDays: 1,
                  },
                },
                weeklyWithOperator: {
                  summary: '3-day forecast for a grid operator area',
                  value: {
                    region: 'Ludwigshafen',
                    gridOperatorMastrId: 'SNB935578300972',
                    forecastDays: 3,
                  },
                },
                industrialContext: {
                  summary: 'Industrial site with additional LLM context',
                  value: {
                    region: 'Ludwigshafen',
                    populationOverride: 170000,
                    additionalContext:
                      'Large chemical plant (BASF) adds ~200 MW industrial base load',
                    forecastDays: 1,
                  },
                },
              },
            },
          },
        },
        responses: {
          200: {
            description: 'Load forecast generated successfully',
            content: {
              'application/json': {
                schema: {
                  type: 'object',
                  properties: {
                    success: { type: 'boolean', example: true },
                    data: {
                      type: 'object',
                      description:
                        'LLM-generated load forecast analysis with real MaStR capacity anchors',
                    },
                  },
                },
              },
            },
          },
        },
      },
      async handler(ctx) {
        try {
          const { bundesland, postleitzahl, ...rest } = ctx.params;

          const locationObj = this.buildLocationObj({ bundesland, postleitzahl });
          const mcpParams = { ...rest };
          if (Object.keys(locationObj).length > 0) {
            mcpParams.location = locationObj;
          }

          const result = await CernionMCPClient.callWithNewSession(
            'cernion_load_forecast_regional',
            mcpParams,
            ctx.meta.cernionToken
          );

          return result;
        } catch (error) {
          this.logger.error('Regional load forecast failed:', error);
          return {
            success: false,
            error: {
              code: 'LOAD_FORECAST_ERROR',
              message: error.message || 'Failed to generate load forecast',
            },
          };
        }
      },
    },
  },

  methods: {
    /**
     * Fetch one sample installation for the given grid operator from the local
     * MaStR database and return its municipality as a region name.
     *
     * Used to auto-populate `region` when the caller provides only
     * `gridOperatorMastrId` — avoids requiring two separate parameters for
     * what is essentially the same piece of information.
     *
     * @param {string} operatorMastrId - MaStR Netzbetreiber-ID (SNB/GNB...)
     * @param {string|null} token      - Bearer token forwarded to MCP
     * @returns {Promise<string|null>}  Region string or null if unresolvable
     */
    async resolveRegionFromOperatorId(operatorMastrId, token) {
      // MaStR stores bundesland as a numeric catalog code (e.g. "1410"), never as a
      // text name.  SMARD only accepts text names ("Rheinland-Pfalz", "Bayern", …),
      // so we translate the code with this lookup table.
      // Codes verified empirically via live cernion_installations_local probes across
      // all 16 Bundesländer (2025-07).
      const BUNDESLAND_CODES = {
        1400: 'Brandenburg',
        1401: 'Berlin',
        1402: 'Baden-Württemberg',
        1403: 'Bayern',
        1404: 'Bremen',
        1405: 'Hessen',
        1406: 'Hamburg',
        1407: 'Mecklenburg-Vorpommern',
        1408: 'Niedersachsen',
        1409: 'Nordrhein-Westfalen',
        1410: 'Rheinland-Pfalz',
        1411: 'Schleswig-Holstein',
        1412: 'Saarland',
        1413: 'Sachsen',
        1414: 'Sachsen-Anhalt',
        1415: 'Thüringen',
      };

      try {
        const result = await CernionMCPClient.callWithNewSession(
          'cernion_installations_local',
          {
            gridOperatorMastrId: operatorMastrId,
            limit: 10,
            format: 'detailed',
            includeStats: false,
          },
          token
        );
        const installations = result?.data?.installations || result?.installations || [];
        if (!installations.length) return null;

        // Pass 1: translate MaStR numeric bundesland code → SMARD text name
        for (const inst of installations) {
          const code = inst.bundesland != null ? String(inst.bundesland).trim() : null;
          if (code && BUNDESLAND_CODES[code]) return BUNDESLAND_CODES[code];
        }
        // Pass 2: bundesland as plain text (future-proof if MaStR ever stores text)
        const isTextRegion = (s) => s && typeof s === 'string' && !/^\d+$/.test(s.trim());
        for (const inst of installations) {
          if (isTextRegion(inst.bundesland)) return inst.bundesland;
        }
        // Pass 3: text landkreis name (skip numeric AGS codes)
        for (const inst of installations) {
          if (isTextRegion(inst.landkreis)) return inst.landkreis;
        }
        // Pass 4: last resort — gemeinde (city name; SMARD may not recognise it)
        for (const inst of installations) {
          if (isTextRegion(inst.gemeinde)) return inst.gemeinde;
        }
        return null;
      } catch (err) {
        this.logger.warn(
          `resolveRegionFromOperatorId failed for ${operatorMastrId}: ${err.message}`
        );
        return null;
      }
    },

    /**
     * Build nested location object from optional flat params.
     * Only includes keys that have a defined, non-null value.
     *
     * @param {object} params - Flat location fields
     * @returns {object} Nested location object (empty if no fields provided)
     */
    buildLocationObj({ bundesland, landkreis, gemeinde, postleitzahl, latitude, longitude } = {}) {
      const loc = {};
      if (bundesland) loc.bundesland = bundesland;
      if (landkreis) loc.landkreis = landkreis;
      if (gemeinde) loc.gemeinde = gemeinde;
      if (postleitzahl) loc.postleitzahl = postleitzahl;
      if (latitude !== undefined) loc.latitude = latitude;
      if (longitude !== undefined) loc.longitude = longitude;
      return loc;
    },

    /**
     * Set CSV response headers and return CSV string.
     *
     * @param {object} ctx - Moleculer context
     * @param {Array} forecastData - Forecast data points
     * @param {object} summary - Response summary object
     * @returns {string} CSV content
     */
    handleCsvResponse(ctx, forecastData, summary) {
      const csvContent = this.convertToCSV(forecastData, summary);
      ctx.meta.$responseHeaders = {
        'Content-Type': 'text/csv; charset=utf-8',
        'Content-Disposition': `attachment; filename="residual-load-${Date.now()}.csv"`,
      };
      return csvContent;
    },

    /**
     * Set XLSX response headers and return XLSX buffer.
     *
     * @param {object} ctx - Moleculer context
     * @param {Array} forecastData - Forecast data points
     * @param {object} summary - Response summary object
     * @param {object} methodology - Methodology object
     * @returns {Buffer} XLSX buffer
     */
    handleXlsxResponse(ctx, forecastData, summary, methodology) {
      const buffer = this.convertToXLSX(forecastData, summary, methodology);
      ctx.meta.$responseHeaders = {
        'Content-Type': 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
        'Content-Disposition': `attachment; filename="residual-load-${Date.now()}.xlsx"`,
      };
      return buffer;
    },

    /**
     * Convert residual load forecast data to CSV.
     *
     * @param {Array} forecastData - Array of forecast data points
     * @param {object} summary - Summary object from MCP response
     * @returns {string} CSV content with metadata header comments
     */
    convertToCSV(forecastData, summary) {
      if (!forecastData || forecastData.length === 0) {
        return 'No residual load data available';
      }

      const headers = [
        'Timestamp',
        'Load (MW)',
        'PV Generation (MW)',
        'Wind Generation (MW)',
        'EE Generation (MW)',
        'Residual Load (MW)',
        'EE Share (%)',
      ];

      let csv = '# Net Residual Load Forecast\n';
      if (summary) {
        if (summary.region) csv += `# Region: ${summary.region}\n`;
        if (summary.resolution) csv += `# Resolution: ${summary.resolution}\n`;
        if (summary.installedCapacity?.totalPV_MW != null)
          csv += `# Installed PV: ${summary.installedCapacity.totalPV_MW} MW\n`;
        if (summary.installedCapacity?.totalWind_MW != null)
          csv += `# Installed Wind: ${summary.installedCapacity.totalWind_MW} MW\n`;
        if (summary.kpis?.peakResidualLoadMW != null)
          csv += `# Peak Residual Load: ${summary.kpis.peakResidualLoadMW} MW\n`;
        if (summary.kpis?.avgResidualLoadMW != null)
          csv += `# Avg Residual Load: ${summary.kpis.avgResidualLoadMW} MW\n`;
      }
      csv += `# Generated: ${new Date().toISOString()}\n\n`;
      csv += headers.map((h) => `"${h}"`).join(',') + '\n';

      forecastData.forEach((item) => {
        const row = [
          `"${item.timestamp || ''}"`,
          item.loadMW ?? '',
          item.pvGenerationMW ?? '',
          item.windGenerationMW ?? '',
          item.eeGenerationMW ?? '',
          item.residualLoadMW ?? '',
          item.eeSharePct ?? '',
        ];
        csv += row.join(',') + '\n';
      });

      return csv;
    },

    /**
     * Convert residual load forecast to XLSX workbook with two sheets:
     * "Forecast" (time-series data) and "Summary" (KPIs + methodology).
     *
     * @param {Array} forecastData - Array of forecast data points
     * @param {object} summary - Summary object from MCP response
     * @param {object} methodology - Methodology object from MCP response
     * @returns {Buffer} XLSX buffer
     */
    convertToXLSX(forecastData, summary, methodology) {
      const wb = XLSX.utils.book_new();

      if (!forecastData || forecastData.length === 0) {
        const ws = XLSX.utils.aoa_to_sheet([['No residual load data available']]);
        XLSX.utils.book_append_sheet(wb, ws, 'Forecast');
        return XLSX.write(wb, { type: 'buffer', bookType: 'xlsx' });
      }

      const forecastSheet = forecastData.map((item) => ({
        Timestamp: item.timestamp || '',
        'Load (MW)': item.loadMW ?? 0,
        'PV Generation (MW)': item.pvGenerationMW ?? 0,
        'Wind Generation (MW)': item.windGenerationMW ?? 0,
        'EE Generation (MW)': item.eeGenerationMW ?? 0,
        'Residual Load (MW)': item.residualLoadMW ?? 0,
        'EE Share (%)': item.eeSharePct ?? 0,
      }));

      const ws = XLSX.utils.json_to_sheet(forecastSheet);
      ws['!cols'] = [
        { wch: 25 }, // Timestamp
        { wch: 12 }, // Load (MW)
        { wch: 18 }, // PV Generation (MW)
        { wch: 20 }, // Wind Generation (MW)
        { wch: 18 }, // EE Generation (MW)
        { wch: 20 }, // Residual Load (MW)
        { wch: 13 }, // EE Share (%)
      ];
      XLSX.utils.book_append_sheet(wb, ws, 'Forecast');

      const summaryRows = this.buildSummaryRows(summary, methodology);
      if (summaryRows.length > 0) {
        const wsSummary = XLSX.utils.json_to_sheet(summaryRows);
        wsSummary['!cols'] = [{ wch: 30 }, { wch: 40 }];
        XLSX.utils.book_append_sheet(wb, wsSummary, 'Summary');
      }

      return XLSX.write(wb, { type: 'buffer', bookType: 'xlsx' });
    },

    /**
     * Build the Summary sheet rows from summary KPIs and methodology.
     *
     * @param {object} summary - Summary object
     * @param {object} methodology - Methodology object
     * @returns {Array} Array of {Property, Value} rows
     */
    buildSummaryRows(summary, methodology) {
      const rows = [];
      if (!summary) return rows;

      const kpis = summary.kpis || {};
      const cap = summary.installedCapacity || {};
      const scaling = summary.loadScaling || {};

      if (summary.region) rows.push({ Property: 'Region', Value: summary.region });
      if (summary.resolution) rows.push({ Property: 'Resolution', Value: summary.resolution });
      if (summary.dataPoints != null)
        rows.push({ Property: 'Data Points', Value: summary.dataPoints });
      if (cap.totalPV_MW != null)
        rows.push({ Property: 'Installed PV (MW)', Value: cap.totalPV_MW });
      if (cap.totalWind_MW != null)
        rows.push({ Property: 'Installed Wind (MW)', Value: cap.totalWind_MW });
      if (cap.pvInstallations != null)
        rows.push({ Property: 'PV Installations', Value: cap.pvInstallations });
      if (cap.windInstallations != null)
        rows.push({ Property: 'Wind Installations', Value: cap.windInstallations });
      if (scaling.populationUsed)
        rows.push({ Property: 'Population Used', Value: scaling.populationUsed });
      if (scaling.scalingFactorPct)
        rows.push({ Property: 'Scaling Factor', Value: scaling.scalingFactorPct });
      if (scaling.dataSource)
        rows.push({ Property: 'Load Data Source', Value: scaling.dataSource });
      if (kpis.peakResidualLoadMW != null)
        rows.push({ Property: 'Peak Residual Load (MW)', Value: kpis.peakResidualLoadMW });
      if (kpis.peakResidualAt)
        rows.push({ Property: 'Peak Residual At', Value: kpis.peakResidualAt });
      if (kpis.minResidualLoadMW != null)
        rows.push({ Property: 'Min Residual Load (MW)', Value: kpis.minResidualLoadMW });
      if (kpis.avgResidualLoadMW != null)
        rows.push({ Property: 'Avg Residual Load (MW)', Value: kpis.avgResidualLoadMW });
      if (kpis.totalLoadMWh != null)
        rows.push({ Property: 'Total Load (MWh)', Value: kpis.totalLoadMWh });
      if (kpis.totalEEGenerationMWh != null)
        rows.push({ Property: 'Total EE Generation (MWh)', Value: kpis.totalEEGenerationMWh });
      if (kpis.totalResidualLoadMWh != null)
        rows.push({ Property: 'Total Residual Load (MWh)', Value: kpis.totalResidualLoadMWh });
      if (kpis.avgEESharePct != null)
        rows.push({ Property: 'Avg EE Share (%)', Value: kpis.avgEESharePct });
      if (methodology?.residualFormula)
        rows.push({ Property: 'Formula', Value: methodology.residualFormula });
      rows.push({ Property: 'Generated', Value: new Date().toISOString() });

      return rows;
    },
  },
};
