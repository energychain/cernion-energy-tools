'use strict';

const { resolveFunctionsHybrid } = require('../src/function-resolver-hybrid');
const { functionEmbedding } = require('../scripts/function-model-embeddings');
const identity = { provider: 'fixture', model: 'same-model', dimension: 2 };
const model = {
  functions: [
    { functionId: 'fn-a', label: 'Shared label', embedding: { ...identity, vector: [1, 0] } },
    { functionId: 'fn-b', label: 'Shared label', embedding: { ...identity, vector: [0, 1] } },
  ],
};
function client(overrides = {}) {
  return {
    embeddingConfiguration: jest.fn(() => identity),
    embeddings: jest.fn().mockResolvedValue([[1, 0]]),
    ...overrides,
  };
}

test('offline normalized means are deterministic and report absent/incompatible entries', () => {
  const entries = new Map([
    ['a', { ...identity, vector: [1, 0] }],
    ['b', { ...identity, vector: [0, 1] }],
    ['c', { ...identity, model: 'other', vector: [1, 0] }],
  ]);
  const result = functionEmbedding(['a', 'b', 'c', 'missing'], entries);
  expect(result.vector[0]).toBeCloseTo(Math.SQRT1_2);
  expect(result.vector[1]).toBeCloseTo(Math.SQRT1_2);
  expect(result.missingCapabilities).toEqual(['c', 'missing']);
  expect(functionEmbedding(['missing'], entries)).toEqual({
    provider: null,
    model: null,
    dimension: null,
    vector: null,
    missingCapabilities: ['missing'],
  });
  expect(functionEmbedding(['a', 'b'], entries)).toEqual(functionEmbedding(['a', 'b'], entries));
});

test('one matching-model embedding separates lexical ties with configurable score weights', async () => {
  const provider = client();
  const result = await resolveFunctionsHybrid('Shared label', { model, client: provider });
  expect(result).toMatchObject({
    status: 'resolved',
    matches: [{ functionId: 'fn-a' }],
    metadata: { path: 'hybrid' },
  });
  expect(provider.embeddings).toHaveBeenCalledTimes(1);
  expect(provider.embeddings).toHaveBeenCalledWith(
    ['Shared label'],
    expect.objectContaining({ model: identity.model, outputDimensionality: 2, maxRetries: 1 })
  );
  expect(
    await resolveFunctionsHybrid('Shared label', { model, client: provider, vectorWeight: 0 })
  ).toMatchObject({ status: 'ambiguous' });
});

test.each([
  [
    'provider_or_model_mismatch',
    () => client({ embeddingConfiguration: () => ({ ...identity, provider: 'other' }) }),
  ],
  ['dimension_mismatch', () => client()],
  [
    'dimension_or_vector_mismatch',
    () => client({ embeddings: jest.fn().mockResolvedValue([[1, 0, 0]]) }),
  ],
  [
    'embedding_failed',
    () => client({ embeddings: jest.fn().mockRejectedValue(new Error('unavailable')) }),
  ],
])('falls back without provider calls or RAG as appropriate: %s', async (reason, create) => {
  const logger = { warn: jest.fn() };
  const provider = create();
  const result = await resolveFunctionsHybrid('Shared label', {
    model,
    client: provider,
    logger,
    ...(reason === 'dimension_mismatch' ? { dimension: 3 } : {}),
  });
  expect(result).toMatchObject({
    status: 'ambiguous',
    metadata: { path: 'lexical', fallbackReason: reason },
  });
  expect(logger.warn).toHaveBeenCalledWith(expect.any(String), { reason });
  if (reason === 'provider_or_model_mismatch' || reason === 'dimension_mismatch')
    expect(provider.embeddings).not.toHaveBeenCalled();
});

test('opaque lineage IDs are removed before embedding, not used as semantic text', async () => {
  const provider = client();
  await resolveFunctionsHybrid('Was macht FN-OLD-NAME gerade?', { model, client: provider });
  expect(provider.embeddings.mock.calls[0][0][0]).not.toMatch(/old|fn-/i);
});
