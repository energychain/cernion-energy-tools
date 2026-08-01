'use strict';

// dashboard-api methods chunk 3/14 — extracted verbatim from
// services/dashboard-api.service.js as part of the v0.99 file-size modularization.
// Contains: buildE2eControllabilityGovernanceStatus, buildControllabilityAssetHandoverStatus, buildControllabilityDataAlignmentStatus, buildCoordinationMeaningPreservationProfile, buildA2mdmDecisionObjectStatus, buildGremiencoachWorkbookReadinessStatus, buildDecisionReadinessMatrixStatus, buildModelViabilityEvidenceGateStatus, buildCrossSystemVarianceMatrixStatus, buildRegulatorySignalProcessTranslatorStatus, buildCostReviewCommitteeStatus, buildRedispatchParticipationReadinessStatus, buildMastrSyncGapStatus, buildDecommissionedAssetReconciliationStatus, buildEnergySharingCollectiveApprovalStatus, buildSteeringArtifactAcceptanceGateStatus

module.exports = {
  buildE2eControllabilityGovernanceStatus(params = {}) {
    const stepSpecs = [
      {
        id: 'connection_intake',
        label: 'Netzanschluss-/Asset-Identifikation',
        value: params.connectionIntake,
        role: 'Netzanschluss',
        decisionBoundary:
          'Asset identity and connection context are known before controllability assumptions are used.',
        enablesDossierAddition: 'add Netzanschluss and asset identity context',
      },
      {
        id: 'metering_concept',
        label: 'Mess-/TAF-/EDM-Konzept',
        value: params.meteringConcept,
        role: 'Metering',
        decisionBoundary:
          'Metering and TAF readiness are explicit before data-quality or control readiness is claimed.',
        enablesDossierAddition: 'add TAF and Messkonzept readiness',
      },
      {
        id: 'asset_control_capability',
        label: 'Asset-Steuerbarkeitsnachweis',
        value: params.assetControlCapability,
        role: 'Asset Management',
        decisionBoundary:
          'Asset controllability remains an evidence requirement, not an inferred property.',
        enablesDossierAddition: 'add asset-control assumption boundary',
      },
      {
        id: 'grid_operations_decision',
        label: 'Netzbetrieb/Redispatch-/§14a-Entscheidung',
        value: params.gridOperationsDecision,
        role: 'Netzbetrieb',
        decisionBoundary:
          'Operational readiness is separated from technical switching or dispatch execution.',
        enablesDossierAddition: 'add Redispatch or §14a operations readiness',
      },
      {
        id: 'market_communication_handover',
        label: 'Marktkommunikations-Abgabe',
        value: params.marketCommunicationHandover,
        role: 'Marktkommunikation',
        decisionBoundary:
          'MaKo handover evidence is required before downstream settlement context is treated as traceable.',
        enablesDossierAddition: 'add MaKo handover traceability',
      },
      {
        id: 'billing_impact_check',
        label: 'Abrechnungs-/Settlement-Grenze',
        value: params.billingImpactCheck,
        role: 'Abrechnung',
        decisionBoundary:
          'Billing impact is a boundary note only; no billing or settlement release is performed.',
        enablesDossierAddition: 'add Abrechnung boundary clarity',
      },
    ];

    const evidenceMatrix = stepSpecs.map((spec, index) => ({
      stepId: spec.id,
      order: index + 1,
      label: spec.label,
      ownerRole: spec.role,
      evidenceValue: spec.value || null,
      evidenceStatus: spec.value ? 'provided' : 'missing',
      decisionBoundary: spec.decisionBoundary,
    }));
    const gaps = stepSpecs
      .filter((spec) => !spec.value)
      .map((spec) => ({
        missingDataPoint: spec.id,
        label: spec.label,
        ownerRole: spec.role,
        enablesDossierAddition: spec.enablesDossierAddition,
      }));
    if (!params.owner) {
      gaps.push({
        missingDataPoint: 'owner',
        label: 'Accountable Owner',
        ownerRole: 'Governance',
        enablesDossierAddition: 'add accountable handover status',
      });
    }
    if (!params.deadline) {
      gaps.push({
        missingDataPoint: 'deadline',
        label: 'Handover Deadline',
        ownerRole: 'Governance',
        enablesDossierAddition: 'add due-date and escalation context',
      });
    }
    if (!params.openMeasure) {
      gaps.push({
        missingDataPoint: 'open_measure',
        label: 'Open Measure',
        ownerRole: 'Governance',
        enablesDossierAddition: 'add next open measure for closure tracking',
      });
    }

    const coveredSteps = evidenceMatrix.filter((item) => item.evidenceStatus === 'provided');
    const status =
      gaps.length === 0
        ? 'governance_evidence_complete'
        : coveredSteps.length === 0
          ? 'needs_governance_evidence'
          : 'partial_governance_evidence';
    const positiveFollowUps = gaps.map((item) => ({
      missingDataPoint: item.missingDataPoint,
      enablesDossierAddition: item.enablesDossierAddition,
      category: 'e2e_controllability_governance',
    }));
    const processSteps = evidenceMatrix.map((item) => ({
      id: item.stepId,
      label: item.label,
      ownerRole: item.ownerRole,
      evidenceStatus: item.evidenceStatus,
    }));
    const owners = params.owner
      ? [{ id: 'accountable_owner', label: 'Accountable Owner', value: params.owner }]
      : [];
    const deadlines = params.deadline
      ? [{ id: 'handover_deadline', label: 'Handover Deadline', value: params.deadline }]
      : [];
    const openMeasures = params.openMeasure
      ? [{ id: 'open_measure', label: 'Open Measure', value: params.openMeasure }]
      : [];
    const dossierFacts = [
      `Status: ${status}`,
      `Covered governance steps: ${coveredSteps.length}/${stepSpecs.length}`,
      `Open gaps: ${gaps.length}`,
    ];
    if (params.caseId) dossierFacts.push(`Case: ${params.caseId}`);
    if (params.owner) dossierFacts.push(`Owner: ${params.owner}`);

    return {
      governanceId: `e2e-ccg:${Buffer.from(
        `${params.caseId || ''}:${params.owner || ''}:${params.deadline || ''}`
      )
        .toString('base64url')
        .slice(0, 24)}`,
      capabilityKey: 'e2e_controllability_check_governance',
      safety: 'read_only',
      requestContext: {
        caseId: params.caseId || null,
        owner: params.owner || null,
        deadline: params.deadline || null,
      },
      status,
      processSteps,
      evidenceMatrix,
      decisionBoundaries: evidenceMatrix.map((item) => ({
        stepId: item.stepId,
        label: item.label,
        boundary: item.decisionBoundary,
      })),
      owners,
      deadlines,
      openMeasures,
      gaps,
      positiveFollowUps,
      dossierFacts,
      sourceActions: {
        inspected: ['dashboard-api.e2eControllabilityGovernanceStatus'],
        referenced: [
          'vdmi.dossier',
          'vdmi.evidence',
          'interface-placeholder.requestEvidence',
          'grid-operations.controlMeasures',
          'edm-messkonzept.evaluate',
          'edm-validation.validate',
        ],
        notCalled: [
          'hitl.create',
          'settlement.exportA96',
          'settlement.prepareBilling',
          'grid-operations.executeControl',
        ],
      },
      validationFindings: gaps.map((item) => ({
        code: `E2E_CCG_${String(item.missingDataPoint).toUpperCase()}_MISSING`,
        severity: 'medium',
        message: item.enablesDossierAddition,
      })),
      dossierEvidence: {
        status,
        processSteps,
        evidenceMatrix,
        gaps,
        positiveFollowUps,
        owners,
        deadlines,
        openMeasures,
        dossierFacts,
      },
    };
  },

  buildControllabilityAssetHandoverStatus(params = {}) {
    const dataSourceRefs = Array.isArray(params.dataSourceRefs)
      ? params.dataSourceRefs.filter(Boolean)
      : params.dataSourceRefs
        ? String(params.dataSourceRefs)
            .split(',')
            .map((item) => item.trim())
            .filter(Boolean)
        : [];
    const evidenceSpecs = [
      {
        id: 'asset_inventory',
        label: 'Asset inventory',
        value: params.assetId || params.mastrId,
        sourceClass: 'asset_master_data',
        enablesDossierAddition: 'add asset identity and inventory reference',
      },
      {
        id: 'nap_melo_mapping',
        label: 'NAP/MeLo mapping',
        value: params.napId || params.meloId,
        sourceClass: 'connection_meter_mapping',
        enablesDossierAddition: 'add NAP and MeLo mapping evidence',
      },
      {
        id: 'technical_status',
        label: 'Technical status',
        value: params.technicalStatus,
        sourceClass: 'technical_readiness',
        enablesDossierAddition: 'add technical readiness evidence',
      },
      {
        id: 'feedback_capability',
        label: 'Feedback capability',
        value: params.feedbackCapability,
        sourceClass: 'remote_feedback',
        enablesDossierAddition: 'add Rueckmelde-/Fernsteuerbarkeits evidence',
      },
      {
        id: 'controllability_scope',
        label: 'Controllability scope',
        value: params.controllabilityScope,
        sourceClass: 'control_scope',
        enablesDossierAddition: 'add controllability scope boundary',
      },
      {
        id: 'data_source_snapshot',
        label: 'Source snapshot',
        value:
          params.sourceSnapshotId || (dataSourceRefs.length > 0 ? dataSourceRefs.join(',') : null),
        sourceClass: 'source_snapshot',
        enablesDossierAddition: 'add source and freshness proof',
      },
      {
        id: 'check_result',
        label: 'Check result',
        value: params.checkStatus || params.evidenceStatus,
        sourceClass: 'check_status',
        enablesDossierAddition: 'add check result evidence',
      },
      {
        id: 'line_owner',
        label: 'Line owner',
        value: params.lineOwnerRole,
        sourceClass: 'line_handover_owner',
        enablesDossierAddition: 'add accountable line handover ownership',
      },
      {
        id: 'next_reporting_cycle',
        label: 'Next reporting cycle',
        value: params.nextReportingCycle,
        sourceClass: 'line_monitoring_cycle',
        enablesDossierAddition: 'add recurring monitoring cadence',
      },
      {
        id: 'handover_decision',
        label: 'Handover decision',
        value: params.handoverDecision,
        sourceClass: 'line_transition_decision',
        enablesDossierAddition: 'add explicit line-transition decision',
      },
    ];
    const evidenceItems = evidenceSpecs
      .filter((spec) => spec.value != null && spec.value !== '')
      .map((spec) => ({
        id: spec.id,
        label: spec.label,
        value: spec.value,
        sourceClass: spec.sourceClass,
        evidenceStatus: 'provided',
      }));
    const missingEvidence = evidenceSpecs
      .filter((spec) => spec.value == null || spec.value === '')
      .map((spec) => ({
        missingDataPoint: spec.id,
        label: spec.label,
        sourceClass: spec.sourceClass,
        enablesDossierAddition: spec.enablesDossierAddition,
      }));
    if (params.nonExecutionReason) {
      evidenceItems.push({
        id: 'non_execution_reason',
        label: 'Non-execution reason',
        value: params.nonExecutionReason,
        sourceClass: 'defensible_non_execution_context',
        evidenceStatus: 'provided',
      });
    }

    const status =
      missingEvidence.length === 0
        ? 'ready_for_handover'
        : !params.technicalStatus
          ? 'needs_technical_check'
          : !params.feedbackCapability
            ? 'needs_feedback_capability'
            : !params.lineOwnerRole
              ? 'needs_owner'
              : !params.handoverDecision
                ? 'needs_handover_decision'
                : 'needs_evidence';
    const asset = {
      assetId: params.assetId || null,
      mastrId: params.mastrId || null,
      napId: params.napId || null,
      meloId: params.meloId || null,
      technologyType: params.technologyType || null,
      capacityKW: params.capacityKW ?? null,
      controllabilityScope: params.controllabilityScope || null,
    };
    const positiveFollowUps = missingEvidence.map((item) => ({
      missingDataPoint: item.missingDataPoint,
      enablesDossierAddition: item.enablesDossierAddition,
      category: 'controllability_asset_handover',
    }));
    const blockingFindings = missingEvidence.map((item) => ({
      code: `CAH_${String(item.missingDataPoint).toUpperCase()}_MISSING`,
      severity: ['line_owner', 'handover_decision', 'technical_status'].includes(
        item.missingDataPoint
      )
        ? 'high'
        : 'medium',
      message: item.enablesDossierAddition,
    }));
    const providedRequiredEvidence = evidenceItems.filter(
      (item) => item.id !== 'non_execution_reason'
    );
    const dossierFacts = [
      `Status: ${status}`,
      `Provided handover evidence: ${providedRequiredEvidence.length}/${evidenceSpecs.length}`,
      `Open gaps: ${missingEvidence.length}`,
    ];
    if (params.assetId) dossierFacts.push(`Asset: ${params.assetId}`);
    if (params.lineOwnerRole) dossierFacts.push(`Line Owner: ${params.lineOwnerRole}`);
    if (params.handoverDecision) dossierFacts.push(`Decision: ${params.handoverDecision}`);

    return {
      handoverId: `cah:${Buffer.from(
        `${params.caseId || ''}:${params.assetId || ''}:${params.mastrId || ''}:${params.lineOwnerRole || ''}`
      )
        .toString('base64url')
        .slice(0, 24)}`,
      capabilityKey: 'controllability_asset_handover',
      safety: 'read_only',
      requestContext: {
        caseId: params.caseId || null,
        sourceSnapshotId: params.sourceSnapshotId || null,
        dataSourceRefs,
      },
      status,
      asset,
      evidenceItems,
      missingEvidence,
      positiveFollowUps,
      handoverDecision: params.handoverDecision || null,
      lineOwnerRole: params.lineOwnerRole || null,
      nextReportingCycle: params.nextReportingCycle || null,
      nonExecutionReason: params.nonExecutionReason || null,
      blockingFindings,
      sourceActions: {
        inspected: ['dashboard-api.controllabilityAssetHandoverStatus'],
        referenced: [
          'assets.effective',
          'mastr-quality.audit',
          'redispatch-expost.audit',
          'datapoint.health',
          'vdmi.dossier',
          'interface-placeholder.requestEvidence',
        ],
        notCalled: [
          'hitl.create',
          'assets.applyOverride',
          'grid-operations.executeControl',
          'settlement.exportA96',
          'settlement.prepareBilling',
          'external.connector.call',
        ],
      },
      validationFindings: blockingFindings,
      dossierEvidence: {
        status,
        asset,
        evidenceItems,
        missingEvidence,
        positiveFollowUps,
        handoverDecision: params.handoverDecision || null,
        lineOwnerRole: params.lineOwnerRole || null,
        nextReportingCycle: params.nextReportingCycle || null,
        nonExecutionReason: params.nonExecutionReason || null,
        blockingFindings,
        dossierFacts,
      },
    };
  },

  buildControllabilityDataAlignmentStatus(params = {}) {
    const normalize = (value) => (value == null ? '' : String(value).trim());
    const valueOrNull = (value) => {
      const normalized = normalize(value);
      return normalized === '' ? null : normalized;
    };
    const hasValue = (value) => valueOrNull(value) !== null;
    const dataMatchValue =
      valueOrNull(params.assetMatch) ||
      valueOrNull(params.mastrMatch) ||
      valueOrNull(params.internalAssetMatch);
    const exportReadiness =
      valueOrNull(params.exportReadiness) || valueOrNull(params.evidenceStatus);
    const rowSpecs = [
      {
        id: 'checklist_reference',
        label: 'External checklist reference',
        value: params.checklistId,
        evidenceClass: 'external_checklist_scope',
        enablesDossierAddition: 'add anonymized checklist reference and scope',
      },
      {
        id: 'asset_mastr_match',
        label: 'Asset/MaStR/internal data match',
        value: dataMatchValue,
        evidenceClass: 'asset_master_data_alignment',
        enablesDossierAddition: 'add asset, MaStR and internal master-data match evidence',
      },
      {
        id: 'control_technology_status',
        label: 'Control technology status',
        value: params.controlTechStatus,
        evidenceClass: 'controllability_technology',
        enablesDossierAddition: 'add Steuertechnik/CLS/iMSys readiness evidence',
      },
      {
        id: 'threshold_classification',
        label: 'Threshold classification',
        value: params.thresholdClass,
        evidenceClass: 'regulatory_scope_classification',
        enablesDossierAddition: 'add threshold and scope classification',
      },
      {
        id: 'testability',
        label: 'Testability',
        value: params.testability,
        evidenceClass: 'operational_testability',
        enablesDossierAddition: 'add testability or non-testability evidence',
      },
      {
        id: 'exception_reason',
        label: 'Exception/risk rationale',
        value: params.exceptionReason,
        evidenceClass: 'defensible_exception_context',
        enablesDossierAddition: 'add exception or risk rationale',
        optionalWhen: () => normalize(params.testability).toLowerCase().includes('testable'),
      },
      {
        id: 'prior_year_comparison',
        label: 'Prior-year comparison',
        value: params.priorYearComparison,
        evidenceClass: 'year_over_year_delta',
        enablesDossierAddition: 'add prior-year comparison and delta rationale',
      },
      {
        id: 'owner_deadline',
        label: 'Owner/deadline',
        value:
          hasValue(params.owner) && hasValue(params.dueDate)
            ? `${params.owner} / ${params.dueDate}`
            : null,
        evidenceClass: 'accountability_and_due_date',
        enablesDossierAddition: 'add accountable owner and due date',
      },
      {
        id: 'export_readiness',
        label: 'Evidence export readiness',
        value: exportReadiness,
        evidenceClass: 'audit_package_readiness',
        enablesDossierAddition: 'add evidence package/export readiness status',
      },
    ];
    const alignmentRows = rowSpecs.map((spec) => ({
      id: spec.id,
      label: spec.label,
      value: valueOrNull(spec.value),
      evidenceClass: spec.evidenceClass,
      evidenceStatus: valueOrNull(spec.value)
        ? 'provided'
        : spec.optionalWhen?.()
          ? 'not_required'
          : 'missing',
    }));
    const missingEvidence = rowSpecs
      .filter((spec) => !valueOrNull(spec.value) && !spec.optionalWhen?.())
      .map((spec) => ({
        missingDataPoint: spec.id,
        label: spec.label,
        evidenceClass: spec.evidenceClass,
        enablesDossierAddition: spec.enablesDossierAddition,
      }));
    const providedRows = alignmentRows.filter((row) => row.evidenceStatus === 'provided');
    const normalizedControl = normalize(params.controlTechStatus).toLowerCase();
    const normalizedTestability = normalize(params.testability).toLowerCase();
    const normalizedThreshold = normalize(params.thresholdClass).toLowerCase();
    const status =
      missingEvidence.length === 0
        ? 'ready_for_evidence_export'
        : !dataMatchValue
          ? 'needs_data_match'
          : !hasValue(params.controlTechStatus)
            ? 'needs_control_technology_status'
            : !hasValue(params.testability)
              ? 'needs_testability_classification'
              : !hasValue(params.owner) || !hasValue(params.dueDate)
                ? 'needs_owner_deadline'
                : 'needs_alignment_evidence';
    const safeNextGate =
      status === 'ready_for_evidence_export'
        ? 'export_dossier_package'
        : normalizedThreshold.includes('above') && normalizedControl.includes('missing')
          ? 'collect_control_technology_evidence'
          : normalizedTestability.includes('not-testable') ||
              normalizedTestability.includes('nicht')
            ? 'document_non_testability_exception'
            : 'complete_alignment_evidence';
    const positiveFollowUps = missingEvidence.map((item) => ({
      missingDataPoint: item.missingDataPoint,
      enablesDossierAddition: item.enablesDossierAddition,
      category: 'controllability_data_alignment',
    }));
    const blockingFindings = missingEvidence.map((item) => ({
      code: `CDA_${String(item.missingDataPoint).toUpperCase()}_MISSING`,
      severity: ['asset_mastr_match', 'control_technology_status', 'testability'].includes(
        item.missingDataPoint
      )
        ? 'high'
        : 'medium',
      message: item.enablesDossierAddition,
    }));
    const checklist = {
      checklistId: valueOrNull(params.checklistId),
      assetId: valueOrNull(params.assetId),
      mastrId: valueOrNull(params.mastrId),
      assetMatch: valueOrNull(params.assetMatch),
      mastrMatch: valueOrNull(params.mastrMatch),
      internalAssetMatch: valueOrNull(params.internalAssetMatch),
    };
    const dossierFacts = [
      `Status: ${status}`,
      `Provided alignment rows: ${providedRows.length}/${rowSpecs.length}`,
      `Open gaps: ${missingEvidence.length}`,
    ];
    if (params.checklistId) dossierFacts.push(`Checklist: ${params.checklistId}`);
    if (params.owner) dossierFacts.push(`Owner: ${params.owner}`);
    if (safeNextGate) dossierFacts.push(`Next Gate: ${safeNextGate}`);

    return {
      alignmentId: `cda:${Buffer.from(
        `${params.checklistId || ''}:${params.assetId || ''}:${params.mastrId || ''}:${params.owner || ''}`
      )
        .toString('base64url')
        .slice(0, 24)}`,
      capabilityKey: 'controllability_data_alignment',
      safety: 'read_only',
      requestContext: {
        checklistId: valueOrNull(params.checklistId),
        owner: valueOrNull(params.owner),
        dueDate: valueOrNull(params.dueDate),
      },
      status,
      checklist,
      thresholdClass: valueOrNull(params.thresholdClass),
      testability: valueOrNull(params.testability),
      exceptionReason: valueOrNull(params.exceptionReason),
      priorYearComparison: valueOrNull(params.priorYearComparison),
      owner: valueOrNull(params.owner),
      dueDate: valueOrNull(params.dueDate),
      exportReadiness,
      safeNextGate,
      alignmentRows,
      missingEvidence,
      positiveFollowUps,
      blockingFindings,
      sourceActions: {
        inspected: ['dashboard-api.controllabilityDataAlignmentStatus'],
        referenced: [
          'assets.effective',
          'mastr-quality.audit',
          'redispatch-expost.audit',
          'vdmi.dossier',
          'interface-placeholder.requestEvidence',
        ],
        notCalled: [
          'file.import',
          'excel.parse',
          'assets.applyOverride',
          'mastr.liveLookup',
          'cls.executeSwitching',
          'grid-operations.executeControl',
          'hitl.create',
          'settlement.exportA96',
          'settlement.prepareBilling',
          'external.connector.call',
        ],
      },
      validationFindings: blockingFindings,
      dossierEvidence: {
        status,
        checklist,
        thresholdClass: valueOrNull(params.thresholdClass),
        testability: valueOrNull(params.testability),
        exceptionReason: valueOrNull(params.exceptionReason),
        priorYearComparison: valueOrNull(params.priorYearComparison),
        owner: valueOrNull(params.owner),
        dueDate: valueOrNull(params.dueDate),
        exportReadiness,
        safeNextGate,
        alignmentRows,
        missingEvidence,
        positiveFollowUps,
        blockingFindings,
        dossierFacts,
      },
    };
  },

  buildCoordinationMeaningPreservationProfile(params = {}) {
    const hasValue = (value) => value !== undefined && value !== null && String(value) !== '';
    const dimensionSpecs = [
      {
        id: 'regulatory_reference',
        label: 'Regulatory reference',
        value: params.regulatoryReference,
        category: 'regulatory_context',
        enablesDossierAddition: 'add Regulierungsbezug der Uebergabe',
      },
      {
        id: 'commercial_effect',
        label: 'Commercial effect',
        value: params.commercialEffect,
        category: 'commercial_context',
        enablesDossierAddition: 'add kaufmaennische Auswirkung',
      },
      {
        id: 'network_constraint',
        label: 'Network constraint',
        value: params.networkConstraint,
        category: 'grid_context',
        enablesDossierAddition: 'add Netzrestriktion / technische Grenze',
      },
      {
        id: 'evidence_proof',
        label: 'Evidence proof',
        value: params.evidenceProof,
        category: 'proof_context',
        enablesDossierAddition: 'add Nachweisquelle',
      },
      {
        id: 'owner',
        label: 'Owner',
        value: params.owner,
        category: 'ownership_context',
        enablesDossierAddition: 'add verantwortliche Rolle',
      },
      {
        id: 'deadline',
        label: 'Deadline',
        value: params.deadline,
        category: 'time_context',
        enablesDossierAddition: 'add Frist / Wiedervorlage',
      },
      {
        id: 'next_decision',
        label: 'Next decision',
        value: params.nextDecision,
        category: 'decision_context',
        enablesDossierAddition: 'add naechster Entscheidungspunkt',
      },
      {
        id: 'operational_risk',
        label: 'Operational risk',
        value: params.operationalRisk,
        category: 'risk_context',
        enablesDossierAddition: 'add operative Risikoauswirkung',
      },
    ];

    const preservedDimensions = dimensionSpecs
      .filter((spec) => hasValue(spec.value))
      .map((spec) => ({
        id: spec.id,
        label: spec.label,
        value: spec.value,
        category: spec.category,
        evidenceStatus: 'provided',
      }));
    const missingDimensions = dimensionSpecs
      .filter((spec) => !hasValue(spec.value))
      .map((spec) => ({
        missingDataPoint: spec.id,
        label: spec.label,
        category: spec.category,
        enablesDossierAddition: spec.enablesDossierAddition,
      }));
    const weakDimensions = [];
    const criticalMissing = missingDimensions.filter((item) =>
      ['owner', 'deadline', 'next_decision', 'evidence_proof'].includes(item.missingDataPoint)
    );
    const coordinationLossClassification =
      missingDimensions.length === 0
        ? 'meaning_preserved'
        : criticalMissing.length > 0
          ? 'decision_context_missing'
          : 'partial_context_loss';
    const status =
      coordinationLossClassification === 'meaning_preserved'
        ? 'meaning_preserved'
        : coordinationLossClassification === 'decision_context_missing'
          ? 'needs_decision_context'
          : 'partial_context_loss';
    const positiveFollowUps = missingDimensions.map((item) => ({
      missingDataPoint: item.missingDataPoint,
      enablesDossierAddition: item.enablesDossierAddition,
      category: 'coordination_meaning_preservation_profile',
    }));
    const validationFindings = missingDimensions.map((item) => ({
      code: `CMPP_${String(item.missingDataPoint).toUpperCase()}_MISSING`,
      severity: ['owner', 'deadline', 'next_decision'].includes(item.missingDataPoint)
        ? 'high'
        : 'medium',
      message: item.enablesDossierAddition,
    }));
    const dossierFacts = [
      `Status: ${status}`,
      `Preserved dimensions: ${preservedDimensions.length}/${dimensionSpecs.length}`,
      `Open meaning gaps: ${missingDimensions.length}`,
    ];
    if (params.sourceDomain || params.targetDomain) {
      dossierFacts.push(
        `Handover: ${params.sourceDomain || 'unknown'} -> ${params.targetDomain || 'unknown'}`
      );
    }
    if (params.owner) dossierFacts.push(`Owner: ${params.owner}`);
    if (params.nextDecision) dossierFacts.push(`Next Decision: ${params.nextDecision}`);

    return {
      profileId: `cmpp:${Buffer.from(
        `${params.caseId || ''}:${params.sourceDomain || ''}:${params.targetDomain || ''}:${params.owner || ''}`
      )
        .toString('base64url')
        .slice(0, 24)}`,
      capabilityKey: 'coordination_meaning_preservation_profile',
      safety: 'read_only',
      requestContext: {
        caseId: params.caseId || null,
        sourceDomain: params.sourceDomain || null,
        targetDomain: params.targetDomain || null,
        handoverContext: params.handoverContext || null,
      },
      status,
      coordinationLossClassification,
      preservedDimensions,
      missingDimensions,
      weakDimensions,
      positiveFollowUps,
      sourceActions: {
        inspected: ['dashboard-api.coordinationMeaningPreservationProfile'],
        referenced: ['vdmi.dossier', 'interface-placeholder.requestEvidence'],
        notCalled: [
          'external.connector.call',
          'fachsystem.write',
          'hitl.create',
          'billing.release',
          'settlement.prepareBilling',
          'settlement.exportA96',
          'mako.dispatch',
          'tariff.mutate',
          'device-control.execute',
          'budibase.write',
        ],
      },
      validationFindings,
      dossierEvidence: {
        status,
        coordinationLossClassification,
        sourceDomain: params.sourceDomain || null,
        targetDomain: params.targetDomain || null,
        preservedDimensions,
        missingDimensions,
        weakDimensions,
        positiveFollowUps,
        dossierFacts,
        sourceActions: {
          notCalled: [
            'external.connector.call',
            'fachsystem.write',
            'hitl.create',
            'billing.release',
            'settlement.prepareBilling',
            'settlement.exportA96',
            'mako.dispatch',
            'tariff.mutate',
            'device-control.execute',
            'budibase.write',
          ],
        },
      },
    };
  },

  buildA2mdmDecisionObjectStatus(params = {}) {
    const hasValue = (value) => value !== undefined && value !== null && String(value) !== '';
    const fields = [
      {
        id: 'subject',
        label: 'Subject',
        value: params.subject || 'Stadtwerk Mauer Anschluss-/Steuerbarkeitsfreigabe',
        category: 'decision_subject',
        required: true,
        enablesDossierAddition: 'add a clearer decision subject row',
      },
      {
        id: 'business_intent',
        label: 'Business intent',
        value: params.businessIntent,
        category: 'business_meaning',
        required: true,
        enablesDossierAddition: 'add business purpose and commercial intent context',
      },
      {
        id: 'technical_constraint',
        label: 'Technical constraint',
        value: params.technicalConstraint,
        category: 'technical_meaning',
        required: true,
        enablesDossierAddition: 'add technical feasibility and constraint context',
      },
      {
        id: 'regulatory_reference',
        label: 'Regulatory reference',
        value: params.regulatoryReference,
        category: 'regulatory_meaning',
        required: true,
        enablesDossierAddition: 'add regulatory-context display without legal interpretation',
      },
      {
        id: 'evidence_source',
        label: 'Evidence source',
        value: params.evidenceSource,
        category: 'provenance',
        required: true,
        enablesDossierAddition: 'add provenance and source-version evidence',
      },
      {
        id: 'owner_role',
        label: 'Owner role',
        value: params.ownerRole,
        category: 'ownership',
        required: true,
        enablesDossierAddition: 'add accountable owner role for handover readiness',
      },
      {
        id: 'risk_level',
        label: 'Risk level',
        value: params.riskLevel,
        category: 'risk',
        required: true,
        enablesDossierAddition: 'add risk classification for human review',
      },
      {
        id: 'decision_threshold',
        label: 'Decision threshold',
        value: params.decisionThreshold,
        category: 'threshold',
        required: true,
        enablesDossierAddition: 'add threshold criteria without approving the decision',
      },
      {
        id: 'next_gate',
        label: 'Next gate',
        value: params.nextGate,
        category: 'next_gate',
        required: true,
        enablesDossierAddition: 'add next safe gate for dossier review',
      },
    ];
    const decisionRows = fields.map((field) => ({
      rowId: field.id,
      label: field.label,
      value: hasValue(field.value) ? String(field.value) : 'missing',
      category: field.category,
      evidenceStatus: hasValue(field.value) ? 'provided' : 'missing',
      scalar: true,
    }));
    const missingInputs = fields
      .filter((field) => field.required && !hasValue(field.value))
      .map((field) => ({
        missingDataPoint: field.id,
        label: field.label,
        category: field.category,
        enablesDossierAddition: field.enablesDossierAddition,
      }));
    const positiveFollowUps = missingInputs.map((gap) => ({
      missingDataPoint: gap.missingDataPoint,
      enablesDossierAddition: gap.enablesDossierAddition,
      category: 'a2mdm_decision_object_meaning_preservation',
    }));
    const noCallGuards = [
      'a2mdm.persist',
      'a2mdm.workflow.start',
      'budibase.table.write',
      'landing-registry.publish',
      'mako.dispatch',
      'billing.release',
      'settlement.prepareBilling',
      'tariff.mutate',
      'device-control.execute',
      'smgw.cls.execute',
      'hitl.create',
      'workflow.execute',
      'external.connector.call',
      'personal-agent.execute',
    ];
    const status =
      missingInputs.length === 0 ? 'decision_context_preserved' : 'needs_decision_context';
    const caseId = params.caseId || 'stadtwerk-mauer-a2mdm-decision-seed';
    const decisionObjectId = `a2mdm-do:${Buffer.from(
      `${caseId}:${params.subject || 'stadtwerk-mauer'}:${params.ownerRole || ''}:${params.nextGate || ''}`
    )
      .toString('base64url')
      .slice(0, 28)}`;
    const dossierFacts = [
      `Status: ${status}`,
      `Decision Object: ${decisionObjectId}`,
      `Subject: ${decisionRows.find((row) => row.rowId === 'subject')?.value || 'missing'}`,
      `Provided meaning rows: ${decisionRows.length - missingInputs.length}/${decisionRows.length}`,
      `Open missing inputs: ${missingInputs.length}`,
    ];
    if (params.ownerRole) dossierFacts.push(`Owner: ${params.ownerRole}`);
    if (params.nextGate) dossierFacts.push(`Next Gate: ${params.nextGate}`);

    return {
      decisionObjectId,
      caseId,
      capabilityKey: 'a2mdm_decision_object_meaning_preservation',
      safety: 'read_only_decision_context_projection',
      status,
      subject: decisionRows.find((row) => row.rowId === 'subject')?.value || null,
      businessIntent: params.businessIntent || null,
      technicalConstraint: params.technicalConstraint || null,
      regulatoryReference: params.regulatoryReference || null,
      evidenceSource: params.evidenceSource || null,
      ownerRole: params.ownerRole || null,
      riskLevel: params.riskLevel || null,
      decisionThreshold: params.decisionThreshold || null,
      nextGate: params.nextGate || null,
      decisionRows,
      missingInputs,
      positiveFollowUps,
      noCallGuards,
      sourceActions: {
        inspected: ['dashboard-api.a2mdmDecisionObjectStatus'],
        referenced: [
          'dashboard-api.stadtwerkMauerCaseDetailStatus',
          'dashboard-api.interconnectionReleaseFileStatus',
          'dashboard-api.controllabilityAssetHandoverStatus',
          'vdmi.dossier',
        ],
        notCalled: noCallGuards,
      },
      validationFindings: missingInputs.map((gap) => ({
        code: `A2MDM_DO_${String(gap.missingDataPoint).toUpperCase()}_MISSING`,
        severity: ['owner_role', 'decision_threshold', 'next_gate'].includes(gap.missingDataPoint)
          ? 'high'
          : 'medium',
        message: gap.enablesDossierAddition,
      })),
      dossierEvidence: {
        capabilityKey: 'a2mdm_decision_object_meaning_preservation',
        status,
        decisionObjectId,
        caseId,
        decisionRows,
        missingInputs,
        positiveFollowUps,
        noCallGuards,
        dossierFacts,
        sourceActions: { notCalled: noCallGuards },
      },
    };
  },

  buildGremiencoachWorkbookReadinessStatus(params = {}) {
    const hasValue = (value) => value !== undefined && value !== null && String(value) !== '';
    const workbook = {
      tenantId: params.tenantId || null,
      workbookId: params.workbookId || 'synthetic-vnb-gremienmappe',
      committeeContext: params.committeeContext || 'private-board-prep',
      processHint: params.processHint || 'vdmi',
      evidenceProfile: params.evidenceProfile || 'anonymized-vnb-pattern',
    };
    const evidenceSpecs = [
      {
        id: 'source_register',
        label: 'Source register',
        value: params.sourceRegister,
        category: 'claim_evidence',
        enablesDossierAddition: 'add evidence-backed source register for committee-safe claims',
      },
      {
        id: 'process_role',
        label: 'Process role',
        value: params.processRole,
        category: 'process_context',
        enablesDossierAddition: 'add owner and decision-boundary row for the workbook',
      },
      {
        id: 'regulatory_reference',
        label: 'Regulatory reference',
        value: params.regulatoryReference,
        category: 'committee_context',
        enablesDossierAddition: 'add committee-safe regulatory context note',
      },
      {
        id: 'artifact_classification',
        label: 'Source artifact classification',
        value: params.artifactClassification,
        category: 'draft_artifact_intent',
        enablesDossierAddition: 'add allowed Word/PPT/Excel draft-intent description',
      },
      {
        id: 'release_boundary',
        label: 'Release boundary',
        value: params.releaseBoundary,
        category: 'publication_guard',
        enablesDossierAddition: 'add publication/no-publication guard decision',
      },
    ];
    const evidenceGapRows = evidenceSpecs
      .filter((spec) => !hasValue(spec.value))
      .map((spec) => ({
        gapId: spec.id,
        label: spec.label,
        missingDataPoint: spec.id,
        category: spec.category,
        severity: spec.id === 'release_boundary' ? 'high' : 'medium',
        enablesDossierAddition: spec.enablesDossierAddition,
      }));
    const positiveFollowUpRows = evidenceGapRows.map((gap) => ({
      missingDataPoint: gap.missingDataPoint,
      enablesDossierAddition: gap.enablesDossierAddition,
      category: 'gremiencoach_workbook_readiness',
    }));
    const claimRows = [
      {
        claimId: 'claim:evidence-backed-committee-summary',
        title: 'Committee summary may use the prepared VNB pattern',
        status: hasValue(params.sourceRegister) ? 'claimable_with_evidence' : 'not_yet_claimable',
        evidenceBinding: params.sourceRegister || 'missing_source_register',
        allowedUse: 'private-prep-summary',
      },
      {
        claimId: 'claim:process-owner-boundary',
        title: 'Process owner and decision boundary are explicit',
        status: hasValue(params.processRole) ? 'claimable_with_evidence' : 'not_yet_claimable',
        evidenceBinding: params.processRole || 'missing_process_role',
        allowedUse: 'internal-workbook-context',
      },
      {
        claimId: 'claim:regulatory-context-note',
        title: 'Regulatory context is available as committee-safe note',
        status: hasValue(params.regulatoryReference)
          ? 'claimable_with_evidence'
          : 'not_yet_claimable',
        evidenceBinding: params.regulatoryReference || 'missing_regulatory_reference',
        allowedUse: 'context-note-only',
      },
    ];
    if (params.includeSyntheticRows) {
      claimRows.push({
        claimId: 'claim:synthetic-vnb-lesson',
        title: 'Synthetic VNB lesson can be reused as anonymized pattern',
        status: 'claimable_with_evidence',
        evidenceBinding: 'synthetic:stadtwerke-vnb-pattern',
        allowedUse: 'anonymized-example',
      });
    }
    const processContextRows = [
      {
        rowId: 'context:committee',
        label: 'Committee context',
        value: workbook.committeeContext,
        vdmiClass: 'I',
      },
      {
        rowId: 'context:process',
        label: 'Process / VDMI hint',
        value: workbook.processHint,
        vdmiClass: 'V',
      },
      {
        rowId: 'context:evidence-profile',
        label: 'Evidence profile',
        value: workbook.evidenceProfile,
        vdmiClass: 'D',
      },
      {
        rowId: 'context:process-role',
        label: 'Process role',
        value: params.processRole || 'missing',
        vdmiClass: 'M',
      },
    ];
    const draftArtifactRows = [
      {
        artifactId: 'draft:word-briefing-outline',
        artifactType: 'word_outline',
        intent: 'describe allowed briefing outline sections',
        status: hasValue(params.artifactClassification) ? 'intent_allowed' : 'needs_classification',
        createsFile: false,
        evidenceBinding: params.artifactClassification || 'missing_artifact_classification',
      },
      {
        artifactId: 'draft:ppt-claim-evidence-map',
        artifactType: 'ppt_outline',
        intent: 'describe claim-to-evidence slide intent',
        status: hasValue(params.sourceRegister) ? 'intent_allowed' : 'needs_source_register',
        createsFile: false,
        evidenceBinding: params.sourceRegister || 'missing_source_register',
      },
      {
        artifactId: 'draft:excel-gap-table',
        artifactType: 'excel_table_schema',
        intent: 'describe gap table columns for manual review',
        status: 'intent_allowed',
        createsFile: false,
        evidenceBinding: 'schema-only',
      },
    ];
    const guardrailRows = [
      {
        guardrailId: 'no_private_document_ingestion',
        guardrailClass: 'privacy',
        status: 'enforced',
        description: 'No upload, parsing, retention, embedding or training on private documents.',
      },
      {
        guardrailId: 'no_office_generation',
        guardrailClass: 'office',
        status: 'enforced',
        description: 'Draft rows describe intents only and create no Word/PPT/Excel files.',
      },
      {
        guardrailId: 'no_m365_or_external_connector',
        guardrailClass: 'connector',
        status: 'enforced',
        description: 'No M365, SharePoint, Graph, mail, calendar, task or external connector call.',
      },
      {
        guardrailId: 'no_publication_or_decision',
        guardrailClass: 'publication',
        status: hasValue(params.releaseBoundary) ? 'evidence_provided' : 'needs_release_boundary',
        description:
          'No publication, approval, finance/legal/regulatory decision or workflow execution.',
      },
      {
        guardrailId: 'no_personal_agent_shortcut',
        guardrailClass: 'routing',
        status: 'enforced',
        description:
          'Consumption must use broker/hydration/dossier metadata, not Personal Agent hardcoding.',
      },
    ];
    const status =
      evidenceGapRows.length === 0
        ? 'ready_for_private_prep'
        : hasValue(params.sourceRegister)
          ? 'needs_workbook_governance_evidence'
          : 'needs_source_evidence';
    const dossierFacts = [
      `Status: ${status}`,
      `Claim rows: ${claimRows.length}`,
      `Open evidence gaps: ${evidenceGapRows.length}`,
      `Draft artifact intents: ${draftArtifactRows.length}`,
    ];
    if (workbook.workbookId) dossierFacts.push(`Workbook: ${workbook.workbookId}`);
    if (workbook.committeeContext)
      dossierFacts.push(`Committee context: ${workbook.committeeContext}`);

    return {
      readinessId: `gcwr:${Buffer.from(
        `${workbook.tenantId || ''}:${workbook.workbookId}:${workbook.committeeContext}:${workbook.processHint}`
      )
        .toString('base64url')
        .slice(0, 24)}`,
      capabilityKey: 'gremiencoach_workbook_readiness',
      safety: 'read_only',
      requestContext: workbook,
      status,
      claimRows,
      evidenceGapRows,
      processContextRows,
      draftArtifactRows,
      guardrailRows,
      positiveFollowUpRows,
      sourceActions: {
        inspected: ['dashboard-api.gremiencoachWorkbookReadinessStatus'],
        referenced: ['vdmi.dossier', 'interface-placeholder.requestEvidence'],
        notCalled: [
          'document.upload',
          'document.parse',
          'embedding.create',
          'office.word.create',
          'office.powerpoint.create',
          'office.excel.create',
          'm365.graph.call',
          'sharepoint.write',
          'mail.send',
          'calendar.create',
          'task.create',
          'publication.publish',
          'hitl.create',
          'workflow.execute',
          'settlement.exportA96',
          'settlement.prepareBilling',
          'billing.release',
          'tariff.mutate',
          'device-control.execute',
          'external.connector.call',
          'personal-agent.execute',
        ],
      },
      validationFindings: evidenceGapRows.map((gap) => ({
        code: `GCWR_${String(gap.missingDataPoint).toUpperCase()}_MISSING`,
        severity: gap.severity,
        message: gap.enablesDossierAddition,
      })),
      dossierEvidence: {
        capabilityKey: 'gremiencoach_workbook_readiness',
        status,
        claimRows,
        evidenceGapRows,
        processContextRows,
        draftArtifactRows,
        guardrailRows,
        positiveFollowUpRows,
        dossierFacts,
      },
    };
  },

  buildDecisionReadinessMatrixStatus(params = {}) {
    const normalizeList = (value) => {
      if (Array.isArray(value)) return value.map((item) => String(item).trim()).filter(Boolean);
      if (value == null || value === '') return [];
      return String(value)
        .split(',')
        .map((item) => item.trim())
        .filter(Boolean);
    };
    const hasValue = (value) => value !== undefined && value !== null && String(value) !== '';
    const blockers = normalizeList(params.blockers);
    const openEvidence = normalizeList(params.openEvidence);
    const baseRow = {
      measureId: params.measureId || 'measure:decision-readiness',
      measureName: params.measureName || 'Decision-readiness measure',
      category: params.category || null,
      budgetStatus: params.budgetStatus || null,
      financingOption: params.financingOption || null,
      riskIfNotImplemented: params.riskIfNotImplemented || null,
      evidenceSource: params.evidenceSource || null,
      owner: params.owner || null,
      committeeWindow: params.committeeWindow || null,
      nextDecisionPoint: params.nextDecisionPoint || null,
      blockers,
      openEvidence,
    };
    const rows = [baseRow];
    if (params.includeSyntheticRows) {
      rows.push({
        measureId: 'synthetic:no-regret-grid-study',
        measureName: 'Synthetic no-regret grid study',
        category: 'no_regret',
        budgetStatus: 'minimum-budget-confirmed',
        financingOption: 'internal-planning-budget',
        riskIfNotImplemented: 'capacity-decision-delay',
        evidenceSource: 'synthetic:opl-row',
        owner: 'Netzplanung',
        committeeWindow: '2026-Q3',
        nextDecisionPoint: 'investment-committee',
        blockers: [],
        openEvidence: [],
      });
    }

    const classifyRow = (row) => {
      if (!hasValue(row.measureName) || !hasValue(row.category)) return 'informational';
      if (!hasValue(row.owner)) return 'owner_needed';
      if (!hasValue(row.evidenceSource) || row.openEvidence.length > 0) return 'evidence_gap';
      if (
        /risk|kritisch|critical|offen|unconfirmed|unknown|unklar|gap/i.test(
          `${row.budgetStatus || ''} ${row.financingOption || ''}`
        )
      ) {
        return 'financing_risk';
      }
      if (row.blockers.length > 0) return 'evidence_gap';
      if (
        hasValue(row.budgetStatus) &&
        hasValue(row.financingOption) &&
        hasValue(row.riskIfNotImplemented) &&
        hasValue(row.committeeWindow) &&
        hasValue(row.nextDecisionPoint)
      ) {
        return 'decision_ready';
      }
      return 'evidence_gap';
    };

    const evidenceSpecs = [
      {
        id: 'category',
        label: 'Measure category',
        value: baseRow.category,
        enablesDossierAddition: 'add measure category and OPL grouping',
      },
      {
        id: 'budget_status',
        label: 'Budget status',
        value: baseRow.budgetStatus,
        enablesDossierAddition: 'add budget-readiness classification',
      },
      {
        id: 'financing_option',
        label: 'Financing option',
        value: baseRow.financingOption,
        enablesDossierAddition: 'add financing-risk evidence, not a financing decision',
      },
      {
        id: 'risk_if_not_implemented',
        label: 'Risk if not implemented',
        value: baseRow.riskIfNotImplemented,
        enablesDossierAddition: 'add non-implementation risk context',
      },
      {
        id: 'evidence_source',
        label: 'Evidence source',
        value: baseRow.evidenceSource,
        enablesDossierAddition: 'add source traceability',
      },
      {
        id: 'owner',
        label: 'Decision owner',
        value: baseRow.owner,
        enablesDossierAddition: 'add accountable decision owner and escalation target',
      },
      {
        id: 'committee_window',
        label: 'Committee window',
        value: baseRow.committeeWindow,
        enablesDossierAddition: 'add committee-window evidence',
      },
      {
        id: 'next_decision_point',
        label: 'Next decision point',
        value: baseRow.nextDecisionPoint,
        enablesDossierAddition: 'add next decision-point evidence',
      },
    ];
    const classifiedRows = rows.map((row, index) => ({
      ...row,
      rowId: row.measureId || `row:${index + 1}`,
      readiness: classifyRow(row),
      evidenceStatus:
        !hasValue(row.evidenceSource) || row.openEvidence.length > 0 ? 'incomplete' : 'provided',
    }));
    const readinessCounts = classifiedRows.reduce((acc, row) => {
      acc[row.readiness] = (acc[row.readiness] || 0) + 1;
      return acc;
    }, {});
    const missingEvidence = evidenceSpecs
      .filter((spec) => !hasValue(spec.value))
      .map((spec) => ({
        missingDataPoint: spec.id,
        label: spec.label,
        enablesDossierAddition: spec.enablesDossierAddition,
      }));
    for (const evidenceGap of openEvidence) {
      missingEvidence.push({
        missingDataPoint: 'open_evidence',
        label: evidenceGap,
        enablesDossierAddition: `add open evidence: ${evidenceGap}`,
      });
    }
    for (const blocker of blockers) {
      missingEvidence.push({
        missingDataPoint: 'blocker',
        label: blocker,
        enablesDossierAddition: `add blocker resolution evidence: ${blocker}`,
      });
    }
    const status = classifiedRows.some((row) => row.readiness === 'financing_risk')
      ? 'financing_risk'
      : classifiedRows.every((row) => row.readiness === 'decision_ready')
        ? 'decision_ready'
        : classifiedRows.some((row) => row.readiness === 'owner_needed')
          ? 'owner_needed'
          : missingEvidence.length > 0
            ? 'evidence_gap'
            : 'informational';
    const positiveFollowUps = missingEvidence.map((item) => ({
      missingDataPoint: item.missingDataPoint,
      enablesDossierAddition: item.enablesDossierAddition,
      category: 'decision_readiness_matrix',
    }));
    const decisionBoundaries = [
      {
        boundary: 'Budget and financing fields classify evidence only; they do not approve spend.',
      },
      {
        boundary:
          'Committee windows and next decision points are planning facts, not workflow triggers.',
      },
      {
        boundary:
          'No SAP/ERP, procurement, HITL, billing, settlement, tariff, MaKo or device-control action is called.',
      },
    ];
    const dossierFacts = [
      `Status: ${status}`,
      `Rows: ${classifiedRows.length}`,
      `Decision-ready rows: ${readinessCounts.decision_ready || 0}`,
      `Open gaps: ${missingEvidence.length}`,
    ];
    if (params.caseId) dossierFacts.push(`Case: ${params.caseId}`);
    if (baseRow.owner) dossierFacts.push(`Owner: ${baseRow.owner}`);
    if (baseRow.nextDecisionPoint)
      dossierFacts.push(`Next Decision Point: ${baseRow.nextDecisionPoint}`);

    return {
      matrixId: `drm:${Buffer.from(
        `${params.caseId || ''}:${baseRow.measureId}:${baseRow.owner || ''}:${baseRow.nextDecisionPoint || ''}`
      )
        .toString('base64url')
        .slice(0, 24)}`,
      capabilityKey: 'decision_readiness_matrix',
      safety: 'read_only',
      requestContext: {
        caseId: params.caseId || null,
        includeSyntheticRows: Boolean(params.includeSyntheticRows),
      },
      status,
      rows: classifiedRows,
      readinessCounts,
      missingEvidence,
      positiveFollowUps,
      decisionBoundaries,
      dossierFacts,
      sourceActions: {
        inspected: ['dashboard-api.decisionReadinessMatrixStatus'],
        referenced: ['vdmi.dossier', 'evidence-registry.findings', 'decision-frame.list'],
        notCalled: [
          'budget.approve',
          'finance.book',
          'procurement.create',
          'sap.erp.write',
          'hitl.create',
          'workflow.execute',
          'webhook.emit',
          'mail.send',
          'billing.release',
          'settlement.prepareBilling',
          'tariff.mutate',
          'mako.dispatch',
          'device-control.execute',
          'external.connector.call',
        ],
      },
      validationFindings: missingEvidence.map((item) => ({
        code: `DRM_${String(item.missingDataPoint).toUpperCase()}_MISSING`,
        severity: ['owner', 'budget_status', 'financing_option'].includes(item.missingDataPoint)
          ? 'high'
          : 'medium',
        message: item.enablesDossierAddition,
      })),
      dossierEvidence: {
        status,
        rows: classifiedRows,
        readinessCounts,
        missingEvidence,
        positiveFollowUps,
        decisionBoundaries,
        dossierFacts,
      },
    };
  },

  buildModelViabilityEvidenceGateStatus(params = {}) {
    const isProvided = (value) =>
      value !== undefined && value !== null && String(value).trim() !== '';
    const toList = (value) => {
      if (Array.isArray(value))
        return value.map((item) => String(item || '').trim()).filter(Boolean);
      if (value == null || value === '') return [];
      return String(value)
        .split(',')
        .map((item) => item.trim())
        .filter(Boolean);
    };
    const assumptionOnlyDimensions = new Set(toList(params.assumptionOnlyDimensions));

    const candidateContext = {
      candidateId: params.candidateId || null,
      candidateName: params.candidateName || null,
      modelType: params.modelType || null,
      scope: params.scope || null,
      evidenceSnapshotRef: params.evidenceSnapshotRef || null,
    };

    const dimensionSpecs = [
      {
        id: 'candidate_identity',
        label: 'Candidate/model identity and scope',
        values: {
          candidateName: params.candidateName || params.candidateId || null,
          modelType: params.modelType || null,
          scope: params.scope || null,
        },
        provided:
          isProvided(params.candidateName || params.candidateId) &&
          isProvided(params.modelType) &&
          isProvided(params.scope),
        enablesDossierAddition:
          'add candidate identity, model type and scope for a comparable evidence row',
      },
      {
        id: 'evidence_snapshot',
        label: 'Evidence snapshot reference',
        values: { evidenceSnapshotRef: params.evidenceSnapshotRef || null },
        provided: isProvided(params.evidenceSnapshotRef),
        enablesDossierAddition: 'add an evidence snapshot reference for traceability',
      },
      {
        id: 'process_cost',
        label: 'Process-cost band/reference',
        values: {
          processCostBand: params.processCostBand || null,
          processCostReference: params.processCostReference || null,
        },
        provided: isProvided(params.processCostBand),
        enablesDossierAddition:
          'add a supplied process-cost band or reference for the candidate model',
      },
      {
        id: 'exception_case_rate',
        label: 'Exception-case rate/band and owner',
        values: {
          exceptionCaseRateBand: params.exceptionCaseRateBand || null,
          exceptionCaseOwner: params.exceptionCaseOwner || null,
        },
        provided: isProvided(params.exceptionCaseRateBand) && isProvided(params.exceptionCaseOwner),
        enablesDossierAddition: 'add exception-case rate/band evidence and an accountable owner',
      },
      {
        id: 'liquidity_impact',
        label: 'Liquidity-impact band/reference',
        values: {
          liquidityImpactBand: params.liquidityImpactBand || null,
          liquidityImpactReference: params.liquidityImpactReference || null,
        },
        provided: isProvided(params.liquidityImpactBand),
        enablesDossierAddition: 'add a supplied liquidity-impact band or reference',
      },
      {
        id: 'data_maturity_metering',
        label: 'Data maturity — metering',
        values: { dataMaturityMetering: params.dataMaturityMetering || null },
        provided: isProvided(params.dataMaturityMetering),
        enablesDossierAddition: 'add metering data-maturity evidence',
      },
      {
        id: 'data_maturity_roles',
        label: 'Data maturity — roles',
        values: { dataMaturityRoles: params.dataMaturityRoles || null },
        provided: isProvided(params.dataMaturityRoles),
        enablesDossierAddition: 'add role data-maturity evidence',
      },
      {
        id: 'data_maturity_time_series',
        label: 'Data maturity — time series',
        values: { dataMaturityTimeSeries: params.dataMaturityTimeSeries || null },
        provided: isProvided(params.dataMaturityTimeSeries),
        enablesDossierAddition: 'add time-series data-maturity evidence',
      },
      {
        id: 'data_maturity_source_freshness',
        label: 'Data maturity — source freshness',
        values: { dataMaturitySourceFreshness: params.dataMaturitySourceFreshness || null },
        provided: isProvided(params.dataMaturitySourceFreshness),
        enablesDossierAddition: 'add source-freshness evidence for the underlying data',
      },
      {
        id: 'governance_effort',
        label: 'Governance-effort band, decision owner and next review gate',
        values: {
          governanceEffortBand: params.governanceEffortBand || null,
          governanceDecisionOwner: params.governanceDecisionOwner || null,
          nextReviewGate: params.nextReviewGate || null,
        },
        provided:
          isProvided(params.governanceEffortBand) &&
          isProvided(params.governanceDecisionOwner) &&
          isProvided(params.nextReviewGate),
        enablesDossierAddition: 'add governance-effort band, decision owner and next review gate',
      },
    ];

    const rows = dimensionSpecs.map((spec) => ({
      dimensionId: spec.id,
      label: spec.label,
      values: spec.values,
      evidenceStatus: !spec.provided
        ? 'missing'
        : assumptionOnlyDimensions.has(spec.id)
          ? 'assumption_only'
          : 'provided',
    }));

    const missingEvidence = rows
      .filter((row) => row.evidenceStatus === 'missing')
      .map((row) => {
        const spec = dimensionSpecs.find((item) => item.id === row.dimensionId);
        return {
          missingDataPoint: row.dimensionId,
          label: row.label,
          enablesDossierAddition: spec.enablesDossierAddition,
        };
      });

    const positiveFollowUps = rows
      .filter((row) => row.evidenceStatus !== 'provided')
      .map((row) => {
        const spec = dimensionSpecs.find((item) => item.id === row.dimensionId);
        return {
          missingDataPoint: row.dimensionId,
          evidenceStatus: row.evidenceStatus,
          enablesDossierAddition: spec.enablesDossierAddition,
          category: 'model_viability_evidence_gate',
        };
      });

    const providedCount = rows.filter((row) => row.evidenceStatus === 'provided').length;
    const assumptionOnlyCount = rows.filter(
      (row) => row.evidenceStatus === 'assumption_only'
    ).length;

    const status = rows.some((row) => row.evidenceStatus === 'missing')
      ? 'blocked_missing_evidence'
      : assumptionOnlyCount > 0
        ? 'assumption_heavy'
        : 'ready_for_management_review';

    const readinessScore = Number((providedCount / rows.length).toFixed(2));

    const decisionBoundaries = [
      {
        boundary:
          'This is a normalized evidence view, not a viability verdict, legal interpretation, regulatory approval or business-case result.',
      },
      {
        boundary:
          'No model ranking, weighted scoring, economics calculation or winner selection is produced; one candidate is evaluated per request.',
      },
      {
        boundary:
          'No tariff, contract, allocation, onboarding, billing, settlement, MaKo/A96, finance, procurement, workflow, HITL, connector, market-communication or device-control action is called.',
      },
    ];

    const dossierFacts = [
      `Status: ${status}`,
      `Provided dimensions: ${providedCount}/${rows.length}`,
      `Assumption-only dimensions: ${assumptionOnlyCount}`,
      `Missing dimensions: ${missingEvidence.length}`,
    ];
    if (candidateContext.candidateName || candidateContext.candidateId) {
      dossierFacts.push(
        `Candidate: ${candidateContext.candidateName || candidateContext.candidateId}`
      );
    }
    if (candidateContext.modelType) dossierFacts.push(`Model type: ${candidateContext.modelType}`);

    return {
      modelViabilityGateId: `mveg:${Buffer.from(
        `${candidateContext.candidateId || ''}:${candidateContext.candidateName || ''}:${candidateContext.modelType || ''}:${candidateContext.evidenceSnapshotRef || ''}`
      )
        .toString('base64url')
        .slice(0, 24)}`,
      capabilityKey: 'model_viability_evidence_gate',
      safety: 'read_only',
      requestContext: candidateContext,
      status,
      readinessScore,
      candidateContext,
      rows,
      missingEvidence,
      positiveFollowUps,
      decisionBoundaries,
      dossierFacts,
      sourceActions: {
        inspected: ['dashboard-api.modelViabilityEvidenceGateStatus'],
        referenced: [
          'vdmi.dossier',
          'presentation.generate',
          'decision_readiness_matrix',
          'energy_sharing_simulation_gate',
          'automation_requirements_decision_value',
          'liquidity_planning_governance_module',
        ],
        notCalled: [
          'tariff.mutate',
          'contract.create',
          'energy-sharing-allocation.allocate',
          'onboarding.create',
          'billing.release',
          'settlement.exportA96',
          'mako.dispatch',
          'finance.book',
          'procurement.create',
          'workflow.execute',
          'hitl.create',
          'external.connector.call',
          'market-communication.send',
          'device-control.execute',
          'personal-agent.execute',
        ],
      },
      dossierEvidence: {
        capabilityKey: 'model_viability_evidence_gate',
        status,
        readinessScore,
        candidateContext,
        rows,
        missingEvidence,
        positiveFollowUps,
        decisionBoundaries,
        dossierFacts,
      },
    };
  },

  buildCrossSystemVarianceMatrixStatus(params = {}) {
    const normalizeList = (value) => {
      if (Array.isArray(value)) return value.map((item) => String(item).trim()).filter(Boolean);
      if (value == null || value === '') return [];
      return String(value)
        .split(',')
        .map((item) => item.trim())
        .filter(Boolean);
    };
    const hasValue = (value) => value !== undefined && value !== null && String(value) !== '';
    const openEvidence = normalizeList(params.openEvidence);
    const amountEur =
      params.amountEur === undefined || params.amountEur === null || params.amountEur === ''
        ? null
        : Number(params.amountEur);
    const baseRow = {
      varianceId: params.varianceId || 'variance:cross-system',
      sourceSystem: params.sourceSystem || null,
      targetSystem: params.targetSystem || null,
      domain: params.domain || null,
      affectedObject: params.affectedObject || null,
      amountEur: Number.isFinite(amountEur) ? amountEur : null,
      revenueImpact: params.revenueImpact || null,
      assetScope: params.assetScope || null,
      owner: params.owner || null,
      deadline: params.deadline || null,
      evidence: params.evidence || null,
      threshold: params.threshold || null,
      resolutionStatus: params.resolutionStatus || null,
      openEvidence,
    };
    const rows = [baseRow];
    if (params.includeSyntheticRows) {
      rows.push({
        varianceId: 'synthetic:gis-asset-revenue-delta',
        sourceSystem: 'synthetic:gis',
        targetSystem: 'synthetic:revenue-ledger',
        domain: 'asset_revenue',
        affectedObject: 'NAP-4711',
        amountEur: 12500,
        revenueImpact: 'material-revenue-delta',
        assetScope: 'medium-voltage-feeder',
        owner: 'Assetmanagement',
        deadline: '2026-Q3',
        evidence: 'synthetic:variance-ticket',
        threshold: 'management-threshold',
        resolutionStatus: 'ready-for-management-review',
        openEvidence: [],
      });
    }

    const classifyRow = (row) => {
      if (
        !hasValue(row.sourceSystem) ||
        !hasValue(row.targetSystem) ||
        !hasValue(row.affectedObject)
      ) {
        return 'evidence_gap';
      }
      if (!hasValue(row.owner)) return 'needs_owner';
      if (!hasValue(row.evidence) || row.openEvidence.length > 0) return 'evidence_gap';
      if (
        /asset|gis|mdm|anlage|anschluss|nap|melo|malo|scope/i.test(
          `${row.domain || ''} ${row.assetScope || ''} ${row.affectedObject || ''}`
        ) &&
        !hasValue(row.assetScope)
      ) {
        return 'asset_scope_risk';
      }
      if (
        Number.isFinite(row.amountEur) &&
        Math.abs(row.amountEur) > 0 &&
        /revenue|erlos|erlös|budget|finance|umsatz|abrechnung/i.test(
          `${row.domain || ''} ${row.revenueImpact || ''}`
        )
      ) {
        return hasValue(row.threshold) && hasValue(row.deadline)
          ? 'management_ready'
          : 'revenue_risk';
      }
      if (hasValue(row.threshold) && hasValue(row.deadline) && hasValue(row.resolutionStatus)) {
        return 'management_ready';
      }
      return 'informational';
    };

    const evidenceSpecs = [
      {
        id: 'source_system',
        label: 'Source system',
        value: baseRow.sourceSystem,
        enablesDossierAddition: 'add source-system lineage for the variance',
      },
      {
        id: 'target_system',
        label: 'Target system',
        value: baseRow.targetSystem,
        enablesDossierAddition: 'add comparison target and reconciliation boundary',
      },
      {
        id: 'affected_object',
        label: 'Affected object',
        value: baseRow.affectedObject,
        enablesDossierAddition: 'add asset, revenue object or planning object scope',
      },
      {
        id: 'amount_eur',
        label: 'Amount / impact in EUR',
        value: baseRow.amountEur,
        enablesDossierAddition: 'add quantified revenue or budget impact',
      },
      {
        id: 'revenue_impact',
        label: 'Revenue / budget impact',
        value: baseRow.revenueImpact,
        enablesDossierAddition: 'add revenue or budget risk explanation',
      },
      {
        id: 'asset_scope',
        label: 'Asset scope',
        value: baseRow.assetScope,
        enablesDossierAddition: 'add asset or grid-scope evidence',
      },
      {
        id: 'owner',
        label: 'Variance owner',
        value: baseRow.owner,
        enablesDossierAddition: 'add accountable clarification owner',
      },
      {
        id: 'deadline',
        label: 'Clarification deadline',
        value: baseRow.deadline,
        enablesDossierAddition: 'add SLA or management deadline tracking',
      },
      {
        id: 'evidence',
        label: 'Evidence reference',
        value: baseRow.evidence,
        enablesDossierAddition: 'add official evidence reference',
      },
      {
        id: 'threshold',
        label: 'Management threshold',
        value: baseRow.threshold,
        enablesDossierAddition: 'add management-threshold readiness',
      },
    ];
    const classifiedRows = rows.map((row, index) => ({
      ...row,
      rowId: row.varianceId || `row:${index + 1}`,
      varianceState: classifyRow(row),
      evidenceStatus:
        !hasValue(row.evidence) || row.openEvidence.length > 0 ? 'incomplete' : 'provided',
    }));
    const varianceCounts = classifiedRows.reduce((acc, row) => {
      acc[row.varianceState] = (acc[row.varianceState] || 0) + 1;
      return acc;
    }, {});
    const missingEvidence = evidenceSpecs
      .filter((spec) => !hasValue(spec.value))
      .map((spec) => ({
        missingDataPoint: spec.id,
        label: spec.label,
        enablesDossierAddition: spec.enablesDossierAddition,
      }));
    for (const evidenceGap of openEvidence) {
      missingEvidence.push({
        missingDataPoint: 'open_evidence',
        label: evidenceGap,
        enablesDossierAddition: `add open variance evidence: ${evidenceGap}`,
      });
    }
    const status = classifiedRows.some((row) => row.varianceState === 'revenue_risk')
      ? 'revenue_risk'
      : classifiedRows.some((row) => row.varianceState === 'asset_scope_risk')
        ? 'asset_scope_risk'
        : classifiedRows.every((row) => row.varianceState === 'management_ready')
          ? 'management_ready'
          : classifiedRows.some((row) => row.varianceState === 'needs_owner')
            ? 'needs_owner'
            : missingEvidence.length > 0
              ? 'evidence_gap'
              : 'informational';
    const positiveFollowUps = missingEvidence.map((item) => ({
      missingDataPoint: item.missingDataPoint,
      enablesDossierAddition: item.enablesDossierAddition,
      category: 'cross_system_variance_matrix',
    }));
    const decisionBoundaries = [
      {
        boundary:
          'Variance rows classify caller-supplied evidence only; they do not reconcile or correct source systems.',
      },
      {
        boundary:
          'Revenue, budget and asset hints are risk context, not booking, billing, settlement or master-data authority.',
      },
      {
        boundary:
          'No ERP/SAP/GIS/MDM connector, workflow, HITL, webhook, MaKo, tariff or device-control action is called.',
      },
    ];
    const dossierFacts = [
      `Status: ${status}`,
      `Rows: ${classifiedRows.length}`,
      `Management-ready rows: ${varianceCounts.management_ready || 0}`,
      `Open gaps: ${missingEvidence.length}`,
    ];
    if (params.caseId) dossierFacts.push(`Case: ${params.caseId}`);
    if (baseRow.owner) dossierFacts.push(`Owner: ${baseRow.owner}`);
    if (baseRow.sourceSystem && baseRow.targetSystem)
      dossierFacts.push(`Systems: ${baseRow.sourceSystem} -> ${baseRow.targetSystem}`);

    return {
      matrixId: `csvm:${Buffer.from(
        `${params.caseId || ''}:${baseRow.varianceId}:${baseRow.sourceSystem || ''}:${baseRow.targetSystem || ''}`
      )
        .toString('base64url')
        .slice(0, 24)}`,
      capabilityKey: 'cross_system_variance_matrix',
      safety: 'read_only',
      requestContext: {
        caseId: params.caseId || null,
        includeSyntheticRows: Boolean(params.includeSyntheticRows),
      },
      status,
      rows: classifiedRows,
      varianceCounts,
      missingEvidence,
      positiveFollowUps,
      decisionBoundaries,
      dossierFacts,
      sourceActions: {
        inspected: ['dashboard-api.crossSystemVarianceMatrixStatus'],
        referenced: [
          'vdmi.dossier',
          'evidence-registry.findings',
          'variance-register.suppliedFacts',
        ],
        notCalled: [
          'erp.sap.read',
          'erp.sap.write',
          'gis.sync',
          'asset-mdm.correct',
          'revenue.book',
          'budget.approve',
          'finance.book',
          'billing.release',
          'settlement.prepareBilling',
          'tariff.mutate',
          'mako.dispatch',
          'hitl.create',
          'workflow.execute',
          'webhook.emit',
          'mail.send',
          'device-control.execute',
          'external.connector.call',
        ],
      },
      validationFindings: missingEvidence.map((item) => ({
        code: `CSVM_${String(item.missingDataPoint).toUpperCase()}_MISSING`,
        severity: ['owner', 'source_system', 'target_system', 'affected_object'].includes(
          item.missingDataPoint
        )
          ? 'high'
          : 'medium',
        message: item.enablesDossierAddition,
      })),
      dossierEvidence: {
        status,
        rows: classifiedRows,
        varianceCounts,
        missingEvidence,
        positiveFollowUps,
        decisionBoundaries,
        dossierFacts,
      },
    };
  },

  buildRegulatorySignalProcessTranslatorStatus(params = {}) {
    const hasValue = (value) => value !== undefined && value !== null && String(value) !== '';
    const normalize = (value) => String(value || '').trim();
    const textBlob = [params.affectedDomain, params.processHint, params.signalText, params.summary]
      .filter(Boolean)
      .join(' ')
      .toLowerCase();
    const sourceSummary = normalize(params.summary || params.signalText).slice(0, 360);
    const domainProfiles = [
      {
        key: 'metering_operations',
        label: 'Metering operations',
        rx: /messstellenbetrieb|metering|imsys|smart.?meter|msb|melo|malo/i,
        data: ['MaLo/MeLo reference', 'metering-role boundary', 'rollout or measurement status'],
        evidence: [
          'source signal reference',
          'affected metering process',
          'role responsibility proof',
        ],
        tests: ['metering-process impact check', 'role-boundary regression test'],
        gate: 'Metering owner confirms affected process and evidence scope',
      },
      {
        key: 'flexibility_grid_operations',
        label: 'Flexibility and grid operations',
        rx: /flex|steuerbar|14a|redispatch|netzbetrieb|grid|cls|smgw/i,
        data: [
          'asset controllability scope',
          'grid-operation decision boundary',
          'flexibility process status',
        ],
        evidence: [
          'asset/control evidence',
          'grid operations handover proof',
          'non-execution boundary',
        ],
        tests: ['read-only controllability evidence check', 'no device-control mutation smoke'],
        gate: 'Grid operations owner confirms control boundary remains non-executing',
      },
      {
        key: 'gas_heat_transformation',
        label: 'Gas / heat transformation',
        rx: /gas|waerme|wärme|heat|transformation|dekarbon/i,
        data: ['asset segment', 'transformation dependency', 'planning horizon'],
        evidence: ['asset roadmap reference', 'dependency evidence', 'owner/deadline proof'],
        tests: ['transformation dependency matrix check', 'planning-horizon evidence check'],
        gate: 'Transformation owner confirms dependency and planning horizon',
      },
      {
        key: 'market_communication',
        label: 'Market communication and handover',
        rx: /mako|marktkommunikation|utilmd|gpke|wim|handover|uebergabe|übergabe/i,
        data: ['market role', 'handover object', 'message/process boundary'],
        evidence: ['handover evidence', 'message boundary proof', 'market role ownership'],
        tests: ['handover evidence-chain check', 'no MaKo dispatch smoke'],
        gate: 'MaKo owner confirms evidence-only handover boundary',
      },
      {
        key: 'vnb_governance',
        label: 'VNB governance',
        rx: /vnb|governance|frist|deadline|nachweis|evidence|bnetza|regulatorik|prozess/i,
        data: ['process owner', 'deadline', 'evidence object'],
        evidence: ['signal provenance', 'owner assignment', 'decision-gate reference'],
        tests: ['owner/deadline/evidence completeness check', 'management-gate dossier smoke'],
        gate: 'Governance owner confirms next decision gate and missing evidence',
      },
    ];
    const matchedProfiles = domainProfiles.filter((profile) => profile.rx.test(textBlob));
    const selectedProfiles = matchedProfiles.length
      ? matchedProfiles
      : [domainProfiles[domainProfiles.length - 1]];
    const affectedProcesses = selectedProfiles.map((profile) => ({
      processKey: profile.key,
      label: params.processHint || profile.label,
      affectedDomain: params.affectedDomain || profile.label,
      ownerHint: params.ownerHint || null,
      deadlineHint: params.deadlineHint || null,
      confidence: matchedProfiles.length ? 'supplied_hint_match' : 'generic_governance_fallback',
    }));
    const uniq = (values) => Array.from(new Set(values.filter(Boolean)));
    const dataRequirements = uniq([
      ...selectedProfiles.flatMap((profile) => profile.data),
      params.processHint ? 'supplied process hint' : null,
      params.deadlineHint ? 'supplied deadline hint' : null,
      params.ownerHint ? 'supplied owner hint' : null,
    ]).map((label) => ({ label, status: 'required_for_operational_translation' }));
    const evidenceRequirements = uniq([
      ...selectedProfiles.flatMap((profile) => profile.evidence),
      params.evidenceHint || null,
    ]).map((label) => ({
      label,
      status: params.evidenceHint === label ? 'supplied' : 'required',
    }));
    const testCaseHints = uniq([
      ...selectedProfiles.flatMap((profile) => profile.tests),
      params.testCaseHint || null,
    ]).map((label) => ({ label, safety: 'read_only_test_hint' }));
    const decisionGates = uniq([
      ...selectedProfiles.map((profile) => profile.gate),
      params.deadlineHint ? `Deadline gate: ${params.deadlineHint}` : null,
    ]).map((label) => ({
      label,
      ownerHint: params.ownerHint || null,
      binding: 'operational_hint_only',
    }));
    const evidenceSpecs = [
      {
        id: 'signal_summary',
        label: 'Signal summary or text',
        value: sourceSummary,
        enablesDossierAddition: 'add supplied regulatory signal summary',
      },
      {
        id: 'source_name',
        label: 'Signal source',
        value: params.sourceName,
        enablesDossierAddition: 'add signal provenance and source name',
      },
      {
        id: 'published_at',
        label: 'Publication or observation date',
        value: params.publishedAt,
        enablesDossierAddition: 'add signal timing and freshness context',
      },
      {
        id: 'affected_domain',
        label: 'Affected domain',
        value: params.affectedDomain,
        enablesDossierAddition: 'add affected VNB/EVU domain mapping',
      },
      {
        id: 'process_hint',
        label: 'Process hint',
        value: params.processHint,
        enablesDossierAddition: 'add concrete process and data-field mapping',
      },
      {
        id: 'deadline_hint',
        label: 'Deadline hint',
        value: params.deadlineHint,
        enablesDossierAddition: 'add due-date and gate timing',
      },
      {
        id: 'owner_hint',
        label: 'Owner hint',
        value: params.ownerHint,
        enablesDossierAddition: 'add accountable process owner',
      },
      {
        id: 'evidence_hint',
        label: 'Evidence hint',
        value: params.evidenceHint,
        enablesDossierAddition: 'add concrete evidence object reference',
      },
      {
        id: 'test_case_hint',
        label: 'Test-case hint',
        value: params.testCaseHint,
        enablesDossierAddition: 'add implementation-test matrix detail',
      },
    ];
    const missingEvidence = evidenceSpecs
      .filter((spec) => !hasValue(spec.value))
      .map((spec) => ({
        missingDataPoint: spec.id,
        label: spec.label,
        enablesDossierAddition: spec.enablesDossierAddition,
      }));
    const status =
      !sourceSummary || !params.sourceName
        ? 'needs_signal_provenance'
        : !params.affectedDomain || !params.processHint
          ? 'needs_process_mapping'
          : !params.deadlineHint || !params.ownerHint || !params.evidenceHint
            ? 'needs_governance_evidence'
            : 'operational_translation_ready';
    const positiveFollowUps = missingEvidence.map((item) => ({
      missingDataPoint: item.missingDataPoint,
      enablesDossierAddition: item.enablesDossierAddition,
      category: 'regulatory_signal_process_translator',
    }));
    const decisionBoundaries = [
      {
        boundary:
          'The translator structures supplied facts into operational hints only; it does not provide legal advice or determine compliance truth.',
      },
      {
        boundary:
          'Regulatory source text is not fetched, crawled or authenticated by this capability.',
      },
      {
        boundary:
          'No connector, workflow, HITL, MaKo, billing, settlement, tariff, device-control, SMGW/CLS or production mutation is executed.',
      },
    ];
    const dossierFacts = [
      `Status: ${status}`,
      `Processes: ${affectedProcesses.map((process) => process.processKey).join(', ')}`,
      `Open gaps: ${missingEvidence.length}`,
    ];
    if (params.signalId) dossierFacts.push(`Signal: ${params.signalId}`);
    if (params.sourceName) dossierFacts.push(`Source: ${params.sourceName}`);
    if (params.deadlineHint) dossierFacts.push(`Deadline: ${params.deadlineHint}`);

    return {
      translatorId: `rspt:${Buffer.from(
        `${params.signalId || ''}:${params.sourceName || ''}:${sourceSummary || ''}`
      )
        .toString('base64url')
        .slice(0, 24)}`,
      capabilityKey: 'regulatory_signal_process_translator',
      safety: 'read_only',
      status,
      signalSummary: {
        signalId: params.signalId || 'signal:regulatory',
        sourceName: params.sourceName || null,
        publishedAt: params.publishedAt || null,
        summary: sourceSummary || null,
        affectedDomain: params.affectedDomain || null,
      },
      affectedProcesses,
      dataRequirements,
      evidenceRequirements,
      testCaseHints,
      decisionGates,
      ownerHints: params.ownerHint ? [params.ownerHint] : [],
      deadlineHints: params.deadlineHint ? [params.deadlineHint] : [],
      confidence: matchedProfiles.length ? 'medium' : 'low',
      missingEvidence,
      positiveFollowUps,
      decisionBoundaries,
      dossierFacts,
      sourceActions: {
        inspected: ['dashboard-api.regulatorySignalProcessTranslatorStatus'],
        referenced: [
          'vdmi.dossier',
          'evidence-registry.findings',
          'regulatory-signal.suppliedFacts',
        ],
        notCalled: [
          'legal.interpret',
          'compliance.decide',
          'regtech.connector.fetch',
          'bnetza.crawler.fetch',
          'sap.erp.write',
          'gis.sync',
          'asset-mdm.write',
          'budibase.table.write',
          'hitl.create',
          'workflow.execute',
          'webhook.emit',
          'mail.send',
          'mako.dispatch',
          'billing.release',
          'settlement.prepareBilling',
          'tariff.mutate',
          'device-control.execute',
          'smgw.cls.execute',
          'public-context.mutate',
          'external.connector.call',
          'personal-agent.execute',
        ],
      },
      validationFindings: missingEvidence.map((item) => ({
        code: `RSPT_${String(item.missingDataPoint).toUpperCase()}_MISSING`,
        severity: ['signal_summary', 'source_name', 'affected_domain', 'process_hint'].includes(
          item.missingDataPoint
        )
          ? 'high'
          : 'medium',
        message: item.enablesDossierAddition,
      })),
      dossierEvidence: {
        status,
        signalSummary: {
          signalId: params.signalId || 'signal:regulatory',
          sourceName: params.sourceName || null,
          publishedAt: params.publishedAt || null,
          summary: sourceSummary || null,
        },
        affectedProcesses,
        dataRequirements,
        evidenceRequirements,
        testCaseHints,
        decisionGates,
        missingEvidence,
        positiveFollowUps,
        decisionBoundaries,
        dossierFacts,
      },
    };
  },

  buildCostReviewCommitteeStatus(params = {}) {
    const evidenceRefs = Array.isArray(params.evidenceRefs)
      ? params.evidenceRefs.filter(Boolean)
      : params.evidenceRefs
        ? String(params.evidenceRefs)
            .split(',')
            .map((item) => item.trim())
            .filter(Boolean)
        : [];
    const hasValue = (value) => value !== undefined && value !== null && String(value) !== '';
    const evidenceSpecs = [
      {
        id: 'owner',
        label: 'Cost review owner',
        value: params.owner,
        sourceClass: 'governance_owner',
        enablesDossierAddition: 'add accountable cost-review owner',
      },
      {
        id: 'review_status',
        label: 'Review status',
        value: params.reviewStatus,
        sourceClass: 'review_state',
        enablesDossierAddition: 'add current cost-review status',
      },
      {
        id: 'data_origin',
        label: 'Data origin',
        value: params.dataOrigin || (evidenceRefs.length > 0 ? evidenceRefs.join(',') : null),
        sourceClass: 'source_provenance',
        enablesDossierAddition: 'add source/provenance evidence',
      },
      {
        id: 'asset_relevance',
        label: 'Asset relevance',
        value: params.assetRelevance,
        sourceClass: 'asset_effect',
        enablesDossierAddition: 'add operational asset relevance evidence',
      },
      {
        id: 'revenue_relevance',
        label: 'Revenue relevance',
        value: params.revenueRelevance,
        sourceClass: 'economic_effect',
        enablesDossierAddition: 'add economic/revenue relevance evidence',
      },
      {
        id: 'decision_readiness',
        label: 'Decision readiness',
        value: params.decisionReadiness,
        sourceClass: 'decision_gate',
        enablesDossierAddition: 'add readiness rationale and blockers',
      },
      {
        id: 'escalation_threshold',
        label: 'Escalation threshold',
        value: params.escalationThreshold,
        sourceClass: 'escalation_boundary',
        enablesDossierAddition: 'add escalation boundary',
      },
      {
        id: 'next_committee_gate',
        label: 'Next committee gate',
        value: params.nextCommitteeGate,
        sourceClass: 'committee_gate',
        enablesDossierAddition: 'add next governance gate and date',
      },
    ];
    const evidenceItems = evidenceSpecs
      .filter((spec) => hasValue(spec.value))
      .map((spec) => ({
        id: spec.id,
        label: spec.label,
        value: spec.value,
        sourceClass: spec.sourceClass,
        evidenceStatus: 'provided',
      }));
    if (hasValue(params.dueDate)) {
      evidenceItems.push({
        id: 'due_date',
        label: 'Due date',
        value: params.dueDate,
        sourceClass: 'deadline',
        evidenceStatus: 'provided',
      });
    }
    if (hasValue(params.amountClass)) {
      evidenceItems.push({
        id: 'amount_class',
        label: 'Amount class',
        value: params.amountClass,
        sourceClass: 'materiality_band',
        evidenceStatus: 'provided',
      });
    }
    if (hasValue(params.rationale)) {
      evidenceItems.push({
        id: 'rationale',
        label: 'Review rationale',
        value: params.rationale,
        sourceClass: 'decision_rationale',
        evidenceStatus: 'provided',
      });
    }
    const missingEvidence = evidenceSpecs
      .filter((spec) => !hasValue(spec.value))
      .map((spec) => ({
        missingDataPoint: spec.id,
        label: spec.label,
        sourceClass: spec.sourceClass,
        enablesDossierAddition: spec.enablesDossierAddition,
      }));
    const status =
      missingEvidence.length === 0
        ? 'committee_ready'
        : !hasValue(params.owner)
          ? 'needs_owner'
          : !hasValue(params.dataOrigin) && evidenceRefs.length === 0
            ? 'needs_data_origin'
            : !hasValue(params.decisionReadiness)
              ? 'needs_decision_readiness'
              : !hasValue(params.nextCommitteeGate)
                ? 'needs_committee_gate'
                : 'needs_cost_review_evidence';
    const positiveFollowUps = missingEvidence.map((item) => ({
      missingDataPoint: item.missingDataPoint,
      enablesDossierAddition: item.enablesDossierAddition,
      category: 'cost_review_committee_status',
    }));
    const validationFindings = missingEvidence.map((item) => ({
      code: `CRCS_${String(item.missingDataPoint).toUpperCase()}_MISSING`,
      severity: ['owner', 'decision_readiness', 'next_committee_gate'].includes(
        item.missingDataPoint
      )
        ? 'high'
        : 'medium',
      message: item.enablesDossierAddition,
    }));
    const providedRequiredEvidence = evidenceItems.filter((item) =>
      evidenceSpecs.some((spec) => spec.id === item.id)
    );
    const dossierFacts = [
      `Kostenpruefung Status: ${status}`,
      `Provided Cost Evidence: ${providedRequiredEvidence.length}/${evidenceSpecs.length}`,
      `Open Gaps: ${missingEvidence.length}`,
    ];
    if (params.owner) dossierFacts.push(`Owner: ${params.owner}`);
    if (params.reviewStatus) dossierFacts.push(`Review Status: ${params.reviewStatus}`);
    if (params.nextCommitteeGate)
      dossierFacts.push(`Next Committee Gate: ${params.nextCommitteeGate}`);

    return {
      costReviewId: `crcs:${Buffer.from(
        `${params.reviewId || params.caseId || ''}:${params.owner || ''}:${params.nextCommitteeGate || ''}`
      )
        .toString('base64url')
        .slice(0, 24)}`,
      capabilityKey: 'cost_review_committee_status',
      safety: 'read_only',
      requestContext: {
        reviewId: params.reviewId || null,
        caseId: params.caseId || null,
        evidenceRefs,
      },
      status,
      owner: params.owner || null,
      reviewStatus: params.reviewStatus || null,
      dataOrigin: params.dataOrigin || null,
      assetRelevance: params.assetRelevance || null,
      revenueRelevance: params.revenueRelevance || null,
      decisionReadiness: params.decisionReadiness || null,
      escalationThreshold: params.escalationThreshold || null,
      nextCommitteeGate: params.nextCommitteeGate || null,
      dueDate: params.dueDate || null,
      amountClass: params.amountClass || null,
      rationale: params.rationale || null,
      evidenceItems,
      missingEvidence,
      positiveFollowUps,
      validationFindings,
      sourceActions: {
        inspected: ['dashboard-api.costReviewCommitteeStatus'],
        referenced: [
          'vdmi.dossier',
          'vdmi.evidence',
          'finance.evidence',
          'asset-context.read',
          'interface-placeholder.requestEvidence',
        ],
        notCalled: [
          'erp.write',
          'sap.psp.write',
          'accounting.post',
          'budget.approve',
          'committee.decision.execute',
          'billing.run',
          'settlement.exportA96',
          'tariff.mutate',
          'market-communication.send',
          'hitl.create',
          'mail.send',
          'webhook.call',
          'workflow.execute',
          'external.connector.call',
          'personal-agent.execute',
        ],
      },
      dossierEvidence: {
        status,
        owner: params.owner || null,
        reviewStatus: params.reviewStatus || null,
        dataOrigin: params.dataOrigin || null,
        assetRelevance: params.assetRelevance || null,
        revenueRelevance: params.revenueRelevance || null,
        decisionReadiness: params.decisionReadiness || null,
        escalationThreshold: params.escalationThreshold || null,
        nextCommitteeGate: params.nextCommitteeGate || null,
        missingEvidence,
        positiveFollowUps,
        evidenceItems,
        validationFindings,
        dossierFacts,
      },
    };
  },

  buildRedispatchParticipationReadinessStatus(params = {}) {
    const hasValue = (value) =>
      value !== undefined && value !== null && String(value).trim() !== '';
    const evidenceSpecs = [
      {
        id: 'syntheticRedispatchAssetPortfolio',
        label: 'Synthetic Redispatch asset portfolio',
        value: params.syntheticRedispatchAssetPortfolio,
        sourceClass: 'synthetic_tenant_seed',
        enablesDossierAddition:
          'Adds concrete synthetic asset and portfolio context for a Redispatch readiness review once tenant-provided demo values exist.',
      },
      {
        id: 'installationGridLocationEvidence',
        label: 'Installation grid location evidence',
        value: params.installationGridLocationEvidence,
        sourceClass: 'synthetic_tenant_seed',
        enablesDossierAddition:
          'Adds MaStR, installation and grid-location review facts once tenant-provided demo evidence exists.',
      },
      {
        id: 'remoteControlCommunicationTestEvidence',
        label: 'Remote control communication test evidence',
        value: params.remoteControlCommunicationTestEvidence,
        sourceClass: 'synthetic_tenant_seed',
        enablesDossierAddition:
          'Adds remote-control and communication-test readiness proof as evidence only, never as a control action.',
      },
      {
        id: 'forecastDispatchTestProof',
        label: 'Forecast dispatch test proof',
        value: params.forecastDispatchTestProof,
        sourceClass: 'synthetic_tenant_seed',
        enablesDossierAddition:
          'Adds forecast or dispatch-test proof for the next safe review gate without claiming productive dispatch participation.',
      },
      {
        id: 'readinessReviewDecision',
        label: 'Readiness review decision',
        value: params.readinessReviewDecision,
        sourceClass: 'synthetic_tenant_seed',
        enablesDossierAddition:
          'Adds the ready-for-review or evidence-gap handoff once the synthetic review decision exists.',
      },
    ];

    const evidenceItems = evidenceSpecs
      .filter((spec) => hasValue(spec.value))
      .map((spec) => ({
        id: spec.id,
        label: spec.label,
        value: spec.value,
        sourceClass: spec.sourceClass,
        evidenceStatus: 'provided',
      }));

    const missingEvidence = evidenceSpecs
      .filter((spec) => !hasValue(spec.value))
      .map((spec) => ({
        missingDataPoint: spec.id,
        label: spec.label,
        sourceClass: spec.sourceClass,
        enablesDossierAddition: spec.enablesDossierAddition,
      }));

    const status =
      missingEvidence.length === 0
        ? 'ready_for_review'
        : !hasValue(params.syntheticRedispatchAssetPortfolio)
          ? 'needs_portfolio'
          : !hasValue(params.installationGridLocationEvidence)
            ? 'needs_location_evidence'
            : !hasValue(params.remoteControlCommunicationTestEvidence)
              ? 'needs_communication_evidence'
              : !hasValue(params.forecastDispatchTestProof)
                ? 'needs_forecast_proof'
                : 'needs_readiness_decision';

    const positiveFollowUps = missingEvidence.map((item) => ({
      missingDataPoint: item.missingDataPoint,
      enablesDossierAddition: item.enablesDossierAddition,
      category: 'redispatch_participation_readiness_status',
    }));

    const validationFindings = missingEvidence.map((item) => ({
      code: `RPRS_${String(item.missingDataPoint)
        .replace(/([A-Z])/g, '_$1')
        .toUpperCase()}_MISSING`,
      severity: ['syntheticRedispatchAssetPortfolio', 'installationGridLocationEvidence'].includes(
        item.missingDataPoint
      )
        ? 'high'
        : 'medium',
      message: item.enablesDossierAddition,
    }));

    const providedRequiredEvidence = evidenceItems.filter((item) =>
      evidenceSpecs.some((spec) => spec.id === item.id)
    );

    const dossierFacts = [
      `Redispatch readiness Status: ${status}`,
      `Provided Evidence: ${providedRequiredEvidence.length}/${evidenceSpecs.length}`,
      `Open Gaps: ${missingEvidence.length}`,
    ];

    return {
      readinessId: `rprs:${Buffer.from(
        `${params.tenantId || 'stadtwerk-mauer'}:${params.syntheticRedispatchAssetPortfolio || ''}:${params.readinessReviewDecision || ''}`
      )
        .toString('base64url')
        .slice(0, 24)}`,
      capabilityKey: 'redispatch_participation_readiness_status',
      safety: 'read_only_blueprint_seed',
      requestContext: {
        tenantId: params.tenantId || 'stadtwerk-mauer',
      },
      status,
      syntheticRedispatchAssetPortfolio: params.syntheticRedispatchAssetPortfolio || null,
      installationGridLocationEvidence: params.installationGridLocationEvidence || null,
      remoteControlCommunicationTestEvidence: params.remoteControlCommunicationTestEvidence || null,
      forecastDispatchTestProof: params.forecastDispatchTestProof || null,
      readinessReviewDecision: params.readinessReviewDecision || null,
      evidenceItems,
      missingEvidence,
      positiveFollowUps,
      validationFindings,
      sourceActions: {
        inspected: ['dashboard-api.redispatchParticipationReadinessStatus'],
        referenced: [
          'vdmi.dossier',
          'vdmi.evidence',
          'asset-context.read',
          'interface-placeholder.requestEvidence',
        ],
        notCalled: [
          'redispatch_enrollment',
          'dispatch_control',
          'mako_write',
          'billing',
          'settlement',
          'tariff_mutation',
          'smgw_cls_device_control',
          'external_connector_call',
          'webhook',
          'hitl_create',
          'tenant_provisioning',
          'rundeck_execution',
          'public_context_mutation',
          'production_mutation',
          'personal_agent_hardcoding',
        ],
      },
      dossierEvidence: {
        status,
        syntheticRedispatchAssetPortfolio: params.syntheticRedispatchAssetPortfolio || null,
        installationGridLocationEvidence: params.installationGridLocationEvidence || null,
        remoteControlCommunicationTestEvidence:
          params.remoteControlCommunicationTestEvidence || null,
        forecastDispatchTestProof: params.forecastDispatchTestProof || null,
        readinessReviewDecision: params.readinessReviewDecision || null,
        missingEvidence,
        positiveFollowUps,
        evidenceItems,
        validationFindings,
        dossierFacts,
      },
    };
  },

  buildMastrSyncGapStatus(params = {}) {
    const hasValue = (value) =>
      value !== undefined && value !== null && String(value).trim() !== '';
    const evidenceSpecs = [
      {
        id: 'mastrFreshnessEvidence',
        label: 'MaStR freshness evidence',
        value: params.mastrFreshnessEvidence,
        sourceClass: 'synthetic_tenant_seed',
        enablesDossierAddition:
          'Adds evidence of current MaStR data freshness harvest for the local network area.',
      },
      {
        id: 'redispatchStammdatenComparison',
        label: 'Redispatch Stammdaten comparison',
        value: params.redispatchStammdatenComparison,
        sourceClass: 'synthetic_tenant_seed',
        enablesDossierAddition:
          'Adds structured comparison data between Redispatch 2.0 master data and harvested MaStR records.',
      },
      {
        id: 'syncGapAlertFeed',
        label: 'Sync gap alert feed',
        value: params.syncGapAlertFeed,
        sourceClass: 'synthetic_tenant_seed',
        enablesDossierAddition:
          'Adds active sync gap alert feed items and priority-sorted alerting findings.',
      },
      {
        id: 'reconciliationApprovalDecision',
        label: 'Reconciliation approval decision',
        value: params.reconciliationApprovalDecision,
        sourceClass: 'synthetic_tenant_seed',
        enablesDossierAddition: 'Adds the final manual reconciliation or verification sign-off.',
      },
    ];

    const evidenceItems = evidenceSpecs
      .filter((spec) => hasValue(spec.value))
      .map((spec) => ({
        id: spec.id,
        label: spec.label,
        value: spec.value,
        sourceClass: spec.sourceClass,
        evidenceStatus: 'provided',
      }));

    const missingEvidence = evidenceSpecs
      .filter((spec) => !hasValue(spec.value))
      .map((spec) => ({
        missingDataPoint: spec.id,
        label: spec.label,
        sourceClass: spec.sourceClass,
        enablesDossierAddition: spec.enablesDossierAddition,
      }));

    const status =
      missingEvidence.length === 0
        ? 'ready_for_review'
        : !hasValue(params.mastrFreshnessEvidence)
          ? 'needs_harvest'
          : !hasValue(params.redispatchStammdatenComparison)
            ? 'needs_comparison'
            : !hasValue(params.syncGapAlertFeed)
              ? 'needs_alerts'
              : 'needs_reconciliation';

    const positiveFollowUps = missingEvidence.map((item) => ({
      missingDataPoint: item.missingDataPoint,
      enablesDossierAddition: item.enablesDossierAddition,
      category: 'mastr_sync_gap_status',
    }));

    const validationFindings = missingEvidence.map((item) => {
      let code = 'MSGA_DISCREPANCY';
      if (item.missingDataPoint === 'syncGapAlertFeed') {
        code = 'MSGA_MISSING_NETZNACHWEIS';
      } else if (item.missingDataPoint === 'reconciliationApprovalDecision') {
        code = 'MSGA_UNRESOLVED_STEUERBARKEIT';
      }
      return {
        code,
        severity: ['mastrFreshnessEvidence', 'redispatchStammdatenComparison'].includes(
          item.missingDataPoint
        )
          ? 'high'
          : 'medium',
        message: item.enablesDossierAddition,
      };
    });

    const providedRequiredEvidence = evidenceItems.filter((item) =>
      evidenceSpecs.some((spec) => spec.id === item.id)
    );

    const dossierFacts = [
      `MaStR Sync-Gap Status: ${status}`,
      `Provided Evidence: ${providedRequiredEvidence.length}/${evidenceSpecs.length}`,
      `Open Gaps: ${missingEvidence.length}`,
    ];

    return {
      readinessId: `msga:${Buffer.from(
        `${params.tenantId || 'stadtwerk-mauer'}:${params.mastrFreshnessEvidence || ''}:${params.reconciliationApprovalDecision || ''}`
      )
        .toString('base64url')
        .slice(0, 24)}`,
      capabilityKey: 'mastr_sync_gap_status',
      safety: 'read_only_blueprint_seed',
      requestContext: {
        tenantId: params.tenantId || 'stadtwerk-mauer',
      },
      status,
      mastrFreshnessEvidence: params.mastrFreshnessEvidence || null,
      redispatchStammdatenComparison: params.redispatchStammdatenComparison || null,
      syncGapAlertFeed: params.syncGapAlertFeed || null,
      reconciliationApprovalDecision: params.reconciliationApprovalDecision || null,
      evidenceItems,
      missingEvidence,
      positiveFollowUps,
      validationFindings,
      sourceActions: {
        inspected: ['dashboard-api.mastrSyncGapStatus'],
        referenced: [
          'vdmi.dossier',
          'vdmi.evidence',
          'asset-context.read',
          'interface-placeholder.requestEvidence',
        ],
        notCalled: [
          'redispatch_enrollment',
          'dispatch_control',
          'mako_write',
          'billing',
          'settlement',
          'tariff_mutation',
          'smgw_cls_device_control',
          'external_connector_call',
          'webhook',
          'hitl_create',
          'tenant_provisioning',
          'rundeck_execution',
          'public_context_mutation',
          'production_mutation',
          'personal_agent_hardcoding',
        ],
      },
      dossierEvidence: {
        status,
        mastrFreshnessEvidence: params.mastrFreshnessEvidence || null,
        redispatchStammdatenComparison: params.redispatchStammdatenComparison || null,
        syncGapAlertFeed: params.syncGapAlertFeed || null,
        reconciliationApprovalDecision: params.reconciliationApprovalDecision || null,
        missingEvidence,
        positiveFollowUps,
        evidenceItems,
        validationFindings,
        dossierFacts,
      },
    };
  },

  buildDecommissionedAssetReconciliationStatus(params = {}) {
    const hasValue = (value) =>
      value !== undefined && value !== null && String(value).trim() !== '';
    const evidenceSpecs = [
      {
        id: 'gisDecommissionedAssetsEvidence',
        label: 'GIS decommissioned assets evidence',
        value: params.gisDecommissionedAssetsEvidence,
        sourceClass: 'synthetic_tenant_seed',
        enablesDossierAddition:
          'Adds evidence of physically decommissioned assets from GIS/network registers.',
      },
      {
        id: 'sapAnlagenspiegelEvidence',
        label: 'SAP Anlagenspiegel evidence',
        value: params.sapAnlagenspiegelEvidence,
        sourceClass: 'synthetic_tenant_seed',
        enablesDossierAddition:
          'Adds commercial asset register entries and SAP Anlagenspiegel validation evidence.',
      },
      {
        id: 'reconciliationDiscrepancyFeed',
        label: 'Reconciliation discrepancy feed',
        value: params.reconciliationDiscrepancyFeed,
        sourceClass: 'synthetic_tenant_seed',
        enablesDossierAddition:
          'Adds active reconciliation discrepancy alerts and gap findings between physical and commercial states.',
      },
      {
        id: 'reconciliationApprovalDecision',
        label: 'Reconciliation approval decision',
        value: params.reconciliationApprovalDecision,
        sourceClass: 'synthetic_tenant_seed',
        enablesDossierAddition:
          'Adds the final decommissioning reconciliation sign-off and audit-trail logging.',
      },
    ];

    const evidenceItems = evidenceSpecs
      .filter((spec) => hasValue(spec.value))
      .map((spec) => ({
        id: spec.id,
        label: spec.label,
        value: spec.value,
        sourceClass: spec.sourceClass,
        evidenceStatus: 'provided',
      }));

    const missingEvidence = evidenceSpecs
      .filter((spec) => !hasValue(spec.value))
      .map((spec) => ({
        missingDataPoint: spec.id,
        label: spec.label,
        sourceClass: spec.sourceClass,
        enablesDossierAddition: spec.enablesDossierAddition,
      }));

    const status =
      missingEvidence.length === 0
        ? 'ready_for_review'
        : !hasValue(params.gisDecommissionedAssetsEvidence)
          ? 'needs_gis'
          : !hasValue(params.sapAnlagenspiegelEvidence)
            ? 'needs_sap'
            : !hasValue(params.reconciliationDiscrepancyFeed)
              ? 'needs_alerts'
              : 'needs_reconciliation';

    const positiveFollowUps = missingEvidence.map((item) => ({
      missingDataPoint: item.missingDataPoint,
      enablesDossierAddition: item.enablesDossierAddition,
      category: 'decommissioned_asset_reconciliation',
    }));

    const validationFindings = missingEvidence.map((item) => {
      let code = 'DARS_RECONCILIATION_PENDING';
      if (item.missingDataPoint === 'gisDecommissionedAssetsEvidence') {
        code = 'DARS_GIS_MISSING';
      } else if (item.missingDataPoint === 'sapAnlagenspiegelEvidence') {
        code = 'DARS_BOOK_VALUE_MISMATCH';
      }
      return {
        code,
        severity: ['gisDecommissionedAssetsEvidence', 'sapAnlagenspiegelEvidence'].includes(
          item.missingDataPoint
        )
          ? 'high'
          : 'medium',
        message: item.enablesDossierAddition,
      };
    });

    const providedRequiredEvidence = evidenceItems.filter((item) =>
      evidenceSpecs.some((spec) => spec.id === item.id)
    );

    const dossierFacts = [
      `Decommissioned Asset Reconciliation Status: ${status}`,
      `Provided Evidence: ${providedRequiredEvidence.length}/${evidenceSpecs.length}`,
      `Open Gaps: ${missingEvidence.length}`,
    ];

    return {
      readinessId: `dars:${Buffer.from(
        `${params.tenantId || 'stadtwerk-mauer'}:${params.gisDecommissionedAssetsEvidence || ''}:${params.reconciliationApprovalDecision || ''}`
      )
        .toString('base64url')
        .slice(0, 24)}`,
      capabilityKey: 'decommissioned_asset_reconciliation',
      safety: 'read_only_blueprint_seed',
      requestContext: {
        tenantId: params.tenantId || 'stadtwerk-mauer',
      },
      status,
      gisDecommissionedAssetsEvidence: params.gisDecommissionedAssetsEvidence || null,
      sapAnlagenspiegelEvidence: params.sapAnlagenspiegelEvidence || null,
      reconciliationDiscrepancyFeed: params.reconciliationDiscrepancyFeed || null,
      reconciliationApprovalDecision: params.reconciliationApprovalDecision || null,
      evidenceItems,
      missingEvidence,
      positiveFollowUps,
      validationFindings,
      sourceActions: {
        inspected: ['dashboard-api.decommissionedAssetReconciliationStatus'],
        referenced: [
          'vdmi.dossier',
          'vdmi.evidence',
          'asset-context.read',
          'interface-placeholder.requestEvidence',
        ],
        notCalled: [
          'redispatch_enrollment',
          'dispatch_control',
          'mako_write',
          'billing',
          'settlement',
          'tariff_mutation',
          'smgw_cls_device_control',
          'external_connector_call',
          'webhook',
          'hitl_create',
          'tenant_provisioning',
          'rundeck_execution',
          'public_context_mutation',
          'production_mutation',
          'personal_agent_hardcoding',
        ],
      },
      dossierEvidence: {
        status,
        gisDecommissionedAssetsEvidence: params.gisDecommissionedAssetsEvidence || null,
        sapAnlagenspiegelEvidence: params.sapAnlagenspiegelEvidence || null,
        reconciliationDiscrepancyFeed: params.reconciliationDiscrepancyFeed || null,
        reconciliationApprovalDecision: params.reconciliationApprovalDecision || null,
        missingEvidence,
        positiveFollowUps,
        evidenceItems,
        validationFindings,
        dossierFacts,
      },
    };
  },

  buildEnergySharingCollectiveApprovalStatus(params = {}) {
    const hasValue = (value) =>
      value !== undefined && value !== null && String(value).trim() !== '';
    const evidenceSpecs = [
      {
        id: 'syntheticCollectiveBoundaryEvidence',
        label: 'Synthetic collective boundary evidence',
        value: params.syntheticCollectiveBoundaryEvidence,
        sourceClass: 'synthetic_tenant_seed',
        enablesDossierAddition:
          'Adds the synthetic collective and pilot boundary as public-safe review material.',
      },
      {
        id: 'operatorParticipantBoundaryEvidence',
        label: 'Operator participant boundary evidence',
        value: params.operatorParticipantBoundaryEvidence,
        sourceClass: 'synthetic_tenant_seed',
        enablesDossierAddition:
          'Adds operator ownership, participant boundary and governance scope review evidence.',
      },
      {
        id: 'meteringConceptEvidence',
        label: 'Metering concept evidence',
        value: params.meteringConceptEvidence,
        sourceClass: 'synthetic_tenant_seed',
        enablesDossierAddition:
          'Adds the metering concept readiness statement without creating or changing metering assets.',
      },
      {
        id: 'contractConsentMarketRoleEvidence',
        label: 'Contract consent market role evidence',
        value: params.contractConsentMarketRoleEvidence,
        sourceClass: 'synthetic_tenant_seed',
        enablesDossierAddition:
          'Adds contract, consent and market-role review readiness without customer signing.',
      },
      {
        id: 'allocationBillingSettlementGapEvidence',
        label: 'Allocation billing settlement gap evidence',
        value: params.allocationBillingSettlementGapEvidence,
        sourceClass: 'synthetic_tenant_seed',
        enablesDossierAddition:
          'Adds allocation, A96, billing and settlement evidence-gap closure as review evidence.',
      },
      {
        id: 'approvalReadinessDecision',
        label: 'Approval readiness decision',
        value: params.approvalReadinessDecision,
        sourceClass: 'synthetic_tenant_seed',
        enablesDossierAddition:
          'Adds the ready-for-review or evidence-gap classification and next safe governance gate.',
      },
    ];

    const evidenceItems = evidenceSpecs
      .filter((spec) => hasValue(spec.value))
      .map((spec) => ({
        id: spec.id,
        label: spec.label,
        value: spec.value,
        sourceClass: spec.sourceClass,
        evidenceStatus: 'provided',
      }));

    const missingEvidence = evidenceSpecs
      .filter((spec) => !hasValue(spec.value))
      .map((spec) => ({
        missingDataPoint: spec.id,
        label: spec.label,
        sourceClass: spec.sourceClass,
        enablesDossierAddition: spec.enablesDossierAddition,
      }));

    const status =
      missingEvidence.length === 0
        ? 'ready_for_review'
        : !hasValue(params.syntheticCollectiveBoundaryEvidence)
          ? 'needs_boundary'
          : !hasValue(params.operatorParticipantBoundaryEvidence)
            ? 'needs_participant'
            : !hasValue(params.meteringConceptEvidence)
              ? 'needs_meter'
              : !hasValue(params.contractConsentMarketRoleEvidence)
                ? 'needs_contract'
                : !hasValue(params.allocationBillingSettlementGapEvidence)
                  ? 'needs_billing_gap'
                  : 'needs_decision';

    const positiveFollowUps = missingEvidence.map((item) => ({
      missingDataPoint: item.missingDataPoint,
      enablesDossierAddition: item.enablesDossierAddition,
      category: 'energy_sharing_collective_approval',
    }));

    const validationFindings = missingEvidence.map((item) => {
      let code = 'ESCA_DECISION_PENDING';
      if (item.missingDataPoint === 'syntheticCollectiveBoundaryEvidence') {
        code = 'ESCA_BOUNDARY_MISSING';
      } else if (item.missingDataPoint === 'operatorParticipantBoundaryEvidence') {
        code = 'ESCA_PARTICIPANT_MISSING';
      } else if (item.missingDataPoint === 'meteringConceptEvidence') {
        code = 'ESCA_METER_MISSING';
      } else if (item.missingDataPoint === 'contractConsentMarketRoleEvidence') {
        code = 'ESCA_CONTRACT_MISSING';
      } else if (item.missingDataPoint === 'allocationBillingSettlementGapEvidence') {
        code = 'ESCA_BILLING_GAP_MISSING';
      }
      return {
        code,
        severity: [
          'syntheticCollectiveBoundaryEvidence',
          'operatorParticipantBoundaryEvidence',
          'meteringConceptEvidence',
        ].includes(item.missingDataPoint)
          ? 'high'
          : 'medium',
        message: item.enablesDossierAddition,
      };
    });

    const providedRequiredEvidence = evidenceItems.filter((item) =>
      evidenceSpecs.some((spec) => spec.id === item.id)
    );

    const dossierFacts = [
      `Energy Sharing Collective Approval Status: ${status}`,
      `Provided Evidence: ${providedRequiredEvidence.length}/${evidenceSpecs.length}`,
      `Open Gaps: ${missingEvidence.length}`,
    ];

    return {
      readinessId: `esca:${Buffer.from(
        `${params.tenantId || 'stadtwerk-mauer'}:${params.syntheticCollectiveBoundaryEvidence || ''}:${params.approvalReadinessDecision || ''}`
      )
        .toString('base64url')
        .slice(0, 24)}`,
      capabilityKey: 'energy_sharing_collective_approval',
      safety: 'read_only_blueprint_seed',
      requestContext: {
        tenantId: params.tenantId || 'stadtwerk-mauer',
      },
      status,
      syntheticCollectiveBoundaryEvidence: params.syntheticCollectiveBoundaryEvidence || null,
      operatorParticipantBoundaryEvidence: params.operatorParticipantBoundaryEvidence || null,
      meteringConceptEvidence: params.meteringConceptEvidence || null,
      contractConsentMarketRoleEvidence: params.contractConsentMarketRoleEvidence || null,
      allocationBillingSettlementGapEvidence: params.allocationBillingSettlementGapEvidence || null,
      approvalReadinessDecision: params.approvalReadinessDecision || null,
      evidenceItems,
      missingEvidence,
      positiveFollowUps,
      validationFindings,
      sourceActions: {
        inspected: ['dashboard-api.energySharingCollectiveApprovalStatus'],
        referenced: [
          'vdmi.dossier',
          'vdmi.evidence',
          'asset-context.read',
          'interface-placeholder.requestEvidence',
        ],
        notCalled: [
          'redispatch_enrollment',
          'dispatch_control',
          'mako_write',
          'billing',
          'settlement',
          'tariff_mutation',
          'smgw_cls_device_control',
          'external_connector_call',
          'webhook',
          'hitl_create',
          'tenant_provisioning',
          'rundeck_execution',
          'public_context_mutation',
          'production_mutation',
          'personal_agent_hardcoding',
        ],
      },
      dossierEvidence: {
        status,
        syntheticCollectiveBoundaryEvidence: params.syntheticCollectiveBoundaryEvidence || null,
        operatorParticipantBoundaryEvidence: params.operatorParticipantBoundaryEvidence || null,
        meteringConceptEvidence: params.meteringConceptEvidence || null,
        contractConsentMarketRoleEvidence: params.contractConsentMarketRoleEvidence || null,
        allocationBillingSettlementGapEvidence:
          params.allocationBillingSettlementGapEvidence || null,
        approvalReadinessDecision: params.approvalReadinessDecision || null,
        missingEvidence,
        positiveFollowUps,
        evidenceItems,
        validationFindings,
        dossierFacts,
      },
    };
  },

  buildSteeringArtifactAcceptanceGateStatus(params = {}) {
    const isProvided = (value) =>
      value !== undefined && value !== null && String(value).trim() !== '';
    const numberOrNull = (value) => {
      if (value === undefined || value === null || value === '') return null;
      const n = Number(value);
      return Number.isFinite(n) ? n : null;
    };
    const itemCount = numberOrNull(params.itemCount);
    const maintenanceMinutesPerWeek = numberOrNull(params.maintenanceMinutesPerWeek);
    const evidenceSpecs = [
      {
        id: 'artifact_identity',
        label: 'Artifact identity',
        value: params.artifactType || params.artifactName,
        sourceClass: 'steering_artifact_scope',
        enablesDossierAddition: 'add artifact name/type and scope evidence',
      },
      {
        id: 'target_role',
        label: 'Target role',
        value: params.targetRole,
        sourceClass: 'role_readiness',
        enablesDossierAddition: 'add accountable target-role evidence',
      },
      {
        id: 'use_case',
        label: 'Use case',
        value: params.useCase,
        sourceClass: 'operational_use_case',
        enablesDossierAddition: 'add operational use-case evidence',
      },
      {
        id: 'bounded_item_count',
        label: 'Bounded item/card count',
        value: itemCount !== null ? itemCount : null,
        sourceClass: 'artifact_scope',
        enablesDossierAddition: 'add scoped pilot card/item count',
      },
      {
        id: 'maintenance_effort',
        label: 'Maintenance effort',
        value: maintenanceMinutesPerWeek !== null ? maintenanceMinutesPerWeek : null,
        sourceClass: 'maintenance_cost',
        enablesDossierAddition: 'add weekly maintenance effort evidence',
      },
      {
        id: 'update_cadence',
        label: 'Update cadence',
        value: params.updateCadence,
        sourceClass: 'maintenance_cadence',
        enablesDossierAddition: 'add update cadence evidence',
      },
      {
        id: 'owner',
        label: 'Owner',
        value: params.owner,
        sourceClass: 'accountable_owner',
        enablesDossierAddition: 'add accountable owner assignment',
      },
      {
        id: 'deputy_owner',
        label: 'Deputy owner',
        value: params.deputyOwner,
        sourceClass: 'operational_backup_owner',
        enablesDossierAddition: 'add deputy-owner assignment',
      },
      {
        id: 'usage_evidence',
        label: 'Usage evidence',
        value: params.usageEvidence,
        sourceClass: 'benefit_proof',
        enablesDossierAddition: 'add Nutzenbeweis / usage indicator evidence',
      },
      {
        id: 'escalation_criterion',
        label: 'Escalation or retirement criterion',
        value: params.escalationCriterion,
        sourceClass: 'governance_exit_criterion',
        enablesDossierAddition: 'add escalation or retirement criterion evidence',
      },
      {
        id: 'rollout_decision',
        label: 'Rollout decision',
        value: params.rolloutDecision,
        sourceClass: 'limited_rollout_decision',
        enablesDossierAddition: 'add explicit limited-rollout/rework/retirement decision',
      },
    ];
    const scalarRows = evidenceSpecs.map((spec) => ({
      id: spec.id,
      label: spec.label,
      value: isProvided(spec.value) ? spec.value : null,
      sourceClass: spec.sourceClass,
      evidenceStatus: isProvided(spec.value) ? 'provided' : 'missing',
    }));
    const missingEvidence = evidenceSpecs
      .filter((spec) => !isProvided(spec.value))
      .map((spec) => ({
        missingDataPoint: spec.id,
        label: spec.label,
        sourceClass: spec.sourceClass,
        enablesDossierAddition: spec.enablesDossierAddition,
      }));
    const operationalRisks = [];
    if (itemCount !== null && itemCount > 30) {
      operationalRisks.push({
        code: 'artifact_scope_too_large',
        severity: 'high',
        message: 'Artifact has too many cards/items for a bounded first rollout.',
        enablesDossierAddition: 'add scoping evidence for a smaller pilot artifact',
      });
    }
    if (maintenanceMinutesPerWeek !== null && maintenanceMinutesPerWeek > 120) {
      operationalRisks.push({
        code: 'maintenance_effort_too_high',
        severity: 'high',
        message: 'Expected maintenance effort exceeds a lightweight steering artifact.',
        enablesDossierAddition: 'add maintenance-cost reduction or staffing evidence',
      });
    }
    const rolloutDecision = String(params.rolloutDecision || '').toLowerCase();
    const retireOrRework =
      /(retire|retirement|abbruch|abschalten|stilllegen|rework|ueberarbeiten|überarbeiten|stop|nicht)/.test(
        rolloutDecision
      );
    const hasCoreEvidence = ['artifact_identity', 'target_role', 'use_case'].every(
      (id) => scalarRows.find((row) => row.id === id)?.evidenceStatus === 'provided'
    );
    const hasMaintenanceEvidence = [
      'maintenance_effort',
      'update_cadence',
      'owner',
      'deputy_owner',
    ].every((id) => scalarRows.find((row) => row.id === id)?.evidenceStatus === 'provided');
    let status = 'missing_acceptance_evidence';
    if (retireOrRework || operationalRisks.length > 0) status = 'should_retire_or_rework';
    else if (hasCoreEvidence && !params.owner) status = 'needs_maintenance_owner';
    else if (hasCoreEvidence && !hasMaintenanceEvidence) status = 'needs_maintenance_owner';
    else if (missingEvidence.length === 0) status = 'ready_for_limited_rollout';
    else if (hasCoreEvidence) status = 'missing_acceptance_evidence';

    const positiveFollowUps = missingEvidence.map((item) => ({
      missingDataPoint: item.missingDataPoint,
      enablesDossierAddition: item.enablesDossierAddition,
      category: 'steering_artifact_acceptance_gate',
    }));
    const riskFollowUps = operationalRisks.map((risk) => ({
      missingDataPoint: risk.code,
      enablesDossierAddition: risk.enablesDossierAddition,
      category: 'steering_artifact_acceptance_gate',
    }));
    const sourceActions = {
      inspected: ['dashboard-api.steeringArtifactAcceptanceGateStatus'],
      referenced: [
        'vdmi.dossier',
        'evidence-registry.findings',
        'dashboard-api.ownerDeadlineEvidenceGateStatus',
        'dashboard-api.rolePermissionAccessReadinessGateStatus',
      ],
      notCalled: [
        'budibase.table.write',
        'workflow.execute',
        'hitl.create',
        'mail.send',
        'webhook.emit',
        'external.connector.call',
        'mako.dispatch',
        'settlement.prepareBilling',
        'billing.release',
        'tariff.mutate',
        'device-control.execute',
        'personal-agent.execute',
      ],
    };
    const validationFindings = [
      ...missingEvidence.map((item) => ({
        code: `SAAG_${String(item.missingDataPoint).toUpperCase()}_MISSING`,
        severity: ['owner', 'deputy_owner', 'usage_evidence', 'escalation_criterion'].includes(
          item.missingDataPoint
        )
          ? 'high'
          : 'medium',
        message: item.enablesDossierAddition,
      })),
      ...operationalRisks.map((risk) => ({
        code: `SAAG_${String(risk.code).toUpperCase()}`,
        severity: risk.severity,
        message: risk.message,
      })),
    ];
    const dossierFacts = [
      `Acceptance Gate Status: ${status}`,
      `Provided gate evidence: ${scalarRows.filter((row) => row.evidenceStatus === 'provided').length}/${scalarRows.length}`,
      `Open gaps: ${missingEvidence.length}`,
    ];
    if (params.artifactName || params.artifactType)
      dossierFacts.push(`Artifact: ${params.artifactName || params.artifactType}`);
    if (params.targetRole) dossierFacts.push(`Target Role: ${params.targetRole}`);
    if (params.owner) dossierFacts.push(`Owner: ${params.owner}`);
    if (params.rolloutDecision) dossierFacts.push(`Rollout Decision: ${params.rolloutDecision}`);

    return {
      gateId: `saag:${Buffer.from(
        `${params.artifactType || ''}:${params.artifactName || ''}:${params.targetRole || ''}:${params.owner || ''}`
      )
        .toString('base64url')
        .slice(0, 24)}`,
      capabilityKey: 'steering_artifact_acceptance_gate',
      safety: 'read_only',
      status,
      artifact: {
        artifactType: params.artifactType || null,
        artifactName: params.artifactName || null,
        targetRole: params.targetRole || null,
        useCase: params.useCase || null,
        itemCount,
        maintenanceMinutesPerWeek,
        updateCadence: params.updateCadence || null,
      },
      ownerContext: {
        owner: params.owner || null,
        deputyOwner: params.deputyOwner || null,
      },
      rolloutDecision: params.rolloutDecision || null,
      usageEvidence: params.usageEvidence || null,
      escalationCriterion: params.escalationCriterion || null,
      scalarRows,
      missingEvidence,
      operationalRisks,
      positiveFollowUps: [...positiveFollowUps, ...riskFollowUps],
      sourceActions,
      validationFindings,
      dossierEvidence: {
        status,
        scalarRows,
        missingEvidence,
        operationalRisks,
        positiveFollowUps: [...positiveFollowUps, ...riskFollowUps],
        owner: params.owner || null,
        deputyOwner: params.deputyOwner || null,
        rolloutDecision: params.rolloutDecision || null,
        sourceActions: {
          notCalled: sourceActions.notCalled,
        },
        dossierFacts,
      },
    };
  },
};
