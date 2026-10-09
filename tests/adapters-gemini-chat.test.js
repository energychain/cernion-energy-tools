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

  it('coalesces parallel function responses into one user content', async () => {
    mockGenerateContent.mockResolvedValue({ response: { text: () => 'ok' } });
    const adapter = require('../src/adapters/gemini');
    await adapter.generateChat([
      { role: 'user', content: 'Read both sources.' },
      {
        role: 'assistant',
        tool_calls: [
          { id: 'a', function: { name: 'read_a', arguments: '{}' } },
          { id: 'b', function: { name: 'read_b', arguments: '{}' } },
        ],
      },
      { role: 'tool', tool_call_id: 'a', content: '{"value":1}' },
      { role: 'tool', tool_call_id: 'b', content: '{"value":2}' },
    ]);
    const contents = mockGenerateContent.mock.calls[0][0].contents;
    expect(contents).toHaveLength(3);
    expect(contents[2]).toEqual({
      role: 'user',
      parts: [
        { functionResponse: { name: 'read_a', response: { value: 1 } } },
        { functionResponse: { name: 'read_b', response: { value: 2 } } },
      ],
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
                parametersJsonSchema: {
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
          role: 'user',
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

test('round-trips provider thought signatures across a tool result', async () => {
  process.env.GEMINI_API_KEY = 'test-key';
  jest.resetModules();
  mockGetGenerativeModel = jest.fn();
  mockGenerateContent = jest
    .fn()
    .mockResolvedValueOnce({
      response: {
        functionCalls: () => [{ name: 'read_data', args: { key: 'synthetic' } }],
        candidates: [
          {
            content: {
              parts: [
                {
                  functionCall: { name: 'read_data', args: { key: 'synthetic' } },
                  thoughtSignature: 'synthetic-signature',
                },
              ],
            },
          },
        ],
      },
    })
    .mockResolvedValueOnce({ response: { text: () => 'Complete' } });
  const adapter = require('../src/adapters/gemini');
  const reply = await adapter.generateChat([{ role: 'user', content: 'Read data' }]);
  expect(reply.toolCalls[0].thoughtSignature).toBe('synthetic-signature');
  await adapter.generateChat([
    { role: 'user', content: 'Read data' },
    {
      role: 'assistant',
      tool_calls: [
        {
          id: 'call_1',
          thoughtSignature: reply.toolCalls[0].thoughtSignature,
          function: { name: 'read_data', arguments: JSON.stringify(reply.toolCalls[0].args) },
        },
      ],
    },
    { role: 'tool', tool_call_id: 'call_1', content: '{"rows":[]}' },
  ]);
  expect(mockGenerateContent.mock.calls[1][0].contents[1].parts[0]).toMatchObject({
    thoughtSignature: 'synthetic-signature',
  });
  expect(mockGenerateContent.mock.calls[1][0].contents[2].role).toBe('user');
});
