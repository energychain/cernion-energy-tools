/**
 * EWK Monitoring Service
 *
 * BNetzA Energiewendekompetenz (EWK) monitoring for German grid operators.
 * Data source: vnb-transparenz.de / BNetzA
 *
 * Covers three performance dimensions for ~820 German DSOs (VNBs):
 *  1. Anschlussdauer  – connection waiting times (median weeks)
 *  2. Digitalisierungsindex – digitalisation score (0–100 %)
 *  3. Umsetzungsquote – implementation rate of connection requests (%)
 *  4. Benchmark VNB   – combined profile for a single VNB
 */

const CernionMCPClient = require('../src/mcp-client');
const { applyFormat, FORMAT_PARAM_SCHEMA, FORMAT_RESPONSE_CONTENT } = require('../src/format-response');

module.exports = {
  name: 'ewk-monitoring',

  settings: {
    defaultTimeout: 30000,
  },

  actions: {
    /**
     * Connection duration (Anschlussdauer) for grid connections
     * Tool: ewk_anschlussdauer
     */
    anschlussdauer: {
      rest: 'POST /anschlussdauer',
      params: {
        vnbName: { type: 'string', optional: true },
        bnr: { type: 'string', optional: true },
        voltageLevel: {
          type: 'enum',
          values: ['NS', 'MS', 'HS', 'all'],
          optional: true,
          default: 'all',
        },
        installationType: {
          type: 'enum',
          values: ['EE', 'Verbrauch', 'all'],
          optional: true,
          default: 'all',
        },
        sortBy: { type: 'string', optional: true, default: 'anschlussdauer_asc' },
        limit: { type: 'number', optional: true, default: 50, min: 1, max: 820, convert: true },
        offset: { type: 'number', optional: true, default: 0, min: 0, convert: true },
        includeRanking: { type: 'boolean', optional: true, default: true },
        format: FORMAT_PARAM_SCHEMA,
      },
      openapi: {
        summary:
          'Connection waiting times (Anschlussdauer) per VNB – median weeks per voltage level and installation type',
        tags: ['EWK Monitoring (BNetzA)'],
        description: `Query BNetzA EWK connection-duration data for German distribution grid operators (VNBs).

**Data source:** [vnb-transparenz.de/EWK-Monitoring-BNetzA](https://www.vnb-transparenz.de/EWK-Monitoring-BNetzA) — self-reported annual data from ~820 VNBs.

**BNetzA indicators covered:**
| Indicator | Description |
|---|---|
| 4.3.1 / 4.3.2 | EE-Anlagen NS – Phase 1 (offer) / Phase 2 (commissioning) |
| 4.3.3 / 4.3.4 | EE-Anlagen MS |
| 4.3.5 / 4.3.6 | EE-Anlagen HS |
| 5.3.1 / 5.3.2 | Verbrauchsanlagen NS (wallboxes, heat pumps, storage) |
| 5.3.3 / 5.3.4 | Verbrauchsanlagen MS |
| 5.3.5 / 5.3.6 | Verbrauchsanlagen HS |

**Use cases:**
- Identify slow-connecting VNBs as consulting/software-sales targets
- §14a EnWG analysis: how quickly does a VNB connect controllable loads?
- §11 EnWG NEST compliance: benchmark a VNB against the national median
- Regulatory reporting: connection-time comparison for BNetzA submissions`,
        requestBody: {
          required: true,
          content: {
            'application/json': {
              schema: {
                type: 'object',
                properties: {
                  vnbName: {
                    type: 'string',
                    description:
                      'Partial VNB name search (case-insensitive, e.g. "Netze BW", "TWL Netze")',
                    example: 'TWL Netze',
                  },
                  bnr: {
                    type: 'string',
                    description: 'BNetzA operator number for exact lookup',
                    example: '10002345',
                  },
                  voltageLevel: {
                    type: 'string',
                    enum: ['NS', 'MS', 'HS', 'all'],
                    description:
                      'Voltage level filter: NS = low voltage, MS = medium voltage, HS = high voltage, all = no filter',
                    default: 'all',
                    example: 'NS',
                  },
                  installationType: {
                    type: 'string',
                    enum: ['EE', 'Verbrauch', 'all'],
                    description:
                      'Installation type: EE = renewable generation, Verbrauch = consumption (wallboxes, heat pumps, storage), all = no filter',
                    default: 'all',
                    example: 'EE',
                  },
                  sortBy: {
                    type: 'string',
                    enum: ['name', 'anschlussdauer_asc', 'anschlussdauer_desc'],
                    description:
                      'Sort order: anschlussdauer_asc = fastest first, anschlussdauer_desc = slowest first',
                    default: 'anschlussdauer_asc',
                    example: 'anschlussdauer_asc',
                  },
                  limit: {
                    type: 'integer',
                    minimum: 1,
                    maximum: 820,
                    default: 50,
                    description: 'Maximum number of VNBs to return',
                    example: 10,
                  },
                  offset: {
                    type: 'integer',
                    minimum: 0,
                    default: 0,
                    description: 'Pagination offset',
                    example: 0,
                  },
                  includeRanking: {
                    type: 'boolean',
                    default: true,
                    description: 'Include national ranking (e.g. "42 / 739")',
                    example: true,
                  },
                  format: FORMAT_PARAM_SCHEMA,
                },
              },
              examples: {
                top10FastestEE_NS: {
                  summary: 'Top 10 fastest VNBs for PV grid connection (NS)',
                  value: {
                    installationType: 'EE',
                    voltageLevel: 'NS',
                    sortBy: 'anschlussdauer_asc',
                    limit: 10,
                  },
                },
                twlNetze: {
                  summary: 'Anschlussdauer for a specific VNB',
                  value: { vnbName: 'TWL Netze' },
                },
                wallboxWaiting: {
                  summary: '§14a-relevant: wallbox connection times NS',
                  value: {
                    installationType: 'Verbrauch',
                    voltageLevel: 'NS',
                    sortBy: 'anschlussdauer_asc',
                  },
                },
                csvExport: {
                  summary: 'CSV export – all EE connection times',
                  value: { installationType: 'EE', format: 'csv' },
                },
              },
            },
          },
        },
        responses: {
          200: {
            description: 'Connection duration data retrieved successfully',
            content: {
              'application/json': {
                example: {
                  success: true,
                  data: {
                    results: [
                      {
                        vnbName: 'TWL Netze GmbH',
                        bnr: '10002345',
                        anschlussdauer_ee_ns_phase1_weeks: 14,
                        anschlussdauer_ee_ns_phase2_weeks: 21,
                        anschlussdauer_ee_ns_total_weeks: 35,
                        rank: '234 / 739',
                      },
                    ],
                    statistics: {
                      median_weeks: 28,
                      q25_weeks: 18,
                      q75_weeks: 42,
                      min_weeks: 4,
                      max_weeks: 104,
                    },
                    total: 1,
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
          'ewk_anschlussdauer',
          mcpParams,
          ctx.meta.cernionToken
        );
        return applyFormat(ctx, result, format, 'ewk-anschlussdauer', 'Anschlussdauer');
      },
    },

    /**
     * Digitalisation index for German DSOs
     * Tool: ewk_digitalisierungsindex
     */
    digitalisierungsindex: {
      rest: 'POST /digitalisierungsindex',
      params: {
        vnbName: { type: 'string', optional: true },
        bnr: { type: 'string', optional: true },
        category: {
          type: 'enum',
          values: [
            'gesamtscore',
            'smart_grids',
            'digitale_prozesse',
            'datenmanagement',
            'kundenmanagement',
            'all',
          ],
          optional: true,
          default: 'all',
        },
        sortBy: { type: 'string', optional: true, default: 'score_desc' },
        limit: { type: 'number', optional: true, default: 50, min: 1, max: 820, convert: true },
        offset: { type: 'number', optional: true, default: 0, min: 0, convert: true },
        includeRanking: { type: 'boolean', optional: true, default: true },
        format: FORMAT_PARAM_SCHEMA,
      },
      openapi: {
        summary:
          'Digitalisation index for German VNBs – 5 categories and up to 19 sub-indicators (0–100 %)',
        tags: ['EWK Monitoring (BNetzA)'],
        description: `Query BNetzA EWK digitalisation scores for German distribution grid operators.

**Categories:**
| Category | Sub-indicators | Description |
|---|---|---|
| \`gesamtscore\` | c001 | Weighted overall score |
| \`smart_grids\` | c002, c006–c008 | Smart grids (NS/MS/HS sensors, automation) |
| \`digitale_prozesse\` | c003, c009–c012 | Digital processes & AI |
| \`datenmanagement\` | c004, c013–c015 | Data management & analytics |
| \`kundenmanagement\` | c005, c016–c019 | Customer portals & self-service |
| \`all\` | all 19 | Full profile |

**Scores:** 0–100 % (higher = more digital); raw BNetzA values are 0–1 and normalised to percent here.

**Use cases:**
- Identify VNBs with low digitalisation → software/consulting sales targets
- Benchmark a VNB against the national median before a pitch
- M&A screening: low score + high Anschlussdauer → restructuring candidate
- ESG reporting: digitisation maturity of owned/regulated DSOs`,
        requestBody: {
          required: true,
          content: {
            'application/json': {
              schema: {
                type: 'object',
                properties: {
                  vnbName: {
                    type: 'string',
                    description: 'Partial VNB name search',
                    example: 'Bayernwerk Netz',
                  },
                  bnr: {
                    type: 'string',
                    description: 'BNetzA operator number for exact lookup',
                    example: '10001796',
                  },
                  category: {
                    type: 'string',
                    enum: [
                      'gesamtscore',
                      'smart_grids',
                      'digitale_prozesse',
                      'datenmanagement',
                      'kundenmanagement',
                      'all',
                    ],
                    description: 'Digitalisation category to return',
                    default: 'all',
                    example: 'digitale_prozesse',
                  },
                  sortBy: {
                    type: 'string',
                    enum: ['name', 'score_asc', 'score_desc'],
                    description: 'Sort order: score_desc = best first, score_asc = worst first',
                    default: 'score_desc',
                    example: 'score_desc',
                  },
                  limit: {
                    type: 'integer',
                    minimum: 1,
                    maximum: 820,
                    default: 50,
                    description: 'Maximum number of VNBs to return',
                    example: 20,
                  },
                  offset: {
                    type: 'integer',
                    minimum: 0,
                    default: 0,
                    description: 'Pagination offset',
                    example: 0,
                  },
                  includeRanking: {
                    type: 'boolean',
                    default: true,
                    description: 'Include national ranking',
                    example: true,
                  },
                  format: FORMAT_PARAM_SCHEMA,
                },
              },
              examples: {
                nationalRanking: {
                  summary: 'National ranking by overall score (top 20)',
                  value: { sortBy: 'score_desc', limit: 20 },
                },
                aiScore: {
                  summary: 'AI/digital processes score for all VNBs',
                  value: { category: 'digitale_prozesse', sortBy: 'score_desc' },
                },
                vnbProfile: {
                  summary: 'Full digitalisation profile for a specific VNB',
                  value: { vnbName: 'Bayernwerk Netz', category: 'all' },
                },
                csvExport: {
                  summary: 'CSV export – overall scores',
                  value: { category: 'gesamtscore', format: 'csv' },
                },
              },
            },
          },
        },
        responses: {
          200: {
            description: 'Digitalisation index data retrieved successfully',
            content: {
              'application/json': {
                example: {
                  success: true,
                  data: {
                    results: [
                      {
                        vnbName: 'Bayernwerk Netz GmbH',
                        bnr: '10001796',
                        gesamtscore_pct: 72.4,
                        smart_grids_pct: 85.0,
                        digitale_prozesse_pct: 68.0,
                        datenmanagement_pct: 61.5,
                        kundenmanagement_pct: 74.8,
                        rank: '45 / 789',
                      },
                    ],
                    statistics: {
                      median_gesamtscore_pct: 52.0,
                      q25_pct: 38.0,
                      q75_pct: 67.0,
                    },
                    total: 1,
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
          'ewk_digitalisierungsindex',
          mcpParams,
          ctx.meta.cernionToken
        );
        return applyFormat(ctx, result, format, 'ewk-digitalisierungsindex', 'Digitalisierungsindex');
      },
    },

    /**
     * Implementation rate (Umsetzungsquote) for grid connection requests
     * Tool: ewk_umsetzungsquote
     */
    umsetzungsquote: {
      rest: 'POST /umsetzungsquote',
      params: {
        vnbName: { type: 'string', optional: true },
        bnr: { type: 'string', optional: true },
        voltageLevel: {
          type: 'enum',
          values: ['NS', 'MS', 'HS', 'all'],
          optional: true,
          default: 'all',
        },
        installationType: {
          type: 'enum',
          values: ['EE', 'Verbrauch', 'all'],
          optional: true,
          default: 'all',
        },
        sortBy: { type: 'string', optional: true, default: 'rate_desc' },
        limit: { type: 'number', optional: true, default: 50, min: 1, max: 820, convert: true },
        offset: { type: 'number', optional: true, default: 0, min: 0, convert: true },
        includeRanking: { type: 'boolean', optional: true, default: true },
        format: FORMAT_PARAM_SCHEMA,
      },
      openapi: {
        summary:
          'Implementation rate (Umsetzungsquote) for connection requests – share of submitted applications that were realised',
        tags: ['EWK Monitoring (BNetzA)'],
        description: `Query BNetzA EWK implementation rates for German VNBs.

**BNetzA indicators covered:**
| Field | Indicator | Description |
|---|---|---|
| \`umsetzungsquote_ee_ns\` | c010 | EE-Anlagen NS |
| \`umsetzungsquote_ee_ms\` | c020 | EE-Anlagen MS |
| \`umsetzungsquote_ee_hs\` | c030 | EE-Anlagen HS |
| \`umsetzungsquote_verbrauch_ns\` | c041 | Consumption + storage NS |
| \`umsetzungsquote_verbrauch_ms\` | c053 | Consumption + storage MS |
| \`umsetzungsquote_verbrauch_hs\` | c064 | Consumption + storage HS |

**Also returned:** Absolute numbers (applications submitted vs. realised).

**Use cases:**
- Identify VNBs with low realisation rates → potential regulatory pressure or backlog
- §14a-relevant: how many wallbox/heat-pump applications are actually realised?
- Compliance screening: low rates may indicate structural bottlenecks
- Sales: VNBs with large backlogs need process digitalisation`,
        requestBody: {
          required: true,
          content: {
            'application/json': {
              schema: {
                type: 'object',
                properties: {
                  vnbName: {
                    type: 'string',
                    description: 'Partial VNB name search',
                    example: 'E.ON Energie Distribution',
                  },
                  bnr: {
                    type: 'string',
                    description: 'BNetzA operator number for exact lookup',
                    example: '10001796',
                  },
                  voltageLevel: {
                    type: 'string',
                    enum: ['NS', 'MS', 'HS', 'all'],
                    description: 'Voltage level filter',
                    default: 'all',
                    example: 'NS',
                  },
                  installationType: {
                    type: 'string',
                    enum: ['EE', 'Verbrauch', 'all'],
                    description: 'Installation type filter',
                    default: 'all',
                    example: 'EE',
                  },
                  sortBy: {
                    type: 'string',
                    enum: ['name', 'rate_asc', 'rate_desc'],
                    description:
                      'Sort order: rate_desc = highest rate first, rate_asc = lowest first (problem cases)',
                    default: 'rate_desc',
                    example: 'rate_asc',
                  },
                  limit: {
                    type: 'integer',
                    minimum: 1,
                    maximum: 820,
                    default: 50,
                    description: 'Maximum number of VNBs to return',
                    example: 20,
                  },
                  offset: {
                    type: 'integer',
                    minimum: 0,
                    default: 0,
                    description: 'Pagination offset',
                    example: 0,
                  },
                  includeRanking: {
                    type: 'boolean',
                    default: true,
                    description: 'Include national ranking',
                    example: true,
                  },
                  format: FORMAT_PARAM_SCHEMA,
                },
              },
              examples: {
                lowestEE_NS: {
                  summary: 'VNBs with lowest EE-NS realisation rate (problem cases)',
                  value: {
                    installationType: 'EE',
                    voltageLevel: 'NS',
                    sortBy: 'rate_asc',
                    limit: 20,
                  },
                },
                fullVnbProfile: {
                  summary: 'Full realisation profile for a specific VNB',
                  value: { vnbName: 'E.ON Energie Distribution', installationType: 'all' },
                },
                section14a: {
                  summary: '§14a-relevant: consumption/wallbox connections NS',
                  value: { installationType: 'Verbrauch', voltageLevel: 'NS' },
                },
                csvExport: {
                  summary: 'CSV export – EE realisation rates',
                  value: { installationType: 'EE', format: 'csv' },
                },
              },
            },
          },
        },
        responses: {
          200: {
            description: 'Implementation rate data retrieved successfully',
            content: {
              'application/json': {
                example: {
                  success: true,
                  data: {
                    results: [
                      {
                        vnbName: 'TWL Netze GmbH',
                        bnr: '10002345',
                        umsetzungsquote_ee_ns_pct: 100.0,
                        antraege_ee_ns: 37,
                        realisiert_ee_ns: 37,
                        umsetzungsquote_verbrauch_ns_pct: 92.9,
                        antraege_verbrauch_ns: 28,
                        realisiert_verbrauch_ns: 26,
                        rank: '145 / 745',
                      },
                    ],
                    statistics: {
                      median_ee_ns_pct: 97.5,
                      q25_pct: 91.0,
                      q75_pct: 100.0,
                    },
                    total: 1,
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
          'ewk_umsetzungsquote',
          mcpParams,
          ctx.meta.cernionToken
        );
        return applyFormat(ctx, result, format, 'ewk-umsetzungsquote', 'Umsetzungsquote');
      },
    },

    /**
     * Complete EWK benchmark profile for a single VNB
     * Tool: ewk_benchmark_vnb
     */
    benchmarkVnb: {
      rest: 'POST /benchmark-vnb',
      params: {
        vnbName: { type: 'string', min: 1 },
        bnr: { type: 'string', optional: true },
        format: FORMAT_PARAM_SCHEMA,
      },
      openapi: {
        summary:
          'Full EWK benchmark profile for a single VNB – combines Anschlussdauer, Digitalisierungsindex, and Umsetzungsquote',
        tags: ['EWK Monitoring (BNetzA)'],
        description: `Retrieve a complete EWK performance profile for one VNB combining all three BNetzA monitoring dimensions.

**Output sections:**
1. **Anschlussdauer** – median waiting times (weeks) per voltage level / installation type with national rank
2. **Digitalisierungsindex** – all 5 category scores (0–100 %) with national rank
3. **Umsetzungsquote** – application / realisation counts and rates per voltage level / type with national rank

**Output format:** Markdown tables (for LLM/agent readability) + structured JSON for programmatic use.

**Use cases:**
- Sales pitch preparation: "Where does the customer stand vs. the national median?"
- §11 EnWG NEST: justify network expansion by demonstrating connection-time backlog
- M&A due diligence: combined performance profile for a target DSO
- BNetzA submission: self-contained EWK benchmark document`,
        requestBody: {
          required: true,
          content: {
            'application/json': {
              schema: {
                type: 'object',
                required: ['vnbName'],
                properties: {
                  vnbName: {
                    type: 'string',
                    description:
                      'VNB name – partial match accepted (e.g. "TWL Netze GmbH" or "TWL Netze")',
                    example: 'TWL Netze',
                  },
                  bnr: {
                    type: 'string',
                    description: 'BNetzA operator number for exact lookup (overrides name match)',
                    example: '10002345',
                  },
                  format: FORMAT_PARAM_SCHEMA,
                },
              },
              examples: {
                twlNetze: {
                  summary: 'Full EWK profile for TWL Netze',
                  value: { vnbName: 'TWL Netze' },
                },
                byBnr: {
                  summary: 'Exact lookup via BNetzA operator number',
                  value: { vnbName: 'Netze BW', bnr: '10001796' },
                },
                csvExport: {
                  summary: 'CSV export of benchmark summary',
                  value: { vnbName: 'Bayernwerk Netz', format: 'csv' },
                },
              },
            },
          },
        },
        responses: {
          200: {
            description: 'EWK benchmark profile retrieved successfully',
            content: {
              'application/json': {
                example: {
                  success: true,
                  data: {
                    vnbName: 'TWL Netze GmbH',
                    bnr: '10002345',
                    anschlussdauer: {
                      rank: '234 / 739',
                      ee_ns_total_weeks: 35,
                      verbrauch_ns_total_weeks: 17,
                    },
                    digitalisierungsindex: {
                      rank: '156 / 789',
                      gesamtscore_pct: 58.2,
                      smart_grids_pct: 71.0,
                      digitale_prozesse_pct: 52.0,
                      datenmanagement_pct: 48.5,
                      kundenmanagement_pct: 61.3,
                    },
                    umsetzungsquote: {
                      rank: '145 / 745',
                      ee_ns_pct: 100.0,
                      verbrauch_ns_pct: 92.9,
                    },
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
          'ewk_benchmark_vnb',
          mcpParams,
          ctx.meta.cernionToken
        );
        return applyFormat(ctx, result, format, 'ewk-benchmark-vnb', 'EWK Benchmark');
      },
    },
  },
};
