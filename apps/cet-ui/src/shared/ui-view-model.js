'use strict';

function buildDailySurfaceModel(surface) {
  const items = Array.isArray(surface.items) ? surface.items : [];
  return {
    route: surface.route || '/api/ui/v0/daily-surface',
    activeRoleId: surface.activeRoleId || null,
    cards: items.map((item) => ({
      id: item.caseId,
      title: item.title || item.caseId,
      attentionReason: item.aufmerksamkeitsgrund || null,
      roleEffect: item.rollenwirkung || null,
      nextContribution: item.interactionProjection?.naechsterBeitrag || null,
      status: item.status || item.interactionProjection?.naechsterBeitrag?.kind || 'offen',
      roleId: item.interactionProjection?.activeRoleId || surface.activeRoleId || null,
    })),
  };
}

function buildCaseViewModel(caseModel) {
  const presentationContract = caseModel.presentationContract || {};
  const statements = Array.isArray(presentationContract.aussagen)
    ? presentationContract.aussagen
    : [];
  const boundaries = Array.isArray(presentationContract.nichtHandlungen)
    ? presentationContract.nichtHandlungen
    : [];
  const interactionProjection = caseModel.interactionProjection || {};
  const criteria = interactionProjection.entscheidungsdistanz?.criteria || [];
  const visibleCriteria = criteria.filter((criterion) => criterion.state !== 'nicht_anwendbar');
  const collapsedCriteria = criteria
    .filter((criterion) => criterion.state === 'nicht_anwendbar')
    .map((criterion) => ({
      id: criterion.id || criterion.criterionId,
      label: criterion.label,
      state: 'nicht_anwendbar',
      collapsed: true,
    }));

  return {
    id: caseModel.caseId,
    title: caseModel.label || presentationContract.titel || caseModel.caseId,
    visibleStatus: caseModel.visibleStatus,
    primaryRoleId: caseModel.primaryRoleId || interactionProjection.activeRoleId || null,
    sections: [
      {
        id: 'vorgang',
        title: 'Vorgang',
        visibleStatus: caseModel.visibleStatus,
        nextContribution: interactionProjection.naechsterBeitrag || null,
      },
      {
        id: 'quellen',
        title: 'Quellen',
        statements: statements.map((statement) => ({
          id: statement.id,
          label: statement.label,
          source: statement.quelle || statement.source || null,
          granularitaet: statement.granularitaet,
        })),
      },
      {
        id: 'pruefung',
        title: 'Prüfung',
        statements,
      },
      {
        id: 'unsicherheit',
        title: 'Klärung offen',
        criteria: visibleCriteria,
        collapsedCriteria,
      },
      {
        id: 'freigabe',
        title: 'Freigabe',
        contribution: interactionProjection.naechsterBeitrag || null,
      },
    ],
    boundaries,
  };
}

function buildEvidenceViewModel(dossier) {
  const materializedStatements = Array.isArray(dossier.materializedStatements)
    ? dossier.materializedStatements
    : [];
  return {
    freezeStatus: dossier.frozenAt ? 'eingefroren' : 'nicht_eingefroren',
    approvals: Array.isArray(dossier.approvalRequests) ? dossier.approvalRequests : [],
    evidenceItems: materializedStatements.map((statement) => ({
      id: statement.id,
      label: statement.label,
      value: statement.wert,
      unit: statement.einheit,
      source: statement.source,
    })),
    hashRefOnlyNotices: Array.isArray(dossier.hashRefOnlyNotices) ? dossier.hashRefOnlyNotices : [],
  };
}

function buildOperationsConsoleModel({ operations, preparedResult }) {
  const available = Array.isArray(operations?.available)
    ? operations.available
    : Array.isArray(operations)
      ? operations
      : [];
  const isUnprojected = preparedResult?.projectionStatus === 'nicht_projiziert';
  return {
    operations: available,
    preparedResult: preparedResult
      ? {
          operationId: preparedResult.operationId,
          badge: isUnprojected ? 'Nicht projiziert' : 'Projiziert',
          raw: isUnprojected ? preparedResult.unprojected?.raw : null,
          evidenceMarkers: isUnprojected ? [] : preparedResult.presentationContract?.aussagen || [],
          audit: preparedResult.audit || null,
        }
      : null,
  };
}

module.exports = {
  buildDailySurfaceModel,
  buildCaseViewModel,
  buildEvidenceViewModel,
  buildOperationsConsoleModel,
};
