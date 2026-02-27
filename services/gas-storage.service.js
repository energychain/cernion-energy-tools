/**
 * Gas Storage (AGSI) Service
 *
 * European gas storage monitoring from Gas Infrastructure Europe (GIE)
 * AGSI+ platform data
 */

const CernionMCPClient = require('../src/mcp-client');

module.exports = {
  name: 'gas-storage',

  settings: {
    defaultTimeout: 30000,
  },

  actions: {
    /**
     * Current gas storage data for European countries
     * Tool: agsi_country_storage
     */
    countryStorage: {
      rest: 'POST /country-storage',
      params: {
        country: { type: 'string', min: 2, max: 2 },
        includeOperators: { type: 'boolean', optional: true, default: false },
        includeFacilities: { type: 'boolean', optional: true, default: false },
      },
      openapi: {
        summary:
          'Current gas storage data for European countries (fill level, injection/withdrawal)',
        tags: ['Gas Storage (AGSI)'],
        description: `Get comprehensive gas storage data for European countries from AGSI+ platform.

**Data includes:**
- Current fill level (% and TWh)
- Daily injection/withdrawal rates
- Working gas capacity vs. consumption
- Days of coverage calculation
- Operator breakdown (optional)

**Use cases:**
- Supply security monitoring
- Winter preparation assessment
- EU 90% storage mandate compliance tracking`,
        requestBody: {
          content: {
            'application/json': {
              schema: {
                type: 'object',
                required: ['country'],
                properties: {
                  country: {
                    type: 'string',
                    description: 'ISO 3166-1 alpha-2 country code (e.g., "DE", "FR", "IT")',
                    example: 'DE',
                  },
                  includeOperators: {
                    type: 'boolean',
                    description: 'Include operator breakdown',
                    example: false,
                  },
                  includeFacilities: {
                    type: 'boolean',
                    description: 'Include facility-level data',
                    example: false,
                  },
                },
              },
              example: {
                country: 'DE',
                includeOperators: false,
                includeFacilities: false,
              },
              examples: {
                germanyStorage: {
                  summary: 'Current German gas storage',
                  value: { country: 'DE', includeOperators: false, includeFacilities: false },
                },
                franceStorage: {
                  summary: 'French storage with operator breakdown',
                  value: { country: 'FR', includeOperators: true, includeFacilities: false },
                },
                italyStorageFull: {
                  summary: 'Italian storage with full details',
                  value: { country: 'IT', includeOperators: true, includeFacilities: true },
                },
              },
            },
          },
        },
        responses: {
          200: {
            description: 'Gas storage data retrieved successfully',
            content: {
              'application/json': {
                example: {
                  success: true,
                  data: {
                    country: 'DE',
                    gasInStorage: 198.45,
                    gasInStoragePercentage: 83.2,
                    fullCapacity: 238.45,
                    trend: 'falling',
                    injection: 0,
                    withdrawal: 1234.5,
                    workingGasVolume: 194.5,
                    consumption: 24.3,
                    coverageDays: 8.0,
                  },
                },
              },
            },
          },
        },
      },
      async handler(ctx) {
        return await CernionMCPClient.callWithNewSession(
          'agsi_country_storage',
          ctx.params,
          ctx.meta.cernionToken
        );
      },
    },

    /**
     * Detailed storage data for specific operator
     * Tool: agsi_operator_storage
     */
    operatorStorage: {
      rest: 'POST /operator-storage',
      params: {
        operatorCode: { type: 'string', min: 1 },
        date: { type: 'string', optional: true },
        includeFacilities: { type: 'boolean', optional: true, default: true },
      },
      openapi: {
        summary: 'Detailed storage data for a specific storage system operator (SSO)',
        tags: ['Gas Storage (AGSI)'],
        description: `Get detailed storage data for a specific storage system operator including all managed facilities.

**Use EIC codes to identify operators** (e.g., "21X000000001262B" for RWE Gas Storage West).

**Data includes:**
- All managed facilities with individual fill levels
- Operator-level aggregates
- Current operations (injection/withdrawal)
- Technical capacities

**Use cases:**
- Operator performance monitoring
- Facility portfolio analysis
- Commercial due diligence`,
        requestBody: {
          content: {
            'application/json': {
              schema: {
                type: 'object',
                required: ['operatorCode'],
                properties: {
                  operatorCode: {
                    type: 'string',
                    description: 'Operator EIC code',
                    example: '21X000000001262B',
                  },
                  date: {
                    type: 'string',
                    description: 'Optional date in YYYY-MM-DD format',
                    example: '2024-01-15',
                  },
                  includeFacilities: {
                    type: 'boolean',
                    description: 'Include facility breakdown',
                    example: true,
                  },
                },
              },
              example: {
                operatorCode: '21X000000001262B',
                includeFacilities: true,
              },
              examples: {
                rweGasStorage: {
                  summary: 'RWE Gas Storage West (Germany)',
                  value: { operatorCode: '21X000000001262B', includeFacilities: true },
                },
                rweWithDate: {
                  summary: 'RWE Gas Storage on specific date',
                  value: { operatorCode: '21X000000001262B', date: '2024-01-15', includeFacilities: true },
                },
              },
            },
          },
        },
        responses: {
          200: {
            description: 'Operator storage data retrieved successfully',
            content: {
              'application/json': {
                example: {
                  success: true,
                  data: {
                    operatorName: 'RWE Gas Storage West',
                    totalCapacity: 15.2,
                    fillPercentage: 87.5,
                    facilities: [
                      { name: 'Epe H-Gas', capacity: 6.0, fill: 5.3, fillPercentage: 88.3 },
                      { name: 'Nüttermoor', capacity: 9.2, fill: 8.0, fillPercentage: 87.0 },
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
          'agsi_operator_storage',
          ctx.params,
          ctx.meta.cernionToken
        );
      },
    },

    /**
     * Historical time-series data
     * Tool: agsi_historical_data
     */
    historicalData: {
      rest: 'POST /historical-data',
      params: {
        country: { type: 'string', min: 2, max: 2 },
        from: { type: 'string' },
        to: { type: 'string' },
        aggregation: {
          type: 'enum',
          values: ['daily', 'weekly', 'monthly'],
          optional: true,
          default: 'daily',
        },
      },
      openapi: {
        summary: 'Historical time-series data (daily/weekly/monthly) for trend analysis',
        tags: ['Gas Storage (AGSI)'],
        description: `Retrieve historical gas storage time-series data with flexible aggregation.

**Aggregation levels:**
- daily: Day-by-day granularity
- weekly: Weekly averages
- monthly: Monthly aggregates

**Use cases:**
- Seasonal pattern analysis
- Forecasting models
- Year-over-year comparison
- Anomaly detection`,
        requestBody: {
          content: {
            'application/json': {
              schema: {
                type: 'object',
                required: ['country', 'from', 'to'],
                properties: {
                  country: {
                    type: 'string',
                    description: 'ISO 3166-1 alpha-2 country code',
                    example: 'DE',
                  },
                  from: {
                    type: 'string',
                    description: 'Start date (YYYY-MM-DD)',
                    example: '2024-01-01',
                  },
                  to: {
                    type: 'string',
                    description: 'End date (YYYY-MM-DD)',
                    example: '2024-12-31',
                  },
                  aggregation: {
                    type: 'string',
                    enum: ['daily', 'weekly', 'monthly'],
                    description: 'Data aggregation level',
                    example: 'daily',
                  },
                },
              },
              example: {
                country: 'DE',
                from: '2024-01-01',
                to: '2024-12-31',
                aggregation: 'daily',
              },
              examples: {
                germanHistory2024: {
                  summary: 'Full year 2024 daily data for Germany',
                  value: { country: 'DE', from: '2024-01-01', to: '2024-12-31', aggregation: 'daily' },
                },
                winterSeasonMonthly: {
                  summary: 'Winter season monthly aggregation',
                  value: { country: 'DE', from: '2024-10-01', to: '2025-03-31', aggregation: 'monthly' },
                },
                quarterlyFrance: {
                  summary: 'Q1 weekly data for France',
                  value: { country: 'FR', from: '2024-01-01', to: '2024-03-31', aggregation: 'weekly' },
                },
              },
            },
          },
        },
        responses: {
          200: {
            description: 'Historical data retrieved successfully',
            content: {
              'application/json': {
                example: {
                  success: true,
                  data: {
                    country: 'DE',
                    aggregation: 'daily',
                    dataPoints: 365,
                    timeSeries: [
                      { date: '2024-01-01', fillPercentage: 95.2, gasInStorage: 226.8 },
                      { date: '2024-01-02', fillPercentage: 94.8, gasInStorage: 225.9 },
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
          'agsi_historical_data',
          ctx.params,
          ctx.meta.cernionToken
        );
      },
    },

    /**
     * EU-wide aggregate statistics
     * Tool: agsi_eu_statistics
     */
    euStatistics: {
      rest: 'POST /eu-statistics',
      params: {
        includeCountryBreakdown: { type: 'boolean', optional: true, default: false },
      },
      openapi: {
        summary: 'EU-wide aggregate statistics (total capacity, fill level, days of coverage)',
        tags: ['Gas Storage (AGSI)'],
        description: `Get EU-wide aggregate gas storage statistics.

**Metrics included:**
- Total EU storage capacity
- Current fill level (% and TWh)
- EU average coverage days
- Country breakdown (optional)

**Use cases:**
- EU-wide supply security monitoring
- EU Storage Regulation (90% mandate) compliance
- Policy impact assessment`,
        requestBody: {
          content: {
            'application/json': {
              schema: {
                type: 'object',
                properties: {
                  includeCountryBreakdown: {
                    type: 'boolean',
                    description: 'Include per-country breakdown',
                    example: false,
                  },
                },
              },
              example: {
                includeCountryBreakdown: false,
              },
              examples: {
                euOverview: {
                  summary: 'EU aggregate statistics (no country breakdown)',
                  value: { includeCountryBreakdown: false },
                },
                euWithCountries: {
                  summary: 'EU statistics with per-country breakdown',
                  value: { includeCountryBreakdown: true },
                },
              },
            },
          },
        },
        responses: {
          200: {
            description: 'EU statistics retrieved successfully',
            content: {
              'application/json': {
                example: {
                  success: true,
                  data: {
                    totalCapacity: 1030.5,
                    currentFill: 856.2,
                    fillPercentage: 83.1,
                    averageCoverageDays: 92.5,
                    mandateCompliant: true,
                  },
                },
              },
            },
          },
        },
      },
      async handler(ctx) {
        return await CernionMCPClient.callWithNewSession(
          'agsi_eu_statistics',
          ctx.params,
          ctx.meta.cernionToken
        );
      },
    },

    /**
     * Multi-country comparison
     * Tool: agsi_compare_countries
     */
    compareCountries: {
      rest: 'POST /compare-countries',
      params: {
        countries: { type: 'array', items: 'string', min: 2 },
        metric: {
          type: 'enum',
          values: ['fill_percentage', 'capacity', 'withdrawal_rate', 'coverage_days'],
        },
      },
      openapi: {
        summary: 'Multi-country comparison (fill levels, capacities, trends)',
        tags: ['Gas Storage (AGSI)'],
        description: `Compare gas storage metrics across multiple European countries.

**Available metrics:**
- fill_percentage: Current storage fill level
- capacity: Total storage capacity
- withdrawal_rate: Current withdrawal rate
- coverage_days: Days of supply coverage

**Use cases:**
- Cross-border supply security analysis
- Policy effectiveness comparison
- Regional risk assessment`,
        requestBody: {
          content: {
            'application/json': {
              schema: {
                type: 'object',
                required: ['countries', 'metric'],
                properties: {
                  countries: {
                    type: 'array',
                    items: { type: 'string' },
                    description: 'Array of country codes (min 2)',
                    example: ['DE', 'FR', 'IT'],
                  },
                  metric: {
                    type: 'string',
                    enum: ['fill_percentage', 'capacity', 'withdrawal_rate', 'coverage_days'],
                    description: 'Comparison metric',
                    example: 'fill_percentage',
                  },
                },
              },
              example: {
                countries: ['DE', 'FR', 'IT'],
                metric: 'fill_percentage',
              },
              examples: {
                deFrItFillLevel: {
                  summary: 'Compare fill levels: DE, FR, IT',
                  value: { countries: ['DE', 'FR', 'IT'], metric: 'fill_percentage' },
                },
                euBigFiveCapacity: {
                  summary: 'Compare capacity: 5 largest EU storage countries',
                  value: { countries: ['DE', 'IT', 'FR', 'NL', 'AT'], metric: 'capacity' },
                },
                withdrawalRates: {
                  summary: 'Compare withdrawal rates',
                  value: { countries: ['DE', 'FR'], metric: 'withdrawal_rate' },
                },
              },
            },
          },
        },
        responses: {
          200: {
            description: 'Country comparison retrieved successfully',
            content: {
              'application/json': {
                example: {
                  success: true,
                  data: {
                    metric: 'fill_percentage',
                    comparison: [
                      { country: 'DE', value: 83.2 },
                      { country: 'FR', value: 91.5 },
                      { country: 'IT', value: 88.7 },
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
          'agsi_compare_countries',
          ctx.params,
          ctx.meta.cernionToken
        );
      },
    },

    /**
     * Trend analysis
     * Tool: agsi_storage_trend
     */
    storageTrend: {
      rest: 'POST /storage-trend',
      params: {
        country: { type: 'string', min: 2, max: 2 },
        period: { type: 'enum', values: ['week', 'month', 'quarter', 'year'] },
        endDate: { type: 'string', optional: true },
      },
      openapi: {
        summary: 'Trend analysis over defined periods (injection/withdrawal patterns, seasonality)',
        tags: ['Gas Storage (AGSI)'],
        description: `Analyze gas storage trends over defined time periods.

**Period options:**
- week: Last 7 days
- month: Last 30 days
- quarter: Last 90 days
- year: Last 365 days

**Trend metrics:**
- Injection/withdrawal rates
- Fill level changes
- Seasonal patterns

**Use cases:**
- Seasonal depletion rate calculation
- Anomaly detection
- Forecast validation`,
        requestBody: {
          content: {
            'application/json': {
              schema: {
                type: 'object',
                required: ['country', 'period'],
                properties: {
                  country: {
                    type: 'string',
                    description: 'ISO 3166-1 alpha-2 country code',
                    example: 'DE',
                  },
                  period: {
                    type: 'string',
                    enum: ['week', 'month', 'quarter', 'year'],
                    description: 'Trend analysis period',
                    example: 'month',
                  },
                  endDate: {
                    type: 'string',
                    description: 'Optional end date (YYYY-MM-DD)',
                    example: '2024-12-31',
                  },
                },
              },
              example: {
                country: 'DE',
                period: 'month',
              },
              examples: {
                germanMonthlyTrend: {
                  summary: 'German gas storage trend (last 30 days)',
                  value: { country: 'DE', period: 'month' },
                },
                germanQuarterTrend: {
                  summary: 'German quarterly trend with end date',
                  value: { country: 'DE', period: 'quarter', endDate: '2024-12-31' },
                },
                francYearlyTrend: {
                  summary: 'French full-year trend',
                  value: { country: 'FR', period: 'year' },
                },
              },
            },
          },
        },
        responses: {
          200: {
            description: 'Trend analysis retrieved successfully',
            content: {
              'application/json': {
                example: {
                  success: true,
                  data: {
                    country: 'DE',
                    period: 'month',
                    trend: 'decreasing',
                    averageWithdrawal: 1250.5,
                    fillLevelChange: -5.2,
                  },
                },
              },
            },
          },
        },
      },
      async handler(ctx) {
        return await CernionMCPClient.callWithNewSession(
          'agsi_storage_trend',
          ctx.params,
          ctx.meta.cernionToken
        );
      },
    },

    /**
     * Supply security assessment
     * Tool: agsi_supply_security_check
     */
    supplySecurityCheck: {
      rest: 'POST /supply-security-check',
      params: {
        country: { type: 'string', min: 2, max: 2 },
        winterMandateCheck: { type: 'boolean', optional: true, default: true },
      },
      openapi: {
        summary: 'Supply security assessment (fill level vs. consumption, EU 90% mandate)',
        tags: ['Gas Storage (AGSI)'],
        description: `Assess gas supply security status for a country.

**Security status levels:**
- SECURE: >70% fill level
- ADEQUATE: 50-70% fill level
- WARNING: 30-50% fill level
- CRITICAL: <30% fill level

**Checks include:**
- Current fill level vs. historical average
- EU 90% winter mandate compliance (Nov 1st target)
- Days of coverage calculation
- Withdrawal capacity adequacy

**Use cases:**
- Emergency preparedness planning
- Policy compliance monitoring
- Risk management`,
        requestBody: {
          content: {
            'application/json': {
              schema: {
                type: 'object',
                required: ['country'],
                properties: {
                  country: {
                    type: 'string',
                    description: 'ISO 3166-1 alpha-2 country code',
                    example: 'DE',
                  },
                  winterMandateCheck: {
                    type: 'boolean',
                    description: 'Check EU 90% winter mandate compliance',
                    example: true,
                  },
                },
              },
              example: {
                country: 'DE',
                winterMandateCheck: true,
              },
              examples: {
                germanyFull: {
                  summary: 'Germany supply security with EU mandate check',
                  value: { country: 'DE', winterMandateCheck: true },
                },
                franceBasic: {
                  summary: 'France basic security assessment',
                  value: { country: 'FR', winterMandateCheck: false },
                },
                italyWinter: {
                  summary: 'Italy winter preparedness check',
                  value: { country: 'IT', winterMandateCheck: true },
                },
              },
            },
          },
        },
        responses: {
          200: {
            description: 'Supply security assessment completed',
            content: {
              'application/json': {
                example: {
                  success: true,
                  data: {
                    country: 'DE',
                    status: 'SECURE',
                    fillPercentage: 83.2,
                    coverageDays: 92,
                    mandateCompliant: true,
                    recommendation: 'No action required',
                  },
                },
              },
            },
          },
        },
      },
      async handler(ctx) {
        return await CernionMCPClient.callWithNewSession(
          'agsi_supply_security_check',
          ctx.params,
          ctx.meta.cernionToken
        );
      },
    },
  },
};
