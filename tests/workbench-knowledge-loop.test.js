'use strict';

const { knowledgeLoopEnabled, runKnowledgeLoop } = require('../src/workbench-knowledge-loop');

const planner = (...rounds) => {
  const calls = [];
  return {
    calls,
    generateStructured: jest.fn(async (schema, raw) => {
      calls.push(JSON.parse(raw));
      return rounds[calls.length - 1] || { enough: true, lookups: [] };
    }),
  };
};
const hit = (title, value, id) => ({ source: title, value, metadata: { sourceId: id } });

test('the switch enables all tenants or listed ones only', () => {
  expect(knowledgeLoopEnabled('t', {})).toBe(false);
  expect(knowledgeLoopEnabled('t', { WORKBENCH_KNOWLEDGE_LOOP: 'all' })).toBe(true);
  expect(knowledgeLoopEnabled('t', { WORKBENCH_KNOWLEDGE_LOOP: 'x,t' })).toBe(true);
});

test('planned lookups add evidence, a search without hit is kept as negative evidence', async () => {
  const llm = planner(
    {
      enough: false,
      lookups: [
        { source: 'knowledge-gateway', query: 'Belegarten Rückmeldung', purpose: 'Regel' },
        { source: 'knowledge-rag', query: 'Wiedervorlage Fristen', purpose: 'Frist' },
        { source: 'willi-mako', query: 'Antwortcode', purpose: 'Code' },
      ],
    },
    { enough: true, lookups: [] }
  );
  const lookup = jest.fn(async (source) => {
    if (source === 'knowledge-gateway')
      return { hits: [hit('Prozessbeschreibung', 'Getrennte Belegarten', 'doc_1')], called: true };
    if (source === 'willi-mako') return { hits: [], called: false };
    return { hits: [], called: true };
  });
  const result = await runKnowledgeLoop({
    message: 'Was ist belegt?',
    situation: { concern: 'Rückmeldung fehlt' },
    evidence: [],
    lookup,
    llm,
  });
  expect(result.evidence.map((item) => item.source)).toEqual([
    'Prozessbeschreibung',
    'Gezielte Suche ohne Treffer',
  ]);
  expect(result.evidence[1].metadata).toMatchObject({
    negative: true,
    searchedSource: 'knowledge-rag',
  });
  expect(result.trace.find((entry) => entry.source === 'willi-mako').skipped).toBe(true);
  // The second round sees what was found and what was searched.
  expect(llm.calls[1].searched).toHaveLength(3);
  expect(llm.calls[1].found.some((item) => item.excerpt.includes('Getrennte Belegarten'))).toBe(
    true
  );
});

test('hits already in the evidence are not added again', async () => {
  const known = hit('Prozessbeschreibung', 'Getrennte Belegarten', 'doc_1');
  const llm = planner({
    enough: false,
    lookups: [{ source: 'knowledge-gateway', query: 'Belegarten', purpose: 'Regel' }],
  });
  const result = await runKnowledgeLoop({
    message: 'x',
    situation: {},
    evidence: [known],
    lookup: async () => ({ hits: [known], called: true }),
    llm,
  });
  expect(result.evidence).toEqual([]);
});

test('a failed plan leaves the evidence unchanged', async () => {
  const llm = { generateStructured: jest.fn().mockRejectedValue(new Error('timeout')) };
  const logger = { warn: jest.fn(), info: jest.fn() };
  const result = await runKnowledgeLoop({
    message: 'x',
    situation: {},
    lookup: jest.fn(),
    llm,
    logger,
  });
  expect(result).toEqual({ evidence: [], trace: [] });
  expect(logger.warn).toHaveBeenCalled();
});

// Final evidence boundary (#1137): synthetic_tenant_seed fixtures with sentinels.
const {
  POLICY_VERSION,
  admitLoopEvidence,
  storedRetrieval,
} = require('../src/workbench-knowledge-loop');

const SUMMARY_KEYS = [
  'admittedCount',
  'attemptedCount',
  'failedCount',
  'judgement',
  'policyVersion',
  'sourceClasses',
  'withheldCount',
];
const JUDGEMENTS = ['none', 'admitted', 'partial', 'withheld', 'failed'];
const expectClosedSummary = (summary) => {
  expect(Object.keys(summary).sort()).toEqual(SUMMARY_KEYS);
  expect(summary.policyVersion).toBe(POLICY_VERSION);
  expect(JUDGEMENTS).toContain(summary.judgement);
  for (const key of ['admittedCount', 'attemptedCount', 'failedCount', 'withheldCount']) {
    expect(Number.isInteger(summary[key])).toBe(true);
    expect(summary[key]).toBeGreaterThanOrEqual(0);
    expect(summary[key]).toBeLessThanOrEqual(99);
  }
  for (const source of summary.sourceClasses)
    expect(['knowledge-gateway', 'knowledge-rag', 'willi-mako']).toContain(source);
};
const gateLlm = (items) => ({
  generateStructured: jest.fn(async () => (items instanceof Error ? Promise.reject(items) : items)),
});
const own = {
  source: 'Prozessbeschreibung',
  value: 'Eigene Unterlage dieses Gesprächs.',
  metadata: { documentRefs: [{ conversationId: 'conv-own' }], sourceId: 'SENTINEL-SRC-OWN' },
};
const foreign = (value = 'Fremder Vorgang SENTINEL-HIT-FOREIGN Objekt OBJ-SENTINEL-4711.') => ({
  source: 'Protokoll anderer Fall',
  value,
  metadata: { documentRefs: [{ conversationId: 'conv-other', caseId: 'CASE-SENTINEL-9' }] },
});
const options = (llm, situation = { contextScope: 'tenant' }, message = 'Wie gehe ich vor?') => ({
  scope: { conversationId: 'conv-own', caseId: 'case-own', message, situation },
  gate: {
    message,
    currentCase: { concern: 'Prüfreihenfolge klären', situation: '' },
    tenantId: 'synthetic_tenant_seed',
    llm,
  },
  dataScope: { dataRequested: false, tenantId: 'synthetic_tenant_seed' },
});

test('no loop candidates or a malformed loop result admit nothing', async () => {
  for (const loop of [{ evidence: [], trace: [] }, null, { evidence: 'x' }, { evidence: [null] }]) {
    const result = await admitLoopEvidence(loop, options(gateLlm({ items: [] })));
    expect(result.evidence).toEqual([]);
    expectClosedSummary(result.summary);
    expect(result.summary.judgement).toBe('none');
    expect(result.gate).toEqual({ decisions: [], judgementFailed: false, overflowCount: 0 });
  }
});

test('the final gate exposes only decision classes and bounded failure counts (#1117)', async () => {
  const unrelated = await admitLoopEvidence(
    { evidence: [own, foreign()], trace: [] },
    options(gateLlm({ items: [{ index: 0, decision: 'unrelated', lesson: '' }] }))
  );
  expect(unrelated.gate).toEqual({
    decisions: ['unrelated'],
    judgementFailed: false,
    overflowCount: 0,
  });
  const failed = await admitLoopEvidence(
    { evidence: [foreign()], trace: [] },
    options(gateLlm(new Error('SENTINEL-GATE-ERROR')))
  );
  expect(failed.evidence).toEqual([]);
  expect(failed.gate.judgementFailed).toBe(true);
  expect(JSON.stringify(failed.gate)).not.toMatch(/SENTINEL/);
});

test('own-conversation hits pass without a judgement and are marked answer-only', async () => {
  const llm = gateLlm({ items: [] });
  const result = await admitLoopEvidence(
    { evidence: [own], trace: [{ round: 1, source: 'knowledge-gateway', query: 'q', hits: 1 }] },
    options(llm)
  );
  expect(llm.generateStructured).not.toHaveBeenCalled();
  expect(result.evidence).toHaveLength(1);
  expect(result.evidence[0].metadata.answerOnly).toBe('knowledge-loop');
  expect(result.summary).toMatchObject({
    judgement: 'admitted',
    attemptedCount: 1,
    admittedCount: 1,
    withheldCount: 0,
    sourceClasses: ['knowledge-gateway'],
  });
});

test('an explicitly linked foreign case passes with its origin', async () => {
  const hit = {
    ...foreign('Vorgang F-77 mit Rückmeldung.'),
    metadata: { ...foreign().metadata, caseRef: 'F-77' },
  };
  const result = await admitLoopEvidence(
    { evidence: [hit], trace: [] },
    options(gateLlm({ items: [] }), { identifiers: [{ value: 'F-77' }] }, 'Wie war es bei F-77?')
  );
  expect(result.evidence.map((item) => item.value)).toEqual(['Vorgang F-77 mit Rückmeldung.']);
  expect(result.evidence[0].metadata.scopeOrigin).toBe('aus anderem Gespräch');
});

test('a privacy-safe pattern reaches the answer only as the generalized lesson', async () => {
  const result = await admitLoopEvidence(
    { evidence: [foreign()], trace: [] },
    options(
      gateLlm({
        items: [{ index: 0, decision: 'pattern', lesson: 'Erst die Zuständigkeit klären.' }],
      })
    )
  );
  expect(result.evidence).toHaveLength(1);
  expect(result.evidence[0]).toMatchObject({
    retrievalSource: 'experience',
    value: 'Erst die Zuständigkeit klären.',
  });
  expect(JSON.stringify(result)).not.toMatch(/SENTINEL/);
});

test('a lesson repeating a foreign name pair is rejected (#1138)', async () => {
  const result = await admitLoopEvidence(
    { evidence: [foreign('Im Vorgang Spur Kormoran fehlte die Rückmeldung.')], trace: [] },
    options(
      gateLlm({
        items: [
          { index: 0, decision: 'pattern', lesson: 'Wie bei Spur Kormoran zuerst nachfragen.' },
        ],
      })
    )
  );
  expect(result.evidence).toEqual([]);
  expect(JSON.stringify(result)).not.toMatch(/Kormoran/);
  expect(result.summary).toMatchObject({ judgement: 'withheld', withheldCount: 1 });
});

test.each([
  ['comparable', { items: [{ index: 0, decision: 'comparable', lesson: '' }] }],
  ['unrelated', { items: [{ index: 0, decision: 'unrelated', lesson: '' }] }],
  ['malformed decision', { items: [{ index: 0, decision: 'SENTINEL-DECISION', lesson: 'x' }] }],
  ['malformed response', { items: 'SENTINEL-ITEMS' }],
  ['judgement error', new Error('SENTINEL-JUDGE-TIMEOUT')],
])('%s foreign material stays out of the answer', async (_name, response) => {
  const logger = { warn: jest.fn(), info: jest.fn() };
  const opts = options(gateLlm(response));
  opts.gate.logger = logger;
  const result = await admitLoopEvidence({ evidence: [foreign(), own], trace: [] }, opts);
  expect(result.evidence.map((item) => item.value)).toEqual([own.value]);
  expect(result.summary).toMatchObject({
    judgement: 'partial',
    admittedCount: 1,
    withheldCount: 1,
  });
  expect(JSON.stringify(result.summary)).not.toMatch(/SENTINEL/);
});

test('foreign material not asked for is withheld by the scope; data reads need a data scope', async () => {
  const dataset = {
    source: 'dataset.query',
    value: 'Zeile SENTINEL-DATA',
    metadata: { datasetId: 'ds-SENTINEL', tenantId: 'synthetic_tenant_seed' },
  };
  const result = await admitLoopEvidence(
    { evidence: [foreign(), dataset], trace: [] },
    options(gateLlm({ items: [{ index: 0, decision: 'unrelated', lesson: '' }] }), {})
  );
  expect(result.evidence).toEqual([]);
  expect(result.summary).toMatchObject({ judgement: 'withheld', withheldCount: 2 });
});

test('an unexpected failure of the boundary withholds every candidate', async () => {
  const hostile = { source: 'x', value: 'y' };
  Object.defineProperty(hostile, 'metadata', {
    enumerable: true,
    get() {
      throw new Error('SENTINEL-BOUNDARY');
    },
  });
  const result = await admitLoopEvidence({ evidence: [hostile], trace: [] }, options());
  expect(result.evidence).toEqual([]);
  expect(result.summary).toMatchObject({ judgement: 'failed', withheldCount: 1 });
});

test('lookup errors stay out of the loop result and the counts follow the post-gate set', async () => {
  const llm = planner(
    {
      enough: false,
      lookups: [
        { source: 'knowledge-gateway', query: 'SENTINEL-QUERY-1', purpose: 'p' },
        { source: 'knowledge-rag', query: 'SENTINEL-QUERY-2', purpose: 'p' },
      ],
    },
    {
      enough: false,
      lookups: [{ source: 'willi-mako', query: 'SENTINEL-QUERY-3', purpose: 'p' }],
    }
  );
  const lookup = jest.fn(async (source) => {
    if (source === 'knowledge-gateway') return { hits: [own, foreign()], called: true };
    if (source === 'knowledge-rag') throw new Error('SENTINEL-LOOKUP-ERROR SENTINEL-QUERY-2');
    return { hits: [], called: true };
  });
  const loop = await runKnowledgeLoop({ message: 'x', situation: {}, lookup, llm });
  expect(JSON.stringify(loop)).not.toMatch(/SENTINEL-LOOKUP-ERROR/);
  expect(loop.trace.find((row) => row.source === 'knowledge-rag')).toMatchObject({ failed: true });
  const result = await admitLoopEvidence(
    loop,
    options(gateLlm({ items: [{ index: 0, decision: 'unrelated', lesson: '' }] }))
  );
  // Own hit and the negative evidence of round two pass; the foreign hit is withheld.
  expect(result.evidence.map((item) => item.source)).toEqual([
    'Prozessbeschreibung',
    'Gezielte Suche ohne Treffer',
  ]);
  expect(result.summary).toEqual({
    policyVersion: POLICY_VERSION,
    judgement: 'partial',
    attemptedCount: 3,
    admittedCount: 2,
    withheldCount: 1,
    failedCount: 1,
    sourceClasses: ['knowledge-gateway', 'knowledge-rag', 'willi-mako'],
  });
});

test('the stored retrieval is a distinct object without answer-only evidence or diagnostics', () => {
  const kept = { source: 'Fallnotiz', value: 'Eigener Stand', metadata: {} };
  const retrieval = {
    evidence: [
      kept,
      { ...own, metadata: { ...own.metadata, lookup: 'SENTINEL-Q', answerOnly: 'knowledge-loop' } },
      { source: 'Akte', value: 'SENTINEL-CORE', metadata: { answerOnly: 'conversation-core' } },
    ],
    trace: [{ source: 'knowledge-rag', called: true }],
    knowledgeLoop: { policyVersion: POLICY_VERSION, judgement: 'admitted' },
  };
  const stored = storedRetrieval(retrieval);
  expect(stored).not.toBe(retrieval);
  expect(stored.evidence).toEqual([kept]);
  expect(stored).not.toHaveProperty('knowledgeLoop');
  expect(stored.trace).toEqual(retrieval.trace);
  expect(JSON.stringify(stored)).not.toMatch(/SENTINEL/);
  // The answer-time object is unchanged.
  expect(retrieval.evidence).toHaveLength(3);
  expect(retrieval.knowledgeLoop.judgement).toBe('admitted');
});
