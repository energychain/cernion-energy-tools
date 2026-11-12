'use strict';
// Final evidence boundary of the content turn (#1137): Knowledge-Loop and Conversation-Core
// material passes the scope and cross-case gate before the answer, and the stored turn keeps
// none of it. synthetic_tenant_seed fixtures; SENTINEL marks content that must not be stored.
jest.mock('../src/workbench-case-state', () => require('./helpers/workbench-case-state-stub'));
jest.mock('../src/llm-client', () => ({ generateText: jest.fn(), generateStructured: jest.fn() }));
jest.mock('../src/project-manifest-evidence', () => ({
  ...jest.requireActual('../src/project-manifest-evidence'),
  projectManifestAnswer: jest.fn(),
}));
const llm = require('../src/llm-client');
const manifest = require('../src/project-manifest-evidence');
const { createCaseBroker } = require('./helpers/case-linking-broker');

const situation = (extra = {}) => ({
  concern: 'Prüfreihenfolge klären.',
  situation: 'Die anfragende Rolle benötigt den nächsten Schritt.',
  participants: [],
  identifiers: [],
  deadlines: [],
  hypotheses: [],
  missingInformation: [],
  requestedAction: {
    description: 'Nächsten Schritt klären.',
    draftRequested: false,
    externalEffect: false,
  },
  turnKind: 'work',
  retrievalTerms: [],
  ...extra,
});
const PLANNED = 'SENTINEL-PLANNED-QUERY';
const ownHit = {
  source: 'SENTINEL-TITLE Prozessbeschreibung',
  value: 'ADMITTED-LOOP-FACT: Rückmeldungen werden getrennt geprüft.',
  metadata: { sourceId: 'SENTINEL-SOURCE-ID' },
};
const foreignHit = (value) => ({
  source: 'Protokoll',
  value,
  metadata: {
    sourceId: 'SENTINEL-FOREIGN-SOURCE',
    documentRefs: [{ conversationId: 'SENTINEL-FOREIGN-CONV', caseId: 'SENTINEL-FOREIGN-CASE' }],
  },
});

let answerPrompts;
let lookups;
function mockModels({ understood = situation(), gate = { items: [] } } = {}) {
  answerPrompts = [];
  llm.generateStructured.mockImplementation(async (_schema, _prompt, options = {}) => {
    if (options.phase === 'knowledge_loop')
      return llm.generateStructured.mock.calls.filter(([, , o]) => o?.phase === 'knowledge_loop')
        .length === 1
        ? {
            enough: false,
            lookups: [
              { source: 'knowledge-gateway', query: PLANNED, purpose: 'Regel' },
              { source: 'knowledge-rag', query: `${PLANNED}-2`, purpose: 'Frist' },
            ],
          }
        : { enough: true, lookups: [] };
    if (options.phase === 'context_gate') return gate;
    if (options.phase === 'turn_action') return { action: 'content' };
    return structuredClone(understood);
  });
  llm.generateText.mockImplementation(async (prompt) => {
    answerPrompts.push(String(prompt));
    return JSON.stringify({
      expectation: [],
      draft: [],
      nextSteps: [
        {
          text: `Prüfe zuerst die Zuständigkeit (SENTINEL-MODEL-OUTPUT ${PLANNED}).`,
          condition: '',
          supported: 'model',
          evidenceIds: [],
          specific: false,
          completedAction: false,
        },
      ],
    });
  });
}

async function turn(loopHits, { message = 'Wie gehe ich bei der Rückmeldung vor?' } = {}) {
  lookups = [];
  const app = await createCaseBroker({
    personalAgentActions: {
      collectWorkbenchEvidence(ctx) {
        // Only the loop's planned lookups ask with the planned query as concern.
        const sources = ctx.meta.workbenchEvidenceSources;
        if (!String(ctx.params.situation?.concern || '').startsWith(PLANNED))
          return { evidence: [], trace: [] };
        lookups.push(sources[0]);
        if (sources[0] === 'knowledge-rag')
          throw new Error(`SENTINEL-LOOKUP-ERROR ${PLANNED}-2 SENTINEL-FOREIGN-CASE`);
        return { evidence: loopHits, trace: [{ source: sources[0], called: true }] };
      },
    },
  });
  const logged = [];
  try {
    await app.broker.start();
    for (const level of ['info', 'warn', 'debug'])
      jest.spyOn(app.workbench.logger, level).mockImplementation((...args) => logged.push(args));
    const result = await app.call('workbench.chat', {
      message,
      channel: 'open-webui',
      conversationId: 'conv-own',
    });
    const stored = (await app.workbench.conversationsDb.allDocs({ include_docs: true })).rows.find(
      (row) => row.doc.type === 'workbench_conversation_assistance'
    ).doc;
    const answerLog = logged.find(([text]) => text === 'Workbench answer evidence')?.[1];
    return { result, stored, answerLog, logged };
  } finally {
    await app.cleanup();
  }
}

const answerInput = () => answerPrompts.join('\n');

beforeEach(() => {
  manifest.projectManifestAnswer.mockImplementation(
    jest.requireActual('../src/project-manifest-evidence').projectManifestAnswer
  );
});
afterEach(() => {
  delete process.env.WORKBENCH_KNOWLEDGE_LOOP;
  delete process.env.WORKBENCH_CONVERSATION_CORE;
  jest.resetAllMocks();
});

test('loop off: the stored turn keeps the answer and retrieval as before', async () => {
  mockModels();
  const { stored } = await turn([ownHit]);
  expect(lookups).toEqual([]);
  expect(stored.lastAnswer).toContain('Zuständigkeit');
  expect(stored.retrieval).toBeDefined();
  expect(stored.retrieval).not.toHaveProperty('knowledgeLoop');
});

test('loop hits pass the final gate; the stored turn and logs keep no loop content', async () => {
  process.env.WORKBENCH_KNOWLEDGE_LOOP = 'all';
  mockModels({ gate: { items: [{ index: 0, decision: 'unrelated', lesson: '' }] } });
  const { stored, answerLog, logged } = await turn([
    ownHit,
    foreignHit('SENTINEL-FOREIGN-HIT anderer Vorgang mit Rückmeldung.'),
  ]);
  expect(lookups.sort()).toEqual(['knowledge-gateway', 'knowledge-rag']);
  // Admitted own material reaches the answer; the unrelated foreign hit does not.
  expect(answerInput()).toContain('ADMITTED-LOOP-FACT');
  expect(answerInput()).not.toContain('SENTINEL-FOREIGN-HIT');
  expect(answerInput()).not.toContain('SENTINEL-LOOKUP-ERROR');
  const doc = JSON.stringify(stored);
  expect(doc).not.toMatch(/SENTINEL|ADMITTED-LOOP-FACT/);
  expect(stored.lastAnswer).toBe('');
  expect(stored.retrieval).not.toHaveProperty('knowledgeLoop');
  // The answer-evidence log carries bounded counts of the final set only.
  expect(answerLog.knowledgeLoop).toEqual({
    policyVersion: 'final-evidence-gate-1',
    judgement: 'partial',
    attemptedCount: 2,
    admittedCount: 1,
    withheldCount: 1,
    failedCount: 1,
    sourceClasses: ['knowledge-gateway', 'knowledge-rag'],
  });
  expect(answerLog.counts['knowledge-loop:plain']).toBe(1);
  expect(JSON.stringify(answerLog)).not.toMatch(/SENTINEL|ADMITTED/);
  expect(JSON.stringify(logged)).not.toMatch(/SENTINEL-(LOOKUP-ERROR|FOREIGN|SOURCE|TITLE)/);
});

test('a lesson repeating a foreign name pair reaches neither answer nor stored turn (#1138)', async () => {
  process.env.WORKBENCH_KNOWLEDGE_LOOP = 'all';
  mockModels({
    understood: situation({ contextScope: 'tenant' }),
    gate: {
      items: [
        { index: 0, decision: 'pattern', lesson: 'Wie bei Spur Kormoran zuerst nachfragen.' },
      ],
    },
  });
  const { stored } = await turn([foreignHit('Im Vorgang Spur Kormoran fehlte die Rückmeldung.')]);
  expect(answerInput()).not.toContain('Kormoran');
  // Nothing of the loop was admitted, so the stored answer may stay; the lesson is not in it.
  expect(JSON.stringify(stored)).not.toMatch(/Kormoran|SENTINEL-FOREIGN/);
});

test('a generic lesson may reach the answer as experience; its origin is not stored', async () => {
  process.env.WORKBENCH_KNOWLEDGE_LOOP = 'all';
  mockModels({
    understood: situation({ contextScope: 'tenant' }),
    gate: {
      items: [
        { index: 0, decision: 'pattern', lesson: 'GENERIC-LESSON Erst Zuständigkeit klären.' },
      ],
    },
  });
  const { stored } = await turn([foreignHit('SENTINEL-FOREIGN-HIT Rückmeldung blieb aus.')]);
  expect(answerInput()).toContain('GENERIC-LESSON');
  expect(answerInput()).not.toContain('SENTINEL-FOREIGN-HIT');
  expect(JSON.stringify(stored)).not.toMatch(/SENTINEL|GENERIC-LESSON/);
});

describe('conversation core', () => {
  const coreRows = [
    { source: 'Akte', value: 'CORE-OWN-SENTINEL eigener Bestand', metadata: { projectId: 'p-1' } },
    {
      source: 'Sitzung',
      value: 'CORE-FOREIGN-SENTINEL fremder Bestand',
      metadata: { projectId: 'SENTINEL-PROJECT', otherConversation: true },
    },
  ];
  beforeEach(() => {
    process.env.WORKBENCH_CONVERSATION_CORE = 'all';
  });

  test.each([
    ['unrelated', false],
    ['linked', true],
  ])(
    '%s foreign core material is gated once; no core material is stored',
    async (decision, kept) => {
      manifest.projectManifestAnswer.mockResolvedValue({ evidence: coreRows });
      mockModels({
        understood: situation({ contextScope: 'tenant' }),
        gate: { items: [{ index: 0, decision, lesson: '' }] },
      });
      const { stored } = await turn([]);
      expect(manifest.projectManifestAnswer).toHaveBeenCalledTimes(1);
      expect(answerInput()).toContain('CORE-OWN-SENTINEL');
      expect(answerInput().includes('CORE-FOREIGN-SENTINEL')).toBe(kept);
      expect(
        llm.generateStructured.mock.calls.filter(([, , o]) => o?.phase === 'context_gate')
      ).toHaveLength(1);
      expect(JSON.stringify(stored.retrieval)).not.toMatch(/SENTINEL/);
    }
  );

  test('a failing stored-material read leaves the turn answering without it', async () => {
    manifest.projectManifestAnswer.mockRejectedValue(new Error('SENTINEL-CORE-DOWN'));
    mockModels({ understood: situation({ contextScope: 'tenant' }) });
    const { stored } = await turn([]);
    expect(stored.lastAnswer).toContain('Zuständigkeit');
    expect(JSON.stringify(stored)).not.toMatch(/SENTINEL-CORE/);
  });

  test('core and loop together: both producers stay out of the stored turn', async () => {
    process.env.WORKBENCH_KNOWLEDGE_LOOP = 'all';
    manifest.projectManifestAnswer.mockResolvedValue({ evidence: [coreRows[0]] });
    mockModels({ understood: situation({ contextScope: 'tenant' }) });
    const { stored } = await turn([ownHit]);
    expect(answerInput()).toContain('CORE-OWN-SENTINEL');
    expect(answerInput()).toContain('ADMITTED-LOOP-FACT');
    expect(JSON.stringify(stored)).not.toMatch(/SENTINEL|ADMITTED-LOOP-FACT/);
  });
});
