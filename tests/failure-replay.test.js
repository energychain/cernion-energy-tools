'use strict';

jest.mock('../src/llm-client', () => ({
  generateStructured: jest.fn(async () => ({
    level: 'B',
    levelReason: 'Teamgedächtnis ergänzen',
    summary: 'Eine Frage zum Haus blieb unbeantwortet',
    hypothesis: 'Angabe des Hauses unbekannt',
    expected: 'Antwort mit der Angabe des Hauses',
  })),
}));
jest.mock('../src/failure-replay', () => ({ shadowReplay: jest.fn() }));
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { ServiceBroker } = require('moleculer');
const replay = require('../src/failure-replay');

const FUNCTION_ID = require('../src/function-model').getFunctionModel().functions[0].functionId;
const QUESTION = 'Welcher Bilanzkreis gilt bei uns für Netzverluste?';

describe('level B shadow replay (#1010 step 3)', () => {
  let broker, dir, journal;
  const meta = {
    authUser: { tenantId: 'synthetic-a', userId: 'person-a', roles: ['ROLE_TENANT_ADMIN'] },
  };
  const service = () => broker.getLocalService('failure-signals');
  const outcome = (extra = {}) => ({
    unanswered: false,
    timeouts: [],
    openQuestions: 0,
    functionIds: [FUNCTION_ID],
    disagreement: false,
    ...extra,
  });
  const turn = (input) =>
    service().observeTurn({
      tenantId: 'synthetic-a',
      conversationId: 'chat-1',
      turnRef: input.turnRef || 't',
      outcome: outcome(input.outcome),
      question: input.question,
      capturedFacts: input.capturedFacts,
      replayCtx: input.capturedFacts
        ? {
            broker,
            meta,
            call: (name, params, options) => broker.call(name, params, { ...options, meta }),
          }
        : undefined,
    });
  const settle = () => service().idle();
  const cases = () => broker.call('failure-signals.cases', {}, { meta });

  beforeEach(async () => {
    dir = fs.mkdtempSync(path.join(os.tmpdir(), 'failure-replay-'));
    journal = [];
    replay.shadowReplay.mockReset();
    broker = new ServiceBroker({ logger: false });
    const schema = require('../services/failure-signals.service');
    broker.createService({ ...schema, settings: { ...schema.settings, dbPath: dir } });
    broker.createService({
      name: 'journal',
      actions: {
        append(ctx) {
          journal.push(ctx.params);
          return ctx.params;
        },
      },
    });
    await broker.start();
  });
  afterEach(async () => {
    await broker.stop();
    fs.rmSync(dir, { recursive: true, force: true });
  });

  const openCase = async () => {
    // A plain-language rejection opens a level-B case and keeps the rejected question
    // tenant-internally (the previous one, not the rejection itself).
    await turn({ question: QUESTION, turnRef: 't0' });
    await turn({
      outcome: { disagreement: true },
      question: 'Nein, das stimmt so nicht.',
      turnRef: 't1',
    });
    await settle();
    const [item] = await cases();
    expect(item).toMatchObject({ status: 'open', level: 'B' });
    return item;
  };

  test('new tenant data plus a passing replay resolves the case; the question is forgotten', async () => {
    const opened = await openCase();
    replay.shadowReplay.mockResolvedValue({
      passed: true,
      answered: true,
      answerStatus: 'grounded',
      usedFacts: ['fact-new'],
      timeouts: 0,
      at: new Date().toISOString(),
    });
    await turn({ capturedFacts: ['fact-new'], turnRef: 't2' });
    await settle();
    expect(replay.shadowReplay).toHaveBeenCalledWith(expect.objectContaining({ meta }), {
      tenantId: 'synthetic-a',
      question: QUESTION,
      newFactIds: ['fact-new'],
    });
    const [item] = await cases();
    expect(item).toMatchObject({
      caseId: opened.caseId,
      status: 'resolved_runtime',
      runtime: {
        level: 'B',
        action: 'tenant_data_replay',
        attempts: 1,
        replay: { kind: 'shadow_replay', passed: true, usedFacts: ['fact-new'] },
      },
    });
    expect(journal).toEqual([
      expect.objectContaining({
        functionId: FUNCTION_ID,
        kind: 'decided',
        refs: [{ kind: 'failureCase', id: opened.caseId }],
      }),
    ]);
    const docs = await service().db.allDocs({ include_docs: true });
    expect(docs.rows.some((row) => row.doc.type === 'failure_replay_question')).toBe(false);
  });

  test('a failing replay keeps the case open and stops after three attempts', async () => {
    await openCase();
    replay.shadowReplay.mockResolvedValue({ passed: false, answered: true, usedFacts: [] });
    for (let i = 0; i < 4; i++) {
      await turn({ capturedFacts: [`fact-${i}`], turnRef: `t${i + 2}` });
      await settle();
    }
    expect(replay.shadowReplay).toHaveBeenCalledTimes(3);
    const [item] = await cases();
    expect(item).toMatchObject({ status: 'open', runtime: { attempts: 3 } });
  });

  test('the question never appears in signals, case views or the summary', async () => {
    await openCase();
    const signals = await broker.call('failure-signals.list', {}, { meta });
    const summary = await broker.call('failure-signals.summary', {}, { meta });
    const visible = JSON.stringify([signals, await cases(), summary]);
    expect(visible).not.toContain('Bilanzkreis');
  });

  test('a case opened in the same turn is not replayed; other levels are not replayed', async () => {
    await turn({
      outcome: { disagreement: true },
      question: QUESTION,
      capturedFacts: ['fact-same-turn'],
    });
    await settle();
    expect(replay.shadowReplay).not.toHaveBeenCalled();
  });

  test('stored questions go with their case', async () => {
    const opened = await openCase();
    const docs = await service().db.allDocs({ include_docs: true });
    const bundle = docs.rows.map((row) => row.doc).find((doc) => doc.caseId === opened.caseId);
    await service().db.put({ ...bundle, status: 'rejected' });
    await service().prune();
    const after = await service().db.allDocs({ include_docs: true });
    expect(after.rows.some((row) => row.doc.type === 'failure_replay_question')).toBe(false);
  });
});

describe('shadow replay itself', () => {
  const { shadowReplay } = jest.requireActual('../src/failure-replay');
  const understanding = require('../src/workbench-understanding');
  const tenantMemory = require('../src/tenant-memory');
  afterEach(() => jest.restoreAllMocks());

  const run = async ({ answerStatus = 'grounded', memoryKeys = ['fact-new'] } = {}) => {
    jest.spyOn(understanding, 'understand').mockResolvedValue({ hypotheses: [] });
    jest.spyOn(understanding, 'answer').mockResolvedValue({ answerStatus, metadata: {} });
    jest.spyOn(tenantMemory, 'related').mockResolvedValue({
      evidence: memoryKeys.map((key) => ({
        retrievalSource: 'tenant-memory',
        metadata: { key },
      })),
    });
    const ctx = {
      meta: { authUser: { tenantId: 'synthetic-a', userId: 'person-a', roles: ['ROLE_EDM'] } },
      call: jest.fn(async () => ({ evidence: [], trace: [] })),
    };
    const result = await shadowReplay(ctx, {
      tenantId: 'synthetic-a',
      question: QUESTION,
      newFactIds: ['fact-new'],
    });
    return { result, ctx };
  };

  test('passes only with an answer that uses a new fact, and only reads', async () => {
    const { result, ctx } = await run();
    expect(result).toMatchObject({ passed: true, answered: true, usedFacts: ['fact-new'] });
    // The only backend call is the read-only evidence collection, without granted source access.
    expect(ctx.call.mock.calls.map((call) => call[0])).toEqual([
      'personal-agent.collectWorkbenchEvidence',
    ]);
    expect(ctx.call.mock.calls[0][2].meta.workbenchEvidenceAccess).toBeUndefined();
    expect((await run({ memoryKeys: ['fact-old'] })).result.passed).toBe(false);
    expect((await run({ answerStatus: 'fallback' })).result).toMatchObject({
      passed: false,
      answered: false,
    });
  });
});
