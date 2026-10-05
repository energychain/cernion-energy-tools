'use strict';

const { createAdapter } = require('./helpers/shared-service/real-adapter');
const {
  getFunctionModel,
  findFunctionsForCapability,
  findFunctionsForOperation,
} = require('../src/function-model');
const { mapSignals, configuration } = require('../src/function-coverage');
const turn = require('../src/function-coverage-turn');
const { invariants } = require('./helpers/shared-service/invariants');

const model = getFunctionModel();
const selected = model.functions.find(
  (fn) =>
    fn.capabilities.length &&
    fn.neighbors.length &&
    findFunctionsForCapability(fn.capabilities[0], { model }).length === 1
);
const meta = {
  apiToken: { tenantId: 'tenant-a', id: 'actor-a', userId: 'actor-a', roles: ['ROLE_USER'] },
};
let adapter;
beforeEach(async () => {
  adapter = await createAdapter({ jest, model, settings: { tenantBudget: 2 } });
});
afterEach(async () => {
  await adapter.close();
});
async function observe(signalClass, operations, result = {}) {
  const ctx = {
    broker: adapter.broker,
    meta,
    params: { intentMode: signalClass, requestId: 'turn-a', conversationId: 'conv-a' },
    call: jest.fn().mockResolvedValue(result),
  };
  turn.before(ctx);
  for (const operation of operations) await ctx.call(operation);
  await turn.after(ctx, result);
  while (adapter.coverageService.pendingTurns) await new Promise(setImmediate);
  await adapter.coverageService.queue;
  await adapter.service.settle();
  return adapter.snapshot();
}

test('committed model: a knowledge query records weak coverage and activates no function', async () => {
  const operation = 'knowledge-rag.query';
  expect(findFunctionsForOperation(operation, { model }).length).toBeGreaterThan(0);
  const state = await observe('knowledge_query', [operation]);
  expect(state.coverage.length).toBeGreaterThan(0);
  expect(state.activations.every((row) => row.state === 'latent' && !row.responsibility.cet)).toBe(
    true
  );
});

test('committed model: automatic aggregate operation fanout never becomes function touches', async () => {
  // Select the widest operation hub from model data, with no action denylist.
  const hubs = model.statistics.automaticHubs
    .filter((feature) => feature.startsWith('operations:'))
    .map((feature) => feature.slice('operations:'.length));
  const operation = hubs.reduce(
    (widest, id) =>
      findFunctionsForOperation(id, { model }).length >
      findFunctionsForOperation(widest, { model }).length
        ? id
        : widest,
    hubs[0]
  );
  expect(findFunctionsForOperation(operation, { model }).length).toBeGreaterThan(20);
  const state = await observe('case_start', [operation]);
  expect(state.coverageEvents).toEqual([]);
  expect(state.coverage).toEqual([]);
  expect(state.activations.some((row) => row.state === 'active')).toBe(false);
  expect(adapter.coverageService.suppressedOperations).toBe(1);
});

test('committed model: selected capability activates precisely its function and budgeted neighbors', async () => {
  const state = await observe('case_start', ['router-a.classify'], {
    selectedCapabilities: [selected.capabilities[0]],
    candidateCapabilities: model.functions.flatMap((fn) => fn.capabilities),
    recommendedCapabilities: model.functions.flatMap((fn) => fn.capabilities),
    operationCandidates: model.functions.flatMap((fn) => fn.operations),
  });
  const touches = state.coverageEvents.filter((event) => event.name === 'function.touched.v1');
  expect(touches.map((event) => event.payload.functionId)).toEqual([selected.functionId]);
  const active = state.activations.filter((row) => row.state === 'active');
  expect(active.find((row) => row.functionId === selected.functionId)).toBeDefined();
  expect(active.length).toBeLessThanOrEqual(3);
  expect(
    active
      .filter((row) => row.functionId !== selected.functionId)
      .every(
        (row) =>
          row.responsibility.cet &&
          selected.neighbors.some((edge) => edge.functionId === row.functionId)
      )
  ).toBe(true);
  invariants['I-3'](state);
});

test.each(['knowledge_query', 'status_query', 'data_lookup'])(
  'committed model: %s remains below the activation threshold',
  async (signalClass) => {
    const state = await observe(signalClass, [], {
      selectedCapabilities: [selected.capabilities[0]],
    });
    expect(state.coverage).toHaveLength(1);
    expect(state.activations.some((row) => row.state === 'active')).toBe(false);
  }
);

test.each([
  'case_start',
  'case_followup',
  'decision_support',
  'tool_run_request',
  'evidence_attachment',
])('committed model: %s qualifies selected work', async (signalClass) => {
  const state = await observe(signalClass, [], {
    selectedCapabilities: [selected.capabilities[0]],
  });
  expect(state.activations.find((row) => row.functionId === selected.functionId).state).toBe(
    'active'
  );
});

test('committed model: function budget bounds capability fanout and reports every discarded mapping', () => {
  const mapped = mapSignals(
    { capabilities: model.functions.flatMap((fn) => fn.capabilities) },
    model,
    configuration()
  );
  expect(mapped.functionIds).toHaveLength(5);
  expect(mapped.overflow).toBeGreaterThan(0);
});
