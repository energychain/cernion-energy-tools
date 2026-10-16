'use strict';

jest.mock('../src/llm-client', () => ({ generateStructured: jest.fn() }));
const llm = require('../src/llm-client');
const { generateManifest, validateManifest } = require('../src/project-manifest');
const { projectRoutingSources } = require('../src/project-manifest-metadata');
const { selectProjectCandidates } = require('../src/project-manifest-routing');
const project = { projectId: 'p', tenantId: 't', title: 'Projekt A' };
const nodes = [
  {
    recordType: 'node',
    nodeId: 'd',
    kind: 'dataset',
    ref: 'data',
    labels: ['Objekt Nord'],
    attributes: {
      columns: [{ name: 'Wert', type: 'number' }],
      period: { from: '2025-01-01', to: '2025-12-31' },
    },
  },
  { recordType: 'node', nodeId: 's', kind: 'section', labels: ['Abschnitt Alpha'] },
  {
    recordType: 'node',
    nodeId: 'e',
    kind: 'entity',
    labels: ['PRIVATE-CELL'],
    provenance: { objectId: 'object' },
  },
];
const content = (sources = ['d']) => ({
  summary: { text: 'Beschreibung', sources },
  entities: [{ name: 'Objekt Nord', kind: 'subject', sources }],
  timeRanges: [{ from: '2025', to: '2025', sources }],
  questionTypes: [
    { id: 'read', description: 'Wert Objekt Nord', inputs: [], skillRefs: [], sources },
  ],
  externalLinks: [],
});
let diagnosis;
const options = () => ({
  logger: { warn: jest.fn() },
  onDiagnostics: (value) => {
    diagnosis = value;
  },
});
beforeEach(() => {
  llm.generateStructured.mockReset();
  diagnosis = null;
});
function selectable(manifest) {
  return selectProjectCandidates(
    [
      {
        projectId: 'p',
        title: project.title,
        manifest,
        generation: diagnosis,
        routingSources: projectRoutingSources(nodes, [], 'p'),
      },
    ],
    'Wie hoch war das Maximum des Werts am Objekt Nord 2025?'
  );
}

test('invalid references and unsupported assertions are removed; valid content stays selectable', async () => {
  const result = content(['invented', 'd']);
  result.entities.push({ name: 'Unbelegt', kind: 'subject', sources: ['invented'] });
  result.questionTypes.push({ ...result.questionTypes[0], id: 'bad', sources: ['invented'] });
  result.timeRanges.push({ from: '2030', to: '2030', sources: ['invented'] });
  llm.generateStructured.mockResolvedValue(result);
  const manifest = await generateManifest(project, nodes, [], 1, options());
  expect(validateManifest(manifest, nodes)).toBe(manifest);
  expect(manifest.questionTypes).toHaveLength(1);
  expect(manifest.entities).toHaveLength(1);
  expect(manifest.timeRanges).toHaveLength(1);
  expect(manifest.summary.sources).toEqual(['d']);
  expect(diagnosis).toMatchObject({
    status: 'degraded',
    attempts: 1,
    discardedReferences: 7,
    discardedClaims: 3,
    fallback: false,
  });
  expect(llm.generateStructured).toHaveBeenCalledTimes(1);
  expect(selectable(manifest)).toHaveLength(1);
});

test('no valid question type triggers exactly one regeneration with allowed IDs and no cell values', async () => {
  llm.generateStructured
    .mockResolvedValueOnce(content(['invented']))
    .mockResolvedValueOnce(content());
  const manifest = await generateManifest(project, nodes, [], 2, options());
  expect(manifest.version).toBe(2);
  expect(diagnosis).toMatchObject({ attempts: 2, fallback: false, reason: 'regenerated' });
  expect(llm.generateStructured).toHaveBeenCalledTimes(2);
  expect(JSON.parse(llm.generateStructured.mock.calls[1][1])).toMatchObject({
    allowedNodeIds: ['d', 's', 'e'],
  });
  for (const [, prompt] of llm.generateStructured.mock.calls)
    expect(prompt).not.toContain('PRIVATE-CELL');
});

test.each(['unknown', 'shape', 'error'])(
  'minimal fallback for repeated %s retains valid metadata and selection',
  async (kind) => {
    if (kind === 'error')
      llm.generateStructured.mockRejectedValue(new Error('Provider private payload'));
    else llm.generateStructured.mockResolvedValue(kind === 'shape' ? {} : content(['invented']));
    const manifest = await generateManifest(project, nodes, [], 1, options());
    expect(validateManifest(manifest, nodes)).toBe(manifest);
    expect(diagnosis).toMatchObject({
      status: 'degraded',
      fallback: true,
      attempts: kind === 'error' ? 1 : 2,
    });
    expect(manifest.questionTypes.map((type) => type.sources)).toEqual([['d'], ['s']]);
    expect(manifest.questionTypes[0].description).toContain('Wert');
    expect(manifest.entities).toContainEqual({
      name: 'PRIVATE-CELL',
      kind: 'subject',
      sources: ['e'],
    });
    expect(manifest.timeRanges[0].sources).toEqual(['d']);
    expect(selectable(manifest)).toHaveLength(1);
    expect(
      selectProjectCandidates(selectable(manifest), 'Welche Temperatur hat Objekt C?')
    ).toEqual([]);
  }
);

test('invalid summary is replaced without discarding valid question types', async () => {
  const result = content();
  result.summary.sources = ['invented'];
  llm.generateStructured.mockResolvedValue(result);
  const manifest = await generateManifest(project, nodes, [], 1, options());
  expect(manifest.summary).toEqual({ text: project.title, sources: ['d'] });
  expect(manifest.questionTypes[0].id).toBe('read');
  expect(diagnosis).toMatchObject({ discardedClaims: 1, discardedReferences: 1, fallback: false });
});

test('metadata budget failure bypasses LLM and retains bounded minimal manifest', async () => {
  const large = nodes.map((node) => ({ ...node, labels: ['x'.repeat(140000)] }));
  const manifest = await generateManifest(project, large, [], 1, options());
  expect(validateManifest(manifest, large)).toBe(manifest);
  expect(llm.generateStructured).not.toHaveBeenCalled();
  expect(diagnosis).toMatchObject({
    status: 'degraded',
    attempts: 0,
    fallback: true,
    reason: 'metadata_budget',
  });
});

test('facade parse failures get one correction attempt and then the minimum', async () => {
  llm.generateStructured.mockRejectedValue(
    new SyntaxError('LLM returned non-JSON structured response.')
  );
  const manifest = await generateManifest(project, nodes, [], 1, options());
  expect(validateManifest(manifest, nodes)).toBe(manifest);
  expect(diagnosis).toMatchObject({ attempts: 2, fallback: true, discardedClaims: 2 });
});
