'use strict';

const SIDECAR_SCHEMA_VERSION = 'cernion.agent-sidecar.v1';
const ALLOWED_SAFETY_CLASSES = new Set(['read_only_evidence', 'advisory_reasoning']);
const ALLOWED_EFFECT_CLASSES = new Set([
  'none',
  'advisory_reasoning',
  'internal_case_state',
  'internal_event_outbox',
  'internal_case_link',
  'internal_master_data',
  'external_business_effect',
]);

const SIDE_EFFECT_NONE = 'none';
const GOVERNANCE_BOUNDARY_CET = 'cet_governed_internal_state_external_effects_require_rbac_hitl';
const GOVERNANCE_BOUNDARY_READ_ONLY = 'read_only_evidence_or_advisory_no_state_change';

function withGovernance(tool) {
  return {
    safetyClass: 'advisory_reasoning',
    requiredScope: 'read-only',
    tenantPolicy: 'context_tenant_must_match_auth_tenant',
    rolePolicy: ['ROLE_UTILITY_HQ', 'ROLE_GRID_OPERATOR'],
    hitlPolicy: 'may_surface_required_human_approval_but_must_not_resolve',
    responseContract: 'compact_evidence_answer_or_blueprint_execution_plan',
    sideEffects: SIDE_EFFECT_NONE,
    effectClass: 'none',
    requiresCetAuthorization: true,
    externalSideEffects: false,
    governanceBoundary: GOVERNANCE_BOUNDARY_READ_ONLY,
    localStateEffects: 'none',
    ...tool,
  };
}

const MVP_TOOLS = [
  withGovernance({
    name: 'cernion.ask',
    title: 'Ask Cernion',
    targetAction: 'personal-agent.askCernionAgent',
    effectClass: 'advisory_reasoning',
    description:
      'Returns either a Blueprint-compiled evidence execution plan or compact Cernion evidence, process context and guardrails. External business effects remain gated by CET RBAC/HITL. See energychain/cernion-energy-tools#271.',
  }),
  withGovernance({
    name: 'cernion.answer_dossier',
    title: 'Answer Dossier',
    targetAction: 'personal-agent.answerDossier',
    responseContract: 'answer_dossier_slim_or_rich',
    effectClass: 'internal_case_state',
    governanceBoundary: GOVERNANCE_BOUNDARY_CET,
    localStateEffects: 'answer_dossier_session_state',
    description:
      'Creates a structured answer dossier with evidence, guardrails and missing-data follow-ups. May update internal CET dossier/session state; no external business effect.',
  }),
  withGovernance({
    name: 'cernion.recommend_capability',
    title: 'Recommend Capability',
    targetAction: 'capability-broker.recommend',
    hitlPolicy: 'must_not_create_or_resolve_human_approval',
    responseContract: 'capability_recommendation',
    effectClass: 'advisory_reasoning',
    description:
      'Asks the Capability Broker for a recommendation and does not execute the recommended plan.',
  }),
  withGovernance({
    name: 'cernion.list_readonly_capabilities',
    title: 'List CET-governed Capabilities',
    targetAction: 'agent-sidecar.listTools',
    safetyClass: 'read_only_evidence',
    hitlPolicy: 'not_applicable',
    responseContract: 'sidecar_tool_manifest',
    description:
      'Lists the curated CET-governed Sidecar tools and their server-side policies. Tool name is kept for compatibility.',
  }),
  withGovernance({
    name: 'cernion.get_evidence_status',
    title: 'Get Evidence Status',
    targetAction: 'dossier-hydration.readOnlyStatus',
    safetyClass: 'read_only_evidence',
    hitlPolicy: 'must_not_create_or_resolve_human_approval',
    responseContract: 'hydration_registry_status_evidence',
    description: 'Calls only dossier-hydration-allowlisted read-only status/evidence actions.',
  }),
];

const DOMAIN_ROUTER_EFFECTS = {
  classify_task: {
    target: 'classify',
    effectClass: 'internal_case_state',
    localStateEffects: 'case_state_and_event_generation_metadata',
  },
  continue_case: {
    target: 'continue',
    effectClass: 'internal_case_state',
    localStateEffects: 'case_state_transitions_and_event_generation_metadata',
  },
  list_case_events: {
    target: 'events.list',
    effectClass: 'internal_event_outbox',
    localStateEffects: 'case_event_delivery_state',
  },
  ack_case_event: {
    target: 'events.ack',
    effectClass: 'internal_event_outbox',
    localStateEffects: 'case_event_acknowledgement_state',
  },
  discover_related_sessions: {
    target: 'related-sessions.discover',
    effectClass: 'advisory_reasoning',
    localStateEffects: 'none',
  },
};

// Domain Router tools may update local CET PouchDB case/event metadata; no external effect executes.
for (const [name, config] of Object.entries(DOMAIN_ROUTER_EFFECTS)) {
  MVP_TOOLS.push(
    withGovernance({
      name: `cernion.${name}`,
      title: name.replace(/_/g, ' '),
      targetAction: `domain-router.${config.target}`,
      safetyClass: 'advisory_reasoning',
      requiredScope: 'read-only',
      tenantPolicy: 'context_tenant_must_match_auth_tenant',
      rolePolicy: ['authenticated_energy_role'],
      hitlPolicy: 'must_not_create_or_resolve_human_approval',
      responseContract: 'domain_router_v1.1',
      sideEffects: SIDE_EFFECT_NONE,
      effectClass: config.effectClass,
      localStateEffects: config.localStateEffects,
      governanceBoundary: GOVERNANCE_BOUNDARY_CET,
      description:
        'CET-governed Domain Router operation. May update internal CET case/event state according to CET authorization; no external business effect.',
    })
  );
}

function cloneTool(tool) {
  return {
    ...tool,
    rolePolicy: [...(tool.rolePolicy || [])],
  };
}

function listSidecarTools() {
  return MVP_TOOLS.map(cloneTool);
}

function getSidecarTool(name) {
  const tool = MVP_TOOLS.find((entry) => entry.name === name);
  return tool ? cloneTool(tool) : null;
}

function validateToolDefinition(tool) {
  const errors = [];
  if (!tool?.name) errors.push('name is required');
  if (!tool?.targetAction) errors.push('targetAction is required');
  if (!ALLOWED_SAFETY_CLASSES.has(tool?.safetyClass)) {
    errors.push(`safetyClass must be one of ${Array.from(ALLOWED_SAFETY_CLASSES).join(', ')}`);
  }
  if (tool?.requiredScope !== 'read-only') {
    errors.push('requiredScope must remain read-only for legacy Sidecar compatibility');
  }
  if (tool?.sideEffects !== SIDE_EFFECT_NONE) {
    errors.push('legacy sideEffects must remain none; use effectClass for internal CET state');
  }
  if (!ALLOWED_EFFECT_CLASSES.has(tool?.effectClass)) {
    errors.push(`effectClass must be one of ${Array.from(ALLOWED_EFFECT_CLASSES).join(', ')}`);
  }
  if (tool?.requiresCetAuthorization !== true) {
    errors.push('requiresCetAuthorization must be true');
  }
  if (tool?.externalSideEffects !== false) {
    errors.push('externalSideEffects must be false for current Sidecar tools');
  }
  if (tool?.effectClass === 'external_business_effect') {
    errors.push('external_business_effect tools require a future explicit CET RBAC/HITL contract');
  }
  if (String(tool?.targetAction || '').match(/\b(write|delete|approve|reject|resolve|token)\b/i)) {
    errors.push('targetAction contains a forbidden write/admin/HITL-token verb');
  }
  return {
    valid: errors.length === 0,
    errors,
  };
}

function buildSidecarManifest() {
  const tools = listSidecarTools();
  return {
    schemaVersion: SIDECAR_SCHEMA_VERSION,
    host: 'openclaw',
    toolCount: tools.length,
    maxToolCount: MVP_TOOLS.length,
    policyOwner: 'cernion',
    governanceModel: 'cet_governed_internal_state_external_effects_gated',
    tools,
  };
}

module.exports = {
  SIDECAR_SCHEMA_VERSION,
  ALLOWED_EFFECT_CLASSES,
  ALLOWED_SAFETY_CLASSES,
  GOVERNANCE_BOUNDARY_CET,
  GOVERNANCE_BOUNDARY_READ_ONLY,
  SIDE_EFFECT_NONE,
  buildSidecarManifest,
  getSidecarTool,
  listSidecarTools,
  validateToolDefinition,
};
