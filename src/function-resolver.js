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

function scoreFunction(fn, query) {
  let confidence = 0;
  let matchedBy;
  for (const [kind, values, score] of [
    ['label', [fn.label], 1],
    ['alias', fn.aliases || [], 0.95],
    ['keyword', fn.keywords || [], 0.7],
  ]) {
    for (const value of values) {
      if (typeof value !== 'string') continue;
      const term = normalizePhrase(value);
      if (term.length >= 3 && query.includes(` ${term} `) && score > confidence) {
        confidence = score;
        matchedBy = kind;
      }
    }
  }
  return confidence ? { functionId: fn.functionId, label: fn.label, confidence, matchedBy } : null;
}

// Function IDs are opaque lineage identities, never semantic search terms.
function resolveFunctions(message, { model = getFunctionModel(), maxCandidates = 5 } = {}) {
  const query = ` ${normalizePhrase(String(message || '').replace(/\bfn-[\p{L}\p{N}_-]+/giu, ''))} `;
  const matches = model.functions.map((fn) => scoreFunction(fn, query)).filter(Boolean);
  matches.sort(
    (a, b) => b.confidence - a.confidence || compareCanonicalStrings(a.functionId, b.functionId)
  );
  const best = matches.filter((match) => match.confidence === matches[0]?.confidence);
  return {
    status: best.length === 1 ? 'resolved' : best.length ? 'ambiguous' : 'none',
    matches: best.slice(0, maxCandidates),
    totalMatches: best.length,
  };
}

module.exports = { resolveFunctions, normalizePhrase };
