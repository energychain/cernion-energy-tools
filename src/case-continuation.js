'use strict';

const kinds = require('./workbench-identifier-kinds.json');
const codes = require('./workbench-code-catalog.json');
const { isSensitiveField } = require('./prompt-scrubber');
const labels = require('./case-status-labels.json');

function strongIdentifiers(entries = [], types = {}) {
  return entries.filter(({ kind }) => {
    const key = kind.toLowerCase().replace(/[_\s-]/gu, '');
    if (isSensitiveField(kind) || kinds.nonReferenceKinds.includes(key)) return false;
    if (codes.types.some((item) => item.kind === kind)) return false;
    if (types[kind]?.strength === 'weak') return false;
    return types[kind]?.strength === 'strong' || !kinds.genericKinds.includes(key);
  });
}

function sameStrongSubject(source, target, types = {}, exact = false) {
  const left = strongIdentifiers(source, types);
  const right = strongIdentifiers(target, types);
  if (!left.length || !right.length || (exact && left.length !== right.length)) return false;
  return left.every((id) =>
    right.some((other) => id.kind === other.kind && id.value === other.value)
  );
}

function openCase(state) {
  return (
    !state.mergedInto &&
    !['discarded', 'closed', 'completed', 'resolved'].includes(state.disposition) &&
    !['closed', 'completed', 'resolved'].includes(state.status) &&
    !['closed', 'completed', 'resolved'].includes(state.lastClassification?.readinessState)
  );
}

function statusLabel(status) {
  return Object.hasOwn(labels, status) ? labels[status] : labels.unknown;
}

function readableCaseText(text) {
  const codes = Object.keys(labels).filter((key) => key.includes('_'));
  return String(text || '').replace(new RegExp(`\\b(?:${codes.join('|')})\\b`, 'gu'), statusLabel);
}

function caseLabel(item) {
  const summary = readableCaseText(item.summary || 'Vorgang ohne Kurzbeschreibung')
    .replace(/\s+/gu, ' ')
    .slice(0, 160);
  const creator = item.responsible?.length ? `; angelegt von ${item.responsible.join(', ')}` : '';
  return `${item.displayRef || item.cetCaseId} (${summary}; ${statusLabel(item.status)}${creator})`;
}

module.exports = {
  strongIdentifiers,
  sameStrongSubject,
  openCase,
  statusLabel,
  caseLabel,
  readableCaseText,
};
