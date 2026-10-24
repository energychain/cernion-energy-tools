'use strict';

function bundleOpenApi(params) {
  const { stream, ...fields } = params;
  return {
    summary: 'Mapped-person project bundle transport; original upload and conversation status',
    tags: ['Project bundle transport'],
    'x-agentable': false,
    security: [{ bearerAuth: [] }],
    parameters: [
      { name: 'conversationId', in: 'query', required: true, schema: { type: 'string' } },
    ],
    requestBody: {
      required: true,
      content: stream
        ? { 'application/octet-stream': { schema: { type: 'string', format: 'binary' } } }
        : {
            'application/json': {
              schema: {
                type: 'object',
                properties: Object.fromEntries(
                  Object.entries(fields).map(([name, value]) => [
                    name,
                    {
                      type: value.type === 'array' ? 'array' : value.type,
                      ...(value.type === 'array' ? { items: { type: 'object' } } : {}),
                    },
                  ])
                ),
              },
            },
          },
    },
    responses: {
      200: {
        description: 'Authorized bundle state',
        content: { 'application/json': { schema: { type: 'object', additionalProperties: true } } },
      },
      403: { description: 'Mapping, membership or clearance missing' },
      413: { description: 'Upload limit exceeded' },
    },
  };
}
module.exports = { bundleOpenApi };
