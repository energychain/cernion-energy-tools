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
    ...(input.openWebuiUserEmail
      ? { openWebuiUserEmail: cleanString(input.openWebuiUserEmail, 'openWebuiUserEmail') }
      : {}),
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
  const documentInput = require('./workbench-document-input').documentInput(
    input.message || input.userRequest
  );
  const userRequest = cleanString(documentInput.question, 'userRequest', {
    required: true,
    max: require('./workbench-thread').maxInputChars(),
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
    ...(documentInput.documents.length ? { documents: documentInput.documents } : {}),
    requestId: cleanString(input.requestId, 'requestId'),
    correlationId: cleanString(input.correlationId, 'correlationId'),
    openWebuiConversationId: conversation.openWebuiConversationId,
    openWebuiUserId: conversation.openWebuiUserId,
    openWebuiOrgId: conversation.openWebuiOrgId,
    ...(conversation.openWebuiUserEmail
      ? { openWebuiUserEmail: conversation.openWebuiUserEmail }
      : {}),
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

const turnMemorySchema = objectSchema({
  schemaVersion: stringSchema('Turn memory schema version'),
  primaryDomain: stringSchema('Current remembered primary domain'),
  alternativeDomains: arrayOf(
    objectSchema({ domain: stringSchema('Domain'), confidence: numberSchema('Confidence') })
  ),
  readinessState: stringSchema('Current remembered readiness state'),
  activeRole: stringSchema('Active role projection used for the next turn'),
  applicableRoles: arrayOf(stringSchema('CET role visible to the case')),
  roleHistory: arrayOf(objectSchema({}, [], 'Role transition entry')),
  openQuestions: arrayOf(stringSchema('Open clarification question')),
  requiredClarifications: arrayOf(stringSchema('Required clarification')),
  missingEvidence: arrayOf(stringSchema('Missing evidence type or label')),
  workingAssumptions: arrayOf(stringSchema('Bounded working assumption')),
  noCallGuards: arrayOf(stringSchema('No-call guardrail')),
  allowedActions: arrayOf(stringSchema('Allowed action')),
  blockedActions: arrayOf(stringSchema('Blocked action')),
  appliedPlaybooks: arrayOf(
    objectSchema({
      skillId: stringSchema('Applied CET Workbench skill/playbook id'),
      title: stringSchema('UI-safe skill title'),
      version: numberSchema('Skill content version'),
      auditRefs: arrayOf(stringSchema('Skill lifecycle audit entry id')),
    }),
    'Active skills/playbooks applied to this case; never raw evidence or prompts'
  ),
  lastUserIntent: stringSchema('Bounded summary of the latest user intent'),
  lastSafeConclusion: stringSchema('Latest non-binding safe conclusion'),
  recentEventStatus: eventSummarySchema,
  memoryUpdatedAt: stringSchema('ISO timestamp'),
  rawChatHistoryStored: booleanSchema('Always false for CET turn memory'),
});
turnMemorySchema.properties.roleHistory.items.additionalProperties = true;

const turnMemorySummarySchema = objectSchema({
  primaryDomain: stringSchema('Current remembered primary domain'),
  readinessState: stringSchema('Current remembered readiness state'),
  activeRole: stringSchema('Active role projection'),
  openQuestions: arrayOf(stringSchema('Open clarification question')),
  missingEvidence: arrayOf(stringSchema('Missing evidence type or label')),
  workingAssumptions: arrayOf(stringSchema('Bounded working assumption')),
  lastSafeConclusion: stringSchema('Latest non-binding safe conclusion'),
  memoryUpdatedAt: stringSchema('ISO timestamp'),
  rawChatHistoryStored: booleanSchema('Always false for CET turn memory'),
});

const caseSummarySchema = objectSchema({
  initialRequest: stringSchema('Original bounded user content retained when the case starts'),
  internalDrafts: arrayOf(
    objectSchema({
      draftId: stringSchema('Internal text draft id'),
      content: stringSchema('Non-binding text draft; never transmitted'),
      effectClass: stringSchema('Internal case state effect'),
      createdAt: stringSchema('ISO timestamp'),
    })
  ),
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
  turnMemory: turnMemorySchema,
  turnMemorySummary: turnMemorySummarySchema,
  workingAssumptions: arrayOf(stringSchema('Bounded working assumption')),
  openQuestions: arrayOf(stringSchema('Open clarification question')),
  activeRoleProjection: stringSchema('Current role projection'),
  appliedPlaybooks: turnMemorySchema.properties.appliedPlaybooks,
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
      message: stringSchema(
        'User question, optionally with Open WebUI context/source documents. Question and document budgets are validated separately using WORKBENCH_MAX_INPUT_CHARS and WORKBENCH_DOCUMENT_MAX_CHARS.'
      ),
      messages: arrayOf(
        objectSchema({
          role: stringSchema('History role; only substantive user turns supply case content'),
          content: stringSchema('Prior message text, bounded to 8000 characters on recovery'),
        }),
        'Optional prior messages for recovering an empty case-start confirmation'
      ),
      asyncDelivery: asyncDeliverySchema,
      requestId: stringSchema('Caller request id'),
      correlationId: stringSchema('Caller correlation id'),
      knownContext: objectSchema({}, [], 'Bounded client context'),
      attachments: arrayOf(objectSchema({}, [], 'Open WebUI attachment references')),
    },
    ['message']
  ),
  CaseStarterInput: objectSchema({
    key: stringSchema('Allowlisted starter input key'),
    label: stringSchema('UI label for the input'),
    required: booleanSchema('Whether the input should be supplied before the case is ready'),
  }),
  CaseStarter: objectSchema({
    starterId: stringSchema('Guided case starter id'),
    activityId: stringSchema('Canonical Workbench Activity Taxonomy activity id'),
    title: stringSchema('UI-safe starter title'),
    description: stringSchema('UI-safe starter description'),
    domainHint: stringSchema('Advisory domain hint; Domain Router remains authoritative'),
    initialPromptTemplate: stringSchema('Bounded prompt template assembled by CET'),
    requiredInputs: arrayOf(
      objectSchema({
        key: stringSchema('Allowlisted input key'),
        label: stringSchema('UI-safe input label'),
        required: booleanSchema('Whether this input is required'),
      })
    ),
    suggestedEvidenceTypes: arrayOf(stringSchema('Suggested EvidenceRef type')),
    noCallGuards: arrayOf(stringSchema('No-call guardrail inherited from activity taxonomy')),
    defaultAsyncDelivery: asyncDeliverySchema,
    expectedRoleFamilies: arrayOf(stringSchema('Expected role family')),
    allowedActions: arrayOf(stringSchema('Allowed internal action')),
    blockedActions: arrayOf(stringSchema('Blocked external/binding action')),
    handoffDomains: arrayOf(stringSchema('Potential handoff domain')),
    nextSafeStep: stringSchema('Next safe step for missing inputs/evidence'),
  }),
  CaseStarterListResponse: objectSchema({
    schemaVersion: stringSchema('Case starter schema version'),
    items: arrayOf(objectSchema({}, [], 'Case starter')),
  }),
  CaseStarterStartRequest: objectSchema({
    client: stringSchema('Workbench client, usually open-webui'),
    channel: stringSchema('Workbench channel, usually open-webui'),
    openWebuiConversationId: stringSchema('Open WebUI conversation id'),
    openWebuiUserId: stringSchema('Open WebUI mapped user id'),
    openWebuiOrgId: stringSchema('Open WebUI mapped organization id'),
    clientId: stringSchema('Registered delivery client id'),
    inputs: objectSchema({}, [], 'Allowlisted scalar starter inputs'),
    userRequest: stringSchema('Optional bounded user context'),
    asyncDelivery: asyncDeliverySchema,
    requestId: stringSchema('Caller request id'),
    correlationId: stringSchema('Caller correlation id'),
  }),
  CaseStarterStartResponse: objectSchema({
    schemaVersion: stringSchema('Case starter schema version'),
    starter: objectSchema({}, [], 'Started case starter'),
    caseId: stringSchema('CET case id'),
    cetCaseId: stringSchema('CET case id'),
    caseStateVersion: numberSchema('Case-state version'),
    usedOperation: stringSchema('classify or continue'),
    primaryDomain: stringSchema('Primary CET domain'),
    alternativeDomains: arrayOf(
      objectSchema({ domain: stringSchema('Domain'), confidence: numberSchema('Confidence') })
    ),
    readinessState: stringSchema('Readiness state'),
    responseText: stringSchema('UI response text'),
    eventSummary: eventSummarySchema,
    pendingEvents: numberSchema('Pending event count'),
  }),
  WorkbenchChatResponse: objectSchema({
    state: stringSchema('Conversation state, including non-binding assistance'),
    nonBinding: booleanSchema('True for an advisory response'),
    draftId: stringSchema('Optional internal text draft id'),
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
    turnMemorySummary: turnMemorySummarySchema,
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
      externalUserId: stringSchema('Open WebUI user id; alternative to externalUserEmail'),
      externalUserEmail: stringSchema(
        'Exact normalized Open WebUI email; alternative to externalUserId',
        { format: 'email' }
      ),
      openWebuiOrgId: stringSchema('Open WebUI organization id'),
      openWebuiUserId: stringSchema('Open WebUI user id'),
      cetTenantId: stringSchema('CET tenant id'),
      cetActorId: stringSchema('CET actor id'),
      roles: arrayOf(stringSchema('CET role')),
      sensitivityClearance: arrayOf(stringSchema('Sensitivity clearance')),
      defaultClientId: stringSchema('Default registered delivery client id'),
      enabled: booleanSchema('Whether the mapping is active'),
    },
    ['externalOrgId']
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

const SKILL_STATUS_ENUM = ['draft', 'proposed', 'active', 'deprecated', 'archived'];

const skillCoreShape = {
  title: stringSchema('Skill title', { maxLength: 200 }),
  description: stringSchema('Skill description', { maxLength: 2000 }),
  domains: arrayOf(stringSchema('Governed Workbench domain')),
  triggerPatterns: arrayOf(stringSchema('Bounded routing/trigger signal')),
  examplePrompts: arrayOf(stringSchema('UI-safe example prompt')),
  applicableRoles: arrayOf(stringSchema('CET role family')),
  requiredEvidence: arrayOf(stringSchema('Allowlisted evidence type')),
  steps: arrayOf(stringSchema('Bounded, non-binding process step')),
  allowedActions: arrayOf(stringSchema('Allowed internal action')),
  blockedActions: arrayOf(stringSchema('Blocked external/binding action')),
  noCallGuards: arrayOf(stringSchema('No-call guardrail')),
  handoffDomains: arrayOf(stringSchema('Potential handoff domain')),
  capabilityHints: arrayOf(stringSchema('Advisory Capability Broker hint')),
  receiptHints: arrayOf(stringSchema('Advisory receipt hint')),
};

const skillSchema = objectSchema({
  skillId: stringSchema('Tenant-scoped CET Workbench skill/playbook id'),
  tenantId: stringSchema('Tenant id'),
  ...skillCoreShape,
  status: stringSchema('Skill lifecycle status', { enum: SKILL_STATUS_ENUM }),
  version: numberSchema('Skill content version'),
  createdBy: stringSchema('Actor id that created the skill'),
  approvedBy: stringSchema('Actor id that activated the skill'),
  createdAt: stringSchema('ISO timestamp'),
  updatedAt: stringSchema('ISO timestamp'),
  auditRefs: arrayOf(stringSchema('Append-only lifecycle audit entry id')),
});

schemas.Skill = skillSchema;
schemas.SkillListResponse = objectSchema({ items: arrayOf(skillSchema) });
schemas.SkillResponse = objectSchema({
  saved: booleanSchema('Whether the skill lifecycle mutation succeeded'),
  skill: skillSchema,
  idempotent: booleanSchema('True when a retried mutation was a no-op'),
});
schemas.SkillCreateRequest = objectSchema(
  {
    skillId: stringSchema('Caller-supplied tenant-scoped skill id'),
    ...skillCoreShape,
  },
  ['title', 'domains']
);
schemas.SkillProposeFromCaseRequest = objectSchema({
  title: stringSchema('Optional admin-supplied skill title override', { maxLength: 200 }),
  description: stringSchema('Optional admin-supplied skill description override', {
    maxLength: 2000,
  }),
  examplePrompts: arrayOf(stringSchema('Optional admin-supplied example prompt')),
  skillId: stringSchema('Optional caller-supplied tenant-scoped skill id'),
});

schemas.EvidenceAttachRequest.properties.sourceRef.additionalProperties = true;
schemas.EvidenceAttachRequest.properties.extracts.additionalProperties = true;
schemas.CaseStarterListResponse.properties.items.items = schemas.CaseStarter;
schemas.CaseStarterStartResponse.properties.starter = schemas.CaseStarter;
schemas.CaseStarterStartRequest.properties.inputs.additionalProperties = true;
schemas.WorkbenchChatRequest.properties.knownContext.additionalProperties = true;
schemas.WorkbenchChatRequest.properties.attachments.items.additionalProperties = true;

const operationSchemas = {
  'GET /cases/:caseId': { response: 'CaseSummary' },
  'GET /cases': { response: 'CaseListResponse' },
  'GET /case-starters': { response: 'CaseStarterListResponse' },
  'POST /case-starters/:starterId/start': {
    request: 'CaseStarterStartRequest',
    response: 'CaseStarterStartResponse',
  },
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
  'GET /admin/mappings': { responseFields: ['tenantId', 'mappings'] },
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
  'GET /skills': { response: 'SkillListResponse' },
  'GET /skills/:skillId': { responseFields: ['skill'] },
  'POST /skills': { request: 'SkillCreateRequest', response: 'SkillResponse' },
  'POST /skills/:skillId/propose': { response: 'SkillResponse' },
  'POST /skills/:skillId/activate': { response: 'SkillResponse' },
  'POST /skills/:skillId/deprecate': { response: 'SkillResponse' },
  'POST /cases/:caseId/skills/propose-from-case': {
    request: 'SkillProposeFromCaseRequest',
    response: 'SkillResponse',
  },
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
  if (rest === 'POST /case-starters/:starterId/start') {
    return {
      client: 'open-webui',
      channel: 'open-webui',
      openWebuiOrgId: 'owui-org-1',
      openWebuiUserId: 'owui-user-1',
      openWebuiConversationId: 'owui-chat-1',
      clientId: 'openwebui-tenant-1',
      inputs: { marketLocationId: 'DE...', aperakContrlContext: 'APERAK Z18' },
      userRequest: 'Lieferant reklamiert fehlende MSCONS-Zeitreihe.',
      asyncDelivery: { mode: 'poll', ackMode: 'explicit', clientId: 'openwebui-tenant-1' },
    };
  }
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
