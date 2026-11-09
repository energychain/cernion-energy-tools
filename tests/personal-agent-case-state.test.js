'use strict';

// The personal agent keeps a case state per session (BK-01..04): it is updated before routing,
// rejects a broker route the work model judges unrelated, and the answer is written from it.
jest.mock('../src/llm-client', () => ({ generateStructured: jest.fn() }));
const llm = require('../src/llm-client');
const fs = require('node:fs');
const path = require('node:path');
const { applyCaseUpdate, createCaseState } = require('../src/case-state');

const dir = path.join(__dirname, '../services/personal-agent');
const methods = Object.assign(
  {},
  ...fs
    .readdirSync(dir)
    .filter((name) => /^methods-part-\d+-of-\d+\.js$/u.test(name))
    .map((name) => require(path.join(dir, name)))
);
const warnings = [];
const service = Object.assign(Object.create(null), methods, {
  logger: { info() {}, warn: (line) => warnings.push(line), debug() {}, error() {} },
  broker: null,
});

const delta = (overrides = {}) => ({
  workIntent: {
    object: 'Record 7',
    task: 'compare file and screen',
    requestedOutcome: 'difference and next step',
    role: 'operations',
    consequenceOfMisframing: 'wrong record corrected',
    ambiguous: false,
    separatingQuestion: '',
  },
  routeFit: [],
  evidence: [],
  claims: [],
  hypothesisUpdates: [],
  crossEvidence: [],
  openQuestions: [],
  nextActions: [],
  closureCriteria: [],
  ...overrides,
});

beforeEach(() => {
  llm.generateStructured.mockReset();
  warnings.length = 0;
});

test('the update reads attached files as observed evidence and the broker candidates', async () => {
  llm.generateStructured.mockResolvedValue(
    delta({ routeFit: [{ candidateId: 'cap-x', fit: 'unrelated', reason: 'other task' }] })
  );
  const state = await service.updateTurnCaseState(
    {},
    {
      session: { l3: {} },
      message: 'Passt die Datei zum Bild?',
      inhouseData: [
        { fileName: 'a.txt', content: 'record 7' },
        { fileName: 'b.png', content: 'record 8', source: 'vision_transcript' },
        { fileName: 'c.pdf' },
      ],
      brokerRecommendation: { recommendedCapabilities: [{ capability: 'cap-x' }] },
      tenantId: 't1',
    }
  );
  const input = JSON.parse(llm.generateStructured.mock.calls[0][1]);
  expect(input.newEvidence).toEqual([
    { source: 'Datei a.txt', kind: 'source_observed', content: 'record 7' },
    { source: 'Bildabschrift b.png', kind: 'source_observed', content: 'record 8' },
  ]);
  expect(input.candidates).toEqual([expect.objectContaining({ candidateId: 'cap-x' })]);
  expect(llm.generateStructured.mock.calls[0][2]).toMatchObject({ tenantId: 't1' });
  expect(state.workIntent.task).toBe('compare file and screen');
});

test('a failed update keeps the previous state', async () => {
  const previous = applyCaseUpdate(createCaseState(), delta());
  llm.generateStructured.mockRejectedValue(new Error('provider down'));
  const state = await service.updateTurnCaseState(
    {},
    { session: { l3: { caseState: previous } }, message: 'weiter', brokerRecommendation: {} }
  );
  expect(state).toEqual(previous);
  expect(warnings[0]).toContain('provider down');
});

test('a broker route judged unrelated to the task does not frame the answer', () => {
  const broker = {
    intent: 'cap-x.status',
    capability: 'cap-x',
    confidence: 0.92,
    uncertain: false,
    recommendedCapabilities: [{ capability: 'cap-x' }],
    recommendedPlan: [{ action: 'cap-x.status' }],
  };
  const unrelated = applyCaseUpdate(createCaseState(), {
    routeFit: [{ candidateId: 'cap-x', fit: 'unrelated', reason: 'only shared words' }],
  });
  expect(service.alignBrokerWithCaseState(broker, unrelated)).toMatchObject({
    uncertain: true,
    intent: 'clarify',
    capability: null,
    recommendedCapabilities: [],
    recommendedPlan: [],
    caseStateRouteRejected: { capability: 'cap-x', reason: 'only shared words' },
  });
  const fits = applyCaseUpdate(createCaseState(), {
    routeFit: [{ candidateId: 'cap-x', fit: 'fits', reason: 'same task' }],
  });
  expect(service.alignBrokerWithCaseState(broker, fits)).toBe(broker);
  expect(service.alignBrokerWithCaseState(broker, null)).toBe(broker);
});

test('the route fit decides whether a receipt may answer instead of the consultation (USL-SYN-02)', () => {
  const broker = { capability: 'cap-x', recommendedCapabilities: [{ capability: 'cap-x' }] };
  const judged = (fit) =>
    applyCaseUpdate(createCaseState(), { routeFit: [{ candidateId: 'cap-x', fit, reason: 'r' }] });
  expect(service.caseRouteFit(broker, judged('fits'))).toBe('fits');
  expect(service.caseRouteFit(broker, judged('partial'))).toBe('partial');
  // Routes were judged, but not this one: no permission to pre-empt.
  const other = applyCaseUpdate(createCaseState(), {
    routeFit: [{ candidateId: 'cap-y', fit: 'fits', reason: 'r' }],
  });
  expect(service.caseRouteFit(broker, other)).toBe('unassessed');
  // No route judgement at all (e.g. case state off): the previous behaviour stays.
  expect(service.caseRouteFit(broker, createCaseState())).toBeNull();
  expect(service.caseRouteFit(broker, null)).toBeNull();
});

test('the answer is written from the case state; the history is only context', () => {
  const caseView = { workIntent: { task: 't' }, activeHypotheses: [], noLongerValid: [] };
  const prompt = service.buildConsultationPrompt.call(service, {
    message: 'Abschluss bitte',
    brokerRecommendation: {},
    resolvedParams: {},
    knowledgeContext: null,
    responseStrategy: { audience: 'general' },
    recentHistoryWindow: [{ role: 'user', text: 'früher' }],
    caseView,
  });
  expect(prompt).toContain('Fallzustand (konsolidierter aktueller Stand');
  expect(prompt).toContain(JSON.stringify(caseView));
  expect(prompt).toContain('noLongerValid nie wieder als aktive Ursache');
  expect(prompt).toContain('bei Abweichungen gilt der Fallzustand');
  const without = service.buildConsultationPrompt.call(service, {
    message: 'x',
    brokerRecommendation: {},
    resolvedParams: {},
    knowledgeContext: null,
    responseStrategy: { audience: 'general' },
  });
  expect(without).not.toContain('Fallzustand');
});

test('the case state survives persisting and loading the session', async () => {
  const { buildPersistableSessionState } = require('../src/personal-agent-context');
  const caseState = applyCaseUpdate(createCaseState(), delta());
  const stored = buildPersistableSessionState({
    id: 's1',
    tenantId: 't1',
    userId: 'u1',
    l3: { caseState },
  });
  const loader = Object.assign(Object.create(service), {
    loadUserProfile: async () => ({}),
    assertSessionOwnerAccess: () => {},
  });
  const session = await loader.loadSession(
    { meta: {}, call: async () => ({ payload: stored }) },
    't1',
    's1',
    'u1'
  );
  expect(session.l3.caseState).toEqual(caseState);
});

describe('background reflection in the personal agent', () => {
  const previous = process.env.CASE_REFLECTION;
  afterEach(() => {
    if (previous === undefined) delete process.env.CASE_REFLECTION;
    else process.env.CASE_REFLECTION = previous;
  });

  test('the reflection is merged into the stored session state', async () => {
    process.env.CASE_REFLECTION = 'true';
    const state = applyCaseUpdate(createCaseState(), delta());
    const stored = { payload: { l3: { history: ['kept'], caseState: state } } };
    const calls = [];
    const ctx = {
      meta: {},
      call: async (name, params) => {
        calls.push(name);
        if (name === 'object-store.get') return structuredClone(stored);
        if (name === 'object-store.put') stored.payload = params.payload;
        return {};
      },
    };
    llm.generateStructured.mockResolvedValue({ ...delta(), addendum: 'Neu eingeordnet.' });
    const merged = await service.scheduleCaseReflection(ctx, {
      tenantId: 't1',
      sessionId: 's1',
      caseState: state,
    });
    expect(llm.generateStructured.mock.calls[0][2]).toMatchObject({ phase: 'case_reflection' });
    expect(calls).toEqual(['object-store.get', 'object-store.put']);
    expect(stored.payload.l3.history).toEqual(['kept']);
    expect(stored.payload.l3.caseState.pendingAddendum).toBe('Neu eingeordnet.');
    expect(merged.reflectedAtTurn).toBe(1);
  });

  test('the addendum precedes the next consultation answer once', () => {
    const state = { ...applyCaseUpdate(createCaseState(), delta()), pendingAddendum: 'Neu.' };
    const first = service.withCaseAddendum('Antwort.', state);
    expect(first.reply).toBe('Nachtrag zum bisherigen Stand: Neu.\n\nAntwort.');
    expect(service.withCaseAddendum('Antwort.', first.caseState).reply).toBe('Antwort.');
    expect(service.withCaseAddendum('Antwort.', null)).toEqual({
      reply: 'Antwort.',
      caseState: null,
    });
  });
});
