'use strict';

jest.mock('../src/llm-client', () => ({ generateText: jest.fn(), generateStructured: jest.fn() }));
const llm = require('../src/llm-client');
const { answer, understand, questionsFor } = require('../src/workbench-understanding');
const { updatePersonFacts, markParagraphs } = require('../src/workbench-conversation-mode');
const { sourceLine } = require('../src/workbench-answer-evidence');
const fixture = require('./fixtures/workbench-758.json');
const situation = {
  concern: 'Berechtigung im laufenden Gespräch klären.',
  situation: '',
  participants: ['Beratende Person', 'Gegenüber'],
  identifiers: [],
  deadlines: [],
  hypotheses: [],
  missingInformation: [],
  requestedAction: {
    description: 'Berechtigung klären.',
    externalEffect: false,
    draftRequested: true,
  },
  turnKind: 'work',
  retrievalTerms: [],
};
const claim = (text) => ({
  text,
  origin: 'model',
  supported: 'model',
  specific: false,
  completedAction: false,
  evidenceIds: [],
});
beforeEach(() => {
  llm.generateText.mockReset();
  llm.generateStructured.mockReset();
});

test('decisive questions precede blocking questions; answered questions and prior questions are excluded', () => {
  const items = [
    { key: 'ordinary', question: 'Welches Datum steht im Schreiben?', blocking: true },
    {
      key: 'start',
      question: 'Wann wurde die Anlage in Betrieb genommen?',
      decisive: true,
      blocking: false,
    },
    {
      key: 'agreement',
      question: 'Welche Vereinbarung besteht bereits?',
      decisive: true,
      blocking: false,
    },
    {
      key: 'power',
      question: 'Welche Leistung in kW ist angegeben?',
      decisive: true,
      blocking: false,
    },
    { key: 'answered', question: 'Wurde etwas geändert?', decisive: true, answered: true },
  ];
  expect(questionsFor({ missingInformation: items }).map((item) => item.key)).toEqual(['start']);
  expect(questionsFor({ missingInformation: items }, [items[1]]).map((item) => item.key)).toEqual([
    'agreement',
  ]);
});

test('three synthetic turns keep live mode and facts; energy cannot answer a power threshold', async () => {
  let previous;
  for (let index = 0; index < fixture.liveTurns.length; index++) {
    llm.generateStructured.mockResolvedValue({
      ...structuredClone(situation),
      responseMode: 'conversation',
      missingInformation:
        index === 0
          ? [
              {
                key: 'start',
                question: 'Wann wurde die Anlage in Betrieb genommen?',
                decisive: true,
                blocking: false,
              },
              {
                key: 'agreement',
                question: 'Welche Vereinbarung besteht bereits?',
                decisive: true,
                blocking: false,
              },
              {
                key: 'power',
                question: 'Welche Leistung in kW ist angegeben?',
                decisive: true,
                blocking: false,
              },
            ]
          : [
              {
                key: 'changed',
                question: 'Wurde etwas geändert?',
                decisive: true,
                blocking: false,
                answered: true,
              },
            ],
      quantities:
        index === 2
          ? [
              {
                key: 'Speicher',
                value: '6',
                unit: 'kWh',
                dimension: 'power',
                expectedDimension: 'power',
              },
              {
                key: 'Wallbox',
                value: '11',
                unit: 'kW',
                dimension: 'power',
                expectedDimension: 'power',
              },
            ]
          : [],
    });
    const current = await understand({ message: fixture.liveTurns[index], previous });
    llm.generateText.mockResolvedValue(
      JSON.stringify({
        expectation: [],
        nextSteps: [],
        interpretation: [
          claim(
            index === 2
              ? 'Die genannte Energiemenge ersetzt den noch fehlenden Leistungswert nicht.'
              : 'Die Berechtigung hängt von den noch offenen Angaben ab.'
          ),
        ],
        assumptions: [claim('Ich gehe von einer neuen Inbetriebnahme aus.')],
        draft: [claim('Guten Tag, bitte senden Sie die Angaben. Mit freundlichen Grüßen')],
      })
    );
    const reply = await answer({
      situation: current,
      retrieval: { evidence: [] },
      message: fixture.liveTurns[index],
      followup: Boolean(previous),
    });
    expect(current.responseMode).toBe('conversation');
    expect(reply.draft).toBe('');
    expect(reply.responseText).not.toContain('Inbetriebnahme aus');
    if (index === 0)
      expect(reply.responseText.indexOf('Wann wurde')).toBeLessThan(
        reply.responseText.indexOf('Die Berechtigung')
      );
    if (index === 2) {
      expect(reply.responseText).toContain('6 kWh');
      expect(reply.responseText).toContain('Leistung in kW');
      expect(reply.questions.some((item) => item.key === 'changed')).toBe(false);
      expect(current.personFacts).toEqual(fixture.liveTurns);
    }
    const prompt = JSON.parse(llm.generateText.mock.calls.at(-1)[0]);
    expect(prompt.conversationInstruction).toContain('kein Brief');
    expect(prompt.instruction).toContain('niemals annehmen');
    previous = current;
  }
});

test('mail thread switches to correspondence and explicit draft still wins over next-step state', async () => {
  const current = updatePersonFacts(
    { ...structuredClone(situation), responseMode: 'correspondence' },
    fixture.mail,
    {
      responseMode: 'conversation',
    }
  );
  expect(current.responseMode).toBe('correspondence');
  llm.generateText.mockResolvedValue(
    JSON.stringify({
      expectation: [],
      nextSteps: [],
      draft: [
        claim(
          'Guten Tag, bitte teilen Sie uns den dokumentierten Stand mit. Mit freundlichen Grüßen'
        ),
      ],
    })
  );
  const reply = await answer({
    situation: current,
    message: fixture.draftTurns[1],
    nextStepOnly: true,
    retrieval: { evidence: [] },
  });
  expect(reply.draft).toContain('dokumentierten Stand');
  expect(JSON.parse(llm.generateText.mock.calls[0][0]).nextStepInstruction).toBe('');
});

test.each([
  Object.assign(new Error('quota'), { status: 429 }),
  Object.assign(new Error('unavailable'), { status: 503 }),
  new Error('timeout'),
  null,
])('provider or empty response yields honest findings and stored facts', async (error) => {
  const current = updatePersonFacts(structuredClone(situation), fixture.liveTurns[2], {
    personFacts: [fixture.liveTurns[1]],
  });
  if (error) llm.generateText.mockRejectedValue(error);
  else
    llm.generateText.mockResolvedValue(
      JSON.stringify({ expectation: [], nextSteps: [], draft: [] })
    );
  const reply = await answer({
    situation: current,
    retrieval: {
      evidence: [
        {
          source: 'knowledge',
          title: 'E_0622.json',
          metadata: { documentTitle: 'Voraussetzungen der Teilnahme' },
          value: 'Für die Einordnung sind Inbetriebnahme und bestehende Vereinbarung zu klären.',
        },
      ],
    },
  });
  expect(reply.responseText).toContain('Modell ist gerade nicht verfügbar');
  expect(reply.responseText).toContain('Voraussetzungen der Teilnahme');
  expect(reply.responseText).toContain('bestehende Vereinbarung');
  expect(reply.responseText).toContain('6 kWh');
  expect(reply.responseText).toContain('Seit dem 01.01.2024');
  expect(reply.responseText).not.toMatch(/Als Nächstes:|\[Ergebnis|\.json/);
  expect(reply.draft).toBe('');
  expect(reply.metadata).toMatchObject({ degraded: true, degradedReason: expect.any(String) });
});

test('source names prefer metadata titles and reject filenames, UUIDs and technical IDs', () => {
  const uuid = '640f0811-0000-4000-8000-000000000000';
  const line = sourceLine([
    {
      title: 'E_0622.json',
      source: 'knowledge',
      metadata: { title: 'Lesbarer Dokumenttitel', sectionId: 'Abschnitt 2' },
    },
    { title: 'E_0608.json', source: 'knowledge' },
    { title: uuid, source: uuid, sectionId: uuid },
  ]);
  expect(line).toContain('Lesbarer Dokumenttitel · Abschnitt 2');
  expect(line).not.toMatch(/Wissensquelle|knowledge/);
  expect(line).not.toMatch(/E_0|\.json|640f0811/);
});

test('marker is at most once per paragraph and never on salutation, greeting or signature', () => {
  const letter =
    'Guten Tag, (bitte gegenprüfen)\n\nEine Angabe (bitte gegenprüfen). Eine zweite (bitte gegenprüfen).\n\nMit freundlichen Grüßen (bitte gegenprüfen)\nIhr Kundenservice (bitte gegenprüfen)';
  const rendered = markParagraphs(letter, true);
  expect(rendered.match(/\(bitte gegenprüfen\)/g) || []).toHaveLength(1);
  expect(rendered).toContain('Ihr Kundenservice');
  expect(rendered).not.toMatch(/(?:Guten Tag,|Grüßen|Kundenservice) \(bitte gegenprüfen\)/);
});

test('a corrected physical dimension answers the prior mismatch without deriving a value', () => {
  const previous = updatePersonFacts(
    {
      ...structuredClone(situation),
      quantities: [{ key: 'quantity', value: '6', unit: 'kWh', expectedDimension: 'power' }],
    },
    'Gemeldet wurden 6 kWh.'
  );
  const current = updatePersonFacts(
    {
      ...structuredClone(situation),
      quantities: [{ key: 'quantity', value: '4', unit: 'kW', expectedDimension: 'power' }],
    },
    'Die benötigte Größe ist 4 kW.',
    previous
  );
  expect(current.quantities).toMatchObject([{ value: '4', unit: 'kW', dimension: 'power' }]);
  expect(
    current.missingInformation.find((item) => item.key === 'dimension:quantity').answered
  ).toBe(true);
  expect(questionsFor(current)).toHaveLength(0);
});

test('separate letter claims keep the signature free of markers after joining', async () => {
  llm.generateText.mockResolvedValue(
    JSON.stringify({
      expectation: [],
      nextSteps: [],
      draft: [
        claim('Guten Tag,'),
        { ...claim('Eine prüfbare Angabe ist noch offen.'), specific: true },
        { ...claim('Mit freundlichen Grüßen'), specific: true },
        { ...claim('Team Service'), specific: true },
      ],
    })
  );
  const reply = await answer({ situation, retrieval: { evidence: [] }, message: 'Entwurf bitte' });
  expect(reply.draft).not.toContain('Team Service (bitte gegenprüfen)');
  expect(reply.draft.match(/\(bitte gegenprüfen\)/g) || []).toHaveLength(1);
});

test('answer block guard consolidates multiple unchecked paragraphs and drops unsolicited markers on grounded claims', async () => {
  const specific = (text) => ({ ...claim(text), specific: true });
  llm.generateText.mockResolvedValue(
    JSON.stringify({
      interpretation: [specific('Der Wert beträgt 41.'), specific('Die Frist beträgt 7 Tage.')],
      expectation: [],
      nextSteps: [specific('Prüfe die Zahl 13.'), specific('Prüfe die Zahl 17.')],
      draft: [],
    })
  );
  const reply = await answer({
    situation: {
      ...situation,
      requestedAction: { ...situation.requestedAction, draftRequested: false },
    },
    retrieval: { evidence: [] },
  });
  expect(reply.responseText.match(/\(bitte gegenprüfen\)/gu)).toHaveLength(2);
  expect(reply.responseText).toContain('Die Frist beträgt 7 Tage. (bitte gegenprüfen)');
  expect(reply.responseText).toContain('Prüfe die Zahl 17. (bitte gegenprüfen)');
  expect(reply.responseText).not.toContain('41. (bitte gegenprüfen)');
  llm.generateText.mockResolvedValue(
    JSON.stringify({
      expectation: [claim('Allgemeine Einordnung. (bitte gegenprüfen)')],
      nextSteps: [],
      draft: [],
    })
  );
  const grounded = await answer({
    situation: {
      ...situation,
      requestedAction: { ...situation.requestedAction, draftRequested: false },
    },
    retrieval: { evidence: [] },
  });
  expect(grounded.responseText).not.toContain('gegenprüfen');
});
