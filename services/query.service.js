/**
 * Query Tools Service
 *
 * Natural language queries and template-based searches
 * Maps to Cernion MCP query tools category
 */

const CernionMCPClient = require('../src/mcp-client');
const { callWithAutoPoll } = require('../src/async-job-poller');

module.exports = {
  name: 'query',

  settings: {
    defaultTimeout: 5 * 60 * 1000, // 5 minutes for complex queries
  },

  actions: {
    /**
     * Natural language query to energy data
     * Tool: cernion_ask
     */
    ask: {
      rest: 'POST /ask',
      params: {
        query: { type: 'string', min: 1 },
        explain: { type: 'boolean', optional: true, default: false },
      },
      openapi: {
        summary: 'Natural language query to energy data (MaStR, ENTSO-E, SMARD)',
        tags: ['Query Tools'],
        description: `Execute natural language queries against German energy data sources including MaStR (Marktstammdatenregister), ENTSO-E Transparency Platform, and SMARD.de. Supports multi-source data aggregation and complex queries without SQL knowledge.

**Data Sources**:
- **MaStR**: German registry of all energy installations (PV, wind, storage, etc.)
- **ENTSO-E**: European electricity grid transparency data
- **SMARD**: German electricity market data

**Use Cases**:
- Ad-hoc data exploration ("How much PV capacity in Bavaria?")
- Quick questions without SQL knowledge
- Multi-source data aggregation
- Portfolio analysis and market research

**Response Time**: Typically 2-8 seconds (includes LLM reasoning)`,
        requestBody: {
          required: true,
          content: {
            'application/json': {
              schema: {
                type: 'object',
                required: ['query'],
                properties: {
                  query: {
                    type: 'string',
                    description: 'Natural language question in German or English',
                    minLength: 1,
                    example: 'Wie viele Solaranlagen gibt es in Heidelberg mit mehr als 10 kWp?',
                  },
                  explain: {
                    type: 'boolean',
                    description: 'Include detailed reasoning and data sources used',
                    default: false,
                  },
                },
              },
              examples: {
                regionalCapacity: {
                  summary: 'Regional PV capacity',
                  value: {
                    query: 'Wieviel PV-Leistung in Bayern?',
                  },
                },
                installationCount: {
                  summary: 'Installation count by city',
                  value: {
                    query: 'How many solar installations in Heidelberg with more than 10 kWp?',
                  },
                },
                yearlyComparison: {
                  summary: 'Yearly comparison',
                  value: {
                    query:
                      'Vergleiche die Anzahl neuer Windanlagen 2024 vs 2025 in Baden-Württemberg',
                  },
                },
                multiSource: {
                  summary: 'Multi-source aggregation',
                  value: {
                    query: 'Alle Redispatch-Anlagen bei Stadtwerke München',
                    explain: true,
                  },
                },
              },
            },
          },
        },
        responses: {
          200: {
            description: 'Successful query execution with answer and metadata',
            content: {
              'application/json': {
                schema: {
                  type: 'object',
                  properties: {
                    success: { type: 'boolean', example: true },
                    answer: {
                      type: 'string',
                      description: 'Natural language answer',
                      example: 'Total PV capacity in Bavaria: 31,604,839.789 kW',
                    },
                    data: { type: 'object', description: 'Structured data result' },
                    sources: {
                      type: 'array',
                      items: { type: 'string' },
                      description: 'Data sources used',
                      example: ['mastr_db'],
                    },
                    reasoning: {
                      type: 'array',
                      description: 'Query reasoning steps (if explain=true)',
                    },
                    metadata: { type: 'object', description: 'Execution metadata' },
                  },
                },
                example: {
                  success: true,
                  answer: 'Total PV capacity in Bavaria: 31,604,839.789 kW',
                  data: {
                    totalCapacityKW: 31604839.789,
                    installationCount: 582345,
                    region: 'Bayern',
                  },
                  sources: ['mastr_db'],
                  metadata: {
                    toolUsed: 'cernion_ask',
                    executionTime: 3.2,
                  },
                },
              },
            },
          },
        },
      },
      async handler(ctx) {
        return await CernionMCPClient.callWithNewSession(
          'cernion_ask',
          {
            query: ctx.params.query,
            explain: ctx.params.explain,
          },
          ctx.meta.cernionToken
        );
      },
    },

    /**
     * Template-based query with self-learning (20x faster)
     * Tool: cernion_ask_learned
     */
    askLearned: {
      rest: 'POST /ask-learned',
      params: {
        query: { type: 'string', min: 1 },
        confidence: { type: 'number', optional: true, min: 0, max: 1, default: 0.6, convert: true },
        forceGenerate: { type: 'boolean', optional: true, default: false },
        verbose: { type: 'boolean', optional: true, default: false },
      },
      openapi: {
        summary: 'Template-based queries using self-learning system (20x faster)',
        tags: ['Query Tools'],
        description: `Execute queries using learned templates from the Sprint 11 Self-Learning System. Reuses proven query patterns for 20x faster execution compared to cernion_ask. Falls back to LLM generation for new patterns.

**Performance**:
- **Template Match**: 50-200ms (20x faster than LLM)
- **New Pattern**: 2-8 seconds (same as cernion_ask, but learns for future use)
- **Confidence Threshold**: 0.6 (60%) default - higher = stricter matching

**Use Cases**:
- Recurring queries (regional capacity, installation counts)
- Performance-critical applications
- Batch processing (analyze multiple regions)
- Real-time dashboards
- API integrations requiring fast responses

**When to Use**:
- ✅ Recurring query patterns ("PV capacity in {region}")
- ✅ Performance-critical applications
- ✅ Batch processing
- ❌ First-time complex queries → use cernion_ask first
- ❌ Unstructured exploration → use cernion_ask`,
        requestBody: {
          required: true,
          content: {
            'application/json': {
              schema: {
                type: 'object',
                required: ['query'],
                properties: {
                  query: {
                    type: 'string',
                    description: 'Natural language query (same format as cernion_ask)',
                    minLength: 1,
                    example: 'PV-Leistung in Hessen',
                  },
                  confidence: {
                    type: 'number',
                    description: 'Minimum confidence threshold for template matching (0.0-1.0)',
                    minimum: 0.0,
                    maximum: 1.0,
                    default: 0.6,
                    example: 0.7,
                  },
                  forceGenerate: {
                    type: 'boolean',
                    description: 'Force LLM generation even if template matches (for testing)',
                    default: false,
                  },
                  verbose: {
                    type: 'boolean',
                    description:
                      'Show detailed reasoning and statistics (template used, confidence score)',
                    default: false,
                  },
                },
              },
              examples: {
                regionalCapacity: {
                  summary: 'Fast regional capacity query',
                  value: {
                    query: 'PV-Leistung in Hessen',
                  },
                },
                strictMatching: {
                  summary: 'Strict template matching',
                  value: {
                    query: 'Wie viele Windanlagen in Bayern?',
                    confidence: 0.8,
                    verbose: true,
                  },
                },
                forceNewPattern: {
                  summary: 'Force LLM generation',
                  value: {
                    query: 'Solaranlagen in Heidelberg über 10 kWp',
                    forceGenerate: true,
                  },
                },
                batchProcessing: {
                  summary: 'Batch processing (fast)',
                  value: {
                    query: 'PV-Leistung in Baden-Württemberg',
                  },
                },
              },
            },
          },
        },
        responses: {
          200: {
            description: 'Successful query execution with template information',
            content: {
              'application/json': {
                schema: {
                  type: 'object',
                  properties: {
                    success: { type: 'boolean', example: true },
                    result: { type: 'object', description: 'Query result data' },
                    templateUsed: {
                      type: 'boolean',
                      description: 'Whether a template was used',
                      example: true,
                    },
                    confidence: {
                      type: 'number',
                      description: 'Template matching confidence (0.0-1.0)',
                      example: 0.85,
                    },
                    executionTimeMs: {
                      type: 'number',
                      description: 'Execution time in milliseconds',
                      example: 45,
                    },
                    metadata: { type: 'object', description: 'Execution metadata' },
                  },
                },
                example: {
                  success: true,
                  result: {
                    totalCapacityKW: 5234567.89,
                    installationCount: 234567,
                    region: 'Hessen',
                  },
                  templateUsed: true,
                  confidence: 0.92,
                  executionTimeMs: 45,
                  metadata: {
                    toolUsed: 'cernion_ask_learned',
                    templateId: 'regional_capacity_pv_v3',
                    executionTime: 0.045,
                  },
                },
              },
            },
          },
        },
      },
      async handler(ctx) {
        return await CernionMCPClient.callWithNewSession(
          'cernion_ask_learned',
          {
            query: ctx.params.query,
            confidence: ctx.params.confidence,
            forceGenerate: ctx.params.forceGenerate,
            verbose: ctx.params.verbose,
          },
          ctx.meta.cernionToken
        );
      },
    },

    /**
     * Schema discovery for databases, tables, columns
     * Tool: cernion_discover
     */
    discover: {
      rest: 'POST /discover',
      params: {
        scope: {
          type: 'enum',
          values: ['tools', 'databases', 'tables', 'columns', 'operators', 'locations', 'examples'],
        },
        database: { type: 'string', optional: true },
        table: { type: 'string', optional: true },
        region: { type: 'string', optional: true },
      },
      openapi: {
        summary: 'Schema discovery for databases, tables, columns, and available tools',
        tags: ['Query Tools'],
        description: `Explore available data sources to prevent query errors and build dynamic UIs. Provides schema information about databases, tables, columns, operators, and available MCP tools.

**Scopes**:
- **tools**: List all available MCP tools by category
- **databases**: Available databases (mastr_db, energy_charts_api, etc.)
- **tables**: Tables in a specific database (requires database parameter)
- **columns**: Columns in a table (requires database + table parameters)
- **operators**: Available grid operators and energy suppliers
- **locations**: Available regions, states, and postal codes (optional region filter)
- **examples**: Sample queries for common use cases

**Use Cases**:
- Prevent query errors (validate parameters before execution)
- Build dynamic UIs with available options
- Explore data structure without documentation
- Auto-complete functionality for query builders
- Validate grid operator names before queries`,
        requestBody: {
          required: true,
          content: {
            'application/json': {
              schema: {
                type: 'object',
                required: ['scope'],
                properties: {
                  scope: {
                    type: 'string',
                    enum: [
                      'tools',
                      'databases',
                      'tables',
                      'columns',
                      'operators',
                      'locations',
                      'examples',
                    ],
                    description: 'Discovery scope - what to explore',
                    example: 'databases',
                  },
                  database: {
                    type: 'string',
                    description: 'Database name (required for tables/columns scope)',
                    example: 'mastr_db',
                  },
                  table: {
                    type: 'string',
                    description: 'Table name (required for columns scope)',
                    example: 'solar_extended',
                  },
                  region: {
                    type: 'string',
                    description: 'Optional filter for locations scope',
                    example: 'Baden-Württemberg',
                  },
                },
              },
              examples: {
                listDatabases: {
                  summary: 'List available databases',
                  value: {
                    scope: 'databases',
                  },
                },
                listTables: {
                  summary: 'List tables in MaStR database',
                  value: {
                    scope: 'tables',
                    database: 'mastr_db',
                  },
                },
                listColumns: {
                  summary: 'List columns in solar table',
                  value: {
                    scope: 'columns',
                    database: 'mastr_db',
                    table: 'solar_extended',
                  },
                },
                listTools: {
                  summary: 'List all available MCP tools',
                  value: {
                    scope: 'tools',
                  },
                },
                listOperators: {
                  summary: 'List grid operators',
                  value: {
                    scope: 'operators',
                  },
                },
                listLocations: {
                  summary: 'List locations in Baden-Württemberg',
                  value: {
                    scope: 'locations',
                    region: 'Baden-Württemberg',
                  },
                },
                getExamples: {
                  summary: 'Get sample queries',
                  value: {
                    scope: 'examples',
                  },
                },
              },
            },
          },
        },
        responses: {
          200: {
            description: 'Discovery result with requested information',
            content: {
              'application/json': {
                schema: {
                  type: 'object',
                  properties: {
                    success: { type: 'boolean', example: true },
                    scope: { type: 'string', example: 'databases' },
                    data: {
                      type: 'object',
                      description: 'Discovery results (structure depends on scope)',
                    },
                    metadata: { type: 'object' },
                  },
                },
                examples: {
                  databases: {
                    summary: 'Available databases',
                    value: {
                      success: true,
                      scope: 'databases',
                      databases: [
                        'mastr_db',
                        'energy_charts_api',
                        'deutschlandatlas',
                        'ntp_api',
                        'corrently_gsi_api',
                      ],
                      metadata: {
                        count: 5,
                        toolUsed: 'cernion_discover',
                      },
                    },
                  },
                  tools: {
                    summary: 'Available MCP tools by category',
                    value: {
                      success: true,
                      scope: 'tools',
                      tools: {
                        'Query Tools': ['cernion_ask', 'cernion_ask_learned', 'cernion_discover'],
                        'Energy Market Data': [
                          'cernion_energy_prices',
                          'cernion_energy_production',
                          'cernion_co2_intensity',
                        ],
                        'ENTSO-E': [
                          'entsoe_day_ahead_prices',
                          'entsoe_unavailability',
                          'entsoe_physical_flows',
                        ],
                      },
                      metadata: {
                        totalTools: 50,
                        categories: 9,
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
        return await CernionMCPClient.callWithNewSession('cernion_discover', {
          scope: ctx.params.scope,
          database: ctx.params.database,
          table: ctx.params.table,
          region: ctx.params.region,
        });
      },
    },
  },
};
