'use strict';

jest.mock('../src/llm-client', () => ({ generateText: jest.fn(), generateStructured: jest.fn() }));
const llm = require('../src/llm-client');
const { answer, understand } = require('../src/workbench-understanding');
const { situationReference } = require('../src/workbench-answer-evidence');
const { captureCodes } = require('../src/workbench-codes');
const situation = {
  concern: 'Rückmeldung zur Anfrage fehlt.',
  situation: 'Die anfragende Rolle benötigt den dokumentierten Stand.',
  participants: ['Anfragende Rolle', 'Empfangende Rolle'],
  identifiers: [],
  deadlines: [],
  hypotheses: [],
  missingInformation: [],
  requestedAction: {
    description: 'Den dokumentierten Stand klären.',
    draftRequested: true,
    externalEffect: false,
  },
  turnKind: 'work',
  retrievalTerms: [],
};
const claim = (text, condition = '') => ({
  text,
  condition,
  supported: 'model',
  completedAction: false,
  specific: false,
  evidenceIds: [],
});
const valid = claim(
  'Guten Tag, bitte teilen Sie uns den dokumentierten Bearbeitungsstand Ihrer Anfrage mit. Mit freundlichen Grüßen',
  'der Stand noch offen ist'
);
const invalid = claim('Hiermit bestätigen wir die Netzanmeldung.', 'die Anmeldung vorliegt');
const response = (draft) => JSON.stringify({ expectation: [], nextSteps: [], draft });
const logger = () => ({ info: jest.fn(), warn: jest.fn() });
beforeEach(() => {
  llm.generateText.mockReset();
  llm.generateStructured.mockReset();
});
const draftAnswer = (log = logger()) =>
  answer({
    situation,
    retrieval: { evidence: [] },
    message: 'Mach mir die Antwort fertig',
    followup: true,
    logger: log,
  });

test('one unsafe variant cannot discard the other variant; logs once with rule counts and no text', async () => {
  const log = logger();
  llm.generateText.mockResolvedValue(response([invalid, valid]));
  const result = await draftAnswer(log);
  expect(result.draft).toContain('Bearbeitungsstand');
  expect(result.draft).not.toContain('bestätigen');
  expect(result.answerAttempts).toBe(1);
  expect(
    log.info.mock.calls.filter(([message]) => message === 'Workbench answer filters')
  ).toHaveLength(1);
  expect(log.info.mock.calls[0][1]).toMatchObject({
    filters: expect.arrayContaining([{ field: 'draft', rule: 'binding_draft', count: 1 }]),
  });
  expect(JSON.stringify(log.info.mock.calls)).not.toContain('Netzanmeldung');
});

test('an essential rejected paragraph removes only its entire condition group', async () => {
  llm.generateText.mockResolvedValue(
    response([
      invalid,
      claim(
        'Dieser Absatz darf nicht als Rest der ungültigen Variante stehen bleiben.',
        invalid.condition
      ),
      valid,
    ])
  );
  const result = await draftAnswer();
  expect(result.draft).toContain('Bearbeitungsstand');
  expect(result.draft).not.toContain('Rest der ungültigen');
});

test('all variants rejected triggers exactly one targeted repair and delivers its complete draft', async () => {
  const log = logger();
  llm.generateText
    .mockResolvedValueOnce(response([invalid]))
    .mockResolvedValueOnce(response([valid]));
  const result = await draftAnswer(log);
  expect(result.draft).toContain('Bearbeitungsstand');
  expect(result.answerAttempts).toBe(2);
  const repair = JSON.parse(llm.generateText.mock.calls[1][0]);
  expect(repair.repairInstruction).toContain('Keine verbindliche Prozessantwort');
  expect(repair.repairInstruction).not.toContain(invalid.text);
  expect(
    log.info.mock.calls.filter(([message]) => message === 'Workbench answer filters')
  ).toHaveLength(1);
});

test('two rejected outputs use natural draft fallback with known facts and logged reason', async () => {
  const log = logger();
  llm.generateText.mockResolvedValue(response([invalid]));
  const result = await draftAnswer(log);
  expect(result.draft).toBe('');
  expect(result.responseText).toContain('Entwurf ist gerade nicht sauber');
  expect(result.responseText).toContain('Rückmeldung zur Anfrage');
  expect(result.responseText).not.toContain('Als Nächstes:');
  expect(log.info.mock.calls).toEqual(
    expect.arrayContaining([
      ['Workbench answer fallback', expect.objectContaining({ fallbackReason: 'draft_filtered' })],
    ])
  );
  expect(JSON.stringify(log.info.mock.calls)).not.toContain(invalid.text);
});

test('greeting-only drafts repair once and never escape as a usable draft', async () => {
  const log = logger();
  llm.generateText.mockResolvedValue(response([claim('Guten Tag,\n\nMit freundlichen Grüßen')]));
  const result = await draftAnswer(log);
  expect(result.draft).toBe('');
  expect(result.answerAttempts).toBe(2);
  expect(JSON.stringify(log.info.mock.calls)).toContain('greeting_only');
});

test.each(['empty', 'skipped'])('fallback is observable without an exception: %s', async (mode) => {
  const log = logger();
  llm.generateText.mockResolvedValue(response([]));
  const result = await answer({
    situation: {
      ...situation,
      requestedAction: { ...situation.requestedAction, draftRequested: false },
    },
    retrieval: { evidence: [] },
    skipModel: mode === 'skipped',
    logger: log,
  });
  expect(result.answerStatus).toBe('fallback');
  expect(log.info.mock.calls).toEqual(
    expect.arrayContaining([
      [
        'Workbench answer fallback',
        expect.objectContaining({
          fallbackReason: mode === 'skipped' ? 'understanding_unavailable' : 'no_accepted_content',
        }),
      ],
    ])
  );
});

test('understanding repairs an AJV schema error once using the same controller', async () => {
  const log = logger();
  llm.generateStructured
    .mockResolvedValueOnce({ ...situation, participants: 'private@example.org' })
    .mockResolvedValueOnce(situation);
  const result = await understand({
    message: 'Eine konkrete Anfrage ist zu bearbeiten.',
    logger: log,
  });
  expect(result.concern).toBe(situation.concern);
  expect(llm.generateStructured).toHaveBeenCalledTimes(2);
  expect(JSON.parse(llm.generateStructured.mock.calls[1][1]).repairInstruction).toBeTruthy();
  expect(log.info.mock.calls).toEqual(
    expect.arrayContaining([
      [
        'Workbench schema rejection',
        expect.objectContaining({
          schemaErrors: [{ instancePath: '/participants', keyword: 'type' }],
        }),
      ],
    ])
  );
  expect(JSON.stringify([...log.info.mock.calls, ...log.warn.mock.calls])).not.toContain(
    'private@example.org'
  );
});

test('understanding recognizes facade schema errors and logs exhausted fallback', async () => {
  const log = logger();
  llm.generateStructured.mockRejectedValue(new Error('LLM response failed schema validation'));
  await expect(
    understand({ message: 'Eine konkrete Anfrage ist zu bearbeiten.', logger: log })
  ).rejects.toThrow();
  expect(llm.generateStructured).toHaveBeenCalledTimes(2);
  expect(log.info.mock.calls).toEqual(
    expect.arrayContaining([
      [
        'Workbench understanding fallback',
        expect.objectContaining({ fallbackReason: 'schema_validation' }),
      ],
    ])
  );
});

test('postal codes and reference fragments cannot enter identifiers; full typed references render', async () => {
  const identifiers = [
    { kind: 'MaLo', value: '50855117576' },
    { kind: 'PLZ', value: '37170' },
    { kind: 'Prozessreferenz', value: 'PSUTI' },
    { kind: 'Prozessreferenz', value: 'PSUTI-2026/1234' },
  ];
  llm.generateStructured.mockResolvedValue({ ...situation, identifiers });
  const result = await understand({
    message: 'MaLo 50855117576, Adresse in 37170 Ort, Prozessreferenz PSUTI-2026/1234.',
    logger: logger(),
  });
  expect(result.identifiers).toEqual([identifiers[0], identifiers[3]]);
  expect(situationReference(result)).toBe('MaLo: 50855117576, Prozessreferenz: PSUTI-2026/1234');
  expect(captureCodes('MaLo 50855117576, Adresse 37170, Referenz PSUTI-2026/1234.')).toEqual([]);
  expect(
    situationReference({ identifiers: [{ kind: 'Prozessreferenz', value: 'X'.repeat(300) }] })
  ).toBe('');
});

test('shared paragraphs never survive as an orphan of rejected conditional variants', async () => {
  llm.generateText.mockResolvedValue(
    response([
      claim('Guten Tag, bitte beziehen Sie sich auf Ihre ursprüngliche Anfrage.'),
      invalid,
      claim('Mit freundlichen Grüßen'),
    ])
  );
  const result = await draftAnswer();
  expect(result.draft).toBe('');
  expect(result.answerAttempts).toBe(2);
});

test('answer schema diagnostics contain paths and keywords without values', async () => {
  const log = logger();
  llm.generateText
    .mockResolvedValueOnce(
      JSON.stringify({
        expectation: [],
        nextSteps: [],
        draft: [{ text: 'secret@example.org', supported: 'private value' }],
      })
    )
    .mockResolvedValueOnce(response([valid]));
  await draftAnswer(log);
  const entries = log.info.mock.calls.filter(
    ([message]) => message === 'Workbench schema rejection'
  );
  expect(entries[0][1].schemaErrors).toEqual(
    expect.arrayContaining([{ instancePath: '/draft/0/supported', keyword: 'enum' }])
  );
  expect(JSON.stringify([...log.info.mock.calls, ...log.warn.mock.calls])).not.toMatch(
    /secret@example.org|private value/
  );
});

test('fallback renderer rejects polluted persisted postal fields and reference fragments', () => {
  const reference = situationReference({
    situation: 'MaLo 50855117576, Adresse 37170 Ort, Referenz PSUTI-2026/1234.',
    identifiers: [
      { kind: 'MaLo', value: '50855117576' },
      { kind: 'PLZ', value: '37170' },
      { kind: 'Referenz', value: 'PSUTI' },
    ],
  });
  expect(reference).toBe('MaLo: 50855117576');
});
