'use strict';

jest.mock('../src/llm-client', () => ({ generateStructured: jest.fn() }));
const { readProjectEvidence, readLinkedEvidence } = require('../src/project-manifest-evidence');
const catalog = [
  {
    id: 'fixture-a',
    label: 'Katalog A',
    action: 'fixture.read',
    graphLink: { parameter: 'key', resultPath: 'data', resultField: 'key' },
  },
];
const operation = {
  action: 'fixture.read',
  operationId: 'fixture-read',
  agentable: true,
  consequenceLevel: 'none',
  operationKind: 'data_read',
  sideEffects: [],
  writesTo: [],
  domains: ['alpha'],
  requiredScopes: ['read-only'],
  parameters: { required: [{ name: 'key' }] },
};
const selected = {
  projectId: 'p-a',
  title: 'Unterlagen A',
  questionType: { id: 'maximum', sources: ['n-a'] },
  manifest: {
    externalLinks: [
      {
        endpointId: 'fixture-a',
        joinKeys: ['Token'],
        confidence: 1,
        sources: ['n-a', 'n-external'],
        claimedValue: 999999,
      },
    ],
  },
};
const node = {
  kind: 'dataset',
  nodeId: 'n-a',
  ref: 'ds-a',
  attributes: { columns: [{ name: 'Token', type: 'string' }] },
  provenance: { objectId: 'o-a', hash: 'hash-a', location: { sheet: 'Blatt A' } },
};
const object = {
  objectId: 'o-a',
  name: 'original.csv',
  hash: 'hash-a',
  extraction: { status: 'extracted' },
  derivation: { version: '1' },
};
const record = {
  id: 'ds-a',
  hash: 'hash-a',
  columns: node.attributes.columns,
  current: true,
  derivation: { version: '1' },
  provenance: { projectId: 'p-a', objectId: 'o-a' },
};
function context() {
  const ctx = {
    broker: { getLocalService: () => ({ schema: { actions: { read: {} } } }) },
    meta: {
      apiToken: { id: 'actor-a', tenantId: 'tenant-a', roles: ['ROLE_ALPHA'], scope: 'read-only' },
    },
    call: jest.fn(async (name, input) => {
      if (name === 'project-file.get') return { lifecycle: 'ready' };
      if (name === 'project-graph.nodes') return { nodes: [node], truncated: false };
      if (name === 'project-upload.objects') return [object];
      if (name === 'datapoint.datasetCatalog') return [record];
      if (name === 'project-graph.neighbors')
        return {
          nodes: [
            node,
            {
              nodeId: 'n-external',
              kind: 'external',
              ref: { catalogId: 'fixture-a', action: 'fixture.read' },
            },
          ],
          edges: [{ from: 'n-a', to: 'n-external', weight: 0.95 }],
        };
      if (name === 'dataset.query')
        return input.plan
          ? { result: [{ Token: 'observed-key' }] }
          : { datasetId: 'ds-a', rowCount: 2, responseText: 'Maximum 23 kW.' };
      if (name === 'fixture.read') return { data: { key: input.key, reference: 41 } };
      throw new Error(`Unexpected ${name}`);
    }),
  };
  return ctx;
}
const options = { catalog, operations: [operation] };

test('AC-03: mixed answer separates project SQLite result and actual read-only endpoint; join key is queried', async () => {
  const ctx = context();
  const result = await readProjectEvidence(
    ctx,
    selected,
    'Maximum Standort Nord und Katalog A?',
    options
  );
  expect(result.evidence.map((entry) => entry.source)).toEqual(['dataset.query', 'fixture.read']);
  expect(result.evidence[0].value).toContain('Aus Projektakte „Unterlagen A“: Maximum 23');
  expect(result.evidence[0].value).toContain(
    'original.csv; Fundstelle: sheet: Blatt A; Hash: hash-a'
  );
  expect(result.evidence[1].value).toContain('Aus Katalog A:');
  expect(result.evidence[1].value).toContain('41');
  expect(JSON.stringify(result)).not.toContain('999999');
  expect(ctx.call).toHaveBeenCalledWith(
    'dataset.query',
    expect.objectContaining({
      plan: expect.objectContaining({
        operations: expect.arrayContaining([expect.objectContaining({ groupBy: ['Token'] })]),
      }),
    })
  );
  expect(ctx.call).toHaveBeenCalledWith(
    'fixture.read',
    { key: 'observed-key', tenantId: 'tenant-a' },
    expect.objectContaining({ meta: ctx.meta, parentCtx: null })
  );
});

test.each([
  { consequenceLevel: 'high' },
  { sideEffects: ['external_write'] },
  { writesTo: ['records'] },
  { operationKind: 'draft_write' },
  { agentable: false },
])('write-capable or unapproved catalog endpoints never provide evidence: %j', async (change) => {
  const ctx = context();
  const result = await readLinkedEvidence(ctx, selected, 'Katalog A?', {
    catalog,
    operations: [{ ...operation, ...change }],
  });
  expect(result.evidence).toEqual([]);
  expect(result.gaps).not.toEqual([]);
  expect(ctx.call.mock.calls.some(([name]) => name === 'fixture.read')).toBe(false);
});

test('missing domain access, unrequested link, rejected graph relation, ambiguous join and unavailable endpoint fail closed', async () => {
  const ctx = context();
  expect((await readLinkedEvidence(ctx, selected, 'Nur Projektwerte?', options)).evidence).toEqual(
    []
  );
  expect(ctx.call).not.toHaveBeenCalled();
  ctx.meta.domainsAllowed = ['other'];
  expect((await readLinkedEvidence(ctx, selected, 'Katalog A?', options)).evidence).toEqual([]);
  expect(ctx.call.mock.calls.some(([name]) => name === 'fixture.read')).toBe(false);
  delete ctx.meta.domainsAllowed;
  const original = ctx.call.getMockImplementation();
  ctx.call.mockImplementation((name, input) =>
    name === 'project-graph.neighbors' ? { nodes: [], edges: [] } : original(name, input)
  );
  expect((await readLinkedEvidence(ctx, selected, 'Katalog A?', options)).gaps).toHaveLength(1);
  ctx.call.mockImplementation((name, input) =>
    name === 'dataset.query' ? { result: [{ Token: 'a' }, { Token: 'b' }] } : original(name, input)
  );
  expect((await readLinkedEvidence(ctx, selected, 'Katalog A?', options)).gaps[0]).toContain(
    'eindeutiger'
  );
  ctx.call.mockImplementation((name, input) =>
    name === 'fixture.read' ? Promise.reject(new Error('unavailable')) : original(name, input)
  );
  expect((await readLinkedEvidence(ctx, selected, 'Katalog A?', options)).evidence).toEqual([]);
});

test('changed object hashes/schema and unavailable requested fields never become project evidence', async () => {
  const ctx = context();
  const original = ctx.call.getMockImplementation();
  ctx.call.mockImplementation((name, input) =>
    name === 'project-upload.objects' ? [{ ...object, hash: 'changed' }] : original(name, input)
  );
  const result = await readProjectEvidence(ctx, selected, 'Maximum?', options);
  expect(result.evidence).toEqual([]);
  expect(result.gaps.join(' ')).toContain('Originalversion');
  expect(ctx.call.mock.calls.some(([name]) => name === 'dataset.query')).toBe(false);
});

test('a question without requested external source retains all conditions and continuation lines', async () => {
  const ctx = context();
  const question = 'Maximum am Standort Nord?\nNur 2030.';
  await readProjectEvidence(ctx, selected, question, options);
  expect(ctx.call).toHaveBeenCalledWith('dataset.query', { id: 'ds-a', question });
});

test('passage evidence is read from its current original and carries file, location and hash', async () => {
  const ctx = context();
  const original = ctx.call.getMockImplementation();
  const section = {
    ...node,
    kind: 'section',
    ref: 'doc-a',
    provenance: { ...node.provenance, location: { page: 2 } },
  };
  ctx.call.mockImplementation((name, input) => {
    if (name === 'project-graph.nodes') return { nodes: [section], truncated: false };
    if (name === 'project-upload.objects')
      return [{ ...object, derivation: { ...object.derivation, documents: ['doc-a'] } }];
    if (name === 'knowledge-rag.documentGet')
      return {
        id: 'doc-a',
        text: 'Beobachteter Wert: 37.',
        provenance: { projectId: 'p-a', objectId: 'o-a' },
      };
    return original(name, input);
  });
  const result = await readProjectEvidence(
    ctx,
    selected,
    'Welche Angabe am Standort Nord?',
    options
  );
  expect(result.evidence[0]).toMatchObject({
    source: 'knowledge-rag.documentGet',
    metadata: { hash: 'hash-a', location: { page: 2 } },
  });
  expect(result.evidence[0].value).toContain('Beobachteter Wert: 37.');
});

test('a mismatched or foreign-tenant catalog response is never evidence', async () => {
  const ctx = context();
  const original = ctx.call.getMockImplementation();
  for (const data of [
    { key: 'wrong-key', reference: 99 },
    { key: 'observed-key', reference: 99, tenantId: 'foreign' },
  ]) {
    ctx.call.mockImplementation((name, input) =>
      name === 'fixture.read' ? { data } : original(name, input)
    );
    const result = await readLinkedEvidence(ctx, selected, 'Katalog A?', options);
    expect(result.evidence).toEqual([]);
    expect(result.gaps).toHaveLength(1);
  }
});

test('an existing endpoint without display metadata uses its operation source annotation', async () => {
  const ctx = context();
  const endpoint = { ...catalog[0] };
  delete endpoint.label;
  const result = await readProjectEvidence(ctx, selected, 'Maximum Standort Nord und Catalog A?', {
    catalog: [endpoint],
    operations: [{ ...operation, summary: 'Read effective record (Catalog A + annotations)' }],
  });
  expect(result.evidence[1].value).toContain('Aus Catalog A:');
  expect(ctx.call).toHaveBeenCalledWith('dataset.query', {
    id: 'ds-a',
    question: 'Maximum Standort Nord',
  });
});
