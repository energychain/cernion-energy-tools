'use strict';

const stadtwerkMauerPvMissingNap = require('./vdmi-blueprint-pack-seeds/stadtwerk-mauer-pv-missing-nap-v1.json');

const REQUIRED_EVIDENCE = Object.freeze([
  'napReference',
  'maloId',
  'meloId',
  'meterId',
  'customerConsentStatus',
]);

const REQUIRED_DATA_CLASSES = Object.freeze([
  'publicContextLayer',
  'syntheticTenantSeed',
  'sandboxRuntimeArtifact',
]);

const REQUIRED_ROLE_IDS = Object.freeze(['ROLE_NETZPLANUNG', 'ROLE_GRID_OPERATOR']);

const SEEDS = Object.freeze([stadtwerkMauerPvMissingNap]);

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

  const roleIds = new Set((seed.roles || []).map((role) => role.roleId));
  for (const roleId of REQUIRED_ROLE_IDS) {
    if (!roleIds.has(roleId)) errors.push(`missing role: ${roleId}`);
  }
  if (!(seed.roles || []).some((role) => role.relation === 'information')) {
    errors.push('missing informed/commercial/audit role');
  }

  const evidenceIds = new Set((seed.evidenceRequirements || []).map((item) => item.id));
  for (const evidenceId of REQUIRED_EVIDENCE) {
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
    roleHint: item.id === 'napReference' ? 'ROLE_NETZPLANUNG' : 'ROLE_GRID_OPERATOR',
    enablesDossierAddition: item.enablesDossierAddition,
    sourceSeedId: selectedSeed.id,
    execution: 'none',
  }));
}

module.exports = {
  REQUIRED_DATA_CLASSES,
  REQUIRED_EVIDENCE,
  REQUIRED_ROLE_IDS,
  buildWorkbenchClarificationItems,
  getVdmiBlueprintPackSeed,
  listVdmiBlueprintPackSeeds,
  stadtwerkMauerPvMissingNap,
  validateVdmiBlueprintPackSeed,
};
