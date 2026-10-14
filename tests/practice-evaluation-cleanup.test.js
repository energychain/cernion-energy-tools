'use strict';
jest.mock('../src/llm-client', () => ({
  generateStructured: jest.fn(),
  generateText: jest.fn(),
  generateChat: jest.fn(),
}));
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { createLiveHarness, isolatedSettings } = require('../scripts/workbench-live-harness');
const { generateMemoryAnchorFixture } = require('../scripts/generate-memory-cleanup-fixture');
const memory = require('../src/tenant-memory');

test('D.4: quota cannot prevent own-author audited deletion, and direct object-store cleanup is forbidden', async () => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'practice-cleanup-'));
  process.env.TENANT_MEMORY_RECOVERY = 'off';
  const schemas = ['object-store', 'shared-service-notices', 'tenant-memory-policy'].map((name) =>
    require(`../services/${name}.service`)
  );
  const app = createLiveHarness(
    directory,
    schemas.map((schema) => ({ ...schema, settings: isolatedSettings(schema, directory) }))
  );
  const budget = require('../scripts/live-validation-budget').installLiveBudget();
  const f = generateMemoryAnchorFixture();
  const principal = {
    tenantId: 'synthetic-practice-test',
    actorId: 'actor-a',
    roles: ['ROLE_GRID_OPERATOR'],
    clearance: [],
  };
  const meta = {
    apiToken: {
      id: principal.actorId,
      name: 'Sachbearbeitung A',
      tenantId: principal.tenantId,
      roles: principal.roles,
      scope: 'full-access',
    },
  };
  const admin = {
    apiToken: { ...meta.apiToken, roles: [...principal.roles, 'ROLE_TENANT_ADMIN'] },
  };
  const ctx = {
    broker: app.broker,
    meta,
    params: {},
    call: (name, params, options) =>
      app.broker.call(name, params, { ...options, meta: { ...meta, ...options?.meta } }),
  };
  try {
    await app.broker.start();
    const state = memory.start(app.workbench, ctx, principal, {
      situation: { turnKind: 'work', tenantMemory: { assertions: [f.second] } },
      envelope: { userRequest: f.textB, channel: 'api', conversationId: f.base },
    });
    await state.job;
    expect(state.ids).toHaveLength(1);
    budget.state.stopped = 'call_limit';
    await expect(
      app.broker.call('tenant-memory-policy.list', {}, { meta: admin })
    ).rejects.toMatchObject({ type: 'call_limit' });
    expect(() => app.cleanupCall('object-store.delete', {}, { meta: admin })).toThrow(
      'Only audited'
    );
    expect(() => app.cleanupCall('object-store.put', {}, { meta: admin })).toThrow('Only audited');
    const before = await app.cleanupCall('tenant-memory-policy.list', {}, { meta: admin });
    expect(before.statements).toHaveLength(1);
    await app.cleanupCall(
      'tenant-memory-policy.delete',
      { id: state.ids[0], reason: 'Eigene Testaussage bereinigen' },
      { meta: admin }
    );
    const after = await app.cleanupCall('tenant-memory-policy.list', {}, { meta: admin });
    expect(after.statements[0]).toMatchObject({ status: 'deleted', text: '', message: '' });
    expect(after.statements[0].audit.at(-1)).toMatchObject({
      kind: 'deleted',
      admin: true,
      actorId: principal.actorId,
    });
    budget.state.stopped = null;
    const notices = await app.broker.call(
      'notices.list',
      { tenantId: principal.tenantId, actorId: principal.actorId },
      { meta }
    );
    expect(notices.items).toEqual([]);
    expect(notices.block).toBe('');
  } finally {
    budget.state.stopped = null;
    await app.broker.stop();
    fs.rmSync(directory, { recursive: true, force: true });
  }
});
