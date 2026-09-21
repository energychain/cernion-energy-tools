'use strict';

const { validatePresentationContract } = require('./contract-validators');

function isProjected(result) {
  return result?.projectionStatus === 'projiziert' || result?.projectionStatus === 'projected';
}

function toProjectedRenderModel(result) {
  if (!isProjected(result)) throw new Error('operation result is not projected');
  validatePresentationContract(result.presentationContract);
  return {
    operationId: result.operationId,
    badge: 'Projiziert',
    presentationContract: result.presentationContract,
    evidenceMarkers: result.presentationContract.aussagen || [],
  };
}

function toNotProjectedRenderModel(result) {
  if (isProjected(result)) throw new Error('operation result is projected');
  return {
    operationId: result?.operationId,
    badge: 'Nicht projiziert',
    raw: result?.unprojected?.raw || result?.rawPayload || null,
    notice: result?.unprojected?.notice || result?.rawPayloadNotice || 'nicht_projiziert',
    evidenceMarkers: [],
    aggregationState: null,
  };
}

function assertNoEvidenceSemanticsForRawJson(model) {
  if (model?.aggregationState !== null)
    throw new Error('raw JSON must not expose aggregation state');
  if (Array.isArray(model?.evidenceMarkers) && model.evidenceMarkers.length === 0) return model;
  throw new Error('raw JSON must not expose evidence marker semantics');
}

module.exports = {
  assertNoEvidenceSemanticsForRawJson,
  isProjected,
  toNotProjectedRenderModel,
  toProjectedRenderModel,
};
