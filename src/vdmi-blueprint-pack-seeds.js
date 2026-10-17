'use strict';

const stadtwerkMauerPvMissingNap = require('./vdmi-blueprint-pack-seeds/stadtwerk-mauer-pv-missing-nap-v1.json');
const stadtwerkMauerRedispatchParticipationReadiness = require('./vdmi-blueprint-pack-seeds/stadtwerk-mauer-redispatch-participation-readiness-v1.json');
const stadtwerkMauerSubstationLoadAssessment = require('./vdmi-blueprint-pack-seeds/stadtwerk-mauer-substation-load-assessment-v1.json');
const stadtwerkMauerEnergySharingCollectiveApproval = require('./vdmi-blueprint-pack-seeds/stadtwerk-mauer-energy-sharing-collective-approval-v1.json');
const stadtwerkMauerConnectionDeadlineEvidenceQueue = require('./vdmi-blueprint-pack-seeds/stadtwerk-mauer-connection-deadline-evidence-queue-v1.json');
const stadtwerkMauerPortfolioMarketValueReadiness = require('./vdmi-blueprint-pack-seeds/stadtwerk-mauer-portfolio-market-value-readiness-v1.json');
const stadtwerkMauerGasTransformationDataroomReview = require('./vdmi-blueprint-pack-seeds/stadtwerk-mauer-gas-transformation-dataroom-review-v1.json');
const stadtwerkMauerCostReviewCommitteeReadiness = require('./vdmi-blueprint-pack-seeds/stadtwerk-mauer-cost-review-committee-readiness-v1.json');
const stadtwerkMauerMonitoringNonEscalationStatus = require('./vdmi-blueprint-pack-seeds/stadtwerk-mauer-monitoring-non-escalation-status-v1.json');
const stadtwerkMauerCrossSystemVarianceEvidenceMatrix = require('./vdmi-blueprint-pack-seeds/stadtwerk-mauer-cross-system-variance-evidence-matrix-v1.json');
const stadtwerkMauerDecommissionedAssetReconciliation = require('./vdmi-blueprint-pack-seeds/stadtwerk-mauer-decommissioned-asset-reconciliation-v1.json');
const stadtwerkMauerMastrSyncGapAlerting = require('./vdmi-blueprint-pack-seeds/stadtwerk-mauer-mastr-sync-gap-alerting-v1.json');
const stadtwerkMauerGridConnectionTransformationGate = require('./vdmi-blueprint-pack-seeds/stadtwerk-mauer-grid-connection-transformation-gate-v1.json');
const stadtwerkMauerInvestmentOwnerDeadlineBudgetGate = require('./vdmi-blueprint-pack-seeds/stadtwerk-mauer-investment-owner-deadline-budget-gate-v1.json');
const stadtwerkMauerDirectMarketerRiskGate = require('./vdmi-blueprint-pack-seeds/stadtwerk-mauer-direct-marketer-risk-gate-v1.json');
const stadtwerkMauerFlexibleGridConnectionReleaseFile = require('./vdmi-blueprint-pack-seeds/stadtwerk-mauer-flexible-grid-connection-release-file-v1.json');
const stadtwerkMauerModelViabilityManagementReview = require('./vdmi-blueprint-pack-seeds/stadtwerk-mauer-model-viability-management-review-v1.json');
const stadtwerkMauerTabularDecisionInputReadiness = require('./vdmi-blueprint-pack-seeds/stadtwerk-mauer-tabular-decision-input-readiness-v1.json');
const stadtwerkMauerMunicipalityPublicContextReadiness = require('./vdmi-blueprint-pack-seeds/stadtwerk-mauer-municipality-public-context-readiness-v1.json');
const stadtwerkMauerMakoResolutionValueReview = require('./vdmi-blueprint-pack-seeds/stadtwerk-mauer-mako-resolution-value-review-v1.json');
const stadtwerkMauerAssetToDecisionReadiness = require('./vdmi-blueprint-pack-seeds/stadtwerk-mauer-asset-to-decision-readiness-v1.json');

const REQUIRED_EVIDENCE = Object.freeze([
  'napReference',
  'maloId',
  'meloId',
  'meterId',
  'customerConsentStatus',
]);
const REQUIRED_REDISPATCH_READINESS_EVIDENCE = Object.freeze([
  'syntheticRedispatchAssetPortfolio',
  'installationGridLocationEvidence',
  'remoteControlCommunicationTestEvidence',
  'forecastDispatchTestProof',
  'readinessReviewDecision',
]);
const REQUIRED_SUBSTATION_LOAD_ASSESSMENT_EVIDENCE = Object.freeze([
  'stationBoundaryEvidence',
  'loadProfileEvidence',
  'forecastHorizonEvidence',
  'flexOptionEvidence',
  'capexOptionEvidence',
  'reviewGateMarker',
]);
const REQUIRED_ENERGY_SHARING_COLLECTIVE_APPROVAL_EVIDENCE = Object.freeze([
  'syntheticCollectiveBoundaryEvidence',
  'operatorParticipantBoundaryEvidence',
  'meteringConceptEvidence',
  'contractConsentMarketRoleEvidence',
  'allocationBillingSettlementGapEvidence',
  'approvalReadinessDecision',
]);
const REQUIRED_CONNECTION_DEADLINE_EVIDENCE = Object.freeze([
  'connectionCaseIntakeEvidence',
  'deadlineRiskEvidence',
  'technicalPlausibilityEvidence',
  'clarificationOwnerEvidence',
  'communicationNoteDraftEvidence',
  'nextGateReadinessEvidence',
]);
const REQUIRED_PORTFOLIO_MARKET_VALUE_READINESS_EVIDENCE = Object.freeze([
  'portfolioScopeEvidence',
  'syntheticAssetMixEvidence',
  'generationProfileEvidence',
  'dataQualityEvidence',
  'plausibilityEvidence',
  'spotPriceCoverageEvidence',
  'cacheCoverageEvidence',
  'noExternalCallEvidence',
  'marketValueBacktestEvidence',
  'negativePriceRiskEvidence',
  'captureRateEvidence',
  'readinessGateEvidence',
  'nonAdviceBoundaryEvidence',
]);
const REQUIRED_GAS_TRANSFORMATION_DATAROOM_REVIEW_EVIDENCE = Object.freeze([
  'roomProfileEvidence',
  'mandateBoundaryEvidence',
  'transformationPathEvidence',
  'assetGroupEvidence',
  'scenarioReferenceEvidence',
  'eogKanuBoundaryEvidence',
  'noLegalDecisionEvidence',
  'evidenceRegisterEvidence',
  'decisionLogEvidence',
  'missingEvidenceList',
  'roadmapReviewEvidence',
  'reviewSnapshotEvidence',
  'nextGateEvidence',
]);
const REQUIRED_COST_REVIEW_COMMITTEE_READINESS_EVIDENCE = Object.freeze([
  'costItemOwnerEvidence',
  'dataOriginEvidence',
  'assetRelevanceEvidence',
  'revenueMunicipalValueEvidence',
  'escalationThresholdEvidence',
  'nextCommitteeGateEvidence',
  'decisionReadinessMarker',
]);
const REQUIRED_MONITORING_NON_ESCALATION_STATUS_EVIDENCE = Object.freeze([
  'monitoringSourceFreshnessEvidence',
  'signalNoveltyEvidence',
  'absentBlockerEvidence',
  'nonEscalationRationaleEvidence',
  'ownerNextCheckEvidence',
  'missingEvidenceList',
  'reviewReadinessMarker',
]);
const REQUIRED_CROSS_SYSTEM_VARIANCE_EVIDENCE = Object.freeze([
  'sourceSystemEvidence',
  'targetSystemEvidence',
  'affectedObjectEvidence',
  'amountRevenueImpactEvidence',
  'assetScopeEvidence',
  'ownerEvidence',
  'deadlineEvidence',
  'thresholdEvidence',
  'evidenceReference',
]);
const REQUIRED_DECOMMISSIONED_ASSET_RECONCILIATION_EVIDENCE = Object.freeze([
  'gisDecommissionedAssetsEvidence',
  'sapAnlagenspiegelEvidence',
  'reconciliationDiscrepancyFeed',
  'reconciliationApprovalDecision',
]);
const REQUIRED_MASTR_SYNC_GAP_ALERTING_EVIDENCE = Object.freeze([
  'mastrFreshnessEvidence',
  'redispatchStammdatenComparison',
  'syncGapAlertFeed',
  'reconciliationApprovalDecision',
]);
const REQUIRED_GRID_CONNECTION_TRANSFORMATION_GATE_EVIDENCE = Object.freeze([
  'napMaloReferenceEvidence',
  'divisionEvidence',
  'transformationOptionEvidence',
  'dataQualityEvidence',
  'investmentPathEvidence',
  'decommissionPathEvidence',
  'ownerNextActionEvidence',
  'sourceReferenceEvidence',
]);
const REQUIRED_INVESTMENT_OWNER_DEADLINE_BUDGET_GATE_EVIDENCE = Object.freeze([
  'investmentMeasureIdentityEvidence',
  'accountableOwnerEvidence',
  'deadlineEvidence',
  'budgetEffectEvidence',
  'approvalSourceEvidence',
  'blockedDecisionEvidence',
  'nextEscalationGateEvidence',
  'readinessMarker',
]);
const REQUIRED_DIRECT_MARKETER_RISK_GATE_EVIDENCE = Object.freeze([
  'syntheticHandoverScopeEvidence',
  'forecastQualityEvidence',
  'allocationRuleEvidence',
  'balancingGroupScheduleImpactEvidence',
  'billingSettlementStatusEvidence',
  'ownerDeadlineEvidence',
  'riskGateReadinessEvidence',
]);
const REQUIRED_FLEXIBLE_GRID_CONNECTION_RELEASE_FILE_EVIDENCE = Object.freeze([
  'connectionRequestId',
  'gridConnectionPointRef',
  'requestedCapacityKw',
  'flexibilityConditionRef',
  'gridRestrictionEvidenceRef',
  'reservationStatus',
  'ownerRole',
  'deadlineDate',
  'contractBoundaryStatus',
  'nextGate',
]);

const REQUIRED_DATA_CLASSES = Object.freeze([
  'publicContextLayer',
  'syntheticTenantSeed',
  'sandboxRuntimeArtifact',
]);

const REQUIRED_ROLE_IDS = Object.freeze(['ROLE_NETZPLANUNG', 'ROLE_GRID_OPERATOR']);
const REQUIRED_REDISPATCH_READINESS_ROLE_IDS = Object.freeze([
  'ROLE_GRID_OPERATIONS_LEAD',
  'ROLE_CERNION_GOVERNANCE',
]);
const REQUIRED_SUBSTATION_LOAD_ASSESSMENT_ROLE_IDS = Object.freeze([
  'ROLE_ASSET_PLANNING_LEAD',
  'ROLE_CERNION_GOVERNANCE',
]);
const REQUIRED_ENERGY_SHARING_COLLECTIVE_APPROVAL_ROLE_IDS = Object.freeze([
  'ROLE_ENERGY_SHARING_PRODUCT_OWNER',
  'ROLE_CERNION_GOVERNANCE',
]);
const REQUIRED_CONNECTION_DEADLINE_ROLE_IDS = Object.freeze([
  'ROLE_NETZPLANUNG',
  'ROLE_ANSCHLUSSWESEN',
]);
const REQUIRED_PORTFOLIO_MARKET_VALUE_READINESS_ROLE_IDS = Object.freeze([
  'ROLE_PORTFOLIO_OWNER',
  'ROLE_CERNION_GOVERNANCE',
]);
const REQUIRED_GAS_TRANSFORMATION_DATAROOM_REVIEW_ROLE_IDS = Object.freeze([
  'ROLE_NETZSTRATEGIE',
  'ROLE_DATAROOM_OWNER',
  'ROLE_CERNION_GOVERNANCE',
]);
const REQUIRED_COST_REVIEW_COMMITTEE_READINESS_ROLE_IDS = Object.freeze([
  'ROLE_CONTROLLING',
  'ROLE_ASSET_PLANNING',
  'ROLE_CERNION_GOVERNANCE',
]);
const REQUIRED_MONITORING_NON_ESCALATION_STATUS_ROLE_IDS = Object.freeze([
  'ROLE_NETZFUEHRUNG',
  'ROLE_GOVERNANCE_OWNER',
  'ROLE_CERNION_GOVERNANCE',
]);
const REQUIRED_CROSS_SYSTEM_VARIANCE_ROLE_IDS = Object.freeze([
  'ROLE_ASSET_MDM_OWNER',
  'ROLE_COMMERCIAL_AUDIT',
  'ROLE_CONTROLLING',
  'ROLE_GOVERNANCE_OWNER',
  'ROLE_MANAGEMENT',
]);
const REQUIRED_DECOMMISSIONED_ASSET_RECONCILIATION_ROLE_IDS = Object.freeze([
  'ROLE_NETZPLANUNG',
  'ROLE_ANLAGENBUCHHALTUNG',
  'ROLE_CERNION_GOVERNANCE',
  'ROLE_COMMERCIAL_AUDIT',
]);
const REQUIRED_MASTR_SYNC_GAP_ALERTING_ROLE_IDS = Object.freeze([
  'ROLE_NETZBETRIEB',
  'ROLE_REDISPATCH_KOORDINATOR',
  'ROLE_CERNION_GOVERNANCE',
]);
const REQUIRED_GRID_CONNECTION_TRANSFORMATION_GATE_ROLE_IDS = Object.freeze([
  'ROLE_NETZPLANUNG',
  'ROLE_CERNION_GOVERNANCE',
  'ROLE_ASSET_MANAGEMENT',
  'ROLE_ADMINISTRATOR',
]);
const REQUIRED_INVESTMENT_OWNER_DEADLINE_BUDGET_GATE_ROLE_IDS = Object.freeze([
  'ROLE_ASSET_MANAGEMENT',
  'ROLE_CONTROLLING',
  'ROLE_GOVERNANCE_OWNER',
  'ROLE_CERNION_GOVERNANCE',
]);
const REQUIRED_DIRECT_MARKETER_RISK_GATE_ROLE_IDS = Object.freeze([
  'ROLE_MARKET_OPERATIONS',
  'ROLE_ENERGY_SHARING_LEAD',
  'ROLE_COMMERCIAL_AUDIT',
  'ROLE_CERNION_GOVERNANCE',
]);
const REQUIRED_FLEXIBLE_GRID_CONNECTION_RELEASE_FILE_ROLE_IDS = Object.freeze([
  'ROLE_NETZPLANUNG',
  'ROLE_ANSCHLUSSWESEN',
  'ROLE_GRID_OPERATIONS',
  'ROLE_COMMERCIAL_GOVERNANCE',
]);
const REQUIRED_MODEL_VIABILITY_MANAGEMENT_REVIEW_EVIDENCE = Object.freeze([
  'candidateScopeEvidence',
  'evidenceSnapshotReference',
  'processCostEvidence',
  'exceptionCaseEvidence',
  'liquidityImpactEvidence',
  'meteringMaturityEvidence',
  'roleMaturityEvidence',
  'timeseriesMaturityEvidence',
  'sourceFreshnessEvidence',
  'governanceEffortEvidence',
  'decisionOwnerEvidence',
  'nextReviewGateEvidence',
  'noCallGuardEvidence',
]);
const REQUIRED_MODEL_VIABILITY_MANAGEMENT_REVIEW_ROLE_IDS = Object.freeze([
  'ROLE_STRATEGY_OWNER',
  'ROLE_CERNION_GOVERNANCE',
  'ROLE_PROCESS_OWNER',
  'ROLE_MANAGEMENT',
  'ROLE_CONTROLLING',
  'ROLE_OPERATIONS_OWNER',
  'ROLE_DATA_GOVERNANCE',
  'ROLE_METERING_DATA_OWNER',
  'ROLE_COMMERCIAL_AUDIT',
]);
const REQUIRED_TABULAR_DECISION_INPUT_READINESS_EVIDENCE = Object.freeze([
  'tableScopeEvidence',
  'privacyContextEvidence',
  'profileHashEvidence',
  'schemaProfileEvidence',
  'missingValueEvidence',
  'duplicateEvidence',
  'intervalQualityEvidence',
  'outlierEvidence',
  'executedPlanEvidence',
  'sourceRowCountEvidence',
  'resultRowCountEvidence',
  'inputPlanResultHashEvidence',
  'warningEvidence',
  'decisionInputReadinessEvidence',
  'clarificationOwnerEvidence',
  'nextSafeGateEvidence',
  'noCallGuardEvidence',
]);
const REQUIRED_TABULAR_DECISION_INPUT_READINESS_ROLE_IDS = Object.freeze([
  'ROLE_DATA_GOVERNANCE',
  'ROLE_CERNION_GOVERNANCE',
  'ROLE_DATASOURCE_OWNER',
  'ROLE_METERING_DATA_OWNER',
  'ROLE_PROCESS_OWNER',
  'ROLE_COMMERCIAL_AUDIT',
  'ROLE_MANAGEMENT',
]);
const REQUIRED_MUNICIPALITY_PUBLIC_CONTEXT_EVIDENCE = Object.freeze([
  'municipalityIdentityEvidence',
  'agsEvidence',
  'postalCodeScopeEvidence',
  'sourceSnapshotEvidence',
  'mastrContextEvidence',
  'osmContextEvidence',
  'sourceFreshnessEvidence',
  'publicContextBoundaryEvidence',
  'loadDerivationEvidence',
  'landUseEvidence',
  'heuristicBoundaryEvidence',
  'missingEvidence',
  'reviewReadinessEvidence',
  'nextSafeGateEvidence',
  'noCallGuardEvidence',
  'downstreamSyncEvidence',
]);
const REQUIRED_MUNICIPALITY_PUBLIC_CONTEXT_ROLE_IDS = Object.freeze([
  'ROLE_DATA_GOVERNANCE',
  'ROLE_NETZPLANUNG',
  'ROLE_MUNICIPAL_STRATEGY',
  'ROLE_CERNION_GOVERNANCE',
]);
const REQUIRED_MAKO_RESOLUTION_VALUE_REVIEW_EVIDENCE = Object.freeze([
  'caseScopeEvidence',
  'messageAndProcessEvidence',
  'sourceSnapshotEvidence',
  'confirmedInvoiceAmountEvidence',
  'marketPartnerConfirmationEvidence',
  'ownerApprovalEvidence',
  'qualitativeResolutionValueEvidence',
  'evidenceGapEvidence',
  'forbiddenClaimEvidence',
  'clarificationOwnerEvidence',
  'nextHumanGateEvidence',
  'hitlBoundaryEvidence',
  'noCallGuardEvidence',
]);
const REQUIRED_MAKO_RESOLUTION_VALUE_REVIEW_ROLE_IDS = Object.freeze([
  'ROLE_MAKO_OWNER',
  'ROLE_BILLING',
  'ROLE_FINANCE',
  'ROLE_COMPLIANCE',
]);
const REQUIRED_ASSET_TO_DECISION_READINESS_EVIDENCE = Object.freeze([
  'assetConditionSourceEvidence',
  'technicalSignalContextEvidence',
  'evidenceReceiptEvidence',
  'riskQuantificationEvidence',
  'alternativeOptionsEvidence',
  'regulatoryAssessmentEvidence',
  'controllingBudgetEvidence',
  'budgetOwnerConfirmationEvidence',
  'capexOpexClassificationEvidence',
  'decisionOwnerEvidence',
  'committeeReadinessBoundaryEvidence',
  'positiveFollowUpEvidence',
  'noCallGuardEvidence',
  'qualitativeResolutionValueEvidence',
]);
const REQUIRED_ASSET_TO_DECISION_READINESS_ROLE_IDS = Object.freeze([
  'ROLE_ASSET',
  'ROLE_NETZPLANUNG',
  'ROLE_CONTROLLING',
  'ROLE_REGULATORIK',
  'ROLE_GESCHAEFTSFUEHRUNG',
  'ROLE_CERNION_GOVERNANCE',
]);
const ASSET_TO_DECISION_READINESS_CONTRACT = Object.freeze({
  headers: Object.freeze([
    'Phase',
    'V = Verantwortlich',
    'D = Durchfuehrend',
    'M = Mitwirkend',
    'I = Informiert',
    'Nachweise',
  ]),
  rows: Object.freeze([
    Object.freeze({
      phase: '1',
      v: 'ROLE_ASSET',
      d: 'ROLE_CERNION_GOVERNANCE',
      m: 'ROLE_NETZPLANUNG',
      i: 'ROLE_GESCHAEFTSFUEHRUNG',
      evidenceRequirements: Object.freeze([
        'assetConditionSourceEvidence',
        'technicalSignalContextEvidence',
        'evidenceReceiptEvidence',
      ]),
      status: 'clarification',
      gateOutcome: 'asset_signal_provenance_review_pending',
    }),
    Object.freeze({
      phase: '2',
      v: 'ROLE_ASSET',
      d: 'ROLE_NETZPLANUNG',
      m: 'ROLE_REGULATORIK',
      i: 'ROLE_GESCHAEFTSFUEHRUNG',
      evidenceRequirements: Object.freeze([
        'riskQuantificationEvidence',
        'alternativeOptionsEvidence',
        'regulatoryAssessmentEvidence',
      ]),
      status: 'evidence_gap',
      gateOutcome: 'risk_alternatives_regulatory_evidence_pending',
    }),
    Object.freeze({
      phase: '3',
      v: 'ROLE_ASSET',
      d: 'ROLE_CONTROLLING',
      m: 'ROLE_NETZPLANUNG',
      i: 'ROLE_GESCHAEFTSFUEHRUNG',
      evidenceRequirements: Object.freeze([
        'controllingBudgetEvidence',
        'budgetOwnerConfirmationEvidence',
        'capexOpexClassificationEvidence',
      ]),
      status: 'evidence_gap',
      gateOutcome: 'budget_classification_and_owner_evidence_pending',
    }),
    Object.freeze({
      phase: '4',
      v: 'ROLE_GESCHAEFTSFUEHRUNG',
      d: 'ROLE_CERNION_GOVERNANCE',
      m: 'ROLE_ASSET',
      i: 'ROLE_CONTROLLING',
      evidenceRequirements: Object.freeze([
        'decisionOwnerEvidence',
        'committeeReadinessBoundaryEvidence',
        'positiveFollowUpEvidence',
        'noCallGuardEvidence',
      ]),
      status: 'clarification',
      gateOutcome: 'human_investment_review_ready_or_evidence_gap',
    }),
  ]),
  sourceApiPaths: Object.freeze([
    '/api/dashboard/investment-data-review-queue',
    '/api/dashboard/investment-risk-translation',
    '/api/dashboard/investment-owner-deadline-budget-gate',
    '/api/dashboard/investment-committee-steering-cards',
    '/api/dashboard/decision-readiness-matrix',
    '/api/dashboard/evidence-grounding-confidence-audit',
    '/api/dashboard/receipt-grounded-presentation-contract',
    '/api/governance/role-workbench',
  ]),
  resolutionValueDimensions: Object.freeze([
    'data_quality_improvement',
    'compliance_audit_improvement',
    'forecast_budget_confidence',
  ]),
  noCallActions: Object.freeze([
    'state_budget_commitment',
    'mark_committee_ready',
    'recommend_final_investment_decision',
    'budget_release',
    'investment_ranking_or_scoring',
    'committee_vote_or_scheduling',
    'asset_mdm_write',
    'gis_write',
    'erp_write',
    'sap_psp_write',
    'workflow_create',
    'task_create',
    'hitl_create',
    'mail_send',
    'webhook_call',
    'external_connector_call',
    'budibase_table_write',
    'rundeck_execute',
    'production_mutation',
  ]),
});
const EXECUTABLE_HINT_KEYS = Object.freeze([
  'command',
  'script',
  'execute',
  'invoke',
  'rundeckJobId',
  'httpRequest',
  'url',
]);
const QUANTITATIVE_RESOLUTION_VALUE_KEYS = Object.freeze([
  'amount',
  'value',
  'eur',
  'score',
  'rank',
  'roi',
  'npv',
  'totex',
  'savings',
]);
const QUANTITATIVE_RESOLUTION_VALUE_PATTERN =
  /\d|€|\bEUR\b|\bscore|\brank|\bROI\b|\bNPV\b|\bTOTEX\b|\bsaving|Einsparung/i;
const REQUIRED_MATRIX_ROLE_KEYS = Object.freeze(['v', 'd', 'm', 'i']);
const MATRIX_HEADER_WORDS = Object.freeze([
  'Phase',
  'Verantwortlich',
  'Durchfuehrend',
  'Mitwirkend',
  'Informiert',
  'Nachweise',
]);

const SEEDS = Object.freeze([
  stadtwerkMauerPvMissingNap,
  stadtwerkMauerRedispatchParticipationReadiness,
  stadtwerkMauerSubstationLoadAssessment,
  stadtwerkMauerEnergySharingCollectiveApproval,
  stadtwerkMauerConnectionDeadlineEvidenceQueue,
  stadtwerkMauerPortfolioMarketValueReadiness,
  stadtwerkMauerGasTransformationDataroomReview,
  stadtwerkMauerCostReviewCommitteeReadiness,
  stadtwerkMauerMonitoringNonEscalationStatus,
  stadtwerkMauerCrossSystemVarianceEvidenceMatrix,
  stadtwerkMauerDecommissionedAssetReconciliation,
  stadtwerkMauerMastrSyncGapAlerting,
  stadtwerkMauerGridConnectionTransformationGate,
  stadtwerkMauerInvestmentOwnerDeadlineBudgetGate,
  stadtwerkMauerDirectMarketerRiskGate,
  stadtwerkMauerFlexibleGridConnectionReleaseFile,
  stadtwerkMauerModelViabilityManagementReview,
  stadtwerkMauerTabularDecisionInputReadiness,
  stadtwerkMauerMunicipalityPublicContextReadiness,
  stadtwerkMauerMakoResolutionValueReview,
  stadtwerkMauerAssetToDecisionReadiness,
]);

const SEED_VALIDATION_REQUIREMENTS = Object.freeze({
  [stadtwerkMauerPvMissingNap.id]: Object.freeze({
    requiredEvidence: REQUIRED_EVIDENCE,
    requiredRoleIds: REQUIRED_ROLE_IDS,
    expectedMatrixSlug: 'pv-registration-missing-nap',
  }),
  [stadtwerkMauerRedispatchParticipationReadiness.id]: Object.freeze({
    requiredEvidence: REQUIRED_REDISPATCH_READINESS_EVIDENCE,
    requiredRoleIds: REQUIRED_REDISPATCH_READINESS_ROLE_IDS,
    expectedMatrixSlug: 'redispatch-participation-readiness',
  }),
  [stadtwerkMauerSubstationLoadAssessment.id]: Object.freeze({
    requiredEvidence: REQUIRED_SUBSTATION_LOAD_ASSESSMENT_EVIDENCE,
    requiredRoleIds: REQUIRED_SUBSTATION_LOAD_ASSESSMENT_ROLE_IDS,
    expectedMatrixSlug: 'substation-load-assessment',
  }),
  [stadtwerkMauerEnergySharingCollectiveApproval.id]: Object.freeze({
    requiredEvidence: REQUIRED_ENERGY_SHARING_COLLECTIVE_APPROVAL_EVIDENCE,
    requiredRoleIds: REQUIRED_ENERGY_SHARING_COLLECTIVE_APPROVAL_ROLE_IDS,
    expectedMatrixSlug: 'energy-sharing-collective-approval',
  }),
  [stadtwerkMauerConnectionDeadlineEvidenceQueue.id]: Object.freeze({
    requiredEvidence: REQUIRED_CONNECTION_DEADLINE_EVIDENCE,
    requiredRoleIds: REQUIRED_CONNECTION_DEADLINE_ROLE_IDS,
    expectedMatrixSlug: 'connection-deadline-evidence-queue',
  }),
  [stadtwerkMauerPortfolioMarketValueReadiness.id]: Object.freeze({
    requiredEvidence: REQUIRED_PORTFOLIO_MARKET_VALUE_READINESS_EVIDENCE,
    requiredRoleIds: REQUIRED_PORTFOLIO_MARKET_VALUE_READINESS_ROLE_IDS,
    expectedMatrixSlug: 'portfolio-market-value-readiness',
  }),
  [stadtwerkMauerGasTransformationDataroomReview.id]: Object.freeze({
    requiredEvidence: REQUIRED_GAS_TRANSFORMATION_DATAROOM_REVIEW_EVIDENCE,
    requiredRoleIds: REQUIRED_GAS_TRANSFORMATION_DATAROOM_REVIEW_ROLE_IDS,
    expectedMatrixSlug: 'gas-transformation-dataroom-review',
  }),
  [stadtwerkMauerCostReviewCommitteeReadiness.id]: Object.freeze({
    requiredEvidence: REQUIRED_COST_REVIEW_COMMITTEE_READINESS_EVIDENCE,
    requiredRoleIds: REQUIRED_COST_REVIEW_COMMITTEE_READINESS_ROLE_IDS,
    expectedMatrixSlug: 'cost-review-committee-readiness',
  }),
  [stadtwerkMauerMonitoringNonEscalationStatus.id]: Object.freeze({
    requiredEvidence: REQUIRED_MONITORING_NON_ESCALATION_STATUS_EVIDENCE,
    requiredRoleIds: REQUIRED_MONITORING_NON_ESCALATION_STATUS_ROLE_IDS,
    expectedMatrixSlug: 'monitoring-non-escalation-status',
  }),
  [stadtwerkMauerCrossSystemVarianceEvidenceMatrix.id]: Object.freeze({
    requiredEvidence: REQUIRED_CROSS_SYSTEM_VARIANCE_EVIDENCE,
    requiredRoleIds: REQUIRED_CROSS_SYSTEM_VARIANCE_ROLE_IDS,
    expectedMatrixSlug: 'cross-system-variance-evidence-matrix',
  }),
  [stadtwerkMauerDecommissionedAssetReconciliation.id]: Object.freeze({
    requiredEvidence: REQUIRED_DECOMMISSIONED_ASSET_RECONCILIATION_EVIDENCE,
    requiredRoleIds: REQUIRED_DECOMMISSIONED_ASSET_RECONCILIATION_ROLE_IDS,
    expectedMatrixSlug: 'decommissioned-asset-reconciliation',
  }),
  [stadtwerkMauerMastrSyncGapAlerting.id]: Object.freeze({
    requiredEvidence: REQUIRED_MASTR_SYNC_GAP_ALERTING_EVIDENCE,
    requiredRoleIds: REQUIRED_MASTR_SYNC_GAP_ALERTING_ROLE_IDS,
    expectedMatrixSlug: 'mastr-sync-gap-alerting',
  }),
  [stadtwerkMauerGridConnectionTransformationGate.id]: Object.freeze({
    requiredEvidence: REQUIRED_GRID_CONNECTION_TRANSFORMATION_GATE_EVIDENCE,
    requiredRoleIds: REQUIRED_GRID_CONNECTION_TRANSFORMATION_GATE_ROLE_IDS,
    expectedMatrixSlug: 'grid-connection-transformation-gate',
  }),
  [stadtwerkMauerInvestmentOwnerDeadlineBudgetGate.id]: Object.freeze({
    requiredEvidence: REQUIRED_INVESTMENT_OWNER_DEADLINE_BUDGET_GATE_EVIDENCE,
    requiredRoleIds: REQUIRED_INVESTMENT_OWNER_DEADLINE_BUDGET_GATE_ROLE_IDS,
    expectedMatrixSlug: 'investment-owner-deadline-budget-gate',
  }),
  [stadtwerkMauerDirectMarketerRiskGate.id]: Object.freeze({
    requiredEvidence: REQUIRED_DIRECT_MARKETER_RISK_GATE_EVIDENCE,
    requiredRoleIds: REQUIRED_DIRECT_MARKETER_RISK_GATE_ROLE_IDS,
    expectedMatrixSlug: 'direct-marketer-risk-gate',
  }),
  [stadtwerkMauerFlexibleGridConnectionReleaseFile.id]: Object.freeze({
    requiredEvidence: REQUIRED_FLEXIBLE_GRID_CONNECTION_RELEASE_FILE_EVIDENCE,
    requiredRoleIds: REQUIRED_FLEXIBLE_GRID_CONNECTION_RELEASE_FILE_ROLE_IDS,
    expectedMatrixSlug: 'flexible-grid-connection-release-file',
  }),
  [stadtwerkMauerModelViabilityManagementReview.id]: Object.freeze({
    requiredEvidence: REQUIRED_MODEL_VIABILITY_MANAGEMENT_REVIEW_EVIDENCE,
    requiredRoleIds: REQUIRED_MODEL_VIABILITY_MANAGEMENT_REVIEW_ROLE_IDS,
    expectedMatrixSlug: 'model-viability-management-review',
  }),
  [stadtwerkMauerTabularDecisionInputReadiness.id]: Object.freeze({
    requiredEvidence: REQUIRED_TABULAR_DECISION_INPUT_READINESS_EVIDENCE,
    requiredRoleIds: REQUIRED_TABULAR_DECISION_INPUT_READINESS_ROLE_IDS,
    expectedMatrixSlug: 'tabular-decision-input-readiness',
  }),
  [stadtwerkMauerMunicipalityPublicContextReadiness.id]: Object.freeze({
    requiredEvidence: REQUIRED_MUNICIPALITY_PUBLIC_CONTEXT_EVIDENCE,
    requiredRoleIds: REQUIRED_MUNICIPALITY_PUBLIC_CONTEXT_ROLE_IDS,
    expectedMatrixSlug: 'municipality-public-context-readiness',
  }),
  [stadtwerkMauerMakoResolutionValueReview.id]: Object.freeze({
    requiredEvidence: REQUIRED_MAKO_RESOLUTION_VALUE_REVIEW_EVIDENCE,
    requiredRoleIds: REQUIRED_MAKO_RESOLUTION_VALUE_REVIEW_ROLE_IDS,
    expectedMatrixSlug: 'mako-m2c-resolution-value-review',
  }),
  [stadtwerkMauerAssetToDecisionReadiness.id]: Object.freeze({
    requiredEvidence: REQUIRED_ASSET_TO_DECISION_READINESS_EVIDENCE,
    requiredRoleIds: REQUIRED_ASSET_TO_DECISION_READINESS_ROLE_IDS,
    expectedMatrixSlug: 'asset-to-decision-readiness-review',
    strictContract: ASSET_TO_DECISION_READINESS_CONTRACT,
  }),
});

function getSeedValidationRequirements(seed) {
  return (
    SEED_VALIDATION_REQUIREMENTS[seed?.id] || {
      requiredEvidence: [],
      requiredRoleIds: [],
      expectedMatrixSlug: seed?.demoProcessMatrix?.slug || null,
    }
  );
}

function sameList(actual, expected) {
  return (
    Array.isArray(actual) &&
    actual.length === expected.length &&
    actual.every((value, index) => value === expected[index])
  );
}

function collectQuantitativeResolutionValueErrors(value, path, errors) {
  if (typeof value === 'number') {
    errors.push(`${path} must be qualitative, not numeric`);
  } else if (typeof value === 'string') {
    if (QUANTITATIVE_RESOLUTION_VALUE_PATTERN.test(value)) {
      errors.push(`${path} must not contain numeric/EUR/score/rank/ROI/NPV/TOTEX/savings claims`);
    }
  } else if (Array.isArray(value)) {
    value.forEach((item, index) =>
      collectQuantitativeResolutionValueErrors(item, `${path}[${index}]`, errors)
    );
  } else if (value && typeof value === 'object') {
    for (const [key, nested] of Object.entries(value)) {
      if (QUANTITATIVE_RESOLUTION_VALUE_KEYS.includes(key.toLowerCase())) {
        errors.push(`${path}.${key} is a forbidden quantitative Resolution Value field`);
      }
      collectQuantitativeResolutionValueErrors(nested, `${path}.${key}`, errors);
    }
  }
}

// Fail-closed contract checks for seeds whose issue fixes the exact matrix, source hints,
// qualitative Resolution Value and no-call boundary (#592). Other seeds are unaffected.
function collectStrictContractErrors(seed, contract) {
  const errors = [];
  const matrix = seed.demoProcessMatrix || {};

  if (!sameList(matrix.headers, contract.headers)) {
    errors.push('demoProcessMatrix.headers must be the six canonical presentation headers');
  }
  const rows = Array.isArray(matrix.rows) ? matrix.rows : [];
  if (rows.length !== contract.rows.length) {
    errors.push(`demoProcessMatrix.rows must contain exactly ${contract.rows.length} rows`);
  }
  contract.rows.forEach((expected, index) => {
    const row = rows[index] || {};
    for (const key of ['phase', ...REQUIRED_MATRIX_ROLE_KEYS, 'status', 'gateOutcome']) {
      if (row[key] !== expected[key]) {
        errors.push(`demoProcessMatrix row ${expected.phase} ${key} must be ${expected[key]}`);
      }
    }
    if (!sameList(row.evidenceRequirements, expected.evidenceRequirements)) {
      errors.push(
        `demoProcessMatrix row ${expected.phase} evidenceRequirements must be ${expected.evidenceRequirements.join(', ')}`
      );
    }
  });

  const evidenceById = new Map((seed.evidenceRequirements || []).map((item) => [item.id, item]));
  for (const item of evidenceById.values()) {
    if (!['clarification', 'evidence_gap'].includes(item.missingState)) {
      errors.push(`evidence requirement ${item.id} must map to clarification or evidence_gap`);
    }
  }

  const sourceApis = Array.isArray(seed.sourceApis) ? seed.sourceApis : [];
  const sourcePaths = new Set(sourceApis.map((api) => api.path));
  for (const path of contract.sourceApiPaths) {
    if (!sourcePaths.has(path)) errors.push(`missing source hint: ${path}`);
  }
  for (const api of sourceApis) {
    const label = api.path || api.operation || 'unknown';
    if (!contract.sourceApiPaths.includes(api.path)) {
      errors.push(`source hint ${label} is not an allowed existing read model`);
    }
    if (api.method !== 'GET' || api.readOnly !== true) {
      errors.push(`source hint ${label} must be a read-only GET reference`);
    }
    if (api.invocation !== 'source_hint_only') {
      errors.push(`source hint ${label} must be source_hint_only`);
    }
    if (EXECUTABLE_HINT_KEYS.some((key) => key in api)) {
      errors.push(`source hint ${label} must not carry executable fields`);
    }
  }
  for (const hint of seed.allowedCommandHints || []) {
    if (EXECUTABLE_HINT_KEYS.some((key) => key in hint)) {
      errors.push(`command hint ${hint.id || hint.kind} must not carry executable fields`);
    }
  }

  const resolutionValue = seed.resolutionValue;
  if (!resolutionValue || resolutionValue.kind !== 'qualitative_only') {
    errors.push('resolutionValue.kind must be qualitative_only');
  } else {
    if (!evidenceById.has(resolutionValue.evidenceRef)) {
      errors.push('resolutionValue.evidenceRef must reference a separate evidence requirement');
    }
    const dimensions = Array.isArray(resolutionValue.dimensions) ? resolutionValue.dimensions : [];
    if (dimensions.length === 0) errors.push('resolutionValue.dimensions must not be empty');
    for (const entry of dimensions) {
      if (!contract.resolutionValueDimensions.includes(entry.dimension)) {
        errors.push(`resolutionValue dimension ${entry.dimension} is not allowed`);
      }
    }
    const { forbiddenClaims: _forbiddenClaims, ...claims } = resolutionValue;
    collectQuantitativeResolutionValueErrors(claims, 'resolutionValue', errors);
  }

  const dataClasses = seed.dataClasses || {};
  if (dataClasses.publicContextLayer?.immutable !== true) {
    errors.push('publicContextLayer must be immutable');
  }
  if (dataClasses.syntheticTenantSeed?.invented !== true) {
    errors.push('syntheticTenantSeed must be marked invented');
  }
  if (dataClasses.sandboxRuntimeArtifact?.resettable !== true) {
    errors.push('sandboxRuntimeArtifact must be resettable');
  }
  const resettable = seed.resetPolicy?.resettableDataClasses || [];
  if (
    dataClasses.publicContextLayer?.resettable !== false ||
    resettable.includes('publicContextLayer') ||
    !(seed.resetPolicy?.neverResetOrDelete || []).includes('publicContextLayer')
  ) {
    errors.push('reset/delete must never target publicContextLayer');
  }

  const followUps = Array.isArray(seed.humanFollowUps) ? seed.humanFollowUps : [];
  if (followUps.length === 0) errors.push('missing positive human follow-ups');
  for (const followUp of followUps) {
    if (!followUp.enablesDossierAddition || !evidenceById.has(followUp.missingDataPoint)) {
      errors.push(
        `human follow-up ${followUp.missingDataPoint} must be positive and evidence-bound`
      );
    }
  }

  const forbidden = new Set(seed.forbiddenActions || []);
  const mustNotTrigger = new Set(seed.decisionPolicy?.mustNotTrigger || []);
  for (const action of contract.noCallActions) {
    if (!forbidden.has(action)) errors.push(`missing forbidden action: ${action}`);
    if (!mustNotTrigger.has(action)) errors.push(`missing no-call guard: ${action}`);
  }

  return errors;
}

function listVdmiBlueprintPackSeeds() {
  return SEEDS.map((seed) => ({
    id: seed.id,
    version: seed.version,
    kind: seed.kind,
    processFamily: seed.processFamily,
    controlCase: seed.controlCase,
    demoTenantId: seed.demoTenant?.tenantId || null,
    safetyClassification: seed.safetyClassification,
  }));
}

function getVdmiBlueprintPackSeed(id) {
  return SEEDS.find((seed) => seed.id === id) || null;
}

function validateVdmiBlueprintPackSeed(seed) {
  const errors = [];

  if (!seed || typeof seed !== 'object') {
    return { valid: false, errors: ['seed must be an object'] };
  }

  for (const field of ['id', 'kind', 'version', 'processFamily', 'controlCase']) {
    if (!seed[field]) errors.push(`missing field: ${field}`);
  }

  if (seed.kind !== 'vdmi_blueprint_pack_seed') {
    errors.push('kind must be vdmi_blueprint_pack_seed');
  }

  if (seed.safetyClassification !== 'read_only_blueprint_seed') {
    errors.push('safetyClassification must be read_only_blueprint_seed');
  }

  if (seed.demoTenant?.tenantId !== 'stadtwerk-mauer') {
    errors.push('demoTenant.tenantId must be stadtwerk-mauer for this seed');
  }

  if (seed.demoTenant?.classification !== 'synthetic_demo_tenant') {
    errors.push('demoTenant.classification must be synthetic_demo_tenant');
  }

  for (const dataClass of REQUIRED_DATA_CLASSES) {
    if (!seed.dataClasses?.[dataClass]) {
      errors.push(`missing data class: ${dataClass}`);
    }
  }

  const requirements = getSeedValidationRequirements(seed);
  const roleIds = new Set((seed.roles || []).map((role) => role.roleId));
  for (const roleId of requirements.requiredRoleIds) {
    if (!roleIds.has(roleId)) errors.push(`missing role: ${roleId}`);
  }
  if (!(seed.roles || []).some((role) => role.relation === 'information')) {
    errors.push('missing informed/commercial/audit role');
  }

  const evidenceIds = new Set((seed.evidenceRequirements || []).map((item) => item.id));
  for (const evidenceId of requirements.requiredEvidence) {
    if (!evidenceIds.has(evidenceId)) errors.push(`missing evidence requirement: ${evidenceId}`);
  }

  for (const item of seed.evidenceRequirements || []) {
    if (!item.enablesDossierAddition) {
      errors.push(`missing positive follow-up for evidence requirement: ${item.id}`);
    }
    if (item.dataClass !== 'syntheticTenantSeed') {
      errors.push(`evidence requirement ${item.id} must be syntheticTenantSeed`);
    }
  }

  const matrix = seed.demoProcessMatrix;
  if (!matrix || typeof matrix !== 'object') {
    errors.push('missing demoProcessMatrix');
  } else {
    if (requirements.expectedMatrixSlug && matrix.slug !== requirements.expectedMatrixSlug) {
      errors.push(`demoProcessMatrix.slug must be ${requirements.expectedMatrixSlug}`);
    }
    if (matrix.roleLegend?.M !== 'Mitwirkend') {
      errors.push('demoProcessMatrix.roleLegend.M must be Mitwirkend');
    }
    for (const key of ['V', 'D', 'M', 'I']) {
      if (!matrix.roleLegend?.[key]) {
        errors.push(`demoProcessMatrix.roleLegend.${key} is required`);
      }
    }

    const rows = Array.isArray(matrix.rows) ? matrix.rows : [];
    if (rows.length < 3 || rows.length > 5) {
      errors.push('demoProcessMatrix.rows must contain 3-5 rows');
    }

    const allowedDataClasses = new Set(REQUIRED_DATA_CLASSES);
    for (const dataClass of matrix.allowedDataClasses || []) {
      if (!allowedDataClasses.has(dataClass)) {
        errors.push(
          `demoProcessMatrix.allowedDataClasses contains unsupported class: ${dataClass}`
        );
      }
    }

    rows.forEach((row, index) => {
      const rowLabel = row.phase || index + 1;
      for (const roleKey of REQUIRED_MATRIX_ROLE_KEYS) {
        const roleValue = row[roleKey];
        if (!roleValue) {
          errors.push(`demoProcessMatrix row ${rowLabel} missing role cell: ${roleKey}`);
          continue;
        }
        for (const dataClass of REQUIRED_DATA_CLASSES) {
          if (roleValue === dataClass) {
            errors.push(
              `demoProcessMatrix row ${rowLabel} role ${roleKey} must not be a data class`
            );
          }
        }
        for (const headerWord of MATRIX_HEADER_WORDS) {
          if (roleValue === headerWord || roleValue.includes(`= ${headerWord}`)) {
            errors.push(`demoProcessMatrix row ${rowLabel} role ${roleKey} repeats header text`);
          }
        }
      }
      if (!Array.isArray(row.evidenceRequirements) || row.evidenceRequirements.length === 0) {
        errors.push(`demoProcessMatrix row ${rowLabel} missing evidence requirements`);
      }
      for (const dataClass of row.dataClassRefs || []) {
        if (!allowedDataClasses.has(dataClass)) {
          errors.push(
            `demoProcessMatrix row ${rowLabel} uses unsupported data class: ${dataClass}`
          );
        }
      }
      if (!row.gateOutcome) {
        errors.push(`demoProcessMatrix row ${rowLabel} missing gate outcome`);
      }
      if (!row.enablesDossierAddition) {
        errors.push(`demoProcessMatrix row ${rowLabel} missing positive follow-up`);
      }
    });
  }

  for (const hint of seed.allowedCommandHints || []) {
    if (hint.execution !== 'metadata_only') {
      errors.push(`command hint ${hint.id || hint.kind} must be metadata_only`);
    }
  }

  const forbidden = new Set(seed.forbiddenActions || []);
  for (const action of [
    'mako_write',
    'billing',
    'settlement',
    'smgw_cls_device_control',
    'external_connector_call',
    'hitl_create',
    'public_context_mutation',
    'production_mutation',
    'personal_agent_hardcoding',
  ]) {
    if (!forbidden.has(action)) errors.push(`missing forbidden action: ${action}`);
  }

  if (seed.publicContextMutationAllowed !== false) {
    errors.push('publicContextMutationAllowed must be false');
  }

  if (seed.tenantProvisioningAllowed !== false) {
    errors.push('tenantProvisioningAllowed must be false');
  }

  if (seed.realWorldClaim !== 'synthetic_demo_only') {
    errors.push('realWorldClaim must be synthetic_demo_only');
  }

  if (requirements.strictContract) {
    errors.push(...collectStrictContractErrors(seed, requirements.strictContract));
  }

  return {
    valid: errors.length === 0,
    errors,
  };
}

function buildWorkbenchClarificationItems(seed) {
  const selectedSeed = seed || stadtwerkMauerPvMissingNap;
  return (selectedSeed.evidenceRequirements || []).map((item) => ({
    id: `${selectedSeed.controlCase}:${item.id}`,
    processFamily: selectedSeed.processFamily,
    controlCase: selectedSeed.controlCase,
    evidenceId: item.id,
    state: item.missingState,
    roleHint:
      item.id === 'napReference'
        ? 'ROLE_NETZPLANUNG'
        : selectedSeed.id === stadtwerkMauerMakoResolutionValueReview.id
          ? 'ROLE_MAKO_OWNER'
          : selectedSeed.id === stadtwerkMauerMunicipalityPublicContextReadiness.id
            ? 'ROLE_PUBLIC_CONTEXT_STEWARD'
            : selectedSeed.id === stadtwerkMauerGasTransformationDataroomReview.id
              ? 'ROLE_DATAROOM_OWNER'
              : selectedSeed.id === stadtwerkMauerPortfolioMarketValueReadiness.id
                ? 'ROLE_PORTFOLIO_OWNER'
                : selectedSeed.id === stadtwerkMauerMonitoringNonEscalationStatus.id
                  ? 'ROLE_GOVERNANCE_OWNER'
                  : selectedSeed.id === stadtwerkMauerCrossSystemVarianceEvidenceMatrix.id
                    ? 'ROLE_GOVERNANCE_OWNER'
                    : selectedSeed.id === stadtwerkMauerMastrSyncGapAlerting.id
                      ? 'ROLE_REDISPATCH_KOORDINATOR'
                      : selectedSeed.id === stadtwerkMauerCostReviewCommitteeReadiness.id
                        ? 'ROLE_CONTROLLING'
                        : selectedSeed.id === stadtwerkMauerConnectionDeadlineEvidenceQueue.id
                          ? 'ROLE_ANSCHLUSSWESEN'
                          : selectedSeed.id === stadtwerkMauerInvestmentOwnerDeadlineBudgetGate.id
                            ? 'ROLE_ASSET_MANAGEMENT'
                            : selectedSeed.id === stadtwerkMauerDirectMarketerRiskGate.id
                              ? 'ROLE_MARKET_OPERATIONS'
                              : selectedSeed.id ===
                                  stadtwerkMauerFlexibleGridConnectionReleaseFile.id
                                ? 'ROLE_ANSCHLUSSWESEN'
                                : selectedSeed.id ===
                                    stadtwerkMauerEnergySharingCollectiveApproval.id
                                  ? 'ROLE_ENERGY_SHARING_PRODUCT_OWNER'
                                  : selectedSeed.id === stadtwerkMauerSubstationLoadAssessment.id
                                    ? 'ROLE_ASSET_PLANNING_LEAD'
                                    : selectedSeed.id ===
                                        stadtwerkMauerRedispatchParticipationReadiness.id
                                      ? 'ROLE_GRID_OPERATIONS_LEAD'
                                      : selectedSeed.id ===
                                          stadtwerkMauerAssetToDecisionReadiness.id
                                        ? 'ROLE_ASSET'
                                        : 'ROLE_GRID_OPERATOR',
    enablesDossierAddition: item.enablesDossierAddition,
    sourceSeedId: selectedSeed.id,
    execution: 'none',
  }));
}

function buildDemoProcessMatrixSync(seed) {
  const selectedSeed = seed || stadtwerkMauerPvMissingNap;
  const matrix = selectedSeed.demoProcessMatrix || {};
  const rows = Array.isArray(matrix.rows) ? matrix.rows : [];
  const allowedDataClasses = Array.isArray(matrix.allowedDataClasses)
    ? matrix.allowedDataClasses
    : [];
  const allowedSet = new Set(REQUIRED_DATA_CLASSES);
  const forbiddenRoleCellValues = new Set([
    ...REQUIRED_DATA_CLASSES,
    ...MATRIX_HEADER_WORDS,
    ...MATRIX_HEADER_WORDS.map((word) => `= ${word}`),
  ]);
  const rowSummaries = rows.map((row) => ({
    phase: row.phase,
    roles: {
      V: row.v,
      D: row.d,
      M: row.m,
      I: row.i,
    },
    evidenceRequirements: row.evidenceRequirements || [],
    dataClassRefs: row.dataClassRefs || [],
    status: row.status,
    gateOutcome: row.gateOutcome,
    enablesDossierAddition: row.enablesDossierAddition || null,
  }));
  const roleCells = rowSummaries.flatMap((row) => Object.values(row.roles));
  const evidenceRequirements = Array.from(
    new Set(rowSummaries.flatMap((row) => row.evidenceRequirements))
  );
  const dataClassRefs = Array.from(new Set(rowSummaries.flatMap((row) => row.dataClassRefs)));
  const roleCellsClean = roleCells.every((cell) => cell && !forbiddenRoleCellValues.has(cell));
  const dataClassesLimited =
    allowedDataClasses.every((dataClass) => allowedSet.has(dataClass)) &&
    dataClassRefs.every((dataClass) => allowedSet.has(dataClass));

  return {
    slug: matrix.slug || null,
    expectedSlug:
      getSeedValidationRequirements(selectedSeed).expectedMatrixSlug || matrix.slug || null,
    synced:
      matrix.slug ===
      (getSeedValidationRequirements(selectedSeed).expectedMatrixSlug || matrix.slug),
    roleLegend: matrix.roleLegend || {},
    roleLegendM: matrix.roleLegend?.M || null,
    rowCount: rows.length,
    rowCountValid: rows.length >= 3 && rows.length <= 5,
    roleCellsClean,
    evidenceRequirements,
    dataClassRefs,
    dataClassesLimited,
    forbiddenActionsStatus: 'not_introduced',
    downstreamHandoff: matrix.downstreamHandoff || {
      blueprintPack: 'pending',
      landingRegistry: 'pending',
      productiveDemoRoom: 'pending',
    },
    rows: rowSummaries,
  };
}

function buildLandingRegistryDraftFromBlueprintSeed(seed) {
  const selectedSeed = seed || stadtwerkMauerSubstationLoadAssessment;
  const matrixSync = buildDemoProcessMatrixSync(selectedSeed);
  const matrix = selectedSeed.demoProcessMatrix || {};
  const roleHeaders = [
    'Phase',
    'V = Verantwortlich',
    'D = Durchfuehrend',
    'M = Mitwirkend',
    'I = Informiert',
    'Nachweise',
  ];
  const downstreamHandoff = matrixSync.downstreamHandoff || {};
  const productivePending =
    downstreamHandoff.productiveDemoRoom == null ||
    downstreamHandoff.productiveDemoRoom === 'pending';
  const publicationBlockers = [
    'productive_demo_room_publication_issue_missing',
    'landing_registry_review_owner_missing',
    'cernion_de_sitemap_canonical_update_pending',
  ];
  const safetyBoundaries = Array.from(
    new Set([
      ...(selectedSeed.forbiddenActions || []),
      'cernion.de.publish',
      'landing-registry.write',
      'budibase.table.write',
      'operations-runbook.execute',
      'external.connector.call',
      'hitl.create',
      'settlement.export',
      'device-control.execute',
      'personal-agent.execute',
    ])
  );

  return {
    slug: matrixSync.slug,
    title: matrix.title || selectedSeed.title || selectedSeed.id,
    processFamily: selectedSeed.processFamily || null,
    controlCase: selectedSeed.controlCase || null,
    seedId: selectedSeed.id,
    canonicalSource: `src/vdmi-blueprint-pack-seeds/${selectedSeed.id}.json`,
    roleHeaders,
    roleLegend: matrixSync.roleLegend,
    rowCount: matrixSync.rowCount,
    rows: matrixSync.rows.map((row) => ({
      phase: row.phase,
      V: row.roles.V,
      D: row.roles.D,
      M: row.roles.M,
      I: row.roles.I,
      evidenceRequirements: row.evidenceRequirements,
      gateOutcome: row.gateOutcome,
      status: row.status,
      positiveFollowUp: row.enablesDossierAddition,
    })),
    safetyBoundaries,
    syntheticDataStatement:
      selectedSeed.demoTenant?.description ||
      (selectedSeed.realWorldClaim === 'synthetic_demo_only'
        ? 'Stadtwerk Mauer review markers are synthetic demo data unless explicitly marked as public context.'
        : 'Review source data classification before publication.'),
    syncProof: {
      blueprintPack: {
        status: downstreamHandoff.blueprintPack || 'pending',
        source: 'Cernion-Energy-Tools Blueprint-Pack seed',
      },
      landingRegistryDraft: {
        status: 'draft_ready',
        source: 'derived_from_canonical_demoProcessMatrix',
      },
      productiveDemoRoom: {
        status: productivePending ? 'pending' : downstreamHandoff.productiveDemoRoom,
        source: 'cernion.de publication remains a later explicit issue',
      },
    },
    publicationBlockers: productivePending ? publicationBlockers : [],
    positiveFollowUps: [
      {
        missingDataPoint: 'landing_registry_review_owner',
        enablesDossierAddition:
          'adds who reviewed the downstream draft without changing the canonical matrix',
      },
      {
        missingDataPoint: 'productive_demo_room_publication',
        enablesDossierAddition:
          'adds productive cernion.de publication evidence after a later explicit publication issue',
      },
      {
        missingDataPoint: 'budibase_visible_sync_row',
        enablesDossierAddition:
          'adds Workbench-visible sync status after generated manifest/apply smoke if the manifest is touched',
      },
    ],
    sourceActions: {
      inspected: ['buildLandingRegistryDraftFromBlueprintSeed', 'buildDemoProcessMatrixSync'],
      referenced: [`src/vdmi-blueprint-pack-seeds/${selectedSeed.id}.json`, 'demoProcessMatrix'],
      notCalled: safetyBoundaries,
    },
  };
}

module.exports = {
  ASSET_TO_DECISION_READINESS_CONTRACT,
  REQUIRED_ASSET_TO_DECISION_READINESS_EVIDENCE,
  REQUIRED_ASSET_TO_DECISION_READINESS_ROLE_IDS,
  REQUIRED_DATA_CLASSES,
  REQUIRED_CONNECTION_DEADLINE_EVIDENCE,
  REQUIRED_CONNECTION_DEADLINE_ROLE_IDS,
  REQUIRED_COST_REVIEW_COMMITTEE_READINESS_EVIDENCE,
  REQUIRED_COST_REVIEW_COMMITTEE_READINESS_ROLE_IDS,
  REQUIRED_CROSS_SYSTEM_VARIANCE_EVIDENCE,
  REQUIRED_CROSS_SYSTEM_VARIANCE_ROLE_IDS,
  REQUIRED_DECOMMISSIONED_ASSET_RECONCILIATION_EVIDENCE,
  REQUIRED_DECOMMISSIONED_ASSET_RECONCILIATION_ROLE_IDS,
  REQUIRED_DIRECT_MARKETER_RISK_GATE_EVIDENCE,
  REQUIRED_DIRECT_MARKETER_RISK_GATE_ROLE_IDS,
  REQUIRED_ENERGY_SHARING_COLLECTIVE_APPROVAL_EVIDENCE,
  REQUIRED_ENERGY_SHARING_COLLECTIVE_APPROVAL_ROLE_IDS,
  REQUIRED_EVIDENCE,
  REQUIRED_FLEXIBLE_GRID_CONNECTION_RELEASE_FILE_EVIDENCE,
  REQUIRED_FLEXIBLE_GRID_CONNECTION_RELEASE_FILE_ROLE_IDS,
  REQUIRED_GAS_TRANSFORMATION_DATAROOM_REVIEW_EVIDENCE,
  REQUIRED_GAS_TRANSFORMATION_DATAROOM_REVIEW_ROLE_IDS,
  REQUIRED_MASTR_SYNC_GAP_ALERTING_EVIDENCE,
  REQUIRED_MASTR_SYNC_GAP_ALERTING_ROLE_IDS,
  REQUIRED_GRID_CONNECTION_TRANSFORMATION_GATE_EVIDENCE,
  REQUIRED_GRID_CONNECTION_TRANSFORMATION_GATE_ROLE_IDS,
  REQUIRED_INVESTMENT_OWNER_DEADLINE_BUDGET_GATE_EVIDENCE,
  REQUIRED_INVESTMENT_OWNER_DEADLINE_BUDGET_GATE_ROLE_IDS,
  REQUIRED_MAKO_RESOLUTION_VALUE_REVIEW_EVIDENCE,
  REQUIRED_MAKO_RESOLUTION_VALUE_REVIEW_ROLE_IDS,
  REQUIRED_MODEL_VIABILITY_MANAGEMENT_REVIEW_EVIDENCE,
  REQUIRED_MODEL_VIABILITY_MANAGEMENT_REVIEW_ROLE_IDS,
  REQUIRED_MUNICIPALITY_PUBLIC_CONTEXT_EVIDENCE,
  REQUIRED_MUNICIPALITY_PUBLIC_CONTEXT_ROLE_IDS,
  REQUIRED_MONITORING_NON_ESCALATION_STATUS_EVIDENCE,
  REQUIRED_MONITORING_NON_ESCALATION_STATUS_ROLE_IDS,
  REQUIRED_PORTFOLIO_MARKET_VALUE_READINESS_EVIDENCE,
  REQUIRED_PORTFOLIO_MARKET_VALUE_READINESS_ROLE_IDS,
  REQUIRED_REDISPATCH_READINESS_EVIDENCE,
  REQUIRED_REDISPATCH_READINESS_ROLE_IDS,
  REQUIRED_ROLE_IDS,
  REQUIRED_SUBSTATION_LOAD_ASSESSMENT_EVIDENCE,
  REQUIRED_SUBSTATION_LOAD_ASSESSMENT_ROLE_IDS,
  REQUIRED_TABULAR_DECISION_INPUT_READINESS_EVIDENCE,
  REQUIRED_TABULAR_DECISION_INPUT_READINESS_ROLE_IDS,
  buildDemoProcessMatrixSync,
  buildLandingRegistryDraftFromBlueprintSeed,
  buildWorkbenchClarificationItems,
  getVdmiBlueprintPackSeed,
  listVdmiBlueprintPackSeeds,
  stadtwerkMauerAssetToDecisionReadiness,
  stadtwerkMauerRedispatchParticipationReadiness,
  stadtwerkMauerSubstationLoadAssessment,
  stadtwerkMauerPvMissingNap,
  stadtwerkMauerEnergySharingCollectiveApproval,
  stadtwerkMauerConnectionDeadlineEvidenceQueue,
  stadtwerkMauerCostReviewCommitteeReadiness,
  stadtwerkMauerCrossSystemVarianceEvidenceMatrix,
  stadtwerkMauerDecommissionedAssetReconciliation,
  stadtwerkMauerDirectMarketerRiskGate,
  stadtwerkMauerFlexibleGridConnectionReleaseFile,
  stadtwerkMauerGasTransformationDataroomReview,
  stadtwerkMauerMastrSyncGapAlerting,
  stadtwerkMauerGridConnectionTransformationGate,
  stadtwerkMauerInvestmentOwnerDeadlineBudgetGate,
  stadtwerkMauerMakoResolutionValueReview,
  stadtwerkMauerModelViabilityManagementReview,
  stadtwerkMauerMonitoringNonEscalationStatus,
  stadtwerkMauerMunicipalityPublicContextReadiness,
  stadtwerkMauerPortfolioMarketValueReadiness,
  stadtwerkMauerTabularDecisionInputReadiness,
  validateVdmiBlueprintPackSeed,
};
