/**
 * Energy Market Data Service
 *
 * Prices, production, forecasts, installations
 * Maps to Cernion MCP energy market data category
 */

const CernionMCPClient = require('../src/mcp-client');
const { callWithAutoPoll } = require('../src/async-job-poller');

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
      },
      openapi: {
        summary: 'Electricity market prices (day-ahead, intraday, futures)',
        tags: ['Energy Market Data'],
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
            },
          },
        },
      },
      async handler(ctx) {
        return await CernionMCPClient.callWithNewSession(
          'cernion_energy_prices',
          ctx.params,
          ctx.meta.cernionToken
        );
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
      },
      openapi: {
        summary: 'Electricity generation data by energy source',
        tags: ['Energy Market Data'],
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
            },
          },
        },
      },
      async handler(ctx) {
        return await CernionMCPClient.callWithNewSession(
          'cernion_energy_production',
          ctx.params,
          ctx.meta.cernionToken
        );
      },
    },

    /**
     * Regional CO₂ intensity forecasts
     * Tool: cernion_co2_intensity
     */
    co2Intensity: {
      rest: 'POST /co2-intensity',
      params: {
        location: { type: 'string', optional: true, min: 1 },
        timestamp: { type: 'string', optional: true },
        forecast: { type: 'boolean', optional: true, default: false },
      },
      openapi: {
        summary: 'Regional CO₂ intensity forecasts (GrünstromIndex)',
        tags: ['Energy Market Data'],
        description: `Query CO2 intensity for any location in Germany from GrünstromIndex.

**Only 'location' is required.**

**Parameter Details:**
- **location**: German city name or postal code (e.g., "Heidelberg", "69115", "München", "10115")
- **timestamp**: Specific timestamp (ISO 8601 or natural language like "now", "tomorrow 14:00")
- **forecast**: Get 36-hour forecast instead of current value (default: false)

**Use Cases:**
- CO₂-optimized dynamic tariffs
- Smart EV charging (charge when grid is greenest)
- Load shifting for industrial consumers
- Green energy certificates

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
                  data: {
                    location: 'Heidelberg',
                    timestamp: '2026-02-07T14:00:00Z',
                    gCO2eqPerKWh: 287,
                    grsi: 45,
                    forecast: [{ timestamp: '2026-02-07T15:00:00Z', gCO2eqPerKWh: 275 }],
                  },
                },
              },
            },
          },
        },
      },
      async handler(ctx) {
        const result = await CernionMCPClient.callWithNewSession(
          'cernion_co2_intensity',
          ctx.params,
          ctx.meta.cernionToken
        );

        const forecastValues =
          result?.data?.forecast_next_24h_gco2eq_kwh ||
          result?.forecast_next_24h_gco2eq_kwh ||
          null;

        if (Array.isArray(forecastValues)) {
          const baseTimestamp = result?.data?.timestamp || result?.timestamp;
          const baseDate = baseTimestamp ? new Date(baseTimestamp) : null;
          const forecast = forecastValues.map((value, index) => {
            const timestamp = baseDate
              ? new Date(baseDate.getTime() + index * 60 * 60 * 1000).toISOString()
              : null;
            return {
              timestamp,
              gCO2eqPerKWh: value,
            };
          });

          result.data = {
            ...(result.data || {}),
            location: result?.data?.location || result?.location || ctx.params.location,
            timestamp: result?.data?.timestamp || result?.timestamp || null,
            forecast,
          };
        }

        return result;
      },
    },

    /**
     * Search energy installations in MaStR
     * Tool: cernion_installations
     */
    installations: {
      rest: 'POST /installations',
      params: {
        installationType: {
          type: 'enum',
          values: ['solar', 'wind', 'storage', 'biomass', 'hydro', 'combustion'],
        },
        location: { type: 'string', optional: true, min: 1 },
        postleitzahl: { type: 'string', optional: true, min: 5, max: 5 },
        limit: { type: 'number', optional: true, min: 1 },
        minCapacityKW: { type: 'number', optional: true, min: 0 },
        maxCapacityKW: { type: 'number', optional: true, min: 0 },
        commissioningYear: { type: 'number', optional: true, min: 1900, max: 2100 },
        gridOperatorId: { type: 'string', optional: true, min: 1 },
        gridOperatorMastrId: { type: 'string', optional: true, min: 1 },
        gridOperatorName: { type: 'string', optional: true, min: 1 },
        gridOperatorBdewCode: { type: 'string', optional: true, min: 1 },
        operationalStatus: { type: 'string', optional: true, default: '35' },
      },
      openapi: {
        summary: 'Search energy installations in German registry (MaStR)',
        tags: ['Energy Market Data'],
        description: `Search Marktstammdatenregister (MaStR) for energy installations.

**'installationType' is required.**

**Parameter Details:**
- **installationType**: Installation type - "solar" (PV), "wind", "storage" (batteries), "biomass", "hydro", "combustion" (CHP, gas turbines)
- **location**: City name, postal code, or region (deprecated; use bundesland/landkreis/gemeinde/postleitzahl in MCP tool)
- **operationalStatus**: Operational status filter - Default: "35" (only active/in operation). Values: "31" (planned), "35" (in operation), "37" (temporarily decommissioned), "38" (permanently decommissioned), "all" (all statuses), or comma-separated list (e.g., "35,37")
- **limit**: Max results (optional)
- **minCapacityKW**: Minimum installed capacity in kW (e.g., 5 for small installations, 100 for commercial)
- **maxCapacityKW**: Maximum installed capacity in kW
- **commissioningYear**: Filter by year of grid connection (1900-2100)
- **gridOperatorId**: MaStR Netzbetreiber-ID (SNB/GNB...), comma-separated (deprecated)
- **gridOperatorMastrId**: MaStR Netzbetreiber-ID (SNB/GNB...), preferred
- **gridOperatorName**: Netzbetreiber-Name (fuzzy matching)
- **gridOperatorBdewCode**: BDEW code (resolved to MaStR Netzbetreiber)

**Use Cases:**
- Portfolio analysis and benchmarking
- Site selection for new installations
- Market research and competitor analysis
- Grid planning (DSO/TSO)
- Redispatch 2.0 eligible installations

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
                    enum: ['solar', 'wind', 'storage', 'biomass', 'hydro', 'combustion'],
                    description: 'Type of energy installation',
                  },
                  location: {
                    type: 'string',
                    description: 'Location (city, postal code, or region) - deprecated',
                    example: 'Heidelberg',
                  },
                  limit: {
                    type: 'integer',
                    description: 'Maximum number of results (optional)',
                    minimum: 1,
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
                    description: 'Grid operator name (fuzzy matching)',
                    example: 'Netze BW',
                  },
                  gridOperatorBdewCode: {
                    type: 'string',
                    description: 'BDEW code (resolved to MaStR Netzbetreiber)',
                    example: '9900992720003',
                  },
                },
              },
              examples: {
                rooftopSolar: {
                  summary: 'Rooftop solar in Heidelberg',
                  value: {
                    installationType: 'solar',
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
              },
            },
          },
        },
        responses: {
          200: {
            description: 'Installation data retrieved',
            content: {
              'application/json': {
                example: {
                  success: true,
                  data: {
                    results: [
                      {
                        mastrNumber: 'SEE912345678901',
                        installationType: 'solar',
                        capacityKW: 9.9,
                        commissioningDate: '2023-05-15',
                        location: 'Heidelberg',
                        postalCode: '69115',
                      },
                    ],
                    count: 1,
                    limit: 20,
                  },
                },
              },
            },
          },
        },
      },
      async handler(ctx) {
        const toolParams = {
          type: ctx.params.installationType,
          postleitzahl: ctx.params.postleitzahl || ctx.params.location,
          limit: ctx.params.limit,
          minCapacity: ctx.params.minCapacityKW,
          maxCapacity: ctx.params.maxCapacityKW,
          commissioningYear: ctx.params.commissioningYear,
          gridOperatorMastrId: ctx.params.gridOperatorMastrId || ctx.params.gridOperatorId,
          gridOperatorName: ctx.params.gridOperatorName,
          gridOperatorBdewCode: ctx.params.gridOperatorBdewCode,
          format: 'detailed',
        };

        const result = await callWithAutoPoll(
          'cernion_installations_local',
          toolParams,
          {},
          ctx.meta.cernionToken
        );

        // Filter by operational status (default: only active installations with status 35)
        const operationalStatus = ctx.params.operationalStatus || '35';
        if (operationalStatus && operationalStatus !== 'all' && result?.data?.installations) {
          const allowedStatuses = operationalStatus.split(',').map(s => s.trim());
          result.data.installations = result.data.installations.filter(
            inst => allowedStatuses.includes(inst.einheitBetriebsstatus)
          );
          // Update stats
          if (result.data.stats) {
            result.data.stats.count = result.data.installations.length;
            result.data.stats.totalCapacity = result.data.installations.reduce(
              (sum, i) => sum + (i.bruttoleistung || 0), 0
            );
            result.data.stats.avgCapacity = result.data.stats.count > 0
              ? result.data.stats.totalCapacity / result.data.stats.count : 0;
          }
        }

        return result;
      },
    },
  },
};
