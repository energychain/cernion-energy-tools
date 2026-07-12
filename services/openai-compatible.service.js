const crypto = require('crypto');
const { Errors } = require('moleculer');

const FACADE_MODEL = 'cernion-agent-mvp';
const SUPPORTED_MODELS = new Set([FACADE_MODEL, 'cernion-agent', 'gpt-4o-mini', 'gpt-4o']);
const ROLE_LABELS = {
  system: 'System context',
  developer: 'Developer context',
  user: 'User',
  assistant: 'Assistant',
  tool: 'Tool',
};

function openAiError(message, statusCode = 400, code = 'invalid_request_error') {
  return new Errors.MoleculerClientError(message, statusCode, code, {
    openai: {
      error: {
        message,
        type: statusCode === 401 ? 'authentication_error' : 'invalid_request_error',
        code,
      },
    },
  });
}

function compactString(value, maxLength = 4000) {
  const text = String(value == null ? '' : value)
    .replace(/\s+/g, ' ')
    .trim();
  if (text.length <= maxLength) return text;
  return `${text.slice(0, Math.max(0, maxLength - 1)).trim()}…`;
}

function normalizeContent(content) {
  if (typeof content === 'string') return content;
  if (Array.isArray(content)) {
    return content
      .map((part) => {
        if (typeof part === 'string') return part;
        if (part?.type === 'text') return part.text || '';
        if (typeof part?.text === 'string') return part.text;
        return '';
      })
      .filter(Boolean)
      .join('\n');
  }
  return '';
}

function normalizeMessages(rawMessages) {
  if (!Array.isArray(rawMessages) || rawMessages.length === 0) {
    throw openAiError('messages must be a non-empty array.', 400, 'messages_required');
  }

  const messages = rawMessages.map((message, index) => {
    const role = String(message?.role || '')
      .trim()
      .toLowerCase();
    const content = compactString(normalizeContent(message?.content), 2000);

    if (!role) {
      throw openAiError(`messages[${index}].role is required.`, 400, 'message_role_required');
    }
    if (!content) {
      throw openAiError(`messages[${index}].content is required.`, 400, 'message_content_required');
    }

    return {
      role,
      content,
    };
  });

  if (!messages.some((message) => message.role === 'user')) {
    throw openAiError('At least one user message is required.', 400, 'user_message_required');
  }

  return messages;
}

function buildQuestion(messages) {
  return messages
    .map((message) => `${ROLE_LABELS[message.role] || message.role}: ${message.content}`)
    .join('\n\n');
}

function buildAssistantContent(result) {
  const candidates = [
    result?.shortAnswer,
    result?.groundingAnswer,
    result?.consultingBrief,
    result?.reply,
    result?.answer,
    result?.message,
  ];
  const content = candidates.find((value) => typeof value === 'string' && value.trim());
  if (content) return compactString(content, 6000);
  return compactString(JSON.stringify(result || {}), 6000) || 'Cernion returned no answer text.';
}

function estimateTokens(text) {
  if (!text) return 0;
  return Math.ceil(String(text).length / 4);
}

module.exports = {
  name: 'openai-compatible',

  actions: {
    chatCompletions: {
      params: {
        model: { type: 'string', optional: true, trim: true, max: 120 },
        messages: { type: 'array' },
        temperature: { type: 'number', optional: true, convert: true },
        max_tokens: { type: 'number', optional: true, integer: true, convert: true },
        metadata: { type: 'object', optional: true },
        stream: { type: 'boolean', optional: true, convert: true },
      },
      openapi: {
        operationId: 'createChatCompletion',
        tags: ['OpenAI Compatible'],
        summary: 'Create a non-streaming OpenAI-compatible Cernion chat completion',
        description:
          'Inbound OpenAI-compatible facade over existing authenticated Cernion advisory actions. ' +
          'It supports only non-streaming chat completions and treats system/developer messages as prompt context, not authorization.',
        requestBody: {
          required: true,
          content: {
            'application/json': {
              examples: {
                minimal: {
                  value: {
                    model: FACADE_MODEL,
                    messages: [
                      {
                        role: 'user',
                        content: 'Welche Cernion Evidenz ist fuer diesen Vorgang relevant?',
                      },
                    ],
                  },
                },
              },
              schema: {
                type: 'object',
                required: ['messages'],
                properties: {
                  model: { type: 'string', default: FACADE_MODEL },
                  messages: {
                    type: 'array',
                    items: {
                      type: 'object',
                      required: ['role', 'content'],
                      properties: {
                        role: { type: 'string' },
                        content: { type: 'string' },
                      },
                    },
                  },
                  temperature: { type: 'number' },
                  max_tokens: { type: 'integer' },
                  metadata: { type: 'object', additionalProperties: true },
                  stream: { type: 'boolean', default: false },
                },
              },
            },
          },
        },
        responses: {
          200: {
            description: 'OpenAI-compatible chat completion response',
            content: {
              'application/json': {
                schema: {
                  type: 'object',
                  required: ['id', 'object', 'created', 'model', 'choices', 'usage'],
                  properties: {
                    id: { type: 'string' },
                    object: { type: 'string', enum: ['chat.completion'] },
                    created: { type: 'integer' },
                    model: { type: 'string' },
                    choices: { type: 'array' },
                    usage: { type: 'object' },
                    cernion: { type: 'object', additionalProperties: true },
                  },
                },
              },
            },
          },
        },
      },
      async handler(ctx) {
        if (!ctx.meta?.authUser && !ctx.meta?.apiToken && !ctx.meta?.authSession) {
          throw openAiError('Authentication required.', 401, 'authentication_required');
        }
        if (ctx.params.stream === true) {
          throw openAiError(
            'stream=true is not supported by this MVP facade.',
            400,
            'stream_not_supported'
          );
        }

        const requestedModel = String(ctx.params.model || FACADE_MODEL).trim() || FACADE_MODEL;
        if (!SUPPORTED_MODELS.has(requestedModel)) {
          throw openAiError(
            `Unsupported model '${requestedModel}'. Use '${FACADE_MODEL}'.`,
            400,
            'model_not_supported'
          );
        }

        const messages = normalizeMessages(ctx.params.messages);
        const question = buildQuestion(messages);
        const metadata =
          ctx.params.metadata && typeof ctx.params.metadata === 'object' ? ctx.params.metadata : {};

        const result = await ctx.call('personal-agent.askCernionAgent', {
          question,
          sessionId:
            typeof metadata.sessionId === 'string' && metadata.sessionId.trim()
              ? metadata.sessionId.trim()
              : undefined,
          context: {
            ...(metadata.context && typeof metadata.context === 'object' ? metadata.context : {}),
            openAiFacade: {
              model: requestedModel,
              roles: [...new Set(messages.map((message) => message.role))],
            },
          },
          inputs: metadata.inputs && typeof metadata.inputs === 'object' ? metadata.inputs : {},
          domain: typeof metadata.domain === 'string' ? metadata.domain : 'auto',
          mode: typeof metadata.mode === 'string' ? metadata.mode : 'answer',
          maxEvidence: Number.isInteger(metadata.maxEvidence) ? metadata.maxEvidence : 5,
        });

        const content = buildAssistantContent(result);
        const promptTokens = estimateTokens(question);
        const completionTokens = estimateTokens(content);

        return {
          id: `chatcmpl_${crypto.randomUUID().replace(/-/g, '')}`,
          object: 'chat.completion',
          created: Math.floor(Date.now() / 1000),
          model: FACADE_MODEL,
          choices: [
            {
              index: 0,
              message: {
                role: 'assistant',
                content,
              },
              finish_reason: 'stop',
            },
          ],
          usage: {
            prompt_tokens: promptTokens,
            completion_tokens: completionTokens,
            total_tokens: promptTokens + completionTokens,
          },
          cernion: {
            facade: 'openai-compatible-chat-completions',
            sourceAction: 'personal-agent.askCernionAgent',
            safety: 'advisory_compute_non_consequential',
            tenantId: ctx.meta.tenantId || ctx.meta.authUser?.tenantId || null,
            sessionId: result?.sessionId || null,
            result,
          },
        };
      },
    },
  },
};
