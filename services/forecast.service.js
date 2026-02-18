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
     * Tool: cernion_mastr_generation_forecast
     */
    generationForecast: {
      rest: 'POST /generation-forecast',
      params: {
        location: { type: 'string', min: 1 },
        installationType: {
          type: 'enum',
          values: ['solar', 'wind', 'all'],
        },
        forecastHorizonHours: { type: 'number', optional: true, min: 1, max: 168, default: 24 },
        state: { type: 'string', optional: true },
        district: { type: 'string', optional: true },
        municipality: { type: 'string', optional: true },
        postalCode: { type: 'string', optional: true },
        minCapacityKW: { type: 'number', optional: true, min: 0 },
        maxCapacityKW: { type: 'number', optional: true, min: 0 },
        includeInstallationBreakdown: { type: 'boolean', optional: true, default: false },
        includeWeatherData: { type: 'boolean', optional: true, default: true },
        format: { type: 'enum', values: ['json', 'csv', 'xlsx'], optional: true, default: 'json' },
      },
      openapi: {
        summary: 'Weather-based renewable energy generation forecast',
        tags: ['Renewable Energy Forecasting'],
        description: `Generate accurate renewable energy production forecasts using real installation data from the German Marktstammdatenregister (MaStR) combined with weather forecasts.

**Key Features:**
- Real installation data from German MaStR registry (3.7M+ installations)
- IEC standard compliance (IEC 61853 for solar, IEC 61400 for wind)
- Hourly forecasts up to 7 days (168 hours)
- Regional filtering (state, district, municipality, postal code)
- 24-hour weather data caching for performance
- Installation-level breakdown available

**Use Cases:**
- **Energy Suppliers (Stadtwerke)**: Optimize energy procurement by forecasting local renewable generation
- **Grid Operators (VNB/GNB)**: Anticipate grid congestion and plan redispatch measures
- **Virtual Power Plants (VPP)**: Aggregate forecasts for trading and balancing markets
- **Energy Trading**: Intraday and day-ahead market positioning
- **Industrial Consumers**: Plan load shifting and self-consumption optimization

**Technical Details:**
- **Solar Forecasting**: IEC 61853 standard, considers panel orientation, tilt, shading, temperature coefficients
- **Wind Forecasting**: IEC 61400 standard, uses hub height, power curves, air density corrections
- **Weather Source**: Visual Crossing API (temperature, irradiance, wind speed, cloud cover)
- **Forecast Accuracy**: Typical RMSE 10-15% for day-ahead, 15-25% for day-3

**Business Impact:**
- Reduce balancing energy costs by 30-50% through accurate procurement
- Avoid redispatch penalties (€150-300/MWh) by anticipating congestion
- Optimize intraday trading (spread: €5-20/MWh) with updated forecasts
- Enable dynamic tariffs based on local generation patterns

**Parameters:**
- **location** (required): Location filter - city, region, or "Deutschland" for nationwide
- **installationType** (required): "solar", "wind", or "all" (combined forecast)
- **forecastHorizonHours**: Forecast period 1-168 hours (default: 24)
- **state**: German federal state (e.g., "Baden-Württemberg", "Bayern")
- **district**: District/Kreis (e.g., "Rhein-Neckar-Kreis")
- **municipality**: Municipality/Gemeinde (e.g., "Heidelberg")
- **postalCode**: 5-digit postal code (e.g., "69115")
- **minCapacityKW**: Minimum installation capacity in kW (filters small installations)
- **maxCapacityKW**: Maximum installation capacity in kW (filters large installations)
- **includeInstallationBreakdown**: Include per-installation forecasts (default: false)
- **includeWeatherData**: Include weather forecast details (default: true)`,
        requestBody: {
          required: true,
          content: {
            'application/json': {
              schema: {
                type: 'object',
                required: ['location', 'installationType'],
                properties: {
                  location: {
                    type: 'string',
                    description: 'Location filter (city, region, "Deutschland")',
                    example: 'Heidelberg',
                  },
                  installationType: {
                    type: 'string',
                    enum: ['solar', 'wind', 'all'],
                    description: 'Installation type to forecast',
                    example: 'solar',
                  },
                  forecastHorizonHours: {
                    type: 'number',
                    minimum: 1,
                    maximum: 168,
                    default: 24,
                    description: 'Forecast horizon in hours (1-168)',
                    example: 24,
                  },
                  state: {
                    type: 'string',
                    description: 'German federal state',
                    example: 'Baden-Württemberg',
                  },
                  district: {
                    type: 'string',
                    description: 'District/Kreis',
                    example: 'Rhein-Neckar-Kreis',
                  },
                  municipality: {
                    type: 'string',
                    description: 'Municipality/Gemeinde',
                    example: 'Heidelberg',
                  },
                  postalCode: {
                    type: 'string',
                    pattern: '^[0-9]{5}$',
                    description: '5-digit postal code',
                    example: '69115',
                  },
                  minCapacityKW: {
                    type: 'number',
                    minimum: 0,
                    description: 'Minimum installation capacity in kW',
                    example: 10,
                  },
                  maxCapacityKW: {
                    type: 'number',
                    minimum: 0,
                    description: 'Maximum installation capacity in kW',
                    example: 1000,
                  },
                  includeInstallationBreakdown: {
                    type: 'boolean',
                    default: false,
                    description: 'Include per-installation forecasts',
                    example: false,
                  },
                  includeWeatherData: {
                    type: 'boolean',
                    default: true,
                    description: 'Include weather forecast details',
                    example: true,
                  },
                  format: {
                    type: 'string',
                    enum: ['json', 'csv', 'xlsx'],
                    default: 'json',
                    description: 'Output format - json (default), csv (comma-separated with metadata comments), or xlsx (Excel workbook with Forecast + Metadata sheets)',
                    example: 'json',
                  },
                },
              },
              examples: {
                solarDayAhead: {
                  summary: 'Solar forecast for Heidelberg (24h)',
                  value: {
                    location: 'Heidelberg',
                    installationType: 'solar',
                    forecastHorizonHours: 24,
                  },
                },
                windWeekAhead: {
                  summary: 'Wind forecast for Bavaria (7 days)',
                  value: {
                    location: 'Bayern',
                    installationType: 'wind',
                    forecastHorizonHours: 168,
                    state: 'Bayern',
                  },
                },
                combinedPostalCode: {
                  summary: 'Combined solar+wind forecast by postal code',
                  value: {
                    location: 'Baden-Württemberg',
                    installationType: 'all',
                    forecastHorizonHours: 48,
                    postalCode: '69115',
                  },
                },
                filteredCapacity: {
                  summary: 'Large-scale solar installations only (>100kW)',
                  value: {
                    location: 'Deutschland',
                    installationType: 'solar',
                    forecastHorizonHours: 24,
                    minCapacityKW: 100,
                    includeInstallationBreakdown: true,
                  },
                },
                detailedForecast: {
                  summary: 'Detailed forecast with weather and installation breakdown',
                  value: {
                    location: 'Mannheim',
                    installationType: 'solar',
                    forecastHorizonHours: 24,
                    includeInstallationBreakdown: true,
                    includeWeatherData: true,
                  },
                },
                csvExport: {
                  summary: 'Download forecast as CSV file',
                  value: {
                    location: 'Heidelberg',
                    installationType: 'solar',
                    forecastHorizonHours: 24,
                    format: 'csv',
                  },
                },
                xlsxExport: {
                  summary: 'Download forecast as Excel (XLSX) file',
                  value: {
                    location: 'Bayern',
                    installationType: 'wind',
                    forecastHorizonHours: 48,
                    format: 'xlsx',
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
                    success: {
                      type: 'boolean',
                      example: true,
                    },
                    data: {
                      type: 'object',
                      properties: {
                        location: {
                          type: 'string',
                          example: 'Heidelberg',
                        },
                        installationType: {
                          type: 'string',
                          example: 'solar',
                        },
                        forecastGenerated: {
                          type: 'string',
                          format: 'date-time',
                          example: '2026-02-16T12:00:00Z',
                        },
                        forecastHorizonHours: {
                          type: 'number',
                          example: 24,
                        },
                        totalInstalledCapacityKW: {
                          type: 'number',
                          example: 15420.5,
                        },
                        installationCount: {
                          type: 'number',
                          example: 342,
                        },
                        forecast: {
                          type: 'array',
                          items: {
                            type: 'object',
                            properties: {
                              timestamp: {
                                type: 'string',
                                format: 'date-time',
                              },
                              generationKW: {
                                type: 'number',
                                description: 'Forecasted generation in kW',
                              },
                              capacityFactor: {
                                type: 'number',
                                description: 'Capacity factor (0-1)',
                              },
                              confidence: {
                                type: 'string',
                                enum: ['high', 'medium', 'low'],
                                description: 'Forecast confidence',
                              },
                            },
                          },
                        },
                        weatherForecast: {
                          type: 'array',
                          description: 'Weather data (if includeWeatherData=true)',
                          items: {
                            type: 'object',
                            properties: {
                              timestamp: {
                                type: 'string',
                                format: 'date-time',
                              },
                              temperatureCelsius: {
                                type: 'number',
                              },
                              windSpeedMS: {
                                type: 'number',
                              },
                              cloudCoverPercent: {
                                type: 'number',
                              },
                              irradianceWM2: {
                                type: 'number',
                              },
                            },
                          },
                        },
                        installationBreakdown: {
                          type: 'array',
                          description: 'Per-installation forecasts (if includeInstallationBreakdown=true)',
                          items: {
                            type: 'object',
                            properties: {
                              mastrNummer: {
                                type: 'string',
                              },
                              capacityKW: {
                                type: 'number',
                              },
                              forecast: {
                                type: 'array',
                                items: {
                                  type: 'object',
                                  properties: {
                                    timestamp: {
                                      type: 'string',
                                    },
                                    generationKW: {
                                      type: 'number',
                                    },
                                  },
                                },
                              },
                            },
                          },
                        },
                      },
                    },
                    metadata: {
                      type: 'object',
                      properties: {
                        toolName: {
                          type: 'string',
                          example: 'cernion_mastr_generation_forecast',
                        },
                        timestamp: {
                          type: 'string',
                          format: 'date-time',
                        },
                        iecStandardsApplied: {
                          type: 'array',
                          items: {
                            type: 'string',
                          },
                          example: ['IEC 61853 (Solar)', 'IEC 61400 (Wind)'],
                        },
                        weatherDataCached: {
                          type: 'boolean',
                          example: true,
                        },
                      },
                    },
                  },
                },
                examples: {
                  solarForecast: {
                    summary: 'Solar generation forecast',
                    value: {
                      success: true,
                      data: {
                        location: 'Heidelberg',
                        installationType: 'solar',
                        forecastGenerated: '2026-02-16T12:00:00Z',
                        forecastHorizonHours: 24,
                        totalInstalledCapacityKW: 15420.5,
                        installationCount: 342,
                        forecast: [
                          {
                            timestamp: '2026-02-16T13:00:00Z',
                            generationKW: 8456.2,
                            capacityFactor: 0.548,
                            confidence: 'high',
                          },
                          {
                            timestamp: '2026-02-16T14:00:00Z',
                            generationKW: 9234.7,
                            capacityFactor: 0.599,
                            confidence: 'high',
                          },
                          {
                            timestamp: '2026-02-16T15:00:00Z',
                            generationKW: 7890.3,
                            capacityFactor: 0.512,
                            confidence: 'medium',
                          },
                        ],
                        weatherForecast: [
                          {
                            timestamp: '2026-02-16T13:00:00Z',
                            temperatureCelsius: 12.5,
                            windSpeedMS: 3.2,
                            cloudCoverPercent: 25,
                            irradianceWM2: 650,
                          },
                          {
                            timestamp: '2026-02-16T14:00:00Z',
                            temperatureCelsius: 14.2,
                            windSpeedMS: 3.8,
                            cloudCoverPercent: 15,
                            irradianceWM2: 720,
                          },
                        ],
                      },
                      metadata: {
                        toolName: 'cernion_mastr_generation_forecast',
                        timestamp: '2026-02-16T12:00:00Z',
                        iecStandardsApplied: ['IEC 61853 (Solar)'],
                        weatherDataCached: true,
                      },
                    },
                  },
                },
              },
              'text/csv': {
                description: 'CSV format with metadata comments (when format=csv)',
                example: `# Renewable Energy Generation Forecast
# Location: Heidelberg
# Installation Type: solar
# Forecast Generated: 2026-02-18T12:00:00Z
# Forecast Horizon: 24 hours
# Total Capacity: 15420.50 kW
# Installation Count: 342
Timestamp\tGeneration (kW)\tCapacity Factor\tConfidence
2026-02-18T13:00:00Z\t8456.2\t0.548\thigh
2026-02-18T14:00:00Z\t9234.7\t0.599\thigh
2026-02-18T15:00:00Z\t7890.3\t0.512\tmedium`,
              },
              'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet': {
                description: 'Excel XLSX format with two sheets: Forecast (hourly data) + Metadata (forecast context) (when format=xlsx)',
                schema: {
                  type: 'string',
                  format: 'binary',
                  description: 'Binary Excel file with Forecast sheet (Timestamp, Generation (kW), Capacity Factor, Confidence) and Metadata sheet (Property, Value)',
                },
              },
            },
          },
          400: {
            description: 'Invalid request parameters',
            content: {
              'application/json': {
                example: {
                  success: false,
                  error: {
                    code: 'VALIDATION_ERROR',
                    message: 'Invalid forecastHorizonHours: must be between 1 and 168',
                  },
                },
              },
            },
          },
          500: {
            description: 'Server error during forecast generation',
            content: {
              'application/json': {
                example: {
                  success: false,
                  error: {
                    code: 'FORECAST_ERROR',
                    message: 'Weather API unavailable',
                  },
                },
              },
            },
          },
        },
      },
      async handler(ctx) {
        try {
          const { format, ...mcpParams } = ctx.params;

          const result = await CernionMCPClient.callWithNewSession(
            'cernion_mastr_generation_forecast',
            mcpParams,
            ctx.meta.cernionToken
          );

          // Handle CSV export
          if (format === 'csv') {
            const forecastData = result?.data?.forecast || [];
            const csvContent = this.convertForecastToCSV(forecastData, result?.data);

            ctx.meta.$responseHeaders = {
              'Content-Type': 'text/csv; charset=utf-8',
              'Content-Disposition': `attachment; filename="forecast-${Date.now()}.csv"`,
            };

            return csvContent;
          }

          // Handle XLSX export
          if (format === 'xlsx') {
            const forecastData = result?.data?.forecast || [];
            const xlsxBuffer = this.convertForecastToXLSX(forecastData, result?.data);

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
    convertForecastToCSV(forecastData, metadata) {
      if (!forecastData || forecastData.length === 0) {
        return 'No forecast data available';
      }

      // Create header row
      const headers = ['Timestamp', 'Generation (kW)', 'Capacity Factor', 'Confidence'];

      // Add metadata as comment rows
      let csv = '';
      if (metadata) {
        if (metadata.location) csv += `# Location: ${metadata.location}\n`;
        if (metadata.installationType) csv += `# Installation Type: ${metadata.installationType}\n`;
        if (metadata.totalInstalledCapacityKW) csv += `# Total Capacity: ${metadata.totalInstalledCapacityKW} kW\n`;
        if (metadata.installationCount) csv += `# Installation Count: ${metadata.installationCount}\n`;
        csv += `# Generated: ${metadata.forecastGenerated || new Date().toISOString()}\n`;
        csv += '\n';
      }

      // Add header
      csv += headers.map(h => `"${h}"`).join(',') + '\n';

      // Add data rows
      forecastData.forEach(item => {
        const row = [
          item.timestamp || '',
          item.generationKW || 0,
          item.capacityFactor || 0,
          item.confidence || 'unknown',
        ];
        csv += row.map(v => typeof v === 'number' ? v : `"${v}"`).join(',') + '\n';
      });

      return csv;
    },

    /**
     * Convert forecast data to XLSX format
     */
    convertForecastToXLSX(forecastData, metadata) {
      const wb = XLSX.utils.book_new();

      if (!forecastData || forecastData.length === 0) {
        const ws = XLSX.utils.aoa_to_sheet([['No forecast data available']]);
        XLSX.utils.book_append_sheet(wb, ws, 'Forecast');
        return XLSX.write(wb, { type: 'buffer', bookType: 'xlsx' });
      }

      // Create forecast data sheet
      const forecastSheet = forecastData.map(item => ({
        'Timestamp': item.timestamp || '',
        'Generation (kW)': item.generationKW || 0,
        'Capacity Factor': item.capacityFactor || 0,
        'Confidence': item.confidence || 'unknown',
      }));

      const ws = XLSX.utils.json_to_sheet(forecastSheet);

      // Auto-size columns
      const colWidths = [
        { wch: 25 }, // Timestamp
        { wch: 15 }, // Generation
        { wch: 15 }, // Capacity Factor
        { wch: 12 }, // Confidence
      ];
      ws['!cols'] = colWidths;

      XLSX.utils.book_append_sheet(wb, ws, 'Forecast');

      // Add metadata sheet
      if (metadata) {
        const metadataSheet = [
          { Property: 'Location', Value: metadata.location || 'N/A' },
          { Property: 'Installation Type', Value: metadata.installationType || 'N/A' },
          { Property: 'Total Capacity (kW)', Value: metadata.totalInstalledCapacityKW || 0 },
          { Property: 'Installation Count', Value: metadata.installationCount || 0 },
          { Property: 'Forecast Horizon (hours)', Value: metadata.forecastHorizonHours || 0 },
          { Property: 'Generated', Value: metadata.forecastGenerated || new Date().toISOString() },
        ];

        const wsMetadata = XLSX.utils.json_to_sheet(metadataSheet);
        wsMetadata['!cols'] = [{ wch: 25 }, { wch: 30 }];
        XLSX.utils.book_append_sheet(wb, wsMetadata, 'Metadata');
      }

      return XLSX.write(wb, { type: 'buffer', bookType: 'xlsx' });
    },
  },
};
