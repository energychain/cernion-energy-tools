const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const {
  FIXED_SEEDS,
  loadFunctions,
  generateHistory,
  runSimulation,
  minimizeHistory,
} = require('./helpers/shared-service/simulation');
const { createContractStub } = require('./helpers/shared-service/contract-stub');

const { functions } = loadFunctions();
test('AC-03: at least three distinct fixed seeds and reproducible histories', () => {
  expect(new Set(FIXED_SEEDS).size).toBeGreaterThanOrEqual(3);
  const make = (seed) => generateHistory({ seed, functions, steps: 500 });
  expect(make(702)).toEqual(make(702));
  expect(make(702)).not.toEqual(make(693));
  expect(new Set(make(702).map((s) => s.type))).toEqual(
    new Set(['touch', 'signal', 'correction', 'advance', 'activity'])
  );
  expect(
    new Set(
      make(702)
        .filter((s) => s.type === 'correction')
        .map((s) => s.payload.target)
    ).size
  ).toBe(4);
  expect(
    new Set(
      make(702)
        .filter((s) => s.type === 'signal')
        .map((s) => s.signalKind)
    ).size
  ).toBe(4);
  expect(
    new Set(
      make(702)
        .map((s) => (s.payload || s).actorId)
        .filter(Boolean)
    ).size
  ).toBe(5);
});

test('AC-04: uses all fixture functions without domain-specific selection', () => {
  const history = generateHistory({ seed: 702, functions, steps: 2000 });
  expect(
    new Set(history.map((s) => (s.payload || s).functionId || s.payload?.ref).filter(Boolean))
  ).toEqual(new Set(functions.map((f) => f.functionId)));
});

test('AC-04: real function-model.json takes precedence; invalid real data fails closed', () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'shared-model-'));
  try {
    const file = path.join(root, 'function-model.json');
    fs.writeFileSync(file, JSON.stringify({ functions: [functions[0]] }));
    expect(loadFunctions(root)).toEqual({ source: file, functions: [functions[0]] });
    fs.writeFileSync(file, '{}');
    expect(() => loadFunctions(root)).toThrow('Invalid function model');
    fs.writeFileSync(file, JSON.stringify({ functions: [functions[0], functions[0]] }));
    expect(() => loadFunctions(root)).toThrow('Duplicate');
    fs.unlinkSync(file);
    expect(loadFunctions(root).source).toContain('fixtures');
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test('generator rejects invalid seed/parameters', () => {
  expect(() => generateHistory({ seed: -1, functions })).toThrow('uint32');
  expect(() => generateHistory({ seed: 1, functions: [] })).toThrow();
  expect(() => generateHistory({ seed: 1, functions, users: 1 })).toThrow();
});

test('Fake-clock timestamps and versioned events retain #693 payloads', async () => {
  const clock = { now: Date.UTC(2026, 0, 1) };
  const stub = createContractStub(functions, clock);
  const history = generateHistory({ seed: 702, functions, steps: 500 });
  for (const step of history) await stub.apply(step);
  expect(clock.now).toBeGreaterThan(Date.UTC(2026, 0, 1));
  for (const step of stub.seen.filter((s) => s.event === 'function.touched.v1')) {
    expect(Object.keys(step.payload).sort()).toEqual(
      ['tenantId', 'actorId', 'functionId', 'conversationId', 'confidence', 'at'].sort()
    );
    expect(Number.isFinite(Date.parse(step.payload.at))).toBe(true);
  }
});

test('AC-03: failure reports seed, invariant and minimized history; adapters close on each replay', async () => {
  let closed = 0;
  const history = generateHistory({ seed: 702, functions, steps: 40 });
  const createAdapter = () => {
    const stub = createContractStub(functions);
    let broken = false;
    return {
      async apply(step) {
        broken ||= step.type === 'touch';
        await stub.apply(step);
      },
      async snapshot() {
        const s = await stub.snapshot();
        if (broken) s.agents.push({ agentId: 'agent-b' });
        return s;
      },
      async close() {
        closed++;
      },
    };
  };
  let failure;
  try {
    await runSimulation({ seed: 702, history, createAdapter });
  } catch (error) {
    failure = error;
  }
  expect(failure.message).toContain('seed=702');
  expect(failure.message).toContain('I-1:');
  const minimized = JSON.parse(failure.message.split('minimizedHistory=')[1].split('; I-1:')[0]);
  expect(minimized).toHaveLength(1);
  expect(minimized[0].type).toBe('touch');
  expect(closed).toBeGreaterThan(1);
});

test('minimizer retains required order-dependent pair and removes unrelated steps', async () => {
  const history = ['noise', 'a', 'noise', 'b', 'noise'];
  const minimized = await minimizeHistory(
    history,
    async (steps) => steps.includes('a') && steps.indexOf('b') > steps.indexOf('a')
  );
  expect(minimized).toEqual(['a', 'b']);
});

test('invariants checked initially and after EVERY step, not just final state', async () => {
  let snapshots = 0;
  await runSimulation({
    seed: 702,
    history: generateHistory({ seed: 702, functions, steps: 10 }),
    createAdapter: () => {
      const stub = createContractStub(functions);
      return {
        ...stub,
        async snapshot() {
          snapshots++;
          return stub.snapshot();
        },
      };
    },
  });
  expect(snapshots).toBe(11);
});

test('real-service adapters cannot pass with empty observations', async () => {
  const { observeExercise, assertExercise } = require('./helpers/shared-service/exercise');
  const seen = new Set();
  observeExercise(await createContractStub(functions).snapshot(), seen);
  expect(() => assertExercise(seen, 'I-1', 702)).not.toThrow();
  for (const id of ['I-2', 'I-3', 'I-4', 'I-5', 'I-6', 'I-7', 'I-8', 'I-9'])
    expect(() => assertExercise(seen, id, 702)).toThrow('seed=702');
  for (const target of ['coverage', 'activation', 'agent', 'neighbor']) seen.add(`I-7:${target}`);
  expect(() => assertExercise(seen, 'I-7', 702)).not.toThrow();
});
