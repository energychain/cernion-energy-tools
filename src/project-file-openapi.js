'use strict';

const projectSchema = {
  type: 'object',
  required: [
    'projectId',
    'tenantId',
    'title',
    'lifecycle',
    'requiredClearance',
    'createdBy',
    'stats',
    'createdAt',
    'updatedAt',
  ],
  properties: {
    projectId: { type: 'string' },
    tenantId: { type: 'string' },
    title: { type: 'string' },
    lifecycle: { type: 'string', enum: ['ingesting', 'ready', 'degraded', 'archived'] },
    requiredClearance: { type: 'array', items: { type: 'string' } },
    createdBy: { type: 'string' },
    members: { type: 'array', items: { type: 'string' } },
    projectRefs: {
      type: 'array',
      items: {
        type: 'object',
        properties: { caseId: { type: 'string' }, conversationId: { type: 'string' } },
      },
    },
    stats: {
      type: 'object',
      properties: Object.fromEntries(
        ['files', 'bytes', 'datasets', 'nodes', 'edges'].map((name) => [
          name,
          { type: 'integer', minimum: 0 },
        ])
      ),
    },
    deletion: {
      type: 'object',
      properties: {
        status: { type: 'string', enum: ['pending', 'incomplete'] },
        failedHandlers: { type: 'array', items: { type: 'string' } },
      },
    },
    createdAt: { type: 'string', format: 'date-time' },
    updatedAt: { type: 'string', format: 'date-time' },
  },
};

const administrationOverviewSchema = {
  type: 'object',
  required: ['safetyClass', 'advisory', 'projects'],
  properties: {
    safetyClass: { type: 'string', enum: ['read_only_governance_projection'] },
    advisory: { type: 'boolean', enum: [true] },
    projects: {
      type: 'array',
      items: {
        type: 'object',
        additionalProperties: false,
        required: [
          'projectId',
          'title',
          'lifecycle',
          'updatedAt',
          'responsibility',
          'stats',
          'requiredClearance',
          'linkedCaseCount',
          'linkedConversationCount',
          'deletionState',
          'failedCleanupCount',
          'deletionEligibility',
          'blockers',
          'nextGate',
        ],
        properties: {
          projectId: { type: 'string' },
          title: { type: 'string' },
          lifecycle: {
            type: 'string',
            enum: ['ingesting', 'ready', 'degraded', 'archived', 'unknown'],
          },
          updatedAt: { type: 'string' },
          responsibility: {
            type: 'object',
            additionalProperties: false,
            required: ['projection', 'grantsAuthority', 'createdBy', 'members'],
            properties: {
              projection: { type: 'string', enum: ['legacy_responsibility_projection'] },
              grantsAuthority: { type: 'boolean', enum: [false] },
              createdBy: { type: 'string' },
              members: { type: 'array', items: { type: 'string' } },
            },
          },
          stats: projectSchema.properties.stats,
          requiredClearance: { type: 'array', items: { type: 'string' } },
          linkedCaseCount: { type: 'integer', minimum: 0 },
          linkedConversationCount: { type: 'integer', minimum: 0 },
          deletionState: { type: 'string', enum: ['none', 'pending', 'incomplete', 'unknown'] },
          failedCleanupCount: { type: 'integer', minimum: 0 },
          deletionEligibility: {
            type: 'string',
            enum: [
              'not_eligible',
              'policy_definition_required',
              'blocked_incomplete_cleanup',
              'human_review_required',
            ],
          },
          blockers: { type: 'array', items: { type: 'string' } },
          nextGate: { type: 'string', enum: ['human_policy_design_review'] },
        },
      },
    },
  },
};

function projectOpenApi(
  summary,
  { body, query = [], id = false, list = false, deleted = false, read = false, response } = {}
) {
  return {
    summary,
    tags: ['Project files'],
    'x-agentable': read,
    security: [{ bearerAuth: [] }],
    parameters: [
      ...(id
        ? [
            {
              name: 'projectId',
              in: 'path',
              required: true,
              schema: { type: 'string', example: '7aa2b3f9-22dc-4fd2-8722-a94dc16cab79' },
              example: '7aa2b3f9-22dc-4fd2-8722-a94dc16cab79',
            },
          ]
        : []),
      ...query.map((name) => ({
        name,
        in: 'query',
        schema: {
          type: name === 'routingOnly' ? 'boolean' : 'string',
          example: name === 'routingOnly' ? false : `${name}-example`,
        },
        example: name === 'routingOnly' ? false : `${name}-example`,
      })),
    ],
    ...(body
      ? {
          requestBody: {
            required: true,
            content: {
              'application/json': {
                schema: body,
                examples: {
                  project: {
                    summary: 'Example project',
                    value: {
                      title: 'Example project',
                      members: [],
                      projectRefs: [{ caseId: 'example-case' }],
                    },
                  },
                },
                example: {
                  title: 'Example project',
                  members: [],
                  projectRefs: [{ caseId: 'example-case' }],
                },
              },
            },
          },
        }
      : {}),
    responses: {
      200: {
        description: 'Tenant-scoped project result',
        content: {
          'application/json': {
            schema: response
              ? response
              : deleted
                ? {
                    type: 'object',
                    properties: { deleted: { type: 'boolean' }, projectId: { type: 'string' } },
                  }
                : list
                  ? { type: 'array', items: projectSchema }
                  : projectSchema,
          },
        },
      },
      404: { description: 'Project absent or invisible to the authenticated principal' },
      409: { description: 'Project archived or deletion in progress' },
      503: { description: 'Deletion incomplete; retry after cleanup recovery' },
    },
  };
}

module.exports = { projectSchema, administrationOverviewSchema, projectOpenApi };
