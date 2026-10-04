const fs = require('node:fs');
const path = require('node:path');
const {
  invariants,
  dependencies,
  assertInvariants,
} = require('./helpers/shared-service/invariants');
const {
  FIXED_SEEDS,
  loadFunctions,
  generateHistory,
  runSimulation,
} = require('./helpers/shared-service/simulation');
const { createContractStub } = require('./helpers/shared-service/contract-stub');
const ROOT = path.resolve(__dirname, '..');
const { observeExercise, assertExercise } = require('./helpers/shared-service/exercise');
const seeds =
  process.env.SHARED_SERVICE_RANDOM === '1'
    ? [
        ...FIXED_SEEDS,
        process.env.SHARED_SERVICE_SEED
          ? Number(process.env.SHARED_SERVICE_SEED)
          : require('node:crypto').randomBytes(4).readUInt32LE(),
      ]
    : FIXED_SEEDS;

// A future service adapter owns a real broker, uses the existing lifecycle mixin,
// injects an in-memory PouchDB double and observes calls/state after settling events.
// Never substitute a second implementation of the services here.
const defaultAdapterPath = path.join(ROOT, 'tests/helpers/shared-service/real-adapter.js');
const adapterPath =
  process.env.SHARED_SERVICE_TEST_ADAPTER ||
  (fs.existsSync(defaultAdapterPath) ? defaultAdapterPath : null);
const realAdapter = adapterPath ? require(path.resolve(adapterPath)) : null;

function missingDependencies(spec) {
  const missing = spec.paths.filter((file) => !fs.existsSync(path.join(ROOT, file)));
  if (spec.alternatives && !spec.alternatives.some((file) => fs.existsSync(path.join(ROOT, file))))
    missing.push(spec.alternatives.join(' OR '));
  if (
    spec.marker &&
    !fs
      .readFileSync(path.join(ROOT, 'src/workbench-intent-router.js'), 'utf8')
      .includes(spec.marker)
  )
    missing.push(`#700 intent ${spec.marker}`);
  return missing;
}

for (const [id, spec] of Object.entries(dependencies)) {
  const missing = missingDependencies(spec);
  if (missing.length) {
    test.todo(`${id}: awaits ${spec.issues}; missing ${missing.join(', ')}`);
  } else {
    test(`${id}: real services (${spec.issues})`, async () => {
      if (!realAdapter)
        throw new Error(
          `${id}: dependencies landed; provide tests/helpers/shared-service/real-adapter.js or configure SHARED_SERVICE_TEST_ADAPTER (see docs/shared-service-harness.md). Each service issue extends this adapter with its own observations. This invariant must no longer remain todo.`
        );
      for (const seed of seeds) {
        const { functions } = loadFunctions();
        const seen = new Set();
        jest.useFakeTimers({ now: Date.UTC(2026, 0, 1), doNotFake: ['hrtime', 'performance'] });
        try {
          await runSimulation({
            seed,
            history: generateHistory({ seed, functions }),
            createAdapter: async () => {
              jest.setSystemTime(Date.UTC(2026, 0, 1));
              const adapter = await realAdapter.createAdapter({ functions, jest });
              return {
                apply: (step) => adapter.apply(step),
                close: () => adapter.close(),
                snapshot: async () => {
                  const state = await adapter.snapshot();
                  observeExercise(state, seen);
                  return state;
                },
              };
            },
            ids: [id],
          });
          assertExercise(seen, id, seed);
        } finally {
          jest.useRealTimers();
        }
      }
    });
  }
}

const { functions } = loadFunctions();
describe('contract simulation (does not claim missing service behavior)', () => {
  test.each(seeds)('seed=%i; checks every step', async (seed) => {
    jest.useFakeTimers({ now: Date.UTC(2026, 0, 1), doNotFake: ['hrtime', 'performance'] });
    const started = process.hrtime.bigint();
    try {
      await runSimulation({
        seed,
        history: generateHistory({ seed, functions }),
        createAdapter: () => {
          jest.setSystemTime(Date.UTC(2026, 0, 1));
          const stub = createContractStub(functions);
          const apply = stub.apply.bind(stub);
          stub.apply = async (step) => {
            if (step.type === 'advance') await jest.advanceTimersByTimeAsync(step.milliseconds);
            await apply(step);
          };
          return stub;
        },
      });
      expect(Number(process.hrtime.bigint() - started) / 1e6).toBeLessThan(60000);
    } finally {
      jest.useRealTimers();
    }
  });
});

// Self-tests exercise each oracle with a positive and a deliberately broken observation.
const base = () => ({
  fresh: false,
  activations: [],
  agents: [],
  now: Date.UTC(2026, 0, 1, 12),
  functions: [],
  tenantBudget: 3,
  operationAttempts: [],
  activityQueries: [],
  emptyWakes: [],
  corrections: [],
  journal: [],
  authorizationChecks: [],
  handoffs: [],
});
const activation = () => ({
  tenantId: 'tenant-a',
  functionId: 'fn-a',
  state: 'active',
  touchedAt: '2026-01-01',
  touchedBy: ['actor-a'],
  responsibility: { humans: [], cet: true },
  reason: [],
});
const agent = () => ({
  agentId: 'agent-a',
  tenantId: 'tenant-a',
  functionId: 'fn-a',
  lifecycle: 'active',
  mandate: {},
  wake: { mode: 'schedule', intervalSec: 60, events: [] },
  stats: {},
});
const observations = {
  'I-1': () => ({
    ...base(),
    fresh: true,
    activations: [{ ...activation(), state: 'latent', responsibility: { humans: [], cet: false } }],
  }),
  'I-2': () => ({ ...base(), activations: [activation()], agents: [agent()] }),
  'I-3': () => ({
    ...base(),
    tenantBudget: 1,
    minWeight: 0.5,
    activations: [
      { ...activation(), responsibility: { humans: ['actor-a'], cet: false } },
      { ...activation(), functionId: 'fn-b', touchedAt: null },
    ],
    functions: [{ functionId: 'fn-a', neighbors: [{ functionId: 'fn-b', weight: 0.6 }] }],
  }),
  'I-4': () => ({
    ...base(),
    operationAttempts: [
      {
        externalEffect: true,
        executed: false,
        authorized: false,
        noCallBlocked: true,
        requiresHITL: true,
      },
    ],
  }),
  'I-5': () => ({
    ...base(),
    activityQueries: [
      {
        mode: 'system_activity_query',
        knowledgeCalls: 0,
        ragCalls: 0,
        answerState: { status: 'active' },
        journalDigest: { status: 'active' },
      },
    ],
  }),
  'I-6': () => ({
    ...base(),
    emptyWakes: [{ beforeIntervalSec: 60, afterIntervalSec: 120, maximumIntervalSec: 3600 }],
  }),
  'I-7': () => ({
    ...base(),
    corrections: [
      {
        event: {
          tenantId: 'tenant-a',
          actorId: 'actor-a',
          target: 'coverage',
          ref: 'fn-a',
          correction: { score: 1 },
        },
        before: { score: 0 },
        after: { score: 1 },
      },
    ],
    journal: [
      {
        entryId: 'entry-a',
        tenantId: 'tenant-a',
        functionId: 'fn-a',
        kind: 'corrected',
        summary: 'Updated',
        refs: ['fn-a'],
        at: '2026-01-01',
      },
    ],
  }),
  'I-8': () => ({
    ...base(),
    authorizationChecks: [
      {
        before: false,
        after: false,
        policyBefore: { domainsAllowed: [], sensitivityClearance: 'public', rbac: 'reader' },
        policyAfter: { domainsAllowed: [], sensitivityClearance: 'public', rbac: 'reader' },
      },
    ],
  }),
  'I-9': () => ({
    ...base(),
    handoffs: [
      {
        firstActorId: 'actor-a',
        secondActorId: 'actor-b',
        before: activation(),
        after: { ...activation(), responsibility: { humans: ['actor-b'], cet: false } },
        agents: [{ ...agent(), lifecycle: 'sleeping' }],
      },
    ],
  }),
};
const corrupt = {
  'I-1': (s) => {
    s.agents.push(agent());
  },
  'I-2': (s) => {
    s.agents.push(agent());
  },
  'I-3': (s) => {
    s.tenantBudget = 0;
  },
  'I-4': (s) => {
    s.operationAttempts[0].executed = true;
  },
  'I-5': (s) => {
    s.activityQueries[0].ragCalls = 1;
  },
  'I-6': (s) => {
    s.emptyWakes[0].afterIntervalSec = 60;
  },
  'I-7': (s) => {
    s.journal = [];
  },
  'I-8': (s) => {
    s.authorizationChecks[0].after = true;
  },
  'I-9': (s) => {
    s.handoffs[0].after.responsibility.cet = true;
  },
};

describe('invariant oracle self-tests', () => {
  test.each(Object.keys(invariants))('%s accepts valid and rejects invalid observations', (id) => {
    const state = observations[id]();
    expect(() => assertInvariants(state, [id])).not.toThrow();
    corrupt[id](state);
    expect(() => assertInvariants(state, [id])).toThrow(id);
  });
  test('I-2 rejects touched, uncovered dormant function and missing agent', () => {
    const s = observations['I-2']();
    s.activations[0].state = 'dormant';
    expect(() => assertInvariants(s, ['I-2'])).toThrow('I-2');
    s.activations[0].state = 'active';
    s.agents = [];
    expect(() => assertInvariants(s, ['I-2'])).toThrow('I-2');
  });
  test('I-2 allows dormant functions outside the configurable rest window', () => {
    const s = observations['I-2']();
    s.activations[0].state = 'dormant';
    s.agents = [];
    expect(() => assertInvariants(s, ['I-2'], { restWindowMs: 60 * 60 * 1000 })).not.toThrow();
    expect(() => assertInvariants(s, ['I-2'])).toThrow('I-2');
    s.now = Date.UTC(2026, 0, 2, 0, 0, 0, 1);
    expect(() => assertInvariants(s, ['I-2'])).not.toThrow();
  });
  test('I-2 includes the exact rest-window boundary', () => {
    const s = observations['I-2']();
    s.now = Date.UTC(2026, 0, 2);
    s.activations[0].state = 'dormant';
    expect(() => assertInvariants(s, ['I-2'])).toThrow('I-2');
  });
  test('I-3 rejects CET budget excess independently of the active-count bound', () => {
    const s = observations['I-3']();
    s.tenantBudget = 0;
    s.activations[0].state = 'dormant';
    expect(() => assertInvariants(s, ['I-3'])).toThrow('CET count exceeds tenant budget');
  });
  test('I-3 rejects missing or underweight neighbors independently of budget', () => {
    const s = observations['I-3']();
    s.functions[0].neighbors[0].weight = 0.49;
    expect(() => assertInvariants(s, ['I-3'])).toThrow('eligible neighbor');
    s.functions[0].neighbors = [];
    expect(() => assertInvariants(s, ['I-3'])).toThrow('eligible neighbor');
  });
  test('I-3 rejects excess active functions with valid CET budget and neighbors', () => {
    const s = observations['I-3']();
    s.activations.push({
      ...activation(),
      functionId: 'fn-c',
      touchedAt: null,
      responsibility: { humans: ['actor-a'], cet: false },
    });
    expect(() => assertInvariants(s, ['I-3'])).toThrow(
      'active count exceeds touched functions plus budget'
    );
  });
  test('I-3 accepts minWeight equality and active counts above the CET budget', () => {
    const s = observations['I-3']();
    s.functions[0].neighbors[0].weight = s.minWeight;
    expect(() => assertInvariants(s, ['I-3'])).not.toThrow();
    s.minWeight = 0.7;
    expect(() => assertInvariants(s, ['I-3'])).toThrow('eligible neighbor');
  });
  test('I-4 rejects unauthorized internal execution', () => {
    const s = observations['I-4']();
    s.operationAttempts[0].externalEffect = false;
    s.operationAttempts[0].executed = true;
    expect(() => assertInvariants(s, ['I-4'])).toThrow('I-4');
  });
  test('I-5 rejects digest mismatch and Knowledge calls', () => {
    const s = observations['I-5']();
    s.activityQueries[0].answerState = {};
    expect(() => assertInvariants(s, ['I-5'])).toThrow('I-5');
    s.activityQueries[0].answerState = s.activityQueries[0].journalDigest;
    s.activityQueries[0].knowledgeCalls = 1;
    expect(() => assertInvariants(s, ['I-5'])).toThrow('I-5');
  });
  test('I-6 allows saturation only at configured maximum', () => {
    const s = observations['I-6']();
    Object.assign(s.emptyWakes[0], { beforeIntervalSec: 3600, afterIntervalSec: 3600 });
    expect(() => assertInvariants(s, ['I-6'])).not.toThrow();
  });
  test('I-7 rejects unchanged target even with journal record', () => {
    const s = observations['I-7']();
    s.corrections[0].after = s.corrections[0].before;
    expect(() => assertInvariants(s, ['I-7'])).toThrow('I-7');
  });
  test('I-8 rejects policy widening even if current decision is unchanged', () => {
    const s = observations['I-8']();
    s.authorizationChecks[0].policyAfter.domainsAllowed.push('fn-a');
    expect(() => assertInvariants(s, ['I-8'])).toThrow('I-8');
  });
  test('I-9 rejects an agent still active after handoff', () => {
    const s = observations['I-9']();
    s.handoffs[0].agents[0].lifecycle = 'active';
    expect(() => assertInvariants(s, ['I-9'])).toThrow('I-9');
  });
  test('I-9 fails closed when no matching tenant/function agent exists', () => {
    const s = observations['I-9']();
    s.handoffs[0].agents = [];
    expect(() => assertInvariants(s, ['I-9'])).toThrow('no matching tenant/function agent');
  });
  test('I-9 fails closed when only an unrelated-tenant agent is present', () => {
    const s = observations['I-9']();
    s.handoffs[0].agents = [{ ...agent(), lifecycle: 'sleeping', tenantId: 'tenant-b' }];
    expect(() => assertInvariants(s, ['I-9'])).toThrow('no matching tenant/function agent');
  });
  test('I-9 fails closed when only an unrelated-function agent is present', () => {
    const s = observations['I-9']();
    s.handoffs[0].agents = [{ ...agent(), lifecycle: 'sleeping', functionId: 'fn-b' }];
    expect(() => assertInvariants(s, ['I-9'])).toThrow('no matching tenant/function agent');
  });
  test('I-9 ignores an unrelated agent lifecycle when a matching agent is valid', () => {
    const s = observations['I-9']();
    s.handoffs[0].agents = [
      { ...agent(), lifecycle: 'sleeping' },
      { ...agent(), lifecycle: 'active', tenantId: 'tenant-b', functionId: 'fn-b' },
    ];
    expect(() => assertInvariants(s, ['I-9'])).not.toThrow();
  });
});

test.each(['coverage', 'activation', 'agent', 'neighbor'])(
  'I-7: %s corrections mutate targets and require journal records',
  (target) => {
    const state = observations['I-7']();
    state.corrections[0].event.target = target;
    expect(() => assertInvariants(state, ['I-7'])).not.toThrow();
    state.corrections[0].after = state.corrections[0].before;
    expect(() => assertInvariants(state, ['I-7'])).toThrow('I-7');
  }
);
