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

function isNonEmptyString(value) {
  return typeof value === 'string' && value.length > 0;
}

function isStringArray(values) {
  return Array.isArray(values) && values.every(isNonEmptyString);
}

function sameStringSet(left, right) {
  if (!isStringArray(left) || !isStringArray(right) || left.length !== right.length) return false;
  const sortedLeft = [...left].sort();
  const sortedRight = [...right].sort();
  return sortedLeft.every((value, index) => value === sortedRight[index]);
}

function isMaterializedStatement(value) {
  return (
    value &&
    typeof value === 'object' &&
    !Array.isArray(value) &&
    isNonEmptyString(value.id) &&
    value.granularitaet === 'aggregat' &&
    value.source &&
    typeof value.source === 'object' &&
    !Array.isArray(value.source) &&
    isNonEmptyString(value.source.ref) &&
    value.offlineRenderable === true
  );
}

function isHashRefOnlyNotice(value) {
  return (
    value &&
    typeof value === 'object' &&
    !Array.isArray(value) &&
    isNonEmptyString(value.id) &&
    value.granularitaet === 'einzeldatensatz' &&
    value.materialisierung === 'hash_ref_only' &&
    value.hashRef &&
    typeof value.hashRef === 'object' &&
    !Array.isArray(value.hashRef) &&
    isNonEmptyString(value.hashRef.algorithmus) &&
    isNonEmptyString(value.hashRef.wert) &&
    isNonEmptyString(value.sourceRef) &&
    value.notice === 'nur_mit_quelle_reproduzierbar' &&
    value.offlineRenderable === false
  );
}

function isCompleteEvidenceDossier(value) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return false;
  if (
    value.schemaVersion !== 'rc2.evidence-dossier.v1' ||
    !isNonEmptyString(value.frozenAt) ||
    !isNonEmptyString(value.presentationContractVersion) ||
    !isNonEmptyString(value.interactionProjectionVersion) ||
    !isNonEmptyString(value.schnittplanVersion) ||
    !isStringArray(value.statementRefs) ||
    value.statementRefs.length === 0 ||
    !Array.isArray(value.materializedStatements) ||
    !Array.isArray(value.hashRefOnlyNotices) ||
    !isStringArray(value.sourceRefs) ||
    value.sourceRefs.length === 0 ||
    !value.offlineStatus ||
    typeof value.offlineStatus !== 'object' ||
    Array.isArray(value.offlineStatus) ||
    value.offlineStatus.aggregateStatementsOfflineRenderable !== true ||
    !isStringArray(value.offlineStatus.hashRefOnlyRequiresSource)
  ) {
    return false;
  }

  const evidenceIds = [
    ...value.materializedStatements.map((statement) => statement && statement.id),
    ...value.hashRefOnlyNotices.map((notice) => notice && notice.id),
  ];
  const sourceRefs = [
    ...value.materializedStatements.map(
      (statement) => statement && statement.source && statement.source.ref
    ),
    ...value.hashRefOnlyNotices.map((notice) => notice && notice.sourceRef),
  ];
  const hashRefOnlyIds = value.hashRefOnlyNotices.map((notice) => notice && notice.id);

  return (
    value.materializedStatements.length + value.hashRefOnlyNotices.length > 0 &&
    value.materializedStatements.every(isMaterializedStatement) &&
    value.hashRefOnlyNotices.every(isHashRefOnlyNotice) &&
    sameStringSet(value.statementRefs, evidenceIds) &&
    sameStringSet(value.sourceRefs, sourceRefs) &&
    sameStringSet(value.offlineStatus.hashRefOnlyRequiresSource, hashRefOnlyIds)
  );
}

module.exports = {
  buildEvidenceDossier,
  isCompleteEvidenceDossier,
};
