'use strict';

const objectSchema = {
  type: 'object',
  properties: {
    objectId: { type: 'string' },
    projectId: { type: 'string' },
    name: { type: 'string' },
    mimeType: { type: 'string' },
    size: { type: 'integer' },
    hash: { type: 'string' },
    status: { type: 'string', enum: ['receiving', 'received', 'failed', 'extracted'] },
    chunks: {
      type: 'array',
      items: {
        type: 'object',
        properties: {
          hash: { type: 'string' },
          size: { type: 'integer' },
        },
      },
    },
    provenance: {
      type: 'object',
      properties: { actorId: { type: 'string' }, uploadId: { type: 'string' } },
    },
    receivedAt: { type: 'string', format: 'date-time' },
    sensitivityLevel: { type: 'string' },
  },
};
const startProperties = {
  projectId: { type: 'string', example: 'example-project' },
  name: { type: 'string', example: 'documents.zip' },
  size: { type: 'integer', minimum: 1, example: 1024 },
  hash: { type: 'string', pattern: '^[a-f0-9]{64}$', example: 'a'.repeat(64) },
  mimeType: { type: 'string', example: 'application/zip' },
  sensitivityLevel: {
    type: 'string',
    enum: ['public', 'tenant_internal', 'restricted', 'highly_sensitive'],
    example: 'tenant_internal',
  },
  requiredClearance: { type: 'array', items: { type: 'string' }, example: [] },
  chunks: { ...objectSchema.properties.chunks, example: [{ hash: 'a'.repeat(64), size: 1024 }] },
};

function ingestOpenApi(kind, summary) {
  const read = ['status', 'objects'].includes(kind);
  const pathNames = kind === 'objects' ? ['projectId'] : kind === 'start' ? [] : ['uploadId'];
  if (kind === 'chunk') pathNames.push('index');
  const parameters = pathNames.map((name) => ({
    name,
    in: 'path',
    required: true,
    schema: {
      type: name === 'index' ? 'integer' : 'string',
      example: name === 'index' ? 0 : 'example-id',
    },
  }));
  if (kind === 'chunk')
    parameters.push({
      name: 'hash',
      in: 'query',
      required: true,
      schema: { type: 'string', pattern: '^[a-f0-9]{64}$', example: 'a'.repeat(64) },
    });
  return {
    summary,
    tags: ['Project ingest'],
    'x-agentable': read,
    description:
      'Tenant-scoped resumable project ingest. SHA-256 hashes are lowercase hex. Chunks use a raw octet stream; status lists received and missing indexes. Completed originals trigger project.object.received.v1. The async job is polled through /api/jobs/:jobId/status.',
    security: [{ bearerAuth: [] }],
    parameters,
    ...(kind === 'start'
      ? {
          requestBody: {
            required: true,
            content: {
              'application/json': {
                schema: {
                  type: 'object',
                  required: ['projectId', 'name', 'size', 'hash'],
                  properties: startProperties,
                },
                example: {
                  projectId: 'example-project',
                  name: 'documents.zip',
                  size: 1024,
                  hash: 'a'.repeat(64),
                  mimeType: 'application/zip',
                },
                examples: {
                  upload: {
                    summary: 'Start a resumable bundle upload',
                    value: {
                      projectId: 'example-project',
                      name: 'documents.zip',
                      size: 1024,
                      hash: 'a'.repeat(64),
                      mimeType: 'application/zip',
                    },
                  },
                },
              },
            },
          },
        }
      : {}),
    ...(kind === 'chunk'
      ? {
          requestBody: {
            required: true,
            content: {
              'application/octet-stream': {
                schema: { type: 'string', format: 'binary' },
                example: 'raw chunk bytes',
              },
            },
          },
        }
      : {}),
    responses: {
      200: {
        description: summary,
        content: {
          'application/json': {
            schema:
              kind === 'objects'
                ? { type: 'array', items: objectSchema }
                : {
                    type: 'object',
                    properties: {
                      uploadId: { type: 'string' },
                      objectId: { type: 'string' },
                      chunkSize: { type: 'integer' },
                      status: objectSchema.properties.status,
                      chunks: { type: 'array', items: { type: 'object' } },
                      missing: { type: 'array', items: { type: 'integer' } },
                      job: {
                        type: 'object',
                        properties: { jobId: { type: 'string' }, status: { type: 'string' } },
                      },
                    },
                  },
          },
        },
      },
      ...(kind === 'complete'
        ? { 202: { description: 'Ingest job queued; poll Location or upload status' } }
        : {}),
      403: { description: 'Insufficient sensitivity clearance or authentication' },
      404: { description: 'Upload/project absent or invisible' },
      409: { description: 'Immutable project, failed upload or missing chunks' },
      413: { description: 'Project, file, chunk or archive limit exceeded' },
      422: { description: 'Invalid hash or unsafe archive' },
      429: { description: 'Tenant async job quota exhausted' },
      507: { description: 'Insufficient free disk space' },
    },
  };
}

module.exports = { ingestOpenApi, objectSchema };
