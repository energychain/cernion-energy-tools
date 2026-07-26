'use strict';

// Focused unit tests for src/adapters/gemini.js's generateImage(), added for
// the /v1/images/generations facade (#498). generateText/generateStructured/
// embeddings on this adapter are covered indirectly via tests/llm-client.test.js.

let mockGenerateContent;

jest.mock('@google/generative-ai', () => ({
  GoogleGenerativeAI: jest.fn().mockImplementation(() => ({
    getGenerativeModel: jest.fn().mockImplementation((params) => ({
      generateContent: (...args) => mockGenerateContent(params, ...args),
    })),
  })),
}));

describe('src/adapters/gemini generateImage', () => {
  const envBackup = { ...process.env };

  beforeEach(() => {
    process.env = { ...envBackup, GEMINI_API_KEY: 'test-key' };
    jest.resetModules();
    mockGenerateContent = jest.fn();
  });

  afterAll(() => {
    process.env = envBackup;
  });

  it('requests both TEXT and IMAGE modalities on the configured image model', async () => {
    mockGenerateContent.mockResolvedValue({
      response: {
        candidates: [
          {
            content: {
              parts: [{ inlineData: { data: 'ZmFrZS1wbmc=', mimeType: 'image/png' } }],
            },
          },
        ],
      },
    });
    const geminiAdapter = require('../src/adapters/gemini');

    await geminiAdapter.generateImage('an infographic');

    expect(mockGenerateContent).toHaveBeenCalledWith(
      expect.objectContaining({
        model: 'gemini-2.5-flash-image',
        generationConfig: { responseModalities: ['TEXT', 'IMAGE'] },
      }),
      'an infographic'
    );
  });

  it('extracts inlineData image parts and accompanying text', async () => {
    mockGenerateContent.mockResolvedValue({
      response: {
        candidates: [
          {
            content: {
              parts: [
                { text: 'Here is your infographic.' },
                { inlineData: { data: 'ZmFrZS1wbmc=', mimeType: 'image/png' } },
              ],
            },
          },
        ],
      },
    });
    const geminiAdapter = require('../src/adapters/gemini');

    const result = await geminiAdapter.generateImage('an infographic');

    expect(result.images).toEqual([{ b64Json: 'ZmFrZS1wbmc=', mimeType: 'image/png' }]);
    expect(result.text).toBe('Here is your infographic.');
  });

  it('defaults mimeType to image/png when the model omits it', async () => {
    mockGenerateContent.mockResolvedValue({
      response: {
        candidates: [{ content: { parts: [{ inlineData: { data: 'ZmFrZQ==' } }] } }],
      },
    });
    const geminiAdapter = require('../src/adapters/gemini');

    const result = await geminiAdapter.generateImage('an infographic');

    expect(result.images[0].mimeType).toBe('image/png');
  });

  it('respects an explicit model override', async () => {
    mockGenerateContent.mockResolvedValue({
      response: {
        candidates: [{ content: { parts: [{ inlineData: { data: 'ZmFrZQ==' } }] } }],
      },
    });
    const geminiAdapter = require('../src/adapters/gemini');

    await geminiAdapter.generateImage('an infographic', { model: 'gemini-custom-image' });

    expect(mockGenerateContent).toHaveBeenCalledWith(
      expect.objectContaining({ model: 'gemini-custom-image' }),
      'an infographic'
    );
  });

  it('throws IMAGE_GENERATION_NO_IMAGE when the model returns no image data', async () => {
    mockGenerateContent.mockResolvedValue({
      response: {
        candidates: [{ content: { parts: [{ text: 'Sorry, I cannot draw that.' }] } }],
      },
    });
    const geminiAdapter = require('../src/adapters/gemini');

    await expect(geminiAdapter.generateImage('an infographic')).rejects.toMatchObject({
      code: 502,
      type: 'IMAGE_GENERATION_NO_IMAGE',
    });
  });

  it('reports imageGeneration:true in capabilities', () => {
    const geminiAdapter = require('../src/adapters/gemini');
    expect(geminiAdapter.capabilities().imageGeneration).toBe(true);
  });
});
