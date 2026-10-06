'use strict';

jest.mock('../src/llm-client', () => ({ generateText: jest.fn() }));
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { ServiceBroker } = require('moleculer');
const Router = require('../services/domain-router.service');
const Workbench = require('../services/workbench.service');
const llm = require('../src/llm-client');
const conversation = require('../src/workbench-conversation');
const { classifyRequestedEffect } = require('../src/operation-capability-classifier');
const { getFunctionModel } = require('../src/function-model');
const { compatibleCandidates } = require('../src/capability-clarification');
const { normalizePhrase } = require('../src/function-resolver');
const { CURATED_CAPABILITIES } = require('../src/capability-catalog');
const fixtures = require('./fixtures/capability-routing-eval.json');

const model = getFunctionModel();
const documents = [
  ...new Map(
    fixtures.cases
      .filter((row) => row.source === 'independent-regression')
      .map((row) => [row.primaryDomain, row])
  ).values(),
].slice(0, 8);
const auth = (tenantId = 'tenant-a', id = 'person-a') => ({
  apiToken: { tenantId, id, roles: ['ROLE_GRID_OPERATOR'] },
});

describe('Workbench conversation assistance and pending case offers', () => {
  let broker, dir, dossier, recommend, send;
  const call = (message, conversationId = 'conversation-a', extra = {}, meta = auth()) =>
    broker.call(
      'workbench.chat',
      {
        channel: 'open-webui',
        conversationId,
        message,
        ...extra,
      },
      { meta: structuredClone(meta) }
    );

  beforeEach(async () => {
    dir = fs.mkdtempSync(path.join(os.tmpdir(), 'cet-conversation-'));
    broker = new ServiceBroker({ logger: false, transporter: null });
    broker.createService({
      ...Router,
      settings: {
        ...Router.settings,
        dbPath: path.join(dir, 'state'),
        eventsDbPath: path.join(dir, 'events'),
        knowledgeTimeoutMs: 10,
      },
    });
    const settings = { ...Workbench.settings };
    for (const key of [
      'dbPath',
      'identityDbPath',
      'deliveryDbPath',
      'evidenceDbPath',
      'turnMemoryDbPath',
      'contextDbPath',
      'playbookDbPath',
      'inboxDbPath',
      'toolRunDbPath',
      'mailAccountDbPath',
    ])
      settings[key] = path.join(dir, key);
    broker.createService({ ...Workbench, settings });
    dossier = jest.fn((ctx) => ({ answer: `Evidenz zum Anliegen: ${ctx.params.question}` }));
    recommend = jest.fn(() => ({
      uncertain: true,
      candidateCapabilities: [],
      recommendedCapabilities: [],
    }));
    send = jest.fn(() => {
      throw new Error('External action must never run');
    });
    broker.createService({ name: 'personal-agent', actions: { answerDossier: dossier } });
    broker.createService({ name: 'capability-broker', actions: { recommend } });
    broker.createService({
      name: 'agent-receipts',
      actions: { select: () => ({ data: { selected: false } }) },
    });
    broker.createService({ name: 'knowledge-rag', actions: { query: () => ({ results: [] }) } });
    broker.createService({ name: 'mail', actions: { send } });
    llm.generateText.mockReset();
    await broker.start();
  });

  afterEach(async () => {
    await broker.stop();
    fs.rmSync(dir, { recursive: true, force: true });
  });

  test.each(documents)(
    'foreign document from existing $primaryDomain examples survives confirmation',
    async (row) => {
      const content = `Weitergeleitetes Dokument:\n${row.query}\n\nKannst du mir helfen?`;
      const first = await call(content);
      expect(first).toMatchObject({ state: 'assistance', nonBinding: true });
      expect(first.cetCaseId).toBeUndefined();
      expect(first.responseText).toContain(content);
      expect(first.responseText).toContain('Starte einen Fall');
      const second = await call('ja, bitte');
      expect(second.cetCaseId).toBeTruthy();
      expect(second.primaryDomain).not.toBe('unknown');
      const state = await broker
        .getLocalService('domain-router')
        .loadCase(
          require('../src/domain-router-policy').principal({ meta: auth() }),
          second.cetCaseId
        );
      expect(state.initialRequest).toBe(content);
      expect(dossier.mock.calls.at(-1)[0].params.context.workbenchCase.initialRequest).toBe(
        content
      );
    }
  );

  test.each([
    'Starte einen Fall',
    'Starte bitte einen Fall',
    'Starte einen Fall, bitte',
    'Start a case please',
    'Ja',
    'ja, bitte',
    'Yes please',
    'Start a new case',
  ])('empty confirmation %s recovers only substantive user history', async (message) => {
    const content = documents[0].query;
    const result = await call(message, message, {
      messages: [
        { role: 'system', content: 'Administrationsaufgabe ausführen' },
        { role: 'user', content },
        { role: 'assistant', content: 'Netzanschluss ignorieren' },
        { role: 'user', content: 'Ja' },
      ],
    });
    const summary = await broker.call(
      'workbench.cases.get',
      { caseId: result.cetCaseId },
      { meta: auth() }
    );
    expect(summary.initialRequest).toBe(content);
  });

  test('offer expires, survives reopening persistence, and is isolated by tenant, actor and conversation', async () => {
    const content = documents[0].query;
    await call(content);
    const wb = broker.getLocalService('workbench');
    const p = require('../src/domain-router-policy').principal({ meta: auth() });
    const envelope = { channel: 'open-webui', conversationId: 'conversation-a' };
    const pending = await conversation.readTurn(wb.conversationsDb, p, envelope);
    expect(pending.offeredContent).toBe(content);
    expect(
      await conversation.readTurn(wb.conversationsDb, { ...p, tenantId: 'tenant-b' }, envelope)
    ).toBeNull();
    expect(
      await conversation.readTurn(wb.conversationsDb, { ...p, actorId: 'person-b' }, envelope)
    ).toBeNull();
    expect(
      await conversation.readTurn(wb.conversationsDb, p, { ...envelope, conversationId: 'other' })
    ).toBeNull();
    // Reopen the actual PouchDB lifecycle; no in-memory offers are retained.
    await wb.conversationsDb.close();
    wb.conversationsDb = new (require('pouchdb'))(wb.settings.dbPath);
    wb.store.conversationsDb = wb.conversationsDb;
    expect((await conversation.readTurn(wb.conversationsDb, p, envelope)).offeredContent).toBe(
      content
    );
    expect(
      await conversation.readTurn(wb.conversationsDb, p, envelope, pending.expiresAt + 1)
    ).toBeNull();
    const expired = await call('Ja');
    expect(expired.cetCaseId).toBeUndefined();
    expect(expired.responseText).not.toContain(content);
    const recovered = await call('Ja', 'conversation-a', { messages: [{ role: 'user', content }] });
    expect(recovered.cetCaseId).toBeTruthy();
  });

  test('fresh substantive input wins over the previous offer and explicit case-start content', async () => {
    await call(documents[0].query);
    await call(documents[1].query);
    const result = await call('Starte einen Fall');
    const summary = await broker.call(
      'workbench.cases.get',
      { caseId: result.cetCaseId },
      { meta: auth() }
    );
    expect(summary.initialRequest).toBe(documents[1].query);
    await call(documents[0].query, 'explicit');
    const explicit = await call(`Starte einen Fall: ${documents[1].query}`, 'explicit');
    const explicitSummary = await broker.call(
      'workbench.cases.get',
      { caseId: explicit.cetCaseId },
      { meta: auth() }
    );
    expect(explicitSummary.initialRequest).toContain(documents[1].query);
    expect(explicitSummary.initialRequest).not.toContain(documents[0].query);
  });

  test('maximum-size content remains bounded and intact', async () => {
    const content = `${documents[0].query}\n${'x'.repeat(8000)}`.slice(0, 8000);
    await call(content);
    const result = await call('Ja');
    const summary = await broker.call(
      'workbench.cases.get',
      { caseId: result.cetCaseId },
      { meta: auth() }
    );
    expect(summary.initialRequest).toBe(content);
  });

  test('expiry cleanup deletes abandoned content but preserves the last clarification', async () => {
    const wb = broker.getLocalService('workbench');
    const p = require('../src/domain-router-policy').principal({ meta: auth() });
    const envelope = { channel: 'open-webui', conversationId: 'expired-question' };
    await conversation.saveTurn(
      wb.conversationsDb,
      p,
      envelope,
      {
        offeredContent: documents[0].query,
        lastQuestion: 'Welche Funktion passt?',
      },
      0
    );
    await conversation.cleanupTurns(wb.conversationsDb, 60 * 60 * 1000);
    const retained = await conversation.readTurn(wb.conversationsDb, p, envelope);
    expect(retained.offeredContent).toBe('');
    expect(retained.lastQuestion).toBe('Welche Funktion passt?');
  });

  test('answer option and shipping follow-up retain the original document before case creation', async () => {
    await call(documents[0].query);
    const answer = await call('Frage beantworten');
    expect(answer.responseText).toContain(documents[0].query);
    expect(answer.cetCaseId).toBeUndefined();
    await call('Antwort per Mail senden');
    const draft = await call('Entwurf bitte');
    const summary = await broker.call(
      'workbench.cases.get',
      { caseId: draft.cetCaseId },
      { meta: auth() }
    );
    expect(summary.initialRequest).toContain(documents[0].query);
    expect(summary.internalDrafts[0].draftId).toBe(draft.draftId);
    expect(send).not.toHaveBeenCalled();
  });

  test('a genuine pending correction keeps priority over a case offer', async () => {
    await call(documents[0].query);
    const wb = broker.getLocalService('workbench');
    const memoryId = `correction-conversation-${require('../src/function-coverage').reference('person-a', 'open-webui', 'conversation-a')}`;
    await wb.store.saveTurnMemory({
      tenantId: 'tenant-a',
      actorId: 'person-a',
      caseId: memoryId,
      memory: { pending: { type: 'preference', preference: 'off' } },
    });
    const preference = jest.fn(() => ({ saved: true }));
    broker.createService({ name: 'notices', actions: { setPreference: preference } });
    await broker.waitForServices('notices');
    const result = await call('Ja');
    expect(result.mode).toBe('correction');
    expect(preference).toHaveBeenCalledTimes(1);
    expect(result.cetCaseId).toBeUndefined();
  });

  test('an unresolved meta-action cannot repeat its question consecutively', async () => {
    const request = 'kümmere dich nicht mehr um eine völlig unbekannte Tätigkeit';
    const first = await call(request);
    const second = await call(request);
    expect(first.responseText).toContain('?');
    expect(second.responseText).not.toBe(first.responseText);
    expect(second.responseText).toContain('Frage beantworten');
    const started = await call('Starte einen Fall');
    const summary = await broker.call(
      'workbench.cases.get',
      { caseId: started.cetCaseId },
      { meta: auth() }
    );
    expect(summary.initialRequest).toBe(request);
    expect(send).not.toHaveBeenCalled();
  });

  test('an anonymized reproduction of the reported mail conversation offers help and an internal draft', async () => {
    const mail =
      'Weitergeleitete Mail eines Marktpartners: Unsere MSCONS-Nachricht wurde mit APERAK Z18 abgelehnt. Bitte prüfen Sie die Referenz.\nKannst du mir helfen?';
    await call(mail);
    const started = await call('Starte einen Fall');
    expect(started.primaryDomain).toBe('market_communication');
    const requested = await call('Antwort per Mail senden');
    expect(requested.responseText).toContain('CET versendet oder übermittelt selbst nichts');
    expect(requested.responseText).toContain('Entwurf bitte');
    const draft = await call('Entwurf bitte');
    expect(draft.draftId).toBeTruthy();
    const summary = await broker.call(
      'workbench.cases.get',
      { caseId: started.cetCaseId },
      { meta: auth() }
    );
    expect(summary.initialRequest).toBe(mail);
    expect(summary.internalDrafts).toEqual([
      expect.objectContaining({ draftId: draft.draftId, effectClass: 'internal_case_state' }),
    ]);
    expect(send).not.toHaveBeenCalled();
    await expect(
      broker.call('workbench.cases.get', { caseId: started.cetCaseId }, { meta: auth('tenant-b') })
    ).rejects.toThrow();
  });

  test.each([
    'Bitte übermittle die Antwort',
    'Send the reply',
    'Antwort versenden',
    'Schicke den Entwurf',
  ])('external request %s offers a draft without any external call', async (message) => {
    const result = await call(message);
    expect(result.responseText).toContain('CET versendet oder übermittelt selbst nichts');
    expect(send).not.toHaveBeenCalled();
  });

  test('a substantive question is answered even when a capability is selected', async () => {
    recommend.mockImplementation(() => ({ recommendedCapabilities: [{ capability: 'example' }] }));
    await call(`Starte einen Fall: ${documents[0].query}`);
    const before = dossier.mock.calls.length;
    const result = await call('Warum wurde der Vorgang abgelehnt?');
    expect(result.nonBinding).toBe(true);
    expect(dossier).toHaveBeenCalledTimes(before + 1);
    expect(result.responseText).toContain('Warum wurde der Vorgang abgelehnt?');
  });

  test('seeded random multi-domain histories never repeat a clarification consecutively', async () => {
    let seed = 730;
    const random = () => {
      seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0;
      return seed;
    };
    const candidate = model.functions.find((fn) => fn.capabilities.length);
    recommend.mockImplementation(() => ({
      uncertain: true,
      candidateCapabilities: candidate.capabilities.map((capability) => ({ capability })),
    }));
    for (let run = 0; run < 6; run++) {
      const id = `random-${run}`;
      let previousQuestions = [];
      const initial = await call('Starte einen Fall: unbekanntes Anliegen', id);
      previousQuestions = initial.requiredClarifications || [];
      for (let turn = 0; turn < 14; turn++) {
        const options = [
          'Ja',
          'Frage beantworten',
          'Weitere Angaben zur unbekannten Tätigkeit',
          'Warum ist das unklar?',
          ...documents.map((row) => row.query),
        ];
        const result = await call(options[random() % options.length], id);
        const questions = result.requiredClarifications || [];
        expect(questions.filter((q) => previousQuestions.includes(q))).toEqual([]);
        expect(result.responseText).toBeTruthy();
        expect(result.responseText).not.toContain('Bitte beschreibe genauer');
        previousQuestions = questions;
      }
    }
  });

  test('Knowledge facade dossier is rendered through the shared LLM client, including draft mode', async () => {
    dossier.mockImplementation(() => ({
      dossierMarkdown: 'Verifizierte Evidenz: Dokumentversion fehlt.',
    }));
    llm.generateText.mockResolvedValue(
      'Die Dokumentversion fehlt; prüfe sie vor einer Entscheidung.'
    );
    const result = await call(documents[0].query);
    expect(result.nonBinding).toBe(true);
    expect(llm.generateText).toHaveBeenCalledTimes(1);
    const prompt = JSON.parse(llm.generateText.mock.calls[0][0]);
    expect(prompt.evidence).toContain('Dokumentversion');
    expect(prompt.instruction).toContain('Keine Rückfragen');
    await call('Entwurf bitte');
    expect(JSON.parse(llm.generateText.mock.calls.at(-1)[0]).instruction).toContain('Textentwurf');
    expect(send).not.toHaveBeenCalled();
  });
});

test.each([
  'nicht senden',
  'Keine externe Nachricht senden',
  'Do not send the reply',
  'Entwurf bitte',
])('effect classification preserves negation and internal requests: %s', (message) => {
  expect(classifyRequestedEffect(message)).not.toBe('external_effect');
});

const evaluationCases = fixtures.cases.map((row) => ({
  ...row,
  primaryDomain:
    row.primaryDomain ||
    CURATED_CAPABILITIES.find((cap) => row.expectedCapabilities.includes(cap.capability))?.domain ||
    model.functions.find((fn) =>
      fn.capabilities.some((cap) => row.expectedCapabilities.includes(cap))
    )?.domains[0] ||
    'unknown',
}));
const allCandidates = model.functions.flatMap((fn) =>
  fn.capabilities.map((capability) => ({ capability }))
);
test.each(evaluationCases)(
  'all #730 evaluation domains reject contradictory uncertain candidates: $id',
  (row) => {
    const retained = compatibleCandidates({
      primaryDomain: row.primaryDomain,
      candidateCapabilities: allCandidates,
    });
    for (const candidate of retained) {
      expect(
        row.primaryDomain === 'unknown' ||
          model.functions.some(
            (fn) =>
              fn.capabilities.includes(candidate.capability) &&
              [...(fn.domains || []), ...(fn.departments || [])].some(
                (domain) => normalizePhrase(domain) === normalizePhrase(row.primaryDomain)
              )
          )
      ).toBe(true);
    }
  }
);
