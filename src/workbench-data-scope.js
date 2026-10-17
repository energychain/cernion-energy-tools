'use strict';

// Structural bindings remain valid; authorized descriptor selections extend this scope.
function scopedDatasets(
  records,
  message,
  {
    conversationId,
    caseId,
    projectIds = [],
    previousReads = [],
    newDatasetIds = [],
    tenantEvidenceIds = [],
  } = {}
) {
  return records.filter((record) => {
    if (record.provenance?.projectId)
      return (
        record.projectActive === true &&
        (projectIds.includes(record.provenance.projectId) ||
          (record.projectRefs || []).some(
            (ref) =>
              (conversationId && ref.conversationId === conversationId) ||
              (caseId && ref.caseId === caseId)
          ))
      );
    const explicit = [record.id, record.sourceName].some(
      (value) => value && String(message).includes(value)
    );
    return (
      explicit ||
      tenantEvidenceIds.includes(record.id) ||
      newDatasetIds.includes(record.id) ||
      (conversationId && record.provenance?.conversationId === conversationId) ||
      (caseId && record.provenance?.caseId === caseId) ||
      previousReads.some(
        (hit) =>
          hit.source === 'dataset.query' &&
          hit.metadata?.tenantId === record.tenantId &&
          hit.metadata?.datasetId === record.id
      )
    );
  });
}

function scopedDataEvidence(hits, scope = {}) {
  return hits.filter((hit) => {
    const dataset = hit.source === 'dataset.query' || hit.metadata?.datasetId;
    const tool = hit.retrievalSource === 'capability-read';
    if (!dataset && !tool) return true;
    if (!scope.dataRequested) return false;
    if (scope.tenantId && hit.metadata?.tenantId !== scope.tenantId) return false;
    if (!dataset) return true;
    if (scope.trustedCurrentTurn && !hit.metadata?.datasetId) return true;
    if (!scope.datasetIds) return false;
    return scope.datasetIds.includes(hit.metadata?.datasetId);
  });
}

module.exports = { scopedDatasets, scopedDataEvidence };
