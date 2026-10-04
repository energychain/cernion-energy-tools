const fs = require('node:fs');
const path = require('node:path');
const { assertInvariants } = require('./invariants');
const ROOT = path.resolve(__dirname, '../../..');
const FIXED_SEEDS = [702, 693, 20261003];

// Required #693 Function shape: functionId, label, sources ({kind, ref}),
// capabilities, operations, dataSources, entityTypes (string arrays),
// events ({emits, listens}), neighbors ({functionId, weight, evidence}), derivation.
const isNonEmptyString = (value) => typeof value === 'string' && value.length > 0;
const isStringArray = (value) =>
  Array.isArray(value) && value.every((item) => typeof item === 'string');
const isValidSource = (source) =>
  !!source &&
  typeof source === 'object' &&
  isNonEmptyString(source.kind) &&
  isNonEmptyString(source.ref);
const isValidNeighbor = (neighbor) =>
  !!neighbor &&
  typeof neighbor === 'object' &&
  isNonEmptyString(neighbor.functionId) &&
  Number.isFinite(neighbor.weight) &&
  Array.isArray(neighbor.evidence);
const isValidEvents = (events) =>
  !!events &&
  typeof events === 'object' &&
  isStringArray(events.emits) &&
  isStringArray(events.listens);

function isValidFunctionShape(item) {
  return (
    !!item &&
    typeof item === 'object' &&
    isNonEmptyString(item.functionId) &&
    isNonEmptyString(item.label) &&
    Array.isArray(item.sources) &&
    item.sources.every(isValidSource) &&
    isStringArray(item.capabilities) &&
    isStringArray(item.operations) &&
    isStringArray(item.dataSources) &&
    isStringArray(item.entityTypes) &&
    isValidEvents(item.events) &&
    Array.isArray(item.neighbors) &&
    item.neighbors.every(isValidNeighbor) &&
    !!item.derivation &&
    typeof item.derivation === 'object'
  );
}

function loadFunctions(root = ROOT) {
  const real = path.join(root, 'function-model.json');
  const file = fs.existsSync(real)
    ? real
    : path.join(ROOT, 'tests/fixtures/shared-service/function-model.json');
  const data = JSON.parse(fs.readFileSync(file, 'utf8'));
  const functions = Array.isArray(data) ? data : data.functions;
  if (
    !Array.isArray(functions) ||
    !functions.length ||
    functions.some((item) => !isValidFunctionShape(item))
  )
    throw new Error(`Invalid function model: ${file}`);
  if (new Set(functions.map((item) => item.functionId)).size !== functions.length)
    throw new Error('Duplicate functionId');
  return { functions, source: file };
}

function generateHistory({ seed, functions, users = 5, steps = 80 }) {
  if (!Number.isInteger(seed) || seed < 0 || seed > 0xffffffff)
    throw new Error('seed must be uint32');
  if (
    !functions.length ||
    !Number.isInteger(users) ||
    users < 2 ||
    !Number.isInteger(steps) ||
    steps < 1
  )
    throw new Error('Invalid history parameters');
  let value = seed >>> 0;
  let now = Date.UTC(2026, 0, 1);
  const random = () => {
    value = (Math.imul(value, 1664525) + 1013904223) >>> 0;
    return value / 0x100000000;
  };
  const pick = (items) => items[Math.floor(random() * items.length)];
  return Array.from({ length: steps }, (_, index) => {
    const functionId = pick(functions).functionId;
    const actorId = `actor-${Math.floor(random() * users)}`;
    const tenantId = 'tenant-a';
    const type = pick(['touch', 'signal', 'correction', 'advance', 'activity']);
    if (type === 'advance') {
      const milliseconds = 1000 + Math.floor(random() * 86400000);
      now += milliseconds;
      return { type, milliseconds };
    }
    if (type === 'activity')
      return { type, tenantId, actorId, functionId, mode: 'system_activity_query' };
    if (type === 'correction')
      return {
        type,
        event: 'shared-service.correction.v1',
        payload: {
          tenantId,
          actorId,
          target: pick(['coverage', 'activation', 'agent', 'neighbor']),
          ref: functionId,
          correction: { score: random(), responsibility: { humans: [actorId], cet: false } },
        },
      };
    if (type === 'signal')
      return {
        type,
        tenantId,
        actorId,
        functionId,
        signalKind: pick(['question', 'session', 'action', 'repeat']),
        conversationId: `conversation-${index % 7}`,
      };
    return {
      type,
      event: 'function.touched.v1',
      payload: {
        tenantId,
        actorId,
        functionId,
        conversationId: `conversation-${index}`,
        confidence: random(),
        at: new Date(now).toISOString(),
      },
    };
  });
}

// Delete chunks and replay from a fresh adapter; retain the original invariant failure.
async function minimizeHistory(history, fails) {
  let result = history;
  for (let size = Math.ceil(result.length / 2); size >= 1; size = Math.floor(size / 2)) {
    for (let start = 0; start < result.length;) {
      const candidate = [...result.slice(0, start), ...result.slice(start + size)];
      if (await fails(candidate)) {
        result = candidate;
        start = 0;
      } else start += size;
    }
  }
  return result;
}

async function replayHistory(history, createAdapter, ids) {
  const adapter = await createAdapter();
  try {
    assertInvariants(await adapter.snapshot(), ids);
    for (const step of history) {
      await adapter.apply(step);
      assertInvariants(await adapter.snapshot(), ids);
    }
  } finally {
    await adapter.close();
  }
}

async function runSimulation({ seed, history, createAdapter, ids }) {
  try {
    await replayHistory(history, createAdapter, ids);
  } catch (error) {
    const failureId = error.message.match(/^I-\d:/)?.[0];
    const minimized = await minimizeHistory(history, async (candidate) => {
      try {
        await replayHistory(candidate, createAdapter, ids);
        return false;
      } catch (failure) {
        return failureId
          ? failure.message.startsWith(failureId)
          : failure.message === error.message;
      }
    });
    throw new Error(
      `Simulation failed; seed=${seed}; minimizedHistory=${JSON.stringify(minimized)}; ${error.message}`,
      { cause: error }
    );
  }
}

module.exports = {
  FIXED_SEEDS,
  loadFunctions,
  generateHistory,
  minimizeHistory,
  replayHistory,
  runSimulation,
};
