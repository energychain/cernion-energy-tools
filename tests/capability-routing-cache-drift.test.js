'use strict';
const { CURATED_CAPABILITIES } = require('../src/capability-catalog');
const { semanticDomains } = require('../src/semantic-domains');
const { resolveEmbeddings, functionEmbedding } = require('../scripts/function-model-embeddings');
const { resolveFunctionsHybrid } = require('../src/function-resolver-hybrid');
const { resolveFunctions } = require('../src/function-resolver');
const model = require('../function-model.json');
const cache = require('../function-model.embeddings.json');
const parameters = require('../function-model.parameters.json');
const resolved = resolveEmbeddings(
  CURATED_CAPABILITIES,
  require('../operation-capability-index.json').operations,
  semanticDomains,
  cache,
  parameters
);
const stale = resolved.gaps.filter((item) => item.reason === 'stale');

test('committed cache drift reports all 25 stale entries and excludes their vectors', () => {
  expect(stale).toHaveLength(25);
  expect(model.gaps.embeddingCacheEntries).toEqual(resolved.gaps);
  for (const { capability } of stale) {
    expect(cache.entries[capability]).toBeDefined();
    expect(resolved.entries.has(capability)).toBe(false);
    const fn = model.functions.find((row) => row.capabilities.includes(capability));
    const rebuilt = functionEmbedding(fn.capabilities, resolved.entries);
    expect(fn.embedding.vector).toEqual(rebuilt.vector);
    expect(fn.embedding.missingCapabilities).toContain(capability);
    expect(fn.embedding.staleCapabilities).toContain(capability);
  }
});
test.each(stale.map((item) => [item.capability]))(
  'hybrid lookup for stale %s visibly uses lexical evidence, never an old vector',
  async (capability) => {
    const fn = model.functions.find((row) => row.capabilities.includes(capability));
    const identity = model.functions.find((row) => row.embedding?.vector)?.embedding;
    const client = {
      embeddingConfiguration: () => identity,
      embeddings: jest.fn().mockResolvedValue([identity.vector]),
    };
    const hybrid = await resolveFunctionsHybrid(fn.displayLabel, {
      model,
      client,
      minScoreGap: 2,
      maxCandidates: model.functions.length,
    });
    const match = hybrid.matches.find((row) => row.functionId === fn.functionId);
    expect(match).toBeDefined();
    expect(match.semanticPath).toBe('lexical');
    expect(match.fallbackReason).toBe('capability_vectors_unavailable');
    expect(match.missingCapabilities).toContain(capability);
    expect(match.similarity).toBeNull();
    const lexical = resolveFunctions(fn.displayLabel, {
      model,
      maxCandidates: model.functions.length,
      minScoreGap: 2,
    });
    expect(match.score).toBeCloseTo(
      lexical.matches.find((row) => row.functionId === fn.functionId).confidence
    );
  }
);
