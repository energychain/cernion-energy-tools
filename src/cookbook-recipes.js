'use strict';

/**
 * Community cookbook recipes (code-managed, git-tracked).
 *
 * Integrators can extend this list via pull requests.
 * Runtime metadata such as `relatedRecipes`, `status`, and embeddings
 * is computed dynamically by cookbook.service.js.
 *
 * Domain assumptions (hotspot thresholds, CAPEX economics, §14a policy, §42c heuristics)
 * are imported from src/domain-config.js and referenced in recipe parameters.
 *
 * @version 0.20.6
 */

const {
  HOTSPOT_THRESHOLDS,
  CAPEX_ASSUMPTIONS,
  SECTION_14A_POLICY,
  SECTION_42C_HEURISTICS,
} = require('./domain-config');

const COOKBOOK_RECIPE_SCHEMA = {
  type: 'object',
  strict: 'remove',
  props: {
    id: { type: 'string', min: 3 },
    title: { type: 'string', min: 5 },
    domain: { type: 'string', min: 2 },
    tags: { type: 'array', items: 'string' },
    problem: { type: 'string', min: 10 },
    process: {
      type: 'array',
      min: 1,
      items: {
        type: 'object',
        strict: 'remove',
        props: {
          step: { type: 'number', integer: true, positive: true },
          service: { type: 'string', min: 2 },
          action: { type: 'string', min: 3 },
          restPath: { type: 'string', optional: true },
          params: { type: 'object', optional: true },
          description: { type: 'string', min: 5 },
          expectedOutput: { type: 'string', optional: true },
        },
      },
    },
    expectedResult: { type: 'string', min: 8 },
    prerequisites: { type: 'array', items: 'string', optional: true },
    deprecated: { type: 'boolean', optional: true },
  },
};

const COOKBOOK_RECIPES = [
  {
    id: 'vnb-assets-from-name',
    title: 'Find VNB assets from company name',
    domain: 'grid-operations',
    tags: ['vnb', 'assets', 'resolution', 'mastr'],
    problem:
      'A user mentions a grid operator by name and wants installations without knowing BDEW or MaStR IDs.',
    process: [
      {
        step: 1,
        service: 'grid-operations',
        action: 'grid-operations.marketPartners',
        restPath: 'POST /api/grid-operations/market-partners',
        params: { query: null, limit: 3 },
        description: 'Resolve market partner record and BDEW metadata.',
        expectedOutput: 'Company candidates with BDEW code and contacts.',
      },
      {
        step: 2,
        service: 'grid-operations',
        action: 'grid-operations.vnbLookup',
        restPath: 'POST /api/grid-operations/vnb-lookup',
        params: {
          bdew: '__step_1.data.results[0].bdewCode',
          city: '__step_1.data.results[0].contacts[0].city',
        },
        description: 'Resolve canonical MaStR grid operator ID.',
        expectedOutput: 'MaStR SNB ID for subsequent installation queries.',
      },
      {
        step: 3,
        service: 'assets',
        action: 'assets.solar',
        restPath: 'GET /api/assets/solar',
        params: {
          gridOperatorId: '__step_2.data.mastrId',
          bdewCode: '__step_1.data.results[0].bdewCode',
          vnbName: '__step_1.data.results[0].companyName',
        },
        description: 'Retrieve assets for the resolved operator.',
        expectedOutput: 'Installation list with capacity and status fields.',
      },
    ],
    expectedResult: 'A validated installation inventory for the named grid operator.',
    prerequisites: ['Operator/company name'],
  },
  {
    id: 'residual-load-co2-price-window',
    title: 'Residual load with CO₂ and price context',
    domain: 'planning',
    tags: ['residual-load', 'co2', 'prices', 'forecast'],
    problem:
      'A Stadtwerk needs time-window guidance for flexible loads based on residual load, CO₂ intensity, and day-ahead prices.',
    process: [
      {
        step: 1,
        service: 'grid-operations',
        action: 'grid-operations.marketPartners',
        restPath: 'POST /api/grid-operations/market-partners',
        params: { query: null, limit: 3 },
        description: 'Resolve city and BDEW code of the operator.',
      },
      {
        step: 2,
        service: 'grid-operations',
        action: 'grid-operations.vnbLookup',
        restPath: 'POST /api/grid-operations/vnb-lookup',
        params: {
          bdew: '__step_1.data.results[0].bdewCode',
          city: '__step_1.data.results[0].contacts[0].city',
        },
        description: 'Resolve MaStR grid operator ID.',
      },
      {
        step: 3,
        service: 'residual-load',
        action: 'residual-load.netResidualLoad',
        restPath: 'POST /api/residual-load/net-residual-load',
        params: {
          gridOperatorMastrId: '__step_2.data.mastrId',
          region: '__step_1.data.results[0].contacts[0].city',
          forecastDays: null,
        },
        description: 'Compute residual load trajectory.',
      },
      {
        step: 4,
        service: 'energy-market',
        action: 'energy-market.co2Intensity',
        restPath: 'POST /api/energy-market/co2-intensity',
        params: {
          location: '__step_1.data.results[0].contacts[0].city',
          forecast: true,
        },
        description: 'Retrieve CO₂ intensity forecast for same region/time horizon.',
      },
      {
        step: 5,
        service: 'energy-market',
        action: 'energy-market.prices',
        restPath: 'POST /api/energy-market/prices',
        params: {
          market: 'day-ahead',
          region: 'Deutschland',
          startDate: null,
          endDate: null,
        },
        description: 'Attach monetary context with EPEX day-ahead prices.',
      },
    ],
    expectedResult: 'Joint optimization windows with load, emissions, and €/MWh effect.',
    prerequisites: ['Operator name', 'Forecast horizon'],
  },
  {
    id: 'inhouse-metering-spot-cost',
    title: 'Join inhouse metering with spot prices',
    domain: 'inhouse-analytics',
    tags: ['inhouse', 'metering', 'cost', 'join'],
    problem:
      'An uploaded inhouse load profile should be priced against spot market values without SQL.',
    process: [
      {
        step: 1,
        service: 'in-memory-join',
        action: 'in-memory-join.meteringSpotCost',
        restPath: 'POST /api/in-memory-join/metering-spot-cost',
        params: {
          sourceId: null,
          date: null,
          market: 'day-ahead',
        },
        description: 'Combine metering intervals and market prices fully in-memory.',
        expectedOutput: 'Interval-level cost rows and aggregates.',
      },
    ],
    expectedResult: 'Costed inhouse time series with transparent pricing lineage.',
    prerequisites: ['Inhouse sourceId', 'Date or date range'],
  },
  {
    id: 'direktvermarkter-portfolio',
    title: 'Direct marketer portfolio lookup',
    domain: 'market-partners',
    tags: ['direktvermarkter', 'portfolio', 'assets'],
    deprecated: true,
    problem:
      'A user asks for installations managed by a direct marketer (Direktvermarkter). NOTE: DirektvermarkterMastrNummer is excluded from all BNetzA public bulk exports — assets.byDirektvermarkter returns 0 results in practice. Use fernsteuerbarkeitDv:true + minCapacity:100 on cernion_installations_local as proxy (Wind/Biomass only).',
    process: [
      {
        step: 1,
        service: 'grid-operations',
        action: 'grid-operations.direktvermarkterLookup',
        restPath: 'POST /api/grid-operations/direktvermarkter-lookup',
        params: { name: null },
        description: 'Resolve direct marketer identity and MaStR ID.',
      },
      {
        step: 2,
        service: 'assets',
        action: 'assets.byDirektvermarkter',
        restPath: 'POST /api/assets/by-direktvermarkter',
        params: {
          direktvermarkterMastrId: '__step_1.data.results[0].mastrId',
          direktvermarkterName: '__step_1.data.results[0].name',
          installationType: 'all',
        },
        description: 'Retrieve portfolio assets assigned to the marketer.',
      },
    ],
    expectedResult: 'Portfolio list and capacity summary for the resolved Direktvermarkter.',
    prerequisites: ['Direktvermarkter name'],
  },
  {
    id: 'grid-connection-validation',
    title: 'Run deterministic grid connection validation',
    domain: 'agent-validation',
    tags: ['validation', 'grid-connection', 'deterministic'],
    problem:
      'Assess Netzanschluss readiness and risk with deterministic findings for a VNB portfolio.',
    process: [
      {
        step: 1,
        service: 'grid-connection',
        action: 'grid-connection.validate',
        restPath: 'POST /api/grid-connection/validate',
        params: {
          operatorMastrId: null,
        },
        description: 'Execute 6-step Netzanschluss validation pipeline.',
      },
    ],
    expectedResult: 'Decision, findings, and audit trail snapshot for regulator-ready reporting.',
    prerequisites: ['MaStR operator ID or resolvable BDEW code'],
  },
  {
    id: 'fnav-contract-gate-netzsignal-priority',
    title: 'Validate fNAV contract gate with Netzsignal priority evidence',
    domain: 'grid_connection_flexibility',
    tags: ['fnav', 'netzfahrplan', 'netzsignal', 'contract-gate', 'finance'],
    problem:
      'A flexible connection request should be validated only if Netzsignal priority wording and control evidence are explicitly documented.',
    process: [
      {
        step: 1,
        service: 'grid-connection',
        action: 'grid-connection.fnavValidate',
        restPath: 'POST /api/grid-connection/fnav/validate',
        params: {
          gridOperatorName: null,
          voltageLevel: 'MS',
          ownerContact: null,
          fnavProfile: {
            requestedCapacity: null,
            firmCapacity: null,
            flexibleCapacity: null,
            curtailmentWindow: null,
            signalPriorityPolicy: null,
            controlEvidenceRef: null,
            contractStatus: null,
            legalStatus: null,
          },
        },
        description: 'Run the deterministic Phase-5 validation and surface contract-gate blockers.',
      },
      {
        step: 2,
        service: 'finance-agent',
        action: 'finance-agent.fnavEconomics',
        restPath: 'POST /api/finance-agent/fnav/economics',
        params: {
          gridOperator: '__step_1.data.gridOperatorName',
          voltageLevel: '__step_1.data.voltageLevel',
          ownerContact: '__step_1.data.ownerContact',
          fnavProfile: '__step_1.data.fnavProfile',
          annualFeeEur: null,
        },
        description: 'Reuse the validated profile for additive CAPEX/payback evaluation.',
      },
    ],
    expectedResult:
      'Technical feasibility, explicit contract-gate status, and additive economics for the same fNAV profile.',
    prerequisites: ['Grid operator', 'Requested capacity', 'Signal priority wording', 'Control evidence reference'],
  },
  {
    id: 'energy-sharing-validation',
    title: 'Validate an Energy Sharing community (§42c EnWG)',
    domain: 'agent-validation',
    tags: ['energy-sharing', 'enwg-42c', 'validation'],
    problem:
      'Validate generators, direct marketing constraints, and allocation eligibility for an energy sharing setup.',
    process: [
      {
        step: 1,
        service: 'energy-sharing',
        action: 'energy-sharing.validate',
        restPath: 'POST /api/energy-sharing/validate',
        params: {
          operatorId: null,
          generators: null,
          consumers: null,
        },
        description: 'Run deterministic 6-step Energy Sharing validation.',
      },
    ],
    expectedResult: 'Eligibility decision and finding timeline for the proposed community.',
    prerequisites: ['Operator reference', 'Generator list', 'Consumer list'],
  },
  {
    id: 'mastr-quality-audit',
    title: 'Audit MaStR portfolio quality',
    domain: 'agent-validation',
    tags: ['mastr', 'quality', 'audit'],
    problem: 'Audit completeness and data-quality risks for a full VNB portfolio.',
    process: [
      {
        step: 1,
        service: 'mastr-quality',
        action: 'mastr-quality.audit',
        restPath: 'POST /api/mastr-quality/audit',
        params: {
          operatorMastrId: null,
          skipSteps: [],
        },
        description: 'Run deterministic 8-step quality audit with weighted scoring.',
      },
    ],
    expectedResult: 'Quality score and actionable findings by dimension.',
    prerequisites: ['Operator identifier'],
  },
  {
    id: 'redispatch-settlement-audit',
    title: 'Redispatch 2.0 ex-post settlement readiness audit',
    domain: 'agent-validation',
    tags: ['redispatch', 'settlement', 'risk'],
    problem:
      'Check settlement readiness and financial risk exposure for Redispatch 2.0 ex-post processes.',
    process: [
      {
        step: 1,
        service: 'redispatch-expost',
        action: 'redispatch-expost.audit',
        restPath: 'POST /api/redispatch/audit',
        params: {
          operatorMastrId: null,
          skipSteps: [],
        },
        description: 'Execute 7-step deterministic redispatch ex-post audit.',
      },
    ],
    expectedResult: 'Settlement readiness percentage and loss-risk assessment.',
    prerequisites: ['Operator identifier'],
  },
  {
    id: 'oep-research-dataset-discovery',
    title: 'Discover OEP datasets for research questions',
    domain: 'research-datasets',
    tags: ['oep', 'research', 'datasets', 'discovery'],
    problem: 'A research question requires scenario data from Open Energy Platform datasets.',
    process: [
      {
        step: 1,
        service: 'oep',
        action: 'oep.search',
        restPath: 'GET /api/oep/search',
        params: { q: null, limit: 10 },
        description: 'Find matching OEP tables/schemas by keyword.',
      },
      {
        step: 2,
        service: 'oep',
        action: 'oep.getTableMeta',
        restPath: 'GET /api/oep/tables/:schema/:table/meta',
        params: { schema: null, table: null },
        description: 'Inspect table schema before querying rows.',
      },
    ],
    expectedResult: 'A validated OEP table shortlist with schema context for analysis.',
    prerequisites: ['Research keyword or topic'],
  },
  // ─── MONITORING (5 recipes) ───────────────────────────────────────────────
  {
    id: 'vnb-full-snapshot',
    title: 'Full VNB health snapshot with alerts',
    domain: 'monitoring',
    tags: ['vnb-monitor', 'snapshot', 'alerts', 'ewk'],
    problem:
      'A grid operator needs a full health check combining KPI metrics, EWK benchmarks, and live alert status.',
    process: [
      {
        step: 1,
        service: 'vnb-monitor',
        action: 'vnb-monitor.snapshot',
        restPath: 'GET /api/vnb-monitor/:bdewCode',
        params: { bdewCode: null, refresh: false, alerts: true, lang: 'de' },
        description:
          'Fetch composite VNB snapshot including MaStR assets, EWK benchmarks, and alerts.',
        expectedOutput: 'mastr, ewk, alerts fields with current KPI values.',
      },
      {
        step: 2,
        service: 'vnb-monitor',
        action: 'vnb-monitor.alerts',
        restPath: 'GET /api/vnb-monitor/:bdewCode/alerts',
        params: { bdewCode: null, lang: 'de' },
        description: 'Pull full alert list with threshold breach details.',
        expectedOutput: 'Array of alert objects with severity, threshold, and current value.',
      },
    ],
    expectedResult:
      'Complete operator health report with KPI status and active alert list for dashboard display.',
    prerequisites: ['BDEW code of the grid operator'],
  },
  {
    id: 'nbp-parameter-management',
    title: 'Inspect and update NBP KPI 2 parameters',
    domain: 'monitoring',
    tags: ['nbp-monitor', 'parameters', 'configuration'],
    problem:
      'A compliance team needs to review and adjust NBP (Netzanschlussprozess) KPI 2 scoring parameters.',
    process: [
      {
        step: 1,
        service: 'nbp-monitor',
        action: 'nbp-monitor.getParameters',
        restPath: 'GET /api/nbp-monitor/parameters',
        params: {},
        description: 'Retrieve current NBP KPI 2 parameters with source (store or defaults).',
        expectedOutput: 'Parameters object with source indicator.',
      },
      {
        step: 2,
        service: 'nbp-monitor',
        action: 'nbp-monitor.setParameters',
        restPath: 'PUT /api/nbp-monitor/parameters',
        params: { parameters: null },
        description: 'Persist updated parameters to the Object Store.',
        expectedOutput: 'Updated parameter set confirmed with source: store.',
      },
    ],
    expectedResult:
      'NBP KPI 2 parameters updated and persisted; changes take effect on next snapshot call.',
    prerequisites: ['full-access API token', 'Updated parameter values'],
  },
  {
    id: 'dashboard-vnb-overview',
    title: 'Pull composite VNB dashboard overview',
    domain: 'monitoring',
    tags: ['dashboard', 'vnb', 'kpi', 'overview'],
    problem:
      'A frontend needs a single-call composite response combining VNB identity, KPIs, latest agent results, and live alerts.',
    process: [
      {
        step: 1,
        service: 'dashboard-api',
        action: 'dashboard-api.vnbOverview',
        restPath: 'GET /api/dashboard/vnb-overview',
        params: { bdewCode: null },
        description:
          'Fetch 5-minute-cached composite overview: identity, KPIs, agent results, alerts.',
        expectedOutput: '{ identity, kpis, latestAgentResults, alerts, timestamp, _errors }',
      },
    ],
    expectedResult: 'Single-call UI-ready response for the VNB overview dashboard card.',
    prerequisites: ['BDEW code of the target grid operator'],
  },
  {
    id: 'dashboard-load-profile-stream-monitor',
    title: 'Monitor Lastgangdaten with strict anomaly classes',
    domain: 'monitoring',
    tags: ['dashboard', 'lastgang', 'bewegungsstrom', 'edm', 'anomaly', 'forecast'],
    problem:
      'Operations teams need a single read-only view that separates data-quality gaps, real anomalies, forecast issues, and governance breaks for one MeLo stream.',
    process: [
      {
        step: 1,
        service: 'dashboard-api',
        action: 'dashboard-api.loadProfileStreamMonitor',
        restPath: 'GET /api/dashboard/load-profile-stream-monitor',
        params: {
          meloId: null,
          from: null,
          to: null,
          obis: '1-0:1.8.0',
          gridOperatorId: null,
        },
        description:
          'Fetch strict anomaly-class buckets and decision notes from existing EDM/validation/forecast/governance services.',
        expectedOutput:
          '{ streamStatus, qualityFindings, anomalySignals, restrictionRefs, forecastQuality, decisionNotes, sourceActions, timestamp, _errors }',
      },
    ],
    expectedResult:
      'Partial-safe monitor payload with strict bucket separation: dataQualityGap vs realAnomaly vs forecastProblem vs processGovernanceBreak.',
    prerequisites: ['MeLo ID', 'from/to time window'],
  },
  {
    id: 'dashboard-market-snapshot',
    title: 'Pull energy market snapshot for a region',
    domain: 'monitoring',
    tags: ['dashboard', 'market', 'spot-price', 'co2', 'forecast'],
    problem:
      'A UI needs day-ahead price, CO₂ intensity, and 24h renewable generation forecast in one call.',
    process: [
      {
        step: 1,
        service: 'dashboard-api',
        action: 'dashboard-api.marketSnapshot',
        restPath: 'GET /api/dashboard/market-snapshot',
        params: { region: 'Germany' },
        description:
          'Fetch 15-minute-cached market snapshot with spot price, CO₂, and renewable forecast.',
        expectedOutput: '{ spotPrice, co2, renewableForecast24h, timestamp, _errors }',
      },
    ],
    expectedResult: 'Live market context for load-shifting or trading decisions.',
    prerequisites: ['Optional: region name (ENTSO-E country, e.g. Germany)'],
  },
  {
    id: 'dashboard-quality-summary',
    title: 'Pull agent quality summary for a grid operator',
    domain: 'monitoring',
    tags: ['dashboard', 'quality', 'agents', 'portfolio'],
    problem:
      "A compliance team needs a bird's-eye view of all four agent audit scores for one operator.",
    process: [
      {
        step: 1,
        service: 'dashboard-api',
        action: 'dashboard-api.qualitySummary',
        restPath: 'GET /api/dashboard/quality-summary',
        params: { gridOperatorId: null },
        description:
          'Fetch 5-minute-cached quality summary: overall score, per-agent summaries, findings counts.',
        expectedOutput: '{ overallScore, agents, portfolioSize, timestamp, _errors }',
      },
    ],
    expectedResult: 'Single aggregated quality score and per-agent breakdown for dashboard.',
    prerequisites: ['MaStR grid operator ID (SNB…/GNB…)'],
  },
  {
    id: 'dashboard-observability-mini',
    title: 'Pull mini observability dashboard cards',
    domain: 'monitoring',
    tags: ['dashboard', 'observability', 'ops', 'production-feedback'],
    problem:
      'A dashboard widget needs a compact production-feedback payload with operational health, incidents, and performance signals.',
    process: [
      {
        step: 1,
        service: 'dashboard-api',
        action: 'dashboard-api.observabilityMini',
        restPath: 'GET /api/dashboard/observability-mini',
        params: { sinceMinutes: 60, slowActionThresholdMs: 1000 },
        description:
          'Fetch 60-second-cached compact observability cards plus recent errors and slowest actions.',
        expectedOutput: '{ cards, recentErrors, slowestActions, timestamp, _errors }',
      },
    ],
    expectedResult:
      'UI-ready operational mini dashboard payload for proactive monitoring and quick triage.',
    prerequisites: ['Read-only API token (optional)'],
  },
  {
    id: 'agentic-production-feedback-prompt',
    title: 'Generate agent debugging prompt from production feedback',
    domain: 'monitoring',
    tags: ['agent', 'prompt', 'observability', 'debugging', 'feedback-loop'],
    problem:
      'An engineering agent should receive a consistent, redacted troubleshooting prompt derived from recent production logs and performance metrics.',
    process: [
      {
        step: 1,
        service: 'observability',
        action: 'observability.agentPrompt',
        restPath: 'GET /api/observability/agent-prompt',
        params: { sinceMinutes: 120, slowActionThresholdMs: 1500, limit: 5 },
        description:
          'Build an operations-oriented prompt containing error hotspots, latency outliers, and suggested output structure.',
        expectedOutput: '{ prompt, context, generatedAt, window }',
      },
      {
        step: 2,
        service: 'observability',
        action: 'observability.logs',
        restPath: 'GET /api/observability/logs',
        params: { level: 'error', sinceMinutes: 120, limit: 20 },
        description: 'Optionally enrich the agent context with additional recent error logs.',
        expectedOutput: '{ count, logs[] }',
      },
    ],
    expectedResult:
      'Reusable prompt template for agentic issue analysis with privacy-safe production feedback context.',
    prerequisites: [
      'Read-only API token (optional)',
      'Agent runtime that accepts text prompt + JSON context',
    ],
  },

  // ─── INHOUSE DATA PIPELINE (4 recipes) ───────────────────────────────────
  {
    id: 'datasource-register-and-classify',
    title: 'Register, classify, and query a new inhouse datasource',
    domain: 'inhouse-pipeline',
    tags: ['datasource', 'register', 'classify', 'inhouse'],
    problem:
      'A user has uploaded a CSV or XLSX file and needs to register it, confirm its semantic domain, and start querying it.',
    process: [
      {
        step: 1,
        service: 'datasource-registry',
        action: 'datasource-registry.create',
        restPath: 'POST /api/datasources',
        params: { name: null, connectorType: 'csv', config: { file: null } },
        description: 'Register the uploaded file as a named datasource.',
        expectedOutput: 'Datasource ID and initial metadata.',
      },
      {
        step: 2,
        service: 'datasource-registry',
        action: 'datasource-registry.infer',
        restPath: 'POST /api/datasources/:id/infer',
        params: { id: '__step_1.data.id' },
        description: 'Run heuristic + optional LLM classification to detect semantic domain.',
        expectedOutput: 'Classification result with domain label and confidence.',
      },
      {
        step: 3,
        service: 'datasource-classifier',
        action: 'datasource-classifier.confirm',
        restPath: 'PATCH /api/datasources/:id/classification',
        params: { id: '__step_1.data.id', domain: '__step_2.data.domain' },
        description: 'Confirm or override the inferred classification.',
        expectedOutput: 'Final confirmed domain stored on the datasource.',
      },
      {
        step: 4,
        service: 'datasource-cache',
        action: 'datasource-cache.query',
        restPath: 'GET /api/datasource-cache/:sourceId',
        params: { sourceId: '__step_1.data.name' },
        description: 'Query the registered datasource to verify row access.',
        expectedOutput: 'Sample rows from the registered datasource.',
      },
    ],
    expectedResult:
      'Fully registered, classified, and queryable inhouse datasource ready for joins and AI queries.',
    prerequisites: ['File uploaded to /api/datasources/uploads', 'File name'],
  },
  {
    id: 'in-memory-multi-join',
    title: 'Join two inhouse datasources in memory',
    domain: 'inhouse-pipeline',
    tags: ['join', 'inhouse', 'merge', 'datasource'],
    problem:
      'Two uploaded inhouse datasets (e.g., metering and plant inventory) need to be merged on a shared key field without SQL.',
    process: [
      {
        step: 1,
        service: 'in-memory-join',
        action: 'in-memory-join.join',
        restPath: 'POST /api/in-memory-join/join',
        params: {
          left: { kind: 'datasource', sourceId: null },
          right: { kind: 'datasource', sourceId: null },
          join: { leftField: null, rightField: null, matchMode: 'exact' },
          output: { fields: null },
        },
        description: 'Load both datasources into memory and merge rows on matching key fields.',
        expectedOutput: 'Joined rows with fields from both left and right datasets.',
      },
    ],
    expectedResult: 'Merged dataset with configurable output field projection.',
    prerequisites: ['Two registered datasource names', 'Common join field name on each side'],
  },
  {
    id: 'procurement-vs-spot-cost',
    title: 'Compare procurement portfolio against EPEX spot prices',
    domain: 'inhouse-pipeline',
    tags: ['procurement', 'spot', 'market', 'cost-analysis', 'inhouse'],
    problem:
      'A trading team wants to evaluate their contracted procurement periods against actual EPEX day-ahead prices.',
    process: [
      {
        step: 1,
        service: 'in-memory-join',
        action: 'in-memory-join.procurementVsSpot',
        restPath: 'POST /api/in-memory-join/procurement-vs-spot',
        params: {
          sourceId: null,
          periodField: null,
          volumeField: null,
          priceField: null,
          region: 'Deutschland',
          market: 'day-ahead',
        },
        description:
          'Join procurement intervals with live EPEX day-ahead prices and compute per-interval savings/losses.',
        expectedOutput:
          'Interval-level comparison with delta (procurement vs. spot) and aggregate summary.',
      },
    ],
    expectedResult: 'Cost-effectiveness report for contracted procurement periods vs. spot market.',
    prerequisites: [
      'Inhouse procurement datasource with period, volume, and contracted price fields',
    ],
  },
  {
    id: 'forecast-vs-actual-comparison',
    title: 'Compare inhouse actual generation with forecast',
    domain: 'inhouse-pipeline',
    tags: ['forecast', 'actual', 'generation', 'accuracy', 'inhouse'],
    problem:
      'A generation operator wants to measure forecast accuracy by comparing iMSys metering against MaStR generation forecasts.',
    process: [
      {
        step: 1,
        service: 'in-memory-join',
        action: 'in-memory-join.compareForecastActual',
        restPath: 'POST /api/in-memory-join/compare-forecast-actual',
        params: {
          sourceId: null,
          date: null,
          leftTimeField: 'Zeit',
          leftActualField: 'Leistung Einspeisung (W)',
          actualUnit: 'W',
        },
        description:
          'Join inhouse actual generation (from uploaded iMSys CSV) against MaStR generation forecast.',
        expectedOutput: 'Interval-level delta table with MAPE and peak deviation statistics.',
      },
    ],
    expectedResult: 'Quantified forecast accuracy report including MAPE and deviation histogram.',
    prerequisites: ['Uploaded iMSys metering CSV datasource name', 'Date or date range'],
  },

  // ─── DATAPOINTS (3 recipes) ───────────────────────────────────────────────
  {
    id: 'datapoint-promote-and-schedule',
    title: 'Promote a datasource to a scheduled managed datapoint',
    domain: 'datapoints',
    tags: ['datapoint', 'promote', 'schedule', 'refresh'],
    problem:
      'A registered datasource should be promoted to a managed datapoint with auto-refresh scheduling.',
    process: [
      {
        step: 1,
        service: 'datapoint',
        action: 'datapoint.promote',
        restPath: 'POST /api/datapoints/promote',
        params: { name: null, sourceId: null, intervalMinutes: 60 },
        description: 'Promote a datasource to a managed datapoint with refresh interval.',
        expectedOutput: 'Datapoint metadata including schedule configuration.',
      },
      {
        step: 2,
        service: 'datapoint',
        action: 'datapoint.get',
        restPath: 'GET /api/datapoints/:name',
        params: { name: '__step_1.data.name' },
        description: 'Retrieve the new datapoint to confirm schedule and provenance hash.',
        expectedOutput: 'Full datapoint record with provenanceHash and schedule.',
      },
      {
        step: 3,
        service: 'datapoint',
        action: 'datapoint.refresh',
        restPath: 'POST /api/datapoints/:name/refresh',
        params: { name: '__step_1.data.name' },
        description: 'Trigger the first manual refresh to populate initial data.',
        expectedOutput: 'Updated provenanceHash confirming data freshness.',
      },
    ],
    expectedResult:
      'Datapoint active with first data snapshot, provenance recorded, and scheduler running.',
    prerequisites: ['Registered datasource name', 'Desired refresh interval in minutes'],
  },
  {
    id: 'datapoint-snapshot-lifecycle',
    title: 'Create and validate a consistency snapshot across datapoints',
    domain: 'datapoints',
    tags: ['datapoint', 'snapshot', 'consistency', 'audit'],
    problem:
      'Multiple datapoints need to be sealed into a tamper-evident consistency snapshot for regulatory evidence.',
    process: [
      {
        step: 1,
        service: 'datapoint',
        action: 'datapoint.createSnapshot',
        restPath: 'POST /api/datapoints/snapshot',
        params: { datapointNames: null },
        description:
          'Seal a group of datapoints with SHA-256 snapshotHash (refreshes stale data first).',
        expectedOutput: 'Snapshot ID and snapshotHash covering all included datapoints.',
      },
      {
        step: 2,
        service: 'datapoint',
        action: 'datapoint.validateSnapshot',
        restPath: 'POST /api/datapoints/snapshot/:id/validate',
        params: { id: '__step_1.data.id' },
        description: 'Re-compute provenanceHashes and compare against the sealed snapshot.',
        expectedOutput:
          'Drift detection result: consistent or drift list with affected datapoints.',
      },
      {
        step: 3,
        service: 'datapoint',
        action: 'datapoint.getSnapshot',
        restPath: 'GET /api/datapoints/snapshot/:id',
        params: { id: '__step_1.data.id' },
        description: 'Retrieve the full snapshot record for audit export.',
        expectedOutput: 'Snapshot document with hash, included datapoints, and createdAt.',
      },
    ],
    expectedResult:
      'Immutable audit evidence snapshot with drift detection result for regulator-ready reporting.',
    prerequisites: ['List of managed datapoint names', 'All datapoints freshly refreshed'],
  },
  {
    id: 'oep-schema-to-rows',
    title: 'Browse and query OEP table rows',
    domain: 'datapoints',
    tags: ['oep', 'query', 'rows', 'schema'],
    problem:
      'A researcher has identified an OEP schema and wants to list its tables, inspect metadata, then download rows.',
    process: [
      {
        step: 1,
        service: 'oep',
        action: 'oep.listTables',
        restPath: 'GET /api/oep/schemas/:schema/tables',
        params: { schema: null },
        description: 'List available tables in the target OEP schema.',
        expectedOutput: 'Table names with row counts and column summaries.',
      },
      {
        step: 2,
        service: 'oep',
        action: 'oep.getTableMeta',
        restPath: 'GET /api/oep/tables/:schema/:table/meta',
        params: { schema: null, table: '__step_1.data[0].name' },
        description: 'Inspect OEMetadata v2 for the chosen table: column types, units, license.',
        expectedOutput: 'OEMetadata JSON with columns, topics, and license information.',
      },
      {
        step: 3,
        service: 'oep',
        action: 'oep.query',
        restPath: 'GET /api/oep/tables/:schema/:table/rows',
        params: { schema: null, table: null, limit: 100, where: null },
        description: 'Download rows with optional WHERE filter.',
        expectedOutput: 'Array of row objects matching the schema column definitions.',
      },
    ],
    expectedResult: 'Validated data rows from the Open Energy Platform table ready for analysis.',
    prerequisites: ['OEP schema name (from oep-research-dataset-discovery recipe)'],
  },

  // ─── GEO / OSM (2 recipes) ───────────────────────────────────────────────
  {
    id: 'osm-infrastructure-nearby',
    title: 'Find OSM grid infrastructure near a location',
    domain: 'geo',
    tags: ['osm', 'infrastructure', 'proximity', 'overpass'],
    problem:
      'A grid operator needs to identify all transformer stations, power lines, and substations within a radius of a site.',
    process: [
      {
        step: 1,
        service: 'osm-geo',
        action: 'osm-geo.infrastructureNearby',
        restPath: 'POST /api/osm-geo/infrastructure-nearby',
        params: {
          lat: null,
          lon: null,
          radiusMeters: 5000,
          types: ['substation', 'line', 'cable'],
        },
        description: 'Query Overpass API for all grid infrastructure within radius.',
        expectedOutput: 'GeoJSON FeatureCollection of nearby infrastructure elements.',
      },
    ],
    expectedResult:
      'Georeferenced list of grid assets within the search radius for capacity planning.',
    prerequisites: ['Coordinates (lat/lon) of the target site', 'Search radius in meters'],
  },
  {
    id: 'osm-substation-and-grid-topology',
    title: 'Locate substations and map surrounding grid topology',
    domain: 'geo',
    tags: ['osm', 'substation', 'topology', 'overpass'],
    problem:
      'A grid planner needs to identify candidate substations in a region and map the connected network topology.',
    process: [
      {
        step: 1,
        service: 'osm-geo',
        action: 'osm-geo.substationFinder',
        restPath: 'POST /api/osm-geo/substation-finder',
        params: { bbox: null, voltageMin: null, voltageMax: null },
        description:
          'Find all substations within a bounding box, optionally filtered by voltage level.',
        expectedOutput: 'List of substations with coordinates, name, voltage, and OSM ID.',
      },
      {
        step: 2,
        service: 'osm-geo',
        action: 'osm-geo.gridTopology',
        restPath: 'POST /api/osm-geo/grid-topology',
        params: { bbox: null, voltageMin: null },
        description:
          'Build a grid topology graph (nodes = substations, edges = lines) for the region.',
        expectedOutput:
          'Graph structure with node/edge counts, connectivity metrics, and isolated components.',
      },
    ],
    expectedResult:
      'Substation inventory with a connected topology graph for grid reinforcement planning.',
    prerequisites: ['Bounding box for the region of interest (south/west/north/east)'],
  },

  // ─── PLANNING — ZNP (5 recipes) ──────────────────────────────────────────
  {
    id: 'znp-layer0-to-gfactor',
    title: 'Build a ZNP project and compute theoretical g-factor',
    domain: 'planning',
    tags: ['znp', 'g-factor', 'planning', 'mastr', 'vde-ar-n-4100'],
    problem:
      'A grid planner needs to estimate the theoretical simultaneous load factor (g-factor) for a Netzgebiet based on MaStR assets.',
    process: [
      {
        step: 1,
        service: 'znp',
        action: 'znp.createProject',
        restPath: 'POST /api/znp/projects',
        params: { name: null, bbox: { south: null, west: null, north: null, east: null } },
        description: 'Create a new ZNP workspace with a geographic bounding box.',
        expectedOutput: 'Project ID to use in subsequent layer calls.',
      },
      {
        step: 2,
        service: 'znp',
        action: 'znp.addLayer0',
        restPath: 'POST /api/znp/projects/:projectId/layer0',
        params: { projectId: '__step_1.data.id', assets: null },
        description: 'Load MaStR assets (from cernion_installations_local) into the project graph.',
        expectedOutput: 'Node count and total capacity loaded into the knowledge graph.',
      },
      {
        step: 3,
        service: 'znp',
        action: 'znp.calculateGFactor',
        restPath: 'GET /api/znp/projects/:projectId/g-factor',
        params: { projectId: '__step_1.data.id', target_layer: 0 },
        description: 'Compute VDE-AR-N 4100 theoretical g-factor from Layer 0 asset inventory.',
        expectedOutput: 'g-factor value, peak load estimate in kW, and asset breakdown.',
      },
    ],
    expectedResult: 'Theoretical simultaneous load estimate (g-factor) for the defined Netzgebiet.',
    prerequisites: [
      'Geographic bounding box',
      'MaStR asset list (from cernion_installations_local or assets service)',
    ],
  },
  {
    id: 'znp-strategic-assumptions',
    title: 'Add NL strategic assumptions and update g-factor',
    domain: 'planning',
    tags: ['znp', 'assumptions', 'nlp', 'planning', 'section-14a'],
    problem:
      'A planner wants to add forward-looking assumptions (e.g., data centres, heat-pump mandates) as free text and see their g-factor impact.',
    process: [
      {
        step: 1,
        service: 'znp',
        action: 'znp.strategicPrompts',
        restPath: 'GET /api/znp/projects/:projectId/strategic-prompts',
        params: { projectId: null },
        description:
          'Generate AI-suggested strategic planning questions based on current graph topology.',
        expectedOutput: '2–3 strategic questions about developments not visible in MaStR/OSM.',
      },
      {
        step: 2,
        service: 'znp',
        action: 'znp.addAssumption',
        restPath: 'POST /api/znp/projects/:projectId/assumptions',
        params: { projectId: null, text: null },
        description:
          'Post a German free-text assumption; Gemini extracts assetType, capacityKW, hasFlexibleNav.',
        expectedOutput: 'StrategicAssumption node added to graph with parsed fields.',
      },
      {
        step: 3,
        service: 'znp',
        action: 'znp.calculateGFactor',
        restPath: 'GET /api/znp/projects/:projectId/g-factor',
        params: { projectId: null, target_layer: 2 },
        description:
          'Recompute g-factor at Layer 2+ to include assumptions; §14a flex-NAV nodes excluded.',
        expectedOutput: 'Updated g-factor with flexNavExcluded count and assumption contribution.',
      },
    ],
    expectedResult: 'Forward-looking g-factor estimate incorporating unregistered planned loads.',
    prerequisites: [
      'Existing ZNP project ID (from znp-layer0-to-gfactor)',
      'German free-text assumption string',
    ],
  },
  {
    id: 'znp-mastr-inventory-drill-down',
    title: 'ZNP MaStR Inventory Drill-down',
    domain: 'planning',
    tags: ['znp', 'mastr', 'inventory', 'filtering', 'planned-assets'],
    problem:
      'A grid planner wants a Tiefenprüfung of the Layer 0 MaStR inventory and needs to filter specifically for assets with status "In Planung".',
    process: [
      {
        step: 1,
        service: 'znp',
        action: 'znp.getProjectAssets',
        restPath: 'GET /api/znp/projects/:projectId/assets',
        params: {
          projectId: null,
          status: 'In Planung',
          assetType: null,
          sortByCapacity: 'desc',
          limit: 100,
          offset: 0,
        },
        description:
          'List Layer 0 MaStR assets in the project and filter down to installations still marked as planned.',
        expectedOutput:
          'Paginated asset list with capacity, assetType, status, commissioningDate, and coordinates.',
      },
    ],
    expectedResult:
      'A filtered ZNP inventory view for "In Planung" assets, ready for manual drill-down and prioritization.',
    prerequisites: [
      'Existing ZNP project ID with Layer 0 assets already loaded',
      'Optional asset type filter (for example solar or storage)',
    ],
  },
  {
    id: 'znp-conversational-planner-strategic-prompts',
    title: 'ZNP Conversational Planner (Strategic Prompts)',
    domain: 'planning',
    tags: ['znp', 'strategic-prompts', 'llm', 'topology', 'planning'],
    problem:
      'A planner wants to retrieve KI-gestützte Rückfragen that are grounded in the current grid topology and missing future-demand signals.',
    process: [
      {
        step: 1,
        service: 'znp',
        action: 'znp.strategicPrompts',
        restPath: 'GET /api/znp/projects/:projectId/strategic-prompts',
        params: { projectId: null },
        description:
          'Generate 2–3 strategic planning questions from the current ZNP graph topology, layers, and capacity mix.',
        expectedOutput: 'Questions array plus graphSummary context used for the LLM prompt.',
      },
    ],
    expectedResult:
      'A conversational planning prompt set highlighting blind spots that are not visible in MaStR or OSM alone.',
    prerequisites: ['Existing ZNP project ID', 'Configured GEMINI_API_KEY'],
  },
  {
    id: 'znp-layer2-pdf-extraction',
    title: 'ZNP Layer 2 PDF Extraction',
    domain: 'planning',
    tags: ['znp', 'layer2', 'pdf', 'transformer', 'load-profile'],
    problem:
      'A grid planner needs to ingest real transformer load profiles from a VNB PDF so measured peak load can override the theoretical Layer 0 estimate.',
    process: [
      {
        step: 1,
        service: 'znp',
        action: 'znp.addLayer2',
        restPath: 'POST /api/znp/projects/:projectId/layer2',
        params: {
          projectId: null,
          filePath: null,
        },
        description:
          'Parse an uploaded PDF and extract the Jahreshöchstlast into Layer 2 as a measured transformer load.',
        expectedOutput:
          'Async job descriptor with jobId, statusUrl, and resultUrl for extraction progress.',
      },
      {
        step: 2,
        service: 'znp',
        action: 'znp.calculateGFactor',
        restPath: 'GET /api/znp/projects/:projectId/g-factor',
        params: {
          projectId: null,
          target_layer: 2,
        },
        description:
          'Recalculate the g-factor with Layer 2 short-circuiting so the measured peak load replaces the theoretical estimate.',
        expectedOutput:
          'Measured peak load, adjustedCapacityKW, simultaneityFactor, and layer2ShortCircuit=true.',
      },
    ],
    expectedResult:
      'A Layer 2 enriched ZNP project using real measured transformer load from PDF extraction.',
    prerequisites: [
      'Existing ZNP project ID',
      'PDF uploaded to /api/datasources/uploads',
      'Absolute file path returned or known from the upload step',
    ],
  },

  // ─── AGENT VALIDATION — EXTENDED (2 recipes) ─────────────────────────────
  {
    id: 'energy-sharing-full-pipeline',
    title: 'Validate and allocate an Energy Sharing community end-to-end',
    domain: 'agent-validation',
    tags: ['energy-sharing', 'allocation', 'enwg-42c', 'csv-export'],
    problem:
      'A §42c EnWG energy sharing community needs full validation followed by allocation and EDM-importable CSV output.',
    process: [
      {
        step: 1,
        service: 'energy-sharing',
        action: 'energy-sharing.validate',
        restPath: 'POST /api/energy-sharing/validate',
        params: { operatorId: null, generators: null, consumers: null },
        description:
          'Run 6-step deterministic validation pipeline; must return decision: approved.',
        expectedOutput: 'decision: approved, findings array, and validation ID.',
      },
      {
        step: 2,
        service: 'energy-sharing-allocation',
        action: 'energy-sharing-allocation.allocate',
        restPath: 'POST /api/energy-sharing-allocation/allocate',
        params: {
          validationId: '__step_1.data.id',
          stufe: 'A',
          generators: null,
          consumers: null,
          dateFrom: null,
          dateTo: null,
        },
        description:
          'Run Stufe A forecast-based allocation with optional Redispatch 2.0 deduction.',
        expectedOutput: 'Allocation ID, interval-level shares, and generator/consumer breakdown.',
      },
      {
        step: 3,
        service: 'energy-sharing-allocation',
        action: 'energy-sharing-allocation.download',
        restPath: 'GET /api/energy-sharing-allocation/allocations/:id/download',
        params: { id: '__step_2.data.id', maloId: null },
        description:
          'Download EDM-importable semicolon-delimited CSV for a specific consumer MaLo.',
        expectedOutput: 'CSV attachment with 15-min interval timestamps and kWh allocations.',
      },
    ],
    expectedResult: 'End-to-end validated allocation with downloadable EDM CSV ready for billing.',
    prerequisites: [
      'Validated generator and consumer list with MaLo IDs',
      'Allocation period dates',
    ],
  },
  {
    id: 'utility-report-ewk',
    title: 'Generate an EWK grid operator utility report',
    domain: 'agent-validation',
    tags: ['utility-report', 'ewk', 'pdf', 'compliance'],
    problem:
      'A grid operator needs a structured EWK (Einspeisungswerke-Kennzahlen) compliance report in PDF format.',
    process: [
      {
        step: 1,
        service: 'utility-report',
        action: 'utility-report.getBdewOptions',
        restPath: 'POST /api/utility-report/get-bdew-options',
        params: { query: null },
        description: 'Resolve available BDEW codes for the named utility.',
        expectedOutput: 'BDEW code candidates with market roles for the given utility name.',
      },
      {
        step: 2,
        service: 'utility-report',
        action: 'utility-report.generate',
        restPath: 'POST /api/utility-report/generate',
        params: { bdewCode: '__step_1.data.options[0].bdewCode', reportType: 'ewk' },
        description: 'Trigger async report generation (returns reportId immediately).',
        expectedOutput: 'reportId and status: generating.',
      },
      {
        step: 3,
        service: 'utility-report',
        action: 'utility-report.status',
        restPath: 'GET /api/utility-report/status/:reportId',
        params: { reportId: '__step_2.data.reportId' },
        description: 'Poll until status: completed (typically 10–30 seconds).',
        expectedOutput: 'status: completed with report metadata.',
      },
      {
        step: 4,
        service: 'utility-report',
        action: 'utility-report.download',
        restPath: 'GET /api/utility-report/download/:reportId',
        params: { reportId: '__step_2.data.reportId' },
        description: 'Download the compiled PDF report.',
        expectedOutput: 'PDF binary (Content-Disposition: attachment).',
      },
    ],
    expectedResult: 'Downloadable EWK compliance PDF report for regulatory submission.',
    prerequisites: ['Grid operator name or BDEW code'],
  },
  {
    id: 'redispatch-forensic-audit',
    title: 'Redispatch 2.0 forensic audit (missing units and blind spots)',
    domain: 'agent-validation',
    tags: ['redispatch', 'forensic', 'audit', 'mastr', 'compliance'],
    problem:
      'A VNB wants to compare Redispatch-relevant units against internal reporting and identify missing registrations above 100 kW.',
    process: [
      {
        step: 1,
        service: 'redispatch-expost',
        action: 'redispatch-expost.audit',
        restPath: 'POST /api/redispatch/audit',
        params: {
          gridOperatorId: null,
          minCapacityKW: 100,
          includeDatapointFallback: true,
        },
        description:
          'Run deterministic Redispatch ex-post audit and detect portfolio gaps (Weg A/B).',
        expectedOutput:
          'Settlement readiness, risk score, and finding list with missing NAP/MeLo and registration issues.',
      },
      {
        step: 2,
        service: 'mastr-quality',
        action: 'mastr-quality.audit',
        restPath: 'POST /api/mastr-quality/audit',
        params: {
          gridOperatorId: '__step_1.data.gridOperator.mastrId',
          skipSteps: [7],
        },
        description:
          'Validate MaStR portfolio quality to explain root causes behind Redispatch findings.',
        expectedOutput:
          'Quality dimensions and installation-level findings for follow-up correction backlog.',
      },
    ],
    expectedResult:
      'A consolidated gap list of Redispatch-relevant units with regulator-ready finding evidence.',
    prerequisites: ['Resolvable grid operator identifier (MaStR ID or BDEW code)'],
  },
  {
    id: 'znp-flexible-nav-stresstest',
    title: 'Flexible NAV stress test with CAPEX impact',
    domain: 'planning',
    tags: ['znp', 'flex-nav', 'g-factor', 'capex', 'section-14a'],
    problem:
      'A planner wants to quantify the impact of flexible NAV assumptions (for example g=0 for curtailable demand) on transformer load and expansion pressure.',
    process: [
      {
        step: 1,
        service: 'znp',
        action: 'znp.createProject',
        restPath: 'POST /api/znp/projects',
        params: {
          bbox: null,
          name: 'Flexible NAV Stresstest',
        },
        description: 'Create a ZNP project workspace for the target district.',
      },
      {
        step: 2,
        service: 'znp',
        action: 'znp.addLayer0',
        restPath: 'POST /api/znp/projects/:projectId/layer0',
        params: {
          projectId: '__step_1.data.projectId',
          bdewCode: null,
          includeStorage: true,
        },
        description: 'Load baseline MaStR assets as Layer 0 for the planning area.',
      },
      {
        step: 3,
        service: 'znp',
        action: 'znp.addAssumption',
        restPath: 'POST /api/znp/projects/:projectId/assumptions',
        params: {
          projectId: '__step_1.data.projectId',
          text: `§14a controllable load scenario: ${SECTION_14A_POLICY.minimumGuaranteedPower} kW min power + dynamic g-factor (n=4 → g=${SECTION_14A_POLICY.simultaneityFactorTable[4]}).`,
        },
        description:
          'Inject flexible NAV planning assumption with dynamic simultaneity factors per BK6-22-300.',
      },
      {
        step: 4,
        service: 'znp',
        action: 'znp.calculateGFactor',
        restPath: 'GET /api/znp/projects/:projectId/g-factor',
        params: {
          projectId: '__step_1.data.projectId',
          target_layer: 2,
        },
        description:
          'Compute simultaneity-adjusted capacity including flexible NAV planning assumptions.',
        expectedOutput:
          'Adjusted capacity and g-factor to estimate avoided or postponed grid expansion.',
      },
    ],
    expectedResult:
      'Decision-ready stress-test output showing load impact and CAPEX deferral potential (cable €150k/km vs. rONT €5.5k).',
    prerequisites: ['Bounding box for planning area', 'Grid operator context (BDEW/MaStR)'],
  },
  {
    id: 'energy-sharing-42c-radar',
    title: 'Energy Sharing (§42c EnWG) opportunity radar',
    domain: 'agent-validation',
    tags: ['energy-sharing', 'enwg-42c', 'clustering', 'readiness'],
    problem:
      'A VNB needs to identify potential Energy Sharing clusters early and pre-check eligibility before formal project requests arrive.',
    process: [
      {
        step: 1,
        service: 'energy-market',
        action: 'energy-market.installations',
        restPath: 'POST /api/energy-market/installations',
        params: {
          installationType: 'solar',
          minCapacityKW: SECTION_42C_HEURISTICS.spatialClustering.pvCandidate.minCapacity_kWp,
          location: null,
          limit: 1000,
        },
        description: 'Find larger rooftop PV candidates (>30 kWp) suitable for §42c clustering.',
      },
      {
        step: 2,
        service: 'osm-geo',
        action: 'osm-geo.infrastructureNearby',
        restPath: 'POST /api/osm-geo/infrastructure-nearby',
        params: {
          lat: null,
          lon: null,
          radiusMeters: SECTION_42C_HEURISTICS.spatialClustering.geometry.distanceThreshold_m,
        },
        description:
          'Check nearby building and infrastructure context for clustering plausibility (OSM-based).',
      },
      {
        step: 3,
        service: 'energy-sharing',
        action: 'energy-sharing.validate',
        restPath: 'POST /api/energy-sharing/validate',
        params: {
          operatorId: null,
          generators: null,
          consumers: null,
          require_direktvermarktung:
            SECTION_42C_HEURISTICS.regulatoryRequirements.direktvermarktung_mandatory,
          require_service_provider:
            SECTION_42C_HEURISTICS.regulatoryRequirements.dienstleister_required,
        },
        description:
          'Validate shortlisted clusters against deterministic §42c regulatory checks (Direktvermarktung + §20 service contract).',
        expectedOutput: 'Eligibility decision and finding timeline per candidate community.',
      },
    ],
    expectedResult:
      'A ranked shortlist of actionable §42c Energy Sharing candidates (effective 2026-06-01) with validation evidence.',
    prerequisites: ['Target region', 'Operator identifier', 'Initial generator/consumer shortlist'],
  },
  {
    id: 'cybergrid-counter-location-scout',
    title: 'Co-location scout for grid-beneficial storage siting',
    domain: 'planning',
    tags: ['storage', 'siting', 'substation', 'osm', 'grid-benefit'],
    problem:
      'A VNB wants to proactively identify storage locations near stressed substations instead of reacting to poorly placed connection requests.',
    process: [
      {
        step: 1,
        service: 'vnb-monitor',
        action: 'vnb-monitor.alerts',
        restPath: 'GET /api/vnb-monitor/:bdewCode/alerts',
        params: {
          bdewCode: null,
          refresh: true,
          thermalWarningLevel: HOTSPOT_THRESHOLDS.thermal.warningLevel,
          thermalAlertLevel: HOTSPOT_THRESHOLDS.thermal.alertLevel,
          lang: 'de',
        },
        description:
          'Retrieve active stress alerts (thermal >80% warning, >100% hard alert) to prioritize hotspot regions.',
      },
      {
        step: 2,
        service: 'osm-geo',
        action: 'osm-geo.substationFinder',
        restPath: 'POST /api/osm-geo/substation-finder',
        params: {
          location: null,
          limit: 3,
        },
        description: 'Identify candidate substations in the hotspot region.',
      },
      {
        step: 3,
        service: 'osm-geo',
        action: 'osm-geo.infrastructureNearby',
        restPath: 'POST /api/osm-geo/infrastructure-nearby',
        params: {
          lat: '__step_2.data.results[0].lat',
          lon: '__step_2.data.results[0].lon',
          radiusMeters: 500,
          land_use_filtering: true,
        },
        description:
          'Check surrounding land-use suitability for utility-scale storage co-location.',
        expectedOutput: 'Nearby infrastructure/land-use profile for siting pre-assessment.',
      },
    ],
    expectedResult:
      'Top candidate substation zones for proactive, grid-beneficial storage deployment (co-location near congestion points).',
    prerequisites: ['BDEW code', 'Target city/region'],
  },
  {
    id: 'section14a-compliance-autopilot',
    title: '§14a EnWG compliance autopilot (monitor + exception list)',
    domain: 'monitoring',
    tags: ['section-14a', 'compliance', 'nbp', 'monitoring'],
    problem:
      'A grid operator needs a recurring process to detect controllability and process gaps relevant for §14a EnWG obligations.',
    process: [
      {
        step: 1,
        service: 'nbp-monitor',
        action: 'nbp-monitor.snapshot',
        restPath: 'GET /api/nbp-monitor/:bdewCode',
        params: {
          bdewCode: null,
          refresh: true,
          lang: 'de',
        },
        description: 'Load NBP process backlog and risk KPIs as baseline compliance signal.',
      },
      {
        step: 2,
        service: 'vnb-monitor',
        action: 'vnb-monitor.snapshot',
        restPath: 'GET /api/vnb-monitor/:bdewCode',
        params: {
          bdewCode: null,
          refresh: true,
          alerts: true,
          lang: 'de',
        },
        description: 'Correlate NBP backlog with VNB alert state and operator-level KPI context.',
      },
      {
        step: 3,
        service: 'mastr-quality',
        action: 'mastr-quality.audit',
        restPath: 'POST /api/mastr-quality/audit',
        params: {
          gridOperatorBdew: null,
          skipSteps: [7],
        },
        description:
          'Generate installation-level correction backlog (NAP/MeLo/status quality) for operational follow-up.',
      },
    ],
    expectedResult:
      'A repeatable compliance cockpit with quantified backlog and installation-level action list.',
    prerequisites: ['BDEW code of grid operator'],
  },
  {
    id: 'nova-capex-defender',
    title: 'NOVA CAPEX defender (optimize before reinforce before expand)',
    domain: 'planning',
    tags: ['nova', 'capex', 'znp', 'ront', 'planning'],
    problem:
      'A planner wants to test whether operational/asset optimization can defer costly cable expansion projects.',
    process: [
      {
        step: 1,
        service: 'znp',
        action: 'znp.calculateGFactor',
        restPath: 'GET /api/znp/projects/:projectId/g-factor',
        params: {
          projectId: null,
          target_layer: 0,
        },
        description: 'Capture baseline load pressure from current Layer 0 asset stack.',
      },
      {
        step: 2,
        service: 'znp',
        action: 'znp.addAssumption',
        restPath: 'POST /api/znp/projects/:projectId/assumptions',
        params: {
          projectId: null,
          text: `rONT deployment (€${CAPEX_ASSUMPTIONS.rONT.incrementalCost} incremental cost, ${CAPEX_ASSUMPTIONS.rONT.spannungCapacityFactor}x voltage capacity) to defer cable expansion (€${CAPEX_ASSUMPTIONS.cable.costPerKilometer.typical}/km).`,
        },
        description: 'Inject optimization scenario (NOVA "Optimize" phase) into planning graph.',
      },
      {
        step: 3,
        service: 'znp',
        action: 'znp.calculateGFactor',
        restPath: 'GET /api/znp/projects/:projectId/g-factor',
        params: {
          projectId: null,
          target_layer: 2,
        },
        description:
          'Recalculate adjusted load after optimization scenario to estimate deferral impact.',
        expectedOutput:
          'Comparable before/after g-factor and adjustedCapacity values for CAPEX decision templates.',
      },
    ],
    expectedResult:
      'Quantified before/after planning evidence (rONT vs. cable expansion) to defend optimization-first NOVA CAPEX decisions.',
    prerequisites: ['Existing ZNP project with Layer 0 loaded'],
  },
  {
    id: 'self-healing-data-crowdsourcing-trigger',
    title: 'Self-healing data trigger for customer clarification loops',
    domain: 'customer-service',
    tags: ['data-quality', 'crowdsourcing', 'customer-service', 'token'],
    problem:
      'A utility wants to detect likely master-data inconsistencies early and trigger customer clarification flows without manual call-center triage.',
    process: [
      {
        step: 1,
        service: 'mastr-quality',
        action: 'mastr-quality.audit',
        restPath: 'POST /api/mastr-quality/audit',
        params: {
          gridOperatorBdew: null,
          skipSteps: [7],
        },
        description:
          'Detect installation records with missing or inconsistent identifiers, NAP, MeLo, and status metadata.',
      },
      {
        step: 2,
        service: 'customer-service',
        action: 'customer-service.portalWidget',
        restPath: 'POST /api/customer-service/portal-widget',
        params: {
          widgetType: 'installation_change_wizard',
          mode: 'embedded',
          language: 'de',
          includeContactCTA: true,
        },
        description: 'Generate a self-service clarification widget for affected customer cohorts.',
        expectedOutput: 'Embeddable widget payload for digital customer clarification journeys.',
      },
      {
        step: 3,
        service: 'token-manager',
        action: 'token-manager.create',
        restPath: 'POST /api/tokens',
        params: {
          name: 'Self-Healing Data Campaign',
          scope: 'read-only',
        },
        description:
          'Issue scoped integration token for automation flows and auditable campaign execution.',
      },
    ],
    expectedResult:
      'A repeatable, low-touch remediation loop that routes data-quality issues into guided customer self-service.',
    prerequisites: ['Grid operator identifier', 'Customer portal integration path'],
  },
];

module.exports = {
  COOKBOOK_RECIPE_SCHEMA,
  COOKBOOK_RECIPES,
};
