'use strict';

jest.mock('../src/llm-client', () => ({
  generateStructured: jest.fn(),
  generateText: jest.fn(),
  generateChat: jest.fn(),
}));
jest.mock('../src/workbench-review', () => {
  const actual = jest.requireActual('../src/workbench-review');
  return { ...actual, reviewDocuments: jest.fn(actual.reviewDocuments) };
});
const llm = require('../src/llm-client');
const review = require('../src/workbench-review');
const { createCaseBroker } = require('./helpers/case-linking-broker');
const { complete, validate } = require('./helpers/workbench-schema-stub');
const { SITUATION_SCHEMA } = require('../src/workbench-understanding');
const source =
  'Abschnitt A: Der Kostenrahmen beträgt 80 Einheiten. Abschnitt B: Die Schätzung beträgt 95 Einheiten.';
const request = 'Bewerte den beigefügten Arbeitsstand.';
const roleMessage = 'Ich bearbeite die Dokumentation.';
const packed = `<context><source name="Arbeitsstand-A.txt">${source}</source></context><user_query>${request}</user_query>`;
let app;
const oldBudget = process.env.WORKBENCH_REVIEW_TIMEOUT_MS;
const chat = (message) =>
  app.call('workbench.chat', {
    channel: 'api',
    conversationId: 'lifecycle',
    message,
  });
const jobs = async () =>
  (await app.workbench.conversationsDb.allDocs({ include_docs: true })).rows
    .map(({ doc }) => doc)
    .filter((doc) => doc.type === 'workbench_document_review');

function model(schema, raw) {
  const input = JSON.parse(raw);
  const message = input.message || input.currentUserMessage;
  let result;
  if (schema.properties?.concern) {
    result = {
      concern: 'Arbeitsstand',
      situation: 'Interne Beschreibung des Prüfauftrags.',
      turnKind: 'knowledge',
      conversationShape: 'knowledge',
      retrievalTerms: ['Arbeitsstand'],
    };
  } else if (input.untrustedDocument) {
    result = {
      claims: [],
      assumptions: [],
      numbers: [],
      measures: [],
      schedule: [],
      citations: [input.lines[0]],
    };
  } else if (input.maps) {
    result = {
      verdict: 'Die Abweichung bleibt offen.',
      rationale: 'Die Angaben stehen in Abschnitt A und B.',
      strengths: [],
      risks: [],
      checkpoints: [],
      contradictions: [],
      openQuestions: [],
      draft: '',
    };
  } else if (schema.properties?.answer) {
    result = { answer: 'Im Arbeitsstand-A.txt stehen 80 und 95 Einheiten (Abschnitt A/B).' };
  } else if (input.task === 'turn_controls') {
    result = { turnKind: 'knowledge_or_orientation', conversationShape: 'knowledge' };
  } else if (input.task === 'token_roles') {
    result = {
      tokens: input.candidates.map(({ index }) => ({
        index,
        category: 'other',
        family: '',
        meaningRequested: false,
      })),
    };
  } else if (input.task === 'output_contract') {
    result = { requestedOutput: { requested: 'ordinary_answer' } };
  } else if (input.currentUserMessage) {
    result = { workContext: { intent: 'none', concrete: false, basis: '', scope: 'none' } };
  } else throw new Error('Unexpected structured schema');
  if (message === roleMessage && schema.properties?.roleStatement) {
    result.roleStatement = {
      subject: 'self',
      firstPerson: true,
      answersQuestionKey: '',
      basis: roleMessage,
      role: 'Dokumentation',
      mandate: '',
      goal: '',
      roleOnly: true,
    };
  }
  const completed = complete(schema, result);
  validate(schema, completed);
  if (schema.properties?.concern) {
    const local = structuredClone(completed);
    local.requestedOutput.requested = false;
    validate(SITUATION_SCHEMA, local);
  }
  return completed;
}

beforeEach(async () => {
  process.env.WORKBENCH_REVIEW_TIMEOUT_MS = '500';
  review.reviewDocuments
    .mockReset()
    .mockImplementation(jest.requireActual('../src/workbench-review').reviewDocuments);
  llm.generateStructured.mockReset().mockImplementation(model);
  llm.generateText.mockReset().mockImplementation(async (_raw, options) =>
    JSON.stringify(
      complete(options.responseSchema, {
        interpretation: [
          {
            text: 'Die Einordnung bleibt vorläufig.',
            origin: 'model',
            supported: 'model',
            specific: false,
            completedAction: false,
            evidenceIds: [],
          },
        ],
      })
    )
  );
  app = await createCaseBroker();
  await app.broker.start();
});
afterEach(async () => {
  await app.cleanup();
  if (oldBudget === undefined) delete process.env.WORKBENCH_REVIEW_TIMEOUT_MS;
  else process.env.WORKBENCH_REVIEW_TIMEOUT_MS = oldBudget;
});

test.each(['preflight', 'map', 'reduce'])(
  'the entire review times out when %s hangs; late completion cannot overwrite failure',
  async (phase) => {
    let release;
    const gate = new Promise((resolve) => {
      release = resolve;
    });
    let blocked = false;
    llm.generateStructured.mockImplementation(async (schema, raw) => {
      const input = JSON.parse(raw);
      if (
        (phase === 'preflight' && schema.properties?.concern && input.message === request) ||
        (phase === 'map' && input.untrustedDocument) ||
        (phase === 'reduce' && input.maps)
      ) {
        blocked = true;
        await gate;
      }
      return model(schema, raw);
    });
    try {
      expect((await chat(packed)).documentReview.status).toBe('pending');
      expect((await chat('Ergebnis bitte.')).responseText).toContain('läuft noch');
      const tasks = [...app.workbench.workbenchDocumentReviews.values()];
      // No provider release is needed to complete the lifecycle/shutdown handle.
      await Promise.all(tasks);
      expect(blocked).toBe(true);
      const [job] = await jobs();
      expect(job.state).toBe('failed');
      expect(job.result.status).toBe('timeout');
      expect(job.completedAt).toBeGreaterThanOrEqual(job.startedAt);
      expect(app.workbench.workbenchDocumentReviews.size).toBe(0);
      const result = await chat('Ist die Dokumentprüfung fertig?');
      expect(result.documentReview.status).toBe('timeout');
      expect(result.responseText).toContain('Zeitbudgets abgebrochen');
      expect(result.responseText).not.toContain('läuft noch');
      expect((await chat(roleMessage)).responseText).toContain('Ich richte mich');
      expect((await chat('Was steht im Arbeitsstand?')).responseText).toContain('80 und 95');
      release();
      await new Promise((resolve) => setImmediate(resolve));
      const again = await chat('Ergebnis bitte.');
      expect(again.documentReview.status).toBe('timeout');
      expect(again.responseText).toContain('abgebrochen');
      const [stored] = await jobs();
      expect(stored.runId).toBe(job.runId);
      expect(stored.result.status).toBe('timeout');
    } finally {
      release();
    }
  }
);

test.each(['schema', 'quota', 'exception'])(
  'a %s failure reaches a terminal state without blocking normal turns',
  async (kind) => {
    if (kind === 'schema') {
      llm.generateStructured.mockImplementation(async (schema, raw) => {
        if (JSON.parse(raw).untrustedDocument) return { claims: 7 };
        return model(schema, raw);
      });
    } else {
      const error = Object.assign(
        new Error('PRIVATE-ERROR-DETAIL'),
        kind === 'quota' ? { type: 'LLM_QUOTA_EXCEEDED' } : {}
      );
      review.reviewDocuments.mockRejectedValueOnce(error);
    }
    await chat(packed);
    await Promise.all(app.workbench.workbenchDocumentReviews.values());
    const [job] = await jobs();
    expect(job.state).toBe('failed');
    expect(job.result.status).not.toBe('completed');
    const result = await chat('Ergebnis bitte.');
    expect(result.documentReview.status).not.toBe('pending');
    expect(result.responseText).not.toMatch(/läuft noch|PRIVATE-ERROR-DETAIL|WORKBENCH_/);
    expect(result.responseText).toMatch(/nicht|fehlgeschlagen|Kontingent|Modell/);
    expect((await chat(roleMessage)).responseText).toContain('Ich richte mich');
    expect((await chat('Was steht im Arbeitsstand?')).responseText).toContain('80 und 95');
  }
);

test('a persistence exception is recorded as failure instead of leaving running behind', async () => {
  const original = app.workbench.conversationsDb.put.bind(app.workbench.conversationsDb);
  let rejected = false;
  jest.spyOn(app.workbench.conversationsDb, 'put').mockImplementation(async (doc) => {
    if (doc.type === 'workbench_document_review' && doc.state === 'ready' && !rejected) {
      rejected = true;
      throw new Error('Synthetic write failure');
    }
    return original(doc);
  });
  await chat(packed);
  await Promise.all(app.workbench.workbenchDocumentReviews.values());
  expect(rejected).toBe(true);
  expect((await jobs())[0].state).toBe('failed');
  expect((await chat('Ergebnis bitte.')).responseText).toContain('fehlgeschlagen');
});

test.each(['orphan', 'expired'])(
  'a persisted %s job is closed on a status request, without restarting it',
  async (kind) => {
    let release;
    const gate = new Promise((resolve) => {
      release = resolve;
    });
    llm.generateStructured.mockImplementation(async (schema, raw) => {
      if (schema.properties?.concern && JSON.parse(raw).message === request) await gate;
      return model(schema, raw);
    });
    let tasks;
    try {
      await chat(packed);
      tasks = [...app.workbench.workbenchDocumentReviews.values()];
      const [job] = await jobs();
      if (kind === 'orphan') app.workbench.workbenchDocumentReviews.clear();
      else await app.workbench.conversationsDb.put({ ...job, deadlineAt: Date.now() - 1 });
      const result = await chat('Ergebnis bitte.');
      expect(result.responseText).toContain(kind === 'orphan' ? 'unterbrochen' : 'abgebrochen');
      expect(result.documentReview.status).not.toBe('pending');
      release();
      await Promise.all(tasks);
      const [stored] = await jobs();
      expect(stored.runId).toBe(job.runId);
      expect(stored.result.status).not.toBe('completed');
      expect((await chat(roleMessage)).responseText).toContain('Ich richte mich');
    } finally {
      release();
      await Promise.all(tasks || []);
    }
  }
);

test('the generated onboarding request is a content request; standalone review inflections remain supported', () => {
  const { isReviewRequest } = require('../src/workbench-document-input');
  const scenario = require('../scripts/generate-practice-evaluation-fixtures')
    .generatePracticeCatalog()
    .scenarios.find((item) => item.id === 'role-onboarding');
  expect(isReviewRequest(scenario.turns[0].message)).toBe(false);
  for (const question of [
    'Prüfe das Dokument.',
    'Bitte prüfen.',
    'Bitte um Prüfung des Dokuments.',
    'Pruefen Sie das Dokument.',
    'Bewerte das Dokument.',
    'Erstelle ein Gutachten.',
  ])
    expect(isReviewRequest(question)).toBe(true);
});
