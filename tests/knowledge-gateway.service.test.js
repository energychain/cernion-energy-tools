'use strict';

// Knowledge Gateway MVP (#CernionWebUI B5): tenant isolation, ACL, lifecycle and citations with
// two synthetic tenants. Embeddings are a deterministic bag of words.
const VOCABULARY = ['zähler', 'frist', 'abrechnung', 'netz', 'störung', 'wartung', 'messung'];
jest.mock('../src/llm-client', () => ({
  embeddings: jest.fn(async (texts) =>
    texts.map((text) => {
      const words = String(text).toLowerCase();
      const vector = VOCABULARY.map((word) => (words.includes(word) ? 1 : 0));
      return vector.some(Boolean) ? vector : [...vector.slice(0, -1), 0.01];
    })
  ),
}));

const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { ServiceBroker } = require('moleculer');
const llm = require('../src/llm-client');
const { isKnowledgeGatewayRequest } = require('../src/gateway-request-classifiers');

let broker, dir;
const person = (actorId, tenantId = 'tenant-a', extra = {}) => ({
  authUser: {
    userId: actorId,
    tenantId,
    roles: extra.roles || ['ROLE_USER'],
    groups: extra.groups || [],
    sensitivityFlags: extra.clearance || [],
  },
});
const ANNA = person('anna');
const BEN = person('ben', 'tenant-a', { roles: ['ROLE_NETZ'], groups: ['team-netz'] });
const CARLA = person('carla');
const FOREIGN = person('anna', 'tenant-b');

const call = (action, params, meta) => broker.call(`knowledge-gateway.${action}`, params, { meta });
const text = (content) => Buffer.from(content, 'utf8').toString('base64');
const upload = (meta, knowledgeBaseId, name, content, extra = {}) =>
  call(
    'documents.add',
    { knowledgeBaseId, name, mimeType: 'text/markdown', contentBase64: text(content), ...extra },
    meta
  );
const settle = () =>
  Promise.all([...broker.getLocalService('knowledge-gateway').ingestJobs.values()]);
const code = (promise) => promise.then(() => 200).catch((error) => error.code);

beforeEach(async () => {
  dir = fs.mkdtempSync(path.join(os.tmpdir(), 'cet-kg-'));
  broker = new ServiceBroker({ logger: false, transporter: null });
  broker.createService({
    ...require('../services/object-store.service'),
    settings: { dbPath: path.join(dir, 'objects') },
  });
  broker.createService(require('../services/files.service'));
  const Gateway = require('../services/knowledge-gateway.service');
  broker.createService({
    ...Gateway,
    settings: { ...Gateway.settings, dbPath: path.join(dir, 'kg') },
  });
  await broker.start();
  llm.embeddings.mockClear();
});

afterEach(async () => {
  await broker.stop();
  fs.rmSync(dir, { recursive: true, force: true });
});

const MANUAL =
  '# Zählerwechsel\n\nDie Frist für den Zählerwechsel beträgt zehn Werktage.\n\n# Störung\n\nEine Störung im Netz wird sofort gemeldet.';

test('tenant B can neither list, search, read nor delete tenant A resources (404, no fallback)', async () => {
  const kb = await call(
    'bases.create',
    { name: 'Betriebswissen', visibility: 'tenant', defaultForChat: true },
    ANNA
  );
  const doc = await upload(ANNA, kb.knowledgeBaseId, 'handbuch.md', MANUAL);
  await settle();
  expect(kb).not.toHaveProperty('tenantId');
  expect((await call('bases.list', {}, FOREIGN)).knowledgeBases).toEqual([]);
  expect(await code(call('bases.get', { knowledgeBaseId: kb.knowledgeBaseId }, FOREIGN))).toBe(404);
  expect(
    await code(
      call(
        'documents.get',
        { knowledgeBaseId: kb.knowledgeBaseId, documentId: doc.documentId },
        FOREIGN
      )
    )
  ).toBe(404);
  expect(
    await code(
      call(
        'documents.remove',
        { knowledgeBaseId: kb.knowledgeBaseId, documentId: doc.documentId },
        FOREIGN
      )
    )
  ).toBe(404);
  expect(
    await code(
      call(
        'search',
        { question: 'Frist Zählerwechsel', knowledgeBaseIds: [kb.knowledgeBaseId] },
        FOREIGN
      )
    )
  ).toBe(404);
  // Without a selection, tenant B searches only its own defaults: nothing, and no other source.
  expect((await call('search', { question: 'Frist Zählerwechsel' }, FOREIGN)).results).toEqual([]);
  // Invented and malformed IDs fail closed alike.
  expect(
    await code(call('bases.get', { knowledgeBaseId: 'kb_000000000000000000000000' }, ANNA))
  ).toBe(404);
  expect(await code(call('bases.get', { knowledgeBaseId: 'cernion_knowledge_v1' }, ANNA))).toBe(
    404
  );
  // A body tenant is never authoritative.
  expect(await code(call('bases.list', { tenantId: 'tenant-b' }, ANNA))).toBe(403);
});

test('private, tenant and restricted visibility for owner, actor, role and group', async () => {
  const privateKb = await call('bases.create', { name: 'Privat' }, ANNA);
  const tenantKb = await call('bases.create', { name: 'Alle', visibility: 'tenant' }, ANNA);
  const byActor = await call(
    'bases.create',
    { name: 'Carla', visibility: 'restricted', acl: { actorIds: ['carla'] } },
    ANNA
  );
  const byRole = await call(
    'bases.create',
    { name: 'Netzrolle', visibility: 'restricted', acl: { roles: ['role_netz'] } },
    ANNA
  );
  const byGroup = await call(
    'bases.create',
    { name: 'Netzteam', visibility: 'restricted', acl: { groups: ['team-netz'] } },
    ANNA
  );
  const names = async (meta) =>
    (await call('bases.list', {}, meta)).knowledgeBases.map((kb) => kb.name).sort();
  expect(await names(ANNA)).toEqual(['Alle', 'Carla', 'Netzrolle', 'Netzteam', 'Privat']);
  expect(await names(BEN)).toEqual(['Alle', 'Netzrolle', 'Netzteam']);
  expect(await names(CARLA)).toEqual(['Alle', 'Carla']);
  expect(byRole.acl.roles).toEqual(['ROLE_NETZ']);
  expect(await code(call('bases.get', { knowledgeBaseId: privateKb.knowledgeBaseId }, BEN))).toBe(
    404
  );
  // Only the owner manages; a reader gets the same 404 as a stranger.
  expect(
    await code(call('bases.update', { knowledgeBaseId: tenantKb.knowledgeBaseId, name: 'X' }, BEN))
  ).toBe(404);
  expect(await code(upload(BEN, tenantKb.knowledgeBaseId, 'a.md', 'Netz'))).toBe(404);
  expect(byActor.ownerActorId).toBe('anna');
  expect(byGroup.visibility).toBe('restricted');
});

test('search without selection uses released defaults; results carry stable citations; resolve re-checks access', async () => {
  const kb = await call(
    'bases.create',
    {
      name: 'Betriebswissen',
      visibility: 'restricted',
      acl: { actorIds: ['ben'] },
      defaultForChat: true,
    },
    ANNA
  );
  const other = await call('bases.create', { name: 'Kein Default', visibility: 'tenant' }, ANNA);
  const doc = await upload(ANNA, kb.knowledgeBaseId, 'handbuch.md', MANUAL, {
    source: { externalId: 'handbuch', version: 'v1' },
  });
  await upload(
    ANNA,
    other.knowledgeBaseId,
    'andere.md',
    'Die Frist für den Zählerwechsel ist anders geregelt.'
  );
  await settle();
  expect(
    (
      await call(
        'documents.get',
        { knowledgeBaseId: kb.knowledgeBaseId, documentId: doc.documentId },
        ANNA
      )
    ).status
  ).toBe('ready');
  const first = await call('search', { question: 'Welche Frist gilt beim Zählerwechsel?' }, BEN);
  expect(first.queryId).toMatch(/^kq_/);
  expect(first.results.length).toBeGreaterThan(0);
  const [hit] = first.results;
  expect(hit).toMatchObject({
    knowledgeBaseId: kb.knowledgeBaseId,
    documentId: doc.documentId,
    title: 'handbuch.md',
    location: { chunkIndex: 0, section: 'Zählerwechsel' },
    source: { type: 'upload', name: 'handbuch.md', version: 'v1' },
  });
  expect(hit.citationId).toMatch(/^cit_[a-f0-9]{32}$/);
  expect(hit.chunkId).toMatch(/^chk_/);
  expect(hit.source.sha256).toMatch(/^sha256:[a-f0-9]{64}$/);
  expect(first.results.every((result) => result.knowledgeBaseId === kb.knowledgeBaseId)).toBe(true);
  const serialized = JSON.stringify(first);
  for (const leak of ['embedding', 'tenant-a', 'tenantId', 'cernion_knowledge_v1', 'chunk:'])
    expect(serialized).not.toContain(leak);
  const again = await call('search', { question: 'Welche Frist gilt beim Zählerwechsel?' }, BEN);
  expect(again.results[0].citationId).toBe(hit.citationId);
  expect((await call('citations.get', { citationId: hit.citationId }, BEN)).content).toBe(
    hit.content
  );
  // Revoking access makes the earlier citation unusable.
  await call('bases.update', { knowledgeBaseId: kb.knowledgeBaseId, acl: { actorIds: [] } }, ANNA);
  expect(await code(call('citations.get', { citationId: hit.citationId }, BEN))).toBe(404);
  expect(await code(call('citations.get', { citationId: hit.citationId }, FOREIGN))).toBe(404);
  expect((await call('search', { question: 'Frist Zählerwechsel' }, BEN)).results).toEqual([]);
});

test('idempotent re-ingest, hash conflict, replace and reindex leave no stale chunks', async () => {
  const kb = await call('bases.create', { name: 'Wissen', visibility: 'tenant' }, ANNA);
  const source = { externalId: 'richtlinie', version: 'v1' };
  const first = await upload(ANNA, kb.knowledgeBaseId, 'r.md', MANUAL, { source });
  await settle();
  const embeddedOnce = llm.embeddings.mock.calls.length;
  const repeat = await upload(ANNA, kb.knowledgeBaseId, 'r.md', MANUAL, { source });
  expect(repeat).toMatchObject({ documentId: first.documentId, duplicate: true });
  expect(llm.embeddings.mock.calls.length).toBe(embeddedOnce);
  expect(
    await code(upload(ANNA, kb.knowledgeBaseId, 'r.md', 'Anderer Inhalt zur Wartung.', { source }))
  ).toBe(409);
  // A new version with fewer chunks replaces the old one completely.
  const replaced = await upload(ANNA, kb.knowledgeBaseId, 'r.md', 'Nur noch Wartung.', {
    source: { ...source, version: 'v2' },
  });
  expect(replaced.documentId).toBe(first.documentId);
  await settle();
  const service = broker.getLocalService('knowledge-gateway');
  const chunks = async () =>
    (await service.db.allDocs({ startkey: 'chunk:', endkey: 'chunk:￰' })).rows.length;
  expect(await chunks()).toBe(1);
  const doc = await call(
    'documents.get',
    { knowledgeBaseId: kb.knowledgeBaseId, documentId: first.documentId },
    ANNA
  );
  expect(doc).toMatchObject({ status: 'ready', chunkCount: 1, source: { version: 'v2' } });
  expect(
    (
      await call(
        'search',
        { question: 'Frist Zählerwechsel', knowledgeBaseIds: [kb.knowledgeBaseId] },
        ANNA
      )
    ).results
  ).toEqual([]);
  await call(
    'documents.reindex',
    { knowledgeBaseId: kb.knowledgeBaseId, documentId: first.documentId },
    ANNA
  );
  await settle();
  expect(await chunks()).toBe(1);
  expect(
    (await call('search', { question: 'Wartung', knowledgeBaseIds: [kb.knowledgeBaseId] }, ANNA))
      .results
  ).toHaveLength(1);
});

test('deleting a document or base removes it from search at once and every chunk afterwards', async () => {
  const kb = await call(
    'bases.create',
    { name: 'Wissen', visibility: 'tenant', defaultForChat: true },
    ANNA
  );
  const long = Array.from(
    { length: 40 },
    (_, i) => `# Abschnitt ${i}\n\nMessung und Wartung ${i}.`
  ).join('\n\n');
  const doc = await upload(ANNA, kb.knowledgeBaseId, 'lang.md', long);
  await settle();
  const { results } = await call('search', { question: 'Messung Wartung', topK: 3 }, ANNA);
  expect(results).toHaveLength(3);
  await call(
    'documents.remove',
    { knowledgeBaseId: kb.knowledgeBaseId, documentId: doc.documentId },
    ANNA
  );
  const service = broker.getLocalService('knowledge-gateway');
  expect((await service.db.allDocs({ startkey: 'chunk:', endkey: 'chunk:￰' })).rows).toEqual([]);
  expect((await call('search', { question: 'Messung Wartung' }, ANNA)).results).toEqual([]);
  expect(await code(call('citations.get', { citationId: results[0].citationId }, ANNA))).toBe(404);
  expect(
    (await call('documents.list', { knowledgeBaseId: kb.knowledgeBaseId }, ANNA)).documents
  ).toEqual([]);
  await upload(ANNA, kb.knowledgeBaseId, 'b.md', 'Wartung im Netz.');
  await settle();
  await call('bases.remove', { knowledgeBaseId: kb.knowledgeBaseId }, ANNA);
  expect((await service.db.allDocs({ startkey: 'chunk:', endkey: 'chunk:￰' })).rows).toEqual([]);
  expect(await code(call('bases.get', { knowledgeBaseId: kb.knowledgeBaseId }, ANNA))).toBe(404);
});

test('uploads with a forbidden type, oversize, unknown file reference or missing clearance are refused before ingestion', async () => {
  const kb = await call('bases.create', { name: 'Wissen' }, ANNA);
  expect(await code(upload(ANNA, kb.knowledgeBaseId, 'tool.exe', 'MZ'))).toBe(422);
  const previous = process.env.CET_FILE_MAX_BYTES;
  process.env.CET_FILE_MAX_BYTES = '10';
  try {
    expect(
      await code(upload(ANNA, kb.knowledgeBaseId, 'gross.md', 'Wartung im Netz und mehr'))
    ).toBe(413);
  } finally {
    if (previous === undefined) delete process.env.CET_FILE_MAX_BYTES;
    else process.env.CET_FILE_MAX_BYTES = previous;
  }
  expect(
    await code(
      call('documents.add', { knowledgeBaseId: kb.knowledgeBaseId, fileId: 'a'.repeat(64) }, ANNA)
    )
  ).toBe(404);
  expect(
    await code(
      upload(ANNA, kb.knowledgeBaseId, 'geheim.md', 'Wartung', { sensitivityLevel: 'restricted' })
    )
  ).toBe(403);
  expect(llm.embeddings).not.toHaveBeenCalled();
  // A file reference of another tenant is not resolvable (the file id is the content hash).
  const foreignKb = await call('bases.create', { name: 'B' }, FOREIGN);
  await upload(FOREIGN, foreignKb.knowledgeBaseId, 'b.md', 'Wartung im Netz.');
  await settle();
  const fileId = require('node:crypto')
    .createHash('sha256')
    .update('Wartung im Netz.')
    .digest('hex');
  expect(
    await code(call('documents.add', { knowledgeBaseId: kb.knowledgeBaseId, fileId }, ANNA))
  ).toBe(404);
  expect(
    await code(
      call('documents.add', { knowledgeBaseId: foreignKb.knowledgeBaseId, fileId }, FOREIGN)
    )
  ).toBe(200);
});

test('gateway tokens reach only the read side; the tool document names cernion_knowledge_search', async () => {
  expect(isKnowledgeGatewayRequest('POST', '/api/workbench/knowledge/search')).toBe(true);
  expect(isKnowledgeGatewayRequest('GET', '/api/workbench/knowledge/openapi.json')).toBe(true);
  expect(
    isKnowledgeGatewayRequest('GET', `/api/workbench/knowledge/citations/cit_${'a'.repeat(32)}`)
  ).toBe(true);
  expect(isKnowledgeGatewayRequest('POST', '/api/workbench/knowledge-bases')).toBe(false);
  expect(isKnowledgeGatewayRequest('DELETE', '/api/workbench/knowledge-bases/kb_1')).toBe(false);
  const gateway = {
    apiToken: { type: 'gateway', client: 'open-webui', tenantId: 'tenant-a', externalOrgId: 'org' },
  };
  expect(await code(call('bases.create', { name: 'X' }, gateway))).toBe(404);
  const document = await call('toolOpenApi', {}, ANNA);
  expect(document.paths['/api/workbench/knowledge/search'].post.operationId).toBe(
    'cernion_knowledge_search'
  );
  expect(JSON.stringify(document)).not.toMatch(/tenantId|token/i);
});
