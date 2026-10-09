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
  generateChat: jest.fn(async () => ({
    content: 'gemini-chat-reply',
    toolCalls: null,
    finishReason: 'stop',
  })),
  capabilities: jest.fn(() => ({
    structured: true,
    embeddings: true,
    vision: false,
    imageGeneration: true,
    toolCalling: true,
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
  generateChat: jest.fn(async () => ({
    content: 'openai-chat-reply',
    toolCalls: null,
    finishReason: 'stop',
  })),
  capabilities: jest.fn(() => ({
    structured: true,
    embeddings: true,
    vision: false,
    imageGeneration: true,
    toolCalling: true,
    contextWindow: null,
  })),
}));

jest.mock('../src/adapters/ollama', () => ({
  id: 'ollama',
  generateText: jest.fn(async () => 'ollama-text'),
  generateStructured: jest.fn(async () => '{"source":"ollama"}'),
  embeddings: jest.fn(async () => [[4, 5, 6]]),
  generateImage: jest.fn(),
  generateChat: jest.fn(),
  capabilities: jest.fn(() => ({
    structured: true,
    embeddings: false,
    vision: false,
    imageGeneration: false,
    toolCalling: false,
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

  test.each(['generateText', 'generateStructured', 'generateImage', 'generateChat'])(
    '%s scrubs JSON values without damaging escaped newlines or keys',
    async (method) => {
      const prompt = JSON.stringify({ 'alice@example.org': { text: 'Zeile\nalice@example.org' } });
      const options = { provider: 'gemini' };
      if (method === 'generateStructured') await llmClient[method]({}, prompt, options);
      else if (method === 'generateChat')
        await llmClient[method]([{ role: 'user', content: prompt }], options);
      else await llmClient[method](prompt, options);
      const args = geminiAdapter[method].mock.calls[0];
      const wire =
        method === 'generateChat'
          ? args[0][0].content
          : args[method === 'generateStructured' ? 1 : 0];
      const safe = JSON.parse(wire);
      expect(safe['alice@example.org'].text).toBe('Zeile\n[EMAIL-MASKED]');
    }
  );
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
    geminiAdapter.generateChat.mockClear();

    openaiAdapter.generateText.mockClear();
    openaiAdapter.generateStructured.mockClear();
    openaiAdapter.embeddings.mockClear();
    openaiAdapter.generateImage.mockClear();
    openaiAdapter.generateChat.mockClear();

    ollamaAdapter.generateText.mockClear();
    ollamaAdapter.generateStructured.mockClear();
    ollamaAdapter.embeddings.mockClear();
    ollamaAdapter.generateImage.mockClear();
    ollamaAdapter.generateChat.mockClear();
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

  it('strict per-turn budget skips fallback and makes only one provider request', async () => {
    const failure = new Error('schema failed');
    geminiAdapter.generateStructured.mockRejectedValueOnce(failure);
    await expect(
      llmClient.generateStructured({ type: 'object' }, 'test', {
        maxRetries: 1,
        structuredFallback: false,
      })
    ).rejects.toBe(failure);
    expect(geminiAdapter.generateStructured).toHaveBeenCalledTimes(1);
    expect(geminiAdapter.generateText).not.toHaveBeenCalled();
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

  it('uses gemini adapter by default for generateChat', async () => {
    const result = await llmClient.generateChat([{ role: 'user', content: 'Hallo' }]);

    expect(result.content).toBe('gemini-chat-reply');
    expect(geminiAdapter.generateChat).toHaveBeenCalledWith(
      [{ role: 'user', content: 'Hallo' }],
      expect.any(Object)
    );
  });

  it('scrubs string message content before forwarding to the adapter', async () => {
    await llmClient.generateChat([
      { role: 'system', content: 'be terse' },
      { role: 'user', content: 'ping' },
      {
        role: 'assistant',
        content: null,
        tool_calls: [{ id: 'call_1', function: { name: 'x', arguments: '{}' } }],
      },
    ]);

    const [forwardedMessages] = geminiAdapter.generateChat.mock.calls[0];
    expect(forwardedMessages[0].content).toBe('be terse');
    expect(forwardedMessages[1].content).toBe('ping');
    // Non-string content (null, for a tool-call-carrying assistant message) passes through untouched.
    expect(forwardedMessages[2].content).toBeNull();
    expect(forwardedMessages[2].tool_calls).toEqual([
      { id: 'call_1', function: { name: 'x', arguments: '{}' } },
    ]);
  });

  it('capability matrix reports toolCalling per provider', () => {
    process.env.LLM_PROVIDER = 'ollama';
    expect(llmClient.capabilities().toolCalling).toBe(false);

    process.env.LLM_PROVIDER = 'gemini';
    loadFreshModules();
    expect(llmClient.capabilities().toolCalling).toBe(true);
  });

  it('throws capability error when provider has no tool-calling support', async () => {
    process.env.LLM_PROVIDER = 'ollama';

    await expect(llmClient.generateChat([{ role: 'user', content: 'ping' }])).rejects.toMatchObject(
      {
        code: 503,
        type: 'LLM_CAPABILITY_MISSING',
      }
    );
    expect(ollamaAdapter.generateChat).not.toHaveBeenCalled();
  });
  test.each(['generateText', 'generateStructured'])(
    'budgeted %s retries provider 429 once using retryAfter',
    async (method) => {
      jest.useFakeTimers();
      const failure = Object.assign(new Error('quota'), { status: 429, retryAfter: 0.1 });
      geminiAdapter[method]
        .mockRejectedValueOnce(failure)
        .mockResolvedValueOnce(method === 'generateText' ? 'ok' : '{"ok":true}');
      const options = { transientRecovery: true, timeoutMs: 1000, structuredFallback: false };
      const pending =
        method === 'generateText'
          ? llmClient[method]('ping', options)
          : llmClient[method]({}, 'ping', options);
      await jest.advanceTimersByTimeAsync(99);
      expect(geminiAdapter[method]).toHaveBeenCalledTimes(1);
      await jest.advanceTimersByTimeAsync(1);
      await pending;
      expect(geminiAdapter[method]).toHaveBeenCalledTimes(2);
      expect(geminiAdapter[method].mock.calls[1].at(-1).timeoutMs).toBeLessThanOrEqual(900);
      jest.useRealTimers();
    }
  );

  test.each([429, 503, 504])(
    'provider %s uses configured fallback inside same budget without workbench retries',
    async (status) => {
      const primary = 'configured-primary';
      const secondary = 'configured-secondary';
      geminiAdapter.generateText
        .mockRejectedValueOnce(
          Object.assign(new Error('provider failed'), { status, retryAfter: 90 })
        )
        .mockResolvedValueOnce('recovered');
      const onRecovery = jest.fn();
      expect(
        await llmClient.generateText('ping', {
          model: primary,
          fallbackModel: secondary,
          transientRecovery: true,
          timeoutMs: 1000,
          onRecovery,
        })
      ).toBe('recovered');
      expect(geminiAdapter.generateText).toHaveBeenCalledTimes(2);
      expect(geminiAdapter.generateText.mock.calls[1][1]).toMatchObject({ model: secondary });
      expect(onRecovery).toHaveBeenCalledWith({ reason: expect.any(String) });
    }
  );

  test('out-of-budget retryAfter without fallback fails immediately and authentication never switches model', async () => {
    const failure = Object.assign(new Error('quota'), { status: 429, data: { retryAfter: 60 } });
    geminiAdapter.generateText.mockRejectedValueOnce(failure);
    await expect(
      llmClient.generateText('ping', { transientRecovery: true, timeoutMs: 500 })
    ).rejects.toBe(failure);
    expect(geminiAdapter.generateText).toHaveBeenCalledTimes(1);
    geminiAdapter.generateText
      .mockClear()
      .mockRejectedValueOnce(Object.assign(new Error('auth'), { status: 401 }));
    await expect(
      llmClient.generateText('ping', {
        transientRecovery: true,
        fallbackModel: 'configured-secondary',
        timeoutMs: 500,
      })
    ).rejects.toMatchObject({ status: 401 });
    expect(geminiAdapter.generateText).toHaveBeenCalledTimes(1);
  });

  test('timeout reserves remaining budget for fallback; fallback failure is terminal', async () => {
    jest.useFakeTimers();
    geminiAdapter.generateText
      .mockImplementationOnce(() => new Promise(() => {}))
      .mockResolvedValueOnce('recovered');
    const pending = llmClient.generateText('ping', {
      transientRecovery: true,
      fallbackModel: 'configured-secondary',
      timeoutMs: 1000,
    });
    await jest.advanceTimersByTimeAsync(500);
    expect(await pending).toBe('recovered');
    expect(geminiAdapter.generateText.mock.calls[1][1].timeoutMs).toBeLessThanOrEqual(500);
    jest.useRealTimers();
    geminiAdapter.generateText
      .mockReset()
      .mockRejectedValue(Object.assign(new Error('down'), { status: 503 }));
    await expect(
      llmClient.generateText('ping', {
        transientRecovery: true,
        fallbackModel: 'configured-secondary',
        timeoutMs: 1000,
      })
    ).rejects.toMatchObject({ status: 503 });
    expect(geminiAdapter.generateText).toHaveBeenCalledTimes(2);
  });
});
