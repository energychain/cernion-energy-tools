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
