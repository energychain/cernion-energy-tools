'use strict';

// dashboard-api methods chunk 5/14 — extracted verbatim from
// services/dashboard-api.service.js as part of the v0.99 file-size modularization.
// Contains: buildEnergyTaxInformationPackageStatus, buildInvestmentRiskTranslationStatus, buildBudgetWaterfallGovernanceStatus, buildGasDecommissioningRoadmapStatus, buildJourFixeDecisionClosureStatus, buildOffBalancingMeteringPruefmatrixStatus, buildAutomationRequirementsDecisionValueStatus, buildSmartMeterOffBalancingPurposeLockStatus, buildImsysScheduleValueChainReadinessStatus, buildClsDigitalTwinComplianceGateStatus, buildLegacyControlTechnologyTransitionStatus, buildControllabilitySubmissionCockpitStatus, buildCrisisDecisionRoutineStatus, buildInvestmentCommitteeSteeringCardsStatus, buildInvestmentDataReviewQueueStatus, buildFlexStrategicDemandIntakeStatus

module.exports = {
  buildEnergyTaxInformationPackageStatus(params = {}) {
    const toList = (value) =>
      Array.isArray(value)
        ? value.filter(Boolean)
        : value
          ? String(value)
              .split(',')
              .map((item) => item.trim())
              .filter(Boolean)
          : [];
    const period =
      params.period || [params.periodStart, params.periodEnd].filter(Boolean).join('/');
    const sourceRefs = toList(params.sourceRefs);
    const evidenceSpecs = [
      {
        id: 'package_identity',
        label: 'Package and source identity',
        value: params.packageId && params.dataSourceId,
        displayValue: [params.packageId, params.dataSourceId].filter(Boolean).join(' / '),
        sourceClass: 'information_package_identity',
        enablesDossierAddition:
          'add the package id and source data reference to the tax/finance handover',
      },
      {
        id: 'data_dictionary',
        label: 'Data dictionary version',
        value: params.dictionaryVersion,
        sourceClass: 'data_dictionary_contract',
        enablesDossierAddition: 'add semantically stable field definitions for the package',
      },
      {
        id: 'period_definition',
        label: 'Package period',
        value: period,
        sourceClass: 'period_definition',
        enablesDossierAddition: 'add the time-bounded tax/finance handover period',
      },
      {
        id: 'aggregation_logic',
        label: 'Aggregation logic',
        value: params.aggregationLogic,
        sourceClass: 'aggregation_logic',
        enablesDossierAddition: 'add reproducible aggregation logic for audit review',
      },
      {
        id: 'validation_status',
        label: 'Validation status',
        value: params.validationStatus,
        sourceClass: 'validation_status',
        enablesDossierAddition: 'add handover readiness based on validated source data',
      },
      {
        id: 'responsible_owner',
        label: 'Responsible owner',
        value: params.responsibleOwner,
        sourceClass: 'source_owner',
        enablesDossierAddition: 'add accountable owner and escalation context',
      },
      {
        id: 'handover_contact',
        label: 'Handover contact role',
        value: params.contactRole,
        sourceClass: 'handover_contact',
        enablesDossierAddition: 'add contact role for tax/finance follow-up',
      },
      {
        id: 'sla',
        label: 'SLA / response window',
        value: params.sla,
        sourceClass: 'handover_sla',
        enablesDossierAddition: 'add SLA and ageing context for open questions',
      },
      {
        id: 'audit_reference',
        label: 'Audit reference',
        value: params.auditReference,
        sourceClass: 'audit_reference',
        enablesDossierAddition: 'add audit-traceable package support',
      },
      {
        id: 'handover_decision',
        label: 'Handover decision',
        value: params.handoverDecision,
        sourceClass: 'handover_decision',
        enablesDossierAddition: 'add final package handover summary',
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
    const lowerValidation = String(params.validationStatus || '').toLowerCase();
    const lowerDecision = String(params.handoverDecision || '').toLowerCase();
    const blockedByValidation =
      /block|fail|critical|kritisch|invalid|ungueltig|ungültig|rejected/.test(lowerValidation);
    const blockedByDecision = /block|blocked|rejected|abgelehnt|stop|gesperrt/.test(lowerDecision);
    const status = blockedByValidation
      ? 'blocked_by_validation'
      : blockedByDecision
        ? 'blocked_by_handover_decision'
        : !params.dictionaryVersion
          ? 'needs_dictionary'
          : !period
            ? 'needs_period'
            : !params.aggregationLogic
              ? 'needs_aggregation_logic'
              : !params.validationStatus
                ? 'needs_validation'
                : !params.responsibleOwner || !params.contactRole || !params.sla
                  ? 'needs_owner_sla'
                  : !params.auditReference
                    ? 'needs_audit_reference'
                    : !params.handoverDecision
                      ? 'needs_handover_decision'
                      : missingEvidence.length === 0
                        ? 'ready_for_handover'
                        : 'needs_package_evidence';
    const readinessScore = Number((evidenceItems.length / evidenceSpecs.length).toFixed(2));
    const positiveFollowUps = missingEvidence.map((item) => ({
      missingDataPoint: item.missingDataPoint,
      enablesDossierAddition: item.enablesDossierAddition,
      category: 'energy_tax_information_package',
    }));
    const blockingFindings = missingEvidence.map((item) => ({
      code: `ETIP_${String(item.missingDataPoint).toUpperCase()}_MISSING`,
      severity: [
        'data_dictionary',
        'period_definition',
        'aggregation_logic',
        'validation_status',
        'handover_decision',
      ].includes(item.missingDataPoint)
        ? 'high'
        : 'medium',
      message: item.enablesDossierAddition,
    }));
    if (blockedByValidation) {
      blockingFindings.push({
        code: 'ETIP_VALIDATION_BLOCKING',
        severity: 'high',
        message: 'validation status is explicitly blocking the information-package handover',
      });
    }
    if (blockedByDecision) {
      blockingFindings.push({
        code: 'ETIP_HANDOVER_DECISION_BLOCKING',
        severity: 'high',
        message: 'handover decision is explicitly blocking the information-package handover',
      });
    }
    const packageContext = {
      packageId: params.packageId || null,
      dataSourceId: params.dataSourceId || null,
      dictionaryVersion: params.dictionaryVersion || null,
      period: period || null,
      aggregationLogic: params.aggregationLogic || null,
    };
    const handoverContext = {
      validationStatus: params.validationStatus || null,
      responsibleOwner: params.responsibleOwner || null,
      contactRole: params.contactRole || null,
      sla: params.sla || null,
      auditReference: params.auditReference || null,
      handoverDecision: params.handoverDecision || null,
      evidenceStatus: params.evidenceStatus || null,
      dataQualityStatus: params.dataQualityStatus || null,
    };
    const dossierFacts = [
      `Status: ${status}`,
      `Provided package evidence: ${evidenceItems.length}/${evidenceSpecs.length}`,
      `Open gaps: ${missingEvidence.length}`,
    ];
    if (params.packageId) dossierFacts.push(`Package: ${params.packageId}`);
    if (params.dataSourceId) dossierFacts.push(`Source: ${params.dataSourceId}`);
    if (params.dictionaryVersion) dossierFacts.push(`Dictionary: ${params.dictionaryVersion}`);
    if (period) dossierFacts.push(`Period: ${period}`);

    return {
      packageReadinessId: `etip:${Buffer.from(
        `${params.packageId || ''}:${params.dataSourceId || ''}:${params.dictionaryVersion || ''}:${period || ''}`
      )
        .toString('base64url')
        .slice(0, 24)}`,
      capabilityKey: 'energy_tax_information_package',
      safety: 'read_only',
      requestContext: {
        packageId: params.packageId || null,
        dataSourceId: params.dataSourceId || null,
        period: period || null,
      },
      status,
      readinessScore,
      packageContext,
      handoverContext,
      evidenceItems,
      missingEvidence,
      positiveFollowUps,
      blockingFindings,
      sourceEvidence: {
        packageContext,
        handoverContext,
        sourceRefs,
      },
      evidenceRefs: sourceRefs,
      sourceActions: {
        inspected: ['dashboard-api.energyTaxInformationPackageStatus'],
        referenced: [
          'datasource-registry.get',
          'datasource-registry.updateDictionary',
          'datasource-classifier.classify',
          'datapoint.health',
          'vdmi.dossier',
          'interface-placeholder.requestEvidence',
          'presentation.generate',
        ],
        notCalled: [
          'tax.calculate',
          'tax.authority.submit',
          'package.release',
          'raw-data.copy',
          'finance-agent.mutate',
          'settlement.exportA96',
          'settlement.prepareBilling',
          'billing.release',
          'mako.dispatch',
          'sap.psp.write',
          'hitl.create',
          'external.connector.call',
          'personal-agent.execute',
        ],
      },
      validationFindings: blockingFindings,
      dossierEvidence: {
        status,
        readinessScore,
        packageContext,
        handoverContext,
        evidenceItems,
        missingEvidence,
        positiveFollowUps,
        blockingFindings,
        sourceRefs,
        dossierFacts,
      },
    };
  },

  buildInvestmentRiskTranslationStatus(params = {}) {
    const toList = (value) =>
      Array.isArray(value)
        ? value.filter(Boolean)
        : value
          ? String(value)
              .split(',')
              .map((item) => item.trim())
              .filter(Boolean)
          : [];
    const evidenceRefs = toList(params.evidenceRefs);
    const forbiddenAssumptions = toList(params.forbiddenAssumptions);
    const evidenceSpecs = [
      {
        id: 'source_identity',
        label: 'Source reference and type',
        value: params.sourceRef && params.sourceType,
        displayValue: [params.sourceRef, params.sourceType].filter(Boolean).join(' / '),
        sourceClass: 'investment_risk_source',
        enablesDossierAddition: 'add the concrete management/risk source and document type',
      },
      {
        id: 'period_division',
        label: 'Period and division',
        value: params.period && params.division,
        displayValue: [params.period, params.division].filter(Boolean).join(' / '),
        sourceClass: 'business_context',
        enablesDossierAddition: 'add the temporal and division context for the handover',
      },
      {
        id: 'classification',
        label: 'Translation classification',
        value: params.classification,
        sourceClass: 'classification',
        enablesDossierAddition:
          'add whether the source is report, decision basis, evidence, risk, measure or follow-up task',
      },
      {
        id: 'impact_context',
        label: 'Financial and asset impact',
        value: params.financialImpact || params.assetImpact || params.budgetRef || params.riskRef,
        displayValue: [params.financialImpact, params.assetImpact, params.budgetRef, params.riskRef]
          .filter(Boolean)
          .join(' / '),
        sourceClass: 'impact_context',
        enablesDossierAddition: 'add investment, asset and risk consequence wording',
      },
      {
        id: 'owner_role',
        label: 'Owner role',
        value: params.ownerRole,
        sourceClass: 'owner',
        enablesDossierAddition: 'add accountable handover ownership',
      },
      {
        id: 'decision_readiness',
        label: 'Decision readiness',
        value: params.decisionReadiness,
        sourceClass: 'decision_readiness',
        enablesDossierAddition: 'add decision-readiness and blocked-decision context',
      },
      {
        id: 'blocked_decision',
        label: 'Blocked decision',
        value: params.blockedDecisionId,
        sourceClass: 'decision_chain',
        enablesDossierAddition: 'add the concrete follow-up decision that is blocked or prepared',
      },
      {
        id: 'next_action',
        label: 'Next action',
        value: params.nextAction,
        sourceClass: 'handover_action',
        enablesDossierAddition: 'add operational next-action wording',
      },
      {
        id: 'source_snapshot',
        label: 'Source snapshot',
        value: params.sourceSnapshot,
        sourceClass: 'source_grounding',
        enablesDossierAddition: 'add source grounding for the translation status',
      },
      {
        id: 'evidence_refs',
        label: 'Evidence references',
        value: evidenceRefs.length > 0,
        displayValue: evidenceRefs.join(', '),
        sourceClass: 'evidence_refs',
        enablesDossierAddition: 'add citable evidence references to the dossier',
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
    const readinessText = String(params.decisionReadiness || '').toLowerCase();
    const blockedByDecision =
      /block|blocked|gesperrt|offen|not.ready|not_ready|unready|unklar|unclear/.test(readinessText);
    const status = blockedByDecision
      ? 'blocked_for_decision'
      : !params.sourceRef || !params.sourceType
        ? 'needs_source_identity'
        : !params.classification
          ? 'needs_classification'
          : !params.financialImpact && !params.assetImpact && !params.budgetRef && !params.riskRef
            ? 'needs_impact_context'
            : !params.ownerRole
              ? 'needs_owner_role'
              : !params.decisionReadiness
                ? 'needs_decision_readiness'
                : !params.blockedDecisionId
                  ? 'needs_blocked_decision'
                  : !params.nextAction
                    ? 'needs_next_action'
                    : !params.sourceSnapshot || evidenceRefs.length === 0
                      ? 'needs_source_evidence'
                      : missingEvidence.length === 0
                        ? 'ready_for_handover'
                        : 'needs_translation_evidence';
    const readinessScore = Number((evidenceItems.length / evidenceSpecs.length).toFixed(2));
    const positiveFollowUps = missingEvidence.map((item) => ({
      missingDataPoint: item.missingDataPoint,
      enablesDossierAddition: item.enablesDossierAddition,
      category: 'investment_risk_translation_status',
    }));
    const blockingFindings = missingEvidence.map((item) => ({
      code: `IRTS_${String(item.missingDataPoint).toUpperCase()}_MISSING`,
      severity: [
        'source_identity',
        'classification',
        'decision_readiness',
        'blocked_decision',
      ].includes(item.missingDataPoint)
        ? 'high'
        : 'medium',
      message: item.enablesDossierAddition,
    }));
    if (blockedByDecision) {
      blockingFindings.push({
        code: 'IRTS_DECISION_READINESS_BLOCKING',
        severity: 'high',
        message: 'decision readiness is explicitly blocking the investment/risk handover',
      });
    }
    const translationContext = {
      sourceRef: params.sourceRef || null,
      sourceType: params.sourceType || null,
      period: params.period || null,
      division: params.division || null,
      classification: params.classification || null,
    };
    const handoverContext = {
      financialImpact: params.financialImpact || null,
      assetImpact: params.assetImpact || null,
      budgetRef: params.budgetRef || null,
      riskRef: params.riskRef || null,
      ownerRole: params.ownerRole || null,
      decisionReadiness: params.decisionReadiness || null,
      blockedDecisionId: params.blockedDecisionId || null,
      nextAction: params.nextAction || null,
    };
    const dossierFacts = [
      `Status: ${status}`,
      `Provided translation evidence: ${evidenceItems.length}/${evidenceSpecs.length}`,
      `Open gaps: ${missingEvidence.length}`,
    ];
    if (params.sourceRef) dossierFacts.push(`Source: ${params.sourceRef}`);
    if (params.classification) dossierFacts.push(`Classification: ${params.classification}`);
    if (params.ownerRole) dossierFacts.push(`Owner: ${params.ownerRole}`);
    if (params.blockedDecisionId)
      dossierFacts.push(`Blocked decision: ${params.blockedDecisionId}`);

    return {
      translationStatusId: `irts:${Buffer.from(
        `${params.sourceRef || ''}:${params.sourceType || ''}:${params.period || ''}:${params.classification || ''}`
      )
        .toString('base64url')
        .slice(0, 24)}`,
      capabilityKey: 'investment_risk_translation_status',
      safety: 'read_only',
      requestContext: {
        sourceRef: params.sourceRef || null,
        sourceType: params.sourceType || null,
        period: params.period || null,
        division: params.division || null,
      },
      status,
      readinessScore,
      translationContext,
      handoverContext,
      evidenceItems,
      missingEvidence,
      positiveFollowUps,
      blockingFindings,
      sourceEvidence: {
        translationContext,
        handoverContext,
        sourceSnapshot: params.sourceSnapshot || null,
        evidenceRefs,
        forbiddenAssumptions,
      },
      evidenceRefs,
      sourceActions: {
        inspected: ['dashboard-api.investmentRiskTranslationStatus'],
        referenced: [
          'vdmi.create',
          'vdmi-evidence.inject',
          'vdmi-findings.list',
          'finance-agent.analyze',
          'investment-planning.createPlan',
          'hitl.create',
          'presentation.generate',
        ],
        notCalled: [
          'vdmi.create',
          'vdmi-evidence.inject',
          'finance-agent.analyze',
          'investment-planning.createPlan',
          'investment-planning.mutate',
          'hitl.create',
          'sap.psp.write',
          'sap.budget.write',
          'finance-agent.mutate',
          'settlement.exportA96',
          'settlement.prepareBilling',
          'billing.release',
          'mako.dispatch',
          'external.connector.call',
          'personal-agent.execute',
        ],
      },
      validationFindings: blockingFindings,
      dossierEvidence: {
        status,
        readinessScore,
        translationContext,
        handoverContext,
        evidenceItems,
        missingEvidence,
        positiveFollowUps,
        blockingFindings,
        sourceSnapshot: params.sourceSnapshot || null,
        evidenceRefs,
        forbiddenAssumptions,
        dossierFacts,
      },
    };
  },

  buildBudgetWaterfallGovernanceStatus(params = {}) {
    const toList = (value) =>
      Array.isArray(value)
        ? value.filter(Boolean)
        : value
          ? String(value)
              .split(',')
              .map((item) => item.trim())
              .filter(Boolean)
          : [];
    const evidenceRefs = toList(params.evidenceRef);
    const evidenceSpecs = [
      {
        id: 'source_identity',
        label: 'Waterfall/source identity',
        value: params.waterfallId || params.sourceId,
        displayValue: params.waterfallId || params.sourceId,
        sourceClass: 'waterfall_source',
        enablesDossierAddition: 'add the budget-waterfall source identity',
      },
      {
        id: 'period_division',
        label: 'Period and division',
        value: params.period && params.division,
        displayValue: [params.period, params.division].filter(Boolean).join(' / '),
        sourceClass: 'waterfall_scope',
        enablesDossierAddition: 'add the period and division scope for the waterfall claim',
      },
      {
        id: 'baseline_reference',
        label: 'Baseline reference',
        value: params.baselineRef,
        sourceClass: 'baseline',
        enablesDossierAddition: 'explain which approved baseline the waterfall compares against',
      },
      {
        id: 'forecast_cutoff',
        label: 'Forecast cutoff',
        value: params.forecastCutoff,
        sourceClass: 'forecast_cutoff',
        enablesDossierAddition:
          'state the forecast end date used for committee-ready budget wording',
      },
      {
        id: 'carryover_logic',
        label: 'Carry-over logic',
        value: params.carryoverLogic,
        sourceClass: 'carryover',
        enablesDossierAddition: 'explain how budget overhangs are carried into the next view',
      },
      {
        id: 'sign_convention',
        label: 'Sign convention',
        value: params.signConvention,
        sourceClass: 'sign_convention',
        enablesDossierAddition:
          'explain whether the visible waterfall movement increases or reduces budget headroom',
      },
      {
        id: 'owner_role',
        label: 'Owner role',
        value: params.ownerRole,
        sourceClass: 'governance_owner',
        enablesDossierAddition: 'add the accountable owner for baseline/sign/cutoff validation',
      },
      {
        id: 'approval_status',
        label: 'Approval status',
        value: params.approvalStatus,
        sourceClass: 'committee_approval',
        enablesDossierAddition: 'add committee-readiness wording for the waterfall claim',
      },
      {
        id: 'follow_up_decision',
        label: 'Follow-up decision',
        value: params.followUpDecision,
        sourceClass: 'follow_up_decision',
        enablesDossierAddition:
          'name the next management or committee decision enabled by the waterfall',
      },
      {
        id: 'source_snapshot_ref',
        label: 'Source snapshot',
        value: params.sourceSnapshotRef,
        sourceClass: 'source_grounding',
        enablesDossierAddition: 'add source grounding for the waterfall evidence',
      },
      {
        id: 'evidence_ref',
        label: 'Evidence reference',
        value: evidenceRefs.length > 0,
        displayValue: evidenceRefs.join(', '),
        sourceClass: 'evidence_refs',
        enablesDossierAddition: 'add citable evidence references to the dossier',
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
    const approvalText = String(params.approvalStatus || '').toLowerCase();
    const approvalBlocking =
      /block|blocked|rejected|abgelehnt|gesperrt|not.approved|not_approved|unklar|unclear/.test(
        approvalText
      );
    const status = approvalBlocking
      ? 'blocked_by_approval_status'
      : !params.waterfallId && !params.sourceId
        ? 'needs_source_identity'
        : !params.period || !params.division
          ? 'needs_period_division'
          : !params.baselineRef
            ? 'needs_baseline'
            : !params.signConvention
              ? 'needs_sign_convention'
              : !params.forecastCutoff
                ? 'needs_forecast_cutoff'
                : !params.carryoverLogic
                  ? 'needs_carryover_logic'
                  : !params.ownerRole
                    ? 'needs_owner_role'
                    : !params.approvalStatus
                      ? 'needs_approval'
                      : !params.followUpDecision
                        ? 'needs_follow_up_decision'
                        : !params.sourceSnapshotRef || evidenceRefs.length === 0
                          ? 'needs_source_evidence'
                          : missingEvidence.length === 0
                            ? 'ready_for_committee_review'
                            : 'needs_governance_evidence';
    const readinessScore = Number((evidenceItems.length / evidenceSpecs.length).toFixed(2));
    const positiveFollowUps = missingEvidence.map((item) => ({
      missingDataPoint: item.missingDataPoint,
      enablesDossierAddition: item.enablesDossierAddition,
      category: 'budget_waterfall_governance',
    }));
    const blockingFindings = missingEvidence.map((item) => ({
      code: `BWG_${String(item.missingDataPoint).toUpperCase()}_MISSING`,
      severity: [
        'baseline_reference',
        'sign_convention',
        'forecast_cutoff',
        'approval_status',
      ].includes(item.missingDataPoint)
        ? 'high'
        : 'medium',
      message: item.enablesDossierAddition,
    }));
    if (approvalBlocking) {
      blockingFindings.push({
        code: 'BWG_APPROVAL_STATUS_BLOCKING',
        severity: 'high',
        message: 'approval status blocks committee-ready budget-waterfall wording',
      });
    }
    const waterfallContext = {
      waterfallId: params.waterfallId || null,
      sourceId: params.sourceId || null,
      period: params.period || null,
      division: params.division || null,
    };
    const governanceEvidence = {
      baselineRef: params.baselineRef || null,
      forecastCutoff: params.forecastCutoff || null,
      carryoverLogic: params.carryoverLogic || null,
      signConvention: params.signConvention || null,
      ownerRole: params.ownerRole || null,
      approvalStatus: params.approvalStatus || null,
      followUpDecision: params.followUpDecision || null,
      sourceSnapshotRef: params.sourceSnapshotRef || null,
    };
    const dossierFacts = [
      `Status: ${status}`,
      `Provided waterfall governance evidence: ${evidenceItems.length}/${evidenceSpecs.length}`,
      `Open gaps: ${missingEvidence.length}`,
    ];
    if (params.waterfallId || params.sourceId)
      dossierFacts.push(`Waterfall: ${params.waterfallId || params.sourceId}`);
    if (params.baselineRef) dossierFacts.push(`Baseline: ${params.baselineRef}`);
    if (params.signConvention) dossierFacts.push(`Sign convention: ${params.signConvention}`);
    if (params.approvalStatus) dossierFacts.push(`Approval: ${params.approvalStatus}`);

    return {
      governanceStatusId: `bwg:${Buffer.from(
        `${params.waterfallId || params.sourceId || ''}:${params.period || ''}:${params.division || ''}:${params.baselineRef || ''}`
      )
        .toString('base64url')
        .slice(0, 24)}`,
      capabilityKey: 'budget_waterfall_governance',
      safety: 'read_only',
      requestContext: {
        waterfallId: params.waterfallId || null,
        sourceId: params.sourceId || null,
        period: params.period || null,
        division: params.division || null,
      },
      status,
      readinessScore,
      waterfallContext,
      governanceEvidence,
      evidenceItems,
      missingEvidence,
      positiveFollowUps,
      blockingFindings,
      sourceEvidence: {
        waterfallContext,
        governanceEvidence,
        sourceSnapshotRef: params.sourceSnapshotRef || null,
        evidenceRefs,
      },
      evidenceRefs,
      sourceActions: {
        inspected: ['dashboard-api.budgetWaterfallGovernanceStatus'],
        referenced: [
          'datasource-registry.get',
          'datapoint.health',
          'investment-planning.createPlan',
          'finance-agent.analyze',
          'vdmi.dossier',
          'presentation.generate',
        ],
        notCalled: [
          'finance-agent.mutate',
          'sap.psp.write',
          'sap.budget.write',
          'investment-planning.createPlan',
          'investment-planning.mutate',
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
        waterfallContext,
        governanceEvidence,
        evidenceItems,
        missingEvidence,
        positiveFollowUps,
        blockingFindings,
        sourceSnapshotRef: params.sourceSnapshotRef || null,
        evidenceRefs,
        dossierFacts,
      },
    };
  },

  buildGasDecommissioningRoadmapStatus(params = {}) {
    const toList = (value) =>
      Array.isArray(value)
        ? value.filter(Boolean)
        : value
          ? String(value)
              .split(',')
              .map((item) => item.trim())
              .filter(Boolean)
          : [];
    const blockers = toList(params.blocker);
    const evidenceRefs = toList(params.evidenceRef);
    const evidenceSpecs = [
      {
        id: 'roadmap_identity',
        label: 'Roadmap identity',
        value: params.roadmapId,
        sourceClass: 'roadmap_source',
        enablesDossierAddition: 'add the gas decommissioning roadmap identity',
      },
      {
        id: 'current_phase',
        label: 'Current phase',
        value: params.currentPhase,
        sourceClass: 'roadmap_phase',
        enablesDossierAddition: 'state the active roadmap phase for dossier wording',
      },
      {
        id: 'owner',
        label: 'Roadmap owner',
        value: params.owner,
        sourceClass: 'governance_owner',
        enablesDossierAddition: 'add accountable ownership for the roadmap decision',
      },
      {
        id: 'asset_risk_evidence',
        label: 'Asset-risk evidence',
        value: params.assetRiskEvidence,
        sourceClass: 'asset_risk',
        enablesDossierAddition: 'add asset-risk basis and risk-assessment phase confidence',
      },
      {
        id: 'dependency_map',
        label: 'Dependency map',
        value: params.dependencyMap,
        sourceClass: 'dependency_map',
        enablesDossierAddition: 'add blocker/dependency status for roadmap sequencing',
      },
      {
        id: 'investment_impact_ref',
        label: 'Investment-impact reference',
        value: params.investmentImpactRef,
        sourceClass: 'investment_impact',
        enablesDossierAddition: 'add finance/investment handover basis',
      },
      {
        id: 'committee_gate_date',
        label: 'Committee gate date',
        value: params.committeeGateDate,
        sourceClass: 'committee_gate',
        enablesDossierAddition: 'add next decision-gate scheduling evidence',
      },
      {
        id: 'execution_handover_owner',
        label: 'Execution handover owner',
        value: params.executionHandoverOwner,
        sourceClass: 'execution_handover',
        enablesDossierAddition: 'add execution handover ownership',
      },
      {
        id: 'next_decision_gate',
        label: 'Next decision gate',
        value: params.nextDecisionGate,
        sourceClass: 'next_gate',
        enablesDossierAddition: 'name the next management gate unlocked by the roadmap',
      },
      {
        id: 'source_snapshot_ref',
        label: 'Source snapshot',
        value: params.sourceSnapshotRef,
        sourceClass: 'source_grounding',
        enablesDossierAddition: 'add source grounding for the roadmap evidence',
      },
      {
        id: 'evidence_ref',
        label: 'Evidence reference',
        value: evidenceRefs.length > 0,
        displayValue: evidenceRefs.join(', '),
        sourceClass: 'evidence_refs',
        enablesDossierAddition: 'add citable evidence references to the dossier',
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
    const status =
      blockers.length > 0
        ? 'blocked_by_dependencies'
        : !params.roadmapId
          ? 'needs_roadmap_identity'
          : !params.currentPhase
            ? 'needs_current_phase'
            : !params.owner
              ? 'needs_owner'
              : !params.assetRiskEvidence
                ? 'needs_asset_risk_evidence'
                : !params.dependencyMap
                  ? 'needs_dependency_map'
                  : !params.investmentImpactRef
                    ? 'needs_investment_impact'
                    : !params.committeeGateDate
                      ? 'needs_committee_gate'
                      : !params.executionHandoverOwner
                        ? 'needs_execution_handover'
                        : !params.nextDecisionGate
                          ? 'needs_next_gate'
                          : !params.sourceSnapshotRef || evidenceRefs.length === 0
                            ? 'needs_source_evidence'
                            : missingEvidence.length === 0
                              ? 'ready_for_committee_gate'
                              : 'needs_roadmap_evidence';
    const readinessScore = Number((evidenceItems.length / evidenceSpecs.length).toFixed(2));
    const positiveFollowUps = missingEvidence.map((item) => ({
      missingDataPoint: item.missingDataPoint,
      enablesDossierAddition: item.enablesDossierAddition,
      category: 'gas_decommissioning_roadmap_status',
    }));
    const blockingFindings = missingEvidence.map((item) => ({
      code: `GDR_${String(item.missingDataPoint).toUpperCase()}_MISSING`,
      severity: [
        'asset_risk_evidence',
        'dependency_map',
        'investment_impact_ref',
        'committee_gate_date',
        'execution_handover_owner',
      ].includes(item.missingDataPoint)
        ? 'high'
        : 'medium',
      message: item.enablesDossierAddition,
    }));
    if (blockers.length > 0) {
      blockingFindings.push({
        code: 'GDR_DEPENDENCY_BLOCKER_PRESENT',
        severity: 'high',
        message: 'dependency or blocker evidence prevents committee-ready roadmap wording',
      });
    }
    const roadmapContext = {
      roadmapId: params.roadmapId || null,
      currentPhase: params.currentPhase || null,
      owner: params.owner || null,
    };
    const phaseEvidence = {
      assetRiskEvidence: params.assetRiskEvidence || null,
      investmentImpactRef: params.investmentImpactRef || null,
      committeeGateDate: params.committeeGateDate || null,
      executionHandoverOwner: params.executionHandoverOwner || null,
      nextDecisionGate: params.nextDecisionGate || null,
      sourceSnapshotRef: params.sourceSnapshotRef || null,
    };
    const dependencies = {
      dependencyMap: params.dependencyMap || null,
      blockers,
    };
    const phases = [
      {
        id: 'intake',
        label: 'Intake',
        evidenceStatus: params.roadmapId && params.owner ? 'provided' : 'missing',
      },
      {
        id: 'risk-assessment',
        label: 'Risk assessment',
        evidenceStatus: params.assetRiskEvidence ? 'provided' : 'missing',
      },
      {
        id: 'investment-impact',
        label: 'Investment impact',
        evidenceStatus: params.investmentImpactRef ? 'provided' : 'missing',
      },
      {
        id: 'committee-gate',
        label: 'Committee gate',
        evidenceStatus: params.committeeGateDate ? 'provided' : 'missing',
      },
      {
        id: 'execution-handover',
        label: 'Execution handover',
        evidenceStatus: params.executionHandoverOwner ? 'provided' : 'missing',
      },
    ];
    const dossierFacts = [
      `Status: ${status}`,
      `Provided gas roadmap evidence: ${evidenceItems.length}/${evidenceSpecs.length}`,
      `Open gaps: ${missingEvidence.length}`,
    ];
    if (params.roadmapId) dossierFacts.push(`Roadmap: ${params.roadmapId}`);
    if (params.currentPhase) dossierFacts.push(`Current phase: ${params.currentPhase}`);
    if (params.owner) dossierFacts.push(`Owner: ${params.owner}`);
    if (params.nextDecisionGate) dossierFacts.push(`Next gate: ${params.nextDecisionGate}`);

    return {
      roadmapStatusId: `gdr:${Buffer.from(
        `${params.roadmapId || ''}:${params.currentPhase || ''}:${params.owner || ''}:${params.committeeGateDate || ''}`
      )
        .toString('base64url')
        .slice(0, 24)}`,
      capabilityKey: 'gas_decommissioning_roadmap_status',
      safety: 'read_only',
      requestContext: {
        roadmapId: params.roadmapId || null,
        currentPhase: params.currentPhase || null,
        owner: params.owner || null,
      },
      status,
      readinessScore,
      roadmapContext,
      phases,
      phaseEvidence,
      dependencies,
      blockers,
      nextDecisionGate: params.nextDecisionGate || null,
      evidenceItems,
      missingEvidence,
      positiveFollowUps,
      blockingFindings,
      sourceEvidence: {
        roadmapContext,
        phaseEvidence,
        dependencies,
        sourceSnapshotRef: params.sourceSnapshotRef || null,
        evidenceRefs,
      },
      evidenceRefs,
      sourceActions: {
        inspected: ['dashboard-api.gasDecommissioningRoadmapStatus'],
        referenced: [
          'vdmi.dossier',
          'vdmi-evidence.inject',
          'investment-planning.createPlan',
          'finance-agent.analyze',
          'hitl.create',
          'presentation.generate',
        ],
        notCalled: [
          'gas-transformation.createRoadmap',
          'gas-transformation.executeDecommissioning',
          'customer-communication.dispatch',
          'regulatory-assertion.create',
          'finance-agent.mutate',
          'sap.psp.write',
          'sap.budget.write',
          'investment-planning.createPlan',
          'investment-planning.mutate',
          'hitl.create',
          'vdmi.create',
          'settlement.exportA96',
          'settlement.prepareBilling',
          'billing.release',
          'mako.dispatch',
          'external.connector.call',
          'personal-agent.execute',
        ],
      },
      validationFindings: blockingFindings,
      dossierEvidence: {
        status,
        readinessScore,
        roadmapContext,
        phases,
        phaseEvidence,
        dependencies,
        blockers,
        nextDecisionGate: params.nextDecisionGate || null,
        evidenceItems,
        missingEvidence,
        positiveFollowUps,
        blockingFindings,
        sourceSnapshotRef: params.sourceSnapshotRef || null,
        evidenceRefs,
        dossierFacts,
      },
    };
  },

  buildJourFixeDecisionClosureStatus(params = {}) {
    const toList = (value) =>
      Array.isArray(value)
        ? value.filter(Boolean)
        : value
          ? String(value)
              .split(',')
              .map((item) => item.trim())
              .filter(Boolean)
          : [];
    const evidenceRefs = toList(params.evidenceRef);
    const closureStatus = String(params.closureStatus || '')
      .toLowerCase()
      .replace(/\s+/g, '_');
    const isClosedStatus = ['done', 'decided', 'closed', 'erledigt', 'entschieden'].includes(
      closureStatus
    );
    const isEscalated = ['escalated', 'eskaliert'].includes(closureStatus);
    const isCarriedOver = [
      'carried_over',
      'carried-over',
      'uebertragen',
      'übertragen',
      'weitergetragen',
    ].includes(closureStatus);
    const evidenceSpecs = [
      {
        id: 'topic_identity',
        label: 'Topic identity',
        value: params.topicId || params.topicTitle,
        displayValue: params.topicId || params.topicTitle,
        sourceClass: 'topic_identity',
        enablesDossierAddition: 'add the Jour-fixe topic identity and title',
      },
      {
        id: 'jour_fixe_context',
        label: 'Jour-fixe context',
        value: params.jourFixeId,
        sourceClass: 'jour_fixe_context',
        enablesDossierAddition: 'add the recurring Jour-fixe context for this topic',
      },
      {
        id: 'topic_owner',
        label: 'Topic owner',
        value: params.owner,
        sourceClass: 'governance_owner',
        enablesDossierAddition: 'add owner accountability and escalation path',
      },
      {
        id: 'kpi',
        label: 'KPI',
        value: params.kpi,
        sourceClass: 'closure_kpi',
        enablesDossierAddition: 'add KPI-based closure criterion',
      },
      {
        id: 'decision_criterion',
        label: 'Decision criterion',
        value: params.decisionCriterion,
        sourceClass: 'decision_criterion',
        enablesDossierAddition: 'state what decision unlocks closure',
      },
      {
        id: 'next_gate',
        label: 'Next gate',
        value: params.nextGate,
        sourceClass: 'next_gate',
        enablesDossierAddition: 'include the next Jour-fixe or committee gate',
      },
      {
        id: 'closure_status',
        label: 'Closure status',
        value: params.closureStatus,
        sourceClass: 'closure_status',
        enablesDossierAddition: 'add the open/decided/escalated/done/carried-over state',
      },
      {
        id: 'closure_proof',
        label: 'Closure proof',
        value: params.closureProof,
        sourceClass: 'closure_proof',
        enablesDossierAddition: 'mark the topic as done with evidence',
      },
      {
        id: 'blocked_follow_up_action',
        label: 'Blocked follow-up action',
        value: params.blockedFollowUpAction,
        sourceClass: 'blocked_follow_up',
        enablesDossierAddition: 'state the blocked management action and required unblocker',
        optional: true,
      },
      {
        id: 'source_snapshot_ref',
        label: 'Source snapshot',
        value: params.sourceSnapshotRef,
        sourceClass: 'source_grounding',
        enablesDossierAddition: 'add source grounding for the Jour-fixe evidence',
      },
      {
        id: 'evidence_ref',
        label: 'Evidence reference',
        value: evidenceRefs.length > 0,
        displayValue: evidenceRefs.join(', '),
        sourceClass: 'evidence_refs',
        enablesDossierAddition: 'add citable evidence references to the dossier',
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
      .filter((spec) => !spec.value && !spec.optional)
      .map((spec) => ({
        missingDataPoint: spec.id,
        label: spec.label,
        sourceClass: spec.sourceClass,
        enablesDossierAddition: spec.enablesDossierAddition,
      }));
    const status =
      !params.topicId && !params.topicTitle
        ? 'open'
        : !params.owner
          ? 'needs_owner'
          : !params.kpi
            ? 'needs_kpi'
            : !params.decisionCriterion
              ? 'needs_decision_criterion'
              : !params.nextGate
                ? 'needs_next_gate'
                : isEscalated
                  ? 'escalated'
                  : isCarriedOver
                    ? 'carried_over'
                    : isClosedStatus && params.closureProof
                      ? closureStatus === 'decided' || closureStatus === 'entschieden'
                        ? 'decided'
                        : 'done'
                      : isClosedStatus && !params.closureProof
                        ? 'needs_closure_proof'
                        : params.blockedFollowUpAction
                          ? 'escalated'
                          : params.closureStatus
                            ? 'decided'
                            : 'open';
    const requiredEvidenceSpecs = evidenceSpecs.filter((spec) => !spec.optional);
    const requiredEvidenceItems = evidenceItems.filter((item) => {
      const spec = evidenceSpecs.find((candidate) => candidate.id === item.id);
      return !spec?.optional;
    });
    const readinessScore = Number(
      (requiredEvidenceItems.length / requiredEvidenceSpecs.length).toFixed(2)
    );
    const positiveFollowUps = missingEvidence.map((item) => ({
      missingDataPoint: item.missingDataPoint,
      enablesDossierAddition: item.enablesDossierAddition,
      category: 'jour_fixe_decision_closure_tracker',
    }));
    const blockingFindings = missingEvidence.map((item) => ({
      code: `JFD_${String(item.missingDataPoint).toUpperCase()}_MISSING`,
      severity: [
        'topic_owner',
        'kpi',
        'decision_criterion',
        'next_gate',
        'closure_status',
        'closure_proof',
      ].includes(item.missingDataPoint)
        ? 'high'
        : 'medium',
      message: item.enablesDossierAddition,
    }));
    if (params.blockedFollowUpAction) {
      blockingFindings.push({
        code: 'JFD_BLOCKED_FOLLOW_UP_ACTION',
        severity: 'high',
        message: 'blocked follow-up action prevents silent topic closure',
      });
    }
    const topic = {
      topicId: params.topicId || null,
      topicTitle: params.topicTitle || null,
      jourFixeId: params.jourFixeId || null,
    };
    const closureEvidence = {
      owner: params.owner || null,
      kpi: params.kpi || null,
      decisionCriterion: params.decisionCriterion || null,
      nextGate: params.nextGate || null,
      closureStatus: params.closureStatus || null,
      closureProof: params.closureProof || null,
      blockedFollowUpAction: params.blockedFollowUpAction || null,
      sourceSnapshotRef: params.sourceSnapshotRef || null,
    };
    const closureSteps = [
      {
        id: 'topic-intake',
        label: 'Topic intake',
        evidenceStatus: params.topicId || params.topicTitle ? 'provided' : 'missing',
      },
      {
        id: 'owner-kpi-check',
        label: 'Owner and KPI check',
        evidenceStatus: params.owner && params.kpi ? 'provided' : 'missing',
      },
      {
        id: 'decision-criterion-gate',
        label: 'Decision criterion gate',
        evidenceStatus: params.decisionCriterion ? 'provided' : 'missing',
      },
      {
        id: 'closure-or-escalation',
        label: 'Closure or escalation',
        evidenceStatus: params.closureStatus ? 'provided' : 'missing',
      },
      {
        id: 'next-jf-handover',
        label: 'Next Jour-fixe handover',
        evidenceStatus: params.nextGate ? 'provided' : 'missing',
      },
    ];
    const dossierFacts = [
      `Status: ${status}`,
      `Provided Jour-fixe closure evidence: ${requiredEvidenceItems.length}/${requiredEvidenceSpecs.length}`,
      `Open gaps: ${missingEvidence.length}`,
    ];
    if (params.topicId || params.topicTitle)
      dossierFacts.push(`Topic: ${params.topicId || params.topicTitle}`);
    if (params.owner) dossierFacts.push(`Owner: ${params.owner}`);
    if (params.kpi) dossierFacts.push(`KPI: ${params.kpi}`);
    if (params.nextGate) dossierFacts.push(`Next gate: ${params.nextGate}`);

    return {
      closureStatusId: `jfd:${Buffer.from(
        `${params.topicId || params.topicTitle || ''}:${params.jourFixeId || ''}:${params.owner || ''}:${params.nextGate || ''}`
      )
        .toString('base64url')
        .slice(0, 24)}`,
      capabilityKey: 'jour_fixe_decision_closure_tracker',
      safety: 'read_only',
      requestContext: {
        topicId: params.topicId || null,
        topicTitle: params.topicTitle || null,
        jourFixeId: params.jourFixeId || null,
      },
      status,
      readinessScore,
      topic,
      closureEvidence,
      closureSteps,
      evidenceItems,
      missingEvidence,
      positiveFollowUps,
      blockingFindings,
      sourceEvidence: {
        topic,
        closureEvidence,
        sourceSnapshotRef: params.sourceSnapshotRef || null,
        evidenceRefs,
      },
      evidenceRefs,
      sourceActions: {
        inspected: ['dashboard-api.jourFixeDecisionClosureStatus'],
        referenced: [
          'vdmi.dossier',
          'nova.list',
          'hitl.create',
          'vdmi-evidence.inject',
          'presentation.generate',
        ],
        notCalled: [
          'meeting-transcription.ingest',
          'calendar.connector.read',
          'email.connector.read',
          'teams.connector.read',
          'vdmi.create',
          'vdmi.update',
          'nova.createDecision',
          'nova.approve',
          'hitl.create',
          'hitl.resolve',
          'external.connector.call',
          'personal-agent.execute',
        ],
      },
      validationFindings: blockingFindings,
      dossierEvidence: {
        status,
        readinessScore,
        topic,
        closureEvidence,
        closureSteps,
        evidenceItems,
        missingEvidence,
        positiveFollowUps,
        blockingFindings,
        sourceSnapshotRef: params.sourceSnapshotRef || null,
        evidenceRefs,
        dossierFacts,
      },
    };
  },

  buildOffBalancingMeteringPruefmatrixStatus(params = {}) {
    const toList = (value) =>
      Array.isArray(value)
        ? value.filter(Boolean)
        : value
          ? String(value)
              .split(',')
              .map((item) => item.trim())
              .filter(Boolean)
          : [];
    const evidenceRefs = toList(params.evidenceRef);
    const regulatoryEffectEvidence = params.regulatoryEffectEvidence || params.eogEffectEvidence;
    const evidenceSpecs = [
      {
        id: 'metering_scope',
        label: 'Metering scope',
        value: params.meteringScope,
        sourceClass: 'metering_scope',
        enablesDossierAddition: 'add the metering scope and affected meter portfolio',
      },
      {
        id: 'financing_model',
        label: 'Financing model',
        value: params.financingModel,
        sourceClass: 'financing_model',
        enablesDossierAddition: 'add the off-balancing financing model under review',
      },
      {
        id: 'decision_owner',
        label: 'Decision owner',
        value: params.decisionOwner,
        sourceClass: 'governance_owner',
        enablesDossierAddition: 'add accountable Finance/Regulation/Grid decision ownership',
      },
      {
        id: 'committee_gate',
        label: 'Committee gate',
        value: params.committeeGate,
        sourceClass: 'committee_gate',
        enablesDossierAddition: 'add the management or committee gate for the option',
      },
      {
        id: 'capex_opex_baseline',
        label: 'CAPEX/OPEX baseline',
        value: params.capexOpexBaseline,
        sourceClass: 'capex_opex_baseline',
        enablesDossierAddition: 'compare the option against the approved CAPEX/OPEX baseline',
      },
      {
        id: 'eog_regulatory_effect',
        label: 'EOG/regulatory-effect evidence',
        value: regulatoryEffectEvidence,
        sourceClass: 'regulatory_effect',
        enablesDossierAddition: 'add regulatory or EOG-effect plausibility for the option',
      },
      {
        id: 'cost_recognition_assumption',
        label: 'Cost-recognition assumption',
        value: params.costRecognitionAssumption,
        sourceClass: 'cost_recognition',
        enablesDossierAddition:
          'add a recognition-bound decision guard without claiming legal authority',
      },
      {
        id: 'financier_conditions',
        label: 'Financier conditions',
        value: params.financierConditions,
        sourceClass: 'financier_terms',
        enablesDossierAddition: 'add financier-bound risk, covenant and exit-condition assessment',
      },
      {
        id: 'data_quality_status',
        label: 'Data-quality status',
        value: params.dataQualityStatus,
        sourceClass: 'data_quality',
        enablesDossierAddition: 'add metering-data reliability status for decision wording',
      },
      {
        id: 'interface_risk_status',
        label: 'Interface-risk status',
        value: params.interfaceRiskStatus,
        sourceClass: 'interface_risk',
        enablesDossierAddition: 'add integration-risk guard for billing, MaKo and data interfaces',
      },
      {
        id: 'grid_investment_space_proof',
        label: 'Usable grid-investment headroom proof',
        value: params.gridInvestmentSpaceProof,
        sourceClass: 'grid_investment_space',
        enablesDossierAddition:
          'add the verdict whether budget relief creates usable electricity-grid investment headroom',
      },
      {
        id: 'source_snapshot_ref',
        label: 'Source snapshot',
        value: params.sourceSnapshotRef,
        sourceClass: 'source_grounding',
        enablesDossierAddition: 'add source grounding for the pruefmatrix evidence',
      },
      {
        id: 'evidence_ref',
        label: 'Evidence reference',
        value: evidenceRefs.length > 0,
        displayValue: evidenceRefs.join(', '),
        sourceClass: 'evidence_refs',
        enablesDossierAddition: 'add citable evidence references to the dossier',
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
    const gridProofText = String(params.gridInvestmentSpaceProof || '').toLowerCase();
    const apparentReliefUnproven = !!params.financingModel && !params.gridInvestmentSpaceProof;
    const gridProofBlocking =
      /not usable|not_usable|kein nutzbarer|scheininvest|scheinspielraum|unproven|ungeklaert|unklar|blocked/.test(
        gridProofText
      );
    const status = !params.meteringScope
      ? 'needs_metering_scope'
      : !params.financingModel
        ? 'needs_financing_model'
        : !params.financierConditions
          ? 'needs_financier_terms'
          : !regulatoryEffectEvidence
            ? 'needs_regulatory_effect'
            : !params.costRecognitionAssumption
              ? 'needs_cost_recognition'
              : !params.capexOpexBaseline
                ? 'needs_capex_opex_baseline'
                : !params.dataQualityStatus
                  ? 'needs_data_quality'
                  : !params.interfaceRiskStatus
                    ? 'needs_interface_risk'
                    : !params.gridInvestmentSpaceProof
                      ? 'needs_grid_investment_proof'
                      : gridProofBlocking
                        ? 'apparent_relief_not_decision_ready'
                        : !params.decisionOwner
                          ? 'needs_decision_owner'
                          : !params.committeeGate
                            ? 'needs_committee_gate'
                            : !params.sourceSnapshotRef || evidenceRefs.length === 0
                              ? 'needs_source_evidence'
                              : missingEvidence.length === 0
                                ? 'ready_for_committee_review'
                                : 'needs_pruefmatrix_evidence';
    const readinessScore = Number((evidenceItems.length / evidenceSpecs.length).toFixed(2));
    const positiveFollowUps = missingEvidence.map((item) => ({
      missingDataPoint: item.missingDataPoint,
      enablesDossierAddition: item.enablesDossierAddition,
      category: 'off_balancing_metering_pruefmatrix',
    }));
    const blockingFindings = missingEvidence.map((item) => ({
      code: `OBM_${String(item.missingDataPoint).toUpperCase()}_MISSING`,
      severity: [
        'financier_conditions',
        'eog_regulatory_effect',
        'cost_recognition_assumption',
        'grid_investment_space_proof',
        'capex_opex_baseline',
      ].includes(item.missingDataPoint)
        ? 'high'
        : 'medium',
      message: item.enablesDossierAddition,
    }));
    if (apparentReliefUnproven) {
      blockingFindings.push({
        code: 'OBM_APPARENT_RELIEF_UNPROVEN',
        severity: 'high',
        message:
          'claimed budget relief is not decision-ready until usable grid-investment headroom is proven',
      });
    }
    if (gridProofBlocking) {
      blockingFindings.push({
        code: 'OBM_GRID_INVESTMENT_SPACE_BLOCKING',
        severity: 'high',
        message:
          'provided grid-investment-space evidence marks the option as not usable or unresolved',
      });
    }
    const matrixContext = {
      matrixId: params.matrixId || null,
      meteringScope: params.meteringScope || null,
      financingModel: params.financingModel || null,
      decisionOwner: params.decisionOwner || null,
      committeeGate: params.committeeGate || null,
    };
    const financingEvidence = {
      capexOpexBaseline: params.capexOpexBaseline || null,
      regulatoryEffectEvidence: regulatoryEffectEvidence || null,
      costRecognitionAssumption: params.costRecognitionAssumption || null,
      financierConditions: params.financierConditions || null,
    };
    const operationalEvidence = {
      dataQualityStatus: params.dataQualityStatus || null,
      interfaceRiskStatus: params.interfaceRiskStatus || null,
      sourceSnapshotRef: params.sourceSnapshotRef || null,
    };
    const gridInvestmentVerdict = {
      gridInvestmentSpaceProof: params.gridInvestmentSpaceProof || null,
      apparentBudgetRelief: !!params.financingModel,
      usableGridInvestmentHeadroomProven: !!params.gridInvestmentSpaceProof && !gridProofBlocking,
      apparentReliefUnproven,
    };
    const matrixSteps = [
      {
        id: 'scope-and-model',
        label: 'Scope and model',
        evidenceStatus: params.meteringScope && params.financingModel ? 'provided' : 'missing',
      },
      {
        id: 'finance-regulation',
        label: 'Finance and regulation',
        evidenceStatus:
          params.capexOpexBaseline &&
          regulatoryEffectEvidence &&
          params.costRecognitionAssumption &&
          params.financierConditions
            ? 'provided'
            : 'missing',
      },
      {
        id: 'data-interface-risk',
        label: 'Data and interface risk',
        evidenceStatus:
          params.dataQualityStatus && params.interfaceRiskStatus ? 'provided' : 'missing',
      },
      {
        id: 'grid-headroom-verdict',
        label: 'Grid headroom verdict',
        evidenceStatus: params.gridInvestmentSpaceProof ? 'provided' : 'missing',
      },
      {
        id: 'committee-readiness',
        label: 'Committee readiness',
        evidenceStatus: params.decisionOwner && params.committeeGate ? 'provided' : 'missing',
      },
    ];
    const dossierFacts = [
      `Status: ${status}`,
      `Provided off-balancing metering evidence: ${evidenceItems.length}/${evidenceSpecs.length}`,
      `Open gaps: ${missingEvidence.length}`,
    ];
    if (params.matrixId) dossierFacts.push(`Matrix: ${params.matrixId}`);
    if (params.meteringScope) dossierFacts.push(`Metering scope: ${params.meteringScope}`);
    if (params.financingModel) dossierFacts.push(`Financing model: ${params.financingModel}`);
    if (params.gridInvestmentSpaceProof)
      dossierFacts.push(`Grid headroom proof: ${params.gridInvestmentSpaceProof}`);

    return {
      pruefmatrixStatusId: `obm:${Buffer.from(
        `${params.matrixId || ''}:${params.meteringScope || ''}:${params.financingModel || ''}:${params.gridInvestmentSpaceProof || ''}`
      )
        .toString('base64url')
        .slice(0, 24)}`,
      capabilityKey: 'off_balancing_metering_pruefmatrix',
      safety: 'read_only',
      requestContext: {
        matrixId: params.matrixId || null,
        meteringScope: params.meteringScope || null,
        financingModel: params.financingModel || null,
      },
      status,
      readinessScore,
      matrixContext,
      financingEvidence,
      operationalEvidence,
      gridInvestmentVerdict,
      matrixSteps,
      evidenceItems,
      missingEvidence,
      positiveFollowUps,
      blockingFindings,
      sourceEvidence: {
        matrixContext,
        financingEvidence,
        operationalEvidence,
        gridInvestmentVerdict,
        sourceSnapshotRef: params.sourceSnapshotRef || null,
        evidenceRefs,
      },
      evidenceRefs,
      sourceActions: {
        inspected: ['dashboard-api.offBalancingMeteringPruefmatrixStatus'],
        referenced: [
          'finance-agent.analyze',
          'investment-planning.createPlan',
          'eog-calculator.scenario',
          'datapoint.health',
          'datasource-registry.get',
          'vdmi.dossier',
          'presentation.generate',
        ],
        notCalled: [
          'finance-agent.mutate',
          'sap.psp.write',
          'sap.budget.write',
          'investment-planning.createPlan',
          'investment-planning.mutate',
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
        matrixContext,
        financingEvidence,
        operationalEvidence,
        gridInvestmentVerdict,
        matrixSteps,
        evidenceItems,
        missingEvidence,
        positiveFollowUps,
        blockingFindings,
        sourceSnapshotRef: params.sourceSnapshotRef || null,
        evidenceRefs,
        dossierFacts,
      },
    };
  },

  buildAutomationRequirementsDecisionValueStatus(params = {}) {
    const toList = (value) =>
      Array.isArray(value)
        ? value
            .flatMap((item) => String(item || '').split(','))
            .map((item) => item.trim())
            .filter(Boolean)
        : String(value || '')
            .split(',')
            .map((item) => item.trim())
            .filter(Boolean);
    const evidenceRefs = toList(params.evidenceRef);
    const evidenceSpecs = [
      {
        key: 'request_identity',
        label: 'Requirement identity',
        value: params.requirementId || params.requestTitle,
        missingDataPoint: 'request_identity',
        enablesDossierAddition:
          'Anforderungstitel und Karten-ID koennen als pruefbares Steuerungsobjekt referenziert werden',
      },
      {
        key: 'request_type',
        label: 'Request type',
        value: params.requestType,
        missingDataPoint: 'request_type',
        enablesDossierAddition:
          'Der Toolwunsch kann als Dashboard-, Workflow-, Report- oder Automatisierungsanforderung klassifiziert werden',
      },
      {
        key: 'process_area',
        label: 'Process area',
        value: params.processArea,
        missingDataPoint: 'process_area',
        enablesDossierAddition:
          'Der betroffene VNB-/EVU-Prozess kann im Dossier eingegrenzt werden',
      },
      {
        key: 'decision_owner',
        label: 'Decision owner',
        value: params.decisionOwner,
        missingDataPoint: 'decision_owner',
        enablesDossierAddition:
          'Der fachliche Owner fuer Wertentscheidung und Nachhaltung kann benannt werden',
      },
      {
        key: 'target_gate',
        label: 'Target gate',
        value: params.targetGate,
        missingDataPoint: 'target_gate',
        enablesDossierAddition:
          'Das naechste Entscheidungs- oder Review-Gate kann im Dossier sichtbar werden',
      },
      {
        key: 'source_system',
        label: 'Source system',
        value: params.sourceSystem,
        missingDataPoint: 'source_system',
        enablesDossierAddition:
          'Quellsystem-Provenienz und Datenverantwortung koennen belegt werden',
      },
      {
        key: 'moving_data_flow',
        label: 'Moving data flow',
        value: params.movingDataFlow,
        missingDataPoint: 'moving_data_flow',
        enablesDossierAddition:
          'Betroffener Datenfluss und Schnittstellenwirkung koennen beschrieben werden',
      },
      {
        key: 'manual_effort',
        label: 'Manual effort',
        value: params.manualEffort,
        missingDataPoint: 'manual_effort',
        enablesDossierAddition:
          'Manueller Aufwand kann als Baseline fuer Nutzenbewertung ergaenzt werden',
      },
      {
        key: 'control_point',
        label: 'Control point',
        value: params.controlPoint,
        missingDataPoint: 'control_point',
        enablesDossierAddition:
          'Der verbesserte operative Kontrollpunkt kann entscheidungsfaehig benannt werden',
      },
      {
        key: 'decision_value',
        label: 'Decision value',
        value: params.decisionValue,
        missingDataPoint: 'decision_value',
        enablesDossierAddition:
          'Die durch Automation besser moegliche Fachentscheidung kann im Dossier ausgewiesen werden',
      },
      {
        key: 'follow_up_process',
        label: 'Follow-up process',
        value: params.followUpProcess,
        missingDataPoint: 'follow_up_process',
        enablesDossierAddition:
          'Der nachgelagerte Prozess oder Handover kann als Wirkung der Anforderung ergaenzt werden',
      },
      {
        key: 'data_quality',
        label: 'Data quality',
        value: params.dataQuality,
        missingDataPoint: 'data_quality',
        enablesDossierAddition:
          'Datenqualitaet, Confidence und bekannte Grenzen koennen bewertet werden',
      },
      {
        key: 'rollback_or_stop_criterion',
        label: 'Rollback or stop criterion',
        value: params.rollbackOrStopCriterion,
        missingDataPoint: 'rollback_or_stop_criterion',
        enablesDossierAddition:
          'Ein Stop-/Rollback-Kriterium kann nicht hilfreiche Automation begrenzen',
      },
      {
        key: 'source_snapshot_ref',
        label: 'Source snapshot',
        value: params.sourceSnapshotRef,
        missingDataPoint: 'source_snapshot_ref',
        enablesDossierAddition:
          'Ein zitierbarer Snapshot kann als Grundlage der Requirements Card referenziert werden',
      },
      {
        key: 'evidence_ref',
        label: 'Evidence references',
        value: evidenceRefs.length > 0 ? evidenceRefs.join(', ') : null,
        missingDataPoint: 'evidence_ref',
        enablesDossierAddition:
          'Evidenzreferenzen koennen die Requirements Card auditierbar machen',
      },
    ];
    const evidenceItems = evidenceSpecs
      .filter((spec) => spec.value)
      .map((spec) => ({
        id: spec.key,
        label: spec.label,
        value: spec.value,
        evidenceStatus: 'provided',
      }));
    const missingEvidence = evidenceSpecs
      .filter((spec) => !spec.value)
      .map((spec) => ({
        missingDataPoint: spec.missingDataPoint,
        enablesDossierAddition: spec.enablesDossierAddition,
        category: 'automation_requirements_decision_value',
        severity: ['decision_value', 'follow_up_process', 'control_point'].includes(spec.key)
          ? 'high'
          : 'medium',
      }));
    const positiveFollowUps = missingEvidence.map((item) => ({
      category: item.category,
      missingDataPoint: item.missingDataPoint,
      enablesDossierAddition: item.enablesDossierAddition,
    }));
    let status = 'ready_for_requirements_review';
    if (!params.sourceSystem) status = 'needs_source_system';
    else if (!params.movingDataFlow) status = 'needs_moving_data_flow';
    else if (!params.controlPoint) status = 'needs_control_point';
    else if (!params.decisionValue) status = 'needs_decision_value';
    else if (!params.followUpProcess) status = 'needs_follow_up_process';
    else if (!params.dataQuality) status = 'needs_data_quality';
    else if (!params.rollbackOrStopCriterion) status = 'needs_rollback_or_stop_criterion';
    const readinessScore = Number((evidenceItems.length / evidenceSpecs.length).toFixed(2));
    const toolWishWithoutDecisionValue =
      !!params.requestType &&
      /powerbi|power bi|power-?automate|dashboard|workflow|office|report|automation/i.test(
        params.requestType
      ) &&
      (!params.decisionValue || !params.followUpProcess);
    const blockingFindings = [];
    if (toolWishWithoutDecisionValue) {
      blockingFindings.push({
        code: 'ARDV_TOOL_WISH_WITHOUT_DECISION_VALUE',
        severity: 'high',
        message:
          'automation or dashboard wish is not decision-ready without decision value and follow-up process',
      });
    }
    const requirementContext = {
      requirementId: params.requirementId || null,
      requestTitle: params.requestTitle || null,
      requestType: params.requestType || null,
      processArea: params.processArea || null,
      decisionOwner: params.decisionOwner || null,
      targetGate: params.targetGate || null,
    };
    const decisionEvidence = {
      sourceSystem: params.sourceSystem || null,
      movingDataFlow: params.movingDataFlow || null,
      manualEffort: params.manualEffort || null,
      controlPoint: params.controlPoint || null,
      decisionValue: params.decisionValue || null,
      followUpProcess: params.followUpProcess || null,
      dataQuality: params.dataQuality || null,
      rollbackOrStopCriterion: params.rollbackOrStopCriterion || null,
    };
    const decisionSteps = [
      {
        id: 'identity-and-owner',
        label: 'Identity and owner',
        evidenceStatus:
          (params.requirementId || params.requestTitle) && params.decisionOwner
            ? 'provided'
            : 'missing',
      },
      {
        id: 'data-flow',
        label: 'Source system and moving data flow',
        evidenceStatus: params.sourceSystem && params.movingDataFlow ? 'provided' : 'missing',
      },
      {
        id: 'value-control',
        label: 'Decision value and control point',
        evidenceStatus: params.decisionValue && params.controlPoint ? 'provided' : 'missing',
      },
      {
        id: 'process-handover',
        label: 'Follow-up and target gate',
        evidenceStatus: params.followUpProcess && params.targetGate ? 'provided' : 'missing',
      },
      {
        id: 'quality-and-stop',
        label: 'Data quality and rollback guard',
        evidenceStatus:
          params.dataQuality && params.rollbackOrStopCriterion ? 'provided' : 'missing',
      },
    ];
    const dossierFacts = [
      `Status: ${status}`,
      `Provided automation requirement evidence: ${evidenceItems.length}/${evidenceSpecs.length}`,
      `Open gaps: ${missingEvidence.length}`,
    ];
    if (params.requirementId) dossierFacts.push(`Requirement: ${params.requirementId}`);
    if (params.requestType) dossierFacts.push(`Request type: ${params.requestType}`);
    if (params.decisionValue) dossierFacts.push(`Decision value: ${params.decisionValue}`);
    if (params.followUpProcess) dossierFacts.push(`Follow-up process: ${params.followUpProcess}`);

    return {
      decisionValueStatusId: `ardv:${Buffer.from(
        `${params.requirementId || ''}:${params.requestTitle || ''}:${params.decisionValue || ''}:${params.followUpProcess || ''}`
      )
        .toString('base64url')
        .slice(0, 24)}`,
      capabilityKey: 'automation_requirements_decision_value',
      safety: 'read_only',
      requestContext: {
        requirementId: params.requirementId || null,
        requestTitle: params.requestTitle || null,
        requestType: params.requestType || null,
      },
      status,
      readinessScore,
      requirementContext,
      decisionEvidence,
      decisionSteps,
      evidenceItems,
      missingEvidence,
      positiveFollowUps,
      blockingFindings,
      sourceEvidence: {
        requirementContext,
        decisionEvidence,
        sourceSnapshotRef: params.sourceSnapshotRef || null,
        evidenceRefs,
      },
      evidenceRefs,
      sourceActions: {
        inspected: ['dashboard-api.automationRequirementsDecisionValueStatus'],
        referenced: [
          'vdmi.dossier',
          'business-intelligence.describe',
          'datapoint.health',
          'datasource-registry.get',
          'presentation.generate',
        ],
        notCalled: [
          'powerbi.createDashboard',
          'power-automate.createFlow',
          'office.connector.call',
          'mail.send',
          'teams.postMessage',
          'loop.update',
          'workflow.create',
          'ticket.create',
          'hitl.create',
          'vdmi.create',
          'vdmi.update',
          'external.connector.call',
          'personal-agent.execute',
        ],
      },
      validationFindings: blockingFindings,
      dossierEvidence: {
        status,
        readinessScore,
        requirementContext,
        decisionEvidence,
        decisionSteps,
        evidenceItems,
        missingEvidence,
        positiveFollowUps,
        blockingFindings,
        sourceSnapshotRef: params.sourceSnapshotRef || null,
        evidenceRefs,
        dossierFacts,
      },
    };
  },

  buildSmartMeterOffBalancingPurposeLockStatus(params = {}) {
    const toList = (value) =>
      Array.isArray(value)
        ? value
            .flatMap((item) => String(item || '').split(','))
            .map((item) => item.trim())
            .filter(Boolean)
        : String(value || '')
            .split(',')
            .map((item) => item.trim())
            .filter(Boolean);
    const toAmount = (value) => {
      if (value == null || value === '') return null;
      const normalized = Number(String(value).replace(/[^\d.-]/g, ''));
      return Number.isFinite(normalized) ? normalized : String(value);
    };
    const purposeLockedMeasures = toList(params.purposeLockedMeasures);
    const controlRoomInvestments = toList(params.controlRoomInvestments);
    const processInvestments = toList(params.processInvestments);
    const gridInfrastructureInvestments = toList(params.gridInfrastructureInvestments);
    const evidenceRefs = toList(params.evidenceRef);
    const offBalanceVolumeEur = toAmount(params.offBalanceVolumeEur);
    const freedLiquidityEur = toAmount(params.freedLiquidityEur);
    const financierCostEur = toAmount(params.financierCostEur);
    const investmentEffectEvidence =
      controlRoomInvestments.length +
      processInvestments.length +
      gridInfrastructureInvestments.length;
    const evidenceSpecs = [
      {
        key: 'asset_scope',
        label: 'Asset scope',
        value: params.assetScope,
        missingDataPoint: 'asset_scope',
        enablesDossierAddition:
          'Smart-Meter-Assetumfang und betroffene Netz-/Messlokationen koennen abgegrenzt werden',
      },
      {
        key: 'financing_model',
        label: 'Financing model',
        value: params.financingModel,
        missingDataPoint: 'financing_model',
        enablesDossierAddition:
          'Das Off-Balancing-/Finanzierungsmodell kann als Entscheidungsgrundlage sichtbar werden',
      },
      {
        key: 'off_balance_volume_eur',
        label: 'Off-balance volume',
        value: offBalanceVolumeEur,
        missingDataPoint: 'off_balance_volume_eur',
        enablesDossierAddition: 'Das auszulagernde Smart-Meter-Assetvolumen kann beziffert werden',
      },
      {
        key: 'freed_liquidity_eur',
        label: 'Freed liquidity',
        value: freedLiquidityEur,
        missingDataPoint: 'freed_liquidity_eur',
        enablesDossierAddition:
          'Freiwerdende Liquiditaet kann von reiner Bilanzoptik getrennt werden',
      },
      {
        key: 'financier_cost_eur',
        label: 'Financier cost',
        value: financierCostEur,
        missingDataPoint: 'financier_cost_eur',
        enablesDossierAddition:
          'Finanzierer-Kosten koennen gegen den operativen Netzsteuerungsnutzen gestellt werden',
      },
      {
        key: 'capex_opex_totex_effect',
        label: 'CAPEX/OPEX/TOTEX effect',
        value: params.capexOpexTotexEffect,
        missingDataPoint: 'capex_opex_totex_effect',
        enablesDossierAddition: 'CAPEX-/OPEX-/TOTEX-Wirkung kann separat ausgewiesen werden',
      },
      {
        key: 'regulatory_recognition_status',
        label: 'Regulatory recognition',
        value: params.regulatoryRecognitionStatus,
        missingDataPoint: 'regulatory_recognition_status',
        enablesDossierAddition:
          'Regulatorische Anerkennung oder Unsicherheit kann ohne Authority-Claim markiert werden',
      },
      {
        key: 'purpose_locked_measures',
        label: 'Purpose-locked measures',
        value: purposeLockedMeasures.length > 0 ? purposeLockedMeasures.join(', ') : null,
        missingDataPoint: 'purpose_lock_measures_missing',
        enablesDossierAddition:
          'Zweckgebundene Steuerbarkeits-, Leitwarten-, Prozess- oder Infrastrukturmassnahmen koennen belegt werden',
      },
      {
        key: 'investment_effect',
        label: 'Operational investment effect',
        value: investmentEffectEvidence > 0,
        missingDataPoint: 'investment_effect_missing',
        enablesDossierAddition:
          'Der nutzbare operative Investitionseffekt kann mit Leitwarte, Prozess und Infrastruktur verknuepft werden',
      },
      {
        key: 'budget_dilution_risk',
        label: 'Budget dilution risk',
        value: params.budgetDilutionRisk,
        missingDataPoint: 'budget_dilution_risk_open',
        enablesDossierAddition:
          'Risiko einer Budgetverwaesserung kann als Guard gegen Scheinnutzen ausgewiesen werden',
      },
      {
        key: 'finance_review_status',
        label: 'Finance review status',
        value: params.financeReviewStatus,
        missingDataPoint: 'finance_review_missing',
        enablesDossierAddition:
          'Gremien- oder Finance-Review-Status kann committee-ready sichtbar werden',
      },
      {
        key: 'source_snapshot_ref',
        label: 'Source snapshot',
        value: params.sourceSnapshotRef,
        missingDataPoint: 'source_snapshot_ref',
        enablesDossierAddition:
          'Ein zitierbarer Snapshot kann die Purpose-Lock-Bewertung auditierbar machen',
      },
      {
        key: 'evidence_ref',
        label: 'Evidence references',
        value: evidenceRefs.length > 0 ? evidenceRefs.join(', ') : null,
        missingDataPoint: 'evidence_ref',
        enablesDossierAddition: 'Evidenzreferenzen koennen die Purpose-Lock-Matrix absichern',
      },
    ];
    const evidenceItems = evidenceSpecs
      .filter((spec) => spec.value)
      .map((spec) => ({
        id: spec.key,
        label: spec.label,
        value: spec.value,
        evidenceStatus: 'provided',
      }));
    const missingEvidence = evidenceSpecs
      .filter((spec) => !spec.value)
      .map((spec) => ({
        missingDataPoint: spec.missingDataPoint,
        enablesDossierAddition: spec.enablesDossierAddition,
        category: 'smart_meter_off_balancing_purpose_lock',
        severity: [
          'purpose_lock_measures_missing',
          'investment_effect_missing',
          'budget_dilution_risk_open',
          'finance_review_missing',
        ].includes(spec.missingDataPoint)
          ? 'high'
          : 'medium',
      }));
    const dilutionText = String(params.budgetDilutionRisk || '').toLowerCase();
    const dilutionBlocking =
      /high|hoch|open|offen|unresolved|ungeloest|budgetverwaesser|dilution/.test(dilutionText) &&
      !/low|niedrig|resolved|geschlossen|protected|locked|none|kein/.test(dilutionText);
    let status = 'ready_for_committee_review';
    if (!params.assetScope) status = 'needs_asset_scope';
    else if (!params.financingModel) status = 'needs_financing_model';
    else if (!freedLiquidityEur || !offBalanceVolumeEur) status = 'needs_liquidity_evidence';
    else if (purposeLockedMeasures.length === 0) status = 'needs_purpose_lock';
    else if (!params.regulatoryRecognitionStatus) status = 'needs_regulatory_evidence';
    else if (!params.financeReviewStatus) status = 'needs_finance_review';
    else if (dilutionBlocking) status = 'budget_dilution_risk';
    else if (investmentEffectEvidence === 0) status = 'needs_investment_effect';
    else if (!params.capexOpexTotexEffect || !financierCostEur)
      status = 'needs_finance_effect_evidence';
    else if (!params.sourceSnapshotRef || evidenceRefs.length === 0)
      status = 'needs_source_evidence';
    const readinessScore = Number((evidenceItems.length / evidenceSpecs.length).toFixed(2));
    const positiveFollowUps = missingEvidence.map((item) => ({
      category: item.category,
      missingDataPoint: item.missingDataPoint,
      enablesDossierAddition: item.enablesDossierAddition,
    }));
    const blockingFindings = missingEvidence.map((item) => ({
      code: `SMOPL_${String(item.missingDataPoint).toUpperCase()}`,
      severity: item.severity,
      message: item.enablesDossierAddition,
    }));
    if (dilutionBlocking) {
      blockingFindings.push({
        code: 'SMOPL_BUDGET_DILUTION_RISK',
        severity: 'high',
        message: 'freed liquidity is not committee-ready while budget dilution risk remains open',
      });
    }
    const purposeLockContext = {
      caseId: params.caseId || null,
      gridOperatorId: params.gridOperatorId || null,
      assetScope: params.assetScope || null,
      financingModel: params.financingModel || null,
    };
    const financeSummary = {
      offBalanceVolumeEur,
      freedLiquidityEur,
      financierCostEur,
      capexOpexTotexEffect: params.capexOpexTotexEffect || null,
      regulatoryRecognitionStatus: params.regulatoryRecognitionStatus || null,
      financeReviewStatus: params.financeReviewStatus || null,
    };
    const purposeLockCoverage = {
      purposeLockedMeasures,
      controlRoomInvestments,
      processInvestments,
      gridInfrastructureInvestments,
      purposeLockEvidenced: purposeLockedMeasures.length > 0,
      operationalInvestmentEffectEvidenced: investmentEffectEvidence > 0,
    };
    const investmentEffect = {
      controlRoomInvestments,
      processInvestments,
      gridInfrastructureInvestments,
      usableOperationalInvestmentEffect: investmentEffectEvidence > 0,
    };
    const purposeLockSteps = [
      {
        id: 'scope-and-model',
        label: 'Asset scope and financing model',
        evidenceStatus: params.assetScope && params.financingModel ? 'provided' : 'missing',
      },
      {
        id: 'liquidity-and-cost',
        label: 'Freed liquidity and financier cost',
        evidenceStatus:
          offBalanceVolumeEur && freedLiquidityEur && financierCostEur ? 'provided' : 'missing',
      },
      {
        id: 'purpose-lock',
        label: 'Purpose-locked measures',
        evidenceStatus: purposeLockedMeasures.length > 0 ? 'provided' : 'missing',
      },
      {
        id: 'investment-effect',
        label: 'Operational investment effect',
        evidenceStatus: investmentEffectEvidence > 0 ? 'provided' : 'missing',
      },
      {
        id: 'regulatory-finance-review',
        label: 'Regulatory and finance review',
        evidenceStatus:
          params.regulatoryRecognitionStatus && params.financeReviewStatus ? 'provided' : 'missing',
      },
      {
        id: 'anti-dilution',
        label: 'Budget dilution guard',
        evidenceStatus: params.budgetDilutionRisk && !dilutionBlocking ? 'provided' : 'missing',
      },
    ];
    const dossierFacts = [
      `Status: ${status}`,
      `Provided purpose-lock evidence: ${evidenceItems.length}/${evidenceSpecs.length}`,
      `Open gaps: ${missingEvidence.length}`,
    ];
    if (params.caseId) dossierFacts.push(`Case: ${params.caseId}`);
    if (params.assetScope) dossierFacts.push(`Asset scope: ${params.assetScope}`);
    if (params.financingModel) dossierFacts.push(`Financing model: ${params.financingModel}`);
    if (purposeLockedMeasures.length > 0)
      dossierFacts.push(`Purpose-locked measures: ${purposeLockedMeasures.length}`);

    return {
      purposeLockStatusId: `smopl:${Buffer.from(
        `${params.caseId || ''}:${params.assetScope || ''}:${params.financingModel || ''}:${params.financeReviewStatus || ''}`
      )
        .toString('base64url')
        .slice(0, 24)}`,
      capabilityKey: 'smart_meter_off_balancing_purpose_lock',
      safety: 'read_only',
      requestContext: purposeLockContext,
      status,
      readinessScore,
      purposeLockContext,
      financeSummary,
      purposeLockCoverage,
      investmentEffectEvidence: investmentEffect,
      budgetDilutionRisk: {
        status: params.budgetDilutionRisk || null,
        blocking: dilutionBlocking,
      },
      purposeLockSteps,
      evidenceItems,
      missingEvidence,
      positiveFollowUps,
      blockingFindings,
      sourceEvidence: {
        purposeLockContext,
        financeSummary,
        purposeLockCoverage,
        investmentEffectEvidence: investmentEffect,
        sourceSnapshotRef: params.sourceSnapshotRef || null,
        evidenceRefs,
      },
      evidenceRefs,
      sourceActions: {
        inspected: ['dashboard-api.smartMeterOffBalancingPurposeLockStatus'],
        referenced: [
          'finance-agent.analyze',
          'investment-planning.read',
          'vdmi.dossier',
          'datapoint.health',
          'datasource-registry.get',
          'presentation.generate',
        ],
        notCalled: [
          'finance-agent.mutate',
          'sap.psp.write',
          'sap.budget.write',
          'investment-planning.createPlan',
          'investment-planning.mutate',
          'billing.release',
          'settlement.prepareBilling',
          'settlement.exportA96',
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
        purposeLockContext,
        financeSummary,
        purposeLockCoverage,
        investmentEffectEvidence: investmentEffect,
        budgetDilutionRisk: {
          status: params.budgetDilutionRisk || null,
          blocking: dilutionBlocking,
        },
        purposeLockSteps,
        evidenceItems,
        missingEvidence,
        positiveFollowUps,
        blockingFindings,
        sourceSnapshotRef: params.sourceSnapshotRef || null,
        evidenceRefs,
        dossierFacts,
      },
    };
  },

  buildImsysScheduleValueChainReadinessStatus(params = {}) {
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
    const flexibilityOptions = toList(params.flexibilityOptions);
    const evidenceRefs = toList(params.evidenceRef);
    const evidenceSpecs = [
      {
        key: 'metering_scope',
        label: 'Metering scope',
        value: params.meteringScope,
        missingDataPoint: 'metering_scope',
        enablesDossierAddition:
          'iMSys-/CLS-Messbereich und betroffene Markt-/Netzlokation koennen abgegrenzt werden',
      },
      {
        key: 'source_datapoints',
        label: 'Source datapoints',
        value: sourceDatapoints.length > 0 ? sourceDatapoints.join(', ') : null,
        missingDataPoint: 'source_datapoints',
        enablesDossierAddition:
          'Messdatenquellen, Datenalter und Verfuegbarkeit koennen im Dossier belegt werden',
      },
      {
        key: 'data_quality_status',
        label: 'Data quality status',
        value: params.dataQualityStatus,
        missingDataPoint: 'data_quality_status',
        enablesDossierAddition:
          'Datenqualitaet und Confidence der iMSys-/CLS-Daten koennen bewertet werden',
      },
      {
        key: 'forecast_window',
        label: 'Forecast window',
        value: params.forecastWindow,
        missingDataPoint: 'forecast_window',
        enablesDossierAddition:
          'Prognosefenster und Fahrplanhorizont koennen in die Bewertung aufgenommen werden',
      },
      {
        key: 'congestion_signal',
        label: 'Congestion signal',
        value: params.congestionSignal,
        missingDataPoint: 'congestion_signal',
        enablesDossierAddition:
          'Engpasslogik und Netzbedarf koennen als Ausloeser der Value Chain erklaert werden',
      },
      {
        key: 'asset_scope',
        label: 'Asset scope',
        value: params.assetScope,
        missingDataPoint: 'asset_scope',
        enablesDossierAddition:
          'Betroffene Anlagen, NAP/MeLo oder Flex-Assets koennen der Fahrplankette zugeordnet werden',
      },
      {
        key: 'controllability_status',
        label: 'Controllability status',
        value: params.controllabilityStatus,
        missingDataPoint: 'controllability_status',
        enablesDossierAddition:
          'Fernsteuerbarkeit, Rueckmeldefaehigkeit und Flex-Status koennen ausgewiesen werden',
      },
      {
        key: 'flexibility_options',
        label: 'Flexibility options',
        value: flexibilityOptions.length > 0 ? flexibilityOptions.join(', ') : null,
        missingDataPoint: 'flexibility_options',
        enablesDossierAddition:
          'Konkrete Flexibilitaetsoptionen koennen als operative Auswahl sichtbar werden',
      },
      {
        key: 'netzfahrplan_assessment_ref',
        label: 'Netzfahrplan assessment',
        value: params.netzfahrplanAssessmentRef,
        missingDataPoint: 'netzfahrplan_assessment_ref',
        enablesDossierAddition:
          'fNAV-/Netzfahrplan-Bewertung und Kapazitaetsentscheidung koennen referenziert werden',
      },
      {
        key: 'operational_decision',
        label: 'Operational decision',
        value: params.operationalDecision,
        missingDataPoint: 'operational_decision',
        enablesDossierAddition:
          'Die naechste Netzbetriebsentscheidung kann als Review-Grenze beschrieben werden',
      },
      {
        key: 'control_readiness',
        label: 'Control readiness',
        value: params.controlReadiness,
        missingDataPoint: 'control_readiness',
        enablesDossierAddition:
          'Leitwarten-/CLS-Uebergabefaehigkeit kann ohne Ausfuehrung bewertet werden',
      },
      {
        key: 'line_owner_role',
        label: 'Line owner role',
        value: params.lineOwnerRole,
        missingDataPoint: 'line_owner_role',
        enablesDossierAddition:
          'Die fachliche Linienverantwortung fuer die Uebergabe kann benannt werden',
      },
      {
        key: 'source_snapshot_ref',
        label: 'Source snapshot',
        value: params.sourceSnapshotRef,
        missingDataPoint: 'source_snapshot_ref',
        enablesDossierAddition:
          'Ein zitierbarer Snapshot kann die Value-Chain-Bewertung auditierbar machen',
      },
      {
        key: 'evidence_ref',
        label: 'Evidence references',
        value: evidenceRefs.length > 0 ? evidenceRefs.join(', ') : null,
        missingDataPoint: 'evidence_ref',
        enablesDossierAddition:
          'Evidenzreferenzen koennen die operative Review-Faehigkeit absichern',
      },
    ];
    const evidenceItems = evidenceSpecs
      .filter((spec) => spec.value)
      .map((spec) => ({
        id: spec.key,
        label: spec.label,
        value: spec.value,
        evidenceStatus: 'provided',
      }));
    const missingEvidence = evidenceSpecs
      .filter((spec) => !spec.value)
      .map((spec) => ({
        missingDataPoint: spec.missingDataPoint,
        enablesDossierAddition: spec.enablesDossierAddition,
        category: 'imsys_schedule_value_chain_readiness',
        severity: [
          'metering_scope',
          'source_datapoints',
          'forecast_window',
          'controllability_status',
          'control_readiness',
        ].includes(spec.key)
          ? 'high'
          : 'medium',
      }));
    const positiveFollowUps = missingEvidence.map((item) => ({
      category: item.category,
      missingDataPoint: item.missingDataPoint,
      enablesDossierAddition: item.enablesDossierAddition,
    }));
    let status = 'ready_for_operation_review';
    if (!params.meteringScope || sourceDatapoints.length === 0 || !params.dataQualityStatus)
      status = 'needs_metering_evidence';
    else if (!params.forecastWindow) status = 'needs_forecast_context';
    else if (!params.congestionSignal) status = 'needs_congestion_signal';
    else if (!params.assetScope || !params.controllabilityStatus || flexibilityOptions.length === 0)
      status = 'needs_flex_mapping';
    else if (!params.netzfahrplanAssessmentRef || !params.operationalDecision)
      status = 'needs_governance_decision';
    else if (
      !params.controlReadiness ||
      /blocked|not[-_ ]?ready|missing|unready|nein|no/i.test(params.controlReadiness)
    )
      status = 'blocked_by_control_readiness';
    else if (!params.lineOwnerRole) status = 'needs_line_owner';
    const readinessScore = Number((evidenceItems.length / evidenceSpecs.length).toFixed(2));
    const blockingFindings = [];
    if (status === 'blocked_by_control_readiness') {
      blockingFindings.push({
        code: 'IMSYS_CONTROL_READINESS_BLOCKED',
        severity: 'high',
        message:
          'iMSys/CLS value-chain review is blocked until control-room handover readiness is evidenced',
      });
    }
    const valueChainContext = {
      caseId: params.caseId || null,
      gridOperatorId: params.gridOperatorId || null,
      meteringScope: params.meteringScope || null,
    };
    const readinessEvidence = {
      sourceDatapoints,
      dataQualityStatus: params.dataQualityStatus || null,
      forecastWindow: params.forecastWindow || null,
      congestionSignal: params.congestionSignal || null,
      assetScope: params.assetScope || null,
      controllabilityStatus: params.controllabilityStatus || null,
      flexibilityOptions,
      netzfahrplanAssessmentRef: params.netzfahrplanAssessmentRef || null,
      operationalDecision: params.operationalDecision || null,
      controlReadiness: params.controlReadiness || null,
      lineOwnerRole: params.lineOwnerRole || null,
    };
    const valueChainSteps = [
      {
        id: 'metering-data',
        label: 'Metering and datapoint evidence',
        evidenceStatus:
          params.meteringScope && sourceDatapoints.length > 0 && params.dataQualityStatus
            ? 'provided'
            : 'missing',
      },
      {
        id: 'forecast-congestion',
        label: 'Forecast and congestion context',
        evidenceStatus: params.forecastWindow && params.congestionSignal ? 'provided' : 'missing',
      },
      {
        id: 'asset-flex',
        label: 'Asset controllability and flex mapping',
        evidenceStatus:
          params.assetScope && params.controllabilityStatus && flexibilityOptions.length > 0
            ? 'provided'
            : 'missing',
      },
      {
        id: 'fnav-decision',
        label: 'Netzfahrplan and operational decision',
        evidenceStatus:
          params.netzfahrplanAssessmentRef && params.operationalDecision ? 'provided' : 'missing',
      },
      {
        id: 'line-handover',
        label: 'Control-room readiness and line owner',
        evidenceStatus: params.controlReadiness && params.lineOwnerRole ? 'provided' : 'missing',
      },
    ];
    const dossierFacts = [
      `Status: ${status}`,
      `Provided iMSys value-chain evidence: ${evidenceItems.length}/${evidenceSpecs.length}`,
      `Open gaps: ${missingEvidence.length}`,
    ];
    if (params.caseId) dossierFacts.push(`Case: ${params.caseId}`);
    if (params.meteringScope) dossierFacts.push(`Metering scope: ${params.meteringScope}`);
    if (params.operationalDecision)
      dossierFacts.push(`Operational decision: ${params.operationalDecision}`);
    if (params.controlReadiness) dossierFacts.push(`Control readiness: ${params.controlReadiness}`);

    return {
      valueChainReadinessId: `isvc:${Buffer.from(
        `${params.caseId || ''}:${params.meteringScope || ''}:${params.forecastWindow || ''}:${params.assetScope || ''}`
      )
        .toString('base64url')
        .slice(0, 24)}`,
      capabilityKey: 'imsys_schedule_value_chain_readiness',
      safety: 'read_only',
      requestContext: valueChainContext,
      status,
      readinessScore,
      valueChainContext,
      readinessEvidence,
      valueChainSteps,
      evidenceItems,
      missingEvidence,
      positiveFollowUps,
      blockingFindings,
      sourceEvidence: {
        valueChainContext,
        readinessEvidence,
        sourceSnapshotRef: params.sourceSnapshotRef || null,
        evidenceRefs,
      },
      evidenceRefs,
      sourceActions: {
        inspected: ['dashboard-api.imsysScheduleValueChainReadinessStatus'],
        referenced: [
          'datapoint.health',
          'datasource-registry.get',
          'forecast-engine.run',
          'forecast.read',
          'grid-operations.netzfahrplanGenerate',
          'flex.listDevices',
          'mastr-quality.audit',
          'redispatch-expost.audit',
          'vdmi.dossier',
          'presentation.generate',
        ],
        notCalled: [
          'device-control.execute',
          'cls.executeControl',
          'smgw.switch',
          'grid-operations.executeControl',
          'grid-operations.dispatch',
          'hitl.create',
          'mako.dispatch',
          'billing.release',
          'settlement.prepareBilling',
          'settlement.exportA96',
          'external.connector.call',
          'personal-agent.execute',
        ],
      },
      validationFindings: blockingFindings,
      dossierEvidence: {
        status,
        readinessScore,
        valueChainContext,
        readinessEvidence,
        valueChainSteps,
        evidenceItems,
        missingEvidence,
        positiveFollowUps,
        blockingFindings,
        sourceSnapshotRef: params.sourceSnapshotRef || null,
        evidenceRefs,
        dossierFacts,
      },
    };
  },

  buildClsDigitalTwinComplianceGateStatus(params = {}) {
    const toList = (value) =>
      Array.isArray(value)
        ? value
            .flatMap((item) => String(item || '').split(','))
            .map((item) => item.trim())
            .filter(Boolean)
        : String(value || '')
            .split(',')
            .map((item) => item.trim())
            .filter(Boolean);
    const personalDataCategories = toList(params.personalDataCategories);
    const rolesAccessRights = toList(params.rolesAccessRights);
    const rbacRefs = toList(params.rbacRefs);
    const securityEvidenceRefs = toList(params.securityEvidenceRefs);
    const sourceEvidenceRefs = toList(params.sourceEvidenceRefs);
    const evidenceSpecs = [
      [
        'system_purpose',
        'System purpose',
        params.systemPurpose,
        'Systemzweck und Beschaffungsgrenze koennen im Gate-Brief benannt werden',
      ],
      [
        'digital_twin_scope',
        'Digital-twin scope',
        params.digitalTwinScope,
        'Digital-Twin-Scope und betroffene Asset-/Datenobjekte koennen abgegrenzt werden',
      ],
      [
        'cls_interface_scope',
        'CLS interface scope',
        params.clsInterfaceScope,
        'CLS-Schnittstellenumfang kann ohne Steuerungsfreigabe dokumentiert werden',
      ],
      [
        'data_flow_map',
        'Data-flow map',
        params.dataFlowMap,
        'Datenflussrisiken und Systemgrenzen koennen bewertet werden',
      ],
      [
        'personal_data_categories',
        'Personal-data categories',
        personalDataCategories.length ? personalDataCategories.join(', ') : null,
        'Personenbezogene Datenarten koennen fuer Datenschutz-/DSFA-Bewertung sichtbar werden',
      ],
      [
        'roles_access_rights',
        'Roles and access rights',
        rolesAccessRights.length ? rolesAccessRights.join(', ') : null,
        'Rollenrechte und Zugriffspfad koennen als Entscheidungsmatrix aufgenommen werden',
      ],
      [
        'rbac_refs',
        'RBAC refs',
        rbacRefs.length ? rbacRefs.join(', ') : null,
        'RBAC-Nachweise koennen den Rollenrechte-Entscheid belegen',
      ],
      [
        'avv_status',
        'AVV status',
        params.avvStatus,
        'AVV-Status kann als Vertragsnachweis ergaenzt werden',
      ],
      [
        'nda_status',
        'NDA status',
        params.ndaStatus,
        'NDA-/Vertraulichkeitsstatus kann als Vertragsnachweis ergaenzt werden',
      ],
      [
        'works_council_status',
        'Works-council status',
        params.worksCouncilStatus,
        'Betriebsvereinbarungs- oder BR-Bedarf kann als Governance-Grenze sichtbar werden',
      ],
      [
        'dsfa_status',
        'DSFA status',
        params.dsfaStatus,
        'DSFA-Status kann ohne Rechtsfreigabe als Evidenzluecke oder Nachweis erscheinen',
      ],
      [
        'billing_module_impact',
        'Billing/module impact',
        params.billingModuleImpact,
        'Abrechnungs- oder Modulwirkung kann als Review-Grenze dokumentiert werden',
      ],
      [
        'regulatory_evidence_status',
        'Regulatory evidence',
        params.regulatoryEvidenceStatus,
        'BNetzA-/Regulierungsnachweise koennen ohne Authority-Claim referenziert werden',
      ],
      [
        'security_evidence_refs',
        'Security evidence refs',
        securityEvidenceRefs.length ? securityEvidenceRefs.join(', ') : null,
        'IT-Sicherheitsnachweise koennen die CLS-/Digital-Twin-Beschaffung absichern',
      ],
      [
        'source_evidence_refs',
        'Source evidence refs',
        sourceEvidenceRefs.length ? sourceEvidenceRefs.join(', ') : null,
        'Quellenreferenzen koennen den Gate-Status auditierbar machen',
      ],
    ].map(([key, label, value, enablesDossierAddition]) => ({
      key,
      label,
      value,
      missingDataPoint: key,
      enablesDossierAddition,
    }));
    const evidenceItems = evidenceSpecs
      .filter((spec) => spec.value)
      .map((spec) => ({
        id: spec.key,
        label: spec.label,
        value: spec.value,
        evidenceStatus: 'provided',
      }));
    const highGaps = new Set([
      'system_purpose',
      'data_flow_map',
      'roles_access_rights',
      'rbac_refs',
      'avv_status',
      'dsfa_status',
      'regulatory_evidence_status',
      'security_evidence_refs',
    ]);
    const missingEvidence = evidenceSpecs
      .filter((spec) => !spec.value)
      .map((spec) => ({
        missingDataPoint: spec.missingDataPoint,
        enablesDossierAddition: spec.enablesDossierAddition,
        category: 'cls_digital_twin_compliance_gate',
        severity: highGaps.has(spec.missingDataPoint) ? 'high' : 'medium',
      }));
    let status = 'ready_for_procurement_review';
    if (!params.systemPurpose) status = 'needs_system_purpose';
    else if (!params.dataFlowMap) status = 'needs_data_flow_map';
    else if (!rolesAccessRights.length || !rbacRefs.length) status = 'needs_rbac_decision';
    else if (!params.avvStatus || !params.ndaStatus) status = 'needs_contractual_evidence';
    else if (!params.worksCouncilStatus || !params.dsfaStatus) status = 'needs_dsfa';
    else if (!params.billingModuleImpact) status = 'needs_billing_review';
    else if (!params.regulatoryEvidenceStatus || !securityEvidenceRefs.length)
      status = 'needs_regulatory_security_evidence';
    else if (!sourceEvidenceRefs.length) status = 'needs_source_evidence';
    const approvalText = String(params.approvalStatus || '').toLowerCase();
    const blockedByCompliance =
      /blocked|gesperrt|reject|abgelehnt|stop|red|rot|nicht freigegeben|not approved/.test(
        approvalText
      ) && !/not blocked|unblocked|freigegeben|approved|green|gruen|grün/.test(approvalText);
    if (blockedByCompliance) status = 'blocked_by_compliance';
    const readinessScore = Number((evidenceItems.length / evidenceSpecs.length).toFixed(2));
    const positiveFollowUps = missingEvidence.map((item) => ({
      category: item.category,
      missingDataPoint: item.missingDataPoint,
      enablesDossierAddition: item.enablesDossierAddition,
    }));
    const blockingFindings = missingEvidence.map((item) => ({
      code: `CLSDT_${String(item.missingDataPoint).toUpperCase()}`,
      severity: item.severity,
      message: item.enablesDossierAddition,
    }));
    if (blockedByCompliance) {
      blockingFindings.push({
        code: 'CLSDT_BLOCKED_BY_COMPLIANCE',
        severity: 'high',
        message: 'procurement review remains blocked by the supplied compliance approval status',
      });
    }
    const blockedDecisions =
      missingEvidence.length || blockedByCompliance
        ? [
            'vendor_procurement_approval',
            'pilot_start',
            'cls_interface_activation',
            'digital_twin_runtime_use',
          ]
        : [];
    const gateContext = {
      procurementId: params.procurementId || null,
      vendorId: params.vendorId || null,
      systemPurpose: params.systemPurpose || null,
      digitalTwinScope: params.digitalTwinScope || null,
      clsInterfaceScope: params.clsInterfaceScope || null,
    };
    const complianceEvidence = {
      dataFlowMap: params.dataFlowMap || null,
      personalDataCategories,
      rolesAccessRights,
      rbacRefs,
      avvStatus: params.avvStatus || null,
      ndaStatus: params.ndaStatus || null,
      worksCouncilStatus: params.worksCouncilStatus || null,
      dsfaStatus: params.dsfaStatus || null,
      billingModuleImpact: params.billingModuleImpact || null,
      regulatoryEvidenceStatus: params.regulatoryEvidenceStatus || null,
      securityEvidenceRefs,
      approvalStatus: params.approvalStatus || null,
    };
    const decisionSteps = [
      {
        id: 'purpose-and-scope',
        label: 'System purpose and scope',
        evidenceStatus:
          params.systemPurpose && params.digitalTwinScope && params.clsInterfaceScope
            ? 'provided'
            : 'missing',
      },
      {
        id: 'data-flow-map',
        label: 'Data-flow map',
        evidenceStatus: params.dataFlowMap ? 'provided' : 'missing',
      },
      {
        id: 'roles-rbac',
        label: 'Roles and RBAC',
        evidenceStatus: rolesAccessRights.length && rbacRefs.length ? 'provided' : 'missing',
      },
      {
        id: 'contractual-evidence',
        label: 'AVV/NDA evidence',
        evidenceStatus: params.avvStatus && params.ndaStatus ? 'provided' : 'missing',
      },
      {
        id: 'privacy-governance',
        label: 'Works council and DSFA',
        evidenceStatus: params.worksCouncilStatus && params.dsfaStatus ? 'provided' : 'missing',
      },
      {
        id: 'billing-regulatory-security',
        label: 'Billing, regulatory and security evidence',
        evidenceStatus:
          params.billingModuleImpact &&
          params.regulatoryEvidenceStatus &&
          securityEvidenceRefs.length
            ? 'provided'
            : 'missing',
      },
    ];
    const dossierFacts = [
      `Status: ${status}`,
      `Provided CLS compliance evidence: ${evidenceItems.length}/${evidenceSpecs.length}`,
      `Open gaps: ${missingEvidence.length}`,
    ];
    if (params.procurementId) dossierFacts.push(`Procurement: ${params.procurementId}`);
    if (params.vendorId) dossierFacts.push(`Vendor: ${params.vendorId}`);
    if (params.systemPurpose) dossierFacts.push(`System purpose: ${params.systemPurpose}`);

    return {
      complianceGateStatusId: `clsdt:${Buffer.from(
        `${params.procurementId || ''}:${params.vendorId || ''}:${params.systemPurpose || ''}:${params.approvalStatus || ''}`
      )
        .toString('base64url')
        .slice(0, 24)}`,
      capabilityKey: 'cls_digital_twin_compliance_gate',
      safety: 'read_only',
      requestContext: gateContext,
      status,
      readinessScore,
      gateContext,
      complianceEvidence,
      decisionSteps,
      evidenceItems,
      missingEvidence,
      positiveFollowUps,
      blockedDecisions,
      blockingFindings,
      sourceEvidence: {
        gateContext,
        complianceEvidence,
        sourceSnapshot: params.sourceSnapshot || null,
        sourceEvidenceRefs,
      },
      sourceActions: {
        inspected: ['dashboard-api.clsDigitalTwinComplianceGateStatus'],
        referenced: [
          'datasource-registry.get',
          'datapoint.health',
          'vdmi.dossier',
          'interface-placeholder.requestEvidence',
          'finance-agent.analyze',
          'presentation.generate',
        ],
        notCalled: [
          'procurement.approve',
          'legal.approve',
          'dsfa.create',
          'rbac.grant',
          'hitl.create',
          'billing.release',
          'settlement.prepareBilling',
          'settlement.exportA96',
          'mako.dispatch',
          'cls.executeControl',
          'smgw.switch',
          'device-control.execute',
          'external.connector.call',
          'personal-agent.execute',
        ],
      },
      validationFindings: blockingFindings,
      dossierEvidence: {
        status,
        readinessScore,
        gateContext,
        complianceEvidence,
        decisionSteps,
        evidenceItems,
        missingEvidence,
        positiveFollowUps,
        blockedDecisions,
        blockingFindings,
        sourceSnapshot: params.sourceSnapshot || null,
        sourceEvidenceRefs,
        dossierFacts,
      },
    };
  },

  buildLegacyControlTechnologyTransitionStatus(params = {}) {
    const toList = (value) =>
      Array.isArray(value)
        ? value
            .flatMap((item) => String(item || '').split(','))
            .map((item) => item.trim())
            .filter(Boolean)
        : String(value || '')
            .split(',')
            .map((item) => item.trim())
            .filter(Boolean);
    const sourceEvidenceRefs = toList(params.sourceEvidenceRefs);
    const evidenceSpecs = [
      [
        'asset_group_or_asset',
        'Asset group or asset',
        params.assetGroupId || params.assetId,
        'Assetgruppe oder Einzelasset kann dem Uebergangsraster eindeutig zugeordnet werden',
      ],
      [
        'power_class',
        'Power class',
        params.powerClass,
        'Leistungsklasse kann getrennt von der Steuertechnik bewertet werden',
      ],
      [
        'control_technology',
        'Control technology',
        params.controlTechnology,
        'Bestands-Steuertechnik wie Rundsteuertechnik, Gruppensignal oder Steuerbox-Pfad kann benannt werden',
      ],
      [
        'feedback_capability',
        'Feedback capability',
        params.feedbackCapability,
        'Rueckmeldefaehigkeit kann proven control von legacy no-feedback operation trennen',
      ],
      [
        'switching_risk',
        'Switching risk',
        params.switchingRisk,
        'Schaltrisiko kann vor Tests oder Roadmap-Entscheiden sichtbar werden',
      ],
      [
        'test_feasibility',
        'Test feasibility',
        params.testFeasibility,
        'Testbarkeit kann dokumentiert werden, ohne eine Schalthandlung auszufuehren',
      ],
      [
        'test_status',
        'Test status',
        params.testStatus,
        'Teststatus kann eine belegte Steuerbarkeitsaussage oder Luecke begrenzen',
      ],
      [
        'non_execution_reason',
        'Non-execution reason',
        params.nonExecutionReason,
        'Nichtdurchfuehrungsbegruendung kann auditierbar werden, wenn Tests nicht zumutbar sind',
      ],
      [
        'target_technology',
        'Target technology',
        params.targetTechnology,
        'Zieltechnologie fuer Steuerbox, CLS oder Zielprozess kann als Roadmap-Ziel erscheinen',
      ],
      [
        'migration_roadmap',
        'Migration roadmap',
        params.migrationRoadmap,
        'Migrationsfahrplan kann Bestandsbetrieb von Zielprozess trennen',
      ],
      [
        'owner_next_action',
        'Owner and next action',
        params.owner && params.nextAction ? `${params.owner}: ${params.nextAction}` : null,
        'Owner und naechster Schritt koennen als Steuerungsobjekt ergaenzt werden',
      ],
      [
        'source_evidence_refs',
        'Source evidence refs',
        sourceEvidenceRefs.length ? sourceEvidenceRefs.join(', ') : null,
        'Quellenreferenzen koennen den Uebergangsstatus auditierbar machen',
      ],
    ].map(([key, label, value, enablesDossierAddition]) => ({
      key,
      label,
      value,
      missingDataPoint: key,
      enablesDossierAddition,
    }));
    const evidenceItems = evidenceSpecs
      .filter((spec) => spec.value)
      .map((spec) => ({
        id: spec.key,
        label: spec.label,
        value: spec.value,
        evidenceStatus: 'provided',
      }));
    const highGaps = new Set([
      'asset_group_or_asset',
      'control_technology',
      'feedback_capability',
      'test_feasibility',
      'test_status',
      'non_execution_reason',
      'migration_roadmap',
    ]);
    const missingEvidence = evidenceSpecs
      .filter((spec) => !spec.value)
      .map((spec) => ({
        missingDataPoint: spec.missingDataPoint,
        enablesDossierAddition: spec.enablesDossierAddition,
        category: 'legacy_control_technology_transition',
        severity: highGaps.has(spec.missingDataPoint) ? 'high' : 'medium',
      }));
    const text = (value) => String(value || '').toLowerCase();
    const feedbackText = text(params.feedbackCapability);
    const testFeasibilityText = text(params.testFeasibility);
    const testStatusText = text(params.testStatus);
    const roadmapText = text(params.migrationRoadmap);
    const hasFeedback =
      params.feedbackCapability &&
      !/none|keine|no feedback|nicht rueckmelde|nicht rückmelde|unknown|unbekannt/.test(
        feedbackText
      );
    const notTestable = /not.?test|nicht test|unzumutbar|blocked|gesperrt|no test/.test(
      testFeasibilityText
    );
    const tested = /done|tested|geprueft|geprüft|complete|ok|passed|nachweis/.test(testStatusText);
    const roadmapReady =
      params.migrationRoadmap && !/unknown|unbekannt|none|offen/.test(roadmapText);
    let controlReadiness = 'needs_evidence';
    if (!params.controlTechnology || !params.feedbackCapability)
      controlReadiness = 'needs_evidence';
    else if (!hasFeedback)
      controlReadiness = roadmapReady ? 'roadmap_only' : 'not_feedback_capable';
    else if (notTestable)
      controlReadiness = params.nonExecutionReason ? 'not_testable' : 'needs_evidence';
    else if (tested) controlReadiness = 'proven';
    else controlReadiness = 'limited';
    let transitionStatus = 'unknown';
    if (controlReadiness === 'proven' && roadmapReady) transitionStatus = 'target_process_ready';
    else if (roadmapReady && params.owner && params.nextAction)
      transitionStatus = 'migration_planned';
    else if (params.nonExecutionReason && !roadmapReady) transitionStatus = 'migration_blocked';
    else if (params.controlTechnology) transitionStatus = 'legacy_operational';
    let status = 'ready_for_transition_review';
    if (!params.controlTechnology) status = 'needs_control_technology';
    else if (!params.feedbackCapability) status = 'needs_feedback_capability';
    else if (!params.testFeasibility && !params.testStatus) status = 'needs_testability_evidence';
    else if (notTestable && !params.nonExecutionReason) status = 'needs_non_execution_reason';
    else if (!roadmapReady) status = 'needs_migration_roadmap';
    else if (!params.owner || !params.nextAction) status = 'needs_owner_next_action';
    const readinessScore = Number((evidenceItems.length / evidenceSpecs.length).toFixed(2));
    const positiveFollowUps = missingEvidence.map((item) => ({
      category: item.category,
      missingDataPoint: item.missingDataPoint,
      enablesDossierAddition: item.enablesDossierAddition,
    }));
    const blockingFindings = missingEvidence.map((item) => ({
      code: `LCTT_${String(item.missingDataPoint).toUpperCase()}`,
      severity: item.severity,
      message: item.enablesDossierAddition,
    }));
    const blockedDecisions = missingEvidence.length
      ? [
          'steuerbarkeitsnachweis',
          'test_execution_decision',
          'legacy_to_target_transition',
          'control_claim',
        ]
      : [];
    const transitionContext = {
      assetGroupId: params.assetGroupId || null,
      assetId: params.assetId || null,
      gridOperatorId: params.gridOperatorId || null,
      powerClass: params.powerClass || null,
      controlTechnology: params.controlTechnology || null,
    };
    const transitionEvidence = {
      feedbackCapability: params.feedbackCapability || null,
      switchingRisk: params.switchingRisk || null,
      testFeasibility: params.testFeasibility || null,
      testStatus: params.testStatus || null,
      nonExecutionReason: params.nonExecutionReason || null,
      targetTechnology: params.targetTechnology || null,
      migrationRoadmap: params.migrationRoadmap || null,
      owner: params.owner || null,
      nextAction: params.nextAction || null,
    };
    const transitionSteps = [
      {
        id: 'asset-scope',
        label: 'Asset group / power class',
        evidenceStatus:
          (params.assetGroupId || params.assetId) && params.powerClass ? 'provided' : 'missing',
      },
      {
        id: 'legacy-control-technology',
        label: 'Legacy control technology',
        evidenceStatus: params.controlTechnology ? 'provided' : 'missing',
      },
      {
        id: 'feedback-capability',
        label: 'Feedback capability',
        evidenceStatus: params.feedbackCapability ? 'provided' : 'missing',
      },
      {
        id: 'testability',
        label: 'Testability and test status',
        evidenceStatus: params.testFeasibility && params.testStatus ? 'provided' : 'missing',
      },
      {
        id: 'non-execution',
        label: 'Non-execution reason',
        evidenceStatus: params.nonExecutionReason ? 'provided' : 'missing',
      },
      {
        id: 'migration-roadmap',
        label: 'Target technology and roadmap',
        evidenceStatus: params.targetTechnology && params.migrationRoadmap ? 'provided' : 'missing',
      },
      {
        id: 'owner-next-action',
        label: 'Owner and next action',
        evidenceStatus: params.owner && params.nextAction ? 'provided' : 'missing',
      },
    ];
    const dossierFacts = [
      `Status: ${status}`,
      `Control readiness: ${controlReadiness}`,
      `Transition status: ${transitionStatus}`,
      `Provided legacy-control evidence: ${evidenceItems.length}/${evidenceSpecs.length}`,
      `Open gaps: ${missingEvidence.length}`,
    ];
    if (params.assetGroupId) dossierFacts.push(`Asset group: ${params.assetGroupId}`);
    if (params.controlTechnology)
      dossierFacts.push(`Control technology: ${params.controlTechnology}`);
    if (params.migrationRoadmap) dossierFacts.push(`Roadmap: ${params.migrationRoadmap}`);

    return {
      transitionStatusId: `lctt:${Buffer.from(
        `${params.assetGroupId || ''}:${params.assetId || ''}:${params.controlTechnology || ''}:${params.feedbackCapability || ''}`
      )
        .toString('base64url')
        .slice(0, 24)}`,
      capabilityKey: 'legacy_control_technology_transition',
      safety: 'read_only',
      requestContext: transitionContext,
      status,
      controlReadiness,
      transitionStatus,
      readinessScore,
      transitionContext,
      transitionEvidence,
      transitionSteps,
      evidenceItems,
      missingEvidence,
      positiveFollowUps,
      blockedDecisions,
      blockingFindings,
      sourceEvidence: {
        transitionContext,
        transitionEvidence,
        sourceSnapshot: params.sourceSnapshot || null,
        sourceEvidenceRefs,
      },
      sourceActions: {
        inspected: ['dashboard-api.legacyControlTechnologyTransitionStatus'],
        referenced: [
          'assets.effective',
          'grid-operations.controlMeasures',
          'edm-messkonzept.evaluate',
          'datapoint.health',
          'vdmi.dossier',
          'interface-placeholder.requestEvidence',
          'presentation.generate',
        ],
        notCalled: [
          'grid-operations.executeControl',
          'cls.executeControl',
          'smgw.switch',
          'device-control.execute',
          'hitl.create',
          'settlement.prepareBilling',
          'settlement.exportA96',
          'mako.dispatch',
          'billing.release',
          'external.connector.call',
          'personal-agent.execute',
        ],
      },
      validationFindings: blockingFindings,
      dossierEvidence: {
        status,
        controlReadiness,
        transitionStatus,
        readinessScore,
        transitionContext,
        transitionEvidence,
        transitionSteps,
        evidenceItems,
        missingEvidence,
        positiveFollowUps,
        blockedDecisions,
        blockingFindings,
        sourceSnapshot: params.sourceSnapshot || null,
        sourceEvidenceRefs,
        dossierFacts,
      },
    };
  },

  buildControllabilitySubmissionCockpitStatus(params = {}) {
    const toList = (value) =>
      Array.isArray(value)
        ? value
            .flatMap((item) => String(item || '').split(','))
            .map((item) => item.trim())
            .filter(Boolean)
        : String(value || '')
            .split(',')
            .map((item) => item.trim())
            .filter(Boolean);
    const sourceList = toList(params.sourceList);
    const reasonCatalog = toList(params.reasonCatalog);
    const assetGroupStatuses = toList(params.assetGroupStatuses);
    const openMeasures = toList(params.openMeasures);
    const nextCycleTasks = toList(params.nextCycleTasks);
    const deadlineRisks = toList(params.deadlineRisks);
    const sourceEvidenceRefs = toList(params.sourceEvidenceRefs);
    const evidenceSpecs = [
      [
        'submission_identity',
        'Submission identity',
        params.submissionId,
        'Abgabeprojekt kann eindeutig im Dossier referenziert werden',
      ],
      [
        'submission_deadline',
        'Submission deadline',
        params.submissionDeadline,
        'Abgabefrist kann als Steuerungs- und Eskalationsdatum erscheinen',
      ],
      [
        'coordinator',
        'Coordinator',
        params.coordinator,
        'Verantwortlicher Koordinator kann als accountable owner ergaenzt werden',
      ],
      [
        'source_list',
        'Source list',
        sourceList.length ? sourceList.join(', ') : null,
        'Quellenabdeckung und Provenienz koennen in das Dossier aufgenommen werden',
      ],
      [
        'data_reconciliation_status',
        'Data reconciliation status',
        params.dataReconciliationStatus,
        'Abgeglichener Steuerbarkeitscheck-Evidenzstand kann ergaenzt werden',
      ],
      [
        'reason_catalog',
        'Reason catalog',
        reasonCatalog.length ? reasonCatalog.join(', ') : null,
        'Formale Begruendung fuer Nichtdurchfuehrung oder Carry-over kann ergaenzt werden',
      ],
      [
        'asset_group_statuses',
        'Asset group statuses',
        assetGroupStatuses.length ? assetGroupStatuses.join(', ') : null,
        'Assetgruppenbezogene Readiness und Ausnahmen koennen sichtbar werden',
      ],
      [
        'open_measures',
        'Open measures',
        openMeasures.length ? openMeasures.join(', ') : null,
        'Offene Massnahmen, naechste Schritte und Blocker koennen ergaenzt werden',
      ],
      [
        'handover_decision',
        'Handover decision',
        params.handoverDecision,
        'Zyklusabschluss, Carry-over oder Eskalation kann als Entscheidung erscheinen',
      ],
      [
        'handover_owner',
        'Handover owner',
        params.handoverOwner,
        'Owner fuer naechsten Zyklus oder Uebergabe kann ergaenzt werden',
      ],
      [
        'next_cycle_tasks',
        'Next-cycle tasks',
        nextCycleTasks.length ? nextCycleTasks.join(', ') : null,
        'Naechste Zyklusaufgaben koennen als Follow-up-Fakten erscheinen',
      ],
      [
        'source_evidence_refs',
        'Source evidence refs',
        sourceEvidenceRefs.length ? sourceEvidenceRefs.join(', ') : null,
        'Quellenreferenzen koennen die Abgabe revisionsfaehig machen',
      ],
    ].map(([key, label, value, enablesDossierAddition]) => ({
      key,
      label,
      value,
      missingDataPoint: key,
      enablesDossierAddition,
    }));
    const evidenceItems = evidenceSpecs
      .filter((spec) => spec.value)
      .map((spec) => ({
        id: spec.key,
        label: spec.label,
        value: spec.value,
        evidenceStatus: 'provided',
      }));
    const highGaps = new Set([
      'coordinator',
      'source_list',
      'data_reconciliation_status',
      'reason_catalog',
      'asset_group_statuses',
      'handover_decision',
      'handover_owner',
    ]);
    const missingEvidence = evidenceSpecs
      .filter((spec) => !spec.value)
      .map((spec) => ({
        missingDataPoint: spec.missingDataPoint,
        enablesDossierAddition: spec.enablesDossierAddition,
        category: 'controllability_submission_cockpit',
        severity: highGaps.has(spec.missingDataPoint) ? 'high' : 'medium',
      }));
    const lower = (value) => String(value || '').toLowerCase();
    const reconciliationText = lower(params.dataReconciliationStatus);
    const handoverText = lower(params.handoverDecision);
    const blockedByDeadline = deadlineRisks.some((risk) =>
      /blocked|critical|kritisch|overdue|verzug|frist/.test(lower(risk))
    );
    let submissionReadiness = 'ready';
    if (!params.coordinator) submissionReadiness = 'needs_owner';
    else if (!sourceList.length) submissionReadiness = 'needs_sources';
    else if (
      !params.dataReconciliationStatus ||
      /open|missing|unabgeglichen|unknown|unbekannt/.test(reconciliationText)
    )
      submissionReadiness = 'needs_data_reconciliation';
    else if (!reasonCatalog.length) submissionReadiness = 'needs_reasoning';
    else if (!assetGroupStatuses.length) submissionReadiness = 'needs_asset_group_status';
    else if (
      openMeasures.length &&
      !/close|done|submitted|abgabe|carry|handover|approved/.test(handoverText)
    )
      submissionReadiness = 'needs_open_measure_closure';
    else if (!params.handoverDecision || !params.handoverOwner)
      submissionReadiness = 'needs_handover_decision';
    else if (blockedByDeadline) submissionReadiness = 'blocked_by_deadline_risk';
    else if (/submitted|eingereicht|done|closed|abgeschlossen/.test(handoverText))
      submissionReadiness = 'submitted';
    const handoverStatus = params.handoverDecision || null;
    const readinessScore = Number((evidenceItems.length / evidenceSpecs.length).toFixed(2));
    const positiveFollowUps = missingEvidence.map((item) => ({
      category: item.category,
      missingDataPoint: item.missingDataPoint,
      enablesDossierAddition: item.enablesDossierAddition,
    }));
    const blockingFindings = missingEvidence.map((item) => ({
      code: `CSC_${String(item.missingDataPoint).toUpperCase()}`,
      severity: item.severity,
      message: item.enablesDossierAddition,
    }));
    if (blockedByDeadline) {
      blockingFindings.push({
        code: 'CSC_DEADLINE_RISK',
        severity: 'high',
        message: 'Abgabefrist oder Deadline-Risiko blockiert die sichere Zyklusuebergabe',
      });
    }
    const blockedDecisions =
      missingEvidence.length || blockedByDeadline
        ? [
            'submission_release',
            'cycle_closure',
            'handover_to_next_cycle',
            'technical_readiness_claim',
          ]
        : [];
    const submissionContext = {
      submissionId: params.submissionId || null,
      submissionDeadline: params.submissionDeadline || null,
      coordinator: params.coordinator || null,
    };
    const submissionEvidence = {
      sourceList,
      dataReconciliationStatus: params.dataReconciliationStatus || null,
      reasonCatalog,
      assetGroupStatuses,
      openMeasures,
      handoverDecision: params.handoverDecision || null,
      handoverOwner: params.handoverOwner || null,
      nextCycleTasks,
      deadlineRisks,
    };
    const submissionSteps = [
      {
        id: 'coordinator',
        label: 'Coordinator',
        evidenceStatus: params.coordinator ? 'provided' : 'missing',
      },
      {
        id: 'source-list',
        label: 'Source list',
        evidenceStatus: sourceList.length ? 'provided' : 'missing',
      },
      {
        id: 'data-reconciliation',
        label: 'Data reconciliation',
        evidenceStatus: params.dataReconciliationStatus ? 'provided' : 'missing',
      },
      {
        id: 'reason-catalog',
        label: 'Reason catalog',
        evidenceStatus: reasonCatalog.length ? 'provided' : 'missing',
      },
      {
        id: 'asset-group-status',
        label: 'Asset group status',
        evidenceStatus: assetGroupStatuses.length ? 'provided' : 'missing',
      },
      {
        id: 'open-measures',
        label: 'Open measures',
        evidenceStatus: openMeasures.length ? 'provided' : 'missing',
      },
      {
        id: 'handover',
        label: 'Handover decision and owner',
        evidenceStatus: params.handoverDecision && params.handoverOwner ? 'provided' : 'missing',
      },
    ];
    const dossierFacts = [
      `Status: ${submissionReadiness}`,
      `Provided submission evidence: ${evidenceItems.length}/${evidenceSpecs.length}`,
      `Open gaps: ${missingEvidence.length}`,
    ];
    if (params.submissionId) dossierFacts.push(`Submission: ${params.submissionId}`);
    if (params.coordinator) dossierFacts.push(`Coordinator: ${params.coordinator}`);
    if (params.handoverDecision) dossierFacts.push(`Handover: ${params.handoverDecision}`);

    return {
      submissionStatusId: `csc:${Buffer.from(
        `${params.submissionId || ''}:${params.coordinator || ''}:${params.handoverDecision || ''}`
      )
        .toString('base64url')
        .slice(0, 24)}`,
      capabilityKey: 'controllability_submission_cockpit',
      safety: 'read_only',
      requestContext: submissionContext,
      status: submissionReadiness,
      submissionReadiness,
      handoverStatus,
      readinessScore,
      submissionContext,
      submissionEvidence,
      submissionSteps,
      evidenceItems,
      missingEvidence,
      positiveFollowUps,
      blockedDecisions,
      blockingFindings,
      sourceEvidence: {
        submissionContext,
        submissionEvidence,
        sourceSnapshot: params.sourceSnapshot || null,
        sourceEvidenceRefs,
      },
      sourceActions: {
        inspected: ['dashboard-api.controllabilitySubmissionCockpitStatus'],
        referenced: [
          'vdmi.dossier',
          'vdmi.findings',
          'hitl.summary',
          'interface-placeholder.requestEvidence',
          'grid-operations.controlMeasures',
          'edm-validation.validate',
          'datapoint.health',
          'presentation.generate',
        ],
        notCalled: [
          'hitl.create',
          'grid-operations.executeControl',
          'cls.executeControl',
          'smgw.switch',
          'device-control.execute',
          'mako.dispatch',
          'billing.release',
          'settlement.prepareBilling',
          'settlement.exportA96',
          'external.connector.call',
          'personal-agent.execute',
        ],
      },
      validationFindings: blockingFindings,
      dossierEvidence: {
        status: submissionReadiness,
        submissionReadiness,
        handoverStatus,
        readinessScore,
        submissionContext,
        submissionEvidence,
        submissionSteps,
        evidenceItems,
        missingEvidence,
        positiveFollowUps,
        blockedDecisions,
        blockingFindings,
        sourceSnapshot: params.sourceSnapshot || null,
        sourceEvidenceRefs,
        dossierFacts,
      },
    };
  },

  buildCrisisDecisionRoutineStatus(params = {}) {
    const toList = (value) =>
      Array.isArray(value)
        ? value
            .flatMap((item) => String(item || '').split(','))
            .map((item) => item.trim())
            .filter(Boolean)
        : String(value || '')
            .split(',')
            .map((item) => item.trim())
            .filter(Boolean);
    const requiredMeasures = toList(params.requiredMeasures);
    const blockedFollowUp = toList(params.blockedFollowUp);
    const sourceEvidenceRefs = toList(params.sourceEvidenceRefs);
    const trainingOrOperatingModel = [params.trainingNeed, params.operatingModelNeed]
      .filter(Boolean)
      .join(' / ');
    const serviceOrPopulationImpact = [params.serviceImpact, params.populationImpact]
      .filter(Boolean)
      .join(' / ');
    const evidenceSpecs = [
      [
        'topic',
        'Crisis topic',
        params.topic || params.caseId,
        'name the crisis/ad-hoc topic as a stable management object',
      ],
      [
        'service_population_impact',
        'Service or population impact',
        serviceOrPopulationImpact,
        'add service or population-group impact to the management dossier',
      ],
      [
        'required_measures',
        'Required measures',
        requiredMeasures.length ? requiredMeasures.join(', ') : null,
        'add required measures without executing them',
      ],
      [
        'finance_impact',
        'Finance impact',
        params.financeImpact,
        'quantify or qualify finance exposure for prioritisation',
      ],
      [
        'knowledge_state',
        'Knowledge state',
        params.knowledgeState,
        'document known facts, uncertainty and evidence limits',
      ],
      [
        'training_operating_model_need',
        'Training or operating-model need',
        trainingOrOperatingModel,
        'add training or operating-model follow-up need',
      ],
      ['owner', 'Owner', params.owner, 'assign an accountable owner for the routine'],
      ['next_gate', 'Next decision gate', params.nextGate, 'state the next decision gate or date'],
      [
        'blocked_follow_up',
        'Blocked follow-up',
        blockedFollowUp.length ? blockedFollowUp.join(', ') : null,
        'record blocked follow-up decisions without closing them',
      ],
      [
        'source_evidence_refs',
        'Source evidence references',
        sourceEvidenceRefs.length ? sourceEvidenceRefs.join(', ') : null,
        'add citable source references for the routine',
      ],
    ].map(([key, label, value, enablesDossierAddition]) => ({
      key,
      label,
      value,
      missingDataPoint: key,
      enablesDossierAddition,
    }));
    const evidenceItems = evidenceSpecs
      .filter((spec) => spec.value)
      .map((spec) => ({
        id: spec.key,
        label: spec.label,
        value: spec.value,
        evidenceStatus: 'provided',
      }));
    const highGaps = new Set([
      'service_population_impact',
      'finance_impact',
      'knowledge_state',
      'owner',
      'next_gate',
    ]);
    const missingEvidence = evidenceSpecs
      .filter((spec) => !spec.value)
      .map((spec) => ({
        missingDataPoint: spec.missingDataPoint,
        enablesDossierAddition: spec.enablesDossierAddition,
        category: 'crisis_decision_routine',
        severity: highGaps.has(spec.missingDataPoint) ? 'high' : 'medium',
      }));
    const lower = (value) => String(value || '').toLowerCase();
    const knowledgeText = lower(params.knowledgeState);
    const financeText = lower(params.financeImpact);
    const blockedByKnowledge = /unknown|unklar|missing|offen|unbelegt|insufficient|unsicher/.test(
      knowledgeText
    );
    const blockedByFinance = /unknown|unklar|missing|offen|unquantified|nicht quantifiziert/.test(
      financeText
    );
    let decisionReadiness = 'decision_ready';
    if (!params.owner) decisionReadiness = 'needs_owner';
    else if (!serviceOrPopulationImpact) decisionReadiness = 'needs_impact';
    else if (!requiredMeasures.length) decisionReadiness = 'needs_measures';
    else if (!params.financeImpact || blockedByFinance) decisionReadiness = 'needs_finance_impact';
    else if (!params.knowledgeState || blockedByKnowledge)
      decisionReadiness = 'needs_knowledge_state';
    else if (!trainingOrOperatingModel) decisionReadiness = 'needs_training_or_operating_model';
    else if (!params.nextGate) decisionReadiness = 'needs_next_gate';
    else if (!blockedFollowUp.length) decisionReadiness = 'needs_blocked_follow_up';
    const readinessScore = Number((evidenceItems.length / evidenceSpecs.length).toFixed(2));
    const positiveFollowUps = missingEvidence.map((item) => ({
      category: item.category,
      missingDataPoint: item.missingDataPoint,
      enablesDossierAddition: item.enablesDossierAddition,
    }));
    const blockingFindings = missingEvidence.map((item) => ({
      code: `CDR_${String(item.missingDataPoint).toUpperCase()}`,
      severity: item.severity,
      message: item.enablesDossierAddition,
    }));
    if (blockedByKnowledge) {
      blockingFindings.push({
        code: 'CDR_KNOWLEDGE_STATE_UNCERTAIN',
        severity: 'high',
        message: 'knowledge state is explicitly uncertain and blocks a management decision claim',
      });
    }
    if (blockedByFinance) {
      blockingFindings.push({
        code: 'CDR_FINANCE_IMPACT_UNCERTAIN',
        severity: 'high',
        message: 'finance impact is explicitly uncertain and blocks prioritisation wording',
      });
    }
    const blockedDecisions =
      missingEvidence.length || blockedByKnowledge || blockedByFinance
        ? [
            'management_decision',
            'operational_prioritisation',
            'finance_commitment',
            'training_follow_up',
          ]
        : [];
    const routineContext = {
      caseId: params.caseId || null,
      topic: params.topic || null,
      owner: params.owner || null,
      nextGate: params.nextGate || null,
      decisionDeadline: params.decisionDeadline || null,
    };
    const routineEvidence = {
      serviceImpact: params.serviceImpact || null,
      populationImpact: params.populationImpact || null,
      requiredMeasures,
      financeImpact: params.financeImpact || null,
      knowledgeState: params.knowledgeState || null,
      trainingNeed: params.trainingNeed || null,
      operatingModelNeed: params.operatingModelNeed || null,
      blockedFollowUp,
      sourceEvidenceRefs,
      sourceSnapshot: params.sourceSnapshot || null,
    };
    const routineSteps = [
      {
        id: 'impact',
        label: 'Impact statement',
        evidenceStatus: serviceOrPopulationImpact ? 'provided' : 'missing',
      },
      {
        id: 'measures',
        label: 'Required measures',
        evidenceStatus: requiredMeasures.length ? 'provided' : 'missing',
      },
      {
        id: 'finance',
        label: 'Finance impact',
        evidenceStatus: params.financeImpact && !blockedByFinance ? 'provided' : 'missing',
      },
      {
        id: 'knowledge',
        label: 'Knowledge state',
        evidenceStatus: params.knowledgeState && !blockedByKnowledge ? 'provided' : 'missing',
      },
      {
        id: 'training-operating-model',
        label: 'Training or operating model',
        evidenceStatus: trainingOrOperatingModel ? 'provided' : 'missing',
      },
      { id: 'owner', label: 'Owner', evidenceStatus: params.owner ? 'provided' : 'missing' },
      {
        id: 'next-gate',
        label: 'Next decision gate',
        evidenceStatus: params.nextGate ? 'provided' : 'missing',
      },
    ];
    const dossierFacts = [
      `Status: ${decisionReadiness}`,
      `Provided crisis routine evidence: ${evidenceItems.length}/${evidenceSpecs.length}`,
      `Open gaps: ${missingEvidence.length}`,
    ];
    if (params.topic) dossierFacts.push(`Topic: ${params.topic}`);
    if (params.owner) dossierFacts.push(`Owner: ${params.owner}`);
    if (params.nextGate) dossierFacts.push(`Next gate: ${params.nextGate}`);

    return {
      routineStatusId: `cdr:${Buffer.from(
        `${params.caseId || ''}:${params.topic || ''}:${params.owner || ''}:${params.nextGate || ''}`
      )
        .toString('base64url')
        .slice(0, 24)}`,
      capabilityKey: 'crisis_decision_routine',
      safety: 'read_only',
      requestContext: routineContext,
      status: decisionReadiness,
      decisionReadiness,
      readinessScore,
      routineContext,
      routineEvidence,
      routineSteps,
      evidenceItems,
      missingEvidence,
      positiveFollowUps,
      blockedDecisions,
      blockingFindings,
      sourceEvidence: routineEvidence,
      sourceActions: {
        inspected: ['dashboard-api.crisisDecisionRoutineStatus'],
        referenced: [
          'vdmi.dossier',
          'nova.pendingDecisions',
          'hitl.summary',
          'finance-agent.analyze',
          'evidence-registry.lookup',
          'presentation.generate',
        ],
        notCalled: [
          'hitl.create',
          'nova.apply',
          'nova.propose',
          'vdmi.create',
          'vdmi.mutate',
          'finance-agent.mutate',
          'grid-operations.executeControl',
          'operational-dispatch.execute',
          'external.connector.call',
          'personal-agent.execute',
        ],
      },
      validationFindings: blockingFindings,
      dossierEvidence: {
        status: decisionReadiness,
        decisionReadiness,
        readinessScore,
        routineContext,
        routineEvidence,
        routineSteps,
        evidenceItems,
        missingEvidence,
        positiveFollowUps,
        blockedDecisions,
        blockingFindings,
        sourceEvidenceRefs,
        dossierFacts,
      },
    };
  },

  buildInvestmentCommitteeSteeringCardsStatus(params = {}) {
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
    const assetOrProjectRef = params.assetId || params.projectId;
    const evidenceSpecs = [
      {
        id: 'investment_item',
        label: 'Investment item',
        value: params.investmentItemId,
        sourceClass: 'investment_item_identity',
        enablesDossierAddition: 'add the investment item id or card identifier',
      },
      {
        id: 'asset_project_reference',
        label: 'Asset or project reference',
        value: assetOrProjectRef,
        displayValue: [params.assetId, params.projectId].filter(Boolean).join(' / '),
        sourceClass: 'asset_project_reference',
        enablesDossierAddition: 'add asset or project reference for the committee card',
      },
      {
        id: 'review_status',
        label: 'Review status',
        value: params.reviewStatus,
        sourceClass: 'technical_review_status',
        enablesDossierAddition: 'add technical or commercial review status',
      },
      {
        id: 'evidence_status',
        label: 'Evidence status',
        value: params.evidenceStatus,
        sourceClass: 'card_evidence_status',
        enablesDossierAddition: 'add evidence completeness/status for the investment card',
      },
      {
        id: 'committee_window',
        label: 'Committee window',
        value: params.committeeWindow,
        sourceClass: 'committee_window',
        enablesDossierAddition: 'add committee or board decision window',
      },
      {
        id: 'owner',
        label: 'Owner',
        value: params.owner,
        sourceClass: 'accountable_owner',
        enablesDossierAddition: 'add accountable owner for card preparation',
      },
      {
        id: 'blocked_follow_up_action',
        label: 'Blocked follow-up action',
        value: params.blockedFollowUpAction,
        sourceClass: 'blocked_follow_up',
        enablesDossierAddition:
          'add the operational follow-up action blocked until committee review',
      },
      {
        id: 'source_refs',
        label: 'Source references',
        value: sourceRefs.length > 0,
        displayValue: sourceRefs.join(', '),
        sourceClass: 'source_grounding',
        enablesDossierAddition:
          'add citable SharePoint, Excel, VDMI or investment-plan source references',
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
    const reviewText = String(params.reviewStatus || '').toLowerCase();
    const evidenceText = String(params.evidenceStatus || '').toLowerCase();
    const blockedByReview = /block|blocked|gesperrt|rejected|abgelehnt|kritisch|critical/.test(
      reviewText
    );
    const blockedByEvidence =
      /missing|fehlt|unvollstaendig|unvollständig|critical|kritisch|blocked/.test(evidenceText);
    const status = blockedByReview
      ? 'blocked_by_review'
      : blockedByEvidence
        ? 'needs_evidence'
        : !params.investmentItemId
          ? 'needs_investment_item'
          : !assetOrProjectRef
            ? 'needs_asset_project_reference'
            : !params.reviewStatus
              ? 'needs_review_status'
              : !params.evidenceStatus
                ? 'needs_evidence_status'
                : !params.owner
                  ? 'needs_owner'
                  : !params.committeeWindow
                    ? 'needs_committee_window'
                    : !params.blockedFollowUpAction
                      ? 'needs_blocked_follow_up'
                      : sourceRefs.length === 0
                        ? 'needs_source_refs'
                        : missingEvidence.length === 0
                          ? 'ready_for_committee'
                          : 'needs_card_evidence';
    const readinessScore = Number((evidenceItems.length / evidenceSpecs.length).toFixed(2));
    const positiveFollowUps = missingEvidence.map((item) => ({
      missingDataPoint: item.missingDataPoint,
      enablesDossierAddition: item.enablesDossierAddition,
      category: 'investment_committee_steering_cards',
    }));
    const blockedDecisions = Array.from(
      new Set([
        ...missingEvidence
          .filter((item) =>
            [
              'review_status',
              'evidence_status',
              'committee_window',
              'owner',
              'blocked_follow_up_action',
            ].includes(item.missingDataPoint)
          )
          .map((item) => item.label),
        ...(params.blockedFollowUpAction ? [params.blockedFollowUpAction] : []),
      ])
    );
    const blockingFindings = missingEvidence.map((item) => ({
      code: `ICSC_${String(item.missingDataPoint).toUpperCase()}_MISSING`,
      severity: ['review_status', 'evidence_status', 'committee_window', 'owner'].includes(
        item.missingDataPoint
      )
        ? 'high'
        : 'medium',
      message: item.enablesDossierAddition,
    }));
    if (blockedByReview || blockedByEvidence) {
      blockingFindings.push({
        code: blockedByReview ? 'ICSC_REVIEW_STATUS_BLOCKING' : 'ICSC_EVIDENCE_STATUS_BLOCKING',
        severity: 'high',
        message: 'review or evidence status explicitly blocks committee steering readiness',
      });
    }
    const cardContext = {
      investmentItemId: params.investmentItemId || null,
      projectId: params.projectId || null,
      assetId: params.assetId || null,
      capexEur: params.capexEur ?? null,
      riskFlag: params.riskFlag || null,
    };
    const committeeContext = {
      reviewStatus: params.reviewStatus || null,
      evidenceStatus: params.evidenceStatus || null,
      committeeWindow: params.committeeWindow || null,
      owner: params.owner || null,
      blockedFollowUpAction: params.blockedFollowUpAction || null,
    };
    const dossierFacts = [
      `Status: ${status}`,
      `Provided card evidence: ${evidenceItems.length}/${evidenceSpecs.length}`,
      `Open gaps: ${missingEvidence.length}`,
    ];
    if (params.investmentItemId) dossierFacts.push(`Investment Item: ${params.investmentItemId}`);
    if (params.assetId) dossierFacts.push(`Asset: ${params.assetId}`);
    if (params.projectId) dossierFacts.push(`Project: ${params.projectId}`);
    if (params.owner) dossierFacts.push(`Owner: ${params.owner}`);
    if (params.committeeWindow) dossierFacts.push(`Committee Window: ${params.committeeWindow}`);

    return {
      cardStatusId: `icsc:${Buffer.from(
        `${params.investmentItemId || ''}:${params.projectId || ''}:${params.assetId || ''}:${params.committeeWindow || ''}:${params.owner || ''}`
      )
        .toString('base64url')
        .slice(0, 24)}`,
      capabilityKey: 'investment_committee_steering_cards',
      safety: 'read_only',
      requestContext: {
        investmentItemId: params.investmentItemId || null,
        projectId: params.projectId || null,
        assetId: params.assetId || null,
        owner: params.owner || null,
        committeeWindow: params.committeeWindow || null,
      },
      status,
      readinessScore,
      cardContext,
      committeeContext,
      evidenceItems,
      missingEvidence,
      positiveFollowUps,
      blockedDecisions,
      blockingFindings,
      sourceEvidence: {
        sourceRefs,
        capexEur: params.capexEur ?? null,
        riskFlag: params.riskFlag || null,
      },
      sourceRefs,
      sourceActions: {
        inspected: ['dashboard-api.investmentCommitteeSteeringCardsStatus'],
        referenced: [
          'investment-planning.createPlan',
          'vdmi.dossier',
          'hitl.summary',
          'finance-agent.analyze',
          'evidence-registry.lookup',
          'presentation.generate',
        ],
        notCalled: [
          'hitl.create',
          'vdmi.create',
          'vdmi.mutate',
          'investment-planning.createPlan',
          'investment-planning.mutate',
          'finance-agent.mutate',
          'budget.release',
          'billing.release',
          'settlement.prepareBilling',
          'tariff.mutate',
          'payment.execute',
          'external.connector.call',
          'personal-agent.execute',
        ],
      },
      validationFindings: blockingFindings,
      dossierEvidence: {
        status,
        readinessScore,
        cardContext,
        committeeContext,
        evidenceItems,
        missingEvidence,
        positiveFollowUps,
        blockedDecisions,
        blockingFindings,
        sourceRefs,
        dossierFacts,
      },
    };
  },

  buildInvestmentDataReviewQueueStatus(params = {}) {
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
    const sourceOrPackage = params.sourceId || params.dataPackageId;
    const assetOrProjectRef = params.assetRef || params.projectRef;
    const evidenceSpecs = [
      {
        id: 'source_data_package',
        label: 'Source/data package',
        value: sourceOrPackage,
        sourceClass: 'source_provenance',
        enablesDossierAddition:
          'add source provenance and auditability for the investment data package',
      },
      {
        id: 'asset_project_reference',
        label: 'Asset/project reference',
        value: assetOrProjectRef,
        sourceClass: 'asset_management_handover',
        enablesDossierAddition: 'add Assetmanagement handover context',
      },
      {
        id: 'quality_status',
        label: 'Quality status',
        value: params.qualityStatus,
        sourceClass: 'data_quality_basis',
        enablesDossierAddition: 'add review readiness and data-quality basis',
      },
      {
        id: 'division',
        label: 'Division',
        value: params.division,
        sourceClass: 'division_routing',
        enablesDossierAddition: 'add responsible Sparte and routing context',
      },
      {
        id: 'bottleneck_ref',
        label: 'Bottleneck reference',
        value: params.bottleneckRef,
        sourceClass: 'grid_impact_reference',
        enablesDossierAddition: 'add Engpass-/Netzwirkungsbezug',
      },
      {
        id: 'owner',
        label: 'Owner',
        value: params.owner,
        sourceClass: 'accountable_owner',
        enablesDossierAddition: 'add accountable review owner',
      },
      {
        id: 'committee_window',
        label: 'Committee window',
        value: params.committeeWindow,
        sourceClass: 'committee_timing',
        enablesDossierAddition: 'add Gremiensteuerung timing',
      },
      {
        id: 'blocked_decision',
        label: 'Blocked decision',
        value: params.blockedDecision,
        sourceClass: 'blocked_follow_up_decision',
        enablesDossierAddition:
          'add the blocked follow-up decision that can be prepared once evidence is complete',
      },
      {
        id: 'review_status',
        label: 'Review status',
        value: params.reviewStatus,
        sourceClass: 'review_queue_status',
        enablesDossierAddition: 'add the current review queue status',
      },
      {
        id: 'source_refs',
        label: 'Source references',
        value: sourceRefs.length > 0,
        displayValue: sourceRefs.join(', '),
        sourceClass: 'source_grounding',
        enablesDossierAddition:
          'add citable Datasource, Investment Planning, HITL or VDMI references',
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
    const qualityText = String(params.qualityStatus || '').toLowerCase();
    const reviewText = String(params.reviewStatus || '').toLowerCase();
    const blockedByQuality =
      /blocked|blockiert|kritisch|critical|unvollstaendig|unvollständig|missing|fehlt/.test(
        qualityText
      );
    const blockedByReview = /blocked|blockiert|rejected|abgelehnt|kritisch|critical/.test(
      reviewText
    );
    const status = blockedByQuality
      ? 'blocked_by_quality'
      : blockedByReview
        ? 'blocked_by_review'
        : !sourceOrPackage
          ? 'needs_source_data_package'
          : !assetOrProjectRef
            ? 'needs_asset_project_reference'
            : !params.qualityStatus
              ? 'needs_quality_status'
              : !params.division
                ? 'needs_division'
                : !params.bottleneckRef
                  ? 'needs_bottleneck_reference'
                  : !params.owner
                    ? 'needs_owner'
                    : !params.committeeWindow
                      ? 'needs_committee_window'
                      : !params.blockedDecision
                        ? 'needs_blocked_decision'
                        : !params.reviewStatus
                          ? 'needs_review_status'
                          : sourceRefs.length === 0
                            ? 'needs_source_refs'
                            : missingEvidence.length === 0
                              ? 'review_ready'
                              : 'needs_review_evidence';
    const readinessScore = Number((evidenceItems.length / evidenceSpecs.length).toFixed(2));
    const positiveFollowUps = missingEvidence.map((item) => ({
      missingDataPoint: item.missingDataPoint,
      enablesDossierAddition: item.enablesDossierAddition,
      category: 'investment_data_review_queue',
    }));
    const blockedDecisions = Array.from(
      new Set([
        ...missingEvidence
          .filter((item) =>
            [
              'quality_status',
              'owner',
              'committee_window',
              'blocked_decision',
              'review_status',
            ].includes(item.missingDataPoint)
          )
          .map((item) => item.label),
        ...(params.blockedDecision ? [params.blockedDecision] : []),
      ])
    );
    const blockingFindings = missingEvidence.map((item) => ({
      code: `IDRQ_${String(item.missingDataPoint).toUpperCase()}_MISSING`,
      severity: [
        'quality_status',
        'owner',
        'committee_window',
        'blocked_decision',
        'review_status',
      ].includes(item.missingDataPoint)
        ? 'high'
        : 'medium',
      message: item.enablesDossierAddition,
    }));
    if (blockedByQuality || blockedByReview) {
      blockingFindings.push({
        code: blockedByQuality ? 'IDRQ_QUALITY_STATUS_BLOCKING' : 'IDRQ_REVIEW_STATUS_BLOCKING',
        severity: 'high',
        message: 'quality or review status explicitly blocks investment data review readiness',
      });
    }
    const reviewContext = {
      sourceId: params.sourceId || null,
      dataPackageId: params.dataPackageId || null,
      assetRef: params.assetRef || null,
      projectRef: params.projectRef || null,
      qualityStatus: params.qualityStatus || null,
      division: params.division || null,
      bottleneckRef: params.bottleneckRef || null,
      owner: params.owner || null,
      committeeWindow: params.committeeWindow || null,
      blockedDecision: params.blockedDecision || null,
      reviewStatus: params.reviewStatus || null,
    };
    const dossierFacts = [
      `Status: ${status}`,
      `Provided review evidence: ${evidenceItems.length}/${evidenceSpecs.length}`,
      `Open gaps: ${missingEvidence.length}`,
    ];
    if (sourceOrPackage) dossierFacts.push(`Source Package: ${sourceOrPackage}`);
    if (assetOrProjectRef) dossierFacts.push(`Asset/Project: ${assetOrProjectRef}`);
    if (params.owner) dossierFacts.push(`Owner: ${params.owner}`);
    if (params.committeeWindow) dossierFacts.push(`Committee Window: ${params.committeeWindow}`);

    return {
      reviewQueueStatusId: `idrq:${Buffer.from(
        `${sourceOrPackage || ''}:${assetOrProjectRef || ''}:${params.owner || ''}:${params.committeeWindow || ''}`
      )
        .toString('base64url')
        .slice(0, 24)}`,
      capabilityKey: 'investment_data_review_queue',
      safety: 'read_only',
      requestContext: {
        sourceId: params.sourceId || null,
        dataPackageId: params.dataPackageId || null,
        assetRef: params.assetRef || null,
        projectRef: params.projectRef || null,
        owner: params.owner || null,
        committeeWindow: params.committeeWindow || null,
      },
      status,
      readinessScore,
      reviewContext,
      evidenceItems,
      missingEvidence,
      positiveFollowUps,
      blockedDecisions,
      blockingFindings,
      sourceEvidence: {
        sourceRefs,
      },
      sourceRefs,
      sourceActions: {
        inspected: ['dashboard-api.investmentDataReviewQueueStatus'],
        referenced: [
          'datasource-registry.list',
          'datasource-cache.query',
          'investment-planning.createPlan',
          'hitl.summary',
          'vdmi.dossier',
          'evidence-registry.lookup',
          'presentation.generate',
        ],
        notCalled: [
          'hitl.create',
          'vdmi.create',
          'vdmi.mutate',
          'investment-planning.createPlan',
          'investment-planning.mutate',
          'finance-agent.mutate',
          'budget.release',
          'billing.release',
          'settlement.prepareBilling',
          'tariff.mutate',
          'payment.execute',
          'external.connector.call',
          'personal-agent.execute',
        ],
      },
      validationFindings: blockingFindings,
      dossierEvidence: {
        status,
        readinessScore,
        reviewContext,
        evidenceItems,
        missingEvidence,
        positiveFollowUps,
        blockedDecisions,
        blockingFindings,
        sourceRefs,
        dossierFacts,
      },
    };
  },

  buildFlexStrategicDemandIntakeStatus(params = {}) {
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
    const demandTopic = params.demandTopic || params.topic;
    const demandRef = params.demandId || params.caseId;
    const evidenceSpecs = [
      {
        id: 'demand_topic',
        label: 'Demand/topic',
        value: demandTopic,
        sourceClass: 'strategic_need',
        enablesDossierAddition: 'add a clear Flex/Fahrplanmanagement demand statement',
      },
      {
        id: 'affected_process',
        label: 'Affected process',
        value: params.affectedProcess,
        sourceClass: 'process_impact_scope',
        enablesDossierAddition: 'add the impacted process or operating area',
      },
      {
        id: 'risk_of_inaction',
        label: 'Risk of inaction',
        value: params.riskOfInaction,
        sourceClass: 'management_risk',
        enablesDossierAddition: 'add management risk rationale for not acting',
      },
      {
        id: 'commercial_question',
        label: 'Commercial question',
        value: params.commercialQuestion,
        sourceClass: 'commercial_review_need',
        enablesDossierAddition: 'add the commercial review question',
      },
      {
        id: 'resource_conflict',
        label: 'Resource conflict',
        value: params.resourceConflict,
        sourceClass: 'resource_tradeoff',
        enablesDossierAddition: 'add prioritization or resource trade-off',
      },
      {
        id: 'stop_doing_option',
        label: 'Stop-doing option',
        value: params.stopDoingOption,
        sourceClass: 'capacity_release_option',
        enablesDossierAddition: 'add capacity-release or stop-doing alternative',
      },
      {
        id: 'owner',
        label: 'Owner',
        value: params.owner,
        sourceClass: 'accountable_owner',
        enablesDossierAddition: 'add accountable line owner',
      },
      {
        id: 'next_decision_gate',
        label: 'Next decision gate',
        value: params.nextDecisionGate,
        sourceClass: 'decision_calendar',
        enablesDossierAddition: 'add decision calendar or gate readiness',
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
        enablesDossierAddition: 'add citable Flex, ZNP, NOVA, Finance or VDMI references',
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
    const riskText = String(params.riskOfInaction || '').toLowerCase();
    const conflictText = String(params.resourceConflict || '').toLowerCase();
    const blockedByRisk = /blocked|blockiert|kritisch|critical|untragbar|stop/.test(riskText);
    const blockedByResource =
      /blocked|blockiert|keine ressourcen|no resource|critical|kritisch/.test(conflictText);
    const status = blockedByRisk
      ? 'risk_blocks_intake'
      : blockedByResource
        ? 'resource_conflict_blocks_intake'
        : !demandTopic
          ? 'needs_demand_topic'
          : !params.affectedProcess
            ? 'needs_affected_process'
            : !params.riskOfInaction
              ? 'needs_risk_of_inaction'
              : !params.commercialQuestion
                ? 'needs_commercial_question'
                : !params.resourceConflict
                  ? 'needs_resource_conflict'
                  : !params.stopDoingOption
                    ? 'needs_stop_doing_option'
                    : !params.owner
                      ? 'needs_owner'
                      : !params.nextDecisionGate
                        ? 'needs_next_decision_gate'
                        : !params.blockedFollowUp
                          ? 'needs_blocked_follow_up'
                          : sourceRefs.length === 0
                            ? 'needs_source_refs'
                            : missingEvidence.length === 0
                              ? 'ready_for_intake'
                              : 'needs_intake_evidence';
    const readinessScore = Number((evidenceItems.length / evidenceSpecs.length).toFixed(2));
    const positiveFollowUps = missingEvidence.map((item) => ({
      missingDataPoint: item.missingDataPoint,
      enablesDossierAddition: item.enablesDossierAddition,
      category: 'flex_strategic_demand_intake',
    }));
    const blockedDecisions = Array.from(
      new Set([
        ...missingEvidence
          .filter((item) =>
            [
              'owner',
              'next_decision_gate',
              'blocked_follow_up',
              'commercial_question',
              'resource_conflict',
            ].includes(item.missingDataPoint)
          )
          .map((item) => item.label),
        ...(params.blockedFollowUp ? [params.blockedFollowUp] : []),
      ])
    );
    const blockingFindings = missingEvidence.map((item) => ({
      code: `FSDI_${String(item.missingDataPoint).toUpperCase()}_MISSING`,
      severity: ['owner', 'next_decision_gate', 'blocked_follow_up', 'risk_of_inaction'].includes(
        item.missingDataPoint
      )
        ? 'high'
        : 'medium',
      message: item.enablesDossierAddition,
    }));
    if (blockedByRisk || blockedByResource) {
      blockingFindings.push({
        code: blockedByRisk ? 'FSDI_RISK_BLOCKING' : 'FSDI_RESOURCE_CONFLICT_BLOCKING',
        severity: 'high',
        message: 'risk or resource conflict explicitly blocks strategic Flex intake readiness',
      });
    }
    const intakeContext = {
      demandId: demandRef || null,
      demandTopic: demandTopic || null,
      affectedProcess: params.affectedProcess || null,
      owner: params.owner || null,
      nextDecisionGate: params.nextDecisionGate || null,
    };
    const managementContext = {
      riskOfInaction: params.riskOfInaction || null,
      commercialQuestion: params.commercialQuestion || null,
      resourceConflict: params.resourceConflict || null,
      stopDoingOption: params.stopDoingOption || null,
      blockedFollowUp: params.blockedFollowUp || null,
    };
    const contextRefs = {
      flexContext: params.flexContext || null,
      znpContext: params.znpContext || null,
      novaContext: params.novaContext || null,
      financeContext: params.financeContext || null,
      vdmiContext: params.vdmiContext || null,
    };
    const dossierFacts = [
      `Status: ${status}`,
      `Provided intake evidence: ${evidenceItems.length}/${evidenceSpecs.length}`,
      `Open gaps: ${missingEvidence.length}`,
    ];
    if (demandTopic) dossierFacts.push(`Demand: ${demandTopic}`);
    if (params.affectedProcess) dossierFacts.push(`Affected Process: ${params.affectedProcess}`);
    if (params.owner) dossierFacts.push(`Owner: ${params.owner}`);
    if (params.nextDecisionGate) dossierFacts.push(`Next Gate: ${params.nextDecisionGate}`);

    return {
      intakeStatusId: `fsdi:${Buffer.from(
        `${demandRef || ''}:${demandTopic || ''}:${params.owner || ''}:${params.nextDecisionGate || ''}`
      )
        .toString('base64url')
        .slice(0, 24)}`,
      capabilityKey: 'flex_strategic_demand_intake',
      safety: 'read_only',
      requestContext: intakeContext,
      status,
      readinessScore,
      intakeContext,
      managementContext,
      evidenceItems,
      missingEvidence,
      positiveFollowUps,
      blockedDecisions,
      blockingFindings,
      sourceEvidence: {
        sourceRefs,
        contextRefs,
      },
      sourceRefs,
      contextRefs,
      sourceActions: {
        inspected: ['dashboard-api.flexStrategicDemandIntakeStatus'],
        referenced: [
          'flex.status',
          'znp.projects',
          'nova.pendingDecisions',
          'vdmi.dossier',
          'finance-agent.analyze',
          'evidence-registry.lookup',
          'presentation.generate',
        ],
        notCalled: [
          'hitl.create',
          'nova.createDecision',
          'nova.apply',
          'vdmi.create',
          'vdmi.mutate',
          'finance-agent.mutate',
          'tariff.mutate',
          'billing.release',
          'settlement.prepareBilling',
          'grid-operations.executeControl',
          'device-control.execute',
          'external.connector.call',
          'personal-agent.execute',
        ],
      },
      validationFindings: blockingFindings,
      dossierEvidence: {
        status,
        readinessScore,
        intakeContext,
        managementContext,
        evidenceItems,
        missingEvidence,
        positiveFollowUps,
        blockedDecisions,
        blockingFindings,
        sourceRefs,
        contextRefs,
        dossierFacts,
      },
    };
  },
};
