'use strict';

const GOVERNANCE_MAP_VERSION = 'cernion.workbench.tool-skill-governance.v1';

const DEFAULT_BLOCKED_EFFECTS = ['external_business_effect'];
const DEFAULT_ALLOWED_TOOLS = ['document_fetch', 'api_lookup'];

const GOVERNANCE_BY_DOMAIN = {
  market_communication: {
    allowedTools: ['document_fetch', 'api_lookup', 'mail_search', 'mail_read'],
    blockedTools: ['mail_send'],
    allowedSkills: ['mako-clarification-case', 'willi-mako-evidence-usage'],
    requiredRoles: ['ROLE_MARKET_COMMUNICATION', 'ROLE_EDM', 'ROLE_GRID_OPERATOR'],
    requiredEvidence: [
      'aperak_message',
      'contrl_message',
      'mscons_message_status',
      'utilmd_master_data',
    ],
    toolEvidenceOutputTypes: [
      'mako_process_trace',
      'mako_error_code_diagnosis',
      'market_partner_protocol',
    ],
    toolSideEffectClasses: ['read_only_external', 'internal_cet_state'],
    noCallGuards: ['Keine externe Marktkommunikationsnachricht ohne CET-RBAC/HITL-Freigabe.'],
    handoffDomains: ['edm', 'market_master_data', 'metering_msb'],
  },
  edm: {
    allowedTools: ['document_fetch', 'api_lookup', 'mail_search', 'mail_read'],
    blockedTools: ['mail_send'],
    allowedSkills: ['edm-measurement-issue'],
    requiredRoles: ['ROLE_EDM', 'ROLE_METERING_MSB', 'ROLE_GRID_OPERATOR'],
    requiredEvidence: ['metering_values_export', 'mscons_timeseries_status'],
    toolEvidenceOutputTypes: ['metering_values_export', 'mscons_message_status'],
    toolSideEffectClasses: ['read_only_external', 'internal_cet_state'],
    noCallGuards: ['Keine Abrechnungskorrektur ohne geprüfte Messwert-/Bilanzierungs-Evidenz.'],
    handoffDomains: ['market_communication', 'metering_msb'],
  },
  grid_connection: {
    allowedTools: ['web_fetch', 'web_browse', 'document_fetch', 'api_lookup'],
    blockedTools: [],
    allowedSkills: ['grid-connection-precheck'],
    requiredRoles: ['ROLE_GRID_OPERATOR', 'ROLE_GRID_PLANNING'],
    requiredEvidence: ['grid_connection_document', 'calculation_assumption'],
    toolEvidenceOutputTypes: [
      'grid_connection_public_context',
      'public_web_page',
      'public_pdf_document',
    ],
    toolSideEffectClasses: ['read_only_external', 'internal_cet_state'],
    noCallGuards: ['Keine Netzanschlusszusage oder Genehmigungsaussage ohne Netzbetreiberprüfung.'],
    handoffDomains: ['target_grid_planning', 'asset_grid_planning'],
  },
  target_grid_planning: {
    allowedTools: ['web_fetch', 'web_browse', 'document_fetch', 'api_lookup'],
    blockedTools: [],
    allowedSkills: ['grid-connection-precheck'],
    requiredRoles: ['ROLE_GRID_PLANNING', 'ROLE_GRID_OPERATOR'],
    requiredEvidence: ['grid_connection_document', 'calculation_assumption'],
    toolEvidenceOutputTypes: ['public_web_page', 'grid_connection_public_context'],
    toolSideEffectClasses: ['read_only_external', 'internal_cet_state'],
    noCallGuards: [
      'Zielnetzplanung bleibt Vorprüfung, solange Evidenz/Readiness nicht bestätigt ist.',
    ],
    handoffDomains: ['grid_connection', 'asset_grid_planning'],
  },
  governance: {
    allowedTools: DEFAULT_ALLOWED_TOOLS,
    blockedTools: [],
    allowedSkills: ['dossier-no-call-review'],
    requiredRoles: ['ROLE_UTILITY_HQ', 'ROLE_MANAGEMENT_READ', 'ROLE_GRID_OPERATOR'],
    requiredEvidence: ['generic_document', 'calculation_assumption'],
    toolEvidenceOutputTypes: ['generic_document'],
    toolSideEffectClasses: ['read_only_external', 'internal_cet_state'],
    noCallGuards: ['Dossier ist intern/nicht-bindend, solange readinessState nicht ready ist.'],
    handoffDomains: [],
  },
};

function governanceForDomain(domain = 'governance') {
  return GOVERNANCE_BY_DOMAIN[domain] || GOVERNANCE_BY_DOMAIN.governance;
}

function hasAnyRole(actorRoles = [], requiredRoles = []) {
  if (!requiredRoles.length) return true;
  const roleSet = new Set(actorRoles);
  return requiredRoles.some((role) => roleSet.has(role));
}

function toolAllowedByGovernance(tool, { domain = 'governance', actorRoles = [] } = {}) {
  const governance = governanceForDomain(domain);
  if (!tool) return { allowed: false, blockedReason: 'tool_not_found', governance };
  if (governance.blockedTools.includes(tool.toolId)) {
    return { allowed: false, blockedReason: 'tool_blocked_for_domain', governance };
  }
  if (!governance.allowedTools.includes(tool.toolId)) {
    return { allowed: false, blockedReason: 'tool_not_allowed_for_domain', governance };
  }
  if (!governance.toolSideEffectClasses.includes(tool.sideEffectClass)) {
    return { allowed: false, blockedReason: 'side_effect_class_not_allowed', governance };
  }
  if (DEFAULT_BLOCKED_EFFECTS.includes(tool.sideEffectClass)) {
    return { allowed: false, blockedReason: 'external_effect_blocked', governance };
  }
  if (!hasAnyRole(actorRoles, tool.requiredRoles || governance.requiredRoles || [])) {
    return { allowed: false, blockedReason: 'required_role_missing', governance };
  }
  return { allowed: true, blockedReason: null, governance };
}

function skillAllowedByGovernance(skill, { domain = 'governance', actorRoles = [] } = {}) {
  const governance = governanceForDomain(domain);
  if (!skill) return { allowed: false, blockedReason: 'skill_not_found', governance };
  if ((skill.status || 'draft') !== 'active') {
    return { allowed: false, blockedReason: 'skill_not_active', governance };
  }
  if (!governance.allowedSkills.includes(skill.playbookId || skill.skillId)) {
    return { allowed: false, blockedReason: 'skill_not_allowed_for_domain', governance };
  }
  if (!hasAnyRole(actorRoles, skill.roleFamilies || governance.requiredRoles || [])) {
    return { allowed: false, blockedReason: 'required_role_missing', governance };
  }
  return { allowed: true, blockedReason: null, governance };
}

module.exports = {
  GOVERNANCE_MAP_VERSION,
  GOVERNANCE_BY_DOMAIN,
  governanceForDomain,
  toolAllowedByGovernance,
  skillAllowedByGovernance,
};
