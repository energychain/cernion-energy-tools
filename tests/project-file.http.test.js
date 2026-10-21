'use strict';

const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { ServiceBroker } = require('moleculer');
const Gateway = require('moleculer-web');
const Store = require('../services/object-store.service');
const Project = require('../services/project-file.service');
const { auth } = require('./helpers/case-linking-broker');

test('gateway auto-aliases expose CRUD and refs, preserve tenant/clearance filtering, and never expose internal actions', async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'cet-project-http-'));
  const broker = new ServiceBroker({ logger: false, transporter: null });
  broker.createService({ ...Store, settings: { dbPath: path.join(dir, 'objects') } });
  broker.createService(Project);
  const api = broker.createService({
    name: 'synthetic-api',
    mixins: [Gateway],
    settings: {
      port: 0,
      ip: '127.0.0.1',
      routes: [
        {
          path: '/api',
          whitelist: ['project-file.**'],
          autoAliases: true,
          mappingPolicy: 'restrict',
          bodyParsers: { json: true },
          onBeforeCall(ctx, _route, req) {
            ctx.meta = auth(
              'actor-a',
              ['ROLE_ALPHA'],
              req.headers['x-test-tenant'] || 'tenant-a',
              req.headers['x-test-clearance'] === 'yes' ? ['restricted'] : []
            );
          },
        },
      ],
    },
  });
  try {
    await broker.start();
    api.regenerateAutoAliases(api.routes[0]);
    const base = `http://127.0.0.1:${api.server.address().port}/api/project-file`;
    const request = (suffix, method = 'GET', body, headers = {}) =>
      fetch(`${base}${suffix}`, {
        method,
        headers: { 'content-type': 'application/json', ...headers },
        ...(body ? { body: JSON.stringify(body) } : {}),
      });
    const created = await request('/', 'POST', {
      title: 'Synthetic HTTP',
      projectRefs: [{ caseId: 'case-http' }],
    });
    expect(created.status).toBe(200);
    const { projectId } = await created.json();
    expect((await request(`/${projectId}`)).status).toBe(200);
    const refs = await request('/refs?caseId=case-http');
    expect(refs.status).toBe(200);
    expect(await refs.json()).toHaveLength(1);
    for (const method of ['GET', 'PATCH', 'DELETE'])
      expect(
        (
          await request(
            `/${projectId}`,
            method,
            method === 'PATCH' ? { title: 'Foreign' } : undefined,
            { 'x-test-tenant': 'tenant-b' }
          )
        ).status
      ).toBe(404);
    await broker.call(
      'project-file.registerComponent',
      {
        projectId,
        componentId: 'synthetic',
        sensitivityLevel: 'restricted',
        cleanupAction: 'synthetic.cleanup',
      },
      { meta: auth('actor-a', ['ROLE_ALPHA'], 'tenant-a', ['restricted']) }
    );
    expect((await request(`/${projectId}`)).status).toBe(404);
    expect(await (await request('/')).json()).toEqual([]);
    expect(
      (await request(`/${projectId}`, 'GET', undefined, { 'x-test-clearance': 'yes' })).status
    ).toBe(200);
    const overview = await request('/administration-overview');
    expect(overview.status).toBe(200);
    expect(await overview.json()).toEqual({
      safetyClass: 'read_only_governance_projection',
      advisory: true,
      projects: [],
    });
    const cleared = await (
      await request('/administration-overview', 'GET', undefined, { 'x-test-clearance': 'yes' })
    ).json();
    expect(cleared.projects).toEqual([
      expect.objectContaining({
        projectId,
        requiredClearance: ['restricted'],
        responsibility: expect.objectContaining({
          projection: 'legacy_responsibility_projection',
          grantsAuthority: false,
        }),
        deletionEligibility: 'policy_definition_required',
      }),
    ]);
    expect(
      (
        await (
          await request('/administration-overview', 'GET', undefined, {
            'x-test-tenant': 'tenant-b',
            'x-test-clearance': 'yes',
          })
        ).json()
      ).projects
    ).toEqual([]);
    for (const method of ['POST', 'PATCH', 'DELETE'])
      expect((await request('/administration-overview', method, {})).status).toBe(404);
    expect(
      (await request(`/${projectId}`, 'GET', undefined, { 'x-test-clearance': 'yes' })).status
    ).toBe(200);
    for (const action of ['setLifecycle', 'registerComponent', 'recomputeClearance', 'addFile'])
      expect((await request(`/${action}`, 'POST', { projectId })).status).toBe(404);
  } finally {
    await broker.stop();
    fs.rmSync(dir, { recursive: true, force: true });
  }
});
