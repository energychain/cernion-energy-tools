'use strict';

async function projectEvidenceCandidates(ctx, question = '') {
  return require('./tenant-evidence-sources').evidenceCandidates(ctx, question);
}

function describeProjectEndpoint(endpoint, operation) {
  // Existing operation descriptions can identify the source in a parenthetical annotation.
  const annotation = operation?.summary
    ?.match(/\(([^()]+)\)/u)?.[1]
    ?.split(/\s+[+|]\s+/u)[0]
    ?.trim();
  const label = endpoint.label || annotation || operation?.summary || endpoint.id;
  return {
    ...endpoint,
    label,
    evidenceTypeSignals: [
      ...new Set(
        [endpoint.id, label, operation?.summary, ...(endpoint.evidenceTypeSignals || [])].filter(
          Boolean
        )
      ),
    ],
  };
}

module.exports = { projectEvidenceCandidates, describeProjectEndpoint };
