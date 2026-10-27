'use strict';

jest.mock('../src/llm-client', () => ({
  generateStructured: jest.fn(),
  generateText: jest.fn(),
  generateChat: jest.fn(),
  embeddings: jest.fn(async (texts) => texts.map(() => [1, 0])),
  capabilities: jest.fn(() => ({ embeddings: true })),
}));
const { installRealCaseStub } = require('./helpers/real-case-stub');
const { instantiatePracticeScenario } = require('../scripts/generate-practice-evaluation-fixtures');
const { createLocalTransport } = require('../scripts/practice-evaluation-transport');
const { checkTurn } = require('../scripts/practice-evaluation-checks');
const { readTurn, saveTurn } = require('../src/workbench-conversation');
const originalEnv = { ...process.env };
let transport, app, controls;

beforeAll(async () => {
  controls = installRealCaseStub();
  const budget = require('../scripts/live-validation-budget').installLiveBudget({ limit: 1000 });
  const harness = require('../scripts/workbench-live-harness');
  const create = harness.createLiveHarness;
  const spy = jest.spyOn(harness, 'createLiveHarness').mockImplementation((...args) => {
    app = create(...args);
    for (const service of app.broker.services) {
      service.settings.tenantEvidenceEnrichment = { delayMs: 2 ** 31 - 1 };
      service.settings.projectSkillLearning = { delayMs: 2 ** 31 - 1 };
    }
    return app;
  });
  try {
    transport = await createLocalTransport({ budget });
  } finally {
    spy.mockRestore();
  }
});
afterAll(async () => {
  await transport?.close();
  process.env = originalEnv;
});

function memoryArgs(run, chat = 'main') {
  return [
    { tenantId: run.tenantId, actorId: run.actors[0].actorId },
    { channel: 'api', conversationId: `practice-${run.prefix}-a-${chat}` },
  ];
}

async function replay(id, { staleContext = false } = {}) {
  const fixture = instantiatePracticeScenario(id);
  const run = await transport.startRun(fixture);
  if (staleContext)
    await saveTurn(app.workbench.conversationsDb, ...memoryArgs(run), {
      conversationContext: {
        role: 'Ich',
        goal: 'in das Thema einarbeiten',
        mandate: '',
        basis: 'Ich soll mich in das Thema einarbeiten.',
        durable: false,
      },
    });
  const replies = [],
    failures = [];
  for (const turn of fixture.turns) {
    controls.turn = turn.id;
    const reply = await transport.send(run, turn);
    replies.push(reply);
    failures.push(
      ...checkTurn(turn, reply, {})
        .filter((check) => !check.passed)
        .map((check) => ({ turn: turn.id, text: reply.responseText, ...check }))
    );
  }
  const inputs = controls.inputs;
  controls.inputs = [];
  expect(controls.errors).toEqual([]);
  expect(failures).toEqual([]);
  return { replies, run, inputs };
}

test('RC3 task statements with observed pronoun and sentence roles never set context', async () => {
  const { run } = await replay('task-without-role');
  for (const chat of ['main', 'fresh'])
    expect(
      (await readTurn(app.workbench.conversationsDb, ...memoryArgs(run, chat)))?.conversationContext
        ?.role
    ).toBeFalsy();
});
test.each([false, true])(
  'RC3 real role precedes function correction (prior context %s)',
  async (staleContext) => {
    const { run } = await replay('role-before-correction', { staleContext });
    expect(
      (await readTurn(app.workbench.conversationsDb, ...memoryArgs(run))).conversationContext.role
    ).toBe('Governance/Aufsicht');
    for (const { schema, task } of controls.schemas) {
      if (task === 'working_context_fields')
        expect(JSON.stringify(schema)).not.toMatch(/additionalProperties|uniqueItems|const|\$ref/u);
    }
  }
);
test('RC3 content follow-up receives evidence in its own context, never a case overview', async () => {
  const { replies, inputs } = await replay('content-before-status');
  expect(
    inputs.some(
      (input) =>
        input.sections?.length &&
        input.question?.startsWith('Die nächste Befassung') &&
        input.conversationContext?.role === 'Aufsicht'
    )
  ).toBe(true);
  expect(replies[2].cetCaseId).toBe(replies[1].cetCaseId);
  expect(replies[2].cetCaseId).not.toBe(replies[0].cetCaseId);
});
test('RC3 table reference joins this chat with the existing record from an earlier chat', async () => {
  const { replies, inputs } = await replay('table-record-reference');
  const reference = inputs.find(
    (input) =>
      input.task === 'evidence_reference_resolution' && input.question.startsWith('Deckt sich')
  );
  expect(reference.previousQuestion).toContain('Projekt Nord');
  expect(reference.currentSources).toHaveLength(2);
  expect(replies.at(-1).tenantEvidenceSelection).toHaveLength(2);
  expect(replies.at(-1).evidence.some((hit) => hit.source === 'dataset.query')).toBe(true);
  expect(replies.at(-1).evidence.some((hit) => hit.source === 'knowledge-rag.documentGet')).toBe(
    true
  );
});

test('RC3 table reference also works without a previous shared source selection', async () => {
  const catalog = require('../src/evidence-endpoint-catalog');
  const original = catalog.projectEvidenceCandidates;
  const catalogStub = jest
    .spyOn(catalog, 'projectEvidenceCandidates')
    .mockImplementation((...args) =>
      controls.turn === 'table' ? Promise.resolve([]) : original(...args)
    );
  try {
    const { replies, inputs } = await replay('table-record-reference');
    expect(replies[1].tenantEvidenceSelection).toBeUndefined();
    expect(replies[1].responseText).toContain('Anzahl: 3 Zeilen');
    const resolution = inputs.find(
      (input) =>
        input.task === 'evidence_reference_resolution' && input.question.startsWith('Deckt sich')
    );
    expect(resolution.previousSourceIds).toEqual([]);
    expect(resolution.previousQuestion).toContain('Projekt Nord');
    expect(resolution.currentSources).toHaveLength(2);
    expect(replies[2].tenantEvidenceSelection).toHaveLength(2);
  } finally {
    catalogStub.mockRestore();
  }
});

test.each([
  'Ich',
  'mich',
  'mir',
  'wir',
  'uns',
  'I',
  'me',
  'Ich soll mich in das Thema einarbeiten.',
])('speaker or full-sentence role %s cannot become working context', (role) => {
  const basis = 'Ich soll mich in das Thema einarbeiten.';
  const situation = {
    roleStatement: {
      subject: 'self',
      firstPerson: true,
      basis,
      role,
      mandate: '',
      goal: 'in das Thema einarbeiten',
      roleOnly: false,
    },
  };
  require('../src/workbench-role-context').applyRoleContext(situation, basis, null);
  expect(situation.roleContextUpdated).toBeUndefined();
});

test('a substantive mandate can set context without a role, while a goal alone cannot', () => {
  const { applyRoleContext, roleConfirmation } = require('../src/workbench-role-context');
  const basis = 'Ich prüfe die Vollständigkeit für Team A und will offene Punkte klären.';
  for (const mandate of ['', 'Vollständigkeit für Team A']) {
    const situation = {
      roleStatement: {
        subject: 'self',
        firstPerson: true,
        basis,
        role: '',
        mandate,
        goal: 'offene Punkte klären',
        roleOnly: true,
      },
    };
    applyRoleContext(situation, basis, null);
    expect(situation.roleContextUpdated === true).toBe(Boolean(mandate));
    expect(roleConfirmation(situation, basis).includes('Auftrag')).toBe(Boolean(mandate));
  }
});

// Live model variants of the same task sentence (observed fragments, anonymized).
test.each([
  ['mich in das Thema', '', 'einarbeiten'],
  ['', 'in das Thema einarbeiten', 'einen aktuellen Status'],
  ['Ich', '', 'in das Thema einarbeiten'],
])(
  'a task sentence never becomes a working context (role %p, mandate %p)',
  (role, mandate, goal) => {
    const { applyRoleContext } = require('../src/workbench-role-context');
    const basis =
      'Ich soll mich in das Thema einarbeiten. Kannst Du mir einen aktuellen Status geben?';
    const situation = {
      roleStatement: {
        subject: 'self',
        firstPerson: true,
        basis,
        role,
        mandate,
        goal,
        roleOnly: false,
      },
    };
    applyRoleContext(situation, basis, null);
    expect(situation.roleContextUpdated).toBeUndefined();
    expect(situation.conversationContext).toBeUndefined();
  }
);

test.each([
  ['neu im Team', false],
  ['zuständig für Netzservice', true],
  ['Teamleitung Netzservice', true],
])('a trait is no role, a function or responsibility is (%p)', (role, kept) => {
  const { applyRoleContext } = require('../src/workbench-role-context');
  const basis = `Ich bin ${role}.`;
  const situation = {
    roleStatement: { subject: 'self', firstPerson: true, basis, role, mandate: '', goal: '' },
  };
  applyRoleContext(situation, basis, null);
  expect(situation.conversationContext?.role || '').toBe(kept ? role : '');
});
