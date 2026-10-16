'use strict';
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { ServiceBroker } = require('moleculer');
const Gateway = require('moleculer-web');
const { auth } = require('./helpers/project-ingest');
const policy = require('../src/project-graph-policy');

test('REST graph aliases are read-only, tenant scoped and keep all internal actions private', async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'cet-graph-http-'));
  const broker = new ServiceBroker({ logger: false, transporter: null });
  broker.createService({
    ...require('../services/object-store.service'),
    settings: { dbPath: path.join(dir, 'objects') },
  });
  broker.createService(require('../services/project-file.service'));
  broker.createService({ name: 'project-structure' });
  broker.createService(require('../services/project-graph.service'));
  const api = broker.createService({
    name: 'synthetic-api',
    mixins: [Gateway],
    settings: {
      port: 0,
      ip: '127.0.0.1',
      routes: [
        {
          path: '/api',
          whitelist: ['project-graph.**'],
          autoAliases: true,
          mappingPolicy: 'restrict',
          onBeforeCall(ctx, _route, req) {
            ctx.meta = auth(req.headers['x-test-tenant'] || 'tenant-a');
          },
        },
      ],
    },
  });
  try {
    await broker.start();
    api.regenerateAutoAliases(api.routes[0]);
    const { projectId } = await broker.call(
      'project-file.create',
      { title: 'HTTP fixture' },
      { meta: auth() }
    );
    const node = {
      recordType: 'node',
      nodeId: 'n-one',
      tenantId: 'tenant-a',
      projectId,
      kind: 'dataset',
      ref: 'reference',
      labels: ['Example'],
      attributes: { field: 'value' },
      provenance: {},
      derivation: { version: '1' },
    };
    await broker.call(
      'object-store.projectGraphRecord',
      { operation: 'write', projectId, documents: [node] },
      { meta: { ...auth(), projectGraph: policy.capability } }
    );
    const base = `http://127.0.0.1:${api.server.address().port}/api/project-graph`;
    for (const suffix of [
      'nodes?kind=dataset&label=Example',
      'neighbors?nodeId=n-one&depth=3',
      'resolve?nodeId=n-one',
    ]) {
      const response = await fetch(`${base}/${projectId}/${suffix}`);
      expect(response.status).toBe(200);
      expect((await response.json()).nodes[0].nodeId).toBe('n-one');
      expect(
        (
          await fetch(`${base}/${projectId}/${suffix}`, {
            headers: { 'x-test-tenant': 'tenant-b' },
          })
        ).status
      ).toBe(404);
    }
    expect((await fetch(`${base}/${projectId}/neighbors?nodeId=n-one&depth=4`)).status).toBe(422);
    for (const action of ['run', 'correct', 'deleteProject'])
      expect((await fetch(`${base}/${action}`, { method: 'POST' })).status).toBe(404);
    await broker.call('project-file.archive', { projectId }, { meta: auth() });
    expect((await fetch(`${base}/${projectId}/nodes`)).status).toBe(404);
  } finally {
    await broker.stop();
    fs.rmSync(dir, { recursive: true, force: true });
  }
});
