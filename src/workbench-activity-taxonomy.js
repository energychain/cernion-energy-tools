'use strict';

const ACTIVITY_TAXONOMY_VERSION = 'cernion.workbench.activity-taxonomy.v1';

const ACTIVITIES = [
  {
    activityId: 'market_communication_clarification',
    title: 'Market Communication / MaKo clarification',
    domain: 'market_communication',
    examplePrompts: [
      'APERAK Z18 nach MSCONS-Versand prüfen',
      'Lieferant reklamiert fehlende MSCONS-Zeitreihe',
      'CONTRL/APERAK Ablehnung im MaKo-Prozess einordnen',
    ],
    keywords: ['mako', 'marktkommunikation', 'aperak', 'contrl', 'mscons', 'utilmd', 'z18'],
    typicalRoles: ['ROLE_MARKET_COMMUNICATION', 'ROLE_EDM', 'ROLE_MARKET_MASTER_DATA'],
    requiredEvidence: [
      'aperak_message',
      'contrl_message',
      'mscons_message_status',
      'utilmd_master_data',
    ],
    allowedActions: [
      'inspect_evidence',
      'clarify',
      'prepare_handoff',
      'prepare_internal_correction',
    ],
    blockedActions: ['external_message_send', 'approval_grant', 'binding_regulatory_claim'],
    handoffDomains: ['edm', 'market_master_data', 'metering_msb'],
    capabilityMappings: ['market_communication_evidence_chain'],
    receiptMappings: ['mako_evidence_required'],
    openApiOperationCandidates: ['dashboard-api.marketCommunicationEvidenceChain'],
    caseStarterEligible: true,
    dossierTemplateHint: 'mako_clarification',
  },
  {
    activityId: 'edm_metering_data_quality',
    title: 'EDM / metering data quality',
    domain: 'edm',
    examplePrompts: [
      'Lastgang plausibilisieren',
      'MSCONS-Zeitreihe fehlt trotz vorhandener Messwerte',
      'Messwerte im EDM vollständig und plausibilisiert prüfen',
    ],
    keywords: ['edm', 'lastgang', 'zeitreihe', 'plausibilisiert', 'messwerte', 'bilanzkreis'],
    typicalRoles: ['ROLE_EDM', 'ROLE_METERING_MSB'],
    requiredEvidence: ['metering_values_export', 'mscons_message_status'],
    allowedActions: ['inspect_evidence', 'clarify', 'prepare_handoff'],
    blockedActions: ['external_message_send', 'billing_write'],
    handoffDomains: ['market_communication', 'metering_msb'],
    capabilityMappings: ['load_profile_stream_monitor', 'inhouse_timeseries_analysis'],
    receiptMappings: ['edm_evidence_required'],
    openApiOperationCandidates: ['edm.timeseriesStatus'],
    caseStarterEligible: true,
    dossierTemplateHint: 'edm_data_quality',
  },
  {
    activityId: 'metering_msb_clarification',
    title: 'MSB / metering operations clarification',
    domain: 'metering_msb',
    examplePrompts: ['MSB hat Werte nicht geliefert', 'Zählerwechsel und Messstellenstatus prüfen'],
    keywords: ['msb', 'messstellenbetrieb', 'zähler', 'imsys', 'melo', 'messlokation'],
    typicalRoles: ['ROLE_METERING_MSB', 'ROLE_EDM'],
    requiredEvidence: ['metering_values_export', 'utilmd_master_data'],
    allowedActions: ['inspect_evidence', 'clarify', 'prepare_handoff'],
    blockedActions: ['external_message_send', 'masterdata_write_without_review'],
    handoffDomains: ['edm', 'market_master_data', 'market_communication'],
    capabilityMappings: ['smart_meter_cls_data_governance_receipt'],
    receiptMappings: ['metering_evidence_required'],
    openApiOperationCandidates: ['metering.status'],
    caseStarterEligible: true,
    dossierTemplateHint: 'metering_clarification',
  },
  {
    activityId: 'market_master_data',
    title: 'Market master data / MaLo-MeLo assignment',
    domain: 'market_master_data',
    examplePrompts: [
      'MaLo/MeLo Zuordnung prüfen',
      'Lieferbeginn Stammdatenänderung und UTILMD-Kontext prüfen',
    ],
    keywords: [
      'malo',
      'melo',
      'marktlokation',
      'messlokation',
      'lieferbeginn',
      'stammdaten',
      'utilmd',
    ],
    typicalRoles: ['ROLE_MARKET_MASTER_DATA', 'ROLE_MARKET_COMMUNICATION', 'ROLE_EDM'],
    requiredEvidence: ['utilmd_master_data', 'mako_process_trace'],
    allowedActions: ['inspect_evidence', 'clarify', 'prepare_internal_correction'],
    blockedActions: ['external_message_send', 'masterdata_write_without_review'],
    handoffDomains: ['market_communication', 'edm', 'metering_msb'],
    capabilityMappings: ['market_communication_evidence_chain'],
    receiptMappings: ['master_data_evidence_required'],
    openApiOperationCandidates: ['marketMasterData.resolveAssignment'],
    caseStarterEligible: true,
    dossierTemplateHint: 'market_master_data',
  },
  {
    activityId: 'grid_connection_precheck',
    title: 'Grid connection pre-check',
    domain: 'grid_connection',
    examplePrompts: [
      'Rechenzentrum Mittelspannung oder Hochspannung prüfen',
      'Netzanschlussvorprüfung für Anschlussleistung durchführen',
    ],
    keywords: [
      'netzanschluss',
      'anschlussleistung',
      'spannungsebene',
      'mittelspannung',
      'hochspannung',
      'niederspannung',
    ],
    typicalRoles: ['ROLE_GRID_OPERATOR', 'ROLE_GRID_CONNECTION', 'ROLE_GRID_PLANNING'],
    requiredEvidence: ['grid_connection_document', 'calculation_assumption'],
    allowedActions: ['inspect_evidence', 'clarify', 'prepare_handoff', 'prepare_dossier'],
    blockedActions: ['approval_grant', 'connection_commitment', 'budget_commitment'],
    handoffDomains: ['asset_grid_planning', 'target_grid_planning', 'regulatory_compliance'],
    capabilityMappings: ['vdmi_grid_connection_decision_governance', 'e2e_connection_check'],
    receiptMappings: ['grid_connection_evidence_required'],
    openApiOperationCandidates: ['gridConnection.precheck'],
    caseStarterEligible: true,
    dossierTemplateHint: 'grid_connection_precheck',
  },
  {
    activityId: 'target_grid_planning_readiness',
    title: 'Grid planning / Zielnetzplanung evidence gate',
    domain: 'target_grid_planning',
    examplePrompts: ['Zielnetzplanung Produktionsreife prüfen', 'ZNP Evidence Gate für Ausbaupfad'],
    keywords: ['zielnetz', 'znp', 'produktionsreife', 'ausbaupfad', 'evidence gate'],
    typicalRoles: ['ROLE_GRID_PLANNING', 'ROLE_ASSET_MANAGEMENT', 'ROLE_UTILITY_HQ'],
    requiredEvidence: ['grid_connection_document', 'calculation_assumption'],
    allowedActions: ['inspect_evidence', 'clarify', 'prepare_handoff', 'prepare_dossier'],
    blockedActions: ['approval_grant', 'budget_commitment', 'binding_regulatory_claim'],
    handoffDomains: ['asset_grid_planning', 'grid_connection', 'regulatory_compliance'],
    capabilityMappings: ['znp_production_readiness_evidence_gate', 'znp_portfolio_assessment'],
    receiptMappings: ['znp_readiness_evidence_required'],
    openApiOperationCandidates: ['znp.productionReadinessStatus'],
    caseStarterEligible: true,
    dossierTemplateHint: 'target_grid_planning',
  },
  {
    activityId: 'asset_vdmi_governance',
    title: 'Asset Management / VDMI governance',
    domain: 'asset_grid_planning',
    examplePrompts: [
      'VDMI Asset Validation Governance prüfen',
      'Betriebsmittel- und Asset-Kontext einordnen',
    ],
    keywords: ['vdmi', 'asset', 'betriebsmittel', 'asset management', 'netzplanung'],
    typicalRoles: ['ROLE_ASSET_MANAGEMENT', 'ROLE_GRID_PLANNING'],
    requiredEvidence: ['grid_connection_document', 'calculation_assumption'],
    allowedActions: ['inspect_evidence', 'clarify', 'prepare_handoff'],
    blockedActions: ['approval_grant', 'budget_commitment'],
    handoffDomains: ['grid_connection', 'target_grid_planning'],
    capabilityMappings: ['vdmi_asset_validation_governance'],
    receiptMappings: ['asset_governance_evidence_required'],
    openApiOperationCandidates: ['vdmi.assetValidationGovernance'],
    caseStarterEligible: false,
    dossierTemplateHint: 'asset_governance',
  },
  {
    activityId: 'redispatch_clarification',
    title: 'Redispatch clarification',
    domain: 'redispatch',
    examplePrompts: [
      'Redispatch Abrufdaten fehlen',
      'Redispatch-Daten mit EDM-Zeitreihe abgleichen',
    ],
    keywords: ['redispatch', 'abrufdaten', 'fahrplan', 'einspeisemanagement'],
    typicalRoles: ['ROLE_GRID_OPERATOR', 'ROLE_EDM'],
    requiredEvidence: ['metering_values_export', 'calculation_assumption'],
    allowedActions: ['inspect_evidence', 'clarify', 'prepare_handoff'],
    blockedActions: ['external_message_send', 'settlement_write'],
    handoffDomains: ['edm', 'grid_operations_system_control'],
    capabilityMappings: ['residual_load_forecast_for_dso'],
    receiptMappings: ['redispatch_evidence_required'],
    openApiOperationCandidates: ['redispatch.callDataStatus'],
    caseStarterEligible: true,
    dossierTemplateHint: 'redispatch_clarification',
  },
  {
    activityId: 'regulatory_governance',
    title: 'Regulation / governance',
    domain: 'regulatory_compliance',
    examplePrompts: [
      'Regulatorische Einordnung mit Evidenz vorbereiten',
      'Governance Dossier ohne bindende Bewertung',
    ],
    keywords: ['regulatorik', 'regulatory', 'compliance', 'bnetza', 'governance', 'evidenz'],
    typicalRoles: ['ROLE_REGULATORY', 'ROLE_MANAGEMENT_READ', 'ROLE_UTILITY_HQ'],
    requiredEvidence: ['generic_document', 'calculation_assumption'],
    allowedActions: ['inspect_evidence', 'clarify', 'prepare_dossier'],
    blockedActions: ['binding_regulatory_claim', 'approval_grant'],
    handoffDomains: ['management', 'controlling_finance'],
    capabilityMappings: ['evidence_freshness_guard', 'non_escalation_control_evidence'],
    receiptMappings: ['regulatory_evidence_required'],
    openApiOperationCandidates: ['regulatory.evidenceDossier'],
    caseStarterEligible: true,
    dossierTemplateHint: 'regulatory_governance',
  },
  {
    activityId: 'billing_balancing',
    title: 'Billing / balancing',
    domain: 'm2c_revenue_assurance',
    examplePrompts: [
      'Abrechnung und Bilanzierung gegen Messwerte prüfen',
      'A96 Settlement Reconciliation vorbereiten',
    ],
    keywords: ['abrechnung', 'billing', 'bilanzierung', 'settlement', 'a96', 'erlös', 'revenue'],
    typicalRoles: ['ROLE_BILLING', 'ROLE_CONTROLLING', 'ROLE_EDM'],
    requiredEvidence: ['metering_values_export', 'calculation_assumption'],
    allowedActions: ['inspect_evidence', 'clarify', 'prepare_handoff'],
    blockedActions: ['billing_write', 'invoice', 'booking'],
    handoffDomains: ['edm', 'controlling_finance'],
    capabilityMappings: ['settlement_a96_reconciliation'],
    receiptMappings: ['billing_evidence_required'],
    openApiOperationCandidates: ['billing.reconciliation'],
    caseStarterEligible: false,
    dossierTemplateHint: 'billing_balancing',
  },
  {
    activityId: 'supplier_switch_clarification',
    title: 'Supplier switch clarification',
    domain: 'market_master_data',
    examplePrompts: ['Lieferantenwechsel Lieferbeginn und MaLo-Zuordnung prüfen'],
    keywords: ['lieferantenwechsel', 'lieferbeginn', 'lieferende', 'utilmd', 'malo'],
    typicalRoles: ['ROLE_MARKET_COMMUNICATION', 'ROLE_MARKET_MASTER_DATA'],
    requiredEvidence: ['utilmd_master_data', 'mako_process_trace'],
    allowedActions: ['inspect_evidence', 'clarify', 'prepare_internal_correction'],
    blockedActions: ['external_message_send', 'masterdata_write_without_review'],
    handoffDomains: ['market_communication', 'edm'],
    capabilityMappings: ['market_communication_evidence_chain'],
    receiptMappings: ['supplier_switch_evidence_required'],
    openApiOperationCandidates: ['supplierSwitch.processStatus'],
    caseStarterEligible: true,
    dossierTemplateHint: 'supplier_switch',
  },
  {
    activityId: 'customer_service_clarification',
    title: 'Customer service / clarification case',
    domain: 'org_roles_competence',
    examplePrompts: [
      'Kundenservice Klärfall an Fachbereich routen',
      'Welche Stelle ist zuständig?',
    ],
    keywords: ['kundenservice', 'klärfall', 'zuständig', 'rückfrage', 'beschwerde'],
    typicalRoles: ['ROLE_CUSTOMER_SERVICE', 'ROLE_SUPPORT_READONLY'],
    requiredEvidence: ['generic_document'],
    allowedActions: ['inspect_evidence', 'clarify', 'prepare_handoff'],
    blockedActions: ['external_message_send', 'approval_grant'],
    handoffDomains: ['market_communication', 'edm', 'grid_connection'],
    capabilityMappings: ['vdmi_role_boundary_governance'],
    receiptMappings: ['clarification_evidence_required'],
    openApiOperationCandidates: ['workbench.routeClarification'],
    caseStarterEligible: true,
    dossierTemplateHint: 'clarification_case',
  },
  {
    activityId: 'management_dossier',
    title: 'Management / Lage / dossier',
    domain: 'management',
    examplePrompts: [
      'Management Lage Dossier erstellen',
      'Nicht-bindende Lage mit Risiken und nächsten Schritten',
    ],
    keywords: ['management', 'lage', 'dossier', 'geschäftsführung', 'entscheidungsvorlage'],
    typicalRoles: ['ROLE_MANAGEMENT_READ', 'ROLE_UTILITY_HQ'],
    requiredEvidence: ['generic_document', 'calculation_assumption'],
    allowedActions: ['inspect_evidence', 'clarify', 'prepare_dossier'],
    blockedActions: ['approval_grant', 'budget_commitment', 'binding_regulatory_claim'],
    handoffDomains: ['regulatory_compliance', 'controlling_finance'],
    capabilityMappings: ['leadership_delta_cockpit', 'layer0_audit_drilldown_note'],
    receiptMappings: ['management_dossier_evidence_required'],
    openApiOperationCandidates: ['copilot.answerDossier'],
    caseStarterEligible: true,
    dossierTemplateHint: 'management_dossier',
  },
  {
    activityId: 'it_data_vendor_governance',
    title: 'IT / data / vendor governance',
    domain: 'it_data_vendor_governance',
    examplePrompts: ['Schnittstelle und Dienstleisterblocker für Datenpipeline prüfen'],
    keywords: [
      'schnittstelle',
      'vendor',
      'dienstleister',
      'pipeline',
      'datenqualität',
      'it governance',
    ],
    typicalRoles: ['ROLE_IT_GOVERNANCE', 'ROLE_DATA_GOVERNANCE', 'ROLE_UTILITY_HQ'],
    requiredEvidence: ['generic_document'],
    allowedActions: ['inspect_evidence', 'clarify', 'prepare_handoff'],
    blockedActions: ['external_message_send', 'vendor_commitment'],
    handoffDomains: ['edm', 'org_roles_competence'],
    capabilityMappings: ['interface_placeholder'],
    receiptMappings: ['vendor_governance_evidence_required'],
    openApiOperationCandidates: ['dataGovernance.vendorStatus'],
    caseStarterEligible: false,
    dossierTemplateHint: 'it_data_vendor_governance',
  },
  {
    activityId: 'm2c_revenue_assurance',
    title: 'M2C / revenue assurance',
    domain: 'm2c_revenue_assurance',
    examplePrompts: ['M2C Revenue Assurance für Cashflow-/Abrechnungsrisiko prüfen'],
    keywords: ['m2c', 'revenue assurance', 'cashflow', 'erlös', 'abrechnungsrisiko'],
    typicalRoles: ['ROLE_CONTROLLING', 'ROLE_BILLING', 'ROLE_UTILITY_HQ'],
    requiredEvidence: ['metering_values_export', 'calculation_assumption'],
    allowedActions: ['inspect_evidence', 'clarify', 'prepare_dossier'],
    blockedActions: ['billing_write', 'invoice', 'booking'],
    handoffDomains: ['billing_balancing', 'edm'],
    capabilityMappings: ['settlement_a96_reconciliation'],
    receiptMappings: ['m2c_evidence_required'],
    openApiOperationCandidates: ['m2c.revenueAssurance'],
    caseStarterEligible: false,
    dossierTemplateHint: 'm2c_revenue_assurance',
  },
];

const ACTIVITY_BY_ID = new Map(ACTIVITIES.map((activity) => [activity.activityId, activity]));

function cloneActivity(activity) {
  return JSON.parse(JSON.stringify(activity));
}

function listWorkbenchActivities({ domain = null, caseStarterEligible = null } = {}) {
  return ACTIVITIES.filter((activity) => {
    if (domain && activity.domain !== domain) return false;
    if (caseStarterEligible !== null && activity.caseStarterEligible !== caseStarterEligible)
      return false;
    return true;
  }).map(cloneActivity);
}

function getWorkbenchActivity(activityId) {
  const activity = ACTIVITY_BY_ID.get(activityId);
  return activity ? cloneActivity(activity) : null;
}

function matchWorkbenchActivities(text, { limit = 5 } = {}) {
  const normalized = String(text || '').toLowerCase();
  if (!normalized.trim()) return [];
  return ACTIVITIES.map((activity) => {
    let score = 0;
    const matchedSignals = [];
    for (const keyword of activity.keywords || []) {
      if (normalized.includes(String(keyword).toLowerCase())) {
        score += 10;
        matchedSignals.push(keyword);
      }
    }
    for (const prompt of activity.examplePrompts || []) {
      const terms = String(prompt)
        .toLowerCase()
        .split(/[^a-zäöüß0-9]+/i)
        .filter((term) => term.length >= 4);
      const overlap = terms.filter((term) => normalized.includes(term));
      if (overlap.length >= 2) {
        score += Math.min(12, overlap.length * 3);
        matchedSignals.push(...overlap.slice(0, 3));
      }
    }
    return {
      activity: cloneActivity(activity),
      score,
      matchedSignals: [...new Set(matchedSignals)].slice(0, 8),
    };
  })
    .filter((match) => match.score > 0)
    .sort((a, b) => b.score - a.score || a.activity.activityId.localeCompare(b.activity.activityId))
    .slice(0, limit);
}

function domainHintsForText(text, options = {}) {
  return matchWorkbenchActivities(text, options).map((match) => ({
    activityId: match.activity.activityId,
    domain: match.activity.domain,
    score: match.score,
    matchedSignals: match.matchedSignals,
    requiredEvidence: match.activity.requiredEvidence,
    allowedActions: match.activity.allowedActions,
    blockedActions: match.activity.blockedActions,
    handoffDomains: match.activity.handoffDomains,
    capabilityMappings: match.activity.capabilityMappings,
    receiptMappings: match.activity.receiptMappings,
    openApiOperationCandidates: match.activity.openApiOperationCandidates,
    dossierTemplateHint: match.activity.dossierTemplateHint,
  }));
}

module.exports = {
  ACTIVITY_TAXONOMY_VERSION,
  ACTIVITIES,
  listWorkbenchActivities,
  getWorkbenchActivity,
  matchWorkbenchActivities,
  domainHintsForText,
};
