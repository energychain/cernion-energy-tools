'use strict';
jest.mock('../src/llm-client', () => ({ generateStructured: jest.fn(), generateText: jest.fn() }));
const { prepareThread, maxInputChars } = require('../src/workbench-thread');
const { captureCodes, resolveCodes } = require('../src/workbench-codes');
const { backgroundTask, answerBackgroundTask } = require('../src/workbench-background-task');
const fixtures = require('./fixtures/workbench-752.json');
const llm = require('../src/llm-client');

test('R3 retains nine chronological messages and promises, removes repeated footers', () => {
  expect(fixtures.R3.length).toBeGreaterThan(12000);
  expect(fixtures.R3.length).toBeLessThan(15001);
  const prepared = prepareThread(fixtures.R3);
  expect(prepared.timeline.filter((entry) => entry.date)).toHaveLength(9);
  expect(prepared.timeline.filter((entry) => entry.date).map((entry) => entry.date)).toEqual(
    [...prepared.timeline.filter((entry) => entry.date).map((entry) => entry.date)].sort()
  );
  expect(prepared.text).toContain('Systemfehler beim Dienstleister');
  expect(prepared.text).toContain('lediglich den Eingang');
  expect(prepared.text).not.toContain('Telefon:');
  expect(prepared.text).not.toContain('Diese Nachricht ist nur');
});

test('raw input limit defaults to 40000', () => {
  expect(maxInputChars()).toBe(40000);
});

test('code lookup uses structured source and rejects neighboring codes', async () => {
  const identifiers = captureCodes(fixtures.R2[0]);
  expect(identifiers).toEqual([{ kind: 'rejection_reason', value: 'A33' }]);
  const call = jest.fn(async () => ({
    success: true,
    data: { sources: [{ title: 'Codeliste', excerpt: 'A330: anderer Grund' }] },
  }));
  const result = await resolveCodes({ call, meta: { tenantId: 'test' } }, { identifiers }, {});
  expect(call).toHaveBeenCalledWith(
    'willi-mako.resolveStructure',
    expect.objectContaining({ category: 'edifact', query: 'Ablehnungsgrund A33' }),
    expect.anything()
  );
  expect(result.resolutions[0].status).toBe('unresolved');
  expect(result.evidence).toEqual([]);
});

test('disabled source is never called', async () => {
  const call = jest.fn();
  await resolveCodes(
    { call },
    { identifiers: captureCodes(fixtures.R2[0]) },
    { 'willi-mako': false }
  );
  expect(call).not.toHaveBeenCalled();
});

test('metadata task requires task and history structure and uses understanding model', async () => {
  const message = '### Task: Generate tags\n<chat_history>USER: help</chat_history>';
  expect(backgroundTask(message)).toBe('tags');
  expect(backgroundTask('Generate tags')).toBeNull();
  llm.generateText.mockResolvedValue('{"tags":["Antwort"]}');
  const result = await answerBackgroundTask(message, 'tenant-test');
  expect(JSON.parse(result.responseText)).toEqual({ tags: ['Antwort'] });
  expect(result.cetCaseId).toBeUndefined();
  expect(llm.generateText.mock.calls[0][1].model).toBe('gemini-3.5-flash-lite');
});

test('quoted repeated body promises remain; numeric German dates sort chronologically', () => {
  const promise =
    'Wir haben die Klärung zugesagt.\nEin Ergebnis wird in dieser Nachricht nicht bestätigt.';
  const input = `Von: Team B\nGesendet: 09.10.2026 10:00\n\n${promise}\n\nAndere offene Frage.\n\nVon: Team A\nGesendet: 08.10.2026 10:00\n\n${promise}\n\nWeiterer offener Punkt.`;
  const prepared = prepareThread(input);
  expect(prepared.timeline[0].date).toBe('08.10.2026 10:00');
  expect(prepared.text.split(promise)).toHaveLength(3);
});

test('quote markers split messages without mail headers', () => {
  const prepared = prepareThread(
    'Bitte hilf.\nAm 08.10.2026 schrieb Team A:\n> Eine offene Frage.\nOn 07 Oct 2026 Team B wrote:\n> Die erste Frage.'
  );
  expect(prepared.timeline).toHaveLength(2);
});

test('configured raw input limit accepts R3 and rejects beyond its budget', () => {
  const normalize = require('../src/workbench-contract').normalizeTaskEnvelope;
  expect(normalize({ conversationId: 'long', message: fixtures.R3 }).userRequest).toHaveLength(
    fixtures.R3.length
  );
  const old = process.env.WORKBENCH_MAX_INPUT_CHARS;
  process.env.WORKBENCH_MAX_INPUT_CHARS = '15000';
  try {
    expect(() => normalize({ conversationId: 'long', message: 'x'.repeat(15001) })).toThrow(
      'too long'
    );
  } finally {
    if (old === undefined) delete process.env.WORKBENCH_MAX_INPUT_CHARS;
    else process.env.WORKBENCH_MAX_INPUT_CHARS = old;
  }
});

test('exact code evidence is retained with a readable document section', async () => {
  const call = jest.fn(async () => ({
    success: true,
    data: {
      sources: [
        {
          title: 'Test-Codeliste',
          sectionId: 'Testabschnitt',
          excerpt: 'A33: ausschließlich synthetischer Testgrund.',
        },
      ],
    },
  }));
  const result = await resolveCodes(
    { call, meta: { tenantId: 'test' } },
    { identifiers: captureCodes(fixtures.R2[0]) },
    {}
  );
  expect(result.resolutions[0].status).toBe('resolved');
  expect(result.evidence[0].metadata.sectionId).toBe('Testabschnitt');
  expect(result.trace[0]).toMatchObject({ source: 'willi-mako', status: 'available', hitCount: 1 });
});

test('a repeated promise before the footer is preserved even as a later body block', () => {
  const promise = 'Wir haben die Klärung zugesagt.\nEin Ergebnis wird hier nicht bestätigt.';
  const footer =
    'Team Beispiel\nteam@example.invalid\n+49 000 000000\nBeispieladresse ohne reale Angaben';
  const prepared = prepareThread(
    `Von: Team A\n\nErste Frage.\n\n${promise}\n\n${footer}\n\nVon: Team B\n\nZweite Frage.\n\n${promise}\n\n${footer}`
  );
  expect(prepared.text.split(promise)).toHaveLength(3);
  expect(prepared.text).not.toContain('Beispieladresse');
});

test('Willi collector keeps document titles and sections through the evidence boundary', async () => {
  const method =
    require('../services/personal-agent/methods-part-01-of-11').collectCopilotMakoKnowledgeEvidence;
  const result = await method(
    {
      meta: { tenantId: 'test' },
      params: {},
      call: jest.fn(async () => ({
        success: true,
        data: {
          sources: [
            {
              id: 'internal-id',
              title: 'Lesbarer Titel',
              sectionId: 'Abschnitt 3',
              excerpt: 'Fachliche Rückmeldung.',
            },
          ],
        },
      })),
    },
    { question: 'Fachliche Rückmeldung', selected: true }
  );
  expect(result.hits[0].metadata).toMatchObject({
    title: 'Lesbarer Titel',
    sectionId: 'Abschnitt 3',
  });
});

test('normal free text retains header-like lines and quote markers unchanged', () => {
  const message =
    'Bitte prüfe meine Notizen:\nDatum: nächste Woche\nAn: unser Team\n> eine wichtige Aussage';
  expect(prepareThread(message)).toEqual({ text: message, timeline: [], truncated: false });
  expect(require('../src/workbench-thread').isDocumentInput(message)).toBe(false);
});

test.each([
  'Der Code ist unklar.',
  'Code A33 ist ein Beispiel im Programm.',
  'Bitte lies den Code.',
])('ordinary code wording without rejection context is not a catalog code: %s', (message) => {
  expect(captureCodes(message)).toEqual([]);
});

test('structured lookup uses custom source budget and skips absent budgets', async () => {
  const call = jest.fn(async () => ({ success: true, data: { sources: [] } }));
  const identifiers = captureCodes('Ablehnungsgrund A33');
  await resolveCodes({ call }, { identifiers }, {}, undefined, {
    sources: [{ id: 'willi-mako', timeoutMs: 9876 }],
  });
  expect(call.mock.calls[0][2].timeout).toBe(9876);
  call.mockClear();
  const result = await resolveCodes({ call }, { identifiers }, {}, undefined, { sources: [] });
  expect(call).not.toHaveBeenCalled();
  expect(result.resolutions[0].status).toBe('unresolved');
});

test.each([
  ['title', 'title', ''],
  ['tags', 'tags', []],
  ['follow-up questions', 'follow_ups', []],
])(
  'metadata parse and provider errors return valid empty %s JSON and warn',
  async (task, key, empty) => {
    const logger = { warn: jest.fn() };
    const message = `### Task: Generate ${task}\n<chat_history>USER: help</chat_history>`;
    for (const failure of [
      'not JSON',
      'null',
      Object.assign(new Error('provider failed'), { status: 429 }),
    ]) {
      if (failure instanceof Error) llm.generateText.mockRejectedValueOnce(failure);
      else llm.generateText.mockResolvedValueOnce(failure);
      const result = await answerBackgroundTask(message, 'test', logger);
      expect(JSON.parse(result.responseText)).toEqual({ [key]: empty });
    }
    expect(logger.warn).toHaveBeenCalledTimes(3);
  }
);
