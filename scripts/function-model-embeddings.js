'use strict';

const crypto = require('crypto');
const { compareCanonicalStrings } = require('../src/canonical-order');
const TEXT_VERSION = '1';
const ordered = (values) => [...new Set(values.filter(Boolean))].sort(compareCanonicalStrings);
const tokens = (value) =>
  String(value || '')
    .replace(/([a-z])([A-Z])/g, '$1 $2')
    .replace(/[_./-]+/g, ' ')
    .trim();
const normalize = (value) =>
  tokens(value)
    .normalize('NFKD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/\s+/g, ' ');

function capabilityText(capability, operations = [], semanticDomains = []) {
  const actions = new Set(capability.preferredActions || []);
  return JSON.stringify({
    version: TEXT_VERSION,
    capability: tokens(capability.capability),
    keywords: ordered(capability.keywords || []),
    requiredInputs: [...(capability.requiredInputs || [])]
      .map((input) =>
        typeof input === 'string'
          ? input
          : JSON.stringify(
              Object.fromEntries(
                Object.entries(input).sort(([a], [b]) => compareCanonicalStrings(a, b))
              )
            )
      )
      .sort(compareCanonicalStrings),
    risksAndNotes: ordered(
      Array.isArray(capability.risksAndNotes)
        ? capability.risksAndNotes
        : [capability.risksAndNotes]
    ),
    abstractionLevel: tokens(capability.abstractionLevel),
    routingPattern: tokens(capability.routingPattern),
    summaries: ordered(
      operations.filter((op) => op.action && actions.has(op.action)).map((op) => op.summary)
    ),
    descriptions: ordered(
      semanticDomains
        .filter((domain) => normalize(domain.id) === normalize(capability.domain))
        .map((domain) => domain.description)
    ),
  });
}

function textHash(text) {
  return crypto.createHash('sha256').update(text).digest('hex');
}

function validEntry(entry) {
  return (
    !!entry &&
    typeof entry.provider === 'string' &&
    !!entry.provider &&
    typeof entry.model === 'string' &&
    !!entry.model &&
    Array.isArray(entry.vector) &&
    entry.dimension > 0 &&
    entry.dimension === entry.vector.length &&
    entry.vector.every(Number.isFinite) &&
    entry.vector.some((value) => value !== 0)
  );
}

function resolveEmbeddings(capabilities, operations, semanticDomains, cache = {}) {
  const entries = new Map();
  const gaps = [];
  for (const cap of [...capabilities].sort((a, b) =>
    compareCanonicalStrings(a.capability, b.capability)
  )) {
    const entry = cache.entries?.[cap.capability];
    const hash = textHash(capabilityText(cap, operations, semanticDomains));
    const reason = !entry
      ? 'missing'
      : entry.textHash !== hash
        ? 'stale'
        : !validEntry(entry)
          ? 'invalid'
          : null;
    if (reason) gaps.push({ capability: cap.capability, reason });
    else entries.set(cap.capability, entry);
  }
  return { entries, gaps };
}

function cosine(left, right) {
  if (
    !left ||
    !right ||
    left.provider !== right.provider ||
    left.model !== right.model ||
    left.dimension !== right.dimension
  )
    return null;
  let dot = 0;
  let a = 0;
  let b = 0;
  for (let i = 0; i < left.dimension; i++) {
    dot += left.vector[i] * right.vector[i];
    a += left.vector[i] ** 2;
    b += right.vector[i] ** 2;
  }
  return Math.max(-1, Math.min(1, dot / Math.sqrt(a * b)));
}

function semanticScore(leftIds, rightIds, entries, parameters) {
  // One signal per function pair: use the strongest comparable capability pair,
  // never sum correlated embeddings merely because a function has more members.
  let best = null;
  for (const left of leftIds)
    for (const right of rightIds) {
      const similarity = cosine(entries.get(left), entries.get(right));
      if (
        similarity !== null &&
        similarity >= parameters.semanticSimilarityThreshold &&
        (!best || similarity > best.similarity)
      )
        best = { left, right, similarity };
    }
  return best;
}

module.exports = {
  TEXT_VERSION,
  capabilityText,
  textHash,
  validEntry,
  resolveEmbeddings,
  cosine,
  semanticScore,
};
