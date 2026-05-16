'use strict';

/**
 * v0.52.5 — Fixed normalization map from markdown TDD terminology
 * to concrete backend route aliases used by api.service.js.
 *
 * Why this exists:
 * - The architecture markdown uses conceptual endpoint naming in some places.
 * - Backend aliases are the executable truth for CI/Jest tests.
 * - This map prevents false negatives due to wording/path drift.
 */

const MATRIX_NORMALIZATION_VERSION = '0.52.5';

/**
 * Fixed per-testcase normalization contract.
 *
 * Shape:
 * {
 *   [id]: {
 *     intentClass: string,
 *     aliases: string[],             // canonical executable aliases (METHOD /path)
 *     executionMode?: string,        // optional personal-agent execution mode for MT cases
 *     knownContext?: object,         // optional knownContext payload for MT cases
 *     expectedReplyKeywords?: string[],
 *     forbiddenReplyKeywords?: string[],
 *     notes?: string                 // optional traceability note
 *   }
 * }
 */
const FIXED_TDD_NORMALIZATION_MAP = Object.freeze({
  // -------------------------------------------------------------------------
  // Investitionsplanung
  // -------------------------------------------------------------------------
  'T-INV-01': {
    intentClass: 'investment-planning.create',
    aliases: ['POST /investment-planning/plans'],
  },
  'T-INV-02': {
    intentClass: 'investment-planning.list',
    aliases: ['GET /investment-planning/plans'],
  },
  'T-INV-03': {
    intentClass: 'investment-planning.economics',
    aliases: ['GET /investment-planning/plans/:id', 'POST /finance-agent/fnav/economics'],
  },

  // -------------------------------------------------------------------------
  // ZNP
  // -------------------------------------------------------------------------
  'T-ZNP-01': {
    intentClass: 'znp.project.create',
    aliases: ['POST /znp/projects'],
  },
  'T-ZNP-02': {
    intentClass: 'znp.layer0.run',
    aliases: ['POST /znp/projects/:projectId/layer0'],
  },
  'T-ZNP-03': {
    intentClass: 'znp.analysis.gfactor',
    aliases: ['GET /znp/projects/:projectId/g-factor'],
  },
  'T-ZNP-04': {
    intentClass: 'znp.analysis.disturbance',
    aliases: ['GET /znp/projects/:projectId/portfolio'],
    notes: 'Spec endpoint correlate-disturbance is normalized to existing portfolio analysis endpoint.',
  },
  'T-ZNP-05': {
    intentClass: 'znp.analysis.strategy',
    aliases: ['GET /znp/projects/:projectId/strategic-prompts'],
  },

  // -------------------------------------------------------------------------
  // fNAV & Grid-Connection
  // -------------------------------------------------------------------------
  'T-NAV-01': {
    intentClass: 'grid-connection.validate',
    aliases: [
      'POST /grid-connection/validate',
      'GET /jobs/:jobId/status',
      'GET /jobs/:jobId/result',
    ],
  },
  'T-NAV-02': {
    intentClass: 'grid-connection.list',
    aliases: ['GET /grid-connection/validations'],
  },
  'T-NAV-03': {
    intentClass: 'grid-connection.fnav',
    aliases: ['POST /grid-connection/fnav/validate'],
  },

  // -------------------------------------------------------------------------
  // VDMI & Regulatorik
  // -------------------------------------------------------------------------
  'T-VDM-01': {
    intentClass: 'vdmi.create',
    aliases: ['PATCH /vdmi/tenants/:tenantId/matrices/:matrixId'],
    notes: 'Spec create endpoint is normalized to tenant-scoped matrix upsert route.',
  },
  'T-VDM-02': {
    intentClass: 'vdmi.nominate',
    aliases: ['POST /vdmi/tenants/:tenantId/tasks/:taskId/evidence'],
    notes: 'Nomination semantics are represented through existing task evidence workflow.',
  },
  'T-VDM-03': {
    intentClass: 'vdmi.responsibilities',
    aliases: [
      'GET /vdmi/tenants/:tenantId/tasks/:taskId/dossier',
      'GET /vdmi/tenants/:tenantId/tasks/:taskId/negotiation-trace',
    ],
  },
  'T-VDM-04': {
    intentClass: 'vdmi.findings',
    aliases: ['GET /vdmi/tenants/:tenantId/findings'],
  },
  'T-VDM-05': {
    intentClass: 'vdmi.audit',
    aliases: ['GET /vdmi/tenants/:tenantId/tasks/:taskId/negotiation-trace'],
  },
  'T-VDM-06': {
    intentClass: 'vdmi.templates',
    aliases: ['GET /vdmi/tenants/:tenantId/tasks/:taskId/dossier'],
    notes: 'No explicit templates endpoint exists; dossier route is the nearest governed artifact source.',
  },

  // -------------------------------------------------------------------------
  // EDM
  // -------------------------------------------------------------------------
  'T-EDM-01': {
    intentClass: 'edm.melos.list',
    aliases: ['GET /edm/melos'],
  },
  'T-EDM-02': {
    intentClass: 'edm.timeseries.get',
    aliases: ['GET /edm/timeseries/:meloId'],
  },
  'T-EDM-03': {
    intentClass: 'edm.timeseries.import',
    aliases: ['POST /edm/timeseries/import'],
  },
  'T-EDM-04': {
    intentClass: 'edm.validation.check',
    aliases: ['POST /edm/validate'],
    notes: 'Spec path /edm-validation/validate is normalized to current /edm/validate alias.',
  },
  'T-EDM-05': {
    intentClass: 'edm.messkonzept.create',
    aliases: ['POST /edm/messkonzepte', 'POST /edm/messkonzepte/:id/evaluate'],
  },
  'T-EDM-06': {
    intentClass: 'edm.virtual.slp',
    aliases: ['POST /edm/virtual/populate-slp'],
    notes: 'Spec path /edm-virtual/virtual/populate-slp normalized to /edm/virtual/populate-slp.',
  },

  // -------------------------------------------------------------------------
  // Redispatch & Bilanzkreis
  // -------------------------------------------------------------------------
  'T-RED-01': {
    intentClass: 'redispatch.audit.run',
    aliases: ['POST /redispatch/audit'],
  },
  'T-RED-02': {
    intentClass: 'redispatch.audit.list',
    aliases: ['GET /redispatch/audits'],
  },
  'T-RED-03': {
    intentClass: 'settlement.redispatch',
    aliases: ['POST /settlement/redispatch/calculate', 'GET /settlement/redispatch/report/:settlementId'],
  },
  'T-BIL-01': {
    intentClass: 'bilanzkreis.create',
    aliases: ['POST /bilanzkreis'],
  },
  'T-BIL-02': {
    intentClass: 'bilanzkreis.readiness',
    aliases: ['GET /bilanzkreis/:id/readiness'],
  },

  // -------------------------------------------------------------------------
  // Forecast & Flex
  // -------------------------------------------------------------------------
  'T-FOR-01': {
    intentClass: 'forecast.generation',
    aliases: ['POST /forecast/generation'],
  },
  'T-FOR-02': {
    intentClass: 'forecast.schedule.dayahead',
    aliases: ['POST /forecast/schedule/day-ahead'],
  },
  'T-FOR-03': {
    intentClass: 'forecast.residual',
    aliases: ['POST /forecast/residual'],
  },
  'T-FLE-01': {
    intentClass: 'flex.devices.list',
    aliases: ['GET /flex/devices'],
  },
  'T-FLE-02': {
    intentClass: 'flex.event.plan',
    aliases: ['POST /flex/events/plan'],
  },
  'T-FLE-03': {
    intentClass: 'flex.event.execute',
    aliases: ['POST /flex/events/execute'],
  },
  'T-FLE-04': {
    intentClass: 'flex.reliefproof',
    aliases: ['GET /flex/relief-proof/:period'],
  },

  // -------------------------------------------------------------------------
  // Marktdaten & Settlement
  // -------------------------------------------------------------------------
  'T-MKT-01': {
    intentClass: 'market.prices.dayahead',
    aliases: ['GET /dashboard/market-snapshot'],
    notes: 'Spec ENTSOE/energy-market endpoints normalized to current dashboard market snapshot.',
  },
  'T-MKT-02': {
    intentClass: 'market.co2',
    aliases: ['GET /dashboard/market-snapshot'],
    notes: 'Spec CO2 endpoint normalized to current market snapshot aggregate.',
  },
  'T-SET-01': {
    intentClass: 'settlement.eeg',
    aliases: ['POST /settlement/eeg/calculate', 'GET /settlement/eeg/report/:settlementId'],
  },
  'T-SET-02': {
    intentClass: 'settlement.a96',
    aliases: ['POST /settlement/a96/prepare', 'GET /settlement/a96/export/:settlementId'],
  },

  // -------------------------------------------------------------------------
  // MaStR Monitoring & Qualität
  // -------------------------------------------------------------------------
  'T-MAS-01': {
    intentClass: 'mastr.watch.create',
    aliases: ['POST /mastr-monitor/watches'],
  },
  'T-MAS-02': {
    intentClass: 'mastr.watch.delta',
    aliases: ['GET /mastr-monitor/watches/:watchId/deltas'],
  },
  'T-MAS-03': {
    intentClass: 'mastr.quality.audit',
    aliases: ['POST /mastr-quality/audit'],
  },
  'T-MAS-04': {
    intentClass: 'mastr.quality.findings',
    aliases: [
      'GET /mastr-quality/audits',
      'GET /mastr-quality/audits/:id/findings/:findingId/details',
    ],
  },

  // -------------------------------------------------------------------------
  // Finance Agent
  // -------------------------------------------------------------------------
  'T-FIN-01': {
    intentClass: 'finance.analyze',
    aliases: ['POST /finance-agent/analyze'],
  },
  'T-FIN-02': {
    intentClass: 'finance.benchmark',
    aliases: ['POST /finance-agent/analyze'],
    notes: 'No dedicated benchmark endpoint; normalized to analyze endpoint in current backend.',
  },
  'T-FIN-03': {
    intentClass: 'finance.history',
    aliases: ['GET /finance-agent/analyses'],
  },

  // -------------------------------------------------------------------------
  // Blindflug-Radar
  // -------------------------------------------------------------------------
  'T-BFR-01': {
    intentClass: 'blindflug.scan',
    aliases: ['POST /blindflug-radar/scan'],
  },
  'T-BFR-02': {
    intentClass: 'blindflug.recommend',
    aliases: ['POST /blindflug-radar/recommendations'],
  },
  'T-BFR-03': {
    intentClass: 'blindflug.history',
    aliases: ['GET /blindflug-radar/scans'],
  },

  // -------------------------------------------------------------------------
  // HITL
  // -------------------------------------------------------------------------
  'T-HIT-01': {
    intentClass: 'hitl.list',
    aliases: ['GET /hitl/items'],
  },
  'T-HIT-02': {
    intentClass: 'hitl.approve',
    aliases: ['POST /hitl/items/:id/approve'],
  },
  'T-HIT-03': {
    intentClass: 'hitl.sla',
    aliases: ['GET /hitl/sla-heatmap'],
  },

  // -------------------------------------------------------------------------
  // Energy Sharing
  // -------------------------------------------------------------------------
  'T-ESH-01': {
    intentClass: 'energy-sharing.validate',
    aliases: ['POST /energy-sharing/validate'],
  },
  'T-ESH-02': {
    intentClass: 'energy-sharing.allocate',
    aliases: ['POST /energy-sharing-allocation/allocate'],
  },

  // -------------------------------------------------------------------------
  // Allgemeine Abfragen & Intelligence
  // -------------------------------------------------------------------------
  'T-QUE-01': {
    intentClass: 'query.intelligent',
    aliases: ['POST /objects/:namespace/query'],
    notes: 'Spec query.ask / ask-learned normalized to inhouse object query alias.',
  },
  'T-QUE-02': {
    intentClass: 'knowledge.rag',
    aliases: ['POST /knowledge-rag/query', 'POST /knowledge-rag/semantic'],
  },
  'T-QUE-03': {
    intentClass: 'market.snapshot',
    aliases: ['GET /dashboard/market-snapshot'],
  },
  'T-QUE-04': {
    intentClass: 'observability.health',
    aliases: ['GET /observability/summary', 'GET /dashboard/observability-mini'],
    notes: 'Spec /system/status normalized to observability summary endpoints.',
  },

  // -------------------------------------------------------------------------
  // Multi-Turn Personal-Agent Scenarios
  // -------------------------------------------------------------------------
  'MT-JOU-01': {
    intentClass: 'cya.generate',
    aliases: ['POST /personal-agent/chat'],
    executionMode: 'hitl',
    expectedReplyKeywords: ['versorgungssicherheit', 'stand'],
  },
  'MT-JOU-02': {
    intentClass: 'cya.generate',
    aliases: ['POST /personal-agent/chat'],
    executionMode: 'hitl',
    expectedReplyKeywords: ['belastbare', 'unsicherheiten'],
  },
  'MT-JOU-03': {
    intentClass: 'cya.generate',
    aliases: ['POST /personal-agent/chat'],
    executionMode: 'hitl',
    expectedReplyKeywords: ['kernaussagen', 'drei'],
  },
  'MT-JOU-04': {
    intentClass: 'cya.generate',
    aliases: ['POST /personal-agent/chat'],
    executionMode: 'hitl',
    expectedReplyKeywords: ['journalistisches', 'fazit'],
    forbiddenReplyKeywords: ['garantiert', 'ohne zweifel'],
  },
  'MT-INV-01': {
    intentClass: 'finance.benchmark',
    aliases: ['POST /personal-agent/chat'],
    executionMode: 'hitl',
    expectedReplyKeywords: ['vergleiche', 'anschlussgeschwindigkeit'],
  },
  'MT-INV-02': {
    intentClass: 'finance.benchmark',
    aliases: ['POST /personal-agent/chat'],
    executionMode: 'hitl',
    expectedReplyKeywords: ['digitalisierung', 'umsetzungsquote'],
  },
  'MT-INV-03': {
    intentClass: 'finance.benchmark',
    aliases: ['POST /personal-agent/chat'],
    executionMode: 'hitl',
    expectedReplyKeywords: ['anschlussgeschwindigkeit', 'zusammen'],
  },
  'MT-INV-04': {
    intentClass: 'finance.benchmark',
    aliases: ['POST /personal-agent/chat'],
    executionMode: 'hitl',
    expectedReplyKeywords: ['rangliste', 'begruendung'],
  },
  'MT-VOR-01': {
    intentClass: 'grid-connection.fnav',
    aliases: ['POST /personal-agent/chat'],
    executionMode: 'hitl',
    knownContext: {
      gridOperatorName: 'TWL Netze',
      voltageLevel: 'MS',
      ownerContact: 'netzplanung@twl.de',
      annualFeeEur: 12000,
      fnavProfile: { requestedCapacity: 10000, flexibleCapacity: 3500 },
    },
    expectedReplyKeywords: ['frankfurt', 'rechenzentrum'],
  },
  'MT-VOR-02': {
    intentClass: 'grid-connection.fnav',
    aliases: ['POST /personal-agent/chat'],
    executionMode: 'hitl',
    knownContext: {
      gridOperatorName: 'TWL Netze',
      voltageLevel: 'MS',
      ownerContact: 'netzplanung@twl.de',
      annualFeeEur: 12000,
      fnavProfile: { requestedCapacity: 10000, flexibleCapacity: 3500 },
    },
    expectedReplyKeywords: ['n-1', 'reserve'],
  },
  'MT-VOR-03': {
    intentClass: 'grid-connection.fnav',
    aliases: ['POST /personal-agent/chat'],
    executionMode: 'hitl',
    knownContext: {
      gridOperatorName: 'TWL Netze',
      voltageLevel: 'MS',
      ownerContact: 'netzplanung@twl.de',
      annualFeeEur: 12000,
      fnavProfile: { requestedCapacity: 10000, flexibleCapacity: 3500 },
    },
    expectedReplyKeywords: ['fnav', '5 jahre'],
  },
  'MT-VOR-04': {
    intentClass: 'grid-connection.fnav',
    aliases: ['POST /personal-agent/chat'],
    executionMode: 'hitl',
    knownContext: {
      gridOperatorName: 'TWL Netze',
      voltageLevel: 'MS',
      ownerContact: 'netzplanung@twl.de',
      annualFeeEur: 12000,
      fnavProfile: { requestedCapacity: 10000, flexibleCapacity: 3500 },
    },
    expectedReplyKeywords: ['muenchen', 'aktualisiere'],
    forbiddenReplyKeywords: ['frankfurt'],
  },
});

function normalizeDefinition(id, testCase) {
  const def = FIXED_TDD_NORMALIZATION_MAP[id];
  if (!def) {
    return {
      id,
      intentClass: String(testCase?.intentClass || '').trim(),
      aliases: [],
      rawServiceCalls: Array.isArray(testCase?.serviceCallsSpec) ? testCase.serviceCallsSpec : [],
      normalizedServiceCalls: Array.isArray(testCase?.serviceCallsSpec)
        ? testCase.serviceCallsSpec.map(normalizeRouteSpec)
        : [],
      executionMode: null,
      knownContext: {},
      expectedReplyKeywords: [],
      forbiddenReplyKeywords: [],
      notes: 'UNMAPPED_TESTCASE_ID',
    };
  }

  const aliases = Array.isArray(def.aliases) ? def.aliases.map(normalizeRouteSpec) : [];
  const rawServiceCalls = Array.isArray(testCase?.serviceCallsSpec) ? testCase.serviceCallsSpec : [];

  return {
    id,
    intentClass: def.intentClass,
    aliases,
    rawServiceCalls,
    normalizedServiceCalls: rawServiceCalls.map(normalizeRouteSpec),
    executionMode: def.executionMode || null,
    knownContext: def.knownContext || {},
    expectedReplyKeywords: Array.isArray(def.expectedReplyKeywords) ? def.expectedReplyKeywords : [],
    forbiddenReplyKeywords: Array.isArray(def.forbiddenReplyKeywords) ? def.forbiddenReplyKeywords : [],
    notes: def.notes || '',
  };
}

/**
 * Normalize a route-spec into alias form used by API gateway aliases.
 * Example: POST /api/x/y -> POST /x/y
 *
 * @param {string} routeSpec
 * @returns {string}
 */
function normalizeRouteSpec(routeSpec) {
  const input = String(routeSpec || '').trim().replace(/\s+/g, ' ');
  if (!input) return input;

  const match = input.match(/^(GET|POST|PUT|PATCH|DELETE)\s+(.+)$/i);
  if (!match) return input;

  const method = match[1].toUpperCase();
  let endpoint = match[2].trim();

  endpoint = endpoint.replace(/^https?:\/\/[^/]+/i, '');
  endpoint = endpoint.replace(/^\/api(?=\/|$)/i, '');
  if (!endpoint.startsWith('/')) endpoint = `/${endpoint}`;

  return `${method} ${endpoint}`;
}

/**
 * Resolve normalized definition for a parsed matrix testcase.
 *
 * @param {{id:string,prompt:string,intentClass:string,serviceCallsSpec:string[]}} testCase
 * @returns {{id:string,intentClass:string,aliases:string[],rawServiceCalls:string[],normalizedServiceCalls:string[],notes:string}}
 */
function normalizeMatrixTestCase(testCase) {
  const id = String(testCase?.id || '').trim();
  const normalized = normalizeDefinition(id, testCase);

  if (!Array.isArray(testCase?.turns) || testCase.turns.length === 0) {
    return normalized;
  }

  return {
    ...normalized,
    turns: testCase.turns.map((turn) => ({
      ...turn,
      ...normalizeDefinition(turn.id, turn),
    })),
  };
}

function getNormalizationMap() {
  return FIXED_TDD_NORMALIZATION_MAP;
}

function getNormalizedTestIds() {
  return Object.keys(FIXED_TDD_NORMALIZATION_MAP).sort();
}

module.exports = {
  MATRIX_NORMALIZATION_VERSION,
  FIXED_TDD_NORMALIZATION_MAP,
  normalizeRouteSpec,
  normalizeMatrixTestCase,
  getNormalizationMap,
  getNormalizedTestIds,
};
