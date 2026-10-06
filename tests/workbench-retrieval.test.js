'use strict';

const { selectSources, filterEvidence, collectEvidence } = require('../src/workbench-retrieval');
const defaults = require('../src/workbench-knowledge-sources.json');
const methods = require('../services/personal-agent/methods-part-01-of-11');
const willi = require('../services/willi-mako.service');
const situation = {
  concern: 'Überfällige Netzanmeldung prüfen',
  situation: 'Netzanmeldung mit Referenz 99000000001',
  retrievalTerms: ['Netzanmeldung', 'Eingangsbestätigung'],
  hypotheses: [{ kind: 'domain', id: 'market_communication', confidence: 0.9 }],
};

test('source selection uses hypotheses and configurable catalog without EDIFACT keywords', () => {
  expect(selectSources(situation)).not.toContain('willi-mako');
  expect(selectSources(situation, { access: { 'willi-mako': true } })).toContain('willi-mako');
  const catalog = {
    ...defaults,
    sources: [
      { id: 'custom', domains: ['arbitrary-domain'], functions: ['F-custom'], scoreScale: 'unit' },
    ],
  };
  expect(
    selectSources(
      { hypotheses: [{ kind: 'function', id: 'F-custom', confidence: 0.8 }] },
      { catalog }
    )
  ).toEqual(['custom']);
  expect(
    selectSources(
      { hypotheses: [{ kind: 'function', id: 'F-custom', confidence: 0.1 }] },
      { catalog }
    )
  ).toEqual([]);
});

test('score and situation relevance reject unrelated hits, with explicit reasons in trace', () => {
  const result = filterEvidence(
    [
      { value: 'Netzanmeldung prüfen', metadata: { hitId: 'low', score: 0.58 } },
      { value: 'Rotorblattwartung von Windturbinen', metadata: { hitId: 'offtopic', score: 0.99 } },
      {
        value: 'Netzanmeldung und Eingangsbestätigung abgleichen',
        metadata: { hitId: 'good', score: 0.91 },
      },
    ],
    situation
  );
  expect(result.hits).toHaveLength(1);
  expect(result.rejected.map((hit) => hit.reason)).toEqual([
    'below_score_threshold',
    'situation_mismatch',
  ]);
  expect(
    filterEvidence([{ value: 'Netzanmeldung', metadata: { score: 0.58 } }], situation, {
      catalog: { ...defaults, minimumScore: 0.5 },
    }).hits
  ).toHaveLength(1);
});

test('Willi pipeline retains bounded excerpt, URL, distinct sections and no-call boundaries, deduplicating repeated sections', async () => {
  const doc = {
    id: 'doc',
    sectionId: 'one',
    title: 'Netzanmeldung',
    excerpt: 'Eingangsbestätigung und Referenz prüfen.',
    content: 'x'.repeat(10000),
    score: 32,
    url: 'https://example.invalid/article',
  };
  const ctx = {
    meta: {},
    call: jest.fn(async () => ({
      success: true,
      data: {
        sources: [
          doc,
          doc,
          { ...doc, sectionId: 'two', excerpt: 'Netzanmeldung nach Eingang dokumentieren.' },
        ],
        noCallBoundaries: ['No send'],
      },
    })),
  };
  const result = await methods.collectCopilotMakoKnowledgeEvidence.call(methods, ctx, {
    question: situation.situation,
    selected: true,
  });
  expect(result.hits).toHaveLength(2);
  expect(result.hits[0]).toMatchObject({
    url: doc.url,
    metadata: { sourceId: 'doc', sectionId: 'one' },
  });
  expect(result.hits[0].value).toContain(doc.excerpt);
  expect(result.hits[0].value.length).toBeLessThanOrEqual(1600);
  expect(result.noCallBoundaries).toEqual(['No send']);
  const legacy = await methods.collectCopilotMakoKnowledgeEvidence.call(methods, ctx, {
    question: situation.situation,
  });
  expect(legacy.status).toBe('skipped');
});

test('resolveStructure carries search content through shared service, preserving guardrails', async () => {
  const ctx = {
    params: { query: situation.situation, limit: 5 },
    call: jest.fn(async () => ({
      success: true,
      data: {
        results: [
          {
            id: 'doc',
            title: 'Netzanmeldung',
            content: 'Netzanmeldung '.repeat(1000),
            sectionId: 'one',
            url: 'https://example.invalid/article',
          },
        ],
      },
    })),
  };
  const result = await willi.actions.resolveStructure.handler(ctx);
  expect(ctx.call).toHaveBeenCalledWith(
    'willi-mako.search',
    expect.objectContaining({ includeContent: true })
  );
  expect(result.data.sources[0].excerpt).toHaveLength(1200);
  expect(result.data.noCallBoundaries.length).toBeGreaterThan(0);
});

test('new retrieval reuses actual collectors with tenant metadata and one round of reads', async () => {
  const ctx = {
    meta: { tenantId: 'tenant-a', workbenchEvidenceAccess: { 'willi-mako': true } },
    call: jest.fn(async (name) => {
      if (name === 'knowledge-rag.query')
        return {
          results: [
            {
              id: 'good',
              score: 0.9,
              summary: 'Netzanmeldung: Referenz und Eingangsbestätigung prüfen.',
            },
          ],
        };
      if (name === 'willi-mako.resolveStructure')
        return {
          success: true,
          data: {
            sources: [
              {
                id: 'doc',
                title: 'Netzanmeldung',
                excerpt: 'Eingangsbestätigung prüfen.',
                score: 32,
              },
            ],
            noCallBoundaries: ['No send'],
          },
        };
      if (name === 'datapoint.list') return { datapoints: [] };
      if (name === 'object-store.query') return { docs: [] };
      throw new Error('Unexpected call');
    }),
  };
  const collector = { ...methods };
  const result = await collectEvidence(collector, ctx, { situation });
  expect(result.evidence.length).toBeGreaterThan(0);
  expect(result.trace.find((entry) => entry.source === 'willi-mako')).toMatchObject({
    called: true,
    hitCount: 1,
  });
  expect(result.noCallBoundaries).toEqual(['No send']);
  const read = ctx.call.mock.calls.find(([name]) => name === 'knowledge-rag.query');
  expect(read[2].meta.tenantId).toBe('tenant-a');
});

test('read capabilities require a matching hypothesis and delegate all authorization to signals', async () => {
  const { collectReadCapabilities } = require('../src/workbench-retrieval');
  const signals = {
    model: {
      functions: [
        {
          functionId: 'fn-read',
          label: 'Reference check',
          domains: ['market_communication'],
          capabilities: ['cap-read'],
        },
      ],
    },
    operations: [{ operationId: 'op-read', operationKind: 'data_read' }],
    catalogEntries: () => [{ operationId: 'op-read' }],
  };
  const ctx = {
    broker: { getLocalService: () => signals },
    meta: {
      tenantId: 'tenant-a',
      workbenchSelectedCapabilities: ['cap-read'],
      workbenchEvidenceCaseId: 'case-a',
    },
    call: jest.fn().mockRejectedValue(Object.assign(new Error('denied'), { type: 'FORBIDDEN' })),
  };
  const unmatched = await collectReadCapabilities(ctx, { ...situation, hypotheses: [] });
  expect(unmatched.hits).toEqual([]);
  expect(ctx.call).not.toHaveBeenCalled();
  const denied = await collectReadCapabilities(ctx, situation);
  expect(ctx.call).toHaveBeenCalledWith(
    'signals.observe',
    expect.objectContaining({ tenantId: 'tenant-a', operationIds: ['op-read'] }),
    expect.objectContaining({ meta: ctx.meta })
  );
  expect(denied.hits).toEqual([]);
  expect(denied.trace.operations[0].status).toBe('blocked_or_unavailable');
});

test('catalog-selected planner bypasses legacy keyword gate without inventing read parameters', async () => {
  const ctx = { meta: { tenantId: 'tenant-a' }, call: jest.fn() };
  const legacy = await methods.collectCopilotPlanningEvidence.call({}, ctx, {
    analysisSignals: { active: false },
  });
  expect(legacy.status).toBe('skipped');
  const selected = await methods.collectCopilotPlanningEvidence.call({}, ctx, {
    analysisSignals: { active: false },
    selected: true,
  });
  expect(selected.status).not.toBe('skipped');
  expect(ctx.call).not.toHaveBeenCalled();
  expect(filterEvidence(selected.hits, situation, { source: 'analysis-planner' }).hits).toEqual([]);
});

test('catalog IDs normalize punctuation without keyword-based selection', () => {
  const selected = selectSources(
    { ...situation, hypotheses: [{ kind: 'domain', id: 'grid-connection', confidence: 0.9 }] },
    { access: { 'willi-mako': true } }
  );
  expect(selected).toContain('willi-mako');
  expect(selected).toContain('analysis-planner');
});

test('function hypotheses select sources through catalog function-domain metadata', () => {
  const input = {
    ...situation,
    hypotheses: [{ kind: 'function', id: 'fn-custom', confidence: 0.9 }],
  };
  const options = {
    access: { 'willi-mako': true },
    model: { functions: [{ functionId: 'fn-custom', domains: ['grid-connection'] }] },
  };
  expect(selectSources(input, options)).toEqual(
    expect.arrayContaining(['willi-mako', 'analysis-planner'])
  );
  expect(selectSources(input, { ...options, access: {} })).not.toContain('willi-mako');
});
