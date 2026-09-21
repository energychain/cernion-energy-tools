'use strict';

function validateGrammarParts(parts) {
  const allowed = new Set(['vorgang', 'quellen', 'pruefung', 'unsicherheit', 'freigabe']);
  return Array.isArray(parts) ? parts.filter((part) => allowed.has(part)) : [];
}

function getBoundaryItems(element) {
  return Array.isArray(element?.nichtHandlungen) ? element.nichtHandlungen : [];
}

function buildDailySurfaceModel(surface) {
  return {
    route: surface.route || '/api/ui/v0/daily',
    activeRoleId: surface.activeRoleId || null,
    sinceLastAccess: surface.sinceLastAccess || [],
    cards: (surface.vorgaenge || []).map((item) => ({
      id: item.vorgangId,
      title: item.label,
      status: item.status,
      roleId: item.primaryRoleId,
    })),
  };
}

function buildCaseViewModel(vorgang) {
  const grammarParts = validateGrammarParts(vorgang.presentationContract?.grammarParts || []);
  const elements = vorgang.presentationContract?.elements || [];
  return {
    id: vorgang.caseId,
    title: vorgang.label,
    status: vorgang.status,
    primaryRoleId: vorgang.primaryRoleId,
    visibleNoAction: vorgang.visibleNoAction,
    nextContribution: vorgang.nextContribution || null,
    decisionDistance: (vorgang.decisionDistance || []).map((criterion) => ({
      ...criterion,
      collapsed: criterion.state === 'nicht_anwendbar',
    })),
    sections: grammarParts.map((part) => ({
      id: part,
      elements,
    })),
    boundaries: elements.flatMap((element) => getBoundaryItems(element)),
  };
}

function buildEvidenceViewModel(evidence) {
  return {
    freezeStatus: evidence.freeze?.status || 'offen',
    approvals: evidence.approvalRequests || [],
    evidenceItems: (evidence.materializedStatements || []).map((statement) => ({
      id: statement.id,
      label: statement.label,
      value: statement.value,
      sourceRef: statement.source?.ref || null,
    })),
  };
}

function buildOperationsConsoleModel({ operations = [], preparedResult = null } = {}) {
  const view = {
    operations: operations.map((operation) => ({
      id: operation.id,
      label: operation.label,
      projectionStatus: operation.projectionStatus || 'unknown',
    })),
    preparedResult: null,
  };

  if (preparedResult?.kind === 'not_projected_json') {
    view.preparedResult = {
      badge: 'Nicht projiziert',
      rawPayload: preparedResult.rawPayload,
      notice: preparedResult.rawPayloadNotice,
      evidenceMarkers: [],
    };
  }

  return view;
}

module.exports = {
  buildCaseViewModel,
  buildDailySurfaceModel,
  buildEvidenceViewModel,
  buildOperationsConsoleModel,
};
