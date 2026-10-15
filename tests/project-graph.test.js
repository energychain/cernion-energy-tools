'use strict';
jest.mock('../src/llm-client', () => ({
  embeddings: jest.fn(async (texts) => texts.map(() => [1, 0])),
  capabilities: jest.fn(() => ({ embeddings: true })),
  generateStructured: jest.fn(async () => ({ edges: [{ relation: 'joinsOn', weight: 1 }] })),
  generateText: jest.fn(),
}));
const Database = require('better-sqlite3');
const { deriveGraph, weight } = require('../src/project-graph-derive');
const { catalogLinks, metadataMatches } = require('../src/project-graph-catalog');
const policy = require('../src/project-graph-policy');
const { validateCorrection } = require('../src/shared-service-learning');
const fixture = require('./fixtures/project-graph-cases.json');
const { auth } = require('./helpers/project-ingest');
const catalogAuth = () => {
  const meta = auth();
  meta.apiToken.scope = 'read-only';
  return meta;
};
const catalogContext = (call) => ({
  meta: catalogAuth(),
  call,
  broker: { getLocalService: () => null },
});

function source(tokens = fixture.cases[0].tokens) {
  const db = new Database(':memory:');
  const { normalizeAnchor } = require('../src/tenant-memory-store');
  db.function('graph_anchor', { deterministic: true }, normalizeAnchor);
  db.function('graph_rank', { deterministic: true }, (value) => policy.identity(value));
  db.exec(
    'CREATE TABLE project_candidates (object_id TEXT, version TEXT, kind TEXT, value TEXT, location TEXT, catalog_field TEXT)'
  );
  const objects = [0, 1, 2, 3].map((i) => ({
    objectId: 'object-' + i,
    name: 'Source ' + i,
    hash: 'hash-' + i,
    derivation: { version: '1' },
  }));
  const datasets = [0, 1, 2].map((i) => ({
    id: 'ds_' + String(i + 1).repeat(32),
    title: 'Table ' + i,
    sheet: 'Sheet1',
    columns: [
      { name: 'Token', type: 'string' },
      { name: 'Ordinal', type: 'number' },
      { name: 'Instant', type: 'timestamp' },
    ],
    provenance: { objectId: objects[i].objectId },
    period: i ? { from: '2026-01-01T00:00:00Z', to: '2026-01-02T00:00:00Z' } : {},
    quality: { intervalMinutes: 60 },
  }));
  const candidate = db.prepare('INSERT INTO project_candidates VALUES (?, ?, ?, ?, ?, ?)');
  datasets.forEach((record, i) => {
    db.exec(`CREATE TABLE "${record.id}" (row_number INTEGER, c0 TEXT, c1 REAL, c2 TEXT)`);
    const insert = db.prepare(`INSERT INTO "${record.id}" VALUES (?, ?, ?, ?)`);
    tokens.forEach((value, j) => {
      const key = i === 2 ? 'Other-' + j : value;
      insert.run(j, key, j + 1, '2026-01-01T00:00:00Z');
      candidate.run(
        objects[i].objectId,
        '1',
        'identifier',
        key,
        JSON.stringify({ sheet: 'Sheet1', row: j + 2, column: 'Token' }),
        null
      );
    });
  });
  candidate.run(
    'object-3',
    '1',
    'label',
    tokens[0],
    JSON.stringify({ chapter: 'Section A', line: 1 }),
    null
  );
  const documents = [
    {
      id: 'section-0',
      title: 'Description',
      anchorText: normalizeAnchor(`Token: ${tokens[0]}`),
      provenance: { objectId: 'object-3' },
      sourceLocation: { chapter: 'Section A' },
    },
  ];
  return {
    db,
    objects,
    datasets,
    documents,
    tenantId: 'tenant-a',
    projectId: 'project-a',
    limits: policy.limits(),
  };
}
function semanticEdges(graph) {
  return [...graph.edges.values()].filter((edge) =>
    ['joinsOn', 'timeAligned', 'describes'].includes(edge.relation)
  );
}
test.each(fixture.cases)('gold graph precision/recall: $domain', ({ tokens }) => {
  const input = source(tokens);
  try {
    const graph = deriveGraph(input);
    const refs = new Map(
      [...graph.nodes.values()].map((node) => [
        node.nodeId,
        node.kind +
          ':' +
          (node.kind === 'dataset'
            ? input.datasets.findIndex((record) => record.id === node.ref)
            : 0),
      ])
    );
    const actual = semanticEdges(graph).map((edge) => [
      refs.get(edge.from),
      refs.get(edge.to),
      edge.relation,
    ]);
    expect(actual.sort()).toEqual([...fixture.expected].sort());
    const tp = actual.filter((row) =>
      fixture.expected.some((expected) => JSON.stringify(expected) === JSON.stringify(row))
    ).length;
    expect({ precision: tp / actual.length, recall: tp / fixture.expected.length }).toEqual({
      precision: 1,
      recall: 1,
    });
    expect([...graph.edges.values()].some((edge) => edge.relation === 'sameEntity')).toBe(true);
    expect([...graph.edges.values()].filter((edge) => edge.relation === 'contains')).toHaveLength(
      graph.nodes.size - input.objects.length
    );
    expect(
      [...graph.edges.values()].filter((edge) => edge.relation === 'derivedFrom')
    ).toHaveLength(graph.nodes.size - input.objects.length);
  } finally {
    input.db.close();
  }
});
test('hubs, numeric sequences, timestamps and invented LLM edges cannot supply a join', () => {
  const input = source();
  try {
    input.datasets.forEach((record) => {
      record.columns[0].type = 'number';
    });
    expect(semanticEdges(deriveGraph(input)).filter((edge) => edge.relation === 'joinsOn')).toEqual(
      []
    );
    input.datasets.forEach((record) => {
      record.columns[0].type = 'string';
      record.columns.push(
        ...Array.from({ length: 7 }, (_, i) => ({ name: 'Hub' + i, type: 'string' }))
      );
      input.db.exec(`ALTER TABLE "${record.id}" ADD COLUMN c3 TEXT`);
    });
    // A repeated feature present in at least a quarter of columns contributes no overlap.
    const graph = deriveGraph(sourceWithHubs(input));
    expect(
      [...graph.edges.values()].filter((edge) => ['joinsOn', 'describes'].includes(edge.relation))
    ).toEqual([]);
  } finally {
    input.db.close();
  }
});
function sourceWithHubs(input) {
  input.datasets.forEach((record) => {
    for (let i = 3; i < 10; i++) {
      if (i !== 3) input.db.exec(`ALTER TABLE "${record.id}" ADD COLUMN c${i} TEXT`);
      input.db.exec(`UPDATE "${record.id}" SET c${i} = c0`);
    }
    input.db.exec(
      `UPDATE "${record.id}" SET c0 = 'Common State', c3 = 'Common State', c4 = 'Common State', c5 = 'Common State', c6 = 'Common State', c7 = 'Common State', c8 = 'Common State', c9 = 'Common State'`
    );
  });
  return input;
}
test('time intervals and overlap must be compatible', () => {
  const input = source();
  try {
    input.datasets[2].quality.intervalMinutes = 17;
    expect(
      semanticEdges(deriveGraph(input)).filter((edge) => edge.relation === 'timeAligned')
    ).toEqual([]);
    input.datasets[2].quality.intervalMinutes = 60;
    input.datasets[2].period.from = '2027-01-01';
    input.datasets[2].period.to = '2027-01-02';
    expect(
      semanticEdges(deriveGraph(input)).filter((edge) => edge.relation === 'timeAligned')
    ).toEqual([]);
  } finally {
    input.db.close();
  }
});
test('all volume and work budgets reject before persistence; invalid references cannot enter SQL', () => {
  const input = source();
  try {
    for (const [key, value] of [
      ['nodes', 1],
      ['runNodes', 1],
      ['edges', 1],
      ['runEdges', 1],
      ['pairs', 1],
      ['columns', 1],
      ['candidates', 1],
    ])
      expect(() => deriveGraph({ ...input, limits: { ...input.limits, [key]: value } })).toThrow(
        /limit/
      );
    expect(() =>
      deriveGraph({ ...input, datasets: [{ ...input.datasets[0], id: 'other; DROP TABLE x' }] })
    ).toThrow('reference');
    const graph = deriveGraph({ ...input, limits: { ...input.limits, sketch: 1 } });
    expect(graph.columns.some((column) => column.sampled)).toBe(true);
    expect(weight(Array(100).fill({ kind: 'anchor', score: 1 }))).toBe(0.9);
  } finally {
    input.db.close();
  }
});

test.each([
  {
    id: 'catalog-one',
    action: 'fixture.first',
    field: 'Token',
    parameter: 'key',
    resultPath: 'rows',
    resultField: 'key',
  },
  {
    id: 'catalog-two',
    action: 'fixture.second',
    field: 'Token',
    parameter: 'reference',
    resultPath: 'records',
    resultField: 'reference',
  },
])('catalog-only linkage works without code changes: $id', async (spec) => {
  const input = source(
    spec.id === 'catalog-two' ? fixture.cases[1].tokens : fixture.cases[0].tokens
  );
  try {
    const graph = deriveGraph(input),
      calls = [];
    const ctx = {
      meta: catalogAuth(),
      broker: { getLocalService: () => null },
      call: jest.fn(async (action, params, options) => {
        calls.push({ action, params, options });
        return { [spec.resultPath]: [{ [spec.resultField]: params[spec.parameter] }] };
      }),
    };
    const entries = [
      {
        id: spec.id,
        action: spec.action,
        graphLink: {
          keyFields: [spec.field],
          parameter: spec.parameter,
          resultPath: spec.resultPath,
          resultField: spec.resultField,
        },
      },
    ];
    const operations = [
      {
        action: spec.action,
        agentable: true,
        operationKind: 'data_read',
        sideEffects: [],
        writesTo: [],
        consequenceLevel: 'none',
      },
    ];
    await catalogLinks(ctx, graph, {
      entries,
      operations,
      domains: [],
      limits: { ...input.limits, calls: 2 },
    });
    expect([...graph.nodes.values()].filter((node) => node.kind === 'external')).toHaveLength(1);
    expect([...graph.edges.values()].filter((edge) => edge.origin === 'observed')).toHaveLength(1);
    expect(calls).toHaveLength(2);
    expect(calls[0].params.tenantId).toBe('tenant-a');
    expect(calls[0].options.parentCtx).toBeNull();
    expect(calls[0].options.meta.apiToken).toEqual(catalogAuth().apiToken);
    expect([...fixture.cases[0].tokens, ...fixture.cases[1].tokens]).toContain(
      calls[0].params[spec.parameter]
    );
  } finally {
    input.db.close();
  }
});
test('catalog requires metadata, verified read safety, exact sample hit and bounded timeout', async () => {
  const input = source();
  try {
    const entries = [
      {
        id: 'x',
        action: 'fixture.read',
        graphLink: {
          keyFields: ['Token'],
          parameter: 'key',
          resultPath: 'rows',
          resultField: 'key',
        },
      },
    ];
    const safe = {
      action: 'fixture.read',
      agentable: true,
      operationKind: 'data_read',
      sideEffects: [],
      writesTo: [],
      consequenceLevel: 'none',
    };
    for (const operation of [
      { ...safe, writesTo: ['x'] },
      { ...safe, sideEffects: ['x'] },
      { ...safe, consequenceLevel: 'external' },
      {},
    ]) {
      const call = jest.fn();
      await catalogLinks(
        { meta: catalogAuth(), broker: { getLocalService: () => null }, call },
        deriveGraph(input),
        {
          entries,
          operations: [operation],
          domains: [],
          limits: input.limits,
        }
      );
      expect(call).not.toHaveBeenCalled();
    }
    for (const call of [
      jest.fn(async () => ({ rows: [{ key: 'Unrelated' }], count: 999 })),
      jest.fn(async () => {
        throw new Error('failed');
      }),
      jest.fn(() => new Promise(() => {})),
    ]) {
      const graph = deriveGraph(input);
      await catalogLinks(
        { meta: catalogAuth(), broker: { getLocalService: () => null }, call },
        graph,
        {
          entries,
          operations: [safe],
          domains: [],
          limits: { ...input.limits, timeout: 5, calls: 1 },
        }
      );
      expect([...graph.nodes.values()].some((node) => node.kind === 'external')).toBe(false);
    }
    const call = jest.fn();
    await catalogLinks(
      { meta: catalogAuth(), broker: { getLocalService: () => null }, call },
      deriveGraph(input),
      {
        entries: [
          { ...entries[0], graphLink: { ...entries[0].graphLink, keyFields: ['Missing'] } },
        ],
        operations: [safe],
        domains: [],
        limits: input.limits,
      }
    );
    expect(call).not.toHaveBeenCalled();
  } finally {
    input.db.close();
  }
});
test('project edge corrections validate confirm/reject/weight without a function model', () => {
  for (const kind of ['confirm', 'reject', 'weight'])
    expect(
      validateCorrection({
        target: 'projectEdge',
        correction: { projectId: 'p', edgeId: 'e', kind, weight: 0.4 },
      }).kind
    ).toBe(kind);
  for (const correction of [
    {},
    { projectId: 'p', edgeId: 'e', kind: 'invent' },
    { projectId: 'p', edgeId: 'e', kind: 'weight', weight: 2 },
    { projectId: 'p', edgeId: 'e', kind: 'confirm', extra: true },
  ])
    expect(() => validateCorrection({ target: 'projectEdge', correction })).toThrow();
});

test('catalog observation honors source scope, role and domain permissions', async () => {
  const input = source();
  const entries = [
    {
      id: 'p',
      action: 'fixture.read',
      graphLink: { keyFields: ['Token'], parameter: 'key', resultField: 'key' },
    },
  ];
  const operations = [
    {
      action: 'fixture.read',
      agentable: true,
      operationKind: 'data_read',
      consequenceLevel: 'none',
      writesTo: [],
      sideEffects: [],
      domains: ['domain-a'],
    },
  ];
  try {
    const absentScope = catalogContext(jest.fn());
    delete absentScope.meta.apiToken.scope;
    const absentRole = catalogContext(jest.fn());
    absentRole.broker.getLocalService = () => ({
      schema: { actions: { read: { requiredRoles: ['ROLE_OTHER'] } } },
    });
    const absentDomain = catalogContext(jest.fn());
    absentDomain.meta.domainsAllowed = ['domain-b'];
    for (const ctx of [absentScope, absentRole, absentDomain]) {
      const graph = deriveGraph(input);
      await catalogLinks(ctx, graph, { entries, operations, domains: [], limits: input.limits });
      expect(ctx.call).not.toHaveBeenCalled();
      expect([...graph.nodes.values()].some((node) => node.kind === 'external')).toBe(false);
    }
  } finally {
    input.db.close();
  }
});

test('metadata matching reuses semantic aliases, formats, patterns and ontology classes', () => {
  const domains = require('../src/semantic-domains').semanticDomains;
  const domain = domains.find((entry) =>
    Object.values(entry.fieldProfiles || {}).some((field) => field.aliases?.length)
  );
  const [key, field] = Object.entries(domain.fieldProfiles).find(
    ([, value]) => value.aliases?.length
  );
  expect(
    metadataMatches(
      { column: { name: field.aliases[0] }, values: [] },
      { catalogField: `${domain.id}.${key}` },
      domains
    )
  ).toBe(true);
  const column = {
    column: { name: 'Other', format: 'format-a', oeoClasses: ['class-a'] },
    values: ['lumen a7'],
  };
  for (const link of [
    { formats: ['format-a'] },
    { oeoClasses: ['class-a'] },
    { pattern: '^lumen a[0-9]$' },
  ])
    expect(metadataMatches(column, link, [])).toBe(true);
  expect(metadataMatches(column, { formats: ['format-b'], keyFields: ['Missing'] }, [])).toBe(
    false
  );
  expect(() => metadataMatches(column, { pattern: '.*' }, [])).toThrow();
  expect(
    metadataMatches(
      { column: { name: 'Other' }, values: ['abc 123'], rawValues: { 'abc 123': 'ABC-123' } },
      { pattern: '^ABC-[0-9]{3}$' },
      []
    )
  ).toBe(true);
});

test('candidate location alone cannot attribute a value to an unrelated passage', () => {
  const input = source();
  try {
    input.documents[0].anchorText = 'unrelated passage';
    const graph = deriveGraph(input);
    expect([...graph.edges.values()].filter((edge) => edge.relation === 'describes')).toEqual([]);
  } finally {
    input.db.close();
  }
});

test('two low-cardinality repeated columns stay below threshold; a distinct directory remains joinable', () => {
  const input = source();
  try {
    for (const record of input.datasets.slice(0, 2)) {
      record.rowCount = 100;
      const insert = input.db.prepare(`INSERT INTO "${record.id}" VALUES (?, ?, ?, ?)`);
      for (let row = 2; row < 100; row++)
        insert.run(row, fixture.cases[0].tokens[row % 2], row + 1, '2026-01-01T00:00:00Z');
    }
    expect(
      [...deriveGraph(input).edges.values()].filter((edge) =>
        ['joinsOn', 'sameEntity', 'describes'].includes(edge.relation)
      )
    ).toEqual([]);
    input.db.exec(`DELETE FROM "${input.datasets[0].id}" WHERE row_number >= 2`);
    input.datasets[0].rowCount = 2;
    expect(
      semanticEdges(deriveGraph(input)).filter((edge) => edge.relation === 'joinsOn')
    ).toHaveLength(1);
  } finally {
    input.db.close();
  }
});

test('repeated row candidates collapse into one scoped entity with bounded provenance samples', () => {
  const input = source();
  try {
    const insert = input.db.prepare('INSERT INTO project_candidates VALUES (?, ?, ?, ?, ?, ?)');
    const rows = input.db.prepare(`INSERT INTO "${input.datasets[0].id}" VALUES (?, ?, ?, ?)`);
    input.db.transaction(() => {
      for (let row = 2; row < 1002; row++) {
        rows.run(row, fixture.cases[0].tokens[0], row + 1, '2026-01-01T00:00:00Z');
        insert.run(
          'object-0',
          '1',
          'identifier',
          fixture.cases[0].tokens[0],
          JSON.stringify({ sheet: 'Sheet1', row: row + 2, column: 'Token' }),
          null
        );
      }
    })();
    const graph = deriveGraph(input);
    expect(graph.nodes.size).toBe(15);
    const entity = [...graph.nodes.values()].find(
      (node) =>
        node.kind === 'entity' && node.ref.objectId === 'object-0' && node.ref.value.endsWith('a7')
    );
    expect(entity.attributes.occurrences).toBe(1001);
    expect(entity.attributes.sampleLocations).toHaveLength(16);
    expect([...graph.edges.values()].filter((edge) => edge.relation === 'sameEntity')).toHaveLength(
      4
    );
  } finally {
    input.db.close();
  }
});
