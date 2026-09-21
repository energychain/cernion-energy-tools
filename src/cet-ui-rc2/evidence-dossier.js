'use strict';

const { validatePresentationContract } = require('./presentation-contract-validator');

function clone(value) {
  if (value === undefined) return undefined;
  if (typeof structuredClone === 'function') return structuredClone(value);
  return JSON.parse(JSON.stringify(value));
}

function assertObject(value, label) {
  if (value === null || typeof value !== 'object' || Array.isArray(value)) {
    throw new Error(`${label} must be an object`);
  }
}

function validateInteractionProjection(interactionProjection, statementIds) {
  assertObject(interactionProjection, 'interaction projection');
  if (interactionProjection.schemaVersion !== 'rc2.interaction-projection.v1') {
    throw new Error(
      'interaction projection must declare schemaVersion rc2.interaction-projection.v1'
    );
  }
  if (
    !Array.isArray(interactionProjection.statementRefs) ||
    interactionProjection.statementRefs.length === 0
  ) {
    throw new Error('interaction projection must declare statementRefs');
  }
  if (
    interactionProjection.statementRefs.some((ref) => typeof ref !== 'string' || ref.length === 0)
  ) {
    throw new Error('interaction projection statementRefs must be non-empty strings');
  }
  const expected = [...statementIds].sort();
  const actual = [...interactionProjection.statementRefs].sort();
  if (expected.length !== actual.length || expected.some((ref, index) => ref !== actual[index])) {
    throw new Error(
      'interaction projection statementRefs must match presentation contract statements'
    );
  }
}

function materializeAggregate(statement) {
  return {
    id: statement.id,
    label: statement.label,
    wert: clone(statement.wert),
    ...(statement.einheit ? { einheit: statement.einheit } : {}),
    granularitaet: 'aggregat',
    source: clone(statement.quelle),
    offlineRenderable: true,
  };
}

function hashRefNotice(statement) {
  return {
    id: statement.id,
    label: statement.label,
    granularitaet: 'einzeldatensatz',
    materialisierung: 'hash_ref_only',
    hashRef: clone(statement.hashRef),
    sourceRef: statement.quelle.ref,
    notice: 'nur_mit_quelle_reproduzierbar',
    offlineRenderable: false,
  };
}

function buildEvidenceDossier({
  presentationContract,
  interactionProjection,
  schnittplanVersion,
  frozenAt,
} = {}) {
  validatePresentationContract(presentationContract);
  const presentationStatementIds = presentationContract.aussagen.map((statement) => statement.id);
  validateInteractionProjection(interactionProjection, presentationStatementIds);
  if (!schnittplanVersion) throw new Error('evidence dossier requires schnittplanVersion');
  if (!frozenAt) throw new Error('evidence dossier requires frozenAt');

  const materializedStatements = [];
  const hashRefOnlyNotices = [];

  for (const statement of presentationContract.aussagen) {
    if (statement.granularitaet === 'aggregat') {
      materializedStatements.push(materializeAggregate(statement));
    } else if (statement.granularitaet === 'einzeldatensatz') {
      hashRefOnlyNotices.push(hashRefNotice(statement));
    }
  }

  return {
    schemaVersion: 'rc2.evidence-dossier.v1',
    frozenAt,
    presentationContractVersion: presentationContract.schemaVersion,
    interactionProjectionVersion: interactionProjection.schemaVersion,
    schnittplanVersion,
    title: presentationContract.titel,
    statementRefs: [...(interactionProjection.statementRefs || [])],
    materializedStatements,
    hashRefOnlyNotices,
    offlineStatus: {
      aggregateStatementsOfflineRenderable: materializedStatements.every(
        (statement) => statement.offlineRenderable === true
      ),
      hashRefOnlyRequiresSource: hashRefOnlyNotices.map((notice) => notice.id),
    },
    sourceRefs: [
      ...materializedStatements.map((statement) => statement.source.ref),
      ...hashRefOnlyNotices.map((notice) => notice.sourceRef),
    ],
  };
}

function isStringArray(values) {
  return (
    Array.isArray(values) && values.every((value) => typeof value === 'string' && value.length > 0)
  );
}

function isCompleteEvidenceDossier(value) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return false;
  return (
    value.schemaVersion === 'rc2.evidence-dossier.v1' &&
    typeof value.frozenAt === 'string' &&
    typeof value.presentationContractVersion === 'string' &&
    typeof value.interactionProjectionVersion === 'string' &&
    typeof value.schnittplanVersion === 'string' &&
    isStringArray(value.statementRefs) &&
    value.statementRefs.length > 0 &&
    Array.isArray(value.materializedStatements) &&
    value.materializedStatements.every(
      (statement) =>
        statement &&
        typeof statement.id === 'string' &&
        statement.granularitaet === 'aggregat' &&
        statement.source &&
        typeof statement.source.ref === 'string'
    ) &&
    Array.isArray(value.hashRefOnlyNotices) &&
    value.hashRefOnlyNotices.every(
      (notice) =>
        notice &&
        typeof notice.id === 'string' &&
        notice.materialisierung === 'hash_ref_only' &&
        typeof notice.sourceRef === 'string' &&
        notice.notice === 'nur_mit_quelle_reproduzierbar'
    ) &&
    isStringArray(value.sourceRefs) &&
    value.sourceRefs.length > 0 &&
    value.materializedStatements.length + value.hashRefOnlyNotices.length > 0 &&
    value.offlineStatus &&
    value.offlineStatus.aggregateStatementsOfflineRenderable === true &&
    isStringArray(value.offlineStatus.hashRefOnlyRequiresSource)
  );
}

module.exports = {
  buildEvidenceDossier,
  isCompleteEvidenceDossier,
};
