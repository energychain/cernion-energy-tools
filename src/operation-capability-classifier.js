'use strict';

/**
 * Operation Capability Classifier
 *
 * Deterministic rule engine that turns one OpenAPI operation (as found in
 * openapi-export.json) into the metadata shape required by the Operation
 * Capability Index (issue #416): a classification of *what kind of thing*
 * the operation is, *how consequential* invoking it is, and *how an agent
 * should approach calling it* - without deciding whether the agent is
 * ALLOWED to call it. Allow/deny remains a tenant/scope/backend concern
 * (see docs/OPERATION_CAPABILITY_INDEX.md).
 *
 * This module has no I/O - scripts/generate-operation-capability-index.js
 * feeds it operations parsed from openapi-export.json and writes the result.
 */

const { mapOpenApiTagsToDomain, CANONICAL_DOMAINS } = require('./llm-manifest-taxonomy');

// -- Enums (mirrors issue #416 required metadata) ---------------------------

const OPERATION_KINDS = [
  'data_read',
  'dashboard_read',
  'advisory_plan',
  'draft_write',
  'object_store_write',
  'process_start',
  'process_step',
  'admin',
  'external_effect',
  'internal',
  'unknown',
];

const CONSEQUENCE_LEVELS = ['none', 'low', 'medium', 'high'];

const EXECUTION_MODES = ['direct', 'prepare', 'confirm', 'explain_only'];

const IDEMPOTENCY_VALUES = ['idempotent', 'not_idempotent', 'unknown'];

// -- Services whose POST/PUT endpoints are semantically read/query calls ----
// (they accept a filter body but never persist or mutate state). Mirrors
// READ_ONLY_FALLBACK_POST_SERVICES in services/chatgpt-sidecar.service.js -
// this list is the canonical source going forward; the Sidecar constant is a
// candidate for a follow-up dedupe (see docs/OPERATION_CAPABILITY_INDEX.md).
const READ_ONLY_QUERY_SERVICES = new Set([
  'assets',
  'energy-market',
  'entsoe',
  'gas-storage',
  'german-grid',
  'oep',
  'osm-geo',
  'residual-load',
  'tabular',
]);

// Verbs whose presence in summary/description/operationId signal a real
// mutation regardless of which service/method carries them.
// Deliberately excludes the bare words "start"/"stop": they read as ordinary
// nouns/adjectives far more often than as mutating verbs in real operation
// text (e.g. "Range start (YYYY-MM-DD)", "startDate" parameter docs), which
// was false-positiving genuinely read-only endpoints like
// POST /api/energy-market/prices into process_start/consequenceLevel:high.
// Real "start a process" endpoints are still caught downstream by
// START_HINT_PATTERN, which runs on the operations MUTATING_VERB_PATTERN
// already let through as non-read-only via other verbs/method/service.
const MUTATING_VERB_PATTERN =
  /\b(create|update|delete|remove|restore|execute|confirm|approve|reject|promote|rollback|deactivate|mutate|write|token|backup|reload|sync|scan|restart|send|email|webhook|subscribe|unsubscribe|login|logout|refresh|activate|nominate|dispatch|register|provision|revoke|migrate|import|upload|save|edit|assign|grant|invite|archive|publish)\b/i;

// Verbs that indicate a pure, side-effect-free computation/query even when
// carried over POST (used to widen data_read detection beyond the explicit
// READ_ONLY_QUERY_SERVICES allowlist above).
const QUERY_VERB_PATTERN =
  /^(query|search|retrieve|get|list|show|compare|find|lookup|resolve|fetch)\b/i;

const NO_WRITE_HINT_PATTERN = /\bno write\b|\bread-only\b|\bdraft only\b|\bdry.run\b/i;

const DRAFT_HINT_PATTERN = /\bdraft\b|\bprepare\b|\bintent\b/i;

const VALIDATE_HINT_PATTERN = /\b(validate|test|check|simulate|preview|dry.run|dryrun)\b/i;

const START_HINT_PATTERN =
  /\b(promote|activate|trigger|start|submit|nominate|dispatch|execute|run|launch|publish)\b/i;

const STEP_HINT_PATTERN =
  /\b(rollback|deactivate|approve|reject|confirm|cancel|retry|pause|resume|advance|complete)\b/i;

const EXTERNAL_EFFECT_HINT_PATTERN =
  /\b(entsoe|mscons|erp|sap|nomination|notify|email|webhook|export.*grid|submit.*grid|send.*message)\b/i;

const ADMIN_HINT_PATTERN =
  /\b(admin|provision|quota|backup|restore|webhook|migrate|tenant.*create|tenant.*delete)\b/i;

const INTERNAL_SERVICE_HINT = /^(system)$/;

// -- Domain-level rankingSignals overlay -------------------------------------
// Lightweight synonym/negative-cue enrichment applied per canonical domain.
// These are additive hints, not scoring logic - the ranker in
// src/operation-capability-index.js does all scoring.
const DOMAIN_SYNONYMS = {
  'market-data': ['spot price', 'day-ahead', 'EPEX', 'ENTSO-E', 'intraday', 'wholesale market'],
  'grid-ops': ['Netzbetrieb', 'grid operator', 'VNB', 'distribution grid'],
  'grid-planning': ['Netzplanung', 'Zielnetzplanung', 'investment planning'],
  redispatch: ['Redispatch 2.0', 'curtailment', 'congestion management'],
  'energy-sharing': ['Energiegemeinschaft', 'prosumer', 'Section 42c EnWG'],
  'inhouse-data': ['Messstelle', 'metering', 'EDM'],
  regulatory: ['BNetzA', 'EnWG', 'compliance'],
  governance: ['VDMI', 'V/D/M/I matrix', 'audit trail'],
  platform: ['agent infrastructure', 'system'],
};

const DOMAIN_NEGATIVE_CUES = {
  'market-data': ['redispatch settlement', 'grid connection request', 'metering data'],
  redispatch: ['spot price', 'day-ahead auction', 'gas storage'],
  'grid-ops': ['spot price', 'energy sharing community'],
  'energy-sharing': ['redispatch', 'gas storage fill level'],
  'inhouse-data': ['spot price', 'gas storage'],
};

// Curated rankingSignals overlay for a small set of high-traffic, easily
// confused operations (energy-market / ENTSO-E / gas-storage) - distilled
// from the hand-tuned cue regexes in services/chatgpt-sidecar.service.js
// (scoreOpenApiFallbackOperation) that motivated issue #416. Encoding the
// same domain knowledge as declarative signals here lets the generic ranker
// replace that bespoke logic instead of duplicating it forever.
const OPERATION_SIGNAL_OVERLAY = {
  'energy-market_prices': {
    positiveKeywords: ['price', 'prices', 'day-ahead', 'intraday', 'strompreis', 'marktpreis', 'de-lu'],
    negativeCues: ['co2', 'emission', 'installation', 'mastr'],
    synonyms: ['EPEX spot price', 'Day-Ahead-Preis', 'Boersenpreis'],
    examples: ['What is the day-ahead electricity price for Germany tomorrow?'],
  },
  'energy-market_co2Intensity': {
    positiveKeywords: ['co2', 'emission', 'carbon', 'gruenstromindex', 'intensity'],
    negativeCues: ['price', 'installation', 'mastr'],
    synonyms: ['GruenstromIndex', 'carbon intensity', 'CO2-Intensitaet'],
    examples: ['What is the regional CO2 intensity forecast for Germany?'],
  },
  'energy-market_installations': {
    positiveKeywords: ['installation', 'installations', 'mastr', 'pv', 'solar', 'zubau', 'anlage'],
    negativeCues: ['price', 'co2', 'emission'],
    synonyms: ['MaStR-Anlagensuche', 'installed capacity'],
    examples: ['Search installed PV installations in the MaStR registry'],
  },
  'gas-storage_countryStorage': {
    positiveKeywords: ['gas storage', 'fill level', 'fuellstand', 'injection', 'withdrawal'],
    negativeCues: ['compare countries', 'trend'],
    synonyms: ['Gasspeicher-Fuellstand'],
    examples: ['What is the current German gas storage fill level?'],
  },
  'gas-storage_compareCountries': {
    positiveKeywords: ['compare', 'countries', 'laendervergleich', 'cross-country'],
    negativeCues: ['single country fill level'],
    synonyms: ['Laendervergleich Gasspeicher'],
    examples: ['Compare gas storage fill levels across France, Italy and Germany'],
  },
  'gas-storage_storageTrend': {
    positiveKeywords: ['trend', 'tendenz', 'entwicklung', 'historical', 'over time'],
    negativeCues: ['current fill level snapshot'],
    synonyms: ['Speicher-Trendanalyse'],
    examples: ['Show the gas storage trend over the last 30 days'],
  },
  entsoe_dayAheadPrices: {
    positiveKeywords: ['day-ahead', 'price', 'entsoe', 'direct'],
    negativeCues: ['co2', 'installation'],
    synonyms: ['ENTSO-E day-ahead price'],
    examples: ['Query ENTSO-E day-ahead prices directly'],
  },
  entsoe_physicalFlows: {
    positiveKeywords: ['physical flow', 'cross-border', 'bidding zone', 'transmission'],
    negativeCues: ['price', 'co2'],
    synonyms: ['grenzueberschreitender Lastfluss'],
    examples: ['Show physical cross-border flows between Germany and France'],
  },
};

// -- Small helpers --------------------------------------------------------

function toArray(v) {
  return Array.isArray(v) ? v : [];
}

function splitIdentifier(id) {
  return String(id || '')
    .replace(/([a-z0-9])([A-Z])/g, '$1 $2')
    .replace(/[_\-./:]+/g, ' ')
    .toLowerCase()
    .split(/\s+/)
    .filter(Boolean);
}

function pascalCase(slug) {
  return String(slug || '')
    .split(/[-_]/)
    .filter(Boolean)
    .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
    .join('');
}

function deriveServiceSlug(apiPath) {
  const metaMatch = apiPath.match(/^\/api\/(_agent\/[a-z0-9-]+)/);
  if (metaMatch) return 'agent-manifest';
  const m = apiPath.match(/^\/api\/([a-z0-9-]+)(?:\/|$)/);
  return m ? m[1] : 'unknown';
}

function deriveActionRef(serviceName, operationId) {
  // Default export-openapi.js operationId is `${service}_${action}` with
  // dots-to-underscores; service names use hyphens, never underscores, so
  // splitting on the service-name prefix recovers the action name for the
  // majority of operations. Custom operationIds (no such prefix) are left
  // unresolved rather than guessed.
  if (operationId.startsWith(`${serviceName}_`)) {
    return `${serviceName}.${operationId.slice(serviceName.length + 1)}`;
  }
  return null;
}

function textBlob(op) {
  return [op.summary, op.description, toArray(op.tags).join(' '), op.operationId, op.path]
    .filter(Boolean)
    .join(' ');
}

// Same fields as textBlob() minus the free-text `description` prose.
// Long-form descriptions are the most common source of false-positive
// MUTATING_VERB_PATTERN hits (e.g. "Excel import with format=csv",
// "dispatch optimisation", "Range start (YYYY-MM-DD)") because they're
// written as explanatory copy, not a terse statement of what the operation
// does. summary/tags/operationId/path are short, deliberate labels - a
// mutating verb appearing there (e.g. "Create persistent asset override")
// is a much more reliable signal of a genuine write.
function structuredTextBlob(op) {
  return [op.summary, toArray(op.tags).join(' '), op.operationId, op.path].filter(Boolean).join(' ');
}

function isReadOnlyQueryOperation(op, serviceName) {
  if (op.method === 'GET') return true;
  // executePlan runs a bounded in-memory analysis and never mutates source data.
  if (op.method === 'POST' && serviceName === 'tabular') return true;
  if (MUTATING_VERB_PATTERN.test(structuredTextBlob(op))) return false;
  if (op.method === 'POST' && READ_ONLY_QUERY_SERVICES.has(serviceName)) return true;
  if (op.method === 'POST' && QUERY_VERB_PATTERN.test((op.summary || '').trim())) return true;
  return false;
}

function isMetaSpecEndpoint(apiPath) {
  return apiPath === '/api/openapi.json' || apiPath === '/api/openapi-copilot.json';
}

// -- operationKind classification ----------------------------------------

function classifyOperationKind(op, ctx) {
  const { serviceName, tags } = ctx;
  const blob = textBlob(op).toLowerCase();

  if (isMetaSpecEndpoint(op.path)) return 'internal';
  if (INTERNAL_SERVICE_HINT.test(serviceName) && !/agent-manifest|_agent/.test(op.path)) {
    return 'internal';
  }

  if (isReadOnlyQueryOperation(op, serviceName)) {
    const isDashboard =
      ctx.uiPage === 'dashboard' || tags.includes('Dashboard API') || serviceName === 'dashboard-api';
    return isDashboard ? 'dashboard_read' : 'data_read';
  }

  // From here on: a mutating (or verb-flagged) operation.
  if (VALIDATE_HINT_PATTERN.test(blob) && !START_HINT_PATTERN.test(blob)) {
    return 'advisory_plan';
  }

  if (NO_WRITE_HINT_PATTERN.test(blob)) {
    return DRAFT_HINT_PATTERN.test(blob) ? 'draft_write' : 'advisory_plan';
  }

  if (ADMIN_HINT_PATTERN.test(blob) || tags.includes('Tenant Quotas') || tags.includes('Backup & Restore')) {
    return 'admin';
  }

  if (EXTERNAL_EFFECT_HINT_PATTERN.test(blob)) {
    return 'external_effect';
  }

  if (START_HINT_PATTERN.test(blob)) {
    return 'process_start';
  }

  if (STEP_HINT_PATTERN.test(blob)) {
    return 'process_step';
  }

  if (DRAFT_HINT_PATTERN.test(blob)) {
    return 'draft_write';
  }

  if (['post', 'put', 'patch', 'delete'].includes(op.method.toLowerCase())) {
    return 'object_store_write';
  }

  return 'unknown';
}

// -- consequence / execution mode defaults, keyed by operationKind ----------

const KIND_DEFAULTS = {
  data_read: { consequenceLevel: 'none', recommendedExecutionMode: 'direct' },
  dashboard_read: { consequenceLevel: 'none', recommendedExecutionMode: 'direct' },
  advisory_plan: { consequenceLevel: 'low', recommendedExecutionMode: 'explain_only' },
  draft_write: { consequenceLevel: 'low', recommendedExecutionMode: 'prepare' },
  object_store_write: { consequenceLevel: 'medium', recommendedExecutionMode: 'prepare' },
  process_step: { consequenceLevel: 'medium', recommendedExecutionMode: 'prepare' },
  process_start: { consequenceLevel: 'high', recommendedExecutionMode: 'confirm' },
  admin: { consequenceLevel: 'high', recommendedExecutionMode: 'confirm' },
  external_effect: { consequenceLevel: 'high', recommendedExecutionMode: 'confirm' },
  internal: { consequenceLevel: 'none', recommendedExecutionMode: 'explain_only' },
  unknown: { consequenceLevel: 'medium', recommendedExecutionMode: 'confirm' },
};

function deriveConsequenceAndMode(operationKind, op) {
  const base = KIND_DEFAULTS[operationKind] || KIND_DEFAULTS.unknown;
  let { consequenceLevel, recommendedExecutionMode } = base;

  // Deletions are rarely reversible via API regardless of the bucket they
  // otherwise fall into - bump caution accordingly.
  if (op.method.toUpperCase() === 'DELETE' && operationKind !== 'internal') {
    consequenceLevel = consequenceLevel === 'none' ? 'medium' : consequenceLevel;
    recommendedExecutionMode = 'confirm';
  }

  return { consequenceLevel, recommendedExecutionMode };
}

// -- agentable / non-agentable --------------------------------------------

function deriveAgentable(op) {
  if (isMetaSpecEndpoint(op.path)) {
    return {
      agentable: false,
      nonAgentableReason:
        'Returns the raw OpenAPI specification document rather than a business operation result; ' +
        'agents should use the Operation Capability Index artifact instead of calling this endpoint.',
    };
  }
  return { agentable: true, nonAgentableReason: null };
}

// -- idempotency ----------------------------------------------------------

function deriveIdempotency(operationKind, op) {
  const method = op.method.toUpperCase();
  if (method === 'GET' || method === 'PUT' || method === 'DELETE') return 'idempotent';
  if (['data_read', 'dashboard_read', 'advisory_plan'].includes(operationKind)) return 'idempotent';
  if (method === 'POST' || method === 'PATCH') return 'not_idempotent';
  return 'unknown';
}

// -- sideEffects / writesTo / rollbackHint -------------------------------

function deriveSideEffects(operationKind, op) {
  const method = op.method.toUpperCase();
  switch (operationKind) {
    case 'draft_write':
      return ['creates_draft_or_intent'];
    case 'object_store_write':
      return method === 'DELETE' ? ['deletes_stored_object'] : ['creates_or_modifies_stored_object'];
    case 'process_step':
      return ['advances_process_state'];
    case 'process_start':
      return ['starts_new_process_instance'];
    case 'external_effect':
      return ['external_system_call'];
    case 'admin':
      return ['privileged_configuration_change'];
    case 'unknown':
      return ['post', 'put', 'patch', 'delete'].includes(method.toLowerCase())
        ? ['unclassified_state_change']
        : [];
    default:
      return [];
  }
}

function deriveWritesTo(operationKind, serviceName) {
  const writeKinds = [
    'draft_write',
    'object_store_write',
    'process_step',
    'process_start',
    'external_effect',
    'admin',
  ];
  if (!writeKinds.includes(operationKind)) return [];
  return [serviceName];
}

function findSiblingHint(op, allOps, serviceName, pattern) {
  if (!allOps) return null;
  const sibling = allOps.find(
    (candidate) =>
      candidate !== op &&
      deriveServiceSlug(candidate.path) === serviceName &&
      pattern.test(candidate.operationId || '')
  );
  return sibling ? `${sibling.method} ${sibling.path} (${sibling.operationId})` : null;
}

function deriveRollbackHint(operationKind, op, allOps, serviceName) {
  switch (operationKind) {
    case 'draft_write':
      return 'Discard the created draft/intent - no persisted business state changes until a subsequent confirm/promote step.';
    case 'process_start': {
      const sibling = findSiblingHint(op, allOps, serviceName, /rollback|deactivate|cancel|reject/i);
      return sibling
        ? `Companion rollback operation available: ${sibling}.`
        : 'No companion rollback operation detected in this service - verify reversibility with backend/tenant admin before invoking.';
    }
    case 'object_store_write':
      if (op.method.toUpperCase() === 'DELETE') {
        return 'Deletion is generally not reversible via API - restore from backup/audit trail if available.';
      }
      return 'Use the corresponding update/delete operation on the same resource to revert.';
    case 'process_step':
      return 'Check for a companion reject/cancel/rollback operation on the same resource before treating this as final.';
    case 'external_effect':
    case 'admin':
      return 'May not be reversible via API - verify with backend/tenant admin before invoking.';
    default:
      return null;
  }
}

// -- requiredScopes / tenantScoped ---------------------------------------

function deriveScopesAndTenancy(operationKind, serviceName) {
  if (operationKind === 'internal') {
    return { requiredScopes: ['internal'], tenantScoped: false };
  }
  const access = ['data_read', 'dashboard_read', 'advisory_plan'].includes(operationKind)
    ? 'read'
    : 'write';
  const scopes = [`${serviceName}:${access}`];
  if (operationKind === 'admin') scopes.push('admin');
  return { requiredScopes: scopes, tenantScoped: true };
}

// -- dataSources / entityTypes --------------------------------------------

const DATA_SOURCE_KEYWORDS = [
  [/mastr/i, 'MaStR'],
  [/entsoe/i, 'ENTSO-E'],
  [/agsi|gas.storage/i, 'AGSI'],
  [/osm/i, 'OpenStreetMap'],
  [/epex/i, 'EPEX Spot'],
  [/eeg/i, 'EEG Register'],
  [/vdmi/i, 'VDMI'],
  [/oep/i, 'Open Energy Platform'],
  [/grid.operations|vnb/i, 'Grid Operator Registry'],
  [/object.store/i, 'Object Store'],
];

function deriveDataSources(op, tags) {
  const blob = `${textBlob(op)} ${tags.join(' ')}`;
  const sources = new Set();
  for (const [pattern, label] of DATA_SOURCE_KEYWORDS) {
    if (pattern.test(blob)) sources.add(label);
  }
  return [...sources];
}

const ENTITY_TYPE_OVERRIDES = {
  id: null, // resolved from service name instead
  matrixid: 'VdmiMatrix',
  draftid: 'Draft',
  blueprintid: 'Blueprint',
  tenantid: 'Tenant',
  projectid: 'Project',
  snapshotid: 'BackupSnapshot',
  gridoperatorid: 'GridOperator',
  namespace: 'ObjectStoreNamespace',
  key: 'ObjectStoreKey',
};

function deriveEntityTypes(op, serviceName) {
  const params = toArray(op.parameters).filter((p) => p.in === 'path');
  const types = new Set();
  for (const param of params) {
    const name = String(param.name || '').toLowerCase();
    if (Object.prototype.hasOwnProperty.call(ENTITY_TYPE_OVERRIDES, name)) {
      const mapped = ENTITY_TYPE_OVERRIDES[name];
      types.add(mapped || `${pascalCase(serviceName)}Resource`);
    } else {
      types.add(pascalCase(name.replace(/id$/i, '')) || `${pascalCase(serviceName)}Resource`);
    }
  }
  return [...types];
}

// -- parameter metadata + extraction hints -------------------------------

const EXTRACTION_HINTS = [
  [/date|from|start|since/i, 'date_range_start'],
  [/to$|end|until/i, 'date_range_end'],
  [/country|zone|bidding/i, 'country_code'],
  [/matrixid/i, 'vdmi_matrix_id'],
  [/tenantid/i, 'tenant_id'],
  [/(^|_)id$/i, 'entity_id'],
  [/limit|pagesize|top/i, 'result_limit'],
  [/offset|page$/i, 'pagination_offset'],
  [/lat|lon|coordinate/i, 'geo_coordinate'],
];

function extractionHintFor(paramName) {
  for (const [pattern, hint] of EXTRACTION_HINTS) {
    if (pattern.test(paramName)) return hint;
  }
  return null;
}

function normalizeParamEntry(param) {
  const schema = param.schema || {};
  return {
    name: param.name,
    in: param.in || 'query',
    type: schema.type || 'string',
    description: param.description || null,
    extractionHint: extractionHintFor(param.name || ''),
  };
}

function bodyPropertiesToParams(schema, requiredList) {
  if (!schema || schema.type !== 'object' || !schema.properties) return [];
  const required = new Set(toArray(requiredList || schema.required));
  return Object.entries(schema.properties).map(([name, propSchema]) => ({
    name,
    in: 'body',
    type: propSchema.type || 'object',
    description: propSchema.description || null,
    extractionHint: extractionHintFor(name),
    __required: required.has(name),
  }));
}

function deriveParameters(op) {
  const openApiParams = toArray(op.parameters).map(normalizeParamEntry);
  const openApiRequired = toArray(op.parameters)
    .filter((p) => p.required)
    .map((p) => p.name);

  const bodySchema = op.requestBody?.content?.['application/json']?.schema;
  const bodyRequired = op.requestBody?.content?.['application/json']?.schema?.required || [];
  const bodyParams = bodyPropertiesToParams(bodySchema, bodyRequired);

  const required = [];
  const optional = [];

  for (const p of openApiParams) {
    const isRequired = openApiRequired.includes(p.name);
    (isRequired ? required : optional).push(p);
  }
  for (const p of bodyParams) {
    const { __required, ...rest } = p;
    (__required ? required : optional).push(rest);
  }

  return { required, optional };
}

// -- rankingSignals -------------------------------------------------------

function deriveRankingSignals(op, ctx) {
  const { serviceName, domain } = ctx;
  const overlay = OPERATION_SIGNAL_OVERLAY[op.operationId];

  const tokens = new Set([
    ...splitIdentifier(op.operationId),
    ...splitIdentifier(op.summary),
    ...splitIdentifier(serviceName),
    ...toArray(op.tags).flatMap(splitIdentifier),
  ]);
  // Drop very generic stopword-ish tokens that add noise to every operation.
  ['api', 'get', 'post', 'the', 'a', 'of', 'and', 'for'].forEach((t) => tokens.delete(t));
  const positiveKeywords = [...tokens].slice(0, 20);

  const domainSynonyms = DOMAIN_SYNONYMS[domain] || [];
  const domainNegativeCues = DOMAIN_NEGATIVE_CUES[domain] || [];

  const verb = /^(get|list|search|query)/i.test(op.operationId.split('_').pop() || '')
    ? 'Show me'
    : op.method === 'GET'
      ? 'Show me'
      : 'Please';
  const examples = overlay?.examples || [`${verb} ${(op.summary || op.operationId).toLowerCase()}`];

  return {
    positiveKeywords: overlay ? [...new Set([...overlay.positiveKeywords, ...positiveKeywords])] : positiveKeywords,
    negativeCues: overlay ? overlay.negativeCues : domainNegativeCues,
    examples,
    synonyms: overlay ? overlay.synonyms : domainSynonyms,
    // True when negativeCues/synonyms came from the hand-tuned per-operation
    // OPERATION_SIGNAL_OVERLAY rather than the generic per-domain fallback -
    // the ranker (src/operation-capability-index.js) weighs curated signals
    // higher since domain-level synonyms are shared by every operation in
    // that domain and are too coarse to disambiguate between them.
    curated: Boolean(overlay),
  };
}

// -- capabilityCandidates -------------------------------------------------

function deriveCapabilityCandidates(op, ctx, curatedCapabilities) {
  const { actionRef, serviceName, operationKind } = ctx;
  if (operationKind === 'internal') return [];

  const candidates = new Set();
  if (actionRef && Array.isArray(curatedCapabilities)) {
    for (const capability of curatedCapabilities) {
      const refs = [...toArray(capability.preferredActions), ...toArray(capability.fallbackActions)];
      const matches = refs.some((ref) => {
        const normalized = String(ref).replace(/^v\d+\./, '');
        return normalized === actionRef;
      });
      if (matches) candidates.add(capability.capability);
    }
  }

  if (candidates.size === 0) {
    const actionSlug = (op.operationId.startsWith(`${serviceName}_`)
      ? op.operationId.slice(serviceName.length + 1)
      : op.operationId
    ).replace(/[A-Z]/g, (c) => `_${c.toLowerCase()}`);
    candidates.add(`${serviceName}.${actionSlug}`.replace(/_+/g, '_'));
  }

  return [...candidates];
}

// -- public API ------------------------------------------------------------

/**
 * Classifies a single OpenAPI operation.
 *
 * @param {object} op - { path, method, operationId, summary, description, tags, parameters, requestBody, 'x-ui-page', 'x-oeo-class' }
 * @param {object} [options]
 * @param {Array} [options.curatedCapabilities] - CURATED_CAPABILITIES from src/capability-catalog.js, used to cross-reference capabilityCandidates.
 * @param {Array} [options.allOperations] - full operation list (raw), used for rollbackHint sibling lookups.
 */
function classifyOperation(op, options = {}) {
  const serviceName = deriveServiceSlug(op.path);
  const tags = toArray(op.tags);
  const domain = mapOpenApiTagsToDomain(tags);
  const uiPage = op['x-ui-page'] || null;
  const ctx = { serviceName, tags, domain, uiPage };

  const operationKind = classifyOperationKind(op, ctx);
  const { consequenceLevel, recommendedExecutionMode } = deriveConsequenceAndMode(operationKind, op);
  const { agentable, nonAgentableReason } = deriveAgentable(op);
  const actionRef = deriveActionRef(serviceName, op.operationId);
  ctx.actionRef = actionRef;
  ctx.operationKind = operationKind;

  const finalExecutionMode = agentable ? recommendedExecutionMode : 'explain_only';

  return {
    operationId: op.operationId,
    method: op.method.toUpperCase(),
    path: op.path,
    service: serviceName,
    action: actionRef,
    summary: op.summary || null,
    tags,
    uiPage,
    oeoClass: op['x-oeo-class'] || null,
    operationKind,
    consequenceLevel,
    recommendedExecutionMode: finalExecutionMode,
    agentable,
    nonAgentableReason,
    capabilityCandidates: deriveCapabilityCandidates(op, ctx, options.curatedCapabilities),
    domains: domain === 'unmapped' ? [] : [domain],
    dataSources: deriveDataSources(op, tags),
    entityTypes: deriveEntityTypes(op, serviceName),
    requiredScopes: deriveScopesAndTenancy(operationKind, serviceName).requiredScopes,
    tenantScoped: deriveScopesAndTenancy(operationKind, serviceName).tenantScoped,
    writesTo: deriveWritesTo(operationKind, serviceName),
    sideEffects: deriveSideEffects(operationKind, op),
    idempotency: deriveIdempotency(operationKind, op),
    rollbackHint: deriveRollbackHint(operationKind, op, options.allOperations, serviceName),
    parameters: deriveParameters(op),
    rankingSignals: deriveRankingSignals(op, ctx),
  };
}

module.exports = {
  OPERATION_KINDS,
  CONSEQUENCE_LEVELS,
  EXECUTION_MODES,
  IDEMPOTENCY_VALUES,
  CANONICAL_DOMAINS,
  READ_ONLY_QUERY_SERVICES,
  classifyOperation,
  deriveServiceSlug,
  deriveActionRef,
};
