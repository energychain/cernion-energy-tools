'use strict';

jest.mock('../src/llm-client', () => ({ generateStructured: jest.fn() }));
const llm = require('../src/llm-client');
const descriptor = require('../src/tenant-evidence-descriptor');
const { validateManifest } = require('../src/project-manifest');
const { selectProjectCandidates } = require('../src/project-manifest-routing');
const { scopedDatasets } = require('../src/workbench-data-scope');
const row = () => ({
  id: 'ds-example',
  tenantId: 'tenant-a',
  version: 1,
  title: 'Objekt Nord',
  sourceName: 'Objekt Nord.csv',
  hash: 'content-hash',
  columns: [{ name: 'Bestand', type: 'number', examples: ['SECRET-CELL'], sensitive: false }],
  period: { from: '2025-01-01', to: '2025-12-31' },
  semantic: { anchors: ['Objekt Nord'], units: { Bestand: 'kg' } },
  rows: [{ Bestand: 'SECRET-CELL' }],
  profile: { examples: ['SECRET-CELL'] },
  provenance: { conversationId: 'chat-a', caseId: 'case-a' },
});
const generated = (sources) => ({
  summary: { text: 'Bestandsgrundlage', sources },
  entities: [{ name: 'Nördlicher Bezugsgegenstand', kind: 'subject', sources }],
  timeRanges: [],
  questionTypes: [
    {
      id: 'quantity',
      description: 'Archivierte Mengen einordnen',
      inputs: [],
      skillRefs: [],
      sources,
    },
  ],
  externalLinks: [],
});
beforeEach(() => llm.generateStructured.mockReset());

test('same manifest schema, metadata-only prompts and per-source provenance/sensitivity', async () => {
  llm.generateStructured.mockImplementation(async (_schema, prompt) =>
    generated([JSON.parse(prompt).nodes[0].nodeId])
  );
  const value = row();
  value.evidenceDescriptor = await descriptor.ensureDescriptor('dataset', value);
  expect(llm.generateStructured).toHaveBeenCalledTimes(1);
  expect(llm.generateStructured.mock.calls[0][1]).not.toContain('SECRET-CELL');
  const input = descriptor.descriptorInput('dataset', value);
  expect(validateManifest(value.evidenceDescriptor.manifest, input.nodes)).toBeTruthy();
  const candidate = descriptor.evidenceCandidate('dataset', value, 'actor-a');
  expect(candidate.provenance).toMatchObject({
    filename: 'Objekt Nord.csv',
    hash: 'content-hash',
    conversationId: 'chat-a',
    caseId: 'case-a',
  });
  expect(candidate.routingSources[0]).toMatchObject({
    units: { Bestand: 'kg' },
    period: value.period,
  });
  expect(candidate.sensitivity).toEqual({ level: 'tenant_internal', requiredClearance: [] });
  expect(await descriptor.ensureDescriptor('dataset', value)).toBe(value.evidenceDescriptor);
});

test('document prompts contain section themes, never paragraph bodies or embedded table cells', async () => {
  llm.generateStructured.mockImplementation(async (_schema, prompt) =>
    generated([JSON.parse(prompt).nodes[0].nodeId])
  );
  const value = {
    id: 'doc-a',
    tenantId: 'tenant-a',
    name: 'Objekt Nord.txt',
    version: 1,
    text: '# Objekt Nord\n## Bestand\nSECRET-PARAGRAPH\n| Feld | Wert |\n| --- | --- |\n| x | SECRET-CELL |',
  };
  await descriptor.ensureDescriptor('document', value);
  const prompt = llm.generateStructured.mock.calls[0][1];
  expect(prompt).toContain('Bestand');
  expect(prompt).not.toContain('SECRET-PARAGRAPH');
  expect(prompt).not.toContain('SECRET-CELL');
});

test('coalescing includes tenant identity as a plain queue key, never in a content hash', async () => {
  let finish;
  llm.generateStructured.mockImplementation(
    () =>
      new Promise((resolve) => {
        finish = resolve;
      })
  );
  const value = row();
  const first = descriptor.ensureDescriptor('dataset', value);
  const second = descriptor.ensureDescriptor('dataset', structuredClone(value));
  expect(llm.generateStructured).toHaveBeenCalledTimes(1);
  finish(generated([`dataset:${value.id}`]));
  expect(await first).toBe(await second);
  expect(descriptor.descriptorInput('dataset', value).fingerprint).toBe(
    descriptor.descriptorInput('dataset', { ...value, tenantId: 'foreign-tenant' }).fingerprint
  );
});

test('invalid assertions are sanitized and provider failures retain a usable deterministic minimum', async () => {
  llm.generateStructured.mockResolvedValue(generated(['unknown-source']));
  const value = row();
  const degraded = await descriptor.ensureDescriptor('dataset', value);
  expect(degraded.generation.fallback).toBe(true);
  expect(degraded.generation.discardedReferences).toBeGreaterThan(0);
  expect(degraded.manifest.summary.text).toBe(value.title);
  expect(
    selectProjectCandidates(
      [descriptor.evidenceCandidate('dataset', { ...value, evidenceDescriptor: degraded }, 'a')],
      'Bestand Objekt Nord 2025?'
    )
  ).toHaveLength(1);
  llm.generateStructured.mockReset().mockRejectedValue(new Error('synthetic offline'));
  const failed = await descriptor.ensureDescriptor('dataset', value);
  expect(failed.generation.reason).toBe('generation_failed');
  expect(llm.generateStructured).toHaveBeenCalledTimes(1);
});

test('legacy descriptors are generated only for relevant sources and invalid metadata is repairable', () => {
  const value = row();
  expect(descriptor.needsDescriptor('dataset', value, 'Bestand Objekt Nord?', 'a')).toBe(true);
  expect(descriptor.needsDescriptor('dataset', value, 'Temperatur Depot West?', 'a')).toBe(false);
  value.evidenceDescriptor = { ...descriptor.minimalDescriptor('dataset', value), manifest: {} };
  expect(descriptor.needsDescriptor('dataset', value, 'Bestand Objekt Nord?', 'a')).toBe(true);
});

test('complementary sources share the existing scorer; competitors and configured thresholds abstain', () => {
  const a = descriptor.evidenceCandidate('dataset', row(), 'a');
  const b = {
    ...a,
    id: 'document:doc-a',
    projectId: 'document:doc-a',
    sourceType: 'document',
    sourceId: 'doc-a',
  };
  expect(selectProjectCandidates([a, b], 'Bestand Objekt Nord?')).toHaveLength(2);
  const competitor = {
    ...a,
    id: 'dataset:other',
    projectId: 'dataset:other',
    title: 'Anderes Objekt',
    routingSources: [
      {
        ...a.routingSources[0],
        names: ['Anderes Objekt'],
        anchors: [{ nodeId: 'other', name: 'Anderes Objekt' }],
      },
    ],
    manifest: { ...a.manifest, entities: [], questionTypes: a.manifest.questionTypes },
  };
  expect(
    selectProjectCandidates([a, competitor], 'Bestand Objekt Nord und Anderes Objekt?')
  ).toEqual([]);
  expect(
    selectProjectCandidates([{ ...a, title: 'Unterlage X' }], 'Bestand Objekt Nord?', {
      minScore: 1,
    })
  ).toEqual([]);
  expect(() => selectProjectCandidates([a], 'Bestand?', { minMargin: -1 })).toThrow();
});

test('scope remains structural without a descriptor selection and adds only the selected source IDs', () => {
  const a = row(),
    b = { ...row(), id: 'other', provenance: { conversationId: 'chat-b' } };
  expect(scopedDatasets([a, b], 'Bestand Objekt Nord?', { conversationId: 'chat-b' })).toEqual([b]);
  expect(
    scopedDatasets([a, b], 'Bestand Objekt Nord?', {
      conversationId: 'chat-b',
      tenantEvidenceIds: [a.id],
    })
  ).toEqual([a, b]);
  expect(scopedDatasets([a], 'Bestand Objekt Nord?', {})).toEqual([]);
});

test('complete identifiers qualify as anchors without weakening content relevance', () => {
  const value = row();
  value.title = 'Unterlage A';
  value.sourceName = 'Tabelle.csv';
  value.semantic.anchors = ['REF-A123'];
  const candidate = descriptor.evidenceCandidate('dataset', value, 'a');
  expect(selectProjectCandidates([candidate], 'Bestand REF-A123?')).toHaveLength(1);
  expect(selectProjectCandidates([candidate], 'Bestand REF-A1234?')).toEqual([]);
  expect(selectProjectCandidates([candidate], 'Temperatur REF-A123?')).toEqual([]);
});

test('Phase B registers a source adapter without another catalog, selector or correction switch', async () => {
  const registry = require('../src/tenant-evidence-sources');
  const candidate = {
    ...descriptor.evidenceCandidate('dataset', row(), 'a'),
    sourceType: 'session',
  };
  registry.registerEvidenceSource({
    type: 'session',
    service: 'phase-b',
    action: 'candidates',
    correctionAction: 'phase-b.correct',
    candidates: async () => [candidate],
    read: async () => ({ evidence: [{ value: 'Fresh authorized source' }] }),
  });
  const ctx = {
    broker: {
      getLocalService: (name) =>
        name === 'phase-b' ? { schema: { actions: { candidates: {} } } } : null,
    },
  };
  const candidates = await registry.evidenceCandidates(ctx, 'Bestand Objekt Nord?');
  expect(selectProjectCandidates(candidates, 'Bestand Objekt Nord?')).toHaveLength(1);
  expect(await registry.readEvidenceSource(ctx, candidate, 'Bestand?')).toMatchObject({
    evidence: [{ value: 'Fresh authorized source' }],
  });
  expect(
    descriptor.validateEvidenceCorrection({
      sourceType: 'session',
      sourceId: 'session-a',
      kind: 'reject',
    })
  ).toMatchObject({ sourceType: 'session' });
});
