'use strict';

const FORBIDDEN_PATTERNS = Object.freeze([
  /\bZur Kenntnis\b/i,
  /\berledigt\b/i,
  /\bNext Best Action\b/i,
  /\bCET entscheidet\b/i,
]);

function checkForbiddenUserText(text) {
  const value = String(text || '');
  const forbidden = FORBIDDEN_PATTERNS.find((pattern) => pattern.test(value));
  if (forbidden) throw new Error(`Forbidden RC2 user wording: ${value}`);
  return value;
}

function formatVisibleNoAction({ displayName } = {}) {
  return checkForbiddenUserText(`In Bearbeitung durch ${displayName || 'zuständige Rolle'}`);
}

function formatApprovalStatus({ status, actor } = {}) {
  const actorName = actor?.displayName || actor?.label || actor?.id || 'Person oder Agent';
  if (status === 'erteilt') return checkForbiddenUserText(`Freigabe erteilt durch ${actorName}`);
  if (status === 'verweigert')
    return checkForbiddenUserText(`Freigabe verweigert durch ${actorName}`);
  if (status === 'angefordert') return 'Freigabe angefordert';
  if (status === 'erforderlich') return 'Freigabe erforderlich';
  if (status === 'nicht_erforderlich') return 'Freigabe nicht erforderlich';
  return 'Freigabestatus offen';
}

function labelProjectionStatus(status) {
  if (status === 'nicht_projiziert') return 'Nicht projiziert';
  if (status === 'projiziert') return 'Projiziert';
  return 'Projektionsstatus offen';
}

function labelAggregationState(state) {
  if (state === 'nachweisakte') return 'Nachweisakte';
  if (state === 'arbeitsstand') return 'Arbeitsstand';
  if (state === null || state === undefined) return 'Kein Aggregatzustand';
  return String(state);
}

function labelSourceClass(sourceClass) {
  if (sourceClass === 'system_of_record') return 'Quellsystem';
  if (sourceClass === 'abgeleitet') return 'Abgeleitet';
  if (sourceClass === 'manual') return 'Manuell';
  return sourceClass ? String(sourceClass) : 'Quelle offen';
}

module.exports = {
  checkForbiddenUserText,
  formatApprovalStatus,
  formatVisibleNoAction,
  labelAggregationState,
  labelProjectionStatus,
  labelSourceClass,
};
