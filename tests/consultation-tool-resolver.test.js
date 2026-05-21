'use strict';

const {
  parseServiceAction,
  moleculerParamsToJsonSchema,
  getToolParamSchema,
  buildToolParametersLLM,
  executeToolWithRetry,
} = require('../src/consultation-tool-resolver');

describe('consultation-tool-resolver', () => {
  test('parseServiceAction splits service and action names', () => {
    expect(parseServiceAction('grid-operations.marketPartners')).toEqual({
      serviceName: 'grid-operations',
      actionName: 'marketPartners',
    });
  });

  test('moleculerParamsToJsonSchema maps required and optional fields', () => {
    const schema = moleculerParamsToJsonSchema({
      query: { type: 'string', min: 1 },
      limit: { type: 'number', optional: true, min: 1, max: 10 },
      mode: { type: 'enum', values: ['a', 'b'], optional: true },
    });

    expect(schema.type).toBe('object');
    expect(schema.required).toEqual(['query']);
    expect(schema.properties.query.type).toBe('string');
    expect(schema.properties.limit.type).toBe('number');
    expect(schema.properties.mode.enum).toEqual(['a', 'b']);
  });

  test('getToolParamSchema prefers Moleculer action params (priority A)', async () => {
    const ctx = {
      broker: {
        getLocalService: jest.fn().mockReturnValue({
          actions: {
            marketPartners: {
              params: {
                query: { type: 'string' },
                limit: { type: 'number', optional: true },
              },
            },
          },
        }),
      },
      call: jest.fn(),
    };

    const result = await getToolParamSchema(ctx, 'grid-operations.marketPartners');

    expect(result.source).toBe('moleculer');
    expect(result.schema.required).toEqual(['query']);
    expect(ctx.call).not.toHaveBeenCalled();
  });

  test('getToolParamSchema falls back to OpenAPI when Moleculer schema is unavailable', async () => {
    const ctx = {
      meta: { tenantId: 'tenant-a' },
      broker: {
        getLocalService: jest.fn().mockReturnValue(null),
        hasLocalService: jest.fn().mockImplementation((name) => name === 'api'),
      },
      call: jest.fn().mockResolvedValue({
        paths: {
          '/api/grid-operations/market-partners': {
            get: {
              operationId: 'grid_operations_marketPartners',
              parameters: [
                {
                  name: 'query',
                  required: true,
                  schema: { type: 'string' },
                },
                {
                  name: 'limit',
                  required: false,
                  schema: { type: 'number' },
                },
              ],
            },
          },
        },
      }),
    };

    const result = await getToolParamSchema(ctx, 'grid-operations.marketPartners');

    expect(result.source).toBe('openapi');
    expect(result.schema.required).toEqual(['query']);
    expect(result.schema.properties.limit.type).toBe('number');
  });

  test('buildToolParametersLLM validates required fields and strips unknown keys', async () => {
    const schema = {
      type: 'object',
      properties: {
        ort: { type: 'string' },
        name: { type: 'string' },
      },
      required: ['ort'],
    };

    const result = await buildToolParametersLLM(
      {},
      {
        toolName: 'grid-operations.marketPartners',
        schema,
        knownFacts: { location: 'Walldorf' },
        userMessage: 'Stadtwerke Walldorf, BDEW unbekannt',
        generate: async () => ({ text: '{"ort":"Walldorf","name":"Stadtwerke Walldorf","foo":"bar"}' }),
      }
    );

    expect(result.params).toEqual({
      ort: 'Walldorf',
      name: 'Stadtwerke Walldorf',
    });
  });

  test('executeToolWithRetry retries after empty result and succeeds on second attempt', async () => {
    const callMock = jest
      .fn()
      .mockResolvedValueOnce({ data: { results: [] } })
      .mockResolvedValueOnce({ data: { results: [{ name: 'Stadtwerke Walldorf' }] } });

    const ctx = {
      meta: { tenantId: 'tenant-a' },
      broker: {
        getLocalService: jest.fn().mockReturnValue({
          actions: {
            marketPartners: {
              params: {
                query: { type: 'string' },
                limit: { type: 'number', optional: true },
              },
            },
          },
        }),
      },
      call: callMock,
    };

    const llmGenerate = jest
      .fn()
      .mockResolvedValueOnce({ text: '{"query":"Walldorf","limit":5}' })
      .mockResolvedValueOnce({ text: '{"query":"Stadtwerke Walldorf","limit":5}' });

    const result = await executeToolWithRetry(ctx, {
      toolName: 'grid-operations.marketPartners',
      knownFacts: { location: 'Walldorf' },
      userMessage: 'Stadtwerke Walldorf, der BDEW-Code ist unbekannt',
      maxAttempts: 3,
      llmGenerate,
    });

    expect(result.success).toBe(true);
    expect(result.attempt).toBe(2);
    expect(result.attemptsLog).toHaveLength(1);
    expect(result.attemptsLog[0].step).toBe('empty-result');
    expect(callMock).toHaveBeenCalledTimes(2);
  });

  test('executeToolWithRetry fails fast with explicit error when no schema is available', async () => {
    const ctx = {
      broker: {
        getLocalService: jest.fn().mockReturnValue(null),
      },
      call: jest.fn().mockRejectedValue(new Error('service unavailable')),
    };

    const result = await executeToolWithRetry(ctx, {
      toolName: 'grid-operations.marketPartners',
      knownFacts: {},
      userMessage: 'Walldorf',
      allowOpenApiFallback: false,
    });

    expect(result.success).toBe(false);
    expect(result.failFast).toBe(true);
    expect(result.error).toContain('SCHEMA_UNAVAILABLE');
  });
});
