'use strict';

const PERSONAL_AGENT_WORK_OUT_LOUD_EVENT = 'personal-agent.work-out-loud';
const PERSONAL_AGENT_WORK_OUT_LOUD_AGENT_ID = 'personal-agent';

const WORK_OUT_LOUD_SIGNAL_TYPES = Object.freeze({
  BOOTSTRAP_CONTEXT_UPDATED: 'bootstrap_context_updated',
  ONBOARDING_FACT_LEARNED: 'onboarding_fact_learned',
  SCOPED_FACT_LEARNED: 'scoped_fact_learned',
});

const WORK_OUT_LOUD_SIGNAL_CATEGORIES = Object.freeze({
  ORGANIZATION: 'organization',
  ROLE: 'role',
  PROJECT: 'project',
  OPERATOR: 'operator',
  LOCATION: 'location',
  TECHNICAL: 'technical',
  CONTEXT: 'context',
});

const VALID_SIGNAL_TYPES = new Set(Object.values(WORK_OUT_LOUD_SIGNAL_TYPES));
const VALID_SIGNAL_CATEGORIES = new Set(Object.values(WORK_OUT_LOUD_SIGNAL_CATEGORIES));

const SAFE_CONTEXT_FIELDS = Object.freeze([
  'organizationType',
  'responsibleRole',
  'roleId',
  'projectId',
  'gridOperatorId',
  'gridOperatorName',
  'gridOperatorBdew',
  'bdew',
  'vnbName',
  'voltageLevel',
  'postalCode',
  'postleitzahl',
  'location',
  'city',
  'fnavProfile',
]);

const SAFE_CONTEXT_FIELD_SET = new Set(SAFE_CONTEXT_FIELDS);

const SAFE_VALUE_FIELDS = new Set([
  'organizationType',
  'roleId',
  'projectId',
  'gridOperatorId',
  'gridOperatorBdew',
  'bdew',
  'voltageLevel',
  'postalCode',
  'postleitzahl',
]);

const VALID_EVIDENCE_SOURCE_KINDS = new Set([
  'bootstrap_context',
  'known_context',
  'onboarding_answer',
  'scoped_knowledge',
]);

const VALID_SCOPE_VALUES = new Set([
  'session',
  'user',
  'role',
  'tenant_candidate',
  'tenant',
  'tenant_operational',
]);

const VALID_UPDATE_REASONS = new Set([
  'context_replace',
  'context_append',
  'known_context_merge',
  'onboarding_answer',
]);

function sanitizeString(value, { maxLength = 120 } = {}) {
  if (typeof value !== 'string') return null;
  const normalized = value
    .slice(0, maxLength)
    .trim()
    .replace(/[\x00-\x1f]/g, '');
  return normalized || null;
}

function sanitizeCode(value, { maxLength = 64 } = {}) {
  const normalized = sanitizeString(value, { maxLength });
  if (!normalized) return null;
  if (!/^[a-zA-Z0-9_.:-]+$/.test(normalized)) return null;
  return normalized;
}

function sanitizeScalarValue(value) {
  if (typeof value === 'string') {
    return sanitizeString(value, { maxLength: 120 });
  }
  if (typeof value === 'number') {
    return Number.isFinite(value) ? value : null;
  }
  if (typeof value === 'boolean') {
    return value;
  }
  return null;
}

function sanitizeConfidence(value, fallback = 0.8) {
  if (typeof value !== 'number' || !Number.isFinite(value)) return fallback;
  if (value < 0) return 0;
  if (value > 1) return 1;
  return value;
}

function sanitizeSuggestionArray(values, maxItems = 8) {
  if (!Array.isArray(values)) return [];
  return values
    .map((value) => sanitizeCode(value, { maxLength: 64 }))
    .filter(Boolean)
    .slice(0, maxItems);
}

function getSignalCategoryForContextField(contextField) {
  switch (contextField) {
    case 'organizationType':
      return WORK_OUT_LOUD_SIGNAL_CATEGORIES.ORGANIZATION;
    case 'responsibleRole':
    case 'roleId':
      return WORK_OUT_LOUD_SIGNAL_CATEGORIES.ROLE;
    case 'projectId':
      return WORK_OUT_LOUD_SIGNAL_CATEGORIES.PROJECT;
    case 'gridOperatorId':
    case 'gridOperatorName':
    case 'gridOperatorBdew':
    case 'bdew':
    case 'vnbName':
      return WORK_OUT_LOUD_SIGNAL_CATEGORIES.OPERATOR;
    case 'postalCode':
    case 'postleitzahl':
    case 'location':
    case 'city':
      return WORK_OUT_LOUD_SIGNAL_CATEGORIES.LOCATION;
    case 'voltageLevel':
    case 'fnavProfile':
      return WORK_OUT_LOUD_SIGNAL_CATEGORIES.TECHNICAL;
    default:
      return WORK_OUT_LOUD_SIGNAL_CATEGORIES.CONTEXT;
  }
}

function getSafeSignalValueForContextField(contextField, rawValue) {
  const field = sanitizeCode(contextField, { maxLength: 64 });
  if (!field || !SAFE_CONTEXT_FIELD_SET.has(field)) {
    return null;
  }
  if (SAFE_VALUE_FIELDS.has(field)) {
    const normalized = sanitizeScalarValue(rawValue);
    if (normalized !== null) return normalized;
  }
  return field;
}

function sanitizeSignal(signal = {}) {
  const type = sanitizeCode(signal.type, { maxLength: 64 });
  const category = sanitizeCode(signal.category, { maxLength: 64 });
  const value = sanitizeScalarValue(signal.value);

  if (!type || !VALID_SIGNAL_TYPES.has(type)) return null;
  if (!category || !VALID_SIGNAL_CATEGORIES.has(category)) return null;
  if (value === null) return null;

  return {
    type,
    category,
    value,
    confidence: sanitizeConfidence(signal.confidence),
  };
}

function sanitizeRelevance(relevance = {}) {
  return {
    suggestedCapabilities: sanitizeSuggestionArray(relevance.suggestedCapabilities, 8),
    suggestedRoles: sanitizeSuggestionArray(relevance.suggestedRoles, 8),
  };
}

function sanitizeEvidence(evidence = {}) {
  const output = {};

  const sourceKind = sanitizeCode(evidence.sourceKind, { maxLength: 64 });
  if (sourceKind && VALID_EVIDENCE_SOURCE_KINDS.has(sourceKind)) {
    output.sourceKind = sourceKind;
  }

  const contextField = sanitizeCode(evidence.contextField, { maxLength: 64 });
  if (contextField && SAFE_CONTEXT_FIELD_SET.has(contextField)) {
    output.contextField = contextField;
  }

  const scope = sanitizeCode(evidence.scope, { maxLength: 64 });
  if (scope && VALID_SCOPE_VALUES.has(scope)) {
    output.scope = scope;
  }

  const updateReason = sanitizeCode(evidence.updateReason, { maxLength: 64 });
  if (updateReason && VALID_UPDATE_REASONS.has(updateReason)) {
    output.updateReason = updateReason;
  }

  return output;
}

function buildWorkOutLoudPayload(input = {}) {
  const tenantId = sanitizeString(input.tenantId, { maxLength: 128 });
  if (!tenantId) return null;

  const userId = sanitizeString(input.userId, { maxLength: 128 }) || 'anonymous';
  const agentId =
    sanitizeCode(input.agentId || PERSONAL_AGENT_WORK_OUT_LOUD_AGENT_ID, { maxLength: 64 }) ||
    PERSONAL_AGENT_WORK_OUT_LOUD_AGENT_ID;
  if (agentId !== PERSONAL_AGENT_WORK_OUT_LOUD_AGENT_ID) return null;

  const signal = sanitizeSignal(input.signal || {});
  if (!signal) return null;

  const relevance = sanitizeRelevance(input.relevance || {});
  const evidence = sanitizeEvidence(input.evidence || {});
  const timestamp = sanitizeString(input.timestamp, { maxLength: 64 }) || new Date().toISOString();

  if (Number.isNaN(Date.parse(timestamp))) return null;

  return {
    tenantId,
    userId,
    agentId,
    signal,
    relevance,
    evidence,
    timestamp,
  };
}

function buildContextFieldWorkOutLoudPayload({
  tenantId,
  userId,
  signalType,
  contextField,
  rawValue,
  sourceKind,
  scope,
  updateReason,
  confidence = 0.8,
} = {}) {
  const field = sanitizeCode(contextField, { maxLength: 64 });
  if (!field || !SAFE_CONTEXT_FIELD_SET.has(field)) {
    return null;
  }

  const suggestedRoles = [];
  const safeRole = field === 'roleId' ? sanitizeCode(rawValue, { maxLength: 64 }) : null;
  if (safeRole) {
    suggestedRoles.push(safeRole);
  }

  return buildWorkOutLoudPayload({
    tenantId,
    userId,
    agentId: PERSONAL_AGENT_WORK_OUT_LOUD_AGENT_ID,
    signal: {
      type: signalType,
      category: getSignalCategoryForContextField(field),
      value: getSafeSignalValueForContextField(field, rawValue),
      confidence,
    },
    relevance: {
      suggestedCapabilities: [],
      suggestedRoles,
    },
    evidence: {
      sourceKind,
      contextField: field,
      scope,
      updateReason,
    },
    timestamp: new Date().toISOString(),
  });
}

function validateWorkOutLoudPayload(payload) {
  const sanitized = buildWorkOutLoudPayload(payload);
  if (!sanitized) {
    throw new Error('Invalid Work Out Loud payload');
  }

  const rootKeys = Object.keys(payload || {}).sort();
  const allowedRootKeys = [
    'agentId',
    'evidence',
    'relevance',
    'signal',
    'tenantId',
    'timestamp',
    'userId',
  ];
  if (JSON.stringify(rootKeys) !== JSON.stringify(allowedRootKeys)) {
    throw new Error('Unexpected root keys in Work Out Loud payload');
  }

  const signalKeys = Object.keys(payload.signal || {}).sort();
  if (JSON.stringify(signalKeys) !== JSON.stringify(['category', 'confidence', 'type', 'value'])) {
    throw new Error('Unexpected signal keys in Work Out Loud payload');
  }

  const relevanceKeys = Object.keys(payload.relevance || {}).sort();
  if (
    JSON.stringify(relevanceKeys) !== JSON.stringify(['suggestedCapabilities', 'suggestedRoles'])
  ) {
    throw new Error('Unexpected relevance keys in Work Out Loud payload');
  }

  const evidenceKeys = Object.keys(payload.evidence || {}).sort();
  const allowedEvidenceKeys = Object.keys(sanitized.evidence || {}).sort();
  if (JSON.stringify(evidenceKeys) !== JSON.stringify(allowedEvidenceKeys)) {
    throw new Error('Unexpected evidence keys in Work Out Loud payload');
  }

  return sanitized;
}

module.exports = {
  PERSONAL_AGENT_WORK_OUT_LOUD_EVENT,
  PERSONAL_AGENT_WORK_OUT_LOUD_AGENT_ID,
  WORK_OUT_LOUD_SIGNAL_TYPES,
  WORK_OUT_LOUD_SIGNAL_CATEGORIES,
  SAFE_CONTEXT_FIELDS,
  buildWorkOutLoudPayload,
  buildContextFieldWorkOutLoudPayload,
  validateWorkOutLoudPayload,
  getSignalCategoryForContextField,
  getSafeSignalValueForContextField,
};
