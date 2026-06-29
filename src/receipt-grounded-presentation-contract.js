'use strict';

const KNOWN_PRESENTATION_TYPES = new Set([
  'kpi_fact',
  'comparison_table',
  'vdmi_matrix_table',
  'decision_brief',
  'risk_table',
  'evidence_gap_table',
  'debug_summary',
  'receipt_grounded_reply',
  'conversational_onboarding',
]);

function unique(values) {
  return [...new Set((values || []).filter(Boolean))];
}

function normalizeType(value) {
  if (!value || value === 'auto') return null;
  const type = String(value);
  return KNOWN_PRESENTATION_TYPES.has(type) ? type : null;
}

function extractSourceActions(execution = null) {
  if (!execution || !Array.isArray(execution.steps)) return [];
  return unique(
    execution.steps
      .map((step) => step?.action || step?.tool || step?.sourceAction || null)
      .filter(Boolean)
      .map(String)
  );
}

function hasVdmiRoleFields(task) {
  if (!task || typeof task !== 'object') return false;
  return (
    Array.isArray(task.verantwortlich) ||
    Array.isArray(task.durchfuehrend) ||
    Array.isArray(task.mitwirkend) ||
    Array.isArray(task.information)
  );
}

function hasVdmiShape(domainResult = {}) {
  const matrixTasks = Array.isArray(domainResult?.matrix?.tasks) ? domainResult.matrix.tasks : null;
  if (matrixTasks && matrixTasks.length > 0) return true;
  return Array.isArray(domainResult?.tasks) && domainResult.tasks.some(hasVdmiRoleFields);
}

function hasKpiShape(domainResult = {}) {
  const hasValue =
    domainResult.count !== undefined ||
    domainResult.value !== undefined ||
    domainResult.metric !== undefined ||
    domainResult.answer !== undefined;
  const hasSupport =
    domainResult.unit !== undefined ||
    domainResult.source !== undefined ||
    Array.isArray(domainResult.sources) ||
    domainResult.asOf !== undefined ||
    domainResult.timestamp !== undefined;
  return hasValue && hasSupport;
}

function hasDecisionShape(domainResult = {}) {
  if (
    Array.isArray(domainResult.forbiddenAssumptions) &&
    domainResult.forbiddenAssumptions.length
  ) {
    return true;
  }
  if (domainResult.decisionStatus || domainResult.expectedStatus) return true;
  return /blocked|decision/i.test(String(domainResult.status || ''));
}

function hasComparisonShape(domainResult = {}) {
  return ['items', 'rows', 'peers', 'variants'].some(
    (key) => Array.isArray(domainResult[key]) && domainResult[key].length > 1
  );
}

function hasRiskShape(domainResult = {}) {
  return (
    (Array.isArray(domainResult.assetRisks) && domainResult.assetRisks.length > 0) ||
    (Array.isArray(domainResult.risks) && domainResult.risks.length > 0)
  );
}

function evidenceGapIds(evidencePlan = null, domainResult = {}) {
  const gaps = [
    ...(Array.isArray(evidencePlan?.gaps) ? evidencePlan.gaps : []),
    ...(Array.isArray(domainResult?.evidenceGaps) ? domainResult.evidenceGaps : []),
  ];
  return unique(gaps.map((gap) => gap?.id || gap?.sourceId || gap?.name || gap?.label || null));
}

function inferAllowedPresentationTypes({
  domainResult = {},
  sourceActions = [],
  evidencePlan = null,
} = {}) {
  const allowed = ['debug_summary'];
  const actions = sourceActions.map((action) => String(action).toLowerCase());
  const hasVdmiAction = actions.some((action) => action.includes('vdmi'));

  if (evidenceGapIds(evidencePlan, domainResult).length > 0) allowed.push('evidence_gap_table');
  if (hasKpiShape(domainResult)) allowed.push('kpi_fact');
  if (hasDecisionShape(domainResult)) allowed.push('decision_brief');
  if (hasRiskShape(domainResult)) allowed.push('risk_table');
  if (hasComparisonShape(domainResult)) allowed.push('comparison_table');
  if (hasVdmiShape(domainResult) && (hasVdmiAction || sourceActions.length === 0)) {
    allowed.push('vdmi_matrix_table');
  }

  return unique(allowed);
}

function evaluatePresentationGrounding({
  requestedType = null,
  selectedType = null,
  domainResult = {},
  sourceActions = [],
  evidencePlan = null,
  allowedTypes = null,
} = {}) {
  const normalizedRequested = normalizeType(requestedType);
  const normalizedSelected = normalizeType(selectedType);
  const inferredAllowed =
    Array.isArray(allowedTypes) && allowedTypes.length > 0
      ? unique(allowedTypes.map(normalizeType))
      : inferAllowedPresentationTypes({ domainResult, sourceActions, evidencePlan });
  const gaps = evidenceGapIds(evidencePlan, domainResult);
  let blockedReason = null;

  if (normalizedRequested && !inferredAllowed.includes(normalizedRequested)) {
    blockedReason = `requested_renderer_not_grounded:${normalizedRequested}`;
  } else if (normalizedSelected && !inferredAllowed.includes(normalizedSelected)) {
    blockedReason = `selected_renderer_not_grounded:${normalizedSelected}`;
  }

  return {
    selectedType: normalizedSelected,
    allowedTypes: inferredAllowed,
    blockedReason,
    sourceActions: unique(sourceActions.map(String)),
    evidenceGapIds: gaps,
    basis: {
      hasDomainResult: Boolean(domainResult && Object.keys(domainResult).length > 0),
      hasVdmiShape: hasVdmiShape(domainResult),
      hasKpiShape: hasKpiShape(domainResult),
      hasEvidenceGaps: gaps.length > 0,
    },
  };
}

module.exports = {
  extractSourceActions,
  inferAllowedPresentationTypes,
  evaluatePresentationGrounding,
};
