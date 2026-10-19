'use strict';

// Gemini's response_schema rejects `additionalProperties` and `uniqueItems` (HTTP 400 "Unknown name").
// The adapter must strip it from the provider copy while callers keep their full schema.

let mockGenerateContent;
let mockGetGenerativeModel;

jest.mock('@google/generative-ai', () => ({
  GoogleGenerativeAI: jest.fn().mockImplementation(() => ({
    getGenerativeModel: (params) => {
      mockGetGenerativeModel(params);
      return { generateContent: (...args) => mockGenerateContent(...args) };
    },
  })),
}));

describe('src/adapters/gemini generateStructured', () => {
  const envBackup = { ...process.env };

  beforeEach(() => {
    process.env = { ...envBackup, GEMINI_API_KEY: 'test-key' };
    jest.resetModules();
    mockGenerateContent = jest.fn().mockResolvedValue({
      response: { text: () => '{"answer":"ok"}' },
    });
    mockGetGenerativeModel = jest.fn();
  });

  afterAll(() => {
    process.env = envBackup;
  });

  it('removes additionalProperties at every depth from the provider schema only', async () => {
    const schema = {
      type: 'object',
      properties: {
        answer: { type: 'string', minLength: 1, maxLength: 6000 },
        items: {
          type: 'array',
          items: {
            type: 'object',
            properties: { id: { type: 'string' } },
            additionalProperties: false,
          },
        },
      },
      required: ['answer'],
      additionalProperties: false,
    };
    const original = JSON.parse(JSON.stringify(schema));
    const geminiAdapter = require('../src/adapters/gemini');

    await expect(geminiAdapter.generateStructured(schema, 'prompt')).resolves.toBe(
      '{"answer":"ok"}'
    );

    const sent = mockGetGenerativeModel.mock.calls[0][0].generationConfig.responseSchema;
    expect(JSON.stringify(sent)).not.toContain('additionalProperties');
    expect(sent.properties.answer).toEqual({ type: 'string', minLength: 1, maxLength: 6000 });
    expect(sent.properties.items.items.properties).toEqual({ id: { type: 'string' } });
    expect(sent.required).toEqual(['answer']);
    expect(schema).toEqual(original);
  });

  it('removes uniqueItems while keeping the other array constraints', async () => {
    const schema = {
      type: 'object',
      properties: {
        sourceIds: {
          type: 'array',
          maxItems: 8,
          uniqueItems: true,
          items: { type: 'string', enum: ['a', 'b'] },
        },
      },
      required: ['sourceIds'],
    };
    const original = JSON.parse(JSON.stringify(schema));
    const geminiAdapter = require('../src/adapters/gemini');

    await geminiAdapter.generateStructured(schema, 'prompt');

    const sent = mockGetGenerativeModel.mock.calls[0][0].generationConfig.responseSchema;
    expect(sent.properties.sourceIds).toEqual({
      type: 'array',
      maxItems: 8,
      items: { type: 'string', enum: ['a', 'b'] },
    });
    expect(schema).toEqual(original);
  });

  it('also reduces a responseSchema passed through generation options', async () => {
    const geminiAdapter = require('../src/adapters/gemini');
    await geminiAdapter.generateText('prompt', {
      responseSchema: { type: 'object', properties: {}, additionalProperties: false },
    });
    const config = mockGetGenerativeModel.mock.calls[0][0].generationConfig;
    expect(config.responseSchema).toEqual({ type: 'object', properties: {} });
    expect(config.responseMimeType).toBe('application/json');
  });
});
