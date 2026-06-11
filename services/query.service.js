/**
 * Query Tools Service
 *
 * Natural language queries and template-based searches
 * Maps to Cernion MCP query tools category
 */

const CernionMCPClient = require('../src/mcp-client');

// ── Copilot search helpers ────────────────────────────────────────────────────

const MELO_ID_RE = /^DE[0-9A-Z]{20,}/i;

function matchesQuery(str, qLower) {
  return typeof str === 'string' && str.toLowerCase().includes(qLower);
}

function companyToResult(company) {
  const vnbMembers = (company.members || []).filter((m) => m.role === 'VNB');
  const parts = [];
  if (company.legalName && company.legalName !== company.displayName) {
    parts.push(company.legalName);
  }
  if (vnbMembers.length) parts.push(`VNB · BDEW ${vnbMembers[0].bdewCode}`);
  parts.push(`${company.members?.length ?? 0} Marktpartner · Status: ${company.status}`);
  return {
    id: company.companyId,
    title: company.displayName,
    excerpt: parts.join(' · '),
    domain: 'companies',
    type: 'company',
    status: company.status ?? null,
    url: `/api/companies/${company.companyId}`,
    metadata: {
      memberCount: company.members?.length ?? 0,
      hasVnb: vnbMembers.length > 0,
    },
  };
}

function meloToResult(melo) {
  const parts = [];
  if (melo.description || melo.name) parts.push(melo.description || melo.name);
  if (melo.type) parts.push(`Typ: ${melo.type}`);
  if (melo.gridOperatorMastrId) parts.push(`VNB: ${melo.gridOperatorMastrId}`);
  return {
    id: melo.meloId,
    title: melo.meloId,
    excerpt: parts.join(' · ') || melo.meloId,
    domain: 'edm',
    type: melo.type ?? 'melo',
    status: null,
    url: `/api/edm/melos/${melo.meloId}`,
    metadata: {
      sourceType: melo.sourceType ?? null,
      gridOperatorMastrId: melo.gridOperatorMastrId ?? null,
    },
  };
}

function vdmiToResult(item) {
  const parts = [];
  if (item.processType) parts.push(`Prozesstyp: ${item.processType}`);
  if (item.scope) parts.push(item.scope);
  if (item.nominationStatus && item.nominationStatus !== 'none') {
    parts.push(`Nominierung: ${item.nominationStatus}`);
  }
  return {
    id: item.id,
    title: item.name,
    excerpt: parts.join(' · ') || item.name,
    domain: 'vdmi',
    type: 'matrix',
    status: item.status ?? null,
    url: `/api/vdmi/${item.id}`,
    metadata: {
      processType: item.processType ?? null,
      nominationStatus: item.nominationStatus ?? null,
      evidenceCount: item.evidenceCount ?? 0,
    },
  };
}

function gridConnectionToResult(doc) {
  const operatorName =
    doc.gridOperator?.name ?? doc.gridOperator?.mastrId ?? 'Unbekannter Netzbetreiber';
  return {
    id: doc.id,
    title: `Netzanschluss-Validierung · ${operatorName}`,
    excerpt: `Entscheidung: ${doc.decision ?? '—'} · ${doc.createdAt ? doc.createdAt.slice(0, 10) : ''}`,
    domain: 'grid_connection',
    type: 'validation',
    status: doc.decision ?? null,
    url: `/api/grid-connection/validations/${doc.id}`,
    metadata: {
      gridOperatorName: operatorName,
      findingsCount: doc.findingsCount ?? null,
      createdAt: doc.createdAt ?? null,
    },
  };
}

function znpProjectToResult(project) {
  const layers = Array.isArray(project.layers) ? project.layers.join(', ') : '';
  const stats = project.graphStats
    ? `${project.graphStats.nodes} Knoten, ${project.graphStats.edges} Kanten`
    : null;
  return {
    id: project.projectId,
    title: project.name ?? project.projectId,
    excerpt: [layers ? `Schichten: ${layers}` : null, stats].filter(Boolean).join(' · ') || project.projectId,
    domain: 'znp',
    type: 'project',
    status: 'active',
    url: `/api/znp/projects/${project.projectId}`,
    metadata: {
      graphStats: project.graphStats ?? null,
      createdAt: project.createdAt ?? null,
    },
  };
}

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
     * Structured search for Microsoft 365 Copilot and OpenAPI plugin integrations.
     * Deterministic, fast — no MCP calls, no LLM. Uses internal Moleculer services only.
     */
    search: {
      rest: 'GET /search',
      params: {
        q: { type: 'string', min: 1, max: 200, trim: true },
        domain: {
          type: 'enum',
          values: ['companies', 'vnb', 'edm', 'vdmi', 'grid_connection', 'znp', 'all'],
          optional: true,
          default: 'all',
        },
        limit: { type: 'number', optional: true, default: 10, min: 1, max: 25, convert: true },
      },
      openapi: {
        summary: 'Search Cernion energy objects (companies, VDMI, ZNP, grid connections, EDM)',
        operationId: 'searchCernionData',
        'x-openai-isConsequential': false,
        description: `Search across Cernion energy management data for use in Microsoft 365 Copilot, OpenAPI plugins, and connected integrations.

**Supported domains**:
- **companies** — Search company entities (Stadtwerke, Konzernverbund) by name. Returns BDEW codes, market roles, member count.
- **vnb** — Narrow search to companies with a Verteilnetzbetreiber (VNB) market role.
- **edm** — Look up a Messlokalisation (MeLo) by its exact DE-prefixed ID.
- **vdmi** — Search VDMI responsibility matrix instances by name, scope, or process type.
- **grid_connection** — Search past grid connection validation reports by operator name or decision.
- **znp** — Search Zielnetzplanung projects by name.
- **all** (default) — Searches all domains in parallel.

Each result carries **domain**, **type**, **id**, **title**, **excerpt**, **status**, and **url** pointing to the detail endpoint for that object.

**Performance**: Deterministic, < 300 ms. Does not invoke any external API or LLM.

**For complex natural-language queries** (e.g. "PV-Kapazität in Bayern") use POST /ask instead.`,
        tags: ['Query Tools', 'Copilot'],
        parameters: [
          {
            name: 'q',
            in: 'query',
            required: true,
            description:
              'Search term. Company/VNB name, VDMI matrix name, ZNP project name, grid operator name, or exact MeLo ID (DE…). German or English.',
            schema: { type: 'string', minLength: 1, maxLength: 200, example: 'Stadtwerke Heidelberg' },
          },
          {
            name: 'domain',
            in: 'query',
            required: false,
            description:
              'Restrict search to a specific data domain. Defaults to "all" which searches all domains in parallel.',
            schema: {
              type: 'string',
              enum: ['companies', 'vnb', 'edm', 'vdmi', 'grid_connection', 'znp', 'all'],
              default: 'all',
              example: 'vdmi',
            },
          },
          {
            name: 'limit',
            in: 'query',
            required: false,
            description: 'Maximum number of results to return (1–25).',
            schema: { type: 'integer', minimum: 1, maximum: 25, default: 10 },
          },
        ],
        responses: {
          200: {
            description: 'Search results from matched domains',
            content: {
              'application/json': {
                schema: {
                  type: 'object',
                  properties: {
                    query: { type: 'string', description: 'The original search term', example: 'Stadtwerke Heidelberg' },
                    domain: {
                      type: 'string',
                      enum: ['companies', 'vnb', 'edm', 'vdmi', 'grid_connection', 'znp', 'all'],
                      example: 'all',
                    },
                    totalResults: { type: 'integer', example: 2 },
                    results: {
                      type: 'array',
                      items: {
                        type: 'object',
                        properties: {
                          id: { type: 'string', description: 'Unique identifier within the domain', example: '550e8400-e29b-41d4-a716-446655440000' },
                          title: { type: 'string', description: 'Primary display name', example: 'Stadtwerke Heidelberg GmbH & Co. KG' },
                          excerpt: { type: 'string', description: 'One-line context string with key attributes' },
                          domain: {
                            type: 'string',
                            description: 'Source domain of this result',
                            enum: ['companies', 'edm', 'vdmi', 'grid_connection', 'znp'],
                          },
                          type: { type: 'string', description: 'Object type within the domain', example: 'company' },
                          status: { type: 'string', nullable: true, description: 'Lifecycle or decision status of the object', example: 'active' },
                          url: { type: 'string', description: 'API path to retrieve the full record', example: '/api/companies/550e8400-e29b-41d4-a716-446655440000' },
                          metadata: { type: 'object', description: 'Domain-specific structured attributes' },
                        },
                        required: ['id', 'title', 'excerpt', 'domain', 'type', 'status', 'url'],
                      },
                    },
                  },
                  required: ['query', 'domain', 'totalResults', 'results'],
                },
                examples: {
                  companyHit: {
                    summary: 'Company result',
                    value: {
                      query: 'Stadtwerke Heidelberg',
                      domain: 'all',
                      totalResults: 1,
                      results: [{
                        id: '550e8400-e29b-41d4-a716-446655440000',
                        title: 'Stadtwerke Heidelberg',
                        excerpt: 'Stadtwerke Heidelberg GmbH & Co. KG · VNB · BDEW 9900277000000 · 2 Marktpartner · Status: active',
                        domain: 'companies',
                        type: 'company',
                        status: 'active',
                        url: '/api/companies/550e8400-e29b-41d4-a716-446655440000',
                        metadata: { memberCount: 2, hasVnb: true },
                      }],
                    },
                  },
                  vdmiHit: {
                    summary: 'VDMI matrix result',
                    value: {
                      query: 'Netzanschluss',
                      domain: 'vdmi',
                      totalResults: 1,
                      results: [{
                        id: 'abc123',
                        title: 'Netzanschluss-Genehmigung PV',
                        excerpt: 'Prozesstyp: standard · Nominierung: pending',
                        domain: 'vdmi',
                        type: 'matrix',
                        status: 'active',
                        url: '/api/vdmi/abc123',
                        metadata: { processType: 'standard', nominationStatus: 'pending', evidenceCount: 2 },
                      }],
                    },
                  },
                  gridConnectionHit: {
                    summary: 'Grid connection validation result',
                    value: {
                      query: 'TWL Netze',
                      domain: 'grid_connection',
                      totalResults: 1,
                      results: [{
                        id: 'a1b2c3d4-1234-5678-90ab-cdef12345678',
                        title: 'Netzanschluss-Validierung · TWL Netze',
                        excerpt: 'Entscheidung: GO_CONDITIONAL · 2026-03-30',
                        domain: 'grid_connection',
                        type: 'validation',
                        status: 'GO_CONDITIONAL',
                        url: '/api/grid-connection/validations/a1b2c3d4-1234-5678-90ab-cdef12345678',
                        metadata: { gridOperatorName: 'TWL Netze', findingsCount: 3, createdAt: '2026-03-30T10:00:00Z' },
                      }],
                    },
                  },
                  noResults: {
                    summary: 'No results',
                    value: { query: 'nonexistent', domain: 'all', totalResults: 0, results: [] },
                  },
                },
              },
            },
          },
          400: {
            description: 'Validation error — q is missing or too long, limit out of range',
            content: {
              'application/json': {
                schema: {
                  type: 'object',
                  properties: {
                    name: { type: 'string', example: 'ValidationError' },
                    message: { type: 'string' },
                  },
                },
              },
            },
          },
        },
      },
      async handler(ctx) {
        const { q, domain, limit } = ctx.params;
        const qLower = q.toLowerCase();
        const callOpts = { meta: { ...ctx.meta, $gateway: false } };
        const results = [];

        const includeCompanies = domain === 'all' || domain === 'companies' || domain === 'vnb';
        const includeEdm = domain === 'all' || domain === 'edm';
        const includeVdmi = domain === 'all' || domain === 'vdmi';
        const includeGridConnection = domain === 'all' || domain === 'grid_connection';
        const includeZnp = domain === 'all' || domain === 'znp';

        const tasks = [];

        if (includeCompanies) {
          tasks.push(
            ctx
              .call('company.list', { query: q, limit, status: 'all' }, callOpts)
              .then((r) => ({ kind: 'companies', data: r }))
              .catch(() => ({ kind: 'companies', data: { companies: [] } }))
          );
        }

        if (includeEdm && MELO_ID_RE.test(q)) {
          tasks.push(
            ctx
              .call('edm.getMelo', { meloId: q.trim().toUpperCase() }, callOpts)
              .then((r) => ({ kind: 'edm', data: r && r.meloId ? [r] : [] }))
              .catch(() => ({ kind: 'edm', data: [] }))
          );
        }

        if (includeVdmi) {
          tasks.push(
            ctx
              .call('vdmi.list', { limit: 50 }, callOpts)
              .then((r) => ({ kind: 'vdmi', data: r && r.items ? r.items : [] }))
              .catch(() => ({ kind: 'vdmi', data: [] }))
          );
        }

        if (includeGridConnection) {
          tasks.push(
            ctx
              .call('grid-connection.list', { limit: 50 }, callOpts)
              .then((r) => ({ kind: 'grid_connection', data: r && r.validations ? r.validations : [] }))
              .catch(() => ({ kind: 'grid_connection', data: [] }))
          );
        }

        if (includeZnp) {
          tasks.push(
            ctx
              .call('znp.listProjects', {}, callOpts)
              .then((r) => ({ kind: 'znp', data: r && r.projects ? r.projects : [] }))
              .catch(() => ({ kind: 'znp', data: [] }))
          );
        }

        const settled = await Promise.all(tasks);

        for (const { kind, data } of settled) {
          if (kind === 'companies') {
            const companies = (data.companies || []).slice(0, limit);
            const filtered =
              domain === 'vnb'
                ? companies.filter((c) => (c.members || []).some((m) => m.role === 'VNB'))
                : companies;
            for (const company of filtered) results.push(companyToResult(company));
          }
          if (kind === 'edm') {
            for (const melo of (Array.isArray(data) ? data : []).slice(0, limit)) {
              results.push(meloToResult(melo));
            }
          }
          if (kind === 'vdmi') {
            const matched = data
              .filter(
                (item) =>
                  matchesQuery(item.name, qLower) ||
                  matchesQuery(item.scope, qLower) ||
                  matchesQuery(item.processType, qLower)
              )
              .slice(0, limit);
            for (const item of matched) results.push(vdmiToResult(item));
          }
          if (kind === 'grid_connection') {
            const matched = data
              .filter(
                (doc) =>
                  matchesQuery(doc.gridOperator?.name, qLower) ||
                  matchesQuery(doc.decision, qLower)
              )
              .slice(0, limit);
            for (const doc of matched) results.push(gridConnectionToResult(doc));
          }
          if (kind === 'znp') {
            const matched = data
              .filter(
                (project) =>
                  matchesQuery(project.name, qLower) || matchesQuery(project.projectId, qLower)
              )
              .slice(0, limit);
            for (const project of matched) results.push(znpProjectToResult(project));
          }
        }

        return {
          query: q,
          domain,
          totalResults: results.length,
          results: results.slice(0, limit),
        };
      },
    },

    /**
     * Body-based variant for Copilot Studio connector actions.
     * Copilot Studio often models connector operations as a single PowerFx
     * record argument, so requestBody is more reliable than query params.
     */
    searchCopilot: {
      rest: 'POST /search',
      params: {
        q: { type: 'string', min: 1, max: 200, trim: true },
        domain: {
          type: 'enum',
          values: ['companies', 'vnb', 'edm', 'vdmi', 'grid_connection', 'znp', 'all'],
          optional: true,
          default: 'all',
        },
        limit: { type: 'number', optional: true, default: 10, min: 1, max: 25, convert: true },
      },
      openapi: {
        summary: 'Search Cernion data with a JSON request body',
        operationId: 'searchCernionDataBody',
        'x-openai-isConsequential': false,
        description:
          'Search Cernion entities from Copilot Studio. Provide q as the search term, optionally domain and limit. Read-only.',
        tags: ['Query Tools', 'Copilot'],
        requestBody: {
          required: true,
          content: {
            'application/json': {
              schema: {
                type: 'object',
                properties: {
                  q: {
                    type: 'string',
                    minLength: 1,
                    maxLength: 200,
                    description:
                      'Required search term, such as a city, company, VNB, VDMI matrix, ZNP project, grid operator, or MeLo ID.',
                    example: 'Wiesloch',
                  },
                  domain: {
                    type: 'string',
                    enum: ['companies', 'vnb', 'edm', 'vdmi', 'grid_connection', 'znp', 'all'],
                    default: 'all',
                    description:
                      'Optional search domain. Use vnb to find distribution grid operators.',
                    example: 'vnb',
                  },
                  limit: {
                    type: 'integer',
                    minimum: 1,
                    maximum: 25,
                    default: 10,
                    description: 'Optional maximum number of results.',
                    example: 5,
                  },
                },
                required: ['q'],
              },
            },
          },
        },
        responses: {
          200: {
            description: 'Search results from matched domains',
            content: {
              'application/json': {
                schema: {
                  type: 'object',
                  properties: {
                    query: { type: 'string', description: 'The original search term' },
                    domain: {
                      type: 'string',
                      enum: ['companies', 'vnb', 'edm', 'vdmi', 'grid_connection', 'znp', 'all'],
                    },
                    totalResults: { type: 'integer' },
                    results: {
                      type: 'array',
                      items: { type: 'object' },
                    },
                  },
                  required: ['query', 'domain', 'totalResults', 'results'],
                },
              },
            },
          },
          400: {
            description: 'Validation error',
          },
        },
      },
      async handler(ctx) {
        return ctx.call('query.search', ctx.params, { meta: ctx.meta });
      },
    },

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
