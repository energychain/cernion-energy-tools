'use strict';

// dashboard-api methods chunk 12/14 — extracted verbatim from
// services/dashboard-api.service.js as part of the v0.99 file-size modularization.
// Contains: buildGasCapacityBookingReviewGateStatus, buildGasNetworkDecisionChainStatus, buildWaterPricingNetInvestmentAlignmentStatus, buildArealNetworkIntegrationOfferGateStatus, buildTransformationFinancingScenarioViewStatus, buildInvestmentBudgetCapExceptionGovernanceStatus, buildInvestmentOwnerDeadlineBudgetGateStatus, buildDirectMarketerRiskGateStatus, buildNoRegretMeasureDefinitionGateStatus, buildGasGridTransformationAssetCockpitStatus, buildLiveUpdateStreamContractStatus, unwrapVnbdigitalSearchResults, unwrapVnbdigitalLookupVnbs, pickMunicipalVnbdigitalSearchResult, vnbdigitalLookupParamsForSearchResult, pickMunicipalVnb

module.exports = {
  buildGasCapacityBookingReviewGateStatus(params = {}) {
    const isProvided = (value) => {
      if (Array.isArray(value)) return value.length > 0;
      return value !== undefined && value !== null && String(value).trim() !== '';
    };
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
    const missingMap = {
      capacity_assumption: 'add auditable capacity-ordering basis',
      cold_year_evidence: 'add cold-year stress evidence',
      rlm_rebound_evidence: 'add RLM rebound risk assessment',
      congestion_history_evidence: 'add congestion-history grounding',
      vdmi_owner: 'add accountable VDMI review owner',
      decision_frame_ref: 'add decision-frame traceability',
      commercial_signoff: 'add commercial review status without treating it as automatic approval',
      source_refs: 'add source references for review provenance',
      risk_scenarios: 'add risk-scenario comparison for over- and under-booking',
    };
    const missingEvidence = [];
    const addGap = (missingDataPoint, status = 'missing') => {
      missingEvidence.push({
        missingDataPoint,
        status,
        enablesDossierAddition: missingMap[missingDataPoint],
      });
    };

    const riskScenarios = toList(params.riskScenarios);
    const sourceRefs = toList(params.sourceRefs);
    if (!isProvided(params.capacityAssumption) && !isProvided(params.capacityAssumptionSource)) {
      addGap('capacity_assumption');
    }
    if (!isProvided(params.coldYearEvidence)) addGap('cold_year_evidence');
    if (!isProvided(params.rlmReboundEvidence)) addGap('rlm_rebound_evidence');
    if (!isProvided(params.congestionHistoryEvidence)) addGap('congestion_history_evidence');
    if (!isProvided(params.vdmiOwner)) addGap('vdmi_owner');
    if (!isProvided(params.decisionFrameRef)) addGap('decision_frame_ref');
    if (!isProvided(params.commercialSignoff)) addGap('commercial_signoff');
    if (sourceRefs.length === 0) addGap('source_refs');
    if (riskScenarios.length === 0) addGap('risk_scenarios');

    let status = 'ready_for_review';
    if (missingEvidence.some((gap) => gap.missingDataPoint === 'capacity_assumption')) {
      status = 'needs_capacity_assumption';
    } else if (
      missingEvidence.some((gap) =>
        ['cold_year_evidence', 'rlm_rebound_evidence', 'congestion_history_evidence'].includes(
          gap.missingDataPoint
        )
      )
    ) {
      status = 'needs_scenario_evidence';
    } else if (missingEvidence.some((gap) => gap.missingDataPoint === 'vdmi_owner')) {
      status = 'needs_vdmi_owner';
    } else if (missingEvidence.some((gap) => gap.missingDataPoint === 'commercial_signoff')) {
      status = 'needs_commercial_review';
    } else if (missingEvidence.length > 0) {
      status = 'needs_review_provenance';
    }

    const requiredCount = Object.keys(missingMap).length;
    const readinessScore = Number(
      ((requiredCount - missingEvidence.length) / requiredCount).toFixed(2)
    );
    const sourceActions = {
      inspected: ['dashboard-api.gasCapacityBookingReviewGateStatus'],
      referenced: [
        'gasnetz-waermeplanung.reconcile',
        'decision-frame.get',
        'vdmi.dossier',
        'vdmi-portfolio-gatekeeping.gate',
        'datapoint.health',
        'presentation.render',
      ],
      notCalled: [
        'gas-capacity-booking.submit',
        'upstream-network-operator.submitBooking',
        'vdmi.taskMutate',
        'hitl.create',
        'notification.dispatchInternal',
        'booking-persistence.create',
        'billing.release',
        'settlement.prepareBilling',
        'tariff.mutate',
        'mako.dispatch',
        'contract.release',
        'device-control.execute',
        'external.connector.call',
        'personal-agent.execute',
      ],
    };
    const reviewScope = {
      reviewId: params.reviewId || null,
      bookingYear: params.bookingYear || null,
      networkArea: params.networkArea || null,
    };
    const scenarioEvidenceStatus = {
      coldYearEvidence: params.coldYearEvidence || null,
      rlmReboundEvidence: params.rlmReboundEvidence || null,
      congestionHistoryEvidence: params.congestionHistoryEvidence || null,
      complete:
        isProvided(params.coldYearEvidence) &&
        isProvided(params.rlmReboundEvidence) &&
        isProvided(params.congestionHistoryEvidence),
    };
    const positiveFollowUps = missingEvidence.map((gap) => ({
      ...gap,
      category: 'gas_capacity_booking_review_gate',
    }));
    const dossierFacts = [
      `Gate Status: ${status}`,
      `Network Area: ${reviewScope.networkArea || 'missing'}`,
      `Booking Year: ${reviewScope.bookingYear || 'missing'}`,
      `Capacity Assumption: ${params.capacityAssumption || (params.capacityAssumptionSource ? 'provided' : 'missing')}`,
      `Scenario Evidence Complete: ${scenarioEvidenceStatus.complete ? 'yes' : 'no'}`,
      `VDMI Owner: ${params.vdmiOwner || 'missing'}`,
      `Commercial Signoff: ${params.commercialSignoff || 'missing'}`,
    ];

    return {
      capabilityKey: 'gas_capacity_booking_review_gate',
      safety: 'read_only',
      status,
      readinessScore,
      reviewScope,
      capacityAssumptionSummary: {
        assumption: params.capacityAssumption || null,
        source: params.capacityAssumptionSource || null,
      },
      scenarioEvidenceStatus,
      vdmiReview: {
        owner: params.vdmiOwner || null,
        decisionFrameRef: params.decisionFrameRef || null,
      },
      commercialSignoff: {
        status: params.commercialSignoff || null,
        approvalClaimed: false,
      },
      riskScenarios,
      sourceRefs,
      missingEvidence,
      positiveFollowUps,
      sourceActions,
      dossierEvidence: {
        capabilityKey: 'gas_capacity_booking_review_gate',
        status,
        readinessScore,
        reviewScope,
        capacityAssumptionStatus:
          params.capacityAssumption || (params.capacityAssumptionSource ? 'provided' : 'missing'),
        scenarioEvidenceStatus,
        vdmiOwner: params.vdmiOwner || null,
        decisionFrameRef: params.decisionFrameRef || null,
        commercialSignoff: params.commercialSignoff || null,
        riskScenarios,
        sourceRefs,
        missingEvidence,
        positiveFollowUps,
        sourceActions: { notCalled: sourceActions.notCalled },
        dossierFacts,
      },
    };
  },

  buildGasNetworkDecisionChainStatus(params = {}) {
    const isProvided = (value) => {
      if (Array.isArray(value)) return value.length > 0;
      return value !== undefined && value !== null && String(value).trim() !== '';
    };
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
    const missingMap = {
      capacity_assumption: 'add capacity assumption and evidence reference',
      decommissioning_path: 'add stilllegung or reuse path and horizon evidence',
      regulatory_impact_refs: 'add KANU/EOG/regulatory impact evidence references',
      asset_book_value_refs: 'add asset and book-value provenance',
      photo_year_window: 'add Fotojahr window and decision deadline',
      owner: 'add responsible management role or persona',
      blocked_follow_up_decision: 'add the blocked downstream decision',
      next_evidence_step: 'add the next concrete evidence request',
      source_refs: 'add source references for decision-chain provenance',
    };
    const missingEvidence = [];
    const addGap = (missingDataPoint) => {
      missingEvidence.push({
        missingDataPoint,
        status: 'missing',
        enablesDossierAddition: missingMap[missingDataPoint],
      });
    };

    const sourceRefs = toList(params.sourceRefs);
    if (!isProvided(params.capacityAssumption) && !isProvided(params.capacityEvidenceRef)) {
      addGap('capacity_assumption');
    }
    if (!isProvided(params.decommissioningPath) && !isProvided(params.decommissioningEvidenceRef)) {
      addGap('decommissioning_path');
    }
    if (
      !isProvided(params.regulatoryImpactRef) &&
      !isProvided(params.eogRef) &&
      !isProvided(params.kanuRef)
    ) {
      addGap('regulatory_impact_refs');
    }
    if (!isProvided(params.assetRef) || !isProvided(params.bookValueRef))
      addGap('asset_book_value_refs');
    if (!isProvided(params.photoYear) || !isProvided(params.decisionDeadline))
      addGap('photo_year_window');
    if (!isProvided(params.owner) && !isProvided(params.ownerRole)) addGap('owner');
    if (!isProvided(params.blockedFollowUpDecision)) addGap('blocked_follow_up_decision');
    if (!isProvided(params.nextEvidenceStep)) addGap('next_evidence_step');
    if (sourceRefs.length === 0) addGap('source_refs');

    let status = 'ready_for_decision_chain_review';
    if (missingEvidence.some((gap) => gap.missingDataPoint === 'capacity_assumption')) {
      status = 'needs_capacity_assumption';
    } else if (missingEvidence.some((gap) => gap.missingDataPoint === 'decommissioning_path')) {
      status = 'needs_decommissioning_path';
    } else if (missingEvidence.some((gap) => gap.missingDataPoint === 'regulatory_impact_refs')) {
      status = 'needs_regulatory_refs';
    } else if (missingEvidence.some((gap) => gap.missingDataPoint === 'asset_book_value_refs')) {
      status = 'needs_asset_book_value_refs';
    } else if (missingEvidence.some((gap) => gap.missingDataPoint === 'photo_year_window')) {
      status = 'needs_photo_year_window';
    } else if (missingEvidence.some((gap) => gap.missingDataPoint === 'owner')) {
      status = 'needs_owner';
    } else if (missingEvidence.length > 0) {
      status = 'needs_decision_chain_provenance';
    }

    const requiredCount = Object.keys(missingMap).length;
    const readinessScore = Number(
      ((requiredCount - missingEvidence.length) / requiredCount).toFixed(2)
    );
    const sourceActions = {
      inspected: ['dashboard-api.gasNetworkDecisionChainStatus'],
      referenced: [
        'gasnetz-waermeplanung.reconcile',
        'decision-frame.get',
        'assets.effective',
        'eog-calculator.evaluate',
        'vdmi.dossier',
      ],
      notCalled: [
        'gas-network-flow.calculate',
        'gas-capacity-booking.submit',
        'gas-transformation.executeDecommissioning',
        'investment.approve',
        'assets.applyOverride',
        'hitl.create',
        'notification.dispatchInternal',
        'billing.release',
        'settlement.prepareBilling',
        'tariff.mutate',
        'mako.dispatch',
        'contract.release',
        'device-control.execute',
        'external.connector.call',
        'personal-agent.execute',
      ],
    };
    const chainScope = {
      chainId: params.chainId || null,
      gridOperatorId: params.gridOperatorId || null,
      reconciliationId: params.reconciliationId || null,
      segmentId: params.segmentId || null,
    };
    const positiveFollowUps = missingEvidence.map((gap) => ({
      ...gap,
      category: 'gas_network_decision_chain',
    }));
    const dossierFacts = [
      `Decision Chain Status: ${status}`,
      `Grid Operator: ${chainScope.gridOperatorId || 'missing'}`,
      `Segment: ${chainScope.segmentId || 'missing'}`,
      `Capacity Assumption: ${params.capacityAssumption || (params.capacityEvidenceRef ? 'provided' : 'missing')}`,
      `Decommissioning Path: ${params.decommissioningPath || (params.decommissioningEvidenceRef ? 'provided' : 'missing')}`,
      `Regulatory References: ${params.regulatoryImpactRef || params.eogRef || params.kanuRef || 'missing'}`,
      `Fotojahr: ${params.photoYear || 'missing'}`,
      `Owner: ${params.owner || params.ownerRole || 'missing'}`,
    ];

    return {
      capabilityKey: 'gas_network_decision_chain',
      safety: 'read_only',
      status,
      readinessScore,
      chainScope,
      capacityAssumptionStatus: {
        assumption: params.capacityAssumption || null,
        evidenceRef: params.capacityEvidenceRef || null,
      },
      decommissioningPathStatus: {
        path: params.decommissioningPath || null,
        evidenceRef: params.decommissioningEvidenceRef || null,
      },
      regulatoryImpactStatus: {
        regulatoryImpactRef: params.regulatoryImpactRef || null,
        eogRef: params.eogRef || null,
        kanuRef: params.kanuRef || null,
        approvalClaimed: false,
      },
      assetBookValueStatus: {
        assetRef: params.assetRef || null,
        bookValueRef: params.bookValueRef || null,
      },
      photoYearWindow: {
        photoYear: params.photoYear || null,
        decisionDeadline: params.decisionDeadline || null,
      },
      owner: {
        role: params.ownerRole || null,
        name: params.owner || null,
      },
      gateStatus: params.gateStatus || status,
      blockedFollowUpDecision: params.blockedFollowUpDecision || null,
      nextEvidenceStep: params.nextEvidenceStep || null,
      sourceRefs,
      missingEvidence,
      positiveFollowUps,
      sourceActions,
      dossierEvidence: {
        capabilityKey: 'gas_network_decision_chain',
        status,
        readinessScore,
        chainScope,
        capacityAssumptionStatus:
          params.capacityAssumption || (params.capacityEvidenceRef ? 'provided' : 'missing'),
        decommissioningPath: params.decommissioningPath || null,
        regulatoryImpactRef: params.regulatoryImpactRef || null,
        eogRef: params.eogRef || null,
        kanuRef: params.kanuRef || null,
        assetRef: params.assetRef || null,
        bookValueRef: params.bookValueRef || null,
        photoYear: params.photoYear || null,
        decisionDeadline: params.decisionDeadline || null,
        owner: params.owner || params.ownerRole || null,
        blockedFollowUpDecision: params.blockedFollowUpDecision || null,
        nextEvidenceStep: params.nextEvidenceStep || null,
        sourceRefs,
        missingEvidence,
        positiveFollowUps,
        sourceActions: { notCalled: sourceActions.notCalled },
        dossierFacts,
      },
    };
  },

  buildWaterPricingNetInvestmentAlignmentStatus(params = {}) {
    const isProvided = (value) => {
      if (Array.isArray(value)) return value.length > 0;
      return value !== undefined && value !== null && String(value).trim() !== '';
    };
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

    const missingMap = {
      water_price_reference: 'add sourced water-price assumption or calculation reference',
      net_investment_reference: 'add net-investment or infrastructure-measure reference',
      asset_accounting_reference: 'add sourced Anlagenbuchhaltung evidence',
      lease_condition_reference: 'add Pachtnetz, concession or lease-condition traceability',
      regulatory_impact_reference:
        'add regulatory-impact or tariff-logic boundary evidence without claiming approval',
      governance_owner: 'add accountable governance or committee owner',
      review_window: 'add review period or target committee date',
      alignment_decision: 'add clear blocked or committee-review decision status',
      source_refs: 'add source references for dossier provenance',
    };
    const missingEvidence = [];
    const addGap = (missingDataPoint) => {
      missingEvidence.push({
        missingDataPoint,
        status: 'missing',
        enablesDossierAddition: missingMap[missingDataPoint],
      });
    };

    const sourceRefs = toList(params.sourceRefs);
    if (!isProvided(params.waterPriceReference) && !isProvided(params.calculationReference)) {
      addGap('water_price_reference');
    }
    if (
      !isProvided(params.netInvestmentReference) &&
      !isProvided(params.infrastructureMeasureReference)
    ) {
      addGap('net_investment_reference');
    }
    if (!isProvided(params.assetAccountingReference)) addGap('asset_accounting_reference');
    if (!isProvided(params.leaseOrConcessionReference) && !isProvided(params.pachtnetzReference)) {
      addGap('lease_condition_reference');
    }
    if (!isProvided(params.regulatoryImpactReference) && !isProvided(params.tariffLogicReference)) {
      addGap('regulatory_impact_reference');
    }
    if (!isProvided(params.governanceOwner) && !isProvided(params.committeeOwner))
      addGap('governance_owner');
    if (!isProvided(params.reviewPeriod) && !isProvided(params.targetCommitteeDate))
      addGap('review_window');
    if (!isProvided(params.alignmentDecision)) addGap('alignment_decision');
    if (sourceRefs.length === 0) addGap('source_refs');

    let status = 'committee_review_ready';
    if (missingEvidence.some((gap) => gap.missingDataPoint === 'water_price_reference')) {
      status = 'needs_water_price_reference';
    } else if (missingEvidence.some((gap) => gap.missingDataPoint === 'net_investment_reference')) {
      status = 'needs_net_investment_reference';
    } else if (
      missingEvidence.some((gap) => gap.missingDataPoint === 'asset_accounting_reference')
    ) {
      status = 'needs_asset_accounting_reference';
    } else if (
      missingEvidence.some((gap) => gap.missingDataPoint === 'lease_condition_reference')
    ) {
      status = 'needs_lease_condition_reference';
    } else if (
      missingEvidence.some((gap) => gap.missingDataPoint === 'regulatory_impact_reference')
    ) {
      status = 'needs_regulatory_impact_reference';
    } else if (missingEvidence.some((gap) => gap.missingDataPoint === 'governance_owner')) {
      status = 'needs_governance_owner';
    } else if (missingEvidence.length > 0) {
      status = 'needs_alignment_provenance';
    }

    const requiredCount = Object.keys(missingMap).length;
    const readinessScore = Number(
      ((requiredCount - missingEvidence.length) / requiredCount).toFixed(2)
    );
    const sourceActions = {
      inspected: ['dashboard-api.waterPricingNetInvestmentAlignmentStatus'],
      referenced: [
        'investment-planning.review',
        'reporting-governance.evaluate',
        'regulatorische-entgeltlogik.evaluate',
        'vdmi-portfolio-gatekeeping.evaluate',
        'vdmi.dossier',
      ],
      notCalled: [
        'water-pricing.calculate',
        'regulatorische-entgeltlogik.executeWaterPricing',
        'asset-accounting.import',
        'sap.import',
        'excel.import',
        'pachtnetz.parseContract',
        'legal.approve',
        'accounting.mutate',
        'billing.release',
        'settlement.prepareBilling',
        'tariff.mutate',
        'mako.dispatch',
        'contract.release',
        'payment.execute',
        'hitl.create',
        'notification.dispatchInternal',
        'external.connector.call',
        'personal-agent.execute',
      ],
    };
    const alignmentScope = {
      caseId: params.caseId || null,
      projectId: params.projectId || null,
      tenantId: params.tenantId || null,
    };
    const positiveFollowUps = missingEvidence.map((gap) => ({
      ...gap,
      category: 'water_pricing_net_investment_alignment_gate',
    }));
    const dossierFacts = [
      `Alignment Status: ${status}`,
      `Case: ${alignmentScope.caseId || alignmentScope.projectId || 'missing'}`,
      `Water Price Reference: ${params.waterPriceReference || params.calculationReference || 'missing'}`,
      `Net Investment Reference: ${params.netInvestmentReference || params.infrastructureMeasureReference || 'missing'}`,
      `Asset Accounting: ${params.assetAccountingReference || 'missing'}`,
      `Lease Condition: ${params.leaseOrConcessionReference || params.pachtnetzReference || 'missing'}`,
      `Regulatory Boundary: ${params.regulatoryImpactReference || params.tariffLogicReference || 'missing'}`,
      `Owner: ${params.governanceOwner || params.committeeOwner || 'missing'}`,
      `Review Window: ${params.reviewPeriod || params.targetCommitteeDate || 'missing'}`,
    ];

    return {
      capabilityKey: 'water_pricing_net_investment_alignment_gate',
      safety: 'read_only',
      status,
      readinessScore,
      alignmentScope,
      pricingEvidence: {
        waterPriceReference: params.waterPriceReference || null,
        calculationReference: params.calculationReference || null,
        officialPriceCalculated: false,
      },
      investmentEvidence: {
        netInvestmentReference: params.netInvestmentReference || null,
        infrastructureMeasureReference: params.infrastructureMeasureReference || null,
      },
      assetAccountingEvidence: {
        assetAccountingReference: params.assetAccountingReference || null,
        accountingMutated: false,
      },
      leaseConditionEvidence: {
        leaseOrConcessionReference: params.leaseOrConcessionReference || null,
        pachtnetzReference: params.pachtnetzReference || null,
        contractParsed: false,
      },
      regulatoryBoundaryEvidence: {
        regulatoryImpactReference: params.regulatoryImpactReference || null,
        tariffLogicReference: params.tariffLogicReference || null,
        approvalClaimed: false,
      },
      owner: {
        governanceOwner: params.governanceOwner || null,
        committeeOwner: params.committeeOwner || null,
      },
      reviewWindow: {
        reviewPeriod: params.reviewPeriod || null,
        targetCommitteeDate: params.targetCommitteeDate || null,
      },
      alignmentDecision: params.alignmentDecision || null,
      sourceRefs,
      missingEvidence,
      positiveFollowUps,
      sourceActions,
      dossierEvidence: {
        capabilityKey: 'water_pricing_net_investment_alignment_gate',
        status,
        readinessScore,
        alignmentScope,
        waterPriceReference: params.waterPriceReference || params.calculationReference || null,
        netInvestmentReference:
          params.netInvestmentReference || params.infrastructureMeasureReference || null,
        assetAccountingReference: params.assetAccountingReference || null,
        leaseConditionReference:
          params.leaseOrConcessionReference || params.pachtnetzReference || null,
        regulatoryImpactReference:
          params.regulatoryImpactReference || params.tariffLogicReference || null,
        owner: params.governanceOwner || params.committeeOwner || null,
        reviewWindow: params.reviewPeriod || params.targetCommitteeDate || null,
        alignmentDecision: params.alignmentDecision || null,
        regulatoryApprovalClaimed: false,
        sourceRefs,
        missingEvidence,
        positiveFollowUps,
        sourceActions: { notCalled: sourceActions.notCalled },
        dossierFacts,
      },
    };
  },

  buildArealNetworkIntegrationOfferGateStatus(params = {}) {
    const isProvided = (value) => {
      if (Array.isArray(value)) return value.length > 0;
      if (typeof value === 'number') return Number.isFinite(value);
      return value !== undefined && value !== null && String(value).trim() !== '';
    };
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
    const toNumber = (value) => {
      if (value === undefined || value === null || value === '') return null;
      const normalized =
        typeof value === 'string' ? value.replace(/\s/g, '').replace(',', '.') : value;
      const parsed = Number(normalized);
      return Number.isFinite(parsed) ? parsed : null;
    };

    const requestedCapacityKw = toNumber(params.requestedCapacityKw);
    const sourceRefs = toList(params.sourceRefs);
    const missingMap = {
      site_reference: 'add site or area reference to the offer gate',
      requested_connection_capacity: 'add requested connection capacity to the dossier',
      grid_capacity_evidence: 'add grid-capacity status evidence',
      target_grid_path: 'add target-grid path evidence',
      investment_capex_reference: 'add investment / CAPEX impact reference',
      regulatory_impact_boundary: 'add regulatory-impact boundary evidence',
      commercial_offer_assumptions: 'add commercial offer-assumption evidence',
      owner: 'add decision owner to the Areal gate',
      next_decision_date: 'add next decision date to the decision card',
      offer_decision_status: 'add offer decision status',
      source_refs: 'add source references for the decision card',
    };
    const missingEvidence = [];
    const addGap = (missingDataPoint) => {
      missingEvidence.push({
        missingDataPoint,
        status: 'missing',
        enablesDossierAddition: missingMap[missingDataPoint],
      });
    };

    if (!isProvided(params.siteReference) && !isProvided(params.areaReference))
      addGap('site_reference');
    if (!isProvided(params.requestedConnectionCapacity) && requestedCapacityKw === null) {
      addGap('requested_connection_capacity');
    }
    if (!isProvided(params.gridCapacityEvidence) && !isProvided(params.capacityEvidenceReference)) {
      addGap('grid_capacity_evidence');
    }
    if (!isProvided(params.targetGridPath) && !isProvided(params.zielnetzPath))
      addGap('target_grid_path');
    if (!isProvided(params.investmentReference) && !isProvided(params.capexReference)) {
      addGap('investment_capex_reference');
    }
    if (
      !isProvided(params.regulatoryImpactBoundary) &&
      !isProvided(params.regulatoryImpactReference)
    ) {
      addGap('regulatory_impact_boundary');
    }
    if (
      !isProvided(params.commercialOfferAssumptions) &&
      !isProvided(params.offerAssumptionReference)
    ) {
      addGap('commercial_offer_assumptions');
    }
    if (!isProvided(params.owner) && !isProvided(params.gateOwner)) addGap('owner');
    if (!isProvided(params.nextDecisionDate)) addGap('next_decision_date');
    if (!isProvided(params.offerDecisionStatus)) addGap('offer_decision_status');
    if (sourceRefs.length === 0) addGap('source_refs');

    let status = 'ready_for_offer_gate_review';
    if (missingEvidence.some((gap) => gap.missingDataPoint === 'site_reference')) {
      status = 'needs_site_reference';
    } else if (
      missingEvidence.some((gap) => gap.missingDataPoint === 'requested_connection_capacity')
    ) {
      status = 'needs_requested_capacity';
    } else if (missingEvidence.some((gap) => gap.missingDataPoint === 'grid_capacity_evidence')) {
      status = 'needs_grid_capacity_evidence';
    } else if (missingEvidence.some((gap) => gap.missingDataPoint === 'target_grid_path')) {
      status = 'needs_target_grid_path';
    } else if (
      missingEvidence.some((gap) => gap.missingDataPoint === 'investment_capex_reference')
    ) {
      status = 'needs_investment_capex_reference';
    } else if (
      missingEvidence.some((gap) => gap.missingDataPoint === 'regulatory_impact_boundary')
    ) {
      status = 'needs_regulatory_boundary';
    } else if (
      missingEvidence.some((gap) => gap.missingDataPoint === 'commercial_offer_assumptions')
    ) {
      status = 'needs_offer_assumptions';
    } else if (missingEvidence.length > 0) {
      status = 'needs_decision_card_provenance';
    }

    const requiredCount = Object.keys(missingMap).length;
    const readinessScore = Number(
      ((requiredCount - missingEvidence.length) / requiredCount).toFixed(2)
    );
    const sourceActions = {
      inspected: ['dashboard-api.arealNetworkIntegrationOfferGateStatus'],
      referenced: [
        'grid-connection.validate',
        'target-grid-planning.review',
        'investment-planning.review',
        'regulatorische-entgeltlogik.evaluate',
        'offer-management.review',
        'vdmi.dossier',
      ],
      notCalled: [
        'offer.calculate',
        'offer.generateBinding',
        'contract.accept',
        'grid-capacity.reserve',
        'target-grid.optimize',
        'investment.approve',
        'assets.applyOverride',
        'billing.release',
        'settlement.prepareBilling',
        'tariff.mutate',
        'mako.dispatch',
        'device-control.execute',
        'hitl.create',
        'notification.dispatchInternal',
        'external.connector.call',
        'personal-agent.execute',
      ],
    };
    const decisionScope = {
      caseId: params.caseId || null,
      projectId: params.projectId || null,
      tenantId: params.tenantId || null,
      siteReference: params.siteReference || null,
      areaReference: params.areaReference || null,
    };
    const positiveFollowUps = missingEvidence.map((gap) => ({
      ...gap,
      category: 'areal_network_integration_offer_gate',
    }));
    const dossierFacts = [
      `Offer Gate Status: ${status}`,
      `Site: ${decisionScope.siteReference || decisionScope.areaReference || 'missing'}`,
      `Requested Capacity: ${params.requestedConnectionCapacity || (requestedCapacityKw !== null ? `${requestedCapacityKw} kW` : 'missing')}`,
      `Grid Capacity Evidence: ${params.gridCapacityEvidence || params.capacityEvidenceReference || 'missing'}`,
      `Target Grid Path: ${params.targetGridPath || params.zielnetzPath || 'missing'}`,
      `Investment / CAPEX: ${params.investmentReference || params.capexReference || 'missing'}`,
      `Regulatory Boundary: ${params.regulatoryImpactBoundary || params.regulatoryImpactReference || 'missing'}`,
      `Offer Assumptions: ${params.commercialOfferAssumptions || params.offerAssumptionReference || 'missing'}`,
      `Owner: ${params.owner || params.gateOwner || 'missing'}`,
      `Next Decision Date: ${params.nextDecisionDate || 'missing'}`,
    ];

    return {
      capabilityKey: 'areal_network_integration_offer_gate',
      safety: 'read_only',
      status,
      readinessScore,
      decisionScope,
      capacityEvidence: {
        requestedConnectionCapacity: params.requestedConnectionCapacity || null,
        requestedCapacityKw,
        gridCapacityEvidence: params.gridCapacityEvidence || null,
        capacityEvidenceReference: params.capacityEvidenceReference || null,
        capacityReserved: false,
      },
      targetGridEvidence: {
        targetGridPath: params.targetGridPath || null,
        zielnetzPath: params.zielnetzPath || null,
        optimizerExecuted: false,
      },
      investmentEvidence: {
        investmentReference: params.investmentReference || null,
        capexReference: params.capexReference || null,
        investmentApproved: false,
      },
      regulatoryBoundaryEvidence: {
        regulatoryImpactBoundary: params.regulatoryImpactBoundary || null,
        regulatoryImpactReference: params.regulatoryImpactReference || null,
        approvalClaimed: false,
      },
      commercialAssumptionEvidence: {
        commercialOfferAssumptions: params.commercialOfferAssumptions || null,
        offerAssumptionReference: params.offerAssumptionReference || null,
        bindingOfferGenerated: false,
      },
      owner: {
        owner: params.owner || null,
        gateOwner: params.gateOwner || null,
      },
      decisionWindow: {
        nextDecisionDate: params.nextDecisionDate || null,
        offerDecisionStatus: params.offerDecisionStatus || null,
      },
      sourceRefs,
      missingEvidence,
      positiveFollowUps,
      sourceActions,
      dossierEvidence: {
        capabilityKey: 'areal_network_integration_offer_gate',
        status,
        readinessScore,
        decisionScope,
        siteReference: params.siteReference || params.areaReference || null,
        requestedConnectionCapacity:
          params.requestedConnectionCapacity ||
          (requestedCapacityKw !== null ? `${requestedCapacityKw} kW` : null),
        gridCapacityEvidence:
          params.gridCapacityEvidence || params.capacityEvidenceReference || null,
        targetGridPath: params.targetGridPath || params.zielnetzPath || null,
        investmentReference: params.investmentReference || params.capexReference || null,
        regulatoryImpactBoundary:
          params.regulatoryImpactBoundary || params.regulatoryImpactReference || null,
        commercialOfferAssumptions:
          params.commercialOfferAssumptions || params.offerAssumptionReference || null,
        owner: params.owner || params.gateOwner || null,
        nextDecisionDate: params.nextDecisionDate || null,
        offerDecisionStatus: params.offerDecisionStatus || null,
        bindingOfferGenerated: false,
        gridCapacityReserved: false,
        sourceRefs,
        missingEvidence,
        positiveFollowUps,
        sourceActions: { notCalled: sourceActions.notCalled },
        dossierFacts,
      },
    };
  },

  buildTransformationFinancingScenarioViewStatus(params = {}) {
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

    const isProvided = (value) =>
      value !== undefined && value !== null && String(value).trim() !== '';
    const firstProvided = (...values) => values.find((value) => isProvided(value)) || null;
    const sourceDatapoints = toList(params.sourceDatapoints);
    const callerSourceActions = toList(params.sourceActions);
    const missingMap = {
      scenario_identity: 'add scenario ID, grid operator, planning horizon and scenario type',
      cashflow_source: 'add cashflow source evidence for the transformation scenario',
      margin_compensation_assumption: 'add margin compensation assumption and provenance',
      capital_reallocation_option: 'add capital reallocation option for the scenario',
      gas_decommissioning_path: 'add gas decommissioning or continued-use path evidence',
      rollback_cost_basis: 'add rollback/removal cost basis',
      heat_h2_option_basis: 'add heat and H2 investment option basis',
      municipal_burden_basis: 'add municipal, public-transport or shareholder burden basis',
      operational_investment_need: 'add operational investment need reference',
      eog_regulatory_impact: 'add EOG/regulatory impact assumption',
      liquidity_impact_assumption: 'add liquidity impact assumption',
      stress_threshold: 'add stress threshold for committee steering',
      committee_decision_gate: 'add committee decision gate and owner',
      source_datapoints: 'add source datapoints for answer-ready statements',
    };
    const missingEvidence = [];
    const addGap = (missingDataPoint) => {
      missingEvidence.push({
        missingDataPoint,
        status: 'missing',
        enablesDossierAddition: missingMap[missingDataPoint],
      });
    };

    if (
      !isProvided(params.scenarioId) ||
      !isProvided(params.gridOperatorId) ||
      !isProvided(params.planningHorizon) ||
      !isProvided(params.scenarioType)
    ) {
      addGap('scenario_identity');
    }
    if (!isProvided(params.cashflowSource) && !isProvided(params.cashflowSourceRef))
      addGap('cashflow_source');
    if (!isProvided(params.marginCompensationAssumption)) addGap('margin_compensation_assumption');
    if (!isProvided(params.capitalReallocationOption)) addGap('capital_reallocation_option');
    if (!isProvided(params.gasDecommissioningPath)) addGap('gas_decommissioning_path');
    if (!isProvided(params.rollbackCostBasis)) addGap('rollback_cost_basis');
    if (!isProvided(params.heatInvestmentMeasure) && !isProvided(params.h2OptionMeasure)) {
      addGap('heat_h2_option_basis');
    }
    if (
      !isProvided(params.municipalBurdenAssumption) &&
      !isProvided(params.publicTransportShareholderBurden)
    ) {
      addGap('municipal_burden_basis');
    }
    if (!isProvided(params.operationalInvestmentNeed)) addGap('operational_investment_need');
    if (!isProvided(params.eogImpact) && !isProvided(params.regulatoryImpactAssumption)) {
      addGap('eog_regulatory_impact');
    }
    if (!isProvided(params.liquidityImpact)) addGap('liquidity_impact_assumption');
    if (!isProvided(params.stressThreshold)) addGap('stress_threshold');
    if (!isProvided(params.committeeDecisionGate) || !isProvided(params.owner)) {
      addGap('committee_decision_gate');
    }
    if (sourceDatapoints.length === 0 && callerSourceActions.length === 0)
      addGap('source_datapoints');

    let status = 'ready_for_decision';
    if (missingEvidence.some((gap) => gap.missingDataPoint === 'scenario_identity')) {
      status = 'needs_scenario_identity';
    } else if (missingEvidence.some((gap) => gap.missingDataPoint === 'cashflow_source')) {
      status = 'needs_cashflow_source';
    } else if (missingEvidence.some((gap) => gap.missingDataPoint === 'rollback_cost_basis')) {
      status = 'needs_rollback_cost_basis';
    } else if (missingEvidence.some((gap) => gap.missingDataPoint === 'municipal_burden_basis')) {
      status = 'needs_municipal_burden_basis';
    } else if (missingEvidence.some((gap) => gap.missingDataPoint === 'eog_regulatory_impact')) {
      status = 'needs_regulatory_assessment';
    } else if (
      missingEvidence.some((gap) => gap.missingDataPoint === 'liquidity_impact_assumption')
    ) {
      status = 'needs_liquidity_assumption';
    } else if (missingEvidence.some((gap) => gap.missingDataPoint === 'stress_threshold')) {
      status = 'blocked_by_missing_threshold';
    } else if (missingEvidence.some((gap) => gap.missingDataPoint === 'committee_decision_gate')) {
      status = 'needs_committee_gate';
    } else if (missingEvidence.length > 0) {
      status = 'needs_scenario_evidence';
    }

    const requiredCount = Object.keys(missingMap).length;
    const readinessScore = Number(
      ((requiredCount - missingEvidence.length) / requiredCount).toFixed(2)
    );
    const sourceActions = {
      inspected: ['dashboard-api.transformationFinancingScenarioViewStatus'],
      referenced: [
        'datasource-registry.get',
        'datapoint.health',
        'investment-planning.createPlan',
        'eog-calculator.scenario',
        'finance-agent.analyze',
        'vdmi.dossier',
        'presentation.generate',
        ...callerSourceActions,
      ],
      notCalled: [
        'finance.createBooking',
        'treasury.executeTransfer',
        'accounting.postJournal',
        'gas-assets.applyDecommissioning',
        'investment.approve',
        'settlement.exportA96',
        'billing.prepareInvoice',
        'tariff.mutate',
        'mako.dispatch',
        'hitl.create',
        'vdmi.taskMutate',
        'external.connector.call',
        'personal-agent.execute',
      ],
    };
    const scenarioSummary = {
      scenarioId: params.scenarioId || null,
      gridOperatorId: params.gridOperatorId || null,
      planningHorizon: params.planningHorizon || null,
      scenarioType: params.scenarioType || null,
      vdmiProcessId: params.vdmiProcessId || null,
      owner: params.owner || null,
    };
    const evidenceGroups = {
      cashflow: {
        cashflowSource: firstProvided(params.cashflowSource, params.cashflowSourceRef),
        marginCompensationAssumption: params.marginCompensationAssumption || null,
        assumptionOnly: isProvided(params.marginCompensationAssumption),
      },
      capital: {
        capitalReallocationOption: params.capitalReallocationOption || null,
      },
      assetTransition: {
        gasDecommissioningPath: params.gasDecommissioningPath || null,
        rollbackCostBasis: params.rollbackCostBasis || null,
        heatInvestmentMeasure: params.heatInvestmentMeasure || null,
        h2OptionMeasure: params.h2OptionMeasure || null,
        gasAssetMutated: false,
      },
      municipalBurden: {
        municipalBurdenAssumption: params.municipalBurdenAssumption || null,
        publicTransportShareholderBurden: params.publicTransportShareholderBurden || null,
        assumptionOnly:
          isProvided(params.municipalBurdenAssumption) ||
          isProvided(params.publicTransportShareholderBurden),
      },
      operationalInvestment: {
        operationalInvestmentNeed: params.operationalInvestmentNeed || null,
        investmentApproved: false,
      },
      regulatoryFinance: {
        eogImpact: params.eogImpact || null,
        regulatoryImpactAssumption: params.regulatoryImpactAssumption || null,
        authoritativeLegalInterpretation: false,
      },
      liquidityStress: {
        liquidityImpact: params.liquidityImpact || null,
        stressThreshold: params.stressThreshold || null,
      },
      committeeGate: {
        committeeDecisionGate: params.committeeDecisionGate || null,
        owner: params.owner || null,
        hitlCreated: false,
      },
    };
    const positiveFollowUps = missingEvidence.map((gap) => ({
      ...gap,
      category: 'transformation_financing_scenario_view',
    }));
    const nextActions = positiveFollowUps.map((gap) => ({
      action: 'requestEvidence',
      missingDataPoint: gap.missingDataPoint,
      description: gap.enablesDossierAddition,
    }));
    const dossierFacts = [
      `Transformation Financing Status: ${status}`,
      `Scenario: ${scenarioSummary.scenarioId || 'missing'}`,
      `Grid Operator: ${scenarioSummary.gridOperatorId || 'missing'}`,
      `Planning Horizon: ${scenarioSummary.planningHorizon || 'missing'}`,
      `Cashflow Source: ${evidenceGroups.cashflow.cashflowSource || 'missing'}`,
      `Rollback Cost Basis: ${evidenceGroups.assetTransition.rollbackCostBasis || 'missing'}`,
      `Municipal Burden: ${evidenceGroups.municipalBurden.municipalBurdenAssumption || evidenceGroups.municipalBurden.publicTransportShareholderBurden || 'missing'}`,
      `EOG / Regulatory Impact: ${evidenceGroups.regulatoryFinance.eogImpact || evidenceGroups.regulatoryFinance.regulatoryImpactAssumption || 'missing'}`,
      `Liquidity / Stress: ${evidenceGroups.liquidityStress.liquidityImpact || 'missing'} / ${evidenceGroups.liquidityStress.stressThreshold || 'missing'}`,
      `Committee Gate: ${evidenceGroups.committeeGate.committeeDecisionGate || 'missing'}`,
    ];

    return {
      capabilityKey: 'transformation_financing_scenario_view',
      safety: 'read_only',
      status,
      readinessScore,
      scenarioSummary,
      decisionReadiness: {
        status,
        readinessScore,
        missingCount: missingEvidence.length,
      },
      evidenceGroups,
      sourceDatapoints,
      missingEvidence,
      positiveFollowUps,
      nextActions,
      sourceActions,
      dossierEvidence: {
        capabilityKey: 'transformation_financing_scenario_view',
        status,
        readinessScore,
        scenarioSummary,
        decisionReadiness: status,
        evidenceGroups,
        sourceDatapoints,
        missingEvidence,
        positiveFollowUps,
        nextActions,
        sourceActions: { notCalled: sourceActions.notCalled },
        dossierFacts,
      },
    };
  },

  buildInvestmentBudgetCapExceptionGovernanceStatus(params = {}) {
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
    const toNumberOrNull = (value) => {
      if (value === undefined || value === null || String(value).trim() === '') return null;
      const parsed = Number(String(value).replace(',', '.'));
      return Number.isFinite(parsed) ? parsed : null;
    };
    const isProvided = (value) =>
      value !== undefined && value !== null && String(value).trim() !== '';
    const evidenceRefs = toList(params.evidenceRefs);
    const sourceDatapoints = toList(params.sourceDatapoints);
    const callerSourceActions = toList(params.sourceActions);
    const budgetCapEur = toNumberOrNull(params.budgetCapEur);
    const requiredBudgetEur = toNumberOrNull(params.requiredBudgetEur);
    const budgetDeltaEur =
      budgetCapEur !== null && requiredBudgetEur !== null
        ? Number((requiredBudgetEur - budgetCapEur).toFixed(2))
        : null;
    const gapMap = {
      measure_identity: 'add investment measure id, name or scope',
      budget_cap_missing: 'add budget cap comparison and delta classification',
      required_budget_missing: 'add fachlicher Soll-Bedarf and exception amount',
      no_regret_missing: 'add no-regret justification for the committee gate',
      technical_justification_missing:
        'add technical or regulatory justification for the exception',
      kpi_reference_missing: 'add KPI-backed governance rationale',
      asset_context_missing: 'add Sparte or asset reference for operational accountability',
      data_quality_missing: 'add data-quality status for auditability',
      evidence_refs_missing: 'add audit-ready evidence references',
      risk_if_deferred_missing: 'add risk if the measure is deferred',
      owner_deadline_missing: 'add accountable owner, due date, and next decision gate',
      exception_justification_missing: 'add exception justification draft for the governance gate',
      source_datapoints_missing: 'add source datapoints or source actions for provenance',
    };
    const missingEvidence = [];
    const addGap = (missingDataPoint) => {
      missingEvidence.push({
        missingDataPoint,
        status: 'missing',
        enablesDossierAddition: gapMap[missingDataPoint],
      });
    };

    if (
      !isProvided(params.measureId) &&
      !isProvided(params.measureName) &&
      !isProvided(params.scope)
    )
      addGap('measure_identity');
    if (budgetCapEur === null) addGap('budget_cap_missing');
    if (requiredBudgetEur === null) addGap('required_budget_missing');
    if (!isProvided(params.noRegretCriterion)) addGap('no_regret_missing');
    if (!isProvided(params.technicalJustification) && !isProvided(params.regulatoryContext))
      addGap('technical_justification_missing');
    if (!isProvided(params.kpiReference)) addGap('kpi_reference_missing');
    if (!isProvided(params.division) && !isProvided(params.assetRef))
      addGap('asset_context_missing');
    if (!isProvided(params.dataQuality)) addGap('data_quality_missing');
    if (evidenceRefs.length === 0) addGap('evidence_refs_missing');
    if (!isProvided(params.riskIfDeferred)) addGap('risk_if_deferred_missing');
    if (
      !isProvided(params.owner) ||
      !isProvided(params.deadline) ||
      !isProvided(params.nextDecisionGate)
    )
      addGap('owner_deadline_missing');
    if (!isProvided(params.exceptionJustification)) addGap('exception_justification_missing');
    if (sourceDatapoints.length === 0 && callerSourceActions.length === 0)
      addGap('source_datapoints_missing');

    let status = 'exception_evidence_ready';
    if (missingEvidence.some((gap) => gap.missingDataPoint === 'measure_identity')) {
      status = 'needs_measure_identity';
    } else if (
      missingEvidence.some((gap) =>
        ['budget_cap_missing', 'required_budget_missing'].includes(gap.missingDataPoint)
      )
    ) {
      status = 'needs_budget_cap_evidence';
    } else if (
      missingEvidence.some((gap) =>
        ['no_regret_missing', 'technical_justification_missing', 'kpi_reference_missing'].includes(
          gap.missingDataPoint
        )
      )
    ) {
      status = 'needs_exception_evidence';
    } else if (
      missingEvidence.some((gap) =>
        ['owner_deadline_missing', 'exception_justification_missing'].includes(gap.missingDataPoint)
      )
    ) {
      status = 'needs_governance_gate';
    } else if (missingEvidence.length > 0) {
      status = 'needs_exception_evidence';
    }

    const requiredCount = Object.keys(gapMap).length;
    const readinessScore = Number(
      ((requiredCount - missingEvidence.length) / requiredCount).toFixed(2)
    );
    const positiveFollowUps = missingEvidence.map((gap) => ({
      ...gap,
      category: 'investment_budget_cap_exception_governance',
    }));
    const governanceContext = {
      measureId: params.measureId || null,
      measureName: params.measureName || null,
      scope: params.scope || null,
      budgetCapEur,
      requiredBudgetEur,
      budgetDeltaEur,
      aboveCap: budgetDeltaEur !== null ? budgetDeltaEur > 0 : null,
      noRegretCriterion: params.noRegretCriterion || null,
      technicalJustification: params.technicalJustification || null,
      regulatoryContext: params.regulatoryContext || null,
      kpiReference: params.kpiReference || null,
      division: params.division || null,
      assetRef: params.assetRef || null,
      dataQuality: params.dataQuality || null,
      evidenceRefs,
      riskIfDeferred: params.riskIfDeferred || null,
      owner: params.owner || null,
      deadline: params.deadline || null,
      nextDecisionGate: params.nextDecisionGate || null,
      exceptionJustification: params.exceptionJustification || null,
      exceptionJustificationStatus:
        missingEvidence.length === 0
          ? 'evidence_ready'
          : params.exceptionJustification
            ? 'draft'
            : 'blocked',
      budgetApproved: false,
      committeeDecisionCreated: false,
      erpWritten: false,
      hitlCreated: false,
      externalConnectorCalled: false,
    };
    const sourceActions = {
      inspected: ['dashboard-api.investmentBudgetCapExceptionGovernanceStatus'],
      referenced: [
        'investment-planning.review',
        'finance-agent.analyze',
        'vdmi.dossier',
        'evidence-registry.lookup',
        'presentation.generate',
        ...callerSourceActions,
      ],
      notCalled: [
        'investment.approve',
        'investment-planning.mutate',
        'budget.release',
        'committee.createDecision',
        'sap.psp.write',
        'erp.write',
        'finance.createBooking',
        'accounting.postJournal',
        'hitl.create',
        'workflow.create',
        'communication.send',
        'crm.update',
        'portal.write',
        'billing.release',
        'settlement.exportA96',
        'tariff.mutate',
        'mako.dispatch',
        'device-control.execute',
        'smgw.cls.execute',
        'external.connector.call',
        'personal-agent.execute',
      ],
    };
    const nextActions = positiveFollowUps.map((gap) => ({
      action: 'requestEvidence',
      missingDataPoint: gap.missingDataPoint,
      description: gap.enablesDossierAddition,
    }));
    const dossierFacts = [
      `Budget Cap Exception Status: ${status}`,
      `Measure: ${governanceContext.measureId || governanceContext.measureName || governanceContext.scope || 'missing'}`,
      `Budget Cap EUR: ${budgetCapEur ?? 'missing'}`,
      `Required Budget EUR: ${requiredBudgetEur ?? 'missing'}`,
      `Budget Delta EUR: ${budgetDeltaEur ?? 'missing'}`,
      `Exception Justification: ${governanceContext.exceptionJustificationStatus}`,
      `Owner: ${governanceContext.owner || 'missing'}`,
      `Next Gate: ${governanceContext.nextDecisionGate || 'missing'}`,
    ];

    return {
      investmentBudgetCapExceptionGovernanceStatusId: `ibceg:${Buffer.from(
        `${params.measureId || params.measureName || params.scope || ''}:${params.owner || ''}:${params.nextDecisionGate || ''}`
      )
        .toString('base64url')
        .slice(0, 28)}`,
      capabilityKey: 'investment_budget_cap_exception_governance',
      safety: 'read_only',
      status,
      readinessScore,
      budgetDeltaEur,
      exceptionJustificationStatus: governanceContext.exceptionJustificationStatus,
      governanceContext,
      missingEvidence,
      positiveFollowUps,
      nextActions,
      sourceDatapoints,
      sourceActions,
      decisionBoundary: {
        classificationOnly: true,
        budgetApproved: false,
        committeeDecisionCreated: false,
        productionMutation: false,
      },
      dossierEvidence: {
        status,
        readinessScore,
        budgetDeltaEur,
        exceptionJustificationStatus: governanceContext.exceptionJustificationStatus,
        governanceContext,
        missingEvidence,
        positiveFollowUps,
        nextActions,
        sourceDatapoints,
        sourceActions: { notCalled: sourceActions.notCalled },
        dossierFacts,
      },
    };
  },

  buildInvestmentOwnerDeadlineBudgetGateStatus(params = {}) {
    const toList = (value) => {
      if (Array.isArray(value))
        return value.map((item) => String(item || '').trim()).filter(Boolean);
      if (value && typeof value === 'string')
        return value
          .split(',')
          .map((item) => item.trim())
          .filter(Boolean);
      return [];
    };
    const isProvided = (value) =>
      value !== undefined && value !== null && String(value).trim() !== '';
    const sourceDatapoints = toList(params.sourceDatapoints);
    const callerSourceActions = toList(params.sourceActions);
    const requiredEvidence = toList(params.requiredEvidence);
    const gapMap = {
      measure_identity: 'add investment measure id or title',
      owner: 'assign or confirm the accountable investment measure owner',
      deadline: 'add deadline or target committee date evidence',
      budget_effect: 'clarify budget effect, envelope, overhang or funding impact',
      required_evidence: 'attach required approval or measure evidence',
      approval_status: 'add current approval status without approving the budget',
      blocked_follow_up_decision: 'name the follow-up decision blocked by this gate',
      next_escalation_step: 'define the next escalation step for the measure',
      source_datapoints: 'add source datapoints for auditability',
    };
    const missingEvidence = [];
    const addGap = (missingDataPoint) => {
      missingEvidence.push({
        missingDataPoint,
        status: 'missing',
        enablesDossierAddition: gapMap[missingDataPoint],
      });
    };

    if (!isProvided(params.measureId) && !isProvided(params.measureTitle))
      addGap('measure_identity');
    if (!isProvided(params.owner)) addGap('owner');
    if (!isProvided(params.deadline)) addGap('deadline');
    if (!isProvided(params.budgetEffect)) addGap('budget_effect');
    if (requiredEvidence.length === 0) addGap('required_evidence');
    if (!isProvided(params.approvalStatus)) addGap('approval_status');
    if (!isProvided(params.blockedFollowUpDecision)) addGap('blocked_follow_up_decision');
    if (!isProvided(params.nextEscalationStep)) addGap('next_escalation_step');
    if (sourceDatapoints.length === 0 && callerSourceActions.length === 0)
      addGap('source_datapoints');

    let status = 'ready_for_investment_gate_review';
    if (missingEvidence.some((gap) => gap.missingDataPoint === 'measure_identity')) {
      status = 'needs_measure_identity';
    } else if (
      missingEvidence.some(
        (gap) =>
          gap.missingDataPoint === 'owner' ||
          gap.missingDataPoint === 'deadline' ||
          gap.missingDataPoint === 'budget_effect'
      )
    ) {
      status = 'needs_owner_deadline_budget_evidence';
    } else if (
      missingEvidence.some(
        (gap) =>
          gap.missingDataPoint === 'approval_status' ||
          gap.missingDataPoint === 'next_escalation_step'
      )
    ) {
      status = 'needs_approval_or_escalation';
    } else if (missingEvidence.length > 0) {
      status = 'needs_gate_evidence';
    }

    const requiredCount = Object.keys(gapMap).length;
    const readinessScore = Number(
      ((requiredCount - missingEvidence.length) / requiredCount).toFixed(2)
    );
    const positiveFollowUps = missingEvidence.map((gap) => ({
      ...gap,
      category: 'investment_owner_deadline_budget_gate',
    }));
    const sourceActions = {
      inspected: ['dashboard-api.investmentOwnerDeadlineBudgetGateStatus'],
      referenced: [
        'investment-planning.review',
        'finance-agent.analyze',
        'vdmi.dossier',
        'evidence-registry.lookup',
        'presentation.generate',
        ...callerSourceActions,
      ],
      notCalled: [
        'investment.approve',
        'budget.release',
        'finance.createBooking',
        'accounting.postJournal',
        'treasury.executeTransfer',
        'hitl.create',
        'vdmi.mutate',
        'billing.release',
        'settlement.exportA96',
        'tariff.mutate',
        'mako.dispatch',
        'external.connector.call',
        'personal-agent.execute',
      ],
    };
    const measure = {
      measureId: params.measureId || null,
      measureTitle: params.measureTitle || null,
    };
    const gateEvidence = {
      owner: params.owner || null,
      deadline: params.deadline || null,
      budgetEffect: params.budgetEffect || null,
      requiredEvidence,
      approvalStatus: params.approvalStatus || null,
      blockedFollowUpDecision: params.blockedFollowUpDecision || null,
      nextEscalationStep: params.nextEscalationStep || null,
      budgetApproved: false,
      bookingCreated: false,
      hitlCreated: false,
      settlementExported: false,
      externalConnectorCalled: false,
    };
    const nextActions = positiveFollowUps.map((gap) => ({
      action: 'requestEvidence',
      missingDataPoint: gap.missingDataPoint,
      description: gap.enablesDossierAddition,
    }));
    const dossierFacts = [
      `Investment Gate Status: ${status}`,
      `Measure: ${measure.measureId || measure.measureTitle || 'missing'}`,
      `Owner: ${gateEvidence.owner || 'missing'}`,
      `Deadline: ${gateEvidence.deadline || 'missing'}`,
      `Budget Effect: ${gateEvidence.budgetEffect || 'missing'}`,
      `Approval Status: ${gateEvidence.approvalStatus || 'missing'}`,
      `Blocked Decision: ${gateEvidence.blockedFollowUpDecision || 'missing'}`,
      `Next Escalation: ${gateEvidence.nextEscalationStep || 'missing'}`,
    ];

    return {
      investmentOwnerDeadlineBudgetGateStatusId: `iodbg:${Buffer.from(
        `${params.measureId || params.measureTitle || ''}:${params.owner || ''}:${params.deadline || ''}`
      )
        .toString('base64url')
        .slice(0, 28)}`,
      capabilityKey: 'investment_owner_deadline_budget_gate',
      safety: 'read_only',
      status,
      readinessScore,
      measure,
      gateEvidence,
      missingEvidence,
      positiveFollowUps,
      nextActions,
      sourceDatapoints,
      sourceActions,
      dossierEvidence: {
        status,
        readinessScore,
        measure,
        gateEvidence,
        missingEvidence,
        positiveFollowUps,
        nextActions,
        sourceDatapoints,
        sourceActions: { notCalled: sourceActions.notCalled },
        dossierFacts,
      },
    };
  },

  buildDirectMarketerRiskGateStatus(params = {}) {
    const toList = (value) => {
      if (Array.isArray(value))
        return value.map((item) => String(item || '').trim()).filter(Boolean);
      if (value && typeof value === 'string')
        return value
          .split(',')
          .map((item) => item.trim())
          .filter(Boolean);
      return [];
    };
    const isProvided = (value) =>
      value !== undefined && value !== null && String(value).trim() !== '';
    const toNumber = (value) => {
      if (value === undefined || value === null || value === '') return null;
      const normalized =
        typeof value === 'string' ? value.replace(/\s/g, '').replace(',', '.') : value;
      const parsed = Number(normalized);
      return Number.isFinite(parsed) ? parsed : null;
    };

    const sourceEvidence = toList(params.sourceEvidence);
    const forecastDeviationPct = toNumber(params.forecastDeviationPct);
    const gapMap = {
      handover_context: 'add case, project, community model or direct marketer context',
      forecast_quality: 'add forecast-quality class and forecast deviation evidence',
      allocation_rules: 'add allocation-rule clarity for producer/consumer quantities',
      balancing_schedule_impact: 'add balancing-group and schedule-impact assessment',
      billing_settlement_status: 'add billing and settlement readiness evidence',
      role_owner: 'add accountable VNB/EVU role owner for the handover package',
      deadline: 'add offer, review or contract-release deadline',
      evidence_status: 'add handover evidence status and provenance references',
    };
    const missingEvidence = [];
    const addGap = (missingDataPoint) => {
      missingEvidence.push({
        missingDataPoint,
        status: 'missing',
        enablesDossierAddition: gapMap[missingDataPoint],
      });
    };

    if (
      !isProvided(params.caseId) &&
      !isProvided(params.projectId) &&
      !isProvided(params.communityModel) &&
      !isProvided(params.directMarketer)
    )
      addGap('handover_context');
    if (!isProvided(params.forecastQuality) || forecastDeviationPct === null)
      addGap('forecast_quality');
    if (!isProvided(params.allocationRules)) addGap('allocation_rules');
    if (!isProvided(params.balancingGroupImpact) || !isProvided(params.scheduleImpact))
      addGap('balancing_schedule_impact');
    if (!isProvided(params.billingStatus) || !isProvided(params.settlementStatus))
      addGap('billing_settlement_status');
    if (!isProvided(params.roleOwner)) addGap('role_owner');
    if (!isProvided(params.deadline)) addGap('deadline');
    if (!isProvided(params.evidenceStatus) && sourceEvidence.length === 0)
      addGap('evidence_status');

    let status = 'ready_for_direct_marketer_review';
    if (missingEvidence.some((gap) => gap.missingDataPoint === 'handover_context')) {
      status = 'needs_handover_context';
    } else if (
      missingEvidence.some((gap) =>
        ['forecast_quality', 'allocation_rules'].includes(gap.missingDataPoint)
      )
    ) {
      status = 'needs_forecast_and_allocation_evidence';
    } else if (
      missingEvidence.some((gap) => gap.missingDataPoint === 'balancing_schedule_impact')
    ) {
      status = 'needs_balancing_or_schedule_evidence';
    } else if (
      missingEvidence.some((gap) =>
        ['billing_settlement_status', 'role_owner', 'deadline'].includes(gap.missingDataPoint)
      )
    ) {
      status = 'needs_billing_or_role_evidence';
    } else if (missingEvidence.length > 0) {
      status = 'needs_handover_evidence';
    }

    const requiredCount = Object.keys(gapMap).length;
    const readinessScore = Number(
      ((requiredCount - missingEvidence.length) / requiredCount).toFixed(2)
    );
    const riskDimensions = [
      {
        id: 'forecast_quality',
        label: 'Forecast Quality',
        value: params.forecastQuality || null,
        forecastDeviationPct,
        status:
          isProvided(params.forecastQuality) && forecastDeviationPct !== null
            ? 'covered'
            : 'missing',
      },
      {
        id: 'allocation_rules',
        label: 'Allocation Rules',
        value: params.allocationRules || null,
        status: isProvided(params.allocationRules) ? 'covered' : 'missing',
      },
      {
        id: 'balancing_schedule_impact',
        label: 'Balancing Group / Schedule Impact',
        value: {
          balancingGroupImpact: params.balancingGroupImpact || null,
          scheduleImpact: params.scheduleImpact || null,
        },
        status:
          isProvided(params.balancingGroupImpact) && isProvided(params.scheduleImpact)
            ? 'covered'
            : 'missing',
      },
      {
        id: 'billing_settlement_status',
        label: 'Billing / Settlement Status',
        value: {
          billingStatus: params.billingStatus || null,
          settlementStatus: params.settlementStatus || null,
        },
        status:
          isProvided(params.billingStatus) && isProvided(params.settlementStatus)
            ? 'covered'
            : 'missing',
      },
      {
        id: 'role_deadline_ownership',
        label: 'Role / Deadline Ownership',
        value: {
          roleOwner: params.roleOwner || null,
          deadline: params.deadline || null,
        },
        status: isProvided(params.roleOwner) && isProvided(params.deadline) ? 'covered' : 'missing',
      },
    ];
    const handoverContext = {
      caseId: params.caseId || null,
      projectId: params.projectId || null,
      communityModel: params.communityModel || null,
      directMarketer: params.directMarketer || null,
    };
    const marketEvidence = {
      forecastQuality: params.forecastQuality || null,
      forecastDeviationPct,
      allocationRules: params.allocationRules || null,
      balancingGroupImpact: params.balancingGroupImpact || null,
      scheduleImpact: params.scheduleImpact || null,
      billingStatus: params.billingStatus || null,
      settlementStatus: params.settlementStatus || null,
      evidenceStatus: params.evidenceStatus || null,
      sourceEvidence,
    };
    const roleDeadline = {
      roleOwner: params.roleOwner || null,
      deadline: params.deadline || null,
    };
    const positiveFollowUps = missingEvidence.map((gap) => ({
      ...gap,
      category: 'direct_marketer_risk_gate',
    }));
    const nextActions = positiveFollowUps.map((gap) => ({
      action: 'requestEvidence',
      missingDataPoint: gap.missingDataPoint,
      owner: params.roleOwner || null,
      description: gap.enablesDossierAddition,
    }));
    const sourceActions = {
      inspected: ['dashboard-api.directMarketerRiskGateStatus'],
      referenced: [
        'vdmi.dossier',
        'evidence-registry.lookup',
        'market-communication.evidence',
        'settlement.readiness',
        'presentation.generate',
      ],
      notCalled: [
        'market.executeTrade',
        'schedule.submit',
        'balancing-group.transfer',
        'direct-marketer.offer.approve',
        'contract.approve',
        'billing.release',
        'settlement.prepareBilling',
        'settlement.exportA96',
        'tariff.mutate',
        'customer-communication.send',
        'hitl.create',
        'workflow.execute',
        'webhook.emit',
        'external.connector.call',
        'device-control.execute',
        'personal-agent.execute',
      ],
    };
    const decisionBoundary = {
      marketExecution: false,
      scheduleSubmitted: false,
      contractApproved: false,
      balancingGroupTransferred: false,
      billingReleased: false,
      externalConnectorCalled: false,
      productionMutation: false,
    };
    const dossierFacts = [
      `Direct Marketer Risk Gate Status: ${status}`,
      `Case: ${handoverContext.caseId || handoverContext.projectId || 'missing'}`,
      `Direct Marketer: ${handoverContext.directMarketer || 'missing'}`,
      `Forecast Quality: ${marketEvidence.forecastQuality || 'missing'}`,
      `Allocation Rules: ${marketEvidence.allocationRules || 'missing'}`,
      `Role Owner: ${roleDeadline.roleOwner || 'missing'}`,
      `Open gaps: ${missingEvidence.length}`,
    ];

    return {
      directMarketerRiskGateStatusId: `dmrg:${Buffer.from(
        `${params.caseId || params.projectId || ''}:${params.directMarketer || ''}:${params.roleOwner || ''}`
      )
        .toString('base64url')
        .slice(0, 28)}`,
      capabilityKey: 'direct_marketer_risk_gate',
      safety: 'read_only',
      status,
      readinessScore,
      handoverContext,
      marketEvidence,
      roleDeadline,
      riskDimensions,
      missingEvidence,
      positiveFollowUps,
      nextActions,
      sourceActions,
      decisionBoundary,
      dossierEvidence: {
        status,
        readinessScore,
        handoverContext,
        marketEvidence,
        roleDeadline,
        riskDimensions,
        missingEvidence,
        positiveFollowUps,
        nextActions,
        sourceActions: { notCalled: sourceActions.notCalled },
        decisionBoundary,
        dossierFacts,
      },
    };
  },

  buildNoRegretMeasureDefinitionGateStatus(params = {}) {
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
    const isProvided = (value) =>
      value !== undefined && value !== null && String(value).trim() !== '';

    const sourceDatapoints = toList(params.sourceDatapoints);
    const callerSourceActions = toList(params.sourceActions);
    const gapMap = {
      measure_identity: 'add measure and programme identity for the No-Regret definition',
      scenario_effect: 'add scenario assumption and expected transformation effect',
      budget_funding: 'add budget effect and funding owner basis',
      regulatory_fit: 'add regulatory-fit or constraint boundary',
      prioritisation_rule: 'add prioritisation or nomination rule justification',
      data_quality: 'add data-quality status and source snapshot',
      communication_rule: 'add communication rule and stakeholder boundary',
      review_gate: 'add next review gate, due date and accountable owner',
      source_datapoints: 'add source datapoints or source actions for provenance',
    };
    const missingEvidence = [];
    const addGap = (missingDataPoint) => {
      missingEvidence.push({
        missingDataPoint,
        status: 'missing',
        enablesDossierAddition: gapMap[missingDataPoint],
      });
    };

    if (
      !isProvided(params.measureId) &&
      !isProvided(params.measureName) &&
      !isProvided(params.programmeId)
    )
      addGap('measure_identity');
    if (!isProvided(params.scenarioAssumption) || !isProvided(params.transformationEffect))
      addGap('scenario_effect');
    if (!isProvided(params.budgetEffect) || !isProvided(params.fundingOwner))
      addGap('budget_funding');
    if (!isProvided(params.regulatoryFit) && !isProvided(params.constraintHint))
      addGap('regulatory_fit');
    if (!isProvided(params.prioritisationRule) && !isProvided(params.nominationRight))
      addGap('prioritisation_rule');
    if (!isProvided(params.dataQualityStatus) || !isProvided(params.sourceSnapshot))
      addGap('data_quality');
    if (!isProvided(params.communicationRule) || !isProvided(params.stakeholderGroup))
      addGap('communication_rule');
    if (
      !isProvided(params.nextReviewGate) ||
      !isProvided(params.dueDate) ||
      !isProvided(params.owner)
    )
      addGap('review_gate');
    if (sourceDatapoints.length === 0 && callerSourceActions.length === 0)
      addGap('source_datapoints');

    let status = 'ready_for_no_regret_gate_review';
    if (missingEvidence.some((gap) => gap.missingDataPoint === 'measure_identity')) {
      status = 'needs_measure_identity';
    } else if (missingEvidence.some((gap) => gap.missingDataPoint === 'scenario_effect')) {
      status = 'needs_scenario_effect_basis';
    } else if (missingEvidence.some((gap) => gap.missingDataPoint === 'budget_funding')) {
      status = 'needs_budget_funding_basis';
    } else if (
      missingEvidence.some(
        (gap) =>
          gap.missingDataPoint === 'regulatory_fit' ||
          gap.missingDataPoint === 'prioritisation_rule'
      )
    ) {
      status = 'needs_definition_boundary';
    } else if (missingEvidence.length > 0) {
      status = 'needs_definition_evidence';
    }

    const requiredCount = Object.keys(gapMap).length;
    const readinessScore = Number(
      ((requiredCount - missingEvidence.length) / requiredCount).toFixed(2)
    );
    const positiveFollowUps = missingEvidence.map((gap) => ({
      ...gap,
      category: 'no_regret_measure_definition_gate',
    }));
    const sourceActions = {
      inspected: ['dashboard-api.noRegretMeasureDefinitionGateStatus'],
      referenced: [
        'vdmi.dossier',
        'evidence-registry.lookup',
        'investment-planning.review',
        'finance-agent.analyze',
        'datasource-registry.get',
        'presentation.generate',
        ...callerSourceActions,
      ],
      notCalled: [
        'transformation-program.mutate',
        'measure.approve',
        'budget.release',
        'finance.createBooking',
        'accounting.postJournal',
        'treasury.executeTransfer',
        'hitl.create',
        'vdmi.mutate',
        'device-control.execute',
        'billing.release',
        'settlement.exportA96',
        'tariff.mutate',
        'mako.dispatch',
        'external.connector.call',
        'personal-agent.execute',
      ],
    };
    const measure = {
      measureId: params.measureId || null,
      programmeId: params.programmeId || null,
      measureName: params.measureName || null,
    };
    const definitionEvidence = {
      scenarioAssumption: params.scenarioAssumption || null,
      transformationEffect: params.transformationEffect || null,
      budgetEffect: params.budgetEffect || null,
      fundingOwner: params.fundingOwner || null,
      regulatoryFit: params.regulatoryFit || null,
      constraintHint: params.constraintHint || null,
      prioritisationRule: params.prioritisationRule || null,
      nominationRight: params.nominationRight || null,
      dataQualityStatus: params.dataQualityStatus || null,
      sourceSnapshot: params.sourceSnapshot || null,
      communicationRule: params.communicationRule || null,
      stakeholderGroup: params.stakeholderGroup || null,
      nextReviewGate: params.nextReviewGate || null,
      dueDate: params.dueDate || null,
      owner: params.owner || null,
      measureApproved: false,
      budgetApproved: false,
      programmeMutated: false,
      hitlCreated: false,
      settlementExported: false,
      externalConnectorCalled: false,
    };
    const nextActions = positiveFollowUps.map((gap) => ({
      action: 'requestEvidence',
      missingDataPoint: gap.missingDataPoint,
      description: gap.enablesDossierAddition,
    }));
    const dossierFacts = [
      `No-Regret Gate Status: ${status}`,
      `Measure: ${measure.measureId || measure.measureName || measure.programmeId || 'missing'}`,
      `Scenario Effect: ${definitionEvidence.transformationEffect || 'missing'}`,
      `Budget Effect: ${definitionEvidence.budgetEffect || 'missing'}`,
      `Regulatory Fit: ${definitionEvidence.regulatoryFit || definitionEvidence.constraintHint || 'missing'}`,
      `Prioritisation: ${definitionEvidence.prioritisationRule || definitionEvidence.nominationRight || 'missing'}`,
      `Data Quality: ${definitionEvidence.dataQualityStatus || 'missing'}`,
      `Communication Rule: ${definitionEvidence.communicationRule || 'missing'}`,
      `Next Review Gate: ${definitionEvidence.nextReviewGate || 'missing'}`,
    ];

    return {
      noRegretMeasureDefinitionGateStatusId: `nrg:${Buffer.from(
        `${params.measureId || params.measureName || params.programmeId || ''}:${params.owner || ''}:${params.nextReviewGate || ''}`
      )
        .toString('base64url')
        .slice(0, 28)}`,
      capabilityKey: 'no_regret_measure_definition_gate',
      safety: 'read_only',
      status,
      readinessScore,
      measure,
      definitionEvidence,
      missingEvidence,
      positiveFollowUps,
      nextActions,
      sourceDatapoints,
      sourceActions,
      dossierEvidence: {
        status,
        readinessScore,
        measure,
        definitionEvidence,
        missingEvidence,
        positiveFollowUps,
        nextActions,
        sourceDatapoints,
        sourceActions: { notCalled: sourceActions.notCalled },
        dossierFacts,
      },
    };
  },

  buildGasGridTransformationAssetCockpitStatus(params = {}) {
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
    const toNumber = (value) => {
      if (value === undefined || value === null || value === '') return null;
      const normalized =
        typeof value === 'string' ? value.replace(/\s/g, '').replace(',', '.') : value;
      const n = Number(normalized);
      return Number.isFinite(n) ? n : null;
    };
    const isProvided = (value) =>
      value !== undefined && value !== null && String(value).trim() !== '';

    const sourceDatapoints = toList(params.sourceDatapoints);
    const callerSourceActions = toList(params.sourceActions);
    const decommissioningCostEur = toNumber(params.decommissioningCostEur);
    const missingEvidence = [];
    const missingMap = {
      program_identity: 'adds gas transformation program and work-package identity to the dossier.',
      asset_segment_scope: 'adds segment-level asset scope and affected infrastructure boundaries.',
      target_option:
        'adds the selected continue-gas, H2-reuse, decommissioning, repurpose or defer-decision option.',
      technical_reuse_status:
        'adds technical reuse feasibility evidence for the gas asset segment.',
      decommissioning_cost_basis:
        'adds rollback/removal cost evidence and committee cost exposure.',
      financial_impact_basis: 'adds cashflow, TOTEX and regulatory recognition facts.',
      dependency_review:
        'adds heat-network, power-grid and customer-transition dependency evidence.',
      decision_gate_owner: 'adds the next committee gate and accountable owner role.',
      source_datapoints: 'adds source datapoint or action provenance for every cockpit statement.',
    };
    const addGap = (id) => {
      if (!missingEvidence.some((gap) => gap.missingDataPoint === id)) {
        missingEvidence.push({
          missingDataPoint: id,
          enablesDossierAddition: missingMap[id],
        });
      }
    };

    if (
      !isProvided(params.gridOperatorId) ||
      !isProvided(params.transformationProgramId) ||
      !isProvided(params.workPackageId)
    ) {
      addGap('program_identity');
    }
    if (!isProvided(params.assetSegmentRef)) addGap('asset_segment_scope');
    if (!isProvided(params.targetOption)) addGap('target_option');
    if (!isProvided(params.technicalReuseStatus)) addGap('technical_reuse_status');
    if (decommissioningCostEur == null && !isProvided(params.rollbackOrRemovalRisk)) {
      addGap('decommissioning_cost_basis');
    }
    if (
      !isProvided(params.cashflowImpact) ||
      !isProvided(params.totexImpact) ||
      !isProvided(params.regulatoryRecognitionStatus)
    ) {
      addGap('financial_impact_basis');
    }
    if (
      !isProvided(params.heatNetworkDependency) ||
      !isProvided(params.powerGridDependency) ||
      !isProvided(params.customerTransitionDependency)
    ) {
      addGap('dependency_review');
    }
    if (!isProvided(params.decisionGate) || !isProvided(params.ownerRole)) {
      addGap('decision_gate_owner');
    }
    if (sourceDatapoints.length === 0 && callerSourceActions.length === 0)
      addGap('source_datapoints');

    let status = 'ready_for_committee';
    if (missingEvidence.some((gap) => gap.missingDataPoint === 'program_identity')) {
      status = 'needs_program_identity';
    } else if (missingEvidence.some((gap) => gap.missingDataPoint === 'asset_segment_scope')) {
      status = 'needs_asset_scope';
    } else if (missingEvidence.some((gap) => gap.missingDataPoint === 'target_option')) {
      status = 'needs_target_option';
    } else if (missingEvidence.some((gap) => gap.missingDataPoint === 'technical_reuse_status')) {
      status = 'needs_h2_assessment';
    } else if (
      missingEvidence.some((gap) => gap.missingDataPoint === 'decommissioning_cost_basis')
    ) {
      status = 'needs_decommissioning_cost';
    } else if (missingEvidence.some((gap) => gap.missingDataPoint === 'financial_impact_basis')) {
      status = 'needs_finance_review';
    } else if (missingEvidence.some((gap) => gap.missingDataPoint === 'dependency_review')) {
      status = 'needs_dependency_review';
    } else if (missingEvidence.some((gap) => gap.missingDataPoint === 'decision_gate_owner')) {
      status = 'needs_decision_gate';
    } else if (missingEvidence.length > 0) {
      status = 'needs_source_evidence';
    }

    const requiredCount = Object.keys(missingMap).length;
    const readinessScore = Number(
      ((requiredCount - missingEvidence.length) / requiredCount).toFixed(2)
    );
    const sourceActions = {
      inspected: ['dashboard-api.gasGridTransformationAssetCockpitStatus'],
      referenced: [
        'datasource-registry.get',
        'datapoint.health',
        'investment-planning.createPlan',
        'finance-agent.analyze',
        'znp.assessPortfolio',
        'assets.all',
        'gas-storage.countryStorage',
        'vdmi.dossier',
        'presentation.generate',
        ...callerSourceActions,
      ],
      notCalled: [
        'gas-assets.create',
        'gas-assets.update',
        'gas-assets.applyDecommissioning',
        'gas-grid.optimizeTargetNetwork',
        'h2-feasibility.execute',
        'investment.approve',
        'finance.createBooking',
        'treasury.executeTransfer',
        'accounting.postJournal',
        'hitl.create',
        'vdmi.taskMutate',
        'settlement.exportA96',
        'billing.prepareInvoice',
        'tariff.mutate',
        'mako.dispatch',
        'external.connector.call',
        'personal-agent.execute',
      ],
    };
    const programSummary = {
      gridOperatorId: params.gridOperatorId || null,
      transformationProgramId: params.transformationProgramId || null,
      workPackageId: params.workPackageId || null,
      vdmiProcessId: params.vdmiProcessId || null,
      investmentPlanId: params.investmentPlanId || null,
      financeAnalysisId: params.financeAnalysisId || null,
    };
    const evidenceGroups = {
      assetScope: {
        assetSegmentRef: params.assetSegmentRef || null,
        targetOption: params.targetOption || null,
        gasAssetMutated: false,
      },
      technicalReuse: {
        technicalReuseStatus: params.technicalReuseStatus || null,
        h2FeasibilityExecuted: false,
      },
      decommissioning: {
        decommissioningCostEur,
        rollbackOrRemovalRisk: params.rollbackOrRemovalRisk || null,
        decommissioningApplied: false,
      },
      financialImpact: {
        cashflowImpact: params.cashflowImpact || null,
        totexImpact: params.totexImpact || null,
        regulatoryRecognitionStatus: params.regulatoryRecognitionStatus || null,
        investmentApproved: false,
        financeBookingCreated: false,
      },
      dependencies: {
        heatNetworkDependency: params.heatNetworkDependency || null,
        powerGridDependency: params.powerGridDependency || null,
        customerTransitionDependency: params.customerTransitionDependency || null,
      },
      committeeGate: {
        decisionGate: params.decisionGate || null,
        ownerRole: params.ownerRole || null,
        hitlCreated: false,
      },
    };
    const positiveFollowUps = missingEvidence.map((gap) => ({
      ...gap,
      category: 'gas_grid_transformation_asset_cockpit',
    }));
    const nextActions = positiveFollowUps.map((gap) => ({
      action: 'requestEvidence',
      missingDataPoint: gap.missingDataPoint,
      description: gap.enablesDossierAddition,
    }));
    const dossierFacts = [
      `Gas Grid Transformation Status: ${status}`,
      `Program: ${programSummary.transformationProgramId || 'missing'}`,
      `Work Package: ${programSummary.workPackageId || 'missing'}`,
      `Asset Segment: ${evidenceGroups.assetScope.assetSegmentRef || 'missing'}`,
      `Target Option: ${evidenceGroups.assetScope.targetOption || 'missing'}`,
      `Technical Reuse: ${evidenceGroups.technicalReuse.technicalReuseStatus || 'missing'}`,
      `Decommissioning Cost: ${decommissioningCostEur == null ? 'missing' : decommissioningCostEur}`,
      `Financial Impact: ${evidenceGroups.financialImpact.cashflowImpact || 'missing'} / ${evidenceGroups.financialImpact.totexImpact || 'missing'}`,
      `Dependencies: ${evidenceGroups.dependencies.heatNetworkDependency || 'missing'} / ${evidenceGroups.dependencies.powerGridDependency || 'missing'} / ${evidenceGroups.dependencies.customerTransitionDependency || 'missing'}`,
      `Decision Gate: ${evidenceGroups.committeeGate.decisionGate || 'missing'}`,
    ];

    return {
      capabilityKey: 'gas_grid_transformation_asset_cockpit',
      safety: 'read_only',
      status,
      readinessScore,
      programSummary,
      decisionReadiness: {
        status,
        readinessScore,
        missingCount: missingEvidence.length,
      },
      evidenceGroups,
      sourceDatapoints,
      missingEvidence,
      positiveFollowUps,
      nextActions,
      sourceActions,
      dossierEvidence: {
        capabilityKey: 'gas_grid_transformation_asset_cockpit',
        status,
        readinessScore,
        programSummary,
        decisionReadiness: status,
        evidenceGroups,
        sourceDatapoints,
        missingEvidence,
        positiveFollowUps,
        nextActions,
        sourceActions: { notCalled: sourceActions.notCalled },
        dossierFacts,
      },
    };
  },

  buildLiveUpdateStreamContractStatus(params = {}) {
    const toList = (value) => {
      if (Array.isArray(value)) return value.map((item) => String(item).trim()).filter(Boolean);
      if (value && typeof value === 'string') {
        return value
          .split(',')
          .map((item) => item.trim())
          .filter(Boolean);
      }
      return [];
    };
    const isProvided = (value) =>
      value !== undefined && value !== null && String(value).trim() !== '';
    const normalizeKey = (value) =>
      String(value || '')
        .trim()
        .toLowerCase()
        .replace(/[^a-z0-9]+/g, '_')
        .replace(/^_+|_+$/g, '');
    const titleize = (value) =>
      String(value || '')
        .trim()
        .replace(/[_-]+/g, ' ');
    const inferTransport = (key) => {
      if (/websocket|ws\b/.test(key)) return 'websocket';
      if (/polling|fallback/.test(key)) return 'polling_fallback';
      return 'sse_eventsource';
    };
    const inferFallback = (key) => {
      if (/hitl/.test(key)) return '/api/hitl/items';
      if (/rag|knowledge/.test(key)) return '/api/knowledge-rag/jobs/:id';
      if (/mastr/.test(key)) return '/api/mastr-monitor/watches/:id';
      if (/job/.test(key)) return '/api/jobs/:id';
      if (/nova/.test(key)) return '/api/nova/status';
      if (/cya|session/.test(key)) return '/api/cya/sessions/:id';
      if (/observability|log/.test(key)) return '/api/observability/mini';
      return null;
    };
    const defaultSource = (key) => {
      if (/hitl/.test(key)) return { sourceService: 'hitl', sourceAction: 'list' };
      if (/rag|knowledge/.test(key))
        return { sourceService: 'knowledge-rag', sourceAction: 'getJob' };
      if (/mastr/.test(key)) return { sourceService: 'mastr-monitor', sourceAction: 'getWatch' };
      if (/job/.test(key)) return { sourceService: 'jobs', sourceAction: 'get' };
      if (/nova/.test(key)) return { sourceService: 'nova', sourceAction: 'status' };
      if (/cya|session/.test(key)) return { sourceService: 'cya', sourceAction: 'getSession' };
      if (/observability|log/.test(key))
        return { sourceService: 'observability', sourceAction: 'mini' };
      return { sourceService: null, sourceAction: null };
    };

    const requested = [...toList(params.channels), ...toList(params.domains)];
    if (requested.length === 0) requested.push(params.uiSurface || 'dashboard.live-updates');
    if (params.includeUnsupportedSample) requested.push('unsupported-domain');

    const missingMap = {
      missing_channel: 'adds the concrete UI channel or domain that needs live-update evidence.',
      missing_source_service: 'adds source-service binding evidence for the proposed channel.',
      missing_source_action: 'adds domain action contract evidence for the proposed channel.',
      missing_auth_boundary: 'adds tenant/auth readiness evidence.',
      missing_fallback_polling_path: 'adds the safe polling fallback path for UI clients.',
      missing_resume_policy: 'adds heartbeat/resume contract evidence.',
      unsupported_channel:
        'adds product/architecture decision evidence before any stream is claimed.',
    };
    const missingEvidence = [];
    const addGap = (id, channelKey) => {
      if (
        !missingEvidence.some((gap) => gap.missingDataPoint === id && gap.channelKey === channelKey)
      ) {
        missingEvidence.push({
          missingDataPoint: id,
          channelKey,
          enablesDossierAddition: missingMap[id],
        });
      }
    };

    const channels = requested.map((raw, index) => {
      const channelKey = normalizeKey(raw) || `channel_${index + 1}`;
      const source = defaultSource(channelKey);
      const sourceService = params.sourceService || source.sourceService;
      const sourceAction = params.sourceAction || source.sourceAction;
      const fallbackPollingPath = params.fallbackPollingPath || inferFallback(channelKey);
      const explicitUnsupported = /unsupported|not_supported|unknown/.test(channelKey);
      const availability = explicitUnsupported ? 'not_supported' : params.availability || 'planned';
      const requiresResume =
        params.requiresResume !== undefined ? Boolean(params.requiresResume) : true;
      const resumePolicy = requiresResume
        ? {
            required: true,
            heartbeatSeconds: params.heartbeatSeconds || 15,
            lastEventId: 'expected_for_future_transport',
          }
        : { required: false, heartbeatSeconds: params.heartbeatSeconds || 15 };
      const item = {
        key: channelKey,
        label: titleize(raw) || 'dashboard live updates',
        proposedTransport: inferTransport(channelKey),
        availability,
        safety: 'read_only_contract_only',
        tenantBoundary: params.authBoundary || 'bearer_token_and_x_tenant_id',
        authBoundary: params.authBoundary || 'bearer_token_and_x_tenant_id',
        uiSurface: params.uiSurface || 'dashboard',
        sourceService,
        sourceAction,
        fallbackPollingPath,
        resumePolicy,
        ownerRole: params.ownerRole || 'platform-api',
        blockers: [],
      };
      if (!isProvided(raw)) addGap('missing_channel', channelKey);
      if (!sourceService) addGap('missing_source_service', channelKey);
      if (!sourceAction) addGap('missing_source_action', channelKey);
      if (!isProvided(item.authBoundary)) addGap('missing_auth_boundary', channelKey);
      if (!fallbackPollingPath) addGap('missing_fallback_polling_path', channelKey);
      if (requiresResume && !resumePolicy.heartbeatSeconds)
        addGap('missing_resume_policy', channelKey);
      if (explicitUnsupported) {
        item.blockers.push(
          'No supported source service/action or fallback path is declared for this channel.'
        );
        addGap('unsupported_channel', channelKey);
      }
      item.contractComplete =
        item.availability !== 'not_supported' &&
        Boolean(
          item.sourceService && item.sourceAction && item.fallbackPollingPath && item.authBoundary
        );
      return item;
    });

    const status = channels.some((channel) => channel.availability === 'not_supported')
      ? 'unsupported_channel'
      : channels.every((channel) => channel.contractComplete)
        ? 'contract_ready'
        : 'needs_contract_evidence';
    const sourceActions = {
      inspected: ['dashboard-api.liveUpdateStreamContractStatus'],
      referenced: channels
        .flatMap((channel) => [
          channel.sourceService && channel.sourceAction
            ? `${channel.sourceService}.${channel.sourceAction}`
            : null,
          channel.fallbackPollingPath,
        ])
        .filter(Boolean),
      notCalled: [
        'sse.openConnection',
        'websocket.upgrade',
        'stream.subscribe',
        'stream.multiplex',
        'stream.replay',
        'event-emitter.emit',
        'observability.tailLogs',
        'auth.createTokenMode',
        'hitl.create',
        'nova.apply',
        'cya.sessionMutate',
        'knowledge-rag.ingest',
        'mastr-monitor.createWatch',
        'external.connector.call',
        'personal-agent.execute',
      ],
    };
    const positiveFollowUps = missingEvidence.map((gap) => ({
      ...gap,
      category: 'live_update_stream_contract_status',
    }));
    const dossierFacts = [
      `Live Update Contract Status: ${status}`,
      `Channel Count: ${channels.length}`,
      ...channels.map(
        (channel) =>
          `${channel.key}: ${channel.availability} via ${channel.proposedTransport}; fallback ${channel.fallbackPollingPath || 'missing'}`
      ),
    ];

    return {
      capabilityKey: 'live_update_stream_contract_status',
      safety: 'read_only',
      status,
      channelCount: channels.length,
      channels,
      missingEvidence,
      positiveFollowUps,
      nextActions: positiveFollowUps.map((gap) => ({
        action: 'requestEvidence',
        missingDataPoint: gap.missingDataPoint,
        description: gap.enablesDossierAddition,
      })),
      sourceActions,
      dossierEvidence: {
        capabilityKey: 'live_update_stream_contract_status',
        status,
        channelCount: channels.length,
        channels: channels.map((channel) => ({
          key: channel.key,
          availability: channel.availability,
          proposedTransport: channel.proposedTransport,
          fallbackPollingPath: channel.fallbackPollingPath,
          authBoundary: channel.authBoundary,
          ownerRole: channel.ownerRole,
        })),
        missingEvidence,
        positiveFollowUps,
        sourceActions: { notCalled: sourceActions.notCalled },
        dossierFacts,
      },
      _errors: [],
    };
  },

  unwrapVnbdigitalSearchResults(response) {
    const root = response?.data && typeof response.data === 'object' ? response.data : response;
    return Array.isArray(root?.results) ? root.results : [];
  },

  unwrapVnbdigitalLookupVnbs(response) {
    const root = response?.data && typeof response.data === 'object' ? response.data : response;
    return Array.isArray(root?.result?.vnbs) ? root.result.vnbs : [];
  },

  pickMunicipalVnbdigitalSearchResult(results = []) {
    const normalized = Array.isArray(results) ? results : [];
    return (
      normalized.find(
        (item) => String(item?.entityType || item?.type || '').toLowerCase() === 'community'
      ) ||
      normalized.find(
        (item) => String(item?.entityType || item?.type || '').toLowerCase() === 'postcode'
      ) ||
      normalized.find(
        (item) => String(item?.entityType || item?.type || '').toLowerCase() === 'location'
      ) ||
      null
    );
  },

  vnbdigitalLookupParamsForSearchResult(searchResult) {
    const type = String(searchResult?.entityType || searchResult?.type || '').toLowerCase();
    const entityId = searchResult?.entityId || searchResult?._id || searchResult?.id || null;
    if (!entityId) return null;
    if (type === 'community') {
      return {
        searchType: 'community',
        communityId: entityId,
        filter: { onlyNap: true, voltageTypes: ['Niederspannung'], withRegions: false },
      };
    }
    if (type === 'postcode') {
      return {
        searchType: 'postcode',
        postcodeId: entityId,
        filter: { onlyNap: true, voltageTypes: ['Niederspannung'], withRegions: false },
      };
    }
    const url = String(searchResult?.url || '');
    const coordinates = url.match(/coordinates=([^&]+)/)?.[1];
    if (type === 'location' && coordinates) {
      return {
        searchType: 'coordinates',
        coordinates: decodeURIComponent(coordinates),
        filter: { onlyNap: true, voltageTypes: ['Niederspannung'], withRegions: false },
      };
    }
    return null;
  },

  pickMunicipalVnb(vnbs = []) {
    const normalized = Array.isArray(vnbs) ? vnbs : [];
    return (
      normalized.find((vnb) =>
        Array.isArray(vnb?.voltageTypes)
          ? vnb.voltageTypes.some((type) => /niederspannung/i.test(String(type)))
          : true
      ) ||
      normalized[0] ||
      null
    );
  },
};
