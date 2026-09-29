'use strict';

const SENSITIVE_KEYS = /authorization|bearer|token|secret|password|api[_-]?key|cookie|credential/i;
const MAX_TEXT = 1000;
const MAX_ITEMS = 8;

function safeText(value, max = MAX_TEXT) {
  if (value == null) return undefined;
  const text = String(value).replace(/\s+/g, ' ').trim();
  if (!text || SENSITIVE_KEYS.test(text) || /^bearer\s+/i.test(text)) return undefined;
  return text.length > max ? `${text.slice(0, max - 1)}…` : text;
}

function asArray(value) {
  return Array.isArray(value) ? value : [];
}

function safeList(value, max = MAX_ITEMS) {
  return asArray(value)
    .map((item) => {
      if (typeof item === 'string') return safeText(item, 300);
      if (item && typeof item === 'object') {
        return safeText(item.label || item.type || item.domain || item.capability || item.ref, 300);
      }
      return undefined;
    })
    .filter(Boolean)
    .slice(0, max);
}

function safeRoleHistory(value) {
  return asArray(value)
    .filter((item) => item && typeof item === 'object')
    .map((item) => ({
      from: safeText(item.from, 120),
      to: safeText(item.to, 120),
      at: safeText(item.at, 80),
    }))
    .filter((item) => item.from && item.to)
    .slice(-MAX_ITEMS);
}

function safeAssumptions(knownContext = {}) {
  const candidates = knownContext.workingAssumptions || knownContext.assumptions || [];
  if (Array.isArray(candidates)) return safeList(candidates, MAX_ITEMS);
  if (candidates && typeof candidates === 'object') {
    return Object.entries(candidates)
      .map(([key, value]) => `${key}: ${safeText(value, 180) || 'set'}`)
      .filter((item) => !SENSITIVE_KEYS.test(item))
      .slice(0, MAX_ITEMS);
  }
  return [];
}

function selectActiveRole({ mapping, principal }) {
  const roles = mapping?.roles?.length ? mapping.roles : principal?.roles || [];
  const priority = [
    'ROLE_MARKET_COMMUNICATION',
    'ROLE_EDM',
    'ROLE_METERING_MSB',
    'ROLE_MARKET_MASTER_DATA',
    'ROLE_GRID_PLANNING',
    'ROLE_GRID_OPERATOR',
    'ROLE_MANAGEMENT_READ',
    'ROLE_EXTERNAL_ADVISOR_LIMITED',
  ];
  return priority.find((role) => roles.includes(role)) || roles[0] || 'ROLE_UNKNOWN';
}

function buildTurnMemory({
  previousMemory = null,
  classification = {},
  envelope = {},
  mapping = null,
  principal,
}) {
  const now = new Date().toISOString();
  const activeRole = selectActiveRole({ mapping, principal });
  const roleHistory = [
    ...safeRoleHistory(previousMemory?.roleHistory),
    ...(previousMemory?.activeRole && previousMemory.activeRole !== activeRole
      ? [{ from: previousMemory.activeRole, to: activeRole, at: now }]
      : []),
  ].slice(-MAX_ITEMS);
  const primaryDomain = classification.primaryDomain || previousMemory?.primaryDomain || 'unknown';
  const alternativeDomains = asArray(
    classification.alternativeDomains?.length
      ? classification.alternativeDomains
      : previousMemory?.alternativeDomains || []
  ).slice(0, MAX_ITEMS);
  const readinessState =
    classification.readinessState || previousMemory?.readinessState || 'unknown';
  const requiredClarifications = safeList(
    classification.requiredClarifications || previousMemory?.openQuestions || []
  );
  const missingEvidence = safeList(
    classification.missingEvidence ||
      classification.evidenceRequirements ||
      previousMemory?.missingEvidence ||
      []
  );
  const lastSafeConclusion = safeText(
    classification.responseText ||
      classification.responseGuidance ||
      previousMemory?.lastSafeConclusion ||
      '',
    700
  );
  const lastUserIntent = safeText(
    envelope.userRequest || previousMemory?.lastUserIntent || '',
    500
  );
  return {
    schemaVersion: '1.0',
    primaryDomain,
    alternativeDomains,
    readinessState,
    activeRole,
    applicableRoles: [
      ...new Set(mapping?.roles?.length ? mapping.roles : principal?.roles || []),
    ].slice(0, 12),
    roleHistory,
    openQuestions: requiredClarifications,
    requiredClarifications,
    missingEvidence,
    workingAssumptions: [
      ...new Set([
        ...(previousMemory?.workingAssumptions || []),
        ...safeAssumptions(envelope.knownContext),
      ]),
    ].slice(-MAX_ITEMS),
    noCallGuards: safeList(classification.noCallGuards || previousMemory?.noCallGuards || []),
    allowedActions: safeList(classification.allowedActions || previousMemory?.allowedActions || []),
    blockedActions: safeList(classification.blockedActions || previousMemory?.blockedActions || []),
    lastUserIntent,
    lastSafeConclusion,
    recentEventStatus: previousMemory?.recentEventStatus || null,
    memoryUpdatedAt: now,
    rawChatHistoryStored: false,
  };
}

function safeTurnMemory(memory) {
  if (!memory) return null;
  return {
    schemaVersion: memory.schemaVersion || '1.0',
    primaryDomain: memory.primaryDomain || 'unknown',
    alternativeDomains: asArray(memory.alternativeDomains).slice(0, MAX_ITEMS),
    readinessState: memory.readinessState || 'unknown',
    activeRole: memory.activeRole || 'ROLE_UNKNOWN',
    applicableRoles: safeList(memory.applicableRoles || []),
    roleHistory: safeRoleHistory(memory.roleHistory),
    openQuestions: safeList(memory.openQuestions || memory.requiredClarifications || []),
    requiredClarifications: safeList(memory.requiredClarifications || memory.openQuestions || []),
    missingEvidence: safeList(memory.missingEvidence || []),
    workingAssumptions: safeList(memory.workingAssumptions || []),
    noCallGuards: safeList(memory.noCallGuards || []),
    allowedActions: safeList(memory.allowedActions || []),
    blockedActions: safeList(memory.blockedActions || []),
    lastUserIntent: safeText(memory.lastUserIntent, 500),
    lastSafeConclusion: safeText(memory.lastSafeConclusion, 700),
    recentEventStatus: memory.recentEventStatus || null,
    memoryUpdatedAt: memory.memoryUpdatedAt,
    rawChatHistoryStored: false,
  };
}

function turnMemorySummary(memory) {
  const safe = safeTurnMemory(memory);
  if (!safe) return null;
  return {
    primaryDomain: safe.primaryDomain,
    readinessState: safe.readinessState,
    activeRole: safe.activeRole,
    openQuestions: safe.openQuestions,
    missingEvidence: safe.missingEvidence,
    workingAssumptions: safe.workingAssumptions,
    lastSafeConclusion: safe.lastSafeConclusion,
    memoryUpdatedAt: safe.memoryUpdatedAt,
    rawChatHistoryStored: false,
  };
}

module.exports = { buildTurnMemory, safeTurnMemory, turnMemorySummary };
