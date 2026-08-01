'use strict';

const { GoogleGenerativeAI } = require('@google/generative-ai');
const { MoleculerError } = require('moleculer').Errors;

const DEFAULT_MODEL = 'gemini-2.0-flash';
const DEFAULT_EMBEDDING_MODEL = 'gemini-embedding-001';
const DEFAULT_IMAGE_MODEL = 'gemini-2.5-flash-image';

function requireGeminiApiKey() {
  const key = process.env.LLM_API_KEY || process.env.GEMINI_API_KEY;
  if (!key) {
    throw new MoleculerError(
      'Cernion KI-Funktionen erfordern einen konfigurierten API-Key (LLM_API_KEY oder GEMINI_API_KEY).',
      503,
      'LLM_NOT_CONFIGURED'
    );
  }
  return key;
}

function getModelName() {
  return process.env.LLM_MODEL || process.env.GEMINI_MODEL || DEFAULT_MODEL;
}

function getEmbeddingModelName() {
  return (
    process.env.LLM_EMBEDDING_MODEL || process.env.GEMINI_EMBEDDING_MODEL || DEFAULT_EMBEDDING_MODEL
  );
}

function getImageModelName() {
  return process.env.LLM_IMAGE_MODEL || process.env.GEMINI_IMAGE_MODEL || DEFAULT_IMAGE_MODEL;
}

function getClient() {
  const apiKey = requireGeminiApiKey();
  return new GoogleGenerativeAI(apiKey);
}

async function generateText(prompt) {
  const model = getClient().getGenerativeModel({ model: getModelName() });
  const result = await model.generateContent(prompt);
  return result.response.text();
}

async function generateStructured(schema, prompt, options = {}) {
  const mode = options.structuredMode || 'schema';

  if (mode === 'json' || mode === 'tool') {
    return await generateText(prompt);
  }

  const model = getClient().getGenerativeModel({
    model: getModelName(),
    generationConfig: {
      responseMimeType: 'application/json',
      responseSchema: schema,
    },
  });
  const result = await model.generateContent(prompt);
  return result.response.text();
}

async function embeddings(texts) {
  const model = getClient().getGenerativeModel({ model: getEmbeddingModelName() });
  const vectors = [];

  for (const text of texts) {
    const response = await model.embedContent(String(text || ''));
    vectors.push(Array.isArray(response?.embedding?.values) ? response.embedding.values : []);
  }

  return vectors;
}

// Requests both modalities: Gemini image-generation models only return image
// parts when TEXT is also requested (an IMAGE-only request is rejected).
const IMAGE_GENERATION_CONFIG = { responseModalities: ['TEXT', 'IMAGE'] };

async function generateImage(prompt, options = {}) {
  const model = getClient().getGenerativeModel({
    model: options.model || getImageModelName(),
    generationConfig: IMAGE_GENERATION_CONFIG,
  });
  const result = await model.generateContent(prompt);
  const parts = result?.response?.candidates?.[0]?.content?.parts || [];

  const images = parts
    .filter((part) => part?.inlineData?.data)
    .map((part) => ({
      b64Json: part.inlineData.data,
      mimeType: part.inlineData.mimeType || 'image/png',
    }));

  if (images.length === 0) {
    throw new MoleculerError(
      'Gemini returned no image data for this prompt (it may have been blocked or the model only produced text).',
      502,
      'IMAGE_GENERATION_NO_IMAGE'
    );
  }

  const text = parts
    .filter((part) => typeof part?.text === 'string')
    .map((part) => part.text)
    .join('\n')
    .trim();

  return { images, text: text || null };
}

// Translates OpenAI-shaped chat messages (role, content, and — for the
// tool-calling turn sequence — tool_calls / tool_call_id / name) into
// Gemini's `contents` array plus a combined systemInstruction string.
// System/developer messages never become part of `contents`: Gemini has no
// "system" role, and mixing prompt-context into a user/model turn would let
// it compete with the actual conversation on equal footing.
function buildGeminiContents(messages) {
  const contents = [];
  const systemParts = [];
  const toolCallNameById = new Map();

  for (const message of messages) {
    const role = message?.role;

    if (role === 'system' || role === 'developer') {
      if (message.content) systemParts.push(String(message.content));
      continue;
    }

    if (role === 'user') {
      contents.push({ role: 'user', parts: [{ text: String(message.content || '') }] });
      continue;
    }

    if (role === 'assistant') {
      if (Array.isArray(message.tool_calls) && message.tool_calls.length > 0) {
        const parts = message.tool_calls.map((call) => {
          const name = call?.function?.name || 'unknown_function';
          let args = {};
          try {
            args = JSON.parse(call?.function?.arguments || '{}');
          } catch (_err) {
            process.stderr.write(
              `[gemini] silent-catch-fallback (line 144): ${_err && _err.message}\n`
            );
            args = {};
          }
          if (call?.id) toolCallNameById.set(call.id, name);
          return { functionCall: { name, args } };
        });
        contents.push({ role: 'model', parts });
      } else {
        contents.push({ role: 'model', parts: [{ text: String(message.content || '') }] });
      }
      continue;
    }

    if (role === 'tool') {
      const name = toolCallNameById.get(message.tool_call_id) || message.name || 'unknown_function';
      let responsePayload;
      try {
        responsePayload = JSON.parse(message.content);
      } catch (_err) {
        process.stderr.write(
          `[gemini] silent-catch-fallback (line 162): ${_err && _err.message}\n`
        );
        responsePayload = { result: message.content ?? null };
      }
      contents.push({
        role: 'function',
        parts: [{ functionResponse: { name, response: responsePayload } }],
      });
    }
  }

  return {
    contents,
    systemInstruction: systemParts.length > 0 ? systemParts.join('\n') : undefined,
  };
}

const TOOL_CHOICE_MODE = { auto: 'AUTO', none: 'NONE', required: 'ANY' };

// Translates an OpenAI-shaped `tool_choice` (string or {type,function:{name}})
// into Gemini's toolConfig.functionCallingConfig. Returns undefined when no
// tools were supplied — Gemini's default (AUTO) applies without an explicit
// toolConfig block.
function buildGeminiToolConfig(toolChoice) {
  if (toolChoice == null) return undefined;
  if (typeof toolChoice === 'string') {
    const mode = TOOL_CHOICE_MODE[toolChoice];
    return mode ? { functionCallingConfig: { mode } } : undefined;
  }
  const name = toolChoice?.function?.name;
  if (toolChoice?.type === 'function' && name) {
    return { functionCallingConfig: { mode: 'ANY', allowedFunctionNames: [name] } };
  }
  return undefined;
}

function toGeminiFunctionDeclarations(tools) {
  return (Array.isArray(tools) ? tools : [])
    .filter((tool) => tool?.type === 'function' && tool?.function?.name)
    .map((tool) => ({
      name: tool.function.name,
      description: tool.function.description || '',
      parameters: tool.function.parameters || { type: 'object', properties: {} },
    }));
}

// Chat completion with OpenAI-shaped tool/function-calling support. Only
// meaningfully differs from generateText once `options.tools` is supplied —
// callers without tools get a plain text reply, same as generateText.
async function generateChat(messages, options = {}) {
  const { contents, systemInstruction } = buildGeminiContents(messages);
  const functionDeclarations = toGeminiFunctionDeclarations(options.tools);

  const modelParams = { model: options.model || getModelName() };
  if (systemInstruction) modelParams.systemInstruction = systemInstruction;
  if (functionDeclarations.length > 0) {
    modelParams.tools = [{ functionDeclarations }];
    const toolConfig = buildGeminiToolConfig(options.toolChoice);
    if (toolConfig) modelParams.toolConfig = toolConfig;
  }

  const model = getClient().getGenerativeModel(modelParams);
  const result = await model.generateContent({ contents });
  const response = result.response;

  const functionCalls =
    typeof response.functionCalls === 'function' ? response.functionCalls() : null;
  if (Array.isArray(functionCalls) && functionCalls.length > 0) {
    return {
      content: null,
      toolCalls: functionCalls.map((call) => ({ name: call.name, args: call.args || {} })),
      finishReason: 'tool_calls',
    };
  }

  return { content: response.text(), toolCalls: null, finishReason: 'stop' };
}

function capabilities() {
  return {
    structured: true,
    embeddings: true,
    vision: false,
    imageGeneration: true,
    toolCalling: true,
    contextWindow: null,
  };
}

module.exports = {
  id: 'gemini',
  generateText,
  generateStructured,
  embeddings,
  generateImage,
  generateChat,
  capabilities,
};
