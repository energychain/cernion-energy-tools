'use strict';

const { tokens, normalizePhrase, createCompoundTokenizer } = require('./function-resolver');
const { compareCanonicalStrings } = require('./canonical-order');
const { getFunctionModel } = require('./function-model');
const { cosine, validEntry, resolveEmbeddings } = require('../scripts/function-model-embeddings');
const defaults = require('../capability-routing.parameters.json');
const indexes = new WeakMap();

// Also counts occurrences inside phrases/compounds: a standalone keyword can be a catalog hub
// even when most other capabilities use it only in a specific phrase.
function keywordReport(catalog, threshold = defaults.commonKeywordThreshold) {
  const keywords = [...new Set(catalog.flatMap((cap) => cap.keywords))];
  const frequencies = new Map(
    keywords.map((word) => [
      word,
      catalog.filter((cap) =>
        cap.keywords.some((phrase) => normalizePhrase(phrase).includes(normalizePhrase(word)))
      ).length,
    ])
  );
  return catalog
    .map((cap) => ({
      capability: cap.capability,
      keywords: cap.keywords
        .filter(
          (word) => !normalizePhrase(word).includes(' ') && frequencies.get(word) >= threshold
        )
        .map((keyword) => ({ keyword, frequency: frequencies.get(keyword) })),
    }))
    .filter((row) => row.keywords.length);
}

function indexCatalog(catalog) {
  if (indexes.has(catalog)) return indexes.get(catalog);
  const vocabulary = new Set(
    catalog.flatMap((cap) => cap.keywords.flatMap((word) => tokens(word, { includeGeneric: true })))
  );
  const split = createCompoundTokenizer(vocabulary, { includeGeneric: true });
  const documents = catalog.map((cap) => ({
    cap,
    phrases: [...new Set(cap.keywords.map(normalizePhrase))],
    terms: new Set(cap.keywords.flatMap((word) => [...split(word)])),
  }));
  const frequencies = new Map();
  for (const { terms } of documents)
    for (const term of terms) frequencies.set(term, (frequencies.get(term) || 0) + 1);
  const index = { documents, split, frequencies };
  indexes.set(catalog, index);
  return index;
}

function phraseMatch(phrase, query, parts, parameters) {
  const words = tokens(phrase, { includeGeneric: true });
  if (!words.length) return null;
  const positions = words.map((word) =>
    query.flatMap((token, i) => {
      if (token === word) return [{ i, weight: parameters.wordWeight, kind: 'word' }];
      if (word.length >= 4 && token.startsWith(word) && token.length <= word.length + 2)
        return [{ i, weight: parameters.partWeight, kind: 'word_variant' }];
      if (parts[i].has(word)) return [{ i, weight: parameters.partWeight, kind: 'compound' }];
      return [];
    })
  );
  if (positions.some((matches) => !matches.length)) return null;
  let best = null;
  // A bounded window allows reordered phrases while retaining locality. Different parts of a
  // compound may share a position; repetitions of the same word may not reuse that position.
  for (let start = 0; start < query.length; start++) {
    const used = new Set();
    const chosen = positions.map((matches, wordIndex) => {
      const match = matches.find(
        (m) =>
          m.i >= start &&
          m.i < start + parameters.phraseWindow &&
          !used.has(`${words[wordIndex]}:${m.i}`)
      );
      if (match) used.add(`${words[wordIndex]}:${match.i}`);
      return match;
    });
    if (chosen.some((m) => !m)) continue;
    const specificity = words.length > 1 ? parameters.phraseWeight : chosen[0].weight;
    if (!best || specificity > best.specificity)
      best = { specificity, kind: words.length > 1 ? 'phrase' : chosen[0].kind, words };
  }
  return best;
}

function calibratedConfidence(score, secondScore, parameters = defaults) {
  if (!Number.isFinite(score) || score <= 0) return 0;
  const gap = Math.max(0, (score - secondScore) / score);
  const strength = 1 - Math.exp(-score / parameters.confidenceScale);
  return Math.min(
    0.98,
    strength * (1 - parameters.confidenceGapWeight + parameters.confidenceGapWeight * gap)
  );
}

function rankCapabilities(message, catalog, options = {}) {
  const parameters = { ...defaults, ...options.parameters };
  const index = indexCatalog(catalog);
  const query = tokens(String(message || '').toLowerCase(), { includeGeneric: true });
  const parts = query.map((token) => index.split(token));
  const model = options.model || getFunctionModel();
  const domain = normalizePhrase(options.primaryDomain);
  const resolved = new Set(
    (options.resolvedCapabilities || []).map((item) =>
      typeof item === 'string' ? item : item.capability
    )
  );
  const matches = index.documents
    .map(({ cap, phrases }) => {
      const contributions = phrases
        .flatMap((keyword) => {
          const match = phraseMatch(keyword, query, parts, parameters);
          if (!match) return [];
          const frequency = Math.max(
            ...match.words.map((word) => index.frequencies.get(word) || 1)
          );
          const idf =
            match.words.reduce(
              (sum, word) =>
                sum + Math.log(1 + catalog.length / (index.frequencies.get(word) || 1)),
              0
            ) /
            match.words.length /
            Math.log(1 + catalog.length);
          const suppression =
            match.words.length === 1 && frequency >= parameters.commonKeywordThreshold
              ? parameters.commonWordWeight
              : 1;
          return [
            {
              keyword,
              kind: match.kind,
              frequency,
              idf,
              score: match.specificity * idf * suppression,
            },
          ];
        })
        .sort((a, b) => b.score - a.score || compareCanonicalStrings(a.keyword, b.keyword));
      const lexicalScore = contributions
        .slice(0, parameters.maxKeywordContributions)
        .reduce((sum, c) => sum + c.score, 0);
      const functions = model.functions.filter((fn) => fn.capabilities.includes(cap.capability));
      const domainMatch =
        !!domain &&
        functions.some((fn) =>
          [...(fn.domains || []), ...(fn.departments || [])].some(
            (value) => normalizePhrase(value) === domain
          )
        );
      const domainConflict = !!domain && functions.length > 0 && !domainMatch;
      const similarity = options.vector
        ? cosine(options.entries?.get(cap.capability), options.vector)
        : null;
      const semanticScore =
        similarity >= parameters.semanticThreshold ? similarity * parameters.semanticWeight : 0;
      const evidenceScore = lexicalScore + semanticScore;
      const domainBonus = evidenceScore > 0 && domainMatch ? parameters.domainBonus : 0;
      const requiredInputs = Array.isArray(cap.requiredInputs) ? cap.requiredInputs : [];
      const inputBonus =
        evidenceScore > 0
          ? requiredInputs.filter((key) => Object.hasOwn(options.resolvedParams || {}, key))
              .length * parameters.inputBonus
          : 0;
      const resolvedPenalty = resolved.has(cap.capability) ? parameters.resolvedPenalty : 0;
      const explicitRouteBonus =
        options.explicitCapability === cap.capability ? parameters.explicitRouteBonus : 0;
      const identifier = normalizePhrase(cap.capability);
      const identifierBonus =
        identifier.includes(' ') && ` ${normalizePhrase(message)} `.includes(` ${identifier} `)
          ? parameters.identifierBonus || 0
          : 0;
      const score =
        evidenceScore +
        domainBonus +
        inputBonus +
        explicitRouteBonus +
        identifierBonus -
        resolvedPenalty;
      return {
        capability: cap,
        score,
        lexicalScore,
        contributions,
        similarity,
        semanticScore,
        domainBonus,
        domainMatch,
        domainConflict,
        inputBonus,
        resolvedPenalty,
        explicitRouteBonus,
        identifierBonus,
      };
    })
    .filter((item) => item.score > 0);
  matches.sort(
    (a, b) =>
      b.score - a.score || compareCanonicalStrings(a.capability.capability, b.capability.capability)
  );
  const confidence = calibratedConfidence(matches[0]?.score, matches[1]?.score || 0, parameters);
  return {
    matches,
    confidence,
    uncertain: confidence < parameters.uncertaintyThreshold,
    margin: (matches[0]?.score || 0) - (matches[1]?.score || 0),
  };
}

let cachedEntries;
function capabilityEmbeddings(catalog) {
  if (!cachedEntries)
    cachedEntries = resolveEmbeddings(
      catalog,
      require('../operation-capability-index.json').operations,
      require('./semantic-domains').semanticDomains,
      require('../function-model.embeddings.json'),
      require('../function-model.parameters.json')
    );
  return cachedEntries;
}

// One request for the entire recommendation; never one request per candidate. Injected vectors
// use the same identity and dimensionality checks as provider output.
async function queryEmbedding(message, entries, options = {}) {
  const identity = [...entries.values()].find(validEntry);
  try {
    if (!identity) throw new Error('cache_unavailable');
    const client = options.client || require('./llm-client');
    const configured = options.vector || client.embeddingConfiguration();
    if (configured.provider !== identity.provider || configured.model !== identity.model)
      throw new Error('provider_or_model_mismatch');
    const vector = options.vector || {
      ...identity,
      vector: (
        await client.embeddings([message], {
          model: identity.model,
          outputDimensionality: identity.dimension,
          timeoutMs: defaults.embeddingTimeoutMs,
          maxRetries: 0,
          tenantId: options.tenantId,
          broker: options.broker,
        })
      )?.[0],
    };
    if (!validEntry(vector) || vector.dimension !== identity.dimension)
      throw new Error('dimension_or_vector_mismatch');
    return {
      vector,
      metadata: {
        path: 'hybrid',
        provider: vector.provider,
        model: vector.model,
        dimension: vector.dimension,
      },
    };
  } catch (error) {
    const reason = [
      'cache_unavailable',
      'provider_or_model_mismatch',
      'dimension_or_vector_mismatch',
    ].includes(error.message)
      ? error.message
      : 'embedding_failed';
    return { metadata: { path: 'lexical', fallbackReason: reason } };
  }
}

// Root Moleculer contexts are shared by nested calls and naturally released after a turn.
// Weak keys avoid a global request/vector cache and cross-turn or cross-tenant reuse.
const turnEmbeddings = new WeakMap();
function queryEmbeddingForTurn(message, entries, options = {}) {
  let root = options.context;
  while (root?.options?.parentCtx) root = root.options.parentCtx;
  if (!root) return queryEmbedding(message, entries, options);
  const previous = turnEmbeddings.get(root);
  if (previous) {
    if (previous.message === message) return previous.pending;
    return Promise.resolve({
      metadata: { path: 'lexical', fallbackReason: 'turn_embedding_budget_exhausted' },
    });
  }
  const pending = queryEmbedding(message, entries, options);
  turnEmbeddings.set(root, { message, pending });
  return pending;
}

module.exports = {
  rankCapabilities,
  calibratedConfidence,
  keywordReport,
  queryEmbedding,
  queryEmbeddingForTurn,
  capabilityEmbeddings,
};
