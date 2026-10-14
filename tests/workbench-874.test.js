'use strict';

jest.mock('../src/llm-client', () => ({
  generateStructured: jest.fn(),
  generateText: jest.fn(),
  generateChat: jest.fn(),
}));
const path = require('node:path');
const llm = require('../src/llm-client');
const { generateCommunicationFixture } = require('../scripts/generate-workbench-874-fixtures');
const {
  answer,
  understand,
  questionsFor,
  SITUATION_SCHEMA,
} = require('../src/workbench-understanding');
const { mergePreferences, validateCommunication } = require('../src/workbench-communication');
const { reviewDisclosure } = require('../src/workbench-disclosure-review');
const { resolveCodes } = require('../src/workbench-codes');
const { citedSource } = require('../src/workbench-code-sources');
const { buildTurnMemory, safeTurnMemory } = require('../src/workbench-turn-memory');
const { renderCaseMemory } = require('../src/workbench-case-search');
const { createCaseBroker, auth } = require('./helpers/case-linking-broker');
const fixture = generateCommunicationFixture();
beforeEach(() => jest.clearAllMocks());

test('all nine acceptance scenarios are generated and included in the practice gate', () => {
  expect(fixture.scenarios).toHaveLength(9);
  expect(fixture.scenarios.map((item) => item.id)).toEqual(
    Array.from({ length: 9 }, (_, i) => `communication-${i + 1}`)
  );
  expect(
    require('../scripts/practice-evaluation-checks').auditPracticeFixtures({
      schemaVersion: '1.0',
      scenarios: fixture.scenarios,
    })
  ).toEqual([]);
});

test.each([0, 1])(
  'scenarios 1/2: every unsupported code stays explicitly unproven (%i)',
  async (index) => {
    const turn = fixture.scenarios[index].turns[0];
    const references = turn.expect.rules.codes.map((value) => ({
      value,
      family: 'Prüfcode',
      basis: turn.message,
    }));
    const ctx = { meta: {}, call: jest.fn().mockResolvedValue({ results: [] }) };
    const resolved = await resolveCodes(ctx, { identifiers: [], codeReferences: references }, {});
    const result = await answer({
      situation: fixture.situation(turn.message, {
        codeReferences: references,
        codeMeaningQuestion: true,
        codeResolutions: resolved.resolutions,
      }),
      message: turn.message,
      tenantId: fixture.tenantId,
      retrieval: { evidence: resolved.evidence },
    });
    for (const code of references)
      expect(result.responseText).toContain(`Bedeutung von ${code.value} nicht belegt`);
    expect(result.responseText).not.toMatch(/typischerweise/u);
    expect(llm.generateText).not.toHaveBeenCalled();
  }
);

test('A.1: meanings retain exact quoted source and location; unrelated families and undocumented hits fail closed', async () => {
  const { code, source, differentCode, differentFamily } = fixture.codeSourceFixture;
  expect(citedSource(source, code)).toEqual(expect.objectContaining(source));
  expect(citedSource({ ...source, sectionId: '' }, code)).toBeNull();
  expect(citedSource({ ...source, excerpt: differentCode }, code)).toBeNull();
  expect(citedSource({ ...source, excerpt: differentFamily }, code)).toBeNull();
  const ctx = {
    meta: {},
    call: jest.fn(async (action) =>
      action === 'knowledge-rag.query' ? { results: [source] } : { data: { sources: [] } }
    ),
  };
  const result = await resolveCodes(
    ctx,
    { identifiers: [], codeReferences: [{ ...code, basis: code.value }] },
    {}
  );
  expect(result.resolutions[0].status).toBe('resolved');
  expect(result.evidence[0]).toMatchObject({
    source: 'knowledge-rag',
    metadata: { sectionId: source.sectionId },
  });
});

test('A.2: source access permissions remain binding', async () => {
  const ctx = { meta: {}, call: jest.fn() };
  const result = await resolveCodes(
    ctx,
    { identifiers: [], codeReferences: [fixture.codeSourceFixture.code] },
    { 'willi-mako': false, 'knowledge-rag': false, 'knowledge-rag-federated': false }
  );
  expect(ctx.call).not.toHaveBeenCalled();
  expect(result.resolutions[0].status).toBe('unresolved');
});

test('scenario 3: literal glossary definition persists, is usable in another chat, is audited and redacted on deletion', async () => {
  const app = await createCaseBroker();
  for (const name of ['object-store', 'tenant-memory-policy']) {
    const schema = require(`../services/${name}.service`);
    app.broker.createService({
      ...schema,
      settings: { ...schema.settings, dbPath: path.join(app.dir, name) },
    });
  }
  const meta = auth(fixture.actorId, ['ROLE_ALPHA', 'ROLE_TENANT_ADMIN'], fixture.tenantId);
  const p = {
    tenantId: fixture.tenantId,
    actorId: fixture.actorId,
    roles: meta.apiToken.roles,
    clearance: [],
  };
  const ctx = {
    broker: app.broker,
    meta,
    params: {},
    call: (name, params, options) =>
      app.broker.call(name, params, { ...options, meta: { ...meta, ...options?.meta } }),
  };
  const message = fixture.scenarios[2].turns[0].message;
  const assertion = {
    text: message,
    basis: message,
    glossary: fixture.glossary,
    scope: 'organization',
    commitment: 'assessment',
    anchors: [{ value: fixture.term, qualifier: '', aliases: [] }],
    time: {},
    expiresAt: '',
  };
  try {
    await app.broker.start();
    const saved = await require('../src/tenant-memory').capture(ctx, p, {
      situation: fixture.situation(message, {
        turnKind: 'work',
        tenantMemory: { assertions: [assertion] },
      }),
      envelope: { userRequest: message, conversationId: 'synthetic-glossary', channel: 'api' },
    });
    expect(saved.ids).toHaveLength(1);
    const found = await require('../src/workbench-tenant-glossary').loadTenantGlossary(
      ctx,
      p,
      fixture.scenarios[2].turns[1].message,
      meta
    );
    expect(found[0]).toMatchObject(fixture.glossary);
    const listed = await app.broker.call('tenant-memory-policy.glossary', {}, { meta });
    expect(listed.statements[0]).toMatchObject({
      statementKind: 'glossary',
      glossary: fixture.glossary,
    });
    await app.broker.call(
      'tenant-memory-policy.delete',
      { id: saved.ids[0], reason: 'Synthetische Bereinigung' },
      { meta }
    );
    expect(
      await require('../src/workbench-tenant-glossary').loadTenantGlossary(
        ctx,
        p,
        fixture.term,
        meta
      )
    ).toEqual([]);
    expect(
      (await app.broker.call('tenant-memory-policy.list', {}, { meta })).statements[0].glossary
    ).toBeUndefined();
    await expect(
      app.broker.call(
        'tenant-memory-policy.glossary',
        {},
        { meta: auth(fixture.actorId, ['ROLE_ALPHA'], fixture.tenantId) }
      )
    ).rejects.toMatchObject({ code: 403 });
  } finally {
    await app.cleanup();
  }
});

test('scenario 4: separate disclosure pass replaces external internals while preserving internal analysis', async () => {
  const parsed = {
    interpretation: [fixture.claim('Intern: System A und Lieferant B prüfen.')],
    draft: [
      fixture.claim(
        'Guten Tag Lieferant A,\nSystem A wird mit Lieferant B geprüft.\nMit freundlichen Grüßen'
      ),
    ],
  };
  const situation = fixture.situation('', {
    disclosure: {
      external: true,
      recipient: 'Lieferant A',
      restricted: ['System A', 'Lieferant B'],
    },
  });
  llm.generateStructured.mockResolvedValue({
    paragraphs: [
      {
        index: 0,
        safe: false,
        replacement:
          'Guten Tag Lieferant A,\nDie Zuordnung ist in Klärung mit beteiligten Stellen.\nMit freundlichen Grüßen',
        reason: 'Nicht erforderliche Interna',
      },
    ],
  });
  await reviewDisclosure(parsed, situation, { tenantId: fixture.tenantId });
  expect(parsed.interpretation[0].text).toContain('Lieferant B');
  expect(parsed.draft[0].text).not.toMatch(/Lieferant B|System A/u);
  expect(llm.generateStructured).toHaveBeenCalledTimes(1);
});

test('C.1: incomplete or contaminated review never releases the draft', async () => {
  llm.generateStructured.mockResolvedValue({ paragraphs: [] });
  await expect(
    reviewDisclosure(
      { draft: [fixture.claim('Interner Gegenstand')] },
      fixture.situation('', { disclosure: { external: true, recipient: '', restricted: [] } }),
      { tenantId: fixture.tenantId }
    )
  ).rejects.toThrow();
});

test('scenario 5: persistent register and wording apply to later turns and stored case memory', async () => {
  const message = 'Keine Beschlusssprache, bitte Sie.';
  const preferences = mergePreferences(
    {},
    {
      basis: message,
      register: 'Sie',
      concise: 'yes',
      questions: 'unchanged',
      wording: ['Befassung'],
      forbiddenTerms: ['Beschluss'],
    },
    message
  );
  const retained = mergePreferences(
    preferences,
    { basis: '', register: 'unchanged', wording: [], forbiddenTerms: [] },
    'Fassung'
  );
  expect(retained).toEqual(preferences);
  expect(() =>
    validateCommunication(
      { interpretation: [fixture.claim('Beschlussvorschlag')] },
      { conversationPreferences: retained },
      []
    )
  ).toThrow();
  const memory = buildTurnMemory({
    principal: { roles: ['ROLE_ALPHA'] },
    envelope: { knownContext: { situation: { conversationPreferences: retained } } },
  });
  expect(safeTurnMemory(memory).conversationPreferences.register).toBe('Sie');
  llm.generateText.mockResolvedValue(
    JSON.stringify({
      interpretation: [fixture.claim('Für Sie bleibt die Befassung offen.')],
      nextSteps: [],
      expectation: [],
    })
  );
  const result = await answer({
    situation: fixture.situation('Fassung', { conversationPreferences: retained }),
    message: 'Fassung',
    tenantId: fixture.tenantId,
    retrieval: { evidence: [] },
  });
  expect(result.responseText).toContain('Für Sie');
});

test('scenario 6: explicit request enables up to three relevant questions; usual mode remains at one', () => {
  const missingInformation = ['Ziel', 'Beteiligte', 'Frist', 'Unterlagen'].map((value) => ({
    key: value,
    question: `Welche ${value} fehlen?`,
    reason: 'ambiguity',
    blocking: false,
  }));
  const situation = fixture.situation('', {
    conversationShape: 'task',
    missingInformation,
    conversationPreferences: { questions: 'requested' },
  });
  expect(questionsFor(situation)).toHaveLength(3);
  expect(
    questionsFor(situation, [{ key: 'Ziel', question: missingInformation[0].question }])[0].key
  ).toBe('Beteiligte');
  expect(
    questionsFor({ ...situation, conversationShape: 'knowledge', conversationPreferences: {} })
  ).toHaveLength(1);
});

test('scenario 7: unconfirmed proposal does not write; confirmation creates linked case with work fields and search projection', async () => {
  const app = await createCaseBroker();
  const { confirmLinkedCase } = require('../src/workbench-linked-proposal');
  const meta = auth();
  const p = { tenantId: 'tenant-a', actorId: 'actor-a', roles: ['ROLE_ALPHA'], clearance: [] };
  const envelope = {
    userRequest: 'Noch nicht anlegen',
    channel: 'api',
    conversationId: 'synthetic-linked',
  };
  const ctx = { call: (name, params) => app.call(name, params, meta) };
  try {
    await app.broker.start();
    const parent = await app.create([]);
    const pending = { linkedCaseProposal: { ...fixture.proposal, parentCaseId: parent.cetCaseId } };
    expect(await confirmLinkedCase(app.workbench, ctx, { p, envelope, pending, meta })).toBeNull();
    expect(await app.router.visibleStates(p)).toHaveLength(1);
    const result = await confirmLinkedCase(app.workbench, ctx, {
      p,
      envelope: { ...envelope, userRequest: 'Leg an' },
      pending,
      meta,
    });
    expect(result.state).toBe('linked_case_created');
    const repeated = await confirmLinkedCase(app.workbench, ctx, {
      p,
      envelope: { ...envelope, userRequest: 'Leg an' },
      pending,
      meta,
    });
    expect(repeated.responseText).toContain('kein verbundener Vorgangsvorschlag');
    expect(await app.router.visibleStates(p)).toHaveLength(2);
    const child = await app.router.loadCase(p, result.cetCaseId);
    expect(child.parentCaseId).toBe(parent.cetCaseId);
    expect(child.caseWork.ownerRole).toBe(fixture.proposal.ownerRole);
    expect((await app.router.loadCase(p, parent.cetCaseId)).relatedCases).toContainEqual({
      cetCaseId: child.cetCaseId,
      relationshipType: 'related_topic',
    });
    const rendered = renderCaseMemory(
      { memory: { caseWork: child.caseWork }, topic: child.caseDescription },
      'F-874'
    );
    for (const value of Object.values(child.caseWork)) expect(rendered).toContain(value);
    await expect(
      app.call('domain-router.createLinkedConfirmed', {
        parentCaseId: parent.cetCaseId,
        confirmed: false,
        proposal: pending.linkedCaseProposal,
        conversationId: envelope.conversationId,
      })
    ).rejects.toMatchObject({ code: 403 });
    await expect(
      app.call(
        'domain-router.createLinkedConfirmed',
        {
          parentCaseId: parent.cetCaseId,
          confirmed: true,
          proposal: pending.linkedCaseProposal,
          conversationId: envelope.conversationId,
        },
        auth('actor-a', ['ROLE_ALPHA'], 'tenant-b')
      )
    ).rejects.toMatchObject({ status: 404 });
  } finally {
    await app.cleanup();
  }
});

test('scenario 8: person hypotheses never become case assumptions; extraction remains literal', async () => {
  const message = fixture.scenarios[7].turns[0].message;
  const result = fixture.situation(message, {
    personAssessment: {
      applicable: true,
      basis: message,
      observations: ['wir steuern das'],
      hypotheses: ['Ich vermute eine informelle Geschäftsführung ohne Auftrag.'],
    },
    caseMemory: {
      applicable: true,
      topic: 'Prüfauftrag',
      status: '',
      openPoints: [],
      assumptions: ['Motivbehauptung'],
      risks: [],
      nextSteps: [],
      resolvedItems: [],
    },
  });
  llm.generateStructured.mockResolvedValue(result);
  const understood = await understand({ message, tenantId: fixture.tenantId });
  expect(understood.caseMemory.assumptions).toEqual([]);
  expect(understood.personAssessment.hypotheses).toHaveLength(1);
  expect(SITUATION_SCHEMA.properties.personAssessment.additionalProperties).toBe(false);
});

test('scenario 9: regulatory assertions without actual cited knowledge remain explicitly assumptions', async () => {
  const message = fixture.scenarios[8].turns[0].message;
  llm.generateText.mockResolvedValue(
    JSON.stringify({
      interpretation: [
        fixture.claim('Ein Anspruch wäre anhand des geltenden Regelwerks zu prüfen.'),
      ],
      expectation: [],
      nextSteps: [],
    })
  );
  const result = await answer({
    situation: fixture.situation(message, { regulatoryQuestion: true }),
    message,
    tenantId: fixture.tenantId,
    retrieval: { evidence: [] },
  });
  expect(result.responseText).toContain('Zu prüfende Annahme');
  expect(result.responseText).toContain('ohne belegte Fundstelle');
});

test('table rows from separate claims remain one valid Markdown table', () => {
  const { renderArtifact } = require('../src/workbench-artifact');
  const row = (text, specific = false) => ({
    ...fixture.claim(text),
    origin: specific ? 'model' : 'input',
    specific,
  });
  const output = renderArtifact([
    {
      title: 'Übersicht',
      content: [
        row('| Gegenstand | Owner |'),
        row('| --- | --- |'),
        row('| SYN-A | Rolle A |', true),
        row('| SYN-B | Rolle B |'),
        row('Die Angaben sind Vorschläge.'),
      ],
    },
  ]);
  expect(output).toContain(
    '| Gegenstand | Owner |\n| --- | --- |\n| SYN-A | Rolle A |\n| SYN-B | Rolle B |'
  );
  expect(output).toContain('| SYN-B | Rolle B |\n\n(bitte gegenprüfen)');
});

test('current code contract does not re-query retained code identifiers from earlier turns', async () => {
  const ctx = { meta: {}, call: jest.fn() };
  const stale = fixture.scenarios[0].turns[0].expect.rules.codes[0];
  const result = await resolveCodes(
    ctx,
    {
      identifiers: [{ kind: 'product_code', value: stale }],
      codeReferences: [],
    },
    {}
  );
  expect(result.resolutions).toEqual([]);
  expect(ctx.call).not.toHaveBeenCalled();
});

test('explicit artifact wins over a stale code-meaning flag', async () => {
  const {
    artifactReply,
    fixtureSituation,
    generateAcceptanceFixture,
  } = require('../scripts/generate-workbench-873-fixtures');
  const f = generateAcceptanceFixture('communication874');
  const scenario = f.scenarios[0];
  const situation = {
    ...fixtureSituation(f, scenario),
    codeMeaningQuestion: true,
    codeReferences: [{ value: fixture.scenarios[0].turns[0].expect.rules.codes[0] }],
  };
  llm.generateText.mockResolvedValue(JSON.stringify(artifactReply(f, scenario)));
  const result = await answer({
    situation,
    message: scenario.message,
    tenantId: f.tenantId,
    retrieval: { evidence: [] },
  });
  expect(result.artifact).toHaveLength(situation.requestedOutput.parts.length);
  expect(result.answerStatus).not.toBe('fallback');
});

test('normative uncertainty stays outside Markdown table cells and separators', () => {
  const { renderArtifact } = require('../src/workbench-artifact');
  const parts = [
    {
      title: 'Übersicht',
      content: [
        fixture.claim('| Gegenstand | Owner |'),
        fixture.claim('| --- | --- |'),
        fixture.claim('| SYN-A | Rolle A |'),
      ],
    },
  ];
  validateCommunication({ artifact: parts }, { regulatoryQuestion: true }, []);
  const output = renderArtifact(parts);
  expect(output).toContain('| Gegenstand | Owner |\n| --- | --- |\n| SYN-A | Rolle A |');
  expect(output).toContain('| SYN-A | Rolle A |\n\nZu prüfende Annahme');
});

test('external recipient is rendered from the confirmed output contract after disclosure', () => {
  const { renderArtifact } = require('../src/workbench-artifact');
  const output = renderArtifact(
    [
      {
        title: 'Rückmeldung',
        content: [
          fixture.claim(
            'Guten Tag,\n\nBitte den offenen Sachstand klären.\n\nMit freundlichen Grüßen'
          ),
        ],
      },
    ],
    { kind: 'correspondence', parts: [{ audience: 'external', recipient: fixture.meaning }] }
  );
  expect(output).toContain(`An: ${fixture.meaning}`);
});

test('positive wording cannot reintroduce an explicitly excluded word stem', () => {
  const message = fixture.scenarios[4].turns[3].message;
  const result = mergePreferences(
    {},
    {
      basis: message,
      register: 'unchanged',
      concise: 'unchanged',
      questions: 'unchanged',
      wording: ['Beschlusssprache', 'Befassung'],
      forbiddenTerms: ['Beschluss'],
    },
    message
  );
  expect(result.wording).toEqual(['Befassung']);
});

test('terminal punctuation shares the same reversible code reference across contexts', () => {
  const { opaqueContext, restoreContext } = require('../src/workbench-identifier-context');
  const turn = fixture.scenarios[0].turns[0];
  const codes = turn.expect.rules.codes;
  const result = opaqueContext({ message: turn.message, candidates: codes });
  for (const placeholder of result.value.candidates)
    expect(result.value.message).toContain(placeholder);
  expect(restoreContext(result.value, result.reidentMap)).toEqual({
    message: turn.message,
    candidates: codes,
  });
  const compound = opaqueContext({ message: fixture.compoundReference });
  expect([...compound.reidentMap.values()]).not.toEqual(
    expect.arrayContaining(['12345', '67890', 'ref12345'])
  );
  expect(compound.value.message).not.toContain('example.invalid');
  expect(compound.value.message).toContain('12345.67890');
});

test('explicit question mode is retained when the next message has no new preference', async () => {
  const { extractConversationPreferences } = require('../src/workbench-preference-extraction');
  const mode = fixture.scenarios[5].turns[0].message;
  const problem = fixture.scenarios[5].turns[1].message;
  llm.generateStructured.mockResolvedValueOnce({
    basis: mode,
    register: 'unchanged',
    concise: 'unchanged',
    questions: 'ask_when_needed',
    wording: [],
    forbiddenTerms: [],
    preferenceOnly: true,
  });
  const first = await extractConversationPreferences(mode, { timeoutMs: 1000 });
  expect(first.questions).toBe('requested');
  llm.generateStructured.mockResolvedValueOnce({
    basis: '',
    register: 'unchanged',
    concise: 'unchanged',
    questions: 'unchanged',
    wording: [],
    forbiddenTerms: [],
    preferenceOnly: false,
  });
  const second = await extractConversationPreferences(problem, { timeoutMs: 1000 });
  const remembered = mergePreferences(mergePreferences({}, first, mode), second, problem);
  expect(remembered.questions).toBe('requested');
  expect(second.preferenceOnly).toBe(false);
});

test('past internal artifact subjects remain protected even when disclosure review says safe', async () => {
  const parsed = {
    draft: [fixture.claim(`Der interne Gegenstand ${fixture.term} ist noch zu prüfen.`)],
  };
  llm.generateStructured.mockResolvedValue({
    paragraphs: [{ index: 0, audience: 'external', safe: true, replacement: '', reason: '' }],
  });
  const result = await reviewDisclosure(
    parsed,
    {
      disclosure: { external: true, recipient: '', restricted: [] },
      internalSubjects: [fixture.term],
    },
    { tenantId: fixture.tenantId }
  );
  expect(result.draft[0].text).not.toContain(fixture.term);
  expect(result.draft[0].text).toContain('beteiligten Stellen');
});

test('typed glossary statements keep the existing memory path after a filing classification', async () => {
  const message = fixture.scenarios[2].turns[0].message;
  llm.generateStructured.mockResolvedValue(
    fixture.situation(message, {
      conversationShape: 'filing',
      tenantMemory: {
        assertions: [fixture.glossaryAssertion],
        correction: { kind: 'none', basis: '', factId: '' },
        query: { requested: false, anchor: '', functionLabel: '' },
        functionLabel: '',
      },
    })
  );
  const result = await understand({ message, tenantId: fixture.tenantId });
  expect(result.conversationShape).toBe('task');
  expect(result.tenantMemory.assertions).toEqual([fixture.glossaryAssertion]);
});

test('a quoted observation must be literal before it can enter case status', async () => {
  const message = fixture.scenarios[7].turns[0].message;
  llm.generateStructured.mockResolvedValue(
    fixture.situation(message, {
      personAssessment: {
        applicable: true,
        basis: message,
        observations: [fixture.unsupportedObservation],
        hypotheses: [],
      },
    })
  );
  const result = await understand({ message, tenantId: fixture.tenantId });
  expect(result.situation).not.toContain(fixture.unsupportedObservation);
  expect(result.personAssessment.observations).toEqual([]);
});

test('source binding rejects compound-code prefixes and preserves terminal punctuation', () => {
  const { exactCodeToken } = require('../src/edifact-message-adapter');
  const { code, source, compoundCodes } = fixture.codeSourceFixture;
  expect(exactCodeToken(source.excerpt, code.value)).toBe(true);
  expect(exactCodeToken(`${code.value}.`, code.value)).toBe(true);
  for (const value of compoundCodes) {
    expect(exactCodeToken(value, code.value)).toBe(false);
    expect(citedSource({ ...source, excerpt: `${code.family} ${value}` }, code)).toBeNull();
  }
});

test('letters to internal recipients and internal prose have independent form contracts', () => {
  const { validateArtifact, renderArtifact } = require('../src/workbench-artifact');
  const request = {
    requested: true,
    kind: 'correspondence',
    subjects: [],
    forbiddenTerms: [],
    parts: [
      {
        title: fixture.proposal.title,
        sections: [],
        columns: [],
        layout: 'paragraphs',
        audience: 'internal',
        recipient: fixture.proposal.ownerRole,
        letter: true,
      },
    ],
  };
  const parsed = {
    artifact: [
      {
        title: fixture.proposal.title,
        content: [
          fixture.claim(
            'Guten Tag,\n\nBitte den berichteten Prüfauftrag einordnen.\n\nMit freundlichen Grüßen'
          ),
        ],
      },
    ],
  };
  validateArtifact(parsed, request, {
    evidence: [],
    answerEvidence: [],
    unresolved: [],
    counts: new Map(),
    normalizeCondition: (value) => value || '',
  });
  expect(renderArtifact(parsed.artifact, request)).toContain(`An: ${fixture.proposal.ownerRole}`);
  expect(() =>
    validateArtifact(
      parsed,
      { ...request, parts: [{ ...request.parts[0], letter: false }] },
      {
        evidence: [],
        answerEvidence: [],
        unresolved: [],
        counts: new Map(),
        normalizeCondition: (value) => value || '',
      }
    )
  ).toThrow();
});

test('generated confirmation wording respects the stored formal register', () => {
  const { proposalText } = require('../src/workbench-communication');
  const output = proposalText(fixture.proposal, { register: 'Sie' });
  expect(output).toContain('bestätigen Sie');
  expect(output).not.toContain('bestätigst du');
});

test('status fallback reuses visible case search in a new chat without advancing cases', async () => {
  const app = await createCaseBroker();
  const meta = auth('actor-a', ['ROLE_ALPHA'], 'tenant-a');
  try {
    await app.broker.start();
    const created = await app.create([]);
    await app.workbench.store.saveTurnMemory({
      tenantId: 'tenant-a',
      actorId: 'actor-a',
      caseId: created.cetCaseId,
      caseStateVersion: created.caseStateVersion,
      memory: fixture.queryCaseMemory,
    });
    const before = await app.router.loadCase(
      { tenantId: 'tenant-a', actorId: 'actor-a', roles: ['ROLE_ALPHA'], clearance: [] },
      created.cetCaseId
    );
    const beforeChats = (
      await app.workbench.conversationsDb.allDocs({ include_docs: true })
    ).rows.filter((row) => row.doc.type === 'workbench_conversation_assistance');
    const message = fixture.statusQueryMessage;
    const situation = fixture.situation(message, {
      requestedOutput: {
        requested: true,
        basis: message,
        kind: 'summary',
        parts: [
          {
            title: fixture.proposal.title,
            sections: ['Fall', 'Owner', 'Frist'],
            columns: [],
            layout: 'sections',
          },
        ],
        subjects: [],
        constraints: [],
        forbiddenTerms: [],
      },
    });
    llm.generateStructured.mockImplementation(async (_schema, prompt) =>
      JSON.parse(prompt).cases ? { caseIds: [created.cetCaseId] } : situation
    );
    const reply = await app.call(
      'workbench.query',
      {
        channel: 'api',
        conversationId: 'synthetic-status-new',
        userRequest: message,
        intentMode: 'status_query',
      },
      meta
    );
    expect(reply.responseText).toContain(fixture.proposal.ownerRole);
    expect(reply.responseText).toContain('### Fall');
    const after = await app.router.loadCase(
      { tenantId: 'tenant-a', actorId: 'actor-a', roles: ['ROLE_ALPHA'], clearance: [] },
      created.cetCaseId
    );
    expect(after.caseStateVersion).toBe(before.caseStateVersion);
    expect(
      (await app.workbench.conversationsDb.allDocs({ include_docs: true })).rows.filter(
        (row) => row.doc.type === 'workbench_conversation_assistance'
      )
    ).toHaveLength(beforeChats.length);
    const foreign = await app.call(
      'workbench.query',
      {
        channel: 'api',
        conversationId: 'synthetic-status-foreign',
        userRequest: message,
        intentMode: 'status_query',
      },
      auth('actor-a', ['ROLE_ALPHA'], 'tenant-b')
    );
    expect(foreign.responseText).not.toContain(fixture.proposal.ownerRole);
  } finally {
    await app.cleanup();
  }
});

test('a requested reference meaning is not dropped when its family is still unknown', async () => {
  const { classifyCodeTokens } = require('../src/workbench-code-classification');
  const turn = fixture.scenarios[0].turns[0];
  llm.generateStructured.mockImplementation(async (schema, prompt) => {
    const data = JSON.parse(prompt);
    if (data.task === 'output_contract') return fixture.outputContract(turn.message);
    if (data.task === 'turn_controls') return { missingInformation: [] };
    return {
      ...(schema.properties?.missingInformation ? { missingInformation: [] } : {}),
      tokens: data.candidates.map(({ index }) => ({
        index,
        category: 'reference',
        family: '',
        meaningRequested: true,
      })),
    };
  });
  const classified = await classifyCodeTokens(turn.message, [], { timeoutMs: 1000 });
  for (const value of turn.expect.rules.codes)
    expect(classified.references).toContainEqual(expect.objectContaining({ value }));
});

test('a rejected refinement retains the validated current request instead of old case facts', async () => {
  const message = fixture.scenarios[4].turns[2].message;
  const primary = fixture.situation(message, { codeReferences: [], codeMeaningQuestion: false });
  llm.generateStructured.mockImplementation(async (_schema, prompt) => {
    const data = JSON.parse(prompt);
    if (data.task === 'output_contract') return fixture.outputContract(message);
    if (data.task === 'turn_controls' || data.candidates)
      throw new SyntaxError('Synthetic invalid refinement');
    if (data.currentUserMessage)
      return {
        basis: '',
        register: 'unchanged',
        concise: 'unchanged',
        questions: 'unchanged',
        wording: [],
        forbiddenTerms: [],
        preferenceOnly: false,
      };
    return primary;
  });
  const result = await understand({
    message,
    tenantId: fixture.tenantId,
    previous: fixture.situation(fixture.scenarios[4].turns[0].message),
  });
  expect(result.situation).toBe(message);
  expect(result.concern).toBe(primary.concern);
});

test('case tables render confirmed work fields directly from visible case memory', () => {
  const { canRenderCaseRequest } = require('../src/workbench-case-search');
  const part = {
    title: fixture.proposal.title,
    sections: [],
    columns: ['Owner', 'Frist', 'Nächste Befassung', 'Wiedervorlage'],
    layout: 'table',
  };
  expect(
    canRenderCaseRequest({
      requested: true,
      kind: 'internal',
      parts: [part],
      constraints: [],
      forbiddenTerms: [],
    })
  ).toBe(true);
  const text = renderCaseMemory({ memory: fixture.queryCaseMemory }, 'F-1', part);
  for (const key of ['ownerRole', 'deadline', 'nextConsideration', 'reminder'])
    expect(text).toContain(fixture.proposal[key]);
  expect(text).toContain('| --- | --- | --- | --- |');
});

test('case summaries retain workflow fields when fewer headings are requested', () => {
  const text = renderCaseMemory({ memory: fixture.queryCaseMemory }, 'F-1', {
    title: fixture.proposal.title,
    sections: ['Stand'],
    columns: [],
    layout: 'sections',
  });
  for (const label of ['Owner', 'Frist', 'Nächste Befassung', 'Wiedervorlage'])
    expect(text).toContain(`${label}:`);
});

test('workflow metadata respects stored wording restrictions', () => {
  const { caseWorkLines } = require('../src/workbench-case-search');
  const term = fixture.scenarios[4].turns[2].expect.rules.forbid[0];
  const memory = {
    ...fixture.queryCaseMemory,
    caseWork: { ...fixture.queryCaseMemory.caseWork, ownerRole: term },
  };
  expect(caseWorkLines(memory, [], { forbiddenTerms: [term] }).join('\n')).not.toContain(term);
});

test('new-chat case recall renders known fields with stored language preferences', async () => {
  const term = fixture.scenarios[4].turns[2].expect.rules.forbid[0];
  const part = {
    title: fixture.proposal.title,
    sections: ['Stand'],
    columns: [],
    layout: 'sections',
  };
  const message = fixture.statusQueryMessage;
  llm.generateText.mockResolvedValue(
    JSON.stringify({
      artifact: [
        {
          title: part.title,
          content: [fixture.claim(`### Stand\n\n${fixture.queryCaseMemory.situation}`)],
        },
      ],
      interpretation: [],
      expectation: [],
      assumptions: [],
      nextSteps: [],
      draft: [],
    })
  );
  const result = await answer({
    tenantId: fixture.tenantId,
    message,
    situation: fixture.situation(message, {
      caseSearch: { requested: true, query: message },
      requestedOutput: {
        requested: true,
        basis: message,
        kind: 'summary',
        parts: [part],
        subjects: [],
        constraints: [],
        forbiddenTerms: [],
      },
    }),
    retrieval: {
      evidence: [
        {
          source: 'cases',
          id: fixture.tenantId,
          value: fixture.queryCaseMemory.situation,
          metadata: {
            caseMemory: {
              ...fixture.queryCaseMemory,
              conversationPreferences: { forbiddenTerms: [term] },
            },
          },
        },
      ],
    },
  });
  expect(llm.generateText).not.toHaveBeenCalled();
  expect(result.responseText).toContain(fixture.queryCaseMemory.situation);
  expect(result.responseText).toContain('Wiedervorlage:');
  expect(result.responseText).not.toContain(term);
});

test('literal artifact section titles are repaired when original characters were changed', async () => {
  const { classifyCodeTokens } = require('../src/workbench-code-classification');
  const data = fixture.literalSections;
  const output = (sections) => ({
    requestedOutput: {
      requested: true,
      basis: data.message,
      kind: 'summary',
      parts: [{ title: '', sections, columns: [], layout: 'sections', sectionsExplicit: true }],
      subjects: [],
      constraints: [],
      forbiddenTerms: [],
    },
  });
  let attempts = 0;
  llm.generateStructured.mockImplementation(async (_schema, prompt) => {
    const request = JSON.parse(prompt);
    if (request.task === 'output_contract')
      return output(attempts++ ? data.sections : data.altered);
    return { missingInformation: [] };
  });
  const result = await classifyCodeTokens(data.message, [], { timeoutMs: 1000 });
  expect(result.requestedOutput.parts[0].sections).toEqual(data.sections);
  expect(attempts).toBe(2);
});

test('two internal non-letter versions cannot trigger an external disclosure rewrite', async () => {
  const turn = fixture.scenarios[4].turns.find((item) => item.id === 'versions');
  llm.generateStructured.mockResolvedValue(
    fixture.situation(turn.message, {
      disclosure: { external: true, recipient: '', restricted: [] },
      requestedOutput: {
        requested: true,
        basis: turn.message,
        kind: 'correspondence',
        parts: turn.expect.rules.sections.map((title) => ({
          title,
          sections: [],
          columns: [],
          layout: 'paragraphs',
          audience: 'internal',
          letter: false,
        })),
        subjects: [],
        constraints: [],
        forbiddenTerms: [],
      },
    })
  );
  const result = await understand({ message: turn.message, tenantId: fixture.tenantId });
  expect(result.requestedOutput.kind).toBe('internal');
  expect(result.disclosure.external).toBe(false);
});

test('ordinary answers cannot retain an invented artifact from private extraction metadata', async () => {
  const message = fixture.scenarios[0].turns[0].message;
  llm.generateStructured.mockResolvedValue(
    fixture.situation(message, {
      requestedOutput: {
        requested: 'ordinary_answer',
        basis: fixture.proposal.title,
        kind: 'other',
        parts: [{ title: fixture.proposal.title, sections: [], columns: [], layout: 'paragraphs' }],
        subjects: [],
        constraints: [],
        forbiddenTerms: [],
      },
    })
  );
  const result = await understand({ message, tenantId: fixture.tenantId });
  expect(result.requestedOutput).toMatchObject({ requested: false, basis: '', parts: [] });
  expect(SITUATION_SCHEMA.properties.requestedOutput.properties.requested.type).toBe('boolean');
  expect(
    llm.generateStructured.mock.calls[0][0].properties.requestedOutput.properties.requested.enum
  ).toEqual(['ordinary_answer', 'explicit_artifact']);
});

test('a private explicit-artifact decision is bound to the actual current input', async () => {
  const message = fixture.scenarios[2].turns[1].message;
  llm.generateStructured.mockResolvedValue(
    fixture.situation(message, {
      requestedOutput: {
        requested: 'explicit_artifact',
        basis: fixture.proposal.title,
        kind: 'internal',
        parts: [
          {
            title: fixture.proposal.title,
            sections: [],
            columns: [],
            layout: 'paragraphs',
            audience: 'internal',
            letter: false,
          },
        ],
        subjects: [],
        constraints: [],
        forbiddenTerms: [],
      },
    })
  );
  const result = await understand({ message, tenantId: fixture.tenantId });
  expect(result.requestedOutput).toMatchObject({ requested: true, basis: message });
});

test('structured table rows preserve requested columns and claim provenance', () => {
  const {
    materializeTables,
    validateArtifact,
    renderArtifact,
  } = require('../src/workbench-artifact');
  const { text: _text, ...metadata } = fixture.claim('');
  const part = {
    title: fixture.proposal.title,
    sections: [],
    columns: fixture.matrix.columns,
    layout: 'table',
  };
  const request = {
    requested: true,
    kind: 'internal',
    parts: [part],
    subjects: [],
    constraints: [],
    forbiddenTerms: [],
  };
  const parsed = {
    artifact: [
      { title: part.title, content: [], tableRows: [{ ...metadata, cells: fixture.matrix.cells }] },
    ],
  };
  materializeTables(parsed, request);
  validateArtifact(parsed, request, {
    evidence: [],
    answerEvidence: [],
    unresolved: [],
    message: fixture.matrix.message,
    counts: new Map(),
    normalizeCondition: (value) => value || '',
  });
  const rendered = renderArtifact(parsed.artifact, request);
  expect(rendered).toContain(`| ${fixture.matrix.columns.join(' | ')} |`);
  expect(rendered).toContain(`| ${fixture.matrix.cells.join(' | ')} |`);
  expect(parsed.artifact[0].content[2]).toMatchObject(metadata);
  expect(parsed.artifact[0].tableRows).toBeUndefined();
  expect(() =>
    materializeTables(
      { artifact: [{ tableRows: [{ ...metadata, cells: fixture.matrix.cells.slice(1) }] }] },
      request
    )
  ).toThrow(expect.objectContaining({ fallbackReason: 'artifact_cell_count' }));
});

test('single-item status is not published as organizational knowledge', async () => {
  const message = fixture.caseAssertion.basis;
  const primary = fixture.situation(message, {
    codeReferences: [],
    tenantMemory: {
      assertions: [fixture.caseAssertion],
      correction: { kind: 'none', basis: '', factId: '' },
      query: { requested: false, anchor: '', functionLabel: '' },
      functionLabel: '',
    },
    caseMemory: {
      applicable: false,
      topic: fixture.proposal.title,
      status: message,
      openPoints: [],
      assumptions: [],
      risks: [],
      nextSteps: [],
      resolvedItems: [],
    },
  });
  llm.generateStructured.mockImplementation(async (_schema, prompt) => {
    const data = JSON.parse(prompt);
    if (data.task === 'output_contract') return fixture.outputContract(message);
    if (data.task === 'turn_controls') return { missingInformation: [] };
    if (data.currentUserMessage)
      return {
        basis: '',
        register: 'unchanged',
        concise: 'unchanged',
        questions: 'unchanged',
        wording: [],
        forbiddenTerms: [],
        preferenceOnly: false,
        workContext: { concrete: true, basis: message, scope: 'single_item' },
      };
    if (data.candidates) return { tokens: [], missingInformation: [] };
    return primary;
  });
  const result = await understand({ message, tenantId: fixture.tenantId });
  expect(result.tenantMemory.assertions).toEqual([]);
  expect(result.caseMemory.applicable).toBe(true);
  expect(result.turnKind).toBe('work');
});

test('part audiences and addressed correspondence survive a global internal classification', async () => {
  const message = fixture.scenarios[3].turns[1].message;
  const output = fixture.outputContract(message).requestedOutput;
  output.requested = true;
  output.kind = 'internal';
  output.basis = message;
  output.parts = [
    {
      ...fixture.outputContract(message).requestedOutput.parts[0],
      title: fixture.proposal.title,
      sections: [],
      columns: [],
      layout: 'paragraphs',
      audience: 'external',
      recipient: fixture.proposal.ownerRole,
      letter: true,
      sectionsExplicit: false,
      minimumSteps: 0,
    },
  ];
  llm.generateStructured.mockImplementation(async (_schema, prompt) => {
    const data = JSON.parse(prompt);
    if (data.task === 'output_contract') return { requestedOutput: output };
    if (data.task === 'token_roles')
      return {
        tokens: data.candidates.map(({ index }) => ({
          index,
          category: 'reference',
          family: '',
          meaningRequested: false,
        })),
      };
    if (data.task === 'turn_controls') return { missingInformation: [] };
    if (data.currentUserMessage)
      return {
        basis: '',
        register: 'unchanged',
        concise: 'unchanged',
        questions: 'unchanged',
        wording: [],
        forbiddenTerms: [],
        preferenceOnly: false,
      };
    return fixture.situation(message, { codeReferences: [] });
  });
  const result = await understand({ message, tenantId: fixture.tenantId });
  expect(result.requestedOutput.parts[0]).toMatchObject({
    audience: 'external',
    letter: true,
    recipient: fixture.proposal.ownerRole,
  });
});

test('requested clarification repairs an empty question list before answering', async () => {
  const { classifyCodeTokens } = require('../src/workbench-code-classification');
  const message = fixture.scenarios[5].turns[1].message;
  const question = message.slice(message.indexOf('Was'));
  let controls = 0;
  llm.generateStructured.mockImplementation(async (_schema, prompt) => {
    const data = JSON.parse(prompt);
    if (data.task === 'output_contract') return fixture.outputContract(message);
    if (data.task === 'token_roles')
      return {
        tokens: data.candidates.map(({ index }) => ({
          index,
          category: 'other',
          family: '',
          meaningRequested: false,
        })),
      };
    controls++;
    return {
      needsClarification: true,
      missingInformation:
        controls === 1
          ? []
          : [
              {
                key: 'synthetic-clarification',
                question,
                blocking: true,
                decisive: true,
                answered: false,
                reason: 'decisive',
              },
            ],
    };
  });
  const result = await classifyCodeTokens(message, [], {}, false, {
    conversationPreferences: { questions: 'requested' },
    askedQuestions: [],
  });
  expect(controls).toBe(2);
  expect(result.missingInformation).toHaveLength(1);
});

test('table cells escape existing backslashes before delimiter and line-break handling', () => {
  const { escapeTableCell } = require('../src/workbench-artifact');
  const value = fixture.matrix.cells[0];
  expect(escapeTableCell(`\\${value}|\r\n`)).toBe(`\\\\${value}\\| `);
});

test('language bans cover factual introductions and previously generated clarification questions', () => {
  const term = fixture.proposal.ownerRole.split(/\s/u)[0];
  const situation = fixture.situation(fixture.scenarios[5].turns[1].message, {
    conversationPreferences: { forbiddenTerms: [term] },
    missingInformation: [
      {
        key: 'synthetic-question',
        question: `${term}?`,
        reason: 'decisive',
        decisive: true,
        blocking: true,
        answered: false,
      },
    ],
  });
  expect(questionsFor(situation)).toEqual([]);
  expect(() =>
    validateCommunication({ expectation: [fixture.claim(term)] }, situation, [])
  ).toThrow(expect.objectContaining({ fallbackReason: 'conversation_wording' }));
});

test('an ambiguous family in a shared meaning query stays explicitly unproven', async () => {
  const { classifyCodeTokens } = require('../src/workbench-code-classification');
  const turn = fixture.scenarios[0].turns[0];
  llm.generateStructured.mockImplementation(async (_schema, prompt) => {
    const data = JSON.parse(prompt);
    if (data.task === 'output_contract') return fixture.outputContract(turn.message);
    if (data.task === 'turn_controls') return { missingInformation: [] };
    return {
      tokens: data.candidates.map(({ index }) => ({
        index,
        category: index === 0 ? 'reference' : 'code',
        family: '',
        meaningRequested: index !== 0,
      })),
    };
  });
  const result = await classifyCodeTokens(turn.message, [], {});
  for (const value of turn.expect.rules.codes)
    expect(result.references).toContainEqual(expect.objectContaining({ value }));
});

test('an ungrounded dependency cannot erase an exact reported input or add a new meaning to it', () => {
  const { filterAnswer } = require('../src/workbench-answer-filter');
  const value = fixture.scenarios[0].turns[0].expect.rules.codes[0];
  const options = {
    evidence: [],
    answerEvidence: [],
    unresolved: [{ value }],
    message: fixture.scenarios[0].turns[0].message,
    normalizeCondition: (x) => x,
    counts: new Map(),
  };
  const parsed = {
    interpretation: [
      {
        ...fixture.claim(`${value} ${fixture.proposal.title}`),
        inputQuote: fixture.reportedFact,
        origin: 'input',
        codeDependencies: [value],
      },
    ],
  };
  filterAnswer(parsed, options);
  expect(parsed.interpretation[0].text).toBe(`Berichtet: „${fixture.reportedFact}“`);
  expect(parsed.interpretation[0].text).not.toContain(fixture.proposal.title);
  const invalid = {
    interpretation: [
      {
        ...fixture.claim(value),
        origin: 'input',
        inputQuote: fixture.reportedFact + '\n',
        codeDependencies: [value],
      },
    ],
  };
  filterAnswer(invalid, { ...options, counts: new Map() });
  expect(invalid.interpretation).toEqual([]);
});

test('the focused clarification contract repairs an empty clarification decision', async () => {
  const { clarifyMissingInformation } = require('../src/workbench-clarification');
  const message = fixture.scenarios[5].turns[1].message;
  const question = message.slice(message.indexOf('Was'));
  llm.generateStructured
    .mockResolvedValueOnce({ mode: 'clarify_and_answer', questions: [] })
    .mockResolvedValueOnce({
      mode: 'clarify_and_answer',
      questions: [
        {
          key: 'synthetic-focused',
          question,
          reason: 'decisive',
          decisive: true,
          blocking: true,
          answered: false,
        },
      ],
    });
  expect(
    await clarifyMissingInformation(
      message,
      { conversationPreferences: { questions: 'requested' }, askedQuestions: [] },
      {}
    )
  ).toHaveLength(1);
  expect(llm.generateStructured).toHaveBeenCalledTimes(2);
});

test('code-source clarification follows the stored formal register', () => {
  const { unresolvedQuestions } = require('../src/workbench-codes');
  const value = fixture.scenarios[0].turns[0].expect.rules.codes[0];
  const questions = unresolvedQuestions([{ value, status: 'unresolved' }], { register: 'Sie' });
  expect(questions[0].question).toContain('Ihrer');
  expect(questions[0].question).not.toContain('eurer');
});

test('structured steps retain provenance and render a complete numbered internal order', () => {
  const {
    materializeTables,
    validateArtifact,
    renderArtifact,
  } = require('../src/workbench-artifact');
  const texts = [fixture.term, fixture.proposal.ownerRole, fixture.proposal.nextConsideration];
  const request = {
    requested: true,
    kind: 'internal',
    parts: [
      {
        title: fixture.term,
        sections: [],
        columns: [],
        layout: 'steps',
        audience: 'internal',
        letter: false,
        minimumSteps: 3,
      },
    ],
    subjects: [fixture.term],
    constraints: [],
    forbiddenTerms: [],
  };
  const parsed = {
    artifact: [
      {
        title: fixture.term,
        content: [],
        orderedSteps: texts.map((text) => ({ ...fixture.claim(text), section: '' })),
      },
    ],
  };
  materializeTables(parsed, request);
  validateArtifact(parsed, request, {
    evidence: [],
    answerEvidence: [],
    unresolved: [],
    message: fixture.scenarios[2].turns[1].message,
    normalizeCondition: (x) => x || '',
    counts: new Map(),
  });
  const output = renderArtifact(parsed.artifact, request);
  texts.forEach((text, i) => expect(output).toContain(`${i + 1}. ${text}`));
  expect(parsed.artifact[0].content[0].origin).toBe('input');
  expect(parsed.artifact[0].orderedSteps).toBeUndefined();
});

test('a current direct question requires an answer rather than only further steps', async () => {
  const base = { expectation: [], interpretation: [], assumptions: [], draft: [] };
  llm.generateText
    .mockResolvedValueOnce(
      JSON.stringify({ ...base, nextSteps: [fixture.claim(fixture.proposal.nextConsideration)] })
    )
    .mockResolvedValueOnce(
      JSON.stringify({
        ...base,
        nextSteps: [],
        interpretation: [fixture.claim(fixture.directQuestion.split(';')[0])],
      })
    );
  const result = await answer({
    tenantId: fixture.tenantId,
    message: fixture.directQuestion,
    situation: fixture.situation(fixture.directQuestion, {
      codeReferences: [],
      conversationShape: 'task',
      turnKind: 'work',
      outputKind: 'analysis',
    }),
    retrieval: { evidence: [] },
  });
  expect(result.answerAttempts).toBe(2);
  expect(result.responseText).toContain(fixture.directQuestion.split(';')[0]);
});

test('personal interpretations do not become new factual risks in case memory', async () => {
  const message = fixture.scenarios[7].turns[0].message;
  const previous = fixture.situation(message, {
    risks: [fixture.proposal.ownerRole],
    caseMemory: {
      applicable: true,
      topic: fixture.proposal.title,
      status: '',
      openPoints: [],
      assumptions: [],
      risks: [fixture.proposal.ownerRole],
      nextSteps: [],
      resolvedItems: [],
    },
  });
  llm.generateStructured.mockResolvedValue(
    fixture.situation(message, {
      personAssessment: {
        applicable: true,
        basis: message,
        observations: [message.split('. ')[0]],
        hypotheses: [message.split('. ').at(-1)],
      },
      risks: [fixture.unsupportedObservation],
      caseMemory: { ...previous.caseMemory, risks: [fixture.unsupportedObservation] },
    })
  );
  const result = await understand({ tenantId: fixture.tenantId, message, previous });
  expect(result.caseMemory.risks).toEqual(previous.caseMemory.risks);
  expect(result.risks).toEqual(previous.risks);
});

test('ordinary case recall includes the existing last working conclusion and applies wording restrictions', () => {
  const memory = { ...fixture.queryCaseMemory, lastSafeConclusion: fixture.proposal.title };
  const output = renderCaseMemory({ memory }, fixture.queryCaseMemory.caseDisplayRef);
  expect(output).toContain(`Letzte Einordnung (Arbeitsstand): ${fixture.proposal.title}`);
  const restricted = renderCaseMemory({ memory }, fixture.queryCaseMemory.caseDisplayRef, null, {
    forbiddenTerms: [fixture.proposal.title],
  });
  expect(restricted).not.toContain(fixture.proposal.title);
});

test('shared planning remains an organizational statement under the common scope policy', async () => {
  const message = fixture.sharedContext.message;
  const primary = fixture.situation(message, {
    codeReferences: [],
    tenantMemory: {
      assertions: [fixture.sharedContext.assertion],
      correction: { kind: 'none', basis: '', factId: '' },
      query: { requested: false, anchor: '', functionLabel: '' },
      functionLabel: '',
    },
  });
  llm.generateStructured.mockImplementation(async (_schema, prompt) => {
    const data = JSON.parse(prompt);
    if (data.task === 'output_contract') return fixture.outputContract(message);
    if (data.task === 'turn_controls') return { missingInformation: [] };
    if (data.currentUserMessage) {
      expect(data.organizationScopeInstruction).toBe(
        require('../src/tenant-memory-schema').SCOPE_INSTRUCTION
      );
      return {
        basis: '',
        register: 'unchanged',
        concise: 'unchanged',
        questions: 'unchanged',
        wording: [],
        forbiddenTerms: [],
        preferenceOnly: false,
        workContext: { concrete: true, intent: 'work', basis: message, scope: 'shared_context' },
      };
    }
    if (data.candidates) return { tokens: [] };
    return primary;
  });
  const result = await understand({ message, tenantId: fixture.tenantId });
  expect(result.tenantMemory.assertions).toEqual([fixture.sharedContext.assertion]);
});

test('ordinary assertions and identity entries cannot become glossary definitions', () => {
  const { glossaryDefinition } = require('../src/tenant-memory');
  const assertion = fixture.glossaryAssertion;
  expect(glossaryDefinition(assertion, assertion.basis)).toEqual(fixture.glossary);
  expect(
    glossaryDefinition(
      { ...assertion, glossary: { ...fixture.glossary, kind: 'none' } },
      assertion.basis
    )
  ).toBeUndefined();
  expect(
    glossaryDefinition(
      { ...assertion, glossary: { ...fixture.glossary, meaning: fixture.term } },
      assertion.basis
    )
  ).toBeUndefined();
  expect(
    glossaryDefinition(
      { ...assertion, glossary: { ...fixture.glossary, meaning: fixture.proposal.ownerRole } },
      assertion.basis
    )
  ).toBeUndefined();
});

test('a positively classified technical code requires knowledge evidence even when present in the glossary', async () => {
  const { classifyCodeTokens } = require('../src/workbench-code-classification');
  const turn = fixture.scenarios[0].turns[0];
  llm.generateStructured.mockImplementation(async (_schema, prompt) => {
    const data = JSON.parse(prompt);
    if (data.task === 'output_contract') return fixture.outputContract(turn.message);
    if (data.task === 'turn_controls') return { missingInformation: [] };
    return {
      tokens: data.candidates.map(({ index }) => ({
        index,
        category: 'code',
        family: '',
        meaningRequested: true,
      })),
    };
  });
  const value = turn.expect.rules.codes[0];
  const result = await classifyCodeTokens(
    turn.message,
    [{ term: value, meaning: fixture.meaning, kind: 'other' }],
    {}
  );
  expect(result.references).toContainEqual(expect.objectContaining({ value }));
});

test('a mode-only misclassification cannot suppress independently established requested questions', async () => {
  const message = fixture.scenarios[5].turns[1].message;
  const question = message.slice(message.indexOf('Was'));
  const missing = {
    key: 'synthetic-focused',
    question,
    reason: 'decisive',
    decisive: true,
    blocking: true,
    answered: false,
  };
  llm.generateStructured.mockImplementation(async (_schema, prompt) => {
    const data = JSON.parse(prompt);
    if (data.task === 'output_contract') return fixture.outputContract(message);
    if (data.task === 'turn_controls') return { missingInformation: [], preferenceOnly: true };
    if (data.task === 'requested_clarification')
      return { mode: 'clarify_and_answer', questions: [missing] };
    if (data.currentUserMessage)
      return {
        basis: '',
        register: 'unchanged',
        concise: 'unchanged',
        questions: 'unchanged',
        wording: [],
        forbiddenTerms: [],
        preferenceOnly: true,
      };
    if (data.candidates) return { tokens: [] };
    return fixture.situation(message, { codeReferences: [] });
  });
  const result = await understand({
    message,
    tenantId: fixture.tenantId,
    previous: fixture.situation(fixture.scenarios[5].turns[0].message, {
      conversationPreferences: { questions: 'requested' },
    }),
  });
  expect(result.preferenceOnly).toBe(false);
  expect(questionsFor(result)).toEqual([expect.objectContaining({ key: missing.key })]);
});

test('the intake expectation accepts equivalent registration states but requires substantive content', () => {
  const turn = require('../scripts/generate-practice-evaluation-fixtures')
    .generatePracticeCatalog()
    .scenarios.find((item) => item.id === 'mako-authorization').turns[0];
  const check = (responseText) =>
    require('../scripts/practice-evaluation-checks')
      .checkTurn(turn, { responseText, cetCaseId: 'synthetic-case' })
      .find((item) => item.id === 'required-1').passed;
  for (const responseText of ['Anmeldung', 'Anmeldestand', 'Anmeldestatus'])
    expect(check(responseText)).toBe(true);
  expect(check('Bedeutung nicht belegt.')).toBe(false);
});

test.each(['reference', 'other'])(
  'a shared meaning question keeps an unclassified value explicitly unproven (%s)',
  async (category) => {
    const { classifyCodeTokens } = require('../src/workbench-code-classification');
    const turn = fixture.scenarios[0].turns[0];
    llm.generateStructured.mockImplementation(async (_schema, prompt) => {
      const data = JSON.parse(prompt);
      if (data.task === 'output_contract') return fixture.outputContract(turn.message);
      if (data.task === 'turn_controls') return { missingInformation: [] };
      return {
        tokens: data.candidates.map(({ index }) => ({
          index,
          category: index === 0 ? category : 'code',
          family: '',
          meaningRequested: false,
        })),
      };
    });
    const result = await classifyCodeTokens(turn.message, [], {}, true);
    expect(result.meaningRequested).toBe(true);
    expect(result.references.map((item) => item.value)).toEqual(
      expect.arrayContaining(turn.expect.rules.codes)
    );
  }
);

test('a grounded current mode stays question-free even when a refinement invents missing context', async () => {
  const message = fixture.scenarios[5].turns[0].message;
  const problem = fixture.scenarios[5].turns[1].message;
  const missing = {
    key: 'synthetic-focused',
    question: problem.slice(problem.indexOf('Was')),
    reason: 'decisive',
    decisive: true,
    blocking: true,
    answered: false,
  };
  llm.generateStructured.mockImplementation(async (_schema, prompt) => {
    const data = JSON.parse(prompt);
    if (data.task === 'output_contract') return fixture.outputContract(message);
    if (data.task === 'turn_controls') return { missingInformation: [missing] };
    if (data.currentUserMessage)
      return {
        basis: message,
        register: 'unchanged',
        concise: 'unchanged',
        questions: 'ask_when_needed',
        wording: [],
        forbiddenTerms: [],
        preferenceOnly: true,
      };
    if (data.candidates) return { tokens: [] };
    return fixture.situation(message, { codeReferences: [] });
  });
  const result = await understand({ message, tenantId: fixture.tenantId });
  expect(result.preferenceOnly).toBe(true);
  expect(questionsFor(result)).toEqual([]);
  expect(result.conversationPreferences.questions).toBe('requested');
});
