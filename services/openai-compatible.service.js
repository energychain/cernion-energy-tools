const crypto = require('crypto');
const { Errors } = require('moleculer');
const { CHAT_MODES } = require('../src/personal-agent-routing');

const FACADE_MODEL = 'cernion-agent-mvp';
const SUPPORTED_MODELS = new Set([FACADE_MODEL, 'cernion-agent', 'gpt-4o-mini', 'gpt-4o']);

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

// Bounds for the structured conversation context we attach alongside `question`.
// These are deliberately small: this is a hint for genuine follow-ups, not a
// second retrieval query, so it must never be able to out-weigh the latest
// user message when Cernion evidence retrieval runs.
const MAX_PRIOR_TURNS = 6;
const MAX_PROMPT_HINTS = 4;
const CONTEXT_HINT_MAX_LENGTH = 400;

// Locate the newest user turn by role, not by array position: OpenWebUI always
// appends chronologically, but scanning from the end keeps this correct even if
// a client ever appends trailing system/developer messages after the question.
function findLatestUserMessageIndex(messages) {
  for (let index = messages.length - 1; index >= 0; index -= 1) {
    if (messages[index].role === 'user') return index;
  }
  return -1;
}

// Splits everything except the latest user message into two bounded, structured
// buckets instead of concatenating raw history into the retrieval query:
//  - promptHints: system/developer content, kept only as non-authoritative hints
//    (never authorization or tenant identity — that comes from ctx.meta).
//  - priorTurns: earlier user/assistant turns, for genuine follow-up questions,
//    truncated and capped so an old topic can never dominate the new one.
function buildConversationContext(messages, latestUserIndex) {
  const promptHints = [];
  const priorTurns = [];

  messages.forEach((message, index) => {
    if (index === latestUserIndex) return;
    if (message.role === 'system' || message.role === 'developer') {
      promptHints.push({
        role: message.role,
        content: compactString(message.content, CONTEXT_HINT_MAX_LENGTH),
      });
    } else if (
      index < latestUserIndex &&
      (message.role === 'user' || message.role === 'assistant')
    ) {
      priorTurns.push({
        role: message.role,
        content: compactString(message.content, CONTEXT_HINT_MAX_LENGTH),
      });
    }
  });

  return {
    promptHints: promptHints.slice(-MAX_PROMPT_HINTS),
    priorTurns: priorTurns.slice(-MAX_PRIOR_TURNS),
  };
}

// The outward OpenAI answer is always the finished, user-facing reply from
// personal-agent.chat (result.reply) — never groundingAnswer or
// consultingBrief, which are Copilot-composition inputs, not user answers.
// The fallback below only guards against a malformed/incomplete result.
function buildAssistantContent(result) {
  const reply = result?.reply;
  if (typeof reply === 'string' && reply.trim()) return compactString(reply, 6000);
  return 'Cernion was unable to generate an answer for this request.';
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
        summary: 'Create an OpenAI-compatible Cernion Personal Agent chat completion',
        description:
          'Inbound OpenAI-compatible facade over the authenticated Cernion Personal Agent ' +
          '(personal-agent.chat), synthesized internally with Gemini. Returns a complete, ' +
          'polished answer for the caller, not an evidence/grounding packet for a downstream ' +
          'Copilot. Always runs in consultation mode (no execution, no consequential process ' +
          'action) — this is a hard, non-negotiable safety boundary and cannot be overridden by ' +
          'request metadata. It treats system/developer messages and prior turns as non-authoritative ' +
          'prompt context, never as authorization; tenant identity and authorization always come from ' +
          'the caller session, not the request body. When stream=true, the gateway ' +
          '(services/api.service.js) obtains the full result from this action first and then emits it ' +
          'as buffered chat.completion.chunk SSE frames — this is not genuine token-by-token streaming.',
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
        // stream is accepted but ignored here: this action always computes the full
        // advisory result and returns a normal chat.completion object. The HTTP
        // gateway (handleOpenAiChatCompletions in services/api.service.js) is
        // responsible for re-framing that object as buffered SSE chunks when the
        // caller requested stream=true — this action must stay transport-agnostic.
        const requestedModel = String(ctx.params.model || FACADE_MODEL).trim() || FACADE_MODEL;
        if (!SUPPORTED_MODELS.has(requestedModel)) {
          throw openAiError(
            `Unsupported model '${requestedModel}'. Use '${FACADE_MODEL}'.`,
            400,
            'model_not_supported'
          );
        }

        const messages = normalizeMessages(ctx.params.messages);
        // The latest user message is the retrieval question. Older turns (including
        // prior assistant output and unrelated earlier topics) are never concatenated
        // into it — see buildConversationContext for how they are bounded instead.
        const latestUserIndex = findLatestUserMessageIndex(messages);
        const question = messages[latestUserIndex].content;
        const { promptHints, priorTurns } = buildConversationContext(messages, latestUserIndex);
        const metadata =
          ctx.params.metadata && typeof ctx.params.metadata === 'object' ? ctx.params.metadata : {};

        const result = await ctx.call('personal-agent.chat', {
          message: question,
          sessionId:
            typeof metadata.sessionId === 'string' && metadata.sessionId.trim()
              ? metadata.sessionId.trim()
              : undefined,
          // Hard safety boundary, non-negotiable: this facade only ever runs the
          // Personal Agent in consultation mode (no execution, no consequential
          // process action). It is forced here and is never read from request
          // metadata, so a caller cannot switch it to execution mode.
          chatMode: CHAT_MODES.CONSULTATION,
          knownContext: {
            ...(metadata.context && typeof metadata.context === 'object' ? metadata.context : {}),
            // Non-authoritative hints only. Tenant identity and execution
            // authorization always come from ctx.meta, never from here.
            openAiFacade: {
              model: requestedModel,
              roles: [...new Set(messages.map((message) => message.role))],
              promptHints,
              priorTurns,
            },
          },
          toolContext:
            metadata.inputs && typeof metadata.inputs === 'object' ? metadata.inputs : undefined,
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
            sourceAction: 'personal-agent.chat',
            safety: 'consultation_mode_forced_non_consequential',
            tenantId: ctx.meta.tenantId || ctx.meta.authUser?.tenantId || null,
            sessionId: result?.sessionId || null,
            result,
          },
        };
      },
    },
  },
};
