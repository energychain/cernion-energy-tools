'use strict';

const ROLE_KAUFMAENNISCHE_LEITUNG = 'ROLE_KAUFMAENNISCHE_LEITUNG';
const ROLE_NETZPLANUNG = 'ROLE_NETZPLANUNG';

const PLACEHOLDER_REASON = Object.freeze([
  'NEEDS_OWNER',
  'NEEDS_INTERFACE',
  'NEEDS_EVIDENCE',
  'NEEDS_DECISION',
  'PLANNED_AGENT',
]);

const BLOCKING_LEVEL = Object.freeze(['soft', 'hard']);
const PLACEHOLDER_STATUS = Object.freeze(['placeholder_gap', 'resolved']);

const SIGNAL_CODES = Object.freeze([
  'NEEDS_OWNER',
  'NEEDS_INTERFACE',
  'NEEDS_EVIDENCE',
  'NEEDS_DECISION',
  'PLANNED_AGENT',
  'REQUEST_OWNER_ASSIGNMENT',
  'REQUEST_INTERFACE_CONTRACT',
  'REQUEST_SUPPORTING_EVIDENCE',
  'REQUEST_DECISION_RECORD',
  'REQUEST_AGENT_REPLACEMENT',
]);

const DEFAULT_RESOLVER_ROLES = Object.freeze([ROLE_KAUFMAENNISCHE_LEITUNG, ROLE_NETZPLANUNG]);

const DEFAULT_SIGNAL_CODES_BY_REASON = Object.freeze({
  NEEDS_OWNER: ['NEEDS_OWNER', 'REQUEST_OWNER_ASSIGNMENT'],
  NEEDS_INTERFACE: ['NEEDS_INTERFACE', 'REQUEST_INTERFACE_CONTRACT'],
  NEEDS_EVIDENCE: ['NEEDS_EVIDENCE', 'REQUEST_SUPPORTING_EVIDENCE'],
  NEEDS_DECISION: ['NEEDS_DECISION', 'REQUEST_DECISION_RECORD'],
  PLANNED_AGENT: ['PLANNED_AGENT', 'REQUEST_AGENT_REPLACEMENT'],
});

function normalizeReason(reason) {
  const value = String(reason || '')
    .trim()
    .toUpperCase();
  if (!PLACEHOLDER_REASON.includes(value)) {
    throw new Error(`Invalid placeholder reason: ${reason}`);
  }
  return value;
}

function normalizeBlockingLevel(level) {
  const value = String(level || 'soft')
    .trim()
    .toLowerCase();
  if (!BLOCKING_LEVEL.includes(value)) {
    throw new Error(`Invalid blocking level: ${level}`);
  }
  return value;
}

function normalizeSignalCodes(reason, signalCodes = []) {
  const normalizedReason = normalizeReason(reason);
  const baseSignals = DEFAULT_SIGNAL_CODES_BY_REASON[normalizedReason] || [normalizedReason];
  const mergedSignals = [...baseSignals, ...(Array.isArray(signalCodes) ? signalCodes : [])]
    .map((signalCode) =>
      String(signalCode || '')
        .trim()
        .toUpperCase()
    )
    .filter(Boolean)
    .filter((signalCode, index, array) => array.indexOf(signalCode) === index)
    .filter((signalCode) => SIGNAL_CODES.includes(signalCode));

  if (mergedSignals.length === 0) {
    return [...baseSignals];
  }
  return mergedSignals;
}

function normalizeReplacementCriteria(criteria = {}) {
  const input = criteria && typeof criteria === 'object' ? criteria : {};
  return {
    kind: input.kind || 'process',
    capabilityHint: input.capabilityHint || null,
    deadline: input.deadline || null,
  };
}

function getRequiredResolverRoles(blockingLevel, explicitRoles) {
  const normalizedBlockingLevel = normalizeBlockingLevel(blockingLevel);
  if (Array.isArray(explicitRoles) && explicitRoles.length > 0) {
    return explicitRoles.map((role) => String(role || '').trim()).filter(Boolean);
  }
  if (normalizedBlockingLevel === 'hard') {
    return [...DEFAULT_RESOLVER_ROLES];
  }
  return [];
}

module.exports = {
  ROLE_KAUFMAENNISCHE_LEITUNG,
  ROLE_NETZPLANUNG,
  PLACEHOLDER_REASON,
  BLOCKING_LEVEL,
  PLACEHOLDER_STATUS,
  SIGNAL_CODES,
  DEFAULT_SIGNAL_CODES_BY_REASON,
  DEFAULT_RESOLVER_ROLES,
  normalizeReason,
  normalizeBlockingLevel,
  normalizeSignalCodes,
  normalizeReplacementCriteria,
  getRequiredResolverRoles,
};
