'use strict';

jest.mock('../src/llm-client', () => ({ generateStructured: jest.fn(), generateChat: jest.fn() }));
const llm = require('../src/llm-client');
const { selectDatasetCandidates } = require('../src/dataset-routing');
const {
  candidatesFor,
  resolveCapabilityNeed,
  runCapabilityLoop,
} = require('../src/workbench-capability-loop');
const { generateDatasetRoutingFixture } = require('../scripts/generate-dataset-fixtures');
const fixture = generateDatasetRoutingFixture();
const record = {
  id: 'synthetic-dataset',
  tenantId: fixture.fact.tenantId,
  title: fixture.title,
  sourceName: fixture.filename,
  current: true,
  period: { from: '2025-01-01', to: '2025-12-31' },
  semantic: { anchors: fixture.anchors, units: { value: 'kW' } },
  provenance: { conversationId: 'synthetic-upload' },
};
const options = {
  model: require('../src/function-model').getFunctionModel(),
  index: require('../src/operation-capability-index').loadOperationCapabilityIndex(),
  api: require('../openapi-export.json'),
  datasetAvailable: true,
};
const situation = { concern: '', situation: '', hypotheses: [], retrievalTerms: [], dataNeeds: '' };

afterEach(() => jest.resetAllMocks());

test.each(fixture.questions.filter((entry) => ['external', 'memory'].includes(entry.kind)))(
  'unrelated $kind question has no dataset candidate even with one table',
  async ({ question }) => {
    llm.generateStructured.mockResolvedValue({ datasetIds: [] });
    const matches = await selectDatasetCandidates([record], question, {
      conversationId: 'synthetic-upload',
    });
    expect(matches).toEqual([]);
    const candidates = candidatesFor(
      { ...situation, concern: question, dataNeeds: question },
      { ...options, datasetCandidates: matches }
    );
    expect(candidates.some((candidate) => candidate.operation.action === 'dataset.query')).toBe(
      false
    );
    const prompt = JSON.parse(llm.generateStructured.mock.calls[0][1]);
    expect(prompt.instruction).toContain('KEIN hinreichender Bezug');
    expect(prompt.datasets[0]).not.toHaveProperty('rows');
  }
);

test.each([
  { from: '2025-01-01T00:00:00Z', to: '2025-12-31T23:45:00Z' },
  { from: '01.01.2025 00:00', to: '31.12.2025 23:45' },
])('calendar relevance accepts confirmed German and ISO catalog dates: %j', async (period) => {
  const previousReads = [
    { source: 'dataset.query', metadata: { tenantId: record.tenantId, datasetId: record.id } },
  ];
  expect(
    await selectDatasetCandidates([{ ...record, period }], 'Wie hoch war die Jahresenergie 2025?', {
      previousReads,
    })
  ).toHaveLength(1);
  expect(llm.generateStructured).not.toHaveBeenCalled();
  llm.generateStructured.mockResolvedValue({ datasetIds: [] });
  expect(
    await selectDatasetCandidates([{ ...record, period }], 'Wie hoch war die Jahresenergie 2024?', {
      previousReads,
    })
  ).toEqual([]);
});

test('a generic follow-up uses only its previously grounded tenant dataset, without another selector call', async () => {
  const reads = [
    { source: 'dataset.query', metadata: { tenantId: record.tenantId, datasetId: record.id } },
  ];
  expect(
    await selectDatasetCandidates([record], 'Gibt es Auffälligkeiten?', { previousReads: reads })
  ).toEqual([record]);
  expect(llm.generateStructured).not.toHaveBeenCalled();
  llm.generateStructured.mockResolvedValue({ datasetIds: [] });
  expect(
    await selectDatasetCandidates(
      [record],
      fixture.questions.find((entry) => entry.kind === 'external').question,
      { previousReads: reads }
    )
  ).toEqual([]);
  expect(
    await selectDatasetCandidates([record], 'Gibt es Auffälligkeiten?', {
      previousReads: [
        { ...reads[0], metadata: { ...reads[0].metadata, tenantId: 'foreign-synthetic' } },
      ],
    })
  ).toEqual([]);
});

test('catalog selection fails closed rather than falling back to all tables', async () => {
  llm.generateStructured.mockRejectedValue(new Error('unavailable'));
  expect(await selectDatasetCandidates([record], 'Gibt es Auffälligkeiten?')).toEqual([]);
});

test('a matching dataset and another source can execute in the same capability loop', async () => {
  const candidates = candidatesFor(
    { ...situation, concern: 'MaStR installations', dataNeeds: 'MaStR installations' },
    { ...options, datasetCandidates: [record] }
  );
  const dataset = candidates.find((entry) => entry.operation.action === 'dataset.query');
  const market = candidates.find(
    (entry) => entry.operation.action === 'energy-market.installations'
  );
  expect(dataset).toBeDefined();
  expect(market).toBeDefined();
  const ctx = {
    broker: { getLocalService: () => ({ schema: { actions: {} } }) },
    call: jest.fn(async (action) =>
      action === 'dataset.query'
        ? {
            datasetId: record.id,
            rowCount: 35040,
            responseText: '1.243,7 kW am 14.01.2025 18:15\n\nHerkunft: synthetischer Datensatz.',
          }
        : { results: [{ capacityKW: 200 }] }
    ),
  };
  llm.generateChat
    .mockResolvedValueOnce({
      toolCalls: [
        { name: dataset.name, args: { input: { id: record.id } } },
        { name: market.name, args: { input: { installationType: 'solar' } } },
      ],
    })
    .mockResolvedValue({ toolCalls: [] });
  const meta = {
    authUser: {
      tenantId: record.tenantId,
      userId: 'synthetic-person',
      roles: ['ROLE_EDM', 'ROLE_GRID_OPERATOR'],
      scope: 'full-access',
    },
  };
  const result = await runCapabilityLoop(ctx, {
    ...options,
    situation: { ...situation, dataNeeds: 'MaStR installations' },
    message: 'Vergleiche den Datensatz mit Registerdaten.',
    meta,
    datasetCandidates: [record],
    candidates,
  });
  expect(
    result.trace.filter((entry) => entry.status === 'available').map((entry) => entry.name)
  ).toEqual(['dataset.query', 'energy-market.installations']);
  expect(result.evidence.map((entry) => entry.source)).toEqual([
    'dataset.query',
    'energy-market.installations',
  ]);
  expect(result.evidence[0].value).toContain('14.01.2025 18:15');
});

test('elliptical matching questions can trigger the existing routing without domain keywords', () => {
  const result = resolveCapabilityNeed(situation, 'Gibt es Auffälligkeiten?', {
    ...options,
    datasetCandidates: [record],
  });
  expect(result.candidates.some((entry) => entry.operation.action === 'dataset.query')).toBe(true);
  expect(result.situation.dataNeeds).toBeTruthy();
});
