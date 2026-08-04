'use strict';

const { ServiceBroker } = require('moleculer');
const AgentManifestService = require('../services/agent-manifest.service');

// v0.99.7: cernion_describe(kind=operation) used to return only
// {method,path,operationId,summary,tags} — no parameter or request-body
// schema, so an MCP client had no way to discover what to filter/pass
// before calling cernion_execute_read (found while scoping "full capability
// exposure" — the schema was always present in openapi-export.json, just
// never carried through agent-manifest.listOperations). These tests run
// against the real generated openapi-export.json, not a stub, since the
// point is verifying the real spec's schema survives the round trip.
describe('agent-manifest service — operation parameter/requestBody exposure (v0.99.7)', () => {
  let broker;

  beforeAll(async () => {
    broker = new ServiceBroker({ logger: false });
    broker.createService(AgentManifestService);
    await broker.start();
  });

  afterAll(() => broker.stop());

  test('includes requestBody schema for a body-based operation (gas-storage.countryStorage)', async () => {
    const res = await broker.call('agent-manifest.listOperations', {});
    const op = res.data.find((o) => o.operationId === 'gas-storage_countryStorage');
    expect(op).toBeDefined();
    expect(op.requestBody).toBeTruthy();
    const schema = op.requestBody.content['application/json'].schema;
    expect(schema.required).toContain('country');
    expect(schema.properties).toHaveProperty('country');
  });

  test('includes query parameters for a GET operation', async () => {
    const res = await broker.call('agent-manifest.listOperations', {});
    const op = res.data.find(
      (o) => o.method === 'GET' && Array.isArray(o.parameters) && o.parameters.length > 0
    );
    expect(op).toBeDefined();
    expect(op.parameters[0]).toHaveProperty('name');
    expect(op.parameters[0]).toHaveProperty('in');
  });

  test('includes the full description text, not just summary', async () => {
    const res = await broker.call('agent-manifest.listOperations', {});
    const op = res.data.find((o) => o.operationId === 'gas-storage_countryStorage');
    expect(op.description).toEqual(expect.stringContaining('AGSI+'));
    expect(op.description.length).toBeGreaterThan(op.summary.length);
  });

  test('operations without a requestBody expose null, not undefined', async () => {
    const res = await broker.call('agent-manifest.listOperations', {});
    const op = res.data.find((o) => o.method === 'GET');
    expect(op).toBeDefined();
    expect(op.requestBody).toBeNull();
  });
});
