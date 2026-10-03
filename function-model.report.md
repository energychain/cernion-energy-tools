# Function model — generated report

Source SHA-256: `5f523aa56cfcf570931a1aa6ab87562d206a89e594a67f88a66cbec6f60a257a`

Capabilities: 172; functions: 121.
Directed density at minWeight=0.2: **0.058058** (843/14520).
Naive baseline: 0.49; target: ≤ 0.15; target met: yes.

Capabilities per function: {"1":91,"2":17,"3":9,"4":3,"8":1}.
Single-capability fraction: 0.752066; cross-domain functions: 26.
Outgoing degree: min=0; median=3; max=30; isolated fraction=0.247934.
Maximum degree target: ≤ 0.25 × 121 = 30.25; met: yes.

Candidate degree before mutual selection: {"minimum":0,"median":3,"maximum":42,"isolatedFraction":0.24793388429752067}; pruned directed edges: 34; peer limit: 30.

Operation index entries without action: 271/982.

All curated capabilities are assigned once, including entries without resolvable operations.
Edges describe catalog evidence only; they grant no authorization.

## ID-Änderungen gegenüber Vorversion

same: 121; merged: 0; split: 0; retired: 0; new: 0.
Previous source SHA-256: 795ff7f49cb9f9d5b1895626c51122a5136add75e4862441f94e5f2c4145ad9e.
Counts describe prior IDs in the last membership transition; retired counts IDs that lost their active identity, including merges. No-op generation preserves this provenance.
Permanently reserved retired IDs: 0.

## retiredFunctionIds (0)

None.

## unassignedCapabilities (0)

None.

## capabilitiesWithoutOperations (15)

- {"capability":"cost_review_committee_status","reason":"No resolvable preferred action"}
- {"capability":"decommissioned_asset_reconciliation","reason":"No resolvable preferred action"}
- {"capability":"energy_sharing_42c_cutover_readiness","reason":"No resolvable preferred action"}
- {"capability":"energy_sharing_collective_approval","reason":"No resolvable preferred action"}
- {"capability":"energy_sharing_simulation_gate","reason":"No resolvable preferred action"}
- {"capability":"energy_sidecar_route_registry","reason":"No resolvable preferred action"}
- {"capability":"evu_api_migration_diagnostics","reason":"No resolvable preferred action"}
- {"capability":"file_ingest_monitor","reason":"No resolvable preferred action"}
- {"capability":"interconnection_release_file","reason":"No resolvable preferred action"}
- {"capability":"load_profile_stream_monitor","reason":"No resolvable preferred action"}
- {"capability":"mastr_sync_gap_alerting","reason":"No resolvable preferred action"}
- {"capability":"nova_decision_lifecycle_readiness","reason":"No resolvable preferred action"}
- {"capability":"redispatch_participation_readiness","reason":"No resolvable preferred action"}
- {"capability":"stadtwerk_mauer_capability_projection","reason":"No resolvable preferred action"}
- {"capability":"stadtwerk_mauer_event_replay_preview","reason":"No resolvable preferred action"}

## unresolvedPreferredActions (312)

- {"capability":"a2mdm_decision_object_meaning_preservation","action":"dashboard-api.a2mdmDecisionObjectStatus","reason":"Action exists in source; index entry has no action","sources":["services/dashboard-api/actions-part-01-of-8.js"]}
- {"capability":"a2mdm_decision_object_meaning_preservation","action":"dashboard-api.coordinationMeaningPreservationProfile","reason":"Action exists in source; index entry has no action","sources":["services/dashboard-api/actions-part-01-of-8.js"]}
- {"capability":"a2mdm_decision_object_meaning_preservation","action":"dashboard-api.interconnectionReleaseFileStatus","reason":"Action exists in source; index entry has no action","sources":["services/dashboard-api/actions-part-06-of-8.js"]}
- {"capability":"anschlusskapazitaet_evidence_queue","action":"dashboard-api.anschlusskapazitaetEvidenceQueueStatus","reason":"Action exists in source; index entry has no action","sources":["services/dashboard-api/actions-part-02-of-8.js"]}
- {"capability":"anschlusskapazitaet_evidence_queue","action":"grid-connection.capacityCheck","reason":"Action does not exist in source"}
- {"capability":"areal_network_integration_offer_gate","action":"dashboard-api.arealNetworkIntegrationOfferGateStatus","reason":"Action exists in source; index entry has no action","sources":["services/dashboard-api/actions-part-07-of-8.js"]}
- {"capability":"areal_network_integration_offer_gate","action":"target-grid-planning.review","reason":"Action does not exist in source"}
- {"capability":"areal_network_integration_offer_gate","action":"investment-planning.review","reason":"Action does not exist in source"}
- {"capability":"areal_network_integration_offer_gate","action":"regulatorische-entgeltlogik.evaluate","reason":"Action does not exist in source"}
- {"capability":"areal_network_integration_offer_gate","action":"offer-management.review","reason":"Action does not exist in source"}
- {"capability":"asset_valuation_transformation_gate","action":"dashboard-api.assetValuationTransformationGateStatus","reason":"Action exists in source; index entry has no action","sources":["services/dashboard-api/actions-part-07-of-8.js"]}
- {"capability":"automation_requirements_decision_value","action":"dashboard-api.automationRequirementsDecisionValueStatus","reason":"Action exists in source; index entry has no action","sources":["services/dashboard-api/actions-part-03-of-8.js"]}
- {"capability":"automation_requirements_decision_value","action":"business-intelligence.describe","reason":"Action does not exist in source"}
- {"capability":"automation_requirements_decision_value","action":"datasource-registry.get","reason":"Action exists in source; index entry has no action","sources":["services/datasource-registry.service.js"]}
- {"capability":"automation_requirements_decision_value","action":"presentation.generate","reason":"Action does not exist in source"}
- {"capability":"automation_risk_gate","action":"dashboard-api.automationRiskGateStatus","reason":"Action exists in source; index entry has no action","sources":["services/dashboard-api/actions-part-05-of-8.js"]}
- {"capability":"automation_risk_gate","action":"datasource-registry.list","reason":"Action exists in source; index entry has no action","sources":["services/datasource-registry.service.js"]}
- {"capability":"automation_risk_gate","action":"presentation.generate","reason":"Action does not exist in source"}
- {"capability":"blindflug_radar_anomaly_detection","action":"v1.blindflug-radar.scan","reason":"Action does not exist in source"}
- {"capability":"budget_waterfall_governance","action":"dashboard-api.budgetWaterfallGovernanceStatus","reason":"Action exists in source; index entry has no action","sources":["services/dashboard-api/actions-part-03-of-8.js"]}
- {"capability":"budget_waterfall_governance","action":"datasource-registry.get","reason":"Action exists in source; index entry has no action","sources":["services/datasource-registry.service.js"]}
- {"capability":"budget_waterfall_governance","action":"presentation.generate","reason":"Action does not exist in source"}
- {"capability":"capacity_contract_risk_asset_cockpit","action":"dashboard-api.capacityContractRiskAssetCockpitStatus","reason":"Action exists in source; index entry has no action","sources":["services/dashboard-api/actions-part-04-of-8.js"]}
- {"capability":"capacity_contract_risk_asset_cockpit","action":"grid-operations.netzfahrplanGenerate","reason":"Action exists in source; index entry has no action","sources":["services/grid-operations.service.js"]}
- {"capability":"cls_digital_twin_compliance_gate","action":"dashboard-api.clsDigitalTwinComplianceGateStatus","reason":"Action exists in source; index entry has no action","sources":["services/dashboard-api/actions-part-03-of-8.js"]}
- {"capability":"cls_digital_twin_compliance_gate","action":"datasource-registry.get","reason":"Action exists in source; index entry has no action","sources":["services/datasource-registry.service.js"]}
- {"capability":"cls_digital_twin_compliance_gate","action":"presentation.generate","reason":"Action does not exist in source"}
- {"capability":"communication_break_process_risk","action":"dashboard-api.communicationBreakProcessRiskStatus","reason":"Action exists in source; index entry has no action","sources":["services/dashboard-api/actions-part-02-of-8.js"]}
- {"capability":"communication_break_process_risk","action":"evidence-registry.findings","reason":"Action does not exist in source"}
- {"capability":"communication_break_process_risk","action":"dashboard-api.ownerDeadlineEvidenceGateStatus","reason":"Action exists in source; index entry has no action","sources":["services/dashboard-api/actions-part-05-of-8.js"]}
- {"capability":"communication_break_process_risk","action":"dashboard-api.steeringArtifactAcceptanceGateStatus","reason":"Action exists in source; index entry has no action","sources":["services/dashboard-api/actions-part-02-of-8.js"]}
- {"capability":"connection_deadline_evidence_queue","action":"dashboard-api.connectionDeadlineEvidenceQueueStatus","reason":"Action exists in source; index entry has no action","sources":["services/dashboard-api/actions-part-02-of-8.js"]}
- {"capability":"connection_deadline_evidence_queue","action":"evidence-registry.lookup","reason":"Action does not exist in source"}
- {"capability":"controllability_asset_handover","action":"dashboard-api.controllabilityAssetHandoverStatus","reason":"Action exists in source; index entry has no action","sources":["services/dashboard-api/actions-part-01-of-8.js"]}
- {"capability":"controllability_asset_handover","action":"redispatch-expost.audit","reason":"Action exists in source; index entry has no action","sources":["services/redispatch-expost.service.js"]}
- {"capability":"controllability_data_alignment","action":"dashboard-api.controllabilityDataAlignmentStatus","reason":"Action exists in source; index entry has no action","sources":["services/dashboard-api/actions-part-01-of-8.js"]}
- {"capability":"controllability_data_alignment","action":"redispatch-expost.audit","reason":"Action exists in source; index entry has no action","sources":["services/redispatch-expost.service.js"]}
- {"capability":"controllability_submission_cockpit","action":"dashboard-api.controllabilitySubmissionCockpitStatus","reason":"Action exists in source; index entry has no action","sources":["services/dashboard-api/actions-part-04-of-8.js"]}
- {"capability":"controllability_submission_cockpit","action":"edm-validation.validate","reason":"Action exists in source; index entry has no action","sources":["services/edm-validation.service.js"]}
- {"capability":"controllability_submission_cockpit","action":"presentation.generate","reason":"Action does not exist in source"}
- {"capability":"coordination_meaning_preservation_profile","action":"dashboard-api.coordinationMeaningPreservationProfile","reason":"Action exists in source; index entry has no action","sources":["services/dashboard-api/actions-part-01-of-8.js"]}
- {"capability":"cost_review_committee_status","action":"dashboard-api.costReviewCommitteeStatus","reason":"Action exists in source; index entry has no action","sources":["services/dashboard-api/actions-part-02-of-8.js"]}
- {"capability":"crisis_decision_routine","action":"dashboard-api.crisisDecisionRoutineStatus","reason":"Action exists in source; index entry has no action","sources":["services/dashboard-api/actions-part-04-of-8.js"]}
- {"capability":"crisis_decision_routine","action":"presentation.generate","reason":"Action does not exist in source"}
- {"capability":"cross_channel_vnb_signal_queue","action":"dashboard-api.crossChannelVnbSignalQueueStatus","reason":"Action exists in source; index entry has no action","sources":["services/dashboard-api/actions-part-07-of-8.js"]}
- {"capability":"cross_domain_special_topics_queue","action":"dashboard-api.crossDomainSpecialTopicsQueueStatus","reason":"Action exists in source; index entry has no action","sources":["services/dashboard-api/actions-part-07-of-8.js"]}
- {"capability":"cross_domain_special_topics_queue","action":"evidence-registry.lookup","reason":"Action does not exist in source"}
- {"capability":"cross_domain_special_topics_queue","action":"presentation.generate","reason":"Action does not exist in source"}
- {"capability":"cross_system_variance_matrix","action":"dashboard-api.crossSystemVarianceMatrixStatus","reason":"Action exists in source; index entry has no action","sources":["services/dashboard-api/actions-part-01-of-8.js"]}
- {"capability":"cross_system_variance_matrix","action":"evidence-registry.findings","reason":"Action does not exist in source"}
- {"capability":"cross_system_variance_matrix","action":"variance-register.suppliedFacts","reason":"Action does not exist in source"}
- {"capability":"decision_readiness_matrix","action":"dashboard-api.decisionReadinessMatrixStatus","reason":"Action exists in source; index entry has no action","sources":["services/dashboard-api/actions-part-01-of-8.js"]}
- {"capability":"decision_readiness_matrix","action":"evidence-registry.findings","reason":"Action does not exist in source"}
- {"capability":"decommissioned_asset_reconciliation","action":"dashboard-api.decommissionedAssetReconciliationStatus","reason":"Action exists in source; index entry has no action","sources":["services/dashboard-api/actions-part-02-of-8.js"]}
- {"capability":"direct_marketer_risk_gate","action":"dashboard-api.directMarketerRiskGateStatus","reason":"Action exists in source; index entry has no action","sources":["services/dashboard-api/actions-part-07-of-8.js"]}
- {"capability":"direct_marketer_risk_gate","action":"evidence-registry.lookup","reason":"Action does not exist in source"}
- {"capability":"direct_marketer_risk_gate","action":"market-communication.evidence","reason":"Action does not exist in source"}
- {"capability":"direct_marketer_risk_gate","action":"settlement.readiness","reason":"Action does not exist in source"}
- {"capability":"direct_marketer_risk_gate","action":"presentation.generate","reason":"Action does not exist in source"}
- {"capability":"dr_readiness_evidence_gate","action":"dashboard-api.drReadinessEvidenceStatus","reason":"Action exists in source; index entry has no action","sources":["services/dashboard-api/actions-part-02-of-8.js"]}
- {"capability":"e2e_controllability_check_governance","action":"dashboard-api.e2eControllabilityGovernanceStatus","reason":"Action exists in source; index entry has no action","sources":["services/dashboard-api/actions-part-01-of-8.js"]}
- {"capability":"e2e_controllability_check_governance","action":"edm-messkonzept.evaluate","reason":"Action exists in source; index entry has no action","sources":["services/edm-messkonzept.service.js"]}
- {"capability":"e2e_controllability_check_governance","action":"edm-validation.validate","reason":"Action exists in source; index entry has no action","sources":["services/edm-validation.service.js"]}
- {"capability":"edm_metering_concept_evidence","action":"edm-messkonzept.list","reason":"Action exists in source; index entry has no action","sources":["services/edm-messkonzept.service.js"]}
- {"capability":"edm_metering_concept_evidence","action":"edm-messkonzept.get","reason":"Action exists in source; index entry has no action","sources":["services/edm-messkonzept.service.js"]}
- {"capability":"energy_sharing_42c_cutover_readiness","action":"dashboard-api.energySharing42cCutoverReadinessStatus","reason":"Action exists in source; index entry has no action","sources":["services/dashboard-api/actions-part-03-of-8.js"]}
- {"capability":"energy_sharing_42c_cutover_readiness","action":"presentation.generate","reason":"Action does not exist in source"}
- {"capability":"energy_sharing_collective_approval","action":"dashboard-api.energySharingCollectiveApprovalStatus","reason":"Action exists in source; index entry has no action","sources":["services/dashboard-api/actions-part-02-of-8.js"]}
- {"capability":"energy_sharing_simulation_gate","action":"dashboard-api.energySharingSimulationGateStatus","reason":"Action exists in source; index entry has no action","sources":["services/dashboard-api/actions-part-02-of-8.js"]}
- {"capability":"energy_sharing_simulation_gate","action":"presentation.generate","reason":"Action does not exist in source"}
- {"capability":"energy_sidecar_route_registry","action":"dashboard-api.energySidecarRouteRegistryStatus","reason":"Action exists in source; index entry has no action","sources":["services/dashboard-api/actions-part-06-of-8.js"]}
- {"capability":"energy_tax_information_package","action":"dashboard-api.energyTaxInformationPackageStatus","reason":"Action exists in source; index entry has no action","sources":["services/dashboard-api/actions-part-03-of-8.js"]}
- {"capability":"energy_tax_information_package","action":"datasource-registry.get","reason":"Action exists in source; index entry has no action","sources":["services/datasource-registry.service.js"]}
- {"capability":"energy_tax_information_package","action":"datasource-registry.updateDictionary","reason":"Action exists in source; index entry has no action","sources":["services/datasource-registry.service.js"]}
- {"capability":"energy_tax_information_package","action":"datasource-classifier.classify","reason":"Action exists in source; no matching index entry","sources":["services/datasource-classifier.service.js"]}
- {"capability":"energy_tax_information_package","action":"presentation.generate","reason":"Action does not exist in source"}
- {"capability":"evidence_freshness_guard","action":"dashboard-api.evidenceFreshnessGuardStatus","reason":"Action exists in source; index entry has no action","sources":["services/dashboard-api/actions-part-08-of-8.js"]}
- {"capability":"evidence_freshness_guard","action":"dashboard-api.vnbDeltaSignalClassifierStatus","reason":"Action exists in source; index entry has no action","sources":["services/dashboard-api/actions-part-08-of-8.js"]}
- {"capability":"evidence_freshness_guard","action":"dashboard-api.crossChannelVnbSignalQueueStatus","reason":"Action exists in source; index entry has no action","sources":["services/dashboard-api/actions-part-07-of-8.js"]}
- {"capability":"evidence_freshness_guard","action":"dashboard-api.leadershipDeltaCockpitStatus","reason":"Action exists in source; index entry has no action","sources":["services/dashboard-api/actions-part-08-of-8.js"]}
- {"capability":"evidence_freshness_guard","action":"evidence-planner.plan","reason":"Action does not exist in source"}
- {"capability":"evidence_grounding_confidence_audit","action":"dashboard-api.evidenceGroundingConfidenceAudit","reason":"Action exists in source; index entry has no action","sources":["services/dashboard-api/actions-part-01-of-8.js"]}
- {"capability":"evidence_grounding_confidence_audit","action":"capability-broker.recommend","reason":"Action exists in source; no matching index entry","sources":["services/capability-broker.service.js"]}
- {"capability":"evu_api_migration_diagnostics","action":"dashboard-api.evuApiMigrationDiagnosticsStatus","reason":"Action exists in source; index entry has no action","sources":["services/dashboard-api/actions-part-03-of-8.js"]}
- {"capability":"evu_api_migration_diagnostics","action":"presentation.generate","reason":"Action does not exist in source"}
- {"capability":"file_ingest_monitor","action":"file-ingest-monitor.scan","reason":"Action exists in source; index entry has no action","sources":["services/file-ingest-monitor.service.js"]}
- {"capability":"file_ingest_monitor","action":"file-ingest-monitor.getStatus","reason":"Action exists in source; index entry has no action","sources":["services/file-ingest-monitor.service.js"]}
- {"capability":"file_ingest_monitor","action":"file-ingest-monitor.getFindings","reason":"Action exists in source; index entry has no action","sources":["services/file-ingest-monitor.service.js"]}
- {"capability":"file_ingest_monitor","action":"file-ingest-monitor.createMonitor","reason":"Action exists in source; index entry has no action","sources":["services/file-ingest-monitor.service.js"]}
- {"capability":"file_ingest_monitor","action":"file-ingest-monitor.listMonitors","reason":"Action exists in source; index entry has no action","sources":["services/file-ingest-monitor.service.js"]}
- {"capability":"flex_strategic_demand_intake","action":"dashboard-api.flexStrategicDemandIntakeStatus","reason":"Action exists in source; index entry has no action","sources":["services/dashboard-api/actions-part-04-of-8.js"]}
- {"capability":"flex_strategic_demand_intake","action":"flex.status","reason":"Action does not exist in source"}
- {"capability":"flex_strategic_demand_intake","action":"znp.projects","reason":"Action does not exist in source"}
- {"capability":"flex_strategic_demand_intake","action":"presentation.generate","reason":"Action does not exist in source"}
- {"capability":"fnav_fast_track_contract_gate","action":"dashboard-api.fnavFastTrackContractGateStatus","reason":"Action exists in source; index entry has no action","sources":["services/dashboard-api/actions-part-07-of-8.js"]}
- {"capability":"gas_capacity_booking_review_gate","action":"dashboard-api.gasCapacityBookingReviewGateStatus","reason":"Action exists in source; index entry has no action","sources":["services/dashboard-api/actions-part-07-of-8.js"]}
- {"capability":"gas_decommissioning_roadmap_status","action":"dashboard-api.gasDecommissioningRoadmapStatus","reason":"Action exists in source; index entry has no action","sources":["services/dashboard-api/actions-part-03-of-8.js"]}
- {"capability":"gas_decommissioning_roadmap_status","action":"vdmi-evidence.inject","reason":"Action does not exist in source"}
- {"capability":"gas_decommissioning_roadmap_status","action":"presentation.generate","reason":"Action does not exist in source"}
- {"capability":"gas_grid_transformation_asset_cockpit","action":"dashboard-api.gasGridTransformationAssetCockpitStatus","reason":"Action exists in source; index entry has no action","sources":["services/dashboard-api/actions-part-08-of-8.js"]}
- {"capability":"gas_grid_transformation_asset_cockpit","action":"datasource-registry.get","reason":"Action exists in source; index entry has no action","sources":["services/datasource-registry.service.js"]}
- {"capability":"gas_grid_transformation_asset_cockpit","action":"presentation.generate","reason":"Action does not exist in source"}
- {"capability":"gas_infrastructure_risk_governance","action":"dashboard-api.gasInfrastructureRiskGovernanceStatus","reason":"Action exists in source; index entry has no action","sources":["services/dashboard-api/actions-part-04-of-8.js"]}
- {"capability":"gas_infrastructure_risk_governance","action":"grid-operations.summary","reason":"Action does not exist in source"}
- {"capability":"gas_infrastructure_risk_governance","action":"presentation.generate","reason":"Action does not exist in source"}
- {"capability":"gas_network_decision_chain","action":"dashboard-api.gasNetworkDecisionChainStatus","reason":"Action exists in source; index entry has no action","sources":["services/dashboard-api/actions-part-07-of-8.js"]}
- {"capability":"gas_network_decision_chain","action":"eog-calculator.evaluate","reason":"Action does not exist in source"}
- {"capability":"gas_transformation_dataroom_status","action":"dashboard-api.gasTransformationDataroomStatus","reason":"Action exists in source; index entry has no action","sources":["services/dashboard-api/actions-part-04-of-8.js"]}
- {"capability":"gas_transformation_dataroom_status","action":"eog-calculator.evaluate","reason":"Action does not exist in source"}
- {"capability":"gas_transformation_dataroom_status","action":"dashboard-api.gasDecommissioningRoadmapStatus","reason":"Action exists in source; index entry has no action","sources":["services/dashboard-api/actions-part-03-of-8.js"]}
- {"capability":"gas_transformation_dataroom_status","action":"dashboard-api.gasNetworkDecisionChainStatus","reason":"Action exists in source; index entry has no action","sources":["services/dashboard-api/actions-part-07-of-8.js"]}
- {"capability":"gas_transformation_dataroom_status","action":"knowledge-rag.search","reason":"Action does not exist in source"}
- {"capability":"gas_transformation_dataroom_status","action":"object-store.query","reason":"Action exists in source; index entry has no action","sources":["services/object-store.service.js"]}
- {"capability":"gas_transformation_dependency_map","action":"dashboard-api.gasTransformationDependencyMapStatus","reason":"Action exists in source; index entry has no action","sources":["services/dashboard-api/actions-part-04-of-8.js"]}
- {"capability":"gremiencoach_workbook_readiness","action":"dashboard-api.gremiencoachWorkbookReadinessStatus","reason":"Action exists in source; index entry has no action","sources":["services/dashboard-api/actions-part-01-of-8.js"]}
- {"capability":"grid_connection_transformation_gate","action":"dashboard-api.gridConnectionTransformationGateStatus","reason":"Action exists in source; index entry has no action","sources":["services/dashboard-api/actions-part-05-of-8.js"]}
- {"capability":"grid_connection_transformation_gate","action":"grid-operations.netzfahrplanGenerate","reason":"Action exists in source; index entry has no action","sources":["services/grid-operations.service.js"]}
- {"capability":"grossspeicher_anschluss_readiness_gate","action":"dashboard-api.grossspeicherAnschlussReadinessGateStatus","reason":"Action exists in source; index entry has no action","sources":["services/dashboard-api/actions-part-05-of-8.js"]}
- {"capability":"grossspeicher_anschluss_readiness_gate","action":"grid-operations.netzfahrplanGenerate","reason":"Action exists in source; index entry has no action","sources":["services/grid-operations.service.js"]}
- {"capability":"grossspeicher_anschluss_readiness_gate","action":"forecast-engine.storageDispatch","reason":"Action exists in source; index entry has no action","sources":["services/forecast-engine.service.js"]}
- {"capability":"grossspeicher_anschluss_readiness_gate","action":"forecast-engine.createSchedule","reason":"Action exists in source; index entry has no action","sources":["services/forecast-engine.service.js"]}
- {"capability":"grossspeicher_anschluss_readiness_gate","action":"presentation.generate","reason":"Action does not exist in source"}
- {"capability":"heat_asset_tariff_steering","action":"dashboard-api.heatAssetTariffSteeringStatus","reason":"Action exists in source; index entry has no action","sources":["services/dashboard-api/actions-part-05-of-8.js"]}
- {"capability":"heat_transformation_line_asset_model","action":"dashboard-api.heatTransformationLineAssetModelStatus","reason":"Action exists in source; index entry has no action","sources":["services/dashboard-api/actions-part-04-of-8.js"]}
- {"capability":"heat_transformation_line_asset_model","action":"presentation.generate","reason":"Action does not exist in source"}
- {"capability":"imsys_schedule_value_chain_readiness","action":"dashboard-api.imsysScheduleValueChainReadinessStatus","reason":"Action exists in source; index entry has no action","sources":["services/dashboard-api/actions-part-03-of-8.js"]}
- {"capability":"imsys_schedule_value_chain_readiness","action":"datasource-registry.get","reason":"Action exists in source; index entry has no action","sources":["services/datasource-registry.service.js"]}
- {"capability":"imsys_schedule_value_chain_readiness","action":"forecast-engine.run","reason":"Action does not exist in source"}
- {"capability":"imsys_schedule_value_chain_readiness","action":"grid-operations.netzfahrplanGenerate","reason":"Action exists in source; index entry has no action","sources":["services/grid-operations.service.js"]}
- {"capability":"imsys_schedule_value_chain_readiness","action":"redispatch-expost.audit","reason":"Action exists in source; index entry has no action","sources":["services/redispatch-expost.service.js"]}
- {"capability":"imsys_schedule_value_chain_readiness","action":"presentation.generate","reason":"Action does not exist in source"}
- {"capability":"imsys_taf2_compliance_status","action":"dashboard-api.imsysTaf2ComplianceStatus","reason":"Action exists in source; index entry has no action","sources":["services/dashboard-api/actions-part-04-of-8.js"]}
- {"capability":"imsys_taf2_compliance_status","action":"edm-validation.validate","reason":"Action exists in source; index entry has no action","sources":["services/edm-validation.service.js"]}
- {"capability":"interconnection_release_file","action":"dashboard-api.interconnectionReleaseFileStatus","reason":"Action exists in source; index entry has no action","sources":["services/dashboard-api/actions-part-06-of-8.js"]}
- {"capability":"investment_budget_cap_exception_governance","action":"dashboard-api.investmentBudgetCapExceptionGovernanceStatus","reason":"Action exists in source; index entry has no action","sources":["services/dashboard-api/actions-part-07-of-8.js"]}
- {"capability":"investment_budget_cap_exception_governance","action":"investment-planning.review","reason":"Action does not exist in source"}
- {"capability":"investment_budget_cap_exception_governance","action":"evidence-registry.lookup","reason":"Action does not exist in source"}
- {"capability":"investment_budget_cap_exception_governance","action":"presentation.generate","reason":"Action does not exist in source"}
- {"capability":"investment_committee_steering_cards","action":"dashboard-api.investmentCommitteeSteeringCardsStatus","reason":"Action exists in source; index entry has no action","sources":["services/dashboard-api/actions-part-04-of-8.js"]}
- {"capability":"investment_committee_steering_cards","action":"presentation.generate","reason":"Action does not exist in source"}
- {"capability":"investment_data_review_queue","action":"dashboard-api.investmentDataReviewQueueStatus","reason":"Action exists in source; index entry has no action","sources":["services/dashboard-api/actions-part-04-of-8.js"]}
- {"capability":"investment_data_review_queue","action":"datasource-registry.list","reason":"Action exists in source; index entry has no action","sources":["services/datasource-registry.service.js"]}
- {"capability":"investment_data_review_queue","action":"presentation.generate","reason":"Action does not exist in source"}
- {"capability":"investment_owner_deadline_budget_gate","action":"dashboard-api.investmentOwnerDeadlineBudgetGateStatus","reason":"Action exists in source; index entry has no action","sources":["services/dashboard-api/actions-part-07-of-8.js"]}
- {"capability":"investment_owner_deadline_budget_gate","action":"investment-planning.review","reason":"Action does not exist in source"}
- {"capability":"investment_owner_deadline_budget_gate","action":"evidence-registry.lookup","reason":"Action does not exist in source"}
- {"capability":"investment_owner_deadline_budget_gate","action":"presentation.generate","reason":"Action does not exist in source"}
- {"capability":"investment_risk_translation_status","action":"dashboard-api.investmentRiskTranslationStatus","reason":"Action exists in source; index entry has no action","sources":["services/dashboard-api/actions-part-03-of-8.js"]}
- {"capability":"investment_risk_translation_status","action":"vdmi-findings.list","reason":"Action does not exist in source"}
- {"capability":"investment_risk_translation_status","action":"presentation.generate","reason":"Action does not exist in source"}
- {"capability":"investment_two_track_control","action":"dashboard-api.investmentTwoTrackControlStatus","reason":"Action exists in source; index entry has no action","sources":["services/dashboard-api/actions-part-03-of-8.js"]}
- {"capability":"investment_two_track_control","action":"datasource-registry.get","reason":"Action exists in source; index entry has no action","sources":["services/datasource-registry.service.js"]}
- {"capability":"investment_two_track_control","action":"presentation.generate","reason":"Action does not exist in source"}
- {"capability":"investment_waterfall_governance","action":"dashboard-api.investmentWaterfallGovernanceStatus","reason":"Action exists in source; index entry has no action","sources":["services/dashboard-api/actions-part-04-of-8.js"]}
- {"capability":"investment_waterfall_governance","action":"presentation.generate","reason":"Action does not exist in source"}
- {"capability":"jour_fixe_decision_closure_tracker","action":"dashboard-api.jourFixeDecisionClosureStatus","reason":"Action exists in source; index entry has no action","sources":["services/dashboard-api/actions-part-03-of-8.js"]}
- {"capability":"jour_fixe_decision_closure_tracker","action":"nova.list","reason":"Action does not exist in source"}
- {"capability":"jour_fixe_decision_closure_tracker","action":"vdmi-evidence.inject","reason":"Action does not exist in source"}
- {"capability":"jour_fixe_decision_closure_tracker","action":"presentation.generate","reason":"Action does not exist in source"}
- {"capability":"ki_floorwalker_governance","action":"dashboard-api.kiFloorwalkerGovernanceStatus","reason":"Action exists in source; index entry has no action","sources":["services/dashboard-api/actions-part-04-of-8.js"]}
- {"capability":"ki_floorwalker_governance","action":"presentation.generate","reason":"Action does not exist in source"}
- {"capability":"layer0_audit_drilldown_note","action":"dashboard-api.layer0AuditDrilldownNoteStatus","reason":"Action exists in source; index entry has no action","sources":["services/dashboard-api/actions-part-02-of-8.js"]}
- {"capability":"layer0_audit_drilldown_note","action":"evidence-registry.lookup","reason":"Action does not exist in source"}
- {"capability":"leadership_delta_cockpit","action":"dashboard-api.leadershipDeltaCockpitStatus","reason":"Action exists in source; index entry has no action","sources":["services/dashboard-api/actions-part-08-of-8.js"]}
- {"capability":"leadership_delta_cockpit","action":"evidence-planner.plan","reason":"Action does not exist in source"}
- {"capability":"leadership_delta_cockpit","action":"dashboard-api.vnbOverview","reason":"Action exists in source; index entry has no action","sources":["services/dashboard-api/actions-part-01-of-8.js"]}
- {"capability":"legacy_control_technology_transition","action":"dashboard-api.legacyControlTechnologyTransitionStatus","reason":"Action exists in source; index entry has no action","sources":["services/dashboard-api/actions-part-04-of-8.js"]}
- {"capability":"legacy_control_technology_transition","action":"edm-messkonzept.evaluate","reason":"Action exists in source; index entry has no action","sources":["services/edm-messkonzept.service.js"]}
- {"capability":"legacy_control_technology_transition","action":"presentation.generate","reason":"Action does not exist in source"}
- {"capability":"legal_clarification_operating_model","action":"dashboard-api.legalClarificationOperatingModelStatus","reason":"Action exists in source; index entry has no action","sources":["services/dashboard-api/actions-part-02-of-8.js"]}
- {"capability":"legal_clarification_operating_model","action":"grid-operations.netzfahrplanGenerate","reason":"Action exists in source; index entry has no action","sources":["services/grid-operations.service.js"]}
- {"capability":"liquidity_planning_governance_module","action":"dashboard-api.liquidityPlanningGovernanceStatus","reason":"Action exists in source; index entry has no action","sources":["services/dashboard-api/actions-part-02-of-8.js"]}
- {"capability":"liquidity_planning_governance_module","action":"datasource-registry.get","reason":"Action exists in source; index entry has no action","sources":["services/datasource-registry.service.js"]}
- {"capability":"liquidity_planning_governance_module","action":"datasource-registry.check","reason":"Action does not exist in source"}
- {"capability":"liquidity_planning_governance_module","action":"presentation.generate","reason":"Action does not exist in source"}
- {"capability":"live_update_stream_contract_status","action":"dashboard-api.liveUpdateStreamContractStatus","reason":"Action exists in source; index entry has no action","sources":["services/dashboard-api/actions-part-08-of-8.js"]}
- {"capability":"live_update_stream_contract_status","action":"dashboard-api.loadProfileStreamMonitor","reason":"Action exists in source; index entry has no action","sources":["services/dashboard-api/actions-part-01-of-8.js"]}
- {"capability":"live_update_stream_contract_status","action":"dashboard-api.vnbOverview","reason":"Action exists in source; index entry has no action","sources":["services/dashboard-api/actions-part-01-of-8.js"]}
- {"capability":"load_profile_stream_monitor","action":"dashboard-api.loadProfileStreamMonitor","reason":"Action exists in source; index entry has no action","sources":["services/dashboard-api/actions-part-01-of-8.js"]}
- {"capability":"market_communication_evidence_chain","action":"dashboard-api.marketCommunicationEvidenceChainStatus","reason":"Action exists in source; index entry has no action","sources":["services/dashboard-api/actions-part-01-of-8.js"]}
- {"capability":"market_communication_evidence_chain","action":"edm-validation.validate","reason":"Action exists in source; index entry has no action","sources":["services/edm-validation.service.js"]}
- {"capability":"market_communication_evidence_chain","action":"settlement.readiness","reason":"Action does not exist in source"}
- {"capability":"mastr_sync_gap_alerting","action":"dashboard-api.mastrSyncGapStatus","reason":"Action exists in source; index entry has no action","sources":["services/dashboard-api/actions-part-02-of-8.js"]}
- {"capability":"metering_rollout_process_indicator","action":"dashboard-api.meteringRolloutProcessIndicatorStatus","reason":"Action exists in source; index entry has no action","sources":["services/dashboard-api/actions-part-04-of-8.js"]}
- {"capability":"metering_rollout_process_indicator","action":"datasource-registry.list","reason":"Action exists in source; index entry has no action","sources":["services/datasource-registry.service.js"]}
- {"capability":"metering_rollout_process_indicator","action":"presentation.generate","reason":"Action does not exist in source"}
- {"capability":"model_viability_evidence_gate","action":"dashboard-api.modelViabilityEvidenceGateStatus","reason":"Action exists in source; index entry has no action","sources":["services/dashboard-api/actions-part-08-of-8.js"]}
- {"capability":"model_viability_evidence_gate","action":"presentation.generate","reason":"Action does not exist in source"}
- {"capability":"netzfahrplan_fnav_assessment","action":"grid-operations.netzfahrplanGenerate","reason":"Action exists in source; index entry has no action","sources":["services/grid-operations.service.js"]}
- {"capability":"netzprozess_readiness_gate","action":"dashboard-api.netzprozessReadinessGateStatus","reason":"Action exists in source; index entry has no action","sources":["services/dashboard-api/actions-part-05-of-8.js"]}
- {"capability":"netzprozess_readiness_gate","action":"copilot-process.listProcessIntents","reason":"Action exists in source; index entry has no action","sources":["services/copilot-process.service.js"]}
- {"capability":"netzsignal_delta_gating","action":"dashboard-api.netzsignalDeltaGatingStatus","reason":"Action exists in source; index entry has no action","sources":["services/dashboard-api/actions-part-08-of-8.js"]}
- {"capability":"netzsignal_delta_gating","action":"evidence-planner.plan","reason":"Action does not exist in source"}
- {"capability":"no_regret_measure_definition_gate","action":"dashboard-api.noRegretMeasureDefinitionGateStatus","reason":"Action exists in source; index entry has no action","sources":["services/dashboard-api/actions-part-07-of-8.js"]}
- {"capability":"no_regret_measure_definition_gate","action":"evidence-registry.lookup","reason":"Action does not exist in source"}
- {"capability":"no_regret_measure_definition_gate","action":"investment-planning.review","reason":"Action does not exist in source"}
- {"capability":"no_regret_measure_definition_gate","action":"datasource-registry.get","reason":"Action exists in source; index entry has no action","sources":["services/datasource-registry.service.js"]}
- {"capability":"no_regret_measure_definition_gate","action":"presentation.generate","reason":"Action does not exist in source"}
- {"capability":"no_regret_measure_proof_gate","action":"dashboard-api.noRegretMeasureProofGateStatus","reason":"Action exists in source; index entry has no action","sources":["services/dashboard-api/actions-part-02-of-8.js"]}
- {"capability":"no_regret_measure_proof_gate","action":"evidence-registry.findings","reason":"Action does not exist in source"}
- {"capability":"no_regret_measure_proof_gate","action":"dashboard-api.steeringArtifactAcceptanceGateStatus","reason":"Action exists in source; index entry has no action","sources":["services/dashboard-api/actions-part-02-of-8.js"]}
- {"capability":"no_regret_measure_proof_gate","action":"dashboard-api.investmentOwnerDeadlineBudgetGateStatus","reason":"Action exists in source; index entry has no action","sources":["services/dashboard-api/actions-part-07-of-8.js"]}
- {"capability":"non_escalation_control_evidence","action":"dashboard-api.monitoringNonEscalationStatus","reason":"Action exists in source; index entry has no action","sources":["services/dashboard-api/actions-part-08-of-8.js"]}
- {"capability":"non_escalation_control_evidence","action":"dashboard-api.vnbSpecialTopicWorkstateStatus","reason":"Action exists in source; index entry has no action","sources":["services/dashboard-api/actions-part-08-of-8.js"]}
- {"capability":"non_escalation_control_evidence","action":"dashboard-api.crossDomainSpecialTopicsQueueStatus","reason":"Action exists in source; index entry has no action","sources":["services/dashboard-api/actions-part-07-of-8.js"]}
- {"capability":"non_escalation_control_evidence","action":"evidence-planner.plan","reason":"Action does not exist in source"}
- {"capability":"nova_decision_lifecycle_readiness","action":"dashboard-api.novaDecisionLifecycleReadinessStatus","reason":"Action exists in source; index entry has no action","sources":["services/dashboard-api/actions-part-03-of-8.js"]}
- {"capability":"nova_decision_lifecycle_readiness","action":"presentation.generate","reason":"Action does not exist in source"}
- {"capability":"off_balancing_metering_pruefmatrix","action":"dashboard-api.offBalancingMeteringPruefmatrixStatus","reason":"Action exists in source; index entry has no action","sources":["services/dashboard-api/actions-part-03-of-8.js"]}
- {"capability":"off_balancing_metering_pruefmatrix","action":"datasource-registry.get","reason":"Action exists in source; index entry has no action","sources":["services/datasource-registry.service.js"]}
- {"capability":"off_balancing_metering_pruefmatrix","action":"presentation.generate","reason":"Action does not exist in source"}
- {"capability":"owner_deadline_evidence_gate","action":"dashboard-api.ownerDeadlineEvidenceGateStatus","reason":"Action exists in source; index entry has no action","sources":["services/dashboard-api/actions-part-05-of-8.js"]}
- {"capability":"owner_deadline_evidence_gate","action":"copilot-process.listProcessIntents","reason":"Action exists in source; index entry has no action","sources":["services/copilot-process.service.js"]}
- {"capability":"owner_deadline_evidence_gate","action":"vdmi-evidence.findings","reason":"Action does not exist in source"}
- {"capability":"owner_deadline_evidence_gate","action":"dashboard-api.rolePermissionAccessReadinessGateStatus","reason":"Action exists in source; index entry has no action","sources":["services/dashboard-api/actions-part-05-of-8.js"]}
- {"capability":"process_sensitization_readiness_map","action":"dashboard-api.processSensitizationReadinessMapStatus","reason":"Action exists in source; index entry has no action","sources":["services/dashboard-api/actions-part-05-of-8.js"]}
- {"capability":"process_sensitization_readiness_map","action":"dashboard-api.qualitySummary","reason":"Action exists in source; index entry has no action","sources":["services/dashboard-api/actions-part-08-of-8.js"]}
- {"capability":"process_sensitization_readiness_map","action":"redispatch-expost.audit","reason":"Action exists in source; index entry has no action","sources":["services/redispatch-expost.service.js"]}
- {"capability":"process_sensitization_readiness_map","action":"edm-validation.validate","reason":"Action exists in source; index entry has no action","sources":["services/edm-validation.service.js"]}
- {"capability":"receipt_grounded_presentation_contract","action":"dashboard-api.receiptGroundedPresentationContract","reason":"Action exists in source; index entry has no action","sources":["services/dashboard-api/actions-part-01-of-8.js"]}
- {"capability":"redispatch_call_data_quality_gate","action":"dashboard-api.redispatchCallQualityGate","reason":"Action exists in source; index entry has no action","sources":["services/dashboard-api/actions-part-01-of-8.js"]}
- {"capability":"redispatch_call_data_quality_gate","action":"redispatch-expost.list","reason":"Action exists in source; index entry has no action","sources":["services/redispatch-expost.service.js"]}
- {"capability":"redispatch_call_data_quality_gate","action":"dashboard-api.loadProfileStreamMonitor","reason":"Action exists in source; index entry has no action","sources":["services/dashboard-api/actions-part-01-of-8.js"]}
- {"capability":"redispatch_call_data_quality_gate","action":"edm-validation.validate","reason":"Action exists in source; index entry has no action","sources":["services/edm-validation.service.js"]}
- {"capability":"redispatch_call_data_quality_gate","action":"forecast-engine.evaluateQuality","reason":"Action exists in source; index entry has no action","sources":["services/forecast-engine.service.js"]}
- {"capability":"redispatch_participation_readiness","action":"redispatch-participation-readiness.getStatus","reason":"Action does not exist in source"}
- {"capability":"redispatch_project_controlling_kpi_cockpit","action":"dashboard-api.redispatchProjectControllingKpiCockpitStatus","reason":"Action exists in source; index entry has no action","sources":["services/dashboard-api/actions-part-05-of-8.js"]}
- {"capability":"redispatch_project_controlling_kpi_cockpit","action":"redispatch-expost.audit","reason":"Action exists in source; index entry has no action","sources":["services/redispatch-expost.service.js"]}
- {"capability":"redispatch_project_controlling_kpi_cockpit","action":"redispatch-expost.list","reason":"Action exists in source; index entry has no action","sources":["services/redispatch-expost.service.js"]}
- {"capability":"redispatch_project_controlling_kpi_cockpit","action":"datasource-registry.get","reason":"Action exists in source; index entry has no action","sources":["services/datasource-registry.service.js"]}
- {"capability":"regulatory_change_simulator_readiness","action":"dashboard-api.regulatoryChangeReadinessStatus","reason":"Action exists in source; index entry has no action","sources":["services/dashboard-api/actions-part-03-of-8.js"]}
- {"capability":"regulatory_change_simulator_readiness","action":"datasource-registry.get","reason":"Action exists in source; index entry has no action","sources":["services/datasource-registry.service.js"]}
- {"capability":"regulatory_change_simulator_readiness","action":"edm-validation.validate","reason":"Action exists in source; index entry has no action","sources":["services/edm-validation.service.js"]}
- {"capability":"regulatory_change_simulator_readiness","action":"mscons-import.import","reason":"Action exists in source; index entry has no action","sources":["services/mscons-import.service.js"]}
- {"capability":"regulatory_change_simulator_readiness","action":"presentation.generate","reason":"Action does not exist in source"}
- {"capability":"regulatory_signal_process_translator","action":"dashboard-api.regulatorySignalProcessTranslatorStatus","reason":"Action exists in source; index entry has no action","sources":["services/dashboard-api/actions-part-01-of-8.js"]}
- {"capability":"regulatory_signal_process_translator","action":"evidence-registry.findings","reason":"Action does not exist in source"}
- {"capability":"regulatory_signal_process_translator","action":"regulatory-signal.suppliedFacts","reason":"Action does not exist in source"}
- {"capability":"role_permission_access_readiness_gate","action":"dashboard-api.rolePermissionAccessReadinessGateStatus","reason":"Action exists in source; index entry has no action","sources":["services/dashboard-api/actions-part-05-of-8.js"]}
- {"capability":"role_permission_access_readiness_gate","action":"auth.groupRoleMap","reason":"Action does not exist in source"}
- {"capability":"role_permission_access_readiness_gate","action":"agent-persona.metadata","reason":"Action does not exist in source"}
- {"capability":"role_permission_access_readiness_gate","action":"vdmi-governance-templates.checklist","reason":"Action does not exist in source"}
- {"capability":"role_permission_access_readiness_gate","action":"dashboard-api.netzprozessReadinessGateStatus","reason":"Action exists in source; index entry has no action","sources":["services/dashboard-api/actions-part-05-of-8.js"]}
- {"capability":"sap_budget_psp_gate","action":"dashboard-api.sapBudgetPspGateStatus","reason":"Action exists in source; index entry has no action","sources":["services/dashboard-api/actions-part-03-of-8.js"]}
- {"capability":"sap_budget_psp_gate","action":"datasource-registry.get","reason":"Action exists in source; index entry has no action","sources":["services/datasource-registry.service.js"]}
- {"capability":"sap_budget_psp_gate","action":"presentation.generate","reason":"Action does not exist in source"}
- {"capability":"schedule_management_governance_roadmap","action":"dashboard-api.scheduleManagementGovernanceRoadmapStatus","reason":"Action exists in source; index entry has no action","sources":["services/dashboard-api/actions-part-04-of-8.js"]}
- {"capability":"schedule_management_governance_roadmap","action":"grid-operations.netzfahrplanGenerate","reason":"Action exists in source; index entry has no action","sources":["services/grid-operations.service.js"]}
- {"capability":"schedule_management_governance_roadmap","action":"redispatch-expost.audit","reason":"Action exists in source; index entry has no action","sources":["services/redispatch-expost.service.js"]}
- {"capability":"schedule_management_governance_roadmap","action":"edm-validation.validate","reason":"Action exists in source; index entry has no action","sources":["services/edm-validation.service.js"]}
- {"capability":"smart_meter_cls_data_governance_receipt","action":"dashboard-api.marketCommunicationEvidenceChainStatus","reason":"Action exists in source; index entry has no action","sources":["services/dashboard-api/actions-part-01-of-8.js"]}
- {"capability":"smart_meter_cls_data_governance_receipt","action":"dashboard-api.regulatorySignalProcessTranslatorStatus","reason":"Action exists in source; index entry has no action","sources":["services/dashboard-api/actions-part-01-of-8.js"]}
- {"capability":"smart_meter_cls_data_governance_receipt","action":"dashboard-api.regulatoryChangeReadinessStatus","reason":"Action exists in source; index entry has no action","sources":["services/dashboard-api/actions-part-03-of-8.js"]}
- {"capability":"smart_meter_cls_data_governance_receipt","action":"dashboard-api.smartMeterOffBalancingPurposeLockStatus","reason":"Action exists in source; index entry has no action","sources":["services/dashboard-api/actions-part-03-of-8.js"]}
- {"capability":"smart_meter_off_balancing_purpose_lock","action":"dashboard-api.smartMeterOffBalancingPurposeLockStatus","reason":"Action exists in source; index entry has no action","sources":["services/dashboard-api/actions-part-03-of-8.js"]}
- {"capability":"smart_meter_off_balancing_purpose_lock","action":"investment-planning.read","reason":"Action does not exist in source"}
- {"capability":"smart_meter_off_balancing_purpose_lock","action":"datasource-registry.get","reason":"Action exists in source; index entry has no action","sources":["services/datasource-registry.service.js"]}
- {"capability":"smart_meter_off_balancing_purpose_lock","action":"presentation.generate","reason":"Action does not exist in source"}
- {"capability":"smgw_connector_readiness_status","action":"dashboard-api.smgwConnectorReadinessStatus","reason":"Action exists in source; index entry has no action","sources":["services/dashboard-api/actions-part-08-of-8.js"]}
- {"capability":"smgw_connector_readiness_status","action":"dossier-hydration.registry","reason":"Action does not exist in source"}
- {"capability":"special_grid_usage_impact_map","action":"dashboard-api.specialGridUsageImpactMapStatus","reason":"Action exists in source; index entry has no action","sources":["services/dashboard-api/actions-part-02-of-8.js"]}
- {"capability":"special_grid_usage_impact_map","action":"datasource-registry.get","reason":"Action exists in source; index entry has no action","sources":["services/datasource-registry.service.js"]}
- {"capability":"special_grid_usage_impact_map","action":"settlement.readiness","reason":"Action does not exist in source"}
- {"capability":"special_grid_usage_impact_map","action":"customer-service.get","reason":"Action does not exist in source"}
- {"capability":"special_grid_usage_impact_map","action":"presentation.generate","reason":"Action does not exist in source"}
- {"capability":"stadtwerk_mauer_capability_projection","action":"dashboard-api.stadtwerkMauerCapabilityProjectionStatus","reason":"Action exists in source; index entry has no action","sources":["services/dashboard-api/actions-part-05-of-8.js"]}
- {"capability":"stadtwerk_mauer_capability_projection","action":"dashboard-api.stadtwerkMauerVdmiProfileStatus","reason":"Action exists in source; index entry has no action","sources":["services/dashboard-api/actions-part-05-of-8.js"]}
- {"capability":"stadtwerk_mauer_capability_projection","action":"capability-broker.recommend","reason":"Action exists in source; no matching index entry","sources":["services/capability-broker.service.js"]}
- {"capability":"stadtwerk_mauer_capability_projection","action":"dossier-hydration.registry","reason":"Action does not exist in source"}
- {"capability":"stadtwerk_mauer_capability_projection","action":"presentation.generate","reason":"Action does not exist in source"}
- {"capability":"stadtwerk_mauer_e2e_process_demo","action":"dashboard-api.stadtwerkMauerE2eProcessDemoStatus","reason":"Action exists in source; index entry has no action","sources":["services/dashboard-api/actions-part-06-of-8.js"]}
- {"capability":"stadtwerk_mauer_event_replay_preview","action":"dashboard-api.stadtwerkMauerEventReplayPreviewStatus","reason":"Action exists in source; index entry has no action","sources":["services/dashboard-api/actions-part-05-of-8.js"]}
- {"capability":"stadtwerk_mauer_event_replay_preview","action":"dashboard-api.stadtwerkMauerCapabilityProjectionStatus","reason":"Action exists in source; index entry has no action","sources":["services/dashboard-api/actions-part-05-of-8.js"]}
- {"capability":"stadtwerk_mauer_event_replay_preview","action":"dashboard-api.stadtwerkMauerVdmiProfileStatus","reason":"Action exists in source; index entry has no action","sources":["services/dashboard-api/actions-part-05-of-8.js"]}
- {"capability":"stadtwerk_mauer_event_replay_preview","action":"capability-broker.recommend","reason":"Action exists in source; no matching index entry","sources":["services/capability-broker.service.js"]}
- {"capability":"stadtwerk_mauer_event_replay_preview","action":"dossier-hydration.registry","reason":"Action does not exist in source"}
- {"capability":"stadtwerk_mauer_event_replay_preview","action":"presentation.generate","reason":"Action does not exist in source"}
- {"capability":"stadtwerk_mauer_external_interface_stubs","action":"dashboard-api.stadtwerkMauerExternalInterfaceStubsStatus","reason":"Action exists in source; index entry has no action","sources":["services/dashboard-api/actions-part-05-of-8.js"]}
- {"capability":"stadtwerk_mauer_mastr_data_overlay","action":"dashboard-api.stadtwerkMauerMastrDataOverlayStatus","reason":"Action exists in source; index entry has no action","sources":["services/dashboard-api/actions-part-06-of-8.js"]}
- {"capability":"stadtwerk_mauer_sandbox_runtime","action":"dashboard-api.stadtwerkMauerSandboxRuntimeStatus","reason":"Action exists in source; index entry has no action","sources":["services/dashboard-api/actions-part-05-of-8.js"]}
- {"capability":"stadtwerk_mauer_sandbox_runtime","action":"object-store.query","reason":"Action exists in source; index entry has no action","sources":["services/object-store.service.js"]}
- {"capability":"stadtwerk_mauer_vdmi_profile","action":"dashboard-api.stadtwerkMauerVdmiProfileStatus","reason":"Action exists in source; index entry has no action","sources":["services/dashboard-api/actions-part-05-of-8.js"]}
- {"capability":"stadtwerk_mauer_vdmi_profile","action":"capability-broker.recommend","reason":"Action exists in source; no matching index entry","sources":["services/capability-broker.service.js"]}
- {"capability":"stadtwerk_mauer_vdmi_profile","action":"dossier-hydration.registry","reason":"Action does not exist in source"}
- {"capability":"stadtwerk_mauer_vdmi_profile","action":"presentation.generate","reason":"Action does not exist in source"}
- {"capability":"steering_artifact_acceptance_gate","action":"dashboard-api.steeringArtifactAcceptanceGateStatus","reason":"Action exists in source; index entry has no action","sources":["services/dashboard-api/actions-part-02-of-8.js"]}
- {"capability":"steering_artifact_acceptance_gate","action":"evidence-registry.findings","reason":"Action does not exist in source"}
- {"capability":"steering_artifact_acceptance_gate","action":"dashboard-api.ownerDeadlineEvidenceGateStatus","reason":"Action exists in source; index entry has no action","sources":["services/dashboard-api/actions-part-05-of-8.js"]}
- {"capability":"steering_artifact_acceptance_gate","action":"dashboard-api.rolePermissionAccessReadinessGateStatus","reason":"Action exists in source; index entry has no action","sources":["services/dashboard-api/actions-part-05-of-8.js"]}
- {"capability":"tech_commercial_offer_cockpit","action":"dashboard-api.techCommercialOfferCockpitStatus","reason":"Action exists in source; index entry has no action","sources":["services/dashboard-api/actions-part-05-of-8.js"]}
- {"capability":"tech_commercial_offer_cockpit","action":"grid-operations.netzfahrplanGenerate","reason":"Action exists in source; index entry has no action","sources":["services/grid-operations.service.js"]}
- {"capability":"tech_commercial_offer_cockpit","action":"edm-validation.validate","reason":"Action exists in source; index entry has no action","sources":["services/edm-validation.service.js"]}
- {"capability":"transformation_financing_scenario_view","action":"dashboard-api.transformationFinancingScenarioViewStatus","reason":"Action exists in source; index entry has no action","sources":["services/dashboard-api/actions-part-07-of-8.js"]}
- {"capability":"transformation_financing_scenario_view","action":"datasource-registry.get","reason":"Action exists in source; index entry has no action","sources":["services/datasource-registry.service.js"]}
- {"capability":"transformation_financing_scenario_view","action":"presentation.generate","reason":"Action does not exist in source"}
- {"capability":"vnb_delta_signal_classifier","action":"dashboard-api.vnbDeltaSignalClassifierStatus","reason":"Action exists in source; index entry has no action","sources":["services/dashboard-api/actions-part-08-of-8.js"]}
- {"capability":"vnb_delta_signal_classifier","action":"evidence-planner.plan","reason":"Action does not exist in source"}
- {"capability":"vnb_delta_signal_classifier","action":"dashboard-api.leadershipDeltaCockpitStatus","reason":"Action exists in source; index entry has no action","sources":["services/dashboard-api/actions-part-08-of-8.js"]}
- {"capability":"vnb_special_topic_workstate","action":"dashboard-api.vnbSpecialTopicWorkstateStatus","reason":"Action exists in source; index entry has no action","sources":["services/dashboard-api/actions-part-08-of-8.js"]}
- {"capability":"vnb_special_topic_workstate","action":"dashboard-api.evidenceFreshnessGuardStatus","reason":"Action exists in source; index entry has no action","sources":["services/dashboard-api/actions-part-08-of-8.js"]}
- {"capability":"vnb_special_topic_workstate","action":"dashboard-api.crossDomainSpecialTopicsQueueStatus","reason":"Action exists in source; index entry has no action","sources":["services/dashboard-api/actions-part-07-of-8.js"]}
- {"capability":"vnb_special_topic_workstate","action":"dashboard-api.leadershipDeltaCockpitStatus","reason":"Action exists in source; index entry has no action","sources":["services/dashboard-api/actions-part-08-of-8.js"]}
- {"capability":"vnb_special_topic_workstate","action":"evidence-planner.plan","reason":"Action does not exist in source"}
- {"capability":"water_pricing_net_investment_alignment_gate","action":"dashboard-api.waterPricingNetInvestmentAlignmentStatus","reason":"Action exists in source; index entry has no action","sources":["services/dashboard-api/actions-part-07-of-8.js"]}
- {"capability":"water_pricing_net_investment_alignment_gate","action":"investment-planning.review","reason":"Action does not exist in source"}
- {"capability":"water_pricing_net_investment_alignment_gate","action":"reporting-governance.evaluate","reason":"Action does not exist in source"}
- {"capability":"water_pricing_net_investment_alignment_gate","action":"regulatorische-entgeltlogik.evaluate","reason":"Action does not exist in source"}
- {"capability":"water_pricing_net_investment_alignment_gate","action":"vdmi-portfolio-gatekeeping.evaluate","reason":"Action does not exist in source"}
- {"capability":"zaehlpark_finanzierung_szenario_cockpit","action":"dashboard-api.zaehlparkFinanzierungSzenarioCockpitStatus","reason":"Action exists in source; index entry has no action","sources":["services/dashboard-api/actions-part-05-of-8.js"]}
- {"capability":"zaehlpark_finanzierung_szenario_cockpit","action":"edm-validation.validate","reason":"Action exists in source; index entry has no action","sources":["services/edm-validation.service.js"]}
- {"capability":"znp_production_readiness_evidence_gate","action":"dossier-hydration.registry","reason":"Action does not exist in source"}
- {"capability":"znp_production_readiness_evidence_gate","action":"presentation.generate","reason":"Action does not exist in source"}

## isolatedFunctions (30)

- {"functionId":"fn-agnes-bottleneck","reason":"Insufficient independent evidence at default threshold","strongestWeight":0.18256439934821705}
- {"functionId":"fn-altdaten-assessment","reason":"Insufficient independent evidence at default threshold","strongestWeight":0.12182822202078594}
- {"functionId":"fn-automatisierungsradar","reason":"Insufficient independent evidence at default threshold","strongestWeight":0.1615792128084424}
- {"functionId":"fn-bilanzkreis-slp-edm-operations","reason":"Insufficient independent evidence at default threshold","strongestWeight":0.06649795087959659}
- {"functionId":"fn-blindflug-radar-anomaly-detection","reason":"Insufficient independent evidence at default threshold","strongestWeight":0.15339035986142885}
- {"functionId":"fn-capex-prioritization","reason":"Insufficient independent evidence at default threshold","strongestWeight":0.0998478132720822}
- {"functionId":"fn-connection-rejection-evidence","reason":"Insufficient independent evidence at default threshold","strongestWeight":0.09683274681017806}
- {"functionId":"fn-connection-rejection-fnav-14a-evidence","reason":"Insufficient independent evidence at default threshold","strongestWeight":0.1879886668152272}
- {"functionId":"fn-decommissioned-asset-reconciliation","reason":"No resolvable operations","strongestWeight":0.11636414095930514}
- {"functionId":"fn-direct-marketer-risk-gate","reason":"Insufficient independent evidence at default threshold","strongestWeight":0.19126872241490023}
- {"functionId":"fn-e2e-connection-check","reason":"Insufficient independent evidence at default threshold","strongestWeight":0.08488403287772796}
- {"functionId":"fn-edm-metering-concept-evidence","reason":"Insufficient independent evidence at default threshold","strongestWeight":0.17748479601706754}
- {"functionId":"fn-energy-sharing-collective-approval","reason":"No resolvable operations","strongestWeight":0.14980624605459422}
- {"functionId":"fn-file-ingest-monitor","reason":"No resolvable operations","strongestWeight":0.1615792128084424}
- {"functionId":"fn-finance-nkp-capex-reinvest-governance","reason":"Insufficient independent evidence at default threshold","strongestWeight":0.09260076313933958}
- {"functionId":"fn-flexibilitaetskosten-raster","reason":"Insufficient independent evidence at default threshold","strongestWeight":0.17352792674089246}
- {"functionId":"fn-flexibility-conductor-role-model","reason":"Insufficient independent evidence at default threshold","strongestWeight":0.1807348792166718}
- {"functionId":"fn-knowledge-continuity-governance-gate","reason":"Insufficient independent evidence at default threshold","strongestWeight":0.1807348792166718}
- {"functionId":"fn-mastr-sync-gap-alerting","reason":"No resolvable operations","strongestWeight":0.1315257595425052}
- {"functionId":"fn-netzkoppelvertrag-workflow","reason":"Insufficient independent evidence at default threshold","strongestWeight":0.10130524412678037}
- {"functionId":"fn-nkp-reporting","reason":"Insufficient independent evidence at default threshold","strongestWeight":0.12061165815838279}
- {"functionId":"fn-oep-research-dataset-discovery","reason":"Insufficient independent evidence at default threshold","strongestWeight":0.17876178717362728}
- {"functionId":"fn-re4de-variable-grid-fee-layer3","reason":"Insufficient independent evidence at default threshold","strongestWeight":0.14477259054484803}
- {"functionId":"fn-redispatch-data-governance","reason":"Insufficient independent evidence at default threshold","strongestWeight":0.157747732061003}
- {"functionId":"fn-redispatch-readiness-gate","reason":"Insufficient independent evidence at default threshold","strongestWeight":0.12700835195623744}
- {"functionId":"fn-reinvest-signal","reason":"Insufficient independent evidence at default threshold","strongestWeight":0.12182822202078594}
- {"functionId":"fn-reporting-governance","reason":"Insufficient independent evidence at default threshold","strongestWeight":0.12954495228239757}
- {"functionId":"fn-settlement-a96-reconciliation","reason":"Insufficient independent evidence at default threshold","strongestWeight":0.08488403287772796}
- {"functionId":"fn-vdmi-governance-templates","reason":"Insufficient independent evidence at default threshold","strongestWeight":0.16608111479033671}
- {"functionId":"fn-water-pricing-net-investment-alignment-gate","reason":"Insufficient independent evidence at default threshold","strongestWeight":0.08488403287772796}

## placeholderOnlyFunctions (4)

- fn-connection-rejection-fnav-14a-evidence
- fn-cya-assessment-briefing
- fn-edm-metering-concept-evidence
- fn-finance-nkp-capex-reinvest-governance

## functionsWithoutEvents (56)

- fn-agnes-bottleneck
- fn-altdaten-assessment
- fn-automatisierungsradar
- fn-battery-redispatch-special-gate
- fn-bess-screening
- fn-bilanzkreis-slp-edm-operations
- fn-capex-prioritization
- fn-connection-rejection-evidence
- fn-connection-rejection-fnav-14a-evidence
- fn-cost-review-committee-status
- fn-cross-commodity-supply-security-lagebild
- fn-cya-assessment-briefing
- fn-decommissioned-asset-reconciliation
- fn-e2e-connection-check
- fn-edm-metering-concept-evidence
- fn-eeg-clawback-ewk-monitoring
- fn-eic-code-lookup
- fn-energy-sharing-42c-cutover-readiness
- fn-energy-sharing-collective-approval
- fn-energy-sharing-simulation-gate
- fn-energy-sidecar-route-registry
- fn-evu-api-migration-diagnostics
- fn-file-ingest-monitor
- fn-finance-nkp-capex-reinvest-governance
- fn-flexibilitaetskosten-raster
- fn-flexibility-conductor-role-model
- fn-fnav-commercial-hedging
- fn-gas-capacity-order-revision-gate
- fn-german-grid-market-data
- fn-ghost-asset-alert
- fn-grid-operator-identity-resolution
- fn-interconnection-release-file
- fn-investment-maturity-off-balance-gate
- fn-knowledge-continuity-governance-gate
- fn-load-profile-stream-monitor
- fn-mastr-sync-gap-alerting
- fn-netzkoppelvertrag-workflow
- fn-nkp-reporting
- fn-nova-decision-lifecycle-readiness
- fn-oep-research-dataset-discovery
- fn-re4de-variable-grid-fee-layer3
- fn-redispatch-asset-register
- fn-redispatch-data-governance
- fn-redispatch-participation-readiness
- fn-redispatch-readiness-gate
- fn-redispatch-settlement-sandbox
- fn-redispatch-special-case-gate
- fn-regulatorische-entgeltlogik
- fn-reinvest-signal
- fn-renewable-generation-forecast
- fn-reporting-governance
- fn-residual-load-forecast-for-dso
- fn-scqa-decision-framing
- fn-settlement-a96-reconciliation
- fn-vdmi-governance-templates
- fn-vnb-100-tage-assessment

## functionsWithoutListeners (57)

- fn-agnes-bottleneck
- fn-altdaten-assessment
- fn-automatisierungsradar
- fn-battery-redispatch-special-gate
- fn-bess-screening
- fn-bilanzkreis-slp-edm-operations
- fn-blindflug-radar-anomaly-detection
- fn-capex-prioritization
- fn-connection-rejection-evidence
- fn-connection-rejection-fnav-14a-evidence
- fn-cost-review-committee-status
- fn-cross-commodity-supply-security-lagebild
- fn-cya-assessment-briefing
- fn-decommissioned-asset-reconciliation
- fn-e2e-connection-check
- fn-edm-metering-concept-evidence
- fn-eeg-clawback-ewk-monitoring
- fn-eic-code-lookup
- fn-energy-sharing-42c-cutover-readiness
- fn-energy-sharing-collective-approval
- fn-energy-sharing-simulation-gate
- fn-energy-sidecar-route-registry
- fn-evu-api-migration-diagnostics
- fn-file-ingest-monitor
- fn-finance-nkp-capex-reinvest-governance
- fn-flexibilitaetskosten-raster
- fn-flexibility-conductor-role-model
- fn-fnav-commercial-hedging
- fn-gas-capacity-order-revision-gate
- fn-german-grid-market-data
- fn-ghost-asset-alert
- fn-grid-operator-identity-resolution
- fn-interconnection-release-file
- fn-investment-maturity-off-balance-gate
- fn-knowledge-continuity-governance-gate
- fn-load-profile-stream-monitor
- fn-mastr-sync-gap-alerting
- fn-netzkoppelvertrag-workflow
- fn-nkp-reporting
- fn-nova-decision-lifecycle-readiness
- fn-oep-research-dataset-discovery
- fn-re4de-variable-grid-fee-layer3
- fn-redispatch-asset-register
- fn-redispatch-data-governance
- fn-redispatch-participation-readiness
- fn-redispatch-readiness-gate
- fn-redispatch-settlement-sandbox
- fn-redispatch-special-case-gate
- fn-regulatorische-entgeltlogik
- fn-reinvest-signal
- fn-renewable-generation-forecast
- fn-reporting-governance
- fn-residual-load-forecast-for-dso
- fn-scqa-decision-framing
- fn-settlement-a96-reconciliation
- fn-vdmi-governance-templates
- fn-vnb-100-tage-assessment

## unresolvedStaticEvents (63)

- {"service":"agent","ref":"src/job-store.js:67: dynamic emission"}
- {"service":"agent","ref":"src/llm-client.js:159: dynamic emission"}
- {"service":"api","ref":"services/api.service.js:532: dynamic emission"}
- {"service":"assets","ref":"src/job-store.js:67: dynamic emission"}
- {"service":"business-intelligence","ref":"src/job-store.js:67: dynamic emission"}
- {"service":"company","ref":"src/job-store.js:67: dynamic emission"}
- {"service":"cookbook","ref":"src/job-store.js:67: dynamic emission"}
- {"service":"cookbook","ref":"src/llm-client.js:159: dynamic emission"}
- {"service":"customer-service","ref":"src/job-store.js:67: dynamic emission"}
- {"service":"cya","ref":"services/cya.service.js:3412: dynamic emission"}
- {"service":"cya","ref":"src/job-store.js:67: dynamic emission"}
- {"service":"cya","ref":"src/llm-client.js:159: dynamic emission"}
- {"service":"datasource-classifier","ref":"src/job-store.js:67: dynamic emission"}
- {"service":"decision-frame","ref":"src/job-store.js:67: dynamic emission"}
- {"service":"decision-frame","ref":"src/llm-client.js:159: dynamic emission"}
- {"service":"domain-router","ref":"src/job-store.js:67: dynamic emission"}
- {"service":"domain-router","ref":"src/llm-client.js:159: dynamic emission"}
- {"service":"eeg-clawback-calculator","ref":"src/job-store.js:67: dynamic emission"}
- {"service":"eic-codes","ref":"src/job-store.js:67: dynamic emission"}
- {"service":"energy-market","ref":"src/job-store.js:67: dynamic emission"}
- {"service":"energy-sharing-allocation","ref":"src/job-store.js:67: dynamic emission"}
- {"service":"energy-sharing","ref":"src/job-store.js:67: dynamic emission"}
- {"service":"entsoe","ref":"src/job-store.js:67: dynamic emission"}
- {"service":"ewk-monitoring","ref":"src/job-store.js:67: dynamic emission"}
- {"service":"finance-agent","ref":"src/job-store.js:67: dynamic emission"}
- {"service":"finance-agent","ref":"src/llm-client.js:159: dynamic emission"}
- {"service":"forecast-sandbox","ref":"src/job-store.js:67: dynamic emission"}
- {"service":"forecast","ref":"src/job-store.js:67: dynamic emission"}
- {"service":"gas-storage","ref":"src/job-store.js:67: dynamic emission"}
- {"service":"german-grid","ref":"src/job-store.js:67: dynamic emission"}
- {"service":"grid-connection","ref":"src/job-store.js:67: dynamic emission"}
- {"service":"grid-operations","ref":"src/job-store.js:67: dynamic emission"}
- {"service":"job-status","ref":"src/job-store.js:67: dynamic emission"}
- {"service":"knowledge-rag","ref":"services/knowledge-rag.service.js:136: dynamic emission"}
- {"service":"knowledge-rag","ref":"src/job-store.js:67: dynamic emission"}
- {"service":"knowledge-rag","ref":"src/llm-client.js:159: dynamic emission"}
- {"service":"mastr-monitor","ref":"src/job-store.js:67: dynamic emission"}
- {"service":"mastr-quality","ref":"src/job-store.js:67: dynamic emission"}
- {"service":"nova","ref":"services/nova.service.js:1079: dynamic emission"}
- {"service":"nova","ref":"src/job-store.js:67: dynamic emission"}
- {"service":"oep","ref":"src/job-store.js:67: dynamic emission"}
- {"service":"openai-compatible","ref":"src/job-store.js:67: dynamic emission"}
- {"service":"openai-compatible","ref":"src/llm-client.js:159: dynamic emission"}
- {"service":"operations-runbook","ref":"src/job-store.js:67: dynamic emission"}
- {"service":"osm-geo","ref":"src/job-store.js:67: dynamic emission"}
- {"service":"personal-agent-work-out-loud-listener","ref":"services/personal-agent-work-out-loud-listener.service.js:30: dynamic listener"}
- {"service":"personal-agent","ref":"services/personal-agent/methods-part-08-of-11.js:31: dynamic emission"}
- {"service":"personal-agent","ref":"src/job-store.js:67: dynamic emission"}
- {"service":"personal-agent","ref":"src/llm-client.js:159: dynamic emission"}
- {"service":"query","ref":"src/job-store.js:67: dynamic emission"}
- {"service":"redispatch-expost","ref":"src/job-store.js:67: dynamic emission"}
- {"service":"residual-load","ref":"src/job-store.js:67: dynamic emission"}
- {"service":"system","ref":"src/job-store.js:67: dynamic emission"}
- {"service":"system","ref":"src/llm-client.js:159: dynamic emission"}
- {"service":"tabular","ref":"src/job-store.js:67: dynamic emission"}
- {"service":"tabular","ref":"src/llm-client.js:159: dynamic emission"}
- {"service":"utility-report","ref":"src/job-store.js:67: dynamic emission"}
- {"service":"utility-report","ref":"src/llm-client.js:159: dynamic emission"}
- {"service":"willi-federated","ref":"src/job-store.js:67: dynamic emission"}
- {"service":"willi-mako","ref":"src/job-store.js:67: dynamic emission"}
- {"service":"willi-regulatorik","ref":"src/job-store.js:67: dynamic emission"}
- {"service":"znp","ref":"src/job-store.js:67: dynamic emission"}
- {"service":"znp","ref":"src/llm-client.js:159: dynamic emission"}

## overrides (0)

None.

## actionsWithMissingIndexAction (200)

- {"capability":"a2mdm_decision_object_meaning_preservation","action":"dashboard-api.a2mdmDecisionObjectStatus","reason":"Action exists in source; index entry has no action","sources":["services/dashboard-api/actions-part-01-of-8.js"]}
- {"capability":"a2mdm_decision_object_meaning_preservation","action":"dashboard-api.coordinationMeaningPreservationProfile","reason":"Action exists in source; index entry has no action","sources":["services/dashboard-api/actions-part-01-of-8.js"]}
- {"capability":"a2mdm_decision_object_meaning_preservation","action":"dashboard-api.interconnectionReleaseFileStatus","reason":"Action exists in source; index entry has no action","sources":["services/dashboard-api/actions-part-06-of-8.js"]}
- {"capability":"anschlusskapazitaet_evidence_queue","action":"dashboard-api.anschlusskapazitaetEvidenceQueueStatus","reason":"Action exists in source; index entry has no action","sources":["services/dashboard-api/actions-part-02-of-8.js"]}
- {"capability":"areal_network_integration_offer_gate","action":"dashboard-api.arealNetworkIntegrationOfferGateStatus","reason":"Action exists in source; index entry has no action","sources":["services/dashboard-api/actions-part-07-of-8.js"]}
- {"capability":"asset_valuation_transformation_gate","action":"dashboard-api.assetValuationTransformationGateStatus","reason":"Action exists in source; index entry has no action","sources":["services/dashboard-api/actions-part-07-of-8.js"]}
- {"capability":"automation_requirements_decision_value","action":"dashboard-api.automationRequirementsDecisionValueStatus","reason":"Action exists in source; index entry has no action","sources":["services/dashboard-api/actions-part-03-of-8.js"]}
- {"capability":"automation_requirements_decision_value","action":"datasource-registry.get","reason":"Action exists in source; index entry has no action","sources":["services/datasource-registry.service.js"]}
- {"capability":"automation_risk_gate","action":"dashboard-api.automationRiskGateStatus","reason":"Action exists in source; index entry has no action","sources":["services/dashboard-api/actions-part-05-of-8.js"]}
- {"capability":"automation_risk_gate","action":"datasource-registry.list","reason":"Action exists in source; index entry has no action","sources":["services/datasource-registry.service.js"]}
- {"capability":"budget_waterfall_governance","action":"dashboard-api.budgetWaterfallGovernanceStatus","reason":"Action exists in source; index entry has no action","sources":["services/dashboard-api/actions-part-03-of-8.js"]}
- {"capability":"budget_waterfall_governance","action":"datasource-registry.get","reason":"Action exists in source; index entry has no action","sources":["services/datasource-registry.service.js"]}
- {"capability":"capacity_contract_risk_asset_cockpit","action":"dashboard-api.capacityContractRiskAssetCockpitStatus","reason":"Action exists in source; index entry has no action","sources":["services/dashboard-api/actions-part-04-of-8.js"]}
- {"capability":"capacity_contract_risk_asset_cockpit","action":"grid-operations.netzfahrplanGenerate","reason":"Action exists in source; index entry has no action","sources":["services/grid-operations.service.js"]}
- {"capability":"cls_digital_twin_compliance_gate","action":"dashboard-api.clsDigitalTwinComplianceGateStatus","reason":"Action exists in source; index entry has no action","sources":["services/dashboard-api/actions-part-03-of-8.js"]}
- {"capability":"cls_digital_twin_compliance_gate","action":"datasource-registry.get","reason":"Action exists in source; index entry has no action","sources":["services/datasource-registry.service.js"]}
- {"capability":"communication_break_process_risk","action":"dashboard-api.communicationBreakProcessRiskStatus","reason":"Action exists in source; index entry has no action","sources":["services/dashboard-api/actions-part-02-of-8.js"]}
- {"capability":"communication_break_process_risk","action":"dashboard-api.ownerDeadlineEvidenceGateStatus","reason":"Action exists in source; index entry has no action","sources":["services/dashboard-api/actions-part-05-of-8.js"]}
- {"capability":"communication_break_process_risk","action":"dashboard-api.steeringArtifactAcceptanceGateStatus","reason":"Action exists in source; index entry has no action","sources":["services/dashboard-api/actions-part-02-of-8.js"]}
- {"capability":"connection_deadline_evidence_queue","action":"dashboard-api.connectionDeadlineEvidenceQueueStatus","reason":"Action exists in source; index entry has no action","sources":["services/dashboard-api/actions-part-02-of-8.js"]}
- {"capability":"controllability_asset_handover","action":"dashboard-api.controllabilityAssetHandoverStatus","reason":"Action exists in source; index entry has no action","sources":["services/dashboard-api/actions-part-01-of-8.js"]}
- {"capability":"controllability_asset_handover","action":"redispatch-expost.audit","reason":"Action exists in source; index entry has no action","sources":["services/redispatch-expost.service.js"]}
- {"capability":"controllability_data_alignment","action":"dashboard-api.controllabilityDataAlignmentStatus","reason":"Action exists in source; index entry has no action","sources":["services/dashboard-api/actions-part-01-of-8.js"]}
- {"capability":"controllability_data_alignment","action":"redispatch-expost.audit","reason":"Action exists in source; index entry has no action","sources":["services/redispatch-expost.service.js"]}
- {"capability":"controllability_submission_cockpit","action":"dashboard-api.controllabilitySubmissionCockpitStatus","reason":"Action exists in source; index entry has no action","sources":["services/dashboard-api/actions-part-04-of-8.js"]}
- {"capability":"controllability_submission_cockpit","action":"edm-validation.validate","reason":"Action exists in source; index entry has no action","sources":["services/edm-validation.service.js"]}
- {"capability":"coordination_meaning_preservation_profile","action":"dashboard-api.coordinationMeaningPreservationProfile","reason":"Action exists in source; index entry has no action","sources":["services/dashboard-api/actions-part-01-of-8.js"]}
- {"capability":"cost_review_committee_status","action":"dashboard-api.costReviewCommitteeStatus","reason":"Action exists in source; index entry has no action","sources":["services/dashboard-api/actions-part-02-of-8.js"]}
- {"capability":"crisis_decision_routine","action":"dashboard-api.crisisDecisionRoutineStatus","reason":"Action exists in source; index entry has no action","sources":["services/dashboard-api/actions-part-04-of-8.js"]}
- {"capability":"cross_channel_vnb_signal_queue","action":"dashboard-api.crossChannelVnbSignalQueueStatus","reason":"Action exists in source; index entry has no action","sources":["services/dashboard-api/actions-part-07-of-8.js"]}
- {"capability":"cross_domain_special_topics_queue","action":"dashboard-api.crossDomainSpecialTopicsQueueStatus","reason":"Action exists in source; index entry has no action","sources":["services/dashboard-api/actions-part-07-of-8.js"]}
- {"capability":"cross_system_variance_matrix","action":"dashboard-api.crossSystemVarianceMatrixStatus","reason":"Action exists in source; index entry has no action","sources":["services/dashboard-api/actions-part-01-of-8.js"]}
- {"capability":"decision_readiness_matrix","action":"dashboard-api.decisionReadinessMatrixStatus","reason":"Action exists in source; index entry has no action","sources":["services/dashboard-api/actions-part-01-of-8.js"]}
- {"capability":"decommissioned_asset_reconciliation","action":"dashboard-api.decommissionedAssetReconciliationStatus","reason":"Action exists in source; index entry has no action","sources":["services/dashboard-api/actions-part-02-of-8.js"]}
- {"capability":"direct_marketer_risk_gate","action":"dashboard-api.directMarketerRiskGateStatus","reason":"Action exists in source; index entry has no action","sources":["services/dashboard-api/actions-part-07-of-8.js"]}
- {"capability":"dr_readiness_evidence_gate","action":"dashboard-api.drReadinessEvidenceStatus","reason":"Action exists in source; index entry has no action","sources":["services/dashboard-api/actions-part-02-of-8.js"]}
- {"capability":"e2e_controllability_check_governance","action":"dashboard-api.e2eControllabilityGovernanceStatus","reason":"Action exists in source; index entry has no action","sources":["services/dashboard-api/actions-part-01-of-8.js"]}
- {"capability":"e2e_controllability_check_governance","action":"edm-messkonzept.evaluate","reason":"Action exists in source; index entry has no action","sources":["services/edm-messkonzept.service.js"]}
- {"capability":"e2e_controllability_check_governance","action":"edm-validation.validate","reason":"Action exists in source; index entry has no action","sources":["services/edm-validation.service.js"]}
- {"capability":"edm_metering_concept_evidence","action":"edm-messkonzept.list","reason":"Action exists in source; index entry has no action","sources":["services/edm-messkonzept.service.js"]}
- {"capability":"edm_metering_concept_evidence","action":"edm-messkonzept.get","reason":"Action exists in source; index entry has no action","sources":["services/edm-messkonzept.service.js"]}
- {"capability":"energy_sharing_42c_cutover_readiness","action":"dashboard-api.energySharing42cCutoverReadinessStatus","reason":"Action exists in source; index entry has no action","sources":["services/dashboard-api/actions-part-03-of-8.js"]}
- {"capability":"energy_sharing_collective_approval","action":"dashboard-api.energySharingCollectiveApprovalStatus","reason":"Action exists in source; index entry has no action","sources":["services/dashboard-api/actions-part-02-of-8.js"]}
- {"capability":"energy_sharing_simulation_gate","action":"dashboard-api.energySharingSimulationGateStatus","reason":"Action exists in source; index entry has no action","sources":["services/dashboard-api/actions-part-02-of-8.js"]}
- {"capability":"energy_sidecar_route_registry","action":"dashboard-api.energySidecarRouteRegistryStatus","reason":"Action exists in source; index entry has no action","sources":["services/dashboard-api/actions-part-06-of-8.js"]}
- {"capability":"energy_tax_information_package","action":"dashboard-api.energyTaxInformationPackageStatus","reason":"Action exists in source; index entry has no action","sources":["services/dashboard-api/actions-part-03-of-8.js"]}
- {"capability":"energy_tax_information_package","action":"datasource-registry.get","reason":"Action exists in source; index entry has no action","sources":["services/datasource-registry.service.js"]}
- {"capability":"energy_tax_information_package","action":"datasource-registry.updateDictionary","reason":"Action exists in source; index entry has no action","sources":["services/datasource-registry.service.js"]}
- {"capability":"evidence_freshness_guard","action":"dashboard-api.evidenceFreshnessGuardStatus","reason":"Action exists in source; index entry has no action","sources":["services/dashboard-api/actions-part-08-of-8.js"]}
- {"capability":"evidence_freshness_guard","action":"dashboard-api.vnbDeltaSignalClassifierStatus","reason":"Action exists in source; index entry has no action","sources":["services/dashboard-api/actions-part-08-of-8.js"]}
- {"capability":"evidence_freshness_guard","action":"dashboard-api.crossChannelVnbSignalQueueStatus","reason":"Action exists in source; index entry has no action","sources":["services/dashboard-api/actions-part-07-of-8.js"]}
- {"capability":"evidence_freshness_guard","action":"dashboard-api.leadershipDeltaCockpitStatus","reason":"Action exists in source; index entry has no action","sources":["services/dashboard-api/actions-part-08-of-8.js"]}
- {"capability":"evidence_grounding_confidence_audit","action":"dashboard-api.evidenceGroundingConfidenceAudit","reason":"Action exists in source; index entry has no action","sources":["services/dashboard-api/actions-part-01-of-8.js"]}
- {"capability":"evu_api_migration_diagnostics","action":"dashboard-api.evuApiMigrationDiagnosticsStatus","reason":"Action exists in source; index entry has no action","sources":["services/dashboard-api/actions-part-03-of-8.js"]}
- {"capability":"file_ingest_monitor","action":"file-ingest-monitor.scan","reason":"Action exists in source; index entry has no action","sources":["services/file-ingest-monitor.service.js"]}
- {"capability":"file_ingest_monitor","action":"file-ingest-monitor.getStatus","reason":"Action exists in source; index entry has no action","sources":["services/file-ingest-monitor.service.js"]}
- {"capability":"file_ingest_monitor","action":"file-ingest-monitor.getFindings","reason":"Action exists in source; index entry has no action","sources":["services/file-ingest-monitor.service.js"]}
- {"capability":"file_ingest_monitor","action":"file-ingest-monitor.createMonitor","reason":"Action exists in source; index entry has no action","sources":["services/file-ingest-monitor.service.js"]}
- {"capability":"file_ingest_monitor","action":"file-ingest-monitor.listMonitors","reason":"Action exists in source; index entry has no action","sources":["services/file-ingest-monitor.service.js"]}
- {"capability":"flex_strategic_demand_intake","action":"dashboard-api.flexStrategicDemandIntakeStatus","reason":"Action exists in source; index entry has no action","sources":["services/dashboard-api/actions-part-04-of-8.js"]}
- {"capability":"fnav_fast_track_contract_gate","action":"dashboard-api.fnavFastTrackContractGateStatus","reason":"Action exists in source; index entry has no action","sources":["services/dashboard-api/actions-part-07-of-8.js"]}
- {"capability":"gas_capacity_booking_review_gate","action":"dashboard-api.gasCapacityBookingReviewGateStatus","reason":"Action exists in source; index entry has no action","sources":["services/dashboard-api/actions-part-07-of-8.js"]}
- {"capability":"gas_decommissioning_roadmap_status","action":"dashboard-api.gasDecommissioningRoadmapStatus","reason":"Action exists in source; index entry has no action","sources":["services/dashboard-api/actions-part-03-of-8.js"]}
- {"capability":"gas_grid_transformation_asset_cockpit","action":"dashboard-api.gasGridTransformationAssetCockpitStatus","reason":"Action exists in source; index entry has no action","sources":["services/dashboard-api/actions-part-08-of-8.js"]}
- {"capability":"gas_grid_transformation_asset_cockpit","action":"datasource-registry.get","reason":"Action exists in source; index entry has no action","sources":["services/datasource-registry.service.js"]}
- {"capability":"gas_infrastructure_risk_governance","action":"dashboard-api.gasInfrastructureRiskGovernanceStatus","reason":"Action exists in source; index entry has no action","sources":["services/dashboard-api/actions-part-04-of-8.js"]}
- {"capability":"gas_network_decision_chain","action":"dashboard-api.gasNetworkDecisionChainStatus","reason":"Action exists in source; index entry has no action","sources":["services/dashboard-api/actions-part-07-of-8.js"]}
- {"capability":"gas_transformation_dataroom_status","action":"dashboard-api.gasTransformationDataroomStatus","reason":"Action exists in source; index entry has no action","sources":["services/dashboard-api/actions-part-04-of-8.js"]}
- {"capability":"gas_transformation_dataroom_status","action":"dashboard-api.gasDecommissioningRoadmapStatus","reason":"Action exists in source; index entry has no action","sources":["services/dashboard-api/actions-part-03-of-8.js"]}
- {"capability":"gas_transformation_dataroom_status","action":"dashboard-api.gasNetworkDecisionChainStatus","reason":"Action exists in source; index entry has no action","sources":["services/dashboard-api/actions-part-07-of-8.js"]}
- {"capability":"gas_transformation_dataroom_status","action":"object-store.query","reason":"Action exists in source; index entry has no action","sources":["services/object-store.service.js"]}
- {"capability":"gas_transformation_dependency_map","action":"dashboard-api.gasTransformationDependencyMapStatus","reason":"Action exists in source; index entry has no action","sources":["services/dashboard-api/actions-part-04-of-8.js"]}
- {"capability":"gremiencoach_workbook_readiness","action":"dashboard-api.gremiencoachWorkbookReadinessStatus","reason":"Action exists in source; index entry has no action","sources":["services/dashboard-api/actions-part-01-of-8.js"]}
- {"capability":"grid_connection_transformation_gate","action":"dashboard-api.gridConnectionTransformationGateStatus","reason":"Action exists in source; index entry has no action","sources":["services/dashboard-api/actions-part-05-of-8.js"]}
- {"capability":"grid_connection_transformation_gate","action":"grid-operations.netzfahrplanGenerate","reason":"Action exists in source; index entry has no action","sources":["services/grid-operations.service.js"]}
- {"capability":"grossspeicher_anschluss_readiness_gate","action":"dashboard-api.grossspeicherAnschlussReadinessGateStatus","reason":"Action exists in source; index entry has no action","sources":["services/dashboard-api/actions-part-05-of-8.js"]}
- {"capability":"grossspeicher_anschluss_readiness_gate","action":"grid-operations.netzfahrplanGenerate","reason":"Action exists in source; index entry has no action","sources":["services/grid-operations.service.js"]}
- {"capability":"grossspeicher_anschluss_readiness_gate","action":"forecast-engine.storageDispatch","reason":"Action exists in source; index entry has no action","sources":["services/forecast-engine.service.js"]}
- {"capability":"grossspeicher_anschluss_readiness_gate","action":"forecast-engine.createSchedule","reason":"Action exists in source; index entry has no action","sources":["services/forecast-engine.service.js"]}
- {"capability":"heat_asset_tariff_steering","action":"dashboard-api.heatAssetTariffSteeringStatus","reason":"Action exists in source; index entry has no action","sources":["services/dashboard-api/actions-part-05-of-8.js"]}
- {"capability":"heat_transformation_line_asset_model","action":"dashboard-api.heatTransformationLineAssetModelStatus","reason":"Action exists in source; index entry has no action","sources":["services/dashboard-api/actions-part-04-of-8.js"]}
- {"capability":"imsys_schedule_value_chain_readiness","action":"dashboard-api.imsysScheduleValueChainReadinessStatus","reason":"Action exists in source; index entry has no action","sources":["services/dashboard-api/actions-part-03-of-8.js"]}
- {"capability":"imsys_schedule_value_chain_readiness","action":"datasource-registry.get","reason":"Action exists in source; index entry has no action","sources":["services/datasource-registry.service.js"]}
- {"capability":"imsys_schedule_value_chain_readiness","action":"grid-operations.netzfahrplanGenerate","reason":"Action exists in source; index entry has no action","sources":["services/grid-operations.service.js"]}
- {"capability":"imsys_schedule_value_chain_readiness","action":"redispatch-expost.audit","reason":"Action exists in source; index entry has no action","sources":["services/redispatch-expost.service.js"]}
- {"capability":"imsys_taf2_compliance_status","action":"dashboard-api.imsysTaf2ComplianceStatus","reason":"Action exists in source; index entry has no action","sources":["services/dashboard-api/actions-part-04-of-8.js"]}
- {"capability":"imsys_taf2_compliance_status","action":"edm-validation.validate","reason":"Action exists in source; index entry has no action","sources":["services/edm-validation.service.js"]}
- {"capability":"interconnection_release_file","action":"dashboard-api.interconnectionReleaseFileStatus","reason":"Action exists in source; index entry has no action","sources":["services/dashboard-api/actions-part-06-of-8.js"]}
- {"capability":"investment_budget_cap_exception_governance","action":"dashboard-api.investmentBudgetCapExceptionGovernanceStatus","reason":"Action exists in source; index entry has no action","sources":["services/dashboard-api/actions-part-07-of-8.js"]}
- {"capability":"investment_committee_steering_cards","action":"dashboard-api.investmentCommitteeSteeringCardsStatus","reason":"Action exists in source; index entry has no action","sources":["services/dashboard-api/actions-part-04-of-8.js"]}
- {"capability":"investment_data_review_queue","action":"dashboard-api.investmentDataReviewQueueStatus","reason":"Action exists in source; index entry has no action","sources":["services/dashboard-api/actions-part-04-of-8.js"]}
- {"capability":"investment_data_review_queue","action":"datasource-registry.list","reason":"Action exists in source; index entry has no action","sources":["services/datasource-registry.service.js"]}
- {"capability":"investment_owner_deadline_budget_gate","action":"dashboard-api.investmentOwnerDeadlineBudgetGateStatus","reason":"Action exists in source; index entry has no action","sources":["services/dashboard-api/actions-part-07-of-8.js"]}
- {"capability":"investment_risk_translation_status","action":"dashboard-api.investmentRiskTranslationStatus","reason":"Action exists in source; index entry has no action","sources":["services/dashboard-api/actions-part-03-of-8.js"]}
- {"capability":"investment_two_track_control","action":"dashboard-api.investmentTwoTrackControlStatus","reason":"Action exists in source; index entry has no action","sources":["services/dashboard-api/actions-part-03-of-8.js"]}
- {"capability":"investment_two_track_control","action":"datasource-registry.get","reason":"Action exists in source; index entry has no action","sources":["services/datasource-registry.service.js"]}
- {"capability":"investment_waterfall_governance","action":"dashboard-api.investmentWaterfallGovernanceStatus","reason":"Action exists in source; index entry has no action","sources":["services/dashboard-api/actions-part-04-of-8.js"]}
- {"capability":"jour_fixe_decision_closure_tracker","action":"dashboard-api.jourFixeDecisionClosureStatus","reason":"Action exists in source; index entry has no action","sources":["services/dashboard-api/actions-part-03-of-8.js"]}
- {"capability":"ki_floorwalker_governance","action":"dashboard-api.kiFloorwalkerGovernanceStatus","reason":"Action exists in source; index entry has no action","sources":["services/dashboard-api/actions-part-04-of-8.js"]}
- {"capability":"layer0_audit_drilldown_note","action":"dashboard-api.layer0AuditDrilldownNoteStatus","reason":"Action exists in source; index entry has no action","sources":["services/dashboard-api/actions-part-02-of-8.js"]}
- {"capability":"leadership_delta_cockpit","action":"dashboard-api.leadershipDeltaCockpitStatus","reason":"Action exists in source; index entry has no action","sources":["services/dashboard-api/actions-part-08-of-8.js"]}
- {"capability":"leadership_delta_cockpit","action":"dashboard-api.vnbOverview","reason":"Action exists in source; index entry has no action","sources":["services/dashboard-api/actions-part-01-of-8.js"]}
- {"capability":"legacy_control_technology_transition","action":"dashboard-api.legacyControlTechnologyTransitionStatus","reason":"Action exists in source; index entry has no action","sources":["services/dashboard-api/actions-part-04-of-8.js"]}
- {"capability":"legacy_control_technology_transition","action":"edm-messkonzept.evaluate","reason":"Action exists in source; index entry has no action","sources":["services/edm-messkonzept.service.js"]}
- {"capability":"legal_clarification_operating_model","action":"dashboard-api.legalClarificationOperatingModelStatus","reason":"Action exists in source; index entry has no action","sources":["services/dashboard-api/actions-part-02-of-8.js"]}
- {"capability":"legal_clarification_operating_model","action":"grid-operations.netzfahrplanGenerate","reason":"Action exists in source; index entry has no action","sources":["services/grid-operations.service.js"]}
- {"capability":"liquidity_planning_governance_module","action":"dashboard-api.liquidityPlanningGovernanceStatus","reason":"Action exists in source; index entry has no action","sources":["services/dashboard-api/actions-part-02-of-8.js"]}
- {"capability":"liquidity_planning_governance_module","action":"datasource-registry.get","reason":"Action exists in source; index entry has no action","sources":["services/datasource-registry.service.js"]}
- {"capability":"live_update_stream_contract_status","action":"dashboard-api.liveUpdateStreamContractStatus","reason":"Action exists in source; index entry has no action","sources":["services/dashboard-api/actions-part-08-of-8.js"]}
- {"capability":"live_update_stream_contract_status","action":"dashboard-api.loadProfileStreamMonitor","reason":"Action exists in source; index entry has no action","sources":["services/dashboard-api/actions-part-01-of-8.js"]}
- {"capability":"live_update_stream_contract_status","action":"dashboard-api.vnbOverview","reason":"Action exists in source; index entry has no action","sources":["services/dashboard-api/actions-part-01-of-8.js"]}
- {"capability":"load_profile_stream_monitor","action":"dashboard-api.loadProfileStreamMonitor","reason":"Action exists in source; index entry has no action","sources":["services/dashboard-api/actions-part-01-of-8.js"]}
- {"capability":"market_communication_evidence_chain","action":"dashboard-api.marketCommunicationEvidenceChainStatus","reason":"Action exists in source; index entry has no action","sources":["services/dashboard-api/actions-part-01-of-8.js"]}
- {"capability":"market_communication_evidence_chain","action":"edm-validation.validate","reason":"Action exists in source; index entry has no action","sources":["services/edm-validation.service.js"]}
- {"capability":"mastr_sync_gap_alerting","action":"dashboard-api.mastrSyncGapStatus","reason":"Action exists in source; index entry has no action","sources":["services/dashboard-api/actions-part-02-of-8.js"]}
- {"capability":"metering_rollout_process_indicator","action":"dashboard-api.meteringRolloutProcessIndicatorStatus","reason":"Action exists in source; index entry has no action","sources":["services/dashboard-api/actions-part-04-of-8.js"]}
- {"capability":"metering_rollout_process_indicator","action":"datasource-registry.list","reason":"Action exists in source; index entry has no action","sources":["services/datasource-registry.service.js"]}
- {"capability":"model_viability_evidence_gate","action":"dashboard-api.modelViabilityEvidenceGateStatus","reason":"Action exists in source; index entry has no action","sources":["services/dashboard-api/actions-part-08-of-8.js"]}
- {"capability":"netzfahrplan_fnav_assessment","action":"grid-operations.netzfahrplanGenerate","reason":"Action exists in source; index entry has no action","sources":["services/grid-operations.service.js"]}
- {"capability":"netzprozess_readiness_gate","action":"dashboard-api.netzprozessReadinessGateStatus","reason":"Action exists in source; index entry has no action","sources":["services/dashboard-api/actions-part-05-of-8.js"]}
- {"capability":"netzprozess_readiness_gate","action":"copilot-process.listProcessIntents","reason":"Action exists in source; index entry has no action","sources":["services/copilot-process.service.js"]}
- {"capability":"netzsignal_delta_gating","action":"dashboard-api.netzsignalDeltaGatingStatus","reason":"Action exists in source; index entry has no action","sources":["services/dashboard-api/actions-part-08-of-8.js"]}
- {"capability":"no_regret_measure_definition_gate","action":"dashboard-api.noRegretMeasureDefinitionGateStatus","reason":"Action exists in source; index entry has no action","sources":["services/dashboard-api/actions-part-07-of-8.js"]}
- {"capability":"no_regret_measure_definition_gate","action":"datasource-registry.get","reason":"Action exists in source; index entry has no action","sources":["services/datasource-registry.service.js"]}
- {"capability":"no_regret_measure_proof_gate","action":"dashboard-api.noRegretMeasureProofGateStatus","reason":"Action exists in source; index entry has no action","sources":["services/dashboard-api/actions-part-02-of-8.js"]}
- {"capability":"no_regret_measure_proof_gate","action":"dashboard-api.steeringArtifactAcceptanceGateStatus","reason":"Action exists in source; index entry has no action","sources":["services/dashboard-api/actions-part-02-of-8.js"]}
- {"capability":"no_regret_measure_proof_gate","action":"dashboard-api.investmentOwnerDeadlineBudgetGateStatus","reason":"Action exists in source; index entry has no action","sources":["services/dashboard-api/actions-part-07-of-8.js"]}
- {"capability":"non_escalation_control_evidence","action":"dashboard-api.monitoringNonEscalationStatus","reason":"Action exists in source; index entry has no action","sources":["services/dashboard-api/actions-part-08-of-8.js"]}
- {"capability":"non_escalation_control_evidence","action":"dashboard-api.vnbSpecialTopicWorkstateStatus","reason":"Action exists in source; index entry has no action","sources":["services/dashboard-api/actions-part-08-of-8.js"]}
- {"capability":"non_escalation_control_evidence","action":"dashboard-api.crossDomainSpecialTopicsQueueStatus","reason":"Action exists in source; index entry has no action","sources":["services/dashboard-api/actions-part-07-of-8.js"]}
- {"capability":"nova_decision_lifecycle_readiness","action":"dashboard-api.novaDecisionLifecycleReadinessStatus","reason":"Action exists in source; index entry has no action","sources":["services/dashboard-api/actions-part-03-of-8.js"]}
- {"capability":"off_balancing_metering_pruefmatrix","action":"dashboard-api.offBalancingMeteringPruefmatrixStatus","reason":"Action exists in source; index entry has no action","sources":["services/dashboard-api/actions-part-03-of-8.js"]}
- {"capability":"off_balancing_metering_pruefmatrix","action":"datasource-registry.get","reason":"Action exists in source; index entry has no action","sources":["services/datasource-registry.service.js"]}
- {"capability":"owner_deadline_evidence_gate","action":"dashboard-api.ownerDeadlineEvidenceGateStatus","reason":"Action exists in source; index entry has no action","sources":["services/dashboard-api/actions-part-05-of-8.js"]}
- {"capability":"owner_deadline_evidence_gate","action":"copilot-process.listProcessIntents","reason":"Action exists in source; index entry has no action","sources":["services/copilot-process.service.js"]}
- {"capability":"owner_deadline_evidence_gate","action":"dashboard-api.rolePermissionAccessReadinessGateStatus","reason":"Action exists in source; index entry has no action","sources":["services/dashboard-api/actions-part-05-of-8.js"]}
- {"capability":"process_sensitization_readiness_map","action":"dashboard-api.processSensitizationReadinessMapStatus","reason":"Action exists in source; index entry has no action","sources":["services/dashboard-api/actions-part-05-of-8.js"]}
- {"capability":"process_sensitization_readiness_map","action":"dashboard-api.qualitySummary","reason":"Action exists in source; index entry has no action","sources":["services/dashboard-api/actions-part-08-of-8.js"]}
- {"capability":"process_sensitization_readiness_map","action":"redispatch-expost.audit","reason":"Action exists in source; index entry has no action","sources":["services/redispatch-expost.service.js"]}
- {"capability":"process_sensitization_readiness_map","action":"edm-validation.validate","reason":"Action exists in source; index entry has no action","sources":["services/edm-validation.service.js"]}
- {"capability":"receipt_grounded_presentation_contract","action":"dashboard-api.receiptGroundedPresentationContract","reason":"Action exists in source; index entry has no action","sources":["services/dashboard-api/actions-part-01-of-8.js"]}
- {"capability":"redispatch_call_data_quality_gate","action":"dashboard-api.redispatchCallQualityGate","reason":"Action exists in source; index entry has no action","sources":["services/dashboard-api/actions-part-01-of-8.js"]}
- {"capability":"redispatch_call_data_quality_gate","action":"redispatch-expost.list","reason":"Action exists in source; index entry has no action","sources":["services/redispatch-expost.service.js"]}
- {"capability":"redispatch_call_data_quality_gate","action":"dashboard-api.loadProfileStreamMonitor","reason":"Action exists in source; index entry has no action","sources":["services/dashboard-api/actions-part-01-of-8.js"]}
- {"capability":"redispatch_call_data_quality_gate","action":"edm-validation.validate","reason":"Action exists in source; index entry has no action","sources":["services/edm-validation.service.js"]}
- {"capability":"redispatch_call_data_quality_gate","action":"forecast-engine.evaluateQuality","reason":"Action exists in source; index entry has no action","sources":["services/forecast-engine.service.js"]}
- {"capability":"redispatch_project_controlling_kpi_cockpit","action":"dashboard-api.redispatchProjectControllingKpiCockpitStatus","reason":"Action exists in source; index entry has no action","sources":["services/dashboard-api/actions-part-05-of-8.js"]}
- {"capability":"redispatch_project_controlling_kpi_cockpit","action":"redispatch-expost.audit","reason":"Action exists in source; index entry has no action","sources":["services/redispatch-expost.service.js"]}
- {"capability":"redispatch_project_controlling_kpi_cockpit","action":"redispatch-expost.list","reason":"Action exists in source; index entry has no action","sources":["services/redispatch-expost.service.js"]}
- {"capability":"redispatch_project_controlling_kpi_cockpit","action":"datasource-registry.get","reason":"Action exists in source; index entry has no action","sources":["services/datasource-registry.service.js"]}
- {"capability":"regulatory_change_simulator_readiness","action":"dashboard-api.regulatoryChangeReadinessStatus","reason":"Action exists in source; index entry has no action","sources":["services/dashboard-api/actions-part-03-of-8.js"]}
- {"capability":"regulatory_change_simulator_readiness","action":"datasource-registry.get","reason":"Action exists in source; index entry has no action","sources":["services/datasource-registry.service.js"]}
- {"capability":"regulatory_change_simulator_readiness","action":"edm-validation.validate","reason":"Action exists in source; index entry has no action","sources":["services/edm-validation.service.js"]}
- {"capability":"regulatory_change_simulator_readiness","action":"mscons-import.import","reason":"Action exists in source; index entry has no action","sources":["services/mscons-import.service.js"]}
- {"capability":"regulatory_signal_process_translator","action":"dashboard-api.regulatorySignalProcessTranslatorStatus","reason":"Action exists in source; index entry has no action","sources":["services/dashboard-api/actions-part-01-of-8.js"]}
- {"capability":"role_permission_access_readiness_gate","action":"dashboard-api.rolePermissionAccessReadinessGateStatus","reason":"Action exists in source; index entry has no action","sources":["services/dashboard-api/actions-part-05-of-8.js"]}
- {"capability":"role_permission_access_readiness_gate","action":"dashboard-api.netzprozessReadinessGateStatus","reason":"Action exists in source; index entry has no action","sources":["services/dashboard-api/actions-part-05-of-8.js"]}
- {"capability":"sap_budget_psp_gate","action":"dashboard-api.sapBudgetPspGateStatus","reason":"Action exists in source; index entry has no action","sources":["services/dashboard-api/actions-part-03-of-8.js"]}
- {"capability":"sap_budget_psp_gate","action":"datasource-registry.get","reason":"Action exists in source; index entry has no action","sources":["services/datasource-registry.service.js"]}
- {"capability":"schedule_management_governance_roadmap","action":"dashboard-api.scheduleManagementGovernanceRoadmapStatus","reason":"Action exists in source; index entry has no action","sources":["services/dashboard-api/actions-part-04-of-8.js"]}
- {"capability":"schedule_management_governance_roadmap","action":"grid-operations.netzfahrplanGenerate","reason":"Action exists in source; index entry has no action","sources":["services/grid-operations.service.js"]}
- {"capability":"schedule_management_governance_roadmap","action":"redispatch-expost.audit","reason":"Action exists in source; index entry has no action","sources":["services/redispatch-expost.service.js"]}
- {"capability":"schedule_management_governance_roadmap","action":"edm-validation.validate","reason":"Action exists in source; index entry has no action","sources":["services/edm-validation.service.js"]}
- {"capability":"smart_meter_cls_data_governance_receipt","action":"dashboard-api.marketCommunicationEvidenceChainStatus","reason":"Action exists in source; index entry has no action","sources":["services/dashboard-api/actions-part-01-of-8.js"]}
- {"capability":"smart_meter_cls_data_governance_receipt","action":"dashboard-api.regulatorySignalProcessTranslatorStatus","reason":"Action exists in source; index entry has no action","sources":["services/dashboard-api/actions-part-01-of-8.js"]}
- {"capability":"smart_meter_cls_data_governance_receipt","action":"dashboard-api.regulatoryChangeReadinessStatus","reason":"Action exists in source; index entry has no action","sources":["services/dashboard-api/actions-part-03-of-8.js"]}
- {"capability":"smart_meter_cls_data_governance_receipt","action":"dashboard-api.smartMeterOffBalancingPurposeLockStatus","reason":"Action exists in source; index entry has no action","sources":["services/dashboard-api/actions-part-03-of-8.js"]}
- {"capability":"smart_meter_off_balancing_purpose_lock","action":"dashboard-api.smartMeterOffBalancingPurposeLockStatus","reason":"Action exists in source; index entry has no action","sources":["services/dashboard-api/actions-part-03-of-8.js"]}
- {"capability":"smart_meter_off_balancing_purpose_lock","action":"datasource-registry.get","reason":"Action exists in source; index entry has no action","sources":["services/datasource-registry.service.js"]}
- {"capability":"smgw_connector_readiness_status","action":"dashboard-api.smgwConnectorReadinessStatus","reason":"Action exists in source; index entry has no action","sources":["services/dashboard-api/actions-part-08-of-8.js"]}
- {"capability":"special_grid_usage_impact_map","action":"dashboard-api.specialGridUsageImpactMapStatus","reason":"Action exists in source; index entry has no action","sources":["services/dashboard-api/actions-part-02-of-8.js"]}
- {"capability":"special_grid_usage_impact_map","action":"datasource-registry.get","reason":"Action exists in source; index entry has no action","sources":["services/datasource-registry.service.js"]}
- {"capability":"stadtwerk_mauer_capability_projection","action":"dashboard-api.stadtwerkMauerCapabilityProjectionStatus","reason":"Action exists in source; index entry has no action","sources":["services/dashboard-api/actions-part-05-of-8.js"]}
- {"capability":"stadtwerk_mauer_capability_projection","action":"dashboard-api.stadtwerkMauerVdmiProfileStatus","reason":"Action exists in source; index entry has no action","sources":["services/dashboard-api/actions-part-05-of-8.js"]}
- {"capability":"stadtwerk_mauer_e2e_process_demo","action":"dashboard-api.stadtwerkMauerE2eProcessDemoStatus","reason":"Action exists in source; index entry has no action","sources":["services/dashboard-api/actions-part-06-of-8.js"]}
- {"capability":"stadtwerk_mauer_event_replay_preview","action":"dashboard-api.stadtwerkMauerEventReplayPreviewStatus","reason":"Action exists in source; index entry has no action","sources":["services/dashboard-api/actions-part-05-of-8.js"]}
- {"capability":"stadtwerk_mauer_event_replay_preview","action":"dashboard-api.stadtwerkMauerCapabilityProjectionStatus","reason":"Action exists in source; index entry has no action","sources":["services/dashboard-api/actions-part-05-of-8.js"]}
- {"capability":"stadtwerk_mauer_event_replay_preview","action":"dashboard-api.stadtwerkMauerVdmiProfileStatus","reason":"Action exists in source; index entry has no action","sources":["services/dashboard-api/actions-part-05-of-8.js"]}
- {"capability":"stadtwerk_mauer_external_interface_stubs","action":"dashboard-api.stadtwerkMauerExternalInterfaceStubsStatus","reason":"Action exists in source; index entry has no action","sources":["services/dashboard-api/actions-part-05-of-8.js"]}
- {"capability":"stadtwerk_mauer_mastr_data_overlay","action":"dashboard-api.stadtwerkMauerMastrDataOverlayStatus","reason":"Action exists in source; index entry has no action","sources":["services/dashboard-api/actions-part-06-of-8.js"]}
- {"capability":"stadtwerk_mauer_sandbox_runtime","action":"dashboard-api.stadtwerkMauerSandboxRuntimeStatus","reason":"Action exists in source; index entry has no action","sources":["services/dashboard-api/actions-part-05-of-8.js"]}
- {"capability":"stadtwerk_mauer_sandbox_runtime","action":"object-store.query","reason":"Action exists in source; index entry has no action","sources":["services/object-store.service.js"]}
- {"capability":"stadtwerk_mauer_vdmi_profile","action":"dashboard-api.stadtwerkMauerVdmiProfileStatus","reason":"Action exists in source; index entry has no action","sources":["services/dashboard-api/actions-part-05-of-8.js"]}
- {"capability":"steering_artifact_acceptance_gate","action":"dashboard-api.steeringArtifactAcceptanceGateStatus","reason":"Action exists in source; index entry has no action","sources":["services/dashboard-api/actions-part-02-of-8.js"]}
- {"capability":"steering_artifact_acceptance_gate","action":"dashboard-api.ownerDeadlineEvidenceGateStatus","reason":"Action exists in source; index entry has no action","sources":["services/dashboard-api/actions-part-05-of-8.js"]}
- {"capability":"steering_artifact_acceptance_gate","action":"dashboard-api.rolePermissionAccessReadinessGateStatus","reason":"Action exists in source; index entry has no action","sources":["services/dashboard-api/actions-part-05-of-8.js"]}
- {"capability":"tech_commercial_offer_cockpit","action":"dashboard-api.techCommercialOfferCockpitStatus","reason":"Action exists in source; index entry has no action","sources":["services/dashboard-api/actions-part-05-of-8.js"]}
- {"capability":"tech_commercial_offer_cockpit","action":"grid-operations.netzfahrplanGenerate","reason":"Action exists in source; index entry has no action","sources":["services/grid-operations.service.js"]}
- {"capability":"tech_commercial_offer_cockpit","action":"edm-validation.validate","reason":"Action exists in source; index entry has no action","sources":["services/edm-validation.service.js"]}
- {"capability":"transformation_financing_scenario_view","action":"dashboard-api.transformationFinancingScenarioViewStatus","reason":"Action exists in source; index entry has no action","sources":["services/dashboard-api/actions-part-07-of-8.js"]}
- {"capability":"transformation_financing_scenario_view","action":"datasource-registry.get","reason":"Action exists in source; index entry has no action","sources":["services/datasource-registry.service.js"]}
- {"capability":"vnb_delta_signal_classifier","action":"dashboard-api.vnbDeltaSignalClassifierStatus","reason":"Action exists in source; index entry has no action","sources":["services/dashboard-api/actions-part-08-of-8.js"]}
- {"capability":"vnb_delta_signal_classifier","action":"dashboard-api.leadershipDeltaCockpitStatus","reason":"Action exists in source; index entry has no action","sources":["services/dashboard-api/actions-part-08-of-8.js"]}
- {"capability":"vnb_special_topic_workstate","action":"dashboard-api.vnbSpecialTopicWorkstateStatus","reason":"Action exists in source; index entry has no action","sources":["services/dashboard-api/actions-part-08-of-8.js"]}
- {"capability":"vnb_special_topic_workstate","action":"dashboard-api.evidenceFreshnessGuardStatus","reason":"Action exists in source; index entry has no action","sources":["services/dashboard-api/actions-part-08-of-8.js"]}
- {"capability":"vnb_special_topic_workstate","action":"dashboard-api.crossDomainSpecialTopicsQueueStatus","reason":"Action exists in source; index entry has no action","sources":["services/dashboard-api/actions-part-07-of-8.js"]}
- {"capability":"vnb_special_topic_workstate","action":"dashboard-api.leadershipDeltaCockpitStatus","reason":"Action exists in source; index entry has no action","sources":["services/dashboard-api/actions-part-08-of-8.js"]}
- {"capability":"water_pricing_net_investment_alignment_gate","action":"dashboard-api.waterPricingNetInvestmentAlignmentStatus","reason":"Action exists in source; index entry has no action","sources":["services/dashboard-api/actions-part-07-of-8.js"]}
- {"capability":"zaehlpark_finanzierung_szenario_cockpit","action":"dashboard-api.zaehlparkFinanzierungSzenarioCockpitStatus","reason":"Action exists in source; index entry has no action","sources":["services/dashboard-api/actions-part-05-of-8.js"]}
- {"capability":"zaehlpark_finanzierung_szenario_cockpit","action":"edm-validation.validate","reason":"Action exists in source; index entry has no action","sources":["services/edm-validation.service.js"]}

## actionsNotInSource (107)

- {"capability":"anschlusskapazitaet_evidence_queue","action":"grid-connection.capacityCheck","reason":"Action does not exist in source"}
- {"capability":"areal_network_integration_offer_gate","action":"target-grid-planning.review","reason":"Action does not exist in source"}
- {"capability":"areal_network_integration_offer_gate","action":"investment-planning.review","reason":"Action does not exist in source"}
- {"capability":"areal_network_integration_offer_gate","action":"regulatorische-entgeltlogik.evaluate","reason":"Action does not exist in source"}
- {"capability":"areal_network_integration_offer_gate","action":"offer-management.review","reason":"Action does not exist in source"}
- {"capability":"automation_requirements_decision_value","action":"business-intelligence.describe","reason":"Action does not exist in source"}
- {"capability":"automation_requirements_decision_value","action":"presentation.generate","reason":"Action does not exist in source"}
- {"capability":"automation_risk_gate","action":"presentation.generate","reason":"Action does not exist in source"}
- {"capability":"blindflug_radar_anomaly_detection","action":"v1.blindflug-radar.scan","reason":"Action does not exist in source"}
- {"capability":"budget_waterfall_governance","action":"presentation.generate","reason":"Action does not exist in source"}
- {"capability":"cls_digital_twin_compliance_gate","action":"presentation.generate","reason":"Action does not exist in source"}
- {"capability":"communication_break_process_risk","action":"evidence-registry.findings","reason":"Action does not exist in source"}
- {"capability":"connection_deadline_evidence_queue","action":"evidence-registry.lookup","reason":"Action does not exist in source"}
- {"capability":"controllability_submission_cockpit","action":"presentation.generate","reason":"Action does not exist in source"}
- {"capability":"crisis_decision_routine","action":"presentation.generate","reason":"Action does not exist in source"}
- {"capability":"cross_domain_special_topics_queue","action":"evidence-registry.lookup","reason":"Action does not exist in source"}
- {"capability":"cross_domain_special_topics_queue","action":"presentation.generate","reason":"Action does not exist in source"}
- {"capability":"cross_system_variance_matrix","action":"evidence-registry.findings","reason":"Action does not exist in source"}
- {"capability":"cross_system_variance_matrix","action":"variance-register.suppliedFacts","reason":"Action does not exist in source"}
- {"capability":"decision_readiness_matrix","action":"evidence-registry.findings","reason":"Action does not exist in source"}
- {"capability":"direct_marketer_risk_gate","action":"evidence-registry.lookup","reason":"Action does not exist in source"}
- {"capability":"direct_marketer_risk_gate","action":"market-communication.evidence","reason":"Action does not exist in source"}
- {"capability":"direct_marketer_risk_gate","action":"settlement.readiness","reason":"Action does not exist in source"}
- {"capability":"direct_marketer_risk_gate","action":"presentation.generate","reason":"Action does not exist in source"}
- {"capability":"energy_sharing_42c_cutover_readiness","action":"presentation.generate","reason":"Action does not exist in source"}
- {"capability":"energy_sharing_simulation_gate","action":"presentation.generate","reason":"Action does not exist in source"}
- {"capability":"energy_tax_information_package","action":"presentation.generate","reason":"Action does not exist in source"}
- {"capability":"evidence_freshness_guard","action":"evidence-planner.plan","reason":"Action does not exist in source"}
- {"capability":"evu_api_migration_diagnostics","action":"presentation.generate","reason":"Action does not exist in source"}
- {"capability":"flex_strategic_demand_intake","action":"flex.status","reason":"Action does not exist in source"}
- {"capability":"flex_strategic_demand_intake","action":"znp.projects","reason":"Action does not exist in source"}
- {"capability":"flex_strategic_demand_intake","action":"presentation.generate","reason":"Action does not exist in source"}
- {"capability":"gas_decommissioning_roadmap_status","action":"vdmi-evidence.inject","reason":"Action does not exist in source"}
- {"capability":"gas_decommissioning_roadmap_status","action":"presentation.generate","reason":"Action does not exist in source"}
- {"capability":"gas_grid_transformation_asset_cockpit","action":"presentation.generate","reason":"Action does not exist in source"}
- {"capability":"gas_infrastructure_risk_governance","action":"grid-operations.summary","reason":"Action does not exist in source"}
- {"capability":"gas_infrastructure_risk_governance","action":"presentation.generate","reason":"Action does not exist in source"}
- {"capability":"gas_network_decision_chain","action":"eog-calculator.evaluate","reason":"Action does not exist in source"}
- {"capability":"gas_transformation_dataroom_status","action":"eog-calculator.evaluate","reason":"Action does not exist in source"}
- {"capability":"gas_transformation_dataroom_status","action":"knowledge-rag.search","reason":"Action does not exist in source"}
- {"capability":"grossspeicher_anschluss_readiness_gate","action":"presentation.generate","reason":"Action does not exist in source"}
- {"capability":"heat_transformation_line_asset_model","action":"presentation.generate","reason":"Action does not exist in source"}
- {"capability":"imsys_schedule_value_chain_readiness","action":"forecast-engine.run","reason":"Action does not exist in source"}
- {"capability":"imsys_schedule_value_chain_readiness","action":"presentation.generate","reason":"Action does not exist in source"}
- {"capability":"investment_budget_cap_exception_governance","action":"investment-planning.review","reason":"Action does not exist in source"}
- {"capability":"investment_budget_cap_exception_governance","action":"evidence-registry.lookup","reason":"Action does not exist in source"}
- {"capability":"investment_budget_cap_exception_governance","action":"presentation.generate","reason":"Action does not exist in source"}
- {"capability":"investment_committee_steering_cards","action":"presentation.generate","reason":"Action does not exist in source"}
- {"capability":"investment_data_review_queue","action":"presentation.generate","reason":"Action does not exist in source"}
- {"capability":"investment_owner_deadline_budget_gate","action":"investment-planning.review","reason":"Action does not exist in source"}
- {"capability":"investment_owner_deadline_budget_gate","action":"evidence-registry.lookup","reason":"Action does not exist in source"}
- {"capability":"investment_owner_deadline_budget_gate","action":"presentation.generate","reason":"Action does not exist in source"}
- {"capability":"investment_risk_translation_status","action":"vdmi-findings.list","reason":"Action does not exist in source"}
- {"capability":"investment_risk_translation_status","action":"presentation.generate","reason":"Action does not exist in source"}
- {"capability":"investment_two_track_control","action":"presentation.generate","reason":"Action does not exist in source"}
- {"capability":"investment_waterfall_governance","action":"presentation.generate","reason":"Action does not exist in source"}
- {"capability":"jour_fixe_decision_closure_tracker","action":"nova.list","reason":"Action does not exist in source"}
- {"capability":"jour_fixe_decision_closure_tracker","action":"vdmi-evidence.inject","reason":"Action does not exist in source"}
- {"capability":"jour_fixe_decision_closure_tracker","action":"presentation.generate","reason":"Action does not exist in source"}
- {"capability":"ki_floorwalker_governance","action":"presentation.generate","reason":"Action does not exist in source"}
- {"capability":"layer0_audit_drilldown_note","action":"evidence-registry.lookup","reason":"Action does not exist in source"}
- {"capability":"leadership_delta_cockpit","action":"evidence-planner.plan","reason":"Action does not exist in source"}
- {"capability":"legacy_control_technology_transition","action":"presentation.generate","reason":"Action does not exist in source"}
- {"capability":"liquidity_planning_governance_module","action":"datasource-registry.check","reason":"Action does not exist in source"}
- {"capability":"liquidity_planning_governance_module","action":"presentation.generate","reason":"Action does not exist in source"}
- {"capability":"market_communication_evidence_chain","action":"settlement.readiness","reason":"Action does not exist in source"}
- {"capability":"metering_rollout_process_indicator","action":"presentation.generate","reason":"Action does not exist in source"}
- {"capability":"model_viability_evidence_gate","action":"presentation.generate","reason":"Action does not exist in source"}
- {"capability":"netzsignal_delta_gating","action":"evidence-planner.plan","reason":"Action does not exist in source"}
- {"capability":"no_regret_measure_definition_gate","action":"evidence-registry.lookup","reason":"Action does not exist in source"}
- {"capability":"no_regret_measure_definition_gate","action":"investment-planning.review","reason":"Action does not exist in source"}
- {"capability":"no_regret_measure_definition_gate","action":"presentation.generate","reason":"Action does not exist in source"}
- {"capability":"no_regret_measure_proof_gate","action":"evidence-registry.findings","reason":"Action does not exist in source"}
- {"capability":"non_escalation_control_evidence","action":"evidence-planner.plan","reason":"Action does not exist in source"}
- {"capability":"nova_decision_lifecycle_readiness","action":"presentation.generate","reason":"Action does not exist in source"}
- {"capability":"off_balancing_metering_pruefmatrix","action":"presentation.generate","reason":"Action does not exist in source"}
- {"capability":"owner_deadline_evidence_gate","action":"vdmi-evidence.findings","reason":"Action does not exist in source"}
- {"capability":"redispatch_participation_readiness","action":"redispatch-participation-readiness.getStatus","reason":"Action does not exist in source"}
- {"capability":"regulatory_change_simulator_readiness","action":"presentation.generate","reason":"Action does not exist in source"}
- {"capability":"regulatory_signal_process_translator","action":"evidence-registry.findings","reason":"Action does not exist in source"}
- {"capability":"regulatory_signal_process_translator","action":"regulatory-signal.suppliedFacts","reason":"Action does not exist in source"}
- {"capability":"role_permission_access_readiness_gate","action":"auth.groupRoleMap","reason":"Action does not exist in source"}
- {"capability":"role_permission_access_readiness_gate","action":"agent-persona.metadata","reason":"Action does not exist in source"}
- {"capability":"role_permission_access_readiness_gate","action":"vdmi-governance-templates.checklist","reason":"Action does not exist in source"}
- {"capability":"sap_budget_psp_gate","action":"presentation.generate","reason":"Action does not exist in source"}
- {"capability":"smart_meter_off_balancing_purpose_lock","action":"investment-planning.read","reason":"Action does not exist in source"}
- {"capability":"smart_meter_off_balancing_purpose_lock","action":"presentation.generate","reason":"Action does not exist in source"}
- {"capability":"smgw_connector_readiness_status","action":"dossier-hydration.registry","reason":"Action does not exist in source"}
- {"capability":"special_grid_usage_impact_map","action":"settlement.readiness","reason":"Action does not exist in source"}
- {"capability":"special_grid_usage_impact_map","action":"customer-service.get","reason":"Action does not exist in source"}
- {"capability":"special_grid_usage_impact_map","action":"presentation.generate","reason":"Action does not exist in source"}
- {"capability":"stadtwerk_mauer_capability_projection","action":"dossier-hydration.registry","reason":"Action does not exist in source"}
- {"capability":"stadtwerk_mauer_capability_projection","action":"presentation.generate","reason":"Action does not exist in source"}
- {"capability":"stadtwerk_mauer_event_replay_preview","action":"dossier-hydration.registry","reason":"Action does not exist in source"}
- {"capability":"stadtwerk_mauer_event_replay_preview","action":"presentation.generate","reason":"Action does not exist in source"}
- {"capability":"stadtwerk_mauer_vdmi_profile","action":"dossier-hydration.registry","reason":"Action does not exist in source"}
- {"capability":"stadtwerk_mauer_vdmi_profile","action":"presentation.generate","reason":"Action does not exist in source"}
- {"capability":"steering_artifact_acceptance_gate","action":"evidence-registry.findings","reason":"Action does not exist in source"}
- {"capability":"transformation_financing_scenario_view","action":"presentation.generate","reason":"Action does not exist in source"}
- {"capability":"vnb_delta_signal_classifier","action":"evidence-planner.plan","reason":"Action does not exist in source"}
- {"capability":"vnb_special_topic_workstate","action":"evidence-planner.plan","reason":"Action does not exist in source"}
- {"capability":"water_pricing_net_investment_alignment_gate","action":"investment-planning.review","reason":"Action does not exist in source"}
- {"capability":"water_pricing_net_investment_alignment_gate","action":"reporting-governance.evaluate","reason":"Action does not exist in source"}
- {"capability":"water_pricing_net_investment_alignment_gate","action":"regulatorische-entgeltlogik.evaluate","reason":"Action does not exist in source"}
- {"capability":"water_pricing_net_investment_alignment_gate","action":"vdmi-portfolio-gatekeeping.evaluate","reason":"Action does not exist in source"}
- {"capability":"znp_production_readiness_evidence_gate","action":"dossier-hydration.registry","reason":"Action does not exist in source"}
- {"capability":"znp_production_readiness_evidence_gate","action":"presentation.generate","reason":"Action does not exist in source"}

## actionsWithoutIndexEntry (5)

- {"capability":"energy_tax_information_package","action":"datasource-classifier.classify","reason":"Action exists in source; no matching index entry","sources":["services/datasource-classifier.service.js"]}
- {"capability":"evidence_grounding_confidence_audit","action":"capability-broker.recommend","reason":"Action exists in source; no matching index entry","sources":["services/capability-broker.service.js"]}
- {"capability":"stadtwerk_mauer_capability_projection","action":"capability-broker.recommend","reason":"Action exists in source; no matching index entry","sources":["services/capability-broker.service.js"]}
- {"capability":"stadtwerk_mauer_event_replay_preview","action":"capability-broker.recommend","reason":"Action exists in source; no matching index entry","sources":["services/capability-broker.service.js"]}
- {"capability":"stadtwerk_mauer_vdmi_profile","action":"capability-broker.recommend","reason":"Action exists in source; no matching index entry","sources":["services/capability-broker.service.js"]}

## actionReferenceMismatches (0)

None.

## Automatic hubs (13)

- dataSources:VDMI
- declaredActions:vdmi.dossier
- entityTypes:Task
- events:agent.plan.step.executed
- events:hitl.item.created
- events:hitl.item.resolved
- events:mail.attachment.extracted
- events:sharepoint.excel.updated
- events:vdmi.nomination.requested.v1
- events:webhooks.delivered
- keywordTokens:gate
- operations:vdmi.dossier
- resources:VDMI

## Parameters

```json
{
  "version": "2",
  "generatedAt": "1970-01-01T00:00:00.000Z",
  "minWeight": 0.2,
  "targetDensity": 0.15,
  "baselineDensity": 0.49,
  "mergeSimilarity": 0.6,
  "automaticHubFrequency": 0.25,
  "automaticHubMinimumFunctions": 10,
  "hubFeatures": {
    "services": [
      "dashboard-api",
      "interface-placeholder",
      "vdmi"
    ],
    "entityTypes": [
      "datapoint"
    ],
    "domains": [
      "platform"
    ]
  },
  "placeholderServices": [
    "interface-placeholder"
  ],
  "featureWeights": {
    "operations": 1,
    "services": 0.5,
    "dataSources": 1,
    "entityTypes": 0.9,
    "writesTo": 0.5,
    "domains": 0.3,
    "departments": 0.7,
    "declaredActions": 1,
    "keywords": 0.6,
    "inputs": 0.6,
    "keywordTokens": 0.55
  },
  "eventWeight": 1.4,
  "writeReadWeight": 1.3,
  "minimumSharedFeatures": 2,
  "maxEvidenceContribution": 0.18,
  "sharedWeight": 1,
  "maxDegreeFraction": 0.25,
  "groupingExcludedFeatures": [
    "domains",
    "departments"
  ],
  "groupingFeatureWeights": {
    "operations": 0.3,
    "services": 1,
    "dataSources": 3,
    "entityTypes": 2,
    "writesTo": 2,
    "domains": 0.1,
    "departments": 0.2,
    "declaredActions": 0.3,
    "keywords": 0.01,
    "inputs": 0.01,
    "keywordTokens": 0.01
  },
  "keywordTokenMinimumLength": 4,
  "degreeBudgetMinimumFunctions": 10
}
```

No overrides are applied. Dynamic event names and handler spreads are reported above, not guessed.
Event extraction follows local CommonJS imports, including split service modules, without executing services.
Functions without listeners cannot be woken directly by a known static event. Emission alone is not push capability.
