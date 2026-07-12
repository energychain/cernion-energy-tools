const OpenAICompatibleService = require('../services/openai-compatible.service');

describe('OpenAI Compatible Service', () => {
  const handler = OpenAICompatibleService.actions.chatCompletions.handler;

  it('maps a non-streaming OpenAI chat request to askCernionAgent', async () => {
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
          domain: 'process',
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
        shortAnswer: 'Cernion advisory answer.',
        evidence: [{ source: 'test', value: 'evidence' }],
      }),
    };

    const result = await handler(ctx);

    expect(ctx.call).toHaveBeenCalledWith('personal-agent.askCernionAgent', {
      question:
        'System context: Stay read-only.\n\n' +
        'Developer context: Use Cernion evidence.\n\n' +
        'User: Was ist der Status?',
      sessionId: 'session-421',
      context: {
        objectId: 'case-421',
        openAiFacade: {
          model: 'cernion-agent-mvp',
          roles: ['system', 'developer', 'user'],
        },
      },
      inputs: { limit: 3 },
      domain: 'process',
      mode: 'answer',
      maxEvidence: 5,
    });
    expect(result.object).toBe('chat.completion');
    expect(result.model).toBe('cernion-agent-mvp');
    expect(result.choices[0].message).toEqual({
      role: 'assistant',
      content: 'Cernion advisory answer.',
    });
    expect(result.cernion.safety).toBe('advisory_compute_non_consequential');
  });

  it('rejects streaming in the MVP with an OpenAI-compatible error payload', async () => {
    const ctx = {
      params: {
        stream: true,
        messages: [{ role: 'user', content: 'Hallo' }],
      },
      meta: { authUser: { userId: 'tester', roles: ['full-access'] } },
      call: jest.fn(),
    };

    await expect(handler(ctx)).rejects.toMatchObject({
      code: 400,
      type: 'stream_not_supported',
      data: {
        openai: {
          error: {
            type: 'invalid_request_error',
            code: 'stream_not_supported',
          },
        },
      },
    });
    expect(ctx.call).not.toHaveBeenCalled();
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
});
