'use strict';

// Contract: buffered SSE for /v1/chat/completions carries OpenAI-compatible delta.tool_calls, so a
// client (Open WebUI) can rebuild the call, run the tool itself and send the result back.
jest.mock('../src/llm-client', () => ({
  generateImage: jest.fn(),
  embeddings: jest.fn(),
  generateChat: jest.fn(),
  capabilities: jest.fn(() => ({ provider: 'gemini' })),
}));

const ApiService = require('../services/api.service');
const OpenAICompatibleService = require('../services/openai-compatible.service');
const llmClient = require('../src/llm-client');

const weatherTool = {
  type: 'function',
  function: {
    name: 'get_weather',
    description: 'Synthetic weather lookup',
    parameters: { type: 'object', properties: { location: { type: 'string' } } },
  },
};

function sseRes() {
  const writes = [];
  return {
    statusCode: null,
    headers: {},
    writes,
    ended: false,
    setHeader(name, value) {
      this.headers[name] = value;
    },
    writeHead(status) {
      this.statusCode = status;
    },
    write(chunk) {
      writes.push(chunk);
      return true;
    },
    end(payload) {
      if (payload != null) writes.push(payload);
      this.ended = true;
    },
  };
}

// The broker either answers with a fixed completion or runs the real facade handler.
async function post(body, completion) {
  const route = ApiService.settings.routes.find((r) => r.path === '/v1');
  const executed = [];
  const call = jest.fn(async (action, params) => {
    if (action === 'token-manager.verify')
      return {
        valid: true,
        tokenId: 'token-tools',
        scope: 'full-access',
        scopes: ['full-access'],
        tenantId: 'tenant-tools',
        userId: 'user-tools',
      };
    if (action === 'openai-compatible.chatCompletions')
      return (
        completion ||
        OpenAICompatibleService.actions.chatCompletions.handler({
          params,
          meta: { tenantId: 'tenant-tools', authUser: { userId: 'user-tools' } },
          call: async (name) => {
            executed.push(name);
            throw new Error(`unexpected call ${name}`);
          },
        })
      );
    executed.push(action);
    throw new Error(`Unexpected action ${action}`);
  });
  const res = sseRes();
  await route.aliases['POST /chat/completions'].call(
    { broker: { call, emit: jest.fn() }, logger: { debug: jest.fn() } },
    { headers: { authorization: 'Bearer ck_tools' }, method: 'POST', body },
    res
  );
  expect(res.statusCode).toBe(200);
  expect(res.headers['Content-Type']).toBe('text/event-stream; charset=utf-8');
  expect(res.writes.at(-1)).toBe('data: [DONE]\n\n');
  const frames = res.writes
    .slice(0, -1)
    .filter((frame) => !frame.startsWith(':'))
    .map((frame) => {
      expect(frame.startsWith('data: ')).toBe(true);
      expect(frame.endsWith('\n\n')).toBe(true);
      return JSON.parse(frame.slice('data: '.length, -2));
    });
  return { frames, executed };
}

// Client-side reassembly as OpenAI clients do it: merge deltas by tool-call index.
function assemble(frames) {
  const calls = [];
  let content = '';
  for (const frame of frames) {
    const delta = frame.choices[0].delta;
    if (typeof delta.content === 'string') content += delta.content;
    for (const part of delta.tool_calls || []) {
      const call = (calls[part.index] ||= {
        id: '',
        type: 'function',
        function: { name: '', arguments: '' },
      });
      if (part.id) call.id = part.id;
      if (part.type) call.type = part.type;
      if (part.function?.name) call.function.name += part.function.name;
      if (part.function?.arguments) call.function.arguments += part.function.arguments;
    }
  }
  return { content, calls, finishReason: frames.at(-1).choices[0].finish_reason };
}

const completion = (message, finishReason) => ({
  id: 'chatcmpl_tools',
  object: 'chat.completion',
  created: 4321,
  model: 'cernion-agent-mvp',
  choices: [{ index: 0, message, finish_reason: finishReason }],
});
const toolCall = (id, name, args) => ({
  id,
  type: 'function',
  function: { name, arguments: JSON.stringify(args) },
});

describe('SSE tool_calls contract', () => {
  beforeEach(() => llmClient.generateChat.mockReset());

  test('one tool call: role, tool_calls delta, finish_reason tool_calls, no empty content', async () => {
    const call = toolCall('call_abc', 'get_weather', { location: 'Berlin' });
    const { frames } = await post(
      { model: 'cernion-agent-mvp', stream: true, messages: [{ role: 'user', content: 'x' }] },
      completion({ role: 'assistant', content: null, tool_calls: [call] }, 'tool_calls')
    );
    expect(frames.map((frame) => frame.choices[0].delta)).toEqual([
      { role: 'assistant' },
      {
        tool_calls: [
          {
            index: 0,
            id: 'call_abc',
            type: 'function',
            function: { name: 'get_weather', arguments: '{"location":"Berlin"}' },
          },
        ],
      },
      {},
    ]);
    expect(frames.map((frame) => frame.choices[0].finish_reason)).toEqual([
      null,
      null,
      'tool_calls',
    ]);
    for (const frame of frames)
      expect(frame).toMatchObject({
        id: 'chatcmpl_tools',
        object: 'chat.completion.chunk',
        created: 4321,
        model: 'cernion-agent-mvp',
      });
  });

  test('two tool calls keep order, ids, indexes and arguments', async () => {
    const calls = [
      toolCall('call_1', 'get_weather', { location: 'Berlin' }),
      toolCall('call_2', 'get_weather', { location: 'Hamburg' }),
    ];
    const { frames } = await post(
      { model: 'cernion-agent-mvp', stream: true, messages: [{ role: 'user', content: 'x' }] },
      completion({ role: 'assistant', content: null, tool_calls: calls }, 'tool_calls')
    );
    const indexes = frames.flatMap((frame) =>
      (frame.choices[0].delta.tool_calls || []).map((part) => part.index)
    );
    expect(indexes).toEqual([0, 1]);
    expect(assemble(frames).calls).toEqual(calls);
  });

  test('text plus tool call keeps both, content before the call', async () => {
    const call = toolCall('call_t', 'get_weather', { location: 'Kiel' });
    const { frames } = await post(
      { model: 'cernion-agent-mvp', stream: true, messages: [{ role: 'user', content: 'x' }] },
      completion({ role: 'assistant', content: 'Ich prüfe das.', tool_calls: [call] }, 'tool_calls')
    );
    const deltas = frames.map((frame) => frame.choices[0].delta);
    expect(deltas[1]).toEqual({ content: 'Ich prüfe das.' });
    expect(deltas[2].tool_calls[0].id).toBe('call_t');
    expect(assemble(frames)).toEqual({
      content: 'Ich prüfe das.',
      calls: [call],
      finishReason: 'tool_calls',
    });
  });

  test('plain text SSE is unchanged', async () => {
    const { frames } = await post(
      { model: 'cernion-agent-mvp', stream: true, messages: [{ role: 'user', content: 'x' }] },
      completion({ role: 'assistant', content: 'Antwort.' }, 'stop')
    );
    expect(frames.map((frame) => frame.choices[0].delta)).toEqual([
      { role: 'assistant' },
      { content: 'Antwort.' },
      {},
    ]);
    expect(frames.at(-1).choices[0].finish_reason).toBe('stop');
  });

  test('round trip through the real facade: rebuilt call equals the JSON completion, follow-up streams text', async () => {
    llmClient.generateChat.mockResolvedValue({
      content: null,
      toolCalls: [{ name: 'get_weather', args: { location: 'Berlin' } }],
      finishReason: 'tool_calls',
    });
    const question = { role: 'user', content: 'Wie ist das Wetter in Berlin?' };
    const json = await OpenAICompatibleService.actions.chatCompletions.handler({
      params: { model: 'cernion-agent-mvp', messages: [question], tools: [weatherTool] },
      meta: { tenantId: 'tenant-tools', authUser: { userId: 'user-tools' } },
    });
    const first = await post({
      model: 'cernion-agent-mvp',
      stream: true,
      messages: [question],
      tools: [weatherTool],
    });
    const rebuilt = assemble(first.frames);
    expect(rebuilt.finishReason).toBe('tool_calls');
    expect(rebuilt.calls).toHaveLength(1);
    // Ids are generated per completion; everything else must match the non-streamed message.
    expect(rebuilt.calls[0]).toEqual({
      ...json.choices[0].message.tool_calls[0],
      id: expect.stringMatching(/^call_[0-9a-f]+$/),
    });
    // CET never runs the tool itself.
    expect(first.executed).toEqual([]);

    llmClient.generateChat.mockResolvedValue({
      content: 'In Berlin sind es 22 °C.',
      toolCalls: null,
      finishReason: 'stop',
    });
    const followUp = await post({
      model: 'cernion-agent-mvp',
      stream: true,
      tools: [weatherTool],
      messages: [
        question,
        { role: 'assistant', content: null, tool_calls: rebuilt.calls },
        { role: 'tool', tool_call_id: rebuilt.calls[0].id, content: '{"tempC":22}' },
      ],
    });
    const forwarded = llmClient.generateChat.mock.calls.at(-1)[0];
    expect(forwarded[2]).toMatchObject({ role: 'tool', tool_call_id: rebuilt.calls[0].id });
    expect(assemble(followUp.frames)).toEqual({
      content: 'In Berlin sind es 22 °C.',
      calls: [],
      finishReason: 'stop',
    });
  });
});
