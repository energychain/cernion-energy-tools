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

  vnb_special_topic_workstate: {
    sources: [
      {
        id: 'leading_source',
        label: 'Fuehrende Quelle fuer den aktuellen Arbeitsstand',
        resolvedBy: ['dashboard-api.vnbSpecialTopicWorkstateStatus'],
        contextKeys: ['leadingSource', 'sourceSystem', 'sourceName'],
        optional: false,
      },
      {
        id: 'leading_source_timestamp',
        label: 'Zeitpunkt der fuehrenden Quelle',
        resolvedBy: ['dashboard-api.vnbSpecialTopicWorkstateStatus'],
        contextKeys: ['leadingSourceTimestamp', 'sourceTimestamp', 'updatedAt'],
        optional: false,
      },
      {
        id: 'leading_source_version',
        label: 'Version oder Snapshot der fuehrenden Quelle',
        resolvedBy: ['dashboard-api.vnbSpecialTopicWorkstateStatus'],
        contextKeys: ['leadingSourceVersion', 'sourceVersion', 'snapshotId'],
        optional: false,
      },
      {
        id: 'owner_or_accountable_role',
        label: 'Owner oder verantwortliche Rolle',
        resolvedBy: ['dashboard-api.vnbSpecialTopicWorkstateStatus'],
        contextKeys: ['owner', 'accountableRole', 'ownerRole'],
        optional: false,
      },
      {
        id: 'side_source_policy',
        label: 'Regel fuer erlaubte Nebenquellen',
        resolvedBy: ['dashboard-api.vnbSpecialTopicWorkstateStatus'],
        contextKeys: ['allowedSideSources', 'sideSourcePolicy'],
        optional: true,
      },
    ],
  },

  non_escalation_control_evidence: {
    sources: [
      {
        id: 'checked_source',
        label: 'Gepruefte Monitoring-Quelle',
        resolvedBy: ['dashboard-api.monitoringNonEscalationStatus'],
        contextKeys: ['sourceName', 'checkedSource', 'monitoringSource'],
        optional: false,
      },
      {
        id: 'source_checked_at',
        label: 'Zeitpunkt des letzten Prueflaufs',
        resolvedBy: ['dashboard-api.monitoringNonEscalationStatus'],
        contextKeys: ['sourceCheckedAt', 'lastCheckAt', 'checkedAt'],
        optional: false,
      },
      {
        id: 'novelty',
        label: 'Neuheitsgrad des Signals',
        resolvedBy: ['dashboard-api.monitoringNonEscalationStatus'],
        contextKeys: ['novelty', 'noveltyStatus', 'signalNovelty'],
        optional: false,
      },
      {
        id: 'blocking_finding',
        label: 'Ausbleibender Blocker / Nicht-Treffer',
        resolvedBy: ['dashboard-api.monitoringNonEscalationStatus'],
        contextKeys: ['blockingFinding', 'absentBlocker', 'blockerStatus'],
        optional: false,
      },
      {
        id: 'next_check_at',
        label: 'Naechster Pruefzeitpunkt',
        resolvedBy: ['dashboard-api.monitoringNonEscalationStatus'],
        contextKeys: ['nextCheckAt', 'nextReviewAt'],
        optional: false,
      },
      {
        id: 'owner',
        label: 'Owner fuer Wiederholpruefung',
        resolvedBy: ['dashboard-api.monitoringNonEscalationStatus'],
        contextKeys: ['owner', 'accountableRole'],
        optional: false,
      },
      {
        id: 'rationale',
        label: 'Begruendung der Nicht-Eskalation',
        resolvedBy: ['dashboard-api.monitoringNonEscalationStatus'],
        contextKeys: ['rationale', 'nonEscalationRationale'],
        optional: false,
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
        resolvedBy: [
          'dashboard-api.marketCommunicationEvidenceChainStatus',
          'edm-validation.validate',
        ],
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
        resolvedBy: [
          'dashboard-api.marketCommunicationEvidenceChainStatus',
          'edm-validation.validate',
        ],
        contextKeys: ['consumptionRetrievalStatus', 'edmRetrievalStatus'],
        optional: false,
      },
      {
        id: 'data_quality_status',
        label: 'Datenqualitaetsstatus fuer Abrechnungskontext',
        resolvedBy: [
          'dashboard-api.marketCommunicationEvidenceChainStatus',
          'edm-validation.validate',
        ],
        contextKeys: ['dataQualityStatus', 'edmDataQualityStatus'],
        optional: false,
      },
      {
        id: 'next_billing_step',
        label: 'Naechster Abrechnungsschritt (nur Kontext, keine Freigabe)',
        resolvedBy: [
          'dashboard-api.marketCommunicationEvidenceChainStatus',
          'settlement.readiness',
        ],
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

  energy_tax_information_package: {
    sources: [
      {
        id: 'package_identity',
        label: 'Information Package und Datenquelle',
        resolvedBy: ['dashboard-api.energyTaxInformationPackageStatus', 'datasource-registry.get'],
        contextKeys: ['packageId', 'dataSourceId'],
        optional: false,
      },
      {
        id: 'data_dictionary',
        label: 'Data Dictionary / Dictionary-Version',
        resolvedBy: ['dashboard-api.energyTaxInformationPackageStatus', 'datasource-registry.get'],
        contextKeys: ['dictionaryVersion', 'dataDictionaryVersion'],
        optional: false,
      },
      {
        id: 'period_definition',
        label: 'Zeitraum / Periodendefinition',
        resolvedBy: ['dashboard-api.energyTaxInformationPackageStatus', 'datapoint.health'],
        contextKeys: ['period', 'periodStart', 'periodEnd'],
        optional: false,
      },
      {
        id: 'aggregation_logic',
        label: 'Aggregationslogik',
        resolvedBy: [
          'dashboard-api.energyTaxInformationPackageStatus',
          'datasource-classifier.classify',
        ],
        contextKeys: ['aggregationLogic'],
        optional: false,
      },
      {
        id: 'validation_status',
        label: 'Validierungsstatus',
        resolvedBy: ['dashboard-api.energyTaxInformationPackageStatus', 'datapoint.health'],
        contextKeys: ['validationStatus', 'dataQualityStatus'],
        optional: false,
      },
      {
        id: 'responsible_owner',
        label: 'Verantwortlicher Owner',
        resolvedBy: ['dashboard-api.energyTaxInformationPackageStatus', 'vdmi.dossier'],
        contextKeys: ['responsibleOwner', 'sourceOwner'],
        optional: false,
      },
      {
        id: 'handover_contact',
        label: 'Uebergabe-Ansprechpartner / Rolle',
        resolvedBy: ['dashboard-api.energyTaxInformationPackageStatus', 'vdmi.dossier'],
        contextKeys: ['contactRole', 'handoverContact'],
        optional: false,
      },
      {
        id: 'sla',
        label: 'SLA / Rueckfragefrist',
        resolvedBy: [
          'dashboard-api.energyTaxInformationPackageStatus',
          'interface-placeholder.requestEvidence',
        ],
        contextKeys: ['sla', 'responseSla'],
        optional: false,
      },
      {
        id: 'audit_reference',
        label: 'Audit-Referenz',
        resolvedBy: ['dashboard-api.energyTaxInformationPackageStatus', 'presentation.generate'],
        contextKeys: ['auditReference', 'auditRef'],
        optional: false,
      },
      {
        id: 'handover_decision',
        label: 'Uebergabeentscheidung',
        resolvedBy: ['dashboard-api.energyTaxInformationPackageStatus', 'vdmi.dossier'],
        contextKeys: ['handoverDecision', 'evidenceStatus'],
        optional: false,
      },
    ],
  },

  investment_risk_translation_status: {
    sources: [
      {
        id: 'source_identity',
        label: 'Quelle und Quellentyp',
        resolvedBy: ['dashboard-api.investmentRiskTranslationStatus', 'vdmi.dossier'],
        contextKeys: ['sourceRef', 'sourceType'],
        optional: false,
      },
      {
        id: 'period_division',
        label: 'Zeitraum und Sparte',
        resolvedBy: ['dashboard-api.investmentRiskTranslationStatus', 'vdmi.dossier'],
        contextKeys: ['period', 'division'],
        optional: false,
      },
      {
        id: 'classification',
        label: 'Klassifikation der Unterlage',
        resolvedBy: ['dashboard-api.investmentRiskTranslationStatus', 'vdmi-findings.list'],
        contextKeys: ['classification'],
        optional: false,
      },
      {
        id: 'impact_context',
        label: 'Finanz-/Asset-/Risikoauswirkung',
        resolvedBy: [
          'dashboard-api.investmentRiskTranslationStatus',
          'finance-agent.analyze',
          'investment-planning.createPlan',
        ],
        contextKeys: ['financialImpact', 'assetImpact', 'budgetRef', 'riskRef'],
        optional: false,
      },
      {
        id: 'owner_role',
        label: 'Owner-Rolle',
        resolvedBy: ['dashboard-api.investmentRiskTranslationStatus', 'vdmi.dossier'],
        contextKeys: ['ownerRole'],
        optional: false,
      },
      {
        id: 'decision_readiness',
        label: 'Entscheidungsreife',
        resolvedBy: ['dashboard-api.investmentRiskTranslationStatus', 'vdmi-findings.list'],
        contextKeys: ['decisionReadiness'],
        optional: false,
      },
      {
        id: 'blocked_decision',
        label: 'Blockierte Folgeentscheidung',
        resolvedBy: ['dashboard-api.investmentRiskTranslationStatus', 'hitl.create'],
        contextKeys: ['blockedDecisionId'],
        optional: false,
      },
      {
        id: 'next_action',
        label: 'Naechste Aktion',
        resolvedBy: ['dashboard-api.investmentRiskTranslationStatus', 'presentation.generate'],
        contextKeys: ['nextAction'],
        optional: false,
      },
      {
        id: 'source_snapshot',
        label: 'Quellensnapshot',
        resolvedBy: ['dashboard-api.investmentRiskTranslationStatus', 'vdmi-evidence.inject'],
        contextKeys: ['sourceSnapshot'],
        optional: false,
      },
      {
        id: 'evidence_refs',
        label: 'Evidenzreferenzen',
        resolvedBy: ['dashboard-api.investmentRiskTranslationStatus', 'vdmi-evidence.inject'],
        contextKeys: ['evidenceRefs'],
        optional: false,
      },
    ],
  },

  budget_waterfall_governance: {
    sources: [
      {
        id: 'source_identity',
        label: 'Wasserfall- und Quellenidentitaet',
        resolvedBy: ['dashboard-api.budgetWaterfallGovernanceStatus', 'vdmi.dossier'],
        contextKeys: ['waterfallId', 'sourceId'],
        optional: false,
      },
      {
        id: 'period_division',
        label: 'Zeitraum und Sparte',
        resolvedBy: ['dashboard-api.budgetWaterfallGovernanceStatus', 'vdmi.dossier'],
        contextKeys: ['period', 'division'],
        optional: false,
      },
      {
        id: 'baseline_reference',
        label: 'Baseline-Referenz',
        resolvedBy: [
          'dashboard-api.budgetWaterfallGovernanceStatus',
          'investment-planning.createPlan',
        ],
        contextKeys: ['baselineRef'],
        optional: false,
      },
      {
        id: 'forecast_cutoff',
        label: 'Prognoseende',
        resolvedBy: [
          'dashboard-api.budgetWaterfallGovernanceStatus',
          'datapoint.health',
          'datasource-registry.get',
        ],
        contextKeys: ['forecastCutoff'],
        optional: false,
      },
      {
        id: 'carryover_logic',
        label: 'Uebertragslogik',
        resolvedBy: [
          'dashboard-api.budgetWaterfallGovernanceStatus',
          'investment-planning.createPlan',
          'finance-agent.analyze',
        ],
        contextKeys: ['carryoverLogic'],
        optional: false,
      },
      {
        id: 'sign_convention',
        label: 'Vorzeichenlogik',
        resolvedBy: [
          'dashboard-api.budgetWaterfallGovernanceStatus',
          'finance-agent.analyze',
          'presentation.generate',
        ],
        contextKeys: ['signConvention'],
        optional: false,
      },
      {
        id: 'owner_role',
        label: 'Owner-Rolle',
        resolvedBy: ['dashboard-api.budgetWaterfallGovernanceStatus', 'vdmi.dossier'],
        contextKeys: ['ownerRole'],
        optional: false,
      },
      {
        id: 'approval_status',
        label: 'Freigabestatus',
        resolvedBy: ['dashboard-api.budgetWaterfallGovernanceStatus', 'vdmi.dossier'],
        contextKeys: ['approvalStatus'],
        optional: false,
      },
      {
        id: 'follow_up_decision',
        label: 'Folgeentscheidung',
        resolvedBy: ['dashboard-api.budgetWaterfallGovernanceStatus', 'presentation.generate'],
        contextKeys: ['followUpDecision'],
        optional: false,
      },
      {
        id: 'source_snapshot_ref',
        label: 'Quellensnapshot',
        resolvedBy: ['dashboard-api.budgetWaterfallGovernanceStatus', 'vdmi-evidence.inject'],
        contextKeys: ['sourceSnapshotRef'],
        optional: false,
      },
      {
        id: 'evidence_ref',
        label: 'Evidenzreferenzen',
        resolvedBy: ['dashboard-api.budgetWaterfallGovernanceStatus', 'vdmi-evidence.inject'],
        contextKeys: ['evidenceRef'],
        optional: false,
      },
    ],
  },

  gas_decommissioning_roadmap_status: {
    sources: [
      {
        id: 'roadmap_identity',
        label: 'Stilllegungsroadmap-Identitaet',
        resolvedBy: ['dashboard-api.gasDecommissioningRoadmapStatus', 'vdmi.dossier'],
        contextKeys: ['roadmapId'],
        optional: false,
      },
      {
        id: 'current_phase',
        label: 'Aktuelle Roadmap-Phase',
        resolvedBy: ['dashboard-api.gasDecommissioningRoadmapStatus', 'vdmi.dossier'],
        contextKeys: ['currentPhase'],
        optional: false,
      },
      {
        id: 'owner',
        label: 'Roadmap-Owner',
        resolvedBy: ['dashboard-api.gasDecommissioningRoadmapStatus', 'vdmi.dossier'],
        contextKeys: ['owner'],
        optional: false,
      },
      {
        id: 'asset_risk_evidence',
        label: 'Asset-Risiko-Evidenz',
        resolvedBy: ['dashboard-api.gasDecommissioningRoadmapStatus', 'vdmi-evidence.inject'],
        contextKeys: ['assetRiskEvidence'],
        optional: false,
      },
      {
        id: 'dependency_map',
        label: 'Abhaengigkeitskarte',
        resolvedBy: [
          'dashboard-api.gasDecommissioningRoadmapStatus',
          'vdmi.dossier',
          'presentation.generate',
        ],
        contextKeys: ['dependencyMap'],
        optional: false,
      },
      {
        id: 'investment_impact_ref',
        label: 'Investitionsfolge-Referenz',
        resolvedBy: [
          'dashboard-api.gasDecommissioningRoadmapStatus',
          'investment-planning.createPlan',
          'finance-agent.analyze',
        ],
        contextKeys: ['investmentImpactRef'],
        optional: false,
      },
      {
        id: 'committee_gate_date',
        label: 'Gremiengate-Termin',
        resolvedBy: [
          'dashboard-api.gasDecommissioningRoadmapStatus',
          'hitl.create',
          'presentation.generate',
        ],
        contextKeys: ['committeeGateDate'],
        optional: false,
      },
      {
        id: 'execution_handover_owner',
        label: 'Ausfuehrungsuebergabe-Owner',
        resolvedBy: ['dashboard-api.gasDecommissioningRoadmapStatus', 'vdmi.dossier'],
        contextKeys: ['executionHandoverOwner'],
        optional: false,
      },
      {
        id: 'next_decision_gate',
        label: 'Naechstes Entscheidungsgate',
        resolvedBy: ['dashboard-api.gasDecommissioningRoadmapStatus', 'presentation.generate'],
        contextKeys: ['nextDecisionGate'],
        optional: false,
      },
      {
        id: 'source_snapshot_ref',
        label: 'Quellensnapshot',
        resolvedBy: ['dashboard-api.gasDecommissioningRoadmapStatus', 'vdmi-evidence.inject'],
        contextKeys: ['sourceSnapshotRef'],
        optional: false,
      },
      {
        id: 'evidence_ref',
        label: 'Evidenzreferenzen',
        resolvedBy: ['dashboard-api.gasDecommissioningRoadmapStatus', 'vdmi-evidence.inject'],
        contextKeys: ['evidenceRef'],
        optional: false,
      },
    ],
  },

  jour_fixe_decision_closure_tracker: {
    sources: [
      {
        id: 'topic_identity',
        label: 'Jour-fixe-Thema / Topic-Identitaet',
        resolvedBy: ['dashboard-api.jourFixeDecisionClosureStatus', 'vdmi.dossier'],
        contextKeys: ['topicId', 'topicTitle'],
        optional: false,
      },
      {
        id: 'jour_fixe_context',
        label: 'Jour-fixe-Kontext',
        resolvedBy: ['dashboard-api.jourFixeDecisionClosureStatus', 'vdmi.dossier'],
        contextKeys: ['jourFixeId'],
        optional: false,
      },
      {
        id: 'topic_owner',
        label: 'Topic-Owner',
        resolvedBy: ['dashboard-api.jourFixeDecisionClosureStatus', 'vdmi.dossier'],
        contextKeys: ['owner', 'topicOwner'],
        optional: false,
      },
      {
        id: 'kpi',
        label: 'KPI / Abschlusskennzahl',
        resolvedBy: ['dashboard-api.jourFixeDecisionClosureStatus', 'vdmi.dossier'],
        contextKeys: ['kpi'],
        optional: false,
      },
      {
        id: 'decision_criterion',
        label: 'Entscheidungskriterium',
        resolvedBy: ['dashboard-api.jourFixeDecisionClosureStatus', 'nova.list', 'vdmi.dossier'],
        contextKeys: ['decisionCriterion'],
        optional: false,
      },
      {
        id: 'next_gate',
        label: 'Naechstes Gate',
        resolvedBy: ['dashboard-api.jourFixeDecisionClosureStatus', 'presentation.generate'],
        contextKeys: ['nextGate'],
        optional: false,
      },
      {
        id: 'closure_status',
        label: 'Abschlussstatus',
        resolvedBy: ['dashboard-api.jourFixeDecisionClosureStatus', 'vdmi.dossier'],
        contextKeys: ['closureStatus'],
        optional: false,
      },
      {
        id: 'closure_proof',
        label: 'Abschlussnachweis',
        resolvedBy: ['dashboard-api.jourFixeDecisionClosureStatus', 'vdmi-evidence.inject'],
        contextKeys: ['closureProof'],
        optional: false,
      },
      {
        id: 'blocked_follow_up_action',
        label: 'Blockierte Folgeaktion',
        resolvedBy: ['dashboard-api.jourFixeDecisionClosureStatus', 'hitl.create', 'nova.list'],
        contextKeys: ['blockedFollowUpAction'],
        optional: true,
      },
      {
        id: 'source_snapshot_ref',
        label: 'Quellensnapshot',
        resolvedBy: ['dashboard-api.jourFixeDecisionClosureStatus', 'vdmi-evidence.inject'],
        contextKeys: ['sourceSnapshotRef'],
        optional: false,
      },
      {
        id: 'evidence_ref',
        label: 'Evidenzreferenzen',
        resolvedBy: ['dashboard-api.jourFixeDecisionClosureStatus', 'vdmi-evidence.inject'],
        contextKeys: ['evidenceRef'],
        optional: false,
      },
    ],
  },

  off_balancing_metering_pruefmatrix: {
    sources: [
      {
        id: 'metering_scope',
        label: 'Metering-Scope / Zaehlparkumfang',
        resolvedBy: ['dashboard-api.offBalancingMeteringPruefmatrixStatus', 'datapoint.health'],
        contextKeys: ['meteringScope'],
        optional: false,
      },
      {
        id: 'financing_model',
        label: 'Off-Balancing-Finanzierungsmodell',
        resolvedBy: [
          'dashboard-api.offBalancingMeteringPruefmatrixStatus',
          'finance-agent.analyze',
        ],
        contextKeys: ['financingModel'],
        optional: false,
      },
      {
        id: 'decision_owner',
        label: 'Entscheidungs-Owner',
        resolvedBy: ['dashboard-api.offBalancingMeteringPruefmatrixStatus', 'vdmi.dossier'],
        contextKeys: ['decisionOwner'],
        optional: false,
      },
      {
        id: 'committee_gate',
        label: 'Gremiengate',
        resolvedBy: [
          'dashboard-api.offBalancingMeteringPruefmatrixStatus',
          'presentation.generate',
        ],
        contextKeys: ['committeeGate'],
        optional: false,
      },
      {
        id: 'capex_opex_baseline',
        label: 'CAPEX/OPEX-Baseline',
        resolvedBy: [
          'dashboard-api.offBalancingMeteringPruefmatrixStatus',
          'investment-planning.createPlan',
          'finance-agent.analyze',
        ],
        contextKeys: ['capexOpexBaseline'],
        optional: false,
      },
      {
        id: 'eog_regulatory_effect',
        label: 'EOG-/Regulierungswirkung',
        resolvedBy: [
          'dashboard-api.offBalancingMeteringPruefmatrixStatus',
          'eog-calculator.scenario',
          'finance-agent.analyze',
        ],
        contextKeys: ['eogEffectEvidence', 'regulatoryEffectEvidence'],
        optional: false,
      },
      {
        id: 'cost_recognition_assumption',
        label: 'Kostenanerkennungsannahme',
        resolvedBy: [
          'dashboard-api.offBalancingMeteringPruefmatrixStatus',
          'finance-agent.analyze',
        ],
        contextKeys: ['costRecognitionAssumption'],
        optional: false,
      },
      {
        id: 'financier_conditions',
        label: 'Finanziererbedingungen',
        resolvedBy: [
          'dashboard-api.offBalancingMeteringPruefmatrixStatus',
          'finance-agent.analyze',
        ],
        contextKeys: ['financierConditions'],
        optional: false,
      },
      {
        id: 'data_quality_status',
        label: 'Datenqualitaetsstatus',
        resolvedBy: [
          'dashboard-api.offBalancingMeteringPruefmatrixStatus',
          'datapoint.health',
          'datasource-registry.get',
        ],
        contextKeys: ['dataQualityStatus'],
        optional: false,
      },
      {
        id: 'interface_risk_status',
        label: 'Schnittstellenrisiko',
        resolvedBy: [
          'dashboard-api.offBalancingMeteringPruefmatrixStatus',
          'interface-placeholder.listGaps',
          'vdmi.dossier',
        ],
        contextKeys: ['interfaceRiskStatus'],
        optional: false,
      },
      {
        id: 'grid_investment_space_proof',
        label: 'Nutzbarer Stromnetz-Investitionsspielraum',
        resolvedBy: [
          'dashboard-api.offBalancingMeteringPruefmatrixStatus',
          'investment-planning.createPlan',
          'finance-agent.analyze',
        ],
        contextKeys: ['gridInvestmentSpaceProof'],
        optional: false,
      },
      {
        id: 'source_snapshot_ref',
        label: 'Quellensnapshot',
        resolvedBy: ['dashboard-api.offBalancingMeteringPruefmatrixStatus', 'vdmi-evidence.inject'],
        contextKeys: ['sourceSnapshotRef'],
        optional: false,
      },
      {
        id: 'evidence_ref',
        label: 'Evidenzreferenzen',
        resolvedBy: ['dashboard-api.offBalancingMeteringPruefmatrixStatus', 'vdmi-evidence.inject'],
        contextKeys: ['evidenceRef'],
        optional: false,
      },
    ],
  },

  automation_requirements_decision_value: {
    sources: [
      {
        id: 'request_identity',
        label: 'Anforderung / Requirements Card',
        resolvedBy: ['dashboard-api.automationRequirementsDecisionValueStatus', 'vdmi.dossier'],
        contextKeys: ['requirementId', 'requestTitle'],
        optional: false,
      },
      {
        id: 'request_type',
        label: 'Anforderungstyp',
        resolvedBy: [
          'dashboard-api.automationRequirementsDecisionValueStatus',
          'business-intelligence.describe',
        ],
        contextKeys: ['requestType'],
        optional: false,
      },
      {
        id: 'process_area',
        label: 'Prozessbereich',
        resolvedBy: ['dashboard-api.automationRequirementsDecisionValueStatus', 'vdmi.dossier'],
        contextKeys: ['processArea'],
        optional: false,
      },
      {
        id: 'decision_owner',
        label: 'Entscheidungs-Owner',
        resolvedBy: ['dashboard-api.automationRequirementsDecisionValueStatus', 'vdmi.dossier'],
        contextKeys: ['decisionOwner'],
        optional: false,
      },
      {
        id: 'target_gate',
        label: 'Ziel-Gate',
        resolvedBy: [
          'dashboard-api.automationRequirementsDecisionValueStatus',
          'presentation.generate',
        ],
        contextKeys: ['targetGate'],
        optional: false,
      },
      {
        id: 'source_system',
        label: 'Quellsystem',
        resolvedBy: [
          'dashboard-api.automationRequirementsDecisionValueStatus',
          'datasource-registry.get',
        ],
        contextKeys: ['sourceSystem'],
        optional: false,
      },
      {
        id: 'moving_data_flow',
        label: 'Bewegungsdatenfluss',
        resolvedBy: [
          'dashboard-api.automationRequirementsDecisionValueStatus',
          'datasource-registry.get',
          'interface-placeholder.listGaps',
        ],
        contextKeys: ['movingDataFlow'],
        optional: false,
      },
      {
        id: 'manual_effort',
        label: 'Manueller Aufwand',
        resolvedBy: ['dashboard-api.automationRequirementsDecisionValueStatus', 'vdmi.dossier'],
        contextKeys: ['manualEffort'],
        optional: false,
      },
      {
        id: 'control_point',
        label: 'Operativer Kontrollpunkt',
        resolvedBy: ['dashboard-api.automationRequirementsDecisionValueStatus', 'vdmi.dossier'],
        contextKeys: ['controlPoint'],
        optional: false,
      },
      {
        id: 'decision_value',
        label: 'Entscheidungswert',
        resolvedBy: [
          'dashboard-api.automationRequirementsDecisionValueStatus',
          'presentation.generate',
        ],
        contextKeys: ['decisionValue'],
        optional: false,
      },
      {
        id: 'follow_up_process',
        label: 'Folgeprozess',
        resolvedBy: ['dashboard-api.automationRequirementsDecisionValueStatus', 'vdmi.dossier'],
        contextKeys: ['followUpProcess'],
        optional: false,
      },
      {
        id: 'data_quality',
        label: 'Datenqualitaet',
        resolvedBy: ['dashboard-api.automationRequirementsDecisionValueStatus', 'datapoint.health'],
        contextKeys: ['dataQuality'],
        optional: false,
      },
      {
        id: 'rollback_or_stop_criterion',
        label: 'Rollback-/Stop-Kriterium',
        resolvedBy: ['dashboard-api.automationRequirementsDecisionValueStatus', 'vdmi.dossier'],
        contextKeys: ['rollbackOrStopCriterion'],
        optional: false,
      },
      {
        id: 'source_snapshot_ref',
        label: 'Quellensnapshot',
        resolvedBy: [
          'dashboard-api.automationRequirementsDecisionValueStatus',
          'vdmi-evidence.inject',
        ],
        contextKeys: ['sourceSnapshotRef'],
        optional: false,
      },
      {
        id: 'evidence_ref',
        label: 'Evidenzreferenzen',
        resolvedBy: [
          'dashboard-api.automationRequirementsDecisionValueStatus',
          'vdmi-evidence.inject',
        ],
        contextKeys: ['evidenceRef'],
        optional: false,
      },
    ],
  },

  smart_meter_off_balancing_purpose_lock: {
    sources: [
      {
        id: 'asset_scope',
        label: 'Smart-Meter-Assetumfang',
        resolvedBy: ['dashboard-api.smartMeterOffBalancingPurposeLockStatus', 'datapoint.health'],
        contextKeys: ['assetScope'],
        optional: false,
      },
      {
        id: 'financing_model',
        label: 'Off-Balancing-Finanzierungsmodell',
        resolvedBy: [
          'dashboard-api.smartMeterOffBalancingPurposeLockStatus',
          'finance-agent.analyze',
        ],
        contextKeys: ['financingModel'],
        optional: false,
      },
      {
        id: 'off_balance_volume_eur',
        label: 'Off-Balance-Volumen',
        resolvedBy: [
          'dashboard-api.smartMeterOffBalancingPurposeLockStatus',
          'finance-agent.analyze',
        ],
        contextKeys: ['offBalanceVolumeEur'],
        optional: false,
      },
      {
        id: 'freed_liquidity_eur',
        label: 'Freiwerdende Liquiditaet',
        resolvedBy: [
          'dashboard-api.smartMeterOffBalancingPurposeLockStatus',
          'finance-agent.analyze',
        ],
        contextKeys: ['freedLiquidityEur'],
        optional: false,
      },
      {
        id: 'financier_cost_eur',
        label: 'Finanzierer-Kosten',
        resolvedBy: [
          'dashboard-api.smartMeterOffBalancingPurposeLockStatus',
          'finance-agent.analyze',
        ],
        contextKeys: ['financierCostEur'],
        optional: false,
      },
      {
        id: 'capex_opex_totex_effect',
        label: 'CAPEX-/OPEX-/TOTEX-Wirkung',
        resolvedBy: [
          'dashboard-api.smartMeterOffBalancingPurposeLockStatus',
          'finance-agent.analyze',
        ],
        contextKeys: ['capexOpexTotexEffect'],
        optional: false,
      },
      {
        id: 'regulatory_recognition_status',
        label: 'Regulatorische Anerkennung',
        resolvedBy: [
          'dashboard-api.smartMeterOffBalancingPurposeLockStatus',
          'finance-agent.analyze',
        ],
        contextKeys: ['regulatoryRecognitionStatus'],
        optional: false,
      },
      {
        id: 'purpose_lock_measures_missing',
        label: 'Zweckgebundene Massnahmen',
        resolvedBy: ['dashboard-api.smartMeterOffBalancingPurposeLockStatus', 'vdmi.dossier'],
        contextKeys: ['purposeLockedMeasures'],
        optional: false,
      },
      {
        id: 'investment_effect_missing',
        label: 'Operativer Investitionseffekt',
        resolvedBy: [
          'dashboard-api.smartMeterOffBalancingPurposeLockStatus',
          'investment-planning.read',
        ],
        contextKeys: [
          'controlRoomInvestments',
          'processInvestments',
          'gridInfrastructureInvestments',
        ],
        optional: false,
      },
      {
        id: 'budget_dilution_risk_open',
        label: 'Budgetverwaesserungsrisiko',
        resolvedBy: [
          'dashboard-api.smartMeterOffBalancingPurposeLockStatus',
          'finance-agent.analyze',
        ],
        contextKeys: ['budgetDilutionRisk'],
        optional: false,
      },
      {
        id: 'finance_review_missing',
        label: 'Finance-Review-Status',
        resolvedBy: ['dashboard-api.smartMeterOffBalancingPurposeLockStatus', 'vdmi.dossier'],
        contextKeys: ['financeReviewStatus'],
        optional: false,
      },
      {
        id: 'source_snapshot_ref',
        label: 'Quellensnapshot',
        resolvedBy: [
          'dashboard-api.smartMeterOffBalancingPurposeLockStatus',
          'vdmi-evidence.inject',
        ],
        contextKeys: ['sourceSnapshotRef'],
        optional: false,
      },
      {
        id: 'evidence_ref',
        label: 'Evidenzreferenzen',
        resolvedBy: [
          'dashboard-api.smartMeterOffBalancingPurposeLockStatus',
          'vdmi-evidence.inject',
        ],
        contextKeys: ['evidenceRef'],
        optional: false,
      },
    ],
  },

  imsys_schedule_value_chain_readiness: {
    sources: [
      {
        id: 'metering_scope',
        label: 'iMSys-/CLS-Messbereich',
        resolvedBy: ['dashboard-api.imsysScheduleValueChainReadinessStatus', 'datapoint.health'],
        contextKeys: ['meteringScope'],
        optional: false,
      },
      {
        id: 'source_datapoints',
        label: 'Messdatenquellen',
        resolvedBy: [
          'dashboard-api.imsysScheduleValueChainReadinessStatus',
          'datapoint.health',
          'datasource-registry.get',
        ],
        contextKeys: ['sourceDatapoints'],
        optional: false,
      },
      {
        id: 'data_quality_status',
        label: 'Datenqualitaet',
        resolvedBy: ['dashboard-api.imsysScheduleValueChainReadinessStatus', 'datapoint.health'],
        contextKeys: ['dataQualityStatus'],
        optional: false,
      },
      {
        id: 'forecast_window',
        label: 'Prognosefenster',
        resolvedBy: [
          'dashboard-api.imsysScheduleValueChainReadinessStatus',
          'forecast-engine.run',
          'forecast.read',
        ],
        contextKeys: ['forecastWindow'],
        optional: false,
      },
      {
        id: 'congestion_signal',
        label: 'Engpasssignal',
        resolvedBy: [
          'dashboard-api.imsysScheduleValueChainReadinessStatus',
          'grid-operations.netzfahrplanGenerate',
        ],
        contextKeys: ['congestionSignal'],
        optional: false,
      },
      {
        id: 'asset_scope',
        label: 'Asset-/NAP-/MeLo-Scope',
        resolvedBy: [
          'dashboard-api.imsysScheduleValueChainReadinessStatus',
          'assets.effective',
          'mastr-quality.audit',
        ],
        contextKeys: ['assetScope'],
        optional: false,
      },
      {
        id: 'controllability_status',
        label: 'Steuerbarkeitsstatus',
        resolvedBy: [
          'dashboard-api.imsysScheduleValueChainReadinessStatus',
          'flex.listDevices',
          'redispatch-expost.audit',
        ],
        contextKeys: ['controllabilityStatus'],
        optional: false,
      },
      {
        id: 'flexibility_options',
        label: 'Flexibilitaetsoptionen',
        resolvedBy: ['dashboard-api.imsysScheduleValueChainReadinessStatus', 'flex.listDevices'],
        contextKeys: ['flexibilityOptions'],
        optional: false,
      },
      {
        id: 'netzfahrplan_assessment_ref',
        label: 'Netzfahrplan-Bewertung',
        resolvedBy: [
          'dashboard-api.imsysScheduleValueChainReadinessStatus',
          'grid-operations.netzfahrplanGenerate',
        ],
        contextKeys: ['netzfahrplanAssessmentRef'],
        optional: false,
      },
      {
        id: 'operational_decision',
        label: 'Operative Entscheidung',
        resolvedBy: ['dashboard-api.imsysScheduleValueChainReadinessStatus', 'vdmi.dossier'],
        contextKeys: ['operationalDecision'],
        optional: false,
      },
      {
        id: 'control_readiness',
        label: 'Leitwarten-/Control-Readiness',
        resolvedBy: [
          'dashboard-api.imsysScheduleValueChainReadinessStatus',
          'vdmi.dossier',
          'interface-placeholder.requestEvidence',
        ],
        contextKeys: ['controlReadiness'],
        optional: false,
      },
      {
        id: 'line_owner_role',
        label: 'Linienverantwortung',
        resolvedBy: ['dashboard-api.imsysScheduleValueChainReadinessStatus', 'vdmi.dossier'],
        contextKeys: ['lineOwnerRole'],
        optional: false,
      },
      {
        id: 'source_snapshot_ref',
        label: 'Quellensnapshot',
        resolvedBy: [
          'dashboard-api.imsysScheduleValueChainReadinessStatus',
          'vdmi-evidence.inject',
        ],
        contextKeys: ['sourceSnapshotRef'],
        optional: false,
      },
      {
        id: 'evidence_ref',
        label: 'Evidenzreferenzen',
        resolvedBy: [
          'dashboard-api.imsysScheduleValueChainReadinessStatus',
          'vdmi-evidence.inject',
        ],
        contextKeys: ['evidenceRef'],
        optional: false,
      },
    ],
  },

  sap_budget_psp_gate: {
    sources: [
      {
        id: 'measure_context',
        label: 'Massnahme und SAP-Migrationskontext',
        resolvedBy: ['dashboard-api.sapBudgetPspGateStatus', 'investment-planning.createPlan'],
        contextKeys: ['measureId', 'measureName', 'migrationWave'],
        optional: false,
      },
      {
        id: 'sap_mapping',
        label: 'SAP-Zielsystem / interner Auftrag',
        resolvedBy: [
          'dashboard-api.sapBudgetPspGateStatus',
          'datasource-registry.get',
          'vdmi.dossier',
        ],
        contextKeys: ['sapSystemRef', 'legacyInternalOrderId'],
        optional: false,
      },
      {
        id: 'psp_snapshot',
        label: 'PSP-Element und Uebertragssnapshot',
        resolvedBy: [
          'dashboard-api.sapBudgetPspGateStatus',
          'datapoint.health',
          'datasource-registry.get',
        ],
        contextKeys: ['pspElementId', 'pspCarryOverEur', 'sourceSnapshotId'],
        optional: false,
      },
      {
        id: 'budget_values',
        label: 'Budget-, Plan- und Commitment-Werte',
        resolvedBy: [
          'dashboard-api.sapBudgetPspGateStatus',
          'investment-planning.createPlan',
          'finance-agent.analyze',
        ],
        contextKeys: [
          'availableBudgetEur',
          'plannedValueEur',
          'committedValueEur',
          'budgetOverhangEur',
        ],
        optional: false,
      },
      {
        id: 'budget_owner',
        label: 'Budget-Owner',
        resolvedBy: ['dashboard-api.sapBudgetPspGateStatus', 'vdmi.dossier'],
        contextKeys: ['ownerRole', 'budgetOwner'],
        optional: false,
      },
      {
        id: 'asset_benefit',
        label: 'Assetnutzen und Priorisierung',
        resolvedBy: [
          'dashboard-api.sapBudgetPspGateStatus',
          'investment-planning.createPlan',
          'finance-agent.analyze',
        ],
        contextKeys: ['assetBenefit', 'priorityScore', 'avoidedCostsEur'],
        optional: false,
      },
      {
        id: 'finance_gate',
        label: 'Finance-Gate',
        resolvedBy: [
          'dashboard-api.sapBudgetPspGateStatus',
          'finance-agent.analyze',
          'presentation.generate',
        ],
        contextKeys: ['financeGate', 'financeReviewStatus'],
        optional: false,
      },
      {
        id: 'approval_status',
        label: 'Freigabestatus',
        resolvedBy: ['dashboard-api.sapBudgetPspGateStatus', 'vdmi.dossier'],
        contextKeys: ['approvalStatus', 'approvalModel'],
        optional: false,
      },
      {
        id: 'data_quality',
        label: 'Datenqualitaet / Auditierbarkeit',
        resolvedBy: [
          'dashboard-api.sapBudgetPspGateStatus',
          'datapoint.health',
          'datasource-registry.get',
        ],
        contextKeys: ['dataQualityStatus'],
        optional: false,
      },
    ],
  },

  investment_two_track_control: {
    sources: [
      {
        id: 'submission_contract',
        label: 'Taktischer Abgabevertrag',
        resolvedBy: [
          'dashboard-api.investmentTwoTrackControlStatus',
          'investment-planning.createPlan',
        ],
        contextKeys: ['submissionId', 'deadline', 'submissionFormat'],
        optional: false,
      },
      {
        id: 'tactical_owner',
        label: 'Taktischer Abgabe-Owner',
        resolvedBy: ['dashboard-api.investmentTwoTrackControlStatus', 'vdmi.dossier'],
        contextKeys: ['tacticalOwner', 'owner'],
        optional: false,
      },
      {
        id: 'measures_and_budget',
        label: 'Massnahmen und Budgetrahmen',
        resolvedBy: [
          'dashboard-api.investmentTwoTrackControlStatus',
          'investment-planning.createPlan',
        ],
        contextKeys: ['measureCount', 'measures', 'budgetEnvelopeEur', 'financeBudgetEur'],
        optional: false,
      },
      {
        id: 'finance_review',
        label: 'Finance-Review-Status',
        resolvedBy: ['dashboard-api.investmentTwoTrackControlStatus', 'finance-agent.analyze'],
        contextKeys: ['financeReviewStatus', 'financeReview'],
        optional: false,
      },
      {
        id: 'board_format',
        label: 'Vorstands-/Gremienformat',
        resolvedBy: ['dashboard-api.investmentTwoTrackControlStatus', 'presentation.generate'],
        contextKeys: ['boardReadiness', 'approvalFormat', 'boardFormat'],
        optional: false,
      },
      {
        id: 'source_datapoints',
        label: 'Invest-Datenpunkte / Snapshot',
        resolvedBy: [
          'dashboard-api.investmentTwoTrackControlStatus',
          'datapoint.health',
          'datasource-registry.get',
        ],
        contextKeys: ['sourceDatapoints', 'datapointIds', 'sourceSnapshotId'],
        optional: false,
      },
      {
        id: 'data_quality_plan',
        label: 'Datenqualitaets-Zielprozess',
        resolvedBy: ['dashboard-api.investmentTwoTrackControlStatus', 'vdmi.dossier'],
        contextKeys: ['dataQualityStatus', 'dataQualityPlan'],
        optional: false,
      },
      {
        id: 'target_owner',
        label: 'Zielprozess-Owner',
        resolvedBy: ['dashboard-api.investmentTwoTrackControlStatus', 'vdmi.dossier'],
        contextKeys: ['targetOwner', 'targetProcessOwner'],
        optional: false,
      },
      {
        id: 'approval_model',
        label: 'Rollen-/Freigabemodell',
        resolvedBy: ['dashboard-api.investmentTwoTrackControlStatus', 'vdmi.dossier'],
        contextKeys: ['approvalModel', 'roleApprovalModel'],
        optional: false,
      },
      {
        id: 'handover_status',
        label: 'Zielprozess-Uebergabestatus',
        resolvedBy: ['dashboard-api.investmentTwoTrackControlStatus', 'vdmi.dossier'],
        contextKeys: ['handoverStatus', 'targetProcessHandover'],
        optional: false,
      },
    ],
  },

  regulatory_change_simulator_readiness: {
    sources: [
      {
        id: 'data_contract',
        label: 'Regulatory-Change-Datenvertrag',
        resolvedBy: ['dashboard-api.regulatoryChangeReadinessStatus', 'datasource-registry.get'],
        contextKeys: ['changeId', 'effectiveDate', 'mechanismType'],
        optional: false,
      },
      {
        id: 'dictionary_version',
        label: 'Data-Dictionary-Version',
        resolvedBy: ['dashboard-api.regulatoryChangeReadinessStatus', 'datasource-registry.get'],
        contextKeys: ['dictionaryVersion'],
        optional: false,
      },
      {
        id: 'source_datapoints',
        label: 'Quell-Datapoints / Snapshot',
        resolvedBy: [
          'dashboard-api.regulatoryChangeReadinessStatus',
          'datapoint.health',
          'datapoint.validateSnapshot',
        ],
        contextKeys: ['sourceDatapoints', 'datapointIds', 'sourceSnapshotId'],
        optional: false,
      },
      {
        id: 'interval_profile_coverage',
        label: 'Viertelstundenprofil-Abdeckung',
        resolvedBy: [
          'dashboard-api.regulatoryChangeReadinessStatus',
          'edm-validation.validate',
          'mscons-import.import',
        ],
        contextKeys: ['intervalCoverage', 'quarterHourCoverage'],
        optional: false,
      },
      {
        id: 'master_data_quality',
        label: 'Stammdatenqualitaet / MaStR-NAP-MeLo',
        resolvedBy: ['dashboard-api.regulatoryChangeReadinessStatus', 'mastr-quality.audit'],
        contextKeys: ['masterDataStatus', 'masterDataQuality'],
        optional: false,
      },
      {
        id: 'substitute_value_policy',
        label: 'Ersatzwertlogik / Policy',
        resolvedBy: ['dashboard-api.regulatoryChangeReadinessStatus', 'edm-validation.validate'],
        contextKeys: ['substituteValuePolicy', 'ersatzwertPolicy'],
        optional: false,
      },
      {
        id: 'market_communication_cases',
        label: 'MaKo-Sonderfaelle / Testfaelle',
        resolvedBy: [
          'dashboard-api.regulatoryChangeReadinessStatus',
          'dashboard-api.marketCommunicationEvidenceChainStatus',
        ],
        contextKeys: ['makoCases', 'marketCommunicationCases'],
        optional: false,
      },
      {
        id: 'operator_declaration',
        label: 'Betreibererklaerung',
        resolvedBy: ['dashboard-api.regulatoryChangeReadinessStatus', 'vdmi.dossier'],
        contextKeys: ['operatorDeclarationStatus', 'operatorDeclaration'],
        optional: false,
      },
      {
        id: 'billing_rule_reference',
        label: 'Abrechnungsregel-Referenz',
        resolvedBy: ['dashboard-api.regulatoryChangeReadinessStatus', 'settlement.readiness'],
        contextKeys: ['billingRuleReference', 'billingRuleId'],
        optional: false,
      },
      {
        id: 'audit_trail',
        label: 'Audit Trail',
        resolvedBy: ['dashboard-api.regulatoryChangeReadinessStatus', 'vdmi-evidence.list'],
        contextKeys: ['auditTrailStatus', 'auditTrailId'],
        optional: false,
      },
      {
        id: 'test_case_pack',
        label: 'Drittsystem-Testfallpaket',
        resolvedBy: ['dashboard-api.regulatoryChangeReadinessStatus', 'presentation.generate'],
        contextKeys: ['testCasePackStatus', 'generatedTestCases'],
        optional: false,
      },
    ],
  },

  stadtwerk_mauer_sandbox_runtime: {
    sources: [
      {
        id: 'seeded_demo_event',
        label: 'Deterministisches Demo-Event',
        resolvedBy: [
          'dashboard-api.stadtwerkMauerSandboxRuntimeStatus',
          'stadtwerk-mauer-sandbox-runtime.ingestEvent',
        ],
        contextKeys: ['eventId', 'eventType', 'caseId'],
        optional: false,
      },
      {
        id: 'reset_delete_proof',
        label: 'Reset-/Delete-Nachweis',
        resolvedBy: [
          'dashboard-api.stadtwerkMauerSandboxRuntimeStatus',
          'stadtwerk-mauer-sandbox-runtime.reset',
        ],
        contextKeys: ['lastResetResult', 'resetDeleteReadiness'],
        optional: false,
      },
      {
        id: 'tenant_isolation_proof',
        label: 'Tenant-Isolationsnachweis',
        resolvedBy: ['dashboard-api.stadtwerkMauerSandboxRuntimeStatus'],
        contextKeys: ['tenantId', 'requiredTenantId', 'sandboxBoundaryAllowed'],
        optional: false,
      },
      {
        id: 'derived_state_inventory',
        label: 'Abgeleiteter Sandbox-State',
        resolvedBy: ['dashboard-api.stadtwerkMauerSandboxRuntimeStatus', 'object-store.query'],
        contextKeys: ['derivedStateInventory', 'artifactCount', 'eventCount'],
        optional: false,
      },
      {
        id: 'source_action_guards',
        label: 'No-Call-Guards fuer externe Aktionen',
        resolvedBy: ['dashboard-api.stadtwerkMauerSandboxRuntimeStatus'],
        contextKeys: ['sourceActions.notCalled'],
        optional: false,
      },
    ],
  },

  stadtwerk_mauer_external_interface_stubs: {
    sources: [
      {
        id: 'stub_transcript',
        label: 'Deterministisches Stub-Transkript',
        resolvedBy: [
          'dashboard-api.stadtwerkMauerExternalInterfaceStubsStatus',
          'stadtwerk-mauer-external-interface-stubs.callStub',
        ],
        contextKeys: ['recentTranscripts', 'transcriptCount', 'familyCounts', 'variantCounts'],
        optional: false,
      },
      {
        id: 'sandbox_reset_boundary',
        label: 'Reset-sichere Sandbox-Ablage',
        resolvedBy: [
          'dashboard-api.stadtwerkMauerExternalInterfaceStubsStatus',
          'stadtwerk-mauer-sandbox-runtime.reset',
        ],
        contextKeys: ['resetBoundary', 'artifactCount'],
        optional: false,
      },
      {
        id: 'tenant_isolation_proof',
        label: 'Tenant-Isolationsnachweis',
        resolvedBy: ['dashboard-api.stadtwerkMauerExternalInterfaceStubsStatus'],
        contextKeys: ['tenantId', 'requiredTenantId', 'sandboxBoundaryAllowed'],
        optional: false,
      },
      {
        id: 'source_action_guards',
        label: 'No-Call-Guards fuer externe Aktionen',
        resolvedBy: ['dashboard-api.stadtwerkMauerExternalInterfaceStubsStatus'],
        contextKeys: ['sourceActions.notCalled'],
        optional: false,
      },
      {
        id: 'positive_follow_ups',
        label: 'Positive Follow-ups fuer fehlende Stub-Evidenz',
        resolvedBy: ['dashboard-api.stadtwerkMauerExternalInterfaceStubsStatus'],
        contextKeys: ['missingEvidence', 'positiveFollowUps'],
        optional: false,
      },
    ],
  },

  stadtwerk_mauer_mastr_data_overlay: {
    sources: [
      {
        id: 'real_mastr_baseline',
        label: 'Realer MaStR-Anlagenbestand Mauer',
        resolvedBy: [
          'dashboard-api.stadtwerkMauerMastrDataOverlayStatus',
          'stadtwerk-mauer-mastr-data-overlay.getStatus',
          'energy-market.installations',
        ],
        contextKeys: ['assetCount', 'sampleAssets', 'mastrQuery', 'typeCounts'],
        optional: false,
      },
      {
        id: 'original_operator_provenance',
        label: 'Originale Netzbetreiber-Provenienz',
        resolvedBy: ['dashboard-api.stadtwerkMauerMastrDataOverlayStatus'],
        contextKeys: ['originalGridOperators', 'operatorOverlay.realWorldOperatorHint'],
        optional: false,
      },
      {
        id: 'virtual_operator_overlay',
        label: 'Virtuelles Stadtwerk-Mauer-Betreiberoverlay',
        resolvedBy: ['dashboard-api.stadtwerkMauerMastrDataOverlayStatus'],
        contextKeys: ['operatorOverlay.virtualGridOperator', 'operatorOverlay.mode'],
        optional: false,
      },
      {
        id: 'mastr_non_mutation_guard',
        label: 'MaStR-Nichtveraenderungsnachweis',
        resolvedBy: ['dashboard-api.stadtwerkMauerMastrDataOverlayStatus'],
        contextKeys: [
          'operatorOverlay.preservesOriginalMastrFacts',
          'operatorOverlay.mutatesMastrRecords',
          'sourceActions.notCalled',
        ],
        optional: false,
      },
      {
        id: 'reset_boundary',
        label: 'Reset-Grenze ohne MaStR-Baseline-Loeschung',
        resolvedBy: ['dashboard-api.stadtwerkMauerMastrDataOverlayStatus'],
        contextKeys: [
          'resetBoundary.deletesImportedMastrBaseline',
          'resetBoundary.deletesDerivedSandboxArtifacts',
        ],
        optional: false,
      },
    ],
  },

  stadtwerk_mauer_e2e_process_demo: {
    sources: [
      {
        id: 'e2e_demo_trace',
        label: 'Deterministische E2E-Prozessspur',
        resolvedBy: [
          'dashboard-api.stadtwerkMauerE2eProcessDemoStatus',
          'stadtwerk-mauer-e2e-process-demo.runDemo',
        ],
        contextKeys: ['recentTraces', 'traceCount', 'caseId', 'demoPath'],
        optional: false,
      },
      {
        id: 'role_capability_routing',
        label: 'VDMI-Rollen- und Capability-Spur',
        resolvedBy: ['dashboard-api.stadtwerkMauerE2eProcessDemoStatus'],
        contextKeys: ['rolesAndCapabilities'],
        optional: false,
      },
      {
        id: 'stub_transcript_summary',
        label: 'Stub-Transkript-Zusammenfassung',
        resolvedBy: [
          'dashboard-api.stadtwerkMauerE2eProcessDemoStatus',
          'stadtwerk-mauer-external-interface-stubs.callStub',
        ],
        contextKeys: ['recentTraces.transcriptId', 'sourceActions.referenced'],
        optional: false,
      },
      {
        id: 'missing_evidence_followups',
        label: 'Fehlende Evidenz und positive Follow-ups',
        resolvedBy: ['dashboard-api.stadtwerkMauerE2eProcessDemoStatus'],
        contextKeys: ['missingEvidence', 'positiveFollowUps'],
        optional: false,
      },
      {
        id: 'reset_cleanup_boundary',
        label: 'Reset-sichere Cleanup-Grenze',
        resolvedBy: [
          'dashboard-api.stadtwerkMauerE2eProcessDemoStatus',
          'stadtwerk-mauer-sandbox-runtime.reset',
        ],
        contextKeys: ['resetBoundary', 'artifactCount'],
        optional: false,
      },
      {
        id: 'source_action_guards',
        label: 'No-Call-Guards fuer echte Aktionen',
        resolvedBy: ['dashboard-api.stadtwerkMauerE2eProcessDemoStatus'],
        contextKeys: ['sourceActions.notCalled'],
        optional: false,
      },
    ],
  },

  e2e_controllability_check_governance: {
    sources: [
      {
        id: 'connection_intake',
        label: 'Netzanschluss-/Asset-Identifikation',
        resolvedBy: [
          'dashboard-api.e2eControllabilityGovernanceStatus',
          'grid-connection.validate',
          'assets.effective',
        ],
        contextKeys: ['connectionIntake', 'gridConnectionId', 'assetId'],
        optional: false,
      },
      {
        id: 'metering_concept',
        label: 'Mess-/TAF-/EDM-Konzept',
        resolvedBy: [
          'dashboard-api.e2eControllabilityGovernanceStatus',
          'edm-messkonzept.evaluate',
          'edm-validation.validate',
        ],
        contextKeys: ['meteringConcept', 'tafReadiness', 'edmValidationId'],
        optional: false,
      },
      {
        id: 'asset_control_capability',
        label: 'Asset-Steuerbarkeitsnachweis',
        resolvedBy: [
          'dashboard-api.e2eControllabilityGovernanceStatus',
          'grid-operations.controlMeasures',
        ],
        contextKeys: ['assetControlCapability', 'controlCapabilityEvidence'],
        optional: false,
      },
      {
        id: 'grid_operations_decision',
        label: 'Netzbetrieb/Redispatch-/§14a-Entscheidung',
        resolvedBy: [
          'dashboard-api.e2eControllabilityGovernanceStatus',
          'grid-operations.netzfahrplanGenerate',
        ],
        contextKeys: ['gridOperationsDecision', 'redispatchReadiness', 'section14aReadiness'],
        optional: false,
      },
      {
        id: 'market_communication_handover',
        label: 'Marktkommunikations-Abgabe',
        resolvedBy: [
          'dashboard-api.e2eControllabilityGovernanceStatus',
          'dashboard-api.marketCommunicationEvidenceChainStatus',
        ],
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
        resolvedBy: [
          'dashboard-api.e2eControllabilityGovernanceStatus',
          'vdmi.dossier',
          'hitl.summary',
        ],
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
        resolvedBy: [
          'dashboard-api.controllabilityAssetHandoverStatus',
          'assets.effective',
          'mastr-quality.audit',
        ],
        contextKeys: ['assetId', 'mastrId'],
        optional: false,
      },
      {
        id: 'nap_melo_mapping',
        label: 'NAP-/MeLo-Zuordnung',
        resolvedBy: [
          'dashboard-api.controllabilityAssetHandoverStatus',
          'assets.effective',
          'mastr-quality.audit',
        ],
        contextKeys: ['napId', 'meloId'],
        optional: false,
      },
      {
        id: 'technical_status',
        label: 'Technikstatus',
        resolvedBy: [
          'dashboard-api.controllabilityAssetHandoverStatus',
          'assets.effective',
          'redispatch-expost.audit',
        ],
        contextKeys: ['technicalStatus'],
        optional: false,
      },
      {
        id: 'feedback_capability',
        label: 'Rueckmelde-/Fernsteuerbarkeitsfaehigkeit',
        resolvedBy: [
          'dashboard-api.controllabilityAssetHandoverStatus',
          'redispatch-expost.audit',
          'grid-operations.controlMeasures',
        ],
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
        resolvedBy: [
          'dashboard-api.controllabilityAssetHandoverStatus',
          'datapoint.health',
          'datasource-registry.get',
        ],
        contextKeys: ['dataSourceRefs', 'sourceSnapshotId'],
        optional: false,
      },
      {
        id: 'check_result',
        label: 'Pruefergebnis',
        resolvedBy: [
          'dashboard-api.controllabilityAssetHandoverStatus',
          'mastr-quality.audit',
          'redispatch-expost.audit',
        ],
        contextKeys: ['checkStatus', 'evidenceStatus'],
        optional: false,
      },
      {
        id: 'non_execution_reason',
        label: 'Nichtdurchfuehrungsbegruendung',
        resolvedBy: [
          'dashboard-api.controllabilityAssetHandoverStatus',
          'vdmi.dossier',
          'interface-placeholder.requestEvidence',
        ],
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

  liquidity_planning_governance_module: {
    sources: [
      {
        id: 'source_register',
        label: 'Quellenregister Finance',
        resolvedBy: ['dashboard-api.liquidityPlanningGovernanceStatus', 'datasource-registry.get'],
        contextKeys: ['sourceRegister'],
        optional: false,
      },
      {
        id: 'dictionary_version',
        label: 'Dictionary-/Versionsnachweis',
        resolvedBy: [
          'dashboard-api.liquidityPlanningGovernanceStatus',
          'datasource-registry.check',
        ],
        contextKeys: ['dictionaryVersion'],
        optional: false,
      },
      {
        id: 'sap_account_mapping',
        label: 'SAP-Sachkontoquellen',
        resolvedBy: ['dashboard-api.liquidityPlanningGovernanceStatus', 'datapoint.health'],
        contextKeys: ['sapAccountSources'],
        optional: false,
      },
      {
        id: 'controlling_source',
        label: 'Controlling-Quellen',
        resolvedBy: ['dashboard-api.liquidityPlanningGovernanceStatus', 'datapoint.health'],
        contextKeys: ['controllingSourceIds'],
        optional: false,
      },
      {
        id: 'loan_tms_source',
        label: 'Darlehens-/TMS-Quellen',
        resolvedBy: ['dashboard-api.liquidityPlanningGovernanceStatus', 'datapoint.health'],
        contextKeys: ['loanTmsSourceIds'],
        optional: false,
      },
      {
        id: 'vat_logic_reference',
        label: 'Umsatzsteuerlogik-Referenz',
        resolvedBy: ['dashboard-api.liquidityPlanningGovernanceStatus', 'vdmi.dossier'],
        contextKeys: ['vatLogicRef'],
        optional: false,
      },
      {
        id: 'cash_pool_logic',
        label: 'Cash-Pool-Logiknachweis',
        resolvedBy: ['dashboard-api.liquidityPlanningGovernanceStatus', 'vdmi.dossier'],
        contextKeys: ['cashPoolSettlementRef'],
        optional: false,
      },
      {
        id: 'scenario_assumption',
        label: 'Szenarioannahmen',
        resolvedBy: ['dashboard-api.liquidityPlanningGovernanceStatus', 'finance-agent.analyze'],
        contextKeys: ['scenarioAssumptions'],
        optional: false,
      },
      {
        id: 'validation_rule',
        label: 'Validierungsregeln',
        resolvedBy: [
          'dashboard-api.liquidityPlanningGovernanceStatus',
          'datasource-registry.check',
        ],
        contextKeys: ['validationRules', 'plausibilityChecks'],
        optional: false,
      },
      {
        id: 'correction_owner',
        label: 'Korrektur-Owner/-Workflow',
        resolvedBy: [
          'dashboard-api.liquidityPlanningGovernanceStatus',
          'vdmi.dossier',
          'interface-placeholder.requestEvidence',
        ],
        contextKeys: ['ownerRaci', 'correctionWorkflow'],
        optional: false,
      },
      {
        id: 'approval_status',
        label: 'Review-/Freigabestatus als Evidenz',
        resolvedBy: ['dashboard-api.liquidityPlanningGovernanceStatus', 'vdmi.dossier'],
        contextKeys: ['approvalStatus'],
        optional: false,
      },
    ],
  },

  energy_sharing_simulation_gate: {
    sources: [
      {
        id: 'project_identity',
        label: 'Energy-Sharing Community und VNB-Kontext',
        resolvedBy: [
          'dashboard-api.energySharingSimulationGateStatus',
          'energy-sharing.validate',
          'grid-connection.validate',
        ],
        contextKeys: ['communityId', 'gridOperatorId'],
        optional: false,
      },
      {
        id: 'participant_dataset',
        label: 'Teilnehmerliste und Teilnehmerevidenz',
        resolvedBy: ['dashboard-api.energySharingSimulationGateStatus', 'energy-sharing.validate'],
        contextKeys: ['participantCount', 'participantEvidenceRef'],
        optional: false,
      },
      {
        id: 'malo_metering_readiness',
        label: 'MaLo-/iMSys-/MSCONS-Reife',
        resolvedBy: [
          'dashboard-api.energySharingSimulationGateStatus',
          'datapoint.health',
          'edm-validation.validate',
        ],
        contextKeys: ['maloStatus', 'meteringReadiness'],
        optional: false,
      },
      {
        id: 'market_role_readiness',
        label: 'Marktrollen- und Bilanzkreisreife',
        resolvedBy: ['dashboard-api.energySharingSimulationGateStatus', 'vdmi.dossier'],
        contextKeys: ['marketRoleReadiness'],
        optional: false,
      },
      {
        id: 'data_basis',
        label: 'Datenbasis fuer Lernpilot oder abrechnungsnahe Bewertung',
        resolvedBy: [
          'dashboard-api.energySharingSimulationGateStatus',
          'energy-sharing-allocation.allocate',
        ],
        contextKeys: ['dataBasis'],
        optional: false,
      },
      {
        id: 'settlement_a96_evidence',
        label: 'Settlement-/A96-Evidenz',
        resolvedBy: [
          'dashboard-api.energySharingSimulationGateStatus',
          'settlement.prepareA96',
          'settlement.reconcileA96',
        ],
        contextKeys: ['a96EvidenceRef', 'settlementEvidenceRef'],
        optional: false,
      },
      {
        id: 'contract_evidence',
        label: 'Liefer-/Teilnahmevertrags-Evidenz',
        resolvedBy: [
          'dashboard-api.energySharingSimulationGateStatus',
          'vdmi.dossier',
          'interface-placeholder.requestEvidence',
        ],
        contextKeys: ['contractEvidenceRef'],
        optional: false,
      },
      {
        id: 'economics_assumption',
        label: 'Wirtschaftlichkeitsannahmen',
        resolvedBy: ['dashboard-api.energySharingSimulationGateStatus', 'vdmi.dossier'],
        contextKeys: ['economicsAssumptionRef'],
        optional: false,
      },
      {
        id: 'owner_escalation',
        label: 'Owner und Eskalationskontakt',
        resolvedBy: [
          'dashboard-api.energySharingSimulationGateStatus',
          'vdmi.dossier',
          'interface-placeholder.requestEvidence',
        ],
        contextKeys: ['owner', 'escalationContact'],
        optional: false,
      },
    ],
  },

  energy_sharing_42c_cutover_readiness: {
    sources: [
      {
        id: 'a96_defaults_spec_freeze',
        label: 'A96-Defaults und Spec-Freeze-Evidenz',
        resolvedBy: ['dashboard-api.energySharing42cCutoverReadinessStatus', 'vdmi.dossier'],
        contextKeys: ['a96DefaultsStatus', 'specFreezeStatus'],
        optional: false,
      },
      {
        id: 'pilot_tenant_balance_group',
        label: 'Pilot-Tenant und Bilanzkreis-Bereitschaft',
        resolvedBy: ['dashboard-api.energySharing42cCutoverReadinessStatus', 'vdmi.dossier'],
        contextKeys: ['pilotTenantId', 'balanceGroupId', 'pilotTenantStatus'],
        optional: false,
      },
      {
        id: 'settlement_readiness_hardening',
        label: 'Settlement-Readiness-Härtung',
        resolvedBy: [
          'dashboard-api.energySharing42cCutoverReadinessStatus',
          'settlement.prepareA96',
        ],
        contextKeys: ['settlementHardeningStatus'],
        optional: false,
      },
      {
        id: 'allocation_load_test',
        label: 'Allokations-Lasttest-Evidenz',
        resolvedBy: [
          'dashboard-api.energySharing42cCutoverReadinessStatus',
          'energy-sharing-allocation.allocate',
        ],
        contextKeys: ['allocationLoadTestStatus'],
        optional: false,
      },
      {
        id: 'incident_runbook',
        label: 'Runbook- und Incident-Evidenz',
        resolvedBy: [
          'dashboard-api.energySharing42cCutoverReadinessStatus',
          'interface-placeholder.requestEvidence',
        ],
        contextKeys: ['runbookStatus'],
        optional: false,
      },
      {
        id: 'compliance_signoff_evidence',
        label: 'Compliance-/Sign-off-Evidenz',
        resolvedBy: ['dashboard-api.energySharing42cCutoverReadinessStatus', 'vdmi.dossier'],
        contextKeys: ['complianceSignoffStatus'],
        optional: false,
      },
      {
        id: 'rollback_dr_readiness',
        label: 'Rollback-/DR-Readiness-Evidenz',
        resolvedBy: ['dashboard-api.energySharing42cCutoverReadinessStatus', 'backup.restore'],
        contextKeys: ['rollbackPlanStatus'],
        optional: false,
      },
    ],
  },

  evu_api_migration_diagnostics: {
    sources: [
      {
        id: 'business_process',
        label: 'EVU/VNB-Geschaeftsprozess',
        resolvedBy: ['dashboard-api.evuApiMigrationDiagnosticsStatus', 'vdmi.dossier'],
        contextKeys: ['businessProcess'],
        optional: false,
      },
      {
        id: 'endpoint_method',
        label: 'Endpoint und HTTP-Methode',
        resolvedBy: [
          'dashboard-api.evuApiMigrationDiagnosticsStatus',
          'interface-placeholder.requestEvidence',
        ],
        contextKeys: ['endpoint', 'method'],
        optional: false,
      },
      {
        id: 'auth_scope',
        label: 'OAuth-/Auth-Scope',
        resolvedBy: ['dashboard-api.evuApiMigrationDiagnosticsStatus'],
        contextKeys: ['authScope'],
        optional: false,
      },
      {
        id: 'data_context',
        label: 'Daten- und Marktrollenkontext',
        resolvedBy: ['dashboard-api.evuApiMigrationDiagnosticsStatus', 'vdmi.dossier'],
        contextKeys: ['dataContext'],
        optional: false,
      },
      {
        id: 'request_shape',
        label: 'Request-Shape / Schema-Hinweis',
        resolvedBy: ['dashboard-api.evuApiMigrationDiagnosticsStatus'],
        contextKeys: ['requestShape'],
        optional: false,
      },
      {
        id: 'failure_signal',
        label: 'Validierungsfehler und Response-Code',
        resolvedBy: ['dashboard-api.evuApiMigrationDiagnosticsStatus'],
        contextKeys: ['validationError', 'responseCode'],
        optional: false,
      },
      {
        id: 'completion_criterion',
        label: 'Abschlusskriterium',
        resolvedBy: ['dashboard-api.evuApiMigrationDiagnosticsStatus', 'vdmi.dossier'],
        contextKeys: ['completionCriterion'],
        optional: false,
      },
      {
        id: 'owner_next_step',
        label: 'Owner und naechster Schritt',
        resolvedBy: [
          'dashboard-api.evuApiMigrationDiagnosticsStatus',
          'interface-placeholder.requestEvidence',
        ],
        contextKeys: ['owner', 'nextStep'],
        optional: false,
      },
    ],
  },

  nova_decision_lifecycle_readiness: {
    sources: [
      {
        id: 'decision_lifecycle_model',
        label: 'NOVA Decision-Lifecycle-Modell',
        resolvedBy: ['dashboard-api.novaDecisionLifecycleReadinessStatus', 'vdmi.dossier'],
        contextKeys: ['lifecycleModel'],
        optional: false,
      },
      {
        id: 'decision_source_catalogue',
        label: 'NOVA Decision-Quellenkatalog',
        resolvedBy: [
          'dashboard-api.novaDecisionLifecycleReadinessStatus',
          'mastr-quality.audit',
          'redispatch-expost.audit',
          'vnb-monitor',
        ],
        contextKeys: ['sourceCatalogue', 'decisionKind'],
        optional: false,
      },
      {
        id: 'transition_audit_history',
        label: 'Transition Audit-/History-Evidenz',
        resolvedBy: ['dashboard-api.novaDecisionLifecycleReadinessStatus', 'vdmi.dossier'],
        contextKeys: ['auditTrail'],
        optional: false,
      },
      {
        id: 'tenant_isolated_sse_evidence',
        label: 'Tenant-isolierte SSE-Evidenz',
        resolvedBy: ['dashboard-api.novaDecisionLifecycleReadinessStatus'],
        contextKeys: ['tenantIsolationEvidence'],
        optional: false,
      },
      {
        id: 'hitl_bridge_policy',
        label: 'HITL-Bridge-Policy-Evidenz',
        resolvedBy: ['dashboard-api.novaDecisionLifecycleReadinessStatus', 'hitl.summary'],
        contextKeys: ['hitlPolicyEvidence'],
        optional: false,
      },
      {
        id: 'replay_testability',
        label: 'Replay-/Testability-Evidenz',
        resolvedBy: ['dashboard-api.novaDecisionLifecycleReadinessStatus'],
        contextKeys: ['replayEvidence'],
        optional: false,
      },
      {
        id: 'expiry_non_execution',
        label: 'Expiry- und Non-Execution-Evidenz',
        resolvedBy: ['dashboard-api.novaDecisionLifecycleReadinessStatus', 'vdmi.dossier'],
        contextKeys: ['expiryEvidence'],
        optional: false,
      },
    ],
  },

  legal_clarification_operating_model: {
    sources: [
      {
        id: 'clarification_point',
        label: 'Rechtsklaerungspunkt',
        resolvedBy: ['dashboard-api.legalClarificationOperatingModelStatus', 'vdmi.dossier'],
        contextKeys: ['clarificationPoint'],
        optional: false,
      },
      {
        id: 'affected_decision',
        label: 'Betroffene operative Entscheidung',
        resolvedBy: [
          'dashboard-api.legalClarificationOperatingModelStatus',
          'grid-operations.netzfahrplanGenerate',
          'grid-connection.fnavValidate',
        ],
        contextKeys: ['affectedDecision'],
        optional: false,
      },
      {
        id: 'legal_status',
        label: 'Legal Status / Rechtsantwort',
        resolvedBy: ['dashboard-api.legalClarificationOperatingModelStatus', 'vdmi.dossier'],
        contextKeys: ['legalStatus'],
        optional: false,
      },
      {
        id: 'no_regret_data_needs',
        label: 'No-Regret-Datenbedarf',
        resolvedBy: [
          'dashboard-api.legalClarificationOperatingModelStatus',
          'interface-placeholder.requestEvidence',
        ],
        contextKeys: ['noRegretDataNeeds'],
        optional: false,
      },
      {
        id: 'role_owner',
        label: 'Rollenmodell / Owner',
        resolvedBy: ['dashboard-api.legalClarificationOperatingModelStatus', 'vdmi.dossier'],
        contextKeys: ['owner', 'ownerContact'],
        optional: false,
      },
      {
        id: 'scenario_options',
        label: 'Szenario-Optionen',
        resolvedBy: ['dashboard-api.legalClarificationOperatingModelStatus', 'znp.addAssumption'],
        contextKeys: ['scenarioOptions'],
        optional: false,
      },
      {
        id: 'red_lines',
        label: 'Rote Linien / Umsetzungsgrenzen',
        resolvedBy: ['dashboard-api.legalClarificationOperatingModelStatus', 'vdmi.dossier'],
        contextKeys: ['redLines'],
        optional: false,
      },
      {
        id: 'implementation_status',
        label: 'Umsetzungsstatus nach Rechtsantwort',
        resolvedBy: ['dashboard-api.legalClarificationOperatingModelStatus', 'vdmi.dossier'],
        contextKeys: ['implementationStatus', 'decisionReadiness'],
        optional: false,
      },
    ],
  },

  special_grid_usage_impact_map: {
    sources: [
      {
        id: 'application_status',
        label: 'Antrags-/Intake-Nachweis',
        resolvedBy: [
          'dashboard-api.specialGridUsageImpactMapStatus',
          'datapoint.health',
          'datasource-registry.get',
        ],
        contextKeys: ['applicationStatus', 'caseId'],
        optional: false,
      },
      {
        id: 'form_status',
        label: 'Formularvollstaendigkeit',
        resolvedBy: ['dashboard-api.specialGridUsageImpactMapStatus', 'datasource-registry.get'],
        contextKeys: ['formStatus'],
        optional: false,
      },
      {
        id: 'deadline_status',
        label: 'Friststatus',
        resolvedBy: ['dashboard-api.specialGridUsageImpactMapStatus', 'vdmi.dossier'],
        contextKeys: ['deadlineStatus'],
        optional: false,
      },
      {
        id: 'quantity_basis',
        label: 'Mengenbasis',
        resolvedBy: [
          'dashboard-api.specialGridUsageImpactMapStatus',
          'datapoint.health',
          'datasource-registry.get',
        ],
        contextKeys: ['quantityBasis', 'sourceDatapoints'],
        optional: false,
      },
      {
        id: 'calculation_logic_ref',
        label: 'Berechnungs-/Rechtsreview-Referenz',
        resolvedBy: ['dashboard-api.specialGridUsageImpactMapStatus', 'finance-agent.analyze'],
        contextKeys: ['calculationLogicRef', 'regulatoryUncertainty'],
        optional: false,
      },
      {
        id: 'billing_impact',
        label: 'Abrechnungswirkung',
        resolvedBy: ['dashboard-api.specialGridUsageImpactMapStatus', 'settlement.readiness'],
        contextKeys: ['billingImpact'],
        optional: false,
      },
      {
        id: 'eog_impact',
        label: 'EOG-/Netzentgeltwirkung',
        resolvedBy: ['dashboard-api.specialGridUsageImpactMapStatus', 'eog-calculator.scenario'],
        contextKeys: ['eogImpact'],
        optional: false,
      },
      {
        id: 'tariff_impact',
        label: 'Tarifwirkungsreferenz',
        resolvedBy: ['dashboard-api.specialGridUsageImpactMapStatus', 'finance-agent.analyze'],
        contextKeys: ['tariffImpact'],
        optional: false,
      },
      {
        id: 'communication_status',
        label: 'Kundenkommunikationsstatus',
        resolvedBy: ['dashboard-api.specialGridUsageImpactMapStatus', 'customer-service.get'],
        contextKeys: ['communicationStatus'],
        optional: false,
      },
      {
        id: 'owner_role',
        label: 'Owner / naechste Rolle',
        resolvedBy: [
          'dashboard-api.specialGridUsageImpactMapStatus',
          'vdmi.dossier',
          'interface-placeholder.requestEvidence',
        ],
        contextKeys: ['ownerRole'],
        optional: false,
      },
    ],
  },

  dr_readiness_evidence_gate: {
    sources: [
      {
        id: 'store_inventory',
        label: 'Store-Inventar',
        resolvedBy: ['dashboard-api.drReadinessEvidenceStatus', 'datapoint.health'],
        contextKeys: ['storeInventoryStatus'],
        optional: false,
      },
      {
        id: 'snapshot_manifest',
        label: 'Snapshot-Manifest',
        resolvedBy: ['dashboard-api.drReadinessEvidenceStatus', 'vdmi.dossier'],
        contextKeys: ['snapshotManifestStatus'],
        optional: false,
      },
      {
        id: 'restore_drill',
        label: 'Restore-Drill-Nachweis',
        resolvedBy: ['dashboard-api.drReadinessEvidenceStatus', 'audit.report'],
        contextKeys: ['restoreDrillStatus', 'lastDrillDate'],
        optional: false,
      },
      {
        id: 'rto_target',
        label: 'RTO-Ziel',
        resolvedBy: ['dashboard-api.drReadinessEvidenceStatus', 'deployment.runbook'],
        contextKeys: ['rtoTarget'],
        optional: false,
      },
      {
        id: 'rpo_target',
        label: 'RPO-Ziel',
        resolvedBy: ['dashboard-api.drReadinessEvidenceStatus', 'deployment.runbook'],
        contextKeys: ['rpoTarget'],
        optional: false,
      },
      {
        id: 'per_tenant_restore',
        label: 'Per-Tenant-Restore-Nachweis',
        resolvedBy: ['dashboard-api.drReadinessEvidenceStatus', 'vdmi.dossier'],
        contextKeys: ['perTenantRestoreStatus'],
        optional: false,
      },
      {
        id: 'owner',
        label: 'DR Owner',
        resolvedBy: [
          'dashboard-api.drReadinessEvidenceStatus',
          'interface-placeholder.requestEvidence',
        ],
        contextKeys: ['owner'],
        optional: false,
      },
      {
        id: 'next_drill_due',
        label: 'Naechster DR-Drill',
        resolvedBy: ['dashboard-api.drReadinessEvidenceStatus', 'deployment.runbook'],
        contextKeys: ['nextDrillDue'],
        optional: false,
      },
    ],
  },

  cls_digital_twin_compliance_gate: {
    sources: [
      {
        id: 'system_purpose',
        label: 'Systemzweck',
        resolvedBy: ['dashboard-api.clsDigitalTwinComplianceGateStatus', 'vdmi.dossier'],
        contextKeys: ['systemPurpose'],
        optional: false,
      },
      {
        id: 'digital_twin_scope',
        label: 'Digital-Twin-Scope',
        resolvedBy: ['dashboard-api.clsDigitalTwinComplianceGateStatus', 'datasource-registry.get'],
        contextKeys: ['digitalTwinScope'],
        optional: false,
      },
      {
        id: 'cls_interface_scope',
        label: 'CLS-Schnittstellenumfang',
        resolvedBy: [
          'dashboard-api.clsDigitalTwinComplianceGateStatus',
          'interface-placeholder.requestEvidence',
        ],
        contextKeys: ['clsInterfaceScope'],
        optional: false,
      },
      {
        id: 'data_flow_map',
        label: 'Datenflusskarte',
        resolvedBy: [
          'dashboard-api.clsDigitalTwinComplianceGateStatus',
          'datasource-registry.get',
          'datapoint.health',
        ],
        contextKeys: ['dataFlowMap'],
        optional: false,
      },
      {
        id: 'personal_data_categories',
        label: 'Personenbezogene Datenarten',
        resolvedBy: ['dashboard-api.clsDigitalTwinComplianceGateStatus', 'vdmi.dossier'],
        contextKeys: ['personalDataCategories'],
        optional: false,
      },
      {
        id: 'roles_access_rights',
        label: 'Rollen- und Zugriffsrechte',
        resolvedBy: ['dashboard-api.clsDigitalTwinComplianceGateStatus', 'vdmi.dossier'],
        contextKeys: ['rolesAccessRights'],
        optional: false,
      },
      {
        id: 'rbac_refs',
        label: 'RBAC-Nachweise',
        resolvedBy: ['dashboard-api.clsDigitalTwinComplianceGateStatus', 'vdmi.dossier'],
        contextKeys: ['rbacRefs'],
        optional: false,
      },
      {
        id: 'avv_status',
        label: 'AVV-Status',
        resolvedBy: [
          'dashboard-api.clsDigitalTwinComplianceGateStatus',
          'interface-placeholder.requestEvidence',
        ],
        contextKeys: ['avvStatus'],
        optional: false,
      },
      {
        id: 'nda_status',
        label: 'NDA-Status',
        resolvedBy: [
          'dashboard-api.clsDigitalTwinComplianceGateStatus',
          'interface-placeholder.requestEvidence',
        ],
        contextKeys: ['ndaStatus'],
        optional: false,
      },
      {
        id: 'works_council_status',
        label: 'Betriebsvereinbarung/BR-Status',
        resolvedBy: [
          'dashboard-api.clsDigitalTwinComplianceGateStatus',
          'interface-placeholder.requestEvidence',
        ],
        contextKeys: ['worksCouncilStatus'],
        optional: false,
      },
      {
        id: 'dsfa_status',
        label: 'DSFA-Status',
        resolvedBy: [
          'dashboard-api.clsDigitalTwinComplianceGateStatus',
          'interface-placeholder.requestEvidence',
        ],
        contextKeys: ['dsfaStatus'],
        optional: false,
      },
      {
        id: 'billing_module_impact',
        label: 'Abrechnungs-/Modulwirkung',
        resolvedBy: ['dashboard-api.clsDigitalTwinComplianceGateStatus', 'finance-agent.analyze'],
        contextKeys: ['billingModuleImpact'],
        optional: false,
      },
      {
        id: 'regulatory_evidence_status',
        label: 'Regulatorischer Nachweisstatus',
        resolvedBy: ['dashboard-api.clsDigitalTwinComplianceGateStatus', 'vdmi.dossier'],
        contextKeys: ['regulatoryEvidenceStatus'],
        optional: false,
      },
      {
        id: 'security_evidence_refs',
        label: 'Security-Nachweise',
        resolvedBy: ['dashboard-api.clsDigitalTwinComplianceGateStatus', 'vdmi-evidence.inject'],
        contextKeys: ['securityEvidenceRefs'],
        optional: false,
      },
      {
        id: 'source_evidence_refs',
        label: 'Quellenreferenzen',
        resolvedBy: ['dashboard-api.clsDigitalTwinComplianceGateStatus', 'vdmi-evidence.inject'],
        contextKeys: ['sourceEvidenceRefs'],
        optional: false,
      },
    ],
  },

  legacy_control_technology_transition: {
    sources: [
      {
        id: 'asset_group_or_asset',
        label: 'Assetgruppe oder Einzelasset',
        resolvedBy: ['dashboard-api.legacyControlTechnologyTransitionStatus', 'assets.effective'],
        contextKeys: ['assetGroupId', 'assetId'],
        optional: false,
      },
      {
        id: 'power_class',
        label: 'Leistungsklasse',
        resolvedBy: ['dashboard-api.legacyControlTechnologyTransitionStatus', 'assets.effective'],
        contextKeys: ['powerClass'],
        optional: false,
      },
      {
        id: 'control_technology',
        label: 'Bestands-Steuertechnik',
        resolvedBy: [
          'dashboard-api.legacyControlTechnologyTransitionStatus',
          'grid-operations.controlMeasures',
        ],
        contextKeys: ['controlTechnology'],
        optional: false,
      },
      {
        id: 'feedback_capability',
        label: 'Rueckmeldefaehigkeit',
        resolvedBy: [
          'dashboard-api.legacyControlTechnologyTransitionStatus',
          'edm-messkonzept.evaluate',
        ],
        contextKeys: ['feedbackCapability'],
        optional: false,
      },
      {
        id: 'switching_risk',
        label: 'Schaltrisiko',
        resolvedBy: [
          'dashboard-api.legacyControlTechnologyTransitionStatus',
          'grid-operations.controlMeasures',
        ],
        contextKeys: ['switchingRisk'],
        optional: false,
      },
      {
        id: 'test_feasibility',
        label: 'Testbarkeit',
        resolvedBy: [
          'dashboard-api.legacyControlTechnologyTransitionStatus',
          'interface-placeholder.requestEvidence',
        ],
        contextKeys: ['testFeasibility'],
        optional: false,
      },
      {
        id: 'test_status',
        label: 'Teststatus',
        resolvedBy: ['dashboard-api.legacyControlTechnologyTransitionStatus', 'datapoint.health'],
        contextKeys: ['testStatus'],
        optional: false,
      },
      {
        id: 'non_execution_reason',
        label: 'Nichtdurchfuehrungsbegruendung',
        resolvedBy: ['dashboard-api.legacyControlTechnologyTransitionStatus', 'vdmi.dossier'],
        contextKeys: ['nonExecutionReason'],
        optional: false,
      },
      {
        id: 'target_technology',
        label: 'Zieltechnologie',
        resolvedBy: ['dashboard-api.legacyControlTechnologyTransitionStatus', 'vdmi.dossier'],
        contextKeys: ['targetTechnology'],
        optional: false,
      },
      {
        id: 'migration_roadmap',
        label: 'Migrationsroadmap',
        resolvedBy: ['dashboard-api.legacyControlTechnologyTransitionStatus', 'vdmi.dossier'],
        contextKeys: ['migrationRoadmap'],
        optional: false,
      },
      {
        id: 'owner_next_action',
        label: 'Owner und naechster Schritt',
        resolvedBy: ['dashboard-api.legacyControlTechnologyTransitionStatus', 'vdmi.dossier'],
        contextKeys: ['owner', 'nextAction'],
        optional: false,
      },
      {
        id: 'source_evidence_refs',
        label: 'Quellenreferenzen',
        resolvedBy: [
          'dashboard-api.legacyControlTechnologyTransitionStatus',
          'vdmi-evidence.inject',
        ],
        contextKeys: ['sourceEvidenceRefs'],
        optional: false,
      },
    ],
  },

  controllability_submission_cockpit: {
    sources: [
      {
        id: 'submission_identity',
        label: 'Abgabeprojekt',
        resolvedBy: ['dashboard-api.controllabilitySubmissionCockpitStatus', 'vdmi.dossier'],
        contextKeys: ['submissionId'],
        optional: false,
      },
      {
        id: 'submission_deadline',
        label: 'Abgabefrist',
        resolvedBy: ['dashboard-api.controllabilitySubmissionCockpitStatus', 'vdmi.dossier'],
        contextKeys: ['submissionDeadline'],
        optional: false,
      },
      {
        id: 'coordinator',
        label: 'Koordinator',
        resolvedBy: ['dashboard-api.controllabilitySubmissionCockpitStatus', 'vdmi.dossier'],
        contextKeys: ['coordinator'],
        optional: false,
      },
      {
        id: 'source_list',
        label: 'Quellenliste',
        resolvedBy: [
          'dashboard-api.controllabilitySubmissionCockpitStatus',
          'datapoint.health',
          'edm-validation.validate',
        ],
        contextKeys: ['sourceList'],
        optional: false,
      },
      {
        id: 'data_reconciliation_status',
        label: 'Datenabgleich',
        resolvedBy: [
          'dashboard-api.controllabilitySubmissionCockpitStatus',
          'edm-validation.validate',
        ],
        contextKeys: ['dataReconciliationStatus'],
        optional: false,
      },
      {
        id: 'reason_catalog',
        label: 'Begruendungskatalog',
        resolvedBy: [
          'dashboard-api.controllabilitySubmissionCockpitStatus',
          'vdmi.findings',
          'interface-placeholder.requestEvidence',
        ],
        contextKeys: ['reasonCatalog'],
        optional: false,
      },
      {
        id: 'asset_group_statuses',
        label: 'Assetgruppenstatus',
        resolvedBy: [
          'dashboard-api.controllabilitySubmissionCockpitStatus',
          'grid-operations.controlMeasures',
        ],
        contextKeys: ['assetGroupStatuses'],
        optional: false,
      },
      {
        id: 'open_measures',
        label: 'Offene Massnahmen',
        resolvedBy: [
          'dashboard-api.controllabilitySubmissionCockpitStatus',
          'hitl.summary',
          'vdmi.dossier',
        ],
        contextKeys: ['openMeasures'],
        optional: false,
      },
      {
        id: 'handover_decision',
        label: 'Handover-Entscheidung',
        resolvedBy: ['dashboard-api.controllabilitySubmissionCockpitStatus', 'vdmi.dossier'],
        contextKeys: ['handoverDecision'],
        optional: false,
      },
      {
        id: 'handover_owner',
        label: 'Handover-Owner',
        resolvedBy: ['dashboard-api.controllabilitySubmissionCockpitStatus', 'vdmi.dossier'],
        contextKeys: ['handoverOwner'],
        optional: false,
      },
      {
        id: 'next_cycle_tasks',
        label: 'Naechste Zyklusaufgaben',
        resolvedBy: ['dashboard-api.controllabilitySubmissionCockpitStatus', 'vdmi.dossier'],
        contextKeys: ['nextCycleTasks'],
        optional: false,
      },
      {
        id: 'source_evidence_refs',
        label: 'Quellenreferenzen',
        resolvedBy: [
          'dashboard-api.controllabilitySubmissionCockpitStatus',
          'vdmi-evidence.inject',
        ],
        contextKeys: ['sourceEvidenceRefs'],
        optional: false,
      },
    ],
  },

  crisis_decision_routine: {
    sources: [
      {
        id: 'topic',
        label: 'Krisenthema',
        resolvedBy: ['dashboard-api.crisisDecisionRoutineStatus', 'vdmi.dossier'],
        contextKeys: ['topic', 'caseId'],
        optional: false,
      },
      {
        id: 'service_population_impact',
        label: 'Service- oder Bevoelkerungsgruppenwirkung',
        resolvedBy: ['dashboard-api.crisisDecisionRoutineStatus', 'vdmi.dossier'],
        contextKeys: ['serviceImpact', 'populationImpact'],
        optional: false,
      },
      {
        id: 'required_measures',
        label: 'Notwendige Massnahmen',
        resolvedBy: ['dashboard-api.crisisDecisionRoutineStatus', 'vdmi.dossier'],
        contextKeys: ['requiredMeasures'],
        optional: false,
      },
      {
        id: 'finance_impact',
        label: 'Finanzwirkung',
        resolvedBy: ['dashboard-api.crisisDecisionRoutineStatus', 'finance-agent.analyze'],
        contextKeys: ['financeImpact'],
        optional: false,
      },
      {
        id: 'knowledge_state',
        label: 'Wissensstand',
        resolvedBy: ['dashboard-api.crisisDecisionRoutineStatus', 'vdmi.findings'],
        contextKeys: ['knowledgeState'],
        optional: false,
      },
      {
        id: 'training_operating_model_need',
        label: 'Training oder Operating-Model-Bedarf',
        resolvedBy: ['dashboard-api.crisisDecisionRoutineStatus', 'vdmi.dossier'],
        contextKeys: ['trainingNeed', 'operatingModelNeed'],
        optional: false,
      },
      {
        id: 'owner',
        label: 'Accountable Owner',
        resolvedBy: ['dashboard-api.crisisDecisionRoutineStatus', 'vdmi.dossier', 'hitl.summary'],
        contextKeys: ['owner'],
        optional: false,
      },
      {
        id: 'next_gate',
        label: 'Naechstes Entscheidungsgate',
        resolvedBy: [
          'dashboard-api.crisisDecisionRoutineStatus',
          'nova.pendingDecisions',
          'vdmi.dossier',
        ],
        contextKeys: ['nextGate', 'decisionDeadline'],
        optional: false,
      },
      {
        id: 'blocked_follow_up',
        label: 'Blockierte Folgeentscheidung',
        resolvedBy: ['dashboard-api.crisisDecisionRoutineStatus', 'vdmi.dossier'],
        contextKeys: ['blockedFollowUp'],
        optional: false,
      },
      {
        id: 'source_evidence_refs',
        label: 'Quellenreferenzen',
        resolvedBy: ['dashboard-api.crisisDecisionRoutineStatus', 'vdmi-evidence.inject'],
        contextKeys: ['sourceEvidenceRefs', 'sourceSnapshot'],
        optional: false,
      },
    ],
  },

  investment_committee_steering_cards: {
    sources: [
      {
        id: 'investment_item',
        label: 'Investmittelposition',
        resolvedBy: [
          'dashboard-api.investmentCommitteeSteeringCardsStatus',
          'investment-planning.createPlan',
        ],
        contextKeys: ['investmentItemId'],
        optional: false,
      },
      {
        id: 'asset_project_reference',
        label: 'Asset- oder Projektbezug',
        resolvedBy: [
          'dashboard-api.investmentCommitteeSteeringCardsStatus',
          'investment-planning.createPlan',
          'vdmi.dossier',
        ],
        contextKeys: ['assetId', 'projectId'],
        optional: false,
      },
      {
        id: 'review_status',
        label: 'Pruefstatus',
        resolvedBy: [
          'dashboard-api.investmentCommitteeSteeringCardsStatus',
          'vdmi.dossier',
          'hitl.summary',
        ],
        contextKeys: ['reviewStatus'],
        optional: false,
      },
      {
        id: 'evidence_status',
        label: 'Evidenzstatus',
        resolvedBy: ['dashboard-api.investmentCommitteeSteeringCardsStatus', 'vdmi.dossier'],
        contextKeys: ['evidenceStatus'],
        optional: false,
      },
      {
        id: 'committee_window',
        label: 'Gremienfenster',
        resolvedBy: [
          'dashboard-api.investmentCommitteeSteeringCardsStatus',
          'vdmi.dossier',
          'hitl.summary',
        ],
        contextKeys: ['committeeWindow'],
        optional: false,
      },
      {
        id: 'owner',
        label: 'Accountable Owner',
        resolvedBy: [
          'dashboard-api.investmentCommitteeSteeringCardsStatus',
          'vdmi.dossier',
          'hitl.summary',
        ],
        contextKeys: ['owner'],
        optional: false,
      },
      {
        id: 'blocked_follow_up_action',
        label: 'Blockierte Folgeaktion',
        resolvedBy: ['dashboard-api.investmentCommitteeSteeringCardsStatus', 'vdmi.dossier'],
        contextKeys: ['blockedFollowUpAction'],
        optional: false,
      },
      {
        id: 'source_refs',
        label: 'Quellenreferenzen',
        resolvedBy: [
          'dashboard-api.investmentCommitteeSteeringCardsStatus',
          'vdmi-evidence.inject',
        ],
        contextKeys: ['sourceRef'],
        optional: false,
      },
    ],
  },

  investment_data_review_queue: {
    sources: [
      {
        id: 'source_data_package',
        label: 'Datenpaket / Quelle',
        resolvedBy: [
          'dashboard-api.investmentDataReviewQueueStatus',
          'datasource-registry.list',
          'datasource-cache.query',
        ],
        contextKeys: ['sourceId', 'dataPackageId'],
        optional: false,
      },
      {
        id: 'asset_project_reference',
        label: 'Asset- oder Projektbezug',
        resolvedBy: [
          'dashboard-api.investmentDataReviewQueueStatus',
          'investment-planning.createPlan',
          'vdmi.dossier',
        ],
        contextKeys: ['assetRef', 'projectRef'],
        optional: false,
      },
      {
        id: 'quality_status',
        label: 'Datenqualitaetsstatus',
        resolvedBy: [
          'dashboard-api.investmentDataReviewQueueStatus',
          'datasource-cache.query',
          'vdmi.dossier',
        ],
        contextKeys: ['qualityStatus'],
        optional: false,
      },
      {
        id: 'division',
        label: 'Sparte',
        resolvedBy: ['dashboard-api.investmentDataReviewQueueStatus', 'vdmi.dossier'],
        contextKeys: ['division'],
        optional: false,
      },
      {
        id: 'bottleneck_ref',
        label: 'Engpass-/Netzwirkungsbezug',
        resolvedBy: [
          'dashboard-api.investmentDataReviewQueueStatus',
          'investment-planning.createPlan',
          'vdmi.dossier',
        ],
        contextKeys: ['bottleneckRef'],
        optional: false,
      },
      {
        id: 'owner',
        label: 'Accountable Owner',
        resolvedBy: [
          'dashboard-api.investmentDataReviewQueueStatus',
          'vdmi.dossier',
          'hitl.summary',
        ],
        contextKeys: ['owner'],
        optional: false,
      },
      {
        id: 'committee_window',
        label: 'Gremienfenster',
        resolvedBy: [
          'dashboard-api.investmentDataReviewQueueStatus',
          'vdmi.dossier',
          'hitl.summary',
        ],
        contextKeys: ['committeeWindow'],
        optional: false,
      },
      {
        id: 'blocked_decision',
        label: 'Blockierte Folgeentscheidung',
        resolvedBy: ['dashboard-api.investmentDataReviewQueueStatus', 'vdmi.dossier'],
        contextKeys: ['blockedDecision'],
        optional: false,
      },
      {
        id: 'review_status',
        label: 'Reviewstatus',
        resolvedBy: [
          'dashboard-api.investmentDataReviewQueueStatus',
          'vdmi.dossier',
          'hitl.summary',
        ],
        contextKeys: ['reviewStatus'],
        optional: false,
      },
      {
        id: 'source_refs',
        label: 'Quellenreferenzen',
        resolvedBy: ['dashboard-api.investmentDataReviewQueueStatus', 'vdmi-evidence.inject'],
        contextKeys: ['sourceRef'],
        optional: false,
      },
    ],
  },

  cross_domain_special_topics_queue: {
    sources: [
      {
        id: 'topic',
        label: 'Sonderthema',
        resolvedBy: ['dashboard-api.crossDomainSpecialTopicsQueueStatus', 'vdmi.dossier'],
        contextKeys: ['topic', 'topics', 'caseId'],
        optional: false,
      },
      {
        id: 'domain_lane',
        label: 'Fachspur / Domain Lane',
        resolvedBy: ['dashboard-api.crossDomainSpecialTopicsQueueStatus'],
        contextKeys: ['domainLane'],
        optional: false,
      },
      {
        id: 'owner_role',
        label: 'Owner Rolle',
        resolvedBy: ['dashboard-api.crossDomainSpecialTopicsQueueStatus', 'vdmi.dossier'],
        contextKeys: ['ownerRole'],
        optional: false,
      },
      {
        id: 'due_date',
        label: 'Frist / Managementtermin',
        resolvedBy: ['dashboard-api.crossDomainSpecialTopicsQueueStatus'],
        contextKeys: ['dueAt', 'dueDate'],
        optional: false,
      },
      {
        id: 'regulatory_reference',
        label: 'Regulatorischer Bezug',
        resolvedBy: ['dashboard-api.crossDomainSpecialTopicsQueueStatus'],
        contextKeys: ['regulatoryReference'],
        optional: false,
      },
      {
        id: 'data_gap',
        label: 'Datenluecke',
        resolvedBy: ['dashboard-api.crossDomainSpecialTopicsQueueStatus'],
        contextKeys: ['dataGap'],
        optional: false,
      },
      {
        id: 'asset_revenue_impact',
        label: 'Asset-/Erloeswirkung',
        resolvedBy: ['dashboard-api.crossDomainSpecialTopicsQueueStatus'],
        contextKeys: ['assetRevenueImpact'],
        optional: false,
      },
      {
        id: 'escalation_threshold',
        label: 'Eskalationsschwelle',
        resolvedBy: ['dashboard-api.crossDomainSpecialTopicsQueueStatus'],
        contextKeys: ['escalationThreshold'],
        optional: false,
      },
      {
        id: 'next_governance_gate',
        label: 'Naechstes Gremien-Gate',
        resolvedBy: ['dashboard-api.crossDomainSpecialTopicsQueueStatus'],
        contextKeys: ['nextGovernanceGate'],
        optional: false,
      },
      {
        id: 'decision_status',
        label: 'Entscheidungsstatus',
        resolvedBy: ['dashboard-api.crossDomainSpecialTopicsQueueStatus'],
        contextKeys: ['decisionStatus'],
        optional: false,
      },
      {
        id: 'evidence_refs',
        label: 'Evidenzreferenzen',
        resolvedBy: ['dashboard-api.crossDomainSpecialTopicsQueueStatus', 'vdmi-evidence.inject'],
        contextKeys: ['evidenceRefs'],
        optional: false,
      },
    ],
  },

  flex_strategic_demand_intake: {
    sources: [
      {
        id: 'demand_topic',
        label: 'Strategischer Flex-/Fahrplanmanagement-Bedarf',
        resolvedBy: ['dashboard-api.flexStrategicDemandIntakeStatus', 'vdmi.dossier'],
        contextKeys: ['topic', 'demandTopic', 'demandId', 'caseId'],
        optional: false,
      },
      {
        id: 'affected_process',
        label: 'Betroffener Prozess',
        resolvedBy: [
          'dashboard-api.flexStrategicDemandIntakeStatus',
          'flex.status',
          'znp.projects',
        ],
        contextKeys: ['affectedProcess'],
        optional: false,
      },
      {
        id: 'risk_of_inaction',
        label: 'Nicht-Handeln-Risiko',
        resolvedBy: ['dashboard-api.flexStrategicDemandIntakeStatus', 'vdmi.dossier'],
        contextKeys: ['riskOfInaction'],
        optional: false,
      },
      {
        id: 'commercial_question',
        label: 'Kaufmaennische Bewertungsfrage',
        resolvedBy: ['dashboard-api.flexStrategicDemandIntakeStatus', 'finance-agent.analyze'],
        contextKeys: ['commercialQuestion'],
        optional: false,
      },
      {
        id: 'resource_conflict',
        label: 'Ressourcenkonflikt',
        resolvedBy: ['dashboard-api.flexStrategicDemandIntakeStatus', 'vdmi.dossier'],
        contextKeys: ['resourceConflict'],
        optional: false,
      },
      {
        id: 'stop_doing_option',
        label: 'Stop-doing-Option',
        resolvedBy: ['dashboard-api.flexStrategicDemandIntakeStatus', 'vdmi.dossier'],
        contextKeys: ['stopDoingOption'],
        optional: false,
      },
      {
        id: 'owner',
        label: 'Accountable Owner',
        resolvedBy: [
          'dashboard-api.flexStrategicDemandIntakeStatus',
          'vdmi.dossier',
          'hitl.summary',
        ],
        contextKeys: ['owner'],
        optional: false,
      },
      {
        id: 'next_decision_gate',
        label: 'Naechstes Entscheidungsgate',
        resolvedBy: [
          'dashboard-api.flexStrategicDemandIntakeStatus',
          'nova.pendingDecisions',
          'vdmi.dossier',
        ],
        contextKeys: ['nextDecisionGate'],
        optional: false,
      },
      {
        id: 'blocked_follow_up',
        label: 'Blockierte Folgeaktion',
        resolvedBy: ['dashboard-api.flexStrategicDemandIntakeStatus', 'vdmi.dossier'],
        contextKeys: ['blockedFollowUp'],
        optional: false,
      },
      {
        id: 'source_refs',
        label: 'Quellenreferenzen',
        resolvedBy: ['dashboard-api.flexStrategicDemandIntakeStatus', 'vdmi-evidence.inject'],
        contextKeys: [
          'sourceRef',
          'flexContext',
          'znpContext',
          'novaContext',
          'financeContext',
          'vdmiContext',
        ],
        optional: false,
      },
    ],
  },

  gas_infrastructure_risk_governance: {
    sources: [
      {
        id: 'technical_fact',
        label: 'Technischer Gas-Infrastruktur-Sachverhalt',
        resolvedBy: [
          'dashboard-api.gasInfrastructureRiskGovernanceStatus',
          'vdmi.dossier',
          'interface-placeholder.requestEvidence',
        ],
        contextKeys: ['technicalFact', 'caseId'],
        optional: false,
      },
      {
        id: 'impact_area',
        label: 'Auswirkungsraum',
        resolvedBy: [
          'dashboard-api.gasInfrastructureRiskGovernanceStatus',
          'assets.effective',
          'grid-operations.summary',
          'vdmi.dossier',
        ],
        contextKeys: ['impactArea', 'assetContext'],
        optional: false,
      },
      {
        id: 'probability',
        label: 'Eintrittswahrscheinlichkeit',
        resolvedBy: ['dashboard-api.gasInfrastructureRiskGovernanceStatus', 'vdmi.dossier'],
        contextKeys: ['probability'],
        optional: false,
      },
      {
        id: 'criticality',
        label: 'Kritikalitaet / Auswirkung',
        resolvedBy: ['dashboard-api.gasInfrastructureRiskGovernanceStatus', 'vdmi.dossier'],
        contextKeys: ['criticality'],
        optional: false,
      },
      {
        id: 'existing_mitigation',
        label: 'Bestehende Absicherung / Monitoring',
        resolvedBy: [
          'dashboard-api.gasInfrastructureRiskGovernanceStatus',
          'vdmi.dossier',
          'hitl.summary',
        ],
        contextKeys: ['existingMitigation'],
        optional: false,
      },
      {
        id: 'threshold',
        label: 'Schwellenwert fuer Risikoregister',
        resolvedBy: ['dashboard-api.gasInfrastructureRiskGovernanceStatus', 'vdmi.dossier'],
        contextKeys: ['threshold'],
        optional: false,
      },
      {
        id: 'risk_register_decision',
        label: 'Risikoregister-Entscheidungspfad',
        resolvedBy: [
          'dashboard-api.gasInfrastructureRiskGovernanceStatus',
          'vdmi.dossier',
          'hitl.summary',
        ],
        contextKeys: ['riskRegisterDecision'],
        optional: false,
      },
      {
        id: 'owner',
        label: 'Accountable Owner',
        resolvedBy: [
          'dashboard-api.gasInfrastructureRiskGovernanceStatus',
          'vdmi.dossier',
          'hitl.summary',
        ],
        contextKeys: ['owner'],
        optional: false,
      },
      {
        id: 'next_decision_window',
        label: 'Naechstes Entscheidungsfenster',
        resolvedBy: [
          'dashboard-api.gasInfrastructureRiskGovernanceStatus',
          'vdmi.dossier',
          'hitl.summary',
        ],
        contextKeys: ['nextDecisionWindow'],
        optional: false,
      },
      {
        id: 'blocked_follow_up',
        label: 'Blockierte Folgeaktion',
        resolvedBy: ['dashboard-api.gasInfrastructureRiskGovernanceStatus', 'vdmi.dossier'],
        contextKeys: ['blockedFollowUp'],
        optional: false,
      },
      {
        id: 'source_refs',
        label: 'Quellenreferenzen',
        resolvedBy: ['dashboard-api.gasInfrastructureRiskGovernanceStatus', 'vdmi-evidence.inject'],
        contextKeys: [
          'sourceRef',
          'vdmiContext',
          'hitlContext',
          'interfacePlaceholderContext',
          'assetContext',
        ],
        optional: false,
      },
    ],
  },

  heat_transformation_line_asset_model: {
    sources: [
      {
        id: 'division',
        label: 'Sparte / Waermetransformations-Scope',
        resolvedBy: [
          'dashboard-api.heatTransformationLineAssetModelStatus',
          'znp.listProjects',
          'vdmi.dossier',
        ],
        contextKeys: ['division'],
        optional: false,
      },
      {
        id: 'line_asset_id',
        label: 'Line Asset ID',
        resolvedBy: [
          'dashboard-api.heatTransformationLineAssetModelStatus',
          'znp.getProjectAssets',
          'vdmi.dossier',
        ],
        contextKeys: ['lineAssetId'],
        optional: false,
      },
      {
        id: 'geometry_ref',
        label: 'Geometrie-Referenz',
        resolvedBy: [
          'dashboard-api.heatTransformationLineAssetModelStatus',
          'assets.effective',
          'vdmi.dossier',
        ],
        contextKeys: ['geometryRef'],
        optional: false,
      },
      {
        id: 'connected_point_asset_ids',
        label: 'Topologische Punkt-Assets',
        resolvedBy: [
          'dashboard-api.heatTransformationLineAssetModelStatus',
          'znp.getProjectAssets',
          'assets.effective',
        ],
        contextKeys: ['connectedPointAssetIds'],
        optional: false,
      },
      {
        id: 'network_calculation_ref',
        label: 'Netzberechnungsreferenz',
        resolvedBy: [
          'dashboard-api.heatTransformationLineAssetModelStatus',
          'datapoint.health',
          'vdmi.dossier',
        ],
        contextKeys: ['networkCalculationRef'],
        optional: false,
      },
      {
        id: 'data_quality_status',
        label: 'Datenqualitaetsstatus',
        resolvedBy: [
          'dashboard-api.heatTransformationLineAssetModelStatus',
          'datapoint.health',
          'vdmi.dossier',
        ],
        contextKeys: ['dataQualityStatus'],
        optional: false,
      },
      {
        id: 'transformation_status',
        label: 'Waermetransformationsstatus',
        resolvedBy: [
          'dashboard-api.heatTransformationLineAssetModelStatus',
          'znp.listProjects',
          'vdmi.dossier',
        ],
        contextKeys: ['transformationStatus'],
        optional: false,
      },
      {
        id: 'future_option',
        label: 'Zukunftsoption / Technologieoption',
        resolvedBy: [
          'dashboard-api.heatTransformationLineAssetModelStatus',
          'znp.listProjects',
          'vdmi.dossier',
        ],
        contextKeys: ['futureOption'],
        optional: false,
      },
      {
        id: 'investment_need',
        label: 'Investitionsbedarf',
        resolvedBy: [
          'dashboard-api.heatTransformationLineAssetModelStatus',
          'finance-agent.analyze',
          'investment-planning.createPlan',
        ],
        contextKeys: ['investmentNeed'],
        optional: false,
      },
      {
        id: 'owner',
        label: 'Accountable Owner',
        resolvedBy: ['dashboard-api.heatTransformationLineAssetModelStatus', 'vdmi.dossier'],
        contextKeys: ['owner'],
        optional: false,
      },
      {
        id: 'next_decision',
        label: 'Naechste Transformationsentscheidung',
        resolvedBy: ['dashboard-api.heatTransformationLineAssetModelStatus', 'vdmi.dossier'],
        contextKeys: ['nextDecision'],
        optional: false,
      },
      {
        id: 'source_refs',
        label: 'Quellenreferenzen',
        resolvedBy: [
          'dashboard-api.heatTransformationLineAssetModelStatus',
          'vdmi-evidence.inject',
        ],
        contextKeys: ['sourceRef'],
        optional: false,
      },
    ],
  },

  heat_asset_tariff_steering: {
    sources: [
      {
        id: 'division',
        label: 'Sparte',
        resolvedBy: ['dashboard-api.heatAssetTariffSteeringStatus', 'vdmi.dossier'],
        contextKeys: ['division'],
        optional: false,
      },
      {
        id: 'technical_measures',
        label: 'Technische Massnahmen',
        resolvedBy: [
          'dashboard-api.heatAssetTariffSteeringStatus',
          'assets.effective',
          'vdmi.dossier',
        ],
        contextKeys: ['technicalMeasures'],
        optional: false,
      },
      {
        id: 'tariff_impact_status',
        label: 'Tarifwirkung',
        resolvedBy: [
          'dashboard-api.heatAssetTariffSteeringStatus',
          'business-intelligence.dynamicTariffCalculator',
          'vdmi.dossier',
        ],
        contextKeys: ['tariffImpactStatus'],
        optional: false,
      },
      {
        id: 'regulatory_uncertainty',
        label: 'Regulatorische Unsicherheit',
        resolvedBy: [
          'dashboard-api.heatAssetTariffSteeringStatus',
          'finance-agent.analyze',
          'eog-calculator.scenario',
        ],
        contextKeys: ['regulatoryUncertainty'],
        optional: false,
      },
      {
        id: 'funding_status',
        label: 'Foerderstatus',
        resolvedBy: [
          'dashboard-api.heatAssetTariffSteeringStatus',
          'finance-agent.analyze',
          'vdmi.dossier',
        ],
        contextKeys: ['fundingStatus'],
        optional: false,
      },
      {
        id: 'customer_impact',
        label: 'Kundenauswirkung',
        resolvedBy: [
          'dashboard-api.heatAssetTariffSteeringStatus',
          'business-intelligence.dynamicTariffCalculator',
          'vdmi.dossier',
        ],
        contextKeys: ['customerImpact'],
        optional: false,
      },
      {
        id: 'investment_priority',
        label: 'Investment Priority',
        resolvedBy: [
          'dashboard-api.heatAssetTariffSteeringStatus',
          'finance-agent.analyze',
          'investment-planning.createPlan',
        ],
        contextKeys: ['investmentPriority'],
        optional: false,
      },
      {
        id: 'owner',
        label: 'Accountable Owner',
        resolvedBy: ['dashboard-api.heatAssetTariffSteeringStatus', 'vdmi.dossier'],
        contextKeys: ['owner'],
        optional: false,
      },
      {
        id: 'next_decision_gate',
        label: 'Next Decision Gate',
        resolvedBy: ['dashboard-api.heatAssetTariffSteeringStatus', 'vdmi.dossier'],
        contextKeys: ['nextDecisionGate'],
        optional: false,
      },
      {
        id: 'blocked_follow_up_action',
        label: 'Blocked Follow-Up Action',
        resolvedBy: [
          'dashboard-api.heatAssetTariffSteeringStatus',
          'investment-planning.createPlan',
          'vdmi.dossier',
        ],
        contextKeys: ['blockedFollowUpAction'],
        optional: false,
      },
      {
        id: 'source_refs',
        label: 'Quellenreferenzen',
        resolvedBy: ['dashboard-api.heatAssetTariffSteeringStatus', 'vdmi-evidence.inject'],
        contextKeys: ['sourceRef'],
        optional: false,
      },
    ],
  },

  tech_commercial_offer_cockpit: {
    sources: [
      {
        id: 'connection_request_id',
        label: 'Request ID',
        resolvedBy: ['dashboard-api.techCommercialOfferCockpitStatus', 'vdmi.dossier'],
        contextKeys: ['connectionRequestId'],
        optional: false,
      },
      {
        id: 'grid_operator_id',
        label: 'Netzbetreiber ID',
        resolvedBy: ['dashboard-api.techCommercialOfferCockpitStatus', 'vdmi.dossier'],
        contextKeys: ['gridOperatorId'],
        optional: false,
      },
      {
        id: 'znp_alignment',
        label: 'Zielnetzbezug',
        resolvedBy: [
          'dashboard-api.techCommercialOfferCockpitStatus',
          'znp.assessPortfolio',
          'vdmi.dossier',
        ],
        contextKeys: ['znpAlignment'],
        optional: false,
      },
      {
        id: 'grid_node',
        label: 'Grid Node',
        resolvedBy: ['dashboard-api.techCommercialOfferCockpitStatus', 'vdmi.dossier'],
        contextKeys: ['gridNode'],
        optional: false,
      },
      {
        id: 'technical_restriction',
        label: 'Technische Restriktion',
        resolvedBy: [
          'dashboard-api.techCommercialOfferCockpitStatus',
          'grid-connection.validate',
          'grid-operations.connectionCapacityCheck',
          'vdmi.dossier',
        ],
        contextKeys: ['technicalRestriction'],
        optional: false,
      },
      {
        id: 'requested_capacity_kw',
        label: 'Anfrageleistung',
        resolvedBy: ['dashboard-api.techCommercialOfferCockpitStatus', 'vdmi.dossier'],
        contextKeys: ['requestedCapacityKW'],
        optional: false,
      },
      {
        id: 'technical_status',
        label: 'Technischer Status',
        resolvedBy: [
          'dashboard-api.techCommercialOfferCockpitStatus',
          'grid-connection.validate',
          'vdmi.dossier',
        ],
        contextKeys: ['technicalStatus'],
        optional: false,
      },
      {
        id: 'capacity_utilization',
        label: 'Auslastung',
        resolvedBy: [
          'dashboard-api.techCommercialOfferCockpitStatus',
          'grid-operations.capacityUtilization',
          'vdmi.dossier',
        ],
        contextKeys: ['capacityUtilization'],
        optional: false,
      },
      {
        id: 'fnav_contract_logic',
        label: 'fNAV Vertragslage',
        resolvedBy: [
          'dashboard-api.techCommercialOfferCockpitStatus',
          'grid-connection.fnavValidate',
          'grid-operations.netzfahrplanGenerate',
          'vdmi.dossier',
        ],
        contextKeys: ['fnavContractLogic'],
        optional: false,
      },
      {
        id: 'commercial_assumptions',
        label: 'Kaufmännische Annahmen',
        resolvedBy: [
          'dashboard-api.techCommercialOfferCockpitStatus',
          'finance-agent.fnavEconomics',
          'finance-agent.analyze',
          'vdmi.dossier',
        ],
        contextKeys: ['commercialAssumptions'],
        optional: false,
      },
      {
        id: 'legal_agreement_status',
        label: 'Rechtsstatus',
        resolvedBy: ['dashboard-api.techCommercialOfferCockpitStatus', 'vdmi.dossier'],
        contextKeys: ['legalAgreementStatus'],
        optional: false,
      },
      {
        id: 'legal_boundaries',
        label: 'Legal Boundaries',
        resolvedBy: ['dashboard-api.techCommercialOfferCockpitStatus', 'vdmi.dossier'],
        contextKeys: ['legalBoundaries'],
        optional: false,
      },
      {
        id: 'source_refs',
        label: 'Quellenreferenzen',
        resolvedBy: ['dashboard-api.techCommercialOfferCockpitStatus', 'vdmi-evidence.inject'],
        contextKeys: ['sourceRef'],
        optional: false,
      },
    ],
  },

  ki_floorwalker_governance: {
    sources: [
      {
        id: 'use_case_priority',
        label: 'Use-Case-Prioritaet',
        resolvedBy: [
          'dashboard-api.kiFloorwalkerGovernanceStatus',
          'personal-agent.chat',
          'vdmi.dossier',
        ],
        contextKeys: ['useCasePriority'],
        optional: false,
      },
      {
        id: 'allowed_dataspaces',
        label: 'Erlaubte Datenraeume',
        resolvedBy: [
          'dashboard-api.kiFloorwalkerGovernanceStatus',
          'datapoint.oemetadata',
          'vdmi.dossier',
        ],
        contextKeys: ['allowedDataspaces'],
        optional: false,
      },
      {
        id: 'prompt_standards',
        label: 'Prompt-Standards / Prompt-Bausteine',
        resolvedBy: [
          'dashboard-api.kiFloorwalkerGovernanceStatus',
          'personal-agent.chat',
          'vdmi.dossier',
        ],
        contextKeys: ['promptStandards'],
        optional: false,
      },
      {
        id: 'process_boundaries',
        label: 'Prozessgrenzen',
        resolvedBy: ['dashboard-api.kiFloorwalkerGovernanceStatus', 'vdmi.dossier'],
        contextKeys: ['processBoundaries'],
        optional: false,
      },
      {
        id: 'roles_and_responsibilities',
        label: 'Rollen & Verantwortlichkeiten',
        resolvedBy: ['dashboard-api.kiFloorwalkerGovernanceStatus', 'vdmi.dossier'],
        contextKeys: ['rolesAndResponsibilities'],
        optional: false,
      },
      {
        id: 'guided_application',
        label: 'Nachweis Begleitung/Schulung',
        resolvedBy: ['dashboard-api.kiFloorwalkerGovernanceStatus', 'vdmi.dossier'],
        contextKeys: ['guidedApplication'],
        optional: false,
      },
      {
        id: 'risk_and_approval_status',
        label: 'Freigabestatus und Risikoanalyse',
        resolvedBy: ['dashboard-api.kiFloorwalkerGovernanceStatus', 'cya.generate', 'vdmi.dossier'],
        contextKeys: ['riskAndApprovalStatus'],
        optional: false,
      },
      {
        id: 'proof_of_benefit',
        label: 'Nutzennachweis',
        resolvedBy: ['dashboard-api.kiFloorwalkerGovernanceStatus', 'vdmi.dossier'],
        contextKeys: ['proofOfBenefit'],
        optional: false,
      },
      {
        id: 'source_refs',
        label: 'Quellenreferenzen',
        resolvedBy: ['dashboard-api.kiFloorwalkerGovernanceStatus', 'vdmi-evidence.inject'],
        contextKeys: ['sourceRef'],
        optional: false,
      },
    ],
  },

  investment_waterfall_governance: {
    sources: [
      {
        id: 'budget_amount',
        label: 'Mittelbindung / Investitionsbudget',
        resolvedBy: [
          'dashboard-api.investmentWaterfallGovernanceStatus',
          'personal-agent.chat',
          'vdmi.dossier',
        ],
        contextKeys: ['budgetAmount'],
        optional: false,
      },
      {
        id: 'bottleneck_ref',
        label: 'Netzengpass / Netznutzungsbezug',
        resolvedBy: [
          'dashboard-api.investmentWaterfallGovernanceStatus',
          'datapoint.oemetadata',
          'vdmi.dossier',
        ],
        contextKeys: ['bottleneckRef'],
        optional: false,
      },
      {
        id: 'committee_window',
        label: 'Gremienfenster / Kalender-Slot',
        resolvedBy: [
          'dashboard-api.investmentWaterfallGovernanceStatus',
          'personal-agent.chat',
          'vdmi.dossier',
        ],
        contextKeys: ['committeeWindow'],
        optional: false,
      },
      {
        id: 'evidence_readiness',
        label: 'Nachweisreife / Evidenzpunkte',
        resolvedBy: ['dashboard-api.investmentWaterfallGovernanceStatus', 'vdmi.dossier'],
        contextKeys: ['evidenceReadiness'],
        optional: false,
      },
      {
        id: 'owner',
        label: 'Strategische Zustaendigkeit',
        resolvedBy: ['dashboard-api.investmentWaterfallGovernanceStatus', 'vdmi.dossier'],
        contextKeys: ['owner'],
        optional: false,
      },
      {
        id: 'next_action',
        label: 'Naechste Steuerungsmassnahme',
        resolvedBy: ['dashboard-api.investmentWaterfallGovernanceStatus', 'vdmi.dossier'],
        contextKeys: ['nextAction'],
        optional: false,
      },
      {
        id: 'mandate_status',
        label: 'Mandatsstatus',
        resolvedBy: [
          'dashboard-api.investmentWaterfallGovernanceStatus',
          'cya.generate',
          'vdmi.dossier',
        ],
        contextKeys: ['mandateStatus'],
        optional: false,
      },
      {
        id: 'risk_if_delayed',
        label: 'Operatives Verzugsrisiko',
        resolvedBy: ['dashboard-api.investmentWaterfallGovernanceStatus', 'vdmi.dossier'],
        contextKeys: ['riskIfDelayed'],
        optional: false,
      },
      {
        id: 'source_refs',
        label: 'Quellenreferenzen',
        resolvedBy: ['dashboard-api.investmentWaterfallGovernanceStatus', 'vdmi-evidence.inject'],
        contextKeys: ['sourceRef'],
        optional: false,
      },
    ],
  },

  imsys_taf2_compliance_status: {
    sources: [
      {
        id: 'taf2_obligation',
        label: 'TAF2-Pflicht Einbaufall',
        resolvedBy: [
          'dashboard-api.imsysTaf2ComplianceStatus',
          'personal-agent.chat',
          'vdmi.dossier',
        ],
        contextKeys: ['taf2Obligation'],
        optional: false,
      },
      {
        id: 'target_deadline',
        label: 'Soll-Frist Einbau',
        resolvedBy: [
          'dashboard-api.imsysTaf2ComplianceStatus',
          'datapoint.oemetadata',
          'vdmi.dossier',
        ],
        contextKeys: ['targetDeadline'],
        optional: false,
      },
      {
        id: 'tariff_model',
        label: 'Variables Tarifmodell',
        resolvedBy: [
          'dashboard-api.imsysTaf2ComplianceStatus',
          'personal-agent.chat',
          'vdmi.dossier',
        ],
        contextKeys: ['tariffModel'],
        optional: false,
      },
      {
        id: 'implementation_status',
        label: 'Einbaustatus Hardware',
        resolvedBy: ['dashboard-api.imsysTaf2ComplianceStatus', 'vdmi.dossier'],
        contextKeys: ['implementationStatus'],
        optional: false,
      },
      {
        id: 'measured_value_access',
        label: 'Messwert-Kommunikationskanal',
        resolvedBy: ['dashboard-api.imsysTaf2ComplianceStatus', 'vdmi.dossier'],
        contextKeys: ['measuredValueAccess'],
        optional: false,
      },
      {
        id: 'owner',
        label: 'Prozessverantwortung',
        resolvedBy: ['dashboard-api.imsysTaf2ComplianceStatus', 'vdmi.dossier'],
        contextKeys: ['owner'],
        optional: false,
      },
      {
        id: 'next_action',
        label: 'Naechste Compliance-Massnahme',
        resolvedBy: ['dashboard-api.imsysTaf2ComplianceStatus', 'vdmi.dossier'],
        contextKeys: ['nextAction'],
        optional: false,
      },
      {
        id: 'source_refs',
        label: 'Quellenreferenzen',
        resolvedBy: ['dashboard-api.imsysTaf2ComplianceStatus', 'vdmi-evidence.inject'],
        contextKeys: ['sourceRef'],
        optional: false,
      },
    ],
  },

  schedule_management_governance_roadmap: {
    sources: [
      {
        id: 'target_state',
        label: 'Ziel-Zustand',
        resolvedBy: ['dashboard-api.scheduleManagementGovernanceRoadmapStatus', 'vdmi.dossier'],
        contextKeys: ['targetState'],
        optional: false,
      },
      {
        id: 'capability_maturity',
        label: 'Faehigkeits-Reifegrad',
        resolvedBy: ['dashboard-api.scheduleManagementGovernanceRoadmapStatus', 'vdmi.dossier'],
        contextKeys: ['capabilityMaturity'],
        optional: false,
      },
      {
        id: 'data_objects',
        label: 'Datenobjekte',
        resolvedBy: ['dashboard-api.scheduleManagementGovernanceRoadmapStatus', 'vdmi.dossier'],
        contextKeys: ['dataObjects'],
        optional: false,
      },
      {
        id: 'system_integrations',
        label: 'Systemintegrationen',
        resolvedBy: ['dashboard-api.scheduleManagementGovernanceRoadmapStatus', 'vdmi.dossier'],
        contextKeys: ['systemIntegrations'],
        optional: false,
      },
      {
        id: 'role_ownership',
        label: 'Rollenverantwortung',
        resolvedBy: ['dashboard-api.scheduleManagementGovernanceRoadmapStatus', 'vdmi.dossier'],
        contextKeys: ['roleOwnership'],
        optional: false,
      },
      {
        id: 'redispatch_boundary',
        label: 'Redispatch-Grenzbereich',
        resolvedBy: ['dashboard-api.scheduleManagementGovernanceRoadmapStatus', 'vdmi.dossier'],
        contextKeys: ['redispatchBoundary'],
        optional: false,
      },
      {
        id: 'fnav_readiness',
        label: 'fNAV-Bereitschaft',
        resolvedBy: ['dashboard-api.scheduleManagementGovernanceRoadmapStatus', 'vdmi.dossier'],
        contextKeys: ['fnavReadiness'],
        optional: false,
      },
      {
        id: 'capacity_management_gaps',
        label: 'Kapazitaetsmanagement-Luecken',
        resolvedBy: ['dashboard-api.scheduleManagementGovernanceRoadmapStatus', 'vdmi.dossier'],
        contextKeys: ['capacityManagementGaps'],
        optional: false,
      },
      {
        id: 'roadmap_items',
        label: 'Fahrplan-Elemente',
        resolvedBy: ['dashboard-api.scheduleManagementGovernanceRoadmapStatus', 'vdmi.dossier'],
        contextKeys: ['roadmapItems'],
        optional: false,
      },
      {
        id: 'decision_meetings',
        label: 'Entscheidungsgremien',
        resolvedBy: ['dashboard-api.scheduleManagementGovernanceRoadmapStatus', 'vdmi.dossier'],
        contextKeys: ['decisionMeetings'],
        optional: false,
      },
      {
        id: 'owner',
        label: 'Prozessverantwortlicher Owner',
        resolvedBy: ['dashboard-api.scheduleManagementGovernanceRoadmapStatus', 'vdmi.dossier'],
        contextKeys: ['owner'],
        optional: false,
      },
      {
        id: 'next_action',
        label: 'Naechste Massnahme',
        resolvedBy: ['dashboard-api.scheduleManagementGovernanceRoadmapStatus', 'vdmi.dossier'],
        contextKeys: ['nextAction'],
        optional: false,
      },
      {
        id: 'source_refs',
        label: 'Quellenreferenzen',
        resolvedBy: [
          'dashboard-api.scheduleManagementGovernanceRoadmapStatus',
          'vdmi-evidence.inject',
        ],
        contextKeys: ['sourceRef'],
        optional: false,
      },
    ],
  },

  gas_transformation_dependency_map: {
    sources: [
      {
        id: 'project_id',
        label: 'Projekt-ID',
        resolvedBy: ['dashboard-api.gasTransformationDependencyMapStatus', 'vdmi.dossier'],
        contextKeys: ['projectId'],
        optional: true,
      },
      {
        id: 'division',
        label: 'Sparte',
        resolvedBy: ['dashboard-api.gasTransformationDependencyMapStatus', 'vdmi.dossier'],
        contextKeys: ['division'],
        optional: false,
      },
      {
        id: 'nodes',
        label: 'Transformationsknoten',
        resolvedBy: ['dashboard-api.gasTransformationDependencyMapStatus', 'vdmi.dossier'],
        contextKeys: ['nodes'],
        optional: false,
      },
      {
        id: 'dependencies',
        label: 'Abhaengigkeiten',
        resolvedBy: ['dashboard-api.gasTransformationDependencyMapStatus', 'vdmi.dossier'],
        contextKeys: ['dependencies'],
        optional: false,
      },
      {
        id: 'data_quality_gaps',
        label: 'Datenqualitaets-Luecken',
        resolvedBy: ['dashboard-api.gasTransformationDependencyMapStatus', 'vdmi.dossier'],
        contextKeys: ['dataQualityGaps'],
        optional: false,
      },
      {
        id: 'investment_paths',
        label: 'Investitionspfade',
        resolvedBy: ['dashboard-api.gasTransformationDependencyMapStatus', 'vdmi.dossier'],
        contextKeys: ['investmentPaths'],
        optional: false,
      },
      {
        id: 'decommission_repurpose_paths',
        label: 'Stilllegungs- und Umwidmungspfade',
        resolvedBy: ['dashboard-api.gasTransformationDependencyMapStatus', 'vdmi.dossier'],
        contextKeys: ['decommissionRepurposePaths'],
        optional: false,
      },
      {
        id: 'customer_groups',
        label: 'Kundengruppen',
        resolvedBy: ['dashboard-api.gasTransformationDependencyMapStatus', 'vdmi.dossier'],
        contextKeys: ['customerGroups'],
        optional: false,
      },
      {
        id: 'owner',
        label: 'Prozessverantwortlicher Owner',
        resolvedBy: ['dashboard-api.gasTransformationDependencyMapStatus', 'vdmi.dossier'],
        contextKeys: ['owner'],
        optional: false,
      },
      {
        id: 'next_action',
        label: 'Naechste Massnahme',
        resolvedBy: ['dashboard-api.gasTransformationDependencyMapStatus', 'vdmi.dossier'],
        contextKeys: ['nextAction'],
        optional: false,
      },
      {
        id: 'source_refs',
        label: 'Quellenreferenzen',
        resolvedBy: ['dashboard-api.gasTransformationDependencyMapStatus', 'vdmi-evidence.inject'],
        contextKeys: ['sourceRef'],
        optional: false,
      },
    ],
  },

  grid_connection_transformation_gate: {
    sources: [
      {
        id: 'metering_point_id',
        label: 'Metering Point ID',
        resolvedBy: ['dashboard-api.gridConnectionTransformationGateStatus', 'vdmi.dossier'],
        contextKeys: ['meteringPointId'],
        optional: true,
      },
      {
        id: 'division',
        label: 'Sparte',
        resolvedBy: ['dashboard-api.gridConnectionTransformationGateStatus', 'vdmi.dossier'],
        contextKeys: ['division'],
        optional: false,
      },
      {
        id: 'transformation_option',
        label: 'Transformationsoption',
        resolvedBy: ['dashboard-api.gridConnectionTransformationGateStatus', 'vdmi.dossier'],
        contextKeys: ['transformationOption'],
        optional: false,
      },
      {
        id: 'data_quality_status',
        label: 'Datenqualitaetsstatus',
        resolvedBy: ['dashboard-api.gridConnectionTransformationGateStatus', 'vdmi.dossier'],
        contextKeys: ['dataQualityStatus'],
        optional: false,
      },
      {
        id: 'investment_path',
        label: 'Investitionspfad',
        resolvedBy: ['dashboard-api.gridConnectionTransformationGateStatus', 'vdmi.dossier'],
        contextKeys: ['investmentPath'],
        optional: false,
      },
      {
        id: 'decommission_path',
        label: 'Stilllegungspfad',
        resolvedBy: ['dashboard-api.gridConnectionTransformationGateStatus', 'vdmi.dossier'],
        contextKeys: ['decommissionPath'],
        optional: false,
      },
      {
        id: 'owner',
        label: 'Owner',
        resolvedBy: ['dashboard-api.gridConnectionTransformationGateStatus', 'vdmi.dossier'],
        contextKeys: ['owner'],
        optional: false,
      },
      {
        id: 'next_action',
        label: 'Naechste Massnahme',
        resolvedBy: ['dashboard-api.gridConnectionTransformationGateStatus', 'vdmi.dossier'],
        contextKeys: ['nextAction'],
        optional: false,
      },
      {
        id: 'source_refs',
        label: 'Quellenreferenzen',
        resolvedBy: [
          'dashboard-api.gridConnectionTransformationGateStatus',
          'vdmi-evidence.inject',
        ],
        contextKeys: ['sourceRef'],
        optional: false,
      },
    ],
  },

  capacity_contract_risk_asset_cockpit: {
    sources: [
      {
        id: 'utilization',
        label: 'Netzauslastung',
        resolvedBy: [
          'dashboard-api.capacityContractRiskAssetCockpitStatus',
          'grid-operations.capacityUtilization',
          'vdmi.dossier',
        ],
        contextKeys: ['utilization'],
        optional: false,
      },
      {
        id: 'bottleneck',
        label: 'Engpass-Situation',
        resolvedBy: [
          'dashboard-api.capacityContractRiskAssetCockpitStatus',
          'grid-operations.netzfahrplanGenerate',
          'vdmi.dossier',
        ],
        contextKeys: ['bottleneck'],
        optional: false,
      },
      {
        id: 'contract_status',
        label: 'Vertragsstatus',
        resolvedBy: [
          'dashboard-api.capacityContractRiskAssetCockpitStatus',
          'grid-operations.netzfahrplanGenerate',
          'vdmi.dossier',
        ],
        contextKeys: ['contractStatus'],
        optional: false,
      },
      {
        id: 'legal_status',
        label: 'Regulatorischer Legal-Status',
        resolvedBy: [
          'dashboard-api.capacityContractRiskAssetCockpitStatus',
          'personal-agent.chat',
          'vdmi.dossier',
        ],
        contextKeys: ['legalStatus'],
        optional: false,
      },
      {
        id: 'capex',
        label: 'CAPEX Investitionsoption',
        resolvedBy: [
          'dashboard-api.capacityContractRiskAssetCockpitStatus',
          'finance-agent.fnavEconomics',
          'vdmi.dossier',
        ],
        contextKeys: ['capex'],
        optional: false,
      },
      {
        id: 'opex',
        label: 'OPEX Betriebskosten',
        resolvedBy: [
          'dashboard-api.capacityContractRiskAssetCockpitStatus',
          'finance-agent.analyze',
          'vdmi.dossier',
        ],
        contextKeys: ['opex'],
        optional: false,
      },
      {
        id: 'owner',
        label: 'Prozessverantwortlicher Owner',
        resolvedBy: ['dashboard-api.capacityContractRiskAssetCockpitStatus', 'vdmi.dossier'],
        contextKeys: ['owner'],
        optional: false,
      },
      {
        id: 'next_action',
        label: 'Naechste Massnahme',
        resolvedBy: ['dashboard-api.capacityContractRiskAssetCockpitStatus', 'vdmi.dossier'],
        contextKeys: ['nextAction'],
        optional: false,
      },
      {
        id: 'source_refs',
        label: 'Quellenreferenzen',
        resolvedBy: [
          'dashboard-api.capacityContractRiskAssetCockpitStatus',
          'vdmi-evidence.inject',
        ],
        contextKeys: ['sourceRef'],
        optional: false,
      },
    ],
  },

  metering_rollout_process_indicator: {
    sources: [
      {
        id: 'division',
        label: 'Sparte / Messwesen-Scope',
        resolvedBy: [
          'dashboard-api.meteringRolloutProcessIndicatorStatus',
          'datasource-registry.list',
          'vdmi.dossier',
        ],
        contextKeys: ['division'],
        optional: false,
      },
      {
        id: 'source_type',
        label: 'Quellentyp',
        resolvedBy: [
          'dashboard-api.meteringRolloutProcessIndicatorStatus',
          'datasource-registry.list',
          'edm.getTimeseriesSummary',
        ],
        contextKeys: ['sourceType'],
        optional: false,
      },
      {
        id: 'target_count',
        label: 'Soll-Zaehler / Rolloutziel',
        resolvedBy: [
          'dashboard-api.meteringRolloutProcessIndicatorStatus',
          'datasource-cache.query',
          'vdmi.dossier',
        ],
        contextKeys: ['targetCount'],
        optional: false,
      },
      {
        id: 'actual_count',
        label: 'Ist-Zaehler / Rolloutstand',
        resolvedBy: [
          'dashboard-api.meteringRolloutProcessIndicatorStatus',
          'datasource-cache.query',
          'edm.getTimeseriesSummary',
        ],
        contextKeys: ['actualCount'],
        optional: false,
      },
      {
        id: 'backlog_count',
        label: 'Rueckstand',
        resolvedBy: [
          'dashboard-api.meteringRolloutProcessIndicatorStatus',
          'in-memory-join.join',
          'vdmi.dossier',
        ],
        contextKeys: ['backlogCount', 'targetCount', 'actualCount'],
        optional: false,
      },
      {
        id: 'data_quality_status',
        label: 'Datenqualitaetsstatus',
        resolvedBy: [
          'dashboard-api.meteringRolloutProcessIndicatorStatus',
          'datasource-cache.query',
          'vdmi.dossier',
        ],
        contextKeys: ['dataQualityStatus'],
        optional: false,
      },
      {
        id: 'contractor_load',
        label: 'Dienstleisterlast',
        resolvedBy: [
          'dashboard-api.meteringRolloutProcessIndicatorStatus',
          'vdmi.dossier',
          'hitl.summary',
        ],
        contextKeys: ['contractorLoad'],
        optional: false,
      },
      {
        id: 'capex_impact',
        label: 'CAPEX-Indikation',
        resolvedBy: ['dashboard-api.meteringRolloutProcessIndicatorStatus', 'vdmi.dossier'],
        contextKeys: ['capexImpactEur'],
        optional: false,
      },
      {
        id: 'opex_impact',
        label: 'OPEX-Indikation',
        resolvedBy: ['dashboard-api.meteringRolloutProcessIndicatorStatus', 'vdmi.dossier'],
        contextKeys: ['opexImpactEur'],
        optional: false,
      },
      {
        id: 'owner',
        label: 'Accountable Owner',
        resolvedBy: [
          'dashboard-api.meteringRolloutProcessIndicatorStatus',
          'vdmi.dossier',
          'hitl.summary',
        ],
        contextKeys: ['owner'],
        optional: false,
      },
      {
        id: 'next_control_step',
        label: 'Naechster Steuerungsschritt',
        resolvedBy: [
          'dashboard-api.meteringRolloutProcessIndicatorStatus',
          'vdmi.dossier',
          'hitl.summary',
        ],
        contextKeys: ['nextControlStep'],
        optional: false,
      },
      {
        id: 'blocked_follow_up',
        label: 'Blockierte Folgeentscheidung',
        resolvedBy: ['dashboard-api.meteringRolloutProcessIndicatorStatus', 'vdmi.dossier'],
        contextKeys: ['blockedFollowUp'],
        optional: false,
      },
      {
        id: 'source_refs',
        label: 'Quellenreferenzen',
        resolvedBy: ['dashboard-api.meteringRolloutProcessIndicatorStatus', 'vdmi-evidence.inject'],
        contextKeys: ['sourceRef'],
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

  fnav_fast_track_contract_gate: {
    sources: [
      {
        id: 'fnav_profile',
        label: 'fNAV request profile',
        resolvedBy: [
          'dashboard-api.fnavFastTrackContractGateStatus',
          'grid-connection.fnavValidate',
        ],
        contextKeys: ['requestType', 'assetOrLoadType', 'requestedCapacityKW', 'fnavProfile'],
        optional: false,
      },
      {
        id: 'grid_operator_identity',
        label: 'Grid operator identity',
        resolvedBy: ['dashboard-api.fnavFastTrackContractGateStatus', 'grid-operations.vnbLookup'],
        contextKeys: ['gridOperatorId', 'bdewCode', 'gridOperatorName'],
        optional: false,
      },
      {
        id: 'netzsignal_priority_policy',
        label: 'Network-signal priority policy',
        resolvedBy: [
          'dashboard-api.fnavFastTrackContractGateStatus',
          'grid-connection.fnavValidate',
        ],
        contextKeys: ['netzsignalPriorityPolicy', 'networkSignalPriority'],
        optional: false,
      },
      {
        id: 'schedule_obligation',
        label: 'Fahrplanpflicht',
        resolvedBy: [
          'dashboard-api.fnavFastTrackContractGateStatus',
          'grid-operations.netzfahrplanGenerate',
        ],
        contextKeys: ['scheduleObligation'],
        optional: false,
      },
      {
        id: 'metering_requirement',
        label: 'Metering requirement',
        resolvedBy: ['dashboard-api.fnavFastTrackContractGateStatus', 'edm-messkonzept.evaluate'],
        contextKeys: ['meteringRequirements'],
        optional: false,
      },
      {
        id: 'control_evidence_ref',
        label: 'Control evidence reference',
        resolvedBy: [
          'dashboard-api.fnavFastTrackContractGateStatus',
          'interface-placeholder.requestEvidence',
        ],
        contextKeys: ['controlEvidenceRef'],
        optional: false,
      },
      {
        id: 'contract_status',
        label: 'Contract status',
        resolvedBy: ['dashboard-api.fnavFastTrackContractGateStatus', 'vdmi.dossier'],
        contextKeys: ['contractStatus'],
        optional: false,
      },
      {
        id: 'legal_status',
        label: 'Legal status',
        resolvedBy: ['dashboard-api.fnavFastTrackContractGateStatus', 'vdmi.dossier'],
        contextKeys: ['legalStatus'],
        optional: false,
      },
      {
        id: 'owner_contact',
        label: 'Owner contact',
        resolvedBy: ['dashboard-api.fnavFastTrackContractGateStatus', 'vdmi.dossier'],
        contextKeys: ['ownerContact', 'escalationOwner'],
        optional: false,
      },
      {
        id: 'commercial_impact',
        label: 'Commercial impact',
        resolvedBy: [
          'dashboard-api.fnavFastTrackContractGateStatus',
          'finance-agent.fnavEconomics',
        ],
        contextKeys: ['commercialImpact'],
        optional: true,
      },
      {
        id: 'marketing_boundary',
        label: 'Marketing boundary',
        resolvedBy: [
          'dashboard-api.fnavFastTrackContractGateStatus',
          'fnav-commercial-hedging.createScenario',
        ],
        contextKeys: ['marketingBoundaries'],
        optional: true,
      },
      {
        id: 'break_criteria',
        label: 'Break criteria',
        resolvedBy: [
          'dashboard-api.fnavFastTrackContractGateStatus',
          'vdmi-portfolio-gatekeeping.gate',
        ],
        contextKeys: ['breakCriteria'],
        optional: true,
      },
    ],
  },

  netzsignal_delta_gating: {
    sources: [
      {
        id: 'domain',
        label: 'Operational domain',
        resolvedBy: ['dashboard-api.netzsignalDeltaGatingStatus'],
        contextKeys: ['domain'],
        optional: false,
      },
      {
        id: 'signal_type',
        label: 'Signal type',
        resolvedBy: ['dashboard-api.netzsignalDeltaGatingStatus'],
        contextKeys: ['signalType'],
        optional: false,
      },
      {
        id: 'known_context_ref',
        label: 'Known context reference',
        resolvedBy: ['dashboard-api.netzsignalDeltaGatingStatus', 'vdmi.dossier'],
        contextKeys: ['knownContextRef'],
        optional: false,
      },
      {
        id: 'freshness_proof',
        label: 'Freshness proof',
        resolvedBy: ['dashboard-api.netzsignalDeltaGatingStatus'],
        contextKeys: ['freshnessProof'],
        optional: false,
      },
      {
        id: 'decision_topic',
        label: 'Decision topic',
        resolvedBy: ['dashboard-api.netzsignalDeltaGatingStatus', 'vdmi.dossier'],
        contextKeys: ['decisionTopic'],
        optional: false,
      },
      {
        id: 'owner',
        label: 'Accountable owner',
        resolvedBy: ['dashboard-api.netzsignalDeltaGatingStatus', 'vdmi.dossier'],
        contextKeys: ['owner'],
        optional: false,
      },
      {
        id: 'due_date',
        label: 'Due date',
        resolvedBy: ['dashboard-api.netzsignalDeltaGatingStatus', 'vdmi.dossier'],
        contextKeys: ['dueDate'],
        optional: false,
      },
      {
        id: 'materiality',
        label: 'Management materiality',
        resolvedBy: ['dashboard-api.netzsignalDeltaGatingStatus'],
        contextKeys: ['materiality'],
        optional: false,
      },
      {
        id: 'new_fact',
        label: 'New fact',
        resolvedBy: ['dashboard-api.netzsignalDeltaGatingStatus'],
        contextKeys: ['newFact'],
        optional: false,
      },
      {
        id: 'blocked_decision',
        label: 'Blocked decision',
        resolvedBy: ['dashboard-api.netzsignalDeltaGatingStatus', 'vdmi.dossier'],
        contextKeys: ['blockedDecision'],
        optional: false,
      },
      {
        id: 'next_evidence_point',
        label: 'Next evidence point',
        resolvedBy: ['dashboard-api.netzsignalDeltaGatingStatus', 'vdmi.dossier'],
        contextKeys: ['nextEvidencePoint'],
        optional: false,
      },
    ],
  },

  evidence_freshness_guard: {
    sources: [
      {
        id: 'source_kind',
        label: 'Source kind for the supplied signal metadata',
        resolvedBy: ['dashboard-api.evidenceFreshnessGuardStatus'],
        contextKeys: ['sourceKind', 'sourceType', 'channel'],
        optional: false,
      },
      {
        id: 'source_timestamp',
        label: 'Source timestamp used for freshness classification',
        resolvedBy: ['dashboard-api.evidenceFreshnessGuardStatus'],
        contextKeys: ['sourceTimestamp', 'createdAt', 'snapshotTimestamp'],
        optional: false,
      },
      {
        id: 'last_seen_timestamp',
        label: 'Last-seen timestamp for known context-anchor comparison',
        resolvedBy: ['dashboard-api.evidenceFreshnessGuardStatus'],
        contextKeys: ['lastSeenTimestamp', 'baselineTimestamp', 'knownContextTimestamp'],
        optional: false,
      },
      {
        id: 'snapshot_identity',
        label: 'Known and current snapshot identity or hash',
        resolvedBy: ['dashboard-api.evidenceFreshnessGuardStatus'],
        contextKeys: [
          'knownSnapshotHash',
          'knownSnapshotId',
          'currentSnapshotHash',
          'currentSnapshotId',
        ],
        optional: false,
      },
      {
        id: 'owner',
        label: 'Accountable owner or role',
        resolvedBy: ['dashboard-api.evidenceFreshnessGuardStatus', 'vdmi.dossier'],
        contextKeys: ['owner', 'ownerRole'],
        optional: false,
      },
      {
        id: 'due_date',
        label: 'Due date or deadline',
        resolvedBy: ['dashboard-api.evidenceFreshnessGuardStatus', 'vdmi.dossier'],
        contextKeys: ['dueDate', 'dueAt'],
        optional: false,
      },
      {
        id: 'blocked_decision',
        label: 'Blocked decision for escalation rationale',
        resolvedBy: [
          'dashboard-api.evidenceFreshnessGuardStatus',
          'dashboard-api.vnbDeltaSignalClassifierStatus',
        ],
        contextKeys: ['blockedDecision', 'blockedDecisionHint'],
        optional: false,
      },
    ],
  },

  cross_channel_vnb_signal_queue: {
    sources: [
      {
        id: 'source_channel',
        label: 'Source channel',
        resolvedBy: ['dashboard-api.crossChannelVnbSignalQueueStatus'],
        contextKeys: ['channel', 'sourceSystem'],
        optional: false,
      },
      {
        id: 'source_ref',
        label: 'Auditable source reference',
        resolvedBy: ['dashboard-api.crossChannelVnbSignalQueueStatus'],
        contextKeys: ['sourceRef', 'sourceRefs'],
        optional: false,
      },
      {
        id: 'affected_process',
        label: 'Affected VNB process',
        resolvedBy: ['dashboard-api.crossChannelVnbSignalQueueStatus', 'vdmi.dossier'],
        contextKeys: ['affectedProcess', 'processType'],
        optional: false,
      },
      {
        id: 'owner_role',
        label: 'Owner role or persona',
        resolvedBy: ['dashboard-api.crossChannelVnbSignalQueueStatus', 'vdmi.dossier'],
        contextKeys: ['ownerRole', 'ownerPersonaId'],
        optional: false,
      },
      {
        id: 'due_date',
        label: 'SLA due date',
        resolvedBy: ['dashboard-api.crossChannelVnbSignalQueueStatus', 'hitl.create'],
        contextKeys: ['dueAt'],
        optional: false,
      },
      {
        id: 'evidence_status',
        label: 'Evidence status',
        resolvedBy: [
          'dashboard-api.crossChannelVnbSignalQueueStatus',
          'interface-placeholder.requestEvidence',
        ],
        contextKeys: ['evidenceStatus', 'evidenceRefs'],
        optional: false,
      },
      {
        id: 'risk_type',
        label: 'Risk type and severity',
        resolvedBy: ['dashboard-api.crossChannelVnbSignalQueueStatus'],
        contextKeys: ['riskType', 'riskSeverity'],
        optional: false,
      },
      {
        id: 'next_datapoint',
        label: 'Next operational datapoint',
        resolvedBy: ['dashboard-api.crossChannelVnbSignalQueueStatus', 'datapoint.health'],
        contextKeys: ['nextDatapoint'],
        optional: false,
      },
      {
        id: 'dedupe_key',
        label: 'Dedupe and provenance key',
        resolvedBy: ['dashboard-api.crossChannelVnbSignalQueueStatus'],
        contextKeys: ['dedupeKey'],
        optional: false,
      },
      {
        id: 'content_minimization',
        label: 'Privacy/content minimization confirmation',
        resolvedBy: ['dashboard-api.crossChannelVnbSignalQueueStatus'],
        contextKeys: ['privacy.contentMinimization', 'contentPolicy'],
        optional: false,
      },
    ],
  },

  asset_valuation_transformation_gate: {
    sources: [
      {
        id: 'book_value_source',
        label: 'Book value or residual-value source',
        resolvedBy: [
          'dashboard-api.assetValuationTransformationGateStatus',
          'finance-agent.analyze',
        ],
        contextKeys: ['bookValueStatus', 'bookValueSource'],
        optional: false,
      },
      {
        id: 'asset_condition_source',
        label: 'Asset condition evidence',
        resolvedBy: ['dashboard-api.assetValuationTransformationGateStatus', 'assets.effective'],
        contextKeys: ['assetConditionStatus', 'assetConditionSource'],
        optional: false,
      },
      {
        id: 'transformation_option_basis',
        label: 'Transformation option basis',
        resolvedBy: [
          'dashboard-api.assetValuationTransformationGateStatus',
          'gasnetz-waermeplanung.reconcile',
        ],
        contextKeys: ['transformationOption', 'transformationOptionBasis'],
        optional: false,
      },
      {
        id: 'contract_risk_basis',
        label: 'Contract and revenue-path risk basis',
        resolvedBy: ['dashboard-api.assetValuationTransformationGateStatus', 'vdmi.dossier'],
        contextKeys: ['contractRisk', 'contractRiskBasis'],
        optional: false,
      },
      {
        id: 'regulatory_uncertainty_basis',
        label: 'Regulatory uncertainty basis',
        resolvedBy: ['dashboard-api.assetValuationTransformationGateStatus', 'vdmi.dossier'],
        contextKeys: ['regulatoryUncertainty', 'regulatoryUncertaintyBasis'],
        optional: false,
      },
      {
        id: 'data_quality_status',
        label: 'Data quality status',
        resolvedBy: ['dashboard-api.assetValuationTransformationGateStatus', 'datapoint.health'],
        contextKeys: ['dataQualityStatus'],
        optional: false,
      },
      {
        id: 'decision_owner',
        label: 'Decision owner',
        resolvedBy: ['dashboard-api.assetValuationTransformationGateStatus', 'vdmi.dossier'],
        contextKeys: ['decisionOwner'],
        optional: false,
      },
      {
        id: 'next_decision',
        label: 'Next management decision',
        resolvedBy: ['dashboard-api.assetValuationTransformationGateStatus', 'presentation.render'],
        contextKeys: ['nextDecision'],
        optional: false,
      },
    ],
  },

  gas_capacity_booking_review_gate: {
    sources: [
      {
        id: 'capacity_assumption',
        label: 'Capacity assumption basis',
        resolvedBy: [
          'dashboard-api.gasCapacityBookingReviewGateStatus',
          'gasnetz-waermeplanung.reconcile',
        ],
        contextKeys: ['capacityAssumption', 'capacityAssumptionSource'],
        optional: false,
      },
      {
        id: 'cold_year_evidence',
        label: 'Cold-year stress evidence',
        resolvedBy: [
          'dashboard-api.gasCapacityBookingReviewGateStatus',
          'gasnetz-waermeplanung.reconcile',
        ],
        contextKeys: ['coldYearEvidence'],
        optional: false,
      },
      {
        id: 'rlm_rebound_evidence',
        label: 'RLM rebound evidence',
        resolvedBy: ['dashboard-api.gasCapacityBookingReviewGateStatus', 'datapoint.health'],
        contextKeys: ['rlmReboundEvidence'],
        optional: false,
      },
      {
        id: 'congestion_history_evidence',
        label: 'Congestion-history evidence',
        resolvedBy: [
          'dashboard-api.gasCapacityBookingReviewGateStatus',
          'gasnetz-waermeplanung.reconcile',
        ],
        contextKeys: ['congestionHistoryEvidence'],
        optional: false,
      },
      {
        id: 'vdmi_owner',
        label: 'VDMI review owner',
        resolvedBy: ['dashboard-api.gasCapacityBookingReviewGateStatus', 'vdmi.dossier'],
        contextKeys: ['vdmiOwner'],
        optional: false,
      },
      {
        id: 'decision_frame_ref',
        label: 'Decision-frame reference',
        resolvedBy: ['dashboard-api.gasCapacityBookingReviewGateStatus', 'decision-frame.get'],
        contextKeys: ['decisionFrameRef'],
        optional: false,
      },
      {
        id: 'commercial_signoff',
        label: 'Commercial review status',
        resolvedBy: [
          'dashboard-api.gasCapacityBookingReviewGateStatus',
          'vdmi-portfolio-gatekeeping.gate',
        ],
        contextKeys: ['commercialSignoff'],
        optional: false,
      },
      {
        id: 'risk_scenarios',
        label: 'Risk scenarios',
        resolvedBy: ['dashboard-api.gasCapacityBookingReviewGateStatus', 'presentation.render'],
        contextKeys: ['riskScenarios'],
        optional: false,
      },
      {
        id: 'source_refs',
        label: 'Source references',
        resolvedBy: ['dashboard-api.gasCapacityBookingReviewGateStatus'],
        contextKeys: ['sourceRefs'],
        optional: false,
      },
    ],
  },

  gas_transformation_dataroom_status: {
    sources: [
      {
        id: 'room_identity',
        label: 'Datenraum-/Mandatsprofil',
        resolvedBy: ['dashboard-api.gasTransformationDataroomStatus'],
        contextKeys: ['roomId', 'mandateId', 'profile'],
        optional: false,
      },
      {
        id: 'transformation_path',
        label: 'Transformationspfad',
        resolvedBy: [
          'dashboard-api.gasTransformationDataroomStatus',
          'gasnetz-waermeplanung.reconcile',
        ],
        contextKeys: ['transformationPath'],
        optional: false,
      },
      {
        id: 'scenario_reference',
        label: 'EOG-/KANU-/Fotojahr-Szenarioreferenz',
        resolvedBy: ['dashboard-api.gasTransformationDataroomStatus', 'eog-calculator.evaluate'],
        contextKeys: ['scenarioReference'],
        optional: false,
      },
      {
        id: 'evidence_register',
        label: 'Evidence Register Status',
        resolvedBy: ['dashboard-api.gasTransformationDataroomStatus', 'vdmi.dossier'],
        contextKeys: ['evidenceStatus'],
        optional: false,
      },
      {
        id: 'decision_log',
        label: 'Decision Log Status',
        resolvedBy: ['dashboard-api.gasTransformationDataroomStatus', 'vdmi.dossier'],
        contextKeys: ['decisionStatus'],
        optional: false,
      },
      {
        id: 'roadmap_snapshot',
        label: 'Roadmap-/Review-Snapshot',
        resolvedBy: [
          'dashboard-api.gasTransformationDataroomStatus',
          'dashboard-api.gasDecommissioningRoadmapStatus',
        ],
        contextKeys: ['roadmapStatus', 'reviewDate'],
        optional: false,
      },
      {
        id: 'owner_reviewer',
        label: 'Owner und Reviewer',
        resolvedBy: ['dashboard-api.gasTransformationDataroomStatus'],
        contextKeys: ['owner', 'reviewer'],
        optional: false,
      },
      {
        id: 'source_refs',
        label: 'Quellenreferenzen',
        resolvedBy: ['dashboard-api.gasTransformationDataroomStatus', 'knowledge-rag.search'],
        contextKeys: ['sourceRefs'],
        optional: false,
      },
    ],
  },

  gas_network_decision_chain: {
    sources: [
      {
        id: 'capacity_assumption',
        label: 'Capacity assumption and evidence reference',
        resolvedBy: [
          'dashboard-api.gasNetworkDecisionChainStatus',
          'gasnetz-waermeplanung.reconcile',
        ],
        contextKeys: ['capacityAssumption', 'capacityEvidenceRef'],
        optional: false,
      },
      {
        id: 'decommissioning_path',
        label: 'Stilllegung or reuse path evidence',
        resolvedBy: [
          'dashboard-api.gasNetworkDecisionChainStatus',
          'gasnetz-waermeplanung.reconcile',
        ],
        contextKeys: ['decommissioningPath', 'decommissioningEvidenceRef'],
        optional: false,
      },
      {
        id: 'regulatory_impact_refs',
        label: 'KANU/EOG/regulatory impact references',
        resolvedBy: ['dashboard-api.gasNetworkDecisionChainStatus', 'eog-calculator.evaluate'],
        contextKeys: ['regulatoryImpactRef', 'eogRef', 'kanuRef'],
        optional: false,
      },
      {
        id: 'asset_book_value_refs',
        label: 'Asset and book-value provenance',
        resolvedBy: ['dashboard-api.gasNetworkDecisionChainStatus', 'assets.effective'],
        contextKeys: ['assetRef', 'bookValueRef'],
        optional: false,
      },
      {
        id: 'photo_year_window',
        label: 'Fotojahr window and deadline',
        resolvedBy: ['dashboard-api.gasNetworkDecisionChainStatus', 'decision-frame.get'],
        contextKeys: ['photoYear', 'decisionDeadline'],
        optional: false,
      },
      {
        id: 'owner',
        label: 'Responsible management owner',
        resolvedBy: ['dashboard-api.gasNetworkDecisionChainStatus', 'vdmi.dossier'],
        contextKeys: ['owner', 'ownerRole'],
        optional: false,
      },
      {
        id: 'blocked_follow_up_decision',
        label: 'Blocked follow-up decision',
        resolvedBy: ['dashboard-api.gasNetworkDecisionChainStatus', 'decision-frame.get'],
        contextKeys: ['blockedFollowUpDecision'],
        optional: false,
      },
      {
        id: 'next_evidence_step',
        label: 'Next evidence step',
        resolvedBy: ['dashboard-api.gasNetworkDecisionChainStatus', 'vdmi.dossier'],
        contextKeys: ['nextEvidenceStep'],
        optional: false,
      },
      {
        id: 'source_refs',
        label: 'Source references',
        resolvedBy: ['dashboard-api.gasNetworkDecisionChainStatus'],
        contextKeys: ['sourceRefs'],
        optional: false,
      },
    ],
  },

  water_pricing_net_investment_alignment_gate: {
    sources: [
      {
        id: 'water_price_reference',
        label: 'Water-price assumption or calculation reference',
        resolvedBy: [
          'dashboard-api.waterPricingNetInvestmentAlignmentStatus',
          'regulatorische-entgeltlogik.evaluate',
        ],
        contextKeys: ['waterPriceReference', 'calculationReference'],
        optional: false,
      },
      {
        id: 'net_investment_reference',
        label: 'Net-investment or infrastructure-measure reference',
        resolvedBy: [
          'dashboard-api.waterPricingNetInvestmentAlignmentStatus',
          'investment-planning.review',
        ],
        contextKeys: ['netInvestmentReference', 'infrastructureMeasureReference'],
        optional: false,
      },
      {
        id: 'asset_accounting_reference',
        label: 'Anlagenbuchhaltung evidence reference',
        resolvedBy: [
          'dashboard-api.waterPricingNetInvestmentAlignmentStatus',
          'reporting-governance.evaluate',
        ],
        contextKeys: ['assetAccountingReference'],
        optional: false,
      },
      {
        id: 'lease_condition_reference',
        label: 'Pachtnetz, concession or lease-condition reference',
        resolvedBy: ['dashboard-api.waterPricingNetInvestmentAlignmentStatus', 'vdmi.dossier'],
        contextKeys: ['leaseOrConcessionReference', 'pachtnetzReference'],
        optional: false,
      },
      {
        id: 'regulatory_impact_reference',
        label: 'Regulatory-impact or tariff-logic boundary reference',
        resolvedBy: [
          'dashboard-api.waterPricingNetInvestmentAlignmentStatus',
          'regulatorische-entgeltlogik.evaluate',
        ],
        contextKeys: ['regulatoryImpactReference', 'tariffLogicReference'],
        optional: false,
      },
      {
        id: 'governance_owner',
        label: 'Governance or committee owner',
        resolvedBy: [
          'dashboard-api.waterPricingNetInvestmentAlignmentStatus',
          'reporting-governance.evaluate',
        ],
        contextKeys: ['governanceOwner', 'committeeOwner'],
        optional: false,
      },
      {
        id: 'review_window',
        label: 'Review period or target committee date',
        resolvedBy: [
          'dashboard-api.waterPricingNetInvestmentAlignmentStatus',
          'vdmi-portfolio-gatekeeping.evaluate',
        ],
        contextKeys: ['reviewPeriod', 'targetCommitteeDate'],
        optional: false,
      },
      {
        id: 'alignment_decision',
        label: 'Alignment decision state',
        resolvedBy: [
          'dashboard-api.waterPricingNetInvestmentAlignmentStatus',
          'vdmi-portfolio-gatekeeping.evaluate',
        ],
        contextKeys: ['alignmentDecision'],
        optional: false,
      },
      {
        id: 'source_refs',
        label: 'Source references',
        resolvedBy: ['dashboard-api.waterPricingNetInvestmentAlignmentStatus'],
        contextKeys: ['sourceRefs'],
        optional: false,
      },
    ],
  },

  areal_network_integration_offer_gate: {
    sources: [
      {
        id: 'site_reference',
        label: 'Areal or site reference',
        resolvedBy: [
          'dashboard-api.arealNetworkIntegrationOfferGateStatus',
          'grid-connection.validate',
        ],
        contextKeys: ['siteReference', 'areaReference'],
        optional: false,
      },
      {
        id: 'requested_connection_capacity',
        label: 'Requested connection capacity',
        resolvedBy: [
          'dashboard-api.arealNetworkIntegrationOfferGateStatus',
          'grid-connection.validate',
        ],
        contextKeys: ['requestedConnectionCapacity', 'requestedCapacityKw'],
        optional: false,
      },
      {
        id: 'grid_capacity_evidence',
        label: 'Grid-capacity evidence reference',
        resolvedBy: [
          'dashboard-api.arealNetworkIntegrationOfferGateStatus',
          'grid-connection.validate',
        ],
        contextKeys: ['gridCapacityEvidence', 'capacityEvidenceReference'],
        optional: false,
      },
      {
        id: 'target_grid_path',
        label: 'Target-grid path reference',
        resolvedBy: [
          'dashboard-api.arealNetworkIntegrationOfferGateStatus',
          'target-grid-planning.review',
        ],
        contextKeys: ['targetGridPath', 'zielnetzPath'],
        optional: false,
      },
      {
        id: 'investment_capex_reference',
        label: 'Investment or CAPEX impact reference',
        resolvedBy: [
          'dashboard-api.arealNetworkIntegrationOfferGateStatus',
          'investment-planning.review',
        ],
        contextKeys: ['investmentReference', 'capexReference'],
        optional: false,
      },
      {
        id: 'regulatory_impact_boundary',
        label: 'Regulatory-impact boundary reference',
        resolvedBy: [
          'dashboard-api.arealNetworkIntegrationOfferGateStatus',
          'regulatorische-entgeltlogik.evaluate',
        ],
        contextKeys: ['regulatoryImpactBoundary', 'regulatoryImpactReference'],
        optional: false,
      },
      {
        id: 'commercial_offer_assumptions',
        label: 'Commercial offer-assumption reference',
        resolvedBy: [
          'dashboard-api.arealNetworkIntegrationOfferGateStatus',
          'offer-management.review',
        ],
        contextKeys: ['commercialOfferAssumptions', 'offerAssumptionReference'],
        optional: false,
      },
      {
        id: 'owner',
        label: 'Gate owner',
        resolvedBy: ['dashboard-api.arealNetworkIntegrationOfferGateStatus', 'vdmi.dossier'],
        contextKeys: ['owner', 'gateOwner'],
        optional: false,
      },
      {
        id: 'next_decision_date',
        label: 'Next decision date',
        resolvedBy: ['dashboard-api.arealNetworkIntegrationOfferGateStatus', 'vdmi.dossier'],
        contextKeys: ['nextDecisionDate'],
        optional: false,
      },
      {
        id: 'offer_decision_status',
        label: 'Offer decision status',
        resolvedBy: [
          'dashboard-api.arealNetworkIntegrationOfferGateStatus',
          'offer-management.review',
        ],
        contextKeys: ['offerDecisionStatus'],
        optional: false,
      },
      {
        id: 'source_refs',
        label: 'Source references',
        resolvedBy: ['dashboard-api.arealNetworkIntegrationOfferGateStatus'],
        contextKeys: ['sourceRefs'],
        optional: false,
      },
    ],
  },

  live_update_stream_contract_status: {
    sources: [
      {
        id: 'channel_identity',
        label: 'Live-update channel or domain identity',
        resolvedBy: ['dashboard-api.liveUpdateStreamContractStatus'],
        contextKeys: ['channels', 'domains', 'uiSurface'],
        optional: false,
      },
      {
        id: 'source_binding',
        label: 'Source service/action binding',
        resolvedBy: ['dashboard-api.liveUpdateStreamContractStatus', 'service-catalog.lookup'],
        contextKeys: ['sourceService', 'sourceAction'],
        optional: false,
      },
      {
        id: 'tenant_auth_boundary',
        label: 'Tenant and auth boundary',
        resolvedBy: ['dashboard-api.liveUpdateStreamContractStatus', 'token-manager.verify'],
        contextKeys: ['authBoundary'],
        optional: false,
      },
      {
        id: 'fallback_polling_path',
        label: 'Safe fallback polling path',
        resolvedBy: ['dashboard-api.liveUpdateStreamContractStatus'],
        contextKeys: ['fallbackPollingPath'],
        optional: false,
      },
      {
        id: 'heartbeat_resume_policy',
        label: 'Heartbeat and resume policy expectation',
        resolvedBy: ['dashboard-api.liveUpdateStreamContractStatus'],
        contextKeys: ['requiresResume', 'heartbeatSeconds'],
        optional: false,
      },
      {
        id: 'owner',
        label: 'Contract owner',
        resolvedBy: ['dashboard-api.liveUpdateStreamContractStatus', 'vdmi.dossier'],
        contextKeys: ['ownerRole'],
        optional: false,
      },
    ],
  },

  smgw_connector_readiness_status: {
    sources: [
      {
        id: 'integration_scope',
        label: 'SMGW integration scope',
        resolvedBy: ['dashboard-api.smgwConnectorReadinessStatus'],
        contextKeys: ['integrationScope'],
        optional: false,
      },
      {
        id: 'tenant_auth_boundary',
        label: 'Tenant and auth boundary',
        resolvedBy: ['dashboard-api.smgwConnectorReadinessStatus', 'token-manager.verify'],
        contextKeys: ['authBoundary', 'tenantBoundary'],
        optional: false,
      },
      {
        id: 'adapter_class',
        label: 'Gateway or adapter class',
        resolvedBy: ['dashboard-api.smgwConnectorReadinessStatus', 'service-catalog.lookup'],
        contextKeys: ['gatewayClass', 'adapterClass'],
        optional: false,
      },
      {
        id: 'control_domain_intent',
        label: 'Control-domain intent and non-execution boundary',
        resolvedBy: ['dashboard-api.smgwConnectorReadinessStatus'],
        contextKeys: ['controlDomainIntent', 'fallbackReason'],
        optional: false,
      },
      {
        id: 'nes2_module_evidence',
        label: 'NES2 tariff-module readiness evidence',
        resolvedBy: ['dashboard-api.smgwConnectorReadinessStatus'],
        contextKeys: ['nes2ModuleEvidence'],
        optional: false,
      },
      {
        id: 'eebus_taf_evidence',
        label: 'EEBUS and TAF evidence',
        resolvedBy: ['dashboard-api.smgwConnectorReadinessStatus'],
        contextKeys: ['eebusEvidence', 'tafEvidence'],
        optional: false,
      },
      {
        id: 'audit_prerequisites',
        label: 'Compliance and audit prerequisites',
        resolvedBy: ['dashboard-api.smgwConnectorReadinessStatus', 'vdmi.dossier'],
        contextKeys: ['auditPrerequisites'],
        optional: false,
      },
      {
        id: 'owner',
        label: 'Readiness owner',
        resolvedBy: ['dashboard-api.smgwConnectorReadinessStatus', 'vdmi.dossier'],
        contextKeys: ['ownerRole'],
        optional: false,
      },
    ],
  },

  leadership_delta_cockpit: {
    sources: [
      {
        id: 'topic_identity',
        label: 'Leadership topic identity and domain',
        resolvedBy: ['dashboard-api.leadershipDeltaCockpitStatus', 'decision-frame.list'],
        contextKeys: ['topicId', 'topic', 'domain'],
        optional: false,
      },
      {
        id: 'delta_signals',
        label: 'New delta signals against the known baseline',
        resolvedBy: ['dashboard-api.leadershipDeltaCockpitStatus', 'vnb-monitor.snapshot'],
        contextKeys: ['knownBaseline', 'newSignals'],
        optional: false,
      },
      {
        id: 'owner_deadline',
        label: 'Owner and deadline',
        resolvedBy: ['dashboard-api.leadershipDeltaCockpitStatus', 'hitl.summary'],
        contextKeys: ['ownerRole', 'dueAt', 'dueBefore'],
        optional: false,
      },
      {
        id: 'evidence_status',
        label: 'Evidence status and source signals',
        resolvedBy: ['dashboard-api.leadershipDeltaCockpitStatus', 'evidence-planner.plan'],
        contextKeys: ['evidenceStatus', 'sourceSignals'],
        optional: false,
      },
      {
        id: 'blocked_decision',
        label: 'Blocked follow-up decision',
        resolvedBy: [
          'dashboard-api.leadershipDeltaCockpitStatus',
          'nova.listDecisions',
          'hitl.list',
        ],
        contextKeys: ['blockedDecision', 'status'],
        optional: false,
      },
      {
        id: 'escalation_next_lever',
        label: 'Escalation state and next lever',
        resolvedBy: ['dashboard-api.leadershipDeltaCockpitStatus', 'hitl.slaHeatmap'],
        contextKeys: ['escalationState', 'nextLever'],
        optional: false,
      },
      {
        id: 'linked_entity',
        label: 'Linked project, asset or process entity',
        resolvedBy: ['dashboard-api.leadershipDeltaCockpitStatus', 'vdmi.dossier'],
        contextKeys: ['linkedEntities'],
        optional: false,
      },
    ],
  },

  gas_grid_transformation_asset_cockpit: {
    sources: [
      {
        id: 'program_identity',
        label: 'Gas transformation program and work-package identity',
        resolvedBy: ['dashboard-api.gasGridTransformationAssetCockpitStatus'],
        contextKeys: ['gridOperatorId', 'transformationProgramId', 'workPackageId'],
        optional: false,
      },
      {
        id: 'asset_segment_scope',
        label: 'Gas asset segment scope',
        resolvedBy: ['dashboard-api.gasGridTransformationAssetCockpitStatus', 'assets.all'],
        contextKeys: ['assetSegmentRef'],
        optional: false,
      },
      {
        id: 'target_option',
        label: 'Target option for the gas asset segment',
        resolvedBy: [
          'dashboard-api.gasGridTransformationAssetCockpitStatus',
          'investment-planning.createPlan',
        ],
        contextKeys: ['targetOption'],
        optional: false,
      },
      {
        id: 'technical_reuse_status',
        label: 'Technical reuse or H2 assessment status',
        resolvedBy: [
          'dashboard-api.gasGridTransformationAssetCockpitStatus',
          'znp.assessPortfolio',
        ],
        contextKeys: ['technicalReuseStatus'],
        optional: false,
      },
      {
        id: 'decommissioning_cost_basis',
        label: 'Decommissioning, rollback or removal cost basis',
        resolvedBy: [
          'dashboard-api.gasGridTransformationAssetCockpitStatus',
          'investment-planning.createPlan',
        ],
        contextKeys: ['decommissioningCostEur', 'rollbackOrRemovalRisk'],
        optional: false,
      },
      {
        id: 'financial_impact_basis',
        label: 'Cashflow, TOTEX and regulatory recognition basis',
        resolvedBy: [
          'dashboard-api.gasGridTransformationAssetCockpitStatus',
          'finance-agent.analyze',
        ],
        contextKeys: ['cashflowImpact', 'totexImpact', 'regulatoryRecognitionStatus'],
        optional: false,
      },
      {
        id: 'dependency_review',
        label: 'Heat, power-grid and customer-transition dependency review',
        resolvedBy: [
          'dashboard-api.gasGridTransformationAssetCockpitStatus',
          'znp.assessPortfolio',
        ],
        contextKeys: [
          'heatNetworkDependency',
          'powerGridDependency',
          'customerTransitionDependency',
        ],
        optional: false,
      },
      {
        id: 'decision_gate_owner',
        label: 'Decision gate and owner role',
        resolvedBy: ['dashboard-api.gasGridTransformationAssetCockpitStatus', 'vdmi.dossier'],
        contextKeys: ['decisionGate', 'ownerRole'],
        optional: false,
      },
      {
        id: 'source_datapoints',
        label: 'Source datapoints or source actions',
        resolvedBy: [
          'dashboard-api.gasGridTransformationAssetCockpitStatus',
          'datasource-registry.get',
        ],
        contextKeys: ['sourceDatapoints', 'sourceActions'],
        optional: false,
      },
    ],
  },

  investment_budget_cap_exception_governance: {
    sources: [
      {
        id: 'measure_identity',
        label: 'Investment measure identity and scope',
        resolvedBy: ['dashboard-api.investmentBudgetCapExceptionGovernanceStatus'],
        contextKeys: ['measureId', 'measureName', 'scope'],
        optional: false,
      },
      {
        id: 'budget_cap',
        label: 'Budget cap evidence',
        resolvedBy: [
          'dashboard-api.investmentBudgetCapExceptionGovernanceStatus',
          'finance-agent.analyze',
        ],
        contextKeys: ['budgetCapEur'],
        optional: false,
      },
      {
        id: 'required_budget',
        label: 'Fachlicher Soll-Bedarf / required budget',
        resolvedBy: [
          'dashboard-api.investmentBudgetCapExceptionGovernanceStatus',
          'investment-planning.review',
        ],
        contextKeys: ['requiredBudgetEur'],
        optional: false,
      },
      {
        id: 'no_regret_and_technical_justification',
        label: 'No-Regret and technical/regulatory exception basis',
        resolvedBy: ['dashboard-api.investmentBudgetCapExceptionGovernanceStatus', 'vdmi.dossier'],
        contextKeys: ['noRegretCriterion', 'technicalJustification', 'regulatoryContext'],
        optional: false,
      },
      {
        id: 'kpi_reference',
        label: 'KPI-backed governance rationale',
        resolvedBy: [
          'dashboard-api.investmentBudgetCapExceptionGovernanceStatus',
          'presentation.generate',
        ],
        contextKeys: ['kpiReference'],
        optional: false,
      },
      {
        id: 'asset_context',
        label: 'Sparte or asset reference',
        resolvedBy: ['dashboard-api.investmentBudgetCapExceptionGovernanceStatus'],
        contextKeys: ['division', 'assetRef'],
        optional: false,
      },
      {
        id: 'evidence_refs',
        label: 'Audit-ready evidence references and data quality',
        resolvedBy: [
          'dashboard-api.investmentBudgetCapExceptionGovernanceStatus',
          'evidence-registry.lookup',
        ],
        contextKeys: ['evidenceRefs', 'dataQuality', 'sourceDatapoints'],
        optional: false,
      },
      {
        id: 'risk_owner_gate',
        label: 'Risk if deferred, owner, deadline and next gate',
        resolvedBy: ['dashboard-api.investmentBudgetCapExceptionGovernanceStatus', 'vdmi.dossier'],
        contextKeys: ['riskIfDeferred', 'owner', 'deadline', 'nextDecisionGate'],
        optional: false,
      },
      {
        id: 'exception_justification',
        label: 'Exception justification draft',
        resolvedBy: ['dashboard-api.investmentBudgetCapExceptionGovernanceStatus'],
        contextKeys: ['exceptionJustification'],
        optional: false,
      },
    ],
  },

  investment_owner_deadline_budget_gate: {
    sources: [
      {
        id: 'measure_identity',
        label: 'Investment measure identity',
        resolvedBy: ['dashboard-api.investmentOwnerDeadlineBudgetGateStatus'],
        contextKeys: ['measureId', 'measureTitle'],
        optional: false,
      },
      {
        id: 'owner',
        label: 'Accountable measure owner',
        resolvedBy: ['dashboard-api.investmentOwnerDeadlineBudgetGateStatus', 'vdmi.dossier'],
        contextKeys: ['owner'],
        optional: false,
      },
      {
        id: 'deadline',
        label: 'Deadline or target committee date',
        resolvedBy: ['dashboard-api.investmentOwnerDeadlineBudgetGateStatus', 'vdmi.dossier'],
        contextKeys: ['deadline'],
        optional: false,
      },
      {
        id: 'budget_effect',
        label: 'Budget effect evidence',
        resolvedBy: [
          'dashboard-api.investmentOwnerDeadlineBudgetGateStatus',
          'finance-agent.analyze',
          'investment-planning.review',
        ],
        contextKeys: ['budgetEffect'],
        optional: false,
      },
      {
        id: 'required_evidence',
        label: 'Required approval or measure evidence',
        resolvedBy: [
          'dashboard-api.investmentOwnerDeadlineBudgetGateStatus',
          'evidence-registry.lookup',
        ],
        contextKeys: ['requiredEvidence'],
        optional: false,
      },
      {
        id: 'approval_status',
        label: 'Approval status',
        resolvedBy: [
          'dashboard-api.investmentOwnerDeadlineBudgetGateStatus',
          'investment-planning.review',
        ],
        contextKeys: ['approvalStatus'],
        optional: false,
      },
      {
        id: 'blocked_follow_up_decision',
        label: 'Blocked follow-up decision',
        resolvedBy: ['dashboard-api.investmentOwnerDeadlineBudgetGateStatus', 'vdmi.dossier'],
        contextKeys: ['blockedFollowUpDecision'],
        optional: false,
      },
      {
        id: 'next_escalation_step',
        label: 'Next escalation step',
        resolvedBy: [
          'dashboard-api.investmentOwnerDeadlineBudgetGateStatus',
          'presentation.generate',
        ],
        contextKeys: ['nextEscalationStep'],
        optional: false,
      },
      {
        id: 'source_datapoints',
        label: 'Source datapoints and provenance',
        resolvedBy: [
          'dashboard-api.investmentOwnerDeadlineBudgetGateStatus',
          'datasource-registry.get',
        ],
        contextKeys: ['sourceDatapoints', 'sourceActions'],
        optional: false,
      },
    ],
  },

  no_regret_measure_definition_gate: {
    sources: [
      {
        id: 'measure_identity',
        label: 'No-Regret measure and programme identity',
        resolvedBy: ['dashboard-api.noRegretMeasureDefinitionGateStatus'],
        contextKeys: ['measureId', 'programmeId', 'measureName'],
        optional: false,
      },
      {
        id: 'scenario_effect',
        label: 'Scenario assumption and expected transformation effect',
        resolvedBy: ['dashboard-api.noRegretMeasureDefinitionGateStatus', 'vdmi.dossier'],
        contextKeys: ['scenarioAssumption', 'transformationEffect'],
        optional: false,
      },
      {
        id: 'budget_funding',
        label: 'Budget effect and funding owner basis',
        resolvedBy: [
          'dashboard-api.noRegretMeasureDefinitionGateStatus',
          'finance-agent.analyze',
          'investment-planning.review',
        ],
        contextKeys: ['budgetEffect', 'fundingOwner'],
        optional: false,
      },
      {
        id: 'regulatory_fit',
        label: 'Regulatory fit or constraint boundary',
        resolvedBy: [
          'dashboard-api.noRegretMeasureDefinitionGateStatus',
          'evidence-registry.lookup',
        ],
        contextKeys: ['regulatoryFit', 'constraintHint'],
        optional: false,
      },
      {
        id: 'prioritisation_rule',
        label: 'Prioritisation or nomination rule',
        resolvedBy: [
          'dashboard-api.noRegretMeasureDefinitionGateStatus',
          'investment-planning.review',
        ],
        contextKeys: ['prioritisationRule', 'nominationRight'],
        optional: false,
      },
      {
        id: 'data_quality',
        label: 'Data-quality status and source snapshot',
        resolvedBy: [
          'dashboard-api.noRegretMeasureDefinitionGateStatus',
          'datasource-registry.get',
        ],
        contextKeys: ['dataQualityStatus', 'sourceSnapshot'],
        optional: false,
      },
      {
        id: 'communication_rule',
        label: 'Communication rule and stakeholder boundary',
        resolvedBy: ['dashboard-api.noRegretMeasureDefinitionGateStatus', 'presentation.generate'],
        contextKeys: ['communicationRule', 'stakeholderGroup'],
        optional: false,
      },
      {
        id: 'review_gate',
        label: 'Next review gate, due date and accountable owner',
        resolvedBy: ['dashboard-api.noRegretMeasureDefinitionGateStatus', 'vdmi.dossier'],
        contextKeys: ['nextReviewGate', 'dueDate', 'owner'],
        optional: false,
      },
      {
        id: 'source_datapoints',
        label: 'Source datapoints and provenance',
        resolvedBy: [
          'dashboard-api.noRegretMeasureDefinitionGateStatus',
          'datasource-registry.get',
        ],
        contextKeys: ['sourceDatapoints', 'sourceActions'],
        optional: false,
      },
    ],
  },

  transformation_financing_scenario_view: {
    sources: [
      {
        id: 'scenario_identity',
        label: 'Scenario identity and planning horizon',
        resolvedBy: ['dashboard-api.transformationFinancingScenarioViewStatus'],
        contextKeys: ['scenarioId', 'gridOperatorId', 'planningHorizon', 'scenarioType'],
        optional: false,
      },
      {
        id: 'cashflow_source',
        label: 'Cashflow source evidence',
        resolvedBy: ['dashboard-api.transformationFinancingScenarioViewStatus', 'datapoint.health'],
        contextKeys: ['cashflowSource', 'cashflowSourceRef'],
        optional: false,
      },
      {
        id: 'margin_compensation_assumption',
        label: 'Margin compensation assumption',
        resolvedBy: [
          'dashboard-api.transformationFinancingScenarioViewStatus',
          'finance-agent.analyze',
        ],
        contextKeys: ['marginCompensationAssumption'],
        optional: false,
      },
      {
        id: 'capital_reallocation_option',
        label: 'Capital reallocation option',
        resolvedBy: [
          'dashboard-api.transformationFinancingScenarioViewStatus',
          'investment-planning.createPlan',
        ],
        contextKeys: ['capitalReallocationOption'],
        optional: false,
      },
      {
        id: 'gas_decommissioning_path',
        label: 'Gas decommissioning or continued-use path',
        resolvedBy: [
          'dashboard-api.transformationFinancingScenarioViewStatus',
          'gasnetz-waermeplanung.reconcile',
        ],
        contextKeys: ['gasDecommissioningPath'],
        optional: false,
      },
      {
        id: 'rollback_cost_basis',
        label: 'Rollback or removal cost basis',
        resolvedBy: [
          'dashboard-api.transformationFinancingScenarioViewStatus',
          'investment-planning.review',
        ],
        contextKeys: ['rollbackCostBasis'],
        optional: false,
      },
      {
        id: 'heat_h2_option_basis',
        label: 'Heat/H2 investment option basis',
        resolvedBy: [
          'dashboard-api.transformationFinancingScenarioViewStatus',
          'investment-planning.createPlan',
        ],
        contextKeys: ['heatInvestmentMeasure', 'h2OptionMeasure'],
        optional: false,
      },
      {
        id: 'municipal_burden_basis',
        label: 'Municipal, public-transport or shareholder burden basis',
        resolvedBy: [
          'dashboard-api.transformationFinancingScenarioViewStatus',
          'finance-agent.analyze',
        ],
        contextKeys: ['municipalBurdenAssumption', 'publicTransportShareholderBurden'],
        optional: false,
      },
      {
        id: 'operational_investment_need',
        label: 'Operational investment need',
        resolvedBy: [
          'dashboard-api.transformationFinancingScenarioViewStatus',
          'investment-planning.createPlan',
        ],
        contextKeys: ['operationalInvestmentNeed'],
        optional: false,
      },
      {
        id: 'eog_regulatory_impact',
        label: 'EOG or regulatory impact assumption',
        resolvedBy: [
          'dashboard-api.transformationFinancingScenarioViewStatus',
          'eog-calculator.scenario',
        ],
        contextKeys: ['eogImpact', 'regulatoryImpactAssumption'],
        optional: false,
      },
      {
        id: 'liquidity_impact_assumption',
        label: 'Liquidity impact assumption',
        resolvedBy: [
          'dashboard-api.transformationFinancingScenarioViewStatus',
          'finance-agent.analyze',
        ],
        contextKeys: ['liquidityImpact'],
        optional: false,
      },
      {
        id: 'stress_threshold',
        label: 'Stress threshold',
        resolvedBy: ['dashboard-api.transformationFinancingScenarioViewStatus', 'vdmi.dossier'],
        contextKeys: ['stressThreshold'],
        optional: false,
      },
      {
        id: 'committee_decision_gate',
        label: 'Committee decision gate and owner',
        resolvedBy: ['dashboard-api.transformationFinancingScenarioViewStatus', 'vdmi.dossier'],
        contextKeys: ['committeeDecisionGate', 'owner'],
        optional: false,
      },
      {
        id: 'source_datapoints',
        label: 'Source datapoints or source actions',
        resolvedBy: [
          'dashboard-api.transformationFinancingScenarioViewStatus',
          'datasource-registry.get',
        ],
        contextKeys: ['sourceDatapoints', 'sourceActions'],
        optional: false,
      },
    ],
  },

  anschlusskapazitaet_evidence_queue: {
    sources: [
      {
        id: 'connection_request_id',
        label: 'Connection request id',
        resolvedBy: [
          'dashboard-api.anschlusskapazitaetEvidenceQueueStatus',
          'grid-connection.validate',
        ],
        contextKeys: ['connectionRequestId'],
        optional: false,
      },
      {
        id: 'netzverknuepfungspunkt_hint',
        label: 'Netzverknuepfungspunkt hint',
        resolvedBy: [
          'dashboard-api.anschlusskapazitaetEvidenceQueueStatus',
          'grid-connection.validate',
        ],
        contextKeys: ['netzverknuepfungspunktHint'],
        optional: false,
      },
      {
        id: 'capacity_assumption',
        label: 'Capacity assumption',
        resolvedBy: [
          'dashboard-api.anschlusskapazitaetEvidenceQueueStatus',
          'grid-connection.capacityCheck',
        ],
        contextKeys: ['capacityAssumptionKw'],
        optional: false,
      },
      {
        id: 'grid_restriction_hint',
        label: 'Grid restriction hint',
        resolvedBy: [
          'dashboard-api.anschlusskapazitaetEvidenceQueueStatus',
          'grid-connection.capacityCheck',
        ],
        contextKeys: ['gridRestrictionHint'],
        optional: false,
      },
      {
        id: 'future_demand_context',
        label: 'Future-demand context',
        resolvedBy: ['dashboard-api.anschlusskapazitaetEvidenceQueueStatus', 'vdmi.dossier'],
        contextKeys: ['futureDemandContext'],
        optional: false,
      },
      {
        id: 'legal_question_marker',
        label: 'Legal question marker',
        resolvedBy: [
          'dashboard-api.anschlusskapazitaetEvidenceQueueStatus',
          'interface-placeholder.requestEvidence',
        ],
        contextKeys: ['legalQuestionMarker'],
        optional: false,
      },
      {
        id: 'fnav_option_marker',
        label: 'fNAV option marker',
        resolvedBy: [
          'dashboard-api.anschlusskapazitaetEvidenceQueueStatus',
          'interface-placeholder.requestEvidence',
        ],
        contextKeys: ['fnavOptionMarker'],
        optional: false,
      },
      {
        id: 'evidence_status',
        label: 'Evidence status',
        resolvedBy: [
          'dashboard-api.anschlusskapazitaetEvidenceQueueStatus',
          'evidence-registry.lookup',
        ],
        contextKeys: ['evidenceStatus'],
        optional: false,
      },
      {
        id: 'owner_due_date',
        label: 'Owner and due date',
        resolvedBy: ['dashboard-api.anschlusskapazitaetEvidenceQueueStatus', 'vdmi.dossier'],
        contextKeys: ['owner', 'dueDate'],
        optional: false,
      },
      {
        id: 'next_gate',
        label: 'Next management gate',
        resolvedBy: ['dashboard-api.anschlusskapazitaetEvidenceQueueStatus', 'vdmi.dossier'],
        contextKeys: ['nextGate'],
        optional: false,
      },
    ],
  },

  connection_deadline_evidence_queue: {
    sources: [
      {
        id: 'case_id',
        label: 'Connection case id',
        resolvedBy: [
          'dashboard-api.connectionDeadlineEvidenceQueueStatus',
          'grid-connection.validate',
        ],
        contextKeys: ['caseId', 'connectionCaseId'],
        optional: false,
      },
      {
        id: 'deadline_date',
        label: 'Deadline date',
        resolvedBy: ['dashboard-api.connectionDeadlineEvidenceQueueStatus', 'vdmi.dossier'],
        contextKeys: ['deadlineDate', 'dueDate'],
        optional: false,
      },
      {
        id: 'responsible_vnb',
        label: 'Responsible VNB',
        resolvedBy: [
          'dashboard-api.connectionDeadlineEvidenceQueueStatus',
          'grid-connection.validate',
        ],
        contextKeys: ['responsibleVnb', 'vnbName', 'gridOperatorId'],
        optional: false,
      },
      {
        id: 'technical_plausibility',
        label: 'Technical plausibility evidence',
        resolvedBy: [
          'dashboard-api.connectionDeadlineEvidenceQueueStatus',
          'grid-connection.validate',
        ],
        contextKeys: ['technicalPlausibility', 'technicalReadinessEvidence'],
        optional: false,
      },
      {
        id: 'owner',
        label: 'Owner',
        resolvedBy: ['dashboard-api.connectionDeadlineEvidenceQueueStatus', 'vdmi.dossier'],
        contextKeys: ['owner'],
        optional: false,
      },
      {
        id: 'next_gate',
        label: 'Next release or clarification gate',
        resolvedBy: ['dashboard-api.connectionDeadlineEvidenceQueueStatus', 'vdmi.dossier'],
        contextKeys: ['nextGate'],
        optional: false,
      },
      {
        id: 'clarification_points',
        label: 'Clarification points',
        resolvedBy: [
          'dashboard-api.connectionDeadlineEvidenceQueueStatus',
          'interface-placeholder.requestEvidence',
        ],
        contextKeys: ['clarificationPoints'],
        optional: true,
      },
      {
        id: 'communication_note_draft',
        label: 'Communication note draft',
        resolvedBy: ['dashboard-api.connectionDeadlineEvidenceQueueStatus', 'vdmi.dossier'],
        contextKeys: ['communicationContext', 'communicationNoteDraft'],
        optional: true,
      },
    ],
  },

  layer0_audit_drilldown_note: {
    sources: [
      {
        id: 'anomaly_scope',
        label: 'Layer-0 KPI or anomaly topic',
        resolvedBy: ['dashboard-api.layer0AuditDrilldownNoteStatus', 'evidence-registry.lookup'],
        contextKeys: ['kpiId', 'topic'],
        optional: false,
      },
      {
        id: 'data_source',
        label: 'Data source basis',
        resolvedBy: ['dashboard-api.layer0AuditDrilldownNoteStatus', 'datapoint.health'],
        contextKeys: ['dataSource'],
        optional: false,
      },
      {
        id: 'peer_deviation',
        label: 'Benchmark or peer deviation',
        resolvedBy: ['dashboard-api.layer0AuditDrilldownNoteStatus', 'vnb-monitor.snapshot'],
        contextKeys: ['peerDeviation', 'benchmarkPeerGroup'],
        optional: false,
      },
      {
        id: 'process_context',
        label: 'Process and period context',
        resolvedBy: ['dashboard-api.layer0AuditDrilldownNoteStatus', 'vdmi.dossier'],
        contextKeys: ['processHint', 'periodHint'],
        optional: true,
      },
      {
        id: 'observed_expected_value',
        label: 'Observed and expected value',
        resolvedBy: ['dashboard-api.layer0AuditDrilldownNoteStatus', 'mastr-quality.audit'],
        contextKeys: ['observedValue', 'expectedValue', 'unit'],
        optional: true,
      },
      {
        id: 'owner',
        label: 'Accountable owner',
        resolvedBy: ['dashboard-api.layer0AuditDrilldownNoteStatus', 'vdmi.dossier'],
        contextKeys: ['owner'],
        optional: false,
      },
      {
        id: 'next_90_day_focus',
        label: 'Next 90-day validation step',
        resolvedBy: ['dashboard-api.layer0AuditDrilldownNoteStatus', 'vdmi.dossier'],
        contextKeys: ['next90DayFocus'],
        optional: false,
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
