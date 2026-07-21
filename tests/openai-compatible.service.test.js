const OpenAICompatibleService = require('../services/openai-compatible.service');
const { CHAT_MODES } = require('../src/personal-agent-routing');

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
