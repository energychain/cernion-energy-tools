jest.mock('../src/llm-client', () => ({
  generateImage: jest.fn(),
  embeddings: jest.fn(),
  generateChat: jest.fn(),
  capabilities: jest.fn(() => ({ provider: 'gemini' })),
}));

const OpenAICompatibleService = require('../services/openai-compatible.service');
const { CHAT_MODES } = require('../src/personal-agent-routing');
const llmClient = require('../src/llm-client');

describe('OpenAI Compatible Service', () => {
  const handler = OpenAICompatibleService.actions.chatCompletions.handler;

  it('maps a non-streaming OpenAI chat request to personal-agent.chat in consultation mode and returns the finished reply', async () => {
    const ctx = {
      params: {
        model: 'cernion-agent-mvp',
        messages: [
          { role: 'system', content: 'Stay read-only.' },
          { role: 'developer', content: 'Use Cernion evidence.' },
          { role: 'user', content: 'Was ist der Status?' },
        ],
        metadata: {
          sessionId: 'session-421',
          context: { objectId: 'case-421' },
          inputs: { limit: 3 },
        },
      },
      meta: {
        tenantId: 'tenant-421',
        authUser: { userId: 'tester', tenantId: 'tenant-421', roles: ['full-access'] },
      },
      call: jest.fn().mockResolvedValue({
        success: true,
        sessionId: 'session-421',
        chatMode: CHAT_MODES.CONSULTATION,
        reply: 'Cernion final answer for the user.',
        groundingAnswer: 'Copilot should treat this as evidence.',
        consultingBrief: 'Copilot instructions that must never leak to the user.',
      }),
    };

    const result = await handler(ctx);

    expect(ctx.call).toHaveBeenCalledWith('personal-agent.chat', {
      message: 'Was ist der Status?',
      sessionId: 'session-421',
      chatMode: CHAT_MODES.CONSULTATION,
      knownContext: {
        objectId: 'case-421',
        openAiFacade: {
          model: 'cernion-agent-mvp',
          roles: ['system', 'developer', 'user'],
          promptHints: [
            { role: 'system', content: 'Stay read-only.' },
            { role: 'developer', content: 'Use Cernion evidence.' },
          ],
          priorTurns: [],
        },
      },
      toolContext: { limit: 3 },
    });
    expect(result.object).toBe('chat.completion');
    expect(result.model).toBe('cernion-agent-mvp');
    expect(result.choices[0].message).toEqual({
      role: 'assistant',
      content: 'Cernion final answer for the user.',
    });
    expect(result.choices[0].message.content).not.toMatch(/Copilot/);
    expect(result.cernion.safety).toBe('consultation_mode_forced_non_consequential');
    expect(result.cernion.sourceAction).toBe('personal-agent.chat');
  });

  it('preserves Markdown paragraphs, headings and lists in the finished reply', async () => {
    const markdownReply = [
      '## Energy Sharing beitreten',
      '',
      'Typische Schritte:',
      '',
      '1. **Initiative finden**',
      '2. **Teilnahmebedingungen prüfen**',
      '',
      '> Rechtliche Pflichten hängen vom konkreten Modell ab.',
    ].join('\n');
    const ctx = {
      params: {
        messages: [{ role: 'user', content: 'Wie kann ich teilnehmen?' }],
      },
      meta: { authUser: { userId: 'tester', roles: ['full-access'] } },
      call: jest.fn().mockResolvedValue({
        success: true,
        sessionId: 'session-markdown',
        chatMode: CHAT_MODES.CONSULTATION,
        reply: markdownReply,
      }),
    };

    const result = await handler(ctx);

    expect(result.choices[0].message.content).toBe(markdownReply);
    expect(result.choices[0].message.content).toContain('\n\n1. **Initiative finden**');
  });

  it('single-turn: uses the only user message as message with empty bounded context', async () => {
    const ctx = {
      params: {
        messages: [{ role: 'user', content: 'Wie hoch ist die EEG-Verguetung?' }],
      },
      meta: { authUser: { userId: 'tester', roles: ['full-access'] } },
      call: jest.fn().mockResolvedValue({
        success: true,
        sessionId: 'session-single',
        chatMode: CHAT_MODES.CONSULTATION,
        reply: 'Antwort.',
      }),
    };

    const result = await handler(ctx);

    expect(ctx.call).toHaveBeenCalledWith(
      'personal-agent.chat',
      expect.objectContaining({
        message: 'Wie hoch ist die EEG-Verguetung?',
        chatMode: CHAT_MODES.CONSULTATION,
        knownContext: expect.objectContaining({
          openAiFacade: expect.objectContaining({
            promptHints: [],
            priorTurns: [],
          }),
        }),
      })
    );
    expect(result.choices[0].message.content).toBe('Antwort.');
  });

  it('topic switch: latest user message drives the chat call and does not leak the old topic into it', async () => {
    const ctx = {
      params: {
        messages: [
          { role: 'user', content: 'Wie funktionieren Optionsscheine beim Optionshandel?' },
          {
            role: 'assistant',
            content: 'Optionsscheine sind derivative Finanzinstrumente fuer den Optionshandel.',
          },
          { role: 'user', content: 'Erkläre mir, wie Energy Sharing funktioniert' },
        ],
      },
      meta: { authUser: { userId: 'tester', roles: ['full-access'] } },
      call: jest.fn().mockResolvedValue({
        success: true,
        sessionId: 'session-topic-switch',
        chatMode: CHAT_MODES.CONSULTATION,
        reply: 'Energy Sharing Antwort.',
      }),
    };

    await handler(ctx);

    const [, callArgs] = ctx.call.mock.calls[0];
    expect(callArgs.message).toBe('Erkläre mir, wie Energy Sharing funktioniert');
    expect(callArgs.message).not.toMatch(/Options/);
    expect(callArgs.knownContext.openAiFacade.priorTurns).toEqual([
      { role: 'user', content: 'Wie funktionieren Optionsscheine beim Optionshandel?' },
      {
        role: 'assistant',
        content: 'Optionsscheine sind derivative Finanzinstrumente fuer den Optionshandel.',
      },
    ]);
  });

  it('genuine follow-up: keeps prior turns as bounded structured context in knownContext only, not the primary message', async () => {
    const ctx = {
      params: {
        messages: [
          { role: 'user', content: 'Wie hoch ist die Verguetung fuer eine PV-Anlage?' },
          { role: 'assistant', content: 'Die Verguetung betraegt X ct/kWh laut EEG.' },
          { role: 'user', content: 'Und wenn ich zusaetzlich einen Speicher habe?' },
        ],
      },
      meta: { authUser: { userId: 'tester', roles: ['full-access'] } },
      call: jest.fn().mockResolvedValue({
        success: true,
        sessionId: 'session-followup',
        chatMode: CHAT_MODES.CONSULTATION,
        reply: 'Speicher-Antwort.',
      }),
    };

    await handler(ctx);

    const [, callArgs] = ctx.call.mock.calls[0];
    expect(callArgs.message).toBe('Und wenn ich zusaetzlich einen Speicher habe?');
    expect(callArgs.knownContext.openAiFacade.priorTurns).toEqual([
      { role: 'user', content: 'Wie hoch ist die Verguetung fuer eine PV-Anlage?' },
      { role: 'assistant', content: 'Die Verguetung betraegt X ct/kWh laut EEG.' },
    ]);
    // Bounded prior turns only ever live inside knownContext.openAiFacade —
    // never as part of the primary message sent for retrieval/synthesis.
    expect(Object.keys(callArgs)).not.toContain('priorTurns');
  });

  it('normalizes role case and bounds prior turns/prompt hints regardless of message order', async () => {
    const messages = [
      { role: '  System  ', content: 'Global hint 1.' },
      { role: 'Developer', content: 'Global hint 2.' },
      { role: 'system', content: 'Global hint 3.' },
      { role: 'system', content: 'Global hint 4.' },
      { role: 'system', content: 'Global hint 5 (should be dropped, over cap).' },
    ];
    for (let i = 0; i < 8; i += 1) {
      messages.push({ role: 'USER', content: `Old user turn ${i}` });
      messages.push({ role: 'Assistant', content: `Old assistant turn ${i}` });
    }
    messages.push({ role: 'user', content: 'Finale Frage: was jetzt?' });

    const ctx = {
      params: { messages },
      meta: { authUser: { userId: 'tester', roles: ['full-access'] } },
      call: jest.fn().mockResolvedValue({
        success: true,
        sessionId: 'session-bounds',
        chatMode: CHAT_MODES.CONSULTATION,
        reply: 'Antwort.',
      }),
    };

    await handler(ctx);

    const [, callArgs] = ctx.call.mock.calls[0];
    expect(callArgs.message).toBe('Finale Frage: was jetzt?');
    expect(callArgs.knownContext.openAiFacade.promptHints).toHaveLength(4);
    expect(callArgs.knownContext.openAiFacade.promptHints[0]).toEqual({
      role: 'developer',
      content: 'Global hint 2.',
    });
    expect(callArgs.knownContext.openAiFacade.promptHints[3]).toEqual({
      role: 'system',
      content: 'Global hint 5 (should be dropped, over cap).',
    });
    expect(callArgs.knownContext.openAiFacade.priorTurns).toHaveLength(6);
    expect(callArgs.knownContext.openAiFacade.priorTurns[0]).toEqual({
      role: 'user',
      content: 'Old user turn 5',
    });
    expect(callArgs.knownContext.openAiFacade.priorTurns[5]).toEqual({
      role: 'assistant',
      content: 'Old assistant turn 7',
    });
  });

  it('consultation mode cannot be overridden by request metadata', async () => {
    const ctx = {
      params: {
        messages: [{ role: 'user', content: 'Fuehre die Pruefung durch und schalte scharf.' }],
        metadata: {
          chatMode: CHAT_MODES.EXECUTION,
          mode: 'execution',
          domain: 'execution',
        },
      },
      meta: { authUser: { userId: 'tester', roles: ['full-access'] } },
      call: jest.fn().mockResolvedValue({
        success: true,
        sessionId: 'session-guard',
        chatMode: CHAT_MODES.CONSULTATION,
        reply: 'Antwort im Beratungsmodus.',
      }),
    };

    await handler(ctx);

    const [, callArgs] = ctx.call.mock.calls[0];
    expect(callArgs.chatMode).toBe(CHAT_MODES.CONSULTATION);
    expect(callArgs.chatMode).not.toBe(CHAT_MODES.EXECUTION);
  });

  it('falls back to a conservative message when the result is malformed and has no reply', async () => {
    const ctx = {
      params: {
        messages: [{ role: 'user', content: 'Hallo' }],
      },
      meta: { authUser: { userId: 'tester', roles: ['full-access'] } },
      call: jest.fn().mockResolvedValue({
        success: false,
        sessionId: 'session-malformed',
      }),
    };

    const result = await handler(ctx);

    expect(result.choices[0].message.content).toBe(
      'Cernion was unable to generate an answer for this request.'
    );
  });

  it('accepts stream=true and still returns a normal buffered chat.completion object', async () => {
    const ctx = {
      params: {
        stream: true,
        messages: [{ role: 'user', content: 'Hallo' }],
      },
      meta: { authUser: { userId: 'tester', roles: ['full-access'] } },
      call: jest.fn().mockResolvedValue({
        success: true,
        sessionId: 'session-stream',
        chatMode: CHAT_MODES.CONSULTATION,
        reply: 'Cernion advisory answer.',
      }),
    };

    const result = await handler(ctx);

    expect(ctx.call).toHaveBeenCalledWith('personal-agent.chat', expect.any(Object));
    expect(result.object).toBe('chat.completion');
    expect(result.choices[0].message.content).toBe('Cernion advisory answer.');
  });

  it('requires at least one user message', async () => {
    const ctx = {
      params: {
        messages: [{ role: 'system', content: 'Context only.' }],
      },
      meta: { authUser: { userId: 'tester', roles: ['full-access'] } },
      call: jest.fn(),
    };

    await expect(handler(ctx)).rejects.toMatchObject({
      code: 400,
      type: 'user_message_required',
    });
    expect(ctx.call).not.toHaveBeenCalled();
  });

  it('rejects an unsupported model with an OpenAI-compatible error payload', async () => {
    const ctx = {
      params: {
        model: 'gpt-5-turbo-not-real',
        messages: [{ role: 'user', content: 'Hallo' }],
      },
      meta: { authUser: { userId: 'tester', roles: ['full-access'] } },
      call: jest.fn(),
    };

    await expect(handler(ctx)).rejects.toMatchObject({
      code: 400,
      type: 'model_not_supported',
      data: {
        openai: {
          error: {
            type: 'invalid_request_error',
            code: 'model_not_supported',
          },
        },
      },
    });
    expect(ctx.call).not.toHaveBeenCalled();
  });
});

describe('OpenAI Compatible Service — chatCompletions tool/function calling', () => {
  const handler = OpenAICompatibleService.actions.chatCompletions.handler;
  const weatherTool = {
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
  };

  beforeEach(() => {
    llmClient.generateChat.mockReset();
    llmClient.capabilities.mockReset();
    llmClient.capabilities.mockReturnValue({ provider: 'gemini' });
  });

  it('bypasses personal-agent.chat entirely when tools are supplied', async () => {
    llmClient.generateChat.mockResolvedValue({
      content: null,
      toolCalls: [{ name: 'get_weather', args: { location: 'Berlin' } }],
      finishReason: 'tool_calls',
    });
    const ctx = {
      params: {
        messages: [{ role: 'user', content: 'Wie ist das Wetter in Berlin?' }],
        tools: [weatherTool],
      },
      meta: { tenantId: 'tenant-tools-1', authUser: { userId: 'tester', roles: ['full-access'] } },
      call: jest.fn(),
    };

    const result = await handler(ctx);

    expect(ctx.call).not.toHaveBeenCalled();
    expect(llmClient.generateChat).toHaveBeenCalledWith(
      [{ role: 'user', content: 'Wie ist das Wetter in Berlin?' }],
      expect.objectContaining({
        tools: [weatherTool],
        tenantId: 'tenant-tools-1',
      })
    );
    expect(result.choices[0].finish_reason).toBe('tool_calls');
    expect(result.choices[0].message).toEqual({
      role: 'assistant',
      content: null,
      tool_calls: [
        {
          id: expect.stringMatching(/^call_[0-9a-f]+$/),
          type: 'function',
          function: { name: 'get_weather', arguments: '{"location":"Berlin"}' },
        },
      ],
    });
    expect(result.cernion.facade).toBe('openai-compatible-chat-completions-tool-calling');
    expect(result.cernion.safety).toBe(
      'tool_calls_returned_to_caller_for_execution_cernion_never_executes_a_tool'
    );
  });

  it('forwards tool_choice to llm-client.generateChat', async () => {
    llmClient.generateChat.mockResolvedValue({
      content: 'ok',
      toolCalls: null,
      finishReason: 'stop',
    });
    const ctx = {
      params: {
        messages: [{ role: 'user', content: 'x' }],
        tools: [weatherTool],
        tool_choice: 'required',
      },
      meta: { authUser: { userId: 'tester', roles: ['full-access'] } },
    };

    await handler(ctx);

    expect(llmClient.generateChat).toHaveBeenCalledWith(
      expect.any(Array),
      expect.objectContaining({ toolChoice: 'required' })
    );
  });

  it('returns a plain assistant reply when the model does not call a tool', async () => {
    llmClient.generateChat.mockResolvedValue({
      content: 'Es tut mir leid, ich habe keine Standortangabe erhalten.',
      toolCalls: null,
      finishReason: 'stop',
    });
    const ctx = {
      params: {
        messages: [{ role: 'user', content: 'Wie ist das Wetter?' }],
        tools: [weatherTool],
      },
      meta: { authUser: { userId: 'tester', roles: ['full-access'] } },
    };

    const result = await handler(ctx);

    expect(result.choices[0].finish_reason).toBe('stop');
    expect(result.choices[0].message).toEqual({
      role: 'assistant',
      content: 'Es tut mir leid, ich habe keine Standortangabe erhalten.',
    });
  });

  it('round-trips a tool response message back into a follow-up completion', async () => {
    llmClient.generateChat.mockResolvedValue({
      content: 'In Berlin sind es aktuell 22°C und sonnig.',
      toolCalls: null,
      finishReason: 'stop',
    });
    const ctx = {
      params: {
        messages: [
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
        ],
        tools: [weatherTool],
      },
      meta: { authUser: { userId: 'tester', roles: ['full-access'] } },
    };

    const result = await handler(ctx);

    const [forwardedMessages] = llmClient.generateChat.mock.calls[0];
    expect(forwardedMessages[1]).toMatchObject({
      role: 'assistant',
      content: null,
      tool_calls: [
        {
          id: 'call_1',
          type: 'function',
          function: { name: 'get_weather', arguments: '{"location":"Berlin"}' },
        },
      ],
    });
    expect(forwardedMessages[2]).toMatchObject({
      role: 'tool',
      tool_call_id: 'call_1',
      content: '{"tempC":22,"condition":"sunny"}',
    });
    expect(result.choices[0].message.content).toBe('In Berlin sind es aktuell 22°C und sonnig.');
  });

  it('rejects a tool without type=function', async () => {
    const ctx = {
      params: {
        messages: [{ role: 'user', content: 'x' }],
        tools: [{ type: 'not-a-function', function: { name: 'x' } }],
      },
      meta: { authUser: { userId: 'tester', roles: ['full-access'] } },
    };

    await expect(handler(ctx)).rejects.toMatchObject({ code: 400, type: 'tool_invalid' });
    expect(llmClient.generateChat).not.toHaveBeenCalled();
  });

  it('rejects a tool with a missing function name', async () => {
    const ctx = {
      params: {
        messages: [{ role: 'user', content: 'x' }],
        tools: [{ type: 'function', function: {} }],
      },
      meta: { authUser: { userId: 'tester', roles: ['full-access'] } },
    };

    await expect(handler(ctx)).rejects.toMatchObject({ code: 400, type: 'tool_invalid' });
  });

  it('propagates a capability-missing failure from llm-client without swallowing it', async () => {
    llmClient.generateChat.mockRejectedValue(
      Object.assign(
        new Error('Der konfigurierte LLM Provider unterstützt kein Tool-/Function-Calling.'),
        {
          code: 503,
          type: 'LLM_CAPABILITY_MISSING',
        }
      )
    );
    const ctx = {
      params: {
        messages: [{ role: 'user', content: 'x' }],
        tools: [weatherTool],
      },
      meta: { authUser: { userId: 'tester', roles: ['full-access'] } },
    };

    await expect(handler(ctx)).rejects.toMatchObject({ code: 503 });
  });
});

describe('OpenAI Compatible Service — imageGenerations action', () => {
  const handler = OpenAICompatibleService.actions.imageGenerations.handler;

  beforeEach(() => {
    llmClient.generateImage.mockReset();
    llmClient.capabilities.mockReset();
    llmClient.capabilities.mockReturnValue({ provider: 'gemini' });
  });

  it('forwards the prompt to llm-client.generateImage and returns an OpenAI-shaped b64_json response', async () => {
    llmClient.generateImage.mockResolvedValue({
      images: [{ b64Json: 'ZmFrZS1wbmc=', mimeType: 'image/png' }],
      text: null,
    });
    const ctx = {
      params: { prompt: 'Infografik: PV-Einspeisung 2020-2026' },
      meta: { tenantId: 'tenant-img-1', authUser: { userId: 'tester', roles: ['full-access'] } },
    };

    const result = await handler(ctx);

    expect(llmClient.generateImage).toHaveBeenCalledWith(
      'Infografik: PV-Einspeisung 2020-2026',
      expect.objectContaining({ tenantId: 'tenant-img-1' })
    );
    expect(result.data).toEqual([{ b64_json: 'ZmFrZS1wbmc=' }]);
    expect(typeof result.created).toBe('number');
    expect(result.cernion.facade).toBe('openai-compatible-image-generations');
    expect(result.cernion.provider).toBe('gemini');
  });

  it('loops per requested image count, one provider call per image', async () => {
    llmClient.generateImage
      .mockResolvedValueOnce({ images: [{ b64Json: 'aaa', mimeType: 'image/png' }], text: null })
      .mockResolvedValueOnce({ images: [{ b64Json: 'bbb', mimeType: 'image/png' }], text: null });
    const ctx = {
      params: { prompt: 'Diagramm', n: 2 },
      meta: { authUser: { userId: 'tester', roles: ['full-access'] } },
    };

    const result = await handler(ctx);

    expect(llmClient.generateImage).toHaveBeenCalledTimes(2);
    expect(result.data).toEqual([{ b64_json: 'aaa' }, { b64_json: 'bbb' }]);
  });

  it('rejects response_format=url with an OpenAI-compatible error', async () => {
    const ctx = {
      params: { prompt: 'Diagramm', response_format: 'url' },
      meta: { authUser: { userId: 'tester', roles: ['full-access'] } },
    };

    await expect(handler(ctx)).rejects.toMatchObject({
      code: 400,
      type: 'response_format_not_supported',
    });
    expect(llmClient.generateImage).not.toHaveBeenCalled();
  });

  it('requires authentication', async () => {
    const ctx = { params: { prompt: 'Diagramm' }, meta: {} };

    await expect(handler(ctx)).rejects.toMatchObject({
      code: 401,
      type: 'authentication_required',
    });
    expect(llmClient.generateImage).not.toHaveBeenCalled();
  });

  it('propagates a capability-missing failure from llm-client without swallowing it', async () => {
    llmClient.generateImage.mockRejectedValue(
      Object.assign(
        new Error('Der konfigurierte LLM Provider unterstützt keine Bildgenerierung.'),
        {
          code: 503,
          type: 'LLM_CAPABILITY_MISSING',
        }
      )
    );
    const ctx = {
      params: { prompt: 'Diagramm' },
      meta: { authUser: { userId: 'tester', roles: ['full-access'] } },
    };

    await expect(handler(ctx)).rejects.toMatchObject({ code: 503 });
  });
});

describe('OpenAI Compatible Service — embeddings action', () => {
  const handler = OpenAICompatibleService.actions.embeddings.handler;

  beforeEach(() => {
    llmClient.embeddings.mockReset();
    llmClient.capabilities.mockReset();
    llmClient.capabilities.mockReturnValue({ provider: 'gemini' });
  });

  it('wraps a single string input in an array and returns an OpenAI-shaped list response', async () => {
    llmClient.embeddings.mockResolvedValue([[0.1, 0.2, 0.3]]);
    const ctx = {
      params: { input: 'Marktkommunikation Evidenzkette' },
      meta: { tenantId: 'tenant-emb-1', authUser: { userId: 'tester', roles: ['full-access'] } },
    };

    const result = await handler(ctx);

    expect(llmClient.embeddings).toHaveBeenCalledWith(
      ['Marktkommunikation Evidenzkette'],
      expect.objectContaining({ tenantId: 'tenant-emb-1' })
    );
    expect(result.object).toBe('list');
    expect(result.data).toEqual([{ object: 'embedding', index: 0, embedding: [0.1, 0.2, 0.3] }]);
    expect(result.model).toBe('cernion-embedding-mvp');
    expect(result.cernion.facade).toBe('openai-compatible-embeddings');
    expect(result.cernion.provider).toBe('gemini');
  });

  it('preserves order for a batch array input', async () => {
    llmClient.embeddings.mockResolvedValue([
      [1, 0, 0],
      [0, 1, 0],
    ]);
    const ctx = {
      params: { input: ['APERAK Frist', 'UTILMD Strukturwechsel'] },
      meta: { authUser: { userId: 'tester', roles: ['full-access'] } },
    };

    const result = await handler(ctx);

    expect(llmClient.embeddings).toHaveBeenCalledWith(
      ['APERAK Frist', 'UTILMD Strukturwechsel'],
      expect.any(Object)
    );
    expect(result.data).toEqual([
      { object: 'embedding', index: 0, embedding: [1, 0, 0] },
      { object: 'embedding', index: 1, embedding: [0, 1, 0] },
    ]);
  });

  it('rejects encoding_format=base64 with an OpenAI-compatible error', async () => {
    const ctx = {
      params: { input: 'text', encoding_format: 'base64' },
      meta: { authUser: { userId: 'tester', roles: ['full-access'] } },
    };

    await expect(handler(ctx)).rejects.toMatchObject({
      code: 400,
      type: 'encoding_format_not_supported',
    });
    expect(llmClient.embeddings).not.toHaveBeenCalled();
  });

  it('requires authentication', async () => {
    const ctx = { params: { input: 'text' }, meta: {} };

    await expect(handler(ctx)).rejects.toMatchObject({
      code: 401,
      type: 'authentication_required',
    });
    expect(llmClient.embeddings).not.toHaveBeenCalled();
  });

  it('propagates a capability-missing failure from llm-client without swallowing it', async () => {
    llmClient.embeddings.mockRejectedValue(
      Object.assign(new Error('Der konfigurierte LLM Provider unterstützt keine Embeddings.'), {
        code: 503,
        type: 'LLM_CAPABILITY_MISSING',
      })
    );
    const ctx = {
      params: { input: 'text' },
      meta: { authUser: { userId: 'tester', roles: ['full-access'] } },
    };

    await expect(handler(ctx)).rejects.toMatchObject({ code: 503 });
  });
});
