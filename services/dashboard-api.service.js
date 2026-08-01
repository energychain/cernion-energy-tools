'use strict';

/**
 * Dashboard API Service (v0.19)
 *
 * Read-only aggregator service that orchestrates multiple internal Moleculer
 * actions into UI-optimised composite responses. Each endpoint is designed
 * to satisfy a full UI page with a single API call, reducing the typical
 * 5–8 roundtrips needed for a dashboard page to one.
 *
 * Architecture: this is the topmost layer — it reads from all layers below
 * (Agent Layer v0.14–v0.18, Allocation Engine v0.16, Datapoint Layer v0.11,
 * Execution Layer v0.9.x) but has no own PouchDB, no own state, and no
 * side-effects. Only an in-memory cache is used.
 *
 * Caching: per-action TTL via this.cache (Map). Cache keys include all
 * discriminating query parameters. Each cache entry is { data, expiresAt }.
 *
 * Error tolerance: every internal ctx.call is wrapped in safeCall(). When
 * a downstream service throws, safeCall returns the provided fallback value
 * and records the failure in this._errors (reset per request). The final
 * response always contains an _errors array listing failed service calls.
 */

module.exports = {
  name: 'dashboard-api',

  settings: {
    cacheTtlMs: {
      vnbOverview: 5 * 60 * 1000, // 5 min
      redispatchMeteringCockpit: 5 * 60 * 1000, // 5 min
      loadProfileStreamMonitor: 5 * 60 * 1000, // 5 min
      redispatchCallQualityGate: 5 * 60 * 1000, // 5 min
      evidenceGroundingConfidenceAudit: 5 * 60 * 1000, // 5 min
      receiptGroundedPresentationContract: 5 * 60 * 1000, // 5 min
      marketCommunicationEvidenceChainStatus: 5 * 60 * 1000, // 5 min
      e2eControllabilityGovernanceStatus: 5 * 60 * 1000, // 5 min
      controllabilityAssetHandoverStatus: 5 * 60 * 1000, // 5 min
      controllabilityDataAlignmentStatus: 5 * 60 * 1000, // 5 min
      coordinationMeaningPreservationProfile: 5 * 60 * 1000, // 5 min
      gremiencoachWorkbookReadinessStatus: 5 * 60 * 1000, // 5 min
      decisionReadinessMatrixStatus: 5 * 60 * 1000, // 5 min
      crossSystemVarianceMatrixStatus: 5 * 60 * 1000, // 5 min
      regulatorySignalProcessTranslatorStatus: 5 * 60 * 1000, // 5 min
      costReviewCommitteeStatus: 5 * 60 * 1000, // 5 min
      redispatchParticipationReadinessStatus: 5 * 60 * 1000, // 5 min
      mastrSyncGapStatus: 5 * 60 * 1000, // 5 min
      decommissionedAssetReconciliationStatus: 5 * 60 * 1000, // 5 min
      energySharingCollectiveApprovalStatus: 5 * 60 * 1000, // 5 min
      steeringArtifactAcceptanceGateStatus: 5 * 60 * 1000, // 5 min
      communicationBreakProcessRiskStatus: 5 * 60 * 1000, // 5 min
      noRegretMeasureProofGateStatus: 5 * 60 * 1000, // 5 min
      anschlusskapazitaetEvidenceQueueStatus: 5 * 60 * 1000, // 5 min
      connectionDeadlineEvidenceQueueStatus: 5 * 60 * 1000, // 5 min
      layer0AuditDrilldownNoteStatus: 5 * 60 * 1000, // 5 min
      legalClarificationOperatingModelStatus: 5 * 60 * 1000, // 5 min
      drReadinessEvidenceStatus: 5 * 60 * 1000, // 5 min
      specialGridUsageImpactMapStatus: 5 * 60 * 1000, // 5 min
      liquidityPlanningGovernanceStatus: 5 * 60 * 1000, // 5 min
      energySharingSimulationGateStatus: 5 * 60 * 1000, // 5 min
      energySharing42cCutoverReadinessStatus: 5 * 60 * 1000, // 5 min
      evuApiMigrationDiagnosticsStatus: 5 * 60 * 1000, // 5 min
      novaDecisionLifecycleReadinessStatus: 5 * 60 * 1000, // 5 min
      regulatoryChangeReadinessStatus: 5 * 60 * 1000, // 5 min
      investmentTwoTrackControlStatus: 5 * 60 * 1000, // 5 min
      sapBudgetPspGateStatus: 5 * 60 * 1000, // 5 min
      energyTaxInformationPackageStatus: 5 * 60 * 1000, // 5 min
      investmentRiskTranslationStatus: 5 * 60 * 1000, // 5 min
      budgetWaterfallGovernanceStatus: 5 * 60 * 1000, // 5 min
      gasDecommissioningRoadmapStatus: 5 * 60 * 1000, // 5 min
      jourFixeDecisionClosureStatus: 5 * 60 * 1000, // 5 min
      offBalancingMeteringPruefmatrixStatus: 5 * 60 * 1000, // 5 min
      automationRequirementsDecisionValueStatus: 5 * 60 * 1000, // 5 min
      smartMeterOffBalancingPurposeLockStatus: 5 * 60 * 1000, // 5 min
      imsysScheduleValueChainReadinessStatus: 5 * 60 * 1000, // 5 min
      clsDigitalTwinComplianceGateStatus: 5 * 60 * 1000, // 5 min
      legacyControlTechnologyTransitionStatus: 5 * 60 * 1000, // 5 min
      controllabilitySubmissionCockpitStatus: 5 * 60 * 1000, // 5 min
      crisisDecisionRoutineStatus: 5 * 60 * 1000, // 5 min
      investmentCommitteeSteeringCardsStatus: 5 * 60 * 1000, // 5 min
      investmentDataReviewQueueStatus: 5 * 60 * 1000, // 5 min
      flexStrategicDemandIntakeStatus: 5 * 60 * 1000, // 5 min
      gasInfrastructureRiskGovernanceStatus: 5 * 60 * 1000, // 5 min
      meteringRolloutProcessIndicatorStatus: 5 * 60 * 1000, // 5 min
      heatTransformationLineAssetModelStatus: 5 * 60 * 1000, // 5 min
      kiFloorwalkerGovernanceStatus: 5 * 60 * 1000, // 5 min
      investmentWaterfallGovernanceStatus: 5 * 60 * 1000, // 5 min
      investmentBudgetCapExceptionGovernanceStatus: 5 * 60 * 1000, // 5 min
      investmentOwnerDeadlineBudgetGateStatus: 5 * 60 * 1000, // 5 min
      directMarketerRiskGateStatus: 5 * 60 * 1000, // 5 min
      noRegretMeasureDefinitionGateStatus: 5 * 60 * 1000, // 5 min
      capacityContractRiskAssetCockpitStatus: 5 * 60 * 1000, // 5 min
      imsysTaf2ComplianceStatus: 5 * 60 * 1000, // 5 min
      scheduleManagementGovernanceRoadmapStatus: 5 * 60 * 1000, // 5 min
      gasTransformationDependencyMapStatus: 5 * 60 * 1000, // 5 min
      gasTransformationDataroomStatus: 5 * 60 * 1000, // 5 min
      gridConnectionTransformationGateStatus: 5 * 60 * 1000, // 5 min
      heatAssetTariffSteeringStatus: 5 * 60 * 1000, // 5 min
      techCommercialOfferCockpitStatus: 5 * 60 * 1000, // 5 min
      zaehlparkFinanzierungSzenarioCockpitStatus: 5 * 60 * 1000, // 5 min
      processSensitizationReadinessMapStatus: 5 * 60 * 1000, // 5 min
      netzprozessReadinessGateStatus: 5 * 60 * 1000, // 5 min
      grossspeicherAnschlussReadinessGateStatus: 5 * 60 * 1000, // 5 min
      rolePermissionAccessReadinessGateStatus: 5 * 60 * 1000, // 5 min
      ownerDeadlineEvidenceGateStatus: 5 * 60 * 1000, // 5 min
      automationRiskGateStatus: 5 * 60 * 1000, // 5 min
      redispatchProjectControllingKpiCockpitStatus: 5 * 60 * 1000, // 5 min
      stadtwerkMauerVdmiProfileStatus: 5 * 60 * 1000, // 5 min
      stadtwerkMauerCapabilityProjectionStatus: 5 * 60 * 1000, // 5 min
      stadtwerkMauerEventReplayPreviewStatus: 5 * 60 * 1000, // 5 min
      stadtwerkMauerSandboxRuntimeStatus: 5 * 60 * 1000, // 5 min
      stadtwerkMauerExternalInterfaceStubsStatus: 5 * 60 * 1000, // 5 min
      stadtwerkMauerE2eProcessDemoStatus: 5 * 60 * 1000, // 5 min
      stadtwerkMauerMastrDataOverlayStatus: 5 * 60 * 1000, // 5 min
      stadtwerkMauerCaseDetailStatus: 5 * 60 * 1000, // 5 min
      stadtwerkMauerWorkbenchHubStatus: 5 * 60 * 1000, // 5 min
      stadtwerkMauerAdministratorInventoryStatus: 5 * 60 * 1000, // 5 min
      stadtwerkMauerTenantDatabrowserStatus: 5 * 60 * 1000, // 5 min
      stadtwerkMauerCaseActionsStatus: 5 * 60 * 1000, // 5 min
      stadtwerkMauerRoleWorkbenchCatalogStatus: 5 * 60 * 1000, // 5 min
      stadtwerkMauerGridPlanningRoleQueueStatus: 5 * 60 * 1000, // 5 min
      stadtwerkMauerGridPlanningSelectedItemDetailStatus: 5 * 60 * 1000, // 5 min
      stadtwerkMauerSalesWorkbenchBriefingStatus: 5 * 60 * 1000, // 5 min
      stadtwerkMauerWorkbenchLandingStatus: 5 * 60 * 1000, // 5 min
      stadtwerkMauerWorkbenchSelectedTargetStatus: 5 * 60 * 1000, // 5 min
      stadtwerkMauerBlueprintPackVerifyStatus: 5 * 60 * 1000, // 5 min
      stadtwerkMauerTransferReadinessStatus: 5 * 60 * 1000, // 5 min
      stadtwerkMauerLandingRegistryDraftStatus: 5 * 60 * 1000, // 5 min
      energySidecarRouteRegistryStatus: 5 * 60 * 1000, // 5 min
      interconnectionReleaseFileStatus: 5 * 60 * 1000, // 5 min
      a2mdmDecisionObjectStatus: 5 * 60 * 1000, // 5 min
      fnavFastTrackContractGateStatus: 5 * 60 * 1000, // 5 min
      crossChannelVnbSignalQueueStatus: 5 * 60 * 1000, // 5 min
      crossDomainSpecialTopicsQueueStatus: 5 * 60 * 1000, // 5 min
      assetValuationTransformationGateStatus: 5 * 60 * 1000, // 5 min
      gasCapacityBookingReviewGateStatus: 5 * 60 * 1000, // 5 min
      gasNetworkDecisionChainStatus: 5 * 60 * 1000, // 5 min
      waterPricingNetInvestmentAlignmentStatus: 5 * 60 * 1000, // 5 min
      arealNetworkIntegrationOfferGateStatus: 5 * 60 * 1000, // 5 min
      transformationFinancingScenarioViewStatus: 5 * 60 * 1000, // 5 min
      gasGridTransformationAssetCockpitStatus: 5 * 60 * 1000, // 5 min
      vnbSpecialTopicWorkstateStatus: 5 * 60 * 1000, // 5 min
      monitoringNonEscalationStatus: 5 * 60 * 1000, // 5 min
      leadershipDeltaCockpitStatus: 5 * 60 * 1000, // 5 min
      netzsignalDeltaGatingStatus: 5 * 60 * 1000, // 5 min
      vnbDeltaSignalClassifierStatus: 5 * 60 * 1000, // 5 min
      evidenceFreshnessGuardStatus: 5 * 60 * 1000, // 5 min
      liveUpdateStreamContractStatus: 5 * 60 * 1000, // 5 min
      smgwConnectorReadinessStatus: 5 * 60 * 1000, // 5 min
      municipalEnergyValueAnalysisStatus: 5 * 60 * 1000, // 5 min
      modelViabilityEvidenceGateStatus: 5 * 60 * 1000, // 5 min
      marketSnapshot: 15 * 60 * 1000, // 15 min
      qualitySummary: 5 * 60 * 1000, // 5 min
      observabilityMini: 60 * 1000, // 1 min
      findingCodes: 24 * 60 * 60 * 1000, // 24 h (static)
    },
  },

  created() {
    this.cache = new Map();
    this.inflight = new Map();
  },

  actions: {
    ...require('./dashboard-api/actions-part-01-of-8.js'),
    ...require('./dashboard-api/actions-part-02-of-8.js'),
    ...require('./dashboard-api/actions-part-03-of-8.js'),
    ...require('./dashboard-api/actions-part-04-of-8.js'),
    ...require('./dashboard-api/actions-part-05-of-8.js'),
    ...require('./dashboard-api/actions-part-06-of-8.js'),
    ...require('./dashboard-api/actions-part-07-of-8.js'),
    ...require('./dashboard-api/actions-part-08-of-8.js'),
  },

  methods: {
    ...require('./dashboard-api/methods-part-01-of-14.js'),
    ...require('./dashboard-api/methods-part-02-of-14.js'),
    ...require('./dashboard-api/methods-part-03-of-14.js'),
    ...require('./dashboard-api/methods-part-04-of-14.js'),
    ...require('./dashboard-api/methods-part-05-of-14.js'),
    ...require('./dashboard-api/methods-part-06-of-14.js'),
    ...require('./dashboard-api/methods-part-07-of-14.js'),
    ...require('./dashboard-api/methods-part-08-of-14.js'),
    ...require('./dashboard-api/methods-part-09-of-14.js'),
    ...require('./dashboard-api/methods-part-10-of-14.js'),
    ...require('./dashboard-api/methods-part-11-of-14.js'),
    ...require('./dashboard-api/methods-part-12-of-14.js'),
    ...require('./dashboard-api/methods-part-13-of-14.js'),
    ...require('./dashboard-api/methods-part-14-of-14.js'),
  },
};
