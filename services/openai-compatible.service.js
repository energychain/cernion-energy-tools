const crypto = require('crypto');
const { Errors } = require('moleculer');
const { CHAT_MODES } = require('../src/personal-agent-routing');
const llmClient = require('../src/llm-client');

const FACADE_MODEL = 'cernion-agent-mvp';
const SUPPORTED_MODELS = new Set([FACADE_MODEL, 'cernion-agent', 'gpt-4o-mini', 'gpt-4o']);
const FACADE_IMAGE_MODEL = 'cernion-image-mvp';
const MAX_IMAGE_COUNT = 4;
const MAX_IMAGE_PROMPT_LENGTH = 4000;
const FACADE_EMBEDDING_MODEL = 'cernion-embedding-mvp';
const MAX_EMBEDDING_INPUTS = 100;

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

// Preserve Markdown structure in user-facing assistant replies. Input/context
// strings are deliberately compacted above, but collapsing output whitespace
// would turn headings, paragraphs and lists into an unreadable single line.
function compactMarkdown(value, maxLength = 6000) {
  const text = String(value == null ? '' : value)
    .replace(/\r\n?/g, '\n')
    .trim();
  if (text.length <= maxLength) return text;
  return `${text.slice(0, Math.max(0, maxLength - 1)).trimEnd()}…`;
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

    if (!role) {
      throw openAiError(`messages[${index}].role is required.`, 400, 'message_role_required');
    }

    // An assistant message that only carries tool_calls (the standard
    // OpenAI tool-calling turn) has no text content — content:null is
    // expected there, not a malformed request.
    const hasToolCalls =
      role === 'assistant' && Array.isArray(message?.tool_calls) && message.tool_calls.length > 0;
    const content = compactString(normalizeContent(message?.content), 2000);

    if (!content && !hasToolCalls) {
      throw openAiError(`messages[${index}].content is required.`, 400, 'message_content_required');
    }
    if (role === 'tool' && !message?.tool_call_id) {
      throw openAiError(
        `messages[${index}].tool_call_id is required for role="tool".`,
        400,
        'tool_call_id_required'
      );
    }

    const normalized = { role, content: content || null };
    if (hasToolCalls) normalized.tool_calls = message.tool_calls;
    if (message?.tool_call_id) normalized.tool_call_id = String(message.tool_call_id);
    if (message?.name) normalized.name = String(message.name);
    return normalized;
  });

  if (!messages.some((message) => message.role === 'user')) {
    throw openAiError('At least one user message is required.', 400, 'user_message_required');
  }

  return messages;
}

// Validates and normalizes OpenAI-shaped `tools` (function-calling
// declarations). Returns [] when no tools were supplied — chatCompletions
// uses that to decide between the existing Personal-Agent consultation path
// and the tool-calling path.
function normalizeTools(rawTools) {
  if (rawTools == null) return [];
  if (!Array.isArray(rawTools)) {
    throw openAiError('tools must be an array.', 400, 'tools_invalid');
  }

  return rawTools.map((tool, index) => {
    const name = tool?.function?.name;
    if (tool?.type !== 'function' || !name) {
      throw openAiError(
        `tools[${index}] must be a function tool with a non-empty function.name.`,
        400,
        'tool_invalid'
      );
    }
    return {
      type: 'function',
      function: {
        name: String(name),
        description: tool.function.description ? String(tool.function.description) : '',
        parameters:
          tool.function.parameters && typeof tool.function.parameters === 'object'
            ? tool.function.parameters
            : { type: 'object', properties: {} },
      },
    };
  });
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
  if (typeof reply === 'string' && reply.trim()) return compactMarkdown(reply, 6000);
  return 'Cernion was unable to generate an answer for this request.';
}

function estimateTokens(text) {
  if (!text) return 0;
  return Math.ceil(String(text).length / 4);
}

// Tool/function-calling completion: a direct call to the configured
// background LLM (default Gemini) via llm-client.generateChat, entirely
// separate from the Personal-Agent evidence/consultation pipeline used by
// the plain-chat path above. Cernion only ever reports which tool the model
// wants to call and with what arguments — it never invokes the tool itself;
// that remains the caller's responsibility, exactly like real OpenAI
// tool-calling.
async function buildToolCallingChatCompletion(ctx, messages, tools, requestedModel) {
  const result = await llmClient.generateChat(messages, {
    tools,
    toolChoice: ctx.params.tool_choice,
    model: requestedModel === FACADE_MODEL ? undefined : requestedModel,
    tenantId: ctx.meta.tenantId || ctx.meta.authUser?.tenantId || undefined,
  });

  const promptTokens = estimateTokens(messages.map((message) => message.content || '').join('\n'));

  let message;
  let finishReason;
  if (Array.isArray(result.toolCalls) && result.toolCalls.length > 0) {
    message = {
      role: 'assistant',
      content: null,
      tool_calls: result.toolCalls.map((call) => ({
        id: `call_${crypto.randomUUID().replace(/-/g, '')}`,
        type: 'function',
        function: { name: call.name, arguments: JSON.stringify(call.args || {}) },
      })),
    };
    finishReason = 'tool_calls';
  } else {
    message = { role: 'assistant', content: result.content || '' };
    finishReason = 'stop';
  }

  const completionTokens = estimateTokens(
    message.content || JSON.stringify(message.tool_calls || [])
  );

  return {
    id: `chatcmpl_${crypto.randomUUID().replace(/-/g, '')}`,
    object: 'chat.completion',
    created: Math.floor(Date.now() / 1000),
    model: requestedModel,
    choices: [
      {
        index: 0,
        message,
        finish_reason: finishReason,
      },
    ],
    usage: {
      prompt_tokens: promptTokens,
      completion_tokens: completionTokens,
      total_tokens: promptTokens + completionTokens,
    },
    cernion: {
      facade: 'openai-compatible-chat-completions-tool-calling',
      sourceAction: 'llm-client.generateChat',
      provider: llmClient.capabilities().provider,
      safety: 'tool_calls_returned_to_caller_for_execution_cernion_never_executes_a_tool',
      tenantId: ctx.meta.tenantId || ctx.meta.authUser?.tenantId || null,
    },
  };
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
        tools: { type: 'array', optional: true },
        tool_choice: { type: 'any', optional: true },
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
          'as buffered chat.completion.chunk SSE frames — this is not genuine token-by-token streaming. ' +
          'When `tools` is supplied (OpenAI function-calling declarations), this action takes a separate ' +
          'path: it calls the configured background LLM directly (bypassing the Personal-Agent evidence ' +
          'pipeline) via `llm-client.generateChat` and returns either a normal text reply or a ' +
          '`tool_calls` array for the caller to execute — Cernion itself never invokes any tool.',
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
                toolCalling: {
                  summary: 'Tool/function calling (bypasses the Personal-Agent evidence pipeline)',
                  value: {
                    messages: [{ role: 'user', content: 'Wie ist das Wetter in Berlin?' }],
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
                    tool_choice: 'auto',
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
                      required: ['role'],
                      properties: {
                        role: { type: 'string' },
                        content: { type: 'string', nullable: true },
                        tool_calls: { type: 'array' },
                        tool_call_id: { type: 'string' },
                        name: { type: 'string' },
                      },
                    },
                  },
                  temperature: { type: 'number' },
                  max_tokens: { type: 'integer' },
                  metadata: { type: 'object', additionalProperties: true },
                  stream: { type: 'boolean', default: false },
                  tools: {
                    type: 'array',
                    description: 'OpenAI-shaped function-calling tool declarations.',
                    items: {
                      type: 'object',
                      required: ['type', 'function'],
                      properties: {
                        type: { type: 'string', enum: ['function'] },
                        function: {
                          type: 'object',
                          required: ['name'],
                          properties: {
                            name: { type: 'string' },
                            description: { type: 'string' },
                            parameters: { type: 'object', additionalProperties: true },
                          },
                        },
                      },
                    },
                  },
                  tool_choice: {
                    description: '"auto" | "none" | "required" | {type:"function",function:{name}}',
                    oneOf: [
                      { type: 'string', enum: ['auto', 'none', 'required'] },
                      { type: 'object', additionalProperties: true },
                    ],
                  },
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
        const tools = normalizeTools(ctx.params.tools);

        // A caller-supplied `tools` array switches to a separate path: a
        // direct call to the configured background LLM (bypassing the
        // Personal-Agent evidence pipeline entirely), returning either a
        // normal reply or an OpenAI-shaped tool_calls array for the caller
        // to execute. Cernion never invokes a tool itself here — see
        // buildToolCallingChatCompletion.
        if (tools.length > 0) {
          return await buildToolCallingChatCompletion(ctx, messages, tools, requestedModel);
        }

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

    imageGenerations: {
      params: {
        prompt: { type: 'string', trim: true, min: 1, max: MAX_IMAGE_PROMPT_LENGTH },
        model: { type: 'string', optional: true, trim: true, max: 120 },
        n: {
          type: 'number',
          optional: true,
          integer: true,
          convert: true,
          min: 1,
          max: MAX_IMAGE_COUNT,
        },
        size: { type: 'string', optional: true, trim: true, max: 20 },
        response_format: {
          type: 'enum',
          optional: true,
          values: ['b64_json', 'url'],
          default: 'b64_json',
        },
      },
      openapi: {
        operationId: 'createImageGeneration',
        tags: ['OpenAI Compatible'],
        summary: 'Create an OpenAI-compatible image generation via the configured background model',
        description:
          'Inbound OpenAI-compatible facade over the configured Cernion LLM provider (default Gemini). ' +
          'Forwards the prompt to the background image-generation model and returns base64-encoded ' +
          'image data in the standard OpenAI images.generations response shape. Only `response_format: ' +
          '"b64_json"` is supported — no public URL/object storage is provisioned by this facade.',
        requestBody: {
          required: true,
          content: {
            'application/json': {
              examples: {
                minimal: {
                  value: {
                    prompt:
                      'Infografik: jaehrlicher Anstieg der PV-Einspeisung 2020-2026, Balkendiagramm',
                  },
                },
              },
              schema: {
                type: 'object',
                required: ['prompt'],
                properties: {
                  prompt: { type: 'string' },
                  model: { type: 'string', default: FACADE_IMAGE_MODEL },
                  n: { type: 'integer', minimum: 1, maximum: MAX_IMAGE_COUNT, default: 1 },
                  size: { type: 'string', example: '1024x1024' },
                  response_format: {
                    type: 'string',
                    enum: ['b64_json', 'url'],
                    default: 'b64_json',
                  },
                },
              },
            },
          },
        },
        responses: {
          200: {
            description: 'OpenAI-compatible image generation response',
            content: {
              'application/json': {
                schema: {
                  type: 'object',
                  required: ['created', 'data'],
                  properties: {
                    created: { type: 'integer' },
                    data: {
                      type: 'array',
                      items: {
                        type: 'object',
                        properties: { b64_json: { type: 'string' } },
                      },
                    },
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

        if (ctx.params.response_format === 'url') {
          throw openAiError(
            'response_format="url" is not supported by this facade. Use "b64_json".',
            400,
            'response_format_not_supported'
          );
        }

        const n = ctx.params.n || 1;
        const images = [];
        let lastResult = null;

        // Providers here return one image per call (matching Gemini's contract);
        // loop rather than pushing `n` upstream so every adapter behaves the same way.
        for (let i = 0; i < n; i += 1) {
          lastResult = await llmClient.generateImage(ctx.params.prompt, {
            model: ctx.params.model,
            size: ctx.params.size,
            tenantId: ctx.meta.tenantId || ctx.meta.authUser?.tenantId || undefined,
          });
          for (const image of lastResult.images) {
            images.push({ b64_json: image.b64Json });
          }
        }

        return {
          created: Math.floor(Date.now() / 1000),
          data: images,
          cernion: {
            facade: 'openai-compatible-image-generations',
            sourceAction: 'llm-client.generateImage',
            provider: llmClient.capabilities().provider,
            tenantId: ctx.meta.tenantId || ctx.meta.authUser?.tenantId || null,
            revisedPrompt: lastResult?.text || null,
          },
        };
      },
    },

    embeddings: {
      params: {
        input: {
          type: 'multi',
          rules: [
            { type: 'string', min: 1 },
            { type: 'array', min: 1, max: MAX_EMBEDDING_INPUTS, items: { type: 'string', min: 1 } },
          ],
        },
        model: { type: 'string', optional: true, trim: true, max: 120 },
        encoding_format: {
          type: 'enum',
          optional: true,
          values: ['float', 'base64'],
          default: 'float',
        },
      },
      openapi: {
        operationId: 'createEmbedding',
        tags: ['OpenAI Compatible'],
        summary: 'Create OpenAI-compatible text embeddings via the configured background model',
        description:
          'Inbound OpenAI-compatible facade over the configured Cernion LLM provider (default Gemini). ' +
          'Forwards one or more input strings to the background embedding model and returns vectors in ' +
          'the standard OpenAI embeddings response shape. Only `encoding_format: "float"` is supported.',
        requestBody: {
          required: true,
          content: {
            'application/json': {
              examples: {
                single: { value: { input: 'Marktkommunikation Evidenzkette' } },
                batch: { value: { input: ['APERAK Frist', 'UTILMD Strukturwechsel'] } },
              },
              schema: {
                type: 'object',
                required: ['input'],
                properties: {
                  input: {
                    oneOf: [
                      { type: 'string' },
                      { type: 'array', items: { type: 'string' }, maxItems: MAX_EMBEDDING_INPUTS },
                    ],
                  },
                  model: { type: 'string', default: FACADE_EMBEDDING_MODEL },
                  encoding_format: { type: 'string', enum: ['float', 'base64'], default: 'float' },
                },
              },
            },
          },
        },
        responses: {
          200: {
            description: 'OpenAI-compatible embeddings response',
            content: {
              'application/json': {
                schema: {
                  type: 'object',
                  required: ['object', 'data', 'model'],
                  properties: {
                    object: { type: 'string', enum: ['list'] },
                    data: {
                      type: 'array',
                      items: {
                        type: 'object',
                        properties: {
                          object: { type: 'string', enum: ['embedding'] },
                          index: { type: 'integer' },
                          embedding: { type: 'array', items: { type: 'number' } },
                        },
                      },
                    },
                    model: { type: 'string' },
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

        if (ctx.params.encoding_format === 'base64') {
          throw openAiError(
            'encoding_format="base64" is not supported by this facade. Use "float".',
            400,
            'encoding_format_not_supported'
          );
        }

        const inputs = Array.isArray(ctx.params.input) ? ctx.params.input : [ctx.params.input];
        const vectors = await llmClient.embeddings(inputs, {
          model: ctx.params.model,
          tenantId: ctx.meta.tenantId || ctx.meta.authUser?.tenantId || undefined,
        });

        const promptTokens = inputs.reduce((sum, text) => sum + estimateTokens(text), 0);

        return {
          object: 'list',
          data: vectors.map((embedding, index) => ({
            object: 'embedding',
            index,
            embedding,
          })),
          model: ctx.params.model || FACADE_EMBEDDING_MODEL,
          usage: {
            prompt_tokens: promptTokens,
            total_tokens: promptTokens,
          },
          cernion: {
            facade: 'openai-compatible-embeddings',
            sourceAction: 'llm-client.embeddings',
            provider: llmClient.capabilities().provider,
            tenantId: ctx.meta.tenantId || ctx.meta.authUser?.tenantId || null,
          },
        };
      },
    },
  },
};
