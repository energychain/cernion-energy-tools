'use strict';

jest.mock('../src/llm-client', () => ({ generateText: jest.fn(), generateStructured: jest.fn() }));
const llm = require('../src/llm-client');
const { answer } = require('../src/workbench-understanding');
const { freeAnswerEnabled, paragraphs } = require('../src/workbench-free-answer');

const situation = {
  concern: 'Fehlende fachliche Rückmeldung zu einem Vorgang',
  situation: 'Transportquittung liegt vor, fachliche Rückmeldung nicht gefunden.',
  participants: [],
  identifiers: [],
  deadlines: [],
  hypotheses: [],
  retrievalTerms: ['Rückmeldung'],
  missingInformation: [],
  requestedAction: { description: '', draftRequested: false, externalEffect: false },
  turnKind: 'work',
  conversationShape: 'task',
};
const evidence = [
  {
    evidenceId: 'E1',
    source: 'Prozessbeschreibung',
    retrievalSource: 'knowledge-gateway',
    value: 'Transportquittung und fachliche Rückmeldung sind getrennte Belegarten.',
    metadata: { sourceId: 'doc_1', sectionId: 'Belegarten' },
  },
];
const saved = { ...process.env };
afterEach(() => {
  process.env = { ...saved };
  jest.clearAllMocks();
});

test('the switch enables all tenants or listed ones only', () => {
  expect(freeAnswerEnabled('t', {})).toBe(false);
  expect(freeAnswerEnabled('t', { WORKBENCH_FREE_ANSWER: 'all' })).toBe(true);
  expect(freeAnswerEnabled('t', { WORKBENCH_FREE_ANSWER: 'a, t' })).toBe(true);
  expect(freeAnswerEnabled('t', { WORKBENCH_FREE_ANSWER: 'a' })).toBe(false);
});

test('headings stay with the block that follows them', () => {
  expect(paragraphs('## Lage\n\nText eins.\n\nText zwei.')).toEqual([
    '## Lage\n\nText eins.',
    'Text zwei.',
  ]);
});

test('a free answer is annotated and then runs through the same checks', async () => {
  process.env.WORKBENCH_FREE_ANSWER = 'all';
  llm.generateText.mockResolvedValue(
    [
      'Belegt ist nur der technische Eingang; eine fachliche Rückmeldung fehlt bisher.',
      'Die Transportquittung ersetzt die fachliche Rückmeldung nicht, beide sind getrennte Belegarten.',
      'Ich habe die Rückmeldung bereits beim Gegenüber nachgefordert.',
      'Prüfe als Nächstes die Suche mit der exakten Referenz, weil ein Treffer dort die Lücke schließt.',
      'Liegt dir die Originalnachricht als Datei vor?',
    ].join('\n\n')
  );
  llm.generateStructured.mockImplementation(async (schema, raw) => {
    const input = JSON.parse(raw);
    expect(input.instruction).toMatch(/Kennzeichne jeden Absatz/u);
    return {
      paragraphs: [
        {
          index: 0,
          kind: 'statement',
          origin: 'input',
          evidenceIds: [],
          ruleClaim: false,
          completedAction: false,
          specific: false,
        },
        {
          index: 1,
          kind: 'statement',
          origin: 'evidence',
          evidenceIds: ['E1'],
          ruleClaim: true,
          completedAction: false,
          specific: false,
        },
        {
          index: 2,
          kind: 'statement',
          origin: 'model',
          evidenceIds: [],
          ruleClaim: false,
          completedAction: true,
          specific: false,
        },
        {
          index: 3,
          kind: 'step',
          origin: 'model',
          evidenceIds: [],
          ruleClaim: false,
          completedAction: false,
          specific: false,
        },
        {
          index: 4,
          kind: 'question',
          origin: 'model',
          evidenceIds: [],
          ruleClaim: false,
          completedAction: false,
          specific: false,
        },
      ],
    };
  });
  const result = await answer({
    situation,
    retrieval: { evidence },
    message: 'Was ist belegt und was fehlt?',
    tenantId: 't',
    conversation: [{ role: 'user', content: 'Die Rückmeldung fehlt.' }],
  });
  const prompt = JSON.parse(llm.generateText.mock.calls[0][0]);
  expect(prompt.instruction).toMatch(/direkten Antwort/u);
  expect(prompt.conversation).toEqual([{ role: 'user', text: 'Die Rückmeldung fehlt.' }]);
  expect(llm.generateText.mock.calls[0][1].responseMimeType).toBe('text/plain');
  expect(result.responseText).toContain('Belegt ist nur der technische Eingang');
  expect(result.responseText).toContain('getrennte Belegarten');
  expect(result.responseText).toContain('Prüfe als Nächstes');
  // The check removes the invented completed action; the follow-up question is kept.
  expect(result.responseText).not.toContain('bereits beim Gegenüber nachgefordert');
  expect(result.responseText).toContain('Liegt dir die Originalnachricht als Datei vor?');
  expect(result.answerStatus).not.toBe('fallback');
});

test('a requested draft keeps the structured path', async () => {
  process.env.WORKBENCH_FREE_ANSWER = 'all';
  llm.generateText.mockResolvedValue(
    JSON.stringify({
      expectation: [],
      nextSteps: [],
      interpretation: [],
      assumptions: [],
      draft: [],
    })
  );
  await answer({
    situation: {
      ...situation,
      requestedAction: {
        description: 'Antwort schreiben',
        draftRequested: true,
        externalEffect: false,
      },
    },
    retrieval: { evidence },
    message: 'Schreib mir bitte den Entwurf.',
    tenantId: 't',
  });
  const prompt = JSON.parse(llm.generateText.mock.calls[0][0]);
  expect(prompt.instruction).not.toMatch(/Kennzeichne jeden Absatz/u);
  expect(llm.generateText.mock.calls[0][1].responseMimeType).toBe('application/json');
});

test('a code fence around the whole answer is dropped', () => {
  expect(paragraphs('```markdown\nErster Absatz.\n\nZweiter Absatz.\n```')).toEqual([
    'Erster Absatz.',
    'Zweiter Absatz.',
  ]);
});

test('a free answer that fails the checks is repaired on the structured path', async () => {
  process.env.WORKBENCH_FREE_ANSWER = 'all';
  llm.generateText
    .mockResolvedValueOnce('Ich habe das bereits beim Gegenüber erledigt.')
    .mockResolvedValueOnce(
      JSON.stringify({
        interpretation: [
          {
            text: 'Belegt ist der technische Eingang; die fachliche Rückmeldung fehlt.',
            origin: 'model',
            supported: 'model',
            completedAction: false,
            specific: false,
            evidenceIds: [],
          },
        ],
        expectation: [],
        nextSteps: [],
      })
    );
  llm.generateStructured.mockResolvedValue({
    paragraphs: [
      {
        index: 0,
        kind: 'statement',
        origin: 'model',
        evidenceIds: [],
        ruleClaim: false,
        completedAction: true,
        specific: false,
      },
    ],
  });
  const result = await answer({
    situation,
    retrieval: { evidence },
    message: 'Was ist belegt?',
    tenantId: 't',
  });
  expect(llm.generateText).toHaveBeenCalledTimes(2);
  expect(llm.generateText.mock.calls[1][1].responseMimeType).toBe('application/json');
  expect(result.responseText).toContain('fachliche Rückmeldung fehlt');
});

const parkNote = {
  requested: true,
  basis: 'übergabefähige Parknotiz mit Anlass, gesichertem Stand und offenen Punkten',
  kind: 'internal',
  parts: [
    {
      title: 'Parknotiz',
      audience: 'internal',
      letter: false,
      sections: ['Anlass', 'Gesicherter Stand', 'Offene Punkte'],
      columns: [],
      layout: 'sections',
      sectionsExplicit: true,
    },
  ],
  subjects: [],
  constraints: [],
  forbiddenTerms: [],
};
const annotateAll = async (schema, raw) => {
  const input = JSON.parse(raw);
  return {
    paragraphs: input.paragraphs.map(({ index }) => ({
      index,
      kind: 'statement',
      origin: 'input',
      evidenceIds: [],
      ruleClaim: false,
      completedAction: false,
      specific: false,
    })),
  };
};

test('an ordered internal deliverable is written as Markdown and passes the artifact checks', async () => {
  process.env.WORKBENCH_FREE_ANSWER = 'all';
  llm.generateText.mockResolvedValue(
    [
      '# Parknotiz',
      '## Anlass\n\nFür den Zielvorgang fehlt die fachliche Rückmeldung.',
      '## Gesicherter Stand\n\nNur die Transportquittung liegt vor; der Scan gehört zum Vergleichsvorgang.',
      '## Offene Punkte\n\nDie fachliche Rückmeldung ist weiterhin offen.',
    ].join('\n\n')
  );
  llm.generateStructured.mockImplementation(annotateAll);
  const result = await answer({
    situation: { ...situation, requestedOutput: parkNote },
    retrieval: { evidence },
    message: `Parke den Vorgang. Ich brauche eine ${parkNote.basis}.`,
    tenantId: 't',
  });
  expect(llm.generateText).toHaveBeenCalledTimes(1);
  const prompt = JSON.parse(llm.generateText.mock.calls[0][0]);
  expect(prompt.deliverable).toEqual(parkNote.parts);
  expect(llm.generateText.mock.calls[0][1].responseMimeType).toBe('text/plain');
  expect(result.answerStatus).not.toBe('fallback');
  for (const heading of ['## Anlass', '## Gesicherter Stand', '## Offene Punkte'])
    expect(result.responseText).toContain(heading);
  expect(result.responseText).toContain('der Scan gehört zum Vergleichsvorgang');
  expect(result.responseText).not.toContain('# Parknotiz\n\n# Parknotiz');
});

test('a free deliverable that misses only the ordered form is given as written, without repairs', async () => {
  process.env.WORKBENCH_FREE_ANSWER = 'all';
  llm.generateText.mockResolvedValue(
    [
      '## Anlass\n\nFür den Zielvorgang fehlt die fachliche Rückmeldung.',
      '## Stand\n\nNur die Transportquittung liegt vor.',
    ].join('\n\n')
  );
  llm.generateStructured.mockImplementation(annotateAll);
  const result = await answer({
    situation: { ...situation, requestedOutput: parkNote },
    retrieval: { evidence },
    message: `Parke den Vorgang. Ich brauche eine ${parkNote.basis}.`,
    tenantId: 't',
  });
  expect(llm.generateText).toHaveBeenCalledTimes(1);
  expect(result.answerStatus).not.toBe('fallback');
  expect(result.responseText).toContain('Nur die Transportquittung liegt vor.');
});

test('correspondence keeps the structured path', () => {
  const { freeDeliverable } = require('../src/workbench-free-answer');
  expect(freeDeliverable(parkNote)).toBe(true);
  expect(freeDeliverable({ ...parkNote, kind: 'correspondence' })).toBe(false);
  expect(
    freeDeliverable({ ...parkNote, parts: [{ ...parkNote.parts[0], audience: 'external' }] })
  ).toBe(false);
  expect(freeDeliverable({ ...parkNote, requested: false })).toBe(false);
});

test('several ordered parts are split at their part headings', () => {
  const { deliverableBlocks } = require('../src/workbench-free-answer');
  const request = { parts: [{ title: 'Kurzfassung' }, { title: 'Langfassung' }] };
  expect(
    deliverableBlocks('# Kurzfassung\n\nA.\n\n# Langfassung\n\n## Teil\n\nB.\n\nC.', request)
  ).toEqual([
    { title: 'Kurzfassung', blocks: ['A.'] },
    { title: 'Langfassung', blocks: ['## Teil\n\nB.', 'C.'] },
  ]);
});

test('a filtered paragraph is removed from a free deliverable; the rest is given without repairs', async () => {
  process.env.WORKBENCH_FREE_ANSWER = 'all';
  llm.generateText.mockResolvedValue(
    [
      '## Anlass\n\nFür den Zielvorgang fehlt die fachliche Rückmeldung.',
      '## Gesicherter Stand\n\nNur die Transportquittung liegt vor.',
      'Ich habe den Vorgang bereits im Bestand geschlossen.',
      '## Offene Punkte\n\nDie fachliche Rückmeldung ist weiterhin offen.',
    ].join('\n\n')
  );
  llm.generateStructured.mockImplementation(async (schema, raw) => {
    const input = JSON.parse(raw);
    return {
      paragraphs: input.paragraphs.map(({ index, text }) => ({
        index,
        kind: 'statement',
        origin: 'input',
        evidenceIds: [],
        ruleClaim: false,
        completedAction: /bereits/u.test(text),
        specific: false,
      })),
    };
  });
  const result = await answer({
    situation: { ...situation, requestedOutput: parkNote },
    retrieval: { evidence },
    message: `Parke den Vorgang. Ich brauche eine ${parkNote.basis}.`,
    tenantId: 't',
  });
  expect(llm.generateText).toHaveBeenCalledTimes(1);
  expect(result.answerStatus).not.toBe('fallback');
  expect(result.responseText).toContain('Nur die Transportquittung liegt vor.');
  expect(result.responseText).toContain('Die fachliche Rückmeldung ist weiterhin offen.');
  expect(result.responseText).not.toContain('bereits im Bestand geschlossen');
});

test('when the checks remove too much of a free deliverable, it is written once more freely with the reasons', async () => {
  process.env.WORKBENCH_FREE_ANSWER = 'all';
  llm.generateText
    .mockResolvedValueOnce(
      [
        '## Anlass\n\nFür den Zielvorgang fehlt die fachliche Rückmeldung.',
        'Ich habe den Vorgang bereits geschlossen.',
        'Die Antwort wurde bereits versendet.',
        'Der Bestand wurde bereits geändert.',
      ].join('\n\n')
    )
    .mockResolvedValueOnce(
      [
        '## Anlass\n\nFür den Zielvorgang fehlt die fachliche Rückmeldung.',
        '## Gesicherter Stand\n\nNur die Transportquittung liegt vor.',
        '## Offene Punkte\n\nDie fachliche Rückmeldung ist weiterhin offen.',
      ].join('\n\n')
    );
  llm.generateStructured.mockImplementation(async (schema, raw) => {
    const input = JSON.parse(raw);
    return {
      paragraphs: input.paragraphs.map(({ index, text }) => ({
        index,
        kind: 'statement',
        origin: 'input',
        evidenceIds: [],
        ruleClaim: false,
        completedAction: /bereits/u.test(text),
        specific: false,
      })),
    };
  });
  const result = await answer({
    situation: { ...situation, requestedOutput: parkNote },
    retrieval: { evidence },
    message: `Parke den Vorgang. Ich brauche eine ${parkNote.basis}.`,
    tenantId: 't',
  });
  expect(llm.generateText).toHaveBeenCalledTimes(2);
  const second = llm.generateText.mock.calls[1];
  expect(second[1].responseMimeType).toBe('text/plain');
  expect(JSON.parse(second[0]).repairInstruction).toBeTruthy();
  expect(result.answerStatus).not.toBe('fallback');
  expect(result.responseText).toContain('Nur die Transportquittung liegt vor.');
  expect(result.responseText).not.toContain('bereits');
});
