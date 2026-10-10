'use strict';

const llm = require('./llm-client');
const { resolveFunctions } = require('./function-resolver');
const { getFunctionModel } = require('./function-model');
const { cosine } = require('../scripts/function-model-embeddings');
const { compareCanonicalStrings } = require('./canonical-order');

function combineScores(message, model, vector, options) {
  const words = resolveFunctions(message, {
    ...options,
    model,
    maxCandidates: model.functions.length,
    minScoreGap: 1.1,
  });
  const lexical = new Map(words.matches.map((match) => [match.functionId, match.confidence]));
  const wordWeight = options.wordWeight ?? 0.7;
  const vectorWeight = options.vectorWeight ?? 0.3;
  const matches = model.functions
    .map((fn) => {
      const missingCapabilities = fn.embedding?.missingCapabilities || [];
      const similarity = missingCapabilities.length ? null : cosine(fn.embedding, vector);
      const wordScore = lexical.get(fn.functionId) || 0;
      const score =
        similarity === null
          ? wordScore
          : (wordWeight * wordScore + vectorWeight * Math.max(0, similarity || 0)) /
            (wordWeight + vectorWeight);
      return {
        functionId: fn.functionId,
        label: fn.displayLabel || fn.label,
        score,
        wordScore,
        similarity,
        semanticPath: similarity === null ? 'lexical' : 'hybrid',
        ...(missingCapabilities.length
          ? { fallbackReason: 'capability_vectors_unavailable', missingCapabilities }
          : {}),
      };
    })
    .filter((match) => match.score > 0);
  matches.sort((a, b) => b.score - a.score || compareCanonicalStrings(a.functionId, b.functionId));
  const top = matches[0]?.score || 0;
  const gap = top ? (top - (matches[1]?.score || 0)) / top : 0;
  const resolved = top > 0 && gap >= (options.minScoreGap ?? 0.25);
  return {
    status: resolved ? 'resolved' : matches.length ? 'ambiguous' : 'none',
    matches: matches
      .slice(0, resolved ? 1 : (options.maxCandidates ?? model.functions.length))
      .map((match) => ({ ...match, confidence: match.score / top })),
    totalMatches: matches.length,
  };
}

async function resolveFunctionsHybrid(message, options = {}) {
  const model = options.model || getFunctionModel();
  const client = options.client || llm;
  const identity = model.functions.find((fn) => fn.embedding?.vector)?.embedding;
  let reason;
  let vector;
  try {
    if (!identity) throw new Error('cache_unavailable');
    const configured = client.embeddingConfiguration();
    if (configured.provider !== identity.provider || configured.model !== identity.model)
      throw new Error('provider_or_model_mismatch');
    if (options.dimension != null && options.dimension !== identity.dimension)
      throw new Error('dimension_mismatch');
    const values = await client.embeddings(
      [String(message || '').replace(/\bfn-[\p{L}\p{N}_-]+/giu, '')],
      {
        model: identity.model,
        outputDimensionality: identity.dimension,
        timeoutMs: options.timeoutMs ?? 3000,
        maxRetries: 1,
        tenantId: options.tenantId,
        broker: options.broker,
      }
    );
    vector = { ...identity, vector: values?.[0] };
    if (
      !Array.isArray(vector.vector) ||
      vector.vector.length !== identity.dimension ||
      !vector.vector.every(Number.isFinite) ||
      !vector.vector.some((value) => value !== 0)
    )
      throw new Error('dimension_or_vector_mismatch');
  } catch (error) {
    reason = [
      'cache_unavailable',
      'provider_or_model_mismatch',
      'dimension_mismatch',
      'dimension_or_vector_mismatch',
    ].includes(error.message)
      ? error.message
      : 'embedding_failed';
  }
  if (reason) {
    options.logger?.warn?.('System activity resolver: lexical fallback', { reason });
    return {
      ...resolveFunctions(message, { ...options, model }),
      metadata: { path: 'lexical', fallbackReason: reason },
    };
  }
  return {
    ...combineScores(message, model, vector, options),
    metadata: {
      path: 'hybrid',
      provider: identity.provider,
      model: identity.model,
      dimension: identity.dimension,
    },
  };
}

module.exports = { resolveFunctionsHybrid };
