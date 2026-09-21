'use strict';

const { validatePresentationContract } = require('./presentation-contract-validator');

function clone(value) {
  if (typeof structuredClone === 'function') return structuredClone(value);
  return JSON.parse(JSON.stringify(value));
}

function assertObject(value, label) {
  if (value === null || typeof value !== 'object' || Array.isArray(value)) {
    throw new Error(`${label} must be an object`);
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
  assertObject(interactionProjection, 'interactionProjection');
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
    sourceRefs: materializedStatements.map((statement) => statement.source.ref),
  };
}

function isCompleteEvidenceDossier(value) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return false;
  return (
    value.schemaVersion === 'rc2.evidence-dossier.v1' &&
    typeof value.presentationContractVersion === 'string' &&
    typeof value.schnittplanVersion === 'string' &&
    Array.isArray(value.materializedStatements) &&
    Array.isArray(value.hashRefOnlyNotices) &&
    Boolean(value.offlineStatus)
  );
}

module.exports = {
  buildEvidenceDossier,
  isCompleteEvidenceDossier,
};
