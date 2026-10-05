'use strict';

const { getFunctionModel } = require('./function-model');
const { compareCanonicalStrings } = require('./canonical-order');

function normalizePhrase(value) {
  return String(value || '')
    .replace(/([\p{Ll}\p{N}])([\p{Lu}])/gu, '$1 $2')
    .normalize('NFKD')
    .replace(/\p{M}/gu, '')
    .toLowerCase()
    .replace(/[^\p{L}\p{N}]+/gu, ' ')
    .trim();
}

const FIELDS = { label: 4, alias: 1, domain: 4, department: 4, keyword: 1 };
const indexes = new WeakMap();
const genericVocabulary = require('../scripts/domain-free-core.generic-vocabulary.json');
const genericExceptions = require('../scripts/domain-free-core.allowlist.json');
// The measured #713 reference terms and centrally reviewed generic exceptions share normalization.
const genericTerms = new Set(
  [
    ...genericVocabulary.terms,
    ...genericExceptions.entries.filter((entry) => entry.resolverGeneric === true),
  ].flatMap(({ term }) => normalizePhrase(term).split(' '))
);

function tokens(value) {
  return normalizePhrase(value)
    .split(' ')
    .filter((token) => token.length >= 1 && !genericTerms.has(token));
}

function texts(fn) {
  return [
    ['label', [fn.label]],
    ['alias', fn.aliases || []],
    ['domain', fn.domains || []],
    ['department', fn.departments || []],
    ['keyword', [...(fn.keywords || []), ...(fn.keywordTokens || [])]],
  ];
}

function indexModel(model) {
  if (indexes.has(model)) return indexes.get(model);
  const vocabulary = new Set(
    model.functions.flatMap((fn) => texts(fn).flatMap(([, values]) => values.flatMap(tokens)))
  );
  // Split compounds only using substrings present in the model itself.
  const split = (value) => {
    const result = new Set(tokens(value));
    for (const token of result)
      for (const part of vocabulary)
        if (part.length >= 5 && part.length < token.length && token.includes(part))
          result.add(part);
    return result;
  };
  const documents = model.functions.map((fn) => {
    const terms = new Map();
    for (const [kind, values] of texts(fn))
      for (const value of values)
        for (const term of split(value))
          if (!terms.has(term) || terms.get(term).weight < FIELDS[kind])
            terms.set(term, { weight: FIELDS[kind], kind });
    return { fn, terms };
  });
  const frequencies = new Map();
  for (const { terms } of documents)
    for (const term of terms.keys()) frequencies.set(term, (frequencies.get(term) || 0) + 1);
  const index = { documents, frequencies, split };
  indexes.set(model, index);
  return index;
}

function matchingTokens(query, terms, minPrefixLength) {
  return [...query]
    .map((token) =>
      [...terms.keys()]
        .filter(
          (term) =>
            term === token ||
            (Math.min(term.length, token.length) >= minPrefixLength &&
              (term.includes(token) || token.includes(term)))
        )
        .map((term) => ({
          term,
          similarity: Math.pow(
            Math.min(term.length, token.length) / Math.max(term.length, token.length),
            2
          ),
        }))
    )
    .filter((matches) => matches.length);
}

function scoreFunction(document, query, index, minPrefixLength) {
  let score = 0;
  let matchedBy = 'keyword';
  let strongest = 0;
  for (const matches of matchingTokens(query, document.terms, minPrefixLength)) {
    let best = 0;
    for (const { term, similarity } of matches) {
      const { weight, kind } = document.terms.get(term);
      const idf = Math.log(1 + index.documents.length / index.frequencies.get(term));
      best = Math.max(best, idf * weight * similarity);
      if (idf * weight * similarity > strongest) {
        strongest = idf * weight * similarity;
        matchedBy = kind;
      }
    }
    score += best;
  }
  return score
    ? { functionId: document.fn.functionId, label: document.fn.label, score, matchedBy }
    : null;
}

// IDs are opaque lineage identities, never semantic search terms.
function resolveFunctions(
  message,
  { model = getFunctionModel(), maxCandidates = 25, minScoreGap = 0.25, minPrefixLength = 5 } = {}
) {
  const index = indexModel(model);
  const query = new Set(tokens(String(message || '').replace(/\bfn-[\p{L}\p{N}_-]+/giu, '')));
  const matches = index.documents
    .map((doc) => scoreFunction(doc, query, index, minPrefixLength))
    .filter(Boolean);
  matches.sort((a, b) => b.score - a.score || compareCanonicalStrings(a.functionId, b.functionId));
  const top = matches[0]?.score || 0;
  const gap = top ? (top - (matches[1]?.score || 0)) / top : 0;
  const resolved = matches.length > 0 && gap >= minScoreGap;
  return {
    status: resolved ? 'resolved' : matches.length ? 'ambiguous' : 'none',
    matches: matches
      .slice(0, resolved ? 1 : maxCandidates)
      .map((match) => ({ ...match, confidence: match.score / top })),
    totalMatches: matches.length,
  };
}

module.exports = { resolveFunctions, normalizePhrase };
