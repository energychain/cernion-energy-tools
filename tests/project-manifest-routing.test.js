'use strict';

const { selectProjectCandidates } = require('../src/project-manifest-routing');
const { projectRoutingSources } = require('../src/project-manifest-metadata');

function candidate(projectId = 'p-a') {
  return {
    projectId,
    title: 'Projekt A',
    manifest: {
      entities: [{ name: 'Nördliche Niederlassung', sources: ['n-a'] }],
      questionTypes: [
        {
          id: 'upper-bound',
          description: 'Größter dokumentierter Messwert einer archivierten Reihe',
          sources: ['n-a'],
        },
      ],
    },
    routingSources: [
      {
        nodeId: 'n-a',
        nodeIds: ['n-a', 'n-object', 'n-entity'],
        kind: 'dataset',
        names: ['Standort Nord.csv'],
        anchors: [],
        columns: [{ name: 'Leistung [kW]', type: 'number' }],
        units: { 'Leistung [kW]': 'kW' },
        period: { from: '2025-01-01', to: '2025-12-31' },
      },
    ],
  };
}
function assess(candidates, question, options = {}) {
  let diagnosis;
  const selected = selectProjectCandidates(candidates, question, {
    ...options,
    onAssessment: (value) => {
      diagnosis = value;
    },
  });
  return { selected, diagnosis };
}
const question = 'Wie hoch war das Maximum der Leistung am Standort Nord 2025?';

test.each([
  question,
  'Wie hoch war das Leistungsmaximum am Standort Nord 2025?',
  'Wie hoch waren die Leistungen am Standorte Nord 2025?',
  'Wie hoch war die LEISTUNG am STANDORT NORD 2025?',
])('deterministic metadata selects despite a paraphrased description: %s', (text) => {
  const result = assess([candidate()], text);
  expect(result.selected).toHaveLength(1);
  expect(result.diagnosis).toMatchObject({
    reason: 'selected',
    bestProjectId: 'p-a',
    score: 1,
    margin: 1,
  });
});

test.each([
  ['Wie ist die Temperatur am Standort Nord?', 'no_content'],
  ['Maximum Leistung am Standort C 2025?', 'no_subject'],
  ['Maximum Leistung im Depot West 2025?', 'no_subject'],
  ['2025 kW', 'no_subject'],
  ['Standort Nord 2025 kW', 'no_content'],
])('unrelated or unit/year-only agreement never selects: %s', (text, reason) => {
  expect(assess([candidate()], text)).toMatchObject({ selected: [], diagnosis: { reason } });
});

test('period influences score but an absent year remains a concrete query gap', () => {
  const result = assess([candidate()], question.replace('2025', '2030'));
  expect(result.selected).toHaveLength(1);
  expect(result.diagnosis).toMatchObject({ score: 0.9, periodMatch: false });
  expect(assess([candidate()], question.replace('2025', '2030'), { minScore: 0.95 })).toMatchObject(
    { selected: [], diagnosis: { reason: 'below_threshold' } }
  );
});

test('equally plausible projects remain ambiguous regardless of ordering', () => {
  for (const candidates of [
    [candidate(), candidate('p-b')],
    [candidate('p-b'), candidate()],
  ]) {
    expect(assess(candidates, question)).toMatchObject({
      selected: [],
      diagnosis: { reason: 'ambiguous', margin: 0 },
    });
  }
});

test('margin includes a plausible competitor below the score threshold', () => {
  const second = candidate('p-b');
  second.routingSources[0].period = { from: '2026-01-01', to: '2026-12-31' };
  expect(assess([candidate(), second], question, { minScore: 0.95 })).toMatchObject({
    selected: [],
    diagnosis: { reason: 'ambiguous', margin: 0.1 },
  });
  expect(assess([candidate(), second], question, { minMargin: 0.05 }).selected).toHaveLength(1);
});

test.each([{ kind: 'reject' }, { kind: 'reject', questionTypeId: 'upper-bound' }])(
  'correction remains effective with deterministic metadata: %j',
  (correction) => {
    const entry = candidate();
    entry.corrections = [correction];
    expect(assess([entry], question)).toMatchObject({
      selected: [],
      diagnosis: { reason: 'corrected' },
    });
  }
);

test('object/entity manifest references resolve only to linked source nodes', () => {
  const entry = candidate();
  entry.manifest.questionTypes[0].sources = ['n-object'];
  const result = assess([entry], question);
  expect(result.selected[0].questionType.sources).toEqual(['n-object', 'n-a']);
  expect(entry.manifest.questionTypes[0].sources).toEqual(['n-object']);
  entry.manifest.questionTypes[0].sources = ['unrelated-node'];
  expect(assess([entry], question).selected).toEqual([]);
});

test('umlauts and ASCII variants match deterministic entity anchors and field forms', () => {
  const entry = candidate();
  entry.routingSources[0].names = ['original.csv'];
  entry.routingSources[0].anchors = [{ name: 'Südliches Depot', nodeId: 'n-entity' }];
  entry.routingSources[0].columns = [{ name: 'Füllmenge', type: 'number' }];
  expect(
    assess([entry], 'Wie hoch waren die Fuellmengen am suedlichen Depot 2025?').selected
  ).toHaveLength(1);
});

test('metadata projection includes authorized schemas/anchors, never rows or foreign semantics', () => {
  const nodes = [
    { nodeId: 'object', kind: 'object', ref: 'o-a', labels: ['original.csv'] },
    {
      nodeId: 'source',
      kind: 'dataset',
      ref: 'ds-a',
      labels: ['Standort Nord'],
      attributes: { columns: [{ name: 'Wert', type: 'number', examples: ['SENTINEL'] }] },
      provenance: { objectId: 'o-a' },
    },
    { nodeId: 'entity', kind: 'entity', labels: ['Bereich Nord'], provenance: { objectId: 'o-a' } },
  ];
  const foreign = {
    id: 'ds-a',
    provenance: { projectId: 'p-b' },
    title: 'FOREIGN',
    columns: [],
    semantic: { anchors: ['FOREIGN'] },
    rows: ['SENTINEL'],
  };
  const result = projectRoutingSources(nodes, [foreign], 'p-a');
  expect(result[0]).toMatchObject({
    names: ['Standort Nord', 'original.csv'],
    nodeIds: ['source', 'object', 'entity'],
    columns: [{ name: 'Wert', type: 'number' }],
    anchors: [{ nodeId: 'entity', name: 'Bereich Nord' }],
  });
  expect(JSON.stringify(result)).not.toMatch(/FOREIGN|SENTINEL/u);
});

test('subject and content must belong to the same source, not separate files in one project', () => {
  const entry = candidate();
  entry.routingSources.push({
    ...structuredClone(entry.routingSources[0]),
    nodeId: 'n-b',
    nodeIds: ['n-b'],
    names: ['Standort Süd.csv'],
    columns: [{ name: 'Temperatur', type: 'number' }],
  });
  entry.manifest.questionTypes.push({
    id: 'other',
    description: 'Temperatur am Standort Nord',
    sources: ['n-b'],
  });
  expect(assess([entry], 'Wie hoch war die Temperatur am Standort Nord 2025?').selected).toEqual(
    []
  );
});

test('passage and nonnumeric field questions remain eligible with source-bound identity', () => {
  const entry = candidate();
  entry.routingSources[0].columns = [{ name: 'Bezeichnung', type: 'string' }];
  expect(assess([entry], 'Welche Bezeichnung gilt am Standort Nord?').selected).toHaveLength(1);
  entry.routingSources[0].kind = 'section';
  entry.routingSources[0].columns = [];
  entry.manifest.questionTypes[0].description = 'Vorgaben Standort Nord';
  expect(assess([entry], 'Welche Vorgaben gelten am Standort Nord?').selected).toHaveLength(1);
  expect(assess([entry], 'Temperatur am Standort Nord?').selected).toHaveLength(0);
});

test('empty assessment has no personal or question data, and invalid thresholds are rejected', () => {
  expect(assess([], 'Private Frage')).toMatchObject({
    selected: [],
    diagnosis: { candidateCount: 0, bestProjectId: null, reason: 'no_candidates' },
  });
  expect(JSON.stringify(assess([candidate()], question).diagnosis)).not.toMatch(
    /Standort|Projekt A|2025/u
  );
  expect(() => assess([candidate()], question, { minScore: NaN })).toThrow('Invalid');
});

test('a known empty metadata projection cannot fall back to an invented manifest description', () => {
  const entry = candidate();
  entry.routingSources = [];
  entry.manifest.questionTypes[0].description = 'Maximum Leistung Standort Nord';
  expect(assess([entry], question).selected).toEqual([]);
});

test('an empty question type list has its own diagnosis rather than claiming a user correction', () => {
  const entry = candidate();
  entry.manifest.questionTypes = [];
  expect(assess([entry], question)).toMatchObject({
    selected: [],
    diagnosis: { reason: 'no_question_type' },
  });
});
