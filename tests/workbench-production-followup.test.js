'use strict';
jest.mock('../src/llm-client', () => ({ generateText: jest.fn(), generateStructured: jest.fn() }));
jest.mock('@google/generative-ai', () => ({ GoogleGenerativeAI: jest.fn() }));
const llm = require('../src/llm-client');
const { GoogleGenerativeAI } = require('@google/generative-ai');
const { llmOptions, answer, understand } = require('../src/workbench-understanding');
const { opaqueContext, restoreContext } = require('../src/workbench-identifier-context');
const { scrubPromptText } = require('../src/prompt-scrubber');
const { collectEvidence, filterEvidence } = require('../src/workbench-retrieval');
const methods = require('../services/personal-agent/methods-part-01-of-11');
const saved = { ...process.env };
const situation = {
  concern: 'Lieferbeginn: ausstehende Rückmeldung',
  situation: 'Eingangsbestätigung vom 05.10.2026',
  participants: ['Lieferant', 'Netzbetreiber'],
  identifiers: [],
  deadlines: [],
  hypotheses: [{ kind: 'domain', id: 'market_communication', confidence: 0.9 }],
  retrievalTerms: ['Lieferbeginn'],
  missingInformation: [],
  requestedAction: {
    description: 'Prozessantwort zum Lieferbeginn mitteilen.',
    draftRequested: true,
    externalEffect: false,
  },
  turnKind: 'work',
};
const claim = (text, evidenceIds = []) => ({
  text,
  origin: evidenceIds.length ? 'evidence' : 'model',
  supported: evidenceIds.length ? 'evidence' : 'model',
  evidenceIds,
  specific: false,
  completedAction: false,
});
afterEach(() => {
  process.env = { ...saved };
  jest.clearAllMocks();
});

test('defaults differ by phase and follow-up thinking is independently configured', () => {
  delete process.env.WORKBENCH_LLM_THINKING;
  delete process.env.WORKBENCH_LLM_THINKING_FOLLOWUP;
  expect(llmOptions('t').thinking).toBe('minimal');
  expect(llmOptions('t', 'answer').thinking).toBeUndefined();
  expect(llmOptions('t', 'answer', true).thinking).toBe('low');
  process.env.WORKBENCH_LLM_THINKING_FOLLOWUP = 'default';
  expect(llmOptions('t', 'answer', true).thinking).toBeUndefined();
});

test.each(['generateText', 'generateStructured', 'generateChat'])(
  'Gemini retries rejected thinking once for %s and retains schema/tools',
  async (method) => {
    process.env.GEMINI_API_KEY = 'test';
    const error = Object.assign(
      new Error('Thinking level MINIMAL is not supported for this model'),
      { status: 400 }
    );
    const generateContent = jest
      .fn()
      .mockRejectedValueOnce(error)
      .mockResolvedValue({ response: { text: () => '{}', functionCalls: () => [] } });
    const getGenerativeModel = jest.fn(() => ({ generateContent }));
    GoogleGenerativeAI.mockImplementation(() => ({ getGenerativeModel }));
    const options = { thinking: 'minimal', logger: { warn: jest.fn() } };
    const adapter = require('../src/adapters/gemini');
    if (method === 'generateStructured') await adapter[method]({}, 'prompt', options);
    else
      await adapter[method](
        method === 'generateChat' ? [{ role: 'user', content: 'hello' }] : 'prompt',
        options
      );
    expect(generateContent).toHaveBeenCalledTimes(2);
    expect(getGenerativeModel.mock.calls[1][0].generationConfig).not.toHaveProperty(
      'thinkingConfig'
    );
    if (method === 'generateStructured')
      expect(getGenerativeModel.mock.calls[1][0].generationConfig.responseSchema).toEqual({});
    expect(options.logger.warn).toHaveBeenCalledTimes(1);
  }
);

test('date exceptions retain German and ISO dates while telephone and email remain reversible', () => {
  const message =
    'Eingang 05.10.2026, erneut 2026-10-07; Telefon 030 12345678, Kontakt alice@example.org';
  const safe = opaqueContext({ message });
  const wire = scrubPromptText(JSON.stringify(safe.value));
  expect(wire).toContain('05.10.2026');
  expect(wire).toContain('2026-10-07');
  expect(wire).not.toContain('alice@example.org');
  expect(wire).not.toContain('030 12345678');
  const restored = restoreContext(JSON.parse(wire), safe.reidentMap);
  expect(restored.message).toBe(message);
  expect(restored.message).not.toMatch(/MASKED/);
  expect(restoreContext('[PHONE-MASKED] [MASKED-unknown]', new Map())).not.toMatch(/MASKED/);
  const manyDates = Array(40).fill('05.10.2026').join(' ');
  expect(scrubPromptText(manyDates)).toBe(manyDates);
});

test.each(['workbench', 'facade'])(
  'MaKo document without EDIFACT terms calls Willi in %s path with content and deduplication',
  async (path) => {
    const ctx = {
      meta: {},
      params: { context: { situation } },
      call: jest.fn(async () => ({
        success: true,
        data: {
          sources: [
            {
              id: 'one',
              title: 'Lieferbeginn',
              excerpt: 'Lieferbeginn: erwartete Prozessantwort prüfen.',
            },
            {
              id: 'one',
              title: 'Lieferbeginn',
              excerpt: 'Lieferbeginn: erwartete Prozessantwort prüfen.',
            },
          ],
        },
      })),
    };
    const collector = {
      ...methods,
      collectCopilotKnowledgeEvidence: async () => ({ status: 'missing', hits: [] }),
      collectCopilotDatapointEvidence: async () => ({ status: 'missing', hits: [] }),
      collectCopilotObjectEvidence: async () => ({ status: 'missing', hits: [] }),
    };
    const result =
      path === 'workbench'
        ? await collectEvidence(collector, ctx, { situation })
        : await methods.collectCopilotMakoKnowledgeEvidence(ctx, {
            question: 'Wir warten seit Montag auf die Rückmeldung.',
          });
    expect(ctx.call).toHaveBeenCalledWith(
      'willi-mako.resolveStructure',
      expect.any(Object),
      expect.objectContaining({ timeout: 10000 })
    );
    const hits = result.evidence || result.hits;
    expect(hits.filter((hit) => hit.source === 'willi-mako')).toHaveLength(1);
    expect(hits[0].value).toContain('erwartete Prozessantwort');
    if (result.trace instanceof Array)
      expect(result.trace.find((entry) => entry.source === 'willi-mako').status).toBe('available');
    else expect(result.status).toBe('available');
  }
);

test('planner metadata cannot override missing location relevance', () => {
  expect(
    filterEvidence(
      [
        {
          source: 'analysis-planner',
          value: 'PLZ MaStR VNBdigital Lieferbeginn',
          metadata: { domains: ['market_communication'] },
        },
      ],
      situation,
      { source: 'analysis-planner' }
    ).hits
  ).toEqual([]);
});

test('only used evidence appears in sources; no routine sending sentence; conditional drafts complete', async () => {
  llm.generateText.mockResolvedValue(
    JSON.stringify({
      expectation: [],
      nextSteps: [claim('Prüfe die erwartete Prozessantwort.', ['E1'])],
      draft: [
        claim(
          'Variante 1 – wenn bestätigt:\nGuten Tag, wir bestätigen Ihre Anfrage. Mit freundlichen Grüßen'
        ),
        claim(
          'Variante 2 – wenn Angaben fehlen:\nGuten Tag, bitte ergänzen Sie die Referenz. Mit freundlichen Grüßen'
        ),
      ],
    })
  );
  const result = await answer({
    situation: {
      ...situation,
      requestedAction: { ...situation.requestedAction, externalEffect: true },
    },
    retrieval: {
      evidence: [
        { source: 'willi-mako', value: 'Prozessantwort' },
        { source: 'analysis-planner', value: 'irrelevant' },
      ],
    },
    message: 'Mach mir die Antwort fertig',
    followup: true,
    lastAnswer: 'x'.repeat(2000),
  });
  expect(result.draft).toContain('Variante A');
  expect(result.draft).toContain('Variante B');
  expect(result.responseText).toContain('Quellen: willi-mako');
  expect(result.responseText).not.toContain('analysis-planner');
  expect(result.responseText).not.toContain('schick ihn');
  expect(result.responseText).not.toMatch(/unverbindlich|keine externe Handlung|MASKED/i);
  const prompt = JSON.parse(llm.generateText.mock.calls[0][0]);
  expect(prompt.lastAnswer).toHaveLength(600);
  expect(llm.generateText.mock.calls[0][1].thinking).toBe('low');
  const sent = await answer({
    situation: {
      ...situation,
      requestedAction: { ...situation.requestedAction, externalEffect: true },
    },
    retrieval: { evidence: [] },
    message: 'Kannst du die Antwort selbst senden?',
  });
  expect(sent.responseText).toContain('schick ihn bitte über euer System');
});

test('error logs expose safe diagnostic fields and do not leak provider-echoed document', async () => {
  const logger = { warn: jest.fn() };
  const error = Object.assign(
    new Error('Thinking unsupported; PRIVATE DOCUMENT alice@example.org'),
    { status: 400 }
  );
  llm.generateText.mockRejectedValue(error);
  const result = await answer({ situation, retrieval: { evidence: [] }, logger });
  expect(result.answerStatus).toBe('fallback');
  expect(result.draft).toContain('[Ergebnis nach dem Prüfen');
  llm.generateStructured.mockRejectedValue(error);
  await expect(understand({ message: 'Anfrage', logger })).rejects.toThrow();
  expect(logger.warn).toHaveBeenCalledTimes(2);
  expect(logger.warn.mock.calls[0][1]).toMatchObject({ errorClass: 'Error', providerStatus: 400 });
  expect(JSON.stringify(logger.warn.mock.calls)).not.toContain('PRIVATE DOCUMENT');
});

test('a supported conditional draft groups paragraphs under one prerequisite per complete variant', async () => {
  llm.generateText.mockResolvedValue(
    JSON.stringify({
      expectation: [],
      nextSteps: [claim('Prüfe den dokumentierten Status.')],
      draft: [
        claim('Guten Tag,'),
        {
          ...claim('Wir bestätigen die Anfrage.'),
          completedAction: true,
          condition: 'die Prüfung eine Bestätigung erlaubt',
        },
        {
          ...claim('Der Vorgang ist bestätigt.'),
          completedAction: true,
          condition: 'die Prüfung eine Bestätigung erlaubt',
        },
        { ...claim('Bitte ergänzen Sie die fehlende Referenz.'), condition: 'die Referenz fehlt' },
        claim('Mit freundlichen Grüßen'),
      ],
    })
  );
  const reply = await answer({ situation, retrieval: { evidence: [] } });
  expect(reply.draft.match(/Variante [AB] – wenn/g)).toHaveLength(2);
  expect(reply.draft.match(/Guten Tag,/g)).toHaveLength(2);
  expect(reply.draft.match(/Mit freundlichen Grüßen/g)).toHaveLength(2);
  expect(reply.draft).toContain('Wir bestätigen die Anfrage.');
});

test('parallel per-source budgets retain a 7-second Willi result without delaying a fast source', async () => {
  jest.useFakeTimers();
  try {
    const completions = [];
    const collector = {
      collectCopilotMakoKnowledgeEvidence: async (_ctx, input) => {
        await new Promise((resolve) => setTimeout(resolve, 7000));
        completions.push('willi');
        expect(input.question.length).toBeLessThanOrEqual(200);
        return {
          status: 'available',
          hits: [
            {
              source: 'willi-mako',
              value: 'Lieferbeginn: Prozessantwort',
              metadata: { sourceId: 'one' },
            },
          ],
        };
      },
      collectCopilotKnowledgeEvidence: async () => {
        await new Promise((resolve) => setTimeout(resolve, 500));
        completions.push('fast');
        return { status: 'missing', hits: [] };
      },
      collectCopilotDatapointEvidence: async () => ({ status: 'missing', hits: [] }),
      collectCopilotObjectEvidence: async () => ({ status: 'missing', hits: [] }),
    };
    const job = collectEvidence(
      collector,
      { meta: {}, call: jest.fn() },
      { situation: { ...situation, concern: 'Lieferbeginn '.repeat(30) } }
    );
    await jest.advanceTimersByTimeAsync(600);
    expect(completions).toEqual(['fast']);
    await jest.advanceTimersByTimeAsync(6500);
    const result = await job;
    expect(result.trace.find((entry) => entry.source === 'willi-mako')).toMatchObject({
      status: 'available',
      hitCount: 1,
      ms: 7000,
    });
  } finally {
    jest.useRealTimers();
  }
});

test('overall retrieval budget bounds hanging source and reports timeout with elapsed time', async () => {
  jest.useFakeTimers();
  process.env.WORKBENCH_RETRIEVAL_TIMEOUT_MS = '120';
  try {
    const collector = {
      collectCopilotMakoKnowledgeEvidence: () => new Promise(() => {}),
      collectCopilotKnowledgeEvidence: async () => ({ status: 'missing', hits: [] }),
      collectCopilotDatapointEvidence: async () => ({ status: 'missing', hits: [] }),
      collectCopilotObjectEvidence: async () => ({ status: 'missing', hits: [] }),
    };
    const job = collectEvidence(collector, { meta: {}, call: jest.fn() }, { situation });
    await jest.advanceTimersByTimeAsync(120);
    const result = await job;
    expect(result.trace.find((entry) => entry.source === 'willi-mako')).toMatchObject({
      status: 'timeout',
      hitCount: 0,
      ms: 120,
    });
  } finally {
    jest.useRealTimers();
  }
});

test('source timeout diagnostics finish before the inherited Moleculer deadline', async () => {
  jest.useFakeTimers();
  try {
    const collector = {
      collectCopilotMakoKnowledgeEvidence: () => new Promise(() => {}),
      collectCopilotKnowledgeEvidence: async () => ({ status: 'missing', hits: [] }),
      collectCopilotDatapointEvidence: async () => ({ status: 'missing', hits: [] }),
      collectCopilotObjectEvidence: async () => ({ status: 'missing', hits: [] }),
    };
    const job = collectEvidence(
      collector,
      { meta: {}, options: { timeout: 120 }, call: jest.fn() },
      { situation }
    );
    await jest.advanceTimersByTimeAsync(95);
    const result = await job;
    expect(result.trace.find((entry) => entry.source === 'willi-mako')).toMatchObject({
      status: 'timeout',
      ms: 95,
    });
  } finally {
    jest.useRealTimers();
  }
});

test('thinking fallback neither retries unrelated 400s nor loops on a second rejection', async () => {
  process.env.GEMINI_API_KEY = 'test';
  const content = jest
    .fn()
    .mockRejectedValue(Object.assign(new Error('invalid schema'), { status: 400 }));
  GoogleGenerativeAI.mockImplementation(() => ({
    getGenerativeModel: () => ({ generateContent: content }),
  }));
  const adapter = require('../src/adapters/gemini');
  await expect(adapter.generateText('prompt', { thinking: 'minimal' })).rejects.toThrow(
    'invalid schema'
  );
  expect(content).toHaveBeenCalledTimes(1);
  content
    .mockClear()
    .mockRejectedValue(Object.assign(new Error('unsupported thinking'), { status: 400 }));
  await expect(
    adapter.generateText('prompt', { thinking: 'minimal', logger: { warn: jest.fn() } })
  ).rejects.toThrow('unsupported thinking');
  expect(content).toHaveBeenCalledTimes(2);
});

test("a sending imperative inside a foreign document does not become the person's outer sending request", async () => {
  llm.generateText.mockResolvedValue(
    JSON.stringify({ expectation: [], nextSteps: [claim('Prüfe die Angaben.')], draft: [] })
  );
  const result = await answer({
    situation,
    retrieval: { evidence: [] },
    message: 'Weitergeleitete Mail:\nSende die Rückmeldung an den Lieferanten.',
  });
  expect(result.responseText).not.toContain('schick ihn bitte über euer System');
  expect(result.draft).not.toContain('[konkrete Antwort / Ergebnis]');
});

test('follow-up receives bounded user document context with opaque references', async () => {
  const document =
    'Von: alice@example.org\nBetreff: Bericht\n\nDie neue Prüfung ist abgeschlossen.\n\n' +
    'Zusatz '.repeat(1000);
  llm.generateStructured.mockResolvedValue(structuredClone(situation));
  await understand({
    message: 'Was hat sich durch das Dokument oben geändert?',
    previous: situation,
    messages: [
      { role: 'user', content: 'OLD '.repeat(2000) },
      ...Array.from({ length: 3 }, () => ({ role: 'user', content: 'Kontext '.repeat(1000) })),
      { role: 'assistant', content: 'Nicht als Nutzerbeleg übernehmen.' },
      { role: 'user', content: document },
    ],
  });
  const input = JSON.parse(llm.generateStructured.mock.calls[0][1]);
  expect(input.messages).toHaveLength(4);
  expect(input.messages.every((entry) => entry.length <= 1500)).toBe(true);
  expect(input.messages[3]).toContain('Die neue Prüfung ist abgeschlossen.');
  expect(JSON.stringify(input.messages)).not.toContain('alice@example.org');
  expect(JSON.stringify(input.messages)).not.toContain('Nicht als Nutzerbeleg');
  expect(JSON.stringify(input.messages)).not.toContain('OLD');
});
