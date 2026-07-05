'use strict';

/**
 * ChatGPT Sidecar session policy (energychain/cernion-energy-tools#388, #390).
 *
 * Capability allowlist, write-scope/write-class decisions and redaction
 * rules — kept separate from the session store so the store stays a plain
 * data interface. See docs/architecture/chatgpt-sidecar-session-ticket-gate.md
 * and docs/architecture/chatgpt-sidecar-oeo-trust-boundary.md for the #388
 * contract, and docs/architecture/chatgpt-sidecar-session-api-contract.md
 * for the #390 full-scope expansion this module also implements.
 */

const { forDomainResolved, OEO_VERSION } = require('./oeo-mappings');
const { CURATED_CAPABILITIES } = require('./capability-catalog');
const { mapCapabilityDomain, CANONICAL_DOMAINS } = require('./llm-manifest-taxonomy');

// Fixed core handles from the owner's #388 implementation-contract answer
// (comment 2026-07-05T14:10:06Z). These are session-level/cross-cutting
// toggles the service keys off directly (e.g. 'ontology-guardrail' gates the
// OEO routing branch), not 1:1 aliases for capability-catalog entries, so
// they stay a fixed set independent of catalog growth. Kept exactly as-is
// for #388 backward compatibility.
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

// Approximate canonical-domain placement for the fixed core handles above,
// used only for manifest grouping/display — never for authorization. Most
// are cross-cutting Sidecar session toggles (platform); the datasource-ish
// handles get a best-effort domain so they group sensibly next to their
// catalog-derived siblings.
const CORE_CAPABILITY_DOMAIN = Object.freeze({
  'knowledge-rag': 'platform',
  'blueprint-plan': 'platform',
  'ontology-guardrail': 'platform',
  'draft-datapoints': 'platform',
  'datasource-mastr': 'grid-ops',
  'datasource-vnb-digital': 'grid-ops',
  'datasource-entsoe': 'market-data',
  'datasource-gas-storage': 'regulatory',
  'datasource-grid-osm': 'grid-ops',
  'redispatch-evidence': 'redispatch',
  'edm-mako-evidence': 'inhouse-data',
});

// #390 full-scope catalog: every capability-catalog.js entry that resolves
// to a canonical llm-manifest-taxonomy domain. Built once at module load
// (the catalog is static). An entry whose domain does NOT resolve is
// deliberately excluded — fail closed rather than silently exposing an
// unclassified capability in Full-Capability mode (#390 acceptance
// criteria: "unmapped capabilities are not silently exposed").
//
// Granting one of these ids only changes which capability *label* an ask/
// plan/datapoints call is allowed to carry — it does not add any new
// invocation pathway. Those three routes always call the same fixed,
// already-safe primitives (personal-agent.askCernionAgent, capability-
// broker.recommend, compileReadOnlyExecutionPlan, datapoint.create for
// drafts) regardless of which capability id was requested. Widening this id
// space therefore does not loosen tenant/scope/write authority, only the
// menu of labels a session may ask about.
const FULL_CAPABILITY_CATALOG = Object.freeze(
  CURATED_CAPABILITIES.map((entry) => ({
    id: entry.capability,
    canonicalDomain: mapCapabilityDomain(entry),
    intent: entry.intent || null,
  })).filter((entry) => CANONICAL_DOMAINS.includes(entry.canonicalDomain))
);
const FULL_CAPABILITY_ID_SET = new Set(FULL_CAPABILITY_CATALOG.map((entry) => entry.id));

// Opt-in wildcard: a session creator who wants #390's "session-scoped full
// Cernion capability profile" without enumerating ~170 ids by hand can pass
// capabilityProfile: ['*']. It resolves to the fixed core handles plus every
// full-scope catalog id — nothing more. ChatGPT itself never sees or can
// request this; it is a session-creation-time parameter only.
const FULL_SCOPE_WILDCARD = '*';

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

  if (list.length === 1 && list[0] === FULL_SCOPE_WILDCARD) {
    return [...CAPABILITY_FAMILIES, ...FULL_CAPABILITY_ID_SET];
  }

  const normalized = list
    .map((entry) => String(entry || '').trim())
    .filter((entry) => CAPABILITY_FAMILY_SET.has(entry) || FULL_CAPABILITY_ID_SET.has(entry));
  const deduped = [...new Set(normalized)];
  return deduped.length > 0 ? deduped : [...DEFAULT_CAPABILITY_PROFILE];
}

// Groups a session's granted capability ids by canonical llm-manifest-
// taxonomy domain, for the #390 taxonomy-grouped manifest. Purely a display
// aggregation — the flat capabilityProfile list remains the source callers
// should check against for authorization.
function groupCapabilitiesByDomain(capabilityProfile) {
  const grouped = {};
  for (const id of capabilityProfile) {
    const domain =
      CORE_CAPABILITY_DOMAIN[id] ||
      FULL_CAPABILITY_CATALOG.find((entry) => entry.id === id)?.canonicalDomain ||
      'platform';
    if (!grouped[domain]) grouped[domain] = [];
    grouped[domain].push(id);
  }
  return grouped;
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
    capabilityDomains: groupCapabilitiesByDomain(session.capabilityProfile),
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
  FULL_CAPABILITY_CATALOG,
  FULL_CAPABILITY_ID_SET,
  FULL_SCOPE_WILDCARD,
  normalizeCapabilityProfile,
  groupCapabilitiesByDomain,
  resolveWriteScope,
  evaluateWriteRequest,
  redactSessionForClient,
  resolveOntologyContext,
};
