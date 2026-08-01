'use strict';

// Shared requires/constants/helpers used across dashboard-api's action/method chunk files.
// Extracted verbatim from the original services/dashboard-api.service.js preamble as part
// of the v0.99 file-size modularization (same moleculer service name/action namespace).

const { FINDING_CODE_METADATA } = require('../../src/validation-findings');
const { resolveMunicipalityProfile } = require('../../src/municipality-resolver');
const {
  estimateMunicipalAnnualLoad,
  deriveTechnologyCorrelation,
} = require('../../src/municipal-load-estimator');
const { buildIntermunicipalComparison } = require('../../src/intermunicipal-comparison');
const {
  evaluatePresentationGrounding,
} = require('../../src/receipt-grounded-presentation-contract');
const {
  buildDemoProcessMatrixSync,
  buildLandingRegistryDraftFromBlueprintSeed,
  buildWorkbenchClarificationItems,
  getVdmiBlueprintPackSeed,
  stadtwerkMauerSubstationLoadAssessment,
  stadtwerkMauerPvMissingNap,
  validateVdmiBlueprintPackSeed,
} = require('../../src/vdmi-blueprint-pack-seeds');
const {
  buildEnergySidecarRouteRegistryStatus,
} = require('../../src/energy-sidecar-route-registry');
const { buildInterconnectionReleaseFileStatus } = require('../../src/interconnection-release-file');

const OPENAPI_TAG = 'Dashboard API';
const ACTION_MQ_LIST = 'mastr-quality.list';
const ACTION_RD_LIST = 'redispatch-expost.list';
const ACTION_ES_LIST = 'energy-sharing.list';
const ACTION_GC_LIST = 'grid-connection.list';
const ACTION_VDMI_LIST = 'vdmi.list';
const ACTION_VDMI_FINDINGS = 'vdmi.findings';

function stringQueryParam(name) {
  return { name, in: 'query', required: false, schema: { type: 'string' } };
}

module.exports = {
  FINDING_CODE_METADATA,
  resolveMunicipalityProfile,
  estimateMunicipalAnnualLoad,
  deriveTechnologyCorrelation,
  buildIntermunicipalComparison,
  evaluatePresentationGrounding,
  buildDemoProcessMatrixSync,
  buildLandingRegistryDraftFromBlueprintSeed,
  buildWorkbenchClarificationItems,
  getVdmiBlueprintPackSeed,
  stadtwerkMauerSubstationLoadAssessment,
  stadtwerkMauerPvMissingNap,
  validateVdmiBlueprintPackSeed,
  buildEnergySidecarRouteRegistryStatus,
  buildInterconnectionReleaseFileStatus,
  OPENAPI_TAG,
  ACTION_MQ_LIST,
  ACTION_RD_LIST,
  ACTION_ES_LIST,
  ACTION_GC_LIST,
  ACTION_VDMI_LIST,
  ACTION_VDMI_FINDINGS,
  stringQueryParam,
};
