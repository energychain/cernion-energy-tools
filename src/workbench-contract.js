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

const stringSchema = (description, extra = {}) => ({
  type: 'string',
  ...(description ? { description } : {}),
  ...extra,
});
const booleanSchema = (description) => ({
  type: 'boolean',
  ...(description ? { description } : {}),
});
const numberSchema = (description) => ({ type: 'number', ...(description ? { description } : {}) });
const arrayOf = (items, description) => ({
  type: 'array',
  items,
  ...(description ? { description } : {}),
});
const objectSchema = (properties = {}, required = [], description) => ({
  type: 'object',
  additionalProperties: false,
  properties,
  ...(required.length ? { required } : {}),
  ...(description ? { description } : {}),
});

const conversationRefSchema = objectSchema({
  client: stringSchema('Workbench client id, usually open-webui'),
  conversationId: stringSchema('Client conversation id'),
  openWebuiConversationId: stringSchema('Open WebUI conversation id'),
  openWebuiUserId: stringSchema('Open WebUI user id'),
  openWebuiOrgId: stringSchema('Open WebUI organization id'),
  caseId: stringSchema('Linked CET case id'),
  cetCaseId: stringSchema('Linked CET case id'),
  caseStateVersion: numberSchema('Current CET case-state version'),
});

const asyncDeliverySchema = objectSchema({
  mode: stringSchema('Delivery mode', { enum: ['none', 'poll'] }),
  clientId: stringSchema('Registered Workbench delivery client id'),
  ackMode: stringSchema('Acknowledgement mode', { enum: ['explicit'] }),
  supportedEventTypes: arrayOf(stringSchema('Event type')),
});

const eventSummarySchema = objectSchema({
  pending: numberSchema('Pending events not yet delivered'),
  delivered: numberSchema('Delivered but not acknowledged events'),
  unacknowledged: numberSchema('Pending plus delivered events'),
  attention: numberSchema('Unacknowledged events requiring user attention'),
});

const eventSchema = objectSchema({
  eventId: stringSchema('Case Event Outbox event id'),
  caseId: stringSchema('CET case id'),
  cetCaseId: stringSchema('CET case id'),
  eventType: stringSchema('CET event type'),
  severity: stringSchema('UI severity'),
  requiresUserAttention: booleanSchema('Whether the event should be visible as attention item'),
  title: stringSchema('UI-safe event title'),
  safeDisplayText: stringSchema('UI-safe event summary'),
  sensitivityLevel: stringSchema('Event sensitivity'),
  deliveryState: stringSchema('Delivery state'),
  conversationRef: conversationRefSchema,
  createdAt: stringSchema('ISO timestamp'),
});

const evidenceRefSchema = objectSchema({
  evidenceId: stringSchema('Evidence reference id'),
  caseId: stringSchema('CET case id'),
  tenantId: stringSchema('Tenant id'),
  actorId: stringSchema('Actor id that attached the evidence'),
  evidenceType: stringSchema('Allowed evidence type'),
  sourceType: stringSchema('Allowed source type'),
  label: stringSchema('UI-safe evidence label'),
  description: stringSchema('UI-safe evidence description'),
  sensitivityLevel: stringSchema('Sensitivity level'),
  safeSummary: stringSchema('UI-safe summary; never raw document content'),
  sourceFingerprint: stringSchema('Fingerprint over normalized source metadata'),
  hashStatus: stringSchema(
    'available when a real file/content hash was supplied, unavailable otherwise'
  ),
  fileHash: stringSchema('Caller supplied content hash, if available'),
  provenance: objectSchema({
    system: stringSchema('Evidence origin system'),
    retrievalMode: stringSchema('reference/upload/manual'),
    retrievedAt: stringSchema('ISO timestamp'),
    retrievedBy: stringSchema('Actor or system attaching the reference'),
  }),
  sourceRef: objectSchema({}, [], 'Allowlisted, sanitized source metadata'),
  extracts: objectSchema({}, [], 'Optional allowlisted typed extracts'),
  duplicateOf: stringSchema('Existing evidence id when idempotent duplicate was detected'),
  redacted: booleanSchema('True when sensitivity prevents details from being shown'),
  createdAt: stringSchema('ISO timestamp'),
});

evidenceRefSchema.properties.sourceRef.additionalProperties = true;
evidenceRefSchema.properties.extracts.additionalProperties = true;

const caseSummarySchema = objectSchema({
  caseId: stringSchema('CET case id'),
  cetCaseId: stringSchema('CET case id'),
  caseStateVersion: numberSchema('Case-state version'),
  tenantId: stringSchema('Tenant id'),
  title: stringSchema('UI title'),
  primaryDomain: stringSchema('Primary domain'),
  alternativeDomains: arrayOf(
    objectSchema({ domain: stringSchema('Domain'), confidence: numberSchema('Confidence') })
  ),
  readinessState: stringSchema('Current readiness state'),
  status: stringSchema('UI status'),
  allowedActions: arrayOf(stringSchema('Allowed action')),
  blockedActions: arrayOf(stringSchema('Blocked action')),
  requiredClarifications: arrayOf(stringSchema('Required clarification')),
  missingEvidence: arrayOf(objectSchema({}, [], 'Missing evidence descriptor')),
  noCallGuards: arrayOf(stringSchema('No-call guardrail')),
  lastResponseText: stringSchema('Last CET response text'),
  evidenceRefs: arrayOf(evidenceRefSchema),
  evidenceSummary: objectSchema({
    total: numberSchema('Visible evidence count'),
    redacted: numberSchema('Redacted evidence count'),
  }),
  readinessReviewRequired: booleanSchema(
    'Whether newly attached evidence requires a readiness review'
  ),
  eventSummary: eventSummarySchema,
  createdAt: stringSchema('ISO timestamp'),
  updatedAt: stringSchema('ISO timestamp'),
});

const caseListItemSchema = objectSchema({
  caseId: stringSchema('CET case id'),
  title: stringSchema('UI title'),
  primaryDomain: stringSchema('Primary domain'),
  readinessState: stringSchema('Readiness state'),
  status: stringSchema('Case list status'),
  pendingEvents: numberSchema('Unacknowledged event count'),
  severity: stringSchema('Highest UI severity'),
  updatedAt: stringSchema('ISO timestamp'),
});

const schemas = {
  WorkbenchChatRequest: objectSchema(
    {
      client: stringSchema('Workbench client', { enum: ['open-webui', 'api', 'web', 'test'] }),
      channel: stringSchema('Workbench channel', { enum: ['open-webui', 'web', 'api', 'test'] }),
      conversationId: stringSchema('Client conversation id'),
      openWebuiConversationId: stringSchema('Open WebUI conversation id'),
      openWebuiUserId: stringSchema('Open WebUI user id'),
      openWebuiOrgId: stringSchema('Open WebUI organization id'),
      clientId: stringSchema('Registered delivery client id'),
      message: stringSchema('User message routed through CET classify/continue', {
        maxLength: 8000,
      }),
      asyncDelivery: asyncDeliverySchema,
      requestId: stringSchema('Caller request id'),
      correlationId: stringSchema('Caller correlation id'),
      knownContext: objectSchema({}, [], 'Bounded client context'),
      attachments: arrayOf(objectSchema({}, [], 'Open WebUI attachment references')),
    },
    ['message']
  ),
  WorkbenchChatResponse: objectSchema({
    caseId: stringSchema('CET case id'),
    cetCaseId: stringSchema('CET case id'),
    caseStateVersion: numberSchema('Case-state version'),
    usedOperation: stringSchema('classify for new conversations, continue for mapped cases'),
    primaryDomain: stringSchema('Primary CET domain'),
    alternativeDomains: arrayOf(
      objectSchema({ domain: stringSchema('Domain'), confidence: numberSchema('Confidence') })
    ),
    readinessState: stringSchema('Readiness state'),
    responseText: stringSchema('UI response text'),
    requiredClarifications: arrayOf(stringSchema('Required clarification')),
    missingEvidence: arrayOf(objectSchema({}, [], 'Missing evidence descriptor')),
    noCallGuards: arrayOf(stringSchema('No-call guardrail')),
    events: arrayOf(eventSchema),
    eventSummary: eventSummarySchema,
    pendingEvents: numberSchema('Unacknowledged event count'),
  }),
  ConversationLinkRequest: objectSchema(
    {
      client: stringSchema('Workbench client'),
      conversationId: stringSchema('Client conversation id'),
      openWebuiConversationId: stringSchema('Open WebUI conversation id'),
      openWebuiUserId: stringSchema('Open WebUI user id'),
      openWebuiOrgId: stringSchema('Open WebUI organization id'),
      caseId: stringSchema('CET case id'),
      cetCaseId: stringSchema('CET case id'),
      clientId: stringSchema('Registered delivery client id'),
      overwrite: booleanSchema('Allow refreshing an existing mapping to the same case'),
    },
    ['caseId']
  ),
  ConversationResolveResponse: objectSchema({
    found: booleanSchema('Whether a mapping was found'),
    caseId: stringSchema('CET case id'),
    cetCaseId: stringSchema('CET case id'),
    caseStateVersion: numberSchema('Case-state version'),
    status: stringSchema('Case mapping status'),
    conversationRef: conversationRefSchema,
  }),
  TenantMappingRequest: objectSchema(
    {
      client: stringSchema('Workbench client'),
      externalOrgId: stringSchema('Open WebUI organization id'),
      cetTenantId: stringSchema('CET tenant id'),
      defaultClientId: stringSchema('Default registered delivery client id'),
      enabled: booleanSchema('Whether the mapping is active'),
    },
    ['externalOrgId']
  ),
  UserMappingRequest: objectSchema(
    {
      client: stringSchema('Workbench client'),
      externalOrgId: stringSchema('Open WebUI organization id'),
      externalUserId: stringSchema('Open WebUI user id'),
      openWebuiOrgId: stringSchema('Open WebUI organization id'),
      openWebuiUserId: stringSchema('Open WebUI user id'),
      cetTenantId: stringSchema('CET tenant id'),
      cetActorId: stringSchema('CET actor id'),
      roles: arrayOf(stringSchema('CET role')),
      sensitivityClearance: arrayOf(stringSchema('Sensitivity clearance')),
      defaultClientId: stringSchema('Default registered delivery client id'),
      enabled: booleanSchema('Whether the mapping is active'),
    },
    ['externalOrgId', 'externalUserId']
  ),
  DeliveryClientRequest: objectSchema(
    {
      clientId: stringSchema('Tenant-bound MWI delivery client id'),
      clientType: stringSchema('Client type, usually open-webui'),
      deliveryMode: stringSchema('Delivery mode', { enum: ['poll'] }),
      ackMode: stringSchema('Ack mode', { enum: ['explicit'] }),
      eventTypes: arrayOf(stringSchema('Allowed event type for this client')),
      enabled: booleanSchema('Whether this delivery client is active'),
    },
    ['clientId']
  ),
  WorkbenchEventsResponse: objectSchema({
    items: arrayOf(eventSchema),
    nextCursor: stringSchema('Cursor for next page'),
  }),
  EvidenceAttachRequest: objectSchema(
    {
      evidenceType: stringSchema('Allowed evidence type'),
      sourceType: stringSchema('Allowed source type'),
      label: stringSchema('UI-safe evidence label'),
      description: stringSchema('UI-safe evidence description'),
      sensitivityLevel: stringSchema('Sensitivity level'),
      sourceRef: objectSchema({}, [], 'Allowlisted source reference metadata'),
      extracts: objectSchema({}, [], 'Optional typed extracts'),
      fileHash: stringSchema('Caller supplied content hash, if available'),
      forceNewVersion: booleanSchema(
        'Create a new evidence version even when source fingerprint matches'
      ),
      correlationId: stringSchema('Correlation id'),
    },
    ['evidenceType', 'sourceType', 'label']
  ),
  EvidenceAttachResponse: objectSchema({
    evidenceRef: evidenceRefSchema,
    duplicate: booleanSchema('Whether this was an idempotent duplicate'),
    duplicateOf: stringSchema('Existing evidence id'),
    readinessReviewRequired: booleanSchema('Whether a case readiness review is required'),
    generatedEvents: arrayOf(
      objectSchema({ eventType: stringSchema('Event type'), severity: stringSchema('Severity') })
    ),
  }),
  CaseSummary: caseSummarySchema,
  CaseListResponse: objectSchema({
    items: arrayOf(caseListItemSchema),
    nextCursor: stringSchema('Cursor for next page'),
  }),
  DossierRequest: objectSchema({
    format: stringSchema('Dossier format', { enum: ['markdown'] }),
    purpose: stringSchema('Dossier purpose'),
    audience: stringSchema('Audience'),
    includeEvidenceRefs: booleanSchema('Include EvidenceRefs'),
    includeAuditTrail: booleanSchema('Include audit trail when authorized'),
    question: stringSchema('Optional dossier prompt'),
    sessionId: stringSchema('Optional Personal Agent session id'),
    correlationId: stringSchema('Correlation id'),
  }),
  DossierResponse: objectSchema({
    caseId: stringSchema('CET case id'),
    dossierId: stringSchema('Dossier id'),
    format: stringSchema('Format'),
    title: stringSchema('Title'),
    content: stringSchema('Dossier body'),
    evidenceRefs: arrayOf(evidenceRefSchema),
    noCallGuards: arrayOf(stringSchema('No-call guardrail')),
    readinessState: stringSchema('Readiness state'),
    nonBinding: booleanSchema('True when readiness is not ready'),
    createdAt: stringSchema('ISO timestamp'),
  }),
};

schemas.EvidenceAttachRequest.properties.sourceRef.additionalProperties = true;
schemas.EvidenceAttachRequest.properties.extracts.additionalProperties = true;
schemas.WorkbenchChatRequest.properties.knownContext.additionalProperties = true;
schemas.WorkbenchChatRequest.properties.attachments.items.additionalProperties = true;

const operationSchemas = {
  'GET /cases/:caseId': { response: 'CaseSummary' },
  'GET /cases': { response: 'CaseListResponse' },
  'POST /conversations/link-case': {
    request: 'ConversationLinkRequest',
    responseFields: ['linked', 'conversationRef'],
  },
  'GET /conversations/resolve': { response: 'ConversationResolveResponse' },
  'GET /events': { response: 'WorkbenchEventsResponse' },
  'POST /events/:eventId/ack': { requestFields: ['clientId'], response: 'Event' },
  'POST /admin/tenant-mappings': {
    request: 'TenantMappingRequest',
    responseFields: ['saved', 'mapping'],
  },
  'POST /admin/user-mappings': {
    request: 'UserMappingRequest',
    responseFields: ['saved', 'mapping'],
  },
  'GET /admin/user-mappings/:externalUserId': { responseFields: ['found', 'mapping'] },
  'POST /delivery-clients': {
    request: 'DeliveryClientRequest',
    responseFields: ['clientId', 'enabled', 'pollUrl', 'deliveryClient'],
  },
  'POST /chat': { request: 'WorkbenchChatRequest', response: 'WorkbenchChatResponse' },
  'POST /cases/:caseId/evidence': {
    request: 'EvidenceAttachRequest',
    response: 'EvidenceAttachResponse',
  },
  'POST /cases/:caseId/dossier': { request: 'DossierRequest', response: 'DossierResponse' },
};

schemas.Event = eventSchema;

function ref(name) {
  return schemas[name] || { type: 'object' };
}

function withoutRequired(schema) {
  if (!schema || typeof schema !== 'object') return schema;
  const copy = Array.isArray(schema) ? schema.map(withoutRequired) : { ...schema };
  delete copy.required;
  if (copy.properties) {
    copy.properties = Object.fromEntries(
      Object.entries(copy.properties).map(([key, value]) => [key, withoutRequired(value)])
    );
  }
  if (copy.items) copy.items = withoutRequired(copy.items);
  return copy;
}

function schemaFromParam(schema) {
  if (typeof schema === 'string')
    return { type: schema === 'number' || schema === 'boolean' ? schema : 'string' };
  if (!schema || typeof schema !== 'object') return { type: 'string' };
  return {
    type: schema.type === 'number' ? 'number' : schema.type === 'boolean' ? 'boolean' : 'string',
    ...(schema.enum ? { enum: schema.enum } : {}),
  };
}

function requestSchemaFor(rest, params, pathParamNames) {
  const operation = operationSchemas[rest];
  if (operation?.request) return withoutRequired(ref(operation.request));
  const props = Object.fromEntries(
    Object.entries(params)
      .filter(([name]) => !pathParamNames.includes(name))
      .map(([name, schema]) => [name, schemaFromParam(schema)])
  );
  if (operation?.requestFields) {
    for (const name of operation.requestFields) props[name] = props[name] || { type: 'string' };
  }
  const required = Object.entries(params)
    .filter(([name, schema]) => !pathParamNames.includes(name) && schema.optional !== true)
    .map(([name]) => name);
  return {
    type: 'object',
    additionalProperties: false,
    properties: props,
    ...(required.length ? { required } : {}),
  };
}

function responseSchemaFor(rest, fields) {
  const operation = operationSchemas[rest];
  if (operation?.response) return ref(operation.response);
  const responseFields = operation?.responseFields || fields;
  return { type: 'object', properties: Object.fromEntries(responseFields.map((f) => [f, {}])) };
}

function exampleFor(rest) {
  if (rest === 'POST /chat') {
    return {
      client: 'open-webui',
      channel: 'open-webui',
      openWebuiOrgId: 'owui-org-1',
      openWebuiUserId: 'owui-user-1',
      openWebuiConversationId: 'owui-chat-1',
      clientId: 'openwebui-tenant-1',
      message: 'MSCONS fehlt, APERAK Z18 ist vorhanden. Was ist der nächste sichere Schritt?',
      asyncDelivery: { mode: 'poll', ackMode: 'explicit', clientId: 'openwebui-tenant-1' },
    };
  }
  if (rest === 'POST /cases/:caseId/evidence') {
    return {
      evidenceType: 'mako_error_code_diagnosis',
      sourceType: 'willi_mako_ref',
      label: 'Willi-MaKo APERAK Z18 Diagnose',
      sensitivityLevel: 'tenant_internal',
      sourceRef: { messageType: 'APERAK', errorCode: 'Z18', processRef: 'MSCONS-...' },
    };
  }
  if (rest === 'POST /delivery-clients') {
    return {
      clientId: 'openwebui-tenant-1',
      clientType: 'open-webui',
      deliveryMode: 'poll',
      ackMode: 'explicit',
    };
  }
  return {};
}

function openApiResponseSchema(rest, fields) {
  return {
    200: {
      description: 'Workbench response',
      content: {
        'application/json': {
          schema: responseSchemaFor(rest, fields),
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
                schema: requestSchemaFor(rest, params, pathParamNames),
                examples: { minimal: { value: exampleFor(rest) } },
              },
            },
          },
        }
      : {}),
    responses: openApiResponseSchema(rest, fields),
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
  workbenchOpenApiSchemas: schemas,
};
