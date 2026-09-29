'use strict';

const DEFAULT_PLAYBOOKS = [
  {
    playbookId: 'mako-clarification-case',
    title: 'MaKo clarification case',
    domain: 'market_communication',
    scope: 'domain',
    roleFamilies: ['ROLE_MARKET_COMMUNICATION', 'ROLE_GRID_OPERATOR'],
    routingSignals: ['market_communication', 'aperak', 'mscons', 'contrl'],
    requiredEvidence: [
      'aperak_message',
      'contrl_message',
      'mscons_message_status',
      'utilmd_master_data',
    ],
    allowedActions: ['inspect_evidence', 'clarify', 'prepare_handoff'],
    blockedActions: ['external_message_send', 'approval_grant'],
    noCallGuards: ['Keine externe Marktkommunikationsnachricht ohne CET-RBAC/HITL-Freigabe.'],
    handoffRules: ['Bei MaLo/MeLo/Lieferbeginn-Hinweisen market_master_data prüfen.'],
    eventRules: ['evidence.required', 'clarification.required'],
  },
  {
    playbookId: 'edm-measurement-issue',
    title: 'EDM measurement-data issue',
    domain: 'edm',
    scope: 'domain',
    roleFamilies: ['ROLE_EDM', 'ROLE_GRID_OPERATOR'],
    routingSignals: ['edm', 'mscons', 'zeitreihe', 'lastgang'],
    requiredEvidence: ['mscons_timeseries_status', 'metering_values_export'],
    allowedActions: ['inspect_evidence', 'clarify', 'prepare_handoff'],
    blockedActions: ['external_message_send', 'billing_write'],
    noCallGuards: ['Keine Abrechnungskorrektur ohne geprüfte Messwert-/Bilanzierungs-Evidenz.'],
    handoffRules: ['Bei Versand-/APERAK-Hinweisen market_communication hinzuziehen.'],
    eventRules: ['evidence.required'],
  },
  {
    playbookId: 'grid-connection-precheck',
    title: 'Grid connection preliminary review',
    domain: 'grid_connection',
    scope: 'domain',
    roleFamilies: ['ROLE_GRID_OPERATOR', 'ROLE_GRID_PLANNING'],
    routingSignals: ['grid_connection', 'anschlussleistung', 'spannungsebene'],
    requiredEvidence: ['grid_connection_document', 'calculation_assumption'],
    allowedActions: ['inspect_evidence', 'clarify', 'prepare_handoff'],
    blockedActions: ['connection_approval', 'binding_capacity_commitment'],
    noCallGuards: ['Keine Netzanschlusszusage oder Genehmigungsaussage ohne Netzbetreiberprüfung.'],
    handoffRules: ['Bei MW-Leistung Mittelspannung/Hochspannung parallel prüfen.'],
    eventRules: ['evidence.required', 'handoff.required'],
  },
  {
    playbookId: 'dossier-no-call-review',
    title: 'Dossier and no-call review',
    domain: 'governance',
    scope: 'tenant',
    roleFamilies: ['ROLE_MANAGEMENT_READ', 'ROLE_UTILITY_HQ', 'ROLE_GRID_OPERATOR'],
    routingSignals: ['dossier', 'lage', 'governance', 'management'],
    requiredEvidence: ['generic_document', 'calculation_assumption'],
    allowedActions: ['inspect_evidence', 'prepare_dossier', 'clarify'],
    blockedActions: ['approval_grant', 'external_message_send', 'regulatory_binding_statement'],
    noCallGuards: ['Dossier ist intern/nicht-bindend, solange readinessState nicht ready ist.'],
    handoffRules: ['Bei fehlender Evidenz evidence.required erzeugen.'],
    eventRules: ['readiness.review_required'],
  },
  {
    playbookId: 'willi-mako-evidence-usage',
    title: 'Willi-MaKo supporting evidence usage',
    domain: 'market_communication',
    scope: 'domain',
    roleFamilies: ['ROLE_MARKET_COMMUNICATION', 'ROLE_GRID_OPERATOR'],
    routingSignals: ['willi_mako_ref', 'market_communication', 'mako_error_code_diagnosis'],
    requiredEvidence: ['mako_error_code_diagnosis', 'mako_process_trace'],
    allowedActions: ['inspect_evidence', 'clarify', 'prepare_handoff'],
    blockedActions: ['external_message_send', 'case_auto_resolution'],
    noCallGuards: ['Willi-MaKo ist Diagnose-/Evidence-Quelle; CET bleibt Case-/Audit-Owner.'],
    handoffRules: ['APERAK Z18 gegen AHB, Segmentreferenz und Stammdatenhistorie prüfen.'],
    eventRules: ['evidence.available', 'readiness.review_required'],
  },
];

function safePlaybook(playbook) {
  if (!playbook) return null;
  return {
    playbookId: playbook.playbookId,
    title: playbook.title,
    domain: playbook.domain,
    scope: playbook.scope,
    version: playbook.version || 1,
    status: playbook.status || 'active',
    roleFamilies: playbook.roleFamilies || [],
    routingSignals: playbook.routingSignals || [],
    requiredEvidence: playbook.requiredEvidence || [],
    allowedActions: playbook.allowedActions || [],
    blockedActions: playbook.blockedActions || [],
    noCallGuards: playbook.noCallGuards || [],
    handoffRules: playbook.handoffRules || [],
    eventRules: playbook.eventRules || [],
  };
}

function defaultPlaybooksForTenant(tenantId) {
  return DEFAULT_PLAYBOOKS.map((playbook) =>
    safePlaybook({ ...playbook, tenantId, source: 'default', version: 1, status: 'active' })
  );
}

function matchPlaybooks(playbooks, { domain, roles = [], workspaceId = null } = {}) {
  const roleSet = new Set(roles);
  return playbooks
    .filter((playbook) => (playbook.status || 'active') === 'active')
    .filter((playbook) => !domain || playbook.domain === domain || playbook.domain === 'governance')
    .filter((playbook) => !playbook.workspaceId || playbook.workspaceId === workspaceId)
    .filter(
      (playbook) =>
        !playbook.roleFamilies?.length || playbook.roleFamilies.some((role) => roleSet.has(role))
    )
    .map(safePlaybook)
    .slice(0, 5);
}

module.exports = { DEFAULT_PLAYBOOKS, defaultPlaybooksForTenant, matchPlaybooks, safePlaybook };
