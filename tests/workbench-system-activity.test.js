'use strict';

const {
  classifyWorkbenchIntent,
  renderWorkbenchResponse,
  isReadOnlyIntent,
} = require('../src/workbench-intent-router');
const { answerSystemActivity } = require('../src/workbench-system-activity');
const { resolveFunctions } = require('../src/function-resolver');
const { getFunctionModel } = require('../src/function-model');
const meta = { apiToken: { tenantId: 'tenant-a', id: 'actor-a', roles: ['ROLE_USER'] } };
const model = {
  functions: [{ functionId: 'fn-a', label: 'Function A', keywords: ['phrase a'], aliases: [] }],
};
const row = {
  tenantId: 'tenant-a',
  functionId: 'fn-a',
  state: 'active',
  responsibility: { cet: true, humans: [] },
  reason: [{ kind: 'neighbor' }],
  attention: { tier: 'transient', relevance: 0.5, allowance: 1, allowanceExhausted: false },
};
const digest = {
  schemaVersion: 1,
  tenantId: 'tenant-a',
  functionId: 'fn-a',
  status: { state: 'active', responsibility: { cet: true, humans: [] }, agents: [] },
  openExpectations: [
    {
      summary: 'Waiting for evidence.',
      at: '2026-01-01T00:00:00.000Z',
      hiddenRefCount: 1,
      refs: [{ id: 'secret-a' }],
    },
  ],
  openProposals: [{ summary: 'Review proposed step.', at: '2026-01-01T00:00:00.000Z' }],
  lastDecisions: [],
  entryCount: 2,
  lastEntryAt: '2026-01-01T00:00:00.000Z',
};
function context(activation = row, overrides = {}, roles = ['ROLE_USER']) {
  return {
    meta: { apiToken: { ...meta.apiToken, roles } },
    call: jest.fn(async (name) => {
      if (Object.hasOwn(overrides, name)) {
        if (overrides[name] instanceof Error) throw overrides[name];
        return overrides[name];
      }
      if (name === 'activation.explain')
        return { activations: [activation], history: [{ actorId: 'secret-history' }] };
      if (name === 'activation.list') return [activation];
      if (name === 'journal.digest') return digest;
      if (name === 'agents.list')
        return [
          {
            tenantId: 'tenant-a',
            functionId: 'fn-a',
            lifecycle: 'active',
            mandate: { private: true },
          },
        ];
      if (name === 'function-coverage.byFunction')
        return {
          items: [{ tenantId: 'tenant-a', functionId: 'fn-a', actorId: 'visible-a', score: 1 }],
        };
      throw new Error('Forbidden source');
    }),
  };
}

// Seeded draws of actual labels; no hand-selected domain examples.
test('AC-01/02: generated German/English positive and negative corpus from 24 real model draws', () => {
  const functions = getFunctionModel().functions;
  let seed = 700;
  for (let i = 0; i < 24; i++) {
    seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0;
    const fn = functions[seed % functions.length];
    for (const question of [
      `Was macht ${fn.label} gerade?`,
      `Woran arbeitet ${fn.label} aktuell?`,
      `What is ${fn.label} doing right now?`,
      `Warum kümmerst du dich um ${fn.label}?`,
    ]) {
      expect(classifyWorkbenchIntent(question)).toBe('system_activity_query');
      expect(
        resolveFunctions(fn.label).matches.some((item) => item.functionId === fn.functionId)
      ).toBe(true);
    }
    for (const question of [`Was ist ${fn.label}?`, `What is ${fn.label}?`])
      expect(classifyWorkbenchIntent(question)).toBe('knowledge_query');
    expect(classifyWorkbenchIntent(`What is the status of case-1 for ${fn.label}?`)).toBe(
      'status_query'
    );
  }
  expect(isReadOnlyIntent('system_activity_query')).toBe(true);
});

test.each([
  'Was machst du gerade?',
  'Woran arbeitest du?',
  'Welche Agents laufen?',
  'Was gehört zum Inventar?',
  'What are you working on?',
])('overview activity: %s', (question) => {
  expect(classifyWorkbenchIntent(question)).toBe('system_activity_query');
});

test.each([
  [
    { ...row, state: 'latent', responsibility: { cet: false, humans: [] } },
    'latent',
    'noch nicht berührt',
  ],
  [row, 'active_cet', 'CET-Verantwortung'],
  [
    { ...row, responsibility: { cet: false, humans: ['secret-person'] }, attention: null },
    'active_human',
    'menschlicher Verantwortung',
  ],
  [{ ...row, state: 'dormant' }, 'dormant', 'ruhend'],
  [
    { ...row, attention: { ...row.attention, allowanceExhausted: true } },
    'sleeping',
    'wartet auf Anstoß',
  ],
])(
  'AC-03/04: state %s is read-only, scalar and digest-backed',
  async (activation, state, phrase) => {
    const ctx = context(activation);
    const result = await answerSystemActivity(ctx, 'Was macht Function A gerade?', { model });
    expect(result.state).toBe(state);
    const rendered = renderWorkbenchResponse(result, 'system_activity_query');
    expect(rendered).toContain(phrase);
    expect(rendered).toContain('Waiting for evidence.');
    expect(rendered).toContain('Review proposed step.');
    expect(rendered).not.toMatch(/secret-|\[object Object\]|routing advice/i);
    expect(JSON.stringify(result)).not.toMatch(/secret-|refs|mandate|history/);
    expect(ctx.call.mock.calls.map(([name]) => name)).toEqual([
      'activation.explain',
      'journal.digest',
      'agents.list',
    ]);
  }
);

test.each(['transient', 'established', 'retained', 'inventory'])(
  'attention tier is preserved: %s',
  async (tier) => {
    const result = await answerSystemActivity(
      context({ ...row, attention: { ...row.attention, tier } }),
      'Was macht Function A gerade?',
      { model }
    );
    expect(result.items[0].attention.tier).toBe(tier);
    expect(renderWorkbenchResponse(result, 'system_activity_query')).toContain(
      'Relevanz 50 %; Rahmen 1 Einheiten'
    );
  }
);

test('AC-05: only management coverage projects identities; upstream pseudonyms stay opaque', async () => {
  const ctx = context(row, {}, ['ROLE_UTILITY_HQ']);
  const result = await answerSystemActivity(ctx, 'Was macht Function A gerade?', { model });
  expect(ctx.call).toHaveBeenCalledWith('function-coverage.byFunction', {
    tenantId: 'tenant-a',
    functionId: 'fn-a',
    limit: 100,
  });
  expect(result.items[0].people).toEqual(['visible-a']);
  const wrong = context(row, {
    'journal.digest': { ...digest, tenantId: 'tenant-b' },
    'agents.list': [{ tenantId: 'tenant-b', functionId: 'fn-a', lifecycle: 'active' }],
  });
  const blocked = await answerSystemActivity(wrong, 'Was macht Function A gerade?', { model });
  expect(blocked.items[0].journal).toBeNull();
  expect(blocked.items[0].lifecycles).toEqual([]);
  await expect(
    answerSystemActivity(
      { ...ctx, meta: { tenantId: 'tenant-a' } },
      'Was macht Function A gerade?',
      { model }
    )
  ).rejects.toThrow(/Authenticated/);
});

test('unknown/ambiguous function is clarified without guessed state calls or ID-text matching', async () => {
  for (const [target, fixture, state] of [
    ['unmatched phrase', model, 'function_unknown'],
    [
      'Function A',
      { functions: [...model.functions, { ...model.functions[0], functionId: 'fn-b' }] },
      'function_ambiguous',
    ],
    ['fn-a', model, 'function_unknown'],
  ]) {
    const ctx = context();
    const result = await answerSystemActivity(ctx, `Was macht ${target} gerade?`, {
      model: fixture,
    });
    expect(result.state).toBe(state);
    expect(ctx.call).not.toHaveBeenCalled();
    expect(renderWorkbenchResponse(result, 'system_activity_query')).toMatch(/Welche Funktion/);
  }
});

test('AC-06: missing sources give a clear response, never knowledge, RAG or personal-agent fallback', async () => {
  const ctx = { meta, call: jest.fn().mockRejectedValue(new Error('SERVICE_NOT_AVAILABLE')) };
  const result = await answerSystemActivity(ctx, 'Was macht Function A gerade?', { model });
  expect(result.state).toBe('state_unavailable');
  expect(renderWorkbenchResponse(result, 'system_activity_query')).toMatch(/nicht erreichbar/);
  expect(ctx.call.mock.calls.map(([name]) => name)).toEqual([
    'activation.explain',
    'journal.digest',
    'agents.list',
  ]);
  const overview = await answerSystemActivity(ctx, 'Woran arbeitest du?', { model });
  expect(overview.state).toBe('state_unavailable');
});

test('overview is bounded, prefers active functions, and never renders raw policy text', async () => {
  const functions = Array.from({ length: 12 }, (_, i) => ({
    functionId: `fn-${i}`,
    label: `Function ${i}`,
  }));
  const ctx = context(row, {
    'activation.list': functions.map((fn) => ({ ...row, functionId: fn.functionId })),
    'activation.explain': { activations: [] },
    'journal.digest': {
      ...digest,
      openExpectations: [{ summary: 'Routing advice only.', hiddenRefCount: 5 }],
    },
  });
  const result = await answerSystemActivity(ctx, 'Welche Agents laufen?', { model: { functions } });
  expect(result.items).toHaveLength(5);
  expect(result.remaining).toBe(7);
  expect(renderWorkbenchResponse(result, 'system_activity_query')).not.toMatch(
    /Routing advice|\[object Object\]/
  );
});

test('real Workbench activity reads leave every service database unchanged and never record a turn', async () => {
  const { createAdapter } = require('./helpers/shared-service/real-adapter');
  const functions = getFunctionModel().functions;
  const adapter = await createAdapter({ jest, functions });
  try {
    const dbs = [
      adapter.service.db,
      adapter.coverageService.db,
      adapter.journal.db,
      adapter.agents.db,
      ...Object.entries(adapter.workbench)
        .filter(([name]) => name.endsWith('Db'))
        .map(([, db]) => db),
    ];
    const before = await Promise.all(dbs.map((db) => db.allDocs({ include_docs: true })));
    await adapter.apply({
      type: 'activity',
      tenantId: 'tenant-a',
      actorId: 'actor-a',
      functionId: functions[0].functionId,
    });
    const after = await Promise.all(dbs.map((db) => db.allDocs({ include_docs: true })));
    expect(after).toEqual(before);
    expect(adapter.coverageService.pendingTurns).toBe(0);
    const observed = (await adapter.snapshot()).activityQueries;
    expect(observed).toHaveLength(1);
    expect(observed[0]).toMatchObject({
      mode: 'system_activity_query',
      knowledgeCalls: 0,
      ragCalls: 0,
    });
    expect(observed[0].answerState).toEqual(observed[0].journalDigest);
  } finally {
    await adapter.close();
  }
});

test('inventory overview selects pinned functions and remains empty when none are pinned', async () => {
  const ctx = context(row, { 'activation.list': [row] });
  const empty = await answerSystemActivity(ctx, 'Was gehört zum Inventar?', { model });
  expect(empty.items).toEqual([]);
  expect(renderWorkbenchResponse(empty, 'system_activity_query')).toMatch(
    /keine Funktionen als Inventar/
  );
  const pinned = { ...row, attention: { ...row.attention, tier: 'inventory' } };
  const full = await answerSystemActivity(
    context(pinned, { 'activation.list': [pinned] }),
    'Was gehört zum Inventar?',
    { model }
  );
  expect(full.items).toHaveLength(1);
  expect(renderWorkbenchResponse(full, 'system_activity_query')).toContain('Inventar');
});

test('open journal summaries are bounded while counts remain exact', async () => {
  const entries = Array.from({ length: 25 }, (_, i) => ({
    summary: `Observation ${i}`,
    at: '2026-01-01T00:00:00.000Z',
    hiddenRefCount: 0,
  }));
  const result = await answerSystemActivity(
    context(row, { 'journal.digest': { ...digest, openExpectations: entries } }),
    'Was macht Function A gerade?',
    { model }
  );
  expect(result.items[0].journal.openExpectations).toHaveLength(10);
  expect(result.items[0].journal.openExpectationCount).toBe(25);
  expect(renderWorkbenchResponse(result, 'system_activity_query')).toContain(
    'Offene Erwartungen: 25'
  );
});
