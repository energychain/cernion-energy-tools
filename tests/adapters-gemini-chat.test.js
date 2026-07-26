'use strict';

// Focused unit tests for src/adapters/gemini.js's generateChat() (OpenAI-shaped
// tool/function-calling support), added alongside /v1/chat/completions'
// optional `tools`/`tool_choice` params. generateText/generateStructured/
// embeddings/generateImage on this adapter are covered elsewhere.

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

describe('src/adapters/gemini generateChat', () => {
  const envBackup = { ...process.env };

  beforeEach(() => {
    process.env = { ...envBackup, GEMINI_API_KEY: 'test-key' };
    jest.resetModules();
    mockGenerateContent = jest.fn();
    mockGetGenerativeModel = jest.fn();
  });

  afterAll(() => {
    process.env = envBackup;
  });

  it('returns a plain text reply when no tools are supplied', async () => {
    mockGenerateContent.mockResolvedValue({
      response: { text: () => 'Hallo, wie kann ich helfen?' },
    });
    const geminiAdapter = require('../src/adapters/gemini');

    const result = await geminiAdapter.generateChat([{ role: 'user', content: 'Hallo' }]);

    expect(result).toEqual({
      content: 'Hallo, wie kann ich helfen?',
      toolCalls: null,
      finishReason: 'stop',
    });
    expect(mockGetGenerativeModel).toHaveBeenCalledWith(
      expect.not.objectContaining({ tools: expect.anything() })
    );
  });

  it('maps system/developer messages into a combined systemInstruction', async () => {
    mockGenerateContent.mockResolvedValue({ response: { text: () => 'ok' } });
    const geminiAdapter = require('../src/adapters/gemini');

    await geminiAdapter.generateChat([
      { role: 'system', content: 'Stay read-only.' },
      { role: 'developer', content: 'Use Cernion evidence.' },
      { role: 'user', content: 'Hallo' },
    ]);

    expect(mockGetGenerativeModel).toHaveBeenCalledWith(
      expect.objectContaining({ systemInstruction: 'Stay read-only.\nUse Cernion evidence.' })
    );
    expect(mockGenerateContent).toHaveBeenCalledWith({
      contents: [{ role: 'user', parts: [{ text: 'Hallo' }] }],
    });
  });

  it('passes OpenAI-shaped tools as Gemini functionDeclarations', async () => {
    mockGenerateContent.mockResolvedValue({ response: { text: () => 'ok' } });
    const geminiAdapter = require('../src/adapters/gemini');

    await geminiAdapter.generateChat([{ role: 'user', content: 'Wie ist das Wetter in Berlin?' }], {
      tools: [
        {
          type: 'function',
          function: {
            name: 'get_weather',
            description: 'Get current weather for a location',
            parameters: {
              type: 'object',
              properties: { location: { type: 'string' } },
              required: ['location'],
            },
          },
        },
      ],
    });

    expect(mockGetGenerativeModel).toHaveBeenCalledWith(
      expect.objectContaining({
        tools: [
          {
            functionDeclarations: [
              {
                name: 'get_weather',
                description: 'Get current weather for a location',
                parameters: {
                  type: 'object',
                  properties: { location: { type: 'string' } },
                  required: ['location'],
                },
              },
            ],
          },
        ],
      })
    );
  });

  it('translates tool_choice="required" into functionCallingConfig mode ANY', async () => {
    mockGenerateContent.mockResolvedValue({ response: { text: () => 'ok' } });
    const geminiAdapter = require('../src/adapters/gemini');

    await geminiAdapter.generateChat([{ role: 'user', content: 'x' }], {
      tools: [{ type: 'function', function: { name: 'do_thing', parameters: {} } }],
      toolChoice: 'required',
    });

    expect(mockGetGenerativeModel).toHaveBeenCalledWith(
      expect.objectContaining({
        toolConfig: { functionCallingConfig: { mode: 'ANY' } },
      })
    );
  });

  it('translates a named tool_choice into allowedFunctionNames', async () => {
    mockGenerateContent.mockResolvedValue({ response: { text: () => 'ok' } });
    const geminiAdapter = require('../src/adapters/gemini');

    await geminiAdapter.generateChat([{ role: 'user', content: 'x' }], {
      tools: [{ type: 'function', function: { name: 'do_thing', parameters: {} } }],
      toolChoice: { type: 'function', function: { name: 'do_thing' } },
    });

    expect(mockGetGenerativeModel).toHaveBeenCalledWith(
      expect.objectContaining({
        toolConfig: { functionCallingConfig: { mode: 'ANY', allowedFunctionNames: ['do_thing'] } },
      })
    );
  });

  it('returns toolCalls with finishReason=tool_calls when Gemini requests a function call', async () => {
    mockGenerateContent.mockResolvedValue({
      response: {
        text: () => '',
        functionCalls: () => [{ name: 'get_weather', args: { location: 'Berlin' } }],
      },
    });
    const geminiAdapter = require('../src/adapters/gemini');

    const result = await geminiAdapter.generateChat([{ role: 'user', content: 'Wetter?' }], {
      tools: [{ type: 'function', function: { name: 'get_weather', parameters: {} } }],
    });

    expect(result).toEqual({
      content: null,
      toolCalls: [{ name: 'get_weather', args: { location: 'Berlin' } }],
      finishReason: 'tool_calls',
    });
  });

  it('round-trips a prior assistant tool_call and a tool response into Gemini contents', async () => {
    mockGenerateContent.mockResolvedValue({ response: { text: () => 'Es ist sonnig in Berlin.' } });
    const geminiAdapter = require('../src/adapters/gemini');

    await geminiAdapter.generateChat([
      { role: 'user', content: 'Wie ist das Wetter in Berlin?' },
      {
        role: 'assistant',
        content: null,
        tool_calls: [
          {
            id: 'call_1',
            type: 'function',
            function: { name: 'get_weather', arguments: '{"location":"Berlin"}' },
          },
        ],
      },
      { role: 'tool', tool_call_id: 'call_1', content: '{"tempC":22,"condition":"sunny"}' },
    ]);

    expect(mockGenerateContent).toHaveBeenCalledWith({
      contents: [
        { role: 'user', parts: [{ text: 'Wie ist das Wetter in Berlin?' }] },
        {
          role: 'model',
          parts: [{ functionCall: { name: 'get_weather', args: { location: 'Berlin' } } }],
        },
        {
          role: 'function',
          parts: [
            {
              functionResponse: {
                name: 'get_weather',
                response: { tempC: 22, condition: 'sunny' },
              },
            },
          ],
        },
      ],
    });
  });

  it('reports toolCalling:true in capabilities', () => {
    const geminiAdapter = require('../src/adapters/gemini');
    expect(geminiAdapter.capabilities().toolCalling).toBe(true);
  });
});
