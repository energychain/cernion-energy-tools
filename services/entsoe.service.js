/**
 * ENTSO-E Service
 *
 * European Energy Data from ENTSO-E Transparency Platform
 * Cross-border flows, unavailability, generation, PSR types
 */

const CernionMCPClient = require('../src/mcp-client');

module.exports = {
  name: 'entsoe',

  settings: {
    defaultTimeout: 30000,
  },

  actions: {
    /**
     * Day-ahead prices (direct ENTSO-E API, no LLM overhead)
     * Tool: entsoe_day_ahead_prices
     */
    dayAheadPrices: {
      rest: 'POST /day-ahead-prices',
      params: {
        region: { type: 'string', min: 1 },
        dateFrom: { type: 'string' },
        dateTo: { type: 'string' },
        includeStatistics: { type: 'boolean', optional: true, default: true },
      },
      openapi: {
        summary: 'Direct ENTSO-E day-ahead price queries (faster, bypasses LLM)',
        tags: ['ENTSO-E'],
        description:
          '✅ FULLY WORKING - Most reliable ENTSOE endpoint. Automatic EIC code selection, multi-format dates, 15-minute resolution. Use this as reference for working ENTSOE integration.',
        'x-backend-status': 'operational',
        requestBody: {
          required: true,
          content: {
            'application/json': {
              schema: {
                type: 'object',
                required: ['region', 'dateFrom', 'dateTo'],
                properties: {
                  region: {
                    type: 'string',
                    description: 'Country/bidding zone name (fuzzy matching supported)',
                    example: 'Germany',
                  },
                  dateFrom: {
                    type: 'string',
                    description:
                      'Start date in ISO 8601 (2026-02-01), YYYYMMDD (20260201), or German format (01.02.2026)',
                    example: '2026-02-01',
                  },
                  dateTo: {
                    type: 'string',
                    description: 'End date (same formats as dateFrom)',
                    example: '2026-02-03',
                  },
                  includeStatistics: {
                    type: 'boolean',
                    description: 'Include price statistics (min/max/avg/median)',
                    default: true,
                  },
                },
              },
              examples: {
                singleDay: {
                  summary: 'Single day query',
                  value: {
                    region: 'Germany',
                    dateFrom: '2026-02-01',
                    dateTo: '2026-02-01',
                    includeStatistics: true,
                  },
                },
                weekRange: {
                  summary: 'Week range with statistics',
                  value: {
                    region: 'France',
                    dateFrom: '2026-02-01',
                    dateTo: '2026-02-07',
                    includeStatistics: true,
                  },
                },
                germanDateFormat: {
                  summary: 'Using German date format',
                  value: {
                    region: 'Austria',
                    dateFrom: '01.02.2026',
                    dateTo: '05.02.2026',
                    includeStatistics: false,
                  },
                },
              },
            },
          },
        },
        responses: {
          200: {
            description: 'Successful response with day-ahead prices',
            content: {
              'application/json': {
                schema: {
                  type: 'object',
                  properties: {
                    success: { type: 'boolean', example: true },
                    region: { type: 'string', example: 'Germany' },
                    eicCode: { type: 'string', example: '10Y1001A1001A82H' },
                    periodStart: { type: 'string', example: '202602010000' },
                    periodEnd: { type: 'string', example: '202602032300' },
                    resolution: { type: 'string', example: 'PT15M' },
                    currency: { type: 'string', example: 'EUR' },
                    unit: { type: 'string', example: 'MWh' },
                    prices: {
                      type: 'array',
                      items: {
                        type: 'object',
                        properties: {
                          timestamp: { type: 'string' },
                          price: { type: 'number' },
                          position: { type: 'integer' },
                        },
                      },
                    },
                    statistics: {
                      type: 'object',
                      properties: {
                        minPrice: { type: 'number' },
                        maxPrice: { type: 'number' },
                        avgPrice: { type: 'number' },
                        medianPrice: { type: 'number' },
                        totalDataPoints: { type: 'integer' },
                      },
                    },
                    metadata: {
                      type: 'object',
                      properties: {
                        source: { type: 'string', example: 'ENTSO-E Transparency Platform' },
                        documentType: { type: 'string', example: 'A44' },
                        queryTime: { type: 'string', format: 'date-time' },
                        toolName: { type: 'string' },
                        timestamp: { type: 'string', format: 'date-time' },
                      },
                    },
                  },
                },
              },
            },
          },
        },
      },
      async handler(ctx) {
        return await CernionMCPClient.callWithNewSession(
          'entsoe_day_ahead_prices',
          ctx.params,
          ctx.meta.cernionToken
        );
      },
    },

    /**
     * Query unavailable generation units, transmission assets, and load
     * Tool: entsoe_unavailability
     */
    unavailability: {
      rest: 'POST /unavailability',
      params: {
        region: { type: 'string', min: 1 },
        dateFrom: { type: 'string' },
        dateTo: { type: 'string' },
        unavailabilityType: {
          type: 'enum',
          values: ['production', 'transmission', 'load', 'all'],
          optional: true,
          default: 'production',
        },
        psrType: { type: 'string', optional: true },
        includeStatistics: { type: 'boolean', optional: true, default: true },
      },
      openapi: {
        summary: 'Query unavailable generation units, transmission assets, and load',
        tags: ['ENTSO-E'],
        description:
          '✅ FULLY WORKING - Outage monitoring (planned and unplanned), capacity forecasting. Supports production, transmission, and load unavailability types with PSR type filtering.',
        'x-backend-status': 'operational',
        requestBody: {
          required: true,
          content: {
            'application/json': {
              schema: {
                type: 'object',
                required: ['region', 'dateFrom', 'dateTo'],
                properties: {
                  region: {
                    type: 'string',
                    description: 'Country/bidding zone name',
                    example: 'Germany',
                  },
                  dateFrom: {
                    type: 'string',
                    description: 'Start date (ISO 8601, YYYYMMDD, or DD.MM.YYYY)',
                    example: '2026-02-01',
                  },
                  dateTo: {
                    type: 'string',
                    description: 'End date',
                    example: '2026-02-07',
                  },
                  unavailabilityType: {
                    type: 'string',
                    enum: ['production', 'transmission', 'load', 'all'],
                    description: 'Type of unavailability to query',
                    default: 'production',
                  },
                  psrType: {
                    type: 'string',
                    description: 'Optional PSR type filter (e.g., B16 for Solar, B19 for Wind)',
                    example: 'B19',
                  },
                  includeStatistics: {
                    type: 'boolean',
                    default: true,
                  },
                },
              },
              examples: {
                productionOutages: {
                  summary: 'Production unit outages',
                  value: {
                    region: 'Germany',
                    dateFrom: '2026-02-01',
                    dateTo: '2026-02-07',
                    unavailabilityType: 'production',
                    includeStatistics: true,
                  },
                },
                windOutagesOnly: {
                  summary: 'Wind generation outages only',
                  value: {
                    region: 'Denmark',
                    dateFrom: '2026-02-01',
                    dateTo: '2026-02-14',
                    unavailabilityType: 'production',
                    psrType: 'B19',
                    includeStatistics: true,
                  },
                },
                transmissionOutages: {
                  summary: 'Transmission asset outages',
                  value: {
                    region: 'France',
                    dateFrom: '2026-02-01',
                    dateTo: '2026-02-28',
                    unavailabilityType: 'transmission',
                  },
                },
              },
            },
          },
        },
        responses: {
          200: {
            description: 'Successful response with unavailability data',
            content: {
              'application/json': {
                schema: {
                  type: 'object',
                  properties: {
                    success: { type: 'boolean' },
                    region: { type: 'string' },
                    eicCode: { type: 'string' },
                    period: {
                      type: 'object',
                      properties: {
                        from: { type: 'string' },
                        to: { type: 'string' },
                      },
                    },
                    unavailabilityTypes: { type: 'array', items: { type: 'string' } },
                    unavailabilities: {
                      type: 'array',
                      items: {
                        type: 'object',
                        properties: {
                          timestamp: { type: 'string' },
                          psrType: { type: 'string' },
                          unavailableMW: { type: 'number' },
                          businessType: { type: 'string' },
                        },
                      },
                    },
                    statistics: { type: 'object' },
                    metadata: {
                      type: 'object',
                      properties: {
                        source: { type: 'string' },
                        documentTypes: { type: 'array', items: { type: 'string' } },
                        queryTime: { type: 'string' },
                        dataPoints: { type: 'integer' },
                        toolName: { type: 'string' },
                        timestamp: { type: 'string' },
                      },
                    },
                  },
                },
              },
            },
          },
        },
      },
      async handler(ctx) {
        return await CernionMCPClient.callWithNewSession(
          'entsoe_unavailability',
          ctx.params,
          ctx.meta.cernionToken
        );
      },
    },

    /**
     * Physical cross-border electricity flows
     * Tool: entsoe_physical_flows
     */
    physicalFlows: {
      rest: 'POST /physical-flows',
      params: {
        fromRegion: { type: 'string', min: 1 },
        toRegion: { type: 'string', min: 1 },
        dateFrom: { type: 'string' },
        dateTo: { type: 'string' },
        resolution: {
          type: 'enum',
          values: ['hourly', 'daily'],
          optional: true,
          default: 'hourly',
        },
        includeStatistics: { type: 'boolean', optional: true, default: true },
      },
      openapi: {
        summary: 'Query physical cross-border electricity flows between countries/bidding zones',
        tags: ['ENTSO-E'],
        description:
          '✅ FULLY WORKING - Import/export dependency monitoring, grid stress assessment. Returns hourly or daily cross-border electricity flows with statistics.',
        'x-backend-status': 'operational',
        requestBody: {
          required: true,
          content: {
            'application/json': {
              schema: {
                type: 'object',
                required: ['fromRegion', 'toRegion', 'dateFrom', 'dateTo'],
                properties: {
                  fromRegion: {
                    type: 'string',
                    description: 'Source country (export from)',
                    example: 'France',
                  },
                  toRegion: {
                    type: 'string',
                    description: 'Target country (import to)',
                    example: 'Germany',
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
                  resolution: {
                    type: 'string',
                    enum: ['hourly', 'daily'],
                    description: 'Time resolution',
                    default: 'hourly',
                  },
                  includeStatistics: {
                    type: 'boolean',
                    default: true,
                  },
                },
              },
              examples: {
                franceToGermany: {
                  summary: 'France → Germany hourly flows',
                  value: {
                    fromRegion: 'France',
                    toRegion: 'Germany',
                    dateFrom: '2026-02-01',
                    dateTo: '2026-02-03',
                    resolution: 'hourly',
                    includeStatistics: true,
                  },
                },
                norwayToGermany: {
                  summary: 'Norway → Germany daily aggregation',
                  value: {
                    fromRegion: 'Norway',
                    toRegion: 'Germany',
                    dateFrom: '2026-01-01',
                    dateTo: '2026-01-31',
                    resolution: 'daily',
                  },
                },
                polandToGermany: {
                  summary: 'Poland → Germany (import dependency)',
                  value: {
                    fromRegion: 'Poland',
                    toRegion: 'Germany',
                    dateFrom: '2026-02-01',
                    dateTo: '2026-02-07',
                    resolution: 'hourly',
                  },
                },
              },
            },
          },
        },
      },
      async handler(ctx) {
        return await CernionMCPClient.callWithNewSession(
          'entsoe_physical_flows',
          ctx.params,
          ctx.meta.cernionToken
        );
      },
    },

    /**
     * Actual generation by production type
     * Tool: entsoe_actual_generation
     */
    actualGeneration: {
      rest: 'POST /actual-generation',
      params: {
        region: { type: 'string', min: 1 },
        dateFrom: { type: 'string' },
        dateTo: { type: 'string' },
        psrType: { type: 'string', optional: true },
        resolution: {
          type: 'enum',
          values: ['hourly', 'daily'],
          optional: true,
          default: 'hourly',
        },
        includeStatistics: { type: 'boolean', optional: true, default: true },
      },
      openapi: {
        summary: 'Query actual electricity generation by production type',
        tags: ['ENTSO-E'],
        description:
          '✅ FULLY WORKING - Energy mix analysis, renewable share monitoring, forecast validation. Returns actual generation data by PSR type (solar, wind, gas, nuclear, etc.).',
        'x-backend-status': 'operational',
        requestBody: {
          required: true,
          content: {
            'application/json': {
              schema: {
                type: 'object',
                required: ['region', 'dateFrom', 'dateTo'],
                properties: {
                  region: {
                    type: 'string',
                    description: 'Country name',
                    example: 'Germany',
                  },
                  dateFrom: {
                    type: 'string',
                    description: 'Start date',
                    example: '2026-02-01',
                  },
                  dateTo: {
                    type: 'string',
                    description: 'End date',
                    example: '2026-02-03',
                  },
                  psrType: {
                    type: 'string',
                    description:
                      'Optional: Filter by PSR type (B16=Solar, B19=Wind Onshore, B18=Wind Offshore, B14=Nuclear, B04=Gas, B05=Coal)',
                    example: 'B16',
                  },
                  resolution: {
                    type: 'string',
                    enum: ['hourly', 'daily'],
                    default: 'hourly',
                  },
                  includeStatistics: {
                    type: 'boolean',
                    default: true,
                  },
                },
              },
              examples: {
                allSources: {
                  summary: 'All generation types',
                  value: {
                    region: 'Germany',
                    dateFrom: '2026-02-01',
                    dateTo: '2026-02-03',
                    resolution: 'hourly',
                    includeStatistics: true,
                  },
                },
                solarOnly: {
                  summary: 'Solar generation only',
                  value: {
                    region: 'Spain',
                    dateFrom: '2026-02-01',
                    dateTo: '2026-02-07',
                    psrType: 'B16',
                    resolution: 'daily',
                  },
                },
                windDaily: {
                  summary: 'Wind onshore daily aggregation',
                  value: {
                    region: 'Denmark',
                    dateFrom: '2026-01-01',
                    dateTo: '2026-01-31',
                    psrType: 'B19',
                    resolution: 'daily',
                  },
                },
              },
            },
          },
        },
        responses: {
          200: {
            description: 'Successful response with actual generation data by PSR type',
            content: {
              'application/json': {
                schema: {
                  type: 'object',
                  properties: {
                    success: { type: 'boolean' },
                    region: { type: 'string' },
                    eicCode: { type: 'string' },
                    period: {
                      type: 'object',
                      properties: {
                        from: { type: 'string' },
                        to: { type: 'string' },
                      },
                    },
                    resolution: { type: 'string', example: 'PT15M' },
                    generation: {
                      type: 'array',
                      items: {
                        type: 'object',
                        properties: {
                          timestamp: { type: 'string' },
                          psrType: { type: 'string' },
                          psrName: { type: 'string' },
                          generationMW: { type: 'number' },
                        },
                      },
                    },
                    statistics: {
                      type: 'object',
                      properties: {
                        totalGenerationMWh: { type: 'number' },
                        byPSRType: { type: 'object' },
                      },
                    },
                    metadata: {
                      type: 'object',
                      properties: {
                        source: { type: 'string' },
                        documentType: { type: 'string' },
                        queryTime: { type: 'string' },
                        dataPoints: { type: 'integer' },
                        toolName: { type: 'string' },
                        timestamp: { type: 'string' },
                      },
                    },
                  },
                },
              },
            },
          },
        },
      },
      async handler(ctx) {
        return await CernionMCPClient.callWithNewSession(
          'entsoe_actual_generation',
          ctx.params,
          ctx.meta.cernionToken
        );
      },
    },

    /**
     * Wind and solar generation forecast
     * Tool: entsoe_wind_solar_forecast
     */
    windSolarForecast: {
      rest: 'POST /wind-solar-forecast',
      params: {
        region: { type: 'string', min: 1 },
        dateFrom: { type: 'string' },
        dateTo: { type: 'string' },
        forecastType: {
          type: 'enum',
          values: ['wind', 'solar', 'both'],
          optional: true,
          default: 'both',
        },
        includeStatistics: { type: 'boolean', optional: true, default: true },
      },
      openapi: {
        summary: 'Day-ahead wind and solar generation forecasts',
        tags: ['ENTSO-E'],
        description:
          '✅ FULLY WORKING - Renewable energy planning, grid balancing, trading strategies. Returns day-ahead forecasts for wind and solar generation.',
        'x-backend-status': 'operational',
        requestBody: {
          required: true,
          content: {
            'application/json': {
              schema: {
                type: 'object',
                required: ['region', 'dateFrom', 'dateTo'],
                properties: {
                  region: {
                    type: 'string',
                    description: 'Country name',
                    example: 'Germany',
                  },
                  dateFrom: {
                    type: 'string',
                    description: 'Start date (can be future dates for forecasts)',
                    example: '2026-02-08',
                  },
                  dateTo: {
                    type: 'string',
                    description: 'End date',
                    example: '2026-02-14',
                  },
                  forecastType: {
                    type: 'string',
                    enum: ['wind', 'solar', 'both'],
                    description: 'Forecast type filter',
                    default: 'both',
                  },
                  includeStatistics: {
                    type: 'boolean',
                    default: true,
                  },
                },
              },
              examples: {
                bothWindSolar: {
                  summary: 'Wind and solar forecasts',
                  value: {
                    region: 'Germany',
                    dateFrom: '2026-02-08',
                    dateTo: '2026-02-10',
                    forecastType: 'both',
                    includeStatistics: true,
                  },
                },
                windOnly: {
                  summary: 'Wind forecast only',
                  value: {
                    region: 'Denmark',
                    dateFrom: '2026-02-08',
                    dateTo: '2026-02-14',
                    forecastType: 'wind',
                  },
                },
                solarOnly: {
                  summary: 'Solar forecast only',
                  value: {
                    region: 'Spain',
                    dateFrom: '2026-02-08',
                    dateTo: '2026-02-14',
                    forecastType: 'solar',
                  },
                },
              },
            },
          },
        },
        responses: {
          200: {
            description: 'Successful response with wind and solar forecasts',
            content: {
              'application/json': {
                schema: {
                  type: 'object',
                  properties: {
                    success: { type: 'boolean', example: true },
                    region: { type: 'string', example: 'Germany/Luxembourg' },
                    eicCode: { type: 'string', example: '10Y1001A1001A83F' },
                    period: {
                      type: 'object',
                      properties: {
                        from: { type: 'string', example: '2026-02-08' },
                        to: { type: 'string', example: '2026-02-10' },
                      },
                    },
                    forecastType: { type: 'string', enum: ['wind', 'solar', 'both'] },
                    forecasts: {
                      type: 'array',
                      items: {
                        type: 'object',
                        properties: {
                          timestamp: { type: 'string', format: 'date-time' },
                          windOnshore: { type: 'number' },
                          windOffshore: { type: 'number' },
                          solar: { type: 'number' },
                          total: { type: 'number' },
                        },
                      },
                    },
                    statistics: {
                      type: 'object',
                      properties: {
                        totalForecastMWh: { type: 'number' },
                        avgForecastMW: { type: 'number' },
                        maxForecastMW: { type: 'number' },
                        minForecastMW: { type: 'number' },
                        byType: { type: 'object' },
                      },
                    },
                    metadata: {
                      type: 'object',
                      properties: {
                        source: { type: 'string', example: 'ENTSO-E Transparency Platform' },
                        documentType: { type: 'string', example: 'A69' },
                        queryTime: { type: 'string', format: 'date-time' },
                        dataPoints: { type: 'integer' },
                        toolName: { type: 'string' },
                        timestamp: { type: 'string', format: 'date-time' },
                      },
                    },
                  },
                },
              },
            },
          },
        },
      },
      async handler(ctx) {
        return await CernionMCPClient.callWithNewSession(
          'entsoe_wind_solar_forecast',
          ctx.params,
          ctx.meta.cernionToken
        );
      },
    },

    /**
     * Load forecast (demand)
     * Tool: entsoe_load_forecast
     */
    loadForecast: {
      rest: 'POST /load-forecast',
      params: {
        region: { type: 'string', min: 1 },
        dateFrom: { type: 'string' },
        dateTo: { type: 'string' },
        resolution: {
          type: 'enum',
          values: ['hourly', 'daily'],
          optional: true,
          default: 'hourly',
        },
        includeStatistics: { type: 'boolean', optional: true, default: true },
      },
      openapi: {
        summary: 'Day-ahead electricity load (demand) forecasts',
        tags: ['ENTSO-E'],
        description:
          '✅ FULLY WORKING - Grid planning, demand forecasting for trading, peak load management. Returns day-ahead load/demand forecasts.',
        'x-backend-status': 'operational',
        requestBody: {
          required: true,
          content: {
            'application/json': {
              schema: {
                type: 'object',
                required: ['region', 'dateFrom', 'dateTo'],
                properties: {
                  region: {
                    type: 'string',
                    description: 'Country name',
                    example: 'Germany',
                  },
                  dateFrom: {
                    type: 'string',
                    description: 'Start date (can be future dates for forecasts)',
                    example: '2026-02-08',
                  },
                  dateTo: {
                    type: 'string',
                    description: 'End date',
                    example: '2026-02-14',
                  },
                  resolution: {
                    type: 'string',
                    enum: ['hourly', 'daily'],
                    default: 'hourly',
                  },
                  includeStatistics: {
                    type: 'boolean',
                    default: true,
                  },
                },
              },
              examples: {
                weekHourly: {
                  summary: 'Weekly load forecast (hourly)',
                  value: {
                    region: 'Germany',
                    dateFrom: '2026-02-08',
                    dateTo: '2026-02-14',
                    resolution: 'hourly',
                    includeStatistics: true,
                  },
                },
                monthDaily: {
                  summary: 'Monthly load forecast (daily aggregation)',
                  value: {
                    region: 'France',
                    dateFrom: '2026-02-08',
                    dateTo: '2026-03-07',
                    resolution: 'daily',
                  },
                },
              },
            },
          },
        },
      },
      async handler(ctx) {
        return await CernionMCPClient.callWithNewSession(
          'entsoe_load_forecast',
          ctx.params,
          ctx.meta.cernionToken
        );
      },
    },

    /**
     * Aggregated actual generation (no breakdown by type)
     * Tool: entsoe_aggregated_generation
     */
    aggregatedGeneration: {
      rest: 'POST /aggregated-generation',
      params: {
        region: { type: 'string', min: 1 },
        dateFrom: { type: 'string' },
        dateTo: { type: 'string' },
        resolution: {
          type: 'enum',
          values: ['hourly', 'daily'],
          optional: true,
          default: 'hourly',
        },
        includeStatistics: { type: 'boolean', optional: true, default: true },
      },
      openapi: {
        summary: 'Total actual generation (aggregated across all production types)',
        tags: ['ENTSO-E'],
        description:
          'Actual electricity generation aggregated across all production types (no PSR breakdown). Use entsoe_actual_generation for per-type details.',
        'x-backend-status': 'operational',
        requestBody: {
          required: true,
          content: {
            'application/json': {
              schema: {
                type: 'object',
                required: ['region', 'dateFrom', 'dateTo'],
                properties: {
                  region: {
                    type: 'string',
                    description: 'Country name',
                    example: 'Germany',
                  },
                  dateFrom: {
                    type: 'string',
                    description: 'Start date',
                    example: '2026-02-01',
                  },
                  dateTo: {
                    type: 'string',
                    description: 'End date',
                    example: '2026-02-03',
                  },
                  resolution: {
                    type: 'string',
                    enum: ['hourly', 'daily'],
                    default: 'hourly',
                  },
                  includeStatistics: {
                    type: 'boolean',
                    default: true,
                  },
                },
              },
              examples: {
                aggregatedHourly: {
                  summary: 'Aggregated generation (hourly)',
                  value: {
                    region: 'Germany',
                    dateFrom: '2026-02-01',
                    dateTo: '2026-02-03',
                    resolution: 'hourly',
                    includeStatistics: true,
                  },
                },
                aggregatedDaily: {
                  summary: 'Aggregated generation (daily)',
                  value: {
                    region: 'France',
                    dateFrom: '2026-02-01',
                    dateTo: '2026-02-07',
                    resolution: 'daily',
                  },
                },
              },
            },
          },
        },
      },
      async handler(ctx) {
        return await CernionMCPClient.callWithNewSession(
          'entsoe_aggregated_generation',
          ctx.params,
          ctx.meta.cernionToken
        );
      },
    },

    /**
     * Actual wind and solar generation
     * Tool: entsoe_wind_solar_actual
     */
    windSolarActual: {
      rest: 'POST /wind-solar-actual',
      params: {
        region: { type: 'string', min: 1 },
        dateFrom: { type: 'string' },
        dateTo: { type: 'string' },
        includeStatistics: { type: 'boolean', optional: true, default: true },
      },
      openapi: {
        summary: 'Actual wind (offshore/onshore) and solar generation',
        tags: ['ENTSO-E'],
        description:
          '✅ FULLY WORKING - Renewable energy monitoring, forecast validation. Returns actual generation data for wind (onshore/offshore) and solar power.',
        'x-backend-status': 'operational',
        requestBody: {
          required: true,
          content: {
            'application/json': {
              schema: {
                type: 'object',
                required: ['region', 'dateFrom', 'dateTo'],
                properties: {
                  region: {
                    type: 'string',
                    description: 'Country name (e.g., Germany, Denmark, Spain)',
                    example: 'Germany',
                  },
                  dateFrom: {
                    type: 'string',
                    description: 'Start date in ISO 8601, YYYYMMDD, or DD.MM.YYYY format',
                    example: '2026-02-01',
                  },
                  dateTo: {
                    type: 'string',
                    description: 'End date (same format as dateFrom)',
                    example: '2026-02-07',
                  },
                  generationType: {
                    type: 'string',
                    enum: ['wind', 'solar', 'both'],
                    description: 'Filter by generation type',
                    default: 'both',
                  },
                  includeStatistics: {
                    type: 'boolean',
                    description: 'Include generation statistics (total, avg, max)',
                    default: true,
                  },
                },
              },
              examples: {
                germanySolarWind: {
                  summary: 'Germany: Wind and solar (1 week)',
                  value: {
                    region: 'Germany',
                    dateFrom: '2026-02-01',
                    dateTo: '2026-02-07',
                    generationType: 'both',
                    includeStatistics: true,
                  },
                },
                denmarkWind: {
                  summary: 'Denmark: Wind only (2 weeks)',
                  value: {
                    region: 'Denmark',
                    dateFrom: '2026-02-01',
                    dateTo: '2026-02-14',
                    generationType: 'wind',
                    includeStatistics: true,
                  },
                },
                spainSolar: {
                  summary: 'Spain: Solar only (1 month)',
                  value: {
                    region: 'Spain',
                    dateFrom: '01.01.2026',
                    dateTo: '31.01.2026',
                    generationType: 'solar',
                  },
                },
              },
            },
          },
        },
      },
      async handler(ctx) {
        return await CernionMCPClient.callWithNewSession(
          'entsoe_wind_solar_actual',
          ctx.params,
          ctx.meta.cernionToken
        );
      },
    },

    /**
     * Generation forecast by production type
     * Tool: entsoe_generation_forecast
     */
    generationForecast: {
      rest: 'POST /generation-forecast',
      params: {
        region: { type: 'string', min: 1 },
        dateFrom: { type: 'string' },
        dateTo: { type: 'string' },
        psrType: { type: 'string', optional: true },
        includeStatistics: { type: 'boolean', optional: true, default: true },
      },
      openapi: {
        summary: 'Day-ahead electricity generation forecasts by production type',
        tags: ['ENTSO-E'],
        description:
          '✅ FULLY WORKING - Comprehensive generation planning, all production types. Returns day-ahead generation forecasts by PSR type.',
        'x-backend-status': 'operational',
        requestBody: {
          required: true,
          content: {
            'application/json': {
              schema: {
                type: 'object',
                required: ['region', 'dateFrom', 'dateTo'],
                properties: {
                  region: {
                    type: 'string',
                    description: 'Country name',
                    example: 'Germany',
                  },
                  dateFrom: {
                    type: 'string',
                    description: 'Start date (can be future dates for forecasts)',
                    example: '2026-02-08',
                  },
                  dateTo: {
                    type: 'string',
                    description: 'End date',
                    example: '2026-02-14',
                  },
                  psrType: {
                    type: 'string',
                    description:
                      'Optional: Filter by PSR type (B16=Solar, B19=Wind Onshore, B14=Nuclear, B04=Gas)',
                    example: 'B16',
                  },
                  includeStatistics: {
                    type: 'boolean',
                    default: true,
                  },
                },
              },
              examples: {
                allTypesWeek: {
                  summary: 'All generation types (1 week forecast)',
                  value: {
                    region: 'Germany',
                    dateFrom: '2026-02-08',
                    dateTo: '2026-02-14',
                    includeStatistics: true,
                  },
                },
                solarForecast: {
                  summary: 'Solar generation forecast only',
                  value: {
                    region: 'Spain',
                    dateFrom: '2026-02-08',
                    dateTo: '2026-02-21',
                    psrType: 'B16',
                  },
                },
                nuclearForecast: {
                  summary: 'Nuclear generation forecast',
                  value: {
                    region: 'France',
                    dateFrom: '2026-02-08',
                    dateTo: '2026-03-07',
                    psrType: 'B14',
                  },
                },
              },
            },
          },
        },
      },
      async handler(ctx) {
        return await CernionMCPClient.callWithNewSession(
          'entsoe_generation_forecast',
          ctx.params,
          ctx.meta.cernionToken
        );
      },
    },

    /**
     * List PSR type codes
     * Tool: entsoe_psr_types
     */
    psrTypes: {
      rest: 'GET /psr-types',
      params: {},
      openapi: {
        summary: 'Retrieve list of ENTSO-E Production Source Type (PSR) codes',
        tags: ['ENTSO-E'],
        description:
          'Static reference data for PSR type codes used in generation queries. Common codes: B01=Biomass, B02=Fossil Brown coal/Lignite, B03=Fossil Coal-derived gas, B04=Fossil Gas, B05=Fossil Hard coal, B06=Fossil Oil, B09=Geothermal, B10=Hydro Pumped Storage, B11=Hydro Run-of-river, B12=Hydro Water Reservoir, B13=Marine, B14=Nuclear, B15=Other renewable, B16=Solar, B17=Waste, B18=Wind Offshore, B19=Wind Onshore, B20=Other',
        responses: {
          200: {
            description: 'List of PSR type codes with names and categories',
            content: {
              'application/json': {
                schema: {
                  type: 'object',
                  properties: {
                    success: { type: 'boolean' },
                    types: {
                      type: 'array',
                      items: {
                        type: 'object',
                        properties: {
                          code: { type: 'string', example: 'B16' },
                          name: { type: 'string', example: 'Solar' },
                          category: {
                            type: 'string',
                            enum: ['renewable', 'fossil', 'nuclear', 'other'],
                          },
                        },
                      },
                    },
                  },
                },
                example: {
                  success: true,
                  types: [
                    { code: 'B16', name: 'Solar', category: 'renewable' },
                    { code: 'B19', name: 'Wind Onshore', category: 'renewable' },
                    { code: 'B18', name: 'Wind Offshore', category: 'renewable' },
                    { code: 'B14', name: 'Nuclear', category: 'nuclear' },
                    { code: 'B04', name: 'Fossil Gas', category: 'fossil' },
                  ],
                },
              },
            },
          },
        },
      },
      async handler(ctx) {
        return await CernionMCPClient.callWithNewSession(
          'entsoe_psr_types',
          {},
          ctx.meta.cernionToken
        );
      },
    },
  },
};
