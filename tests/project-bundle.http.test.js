'use strict';

jest.mock('../src/llm-client', () => ({
  generateStructured: jest.fn(),
  generateText: jest.fn(),
  embeddings: jest.fn(async (texts) => texts.map(() => [1, 0])),
  capabilities: () => ({ embeddings: true }),
}));
const fs = require('node:fs');
const path = require('node:path');
const { createCaseBroker, auth } = require('./helpers/case-linking-broker');
const { provisionToken } = require('../scripts/provision-token');
const { provisionMapping } = require('../scripts/provision-workbench-mapping');
const { hash } = require('./helpers/project-ingest');
const llm = require('../src/llm-client');
const { excludeProjectContext } = require('../src/openwebui-project-context');
let app, env, base, gateway, foreign;

async function request(route, method = 'GET', data, user = 'person-a', token = gateway.token) {
  const response = await fetch(base + route, {
    method,
    headers: {
      Authorization: 'Bearer ' + token,
      'X-OpenWebUI-User-Id': user,
      'Content-Type': Buffer.isBuffer(data) ? 'application/octet-stream' : 'application/json',
    },
    ...(data == null ? {} : { body: Buffer.isBuffer(data) ? data : JSON.stringify(data) }),
  });
  return { status: response.status, body: await response.json() };
}
const endpoint = (route, conversationId = 'chat-a') =>
  `/v1/project-bundle/${route}${route.includes('?') ? '&' : '?'}conversationId=${conversationId}`;
const files = [
  { id: 'file-a', name: 'values.csv', size: 18, textHash: hash('extracted') },
  { id: 'file-b', name: 'unknown.bin', size: 1 },
];

beforeAll(async () => {
  env = { ...process.env };
  app = await createCaseBroker();
  Object.assign(process.env, {
    CERNION_SUPPORT_TOKEN: 'synthetic-bootstrap',
    CERNION_SUPPORT_TOKEN_INPUT: 'synthetic-bootstrap',
    CERNION_TENANT_REGISTRY_FILE: app.registry,
    CERNION_USER_REGISTRY_FILE: path.join(app.dir, 'users.json'),
    TOKEN_ROLE_AUDIT_FILE: path.join(app.dir, 'audit.jsonl'),
    RATE_QUOTA_DIR: path.join(app.dir, 'quotas'),
    JOB_STORE_DIR: path.join(app.dir, 'jobs'),
    WORKBENCH_DATASET_DB_PATH: path.join(app.dir, 'datasets'),
    CET_PROJECT_CHUNK_BYTES: '65536',
    DATAPOINT_SCHEDULER_ENABLED: 'false',
  });
  app.workbench.settings.projectSkills = { delayMs: 2 ** 31 - 1 };
  fs.writeFileSync(app.registry, JSON.stringify([{ tenantId: 'public' }, { tenantId: 'foreign' }]));
  const services = [
    [
      'token-manager',
      {
        storageFile: path.join(app.dir, 'tokens.json'),
        signalQueueFile: path.join(app.dir, 'signals.json'),
      },
    ],
    ['object-store', { dbPath: path.join(app.dir, 'objects') }],
    ['project-file', {}],
    ['project-upload', { dataPath: path.join(app.dir, 'originals') }],
    ['project-bundle', { dbPath: path.join(app.dir, 'bundle') }],
    ['project-structure', { dataPath: path.join(app.dir, 'originals') }],
    ['datapoint', { dbPath: path.join(app.dir, 'datapoints') }],
    ['dataset', {}],
    ['knowledge-rag', { tenantEvidenceEnrichment: { delayMs: 2 ** 31 - 1 } }],
    ['openai-compatible', {}],
    ['api', { port: 0 }],
  ];
  for (const [name, settings] of services) {
    const source = require(`../services/${name}.service`);
    app.broker.createService({ ...source, settings: { ...source.settings, ...settings } });
  }
  await app.broker.start();
  const api = app.broker.getLocalService('api');
  for (const route of api.routes.filter((r) => r.opts.autoAliases))
    api.regenerateAutoAliases(route);
  base = `http://127.0.0.1:${api.server.address().port}`;
  const makeToken = (tenant, org) =>
    provisionToken(
      {
        tenant,
        org,
        user: 'svc:synthetic',
        name: 'Synthetic',
        gateway: true,
        client: 'open-webui',
      },
      app.broker
    );
  gateway = (await makeToken('public', 'org-test')).data;
  foreign = (await makeToken('foreign', 'org-foreign')).data;
  for (const [tenant, org, user] of [
    ['public', 'org-test', 'person-a'],
    ['public', 'org-test', 'person-b'],
    ['foreign', 'org-foreign', 'person-a'],
  ])
    await provisionMapping(
      { tenant, org, user, client: 'open-webui', actor: user, roles: 'ROLE_GRID_OPERATOR' },
      app.broker
    );
});
afterAll(async () => {
  await app.cleanup();
  process.env = env;
});
beforeEach(() => llm.generateStructured.mockReset());

function intent(action, message, title = '') {
  llm.generateStructured.mockResolvedValueOnce({ action, title, basis: message });
}

test('asks once, accepts without reattachment, keeps small files in text mode and isolates people', async () => {
  intent('none', 'Bitte ansehen');
  const first = await request(endpoint('prepare', 'ask'), 'POST', {
    message: 'Bitte ansehen',
    files,
  });
  expect(first).toMatchObject({
    status: 200,
    body: { mode: 'ask', reply: 'Soll ich das als Projektakte anlegen?' },
  });
  intent('none', 'Bitte ansehen');
  expect(
    (await request(endpoint('prepare', 'ask'), 'POST', { message: 'Bitte ansehen', files })).body
      .mode
  ).toBe('passthrough');
  intent('accept', 'Ja, bitte');
  const accepted = await request(endpoint('prepare', 'ask'), 'POST', { message: 'Ja, bitte' });
  expect(accepted.body.mode).toBe('upload');
  expect(accepted.body.files).toHaveLength(2);
  const chat = await request('/v1/chat/completions', 'POST', {
    model: 'cernion-governance-assistant',
    messages: [{ role: 'user', content: 'Ja' }],
    cet_project_bundle: { conversationId: 'ask' },
  });
  expect(chat.status).toBe(200);
  expect(chat.body.choices[0].message.content).toContain('Projektakte');
  expect((await request(endpoint('result', 'ask'), 'GET', null, 'person-b')).status).toBe(403);
  intent('none', 'Erkläre das');
  expect(
    (
      await request(endpoint('prepare', 'small'), 'POST', {
        message: 'Erkläre das',
        files: [files[0]],
      })
    ).body.mode
  ).toBe('passthrough');
  intent('none', 'Ansehen');
  await request(endpoint('prepare', 'decline'), 'POST', { message: 'Ansehen', files });
  intent('decline', 'Nein');
  expect(
    (await request(endpoint('prepare', 'decline'), 'POST', { message: 'Nein' })).body.mode
  ).toBe('declined');
});

test('raw original upload resumes confirmed chunks, preserves CSV values, excludes duplicate context, and names unsupported objects', async () => {
  const bytes = Buffer.from('Key,Amount\na,11\nb,23\n');
  const batch = [{ ...files[0], size: bytes.length }, files[1]];
  const message = 'Lege eine Projektakte Alpha an';
  intent('create', message, 'Alpha');
  const plan = await request(endpoint('prepare'), 'POST', { message, files: batch });
  expect(plan.status).toBe(200);
  const { projectId } = plan.body;
  const upload = async (sourceId, content) => {
    const started = await request(endpoint('start'), 'POST', { sourceId, hash: hash(content) });
    expect(started.status).toBe(200);
    for (const index of started.body.missing) {
      const block = content.subarray(
        index * started.body.chunkSize,
        (index + 1) * started.body.chunkSize
      );
      expect(
        (
          await request(
            endpoint(`uploads/${started.body.uploadId}/chunks/${index}?hash=${hash(block)}`),
            'PUT',
            block
          )
        ).status
      ).toBe(200);
    }
    expect(
      (await request(endpoint(`uploads/${started.body.uploadId}/complete`), 'POST', {})).status
    ).toBe(200);
    await wait(started.body.uploadId);
    return started.body;
  };
  await upload('file-a', bytes);
  await upload('file-b', Buffer.from('x'));
  const result = await request(endpoint('result'));
  expect(result.body.done).toBe(true);
  expect(result.body.reply).toContain('unknown.bin');
  const catalog = await app.call(
    'datapoint.datasetCatalog',
    { operation: 'list' },
    auth('person-a', ['ROLE_GRID_OPERATOR'], 'public')
  );
  const record = catalog.find((r) => r.provenance.projectId === projectId);
  const answer = await app.call(
    'dataset.query',
    { id: record.id, question: 'Summe Amount' },
    auth('person-a', ['ROLE_GRID_OPERATOR'], 'public')
  );
  expect(answer.result).toEqual([{ sum_Amount: 34 }]);
  const envelope = {
    conversationId: 'chat-a',
    documents: [
      { id: 'file-a', text: 'extracted', name: 'values.csv' },
      { text: 'different', name: 'values.csv' },
    ],
  };
  const meta = auth('person-a', ['ROLE_GRID_OPERATOR'], 'public');
  await excludeProjectContext(
    app.workbench,
    { call: (name, params, options) => app.broker.call(name, params, options) },
    envelope,
    meta
  );
  expect(envelope.documents).toEqual([{ text: 'different', name: 'values.csv' }]);
  // Add a large object; leave one confirmed chunk, retry prepare/start and send only missing.
  const large = Buffer.alloc(70000, 97);
  const nextFiles = [{ id: 'large', name: 'large.bin', size: large.length, hash: hash(large) }];
  intent('append', 'Füge zur Akte Alpha hinzu', 'Alpha');
  expect(
    (
      await request(endpoint('prepare'), 'POST', {
        message: 'Füge zur Akte Alpha hinzu',
        files: nextFiles,
      })
    ).body.projectId
  ).toBe(projectId);
  const first = (await request(endpoint('start'), 'POST', { sourceId: 'large', hash: hash(large) }))
    .body;
  const block = large.subarray(0, first.chunkSize);
  expect(
    (
      await request(
        endpoint(`uploads/${first.uploadId}/chunks/0?hash=${hash(block)}`),
        'PUT',
        block
      )
    ).status
  ).toBe(200);
  const tail = large.subarray(first.chunkSize);
  // Network loss mid-chunk must leave that chunk missing, never a partial final file.
  const http = require('node:http');
  await new Promise((resolve) => {
    const req = http.request(
      base + endpoint(`uploads/${first.uploadId}/chunks/1?hash=${hash(tail)}`),
      {
        method: 'PUT',
        headers: {
          Authorization: 'Bearer ' + gateway.token,
          'X-OpenWebUI-User-Id': 'person-a',
          'Content-Type': 'application/octet-stream',
          'Content-Length': tail.length,
        },
      }
    );
    req.on('error', resolve);
    req.write(tail.subarray(0, 10));
    setTimeout(() => req.destroy(), 30);
  });
  intent('none', 'Weiter');
  const reattached = [{ ...nextFiles[0], id: 'large-new' }];
  expect(
    (await request(endpoint('prepare'), 'POST', { message: 'Weiter', files: reattached })).body
      .projectId
  ).toBe(projectId);
  const resumed = (
    await request(endpoint('start'), 'POST', { sourceId: 'large-new', hash: hash(large) })
  ).body;
  expect(resumed.uploadId).toBe(first.uploadId);
  expect(resumed.missing).toEqual([1]);
  expect(
    (await request(endpoint(`uploads/${first.uploadId}/chunks/1?hash=${hash(tail)}`), 'PUT', tail))
      .status
  ).toBe(200);
  expect((await request(endpoint(`uploads/${first.uploadId}/complete`), 'POST', {})).status).toBe(
    200
  );
  await wait(first.uploadId);
  const status = await request(endpoint(`uploads/${first.uploadId}`));
  expect(status.body.status).toBe('received');
  expect(
    (await request(endpoint(`uploads/${first.uploadId}`), 'GET', null, 'person-b')).status
  ).toBe(403);
  expect(
    (await request(endpoint(`uploads/${first.uploadId}`), 'GET', null, 'person-a', foreign.token))
      .status
  ).toBe(403);
  expect(
    (await request(endpoint('prepare'), 'POST', { message, files: batch }, 'missing')).status
  ).toBe(403);
  expect(
    (
      await request(endpoint('prepare'), 'POST', {
        message,
        files: batch,
        openWebuiOrgId: 'foreign',
      })
    ).status
  ).toBe(403);
  expect((await request('/api/project-file/', 'POST', { title: 'blocked' })).status).toBe(403);
});

async function wait(uploadId) {
  for (let n = 0; n < 200; n++) {
    const state = (await request(endpoint(`uploads/${uploadId}`))).body;
    if (state.ingestState === 'failed') throw new Error('Synthetic ingest failed');
    if (state.ingestState === 'complete') return;
    await new Promise((resolve) => setTimeout(resolve, 10));
  }
  throw new Error('Ingest timeout');
}

test('rejected archive stays named and project deletion cleans bridge receipts', async () => {
  const bytes = Buffer.from('invalid archive');
  const message = 'Lege eine Projektakte Zeta an';
  intent('create', message, 'Zeta');
  const plan = await request(endpoint('prepare', 'bad-archive'), 'POST', {
    message,
    files: [{ id: 'archive', name: 'invalid.zip', size: bytes.length, hash: hash(bytes) }],
  });
  const started = await request(endpoint('start', 'bad-archive'), 'POST', {
    sourceId: 'archive',
    hash: hash(bytes),
  });
  expect(started.status).toBe(200);
  const uploadId = started.body.uploadId;
  expect(
    (
      await request(
        endpoint(`uploads/${uploadId}/chunks/0?hash=${hash(bytes)}`, 'bad-archive'),
        'PUT',
        bytes
      )
    ).status
  ).toBe(200);
  await request(endpoint(`uploads/${uploadId}/complete`, 'bad-archive'), 'POST', {});
  let result;
  for (let attempt = 0; attempt < 100; attempt++) {
    result = await request(endpoint('result', 'bad-archive'));
    if (result.body.done) break;
    await new Promise((resolve) => setTimeout(resolve, 10));
  }
  expect(result.body.objects[0]).toMatchObject({ status: 'failed', ingestState: 'failed' });
  expect(result.body.reply).toContain('invalid.zip');
  expect(result.body.reply).toContain('Archive prüfen');
  const meta = auth('person-a', ['ROLE_GRID_OPERATOR'], 'public');
  await expect(
    app.call(
      'project-bundle.deleteProject',
      { projectId: plan.body.projectId, tenantId: 'public', version: 1 },
      meta
    )
  ).rejects.toMatchObject({ code: 403 });
  await app.call('project-file.delete', { projectId: plan.body.projectId }, meta);
  expect(
    await app.call('project-bundle.receipts', { conversationId: 'bad-archive' }, meta)
  ).toEqual([]);
  expect((await request(endpoint('result', 'bad-archive'))).status).toBe(403);
});
