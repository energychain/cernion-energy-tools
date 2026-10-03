'use strict';

const { execFileSync } = require('child_process');
const { capabilityText, textHash, cosine } = require('../scripts/function-model-embeddings');
const { updateEmbeddingCache } = require('../scripts/generate-function-model-embeddings');
const {
  projectFunctionModel,
  DEFAULT_PARAMETERS,
} = require('../scripts/function-model-projection');
const { renderReport } = require('../scripts/generate-function-model');
const { resolveFunctionId } = require('../src/function-model');
const capabilities = ['a', 'b', 'c'].map((capability) => ({
  capability,
  preferredActions: [`svc-${capability}.read`],
}));
const operations = capabilities.map((cap) => ({
  action: cap.preferredActions[0],
  service: `svc-${cap.capability}`,
  summary: `summary ${cap.capability}`,
}));
const entry = (cap, vector) => ({
  textHash: textHash(capabilityText(cap, operations)),
  provider: 'fixture',
  model: 'v1',
  dimension: vector.length,
  vector,
});
const cache = (
  vectors = [
    [1, 0],
    [1, 0],
    [0, 1],
  ]
) => ({
  entries: Object.fromEntries(
    capabilities.map((cap, index) => [cap.capability, entry(cap, vectors[index])])
  ),
});
const project = (extra = {}) =>
  projectFunctionModel({ capabilities, operations, embeddingCache: cache(), ...extra });

test('AC-02: versioned text includes all requested catalog fields and canonical ordering', () => {
  const cap = {
    capability: 'neutral_item',
    domain: 'Domain_A',
    preferredActions: ['svc-a.read'],
    keywords: ['z', 'a'],
    requiredInputs: [{ name: 'input', description: 'detail' }],
    risksAndNotes: ['note'],
    abstractionLevel: 'level_a',
    routingPattern: 'route_a',
  };
  const text = JSON.parse(
    capabilityText(cap, operations, [{ id: 'domain-a', description: 'description' }])
  );
  expect(text).toMatchObject({
    version: '1',
    capability: 'neutral item',
    keywords: ['a', 'z'],
    risksAndNotes: ['note'],
    abstractionLevel: 'level a',
    routingPattern: 'route a',
    summaries: ['summary a'],
    descriptions: ['description'],
  });
  expect(text.requiredInputs[0]).toContain('detail');
  expect(capabilityText(cap, operations)).toBe(
    capabilityText({ ...cap, keywords: ['a', 'z'] }, [...operations].reverse())
  );
});

test('AC-02: incremental generation, rounding, metadata and model switch', async () => {
  const client = {
    embeddingConfiguration: () => ({ provider: 'fixture', model: 'v1' }),
    embeddings: jest.fn(async () => [[1, 0.123456]]),
  };
  const parameters = DEFAULT_PARAMETERS;
  const first = await updateEmbeddingCache({ capabilities, operations, client, parameters });
  expect(client.embeddings).toHaveBeenCalledTimes(3);
  expect(first.entries.a).toMatchObject({
    provider: 'fixture',
    model: 'v1',
    dimension: 2,
    vector: [1, 0.1235],
  });
  client.embeddings.mockClear();
  expect(
    await updateEmbeddingCache({ capabilities, operations, client, parameters, cache: first })
  ).toEqual(first);
  expect(client.embeddings).not.toHaveBeenCalled();
  await updateEmbeddingCache({
    capabilities: capabilities.map((cap, index) =>
      index ? cap : { ...cap, keywords: ['changed'] }
    ),
    operations,
    client,
    parameters,
    cache: first,
  });
  expect(client.embeddings).toHaveBeenCalledTimes(1);
  client.embeddings.mockClear();
  client.embeddingConfiguration = () => ({ provider: 'fixture', model: 'v2' });
  await updateEmbeddingCache({ capabilities, operations, client, parameters, cache: first });
  expect(client.embeddings).toHaveBeenCalledTimes(3);
});

test('AC-03: similar unconnected capabilities merge, orthogonal vectors stay separate; report and lineage', () => {
  const previousModel = project({ embeddingCache: {} });
  const model = project({ previousModel });
  expect(model.functions).toHaveLength(2);
  expect(model.functions.find((fn) => fn.capabilities.includes('a')).capabilities).toEqual([
    'a',
    'b',
  ]);
  expect(model.semanticOnlyMerges).toEqual([{ capabilities: ['a', 'b'], similarity: 1 }]);
  expect(renderReport(model)).toContain('Zusammenführungen ohne strukturelle Evidenz');
  expect(renderReport(model)).toContain('a ↔ b; similarity=1.000000');
  for (const fn of previousModel.functions)
    expect(resolveFunctionId(fn.functionId, { model }).length).toBeGreaterThan(0);
  expect(
    project({
      embeddingCache: cache([
        [1, 0],
        [0, 1],
        [-1, 0],
      ]),
    }).functions
  ).toHaveLength(3);
});

test('AC-04: one semantic signal stays below minWeight and is capped even at high weight', () => {
  const model = project({
    parameters: { ...DEFAULT_PARAMETERS, mergeSimilarity: 1.01, semanticNeighborWeight: 100 },
  });
  const edge = model.functions[0].neighbors[0];
  expect(edge.evidence).toEqual([
    {
      kind: 'semantic',
      ref: 'semantic',
      similarity: 1,
      weight: DEFAULT_PARAMETERS.maxEvidenceContribution,
    },
  ]);
  expect(edge.weight).toBeLessThan(model.parameters.minWeight);
  expect(model.statistics.edgeCount).toBe(0);
});

test('AC-06: missing, stale, invalid and incompatible vectors are skipped without aborting', () => {
  const embeddingCache = cache();
  delete embeddingCache.entries.a;
  embeddingCache.entries.b.textHash = 'stale';
  embeddingCache.entries.c.vector = [0, 0];
  expect(project({ embeddingCache }).gaps.embeddingCacheEntries).toEqual([
    { capability: 'a', reason: 'missing' },
    { capability: 'b', reason: 'stale' },
    { capability: 'c', reason: 'invalid' },
  ]);
  expect(
    cosine(entry(capabilities[0], [1, 0]), { ...entry(capabilities[1], [1, 0]), model: 'other' })
  ).toBeNull();
});

test('AC-07: input order and repeated projection are byte-identical', () => {
  const first = project();
  expect(JSON.stringify(first)).toBe(JSON.stringify(project()));
  expect(
    project({ capabilities: [...capabilities].reverse(), operations: [...operations].reverse() })
  ).toEqual(first);
});

test('AC-01: real generate and check paths reject LLM imports and networking', () => {
  const script = `const Module = require('module'); const load = Module._load; Module._load = function(name, ...args) { if (/llm-client|adapters\\//.test(name)) throw new Error('LLM blocked'); return load.call(this, name, ...args); }; global.fetch = () => { throw new Error('Network blocked'); }; for (const name of ['http','https','net','tls']) { const module = require(name); for (const method of ['request','get','connect','createConnection']) if (module[method]) module[method] = () => { throw new Error('Network blocked'); }; } const g = require('./scripts/generate-function-model'); const model = g.buildFunctionModel(); if (g.writeOrCheck(model,{check:true}).length) throw new Error('Stale'); process.stdout.write(model.sourceHash);`;
  const options = { cwd: require('path').join(__dirname, '..'), encoding: 'utf8', timeout: 30000 };
  expect(execFileSync(process.execPath, ['-e', script], options)).toMatch(/^[a-f0-9]{64}$/);
});

test('semantic corroboration can lift structural evidence above minWeight', () => {
  const changedOperations = operations.map((op, index) => ({
    ...op,
    dataSources: index < 2 ? ['ref-a'] : [],
  }));
  const embeddingCache = {
    entries: Object.fromEntries(
      capabilities.map((cap, index) => [
        cap.capability,
        {
          ...entry(cap, index < 2 ? [1, 0] : [0, 1]),
          textHash: textHash(capabilityText(cap, changedOperations)),
        },
      ])
    ),
  };
  const model = project({
    operations: changedOperations,
    embeddingCache,
    parameters: { ...DEFAULT_PARAMETERS, mergeSimilarity: 1.01 },
  });
  const edge = model.functions[0].neighbors[0];
  expect(edge.weight).toBeGreaterThanOrEqual(model.parameters.minWeight);
  expect(edge.evidence.map((item) => item.kind)).toEqual(['shared', 'semantic']);
});

test('semantic complete linkage cannot bridge orthogonal endpoints', () => {
  const model = project({
    embeddingCache: cache([
      [1, 0],
      [1, 1],
      [0, 1],
    ]),
    parameters: {
      ...DEFAULT_PARAMETERS,
      semanticSimilarityThreshold: 0.7,
      semanticGroupingWeight: 0.9,
    },
  });
  expect(model.functions).toHaveLength(2);
  expect(
    model.functions.every((fn) => !(fn.capabilities.includes('a') && fn.capabilities.includes('c')))
  ).toBe(true);
});

test('facade resolves effective configured embedding model, including local provider', () => {
  const previousProvider = process.env.LLM_PROVIDER;
  const previousModel = process.env.LLM_EMBEDDING_MODEL;
  try {
    process.env.LLM_EMBEDDING_MODEL = 'fixture-model';
    for (const provider of ['gemini', 'openai-compat', 'ollama']) {
      process.env.LLM_PROVIDER = provider;
      expect(require('../src/llm-client').embeddingConfiguration()).toEqual({
        provider,
        model: 'fixture-model',
      });
    }
  } finally {
    if (previousProvider === undefined) delete process.env.LLM_PROVIDER;
    else process.env.LLM_PROVIDER = previousProvider;
    if (previousModel === undefined) delete process.env.LLM_EMBEDDING_MODEL;
    else process.env.LLM_EMBEDDING_MODEL = previousModel;
  }
});

test('all real historical IDs remain resolvable after semantic grouping', () => {
  const model = require('../scripts/generate-function-model').buildFunctionModel();
  for (const previous of model.lineageHistory)
    expect(resolveFunctionId(previous.functionId, { model }).length).toBeGreaterThan(0);
});
