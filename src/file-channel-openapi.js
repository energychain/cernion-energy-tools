'use strict';
const { TYPES } = require('./file-channel-policy');
const referenceSchema = {
  type: 'object',
  required: ['fileId', 'name', 'mimeType', 'size', 'hash'],
  properties: {
    fileId: { type: 'string', pattern: '^[a-f0-9]{64}$' },
    hash: { type: 'string', pattern: '^[a-f0-9]{64}$' },
    name: { type: 'string', maxLength: 200 },
    mimeType: { type: 'string', enum: Object.values(TYPES) },
    size: { type: 'integer', minimum: 1 },
    duplicate: { type: 'boolean' },
  },
};
function fileOpenApi(kind, summary) {
  const schema = kind === 'upload' ? referenceSchema : { type: 'object' };
  const common = {
    summary,
    description:
      'Authenticated tenant and current Workbench mapping/clearance required. Gateway credentials delegate no independent privileges. No file contents are logged.',
    tags: ['Files'],
    security: [{ bearerAuth: [] }],
    responses: {
      200: { description: summary, content: { 'application/json': { schema } } },
      401: { description: 'Authentication required' },
      403: { description: 'Mapping, tenant, confidentiality or signed-link authorization denied' },
      413: { description: 'Configured file/expanded archive budget exceeded' },
      422: { description: 'Invalid file type, name or encoding' },
    },
  };
  if (kind === 'upload')
    common.requestBody = {
      required: true,
      content: {
        'application/json': {
          schema: {
            type: 'object',
            required: ['name', 'contentBase64'],
            properties: {
              name: referenceSchema.properties.name,
              contentBase64: { type: 'string', format: 'byte' },
              mimeType: referenceSchema.properties.mimeType,
              sensitivityLevel: {
                type: 'string',
                enum: ['public', 'tenant_internal', 'restricted', 'highly_sensitive'],
                default: 'tenant_internal',
              },
              openWebuiOrgId: { type: 'string' },
            },
          },
        },
      },
    };
  if (['download', 'link', 'remove'].includes(kind))
    common.parameters = [
      { name: 'fileId', in: 'path', required: true, schema: referenceSchema.properties.fileId },
      { name: 'openWebuiOrgId', in: 'query', schema: { type: 'string' } },
    ];
  if (kind === 'download') {
    common.parameters.push({
      name: 'ticket',
      in: 'query',
      required: true,
      schema: { type: 'string', maxLength: 2048 },
      description: 'Signed seven-day capability; current tenant authentication is also required.',
    });
    common.responses[200].content = Object.fromEntries(
      Object.values(TYPES).map((type) => [type, { schema: { type: 'string', format: 'binary' } }])
    );
  }
  return common;
}
module.exports = { referenceSchema, fileOpenApi };
