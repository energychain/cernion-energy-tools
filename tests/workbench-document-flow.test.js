'use strict';

jest.mock('../src/llm-client', () => ({ generateStructured: jest.fn(), generateText: jest.fn() }));
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { ServiceBroker } = require('moleculer');
const Workbench = require('../services/workbench.service');
const Router = require('../services/domain-router.service');
const OpenAI = require('../services/openai-compatible.service');
const llm = require('../src/llm-client');
const { loadDocuments } = require('../src/workbench-document');
const { safeEvidenceRef } = require('../src/workbench-evidence');
const { normalizeTaskEnvelope } = require('../src/workbench-contract');
const { GOVERNANCE_MODEL } = require('../src/openai-models');
const fixture = fs.readFileSync(
  path.join(__dirname, 'fixtures/document-review/neutral-long-document.txt'),
  'utf8'
);
const packed = (question, text = fixture) =>
  `<context><source id="opaque-source-754" name="Synthetic.txt">${text}</source></context><user_query>${question}</user_query>`;

const situation = {
  concern: 'Dokument prüfen',
  situation: 'Synthetischer Plan liegt vor.',
  participants: [],
  identifiers: [],
  deadlines: [],
  hypotheses: [],
  missingInformation: [],
  requestedAction: {
    description: 'Dokument bewerten',
    externalEffect: false,
    draftRequested: true,
  },
  turnKind: 'work',
  retrievalTerms: ['Plan prüfen'],
};
const map = {
  claims: ['Synthetische Angabe'],
  assumptions: [],
  numbers: [],
  measures: [],
  schedule: [],
};

describe('document conversation integration', () => {
  let broker, service, directory, retrieval;
  const meta = {
    apiToken: { tenantId: 'anonymous', id: 'synthetic-reviewer', roles: ['ROLE_GRID_OPERATOR'] },
  };
  beforeEach(async () => {
    llm.generateText.mockReset();
    directory = fs.mkdtempSync(path.join(os.tmpdir(), 'document-flow-'));
    broker = new ServiceBroker({ logger: false, transporter: null });
    const settings = Object.assign(
      {},
      ...Workbench.mixins.map((m) => m.settings || {}),
      Workbench.settings
    );
    for (const name of Object.keys(settings))
      if (name.endsWith('DbPath') || name === 'dbPath') settings[name] = path.join(directory, name);
    service = broker.createService({ ...Workbench, settings });
    broker.createService({
      ...Router,
      settings: {
        ...Router.settings,
        dbPath: path.join(directory, 'router'),
        eventsDbPath: path.join(directory, 'events'),
      },
    });
    broker.createService(OpenAI);
    retrieval = jest.fn(() => ({
      evidence: [
        {
          source: 'knowledge-rag',
          retrievalSource: 'knowledge-rag',
          title: 'Synthetischer Prüfleitfaden',
          value: 'Plan prüfen: Ausgangszahlen müssen nachvollziehbar sein.',
          evidenceId: 'criterion-test',
          metadata: { title: 'Synthetischer Prüfleitfaden', sectionId: 'Abschnitt A' },
        },
      ],
      trace: [{ source: 'knowledge-rag', status: 'available', hitCount: 1, ms: 1 }],
    }));
    broker.createService({
      name: 'personal-agent',
      actions: { collectWorkbenchEvidence: retrieval },
    });
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
    llm.generateStructured.mockImplementation(async (_schema, prompt) => {
      const data = JSON.parse(prompt);
      if (data.untrustedDocument)
        return {
          ...structuredClone(map),
          citations: [data.lines.find((line) => /Gesamtzahl/.test(line.quote)) || data.lines[0]],
        };
      if (data.maps) {
        const citation = {
          finding: data.locations[data.maps[0].locationIds[0]].quote,
          locations: [data.maps[0].locationIds[0]],
          criterion: data.criteria.length ? 0 : -1,
        };
        return {
          verdict: 'Teilweise nachvollziehbar.',
          rationale: 'Die Ausgangszahlen benötigen einen Nachweis.',
          strengths: [citation],
          risks: [citation],
          checkpoints: [citation],
          contradictions: [citation],
          openQuestions: ['Welche Grundlage gilt?'],
          draft: 'Unbeauftragter Entwurf',
        };
      }
      return structuredClone(situation);
    });
    await broker.start();
  });
  afterEach(async () => {
    await broker.stop();
    fs.rmSync(directory, { recursive: true, force: true });
    jest.clearAllMocks();
  });
  const turn = (message, conversationId = 'review') =>
    broker.call(
      'workbench.chat',
      { channel: 'open-webui', conversationId, message },
      { meta: structuredClone(meta) }
    );

  test('an attached file without a task asks once, stores the file and avoids an unrequested review', async () => {
    const question = {
      key: 'purpose',
      reason: 'purpose',
      question: 'Überblick, Prüfung oder Entwurf?',
      blocking: false,
    };
    llm.generateStructured.mockResolvedValue({
      ...structuredClone(situation),
      conversationShape: 'orientation',
      missingInformation: [question],
      requestedAction: { description: '', draftRequested: false, externalEffect: false },
    });
    llm.generateText.mockResolvedValue(
      JSON.stringify({
        interpretation: [
          {
            text: 'Der Zeitplan braucht noch eine Freigabe.',
            origin: 'input',
            supported: 'model',
            completedAction: false,
            specific: false,
            evidenceIds: [],
          },
        ],
        expectation: [],
        nextSteps: [],
        draft: [],
      })
    );
    const message = packed(
      'Was kannst Du mir dazu sagen?',
      'Der synthetische Zeitplan ist noch nicht freigegeben.'
    );
    const first = await turn(message);
    expect(first.responseText).toContain(question.question);
    expect(first.requiredClarifications).toEqual([question.question]);
    const docs = await loadDocuments(service.store, {
      tenantId: 'anonymous',
      actorId: 'synthetic-reviewer',
      caseId: first.cetCaseId,
    });
    expect(docs[0].text).toBe('Der synthetische Zeitplan ist noch nicht freigegeben.');
    expect(service.workbenchDocumentReviews?.size || 0).toBe(0);
    const repeated = await turn(message);
    expect(repeated.responseText).not.toContain(question.question);
    expect(repeated.requiredClarifications).toEqual([]);
    llm.generateStructured.mockResolvedValue({
      ...structuredClone(situation),
      turnKind: 'work',
      conversationShape: 'task',
      missingInformation: [{ ...question, answered: true }],
      requestedAction: { description: '', draftRequested: false, externalEffect: false },
    });
    const overview = await turn('Mir geht es um einen kurzen Überblick.');
    expect(overview.situation.conversationShape).toBe('task');
    expect(overview.responseText).toContain('Der Zeitplan braucht noch eine Freigabe.');
    expect(overview.requiredClarifications).toEqual([]);
    expect(overview.metadata.degraded).toBe(false);
    expect(service.workbenchDocumentReviews?.size || 0).toBe(0);
    llm.generateStructured.mockImplementation(async (_schema, prompt) => {
      const data = JSON.parse(prompt);
      if (data.untrustedDocument) return { ...structuredClone(map), citations: [data.lines[0]] };
      if (data.maps)
        return {
          verdict: 'Prüfung abgeschlossen.',
          rationale: 'Synthetische Prüfung.',
          strengths: [],
          risks: [],
          checkpoints: [],
          contradictions: [],
          openQuestions: [],
          draft: '',
        };
      return { ...structuredClone(situation), turnKind: 'review', conversationShape: 'task' };
    });
    const review = await turn('Prüfe das Dokument fachlich.');
    expect(review.documentReview.status).toBe('pending');
    await Promise.all(service.workbenchDocumentReviews.values());
  });

  test('an explicit draft after orientation gets a fresh task situation', async () => {
    llm.generateStructured
      .mockResolvedValueOnce({
        ...structuredClone(situation),
        turnKind: 'knowledge',
        conversationShape: 'orientation',
      })
      .mockResolvedValueOnce({ ...structuredClone(situation), conversationShape: 'task' });
    const claim = (text) => ({
      text,
      supported: 'model',
      completedAction: false,
      specific: false,
      evidenceIds: [],
    });
    llm.generateText.mockImplementation(async (prompt) => {
      const { situation: current } = JSON.parse(prompt);
      return JSON.stringify({
        interpretation:
          current.conversationShape === 'orientation'
            ? [claim('Ich kann dir fachlich helfen.')]
            : [],
        expectation: [],
        nextSteps: [],
        draft:
          current.conversationShape === 'task'
            ? [
                claim(
                  'Guten Tag, bitte teilen Sie uns den dokumentierten Bearbeitungsstand Ihrer Anfrage mit. Mit freundlichen Grüßen.'
                ),
              ]
            : [],
      });
    });
    await turn('Kennst du System X?', 'orientation-task');
    const message = 'Mach mir die Antwort fertig';
    const result = await turn(message, 'orientation-task');
    expect(
      llm.generateStructured.mock.calls.some((call) => JSON.parse(call[1]).message === message)
    ).toBe(true);
    expect(result.situation.conversationShape).toBe('task');
    expect(result.responseText).toContain('Bearbeitungsstand');
    expect(result.draftId).toBeTruthy();
  });

  test('long full transport persists, fast intermediate response, later cited review and no unsolicited draft', async () => {
    const first = await turn(packed('Bewerte bitte den Plan.'));
    expect(first.cetCaseId).toBeTruthy();
    expect(first.situation.turnKind).toBe('review');
    expect(first.responseText).toContain('233256 Zeichen');
    expect(first.pendingEvents).toBeGreaterThan(0);
    expect(first.responseText).not.toContain('opaque-source');
    await Promise.all(service.workbenchDocumentReviews.values());
    const documents = await loadDocuments(service.store, {
      tenantId: 'anonymous',
      caseId: first.cetCaseId,
      actorId: 'synthetic-reviewer',
    });
    expect(documents[0].text).toBe(fixture);
    const understandingInput = JSON.parse(llm.generateStructured.mock.calls[0][1]);
    expect(JSON.stringify(understandingInput)).not.toContain('Abschnitt 12-64');
    expect(understandingInput.message).toBe('Bewerte bitte den Plan.');
    const completed = await turn('Ergebnis bitte.');
    for (const label of [
      'Urteil',
      'Stärken',
      'Risiken',
      'Prüfpunkte',
      'Widersprüche',
      'Offene Fragen',
      'Kapitel 1',
    ])
      expect(completed.responseText).toContain(label);
    expect(completed.responseText).toContain('Synthetischer Prüfleitfaden');
    expect(completed.responseText).not.toContain('Unbeauftragter Entwurf');
    expect(completed.documentReview.stats.documentChars).toBe(fixture.length);
  });

  test('page and chapter followups use evidence with no history or additional LLM calls', async () => {
    const first = await turn(packed('Dokument aufnehmen.'));
    llm.generateStructured.mockClear();
    const page = await turn('Seite 12?');
    expect(page.cetCaseId).toBe(first.cetCaseId);
    expect(page.responseText).toContain('01.06.2030');
    const chapter = await turn('Was steht in Kapitel 3?');
    expect(chapter.responseText).toContain('90 Prozent');
    expect(chapter.responseText).toContain('wiederholter Standardtext ausgelassen');
    expect(llm.generateStructured).not.toHaveBeenCalled();
    const missing = await turn('Seite 999?');
    expect(missing.responseText).toContain('nicht enthalten');
  });

  test('OpenAI-compatible input preserves all document characters, routes outer question and strips source history', async () => {
    const result = await broker.call(
      'openai-compatible.chatCompletions',
      {
        model: GOVERNANCE_MODEL,
        messages: [{ role: 'user', content: packed('Bewerte den Plan.') }],
        metadata: { conversationId: 'openai-doc' },
      },
      { meta: structuredClone(meta) }
    );
    expect(result.cernion.result.documentReview.status).toBe('pending');
    await Promise.all(service.workbenchDocumentReviews.values());
    const docs = await loadDocuments(service.store, {
      tenantId: 'anonymous',
      caseId: result.cernion.result.cetCaseId,
    });
    expect(docs[0].text).toBe(fixture);
    const followup = await broker.call(
      'openai-compatible.chatCompletions',
      {
        model: GOVERNANCE_MODEL,
        messages: [
          { role: 'user', content: packed('Bewerte den Plan.') },
          { role: 'user', content: 'Seite 12?' },
        ],
        metadata: { conversationId: 'openai-doc' },
      },
      { meta: structuredClone(meta) }
    );
    expect(followup.choices[0].message.content).toContain('01.06.2030');
  });

  test('public projections omit raw text and source IDs without mutating stored evidence', async () => {
    const first = await turn(packed('Dokument aufnehmen.'));
    const evidence = await service.store.listEvidence({
      tenantId: 'anonymous',
      caseId: first.cetCaseId,
    });
    const safe = safeEvidenceRef(evidence[0]);
    expect(safe.extracts.document.text).toBeUndefined();
    expect(safe.extracts.document.sourceId).toBeUndefined();
    expect(safe.extracts.document.characterCount).toBe(fixture.length);
    expect(evidence[0].extracts.document.text).toBe(fixture);
  });

  test('first response and pending followup finish while the background provider is blocked', async () => {
    const implementation = llm.generateStructured.getMockImplementation();
    let release;
    const blocked = new Promise((resolve) => {
      release = resolve;
    });
    llm.generateStructured.mockImplementation(async (schema, prompt) => {
      if (schema.properties?.turnKind) await blocked;
      return implementation(schema, prompt);
    });
    let timer;
    try {
      const first = await Promise.race([
        turn(packed('Bewerte den Plan.')),
        new Promise((_, reject) => {
          timer = setTimeout(() => reject(new Error('HTTP turn waited for provider')), 3000);
        }),
      ]);
      expect(first.documentReview.status).toBe('pending');
      expect(retrieval).not.toHaveBeenCalled();
      const pending = await turn('Ergebnis bitte.');
      expect(pending.responseText).toContain('läuft noch');
      expect(pending.pendingEvents).toBeGreaterThan(0);
      const repeated = await turn(packed('Bewerte den Plan.'));
      expect(repeated.responseText).toContain('läuft noch');
      expect(service.workbenchDocumentReviews.size).toBe(1);
    } finally {
      clearTimeout(timer);
      release();
      await Promise.all(service.workbenchDocumentReviews.values());
    }
  });

  test('review budget failure preserves the document and explicitly reports the missing judgement', async () => {
    const old = process.env.WORKBENCH_REVIEW_MAX_CHARS;
    process.env.WORKBENCH_REVIEW_MAX_CHARS = '100';
    try {
      const first = await turn(packed('Bewerte den Plan.'));
      await Promise.all(service.workbenchDocumentReviews.values());
      const result = await turn('Ergebnis bitte.');
      expect(result.responseText).toContain('budget_exceeded');
      expect(result.responseText).toContain('nicht gekürzt');
      expect(result.responseText).not.toContain('**Urteil:**');
      const docs = await loadDocuments(service.store, {
        tenantId: 'anonymous',
        caseId: first.cetCaseId,
      });
      expect(docs[0].text).toBe(fixture);
    } finally {
      if (old === undefined) delete process.env.WORKBENCH_REVIEW_MAX_CHARS;
      else process.env.WORKBENCH_REVIEW_MAX_CHARS = old;
    }
  });

  test('clearance changes hide both stored passages and completed reviews', async () => {
    const first = await turn(packed('Bewerte den Plan.'));
    await Promise.all(service.workbenchDocumentReviews.values());
    const [evidence] = await service.store.listEvidence({
      tenantId: 'anonymous',
      caseId: first.cetCaseId,
    });
    const row = await service.evidenceDb.get(evidence._id);
    await service.evidenceDb.put({ ...row, sensitivityLevel: 'restricted' });
    const flow = require('../src/workbench-document-flow');
    const p = { tenantId: 'anonymous', actorId: 'synthetic-reviewer', clearance: [] };
    for (const userRequest of ['Seite 12?', 'Ergebnis bitte.']) {
      const result = await flow.documentFollowup(service, {
        p,
        caseId: first.cetCaseId,
        envelope: { channel: 'open-webui', conversationId: 'review', userRequest },
      });
      expect(result).toBeNull();
    }
  });

  test('explicit review draft request alone enables the draft, maps with errors render the gaps', async () => {
    const implementation = llm.generateStructured.getMockImplementation();
    let maps = 0;
    llm.generateStructured.mockImplementation(async (schema, prompt) => {
      const data = JSON.parse(prompt);
      if (data.untrustedDocument && ++maps === 2)
        throw Object.assign(new Error('synthetic provider error'), { type: '429' });
      return implementation(schema, prompt);
    });
    await turn(packed('Bewerte den Plan und schreibe einen Entwurf.'));
    await Promise.all(service.workbenchDocumentReviews.values());
    const result = await turn('Ergebnis bitte.');
    expect(result.responseText).toContain('**Entwurf:**');
    expect(result.responseText).toContain('Abschnitt nicht geprüft (429)');
    expect(result.responseText).toContain('Kapitel');
  });

  test('background understanding selects existing read capabilities and asks retrieval for review criteria in mapped scope', async () => {
    const implementation = llm.generateStructured.getMockImplementation();
    const fn = require('../src/function-model')
      .getFunctionModel()
      .functions.find((entry) => entry.capabilities.length);
    llm.generateStructured.mockImplementation(async (schema, prompt) =>
      schema.properties?.turnKind
        ? {
            ...structuredClone(situation),
            hypotheses: [{ kind: 'function', id: fn.functionId, confidence: 0.9 }],
          }
        : implementation(schema, prompt)
    );
    const first = await turn(packed('Bewerte den Plan.'));
    await Promise.all(service.workbenchDocumentReviews.values());
    const [ctx] = retrieval.mock.calls.at(-1);
    expect(ctx.params.situation.concern).toContain('Prüfmaßstäbe und Anforderungen');
    expect(ctx.meta.workbenchSelectedCapabilities).toEqual(expect.arrayContaining(fn.capabilities));
    expect(ctx.meta.workbenchEvidenceCaseId).toBe(first.cetCaseId);
    expect(ctx.meta.tenantId).toBe('anonymous');
  });

  test('a new document invalidates the old review and the next turn reviews the entire new basis', async () => {
    const injection = fs.readFileSync(
      path.join(__dirname, 'fixtures/document-review/neutral-injection.txt'),
      'utf8'
    );
    const implementation = llm.generateStructured.getMockImplementation();
    let release;
    const blocked = new Promise((resolve) => {
      release = resolve;
    });
    llm.generateStructured.mockImplementation(async (schema, prompt) => {
      if (schema.properties?.turnKind) await blocked;
      return implementation(schema, prompt);
    });
    try {
      await turn(packed('Bewerte den Plan.'));
      const added = await turn(packed('Dokument aufnehmen.', injection));
      expect(added.responseText).toContain('neue Dokumentgrundlage');
    } finally {
      release();
      await Promise.all(service.workbenchDocumentReviews.values());
    }
    const next = await turn('Ergebnis bitte.');
    expect(next.documentReview.status).toBe('pending');
    await Promise.all(service.workbenchDocumentReviews.values());
    const completed = await turn('Ergebnis bitte.');
    expect(completed.documentReview.stats.documentChars).toBe(fixture.length + injection.length);
  });

  test('a revoked retrieval-source permission prevents delivery of the old criteria', async () => {
    const first = await turn(packed('Bewerte den Plan.'));
    await Promise.all(service.workbenchDocumentReviews.values());
    const flow = require('../src/workbench-document-flow');
    const p = require('../src/domain-router-policy').principal({ meta: structuredClone(meta) });
    const envelope = {
      channel: 'open-webui',
      conversationId: 'review',
      userRequest: 'Ergebnis bitte.',
    };
    const input = { p, envelope, caseId: first.cetCaseId };
    const denied = await flow.documentFollowup(service, {
      ...input,
      access: { 'willi-mako': false, 'knowledge-rag-federated': true },
    });
    expect(denied).toBeNull();
    const allowed = await flow.documentFollowup(service, {
      ...input,
      access: { 'willi-mako': true, 'knowledge-rag-federated': true },
    });
    expect(allowed.responseText).toContain('Synthetischer Prüfleitfaden');
  });
});

test('question and transport budgets are separate, reject excess rather than silently truncate', () => {
  const input = normalizeTaskEnvelope({ conversationId: 'scope', message: packed('Prüfen.') });
  expect(input.documents[0].text).toBe(fixture);
  expect(input.userRequest).toBe('Prüfen.');
  expect(() =>
    normalizeTaskEnvelope({ conversationId: 'scope', message: packed('x'.repeat(40001)) })
  ).toThrow('too long');
  expect(() =>
    normalizeTaskEnvelope({
      conversationId: 'scope',
      message: packed('Prüfen.', 'x'.repeat(4000001)),
    })
  ).toThrow('Aufnahmegrenze');
});
