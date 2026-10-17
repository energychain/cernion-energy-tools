'use strict';

jest.mock('../src/llm-client', () => ({
  generateStructured: jest.fn(),
  generateText: jest.fn(),
  generateChat: jest.fn(),
}));
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const llm = require('../src/llm-client');
const structuredMock = llm.generateStructured;
const textMock = llm.generateText;
const chatMock = llm.generateChat;
const { createLiveHarness } = require('../scripts/workbench-live-harness');
const {
  generatePracticeCatalog,
  practiceDocument,
} = require('../scripts/generate-practice-evaluation-fixtures');
const Datapoint = require('../services/datapoint.service');
const scenarios = generatePracticeCatalog().scenarios;
const { checkTurn } = require('../scripts/practice-evaluation-checks');
let broker,
  dir,
  meta,
  serial = 0;
const env = { ...process.env };
const call = (action, params) => broker.call(action, params, { meta });
const catalog = () => call('datapoint.datasetCatalog', { operation: 'list' });
const chat = (message) =>
  call('workbench.chat', {
    channel: 'open-webui',
    conversationId: 'regression',
    message,
  });
const ingest = (turn) => {
  const spec = turn.document || turn.upload;
  return chat(
    `<context><source name="${spec.name}">${practiceDocument(spec)}</source></context><user_query>${turn.message}</user_query>`
  );
};

// Return semantic classifications and plausible imperfect metadata, rather than echoing input.
async function modelStub(schema, raw) {
  const input = JSON.parse(raw);
  if (schema.properties?.kind && schema.properties?.basis) {
    const result = {
      kind: 'none',
      basis: input.question,
      datasetId: '',
      rowNumbers: [],
      units: [],
    };
    if (/\?|vergleiche|auswerten|nennen|berechne/i.test(input.question))
      return { ...result, kind: 'question' };
    if (/verwenden/i.test(input.question))
      return {
        ...result,
        kind: 'select-sheet',
        datasetId: input.datasets.find((entry) => input.question.includes(entry.sheet)).id,
      };
    if (/\bkg\b/.test(input.question)) {
      const targets = input.datasets.filter((entry) => entry.selected);
      if (input.datasets.length !== 1 && targets.length !== 1)
        return { ...result, kind: 'metadata' };
      return {
        ...result,
        kind: 'unit-answer',
        datasetId: targets[0]?.id || input.datasets[0].id,
        units: [{ field: '', unit: 'kg' }],
      };
    }
    if (/Kilogramm/.test(input.question)) {
      const multiple = /beiden Blättern/.test(input.question);
      return {
        ...result,
        kind: input.datasets.some((entry) => entry.unitQuestion) ? 'unit-answer' : 'metadata',
        datasetId: multiple ? '' : input.datasets.find((entry) => entry.selected)?.id || '',
        scope: multiple ? 'sheets' : 'dataset',
        scopeBasis: multiple ? 'beiden Blättern' : '',
        units: [{ field: '', unit: 'kg', basis: 'Kilogramm' }],
      };
    }
    return result;
  }
  if (input.datasets)
    return {
      datasetIds: input.datasets.map((entry) => entry.id),
      comparison: /vergleich/i.test(input.question),
    };
  if (input.profile && input.filename) {
    const profile = JSON.parse(input.profile).profiles[0];
    return {
      title: 'CET tabular query planning',
      timezone: 'Europe/Berlin',
      assumptions: [],
      timeField: profile.columns.find((column) => column.type === 'timestamp')?.name || '',
      units: Object.fromEntries(
        profile.columns.map((column) => [column.name, column.type === 'number' ? 'number' : ''])
      ),
    };
  }
  if (input.sourceId)
    return {
      sources: [{ alias: 'table', sourceId: input.sourceId }],
      operations: [{ op: 'aggregate', metrics: [{ fn: 'sum', field: 'Amount', as: 'total' }] }],
    };
  return null;
}

beforeAll(async () => {
  dir = fs.mkdtempSync(path.join(os.tmpdir(), 'cet-926-regression-'));
  process.env.WORKBENCH_DATASET_DB_PATH = path.join(dir, 'rows');
  process.env.DATAPOINT_SCHEDULER_ENABLED = 'false';
  process.env.LIVE_MAX_MODEL_CALLS = '200';
  ({ broker } = createLiveHarness(dir, [
    { ...Datapoint, settings: { ...Datapoint.settings, dbPath: path.join(dir, 'catalog') } },
    require('../services/dataset.service'),
    { name: 'object-store', actions: { query: () => ({ docs: [] }) } },
    {
      name: 'knowledge-rag',
      actions: { query: () => ({ results: [] }), federatedSearch: () => ({ results: [] }) },
    },
  ]));
  await broker.start();
});
beforeEach(() => {
  meta = {
    authUser: {
      tenantId: `regression-${++serial}`,
      userId: 'synthetic-person',
      roles: ['ROLE_EDM'],
      scope: 'full-access',
    },
  };
  structuredMock.mockReset().mockImplementation(modelStub);
  textMock.mockReset().mockRejectedValue(new Error('Unexpected answer call'));
  chatMock.mockReset().mockRejectedValue(new Error('Unexpected answer call'));
});
afterAll(async () => {
  await broker.stop();
  process.env = env;
  fs.rmSync(dir, { recursive: true, force: true });
});

test('live load-values fixture retains data questions and header units through complete turns', async () => {
  const scenario = scenarios.find((entry) => entry.id === 'load-values');
  const first = await ingest(scenario.turns[0]);
  expect(first.responseText).toContain('1.243,7 kW am 14.01.2025 18:15');
  expect(first.responseText).toContain('Lastprofil-A.csv');
  const energy = await chat(scenario.turns[1].message);
  expect(energy.responseText).toContain('3.478,874 MWh');
  expect(energy.responseText.match(/Herkunft:/g)).toHaveLength(1);
  const missing = await chat(scenario.turns[2].message);
  expect(missing.responseText).toMatch(/4.*(?:leer|fehl|ausgelass)/);
  for (const reply of [first, energy, missing])
    expect(reply.responseText).not.toMatch(
      /Semantik.*korrigiert|Welche Einheit|\bnumber\b|CET tabular/
    );
  const [record] = await catalog();
  expect(record.semantic.units['Wirkleistung Bezug [kW]']).toBe('kW');
  expect(record.semantic.unitQuestion).toBeUndefined();
  expect(record.audit.some((entry) => entry.kind === 'semantic-correction')).toBe(false);
  const outputs = await Promise.all(structuredMock.mock.results.map((entry) => entry.value));
  expect(outputs.filter((result) => result?.kind === 'question')).toHaveLength(2);
});

test.each(['Einheit ist kg.', 'kg'])(
  'live table-quality turns bind %s to the selected sheet and pending field',
  async (answer) => {
    const scenario = scenarios.find((entry) => entry.id === 'table-quality');
    const first = await ingest(scenario.turns[0]);
    expect(first.responseText).toContain('Export-A.xlsx – Blatt Basis');
    expect(first.responseText).toContain('Export-A.xlsx – Blatt Variant');
    expect(first.responseText).not.toMatch(/CET tabular|\bnumber\b|ds_[a-f0-9]+/);
    const compare = await chat(scenario.turns[1].message);
    expect(compare.responseText).toMatch(
      /Datensummen 40 \(Basis\) und 44 \(Variant\); Differenz 4/
    );
    expect(compare.responseText).not.toMatch(/\bnumber\b|ds_[a-f0-9]+/);
    const selection = await chat(scenario.turns[2].message);
    expect(selection.responseText).toContain('Bitte wähle den Datensatz');
    expect(selection.responseText).toContain('Export-A.xlsx – Blatt Basis (Version 1)');
    expect(selection.responseText).not.toMatch(/ds_[a-f0-9]+/);
    expect((await chat(scenario.turns[3].message)).responseText).toContain('Blatt Basis');
    const corrected = await chat(answer);
    expect(corrected.responseText).toContain('Amount: kg');
    const sum = await chat(scenario.turns[5].message);
    expect(sum.responseText).toContain('40 kg');
    expect(sum.responseText).not.toMatch(/Variant|Welche Einheit|Einheit ungeklärt|\bnumber\b/);
    const basis = (await catalog()).find((record) => record.sheet === 'Basis');
    expect(basis.semantic.unitQuestion).toEqual(
      expect.objectContaining({
        fields: ['Amount'],
        conversationId: 'regression',
        answeredAt: expect.any(String),
      })
    );
    expect(basis.audit.filter((entry) => entry.kind === 'semantic-correction')).toHaveLength(1);
    const question = await chat('Welche Einheit ist für Amount gespeichert?');
    expect(question.responseText).not.toMatch(/Semantik.*korrigiert/);
    expect((await catalog()).find((record) => record.id === basis.id).audit).toEqual(basis.audit);
  }
);

test.each(['unit-answer', 'metadata'])(
  'complete turns persist a literal unit for both sheets from %s',
  async (kind) => {
    const scenario = scenarios.find((entry) => entry.id === 'table-quality');
    await ingest(scenario.turns[0]);
    await chat(scenario.turns[1].message);
    structuredMock.mockImplementation(async (schema, raw) => {
      const result = await modelStub(schema, raw);
      if (result?.units?.[0]?.basis === 'Kilogramm') return { ...result, kind };
      return result;
    });
    const receipt = await chat('Die Maßeinheit Kilogramm gilt in beiden Blättern.');
    expect(receipt.responseText).toContain('Amount: Kilogramm');
    expect(receipt.responseText).toContain('Blatt Basis');
    expect(receipt.responseText).toContain('Blatt Variant');
    for (const record of await catalog()) {
      expect(record.semantic.units.Amount).toBe('Kilogramm');
      expect(record.semantic.unitQuestion.answeredAt).toEqual(expect.any(String));
      expect(record.audit.filter((entry) => entry.kind === 'semantic-correction')).toHaveLength(1);
    }
    const sum = await chat(scenario.turns[5].message);
    expect(sum.responseText).toContain('40 Kilogramm');
    expect(sum.responseText).toContain('44 Kilogramm');
    expect(sum.responseText).toContain('Differenz 4 Kilogramm');
    expect(sum.responseText).not.toMatch(/Welche Einheit|Einheit ungeklärt/);
    // A later sheet choice still limits the next answer to that stored source.
    await chat('Bitte Blatt Basis verwenden.');
    const selectedSum = await chat(scenario.turns[5].message);
    expect(selectedSum.responseText).toContain('40 Kilogramm');
    expect(selectedSum.responseText).not.toContain('Variant');
    expect(textMock).not.toHaveBeenCalled();
    expect(chatMock).not.toHaveBeenCalled();
  }
);

test('a short unit answer with multiple pending sheets asks for a target instead of falling through', async () => {
  const scenario = scenarios.find((entry) => entry.id === 'table-quality');
  await ingest(scenario.turns[0]);
  structuredMock.mockImplementation(async (schema, raw) => {
    if (schema.properties?.kind && schema.properties?.basis)
      return {
        kind: 'unit-answer',
        basis: 'kg',
        datasetId: '',
        rowNumbers: [],
        units: [{ field: '', unit: 'kg' }],
      };
    return modelStub(schema, raw);
  });
  const reply = await chat('kg');
  expect(reply.responseText).toContain('Bitte wähle den Datensatz');
  for (const record of await catalog()) {
    expect(record.semantic.units.Amount).toBe('');
    expect(record.semantic.unitQuestion.answeredAt).toBeUndefined();
  }
  expect(textMock).not.toHaveBeenCalled();
});

test('an explicit assignment to both sheets overrides a prior sheet preference without a pending question', async () => {
  const scenario = scenarios.find((entry) => entry.id === 'table-quality');
  await ingest({ ...scenario.turns[0], message: 'Bitte die Tabellen ablegen.' });
  await chat('Bitte Blatt Basis verwenden.');
  const receipt = await chat('Die Maßeinheit Kilogramm gilt in beiden Blättern.');
  expect(receipt.responseText.match(/Amount: Kilogramm/g)).toHaveLength(2);
  for (const record of await catalog()) {
    expect(record.semantic.units.Amount).toBe('Kilogramm');
    expect(record.semantic.unitQuestion).toBeUndefined();
  }
  const reply = await chat(scenario.turns[1].message);
  expect(reply.responseText).toContain('Differenz 4 Kilogramm');
  expect(reply.responseText).not.toContain('Einheit ungeklärt');
});

test('an empty metadata correction cannot acknowledge an unsaved unit', async () => {
  const scenario = scenarios.find((entry) => entry.id === 'table-quality');
  await ingest(scenario.turns[0]);
  await chat('Bitte Blatt Basis verwenden.');
  const before = (await catalog()).find((record) => record.sheet === 'Basis');
  structuredMock.mockImplementation(async (schema, raw) => {
    if (schema.properties?.kind && schema.properties?.basis)
      return { kind: 'metadata', basis: 'kg', datasetId: before.id, rowNumbers: [], units: [] };
    return modelStub(schema, raw);
  });
  const reply = await chat('Einheit ist kg.');
  expect(reply.responseText).toContain('Bitte nenne die Spalte und die richtige Angabe');
  expect(reply.responseText).not.toMatch(/korrigiert|festgehalten/);
  expect((await catalog()).find((record) => record.id === before.id)).toEqual(before);
});

test.each([true, false])(
  'explicit units persist with pending question=%s and a model-normalized unit spelling',
  async (pending) => {
    const scenario = scenarios.find((entry) => entry.id === 'table-quality');
    await ingest({
      ...scenario.turns[0],
      message: pending ? scenario.turns[0].message : 'Bitte die Tabellen ablegen.',
    });
    for (const record of await catalog())
      expect(Boolean(record.semantic.unitQuestion)).toBe(pending);
    await chat('Bitte Blatt Basis verwenden.');
    const receipt = await chat('Die Maßeinheit für die genannten Daten ist Kilogramm.');
    expect(receipt.responseText).toContain('Amount: Kilogramm');
    const sum = await chat(scenario.turns[5].message);
    expect(sum.responseText).toContain('40 Kilogramm');
    expect(sum.responseText).not.toMatch(/Variant|Einheit ungeklärt|Welche Einheit/);
    const records = await catalog();
    expect(records.find((record) => record.sheet === 'Basis').semantic.units.Amount).toBe(
      'Kilogramm'
    );
    expect(records.find((record) => record.sheet === 'Variant').semantic.units.Amount).toBe('');
    expect(textMock).not.toHaveBeenCalled();
  }
);

test.each([false, true])(
  'variant comparison renders speaking metric names with filtered=%s and distinct internal aliases',
  async (filtered) => {
    const scenario = scenarios.find((entry) => entry.id === 'table-quality');
    await ingest(scenario.turns[0]);
    structuredMock.mockImplementation(async (schema, raw) => {
      const input = JSON.parse(raw);
      if (input.sourceId)
        return {
          sources: [{ alias: 'table', sourceId: input.sourceId }],
          operations: [
            ...(filtered ? [{ op: 'filter', field: 'Group', operator: 'eq', value: 'a' }] : []),
            {
              op: 'aggregate',
              groupBy: filtered ? [] : ['Group'],
              metrics: [
                { fn: 'sum', field: 'Amount', as: `sum_amount_${input.sourceId}` },
                { fn: 'count', as: `row_count_${input.sourceId}` },
              ],
            },
          ],
        };
      return modelStub(schema, raw);
    });
    const reply = await chat('Vergleiche Amount nach Group in beiden Blättern.');
    expect(reply.responseText).toContain('Summe (Amount): 30 (Basis), 33 (Variant); Differenz 3');
    expect(reply.responseText).toContain('Anzahl: 2 (Basis), 2 (Variant); Differenz 0 Zeilen');
    expect(reply.responseText).not.toMatch(/sum_amount|row_count|ds_[a-f0-9]+|\bnumber\b/);
    const checks = checkTurn(scenario.turns[1], reply);
    expect(checks.find((entry) => entry.id === 'internal-codes').passed).toBe(true);
    expect(checks.find((entry) => entry.id === 'uuid').passed).toBe(true);
  }
);

test('unbound unit replies and metadata copied from column names cannot mutate a dataset', async () => {
  await ingest(scenarios.find((entry) => entry.id === 'load-values').turns[0]);
  const [before] = await catalog();
  expect(
    (
      await call('dataset.turn', {
        question: 'kg',
        conversationId: 'regression',
      })
    ).handled
  ).toBe(false);
  structuredMock.mockImplementation(async (schema, raw) => {
    if (schema.properties?.kind && schema.properties?.basis)
      return {
        kind: 'metadata',
        basis: 'Wirkleistung Bezug [kW]',
        datasetId: before.id,
        rowNumbers: [],
        units: [{ field: 'Wirkleistung Bezug [kW]', unit: 'kW' }],
      };
    return modelStub(schema, raw);
  });
  const reply = await chat('Wie hoch war die Jahresenergie 2025 im abgelegten Lastprofil?');
  expect(reply.responseText).toContain('3.478,874 MWh');
  expect((await catalog())[0].audit).toEqual(before.audit);
});

test.each(['metadata', 'question'])(
  'stored selection survives %s classification, lost retrieval and an empty selector',
  async (kind) => {
    const scenario = scenarios.find((entry) => entry.id === 'table-quality');
    structuredMock.mockImplementation(async (schema, raw) => {
      const input = JSON.parse(raw);
      if (schema.properties?.kind && schema.properties?.basis && /verwenden/.test(input.question))
        return {
          kind,
          basis: input.question,
          datasetId: input.datasets[0].id,
          rowNumbers: [],
          units: [],
        };
      if (schema.properties?.datasetIds) return { datasetIds: [], comparison: false };
      if (input.sourceId)
        return {
          sources: [{ alias: 'table', sourceId: input.sourceId }],
          operations: [{ op: 'aggregate', metrics: [{ fn: 'count', as: 'rows' }] }],
        };
      return modelStub(schema, raw);
    });
    textMock.mockResolvedValue(
      JSON.stringify({
        interpretation: [
          {
            text: 'Der Benutzer möchte den Abgleich durchführen.',
            supported: 'model',
            evidenceIds: [],
            codeDependencies: [],
            specific: false,
            completedAction: false,
          },
        ],
        expectation: [],
        nextSteps: [],
        assumptions: [],
        draft: [],
      })
    );
    const first = await ingest(scenario.turns[0]);
    expect(first.responseText).not.toContain('kein zugänglicher Datensatz');
    const comparison = await chat(scenario.turns[1].message);
    expect(comparison.responseText).toMatch(
      /Datensummen 40 \(Basis\) und 44 \(Variant\); Differenz 4/
    );
    const selection = await chat(scenario.turns[2].message);
    expect(selection.responseText).toContain('Bitte wähle den Datensatz');
    expect((await chat(scenario.turns[3].message)).responseText).toContain(
      'Für dieses Gespräch verwende ich Export-A.xlsx – Blatt Basis'
    );
    expect(
      (await catalog()).find((record) => record.sheet === 'Basis').selectedInConversations
    ).toContain('regression');
    const workbench = broker.getLocalService('workbench');
    const rows = await workbench.conversationsDb.allDocs({ include_docs: true });
    const pending = rows.rows
      .map(({ doc }) => doc)
      .find(
        (doc) =>
          doc.type === 'workbench_conversation_assistance' &&
          doc.tenantId === meta.authUser.tenantId
      );
    await workbench.conversationsDb.put({
      ...pending,
      retrieval: { evidence: [] },
      situation: {
        turnKind: 'knowledge',
        conversationShape: 'knowledge',
        concern: 'Interne Beschreibung',
        situation: 'Interne Beschreibung',
        timeline: [{ text: 'Früherer Kontext' }],
      },
    });
    expect((await chat('kg')).responseText).toContain('Amount: kg');
    const answer = await chat(scenario.turns[5].message);
    expect(answer.responseText).toContain('40 kg');
    expect(answer.responseText).not.toMatch(/Variant|Welche|Benutzer|Interne Beschreibung/);
    expect(textMock).not.toHaveBeenCalled();
  }
);

test('answer filter rejects internal situation copies while retaining sourced facts', () => {
  const { filterAnswer } = require('../src/workbench-answer-filter');
  const internal = 'Der Benutzer möchte den Abgleich durchführen.';
  const parsed = {
    interpretation: [
      { text: internal, supported: 'model', evidenceIds: [], codeDependencies: [] },
      {
        text: 'Die geprüfte Differenz beträgt vier.',
        supported: 'evidence',
        evidenceIds: ['E1'],
        codeDependencies: [],
      },
    ],
  };
  const evidence = [{ evidenceId: 'E1', value: 'Die geprüfte Differenz beträgt vier.' }];
  filterAnswer(parsed, {
    evidence,
    answerEvidence: evidence,
    unresolved: [],
    message: 'Vergleiche die Blätter.',
    counts: new Map(),
    normalizeCondition: (value) => value,
    internalContext: [internal],
  });
  expect(parsed.interpretation.map((claim) => claim.text)).toEqual([
    'Die geprüfte Differenz beträgt vier.',
  ]);
});
