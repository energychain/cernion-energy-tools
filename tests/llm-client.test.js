'use strict';

const fs = require('fs');
const os = require('os');
const path = require('path');

jest.mock('../src/adapters/gemini', () => ({
  id: 'gemini',
  generateText: jest.fn(async (prompt) => `gemini:${prompt}`),
  generateStructured: jest.fn(async () => '{"ok":true}'),
  embeddings: jest.fn(async () => [[0.1, 0.2]]),
  generateImage: jest.fn(async () => ({
    images: [{ b64Json: 'gemini-b64', mimeType: 'image/png' }],
    text: null,
  })),
  capabilities: jest.fn(() => ({
    structured: true,
    embeddings: true,
    vision: false,
    imageGeneration: true,
    contextWindow: null,
  })),
}));

jest.mock('../src/adapters/openai-compat', () => ({
  id: 'openai-compat',
  generateText: jest.fn(async () => 'openai-text'),
  generateStructured: jest.fn(async () => '{"source":"openai"}'),
  embeddings: jest.fn(async () => [[1, 2, 3]]),
  generateImage: jest.fn(async () => ({
    images: [{ b64Json: 'openai-b64', mimeType: 'image/png' }],
    text: null,
  })),
  capabilities: jest.fn(() => ({
    structured: true,
    embeddings: true,
    vision: false,
    imageGeneration: true,
    contextWindow: null,
  })),
}));

jest.mock('../src/adapters/ollama', () => ({
  id: 'ollama',
  generateText: jest.fn(async () => 'ollama-text'),
  generateStructured: jest.fn(async () => '{"source":"ollama"}'),
  embeddings: jest.fn(async () => [[4, 5, 6]]),
  generateImage: jest.fn(),
  capabilities: jest.fn(() => ({
    structured: true,
    embeddings: false,
    vision: false,
    imageGeneration: false,
    contextWindow: null,
  })),
}));

describe('llm-client provider abstraction', () => {
  const envBackup = { ...process.env };
  let geminiAdapter;
  let openaiAdapter;
  let ollamaAdapter;
  let llmClient;
  let rateQuotaStore;
  let rateQuotaDir;

  function loadFreshModules() {
    jest.resetModules();
    geminiAdapter = require('../src/adapters/gemini');
    openaiAdapter = require('../src/adapters/openai-compat');
    ollamaAdapter = require('../src/adapters/ollama');
    rateQuotaStore = require('../src/rate-quota-store');
    llmClient = require('../src/llm-client');
  }

  beforeEach(() => {
    process.env = { ...envBackup };
    delete process.env.LLM_PROVIDER;
    delete process.env.LLM_MAX_RETRIES;
    rateQuotaDir = fs.mkdtempSync(path.join(os.tmpdir(), 'llm-rate-quota-'));
    process.env.RATE_QUOTA_DIR = rateQuotaDir;
    loadFreshModules();

    geminiAdapter.generateText.mockClear();
    geminiAdapter.generateStructured.mockClear();
    geminiAdapter.embeddings.mockClear();
    geminiAdapter.generateImage.mockClear();

    openaiAdapter.generateText.mockClear();
    openaiAdapter.generateStructured.mockClear();
    openaiAdapter.embeddings.mockClear();
    openaiAdapter.generateImage.mockClear();

    ollamaAdapter.generateText.mockClear();
    ollamaAdapter.generateStructured.mockClear();
    ollamaAdapter.embeddings.mockClear();
    ollamaAdapter.generateImage.mockClear();
  });

  afterEach(() => {
    rateQuotaStore.resetForTests();
    try {
      fs.rmSync(rateQuotaDir, { recursive: true, force: true });
    } catch {
      // ignore cleanup issues in temp dir
    }
    delete process.env.RATE_QUOTA_DIR;
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

  it('records estimated tenant-scoped quota usage for generateText', async () => {
    await llmClient.generateText('ping', { tenantId: 'tenant-a' });

    const snapshot = rateQuotaStore.buildQuotaSnapshot('tenant-a');

    expect(snapshot.usage.llm_tokens_per_day.used).toBeGreaterThan(0);
    expect(snapshot.usage.llm_tokens_per_day.estimatedUsed).toBeGreaterThan(0);
    expect(snapshot.usage.llm_tokens_per_day.lastMeta).toEqual(
      expect.objectContaining({
        operation: 'generate_text',
        isEstimated: true,
        hasActual: false,
      })
    );
  });

  it('throws structured error when llm quota is exhausted before call', async () => {
    process.env.QUOTA_LLM_TOKENS_PER_DAY = '1';
    loadFreshModules();

    await expect(
      llmClient.generateText('this prompt is definitely longer than one token', {
        tenantId: 'tenant-a',
      })
    ).rejects.toMatchObject({
      code: 429,
      type: 'LLM_QUOTA_EXCEEDED',
    });

    const events = rateQuotaStore.listTenantEvents('tenant-a');
    expect(events.events.some((item) => item.type === 'quota.exhausted')).toBe(true);
  });

  it('uses gemini adapter by default for generateImage', async () => {
    const result = await llmClient.generateImage('an infographic');

    expect(result.images).toEqual([{ b64Json: 'gemini-b64', mimeType: 'image/png' }]);
    expect(geminiAdapter.generateImage).toHaveBeenCalledWith('an infographic', expect.any(Object));
  });

  it('capability matrix reports imageGeneration per provider', () => {
    process.env.LLM_PROVIDER = 'ollama';
    expect(llmClient.capabilities().imageGeneration).toBe(false);

    process.env.LLM_PROVIDER = 'gemini';
    loadFreshModules();
    expect(llmClient.capabilities().imageGeneration).toBe(true);
  });

  it('throws capability error when provider has no image generation support', async () => {
    process.env.LLM_PROVIDER = 'ollama';

    await expect(llmClient.generateImage('an infographic')).rejects.toMatchObject({
      code: 503,
      type: 'LLM_CAPABILITY_MISSING',
    });
    expect(ollamaAdapter.generateImage).not.toHaveBeenCalled();
  });
});
