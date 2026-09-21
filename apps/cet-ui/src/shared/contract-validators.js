'use strict';

const GRAMMAR_PARTS = Object.freeze(['vorgang', 'quellen', 'pruefung', 'unsicherheit', 'freigabe']);
const GRANULARITAET_VALUES = Object.freeze(['aggregat', 'einzeldatensatz']);

function assertGranularitaet(statement) {
  if (!GRANULARITAET_VALUES.includes(statement?.granularitaet)) {
    throw new Error('statement must declare granularitaet');
  }
  return statement.granularitaet;
}

function validateStatement(statement) {
  if (!statement || typeof statement !== 'object' || Array.isArray(statement)) {
    throw new Error('statement must be an object');
  }
  if (!statement.id || !statement.label) throw new Error('statement requires id and label');
  assertGranularitaet(statement);
  if (!statement.source?.ref && !statement.quelle?.ref)
    throw new Error('statement requires source');
  return statement;
}

function getGrammarParts(contract) {
  const parts = contract?.grammarParts || GRAMMAR_PARTS;
  if (!Array.isArray(parts) || parts.length !== GRAMMAR_PARTS.length) {
    throw new Error('presentation contract grammar must contain five grammar parts');
  }
  parts.forEach((part, index) => {
    if (part !== GRAMMAR_PARTS[index])
      throw new Error('presentation contract grammar order invalid');
  });
  return parts;
}

function getBoundaryItems(element) {
  return Array.isArray(element?.nichtHandlungen) ? element.nichtHandlungen : [];
}

function getRenderableStatements(contract) {
  const elementStatements = (contract?.elements || []).flatMap(
    (element) => element.statements || []
  );
  const statementList = Array.isArray(contract?.aussagen) ? contract.aussagen : elementStatements;
  return statementList.filter((statement) => validateStatement(statement));
}

function validatePresentationContract(contract) {
  if (!contract || typeof contract !== 'object' || Array.isArray(contract)) {
    throw new Error('presentation contract must be an object');
  }
  getGrammarParts(contract);
  const elements = Array.isArray(contract.elements) ? contract.elements : [];
  if (elements.length > 0) {
    elements.forEach((element) => {
      if (getBoundaryItems(element).length === 0)
        throw new Error('element requires nichtHandlungen');
      (element.statements || []).forEach(validateStatement);
    });
  } else {
    getRenderableStatements(contract);
  }
  return contract;
}

module.exports = {
  assertGranularitaet,
  getBoundaryItems,
  getGrammarParts,
  getRenderableStatements,
  validatePresentationContract,
  validateStatement,
};
