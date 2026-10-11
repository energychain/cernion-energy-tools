'use strict';

jest.mock('axios', () => ({ post: jest.fn() }));
jest.mock('@google/generative-ai', () => ({ GoogleGenerativeAI: jest.fn() }));
jest.mock('../src/llm-client', () => ({ generateText: jest.fn(), generateStructured: jest.fn() }));
const axios = require('axios');
const { GoogleGenerativeAI } = require('@google/generative-ai');
const { llmOptions, questionsFor, answer } = require('../src/workbench-understanding');
const llm = require('../src/llm-client');
const env = { ...process.env };
afterEach(() => {
  process.env = { ...env };
  jest.clearAllMocks();
});

test('independent phase models and budgets, single value, and invalid budget fallback', () => {
  process.env.WORKBENCH_LLM_MODEL = 'fast,quality';
  process.env.WORKBENCH_LLM_TIMEOUT_MS = '100,200';
  expect(llmOptions('tenant')).toMatchObject({ model: 'fast', timeoutMs: 100 });
  expect(llmOptions('tenant', 'answer')).toMatchObject({ model: 'quality', timeoutMs: 200 });
  process.env.WORKBENCH_LLM_MODEL = 'single';
  process.env.WORKBENCH_LLM_TIMEOUT_MS = '-1,invalid';
  expect(llmOptions('tenant', 'answer')).toMatchObject({ model: 'single', timeoutMs: 4500 });
});

test.each(['gemini', 'openai-compat', 'ollama'])(
  'fast default for configured provider %s',
  (provider) => {
    delete process.env.WORKBENCH_LLM_MODEL;
    process.env.LLM_PROVIDER = provider;
    process.env.LLM_MODEL = 'slow-global';
    expect(llmOptions('tenant').model).not.toBe('slow-global');
  }
);

test('only blocking questions are asked, at most one, semantic keys never repeat', () => {
  const situation = {
    missingInformation: [
      { key: 'optional', question: 'Welche Farbe?', blocking: false },
      ...Array.from({ length: 5 }, (_, index) => ({
        key: `key-${index}`,
        question: `Welche Angabe ${index}?`,
        blocking: true,
      })),
    ],
  };
  const first = questionsFor(situation);
  expect(first).toHaveLength(1);
  expect(questionsFor(situation, first)).toHaveLength(1);
});

test.each(['openai-compat', 'ollama'])(
  '%s text and structured adapter respect options.model',
  async (provider) => {
    axios.post.mockResolvedValue({
      data: { response: '{}', choices: [{ message: { content: '{}' } }] },
    });
    const adapter = require(`../src/adapters/${provider}`);
    await adapter.generateText('prompt', { model: 'override-text' });
    expect(axios.post.mock.calls[0][1].model).toBe('override-text');
    await adapter.generateStructured({}, 'prompt', { model: 'override-json' });
    expect(axios.post.mock.calls[1][1].model).toBe('override-json');
    if (provider === 'openai-compat') {
      await adapter.generateStructured({}, 'prompt', {
        model: 'override-tool',
        structuredMode: 'tool',
      });
      expect(axios.post.mock.calls[2][1].model).toBe('override-tool');
    }
  }
);

test('Gemini text, schema and JSON fallback respect options.model', async () => {
  process.env.GEMINI_API_KEY = 'test-key';
  const getGenerativeModel = jest.fn(() => ({
    generateContent: jest.fn(async () => ({ response: { text: () => '{}' } })),
  }));
  GoogleGenerativeAI.mockImplementation(() => ({ getGenerativeModel }));
  const adapter = require('../src/adapters/gemini');
  await adapter.generateText('prompt', { model: 'text-model' });
  await adapter.generateStructured({}, 'prompt', { model: 'schema-model' });
  await adapter.generateStructured({}, 'prompt', { model: 'json-model', structuredMode: 'json' });
  expect(getGenerativeModel.mock.calls.map(([options]) => options.model)).toEqual([
    'text-model',
    'schema-model',
    'json-model',
  ]);
});

test('model error returns honest degradation with findings and facts', async () => {
  llm.generateText.mockRejectedValue(new Error('provider error'));
  const reply = await answer({
    situation: {
      concern: 'Die Anfrage ist offen.',
      situation: 'Es fehlt die Rückmeldung.',
      missingInformation: [],
      requestedAction: {
        description: 'Bearbeitungsstand prüfen.',
        draftRequested: true,
        externalEffect: false,
      },
    },
    retrieval: { evidence: [{ source: 'Prozessnotiz', value: 'Eingang dokumentieren.' }] },
  });
  expect(reply.answerStatus).toBe('fallback');
  expect(reply.responseText).toContain('Eingang dokumentieren.');
  expect(reply.responseText).not.toContain('Quellen: Prozessnotiz');
  expect(reply.draft).toBe('');
  expect(reply.responseText).toContain('Die Anfrage ist offen.');
  expect(reply.metadata.degraded).toBe(true);
});

test('timeout fallback does not silently supply a stale draft', async () => {
  llm.generateText.mockRejectedValue(new Error('timeout'));
  const reply = await answer({
    situation: {
      concern: 'Rückmeldung fehlt.',
      situation: '',
      missingInformation: [],
      requestedAction: { description: 'Stand prüfen.', externalEffect: false },
    },
    retrieval: { evidence: [] },
    previousDraft: 'Guten Tag, bitte teilen Sie uns den dokumentierten Stand mit.',
  });
  expect(reply.draft).toBe('');
  expect(reply.responseText).toContain('Modell ist gerade nicht verfügbar');
});

test('draft cannot assert completed work without literal evidence', async () => {
  const claim = (text, completedAction, supported = 'model', evidenceIds = []) => ({
    text,
    completedAction,
    supported,
    evidenceIds,
    specific: false,
  });
  llm.generateText.mockResolvedValue(
    JSON.stringify({
      expectation: [claim('Das Gegenüber erwartet eine Rückmeldung.', false)],
      nextSteps: [],
      draft: [
        claim('Guten Tag, bitte teilen Sie uns den aktuellen Stand mit.', false),
        claim('Die Prüfung ist abgeschlossen und Unterlagen liegen bei.', true),
        claim('Die Prüfung ist abgeschlossen.', true, 'evidence', ['E1']),
      ],
    })
  );
  const reply = await answer({
    situation: {
      concern: 'Rückmeldung fehlt.',
      missingInformation: [],
      requestedAction: { externalEffect: false },
    },
    retrieval: { evidence: [{ source: 'Notiz', value: 'Den Bearbeitungsstand prüfen.' }] },
  });
  expect(reply.draft).toBe('');
  expect(reply.responseText).not.toContain('abgeschlossen');
});

test('Gemini thinking options reach text, structured and chat generation', async () => {
  process.env.GEMINI_API_KEY = 'test-key';
  const getGenerativeModel = jest.fn(() => ({
    generateContent: jest.fn(async () => ({ response: { text: () => '{}' } })),
  }));
  GoogleGenerativeAI.mockImplementation(() => ({ getGenerativeModel }));
  const adapter = require('../src/adapters/gemini');
  await adapter.generateText('prompt', {
    thinking: 'minimal',
    responseMimeType: 'application/json',
  });
  await adapter.generateStructured({}, 'prompt', { thinking: '0' });
  await adapter.generateChat([{ role: 'user', content: 'hello' }], {
    thinkingConfig: { thinkingLevel: 'low' },
  });
  expect(getGenerativeModel.mock.calls.map(([o]) => o.generationConfig.thinkingConfig)).toEqual([
    { thinkingLevel: 'minimal' },
    { thinkingBudget: 0 },
    { thinkingLevel: 'low' },
  ]);
  expect(getGenerativeModel.mock.calls[0][0].generationConfig.responseMimeType).toBe(
    'application/json'
  );
  process.env.WORKBENCH_LLM_THINKING = 'minimal,low';
  expect(llmOptions('tenant').thinking).toBe('minimal');
  expect(llmOptions('tenant', 'answer').thinking).toBe('low');
});

test('recommended model, timeout and thinking pairs remain independent', async () => {
  process.env.GEMINI_API_KEY = 'test-key';
  process.env.WORKBENCH_LLM_MODEL = 'gemini-3.5-flash-lite,gemini-3.5-flash';
  process.env.WORKBENCH_LLM_TIMEOUT_MS = '4500,45000';
  process.env.WORKBENCH_LLM_THINKING = 'minimal,default';
  const understanding = llmOptions('tenant');
  const answering = llmOptions('tenant', 'answer');
  expect(understanding).toMatchObject({
    model: 'gemini-3.5-flash-lite',
    timeoutMs: 4500,
    thinking: 'minimal',
  });
  expect(answering).toMatchObject({ model: 'gemini-3.5-flash', timeoutMs: 45000 });
  expect(answering.thinking).toBeUndefined();
  const getGenerativeModel = jest.fn(() => ({
    generateContent: jest.fn(async () => ({ response: { text: () => '{}' } })),
  }));
  GoogleGenerativeAI.mockImplementation(() => ({ getGenerativeModel }));
  const adapter = require('../src/adapters/gemini');
  await adapter.generateText('understand', understanding);
  await adapter.generateText('answer', answering);
  expect(getGenerativeModel.mock.calls[0][0].generationConfig.thinkingConfig).toEqual({
    thinkingLevel: 'minimal',
  });
  expect(getGenerativeModel.mock.calls[1][0].generationConfig).not.toHaveProperty('thinkingConfig');
  process.env.WORKBENCH_LLM_THINKING = 'standard';
  expect(llmOptions('tenant').thinking).toBeUndefined();
  expect(llmOptions('tenant', 'answer').thinking).toBeUndefined();
  process.env.WORKBENCH_LLM_THINKING = 'low';
  expect(llmOptions('tenant').thinking).toBe('low');
  expect(llmOptions('tenant', 'answer').thinking).toBe('low');
});

test('follow-up prompt asks for concise changes and avoids generating unchanged drafts', async () => {
  llm.generateText.mockResolvedValue(
    JSON.stringify({
      expectation: [],
      nextSteps: [],
      draft: [],
      interpretation: [
        {
          text: 'Prüfe den Stand.',
          supported: 'model',
          completedAction: false,
          specific: false,
          evidenceIds: [],
        },
      ],
    })
  );
  await answer({
    situation: {
      concern: 'Anfrage',
      missingInformation: [],
      requestedAction: { draftRequested: false, externalEffect: false },
    },
    retrieval: { evidence: [] },
    message: 'Was bedeutet das?',
    followup: true,
  });
  const prompt = JSON.parse(llm.generateText.mock.calls[0][0]);
  expect(prompt.turnInstruction).toContain('höchstens zwei nächste Schritte');
  expect(prompt.turnInstruction).toContain('keinen unveränderten proaktiven Entwurf erneut');
});

test('Gemini honors native responseSchema on facade text calls and reports truncation without response contents', async () => {
  process.env.GEMINI_API_KEY = 'test-key';
  const schema = { type: 'object', properties: { text: { type: 'string' } }, required: ['text'] };
  const getGenerativeModel = jest.fn(() => ({
    generateContent: jest.fn(async () => ({
      response: { text: () => '{"text":', candidates: [{ finishReason: 'MAX_TOKENS' }] },
    })),
  }));
  GoogleGenerativeAI.mockImplementation(() => ({ getGenerativeModel }));
  const onResponseMetadata = jest.fn();
  const adapter = require('../src/adapters/gemini');
  await adapter.generateText('prompt', {
    model: 'configured-answer',
    responseSchema: schema,
    onResponseMetadata,
  });
  expect(getGenerativeModel).toHaveBeenCalledWith({
    model: 'configured-answer',
    generationConfig: { responseMimeType: 'application/json', responseSchema: schema },
  });
  expect(onResponseMetadata).toHaveBeenCalledWith({ outputLength: 8, truncated: true });
  expect(JSON.stringify(onResponseMetadata.mock.calls)).not.toContain('text');
});
