'use strict';
const {
  rankCapabilities,
  calibratedConfidence,
  queryEmbedding,
  queryEmbeddingForTurn,
  keywordReport,
} = require('../src/capability-routing');
const { tokens, createCompoundTokenizer } = require('../src/function-resolver');
const model = { functions: [] };
const cap = (capability, keywords) => ({ capability, keywords, requiredInputs: [] });
const rank = (q, catalog, options = {}) => rankCapabilities(q, catalog, { model, ...options });

describe('calibrated capability routing #730', () => {
  test('rare phrases outrank a frequent single word; a hub does not imply confidence', () => {
    const catalog = Array.from({ length: 12 }, (_, i) => cap(`c${i}`, ['quartz']));
    catalog.push(cap('specific', ['quartz review']));
    expect(rank('quartz review', catalog).matches[0].capability.capability).toBe('specific');
    expect(rank('quartz', catalog).confidence).toBeLessThan(0.7);
    expect(keywordReport(catalog).length).toBe(12);
  });
  test('shares corpus-derived compound decomposition and accepts reordered nearby words', () => {
    const split = createCompoundTokenizer(new Set(tokens('amber basalt garnet')));
    expect(split('basaltamber')).toEqual(new Set(['basaltamber', 'amber', 'basalt']));
    const catalog = [cap('specific', ['garnet basalt']), cap('general', ['basalt'])];
    expect(rank('basaltamber review garnet', catalog).matches[0].capability.capability).toBe(
      'specific'
    );
    expect(rank('garnet ' + 'separate '.repeat(20) + 'basalt', [catalog[0]]).matches).toHaveLength(
      0
    );
  });
  test('full words carry more weight than substrings and phrases more than words', () => {
    const catalog = [cap('a', ['quartz']), cap('b', ['quartz review'])];
    const full = rank('quartz', catalog).matches[0].lexicalScore;
    const part = rank('quartzsource', catalog).matches[0].lexicalScore;
    expect(full).toBeGreaterThan(part);
    expect(rank('review quartz', catalog).matches[0].capability.capability).toBe('b');
  });
  test('confidence reflects evidence strength and runner-up margin', () => {
    expect(calibratedConfidence(0.1, 0)).toBeLessThan(0.7);
    expect(calibratedConfidence(5, 0)).toBeGreaterThan(calibratedConfidence(5, 4.9));
    expect(calibratedConfidence(0, 0)).toBe(0);
  });
  test('exact catalog identifiers disambiguate technical requests and remain configurable', () => {
    const catalog = [cap('quartz_review', ['quartz']), cap('other', ['quartz review'])];
    expect(rank('quartz-review.analyze', catalog).matches[0].capability.capability).toBe(
      'quartz_review'
    );
    expect(
      rank('quartz-review.analyze', catalog, { parameters: { identifierBonus: 0 } }).matches[0]
        .capability.capability
    ).toBe('other');
  });
  test('short word variants keep weaker evidence and bounded phrase locality', () => {
    const catalog = [cap('lookup', ['quartz code'])];
    expect(rank('Read quartz codes', catalog).matches[0].capability.capability).toBe('lookup');
    expect(rank('quartz ' + 'separate '.repeat(20) + 'codes', catalog).matches).toHaveLength(0);
    expect(rank('codes', [cap('lookup', ['code'])]).confidence).toBeLessThan(0.7);
  });
  test('domain bonus uses function domains/departments and exposes contradiction', () => {
    const catalog = [cap('a', ['quartz']), cap('b', ['quartz'])];
    const functions = [
      { capabilities: ['a'], domains: ['other'], departments: [] },
      { capabilities: ['b'], domains: [], departments: ['chosen'] },
    ];
    const result = rank('quartz', catalog, { model: { functions }, primaryDomain: 'chosen' });
    expect(result.matches[0].capability.capability).toBe('b');
    expect(result.matches[0].domainBonus).toBeGreaterThan(0);
    expect(result.matches[1].domainConflict).toBe(true);
    expect(
      rank('unmatched', catalog, { model: { functions }, primaryDomain: 'chosen' }).matches
    ).toEqual([]);
  });
  test('context alone cannot manufacture keyword relevance', () => {
    expect(
      rank('unmatched', [cap('a', ['quartz'])], { resolvedParams: { id: 1 } }).matches
    ).toEqual([]);
  });
  const entry = { provider: 'fixture', model: 'v1', dimension: 2, vector: [1, 0] };
  const entries = new Map([['a', entry]]);
  test('uses one facade call for all candidates and validates identity and vector dimension', async () => {
    const client = {
      embeddingConfiguration: () => entry,
      embeddings: jest.fn().mockResolvedValue([[1, 0]]),
    };
    const result = await queryEmbedding('quartz', entries, { client });
    expect(result.metadata.path).toBe('hybrid');
    expect(client.embeddings).toHaveBeenCalledTimes(1);
    expect(client.embeddings).toHaveBeenCalledWith(
      ['quartz'],
      expect.objectContaining({ model: 'v1', outputDimensionality: 2, maxRetries: 0 })
    );
    const ranked = rank('unmatched', [cap('a', ['quartz']), cap('b', ['review'])], {
      entries,
      vector: result.vector,
    });
    expect(ranked.matches[0].capability.capability).toBe('a');
    client.embeddings.mockResolvedValue([[1]]);
    expect((await queryEmbedding('quartz', entries, { client })).metadata.fallbackReason).toBe(
      'dimension_or_vector_mismatch'
    );
  });
  test('provider mismatch and provider failure fall back visibly without a required provider', async () => {
    const client = {
      embeddingConfiguration: () => ({ ...entry, model: 'other' }),
      embeddings: jest.fn(),
    };
    expect((await queryEmbedding('quartz', entries, { client })).metadata.fallbackReason).toBe(
      'provider_or_model_mismatch'
    );
    expect(client.embeddings).not.toHaveBeenCalled();
    client.embeddingConfiguration = () => entry;
    client.embeddings.mockRejectedValue(new Error('unavailable'));
    expect((await queryEmbedding('quartz', entries, { client })).metadata.path).toBe('lexical');
    expect((await queryEmbedding('quartz', new Map(), { client })).metadata.fallbackReason).toBe(
      'cache_unavailable'
    );
  });
  test('nested calls share one turn embedding and new turns get their own budget', async () => {
    const client = {
      embeddingConfiguration: () => entry,
      embeddings: jest.fn().mockResolvedValue([[1, 0]]),
    };
    const root = {};
    const context = { options: { parentCtx: root } };
    const results = await Promise.all([
      queryEmbeddingForTurn('quartz', entries, { client, context }),
      queryEmbeddingForTurn('quartz', entries, {
        client,
        context: { options: { parentCtx: root } },
      }),
    ]);
    expect(client.embeddings).toHaveBeenCalledTimes(1);
    expect(results[0]).toBe(results[1]);
    expect(
      (await queryEmbeddingForTurn('other', entries, { client, context })).metadata.fallbackReason
    ).toBe('turn_embedding_budget_exhausted');
    await queryEmbeddingForTurn('quartz', entries, { client, context: {} });
    expect(client.embeddings).toHaveBeenCalledTimes(2);
  });
  test('fixture vector identity mismatch is rejected', async () => {
    expect(
      (await queryEmbedding('quartz', entries, { vector: { ...entry, provider: 'other' } }))
        .metadata.path
    ).toBe('lexical');
  });
  test('catalog cleanup changes keywords only and creates no capabilities', () => {
    const crypto = require('crypto');
    const { nonKeywordFieldsHash } = require('./fixtures/capability-keyword-cleanup.json');
    const current = require('../src/capability-catalog').CURATED_CAPABILITIES;
    const hash = crypto
      .createHash('sha256')
      .update(JSON.stringify(current.map(({ keywords: _keywords, ...rest }) => rest)))
      .digest('hex');
    expect(hash).toBe(nonKeywordFieldsHash);
    expect(keywordReport(current)).toEqual([]);
  });
});
