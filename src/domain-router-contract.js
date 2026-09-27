'use strict';

const stringFields = [
  'schemaVersion',
  'conversationId',
  'agentSessionId',
  'cetCaseId',
  'caseId',
  'tenantId',
  'actorId',
  'agentProfile',
  'roomId',
  'threadId',
  'userRequest',
  'conversationExcerpt',
  'priorCetStateRef',
  'forceReceipt',
  'clientId',
  'since',
];
const arrayFields = ['actorRoles', 'sensitivityFlags', 'preferredReceipts', 'sharedWithRoles'];
const taskParams = Object.fromEntries(
  stringFields.map((k) => [
    k,
    {
      type: 'string',
      optional: true,
      max: k === 'userRequest' || k === 'conversationExcerpt' ? 8000 : 500,
    },
  ])
);
for (const k of arrayFields) {
  taskParams[k] = { type: 'array', items: 'string', optional: true, max: 100 };
}
for (const k of ['disableReceiptSelection', 'disableKnowledgeRouting']) {
  taskParams[k] = { type: 'boolean', optional: true };
}
taskParams.requestedMode = {
  type: 'enum',
  values: ['classify', 'continue', 'answer', 'dossier', 'evidence', 'handoff'],
  optional: true,
};
taskParams.channel = {
  type: 'enum',
  values: ['matrix', 'hermes', 'api', 'web', 'test'],
  optional: true,
};
taskParams.caseStateVersion = { type: 'number', integer: true, min: 1, optional: true };
taskParams.knownContext = {
  type: 'object',
  optional: true,
  props: {
    missingEvidence: { type: 'array', items: 'string', optional: true },
    branch: { type: 'boolean', optional: true },
  },
};
taskParams.asyncDelivery = {
  type: 'object',
  optional: true,
  props: {
    mode: { type: 'enum', values: ['poll', 'none'] },
    clientId: { type: 'string', optional: true, min: 1 },
    supportedEventTypes: { type: 'array', items: 'string', optional: true },
    ackMode: { type: 'enum', values: ['explicit'], optional: true },
  },
};

const envelopeSchema = {
  type: 'object',
  required: ['userRequest'],
  additionalProperties: true,
  properties: {
    ...Object.fromEntries(stringFields.map((k) => [k, { type: 'string' }])),
    ...Object.fromEntries(
      arrayFields.map((k) => [k, { type: 'array', items: { type: 'string' } }])
    ),
    schemaVersion: { type: 'string', enum: ['1.1'] },
    userRequest: { type: 'string', minLength: 3, maxLength: 8000 },
    knownContext: { type: 'object', additionalProperties: true },
    requestedMode: { type: 'string', enum: taskParams.requestedMode.values },
    channel: { type: 'string', enum: taskParams.channel.values },
    disableReceiptSelection: { type: 'boolean' },
    disableKnowledgeRouting: { type: 'boolean' },
    caseStateVersion: { type: 'integer', minimum: 1 },
    asyncDelivery: {
      type: 'object',
      required: ['mode'],
      properties: {
        mode: { type: 'string', enum: ['poll', 'none'] },
        clientId: { type: 'string' },
        clientCorrelationId: { type: 'string' },
        pollIntervalHintSec: { type: 'integer' },
        supportedEventTypes: { type: 'array', items: { type: 'string' } },
        ackMode: { type: 'string', enum: ['explicit'] },
        resumeToken: { type: 'string' },
      },
    },
  },
};

const responseFields = [
  'schemaVersion',
  'cetCaseId',
  'caseStateVersion',
  'primaryDomain',
  'domainConfidence',
  'alternativeDomains',
  'ambiguityFlags',
  'matchedSignals',
  'roleInterpretation',
  'selectedCapabilities',
  'candidateCapabilities',
  'selectedReceipts',
  'candidateReceipts',
  'knowledgeRefs',
  'allowedActions',
  'blockedActions',
  'transition',
  'requiredClarifications',
  'evidenceRequirements',
  'nextState',
  'responseGuidance',
  'matchedLaufkarten',
  'currentStation',
  'candidateStations',
  'controlPoint',
  'nextSafeStep',
  'hitlBoundary',
  'readinessState',
  'readinessScore',
  'missingEvidence',
  'noCallGuards',
  'roleProjection',
];

function routerOpenApi(rest, summary) {
  const [method, route] = rest.split(' ');
  const parameters = [...route.matchAll(/:([A-Za-z]+)/g)].map((m) => ({
    name: m[1],
    in: 'path',
    required: true,
    schema: { type: 'string' },
  }));
  if (method === 'GET') {
    for (const name of ['clientId', 'since', 'caseId', 'cetCaseId']) {
      parameters.push({
        name,
        in: 'query',
        required: name === 'clientId',
        schema: { type: 'string' },
      });
    }
  }
  const routing = ['/classify', '/continue'].includes(route);
  const schema = routing
    ? {
        type: 'object',
        additionalProperties: true,
        properties: { ...envelopeSchema.properties, taskEnvelope: envelopeSchema },
        anyOf: [{ required: ['userRequest'] }, { required: ['taskEnvelope'] }],
      }
    : {
        type: 'object',
        properties: {
          cetCaseId: { type: 'string' },
          clientId: { type: 'string' },
          targetCaseId: { type: 'string' },
        },
        required: route.endsWith('/ack')
          ? ['clientId']
          : route.endsWith('/link')
            ? ['targetCaseId']
            : [],
      };
  return {
    tags: ['Domain Router'],
    summary,
    parameters,
    description:
      'Authenticated tenant, actor, energy role and sensitivity policy required. Advisory only. Local PouchDB case/event metadata; no operational execution. See docs/domain-router.md.',
    ...(method === 'POST'
      ? { requestBody: { required: true, content: { 'application/json': { schema } } } }
      : {}),
    responses: {
      200: {
        description: 'Advisory routing or policy-filtered case metadata',
        content: {
          'application/json': {
            schema: routing
              ? {
                  type: 'object',
                  required: responseFields,
                  properties: Object.fromEntries(responseFields.map((k) => [k, {}])),
                }
              : { type: 'object' },
          },
        },
      },
      403: { description: 'Tenant, role or sensitivity denied' },
      409: { description: 'Stale case revision; reload and retry' },
      422: { description: 'Invalid task or forced receipt' },
    },
  };
}

module.exports = { taskParams, envelopeSchema, routerOpenApi };
