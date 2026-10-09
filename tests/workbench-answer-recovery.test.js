'use strict';

jest.mock('../src/llm-client', () => ({ generateText: jest.fn(), generateStructured: jest.fn() }));
const llm = require('../src/llm-client');
const { answer, ANSWER_SCHEMA, renderDraft } = require('../src/workbench-understanding');
const {
  prepareAnswerEvidence,
  copiesEvidence,
  safeSituationText,
} = require('../src/workbench-answer-evidence');
const situation = {
  concern: 'Eine fachliche Rückmeldung zum Lieferbeginn fehlt.',
  situation:
    'Anfrage von absender@example.org an empfaenger@example.org. Die Eingangsbestätigung liegt vor.',
  identifiers: [
    { kind: 'MaLo', value: '99000000001' },
    { kind: 'E-Mail', value: 'absender@example.org' },
  ],
  retrievalTerms: ['Lieferbeginn', 'Netzanmeldung', 'Prozessantwort'],
  missingInformation: [],
  requestedAction: {
    description: 'Bearbeitungsstand prüfen und fachliche Rückmeldung formulieren.',
    draftRequested: true,
    externalEffect: false,
  },
};
const claim = (text, evidenceIds = [], condition) => ({
  text,
  evidenceIds,
  condition,
  completedAction: false,
  specific: false,
  supported: evidenceIds.length ? 'evidence' : 'model',
  origin: evidenceIds.length ? 'evidence' : 'model',
});
const good = () => ({
  interpretation: [
    claim('Eine Eingangsbestätigung ersetzt die fachliche Prozessantwort nicht.', ['E1']),
  ],
  expectation: [],
  nextSteps: [claim('Prüfe den Stand und nutze den vorgesehenen Kanal für die Rückmeldung.')],
  draft: [],
});
const raw =
  'In diesem Entscheidungsbaum sind zuerst die Meldungsreferenzen der eingegangenen Netzanmeldung vollständig den Nachrichten zuzuordnen. Die dokumentierten Merkmale und die Antworten der vorhergehenden Schritte sind getrennt voneinander zu prüfen und im Zusammenhang einzuordnen.';
const retrieval = {
  evidence: [
    {
      source: 'willi-mako',
      value: raw,
      metadata: {
        sourceId: 'E_0608',
        title: 'EBD E_0608',
        documentTitle: 'Synthetischer Entscheidungsbaum',
        sectionId: 'section-1',
        sectionTitle: 'Prüfschritte',
      },
    },
  ],
};
let previous;
beforeEach(() => {
  previous = process.env.WORKBENCH_LLM_TIMEOUT_MS;
  process.env.WORKBENCH_LLM_TIMEOUT_MS = '500,500';
  llm.generateText.mockReset();
});
afterEach(() => {
  if (previous === undefined) delete process.env.WORKBENCH_LLM_TIMEOUT_MS;
  else process.env.WORKBENCH_LLM_TIMEOUT_MS = previous;
  jest.useRealTimers();
});

test.each(['invalid JSON', 'invalid schema'])(
  'one repair after %s succeeds, with shortened evidence and native schema options',
  async (kind) => {
    const logger = { warn: jest.fn() };
    llm.generateText
      .mockResolvedValueOnce(
        kind === 'invalid JSON' ? '{"expectation":' : '{"expectation": "wrong"}'
      )
      .mockResolvedValueOnce(JSON.stringify(good()));
    const reply = await answer({ situation, retrieval, logger });
    expect(reply.answerStatus).toBe('grounded');
    expect(reply.answerAttempts).toBe(2);
    expect(llm.generateText).toHaveBeenCalledTimes(2);
    const first = JSON.parse(llm.generateText.mock.calls[0][0]);
    const second = JSON.parse(llm.generateText.mock.calls[1][0]);
    expect(first.repairInstruction).toBeUndefined();
    expect(second.repairInstruction).toBeTruthy();
    expect(second.evidence[0].value.length).toBeLessThanOrEqual(240);
    expect(llm.generateText.mock.calls[0][1].responseSchema.required).toEqual(
      Object.keys(ANSWER_SCHEMA.properties)
    );
    expect(Object.keys(llm.generateText.mock.calls[0][1].responseSchema.properties)).toEqual(
      Object.keys(ANSWER_SCHEMA.properties)
    );
    expect(JSON.stringify(llm.generateText.mock.calls[0][1].responseSchema)).not.toContain(
      'additionalProperties'
    );
    expect(llm.generateText.mock.calls[0][1].responseSchema.additionalProperties).toBeUndefined();
    expect(logger.warn).toHaveBeenCalledTimes(1);
    expect(logger.warn.mock.calls[0][1]).toMatchObject({
      errorClass: 'SyntaxError',
      outputLength: expect.any(Number),
      truncated: kind === 'invalid JSON',
    });
    expect(JSON.stringify(logger.warn.mock.calls)).not.toContain(raw);
  }
);

test('second schema error produces a neutral, LLM-free fallback without stale promises or raw excerpts', async () => {
  llm.generateText.mockResolvedValue('{"expectation": "wrong"}');
  const reply = await answer({
    situation,
    retrieval,
    previousDraft: 'Wir bestätigen Ihre Anfrage. absender@example.org',
    logger: { warn: jest.fn() },
  });
  expect(llm.generateText).toHaveBeenCalledTimes(2);
  expect(reply.answerStatus).toBe('fallback');
  expect(reply.responseText).not.toMatch(/@|bestätig|zustimm|ablehn/i);
  expect(reply.responseText).toContain('Gefundene Fundstellen:');
  expect(reply.responseText.length).toBeLessThan(1500);
  expect(reply.responseText).not.toContain('Quellen:');
  expect(reply.draft).toBe('');
  expect(reply.responseText).toContain('Gefundene Fundstellen:');
  expect(reply.draft).not.toMatch(/E-Mail|MaLo:|Variante/);
  expect(reply.responseText).toContain('99000000001');
  expect(reply.evidenceTrace.rawEvidence[0].value).toBe(raw);
});

test('provider errors and timeouts never trigger schema repair; skipModel makes no LLM call', async () => {
  llm.generateText.mockRejectedValue(new Error('provider unavailable'));
  await answer({ situation, retrieval, logger: { warn: jest.fn() } });
  expect(llm.generateText).toHaveBeenCalledTimes(1);
  llm.generateText.mockClear();
  const reply = await answer({ situation, retrieval, skipModel: true });
  expect(llm.generateText).not.toHaveBeenCalled();
  expect(reply.answerStatus).toBe('fallback');
  expect(reply.responseText).not.toMatch(/@|bestätig|zustimm|ablehn/i);
});

test('elapsed answer time includes failed call and repair; both attempts share one budget', async () => {
  jest.useFakeTimers();
  llm.generateText
    .mockImplementationOnce(() => new Promise((resolve) => setTimeout(() => resolve('{'), 120)))
    .mockImplementationOnce(
      () => new Promise((resolve) => setTimeout(() => resolve(JSON.stringify(good())), 150))
    );
  const pending = answer({ situation, retrieval, logger: { warn: jest.fn() } });
  await jest.advanceTimersByTimeAsync(270);
  const reply = await pending;
  expect(reply.answerMs).toBe(270);
  expect(llm.generateText.mock.calls[1][1].timeoutMs).toBeLessThanOrEqual(380);
  llm.generateText
    .mockReset()
    .mockImplementationOnce(() => new Promise((resolve) => setTimeout(() => resolve('{'), 300)))
    .mockImplementationOnce(
      () => new Promise((resolve) => setTimeout(() => resolve(JSON.stringify(good())), 300))
    );
  const bounded = answer({ situation, retrieval, logger: { warn: jest.fn() } });
  await jest.advanceTimersByTimeAsync(500);
  const fallback = await bounded;
  expect(fallback.answerStatus).toBe('fallback');
  expect(fallback.answerMs).toBe(500);
});

test('top five excerpts <=500 chars use relevant windows and deduplicate document/section and equal text', () => {
  const first = {
    evidenceId: 'E1',
    source: 'willi-mako',
    value:
      'Einleitung '.repeat(100) +
      'Lieferbeginn Netzanmeldung Prozessantwort: Fachlichen Status prüfen.' +
      ' Hintergrund'.repeat(90),
    metadata: { sourceId: 'doc', sectionId: 'one' },
  };
  const hits = [
    first,
    { ...first, evidenceId: 'E2', value: first.value + ' weiterer Absatz' },
    { ...first, evidenceId: 'E3', metadata: { sourceId: 'another', sectionId: 'two' } },
    ...Array.from({ length: 7 }, (_, index) => ({
      source: 'rag',
      evidenceId: `R${index}`,
      value: `Lieferbeginn ${index} eigene Information`,
      metadata: { sourceId: `d${index}` },
    })),
  ];
  const prepared = prepareAnswerEvidence(hits, situation);
  expect(prepared).toHaveLength(5);
  expect(prepared.every((hit) => hit.value.length <= 500)).toBe(true);
  expect(prepared[0].value).toContain('Prozessantwort');
  expect(prepared.filter((hit) => ['E1', 'E2', 'E3'].includes(hit.evidenceId))).toHaveLength(1);
});

test('raw evidence and repeated claim text never render; sources are deduplicated titles once at the end', async () => {
  const repeated = 'Prüfe den dokumentierten Stand.';
  llm.generateText.mockResolvedValue(
    JSON.stringify({
      interpretation: [claim(raw, ['E1'])],
      expectation: [claim(repeated, ['E1'])],
      nextSteps: [claim(repeated, ['E1'])],
      assumptions: [claim('Nutze den vorgesehenen Prozesskanal.', ['E1'])],
      draft: [],
    })
  );
  const reply = await answer({ situation, retrieval });
  expect(reply.responseText).not.toContain(raw);
  expect(reply.responseText.split(repeated)).toHaveLength(2);
  expect(reply.responseText.match(/Quellen:/g)).toHaveLength(1);
  expect(
    reply.responseText.endsWith('Quellen: Synthetischer Entscheidungsbaum · Prüfschritte')
  ).toBe(true);
  expect(copiesEvidence('Einleitung ' + raw.slice(30) + ' Nachsatz', retrieval.evidence)).toBe(
    true
  );
});

test.each([
  'Falls die Anmeldung bestätigt werden kann',
  'nur wenn Falls die Anmeldung bestätigt werden kann',
  'Variante 1: Falls die Anmeldung bestätigt werden kann',
  'Variante – nur wenn Falls die Anmeldung bestätigt werden kann',
])('clean variant condition: %s', (condition) => {
  const draft = renderDraft([
    claim('Guten Tag,'),
    claim('Der vollständige erste Text.', [], condition),
    claim('Der vollständige zweite Text.', [], 'Variante 2: Wenn eine Angabe fehlt'),
    claim('Mit freundlichen Grüßen'),
  ]);
  expect(draft).toContain('Variante A – wenn die Anmeldung bestätigt werden kann:');
  expect(draft).toContain('Variante B – wenn eine Angabe fehlt:');
  expect(draft).not.toMatch(/nur wenn|wenn Falls|Variante 1|Variante 2/);
  expect(draft.match(/Mit freundlichen Grüßen/g)).toHaveLength(2);
});

test('a proactive draft flag does not replace a follow-up explanation', async () => {
  llm.generateText.mockResolvedValue(JSON.stringify(good()));
  await answer({
    situation,
    retrieval,
    followup: true,
    message: 'Was bedeutet die Eingangsbestätigung?',
  });
  const question = JSON.parse(llm.generateText.mock.calls[0][0]);
  expect(question.turnInstruction).toContain('ersetzt niemals die fachliche Antwort');
  llm.generateText.mockClear();
  await answer({ situation, retrieval, followup: true, message: 'Mach mir die Antwort fertig' });
  const draft = JSON.parse(llm.generateText.mock.calls[0][0]);
  expect(draft.turnInstruction).toContain('ausdrücklich nur um den Entwurf');
});

test('safe fallback excerpts end at a word boundary within their size limit', () => {
  const text = safeSituationText(
    'Ein sehr ausführliches Anliegen mit langen zusammenhängenden Wörtern am Ende.',
    40
  );
  expect(text.length).toBeLessThanOrEqual(40);
  expect(text).toBe('Ein sehr ausführliches Anliegen mit…');
});
