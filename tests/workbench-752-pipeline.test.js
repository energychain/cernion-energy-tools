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
  followupKind: 'none',
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
  coverage.documents = jest.fn(async () => []);
  llm.generateStructured.mockImplementation(async (_schema, prompt) => ({
    ...structuredClone(situation),
    followupKind: JSON.parse(prompt).previous ? 'next_step' : 'none',
  }));
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

test('AC-02 structured code lookup without exact hit asks and keeps independent retrieval and answers while preventing code interpretation', async () => {
  const result = await call(fixtures.R2[0]);
  expect(exact).toHaveBeenCalled();
  expect(result.situation.identifiers).toContainEqual({ kind: 'rejection_reason', value: 'A33' });
  expect(result.responseText).toContain('Code A33 kann ich nicht sicher zuordnen');
  expect(result.draftId).toBeUndefined();
  expect(llm.generateText).toHaveBeenCalled();
  expect(retrieval).toHaveBeenCalled();
  expect(result.responseText).toContain('Prüfe das zugesagte Ergebnis');
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

test('R3 followup supplies bounded timeline context without regenerating a proactive draft', async () => {
  await call(fixtures.R3);
  const result = await call('Was soll ich konkret tun?');
  const prompt = JSON.parse(llm.generateStructured.mock.calls[1][1]);
  expect(prompt.previous.timeline).toHaveLength(8);
  expect(prompt.previous.timeline.every((entry) => entry.summary.length <= 600)).toBe(true);
  expect(prompt.schema.properties.timeline).toBeUndefined();
  expect(result.situation.timeline).toHaveLength(9);
  expect(result.draftId).toBeUndefined();
});

test.each([
  'Von: Lieferant\nGesendet: 08.10.2026\nBetreff: Neue Mail\n\nDas Ergebnis fehlt weiterhin.',
  'Mein Antwortentwurf: Guten Tag, bitte nennen Sie den aktuellen Stand.',
])(
  'document followup retains the active case and passes previous situation and asked questions: %s',
  async (message) => {
    const first = await call(fixtures.R3);
    const service = broker.getLocalService('workbench');
    const rows = await service.conversationsDb.allDocs({ include_docs: true });
    const saved = rows.rows.find(({ doc }) => doc.type === 'workbench_conversation_assistance').doc;
    const question = { key: 'result', question: 'Welches Ergebnis liegt vor?', blocking: true };
    await service.conversationsDb.put({ ...saved, askedQuestions: [question] });
    llm.generateStructured.mockImplementationOnce(async (_schema, raw) => {
      const prompt = JSON.parse(raw);
      expect(prompt.previous.concern).toBe(first.situation.concern);
      expect(prompt.askedQuestions).toEqual([question]);
      return { ...structuredClone(situation), followupKind: 'new_information' };
    });
    retrieval.mockClear();
    const result = await call(message);
    expect(result.cetCaseId).toBe(first.cetCaseId);
    expect(result.situation.concern).toBe(first.situation.concern);
    expect(result.situation.timeline.length).toBeGreaterThanOrEqual(9);
    expect(retrieval).toHaveBeenCalled();
  }
);

test.each(['Welche Handlung hilft uns hier am meisten?', 'Wie bringe ich den Vorgang voran?'])(
  'next-step reuse depends on semantic situation for varied phrasing: %s',
  async (message) => {
    const first = await call(fixtures.R1);
    retrieval.mockClear();
    const result = await call(message);
    expect(result.cetCaseId).toBe(first.cetCaseId);
    expect(retrieval).not.toHaveBeenCalled();
    expect(result.draftId).toBeUndefined();
  }
);

test('familiar next-step phrasing cannot override model-recognized new information', async () => {
  await call(fixtures.R1);
  llm.generateStructured.mockResolvedValueOnce({
    ...structuredClone(situation),
    followupKind: 'new_information',
  });
  retrieval.mockClear();
  await call('Was soll ich konkret tun?');
  expect(retrieval).toHaveBeenCalled();
});

test('open code filters both explicit and implicit code-dependent claims, keeps independent answer', async () => {
  llm.generateText.mockResolvedValue(
    JSON.stringify({
      interpretation: [claim('A33 bedeutet abweichende Daten.')],
      expectation: [],
      nextSteps: [
        claim('Prüfe den dokumentierten Stand.'),
        { ...claim('Korrigiere die Zählerzuordnung.'), codeDependencies: ['A33'] },
      ],
      draft: [claim('Guten Tag, bitte antworten Sie.')],
    })
  );
  const result = await call(fixtures.R2[0]);
  expect(result.responseText).toContain('Prüfe den dokumentierten Stand.');
  expect(result.responseText).toContain('Code A33 kann ich nicht sicher zuordnen');
  expect(result.responseText).not.toContain('abweichende Daten');
  expect(result.responseText).not.toContain('Korrigiere die Zählerzuordnung');
  expect(result.draftId).toBeUndefined();
});

test.each(['title', 'tags', 'follow-up questions'])(
  'provider errors in metadata tasks reach Open WebUI as valid empty JSON: %s',
  async (task) => {
    llm.generateText.mockRejectedValueOnce(
      Object.assign(new Error('rate limited'), { status: 429 })
    );
    const result = await call(
      `### Task: Generate ${task}\n<chat_history>USER: help</chat_history>`
    );
    const key = { title: 'title', tags: 'tags', 'follow-up questions': 'follow_ups' }[task];
    expect(JSON.parse(result.responseText)).toEqual({ [key]: key === 'title' ? '' : [] });
    expect(retrieval).not.toHaveBeenCalled();
    expect(llm.generateStructured).not.toHaveBeenCalled();
  }
);

test('ordinary Code wording cannot become a typed lookup through a model guess', async () => {
  llm.generateStructured.mockResolvedValueOnce({
    ...structuredClone(situation),
    identifiers: [{ kind: 'rejection_reason', value: 'A33' }],
  });
  const result = await call(
    'Der Code A33 ist ein Beispiel in meinem Programm. Bitte hilf beim Lesen.'
  );
  expect(exact).not.toHaveBeenCalled();
  expect(result.situation.codeResolutions).toEqual([]);
  expect(result.responseText).not.toContain('kann ich nicht sicher zuordnen');
});

test('inserted mail respects persisted case suppression', async () => {
  await call(fixtures.R1);
  await call('Kein Fall');
  const result = await call(
    'Von: Lieferant\nGesendet: 08.10.2026\n\nBitte antworte auf die Anfrage.'
  );
  expect(result.cetCaseId).toBeUndefined();
  const service = broker.getLocalService('workbench');
  const rows = await service.conversationsDb.allDocs({ include_docs: true });
  const saved = rows.rows.find(({ doc }) => doc.type === 'workbench_conversation_assistance').doc;
  expect(saved.caseSuppressed).toBe(true);
});

test('new mail retains earlier identifiers and unresolved code even when delta omits them', async () => {
  const first = await call(fixtures.R2[0]);
  llm.generateStructured.mockResolvedValueOnce({
    ...structuredClone(situation),
    followupKind: 'new_information',
  });
  const result = await call(
    'Von: Lieferant\nGesendet: 08.10.2026\n\nEine weitere Sachangabe zur laufenden Anfrage.'
  );
  expect(result.cetCaseId).toBe(first.cetCaseId);
  expect(result.situation.identifiers).toContainEqual({ kind: 'rejection_reason', value: 'A33' });
  expect(result.situation.codeResolutions[0].status).toBe('unresolved');
});

test('knowledge → pasted mail → change question retains mail context in understanding', async () => {
  const knowledge = { ...structuredClone(situation), turnKind: 'knowledge', hypotheses: [] };
  const mail =
    'Von: Team\nGesendet: 08.10.2026\nBetreff: Bearbeitung\n\nDie Prüfung ist abgeschlossen. Die Rückmeldung fehlt noch.';
  llm.generateStructured.mockResolvedValueOnce(knowledge);
  await call('Was bedeutet eine Eingangsbestätigung?');
  llm.generateStructured.mockResolvedValueOnce({
    ...structuredClone(situation),
    followupKind: 'new_information',
  });
  await call(mail);
  llm.generateStructured.mockImplementationOnce(async (_schema, prompt) => {
    const input = JSON.parse(prompt);
    expect(input.message).toBe('Was hat sich durch die Mail jetzt geändert?');
    expect(input.previous.timeline[0].summary).toContain('Die Prüfung ist abgeschlossen.');
    expect(input.previous.timeline[0].summary).toContain('Die Rückmeldung fehlt noch.');
    return { ...structuredClone(situation), followupKind: 'question' };
  });
  const result = await call('Was hat sich durch die Mail jetzt geändert?');
  expect(result.situation.followupKind).toBe('question');
  expect(result.situation.timeline[0].summary).toContain('Die Prüfung ist abgeschlossen.');
});

test('follow-up forwards client document history even when a previous situation exists', async () => {
  await call('Bitte hilf bei dieser offenen Frage.');
  const document = 'Bericht: Die Prüfung ist abgeschlossen; die Rückmeldung fehlt noch.';
  llm.generateStructured.mockImplementationOnce(async (_schema, prompt) => {
    const input = JSON.parse(prompt);
    expect(input.previous).toBeTruthy();
    expect(input.messages).toEqual([document]);
    return { ...structuredClone(situation), followupKind: 'question' };
  });
  const result = await broker.call(
    'workbench.chat',
    {
      channel: 'open-webui',
      conversationId: 'regression-752',
      message: 'Was hat sich durch das Dokument oben geändert?',
      messages: [{ role: 'user', content: document }],
    },
    { meta: structuredClone(meta) }
  );
  expect(result.situation.followupKind).toBe('question');
});

test('758 provider failure still retrieves and answers; raw new facts persist to following turn', async () => {
  const fixture = require('./fixtures/workbench-758.json');
  const first = await call(fixture.liveTurns[0]);
  llm.generateStructured.mockRejectedValueOnce(Object.assign(new Error('quota'), { status: 429 }));
  llm.generateText.mockRejectedValueOnce(new Error('timeout'));
  retrieval.mockReturnValue({
    evidence: [
      {
        source: 'knowledge-rag',
        value:
          'Die fachliche Antwort erfordert die Klärung von Inbetriebnahme und bestehender Vereinbarung.',
        metadata: { title: 'Teilnahmevoraussetzungen' },
      },
    ],
    trace: [],
  });
  const second = await call(fixture.liveTurns[1]);
  expect(second.cetCaseId).toBe(first.cetCaseId);
  expect(second.metadata).toMatchObject({ degraded: true, degradedPhase: 'understanding' });
  expect(second.responseText).toContain('Seit dem 01.01.2024');
  expect(second.responseText).toContain('Modell ist gerade nicht verfügbar');
  expect(second.responseText).toContain('Teilnahmevoraussetzungen');
  expect(second.responseText).not.toMatch(/Als Nächstes:|\[Ergebnis/);
  expect(second.situation.personFacts).toContain(fixture.liveTurns[1]);
  await call(fixture.liveTurns[2]);
  const prompt = JSON.parse(llm.generateStructured.mock.calls.at(-1)[1]);
  expect(prompt.previous.personFacts).toContain(fixture.liveTurns[1]);
});
