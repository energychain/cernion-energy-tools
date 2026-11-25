'use strict';

const { ServiceBroker } = require('moleculer');
const { createDomainPackMixin } = require('../src/micro-agents/pack-mixin');
const { runMicroAgents, microAgentsEnabled } = require('../src/micro-agents/orchestrator');
const { normalizeFinding } = require('../src/micro-agents/contract');
const { selectPacks } = require('../src/micro-agents/responsibility');

// A synthetic function model: two functions, neighbours of each other.
const model = {
  parameters: { minWeight: 0.2 },
  functions: [
    {
      functionId: 'fn-a',
      domains: ['area-a'],
      services: [],
      neighbors: [{ functionId: 'fn-b', weight: 0.8 }],
    },
    {
      functionId: 'fn-b',
      domains: ['area-b'],
      services: [],
      neighbors: [{ functionId: 'fn-a', weight: 0.8 }],
    },
    { functionId: 'fn-c', domains: ['area-c'], services: [], neighbors: [] },
  ],
};

function packAlpha() {
  return {
    name: 'micro-agent.alpha',
    mixins: [
      createDomainPackMixin({
        pack: 'alpha',
        label: 'Bereich A',
        description: 'Synthetischer Bereich A',
        functionDomains: ['area-a'],
        objectKinds: [
          {
            kind: 'alpha.code',
            label: 'Code A',
            description: 'Kennung der Form A-<Zahl>',
            detect: (text) =>
              text
                .split(/\s+/u)
                .filter((token) => token.startsWith('A-'))
                .map((token) => ({ value: token, quote: token })),
          },
        ],
        expanders: {
          'alpha.code': async (_ctx, object) => ({
            facts: [
              {
                statement: `${object.value} ist im Register A geführt.`,
                value: object.value,
                role: 'identifier',
                basis: 'source',
                provenance: { source: 'register-a', ref: 'Zeile 3' },
              },
              // Refused by the contract: a deadline from the model.
              { statement: 'Frist 20.05.2026', role: 'deadline', basis: 'model', provenance: {} },
            ],
            negatives: [{ searched: object.value, scope: 'Archiv A, 2026', result: 'no_hit' }],
          }),
          concern: async () => ({
            facts: [
              {
                statement: 'Bereich A ist zuständig für die Registerführung.',
                role: 'classification',
                basis: 'source',
                provenance: { source: 'zustaendigkeit.md' },
              },
            ],
          }),
        },
        playbooks: [{ from: 'alpha.code', next: () => [{ kind: 'beta.item', value: 'B-1' }] }],
      }),
    ],
  };
}

function packBeta() {
  return {
    name: 'micro-agent.beta',
    mixins: [
      createDomainPackMixin({
        pack: 'beta',
        label: 'Bereich B',
        description: 'Synthetischer Bereich B',
        functionDomains: ['area-b'],
        objectKinds: [{ kind: 'beta.item', label: 'Eintrag B', description: 'Eintrag in B' }],
        expanders: {
          'beta.item': async (_ctx, object) => ({
            facts: [
              {
                statement: `${object.value} hängt an A.`,
                role: 'reference',
                basis: 'parsed',
                provenance: { source: 'liste-b' },
              },
            ],
          }),
          concern: async (_ctx, _object, context) => ({
            facts: context.consequenceOf
              ? [
                  {
                    statement: `Folge für B: ${context.consequenceOf}`,
                    role: 'explanation',
                    basis: 'source',
                    provenance: { source: 'regel-b' },
                  },
                ]
              : [],
          }),
          slow: () => new Promise((resolve) => setTimeout(resolve, 5000).unref()),
        },
        timeoutMs: 200,
      }),
    ],
  };
}

describe('micro-agent core', () => {
  let broker;
  beforeAll(async () => {
    broker = new ServiceBroker({ logger: false, transporter: null });
    broker.createService(packAlpha());
    broker.createService(packBeta());
    await broker.start();
  });
  afterAll(() => broker.stop());

  test('the switch is off by default and per tenant', () => {
    expect(microAgentsEnabled('t1', {})).toBe(false);
    expect(microAgentsEnabled('t1', { WORKBENCH_MICRO_AGENTS: 't0,t1' })).toBe(true);
    expect(microAgentsEnabled('t2', { WORKBENCH_MICRO_AGENTS: 'all' })).toBe(true);
  });

  test('a turn recognizes, selects, expands in two stages and checks consequences', async () => {
    const llm = {
      generateStructured: jest.fn(async (_schema, raw) => {
        const input = JSON.parse(raw);
        if (input.candidates)
          return { packs: [{ pack: 'beta', affected: true, reason: 'B nutzt A-7' }] };
        return { mentions: [{ kind: 'alpha.code', value: 'A-9', quote: 'nicht genannt' }] };
      }),
    };
    const result = await runMicroAgents({
      broker,
      call: (action, params, opts) => broker.call(action, params, opts),
      message: 'Was ist mit A-7 los?',
      llm,
      resolveFunctions: async () => ({ matches: [{ functionId: 'fn-a', score: 0.9 }] }),
      options: { registry: { model }, responsibility: { modelOptions: { model } } },
    });
    expect(result.objects.map((object) => object.kind)).toEqual(['concern', 'alpha.code']);
    // The model's mention without a verbatim quote is not an object.
    expect(result.objects.some((object) => object.value === 'A-9')).toBe(false);
    expect(result.selection.selected.map((row) => row.pack)).toEqual(['alpha']);
    expect(result.consequences.map((row) => row.pack)).toEqual(['beta']);
    const statements = result.findings.flatMap((finding) =>
      finding.facts.map((fact) => fact.statement)
    );
    expect(statements).toEqual(
      expect.arrayContaining([
        'A-7 ist im Register A geführt.',
        'Bereich A ist zuständig für die Registerführung.',
        'B-1 hängt an A.',
        'Folge für B: B nutzt A-7',
      ])
    );
    expect(statements).not.toContain('Frist 20.05.2026');
    expect(result.evidence.every((hit) => hit.retrievalSource === 'micro-agent')).toBe(true);
    expect(result.evidence.map((hit) => hit.value).join('\n')).toMatch(
      /Reichweite: Archiv A, 2026/u
    );
  });

  test('a slow expander returns an empty finding instead of failing the turn', async () => {
    const finding = await broker.call('micro-agent.beta.expand', {
      object: { kind: 'slow', value: 'x' },
    });
    expect(finding.failed).toBe('timeout');
    expect(finding.facts).toEqual([]);
  });
});

test('the contract refuses facts without source and deadlines from the model', () => {
  const { finding, dropped } = normalizeFinding(
    {
      facts: [
        { statement: 'ohne Quelle', basis: 'source', provenance: {} },
        { statement: 'Frist', role: 'deadline', basis: 'model' },
        {
          statement: 'Frist laut Regel',
          role: 'deadline',
          basis: 'rule',
          provenance: { source: 'r' },
        },
      ],
      negatives: [{ searched: 'x' }],
    },
    { pack: 'p', objectId: 'O1' }
  );
  expect(finding.facts.map((fact) => fact.statement)).toEqual(['Frist laut Regel']);
  expect(dropped.map((row) => row.reason)).toEqual([
    'missing_source',
    'deadline_without_rule',
    'negative_without_scope',
  ]);
});

test('responsibility keeps object owners even below the threshold', () => {
  const packs = [
    { pack: 'alpha', functionIds: ['fn-a'], expands: ['alpha.code'], concern: true },
    { pack: 'gamma', functionIds: ['fn-c'], expands: ['gamma.x'], concern: true },
  ];
  const result = selectPacks({
    packs,
    objects: [{ objectId: 'O2', kind: 'gamma.x', value: 'G' }],
    functionMatches: [{ functionId: 'fn-a', score: 0.8 }],
    options: { modelOptions: { model } },
  });
  expect(result.selected.map((row) => row.pack)).toEqual(['alpha', 'gamma']);
  expect(result.owners.O2).toEqual(['gamma']);
});

test('provenance: details from any source are sourced, others are reported by sentence', () => {
  const { checkProvenance } = require('../src/micro-agents/provenance');
  const result = checkProvenance('Laut Register gilt R-17A. Die Frist endet am 20.05.2026.', {
    message: 'Was ist mit R-17A?',
    evidence: [{ value: 'Zeitraum 11.04.2026', metadata: { facts: [] } }],
  });
  expect(result.sourced).toBe(false);
  expect(result.unsourced).toEqual([
    { sentence: 'Die Frist endet am 20.05.2026.', tokens: ['20.05.2026'] },
  ]);
});

test('every pack definition loads as a service with known detectors and a function link', () => {
  const fs = require('node:fs');
  const { packService, PACK_DIR } = require('../src/micro-agents/pack-service');
  const areas = fs
    .readdirSync(PACK_DIR)
    .filter((file) => file.endsWith('.json'))
    .map((file) => file.slice(0, -5));
  expect(areas.length).toBe(11);
  for (const area of areas) {
    const schema = packService(area);
    const manifest = schema.mixins[0].metadata.microAgent;
    expect(schema.name).toBe(`micro-agent.${manifest.pack}`);
    expect(manifest.description.length).toBeGreaterThan(40);
    expect(manifest.functionDomains.length + manifest.functionServices.length).toBeGreaterThan(0);
  }
});

test('tenant records enter the answer only when the conversation names them or asks for them', async () => {
  const broker = new ServiceBroker({ logger: false, transporter: null });
  broker.createService({
    name: 'micro-agent.gamma',
    mixins: [
      createDomainPackMixin({
        pack: 'gamma',
        label: 'Bereich G',
        description: 'Synthetischer Bereich G mit eigenen Beständen',
        functionDomains: ['area-a'],
        recordSources: ['store-g.'],
        expanders: {
          concern: async () => ({
            facts: [
              {
                statement: 'Projekt P-77 läuft',
                value: 'P-77',
                role: 'status',
                basis: 'source',
                provenance: { source: 'store-g.list' },
              },
              {
                statement: 'Projekt P-12 läuft',
                value: 'P-12',
                role: 'status',
                basis: 'source',
                provenance: { source: 'store-g.list' },
              },
              {
                // A short number ("1") occurs in the message too, but names no record.
                statement: 'Projekt „Sandbox Q“: Layer keine, 1 Knoten.',
                value: 'a1b2c3d4-0000-4000-8000-000000000001',
                role: 'status',
                basis: 'source',
                provenance: { source: 'store-g.list' },
              },
              {
                statement: 'Regel R gilt',
                role: 'explanation',
                basis: 'rule',
                provenance: { source: 'regelwerk' },
              },
            ],
          }),
        },
      }),
    ],
  });
  await broker.start();
  const run = (tenantScope) =>
    runMicroAgents({
      broker,
      call: (action, params, opts) => broker.call(action, params, opts),
      message: 'Wie steht es um P-77? Es geht um 1 Fall.',
      tenantScope,
      llm: { generateStructured: async () => ({ mentions: [], packs: [] }) },
      resolveFunctions: async () => ({ matches: [{ functionId: 'fn-a', score: 0.9 }] }),
      options: { registry: { model }, responsibility: { modelOptions: { model } } },
    });
  const scoped = await run(false);
  expect(scoped.findings[0].facts.map((fact) => fact.value || fact.statement)).toEqual([
    'P-77',
    'Regel R gilt',
  ]);
  expect(scoped.withheldRecords).toBe(2);
  const tenant = await run(true);
  expect(tenant.findings[0].facts).toHaveLength(4);
  await broker.stop();
});

test('graded area relevance selects the answering area and names touched ones as consequences', () => {
  const packs = [
    { pack: 'alpha', functionIds: ['fn-a'], expands: [], concern: true },
    { pack: 'beta', functionIds: ['fn-b'], expands: [], concern: true },
    { pack: 'gamma', functionIds: ['fn-c'], expands: [], concern: true },
  ];
  const result = selectPacks({
    packs,
    objects: [],
    functionMatches: [{ functionId: 'fn-c', score: 0.9 }],
    areaRelevance: { alpha: 1, beta: 0.5, gamma: 0 },
    options: { modelOptions: { model } },
  });
  expect(result.selected.map((row) => row.pack)).toEqual(['alpha']);
  expect(result.consequences.map((row) => row.pack)).toContain('beta');
  expect(result.consequences.map((row) => row.pack)).not.toContain('gamma');
});

test('a fact passage reaches the answer in its wording, within the budget of its finding', () => {
  const { findingEvidence, LIMITS, PASSAGE_BUDGET } = require('../src/micro-agents/contract');
  const { finding } = normalizeFinding(
    {
      facts: [
        {
          statement: 'Arbeitsweise zur Frage: Abschnitt „Prüfkarte“.',
          role: 'explanation',
          basis: 'source',
          provenance: { source: 'store-k.read', quote: 'Prüfkarte' },
          passage: 'Stationen: S1 Signal; S2 Prüfung. Rollenfamilien: Testprüfung.',
        },
        {
          statement: 'Zweiter Abschnitt.',
          role: 'explanation',
          basis: 'source',
          provenance: { source: 'store-k.read' },
          passage: 'a'.repeat(LIMITS.passage),
        },
        {
          statement: 'Dritter Abschnitt.',
          role: 'explanation',
          basis: 'source',
          provenance: { source: 'store-k.read' },
          passage: 'b'.repeat(PASSAGE_BUDGET - LIMITS.passage),
        },
      ],
    },
    { pack: 'gamma', objectId: 'O1' }
  );
  const [hit] = findingEvidence([{ ...finding, pack: 'gamma', objectId: 'O1' }]);
  expect(hit.value).toContain('Wortlaut:\nStationen: S1 Signal; S2 Prüfung.');
  expect(hit.value).toContain('a'.repeat(100));
  // The third passage exceeds what is left of the budget: its fact stays, its wording not.
  expect(hit.value).toContain('Dritter Abschnitt.');
  expect(hit.value).not.toContain('b'.repeat(100));
  expect(hit.metadata.keepWhole).toBe(true);
});

test('a standing pack expands the concern without taking a place of the selected packs', async () => {
  const broker = new ServiceBroker({ logger: false, transporter: null });
  const concern = (pack) => async () => ({
    facts: [
      {
        statement: `${pack} beantwortet das Anliegen.`,
        role: 'explanation',
        basis: 'source',
        provenance: { source: `${pack}.read` },
      },
    ],
  });
  broker.createService({
    name: 'micro-agent.delta',
    mixins: [
      createDomainPackMixin({
        pack: 'delta',
        label: 'Bereich D',
        description: 'Synthetischer Bereich D',
        functionDomains: ['area-c'],
        standing: true,
        expanders: { concern: concern('delta') },
      }),
    ],
  });
  broker.createService({
    name: 'micro-agent.epsilon',
    mixins: [
      createDomainPackMixin({
        pack: 'epsilon',
        label: 'Bereich E',
        description: 'Synthetischer Bereich E',
        functionDomains: ['area-c'],
        expanders: { concern: concern('epsilon') },
      }),
    ],
  });
  await broker.start();
  const result = await runMicroAgents({
    broker,
    call: (action, params, opts) => broker.call(action, params, opts),
    message: 'Ein allgemeines Anliegen ohne Bereich.',
    llm: { generateStructured: async () => ({ mentions: [], packs: [] }) },
    resolveFunctions: async () => ({ matches: [] }),
    options: { registry: { model }, responsibility: { modelOptions: { model } } },
  });
  expect(result.selection.selected).toEqual([]);
  expect(result.findings.map((finding) => finding.pack)).toEqual(['delta']);
  await broker.stop();
});

test('answer evidence keeps material marked whole beyond the passage window', () => {
  const { prepareAnswerEvidence } = require('../src/workbench-answer-evidence');
  const method = 'Station S1. '.repeat(400);
  const prepared = prepareAnswerEvidence(
    [
      { source: 'micro-agent.wissen', value: method, metadata: { keepWhole: true } },
      { source: 'archiv', value: 'Station S1. '.repeat(400) + 'Ende' },
    ],
    { concern: 'Station', retrievalTerms: [] }
  );
  expect(prepared[0].value).toBe(method);
  expect(prepared[1].value.length).toBeLessThanOrEqual(1500);
});

test('a lookup that found nothing is named in no source line', () => {
  const { sourceLine } = require('../src/workbench-answer-evidence');
  const nothing = {
    source: 'micro-agent.gamma',
    title: 'Bereich G',
    value: 'Gesucht: Preise; Reichweite: Register G; Ergebnis: no_hit',
    metadata: { answerOnly: 'micro-agent', facts: [], negatives: [{ searched: 'Preise' }] },
  };
  const found = {
    source: 'micro-agent.delta',
    title: 'Bereich D',
    value: 'Projekt P-77 läuft',
    metadata: { answerOnly: 'micro-agent', facts: [{ statement: 'Projekt P-77 läuft' }] },
  };
  const document = { source: 'archiv', title: 'Prüfleitfaden', value: 'Abschnitt 2' };
  expect(sourceLine([nothing, found, document])).toBe('Quellen: Bereich D; Prüfleitfaden');
  expect(sourceLine([nothing])).toBe('');
});
