'use strict';
jest.mock('../src/llm-client', () => ({
  generateText: jest.fn(),
  generateStructured: jest.fn(),
  generateChat: jest.fn(),
}));
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { ServiceBroker } = require('moleculer');
const llm = require('../src/llm-client');
const structuredMock = llm.generateStructured;
const textMock = llm.generateText;
const chatMock = llm.generateChat;
const fixtures = require('./fixtures/workbench-850.generated.json');
const presentation = require('../src/workbench-chat-presentation');
const { choiceCandidates } = require('../src/capability-clarification');
const { functionDisplayLabel } = require('../src/function-display-label');
const { answer } = require('../src/workbench-understanding');
const { createLiveHarness } = require('../scripts/workbench-live-harness');
const { generateDatasetFixture } = require('../scripts/generate-dataset-fixtures');
const { extractOriginal } = require('../src/file-channel-extract');
const situation = {
  concern: 'Netzanmeldung',
  situation: 'Die fachliche Antwort ist offen.',
  hypotheses: [],
  participants: [],
  identifiers: [],
  deadlines: [],
  retrievalTerms: [],
  missingInformation: [],
  requestedAction: { description: '', externalEffect: false, draftRequested: false },
  turnKind: 'work',
  conversationShape: 'task',
  outputKind: 'analysis',
};
const claim = (text, evidenceIds = []) => ({
  text,
  origin: evidenceIds.length ? 'evidence' : 'input',
  supported: evidenceIds.length ? 'evidence' : 'model',
  evidenceIds,
  specific: false,
  completedAction: false,
});
const resultWith = (text, nextSteps = []) => ({
  interpretation: [claim(text)],
  expectation: [],
  nextSteps: nextSteps.map((text) => claim(text)),
  assumptions: [],
  draft: [],
});
beforeEach(() => jest.clearAllMocks());

test('850 scenario 1: withheld review remains queued, audit records no delivery, relationship delivers once', async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'cet-850-notices-'));
  const broker = new ServiceBroker({ logger: false });
  const schema = require('../services/shared-service-notices.service');
  const model = {
    sourceHash: 'synthetic',
    functions: [
      {
        functionId: 'synthetic-function',
        label: 'Prüfung',
        capabilities: [],
        operations: [],
        neighbors: [],
      },
    ],
  };
  const notices = broker.createService({
    ...schema,
    settings: { ...schema.settings, model, dbPath: dir },
  });
  try {
    await broker.start();
    notices.canSee = jest.fn().mockResolvedValue(true);
    const doc = await notices.read('synthetic', 'synthetic-person');
    const common = { functionId: 'synthetic-function', modelSourceHash: model.sourceHash, turn: 0 };
    doc.queue = [
      {
        ...common,
        kind: 'proposal',
        sequence: 1,
        ref: 'V-1',
        eventKey: 'synthetic-review',
        text: fixtures.internalNotice,
      },
      {
        ...common,
        kind: 'memory',
        sequence: 2,
        ref: 'G-2',
        eventKey: 'synthetic-relation',
        text: fixtures.relationshipNotice,
      },
      {
        ...common,
        kind: 'quota',
        sequence: 3,
        ref: 'Q-3',
        eventKey: 'synthetic-unsafe-quota',
        text: fixtures.unsafeNotices[0],
      },
    ];
    await notices.save(doc);
    const meta = {
      authUser: {
        tenantId: 'synthetic',
        userId: 'synthetic-person',
        roles: ['ROLE_USER'],
        scope: 'read-only',
      },
    };
    const params = {
      tenantId: 'synthetic',
      actorId: 'synthetic-person',
      turnRef: 'synthetic-turn',
      fullQueue: true,
    };
    const delivered = await broker.call('notices.completeTurn', params, { meta });
    expect(delivered.block).toContain(fixtures.relationshipNotice);
    expect(delivered.block).not.toMatch(/Internal|00000000/);
    expect(delivered.items.map((item) => item.ref)).toEqual(['G-2']);
    const saved = await notices.read('synthetic', 'synthetic-person');
    expect(saved.queue.map((item) => item.ref)).toEqual(['V-1', 'Q-3']);
    expect(saved.history.map((item) => item.ref)).toEqual(['G-2']);
    expect(saved.audit).toEqual([
      expect.objectContaining({
        kind: 'notice_withheld',
        delivered: false,
        eventKey: 'synthetic-review',
      }),
      expect.objectContaining({
        kind: 'notice_withheld',
        delivered: false,
        eventKey: 'synthetic-unsafe-quota',
      }),
    ]);
    expect(
      (
        await broker.call(
          'notices.completeTurn',
          { ...params, turnRef: 'synthetic-next' },
          { meta }
        )
      ).block
    ).toBe('');
    expect((await notices.read('synthetic', 'synthetic-person')).audit).toHaveLength(2);
  } finally {
    await broker.stop();
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test('850 scenarios 2–3: summary needs no choices; requested list uses localized display labels', () => {
  expect(presentation.needsFunctionChoices(fixtures.summaryQuestion)).toBe(false);
  expect(presentation.needsFunctionChoices(fixtures.functionQuestion)).toBe(true);
  expect(presentation.needsFunctionChoices('Fortfahren', { requiresFunctionChoice: true })).toBe(
    true
  );
  const fn = {
    functionId: 'synthetic-function',
    label: 'anschlusskapazitaet_evidence_queue',
    capabilities: ['synthetic-capability'],
  };
  const displayLabel = functionDisplayLabel(fn);
  const choices = choiceCandidates(
    { candidateCapabilities: [{ capability: 'synthetic-capability' }] },
    { functions: [{ ...fn, displayLabel }] }
  );
  expect(choices[0].label).toBe('Anschlusskapazität · Nachweise · Aufgabenliste');
  expect(choices[0].label).not.toMatch(/evidence|queue|synthetic|_/);
});

describe('850 scenarios 4–5: real dataset paths', () => {
  let broker, workbench, dir, meta;
  beforeAll(async () => {
    dir = fs.mkdtempSync(path.join(os.tmpdir(), 'cet-850-dataset-'));
    process.env.WORKBENCH_DATASET_DB_PATH = path.join(dir, 'rows');
    process.env.DATAPOINT_SCHEDULER_ENABLED = 'false';
    const datapoint = require('../services/datapoint.service');
    ({ broker, workbench } = createLiveHarness(dir, [
      { ...datapoint, settings: { ...datapoint.settings, dbPath: path.join(dir, 'catalog') } },
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
        tenantId: 'synthetic-850',
        userId: 'synthetic-person',
        roles: ['ROLE_EDM'],
        scope: 'full-access',
      },
    };
    structuredMock.mockImplementation(async (_schema, raw) => {
      const value = JSON.parse(raw);
      if (value.datasets) return { datasetIds: value.datasets.map((item) => item.id) };
      if (value.profile) return null;
      return {
        ...situation,
        concern: value.message || fixtures.peakQuestion,
        situation: value.message || fixtures.peakQuestion,
        turnKind: 'knowledge',
        dataNeeds: value.message || fixtures.peakQuestion,
      };
    });
    textMock.mockResolvedValue(JSON.stringify(resultWith(fixtures.peakAnswer)));
    chatMock.mockImplementation(async (_messages, options) => {
      const tool = options.tools.find((entry) =>
        entry.function.description.startsWith('dataset.query:')
      );
      return {
        toolCalls: tool
          ? [
              {
                name: tool.function.name,
                args: {
                  input: { id: tool.function.parameters.properties.input.properties.id.enum[0] },
                },
              },
            ]
          : [],
      };
    });
  });
  afterAll(async () => {
    await broker.stop();
    delete process.env.WORKBENCH_DATASET_DB_PATH;
    delete process.env.DATAPOINT_SCHEDULER_ENABLED;
    fs.rmSync(dir, { recursive: true, force: true });
  });
  const chat = (question, content, conversationId) =>
    broker.call(
      'workbench.chat',
      {
        channel: 'api',
        conversationId,
        message: content
          ? `<context><source name="synthetic-850.csv">${content}</source></context><user_query>${question}</user_query>`
          : question,
      },
      { meta }
    );
  test('850 scenario 7: mapped chat signs with display name instead of transport identity', async () => {
    await workbench.store.saveTenantMapping({
      client: 'open-webui',
      externalOrgId: 'synthetic-850-org',
      cetTenantId: 'synthetic-850',
    });
    await workbench.store.saveUserMapping({
      client: 'open-webui',
      externalOrgId: 'synthetic-850-org',
      externalUserId: 'synthetic-850-user',
      cetTenantId: 'synthetic-850',
      cetActorId: 'synthetic-person',
      displayName: fixtures.displayName,
      roles: ['ROLE_EDM'],
    });
    structuredMock.mockResolvedValue({ ...situation, outputKind: 'correspondence' });
    textMock.mockResolvedValue(
      JSON.stringify({
        interpretation: [],
        expectation: [],
        nextSteps: [],
        assumptions: [],
        draft: [claim(fixtures.draft)],
      })
    );
    const result = await broker.call(
      'workbench.chat',
      {
        channel: 'open-webui',
        conversationId: 'synthetic-mapped-draft',
        openWebuiOrgId: 'synthetic-850-org',
        openWebuiUserId: 'synthetic-850-user',
        message: fixtures.draftQuestion,
      },
      { meta }
    );
    expect(result.responseText).toMatch(/Mit freundlichen Grüßen\s+ben/u);
    expect(result.responseText).not.toMatch(/\[Name\]|synthetic-person/u);
    const mapping = await workbench.store.getUserMapping({
      client: 'open-webui',
      externalOrgId: 'synthetic-850-org',
      externalUserId: 'synthetic-850-user',
    });
    expect(mapping.displayName).toBe('ben');
  });
  test('850 scenarios 2–3: content chat suppresses unsolicited list and retains requested German choices', async () => {
    const originalCall = broker.call.bind(broker);
    const previousModel = workbench.settings.systemActivityModel;
    const capability = 'anschlusskapazitaet_evidence_queue';
    workbench.settings.systemActivityModel = {
      functions: [
        {
          functionId: 'synthetic-function',
          label: 'internal-function',
          displayLabel: 'Anschlusskapazität prüfen',
          capabilities: [capability],
          domains: [
            'grid_connection',
            'grid-connection',
            'market_communication',
            'market-communication',
          ],
        },
      ],
    };
    broker.call = async (...args) => {
      const response = await originalCall(...args);
      return ['domain-router.classify', 'domain-router.continue'].includes(args[0])
        ? {
            ...response,
            primaryDomain: 'grid_connection',
            uncertain: true,
            candidateCapabilities: [{ capability }],
          }
        : response;
    };
    structuredMock.mockResolvedValue(situation);
    textMock.mockResolvedValue(JSON.stringify(resultWith('Die fachliche Freigabe steht aus.')));
    try {
      const summary = await chat(fixtures.summaryQuestion, null, 'synthetic-summary');
      expect(summary.responseText).not.toContain('Optional passende Funktion');
      const functions = await chat(fixtures.functionQuestion, null, 'synthetic-functions');
      expect(functions.responseText).toContain('1. Anschlusskapazität prüfen');
      expect(functions.responseText).not.toMatch(
        /internal-function|evidence queue|anschlusskapazitaet/u
      );
    } finally {
      broker.call = originalCall;
      workbench.settings.systemActivityModel = previousModel;
    }
  });
  test.each(['text', 'file'])(
    '850 scenario 4: %s path has one peak and origin, no query block or filler',
    async (channel) => {
      const csv = generateDatasetFixture();
      const content =
        channel === 'file'
          ? (
              await extractOriginal({
                extension: 'csv',
                name: 'synthetic-850.csv',
                contentBase64: Buffer.from(csv).toString('base64'),
              })
            ).text
          : csv;
      const first = await chat(fixtures.peakQuestion, content, `synthetic-${channel}`);
      const repeated = await chat(fixtures.peakQuestion, content, `synthetic-${channel}`);
      const followup = await chat(fixtures.peakQuestion, null, `synthetic-${channel}`);
      for (const response of [first, repeated, followup]) {
        expect(response.responseText.match(/1\.243,7\s*kW/g)).toHaveLength(1);
        expect(response.responseText).toContain('14.01.2025 18:15');
        expect(response.responseText).toContain('Herkunft:');
        expect(response.responseText).not.toMatch(
          /Die Abfrage umfasst|bei Bedarf|Für weitere Analysen|Optional passende Funktion/
        );
      }
    }
  );
  test('850 scenario 5: explicitly requested calculation shows the query block', async () => {
    await chat(fixtures.peakQuestion, generateDatasetFixture(), 'synthetic-details');
    const detailed = await chat(fixtures.detailsQuestion, null, 'synthetic-details');
    expect(detailed.responseText).toContain('Die Abfrage umfasst');
    expect(detailed.responseText).toContain('Herkunft:');
  });
});

test.each(['unavailable', 'timeout'])(
  '850 scenario 6: %s source failure is fachlich, no field instructions',
  async (status) => {
    textMock.mockResolvedValue(JSON.stringify(resultWith(fixtures.fieldError)));
    const response = await answer({
      situation,
      retrieval: {
        evidence: [],
        toolTrace: [{ name: 'energy-market.installations', status, called: true }],
      },
      tenantId: 'synthetic',
      message: 'Welche Leistung ist im Marktstammdatenregister erfasst?',
    });
    expect(response.responseText).toMatch(/Datenquelle|Marktstammdatenregister|angefragten Daten/);
    expect(response.responseText).not.toMatch(
      /Auswertungsfeld|Feldbezeichnung|korrekten|Wiederhole|TIMEOUT/
    );
  }
);

test('850 scenario 7: draft variants use known display name and normalized unknown placeholders', async () => {
  textMock.mockResolvedValue(
    JSON.stringify({
      interpretation: [],
      expectation: [],
      nextSteps: [],
      assumptions: [],
      draft: [claim(fixtures.draft)],
    })
  );
  const response = await answer({
    situation: { ...situation, outputKind: 'draft' },
    retrieval: { evidence: [] },
    tenantId: 'synthetic',
    message: fixtures.draftQuestion,
    displayName: fixtures.displayName,
  });
  expect(response.draft).toContain('Mit freundlichen Grüßen\nben');
  expect(response.responseText).not.toContain('[Name]');
  expect(response.draft).toContain('[… Bearbeitungsstand]');
});

test('850 requirement 4: generic unsolicited advice is removed without losing a specific requested next step', async () => {
  textMock.mockResolvedValue(
    JSON.stringify(
      resultWith('Die fachliche Antwort zur Netzanmeldung steht aus.', [
        'Prüfe bei Bedarf die weiteren Daten.',
        'Für weitere Analysen können bei Bedarf zusätzliche Daten herangezogen werden.',
      ])
    )
  );
  const response = await answer({
    situation,
    retrieval: { evidence: [] },
    tenantId: 'synthetic',
    message: 'Was ist der Stand?',
  });
  expect(response.responseText).toContain('fachliche Antwort');
  expect(response.responseText).not.toMatch(/bei Bedarf|weitere Analysen/);
  expect(
    presentation.unsolicitedAdvice(
      'Prüfe die ausstehende Antwort bis zum vereinbarten Termin.',
      'Was ist der nächste Schritt?'
    )
  ).toBe(false);
});

test.each(fixtures.unsafeNotices)(
  '850 requirement 1: generic notice filter withholds unsafe source text: %s',
  (text) => {
    expect(presentation.humanNoticeText(text)).toBe(false);
  }
);

test('850 requirement 4: a trailing filler sentence does not erase the preceding answer', async () => {
  textMock.mockResolvedValue(
    JSON.stringify(
      resultWith('Die fachliche Antwort steht aus. Prüfe bei Bedarf die weiteren Daten.')
    )
  );
  const response = await answer({
    situation,
    retrieval: { evidence: [] },
    tenantId: 'synthetic',
    message: 'Was ist der Stand?',
  });
  expect(response.responseText).toContain('Die fachliche Antwort steht aus.');
  expect(response.responseText).not.toContain('bei Bedarf');
});
