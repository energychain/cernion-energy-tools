'use strict';

const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { ServiceBroker } = require('moleculer');
const Notices = require('../services/shared-service-notices.service');
const quota = require('../src/rate-quota-store');
let broker, directory, env;
const meta = (roles = ['ROLE_TENANT_ADMIN']) => ({
  apiToken: {
    id: 'synthetic-admin',
    tenantId: 'synthetic',
    roles,
    scope: 'agentos-session',
    sensitivityFlags: [],
  },
});
beforeEach(async () => {
  env = { ...process.env };
  directory = fs.mkdtempSync(path.join(os.tmpdir(), 'cet-quota-notices-'));
  process.env.RATE_QUOTA_DIR = path.join(directory, 'quotas');
  process.env.RATE_QUOTA_DRIVER = 'file';
  process.env.RESET_LLM_TOKENS_PER_DAY_ON_RESTART = 'false';
  quota.resetForTests();
  const state = quota.getTenantState('synthetic');
  state.config.quotas.llm_tokens_per_day = 1000;
  quota.saveTenantState('synthetic', state);
  broker = new ServiceBroker({ logger: false, transporter: null });
  broker.createService({
    ...Notices,
    settings: { ...Notices.settings, dbPath: path.join(directory, 'notices') },
  });
  await broker.start();
});
afterEach(async () => {
  await broker.stop();
  fs.rmSync(directory, { recursive: true, force: true });
  for (const key of Object.keys(process.env)) if (!(key in env)) delete process.env[key];
  Object.assign(process.env, env);
  quota.resetForTests();
});
test('80 percent threshold yields one admin notice per day and no notice to ordinary users', async () => {
  const params = { tenantId: 'synthetic', actorId: 'synthetic-admin' };
  quota.recordLlmUsage({
    tenantId: 'synthetic',
    usage: { promptTokens: 799, completionTokens: 0 },
  });
  expect((await broker.call('notices.enqueueQuota', params, { meta: meta() })).queued).toBe(false);
  quota.recordLlmUsage({ tenantId: 'synthetic', usage: { promptTokens: 1, completionTokens: 0 } });
  expect(
    quota.listTenantEvents('synthetic').events.filter((event) => event.threshold === '80')
  ).toHaveLength(1);
  await expect(
    broker.call('notices.enqueueQuota', params, { meta: meta(['ROLE_USER']) })
  ).rejects.toMatchObject({ code: 403 });
  expect((await broker.call('notices.enqueueQuota', params, { meta: meta() })).queued).toBe(true);
  const first = await broker.call(
    'notices.completeTurn',
    { ...params, turnRef: 'one' },
    { meta: meta() }
  );
  expect(first.block).toContain('80 %');
  expect(first.block).toContain('800 von 1.000');
  expect((await broker.call('notices.enqueueQuota', params, { meta: meta() })).queued).toBe(false);
  expect(
    (await broker.call('notices.completeTurn', { ...params, turnRef: 'two' }, { meta: meta() }))
      .block
  ).toBe('');
});
