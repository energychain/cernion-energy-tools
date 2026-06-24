'use strict';

const SIDECAR_SCHEMA_VERSION = 'cernion.agent-sidecar.v1';
const ALLOWED_SAFETY_CLASSES = new Set(['read_only_evidence', 'advisory_reasoning']);

const SIDE_EFFECT_NONE = 'none';

const MVP_TOOLS = [
  {
    name: 'cernion.ask',
    title: 'Ask Cernion',
    targetAction: 'personal-agent.askCernionAgent',
    safetyClass: 'advisory_reasoning',
    requiredScope: 'read-only',
    tenantPolicy: 'context_tenant_must_match_auth_tenant',
    rolePolicy: ['ROLE_UTILITY_HQ', 'ROLE_GRID_OPERATOR'],
    hitlPolicy: 'may_surface_required_human_approval_but_must_not_resolve',
    responseContract: 'compact_evidence_answer_or_read_only_rest_plan',
    sideEffects: SIDE_EFFECT_NONE,
    description:
      'Returns compact Cernion evidence, process context and guardrails without modifying process data.',
  },
  {
    name: 'cernion.answer_dossier',
    title: 'Answer Dossier',
    targetAction: 'personal-agent.answerDossier',
    safetyClass: 'advisory_reasoning',
    requiredScope: 'read-only',
    tenantPolicy: 'context_tenant_must_match_auth_tenant',
    rolePolicy: ['ROLE_UTILITY_HQ', 'ROLE_GRID_OPERATOR'],
    hitlPolicy: 'may_surface_required_human_approval_but_must_not_resolve',
    responseContract: 'answer_dossier_slim_or_rich',
    sideEffects: SIDE_EFFECT_NONE,
    description:
      'Creates a structured answer dossier with evidence, guardrails and missing-data follow-ups.',
  },
  {
    name: 'cernion.recommend_capability',
    title: 'Recommend Capability',
    targetAction: 'capability-broker.recommend',
    safetyClass: 'advisory_reasoning',
    requiredScope: 'read-only',
    tenantPolicy: 'context_tenant_must_match_auth_tenant',
    rolePolicy: ['ROLE_UTILITY_HQ', 'ROLE_GRID_OPERATOR'],
    hitlPolicy: 'must_not_create_or_resolve_human_approval',
    responseContract: 'capability_recommendation',
    sideEffects: SIDE_EFFECT_NONE,
    description:
      'Asks the Capability Broker for a recommendation and does not execute the recommended plan.',
  },
  {
    name: 'cernion.list_readonly_capabilities',
    title: 'List Read-Only Capabilities',
    targetAction: 'agent-sidecar.listTools',
    safetyClass: 'read_only_evidence',
    requiredScope: 'read-only',
    tenantPolicy: 'context_tenant_must_match_auth_tenant',
    rolePolicy: ['ROLE_UTILITY_HQ', 'ROLE_GRID_OPERATOR'],
    hitlPolicy: 'not_applicable',
    responseContract: 'sidecar_tool_manifest',
    sideEffects: SIDE_EFFECT_NONE,
    description: 'Lists the curated OpenClaw-safe MVP tools and their server-side policies.',
  },
  {
    name: 'cernion.get_evidence_status',
    title: 'Get Evidence Status',
    targetAction: 'dossier-hydration.readOnlyStatus',
    safetyClass: 'read_only_evidence',
    requiredScope: 'read-only',
    tenantPolicy: 'context_tenant_must_match_auth_tenant',
    rolePolicy: ['ROLE_UTILITY_HQ', 'ROLE_GRID_OPERATOR'],
    hitlPolicy: 'must_not_create_or_resolve_human_approval',
    responseContract: 'hydration_registry_status_evidence',
    sideEffects: SIDE_EFFECT_NONE,
    description:
      'Calls only dossier-hydration-allowlisted read-only status/evidence actions.',
  },
];

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
    errors.push('requiredScope must be read-only for the OpenClaw MVP');
  }
  if (tool?.sideEffects !== SIDE_EFFECT_NONE) {
    errors.push('sideEffects must be none for the OpenClaw MVP');
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
    maxToolCount: 5,
    policyOwner: 'cernion',
    tools,
  };
}

module.exports = {
  SIDECAR_SCHEMA_VERSION,
  ALLOWED_SAFETY_CLASSES,
  SIDE_EFFECT_NONE,
  buildSidecarManifest,
  getSidecarTool,
  listSidecarTools,
  validateToolDefinition,
};
