'use strict';

jest.mock('../src/llm-client', () => ({ generateStructured: jest.fn() }));
const llm = require('../src/llm-client');
const {
  generateManifest,
  validateManifest,
  manifestInput,
  graphVersion,
} = require('../src/project-manifest');
const { selectProjectCandidates } = require('../src/dataset-routing');
const project = { projectId: 'p-a', tenantId: 'tenant-a', title: 'Standort Nord' };
const graph = [
  { recordType: 'state', version: 'source-1', pending: false },
  {
    recordType: 'node',
    nodeId: 'n-a',
    kind: 'dataset',
    ref: 'ds-a',
    labels: ['Standort Nord'],
    attributes: { columns: [{ name: 'Leistung', type: 'number', examples: ['RAW-CELL-SECRET'] }] },
  },
  {
    recordType: 'node',
    nodeId: 'n-b',
    kind: 'entity',
    labels: ['RAW-CELL-SECRET'],
    ref: { value: 'RAW-CELL-SECRET' },
    attributes: { sampleLocations: ['RAW-CELL-SECRET'] },
  },
];
const content = () => ({
  summary: { text: 'Schema am Standort Nord', sources: ['n-a'] },
  entities: [{ name: 'Standort Nord', kind: 'subject', sources: ['n-a'] }],
  timeRanges: [],
  questionTypes: [
    {
      id: 'maximum',
      description: 'Maximum Leistung Standort Nord',
      inputs: [],
      skillRefs: [],
      sources: ['n-a'],
    },
  ],
  externalLinks: [],
});
const candidate = () => ({
  title: project.title,
  projectId: project.projectId,
  manifest: {
    ...content(),
    projectId: project.projectId,
    version: 1,
    generatedAt: new Date().toISOString(),
  },
});
beforeEach(() => jest.clearAllMocks());

test('AC-01/06: Ajv-valid generated manifest, references and metadata-only prompts', async () => {
  llm.generateStructured.mockResolvedValue(content());
  const datasets = [
    {
      id: 'ds-a',
      columns: [{ name: 'Leistung', type: 'number', examples: ['RAW-CELL-SECRET'] }],
      rows: [{ Leistung: 'RAW-CELL-SECRET' }],
      semantic: { anchors: ['RAW-CELL-SECRET'], units: { Leistung: 'kW' } },
    },
  ];
  const result = await generateManifest(project, graph, datasets, 1);
  expect(validateManifest(result, graph)).toBe(result);
  expect(llm.generateStructured).toHaveBeenCalledTimes(1);
  const prompt = llm.generateStructured.mock.calls[0][1];
  expect(prompt).not.toContain('RAW-CELL-SECRET');
  expect(prompt).toContain('Leistung');
  expect(
    manifestInput(project, graph, datasets).nodes.find((node) => node.kind === 'entity').titles
  ).toEqual([]);
});

test.each(['summary', 'entities', 'questionTypes', 'timeRanges', 'externalLinks'])(
  'AC-01: every %s assertion needs existing graph references',
  (field) => {
    const result = candidate().manifest;
    if (field === 'summary') result.summary.sources = ['missing'];
    else if (field === 'timeRanges')
      result.timeRanges = [{ from: '2025', to: '2025', sources: ['missing'] }];
    else if (field === 'externalLinks')
      result.externalLinks = [
        { endpointId: 'fixture', confidence: 1, joinKeys: [], sources: ['missing'] },
      ];
    else result[field][0].sources = ['missing'];
    expect(() => validateManifest(result, graph)).toThrow('Unknown');
    result.summary.sources = [];
    expect(() => validateManifest(result, graph)).toThrow('schema');
  }
);

test('schema rejects missing claims, skills, duplicate question types and unknown properties', () => {
  const result = candidate().manifest;
  result.questionTypes[0].skillRefs = ['not-generated-here'];
  expect(() => validateManifest(result, graph)).toThrow();
  result.questionTypes[0].skillRefs = [];
  result.questionTypes.push({ ...result.questionTypes[0] });
  expect(() => validateManifest(result, graph)).toThrow('Duplicate');
  expect(() => validateManifest({ ...candidate().manifest, rows: [] }, graph)).toThrow();
});

test('automatic routing needs subject plus type; empty/unrelated/ambiguous candidates do not bind', () => {
  const question = 'Wie hoch war das Maximum Leistung am Standort Nord 2025?';
  expect(selectProjectCandidates([candidate()], question)[0]).toMatchObject({
    projectId: 'p-a',
    explicit: true,
  });
  const implicit = candidate();
  implicit.title = 'Unterlagen A';
  expect(selectProjectCandidates([implicit], question)[0]).toMatchObject({
    projectId: 'p-a',
    explicit: false,
  });
  expect(selectProjectCandidates([], question)).toEqual([]);
  expect(
    selectProjectCandidates([implicit], 'Wie hoch war das Maximum Leistung im Depot West 2025?')
  ).toEqual([]);
  expect(selectProjectCandidates([implicit], 'Wie ist die Temperatur am Standort Nord?')).toEqual(
    []
  );
  expect(selectProjectCandidates([implicit], '2025 kW')).toEqual([]);
  expect(selectProjectCandidates([implicit, { ...implicit, projectId: 'p-b' }], question)).toEqual(
    []
  );
});

test('persistent actor-scoped corrections exclude a project/type or replace entity labels', () => {
  const c = candidate();
  c.title = 'Unterlagen A';
  const question = 'Maximum Leistung Standort Nord?';
  expect(selectProjectCandidates([{ ...c, corrections: [{ kind: 'reject' }] }], question)).toEqual(
    []
  );
  expect(
    selectProjectCandidates(
      [{ ...c, corrections: [{ kind: 'reject', questionTypeId: 'maximum' }] }],
      question
    )
  ).toEqual([]);
  expect(
    selectProjectCandidates(
      [{ ...c, corrections: [{ kind: 'entity', nodeId: 'n-a', name: 'Depot West' }] }],
      question
    )
  ).toEqual([]);
});

test('content version includes edge corrections, excludes pending graphs and tenant identities', () => {
  expect(graphVersion([{ recordType: 'state', version: 'a', pending: true }])).toBeNull();
  expect(graphVersion(graph)).toBe(
    graphVersion(graph.map((record) => ({ ...record, tenantId: 'foreign' })))
  );
  expect(graphVersion([...graph, { recordType: 'edge', edgeId: 'e-a', weight: 0 }])).not.toBe(
    graphVersion(graph)
  );
});

test('AC-07: all added routing and manifest core files use the unchanged domain-free vocabulary', () => {
  const report = require('../scripts/check-domain-free-core').checkCore({
    config: {
      corePaths: [
        'src/project-manifest*.js',
        'src/workbench-project-manifest.js',
        'services/project-manifest.service.js',
      ],
      allowlist: 'scripts/domain-free-core.allowlist.json',
      genericVocabulary: 'scripts/domain-free-core.generic-vocabulary.json',
      minimumLength: 6,
    },
  });
  expect(report.findings).toEqual([]);
});

test('dossier receives project selection and separated sources; candidates are excluded from evidence', () => {
  const {
    buildDossierMarkdown,
    buildSlimDossierMarkdown,
  } = require('../src/answer-dossier-builder');
  const input = {
    question: 'Maximum?',
    dossierState: {
      userContext: 'unknown',
      processStage: 'intake',
      answerMode: 'clarification',
      confidence: 'low',
    },
    evidence: [
      { source: 'manifest', value: 'FORBIDDEN-MANIFEST-NUMBER', metadata: { candidateOnly: true } },
      {
        source: 'dataset.query',
        value: 'Aus Projektakte A: 17; Datei: a.csv; Fundstelle: Blatt A; Hash: abc.',
        metadata: { projectTitle: 'Unterlagen A', evidenceQuality: 'validated' },
      },
    ],
    timeBudget: { totalBudgetMs: 1000 },
    completionState: 'completed',
  };
  for (const render of [buildDossierMarkdown, buildSlimDossierMarkdown]) {
    const output = render(input);
    const text = typeof output === 'string' ? output : output.dossierMarkdown;
    expect(text).toContain('Ich habe dafür die Projektakte „Unterlagen A“ herangezogen.');
    expect(text).toContain('getrennter Herkunft');
    expect(text).not.toContain('FORBIDDEN-MANIFEST-NUMBER');
  }
});
