'use strict';

jest.mock('../src/llm-client', () => ({
  generateStructured: jest.fn(),
  generateText: jest.fn(),
  generateChat: jest.fn(),
  embeddings: jest.fn(async (texts) => texts.map(() => [1, 0])),
  capabilities: jest.fn(() => ({ embeddings: true })),
}));
const llm = require('../src/llm-client');
const { complete, validate } = require('./helpers/workbench-schema-stub');
const { instantiatePracticeScenario } = require('../scripts/generate-practice-evaluation-fixtures');
const { createLocalTransport } = require('../scripts/practice-evaluation-transport');
const { checkTurn } = require('../scripts/practice-evaluation-checks');
const originalEnv = { ...process.env };
let transport,
  handledDatasetRead = false,
  datasetTurnSpy;
const stubErrors = [];

function model(schema, raw) {
  const input = JSON.parse(raw);
  let value = {};
  if (input.task === 'evidence_request_kind')
    value = { contentRequested: !/^Bitte (?:ablegen|speichern)/u.test(input.question) };
  else if (input.task === 'evidence_reference_resolution')
    value = {
      sourceIds:
        input.question.includes('Depot West') ||
        /^Bitte (?:ablegen|speichern)/u.test(input.question)
          ? []
          : input.currentSources.map((source) => source.id),
    };
  else if (input.datasets && !input.nodes)
    value = {
      datasetIds: input.question.includes('Depot West')
        ? []
        : input.datasets.map((entry) => entry.id),
    };
  else if (input.nodes) {
    const sources = [input.nodes[0].nodeId];
    value = {
      summary: { text: 'Archivierte Grundlage', sources },
      entities: [{ name: 'Nördlicher Gegenstand', kind: 'subject', sources }],
      questionTypes: [
        {
          id: 'read',
          description: 'Dokumentierte Quantitäten und offene Prüfung',
          inputs: [],
          skillRefs: [],
          sources,
        },
      ],
      timeRanges: [],
      externalLinks: [],
    };
  } else if (schema.properties?.timezone)
    value = {
      title: 'Standort Nord',
      description: 'Zeitlich erfasster Bestand',
      anchors: ['Standort Nord'],
      timezone: 'Europe/Berlin',
      timeField: 'Datum',
      intervalConvention: 'begin',
      units: { Datum: '', 'Bestand (kg)': 'kg' },
      assumptions: [],
    };
  else if (input.sourceId && input.profile)
    value = {
      sources: [{ alias: 'source', sourceId: input.sourceId }],
      operations: [
        { op: 'aggregate', groupBy: [], metrics: [{ fn: 'count', as: 'rows' }] },
        { op: 'limit', count: 10 },
      ],
    };
  else if (input.untrustedEvidence)
    value = {
      answer: input.untrustedEvidence
        .map(
          (entry) =>
            `${entry.value.split('\nDatei:')[0]} (${entry.metadata.sourceLabel}, ${entry.metadata.location}).`
        )
        .join(' '),
    };
  else if (input.sections)
    value = {
      answer:
        'Standort Nord.txt, Kapitel Bestand: 80 kg. Laut Kapitel Zuordnung ist die Zuordnung offen.',
    };
  else if (schema.properties?.concern)
    value = {
      concern: 'Vorliegende Unterlagen einordnen',
      situation: 'Die Frage bezieht sich auf vorliegende Unterlagen.',
      turnKind: 'work',
      conversationShape: 'knowledge',
      missingInformation: [],
      requestedAction: { description: '', externalEffect: false, draftRequested: false },
      caseMemory: {
        applicable: input.message === 'Bitte ablegen.',
        topic: 'Standort Nord',
        status: 'Unterlage aufgenommen',
        openPoints: ['Die Zuordnung ist offen.'],
        assumptions: [],
        risks: [],
        nextSteps: [],
      },
    };
  else if (input.task === 'turn_controls')
    value = {
      turnKind: 'work_on_concrete_case',
      conversationShape: 'knowledge',
      missingInformation: [],
    };
  else if (input.task === 'output_contract')
    value = {
      requestedOutput: {
        requested: 'ordinary_answer',
        basis: '',
        kind: 'other',
        parts: [],
        constraints: [],
        forbiddenTerms: [],
        subjects: [],
      },
    };
  else if (input.task === 'token_roles')
    value = {
      tokens: input.candidates.map(({ index }) => ({
        index,
        category: 'other',
        family: '',
        meaningRequested: false,
      })),
    };
  else if (input.currentUserMessage)
    value = {
      basis: '',
      register: 'unchanged',
      concise: 'unchanged',
      questions: 'unchanged',
      wording: [],
      forbiddenTerms: [],
      preferenceOnly: false,
    };
  return validate(schema, complete(schema, value));
}

beforeAll(async () => {
  llm.generateStructured.mockImplementation((schema, raw) => {
    try {
      return model(schema, raw);
    } catch (error) {
      stubErrors.push(error.message);
      throw error;
    }
  });
  llm.generateText.mockImplementation(async (raw) => {
    const input = JSON.parse(raw);
    if (!input.schema) throw new Error('Unexpected unstructured task');
    return JSON.stringify(
      validate(
        input.schema,
        complete(input.schema, {
          interpretation: [
            {
              text: 'Für die Temperatur im Depot West liegen keine belegten Daten vor.',
              origin: 'model',
              supported: 'model',
              completedAction: false,
              specific: false,
              evidenceIds: [],
            },
          ],
          expectation: [],
          nextSteps: [],
          assumptions: [],
          draft: [],
        })
      )
    );
  });
  llm.generateChat.mockRejectedValue(new Error('Unexpected chat task'));
  const dataset = require('../services/dataset.service');
  const originalTurn = dataset.methods.datasetTurn;
  datasetTurnSpy = jest
    .spyOn(dataset.methods, 'datasetTurn')
    .mockImplementation(async function (ctx, p) {
      if (!handledDatasetRead || ctx.params.documents.length)
        return originalTurn.call(this, ctx, p);
      const rows = await ctx.call('datapoint.datasetCatalog', { operation: 'list' });
      const row = rows.find((item) => item.provenance.conversationId === ctx.params.conversationId);
      const answer = await ctx.call('dataset.query', { id: row.id, question: ctx.params.question });
      return { ...answer, handled: true };
    });
  const budget = require('../scripts/live-validation-budget').installLiveBudget();
  transport = await createLocalTransport({ budget });
});
afterAll(async () => {
  await transport?.close();
  datasetTurnSpy?.mockRestore();
  process.env = originalEnv;
});

test('generated document-table scenario passes the live deterministic checks through the local practice transport', async () => {
  const fixture = instantiatePracticeScenario('document-table', { repeat: 1 });
  const run = await transport.startRun(fixture);
  const context = {},
    replies = [],
    failures = [];
  for (const turn of fixture.turns) {
    const reply = await transport.send(run, turn);
    replies.push({ turn: turn.id, reply });
    failures.push(
      ...checkTurn(turn, reply, context)
        .filter((check) => !check.passed)
        .map((check) => ({ turn: turn.id, ...check }))
    );
  }

  expect(stubErrors).toEqual([]);
  expect(failures).toEqual([]);
  for (const id of ['question', 'reference']) {
    const reply = replies.find((entry) => entry.turn === id).reply;
    expect(reply.tenantEvidenceSelection).toHaveLength(2);
    expect(reply.responseText).toContain('Gegenüberstellung');
    expect(reply.responseText).toContain('95 kg');
    expect(reply.responseText).toContain('80 kg');
  }
  // Simulate the initial offer returning no candidates. The subsequent structural
  // query must still join the authorized document before returning its answer.
  const catalog = require('../src/evidence-endpoint-catalog');
  const candidates = catalog.projectEvidenceCandidates;
  let probes = 0;
  const offer = jest
    .spyOn(catalog, 'projectEvidenceCandidates')
    .mockImplementation((ctx, question) => {
      probes++;
      return probes === 1 ? [] : candidates(ctx, question);
    });
  const merge = jest.spyOn(require('../src/workbench-project-manifest'), 'supplementDatasetAnswer');
  try {
    const question = {
      ...fixture.turns.find((turn) => turn.id === 'question'),
      message: `Welche Aussagen zum Bestand am Standort Nord ${fixture.anchor} ergeben sich aus den Unterlagen und Daten?`,
    };
    const reference = fixture.turns.find((turn) => turn.id === 'reference');
    const combined = await transport.send(run, question);
    expect(merge).toHaveBeenCalled();
    expect(
      merge.mock.calls.some((args) =>
        args[3].evidence?.some(
          (hit) => hit.source === 'dataset.query' && /3 Zeilen/u.test(hit.value)
        )
      )
    ).toBe(true);
    expect(checkTurn(question, combined, {}).filter((check) => !check.passed)).toEqual([]);
    const next = await transport.send(run, reference);
    expect(checkTurn(reference, next, {}).filter((check) => !check.passed)).toEqual([]);
    expect(next.tenantEvidenceSelection).toHaveLength(2);
    probes = 0;
    handledDatasetRead = true;
    merge.mockClear();
    const handled = await transport.send(run, question);
    expect(merge.mock.calls.some((args) => args[3].handled === true)).toBe(true);
    expect(checkTurn(question, handled, {}).filter((check) => !check.passed)).toEqual([]);
    handledDatasetRead = false;
    // Without additional offers the structural answer is returned byte for byte.
    offer.mockResolvedValue([]);
    merge.mockClear();
    const plain = await transport.send(run, question);
    const structural = merge.mock.calls.find((args) => args[3].evidence?.length)?.[3];
    expect(structural).toBeTruthy();
    expect(plain.responseText).toBe(structural.evidence[0].value);
    expect(plain.tenantEvidenceSelection).toBeUndefined();
    expect(stubErrors).toEqual([]);
  } finally {
    handledDatasetRead = false;
    offer.mockRestore();
    merge.mockRestore();
  }
});
