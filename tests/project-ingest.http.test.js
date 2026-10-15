'use strict';

const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { ServiceBroker } = require('moleculer');
const Gateway = require('moleculer-web');
const { hash } = require('./helpers/project-ingest');

test('raw auto-alias streams octets with real gateway auth; archive/delete require the regular gateway write role', async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'cet-ingest-http-'));
  const broker = new ServiceBroker({ logger: false, transporter: null });
  broker.createService({
    ...require('../services/object-store.service'),
    settings: { dbPath: path.join(dir, 'objects') },
  });
  broker.createService(require('../services/project-file.service'));
  broker.createService({
    ...require('../services/project-upload.service'),
    settings: { dataPath: path.join(dir, 'originals') },
  });
  broker.createService({
    name: 'auth',
    actions: {
      verify: {
        handler(ctx) {
          return {
            valid: true,
            sessionId: 'synthetic',
            userId: 'actor-a',
            tenantId: ctx.params.token === 'csess_other' ? 'tenant-b' : 'tenant-a',
            roles: ['csess_editor', 'csess_other'].includes(ctx.params.token)
              ? ['ROLE_ALPHA', 'full-access']
              : ['ROLE_ALPHA'],
          };
        },
      },
    },
  });
  const mainRoute = require('../services/api.service').settings.routes.find(
    (route) => route.path === '/api'
  );
  const api = broker.createService({
    name: 'synthetic-api',
    mixins: [Gateway],
    settings: {
      port: 0,
      ip: '127.0.0.1',
      routes: [
        {
          path: '/api',
          autoAliases: true,
          whitelist: ['project-file.**', 'project-upload.**'],
          mappingPolicy: 'restrict',
          bodyParsers: mainRoute.bodyParsers,
          onBeforeCall: mainRoute.onBeforeCall,
        },
      ],
    },
  });
  try {
    await broker.start();
    api.regenerateAutoAliases(api.routes[0]);
    const base = `http://127.0.0.1:${api.server.address().port}/api`;
    const request = (
      url,
      method = 'GET',
      body,
      token = 'csess_editor',
      type = 'application/json'
    ) =>
      fetch(`${base}${url}`, {
        method,
        headers: { authorization: `Bearer ${token}`, 'content-type': type },
        ...(body === undefined
          ? {}
          : { body: type === 'application/json' ? JSON.stringify(body) : body }),
      });
    const create = await request('/project-file/', 'POST', { title: 'HTTP raw upload' });
    expect(create.status).toBe(200);
    const { projectId } = await create.json();
    const bytes = Buffer.alloc(128 * 1024, 97);
    const response = await request('/project-upload/start', 'POST', {
      projectId,
      name: 'raw.txt',
      size: bytes.length,
      hash: hash(bytes),
    });
    expect(response.status).toBe(200);
    const started = await response.json();
    const url = `/project-upload/uploads/${started.uploadId}/chunks/0?hash=${hash(bytes)}`;
    const chunk = await request(url, 'PUT', bytes, 'csess_editor', 'application/octet-stream');
    expect(chunk.status).toBe(200);
    expect((await chunk.json()).missing).toEqual([]);
    const again = await request(url, 'PUT', bytes, 'csess_editor', 'application/octet-stream');
    expect(again.status).toBe(200);
    const status = await request(
      `/project-upload/uploads/${started.uploadId}`,
      'GET',
      undefined,
      'csess_viewer'
    );
    expect(status.status).toBe(200);
    expect((await status.json()).chunks[0].hash).toBe(hash(bytes));
    expect(
      (
        await request(
          `/project-upload/uploads/${started.uploadId}`,
          'GET',
          undefined,
          'csess_other'
        )
      ).status
    ).toBe(404);
    expect(
      (
        await request(
          '/project-upload/start',
          'POST',
          { projectId, name: 'blocked.txt', size: 1, hash: hash(Buffer.from('x')) },
          'csess_viewer'
        )
      ).status
    ).toBe(403);
    const limited = await request('/project-upload/start', 'POST', {
      projectId,
      name: 'limited.txt',
      size: 1,
      hash: hash(Buffer.from('x')),
    });
    const limitedUpload = await limited.json();
    const oversized = await request(
      `/project-upload/uploads/${limitedUpload.uploadId}/chunks/0?hash=${hash(Buffer.from('x'))}`,
      'PUT',
      Buffer.alloc(4 * 1024 ** 2, 120),
      'csess_editor',
      'application/octet-stream'
    );
    expect(oversized.status).toBe(413);
    const failed = await request(`/project-upload/uploads/${limitedUpload.uploadId}`);
    expect((await failed.json()).status).toBe('failed');
    expect(
      (await request(`/project-file/${projectId}/archive`, 'POST', {}, 'csess_other')).status
    ).toBe(404);
    expect(
      (await request(`/project-file/${projectId}/archive/`, 'POST', {}, 'csess_viewer')).status
    ).toBe(403);
    expect(
      (await request(`/project-file/${projectId}/`, 'DELETE', undefined, 'csess_viewer')).status
    ).toBe(403);
    expect(
      (await request(`/project-file/${projectId}/archive/`, 'POST', {}, 'csess_editor')).status
    ).toBe(200);
    expect(
      (await request(`/project-file/${projectId}/`, 'DELETE', undefined, 'csess_editor')).status
    ).toBe(200);
    expect((await request(`/project-file/${projectId}`, 'GET')).status).toBe(404);
    for (const action of ['ingestMutation', 'deleteProject', 'purge'])
      expect((await request(`/project-upload/${action}`, 'POST', { projectId })).status).toBe(404);
  } finally {
    await broker.stop();
    fs.rmSync(dir, { recursive: true, force: true });
  }
}, 60000);
