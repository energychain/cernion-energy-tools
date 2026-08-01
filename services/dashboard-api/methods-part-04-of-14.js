'use strict';

// dashboard-api methods chunk 4/14 — extracted verbatim from
// services/dashboard-api.service.js as part of the v0.99 file-size modularization.
// Contains: buildCommunicationBreakProcessRiskStatus, buildNoRegretMeasureProofGateStatus, buildAnschlusskapazitaetEvidenceQueueStatus, buildConnectionDeadlineEvidenceQueueStatus, buildLayer0AuditDrilldownNoteStatus, buildLegalClarificationOperatingModelStatus, buildDrReadinessEvidenceStatus, buildSpecialGridUsageImpactMapStatus, buildLiquidityPlanningGovernanceStatus, buildEnergySharingSimulationGateStatus, buildEnergySharing42cCutoverReadinessStatus, buildEvuApiMigrationDiagnosticsStatus, buildNovaDecisionLifecycleReadinessStatus, buildRegulatoryChangeReadinessStatus, buildInvestmentTwoTrackControlStatus, buildSapBudgetPspGateStatus

module.exports = {
  buildCommunicationBreakProcessRiskStatus(params = {}) {
    const isProvided = (value) =>
      value !== undefined && value !== null && String(value).trim() !== '';
    const evidenceSpecs = [
      {
        id: 'process_domain',
        label: 'Process/domain',
        value: params.processDomain,
        sourceClass: 'process_scope',
        enablesDossierAddition: 'add process/domain scope for the communication-risk case',
      },
      {
        id: 'affected_decision',
        label: 'Affected decision',
        value: params.affectedDecision,
        sourceClass: 'decision_context',
        enablesDossierAddition: 'add the decision that depends on clearer communication evidence',
      },
      {
        id: 'presentation_status',
        label: 'Presentation status',
        value: params.presentationStatus,
        sourceClass: 'presentation_evidence',
        enablesDossierAddition: 'add source-backed presentation or meeting context',
      },
      {
        id: 'protocol_status',
        label: 'Protocol status',
        value: params.protocolStatus,
        sourceClass: 'protocol_evidence',
        enablesDossierAddition: 'add protocol/minutes evidence for the decision basis',
      },
      {
        id: 'question_response_window',
        label: 'Question-response window',
        value: params.questionResponseWindow,
        sourceClass: 'governance_timing',
        enablesDossierAddition: 'add response-window timing clarity',
      },
      {
        id: 'information_duty',
        label: 'Information duty',
        value: params.informationDuty,
        sourceClass: 'information_obligation',
        enablesDossierAddition: 'add who must proactively share which information',
      },
      {
        id: 'fachliche_begleitung',
        label: 'Fachliche Begleitung',
        value: params.fachlicheBegleitung,
        sourceClass: 'support_boundary',
        enablesDossierAddition: 'add fachliche Begleitung and support boundary evidence',
      },
      {
        id: 'owner',
        label: 'Owner',
        value: params.owner,
        sourceClass: 'accountability',
        enablesDossierAddition: 'add accountable owner evidence',
      },
      {
        id: 'deputy',
        label: 'Deputy',
        value: params.deputy,
        sourceClass: 'operational_continuity',
        enablesDossierAddition: 'add deputy/continuity evidence',
      },
      {
        id: 'blocked_decision',
        label: 'Blocked decision',
        value: params.blockedDecision,
        sourceClass: 'blocked_decision',
        enablesDossierAddition: 'add the management/process gate currently blocked',
      },
      {
        id: 'next_evidence_point',
        label: 'Next evidence point',
        value: params.nextEvidencePoint,
        sourceClass: 'next_evidence_point',
        enablesDossierAddition: 'add the next concrete evidence point for unblock',
      },
      {
        id: 'due_date',
        label: 'Due date',
        value: params.dueDate,
        sourceClass: 'review_timing',
        enablesDossierAddition: 'add review due date evidence',
      },
      {
        id: 'escalation_criterion',
        label: 'Escalation or retirement criterion',
        value: params.escalationCriterion,
        sourceClass: 'escalation_criterion',
        enablesDossierAddition: 'add escalation or retirement criterion evidence',
      },
    ];
    if (isProvided(params.proofLabel) || isProvided(params.proofLink)) {
      evidenceSpecs.push({
        id: 'proof_reference',
        label: 'Proof reference',
        value: [params.proofLabel, params.proofLink].filter(isProvided).join(' - '),
        sourceClass: 'proof_reference',
        enablesDossierAddition: 'add source/proof reference for communication-risk evidence',
      });
    }

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
    const missingIds = new Set(missingEvidence.map((item) => item.missingDataPoint));
    const criticalIds = [
      'affected_decision',
      'protocol_status',
      'question_response_window',
      'information_duty',
      'owner',
      'blocked_decision',
      'next_evidence_point',
      'due_date',
    ];
    const criticalMissingCount = criticalIds.filter((id) => missingIds.has(id)).length;
    let status = 'process_risk_ready_for_next_gate';
    let riskLevel = 'low';
    if (missingIds.has('process_domain') || missingIds.has('affected_decision')) {
      status = 'missing_process_context';
      riskLevel = 'high';
    } else if (missingIds.has('blocked_decision') || missingIds.has('next_evidence_point')) {
      status = 'blocked_decision_needs_evidence';
      riskLevel = 'high';
    } else if (
      missingIds.has('owner') ||
      missingIds.has('due_date') ||
      missingIds.has('escalation_criterion')
    ) {
      status = 'needs_owner_due_date';
      riskLevel = 'medium';
    } else if (criticalMissingCount > 0 || missingEvidence.length > 0) {
      status = 'communication_break_risk_open';
      riskLevel = criticalMissingCount >= 3 ? 'high' : 'medium';
    }

    const positiveFollowUps = missingEvidence.map((item) => ({
      missingDataPoint: item.missingDataPoint,
      enablesDossierAddition: item.enablesDossierAddition,
      category: 'communication_break_process_risk',
    }));
    const sourceActions = {
      inspected: ['dashboard-api.communicationBreakProcessRiskStatus'],
      referenced: [
        'vdmi.dossier',
        'evidence-registry.findings',
        'dashboard-api.ownerDeadlineEvidenceGateStatus',
        'dashboard-api.steeringArtifactAcceptanceGateStatus',
      ],
      notCalled: [
        'hr.personScore',
        'sentiment.analyze',
        'email.ingest',
        'calendar.ingest',
        'chat.ingest',
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
    const validationFindings = missingEvidence.map((item) => ({
      code: `CBPR_${String(item.missingDataPoint).toUpperCase()}_MISSING`,
      severity: criticalIds.includes(item.missingDataPoint) ? 'high' : 'medium',
      message: item.enablesDossierAddition,
    }));
    const dossierFacts = [
      `Communication Risk Status: ${status}`,
      `Risk Level: ${riskLevel}`,
      `Provided process-risk evidence: ${scalarRows.filter((row) => row.evidenceStatus === 'provided').length}/${scalarRows.length}`,
      `Open gaps: ${missingEvidence.length}`,
    ];
    if (params.processDomain) dossierFacts.push(`Process Domain: ${params.processDomain}`);
    if (params.affectedDecision) dossierFacts.push(`Affected Decision: ${params.affectedDecision}`);
    if (params.blockedDecision) dossierFacts.push(`Blocked Decision: ${params.blockedDecision}`);
    if (params.owner) dossierFacts.push(`Owner: ${params.owner}`);

    return {
      gateId: `cbpr:${Buffer.from(
        `${params.processDomain || ''}:${params.affectedDecision || ''}:${params.owner || ''}:${params.dueDate || ''}`
      )
        .toString('base64url')
        .slice(0, 24)}`,
      capabilityKey: 'communication_break_process_risk',
      safety: 'read_only',
      status,
      riskLevel,
      process: {
        processDomain: params.processDomain || null,
        affectedDecision: params.affectedDecision || null,
        blockedDecision: params.blockedDecision || null,
        nextEvidencePoint: params.nextEvidencePoint || null,
      },
      governanceContext: {
        presentationStatus: params.presentationStatus || null,
        protocolStatus: params.protocolStatus || null,
        questionResponseWindow: params.questionResponseWindow || null,
        informationDuty: params.informationDuty || null,
        fachlicheBegleitung: params.fachlicheBegleitung || null,
        dueDate: params.dueDate || null,
        escalationCriterion: params.escalationCriterion || null,
      },
      ownerContext: {
        owner: params.owner || null,
        deputy: params.deputy || null,
      },
      proofReference: {
        proofLabel: params.proofLabel || null,
        proofLink: params.proofLink || null,
      },
      scalarRows,
      missingEvidence,
      positiveFollowUps,
      sourceActions,
      validationFindings,
      dossierEvidence: {
        status,
        riskLevel,
        scalarRows,
        missingEvidence,
        positiveFollowUps,
        processDomain: params.processDomain || null,
        affectedDecision: params.affectedDecision || null,
        blockedDecision: params.blockedDecision || null,
        owner: params.owner || null,
        dueDate: params.dueDate || null,
        sourceActions: {
          notCalled: sourceActions.notCalled,
        },
        dossierFacts,
      },
    };
  },

  buildNoRegretMeasureProofGateStatus(params = {}) {
    const isProvided = (value) =>
      value !== undefined && value !== null && String(value).trim() !== '';
    const evidenceSpecs = [
      {
        id: 'measure_identity',
        label: 'Measure identity',
        value: params.measureName || params.measureType,
        sourceClass: 'measure_scope',
        enablesDossierAddition: 'add measure name or type for the No-Regret proof gate',
      },
      {
        id: 'target_domain',
        label: 'Target domain',
        value: params.targetDomain,
        sourceClass: 'domain_scope',
        enablesDossierAddition: 'add target domain for operational and budget context',
      },
      {
        id: 'scenario_coverage',
        label: 'Scenario coverage',
        value: params.scenarioCoverage,
        sourceClass: 'scenario_evidence',
        enablesDossierAddition: 'add scenario coverage showing when the measure remains useful',
      },
      {
        id: 'budget_anchor',
        label: 'Budget anchor',
        value: params.budgetAnchor,
        sourceClass: 'budget_evidence',
        enablesDossierAddition: 'add budget anchor without reserving or approving funds',
      },
      {
        id: 'cost_range',
        label: 'Cost range',
        value: params.costRange,
        sourceClass: 'cost_evidence',
        enablesDossierAddition: 'add bounded cost range for prioritization review',
      },
      {
        id: 'expected_benefit_range',
        label: 'Expected benefit/value range',
        value: params.expectedBenefitRange,
        sourceClass: 'value_evidence',
        enablesDossierAddition: 'add expected benefit or value range as scenario evidence',
      },
      {
        id: 'regulatory_fit',
        label: 'Regulatory fit',
        value: params.regulatoryFit,
        sourceClass: 'regulatory_fit',
        enablesDossierAddition: 'add evidence flags for regulatory Anschlussfaehigkeit',
      },
      {
        id: 'decision_owner',
        label: 'Decision owner',
        value: params.decisionOwner,
        sourceClass: 'decision_rights',
        enablesDossierAddition: 'add decision owner and decision-rights evidence',
      },
      {
        id: 'objection_window',
        label: 'Objection/appeal window',
        value: params.objectionWindow,
        sourceClass: 'objection_window',
        enablesDossierAddition: 'add objection or appeal window before prioritization',
      },
      {
        id: 'evidence_source',
        label: 'Evidence source',
        value: params.evidenceSource,
        sourceClass: 'proof_source',
        enablesDossierAddition: 'add source reference for the proof basis',
      },
      {
        id: 'next_management_gate',
        label: 'Next management gate',
        value: params.nextManagementGate,
        sourceClass: 'management_gate',
        enablesDossierAddition: 'add next management gate for review readiness',
      },
      {
        id: 'due_date',
        label: 'Due date',
        value: params.dueDate,
        sourceClass: 'review_timing',
        enablesDossierAddition: 'add due date for the next gate review',
      },
    ];
    if (isProvided(params.proofLabel) || isProvided(params.proofLink)) {
      evidenceSpecs.push({
        id: 'proof_reference',
        label: 'Proof reference',
        value: [params.proofLabel, params.proofLink].filter(isProvided).join(' - '),
        sourceClass: 'proof_reference',
        enablesDossierAddition: 'add source/proof reference for the No-Regret claim',
      });
    }

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
    const missingIds = new Set(missingEvidence.map((item) => item.missingDataPoint));
    const criticalIds = [
      'measure_identity',
      'scenario_coverage',
      'budget_anchor',
      'cost_range',
      'expected_benefit_range',
      'regulatory_fit',
      'decision_owner',
      'objection_window',
      'next_management_gate',
    ];
    const criticalMissingCount = criticalIds.filter((id) => missingIds.has(id)).length;
    let status = 'measure_ready_for_management_prioritization_review';
    let riskLevel = 'low';
    if (missingIds.has('measure_identity') || missingIds.has('target_domain')) {
      status = 'missing_measure_context';
      riskLevel = 'high';
    } else if (missingIds.has('scenario_coverage') || missingIds.has('budget_anchor')) {
      status = 'needs_scenario_budget_evidence';
      riskLevel = 'high';
    } else if (missingIds.has('cost_range') || missingIds.has('expected_benefit_range')) {
      status = 'needs_cost_benefit_range';
      riskLevel = 'medium';
    } else if (missingIds.has('regulatory_fit') || missingIds.has('decision_owner')) {
      status = 'needs_regulatory_or_decision_rights_evidence';
      riskLevel = 'medium';
    } else if (
      missingIds.has('objection_window') ||
      missingIds.has('next_management_gate') ||
      missingIds.has('due_date')
    ) {
      status = 'needs_management_gate_evidence';
      riskLevel = 'medium';
    } else if (criticalMissingCount > 0 || missingEvidence.length > 0) {
      status = 'no_regret_proof_gaps_open';
      riskLevel = criticalMissingCount >= 3 ? 'high' : 'medium';
    }

    const positiveFollowUps = missingEvidence.map((item) => ({
      missingDataPoint: item.missingDataPoint,
      enablesDossierAddition: item.enablesDossierAddition,
      category: 'no_regret_measure_proof_gate',
    }));
    const sourceActions = {
      inspected: ['dashboard-api.noRegretMeasureProofGateStatus'],
      referenced: [
        'vdmi.dossier',
        'evidence-registry.findings',
        'dashboard-api.steeringArtifactAcceptanceGateStatus',
        'dashboard-api.investmentOwnerDeadlineBudgetGateStatus',
      ],
      notCalled: [
        'budget.reserve',
        'investment.approve',
        'finance.book',
        'legal.interpret',
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
    const validationFindings = missingEvidence.map((item) => ({
      code: `NRMPG_${String(item.missingDataPoint).toUpperCase()}_MISSING`,
      severity: criticalIds.includes(item.missingDataPoint) ? 'high' : 'medium',
      message: item.enablesDossierAddition,
    }));
    const dossierFacts = [
      `No-Regret Proof Status: ${status}`,
      `Risk Level: ${riskLevel}`,
      `Provided proof evidence: ${scalarRows.filter((row) => row.evidenceStatus === 'provided').length}/${scalarRows.length}`,
      `Open gaps: ${missingEvidence.length}`,
    ];
    if (params.measureName || params.measureType)
      dossierFacts.push(`Measure: ${params.measureName || params.measureType}`);
    if (params.targetDomain) dossierFacts.push(`Target Domain: ${params.targetDomain}`);
    if (params.budgetAnchor) dossierFacts.push(`Budget Anchor: ${params.budgetAnchor}`);
    if (params.nextManagementGate)
      dossierFacts.push(`Next Management Gate: ${params.nextManagementGate}`);
    if (params.decisionOwner) dossierFacts.push(`Decision Owner: ${params.decisionOwner}`);

    return {
      gateId: `nrmpg:${Buffer.from(
        `${params.measureName || params.measureType || ''}:${params.targetDomain || ''}:${params.decisionOwner || ''}:${params.nextManagementGate || ''}`
      )
        .toString('base64url')
        .slice(0, 24)}`,
      capabilityKey: 'no_regret_measure_proof_gate',
      safety: 'read_only',
      status,
      riskLevel,
      measure: {
        measureName: params.measureName || null,
        measureType: params.measureType || null,
        targetDomain: params.targetDomain || null,
      },
      proofContext: {
        scenarioCoverage: params.scenarioCoverage || null,
        budgetAnchor: params.budgetAnchor || null,
        costRange: params.costRange || null,
        expectedBenefitRange: params.expectedBenefitRange || null,
        regulatoryFit: params.regulatoryFit || null,
        objectionWindow: params.objectionWindow || null,
        evidenceSource: params.evidenceSource || null,
        nextManagementGate: params.nextManagementGate || null,
        dueDate: params.dueDate || null,
      },
      ownerContext: {
        decisionOwner: params.decisionOwner || null,
      },
      proofReference: {
        proofLabel: params.proofLabel || null,
        proofLink: params.proofLink || null,
      },
      scalarRows,
      missingEvidence,
      positiveFollowUps,
      sourceActions,
      validationFindings,
      dossierEvidence: {
        status,
        riskLevel,
        scalarRows,
        missingEvidence,
        positiveFollowUps,
        measureName: params.measureName || null,
        targetDomain: params.targetDomain || null,
        budgetAnchor: params.budgetAnchor || null,
        nextManagementGate: params.nextManagementGate || null,
        decisionOwner: params.decisionOwner || null,
        sourceActions: {
          notCalled: sourceActions.notCalled,
        },
        dossierFacts,
      },
    };
  },

  buildAnschlusskapazitaetEvidenceQueueStatus(params = {}) {
    const isProvided = (value) =>
      value !== undefined && value !== null && String(value).trim() !== '';
    const gapMap = {
      connection_request_id: 'add the connection request id for case traceability',
      netzverknuepfungspunkt_hint: 'add the NVP hint for grid-connection location assessment',
      capacity_assumption: 'add requested or assumed capacity for management review',
      grid_restriction_hint: 'add grid restriction evidence or the explicit no-restriction basis',
      future_demand_context: 'add derived future-demand context for capacity plausibility',
      legal_question_marker: 'route the open legal question without automated legal qualification',
      fnav_option_marker: 'state whether fNAV is an option, blocker or not applicable',
      evidence_status: 'add current evidence status before the next gate',
      owner_due_date: 'assign owner and due date for queue governance',
      next_gate: 'name the next gate for management review readiness',
    };
    const missingEvidence = [];
    const addGap = (missingDataPoint) => {
      missingEvidence.push({
        missingDataPoint,
        status: 'missing',
        enablesDossierAddition: gapMap[missingDataPoint],
      });
    };

    if (!isProvided(params.connectionRequestId)) addGap('connection_request_id');
    if (!isProvided(params.netzverknuepfungspunktHint)) addGap('netzverknuepfungspunkt_hint');
    if (!isProvided(params.capacityAssumptionKw)) addGap('capacity_assumption');
    if (!isProvided(params.gridRestrictionHint)) addGap('grid_restriction_hint');
    if (!isProvided(params.futureDemandContext)) addGap('future_demand_context');
    if (!isProvided(params.legalQuestionMarker)) addGap('legal_question_marker');
    if (!isProvided(params.fnavOptionMarker)) addGap('fnav_option_marker');
    if (!isProvided(params.evidenceStatus)) addGap('evidence_status');
    if (!isProvided(params.owner) || !isProvided(params.dueDate)) addGap('owner_due_date');
    if (!isProvided(params.nextGate)) addGap('next_gate');

    let status = 'ready_for_review';
    if (missingEvidence.some((gap) => gap.missingDataPoint === 'connection_request_id')) {
      status = 'needs_connection_request';
    } else if (
      missingEvidence.some((gap) => gap.missingDataPoint === 'netzverknuepfungspunkt_hint')
    ) {
      status = 'needs_nvp_evidence';
    } else if (missingEvidence.some((gap) => gap.missingDataPoint === 'capacity_assumption')) {
      status = 'needs_capacity_assumption';
    } else if (
      missingEvidence.some(
        (gap) =>
          gap.missingDataPoint === 'legal_question_marker' ||
          gap.missingDataPoint === 'fnav_option_marker'
      )
    ) {
      status = 'needs_legal_review';
    } else if (missingEvidence.some((gap) => gap.missingDataPoint === 'owner_due_date')) {
      status = 'needs_owner_due_date';
    } else if (missingEvidence.length > 0) {
      status = 'missing_evidence';
    }

    const requiredCount = Object.keys(gapMap).length;
    const readinessScore = Number(
      ((requiredCount - missingEvidence.length) / requiredCount).toFixed(2)
    );
    const positiveFollowUps = missingEvidence.map((gap) => ({
      ...gap,
      category: 'anschlusskapazitaet_evidence_queue',
    }));
    const sourceActions = {
      inspected: ['dashboard-api.anschlusskapazitaetEvidenceQueueStatus'],
      referenced: [
        'grid-connection.validate',
        'grid-connection.capacityCheck',
        'vdmi.dossier',
        'evidence-registry.lookup',
        'interface-placeholder.requestEvidence',
      ],
      notCalled: [
        'grid-connection.reserveCapacity',
        'grid-connection.approve',
        'grid-connection.reject',
        'fnav.decide',
        'legal.interpret',
        'billing.release',
        'tariff.mutate',
        'mako.dispatch',
        'settlement.exportA96',
        'settlement.prepareBilling',
        'hitl.create',
        'external.connector.call',
        'personal-agent.execute',
      ],
    };
    const evidenceQueue = {
      connectionRequestId: params.connectionRequestId || null,
      netzverknuepfungspunktHint: params.netzverknuepfungspunktHint || null,
      capacityAssumptionKw: params.capacityAssumptionKw ?? null,
      gridRestrictionHint: params.gridRestrictionHint || null,
      futureDemandContext: params.futureDemandContext || null,
      legalQuestionMarker: params.legalQuestionMarker || null,
      fnavOptionMarker: params.fnavOptionMarker || null,
      evidenceStatus: params.evidenceStatus || null,
      owner: params.owner || null,
      dueDate: params.dueDate || null,
      nextGate: params.nextGate || null,
      capacityReserved: false,
      connectionDecisionApplied: false,
      legalConclusionAutomated: false,
    };
    const evidenceItems = Object.entries(evidenceQueue)
      .filter(
        ([key, value]) =>
          !['capacityReserved', 'connectionDecisionApplied', 'legalConclusionAutomated'].includes(
            key
          ) && isProvided(value)
      )
      .map(([key, value]) => ({ id: key, value, status: 'provided' }));
    const dossierFacts = [
      `Status: ${status}`,
      `Connection Request: ${evidenceQueue.connectionRequestId || 'missing'}`,
      `NVP Hint: ${evidenceQueue.netzverknuepfungspunktHint || 'missing'}`,
      `Capacity Assumption: ${evidenceQueue.capacityAssumptionKw ?? 'missing'}`,
      `Grid Restriction: ${evidenceQueue.gridRestrictionHint || 'missing'}`,
      `Legal/FNAV: ${evidenceQueue.legalQuestionMarker || 'missing'} / ${evidenceQueue.fnavOptionMarker || 'missing'}`,
      `Owner/Due Date: ${evidenceQueue.owner || 'missing'} / ${evidenceQueue.dueDate || 'missing'}`,
      `Next Gate: ${evidenceQueue.nextGate || 'missing'}`,
    ];

    return {
      queueId: `aceq:${Buffer.from(
        `${params.connectionRequestId || ''}:${params.netzverknuepfungspunktHint || ''}:${params.owner || ''}`
      )
        .toString('base64url')
        .slice(0, 28)}`,
      capabilityKey: 'anschlusskapazitaet_evidence_queue',
      safety: 'read_only',
      status,
      readinessScore,
      evidenceQueue,
      evidenceItems,
      missingEvidence,
      positiveFollowUps,
      nextGate: params.nextGate || null,
      sourceActions,
      validationFindings: missingEvidence.map((gap) => ({
        code: `ACEQ_${String(gap.missingDataPoint).toUpperCase()}_MISSING`,
        severity: [
          'connection_request_id',
          'capacity_assumption',
          'legal_question_marker',
          'fnav_option_marker',
        ].includes(gap.missingDataPoint)
          ? 'high'
          : 'medium',
        message: gap.enablesDossierAddition,
      })),
      dossierEvidence: {
        capabilityKey: 'anschlusskapazitaet_evidence_queue',
        status,
        readinessScore,
        evidenceQueue,
        evidenceItems,
        missingEvidence,
        positiveFollowUps,
        nextGate: params.nextGate || null,
        sourceActions: { notCalled: sourceActions.notCalled },
        dossierFacts,
      },
    };
  },

  buildConnectionDeadlineEvidenceQueueStatus(params = {}) {
    const isProvided = (value) =>
      value !== undefined &&
      value !== null &&
      (Array.isArray(value) ? value.length > 0 : String(value).trim() !== '');
    const toList = (value) => {
      if (Array.isArray(value)) return value.filter(isProvided).map((item) => String(item));
      if (!isProvided(value)) return [];
      return String(value)
        .split(',')
        .map((item) => item.trim())
        .filter(Boolean);
    };
    const asOf = params.asOf ? new Date(params.asOf) : new Date();
    const deadline = params.deadlineDate ? new Date(params.deadlineDate) : null;
    const daysUntilDeadline =
      deadline && !Number.isNaN(deadline.getTime())
        ? Math.ceil((deadline.getTime() - asOf.getTime()) / (24 * 60 * 60 * 1000))
        : null;
    let deadlineRisk = 'deadline_missing';
    if (daysUntilDeadline != null) {
      if (daysUntilDeadline < 0) deadlineRisk = 'overdue';
      else if (daysUntilDeadline <= 7) deadlineRisk = 'fristkritisch';
      else if (daysUntilDeadline <= 30) deadlineRisk = 'due_soon';
      else deadlineRisk = 'im_plan';
    }

    const explicitMissingEvidence = toList(params.missingEvidence);
    const clarificationPoints = toList(params.clarificationPoints);
    const gapMap = {
      case_id: {
        present: isProvided(params.caseId),
        enablesDossierAddition: 'adds the concrete connection case to the evidence queue',
      },
      deadline_date: {
        present: isProvided(params.deadlineDate),
        enablesDossierAddition: 'adds deadline-risk classification and due-date proof',
      },
      responsible_vnb: {
        present: isProvided(params.responsibleVnb),
        enablesDossierAddition: 'adds the accountable VNB responsibility for the connection case',
      },
      technical_plausibility: {
        present: isProvided(params.technicalPlausibility),
        enablesDossierAddition: 'adds technical-readiness evidence for gate advancement',
      },
      owner: {
        present: isProvided(params.owner),
        enablesDossierAddition: 'adds accountable owner and escalation path',
      },
      next_gate: {
        present: isProvided(params.nextGate),
        enablesDossierAddition: 'adds the next release or clarification gate',
      },
    };
    const missingEvidence = Object.entries(gapMap)
      .filter(([, spec]) => !spec.present)
      .map(([missingDataPoint, spec]) => ({
        missingDataPoint,
        enablesDossierAddition: spec.enablesDossierAddition,
      }));
    for (const item of explicitMissingEvidence) {
      missingEvidence.push({
        missingDataPoint: item,
        enablesDossierAddition: `adds submitted evidence item ${item} to the connection dossier`,
      });
    }
    if (clarificationPoints.length > 0) {
      missingEvidence.push({
        missingDataPoint: 'clarification_points_open',
        enablesDossierAddition:
          'adds ready-for-release status once clarification points are resolved',
      });
    }

    let status = 'klaerungsbereit';
    if (deadlineRisk === 'overdue' || deadlineRisk === 'fristkritisch') status = 'fristkritisch';
    else if (
      missingEvidence.some((gap) =>
        ['case_id', 'deadline_date', 'responsible_vnb', 'technical_plausibility'].includes(
          gap.missingDataPoint
        )
      )
    ) {
      status = 'nachweisoffen';
    } else if (clarificationPoints.length > 0) {
      status = 'klaerungsbereit';
    } else {
      status = 'im_plan';
    }

    const evidenceQueue = {
      caseId: params.caseId || null,
      connectionType: params.connectionType || null,
      deadlineDate: params.deadlineDate || null,
      daysUntilDeadline,
      responsibleVnb: params.responsibleVnb || null,
      technicalPlausibility: params.technicalPlausibility || null,
      owner: params.owner || null,
      nextGate: params.nextGate || null,
      communicationContext: params.communicationContext || null,
      communicationSent: false,
      connectionDecisionApplied: false,
      workflowMutationApplied: false,
    };
    const evidenceItems = Object.entries(evidenceQueue)
      .filter(
        ([key, value]) =>
          !['communicationSent', 'connectionDecisionApplied', 'workflowMutationApplied'].includes(
            key
          ) && isProvided(value)
      )
      .map(([id, value]) => ({ id, value, status: 'provided' }));
    const sourceActions = {
      inspected: ['dashboard-api.connectionDeadlineEvidenceQueueStatus'],
      referenced: [
        'grid-connection.validate',
        'vdmi.dossier',
        'evidence-registry.lookup',
        'interface-placeholder.requestEvidence',
      ],
      notCalled: [
        'communication.send',
        'email.send',
        'crm.update',
        'customer-portal.write',
        'workflow.execute',
        'grid-connection.reserveCapacity',
        'grid-connection.approve',
        'grid-connection.reject',
        'legal.interpret',
        'deadline.legalCalculate',
        'hitl.create',
        'billing.release',
        'settlement.prepareBilling',
        'settlement.exportA96',
        'tariff.mutate',
        'mako.dispatch',
        'device-control.execute',
        'external.connector.call',
        'personal-agent.execute',
      ],
    };
    const communicationNoteDraft = {
      status: params.communicationContext ? 'draft_ready' : 'context_missing',
      subject: `Anschlussverfahren ${params.caseId || 'ohne Fall-ID'} - Evidenzstand`,
      body:
        params.communicationContext ||
        'Kommunikationsnotiz bleibt Entwurf, bis Kontext und Freigabe vorliegen.',
      sent: false,
    };
    const positiveFollowUps = missingEvidence.map((gap) => ({
      ...gap,
      category: 'connection_deadline_evidence_queue',
    }));
    const dossierFacts = [
      `Status: ${status}`,
      `Deadline Risk: ${deadlineRisk}`,
      `Case: ${evidenceQueue.caseId || 'missing'}`,
      `Responsible VNB: ${evidenceQueue.responsibleVnb || 'missing'}`,
      `Technical Plausibility: ${evidenceQueue.technicalPlausibility || 'missing'}`,
      `Owner/Gate: ${evidenceQueue.owner || 'missing'} / ${evidenceQueue.nextGate || 'missing'}`,
      `Communication Draft: ${communicationNoteDraft.status}`,
    ];

    return {
      queueId: `cdeq:${Buffer.from(
        `${params.caseId || ''}:${params.deadlineDate || ''}:${params.owner || ''}`
      )
        .toString('base64url')
        .slice(0, 28)}`,
      capabilityKey: 'connection_deadline_evidence_queue',
      safety: 'read_only',
      status,
      deadlineRisk,
      evidenceQueue,
      evidenceItems,
      missingEvidence,
      clarificationPoints,
      positiveFollowUps,
      nextGate: params.nextGate || null,
      communicationNoteDraft,
      sourceActions,
      validationFindings: missingEvidence.map((gap) => ({
        code: `CDEQ_${String(gap.missingDataPoint).toUpperCase()}_MISSING`,
        severity: ['case_id', 'deadline_date', 'responsible_vnb'].includes(gap.missingDataPoint)
          ? 'high'
          : 'medium',
        message: gap.enablesDossierAddition,
      })),
      dossierEvidence: {
        capabilityKey: 'connection_deadline_evidence_queue',
        status,
        deadlineRisk,
        evidenceQueue,
        evidenceItems,
        missingEvidence,
        clarificationPoints,
        positiveFollowUps,
        nextGate: params.nextGate || null,
        communicationNoteDraft,
        sourceActions: { notCalled: sourceActions.notCalled },
        dossierFacts,
      },
    };
  },

  buildLayer0AuditDrilldownNoteStatus(params = {}) {
    const isProvided = (value) =>
      value !== undefined && value !== null && String(value).trim() !== '';
    const anomalyScope = params.kpiId || params.topic || null;
    const gapMap = {
      anomaly_scope: 'add the concrete Layer-0 KPI or anomaly topic',
      data_source: 'add the data source basis for the audit note',
      peer_deviation: 'add the benchmark or peer deviation',
      owner: 'add accountable follow-up ownership',
      next_90_day_focus: 'add the next 90-day validation step',
    };
    const missingEvidence = [];
    const addGap = (missingDataPoint) => {
      missingEvidence.push({
        missingDataPoint,
        status: 'missing',
        enablesDossierAddition: gapMap[missingDataPoint],
      });
    };

    if (!isProvided(anomalyScope)) addGap('anomaly_scope');
    if (!isProvided(params.dataSource)) addGap('data_source');
    if (!isProvided(params.peerDeviation)) addGap('peer_deviation');
    if (!isProvided(params.owner)) addGap('owner');
    if (!isProvided(params.next90DayFocus)) addGap('next_90_day_focus');

    let status = 'ready_for_management_validation';
    if (missingEvidence.some((gap) => gap.missingDataPoint === 'anomaly_scope')) {
      status = 'needs_anomaly_scope';
    } else if (missingEvidence.some((gap) => gap.missingDataPoint === 'data_source')) {
      status = 'needs_data_source';
    } else if (missingEvidence.some((gap) => gap.missingDataPoint === 'peer_deviation')) {
      status = 'needs_peer_deviation';
    } else if (missingEvidence.some((gap) => gap.missingDataPoint === 'owner')) {
      status = 'needs_owner';
    } else if (missingEvidence.length > 0) {
      status = 'missing_evidence';
    }

    const validationScore = Number(
      ((Object.keys(gapMap).length - missingEvidence.length) / Object.keys(gapMap).length).toFixed(
        2
      )
    );
    const hypothesis = isProvided(params.peerDeviation)
      ? `The Layer-0 signal ${anomalyScope || 'without a named KPI'} deviates from the peer basis (${params.peerDeviation}) and should be validated before management interpretation.`
      : `The Layer-0 signal ${anomalyScope || 'without a named KPI'} requires a peer deviation before management interpretation.`;
    const possibleMisinterpretation =
      'The benchmark signal is a validation lead, not a final legal, regulatory or operational finding.';
    const checkFields = [
      {
        id: 'source_lineage',
        label: 'Data source lineage',
        value: params.dataSource || null,
        status: isProvided(params.dataSource) ? 'provided' : 'missing',
      },
      {
        id: 'kpi_definition',
        label: 'KPI definition',
        value: anomalyScope,
        status: isProvided(anomalyScope) ? 'provided' : 'missing',
      },
      {
        id: 'peer_group',
        label: 'Peer group',
        value: params.benchmarkPeerGroup || null,
        status: isProvided(params.benchmarkPeerGroup) ? 'provided' : 'open',
      },
      {
        id: 'peer_deviation',
        label: 'Peer deviation',
        value: params.peerDeviation || null,
        status: isProvided(params.peerDeviation) ? 'provided' : 'missing',
      },
      {
        id: 'process_context',
        label: 'Process context',
        value: params.processHint || null,
        status: isProvided(params.processHint) ? 'provided' : 'open',
      },
      {
        id: 'period_context',
        label: 'Period context',
        value: params.periodHint || null,
        status: isProvided(params.periodHint) ? 'provided' : 'open',
      },
      {
        id: 'observed_expected_value',
        label: 'Observed vs expected value',
        value:
          isProvided(params.observedValue) || isProvided(params.expectedValue)
            ? `${params.observedValue || 'n/a'} / ${params.expectedValue || 'n/a'} ${params.unit || ''}`.trim()
            : null,
        status:
          isProvided(params.observedValue) || isProvided(params.expectedValue)
            ? 'provided'
            : 'open',
      },
      {
        id: 'misinterpretation_risk',
        label: 'Misinterpretation risk',
        value: possibleMisinterpretation,
        status: 'provided',
      },
      {
        id: 'owner',
        label: 'Owner',
        value: params.owner || null,
        status: isProvided(params.owner) ? 'provided' : 'missing',
      },
      {
        id: 'next_90_day_step',
        label: 'Next 90-day step',
        value: params.next90DayFocus || null,
        status: isProvided(params.next90DayFocus) ? 'provided' : 'missing',
      },
    ];
    const positiveFollowUps = missingEvidence.map((gap) => ({
      ...gap,
      category: 'layer0_audit_drilldown_note',
    }));
    const sourceActions = {
      inspected: ['dashboard-api.layer0AuditDrilldownNoteStatus'],
      referenced: [
        'evidence-registry.lookup',
        'vdmi.dossier',
        'datapoint.health',
        'mastr-quality.audit',
        'vnb-monitor.snapshot',
      ],
      notCalled: [
        'audit-queue.create',
        'benchmark.connector.fetch',
        'object-store.watch',
        'report.pdf.generate',
        'presentation.deck.generate',
        'legal.interpret',
        'regulatory.finalJudgment',
        'billing.release',
        'tariff.mutate',
        'mako.dispatch',
        'settlement.exportA96',
        'device-control.execute',
        'hitl.create',
        'external.connector.call',
        'personal-agent.execute',
      ],
    };
    const auditNote = {
      noteId: `l0ad:${Buffer.from(
        `${anomalyScope || ''}:${params.dataSource || ''}:${params.owner || ''}`
      )
        .toString('base64url')
        .slice(0, 28)}`,
      kpiId: params.kpiId || null,
      topic: params.topic || null,
      dataSource: params.dataSource || null,
      peerDeviation: params.peerDeviation || null,
      benchmarkPeerGroup: params.benchmarkPeerGroup || null,
      observedValue: params.observedValue || null,
      expectedValue: params.expectedValue || null,
      unit: params.unit || null,
      processHint: params.processHint || null,
      periodHint: params.periodHint || null,
      hypothesis,
      possibleMisinterpretation,
      owner: params.owner || null,
      next90DayStep: params.next90DayFocus || null,
      evidenceStatus: params.evidenceStatus || (missingEvidence.length ? 'incomplete' : 'complete'),
      persistentQueueCreated: false,
      reportGenerated: false,
      finalJudgmentApplied: false,
    };
    const dossierFacts = [
      `Status: ${status}`,
      `Anomaly: ${anomalyScope || 'missing'}`,
      `Data Source: ${auditNote.dataSource || 'missing'}`,
      `Peer Deviation: ${auditNote.peerDeviation || 'missing'}`,
      `Hypothesis: ${hypothesis}`,
      `Misinterpretation Risk: ${possibleMisinterpretation}`,
      `Check Fields: ${checkFields.length}/10`,
      `Owner: ${auditNote.owner || 'missing'}`,
      `Next 90-Day Step: ${auditNote.next90DayStep || 'missing'}`,
    ];

    return {
      capabilityKey: 'layer0_audit_drilldown_note',
      safety: 'read_only',
      status,
      validationScore,
      auditNote,
      hypothesis,
      possibleMisinterpretation,
      checkFields,
      evidenceStatus: auditNote.evidenceStatus,
      missingEvidence,
      positiveFollowUps,
      sourceActions,
      validationFindings: missingEvidence.map((gap) => ({
        code: `L0AD_${String(gap.missingDataPoint).toUpperCase()}_MISSING`,
        severity: ['anomaly_scope', 'data_source', 'peer_deviation'].includes(gap.missingDataPoint)
          ? 'high'
          : 'medium',
        message: gap.enablesDossierAddition,
      })),
      dossierEvidence: {
        capabilityKey: 'layer0_audit_drilldown_note',
        status,
        validationScore,
        auditNote,
        hypothesis,
        possibleMisinterpretation,
        checkFields,
        evidenceStatus: auditNote.evidenceStatus,
        missingEvidence,
        positiveFollowUps,
        sourceActions: { notCalled: sourceActions.notCalled },
        dossierFacts,
      },
    };
  },

  buildLegalClarificationOperatingModelStatus(params = {}) {
    const toList = (value) =>
      Array.isArray(value)
        ? value.filter(Boolean)
        : value
          ? String(value)
              .split(',')
              .map((item) => item.trim())
              .filter(Boolean)
          : [];
    const noRegretDataNeeds = toList(params.noRegretDataNeeds);
    const availableEvidence = toList(params.availableEvidence);
    const scenarioOptions = toList(params.scenarioOptions);
    const redLines = toList(params.redLines);
    const normalizedLegalStatus = String(params.legalStatus || 'pending').toLowerCase();
    const legalIsApproved = ['approved', 'cleared', 'geklaert', 'geklärt', 'freigegeben'].includes(
      normalizedLegalStatus
    );

    const evidenceSpecs = [
      {
        id: 'clarification_point',
        label: 'Clarification point',
        value: params.clarificationPoint,
        sourceClass: 'legal_clarification_scope',
        enablesDossierAddition: 'name the legal question that gates the operating model',
      },
      {
        id: 'affected_decision',
        label: 'Affected decision',
        value: params.affectedDecision,
        sourceClass: 'operational_decision_boundary',
        enablesDossierAddition: 'tie the legal answer to a concrete VNB decision',
      },
      {
        id: 'legal_status',
        label: 'Legal status',
        value: legalIsApproved ? params.legalStatus : null,
        sourceClass: 'legal_status',
        enablesDossierAddition: 'state whether execution is legally cleared instead of pending',
      },
      {
        id: 'owner',
        label: 'Owner',
        value: params.owner,
        sourceClass: 'preparation_owner',
        enablesDossierAddition: 'assign preparation responsibility',
      },
      {
        id: 'owner_contact',
        label: 'Owner contact',
        value: params.ownerContact,
        sourceClass: 'preparation_owner_contact',
        enablesDossierAddition: 'add an accountable contact for follow-up',
      },
      {
        id: 'no_regret_data_needs',
        label: 'No-regret data needs',
        value: noRegretDataNeeds.length > 0 ? noRegretDataNeeds.join(', ') : null,
        sourceClass: 'no_regret_preparation',
        enablesDossierAddition:
          'replace generic preparation gaps with concrete no-regret data needs',
      },
      {
        id: 'available_evidence',
        label: 'Available evidence',
        value: availableEvidence.length > 0 ? availableEvidence.join(', ') : null,
        sourceClass: 'preparation_evidence_status',
        enablesDossierAddition: 'show which no-regret evidence is already available',
      },
      {
        id: 'scenario_options',
        label: 'Scenario options',
        value: scenarioOptions.length > 0 ? scenarioOptions.join(', ') : null,
        sourceClass: 'allowed_preparation_scenario',
        enablesDossierAddition: 'list allowed preparation scenarios before the legal answer',
      },
      {
        id: 'red_lines',
        label: 'Red lines',
        value: redLines.length > 0 ? redLines.join(', ') : null,
        sourceClass: 'execution_boundary',
        enablesDossierAddition: 'distinguish allowed preparation from blocked execution',
      },
      {
        id: 'implementation_status',
        label: 'Implementation status',
        value: params.implementationStatus,
        sourceClass: 'implementation_preparation_status',
        enablesDossierAddition: 'show what can be executed after the legal answer arrives',
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
    const decisionReadiness =
      params.decisionReadiness ||
      (legalIsApproved && missingEvidence.length === 0
        ? 'ready_after_legal_clearance'
        : legalIsApproved
          ? 'needs_preparation_evidence'
          : 'blocked_by_pending_legal_clarification');
    const status = !params.clarificationPoint
      ? 'needs_clarification_point'
      : !params.affectedDecision
        ? 'needs_affected_decision'
        : !legalIsApproved
          ? 'pending_legal_clarification'
          : missingEvidence.length === 0
            ? 'ready_after_legal_clearance'
            : 'needs_preparation_evidence';
    const positiveFollowUps = missingEvidence.map((item) => ({
      missingDataPoint: item.missingDataPoint,
      enablesDossierAddition: item.enablesDossierAddition,
      category: 'legal_clarification_operating_model',
    }));
    const blockingFindings = missingEvidence.map((item) => ({
      code: `LCOM_${String(item.missingDataPoint).toUpperCase()}_MISSING`,
      severity: ['clarification_point', 'affected_decision', 'legal_status'].includes(
        item.missingDataPoint
      )
        ? 'high'
        : 'medium',
      message: item.enablesDossierAddition,
    }));
    const preparationModel = {
      caseId: params.caseId || null,
      clarificationPoint: params.clarificationPoint || null,
      affectedDecision: params.affectedDecision || null,
      legalStatus: params.legalStatus || 'pending',
      contractStatus: params.contractStatus || null,
      noRegretDataNeeds,
      availableEvidence,
      rolesAndOwners: {
        owner: params.owner || null,
        ownerContact: params.ownerContact || null,
      },
      ownerGaps: [
        ...(!params.owner ? ['owner'] : []),
        ...(!params.ownerContact ? ['owner_contact'] : []),
      ],
      scenarioOptions,
      redLines,
      implementationStatus: params.implementationStatus || null,
    };
    const dossierFacts = [
      `Status: ${status}`,
      `Legal status: ${params.legalStatus || 'pending'}`,
      `Decision readiness: ${decisionReadiness}`,
      `Open gaps: ${missingEvidence.length}`,
    ];
    if (params.caseId) dossierFacts.push(`Case: ${params.caseId}`);
    if (params.affectedDecision) dossierFacts.push(`Decision: ${params.affectedDecision}`);

    return {
      operatingModelId: `lcom:${Buffer.from(
        `${params.caseId || ''}:${params.clarificationPoint || ''}:${params.affectedDecision || ''}:${params.owner || ''}`
      )
        .toString('base64url')
        .slice(0, 24)}`,
      capabilityKey: 'legal_clarification_operating_model',
      safety: 'read_only',
      requestContext: {
        caseId: params.caseId || null,
        tenantScope: 'request',
      },
      status,
      legalStatus: params.legalStatus || 'pending',
      decisionReadiness,
      preparationModel,
      evidenceItems,
      missingEvidence,
      positiveFollowUps,
      blockingFindings,
      sourceActions: {
        inspected: ['dashboard-api.legalClarificationOperatingModelStatus'],
        referenced: [
          'grid-operations.netzfahrplanGenerate',
          'grid-connection.fnavValidate',
          'vdmi.dossier',
          'interface-placeholder.requestEvidence',
          'znp.addAssumption',
        ],
        notCalled: [
          'legal.interpret',
          'legal.approve',
          'contract.release',
          'dispatch.execute',
          'billing.release',
          'settlement.prepareBilling',
          'settlement.exportA96',
          'tariff.mutate',
          'mako.dispatch',
          'hitl.create',
          'grid-operations.executeControl',
          'device-control.execute',
          'external.connector.call',
          'personal-agent.execute',
        ],
      },
      validationFindings: blockingFindings,
      dossierEvidence: {
        status,
        legalStatus: params.legalStatus || 'pending',
        decisionReadiness,
        preparationModel,
        evidenceItems,
        missingEvidence,
        positiveFollowUps,
        blockingFindings,
        dossierFacts,
      },
    };
  },

  buildDrReadinessEvidenceStatus(params = {}) {
    const normalizeStatus = (value) => {
      const text = String(value || '')
        .trim()
        .toLowerCase();
      if (!text) return 'missing';
      if (
        /^(ready|ok|green|gruen|grün|complete|completed|valid|validiert|confirmed|bestaetigt|bestätigt|approved|freigegeben|present|vorhanden|tested|passed)$/.test(
          text
        )
      )
        return 'ready';
      if (
        /^(partial|partly|pending|open|offen|in_progress|in-progress|review|review_required|scheduled|planned|unknown|unklar)$/.test(
          text
        )
      )
        return 'partial';
      if (/^(missing|fehlt|absent|not_available|not-available)$/.test(text)) return 'missing';
      if (/^(blocked|blockiert|red|rot|failed|fail|rejected|not_ready|not-ready|stop)$/.test(text))
        return 'blocked';
      if (/(block|fail|fehl|kritisch|red|rot|reject)/.test(text)) return 'blocked';
      return 'ready';
    };
    const tenantScope = params.tenantScope || 'request';
    const evidenceSpecs = [
      {
        id: 'store_inventory',
        label: 'Store inventory',
        value: params.storeInventoryStatus,
        sourceClass: 'dr_store_inventory',
        enablesDossierAddition: 'add PouchDB/job/observability/MQTT store inventory evidence',
        statusWhenMissing: 'needs_store_inventory',
      },
      {
        id: 'snapshot_manifest',
        label: 'Snapshot manifest',
        value: params.snapshotManifestStatus,
        sourceClass: 'dr_snapshot_manifest',
        enablesDossierAddition: 'add cutover snapshot manifest evidence',
        statusWhenMissing: 'needs_snapshot_manifest',
      },
      {
        id: 'restore_drill',
        label: 'Restore drill',
        value: params.restoreDrillStatus || params.lastDrillDate,
        displayValue: params.restoreDrillStatus || params.lastDrillDate,
        sourceClass: 'dr_restore_drill',
        enablesDossierAddition: 'add restore-drill proof and drill date',
        statusWhenMissing: 'needs_restore_drill',
      },
      {
        id: 'rto_target',
        label: 'RTO target',
        value: params.rtoTarget,
        sourceClass: 'dr_rto_objective',
        enablesDossierAddition: 'add Recovery Time Objective evidence',
        statusWhenMissing: 'needs_rto_rpo',
      },
      {
        id: 'rpo_target',
        label: 'RPO target',
        value: params.rpoTarget,
        sourceClass: 'dr_rpo_objective',
        enablesDossierAddition: 'add Recovery Point Objective evidence',
        statusWhenMissing: 'needs_rto_rpo',
      },
      {
        id: 'per_tenant_restore',
        label: 'Per-tenant restore proof',
        value: params.perTenantRestoreStatus,
        sourceClass: 'dr_tenant_restore',
        enablesDossierAddition: 'add tenant-scope restore evidence',
        statusWhenMissing: 'needs_per_tenant_restore',
      },
      {
        id: 'owner',
        label: 'DR owner',
        value: params.owner,
        sourceClass: 'dr_owner',
        enablesDossierAddition: 'add accountable DR owner',
        statusWhenMissing: 'needs_owner',
      },
      {
        id: 'next_drill_due',
        label: 'Next drill due',
        value: params.nextDrillDue,
        sourceClass: 'dr_drill_schedule',
        enablesDossierAddition: 'add next DR drill due date',
        statusWhenMissing: 'needs_next_drill_due',
      },
    ];
    const signals = evidenceSpecs.map((spec) => {
      const status = normalizeStatus(spec.value);
      return {
        id: spec.id,
        label: spec.label,
        status,
        value: spec.displayValue || spec.value || null,
        sourceClass: spec.sourceClass,
        enablesDossierAddition: spec.enablesDossierAddition,
        statusWhenMissing: spec.statusWhenMissing,
      };
    });
    const evidenceItems = signals
      .filter((signal) => signal.status === 'ready')
      .map((signal) => ({
        id: signal.id,
        label: signal.label,
        value: signal.value || signal.status,
        sourceClass: signal.sourceClass,
        evidenceStatus: 'provided',
      }));
    const missingEvidence = signals
      .filter((signal) => signal.status !== 'ready')
      .map((signal) => ({
        missingDataPoint: signal.id,
        label: signal.label,
        status: signal.status,
        value: signal.value,
        sourceClass: signal.sourceClass,
        enablesDossierAddition: signal.enablesDossierAddition,
        statusWhenMissing: signal.statusWhenMissing,
      }));
    const riskFlags = missingEvidence
      .filter(
        (item) =>
          [
            'store_inventory',
            'snapshot_manifest',
            'restore_drill',
            'rto_target',
            'rpo_target',
          ].includes(item.missingDataPoint) || item.status === 'blocked'
      )
      .map((item) => ({
        code: `DR_${String(item.missingDataPoint).toUpperCase()}_${item.status === 'blocked' ? 'BLOCKED' : 'MISSING'}`,
        severity: item.status === 'blocked' ? 'high' : 'medium',
        message: item.enablesDossierAddition,
      }));
    const firstGap = missingEvidence[0];
    const status =
      missingEvidence.length === 0
        ? 'ready_for_dr_evidence'
        : missingEvidence.some((item) => item.status === 'blocked')
          ? 'blocked_by_dr_evidence'
          : firstGap?.statusWhenMissing || 'needs_dr_evidence';
    const readinessLevel =
      missingEvidence.length === 0
        ? 'ready'
        : riskFlags.some((flag) => flag.severity === 'high')
          ? 'blocked'
          : evidenceItems.length >= 4
            ? 'partial'
            : 'needs_evidence';
    const readinessScore = Number((evidenceItems.length / evidenceSpecs.length).toFixed(2));
    const positiveFollowUps = missingEvidence.map((item) => ({
      missingDataPoint: item.missingDataPoint,
      status: item.status,
      value: item.value,
      enablesDossierAddition: item.enablesDossierAddition,
      category: 'dr_readiness_evidence_gate',
    }));
    const sourceActions = {
      inspected: ['dashboard-api.drReadinessEvidenceStatus'],
      referenced: [
        'vdmi.dossier',
        'datapoint.health',
        'audit.report',
        'deployment.runbook',
        'interface-placeholder.requestEvidence',
      ],
      notCalled: [
        'backup.full',
        'backup.tenant',
        'backup.restore',
        'backup-orchestrator.schedule',
        'replication.start',
        'tenant.snapshot',
        'tenant.restore',
        'archive.encrypt',
        'external-storage.write',
        'webhooks.emit',
        'tenant-data.mutate',
        'hitl.create',
        'personal-agent.execute',
        'external.connector.call',
      ],
    };
    const dossierFacts = [
      `Status: ${status}`,
      `Readiness Level: ${readinessLevel}`,
      `Provided DR evidence: ${evidenceItems.length}/${evidenceSpecs.length}`,
      `Open gaps: ${missingEvidence.length}`,
    ];
    if (tenantScope) dossierFacts.push(`Tenant Scope: ${tenantScope}`);
    if (params.rtoTarget) dossierFacts.push(`RTO: ${params.rtoTarget}`);
    if (params.rpoTarget) dossierFacts.push(`RPO: ${params.rpoTarget}`);

    return {
      drReadinessEvidenceId: `drreg:${Buffer.from(
        `${tenantScope}:${params.snapshotManifestStatus || ''}:${params.restoreDrillStatus || ''}:${params.owner || ''}`
      )
        .toString('base64url')
        .slice(0, 28)}`,
      capabilityKey: 'dr_readiness_evidence_gate',
      safety: 'read_only',
      requestContext: {
        tenantScope,
        notes: params.notes || null,
      },
      status,
      readinessLevel,
      readinessScore,
      evidenceItems,
      missingEvidence,
      riskFlags,
      owner: params.owner || null,
      nextAction: positiveFollowUps[0]?.enablesDossierAddition || 'keep DR evidence current',
      positiveFollowUps,
      sourceActions,
      validationFindings: riskFlags,
      dossierEvidence: {
        status,
        readinessLevel,
        readinessScore,
        tenantScope,
        evidenceItems,
        missingEvidence,
        riskFlags,
        owner: params.owner || null,
        nextAction: positiveFollowUps[0]?.enablesDossierAddition || 'keep DR evidence current',
        positiveFollowUps,
        sourceActions: {
          notCalled: sourceActions.notCalled,
        },
        dossierFacts,
      },
    };
  },

  buildSpecialGridUsageImpactMapStatus(params = {}) {
    const toList = (value) =>
      Array.isArray(value)
        ? value.filter(Boolean)
        : value
          ? String(value)
              .split(',')
              .map((item) => item.trim())
              .filter(Boolean)
          : [];
    const normalizeStatus = (value) => {
      if (value === true) return 'ready';
      if (value === false || value == null || value === '') return 'missing';
      const normalized = String(value).trim().toLowerCase();
      if (
        [
          'ready',
          'complete',
          'completed',
          'available',
          'provided',
          'confirmed',
          'ok',
          'valid',
          'mapped',
          'reviewed',
          'approved',
          'sent',
        ].includes(normalized)
      )
        return 'ready';
      if (
        ['risk', 'risky', 'overdue', 'late', 'expired', 'critical', 'deadline_risk'].includes(
          normalized
        )
      )
        return 'risk';
      if (
        [
          'blocked',
          'unclear',
          'pending_legal',
          'regulatory_uncertainty',
          'legal_uncertainty',
          'pending',
        ].includes(normalized)
      )
        return 'blocked';
      if (['missing', 'open', 'needed', 'required', 'unknown', 'none', 'no'].includes(normalized))
        return 'missing';
      return 'ready';
    };
    const sourceDatapoints = toList(params.sourceDatapoints);
    const caseType = params.caseType || 'specialGridUsage';
    const caseId =
      params.caseId ||
      `special-grid-usage:${Buffer.from(
        `${caseType}:${params.customerId || ''}:${params.ownerRole || ''}`
      )
        .toString('base64url')
        .slice(0, 24)}`;
    const evidenceSpecs = [
      {
        id: 'application_status',
        label: 'Application intake/proof',
        value: params.applicationStatus,
        sourceClass: 'application_evidence',
        enablesDossierAddition: 'add application intake/proof status',
        statusWhenMissing: 'needs_application_evidence',
      },
      {
        id: 'form_status',
        label: 'Required-form completeness',
        value: params.formStatus,
        sourceClass: 'form_evidence',
        enablesDossierAddition: 'add required-form completeness',
        statusWhenMissing: 'needs_form_evidence',
      },
      {
        id: 'deadline_status',
        label: 'Deadline status',
        value: params.deadlineStatus,
        sourceClass: 'deadline_evidence',
        enablesDossierAddition: 'add deadline and filing-window evidence',
        statusWhenMissing: 'needs_deadline_evidence',
      },
      {
        id: 'quantity_basis',
        label: 'Quantity basis',
        value: params.quantityBasis,
        sourceClass: 'quantity_evidence',
        enablesDossierAddition: 'add source-backed quantity evidence',
        statusWhenMissing: 'needs_quantity_basis',
      },
      {
        id: 'calculation_logic_ref',
        label: 'Calculation/legal-review reference',
        value: params.calculationLogicRef,
        sourceClass: 'calculation_reference',
        enablesDossierAddition: 'add referenced calculation or legal-review basis',
        statusWhenMissing: 'needs_calculation_review',
      },
      {
        id: 'billing_impact',
        label: 'Billing impact reference',
        value: params.billingImpact,
        sourceClass: 'billing_reference',
        enablesDossierAddition: 'add billing impact reference without executing billing',
        statusWhenMissing: 'needs_billing_mapping',
      },
      {
        id: 'eog_impact',
        label: 'EOG/net-fee impact reference',
        value: params.eogImpact,
        sourceClass: 'eog_reference',
        enablesDossierAddition: 'add EOG/net-fee impact reference without recalculation',
        statusWhenMissing: 'needs_eog_mapping',
      },
      {
        id: 'tariff_impact',
        label: 'Tariff impact reference',
        value: params.tariffImpact,
        sourceClass: 'tariff_reference',
        enablesDossierAddition: 'add tariff impact reference without tariff mutation',
        statusWhenMissing: 'needs_tariff_mapping',
      },
      {
        id: 'communication_status',
        label: 'Customer communication readiness',
        value: params.communicationStatus,
        sourceClass: 'communication_reference',
        enablesDossierAddition:
          'add customer communication readiness without sending communication',
        statusWhenMissing: 'needs_communication_status',
      },
      {
        id: 'owner_role',
        label: 'Owner role',
        value: params.ownerRole,
        sourceClass: 'owner_reference',
        enablesDossierAddition: 'add accountable owner role for the next process step',
        statusWhenMissing: 'needs_owner_role',
      },
    ];
    const regulatoryStatus = normalizeStatus(params.regulatoryUncertainty);
    const signals = evidenceSpecs.map((spec) => {
      const status = normalizeStatus(spec.value);
      return {
        id: spec.id,
        label: spec.label,
        status,
        value: spec.value || null,
        sourceClass: spec.sourceClass,
        enablesDossierAddition: spec.enablesDossierAddition,
        statusWhenMissing: spec.statusWhenMissing,
      };
    });
    const evidenceItems = signals
      .filter((signal) => signal.status === 'ready')
      .map((signal) => ({
        id: signal.id,
        label: signal.label,
        value: signal.value || signal.status,
        sourceClass: signal.sourceClass,
        evidenceStatus: 'provided',
      }));
    const missingEvidence = signals
      .filter((signal) => signal.status !== 'ready')
      .map((signal) => ({
        missingDataPoint: signal.id,
        label: signal.label,
        status: signal.status,
        value: signal.value,
        sourceClass: signal.sourceClass,
        enablesDossierAddition: signal.enablesDossierAddition,
        statusWhenMissing: signal.statusWhenMissing,
      }));
    if (regulatoryStatus === 'blocked') {
      missingEvidence.unshift({
        missingDataPoint: 'regulatory_uncertainty',
        label: 'Regulatory/legal uncertainty',
        status: 'blocked',
        value: params.regulatoryUncertainty,
        sourceClass: 'regulatory_review',
        enablesDossierAddition:
          'add clarified regulatory/legal basis before process readiness is claimed',
        statusWhenMissing: 'blocked_by_regulatory_uncertainty',
      });
    }
    const firstGap = missingEvidence[0];
    const status =
      missingEvidence.length === 0
        ? 'ready_for_processing'
        : missingEvidence.some((item) => item.missingDataPoint === 'regulatory_uncertainty')
          ? 'blocked_by_regulatory_uncertainty'
          : missingEvidence.some(
                (item) => item.missingDataPoint === 'deadline_status' && item.status === 'risk'
              )
            ? 'deadline_risk'
            : firstGap?.statusWhenMissing || 'needs_special_grid_usage_evidence';
    const readinessLevel =
      missingEvidence.length === 0
        ? 'ready'
        : status === 'blocked_by_regulatory_uncertainty'
          ? 'blocked'
          : status === 'deadline_risk'
            ? 'risk'
            : evidenceItems.length >= 5
              ? 'partial'
              : 'needs_evidence';
    const readinessScore = Number((evidenceItems.length / evidenceSpecs.length).toFixed(2));
    const positiveFollowUps = missingEvidence.map((item) => ({
      missingDataPoint: item.missingDataPoint,
      status: item.status,
      value: item.value,
      enablesDossierAddition: item.enablesDossierAddition,
      category: 'special_grid_usage_impact_map',
    }));
    const sourceActions = {
      inspected: ['dashboard-api.specialGridUsageImpactMapStatus'],
      referenced: [
        'datapoint.health',
        'datasource-registry.get',
        'eog-calculator.scenario',
        'finance-agent.analyze',
        'settlement.readiness',
        'customer-service.get',
        'vdmi.dossier',
        'interface-placeholder.requestEvidence',
        'presentation.generate',
      ],
      notCalled: [
        'legal.interpret',
        'legal.approve',
        'eog-calculator.recalculate',
        'par19.calculate',
        'billing.release',
        'settlement.prepareBilling',
        'settlement.exportA96',
        'tariff.mutate',
        'customer-service.send',
        'hitl.create',
        'external.connector.call',
        'personal-agent.execute',
      ],
    };
    const caseSummary = {
      caseId,
      caseType,
      customerId: params.customerId || null,
      ownerRole: params.ownerRole || null,
    };
    const impactReferences = {
      calculationLogicRef: params.calculationLogicRef || null,
      billingImpact: params.billingImpact || null,
      eogImpact: params.eogImpact || null,
      tariffImpact: params.tariffImpact || null,
    };
    const dossierFacts = [
      `Status: ${status}`,
      `Readiness Level: ${readinessLevel}`,
      `Provided impact-map evidence: ${evidenceItems.length}/${evidenceSpecs.length}`,
      `Open gaps: ${missingEvidence.length}`,
      `Case Type: ${caseType}`,
    ];
    if (params.deadlineStatus) dossierFacts.push(`Deadline: ${params.deadlineStatus}`);
    if (params.ownerRole) dossierFacts.push(`Owner: ${params.ownerRole}`);

    return {
      specialGridUsageImpactMapId: caseId,
      capabilityKey: 'special_grid_usage_impact_map',
      safety: 'read_only',
      status,
      readinessLevel,
      readinessScore,
      caseSummary,
      deadlineRisk: normalizeStatus(params.deadlineStatus) === 'risk',
      quantityEvidenceStatus: normalizeStatus(params.quantityBasis),
      calculationStatus: normalizeStatus(params.calculationLogicRef),
      billingImpact: params.billingImpact || null,
      eogImpact: params.eogImpact || null,
      tariffImpact: params.tariffImpact || null,
      communicationStatus: params.communicationStatus || null,
      ownerRole: params.ownerRole || null,
      sourceDatapoints,
      impactReferences,
      evidenceItems,
      missingEvidence,
      positiveFollowUps,
      sourceActions,
      validationFindings: missingEvidence.map((item) => ({
        code: `SPECIAL_GRID_USAGE_${String(item.missingDataPoint).toUpperCase()}`,
        severity: item.status === 'blocked' ? 'high' : item.status === 'risk' ? 'medium' : 'info',
        message: item.enablesDossierAddition,
      })),
      dossierEvidence: {
        status,
        readinessLevel,
        readinessScore,
        caseSummary,
        deadlineRisk: normalizeStatus(params.deadlineStatus) === 'risk',
        quantityEvidenceStatus: normalizeStatus(params.quantityBasis),
        calculationStatus: normalizeStatus(params.calculationLogicRef),
        impactReferences,
        missingEvidence,
        positiveFollowUps,
        sourceActions: {
          notCalled: sourceActions.notCalled,
        },
        dossierFacts,
      },
    };
  },

  buildLiquidityPlanningGovernanceStatus(params = {}) {
    const toList = (value) =>
      Array.isArray(value)
        ? value.filter(Boolean)
        : value
          ? String(value)
              .split(',')
              .map((item) => item.trim())
              .filter(Boolean)
          : [];
    const normalizeStatus = (value) => {
      if (value === true) return 'ready';
      if (value === false || value == null || value === '') return 'missing';
      const normalized = String(value).trim().toLowerCase();
      if (
        [
          'ready',
          'complete',
          'completed',
          'available',
          'provided',
          'confirmed',
          'ok',
          'valid',
          'mapped',
          'reviewed',
          'approved',
        ].includes(normalized)
      )
        return 'ready';
      if (['risk', 'risky', 'stale', 'outdated', 'late', 'overdue'].includes(normalized))
        return 'risk';
      if (
        ['blocked', 'unclear', 'unvalidated', 'invalid', 'pending', 'rejected'].includes(normalized)
      )
        return 'blocked';
      if (['missing', 'open', 'needed', 'required', 'unknown', 'none', 'no'].includes(normalized))
        return 'missing';
      return 'ready';
    };
    const sapAccountSources = toList(params.sapAccountSources);
    const controllingSourceIds = toList(params.controllingSourceIds);
    const loanTmsSourceIds = toList(params.loanTmsSourceIds);
    const scenarioAssumptions = toList(params.scenarioAssumptions);
    const validationRules = toList(params.validationRules);
    const plausibilityChecks = toList(params.plausibilityChecks);
    const sourceDatapoints = toList(params.sourceDatapoints);
    const liquidityRiskFlags = toList(params.liquidityRiskFlags);
    const interestRiskFlags = toList(params.interestRiskFlags);
    const investmentLinkRefs = toList(params.investmentLinkRefs);
    const planningRunId =
      params.planningRunId ||
      `liquidity-governance:${Buffer.from(
        `${params.planningHorizon || ''}:${params.ownerRaci || ''}:${params.sourceRegister || ''}`
      )
        .toString('base64url')
        .slice(0, 24)}`;
    const evidenceSpecs = [
      {
        id: 'source_register',
        label: 'Source register',
        value: params.sourceRegister,
        sourceClass: 'finance_source_register',
        enablesDossierAddition: 'add source coverage and owner accountability',
        statusWhenMissing: 'needs_source_register',
      },
      {
        id: 'dictionary_version',
        label: 'Dictionary/version evidence',
        value: params.dictionaryVersion,
        sourceClass: 'data_dictionary',
        enablesDossierAddition: 'add traceable SAP/controlling/TMS source interpretation',
        statusWhenMissing: 'needs_dictionary_version',
      },
      {
        id: 'sap_account_sources',
        label: 'SAP account sources',
        value: sapAccountSources.length > 0,
        displayValue: sapAccountSources.join(', '),
        sourceClass: 'sap_account_mapping',
        enablesDossierAddition: 'add SAP account source mapping evidence',
        statusWhenMissing: 'needs_sap_account_sources',
      },
      {
        id: 'controlling_sources',
        label: 'Controlling sources',
        value: controllingSourceIds.length > 0,
        displayValue: controllingSourceIds.join(', '),
        sourceClass: 'controlling_source',
        enablesDossierAddition: 'add controlling source snapshot evidence',
        statusWhenMissing: 'needs_controlling_sources',
      },
      {
        id: 'loan_tms_sources',
        label: 'Loan/TMS sources',
        value: loanTmsSourceIds.length > 0,
        displayValue: loanTmsSourceIds.join(', '),
        sourceClass: 'loan_tms_source',
        enablesDossierAddition: 'add loan/TMS source evidence',
        statusWhenMissing: 'needs_loan_tms_sources',
      },
      {
        id: 'vat_logic_reference',
        label: 'VAT logic reference',
        value: params.vatLogicRef,
        sourceClass: 'vat_logic_reference',
        enablesDossierAddition: 'add evidence boundary for Umsatzsteuer assumptions',
        statusWhenMissing: 'needs_vat_logic_reference',
      },
      {
        id: 'cash_pool_settlement_reference',
        label: 'Cash-pool settlement reference',
        value: params.cashPoolSettlementRef,
        sourceClass: 'cash_pool_logic',
        enablesDossierAddition: 'add cash-pool evidence boundary',
        statusWhenMissing: 'blocked_by_unvalidated_cash_pool_logic',
      },
      {
        id: 'validation_rules',
        label: 'Validation rules',
        value: validationRules.length > 0,
        displayValue: validationRules.join(', '),
        sourceClass: 'validation_rule',
        enablesDossierAddition: 'add deterministic plausibility review basis',
        statusWhenMissing: 'needs_validation_rules',
      },
      {
        id: 'scenario_assumptions',
        label: 'Scenario assumptions',
        value: scenarioAssumptions.length > 0,
        displayValue: scenarioAssumptions.join(', '),
        sourceClass: 'scenario_assumption',
        enablesDossierAddition: 'add scenario comparison basis',
        statusWhenMissing: 'needs_scenario_assumption_review',
      },
      {
        id: 'correction_owner',
        label: 'Correction owner/workflow',
        value: params.correctionWorkflow || params.ownerRaci,
        sourceClass: 'correction_workflow',
        enablesDossierAddition: 'add accountable correction workflow',
        statusWhenMissing: 'needs_correction_owner',
      },
      {
        id: 'approval_evidence',
        label: 'Approval/review evidence',
        value: params.approvalStatus,
        sourceClass: 'approval_status',
        enablesDossierAddition: 'add review-state evidence, not automatic approval',
        statusWhenMissing: 'needs_approval_evidence',
      },
    ];
    const signals = evidenceSpecs.map((spec) => {
      const status = normalizeStatus(spec.value);
      return {
        id: spec.id,
        label: spec.label,
        status,
        value: spec.displayValue || spec.value || null,
        sourceClass: spec.sourceClass,
        enablesDossierAddition: spec.enablesDossierAddition,
        statusWhenMissing: spec.statusWhenMissing,
      };
    });
    const evidenceItems = signals
      .filter((signal) => signal.status === 'ready')
      .map((signal) => ({
        id: signal.id,
        label: signal.label,
        value: signal.value || signal.status,
        sourceClass: signal.sourceClass,
        evidenceStatus: 'provided',
      }));
    const missingEvidence = signals
      .filter((signal) => signal.status !== 'ready')
      .map((signal) => ({
        missingDataPoint: signal.id,
        label: signal.label,
        status: signal.status,
        value: signal.value,
        sourceClass: signal.sourceClass,
        enablesDossierAddition: signal.enablesDossierAddition,
        statusWhenMissing: signal.statusWhenMissing,
      }));
    const firstGap = missingEvidence[0];
    const status =
      missingEvidence.length === 0
        ? 'ready_for_treasury_review'
        : missingEvidence.some((item) => item.missingDataPoint === 'cash_pool_settlement_reference')
          ? 'blocked_by_unvalidated_cash_pool_logic'
          : firstGap?.statusWhenMissing || 'needs_liquidity_governance_evidence';
    const readinessLevel =
      missingEvidence.length === 0
        ? 'ready'
        : status === 'blocked_by_unvalidated_cash_pool_logic'
          ? 'blocked'
          : evidenceItems.length >= 6
            ? 'partial'
            : 'needs_evidence';
    const readinessScore = Number((evidenceItems.length / evidenceSpecs.length).toFixed(2));
    const riskFlags = [
      ...liquidityRiskFlags.map((flag) => ({
        type: 'liquidity',
        severity: 'medium',
        message: flag,
      })),
      ...interestRiskFlags.map((flag) => ({
        type: 'interest',
        severity: 'medium',
        message: flag,
      })),
      ...missingEvidence
        .filter(
          (item) =>
            item.status === 'blocked' || item.missingDataPoint === 'cash_pool_settlement_reference'
        )
        .map((item) => ({
          type: item.missingDataPoint,
          severity: item.status === 'blocked' ? 'high' : 'medium',
          message: item.enablesDossierAddition,
        })),
    ];
    const positiveFollowUps = missingEvidence.map((item) => ({
      missingDataPoint: item.missingDataPoint,
      status: item.status,
      value: item.value,
      enablesDossierAddition: item.enablesDossierAddition,
      category: 'liquidity_planning_governance_module',
    }));
    const sourceCoverage = {
      sourceRegister: params.sourceRegister || null,
      sapAccountSources,
      controllingSourceIds,
      loanTmsSourceIds,
      sourceDatapoints,
      sourceHealth: params.sourceHealth || null,
      plausibilityChecks,
    };
    const governanceState = {
      ownerRaci: params.ownerRaci || null,
      correctionWorkflow: params.correctionWorkflow || null,
      approvalStatus: params.approvalStatus || null,
      scenarioAssumptions,
      validationRules,
      investmentLinkRefs,
    };
    const sourceActions = {
      inspected: ['dashboard-api.liquidityPlanningGovernanceStatus'],
      referenced: [
        'datasource-registry.get',
        'datasource-registry.check',
        'datapoint.health',
        'finance-agent.analyze',
        'investment-planning.createPlan',
        'vdmi.dossier',
        'interface-placeholder.requestEvidence',
        'presentation.generate',
      ],
      notCalled: [
        'treasury.calculate',
        'cashflow.calculate',
        'interest.calculate',
        'vat.calculate',
        'sap.connector.call',
        'tms.connector.call',
        'cash-pool.connector.call',
        'payment.execute',
        'approval.release',
        'billing.release',
        'settlement.prepareBilling',
        'tariff.mutate',
        'contract.mutate',
        'eog-calculator.recalculate',
        'hitl.create',
        'external.connector.call',
        'personal-agent.execute',
      ],
    };
    const dossierFacts = [
      `Status: ${status}`,
      `Readiness Level: ${readinessLevel}`,
      `Provided liquidity governance evidence: ${evidenceItems.length}/${evidenceSpecs.length}`,
      `Open gaps: ${missingEvidence.length}`,
    ];
    if (params.planningHorizon) dossierFacts.push(`Planning Horizon: ${params.planningHorizon}`);
    if (params.ownerRaci) dossierFacts.push(`Owner/RACI: ${params.ownerRaci}`);

    return {
      liquidityPlanningGovernanceId: planningRunId,
      capabilityKey: 'liquidity_planning_governance_module',
      safety: 'read_only',
      status,
      readinessLevel,
      readinessScore,
      planningRunId,
      planningHorizon: params.planningHorizon || null,
      sourceCoverage,
      governanceState,
      evidenceItems,
      missingEvidence,
      riskFlags,
      positiveFollowUps,
      sourceActions,
      validationFindings: riskFlags,
      dossierEvidence: {
        status,
        readinessLevel,
        readinessScore,
        planningRunId,
        planningHorizon: params.planningHorizon || null,
        sourceCoverage,
        governanceState,
        evidenceItems,
        missingEvidence,
        riskFlags,
        positiveFollowUps,
        sourceActions: {
          notCalled: sourceActions.notCalled,
        },
        dossierFacts,
      },
    };
  },

  buildEnergySharingSimulationGateStatus(params = {}) {
    const toList = (value) =>
      Array.isArray(value)
        ? value.filter(Boolean)
        : value
          ? String(value)
              .split(',')
              .map((item) => item.trim())
              .filter(Boolean)
          : [];
    const normalizeStatus = (value) => {
      if (value === true) return 'ready';
      if (value === false || value == null || value === '') return 'missing';
      const text = String(value).trim().toLowerCase();
      if (
        [
          'ready',
          'ok',
          'complete',
          'completed',
          'provided',
          'valid',
          'validated',
          'available',
          'confirmed',
          'approved',
        ].includes(text)
      )
        return 'ready';
      if (['blocked', 'invalid', 'failed', 'rejected'].includes(text)) return 'blocked';
      if (['partial', 'in_progress', 'draft', 'pending'].includes(text)) return 'partial';
      return 'ready';
    };
    const isReady = (value) => normalizeStatus(value) === 'ready';
    const participantCount = Number(params.participantCount || 0);
    const generationMaloCount = Number(params.generationMaloCount || 0);
    const consumptionMaloCount = Number(params.consumptionMaloCount || 0);
    const sourceArtifacts = toList(params.sourceArtifacts);
    const dataBasis = String(params.dataBasis || '').toLowerCase();
    const isBillingDataBasis = /inhouse|imsys|mscons|billing|abrechnung/.test(dataBasis);
    const isForecastBasis =
      /forecast|synthetic|synthetisch|learning|lernpilot/.test(dataBasis) || !dataBasis;
    const communityId = params.communityId || 'energy-sharing-candidate';

    const evidenceSpecs = [
      {
        id: 'project_identity',
        label: 'Energy-Sharing community and grid operator',
        value: params.communityId && params.gridOperatorId,
        displayValue: [params.communityId, params.gridOperatorId].filter(Boolean).join(' / '),
        readinessBlock: 'project',
        sourceClass: 'identity',
        enablesDossierAddition:
          'add community id and grid operator id to identify the simulation scope',
        statusWhenMissing: 'blocked_by_evidence',
      },
      {
        id: 'participant_dataset',
        label: 'Participant list and participant evidence',
        value: participantCount > 0 && params.participantEvidenceRef,
        displayValue:
          participantCount > 0
            ? `${participantCount} participants / ${params.participantEvidenceRef || 'no evidence ref'}`
            : null,
        readinessBlock: 'participants',
        sourceClass: 'participant_evidence',
        enablesDossierAddition:
          'add participant list and consent/evidence reference to assess participant readiness',
        statusWhenMissing: 'blocked_by_evidence',
      },
      {
        id: 'malo_metering_readiness',
        label: 'MaLo and metering/iMSys readiness',
        value: isReady(params.maloStatus) && isReady(params.meteringReadiness),
        displayValue: [params.maloStatus, params.meteringReadiness].filter(Boolean).join(' / '),
        readinessBlock: 'metering',
        sourceClass: 'metering_evidence',
        enablesDossierAddition:
          'add MaLo status and iMSys/MSCONS metering evidence to lift the gate beyond learning-pilot readiness',
        statusWhenMissing: 'blocked_by_metering',
      },
      {
        id: 'market_role_readiness',
        label: 'Market role / Bilanzkreis readiness',
        value: isReady(params.marketRoleReadiness),
        displayValue: params.marketRoleReadiness,
        readinessBlock: 'marketRole',
        sourceClass: 'market_role_evidence',
        enablesDossierAddition:
          'add market-role and balancing-group readiness evidence to avoid false operational approval',
        statusWhenMissing: 'blocked_by_market_role',
      },
      {
        id: 'data_basis',
        label: 'Forecast or inhouse data basis',
        value: params.dataBasis,
        displayValue: params.dataBasis,
        readinessBlock: 'metering',
        sourceClass: 'data_basis',
        enablesDossierAddition:
          'add the simulation data basis; forecast enables learning-pilot assessment, inhouse/iMSys evidence enables billing-near assessment',
        statusWhenMissing: 'learning_pilot',
      },
      {
        id: 'settlement_a96_evidence',
        label: 'Settlement and A96 evidence',
        value: params.a96EvidenceRef && params.settlementEvidenceRef && isBillingDataBasis,
        displayValue: [params.a96EvidenceRef, params.settlementEvidenceRef]
          .filter(Boolean)
          .join(' / '),
        readinessBlock: 'settlement',
        sourceClass: 'settlement_evidence',
        enablesDossierAddition:
          'add A96 and settlement evidence before classifying the candidate as billing-near-ready',
        statusWhenMissing: isBillingDataBasis ? 'blocked_by_settlement' : 'simulation_ready',
      },
      {
        id: 'contract_evidence',
        label: 'Contract readiness evidence',
        value: params.contractEvidenceRef,
        displayValue: params.contractEvidenceRef,
        readinessBlock: 'contract',
        sourceClass: 'contract_evidence',
        enablesDossierAddition:
          'add contract readiness evidence to separate pilot learning from operational rollout',
        statusWhenMissing: 'blocked_by_evidence',
      },
      {
        id: 'economics_assumption',
        label: 'Economics assumptions',
        value: params.economicsAssumptionRef,
        displayValue: params.economicsAssumptionRef,
        readinessBlock: 'economics',
        sourceClass: 'commercial_evidence',
        enablesDossierAddition:
          'add economics assumptions for commercial readiness without triggering billing or tariff mutation',
        statusWhenMissing: 'blocked_by_evidence',
      },
      {
        id: 'malo_inventory_evidence',
        label: 'Generation and consumption MaLo evidence summary',
        value:
          generationMaloCount > 0 && consumptionMaloCount > 0 && params.maloInventoryEvidenceRef,
        displayValue:
          generationMaloCount > 0 || consumptionMaloCount > 0
            ? `${generationMaloCount} generation / ${consumptionMaloCount} consumption / ${params.maloInventoryEvidenceRef || 'no evidence ref'}`
            : null,
        readinessBlock: 'maloInventory',
        sourceClass: 'malo_evidence',
        enablesDossierAddition:
          'add generation/consumption MaLo counts and an evidence reference (never raw MaLo identifiers) to confirm portfolio metering-point scope',
        statusWhenMissing: 'blocked_by_evidence',
      },
      {
        id: 'supplier_direct_marketer_evidence',
        label: 'Supplier / direct-marketer evidence',
        value: params.supplierOrDirectMarketerEvidenceRef,
        displayValue: params.supplierOrDirectMarketerEvidenceRef,
        readinessBlock: 'supplierDirectMarketer',
        sourceClass: 'supplier_evidence',
        enablesDossierAddition:
          'add supplier or direct-marketer evidence reference to confirm the commercial counterpart for the candidate',
        statusWhenMissing: 'blocked_by_evidence',
      },
      {
        id: 'metering_concept_data_quality_evidence',
        label: 'Metering concept, iMSys status, 15-minute-value readiness and data-basis freshness',
        value:
          params.meteringConceptEvidenceRef &&
          isReady(params.imsysStatus) &&
          isReady(params.fifteenMinuteValuesReadiness) &&
          params.dataBasisFreshnessRef,
        displayValue: [
          params.meteringConceptEvidenceRef,
          params.imsysStatus,
          params.fifteenMinuteValuesReadiness,
          params.dataBasisFreshnessRef,
        ]
          .filter(Boolean)
          .join(' / '),
        readinessBlock: 'meteringConceptDataQuality',
        sourceClass: 'metering_concept_evidence',
        enablesDossierAddition:
          'add metering-concept evidence, iMSys status, 15-minute-value readiness and a data-basis freshness reference to confirm measurement data quality',
        statusWhenMissing: 'blocked_by_metering',
      },
      {
        id: 'residual_supply_contract_evidence',
        label: 'Residual-supply contract evidence (Reststromvertrag)',
        value: params.residualSupplyContractEvidenceRef,
        displayValue: params.residualSupplyContractEvidenceRef,
        readinessBlock: 'residualSupply',
        sourceClass: 'residual_supply_evidence',
        enablesDossierAddition:
          'add residual-supply contract evidence to confirm coverage for non-shared consumption',
        statusWhenMissing: 'blocked_by_evidence',
      },
      {
        id: 'participation_eligibility_evidence',
        label: 'Participation start/end and eligibility evidence',
        value: params.participationStartDate && params.eligibilityEvidenceRef,
        displayValue: [
          params.participationStartDate,
          params.participationEndDate,
          params.eligibilityEvidenceRef,
        ]
          .filter(Boolean)
          .join(' / '),
        readinessBlock: 'participationEligibility',
        sourceClass: 'participation_evidence',
        enablesDossierAddition:
          'add participation start date and eligibility/authorization evidence (end date optional for ongoing participation) to confirm participation scope',
        statusWhenMissing: 'blocked_by_evidence',
      },
      {
        id: 'exception_rate_economics_threshold_evidence',
        label: 'Exception-rate evidence and economics-threshold reference',
        value: params.exceptionRateEvidenceRef && params.economicsThresholdRef,
        displayValue: [params.exceptionRateEvidenceRef, params.economicsThresholdRef]
          .filter(Boolean)
          .join(' / '),
        readinessBlock: 'exceptionRateEconomicsThreshold',
        sourceClass: 'exception_rate_evidence',
        enablesDossierAddition:
          'add exception/clarification-case rate evidence and an explicit economics-threshold reference for commercial viability review',
        statusWhenMissing: 'blocked_by_evidence',
      },
      {
        id: 'owner_escalation',
        label: 'Owner and escalation contact',
        value: params.owner && params.escalationContact,
        displayValue: [params.owner, params.escalationContact].filter(Boolean).join(' / '),
        readinessBlock: 'governance',
        sourceClass: 'owner_evidence',
        enablesDossierAddition:
          'add owner and escalation contact so open evidence can be routed as follow-up',
        statusWhenMissing: 'blocked_by_evidence',
      },
    ];

    const readinessBlocks = {
      participantReadiness: {
        participantCount,
        participantEvidenceRef: params.participantEvidenceRef || null,
        status:
          participantCount > 0 && params.participantEvidenceRef ? 'ready' : 'missing_evidence',
      },
      meteringReadiness: {
        maloStatus: params.maloStatus || null,
        meteringReadiness: params.meteringReadiness || null,
        dataBasis: params.dataBasis || null,
        status:
          isReady(params.maloStatus) && isReady(params.meteringReadiness)
            ? 'ready'
            : 'missing_evidence',
      },
      marketRoleReadiness: {
        marketRoleReadiness: params.marketRoleReadiness || null,
        status: isReady(params.marketRoleReadiness) ? 'ready' : 'missing_evidence',
      },
      settlementReadiness: {
        a96EvidenceRef: params.a96EvidenceRef || null,
        settlementEvidenceRef: params.settlementEvidenceRef || null,
        status:
          params.a96EvidenceRef && params.settlementEvidenceRef && isBillingDataBasis
            ? 'ready'
            : 'missing_or_not_billing_basis',
      },
      economicsReadiness: {
        contractEvidenceRef: params.contractEvidenceRef || null,
        economicsAssumptionRef: params.economicsAssumptionRef || null,
        status:
          params.contractEvidenceRef && params.economicsAssumptionRef
            ? 'ready'
            : 'missing_evidence',
      },
      maloInventoryReadiness: {
        generationMaloCount,
        consumptionMaloCount,
        maloInventoryEvidenceRef: params.maloInventoryEvidenceRef || null,
        status:
          generationMaloCount > 0 && consumptionMaloCount > 0 && params.maloInventoryEvidenceRef
            ? 'ready'
            : 'missing_evidence',
      },
      supplierDirectMarketerReadiness: {
        supplierOrDirectMarketerEvidenceRef: params.supplierOrDirectMarketerEvidenceRef || null,
        status: params.supplierOrDirectMarketerEvidenceRef ? 'ready' : 'missing_evidence',
      },
      meteringConceptDataQualityReadiness: {
        meteringConceptEvidenceRef: params.meteringConceptEvidenceRef || null,
        imsysStatus: params.imsysStatus || null,
        fifteenMinuteValuesReadiness: params.fifteenMinuteValuesReadiness || null,
        dataBasisFreshnessRef: params.dataBasisFreshnessRef || null,
        status:
          params.meteringConceptEvidenceRef &&
          isReady(params.imsysStatus) &&
          isReady(params.fifteenMinuteValuesReadiness) &&
          params.dataBasisFreshnessRef
            ? 'ready'
            : 'missing_evidence',
      },
      residualSupplyReadiness: {
        residualSupplyContractEvidenceRef: params.residualSupplyContractEvidenceRef || null,
        status: params.residualSupplyContractEvidenceRef ? 'ready' : 'missing_evidence',
      },
      participationEligibilityReadiness: {
        participationStartDate: params.participationStartDate || null,
        participationEndDate: params.participationEndDate || null,
        eligibilityEvidenceRef: params.eligibilityEvidenceRef || null,
        status:
          params.participationStartDate && params.eligibilityEvidenceRef
            ? 'ready'
            : 'missing_evidence',
      },
      exceptionRateEconomicsThresholdReadiness: {
        exceptionRateEvidenceRef: params.exceptionRateEvidenceRef || null,
        economicsThresholdRef: params.economicsThresholdRef || null,
        status:
          params.exceptionRateEvidenceRef && params.economicsThresholdRef
            ? 'ready'
            : 'missing_evidence',
      },
    };

    const evidenceItems = evidenceSpecs
      .filter((spec) => normalizeStatus(spec.value) === 'ready')
      .map((spec) => ({
        id: spec.id,
        label: spec.label,
        value: spec.displayValue || spec.value,
        readinessBlock: spec.readinessBlock,
        sourceClass: spec.sourceClass,
        evidenceStatus: 'provided',
      }));
    const missingEvidence = evidenceSpecs
      .filter((spec) => normalizeStatus(spec.value) !== 'ready')
      .map((spec) => ({
        missingDataPoint: spec.id,
        label: spec.label,
        status: normalizeStatus(spec.value),
        value: spec.displayValue || spec.value || null,
        readinessBlock: spec.readinessBlock,
        sourceClass: spec.sourceClass,
        enablesDossierAddition: spec.enablesDossierAddition,
        statusWhenMissing: spec.statusWhenMissing,
      }));
    const missingIds = new Set(missingEvidence.map((item) => item.missingDataPoint));
    const gateStatus =
      missingIds.size === 0
        ? 'billing_near_ready'
        : isForecastBasis
          ? 'learning_pilot'
          : missingIds.has('market_role_readiness')
            ? 'blocked_by_market_role'
            : missingIds.has('malo_metering_readiness')
              ? 'blocked_by_metering'
              : missingIds.has('settlement_a96_evidence') && isBillingDataBasis
                ? 'blocked_by_settlement'
                : missingIds.has('settlement_a96_evidence')
                  ? 'simulation_ready'
                  : 'blocked_by_evidence';
    const simulationStage =
      gateStatus === 'billing_near_ready'
        ? 'billing_near_ready'
        : gateStatus === 'simulation_ready'
          ? 'simulation_ready'
          : gateStatus === 'learning_pilot'
            ? 'learning_pilot'
            : 'blocked_before_operational_rollout';
    const readinessScore = Number((evidenceItems.length / evidenceSpecs.length).toFixed(2));
    const classificationRationale = [
      gateStatus === 'billing_near_ready'
        ? 'All supplied readiness evidence supports a billing-near assessment.'
        : gateStatus === 'learning_pilot'
          ? 'Forecast or synthetic evidence can support a learning pilot, but it is not billing-ready.'
          : gateStatus === 'simulation_ready'
            ? 'Core project, participant, metering and market-role evidence can support simulation, while settlement/A96 evidence remains open.'
            : `Open ${missingEvidence[0]?.label || 'evidence'} prevents operational rollout.`,
      'No allocation, A96 export, settlement, MaKo, billing, tariff, HITL, customer communication or external connector action was called.',
    ];
    const positiveFollowUps = missingEvidence.map((item) => ({
      missingDataPoint: item.missingDataPoint,
      status: item.status,
      value: item.value,
      enablesDossierAddition: item.enablesDossierAddition,
      category: 'energy_sharing_simulation_gate',
    }));
    const sourceActions = {
      inspected: ['dashboard-api.energySharingSimulationGateStatus'],
      referenced: [
        'energy-sharing.validate',
        'energy-sharing-allocation.allocate',
        'datapoint.health',
        'edm-validation.validate',
        'settlement.prepareA96',
        'settlement.reconcileA96',
        'grid-connection.validate',
        'vdmi.dossier',
        'interface-placeholder.requestEvidence',
      ],
      notCalled: [
        'energy-sharing.createProject',
        'energy-sharing-allocation.allocate',
        'settlement.prepareA96',
        'settlement.reconcileA96',
        'settlement.exportA96',
        'mako.dispatch',
        'billing.release',
        'tariff.mutate',
        'customer-service.send',
        'hitl.create',
        'external.connector.call',
        'personal-agent.execute',
        'energy-sharing.contract.sign',
        'energy-sharing.onboarding.start',
        'workflow.execute',
      ],
    };
    const dossierFacts = [
      `Status: ${gateStatus}`,
      `Simulation Stage: ${simulationStage}`,
      `Provided Energy-Sharing gate evidence: ${evidenceItems.length}/${evidenceSpecs.length}`,
      `Open gaps: ${missingEvidence.length}`,
    ];
    if (params.communityId) dossierFacts.push(`Community: ${params.communityId}`);
    if (params.gridOperatorId) dossierFacts.push(`Grid Operator: ${params.gridOperatorId}`);

    return {
      energySharingSimulationGateId: `esgate:${Buffer.from(
        `${communityId}:${params.gridOperatorId || ''}:${params.dataBasis || ''}:${params.owner || ''}`
      )
        .toString('base64url')
        .slice(0, 28)}`,
      capabilityKey: 'energy_sharing_simulation_gate',
      safety: 'read_only',
      gateStatus,
      simulationStage,
      readinessScore,
      communityId: params.communityId || null,
      gridOperatorId: params.gridOperatorId || null,
      readinessBlocks,
      classificationRationale,
      evidenceItems,
      missingEvidence,
      positiveFollowUps,
      sourceArtifacts,
      sourceActions,
      validationFindings: missingEvidence,
      dossierEvidence: {
        status: gateStatus,
        gateStatus,
        simulationStage,
        readinessScore,
        communityId: params.communityId || null,
        gridOperatorId: params.gridOperatorId || null,
        readinessBlocks,
        classificationRationale,
        evidenceItems,
        missingEvidence,
        positiveFollowUps,
        sourceArtifacts,
        sourceActions: {
          notCalled: sourceActions.notCalled,
        },
        dossierFacts,
      },
    };
  },

  buildEnergySharing42cCutoverReadinessStatus(params = {}) {
    const toList = (value) =>
      Array.isArray(value)
        ? value.filter(Boolean)
        : value
          ? String(value)
              .split(',')
              .map((item) => item.trim())
              .filter(Boolean)
          : [];
    const normalizeStatus = (value) => {
      if (value === true) return 'ready';
      if (value === false || value == null || value === '') return 'missing';
      const text = String(value).trim().toLowerCase();
      if (
        [
          'ready',
          'ok',
          'complete',
          'completed',
          'provided',
          'valid',
          'validated',
          'available',
          'confirmed',
          'approved',
          'done',
          'passed',
        ].includes(text)
      )
        return 'ready';
      if (['blocked', 'invalid', 'failed', 'rejected', 'red', 'critical'].includes(text))
        return 'blocked';
      if (
        [
          'risk',
          'risky',
          'warning',
          'late',
          'overdue',
          'pending_legal',
          'pending-regulatory',
        ].includes(text)
      )
        return 'risk';
      if (['partial', 'in_progress', 'in-progress', 'draft', 'pending', 'review'].includes(text))
        return 'partial';
      return 'ready';
    };
    const evidenceRefs = toList(params.evidenceRefs);
    const cutoverId = params.cutoverId || 'energy-sharing-42c-cutover';
    const subTrackSpecs = [
      {
        id: 'a96_defaults_spec_freeze',
        subTrack: 'A',
        label: 'A96 defaults and spec-freeze evidence',
        value: params.a96DefaultsStatus && params.specFreezeStatus,
        displayValue: [params.a96DefaultsStatus, params.specFreezeStatus]
          .filter(Boolean)
          .join(' / '),
        riskWhenMissing: 'high',
        enablesDossierAddition:
          'add A96 defaults and spec-freeze evidence before any export release is considered',
      },
      {
        id: 'pilot_tenant_balance_group',
        subTrack: 'B',
        label: 'Pilot tenant and balance-group readiness',
        value: params.pilotTenantStatus && params.pilotTenantId && params.balanceGroupId,
        displayValue: [params.pilotTenantId, params.balanceGroupId, params.pilotTenantStatus]
          .filter(Boolean)
          .join(' / '),
        riskWhenMissing: 'high',
        enablesDossierAddition:
          'add pilot-tenant and virtual balance-group readiness evidence without provisioning production tenants',
      },
      {
        id: 'settlement_readiness_hardening',
        subTrack: 'C',
        label: 'Settlement-readiness hardening evidence',
        value: params.settlementHardeningStatus,
        displayValue: params.settlementHardeningStatus,
        riskWhenMissing: 'high',
        enablesDossierAddition:
          'add settlement-readiness hardening and data-quality evidence before billing-adjacent decisions',
      },
      {
        id: 'allocation_load_test',
        subTrack: 'D',
        label: 'Allocation/load-test evidence',
        value: params.allocationLoadTestStatus,
        displayValue: params.allocationLoadTestStatus,
        riskWhenMissing: 'medium',
        enablesDossierAddition:
          'add allocation load-test and deterministic export evidence without executing allocation',
      },
      {
        id: 'incident_runbook',
        subTrack: 'E',
        label: 'Incident/runbook readiness',
        value: params.runbookStatus,
        displayValue: params.runbookStatus,
        riskWhenMissing: 'medium',
        enablesDossierAddition:
          'add incident runbook and escalation evidence without creating HITL or pager tasks',
      },
      {
        id: 'compliance_signoff_evidence',
        subTrack: 'F',
        label: 'Compliance/sign-off evidence',
        value: params.complianceSignoffStatus,
        displayValue: params.complianceSignoffStatus,
        riskWhenMissing: 'high',
        enablesDossierAddition:
          'add compliance and sign-off evidence without automating legal/regulatory interpretation',
      },
      {
        id: 'rollback_dr_readiness',
        subTrack: 'G',
        label: 'Rollback/DR readiness evidence',
        value: params.rollbackPlanStatus,
        displayValue: params.rollbackPlanStatus,
        riskWhenMissing: 'medium',
        enablesDossierAddition:
          'add rollback and DR readiness evidence without running restore or rollback actions',
      },
    ];

    const subTracks = subTrackSpecs.map((spec) => {
      const status = normalizeStatus(spec.value);
      return {
        id: spec.id,
        subTrack: spec.subTrack,
        label: spec.label,
        status,
        value: spec.displayValue || spec.value || null,
        risk: status === 'ready' ? 'low' : spec.riskWhenMissing,
        enablesDossierAddition: spec.enablesDossierAddition,
      };
    });
    const evidenceItems = subTracks.filter((item) => item.status === 'ready');
    const missingEvidence = subTracks
      .filter((item) => item.status !== 'ready')
      .map((item) => ({
        missingDataPoint: item.id,
        subTrack: item.subTrack,
        label: item.label,
        status: item.status,
        value: item.value,
        risk: item.risk,
        enablesDossierAddition: item.enablesDossierAddition,
        category: 'energy_sharing_42c_cutover_readiness',
      }));
    const hasHighRiskGap = missingEvidence.some((item) => item.risk === 'high');
    const hasMediumRiskGap = missingEvidence.some((item) => item.risk === 'medium');
    const status = missingEvidence.length === 0 ? 'ready' : hasHighRiskGap ? 'blocked' : 'partial';
    const riskLevel =
      status === 'ready' ? 'low' : hasHighRiskGap ? 'high' : hasMediumRiskGap ? 'medium' : 'low';
    const readinessScore = Number((evidenceItems.length / subTrackSpecs.length).toFixed(2));
    const positiveFollowUps = missingEvidence.map((item) => ({
      missingDataPoint: item.missingDataPoint,
      subTrack: item.subTrack,
      status: item.status,
      risk: item.risk,
      enablesDossierAddition: item.enablesDossierAddition,
      category: 'energy_sharing_42c_cutover_readiness',
    }));
    const sourceActions = {
      inspected: ['dashboard-api.energySharing42cCutoverReadinessStatus'],
      referenced: [
        'docs/roadmap/issues/10-energy-sharing-42c-cutover.md',
        'docs/ENERGY_SHARING_ABNAHME.md',
        'docs/ENERGY_SHARING_A96_DEFAULTS.md',
        'vdmi.dossier',
        'interface-placeholder.requestEvidence',
      ],
      notCalled: [
        'tenant.provision',
        'tenant.migrate',
        'energy-sharing.createProject',
        'energy-sharing-allocation.allocate',
        'settlement.prepareA96',
        'settlement.reconcileA96',
        'settlement.exportA96',
        'allocation.execute',
        'billing.release',
        'mako.dispatch',
        'hitl.create',
        'pager.escalate',
        'rollback.execute',
        'backup.restore',
        'external.connector.call',
        'secret.read',
        'personal-agent.execute',
      ],
    };
    const dossierFacts = [
      `Status: ${status}`,
      `Risk Level: ${riskLevel}`,
      `Provided §42c sub-track evidence: ${evidenceItems.length}/${subTrackSpecs.length}`,
      `Open gaps: ${missingEvidence.length}`,
    ];
    if (params.pilotTenantId) dossierFacts.push(`Pilot Tenant: ${params.pilotTenantId}`);
    if (params.balanceGroupId) dossierFacts.push(`Balance Group: ${params.balanceGroupId}`);
    if (params.targetDate) dossierFacts.push(`Target Date: ${params.targetDate}`);

    return {
      energySharing42cCutoverReadinessId: `es42c:${Buffer.from(
        `${cutoverId}:${params.pilotTenantId || ''}:${params.balanceGroupId || ''}:${params.owner || ''}`
      )
        .toString('base64url')
        .slice(0, 28)}`,
      capabilityKey: 'energy_sharing_42c_cutover_readiness',
      safety: 'read_only',
      status,
      riskLevel,
      readinessScore,
      cutoverId,
      pilotTenantId: params.pilotTenantId || null,
      balanceGroupId: params.balanceGroupId || null,
      targetDate: params.targetDate || null,
      owner: params.owner || null,
      subTracks,
      evidenceItems,
      missingEvidence,
      positiveFollowUps,
      evidenceRefs,
      sourceActions,
      validationFindings: missingEvidence,
      dossierEvidence: {
        status,
        riskLevel,
        readinessScore,
        cutoverId,
        pilotTenantId: params.pilotTenantId || null,
        balanceGroupId: params.balanceGroupId || null,
        targetDate: params.targetDate || null,
        owner: params.owner || null,
        subTracks,
        evidenceItems,
        missingEvidence,
        positiveFollowUps,
        evidenceRefs,
        sourceActions: {
          notCalled: sourceActions.notCalled,
        },
        dossierFacts,
      },
    };
  },

  buildEvuApiMigrationDiagnosticsStatus(params = {}) {
    const normalizeText = (value) => String(value || '').trim();
    const method = normalizeText(params.method).toUpperCase() || null;
    const responseCodeText = normalizeText(params.responseCode);
    const responseCode = responseCodeText ? Number.parseInt(responseCodeText, 10) : null;
    const evidenceSpecs = [
      {
        id: 'business_process',
        label: 'Business process',
        value: params.businessProcess,
        riskWhenMissing: 'high',
        enablesDossierAddition: 'add the affected EVU/VNB business process and migration scope',
      },
      {
        id: 'endpoint_method',
        label: 'Endpoint and method',
        value: params.endpoint && method,
        displayValue: [method, params.endpoint].filter(Boolean).join(' '),
        riskWhenMissing: 'high',
        enablesDossierAddition: 'add the concrete endpoint and HTTP method under migration',
      },
      {
        id: 'auth_scope',
        label: 'OAuth/auth scope',
        value: params.authScope,
        riskWhenMissing: 'medium',
        enablesDossierAddition: 'add scope mismatch or authorization boundary evidence',
      },
      {
        id: 'data_context',
        label: 'Data context',
        value: params.dataContext,
        riskWhenMissing: 'medium',
        enablesDossierAddition: 'add tenant, market-role or metering-context ambiguity evidence',
      },
      {
        id: 'request_shape',
        label: 'Request shape',
        value: params.requestShape,
        riskWhenMissing: 'medium',
        enablesDossierAddition: 'add request-body/schema mismatch diagnostics',
      },
      {
        id: 'failure_signal',
        label: 'Validation error and response code',
        value: params.validationError && params.responseCode,
        displayValue: [params.responseCode, params.validationError].filter(Boolean).join(' / '),
        riskWhenMissing: 'medium',
        enablesDossierAddition:
          'add concrete failure class evidence from validation error and response code',
      },
      {
        id: 'completion_criterion',
        label: 'Completion criterion',
        value: params.completionCriterion,
        riskWhenMissing: 'high',
        enablesDossierAddition: 'add the migration closure or readiness criterion',
      },
      {
        id: 'owner_next_step',
        label: 'Owner and next step',
        value: params.owner && params.nextStep,
        displayValue: [params.owner, params.nextStep].filter(Boolean).join(' -> '),
        riskWhenMissing: 'medium',
        enablesDossierAddition: 'add accountable owner and next 90-day follow-up',
      },
    ];
    const evidenceItems = evidenceSpecs
      .filter((item) => item.value)
      .map((item) => ({
        id: item.id,
        label: item.label,
        value: item.displayValue || item.value,
        status: 'provided',
        category: 'evu_api_migration_diagnostics',
      }));
    const missingEvidence = evidenceSpecs
      .filter((item) => !item.value)
      .map((item) => ({
        missingDataPoint: item.id,
        label: item.label,
        risk: item.riskWhenMissing,
        enablesDossierAddition: item.enablesDossierAddition,
        category: 'evu_api_migration_diagnostics',
      }));
    const hasHighRiskGap = missingEvidence.some((item) => item.risk === 'high');
    const status =
      missingEvidence.length === 0
        ? 'diagnostics_complete'
        : hasHighRiskGap
          ? 'needs_migration_context'
          : 'partial_diagnostics';
    const evidenceCompleteness = Number((evidenceItems.length / evidenceSpecs.length).toFixed(2));
    const riskHints = [];
    if (!params.authScope) riskHints.push('auth_scope_missing');
    if (!params.dataContext) riskHints.push('data_context_missing');
    if (!params.completionCriterion) riskHints.push('completion_criterion_missing');
    if (responseCode >= 400) riskHints.push('http_error_response_observed');
    if (normalizeText(params.validationError)) riskHints.push('validation_error_observed');
    const diagnosticFindings = [
      {
        id: 'api_migration_diagnostic_status',
        status,
        evidenceCompleteness,
        severity: hasHighRiskGap ? 'high' : missingEvidence.length ? 'medium' : 'info',
        message: missingEvidence.length
          ? `${missingEvidence.length} diagnostic evidence item(s) still missing`
          : 'Supplied EVU/VNB API migration evidence is complete for dossier diagnostics',
      },
    ];
    if (responseCode >= 400 || params.validationError) {
      diagnosticFindings.push({
        id: 'api_failure_signal',
        status: 'observed',
        severity: responseCode >= 500 ? 'high' : 'medium',
        message: [responseCodeText, normalizeText(params.validationError)]
          .filter(Boolean)
          .join(' / '),
      });
    }
    const positiveFollowUps = missingEvidence.map((item) => ({
      missingDataPoint: item.missingDataPoint,
      risk: item.risk,
      enablesDossierAddition: item.enablesDossierAddition,
      category: 'evu_api_migration_diagnostics',
    }));
    const next90DayStep =
      normalizeText(params.nextStep) ||
      'Collect missing API migration evidence before migration execution';
    const sourceActions = {
      inspected: ['dashboard-api.evuApiMigrationDiagnosticsStatus'],
      referenced: ['vdmi.dossier', 'interface-placeholder.requestEvidence'],
      notCalled: [
        'external.connector.call',
        'oauth.authorize',
        'oauth.refreshToken',
        'secret.read',
        'json-patch.apply',
        'api.retryRequest',
        'migration.execute',
        'third-party.closeProcess',
        'hitl.create',
        'mako.dispatch',
        'settlement.exportA96',
        'settlement.prepareBilling',
        'billing.release',
        'tariff.mutate',
        'personal-agent.execute',
      ],
    };
    const dossierFacts = [
      `Status: ${status}`,
      `Evidence Completeness: ${evidenceCompleteness}`,
      `Open gaps: ${missingEvidence.length}`,
    ];
    if (params.businessProcess) dossierFacts.push(`Business Process: ${params.businessProcess}`);
    if (params.endpoint || method)
      dossierFacts.push(`Endpoint: ${[method, params.endpoint].filter(Boolean).join(' ')}`);
    if (params.authScope) dossierFacts.push(`Auth Scope: ${params.authScope}`);
    if (params.dataContext) dossierFacts.push(`Data Context: ${params.dataContext}`);
    if (params.completionCriterion)
      dossierFacts.push(`Completion Criterion: ${params.completionCriterion}`);
    if (params.owner) dossierFacts.push(`Owner: ${params.owner}`);
    if (next90DayStep) dossierFacts.push(`Next Step: ${next90DayStep}`);

    return {
      evuApiMigrationDiagnosticsId: `evu-api:${Buffer.from(
        `${params.businessProcess || ''}:${params.endpoint || ''}:${method || ''}:${params.systemRef || ''}:${params.ticketRef || ''}`
      )
        .toString('base64url')
        .slice(0, 28)}`,
      capabilityKey: 'evu_api_migration_diagnostics',
      safety: 'read_only_diagnostics',
      status,
      evidenceCompleteness,
      businessProcess: params.businessProcess || null,
      endpoint: params.endpoint || null,
      method,
      authScope: params.authScope || null,
      dataContext: params.dataContext || null,
      requestShape: params.requestShape || null,
      validationError: params.validationError || null,
      responseCode: params.responseCode || null,
      completionCriterion: params.completionCriterion || null,
      owner: params.owner || null,
      nextStep: params.nextStep || null,
      next90DayStep,
      ticketRef: params.ticketRef || null,
      systemRef: params.systemRef || null,
      evidenceItems,
      missingEvidence,
      diagnosticFindings,
      riskHints,
      positiveFollowUps,
      sourceActions,
      validationFindings: missingEvidence,
      dossierEvidence: {
        status,
        safety: 'read_only_diagnostics',
        evidenceCompleteness,
        businessProcess: params.businessProcess || null,
        endpoint: params.endpoint || null,
        method,
        authScope: params.authScope || null,
        dataContext: params.dataContext || null,
        requestShape: params.requestShape || null,
        validationError: params.validationError || null,
        responseCode: params.responseCode || null,
        completionCriterion: params.completionCriterion || null,
        owner: params.owner || null,
        next90DayStep,
        missingEvidence,
        diagnosticFindings,
        riskHints,
        positiveFollowUps,
        sourceActions: {
          notCalled: sourceActions.notCalled,
        },
        dossierFacts,
      },
    };
  },

  buildNovaDecisionLifecycleReadinessStatus(params = {}) {
    const toList = (value) =>
      Array.isArray(value)
        ? value.filter(Boolean)
        : value
          ? String(value)
              .split(',')
              .map((item) => item.trim())
              .filter(Boolean)
          : [];
    const normalizeStatus = (value) => {
      if (value === true) return 'ready';
      if (value === false || value == null || value === '') return 'missing';
      const text = String(value).trim().toLowerCase();
      if (
        [
          'ready',
          'ok',
          'complete',
          'completed',
          'provided',
          'valid',
          'validated',
          'available',
          'confirmed',
          'approved',
          'done',
          'passed',
        ].includes(text)
      )
        return 'ready';
      if (['blocked', 'invalid', 'failed', 'rejected', 'red', 'critical'].includes(text))
        return 'blocked';
      if (
        [
          'risk',
          'risky',
          'warning',
          'late',
          'overdue',
          'pending_legal',
          'pending-regulatory',
        ].includes(text)
      )
        return 'risk';
      if (['partial', 'in_progress', 'in-progress', 'draft', 'pending', 'review'].includes(text))
        return 'partial';
      return 'ready';
    };
    const evidenceRefs = toList(params.evidenceRefs);
    const caseId = params.caseId || 'nova-decision-lifecycle-readiness';
    const evidenceSpecs = [
      {
        id: 'decision_lifecycle_model',
        label: 'Decision lifecycle model evidence',
        value: params.lifecycleModel,
        stage: 'lifecycle',
        expectedStates: [
          'proposed',
          'triaged',
          'pending_approval',
          'approved',
          'rejected',
          'expired',
          'applied',
        ],
        riskWhenMissing: 'high',
        enablesDossierAddition:
          'add a documented NOVA lifecycle model from proposed to applied/rejected/expired',
      },
      {
        id: 'decision_source_catalogue',
        label: 'Decision source catalogue evidence',
        value: params.sourceCatalogue,
        stage: 'sources',
        expectedSources: [
          'mastr-quality.audit',
          'redispatch-expost.audit',
          'vnb-monitor',
          'cya.a2a.consensus.failed',
          'mastr-monitor.delta.detected',
          'assets.override',
        ],
        riskWhenMissing: 'high',
        enablesDossierAddition:
          'add NOVA decision-source coverage for MaStR, Redispatch, VNB monitor, CYA/A2A, MaStR monitor and asset override triggers',
      },
      {
        id: 'transition_audit_history',
        label: 'Transition audit/history evidence',
        value: params.auditTrail,
        stage: 'audit',
        riskWhenMissing: 'high',
        enablesDossierAddition:
          'add lifecycle transition auditability evidence without writing NOVA decisions',
      },
      {
        id: 'tenant_isolated_sse_evidence',
        label: 'Tenant-isolated SSE readiness evidence',
        value: params.tenantIsolationEvidence,
        stage: 'sse',
        riskWhenMissing: 'medium',
        enablesDossierAddition:
          'add tenant-channel readiness evidence without changing SSE runtime behavior',
      },
      {
        id: 'hitl_bridge_policy',
        label: 'HITL bridge policy evidence',
        value: params.hitlPolicyEvidence,
        stage: 'hitl_policy',
        riskWhenMissing: 'medium',
        enablesDossierAddition:
          'add approval/escalation policy evidence without creating HITL items',
      },
      {
        id: 'replay_testability',
        label: 'Replay/testability evidence',
        value: params.replayEvidence,
        stage: 'replay',
        riskWhenMissing: 'medium',
        enablesDossierAddition:
          'add replay and audit testability evidence without adding a replay endpoint',
      },
      {
        id: 'expiry_non_execution',
        label: 'Expiry and non-execution evidence',
        value: params.expiryEvidence,
        stage: 'non_execution',
        riskWhenMissing: 'medium',
        enablesDossierAddition:
          'add expiry and non-execution evidence before production lifecycle execution is considered',
      },
    ];

    const readinessItems = evidenceSpecs.map((spec) => {
      const status = normalizeStatus(spec.value);
      return {
        id: spec.id,
        label: spec.label,
        stage: spec.stage,
        status,
        value: spec.value || null,
        risk: status === 'ready' ? 'low' : spec.riskWhenMissing,
        expectedStates: spec.expectedStates || undefined,
        expectedSources: spec.expectedSources || undefined,
        enablesDossierAddition: spec.enablesDossierAddition,
      };
    });
    const evidenceItems = readinessItems.filter((item) => item.status === 'ready');
    const missingEvidence = readinessItems
      .filter((item) => item.status !== 'ready')
      .map((item) => ({
        missingDataPoint: item.id,
        label: item.label,
        stage: item.stage,
        status: item.status,
        value: item.value,
        risk: item.risk,
        enablesDossierAddition: item.enablesDossierAddition,
        category: 'nova_decision_lifecycle_readiness',
      }));
    const hasHighRiskGap = missingEvidence.some((item) => item.risk === 'high');
    const hasMediumRiskGap = missingEvidence.some((item) => item.risk === 'medium');
    const status =
      missingEvidence.length === 0
        ? 'ready_for_trl7_review'
        : hasHighRiskGap
          ? 'blocked'
          : 'partial_readiness';
    const riskLevel =
      status === 'ready_for_trl7_review'
        ? 'low'
        : hasHighRiskGap
          ? 'high'
          : hasMediumRiskGap
            ? 'medium'
            : 'low';
    const readinessScore = Number((evidenceItems.length / evidenceSpecs.length).toFixed(2));
    const positiveFollowUps = missingEvidence.map((item) => ({
      missingDataPoint: item.missingDataPoint,
      stage: item.stage,
      status: item.status,
      risk: item.risk,
      enablesDossierAddition: item.enablesDossierAddition,
      category: 'nova_decision_lifecycle_readiness',
    }));
    const sourceActions = {
      inspected: ['dashboard-api.novaDecisionLifecycleReadinessStatus'],
      referenced: [
        'docs/use-cases/nova-decision-lifecycle-readiness.md',
        'services/nova.service.js',
        'vdmi.dossier',
        'hitl.summary',
      ],
      notCalled: [
        'nova.decisions.create',
        'nova.decisions.transition',
        'nova.decisions.approve',
        'nova.decisions.reject',
        'nova.decisions.expire',
        'nova.decisions.apply',
        'nova.decisions.replayTrigger',
        'hitl.create',
        'webhook.emit',
        'nova.sse.emit',
        'assets.applyOverride',
        'mastr-quality.applyCorrection',
        'redispatch-expost.applyCorrection',
        'vnb-monitor.updateThreshold',
        'settlement.exportA96',
        'billing.release',
        'tariff.update',
        'device-control.execute',
        'external.connector.call',
        'secret.read',
        'personal-agent.execute',
      ],
    };
    const dossierFacts = [
      `Status: ${status}`,
      `Risk Level: ${riskLevel}`,
      `Provided NOVA readiness evidence: ${evidenceItems.length}/${evidenceSpecs.length}`,
      `Open gaps: ${missingEvidence.length}`,
    ];
    if (params.decisionKind) dossierFacts.push(`Decision Kind: ${params.decisionKind}`);
    if (params.owner) dossierFacts.push(`Owner: ${params.owner}`);
    if (params.deadline) dossierFacts.push(`Deadline: ${params.deadline}`);

    return {
      novaDecisionLifecycleReadinessId: `nova-readiness:${Buffer.from(
        `${caseId}:${params.decisionKind || ''}:${params.owner || ''}`
      )
        .toString('base64url')
        .slice(0, 28)}`,
      capabilityKey: 'nova_decision_lifecycle_readiness',
      safety: 'read_only',
      status,
      riskLevel,
      readinessScore,
      caseId,
      decisionKind: params.decisionKind || null,
      owner: params.owner || null,
      deadline: params.deadline || null,
      openMeasure: params.openMeasure || null,
      decisionLifecycle: {
        expectedStates: [
          'proposed',
          'triaged',
          'pending_approval',
          'approved',
          'rejected',
          'expired',
          'applied',
        ],
        evidenceStatus:
          readinessItems.find((item) => item.id === 'decision_lifecycle_model')?.status ||
          'missing',
      },
      sourceCatalogue: {
        expectedSources: [
          'mastr-quality.audit',
          'redispatch-expost.audit',
          'vnb-monitor',
          'cya.a2a.consensus.failed',
          'mastr-monitor.delta.detected',
          'assets.override',
        ],
        evidenceStatus:
          readinessItems.find((item) => item.id === 'decision_source_catalogue')?.status ||
          'missing',
      },
      auditAndReplayReadiness: {
        auditTrailStatus:
          readinessItems.find((item) => item.id === 'transition_audit_history')?.status ||
          'missing',
        replayEvidenceStatus:
          readinessItems.find((item) => item.id === 'replay_testability')?.status || 'missing',
      },
      sseTenantIsolationReadiness:
        readinessItems.find((item) => item.id === 'tenant_isolated_sse_evidence')?.status ||
        'missing',
      hitlPolicyReadiness:
        readinessItems.find((item) => item.id === 'hitl_bridge_policy')?.status || 'missing',
      nonExecutionEvidence:
        readinessItems.find((item) => item.id === 'expiry_non_execution')?.status || 'missing',
      readinessItems,
      evidenceItems,
      missingEvidence,
      positiveFollowUps,
      evidenceRefs,
      sourceActions,
      validationFindings: missingEvidence,
      dossierEvidence: {
        status,
        riskLevel,
        readinessScore,
        caseId,
        decisionKind: params.decisionKind || null,
        owner: params.owner || null,
        deadline: params.deadline || null,
        readinessItems,
        evidenceItems,
        missingEvidence,
        positiveFollowUps,
        evidenceRefs,
        sourceActions: {
          notCalled: sourceActions.notCalled,
        },
        dossierFacts,
      },
    };
  },

  buildRegulatoryChangeReadinessStatus(params = {}) {
    const toList = (value) =>
      Array.isArray(value)
        ? value.filter(Boolean)
        : value
          ? String(value)
              .split(',')
              .map((item) => item.trim())
              .filter(Boolean)
          : [];
    const affectedSystems = toList(params.affectedSystems);
    const sourceDatapoints = toList(params.sourceDatapoints);
    const makoCases = toList(params.makoCases);
    const evidenceSpecs = [
      {
        id: 'data_contract',
        label: 'Regulatory change data contract',
        value: params.changeId && params.effectiveDate && params.mechanismType,
        displayValue: [params.changeId, params.effectiveDate, params.mechanismType]
          .filter(Boolean)
          .join(' / '),
        sourceClass: 'regulatory_change_contract',
        enablesDossierAddition: 'add change id, effective date and mechanism type',
      },
      {
        id: 'dictionary_version',
        label: 'Data dictionary version',
        value: params.dictionaryVersion,
        sourceClass: 'data_dictionary',
        enablesDossierAddition: 'add dictionary-grounded mechanism contract',
      },
      {
        id: 'source_datapoints',
        label: 'Source datapoints',
        value: sourceDatapoints.length > 0,
        displayValue: sourceDatapoints.join(', '),
        sourceClass: 'source_datapoint_snapshot',
        enablesDossierAddition: 'add referenced datapoint snapshot evidence',
      },
      {
        id: 'interval_profile_coverage',
        label: 'Interval profile coverage',
        value: params.intervalCoverage,
        sourceClass: 'interval_profile',
        enablesDossierAddition: 'add Viertelstundenprofil readiness proof',
      },
      {
        id: 'master_data_quality',
        label: 'Master data quality',
        value: params.masterDataStatus,
        sourceClass: 'master_data_quality',
        enablesDossierAddition: 'add MaStR/NAP/MeLo/master-data quality proof',
      },
      {
        id: 'substitute_value_policy',
        label: 'Substitute value policy',
        value: params.substituteValuePolicy,
        sourceClass: 'substitute_value_policy',
        enablesDossierAddition: 'add Ersatzwert policy evidence',
      },
      {
        id: 'market_communication_cases',
        label: 'MaKo special cases',
        value: makoCases.length > 0,
        displayValue: makoCases.join(', '),
        sourceClass: 'market_communication_case_pack',
        enablesDossierAddition: 'add MaKo Sonderfall test coverage',
      },
      {
        id: 'operator_declaration',
        label: 'Operator declaration',
        value: params.operatorDeclarationStatus,
        sourceClass: 'operator_declaration',
        enablesDossierAddition: 'add Betreibererklaerung readiness',
      },
      {
        id: 'billing_rule_reference',
        label: 'Billing rule reference',
        value: params.billingRuleReference,
        sourceClass: 'billing_rule_reference',
        enablesDossierAddition: 'add billing-rule reference evidence',
      },
      {
        id: 'audit_trail',
        label: 'Audit trail',
        value: params.auditTrailStatus,
        sourceClass: 'audit_trail',
        enablesDossierAddition: 'add audit evidence trail',
      },
      {
        id: 'test_case_pack',
        label: 'Test-case pack',
        value: params.testCasePackStatus,
        sourceClass: 'third_party_test_cases',
        enablesDossierAddition: 'add generated Drittsystem test-case requirements',
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
    const lowerMasterData = String(params.masterDataStatus || '').toLowerCase();
    const blockedByDataQuality = /block|fail|invalid|kritisch|unbrauchbar/.test(lowerMasterData);
    const status = blockedByDataQuality
      ? 'blocked_by_data_quality'
      : missingEvidence.length === 0
        ? 'ready_for_simulation'
        : !params.changeId ||
            !params.effectiveDate ||
            !params.mechanismType ||
            !params.dictionaryVersion
          ? 'needs_data_contract'
          : !params.intervalCoverage
            ? 'needs_interval_profile'
            : !params.masterDataStatus
              ? 'needs_masterdata'
              : !params.substituteValuePolicy
                ? 'needs_substitute_value_policy'
                : makoCases.length === 0
                  ? 'needs_mako_cases'
                  : !params.operatorDeclarationStatus
                    ? 'needs_operator_declaration'
                    : !params.auditTrailStatus
                      ? 'needs_audit_evidence'
                      : 'needs_test_data';
    const readinessScore = Number((evidenceItems.length / evidenceSpecs.length).toFixed(2));
    const positiveFollowUps = missingEvidence.map((item) => ({
      missingDataPoint: item.missingDataPoint,
      enablesDossierAddition: item.enablesDossierAddition,
      category: 'regulatory_change_readiness',
    }));
    const generatedTestCaseRequirements = missingEvidence
      .filter((item) =>
        [
          'interval_profile_coverage',
          'master_data_quality',
          'substitute_value_policy',
          'market_communication_cases',
          'billing_rule_reference',
          'audit_trail',
        ].includes(item.missingDataPoint)
      )
      .map((item) => ({
        id: `test_${item.missingDataPoint}`,
        requiredEvidence: item.missingDataPoint,
        description: item.enablesDossierAddition,
      }));
    const blockingFindings = missingEvidence.map((item) => ({
      code: `RCR_${String(item.missingDataPoint).toUpperCase()}_MISSING`,
      severity: [
        'data_contract',
        'dictionary_version',
        'master_data_quality',
        'audit_trail',
      ].includes(item.missingDataPoint)
        ? 'high'
        : 'medium',
      message: item.enablesDossierAddition,
    }));
    if (blockedByDataQuality) {
      blockingFindings.push({
        code: 'RCR_MASTER_DATA_QUALITY_BLOCKING',
        severity: 'high',
        message: 'master-data quality is explicitly blocking the readiness contract',
      });
    }
    const dossierFacts = [
      `Status: ${status}`,
      `Provided readiness evidence: ${evidenceItems.length}/${evidenceSpecs.length}`,
      `Open gaps: ${missingEvidence.length}`,
    ];
    if (params.changeId) dossierFacts.push(`Change: ${params.changeId}`);
    if (params.effectiveDate) dossierFacts.push(`Effective date: ${params.effectiveDate}`);
    if (params.mechanismType) dossierFacts.push(`Mechanism: ${params.mechanismType}`);

    return {
      readinessId: `rcr:${Buffer.from(
        `${params.changeId || ''}:${params.effectiveDate || ''}:${params.mechanismType || ''}`
      )
        .toString('base64url')
        .slice(0, 24)}`,
      capabilityKey: 'regulatory_change_simulator_readiness',
      safety: 'read_only',
      requestContext: {
        changeId: params.changeId || null,
        effectiveDate: params.effectiveDate || null,
        mechanismType: params.mechanismType || null,
        affectedSystems,
      },
      status,
      readinessScore,
      evidenceItems,
      missingEvidence,
      generatedTestCaseRequirements,
      positiveFollowUps,
      blockingFindings,
      sourceEvidence: {
        sourceDatapoints,
        dictionaryVersion: params.dictionaryVersion || null,
        makoCases,
        billingRuleReference: params.billingRuleReference || null,
      },
      sourceActions: {
        inspected: ['dashboard-api.regulatoryChangeReadinessStatus'],
        referenced: [
          'datasource-registry.get',
          'datapoint.health',
          'datapoint.validateSnapshot',
          'mastr-quality.audit',
          'edm-validation.validate',
          'mscons-import.import',
          'settlement.readiness',
          'vdmi.dossier',
          'presentation.generate',
        ],
        notCalled: [
          'settlement.exportA96',
          'settlement.prepareBilling',
          'billing.release',
          'mako.dispatch',
          'hitl.create',
          'external.connector.call',
          'personal-agent.execute',
        ],
      },
      validationFindings: blockingFindings,
      dossierEvidence: {
        status,
        readinessScore,
        evidenceItems,
        missingEvidence,
        generatedTestCaseRequirements,
        positiveFollowUps,
        blockingFindings,
        sourceEvidence: {
          sourceDatapoints,
          dictionaryVersion: params.dictionaryVersion || null,
          makoCases,
          billingRuleReference: params.billingRuleReference || null,
        },
        dossierFacts,
      },
    };
  },

  buildInvestmentTwoTrackControlStatus(params = {}) {
    const toList = (value) =>
      Array.isArray(value)
        ? value.filter(Boolean)
        : value
          ? String(value)
              .split(',')
              .map((item) => item.trim())
              .filter(Boolean)
          : [];
    const sourceDatapoints = toList(params.sourceDatapoints);
    const explicitBlockedDecisions = toList(params.blockedDecisions);
    const evidenceSpecs = [
      {
        id: 'submission_contract',
        track: 'tactical',
        label: 'Tactical submission contract',
        value: params.submissionId && params.deadline && params.submissionFormat,
        displayValue: [params.submissionId, params.deadline, params.submissionFormat]
          .filter(Boolean)
          .join(' / '),
        sourceClass: 'investment_submission_contract',
        enablesDossierAddition: 'add submission id, deadline and required submission format',
      },
      {
        id: 'tactical_owner',
        track: 'tactical',
        label: 'Tactical submission owner',
        value: params.tacticalOwner,
        sourceClass: 'accountable_owner',
        enablesDossierAddition: 'add accountable tactical submission owner',
      },
      {
        id: 'measures_and_budget',
        track: 'tactical',
        label: 'Measures and budget envelope',
        value: Number(params.measureCount || 0) > 0 && params.budgetEnvelopeEur != null,
        displayValue: `${params.measureCount || 0} measures / ${params.budgetEnvelopeEur ?? 'no'} EUR`,
        sourceClass: 'investment_plan_measure_pack',
        enablesDossierAddition: 'add measure count and budget-envelope confidence',
      },
      {
        id: 'finance_review',
        track: 'tactical',
        label: 'Finance review state',
        value: params.financeReviewStatus,
        sourceClass: 'finance_review',
        enablesDossierAddition: 'add finance-review state and budget-envelope confidence',
      },
      {
        id: 'board_format',
        track: 'tactical',
        label: 'Board / committee format',
        value: params.boardReadiness,
        sourceClass: 'board_submission_format',
        enablesDossierAddition: 'add board or committee submission readiness',
      },
      {
        id: 'source_datapoints',
        track: 'shared',
        label: 'Source datapoints',
        value: sourceDatapoints.length > 0,
        displayValue: sourceDatapoints.join(', '),
        sourceClass: 'source_datapoint_snapshot',
        enablesDossierAddition: 'add referenced investment datapoint snapshot evidence',
      },
      {
        id: 'data_quality_plan',
        track: 'target',
        label: 'Target-process data-quality plan',
        value: params.dataQualityStatus,
        sourceClass: 'data_quality_plan',
        enablesDossierAddition: 'add target-process data-quality closure path',
      },
      {
        id: 'target_owner',
        track: 'target',
        label: 'Target-process owner',
        value: params.targetOwner,
        sourceClass: 'target_process_owner',
        enablesDossierAddition: 'add accountable target-process owner',
      },
      {
        id: 'approval_model',
        track: 'target',
        label: 'Role and approval model',
        value: params.approvalModel,
        sourceClass: 'role_approval_model',
        enablesDossierAddition: 'add role and approval-model evidence',
      },
      {
        id: 'handover_status',
        track: 'target',
        label: 'Target-process handover status',
        value: params.handoverStatus,
        sourceClass: 'target_process_handover',
        enablesDossierAddition: 'add target-process handover readiness',
      },
    ];
    const evidenceItems = evidenceSpecs
      .filter((spec) => spec.value)
      .map((spec) => ({
        id: spec.id,
        track: spec.track,
        label: spec.label,
        value: spec.displayValue || spec.value,
        sourceClass: spec.sourceClass,
        evidenceStatus: 'provided',
      }));
    const missingEvidence = evidenceSpecs
      .filter((spec) => !spec.value)
      .map((spec) => ({
        missingDataPoint: spec.id,
        track: spec.track,
        label: spec.label,
        sourceClass: spec.sourceClass,
        enablesDossierAddition: spec.enablesDossierAddition,
      }));
    const lowerApproval = String(params.approvalModel || '').toLowerCase();
    const lowerDataQuality = String(params.dataQualityStatus || '').toLowerCase();
    const blockedByApproval = /block|missing|none|unklar|offen|rejected|abgelehnt/.test(
      lowerApproval
    );
    const blockedByDataQuality = /block|fail|critical|kritisch|unbrauchbar/.test(lowerDataQuality);
    const status = blockedByApproval
      ? 'blocked_by_approval'
      : blockedByDataQuality
        ? 'needs_data_quality'
        : !params.tacticalOwner
          ? 'needs_tactical_owner'
          : !params.financeReviewStatus
            ? 'needs_finance_review'
            : !params.boardReadiness
              ? 'needs_board_format'
              : !params.dataQualityStatus ||
                  !params.targetOwner ||
                  !params.approvalModel ||
                  !params.handoverStatus
                ? 'target_process_pending'
                : missingEvidence.length === 0
                  ? 'ready_for_submission'
                  : 'needs_data_quality';
    const tacticalEvidence = evidenceItems.filter((item) => item.track === 'tactical').length;
    const tacticalTotal = evidenceSpecs.filter((item) => item.track === 'tactical').length;
    const targetEvidence = evidenceItems.filter((item) => item.track === 'target').length;
    const targetTotal = evidenceSpecs.filter((item) => item.track === 'target').length;
    const readinessScore = Number((evidenceItems.length / evidenceSpecs.length).toFixed(2));
    const positiveFollowUps = missingEvidence.map((item) => ({
      missingDataPoint: item.missingDataPoint,
      enablesDossierAddition: item.enablesDossierAddition,
      category: 'investment_two_track_control',
      track: item.track,
    }));
    const derivedBlockedDecisions = missingEvidence
      .filter((item) =>
        [
          'tactical_owner',
          'finance_review',
          'board_format',
          'data_quality_plan',
          'approval_model',
          'handover_status',
        ].includes(item.missingDataPoint)
      )
      .map((item) => item.label);
    const blockedDecisions = Array.from(
      new Set([...explicitBlockedDecisions, ...derivedBlockedDecisions])
    );
    const blockingFindings = missingEvidence.map((item) => ({
      code: `ITC_${String(item.missingDataPoint).toUpperCase()}_MISSING`,
      severity: ['tactical_owner', 'finance_review', 'approval_model'].includes(
        item.missingDataPoint
      )
        ? 'high'
        : 'medium',
      message: item.enablesDossierAddition,
    }));
    if (blockedByApproval) {
      blockingFindings.push({
        code: 'ITC_APPROVAL_MODEL_BLOCKING',
        severity: 'high',
        message: 'approval model is explicitly blocking the two-track control view',
      });
    }
    const tacticalTrack = {
      readiness: `${tacticalEvidence}/${tacticalTotal}`,
      owner: params.tacticalOwner || null,
      deadline: params.deadline || null,
      submissionFormat: params.submissionFormat || null,
      measureCount: params.measureCount ?? null,
      budgetEnvelopeEur: params.budgetEnvelopeEur ?? null,
      financeReviewStatus: params.financeReviewStatus || null,
      boardReadiness: params.boardReadiness || null,
    };
    const targetTrack = {
      readiness: `${targetEvidence}/${targetTotal}`,
      owner: params.targetOwner || null,
      dataQualityStatus: params.dataQualityStatus || null,
      approvalModel: params.approvalModel || null,
      handoverStatus: params.handoverStatus || null,
    };
    const dossierFacts = [
      `Status: ${status}`,
      `Tactical readiness: ${tacticalTrack.readiness}`,
      `Target readiness: ${targetTrack.readiness}`,
      `Open gaps: ${missingEvidence.length}`,
    ];
    if (params.submissionId) dossierFacts.push(`Submission: ${params.submissionId}`);
    if (params.deadline) dossierFacts.push(`Deadline: ${params.deadline}`);
    if (params.tacticalOwner) dossierFacts.push(`Tactical Owner: ${params.tacticalOwner}`);
    if (params.targetOwner) dossierFacts.push(`Target Owner: ${params.targetOwner}`);

    return {
      controlId: `itc:${Buffer.from(
        `${params.submissionId || ''}:${params.gridOperatorId || ''}:${params.deadline || ''}:${params.tacticalOwner || ''}`
      )
        .toString('base64url')
        .slice(0, 24)}`,
      capabilityKey: 'investment_two_track_control',
      safety: 'read_only',
      requestContext: {
        submissionId: params.submissionId || null,
        gridOperatorId: params.gridOperatorId || null,
        deadline: params.deadline || null,
        sourceDatapoints,
      },
      status,
      readinessScore,
      tacticalTrack,
      targetTrack,
      evidenceItems,
      missingEvidence,
      positiveFollowUps,
      blockedDecisions,
      blockingFindings,
      sourceEvidence: {
        sourceDatapoints,
        budgetEnvelopeEur: params.budgetEnvelopeEur ?? null,
        measureCount: params.measureCount ?? null,
      },
      sourceActions: {
        inspected: ['dashboard-api.investmentTwoTrackControlStatus'],
        referenced: [
          'datasource-registry.get',
          'datapoint.health',
          'investment-planning.createPlan',
          'finance-agent.analyze',
          'vdmi.dossier',
          'interface-placeholder.requestEvidence',
          'presentation.generate',
        ],
        notCalled: [
          'investment-planning.createPlan',
          'finance-agent.mutate',
          'settlement.exportA96',
          'settlement.prepareBilling',
          'billing.release',
          'mako.dispatch',
          'sap.psp.write',
          'hitl.create',
          'vdmi.create',
          'external.connector.call',
          'personal-agent.execute',
        ],
      },
      validationFindings: blockingFindings,
      dossierEvidence: {
        status,
        readinessScore,
        tacticalTrack,
        targetTrack,
        evidenceItems,
        missingEvidence,
        positiveFollowUps,
        blockedDecisions,
        blockingFindings,
        sourceEvidence: {
          sourceDatapoints,
          budgetEnvelopeEur: params.budgetEnvelopeEur ?? null,
          measureCount: params.measureCount ?? null,
        },
        dossierFacts,
      },
    };
  },

  buildSapBudgetPspGateStatus(params = {}) {
    const toList = (value) =>
      Array.isArray(value)
        ? value.filter(Boolean)
        : value
          ? String(value)
              .split(',')
              .map((item) => item.trim())
              .filter(Boolean)
          : [];
    const explicitBlockedDecisions = toList(params.blockedDecisions);
    const hasNumber = (value) => Number.isFinite(Number(value));
    const availableBudget = hasNumber(params.availableBudgetEur)
      ? Number(params.availableBudgetEur)
      : null;
    const plannedValue = hasNumber(params.plannedValueEur) ? Number(params.plannedValueEur) : null;
    const committedValue = hasNumber(params.committedValueEur)
      ? Number(params.committedValueEur)
      : null;
    const pspCarryOver = hasNumber(params.pspCarryOverEur) ? Number(params.pspCarryOverEur) : null;
    const budgetOverhang = hasNumber(params.budgetOverhangEur)
      ? Number(params.budgetOverhangEur)
      : availableBudget != null && plannedValue != null && committedValue != null
        ? Number((availableBudget - plannedValue - committedValue).toFixed(2))
        : null;
    const effectiveBudgetGap =
      availableBudget != null && plannedValue != null && committedValue != null
        ? Number((plannedValue + committedValue - availableBudget).toFixed(2))
        : null;
    const evidenceSpecs = [
      {
        id: 'measure_context',
        label: 'Measure and migration context',
        value: params.measureId && params.measureName && params.migrationWave,
        displayValue: [params.measureId, params.measureName, params.migrationWave]
          .filter(Boolean)
          .join(' / '),
        sourceClass: 'investment_measure_context',
        enablesDossierAddition: 'add measure identity, name and SAP migration wave',
      },
      {
        id: 'sap_mapping',
        label: 'SAP system and legacy internal order mapping',
        value: params.sapSystemRef && params.legacyInternalOrderId,
        displayValue: [params.sapSystemRef, params.legacyInternalOrderId]
          .filter(Boolean)
          .join(' / '),
        sourceClass: 'sap_target_process_mapping',
        enablesDossierAddition: 'add SAP target-process and legacy internal-order evidence',
      },
      {
        id: 'psp_snapshot',
        label: 'PSP element and carry-over snapshot',
        value: params.pspElementId && pspCarryOver != null && params.sourceSnapshotId,
        displayValue: [params.pspElementId, pspCarryOver, params.sourceSnapshotId]
          .filter(Boolean)
          .join(' / '),
        sourceClass: 'psp_carry_over_snapshot',
        enablesDossierAddition: 'add PSP carry-over and source snapshot evidence',
      },
      {
        id: 'budget_values',
        label: 'Budget, plan and commitment values',
        value: availableBudget != null && plannedValue != null && committedValue != null,
        displayValue: `${availableBudget ?? 'no'} available / ${plannedValue ?? 'no'} planned / ${committedValue ?? 'no'} committed`,
        sourceClass: 'budget_value_snapshot',
        enablesDossierAddition: 'add available budget, planned value and committed value evidence',
      },
      {
        id: 'budget_owner',
        label: 'Budget owner role',
        value: params.ownerRole,
        sourceClass: 'accountable_budget_owner',
        enablesDossierAddition: 'add accountable budget owner and escalation path',
      },
      {
        id: 'asset_benefit',
        label: 'Asset benefit and priority rationale',
        value: params.assetBenefit && hasNumber(params.priorityScore),
        displayValue: [params.assetBenefit, params.priorityScore]
          .filter((v) => v != null && v !== '')
          .join(' / '),
        sourceClass: 'asset_benefit_prioritization',
        enablesDossierAddition: 'add asset-benefit and prioritisation rationale for the measure',
      },
      {
        id: 'finance_gate',
        label: 'Finance gate',
        value: params.financeGate,
        sourceClass: 'finance_gate_state',
        enablesDossierAddition: 'add finance-gate and board-submission readiness',
      },
      {
        id: 'approval_status',
        label: 'Approval status',
        value: params.approvalStatus,
        sourceClass: 'approval_state',
        enablesDossierAddition: 'add approval-state evidence and blocked-decision context',
      },
      {
        id: 'data_quality',
        label: 'Data quality status',
        value: params.dataQualityStatus,
        sourceClass: 'source_data_quality',
        enablesDossierAddition: 'add source-data quality and auditability evidence',
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
    const lowerApproval = String(params.approvalStatus || '').toLowerCase();
    const lowerDataQuality = String(params.dataQualityStatus || '').toLowerCase();
    const blockedByApproval = /block|blocked|rejected|abgelehnt|stop|gesperrt/.test(lowerApproval);
    const blockedByDataQuality = /block|fail|critical|kritisch|unbrauchbar|rejected/.test(
      lowerDataQuality
    );
    const status = blockedByApproval
      ? 'blocked_by_approval'
      : blockedByDataQuality
        ? 'blocked_by_data_quality'
        : !params.pspElementId || pspCarryOver == null || !params.sourceSnapshotId
          ? 'needs_psp_snapshot'
          : !params.ownerRole
            ? 'needs_budget_owner'
            : !params.assetBenefit || !hasNumber(params.priorityScore)
              ? 'needs_asset_benefit'
              : !params.sapSystemRef || !params.legacyInternalOrderId
                ? 'needs_sap_mapping'
                : !params.financeGate || !params.approvalStatus
                  ? 'needs_finance_gate'
                  : missingEvidence.length === 0
                    ? 'ready_for_finance_gate'
                    : 'needs_budget_evidence';
    const readinessScore = Number((evidenceItems.length / evidenceSpecs.length).toFixed(2));
    const positiveFollowUps = missingEvidence.map((item) => ({
      missingDataPoint: item.missingDataPoint,
      enablesDossierAddition: item.enablesDossierAddition,
      category: 'sap_budget_psp_gate',
    }));
    const derivedBlockedDecisions = missingEvidence
      .filter((item) =>
        [
          'psp_snapshot',
          'budget_owner',
          'asset_benefit',
          'finance_gate',
          'approval_status',
          'data_quality',
        ].includes(item.missingDataPoint)
      )
      .map((item) => item.label);
    const blockedDecisions = Array.from(
      new Set([...explicitBlockedDecisions, ...derivedBlockedDecisions])
    );
    const blockingFindings = missingEvidence.map((item) => ({
      code: `SBP_${String(item.missingDataPoint).toUpperCase()}_MISSING`,
      severity: ['psp_snapshot', 'budget_owner', 'finance_gate', 'approval_status'].includes(
        item.missingDataPoint
      )
        ? 'high'
        : 'medium',
      message: item.enablesDossierAddition,
    }));
    if (blockedByApproval) {
      blockingFindings.push({
        code: 'SBP_APPROVAL_BLOCKING',
        severity: 'high',
        message: 'approval status is explicitly blocking the SAP/PSP budget gate',
      });
    }
    if (blockedByDataQuality) {
      blockingFindings.push({
        code: 'SBP_DATA_QUALITY_BLOCKING',
        severity: 'high',
        message: 'data quality is explicitly blocking the SAP/PSP budget gate',
      });
    }
    const measureContext = {
      measureId: params.measureId || null,
      measureName: params.measureName || null,
      migrationWave: params.migrationWave || null,
      sapSystemRef: params.sapSystemRef || null,
      legacyInternalOrderId: params.legacyInternalOrderId || null,
      pspElementId: params.pspElementId || null,
    };
    const budgetEvidence = {
      availableBudgetEur: availableBudget,
      plannedValueEur: plannedValue,
      committedValueEur: committedValue,
      pspCarryOverEur: pspCarryOver,
      budgetOverhangEur: budgetOverhang,
      effectiveBudgetGapEur: effectiveBudgetGap,
    };
    const gateEvidence = {
      assetBenefit: params.assetBenefit || null,
      priorityScore: hasNumber(params.priorityScore) ? Number(params.priorityScore) : null,
      ownerRole: params.ownerRole || null,
      approvalStatus: params.approvalStatus || null,
      financeGate: params.financeGate || null,
      dataQualityStatus: params.dataQualityStatus || null,
      sourceSnapshotId: params.sourceSnapshotId || null,
    };
    const dossierFacts = [
      `Status: ${status}`,
      `Provided gate evidence: ${evidenceItems.length}/${evidenceSpecs.length}`,
      `Open gaps: ${missingEvidence.length}`,
    ];
    if (params.measureId) dossierFacts.push(`Measure: ${params.measureId}`);
    if (params.pspElementId) dossierFacts.push(`PSP: ${params.pspElementId}`);
    if (budgetOverhang != null) dossierFacts.push(`Budget overhang EUR: ${budgetOverhang}`);
    if (effectiveBudgetGap != null) dossierFacts.push(`Budget gap EUR: ${effectiveBudgetGap}`);

    return {
      gateId: `sbp:${Buffer.from(
        `${params.measureId || ''}:${params.migrationWave || ''}:${params.pspElementId || ''}:${params.sourceSnapshotId || ''}`
      )
        .toString('base64url')
        .slice(0, 24)}`,
      capabilityKey: 'sap_budget_psp_gate',
      safety: 'read_only',
      requestContext: {
        measureId: params.measureId || null,
        migrationWave: params.migrationWave || null,
        sourceSnapshotId: params.sourceSnapshotId || null,
      },
      status,
      readinessScore,
      measureContext,
      budgetEvidence,
      gateEvidence,
      evidenceItems,
      missingEvidence,
      positiveFollowUps,
      blockedDecisions,
      blockingFindings,
      sourceEvidence: {
        measureContext,
        budgetEvidence,
        gateEvidence,
      },
      sourceActions: {
        inspected: ['dashboard-api.sapBudgetPspGateStatus'],
        referenced: [
          'datasource-registry.get',
          'datapoint.health',
          'investment-planning.createPlan',
          'finance-agent.analyze',
          'vdmi.dossier',
          'interface-placeholder.requestEvidence',
          'presentation.generate',
        ],
        notCalled: [
          'sap.psp.write',
          'sap.budget.write',
          'finance-agent.mutate',
          'investment-planning.createPlan',
          'settlement.exportA96',
          'settlement.prepareBilling',
          'billing.release',
          'mako.dispatch',
          'hitl.create',
          'vdmi.create',
          'external.connector.call',
          'personal-agent.execute',
        ],
      },
      validationFindings: blockingFindings,
      dossierEvidence: {
        status,
        readinessScore,
        measureContext,
        budgetEvidence,
        gateEvidence,
        evidenceItems,
        missingEvidence,
        positiveFollowUps,
        blockedDecisions,
        blockingFindings,
        dossierFacts,
      },
    };
  },
};
