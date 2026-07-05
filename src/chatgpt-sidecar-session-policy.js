'use strict';

/**
 * ChatGPT Sidecar session policy (energychain/cernion-energy-tools#388).
 *
 * Fixed capability-family allowlist, write-scope/write-class decisions and
 * redaction rules — kept separate from the session store so the store stays
 * a plain data interface. See docs/architecture/chatgpt-sidecar-session-ticket-gate.md
 * and docs/architecture/chatgpt-sidecar-oeo-trust-boundary.md for the approved
 * contract this module implements.
 */

const { forDomainResolved, OEO_VERSION } = require('./oeo-mappings');

// Fixed allowlist from the owner's implementation-contract answer (#388,
// comment 2026-07-05T14:10:06Z). Not user-extensible — capabilityProfile
// values outside this set are dropped silently at session creation.
const CAPABILITY_FAMILIES = Object.freeze([
  'knowledge-rag',
  'blueprint-plan',
  'datasource-mastr',
  'datasource-vnb-digital',
  'datasource-entsoe',
  'datasource-gas-storage',
  'datasource-grid-osm',
  'redispatch-evidence',
  'edm-mako-evidence',
  'ontology-guardrail',
  'draft-datapoints',
]);
const CAPABILITY_FAMILY_SET = new Set(CAPABILITY_FAMILIES);
const DEFAULT_CAPABILITY_PROFILE = Object.freeze(['knowledge-rag']);

// Write classes named in the issue body. Only draft_write mutates in this
// slice; the other three are policy-decision-only (First Implementation Card).
const WRITE_SCOPES = Object.freeze([
  'draft_write',
  'controlled_write',
  'process_execute',
  'requires_confirmation',
]);
const DEFAULT_WRITE_SCOPE = 'draft_write';

// Best-effort capability-family -> OEO domain mapping, grounded in the
// existing DOMAIN_OEO_MAPPINGS entries (src/oeo-mappings.js). Families with
// no direct domain mapping are deliberately absent — the ontology guardrail
// must surface "unsupported" rather than invent a mapping.
const CAPABILITY_TO_OEO_DOMAIN = Object.freeze({
  'datasource-mastr': 'mastr-local',
  'datasource-grid-osm': 'grid-assets',
  'datasource-vnb-digital': 'grid-incidents',
  'redispatch-evidence': 'redispatch-queue',
  'edm-mako-evidence': 'metering',
});

function normalizeCapabilityProfile(requested) {
  const list = Array.isArray(requested) ? requested : [];
  const normalized = list
    .map((entry) => String(entry || '').trim())
    .filter((entry) => CAPABILITY_FAMILY_SET.has(entry));
  const deduped = [...new Set(normalized)];
  return deduped.length > 0 ? deduped : [...DEFAULT_CAPABILITY_PROFILE];
}

function resolveWriteScope(requested) {
  const value = String(requested || '').trim();
  return WRITE_SCOPES.includes(value) ? value : DEFAULT_WRITE_SCOPE;
}

// Evaluates a write attempt against the session's provisioned write scope.
// Only a `draft_write` request on a `draft_write`-provisioned session mutates.
// Everything else is a policy decision the caller can inspect, never a mutation.
function evaluateWriteRequest({ requestedWriteClass, session, capability }) {
  const requested = WRITE_SCOPES.includes(requestedWriteClass)
    ? requestedWriteClass
    : DEFAULT_WRITE_SCOPE;

  if (capability && !session.capabilityProfile.includes(capability)) {
    return {
      decision: 'blocked',
      mutate: false,
      writeClass: requested,
      reason: 'capability_not_granted',
    };
  }

  if (requested === 'draft_write' && session.writeScope === 'draft_write') {
    return { decision: 'allowed', mutate: true, writeClass: requested, reason: null };
  }

  if (requested === 'draft_write') {
    return {
      decision: 'blocked',
      mutate: false,
      writeClass: requested,
      reason: 'write_scope_not_provisioned',
    };
  }

  return {
    decision: 'requires_confirmation',
    mutate: false,
    writeClass: requested,
    reason: 'write_class_not_implemented_in_first_slice',
  };
}

// Redacted, ChatGPT-facing view of a session. Never includes tenantId,
// userId, sessionId, provider credentials or internal route topology.
function redactSessionForClient(session) {
  return {
    capabilityProfile: [...session.capabilityProfile],
    writeScope: session.writeScope,
    expiresAt: session.expiresAt,
    ontologyEnabled: session.capabilityProfile.includes('ontology-guardrail'),
  };
}

// Resolves ontology/OEO context for a capability family, or an explicit
// unsupported marker (OEO trust-boundary doc: "Uncertainty Behavior") when
// ontology guardrail is enabled but no evidence-backed mapping exists.
function resolveOntologyContext({ ontologyEnabled, capability }) {
  if (!ontologyEnabled) return null;

  const domainId = CAPABILITY_TO_OEO_DOMAIN[capability];
  if (!domainId) {
    return {
      ontologyCapability: 'ontology-guardrail',
      mappingVersion: OEO_VERSION,
      supported: false,
      classification: 'unsupported_ontology_claim',
      concepts: [],
    };
  }

  const concepts = forDomainResolved(domainId);
  return {
    ontologyCapability: 'ontology-guardrail',
    mappingVersion: OEO_VERSION,
    supported: concepts.length > 0,
    classification: concepts.length > 0 ? 'ontology_aligned' : 'unsupported_ontology_claim',
    concepts,
  };
}

module.exports = {
  CAPABILITY_FAMILIES,
  DEFAULT_CAPABILITY_PROFILE,
  WRITE_SCOPES,
  DEFAULT_WRITE_SCOPE,
  CAPABILITY_TO_OEO_DOMAIN,
  normalizeCapabilityProfile,
  resolveWriteScope,
  evaluateWriteRequest,
  redactSessionForClient,
  resolveOntologyContext,
};
