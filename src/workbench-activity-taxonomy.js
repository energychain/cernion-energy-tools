'use strict';

const ACTIVITY_TAXONOMY_VERSION = 'cernion.workbench.activity-taxonomy.v1';

const BLOCKED = Object.freeze({
  external: ['external_message_send', 'approval_grant'],
  binding: ['approval_grant', 'budget_commitment', 'binding_regulatory_claim'],
  billing: ['billing_write', 'invoice', 'booking'],
  masterData: ['external_message_send', 'masterdata_write_without_review'],
});

const ACTIONS = Object.freeze({
  clarify: ['inspect_evidence', 'clarify', 'prepare_handoff'],
  dossier: ['inspect_evidence', 'clarify', 'prepare_dossier'],
  correction: ['inspect_evidence', 'clarify', 'prepare_internal_correction'],
  grid: ['inspect_evidence', 'clarify', 'prepare_handoff', 'prepare_dossier'],
});

function activity(activityId, title, domain, config) {
  return {
    activityId,
    title,
    domain,
    examplePrompts: config.examples || [],
    keywords: config.keywords || [],
    typicalRoles: config.roles || [],
    requiredEvidence: config.evidence || [],
    allowedActions: config.actions || ACTIONS.clarify,
    blockedActions: config.blocked || BLOCKED.external,
    handoffDomains: config.handoff || [],
    capabilityMappings: config.capabilities || [],
    receiptMappings: config.receipts || [],
    openApiOperationCandidates: config.operations || [],
    caseStarterEligible: Boolean(config.starter),
    dossierTemplateHint: config.dossier || activityId,
  };
}

const ACTIVITIES = [
  activity(
    'market_communication_clarification',
    'Market Communication / MaKo clarification',
    'market_communication',
    {
      examples: [
        'APERAK Z18 nach MSCONS-Versand prüfen',
        'Lieferant reklamiert fehlende MSCONS-Zeitreihe',
        'CONTRL/APERAK Ablehnung im MaKo-Prozess einordnen',
      ],
      keywords: [
        'mako',
        'marktkommunikation',
        'aperak',
        'contrl',
        'mscons',
        'utilmd',
        'evucl',
        'netzanmeldung',
        'z18',
      ],
      roles: ['ROLE_MARKET_COMMUNICATION', 'ROLE_EDM', 'ROLE_MARKET_MASTER_DATA'],
      evidence: ['aperak_message', 'contrl_message', 'mscons_message_status', 'utilmd_master_data'],
      actions: ['inspect_evidence', 'clarify', 'prepare_handoff', 'prepare_internal_correction'],
      blocked: ['external_message_send', 'approval_grant', 'binding_regulatory_claim'],
      handoff: ['edm', 'market_master_data', 'metering_msb'],
      capabilities: ['market_communication_evidence_chain'],
      receipts: ['mako_evidence_required'],
      operations: ['dashboard-api.marketCommunicationEvidenceChain'],
      starter: true,
      dossier: 'mako_clarification',
    }
  ),
  activity('edm_metering_data_quality', 'EDM / metering data quality', 'edm', {
    examples: [
      'Lastgang plausibilisieren',
      'MSCONS-Zeitreihe fehlt trotz vorhandener Messwerte',
      'Messwerte im EDM vollständig und plausibilisiert prüfen',
    ],
    keywords: ['edm', 'lastgang', 'zeitreihe', 'plausibilisiert', 'messwerte', 'bilanzkreis'],
    roles: ['ROLE_EDM', 'ROLE_METERING_MSB'],
    evidence: ['metering_values_export', 'mscons_message_status'],
    blocked: ['external_message_send', 'billing_write'],
    handoff: ['market_communication', 'metering_msb'],
    capabilities: ['load_profile_stream_monitor', 'inhouse_timeseries_analysis'],
    receipts: ['edm_evidence_required'],
    operations: ['edm.timeseriesStatus'],
    starter: true,
    dossier: 'edm_data_quality',
  }),
  activity(
    'metering_msb_clarification',
    'MSB / metering operations clarification',
    'metering_msb',
    {
      examples: ['MSB hat Werte nicht geliefert', 'Zählerwechsel und Messstellenstatus prüfen'],
      keywords: ['msb', 'messstellenbetrieb', 'zähler', 'imsys', 'melo', 'messlokation'],
      roles: ['ROLE_METERING_MSB', 'ROLE_EDM'],
      evidence: ['metering_values_export', 'utilmd_master_data'],
      blocked: BLOCKED.masterData,
      handoff: ['edm', 'market_master_data', 'market_communication'],
      capabilities: ['smart_meter_cls_data_governance_receipt'],
      receipts: ['metering_evidence_required'],
      operations: ['metering.status'],
      starter: true,
      dossier: 'metering_clarification',
    }
  ),
  activity(
    'market_master_data',
    'Market master data / MaLo-MeLo assignment',
    'market_master_data',
    {
      examples: [
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
      roles: ['ROLE_MARKET_MASTER_DATA', 'ROLE_MARKET_COMMUNICATION', 'ROLE_EDM'],
      evidence: ['utilmd_master_data', 'mako_process_trace'],
      actions: ACTIONS.correction,
      blocked: BLOCKED.masterData,
      handoff: ['market_communication', 'edm', 'metering_msb'],
      capabilities: ['market_communication_evidence_chain'],
      receipts: ['master_data_evidence_required'],
      operations: ['marketMasterData.resolveAssignment'],
      starter: true,
    }
  ),
  activity('grid_connection_precheck', 'Grid connection pre-check', 'grid_connection', {
    examples: [
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
    roles: ['ROLE_GRID_OPERATOR', 'ROLE_GRID_CONNECTION', 'ROLE_GRID_PLANNING'],
    evidence: ['grid_connection_document', 'calculation_assumption'],
    actions: ACTIONS.grid,
    blocked: ['approval_grant', 'connection_commitment', 'budget_commitment'],
    handoff: ['asset_grid_planning', 'target_grid_planning', 'regulatory_compliance'],
    capabilities: ['vdmi_grid_connection_decision_governance', 'e2e_connection_check'],
    receipts: ['grid_connection_evidence_required'],
    operations: ['gridConnection.precheck'],
    starter: true,
  }),
  activity(
    'target_grid_planning_readiness',
    'Grid planning / Zielnetzplanung evidence gate',
    'target_grid_planning',
    {
      examples: ['Zielnetzplanung Produktionsreife prüfen', 'ZNP Evidence Gate für Ausbaupfad'],
      keywords: ['zielnetz', 'znp', 'produktionsreife', 'ausbaupfad', 'evidence gate'],
      roles: ['ROLE_GRID_PLANNING', 'ROLE_ASSET_MANAGEMENT', 'ROLE_UTILITY_HQ'],
      evidence: ['grid_connection_document', 'calculation_assumption'],
      actions: ACTIONS.grid,
      blocked: BLOCKED.binding,
      handoff: ['asset_grid_planning', 'grid_connection', 'regulatory_compliance'],
      capabilities: ['znp_production_readiness_evidence_gate', 'znp_portfolio_assessment'],
      receipts: ['znp_readiness_evidence_required'],
      operations: ['znp.productionReadinessStatus'],
      starter: true,
      dossier: 'target_grid_planning',
    }
  ),
  activity('asset_vdmi_governance', 'Asset Management / VDMI governance', 'asset_grid_planning', {
    examples: [
      'VDMI Asset Validation Governance prüfen',
      'Betriebsmittel- und Asset-Kontext einordnen',
    ],
    keywords: ['vdmi', 'asset', 'betriebsmittel', 'asset management', 'netzplanung'],
    roles: ['ROLE_ASSET_MANAGEMENT', 'ROLE_GRID_PLANNING'],
    evidence: ['grid_connection_document', 'calculation_assumption'],
    blocked: ['approval_grant', 'budget_commitment'],
    handoff: ['grid_connection', 'target_grid_planning'],
    capabilities: ['vdmi_asset_validation_governance'],
    receipts: ['asset_governance_evidence_required'],
    operations: ['vdmi.assetValidationGovernance'],
    dossier: 'asset_governance',
  }),
  activity('redispatch_clarification', 'Redispatch clarification', 'redispatch', {
    examples: ['Redispatch Abrufdaten fehlen', 'Redispatch-Daten mit EDM-Zeitreihe abgleichen'],
    keywords: ['redispatch', 'abrufdaten', 'fahrplan', 'einspeisemanagement'],
    roles: ['ROLE_GRID_OPERATOR', 'ROLE_EDM'],
    evidence: ['metering_values_export', 'calculation_assumption'],
    blocked: ['external_message_send', 'settlement_write'],
    handoff: ['edm', 'grid_operations_system_control'],
    capabilities: ['residual_load_forecast_for_dso'],
    receipts: ['redispatch_evidence_required'],
    operations: ['redispatch.callDataStatus'],
    starter: true,
    dossier: 'redispatch_clarification',
  }),
  activity('regulatory_governance', 'Regulation / governance', 'regulatory_compliance', {
    examples: [
      'Regulatorische Einordnung mit Evidenz vorbereiten',
      'Governance Dossier ohne bindende Bewertung',
    ],
    keywords: ['regulatorik', 'regulatory', 'compliance', 'bnetza', 'governance', 'evidenz'],
    roles: ['ROLE_REGULATORY', 'ROLE_MANAGEMENT_READ', 'ROLE_UTILITY_HQ'],
    evidence: ['generic_document', 'calculation_assumption'],
    actions: ACTIONS.dossier,
    blocked: ['binding_regulatory_claim', 'approval_grant'],
    handoff: ['management', 'controlling_finance'],
    capabilities: ['evidence_freshness_guard', 'non_escalation_control_evidence'],
    receipts: ['regulatory_evidence_required'],
    operations: ['regulatory.evidenceDossier'],
    starter: true,
    dossier: 'regulatory_governance',
  }),
  activity('billing_balancing', 'Billing / balancing', 'm2c_revenue_assurance', {
    examples: [
      'Abrechnung und Bilanzierung gegen Messwerte prüfen',
      'A96 Settlement Reconciliation vorbereiten',
    ],
    keywords: ['abrechnung', 'billing', 'bilanzierung', 'settlement', 'a96', 'erlös', 'revenue'],
    roles: ['ROLE_BILLING', 'ROLE_CONTROLLING', 'ROLE_EDM'],
    evidence: ['metering_values_export', 'calculation_assumption'],
    blocked: BLOCKED.billing,
    handoff: ['edm', 'controlling_finance'],
    capabilities: ['settlement_a96_reconciliation'],
    receipts: ['billing_evidence_required'],
    operations: ['billing.reconciliation'],
    dossier: 'billing_balancing',
  }),
  activity('supplier_switch_clarification', 'Supplier switch clarification', 'market_master_data', {
    examples: ['Lieferantenwechsel Lieferbeginn und MaLo-Zuordnung prüfen'],
    keywords: ['lieferantenwechsel', 'lieferbeginn', 'lieferende', 'utilmd', 'malo'],
    roles: ['ROLE_MARKET_COMMUNICATION', 'ROLE_MARKET_MASTER_DATA'],
    evidence: ['utilmd_master_data', 'mako_process_trace'],
    actions: ACTIONS.correction,
    blocked: BLOCKED.masterData,
    handoff: ['market_communication', 'edm'],
    capabilities: ['market_communication_evidence_chain'],
    receipts: ['supplier_switch_evidence_required'],
    operations: ['supplierSwitch.processStatus'],
    starter: true,
    dossier: 'supplier_switch',
  }),
  activity(
    'customer_service_clarification',
    'Customer service / clarification case',
    'org_roles_competence',
    {
      examples: ['Kundenservice Klärfall an Fachbereich routen', 'Welche Stelle ist zuständig?'],
      keywords: ['kundenservice', 'klärfall', 'zuständig', 'rückfrage', 'beschwerde'],
      roles: ['ROLE_CUSTOMER_SERVICE', 'ROLE_SUPPORT_READONLY'],
      evidence: ['generic_document'],
      handoff: ['market_communication', 'edm', 'grid_connection'],
      capabilities: ['vdmi_role_boundary_governance'],
      receipts: ['clarification_evidence_required'],
      operations: ['workbench.routeClarification'],
      starter: true,
      dossier: 'clarification_case',
    }
  ),
  activity('management_dossier', 'Management / Lage / dossier', 'management', {
    examples: [
      'Management Lage Dossier erstellen',
      'Nicht-bindende Lage mit Risiken und nächsten Schritten',
    ],
    keywords: ['management', 'lage', 'dossier', 'geschäftsführung', 'entscheidungsvorlage'],
    roles: ['ROLE_MANAGEMENT_READ', 'ROLE_UTILITY_HQ'],
    evidence: ['generic_document', 'calculation_assumption'],
    actions: ACTIONS.dossier,
    blocked: BLOCKED.binding,
    handoff: ['regulatory_compliance', 'controlling_finance'],
    capabilities: ['leadership_delta_cockpit', 'layer0_audit_drilldown_note'],
    receipts: ['management_dossier_evidence_required'],
    operations: ['copilot.answerDossier'],
    starter: true,
    dossier: 'management_dossier',
  }),
  activity(
    'it_data_vendor_governance',
    'IT / data / vendor governance',
    'it_data_vendor_governance',
    {
      examples: ['Schnittstelle und Dienstleisterblocker für Datenpipeline prüfen'],
      keywords: [
        'schnittstelle',
        'vendor',
        'dienstleister',
        'pipeline',
        'datenqualität',
        'it governance',
      ],
      roles: ['ROLE_IT_GOVERNANCE', 'ROLE_DATA_GOVERNANCE', 'ROLE_UTILITY_HQ'],
      evidence: ['generic_document'],
      blocked: ['external_message_send', 'vendor_commitment'],
      handoff: ['edm', 'org_roles_competence'],
      capabilities: ['interface_placeholder'],
      receipts: ['vendor_governance_evidence_required'],
      operations: ['dataGovernance.vendorStatus'],
      dossier: 'it_data_vendor_governance',
    }
  ),
  activity('m2c_revenue_assurance', 'M2C / revenue assurance', 'm2c_revenue_assurance', {
    examples: ['M2C Revenue Assurance für Cashflow-/Abrechnungsrisiko prüfen'],
    keywords: ['m2c', 'revenue assurance', 'cashflow', 'erlös', 'abrechnungsrisiko'],
    roles: ['ROLE_CONTROLLING', 'ROLE_BILLING', 'ROLE_UTILITY_HQ'],
    evidence: ['metering_values_export', 'calculation_assumption'],
    actions: ACTIONS.dossier,
    blocked: BLOCKED.billing,
    handoff: ['billing_balancing', 'edm'],
    capabilities: ['settlement_a96_reconciliation'],
    receipts: ['m2c_evidence_required'],
    operations: ['m2c.revenueAssurance'],
    dossier: 'm2c_revenue_assurance',
  }),
];

const ACTIVITY_BY_ID = new Map(
  ACTIVITIES.map((activityItem) => [activityItem.activityId, activityItem])
);

function cloneActivity(activityItem) {
  return JSON.parse(JSON.stringify(activityItem));
}

function listWorkbenchActivities({ domain = null, caseStarterEligible = null } = {}) {
  return ACTIVITIES.filter((activityItem) => {
    if (domain && activityItem.domain !== domain) return false;
    if (caseStarterEligible !== null && activityItem.caseStarterEligible !== caseStarterEligible)
      return false;
    return true;
  }).map(cloneActivity);
}

function getWorkbenchActivity(activityId) {
  const activityItem = ACTIVITY_BY_ID.get(activityId);
  return activityItem ? cloneActivity(activityItem) : null;
}

function scorePromptOverlap(normalizedText, examplePrompt) {
  const terms = String(examplePrompt)
    .toLowerCase()
    .split(/[^a-zäöüß0-9]+/i)
    .filter((term) => term.length >= 4);
  const overlap = terms.filter((term) => normalizedText.includes(term));
  return { score: overlap.length >= 2 ? Math.min(12, overlap.length * 3) : 0, overlap };
}

function matchWorkbenchActivities(text, { limit = 5 } = {}) {
  const normalized = String(text || '').toLowerCase();
  if (!normalized.trim()) return [];
  return ACTIVITIES.map((activityItem) => {
    let score = 0;
    const matchedSignals = [];
    for (const keyword of activityItem.keywords || []) {
      if (normalized.includes(String(keyword).toLowerCase())) {
        score += 10;
        matchedSignals.push(keyword);
      }
    }
    for (const prompt of activityItem.examplePrompts || []) {
      const promptScore = scorePromptOverlap(normalized, prompt);
      score += promptScore.score;
      matchedSignals.push(...promptScore.overlap.slice(0, 3));
    }
    return {
      activity: cloneActivity(activityItem),
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
