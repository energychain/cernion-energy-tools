'use strict';
jest.mock('../src/llm-client', () => ({ generateText: jest.fn(), generateStructured: jest.fn() }));
const llm = require('../src/llm-client');
const { answer, understand, questionsFor } = require('../src/workbench-understanding');
const { persistentSituation } = require('../src/workbench-turn-scope');
const shape = require('../src/workbench-conversation-shape');
const claim = (text) => ({
  text,
  origin: 'model',
  supported: 'model',
  specific: false,
  completedAction: false,
  evidenceIds: [],
});
const situation = (conversationShape = 'orientation') => ({
  concern: 'Systemkenntnis',
  situation: '',
  participants: [],
  identifiers: [],
  deadlines: [],
  hypotheses: [],
  missingInformation: [],
  requestedAction: { description: '', draftRequested: false, externalEffect: false },
  turnKind: 'knowledge',
  retrievalTerms: [],
  conversationShape,
});
beforeEach(() => jest.resetAllMocks());

test.each(['orientation', 'knowledge', 'filing'])(
  '%s omits internal expectations, assumptions and steps even when generated',
  async (kind) => {
    llm.generateText.mockResolvedValue(
      JSON.stringify({
        interpretation: [claim('Ich kann dir fachlich dabei helfen.')],
        expectation: [claim('Der Nutzer erwartet Hilfe.')],
        assumptions: [claim('Es liegt ein Klärungsbedarf vor.')],
        nextSteps: [claim('Prüfe deinen Bedarf.')],
        draft: [claim('Guten Tag, hier ist der Entwurf.')],
      })
    );
    const result = await answer({
      situation: situation(kind),
      retrieval: { evidence: [] },
      tenantId: 'synthetic',
    });
    expect(result.responseText).toBe('Ich kann dir fachlich dabei helfen.');
    expect(result.draft).toBe('');
  }
);
test('task preserves concrete results, steps and drafts, never expectation', async () => {
  llm.generateText.mockResolvedValue(
    JSON.stringify({
      interpretation: [claim('Die Antwort steht aus.')],
      expectation: [claim('Der Anfragende erwartet eine Antwort.')],
      nextSteps: [claim('Prüfe den dokumentierten Eingang.')],
      draft: [claim('Guten Tag, wir benötigen den Bearbeitungsstand zur dokumentierten Anfrage.')],
    })
  );
  const result = await answer({
    situation: { ...situation('task'), turnKind: 'work' },
    retrieval: { evidence: [] },
    tenantId: 'synthetic',
  });
  expect(result.responseText).toContain('Prüfe den dokumentierten Eingang.');
  expect(result.draft).toContain('wir benötigen');
  expect(result.responseText).not.toMatch(/Anfragende/);
});
test('purpose question with options is natural, single and not repeated by key or wording', () => {
  const question = {
    key: 'purpose',
    reason: 'purpose',
    question: 'Geht es dir um Überblick, Prüfung oder einen Entwurf?',
    blocking: false,
  };
  const current = {
    ...situation(),
    missingInformation: [
      question,
      { ...question, key: 'other' },
      { key: 'bad', decisive: true, question: 'Nenne mir deine Rolle?', blocking: true },
    ],
  };
  expect(questionsFor(current)).toEqual([question]);
  expect(questionsFor(current, [question])).toEqual([]);
  expect(questionsFor({ missingInformation: [{ ...question, answered: true }] })).toEqual([]);
});
test('followup uses grounded context and retains it independently of turn shape', async () => {
  const first = {
    ...situation(),
    missingInformation: [
      { key: 'purpose', question: 'Überblick oder Prüfung?', blocking: false, reason: 'purpose' },
    ],
  };
  llm.generateStructured.mockResolvedValue({
    ...situation('knowledge'),
    conversationContext: {
      goal: 'Überblick',
      role: 'Netzabrechnung',
      preference: '',
      basis: 'Ich bin in der Netzabrechnung und möchte einen Überblick.',
      durable: true,
    },
    missingInformation: [{ ...first.missingInformation[0], answered: false }],
  });
  const current = await understand({
    message: 'Ich bin in der Netzabrechnung und möchte einen Überblick.',
    previous: first,
  });
  expect(current.missingInformation[0].answered).toBe(true);
  expect(current.conversationContext.role).toBe('Netzabrechnung');
  const memory = persistentSituation(current);
  expect(memory.conversationContext.goal).toBe('Überblick');
  expect(memory.conversationShape).toBeUndefined();
});
test('response boundary coordinates questions from independent contributors', () => {
  const primary = { key: 'purpose', question: 'Überblick oder Prüfung?' };
  const result = shape.singleQuestion(
    'Kurzer Überblick.\n\nÜberblick oder Prüfung?\n\nWelcher Fall?',
    [primary],
    'Welcher Fall?'
  );
  expect(result.responseText).toBe('Kurzer Überblick.\n\nWelcher Fall?');
  expect(result.questions).toEqual([]);
});

test('mail filing keeps its outer request and is never converted to a table', () => {
  const corpus = require('./fixtures/workbench-813.generated.json');
  const message = corpus.find((scenario) => scenario.id === 'filing').turns[0].message;
  const parsed = require('../src/workbench-document-input').documentInput(message);
  expect(parsed.question).toBe(message);
  expect(parsed.documents).toEqual([]);
});
test('a task never acquires an additional purpose question', () => {
  expect(
    questionsFor({
      ...situation('task'),
      missingInformation: [
        {
          key: 'purpose',
          reason: 'purpose',
          blocking: true,
          question: 'Überblick, Prüfung oder Entwurf?',
        },
      ],
    })
  ).toEqual([]);
});

test.each([false, true])(
  'an unresolved code asks naturally; actual provider failure=%s stays degraded',
  async (failed) => {
    const current = {
      ...situation('task'),
      codeResolutions: [{ kind: 'reference', value: 'X7', status: 'unavailable' }],
      missingInformation: [
        { key: 'code:X7', question: 'Was steht zu X7 in der Nachricht?', blocking: true },
      ],
    };
    if (failed) llm.generateText.mockRejectedValue(new Error('Synthetic provider timeout'));
    else
      llm.generateText.mockResolvedValue(
        JSON.stringify({
          interpretation: [claim('X7 erklärt den offenen Punkt.')],
          expectation: [],
          nextSteps: [],
          draft: [],
        })
      );
    const result = await answer({
      situation: current,
      retrieval: { evidence: [] },
      tenantId: 'synthetic',
    });
    expect(result.responseText).toContain('Was steht zu X7 in der Nachricht?');
    expect(result.metadata.degraded).toBe(failed);
    if (!failed) expect(result.responseText).not.toContain('Das Modell ist gerade nicht verfügbar');
  }
);

test('one repair fixes a natural question and literal tenant-memory basis together', async () => {
  const message = require('./fixtures/tenant-memory.json').first.text;
  const current = {
    ...situation('task'),
    turnKind: 'work',
    missingInformation: [
      { key: 'role', question: 'Nenne mir deine Rolle?', reason: 'decisive', blocking: false },
    ],
    tenantMemory: {
      assertions: [
        {
          text: message,
          basis: 'Synthetische Zusammenfassung ohne wörtliche Grundlage',
          commitment: 'planned',
          anchors: [{ value: 'Hauptstraße', qualifier: '', aliases: [] }],
          time: { from: '', until: '', latest: '2030', earliest: '', date: '' },
          expiresAt: '',
        },
      ],
      correction: { kind: 'none', basis: '', factId: '' },
      query: { requested: false, anchor: '', functionLabel: '' },
    },
  };
  const repaired = structuredClone(current);
  repaired.missingInformation[0].question = 'Welche Rolle hast du – Planung oder Betrieb?';
  repaired.tenantMemory.assertions[0].basis = message;
  llm.generateStructured.mockResolvedValueOnce(current).mockResolvedValueOnce(repaired);
  const result = await understand({ message, tenantId: 'synthetic' });
  expect(llm.generateStructured).toHaveBeenCalledTimes(2);
  const prompt = JSON.parse(llm.generateStructured.mock.calls[1][1]);
  expect(prompt.repairInstruction).toContain('natürliche Frage');
  expect(prompt.repairInstruction).toContain('wörtliches Belegstück');
  expect(result.tenantMemory.assertions[0].basis).toBe(message);
  expect(questionsFor(result)[0].question).toBe(repaired.missingInformation[0].question);
});

test('combined semantic task repairs a filtered requested draft instead of accepting only steps', async () => {
  const empty = {
    interpretation: [claim('Eine fachliche Rückmeldung steht aus.')],
    nextSteps: [claim('Prüfe den dokumentierten Bearbeitungsstand.')],
    draft: [],
    expectation: [],
  };
  llm.generateText.mockResolvedValueOnce(JSON.stringify(empty)).mockResolvedValueOnce(
    JSON.stringify({
      ...empty,
      draft: [
        claim(
          'Guten Tag, bitte teilen Sie den aktuellen Bearbeitungsstand zur Anfrage mit. Freundliche Grüße'
        ),
      ],
    })
  );
  const result = await answer({
    situation: {
      ...situation('task'),
      turnKind: 'work',
      requestedAction: {
        description: 'Zusammenfassung und Antwortentwurf',
        draftRequested: true,
        externalEffect: false,
      },
    },
    message:
      'Fasse den Verlauf zusammen und erstelle einen Antwortentwurf.\nSynthetischer Schriftwechsel.',
    retrieval: { evidence: [] },
    tenantId: 'synthetic',
  });
  expect(llm.generateText).toHaveBeenCalledTimes(2);
  expect(result.draft).toContain('Bearbeitungsstand');
  expect(result.responseText).toContain('Entwurf:');
  expect(result.metadata.degraded).toBe(false);
});

test('next-step followup does not repeat an inherited semantic draft request', async () => {
  llm.generateText.mockResolvedValue(
    JSON.stringify({
      interpretation: [claim('Der Bearbeitungsstand ist noch offen.')],
      expectation: [],
      nextSteps: [claim('Prüfe den dokumentierten Bearbeitungsstand.')],
      draft: [],
    })
  );
  const result = await answer({
    situation: {
      ...situation('task'),
      turnKind: 'work',
      requestedAction: {
        description: 'Antwortentwurf',
        draftRequested: true,
        externalEffect: false,
      },
    },
    message: 'Was ist der nächste Schritt?',
    nextStepOnly: true,
    retrieval: { evidence: [] },
    tenantId: 'synthetic',
  });
  expect(llm.generateText).toHaveBeenCalledTimes(1);
  expect(result.draft).toBe('');
  expect(result.metadata.degraded).toBe(false);
});

test('semantic draft request with an unresolved code keeps the safe colleague question', async () => {
  llm.generateText.mockResolvedValue(
    JSON.stringify({
      interpretation: [claim('Der genannte Code ist noch nicht geklärt.')],
      expectation: [],
      nextSteps: [],
      draft: [],
    })
  );
  const result = await answer({
    situation: {
      ...situation('task'),
      turnKind: 'work',
      requestedAction: {
        description: 'Antwortentwurf',
        draftRequested: true,
        externalEffect: false,
      },
      codeResolutions: [{ kind: 'reference', value: 'Q77', status: 'unavailable' }],
      missingInformation: [
        {
          key: 'code-q77',
          question: 'Steht Q77 hier für einen internen Status oder einen Ablehnungsgrund?',
          reason: 'decisive',
          decisive: true,
          answered: false,
        },
      ],
    },
    message: 'Hilf mir mit der Reklamation zum unbekannten Code Q77.',
    retrieval: { evidence: [] },
    tenantId: 'synthetic',
  });
  expect(result.responseText).toContain('Steht Q77');
  expect(result.draft).toBe('');
  expect(result.metadata.degraded).toBe(false);
});

test.each([
  ['Die Anlage wurde vor dem 15.02.2025 gestartet.', ['Seit dem 15.02.2025 unverändert.'], true],
  ['Die Anlage wurde vor dem 2025-02-15 gestartet.', ['Seit dem 15.02.2025 unverändert.'], true],
  [
    'Wenn die Anlage vor dem 15.02.2025 gestartet wurde, gilt diese Variante.',
    ['Seit dem 15.02.2025 unverändert.'],
    false,
  ],
  [
    'Die Anlage wurde vor dem 15.02.2025 gestartet.',
    ['Seit dem 15.02.2025 unverändert.', 'Sie wurde vor dem 15.02.2025 gestartet.'],
    false,
  ],
])('temporal grounding: %s', (value, facts, rejected) => {
  expect(require('../src/workbench-answer-filter').unsupportedEarlierDate(value, facts)).toBe(
    rejected
  );
});

test('understanding repairs an ungrounded earlier start while keeping the supplied date fact', async () => {
  const current = {
    ...situation('assistance'),
    concern: 'Betrieb vor dem 15.02.2025',
    situation: 'Die Anlage wurde vor dem 15.02.2025 gestartet.',
  };
  const repaired = {
    ...current,
    concern: 'Aktueller Betrieb',
    situation: 'Seit dem 15.02.2025 unverändert; der Start ist nicht genannt.',
  };
  llm.generateStructured.mockResolvedValueOnce(current).mockResolvedValueOnce(repaired);
  const result = await understand({
    message: 'Seit dem 15.02.2025 wurde nichts geändert.',
    tenantId: 'synthetic',
  });
  expect(llm.generateStructured).toHaveBeenCalledTimes(2);
  expect(JSON.parse(llm.generateStructured.mock.calls[1][1]).repairInstruction).toContain(
    'früheren Start'
  );
  expect(result.situation).toContain('Start ist nicht genannt');
});

test.each(['closing', 'summary'])(
  'combined work repairs missing %s and preserves both requested results',
  async (missing) => {
    const full = {
      expectation: [],
      interpretation: [claim('Die Eingangsbestätigung beantwortet die Sachfrage noch nicht.')],
      nextSteps: [claim('Prüfe den dokumentierten Stand.')],
      draft: [
        claim(
          'Guten Tag, bitte teilen Sie den aktuellen Bearbeitungsstand zur Anfrage mit. Freundliche Grüße'
        ),
      ],
    };
    const incomplete = structuredClone(full);
    if (missing === 'closing')
      incomplete.draft[0].text =
        'Guten Tag, bitte teilen Sie den aktuellen Bearbeitungsstand zur Anfrage mit.';
    else incomplete.interpretation = [];
    llm.generateText
      .mockResolvedValueOnce(JSON.stringify(incomplete))
      .mockResolvedValueOnce(JSON.stringify(full));
    const result = await answer({
      situation: {
        ...situation('task'),
        turnKind: 'work',
        requestedAction: {
          description: 'Zusammenfassung und Entwurf',
          draftRequested: true,
          externalEffect: false,
        },
      },
      message: 'Fasse diesen synthetischen Verlauf zusammen und erstelle einen Antwortentwurf.',
      retrieval: { evidence: [] },
      tenantId: 'synthetic',
    });
    expect(llm.generateText).toHaveBeenCalledTimes(2);
    expect(result.responseText).toContain('Eingangsbestätigung');
    expect(result.draft).toContain('Freundliche Grüße');
    expect(JSON.parse(llm.generateText.mock.calls[1][0]).repairInstruction).toContain(
      'Zusammenfassung'
    );
    expect(result.metadata.degraded).toBe(false);
  }
);

test.each([
  [
    'Wurden die Geräte vor dem Stichtag gestartet und verfügen sie über die nötige Leistung?',
    false,
  ],
  ['Wann begann das Projekt und wie hoch ist das Budget?', false],
  ['Geht es dir um Überblick und Prüfung oder einen Entwurf?', true],
  ['Liegt die Leistung über dem Schwellenwert?', true],
])('question asks one independent point: %s', (question, natural) => {
  expect(shape.naturalQuestion(question)).toBe(natural);
});

test('understanding repairs coordinated questions into separately keyed unknowns', async () => {
  const current = {
    ...situation('assistance'),
    missingInformation: [
      {
        key: 'start-and-power',
        question:
          'Wurden die Geräte vor dem Stichtag gestartet und verfügen sie über die nötige Leistung?',
        decisive: true,
        answered: false,
        blocking: false,
        reason: 'decisive',
      },
    ],
  };
  const repaired = {
    ...current,
    missingInformation: [
      {
        key: 'start',
        question: 'Wann wurden die Geräte gestartet?',
        decisive: true,
        answered: false,
        blocking: false,
        reason: 'decisive',
      },
      {
        key: 'power',
        question: 'Wie hoch ist die Leistung?',
        decisive: true,
        answered: false,
        blocking: false,
        reason: 'decisive',
      },
    ],
  };
  llm.generateStructured.mockResolvedValueOnce(current).mockResolvedValueOnce(repaired);
  const result = await understand({
    message: 'Hilf mir beim Gespräch über diese Geräte.',
    tenantId: 'synthetic',
  });
  expect(llm.generateStructured).toHaveBeenCalledTimes(2);
  expect(JSON.parse(llm.generateStructured.mock.calls[1][1]).repairInstruction).toContain(
    'getrennten stabilen keys'
  );
  expect(questionsFor(result).map((item) => item.key)).toEqual(['start']);
});
