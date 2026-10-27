'use strict';

const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { ServiceBroker } = require('moleculer');
const Store = require('../services/object-store.service');
const Project = require('../services/project-file.service');
const { auth } = require('./helpers/case-linking-broker');
const { DecisionEvidenceAuditTrail } = require('../src/decision-evidence-audit-trail');
const { checkExecuteReadPolicy } = require('../src/mcp-execute-read-policy');
const { deletionEligibilities: policyValues } = require('../src/project-file-policy');

let dir, broker, store, project, call;
const sensitive = () =>
  auth('actor-a', ['ROLE_ALPHA'], 'tenant-a', ['restricted', 'highly_sensitive']);

function boot(cleanupActions = []) {
  broker = new ServiceBroker({ logger: false, transporter: null });
  store = broker.createService({ ...Store, settings: { dbPath: path.join(dir, 'objects') } });
  project = broker.createService({ ...Project, settings: { cleanupActions } });
  call = (name, params = {}, meta = auth()) =>
    broker.call(`project-file.${name}`, params, { meta: structuredClone(meta) });
}
beforeEach(async () => {
  dir = fs.mkdtempSync(path.join(os.tmpdir(), 'cet-project-883-'));
  boot();
  await broker.start();
});
afterEach(async () => {
  jest.restoreAllMocks();
  await broker.stop();
  fs.rmSync(dir, { recursive: true, force: true });
});

test('AC-01 CRUD and lifecycle events isolate every action and preserve archived data', async () => {
  const emit = jest.spyOn(broker, 'emit');
  const created = await call('create', { title: 'Synthetic project' });
  const { projectId } = created;
  expect(created).toMatchObject({
    tenantId: 'tenant-a',
    lifecycle: 'ready',
    requiredClearance: [],
    createdBy: 'actor-a',
    stats: { files: 0, bytes: 0, datasets: 0, nodes: 0, edges: 0 },
  });
  expect(created).not.toHaveProperty('components');
  expect(created).not.toHaveProperty('_rev');
  expect(await call('get', { projectId })).toEqual(created);
  expect(await call('list')).toHaveLength(1);
  for (const [action, params] of [
    ['get', {}],
    ['update', { title: 'Foreign' }],
    ['archive', {}],
    ['delete', {}],
    ['setLifecycle', { lifecycle: 'degraded' }],
    ['recomputeClearance', {}],
    [
      'registerComponent',
      { componentId: 'foreign', sensitivityLevel: 'public', cleanupAction: 'synthetic.cleanup' },
    ],
  ])
    await expect(
      call(action, { projectId, ...params }, auth('actor-b', ['ROLE_ALPHA'], 'tenant-b'))
    ).rejects.toMatchObject({ code: 404 });
  expect(await call('list', {}, auth('actor-b', ['ROLE_ALPHA'], 'tenant-b'))).toEqual([]);
  await call('update', { projectId, title: 'Renamed' });
  for (const lifecycle of ['ingesting', 'degraded', 'ready']) {
    expect(await call('setLifecycle', { projectId, lifecycle })).toMatchObject({ lifecycle });
    expect(emit).toHaveBeenCalledWith('project.lifecycle.v1', {
      tenantId: 'tenant-a',
      projectId,
      lifecycle,
    });
  }
  await call('archive', { projectId });
  const before = emit.mock.calls.length;
  await call('archive', { projectId });
  expect(emit.mock.calls).toHaveLength(before);
  expect(await call('list', { routingOnly: true })).toEqual([]);
  expect(await call('get', { projectId })).toMatchObject({
    title: 'Renamed',
    lifecycle: 'archived',
  });
  await expect(call('update', { projectId, title: 'No' })).rejects.toMatchObject({ code: 409 });
  await expect(call('setLifecycle', { projectId, lifecycle: 'ready' })).rejects.toMatchObject({
    code: 409,
  });
  expect(await call('delete', { projectId })).toEqual({ projectId, deleted: true });
  expect(emit).toHaveBeenCalledWith('project.deleting.v1', {
    version: 1,
    tenantId: 'tenant-a',
    projectId,
  });
  expect(await call('list')).toEqual([]);
  await expect(call('get', { projectId })).rejects.toMatchObject({ code: 404 });
});

test('AC-03 component registration raises clearance, updates stats idempotently and hides all projections', async () => {
  const { projectId } = await call('create', {
    title: 'Synthetic',
    projectRefs: [{ caseId: 'case-a' }],
  });
  const register = (componentId, sensitivityLevel, stats, meta = sensitive()) =>
    call(
      'registerComponent',
      { projectId, componentId, sensitivityLevel, stats, cleanupAction: 'synthetic.cleanup' },
      meta
    );
  await expect(register('private', 'restricted', {}, auth())).rejects.toMatchObject({ code: 403 });
  await register('original', 'tenant_internal', { files: 1, bytes: 30 });
  expect(await register('table', 'restricted', { datasets: 2 })).toMatchObject({
    requiredClearance: ['tenant_internal', 'restricted'],
    stats: { files: 1, bytes: 30, datasets: 2 },
  });
  expect(await register('table', 'highly_sensitive', { datasets: 1 })).toMatchObject({
    requiredClearance: ['tenant_internal', 'highly_sensitive'],
    stats: { datasets: 1 },
  });
  await register('another', 'restricted', { nodes: 4, edges: 3 });
  expect(await register('__proto__', 'restricted', { files: 1 })).toMatchObject({
    stats: { files: 2 },
  });
  await expect(call('get', { projectId })).rejects.toMatchObject({ code: 404 });
  expect(await call('list')).toEqual([]);
  expect(await call('forReference', { caseId: 'case-a' })).toEqual([]);
  expect(await call('get', { projectId }, sensitive())).toMatchObject({
    requiredClearance: ['tenant_internal', 'restricted', 'highly_sensitive'],
    stats: { nodes: 4, edges: 3 },
  });
  expect(await call('recomputeClearance', { projectId }, sensitive())).toMatchObject({
    stats: { datasets: 1, files: 2 },
  });
  await expect(register('invalid', 'public', { files: -1 })).rejects.toMatchObject({ code: 422 });
  await expect(register('invalid', 'public', { arbitrary: 1 })).rejects.toMatchObject({
    code: 422,
  });
});

test('projectRefs support many projects per case/conversation and optional members', async () => {
  const a = await call('create', {
    title: 'A',
    projectRefs: [{ caseId: 'case-a', conversationId: 'chat-a' }],
  });
  const b = await call('create', {
    title: 'B',
    members: ['actor-a'],
    projectRefs: [{ caseId: 'case-a' }, { conversationId: 'chat-b' }],
  });
  expect(await call('forReference', { caseId: 'case-a' })).toHaveLength(2);
  expect(await call('forReference', { conversationId: 'chat-a' })).toEqual([a]);
  expect(await call('forReference', { caseId: 'case-a', conversationId: 'chat-a' })).toEqual([a]);
  expect(await call('forReference', { caseId: 'case-a' }, auth('actor-b'))).toEqual([a]);
  await expect(call('get', { projectId: b.projectId }, auth('actor-b'))).rejects.toMatchObject({
    code: 404,
  });
  await call('update', {
    projectId: b.projectId,
    members: [],
    projectRefs: [{ conversationId: 'chat-c' }],
  });
  expect(await call('forReference', { conversationId: 'chat-c' }, auth('actor-b'))).toHaveLength(1);
  await expect(call('forReference')).rejects.toMatchObject({ code: 422 });
  await expect(call('create', { title: 'Invalid', projectRefs: [{}] })).rejects.toMatchObject({
    code: 422,
  });
  await expect(call('create', { title: 'Invisible', members: ['actor-b'] })).rejects.toMatchObject({
    code: 403,
  });
});

test('AC-04 acknowledged cascade removes every derived store and retains verifiable audit; failure survives restart and retries', async () => {
  await broker.stop();
  boot();
  const kinds = ['originals', 'tables', 'nodes', 'edges', 'manifest', 'skills'];
  const counts = Object.fromEntries(kinds.map((kind) => [kind, 3]));
  let fail = true;
  broker.createService({
    name: 'synthetic',
    actions: Object.fromEntries(
      kinds.map((kind) => [
        kind,
        {
          handler(ctx) {
            expect(ctx.params).toMatchObject({ version: 1, tenantId: 'tenant-a' });
            if (kind === 'skills' && fail) throw new Error('Synthetic cleanup failure');
            counts[kind] = 0;
            return { deleted: true };
          },
        },
      ])
    ),
  });
  await broker.start();
  const { projectId } = await call('create', { title: 'Cascade' });
  for (const kind of kinds)
    await call('registerComponent', {
      projectId,
      componentId: kind,
      sensitivityLevel: 'public',
      stats: kind === 'originals' ? { files: 3 } : {},
      cleanupAction: `synthetic.${kind}`,
    });
  expect(Object.values(counts).reduce((a, b) => a + b, 0)).toBe(18);
  await expect(call('delete', { projectId })).rejects.toMatchObject({
    type: 'PROJECT_DELETE_INCOMPLETE',
    code: 503,
  });
  expect(await call('get', { projectId })).toMatchObject({
    deletion: { status: 'incomplete', failedHandlers: ['synthetic.skills'] },
  });
  expect(await call('list', { routingOnly: true })).toEqual([]);
  await expect(call('update', { projectId, title: 'Blocked' })).rejects.toMatchObject({
    code: 409,
  });
  await broker.stop();
  boot();
  broker.createService({
    name: 'synthetic',
    actions: Object.fromEntries(
      kinds.map((kind) => [
        kind,
        () => {
          counts[kind] = 0;
          return { deleted: true };
        },
      ])
    ),
  });
  await broker.start();
  expect(await call('get', { projectId })).toMatchObject({ deletion: { status: 'incomplete' } });
  fail = false;
  expect(await call('delete', { projectId })).toEqual({ deleted: true, projectId });
  expect(Object.values(counts).reduce((a, b) => a + b, 0)).toBe(0);
  expect(await call('list')).toEqual([]);
  const audit = new DecisionEvidenceAuditTrail(store.db);
  const trail = await audit.getTrail({ tenantId: 'tenant-a', entityId: projectId });
  expect(trail.map((entry) => entry.decision)).toContain('project.delete.incomplete');
  expect(trail.at(-1)).toMatchObject({
    decision: 'project.delete.cleaned',
    actor: 'actor-a',
    metadata: { stats: { files: 3 } },
  });
  expect(await audit.verifyTrail({ tenantId: 'tenant-a', entityId: projectId })).toMatchObject({
    verified: true,
  });
});

test('missing cleanup acknowledgment or unavailable registered handler never silently deletes the project', async () => {
  broker.createService({ name: 'unconfirmed', actions: { cleanup: () => ({ removed: 1 }) } });
  const { projectId } = await call('create', { title: 'Unconfirmed' });
  await call('registerComponent', {
    projectId,
    componentId: 'a',
    sensitivityLevel: 'public',
    cleanupAction: 'unconfirmed.cleanup',
  });
  await call('registerComponent', {
    projectId,
    componentId: 'b',
    sensitivityLevel: 'public',
    cleanupAction: 'missing.cleanup',
  });
  await expect(call('delete', { projectId })).rejects.toMatchObject({ code: 503 });
  expect(await call('get', { projectId })).toMatchObject({
    deletion: { failedHandlers: ['unconfirmed.cleanup', 'missing.cleanup'] },
  });
});

test('audit failure blocks removal; generic store and internal adapters cannot bypass the project policy', async () => {
  const { projectId } = await call('create', { title: 'Audit boundary' });
  const append = jest.spyOn(DecisionEvidenceAuditTrail.prototype, 'appendEntry');
  append.mockImplementationOnce(async () => {
    throw new Error('Synthetic audit failure');
  });
  await expect(call('delete', { projectId })).rejects.toThrow('Synthetic audit failure');
  expect(await call('get', { projectId })).toHaveProperty('deletion.status', 'incomplete');
  await expect(
    broker.call('object-store.projectRecord', { operation: 'list' }, { meta: auth() })
  ).rejects.toMatchObject({ code: 403 });
  const generic = await broker.call('object-store.query', { namespace: 'projects' });
  expect(generic.docs).toEqual([]);
  append.mockRestore();
  expect(await call('delete', { projectId })).toMatchObject({ deleted: true });
});

test('concurrent changes serialize per project and state persists solely in existing mixin-owned DB', async () => {
  const { projectId } = await call('create', { title: 'Durable' });
  await Promise.all(
    Array.from({ length: 6 }, (_, i) =>
      call('registerComponent', {
        projectId,
        componentId: `c${i}`,
        sensitivityLevel: 'public',
        stats: { files: 1 },
        cleanupAction: 'synthetic.cleanup',
      })
    )
  );
  await broker.stop();
  boot();
  await broker.start();
  expect(await call('get', { projectId })).toMatchObject({ title: 'Durable', stats: { files: 6 } });
  expect(
    fs.readdirSync(dir).every((name) => name === 'objects' || name.startsWith('objects-mrview-'))
  ).toBe(true);
  expect(project.db).toBeUndefined();
});

test('public reads are MCP-readable; lifecycle, clearance, components and cleanup have no public route', () => {
  for (const action of ['get', 'list', 'forReference']) {
    expect(Project.actions[action].openapi['x-agentable']).toBe(true);
    expect(checkExecuteReadPolicy('GET', '/api/project-file/refs')).toEqual({ allowed: true });
  }
  for (const action of ['setLifecycle', 'registerComponent', 'recomputeClearance', 'addFile']) {
    expect(Project.actions[action].visibility).toBe('protected');
    expect(Project.actions[action].rest).toBeUndefined();
  }
});

test('#898 administration overview is a read-only, tenant/member/clearance-scoped projection without side channels', async () => {
  const visible = await call('create', {
    title: 'Visible',
    projectRefs: [{ caseId: 'case-a', conversationId: 'chat-a' }, { caseId: 'case-b' }],
  });
  await call('create', { title: 'Members', members: ['actor-a'] });
  const restricted = await call('create', { title: 'Restricted' });
  await call(
    'registerComponent',
    {
      projectId: restricted.projectId,
      componentId: 'secret-table',
      sensitivityLevel: 'restricted',
      stats: { datasets: 7, bytes: 999 },
      cleanupAction: 'secret.cleanup',
    },
    sensitive()
  );
  const archived = await call('create', { title: 'Archived' });
  await call('archive', { projectId: archived.projectId });
  await call('create', { title: 'Foreign' }, auth('actor-b', ['ROLE_ALPHA'], 'tenant-b'));

  const recordOps = jest.spyOn(project, 'record');
  const brokerCall = jest.spyOn(broker, 'call');
  const emit = jest.spyOn(broker, 'emit');
  const append = jest.spyOn(DecisionEvidenceAuditTrail.prototype, 'appendEntry');
  const writes = ['put', 'remove', 'bulkDocs'].map((name) => jest.spyOn(store.db, name));

  const overview = await call('administrationOverview', { routingOnly: true });
  expect(Object.keys(overview).sort()).toEqual(['advisory', 'projects', 'safetyClass']);
  expect(overview).toMatchObject({
    safetyClass: 'read_only_governance_projection',
    advisory: true,
  });
  const rows = Object.fromEntries(overview.projects.map((row) => [row.title, row]));
  expect(Object.keys(rows).sort()).toEqual(['Archived', 'Members', 'Visible']);
  expect(rows.Visible).toMatchObject({
    projectId: visible.projectId,
    lifecycle: 'ready',
    responsibility: {
      projection: 'legacy_responsibility_projection',
      grantsAuthority: false,
      createdBy: 'actor-a',
      members: [],
    },
    linkedCaseCount: 2,
    linkedConversationCount: 1,
    deletionState: 'none',
    deletionEligibility: 'policy_definition_required',
    nextGate: 'human_policy_design_review',
  });
  expect(rows.Members.responsibility.members).toEqual(['actor-a']);
  expect(rows.Archived).toMatchObject({
    deletionEligibility: 'policy_definition_required',
    blockers: expect.arrayContaining(['archived_retention_policy_missing']),
  });
  for (const row of overview.projects) {
    expect(policyValues).toContain(row.deletionEligibility);
    for (const value of Object.values(row))
      expect(['string', 'number', 'boolean', 'object']).toContain(typeof value);
  }
  const serialized = JSON.stringify(overview);
  expect(serialized).not.toMatch(
    /Restricted|secret|Foreign|tenant-b|"_rev"|"_id"|components|cleanupActions/
  );
  // Random identifiers and timestamps may contain the digits by chance; the hidden value may not.
  expect(
    serialized.replace(/"(?:projectId|updatedAt|createdAt|lastActivityAt)":"[^"]*"/gu, '')
  ).not.toContain('999');

  // Reads go only through the existing list path; nothing persists, audits, emits or cleans up.
  expect(recordOps.mock.calls.map(([, operation]) => operation)).toEqual(['list']);
  expect(brokerCall.mock.calls.map(([name]) => name)).toEqual([
    'project-file.administrationOverview',
    'object-store.projectRecord',
  ]);
  expect(emit).not.toHaveBeenCalled();
  expect(append).not.toHaveBeenCalled();
  for (const write of writes) expect(write).not.toHaveBeenCalled();

  const cleared = await call('administrationOverview', {}, sensitive());
  expect(cleared.projects.map((row) => row.title)).toContain('Restricted');
  expect(cleared.projects.find((row) => row.title === 'Restricted')).toMatchObject({
    requiredClearance: ['restricted'],
    stats: { datasets: 7, bytes: 999 },
  });
  const other = await call('administrationOverview', {}, auth('actor-c'));
  expect(other.projects.map((row) => row.title).sort()).toEqual(['Archived', 'Visible']);
  const foreign = await call(
    'administrationOverview',
    {},
    auth('actor-b', ['ROLE_ALPHA'], 'tenant-b')
  );
  expect(foreign.projects.map((row) => row.title)).toEqual(['Foreign']);
  await expect(
    call('administrationOverview', { tenantId: 'tenant-b' }, auth())
  ).rejects.toMatchObject({ code: 404 });
});

test('#898 overview reports incomplete cleanup as blocked and the action is read-only but not agentable', async () => {
  const { projectId } = await call('create', { title: 'Stuck' });
  await call('registerComponent', {
    projectId,
    componentId: 'a',
    sensitivityLevel: 'public',
    cleanupAction: 'missing.cleanup',
  });
  await expect(call('delete', { projectId })).rejects.toMatchObject({ code: 503 });
  const [row] = (await call('administrationOverview')).projects;
  expect(row).toMatchObject({
    deletionState: 'incomplete',
    failedCleanupCount: 1,
    deletionEligibility: 'blocked_incomplete_cleanup',
    blockers: ['cleanup_incomplete', 'responsibility_model_missing', 'legal_hold_model_missing'],
  });
  expect(JSON.stringify(row)).not.toContain('missing.cleanup');
  expect(Project.actions.administrationOverview.rest).toBe('GET /administration-overview');
  expect(Project.actions.administrationOverview.openapi['x-agentable']).toBe(false);
});
