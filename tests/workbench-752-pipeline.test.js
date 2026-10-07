'use strict';
jest.mock('../src/llm-client', () => ({ generateStructured: jest.fn(), generateText: jest.fn() }));
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { ServiceBroker } = require('moleculer');
const Workbench = require('../services/workbench.service');
const Router = require('../services/domain-router.service');
const llm = require('../src/llm-client');
const fixtures = require('./fixtures/workbench-752.json');
const understanding = require('../src/workbench-understanding');
const sourceLine = require('../src/workbench-answer-evidence').sourceLine;
const meta = {
  apiToken: { tenantId: 'anonymous', id: 'colleague', roles: ['ROLE_GRID_OPERATOR'] },
};
const situation = {
  concern: 'Fachliche Antwort auf Anmeldung bleibt offen.',
  situation: 'Lieferant wartet; zugesagte Klärung ohne dokumentiertes Ergebnis.',
  participants: ['Lieferant', 'Netzbetreiber'],
  identifiers: [],
  deadlines: [],
  hypotheses: [{ kind: 'domain', id: 'market_communication', confidence: 0.9 }],
  missingInformation: [],
  requestedAction: {
    description: 'Antwort vorbereiten.',
    externalEffect: false,
    draftRequested: true,
  },
  turnKind: 'work',
  retrievalTerms: [],
};
const claim = (text) => ({
  text,
  origin: 'input',
  specific: false,
  supported: 'model',
  completedAction: false,
  evidenceIds: [],
});
let broker, directory, retrieval, exact, touched, notices;
beforeEach(async () => {
  directory = fs.mkdtempSync(path.join(os.tmpdir(), 'cet-752-pipeline-'));
  broker = new ServiceBroker({ logger: false, transporter: null });
  const settings = Object.assign(
    {},
    ...Workbench.mixins.map((m) => m.settings || {}),
    Workbench.settings
  );
  for (const name of Object.keys(settings))
    if (name.endsWith('DbPath') || name === 'dbPath') settings[name] = path.join(directory, name);
  broker.createService({ ...Workbench, settings });
  broker.createService({
    ...Router,
    settings: {
      ...Router.settings,
      dbPath: path.join(directory, 'router'),
      eventsDbPath: path.join(directory, 'events'),
    },
  });
  retrieval = jest.fn(() => ({ evidence: [], trace: [] }));
  exact = jest.fn(() => ({ success: true, data: { sources: [] } }));
  touched = jest.fn(() => ({}));
  notices = jest.fn(() => ({ block: 'NOTICE' }));
  broker.createService({
    name: 'personal-agent',
    actions: { collectWorkbenchEvidence: retrieval },
  });
  broker.createService({ name: 'willi-mako', actions: { resolveStructure: exact } });
  broker.createService({
    name: 'capability-broker',
    actions: {
      recommend: () => ({
        uncertain: true,
        candidateCapabilities: [],
        recommendedCapabilities: [],
      }),
    },
  });
  broker.createService({
    name: 'agent-receipts',
    actions: { select: () => ({ data: { selected: false } }) },
  });
  broker.createService({ name: 'notices', actions: { completeTurn: notices } });
  const coverage = broker.createService({
    name: 'function-coverage',
    actions: { recordTouch: touched },
  });
  coverage.config = { maxInputSignalsPerTurn: 20, maxPendingTurns: 10 };
  coverage.pendingTurns = 0;
  llm.generateStructured.mockImplementation(async () => structuredClone(situation));
  llm.generateText.mockResolvedValue(
    JSON.stringify({
      interpretation: [
        claim(
          'Der Lieferant wartet auf die fachliche Antwort; die Eingangsbestätigung beantwortet seine Frage noch nicht.'
        ),
      ],
      expectation: [],
      nextSteps: [
        claim('Prüfe das zugesagte Ergebnis und bereite die Prozessantwort getrennt vor.'),
      ],
      draft: [
        claim(
          'Guten Tag,\nbitte teilen Sie uns den dokumentierten Stand mit.\nMit freundlichen Grüßen'
        ),
      ],
    })
  );
  await broker.start();
});
afterEach(async () => {
  await broker.stop();
  fs.rmSync(directory, { recursive: true, force: true });
  jest.clearAllMocks();
});
const call = (message) =>
  broker.call(
    'workbench.chat',
    { channel: 'open-webui', conversationId: 'regression-752', message },
    { meta: structuredClone(meta) }
  );

test('AC-01 R3 creates a case, retains timeline, keeps repeated signatures out of every LLM prompt', async () => {
  const result = await call(fixtures.R3);
  expect(result.cetCaseId).toBeTruthy();
  expect(result.situation.timeline).toHaveLength(9);
  expect(result.situation.timeline.map((entry) => entry.date)).toEqual(
    [...result.situation.timeline.map((entry) => entry.date)].sort()
  );
  expect(result.responseText).toContain('Der Lieferant wartet');
  const prompts = [
    ...llm.generateStructured.mock.calls.map((args) => args[1]),
    ...llm.generateText.mock.calls.map((args) => args[0]),
  ].join('\n');
  expect(prompts).toContain('Systemfehler beim Dienstleister');
  expect(prompts).not.toMatch(/Telefon:|Diese Nachricht ist nur|Beispielweg 42/);
});

test('AC-02 structured code lookup without exact hit asks and prevents any draft/model code interpretation', async () => {
  const result = await call(fixtures.R2[0]);
  expect(exact).toHaveBeenCalled();
  expect(result.situation.identifiers).toContainEqual({ kind: 'rejection_reason', value: 'A33' });
  expect(result.responseText).toContain('Code A33 kann ich nicht sicher zuordnen');
  expect(result.draftId).toBeUndefined();
  expect(llm.generateText).not.toHaveBeenCalled();
});

test('AC-03 background title has no case, retrieval, coverage or notice side effects', async () => {
  llm.generateText.mockResolvedValue('{"title":"Offene Antwort"}');
  const result = await call(
    '### Task: Generate a concise title\n<chat_history>USER: Anmeldung offen</chat_history>'
  );
  expect(JSON.parse(result.responseText)).toEqual({ title: 'Offene Antwort' });
  expect(result.cetCaseId).toBeUndefined();
  expect(retrieval).not.toHaveBeenCalled();
  expect(touched).not.toHaveBeenCalled();
  expect(notices).not.toHaveBeenCalled();
  expect(llm.generateStructured).not.toHaveBeenCalled();
});

test('AC-04 rejects a guessed gendered salutation and hides internal source IDs', async () => {
  llm.generateText.mockResolvedValue(
    JSON.stringify({
      expectation: [],
      nextSteps: [claim('Prüfe den Stand.')],
      draft: [
        claim('Sehr geehrte Frau Alex Beispiel,\nbitte antworten Sie.\nMit freundlichen Grüßen'),
      ],
    })
  );
  const reply = await understanding.answer({
    situation,
    retrieval: { evidence: [] },
    message: 'Alex Beispiel bittet um Antwort.',
  });
  expect(reply.draft).toBe('');
  expect(reply.responseText).not.toContain('Sehr geehrte Frau');
  expect(
    sourceLine([
      {
        source: 'willi-mako',
        metadata: {
          sourceId: '640f0811-1234-4321-1234-123456789012',
          title: 'Entscheidungsbaum',
          sectionId: 'Abschnitt 4',
        },
      },
    ])
  ).toBe('Quellen: Entscheidungsbaum · Abschnitt 4');
});

test('AC-04 binding process confirmation in an accompanying mail is rejected', async () => {
  llm.generateText.mockResolvedValue(
    JSON.stringify({
      expectation: [],
      nextSteps: [claim('Bereite die Prozessantwort getrennt vor.')],
      draft: [claim('Guten Tag,\nwir bestätigen die Netzanmeldung.\nMit freundlichen Grüßen')],
    })
  );
  const reply = await understanding.answer({
    situation,
    retrieval: { evidence: [] },
    message: fixtures.R1,
  });
  expect(reply.draft).toBe('');
});

test('understanding provider schema retains description as a field and omits metadata constraints', async () => {
  await call(fixtures.R1);
  const schema = llm.generateStructured.mock.calls[0][0];
  expect(schema.properties.requestedAction.properties.description.type).toBe('string');
  expect(schema.properties.timeline.maxItems).toBeUndefined();
});

test('next-step followup reuses fresh evidence while rechecking the tenant response boundary', async () => {
  const first = await call(fixtures.R1);
  retrieval.mockClear();
  const result = await call('Was soll ich konkret tun?');
  expect(result.cetCaseId).toBe(first.cetCaseId);
  expect(retrieval).not.toHaveBeenCalled();
  expect(llm.generateStructured).toHaveBeenCalledTimes(2);
  expect(JSON.parse(llm.generateStructured.mock.calls[1][1]).messages).toEqual([]);
});

test('expired evidence is retrieved again for next-step questions', async () => {
  await call(fixtures.R1);
  const service = broker.getLocalService('workbench');
  const rows = await service.conversationsDb.allDocs({ include_docs: true });
  const saved = rows.rows.find(({ doc }) => doc.type === 'workbench_conversation_assistance').doc;
  await service.conversationsDb.put({ ...saved, evidenceRetrievedAt: Date.now() - 300001 });
  retrieval.mockClear();
  await call('Was soll ich konkret tun?');
  expect(retrieval).toHaveBeenCalled();
});

test.each(['Sehr geehrter Alex Beispiel,', 'Sehr geehrte Alex Beispiel,'])(
  'rejects inferred gender without Herr/Frau: %s',
  async (greeting) => {
    llm.generateText.mockResolvedValue(
      JSON.stringify({
        expectation: [],
        nextSteps: [claim('Prüfe den Stand.')],
        draft: [claim(`${greeting}\nBitte antworten Sie.\nMit freundlichen Grüßen`)],
      })
    );
    const reply = await understanding.answer({
      situation,
      retrieval: { evidence: [] },
      message: 'Alex Beispiel bittet um Antwort.',
    });
    expect(reply.draft).toBe('');
  }
);

test('R3 followup does not resend timeline bodies or regenerate a proactive draft', async () => {
  await call(fixtures.R3);
  const result = await call('Was soll ich konkret tun?');
  const prompt = JSON.parse(llm.generateStructured.mock.calls[1][1]);
  expect(prompt.previous.timeline).toBeUndefined();
  expect(prompt.schema.properties.timeline).toBeUndefined();
  expect(result.situation.timeline).toHaveLength(9);
  expect(result.draftId).toBeUndefined();
});
