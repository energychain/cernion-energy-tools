/**
 * Energy Market Data Service
 *
 * Prices, production, forecasts, installations
 * Maps to Cernion MCP energy market data category
 */

const CernionMCPClient = require('../src/mcp-client');
const { callWithAutoPoll } = require('../src/async-job-poller');
const {
  applyFormat,
  convertToCSV,
  FORMAT_PARAM_SCHEMA,
  FORMAT_RESPONSE_CONTENT,
} = require('../src/format-response');

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
        location: { type: 'string', optional: true, min: 1 },
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
        description: `Query CO2 intensity for any location in Germany from GrünstromIndex.

**Only 'location' is required.**

**Parameter Details:**
- **location**: German city name or postal code (e.g., "Heidelberg", "69115", "München", "10115")
- **timestamp**: Specific timestamp (ISO 8601 or natural language like "now", "tomorrow 14:00")
- **forecast**: Get 36-hour forecast instead of current value (default: false)
- **format**: Output format — "json" (default), "csv", "xlsx"/"xls". CSV includes \`# Location\`, \`# Current CO2 Intensity\`, \`# Average Today\` header comments followed by the hourly forecast rows.

**Use Cases:**
- CO₂-optimized dynamic tariffs
- Smart EV charging (charge when grid is greenest)
- Load shifting for industrial consumers
- Green energy certificates
- Power BI / Excel import with \`format=csv\`

**Data Source:** GrünstromIndex provides regional green energy forecasts with 36-hour horizon, factoring in renewable generation, grid mix, and transmission constraints.`,
        requestBody: {
          content: {
            'application/json': {
              schema: {
                type: 'object',
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

        const result = await CernionMCPClient.callWithNewSession(
          'cernion_co2_intensity',
          mcpParams,
          ctx.meta.cernionToken
        );

        // Normalise forecast array: MCP returns an array of raw numbers under
        // forecast_next_24h_gco2eq_kwh; convert to [{timestamp, gCO2eqPerKWh}] objects.
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
            location: result?.data?.location || result?.location || mcpParams.location,
            timestamp: result?.data?.timestamp || result?.timestamp || null,
            forecast,
          };
        }

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
          values: ['solar', 'wind', 'storage', 'biomass', 'hydro', 'combustion'],
        },
        location: { type: 'string', optional: true, min: 1 },
        postleitzahl: { type: 'string', optional: true, min: 5, max: 5 },
        postleitzahlNot: { type: 'string', optional: true, min: 2, max: 6 },
        limit: { type: 'any', optional: true },
        offset: { type: 'number', optional: true, min: 0, default: 0, convert: true },
        minCapacityKW: { type: 'number', optional: true, min: 0, convert: true },
        maxCapacityKW: { type: 'number', optional: true, min: 0, convert: true },
        commissioningYear: { type: 'number', optional: true, min: 1900, max: 2100, convert: true },
        gridOperatorId: { type: 'string', optional: true, min: 1 },
        gridOperatorMastrId: { type: 'string', optional: true, min: 1 },
        gridOperatorName: { type: 'string', optional: true, min: 1 },
        gridOperatorBdewCode: { type: 'string', optional: true, min: 1 },
        operationalStatus: { type: 'string', optional: true, default: '35' },
        netzbetreiberPruefungStatus: { type: 'string', optional: true },
        includeNapData: { type: 'boolean', optional: true, default: true },
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
                    enum: ['solar', 'wind', 'storage', 'biomass', 'hydro', 'combustion'],
                    description: 'Type of energy installation',
                    example: 'solar',
                  },
                  location: {
                    type: 'string',
                    description: 'Location (city, postal code, or region) - deprecated',
                    example: 'Heidelberg',
                  },
                  limit: {
                    oneOf: [
                      { type: 'integer', minimum: 1 },
                      { type: 'string', enum: ['all'] },
                    ],
                    description:
                      'Maximum number of results. Default: **1,000**. Set a high number (e.g. `1000000`) or `"all"` to retrieve the complete result set — the server paginates internally across multiple MCP calls so no offset handling is required on the client side.',
                    default: 1000,
                    example: 1000,
                  },
                  offset: {
                    type: 'integer',
                    description:
                      'Pagination offset — number of records to skip. Use with `limit` to retrieve pages beyond the first 1,000. Example: `offset=1000&limit=1000` fetches records 1,001–2,000.',
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
                    description: 'Grid operator name (fuzzy matching)',
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
        const { format, ...params } = ctx.params;
        const operationalStatus = params.operationalStatus || '35';
        const nbpStatus = params.netzbetreiberPruefungStatus;
        const startOffset = params.offset || 0;

        // Parse limit: accept number, numeric string, or 'all' / undefined (= fetch everything)
        const rawLimit = params.limit;
        const isUnlimited = rawLimit === undefined || rawLimit === null || rawLimit === 'all';
        const requestedLimit = isUnlimited ? Infinity : Math.max(1, Number(rawLimit) || 1000);

        const baseToolParams = {
          type: params.installationType,
          postleitzahl: params.postleitzahl || params.location,
          minCapacity: params.minCapacityKW,
          maxCapacity: params.maxCapacityKW,
          commissioningYear: params.commissioningYear,
          gridOperatorMastrId: params.gridOperatorMastrId || params.gridOperatorId,
          gridOperatorName: params.gridOperatorName,
          gridOperatorBdewCode: params.gridOperatorBdewCode,
          postleitzahlNot: params.postleitzahlNot,
          includeNapData: params.includeNapData,
          netzbetreiberPruefungStatus: nbpStatus,
          format: 'detailed',
        };

        // Internal pagination loop — transparently assembles the full result set
        // across multiple MCP calls (each capped at MCP_PAGE_SIZE=10,000 rows).
        let allInstallations = [];
        let firstResult = null;
        let dataExhausted = false;
        let currentOffset = startOffset;

        while (true) {
          const pageLimit = isUnlimited
            ? MCP_PAGE_SIZE
            : Math.min(requestedLimit - allInstallations.length, MCP_PAGE_SIZE);

          if (pageLimit <= 0) break;

          const pageResult = await callWithAutoPoll(
            'cernion_installations_local',
            { ...baseToolParams, limit: pageLimit, offset: currentOffset },
            {},
            ctx.meta.cernionToken
          );

          if (!firstResult) firstResult = pageResult;

          const pageRows = pageResult?.data?.installations || [];
          allInstallations.push(...pageRows);
          currentOffset += pageRows.length;

          if (pageRows.length < pageLimit) {
            dataExhausted = true; // MCP returned fewer than asked — no more data
            break;
          }
          if (!isUnlimited && allInstallations.length >= requestedLimit) break;
        }

        // Merge all pages into a single result object
        const result = firstResult || { success: true, data: { installations: [], stats: {} } };
        if (result?.data) {
          result.data.installations = allInstallations;
        }

        // Post-filter by operational status (default: only active status 35)
        if (operationalStatus && operationalStatus !== 'all' && result?.data?.installations) {
          const allowedStatuses = operationalStatus.split(',').map((s) => s.trim());
          result.data.installations = result.data.installations.filter((inst) =>
            allowedStatuses.includes(inst.einheitBetriebsstatus)
          );
          if (result.data.stats) {
            result.data.stats.count = result.data.installations.length;
            result.data.stats.totalCapacity = result.data.installations.reduce(
              (sum, i) => sum + (i.bruttoleistung || 0),
              0
            );
            result.data.stats.avgCapacity =
              result.data.stats.count > 0
                ? result.data.stats.totalCapacity / result.data.stats.count
                : 0;
          }
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
            if (result.data.stats) {
              result.data.stats.count = result.data.installations.length;
              result.data.stats.totalCapacity = result.data.installations.reduce(
                (sum, i) => sum + (i.bruttoleistung || 0),
                0
              );
              result.data.stats.avgCapacity =
                result.data.stats.count > 0
                  ? result.data.stats.totalCapacity / result.data.stats.count
                  : 0;
            }
          }
        }

        const rows = result?.data?.installations || [];

        // Pagination metadata: hasMore=true only when we stopped at the requested limit
        // (not when data was exhausted or unlimited fetch completed)
        if (result?.data) {
          result.data.pagination = {
            offset: startOffset,
            limit: isUnlimited ? 'all' : requestedLimit,
            count: rows.length,
            hasMore: !dataExhausted && !isUnlimited,
          };
        }

        return applyFormat(ctx, result, format, 'installations', 'Installations', rows);
      },
    },
  },
};
