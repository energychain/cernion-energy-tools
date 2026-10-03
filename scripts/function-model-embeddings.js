'use strict';

const crypto = require('crypto');
const { compareCanonicalStrings } = require('../src/canonical-order');
const TEXT_VERSION = '2';
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

function strings(value) {
  if (typeof value === 'string') return [value];
  if (Array.isArray(value)) return value.flatMap(strings);
  if (!value || typeof value !== 'object') return [];
  return Object.entries(value)
    .sort(([a], [b]) => compareCanonicalStrings(a, b))
    .flatMap(([, item]) => strings(item));
}

function sentences(value) {
  return String(value)
    .split(/(?<=[.!?;])\s+|\n+/u)
    .map((sentence) => (normalize(sentence).match(/[\p{L}\p{N}]+/gu) || []).join(' '))
    .filter(Boolean);
}

function textParts(capability, operations, semanticDomains) {
  const actions = new Set(capability.preferredActions || []);
  return ordered(
    [
      tokens(capability.capability),
      ...strings(capability.keywords),
      ...strings(capability.requiredInputs),
      ...strings(capability.risksAndNotes),
      ...operations
        .filter((op) => op.action && actions.has(op.action))
        .flatMap((op) => strings(op.summary)),
      ...semanticDomains
        .filter((domain) => normalize(domain.id) === normalize(capability.domain))
        .flatMap((domain) => strings(domain.description)),
    ].flatMap(sentences)
  );
}

function capabilityText(capability, operations = [], semanticDomains = [], filter = {}) {
  const parts = textParts(capability, operations, semanticDomains);
  return JSON.stringify([
    TEXT_VERSION,
    ...ordered(
      parts
        .filter((part) => !filter.sentences?.has(part))
        .map((part) =>
          part
            .split(' ')
            .filter((word) => !filter.tokens?.has(word))
            .join(' ')
        )
    ),
  ]);
}

function commonValues(population, fraction) {
  const counts = new Map();
  for (const values of population)
    for (const value of new Set(values)) counts.set(value, (counts.get(value) || 0) + 1);
  // A value occurring in only one capability is never recurring boilerplate.
  return new Set(
    [...counts]
      .filter(([, count]) => count > 1 && count / population.length > fraction)
      .map(([value]) => value)
  );
}

function buildEmbeddingTexts(capabilities, operations = [], semanticDomains = [], parameters = {}) {
  const fraction = parameters.embeddingBoilerplateMaxFraction ?? 0.2;
  if (!Number.isFinite(fraction) || fraction < 0 || fraction > 1)
    throw new Error('Invalid embedding boilerplate fraction');
  const parts = capabilities.map((cap) => textParts(cap, operations, semanticDomains));
  const filter = {
    sentences: commonValues(parts, fraction),
    tokens: commonValues(
      parts.map((items) => items.flatMap((part) => part.split(' '))),
      fraction
    ),
  };
  return new Map(
    [...capabilities]
      .sort((a, b) => compareCanonicalStrings(a.capability, b.capability))
      .map((cap) => [cap.capability, capabilityText(cap, operations, semanticDomains, filter)])
  );
}

function hasEmbeddingText(text) {
  return JSON.parse(text).length > 1;
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

function cacheEntryGap(text, entry) {
  if (!hasEmbeddingText(text)) return 'empty';
  if (!entry) return 'missing';
  if (entry.textHash !== textHash(text)) return 'stale';
  if (!validEntry(entry)) return 'invalid';
  return null;
}

function resolveEmbeddings(capabilities, operations, semanticDomains, cache = {}, parameters = {}) {
  const texts = buildEmbeddingTexts(capabilities, operations, semanticDomains, parameters);
  const entries = new Map();
  const gaps = [];
  for (const cap of [...capabilities].sort((a, b) =>
    compareCanonicalStrings(a.capability, b.capability)
  )) {
    const entry = cache.entries?.[cap.capability];
    const reason = cacheEntryGap(texts.get(cap.capability), entry);
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

function functionCoherence(ids, entries) {
  const values = [];
  for (let i = 0; i < ids.length; i++)
    for (let j = i + 1; j < ids.length; j++) {
      const value = cosine(entries.get(ids[i]), entries.get(ids[j]));
      if (value !== null) values.push(value);
    }
  return {
    meanSimilarity: values.length
      ? values.reduce((sum, value) => sum + value, 0) / values.length
      : null,
    minimumSimilarity: values.length ? Math.min(...values) : null,
    comparedPairs: values.length,
    possiblePairs: (ids.length * (ids.length - 1)) / 2,
  };
}

function median(values) {
  const sorted = values.slice().sort((a, b) => a - b);
  if (!sorted.length) return null;
  const middle = Math.floor(sorted.length / 2);
  return sorted.length % 2 ? sorted[middle] : (sorted[middle - 1] + sorted[middle]) / 2;
}

function summarizeCoherence(functions) {
  const complete = functions
    .map((fn) => fn.coherence)
    .filter((entry) => entry.possiblePairs > 0 && entry.comparedPairs === entry.possiblePairs);
  return {
    measuredFunctions: complete.length,
    minimumPairSimilarity: complete.length
      ? Math.min(...complete.map((entry) => entry.minimumSimilarity))
      : null,
    medianMinimumSimilarity: median(complete.map((entry) => entry.minimumSimilarity)),
    medianMeanSimilarity: median(complete.map((entry) => entry.meanSimilarity)),
  };
}

module.exports = {
  TEXT_VERSION,
  functionCoherence,
  summarizeCoherence,
  buildEmbeddingTexts,
  hasEmbeddingText,
  capabilityText,
  textHash,
  validEntry,
  resolveEmbeddings,
  cosine,
  semanticScore,
};
