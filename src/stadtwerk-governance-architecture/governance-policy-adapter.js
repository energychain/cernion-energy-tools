'use strict';

function normalizeMissingEvidence(missingEvidence) {
  if (!Array.isArray(missingEvidence)) return [];

  const seen = new Set();
  const normalized = [];

  missingEvidence.forEach((item) => {
    if (typeof item !== 'string') return;

    const value = item.trim();
    if (!value || seen.has(value)) return;

    seen.add(value);
    normalized.push(value);
  });

  return normalized;
}

function humanizeEvidenceLabel(id) {
  return id.replaceAll('_', ' ');
}

function buildEvidenceRequirements(missingEvidence) {
  return normalizeMissingEvidence(missingEvidence).map((id) => ({
    id,
    label: humanizeEvidenceLabel(id),
  }));
}

function buildMakoResolutionControlCase({ missingEvidence = [] } = {}) {
  return {
    controlCase: 'custom:mako_resolution_value',
    evidenceRequirements: buildEvidenceRequirements(missingEvidence),
    decisionPolicy: {
      onMissingEvidence: 'clarification',
    },
  };
}

function buildAssetToDecisionControlCase(options = {}) {
  const { missingEvidence = [] } = options;

  return {
    controlCase: 'asset_transformation',
    evidenceRequirements: buildEvidenceRequirements(missingEvidence),
    decisionPolicy: {
      onMissingEvidence: 'clarification',
      onHighFinancialImpact: 'mandatory_human_decision',
    },
  };
}

module.exports = {
  buildMakoResolutionControlCase,
  buildAssetToDecisionControlCase,
};
