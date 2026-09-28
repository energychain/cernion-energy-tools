'use strict';

const { Errors } = require('moleculer');

const MAX_ID_LENGTH = 500;
const CLIENTS = new Set(['open-webui', 'api', 'web', 'test']);
const CHANNELS = new Set(['open-webui', 'web', 'api', 'test']);
const SENSITIVE_KEYS = /authorization|bearer|token|secret|password|api[_-]?key/i;

function clientError(message, code = 422, type = 'WORKBENCH_CONTRACT_INVALID') {
  return new Errors.MoleculerClientError(message, code, type);
}

function cleanString(value, field, { required = false, max = MAX_ID_LENGTH } = {}) {
  if (value == null || value === '') {
    if (required) throw clientError(`${field} required`);
    return undefined;
  }
  if (typeof value !== 'string') throw clientError(`${field} must be a string`);
  const text = value.trim();
  if (!text && required) throw clientError(`${field} required`);
  if (text.length > max) throw clientError(`${field} too long`);
  if (SENSITIVE_KEYS.test(field) || /^bearer\s+/i.test(text)) {
    throw clientError(`${field} must not contain secrets`);
  }
  return text || undefined;
}

function normalizeClient(value = 'open-webui') {
  const client = cleanString(value, 'client') || 'open-webui';
  if (!CLIENTS.has(client)) throw clientError('Unsupported workbench client');
  return client;
}

function normalizeChannel(value = 'open-webui') {
  const channel = cleanString(value, 'channel') || 'open-webui';
  if (!CHANNELS.has(channel)) throw clientError('Unsupported workbench channel');
  return channel;
}

function normalizeConversationRef(input = {}) {
  const client = normalizeClient(input.client || input.channel || 'open-webui');
  const conversationId = cleanString(
    input.openWebuiConversationId || input.conversationId,
    'conversationId',
    { required: true }
  );
  return {
    client,
    conversationId,
    openWebuiConversationId: input.openWebuiConversationId || conversationId,
    openWebuiUserId: cleanString(input.openWebuiUserId || input.externalUserId, 'openWebuiUserId'),
    openWebuiOrgId: cleanString(input.openWebuiOrgId || input.externalOrgId, 'openWebuiOrgId'),
    requestId: cleanString(input.requestId, 'requestId'),
    correlationId: cleanString(input.correlationId, 'correlationId'),
  };
}

function normalizeAsyncDelivery(input = {}, fallbackClientId) {
  const raw =
    input.asyncDelivery && typeof input.asyncDelivery === 'object' ? input.asyncDelivery : {};
  const mode = raw.mode || (fallbackClientId ? 'poll' : 'none');
  if (!['poll', 'none'].includes(mode)) throw clientError('Unsupported async delivery mode');
  const clientId = cleanString(raw.clientId || input.clientId || fallbackClientId, 'clientId');
  if (mode === 'poll' && !clientId) throw clientError('clientId required for poll delivery');
  return {
    mode,
    ...(clientId ? { clientId } : {}),
    ...(raw.ackMode ? { ackMode: raw.ackMode } : { ackMode: 'explicit' }),
    ...(Array.isArray(raw.supportedEventTypes)
      ? {
          supportedEventTypes: raw.supportedEventTypes
            .map((v) => cleanString(v, 'eventType'))
            .filter(Boolean),
        }
      : {}),
  };
}

function normalizeTaskEnvelope(input = {}, mapping = {}) {
  const conversation = normalizeConversationRef({
    ...input,
    conversationId:
      input.openWebuiConversationId || input.conversationId || mapping.externalConversationId,
  });
  const userRequest = cleanString(input.message || input.userRequest, 'userRequest', {
    required: true,
    max: 8000,
  });
  const clientId = cleanString(
    input.clientId || input.asyncDelivery?.clientId || mapping.clientId,
    'clientId'
  );
  return {
    schemaVersion: '1.1',
    channel: normalizeChannel(input.channel || 'open-webui'),
    conversationId: conversation.conversationId,
    userRequest,
    requestId: cleanString(input.requestId, 'requestId'),
    correlationId: cleanString(input.correlationId, 'correlationId'),
    openWebuiConversationId: conversation.openWebuiConversationId,
    openWebuiUserId: conversation.openWebuiUserId,
    openWebuiOrgId: conversation.openWebuiOrgId,
    clientId,
    asyncDelivery: normalizeAsyncDelivery(input, clientId),
    knownContext:
      input.knownContext && typeof input.knownContext === 'object' ? input.knownContext : {},
    attachments: Array.isArray(input.attachments) ? input.attachments : [],
  };
}

function openApiResponseSchema(fields) {
  return {
    200: {
      description: 'Workbench response',
      content: {
        'application/json': {
          schema: { type: 'object', properties: Object.fromEntries(fields.map((f) => [f, {}])) },
        },
      },
    },
    403: { description: 'Tenant, actor, role or sensitivity denied' },
    404: { description: 'Workbench resource not found' },
    409: { description: 'Stale or conflicting mapping' },
    422: { description: 'Invalid workbench request' },
  };
}

function workbenchOpenApi(rest, summary, fields = [], params = {}) {
  const [method, route] = rest.split(' ');
  const pathParamNames = [...route.matchAll(/:([A-Za-z]+)/g)].map((m) => m[1]);
  const parameters = pathParamNames.map((name) => ({
    name,
    in: 'path',
    required: true,
    schema: { type: 'string' },
  }));
  if (method === 'GET') {
    for (const [name, schema] of Object.entries(params)) {
      if (pathParamNames.includes(name)) continue;
      parameters.push({
        name,
        in: 'query',
        required: schema.optional !== true,
        schema: {
          type:
            schema.type === 'number' ? 'number' : schema.type === 'boolean' ? 'boolean' : 'string',
        },
      });
    }
  }
  const bodyProps = Object.fromEntries(
    Object.entries(params)
      .filter(([name]) => !pathParamNames.includes(name))
      .map(([name, schema]) => [
        name,
        {
          type:
            schema.type === 'number' ? 'number' : schema.type === 'boolean' ? 'boolean' : 'string',
        },
      ])
  );
  const required = Object.entries(params)
    .filter(([name, schema]) => !pathParamNames.includes(name) && schema.optional !== true)
    .map(([name]) => name);
  return {
    tags: ['Workbench'],
    summary,
    description:
      'CET-governed Workbench/Tenant-Gateway API for Open WebUI clients. Tokens stay server-side; CET remains case-state and governance authority.',
    parameters,
    ...(method === 'POST'
      ? {
          requestBody: {
            required: true,
            content: {
              'application/json': {
                schema: {
                  type: 'object',
                  additionalProperties: true,
                  properties: bodyProps,
                  ...(required.length ? { required } : {}),
                },
                examples: { minimal: { value: {} } },
              },
            },
          },
        }
      : {}),
    responses: openApiResponseSchema(fields),
  };
}

module.exports = {
  cleanString,
  normalizeClient,
  normalizeChannel,
  normalizeConversationRef,
  normalizeAsyncDelivery,
  normalizeTaskEnvelope,
  workbenchOpenApi,
};
