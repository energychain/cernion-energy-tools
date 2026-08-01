'use strict';

// dashboard-api methods chunk 6/14 — extracted verbatim from
// services/dashboard-api.service.js as part of the v0.99 file-size modularization.
// Contains: buildGasInfrastructureRiskGovernanceStatus, buildMeteringRolloutProcessIndicatorStatus, buildHeatTransformationLineAssetModelStatus, buildKiFloorwalkerGovernanceStatus, buildInvestmentWaterfallGovernanceStatus, buildCapacityContractRiskAssetCockpitStatus, buildImsysTaf2ComplianceStatus, buildScheduleManagementGovernanceRoadmapStatus, buildGasTransformationDependencyMapStatus, buildGasTransformationDataroomStatus, buildGridConnectionTransformationGateStatus, buildHeatAssetTariffSteeringStatus, buildProcessSensitizationReadinessMapStatus, buildNetzprozessReadinessGateStatus, buildGrossspeicherAnschlussReadinessGateStatus, buildRolePermissionAccessReadinessGateStatus

module.exports = {
  buildGasInfrastructureRiskGovernanceStatus(params = {}) {
    const toList = (value) =>
      Array.isArray(value)
        ? value.filter(Boolean)
        : value
          ? String(value)
              .split(',')
              .map((item) => item.trim())
              .filter(Boolean)
          : [];
    const sourceRefs = toList(params.sourceRef);
    const evidenceSpecs = [
      {
        id: 'technical_fact',
        label: 'Technical fact',
        value: params.technicalFact,
        sourceClass: 'technical_risk_fact',
        enablesDossierAddition: 'add the technical gas-infrastructure issue or finding',
      },
      {
        id: 'impact_area',
        label: 'Impact area',
        value: params.impactArea,
        sourceClass: 'asset_network_impact_scope',
        enablesDossierAddition:
          'add the affected asset, network coupling point or transformation area',
      },
      {
        id: 'probability',
        label: 'Probability',
        value: params.probability,
        sourceClass: 'risk_rating_basis',
        enablesDossierAddition: 'add the likelihood or probability basis',
      },
      {
        id: 'criticality',
        label: 'Criticality',
        value: params.criticality,
        sourceClass: 'risk_impact_rating',
        enablesDossierAddition: 'add the impact/criticality rating',
      },
      {
        id: 'existing_mitigation',
        label: 'Existing mitigation',
        value: params.existingMitigation,
        sourceClass: 'mitigation_or_monitoring_basis',
        enablesDossierAddition: 'add current safeguards, monitoring or mitigation evidence',
      },
      {
        id: 'threshold',
        label: 'Risk-register threshold',
        value: params.threshold,
        sourceClass: 'formal_risk_threshold',
        enablesDossierAddition: 'add the threshold for formal risk-register handling',
      },
      {
        id: 'risk_register_decision',
        label: 'Risk-register decision',
        value: params.riskRegisterDecision,
        sourceClass: 'governance_decision_path',
        enablesDossierAddition:
          'add whether the case is not aufgenommen, monitoring, Massnahme, or formal risk register',
      },
      {
        id: 'owner',
        label: 'Owner',
        value: params.owner,
        sourceClass: 'accountable_owner',
        enablesDossierAddition: 'add accountable governance owner',
      },
      {
        id: 'next_decision_window',
        label: 'Next decision window',
        value: params.nextDecisionWindow,
        sourceClass: 'decision_calendar',
        enablesDossierAddition: 'add the next decision window or committee gate',
      },
      {
        id: 'blocked_follow_up',
        label: 'Blocked follow-up',
        value: params.blockedFollowUp,
        sourceClass: 'blocked_follow_up',
        enablesDossierAddition: 'add the next unblockable action',
      },
      {
        id: 'source_refs',
        label: 'Source references',
        value: sourceRefs.length > 0,
        displayValue: sourceRefs.join(', '),
        sourceClass: 'source_grounding',
        enablesDossierAddition:
          'add citable technical, VDMI, HITL or interface-placeholder references',
      },
    ];
    const evidenceItems = evidenceSpecs
      .filter((spec) => spec.value)
      .map((spec) => ({
        id: spec.id,
        label: spec.label,
        value: spec.displayValue || spec.value,
        sourceClass: spec.sourceClass,
        evidenceStatus: 'provided',
      }));
    const missingEvidence = evidenceSpecs
      .filter((spec) => !spec.value)
      .map((spec) => ({
        missingDataPoint: spec.id,
        label: spec.label,
        sourceClass: spec.sourceClass,
        enablesDossierAddition: spec.enablesDossierAddition,
      }));
    const decisionText = String(params.riskRegisterDecision || '').toLowerCase();
    const probabilityText = String(params.probability || '').toLowerCase();
    const criticalityText = String(params.criticality || '').toLowerCase();
    const isFormalRisk =
      /(formal|risk register|risikoregister|aufnahme|aufnehmen|register)/i.test(decisionText) &&
      !/(nicht.?aufnahme|not aufgenommen|not included|monitoring)/i.test(decisionText);
    const isMonitoring =
      /(monitoring|beobachtung|watch|ueberwachung|überwachung)/i.test(decisionText) ||
      /(hoch|high|kritisch|critical|rot|red)/i.test(`${probabilityText} ${criticalityText}`);
    const status = !params.technicalFact
      ? 'needs_technical_fact'
      : !params.impactArea
        ? 'needs_impact_area'
        : !params.probability
          ? 'needs_probability'
          : !params.criticality
            ? 'needs_criticality'
            : !params.existingMitigation
              ? 'needs_mitigation_evidence'
              : !params.threshold
                ? 'needs_threshold'
                : !params.riskRegisterDecision
                  ? 'needs_risk_register_decision'
                  : !params.owner
                    ? 'needs_owner'
                    : !params.nextDecisionWindow
                      ? 'needs_decision_window'
                      : !params.blockedFollowUp
                        ? 'needs_blocked_follow_up'
                        : sourceRefs.length === 0
                          ? 'needs_source_refs'
                          : isFormalRisk
                            ? 'ready_for_risk_decision'
                            : isMonitoring
                              ? 'monitoring_needed'
                              : 'ready_for_non_inclusion_decision';
    const readinessScore = Number((evidenceItems.length / evidenceSpecs.length).toFixed(2));
    const positiveFollowUps = missingEvidence.map((item) => ({
      missingDataPoint: item.missingDataPoint,
      enablesDossierAddition: item.enablesDossierAddition,
      category: 'gas_infrastructure_risk_governance',
    }));
    const decisionBoundary = {
      readOnly: true,
      allowedDecisionStates: ['not_aufgenommen', 'monitoring', 'massnahme', 'formal_risk_register'],
      suppliedDecision: params.riskRegisterDecision || null,
      note: 'Status evidence only; formal gas risk-register, monitoring and mitigation decisions remain downstream governance actions.',
    };
    const blockingFindings = missingEvidence.map((item) => ({
      code: `GIRG_${String(item.missingDataPoint).toUpperCase()}_MISSING`,
      severity: [
        'technical_fact',
        'impact_area',
        'threshold',
        'risk_register_decision',
        'owner',
      ].includes(item.missingDataPoint)
        ? 'high'
        : 'medium',
      message: item.enablesDossierAddition,
    }));
    const riskContext = {
      caseId: params.caseId || null,
      technicalFact: params.technicalFact || null,
      impactArea: params.impactArea || null,
      owner: params.owner || null,
      nextDecisionWindow: params.nextDecisionWindow || null,
    };
    const riskEvidence = {
      probability: params.probability || null,
      criticality: params.criticality || null,
      existingMitigation: params.existingMitigation || null,
      threshold: params.threshold || null,
      riskRegisterDecision: params.riskRegisterDecision || null,
      blockedFollowUp: params.blockedFollowUp || null,
    };
    const contextRefs = {
      vdmiContext: params.vdmiContext || null,
      hitlContext: params.hitlContext || null,
      interfacePlaceholderContext: params.interfacePlaceholderContext || null,
      assetContext: params.assetContext || null,
    };
    const dossierFacts = [
      `Status: ${status}`,
      `Provided gas risk evidence: ${evidenceItems.length}/${evidenceSpecs.length}`,
      `Open gaps: ${missingEvidence.length}`,
    ];
    if (params.technicalFact) dossierFacts.push(`Technical Fact: ${params.technicalFact}`);
    if (params.impactArea) dossierFacts.push(`Impact Area: ${params.impactArea}`);
    if (params.riskRegisterDecision)
      dossierFacts.push(`Risk Decision: ${params.riskRegisterDecision}`);
    if (params.owner) dossierFacts.push(`Owner: ${params.owner}`);

    return {
      gasRiskGovernanceStatusId: `girg:${Buffer.from(
        `${params.caseId || ''}:${params.technicalFact || ''}:${params.owner || ''}:${params.nextDecisionWindow || ''}`
      )
        .toString('base64url')
        .slice(0, 24)}`,
      capabilityKey: 'gas_infrastructure_risk_governance',
      safety: 'read_only',
      requestContext: riskContext,
      status,
      readinessScore,
      riskContext,
      riskEvidence,
      evidenceItems,
      missingEvidence,
      positiveFollowUps,
      decisionBoundary,
      blockingFindings,
      sourceEvidence: {
        sourceRefs,
        contextRefs,
      },
      sourceRefs,
      contextRefs,
      sourceActions: {
        inspected: ['dashboard-api.gasInfrastructureRiskGovernanceStatus'],
        referenced: [
          'vdmi.dossier',
          'hitl.summary',
          'interface-placeholder.requestEvidence',
          'assets.effective',
          'grid-operations.summary',
          'evidence-registry.lookup',
          'presentation.generate',
        ],
        notCalled: [
          'gas-risk-register.create',
          'gas-risk-register.mutate',
          'hitl.create',
          'vdmi.create',
          'vdmi.mutate',
          'assets.mutate',
          'asset-mdm.mutate',
          'grid-operations.executeControl',
          'operational-dispatch.execute',
          'monitoring.createDecision',
          'mitigation.execute',
          'external.connector.call',
          'personal-agent.execute',
        ],
      },
      validationFindings: blockingFindings,
      dossierEvidence: {
        status,
        readinessScore,
        riskContext,
        riskEvidence,
        evidenceItems,
        missingEvidence,
        positiveFollowUps,
        decisionBoundary,
        blockingFindings,
        sourceRefs,
        contextRefs,
        dossierFacts,
      },
    };
  },

  buildMeteringRolloutProcessIndicatorStatus(params = {}) {
    const toList = (value) =>
      Array.isArray(value)
        ? value.filter(Boolean)
        : value
          ? String(value)
              .split(',')
              .map((item) => item.trim())
              .filter(Boolean)
          : [];
    const toNumber = (value) => {
      if (value === undefined || value === null || value === '') return null;
      const n = Number(value);
      return Number.isFinite(n) ? n : null;
    };
    const sourceRefs = toList(params.sourceRef);
    const targetCount = toNumber(params.targetCount);
    const actualCount = toNumber(params.actualCount);
    const suppliedBacklog = toNumber(params.backlogCount);
    const backlogCount =
      suppliedBacklog ??
      (targetCount !== null && actualCount !== null
        ? Math.max(0, targetCount - actualCount)
        : null);
    const backlogRate =
      targetCount && targetCount > 0 && backlogCount !== null
        ? Number((backlogCount / targetCount).toFixed(4))
        : null;
    const capexImpactEur = toNumber(params.capexImpactEur);
    const opexImpactEur = toNumber(params.opexImpactEur);
    const evidenceSpecs = [
      {
        id: 'division',
        label: 'Division',
        value: params.division,
        sourceClass: 'metering_division_scope',
        enablesDossierAddition: 'add the affected utility division or metering scope',
      },
      {
        id: 'source_type',
        label: 'Source type',
        value: params.sourceType,
        sourceClass: 'source_classification',
        enablesDossierAddition:
          'add whether evidence comes from administrative rollout statistics, EDM summary or datasource cache',
      },
      {
        id: 'target_count',
        label: 'Target count',
        value: targetCount !== null,
        displayValue: targetCount,
        sourceClass: 'planned_rollout_volume',
        enablesDossierAddition: 'add Soll count for rollout or meter-change variance',
      },
      {
        id: 'actual_count',
        label: 'Actual count',
        value: actualCount !== null,
        displayValue: actualCount,
        sourceClass: 'actual_rollout_volume',
        enablesDossierAddition: 'add Ist count for rollout progress evidence',
      },
      {
        id: 'backlog_count',
        label: 'Backlog count',
        value: backlogCount !== null,
        displayValue: backlogCount,
        sourceClass: 'process_backlog_indicator',
        enablesDossierAddition: 'add backlog count or derivable Soll/Ist delta',
      },
      {
        id: 'data_quality_status',
        label: 'Data-quality status',
        value: params.dataQualityStatus,
        sourceClass: 'data_quality_risk',
        enablesDossierAddition: 'add data-quality risk assessment',
      },
      {
        id: 'contractor_load',
        label: 'Contractor load',
        value: params.contractorLoad,
        sourceClass: 'contractor_capacity_signal',
        enablesDossierAddition: 'add Dienstleisterlast or capacity bottleneck evidence',
      },
      {
        id: 'capex_impact',
        label: 'CAPEX impact',
        value: capexImpactEur !== null,
        displayValue: capexImpactEur,
        sourceClass: 'capex_impact_hint',
        enablesDossierAddition: 'add CAPEX indication for investment steering',
      },
      {
        id: 'opex_impact',
        label: 'OPEX impact',
        value: opexImpactEur !== null,
        displayValue: opexImpactEur,
        sourceClass: 'opex_impact_hint',
        enablesDossierAddition: 'add OPEX indication for operational steering',
      },
      {
        id: 'owner',
        label: 'Owner',
        value: params.owner,
        sourceClass: 'accountable_owner',
        enablesDossierAddition: 'add accountable process owner',
      },
      {
        id: 'next_control_step',
        label: 'Next control step',
        value: params.nextControlStep,
        sourceClass: 'next_steering_step',
        enablesDossierAddition: 'add the next steering or review step',
      },
      {
        id: 'blocked_follow_up',
        label: 'Blocked follow-up',
        value: params.blockedFollowUp,
        sourceClass: 'blocked_follow_up',
        enablesDossierAddition: 'add the downstream decision blocked by missing rollout evidence',
      },
      {
        id: 'source_refs',
        label: 'Source references',
        value: sourceRefs.length > 0,
        displayValue: sourceRefs.join(', '),
        sourceClass: 'source_grounding',
        enablesDossierAddition: 'add citable datasource, EDM, VDMI or monthly-statistic references',
      },
    ];
    const evidenceItems = evidenceSpecs
      .filter((spec) => spec.value)
      .map((spec) => ({
        id: spec.id,
        label: spec.label,
        value: spec.displayValue ?? spec.value,
        sourceClass: spec.sourceClass,
        evidenceStatus: 'provided',
      }));
    const missingEvidence = evidenceSpecs
      .filter((spec) => !spec.value)
      .map((spec) => ({
        missingDataPoint: spec.id,
        label: spec.label,
        sourceClass: spec.sourceClass,
        enablesDossierAddition: spec.enablesDossierAddition,
      }));
    const qualityText = String(params.dataQualityStatus || '').toLowerCase();
    const contractorText = String(params.contractorLoad || '').toLowerCase();
    const qualityBlocks =
      /blocked|blockiert|kritisch|critical|missing|fehlt|unvollstaendig|unvollständig/.test(
        qualityText
      );
    const contractorBlocks = /blocked|blockiert|ueberlast|überlast|overload|kritisch|critical/.test(
      contractorText
    );
    const highBacklog = backlogRate !== null && backlogRate >= 0.2;
    const status = qualityBlocks
      ? 'blocked_by_data_quality'
      : contractorBlocks
        ? 'blocked_by_contractor_capacity'
        : !params.division
          ? 'needs_division'
          : !params.sourceType
            ? 'needs_source_type'
            : targetCount === null
              ? 'needs_target_count'
              : actualCount === null
                ? 'needs_actual_count'
                : backlogCount === null
                  ? 'needs_backlog_count'
                  : !params.dataQualityStatus
                    ? 'needs_data_quality_status'
                    : !params.contractorLoad
                      ? 'needs_contractor_load'
                      : capexImpactEur === null
                        ? 'needs_capex_impact'
                        : opexImpactEur === null
                          ? 'needs_opex_impact'
                          : !params.owner
                            ? 'needs_owner'
                            : !params.nextControlStep
                              ? 'needs_next_control_step'
                              : !params.blockedFollowUp
                                ? 'needs_blocked_follow_up'
                                : sourceRefs.length === 0
                                  ? 'needs_source_refs'
                                  : highBacklog
                                    ? 'backlog_requires_steering'
                                    : 'process_indicator_ready';
    const readinessScore = Number((evidenceItems.length / evidenceSpecs.length).toFixed(2));
    const positiveFollowUps = missingEvidence.map((item) => ({
      missingDataPoint: item.missingDataPoint,
      enablesDossierAddition: item.enablesDossierAddition,
      category: 'metering_rollout_process_indicator',
    }));
    const blockingFindings = missingEvidence.map((item) => ({
      code: `MRPI_${String(item.missingDataPoint).toUpperCase()}_MISSING`,
      severity: [
        'division',
        'target_count',
        'actual_count',
        'data_quality_status',
        'owner',
        'next_control_step',
      ].includes(item.missingDataPoint)
        ? 'high'
        : 'medium',
      message: item.enablesDossierAddition,
    }));
    if (qualityBlocks || contractorBlocks || highBacklog) {
      blockingFindings.push({
        code: qualityBlocks
          ? 'MRPI_DATA_QUALITY_BLOCKING'
          : contractorBlocks
            ? 'MRPI_CONTRACTOR_CAPACITY_BLOCKING'
            : 'MRPI_BACKLOG_THRESHOLD_REACHED',
        severity: 'high',
        message:
          'metering rollout evidence indicates a steering-relevant data-quality, contractor-capacity or backlog condition',
      });
    }
    const indicatorContext = {
      indicatorId: params.indicatorId || null,
      division: params.division || null,
      sourceType: params.sourceType || null,
      owner: params.owner || null,
      nextControlStep: params.nextControlStep || null,
    };
    const processEvidence = {
      targetCount,
      actualCount,
      backlogCount,
      backlogRate,
      dataQualityStatus: params.dataQualityStatus || null,
      contractorLoad: params.contractorLoad || null,
      capexImpactEur,
      opexImpactEur,
      blockedFollowUp: params.blockedFollowUp || null,
    };
    const dossierFacts = [
      `Status: ${status}`,
      `Provided metering rollout evidence: ${evidenceItems.length}/${evidenceSpecs.length}`,
      `Open gaps: ${missingEvidence.length}`,
    ];
    if (params.division) dossierFacts.push(`Division: ${params.division}`);
    if (params.sourceType) dossierFacts.push(`Source Type: ${params.sourceType}`);
    if (backlogRate !== null) dossierFacts.push(`Backlog Rate: ${backlogRate}`);
    if (params.owner) dossierFacts.push(`Owner: ${params.owner}`);

    return {
      processIndicatorStatusId: `mrpi:${Buffer.from(
        `${params.indicatorId || ''}:${params.division || ''}:${params.sourceType || ''}:${params.owner || ''}`
      )
        .toString('base64url')
        .slice(0, 24)}`,
      capabilityKey: 'metering_rollout_process_indicator',
      safety: 'read_only',
      requestContext: indicatorContext,
      status,
      readinessScore,
      indicatorContext,
      processEvidence,
      evidenceItems,
      missingEvidence,
      positiveFollowUps,
      blockingFindings,
      sourceEvidence: {
        sourceRefs,
      },
      sourceRefs,
      sourceActions: {
        inspected: ['dashboard-api.meteringRolloutProcessIndicatorStatus'],
        referenced: [
          'datasource-registry.list',
          'datasource-cache.query',
          'edm.getTimeseriesSummary',
          'in-memory-join.join',
          'vdmi.dossier',
          'hitl.summary',
          'evidence-registry.lookup',
          'presentation.generate',
        ],
        notCalled: [
          'datasource-registry.refresh',
          'datasource-cache.refresh',
          'datasource-cache.query',
          'edm.importTimeseries',
          'edm.mutate',
          'in-memory-join.execute',
          'hitl.create',
          'vdmi.create',
          'vdmi.mutate',
          'finance-agent.mutate',
          'capex.decision',
          'billing.release',
          'settlement.prepareBilling',
          'tariff.mutate',
          'device-control.execute',
          'external.connector.call',
          'personal-agent.execute',
        ],
      },
      validationFindings: blockingFindings,
      dossierEvidence: {
        status,
        readinessScore,
        indicatorContext,
        processEvidence,
        evidenceItems,
        missingEvidence,
        positiveFollowUps,
        blockingFindings,
        sourceRefs,
        dossierFacts,
      },
    };
  },

  buildHeatTransformationLineAssetModelStatus(params = {}) {
    const toList = (value) =>
      Array.isArray(value)
        ? value.filter(Boolean)
        : value
          ? String(value)
              .split(',')
              .map((item) => item.trim())
              .filter(Boolean)
          : [];
    const toNumber = (value) => {
      if (value === undefined || value === null || value === '') return null;
      const n = Number(value);
      return Number.isFinite(n) ? n : null;
    };
    const sourceRefs = toList(params.sourceRef);
    const connectedPointAssetIds = toList(params.connectedPointAssetIds);
    const investmentNeed = toNumber(params.investmentNeed);

    const evidenceSpecs = [
      {
        id: 'division',
        label: 'Division',
        value: params.division,
        sourceClass: 'heat_division_scope',
        enablesDossierAddition: 'add the affected utility division scope (defaults to Wärme)',
      },
      {
        id: 'line_asset_id',
        label: 'Line Asset ID',
        value: params.lineAssetId,
        sourceClass: 'line_segment_classification',
        enablesDossierAddition: 'add the specific line segment or pipe identifier',
      },
      {
        id: 'geometry_ref',
        label: 'Geometry reference',
        value: params.geometryRef,
        sourceClass: 'gis_geometry_reference',
        enablesDossierAddition: 'add the geographic line coordinate boundary or GIS path reference',
      },
      {
        id: 'connected_point_asset_ids',
        label: 'Connected point assets',
        value: connectedPointAssetIds.length > 0,
        displayValue: connectedPointAssetIds.join(', '),
        sourceClass: 'topological_point_assets',
        enablesDossierAddition:
          'add the topological point-asset connections (e.g. transformers or heating plants)',
      },
      {
        id: 'network_calculation_ref',
        label: 'Network calculation reference',
        value: params.networkCalculationRef,
        sourceClass: 'network_calculation_reference',
        enablesDossierAddition: 'add the hydraulic or thermodynamic network calculation reference',
      },
      {
        id: 'data_quality_status',
        label: 'Data-quality status',
        value: params.dataQualityStatus,
        sourceClass: 'data_quality_risk',
        enablesDossierAddition: 'add the GIS and asset data-quality risk assessment',
      },
      {
        id: 'transformation_status',
        label: 'Transformation status',
        value: params.transformationStatus,
        sourceClass: 'transformation_scenario_status',
        enablesDossierAddition: 'add the strategic Heat/Gas transformation option or status',
      },
      {
        id: 'future_option',
        label: 'Future option',
        value: params.futureOption,
        sourceClass: 'future_technology_option',
        enablesDossierAddition:
          'add the specific future technology option (H2-ready vs district-heating network)',
      },
      {
        id: 'investment_need',
        label: 'Investment need',
        value: investmentNeed !== null,
        displayValue: investmentNeed,
        sourceClass: 'investment_need_indicator',
        enablesDossierAddition: 'add the indicative investment need in EUR or reference',
      },
      {
        id: 'owner',
        label: 'Owner',
        value: params.owner,
        sourceClass: 'accountable_owner',
        enablesDossierAddition: 'add the accountable asset manager or owner division',
      },
      {
        id: 'next_decision',
        label: 'Next decision',
        value: params.nextDecision,
        sourceClass: 'next_decision_gate',
        enablesDossierAddition: 'add the next decision gate or strategic window',
      },
      {
        id: 'source_refs',
        label: 'Source references',
        value: sourceRefs.length > 0,
        displayValue: sourceRefs.join(', '),
        sourceClass: 'source_grounding',
        enablesDossierAddition: 'add the citable source references or GIS provenance',
      },
    ];

    const evidenceItems = evidenceSpecs
      .filter((spec) => spec.value)
      .map((spec) => ({
        id: spec.id,
        label: spec.label,
        value: spec.displayValue ?? spec.value,
        sourceClass: spec.sourceClass,
        evidenceStatus: 'provided',
      }));

    const missingEvidence = evidenceSpecs
      .filter((spec) => !spec.value)
      .map((spec) => ({
        missingDataPoint: spec.id,
        label: spec.label,
        sourceClass: spec.sourceClass,
        enablesDossierAddition: spec.enablesDossierAddition,
      }));

    const qualityText = String(params.dataQualityStatus || '').toLowerCase();
    const qualityBlocks =
      /blocked|blockiert|kritisch|critical|missing|fehlt|unvollstaendig|unvollständig/.test(
        qualityText
      );

    const status = qualityBlocks
      ? 'blocked_by_data_quality'
      : !params.division
        ? 'needs_division'
        : !params.lineAssetId
          ? 'needs_line_asset_id'
          : !params.geometryRef
            ? 'needs_geometry_ref'
            : connectedPointAssetIds.length === 0
              ? 'needs_connected_point_asset_ids'
              : !params.networkCalculationRef
                ? 'needs_network_calculation_ref'
                : !params.dataQualityStatus
                  ? 'needs_data_quality_status'
                  : !params.transformationStatus
                    ? 'needs_transformation_status'
                    : !params.futureOption
                      ? 'needs_future_option'
                      : investmentNeed === null
                        ? 'needs_investment_need'
                        : !params.owner
                          ? 'needs_owner'
                          : !params.nextDecision
                            ? 'needs_next_decision'
                            : sourceRefs.length === 0
                              ? 'needs_source_refs'
                              : 'ready_for_transformation_decision';

    const readinessScore = Number((evidenceItems.length / evidenceSpecs.length).toFixed(2));

    const positiveFollowUps = missingEvidence.map((item) => ({
      missingDataPoint: item.missingDataPoint,
      enablesDossierAddition: item.enablesDossierAddition,
      category: 'heat_transformation_line_asset_model',
    }));

    const blockingFindings = missingEvidence.map((item) => ({
      code: `HTLAM_${String(item.missingDataPoint).toUpperCase()}_MISSING`,
      severity: [
        'division',
        'line_asset_id',
        'geometry_ref',
        'data_quality_status',
        'owner',
        'next_decision',
      ].includes(item.missingDataPoint)
        ? 'high'
        : 'medium',
      message: item.enablesDossierAddition,
    }));

    if (qualityBlocks) {
      blockingFindings.push({
        code: 'HTLAM_DATA_QUALITY_BLOCKING',
        severity: 'high',
        message:
          'heat transformation line-asset evidence indicates a steering-relevant data-quality condition',
      });
    }

    const modelContext = {
      lineAssetId: params.lineAssetId || null,
      division: params.division || null,
      owner: params.owner || null,
      nextDecision: params.nextDecision || null,
    };

    const lineEvidence = {
      geometryRef: params.geometryRef || null,
      connectedPointAssetIds,
      networkCalculationRef: params.networkCalculationRef || null,
      dataQualityStatus: params.dataQualityStatus || null,
      transformationStatus: params.transformationStatus || null,
      futureOption: params.futureOption || null,
      investmentNeed,
    };

    const dossierFacts = [
      `Status: ${status}`,
      `Provided heat transformation line-asset evidence: ${evidenceItems.length}/${evidenceSpecs.length}`,
      `Open gaps: ${missingEvidence.length}`,
    ];
    if (params.division) dossierFacts.push(`Division: ${params.division}`);
    if (params.lineAssetId) dossierFacts.push(`Line Asset ID: ${params.lineAssetId}`);
    if (params.owner) dossierFacts.push(`Owner: ${params.owner}`);

    return {
      lineAssetModelStatusId: `htlam:${Buffer.from(
        `${params.lineAssetId || ''}:${params.division || ''}:${params.owner || ''}`
      )
        .toString('base64url')
        .slice(0, 24)}`,
      capabilityKey: 'heat_transformation_line_asset_model',
      safety: 'read_only',
      requestContext: modelContext,
      status,
      readinessScore,
      modelContext,
      lineEvidence,
      evidenceItems,
      missingEvidence,
      positiveFollowUps,
      blockingFindings,
      sourceEvidence: {
        sourceRefs,
      },
      sourceRefs,
      sourceActions: {
        inspected: ['dashboard-api.heatTransformationLineAssetModelStatus'],
        referenced: [
          'znp.listProjects',
          'znp.getProjectAssets',
          'assets.effective',
          'datapoint.health',
          'finance-agent.analyze',
          'investment-planning.createPlan',
          'vdmi.dossier',
          'evidence-registry.lookup',
          'presentation.generate',
        ],
        notCalled: [
          'znp.createProject',
          'znp.addLayer0',
          'znp.addAssumption',
          'assets.mutate',
          'datapoint.mutate',
          'hitl.create',
          'vdmi.create',
          'vdmi.mutate',
          'finance-agent.mutate',
          'investment-planning.createPlan',
          'billing.release',
          'settlement.prepareBilling',
          'tariff.mutate',
          'device-control.execute',
          'external.connector.call',
          'personal-agent.execute',
        ],
      },
      validationFindings: blockingFindings,
      dossierEvidence: {
        status,
        readinessScore,
        modelContext,
        lineEvidence,
        evidenceItems,
        missingEvidence,
        positiveFollowUps,
        blockingFindings,
        sourceRefs,
        dossierFacts,
      },
    };
  },

  buildKiFloorwalkerGovernanceStatus(params = {}) {
    const toList = (value) =>
      Array.isArray(value)
        ? value.filter(Boolean)
        : value
          ? String(value)
              .split(',')
              .map((item) => item.trim())
              .filter(Boolean)
          : [];
    const sourceRefs = toList(params.sourceRef);
    const allowedDataspaces = toList(params.allowedDataspaces);

    const evidenceSpecs = [
      {
        id: 'use_case_priority',
        label: 'Use-case priority',
        value: params.useCasePriority,
        sourceClass: 'use_case_priority',
        enablesDossierAddition: 'add the prioritized use-case status or strategic value tier',
      },
      {
        id: 'allowed_dataspaces',
        label: 'Allowed data spaces',
        value: allowedDataspaces.length > 0,
        displayValue: allowedDataspaces.join(', '),
        sourceClass: 'allowed_data_spaces',
        enablesDossierAddition: 'add the list of cleared and compliant enterprise data spaces',
      },
      {
        id: 'prompt_standards',
        label: 'Prompt standards',
        value: params.promptStandards,
        sourceClass: 'prompt_standards',
        enablesDossierAddition: 'add the validated prompt patterns or prompt templates',
      },
      {
        id: 'process_boundaries',
        label: 'Process boundaries',
        value: params.processBoundaries,
        sourceClass: 'process_boundaries',
        enablesDossierAddition: 'add the operational process boundaries or scope limits',
      },
      {
        id: 'roles_and_responsibilities',
        label: 'Roles & responsibilities',
        value: params.rolesAndResponsibilities,
        sourceClass: 'roles_and_responsibilities',
        enablesDossierAddition:
          'add the accountable owners, governance coordinators, or release authorities',
      },
      {
        id: 'guided_application',
        label: 'Guided application',
        value: params.guidedApplication,
        sourceClass: 'guided_application',
        enablesDossierAddition:
          'add the structured user enablement, training, or operating-model guidance',
      },
      {
        id: 'risk_and_approval_status',
        label: 'Risk & approval status',
        value: params.riskAndApprovalStatus,
        sourceClass: 'risk_and_approval_status',
        enablesDossierAddition:
          'add the regulatory risk classification (e.g. EU AI Act conformity) and approval status',
      },
      {
        id: 'proof_of_benefit',
        label: 'Proof of benefit',
        value: params.proofOfBenefit,
        sourceClass: 'proof_of_benefit',
        enablesDossierAddition:
          'add the strategic benefit metrics, KPIs, or productivity gains proof',
      },
      {
        id: 'source_refs',
        label: 'Source references',
        value: sourceRefs.length > 0,
        displayValue: sourceRefs.join(', '),
        sourceClass: 'source_grounding',
        enablesDossierAddition: 'add the citable source references or grounding evidence',
      },
    ];

    const evidenceItems = evidenceSpecs
      .filter((spec) => spec.value)
      .map((spec) => ({
        id: spec.id,
        label: spec.label,
        value: spec.displayValue ?? spec.value,
        sourceClass: spec.sourceClass,
        evidenceStatus: 'provided',
      }));

    const missingEvidence = evidenceSpecs
      .filter((spec) => !spec.value)
      .map((spec) => ({
        missingDataPoint: spec.id,
        label: spec.label,
        sourceClass: spec.sourceClass,
        enablesDossierAddition: spec.enablesDossierAddition,
      }));

    const status = !params.useCaseId
      ? 'needs_use_case_id'
      : !params.processOwner
        ? 'needs_process_owner'
        : !params.useCasePriority
          ? 'needs_use_case_priority'
          : allowedDataspaces.length === 0
            ? 'needs_allowed_dataspaces'
            : !params.promptStandards
              ? 'needs_prompt_standards'
              : !params.processBoundaries
                ? 'needs_process_boundaries'
                : !params.rolesAndResponsibilities
                  ? 'needs_roles_and_responsibilities'
                  : !params.guidedApplication
                    ? 'needs_guided_application'
                    : !params.riskAndApprovalStatus
                      ? 'needs_risk_and_approval_status'
                      : !params.proofOfBenefit
                        ? 'needs_proof_of_benefit'
                        : sourceRefs.length === 0
                          ? 'needs_source_refs'
                          : 'ready_for_floorwalker_application';

    const readinessScore = Number((evidenceItems.length / evidenceSpecs.length).toFixed(2));

    const positiveFollowUps = missingEvidence.map((item) => ({
      missingDataPoint: item.missingDataPoint,
      enablesDossierAddition: item.enablesDossierAddition,
      category: 'ki_floorwalker_governance',
    }));

    const blockingFindings = missingEvidence.map((item) => ({
      code: `KIFG_${String(item.missingDataPoint).toUpperCase()}_MISSING`,
      severity: [
        'use_case_priority',
        'allowed_dataspaces',
        'roles_and_responsibilities',
        'risk_and_approval_status',
      ].includes(item.missingDataPoint)
        ? 'high'
        : 'medium',
      message: item.enablesDossierAddition,
    }));

    const governanceContext = {
      useCaseId: params.useCaseId || null,
      processOwner: params.processOwner || null,
    };

    const governanceEvidence = {
      useCasePriority: params.useCasePriority || null,
      allowedDataspaces,
      promptStandards: params.promptStandards || null,
      processBoundaries: params.processBoundaries || null,
      rolesAndResponsibilities: params.rolesAndResponsibilities || null,
      guidedApplication: params.guidedApplication || null,
      riskAndApprovalStatus: params.riskAndApprovalStatus || null,
      proofOfBenefit: params.proofOfBenefit || null,
    };

    const dossierFacts = [
      `Status: ${status}`,
      `Provided KI floorwalker evidence: ${evidenceItems.length}/${evidenceSpecs.length}`,
      `Open gaps: ${missingEvidence.length}`,
    ];
    if (params.useCaseId) dossierFacts.push(`Use Case ID: ${params.useCaseId}`);
    if (params.processOwner) dossierFacts.push(`Process Owner: ${params.processOwner}`);

    return {
      kiFloorwalkerGovernanceStatusId: `kifg:${Buffer.from(
        `${params.useCaseId || ''}:${params.processOwner || ''}`
      )
        .toString('base64url')
        .slice(0, 24)}`,
      capabilityKey: 'ki_floorwalker_governance',
      safety: 'read_only',
      requestContext: governanceContext,
      status,
      readinessScore,
      governanceContext,
      governanceEvidence,
      evidenceItems,
      missingEvidence,
      positiveFollowUps,
      blockingFindings,
      sourceEvidence: {
        sourceRefs,
      },
      sourceRefs,
      sourceActions: {
        inspected: ['dashboard-api.kiFloorwalkerGovernanceStatus'],
        referenced: [
          'personal-agent.chat',
          'cya.generate',
          'vdmi.dossier',
          'datapoint.oemetadata',
          'evidence-registry.lookup',
          'presentation.generate',
        ],
        notCalled: ['openai.call', 'hitl.create', 'vdmi.mutate', 'personal-agent.execute'],
      },
      validationFindings: blockingFindings,
      dossierEvidence: {
        status,
        readinessScore,
        governanceContext,
        governanceEvidence,
        evidenceItems,
        missingEvidence,
        positiveFollowUps,
        blockingFindings,
        sourceRefs,
        dossierFacts,
      },
    };
  },

  buildInvestmentWaterfallGovernanceStatus(params = {}) {
    const toList = (value) =>
      Array.isArray(value)
        ? value.filter(Boolean)
        : value
          ? String(value)
              .split(',')
              .map((item) => item.trim())
              .filter(Boolean)
          : [];
    const sourceRefs = toList(params.sourceRef);

    const evidenceSpecs = [
      {
        id: 'budget_amount',
        label: 'Strategic budget allocation',
        value: params.budgetAmount,
        sourceClass: 'budget_allocation',
        enablesDossierAddition:
          'add the strategic budget allocation and multi-year investment volume',
      },
      {
        id: 'bottleneck_ref',
        label: 'Bottleneck relation',
        value: params.bottleneckRef,
        sourceClass: 'bottleneck_relation',
        enablesDossierAddition: 'add the related grid bottleneck reference or infrastructure risk',
      },
      {
        id: 'committee_window',
        label: 'Committee calendar window',
        value: params.committeeWindow,
        sourceClass: 'committee_calendar_slot',
        enablesDossierAddition: 'add the target committee window or decision calendar slot',
      },
      {
        id: 'evidence_readiness',
        label: 'Evidence readiness',
        value: params.evidenceReadiness,
        sourceClass: 'committee_readiness',
        enablesDossierAddition: 'add the required evidentiary documents or milestone clearances',
      },
      {
        id: 'owner',
        label: 'Accountable owner',
        value: params.owner,
        sourceClass: 'strategic_responsibility',
        enablesDossierAddition: 'add the accountable owner or executive sponsor',
      },
      {
        id: 'next_action',
        label: 'Next action',
        value: params.nextAction,
        sourceClass: 'next_operational_step',
        enablesDossierAddition: 'add the planned next operational step or follow-up task',
      },
      {
        id: 'mandate_status',
        label: 'Mandate status',
        value: params.mandateStatus,
        sourceClass: 'management_mandate',
        enablesDossierAddition: 'add the required management mandate or corporate authorization',
      },
      {
        id: 'risk_if_delayed',
        label: 'Risk if delayed',
        value: params.riskIfDelayed,
        sourceClass: 'delay_risk_analysis',
        enablesDossierAddition: 'add the strategic or regulatory risk if the decision is delayed',
      },
      {
        id: 'source_refs',
        label: 'Source references',
        value: sourceRefs.length > 0,
        displayValue: sourceRefs.join(', '),
        sourceClass: 'source_grounding',
        enablesDossierAddition: 'add the citable source references or grounding evidence',
      },
    ];

    const evidenceItems = evidenceSpecs
      .filter((spec) => spec.value)
      .map((spec) => ({
        id: spec.id,
        label: spec.label,
        value: spec.displayValue ?? spec.value,
        sourceClass: spec.sourceClass,
        evidenceStatus: 'provided',
      }));

    const missingEvidence = evidenceSpecs
      .filter((spec) => !spec.value)
      .map((spec) => ({
        missingDataPoint: spec.id,
        label: spec.label,
        sourceClass: spec.sourceClass,
        enablesDossierAddition: spec.enablesDossierAddition,
      }));

    const status = !params.investmentItemId
      ? 'needs_investment_item_id'
      : !params.budgetAmount
        ? 'needs_budget_amount'
        : !params.bottleneckRef
          ? 'needs_bottleneck_ref'
          : !params.committeeWindow
            ? 'needs_committee_window'
            : !params.evidenceReadiness
              ? 'needs_evidence_readiness'
              : !params.owner
                ? 'needs_owner'
                : !params.nextAction
                  ? 'needs_next_action'
                  : !params.mandateStatus
                    ? 'needs_mandate_status'
                    : !params.riskIfDelayed
                      ? 'needs_risk_if_delayed'
                      : sourceRefs.length === 0
                        ? 'needs_source_refs'
                        : 'ready_for_committee_decision';

    const readinessScore = Number((evidenceItems.length / evidenceSpecs.length).toFixed(2));

    const positiveFollowUps = missingEvidence.map((item) => ({
      missingDataPoint: item.missingDataPoint,
      enablesDossierAddition: item.enablesDossierAddition,
      category: 'investment_waterfall_governance',
    }));

    const blockingFindings = missingEvidence.map((item) => ({
      code: `IWG_${String(item.missingDataPoint).toUpperCase()}_MISSING`,
      severity: ['budget_amount', 'committee_window', 'owner', 'mandate_status'].includes(
        item.missingDataPoint
      )
        ? 'high'
        : 'medium',
      message: item.enablesDossierAddition,
    }));

    const governanceContext = {
      investmentItemId: params.investmentItemId || null,
      targetProcess: params.targetProcess || null,
    };

    const governanceEvidence = {
      budgetAmount: params.budgetAmount || null,
      bottleneckRef: params.bottleneckRef || null,
      committeeWindow: params.committeeWindow || null,
      evidenceReadiness: params.evidenceReadiness || null,
      owner: params.owner || null,
      nextAction: params.nextAction || null,
      mandateStatus: params.mandateStatus || null,
      riskIfDelayed: params.riskIfDelayed || null,
    };

    const dossierFacts = [
      `Status: ${status}`,
      `Provided investment waterfall governance evidence: ${evidenceItems.length}/${evidenceSpecs.length}`,
      `Open gaps: ${missingEvidence.length}`,
    ];
    if (params.investmentItemId)
      dossierFacts.push(`Investment Item ID: ${params.investmentItemId}`);
    if (params.targetProcess) dossierFacts.push(`Target Process: ${params.targetProcess}`);

    return {
      investmentWaterfallGovernanceStatusId: `iwg:${Buffer.from(
        `${params.investmentItemId || ''}:${params.targetProcess || ''}`
      )
        .toString('base64url')
        .slice(0, 24)}`,
      capabilityKey: 'investment_waterfall_governance',
      safety: 'read_only',
      requestContext: governanceContext,
      status,
      readinessScore,
      governanceContext,
      governanceEvidence,
      evidenceItems,
      missingEvidence,
      positiveFollowUps,
      blockingFindings,
      sourceEvidence: {
        sourceRefs,
      },
      sourceRefs,
      sourceActions: {
        inspected: ['dashboard-api.investmentWaterfallGovernanceStatus'],
        referenced: [
          'personal-agent.chat',
          'cya.generate',
          'vdmi.dossier',
          'datapoint.oemetadata',
          'evidence-registry.lookup',
          'presentation.generate',
        ],
        notCalled: [
          'pmo-budget.create',
          'pmo-budget.allocate',
          'pmo-budget.mutate',
          'hitl.create',
          'vdmi.mutate',
          'investment-planning.createPlan',
          'finance-agent.mutate',
          'budget.release',
          'settlement.prepareBilling',
          'external.connector.call',
          'personal-agent.execute',
        ],
      },
      validationFindings: blockingFindings,
      dossierEvidence: {
        status,
        readinessScore,
        governanceContext,
        governanceEvidence,
        evidenceItems,
        missingEvidence,
        positiveFollowUps,
        blockingFindings,
        sourceRefs,
        dossierFacts,
      },
    };
  },

  buildCapacityContractRiskAssetCockpitStatus(params = {}) {
    const toList = (value) =>
      Array.isArray(value)
        ? value.filter(Boolean)
        : value
          ? String(value)
              .split(',')
              .map((item) => item.trim())
              .filter(Boolean)
          : [];
    const sourceRefs = toList(params.sourceRef);

    const evidenceSpecs = [
      {
        id: 'utilization',
        label: 'Netzauslastung',
        value:
          typeof params.utilization === 'number'
            ? params.utilization
            : params.utilization !== undefined &&
                params.utilization !== null &&
                params.utilization !== ''
              ? Number(params.utilization)
              : null,
        sourceClass: 'capacity_utilization_check',
        enablesDossierAddition: 'verify the technical capacity utilization or load profile',
      },
      {
        id: 'bottleneck',
        label: 'Engpass-Situation',
        value: params.bottleneck,
        sourceClass: 'grid_bottleneck_tracking',
        enablesDossierAddition: 'identify grid bottlenecks or network constraints',
      },
      {
        id: 'contract_status',
        label: 'Vertragsstatus',
        value: params.contractStatus,
        sourceClass: 'contract_agreement_verification',
        enablesDossierAddition: 'verify contract status or connection agreements',
      },
      {
        id: 'legal_status',
        label: 'Regulatorischer Legal-Status',
        value: params.legalStatus,
        sourceClass: 'legal_compliance_audit',
        enablesDossierAddition: 'verify legal or regulatory compliance status',
      },
      {
        id: 'capex',
        label: 'CAPEX Investitionsoption',
        value:
          typeof params.capex === 'number'
            ? params.capex
            : params.capex !== undefined && params.capex !== null && params.capex !== ''
              ? Number(params.capex)
              : null,
        sourceClass: 'financial_capex_specification',
        enablesDossierAddition: 'specify capex requirements or project budget',
      },
      {
        id: 'opex',
        label: 'OPEX Betriebskosten',
        value:
          typeof params.opex === 'number'
            ? params.opex
            : params.opex !== undefined && params.opex !== null && params.opex !== ''
              ? Number(params.opex)
              : null,
        sourceClass: 'financial_opex_estimation',
        enablesDossierAddition: 'specify opex or recurring network charges',
      },
      {
        id: 'owner',
        label: 'Accountable Owner',
        value: params.owner,
        sourceClass: 'accountable_owner_assignment',
        enablesDossierAddition: 'add the accountable owner or process sponsor role',
      },
      {
        id: 'next_action',
        label: 'Next Action',
        value: params.nextAction,
        sourceClass: 'risk_mitigation_planning',
        enablesDossierAddition: 'add planned next action or risk mitigation',
      },
      {
        id: 'source_refs',
        label: 'Source references',
        value: sourceRefs.length > 0,
        displayValue: sourceRefs.join(', '),
        sourceClass: 'source_grounding',
        enablesDossierAddition: 'add citable regulatory or technical source grounding',
      },
    ];

    const evidenceItems = evidenceSpecs
      .filter(
        (spec) =>
          spec.value !== undefined &&
          spec.value !== null &&
          spec.value !== false &&
          spec.value !== ''
      )
      .map((spec) => ({
        id: spec.id,
        label: spec.label,
        value: spec.displayValue ?? spec.value,
        sourceClass: spec.sourceClass,
        evidenceStatus: 'provided',
      }));

    const missingEvidence = evidenceSpecs
      .filter(
        (spec) =>
          spec.value === undefined ||
          spec.value === null ||
          spec.value === false ||
          spec.value === ''
      )
      .map((spec) => ({
        missingDataPoint: spec.id,
        label: spec.label,
        sourceClass: spec.sourceClass,
        enablesDossierAddition: spec.enablesDossierAddition,
      }));

    // Determine statuses and riskLevel
    let riskLevel = 'low';
    let decisionStatus = 'approve';

    const ut =
      typeof params.utilization === 'number'
        ? params.utilization
        : params.utilization !== undefined &&
            params.utilization !== null &&
            params.utilization !== ''
          ? Number(params.utilization)
          : null;
    const bn = params.bottleneck;
    const cs = params.contractStatus;
    const ls = params.legalStatus;
    const cx =
      typeof params.capex === 'number'
        ? params.capex
        : params.capex !== undefined && params.capex !== null && params.capex !== ''
          ? Number(params.capex)
          : null;

    if (ut !== null) {
      if (ut > 1.2) {
        riskLevel = 'critical';
        decisionStatus = 'reject_or_escalate';
      } else if (ut > 1.0) {
        riskLevel = 'high';
        decisionStatus = 'approve_conditionally';
      } else if (ut > 0.8) {
        riskLevel = 'medium';
        decisionStatus = 'approve_conditionally';
      }
    }

    if (bn && /overload|congested|critical|blocking/i.test(bn)) {
      riskLevel = 'critical';
      decisionStatus = 'reject_or_escalate';
    } else if (bn && /warn|congest/i.test(bn) && decisionStatus !== 'reject_or_escalate') {
      riskLevel = 'high';
      decisionStatus = 'approve_conditionally';
    }

    if (cs && /clarification|dispute|missing/i.test(cs)) {
      decisionStatus = 'needs_contract_clarification';
      if (riskLevel === 'low') riskLevel = 'medium';
    }

    if (ls && /non-compliant|dispute|invalid/i.test(ls)) {
      decisionStatus = 'needs_legal_clarification';
      riskLevel = 'high';
    }

    if (cx !== null && cx > 500000 && decisionStatus === 'approve') {
      decisionStatus = 'needs_investment_decision';
      riskLevel = 'medium';
    }

    const status = !params.gridOperatorId
      ? 'needs_grid_operator_id'
      : ut === null
        ? 'needs_utilization'
        : !bn
          ? 'needs_bottleneck'
          : !cs
            ? 'needs_contract_status'
            : !ls
              ? 'needs_legal_status'
              : cx === null
                ? 'needs_capex'
                : typeof params.opex !== 'number' &&
                    (params.opex === undefined || params.opex === null || params.opex === '')
                  ? 'needs_opex'
                  : !params.owner
                    ? 'needs_owner'
                    : !params.nextAction
                      ? 'needs_next_action'
                      : sourceRefs.length === 0
                        ? 'needs_source_refs'
                        : decisionStatus === 'approve'
                          ? 'ready_with_no_risk'
                          : 'ready_with_risk_findings';

    // If there are missing fields, the overall decisionStatus might be forced to "needs_evidence"
    const finalDecisionStatus = missingEvidence.length > 0 ? 'needs_evidence' : decisionStatus;

    const readinessScore = Number((evidenceItems.length / evidenceSpecs.length).toFixed(2));
    const _complianceScore = readinessScore;

    const positiveFollowUps = missingEvidence.map((item) => ({
      missingDataPoint: item.missingDataPoint,
      enablesDossierAddition: item.enablesDossierAddition,
      category: 'capacity_contract_risk_asset_cockpit',
    }));

    const blockingFindings = missingEvidence.map((item) => ({
      code: `CCRC_${String(item.missingDataPoint).toUpperCase()}_MISSING`,
      severity: ['utilization', 'bottleneck', 'contract_status', 'legal_status'].includes(
        item.missingDataPoint
      )
        ? 'high'
        : 'medium',
      message: item.enablesDossierAddition,
    }));

    const complianceContext = {
      gridOperatorId: params.gridOperatorId || null,
    };

    const complianceEvidence = {
      utilization: ut,
      bottleneck: bn || null,
      firmCapacityKW:
        typeof params.firmCapacityKW === 'number'
          ? params.firmCapacityKW
          : params.firmCapacityKW
            ? Number(params.firmCapacityKW)
            : null,
      flexibleCapacityKW:
        typeof params.flexibleCapacityKW === 'number'
          ? params.flexibleCapacityKW
          : params.flexibleCapacityKW
            ? Number(params.flexibleCapacityKW)
            : null,
      contractStatus: cs || null,
      legalStatus: ls || null,
      altvereinbarung:
        typeof params.altvereinbarung === 'boolean'
          ? params.altvereinbarung
          : params.altvereinbarung
            ? String(params.altvereinbarung) === 'true'
            : null,
      capex: cx,
      opex:
        typeof params.opex === 'number' ? params.opex : params.opex ? Number(params.opex) : null,
      owner: params.owner || null,
      nextAction: params.nextAction || null,
    };

    const technicalCapacity = {
      utilization: ut,
      bottleneck: bn || null,
      firmCapacityKW: complianceEvidence.firmCapacityKW,
      flexibleCapacityKW: complianceEvidence.flexibleCapacityKW,
    };

    const contractBoundary = {
      status: cs || null,
      legalStatus: ls || null,
      altvereinbarung: complianceEvidence.altvereinbarung,
    };

    const financialImpact = {
      capex: cx,
      opex: complianceEvidence.opex,
      priority: params.priority || null,
    };

    const dossierFacts = [
      `Status: ${status}`,
      `Provided capacity and contract risk evidence: ${evidenceItems.length}/${evidenceSpecs.length}`,
      `Open gaps: ${missingEvidence.length}`,
    ];

    return {
      capacityContractRiskId: `ccrc:${Buffer.from(`${params.gridOperatorId || ''}`)
        .toString('base64url')
        .slice(0, 24)}`,
      capabilityKey: 'capacity_contract_risk_asset_cockpit',
      safety: 'read_only',
      requestContext: complianceContext,
      status,
      readinessScore,
      riskLevel,
      decisionStatus: finalDecisionStatus,
      technicalCapacity,
      contractBoundary,
      financialImpact,
      missingEvidence,
      positiveFollowUps,
      blockingFindings,
      sourceEvidence: {
        sourceRefs,
      },
      sourceRefs,
      sourceActions: {
        inspected: ['dashboard-api.capacityContractRiskAssetCockpitStatus'],
        referenced: [
          'grid-operations.connectionCapacityCheck',
          'grid-operations.capacityUtilization',
          'grid-operations.netzfahrplanGenerate',
          'grid-connection.validate',
          'finance-agent.fnavEconomics',
          'finance-agent.analyze',
          'investment-planning.createPlan',
          'vdmi.dossier',
          'interface-placeholder.requestEvidence',
          'hitl.create',
        ],
        notCalled: [
          'znp.createProject',
          'znp.addLayer0',
          'znp.addAssumption',
          'assets.mutate',
          'datapoint.mutate',
          'hitl.create',
          'vdmi.create',
          'vdmi.mutate',
          'finance-agent.mutate',
          'investment-planning.createPlan',
          'billing.release',
          'settlement.prepareBilling',
          'tariff.mutate',
          'device-control.execute',
          'external.connector.call',
          'personal-agent.execute',
        ],
      },
      validationFindings: blockingFindings,
      dossierEvidence: {
        status,
        readinessScore,
        riskLevel,
        decisionStatus: finalDecisionStatus,
        technicalCapacity,
        contractBoundary,
        financialImpact,
        evidenceItems,
        missingEvidence,
        positiveFollowUps,
        blockingFindings,
        sourceRefs,
        dossierFacts,
      },
    };
  },

  buildImsysTaf2ComplianceStatus(params = {}) {
    const toList = (value) =>
      Array.isArray(value)
        ? value.filter(Boolean)
        : value
          ? String(value)
              .split(',')
              .map((item) => item.trim())
              .filter(Boolean)
          : [];
    const sourceRefs = toList(params.sourceRef);

    const evidenceSpecs = [
      {
        id: 'taf2_obligation',
        label: 'TAF2 Obligation',
        value:
          typeof params.taf2Obligation === 'boolean'
            ? params.taf2Obligation
            : params.taf2Obligation
              ? String(params.taf2Obligation) === 'true'
              : null,
        sourceClass: 'taf2_obligation_verification',
        enablesDossierAddition: 'verify the TAF-2 legal requirement or rollout obligation',
      },
      {
        id: 'target_deadline',
        label: 'Target Deadline',
        value: params.targetDeadline,
        sourceClass: 'taf2_deadline_tracking',
        enablesDossierAddition: 'add the target installation deadline for TAF-2 compliance',
      },
      {
        id: 'tariff_model',
        label: 'Tariff Model',
        value: params.tariffModel,
        sourceClass: 'tariff_model_specification',
        enablesDossierAddition: 'specify the applicable variable or static tariff model',
      },
      {
        id: 'implementation_status',
        label: 'Implementation Status',
        value: params.implementationStatus,
        sourceClass: 'taf2_rollout_milestone',
        enablesDossierAddition: 'add the hardware rollout implementation status',
      },
      {
        id: 'measured_value_access',
        label: 'Measured Value Access',
        value: params.measuredValueAccess,
        sourceClass: 'taf2_access_verification',
        enablesDossierAddition:
          'verify the secure measured value access or data communication route',
      },
      {
        id: 'owner',
        label: 'Accountable Owner',
        value: params.owner,
        sourceClass: 'compliance_responsibility',
        enablesDossierAddition: 'add the accountable owner or process sponsor role',
      },
      {
        id: 'next_action',
        label: 'Next Action',
        value: params.nextAction,
        sourceClass: 'next_compliance_step',
        enablesDossierAddition: 'add the planned next action or mitigation step',
      },
      {
        id: 'source_refs',
        label: 'Source references',
        value: sourceRefs.length > 0,
        displayValue: sourceRefs.join(', '),
        sourceClass: 'source_grounding',
        enablesDossierAddition: 'add citable regulatory source references or grounding evidence',
      },
    ];

    const evidenceItems = evidenceSpecs
      .filter((spec) => spec.value !== undefined && spec.value !== null && spec.value !== false)
      .map((spec) => ({
        id: spec.id,
        label: spec.label,
        value: spec.displayValue ?? spec.value,
        sourceClass: spec.sourceClass,
        evidenceStatus: 'provided',
      }));

    const missingEvidence = evidenceSpecs
      .filter((spec) => spec.value === undefined || spec.value === null || spec.value === false)
      .map((spec) => ({
        missingDataPoint: spec.id,
        label: spec.label,
        sourceClass: spec.sourceClass,
        enablesDossierAddition: spec.enablesDossierAddition,
      }));

    const status = !params.meteringPointId
      ? 'needs_metering_point_id'
      : params.taf2Obligation === undefined || params.taf2Obligation === null
        ? 'needs_taf2_obligation'
        : !params.targetDeadline
          ? 'needs_target_deadline'
          : !params.tariffModel
            ? 'needs_tariff_model'
            : !params.implementationStatus
              ? 'needs_implementation_status'
              : !params.measuredValueAccess
                ? 'needs_measured_value_access'
                : !params.owner
                  ? 'needs_owner'
                  : !params.nextAction
                    ? 'needs_next_action'
                    : sourceRefs.length === 0
                      ? 'needs_source_refs'
                      : 'ready_for_compliance_decision';

    const readinessScore = Number((evidenceItems.length / evidenceSpecs.length).toFixed(2));
    const complianceScore = readinessScore;

    const positiveFollowUps = missingEvidence.map((item) => ({
      missingDataPoint: item.missingDataPoint,
      enablesDossierAddition: item.enablesDossierAddition,
      category: 'imsys_taf2_compliance_status',
    }));

    const blockingFindings = missingEvidence.map((item) => ({
      code: `ITCS_${String(item.missingDataPoint).toUpperCase()}_MISSING`,
      severity: [
        'taf2_obligation',
        'target_deadline',
        'tariff_model',
        'measured_value_access',
      ].includes(item.missingDataPoint)
        ? 'high'
        : 'medium',
      message: item.enablesDossierAddition,
    }));

    const complianceContext = {
      meteringPointId: params.meteringPointId || null,
    };

    const complianceEvidence = {
      taf2Obligation:
        typeof params.taf2Obligation === 'boolean'
          ? params.taf2Obligation
          : params.taf2Obligation
            ? String(params.taf2Obligation) === 'true'
            : null,
      targetDeadline: params.targetDeadline || null,
      tariffModel: params.tariffModel || null,
      implementationStatus: params.implementationStatus || null,
      measuredValueAccess: params.measuredValueAccess || null,
      owner: params.owner || null,
      nextAction: params.nextAction || null,
    };

    const dossierFacts = [
      `Status: ${status}`,
      `Provided iMSys TAF2 compliance evidence: ${evidenceItems.length}/${evidenceSpecs.length}`,
      `Open gaps: ${missingEvidence.length}`,
    ];
    if (params.meteringPointId) dossierFacts.push(`Metering Point ID: ${params.meteringPointId}`);

    return {
      imsysTaf2ComplianceStatusId: `itcs:${Buffer.from(`${params.meteringPointId || ''}`)
        .toString('base64url')
        .slice(0, 24)}`,
      capabilityKey: 'imsys_taf2_compliance_status',
      safety: 'read_only',
      requestContext: complianceContext,
      status,
      readinessScore,
      complianceScore,
      complianceContext,
      complianceEvidence,
      evidenceItems,
      missingEvidence,
      positiveFollowUps,
      blockingFindings,
      sourceEvidence: {
        sourceRefs,
      },
      sourceRefs,
      sourceActions: {
        inspected: ['dashboard-api.imsysTaf2ComplianceStatus'],
        referenced: [
          'edm-messkonzept.evaluateAll',
          'edm-validation.validate',
          'datapoint.health',
          'vdmi.dossier',
          'interface-placeholder.requestEvidence',
          'finance-agent.analyze',
          'hitl.create',
        ],
        notCalled: [
          'hitl.create',
          'vdmi.mutate',
          'finance-agent.mutate',
          'settlement.prepareBilling',
          'grid-operations.executeControl',
          'external.connector.call',
          'personal-agent.execute',
        ],
      },
      validationFindings: blockingFindings,
      dossierEvidence: {
        status,
        readinessScore,
        complianceScore,
        complianceContext,
        complianceEvidence,
        evidenceItems,
        missingEvidence,
        positiveFollowUps,
        blockingFindings,
        sourceRefs,
        dossierFacts,
      },
    };
  },

  buildScheduleManagementGovernanceRoadmapStatus(params = {}) {
    const toList = (value) => {
      if (Array.isArray(value)) return value.filter(Boolean);
      if (value && typeof value === 'string') {
        return value
          .split(',')
          .map((item) => item.trim())
          .filter(Boolean);
      }
      return [];
    };

    const dataObjects = toList(params.dataObjects);
    const systemIntegrations = toList(params.systemIntegrations);
    const roleOwnership = toList(params.roleOwnership);
    const capacityManagementGaps = toList(params.capacityManagementGaps);
    const roadmapItems = toList(params.roadmapItems);
    const decisionMeetings = toList(params.decisionMeetings);
    const sourceRefs = toList(params.sourceRef);

    const evidenceSpecs = [
      {
        id: 'target_state',
        label: 'Ziel-Zustand',
        value: params.targetState,
        sourceClass: 'roadmap_target_state_specification',
        enablesDossierAddition: 'define the target state or roadmap maturity goal',
      },
      {
        id: 'capability_maturity',
        label: 'Faehigkeits-Reifegrad',
        value: params.capabilityMaturity,
        sourceClass: 'roadmap_maturity_assessment',
        enablesDossierAddition:
          'assess the capability maturity level (concept, pilot_ready, operational)',
      },
      {
        id: 'data_objects',
        label: 'Datenobjekte',
        value: dataObjects.length > 0,
        displayValue: dataObjects.join(', '),
        sourceClass: 'data_object_mapping',
        enablesDossierAddition:
          'map required data objects (Anschlussbegehren, Netzfahrplan, Messdaten, etc.)',
      },
      {
        id: 'system_integrations',
        label: 'Systemintegrationen',
        value: systemIntegrations.length > 0,
        displayValue: systemIntegrations.join(', '),
        sourceClass: 'system_integration_definition',
        enablesDossierAddition: 'define connected core systems (EDM, Redispatch, Grid Operations)',
      },
      {
        id: 'role_ownership',
        label: 'Rollenverantwortung',
        value: roleOwnership.length > 0,
        displayValue: roleOwnership.join(', '),
        sourceClass: 'role_ownership_matrix',
        enablesDossierAddition:
          'assign roles and process sponsorship (Assetmanagement, Netzbetrieb, Legal, PMO)',
      },
      {
        id: 'redispatch_boundary',
        label: 'Redispatch-Grenzbereich',
        value: params.redispatchBoundary,
        sourceClass: 'redispatch_boundary_clarification',
        enablesDossierAddition:
          'clarify the Redispatch 2.0 system boundaries and data exchange interfaces',
      },
      {
        id: 'fnav_readiness',
        label: 'fNAV-Bereitschaft',
        value: params.fnavReadiness,
        sourceClass: 'fnav_readiness_validation',
        enablesDossierAddition:
          'validate fNAV/netzfahrplan legal or contract status ready for operational integration',
      },
      {
        id: 'capacity_management_gaps',
        label: 'Kapazitaetsmanagement-Luecken',
        value: capacityManagementGaps.length > 0,
        displayValue: capacityManagementGaps.join(', '),
        sourceClass: 'capacity_gap_identification',
        enablesDossierAddition:
          'identify capacity bottlenecks, flexibility constraints or tariff gaps',
      },
      {
        id: 'roadmap_items',
        label: 'Fahrplan-Elemente',
        value: roadmapItems.length > 0,
        displayValue: roadmapItems.join(', '),
        sourceClass: 'roadmap_backlog_items',
        enablesDossierAddition: 'list planned roadmap milestones and implementation steps',
      },
      {
        id: 'decision_meetings',
        label: 'Entscheidungsgremien',
        value: decisionMeetings.length > 0,
        displayValue: decisionMeetings.join(', '),
        sourceClass: 'steering_committee_windows',
        enablesDossierAddition: 'specify decision meetings and steering committee windows',
      },
      {
        id: 'owner',
        label: 'Prozessverantwortlicher Owner',
        value: params.owner,
        sourceClass: 'roadmap_responsibility',
        enablesDossierAddition: 'assign an accountable owner role or sponsor for the roadmap',
      },
      {
        id: 'next_action',
        label: 'Naechste Massnahme',
        value: params.nextAction,
        sourceClass: 'next_roadmap_action',
        enablesDossierAddition: 'define the immediate next action step',
      },
      {
        id: 'source_refs',
        label: 'Quellenreferenzen',
        value: sourceRefs.length > 0,
        displayValue: sourceRefs.join(', '),
        sourceClass: 'source_grounding',
        enablesDossierAddition: 'add regulatory sources or documentation reference credentials',
      },
    ];

    const evidenceItems = evidenceSpecs
      .filter((spec) => spec.value !== undefined && spec.value !== null && spec.value !== false)
      .map((spec) => ({
        id: spec.id,
        label: spec.label,
        value: spec.displayValue ?? spec.value,
        sourceClass: spec.sourceClass,
        evidenceStatus: 'provided',
      }));

    const missingEvidence = evidenceSpecs
      .filter((spec) => spec.value === undefined || spec.value === null || spec.value === false)
      .map((spec) => ({
        missingDataPoint: spec.id,
        label: spec.label,
        sourceClass: spec.sourceClass,
        enablesDossierAddition: spec.enablesDossierAddition,
      }));

    const status = !params.targetState
      ? 'needs_target_state'
      : !params.capabilityMaturity
        ? 'needs_capability_maturity'
        : dataObjects.length === 0
          ? 'needs_data_objects'
          : systemIntegrations.length === 0
            ? 'needs_system_integrations'
            : roleOwnership.length === 0
              ? 'needs_role_ownership'
              : !params.redispatchBoundary
                ? 'needs_redispatch_boundary'
                : !params.fnavReadiness
                  ? 'needs_fnav_readiness'
                  : capacityManagementGaps.length === 0
                    ? 'needs_capacity_management_gaps'
                    : roadmapItems.length === 0
                      ? 'needs_roadmap_items'
                      : decisionMeetings.length === 0
                        ? 'needs_decision_meetings'
                        : !params.owner
                          ? 'needs_owner'
                          : !params.nextAction
                            ? 'needs_next_action'
                            : sourceRefs.length === 0
                              ? 'needs_source_refs'
                              : 'operational';

    const readinessScore = Number((evidenceItems.length / evidenceSpecs.length).toFixed(2));
    const complianceScore = readinessScore;

    const positiveFollowUps = missingEvidence.map((item) => ({
      missingDataPoint: item.missingDataPoint,
      enablesDossierAddition: item.enablesDossierAddition,
      category: 'schedule_management_governance_roadmap',
    }));

    const blockingFindings = missingEvidence.map((item) => ({
      code: `SMGR_${String(item.missingDataPoint).toUpperCase()}_MISSING`,
      severity: ['target_state', 'capability_maturity', 'owner', 'next_action'].includes(
        item.missingDataPoint
      )
        ? 'high'
        : 'medium',
      message: item.enablesDossierAddition,
    }));

    const complianceContext = {
      meteringPointId: params.meteringPointId || null,
    };

    const complianceEvidence = {
      targetState: params.targetState || null,
      capabilityMaturity: params.capabilityMaturity || null,
      dataObjects,
      systemIntegrations,
      roleOwnership,
      redispatchBoundary: params.redispatchBoundary || null,
      fnavReadiness: params.fnavReadiness || null,
      capacityManagementGaps,
      roadmapItems,
      decisionMeetings,
      owner: params.owner || null,
      nextAction: params.nextAction || null,
    };

    const dossierFacts = [
      `Status: ${status}`,
      `Provided Fahrplanmanagement governance roadmap evidence: ${evidenceItems.length}/${evidenceSpecs.length}`,
      `Open gaps: ${missingEvidence.length}`,
    ];
    if (params.meteringPointId) dossierFacts.push(`Metering Point ID: ${params.meteringPointId}`);

    return {
      scheduleManagementGovernanceRoadmapStatusId: `smgr:${Buffer.from(
        `${params.meteringPointId || ''}`
      )
        .toString('base64url')
        .slice(0, 24)}`,
      capabilityKey: 'schedule_management_governance_roadmap',
      safety: 'read_only',
      requestContext: complianceContext,
      status,
      readinessScore,
      complianceScore,
      complianceContext,
      complianceEvidence,
      evidenceItems,
      missingEvidence,
      positiveFollowUps,
      blockingFindings,
      sourceEvidence: {
        sourceRefs,
      },
      sourceRefs,
      sourceActions: {
        inspected: ['dashboard-api.scheduleManagementGovernanceRoadmapStatus'],
        referenced: [
          'grid-operations.netzfahrplanGenerate',
          'grid-connection.fnavValidate',
          'redispatch-expost.audit',
          'edm-validation.validate',
          'datapoint.health',
          'vdmi.dossier',
          'interface-placeholder.requestEvidence',
        ],
        notCalled: [
          'hitl.create',
          'grid-operations.executeControl',
          'external.connector.call',
          'personal-agent.execute',
          'finance-agent.mutate',
          'settlement.prepareBilling',
        ],
      },
      validationFindings: blockingFindings,
      dossierEvidence: {
        status,
        readinessScore,
        complianceScore,
        complianceContext,
        complianceEvidence,
        evidenceItems,
        missingEvidence,
        positiveFollowUps,
        blockingFindings,
        sourceRefs,
        dossierFacts,
      },
    };
  },

  buildGasTransformationDependencyMapStatus(params = {}) {
    const toList = (value) => {
      if (Array.isArray(value)) return value.filter(Boolean);
      if (value && typeof value === 'string') {
        return value
          .split(',')
          .map((item) => item.trim())
          .filter(Boolean);
      }
      return [];
    };

    const nodes = toList(params.nodes);
    const dependencies = toList(params.dependencies);
    const dataQualityGaps = toList(params.dataQualityGaps);
    const investmentPaths = toList(params.investmentPaths);
    const decommissionRepurposePaths = toList(params.decommissionRepurposePaths);
    const customerGroups = toList(params.customerGroups);
    const sourceRefs = toList(params.sourceRef);

    const evidenceSpecs = [
      {
        id: 'division',
        label: 'Sparte',
        value: params.division,
        sourceClass: 'division_specification',
        enablesDossierAddition: 'define the division or sector context (e.g. Gas, Heat)',
      },
      {
        id: 'nodes',
        label: 'Transformationsknoten',
        value: nodes.length > 0,
        displayValue: nodes.join(', '),
        sourceClass: 'transformation_nodes_specification',
        enablesDossierAddition:
          'specify the transformation nodes or options (e.g. h2_ready, heat_network, decommission, repurpose)',
      },
      {
        id: 'dependencies',
        label: 'Abhaengigkeiten',
        value: dependencies.length > 0,
        displayValue: dependencies.join(', '),
        sourceClass: 'transformation_dependencies_specification',
        enablesDossierAddition:
          'define the dependencies or blockages between transformation options',
      },
      {
        id: 'data_quality_gaps',
        label: 'Datenqualitaets-Luecken',
        value: dataQualityGaps.length > 0,
        displayValue: dataQualityGaps.join(', '),
        sourceClass: 'data_quality_gaps_identification',
        enablesDossierAddition: 'identify data quality gaps for transformation planning',
      },
      {
        id: 'investment_paths',
        label: 'Investitionspfade',
        value: investmentPaths.length > 0,
        displayValue: investmentPaths.join(', '),
        sourceClass: 'investment_paths_definition',
        enablesDossierAddition: 'map required investment paths or budgets',
      },
      {
        id: 'decommission_repurpose_paths',
        label: 'Stilllegungs- und Umwidmungspfade',
        value: decommissionRepurposePaths.length > 0,
        displayValue: decommissionRepurposePaths.join(', '),
        sourceClass: 'decommission_repurpose_paths_definition',
        enablesDossierAddition: 'specify the decommission, renewal or repurposing paths',
      },
      {
        id: 'customer_groups',
        label: 'Kundengruppen',
        value: customerGroups.length > 0,
        displayValue: customerGroups.join(', '),
        sourceClass: 'customer_groups_mapping',
        enablesDossierAddition: 'map remaining customer groups or sectors',
      },
      {
        id: 'owner',
        label: 'Prozessverantwortlicher Owner',
        value: params.owner,
        sourceClass: 'transformation_responsibility',
        enablesDossierAddition: 'assign an accountable owner role or process sponsor',
      },
      {
        id: 'next_action',
        label: 'Naechste Massnahme',
        value: params.nextAction,
        sourceClass: 'next_transformation_action',
        enablesDossierAddition: 'define the immediate next transformation step or decision',
      },
      {
        id: 'source_refs',
        label: 'Quellenreferenzen',
        value: sourceRefs.length > 0,
        displayValue: sourceRefs.join(', '),
        sourceClass: 'source_grounding',
        enablesDossierAddition: 'add regulatory sources or documentation reference credentials',
      },
    ];

    const evidenceItems = evidenceSpecs
      .filter((spec) => spec.value !== undefined && spec.value !== null && spec.value !== false)
      .map((spec) => ({
        id: spec.id,
        label: spec.label,
        value: spec.displayValue ?? spec.value,
        sourceClass: spec.sourceClass,
        evidenceStatus: 'provided',
      }));

    const missingEvidence = evidenceSpecs
      .filter((spec) => spec.value === undefined || spec.value === null || spec.value === false)
      .map((spec) => ({
        missingDataPoint: spec.id,
        label: spec.label,
        sourceClass: spec.sourceClass,
        enablesDossierAddition: spec.enablesDossierAddition,
      }));

    const status = !params.division
      ? 'needs_division'
      : nodes.length === 0
        ? 'needs_nodes'
        : dependencies.length === 0
          ? 'needs_dependencies'
          : dataQualityGaps.length === 0
            ? 'needs_data_quality_gaps'
            : investmentPaths.length === 0
              ? 'needs_investment_paths'
              : decommissionRepurposePaths.length === 0
                ? 'needs_decommission_repurpose_paths'
                : customerGroups.length === 0
                  ? 'needs_customer_groups'
                  : !params.owner
                    ? 'needs_owner'
                    : !params.nextAction
                      ? 'needs_next_action'
                      : sourceRefs.length === 0
                        ? 'needs_source_refs'
                        : 'ready_for_transformation_decision';

    const readinessScore = Number((evidenceItems.length / evidenceSpecs.length).toFixed(2));
    const complianceScore = readinessScore;

    const positiveFollowUps = missingEvidence.map((item) => ({
      missingDataPoint: item.missingDataPoint,
      enablesDossierAddition: item.enablesDossierAddition,
      category: 'gas_transformation_dependency_map',
    }));

    const blockingFindings = missingEvidence.map((item) => ({
      code: `GTDM_${String(item.missingDataPoint).toUpperCase()}_MISSING`,
      severity: ['division', 'nodes', 'owner', 'next_action'].includes(item.missingDataPoint)
        ? 'high'
        : 'medium',
      message: item.enablesDossierAddition,
    }));

    const complianceContext = {
      projectId: params.projectId || null,
    };

    const complianceEvidence = {
      division: params.division || null,
      nodes,
      dependencies,
      dataQualityGaps,
      investmentPaths,
      decommissionRepurposePaths,
      customerGroups,
      owner: params.owner || null,
      nextAction: params.nextAction || null,
    };

    const dossierFacts = [
      `Status: ${status}`,
      `Provided Gasnetztransformation dependency map evidence: ${evidenceItems.length}/${evidenceSpecs.length}`,
      `Open gaps: ${missingEvidence.length}`,
    ];
    if (params.projectId) dossierFacts.push(`Project ID: ${params.projectId}`);

    return {
      gasTransformationDependencyMapStatusId: `gtdm:${Buffer.from(`${params.projectId || ''}`)
        .toString('base64url')
        .slice(0, 24)}`,
      capabilityKey: 'gas_transformation_dependency_map',
      safety: 'read_only',
      requestContext: complianceContext,
      status,
      readinessScore,
      complianceScore,
      complianceContext,
      complianceEvidence,
      evidenceItems,
      missingEvidence,
      positiveFollowUps,
      blockingFindings,
      sourceEvidence: {
        sourceRefs,
      },
      sourceRefs,
      sourceActions: {
        inspected: ['dashboard-api.gasTransformationDependencyMapStatus'],
        referenced: [
          'znp.assessPortfolio',
          'znp.strategicPrompts',
          'assets.effective',
          'datapoint.health',
          'vdmi.dossier',
          'interface-placeholder.requestEvidence',
        ],
        notCalled: [
          'hitl.create',
          'znp.addAssumption',
          'assets.mutate',
          'datapoint.mutate',
          'finance-agent.mutate',
          'investment-planning.createPlan',
          'vdmi.mutate',
          'personal-agent.execute',
          'external.connector.call',
        ],
      },
      validationFindings: blockingFindings,
      dossierEvidence: {
        status,
        readinessScore,
        complianceScore,
        complianceContext,
        complianceEvidence,
        evidenceItems,
        missingEvidence,
        positiveFollowUps,
        blockingFindings,
        sourceRefs,
        dossierFacts,
      },
    };
  },

  buildGasTransformationDataroomStatus(params = {}) {
    const toList = (value) => {
      if (Array.isArray(value)) return value.filter(Boolean).map(String);
      if (value && typeof value === 'string') {
        return value
          .split(',')
          .map((item) => item.trim())
          .filter(Boolean);
      }
      return [];
    };

    const transformationPaths = toList(params.transformationPath);
    const scenarioReferences = toList(params.scenarioReference);
    const sourceRefs = toList(params.sourceRefs);
    const lifecycleStatus = params.lifecycleStatus || 'active_contract_reference_only';
    const namespaceContracts = [
      'tenant:<tenantId>:gas_transformation_rooms',
      'tenant:<tenantId>:gas_transformation_paths',
      'tenant:<tenantId>:gas_transformation_evidence',
      'tenant:<tenantId>:gas_transformation_decisions',
      'tenant:<tenantId>:gas_transformation_roadmap',
    ];

    const evidenceSpecs = [
      {
        id: 'room_identity',
        label: 'Datenraum-/Mandatsidentitaet',
        value: params.roomId && (params.mandateId || params.profile),
        displayValue: [params.roomId, params.mandateId, params.profile].filter(Boolean).join(' / '),
        sourceClass: 'data_room_identity',
        enablesDossierAddition:
          'adds the concrete data-room, mandate and network-profile boundary to the dossier.',
      },
      {
        id: 'transformation_path',
        label: 'Transformationspfad',
        value: transformationPaths.length > 0,
        displayValue: transformationPaths.join(', '),
        sourceClass: 'transformation_path_reference',
        enablesDossierAddition:
          'adds H2 conversion, decommissioning, continuation or mixed transformation options.',
      },
      {
        id: 'scenario_reference',
        label: 'Szenarioreferenz',
        value: scenarioReferences.length > 0,
        displayValue: scenarioReferences.join(', '),
        sourceClass: 'scenario_version_reference',
        enablesDossierAddition:
          'adds traceable EOG/KANU/Fotojahr scenario context without persisting a scenario engine.',
      },
      {
        id: 'evidence_register',
        label: 'Evidence Register',
        value: params.evidenceStatus,
        sourceClass: 'evidence_register_status',
        enablesDossierAddition:
          'adds source-backed evidence completeness and carry-forward requirements.',
      },
      {
        id: 'decision_log',
        label: 'Decision Log',
        value: params.decisionStatus,
        sourceClass: 'decision_log_status',
        enablesDossierAddition:
          'adds Gremium, owner and decision-boundary notes without executing approvals.',
      },
      {
        id: 'roadmap_snapshot',
        label: 'Roadmap-/Review-Snapshot',
        value: params.roadmapStatus && params.reviewDate,
        displayValue: [params.roadmapStatus, params.reviewDate].filter(Boolean).join(' / '),
        sourceClass: 'roadmap_review_snapshot',
        enablesDossierAddition:
          'adds a point-in-time roadmap and review snapshot for later claim revalidation.',
      },
      {
        id: 'owner_reviewer',
        label: 'Owner/Reviewer',
        value: params.owner || params.reviewer,
        displayValue: [params.owner, params.reviewer].filter(Boolean).join(' / '),
        sourceClass: 'data_room_accountability',
        enablesDossierAddition: 'adds accountable data-room ownership and review responsibility.',
      },
      {
        id: 'source_refs',
        label: 'Quellenreferenzen',
        value: sourceRefs.length > 0,
        displayValue: sourceRefs.join(', '),
        sourceClass: 'source_grounding',
        enablesDossierAddition:
          'adds source references for review notes without copying raw RAG/vector payloads.',
      },
    ];

    const evidenceItems = evidenceSpecs
      .filter((spec) => spec.value !== undefined && spec.value !== null && spec.value !== false)
      .map((spec) => ({
        id: spec.id,
        label: spec.label,
        value: spec.displayValue ?? spec.value,
        sourceClass: spec.sourceClass,
        evidenceStatus: 'provided',
      }));

    const missingEvidence = evidenceSpecs
      .filter((spec) => spec.value === undefined || spec.value === null || spec.value === false)
      .map((spec) => ({
        missingDataPoint: spec.id,
        label: spec.label,
        sourceClass: spec.sourceClass,
        enablesDossierAddition: spec.enablesDossierAddition,
      }));

    const status =
      !params.roomId || (!params.mandateId && !params.profile)
        ? 'needs_room_profile'
        : transformationPaths.length === 0
          ? 'needs_transformation_path'
          : scenarioReferences.length === 0
            ? 'needs_scenario_reference'
            : !params.evidenceStatus
              ? 'needs_evidence_register'
              : !params.decisionStatus
                ? 'needs_decision_log'
                : !params.roadmapStatus || !params.reviewDate
                  ? 'needs_review_snapshot'
                  : !params.owner && !params.reviewer
                    ? 'needs_owner_reviewer'
                    : sourceRefs.length === 0
                      ? 'needs_source_refs'
                      : 'ready_for_dataroom_review';

    const readinessScore = Number((evidenceItems.length / evidenceSpecs.length).toFixed(2));
    const positiveFollowUps = missingEvidence.map((item) => ({
      missingDataPoint: item.missingDataPoint,
      enablesDossierAddition: item.enablesDossierAddition,
      category: 'gas_transformation_dataroom_status',
    }));
    const blockingFindings = missingEvidence.map((item) => ({
      code: `GTDR_${String(item.missingDataPoint).toUpperCase()}_MISSING`,
      severity: ['room_identity', 'transformation_path', 'scenario_reference'].includes(
        item.missingDataPoint
      )
        ? 'high'
        : 'medium',
      message: item.enablesDossierAddition,
    }));
    const dataRoomProfile = {
      roomId: params.roomId || null,
      mandateId: params.mandateId || null,
      profile: params.profile || null,
      lifecycleStatus,
      tenantIsolation: 'tenant_namespace_only_first_slice',
      roomScopedObjectsRequired: true,
    };
    const reviewSnapshot = {
      reviewDate: params.reviewDate || null,
      roadmapStatus: params.roadmapStatus || null,
      evidenceStatus: params.evidenceStatus || null,
      decisionStatus: params.decisionStatus || null,
      trigger: 'manual_or_api_referenced_point_in_time_status',
      generatedExport: false,
    };
    const contractMetadata = {
      namespaceContracts,
      schemaObjects: [
        'network_profile',
        'transformation_path',
        'asset_group',
        'scenario_version',
        'evidence_item',
        'decision_log',
        'roadmap_item',
        'review_snapshot',
      ],
      scenarioVersionOwnership: 'data_room_object_references_eog_output',
      tenantKnowledgePromotionRequired: missingEvidence.length > 0,
      persistenceImplemented: false,
      aclExportArchiveImplemented: false,
      ragIngestionImplemented: false,
    };
    const sourceActions = {
      inspected: ['dashboard-api.gasTransformationDataroomStatus'],
      referenced: [
        'eog-calculator.evaluate',
        'gasnetz-waermeplanung.reconcile',
        'gas_decommissioning_roadmap_status',
        'gas_network_decision_chain',
        'assets.effective',
        'knowledge-rag.search',
        'object-store.query',
        'vdmi.dossier',
        'interface-placeholder.requestEvidence',
      ],
      notCalled: [
        'object-store.create',
        'object-store.update',
        'knowledge-rag.ingest',
        'tenant-knowledge.promote',
        'acl.grant',
        'archive.export',
        'review-snapshot.create',
        'eog-calculator.persistScenario',
        'investment.approve',
        'gas-transformation.executeDecommissioning',
        'h2-conversion.execute',
        'gremium.approve',
        'hitl.create',
        'workflow.execute',
        'mail.send',
        'external.connector.call',
        'mako.dispatch',
        'settlement.prepareBilling',
        'billing.release',
        'tariff.mutate',
        'device-control.execute',
        'personal-agent.execute',
      ],
    };
    const dossierFacts = [
      `Gas Transformation Dataroom Status: ${status}`,
      `Room: ${dataRoomProfile.roomId || 'missing'}`,
      `Mandate/Profile: ${dataRoomProfile.mandateId || dataRoomProfile.profile || 'missing'}`,
      `Transformation Paths: ${transformationPaths.join(', ') || 'missing'}`,
      `Scenario References: ${scenarioReferences.join(', ') || 'missing'}`,
      `Evidence Status: ${params.evidenceStatus || 'missing'}`,
      `Decision Status: ${params.decisionStatus || 'missing'}`,
      `Roadmap Review: ${params.roadmapStatus || 'missing'} / ${params.reviewDate || 'missing'}`,
      `Open gaps: ${missingEvidence.length}`,
    ];

    return {
      gasTransformationDataroomStatusId: `gtdr:${Buffer.from(`${params.roomId || ''}`)
        .toString('base64url')
        .slice(0, 24)}`,
      capabilityKey: 'gas_transformation_dataroom_status',
      safety: 'read_only',
      status,
      readinessScore,
      complianceScore: readinessScore,
      requestContext: {
        roomId: params.roomId || null,
        mandateId: params.mandateId || null,
      },
      dataRoomProfile,
      transformationPaths,
      scenarioReferences,
      reviewSnapshot,
      contractMetadata,
      evidenceItems,
      missingEvidence,
      positiveFollowUps,
      blockingFindings,
      sourceEvidence: { sourceRefs },
      sourceRefs,
      sourceActions,
      validationFindings: blockingFindings,
      dossierEvidence: {
        status,
        readinessScore,
        dataRoomProfile,
        transformationPaths,
        scenarioReferences,
        reviewSnapshot,
        contractMetadata,
        evidenceItems,
        missingEvidence,
        positiveFollowUps,
        blockingFindings,
        sourceRefs,
        sourceActions: { notCalled: sourceActions.notCalled },
        dossierFacts,
      },
    };
  },

  buildGridConnectionTransformationGateStatus(params = {}) {
    const toList = (value) => {
      if (Array.isArray(value)) return value.filter(Boolean);
      if (value && typeof value === 'string') {
        return value
          .split(',')
          .map((item) => item.trim())
          .filter(Boolean);
      }
      return [];
    };

    const sourceRefs = toList(params.sourceRef);

    const evidenceSpecs = [
      {
        id: 'division',
        label: 'Sparte',
        value: params.division,
        sourceClass: 'division_specification',
        enablesDossierAddition:
          'define the division or sector context (e.g. Gas, Electricity, Heat)',
      },
      {
        id: 'transformation_option',
        label: 'Transformationsoption',
        value: params.transformationOption,
        sourceClass: 'transformation_option_specification',
        enablesDossierAddition:
          'specify the transformation option or scenario (e.g. h2_ready, electrification, hybrid, decommission)',
      },
      {
        id: 'data_quality_status',
        label: 'Datenqualitaetsstatus',
        value: params.dataQualityStatus,
        sourceClass: 'data_quality_evaluation',
        enablesDossierAddition:
          'verify data quality status for grid connection transformation (e.g. verified, incomplete, missing)',
      },
      {
        id: 'investment_path',
        label: 'Investitionspfad',
        value: params.investmentPath,
        sourceClass: 'investment_path_identification',
        enablesDossierAddition:
          'identify required investment path (e.g. capex_approved, budget_needed)',
      },
      {
        id: 'decommission_path',
        label: 'Stilllegungspfad',
        value: params.decommissionPath,
        sourceClass: 'decommission_path_specification',
        enablesDossierAddition:
          'define decommission or repurpose path (e.g. 2035_shut_down, repurpose)',
      },
      {
        id: 'owner',
        label: 'Owner',
        value: params.owner,
        sourceClass: 'responsibility_assignment',
        enablesDossierAddition:
          'assign an accountable owner role or process sponsor (e.g. Netznutzung, Assetmanagement)',
      },
      {
        id: 'next_action',
        label: 'Next Action',
        value: params.nextAction,
        sourceClass: 'next_decision_action',
        enablesDossierAddition: 'define immediate next action or decision step',
      },
      {
        id: 'source_refs',
        label: 'Quellenreferenzen',
        value: sourceRefs.length > 0,
        displayValue: sourceRefs.join(', '),
        sourceClass: 'source_grounding',
        enablesDossierAddition: 'add regulatory sources or documentation reference credentials',
      },
    ];

    const evidenceItems = evidenceSpecs
      .filter((spec) => spec.value !== undefined && spec.value !== null && spec.value !== false)
      .map((spec) => ({
        id: spec.id,
        label: spec.label,
        value: spec.displayValue ?? spec.value,
        sourceClass: spec.sourceClass,
        evidenceStatus: 'provided',
      }));

    const missingEvidence = evidenceSpecs
      .filter((spec) => spec.value === undefined || spec.value === null || spec.value === false)
      .map((spec) => ({
        missingDataPoint: spec.id,
        label: spec.label,
        sourceClass: spec.sourceClass,
        enablesDossierAddition: spec.enablesDossierAddition,
      }));

    const status = !params.division
      ? 'needs_division'
      : !params.transformationOption
        ? 'needs_transformation_option'
        : !params.dataQualityStatus
          ? 'needs_data_quality_status'
          : !params.investmentPath
            ? 'needs_investment_path'
            : !params.decommissionPath
              ? 'needs_decommission_path'
              : !params.owner
                ? 'needs_owner'
                : !params.nextAction
                  ? 'needs_next_action'
                  : sourceRefs.length === 0
                    ? 'needs_source_refs'
                    : 'ready_for_transformation_decision';

    const readinessScore = Number((evidenceItems.length / evidenceSpecs.length).toFixed(2));
    const complianceScore = readinessScore;

    // Map to the requested gateStatus: invest|repurpose|decommission|needs_evidence|needs_governance|monitor
    let gateStatus = 'needs_evidence';
    if (status === 'ready_for_transformation_decision') {
      const option = String(params.transformationOption).toLowerCase();
      const next = String(params.nextAction).toLowerCase();
      if (
        option.includes('decommission') ||
        option.includes('stilllegung') ||
        option.includes('shut_down')
      ) {
        gateStatus = 'decommission';
      } else if (
        option.includes('repurpose') ||
        option.includes('umwidmung') ||
        option.includes('h2_ready')
      ) {
        gateStatus = 'repurpose';
      } else if (
        option.includes('invest') ||
        option.includes('electrification') ||
        option.includes('ausbau')
      ) {
        gateStatus = 'invest';
      } else if (
        next.includes('governance') ||
        next.includes('freigabe') ||
        next.includes('entscheidung')
      ) {
        gateStatus = 'needs_governance';
      } else {
        gateStatus = 'monitor';
      }
    } else {
      // If not fully decision ready, it needs evidence
      gateStatus = 'needs_evidence';
    }

    const positiveFollowUps = missingEvidence.map((item) => ({
      missingDataPoint: item.missingDataPoint,
      enablesDossierAddition: item.enablesDossierAddition,
      category: 'grid_connection_transformation_gate',
    }));

    const blockingFindings = missingEvidence.map((item) => ({
      code: `GCTG_${String(item.missingDataPoint).toUpperCase()}_MISSING`,
      severity: ['division', 'transformation_option', 'owner', 'next_action'].includes(
        item.missingDataPoint
      )
        ? 'high'
        : 'medium',
      message: item.enablesDossierAddition,
    }));

    const complianceContext = {
      meteringPointId: params.meteringPointId || null,
    };

    const complianceEvidence = {
      division: params.division || null,
      transformationOption: params.transformationOption || null,
      dataQualityStatus: params.dataQualityStatus || null,
      investmentPath: params.investmentPath || null,
      decommissionPath: params.decommissionPath || null,
      owner: params.owner || null,
      nextAction: params.nextAction || null,
    };

    const dossierFacts = [
      `Status: ${status}`,
      `Gate Status: ${gateStatus}`,
      `Provided Netzanschlusspunkt Transformations Gate evidence: ${evidenceItems.length}/${evidenceSpecs.length}`,
      `Open gaps: ${missingEvidence.length}`,
    ];
    if (params.meteringPointId) dossierFacts.push(`Metering Point ID: ${params.meteringPointId}`);

    return {
      gridConnectionTransformationGateStatusId: `gctg:${Buffer.from(
        `${params.meteringPointId || ''}`
      )
        .toString('base64url')
        .slice(0, 24)}`,
      capabilityKey: 'grid_connection_transformation_gate',
      safety: 'read_only',
      requestContext: complianceContext,
      status,
      gateStatus,
      readinessScore,
      complianceScore,
      complianceContext,
      complianceEvidence,
      evidenceItems,
      missingEvidence,
      positiveFollowUps,
      blockingFindings,
      sourceEvidence: {
        sourceRefs,
      },
      sourceRefs,
      sourceActions: {
        inspected: ['dashboard-api.gridConnectionTransformationGateStatus'],
        referenced: [
          'mastr-quality.audit',
          'grid-connection.validate',
          'grid-operations.netzfahrplanGenerate',
          'znp.assessPortfolio',
          'assets.effective',
          'vdmi.dossier',
          'interface-placeholder.requestEvidence',
        ],
        notCalled: [
          'hitl.create',
          'assets.mutate',
          'datapoint.mutate',
          'finance-agent.mutate',
          'investment-planning.createPlan',
          'vdmi.mutate',
          'personal-agent.execute',
          'external.connector.call',
        ],
      },
      validationFindings: blockingFindings,
      dossierEvidence: {
        status,
        gateStatus,
        readinessScore,
        complianceScore,
        complianceContext,
        complianceEvidence,
        evidenceItems,
        missingEvidence,
        positiveFollowUps,
        blockingFindings,
        sourceRefs,
        dossierFacts,
      },
    };
  },

  buildHeatAssetTariffSteeringStatus(params = {}) {
    const toList = (value) => {
      if (Array.isArray(value)) return value.filter(Boolean);
      if (value && typeof value === 'string') {
        return value
          .split(',')
          .map((item) => item.trim())
          .filter(Boolean);
      }
      return [];
    };

    const sourceRefs = toList(params.sourceRef);

    const evidenceSpecs = [
      {
        id: 'division',
        label: 'Sparte',
        value: params.division,
        sourceClass: 'division_specification',
        enablesDossierAddition:
          'define the division or sector context (e.g. Gas, Electricity, Heat)',
      },
      {
        id: 'technical_measures',
        label: 'Technische Massnahmen',
        value: params.technicalMeasures,
        sourceClass: 'technical_measures_evaluation',
        enablesDossierAddition:
          'verify technical measures status for district heating (e.g. planned, in_progress, completed)',
      },
      {
        id: 'tariff_impact_status',
        label: 'Tarifwirkung',
        value: params.tariffImpactStatus,
        sourceClass: 'tariff_impact_evaluation',
        enablesDossierAddition:
          'verify tariff and pricing impact status (e.g. calculated, pending, high_risk)',
      },
      {
        id: 'regulatory_uncertainty',
        label: 'Regulatorische Unsicherheit',
        value: params.regulatoryUncertainty,
        sourceClass: 'regulatory_uncertainty_evaluation',
        enablesDossierAddition:
          'verify Totex/regulatory or recognition risk status (e.g. low_risk, transient, high_risk)',
      },
      {
        id: 'funding_status',
        label: 'Foerderstatus',
        value: params.fundingStatus,
        sourceClass: 'funding_evaluation',
        enablesDossierAddition:
          'verify subsidies and funding status (e.g. requested, approved, none)',
      },
      {
        id: 'customer_impact',
        label: 'Kundenauswirkung',
        value: params.customerImpact,
        sourceClass: 'customer_impact_evaluation',
        enablesDossierAddition:
          'verify customer connection obligation and cost impact (e.g. positive, neutral, negative)',
      },
      {
        id: 'investment_priority',
        label: 'Investment Priority',
        value: params.investmentPriority,
        sourceClass: 'investment_priority_evaluation',
        enablesDossierAddition:
          'verify investment priority and readiness score (e.g. high, medium, low)',
      },
      {
        id: 'owner',
        label: 'Owner',
        value: params.owner,
        sourceClass: 'responsibility_assignment',
        enablesDossierAddition:
          'assign an accountable owner role or process sponsor (e.g. Assetmanagement Fernwärme)',
      },
      {
        id: 'next_decision_gate',
        label: 'Next Decision Gate',
        value: params.nextDecisionGate,
        sourceClass: 'next_decision_action',
        enablesDossierAddition:
          'define immediate next decision gate (e.g. Investment Committee Window Q3)',
      },
      {
        id: 'blocked_follow_up_action',
        label: 'Blocked Follow-Up Action',
        value: params.blockedFollowUpAction,
        sourceClass: 'blocked_follow_up_action',
        enablesDossierAddition:
          'identify any blocked follow-up action (e.g. investment-planning.createPlan)',
      },
      {
        id: 'source_refs',
        label: 'Quellenreferenzen',
        value: sourceRefs.length > 0,
        displayValue: sourceRefs.join(', '),
        sourceClass: 'source_grounding',
        enablesDossierAddition: 'add regulatory sources or documentation reference credentials',
      },
    ];

    const evidenceItems = evidenceSpecs
      .filter((spec) => spec.value !== undefined && spec.value !== null && spec.value !== false)
      .map((spec) => ({
        id: spec.id,
        label: spec.label,
        value: spec.displayValue ?? spec.value,
        sourceClass: spec.sourceClass,
        evidenceStatus: 'provided',
      }));

    const missingEvidence = evidenceSpecs
      .filter((spec) => spec.value === undefined || spec.value === null || spec.value === false)
      .map((spec) => ({
        missingDataPoint: spec.id,
        label: spec.label,
        sourceClass: spec.sourceClass,
        enablesDossierAddition: spec.enablesDossierAddition,
      }));

    const status = !params.division
      ? 'needs_division'
      : !params.technicalMeasures
        ? 'needs_technical_measures'
        : !params.tariffImpactStatus
          ? 'needs_tariff_impact_status'
          : !params.regulatoryUncertainty
            ? 'needs_regulatory_uncertainty'
            : !params.fundingStatus
              ? 'needs_funding_status'
              : !params.customerImpact
                ? 'needs_customer_impact'
                : !params.investmentPriority
                  ? 'needs_investment_priority'
                  : !params.owner
                    ? 'needs_owner'
                    : !params.nextDecisionGate
                      ? 'needs_next_decision_gate'
                      : !params.blockedFollowUpAction
                        ? 'needs_blocked_follow_up_action'
                        : sourceRefs.length === 0
                          ? 'needs_source_refs'
                          : 'ready_for_steering_decision';

    const readinessScore = Number((evidenceItems.length / evidenceSpecs.length).toFixed(2));
    const complianceScore = readinessScore;

    let gateStatus = 'needs_evidence';
    if (status === 'ready_for_steering_decision') {
      const priority = String(params.investmentPriority).toLowerCase();
      if (priority.includes('high') || priority.includes('hoch')) {
        gateStatus = 'invest';
      } else if (priority.includes('low') || priority.includes('niedrig')) {
        gateStatus = 'monitor';
      } else {
        gateStatus = 'needs_governance';
      }
    } else {
      gateStatus = 'needs_evidence';
    }

    const positiveFollowUps = missingEvidence.map((item) => ({
      missingDataPoint: item.missingDataPoint,
      enablesDossierAddition: item.enablesDossierAddition,
      category: 'heat_asset_tariff_steering',
    }));

    const blockingFindings = missingEvidence.map((item) => ({
      code: `HATS_${String(item.missingDataPoint).toUpperCase()}_MISSING`,
      severity: ['division', 'technical_measures', 'owner', 'next_decision_gate'].includes(
        item.missingDataPoint
      )
        ? 'high'
        : 'medium',
      message: item.enablesDossierAddition,
    }));

    const complianceContext = {
      heatPortfolioId: params.heatPortfolioId || null,
    };

    const complianceEvidence = {
      division: params.division || null,
      technicalMeasures: params.technicalMeasures || null,
      tariffImpactStatus: params.tariffImpactStatus || null,
      regulatoryUncertainty: params.regulatoryUncertainty || null,
      fundingStatus: params.fundingStatus || null,
      customerImpact: params.customerImpact || null,
      investmentPriority: params.investmentPriority || null,
      owner: params.owner || null,
      nextDecisionGate: params.nextDecisionGate || null,
      blockedFollowUpAction: params.blockedFollowUpAction || null,
    };

    const dossierFacts = [
      `Status: ${status}`,
      `Gate Status: ${gateStatus}`,
      `Provided District Heating Asset & Tariff Steering Gate evidence: ${evidenceItems.length}/${evidenceSpecs.length}`,
      `Open gaps: ${missingEvidence.length}`,
    ];
    if (params.heatPortfolioId) dossierFacts.push(`Heat Portfolio ID: ${params.heatPortfolioId}`);

    return {
      heatAssetTariffSteeringStatusId: `hats:${Buffer.from(`${params.heatPortfolioId || ''}`)
        .toString('base64url')
        .slice(0, 24)}`,
      capabilityKey: 'heat_asset_tariff_steering',
      safety: 'read_only',
      requestContext: complianceContext,
      status,
      gateStatus,
      readinessScore,
      complianceScore,
      complianceContext,
      complianceEvidence,
      evidenceItems,
      missingEvidence,
      positiveFollowUps,
      blockingFindings,
      sourceEvidence: {
        sourceRefs,
      },
      sourceRefs,
      sourceActions: {
        inspected: ['dashboard-api.heatAssetTariffSteeringStatus'],
        referenced: [
          'assets.effective',
          'business-intelligence.dynamicTariffCalculator',
          'finance-agent.analyze',
          'eog-calculator.scenario',
          'investment-planning.createPlan',
          'vdmi.dossier',
          'interface-placeholder.requestEvidence',
          'hitl.create',
        ],
        notCalled: [
          'hitl.create',
          'vdmi.mutate',
          'investment-planning.createPlan',
          'finance-agent.mutate',
          'budget.release',
          'settlement.prepareBilling',
          'external.connector.call',
          'personal-agent.execute',
        ],
      },
      validationFindings: blockingFindings,
      dossierEvidence: {
        status,
        gateStatus,
        readinessScore,
        complianceScore,
        complianceContext,
        complianceEvidence,
        evidenceItems,
        missingEvidence,
        positiveFollowUps,
        blockingFindings,
        sourceRefs,
        dossierFacts,
      },
    };
  },

  buildProcessSensitizationReadinessMapStatus(params = {}) {
    const toList = (value) => {
      if (Array.isArray(value))
        return value.map((item) => String(item || '').trim()).filter(Boolean);
      if (value && typeof value === 'string') {
        return value
          .split(',')
          .map((item) => item.trim())
          .filter(Boolean);
      }
      return [];
    };
    const statusText = (...values) =>
      values.map((value) => String(value || '').toLowerCase()).join(' ');
    const includesAny = (text, terms) => terms.some((term) => text.includes(term));

    const processTopic = params.processType || params.topic || 'unspecified_process';
    const missingEvidence = toList(params.missingEvidence);
    const roleDecisionGaps = toList(params.roleDecisionGaps);
    const dataQualityGaps = toList(params.dataQualityGaps);
    const systemBreaks = toList(params.systemBreaks);
    const nonNegotiableConstraints = toList(params.nonNegotiableConstraints);
    const sourceRefs = toList(params.sourceRef);

    const roleDecisionText = statusText(params.roleDecision, params.roleDecisionStatus);
    const evidenceText = statusText(params.evidenceStatus);
    const dataQualityText = statusText(params.dataQualityStatus);
    const systemBreakText = statusText(params.systemBreakStatus);
    const redLineText = statusText(params.redLineStatus);

    const hasRedLineBlocker =
      nonNegotiableConstraints.length > 0 ||
      includesAny(redLineText, [
        'blocked',
        'blockiert',
        'red-line',
        'red line',
        'rote linie',
        'netzsicherheit',
        'nicht verhandelbar',
      ]);
    const hasRoleDecisionGap =
      roleDecisionGaps.length > 0 ||
      includesAny(roleDecisionText, [
        'missing',
        'fehlt',
        'open',
        'offen',
        'unclear',
        'unklar',
        'pending',
        'decision needed',
      ]);
    const hasEvidenceGap =
      missingEvidence.length > 0 ||
      dataQualityGaps.length > 0 ||
      systemBreaks.length > 0 ||
      includesAny(evidenceText, [
        'missing',
        'fehlt',
        'open',
        'offen',
        'incomplete',
        'unvollstaendig',
        'unvollständig',
      ]) ||
      includesAny(dataQualityText, [
        'gap',
        'missing',
        'fehlt',
        'poor',
        'insufficient',
        'bruch',
        'offen',
      ]) ||
      includesAny(systemBreakText, [
        'break',
        'bruch',
        'medienbruch',
        'blocked',
        'blockiert',
        'open',
        'offen',
      ]);

    let readinessStatus = 'ready_for_sensitization';
    if (hasRedLineBlocker) readinessStatus = 'blocked_by_red_line';
    else if (hasRoleDecisionGap) readinessStatus = 'needs_process_decision';
    else if (hasEvidenceGap) readinessStatus = 'needs_evidence';

    const gapSpecs = [
      ...missingEvidence.map((value) => ({
        missingDataPoint: 'missing_evidence',
        value,
        enablesDossierAddition: `add evidence-backed readiness statement for ${value}`,
      })),
      ...roleDecisionGaps.map((value) => ({
        missingDataPoint: 'role_decision_gap',
        value,
        enablesDossierAddition: `add named owner and role decision boundary for ${value}`,
      })),
      ...dataQualityGaps.map((value) => ({
        missingDataPoint: 'data_quality_gap',
        value,
        enablesDossierAddition: `separate sensitization need from data-quality remediation for ${value}`,
      })),
      ...systemBreaks.map((value) => ({
        missingDataPoint: 'system_break',
        value,
        enablesDossierAddition: `document system-break remediation before sensitization for ${value}`,
      })),
      ...nonNegotiableConstraints.map((value) => ({
        missingDataPoint: 'non_negotiable_constraint',
        value,
        enablesDossierAddition: `explain non-negotiable red-line constraint ${value}`,
      })),
    ];

    const positiveFollowUps = gapSpecs.map((item) => ({
      missingDataPoint: item.missingDataPoint,
      value: item.value,
      enablesDossierAddition: item.enablesDossierAddition,
      category: 'process_sensitization_readiness_map',
    }));

    const blockingFindings = gapSpecs.map((item, index) => ({
      code: `PSRM_${String(item.missingDataPoint).toUpperCase()}_${index + 1}`,
      severity: item.missingDataPoint === 'non_negotiable_constraint' ? 'high' : 'medium',
      message: item.enablesDossierAddition,
    }));

    const trainingTopics =
      readinessStatus === 'ready_for_sensitization'
        ? [
            `${processTopic}: Rollen- und Evidenzlage`,
            `${processTopic}: Prozesskommunikation und Automatisierungsgrenzen`,
          ]
        : [];

    const readinessScore =
      readinessStatus === 'ready_for_sensitization'
        ? 1
        : readinessStatus === 'needs_evidence'
          ? 0.55
          : readinessStatus === 'needs_process_decision'
            ? 0.35
            : 0.1;

    const context = {
      processType: params.processType || null,
      topic: params.topic || null,
      owner: params.owner || null,
      dueDate: params.dueDate || null,
      gridOperatorId: params.gridOperatorId || null,
      taskId: params.taskId || null,
      matrixId: params.matrixId || null,
      assetId: params.assetId || null,
    };
    const dossierFacts = [
      `Readiness Status: ${readinessStatus}`,
      `Process Topic: ${processTopic}`,
      `Open gaps: ${gapSpecs.length}`,
    ];
    if (params.owner) dossierFacts.push(`Owner: ${params.owner}`);

    return {
      processSensitizationReadinessMapStatusId: `psrm:${Buffer.from(
        `${processTopic}:${params.gridOperatorId || ''}:${params.taskId || params.matrixId || params.assetId || ''}`
      )
        .toString('base64url')
        .slice(0, 28)}`,
      capabilityKey: 'process_sensitization_readiness_map',
      safety: 'read_only',
      requestContext: context,
      processTopic,
      readinessStatus,
      status: readinessStatus,
      overallStatus: readinessStatus,
      readinessScore,
      trainingTopics,
      dataQualityGaps,
      systemBreaks,
      roleDecisionGaps,
      nonNegotiableConstraints,
      missingEvidence: gapSpecs,
      positiveFollowUps,
      blockingFindings,
      sourceEvidence: {
        sourceRefs,
      },
      sourceRefs,
      sourceActions: {
        inspected: ['dashboard-api.processSensitizationReadinessMapStatus'],
        referenced: [
          'dashboard-api.qualitySummary',
          'vdmi.dossier',
          'vdmi.agentRole',
          'vdmi.findings',
          'vdmi.evidence',
          'mastr-quality.audit',
          'grid-connection.fnavValidate',
          'redispatch-expost.audit',
          'edm-validation.validate',
          'datapoint.health',
          'interface-placeholder.requestEvidence',
        ],
        notCalled: [
          'hitl.create',
          'vdmi.mutate',
          'vdmi.update',
          'training.create',
          'workshop.create',
          'datastore.write',
          'external.connector.call',
          'personal-agent.execute',
        ],
      },
      validationFindings: blockingFindings,
      dossierEvidence: {
        readinessStatus,
        status: readinessStatus,
        processTopic,
        readinessScore,
        trainingTopics,
        dataQualityGaps,
        systemBreaks,
        roleDecisionGaps,
        nonNegotiableConstraints,
        missingEvidence: gapSpecs,
        positiveFollowUps,
        blockingFindings,
        sourceRefs,
        sourceActions: {
          notCalled: [
            'hitl.create',
            'vdmi.mutate',
            'external.connector.call',
            'personal-agent.execute',
          ],
        },
        dossierFacts,
      },
    };
  },

  buildNetzprozessReadinessGateStatus(params = {}) {
    const toList = (value) => {
      if (Array.isArray(value))
        return value.map((item) => String(item || '').trim()).filter(Boolean);
      if (value && typeof value === 'string') {
        return value
          .split(',')
          .map((item) => item.trim())
          .filter(Boolean);
      }
      return [];
    };
    const normalizeStatus = (value) => {
      const text = String(value || '')
        .trim()
        .toLowerCase();
      if (!text) return 'missing';
      if (/^(ready|ok|green|gruen|grün|verfuegbar|verfügbar|freigegeben)$/.test(text))
        return 'ready';
      if (/^(partial|partly|teilweise|pending|in_progress|in-progress|offen)$/.test(text))
        return 'partial';
      if (
        /^(blocked|blockiert|red|rot|failed|fehlt|missing|not_ready|not-ready|unready)$/.test(text)
      )
        return text.includes('fehlt') || text.includes('missing') ? 'missing' : 'blocked';
      if (/unknown|unklar|unbekannt/.test(text)) return 'unknown';
      return text;
    };
    const isReady = (status) => status === 'ready';
    const isBlocked = (status) => status === 'blocked';
    const isPartial = (status) =>
      ['partial', 'missing', 'unknown'].includes(status) || !isReady(status);

    const sourceRefs = toList(params.sourceRef);
    const extraMissingEvidence = toList(params.missingEvidence);
    const baseSignals = [
      {
        code: 'portal_access',
        label: 'Portal Access',
        value: params.portalAccess,
        owner: params.owner,
        dueAt: params.dueAt,
        enablesDossierAddition: 'adds portal access readiness proof and removes the access blocker',
      },
      {
        code: 'sftp_route',
        label: 'SFTP Route',
        value: params.sftpRoute,
        owner: params.owner,
        dueAt: params.dueAt,
        enablesDossierAddition: 'adds interface route readiness proof',
      },
      {
        code: 'role_permission',
        label: 'Role Permission',
        value: params.rolePermission,
        owner: params.owner,
        dueAt: params.dueAt,
        enablesDossierAddition: 'adds role authorization proof',
      },
      {
        code: 'it_security_update',
        label: 'IT/Security Update',
        value: params.itSecurityUpdate,
        owner: params.owner,
        dueAt: params.dueAt,
        enablesDossierAddition: 'adds IT/security prerequisite evidence',
      },
      {
        code: 'training',
        label: 'Training',
        value: params.training,
        owner: params.owner,
        dueAt: params.dueAt,
        enablesDossierAddition: 'adds fachschulung and role readiness evidence',
      },
      {
        code: 'data_path',
        label: 'Data Path',
        value: params.dataPath,
        owner: params.owner,
        dueAt: params.dueAt,
        enablesDossierAddition: 'adds source data path readiness proof',
      },
    ];

    const customSignals = toList(params.customSignals).map((raw, index) => {
      const [codeRaw, statusRaw] = String(raw).split(':');
      const code = (codeRaw || `custom_signal_${index + 1}`)
        .trim()
        .toLowerCase()
        .replace(/[^a-z0-9_]+/g, '_');
      return {
        code,
        label: code.replace(/_/g, ' '),
        value: statusRaw || raw,
        owner: params.owner,
        dueAt: params.dueAt,
        enablesDossierAddition: `adds readiness proof for ${code.replace(/_/g, ' ')}`,
      };
    });

    const readinessSignals = [...baseSignals, ...customSignals]
      .filter(
        (signal) => signal.value !== undefined && signal.value !== null && signal.value !== ''
      )
      .map((signal) => {
        const status = normalizeStatus(signal.value);
        return {
          code: signal.code,
          label: signal.label,
          status,
          rawStatus: signal.value,
          owner: signal.owner || null,
          dueAt: signal.dueAt || null,
          evidenceRef: params.processId || params.processRefId || null,
          finding: isReady(status) ? null : signal.enablesDossierAddition,
          enablesDossierAddition: signal.enablesDossierAddition,
        };
      });

    const missingFromParams = extraMissingEvidence.map((value) => ({
      missingDataPoint: 'missing_evidence',
      value,
      enablesDossierAddition: `adds missing process readiness evidence for ${value}`,
    }));
    const missingFromSignals = readinessSignals
      .filter((signal) => !isReady(signal.status))
      .map((signal) => ({
        missingDataPoint: signal.code,
        status: signal.status,
        value: signal.rawStatus,
        enablesDossierAddition: signal.enablesDossierAddition,
      }));
    const blockedDecisionGap = params.blockedDecision
      ? [
          {
            missingDataPoint: 'blocked_decision',
            value: params.blockedDecision,
            enablesDossierAddition: 'adds decision-frame context for the next process gate',
          },
        ]
      : [];
    const missingEvidence = [...missingFromSignals, ...missingFromParams, ...blockedDecisionGap];

    let overallStatus = 'unknown';
    if (readinessSignals.length > 0) {
      if (readinessSignals.some((signal) => isBlocked(signal.status)) || params.blockedDecision) {
        overallStatus = 'blocked';
      } else if (
        readinessSignals.some((signal) => isPartial(signal.status)) ||
        missingFromParams.length > 0
      ) {
        overallStatus = 'partial';
      } else {
        overallStatus = 'ready';
      }
    }

    const blockers = readinessSignals
      .filter((signal) => isBlocked(signal.status))
      .map((signal) => ({
        code: signal.code,
        owner: signal.owner,
        dueAt: signal.dueAt,
        message: signal.enablesDossierAddition,
      }));
    if (params.blockedDecision) {
      blockers.push({
        code: 'blocked_decision',
        owner: params.owner || null,
        dueAt: params.dueAt || null,
        message: `Blocked next decision: ${params.blockedDecision}`,
      });
    }

    const owners = [
      ...new Set(
        readinessSignals
          .map((signal) => signal.owner)
          .filter(Boolean)
          .concat(params.owner ? [params.owner] : [])
      ),
    ];
    const positiveFollowUps = missingEvidence.map((item) => ({
      missingDataPoint: item.missingDataPoint,
      status: item.status,
      value: item.value,
      enablesDossierAddition: item.enablesDossierAddition,
      category: 'netzprozess_readiness_gate',
    }));
    const validationFindings = missingEvidence.map((item, index) => ({
      code: `NPRG_${String(item.missingDataPoint).toUpperCase()}_${index + 1}`,
      severity:
        item.status === 'blocked' || item.missingDataPoint === 'blocked_decision'
          ? 'high'
          : 'medium',
      message: item.enablesDossierAddition,
    }));
    const dossierFacts = [
      `Overall Status: ${overallStatus}`,
      `Process Type: ${params.processType || 'general'}`,
      `Readiness Signals: ${readinessSignals.length}`,
      `Open gaps: ${missingEvidence.length}`,
    ];
    if (params.nextDecision) dossierFacts.push(`Next Decision: ${params.nextDecision}`);

    const processRef = {
      processId: params.processId || null,
      type: params.processRefType || null,
      id: params.processRefId || null,
    };
    const sourceActions = {
      inspected: ['dashboard-api.netzprozessReadinessGateStatus'],
      referenced: [
        'decision-frame.get',
        'copilot-process.listProcessIntents',
        'hitl.list',
        'vdmi.dossier',
        'grid-connection.fnavValidate',
        'netzkoppelvertrag-workflow.get',
      ],
      notCalled: [
        'hitl.create',
        'vdmi.mutate',
        'decision-frame.create',
        'copilot-process.execute',
        'znp.mutate',
        'grid-connection.mutate',
        'netzkoppelvertrag-workflow.mutate',
        'workflow.execute',
        'external.connector.call',
        'personal-agent.execute',
      ],
    };

    return {
      netzprozessReadinessGateStatusId: `nprg:${Buffer.from(
        `${params.processType || 'general'}:${params.processId || params.processRefId || ''}`
      )
        .toString('base64url')
        .slice(0, 28)}`,
      capabilityKey: 'netzprozess_readiness_gate',
      safety: 'read_only',
      overallStatus,
      status: overallStatus,
      processType: params.processType || 'general',
      processRef,
      readinessSignals,
      blockers,
      owners,
      nextDecision: params.nextDecision || null,
      missingEvidence,
      positiveFollowUps,
      validationFindings,
      sourceRefs,
      sourceActions,
      dossierEvidence: {
        overallStatus,
        status: overallStatus,
        processType: params.processType || 'general',
        processRef,
        readinessSignals,
        blockers,
        owners,
        nextDecision: params.nextDecision || null,
        missingEvidence,
        positiveFollowUps,
        validationFindings,
        sourceActions: {
          notCalled: sourceActions.notCalled,
        },
        dossierFacts,
      },
    };
  },

  buildGrossspeicherAnschlussReadinessGateStatus(params = {}) {
    const toList = (value) => {
      if (Array.isArray(value))
        return value.map((item) => String(item || '').trim()).filter(Boolean);
      if (value && typeof value === 'string') {
        return value
          .split(',')
          .map((item) => item.trim())
          .filter(Boolean);
      }
      return [];
    };
    const toNumber = (value) => {
      if (value === undefined || value === null || value === '') return null;
      const n = Number(
        typeof value === 'string' ? value.replace(/\s/g, '').replace(',', '.') : value
      );
      return Number.isFinite(n) ? n : null;
    };
    const normalizeStatus = (value) => {
      const text = String(value || '')
        .trim()
        .toLowerCase();
      if (!text) return 'missing';
      if (
        /^(ready|ok|green|gruen|grün|complete|completed|valid|validiert|confirmed|bestaetigt|bestätigt|approved|freigegeben|vorhanden)$/.test(
          text
        )
      )
        return 'ready';
      if (
        /^(partial|partly|pending|open|offen|in_progress|in-progress|review|review_required|unklar|unknown)$/.test(
          text
        )
      )
        return 'partial';
      if (/^(missing|fehlt|absent|not_available|not-available)$/.test(text)) return 'missing';
      if (/^(blocked|blockiert|red|rot|failed|rejected|not_ready|not-ready|stop)$/.test(text))
        return 'blocked';
      if (
        /vorrang|priority|netzsignal|engpass/.test(text) &&
        /block|stop|red|rot|reject|ablehn/.test(text)
      )
        return 'blocked';
      return text;
    };
    const isReady = (status) => status === 'ready';
    const isBlocked = (status) => status === 'blocked';
    const sourceRefs = [...toList(params.sourceRef), ...toList(params.source)];
    const suppliedEvidenceGaps = [
      ...toList(params.missingEvidence),
      ...toList(params.evidenceGaps),
    ];
    const projectContext = {
      gridOperatorId: params.gridOperatorId || null,
      projectId: params.projectId || null,
      storageAssetId: params.storageAssetId || null,
      location: params.location || null,
      requestedCapacityKW: toNumber(params.requestedCapacityKW),
      storageCapacityKWh: toNumber(params.storageCapacityKWh),
      voltageLevel: params.voltageLevel || null,
    };
    const sourceActions = {
      inspected: ['dashboard-api.grossspeicherAnschlussReadinessGateStatus'],
      referenced: [
        'assets.storage',
        'grid-connection.fnavValidate',
        'grid-operations.netzfahrplanGenerate',
        'forecast-engine.storageDispatch',
        'forecast-engine.createSchedule',
        'flex.listDevices',
        'vdmi.dossier',
        'presentation.generate',
      ],
      notCalled: [
        'hitl.create',
        'vdmi.mutate',
        'grid-connection.mutate',
        'grid-operations.executeControl',
        'forecast-engine.executeDispatch',
        'flex.controlDevice',
        'device-control.execute',
        'smgw.control',
        'cls.execute',
        'znp.mutate',
        'workflow.execute',
        'external.connector.call',
        'settlement.prepareBilling',
        'tariff.mutate',
        'personal-agent.execute',
      ],
    };
    const signalSpecs = [
      {
        code: 'asset_context',
        label: 'Storage Asset Context',
        value: params.assetContextStatus || (params.storageAssetId ? 'ready' : ''),
        enablesDossierAddition: 'add storage asset and project context',
        statusWhenMissing: 'needs_asset_context',
      },
      {
        code: 'formal_request',
        label: 'Formal Connection Request',
        value: params.formalRequestEvidence || params.connectionRequestStatus,
        enablesDossierAddition: 'add formal connection request proof',
        statusWhenMissing: 'needs_formal_request',
      },
      {
        code: 'nap_evidence',
        label: 'NAP/MaStR Evidence',
        value: params.napEvidenceStatus || (params.napMastrNummer ? 'ready' : ''),
        enablesDossierAddition: 'add NAP and MaStR Anschluss evidence',
        statusWhenMissing: 'needs_nap_evidence',
      },
      {
        code: 'fnav_contract_boundary',
        label: 'fNAV Contract Boundary',
        value: params.contractBoundaryStatus || params.fnavProfile,
        enablesDossierAddition: 'add fNAV profile and contract-boundary evidence',
        statusWhenMissing: 'needs_fnav_contract_boundary',
      },
      {
        code: 'schedule_assumption',
        label: 'Schedule / Dispatch Assumption',
        value:
          params.scheduleEvidenceStatus ||
          params.storageDispatchAssumption ||
          params.scheduleRequirement,
        enablesDossierAddition: 'add Speicherfahrplan or dispatch-assumption evidence',
        statusWhenMissing: 'needs_schedule_assumption',
      },
      {
        code: 'controllability_proof',
        label: 'Controllability Proof',
        value: params.controllabilityStatus,
        enablesDossierAddition: 'add controllability proof for the storage asset',
        statusWhenMissing: 'needs_controllability_proof',
      },
      {
        code: 'control_room_handover',
        label: 'Control-Room Handover',
        value: params.controlRoomHandoverStatus,
        enablesDossierAddition: 'add control-room handover proof and operational owner',
        statusWhenMissing: 'needs_controllability_proof',
      },
    ];
    const readinessSignals = signalSpecs.map((signal) => {
      const status = normalizeStatus(signal.value);
      return {
        code: signal.code,
        label: signal.label,
        status,
        rawStatus: signal.value || null,
        owner: params.owner || null,
        finding: isReady(status) ? null : signal.enablesDossierAddition,
        enablesDossierAddition: signal.enablesDossierAddition,
        statusWhenMissing: signal.statusWhenMissing,
      };
    });
    const missingFromSignals = readinessSignals
      .filter((signal) => !isReady(signal.status))
      .map((signal) => ({
        missingDataPoint: signal.code,
        status: signal.status,
        value: signal.rawStatus,
        enablesDossierAddition: signal.enablesDossierAddition,
      }));
    const missingFromParams = suppliedEvidenceGaps.map((value) => ({
      missingDataPoint: 'supplied_evidence_gap',
      value,
      status: 'missing',
      enablesDossierAddition: `add evidence for ${value}`,
    }));
    const ownerOrSourceGap =
      !params.owner || sourceRefs.length === 0
        ? [
            {
              missingDataPoint: 'owner_or_source',
              value: !params.owner ? 'owner' : 'source',
              status: 'missing',
              enablesDossierAddition:
                'add accountable owner/source for the next connection decision',
            },
          ]
        : [];
    const gridSignalStatus = normalizeStatus(
      params.gridSignalStatus || params.networkSignalPriority
    );
    const blockedByGridSignal = isBlocked(gridSignalStatus);
    const gridSignalGap =
      params.gridSignalStatus || params.networkSignalPriority
        ? [
            {
              missingDataPoint: 'network_signal_priority',
              value: params.gridSignalStatus || params.networkSignalPriority,
              status: gridSignalStatus,
              enablesDossierAddition: blockedByGridSignal
                ? 'document blocked grid-signal priority before connection decision'
                : 'add network-signal priority evidence',
            },
          ]
        : [];
    const evidenceGaps = [
      ...missingFromSignals,
      ...missingFromParams,
      ...ownerOrSourceGap,
      ...(blockedByGridSignal ? gridSignalGap : []),
    ];

    let status = 'unknown';
    if (blockedByGridSignal) status = 'blocked_by_grid_signal';
    else if (readinessSignals.some((signal) => isBlocked(signal.status))) {
      const firstBlocked = readinessSignals.find((signal) => isBlocked(signal.status));
      status = firstBlocked.statusWhenMissing;
    } else if (
      readinessSignals.every((signal) => isReady(signal.status)) &&
      ownerOrSourceGap.length === 0 &&
      suppliedEvidenceGaps.length === 0
    ) {
      status = 'ready_for_connection_decision';
    } else if (missingFromSignals.length > 0) {
      status =
        missingFromSignals[0].missingDataPoint === 'asset_context'
          ? 'needs_asset_context'
          : readinessSignals.find(
              (signal) => signal.code === missingFromSignals[0].missingDataPoint
            )?.statusWhenMissing || 'unknown';
    } else if (ownerOrSourceGap.length > 0 || suppliedEvidenceGaps.length > 0) {
      status = 'needs_asset_context';
    }
    const gateStatus =
      status === 'ready_for_connection_decision'
        ? 'ready'
        : status === 'blocked_by_grid_signal'
          ? 'blocked'
          : status === 'unknown'
            ? 'unknown'
            : 'incomplete';
    const blockers = evidenceGaps
      .filter((gap) => gap.status === 'blocked' || status === 'blocked_by_grid_signal')
      .map((gap) => ({
        code: gap.missingDataPoint,
        owner: params.owner || null,
        message: gap.enablesDossierAddition,
      }));
    const positiveFollowUps = evidenceGaps.map((gap) => ({
      missingDataPoint: gap.missingDataPoint,
      status: gap.status,
      value: gap.value,
      enablesDossierAddition: gap.enablesDossierAddition,
      category: 'grossspeicher_anschluss_readiness_gate',
    }));
    const validationFindings = evidenceGaps.map((gap, index) => ({
      code: `GSARG_${String(gap.missingDataPoint).toUpperCase()}_${index + 1}`,
      severity:
        gap.status === 'blocked' || gap.missingDataPoint === 'network_signal_priority'
          ? 'high'
          : 'medium',
      message: gap.enablesDossierAddition,
    }));
    const dossierFacts = [
      `Status: ${status}`,
      `Gate Status: ${gateStatus}`,
      `Readiness Signals: ${readinessSignals.length}`,
      `Open gaps: ${evidenceGaps.length}`,
    ];
    if (params.nextDecision) dossierFacts.push(`Next Decision: ${params.nextDecision}`);

    return {
      grossspeicherAnschlussReadinessGateStatusId: `gsarg:${Buffer.from(
        `${params.gridOperatorId || ''}:${params.projectId || ''}:${params.storageAssetId || ''}`
      )
        .toString('base64url')
        .slice(0, 28)}`,
      capabilityKey: 'grossspeicher_anschluss_readiness_gate',
      safety: 'read_only',
      status,
      gateStatus,
      projectContext,
      readinessSignals,
      evidenceGaps,
      missingEvidence: evidenceGaps,
      blockers,
      nextActions: positiveFollowUps.map((followUp) => ({
        owner: params.owner || null,
        action: followUp.enablesDossierAddition,
        missingDataPoint: followUp.missingDataPoint,
      })),
      positiveFollowUps,
      sourceRefs,
      sourceActions,
      validationFindings,
      dossierEvidence: {
        status,
        gateStatus,
        projectContext,
        readinessSignals,
        evidenceGaps,
        blockers,
        nextOwner: params.owner || null,
        nextDecision: params.nextDecision || null,
        positiveFollowUps,
        validationFindings,
        sourceActions: {
          notCalled: sourceActions.notCalled,
        },
        dossierFacts,
      },
    };
  },

  buildRolePermissionAccessReadinessGateStatus(params = {}) {
    const toList = (value) => {
      if (Array.isArray(value))
        return value.map((item) => String(item || '').trim()).filter(Boolean);
      if (value && typeof value === 'string') {
        return value
          .split(',')
          .map((item) => item.trim())
          .filter(Boolean);
      }
      return [];
    };
    const normalizeStatus = (value) => {
      const text = String(value || '')
        .trim()
        .toLowerCase();
      if (!text) return 'missing';
      if (
        /^(ready|ok|green|gruen|grün|complete|completed|valid|validiert|confirmed|bestaetigt|bestätigt|approved|freigegeben|present|vorhanden|cleared|synced)$/.test(
          text
        )
      )
        return 'ready';
      if (
        /^(partial|partly|pending|open|offen|in_progress|in-progress|review|review_required|unklar|unknown|scheduled)$/.test(
          text
        )
      )
        return 'partial';
      if (/^(missing|fehlt|absent|not_available|not-available)$/.test(text)) return 'missing';
      if (
        /^(blocked|blockiert|red|rot|failed|rejected|denied|expired|not_ready|not-ready|stop|revoked)$/.test(
          text
        )
      )
        return 'blocked';
      if (/(block|denied|reject|expired|revoked|gesperrt|abgelehnt)/.test(text)) return 'blocked';
      return text;
    };
    const isReady = (status) => status === 'ready';
    const isBlocked = (status) => status === 'blocked';
    const sourceRefs = [
      ...toList(params.sourceRef),
      ...toList(params.source),
      ...toList(params.sourcePath),
    ];
    const suppliedEvidenceGaps = [
      ...toList(params.missingEvidence),
      ...toList(params.evidenceGaps),
    ];
    const roleContext = {
      roleId: params.roleId || null,
      roleName: params.roleName || null,
      processType: params.processType || null,
      gridOperatorId: params.gridOperatorId || null,
      accessManagerRef: params.accessManagerRef || null,
      tenantScope: params.tenantScope || null,
      caseId: params.caseId || null,
    };
    const sourceActions = {
      inspected: ['dashboard-api.rolePermissionAccessReadinessGateStatus'],
      referenced: [
        'auth.groupRoleMap',
        'agent-persona.metadata',
        'vdmi-governance-templates.checklist',
        'vdmi.myResponsibilities',
        'dashboard-api.netzprozessReadinessGateStatus',
      ],
      notCalled: [
        'access-manager.call',
        'iam.provision',
        'rbac.mutate',
        'auth.createUser',
        'tenant.create',
        'token.create',
        'credential.store',
        'hitl.create',
        'vdmi.mutate',
        'workflow.execute',
        'notification.send',
        'external.connector.call',
        'personal-agent.execute',
      ],
    };
    const signalSpecs = [
      {
        code: 'role_profile',
        label: 'Role Profile',
        value: params.roleId || params.roleName ? 'ready' : '',
        enablesDossierAddition: 'add role profile and responsibility context',
        statusWhenMissing: 'needs_role_profile',
      },
      {
        code: 'portal_access',
        label: 'Portal Access',
        value: params.portalAccess,
        enablesDossierAddition: 'add portal readiness evidence',
        statusWhenMissing: 'needs_portal_access',
      },
      {
        code: 'sftp_route',
        label: 'sFTP Route',
        value: params.sftpRoute,
        enablesDossierAddition: 'add interface readiness evidence',
        statusWhenMissing: 'needs_sftp_route',
      },
      {
        code: 'role_permission',
        label: 'Role Permission',
        value: params.rolePermission,
        enablesDossierAddition: 'add permission-release evidence',
        statusWhenMissing: 'needs_role_permission',
      },
      {
        code: 'security_clearance',
        label: 'IT/Security Clearance',
        value: params.securityClearance,
        enablesDossierAddition: 'add IT/security clearance evidence',
        statusWhenMissing: 'needs_security_clearance',
      },
      {
        code: 'training_proof',
        label: 'Training Proof',
        value: params.trainingProof,
        enablesDossierAddition: 'add training readiness evidence',
        statusWhenMissing: 'needs_training_proof',
      },
      {
        code: 'reapproval_status',
        label: 'AccessManager Reapproval',
        value: params.reapprovalStatus,
        enablesDossierAddition: 'add AccessManager reapproval evidence',
        statusWhenMissing: 'needs_reapproval_decision',
      },
    ];
    const readinessSignals = signalSpecs.map((signal) => {
      const status = normalizeStatus(signal.value);
      return {
        code: signal.code,
        label: signal.label,
        status,
        rawStatus: signal.value || null,
        owner: params.owner || null,
        dueDate: params.dueDate || null,
        finding: isReady(status) ? null : signal.enablesDossierAddition,
        enablesDossierAddition: signal.enablesDossierAddition,
        statusWhenMissing: signal.statusWhenMissing,
      };
    });
    const missingFromSignals = readinessSignals
      .filter((signal) => !isReady(signal.status))
      .map((signal) => ({
        missingDataPoint: signal.code,
        status: signal.status,
        value: signal.rawStatus,
        enablesDossierAddition: signal.enablesDossierAddition,
      }));
    const missingFromParams = suppliedEvidenceGaps.map((value) => ({
      missingDataPoint: 'supplied_evidence_gap',
      value,
      status: 'missing',
      enablesDossierAddition: `add evidence for ${value}`,
    }));
    const ownerDueSourceGaps = [
      !params.owner
        ? {
            missingDataPoint: 'owner',
            value: null,
            status: 'missing',
            enablesDossierAddition: 'add accountable owner for role/access follow-up',
          }
        : null,
      !params.dueDate
        ? {
            missingDataPoint: 'due_date',
            value: null,
            status: 'missing',
            enablesDossierAddition: 'add due date for reapproval or access readiness follow-up',
          }
        : null,
      sourceRefs.length === 0
        ? {
            missingDataPoint: 'source_path',
            value: null,
            status: 'missing',
            enablesDossierAddition: 'add source path or evidence snapshot for access readiness',
          }
        : null,
    ].filter(Boolean);
    const blockedAccessStatus = normalizeStatus(params.blockedAccess);
    const blockedAccessGap = params.blockedAccess
      ? [
          {
            missingDataPoint: 'blocked_access',
            value: params.blockedAccess,
            status: blockedAccessStatus === 'ready' ? 'partial' : blockedAccessStatus,
            enablesDossierAddition:
              'document blocked access or rejected permission before operational use',
          },
        ]
      : [];
    const evidenceGaps = [
      ...missingFromSignals,
      ...missingFromParams,
      ...ownerDueSourceGaps,
      ...(isBlocked(blockedAccessStatus) ? blockedAccessGap : []),
    ];

    let status = 'unknown';
    if (
      isBlocked(blockedAccessStatus) ||
      readinessSignals.some((signal) => isBlocked(signal.status))
    ) {
      status = 'blocked_by_access_gap';
    } else if (!params.roleId && !params.roleName) {
      status = 'needs_role_profile';
    } else if (
      readinessSignals.every((signal) => isReady(signal.status)) &&
      ownerDueSourceGaps.length === 0 &&
      suppliedEvidenceGaps.length === 0
    ) {
      status = 'ready_for_operational_role';
    } else if (missingFromSignals.length > 0) {
      status =
        readinessSignals.find((signal) => signal.code === missingFromSignals[0].missingDataPoint)
          ?.statusWhenMissing || 'unknown';
    } else if (ownerDueSourceGaps.length > 0 || suppliedEvidenceGaps.length > 0) {
      status = 'needs_reapproval_decision';
    }
    const blockers = evidenceGaps
      .filter((gap) => gap.status === 'blocked' || status === 'blocked_by_access_gap')
      .map((gap) => ({
        code: gap.missingDataPoint,
        owner: params.owner || null,
        dueDate: params.dueDate || null,
        message: gap.enablesDossierAddition,
      }));
    const positiveFollowUps = evidenceGaps.map((gap) => ({
      missingDataPoint: gap.missingDataPoint,
      status: gap.status,
      value: gap.value,
      enablesDossierAddition: gap.enablesDossierAddition,
      category: 'role_permission_access_readiness_gate',
    }));
    const nextActions = positiveFollowUps.map((followUp) => ({
      owner: params.owner || null,
      dueDate: params.dueDate || null,
      action: followUp.enablesDossierAddition,
      missingDataPoint: followUp.missingDataPoint,
    }));
    const validationFindings = evidenceGaps.map((gap, index) => ({
      code: `RPAR_${String(gap.missingDataPoint).toUpperCase()}_${index + 1}`,
      severity:
        gap.status === 'blocked' || gap.missingDataPoint === 'blocked_access' ? 'high' : 'medium',
      message: gap.enablesDossierAddition,
    }));
    const dossierFacts = [
      `Status: ${status}`,
      `Role: ${params.roleName || params.roleId || 'unknown'}`,
      `Readiness Signals: ${readinessSignals.length}`,
      `Open gaps: ${evidenceGaps.length}`,
    ];
    if (params.accessManagerRef) dossierFacts.push(`AccessManager Ref: ${params.accessManagerRef}`);

    return {
      rolePermissionAccessReadinessGateStatusId: `rpar:${Buffer.from(
        `${params.roleId || ''}:${params.roleName || ''}:${params.accessManagerRef || ''}`
      )
        .toString('base64url')
        .slice(0, 28)}`,
      capabilityKey: 'role_permission_access_readiness_gate',
      safety: 'read_only',
      status,
      roleContext,
      readinessSignals,
      evidenceGaps,
      missingEvidence: evidenceGaps,
      blockers,
      nextActions,
      positiveFollowUps,
      sourceRefs,
      sourceActions,
      validationFindings,
      dossierEvidence: {
        status,
        roleContext,
        readinessSignals,
        evidenceGaps,
        blockers,
        owner: params.owner || null,
        dueDate: params.dueDate || null,
        nextActions,
        positiveFollowUps,
        validationFindings,
        sourceActions: {
          notCalled: sourceActions.notCalled,
        },
        dossierFacts,
      },
    };
  },
};
