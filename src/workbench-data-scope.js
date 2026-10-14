'use strict';

// Scope is structural provenance, never subject similarity or a tenant-wide search.
function scopedDatasets(
  records,
  message,
  { conversationId, caseId, previousReads = [], newDatasetIds = [] } = {}
) {
  return records.filter((record) => {
    const explicit = [record.id, record.sourceName].some(
      (value) => value && String(message).includes(value)
    );
    return (
      explicit ||
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
