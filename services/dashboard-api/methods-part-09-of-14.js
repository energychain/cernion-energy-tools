'use strict';

// dashboard-api methods chunk 9/14 — extracted verbatim from
// services/dashboard-api.service.js as part of the v0.99 file-size modularization.
// Contains: buildStadtwerkMauerTenantDatabrowserCategories, buildStadtwerkMauerTenantDatabrowserTraceRows, buildStadtwerkMauerTenantDatabrowserDetailRows, buildStadtwerkMauerTenantDatabrowserSourceRows, buildStadtwerkMauerRoleWorkbenchCatalogStatus, buildStadtwerkMauerRoleWorkbenchCatalogTargets, buildStadtwerkMauerRoleWorkbenchRows, buildStadtwerkMauerOpenTargetRows, buildStadtwerkMauerGridPlanningRoleQueueStatus, buildStadtwerkMauerGridPlanningQueueItems, buildStadtwerkMauerGridPlanningEvidenceHandover, buildStadtwerkMauerGridPlanningQueueRows, buildStadtwerkMauerGridPlanningEvidenceRows, buildStadtwerkMauerGridPlanningSelectedItemDetailStatus, buildStadtwerkMauerSalesWorkbenchBriefingStatus, normalizeStadtwerkMauerSalesAudience

const { stadtwerkMauerPvMissingNap } = require('./shared');

module.exports = {
  buildStadtwerkMauerTenantDatabrowserCategories({
    seed,
    caseId,
    e2eStatus = {},
    mastrStatus = {},
    caseDetailStatus = {},
    hubStatus = {},
    administratorInventoryStatus = {},
  }) {
    const _inventoryRows = administratorInventoryStatus?.inventoryRows || [];
    const evidenceRows = caseDetailStatus?.evidenceRows || [];
    const nextGateRows = caseDetailStatus?.nextGateRows || [];
    const annotationRows = caseDetailStatus?.annotationRows || [];
    const annotationAuditRows = caseDetailStatus?.annotationAuditRows || [];
    const traceRows = this.buildStadtwerkMauerTenantDatabrowserTraceRows(e2eStatus, 50);
    const roleTargets = hubStatus?.targetRows || [];
    const makeItem = ({
      categoryId,
      itemId,
      displayLabel,
      sourceType,
      readinessStatus,
      evidenceHint,
      traceCount = 0,
      artifactRef = null,
      timestamp = null,
      safeNextAction = 'Inspect read-only row',
      detailStatus = null,
    }) => ({
      categoryId,
      itemId,
      displayLabel,
      sourceType,
      readinessStatus,
      evidenceHint,
      traceCount,
      artifactRef,
      timestamp,
      safeNextAction,
      detailStatus: detailStatus || readinessStatus,
    });
    const categories = [
      {
        categoryId: 'public_context_layer',
        label: 'Public Context',
        sourceType: 'public_context_read_model',
        dataClass: 'publicContextLayer',
        readinessStatus: mastrStatus?.status || 'blended_overlay_status_unavailable',
        evidenceHint: `${mastrStatus?.assetCount || 0} public-context rows`,
        safeNextAction: 'Inspect MaStR/OSM baseline',
        items: [
          makeItem({
            categoryId: 'public_context_layer',
            itemId: 'mastr-osm-baseline',
            displayLabel: 'MaStR/OSM baseline',
            sourceType: 'stadtwerk-mauer-mastr-data-overlay.getStatus',
            readinessStatus: mastrStatus?.status || 'unavailable',
            evidenceHint: `${mastrStatus?.assetCount || 0} public-context asset rows`,
            safeNextAction: 'Open public context read model',
          }),
        ],
      },
      {
        categoryId: 'synthetic_tenant_seed',
        label: 'Synthetic Tenant Seed',
        sourceType: 'blueprint_seed_file',
        dataClass: 'syntheticTenantSeed',
        readinessStatus: 'seed_available',
        evidenceHint: `${seed.roles?.length || 0} roles, ${seed.evidenceRequirements?.length || 0} evidence requirements`,
        safeNextAction: 'Inspect generated seed facts',
        items: [
          makeItem({
            categoryId: 'synthetic_tenant_seed',
            itemId: 'blueprint-seed',
            displayLabel: seed.id,
            sourceType: 'src/vdmi-blueprint-pack-seeds/stadtwerk-mauer-pv-missing-nap-v1.json',
            readinessStatus: seed.safetyClassification || 'read_only_blueprint_seed',
            evidenceHint: `${seed.roles?.length || 0} roles / ${seed.evidenceRequirements?.length || 0} evidence requirements`,
            safeNextAction: 'Open selected case detail',
          }),
          makeItem({
            categoryId: 'synthetic_tenant_seed',
            itemId: caseId,
            displayLabel: caseId,
            sourceType: 'synthetic_demo_case',
            readinessStatus: caseDetailStatus?.status || 'case_detail_unknown',
            evidenceHint:
              caseDetailStatus?.caseSummary?.evidenceQuality || 'case evidence readiness',
            traceCount: e2eStatus?.traceCount || 0,
            safeNextAction: 'Inspect selected case evidence',
          }),
        ],
      },
      {
        categoryId: 'sandbox_runtime_artifact',
        label: 'Runtime Artifacts',
        sourceType: 'sandbox_runtime_read_model',
        dataClass: 'sandboxRuntimeArtifact',
        readinessStatus: e2eStatus?.status || 'e2e_demo_status_unknown',
        evidenceHint: `${e2eStatus?.traceCount || 0} traces, ${e2eStatus?.artifactCount || 0} artifacts`,
        safeNextAction: 'Inspect trace rows',
        items: [
          makeItem({
            categoryId: 'sandbox_runtime_artifact',
            itemId: 'e2e-traces',
            displayLabel: 'E2E process traces',
            sourceType: 'stadtwerk-mauer-e2e-process-demo.getStatus',
            readinessStatus: e2eStatus?.status || 'unavailable',
            evidenceHint: `${e2eStatus?.traceCount || 0} traces / ${e2eStatus?.artifactCount || 0} artifacts`,
            traceCount: e2eStatus?.traceCount || 0,
            artifactRef: e2eStatus?.artifactCount ? 'sandbox-runtime-artifacts' : null,
            safeNextAction: 'Inspect process trace category',
          }),
        ],
      },
      {
        categoryId: 'case_annotation',
        label: 'Case Annotations',
        sourceType: 'stadtwerk-mauer-sandbox-runtime.listCaseAnnotations',
        dataClass: 'sandboxRuntimeArtifact',
        readinessStatus:
          annotationRows.length > 0 ? 'case_annotations_ready' : 'case_annotations_empty',
        evidenceHint: `${annotationRows.length} annotation rows / ${annotationAuditRows.length} audit rows`,
        safeNextAction: 'Record or inspect bounded sandbox annotation',
        items: annotationRows.length
          ? annotationRows.map((row) =>
              makeItem({
                categoryId: 'case_annotation',
                itemId: row.annotationId,
                displayLabel: row.noteLabel || row.commandType || row.currentStatus,
                sourceType: 'stadtwerk-mauer-sandbox-runtime.listCaseAnnotations',
                readinessStatus: row.currentStatus,
                evidenceHint: row.reasonLabel || row.actorLabel,
                artifactRef: row.annotationId,
                timestamp: row.createdAt,
                safeNextAction: 'Refresh case detail annotation readback',
              })
            )
          : [
              makeItem({
                categoryId: 'case_annotation',
                itemId: 'case-annotation-empty',
                displayLabel: 'No sandbox annotation recorded yet',
                sourceType: 'stadtwerk-mauer-sandbox-runtime.listCaseAnnotations',
                readinessStatus: 'case_annotations_empty',
                evidenceHint: 'Use the curated sandbox annotation command',
                safeNextAction: 'Record bounded operator note',
              }),
            ],
      },
      {
        categoryId: 'generated_workbench_item',
        label: 'Generated Workbench Items',
        sourceType: 'workbench_navigation_read_model',
        dataClass: 'generatedWorkbenchItem',
        readinessStatus: hubStatus?.status || 'workbench_hub_status_unknown',
        evidenceHint: `${roleTargets.length} target rows`,
        safeNextAction: 'Open generated Workbench target',
        items: roleTargets.map((row) =>
          makeItem({
            categoryId: 'generated_workbench_item',
            itemId: row.routeKey || row.label,
            displayLabel: row.label,
            sourceType: 'dashboard-api.stadtwerkMauerWorkbenchHubStatus',
            readinessStatus: row.status,
            evidenceHint: row.nextGateLabel || row.readinessLabel,
            safeNextAction: row.readinessLabel || 'Open target section',
          })
        ),
      },
      {
        categoryId: 'case_evidence',
        label: 'Case Evidence',
        sourceType: 'case_detail_read_model',
        dataClass: 'sandboxRuntimeArtifact',
        readinessStatus: caseDetailStatus?.status || 'case_detail_unknown',
        evidenceHint: `${evidenceRows.length} evidence rows`,
        safeNextAction: 'Inspect evidence rows',
        items: evidenceRows.map((row) =>
          makeItem({
            categoryId: 'case_evidence',
            itemId: row.evidenceId,
            displayLabel: row.label,
            sourceType: row.sourceClass || 'case_evidence',
            readinessStatus: row.state,
            evidenceHint: row.nextGateLabel,
            safeNextAction: row.present ? 'Use as available evidence' : 'Collect missing evidence',
          })
        ),
      },
      {
        categoryId: 'process_trace',
        label: 'Process Trace',
        sourceType: 'trace_read_model',
        dataClass: 'sandboxRuntimeArtifact',
        readinessStatus: e2eStatus?.status || 'trace_status_unknown',
        evidenceHint: `${traceRows.length} bounded trace rows`,
        safeNextAction: 'Inspect trace detail rows',
        items: traceRows.map((row) =>
          makeItem({
            categoryId: 'process_trace',
            itemId: row.traceId,
            displayLabel: row.stepLabel,
            sourceType: row.source,
            readinessStatus: row.status,
            evidenceHint: row.evidenceRef,
            traceCount: 1,
            artifactRef: row.artifactRef,
            timestamp: row.timestamp,
            safeNextAction: row.nextGateLabel,
          })
        ),
      },
      {
        categoryId: 'artifact',
        label: 'Artifacts',
        sourceType: 'artifact_read_model',
        dataClass: 'sandboxRuntimeArtifact',
        readinessStatus:
          e2eStatus?.artifactCount > 0 ? 'artifacts_available' : 'artifacts_not_found',
        evidenceHint: `${e2eStatus?.artifactCount || 0} sandbox artifact refs`,
        safeNextAction: 'Inspect artifact references',
        items: [
          makeItem({
            categoryId: 'artifact',
            itemId: 'sandbox-artifact-summary',
            displayLabel: 'Sandbox artifact summary',
            sourceType: 'stadtwerk-mauer-e2e-process-demo.getStatus',
            readinessStatus: e2eStatus?.artifactCount > 0 ? 'available' : 'not_found',
            evidenceHint: `${e2eStatus?.artifactCount || 0} artifact refs, no export body`,
            artifactRef: e2eStatus?.artifactCount ? 'sandbox-runtime-artifacts' : null,
            safeNextAction: 'Use curated Cernion artifact surface when available',
          }),
        ],
      },
      {
        categoryId: 'runbook_readiness',
        label: 'Runbook Readiness',
        sourceType: 'curated_read_verify_surface',
        dataClass: 'sandboxRuntimeArtifact',
        readinessStatus: 'read_verify_available',
        evidenceHint: `${nextGateRows.length} next-gate rows`,
        safeNextAction: 'Inspect read/verify boundary',
        items: [
          ...nextGateRows.map((row) =>
            makeItem({
              categoryId: 'runbook_readiness',
              itemId: row.gateId,
              displayLabel: row.label,
              sourceType: 'dashboard-api.stadtwerkMauerCaseDetailStatus',
              readinessStatus: row.status,
              evidenceHint: row.allowedAction,
              safeNextAction: row.safetyLabel,
            })
          ),
          makeItem({
            categoryId: 'runbook_readiness',
            itemId: 'vdmi-blueprint-pack-verify',
            displayLabel: 'Blueprint Pack verify',
            sourceType: 'operations-runbook.verifyVdmiBlueprintPackSeed',
            readinessStatus: 'available_read_only',
            evidenceHint: 'GET verify surface only; no Rundeck execution',
            safeNextAction: 'Run Cernion-scoped verify/read-only check',
          }),
        ],
      },
    ];
    return categories.map((category) => ({
      ...category,
      itemCount: category.items.length,
      bounded: true,
    }));
  },

  buildStadtwerkMauerTenantDatabrowserTraceRows(e2eStatus = {}, limit = 25) {
    const traces = Array.isArray(e2eStatus?.recentTraces) ? e2eStatus.recentTraces : [];
    const fallback =
      traces.length > 0
        ? traces
        : e2eStatus?.traceCount
          ? [{ traceId: 'smm-e2e-trace:latest', status: e2eStatus.status }]
          : [];
    return fallback.slice(0, limit).map((trace, index) => ({
      traceId: trace.traceId || trace.id || `smm-e2e-trace:${index + 1}`,
      stepKey: trace.stepKey || `trace-step-${index + 1}`,
      stepLabel:
        trace.stepLabel ||
        this.humanizeWorkbenchLabel(trace.stepKey || trace.status || 'Demo trace'),
      source: trace.source || 'stadtwerk-mauer-e2e-process-demo.getStatus',
      status: trace.status || e2eStatus?.status || 'trace_status_unknown',
      evidenceRef: trace.evidenceRef || trace.evidenceId || 'stadtwerk_mauer_demo_trace',
      artifactRef:
        trace.artifactRef || (e2eStatus?.artifactCount ? 'sandbox-runtime-artifacts' : null),
      order: Number.isFinite(trace.order) ? trace.order : index + 1,
      timestamp: trace.timestamp || e2eStatus?.timestamp || null,
      nextGateLabel: trace.nextGateLabel || 'Review trace evidence in Cernion read model',
    }));
  },

  buildStadtwerkMauerTenantDatabrowserDetailRows({
    selectedCategory = null,
    selectedItem = null,
    itemId = null,
    traceRows = [],
  } = {}) {
    if (!selectedCategory) {
      return [];
    }
    if (itemId && !selectedItem) {
      return [
        {
          detailId: 'item_not_found',
          itemId,
          label: 'Selected item not found',
          valueLabel: 'Choose one of the bounded Databrowser item rows',
          status: 'not_found',
          sourceType: selectedCategory.sourceType,
          safeNextAction: 'Select supported item',
        },
      ];
    }
    const item = selectedItem || selectedCategory.items?.[0] || null;
    const rows = [
      {
        detailId: 'category',
        itemId: item?.itemId || selectedCategory.categoryId,
        label: 'Category',
        valueLabel: selectedCategory.label,
        status: selectedCategory.readinessStatus,
        sourceType: selectedCategory.sourceType,
        safeNextAction: selectedCategory.safeNextAction,
      },
    ];
    if (item) {
      rows.push(
        {
          detailId: 'item',
          itemId: item.itemId,
          label: 'Selected item',
          valueLabel: item.displayLabel,
          status: item.readinessStatus,
          sourceType: item.sourceType,
          safeNextAction: item.safeNextAction,
        },
        {
          detailId: 'evidence',
          itemId: item.itemId,
          label: 'Evidence hint',
          valueLabel: item.evidenceHint || 'No additional evidence hint',
          status: item.detailStatus || item.readinessStatus,
          sourceType: item.sourceType,
          safeNextAction: item.artifactRef || traceRows[0]?.traceId || 'Inspect bounded rows',
        }
      );
    }
    return rows;
  },

  buildStadtwerkMauerTenantDatabrowserSourceRows({
    e2eStatus = {},
    mastrStatus = {},
    caseDetailStatus = {},
    hubStatus = {},
    administratorInventoryStatus = {},
  } = {}) {
    return [
      [
        'administrator_inventory',
        'dashboard-api.stadtwerkMauerAdministratorInventoryStatus',
        administratorInventoryStatus?.status,
      ],
      ['case_detail', 'dashboard-api.stadtwerkMauerCaseDetailStatus', caseDetailStatus?.status],
      [
        'case_annotations',
        'stadtwerk-mauer-sandbox-runtime.listCaseAnnotations',
        caseDetailStatus?.annotationRows?.length
          ? 'case_annotations_ready'
          : 'case_annotations_empty',
      ],
      ['workbench_hub', 'dashboard-api.stadtwerkMauerWorkbenchHubStatus', hubStatus?.status],
      ['e2e_trace', 'stadtwerk-mauer-e2e-process-demo.getStatus', e2eStatus?.status],
      ['mastr_overlay', 'stadtwerk-mauer-mastr-data-overlay.getStatus', mastrStatus?.status],
    ].map(([sourceId, sourceAction, status]) => ({
      sourceId,
      sourceAction,
      status: status || 'not_available',
      readOnly: true,
      mutationBoundary: 'not_called',
    }));
  },

  buildStadtwerkMauerRoleWorkbenchCatalogStatus({
    tenantId = 'stadtwerk-mauer',
    caseId = 'smm-budibase-workbench',
    hubStatus = null,
    administratorInventoryStatus = null,
    caseActionsStatus = null,
  } = {}) {
    const seed = stadtwerkMauerPvMissingNap;
    const sandboxBoundaryAllowed = tenantId === seed.demoTenant.tenantId;
    const missingEvidence = sandboxBoundaryAllowed
      ? []
      : [
          {
            missingDataPoint: 'stadtwerk_mauer_tenant_scope',
            enablesDossierAddition:
              'select the synthetic tenant stadtwerk-mauer before rendering role Workbench targets',
            dataClass: 'syntheticTenantSeed',
            state: 'clarification',
          },
        ];
    const noCallGuards = Array.from(
      new Set([
        ...(seed.forbiddenActions || []),
        ...(hubStatus?.sourceActions?.notCalled || []),
        ...(administratorInventoryStatus?.sourceActions?.notCalled || []),
        ...(caseActionsStatus?.sourceActions?.notCalled || []),
        'budibase.table.write',
        'budibase.api.call',
        'budibase.system_of_record',
        'budibase.automation.arbitrary_write',
        'role.assignment.write',
        'auth.policy.mutate',
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
    const targets = sandboxBoundaryAllowed
      ? this.buildStadtwerkMauerRoleWorkbenchCatalogTargets({
          caseId,
          hubStatus,
          administratorInventoryStatus,
          caseActionsStatus,
        })
      : [];
    const roleRows = this.buildStadtwerkMauerRoleWorkbenchRows(targets);
    const openTargetRows = this.buildStadtwerkMauerOpenTargetRows(targets);
    const statusCounts = targets.reduce(
      (acc, target) => {
        acc[target.status] = (acc[target.status] || 0) + 1;
        return acc;
      },
      { available: 0, planned: 0, blocked: 0 }
    );
    const status = sandboxBoundaryAllowed
      ? 'role_workbench_catalog_ready'
      : 'role_workbench_catalog_blocked_outside_sandbox_tenant';
    const plannedOrBlocked = targets.filter((target) => target.status !== 'available');
    const positiveFollowUps = [
      ...missingEvidence.map((item) => ({
        ...item,
        category: 'stadtwerk_mauer_role_workbench_catalog',
      })),
      ...plannedOrBlocked.map((target) => ({
        missingDataPoint: target.roleKey,
        enablesDossierAddition: target.enablesDossierAddition,
        category: 'stadtwerk_mauer_role_workbench_catalog',
        state: target.status,
      })),
    ];
    const dossierFacts = [
      `Role Workbench Catalog Status: ${status}`,
      `Tenant: ${tenantId}`,
      `Role targets: ${targets.length}`,
      `Available role targets: ${statusCounts.available || 0}`,
      `Planned role targets: ${statusCounts.planned || 0}`,
      `Open-target rows: ${openTargetRows.length}`,
    ];

    return {
      capabilityKey: 'stadtwerk_mauer_role_workbench_catalog',
      safety: 'read_only',
      found: sandboxBoundaryAllowed,
      status,
      tenantId,
      requiredTenantId: seed.demoTenant.tenantId,
      sandboxBoundaryAllowed,
      caseId,
      catalogId: 'stadtwerk-mauer-role-workbench-catalog',
      title: 'Stadtwerk Mauer Role Workbench Catalog',
      roleVocabulary: ['admin', 'grid-planning', 'sales', 'key-account', 'vdmi-governance'],
      summary: {
        targetCount: targets.length,
        statusCounts,
        hubStatus: hubStatus?.status || null,
        administratorInventoryStatus: administratorInventoryStatus?.status || null,
        caseActionsStatus: caseActionsStatus?.status || null,
        budibaseBoundary:
          'Budibase renders role/open-target rows only; Cernion remains the system of record and command gate.',
        syntheticIdDisclaimer:
          'Stadtwerk Mauer app, role targets and case values are synthetic demo identifiers unless explicitly marked as public context.',
      },
      targets,
      roleRows,
      openTargetRows,
      missingEvidence,
      positiveFollowUps,
      nextGate: plannedOrBlocked[0]?.nextGate || {
        id: 'grid_planning_role_queue_cut_317',
        label: 'Cut a ZNP/grid-planning role queue projection (#317)',
      },
      capabilityBroker: {
        exposed: false,
        reason:
          'Role Workbench catalog is Hub navigation/readiness metadata; no broad Personal-Agent capability route is added.',
      },
      hydrationRegistry: {
        exposed: false,
        reason: 'No dossier hydration rule is added for this Workbench-only role catalog slice.',
      },
      sourceActions: {
        inspected: ['dashboard-api.stadtwerkMauerRoleWorkbenchCatalogStatus'],
        referenced: [
          'dashboard-api.stadtwerkMauerWorkbenchHubStatus',
          'dashboard-api.stadtwerkMauerAdministratorInventoryStatus',
          'dashboard-api.stadtwerkMauerCaseActionsStatus',
          'src/role-workbench-projector.js',
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
        catalogId: 'stadtwerk-mauer-role-workbench-catalog',
        roleTargets: roleRows,
        missingEvidence,
        positiveFollowUps,
        noCallGuards,
        dossierFacts,
      },
      meta: {
        inspected: [
          'dashboard-api.stadtwerkMauerRoleWorkbenchCatalogStatus',
          'dashboard-api.stadtwerkMauerWorkbenchHubStatus',
          'dashboard-api.stadtwerkMauerAdministratorInventoryStatus',
          'dashboard-api.stadtwerkMauerCaseActionsStatus',
          'budibase-stadtwerk-mauer-workbench-manifest',
        ],
      },
    };
  },

  buildStadtwerkMauerRoleWorkbenchCatalogTargets({
    caseId = 'smm-budibase-workbench',
    hubStatus = {},
    administratorInventoryStatus = {},
    caseActionsStatus = {},
  } = {}) {
    const adminAvailable = administratorInventoryStatus?.found === true;
    const actionsAvailable = caseActionsStatus?.found === true;
    const hubReady = hubStatus?.found === true;
    return [
      {
        targetId: 'administrator-workbench',
        roleKey: 'admin',
        roleCode: 'ROLE_ADMINISTRATOR',
        displayName: 'Administrator Workbench',
        status: adminAvailable ? 'available' : 'blocked',
        routeKey: 'admin',
        routeTarget: '/stadtwerk-mauer/admin',
        openTarget: 'administrator_inventory',
        requiredEvidenceDomains: ['tenant_inventory', 'data_catalog', 'source_boundaries'],
        allowedActionClasses: ['read_model_navigation', 'verify_readiness'],
        nextGate: adminAvailable
          ? {
              id: 'inspect_administrator_inventory',
              label: 'Render Administrator inventory rows',
            }
          : {
              id: 'restore_administrator_inventory',
              label: 'Restore Administrator inventory read model',
            },
        safetyNotes:
          'Read-only inventory; no tenant provisioning, reset, delete or Budibase table writes.',
        dataClassNotes: 'public context, synthetic tenant seed and sandbox runtime are separated.',
        readinessSummary:
          administratorInventoryStatus?.status || 'administrator_inventory_status_unknown',
        enablesDossierAddition:
          'add Administrator inventory categories, generated workbench items and read/verify runbook references',
      },
      {
        targetId: 'zielnetzplanung-workbench',
        roleKey: 'grid-planning',
        roleCode: 'ROLE_NETZPLANUNG',
        displayName: 'Zielnetzplanung',
        status: 'available',
        routeKey: 'grid-planning',
        routeTarget: '/stadtwerk-mauer/grid-planning',
        openTarget: 'grid_planning_role_queue',
        requiredEvidenceDomains: [
          'nap_reference',
          'grid_capacity_context',
          'malo_melo_meter_context',
        ],
        allowedActionClasses: ['read_model_navigation', 'verify_evidence_completeness'],
        nextGate: {
          id: 'render_grid_planning_role_queue',
          label: 'Render ZNP/grid-planning role queue rows from #317',
        },
        safetyNotes:
          'Read-only role queue target; no grid-capacity calculation or device-control action.',
        dataClassNotes:
          'public context, generated VDMI projection and synthetic tenant seed stay explicit.',
        readinessSummary: hubReady
          ? `Grid-planning role queue rows are available for case ${caseId}.`
          : 'Hub target is not available for this tenant/case.',
        enablesDossierAddition:
          'add ZNP role queue rows and evidence handover for the selected synthetic case',
      },
      {
        targetId: 'sales-workbench',
        roleKey: 'sales',
        roleCode: 'ROLE_VERTRIEB',
        displayName: 'Vertrieb',
        status: 'available',
        routeKey: 'sales',
        routeTarget: '/stadtwerk-mauer/sales',
        openTarget: 'sales_briefing',
        requiredEvidenceDomains: ['customer_advisory_context', 'commercial_boundary'],
        allowedActionClasses: ['read_model_navigation'],
        nextGate: {
          id: 'render_sales_briefing',
          label: 'Render Vertrieb evidence-backed briefing rows from #321',
        },
        safetyNotes: 'No offer, tariff, billing or settlement release is implemented.',
        dataClassNotes:
          'synthetic tenant seed and generated evidence rows only; no real customer data.',
        readinessSummary: actionsAvailable
          ? 'Evidence-backed Vertrieb briefing rows are available for the synthetic demo case.'
          : 'Selected-case actions are unavailable for this tenant/case.',
        enablesDossierAddition:
          'add evidence-backed safe claims and open gaps for Vertrieb and Key Account briefing',
      },
      {
        targetId: 'key-account-workbench',
        roleKey: 'key-account',
        roleCode: 'ROLE_KEY_ACCOUNT',
        displayName: 'Key Account / Project Advisory',
        status: 'available',
        routeKey: 'key-account',
        routeTarget: '/stadtwerk-mauer/key-account',
        openTarget: 'sales_briefing',
        requiredEvidenceDomains: ['project_customer_context', 'advisory_boundary'],
        allowedActionClasses: ['read_model_navigation'],
        nextGate: {
          id: 'render_sales_briefing_key_account',
          label: 'Render Key Account evidence-backed briefing rows from #321',
        },
        safetyNotes:
          'No customer communication, offer creation, billing or contract mutation is implemented.',
        dataClassNotes: 'synthetic tenant, case and evidence-backed advisory rows only.',
        readinessSummary: 'Key Account briefing uses the same evidence-backed sales projection.',
        enablesDossierAddition:
          'add project-customer advisory context separated into safe claims and open evidence gaps',
      },
      {
        targetId: 'vdmi-governance-reviewer',
        roleKey: 'vdmi-governance',
        roleCode: 'ROLE_VDMI_GOVERNANCE_REVIEWER',
        displayName: 'VDMI Governance / Reviewer',
        status: 'planned',
        routeKey: 'vdmi-governance',
        routeTarget: '/stadtwerk-mauer/vdmi-governance',
        openTarget: 'vdmi_governance_reviewer',
        requiredEvidenceDomains: [
          'vdmi_blueprint_seed',
          'decision_policy',
          'evidence_requirements',
        ],
        allowedActionClasses: ['read_model_navigation', 'verify_blueprint_seed'],
        nextGate: {
          id: 'vdmi_governance_reviewer_cut',
          label: 'Cut a VDMI governance/reviewer projection',
        },
        safetyNotes: 'Reviewer target is metadata-only; no policy mutation or HITL case creation.',
        dataClassNotes: 'generated VDMI seed facts and sandbox runtime evidence only.',
        readinessSummary: 'Blueprint verify exists; reviewer workbench projection is not cut yet.',
        enablesDossierAddition:
          'add VDMI reviewer evidence and policy-boundary rows once a governance slice is cut',
      },
    ];
  },

  buildStadtwerkMauerRoleWorkbenchRows(targets = []) {
    return targets.map((target) => ({
      roleKey: target.roleKey,
      roleCode: target.roleCode,
      label: target.displayName,
      status: target.status,
      statusLabel: this.humanizeWorkbenchLabel(target.status),
      routeKey: target.routeKey,
      routeTarget: target.routeTarget,
      openTarget: target.openTarget,
      nextGateLabel: target.nextGate?.label || this.humanizeWorkbenchLabel(target.nextGate?.id),
      evidenceDomainsLabel: (target.requiredEvidenceDomains || []).join(', '),
      allowedActionClassesLabel: (target.allowedActionClasses || []).join(', '),
      safetyLabel: target.safetyNotes,
      dataClassLabel: target.dataClassNotes,
      readinessLabel: target.readinessSummary,
    }));
  },

  buildStadtwerkMauerOpenTargetRows(targets = []) {
    return targets.map((target) => ({
      openTarget: target.openTarget,
      routeKey: target.routeKey,
      label: target.displayName,
      status: target.status,
      targetPath: target.routeTarget,
      allowedActionClassesLabel: (target.allowedActionClasses || []).join(', '),
      nextGateLabel: target.nextGate?.label || this.humanizeWorkbenchLabel(target.nextGate?.id),
    }));
  },

  buildStadtwerkMauerGridPlanningRoleQueueStatus({
    tenantId = 'stadtwerk-mauer',
    caseId = 'smm-budibase-workbench',
    caseDetailStatus = null,
    roleCatalogStatus = null,
  } = {}) {
    const seed = stadtwerkMauerPvMissingNap;
    const sandboxBoundaryAllowed = tenantId === seed.demoTenant.tenantId;
    const selectedCaseAllowed = caseId === 'smm-budibase-workbench';
    const found =
      sandboxBoundaryAllowed && selectedCaseAllowed && caseDetailStatus?.found !== false;
    const gridRole = (seed.roles || []).find((role) => role.roleId === 'ROLE_NETZPLANUNG') || {};
    const missingEvidence = found
      ? caseDetailStatus?.missingEvidence || []
      : sandboxBoundaryAllowed
        ? [
            {
              missingDataPoint: 'stadtwerk_mauer_case_scope',
              enablesDossierAddition:
                'select the synthetic case smm-budibase-workbench before rendering the grid-planning role queue',
              dataClass: 'syntheticTenantSeed',
              state: 'clarification',
            },
          ]
        : [
            {
              missingDataPoint: 'stadtwerk_mauer_tenant_scope',
              enablesDossierAddition:
                'select the synthetic tenant stadtwerk-mauer before rendering the grid-planning role queue',
              dataClass: 'syntheticTenantSeed',
              state: 'clarification',
            },
          ];
    const noCallGuards = Array.from(
      new Set([
        ...(seed.forbiddenActions || []),
        ...(caseDetailStatus?.sourceActions?.notCalled || []),
        ...(roleCatalogStatus?.sourceActions?.notCalled || []),
        'budibase.table.write',
        'budibase.api.call',
        'budibase.system_of_record',
        'budibase.automation.arbitrary_write',
        'role.assignment.write',
        'case.edit',
        'grid-capacity.calculate',
        'grid-planning.cockpit.create',
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
    const queueItems = found
      ? this.buildStadtwerkMauerGridPlanningQueueItems({
          seed,
          caseId,
          caseDetailStatus,
          gridRole,
        })
      : [];
    const evidenceHandover = found
      ? this.buildStadtwerkMauerGridPlanningEvidenceHandover({ seed, caseDetailStatus })
      : [];
    const queueRows = this.buildStadtwerkMauerGridPlanningQueueRows(queueItems);
    const evidenceHandoverRows = this.buildStadtwerkMauerGridPlanningEvidenceRows(evidenceHandover);
    const status = !sandboxBoundaryAllowed
      ? 'grid_planning_role_queue_blocked_outside_sandbox_tenant'
      : !selectedCaseAllowed || caseDetailStatus?.found === false
        ? 'grid_planning_role_queue_not_found'
        : evidenceHandover.some((item) => item.present !== true)
          ? 'grid_planning_role_queue_needs_nap_clarification'
          : 'grid_planning_role_queue_ready';
    const positiveFollowUps = missingEvidence.map((item) => ({
      ...item,
      category: 'stadtwerk_mauer_grid_planning_role_queue',
    }));
    const dossierFacts = [
      `Grid Planning Role Queue Status: ${status}`,
      `Tenant: ${tenantId}`,
      `Case: ${caseId}`,
      `Queue rows: ${queueRows.length}`,
      `Evidence handover rows: ${evidenceHandoverRows.length}`,
    ];

    return {
      capabilityKey: 'stadtwerk_mauer_grid_planning_role_queue',
      safety: 'read_only',
      found,
      status,
      tenantId,
      requiredTenantId: seed.demoTenant.tenantId,
      sandboxBoundaryAllowed,
      caseId,
      requiredCaseId: 'smm-budibase-workbench',
      roleKey: 'grid-planning',
      blueprintRoleKey: 'ROLE_NETZPLANUNG',
      roleRelation: gridRole.relation || 'verantwortlich',
      roleRelationLabel: this.humanizeWorkbenchLabel(gridRole.relation || 'verantwortlich'),
      controlCase: seed.controlCase,
      processFamily: seed.processFamily,
      queueId: 'stadtwerk-mauer-grid-planning-role-queue',
      title: 'Stadtwerk Mauer Zielnetzplanung Role Queue',
      summary: {
        queueItemCount: queueItems.length,
        evidenceHandoverCount: evidenceHandover.length,
        roleCatalogStatus: roleCatalogStatus?.status || null,
        caseDetailStatus: caseDetailStatus?.status || null,
        allowedActionClass: 'read_verify_status_only',
        budibaseBoundary:
          'Budibase renders scalar queue/evidence rows only; Cernion remains the system of record and command gate.',
        syntheticIdDisclaimer:
          'Stadtwerk Mauer app, case, role queue and evidence values are synthetic demo identifiers unless explicitly marked as public context.',
      },
      dataClasses: {
        publicContextLayer: seed.dataClasses?.publicContextLayer?.description || null,
        syntheticTenantSeed: seed.dataClasses?.syntheticTenantSeed?.description || null,
        generatedVdmiProjection:
          'Generated role queue and handover rows derived from the Cernion VDMI Blueprint seed.',
        sandboxRuntimeArtifact: seed.dataClasses?.sandboxRuntimeArtifact?.description || null,
      },
      queueItems,
      evidenceHandover,
      queueRows,
      evidenceHandoverRows,
      missingEvidence,
      positiveFollowUps,
      relatedTargets: [
        {
          targetId: 'selected-case-detail',
          label: 'Selected Case Detail',
          path: `/api/dashboard/stadtwerk-mauer-case-detail?tenantId=stadtwerk-mauer&caseId=${encodeURIComponent(
            caseId
          )}`,
        },
        {
          targetId: 'selected-case-actions',
          label: 'Selected Case Actions',
          path: `/api/dashboard/stadtwerk-mauer-case-actions?tenantId=stadtwerk-mauer&caseId=${encodeURIComponent(
            caseId
          )}`,
        },
        {
          targetId: 'role-workbench-catalog',
          label: 'Role Workbench Catalog',
          path: '/api/dashboard/stadtwerk-mauer-role-workbench-catalog',
        },
        {
          targetId: 'blueprint-verify-runbook',
          label: 'Blueprint Verify Runbook',
          path: '/api/operations-runbook/vdmi-blueprint-packs/verify?seedId=stadtwerk-mauer-pv-missing-nap-v1',
        },
      ],
      nextGate: found
        ? {
            id: 'resolve_missing_nap_reference',
            label: 'Clarify missing NAP and related evidence before ZNP review',
          }
        : {
            id: sandboxBoundaryAllowed ? 'select_sandbox_case' : 'select_sandbox_tenant',
            label: sandboxBoundaryAllowed
              ? 'Select the synthetic Stadtwerk-Mauer case'
              : 'Select the synthetic tenant stadtwerk-mauer',
          },
      capabilityBroker: {
        exposed: false,
        reason:
          'Grid-planning role queue is a Workbench-first projection; no broad Personal-Agent capability route is added.',
      },
      hydrationRegistry: {
        exposed: false,
        reason: 'No dossier hydration rule is added for this Workbench-only role queue slice.',
      },
      sourceActions: {
        inspected: ['dashboard-api.stadtwerkMauerGridPlanningRoleQueueStatus'],
        referenced: [
          'dashboard-api.stadtwerkMauerCaseDetailStatus',
          'dashboard-api.stadtwerkMauerCaseActionsStatus',
          'dashboard-api.stadtwerkMauerRoleWorkbenchCatalogStatus',
          'src/vdmi-blueprint-pack-seeds/stadtwerk-mauer-pv-missing-nap-v1.json',
          'src/role-workbench-projector.js',
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
        caseId,
        roleKey: 'grid-planning',
        blueprintRoleKey: 'ROLE_NETZPLANUNG',
        queueRows,
        evidenceHandoverRows,
        missingEvidence,
        positiveFollowUps,
        noCallGuards,
        dossierFacts,
      },
      meta: {
        inspected: [
          'dashboard-api.stadtwerkMauerGridPlanningRoleQueueStatus',
          'dashboard-api.stadtwerkMauerCaseDetailStatus',
          'dashboard-api.stadtwerkMauerRoleWorkbenchCatalogStatus',
          'budibase-stadtwerk-mauer-workbench-manifest',
        ],
      },
    };
  },

  buildStadtwerkMauerGridPlanningQueueItems({ seed, caseId, caseDetailStatus, gridRole }) {
    const evidenceGaps = caseDetailStatus?.missingEvidence || [];
    return [
      {
        queueItemId: 'grid-planning:missing-nap-clarification',
        roleKey: 'grid-planning',
        blueprintRoleKey: 'ROLE_NETZPLANUNG',
        roleRelation: gridRole.relation || 'verantwortlich',
        roleRelationLabel: this.humanizeWorkbenchLabel(gridRole.relation || 'verantwortlich'),
        caseId,
        controlCase: seed.controlCase,
        processFamily: seed.processFamily,
        status: evidenceGaps.some((gap) => gap.missingDataPoint === 'napReference')
          ? 'needs_nap_clarification'
          : evidenceGaps.length > 0
            ? 'evidence_gap'
            : 'ready_for_grid_planning_review',
        nextGate: 'resolve_missing_nap_reference',
        allowedActionClass: 'read_verify_status_only',
        dataClass: 'generatedVdmiProjection',
        sourceClass: 'syntheticTenantSeed',
        sourceReference: seed.id,
        label: 'Missing NAP clarification',
        detail:
          gridRole.responsibility ||
          'Clarifies Netzanschlusspunkt and grid-capacity evidence for the PV registration case.',
      },
    ];
  },

  buildStadtwerkMauerGridPlanningEvidenceHandover({ seed, caseDetailStatus }) {
    const evidence = caseDetailStatus?.evidence || this.buildStadtwerkMauerCaseEvidence(seed, {});
    return evidence.map((item) => ({
      handoverId: `grid-planning:evidence:${item.id}`,
      evidenceId: item.id,
      label: this.humanizeWorkbenchLabel(item.id),
      status: item.present ? 'present' : item.state || 'evidence_gap',
      present: item.present === true,
      required: item.required === true,
      roleKey: 'grid-planning',
      blueprintRoleKey: item.roleHint || 'ROLE_NETZPLANUNG',
      dataClass: item.dataClass || 'syntheticTenantSeed',
      sourceClass:
        item.dataClass === 'publicContextLayer'
          ? 'publicContextLayer'
          : item.dataClass === 'sandboxRuntimeArtifact'
            ? 'sandboxRuntimeArtifact'
            : 'syntheticTenantSeed',
      nextGate:
        item.id === 'napReference'
          ? 'resolve_missing_nap_reference'
          : item.present
            ? 'evidence_ready'
            : 'complete_related_case_evidence',
      enablesDossierAddition: item.enablesDossierAddition,
    }));
  },

  buildStadtwerkMauerGridPlanningQueueRows(queueItems = []) {
    return queueItems.map((item) => ({
      queueItemId: item.queueItemId,
      roleKey: item.roleKey,
      blueprintRoleKey: item.blueprintRoleKey,
      roleRelationLabel: item.roleRelationLabel,
      caseId: item.caseId,
      controlCase: item.controlCase,
      label: item.label,
      status: item.status,
      nextGate: item.nextGate,
      allowedActionClass: item.allowedActionClass,
      dataClass: item.dataClass,
      sourceClass: item.sourceClass,
      detailLabel: item.detail,
    }));
  },

  buildStadtwerkMauerGridPlanningEvidenceRows(evidenceHandover = []) {
    return evidenceHandover.map((item) => ({
      handoverId: item.handoverId,
      evidenceId: item.evidenceId,
      label: item.label,
      status: item.status,
      present: item.present === true,
      required: item.required === true,
      roleKey: item.roleKey,
      blueprintRoleKey: item.blueprintRoleKey,
      dataClass: item.dataClass,
      sourceClass: item.sourceClass,
      nextGate: item.nextGate,
      enablesDossierAddition: item.enablesDossierAddition,
    }));
  },

  buildStadtwerkMauerGridPlanningSelectedItemDetailStatus({
    tenantId = 'stadtwerk-mauer',
    caseId = 'smm-budibase-workbench',
    queueItemId = 'grid-planning:missing-nap-clarification',
    queueStatus = null,
  } = {}) {
    const queueRows = queueStatus?.queueRows || [];
    const selectedItem =
      queueRows.find((row) => row.queueItemId === queueItemId) ||
      (queueItemId === 'first' ? queueRows[0] : null);
    const found = queueStatus?.found === true && Boolean(selectedItem);
    const status = !queueStatus?.sandboxBoundaryAllowed
      ? 'grid_planning_selected_item_blocked_outside_sandbox_tenant'
      : !queueStatus?.found
        ? 'grid_planning_selected_item_queue_not_found'
        : !selectedItem
          ? 'grid_planning_selected_item_not_found'
          : selectedItem.status === 'ready_for_grid_planning_review'
            ? 'grid_planning_selected_item_ready'
            : 'grid_planning_selected_item_needs_evidence';
    const evidenceGaps = (queueStatus?.evidenceHandoverRows || []).filter(
      (row) => row.present !== true || row.status !== 'present'
    );
    const noCallGuards = Array.from(
      new Set([
        ...(queueStatus?.noCallGuards || []),
        'budibase.selected_row.write',
        'grid-planning.approve-capacity',
        'grid-planning.commit-plan',
      ])
    );
    const itemSummaryRows = found
      ? [
          {
            queueItemId: selectedItem.queueItemId,
            label: selectedItem.label,
            status,
            itemStatus: selectedItem.status,
            caseId,
            roleKey: selectedItem.roleKey,
            blueprintRoleKey: selectedItem.blueprintRoleKey,
            nextGate: selectedItem.nextGate,
            allowedActionClass: selectedItem.allowedActionClass,
            advisoryBoundary: 'read_only_advisory_context_no_capacity_approval',
            detailLabel: selectedItem.detailLabel,
          },
        ]
      : [];
    const contextRows = found
      ? [
          {
            contextKey: 'controlCase',
            label: 'Control Case',
            value: selectedItem.controlCase || queueStatus?.controlCase || '',
            sourceClass: selectedItem.sourceClass || 'syntheticTenantSeed',
            evidenceStatus: 'context',
          },
          {
            contextKey: 'publicContextHint',
            label: 'Public Context Hint',
            value:
              queueStatus?.dataClasses?.publicContextLayer ||
              'Public-context data may inform the case but does not create a capacity commitment.',
            sourceClass: 'publicContextLayer',
            evidenceStatus: 'advisory_context',
          },
          {
            contextKey: 'syntheticTenantSeed',
            label: 'Synthetic Tenant Seed',
            value: queueStatus?.summary?.syntheticIdDisclaimer || '',
            sourceClass: 'syntheticTenantSeed',
            evidenceStatus: 'demo_seed',
          },
        ]
      : [];
    const evidenceGapRows = evidenceGaps.map((row) => ({
      evidenceId: row.evidenceId,
      label: row.label,
      status: row.status,
      present: row.present === true,
      required: row.required === true,
      dataClass: row.dataClass,
      sourceClass: row.sourceClass,
      nextGate: row.nextGate,
      enablesDossierAddition: row.enablesDossierAddition,
    }));
    const nextGateRows = [
      {
        gateId: found
          ? selectedItem.nextGate
          : queueStatus?.found
            ? 'select_valid_grid_planning_item'
            : queueStatus?.nextGate?.id || 'select_valid_grid_planning_item',
        label: found
          ? this.humanizeWorkbenchLabel(selectedItem.nextGate)
          : queueStatus?.found
            ? 'Select a valid grid-planning queue item'
            : queueStatus?.nextGate?.label || 'Select a valid grid-planning queue item',
        status,
        ownerRole: 'grid-planning',
        allowedActionClass: found ? selectedItem.allowedActionClass : 'read_only_selection_only',
        capacityCommitment: 'not_binding',
        productionApproval: 'not_granted',
      },
    ];
    const safeFollowUpRows = (queueStatus?.positiveFollowUps || []).map((item) => ({
      missingDataPoint: item.missingDataPoint,
      category: item.category || 'stadtwerk_mauer_grid_planning_selected_item_detail',
      dataClass: item.dataClass || 'syntheticTenantSeed',
      state: item.state || 'clarification',
      enablesDossierAddition: item.enablesDossierAddition,
    }));
    const noCallGuardRows = noCallGuards.map((guard) => ({
      guard,
      status: 'not_called',
      boundary: 'read_only_budibase_render_shell',
    }));
    const dossierFacts = [
      `Selected Grid Planning Item Status: ${status}`,
      `Tenant: ${tenantId}`,
      `Case: ${caseId}`,
      `Queue Item: ${queueItemId}`,
      `Evidence gaps: ${evidenceGapRows.length}`,
    ];

    return {
      capabilityKey: 'stadtwerk_mauer_grid_planning_selected_item_detail',
      safety: 'read_only',
      found,
      status,
      tenantId,
      requiredTenantId: queueStatus?.requiredTenantId || 'stadtwerk-mauer',
      sandboxBoundaryAllowed: queueStatus?.sandboxBoundaryAllowed === true,
      caseId,
      requiredCaseId: queueStatus?.requiredCaseId || 'smm-budibase-workbench',
      queueItemId,
      title: 'Stadtwerk Mauer Zielnetzplanung Selected Item Detail',
      summary: {
        selectedItemFound: found,
        itemSummaryRowCount: itemSummaryRows.length,
        contextRowCount: contextRows.length,
        evidenceGapRowCount: evidenceGapRows.length,
        safeFollowUpRowCount: safeFollowUpRows.length,
        allowedActionClass: found ? selectedItem.allowedActionClass : 'read_only_selection_only',
        advisoryBoundary:
          'Selected-item detail is advisory evidence context; it is not a binding grid-capacity statement.',
        budibaseBoundary:
          'Budibase renders scalar selected-item and next-gate rows only; Cernion remains the system of record and command gate.',
      },
      itemSummaryRows,
      contextRows,
      evidenceGapRows,
      nextGateRows,
      safeFollowUpRows,
      noCallGuardRows,
      missingEvidence: queueStatus?.missingEvidence || [],
      positiveFollowUps: queueStatus?.positiveFollowUps || [],
      capabilityBroker: {
        exposed: false,
        reason:
          'Selected-item detail is a Workbench-specific projection; no broad Personal-Agent capability route is added.',
      },
      hydrationRegistry: {
        exposed: false,
        reason:
          'No dossier hydration rule is added for this Workbench-only selected-item detail slice.',
      },
      sourceActions: {
        inspected: ['dashboard-api.stadtwerkMauerGridPlanningSelectedItemDetailStatus'],
        referenced: [
          'dashboard-api.stadtwerkMauerGridPlanningRoleQueueStatus',
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
        queueItemId,
        itemSummaryRows,
        contextRows,
        evidenceGapRows,
        nextGateRows,
        safeFollowUpRows,
        noCallGuards,
        dossierFacts,
      },
      meta: {
        inspected: [
          'dashboard-api.stadtwerkMauerGridPlanningSelectedItemDetailStatus',
          'dashboard-api.stadtwerkMauerGridPlanningRoleQueueStatus',
          'budibase-stadtwerk-mauer-workbench-manifest',
        ],
      },
    };
  },

  buildStadtwerkMauerSalesWorkbenchBriefingStatus({
    tenantId = 'stadtwerk-mauer',
    caseId = 'smm-budibase-workbench',
    audience = 'vertrieb',
    limit = 10,
    caseDetailStatus = null,
    roleCatalogStatus = null,
    gridPlanningRoleQueueStatus = null,
    tenantDatabrowserStatus = null,
  } = {}) {
    const seed = stadtwerkMauerPvMissingNap;
    const sandboxBoundaryAllowed = tenantId === seed.demoTenant.tenantId;
    const selectedCaseAllowed = caseId === 'smm-budibase-workbench';
    const normalizedAudience = this.normalizeStadtwerkMauerSalesAudience(audience);
    const audienceSupported = Boolean(normalizedAudience);
    const briefingAudience = normalizedAudience || 'vertrieb';
    const found =
      sandboxBoundaryAllowed &&
      selectedCaseAllowed &&
      audienceSupported &&
      caseDetailStatus?.found !== false;
    const unsupportedAudienceGap = audienceSupported
      ? []
      : [
          {
            missingDataPoint: 'supported_sales_audience',
            enablesDossierAddition:
              'select vertrieb, key-account or utility-expert before rendering evidence-backed briefing rows',
            dataClass: 'syntheticTenantSeed',
            state: 'clarification',
          },
        ];
    const missingEvidence = found
      ? [...(caseDetailStatus?.missingEvidence || []), ...unsupportedAudienceGap]
      : sandboxBoundaryAllowed && selectedCaseAllowed
        ? unsupportedAudienceGap
        : sandboxBoundaryAllowed
          ? [
              {
                missingDataPoint: 'stadtwerk_mauer_case_scope',
                enablesDossierAddition:
                  'select the synthetic case smm-budibase-workbench before rendering Vertrieb briefing rows',
                dataClass: 'syntheticTenantSeed',
                state: 'clarification',
              },
              ...unsupportedAudienceGap,
            ]
          : [
              {
                missingDataPoint: 'stadtwerk_mauer_tenant_scope',
                enablesDossierAddition:
                  'select the synthetic tenant stadtwerk-mauer before rendering Vertrieb briefing rows',
                dataClass: 'syntheticTenantSeed',
                state: 'clarification',
              },
              ...unsupportedAudienceGap,
            ];
    const noCallGuards = Array.from(
      new Set([
        ...(seed.forbiddenActions || []),
        ...(caseDetailStatus?.sourceActions?.notCalled || []),
        ...(roleCatalogStatus?.sourceActions?.notCalled || []),
        ...(gridPlanningRoleQueueStatus?.sourceActions?.notCalled || []),
        ...(tenantDatabrowserStatus?.sourceActions?.notCalled || []),
        'crm.customer.create',
        'crm.customer.update',
        'customer-master.write',
        'claim.generate.llm',
        'claim.publish',
        'offer.create',
        'contract.create',
        'customer.communication.send',
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
    const briefingItems = found
      ? this.buildStadtwerkMauerSalesBriefingItems({
          seed,
          caseId,
          audience: briefingAudience,
          caseDetailStatus,
          gridPlanningRoleQueueStatus,
          tenantDatabrowserStatus,
        }).slice(0, limit)
      : [];
    const briefingRows = this.buildStadtwerkMauerSalesBriefingRows(briefingItems);
    const claimRows = briefingRows.filter((row) => row.rowType === 'claim');
    const evidenceRows = this.buildStadtwerkMauerSalesEvidenceRows({
      briefingItems,
      caseDetailStatus,
    });
    const gapRows = this.buildStadtwerkMauerSalesGapRows({ missingEvidence, briefingItems });
    const followUpRows = this.buildStadtwerkMauerSalesFollowUpRows({
      missingEvidence,
      briefingItems,
    });
    const safeClaimCount = claimRows.filter((row) => row.claimStatus === 'evidence_backed').length;
    const notClaimableCount = claimRows.filter(
      (row) => row.claimStatus === 'not_yet_claimable'
    ).length;
    const status = !sandboxBoundaryAllowed
      ? 'sales_briefing_blocked_outside_sandbox_tenant'
      : !selectedCaseAllowed || caseDetailStatus?.found === false
        ? 'sales_briefing_not_found'
        : !audienceSupported
          ? 'sales_briefing_unsupported_audience'
          : notClaimableCount > 0
            ? 'sales_briefing_ready_with_open_gaps'
            : 'sales_briefing_ready';
    const positiveFollowUps = [
      ...missingEvidence.map((item) => ({
        ...item,
        category: 'stadtwerk_mauer_sales_workbench_briefing',
      })),
      ...briefingItems
        .filter((item) => item.claimStatus === 'not_yet_claimable')
        .map((item) => ({
          missingDataPoint: item.topicKey,
          enablesDossierAddition: item.recommendedInternalFollowUp,
          category: 'stadtwerk_mauer_sales_workbench_briefing',
          state: item.claimStatus,
        })),
    ];
    const dossierFacts = [
      `Sales Briefing Status: ${status}`,
      `Tenant: ${tenantId}`,
      `Case: ${caseId}`,
      `Audience: ${briefingAudience}`,
      `Safe claims: ${safeClaimCount}`,
      `Not-yet-claimable rows: ${notClaimableCount}`,
    ];

    return {
      capabilityKey: 'stadtwerk_mauer_sales_workbench_briefing',
      safety: 'read_only',
      found,
      status,
      tenantId,
      requiredTenantId: seed.demoTenant.tenantId,
      sandboxBoundaryAllowed,
      caseId,
      requiredCaseId: 'smm-budibase-workbench',
      audience: briefingAudience,
      requestedAudience: audience,
      supportedAudiences: ['vertrieb', 'key-account', 'utility-expert'],
      briefingId: 'stadtwerk-mauer-sales-workbench-briefing',
      title: 'Stadtwerk Mauer Vertrieb Briefing',
      summary: {
        briefingRowCount: briefingRows.length,
        claimRowCount: claimRows.length,
        evidenceRowCount: evidenceRows.length,
        gapRowCount: gapRows.length,
        safeClaimCount,
        notClaimableCount,
        roleCatalogStatus: roleCatalogStatus?.status || null,
        gridPlanningRoleQueueStatus: gridPlanningRoleQueueStatus?.status || null,
        tenantDatabrowserStatus: tenantDatabrowserStatus?.status || null,
        claimBoundary:
          'Claims are deterministic from Cernion evidence rows and explicitly marked evidence-backed, assumption-backed or not-yet-claimable.',
        budibaseBoundary:
          'Budibase renders scalar briefing rows only; Cernion remains the system of record and command gate.',
        syntheticIdDisclaimer:
          'Stadtwerk Mauer app, tenant, case and briefing values are synthetic demo identifiers unless explicitly marked as public context.',
      },
      briefingRows,
      claimRows,
      evidenceRows,
      gapRows,
      followUpRows,
      missingEvidence,
      positiveFollowUps,
      nextGate:
        notClaimableCount > 0
          ? {
              id: 'resolve_sales_briefing_open_gaps',
              label: 'Resolve open evidence before using not-yet-claimable statements',
            }
          : {
              id: 'open_sales_briefing',
              label: 'Use safe claims as presenter talking points',
            },
      capabilityBroker: {
        exposed: false,
        reason:
          'Sales Workbench briefing is a Workbench-first projection; no broad Personal-Agent capability route is added.',
      },
      hydrationRegistry: {
        exposed: false,
        reason:
          'No dossier hydration rule is added for this Workbench-only Vertrieb briefing slice.',
      },
      sourceActions: {
        inspected: ['dashboard-api.stadtwerkMauerSalesWorkbenchBriefingStatus'],
        referenced: [
          'dashboard-api.stadtwerkMauerCaseDetailStatus',
          'dashboard-api.stadtwerkMauerRoleWorkbenchCatalogStatus',
          'dashboard-api.stadtwerkMauerGridPlanningRoleQueueStatus',
          'dashboard-api.stadtwerkMauerTenantDatabrowserStatus',
          'src/vdmi-blueprint-pack-seeds/stadtwerk-mauer-pv-missing-nap-v1.json',
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
        audience: briefingAudience,
        claimRows,
        evidenceRows,
        gapRows,
        followUpRows,
        missingEvidence,
        positiveFollowUps,
        noCallGuards,
        dossierFacts,
      },
      meta: {
        inspected: [
          'dashboard-api.stadtwerkMauerSalesWorkbenchBriefingStatus',
          'dashboard-api.stadtwerkMauerCaseDetailStatus',
          'dashboard-api.stadtwerkMauerRoleWorkbenchCatalogStatus',
          'budibase-stadtwerk-mauer-workbench-manifest',
        ],
      },
    };
  },

  normalizeStadtwerkMauerSalesAudience(audience = 'vertrieb') {
    const normalized = String(audience || 'vertrieb')
      .trim()
      .toLowerCase()
      .replace(/_/g, '-');
    const aliases = {
      sales: 'vertrieb',
      vertrieb: 'vertrieb',
      'key-account': 'key-account',
      keyaccount: 'key-account',
      'utility-expert': 'utility-expert',
      expert: 'utility-expert',
      fachpublikum: 'utility-expert',
    };
    return aliases[normalized] || null;
  },
};
