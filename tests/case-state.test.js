'use strict';

const {
  applyCaseUpdate,
  caseStateView,
  createCaseState,
  evidenceStatus,
  normalizeCaseState,
  updateCaseState,
} = require('../src/case-state');

const report = (ref, content) => ({ ref, kind: 'user_reported', source: 'Person', content });
const observed = (ref, source, content) => ({ ref, kind: 'source_observed', source, content });

describe('claim-level evidence (BK-02)', () => {
  test('a claim marked verified without observed evidence falls back to its real basis', () => {
    const state = applyCaseUpdate(createCaseState(), {
      evidence: [report('n1', 'Record A was valid until month 9.')],
      claims: [
        {
          statement: 'Record A was valid until month 9.',
          basis: 'source_observed',
          evidenceRefs: ['n1'],
          central: true,
        },
        {
          statement: 'Record B existed before.',
          basis: 'confirmed',
          evidenceRefs: [],
          central: true,
        },
      ],
    });
    expect(state.claims.map((claim) => claim.basis)).toEqual(['user_reported', 'hypothesis']);
    expect(evidenceStatus(state)).toBe('partial');
  });

  test('verified only when every central claim cites observed or confirmed evidence', () => {
    const delta = {
      evidence: [
        observed('n1', 'Attachment 1', 'Status: open'),
        report('n2', 'It worked last month.'),
      ],
      claims: [
        {
          statement: 'The status is open.',
          basis: 'source_observed',
          evidenceRefs: ['n1'],
          central: true,
        },
        {
          statement: 'It worked last month.',
          basis: 'user_reported',
          evidenceRefs: ['n2'],
          central: false,
        },
      ],
    };
    expect(evidenceStatus(applyCaseUpdate(createCaseState(), delta))).toBe('verified');
    delta.claims[1].central = true;
    expect(evidenceStatus(applyCaseUpdate(createCaseState(), delta))).toBe('partial');
  });

  test('a claim is never stronger than proposed, and derived needs evidence', () => {
    const state = applyCaseUpdate(createCaseState(), {
      evidence: [observed('n1', 'Attachment 1', 'Value 7')],
      claims: [
        { statement: 'Value is 7.', basis: 'user_reported', evidenceRefs: ['n1'], central: false },
        { statement: 'Value implies X.', basis: 'derived', evidenceRefs: ['n1'], central: false },
        { statement: 'Value implies Y.', basis: 'derived', evidenceRefs: [], central: false },
      ],
    });
    expect(state.claims.map((claim) => claim.basis)).toEqual([
      'hypothesis',
      'derived',
      'hypothesis',
    ]);
  });

  test('a replaced claim leaves the current state', () => {
    let state = applyCaseUpdate(createCaseState(), {
      claims: [
        { statement: 'Period 1 is open.', basis: 'hypothesis', evidenceRefs: [], central: true },
      ],
    });
    state = applyCaseUpdate(state, {
      evidence: [observed('n1', 'Document 2', 'Period 1 closed')],
      claims: [
        {
          statement: 'Period 1 is closed.',
          basis: 'source_observed',
          evidenceRefs: ['n1'],
          central: true,
          replacesClaimId: 'C1',
        },
      ],
    });
    expect(caseStateView(state).claims.map((claim) => claim.statement)).toEqual([
      'Period 1 is closed.',
    ]);
    expect(caseStateView(state).evidenceStatus).toBe('verified');
  });
});

describe('hypothesis lifecycle (BK-03)', () => {
  const start = () =>
    applyCaseUpdate(createCaseState(), {
      evidence: [report('n1', 'Message type P is missing.')],
      hypothesisUpdates: [
        {
          statement: 'Cause is message type P.',
          status: 'open',
          evidenceRefs: ['n1'],
          reason: 'first reading',
        },
      ],
    });

  test('new evidence refutes; the closing view lists the hypothesis only as no longer valid', () => {
    const state = applyCaseUpdate(start(), {
      evidence: [observed('n2', 'Document 2', 'Message type P was sent and acknowledged.')],
      hypothesisUpdates: [
        {
          hypothesisId: 'H1',
          statement: 'Cause is message type P.',
          status: 'refuted',
          evidenceRefs: ['n2'],
          reason: 'P acknowledged',
        },
        {
          statement: 'Cause is the follow-up step Q.',
          status: 'supported',
          evidenceRefs: ['n2'],
          reason: 'P done, Q open',
        },
      ],
    });
    const view = caseStateView(state);
    expect(view.activeHypotheses.map((item) => item.statement)).toEqual([
      'Cause is the follow-up step Q.',
    ]);
    expect(view.noLongerValid).toEqual([
      expect.objectContaining({
        id: 'H1',
        status: 'refuted',
        reason: 'P acknowledged',
        changedAtTurn: 2,
      }),
    ]);
    expect(state.hypotheses[0].history.map((row) => row.to)).toEqual(['open', 'refuted']);
  });

  test('a refuted hypothesis does not return without new evidence', () => {
    const refuted = applyCaseUpdate(start(), {
      evidence: [observed('n2', 'Document 2', 'P acknowledged')],
      hypothesisUpdates: [
        {
          hypothesisId: 'H1',
          statement: 'x',
          status: 'refuted',
          evidenceRefs: ['n2'],
          reason: 'acknowledged',
        },
      ],
    });
    const again = applyCaseUpdate(refuted, {
      hypothesisUpdates: [
        {
          hypothesisId: 'H1',
          statement: 'x',
          status: 'supported',
          evidenceRefs: ['E1', 'E2'],
          reason: 'closing summary',
        },
      ],
    });
    expect(again.hypotheses[0].status).toBe('refuted');
    expect(again.violations).toEqual([
      expect.objectContaining({ rule: 'reactivation_without_new_evidence', hypothesisId: 'H1' }),
    ]);
    const reopened = applyCaseUpdate(refuted, {
      evidence: [observed('n3', 'Document 3', 'P rejected later')],
      hypothesisUpdates: [
        {
          hypothesisId: 'H1',
          statement: 'x',
          status: 'open',
          evidenceRefs: ['n3'],
          reason: 'later rejection',
        },
      ],
    });
    expect(reopened.hypotheses[0].status).toBe('open');
  });

  test('supersession points to the replacing hypothesis; disallowed transitions are recorded', () => {
    let state = applyCaseUpdate(start(), {
      hypothesisUpdates: [
        { statement: 'Cause is R.', status: 'open', evidenceRefs: [], reason: 'new reading' },
      ],
    });
    state = applyCaseUpdate(state, {
      hypothesisUpdates: [
        {
          hypothesisId: 'H1',
          statement: 'x',
          status: 'superseded',
          supersededBy: 'H2',
          evidenceRefs: [],
          reason: 'R explains more',
        },
      ],
    });
    expect(state.hypotheses[0]).toMatchObject({ status: 'superseded', supersededBy: 'H2' });
    const confirmed = applyCaseUpdate(state, {
      hypothesisUpdates: [
        { hypothesisId: 'H2', statement: 'x', status: 'confirmed', evidenceRefs: [], reason: 'ok' },
      ],
    });
    const back = applyCaseUpdate(confirmed, {
      hypothesisUpdates: [
        { hypothesisId: 'H2', statement: 'x', status: 'open', evidenceRefs: [], reason: 'unsure' },
      ],
    });
    expect(back.hypotheses[1].status).toBe('confirmed');
    expect(back.violations.at(-1)).toMatchObject({ rule: 'transition_not_allowed' });
  });
});

describe('cross-evidence and work model (BK-01, BK-04)', () => {
  test('a source comparison needs two known pieces of evidence and keeps its consequence', () => {
    const state = applyCaseUpdate(createCaseState(), {
      evidence: [
        observed('n1', 'File A', 'Object 1001'),
        observed('n2', 'Screenshot B', 'Object 1002'),
      ],
      crossEvidence: [
        {
          leftRef: 'n1',
          rightRef: 'n2',
          relation: 'contradicts',
          difference: '1001 vs 1002',
          consequence: 'File A is about another object',
          clarification: 'Which object is meant?',
        },
        {
          leftRef: 'n1',
          rightRef: 'missing',
          relation: 'agrees',
          difference: '',
          consequence: '',
          clarification: '',
        },
      ],
    });
    expect(caseStateView(state).sourceComparison).toEqual([
      expect.objectContaining({ sources: ['File A', 'Screenshot B'], relation: 'contradicts' }),
    ]);
  });

  test('the work model and route fit are kept per turn; ambiguity carries one question', () => {
    const state = applyCaseUpdate(createCaseState(), {
      workIntent: {
        object: 'Record 7',
        task: 'reassign',
        requestedOutcome: 'auditable procedure',
        role: 'operations',
        consequenceOfMisframing: 'wrong party billed',
        ambiguous: false,
        separatingQuestion: 'ignored',
      },
      routeFit: [
        { candidateId: 'a', fit: 'fits', reason: 'same task' },
        { candidateId: 'b', fit: 'nonsense', reason: 'only shared words' },
      ],
    });
    expect(state.workIntent).toMatchObject({
      task: 'reassign',
      ambiguous: false,
      separatingQuestion: '',
    });
    expect(state.routing.candidates.map((row) => row.fit)).toEqual(['fits', 'unrelated']);
  });

  test('an unknown or old state starts fresh; the update is pure', () => {
    expect(normalizeCaseState({ version: 0, claims: [1] })).toEqual(createCaseState());
    const before = createCaseState();
    applyCaseUpdate(before, {
      claims: [{ statement: 's', basis: 'hypothesis', evidenceRefs: [] }],
    });
    expect(before.claims).toEqual([]);
  });
});

test('updateCaseState sends state, message, evidence and candidates as data and applies the delta', async () => {
  const calls = [];
  const llm = {
    generateStructured: async (schema, prompt, options) => {
      calls.push({ schema, input: JSON.parse(prompt), options });
      return {
        workIntent: {
          object: 'o',
          task: 't',
          requestedOutcome: 'r',
          role: '',
          consequenceOfMisframing: '',
          ambiguous: false,
          separatingQuestion: '',
        },
        routeFit: [],
        evidence: [observed('n1', 'Attachment 1', 'seen')],
        claims: [
          { statement: 'seen', basis: 'source_observed', evidenceRefs: ['n1'], central: true },
        ],
        hypothesisUpdates: [],
        crossEvidence: [],
        openQuestions: [],
        nextActions: [],
        closureCriteria: [],
      };
    },
  };
  const state = await updateCaseState(
    createCaseState(),
    {
      message: 'Please check.',
      newEvidence: [{ source: 'Attachment 1', content: 'seen' }],
      candidates: [{ id: 'cap-a', description: 'does a' }],
    },
    { llm, tenantId: 't1' }
  );
  expect(calls[0].input).toMatchObject({
    message: 'Please check.',
    newEvidence: [{ source: 'Attachment 1', kind: 'source_observed', content: 'seen' }],
    candidates: [{ candidateId: 'cap-a', description: 'does a' }],
  });
  expect(calls[0].input.instruction).toContain('untrusted');
  expect(calls[0].options.tenantId).toBe('t1');
  expect(state.turn).toBe(1);
  expect(evidenceStatus(state)).toBe('verified');
});

test('a repeated statement updates the current claim instead of adding a duplicate', () => {
  let state = applyCaseUpdate(createCaseState(), {
    claims: [
      { statement: 'Value is 7.', basis: 'source_observed', evidenceRefs: [], central: false },
    ],
  });
  state = applyCaseUpdate(state, {
    evidence: [observed('n1', 'Attachment 1', 'Value 7')],
    claims: [
      { statement: 'value is 7', basis: 'source_observed', evidenceRefs: ['n1'], central: true },
    ],
  });
  expect(state.claims).toHaveLength(1);
  expect(state.claims[0]).toMatchObject({
    basis: 'source_observed',
    central: true,
    evidenceIds: ['E1'],
  });
});

describe('pre-output answer review', () => {
  const { reviewAnswer } = require('../src/case-state');
  const state = applyCaseUpdate(createCaseState(), {
    hypothesisUpdates: [
      { statement: 'Cause is P.', status: 'open', evidenceRefs: [], reason: 'r' },
    ],
  });
  const draft = 'Cause is P or Q. We checked everything and the next step is to call the party.';
  const llmReturning = (result) => ({ generateStructured: jest.fn().mockResolvedValue(result) });

  test('flagged passages are revised; the state view is sent with the draft', async () => {
    const llm = llmReturning({
      issues: [{ kind: 'unlisted_cause', excerpt: 'or Q', fix: 'drop Q' }],
      revisedReply: 'Cause is P. We checked everything and the next step is to call the party.',
    });
    const result = await reviewAnswer(draft, state, { llm });
    expect(result).toMatchObject({
      revised: true,
      issues: [expect.objectContaining({ kind: 'unlisted_cause' })],
    });
    expect(result.reply).not.toContain('or Q');
    const input = JSON.parse(llm.generateStructured.mock.calls[0][1]);
    expect(input.caseState.activeHypotheses[0].statement).toBe('Cause is P.');
    expect(input.reply).toBe(draft);
  });

  test('a consistent draft or an implausibly short revision keeps the draft', async () => {
    expect(
      (await reviewAnswer(draft, state, { llm: llmReturning({ issues: [], revisedReply: '' }) }))
        .reply
    ).toBe(draft);
    const short = await reviewAnswer(draft, state, {
      llm: llmReturning({
        issues: [{ kind: 'off_task', excerpt: '', fix: '' }],
        revisedReply: 'P.',
      }),
    });
    expect(short).toMatchObject({ reply: draft, revised: false });
    const unknown = await reviewAnswer(draft, state, {
      llm: llmReturning({
        issues: [{ kind: 'style', excerpt: '', fix: '' }],
        revisedReply: draft + ' x',
      }),
    });
    expect(unknown).toMatchObject({ reply: draft, issues: [], revised: false });
  });
});

test('case-state calls send the provider schema grammar', async () => {
  const { reviewAnswer } = require('../src/case-state');
  const schemas = [];
  const llm = {
    generateStructured: async (schema) => {
      schemas.push(JSON.stringify(schema));
      return { issues: [], revisedReply: '' };
    },
  };
  await updateCaseState(createCaseState(), { message: 'x' }, { llm });
  await reviewAnswer('Entwurf.', createCaseState(), { llm });
  expect(schemas).toHaveLength(2);
  for (const schema of schemas) {
    expect(schema).not.toContain('additionalProperties');
    expect(schema).not.toContain('maxLength');
  }
});

describe('background reflection', () => {
  const { reflectCaseState, mergeReflection, takeAddendum } = require('../src/case-state');
  const base = () =>
    applyCaseUpdate(createCaseState(), {
      evidence: [report('n1', 'P fehlt vermutlich')],
      hypothesisUpdates: [
        { statement: 'Ursache P', status: 'open', evidenceRefs: ['n1'], reason: 'r' },
      ],
      nextActions: [
        {
          action: 'P prüfen',
          input: '',
          role: 'A',
          expectedResult: '',
          closureCriterion: '',
          kind: 'reversible_check',
        },
      ],
    });

  test('runs in the reflection phase; route fit and empty lists stay unchanged', async () => {
    const calls = [];
    const llm = {
      generateStructured: async (schema, prompt, options) => {
        calls.push({ schema: JSON.stringify(schema), input: JSON.parse(prompt), options });
        return {
          workIntent: null,
          routeFit: [{ candidateId: 'x', fit: 'fits', reason: '' }],
          evidence: [],
          claims: [],
          hypothesisUpdates: [
            {
              hypothesisId: 'H1',
              statement: 'Ursache P',
              status: 'supported',
              evidenceRefs: ['E1'],
              reason: 'tiefer geprüft',
            },
          ],
          crossEvidence: [],
          openQuestions: [],
          nextActions: [],
          closureCriteria: [],
          addendum: 'Die Vermutung P ist gestützt.',
        };
      },
    };
    const state = base();
    const reflection = await reflectCaseState(
      state,
      { recentTurns: [{ role: 'user', text: 'Hi' }] },
      { llm, tenantId: 't' }
    );
    expect(calls[0].options).toMatchObject({ phase: 'case_reflection', tenantId: 't' });
    expect(calls[0].schema).toContain('addendum');
    expect(calls[0].input.conversation).toEqual([{ role: 'user', text: 'Hi' }]);
    expect(reflection.delta).not.toHaveProperty('routeFit');
    expect(reflection.delta).not.toHaveProperty('nextActions');
    const merged = mergeReflection(state, reflection);
    expect(merged.hypotheses[0].status).toBe('supported');
    expect(merged.nextActions).toEqual(state.nextActions);
    expect(merged).toMatchObject({
      reflectedAtTurn: 1,
      pendingAddendum: 'Die Vermutung P ist gestützt.',
    });
  });

  test('a reflection finished after a later turn keeps that turn; the addendum is taken once', () => {
    const state = base();
    const later = applyCaseUpdate(state, {
      hypothesisUpdates: [
        { statement: 'Ursache Q', status: 'open', evidenceRefs: [], reason: 'neu' },
      ],
    });
    const merged = mergeReflection(later, {
      turn: 1,
      delta: {
        hypothesisUpdates: [
          {
            hypothesisId: 'H1',
            statement: 'Ursache P',
            status: 'refuted',
            evidenceRefs: ['E1'],
            reason: 'r',
          },
        ],
      },
      addendum: 'P scheidet aus.',
    });
    expect(merged.turn).toBe(2);
    // The reflection refutes H1; H2 from the later turn stays.
    expect(merged.hypotheses.map((h) => h.status)).toEqual(['refuted', 'open']);
    expect(merged.violations).toEqual([]);
    const first = takeAddendum(merged);
    expect(first.addendum).toBe('P scheidet aus.');
    expect(takeAddendum(first.state).addendum).toBe('');
    expect(mergeReflection(state, { turn: 0 })).toEqual(state);
  });
});
