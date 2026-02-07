/**
 * Business Intelligence Service
 *
 * Market analysis, lead generation, tariff design, churn prediction
 * Maps to Cernion MCP business intelligence category
 */

const CernionMCPClient = require('../src/mcp-client');
const { callWithAutoPoll } = require('../src/async-job-poller');

module.exports = {
  name: 'business-intelligence',

  settings: {
    defaultTimeout: 10 * 60 * 1000, // 10 minutes for long-running analysis
  },

  actions: {
    /**
     * Identify sales leads from MaStR
     * Tool: cernion_sales_lead_identification
     */
    salesLeads: {
      rest: 'POST /sales-leads',
      params: {
        region: { type: 'string', min: 1 },
        installationType: { type: 'enum', values: ['solar', 'storage', 'wallbox', 'heatpump'] },
        daysBack: { type: 'number', optional: true, default: 30, min: 1, max: 365 },
        limit: { type: 'number', optional: true, default: 10, min: 1, max: 100 },
        minScore: { type: 'number', optional: true, default: 60, min: 0, max: 100 },
      },
      openapi: {
        summary: 'Identify sales leads from MaStR (new PV/wallbox/heatpump/storage installations)',
        tags: ['Business Intelligence'],
        description: `Identify high-quality B2C sales leads from new installations in MaStR registry. **Lead scoring system (0-100 points)**:

**Scoring Components**:
- **Commissioning date (40 points)**: Newer installations score higher - optimal contact window is 1-90 days after commissioning
- **Installation size (30 points)**: Prosumer sweet spot (5-15 kWp for solar) - indicates purchasing power and potential for additional products
- **Location (20 points)**: High-income areas, favorable demographics, low competition
- **Type (10 points)**: Solar + storage combo = premium lead (higher ARPU potential)

**Customer Segments**:
- **Residential Solar** (5-10 kWp): ARPU 600€, LTV 3k€ - Offer prosumer tariffs, storage retrofit
- **Prosumer Solar** (10-30 kWp): ARPU 1,450€, LTV 10k€ - **HIGH PRIORITY!** Premium tariffs, storage, wallbox
- **Storage Systems**: Cross-sell EV tariff, dynamic tariff, wallbox
- **Wallbox Owners**: Cross-sell dynamic tariff, solar retrofit
- **Heat Pumps**: Offer time-of-use tariff, optimization service

**Use Cases**:
- B2C customer acquisition campaigns
- Prosumer tariff marketing (highest ARPU segment)
- Storage retrofit campaigns (upsell to existing solar customers)
- Cross-sell opportunities (wallbox → dynamic tariff, solar → storage)
- Territory planning for sales teams

**Best Practices**:
- Contact window: 30-90 days after commissioning (sweet spot for engagement)
- Focus on prosumer segment (10-30 kWp) for maximum ROI
- Batch campaigns by postal code for efficient field sales
- Score threshold ≥70 for high-quality leads (30-40% conversion rate)
- Score threshold ≥80 for premium leads (50%+ conversion rate)`,
        requestBody: {
          required: true,
          content: {
            'application/json': {
              schema: {
                type: 'object',
                required: ['region', 'installationType'],
                properties: {
                  region: {
                    type: 'string',
                    description: 'Region/city/postal code to search',
                    example: 'Bayern',
                  },
                  installationType: {
                    type: 'string',
                    enum: ['solar', 'storage', 'wallbox', 'heatpump'],
                    description: 'Type of installation to find leads for',
                  },
                  daysBack: {
                    type: 'number',
                    description: 'How many days back to search for new installations',
                    minimum: 1,
                    maximum: 365,
                    default: 30,
                  },
                  limit: {
                    type: 'number',
                    description: 'Maximum number of leads to return',
                    minimum: 1,
                    maximum: 100,
                    default: 10,
                  },
                  minScore: {
                    type: 'number',
                    description: 'Minimum lead score (0-100)',
                    minimum: 0,
                    maximum: 100,
                    default: 60,
                  },
                },
              },
              examples: {
                recentSolarBavaria: {
                  summary: 'Recent solar installations in Bavaria',
                  value: {
                    region: 'Bayern',
                    installationType: 'solar',
                    daysBack: 30,
                    limit: 20,
                    minScore: 70,
                  },
                },
                storageLeadsMunich: {
                  summary: 'Storage system leads in Munich area',
                  value: {
                    region: '80331',
                    installationType: 'storage',
                    daysBack: 60,
                    limit: 10,
                    minScore: 60,
                  },
                },
                heatPumpLeads: {
                  summary: 'Heat pump installations (last 90 days)',
                  value: {
                    region: 'Baden-Württemberg',
                    installationType: 'heatpump',
                    daysBack: 90,
                    limit: 50,
                  },
                },
              },
            },
          },
        },
      },
      async handler(ctx) {
        // Use auto-polling for async jobs (lead identification can be slow for large regions)
        return await callWithAutoPoll(
          'cernion_sales_lead_identification',
          ctx.params,
          {
            maxWaitTime: 8 * 60 * 1000, // 8 minutes max
            pollInterval: 3000,
          },
          ctx.meta.cernionToken
        );
      },
    },

    /**
     * Calculate dynamic electricity tariffs
     * Tool: cernion_dynamic_tariff_calculator
     */
    dynamicTariffCalculator: {
      rest: 'POST /dynamic-tariff-calculator',
      params: {
        region: { type: 'string', min: 1 },
        tariffType: { type: 'enum', values: ['dynamic-spot', 'co2-optimized', 'time-of-use'] },
        calculationPeriod: { type: 'string' },
        customerProfile: {
          type: 'object',
          optional: true,
          props: {
            annualConsumption: { type: 'number', optional: true },
            flexibleLoad: { type: 'boolean', optional: true },
          },
        },
      },
      openapi: {
        summary: 'Calculate dynamic electricity tariffs based on market prices or CO₂ intensity',
        tags: ['Business Intelligence'],
        description: 'Dynamic tariff product design and customer savings calculation',
        requestBody: {
          required: true,
          content: {
            'application/json': {
              schema: {
                type: 'object',
                required: ['region', 'tariffType', 'calculationPeriod'],
                properties: {
                  region: {
                    type: 'string',
                    description: 'Region for tariff calculation',
                    example: 'Germany',
                  },
                  tariffType: {
                    type: 'string',
                    enum: ['dynamic-spot', 'co2-optimized', 'time-of-use'],
                    description: 'Type of dynamic tariff to calculate',
                  },
                  calculationPeriod: {
                    type: 'string',
                    description:
                      'Period for calculation (e.g., "2026-02", "Q1-2026", "2026-02-01 to 2026-02-28")',
                    example: '2026-02',
                  },
                  customerProfile: {
                    type: 'object',
                    properties: {
                      annualConsumption: {
                        type: 'number',
                        description: 'Annual consumption in kWh',
                        example: 3500,
                      },
                      flexibleLoad: {
                        type: 'boolean',
                        description: 'Whether customer can shift load',
                        default: false,
                      },
                    },
                  },
                },
              },
              examples: {
                spotPriceTariff: {
                  summary: 'Dynamic spot price tariff',
                  value: {
                    region: 'Germany',
                    tariffType: 'dynamic-spot',
                    calculationPeriod: '2026-02',
                    customerProfile: {
                      annualConsumption: 3500,
                      flexibleLoad: true,
                    },
                  },
                },
                co2Optimized: {
                  summary: 'CO₂-optimized tariff',
                  value: {
                    region: 'Germany',
                    tariffType: 'co2-optimized',
                    calculationPeriod: 'Q1-2026',
                    customerProfile: {
                      annualConsumption: 5000,
                      flexibleLoad: false,
                    },
                  },
                },
                timeOfUse: {
                  summary: 'Time-of-use tariff',
                  value: {
                    region: 'Bayern',
                    tariffType: 'time-of-use',
                    calculationPeriod: '2026-02-01 to 2026-02-28',
                  },
                },
              },
            },
          },
        },
      },
      async handler(ctx) {
        return await CernionMCPClient.callWithNewSession(
          'cernion_dynamic_tariff_calculator',
          ctx.params,
          ctx.meta.cernionToken
        );
      },
    },

    /**
     * Predict customer churn risk
     * Tool: cernion_customer_churn_prediction
     */
    churnPrediction: {
      rest: 'POST /churn-prediction',
      params: {
        customerSegment: {
          type: 'enum',
          values: ['residential', 'prosumer', 'commercial', 'premium', 'all'],
        },
        region: { type: 'string', min: 1 },
        riskThreshold: {
          type: 'enum',
          values: ['high', 'medium', 'low'],
          optional: true,
          default: 'medium',
        },
        limit: { type: 'number', optional: true, default: 100, min: 1, max: 500 },
        predictionWindowMonths: { type: 'number', optional: true, default: 3, min: 1, max: 12 },
        includeRetentionStrategy: { type: 'boolean', optional: true, default: true },
        includeValueSegmentation: { type: 'boolean', optional: true, default: true },
        includeChurnReasons: { type: 'boolean', optional: true, default: true },
        includeCompetitiveAnalysis: { type: 'boolean', optional: true, default: true },
      },
      openapi: {
        summary: 'Predict customer churn risk for energy suppliers',
        tags: ['Business Intelligence'],
        description: `Predict and prevent customer churn with ML-powered risk scoring. **Churn scoring system (0-100 points)**:

**Scoring Components**:
- **Contract status (30 points)**: <3 months to contract end = **CRITICAL** (30 points)
- **Price sensitivity (25 points)**: Price complaints, >10% above market, recent price increase, competitor comparison
- **Service quality (20 points)**: >5 support contacts, unresolved tickets, NPS Detractor (<6), negative feedback
- **Payment behavior (15 points)**: >2 late payments, payment method changes, manual vs. automatic payment
- **Usage pattern (10 points)**: Consumption declining >20%, no app usage (3+ months), no login activity

**Customer Segments & Business Value**:
- **Residential**: ARPU 600€, LTV 3k€, churn 10-12%, retention budget max 600€
- **Prosumer**: ARPU 1,450€, LTV 10k€, churn 5-8%, budget 2,000€ (**HIGH PRIORITY! Must protect**)
- **Commercial**: ARPU 10k€, LTV 50k€, churn 3-5%, budget unlimited (**MUST WIN! Strategic accounts**)
- **Premium**: ARPU >5k€, LTV >25k€, churn <3%, no budget limit (**VIP treatment required**)

**Retention Strategies by Risk Level**:
- **HIGH RISK (80-100)**: Immediate personal call + retention offer (max 200€ for residential, 2k€ for prosumer)
- **MEDIUM RISK (60-80)**: Automated email campaign + targeted incentive (max 100€ for residential)
- **LOW RISK (40-60)**: Proactive engagement (loyalty program, app activation, community features)

**Use Cases**:
- **Retention campaigns**: Target high-risk customers before contract ends
- **Customer lifetime value protection**: Focus on prosumer and commercial segments
- **Segmented marketing**: Different strategies for different risk/value segments
- **Service quality improvement**: Identify systemic issues causing churn
- **Budget optimization**: Allocate retention budget to highest ROI segments

**ROI Metrics**:
- Typical retention cost: 150-2,000€ depending on segment
- Expected retention success rate: 40-60% with proactive intervention
- Prosumer segment ROI: 19.3x (1,500€ cost saves 29k€ revenue)
- Commercial segment ROI: 33x+ (unlimited ROI for strategic accounts)

**Critical Success Factors**:
- **Act early**: 3-6 months before contract end (not 1 month!)
- **Segment ruthlessly**: Prosumer/Commercial = high touch, Residential = automated
- **Personalize approach**: Different reason = different retention strategy
- **Measure religiously**: Track retention rate by segment, reason, intervention type`,
        requestBody: {
          required: true,
          content: {
            'application/json': {
              schema: {
                type: 'object',
                required: ['customerSegment', 'region'],
                properties: {
                  customerSegment: {
                    type: 'string',
                    enum: ['residential', 'prosumer', 'commercial', 'premium', 'all'],
                    description: 'Customer segment to analyze',
                  },
                  region: {
                    type: 'string',
                    description: 'Region/postal code',
                    example: 'Bayern',
                  },
                  riskThreshold: {
                    type: 'string',
                    enum: ['high', 'medium', 'low'],
                    description: 'Minimum risk level to include',
                    default: 'medium',
                  },
                  limit: {
                    type: 'number',
                    minimum: 1,
                    maximum: 500,
                    default: 100,
                  },
                  predictionWindowMonths: {
                    type: 'number',
                    description: 'Prediction timeframe in months',
                    minimum: 1,
                    maximum: 12,
                    default: 3,
                  },
                  includeRetentionStrategy: {
                    type: 'boolean',
                    default: true,
                  },
                  includeValueSegmentation: {
                    type: 'boolean',
                    default: true,
                  },
                  includeChurnReasons: {
                    type: 'boolean',
                    default: true,
                  },
                  includeCompetitiveAnalysis: {
                    type: 'boolean',
                    default: true,
                  },
                },
              },
              examples: {
                prosumerHighRisk: {
                  summary: 'High-risk prosumers (3-month forecast)',
                  value: {
                    customerSegment: 'prosumer',
                    region: 'Bayern',
                    riskThreshold: 'high',
                    limit: 50,
                    predictionWindowMonths: 3,
                    includeRetentionStrategy: true,
                    includeValueSegmentation: true,
                  },
                },
                residentialAll: {
                  summary: 'All residential customers (6-month forecast)',
                  value: {
                    customerSegment: 'residential',
                    region: '80331',
                    riskThreshold: 'medium',
                    limit: 100,
                    predictionWindowMonths: 6,
                    includeChurnReasons: true,
                    includeCompetitiveAnalysis: true,
                  },
                },
                premiumSegment: {
                  summary: 'Premium customers at risk',
                  value: {
                    customerSegment: 'premium',
                    region: 'Baden-Württemberg',
                    riskThreshold: 'low',
                    limit: 200,
                  },
                },
              },
            },
          },
        },
      },
      async handler(ctx) {
        // Use auto-polling for async jobs (churn prediction can be slow for large customer bases)
        return await callWithAutoPoll(
          'cernion_customer_churn_prediction',
          ctx.params,
          {
            maxWaitTime: 8 * 60 * 1000, // 8 minutes max
            pollInterval: 3000,
          },
          ctx.meta.cernionToken
        );
      },
    },

    /**
     * Market penetration analysis
     * Tool: cernion_market_penetration_analysis
     */
    marketPenetration: {
      rest: 'POST /market-penetration',
      params: {
        region: { type: 'string', min: 1 },
        currentCustomers: { type: 'number', optional: true, min: 0 },
        installationType: {
          type: 'enum',
          values: ['solar', 'wind', 'storage', 'wallbox', 'heat-pump', 'all'],
          optional: true,
          default: 'all',
        },
        postalCodes: { type: 'array', items: 'string', optional: true },
        includeSegmentation: { type: 'boolean', optional: true, default: true },
        includeWhiteSpots: { type: 'boolean', optional: true, default: true },
        includeTrendAnalysis: { type: 'boolean', optional: true, default: true },
        includeCompetitorAnalysis: { type: 'boolean', optional: true, default: true },
        includeRecommendations: { type: 'boolean', optional: true, default: true },
      },
      openapi: {
        summary: 'Analyze market penetration rates for energy suppliers in specific regions',
        tags: ['Business Intelligence'],
        description:
          'Identify growth opportunities, untapped segments, and competitive positioning',
        requestBody: {
          required: true,
          content: {
            'application/json': {
              schema: {
                type: 'object',
                required: ['region'],
                properties: {
                  region: {
                    type: 'string',
                    description: 'Region to analyze (city, state, postal codes)',
                    example: 'München',
                  },
                  currentCustomers: {
                    type: 'number',
                    description: 'Current number of customers in the region',
                    minimum: 0,
                    example: 15000,
                  },
                  installationType: {
                    type: 'string',
                    enum: ['solar', 'wind', 'storage', 'wallbox', 'heat-pump', 'all'],
                    description: 'Installation type to analyze',
                    default: 'all',
                  },
                  postalCodes: {
                    type: 'array',
                    items: { type: 'string' },
                    description: 'Specific postal codes to include',
                    example: ['80331', '80333', '80335'],
                  },
                  includeSegmentation: {
                    type: 'boolean',
                    default: true,
                  },
                  includeWhiteSpots: {
                    type: 'boolean',
                    description: 'Identify untapped market areas',
                    default: true,
                  },
                  includeTrendAnalysis: {
                    type: 'boolean',
                    default: true,
                  },
                  includeCompetitorAnalysis: {
                    type: 'boolean',
                    default: true,
                  },
                  includeRecommendations: {
                    type: 'boolean',
                    default: true,
                  },
                },
              },
              examples: {
                municCityAnalysis: {
                  summary: 'Munich city market penetration',
                  value: {
                    region: 'München',
                    currentCustomers: 15000,
                    installationType: 'all',
                    includeSegmentation: true,
                    includeWhiteSpots: true,
                    includeTrendAnalysis: true,
                  },
                },
                solarSpecific: {
                  summary: 'Solar market in Bavaria',
                  value: {
                    region: 'Bayern',
                    currentCustomers: 50000,
                    installationType: 'solar',
                    includeCompetitorAnalysis: true,
                    includeRecommendations: true,
                  },
                },
                postalCodeAnalysis: {
                  summary: 'Specific postal codes analysis',
                  value: {
                    region: 'München',
                    postalCodes: ['80331', '80333', '80335', '80337'],
                    installationType: 'storage',
                    includeWhiteSpots: true,
                  },
                },
              },
            },
          },
        },
      },
      async handler(ctx) {
        // Use auto-polling for async jobs (market analysis can be slow)
        return await callWithAutoPoll(
          'cernion_market_penetration_analysis',
          ctx.params,
          {
            maxWaitTime: 8 * 60 * 1000, // 8 minutes max
            pollInterval: 3000,
          },
          ctx.meta.cernionToken
        );
      },
    },
  },
};
