'use strict';

jest.mock('../src/adapters/gemini', () => ({
  id: 'gemini',
  generateText: jest.fn(async (prompt) => `gemini:${prompt}`),
  generateStructured: jest.fn(async () => '{"ok":true}'),
  embeddings: jest.fn(async () => [[0.1, 0.2]]),
  capabilities: jest.fn(() => ({
    structured: true,
    embeddings: true,
    vision: false,
    contextWindow: null,
  })),
}));

jest.mock('../src/adapters/openai-compat', () => ({
  id: 'openai-compat',
  generateText: jest.fn(async () => 'openai-text'),
  generateStructured: jest.fn(async () => '{"source":"openai"}'),
  embeddings: jest.fn(async () => [[1, 2, 3]]),
  capabilities: jest.fn(() => ({
    structured: true,
    embeddings: true,
    vision: false,
    contextWindow: null,
  })),
}));

jest.mock('../src/adapters/ollama', () => ({
  id: 'ollama',
  generateText: jest.fn(async () => 'ollama-text'),
  generateStructured: jest.fn(async () => '{"source":"ollama"}'),
  embeddings: jest.fn(async () => [[4, 5, 6]]),
  capabilities: jest.fn(() => ({
    structured: true,
    embeddings: false,
    vision: false,
    contextWindow: null,
  })),
}));

const geminiAdapter = require('../src/adapters/gemini');
const openaiAdapter = require('../src/adapters/openai-compat');
const ollamaAdapter = require('../src/adapters/ollama');
const llmClient = require('../src/llm-client');

describe('llm-client provider abstraction', () => {
  const envBackup = { ...process.env };

  beforeEach(() => {
    process.env = { ...envBackup };
    delete process.env.LLM_PROVIDER;
    delete process.env.LLM_MAX_RETRIES;

    geminiAdapter.generateText.mockClear();
    geminiAdapter.generateStructured.mockClear();
    geminiAdapter.embeddings.mockClear();

    openaiAdapter.generateText.mockClear();
    openaiAdapter.generateStructured.mockClear();
    openaiAdapter.embeddings.mockClear();

    ollamaAdapter.generateText.mockClear();
    ollamaAdapter.generateStructured.mockClear();
    ollamaAdapter.embeddings.mockClear();
  });

  afterAll(() => {
    process.env = envBackup;
  });

  it('uses gemini adapter by default for generateText', async () => {
    const text = await llmClient.generateText('ping');

    expect(text).toMatch(/^gemini:/);
    expect(geminiAdapter.generateText).toHaveBeenCalled();
  });

  it('uses selected provider for generateText', async () => {
    process.env.LLM_PROVIDER = 'openai';

    const text = await llmClient.generateText('ping');

    expect(text).toBe('openai-text');
    expect(openaiAdapter.generateText).toHaveBeenCalledTimes(1);
  });

  it('throws for unsupported provider', async () => {
    process.env.LLM_PROVIDER = 'unknown-provider';

    await expect(llmClient.generateText('ping')).rejects.toMatchObject({
      code: 503,
      type: 'LLM_PROVIDER_NOT_SUPPORTED',
    });
  });

  it('parses fenced JSON from structured response', async () => {
    geminiAdapter.generateStructured.mockResolvedValueOnce('```json\n{"status":"ok"}\n```');

    const result = await llmClient.generateStructured({ type: 'object' }, 'test');

    expect(result).toEqual({ status: 'ok' });
  });

  it('falls back to generateText when structured call fails', async () => {
    geminiAdapter.generateStructured.mockRejectedValueOnce(new Error('schema failed'));
    geminiAdapter.generateText.mockResolvedValueOnce('{"fallback":true}');

    const result = await llmClient.generateStructured({ type: 'object' }, 'test');

    expect(result).toEqual({ fallback: true });
    expect(geminiAdapter.generateText).toHaveBeenCalled();
  });

  it('returns capability matrix for provider', () => {
    process.env.LLM_PROVIDER = 'openai-compat';

    const caps = llmClient.capabilities();

    expect(caps.provider).toBe('openai-compat');
    expect(caps.structured).toBe(true);
    expect(caps.embeddings).toBe(true);
  });

  it('throws capability error when provider has no embeddings', async () => {
    process.env.LLM_PROVIDER = 'ollama';

    await expect(llmClient.embeddings(['x'])).rejects.toMatchObject({
      code: 503,
      type: 'LLM_CAPABILITY_MISSING',
    });
  });

  it('retries failed provider calls until success', async () => {
    process.env.LLM_MAX_RETRIES = '2';
    geminiAdapter.generateText
      .mockRejectedValueOnce(new Error('transient'))
      .mockResolvedValueOnce('after-retry');

    const text = await llmClient.generateText('ping');

    expect(text).toBe('after-retry');
    expect(geminiAdapter.generateText).toHaveBeenCalledTimes(2);
  });
});
