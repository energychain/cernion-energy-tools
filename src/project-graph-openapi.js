'use strict';
const { kinds, relations } = require('./project-graph-policy');
const nodeSchema = {
  type: 'object',
  required: [
    'nodeId',
    'projectId',
    'kind',
    'ref',
    'labels',
    'attributes',
    'provenance',
    'derivation',
  ],
  properties: {
    nodeId: { type: 'string' },
    projectId: { type: 'string' },
    kind: { type: 'string', enum: kinds },
    ref: {},
    labels: { type: 'array', items: { type: 'string' } },
    attributes: { type: 'object', additionalProperties: true },
    provenance: { type: 'object', additionalProperties: true },
    derivation: { type: 'object', properties: { version: { type: 'string' } } },
  },
};
const edgeSchema = {
  type: 'object',
  required: [
    'edgeId',
    'projectId',
    'from',
    'to',
    'relation',
    'weight',
    'evidence',
    'origin',
    'derivation',
  ],
  properties: {
    edgeId: { type: 'string' },
    projectId: { type: 'string' },
    from: { type: 'string' },
    to: { type: 'string' },
    relation: { type: 'string', enum: relations },
    weight: { type: 'number', minimum: 0, maximum: 1 },
    evidence: { type: 'array', items: { type: 'object', additionalProperties: true } },
    origin: { type: 'string', enum: ['derived', 'observed', 'corrected'] },
    derivation: nodeSchema.properties.derivation,
  },
};
function graphOpenApi(summary, query = []) {
  return {
    summary,
    tags: ['Project graph'],
    'x-agentable': true,
    security: [{ bearerAuth: [] }],
    parameters: [
      {
        name: 'projectId',
        in: 'path',
        required: true,
        schema: { type: 'string', example: 'project-example' },
      },
      ...query.map((name) => ({
        name,
        in: 'query',
        required: name === 'nodeId',
        schema:
          name === 'depth' || name === 'limit'
            ? { type: 'integer', minimum: 1, maximum: name === 'depth' ? 3 : 1000, example: 1 }
            : {
                type: 'string',
                example:
                  name === 'kind' ? 'dataset' : name === 'relation' ? 'joinsOn' : 'node-example',
              },
      })),
    ],
    responses: {
      200: {
        description: 'Visible project graph; bounded traversal and provenance',
        content: {
          'application/json': {
            schema: {
              type: 'object',
              properties: {
                nodes: { type: 'array', items: nodeSchema },
                edges: { type: 'array', items: edgeSchema },
                truncated: { type: 'boolean' },
              },
            },
          },
        },
      },
      404: { description: 'Project or node absent or invisible' },
    },
  };
}
module.exports = { graphOpenApi };
