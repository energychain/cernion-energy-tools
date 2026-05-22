'use strict';

const OPENAPI_ACTION_KEY = 'x-moleculer-action';

function parseServiceAction(fullName) {
  const normalized = String(fullName || '').trim();
  const parts = normalized.split('.').filter(Boolean);
  if (parts.length < 2) {
    return { serviceName: normalized, actionName: '' };
  }
  const actionName = parts.pop();
  return {
    serviceName: parts.join('.'),
    actionName,
  };
}

function normalizeScalarType(type) {
  if (type === 'number') return 'number';
  if (type === 'boolean') return 'boolean';
  if (type === 'array') return 'array';
  if (type === 'object') return 'object';
  return 'string';
}

function mapPropertySchema(definition, key) {
  if (typeof definition === 'string') {
    return { type: normalizeScalarType(definition), description: key };
  }

  const source = definition && typeof definition === 'object' ? definition : {};
  const property = {
    type: normalizeScalarType(source.type),
    description: source.description || key,
  };

  if (Array.isArray(source.values) && source.values.length > 0) {
    property.enum = source.values.slice(0, 200);
  }

  if (property.type === 'number') {
    if (typeof source.min === 'number') property.minimum = source.min;
    if (typeof source.max === 'number') property.maximum = source.max;
  }

  if (property.type === 'array') {
    if (source.items && typeof source.items === 'object') {
      property.items = mapPropertySchema(source.items, `${key}[]`);
    } else {
      property.items = { type: 'string' };
    }
  }

  if (property.type === 'object' && source.props && typeof source.props === 'object') {
    const nestedSchema = moleculerParamsToJsonSchema(source.props);
    property.properties = nestedSchema.properties;
    if (nestedSchema.required.length > 0) {
      property.required = nestedSchema.required;
    }
  }

  return property;
}

function moleculerParamsToJsonSchema(moleculerParams) {
  const schema = {
    type: 'object',
    additionalProperties: false,
    properties: {},
    required: [],
  };

  if (!moleculerParams || typeof moleculerParams !== 'object') {
    return schema;
  }

  for (const [key, definition] of Object.entries(moleculerParams)) {
    schema.properties[key] = mapPropertySchema(definition, key);
    if (!(definition && typeof definition === 'object' && definition.optional)) {
      schema.required.push(key);
    }
  }

  return schema;
}

function openApiOperationToSchema(operation = {}) {
  const bodySchema = operation?.requestBody?.content?.['application/json']?.schema;
  if (bodySchema && typeof bodySchema === 'object') {
    return bodySchema;
  }

  if (!Array.isArray(operation.parameters) || operation.parameters.length === 0) {
    return null;
  }

  const schema = {
    type: 'object',
    additionalProperties: false,
    properties: {},
    required: [],
  };

  for (const parameter of operation.parameters) {
    const key = String(parameter?.name || '').trim();
    if (!key) continue;
    const parameterSchema = parameter?.schema && typeof parameter.schema === 'object' ? parameter.schema : {};
    schema.properties[key] = {
      type: normalizeScalarType(parameterSchema.type),
      description: parameterSchema.description || parameter.description || key,
      enum: Array.isArray(parameterSchema.enum) ? parameterSchema.enum : undefined,
    };
    if (parameter?.required) {
      schema.required.push(key);
    }
  }

  return schema;
}

async function getToolParamSchema(ctx, toolName, options = {}) {
  const { allowOpenApiFallback = true } = options;
  const { serviceName, actionName } = parseServiceAction(toolName);

  if (!serviceName || !actionName) {
    return { schema: null, source: 'invalid-tool' };
  }

  try {
    const broker = ctx?.broker;
    if (broker && typeof broker.getLocalService === 'function') {
      const localService = broker.getLocalService(serviceName);
      const action = localService?.actions?.[actionName];
      const schemaAction = localService?.schema?.actions?.[actionName];
      const paramsSchema =
        (action?.params && typeof action.params === 'object' && action.params) ||
        (schemaAction?.params && typeof schemaAction.params === 'object' && schemaAction.params) ||
        null;

      if (paramsSchema) {
        return {
          schema: moleculerParamsToJsonSchema(paramsSchema),
          source: 'moleculer',
        };
      }
    }
  } catch (_error) {
    // fail over to OpenAPI below
  }

  const hasLocalApiService =
    !!ctx?.broker &&
    typeof ctx.broker.hasLocalService === 'function' &&
    ctx.broker.hasLocalService('api');

  if (!allowOpenApiFallback || !hasLocalApiService || typeof ctx?.call !== 'function') {
    return { schema: null, source: 'missing' };
  }

  try {
    const openApi = await ctx.call('api.openapi', {}, { meta: { ...ctx.meta, $gateway: false } });
    const normalizedOperationId = `${serviceName}.${actionName}`.replace(/\./g, '_').replace(/-/g, '_');
    const paths = openApi?.paths && typeof openApi.paths === 'object' ? openApi.paths : {};

    for (const pathItem of Object.values(paths)) {
      if (!pathItem || typeof pathItem !== 'object') continue;

      for (const method of ['get', 'post', 'put', 'patch', 'delete']) {
        const operation = pathItem[method];
        if (!operation || typeof operation !== 'object') continue;

        const matchesAction =
          operation[OPENAPI_ACTION_KEY] === `${serviceName}.${actionName}` ||
          operation.operationId === normalizedOperationId;

        if (!matchesAction) continue;

        return {
          schema: openApiOperationToSchema(operation),
          source: 'openapi',
        };
      }
    }
  } catch (_error) {
    return { schema: null, source: 'missing' };
  }

  return { schema: null, source: 'missing' };
}

function extractJsonObject(raw) {
  const match = String(raw || '').match(/\{[\s\S]*\}/);
  if (!match) return null;
  try {
    return JSON.parse(match[0]);
  } catch (_error) {
    return null;
  }
}

function pickKnownFields(schema, params) {
  if (!schema?.properties || typeof params !== 'object' || !params) {
    return params && typeof params === 'object' ? params : {};
  }

  const knownKeys = Object.keys(schema.properties);
  const picked = {};
  for (const key of knownKeys) {
    if (params[key] !== undefined && params[key] !== null) {
      picked[key] = params[key];
    }
  }
  return picked;
}

function validateRequired(schema, params) {
  const required = Array.isArray(schema?.required) ? schema.required : [];
  const missing = required.filter((field) => {
    const value = params[field];
    return value === undefined || value === null || String(value).trim() === '';
  });
  return missing;
}

async function buildToolParametersLLM(ctx, payload = {}) {
  const {
    toolName,
    schema,
    knownFacts,
    userMessage,
    attempt = 1,
    generate,
    parser = extractJsonObject,
  } = payload;

  if (!schema || typeof schema !== 'object') {
    return {
      params: null,
      error: `SCHEMA_UNAVAILABLE: Kein Schema für ${toolName} verfügbar.`,
      attempt,
      source: 'schema-missing',
    };
  }

  const llmGenerate =
    typeof generate === 'function'
      ? generate
      : async (request) => ctx.call('llm.generate', request, { meta: { ...ctx.meta, $gateway: false } });

  const retryHint =
    attempt > 1
      ? `\nVorheriger Versuch ${attempt - 1} war unzureichend.\nWICHTIG: Verwende NUR die oben genannten Feldnamen. Keine alternativen Namen wie 'address', 'ort', 'plz', 'company', 'name'.`
      : '';

  const allowedFields = Object.keys(schema.properties || {});
  const requiredFields = Array.isArray(schema.required) ? schema.required : [];

  const system = [
    'Du bist ein API-Parameter-Generator für ein Energie-Beratungssystem.',
    `Erzeuge nur eine JSON-Payload für den Tool-Call "${toolName}".`,
    '',
    `ERLAUBTE FELDER (nur diese verwenden): ${allowedFields.join(', ')}`,
    requiredFields.length > 0 ? `PFlichtfelder: ${requiredFields.join(', ')}` : '',
    '',
    'SCHEMA:',
    JSON.stringify(schema, null, 2),
    '',
    'REGELN:',
    '- NUTZE AUSSCHLIESSLICH die erlaubten Feldnamen aus der Liste oben.',
    '- KEINE alternativen Feldnamen wie "address", "ort", "plz", "company", "name" verwenden.',
    '- Fehlende optionale Felder weglassen.',
    '- Pflichtfelder bestmöglich aus Fakten/Nutzertext ableiten.',
    '- Keine Markdown-Ausgabe, nur ein JSON-Objekt.',
    retryHint,
  ].join('\n');

  const user = [
    `Nutzerfrage: "${String(userMessage || '').trim()}"`,
    `Bekannte Fakten: ${JSON.stringify(knownFacts || {}, null, 2)}`,
    `Attempt: ${attempt}`,
    `ERLAUBTE FELDER: ${allowedFields.join(', ')}`,
    requiredFields.length > 0 ? `Du MUSST zumindest folgende Felder setzen: ${requiredFields.join(', ')}` : '',
  ].join('\n');

  try {
    const response = await llmGenerate({
      system,
      user,
      temperature: Math.min(0.25, 0.1 + (attempt - 1) * 0.05),
      maxTokens: 512,
    });

    const parsed = parser(response?.text || response?.content || response);
    if (!parsed || typeof parsed !== 'object') {
      return {
        params: null,
        error: 'LLM_RESPONSE_INVALID_JSON',
        attempt,
        source: 'llm-invalid',
      };
    }

    const cleaned = pickKnownFields(schema, parsed);
    const missing = validateRequired(schema, cleaned);

    if (missing.length > 0) {
      return {
        params: null,
        error: `MISSING_REQUIRED: ${missing.join(', ')}`,
        attempt,
        source: 'llm-missing-required',
      };
    }

    return {
      params: cleaned,
      attempt,
      source: 'llm-generated',
      rawThought: String(response?.text || response?.content || '').slice(0, 200),
    };
  } catch (error) {
    return {
      params: null,
      error: error?.message || 'LLM_GENERATION_FAILED',
      attempt,
      source: 'llm-failed',
    };
  }
}

function isEmptyOrError(result) {
  if (!result) return true;
  if (Array.isArray(result)) return result.length === 0;

  if (typeof result === 'object') {
    if (result.success === false || result.error) return true;

    const data = result.data !== undefined ? result.data : result;

    if (Array.isArray(data?.results) && data.results.length === 0) {
      return true;
    }

    if (Array.isArray(data) && data.length === 0) {
      return true;
    }

    if (!Array.isArray(data) && Object.keys(data || {}).length === 0) {
      return true;
    }
  }

  return false;
}

async function executeToolWithRetry(ctx, payload = {}) {
  const {
    toolName,
    knownFacts,
    userMessage,
    maxAttempts = 3,
    llmGenerate,
    parser,
    allowOpenApiFallback = true,
    toolTimeoutMs,
  } = payload;

  const attemptsLog = [];
  const schemaResolution = await getToolParamSchema(ctx, toolName, { allowOpenApiFallback });
  const schema = schemaResolution.schema;

  if (!schema) {
    return {
      success: false,
      error: `SCHEMA_UNAVAILABLE: Kein Param-Schema für ${toolName} gefunden.`,
      failFast: true,
      attemptsLog,
      schemaSource: schemaResolution.source,
    };
  }

  for (let attempt = 1; attempt <= maxAttempts; attempt += 1) {
    const parameterResult = await buildToolParametersLLM(ctx, {
      toolName,
      schema,
      knownFacts,
      userMessage,
      attempt,
      generate: llmGenerate,
      parser,
    });

    if (!parameterResult.params) {
      attemptsLog.push({
        attempt,
        step: 'param-generation',
        error: parameterResult.error,
      });
      continue;
    }

    const params = parameterResult.params;

    try {
      const result = await ctx.call(toolName, params, {
        meta: { ...ctx.meta, $gateway: false },
        timeout: typeof toolTimeoutMs === 'number' ? toolTimeoutMs : undefined,
      });

      if (!isEmptyOrError(result)) {
        return {
          success: true,
          observation: result,
          params,
          attempt,
          attemptsLog,
          schemaSource: schemaResolution.source,
        };
      }

      attemptsLog.push({
        attempt,
        step: 'empty-result',
        params,
      });
    } catch (error) {
      attemptsLog.push({
        attempt,
        step: 'tool-call',
        params,
        error: error?.message || 'TOOL_CALL_FAILED',
      });
    }
  }

  return {
    success: false,
    error: `ALL_ATTEMPTS_FAILED: ${toolName}`,
    attemptsLog,
    schemaSource: schemaResolution.source,
  };
}

module.exports = {
  parseServiceAction,
  moleculerParamsToJsonSchema,
  getToolParamSchema,
  buildToolParametersLLM,
  executeToolWithRetry,
  isEmptyOrError,
};
