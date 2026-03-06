/**
 * Renewable Energy Generation Forecast Service
 *
 * Weather-based renewable energy generation forecasting using real MaStR installation data
 * Maps to Cernion MCP mastr_generation_forecast tool
 */

const CernionMCPClient = require('../src/mcp-client');
const XLSX = require('xlsx');

module.exports = {
  name: 'forecast',

  settings: {
    defaultTimeout: 60000, // 60 seconds for forecast calculations
  },

  actions: {
    /**
     * Weather-based generation forecast
     * Tool: mastr_generation_forecast
     */
    generationForecast: {
      rest: 'POST /generation-forecast',
      params: {
        installationType: { type: 'enum', values: ['solar', 'wind', 'all'], optional: true, default: 'solar' },
        forecastDays: { type: 'number', optional: true, min: 1, max: 14, default: 7, convert: true },
        resolution: { type: 'enum', values: ['daily', 'hourly', 'hour', '15min'], optional: true, default: 'daily' },
        gridOperatorMastrId: { type: 'string', optional: true },
        installationMastrNummer: {
          type: 'string',
          optional: true,
          description:
            'MaStR unit ID for single-installation forecast (SEE…=solar, SWE…=wind). Highest priority — overrides all regional filters. installationType is auto-derived from prefix.',
        },
        messlokationId: {
          type: 'string',
          optional: true,
          description:
            'Metering location ID (MeLo, 33 chars, starts with DE). Resolved via NAP table. Priority: installationMastrNummer > messlokationId > gridOperatorMastrId > location.',
        },
        bundesland: { type: 'string', optional: true },
        landkreis: { type: 'string', optional: true },
        gemeinde: { type: 'string', optional: true },
        postleitzahl: { type: 'string', optional: true },
        latitude: { type: 'number', optional: true, convert: true },
        longitude: { type: 'number', optional: true, convert: true },
        startDate: {
          type: 'string',
          optional: true,
          pattern: /^[0-9]{4}-[0-9]{2}-[0-9]{2}$/,
          description: 'Optional start date (YYYY-MM-DD). Defaults to tomorrow. Past dates use observed weather data (historical mode).',
        },
        includeValidation: { type: 'boolean', optional: true, default: false },
        format: { type: 'enum', values: ['json', 'csv', 'xlsx'], optional: true, default: 'json' },
      },
      openapi: {
        summary: 'Weather-based renewable energy generation forecast',
        tags: ['Renewable Energy Forecasting'],
        description: `Regional Solar/Wind generation forecast based on ACTUAL installed capacity from MaStR, combined with weather forecasts from Visual Crossing API.

**How it works:**
1. Queries MaStR database for ALL installed solar/wind capacity in the specified area
2. Fetches weather forecast from Visual Crossing API (24h cache, IEC-compliant)
3. Calculates expected generation using IEC 61853 (solar) / IEC 61400 (wind) standards
4. Returns daily MW forecast + weather conditions for up to 14 days

**Key Features:**
- Real installation data from German MaStR registry (3.7M+ installations)
- IEC standard compliance (IEC 61853 for solar, IEC 61400 for wind)
- Daily forecasts up to 14 days
- Filter by grid operator (MaStR ID), federal state, district, municipality, or postal code
- Optional cross-validation with SMARD data

**Use Cases:**
- **Grid Operators (VNB/GNB)**: Anticipate feed-in volumes and plan redispatch measures
- **Energy Suppliers (Stadtwerke)**: Optimize procurement by forecasting local renewable generation
- **Virtual Power Plants (VPP)**: Aggregate forecasts for trading and balancing markets
- **Energy Trading**: Intraday and day-ahead market positioning

**Parameters:**
- **installationType**: "solar" (default), "wind", or "all" (combined solar+wind)
- **forecastDays**: Forecast period 1-14 days (default: 7)
- **resolution**: Time resolution — \`"daily"\` (1 point/day, default), \`"hourly"\` (24 pts/day, intraday trading), \`"15min"\` (96 pts/day, §12 StromNZV balancing/scheduling)
- **gridOperatorMastrId**: MaStR Netzbetreiber-ID (SNB/GNB...) — use cernion_vnb_lookup to resolve BDEW→MaStR
- **bundesland**: German federal state (e.g., "Bayern", "Baden-Württemberg")
- **landkreis**: District/Landkreis name
- **gemeinde**: Municipality/Gemeinde name
- **postleitzahl**: 5-digit postal code (e.g., "69115")
- **latitude/longitude**: Coordinates for precise weather data
- **startDate**: Optional start date (\`YYYY-MM-DD\`). Omit for default tomorrow behaviour (no breaking change). Past dates retrieve **observed weather data** (Visual Crossing historical observations) — identical IEC calculation, 30-day cache. Response gains \`summary.isHistorical\` and \`summary.dataMode\` fields.
- **includeValidation**: Cross-validate with SMARD data (default: false)
- **installationMastrNummer**: Single-installation forecast by MaStR unit ID (SEE…=solar, SWE…=wind). **Highest priority** — overrides all regional filters. installationType is auto-derived from prefix.
- **messlokationId**: Single-installation forecast via Metering Location ID (MeLo, 33 chars, starts with DE). Resolved via NAP table. Priority: installationMastrNummer > messlokationId > gridOperatorMastrId > location.`,        requestBody: {
          required: false,
          content: {
            'application/json': {
              schema: {
                type: 'object',
                properties: {
                  installationType: {
                    type: 'string',
                    enum: ['solar', 'wind', 'all'],
                    default: 'solar',
                    description: 'Installation type to forecast',
                    example: 'all',
                  },
                  forecastDays: {
                    type: 'number',
                    minimum: 1,
                    maximum: 14,
                    default: 7,
                    description: 'Number of days to forecast (1-14)',
                    example: 7,
                  },
                  resolution: {
                    type: 'string',
                    enum: ['daily', 'hourly', '15min'],
                    default: 'daily',
                    description: 'Time resolution of forecast output. "daily" = 1 pt/day (default); "hourly" = 24 pts/day (intraday dispatch/trading); "15min" = 96 pts/day (§12 StromNZV balancing/scheduling, linear interpolation between hourly values)',
                    example: 'daily',
                  },
                  gridOperatorMastrId: {
                    type: 'string',
                    description: 'MaStR Netzbetreiber-ID (SNB/GNB...). Use cernion_vnb_lookup to resolve BDEW → MaStR ID.',
                    example: 'SNB935578300972',
                  },
                  installationMastrNummer: {
                    type: 'string',
                    description:
                      'MaStR unit ID for single-installation forecast (SEE\u2026=solar, SWE\u2026=wind). Highest priority \u2014 overrides all regional filters. installationType is auto-derived from prefix.',
                    example: 'SEE984033548619',
                  },
                  messlokationId: {
                    type: 'string',
                    description:
                      'Metering location ID (MeLo, 33 chars, starts with DE). Resolved via NAP table. Priority: installationMastrNummer > messlokationId > gridOperatorMastrId > location.',
                    example: 'DE0010107352900000000000000336372',
                  },
                  bundesland: {
                    type: 'string',
                    description: 'German federal state',
                    example: 'Bayern',
                  },
                  landkreis: {
                    type: 'string',
                    description: 'District/Landkreis name',
                    example: 'Rhein-Neckar-Kreis',
                  },
                  gemeinde: {
                    type: 'string',
                    description: 'Municipality/Gemeinde name',
                    example: 'Heidelberg',
                  },
                  postleitzahl: {
                    type: 'string',
                    pattern: '^[0-9]{5}$',
                    description: '5-digit postal code',
                    example: '69115',
                  },
                  latitude: {
                    type: 'number',
                    description: 'Latitude for precise weather data',
                    example: 49.3988,
                  },
                  longitude: {
                    type: 'number',
                    description: 'Longitude for precise weather data',
                    example: 8.6724,
                  },
                  startDate: {
                    type: 'string',
                    pattern: '^[0-9]{4}-[0-9]{2}-[0-9]{2}$',
                    description: 'Optional start date (YYYY-MM-DD). Omit for default tomorrow behaviour. Past dates switch to historical observation mode (30-day cache, observed weather instead of forecast).',
                    example: '2026-01-15',
                  },
                  includeValidation: {
                    type: 'boolean',
                    default: false,
                    description: 'Cross-validate forecast with SMARD data',
                    example: false,
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
                gridOperatorForecast: {
                  summary: 'Daily EE generation for a grid operator network',
                  value: {
                    gridOperatorMastrId: 'SNB935578300972',
                    installationType: 'all',
                    forecastDays: 7,
                    resolution: 'daily',
                  },
                },
                hourlyIntraday: {
                  summary: 'Hourly Solar+Wind forecast for Bavaria (intraday trading)',
                  value: {
                    bundesland: 'Bayern',
                    installationType: 'all',
                    forecastDays: 3,
                    resolution: 'hourly',
                  },
                },
                quarterHourlyBalancing: {
                  summary: '15-min forecast for §12 StromNZV balancing/scheduling',
                  value: {
                    postleitzahl: '67063',
                    installationType: 'solar',
                    forecastDays: 2,
                    resolution: '15min',
                  },
                },
                solarByPostalCode: {
                  summary: 'Solar forecast for a specific postal code',
                  value: {
                    postleitzahl: '69115',
                    installationType: 'solar',
                    forecastDays: 3,
                  },
                },
                windBayern: {
                  summary: 'Wind forecast for Bavaria (14 days)',
                  value: {
                    bundesland: 'Bayern',
                    installationType: 'wind',
                    forecastDays: 14,
                  },
                },
                csvExport: {
                  summary: 'Download hourly forecast as CSV',
                  value: {
                    gridOperatorMastrId: 'SNB935578300972',
                    installationType: 'all',
                    forecastDays: 3,
                    resolution: 'hourly',
                    format: 'csv',
                  },
                },
                xlsxExport: {
                  summary: 'Download 15-min forecast as Excel (XLSX)',
                  value: {
                    bundesland: 'Bayern',
                    installationType: 'solar',
                    forecastDays: 7,
                    resolution: '15min',
                    format: 'xlsx',
                  },
                },
                singleInstallationMastrNr: {
                  summary: 'Single PV installation forecast via MaStR-ID',
                  value: {
                    installationMastrNummer: 'SEE984033548619',
                    forecastDays: 3,
                    resolution: 'hourly',
                  },
                },
                singleInstallationMeLo: {
                  summary: 'Single installation forecast via Messlokation (MeLo)',
                  value: {
                    messlokationId: 'DE0010107352900000000000000336372',
                    forecastDays: 1,
                    resolution: '15min',
                  },
                },
                historicalForecast: {
                  summary: 'Historical generation analysis (past date, observed weather)',
                  value: {
                    gridOperatorMastrId: 'SNB935578300972',
                    installationType: 'all',
                    startDate: '2026-01-15',
                    forecastDays: 7,
                    resolution: 'daily',
                  },
                },
              },
            },
          },
        },
        responses: {
          200: {
            description: 'Forecast generated successfully',
            content: {
              'application/json': {
                schema: {
                  type: 'object',
                  properties: {
                    success: { type: 'boolean', example: true },
                    summary: {
                      type: 'object',
                      properties: {
                        location: { type: 'string', example: 'Netzgebiet SNB935578300972' },
                        type: { type: 'string', example: 'all' },
                        totalCapacityMW: { type: 'number', example: 25.77 },
                        installationCount: { type: 'number', example: 2756 },
                        isHistorical: {
                          type: 'boolean',
                          description: 'true when startDate is in the past (observed weather data used)',
                          example: false,
                        },
                        dataMode: {
                          type: 'string',
                          enum: ['weather_forecast', 'historical_observation'],
                          description: '"weather_forecast" for future dates, "historical_observation" for past dates',
                          example: 'weather_forecast',
                        },
                        forecastPeriod: {
                          type: 'object',
                          properties: {
                            start: { type: 'string', format: 'date-time' },
                            end: { type: 'string', format: 'date-time' },
                          },
                        },
                      },
                    },
                    forecasts: {
                      type: 'array',
                      items: {
                        type: 'object',
                        properties: {
                          timestamp: { type: 'string', format: 'date-time' },
                          generationMW: { type: 'number', description: 'Forecasted generation in MW' },
                          capacityFactor: { type: 'number', nullable: true, description: 'Capacity factor (0-1)' },
                          weather: {
                            type: 'object',
                            properties: {
                              temperature: { type: 'number', description: 'Temperature in °C' },
                              windSpeed: { type: 'number', description: 'Wind speed in m/s' },
                              solarIrradiance: { type: 'number', description: 'Solar irradiance in W/m²' },
                              cloudCover: { type: 'number', description: 'Cloud cover in %' },
                            },
                          },
                        },
                      },
                    },
                    metadata: {
                      type: 'object',
                      properties: {
                        toolName: { type: 'string', example: 'mastr_generation_forecast' },
                        timestamp: { type: 'string', format: 'date-time' },
                        weatherDataSource: { type: 'string', example: 'Visual Crossing' },
                        iecStandardApplied: { type: 'string', example: 'IEC 61853', description: 'IEC 61853 for solar, IEC 61400 for wind' },
                        cachingEnabled: { type: 'boolean', example: true },
                        apiCallsUsed: { type: 'number', example: 1 },
                        orientationCorrectionApplied: { type: 'boolean', example: true },
                        portfolioOrientationFactor: { type: 'number', example: 0.9712, description: 'Capacity-weighted azimuth+tilt factor from MaStR Hauptausrichtung' },
                        orientationDataCoverage: { type: 'number', example: 0.8341, description: 'Fraction of installations with MaStR orientation data' },
                      },
                    },
                  },
                },
                examples: {
                  gridOperatorForecast: {
                    summary: 'All EE generation for SNB935578300972',
                    value: {
                      success: true,
                      summary: {
                        location: 'Netzgebiet SNB935578300972',
                        type: 'all',
                        totalCapacityMW: 25.77,
                        installationCount: 2756,
                        forecastPeriod: {
                          start: '2026-02-19T00:00:00.000Z',
                          end: '2026-02-26T00:00:00.000Z',
                        },
                      },
                      forecasts: [
                        {
                          timestamp: '2026-02-19T00:00:00.000Z',
                          generationMW: 0.01,
                          capacityFactor: null,
                          weather: { temperature: 4.3, windSpeed: 12.2, solarIrradiance: 30.8, cloudCover: 100 },
                        },
                      ],
                      metadata: { toolName: 'mastr_generation_forecast', timestamp: '2026-02-18T23:21:46.848Z' },
                    },
                  },
                },
              },
              'text/csv': {
                description: 'CSV format with metadata comments (when format=csv)',
                example: `# Renewable Energy Generation Forecast\n# Location: Netzgebiet SNB935578300972\n# Total Capacity: 25.77 MW\n# Installation Count: 2756\nTimestamp,Generation (MW),Capacity Factor,Temperature (\u00b0C),Wind Speed (m/s),Solar Irradiance (W/m\u00b2),Cloud Cover (%)\n2026-02-19T00:00:00.000Z,0.01,,4.3,12.2,30.8,100`,
              },
              'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet': {
                description: 'Excel XLSX with Forecast sheet (daily data + weather) and Metadata sheet',
                schema: { type: 'string', format: 'binary' },
              },
            },
          },
          400: {
            description: 'Invalid request parameters',
            content: {
              'application/json': {
                example: { success: false, error: { code: 'VALIDATION_ERROR', message: 'Invalid forecastDays: must be between 1 and 14' } },
              },
            },
          },
          500: {
            description: 'Server error during forecast generation',
            content: {
              'application/json': {
                example: { success: false, error: { code: 'FORECAST_ERROR', message: 'Weather API unavailable' } },
              },
            },
          },
        },
      },
      async handler(ctx) {
        try {
          const {
            format,
            bundesland, landkreis, gemeinde, postleitzahl, latitude, longitude,
            installationMastrNummer, messlokationId, startDate,
            ...rest
          } = ctx.params;

          // Normalise resolution alias: 'hour' → 'hourly'
          if (rest.resolution === 'hour') rest.resolution = 'hourly';

          const mcpParams = { ...rest };
          if (startDate) mcpParams.startDate = startDate;
          const resolution = ctx.params.resolution === 'hour' ? 'hourly' : (ctx.params.resolution || 'daily');

          if (installationMastrNummer) {
            // Mode 1: single-installation via MaStR ID — highest priority
            mcpParams.installationMastrNummer = installationMastrNummer;
            // Auto-derive installationType from prefix to avoid default 'solar' override
            const prefix = installationMastrNummer.slice(0, 3).toUpperCase();
            if (prefix === 'SWE') {
              mcpParams.installationType = 'wind';
            } else if (prefix !== 'SEE') {
              // Unknown prefix: let MCP tool search both collections
              delete mcpParams.installationType;
            }
            // SEE prefix: keep as-is (defaults to 'solar', which is correct)
          } else if (messlokationId) {
            // Mode 2: single-installation via MeLo — skip regional location object
            mcpParams.messlokationId = messlokationId;
          } else {
            // Regional mode: build nested location object from flat params
            const locationObj = {};
            if (bundesland) locationObj.bundesland = bundesland;
            if (landkreis) locationObj.landkreis = landkreis;
            if (gemeinde) locationObj.gemeinde = gemeinde;
            if (postleitzahl) locationObj.postleitzahl = postleitzahl;
            if (latitude !== undefined) locationObj.latitude = latitude;
            if (longitude !== undefined) locationObj.longitude = longitude;
            if (Object.keys(locationObj).length > 0) {
              mcpParams.location = locationObj;
            }
          }

          const result = await CernionMCPClient.callWithNewSession(
            'mastr_generation_forecast',
            mcpParams,
            ctx.meta.cernionToken
          );

          // Handle CSV export
          if (format === 'csv') {
            const forecastData = result?.forecasts || [];
            const csvContent = this.convertForecastToCSV(forecastData, result?.summary, resolution);

            ctx.meta.$responseHeaders = {
              'Content-Type': 'text/csv; charset=utf-8',
              'Content-Disposition': `attachment; filename="forecast-${Date.now()}.csv"`,
            };

            return csvContent;
          }

          // Handle XLSX export
          if (format === 'xlsx') {
            const forecastData = result?.forecasts || [];
            const xlsxBuffer = this.convertForecastToXLSX(forecastData, result?.summary, resolution);

            ctx.meta.$responseHeaders = {
              'Content-Type': 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
              'Content-Disposition': `attachment; filename="forecast-${Date.now()}.xlsx"`,
            };

            return xlsxBuffer;
          }

          return result;
        } catch (error) {
          this.logger.error('Generation forecast failed:', error);
          return {
            success: false,
            error: {
              code: 'FORECAST_ERROR',
              message: error.message || 'Failed to generate forecast',
            },
          };
        }
      },
    },
  },

  methods: {
    /**
     * Convert forecast data to CSV format
     */
    convertForecastToCSV(forecastData, summary, resolution) {
      if (!forecastData || forecastData.length === 0) {
        return 'No forecast data available';
      }

      const headers = [
        'Timestamp', 'Generation (MW)', 'Capacity Factor',
        'Temperature (°C)', 'Wind Speed (m/s)', 'Solar Irradiance (W/m²)', 'Cloud Cover (%)',
      ];

      let csv = '# Renewable Energy Generation Forecast\n';
      if (summary) {
        if (summary.location) csv += `# Location: ${summary.location}\n`;
        if (summary.type) csv += `# Installation Type: ${summary.type}\n`;
        if (summary.totalCapacityMW != null) csv += `# Total Capacity: ${summary.totalCapacityMW} MW\n`;
        if (summary.installationCount != null) csv += `# Installation Count: ${summary.installationCount}\n`;
      }
      if (resolution) csv += `# Resolution: ${resolution}\n`;
      csv += `# Generated: ${new Date().toISOString()}\n\n`;

      csv += headers.map(h => `"${h}"`).join(',') + '\n';

      forecastData.forEach(item => {
        const w = item.weather || {};
        const row = [
          `"${item.timestamp || ''}"`,
          item.generationMW ?? '',
          item.capacityFactor ?? '',
          w.temperature ?? '',
          w.windSpeed ?? '',
          w.solarIrradiance ?? '',
          w.cloudCover ?? '',
        ];
        csv += row.join(',') + '\n';
      });

      return csv;
    },

    /**
     * Convert forecast data to XLSX format
     */
    convertForecastToXLSX(forecastData, summary, resolution) {
      const wb = XLSX.utils.book_new();

      if (!forecastData || forecastData.length === 0) {
        const ws = XLSX.utils.aoa_to_sheet([['No forecast data available']]);
        XLSX.utils.book_append_sheet(wb, ws, 'Forecast');
        return XLSX.write(wb, { type: 'buffer', bookType: 'xlsx' });
      }

      const forecastSheet = forecastData.map(item => ({
        'Timestamp': item.timestamp || '',
        'Generation (MW)': item.generationMW ?? 0,
        'Capacity Factor': item.capacityFactor ?? '',
        'Temperature (°C)': item.weather?.temperature ?? '',
        'Wind Speed (m/s)': item.weather?.windSpeed ?? '',
        'Solar Irradiance (W/m²)': item.weather?.solarIrradiance ?? '',
        'Cloud Cover (%)': item.weather?.cloudCover ?? '',
      }));

      const ws = XLSX.utils.json_to_sheet(forecastSheet);
      ws['!cols'] = [
        { wch: 25 }, // Timestamp
        { wch: 16 }, // Generation (MW)
        { wch: 15 }, // Capacity Factor
        { wch: 16 }, // Temperature
        { wch: 16 }, // Wind Speed
        { wch: 22 }, // Solar Irradiance
        { wch: 16 }, // Cloud Cover
      ];
      XLSX.utils.book_append_sheet(wb, ws, 'Forecast');

      if (summary) {
        const metadataSheet = [
          { Property: 'Location', Value: summary.location || 'N/A' },
          { Property: 'Installation Type', Value: summary.type || 'N/A' },
          { Property: 'Total Capacity (MW)', Value: summary.totalCapacityMW ?? 0 },
          { Property: 'Installation Count', Value: summary.installationCount ?? 0 },
          { Property: 'Forecast Start', Value: summary.forecastPeriod?.start || 'N/A' },
          { Property: 'Forecast End', Value: summary.forecastPeriod?.end || 'N/A' },
          { Property: 'Resolution', Value: resolution || 'daily' },
          { Property: 'Generated', Value: new Date().toISOString() },
        ];
        const wsMetadata = XLSX.utils.json_to_sheet(metadataSheet);
        wsMetadata['!cols'] = [{ wch: 22 }, { wch: 30 }];
        XLSX.utils.book_append_sheet(wb, wsMetadata, 'Metadata');
      }

      return XLSX.write(wb, { type: 'buffer', bookType: 'xlsx' });
    },
  },
};
