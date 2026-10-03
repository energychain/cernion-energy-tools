const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { compareCanonicalStrings } = require('../src/canonical-order');
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
    expect(Object.keys(step.payload).sort(compareCanonicalStrings)).toEqual(
      ['tenantId', 'actorId', 'functionId', 'conversationId', 'confidence', 'at'].sort(
        compareCanonicalStrings
      )
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

test('partial adapter observations exercise only the implemented invariants', () => {
  const { observeExercise, assertExercise } = require('./helpers/shared-service/exercise');
  const { assertInvariants } = require('./helpers/shared-service/invariants');
  const state = { operationAttempts: [{ externalEffect: true, executed: false }] };
  const seen = new Set();
  expect(() => observeExercise(state, seen)).not.toThrow();
  expect(() => assertInvariants(state, ['I-4'])).not.toThrow();
  expect(() => assertExercise(seen, 'I-4', 702)).not.toThrow();
  expect(() => assertExercise(seen, 'I-5', 702)).toThrow('exercise missing');
  expect(() => assertInvariants({}, ['I-4'])).toThrow('I-4');
});

test('I-2 exercise requires a touch inside the configured rest window', () => {
  const { observeExercise, assertExercise } = require('./helpers/shared-service/exercise');
  const state = {
    now: Date.UTC(2026, 0, 2),
    restWindowMs: 1000,
    activations: [{ touchedAt: '2026-01-01T00:00:00.000Z', responsibility: { cet: true } }],
  };
  const seen = new Set();
  observeExercise(state, seen);
  expect(() => assertExercise(seen, 'I-2', 702)).toThrow('exercise missing');
  state.activations[0].touchedAt = new Date(state.now - 1000).toISOString();
  observeExercise(state, seen);
  expect(() => assertExercise(seen, 'I-2', 702)).not.toThrow();
});

test.each([
  { exists: true, override: undefined, expected: 'default' },
  { exists: false, override: undefined, expected: null },
  { exists: true, override: '/tmp/adapter-override.js', expected: 'override' },
])(
  'adapter discovery respects default existence and explicit override: %j',
  ({ exists, override, expected }) => {
    const vm = require('node:vm');
    const { createRequire } = require('node:module');
    const file = path.join(__dirname, 'shared-service-invariants.test.js');
    const defaultPath = path.resolve(__dirname, 'helpers/shared-service/real-adapter.js');
    const source = fs.readFileSync(file, 'utf8').split('function missingDependencies')[0];
    const localRequire = createRequire(file);
    const loaded = [];
    const result = vm.runInNewContext(`${source}\nrealAdapter;`, {
      __dirname,
      process: { env: { SHARED_SERVICE_TEST_ADAPTER: override } },
      require: (name) => {
        if (name === 'node:fs')
          return { existsSync: (candidate) => candidate === defaultPath && exists };
        if (name === defaultPath || name === override) {
          loaded.push(name);
          return { kind: name === override ? 'override' : 'default' };
        }
        return localRequire(name);
      },
    });
    expect(result?.kind ?? null).toBe(expected);
    expect(loaded).toHaveLength(expected ? 1 : 0);
  }
);
