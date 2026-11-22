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

test('a repeated hypothesis without id updates the existing one', () => {
  let state = applyCaseUpdate(createCaseState(), {
    hypothesisUpdates: [{ statement: 'Ursache Q', status: 'open', evidenceRefs: [], reason: 'r' }],
  });
  state = applyCaseUpdate(state, {
    evidence: [observed('n1', 'Quelle', 'Q belegt')],
    hypothesisUpdates: [
      { statement: 'ursache q', status: 'supported', evidenceRefs: ['n1'], reason: 'belegt' },
    ],
  });
  expect(state.hypotheses).toHaveLength(1);
  expect(state.hypotheses[0]).toMatchObject({ status: 'supported', evidenceIds: ['E1'] });
});

describe('review and addendum after the TWL long dialogue', () => {
  const {
    ADDENDUM_LABEL,
    takeAddendum,
    mergeReflection,
    applyCaseUpdate,
    createCaseState,
  } = require('../src/case-state');
  const empty = { evidence: [], claims: [], hypothesisUpdates: [] };

  test('an addendum is shown only with the answer right after the turn it reflects', () => {
    const turn1 = applyCaseUpdate(createCaseState(), empty);
    const merged = mergeReflection(turn1, { turn: 1, delta: {}, addendum: 'Q statt P.' });
    const turn2 = applyCaseUpdate(merged, empty);
    expect(takeAddendum(turn2).addendum).toBe('Q statt P.');
    const late = applyCaseUpdate(applyCaseUpdate(merged, empty), empty);
    const taken = takeAddendum(late);
    expect(taken.addendum).toBe('');
    expect(taken.state.pendingAddendum).toBe('');
    expect(ADDENDUM_LABEL).toMatch(/letzten Antwort/u);
  });

  test('the review names assumed authority and proposals presented as settled', async () => {
    const { reviewAnswer } = require('../src/case-state');
    const calls = [];
    const llm = {
      generateStructured: async (schema, input) => {
        calls.push({ schema: JSON.stringify(schema), input: JSON.parse(input) });
        return { issues: [], revisedReply: '' };
      },
    };
    await reviewAnswer('Antwort.', applyCaseUpdate(createCaseState(), empty), { llm });
    expect(calls[0].schema).toContain('invented_authority');
    expect(calls[0].schema).toContain('option_as_fact');
    expect(calls[0].input.instruction).toMatch(/funktion/iu);
  });
});

describe('case-work core: authority, decisions, withdrawn recommendations, limits, deliverable', () => {
  const { applyCaseUpdate, createCaseState, caseStateView } = require('../src/case-state');
  const report = (ref, content) => ({ ref, kind: 'user_reported', source: 'Gespräch', content });

  test('a responsibility without evidence stays a proposal or a needed function', () => {
    const state = applyCaseUpdate(createCaseState(), {
      evidence: [report('n1', 'Die Koordination übernimmt Bereich A.')],
      roleUpdates: [
        {
          function: 'Koordination',
          holder: 'Bereich A',
          status: 'confirmed',
          evidenceRefs: ['n1'],
        },
        {
          function: 'Fachliche Bewertung',
          holder: 'Bereich B',
          status: 'confirmed',
          evidenceRefs: [],
        },
        { function: 'Strukturhaltung', holder: '', status: 'accepted', evidenceRefs: [] },
      ],
    });
    expect(caseStateView(state).roles).toEqual([
      { function: 'Koordination', holder: 'Bereich A', status: 'confirmed', authoritative: true },
      {
        function: 'Fachliche Bewertung',
        holder: 'Bereich B',
        status: 'proposed',
        authoritative: false,
      },
      { function: 'Strukturhaltung', status: 'needed', authoritative: false },
    ]);
  });

  test('a decision is settled only with evidence', () => {
    const state = applyCaseUpdate(createCaseState(), {
      decisionUpdates: [{ statement: 'Pilot starten', status: 'taken', evidenceRefs: [] }],
    });
    expect(caseStateView(state).decisions).toEqual([
      { statement: 'Pilot starten', status: 'proposed', settled: false },
    ]);
  });

  test('recommendations resting on a refuted hypothesis are withdrawn', () => {
    let state = applyCaseUpdate(createCaseState(), {
      evidence: [report('n1', 'Erste Beobachtung.')],
      hypothesisUpdates: [
        { statement: 'Ursache P', status: 'open', evidenceRefs: ['n1'], reason: 'r' },
      ],
      claims: [
        {
          statement: 'Empfehlung X',
          basis: 'hypothesis',
          evidenceRefs: [],
          central: false,
          dependsOn: ['H1'],
        },
      ],
      nextActions: [
        { action: 'Schritt Y', kind: 'recommendation', dependsOn: ['H1'] },
        { action: 'Schritt Z', kind: 'reversible_check' },
      ],
    });
    expect(caseStateView(state).withdrawn).toEqual([]);
    state = applyCaseUpdate(state, {
      evidence: [report('n2', 'Gegenbeleg.')],
      hypothesisUpdates: [
        {
          hypothesisId: 'H1',
          statement: 'Ursache P',
          status: 'refuted',
          evidenceRefs: ['n2'],
          reason: 'Gegenbeleg',
        },
      ],
    });
    const view = caseStateView(state);
    expect(view.withdrawn.map((item) => item.statement)).toEqual(['Empfehlung X', 'Schritt Y']);
    expect(view.nextActions.map((item) => item.action)).toEqual(['Schritt Z']);
  });

  test('action limits and the expected deliverable persist across turns', () => {
    let state = applyCaseUpdate(createCaseState(), {
      boundaries: [
        { action: 'Bestand ändern', reason: 'Zielzustand offen', until: 'Zielzustand belegt' },
      ],
      deliverable: {
        requested: true,
        audience: 'Leitungsrunde',
        purpose: 'Befassung',
        format: 'Impuls',
        sections: ['Zielbild', 'Rollen'],
        doneWhen: 'ohne Verlauf verständlich',
      },
    });
    state = applyCaseUpdate(state, {
      deliverable: {
        requested: false,
        audience: '',
        purpose: '',
        format: '',
        sections: [],
        doneWhen: '',
      },
    });
    const view = caseStateView(state);
    expect(view.doNotAct).toEqual([
      { action: 'Bestand ändern', reason: 'Zielzustand offen', until: 'Zielzustand belegt' },
    ]);
    expect(view.deliverable).toMatchObject({
      audience: 'Leitungsrunde',
      sections: ['Zielbild', 'Rollen'],
    });
  });
});

describe('corrected values (LON-A long dialogue)', () => {
  const register = {
    ref: 'n1',
    kind: 'source_observed',
    source: 'Register',
    content: 'Versand am 14.03.',
  };
  const start = () =>
    applyCaseUpdate(createCaseState(), {
      evidence: [
        register,
        { ref: 'n2', kind: 'user_reported', source: 'Person', content: '13.03.' },
      ],
      crossEvidence: [
        {
          leftRef: 'n1',
          rightRef: 'n2',
          relation: 'outdated',
          difference: '14.03. gegen 13.03.',
          consequence: 'Suchfenster',
          clarification: '',
        },
        {
          leftRef: 'n1',
          rightRef: 'n2',
          relation: 'contradicts',
          difference: 'Lokation',
          consequence: 'Zuordnung',
          clarification: 'prüfen',
        },
      ],
      corrections: [
        {
          subject: 'Versanddatum des Zielvorgangs',
          value: '13.03.2026',
          replaces: '14.03.2026 laut Register',
          correctedBy: 'Ausgangsjournal nach Angabe der Person',
          evidenceRefs: ['n2'],
        },
      ],
    });

  test('the current value is listed with the replaced one; the decided difference leaves the comparison', () => {
    const view = caseStateView(start());
    expect(view.corrections).toEqual([
      {
        subject: 'Versanddatum des Zielvorgangs',
        value: '13.03.2026',
        replaces: '14.03.2026 laut Register',
        correctedBy: 'Ausgangsjournal nach Angabe der Person',
      },
    ]);
    expect(view.sourceComparison.map((row) => row.difference)).toEqual(['Lokation']);
  });

  test('a later correction of the same subject replaces the earlier one; empty entries are ignored', () => {
    const state = applyCaseUpdate(start(), {
      corrections: [
        { subject: 'versanddatum des zielvorgangs', value: '12.03.2026', replaces: '13.03.2026' },
        { subject: '', value: 'x' },
        { subject: 'Lokation', value: '' },
      ],
    });
    expect(caseStateView(state).corrections.map((row) => [row.subject, row.value])).toEqual([
      ['versanddatum des zielvorgangs', '12.03.2026'],
    ]);
    expect(state.corrections[0].evidenceIds).toEqual([]);
    expect(start().corrections[0].evidenceIds).toEqual(['E2']);
  });

  test('answer rules and the review know corrections and values without origin', () => {
    const { CASE_VIEW_RULES } = require('../src/case-state');
    expect(CASE_VIEW_RULES.join(' ')).toMatch(/corrections gelten/u);
    expect(CASE_VIEW_RULES.join(' ')).toMatch(/noch festzulegen/u);
  });
});

test('the case review receives the evidence with its content, bounded', async () => {
  const { reviewAnswer } = require('../src/case-state');
  const state = applyCaseUpdate(createCaseState(), {
    evidence: [observed('n1', 'Archiv', `Transportquittung LOC-SYN-8327 ${'x'.repeat(3000)}`)],
  });
  const llm = { generateStructured: jest.fn(async () => ({ issues: [], revisedReply: '' })) };
  await reviewAnswer('Die Quittung betrifft LOC-SYN-8327.', state, { llm });
  const prompt = JSON.parse(llm.generateStructured.mock.calls[0][1]);
  expect(prompt.evidence[0]).toMatchObject({ id: 'E1', kind: 'source_observed', source: 'Archiv' });
  expect(prompt.evidence[0].content).toContain('LOC-SYN-8327');
  expect(prompt.evidence[0].content.length).toBeLessThanOrEqual(1200);
  expect(prompt.instruction).toMatch(/Angaben, die dort stehen/u);
});

test('a reading variant is no correction; open checks stay; negative searches stay bounded', async () => {
  const { CASE_VIEW_RULES } = require('../src/case-state');
  const llm = {
    generateStructured: jest.fn(async () => ({})),
  };
  await updateCaseState(createCaseState(), { message: 'x' }, { llm });
  const instruction = JSON.parse(llm.generateStructured.mock.calls[0][1]).instruction;
  // LON-A: an OCR reading became the "valid" value and replaced the original reference.
  expect(instruction).toMatch(/OCR-Ergebnis, eine Schreibvariante.*ist nie eine Korrektur/u);
  expect(instruction).toMatch(/Noch nicht erledigte Prüfungen aus caseState/u);
  const rules = CASE_VIEW_RULES.join(' ');
  expect(rules).toMatch(/ergebnisloser Suchlauf belegt das Fehlen nur/u);
  expect(rules).toMatch(/Ähnliche Kennungen, Referenzen oder Treffer sind Vergleichsmaterial/u);
});

describe('identifier ledger (DEV-UAT-001)', () => {
  const id = (observedValue, relationToTarget, extra = {}) => ({
    entity: 'Vorgang',
    observedValue,
    provenance: 'Quelle',
    evidenceRefs: [],
    relationToTarget,
    valueForm: 'as_seen',
    ...extra,
  });
  const byValue = (state) =>
    Object.fromEntries(
      caseStateView(state).identifiers.map((item) => [
        item.value,
        [item.status, item.usableForDecision],
      ])
    );

  test('only the target and confirmed members are usable; a matching source is only observed', () => {
    const state = applyCaseUpdate(createCaseState(), {
      evidence: [
        observed('n1', 'Archiv', 'ACK-1 LOC-A; DOC-1 LOC-B'),
        report('n2', 'Der Beleg DOC-2 gehört zum Zielvorgang.'),
      ],
      identifierUpdates: [
        id('REQ-1', 'target'),
        id('DOC-1', 'belongs_to_target', { evidenceRefs: ['n1'], matchBasis: 'Referenz' }),
        id('DOC-2', 'belongs_to_target', { evidenceRefs: ['n2'], matchBasis: 'Bestätigung' }),
        id('DOC-3', 'belongs_to_target', { evidenceRefs: ['n2'] }),
        id('ANS-9', 'other_object', { evidenceRefs: ['n1'] }),
        id('X-1', 'unclear'),
      ],
    });
    expect(byValue(state)).toEqual({
      'REQ-1': ['target', true],
      'DOC-1': ['observed', false],
      'DOC-2': ['verified', true],
      'DOC-3': ['candidate', false],
      'ANS-9': ['foreign', false],
      'X-1': ['observed', false],
    });
  });

  test('a recognized value stays a candidate and never merges into the target', () => {
    let state = applyCaseUpdate(createCaseState(), {
      identifierUpdates: [id('REQ-2403', 'target')],
    });
    const target = state.identifiers[0].id;
    state = applyCaseUpdate(state, {
      evidence: [report('n1', 'OCR las REQ-24O3.')],
      identifierUpdates: [
        id('REQ-24O3', 'target', {
          identifierId: target,
          normalizedCandidate: 'REQ-2403',
          evidenceRefs: ['n1'],
        }),
      ],
    });
    expect(byValue(state)).toEqual({
      'REQ-2403': ['target', true],
      'REQ-24O3': ['candidate', false],
    });
    const ocr = state.identifiers.find((item) => item.observedValue === 'REQ-24O3');
    state = applyCaseUpdate(state, {
      evidence: [report('n2', 'Bestätigt.')],
      identifierUpdates: [
        id('REQ-24O3', 'belongs_to_target', {
          identifierId: ocr.id,
          evidenceRefs: ['n2'],
          matchBasis: 'Bestätigung',
        }),
      ],
    });
    expect(byValue(state)['REQ-24O3']).toEqual(['candidate', false]);
    expect(state.violations.some((row) => row.rule === 'candidate_promoted')).toBe(true);
  });

  test('a foreign identifier returns only with new evidence; history is kept', () => {
    let state = applyCaseUpdate(createCaseState(), {
      evidence: [report('n1', 'Beleg gehört zu 018.')],
      identifierUpdates: [id('DOC-1', 'other_object', { evidenceRefs: ['n1'] })],
    });
    const doc = state.identifiers[0].id;
    state = applyCaseUpdate(state, {
      identifierUpdates: [id('DOC-1', 'unclear', { identifierId: doc })],
    });
    expect(byValue(state)['DOC-1']).toEqual(['foreign', false]);
    expect(state.violations.at(-1)).toMatchObject({ rule: 'reactivation_without_new_evidence' });
    expect(state.identifiers[0].history.map((row) => row.to)).toEqual(['foreign']);
  });

  test('answer rules and the review know the ledger', () => {
    const { CASE_VIEW_RULES } = require('../src/case-state');
    expect(CASE_VIEW_RULES.join(' ')).toMatch(/nur auf Kennungen mit usableForDecision/u);
  });
});

describe('recommendation ledger (DEV-UAT-002)', () => {
  const step = (action, extra = {}) => ({
    action,
    input: '',
    role: '',
    expectedResult: '',
    closureCriterion: '',
    kind: 'recommendation',
    ...extra,
  });

  test('steps get stable ids; one left out stays active until it is closed with a reason', () => {
    let state = applyCaseUpdate(createCaseState(), {
      nextActions: [step('Beleg an 017 hängen'), step('Postfach prüfen')],
    });
    expect(caseStateView(state).recommendations.active.map((item) => item.id)).toEqual([
      'R1',
      'R2',
    ]);
    state = applyCaseUpdate(state, { nextActions: [step('Postfach prüfen')] });
    expect(caseStateView(state).recommendations.active.map((item) => item.id)).toEqual([
      'R1',
      'R2',
    ]);
    state = applyCaseUpdate(state, {
      nextActions: [step('Postfach prüfen')],
      recommendationUpdates: [
        { recommendationId: 'R1', status: 'withdrawn', reason: 'Beleg gehört zu 018' },
        { recommendationId: 'R1', status: 'active', reason: 'erneut' },
      ],
    });
    const view = caseStateView(state);
    expect(view.recommendations.active.map((item) => item.id)).toEqual(['R2']);
    expect(view.recommendations.retracted).toEqual([
      expect.objectContaining({
        id: 'R1',
        status: 'withdrawn',
        retractedAtTurn: 3,
        reason: 'Beleg gehört zu 018',
      }),
    ]);
    // A withdrawn recommendation does not come back, neither by update nor by a repeated step.
    state = applyCaseUpdate(state, {
      nextActions: [step('Beleg an 017 hängen')],
      recommendationUpdates: [{ recommendationId: 'R1', status: 'active', reason: 'x' }],
    });
    expect(state.recommendations.find((item) => item.id === 'R1').status).toBe('withdrawn');
    expect(caseStateView(state).recommendations.active.map((item) => item.action)).toEqual([
      'Postfach prüfen',
    ]);
    // Task register: the active recommendation stays an active task although the update left it
    // out; the withdrawn one does not come back as a task either.
    expect(caseStateView(state).nextActions.map((item) => item.action)).toEqual([
      'Postfach prüfen',
    ]);
    expect(state.violations).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ rule: 'retracted_recommendation_repeated', id: 'R1' }),
        expect.objectContaining({ rule: 'silent_task_drop' }),
      ])
    );
  });

  test('a recommendation resting on a dropped hypothesis is withdrawn with the reason', () => {
    let state = applyCaseUpdate(createCaseState(), {
      evidence: [report('n1', 'Scan nennt 017.')],
      hypothesisUpdates: [
        { statement: 'Scan gehört zu 017', status: 'open', evidenceRefs: ['n1'], reason: '' },
      ],
    });
    state = applyCaseUpdate(state, {
      nextActions: [step('Scan an 017 hängen', { dependsOn: ['H1'] })],
    });
    state = applyCaseUpdate(state, {
      evidence: [report('n2', 'Scan gehört zu 018.')],
      hypothesisUpdates: [
        {
          hypothesisId: 'H1',
          statement: 'Scan gehört zu 017',
          status: 'refuted',
          evidenceRefs: ['n2'],
          reason: 'Fachbereich',
        },
      ],
    });
    expect(caseStateView(state).recommendations.retracted).toEqual([
      expect.objectContaining({ id: 'R1', status: 'withdrawn', reason: 'Grundlage entfallen: H1' }),
    ]);
  });
});

describe('authority gate (DEV-UAT-003)', () => {
  const { authorityGate } = require('../src/case-state');
  const state = applyCaseUpdate(createCaseState(), {
    evidence: [report('n1', 'Ich leite die Netzwirtschaft.')],
    roleUpdates: [
      {
        function: 'Leitung Netzwirtschaft',
        holder: 'Person',
        status: 'confirmed',
        evidenceRefs: ['n1'],
      },
    ],
  });
  const reply =
    'Die Steuerungsrunde gibt frei.\n\nDu leitest die Netzwirtschaft.\n\nAls Option eine Koordination.';
  const llm = (statements, revisedReply) => ({
    generateStructured: jest
      .fn()
      .mockResolvedValueOnce({ statements })
      .mockResolvedValueOnce({ revisedReply }),
  });

  test('only asserted statements without backing are rewritten', async () => {
    const client = llm(
      [
        {
          excerpt: 'Die Steuerungsrunde gibt frei.',
          subject: 'gate',
          presentedAs: 'binding',
          backing: '',
        },
        {
          excerpt: 'Du leitest die Netzwirtschaft.',
          subject: 'role',
          presentedAs: 'assigned',
          backing: 'P1',
        },
        {
          excerpt: 'Du leitest die Netzwirtschaft.',
          subject: 'role',
          presentedAs: 'existing',
          backing: 'E1',
        },
        {
          excerpt: 'Als Option eine Koordination.',
          subject: 'role',
          presentedAs: 'option',
          backing: '',
        },
      ],
      'Als Option könnte eine Steuerungsrunde freigeben.\n\nDu leitest die Netzwirtschaft.\n\nAls Option eine Koordination.'
    );
    const result = await authorityGate(reply, state, { llm: client });
    expect(result.unbacked).toEqual([
      { excerpt: 'Die Steuerungsrunde gibt frei.', subject: 'gate' },
      { excerpt: 'Du leitest die Netzwirtschaft.', subject: 'role' },
    ]);
    expect(result.revised).toBe(true);
    const rewrite = JSON.parse(client.generateStructured.mock.calls[1][1]);
    expect(rewrite.passages).toEqual([
      'Die Steuerungsrunde gibt frei.',
      'Du leitest die Netzwirtschaft.',
    ]);
  });

  test('a confirmed role or evidence backs a statement; nothing is rewritten then', async () => {
    const roleId = state.roles[0].id;
    const client = llm(
      [
        {
          excerpt: 'Du leitest die Netzwirtschaft.',
          subject: 'role',
          presentedAs: 'assigned',
          backing: roleId,
        },
      ],
      'x'
    );
    const result = await authorityGate(reply, state, { llm: client });
    expect(result).toMatchObject({ unbacked: [], revised: false, reply });
    expect(client.generateStructured).toHaveBeenCalledTimes(1);
  });

  test('an implausibly short rewrite keeps the draft', async () => {
    const client = llm(
      [
        {
          excerpt: 'Die Steuerungsrunde gibt frei.',
          subject: 'body',
          presentedAs: 'existing',
          backing: '',
        },
      ],
      'kurz'
    );
    const result = await authorityGate(reply, state, { llm: client });
    expect(result).toMatchObject({ revised: false, reply });
  });
});

describe('verification task and execution status (DEV-UAT-004/005)', () => {
  test('a step carries the verification fields; it is never executed through the case update', () => {
    const state = applyCaseUpdate(createCaseState(), {
      nextActions: [
        {
          action: 'Beleg gegen Register abgleichen',
          input: 'DOC-1, REQ-1',
          role: 'Marktkommunikationsprüfung',
          expectedResult: 'Zuordnung',
          closureCriterion: 'Ergebnis liegt vor',
          kind: 'reversible_check',
          searchSpace: 'Dokumentenpostfach',
          period: '13.03.–18.03.',
          method: 'exakte Suche und OCR-Variante',
          returnFormat:
            'Suchraum – Suchwert – Zeitraum – Ergebnis – Belegreferenz – Restunsicherheit',
          stopCondition: 'kein Treffer: Prüfauftrag an Fachbereich',
          allowedFollowUps: 'Dokumentation des Ergebnisses',
          blockedFollowUps: 'Statusänderung, Abschluss',
          controlDate: 'festzulegen durch Fallkoordination',
          executionStatus: 'executed_with_evidence',
        },
        {
          action: 'Wiedervorlage einrichten',
          kind: 'recommendation',
          executionStatus: 'requested_by_person',
        },
      ],
    });
    const [check, followUp] = caseStateView(state).nextActions;
    expect(check).toMatchObject({
      searchSpace: 'Dokumentenpostfach',
      returnFormat: 'Suchraum – Suchwert – Zeitraum – Ergebnis – Belegreferenz – Restunsicherheit',
      blockedFollowUps: 'Statusänderung, Abschluss',
      controlDate: 'festzulegen durch Fallkoordination',
      executionStatus: 'proposed',
    });
    expect(followUp.executionStatus).toBe('requested_by_person');
  });

  test('answer rules require executable tasks and proposals for follow-ups without proof', () => {
    const { CASE_VIEW_RULES } = require('../src/case-state');
    const rules = CASE_VIEW_RULES.join(' ');
    expect(rules).toMatch(
      /Rückgabeformat \(Fundstelle, Übereinstimmung, Restunsicherheit, Belegstatus\)/u
    );
    expect(rules).toMatch(/Kontrolltermin: festzulegen durch die zuständige Funktion/u);
  });
});
