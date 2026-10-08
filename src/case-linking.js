'use strict';

const fs = require('node:fs');
const { deny } = require('./domain-router-policy');

// Types and comparison rules are deployment data, never a domain vocabulary.
function normalizeIdentifiers(entries = [], types = {}) {
  if (!Array.isArray(entries) || entries.length > 20) deny('Invalid typed identifiers');
  const result = new Map();
  for (const entry of entries) {
    const kind = entry?.kind || entry?.type;
    if (typeof kind !== 'string' || typeof entry.value !== 'string')
      deny('Invalid typed identifier');
    const type = kind.normalize('NFKC').trim().toLowerCase();
    const rules = types[type] || {};
    let value = entry.value.normalize('NFKC').trim();
    if (rules.stripWhitespace) value = value.replace(/\s+/gu, '');
    if (rules.caseFold) value = value.toLowerCase();
    if (!type || type.length > 100 || !value || value.length > 256)
      deny('Invalid typed identifier');
    result.set(JSON.stringify([type, value]), { kind: type, value });
  }
  return [...result.values()];
}

function matchingIdentifiers(source, target) {
  const keys = new Set((target.typedIdentifiers || []).map((id) => JSON.stringify(id)));
  return (source.typedIdentifiers || []).filter((id) => keys.has(JSON.stringify(id)));
}

function tenantCasePolicy(tenantId, registryFile) {
  const tenants = fs.existsSync(registryFile)
    ? JSON.parse(fs.readFileSync(registryFile, 'utf8'))
    : [];
  const policy = tenants.find((tenant) => tenant.tenantId === tenantId)?.sharedService || {};
  const caseVisibility = policy.caseVisibility ?? 'own';
  if (!['own', 'team', 'tenant'].includes(caseVisibility)) deny('Invalid case visibility');
  return { caseVisibility, identifierTypes: policy.identifierTypes || {} };
}

function rawContentAllowed(p, state) {
  return (
    state.actorId === p.actorId ||
    state.participantActorIds?.includes(p.actorId) ||
    state.sharedWithRoles?.some((role) => p.roles.includes(role))
  );
}

function caseSummary(state) {
  const situation = state.knownContext?.situation || {};
  return {
    caseId: state.cetCaseId,
    cetCaseId: state.cetCaseId,
    summary: String(situation.situation || situation.concern || '').slice(0, 600),
    status: state.lastClassification?.readinessState || 'unknown',
    responsible: [state.actorId],
    identifiers: state.typedIdentifiers || [],
  };
}

function identifierQueryMatches(state, query, types = {}) {
  const text = String(query || '').normalize('NFKC');
  return (state.typedIdentifiers || []).some(({ kind, value }) => {
    const rules = types[kind] || {};
    const comparable = rules.caseFold ? text.toLowerCase() : text;
    const slash = String.fromCharCode(92);
    const escaped = [...value]
      .map((character) =>
        '.*+?^${}()|[]'.includes(character) || character === slash ? slash + character : character
      )
      .join(rules.stripWhitespace ? slash + 's*' : '');
    for (const match of comparable.matchAll(new RegExp(escaped, 'gu'))) {
      const before = comparable[match.index - 1] || '';
      const afterIndex = match.index + match[0].length;
      const after = comparable[afterIndex] || '';
      // Complete references, including values containing whitespace or punctuation.
      // A typed prefix must match; it cannot be ignored as an untyped reference.
      if (before === ':') {
        const prefix = comparable.slice(0, match.index - 1).match(/(?:^|\s)([^\s:]+)$/u)?.[1];
        if (prefix?.normalize('NFKC').toLowerCase() !== kind) continue;
      } else if (/[\p{L}\p{N}_:./-]/u.test(before)) continue;
      const sentenceEnd =
        after === '.' && (!comparable[afterIndex + 1] || /\s/u.test(comparable[afterIndex + 1]));
      if (/[\p{L}\p{N}_:./-]/u.test(after) && !sentenceEnd) continue;
      return true;
    }
    return false;
  });
}

function relatedCaseSentence(items) {
  return items
    .filter((item) => item.relationshipType === 'same_subject')
    .map(
      (item) =>
        `Zu dieser Kennung gibt es bereits Fall ${item.displayRef || item.cetCaseId} von ${item.responsible.join(', ')}: ${item.status}.`
    )
    .join(' ');
}

module.exports = {
  normalizeIdentifiers,
  matchingIdentifiers,
  tenantCasePolicy,
  rawContentAllowed,
  caseSummary,
  identifierQueryMatches,
  relatedCaseSentence,
};
