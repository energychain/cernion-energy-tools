'use strict';

const GRAMMAR_PARTS = Object.freeze(['vorgang', 'quellen', 'pruefung', 'unsicherheit', 'freigabe']);
const GRANULARITAET_VALUES = Object.freeze(['aggregat', 'einzeldatensatz']);
const FORBIDDEN_USER_TEXT_PATTERNS = Object.freeze([
  /\bLaufkarte\b/i,
  /\bSchnittplan\b/i,
  /\bSituationsschl(?:ü|ue)ssel\b/i,
  /\bVertragsdeklaration\b/i,
  /\bPr(?:ä|ae)sentationsvertrag\b/i,
  /\bRender-Gate\b/i,
  /zur Kenntnis genommen/i,
  /\bNext Best Action\b/i,
]);

function isPlainObject(value) {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

function assertGranularitaet(statement) {
  const value = statement?.granularitaet;
  if (!GRANULARITAET_VALUES.includes(value)) {
    throw new Error('Statement must declare granularitaet as aggregat or einzeldatensatz.');
  }
  return value;
}

function validateGrammarParts(parts) {
  if (!Array.isArray(parts) || parts.length !== GRAMMAR_PARTS.length) {
    throw new Error('Presentation contract must contain exactly five grammar parts.');
  }

  for (let index = 0; index < GRAMMAR_PARTS.length; index += 1) {
    if (parts[index] !== GRAMMAR_PARTS[index]) {
      throw new Error('Presentation contract must keep the five grammar parts in fixed order.');
    }
  }

  return [...parts];
}

function validateStatement(statement) {
  if (!isPlainObject(statement)) throw new Error('Statement must be an object.');
  if (!statement.id) throw new Error('Statement must declare id.');
  if (!statement.label) throw new Error('Statement must declare label.');
  assertGranularitaet(statement);
  if (!isPlainObject(statement.source) || !statement.source.ref) {
    throw new Error('Statement must declare source.ref.');
  }
  if (statement.sicherheit === 'klaerung' && !statement.anschlussfrage) {
    throw new Error('Statement with klaerung must declare anschlussfrage.');
  }
  return statement;
}

function getBoundaryItems(element) {
  if (!isPlainObject(element)) return [];
  return Array.isArray(element.nichtHandlungen) ? element.nichtHandlungen : [];
}

function validateElement(element) {
  if (!isPlainObject(element)) throw new Error('Presentation element must be an object.');
  if (!element.elementId) throw new Error('Presentation element must declare elementId.');
  const boundaries = getBoundaryItems(element);
  if (boundaries.length === 0) {
    throw new Error('Presentation element must declare nichtHandlungen.');
  }
  for (const statement of element.statements || []) validateStatement(statement);
  return element;
}

function validatePresentationContract(contract) {
  if (!isPlainObject(contract)) throw new Error('Presentation contract must be an object.');
  validateGrammarParts(contract.grammarParts);
  const elements = Array.isArray(contract.elements) ? contract.elements : [];
  if (elements.length === 0) throw new Error('Presentation contract must declare elements.');
  elements.forEach(validateElement);
  return contract;
}

function toOperationResultRenderModel(result) {
  if (!isPlainObject(result)) throw new Error('Operation result must be an object.');

  if (result.projectionStatus === 'projected') {
    return {
      kind: 'projected',
      presentationContract: validatePresentationContract(result.presentationContract),
      usageLogRef: result.usageLogRef || null,
    };
  }

  if (result.projectionStatus === 'not_projected') {
    return {
      kind: 'not_projected_json',
      rawPayload: result.rawPayload,
      rawPayloadNotice:
        result.rawPayloadNotice ||
        'Dieses Ergebnis ist noch nicht in eine belegte Vorgangsdarstellung projiziert.',
      evidenceMarkers: [],
      usageLogRef: result.usageLogRef || null,
    };
  }

  throw new Error('Operation result must declare projectionStatus projected or not_projected.');
}

function canSwitchToRole(session, roleId) {
  const tenantId = session?.tenantId;
  return (session?.heldRoles || []).some(
    (role) => role?.roleId === roleId && (!role.tenantId || role.tenantId === tenantId)
  );
}

function formatVisibleNoAction(actor) {
  const name = actor?.displayName || actor?.name || actor?.id || 'andere Person';
  return `In Bearbeitung durch ${name}`;
}

function checkForbiddenUserText(text) {
  const value = String(text || '');
  const match = FORBIDDEN_USER_TEXT_PATTERNS.find((pattern) => pattern.test(value));
  if (match) {
    throw new Error(`Forbidden user-facing text matched: ${match}`);
  }
  return value;
}

function shouldMaterializeStatement(statement) {
  return assertGranularitaet(statement) === 'aggregat';
}

module.exports = {
  GRAMMAR_PARTS,
  GRANULARITAET_VALUES,
  assertGranularitaet,
  canSwitchToRole,
  checkForbiddenUserText,
  formatVisibleNoAction,
  getBoundaryItems,
  shouldMaterializeStatement,
  toOperationResultRenderModel,
  validateGrammarParts,
  validatePresentationContract,
  validateStatement,
};
