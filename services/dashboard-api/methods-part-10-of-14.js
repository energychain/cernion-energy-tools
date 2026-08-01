'use strict';

// dashboard-api methods chunk 10/14 — extracted verbatim from
// services/dashboard-api.service.js as part of the v0.99 file-size modularization.
// Contains: buildStadtwerkMauerSalesBriefingItems, buildStadtwerkMauerSalesBriefingRows, buildStadtwerkMauerSalesEvidenceRows, buildStadtwerkMauerSalesGapRows, buildStadtwerkMauerSalesFollowUpRows, buildStadtwerkMauerWorkbenchSelectedTargetStatus, normalizeStadtwerkMauerWorkbenchTargetId, buildStadtwerkMauerWorkbenchTargetDirectory, mapStadtwerkMauerTargetToSection, buildStadtwerkMauerWorkbenchSelectedRows, buildStadtwerkMauerWorkbenchFocusRows, buildStadtwerkMauerWorkbenchFocusHelperRows, buildStadtwerkMauerWorkbenchLandingStatus, buildStadtwerkMauerWorkbenchLandingRows, buildStadtwerkMauerWorkbenchSectionRows, buildStadtwerkMauerWorkbenchPresenterActionRows

const { stadtwerkMauerPvMissingNap } = require('./shared');

module.exports = {
  buildStadtwerkMauerSalesBriefingItems({
    seed,
    caseId,
    audience,
    caseDetailStatus,
    gridPlanningRoleQueueStatus,
    tenantDatabrowserStatus,
  }) {
    const missingEvidenceIds = new Set(
      (caseDetailStatus?.missingEvidence || []).map((item) => item.missingDataPoint)
    );
    const evidenceRows =
      caseDetailStatus?.evidence || this.buildStadtwerkMauerCaseEvidence(seed, {});
    const presentEvidence = evidenceRows
      .filter((item) => item.present === true)
      .map((item) => item.id);
    const openEvidence = evidenceRows
      .filter((item) => item.present !== true)
      .map((item) => item.id);
    const audienceLabel =
      audience === 'key-account'
        ? 'Key Account'
        : audience === 'utility-expert'
          ? 'Stadtwerke Fachpublikum'
          : 'Vertrieb';
    return [
      {
        topicKey: 'demo_scope',
        topicLabel: 'Demo Scope',
        rowType: 'claim',
        audience,
        audienceLabel,
        safeClaim:
          'Stadtwerk Mauer ist als synthetischer Demo-Tenant mit klarer Trennung von Public Context, Seed und Sandbox-Artefakten inspectable.',
        claimStatus: 'evidence_backed',
        evidenceStatus: 'available',
        backingCaseId: caseId,
        backingWorkbenchItem: tenantDatabrowserStatus?.status || 'tenant_databrowser_ready',
        openGap: '',
        recommendedInternalFollowUp:
          'Open Tenant Databrowser for category, trace and source evidence rows.',
        notClaimableReason: '',
        sourceLabel: 'Tenant Databrowser / Blueprint seed',
      },
      {
        topicKey: 'case_evidence',
        topicLabel: 'Case Evidence',
        rowType: 'claim',
        audience,
        audienceLabel,
        safeClaim:
          'Der PV-Anmeldefall zeigt vorhandene und fehlende Evidenz getrennt, bevor ein fachlicher Anschluss- oder Beratungsstatus behauptet wird.',
        claimStatus: openEvidence.length > 0 ? 'assumption_backed' : 'evidence_backed',
        evidenceStatus: openEvidence.length > 0 ? 'partial' : 'complete',
        backingCaseId: caseId,
        backingWorkbenchItem: caseDetailStatus?.status || 'case_detail_status_unknown',
        openGap: openEvidence.join(', '),
        recommendedInternalFollowUp:
          'Resolve missing evidence before turning partial statements into firm claims.',
        notClaimableReason: '',
        sourceLabel: 'Selected Case Evidence',
      },
      {
        topicKey: 'znp_handover',
        topicLabel: 'Zielnetzplanung Handover',
        rowType: 'claim',
        audience,
        audienceLabel,
        safeClaim:
          'Zielnetzplanung sieht die Rolle, den naechsten Gate und die Evidence-Handover-Zeilen fuer den synthetischen Fall.',
        claimStatus:
          gridPlanningRoleQueueStatus?.found === true ? 'evidence_backed' : 'not_yet_claimable',
        evidenceStatus: gridPlanningRoleQueueStatus?.found === true ? 'available' : 'missing',
        backingCaseId: caseId,
        backingWorkbenchItem:
          gridPlanningRoleQueueStatus?.status || 'grid_planning_role_queue_missing',
        openGap: gridPlanningRoleQueueStatus?.found === true ? '' : 'grid_planning_role_queue',
        recommendedInternalFollowUp:
          'Open Zielnetzplanung Role Queue and verify NAP handover gaps.',
        notClaimableReason:
          gridPlanningRoleQueueStatus?.found === true
            ? ''
            : 'ZNP handover rows are not available for this case.',
        sourceLabel: 'Zielnetzplanung Role Queue',
      },
      {
        topicKey: 'commercial_value',
        topicLabel: 'Commercial Value',
        rowType: 'claim',
        audience,
        audienceLabel,
        safeClaim:
          'Ein kommunales Wert- oder Budgetversprechen ist im aktuellen Demo-Slice noch nicht belegbar.',
        claimStatus: 'not_yet_claimable',
        evidenceStatus: 'missing',
        backingCaseId: caseId,
        backingWorkbenchItem: 'municipal_energy_value_analysis',
        openGap: 'municipal_energy_value_analysis',
        recommendedInternalFollowUp:
          'Implement #324 before using municipal value or concession-fee talking points.',
        notClaimableReason:
          'Municipal value analysis is a separate read-only endpoint and not implemented in #321.',
        sourceLabel: 'Planned #324 Municipal Energy Value Lagebild',
      },
      {
        topicKey: 'crm_customer_context',
        topicLabel: 'Customer Context',
        rowType: 'claim',
        audience,
        audienceLabel,
        safeClaim:
          'Es werden keine realen Kundenstammdaten, CRM-Datensaetze oder Angebote aus diesem Briefing erzeugt.',
        claimStatus: 'evidence_backed',
        evidenceStatus: 'guarded',
        backingCaseId: caseId,
        backingWorkbenchItem: 'no_call_guards',
        openGap: missingEvidenceIds.has('customerReference') ? 'customerReference' : '',
        recommendedInternalFollowUp:
          'Add a future customer-master integration only after a separate product cut.',
        notClaimableReason: '',
        sourceLabel: 'No-call guard contract',
      },
    ].filter(
      (item) =>
        item.audience === audience ||
        item.topicKey !== 'crm_customer_context' ||
        presentEvidence.length >= 0
    );
  },

  buildStadtwerkMauerSalesBriefingRows(briefingItems = []) {
    return briefingItems.map((item) => ({
      topicKey: item.topicKey,
      topicLabel: item.topicLabel,
      rowType: item.rowType,
      audience: item.audience,
      audienceLabel: item.audienceLabel,
      safeClaim: item.safeClaim,
      claimStatus: item.claimStatus,
      evidenceStatus: item.evidenceStatus,
      backingCaseId: item.backingCaseId,
      backingWorkbenchItem: item.backingWorkbenchItem,
      openGap: item.openGap,
      recommendedInternalFollowUp: item.recommendedInternalFollowUp,
      notClaimableReason: item.notClaimableReason,
      sourceLabel: item.sourceLabel,
    }));
  },

  buildStadtwerkMauerSalesEvidenceRows({ briefingItems = [], caseDetailStatus = null } = {}) {
    const caseEvidence = caseDetailStatus?.evidence || [];
    const evidenceRows = caseEvidence.map((item) => ({
      evidenceId: item.id,
      topicKey: item.id,
      label: this.humanizeWorkbenchLabel(item.id),
      evidenceStatus: item.present ? 'present' : item.state || 'missing',
      present: item.present === true,
      required: item.required === true,
      dataClass: item.dataClass || 'syntheticTenantSeed',
      sourceLabel: 'Selected Case Evidence',
      enablesSafeClaim: item.present === true ? 'yes' : 'no',
    }));
    const topicRows = briefingItems.map((item) => ({
      evidenceId: `briefing:${item.topicKey}`,
      topicKey: item.topicKey,
      label: item.topicLabel,
      evidenceStatus: item.evidenceStatus,
      present: item.claimStatus !== 'not_yet_claimable',
      required: item.claimStatus === 'not_yet_claimable',
      dataClass:
        item.topicKey === 'commercial_value' ? 'plannedReadModel' : 'generatedWorkbenchProjection',
      sourceLabel: item.sourceLabel,
      enablesSafeClaim: item.claimStatus === 'evidence_backed' ? 'yes' : 'partial',
    }));
    return [...topicRows, ...evidenceRows];
  },

  buildStadtwerkMauerSalesGapRows({ missingEvidence = [], briefingItems = [] } = {}) {
    const evidenceGaps = missingEvidence.map((gap) => ({
      gapKey: gap.missingDataPoint,
      topicKey: gap.missingDataPoint,
      label: this.humanizeWorkbenchLabel(gap.missingDataPoint),
      status: gap.state || 'open',
      openGap: gap.missingDataPoint,
      requiredForSafeClaim: 'yes',
      nextInternalFollowUp: gap.enablesDossierAddition,
      sourceLabel: gap.dataClass || 'case_evidence',
    }));
    const claimGaps = briefingItems
      .filter((item) => item.claimStatus === 'not_yet_claimable')
      .map((item) => ({
        gapKey: item.topicKey,
        topicKey: item.topicKey,
        label: item.topicLabel,
        status: item.claimStatus,
        openGap: item.openGap,
        requiredForSafeClaim: 'yes',
        nextInternalFollowUp: item.recommendedInternalFollowUp,
        sourceLabel: item.sourceLabel,
      }));
    return [...evidenceGaps, ...claimGaps];
  },

  buildStadtwerkMauerSalesFollowUpRows({ missingEvidence = [], briefingItems = [] } = {}) {
    return [
      ...briefingItems.map((item) => ({
        followUpKey: item.topicKey,
        topicKey: item.topicKey,
        audience: item.audience,
        claimStatus: item.claimStatus,
        label: item.topicLabel,
        nextInternalFollowUp: item.recommendedInternalFollowUp,
        enablesSafeClaim:
          item.claimStatus === 'not_yet_claimable' ? 'after_gap_resolution' : 'already_safe',
      })),
      ...missingEvidence.map((gap) => ({
        followUpKey: gap.missingDataPoint,
        topicKey: gap.missingDataPoint,
        audience: 'all',
        claimStatus: 'evidence_gap',
        label: this.humanizeWorkbenchLabel(gap.missingDataPoint),
        nextInternalFollowUp: gap.enablesDossierAddition,
        enablesSafeClaim: 'after_gap_resolution',
      })),
    ];
  },

  buildStadtwerkMauerWorkbenchSelectedTargetStatus({
    tenantId = 'stadtwerk-mauer',
    caseId = 'smm-budibase-workbench',
    targetId = 'hub',
    hubStatus = null,
    roleCatalogStatus = null,
    landingStatus = null,
  } = {}) {
    const seed = stadtwerkMauerPvMissingNap;
    const sandboxBoundaryAllowed = tenantId === seed.demoTenant.tenantId;
    const normalizedTargetId = this.normalizeStadtwerkMauerWorkbenchTargetId(targetId);
    const targetDirectory = sandboxBoundaryAllowed
      ? this.buildStadtwerkMauerWorkbenchTargetDirectory({
          hubStatus,
          roleCatalogStatus,
          landingStatus,
        })
      : [];
    const selectedTarget =
      targetDirectory.find((target) => target.targetId === normalizedTargetId) || null;
    const selectedRows = selectedTarget
      ? this.buildStadtwerkMauerWorkbenchSelectedRows(selectedTarget)
      : [];
    const focusRows = selectedTarget
      ? this.buildStadtwerkMauerWorkbenchFocusRows(selectedTarget)
      : [];
    const helperRows = selectedTarget
      ? this.buildStadtwerkMauerWorkbenchFocusHelperRows(selectedTarget)
      : [];
    const missingEvidence = !sandboxBoundaryAllowed
      ? [
          {
            missingDataPoint: 'stadtwerk_mauer_tenant_scope',
            enablesDossierAddition:
              'select the synthetic tenant stadtwerk-mauer before rendering selected Workbench focus state',
            dataClass: 'syntheticTenantSeed',
            state: 'clarification',
          },
        ]
      : selectedTarget
        ? []
        : [
            {
              missingDataPoint: 'supported_workbench_target',
              enablesDossierAddition:
                'choose one of the supported Hub or role target ids before rendering a focus panel',
              dataClass: 'generatedWorkbenchItem',
              state: 'not_found',
            },
          ];
    const noCallGuards = Array.from(
      new Set([
        ...(seed.forbiddenActions || []),
        ...(hubStatus?.sourceActions?.notCalled || []),
        ...(roleCatalogStatus?.sourceActions?.notCalled || []),
        ...(landingStatus?.sourceActions?.notCalled || []),
        'budibase.table.write',
        'budibase.system_of_record',
        'budibase.automation.arbitrary_write',
        'budibase.ui_state.persist',
        'role.assignment.write',
        'auth.policy.mutate',
        'tenant.provision',
        'setup.execute',
        'reset.execute',
        'delete.execute',
        'public-context.mutate',
        'sandbox-runtime.mutate',
        'production.mutate',
        'rundeck.job.execute',
        'operations-runbook.execute',
        'mako.dispatch',
        'billing.release',
        'settlement.prepareBilling',
        'tariff.mutate',
        'device-control.execute',
        'external.connector.call',
        'hitl.create',
        'personal-agent.execute',
      ])
    );
    const status = !sandboxBoundaryAllowed
      ? 'workbench_selected_target_blocked_outside_sandbox_tenant'
      : selectedTarget
        ? selectedTarget.status === 'available'
          ? 'workbench_selected_target_ready'
          : 'workbench_selected_target_ready_with_planned_detail'
        : 'workbench_selected_target_not_found';
    const positiveFollowUps = [
      ...missingEvidence.map((item) => ({
        ...item,
        category: 'stadtwerk_mauer_workbench_selected_target',
      })),
      ...(selectedTarget && selectedTarget.status !== 'available'
        ? [
            {
              missingDataPoint: selectedTarget.targetId,
              enablesDossierAddition: selectedTarget.followUp,
              category: 'stadtwerk_mauer_workbench_selected_target',
              state: selectedTarget.status,
            },
          ]
        : []),
    ];
    const supportedTargetIds = targetDirectory.map((target) => target.targetId);
    const dossierFacts = [
      `Workbench Selected Target Status: ${status}`,
      `Tenant: ${tenantId}`,
      `Case: ${caseId}`,
      `Requested target: ${normalizedTargetId}`,
      `Supported targets: ${supportedTargetIds.length}`,
    ];

    return {
      capabilityKey: 'stadtwerk_mauer_workbench_selected_target',
      safety: 'read_only',
      found: sandboxBoundaryAllowed && Boolean(selectedTarget),
      status,
      tenantId,
      requiredTenantId: seed.demoTenant.tenantId,
      sandboxBoundaryAllowed,
      caseId,
      requiredCaseId: 'smm-budibase-workbench',
      requestedTargetId: normalizedTargetId,
      selectedTargetId: selectedTarget?.targetId || null,
      selectedTitle: selectedTarget?.title || null,
      selectedRoleKey: selectedTarget?.roleKey || null,
      selectedSectionKey: selectedTarget?.sectionKey || null,
      selectedAnchor: selectedTarget?.anchor || null,
      selectedStatus: selectedTarget?.status || 'not_found',
      selectedRows,
      focusRows,
      helperRows,
      supportedTargetIds,
      missingEvidence,
      positiveFollowUps,
      capabilityBroker: {
        exposed: false,
        reason:
          'Workbench selected-target state is UI-near presentation metadata; no broad Personal-Agent route is added.',
      },
      hydrationRegistry: {
        exposed: false,
        reason: 'No dossier hydration rule is added for this Workbench-only focus-state slice.',
      },
      sourceActions: {
        inspected: ['dashboard-api.stadtwerkMauerWorkbenchSelectedTargetStatus'],
        referenced: [
          'dashboard-api.stadtwerkMauerWorkbenchHubStatus',
          'dashboard-api.stadtwerkMauerRoleWorkbenchCatalogStatus',
          'dashboard-api.stadtwerkMauerWorkbenchLandingStatus',
          'integrations/budibase/manifests/stadtwerk-mauer-workbench.json',
        ],
        notCalled: noCallGuards,
      },
      noCallGuards,
      dossierFacts,
      dossierEvidence: {
        status,
        tenantId,
        caseId,
        selectedTargetId: selectedTarget?.targetId || null,
        selectedRows,
        focusRows,
        helperRows,
        missingEvidence,
        positiveFollowUps,
        noCallGuards,
        dossierFacts,
      },
      meta: {
        inspected: [
          'dashboard-api.stadtwerkMauerWorkbenchSelectedTargetStatus',
          'budibase-stadtwerk-mauer-workbench-manifest',
        ],
      },
    };
  },

  normalizeStadtwerkMauerWorkbenchTargetId(targetId = 'hub') {
    const normalized = String(targetId || 'hub')
      .trim()
      .toLowerCase();
    const aliases = {
      admin: 'administrator-workbench',
      administrator: 'administrator-workbench',
      administrator_inventory: 'administrator-workbench',
      case: 'selected-case-detail',
      detail: 'selected-case-detail',
      case_detail: 'selected-case-detail',
      actions: 'selected-case-actions',
      case_actions: 'selected-case-actions',
      znp: 'grid-planning',
      grid: 'grid-planning',
      grid_planning: 'grid-planning',
      role_catalog: 'role-workbench-catalog',
      roles: 'role-workbench-catalog',
      sales: 'sales-key-account-workbench',
      vertrieb: 'sales-key-account-workbench',
      key_account: 'sales-key-account-workbench',
    };
    return aliases[normalized] || normalized.replace(/_/g, '-');
  },

  buildStadtwerkMauerWorkbenchTargetDirectory({
    hubStatus = null,
    roleCatalogStatus = null,
    landingStatus = null,
  } = {}) {
    const hubTargets = (hubStatus?.targets || []).map((target) => ({
      targetId: target.targetId,
      title: target.label,
      roleKey: target.routeKey,
      sectionKey: this.mapStadtwerkMauerTargetToSection(target.targetId, target.routeKey),
      anchor: `#${this.mapStadtwerkMauerTargetToSection(target.targetId, target.routeKey)}`,
      status: target.status || 'planned',
      readiness: target.readinessSummary || null,
      routeKey: target.routeKey || null,
      targetType: target.routeTarget?.type || 'read_model_navigation',
      safety: target.safety || 'read_only',
      nextGateLabel: target.nextGate?.label || this.humanizeWorkbenchLabel(target.nextGate?.id),
      followUp: target.enablesDossierAddition || target.nextGate?.label || null,
    }));
    const roleTargets = (roleCatalogStatus?.targets || []).map((target) => ({
      targetId: target.roleKey,
      title: target.displayName || target.label || this.humanizeWorkbenchLabel(target.roleKey),
      roleKey: target.roleKey,
      sectionKey:
        target.openTarget || this.mapStadtwerkMauerTargetToSection(target.roleKey, target.routeKey),
      anchor: `#${target.openTarget || this.mapStadtwerkMauerTargetToSection(target.roleKey, target.routeKey)}`,
      status: target.status || 'planned',
      readiness: target.readinessSummary || null,
      routeKey: target.routeKey || null,
      targetType: 'role_workbench_open_target',
      safety: target.safety || 'read_only',
      nextGateLabel: target.nextGate?.label || this.humanizeWorkbenchLabel(target.nextGate?.id),
      followUp: target.enablesDossierAddition || target.nextGate?.label || null,
    }));
    const landingTargets = [
      {
        targetId: 'hub',
        title: 'Workbench Hub',
        roleKey: 'presenter',
        sectionKey: 'hub',
        anchor: '#hub',
        status: hubStatus?.found === false ? 'blocked' : 'available',
        readiness: hubStatus?.status || 'workbench_hub_status_unknown',
        routeKey: 'stadtwerk-mauer',
        targetType: 'landing_focus',
        safety: 'read_only',
        nextGateLabel: 'Open generated Hub target rows',
        followUp: 'show the generated Workbench Hub and choose a supported target',
      },
      {
        targetId: 'landing',
        title: 'Demo Landing',
        roleKey: 'presenter',
        sectionKey: 'landing_status',
        anchor: '#landing_status',
        status: landingStatus?.found === false ? 'blocked' : 'available',
        readiness: landingStatus?.status || 'workbench_landing_status_unknown',
        routeKey: 'stadtwerk-mauer',
        targetType: 'landing_focus',
        safety: 'read_only',
        nextGateLabel: 'Review presenter-ready first screen',
        followUp: 'show landing, inspectable sections and presenter walkthrough cues',
      },
    ];
    const seen = new Set();
    return [...landingTargets, ...hubTargets, ...roleTargets].filter((target) => {
      if (!target.targetId || seen.has(target.targetId)) return false;
      seen.add(target.targetId);
      return true;
    });
  },

  mapStadtwerkMauerTargetToSection(targetId, routeKey) {
    const key = String(targetId || routeKey || '').replace(/_/g, '-');
    const map = {
      'administrator-workbench': 'administrator_inventory',
      'selected-case-detail': 'case_detail',
      'selected-case-actions': 'case_actions',
      'zielnetzplanung-workbench': 'grid_planning_role_queue',
      'sales-key-account-workbench': 'sales_briefing',
      'role-workbench-catalog': 'role_workbench_catalog',
      'grid-planning': 'grid_planning_role_queue',
      admin: 'administrator_inventory',
      sales: 'sales_briefing',
      'key-account': 'sales_briefing',
      'vdmi-governance': 'role_workbench_catalog',
    };
    return map[key] || map[String(routeKey || '').replace(/_/g, '-')] || 'hub';
  },

  buildStadtwerkMauerWorkbenchSelectedRows(target) {
    return [
      {
        rowKey: 'selected_target',
        label: 'Selected Target',
        valueLabel: target.title,
        status: target.status,
        sectionKey: target.sectionKey,
        anchor: target.anchor,
        roleKey: target.roleKey,
        safetyLabel: this.humanizeWorkbenchLabel(target.safety || 'read_only'),
      },
      {
        rowKey: 'target_readiness',
        label: 'Readiness',
        valueLabel: target.readiness || target.status,
        status: target.status,
        sectionKey: target.sectionKey,
        anchor: target.anchor,
        roleKey: target.roleKey,
        safetyLabel: this.humanizeWorkbenchLabel(target.safety || 'read_only'),
      },
    ];
  },

  buildStadtwerkMauerWorkbenchFocusRows(target) {
    return [
      {
        focusId: `${target.targetId}:section`,
        targetId: target.targetId,
        title: target.title,
        sectionKey: target.sectionKey,
        anchor: target.anchor,
        focusState:
          target.status === 'available' ? 'focus_available_section' : 'focus_planned_section',
        status: target.status,
        routeKey: target.routeKey,
        targetType: target.targetType,
        nextGateLabel: target.nextGateLabel,
      },
    ];
  },

  buildStadtwerkMauerWorkbenchFocusHelperRows(target) {
    return [
      {
        helperId: `${target.targetId}:open`,
        label: 'Open Target Section',
        helperText: `Focus ${target.title} in section ${target.sectionKey}.`,
        safeNextAction:
          target.status === 'available' ? 'show_selected_section' : 'show_planned_target_context',
        requiredEvidence: target.readiness || target.status,
        followUp: target.followUp,
      },
      {
        helperId: `${target.targetId}:boundary`,
        label: 'Interaction Boundary',
        helperText:
          'Budibase may select and render this section; Cernion remains the source of truth.',
        safeNextAction: 'query_refresh_only',
        requiredEvidence: 'read_only_workbench_query',
        followUp: 'do not write tenant data or execute runbooks from this focus state',
      },
    ];
  },

  buildStadtwerkMauerWorkbenchLandingStatus({
    tenantId = 'stadtwerk-mauer',
    caseId = 'smm-budibase-workbench',
    hubStatus = null,
    administratorInventoryStatus = null,
    roleCatalogStatus = null,
    gridPlanningRoleQueueStatus = null,
    caseActionsStatus = null,
    caseDetailStatus = null,
    e2eStatus = null,
    mastrStatus = null,
  } = {}) {
    const seed = stadtwerkMauerPvMissingNap;
    const sandboxBoundaryAllowed = tenantId === seed.demoTenant.tenantId;
    const sectionInputs = [
      ['landing', true],
      ['hub', hubStatus?.found === true],
      ['administrator_inventory', administratorInventoryStatus?.found === true],
      ['selected_case_detail', caseDetailStatus?.found === true],
      ['selected_case_actions', caseActionsStatus?.found === true],
      ['role_workbench_catalog', roleCatalogStatus?.found === true],
      ['grid_planning_role_queue', gridPlanningRoleQueueStatus?.found === true],
      ['mastr_overlay', Boolean(mastrStatus?.status)],
      ['e2e_demo_status', Boolean(e2eStatus?.status)],
    ];
    const availableSectionCount = sandboxBoundaryAllowed
      ? sectionInputs.filter(([, available]) => available).length
      : 0;
    const missingEvidence = sandboxBoundaryAllowed
      ? []
      : [
          {
            missingDataPoint: 'stadtwerk_mauer_tenant_scope',
            enablesDossierAddition:
              'select the synthetic tenant stadtwerk-mauer before rendering the demo landing status',
            dataClass: 'syntheticTenantSeed',
            state: 'clarification',
          },
        ];
    const noCallGuards = Array.from(
      new Set([
        ...(seed.forbiddenActions || []),
        ...(hubStatus?.sourceActions?.notCalled || []),
        ...(administratorInventoryStatus?.sourceActions?.notCalled || []),
        ...(roleCatalogStatus?.sourceActions?.notCalled || []),
        ...(gridPlanningRoleQueueStatus?.sourceActions?.notCalled || []),
        ...(caseActionsStatus?.sourceActions?.notCalled || []),
        'budibase.table.write',
        'budibase.api.call',
        'budibase.system_of_record',
        'budibase.automation.arbitrary_write',
        'tenant.provision',
        'setup.execute',
        'reset.execute',
        'delete.execute',
        'public-context.mutate',
        'sandbox-runtime.mutate',
        'production.mutate',
        'rundeck.job.execute',
        'operations-runbook.execute',
        'mako.dispatch',
        'billing.release',
        'settlement.prepareBilling',
        'tariff.mutate',
        'device-control.execute',
        'smgw.connector.call',
        'cls.control.execute',
        'external.connector.call',
        'webhook.emit',
        'hitl.create',
        'personal-agent.execute',
      ])
    );
    const landingRows = sandboxBoundaryAllowed
      ? this.buildStadtwerkMauerWorkbenchLandingRows({
          caseId,
          hubStatus,
          administratorInventoryStatus,
          roleCatalogStatus,
          gridPlanningRoleQueueStatus,
          caseActionsStatus,
          caseDetailStatus,
          e2eStatus,
          mastrStatus,
        })
      : [];
    const sectionRows = sandboxBoundaryAllowed
      ? this.buildStadtwerkMauerWorkbenchSectionRows({
          hubStatus,
          administratorInventoryStatus,
          roleCatalogStatus,
          gridPlanningRoleQueueStatus,
          caseActionsStatus,
          caseDetailStatus,
          mastrStatus,
          e2eStatus,
        })
      : [];
    const status = !sandboxBoundaryAllowed
      ? 'workbench_landing_blocked_outside_sandbox_tenant'
      : sectionRows.some((row) => row.status !== 'available')
        ? 'workbench_landing_presenter_ready_with_gaps'
        : 'workbench_landing_presenter_ready';
    const positiveFollowUps = [
      ...missingEvidence.map((item) => ({
        ...item,
        category: 'stadtwerk_mauer_workbench_landing',
      })),
      ...sectionRows
        .filter((row) => row.status !== 'available')
        .map((row) => ({
          missingDataPoint: row.sectionKey,
          enablesDossierAddition: row.followUp,
          category: 'stadtwerk_mauer_workbench_landing',
          state: row.status,
        })),
    ];
    const presenterActionRows = sandboxBoundaryAllowed
      ? this.buildStadtwerkMauerWorkbenchPresenterActionRows({
          sectionRows,
          gridPlanningRoleQueueStatus,
        })
      : [];
    const dossierFacts = [
      `Workbench Landing Status: ${status}`,
      `Tenant: ${tenantId}`,
      `Case: ${caseId}`,
      `Landing rows: ${landingRows.length}`,
      `Available sections: ${availableSectionCount}`,
    ];

    return {
      capabilityKey: 'stadtwerk_mauer_workbench_landing',
      safety: 'read_only',
      found: sandboxBoundaryAllowed,
      status,
      tenantId,
      requiredTenantId: seed.demoTenant.tenantId,
      sandboxBoundaryAllowed,
      caseId,
      requiredCaseId: 'smm-budibase-workbench',
      landingId: 'stadtwerk-mauer-workbench-landing',
      title: 'Stadtwerk Mauer Demo Workbench',
      subtitle: 'Presenter-ready read-only landing status',
      routeKey: 'stadtwerk-mauer',
      screenRoute: '/stadtwerk-mauer',
      readiness: {
        status,
        landingRows: landingRows.length,
        sectionRows: sectionRows.length,
        availableSectionCount,
        presenterActionCount: presenterActionRows.length,
        e2eDemoStatus: e2eStatus?.status || null,
        mastrOverlayStatus: mastrStatus?.status || null,
        evidenceQuality:
          caseDetailStatus?.caseSummary?.evidenceQuality ||
          e2eStatus?.evidenceQuality ||
          'no_demo_trace_yet',
      },
      summary: {
        label: 'Stadtwerk Mauer',
        demoPath: seed.demoPath || 'pv_registration_electrician_missing_nap',
        controlCase: seed.controlCase,
        processFamily: seed.processFamily,
        tenantLabel: seed.demoTenant?.label || 'Stadtwerk Mauer',
        safePresenterAction:
          presenterActionRows[0]?.label || 'Select the Stadtwerk Mauer sandbox tenant first',
        budibaseBoundary:
          'Budibase renders scalar landing/status rows only; Cernion remains the system of record and command gate.',
        syntheticIdDisclaimer:
          'Stadtwerk Mauer app, case, role, MaLo, MeLo, meter, consent and device-control values are synthetic demo identifiers unless explicitly marked as public context.',
      },
      landingRows,
      sectionRows,
      presenterActionRows,
      missingEvidence,
      positiveFollowUps,
      capabilityBroker: {
        exposed: false,
        reason:
          'Workbench landing is a first-screen presentation read model; no broad Personal-Agent capability route is added.',
      },
      hydrationRegistry: {
        exposed: false,
        reason:
          'No dossier hydration rule is added for this Workbench-only presenter landing slice.',
      },
      sourceActions: {
        inspected: ['dashboard-api.stadtwerkMauerWorkbenchLandingStatus'],
        referenced: [
          'dashboard-api.stadtwerkMauerWorkbenchHubStatus',
          'dashboard-api.stadtwerkMauerAdministratorInventoryStatus',
          'dashboard-api.stadtwerkMauerRoleWorkbenchCatalogStatus',
          'dashboard-api.stadtwerkMauerGridPlanningRoleQueueStatus',
          'dashboard-api.stadtwerkMauerCaseActionsStatus',
          'dashboard-api.stadtwerkMauerCaseDetailStatus',
          'stadtwerk-mauer-e2e-process-demo.getStatus',
          'stadtwerk-mauer-mastr-data-overlay.getStatus',
          'integrations/budibase/manifests/stadtwerk-mauer-workbench.json',
        ],
        notCalled: noCallGuards,
      },
      noCallGuards,
      dossierFacts,
      dossierEvidence: {
        status,
        tenantId,
        caseId,
        landingRows,
        sectionRows,
        presenterActionRows,
        missingEvidence,
        positiveFollowUps,
        noCallGuards,
        dossierFacts,
      },
      meta: {
        inspected: [
          'dashboard-api.stadtwerkMauerWorkbenchLandingStatus',
          'budibase-stadtwerk-mauer-workbench-manifest',
        ],
      },
    };
  },

  buildStadtwerkMauerWorkbenchLandingRows({
    caseId,
    hubStatus,
    administratorInventoryStatus,
    roleCatalogStatus,
    gridPlanningRoleQueueStatus,
    caseActionsStatus,
    caseDetailStatus,
    e2eStatus,
    mastrStatus,
  }) {
    return [
      {
        rowKey: 'demo_identity',
        category: 'demo_readiness',
        label: 'Stadtwerk Mauer Demo',
        status: 'available',
        statusLabel: 'Available',
        valueLabel: 'PV registration with missing NAP evidence',
        evidenceHint: caseId,
        roleTarget: 'presenter',
        safeNextAction: 'Open Hub targets',
        sourceCategory: 'syntheticTenantSeed',
      },
      {
        rowKey: 'public_context',
        category: 'data_basis',
        label: 'Public Context',
        status: mastrStatus?.status || 'mastr_overlay_status_unknown',
        statusLabel: this.humanizeWorkbenchLabel(
          mastrStatus?.status || 'mastr_overlay_status_unknown'
        ),
        valueLabel: mastrStatus?.municipality
          ? `${mastrStatus.municipality} ${mastrStatus.postalCode || ''}`.trim()
          : 'Mauer public-context overlay',
        evidenceHint: `${mastrStatus?.assetCount ?? 0} MaStR assets`,
        roleTarget: 'administrator-workbench',
        safeNextAction: 'Inspect MaStR overlay',
        sourceCategory: 'publicContextLayer',
      },
      {
        rowKey: 'tenant_seed',
        category: 'data_basis',
        label: 'Synthetic Tenant Seed',
        status: administratorInventoryStatus?.status || 'administrator_inventory_status_unknown',
        statusLabel: this.humanizeWorkbenchLabel(
          administratorInventoryStatus?.status || 'administrator_inventory_status_unknown'
        ),
        valueLabel: 'stadtwerk-mauer',
        evidenceHint: `${administratorInventoryStatus?.inventoryRows?.length ?? 0} inventory rows`,
        roleTarget: 'administrator-workbench',
        safeNextAction: 'Inspect Administrator inventory',
        sourceCategory: 'syntheticTenantSeed',
      },
      {
        rowKey: 'workbench_sections',
        category: 'navigation',
        label: 'Inspectable Sections',
        status: hubStatus?.status || 'workbench_hub_status_unknown',
        statusLabel: this.humanizeWorkbenchLabel(
          hubStatus?.status || 'workbench_hub_status_unknown'
        ),
        valueLabel: `${hubStatus?.targetRows?.length ?? 0} Hub targets`,
        evidenceHint: `${roleCatalogStatus?.roleRows?.length ?? 0} role workbench rows`,
        roleTarget: 'presenter',
        safeNextAction: 'Open role catalog',
        sourceCategory: 'generatedWorkbenchItem',
      },
      {
        rowKey: 'grid_planning',
        category: 'role_workbench',
        label: 'Zielnetzplanung',
        status: gridPlanningRoleQueueStatus?.status || 'grid_planning_role_queue_status_unknown',
        statusLabel: this.humanizeWorkbenchLabel(
          gridPlanningRoleQueueStatus?.status || 'grid_planning_role_queue_status_unknown'
        ),
        valueLabel: `${gridPlanningRoleQueueStatus?.queueRows?.length ?? 0} queue rows`,
        evidenceHint: `${gridPlanningRoleQueueStatus?.evidenceHandoverRows?.length ?? 0} evidence handover rows`,
        roleTarget: 'grid-planning',
        safeNextAction: 'Inspect ZNP evidence handover',
        sourceCategory: 'generatedVdmiProjection',
      },
      {
        rowKey: 'safe_actions',
        category: 'process_boundary',
        label: 'Safe Presenter Action',
        status: caseActionsStatus?.status || 'case_actions_status_unknown',
        statusLabel: this.humanizeWorkbenchLabel(
          caseActionsStatus?.status || 'case_actions_status_unknown'
        ),
        valueLabel: `${caseActionsStatus?.actionRows?.length ?? 0} read/verify actions`,
        evidenceHint: caseDetailStatus?.status || e2eStatus?.status || 'case_detail_status_unknown',
        roleTarget: 'presenter',
        safeNextAction: 'Refresh read-only status',
        sourceCategory: 'sandboxRuntimeArtifact',
      },
    ];
  },

  buildStadtwerkMauerWorkbenchSectionRows({
    hubStatus,
    administratorInventoryStatus,
    roleCatalogStatus,
    gridPlanningRoleQueueStatus,
    caseActionsStatus,
    caseDetailStatus,
    mastrStatus,
    e2eStatus,
  }) {
    const sectionDefs = [
      ['hub', 'Workbench Hub', hubStatus?.status, 'presenter', 'Open Hub targets'],
      [
        'administrator_inventory',
        'Administrator Inventory',
        administratorInventoryStatus?.status,
        'admin',
        'Inspect tenant inventory',
      ],
      [
        'selected_case_detail',
        'Selected Case Detail',
        caseDetailStatus?.status,
        'case-detail',
        'Inspect case evidence',
      ],
      [
        'selected_case_actions',
        'Selected Case Actions',
        caseActionsStatus?.status,
        'case-actions',
        'Refresh/verify status',
      ],
      [
        'role_workbench_catalog',
        'Role Workbench Catalog',
        roleCatalogStatus?.status,
        'roles',
        'Open role targets',
      ],
      [
        'grid_planning_role_queue',
        'Zielnetzplanung Role Queue',
        gridPlanningRoleQueueStatus?.status,
        'grid-planning',
        'Inspect ZNP queue',
      ],
      ['mastr_overlay', 'MaStR Overlay', mastrStatus?.status, 'admin', 'Inspect public context'],
      [
        'e2e_demo_status',
        'E2E Demo Status',
        e2eStatus?.status,
        'presenter',
        'Review demo trace status',
      ],
    ];
    return sectionDefs.map(([sectionKey, label, statusValue, roleTarget, safeNextAction]) => ({
      sectionKey,
      label,
      status: statusValue ? 'available' : 'planned',
      statusLabel: this.humanizeWorkbenchLabel(statusValue || 'planned'),
      evidenceHint: statusValue || 'not yet rendered',
      roleTarget,
      safeNextAction,
      followUp: statusValue
        ? `open ${label} from the generated Workbench first screen`
        : `add ${label} evidence before marking the first screen complete`,
    }));
  },

  buildStadtwerkMauerWorkbenchPresenterActionRows({
    sectionRows = [],
    gridPlanningRoleQueueStatus = null,
  } = {}) {
    const firstGap = sectionRows.find((row) => row.status !== 'available');
    return [
      {
        actionId: 'presenter-open-hub',
        label: 'Open Workbench Hub',
        riskClass: 'read_only',
        boundary: 'budibase-ui-near',
        enabled: true,
        enabledLabel: 'Enabled',
        targetSection: 'hub',
        expectedResult: 'Show generated Hub target rows',
        requiredEvidence: 'stadtwerk-mauer sandbox tenant',
      },
      {
        actionId: 'presenter-open-znp',
        label: 'Inspect Zielnetzplanung Queue',
        riskClass: 'read_only',
        boundary: 'cernion-api',
        enabled: Boolean(gridPlanningRoleQueueStatus?.found),
        enabledLabel: gridPlanningRoleQueueStatus?.found ? 'Enabled' : 'Blocked',
        targetSection: 'grid_planning_role_queue',
        expectedResult: 'Show queue and evidence handover rows',
        requiredEvidence:
          gridPlanningRoleQueueStatus?.status || 'grid_planning_role_queue_status_unknown',
      },
      {
        actionId: 'presenter-resolve-first-gap',
        label: firstGap ? `Review ${firstGap.label}` : 'Continue Expert Walkthrough',
        riskClass: 'read_only',
        boundary: 'cernion-api',
        enabled: true,
        enabledLabel: 'Enabled',
        targetSection: firstGap?.sectionKey || 'selected_case_detail',
        expectedResult:
          firstGap?.followUp || 'Move from landing status into selected case evidence',
        requiredEvidence: firstGap?.evidenceHint || 'all first-screen sections available',
      },
    ];
  },
};
