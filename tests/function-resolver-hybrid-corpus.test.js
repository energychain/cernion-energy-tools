'use strict';

const { resolveFunctionsHybrid } = require('../src/function-resolver-hybrid');
const { getFunctionModel } = require('../src/function-model');
const { classifyWorkbenchIntent } = require('../src/workbench-intent-router');
const { corpus, regressions } = require('./helpers/system-activity-corpus');
const fixture = require('./fixtures/system-activity-question-embeddings.json');
const client = {
  embeddingConfiguration: () => ({ provider: fixture.provider, model: fixture.model }),
  embeddings: jest.fn(async ([question]) => {
    if (!fixture.entries[question]) throw new Error('Missing recorded question fixture');
    return [fixture.entries[question]];
  }),
};

test.each(regressions)(
  'hybrid natural regression with recorded embeddings: %s',
  async (question, functionId) => {
    expect(classifyWorkbenchIntent(question)).toBe('system_activity_query');
    const result = await resolveFunctionsHybrid(question, { client });
    expect(result.metadata.path).toBe('hybrid');
    if (!functionId) return;
    expect(result.matches.map((item) => item.functionId)).toContain(functionId);
    if (result.status === 'resolved') expect(result.matches[0].functionId).toBe(functionId);
  }
);

test('hybrid corpus uses the real capability cache and independently recorded same-model question vectors', async () => {
  const model = getFunctionModel();
  expect(
    model.functions.every(
      (fn) =>
        fn.embedding?.provider === fixture.provider &&
        fn.embedding.model === fixture.model &&
        fn.embedding.dimension === fixture.dimension
    )
  ).toBe(true);
  const metrics = { total: 0, modeHits: 0, resolved: 0, ambiguous: 0, wrong: 0, missing: 0 };
  for (const [question, functionId] of corpus()) {
    metrics.total++;
    metrics.modeHits += classifyWorkbenchIntent(question) === 'system_activity_query' ? 1 : 0;
    const result = await resolveFunctionsHybrid(question, { model, client });
    expect(result.metadata.path).toBe('hybrid');
    const correct = result.matches.some((item) => item.functionId === functionId);
    if (result.status === 'resolved') metrics[correct ? 'resolved' : 'wrong']++;
    else if (result.status === 'ambiguous' && correct) metrics.ambiguous++;
    else metrics.missing++;
  }
  process.stdout.write(
    `Hybrid natural language corpus (recorded real embeddings): ${JSON.stringify(metrics)}\n`
  );
  expect(metrics.modeHits).toBe(metrics.total);
  expect(metrics.wrong / metrics.total).toBeLessThanOrEqual(0.05);
  expect(metrics.resolved + metrics.ambiguous).toBeGreaterThanOrEqual(metrics.total * 0.95);
});
