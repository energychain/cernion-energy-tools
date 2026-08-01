'use strict';

// dashboard-api methods chunk 11/14 — extracted verbatim from
// services/dashboard-api.service.js as part of the v0.99 file-size modularization.
// Contains: humanizeWorkbenchLabel, buildStadtwerkMauerMastrPublicContextRows, buildStadtwerkMauerMastrOverlayAssetRows, buildStadtwerkMauerMastrRevalidationRows, buildStadtwerkMauerMastrAffectedCaseRows, buildStadtwerkMauerMastrNextGateRows, buildStadtwerkMauerMastrSafeActionRows, buildStadtwerkMauerMastrBoundaryRows, buildMissingStadtwerkMauerMastrDataOverlayStatus, buildFnavFastTrackContractGateStatus, buildNetzsignalDeltaGatingStatus, buildVnbDeltaSignalClassifierStatus, buildEvidenceFreshnessGuardStatus, buildCrossDomainSpecialTopicsQueueStatus, buildCrossChannelVnbSignalQueueStatus, buildAssetValuationTransformationGateStatus

module.exports = {
  humanizeWorkbenchLabel(value) {
    if (value == null) return null;
    return String(value)
      .replace(/^ROLE_/, '')
      .replace(/([a-z0-9])([A-Z])/g, '$1 $2')
      .replace(/[_:-]+/g, ' ')
      .replace(/\s+/g, ' ')
      .trim()
      .replace(/\b\w/g, (char) => char.toUpperCase());
  },

  buildStadtwerkMauerMastrPublicContextRows(status = {}) {
    const operators = Array.isArray(status.originalGridOperators)
      ? status.originalGridOperators
      : [];
    const rows = [
      {
        rowKey: 'municipality',
        label: 'Municipality',
        value: status.municipality || 'Mauer',
        sourceClass: 'public_context_layer',
        evidenceStatus: status.evidenceQuality || status.status || 'unknown',
        provenance: 'MaStR/OSM public context',
      },
      {
        rowKey: 'postal_code',
        label: 'Postal Code',
        value: status.postalCode || '69256',
        sourceClass: 'public_context_layer',
        evidenceStatus: status.evidenceQuality || status.status || 'unknown',
        provenance: 'MaStR/OSM public context',
      },
      {
        rowKey: 'asset_count',
        label: 'Public MaStR Assets',
        value: status.assetCount == null ? 0 : status.assetCount,
        sourceClass: 'public_context_layer',
        evidenceStatus: status.evidenceQuality || status.status || 'unknown',
        provenance: 'energy-market.installations',
      },
      {
        rowKey: 'total_capacity_kw',
        label: 'Total Capacity kW',
        value: status.totalCapacityKw == null ? 0 : status.totalCapacityKw,
        sourceClass: 'public_context_layer',
        evidenceStatus: status.evidenceQuality || status.status || 'unknown',
        provenance: 'energy-market.installations',
      },
    ];
    for (const [index, operator] of operators.entries()) {
      rows.push({
        rowKey: `original_operator_${index + 1}`,
        label: 'Original Grid Operator',
        value: operator.name || operator.mastrId || 'unknown',
        sourceClass: 'public_context_layer',
        evidenceStatus: status.evidenceQuality || status.status || 'unknown',
        provenance: operator.mastrId || 'MaStR operator provenance',
      });
    }
    return rows;
  },

  buildStadtwerkMauerMastrOverlayAssetRows(status = {}) {
    const sampleAssets = Array.isArray(status.sampleAssets) ? status.sampleAssets : [];
    if (sampleAssets.length === 0) {
      return [
        {
          rowKey: 'overlay_asset_unavailable',
          assetId: 'not_available',
          assetType: 'not_available',
          capacityKw: 0,
          originalGridOperatorName:
            status.operatorOverlay?.realWorldOperatorHint?.name || 'Syna GmbH',
          virtualGridOperatorName:
            status.operatorOverlay?.virtualGridOperator?.name || 'Stadtwerk Mauer',
          sourceClass: 'public_context_layer',
          overlayClass: 'synthetic_tenant_seed',
          evidenceStatus: status.status || 'overlay_asset_unavailable',
        },
      ];
    }
    return sampleAssets.map((asset, index) => ({
      rowKey: `overlay_asset_${index + 1}`,
      assetId: asset.mastrNummer || asset.assetId || `asset_${index + 1}`,
      assetType: asset.assetType || 'unknown',
      capacityKw: asset.capacityKw == null ? 0 : asset.capacityKw,
      originalGridOperatorName: asset.originalGridOperatorName || 'unknown',
      virtualGridOperatorName: asset.virtualGridOperatorName || 'Stadtwerk Mauer',
      sourceClass: 'public_context_layer',
      overlayClass: 'synthetic_tenant_seed',
      evidenceStatus: status.evidenceQuality || status.status || 'unknown',
    }));
  },

  buildStadtwerkMauerMastrRevalidationRows(status = {}, params = {}) {
    const mode = String(params.revalidationMode || '').toLowerCase();
    const queryFailed = Boolean(status.mastrQuery?.queryFailed);
    const observedStatus =
      mode === 'drill'
        ? 'synthetic_revalidation_drill'
        : queryFailed
          ? 'source_unavailable_or_not_watched'
          : 'no_delta_observed';
    const evidenceStatus =
      observedStatus === 'no_delta_observed'
        ? 'public_context_current_for_demo'
        : observedStatus === 'synthetic_revalidation_drill'
          ? 'synthetic_drill_requires_review'
          : 'source_watch_unavailable';
    return [
      {
        rowKey: 'mastr_revalidation_status',
        revalidationStatus: observedStatus,
        evidenceStatus,
        sourceClass:
          observedStatus === 'synthetic_revalidation_drill'
            ? 'synthetic_revalidation_drill'
            : 'public_context_layer',
        affectedCaseId: params.caseId || 'smm-budibase-workbench',
        watchId: params.watchId || 'not_configured',
        deltaCount: observedStatus === 'public_context_delta_observed' ? 1 : 0,
        safeNextAction:
          observedStatus === 'no_delta_observed'
            ? 'refresh_mastr_overlay_read_model'
            : 'review_public_context_delta_before_case_claim',
      },
    ];
  },

  buildStadtwerkMauerMastrAffectedCaseRows(status = {}, params = {}, revalidationRows = []) {
    const revalidationStatus =
      revalidationRows[0]?.revalidationStatus || 'source_unavailable_or_not_watched';
    return [
      {
        rowKey: 'affected_case',
        caseId: params.caseId || 'smm-budibase-workbench',
        workbenchItemId: params.queueItemId || 'grid-planning:missing-nap-clarification',
        sourceClass: 'synthetic_tenant_seed',
        affectedByPublicContext: revalidationStatus !== 'no_delta_observed',
        impactStatus:
          revalidationStatus === 'no_delta_observed'
            ? 'public_context_current_for_demo'
            : 'review_required_before_case_claim',
        evidenceHint: status.status || 'mastr_overlay_status_unknown',
      },
    ];
  },

  buildStadtwerkMauerMastrNextGateRows(status = {}, revalidationRows = []) {
    const revalidationStatus =
      revalidationRows[0]?.revalidationStatus || 'source_unavailable_or_not_watched';
    const gate =
      revalidationStatus === 'no_delta_observed'
        ? 'public_context_current_for_demo'
        : 'review_public_context_delta_before_case_claim';
    return [
      {
        rowKey: 'next_gate',
        gateKey: gate,
        label: this.humanizeWorkbenchLabel(gate),
        sourceClass:
          revalidationStatus === 'synthetic_revalidation_drill'
            ? 'synthetic_revalidation_drill'
            : 'public_context_layer',
        status: revalidationStatus,
        requiredEvidence: status.status || 'mastr_overlay_status_unknown',
      },
    ];
  },

  buildStadtwerkMauerMastrSafeActionRows(_status = {}, params = {}, revalidationRows = []) {
    const affectedCaseId = params.caseId || 'smm-budibase-workbench';
    const revalidationStatus =
      revalidationRows[0]?.revalidationStatus || 'source_unavailable_or_not_watched';
    return [
      {
        actionKey: 'refresh_mastr_overlay_read_model',
        label: 'Refresh MaStR Overlay Read Model',
        riskClass: 'read_only_verify',
        boundary: 'cernion-api',
        enabled: true,
        enabledLabel: 'Enabled',
        targetSection: 'mastr_public_context',
        expectedResult: 'Update scalar public-context rows without mutating MaStR records',
      },
      {
        actionKey: 'view_selected_case_evidence',
        label: 'View Selected Case Evidence',
        riskClass: 'read_only_verify',
        boundary: 'cernion-api',
        enabled: true,
        enabledLabel: 'Enabled',
        targetSection: 'case_detail',
        expectedResult: `Open evidence rows for ${affectedCaseId}`,
      },
      {
        actionKey: 'review_public_context_delta',
        label: 'Review Public Context Delta',
        riskClass: 'read_only_verify',
        boundary: 'cernion-api',
        enabled: revalidationStatus !== 'no_delta_observed',
        enabledLabel: revalidationStatus !== 'no_delta_observed' ? 'Enabled' : 'No delta observed',
        targetSection: 'mastr_revalidation',
        expectedResult: 'Review delta/drill evidence before case claims',
      },
    ];
  },

  buildStadtwerkMauerMastrBoundaryRows(status = {}) {
    const notCalled = status.sourceActions?.notCalled || [
      'mastr.write',
      'mako.dispatch',
      'billing.release',
      'settlement.prepareBilling',
      'tariff.mutate',
      'device-control.execute',
      'external.connector.call',
      'hitl.create',
      'personal-agent.execute',
    ];
    return notCalled.map((boundary) => ({
      boundary,
      status: 'not_called',
      sourceClass: boundary === 'mastr.write' ? 'public_context_layer' : 'command_boundary',
      safeAlternative:
        boundary === 'mastr.write'
          ? 'refresh_mastr_overlay_read_model'
          : 'view_or_verify_existing_evidence',
    }));
  },

  buildMissingStadtwerkMauerMastrDataOverlayStatus(tenantId = 'stadtwerk-mauer', params = {}) {
    const missingEvidence = [
      {
        missingDataPoint: 'mastr_overlay_status',
        enablesDossierAddition: 'add Stadtwerk Mauer blended MaStR overlay status evidence',
      },
    ];
    const sourceActions = {
      inspected: ['dashboard-api.stadtwerkMauerMastrDataOverlayStatus'],
      referenced: ['stadtwerk-mauer-mastr-data-overlay.getStatus', 'energy-market.installations'],
      notCalled: [
        'mako.dispatch',
        'msb.connector.call',
        'edm.connector.call',
        'customer-service.send',
        'billing.release',
        'settlement.prepareBilling',
        'tariff.mutate',
        'switching.execute',
        'webhook.emit',
        'device-control.execute',
        'smgw.connector.call',
        'cls.control.execute',
        'external.connector.call',
        'hitl.create',
        'personal-agent.execute',
        'tenant.delete.production',
        'mastr.write',
      ],
    };
    const municipality = params.municipality || 'Mauer';
    const postalCode = params.postalCode || '69256';
    return {
      capabilityKey: 'stadtwerk_mauer_mastr_data_overlay',
      safety: 'read_only_real_mastr_baseline_with_virtual_operator_overlay',
      tenantId,
      requiredTenantId: 'stadtwerk-mauer',
      sandboxBoundaryAllowed: tenantId === 'stadtwerk-mauer',
      status: 'blended_overlay_status_unavailable',
      municipality,
      postalCode,
      mastrQuery: {
        action: 'energy-market.installations',
        installationType: 'all',
        postleitzahl: postalCode,
        location: municipality,
        queryFailed: true,
      },
      assetCount: 0,
      totalCapacityKw: 0,
      typeCounts: {},
      originalGridOperators: [],
      operatorOverlay: {
        mode: 'tenant_role_process_overlay',
        virtualGridOperator: {
          name: 'Stadtwerk Mauer',
          role: 'virtual_distribution_system_operator',
          tenantId: 'stadtwerk-mauer',
        },
        realWorldOperatorHint: {
          name: 'Syna GmbH',
          role: 'real_world_grid_operator',
        },
        preservesOriginalMastrFacts: true,
        mutatesMastrRecords: false,
      },
      sampleAssets: [],
      evidenceQuality: 'unavailable',
      missingEvidence,
      positiveFollowUps: missingEvidence.map((item) => ({
        ...item,
        category: 'stadtwerk_mauer_mastr_data_overlay',
      })),
      resetBoundary: {
        service: 'stadtwerk-mauer-sandbox-runtime.reset',
        scopedToTenant: 'stadtwerk-mauer',
        deletesImportedMastrBaseline: false,
        deletesDerivedSandboxArtifacts: true,
      },
      sourceActions,
      dossierEvidence: {
        status: 'blended_overlay_status_unavailable',
        tenantId,
        municipality,
        postalCode,
        assetCount: 0,
        totalCapacityKw: 0,
        virtualGridOperatorName: 'Stadtwerk Mauer',
        realWorldOperatorHint: 'Syna GmbH',
        originalGridOperators: [],
        sampleAssets: [],
        missingEvidence,
        positiveFollowUps: missingEvidence.map((item) => ({
          ...item,
          category: 'stadtwerk_mauer_mastr_data_overlay',
        })),
        sourceActions,
        dossierFacts: [
          'Overlay Status: blended_overlay_status_unavailable',
          `Tenant: ${tenantId}`,
          `Municipality: ${municipality}`,
          `Postal Code: ${postalCode}`,
        ],
      },
    };
  },

  buildFnavFastTrackContractGateStatus(params = {}) {
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
        /^(ready|ok|green|gruen|grün|complete|completed|valid|validiert|confirmed|bestaetigt|bestätigt|approved|freigegeben|signed|vorhanden|ja|yes)$/.test(
          text
        )
      )
        return 'ready';
      if (
        /^(partial|partly|pending|open|offen|in_progress|in-progress|review|review_required|unklar|unknown|draft)$/.test(
          text
        )
      )
        return 'partial';
      if (/^(missing|fehlt|absent|not_available|not-available|none)$/.test(text)) return 'missing';
      if (
        /^(blocked|blockiert|red|rot|failed|rejected|not_ready|not-ready|stop|verboten)$/.test(text)
      )
        return 'blocked';
      if (/legal|recht/.test(text) && /pending|open|unklar|not/.test(text)) return 'partial';
      if (/stop|abort|abbruch|reject|ablehn|block/.test(text)) return 'blocked';
      return 'ready';
    };
    const isReady = (status) => status === 'ready';
    const isBlocked = (status) => status === 'blocked';
    const sourceRefs = toList(params.sourceRef);
    const gateId =
      params.gateId ||
      `fnav-ft:${Buffer.from(
        `${params.gridOperatorId || ''}:${params.requestType || ''}:${params.assetOrLoadType || ''}:${params.requestedCapacityKW || ''}`
      )
        .toString('base64url')
        .slice(0, 28)}`;
    const evidenceSpecs = [
      {
        code: 'fnav_profile',
        label: 'fNAV Profile',
        value: params.requestType || params.assetOrLoadType || params.requestedCapacityKW,
        enablesDossierAddition:
          'add fNAV request profile for storage, data-center or large-load fast-track review',
        statusWhenMissing: 'needs_contract_evidence',
      },
      {
        code: 'grid_operator_identity',
        label: 'Grid Operator',
        value: params.gridOperatorId,
        enablesDossierAddition: 'bind the fast-track gate to the responsible grid operator',
        statusWhenMissing: 'requires_governance_decision',
      },
      {
        code: 'netzsignal_priority_policy',
        label: 'Network-Signal Priority',
        value: params.netzsignalPriorityPolicy,
        enablesDossierAddition:
          'add the network-signal priority boundary for the fast-track decision',
        statusWhenMissing: 'requires_governance_decision',
      },
      {
        code: 'schedule_obligation',
        label: 'Fahrplanpflicht',
        value: params.scheduleObligation,
        enablesDossierAddition: 'add schedule obligation evidence for operational fNAV boundary',
        statusWhenMissing: 'needs_contract_evidence',
      },
      {
        code: 'metering_requirement',
        label: 'Metering Requirement',
        value: params.meteringRequirements,
        enablesDossierAddition: 'add metering requirement evidence for the contract gate',
        statusWhenMissing: 'needs_control_evidence',
      },
      {
        code: 'control_evidence_ref',
        label: 'Control Evidence',
        value: params.controlEvidenceRef,
        enablesDossierAddition: 'add metering/control proof before fast-track release review',
        statusWhenMissing: 'needs_control_evidence',
      },
      {
        code: 'contract_status',
        label: 'Contract Status',
        value: params.contractStatus,
        enablesDossierAddition: 'add draft or signed contract evidence for the fast-track gate',
        statusWhenMissing: 'needs_contract_evidence',
      },
      {
        code: 'legal_status',
        label: 'Legal Status',
        value: params.legalStatus,
        enablesDossierAddition: 'state whether legal release is approved or still pending',
        statusWhenMissing: 'blocked_by_legal_status',
      },
      {
        code: 'owner_contact',
        label: 'Owner Contact',
        value: params.ownerContact || params.escalationOwner,
        enablesDossierAddition: 'add accountable owner and escalation path',
        statusWhenMissing: 'requires_governance_decision',
      },
    ];
    const signals = evidenceSpecs.map((spec) => {
      const status = normalizeStatus(spec.value);
      return {
        code: spec.code,
        label: spec.label,
        status,
        rawStatus: spec.value || null,
        enablesDossierAddition: spec.enablesDossierAddition,
        statusWhenMissing: spec.statusWhenMissing,
      };
    });
    const evidenceGaps = signals
      .filter((signal) => !isReady(signal.status))
      .map((signal) => ({
        missingDataPoint: signal.code,
        status: signal.status,
        value: signal.rawStatus,
        enablesDossierAddition: signal.enablesDossierAddition,
      }));
    if (params.breakCriteria && isBlocked(normalizeStatus(params.breakCriteria))) {
      evidenceGaps.push({
        missingDataPoint: 'break_criteria',
        status: 'blocked',
        value: params.breakCriteria,
        enablesDossierAddition: 'document fast-track stop or abort criteria before continuing',
      });
    }
    const commercialStatus = normalizeStatus(params.commercialImpact || params.marketingBoundaries);
    if (!isReady(commercialStatus)) {
      evidenceGaps.push({
        missingDataPoint: 'commercial_impact',
        status: commercialStatus,
        value: params.commercialImpact || params.marketingBoundaries || null,
        enablesDossierAddition: 'add commercial impact and marketing-boundary evidence',
      });
    }
    let decisionReadiness = 'ready_for_fast_track';
    if (
      evidenceGaps.some(
        (gap) => gap.missingDataPoint === 'break_criteria' || gap.status === 'blocked'
      )
    ) {
      decisionReadiness = 'stop_fast_track';
    } else if (evidenceGaps.some((gap) => gap.missingDataPoint === 'legal_status')) {
      decisionReadiness = 'blocked_by_legal_status';
    } else if (
      evidenceGaps.some(
        (gap) =>
          gap.missingDataPoint === 'control_evidence_ref' ||
          gap.missingDataPoint === 'metering_requirement'
      )
    ) {
      decisionReadiness = 'needs_control_evidence';
    } else if (
      evidenceGaps.some(
        (gap) =>
          gap.missingDataPoint === 'contract_status' ||
          gap.missingDataPoint === 'fnav_profile' ||
          gap.missingDataPoint === 'schedule_obligation'
      )
    ) {
      decisionReadiness = 'needs_contract_evidence';
    } else if (evidenceGaps.some((gap) => gap.missingDataPoint === 'commercial_impact')) {
      decisionReadiness = 'needs_commercial_review';
    } else if (evidenceGaps.length > 0) {
      decisionReadiness = 'requires_governance_decision';
    }
    const sourceActions = {
      inspected: ['dashboard-api.fnavFastTrackContractGateStatus'],
      referenced: [
        'grid-connection.fnavValidate',
        'grid-operations.netzfahrplanGenerate',
        'finance-agent.fnavEconomics',
        'fnav-commercial-hedging.createScenario',
        'vdmi.dossier',
        'vdmi-portfolio-gatekeeping.gate',
        'presentation.render',
      ],
      notCalled: [
        'contract.approve',
        'contract.release',
        'grid-connection.mutate',
        'hitl.create',
        'device-control.execute',
        'smgw.connector.call',
        'cls.control.execute',
        'tariff.mutate',
        'billing.release',
        'settlement.prepareBilling',
        'mako.dispatch',
        'external.connector.call',
        'personal-agent.execute',
      ],
    };
    const positiveFollowUps = evidenceGaps.map((gap) => ({
      missingDataPoint: gap.missingDataPoint,
      status: gap.status,
      value: gap.value,
      enablesDossierAddition: gap.enablesDossierAddition,
      category: 'fnav_fast_track_contract_gate',
    }));
    const governanceBlockers = evidenceGaps
      .filter(
        (gap) =>
          [
            'grid_operator_identity',
            'netzsignal_priority_policy',
            'owner_contact',
            'legal_status',
            'break_criteria',
          ].includes(gap.missingDataPoint) || isBlocked(gap.status)
      )
      .map((gap) => ({
        code: gap.missingDataPoint,
        owner: params.ownerContact || params.escalationOwner || null,
        message: gap.enablesDossierAddition,
      }));
    const requestSummary = {
      gateId,
      gridOperatorId: params.gridOperatorId || null,
      requestType: params.requestType || null,
      assetOrLoadType: params.assetOrLoadType || null,
      requestedCapacityKW: params.requestedCapacityKW ?? null,
      firmCapacityKW: params.firmCapacityKW ?? null,
      flexibleCapacityKW: params.flexibleCapacityKW ?? null,
      voltageLevel: params.voltageLevel || null,
      sourceRefs,
    };
    const dossierFacts = [
      `Status: ${decisionReadiness}`,
      `Gate: ${gateId}`,
      `Request Type: ${params.requestType || 'unknown'}`,
      `Open gaps: ${evidenceGaps.length}`,
    ];

    // -- FCA/fNAV lifecycle evidence (additive, caller-supplied, read-only) --
    // Narrow, non-consequential projection of one supplied FCA/fNAV case across
    // request, offer, restriction, contract and at most one operating-event
    // snapshot. Never affects decisionReadiness/status above; scalar and
    // reference values only, no service calls, persistence or hydration.
    const hasEvidenceValue = (value) =>
      value !== undefined && value !== null && String(value).trim() !== '';
    const lifecycleRowStatus = (values) => {
      const provided = values.filter(hasEvidenceValue).length;
      if (provided === 0) return 'missing';
      if (provided === values.length) return 'provided';
      return 'partial';
    };
    const lifecycleRowSpecs = [
      {
        code: 'connection_request',
        label: 'Connection Request',
        values: {
          connectionRequestRef: params.connectionRequestRef ?? null,
          gridConnectionPoint: params.gridConnectionPoint ?? null,
        },
        enablesDossierAddition:
          'add connection request/case reference and grid connection point evidence',
      },
      {
        code: 'capacity_offer',
        label: 'Capacity Offer',
        values: {
          capacityOfferRef: params.capacityOfferRef ?? null,
          capacityOfferVersion: params.capacityOfferVersion ?? null,
          capacityOfferDate: params.capacityOfferDate ?? null,
          firmCapacityKW: params.firmCapacityKW ?? null,
          flexibleCapacityKW: params.flexibleCapacityKW ?? null,
        },
        enablesDossierAddition:
          'add capacity-offer reference, offer version/date and offered firm/flexible capacity evidence',
      },
      {
        code: 'restriction_profile',
        label: 'Restriction Profile',
        values: {
          restrictionProfileRef: params.restrictionProfileRef ?? null,
          restrictionProfileVersion: params.restrictionProfileVersion ?? null,
          curtailmentWindow: params.curtailmentWindow ?? null,
        },
        enablesDossierAddition:
          'add restriction-profile reference/version and curtailment window evidence',
      },
      {
        code: 'contract_lifecycle',
        label: 'Contract Lifecycle',
        values: {
          contractRef: params.contractRef ?? null,
          contractVersion: params.contractVersion ?? null,
          contractReviewStatus: params.contractReviewStatus ?? null,
        },
        enablesDossierAddition:
          'add contract reference, contract version and review status evidence',
      },
      {
        code: 'curtailment_measurement_evidence',
        label: 'Curtailment/Measurement Evidence',
        values: {
          curtailmentMeasurementEvidenceRef: params.curtailmentMeasurementEvidenceRef ?? null,
        },
        enablesDossierAddition: 'add curtailment/measurement evidence reference',
      },
      {
        code: 'redispatch_compensation_markers',
        label: 'Redispatch/Compensation Evidence Markers',
        values: {
          redispatchRelevanceRef: params.redispatchRelevanceRef ?? null,
          redispatchStatusRef: params.redispatchStatusRef ?? null,
          compensationStatusRef: params.compensationStatusRef ?? null,
        },
        enablesDossierAddition:
          'add Redispatch relevance/status and compensation-status evidence markers (markers only, not a classification or calculation)',
      },
      {
        code: 'evidence_governance',
        label: 'Evidence Governance',
        values: {
          evidenceOwner: params.evidenceOwner ?? null,
          nextReviewGate: params.nextReviewGate ?? null,
          evidenceSourceTimestamp: params.evidenceSourceTimestamp ?? null,
        },
        enablesDossierAddition: 'add evidence owner, next review gate and source timestamp',
      },
    ];
    const lifecycleRows = lifecycleRowSpecs.map((spec) => ({
      code: spec.code,
      label: spec.label,
      ...spec.values,
      evidenceStatus: lifecycleRowStatus(Object.values(spec.values)),
      enablesDossierAddition: spec.enablesDossierAddition,
    }));
    const operatingEventValues = {
      operatingEventRef: params.operatingEventRef ?? null,
      operatingEventType: params.operatingEventType ?? null,
      operatingEventTimestamp: params.operatingEventTimestamp ?? null,
    };
    const operatingEventStatus = lifecycleRowStatus(Object.values(operatingEventValues));
    const operatingEventRow = {
      code: 'operating_event',
      label: 'Operating Event (optional, at most one snapshot per request)',
      ...operatingEventValues,
      evidenceStatus: operatingEventStatus,
      optional: true,
      enablesDossierAddition:
        'add the single supplied operating-event reference, type and timestamp',
    };
    const lifecycleMissingEvidence = lifecycleRows
      .filter((row) => row.evidenceStatus !== 'provided')
      .map((row) => ({
        missingDataPoint: row.code,
        status: row.evidenceStatus,
        enablesDossierAddition: row.enablesDossierAddition,
      }));
    // The operating-event snapshot is optional (at most one per request), so a
    // fully unsupplied snapshot is not a gap -- only a partially supplied one is.
    if (operatingEventStatus === 'partial') {
      lifecycleMissingEvidence.push({
        missingDataPoint: operatingEventRow.code,
        status: operatingEventStatus,
        enablesDossierAddition: operatingEventRow.enablesDossierAddition,
      });
    }
    const lifecyclePositiveFollowUps = lifecycleMissingEvidence.map((gap) => ({
      missingDataPoint: gap.missingDataPoint,
      status: gap.status,
      enablesDossierAddition: gap.enablesDossierAddition,
      category: 'fca_fnav_lifecycle_evidence',
    }));
    const lifecycleEvidence = {
      capabilityKey: 'fnav_fast_track_contract_gate',
      gateId,
      rows: [...lifecycleRows, operatingEventRow],
      operatingEvent: operatingEventRow,
      evidenceStatus: {
        provided: lifecycleRows.filter((row) => row.evidenceStatus === 'provided').length,
        required: lifecycleRows.length,
      },
      missingEvidence: lifecycleMissingEvidence,
      positiveFollowUps: lifecyclePositiveFollowUps,
      sourceActions: {
        referenced: [
          'fnav-commercial-hedging.createContract',
          'fnav-commercial-hedging.createScenario',
          'redispatch-expost.stepCurtailmentCorrelation',
          'grid-connection.stepCapacity',
          'grid-connection.fnavValidate',
        ],
        notCalled: [
          'contract.approve',
          'contract.release',
          'capacity.allocate',
          'grid-connection.mutate',
          'grid-connection.approve',
          'curtailment.dispatch',
          'device-control.execute',
          'smgw.connector.call',
          'cls.control.execute',
          'redispatch.execute',
          'redispatch.classify',
          'compensation.calculate',
          'settlement.prepareBilling',
          'mako.dispatch',
          'a96.dispatch',
          'workflow.create',
          'hitl.create',
          'external.connector.call',
          'personal-agent.execute',
        ],
      },
      notice:
        'Evidence markers only: no capacity allocation, connection approval, contract action, ' +
        'curtailment/dispatch/device control, Redispatch execution/classification, compensation ' +
        'calculation, settlement, MaKo/A96, workflow/HITL, connector or Personal-Agent execution ' +
        'is performed by this projection.',
    };

    return {
      capabilityKey: 'fnav_fast_track_contract_gate',
      safety: 'read_only',
      gateId,
      decisionReadiness,
      status: decisionReadiness,
      requestSummary,
      technicalGate: {
        netzsignalPriorityPolicy: params.netzsignalPriorityPolicy || null,
        scheduleObligation: params.scheduleObligation || null,
        meteringRequirements: params.meteringRequirements || null,
        controlEvidenceRef: params.controlEvidenceRef || null,
        curtailmentWindow: params.curtailmentWindow || null,
      },
      commercialGate: {
        marketingBoundaries: params.marketingBoundaries || null,
        commercialImpact: params.commercialImpact || null,
      },
      contractGate: {
        contractStatus: params.contractStatus || null,
        legalStatus: params.legalStatus || null,
        breakCriteria: params.breakCriteria || null,
      },
      evidenceStatus: {
        provided: signals.filter((signal) => isReady(signal.status)).length,
        required: signals.length,
        commercialStatus,
      },
      governanceBlockers,
      escalationPath: {
        escalationOwner: params.escalationOwner || null,
        ownerContact: params.ownerContact || null,
        vdmiProcessId: params.vdmiProcessId || null,
      },
      missingEvidence: evidenceGaps,
      positiveFollowUps,
      sourceActions,
      sourceDatapoints: signals,
      lifecycleEvidence,
      dossierEvidence: {
        capabilityKey: 'fnav_fast_track_contract_gate',
        gateId,
        decisionReadiness,
        status: decisionReadiness,
        requestSummary,
        technicalGate: {
          netzsignalPriorityPolicy: params.netzsignalPriorityPolicy || null,
          controlEvidenceRef: params.controlEvidenceRef || null,
        },
        contractGate: {
          contractStatus: params.contractStatus || null,
          legalStatus: params.legalStatus || null,
        },
        missingEvidence: evidenceGaps,
        positiveFollowUps,
        sourceActions: { notCalled: sourceActions.notCalled },
        dossierFacts,
      },
    };
  },

  buildNetzsignalDeltaGatingStatus(params = {}) {
    const present = (value) => value !== undefined && value !== null && String(value).trim() !== '';
    const lower = (value) =>
      String(value || '')
        .trim()
        .toLowerCase();
    const normalizeMateriality = (value) => {
      const text = lower(value);
      if (/hoch|high|kritisch|critical|red|rot|vorstand|management/.test(text)) return 'high';
      if (/mittel|medium|amber|gelb|relevant/.test(text)) return 'medium';
      if (/niedrig|low|green|gruen|grün/.test(text)) return 'low';
      return present(value) ? String(value).trim() : 'missing';
    };
    const dueDateStatus = (value) => {
      if (!present(value)) return 'missing';
      const ts = Date.parse(value);
      if (!Number.isFinite(ts)) return 'provided_unparsed';
      const days = Math.ceil((ts - Date.now()) / (24 * 60 * 60 * 1000));
      if (days < 0) return 'overdue';
      if (days <= 2) return 'urgent_48h';
      if (days <= 14) return 'near_term';
      return 'scheduled';
    };

    const missingSpecs = [
      {
        key: 'domain',
        value: params.domain,
        label: 'Operational domain',
        enablesDossierAddition: 'add domain such as Netzanschluss, Flex, Gas, Asset or Metering',
      },
      {
        key: 'signal_type',
        value: params.signalType,
        label: 'Signal type',
        enablesDossierAddition: 'add source signal type for repeatability',
      },
      {
        key: 'known_context_ref',
        value: params.knownContextRef,
        label: 'Known context reference',
        enablesDossierAddition: 'add baseline reference to prove known context or real delta',
      },
      {
        key: 'freshness_proof',
        value: params.freshnessProof,
        label: 'Freshness proof',
        enablesDossierAddition: 'add timestamp/hash/source proof for freshness classification',
      },
      {
        key: 'decision_topic',
        value: params.decisionTopic,
        label: 'Decision topic',
        enablesDossierAddition: 'add management decision topic',
      },
      {
        key: 'owner',
        value: params.owner,
        label: 'Owner',
        enablesDossierAddition: 'add accountable owner and Fachbereich',
      },
      {
        key: 'due_date',
        value: params.dueDate,
        label: 'Due date',
        enablesDossierAddition: 'add deadline and escalation window',
      },
      {
        key: 'materiality',
        value: params.materiality,
        label: 'Materiality',
        enablesDossierAddition: 'add management relevance / materiality',
      },
      {
        key: 'new_fact',
        value: params.newFact,
        label: 'New fact',
        enablesDossierAddition: 'add new fact to distinguish freshness from decision delta',
      },
      {
        key: 'blocked_decision',
        value: params.blockedDecision,
        label: 'Blocked decision',
        enablesDossierAddition: 'add blocked decision for escalation rationale',
      },
      {
        key: 'next_evidence_point',
        value: params.nextEvidencePoint,
        label: 'Next evidence point',
        enablesDossierAddition: 'add next evidence needed for escalation or non-escalation',
      },
    ];
    const missingEvidence = missingSpecs
      .filter((item) => !present(item.value))
      .map((item) => ({
        missingDataPoint: item.key,
        label: item.label,
        enablesDossierAddition: item.enablesDossierAddition,
      }));
    const normalizedMateriality = normalizeMateriality(params.materiality);
    const normalizedDueDateStatus = dueDateStatus(params.dueDate);
    const hasNewFact = present(params.newFact);
    const hasBlockedDecision = present(params.blockedDecision);
    const hasDecisionContext =
      present(params.decisionTopic) && present(params.owner) && present(params.dueDate);
    const hasKnownContext = present(params.knownContextRef);
    const hasFreshnessProof = present(params.freshnessProof);
    const hasManagementRelevance = ['high', 'medium'].includes(normalizedMateriality);

    let classification = 'insufficient_evidence';
    if (hasBlockedDecision && hasDecisionContext && hasNewFact) classification = 'new_blocker';
    else if (hasNewFact && hasDecisionContext && hasManagementRelevance)
      classification = 'decision_delta';
    else if (hasFreshnessProof && hasKnownContext && !hasNewFact && !hasBlockedDecision)
      classification = 'freshness_only';
    else if (hasKnownContext && !hasFreshnessProof && !hasNewFact && !hasBlockedDecision)
      classification = 'known_context';

    const escalationRecommendation =
      classification === 'new_blocker'
        ? 'Prepare management escalation dossier; no escalation was dispatched.'
        : classification === 'decision_delta'
          ? 'Queue for management review once evidence is complete; no ticket was created.'
          : classification === 'freshness_only'
            ? 'Do not escalate; record freshness proof against known context.'
            : classification === 'known_context'
              ? 'Do not escalate; treat as known context until a new fact or blocker appears.'
              : 'Hold as evidence gap; add missing owner, due date, materiality, new fact or blocker evidence.';
    const nonEscalationRationale = ['known_context', 'freshness_only'].includes(classification)
      ? escalationRecommendation
      : null;
    const positiveFollowUps = missingEvidence.map((item) => ({
      missingDataPoint: item.missingDataPoint,
      enablesDossierAddition: item.enablesDossierAddition,
      category: 'netzsignal_delta_gating',
    }));
    const dossierFacts = [
      `Netzsignal Delta-Gating Classification: ${classification}`,
      `Domain: ${params.domain || 'missing'}`,
      `Materiality: ${normalizedMateriality}`,
      `Due Date Status: ${normalizedDueDateStatus}`,
      `Open Evidence Gaps: ${missingEvidence.length}`,
    ];
    if (params.owner) dossierFacts.push(`Owner: ${params.owner}`);
    if (params.blockedDecision) dossierFacts.push(`Blocked Decision: ${params.blockedDecision}`);

    const sourceActions = {
      inspected: ['dashboard-api.netzsignalDeltaGatingStatus'],
      referenced: ['vdmi.dossier', 'evidence-planner.plan'],
      notCalled: [
        'mail.connector.ingest',
        'outlook.connector.read',
        'teams.connector.read',
        'monitoring.connector.read',
        'ticket.create',
        'notification.dispatchInternal',
        'hitl.create',
        'workflow.execute',
        'external.connector.call',
        'budibase.table.write',
        'public-context.mutate',
        'tenant.provision',
        'personal-agent.execute',
        'mako.dispatch',
        'billing.release',
        'settlement.prepareBilling',
        'tariff.mutate',
        'device-control.execute',
      ],
    };

    return {
      capabilityKey: 'netzsignal_delta_gating',
      safety: 'read_only_non_consequential_classification',
      status: classification,
      classification,
      signalId: params.signalId || null,
      caseId: params.caseId || null,
      domain: params.domain || null,
      signalType: params.signalType || null,
      knownContextRef: params.knownContextRef || null,
      freshnessProof: params.freshnessProof || null,
      decisionTopic: params.decisionTopic || null,
      owner: params.owner || null,
      dueDate: params.dueDate || null,
      dueDateStatus: normalizedDueDateStatus,
      materiality: normalizedMateriality,
      newFact: params.newFact || null,
      blockedDecision: params.blockedDecision || null,
      nextEvidencePoint: params.nextEvidencePoint || null,
      regulatoryReference: params.regulatoryReference || null,
      assetReference: params.assetReference || null,
      revenueImpactHint: params.revenueImpactHint || null,
      escalationRecommendation,
      nonEscalationRationale,
      missingEvidence,
      positiveFollowUps,
      sourceActions,
      sourceBoundary: {
        suppliedInputOnly: true,
        connectorRead: false,
        persistsRawPrivateContent: false,
        createsExternalAction: false,
      },
      validationFindings: missingEvidence.map((item) => ({
        code: `NETZSIGNAL_DG_${String(item.missingDataPoint).toUpperCase()}_MISSING`,
        severity: ['owner', 'due_date', 'blocked_decision'].includes(item.missingDataPoint)
          ? 'high'
          : 'medium',
        message: item.enablesDossierAddition,
      })),
      dossierEvidence: {
        capabilityKey: 'netzsignal_delta_gating',
        classification,
        escalationRecommendation,
        nonEscalationRationale,
        owner: params.owner || null,
        dueDate: params.dueDate || null,
        dueDateStatus: normalizedDueDateStatus,
        materiality: normalizedMateriality,
        blockedDecision: params.blockedDecision || null,
        nextEvidencePoint: params.nextEvidencePoint || null,
        missingEvidence,
        positiveFollowUps,
        sourceActions: { notCalled: sourceActions.notCalled },
        dossierFacts,
      },
    };
  },

  buildVnbDeltaSignalClassifierStatus(params = {}) {
    const toList = (value) => {
      if (Array.isArray(value))
        return value.filter((item) => item !== undefined && item !== null && item !== '');
      if (value && typeof value === 'string') {
        const trimmed = value.trim();
        if (!trimmed) return [];
        if (trimmed.startsWith('[') && trimmed.endsWith(']')) {
          try {
            const parsed = JSON.parse(trimmed);
            return Array.isArray(parsed) ? parsed : [parsed];
          } catch (_err) {
            process.stderr.write(
              `[methods-part-11-of-14] silent-catch-fallback (line 1079): ${_err && _err.message}\n`
            );
            return [trimmed];
          }
        }
        return trimmed
          .split(',')
          .map((item) => item.trim())
          .filter(Boolean);
      }
      return value && typeof value === 'object' ? [value] : [];
    };
    const normalize = (value) => String(value || '').trim();
    const normalizeKey = (value) => normalize(value).toLowerCase();
    const hasAny = (text, needles) => needles.some((needle) => text.includes(needle));
    const clamp = (value, min, max) => Math.max(min, Math.min(max, value));
    const dueUrgency = (dueDateHint) => {
      if (!dueDateHint) return 'missing';
      const ts = Date.parse(dueDateHint);
      if (!Number.isFinite(ts)) return 'provided_unparsed';
      const days = Math.ceil((ts - Date.now()) / (24 * 60 * 60 * 1000));
      if (days < 0) return 'overdue';
      if (days <= 2) return 'urgent_48h';
      if (days <= 14) return 'near_term';
      return 'scheduled';
    };
    const classifyProcess = (text, hint) => {
      if (hint) return hint;
      if (hasAny(text, ['anschluss', 'netzanschluss', 'kapazitaet', 'kapazität']))
        return 'grid_connection_capacity';
      if (hasAny(text, ['redispatch', 'fahrplan', 'abruf'])) return 'redispatch_flexibility';
      if (hasAny(text, ['messstelle', 'imsys', 'msb', 'zaehler', 'zähler'])) return 'metering';
      if (hasAny(text, ['regulierung', 'enwg', 'nzentg', 'bnetza'])) return 'regulatory';
      if (hasAny(text, ['asset', 'anlage', 'trafo', 'betriebsmittel'])) return 'asset_management';
      if (hasAny(text, ['flex', 'speicher', 'steuerbar', '14a'])) return 'flexibility';
      return 'unclassified_vnb_signal';
    };
    const classifyOwner = (process, ownerHint) => {
      if (ownerHint) return ownerHint;
      const owners = {
        grid_connection_capacity: 'Netzplanung / Anschlusswesen',
        redispatch_flexibility: 'Redispatch / Flexibilitaetsmanagement',
        metering: 'Messstellenbetrieb / Metering',
        regulatory: 'Regulierungsmanagement',
        asset_management: 'Asset Management',
        flexibility: 'Flexibilitaetskoordination',
      };
      return owners[process] || 'Management Office / Fachbereich zu klaeren';
    };
    const classifyRelevance = (text, urgency, blockedDecision) => {
      let score = 0;
      if (blockedDecision) score += 2;
      if (
        hasAny(text, ['frist', 'deadline', 'entscheidung', 'blockiert', 'freigabe', 'eskalation'])
      )
        score += 2;
      if (
        hasAny(text, [
          'kapazitaet',
          'kapazität',
          'anschluss',
          'redispatch',
          'regulierung',
          'messstellen',
          'asset',
          'flex',
        ])
      )
        score += 1;
      if (['overdue', 'urgent_48h'].includes(urgency)) score += 2;
      if (urgency === 'near_term') score += 1;
      if (score >= 5) return 'high';
      if (score >= 3) return 'medium';
      return 'low';
    };
    const classifyNovelty = (text, anchors) => {
      if (!anchors.length) return 'unknown_baseline';
      const anchorHits = anchors.filter((anchor) => text.includes(normalizeKey(anchor))).length;
      if (anchorHits === 0) return 'new_signal';
      if (anchorHits < anchors.length) return 'partial_delta';
      return 'known_context_update';
    };
    const rawSignals =
      Array.isArray(params.signals) && params.signals.length > 0
        ? params.signals.slice(0, 10)
        : [
            {
              signalId: params.signalId,
              caseId: params.caseId,
              sourceType: params.sourceType,
              receivedAt: params.receivedAt,
              subject: params.subject,
              bodyExcerpt: params.bodyExcerpt,
              knownContextAnchors: params.knownContextAnchors,
              processHint: params.processHint,
              ownerHint: params.ownerHint,
              dueDateHint: params.dueDateHint,
              blockedDecisionHint: params.blockedDecisionHint,
              nextEvidenceHint: params.nextEvidenceHint,
            },
          ];

    const missingMap = {
      source_type:
        'add supplied source type such as mail, teams, task, portal or meeting-note label',
      received_at: 'add received-at timestamp for freshness and SLA interpretation',
      subject_or_excerpt: 'add sanitized subject or body excerpt for deterministic classification',
      known_context_anchors:
        'add known context anchors to distinguish fresh deltas from known noise',
      owner_hint: 'add owner or role hint to make routing accountable',
      due_date: 'add deadline hint to classify urgency',
      blocked_decision: 'add explicit blocked decision if management action is required',
      next_evidence_point: 'add the next evidence point needed to close the decision loop',
    };
    const allMissing = [];
    const classifications = rawSignals.map((signal, index) => {
      const anchors = toList(signal.knownContextAnchors);
      const subject = normalize(signal.subject);
      const excerpt = normalize(signal.bodyExcerpt);
      const text = normalizeKey(
        `${subject} ${excerpt} ${anchors.join(' ')} ${signal.processHint || ''}`
      );
      const missing = [];
      if (!signal.sourceType) missing.push('source_type');
      if (!signal.receivedAt) missing.push('received_at');
      if (!subject && !excerpt) missing.push('subject_or_excerpt');
      if (anchors.length === 0) missing.push('known_context_anchors');
      if (!signal.ownerHint) missing.push('owner_hint');
      if (!signal.dueDateHint) missing.push('due_date');
      if (!signal.blockedDecisionHint) missing.push('blocked_decision');
      if (!signal.nextEvidenceHint) missing.push('next_evidence_point');

      const affectedProcess = classifyProcess(text, signal.processHint);
      const ownerSuggestion = classifyOwner(affectedProcess, signal.ownerHint);
      const deadlineUrgency = dueUrgency(signal.dueDateHint);
      const blockedDecision =
        signal.blockedDecisionHint ||
        (hasAny(text, ['blockiert', 'blocked', 'entscheidung', 'freigabe'])
          ? 'management_decision_required'
          : 'not_explicit');
      const decisionRelevance = classifyRelevance(
        text,
        deadlineUrgency,
        signal.blockedDecisionHint
      );
      const noveltyLevel = classifyNovelty(text, anchors);
      const confidence = clamp(
        0.9 - missing.length * 0.08 + (affectedProcess === 'unclassified_vnb_signal' ? -0.1 : 0),
        0.35,
        0.95
      );
      const nextEvidencePoint =
        signal.nextEvidenceHint ||
        missingMap[missing.find((item) => item !== 'blocked_decision') || 'next_evidence_point'];

      const row = {
        signalId: signal.signalId || `vnb-delta-signal:${index + 1}`,
        caseId: signal.caseId || null,
        sourceType: signal.sourceType || 'caller_supplied_unspecified',
        receivedAt: signal.receivedAt || null,
        noveltyLevel,
        decisionRelevance,
        affectedProcess,
        ownerSuggestion,
        deadlineUrgency,
        blockedDecision,
        nextEvidencePoint,
        confidence: Number(confidence.toFixed(2)),
        missingEvidence: missing,
        contentPolicy: 'caller_supplied_sanitized_excerpt_only_no_private_content_persistence',
      };
      missing.forEach((missingDataPoint) => {
        allMissing.push({
          signalId: row.signalId,
          missingDataPoint,
          affectedProcess,
          enablesDossierAddition: missingMap[missingDataPoint],
        });
      });
      return row;
    });

    const highPriorityCount = classifications.filter(
      (row) => row.decisionRelevance === 'high'
    ).length;
    const status =
      highPriorityCount > 0
        ? 'decision_queue_attention'
        : allMissing.length > 0
          ? 'classification_with_evidence_gaps'
          : 'classified';
    const sourceActions = {
      inspected: ['dashboard-api.vnbDeltaSignalClassifierStatus'],
      referenced: [
        'vdmi.dossier',
        'evidence-planner.plan',
        'dashboard-api.leadershipDeltaCockpitStatus',
      ],
      notCalled: [
        'mail.connector.ingest',
        'outlook.connector.read',
        'teams.connector.read',
        'calendar.connector.read',
        'task.connector.read',
        'ticket.create',
        'notification.dispatchInternal',
        'hitl.create',
        'workflow.execute',
        'external.connector.call',
        'personal-agent.execute',
        'mako.dispatch',
        'billing.release',
        'settlement.prepareBilling',
        'tariff.mutate',
        'device-control.execute',
      ],
    };
    const positiveFollowUps = allMissing.map((gap) => ({
      ...gap,
      category: 'vnb_delta_signal_classifier',
    }));
    const first = classifications[0] || {};
    const dossierFacts = [
      `VNB Delta Signal Status: ${status}`,
      `Classified Signals: ${classifications.length}`,
      `Top Process: ${first.affectedProcess || 'none'}`,
      `Top Relevance: ${first.decisionRelevance || 'none'}`,
      `Owner Suggestion: ${first.ownerSuggestion || 'missing'}`,
      `Deadline Urgency: ${first.deadlineUrgency || 'missing'}`,
      `Boundary: supplied input only; no connector read; no persistence/action side effects`,
    ];
    return {
      capabilityKey: 'vnb_delta_signal_classifier',
      safety: 'read_only_advisory_classification',
      status,
      signalCount: classifications.length,
      highPriorityCount,
      classifications,
      missingEvidence: allMissing,
      positiveFollowUps,
      sourceBoundary: {
        suppliedInputOnly: true,
        connectorRead: false,
        persistsRawPrivateContent: false,
        createsExternalAction: false,
      },
      sourceActions,
      dossierEvidence: {
        capabilityKey: 'vnb_delta_signal_classifier',
        status,
        signalCount: classifications.length,
        topClassification: classifications[0] || null,
        missingEvidence: allMissing,
        positiveFollowUps,
        sourceBoundary: {
          suppliedInputOnly: true,
          connectorRead: false,
          persistsRawPrivateContent: false,
          createsExternalAction: false,
        },
        sourceActions: { notCalled: sourceActions.notCalled },
        dossierFacts,
      },
      _errors: [],
    };
  },

  buildEvidenceFreshnessGuardStatus(params = {}) {
    const normalize = (value) => String(value || '').trim();
    const normalizeLower = (value) => normalize(value).toLowerCase();
    const toTimestamp = (value) => {
      const parsed = Date.parse(value);
      return Number.isFinite(parsed) ? parsed : null;
    };
    const ageDays = (newer, older) => {
      if (!Number.isFinite(newer) || !Number.isFinite(older)) return null;
      return Math.max(0, Number(((newer - older) / (24 * 60 * 60 * 1000)).toFixed(2)));
    };
    const sourceTs = toTimestamp(params.sourceTimestamp);
    const receivedTs = toTimestamp(params.receivedTimestamp) || Date.now();
    const lastSeenTs = toTimestamp(params.lastSeenTimestamp);
    const stalenessDays = sourceTs == null ? null : ageDays(receivedTs, sourceTs);
    const baselineAgeDays =
      sourceTs == null || lastSeenTs == null ? null : ageDays(sourceTs, lastSeenTs);
    const knownSnapshot = params.knownSnapshotHash || params.knownSnapshotId || null;
    const currentSnapshot = params.currentSnapshotHash || params.currentSnapshotId || null;
    const hasKnownSnapshot = Boolean(knownSnapshot);
    const hasCurrentSnapshot = Boolean(currentSnapshot);
    const sameSnapshot =
      hasKnownSnapshot && hasCurrentSnapshot && String(knownSnapshot) === String(currentSnapshot);
    const changedSnapshot =
      hasKnownSnapshot && hasCurrentSnapshot && String(knownSnapshot) !== String(currentSnapshot);
    const threshold = Number.isFinite(Number(params.escalationThresholdDays))
      ? Number(params.escalationThresholdDays)
      : 7;
    const severity = normalizeLower(params.severityHint || 'normal');
    const severityIsHigh = /high|hoch|red|rot|critical|kritisch|eskal/.test(severity);
    const hasBlockedDecision = Boolean(normalize(params.blockedDecision));
    const dueTs = toTimestamp(params.dueDate);
    const daysUntilDue =
      dueTs == null ? null : Number(((dueTs - receivedTs) / (24 * 60 * 60 * 1000)).toFixed(2));
    const dueUrgent = daysUntilDue != null && daysUntilDue <= 3;

    let freshnessState = 'freshness_unknown';
    if (sourceTs != null && stalenessDays <= 1) freshnessState = 'fresh_signal';
    else if (sourceTs != null && stalenessDays <= threshold) freshnessState = 'recent_context';
    else if (sourceTs != null) freshnessState = 'stale_context';

    let deltaState = 'delta_unknown';
    if (sameSnapshot) deltaState = 'known_anchor_repeat';
    else if (changedSnapshot) deltaState = 'new_delta';
    else if (!hasKnownSnapshot && hasCurrentSnapshot) deltaState = 'new_snapshot_without_baseline';
    else if (baselineAgeDays != null && baselineAgeDays > 0)
      deltaState = 'timestamp_delta_without_hash';

    const isKnownAnchor = deltaState === 'known_anchor_repeat';
    const isNewDelta = [
      'new_delta',
      'new_snapshot_without_baseline',
      'timestamp_delta_without_hash',
    ].includes(deltaState);
    const escalationRecommended =
      isNewDelta &&
      (severityIsHigh || hasBlockedDecision || dueUrgent || freshnessState === 'fresh_signal');
    const nonEscalationReason = escalationRecommended
      ? null
      : isKnownAnchor
        ? 'same snapshot as known context anchor; no new delta detected'
        : freshnessState === 'stale_context'
          ? 'source timestamp is stale and should refresh before escalation'
          : !hasBlockedDecision && !severityIsHigh
            ? 'no blocked decision or high severity evidence supplied'
            : 'insufficient freshness or delta evidence for escalation';

    const gapSpecs = [
      {
        id: 'source_kind',
        ok: Boolean(params.sourceKind),
        enablesDossierAddition:
          'add source kind such as mail excerpt, task, monitoring report or meeting note',
      },
      {
        id: 'source_timestamp',
        ok: sourceTs != null,
        enablesDossierAddition: 'add source timestamp to calculate freshness and staleness',
      },
      {
        id: 'last_seen_timestamp',
        ok: lastSeenTs != null,
        enablesDossierAddition:
          'add last-seen timestamp to separate repeated context from a true new delta',
      },
      {
        id: 'snapshot_identity',
        ok: hasKnownSnapshot || hasCurrentSnapshot,
        enablesDossierAddition:
          'add known/current snapshot id or hash for deterministic delta classification',
      },
      {
        id: 'owner',
        ok: Boolean(params.owner),
        enablesDossierAddition: 'add accountable owner for the signal queue',
      },
      {
        id: 'due_date',
        ok: dueTs != null,
        enablesDossierAddition: 'add due date to classify deadline urgency',
      },
      {
        id: 'blocked_decision',
        ok: hasBlockedDecision,
        enablesDossierAddition:
          'add blocked decision wording for dossier-safe escalation rationale',
      },
    ];
    const evidenceGaps = gapSpecs
      .filter((gap) => !gap.ok)
      .map((gap) => ({
        missingDataPoint: gap.id,
        enablesDossierAddition: gap.enablesDossierAddition,
        category: 'evidence_freshness_guard',
      }));
    const positiveFollowUps = evidenceGaps.map((gap) => ({
      ...gap,
      state: 'missing_evidence',
    }));
    const sourceActions = {
      inspected: ['dashboard-api.evidenceFreshnessGuardStatus'],
      referenced: [
        'dashboard-api.vnbDeltaSignalClassifierStatus',
        'dashboard-api.crossChannelVnbSignalQueueStatus',
        'dashboard-api.leadershipDeltaCockpitStatus',
        'vdmi.dossier',
        'evidence-planner.plan',
      ],
      notCalled: [
        'mail.connector.ingest',
        'outlook.connector.read',
        'teams.connector.read',
        'calendar.connector.read',
        'monitoring.connector.read',
        'task.connector.read',
        'acf.card.create',
        'ticket.create',
        'notification.dispatchInternal',
        'hitl.create',
        'workflow.execute',
        'external.connector.call',
        'personal-agent.execute',
        'mako.dispatch',
        'billing.release',
        'settlement.prepareBilling',
        'tariff.mutate',
        'device-control.execute',
      ],
    };
    const status = escalationRecommended
      ? 'fresh_delta_escalation_candidate'
      : evidenceGaps.length > 0
        ? 'freshness_classification_with_gaps'
        : isKnownAnchor
          ? 'known_anchor_no_escalation'
          : isNewDelta
            ? 'fresh_delta_review'
            : 'freshness_review';
    const dossierFacts = [
      `Evidence Freshness Status: ${status}`,
      `Freshness State: ${freshnessState}`,
      `Delta State: ${deltaState}`,
      `Staleness Days: ${stalenessDays == null ? 'unknown' : stalenessDays}`,
      `Known Anchor: ${isKnownAnchor}`,
      `New Delta: ${isNewDelta}`,
      `Escalation Recommended: ${escalationRecommended}`,
    ];
    if (params.owner) dossierFacts.push(`Owner: ${params.owner}`);
    if (params.blockedDecision) dossierFacts.push(`Blocked Decision: ${params.blockedDecision}`);
    if (nonEscalationReason) dossierFacts.push(`Non-Escalation Reason: ${nonEscalationReason}`);

    return {
      capabilityKey: 'evidence_freshness_guard',
      safety: 'read_only_metadata_classification',
      signalId: params.signalId || null,
      status,
      freshnessState,
      deltaState,
      stalenessDays,
      baselineAgeDays,
      isKnownAnchor,
      isNewDelta,
      escalationRecommended,
      nonEscalationReason,
      blockedDecision: params.blockedDecision || null,
      owner: params.owner || null,
      dueDate: params.dueDate || null,
      processArea: params.processArea || null,
      sourceBoundary: {
        suppliedMetadataOnly: true,
        connectorRead: false,
        persistsRawPrivateContent: false,
        createsExternalAction: false,
      },
      evidenceGaps,
      missingEvidence: evidenceGaps,
      positiveFollowUps,
      sourceActions,
      dossierEvidence: {
        capabilityKey: 'evidence_freshness_guard',
        status,
        freshnessState,
        deltaState,
        stalenessDays,
        baselineAgeDays,
        isKnownAnchor,
        isNewDelta,
        escalationRecommended,
        nonEscalationReason,
        blockedDecision: params.blockedDecision || null,
        owner: params.owner || null,
        dueDate: params.dueDate || null,
        processArea: params.processArea || null,
        evidenceGaps,
        positiveFollowUps,
        sourceBoundary: {
          suppliedMetadataOnly: true,
          connectorRead: false,
          persistsRawPrivateContent: false,
          createsExternalAction: false,
        },
        sourceActions: { notCalled: sourceActions.notCalled },
        dossierFacts,
      },
      _errors: [],
    };
  },

  buildCrossDomainSpecialTopicsQueueStatus(params = {}) {
    const toList = (value) => {
      if (Array.isArray(value)) return value.filter(Boolean);
      if (!value) return [];
      const trimmed = String(value).trim();
      if (!trimmed) return [];
      if (trimmed.startsWith('[') && trimmed.endsWith(']')) {
        try {
          const parsed = JSON.parse(trimmed);
          return Array.isArray(parsed) ? parsed.filter(Boolean) : [parsed].filter(Boolean);
        } catch (_err) {
          process.stderr.write(
            `[methods-part-11-of-14] silent-catch-fallback (line 1583): ${_err && _err.message}\n`
          );
          return [trimmed];
        }
      }
      return trimmed
        .split(',')
        .map((item) => item.trim())
        .filter(Boolean);
    };
    const slug = (value, fallback) =>
      String(value || fallback)
        .trim()
        .toLowerCase()
        .replace(/[^a-z0-9]+/g, '-')
        .replace(/^-|-$/g, '')
        .slice(0, 48);
    const isOverdue = (dueAt) => {
      const ts = Date.parse(dueAt || '');
      return Number.isFinite(ts) && ts < Date.now();
    };
    const evidenceRefs = toList(params.evidenceRefs);
    const suppliedTopics = toList(params.topics);
    const topicItems =
      suppliedTopics.length > 0
        ? suppliedTopics
        : [
            params.topic || 'Grossanschluss Flexibilitaet Energy Sharing',
            !params.topic && 'Mess- und Steuerdaten Kapazitaetsbestellung',
          ].filter(Boolean);
    const gapMessages = {
      owner_role: 'add owner role to route the topic to the right management lane',
      due_date: 'add due date to rank governance urgency',
      regulatory_reference: 'add regulatory reference to ground the management decision',
      data_gap: 'add missing data point to focus evidence preparation',
      asset_revenue_impact: 'add asset/revenue impact note to support management prioritization',
      escalation_threshold: 'add escalation threshold to clarify when the topic enters a gate',
      next_governance_gate: 'add next governance gate to prepare the responsible committee',
      decision_status: 'add decision status to separate observation from decision readiness',
      evidence_refs: 'add evidence references to make the queue dossier-grounded',
    };
    const queueRows = topicItems.map((topic, index) => {
      const topicLabel = typeof topic === 'object' ? topic.topicLabel || topic.topic : topic;
      const source = typeof topic === 'object' ? topic : params;
      const missing = [];
      if (!source.ownerRole) missing.push('owner_role');
      if (!source.dueAt) missing.push('due_date');
      if (!source.regulatoryReference) missing.push('regulatory_reference');
      if (!source.dataGap) missing.push('data_gap');
      if (!source.assetRevenueImpact) missing.push('asset_revenue_impact');
      if (!source.escalationThreshold) missing.push('escalation_threshold');
      if (!source.nextGovernanceGate) missing.push('next_governance_gate');
      if (!source.decisionStatus) missing.push('decision_status');
      if (evidenceRefs.length === 0 && !source.evidenceRefs) missing.push('evidence_refs');
      const rowEvidenceRefs = toList(source.evidenceRefs || evidenceRefs);
      let decisionStatus = source.decisionStatus || 'needs_management_evidence';
      if (isOverdue(source.dueAt) && missing.length > 0) decisionStatus = 'escalation_candidate';
      else if (missing.length === 0) decisionStatus = 'ready_for_governance_gate';
      else if (source.decisionStatus) decisionStatus = source.decisionStatus;
      return {
        topicKey: slug(topicLabel, `special-topic-${index + 1}`),
        topicLabel: topicLabel || `Special topic ${index + 1}`,
        domainLane: source.domainLane || 'cross_domain_management',
        ownerRole: source.ownerRole || null,
        dueAt: source.dueAt || null,
        regulatoryReference: source.regulatoryReference || null,
        dataGap: source.dataGap || null,
        assetRevenueImpact: source.assetRevenueImpact || null,
        escalationThreshold: source.escalationThreshold || null,
        nextGovernanceGate: source.nextGovernanceGate || null,
        decisionStatus,
        evidenceRefs: rowEvidenceRefs,
        missingEvidence: missing,
        positiveFollowUps: missing.map((missingDataPoint) => ({
          missingDataPoint,
          enablesDossierAddition: gapMessages[missingDataPoint],
          category: 'cross_domain_special_topics_queue',
        })),
      };
    });
    const missingEvidence = queueRows.flatMap((row) =>
      row.missingEvidence.map((missingDataPoint) => ({
        topicKey: row.topicKey,
        topicLabel: row.topicLabel,
        missingDataPoint,
        enablesDossierAddition: gapMessages[missingDataPoint],
        category: 'cross_domain_special_topics_queue',
      }))
    );
    const positiveFollowUps = missingEvidence.map((gap) => ({ ...gap }));
    const status = queueRows.every((row) => row.missingEvidence.length === 0)
      ? 'ready_for_governance_gate'
      : queueRows.some((row) => row.decisionStatus === 'escalation_candidate')
        ? 'needs_escalation_evidence'
        : 'needs_management_evidence';
    const sourceActions = {
      inspected: ['dashboard-api.crossDomainSpecialTopicsQueueStatus'],
      referenced: [
        'vdmi.dossier',
        'evidence-registry.lookup',
        'capability-broker.recommend',
        'presentation.generate',
      ],
      notCalled: [
        'mail.connector.ingest',
        'persona-inbox.enqueue',
        'notification.dispatchInternal',
        'hitl.create',
        'vdmi.taskMutate',
        'external.connector.call',
        'mako.execute',
        'billing.execute',
        'settlement.execute',
        'tariff.execute',
        'device-control.execute',
        'capacity-booking.execute',
        'energy-sharing.execute',
        'personal-agent.execute',
      ],
    };
    const dossierFacts = [
      `Queue Status: ${status}`,
      `Topics: ${queueRows.length}`,
      `Open Gaps: ${missingEvidence.length}`,
    ];
    queueRows.slice(0, 3).forEach((row) => {
      dossierFacts.push(`${row.topicLabel}: ${row.decisionStatus}`);
    });

    return {
      capabilityKey: 'cross_domain_special_topics_queue',
      caseId: params.caseId || null,
      safety: 'read_only',
      status,
      queueStatus: status,
      queueRows,
      evidenceRows: queueRows.map((row) => ({
        topicKey: row.topicKey,
        evidenceRefs: row.evidenceRefs,
        missingEvidence: row.missingEvidence,
      })),
      missingEvidence,
      positiveFollowUps,
      managementSummary: {
        topicCount: queueRows.length,
        openGapCount: missingEvidence.length,
        nextGovernanceGates: [
          ...new Set(queueRows.map((row) => row.nextGovernanceGate).filter(Boolean)),
        ],
        domainLanes: [...new Set(queueRows.map((row) => row.domainLane).filter(Boolean))],
      },
      sourceActions,
      sourceBoundary: {
        suppliedMetadataOnly: true,
        connectorRead: false,
        persistsQueue: false,
        createsExternalAction: false,
      },
      dossierEvidence: {
        capabilityKey: 'cross_domain_special_topics_queue',
        status,
        queueRows,
        missingEvidence,
        positiveFollowUps,
        sourceActions: { notCalled: sourceActions.notCalled },
        dossierFacts,
      },
    };
  },

  buildCrossChannelVnbSignalQueueStatus(params = {}) {
    const toList = (value) => {
      if (Array.isArray(value))
        return value.filter((item) => item !== undefined && item !== null && item !== '');
      if (value && typeof value === 'string') {
        const trimmed = value.trim();
        if (!trimmed) return [];
        if (
          (trimmed.startsWith('[') && trimmed.endsWith(']')) ||
          (trimmed.startsWith('{') && trimmed.endsWith('}'))
        ) {
          try {
            const parsed = JSON.parse(trimmed);
            return Array.isArray(parsed) ? parsed : [parsed];
          } catch (_err) {
            process.stderr.write(
              `[methods-part-11-of-14] silent-catch-fallback (line 1766): ${_err && _err.message}\n`
            );
            return [trimmed];
          }
        }
        return trimmed
          .split(',')
          .map((item) => item.trim())
          .filter(Boolean);
      }
      return value && typeof value === 'object' ? [value] : [];
    };

    const normalizeStatus = (value) =>
      String(value || '')
        .trim()
        .toLowerCase();
    const isReady = (value) => {
      const status = normalizeStatus(value);
      return [
        'ready',
        'complete',
        'completed',
        'confirmed',
        'resolved',
        'valid',
        'provided',
        'ok',
      ].includes(status);
    };
    const isBlocked = (value) => {
      const status = normalizeStatus(value);
      return ['blocked', 'rejected', 'failed', 'missing', 'invalid'].includes(status);
    };
    const isOverdue = (dueAt) => {
      if (!dueAt) return false;
      const ts = Date.parse(dueAt);
      return Number.isFinite(ts) && ts < Date.now();
    };
    const inc = (target, key) => {
      const normalized = key || 'unknown';
      target[normalized] = (target[normalized] || 0) + 1;
    };

    const rawSignals = toList(params.signals);
    const signals =
      rawSignals.length > 0 &&
      rawSignals.every((item) => item && typeof item === 'object' && !Array.isArray(item))
        ? rawSignals
        : [
            {
              signalId: params.signalId,
              channel: params.channel,
              sourceSystem: params.sourceSystem,
              sourceRef: params.sourceRef,
              receivedAt: params.receivedAt,
              affectedProcess: params.affectedProcess,
              processType: params.processType,
              riskType: params.riskType,
              riskSeverity: params.riskSeverity,
              ownerRole: params.ownerRole,
              ownerPersonaId: params.ownerPersonaId,
              dueAt: params.dueAt,
              evidenceStatus: params.evidenceStatus,
              evidenceRefs: params.evidenceRefs,
              nextDatapoint: params.nextDatapoint,
              dedupeKey: params.dedupeKey,
              status: params.status,
            },
          ];

    const normalizedSignals = signals.map((signal, index) => {
      const sourceRefs = toList(signal.sourceRef || signal.sourceRefs);
      const evidenceRefs = toList(signal.evidenceRefs || signal.evidenceRef);
      const missing = [];
      const owner = signal.ownerRole || signal.ownerPersonaId || null;
      if (!owner) missing.push('owner');
      if (!signal.dueAt) missing.push('due_date');
      if (sourceRefs.length === 0) missing.push('source_ref');
      if (!signal.evidenceStatus && evidenceRefs.length === 0) missing.push('evidence_status');
      if (!signal.nextDatapoint) missing.push('next_datapoint');
      if (!signal.dedupeKey) missing.push('dedupe_key');

      let queueStatus = signal.status || 'ready_for_action';
      if (isBlocked(signal.evidenceStatus) || isBlocked(signal.status)) {
        queueStatus = 'blocked';
      } else if (missing.includes('owner')) {
        queueStatus = 'needs_owner';
      } else if (missing.includes('source_ref')) {
        queueStatus = 'needs_source_reference';
      } else if (missing.includes('evidence_status')) {
        queueStatus = 'needs_evidence';
      } else if (missing.includes('due_date')) {
        queueStatus = 'needs_due_date';
      } else if (isOverdue(signal.dueAt)) {
        queueStatus = 'overdue';
      } else if (!isReady(signal.evidenceStatus) && signal.evidenceStatus) {
        queueStatus = 'needs_evidence';
      }

      return {
        signalId: signal.signalId || `vnb-signal:${index + 1}`,
        channel: signal.channel || 'caller_supplied',
        sourceSystem: signal.sourceSystem || null,
        sourceRefs,
        receivedAt: signal.receivedAt || null,
        affectedProcess: signal.affectedProcess || signal.processType || 'unclassified_process',
        processType: signal.processType || signal.affectedProcess || null,
        riskType: signal.riskType || 'operational_signal',
        riskSeverity: signal.riskSeverity || 'medium',
        ownerRole: signal.ownerRole || null,
        ownerPersonaId: signal.ownerPersonaId || null,
        dueAt: signal.dueAt || null,
        evidenceStatus: signal.evidenceStatus || (evidenceRefs.length > 0 ? 'provided' : null),
        evidenceRefs,
        nextDatapoint: signal.nextDatapoint || null,
        dedupeKey: signal.dedupeKey || null,
        status: queueStatus,
        missing,
        overdue: isOverdue(signal.dueAt),
        contentPolicy: 'references_and_summary_only_no_raw_private_content',
      };
    });

    const byProcess = {};
    const byRiskType = {};
    normalizedSignals.forEach((signal) => {
      inc(byProcess, signal.affectedProcess);
      inc(byRiskType, signal.riskType);
    });

    const missingMap = {
      owner: 'add accountable owner role or persona for signal routing',
      due_date: 'add SLA due date for escalation timing',
      source_ref: 'add auditable source reference without raw private content',
      evidence_status: 'add evidence status or evidence reference',
      next_datapoint: 'add next operational datapoint request',
      dedupe_key: 'add duplicate suppression and provenance key',
    };
    const missingEvidence = [];
    normalizedSignals.forEach((signal) => {
      signal.missing.forEach((missingDataPoint) => {
        missingEvidence.push({
          signalId: signal.signalId,
          missingDataPoint,
          affectedProcess: signal.affectedProcess,
          status: signal.status,
          enablesDossierAddition: missingMap[missingDataPoint],
        });
      });
    });

    const sourceActions = {
      inspected: ['dashboard-api.crossChannelVnbSignalQueueStatus'],
      referenced: [
        'persona-inbox.enqueue',
        'notification.dispatchInternal',
        'hitl.create',
        'vdmi.dossier',
        'interface-placeholder.requestEvidence',
        'datapoint.health',
        'presentation.render',
      ],
      notCalled: [
        'mail.connector.ingest',
        'chat.connector.ingest',
        'portal.connector.ingest',
        'persona-inbox.enqueue',
        'notification.dispatchInternal',
        'hitl.create',
        'vdmi.taskMutate',
        'interface-placeholder.requestEvidence',
        'mako.dispatch',
        'billing.release',
        'settlement.prepareBilling',
        'tariff.mutate',
        'device-control.execute',
        'external.connector.call',
        'personal-agent.execute',
      ],
    };
    const statusCounts = normalizedSignals.reduce((acc, signal) => {
      inc(acc, signal.status);
      return acc;
    }, {});
    let queueStatus = 'ready_for_action';
    if (normalizedSignals.length === 0) {
      queueStatus = 'empty';
    } else if (statusCounts.blocked) {
      queueStatus = 'blocked';
    } else if (statusCounts.needs_owner) {
      queueStatus = 'needs_owner';
    } else if (statusCounts.needs_source_reference) {
      queueStatus = 'needs_source_reference';
    } else if (statusCounts.needs_evidence) {
      queueStatus = 'needs_evidence';
    } else if (statusCounts.overdue) {
      queueStatus = 'overdue';
    } else if (missingEvidence.length > 0) {
      queueStatus = 'needs_queue_metadata';
    }

    const positiveFollowUps = missingEvidence.map((gap) => ({
      ...gap,
      category: 'cross_channel_vnb_signal_queue',
    }));
    const readyForActionSignals = normalizedSignals.filter(
      (signal) => signal.status === 'ready_for_action'
    );
    const overdueSignals = normalizedSignals.filter(
      (signal) => signal.overdue || signal.status === 'overdue'
    );
    const nextDatapoints = [
      ...new Set(normalizedSignals.map((signal) => signal.nextDatapoint).filter(Boolean)),
    ];
    const dossierFacts = [
      `Queue Status: ${queueStatus}`,
      `Signals: ${normalizedSignals.length}`,
      `Overdue: ${overdueSignals.length}`,
      `Needs Owner: ${statusCounts.needs_owner || 0}`,
      `Needs Evidence: ${statusCounts.needs_evidence || 0}`,
    ];

    return {
      capabilityKey: 'cross_channel_vnb_signal_queue',
      safety: 'read_only',
      queueStatus,
      status: queueStatus,
      signalCount: normalizedSignals.length,
      normalizedSignals,
      byProcess,
      byRiskType,
      overdueSignals,
      needsOwnerSignals: normalizedSignals.filter((signal) => signal.status === 'needs_owner'),
      needsEvidenceSignals: normalizedSignals.filter(
        (signal) => signal.status === 'needs_evidence'
      ),
      readyForActionSignals,
      missingEvidence,
      positiveFollowUps,
      nextDatapoints,
      sourceActions,
      privacy: {
        contentMinimization: 'store references and caller summaries only',
        rawPrivateContentStored: false,
        externalIngestion: false,
      },
      dossierEvidence: {
        capabilityKey: 'cross_channel_vnb_signal_queue',
        queueStatus,
        signalCount: normalizedSignals.length,
        overdueCount: overdueSignals.length,
        needsOwnerCount: statusCounts.needs_owner || 0,
        needsEvidenceCount: statusCounts.needs_evidence || 0,
        readyForActionCount: readyForActionSignals.length,
        topRiskTypes: Object.keys(byRiskType),
        affectedProcesses: Object.keys(byProcess),
        nextDatapoints,
        missingEvidence,
        positiveFollowUps,
        sourceActions: { notCalled: sourceActions.notCalled },
        dossierFacts,
      },
    };
  },

  buildAssetValuationTransformationGateStatus(params = {}) {
    const toList = (value) => {
      if (Array.isArray(value)) return value.filter(Boolean).map(String);
      if (value == null || value === '') return [];
      return String(value)
        .split(',')
        .map((item) => item.trim())
        .filter(Boolean);
    };
    const normalize = (value) =>
      String(value || '')
        .trim()
        .toLowerCase();
    const isProvided = (value) =>
      Boolean(value) &&
      !['missing', 'unknown', 'open', 'pending', 'none', 'null'].includes(normalize(value));
    const isLowQuality = (value) =>
      ['low', 'poor', 'blocked', 'invalid', 'insufficient', 'red'].includes(normalize(value));

    const missingMap = {
      asset_scope: 'add asset or asset-group scope for the management gate',
      book_value_source: 'add book-value and residual-value basis to the management gate',
      asset_condition_source: 'add technical condition and replacement/maintenance risk',
      transformation_option_basis: 'add Stilllegung/Umwidmung/H2/heat option evidence',
      contract_risk_basis: 'add contract and revenue-path risk statement',
      regulatory_uncertainty_basis: 'add regulatory impact caveat and decision boundary',
      data_quality_status: 'add confidence/readiness scoring',
      decision_owner: 'add accountable decision owner',
      next_decision: 'add next management-decision wording',
    };

    const missingEvidence = [];
    const addGap = (missingDataPoint, status = 'missing') => {
      missingEvidence.push({
        missingDataPoint,
        status,
        enablesDossierAddition: missingMap[missingDataPoint],
      });
    };

    const assetScope = {
      gateId: params.gateId || null,
      assetId: params.assetId || null,
      assetGroupId: params.assetGroupId || null,
      assetType: params.assetType || 'unspecified_asset',
      gridOperatorId: params.gridOperatorId || null,
    };
    if (!assetScope.assetId && !assetScope.assetGroupId) addGap('asset_scope');
    if (!isProvided(params.bookValueStatus) && !isProvided(params.bookValueSource))
      addGap('book_value_source');
    if (!isProvided(params.assetConditionStatus) && !isProvided(params.assetConditionSource)) {
      addGap('asset_condition_source');
    }
    if (!isProvided(params.transformationOption) && !isProvided(params.transformationOptionBasis)) {
      addGap('transformation_option_basis');
    }
    if (!isProvided(params.contractRisk) && !isProvided(params.contractRiskBasis))
      addGap('contract_risk_basis');
    if (
      !isProvided(params.regulatoryUncertainty) &&
      !isProvided(params.regulatoryUncertaintyBasis)
    ) {
      addGap('regulatory_uncertainty_basis');
    }
    if (!isProvided(params.dataQualityStatus)) addGap('data_quality_status');
    if (!isProvided(params.decisionOwner)) addGap('decision_owner');
    if (!isProvided(params.nextDecision)) addGap('next_decision');

    let decisionReadiness = 'ready_for_gate';
    if (isLowQuality(params.dataQualityStatus)) {
      decisionReadiness = 'blocked_by_low_data_quality';
    } else if (missingEvidence.some((gap) => gap.missingDataPoint === 'book_value_source')) {
      decisionReadiness = 'needs_book_value';
    } else if (missingEvidence.some((gap) => gap.missingDataPoint === 'asset_condition_source')) {
      decisionReadiness = 'needs_asset_condition';
    } else if (missingEvidence.some((gap) => gap.missingDataPoint === 'contract_risk_basis')) {
      decisionReadiness = 'needs_contract_evidence';
    } else if (
      missingEvidence.some((gap) => gap.missingDataPoint === 'transformation_option_basis')
    ) {
      decisionReadiness = 'needs_transformation_option';
    } else if (
      missingEvidence.some((gap) => gap.missingDataPoint === 'regulatory_uncertainty_basis')
    ) {
      decisionReadiness = 'needs_regulatory_assessment';
    } else if (missingEvidence.length > 0) {
      decisionReadiness = 'needs_gate_metadata';
    }

    const sourceDatapoints = toList(params.sourceDatapoints);
    const sourceRefs = toList(params.sourceRefs);
    const sourceActions = {
      inspected: ['dashboard-api.assetValuationTransformationGateStatus'],
      referenced: [
        'assets.effective',
        'gasnetz-waermeplanung.reconcile',
        'finance-agent.analyze',
        'investment-planning.createPlan',
        'vdmi.dossier',
        'datapoint.health',
        'presentation.render',
      ],
      notCalled: [
        'valuation.recordCreate',
        'accounting.postingCreate',
        'assets.applyOverride',
        'investment.approve',
        'asset-lifecycle.decommission',
        'asset-lifecycle.repurpose',
        'contract.release',
        'billing.release',
        'settlement.prepareBilling',
        'tariff.mutate',
        'mako.dispatch',
        'hitl.create',
        'device-control.execute',
        'external.connector.call',
        'notification.dispatchInternal',
        'personal-agent.execute',
      ],
    };
    const positiveFollowUps = missingEvidence.map((gap) => ({
      ...gap,
      category: 'asset_valuation_transformation_gate',
    }));
    const dossierFacts = [
      `Decision Readiness: ${decisionReadiness}`,
      `Asset Scope: ${assetScope.assetId || assetScope.assetGroupId || 'missing'}`,
      `Book Value: ${params.bookValueStatus || (params.bookValueSource ? 'provided' : 'missing')}`,
      `Asset Condition: ${params.assetConditionStatus || (params.assetConditionSource ? 'provided' : 'missing')}`,
      `Transformation Option: ${params.transformationOption || 'missing'}`,
      `Data Quality: ${params.dataQualityStatus || 'missing'}`,
    ];

    return {
      capabilityKey: 'asset_valuation_transformation_gate',
      safety: 'read_only',
      decisionReadiness,
      status: decisionReadiness,
      assetScope,
      bookValueStatus: {
        status: params.bookValueStatus || (params.bookValueSource ? 'provided' : 'missing'),
        source: params.bookValueSource || null,
      },
      assetConditionStatus: {
        status:
          params.assetConditionStatus || (params.assetConditionSource ? 'provided' : 'missing'),
        source: params.assetConditionSource || null,
      },
      transformationOption: {
        option: params.transformationOption || null,
        basis: params.transformationOptionBasis || null,
      },
      contractRisk: {
        status: params.contractRisk || null,
        basis: params.contractRiskBasis || null,
      },
      regulatoryUncertainty: {
        status: params.regulatoryUncertainty || null,
        basis: params.regulatoryUncertaintyBasis || null,
      },
      dataQualityStatus: {
        status: params.dataQualityStatus || null,
        blocked: isLowQuality(params.dataQualityStatus),
      },
      decisionOwner: params.decisionOwner || null,
      nextDecision: params.nextDecision || null,
      sourceDatapoints,
      sourceRefs,
      missingEvidence,
      positiveFollowUps,
      sourceActions,
      dossierEvidence: {
        capabilityKey: 'asset_valuation_transformation_gate',
        decisionReadiness,
        assetScope,
        bookValueStatus:
          params.bookValueStatus || (params.bookValueSource ? 'provided' : 'missing'),
        assetConditionStatus:
          params.assetConditionStatus || (params.assetConditionSource ? 'provided' : 'missing'),
        transformationOption: params.transformationOption || null,
        contractRisk: params.contractRisk || null,
        regulatoryUncertainty: params.regulatoryUncertainty || null,
        dataQualityStatus: params.dataQualityStatus || null,
        decisionOwner: params.decisionOwner || null,
        nextDecision: params.nextDecision || null,
        sourceDatapoints,
        sourceRefs,
        missingEvidence,
        positiveFollowUps,
        sourceActions: { notCalled: sourceActions.notCalled },
        dossierFacts,
      },
    };
  },
};
