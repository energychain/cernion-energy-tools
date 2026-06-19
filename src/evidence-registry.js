'use strict';

/**
 * Evidence Registry — Phase 1 (read-only sidecar).
 *
 * Maps capability keys and routing-matrix route keys to their evidence
 * requirements.  This registry is the single source of truth for what
 * data sources must be checked before a route can be considered
 * "evidence-complete".
 *
 * Design rules:
 * - Pure data structure — no side effects, no I/O.
 * - Adding a new capability here is the only change required to onboard
 *   it into evidence planning.
 * - Phase 1: annotation only. Gaps are surfaced but never block execution.
 * - Phase 2+: gap-gate in synthesizeTurn will use this to decide whether
 *   to surface an evidence_gap_table instead of a synthesized answer.
 *
 * Each entry shape:
 * {
 *   sources: [                  // ordered list of required evidence sources
 *     {
 *       id: string,             // stable machine ID (snake_case)
 *       label: string,          // human-readable German label
 *       resolvedBy: string[],   // action(s) that produce this evidence
 *       contextKeys: string[],  // knownContext keys that satisfy this source
 *       optional: boolean,      // true = nice-to-have, does not lower confidence
 *     }
 *   ]
 * }
 */

const EVIDENCE_REGISTRY = Object.freeze({
  // ── Capability-keyed entries ────────────────────────────────────────────

  residual_load_forecast_for_dso: {
    sources: [
      {
        id: 'vnb_identity',
        label: 'VNB-Identität (Netzbetreiber)',
        resolvedBy: ['grid-operations.marketPartners', 'grid-operations.vnbLookup'],
        contextKeys: ['gridOperatorId', 'bdewCode', 'vnbName'],
        optional: false,
      },
      {
        id: 'forecast_horizon',
        label: 'Forecast-Zeitraum (Tage)',
        resolvedBy: [],
        contextKeys: ['forecastDays', 'forecastHorizon'],
        optional: true,
      },
      {
        id: 'co2_intensity',
        label: 'CO₂-Intensität (aktuell)',
        resolvedBy: ['energy-market.co2Intensity'],
        contextKeys: [],
        optional: true,
      },
      {
        id: 'market_prices',
        label: 'Marktpreise (Day-Ahead)',
        resolvedBy: ['energy-market.prices'],
        contextKeys: [],
        optional: true,
      },
    ],
  },

  // EV charging CO2 optimization — read-only blueprint, consultation mode allowed.
  // required: location + CO2 forecast; optional: spot prices, VNB identity.
  // Missing optional evidence must never block the answer — only appear as caveats.
  ev_charging_co2_optimization: {
    sources: [
      {
        id: 'location',
        label: 'Standort / PLZ (für CO₂-Prognose)',
        resolvedBy: [],
        contextKeys: ['postalCode', 'postleitzahl', 'city', 'location'],
        optional: false,
      },
      {
        id: 'charging_duration',
        label: 'Ladedauer (Stunden)',
        resolvedBy: [],
        contextKeys: ['chargingDurationHours', 'chargingDuration', 'duration'],
        optional: false,
      },
      {
        id: 'co2_forecast',
        label: 'CO₂-Intensitätsprognose (GrünstromIndex)',
        resolvedBy: ['energy-market.co2Intensity'],
        contextKeys: ['co2IntensityForecast', 'gruenstromindex'],
        optional: false,
      },
      {
        id: 'day_ahead_prices',
        label: 'Day-Ahead-Preise (optional, nur für Kostenvergleich)',
        resolvedBy: ['energy-market.prices'],
        contextKeys: ['dayAheadPrices'],
        optional: true,
      },
      {
        id: 'vnb_identity',
        label: 'VNB-Identität (optional, für §14a-Hinweise)',
        resolvedBy: ['grid-operations.marketPartners', 'grid-operations.vnbLookup'],
        contextKeys: ['gridOperatorId', 'bdewCode', 'vnbName'],
        optional: true,
      },
    ],
  },

  // Phase 5: semantic evidence bundle for near-term Redispatch probability
  // prompts (e.g. "nächste Tage", "morgen", "kommende Woche").
  redispatch_probability_forecast: {
    sources: [
      {
        id: 'vnb_identity',
        label: 'VNB-Identität (Netzgebiet)',
        resolvedBy: ['grid-operations.marketPartners', 'grid-operations.vnbLookup'],
        contextKeys: ['gridOperatorId', 'bdewCode', 'vnbName', 'gridOperatorName'],
        optional: false,
      },
      {
        id: 'temporal_probability_window',
        label: 'Zeitfenster der Wahrscheinlichkeitsfrage (nahfristig)',
        resolvedBy: [],
        contextKeys: ['timeframeHint', 'forecastDays', 'startDate', 'dateFrom'],
        optional: false,
      },
      {
        id: 'forecast_horizon',
        label: 'Prognose-Horizont (nächste Tage)',
        resolvedBy: ['forecast.generationForecast'],
        contextKeys: ['forecastDays', 'forecastHorizon', 'startDate'],
        optional: false,
      },
      {
        id: 'gruenstromindex_forecast',
        label: 'Grünstromindex/CO₂-Intensität (Prognose)',
        resolvedBy: ['energy-market.co2Intensity', 'forecast.generationForecast'],
        contextKeys: ['co2IntensityForecast', 'gruenstromindexForecast'],
        optional: false,
      },
      {
        id: 'historical_redispatch_baseline',
        label: 'Historische Redispatch-Baseline (Vergangenheits-/Ist-Daten)',
        resolvedBy: ['redispatch-expost.audit'],
        contextKeys: ['redispatchAuditId', 'dateFrom', 'dateTo'],
        optional: true,
      },
    ],
  },

  market_communication_evidence_chain: {
    sources: [
      {
        id: 'malo_identity',
        label: 'MaLo-Identitaet (offizielle Marktlokation)',
        resolvedBy: ['dashboard-api.marketCommunicationEvidenceChainStatus', 'edm.getMalo'],
        contextKeys: ['maloId', 'marketLocationId'],
        optional: false,
      },
      {
        id: 'melo_identity',
        label: 'MeLo-Identitaet (offizielle Messlokation)',
        resolvedBy: ['dashboard-api.marketCommunicationEvidenceChainStatus', 'edm.getMelo'],
        contextKeys: ['meloId', 'meterLocationId'],
        optional: false,
      },
      {
        id: 'utilmd_masterdata_path',
        label: 'UTILMD-/Stammdatenweg (offizieller Nachweis)',
        resolvedBy: ['dashboard-api.marketCommunicationEvidenceChainStatus', 'edm-validation.validate'],
        contextKeys: ['utilmdMasterdataPath', 'masterDataPath', 'officialMasterDataEvidence'],
        optional: false,
      },
      {
        id: 'meter_values',
        label: 'Zaehlerwerte / Messwerte',
        resolvedBy: ['dashboard-api.marketCommunicationEvidenceChainStatus', 'edm.meterValues'],
        contextKeys: ['meterValues', 'meterValueBatchId', 'msconsId'],
        optional: false,
      },
      {
        id: 'consumption_retrieval',
        label: 'Verbrauchsdatenabruf / EDM-Abrufstatus',
        resolvedBy: ['dashboard-api.marketCommunicationEvidenceChainStatus', 'edm-validation.validate'],
        contextKeys: ['consumptionRetrievalStatus', 'edmRetrievalStatus'],
        optional: false,
      },
      {
        id: 'data_quality_status',
        label: 'Datenqualitaetsstatus fuer Abrechnungskontext',
        resolvedBy: ['dashboard-api.marketCommunicationEvidenceChainStatus', 'edm-validation.validate'],
        contextKeys: ['dataQualityStatus', 'edmDataQualityStatus'],
        optional: false,
      },
      {
        id: 'next_billing_step',
        label: 'Naechster Abrechnungsschritt (nur Kontext, keine Freigabe)',
        resolvedBy: ['dashboard-api.marketCommunicationEvidenceChainStatus', 'settlement.readiness'],
        contextKeys: ['nextBillingStep', 'settlementNextStep'],
        optional: false,
      },
      {
        id: 'portal_or_provider_hint',
        label: 'Portal-/Dienstleister-/Kundenhinweis (kein offizieller Nachweis)',
        resolvedBy: ['vdmi-evidence.list', 'vdmi.findings'],
        contextKeys: ['portalScreenshot', 'portalHint', 'customerStatement', 'providerView'],
        optional: true,
      },
    ],
  },

  e2e_controllability_check_governance: {
    sources: [
      {
        id: 'connection_intake',
        label: 'Netzanschluss-/Asset-Identifikation',
        resolvedBy: ['dashboard-api.e2eControllabilityGovernanceStatus', 'grid-connection.validate', 'assets.effective'],
        contextKeys: ['connectionIntake', 'gridConnectionId', 'assetId'],
        optional: false,
      },
      {
        id: 'metering_concept',
        label: 'Mess-/TAF-/EDM-Konzept',
        resolvedBy: ['dashboard-api.e2eControllabilityGovernanceStatus', 'edm-messkonzept.evaluate', 'edm-validation.validate'],
        contextKeys: ['meteringConcept', 'tafReadiness', 'edmValidationId'],
        optional: false,
      },
      {
        id: 'asset_control_capability',
        label: 'Asset-Steuerbarkeitsnachweis',
        resolvedBy: ['dashboard-api.e2eControllabilityGovernanceStatus', 'grid-operations.controlMeasures'],
        contextKeys: ['assetControlCapability', 'controlCapabilityEvidence'],
        optional: false,
      },
      {
        id: 'grid_operations_decision',
        label: 'Netzbetrieb/Redispatch-/§14a-Entscheidung',
        resolvedBy: ['dashboard-api.e2eControllabilityGovernanceStatus', 'grid-operations.netzfahrplanGenerate'],
        contextKeys: ['gridOperationsDecision', 'redispatchReadiness', 'section14aReadiness'],
        optional: false,
      },
      {
        id: 'market_communication_handover',
        label: 'Marktkommunikations-Abgabe',
        resolvedBy: ['dashboard-api.e2eControllabilityGovernanceStatus', 'dashboard-api.marketCommunicationEvidenceChainStatus'],
        contextKeys: ['marketCommunicationHandover', 'makoHandoverStatus'],
        optional: false,
      },
      {
        id: 'billing_impact_check',
        label: 'Abrechnungs-/Settlement-Grenze',
        resolvedBy: ['dashboard-api.e2eControllabilityGovernanceStatus', 'settlement.readiness'],
        contextKeys: ['billingImpactCheck', 'settlementBoundary'],
        optional: false,
      },
      {
        id: 'owner_deadline_open_measure',
        label: 'Owner, Frist und offene Massnahme',
        resolvedBy: ['dashboard-api.e2eControllabilityGovernanceStatus', 'vdmi.dossier', 'hitl.summary'],
        contextKeys: ['owner', 'deadline', 'openMeasure'],
        optional: false,
      },
    ],
  },

  controllability_asset_handover: {
    sources: [
      {
        id: 'asset_inventory',
        label: 'Asset-Inventar / MaStR-Bezug',
        resolvedBy: ['dashboard-api.controllabilityAssetHandoverStatus', 'assets.effective', 'mastr-quality.audit'],
        contextKeys: ['assetId', 'mastrId'],
        optional: false,
      },
      {
        id: 'nap_melo_mapping',
        label: 'NAP-/MeLo-Zuordnung',
        resolvedBy: ['dashboard-api.controllabilityAssetHandoverStatus', 'assets.effective', 'mastr-quality.audit'],
        contextKeys: ['napId', 'meloId'],
        optional: false,
      },
      {
        id: 'technical_status',
        label: 'Technikstatus',
        resolvedBy: ['dashboard-api.controllabilityAssetHandoverStatus', 'assets.effective', 'redispatch-expost.audit'],
        contextKeys: ['technicalStatus'],
        optional: false,
      },
      {
        id: 'feedback_capability',
        label: 'Rueckmelde-/Fernsteuerbarkeitsfaehigkeit',
        resolvedBy: ['dashboard-api.controllabilityAssetHandoverStatus', 'redispatch-expost.audit', 'grid-operations.controlMeasures'],
        contextKeys: ['feedbackCapability'],
        optional: false,
      },
      {
        id: 'controllability_scope',
        label: 'Steuerbarkeits-Scope',
        resolvedBy: ['dashboard-api.controllabilityAssetHandoverStatus', 'redispatch-expost.audit'],
        contextKeys: ['controllabilityScope'],
        optional: false,
      },
      {
        id: 'data_source_snapshot',
        label: 'Quellen-/Snapshot-Nachweis',
        resolvedBy: ['dashboard-api.controllabilityAssetHandoverStatus', 'datapoint.health', 'datasource-registry.get'],
        contextKeys: ['dataSourceRefs', 'sourceSnapshotId'],
        optional: false,
      },
      {
        id: 'check_result',
        label: 'Pruefergebnis',
        resolvedBy: ['dashboard-api.controllabilityAssetHandoverStatus', 'mastr-quality.audit', 'redispatch-expost.audit'],
        contextKeys: ['checkStatus', 'evidenceStatus'],
        optional: false,
      },
      {
        id: 'non_execution_reason',
        label: 'Nichtdurchfuehrungsbegruendung',
        resolvedBy: ['dashboard-api.controllabilityAssetHandoverStatus', 'vdmi.dossier', 'interface-placeholder.requestEvidence'],
        contextKeys: ['nonExecutionReason'],
        optional: true,
      },
      {
        id: 'line_owner',
        label: 'Linienverantwortung',
        resolvedBy: ['dashboard-api.controllabilityAssetHandoverStatus', 'vdmi.dossier'],
        contextKeys: ['lineOwnerRole'],
        optional: false,
      },
      {
        id: 'next_reporting_cycle',
        label: 'Naechster Meldezyklus',
        resolvedBy: ['dashboard-api.controllabilityAssetHandoverStatus', 'vdmi.dossier'],
        contextKeys: ['nextReportingCycle'],
        optional: false,
      },
      {
        id: 'handover_decision',
        label: 'Uebergabeentscheidung',
        resolvedBy: ['dashboard-api.controllabilityAssetHandoverStatus', 'vdmi.dossier'],
        contextKeys: ['handoverDecision'],
        optional: false,
      },
    ],
  },

  // ── Routing-matrix route-keyed entries ─────────────────────────────────

  'investment-grid-check': {
    sources: [
      {
        id: 'grid_operator_identity',
        label: 'Netzbetreiber-Identität',
        resolvedBy: ['grid-operations.marketPartners', 'grid-operations.vnbLookup'],
        contextKeys: ['gridOperatorId', 'bdewCode'],
        optional: false,
      },
      {
        id: 'investment_measures',
        label: 'Investitionsmaßnahmen',
        resolvedBy: ['investment-planning.createPlan'],
        contextKeys: ['measures', 'investmentPlanId'],
        optional: false,
      },
    ],
  },

  financier_due_diligence_assessment: {
    sources: [
      {
        id: 'asset_profile',
        label: 'Asset-Profil (Standort, Kapazität)',
        resolvedBy: ['finance-agent.analyze'],
        contextKeys: ['assetId', 'location', 'capacityMW'],
        optional: false,
      },
      {
        id: 'grid_operator_identity',
        label: 'Netzbetreiber-Identität',
        resolvedBy: ['grid-operations.marketPartners', 'grid-operations.vnbLookup'],
        contextKeys: ['gridOperatorId', 'bdewCode'],
        optional: false,
      },
      {
        id: 'netzanschlusszusage',
        label: 'Verbindliche Netzanschlusszusage (BKZ)',
        resolvedBy: [],
        contextKeys: ['bkzStatus', 'netzanschlusszusageConfirmed'],
        optional: false,
      },
    ],
  },

  // ── Phase 4: Routing-matrix shortcuts (explicit registry entries) ───────
  // These routes previously fell through to the generic tool-coverage planner.
  // Adding them here provides precise evidence planning with correct labels,
  // resolver actions, and optional/required classification.

  'energy-sharing-znp': {
    sources: [
      {
        id: 'grid_operator_identity',
        label: 'Netzbetreiber-Identität',
        resolvedBy: ['grid-operations.marketPartners', 'grid-operations.vnbLookup'],
        contextKeys: ['gridOperatorId', 'bdewCode'],
        optional: false,
      },
      {
        id: 'energy_sharing_community',
        label: 'Gemeinschaft (Name oder ID)',
        resolvedBy: [],
        contextKeys: ['communityName', 'communityId'],
        optional: false,
      },
      {
        id: 'znp_project',
        label: 'ZNP-Projektreferenz',
        resolvedBy: ['znp.getProjectMeta'],
        contextKeys: ['projectId'],
        optional: true,
      },
    ],
  },

  'redispatch-settlement': {
    sources: [
      {
        id: 'grid_operator_identity',
        label: 'Netzbetreiber-Identität',
        resolvedBy: ['grid-operations.marketPartners', 'grid-operations.vnbLookup'],
        contextKeys: ['gridOperatorId', 'bdewCode', 'gridOperatorName'],
        optional: false,
      },
      {
        id: 'audit_period',
        label: 'Redispatch-Auditperiode (von–bis)',
        resolvedBy: [],
        contextKeys: ['dateFrom', 'dateTo', 'startDate', 'endDate'],
        optional: false,
      },
      {
        id: 'settlement_installations',
        label: 'Anlagen für Settlement-Berechnung',
        resolvedBy: ['redispatch-expost.audit'],
        contextKeys: ['installations'],
        optional: true,
      },
    ],
  },

  'fnav-finance': {
    sources: [
      {
        id: 'fnav_profile',
        label: 'fNAV-Profil (Spannungsebene, Vertragsparameter)',
        resolvedBy: [],
        contextKeys: ['fnavProfile'],
        optional: false,
      },
      {
        id: 'grid_operator_identity',
        label: 'Netzbetreiber-Identität',
        resolvedBy: ['grid-operations.marketPartners', 'grid-operations.vnbLookup'],
        contextKeys: ['gridOperatorId', 'bdewCode', 'gridOperatorName'],
        optional: false,
      },
      {
        id: 'voltage_level',
        label: 'Spannungsebene (NS/MS/HS)',
        resolvedBy: [],
        contextKeys: ['voltageLevel'],
        optional: true,
      },
      {
        id: 'owner_contact',
        label: 'Anlagenbetreiber-Kontakt',
        resolvedBy: [],
        contextKeys: ['ownerContact'],
        optional: true,
      },
    ],
  },

  'forecast-flex': {
    sources: [
      {
        id: 'forecast_location',
        label: 'Prognose-Standort (PLZ oder MaStR-ID)',
        resolvedBy: [],
        contextKeys: ['postleitzahl', 'postalCode', 'gridOperatorMastrId'],
        optional: false,
      },
      {
        id: 'installation_type',
        label: 'Anlagentyp (Solar, Wind, …)',
        resolvedBy: [],
        contextKeys: ['installationType'],
        optional: true,
      },
      {
        id: 'forecast_horizon',
        label: 'Forecast-Horizont (Tage)',
        resolvedBy: [],
        contextKeys: ['forecastDays', 'forecastHorizon'],
        optional: true,
      },
      {
        id: 'flex_capacity',
        label: 'Netzkapazität für Flex-Event (kW)',
        resolvedBy: [],
        contextKeys: ['gridCapacityKw'],
        optional: true,
      },
    ],
  },
});

/**
 * Look up evidence requirements for a given route/capability key.
 *
 * @param {string} key  Route key (routing-matrix) or capability key.
 * @returns {{ sources: Array }|null}
 */
function getEvidenceRequirements(key) {
  if (!key || typeof key !== 'string') return null;
  return EVIDENCE_REGISTRY[key] || null;
}

/**
 * Return all registered keys (for inspection/testing).
 *
 * @returns {string[]}
 */
function listRegisteredKeys() {
  return Object.keys(EVIDENCE_REGISTRY);
}

module.exports = {
  EVIDENCE_REGISTRY,
  getEvidenceRequirements,
  listRegisteredKeys,
};
