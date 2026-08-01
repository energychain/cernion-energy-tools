'use strict';

// dashboard-api methods chunk 8/14 — extracted verbatim from
// services/dashboard-api.service.js as part of the v0.99 file-size modularization.
// Contains: buildStadtwerkMauerNextGateRows, buildStadtwerkMauerWorkbenchHubStatus, buildStadtwerkMauerWorkbenchHubTargets, buildStadtwerkMauerWorkbenchTargetRows, buildStadtwerkMauerCaseActionsStatus, buildStadtwerkMauerSelectedCaseActions, buildStadtwerkMauerCaseActionRows, buildStadtwerkMauerProcessActionRows, buildStadtwerkMauerProcessLastResultRows, buildStadtwerkMauerProcessBoundaryRows, buildStadtwerkMauerRequiredEvidenceRows, buildStadtwerkMauerAdministratorInventoryStatus, buildStadtwerkMauerAdministratorInventoryCategories, buildStadtwerkMauerAdministratorInventoryRows, normalizeStadtwerkMauerDatabrowserCategory, buildStadtwerkMauerTenantDatabrowserStatus

const { stadtwerkMauerPvMissingNap } = require('./shared');

module.exports = {
  buildStadtwerkMauerNextGateRows(nextGates = []) {
    return nextGates.map((gate) => ({
      gateId: gate.id || null,
      label: gate.label || this.humanizeWorkbenchLabel(gate.id),
      allowedAction: gate.execution || gate.allowedAction || 'read_only_workbench',
      safetyLabel: gate.execution === 'hint_only' ? 'Hint only' : 'Read-only workbench',
      status: gate.execution === 'hint_only' ? 'available_hint' : 'available_read_only',
    }));
  },

  buildStadtwerkMauerWorkbenchHubStatus({
    tenantId = 'stadtwerk-mauer',
    caseId = 'smm-budibase-workbench',
    e2eStatus = null,
    mastrStatus = null,
    caseDetailStatus = null,
  } = {}) {
    const seed = stadtwerkMauerPvMissingNap;
    const sandboxBoundaryAllowed = tenantId === seed.demoTenant.tenantId;
    const dataClasses = Object.entries(seed.dataClasses || {}).map(([id, value]) => ({
      id,
      description: value.description,
      examples: value.examples || [],
    }));
    const noCallGuards = Array.from(
      new Set([
        ...(seed.forbiddenActions || []),
        ...(e2eStatus?.sourceActions?.notCalled || []),
        ...(mastrStatus?.sourceActions?.notCalled || []),
        'budibase.table.write',
        'budibase.api.call',
        'budibase.system_of_record',
        'rundeck.job.execute',
        'operations-runbook.execute',
        'setup.execute',
        'reset.execute',
        'provisioning.execute',
        'public-context.mutate',
        'production.mutate',
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
    const missingEvidence = sandboxBoundaryAllowed
      ? []
      : [
          {
            missingDataPoint: 'stadtwerk_mauer_tenant_scope',
            enablesDossierAddition:
              'select the synthetic tenant stadtwerk-mauer before rendering the Workbench Hub',
            dataClass: 'syntheticTenantSeed',
            state: 'clarification',
          },
        ];

    const targets = sandboxBoundaryAllowed
      ? this.buildStadtwerkMauerWorkbenchHubTargets({
          caseId,
          e2eStatus,
          mastrStatus,
          caseDetailStatus,
        })
      : [];
    const plannedOrBlocked = targets.filter((target) => target.status !== 'available');
    const status = sandboxBoundaryAllowed
      ? plannedOrBlocked.length > 0
        ? 'workbench_hub_ready_with_planned_targets'
        : 'workbench_hub_ready'
      : 'workbench_hub_blocked_outside_sandbox_tenant';
    const positiveFollowUps = [
      ...missingEvidence.map((item) => ({
        ...item,
        category: 'stadtwerk_mauer_workbench_hub',
      })),
      ...plannedOrBlocked.map((target) => ({
        missingDataPoint: target.targetId,
        enablesDossierAddition: target.enablesDossierAddition,
        category: 'stadtwerk_mauer_workbench_hub',
        state: target.status,
      })),
    ];
    const targetCounts = targets.reduce(
      (acc, target) => {
        acc[target.status] = (acc[target.status] || 0) + 1;
        return acc;
      },
      { available: 0, planned: 0, blocked: 0 }
    );
    const dossierFacts = [
      `Workbench Hub Status: ${status}`,
      `Tenant: ${tenantId}`,
      `Targets: ${targets.length}`,
      `Available targets: ${targetCounts.available || 0}`,
      `Planned targets: ${targetCounts.planned || 0}`,
      `Blocked targets: ${targetCounts.blocked || 0}`,
    ];

    return {
      capabilityKey: 'stadtwerk_mauer_workbench_hub',
      safety: 'read_only',
      found: sandboxBoundaryAllowed,
      status,
      tenantId,
      requiredTenantId: seed.demoTenant.tenantId,
      sandboxBoundaryAllowed,
      hubId: 'stadtwerk-mauer-workbench-hub',
      caseId,
      title: 'Stadtwerk Mauer Workbench Hub',
      routeKey: 'stadtwerk-mauer',
      screenRoute: '/stadtwerk-mauer',
      summary: {
        label: 'Stadtwerk Mauer',
        description:
          'Generated read-only launcher for Administrator, case detail, action, planning and role workbench targets.',
        targetCount: targets.length,
        targetCounts,
        caseDetailStatus: caseDetailStatus?.status || null,
        e2eDemoStatus: e2eStatus?.status || null,
        mastrOverlayStatus: mastrStatus?.status || null,
        syntheticIdDisclaimer:
          'Stadtwerk Mauer app, case, MaLo, MeLo, meter, consent and device-control values are synthetic demo identifiers unless explicitly marked as public context.',
      },
      dataClasses,
      targets,
      targetRows: this.buildStadtwerkMauerWorkbenchTargetRows(targets),
      readiness: {
        status,
        availableTargets: targetCounts.available || 0,
        plannedTargets: targetCounts.planned || 0,
        blockedTargets: targetCounts.blocked || 0,
        evidenceQuality:
          caseDetailStatus?.caseSummary?.evidenceQuality ||
          e2eStatus?.evidenceQuality ||
          'no_demo_trace_yet',
      },
      nextGate: plannedOrBlocked[0]?.nextGate || {
        id: 'admin_inventory_product_cut',
        label: 'Cut Administrator inventory as a generated read-only catalog (#307)',
      },
      missingEvidence,
      positiveFollowUps,
      capabilityBroker: {
        exposed: false,
        reason:
          'Workbench Hub is a generated navigation/readiness model; dossier evidence continues through existing read-only case/runbook surfaces.',
      },
      hydrationRegistry: {
        exposed: false,
        reason:
          'No Personal-Agent dossier hydration rule is added for this Workbench-only launcher slice.',
      },
      sourceActions: {
        inspected: ['dashboard-api.stadtwerkMauerWorkbenchHubStatus'],
        referenced: [
          'stadtwerk-mauer-e2e-process-demo.getStatus',
          'stadtwerk-mauer-mastr-data-overlay.getStatus',
          'dashboard-api.stadtwerkMauerCaseDetailStatus',
          'integrations/budibase/manifests/stadtwerk-mauer-workbench.json',
          'integrations/budibase/scripts/apply-stadtwerk-mauer-workbench.js',
        ],
        notCalled: noCallGuards,
      },
      noCallGuards,
      dossierFacts,
      dossierEvidence: {
        status,
        tenantId,
        hubId: 'stadtwerk-mauer-workbench-hub',
        targets: targets.map((target) => ({
          targetId: target.targetId,
          routeKey: target.routeKey,
          status: target.status,
          nextGate: target.nextGate,
        })),
        missingEvidence,
        positiveFollowUps,
        noCallGuards,
        dossierFacts,
      },
      meta: {
        inspected: [
          'dashboard-api.stadtwerkMauerWorkbenchHubStatus',
          'stadtwerk-mauer-e2e-process-demo.getStatus',
          'stadtwerk-mauer-mastr-data-overlay.getStatus',
          'budibase-stadtwerk-mauer-workbench-manifest',
        ],
      },
    };
  },

  buildStadtwerkMauerWorkbenchHubTargets({
    caseId = 'smm-budibase-workbench',
    e2eStatus = {},
    mastrStatus = {},
    caseDetailStatus = {},
  } = {}) {
    const caseDetailAvailable = caseDetailStatus?.found === true;
    const e2eReady = e2eStatus?.status || 'e2e_demo_status_unknown';
    const mastrReady = mastrStatus?.status || 'mastr_overlay_status_unknown';
    return [
      {
        targetId: 'administrator-workbench',
        routeKey: 'admin',
        label: 'Administrator Workbench',
        status: 'planned',
        safety: 'read_only',
        dataClasses: ['publicContextLayer', 'syntheticTenantSeed', 'sandboxRuntimeArtifact'],
        requiredEvidenceDomains: ['tenant_inventory', 'data_catalog', 'source_boundaries'],
        allowedActionClasses: ['read_model_navigation'],
        readinessSummary: 'Administrator inventory and data catalog are reserved for #307.',
        nextGate: {
          id: 'product_cut_307',
          label: 'Implement #307 as read-only tenant inventory/data catalog',
        },
        routeTarget: {
          type: 'budibase_route',
          routeKey: 'admin',
          path: '/stadtwerk-mauer/admin',
        },
        enablesDossierAddition:
          'add Administrator inventory categories, counts and inspectable read-only item metadata from #307',
      },
      {
        targetId: 'selected-case-detail',
        routeKey: 'case-detail',
        label: 'Selected Case Detail',
        status: caseDetailAvailable ? 'available' : 'blocked',
        safety: 'read_only',
        dataClasses: ['syntheticTenantSeed', 'sandboxRuntimeArtifact'],
        requiredEvidenceDomains: ['case_detail', 'blueprint_seed', 'trace_summary'],
        allowedActionClasses: ['read_model_navigation'],
        readinessSummary: caseDetailAvailable
          ? `Case detail for ${caseId} is renderable (${caseDetailStatus.status}).`
          : 'Selected case detail is not available for the requested tenant/case.',
        nextGate: caseDetailAvailable
          ? { id: 'inspect_case_detail', label: 'Render #304 selected case detail' }
          : { id: 'select_sandbox_case', label: 'Select a valid Stadtwerk-Mauer sandbox case' },
        routeTarget: {
          type: 'api_query',
          routeKey: 'case-detail',
          path: `/api/dashboard/stadtwerk-mauer-case-detail?tenantId=stadtwerk-mauer&caseId=${encodeURIComponent(
            caseId
          )}`,
        },
        enablesDossierAddition:
          'add selected case evidence, trace, artifact and next-gate details from #304',
      },
      {
        targetId: 'selected-case-actions',
        routeKey: 'case-actions',
        label: 'Selected Case Actions',
        status: 'available',
        safety: 'read_only_verify_only',
        dataClasses: ['sandboxRuntimeArtifact'],
        requiredEvidenceDomains: ['action_contract', 'automation_boundary', 'forbidden_actions'],
        allowedActionClasses: [
          'refresh_read_model',
          'verify_blueprint_seed',
          'validate_evidence_completeness',
        ],
        readinessSummary:
          'Curated action-button contract is available as a read-only/verify-only API.',
        nextGate: {
          id: 'render_case_actions',
          label: 'Render selected-case action rows from #305',
        },
        routeTarget: {
          type: 'api_query',
          routeKey: 'case-actions',
          path: `/api/dashboard/stadtwerk-mauer-case-actions?tenantId=stadtwerk-mauer&caseId=${encodeURIComponent(
            caseId
          )}`,
        },
        enablesDossierAddition:
          'add curated refresh, verify and lightweight validation button metadata from #305',
      },
      {
        targetId: 'zielnetzplanung-workbench',
        routeKey: 'grid-planning',
        label: 'Zielnetzplanung',
        status: 'planned',
        safety: 'read_only',
        dataClasses: ['publicContextLayer', 'syntheticTenantSeed'],
        requiredEvidenceDomains: ['grid_planning_context', 'nap_evidence', 'capacity_context'],
        allowedActionClasses: ['read_model_navigation'],
        readinessSummary: `MaStR overlay status: ${mastrReady}. Role-specific ZNP logic is out of scope for #306.`,
        nextGate: {
          id: 'role_workbench_cut_grid_planning',
          label: 'Cut a later ZNP role-workbench projection over VDMI evidence',
        },
        routeTarget: {
          type: 'planned_budibase_route',
          routeKey: 'grid-planning',
          path: '/stadtwerk-mauer/grid-planning',
        },
        enablesDossierAddition:
          'add ZNP-specific role projection and planning evidence once a role-workbench slice is cut',
      },
      {
        targetId: 'sales-key-account-workbench',
        routeKey: 'sales',
        label: 'Vertrieb / Key Account',
        status: 'planned',
        safety: 'read_only',
        dataClasses: ['syntheticTenantSeed'],
        requiredEvidenceDomains: ['customer_advisory_context', 'commercial_boundary'],
        allowedActionClasses: ['read_model_navigation'],
        readinessSummary:
          'Customer-facing advisory projection is planned; no Vertrieb logic is implemented in #306.',
        nextGate: {
          id: 'role_workbench_cut_sales',
          label: 'Cut a later Vertrieb/Key Account read-only advisory workbench',
        },
        routeTarget: {
          type: 'planned_budibase_route',
          routeKey: 'sales',
          path: '/stadtwerk-mauer/sales',
        },
        enablesDossierAddition:
          'add customer advisory/readiness projection once a Vertrieb role-workbench slice is cut',
      },
      {
        targetId: 'role-workbench-catalog',
        routeKey: 'role-catalog',
        label: 'Role Workbench Catalog',
        status: 'available',
        safety: 'read_only',
        dataClasses: ['syntheticTenantSeed'],
        requiredEvidenceDomains: ['role_catalog', 'route_contract', 'target_status'],
        allowedActionClasses: ['read_model_navigation'],
        readinessSummary: `E2E demo status: ${e2eReady}. Stable role target contract is available from #308.`,
        nextGate: {
          id: 'render_role_workbench_catalog',
          label: 'Render #308 role-workbench catalog/open-target rows',
        },
        routeTarget: {
          type: 'api_query',
          routeKey: 'role-catalog',
          path: '/api/dashboard/stadtwerk-mauer-role-workbench-catalog',
        },
        enablesDossierAddition:
          'add stable role-workbench target metadata and open-target contract from #308',
      },
    ];
  },

  buildStadtwerkMauerWorkbenchTargetRows(targets = []) {
    return targets.map((target) => ({
      status: target.status || 'unknown',
      routeKey: target.routeKey || null,
      label: target.label || this.humanizeWorkbenchLabel(target.targetId),
      readinessLabel: target.readinessSummary || null,
      nextGateLabel: target.nextGate?.label || this.humanizeWorkbenchLabel(target.nextGate?.id),
      safetyLabel: this.humanizeWorkbenchLabel(target.safety || 'read_only'),
      targetType: target.routeTarget?.type || null,
    }));
  },

  buildStadtwerkMauerCaseActionsStatus({
    tenantId = 'stadtwerk-mauer',
    caseId = 'smm-budibase-workbench',
    caseDetailStatus = null,
  } = {}) {
    const seed = stadtwerkMauerPvMissingNap;
    const sandboxBoundaryAllowed = tenantId === seed.demoTenant.tenantId;
    const selectedCaseAllowed = caseId === 'smm-budibase-workbench';
    const found =
      sandboxBoundaryAllowed && selectedCaseAllowed && caseDetailStatus?.found !== false;
    const missingEvidence = found
      ? caseDetailStatus?.missingEvidence || []
      : sandboxBoundaryAllowed
        ? [
            {
              missingDataPoint: 'stadtwerk_mauer_case_scope',
              enablesDossierAddition:
                'select the synthetic case smm-budibase-workbench before rendering action buttons',
              dataClass: 'syntheticTenantSeed',
              state: 'clarification',
            },
          ]
        : [
            {
              missingDataPoint: 'stadtwerk_mauer_tenant_scope',
              enablesDossierAddition:
                'select the synthetic tenant stadtwerk-mauer before rendering selected-case actions',
              dataClass: 'syntheticTenantSeed',
              state: 'clarification',
            },
          ];
    const noCallGuards = Array.from(
      new Set([
        ...(seed.forbiddenActions || []),
        ...(caseDetailStatus?.sourceActions?.notCalled || []),
        'budibase.table.write',
        'budibase.api.call',
        'budibase.system_of_record',
        'budibase.automation.arbitrary_write',
        'rundeck.job.execute',
        'operations-runbook.setup',
        'operations-runbook.reset',
        'operations-runbook.provision',
        'operations-runbook.e2e_smoke.execute',
        'tenant.seed.import',
        'tenant.seed.delete',
        'public-context.mutate',
        'production.mutate',
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
    const availableActions = found
      ? this.buildStadtwerkMauerSelectedCaseActions({
          tenantId,
          caseId,
          caseDetailStatus,
          missingEvidence,
        })
      : [];
    const actionRows = this.buildStadtwerkMauerCaseActionRows(availableActions);
    const processActionRows = found
      ? this.buildStadtwerkMauerProcessActionRows({
          actions: availableActions,
          caseDetailStatus,
          missingEvidence,
        })
      : [];
    const lastResultRows = found
      ? this.buildStadtwerkMauerProcessLastResultRows({
          actions: availableActions,
          caseDetailStatus,
          missingEvidence,
        })
      : [];
    const boundaryRows = found ? this.buildStadtwerkMauerProcessBoundaryRows() : [];
    const requiredEvidenceRows = found
      ? this.buildStadtwerkMauerRequiredEvidenceRows(missingEvidence)
      : [];
    const status = found
      ? missingEvidence.length > 0
        ? 'case_actions_ready_with_evidence_gaps'
        : 'case_actions_ready'
      : sandboxBoundaryAllowed
        ? 'case_actions_not_found'
        : 'case_actions_blocked_outside_sandbox_tenant';
    const positiveFollowUps = [
      ...missingEvidence.map((item) => ({
        ...item,
        category: 'stadtwerk_mauer_case_actions',
      })),
      ...availableActions
        .filter((action) => action.enabled === false)
        .map((action) => ({
          missingDataPoint: action.actionId,
          enablesDossierAddition: action.disabledReason || action.enablesDossierAddition,
          category: 'stadtwerk_mauer_case_actions',
          state: 'blocked',
        })),
    ];
    const budibaseAutomationHints = found
      ? [
          {
            hintId: 'refresh_selected_case_detail',
            trigger: 'button_click',
            actionId: 'refresh_read_model',
            method: 'GET',
            path: `/api/dashboard/stadtwerk-mauer-case-detail?tenantId=${encodeURIComponent(
              tenantId
            )}&caseId=${encodeURIComponent(caseId)}`,
            execution: 'ui_near_query_refresh_only',
          },
          {
            hintId: 'verify_blueprint_seed_read_only',
            trigger: 'button_click',
            actionId: 'verify_blueprint_seed',
            method: 'GET',
            path: '/api/operations-runbook/vdmi-blueprint-packs/verify?seedId=stadtwerk-mauer-pv-missing-nap-v1',
            execution: 'read_verify_only_no_setup_reset',
          },
          {
            hintId: 'validate_selected_case_evidence',
            trigger: 'button_click',
            actionId: 'validate_evidence_completeness',
            method: 'GET',
            path: `/api/dashboard/stadtwerk-mauer-case-actions?tenantId=${encodeURIComponent(
              tenantId
            )}&caseId=${encodeURIComponent(caseId)}`,
            execution: 'synchronous_metadata_validation_only',
          },
        ]
      : [];
    const rundeckBoundary = [
      {
        boundaryId: 'operations_runbook_verify_only',
        label: 'Blueprint Pack verify is read-only and may be referenced by Budibase buttons.',
        allowedPath: '/api/operations-runbook/vdmi-blueprint-packs/verify',
        forbiddenExecution: 'setup_reset_provisioning_e2e_smoke_rundeck_job_execute',
      },
      {
        boundaryId: 'operations_runbook_operational_execution',
        label:
          'Setup, reset, provisioning and E2E smoke remain Cernion-controlled runbook surfaces.',
        allowedPath: '/api/operations-runbook/**',
        forbiddenExecution: 'direct_budibase_execution_without_scope_gate',
      },
    ];
    const forbiddenActions = Array.from(
      new Set([...noCallGuards, 'arbitrary_budibase_table_write'])
    );
    const dossierFacts = [
      `Case Actions Status: ${status}`,
      `Tenant: ${tenantId}`,
      `Case: ${caseId}`,
      `Actions: ${availableActions.length}`,
      `Action rows: ${actionRows.length}`,
      `Process action rows: ${processActionRows.length}`,
      `Last result rows: ${lastResultRows.length}`,
    ];

    return {
      capabilityKey: 'stadtwerk_mauer_case_actions',
      safety: 'read_only_verify_only',
      found,
      status,
      tenantId,
      requiredTenantId: seed.demoTenant.tenantId,
      sandboxBoundaryAllowed,
      caseId,
      requiredCaseId: 'smm-budibase-workbench',
      processFamily: seed.processFamily,
      controlCase: seed.controlCase,
      blueprintSeedId: seed.id,
      caseDetailStatus: caseDetailStatus?.status || null,
      availableActions,
      actionRows,
      processActionRows,
      lastResultRows,
      boundaryRows,
      requiredEvidenceRows,
      budibaseAutomationHints,
      rundeckBoundary,
      forbiddenActions,
      missingEvidence,
      positiveFollowUps,
      summary: {
        actionCount: availableActions.length,
        enabledActionCount: availableActions.filter((action) => action.enabled !== false).length,
        processActionCount: processActionRows.length,
        disabledProcessActionCount: processActionRows.filter((row) => row.enabled === false).length,
        lastResultCount: lastResultRows.length,
        riskClass: 'read_only_verify_only',
        syntheticIdDisclaimer:
          'Stadtwerk Mauer case, MaLo, MeLo, meter, consent and device-control values are synthetic demo identifiers unless explicitly marked as public context.',
        budibaseBoundary:
          'Budibase may refresh queries and render curated button metadata; Cernion remains the command gate and system of record.',
      },
      capabilityBroker: {
        exposed: false,
        reason:
          'Selected-case actions are Workbench button metadata; no broad Personal-Agent capability route is added.',
      },
      hydrationRegistry: {
        exposed: false,
        reason: 'No dossier hydration rule is added for this Workbench-only action-bar slice.',
      },
      sourceActions: {
        inspected: ['dashboard-api.stadtwerkMauerCaseActionsStatus'],
        referenced: [
          'dashboard-api.stadtwerkMauerCaseDetailStatus',
          'stadtwerk-mauer-e2e-process-demo.getStatus',
          'operations-runbook.verifyVdmiBlueprintPackSeed',
          'integrations/budibase/manifests/stadtwerk-mauer-workbench.json',
          'integrations/budibase/scripts/apply-stadtwerk-mauer-workbench.js',
        ],
        notCalled: noCallGuards,
      },
      noCallGuards,
      dossierFacts,
      dossierEvidence: {
        status,
        tenantId,
        caseId,
        availableActions: actionRows,
        processActionRows,
        lastResultRows,
        boundaryRows,
        requiredEvidenceRows,
        missingEvidence,
        positiveFollowUps,
        noCallGuards,
        dossierFacts,
      },
      meta: {
        inspected: [
          'dashboard-api.stadtwerkMauerCaseActionsStatus',
          'dashboard-api.stadtwerkMauerCaseDetailStatus',
          'budibase-stadtwerk-mauer-workbench-manifest',
        ],
      },
    };
  },

  buildStadtwerkMauerSelectedCaseActions({
    tenantId,
    caseId,
    caseDetailStatus = {},
    missingEvidence = [],
  }) {
    const evidenceMissing = missingEvidence.length > 0;
    return [
      {
        actionId: 'refresh_read_model',
        label: 'Refresh Read Model',
        actionType: 'refresh_read_model',
        riskClass: 'read_only',
        method: 'GET',
        path: `/api/dashboard/stadtwerk-mauer-case-detail?tenantId=${encodeURIComponent(
          tenantId
        )}&caseId=${encodeURIComponent(caseId)}`,
        requiredScope: 'dashboard:read',
        confirmationRequired: false,
        enabled: true,
        nextGate: 'reload_selected_case_detail',
        evidenceStatus: caseDetailStatus.status || 'case_detail_status_unknown',
        enablesDossierAddition:
          'refresh selected-case evidence, trace and next-gate labels without mutating source data',
      },
      {
        actionId: 'verify_blueprint_seed',
        label: 'Verify Blueprint Seed',
        actionType: 'verify_blueprint_seed',
        riskClass: 'read_verify_only',
        method: 'GET',
        path: '/api/operations-runbook/vdmi-blueprint-packs/verify?seedId=stadtwerk-mauer-pv-missing-nap-v1',
        requiredScope: 'runbook:read',
        confirmationRequired: false,
        enabled: true,
        nextGate: 'show_blueprint_seed_integrity',
        evidenceStatus: 'verify_surface_available',
        enablesDossierAddition:
          'add Blueprint Pack integrity facts and evidence requirement labels to the selected case',
      },
      {
        actionId: 'validate_evidence_completeness',
        label: 'Validate Evidence Completeness',
        actionType: 'validate_evidence_completeness',
        riskClass: 'read_only',
        method: 'GET',
        path: `/api/dashboard/stadtwerk-mauer-case-actions?tenantId=${encodeURIComponent(
          tenantId
        )}&caseId=${encodeURIComponent(caseId)}`,
        requiredScope: 'dashboard:read',
        confirmationRequired: false,
        enabled: true,
        nextGate: evidenceMissing ? 'resolve_missing_evidence' : 'case_ready_for_next_gate_review',
        evidenceStatus: evidenceMissing ? 'evidence_gaps_present' : 'evidence_complete',
        enablesDossierAddition: evidenceMissing
          ? 'show which missing evidence must arrive before the next selected-case gate is complete'
          : 'show that selected-case evidence is complete for the current demo gate',
      },
    ];
  },

  buildStadtwerkMauerCaseActionRows(actions = []) {
    return actions.map((action) => ({
      actionId: action.actionId,
      label: action.label,
      actionType: action.actionType,
      riskClass: action.riskClass,
      method: action.method,
      path: action.path,
      requiredScope: action.requiredScope,
      confirmationRequired: action.confirmationRequired === true,
      enabled: action.enabled !== false,
      disabledReason: action.disabledReason || null,
      nextGate: action.nextGate || null,
      evidenceStatus: action.evidenceStatus || null,
    }));
  },

  buildStadtwerkMauerProcessActionRows({
    actions = [],
    caseDetailStatus = {},
    missingEvidence = [],
  } = {}) {
    const baseRows = actions.map((action) => ({
      actionId: action.actionId,
      label: action.label,
      riskClass: action.riskClass,
      boundary: action.actionId === 'verify_blueprint_seed' ? 'cernion-api' : 'budibase-ui-near',
      executionMode:
        action.actionId === 'verify_blueprint_seed' ? 'read_verify_only' : 'query_refresh_only',
      enabled: action.enabled !== false,
      enabledLabel: action.enabled === false ? 'blocked' : 'verify-ready',
      disabledReason: action.disabledReason || null,
      lastResultStatus:
        action.actionId === 'validate_evidence_completeness'
          ? missingEvidence.length > 0
            ? 'evidence_gaps_present'
            : 'evidence_complete'
          : action.evidenceStatus || caseDetailStatus?.status || 'not_run_in_panel',
      lastResultAt: null,
      requiredEvidenceKey:
        action.actionId === 'validate_evidence_completeness'
          ? missingEvidence[0]?.missingDataPoint || 'selected_case_evidence_complete'
          : action.requiredScope || 'dashboard:read',
      requiredGate: action.nextGate || 'presenter_review',
      nextPresenterAction: action.enablesDossierAddition,
      sourceLabel: 'Cernion read-only dashboard API',
    }));

    return [
      ...baseRows,
      {
        actionId: 'run_e2e_smoke',
        label: 'Run E2E Smoke',
        riskClass: 'non_consequential_sandbox_runbook',
        boundary: 'rundeck-runbook',
        executionMode: 'blocked_future_curated_runbook',
        enabled: false,
        enabledLabel: 'blocked',
        disabledReason:
          'E2E smoke execution stays behind a separately approved Cernion/Rundeck command gate.',
        lastResultStatus: 'not_called_by_budibase',
        lastResultAt: null,
        requiredEvidenceKey: 'curated_runbook_scope_and_operator_approval',
        requiredGate: 'future_runbook_execution_issue',
        nextPresenterAction:
          'explain that Budibase can show readiness now, while execution remains Cernion-controlled',
        sourceLabel: 'Cernion/Rundeck boundary',
      },
      {
        actionId: 'setup_reset_or_provision',
        label: 'Setup / Reset / Provision',
        riskClass: 'blocked_mutating_operation',
        boundary: 'cernion-api',
        executionMode: 'forbidden_in_demo_panel',
        enabled: false,
        enabledLabel: 'blocked',
        disabledReason:
          'Setup, reset, provisioning and imports are intentionally outside the Budibase demo panel.',
        lastResultStatus: 'not_called_by_budibase',
        lastResultAt: null,
        requiredEvidenceKey: 'out_of_scope',
        requiredGate: 'not_available_in_budibase',
        nextPresenterAction:
          'keep the process panel read-only and use repo/runbook documentation for operational setup',
        sourceLabel: 'Cernion command guard',
      },
    ];
  },

  buildStadtwerkMauerProcessLastResultRows({
    actions = [],
    caseDetailStatus = {},
    missingEvidence = [],
  } = {}) {
    const evidenceStatus =
      missingEvidence.length > 0 ? 'evidence_gaps_present' : 'evidence_complete';
    return actions.map((action) => ({
      actionId: action.actionId,
      label: action.label,
      boundary: action.actionId === 'verify_blueprint_seed' ? 'cernion-api' : 'budibase-ui-near',
      lastResultStatus:
        action.actionId === 'validate_evidence_completeness'
          ? evidenceStatus
          : action.evidenceStatus || caseDetailStatus?.status || 'not_run_in_panel',
      lastResultAt: null,
      resultSource:
        action.actionId === 'verify_blueprint_seed'
          ? 'operations-runbook.verifyVdmiBlueprintPackSeed'
          : 'dashboard-api.stadtwerkMauerCaseActionsStatus',
      presenterMeaning:
        action.actionId === 'validate_evidence_completeness'
          ? 'Shows whether the selected case still has evidence gaps before the next demo gate.'
          : action.enablesDossierAddition,
      mutationGuard: 'read_only_no_execution',
    }));
  },

  buildStadtwerkMauerProcessBoundaryRows() {
    return [
      {
        boundaryId: 'budibase_ui_near',
        label: 'Budibase UI Near',
        boundary: 'budibase-ui-near',
        allowedOperation: 'refresh curated Cernion read queries',
        blockedOperation: 'write Budibase tables as Cernion source of truth',
        owner: 'Cernion Dashboard API',
        presenterMessage: 'Presenter clicks may refresh display rows only.',
      },
      {
        boundaryId: 'cernion_api_verify',
        label: 'Cernion API Verify',
        boundary: 'cernion-api',
        allowedOperation: 'read-only Blueprint and evidence verification',
        blockedOperation: 'setup, reset, provisioning, import or delete',
        owner: 'Cernion command gate',
        presenterMessage: 'Verify actions can show proof without changing tenant state.',
      },
      {
        boundaryId: 'rundeck_runbook',
        label: 'Rundeck Runbook Boundary',
        boundary: 'rundeck-runbook',
        allowedOperation: 'future curated runbook wrapper after separate approval',
        blockedOperation: 'direct Budibase-triggered Rundeck job execution',
        owner: 'Operations runbook wrapper',
        presenterMessage:
          'Operational execution is visible as a boundary, not available as a free-form button.',
      },
    ];
  },

  buildStadtwerkMauerRequiredEvidenceRows(missingEvidence = []) {
    const rows = missingEvidence.map((item, index) => ({
      evidenceKey: item.missingDataPoint || `missing_evidence_${index + 1}`,
      label: this.humanizeWorkbenchLabel(item.missingDataPoint || `missing evidence ${index + 1}`),
      state: item.state || 'missing',
      requiredGate: item.requiredGate || 'selected_case_next_gate',
      enablesAction: 'validate_evidence_completeness',
      presenterMessage:
        item.enablesDossierAddition ||
        'Resolve this evidence gap before presenting the selected case as complete.',
    }));
    if (rows.length > 0) return rows;
    return [
      {
        evidenceKey: 'selected_case_evidence_complete',
        label: 'Selected Case Evidence Complete',
        state: 'complete',
        requiredGate: 'case_ready_for_next_gate_review',
        enablesAction: 'validate_evidence_completeness',
        presenterMessage: 'The current selected case has no open evidence gaps in the demo panel.',
      },
    ];
  },

  buildStadtwerkMauerAdministratorInventoryStatus({
    tenantId = 'stadtwerk-mauer',
    caseId = 'smm-budibase-workbench',
    includeRuntime = true,
    e2eStatus = null,
    mastrStatus = null,
    caseDetailStatus = null,
    hubStatus = null,
  } = {}) {
    const seed = stadtwerkMauerPvMissingNap;
    const sandboxBoundaryAllowed = tenantId === seed.demoTenant.tenantId;
    const runtimeEvidence = includeRuntime ? e2eStatus || {} : {};
    const missingEvidence = sandboxBoundaryAllowed
      ? [...(caseDetailStatus?.missingEvidence || []), ...(hubStatus?.missingEvidence || [])]
      : [
          {
            missingDataPoint: 'stadtwerk_mauer_tenant_scope',
            enablesDossierAddition:
              'select the synthetic tenant stadtwerk-mauer before rendering Administrator inventory',
            dataClass: 'syntheticTenantSeed',
            state: 'clarification',
          },
        ];
    const noCallGuards = Array.from(
      new Set([
        ...(seed.forbiddenActions || []),
        ...(e2eStatus?.sourceActions?.notCalled || []),
        ...(mastrStatus?.sourceActions?.notCalled || []),
        ...(caseDetailStatus?.sourceActions?.notCalled || []),
        'budibase.table.write',
        'budibase.api.call',
        'budibase.system_of_record',
        'tenant.provision',
        'tenant.seed.import',
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
    const categories = sandboxBoundaryAllowed
      ? this.buildStadtwerkMauerAdministratorInventoryCategories({
          seed,
          caseId,
          e2eStatus: runtimeEvidence,
          mastrStatus,
          caseDetailStatus,
          hubStatus,
        })
      : [];
    const inventoryRows = this.buildStadtwerkMauerAdministratorInventoryRows(categories);
    const status = sandboxBoundaryAllowed
      ? 'administrator_inventory_ready'
      : 'administrator_inventory_blocked_outside_sandbox_tenant';
    const categoryCounts = categories.reduce((acc, category) => {
      acc[category.categoryKey] = category.count;
      return acc;
    }, {});
    const positiveFollowUps = [
      ...missingEvidence.map((item) => ({
        ...item,
        category: 'stadtwerk_mauer_administrator_inventory',
      })),
      {
        missingDataPoint: 'selected_case_actions',
        enablesDossierAddition:
          'add curated selected-case action metadata once #305 is cut and implemented',
        category: 'stadtwerk_mauer_administrator_inventory',
        state: 'planned',
      },
      {
        missingDataPoint: 'role_workbench_catalog',
        enablesDossierAddition:
          'add stable role Workbench route metadata once #308 is cut and implemented',
        category: 'stadtwerk_mauer_administrator_inventory',
        state: 'planned',
      },
    ];
    const dossierFacts = [
      `Administrator Inventory Status: ${status}`,
      `Tenant: ${tenantId}`,
      `Categories: ${categories.length}`,
      `Inventory rows: ${inventoryRows.length}`,
      `Runtime included: ${includeRuntime === true}`,
    ];

    return {
      capabilityKey: 'stadtwerk_mauer_administrator_inventory',
      safety: 'read_only',
      found: sandboxBoundaryAllowed,
      status,
      tenantId,
      requiredTenantId: seed.demoTenant.tenantId,
      sandboxBoundaryAllowed,
      caseId,
      inventoryId: 'stadtwerk-mauer-administrator-inventory',
      title: 'Stadtwerk Mauer Administrator Workbench',
      summary: {
        categoryCount: categories.length,
        itemCount: inventoryRows.length,
        categoryCounts,
        publicContextReadOnly: true,
        syntheticDataClass: 'syntheticTenantSeed',
        runtimeIncluded: includeRuntime === true,
        hubStatus: hubStatus?.status || null,
        caseDetailStatus: caseDetailStatus?.status || null,
        e2eDemoStatus: e2eStatus?.status || null,
        mastrOverlayStatus: mastrStatus?.status || null,
        syntheticIdDisclaimer:
          'Stadtwerk Mauer app, case, MaLo, MeLo, meter, consent and device-control values are synthetic demo identifiers unless explicitly marked as public context.',
      },
      categories,
      inventoryRows,
      missingEvidence,
      positiveFollowUps,
      nextGates: [
        {
          id: 'selected_case_actions_cut_305',
          label: 'Cut selected-case action buttons as curated read/verify metadata (#305)',
          execution: 'planned_read_verify_model',
        },
        {
          id: 'role_catalog_cut_308',
          label: 'Cut role Workbench catalog and open-target contract (#308)',
          execution: 'planned_read_model',
        },
      ],
      capabilityBroker: {
        exposed: false,
        reason:
          'Administrator inventory is a Workbench/dashboard catalog, not a broad Personal-Agent capability route.',
      },
      hydrationRegistry: {
        exposed: false,
        reason:
          'No dossier hydration rule is added for this Workbench-only Administrator inventory slice.',
      },
      sourceActions: {
        inspected: ['dashboard-api.stadtwerkMauerAdministratorInventoryStatus'],
        referenced: [
          'dashboard-api.stadtwerkMauerWorkbenchHubStatus',
          'dashboard-api.stadtwerkMauerCaseDetailStatus',
          'stadtwerk-mauer-e2e-process-demo.getStatus',
          'stadtwerk-mauer-mastr-data-overlay.getStatus',
          'operations-runbook.verifyVdmiBlueprintPackSeed',
          'integrations/budibase/manifests/stadtwerk-mauer-workbench.json',
        ],
        notCalled: noCallGuards,
      },
      noCallGuards,
      dossierFacts,
      dossierEvidence: {
        status,
        tenantId,
        inventoryId: 'stadtwerk-mauer-administrator-inventory',
        categories: categories.map((category) => ({
          categoryKey: category.categoryKey,
          count: category.count,
          dataClass: category.dataClass,
          riskClass: category.riskClass,
        })),
        missingEvidence,
        positiveFollowUps,
        noCallGuards,
        dossierFacts,
      },
      meta: {
        inspected: [
          'dashboard-api.stadtwerkMauerAdministratorInventoryStatus',
          'dashboard-api.stadtwerkMauerWorkbenchHubStatus',
          'dashboard-api.stadtwerkMauerCaseDetailStatus',
          'budibase-stadtwerk-mauer-workbench-manifest',
        ],
      },
    };
  },

  buildStadtwerkMauerAdministratorInventoryCategories({
    seed,
    caseId,
    e2eStatus = {},
    mastrStatus = {},
    caseDetailStatus = {},
    hubStatus = {},
  }) {
    return [
      {
        categoryKey: 'public_context_layer',
        title: 'Public Context Layer',
        dataClass: 'publicContextLayer',
        riskClass: 'read_only_baseline',
        source: 'stadtwerk-mauer-mastr-data-overlay.getStatus',
        count: mastrStatus?.assetCount || 0,
        readiness: mastrStatus?.status || 'blended_overlay_status_unavailable',
        routeTarget: '/api/dashboard/stadtwerk-mauer-mastr-data-overlay?tenantId=stadtwerk-mauer',
        items: [
          {
            itemKey: 'mastr-osm-baseline',
            title: 'MaStR/OSM baseline',
            status: mastrStatus?.status || 'unavailable',
            provenance: 'public_context_read_only',
            detail: `${mastrStatus?.assetCount || 0} public-context asset rows, original MaStR facts preserved`,
          },
        ],
      },
      {
        categoryKey: 'synthetic_tenant_seed',
        title: 'Synthetic Tenant Seed',
        dataClass: 'syntheticTenantSeed',
        riskClass: 'demo_invented_identifiers',
        source: 'src/vdmi-blueprint-pack-seeds/stadtwerk-mauer-pv-missing-nap-v1.json',
        count: (seed.roles || []).length + (seed.evidenceRequirements || []).length + 1,
        readiness: 'seed_available',
        routeTarget: '/api/dashboard/stadtwerk-mauer-case-detail?tenantId=stadtwerk-mauer',
        items: [
          {
            itemKey: 'blueprint-seed',
            title: seed.id,
            status: seed.safetyClassification || 'read_only_blueprint_seed',
            provenance: 'synthetic_demo_tenant',
            detail: `${seed.roles?.length || 0} roles, ${seed.evidenceRequirements?.length || 0} evidence requirements`,
          },
          {
            itemKey: 'selected-case',
            title: caseId,
            status: caseDetailStatus?.status || 'case_detail_unknown',
            provenance: 'synthetic_demo_case',
            detail: caseDetailStatus?.caseSummary?.syntheticIdDisclaimer,
          },
        ],
      },
      {
        categoryKey: 'sandbox_runtime_artifact',
        title: 'Sandbox Runtime Artifact',
        dataClass: 'sandboxRuntimeArtifact',
        riskClass: 'resettable_demo_output',
        source: 'stadtwerk-mauer-e2e-process-demo.getStatus',
        count: (e2eStatus?.traceCount || 0) + (e2eStatus?.artifactCount || 0),
        readiness: e2eStatus?.status || 'e2e_demo_status_unknown',
        routeTarget: '/api/dashboard/stadtwerk-mauer-e2e-process-demo',
        items: [
          {
            itemKey: 'e2e-traces',
            title: 'E2E process traces',
            status: e2eStatus?.status || 'unavailable',
            provenance: 'resettable_sandbox_runtime',
            detail: `${e2eStatus?.traceCount || 0} traces, ${e2eStatus?.artifactCount || 0} artifacts`,
          },
        ],
      },
      {
        categoryKey: 'generated_workbench_item',
        title: 'Generated Workbench Item',
        dataClass: 'generatedWorkbenchItem',
        riskClass: 'render_shell_navigation',
        source: 'dashboard-api.stadtwerkMauerWorkbenchHubStatus',
        count: hubStatus?.targets?.length || 0,
        readiness: hubStatus?.status || 'workbench_hub_status_unknown',
        routeTarget: '/api/dashboard/stadtwerk-mauer-workbench-hub?tenantId=stadtwerk-mauer',
        items: (hubStatus?.targets || []).map((target) => ({
          itemKey: target.targetId,
          title: target.label,
          status: target.status,
          provenance: target.routeTarget?.type || 'workbench_target',
          detail: target.readinessSummary,
        })),
      },
      {
        categoryKey: 'read_verify_runbook_surface',
        title: 'Read/Verify Runbook Surface',
        dataClass: 'sandboxRuntimeArtifact',
        riskClass: 'curated_read_verify_only',
        source: 'operations-runbook.service',
        count: 2,
        readiness: 'read_verify_available',
        routeTarget: '/api/operations-runbook/vdmi-blueprint-packs/verify',
        items: [
          {
            itemKey: 'vdmi-blueprint-pack-verify',
            title: 'Blueprint Pack verify',
            status: 'available_read_only',
            provenance: 'operations_runbook_read',
            detail: 'GET verify surface; does not execute Rundeck or mutate tenant state',
          },
          {
            itemKey: 'stadtwerk-mauer-e2e-smoke',
            title: 'Stadtwerk Mauer E2E smoke',
            status: 'scope_protected_curated_command',
            provenance: 'operations_runbook_curated',
            detail: 'POST smoke remains Cernion-scoped and is not an arbitrary Budibase write',
          },
        ],
      },
    ];
  },

  buildStadtwerkMauerAdministratorInventoryRows(categories = []) {
    const rows = [];
    for (const category of categories) {
      for (const item of category.items || []) {
        rows.push({
          categoryKey: category.categoryKey,
          categoryLabel: category.title,
          itemKey: item.itemKey,
          label: item.title,
          status: item.status || category.readiness || 'unknown',
          dataClass: category.dataClass,
          riskClass: category.riskClass,
          source: category.source,
          provenance: item.provenance || category.source,
          routeTarget: category.routeTarget || null,
          detailLabel: item.detail || null,
        });
      }
    }
    return rows;
  },

  normalizeStadtwerkMauerDatabrowserCategory(value) {
    if (!value) return null;
    const key = String(value)
      .trim()
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, '_')
      .replace(/^_|_$/g, '');
    const aliases = {
      public_context: 'public_context_layer',
      public_context_layer: 'public_context_layer',
      synthetic_seed: 'synthetic_tenant_seed',
      tenant_seed: 'synthetic_tenant_seed',
      synthetic_tenant_seed: 'synthetic_tenant_seed',
      runtime_artifact: 'sandbox_runtime_artifact',
      sandbox_runtime_artifact: 'sandbox_runtime_artifact',
      workbench_item: 'generated_workbench_item',
      generated_workbench_item: 'generated_workbench_item',
      case_evidence: 'case_evidence',
      process_trace: 'process_trace',
      trace: 'process_trace',
      artifact: 'artifact',
      runbook_readiness: 'runbook_readiness',
      read_verify_runbook_surface: 'runbook_readiness',
    };
    return aliases[key] || key;
  },

  buildStadtwerkMauerTenantDatabrowserStatus({
    tenantId = 'stadtwerk-mauer',
    caseId = 'smm-budibase-workbench',
    categoryId = null,
    itemId = null,
    limit = 25,
    e2eStatus = null,
    mastrStatus = null,
    caseDetailStatus = null,
    hubStatus = null,
    administratorInventoryStatus = null,
  } = {}) {
    const seed = stadtwerkMauerPvMissingNap;
    const sandboxBoundaryAllowed = tenantId === seed.demoTenant.tenantId;
    const boundedLimit = Math.max(1, Math.min(Number(limit || 25), 50));
    const categories = sandboxBoundaryAllowed
      ? this.buildStadtwerkMauerTenantDatabrowserCategories({
          seed,
          caseId,
          e2eStatus,
          mastrStatus,
          caseDetailStatus,
          hubStatus,
          administratorInventoryStatus,
        })
      : [];
    const requestedCategoryId = categoryId || null;
    const normalizedCategoryId =
      this.normalizeStadtwerkMauerDatabrowserCategory(categoryId) ||
      categories[0]?.categoryId ||
      null;
    const selectedCategory =
      categories.find((category) => category.categoryId === normalizedCategoryId) || null;
    const categoryFound = !requestedCategoryId || Boolean(selectedCategory);
    const allItemRows = selectedCategory ? selectedCategory.items || [] : [];
    const itemRows = allItemRows.slice(0, boundedLimit);
    const selectedItem = itemId ? allItemRows.find((row) => row.itemId === itemId) || null : null;
    const traceRows =
      selectedCategory?.categoryId === 'process_trace' ||
      selectedCategory?.categoryId === 'sandbox_runtime_artifact'
        ? this.buildStadtwerkMauerTenantDatabrowserTraceRows(e2eStatus, boundedLimit)
        : [];
    const detailRows = this.buildStadtwerkMauerTenantDatabrowserDetailRows({
      selectedCategory,
      selectedItem,
      itemId,
      traceRows,
    });
    const missingEvidence = sandboxBoundaryAllowed
      ? [
          ...(!categoryFound
            ? [
                {
                  missingDataPoint: 'supported_databrowser_category',
                  enablesDossierAddition:
                    'select a supported Tenant Databrowser category before opening detail rows',
                  dataClass: 'generatedWorkbenchItem',
                  state: 'clarification',
                },
              ]
            : []),
          ...(itemId && !selectedItem
            ? [
                {
                  missingDataPoint: 'supported_databrowser_item',
                  enablesDossierAddition:
                    'select an item from the bounded Tenant Databrowser row set before opening item detail',
                  dataClass: selectedCategory?.dataClass || 'generatedWorkbenchItem',
                  state: 'clarification',
                },
              ]
            : []),
        ]
      : [
          {
            missingDataPoint: 'stadtwerk_mauer_tenant_scope',
            enablesDossierAddition:
              'select the synthetic tenant stadtwerk-mauer before rendering Tenant Databrowser rows',
            dataClass: 'syntheticTenantSeed',
            state: 'clarification',
          },
        ];
    const noCallGuards = Array.from(
      new Set([
        ...(seed.forbiddenActions || []),
        ...(administratorInventoryStatus?.sourceActions?.notCalled || []),
        ...(e2eStatus?.sourceActions?.notCalled || []),
        'budibase.table.write',
        'budibase.api.call',
        'budibase.system_of_record',
        'tenant.export.unbounded',
        'tenant.data.dump',
        'tenant.provision',
        'tenant.seed.import',
        'tenant.seed.delete',
        'trace.replay',
        'artifact.delete',
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
    const status = sandboxBoundaryAllowed
      ? categoryFound
        ? itemId && !selectedItem
          ? 'tenant_databrowser_item_not_found'
          : 'tenant_databrowser_ready'
        : 'tenant_databrowser_category_not_found'
      : 'tenant_databrowser_blocked_outside_sandbox_tenant';
    const positiveFollowUps = [
      ...missingEvidence.map((item) => ({
        ...item,
        category: 'stadtwerk_mauer_tenant_databrowser',
      })),
      {
        missingDataPoint: 'selected_znp_item_detail',
        enablesDossierAddition:
          'add selected grid-planning item detail and next-gate context from #323',
        category: 'stadtwerk_mauer_tenant_databrowser',
        state: 'planned',
      },
      {
        missingDataPoint: 'vertrieb_briefing_rows',
        enablesDossierAddition: 'add Vertrieb/Key-Account evidence-backed briefing rows from #321',
        category: 'stadtwerk_mauer_tenant_databrowser',
        state: 'planned',
      },
      {
        missingDataPoint: 'process_panel_last_result',
        enablesDossierAddition: 'add verify action last-result and runbook boundary rows from #322',
        category: 'stadtwerk_mauer_tenant_databrowser',
        state: 'planned',
      },
    ];
    const dossierFacts = [
      `Tenant Databrowser Status: ${status}`,
      `Tenant: ${tenantId}`,
      `Categories: ${categories.length}`,
      `Selected category: ${selectedCategory?.categoryId || normalizedCategoryId || 'none'}`,
      `Item rows: ${itemRows.length}`,
      `Trace rows: ${traceRows.length}`,
      `Limit: ${boundedLimit}`,
    ];

    return {
      capabilityKey: 'stadtwerk_mauer_tenant_databrowser',
      safety: 'read_only',
      found: sandboxBoundaryAllowed && categoryFound && !(itemId && !selectedItem),
      status,
      tenantId,
      requiredTenantId: seed.demoTenant.tenantId,
      sandboxBoundaryAllowed,
      caseId,
      databrowserId: 'stadtwerk-mauer-tenant-databrowser',
      requestedCategoryId,
      categoryId: selectedCategory?.categoryId || normalizedCategoryId,
      requestedItemId: itemId || null,
      selectedItemId: selectedItem?.itemId || null,
      title: 'Stadtwerk Mauer Tenant Databrowser',
      summary: {
        categoryCount: categories.length,
        totalBoundedItems: categories.reduce((sum, category) => sum + (category.itemCount || 0), 0),
        selectedCategoryLabel: selectedCategory?.label || null,
        selectedCategoryItemCount: selectedCategory?.itemCount || 0,
        returnedItemRows: itemRows.length,
        returnedTraceRows: traceRows.length,
        boundedLimit,
        paginationMode: 'bounded_first_page_only',
        budibaseBoundary:
          'Budibase renders bounded scalar inspection rows only; Cernion remains the system of record.',
        exportBoundary:
          'This is not an unrestricted tenant dump/export endpoint; deeper rows require future curated read models.',
      },
      categoryRows: categories.map(({ items, ...category }) => category), // eslint-disable-line no-unused-vars -- `items` intentionally destructured out so it's excluded from `category`
      itemRows,
      traceRows,
      detailRows,
      sourceRows: this.buildStadtwerkMauerTenantDatabrowserSourceRows({
        e2eStatus,
        mastrStatus,
        caseDetailStatus,
        hubStatus,
        administratorInventoryStatus,
      }),
      missingEvidence,
      positiveFollowUps,
      pagination: {
        limit: boundedLimit,
        returned: itemRows.length,
        totalAvailable: allItemRows.length,
        hasMore: allItemRows.length > itemRows.length,
        nextCursor: allItemRows.length > itemRows.length ? `offset:${itemRows.length}` : null,
      },
      capabilityBroker: {
        exposed: false,
        reason:
          'Tenant Databrowser is a Workbench/Admin inspection model, not a broad Personal-Agent capability route.',
      },
      hydrationRegistry: {
        exposed: false,
        reason: 'No dossier hydration rule is added for this UI-near bounded Databrowser slice.',
      },
      sourceActions: {
        inspected: ['dashboard-api.stadtwerkMauerTenantDatabrowserStatus'],
        referenced: [
          'dashboard-api.stadtwerkMauerAdministratorInventoryStatus',
          'dashboard-api.stadtwerkMauerWorkbenchHubStatus',
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
        databrowserId: 'stadtwerk-mauer-tenant-databrowser',
        categoryId: selectedCategory?.categoryId || normalizedCategoryId,
        itemRows: itemRows.map((row) => ({
          itemId: row.itemId,
          displayLabel: row.displayLabel,
          status: row.readinessStatus,
          evidenceHint: row.evidenceHint,
        })),
        traceRows: traceRows.map((row) => ({
          traceId: row.traceId,
          stepKey: row.stepKey,
          status: row.status,
        })),
        missingEvidence,
        positiveFollowUps,
        noCallGuards,
        dossierFacts,
      },
      meta: {
        inspected: [
          'dashboard-api.stadtwerkMauerTenantDatabrowserStatus',
          'dashboard-api.stadtwerkMauerAdministratorInventoryStatus',
          'budibase-stadtwerk-mauer-workbench-manifest',
        ],
      },
    };
  },
};
