'use strict';

const stadtwerkMauerPvMissingNap = require('./vdmi-blueprint-pack-seeds/stadtwerk-mauer-pv-missing-nap-v1.json');
const stadtwerkMauerRedispatchParticipationReadiness = require('./vdmi-blueprint-pack-seeds/stadtwerk-mauer-redispatch-participation-readiness-v1.json');
const stadtwerkMauerSubstationLoadAssessment = require('./vdmi-blueprint-pack-seeds/stadtwerk-mauer-substation-load-assessment-v1.json');
const stadtwerkMauerEnergySharingCollectiveApproval = require('./vdmi-blueprint-pack-seeds/stadtwerk-mauer-energy-sharing-collective-approval-v1.json');
const stadtwerkMauerConnectionDeadlineEvidenceQueue = require('./vdmi-blueprint-pack-seeds/stadtwerk-mauer-connection-deadline-evidence-queue-v1.json');

const REQUIRED_EVIDENCE = Object.freeze([
  'napReference',
  'maloId',
  'meloId',
  'meterId',
  'customerConsentStatus',
]);
const REQUIRED_REDISPATCH_READINESS_EVIDENCE = Object.freeze([
  'syntheticRedispatchAssetPortfolio',
  'installationGridLocationEvidence',
  'remoteControlCommunicationTestEvidence',
  'forecastDispatchTestProof',
  'readinessReviewDecision',
]);
const REQUIRED_SUBSTATION_LOAD_ASSESSMENT_EVIDENCE = Object.freeze([
  'stationBoundaryEvidence',
  'loadProfileEvidence',
  'forecastHorizonEvidence',
  'flexOptionEvidence',
  'capexOptionEvidence',
  'reviewGateMarker',
]);
const REQUIRED_ENERGY_SHARING_COLLECTIVE_APPROVAL_EVIDENCE = Object.freeze([
  'syntheticCollectiveBoundaryEvidence',
  'operatorParticipantBoundaryEvidence',
  'meteringConceptEvidence',
  'contractConsentMarketRoleEvidence',
  'allocationBillingSettlementGapEvidence',
  'approvalReadinessDecision',
]);
const REQUIRED_CONNECTION_DEADLINE_EVIDENCE = Object.freeze([
  'connectionCaseIntakeEvidence',
  'deadlineRiskEvidence',
  'technicalPlausibilityEvidence',
  'clarificationOwnerEvidence',
  'communicationNoteDraftEvidence',
  'nextGateReadinessEvidence',
]);

const REQUIRED_DATA_CLASSES = Object.freeze([
  'publicContextLayer',
  'syntheticTenantSeed',
  'sandboxRuntimeArtifact',
]);

const REQUIRED_ROLE_IDS = Object.freeze(['ROLE_NETZPLANUNG', 'ROLE_GRID_OPERATOR']);
const REQUIRED_REDISPATCH_READINESS_ROLE_IDS = Object.freeze([
  'ROLE_GRID_OPERATIONS_LEAD',
  'ROLE_CERNION_GOVERNANCE',
]);
const REQUIRED_SUBSTATION_LOAD_ASSESSMENT_ROLE_IDS = Object.freeze([
  'ROLE_ASSET_PLANNING_LEAD',
  'ROLE_CERNION_GOVERNANCE',
]);
const REQUIRED_ENERGY_SHARING_COLLECTIVE_APPROVAL_ROLE_IDS = Object.freeze([
  'ROLE_ENERGY_SHARING_PRODUCT_OWNER',
  'ROLE_CERNION_GOVERNANCE',
]);
const REQUIRED_CONNECTION_DEADLINE_ROLE_IDS = Object.freeze([
  'ROLE_NETZPLANUNG',
  'ROLE_ANSCHLUSSWESEN',
]);
const REQUIRED_MATRIX_ROLE_KEYS = Object.freeze(['v', 'd', 'm', 'i']);
const MATRIX_HEADER_WORDS = Object.freeze([
  'Phase',
  'Verantwortlich',
  'Durchfuehrend',
  'Mitwirkend',
  'Informiert',
  'Nachweise',
]);

const SEEDS = Object.freeze([
  stadtwerkMauerPvMissingNap,
  stadtwerkMauerRedispatchParticipationReadiness,
  stadtwerkMauerSubstationLoadAssessment,
  stadtwerkMauerEnergySharingCollectiveApproval,
  stadtwerkMauerConnectionDeadlineEvidenceQueue,
]);

const SEED_VALIDATION_REQUIREMENTS = Object.freeze({
  [stadtwerkMauerPvMissingNap.id]: Object.freeze({
    requiredEvidence: REQUIRED_EVIDENCE,
    requiredRoleIds: REQUIRED_ROLE_IDS,
    expectedMatrixSlug: 'pv-registration-missing-nap',
  }),
  [stadtwerkMauerRedispatchParticipationReadiness.id]: Object.freeze({
    requiredEvidence: REQUIRED_REDISPATCH_READINESS_EVIDENCE,
    requiredRoleIds: REQUIRED_REDISPATCH_READINESS_ROLE_IDS,
    expectedMatrixSlug: 'redispatch-participation-readiness',
  }),
  [stadtwerkMauerSubstationLoadAssessment.id]: Object.freeze({
    requiredEvidence: REQUIRED_SUBSTATION_LOAD_ASSESSMENT_EVIDENCE,
    requiredRoleIds: REQUIRED_SUBSTATION_LOAD_ASSESSMENT_ROLE_IDS,
    expectedMatrixSlug: 'substation-load-assessment',
  }),
  [stadtwerkMauerEnergySharingCollectiveApproval.id]: Object.freeze({
    requiredEvidence: REQUIRED_ENERGY_SHARING_COLLECTIVE_APPROVAL_EVIDENCE,
    requiredRoleIds: REQUIRED_ENERGY_SHARING_COLLECTIVE_APPROVAL_ROLE_IDS,
    expectedMatrixSlug: 'energy-sharing-collective-approval',
  }),
  [stadtwerkMauerConnectionDeadlineEvidenceQueue.id]: Object.freeze({
    requiredEvidence: REQUIRED_CONNECTION_DEADLINE_EVIDENCE,
    requiredRoleIds: REQUIRED_CONNECTION_DEADLINE_ROLE_IDS,
    expectedMatrixSlug: 'connection-deadline-evidence-queue',
  }),
});

function getSeedValidationRequirements(seed) {
  return (
    SEED_VALIDATION_REQUIREMENTS[seed?.id] || {
      requiredEvidence: [],
      requiredRoleIds: [],
      expectedMatrixSlug: seed?.demoProcessMatrix?.slug || null,
    }
  );
}

function listVdmiBlueprintPackSeeds() {
  return SEEDS.map((seed) => ({
    id: seed.id,
    version: seed.version,
    kind: seed.kind,
    processFamily: seed.processFamily,
    controlCase: seed.controlCase,
    demoTenantId: seed.demoTenant?.tenantId || null,
    safetyClassification: seed.safetyClassification,
  }));
}

function getVdmiBlueprintPackSeed(id) {
  return SEEDS.find((seed) => seed.id === id) || null;
}

function validateVdmiBlueprintPackSeed(seed) {
  const errors = [];

  if (!seed || typeof seed !== 'object') {
    return { valid: false, errors: ['seed must be an object'] };
  }

  for (const field of ['id', 'kind', 'version', 'processFamily', 'controlCase']) {
    if (!seed[field]) errors.push(`missing field: ${field}`);
  }

  if (seed.kind !== 'vdmi_blueprint_pack_seed') {
    errors.push('kind must be vdmi_blueprint_pack_seed');
  }

  if (seed.safetyClassification !== 'read_only_blueprint_seed') {
    errors.push('safetyClassification must be read_only_blueprint_seed');
  }

  if (seed.demoTenant?.tenantId !== 'stadtwerk-mauer') {
    errors.push('demoTenant.tenantId must be stadtwerk-mauer for this seed');
  }

  if (seed.demoTenant?.classification !== 'synthetic_demo_tenant') {
    errors.push('demoTenant.classification must be synthetic_demo_tenant');
  }

  for (const dataClass of REQUIRED_DATA_CLASSES) {
    if (!seed.dataClasses?.[dataClass]) {
      errors.push(`missing data class: ${dataClass}`);
    }
  }

  const requirements = getSeedValidationRequirements(seed);
  const roleIds = new Set((seed.roles || []).map((role) => role.roleId));
  for (const roleId of requirements.requiredRoleIds) {
    if (!roleIds.has(roleId)) errors.push(`missing role: ${roleId}`);
  }
  if (!(seed.roles || []).some((role) => role.relation === 'information')) {
    errors.push('missing informed/commercial/audit role');
  }

  const evidenceIds = new Set((seed.evidenceRequirements || []).map((item) => item.id));
  for (const evidenceId of requirements.requiredEvidence) {
    if (!evidenceIds.has(evidenceId)) errors.push(`missing evidence requirement: ${evidenceId}`);
  }

  for (const item of seed.evidenceRequirements || []) {
    if (!item.enablesDossierAddition) {
      errors.push(`missing positive follow-up for evidence requirement: ${item.id}`);
    }
    if (item.dataClass !== 'syntheticTenantSeed') {
      errors.push(`evidence requirement ${item.id} must be syntheticTenantSeed`);
    }
  }

  const matrix = seed.demoProcessMatrix;
  if (!matrix || typeof matrix !== 'object') {
    errors.push('missing demoProcessMatrix');
  } else {
    if (requirements.expectedMatrixSlug && matrix.slug !== requirements.expectedMatrixSlug) {
      errors.push(`demoProcessMatrix.slug must be ${requirements.expectedMatrixSlug}`);
    }
    if (matrix.roleLegend?.M !== 'Mitwirkend') {
      errors.push('demoProcessMatrix.roleLegend.M must be Mitwirkend');
    }
    for (const key of ['V', 'D', 'M', 'I']) {
      if (!matrix.roleLegend?.[key]) {
        errors.push(`demoProcessMatrix.roleLegend.${key} is required`);
      }
    }

    const rows = Array.isArray(matrix.rows) ? matrix.rows : [];
    if (rows.length < 3 || rows.length > 5) {
      errors.push('demoProcessMatrix.rows must contain 3-5 rows');
    }

    const allowedDataClasses = new Set(REQUIRED_DATA_CLASSES);
    for (const dataClass of matrix.allowedDataClasses || []) {
      if (!allowedDataClasses.has(dataClass)) {
        errors.push(`demoProcessMatrix.allowedDataClasses contains unsupported class: ${dataClass}`);
      }
    }

    rows.forEach((row, index) => {
      const rowLabel = row.phase || index + 1;
      for (const roleKey of REQUIRED_MATRIX_ROLE_KEYS) {
        const roleValue = row[roleKey];
        if (!roleValue) {
          errors.push(`demoProcessMatrix row ${rowLabel} missing role cell: ${roleKey}`);
          continue;
        }
        for (const dataClass of REQUIRED_DATA_CLASSES) {
          if (roleValue === dataClass) {
            errors.push(`demoProcessMatrix row ${rowLabel} role ${roleKey} must not be a data class`);
          }
        }
        for (const headerWord of MATRIX_HEADER_WORDS) {
          if (roleValue === headerWord || roleValue.includes(`= ${headerWord}`)) {
            errors.push(`demoProcessMatrix row ${rowLabel} role ${roleKey} repeats header text`);
          }
        }
      }
      if (!Array.isArray(row.evidenceRequirements) || row.evidenceRequirements.length === 0) {
        errors.push(`demoProcessMatrix row ${rowLabel} missing evidence requirements`);
      }
      for (const dataClass of row.dataClassRefs || []) {
        if (!allowedDataClasses.has(dataClass)) {
          errors.push(`demoProcessMatrix row ${rowLabel} uses unsupported data class: ${dataClass}`);
        }
      }
      if (!row.gateOutcome) {
        errors.push(`demoProcessMatrix row ${rowLabel} missing gate outcome`);
      }
      if (!row.enablesDossierAddition) {
        errors.push(`demoProcessMatrix row ${rowLabel} missing positive follow-up`);
      }
    });
  }

  for (const hint of seed.allowedCommandHints || []) {
    if (hint.execution !== 'metadata_only') {
      errors.push(`command hint ${hint.id || hint.kind} must be metadata_only`);
    }
  }

  const forbidden = new Set(seed.forbiddenActions || []);
  for (const action of [
    'mako_write',
    'billing',
    'settlement',
    'smgw_cls_device_control',
    'external_connector_call',
    'hitl_create',
    'public_context_mutation',
    'production_mutation',
    'personal_agent_hardcoding',
  ]) {
    if (!forbidden.has(action)) errors.push(`missing forbidden action: ${action}`);
  }

  if (seed.publicContextMutationAllowed !== false) {
    errors.push('publicContextMutationAllowed must be false');
  }

  if (seed.tenantProvisioningAllowed !== false) {
    errors.push('tenantProvisioningAllowed must be false');
  }

  if (seed.realWorldClaim !== 'synthetic_demo_only') {
    errors.push('realWorldClaim must be synthetic_demo_only');
  }

  return {
    valid: errors.length === 0,
    errors,
  };
}

function buildWorkbenchClarificationItems(seed) {
  const selectedSeed = seed || stadtwerkMauerPvMissingNap;
  return (selectedSeed.evidenceRequirements || []).map((item) => ({
    id: `${selectedSeed.controlCase}:${item.id}`,
    processFamily: selectedSeed.processFamily,
    controlCase: selectedSeed.controlCase,
    evidenceId: item.id,
    state: item.missingState,
    roleHint:
      item.id === 'napReference'
        ? 'ROLE_NETZPLANUNG'
        : selectedSeed.id === stadtwerkMauerConnectionDeadlineEvidenceQueue.id
          ? 'ROLE_ANSCHLUSSWESEN'
        : selectedSeed.id === stadtwerkMauerEnergySharingCollectiveApproval.id
          ? 'ROLE_ENERGY_SHARING_PRODUCT_OWNER'
        : selectedSeed.id === stadtwerkMauerSubstationLoadAssessment.id
          ? 'ROLE_ASSET_PLANNING_LEAD'
        : selectedSeed.id === stadtwerkMauerRedispatchParticipationReadiness.id
          ? 'ROLE_GRID_OPERATIONS_LEAD'
          : 'ROLE_GRID_OPERATOR',
    enablesDossierAddition: item.enablesDossierAddition,
    sourceSeedId: selectedSeed.id,
    execution: 'none',
  }));
}

function buildDemoProcessMatrixSync(seed) {
  const selectedSeed = seed || stadtwerkMauerPvMissingNap;
  const matrix = selectedSeed.demoProcessMatrix || {};
  const rows = Array.isArray(matrix.rows) ? matrix.rows : [];
  const allowedDataClasses = Array.isArray(matrix.allowedDataClasses)
    ? matrix.allowedDataClasses
    : [];
  const allowedSet = new Set(REQUIRED_DATA_CLASSES);
  const forbiddenRoleCellValues = new Set([
    ...REQUIRED_DATA_CLASSES,
    ...MATRIX_HEADER_WORDS,
    ...MATRIX_HEADER_WORDS.map((word) => `= ${word}`),
  ]);
  const rowSummaries = rows.map((row) => ({
    phase: row.phase,
    roles: {
      V: row.v,
      D: row.d,
      M: row.m,
      I: row.i,
    },
    evidenceRequirements: row.evidenceRequirements || [],
    dataClassRefs: row.dataClassRefs || [],
    status: row.status,
    gateOutcome: row.gateOutcome,
    enablesDossierAddition: row.enablesDossierAddition || null,
  }));
  const roleCells = rowSummaries.flatMap((row) => Object.values(row.roles));
  const evidenceRequirements = Array.from(
    new Set(rowSummaries.flatMap((row) => row.evidenceRequirements))
  );
  const dataClassRefs = Array.from(new Set(rowSummaries.flatMap((row) => row.dataClassRefs)));
  const roleCellsClean = roleCells.every((cell) => cell && !forbiddenRoleCellValues.has(cell));
  const dataClassesLimited =
    allowedDataClasses.every((dataClass) => allowedSet.has(dataClass)) &&
    dataClassRefs.every((dataClass) => allowedSet.has(dataClass));

  return {
    slug: matrix.slug || null,
    expectedSlug:
      getSeedValidationRequirements(selectedSeed).expectedMatrixSlug || matrix.slug || null,
    synced:
      matrix.slug === (getSeedValidationRequirements(selectedSeed).expectedMatrixSlug || matrix.slug),
    roleLegend: matrix.roleLegend || {},
    roleLegendM: matrix.roleLegend?.M || null,
    rowCount: rows.length,
    rowCountValid: rows.length >= 3 && rows.length <= 5,
    roleCellsClean,
    evidenceRequirements,
    dataClassRefs,
    dataClassesLimited,
    forbiddenActionsStatus: 'not_introduced',
    downstreamHandoff: matrix.downstreamHandoff || {
      blueprintPack: 'pending',
      landingRegistry: 'pending',
      productiveDemoRoom: 'pending',
    },
    rows: rowSummaries,
  };
}

function buildLandingRegistryDraftFromBlueprintSeed(seed) {
  const selectedSeed = seed || stadtwerkMauerSubstationLoadAssessment;
  const matrixSync = buildDemoProcessMatrixSync(selectedSeed);
  const matrix = selectedSeed.demoProcessMatrix || {};
  const roleHeaders = [
    'Phase',
    'V = Verantwortlich',
    'D = Durchfuehrend',
    'M = Mitwirkend',
    'I = Informiert',
    'Nachweise',
  ];
  const downstreamHandoff = matrixSync.downstreamHandoff || {};
  const productivePending =
    downstreamHandoff.productiveDemoRoom == null ||
    downstreamHandoff.productiveDemoRoom === 'pending';
  const publicationBlockers = [
    'productive_demo_room_publication_issue_missing',
    'landing_registry_review_owner_missing',
    'cernion_de_sitemap_canonical_update_pending',
  ];
  const safetyBoundaries = Array.from(
    new Set([
      ...(selectedSeed.forbiddenActions || []),
      'cernion.de.publish',
      'landing-registry.write',
      'budibase.table.write',
      'operations-runbook.execute',
      'external.connector.call',
      'hitl.create',
      'settlement.export',
      'device-control.execute',
      'personal-agent.execute',
    ])
  );

  return {
    slug: matrixSync.slug,
    title: matrix.title || selectedSeed.title || selectedSeed.id,
    processFamily: selectedSeed.processFamily || null,
    controlCase: selectedSeed.controlCase || null,
    seedId: selectedSeed.id,
    canonicalSource: `src/vdmi-blueprint-pack-seeds/${selectedSeed.id}.json`,
    roleHeaders,
    roleLegend: matrixSync.roleLegend,
    rowCount: matrixSync.rowCount,
    rows: matrixSync.rows.map((row) => ({
      phase: row.phase,
      V: row.roles.V,
      D: row.roles.D,
      M: row.roles.M,
      I: row.roles.I,
      evidenceRequirements: row.evidenceRequirements,
      gateOutcome: row.gateOutcome,
      status: row.status,
      positiveFollowUp: row.enablesDossierAddition,
    })),
    safetyBoundaries,
    syntheticDataStatement:
      selectedSeed.demoTenant?.description ||
      (selectedSeed.realWorldClaim === 'synthetic_demo_only'
        ? 'Stadtwerk Mauer review markers are synthetic demo data unless explicitly marked as public context.'
        : 'Review source data classification before publication.'),
    syncProof: {
      blueprintPack: {
        status: downstreamHandoff.blueprintPack || 'pending',
        source: 'Cernion-Energy-Tools Blueprint-Pack seed',
      },
      landingRegistryDraft: {
        status: 'draft_ready',
        source: 'derived_from_canonical_demoProcessMatrix',
      },
      productiveDemoRoom: {
        status: productivePending ? 'pending' : downstreamHandoff.productiveDemoRoom,
        source: 'cernion.de publication remains a later explicit issue',
      },
    },
    publicationBlockers: productivePending ? publicationBlockers : [],
    positiveFollowUps: [
      {
        missingDataPoint: 'landing_registry_review_owner',
        enablesDossierAddition:
          'adds who reviewed the downstream draft without changing the canonical matrix',
      },
      {
        missingDataPoint: 'productive_demo_room_publication',
        enablesDossierAddition:
          'adds productive cernion.de publication evidence after a later explicit publication issue',
      },
      {
        missingDataPoint: 'budibase_visible_sync_row',
        enablesDossierAddition:
          'adds Workbench-visible sync status after generated manifest/apply smoke if the manifest is touched',
      },
    ],
    sourceActions: {
      inspected: ['buildLandingRegistryDraftFromBlueprintSeed', 'buildDemoProcessMatrixSync'],
      referenced: [
        `src/vdmi-blueprint-pack-seeds/${selectedSeed.id}.json`,
        'demoProcessMatrix',
      ],
      notCalled: safetyBoundaries,
    },
  };
}

module.exports = {
  REQUIRED_DATA_CLASSES,
  REQUIRED_CONNECTION_DEADLINE_EVIDENCE,
  REQUIRED_CONNECTION_DEADLINE_ROLE_IDS,
  REQUIRED_ENERGY_SHARING_COLLECTIVE_APPROVAL_EVIDENCE,
  REQUIRED_ENERGY_SHARING_COLLECTIVE_APPROVAL_ROLE_IDS,
  REQUIRED_EVIDENCE,
  REQUIRED_REDISPATCH_READINESS_EVIDENCE,
  REQUIRED_REDISPATCH_READINESS_ROLE_IDS,
  REQUIRED_ROLE_IDS,
  REQUIRED_SUBSTATION_LOAD_ASSESSMENT_EVIDENCE,
  REQUIRED_SUBSTATION_LOAD_ASSESSMENT_ROLE_IDS,
  buildDemoProcessMatrixSync,
  buildLandingRegistryDraftFromBlueprintSeed,
  buildWorkbenchClarificationItems,
  getVdmiBlueprintPackSeed,
  listVdmiBlueprintPackSeeds,
  stadtwerkMauerRedispatchParticipationReadiness,
  stadtwerkMauerSubstationLoadAssessment,
  stadtwerkMauerPvMissingNap,
  stadtwerkMauerEnergySharingCollectiveApproval,
  stadtwerkMauerConnectionDeadlineEvidenceQueue,
  validateVdmiBlueprintPackSeed,
};
