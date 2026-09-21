'use strict';

const GRAMMAR_SECTIONS = Object.freeze([
  { id: 'vorgang', title: 'Vorgang' },
  { id: 'quellen', title: 'Quellen' },
  { id: 'pruefung', title: 'Prüfung' },
  { id: 'unsicherheit', title: 'Unsicherheit' },
  { id: 'freigabe', title: 'Freigabe' },
]);

function buildDailySurfaceModel(surface) {
  const items = Array.isArray(surface.items) ? surface.items : [];
  return {
    route: surface.route || '/api/ui/v0/daily-surface',
    activeRoleId: surface.activeRoleId || null,
    cards: items.map((item) => ({
      id: item.caseId,
      title: item.title,
      attentionReason: item.aufmerksamkeitsgrund || null,
      roleEffect: item.rollenwirkung || null,
      nextContribution: item.interactionProjection?.naechsterBeitrag || null,
      status: item.status || item.interactionProjection?.naechsterBeitrag?.kind || null,
      roleId: item.interactionProjection?.activeRoleId || surface.activeRoleId || null,
    })),
  };
}

function buildCaseViewModel(vorgang) {
  const statements = vorgang.presentationContract?.aussagen || [];
  return {
    id: vorgang.caseId,
    title: vorgang.label || vorgang.presentationContract?.titel,
    status: vorgang.visibleStatus,
    primaryRoleId: vorgang.primaryRoleId,
    visibleNoAction: vorgang.visibleStatus,
    nextContribution: vorgang.interactionProjection?.naechsterBeitrag || null,
    decisionDistance: (vorgang.interactionProjection?.entscheidungsdistanz?.criteria || []).map(
      (criterion) => ({
        ...criterion,
        collapsed: criterion.state === 'nicht_anwendbar',
      })
    ),
    sections: GRAMMAR_SECTIONS.map((section) => ({
      ...section,
      statements:
        section.id === 'vorgang' || section.id === 'quellen' || section.id === 'pruefung'
          ? statements
          : [],
    })),
    boundaries: vorgang.presentationContract?.nichtHandlungen || [],
  };
}

function buildEvidenceViewModel(evidence) {
  return {
    freezeStatus: evidence.frozenAt ? 'eingefroren' : 'offen',
    frozenAt: evidence.frozenAt || null,
    approvals: evidence.approvalRequests || [],
    evidenceItems: (evidence.materializedStatements || []).map((statement) => ({
      id: statement.id,
      label: statement.label,
      value: statement.wert,
      sourceRef: statement.source?.ref || null,
    })),
    hashRefOnlyNotices: (evidence.hashRefOnlyNotices || []).map((notice) => ({
      id: notice.id,
      label: notice.label,
      sourceRef: notice.sourceRef,
      notice: notice.notice,
    })),
  };
}

function buildOperationsConsoleModel({ operations = {}, preparedResult = null } = {}) {
  const available = Array.isArray(operations) ? operations : operations.available || [];
  const view = {
    operations: available.map((operation) => ({
      id: operation.id,
      label: operation.label,
      projectionStatus: operation.projectionStatus || operation.mode || 'unknown',
      riskClass: operation.riskClass || null,
    })),
    preparedResult: null,
  };

  if (preparedResult?.projectionStatus === 'nicht_projiziert') {
    view.preparedResult = {
      badge: 'Nicht projiziert',
      rawPayload: preparedResult.unprojected?.raw,
      notice: preparedResult.unprojected?.notice,
      evidenceMarkers: [],
      aggregationState: null,
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
