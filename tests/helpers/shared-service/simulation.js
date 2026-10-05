const fs = require('node:fs');
const path = require('node:path');
const { compareCanonicalStrings } = require('../../../src/canonical-order');
const { assertInvariants } = require('./invariants');
const ROOT = path.resolve(__dirname, '../../..');
const FIXED_SEEDS = [702, 693, 20261003];

function loadFunctions(root = ROOT) {
  const real = path.join(root, 'function-model.json');
  const file = fs.existsSync(real)
    ? real
    : path.join(ROOT, 'tests/fixtures/shared-service/function-model.json');
  const data = JSON.parse(fs.readFileSync(file, 'utf8'));
  const functions = Array.isArray(data) ? data : data.functions;
  if (!Array.isArray(functions) || !functions.length || functions.some((item) => !item.functionId))
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
  const history = Array.from({ length: steps }, (_, index) => {
    const functionId = pick(functions).functionId;
    const actorId = `actor-${Math.floor(random() * users)}`;
    const tenantId = 'tenant-a';
    const type = pick([
      'touch',
      'signal',
      'correction',
      'advance',
      'activity',
      'consumption',
      'feedback',
      'attention-correction',
    ]);
    if (type === 'advance') {
      const milliseconds = 1000 + Math.floor(random() * 86400000);
      now += milliseconds;
      return { type, milliseconds };
    }
    if (['consumption', 'feedback', 'attention-correction'].includes(type)) {
      const anchor = functions.find((fn) => fn.neighbors.some((edge) => edge.weight >= 0.2));
      const targetId =
        anchor?.neighbors
          .slice()
          .sort(
            (a, b) => b.weight - a.weight || compareCanonicalStrings(a.functionId, b.functionId)
          )[0]?.functionId || functionId;
      const common = {
        tenantId,
        actorId,
        functionId: targetId,
        agentId: `agent-${targetId}`,
        at: new Date(now).toISOString(),
      };
      if (type === 'consumption')
        return {
          type,
          event: 'shared-agent.consumption.v1',
          payload: { ...common, units: 0.25, kind: pick(['wake', 'llm', 'operation']) },
        };
      if (type === 'feedback')
        return {
          type,
          event: 'shared-agent.feedback.v1',
          payload: {
            ...common,
            outcome: pick(['accepted', 'used', 'rejected']),
            ref: `feedback-${index}`,
          },
        };
      return {
        type,
        event: 'shared-service.correction.v1',
        meta: { apiToken: { tenantId, id: actorId, roles: ['ROLE_TENANT_ADMIN'] } },
        payload: {
          tenantId,
          actorId,
          target: 'agent',
          ref: targetId,
          correction: { functionId: targetId, kind: pick(['retain', 'unretain', 'pin', 'unpin']) },
        },
      };
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
  const anchor = functions.find((fn) => fn.neighbors.some((edge) => edge.weight >= 0.2));
  if (anchor && steps >= 5) {
    const target = anchor.neighbors
      .slice()
      .sort(
        (a, b) => b.weight - a.weight || compareCanonicalStrings(a.functionId, b.functionId)
      )[0].functionId;
    const other = functions.find(
      (fn) => fn.functionId !== anchor.functionId && fn.functionId !== target
    );
    const turn = (functionId, index) => ({
      type: 'touch',
      event: 'function.touched.v1',
      payload: {
        tenantId: 'tenant-a',
        actorId: 'actor-0',
        functionId,
        conversationId: `conversation-prefix-${index}`,
        confidence: 1,
        at: new Date(Date.UTC(2026, 0, 1)).toISOString(),
      },
    });
    history.splice(
      0,
      5,
      turn(anchor.functionId, 0),
      {
        type: 'consumption',
        event: 'shared-agent.consumption.v1',
        payload: {
          tenantId: 'tenant-a',
          actorId: 'actor-0',
          functionId: target,
          agentId: `agent-${target}`,
          units: 0.25,
          kind: 'llm',
          at: new Date(Date.UTC(2026, 0, 1)).toISOString(),
        },
      },
      turn(other?.functionId || anchor.functionId, 1),
      { type: 'advance', milliseconds: 1 },
      {
        type: 'feedback',
        event: 'shared-agent.feedback.v1',
        payload: {
          tenantId: 'tenant-a',
          actorId: 'actor-0',
          functionId: target,
          agentId: `agent-${target}`,
          outcome: 'rejected',
          ref: 'feedback-prefix',
          at: new Date(Date.UTC(2026, 0, 1)).toISOString(),
        },
      }
    );
    if (steps >= 7) history.splice(5, 2, turn(anchor.functionId, 2), { type: 'wake-exercise' });
  }
  if (anchor && steps >= 8) {
    const target = anchor.neighbors
      .slice()
      .sort(
        (a, b) => b.weight - a.weight || compareCanonicalStrings(a.functionId, b.functionId)
      )[0].functionId;
    history.splice(
      6,
      0,
      {
        type: 'touch',
        event: 'function.touched.v1',
        payload: {
          tenantId: 'tenant-a',
          actorId: 'actor-0',
          functionId: target,
          conversationId: 'handoff-target',
          confidence: 1,
          at: new Date(now).toISOString(),
        },
      },
      {
        type: 'touch',
        event: 'function.touched.v1',
        payload: {
          tenantId: 'tenant-a',
          actorId: 'actor-0',
          functionId: anchor.functionId,
          conversationId: 'handoff-source',
          confidence: 1,
          at: new Date(now).toISOString(),
        },
      },
      {
        type: 'coverage',
        event: 'function.coverage.changed.v1',
        payload: {
          tenantId: 'tenant-a',
          actorId: 'actor-1',
          functionId: target,
          score: 1,
          origin: 'observed',
        },
      }
    );
  }
  if (anchor && steps >= 11)
    history[10] = {
      type: 'activity',
      tenantId: 'tenant-a',
      actorId: 'actor-0',
      functionId: anchor.functionId,
      mode: 'system_activity_query',
    };
  if (anchor && steps >= 11) {
    history.splice(11, 0, {
      type: 'notice-exercise',
      tenantId: 'tenant-a',
      actorId: 'actor-0',
      functionId: anchor.functionId,
    });
  }
  return history;
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
    const failureId = error.message.match(/^I-\d+:/)?.[0];
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
