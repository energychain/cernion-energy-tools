'use strict';

jest.mock('../src/llm-client', () => ({
  generateStructured: jest.fn(),
  generateText: jest.fn(),
  generateChat: jest.fn(),
}));
const Ajv = require('ajv');
const llm = require('../src/llm-client');
const { createCaseBroker } = require('./helpers/case-linking-broker');
const { readTurn, saveTurn } = require('../src/workbench-conversation');
const { generatePracticeCatalog } = require('../scripts/generate-practice-evaluation-fixtures');
const { checkTurn } = require('../scripts/practice-evaluation-checks');
const { SITUATION_SCHEMA } = require('../src/workbench-understanding');
const { applyRoleContext, selectRoleStatement } = require('../src/workbench-role-context');
const scenario = generatePracticeCatalog().scenarios.find((item) => item.id === 'role-onboarding');
const messages = scenario.turns.map((turn) => turn.message);
const question = {
  key: 'user-task-scope',
  kind: 'role',
  question: 'Welche Rolle übernimmst du im Vorhaben?',
  reason: 'decisive',
  decisive: true,
  blocking: false,
  answered: false,
};
const emptyRole = {
  subject: 'none',
  firstPerson: false,
  answersQuestionKey: '',
  basis: '',
  role: '',
  mandate: '',
  goal: '',
  roleOnly: false,
};
const roleFor = (message) => {
  if (message === messages[1])
    return {
      ...emptyRole,
      subject: 'self',
      firstPerson: true,
      answersQuestionKey: question.key,
      basis: message,
      role: 'Aufsicht',
      mandate: 'Gremium A',
      goal: 'Risiken für das Ergebnis vermeiden',
      roleOnly: true,
    };
  if (message === messages[3])
    return {
      ...emptyRole,
      subject: 'self',
      firstPerson: true,
      basis: message,
      role: 'Dokumentation',
      mandate: 'Team A',
      goal: 'vollständige Belegübersicht',
      roleOnly: true,
    };
  if (message === messages[5]) return { ...emptyRole, subject: 'other_person' };
  return emptyRole;
};
const personFor = (message, misclassified) => ({
  applicable: message === messages[5] || (misclassified && roleFor(message).subject === 'self'),
  observations: [],
  hypotheses: message === messages[5] ? [message] : [],
  basis: message,
});
const situationFor = (message, misclassified) => ({
  concern: 'Einarbeitung',
  situation: 'Interner Situationstext darf nie ausgegeben werden.',
  participants: [],
  identifiers: [],
  deadlines: [],
  hypotheses: [],
  retrievalTerms: ['Arbeitsstand'],
  missingInformation: message === messages[0] ? [question] : [],
  requestedAction: { description: '', externalEffect: false, draftRequested: false },
  turnKind: 'knowledge',
  conversationShape: 'knowledge',
  codeReferences: [],
  roleStatement: roleFor(message),
  personAssessment: personFor(message, misclassified),
});
const claim = (text) => ({
  text,
  questionTarget: text.includes('?') ? 'other' : 'none',
  origin: 'model',
  supported: 'model',
  specific: false,
  completedAction: false,
  evidenceIds: [],
});
const validate = (schema, result) => {
  const validator = new Ajv({ strict: false }).compile(schema);
  if (!validator(result)) throw new Error(JSON.stringify(validator.errors));
  return result;
};

function complete(schema, value) {
  if (schema.type === 'object')
    return Object.fromEntries(
      Object.entries(schema.properties).map(([key, child]) => [key, complete(child, value?.[key])])
    );
  if (schema.type === 'array') return (value || []).map((item) => complete(schema.items, item));
  if (value !== undefined) return value;
  if (schema.enum) return schema.enum[0];
  if (schema.type === 'boolean') return false;
  if (['integer', 'number'].includes(schema.type)) return schema.minimum || 0;
  return '';
}

function installModel({ misclassified = true, missingPrimary = false } = {}) {
  const failures = [];
  llm.generateStructured.mockImplementation(async (schema, raw) => {
    const input = JSON.parse(raw);
    const message = input.currentUserMessage || input.message || '';
    let result;
    if (schema.properties?.requestedAction && schema.properties?.concern) {
      result = situationFor(message, misclassified);
      if (missingPrimary) result.roleStatement = emptyRole;
    } else if (input.currentUserMessage) {
      result = {
        basis: '',
        register: 'unchanged',
        concise: 'unchanged',
        questions: 'unchanged',
        wording: [],
        forbiddenTerms: [],
        preferenceOnly: false,
        roleStatement: roleFor(message),
        personAssessment: personFor(message, misclassified),
      };
    } else if (input.task === 'output_contract') {
      result = {
        requestedOutput: {
          requested: 'ordinary_answer',
          basis: '',
          kind: 'other',
          parts: [],
          constraints: [],
          forbiddenTerms: [],
          subjects: [],
        },
      };
    } else if (input.task === 'token_roles') {
      result = {
        tokens: input.candidates.map(({ index }) => ({
          index,
          category: 'other',
          family: '',
          meaningRequested: false,
        })),
      };
    } else if (input.task === 'turn_controls') {
      result = {
        missingInformation: message === messages[0] ? [question] : [],
        turnKind: 'knowledge_or_orientation',
        conversationShape: 'knowledge',
        personAssessment: personFor(message, misclassified),
      };
    } else {
      failures.push(input.task || Object.keys(input).join(','));
      throw new Error('Unexpected structured call');
    }
    try {
      result = complete(schema, result);
      if (schema.properties?.concern) {
        const local = structuredClone(result);
        local.requestedOutput.requested = false;
        validate(SITUATION_SCHEMA, local);
      }
      return validate(schema, result);
    } catch (error) {
      failures.push(error.message);
      throw error;
    }
  });
  llm.generateText.mockImplementation(async (raw, options) => {
    const input = JSON.parse(raw);
    const context = input.situation?.conversationContext;
    if (input.message === messages[2] || input.message === messages[4]) {
      expect(context?.role).toBe(input.message === messages[2] ? 'Aufsicht' : 'Dokumentation');
      expect(input.communicationInstruction || input.instruction).toContain('Arbeitskontext');
      expect(input.communicationInstruction || input.instruction).toContain('Fundstellen');
      expect(input.evidence.some((hit) => hit.value.includes('80 Einheiten'))).toBe(true);
    }
    const text =
      input.message === messages[2]
        ? 'Frage für das Gremium: Wie wird die Abweichung zwischen 80 und 95 Einheiten geklärt (Arbeitsstand-A, Abschnitt A/B)? Offen bleibt die Verantwortung für den Abgleich (Abschnitt C).'
        : input.message === messages[4]
          ? 'Für die Dokumentation ist die Belegübersicht aus Abschnitt A, B und C relevant.'
          : 'Für die Einarbeitung brauche ich deinen Aufgabenschwerpunkt.';
    const paragraph = claim(text);
    if ([messages[2], messages[4]].includes(input.message)) {
      paragraph.origin = 'evidence';
      paragraph.supported = 'evidence';
      paragraph.evidenceIds = [input.evidence[0].evidenceId];
    }
    const result = {
      interpretation: [paragraph],
      expectation: [],
      nextSteps: [],
      assumptions: [],
      draft: [],
    };
    const completed = complete(options.responseSchema, result);
    validate(options.responseSchema, completed);
    return JSON.stringify(completed);
  });
  return failures;
}

beforeEach(() => jest.resetAllMocks());

test.each([
  { misclassified: true, missingPrimary: false },
  { misclassified: true, missingPrimary: true, expired: true },
  { misclassified: false, missingPrimary: false },
])(
  'full turn: role answer, follow-up, correction and third-party protection (%j)',
  async (variant) => {
    const app = await createCaseBroker();
    const failures = installModel(variant);
    const evidenceRequests = [];
    await app.broker.destroyService(app.broker.getLocalService('personal-agent'));
    app.broker.createService({
      name: 'personal-agent',
      actions: {
        collectWorkbenchEvidence: (ctx) => {
          evidenceRequests.push(ctx.meta);
          return {
            evidence: [
              {
                evidenceId: 'e1',
                source: 'knowledge-rag',
                retrievalSource: 'knowledge-rag',
                value: scenario.turns[0].document.text,
                metadata: {
                  score: 1,
                  tenantId: 'tenant-a',
                  title: 'Arbeitsstand-A',
                  sectionId: 'Abschnitt A/B/C',
                },
              },
            ],
            trace: [],
          };
        },
        chat: () => ({ reply: 'Allgemeine Einordnung' }),
      },
    });
    const p = { tenantId: 'tenant-a', actorId: 'actor-a', roles: ['ROLE_ALPHA'], clearance: [] };
    const envelope = { channel: 'api', conversationId: 'role-onboarding' };
    const chat = (userRequest) => app.call('workbench.chat', { ...envelope, userRequest });
    try {
      await app.broker.start();
      const profile = await app.workbench.store.saveUserContext({
        ...p,
        roleFamilies: ['ROLE_ALPHA'],
        domainsAllowed: ['allowed-area'],
        sensitivityClearance: ['internal'],
      });
      if (variant.expired) {
        const existing = await app.create([], undefined, {
          knownContext: {
            identifiers: [],
            situation: {
              ...situationFor(messages[0], false),
              conversationContext: {
                role: 'Frühere Rolle',
                goal: '',
                preference: '',
                basis: '',
                durable: false,
              },
            },
          },
        });
        await app.workbench.store.linkConversation({
          tenantId: p.tenantId,
          client: envelope.channel,
          conversationId: envelope.conversationId,
          cetCaseId: existing.cetCaseId,
          caseStateVersion: existing.caseStateVersion,
        });
      }
      const initial = await chat(messages[0]);
      expect(failures).toEqual([]);
      expect(initial.responseText).toContain(question.question);
      let pending = await readTurn(app.workbench.conversationsDb, p, envelope);
      expect(pending.askedQuestions).toContainEqual(question);
      const own = await chat(messages[1]);
      expect(own.responseText).toContain('Ich richte mich');
      expect(own.responseText).not.toMatch(/Beobachtung|Personendeutung|Interner Situationstext/);
      pending = await readTurn(app.workbench.conversationsDb, p, envelope);
      expect(pending.situation.conversationContext).toMatchObject({
        role: 'Aufsicht',
        mandate: 'Gremium A',
        goal: 'Risiken für das Ergebnis vermeiden',
      });
      expect(pending.situation.missingInformation).toContainEqual({ ...question, answered: true });
      expect(pending.askedQuestions).toContainEqual({ ...question, answered: true });
      validate(
        SITUATION_SCHEMA.properties.conversationContext,
        pending.situation.conversationContext
      );
      if (variant.expired) {
        const current = await app.workbench.conversationsDb.get(pending._id);
        await app.workbench.conversationsDb.put({ ...current, expiresAt: 0 });
      }
      const followup = await chat(messages[2]);
      expect(followup.responseText).toContain('80');
      expect(checkTurn(scenario.turns[2], followup).filter((entry) => !entry.passed)).toEqual([]);
      expect(followup.responseText).not.toContain('Interner Situationstext');
      expect((await chat(messages[3])).responseText).toContain('Dokumentation');
      expect((await chat(messages[4])).responseText).toContain('Belegübersicht');
      pending = await readTurn(app.workbench.conversationsDb, p, envelope);
      expect(pending.situation.conversationContext.role).toBe('Dokumentation');
      const third = await chat(messages[5]);
      expect(third.responseText).toContain('### Hypothese');
      expect(third.responseText).toContain('Nutzerhypothese, nicht erwiesen');
      expect(third.responseText).not.toContain('Ich richte mich');
      expect(await app.workbench.store.getUserContext(p)).toEqual(profile);
      expect(await app.router.visibleStates(p)).toHaveLength(variant.expired ? 1 : 0);
      expect(failures).toEqual([]);
      expect(evidenceRequests.length).toBeGreaterThan(0);
      for (const meta of evidenceRequests) expect(meta.apiToken.roles).toEqual(['ROLE_ALPHA']);
      // The role belongs to this actor and chat, not to other conversations.
      expect(
        await readTurn(app.workbench.conversationsDb, p, { ...envelope, conversationId: 'other' })
      ).toBeNull();
      expect(
        await readTurn(app.workbench.conversationsDb, { ...p, actorId: 'actor-b' }, envelope)
      ).toBeNull();
      expect(
        await readTurn(app.workbench.conversationsDb, { ...p, tenantId: 'tenant-b' }, envelope)
      ).toBeNull();
    } finally {
      await app.cleanup();
    }
  }
);

test.each(['other_person', 'mixed'])(
  'an open role question never clears %s protection',
  (subject) => {
    const situation = situationFor(messages[1], true);
    situation.roleStatement = { ...roleFor(messages[1]), subject };
    applyRoleContext(situation, messages[1], null, [question]);
    expect(situation.personAssessment.applicable).toBe(true);
    expect(situation.conversationContext).toBeUndefined();
    expect(selectRoleStatement(roleFor(messages[1]), situation.roleStatement).subject).toBe(
      subject
    );
  }
);

test.each(['open', 'closed', 'wrong-key', 'wrong-kind', 'unproven'])(
  'elliptical self statement requires an open typed question (%s)',
  (variant) => {
    const message = 'Aufsicht im Gremium A';
    const situation = situationFor(message, false);
    situation.roleStatement = {
      ...emptyRole,
      subject: 'self',
      basis: message,
      role: 'Aufsicht',
      mandate: 'Gremium A',
      answersQuestionKey: variant === 'wrong-key' ? 'other-key' : question.key,
    };
    if (variant === 'unproven') situation.roleStatement.role = 'Nicht im Text';
    applyRoleContext(situation, message, null, [
      {
        ...question,
        answered: variant === 'closed',
        kind: variant === 'wrong-kind' ? 'other' : 'role',
      },
    ]);
    expect(Boolean(situation.roleContextUpdated)).toBe(variant === 'open');
  }
);

test('working context survives expiry and remains scoped to the conversation', async () => {
  const app = await createCaseBroker();
  const p = { tenantId: 'tenant-a', actorId: 'actor-a' };
  const envelope = { channel: 'api', conversationId: 'expiry' };
  try {
    await app.broker.start();
    const situation = situationFor(messages[1], true);
    applyRoleContext(situation, messages[1], null, [question]);
    await saveTurn(app.workbench.conversationsDb, p, envelope, { situation }, 1);
    const expired = await readTurn(app.workbench.conversationsDb, p, envelope);
    expect(expired.situation).toBeNull();
    expect(expired.conversationContext.role).toBe('Aufsicht');
    await saveTurn(app.workbench.conversationsDb, p, envelope, { lastAnswer: 'Neue Antwort' });
    expect(
      (await readTurn(app.workbench.conversationsDb, p, envelope)).conversationContext.role
    ).toBe('Aufsicht');
  } finally {
    await app.cleanup();
  }
});

test.each(['none', 'user', 'other'])(
  'prepared questions for others survive while user questions stay in clarification (%s)',
  (questionTarget) => {
    const { filterAnswer } = require('../src/workbench-answer-filter');
    const parsed = { interpretation: [{ ...claim('Welche Belege fehlen?'), questionTarget }] };
    filterAnswer(parsed, {
      evidence: [],
      answerEvidence: [],
      unresolved: [],
      message: 'Bereite die Befassung vor.',
      counts: new Map(),
      normalizeCondition: (value) => value,
    });
    expect(parsed.interpretation).toHaveLength(questionTarget === 'other' ? 1 : 0);
  }
);

test('a prepared question cannot expose internal situation text', () => {
  const { filterAnswer } = require('../src/workbench-answer-filter');
  const internal = 'Der Nutzer möchte verstehen, welche Rolle für seine Befassung maßgeblich ist.';
  const parsed = { interpretation: [{ ...claim(internal), questionTarget: 'other' }] };
  filterAnswer(parsed, {
    evidence: [],
    answerEvidence: [],
    unresolved: [],
    message: 'Bereite die Befassung vor.',
    internalContext: [internal],
    counts: new Map(),
    normalizeCondition: (value) => value,
  });
  expect(parsed.interpretation).toEqual([]);
});
