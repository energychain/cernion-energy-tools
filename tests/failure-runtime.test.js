'use strict';

jest.mock('../src/llm-client', () => ({
  generateStructured: jest.fn(async () => ({
    level: 'A',
    levelReason: 'Check neu entwerfen',
    summary: 'Ein gelernter Check liefert falsche Werte',
    hypothesis: 'Aktenstand geändert',
    expected: 'Check liefert die Werte der aktuellen Akte',
  })),
}));
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { ServiceBroker } = require('moleculer');
const { getFunctionModel } = require('../src/function-model');

describe('level A at runtime (#1010 step 3)', () => {
  let broker, dir, journal;
  const meta = {
    authUser: { tenantId: 'synthetic-a', userId: 'person-a', roles: ['ROLE_TENANT_ADMIN'] },
  };
  const lifecycle = (params) => broker.emit('project.skill.lifecycle.v1', params, { meta });
  const settle = async () => {
    await new Promise((resolve) => setTimeout(resolve, 30));
    await broker.getLocalService('failure-signals').idle();
  };
  const cases = () => broker.call('failure-signals.cases', {}, { meta });

  beforeEach(async () => {
    dir = fs.mkdtempSync(path.join(os.tmpdir(), 'failure-runtime-'));
    journal = [];
    broker = new ServiceBroker({ logger: false });
    const schema = require('../services/failure-signals.service');
    broker.createService({ ...schema, settings: { ...schema.settings, dbPath: dir } });
    broker.createService({
      name: 'journal',
      actions: {
        append(ctx) {
          journal.push({ params: ctx.params, tenantId: ctx.meta.authUser?.tenantId });
          return ctx.params;
        },
      },
    });
    await broker.start();
  });
  afterEach(async () => {
    await broker.stop();
    fs.rmSync(dir, { recursive: true, force: true });
  });

  test('a redesigned and validated skill resolves the case; the journal names the provenance', async () => {
    await lifecycle({
      tenantId: 'synthetic-a',
      projectId: 'project-1',
      skillId: 'skill-old',
      lifecycle: 'degraded',
      reason: 'user_reported_incorrect',
    });
    await settle();
    expect((await cases())[0]).toMatchObject({ status: 'open', level: 'A' });
    // An unrelated activation does not touch the case.
    await lifecycle({
      tenantId: 'synthetic-a',
      projectId: 'project-1',
      skillId: 'skill-other',
      lifecycle: 'active',
      derivedFrom: [],
    });
    await settle();
    expect((await cases())[0].status).toBe('open');
    await lifecycle({
      tenantId: 'synthetic-a',
      projectId: 'project-1',
      skillId: 'skill-new',
      lifecycle: 'active',
      reason: 'automatic_validation_passed',
      derivedFrom: ['skill-old'],
    });
    await settle();
    const [item] = await cases();
    expect(item).toMatchObject({
      status: 'resolved_runtime',
      refs: { skillId: 'skill-new' },
      runtime: {
        level: 'A',
        action: 'skill_redesigned',
        replay: { kind: 'skill_validation', passed: true },
      },
    });
    expect(journal).toHaveLength(1);
    const learning = getFunctionModel().functions.find((fn) =>
      fn.capabilities?.includes('project_skill_learning')
    ).functionId;
    expect(journal[0]).toMatchObject({
      tenantId: 'synthetic-a',
      params: {
        functionId: learning,
        kind: 'decided',
        refs: [
          { kind: 'failureCase', id: item.caseId },
          { kind: 'projectSkill', id: 'skill-new', projectId: 'project-1' },
        ],
      },
    });
    // No pull request, no issue: the fix happened at runtime.
    expect(item.refs.pr).toBeUndefined();
    expect(item.refs.issue).toBeUndefined();
  });

  test('a retired skill resolves its case once, even when the retirement is reported twice', async () => {
    const retired = {
      tenantId: 'synthetic-a',
      projectId: 'project-1',
      skillId: 'skill-x',
      lifecycle: 'retired',
      reason: 'user_retired',
    };
    await lifecycle(retired);
    await settle();
    await lifecycle(retired);
    await settle();
    const list = await cases();
    expect(list).toHaveLength(1);
    expect(list[0]).toMatchObject({
      status: 'resolved_runtime',
      count: 1,
      runtime: { action: 'skill_retired' },
    });
    expect(journal).toHaveLength(1);
  });
});

test('journal references to failure cases are visible only inside their tenant', async () => {
  const schema = require('../services/shared-service-journal.service');
  const self = {
    broker: {
      getLocalService: (name) =>
        name === 'failure-signals'
          ? {
              caseDocs: async (tenantId) =>
                tenantId === 'synthetic-a' ? [{ caseId: 'case-1' }] : [],
            }
          : null,
    },
  };
  const visible = (tenantId, id) =>
    schema.methods.referenceVisible.call(self, {}, { tenantId }, { kind: 'failureCase', id });
  expect(await visible('synthetic-a', 'case-1')).toBe(true);
  expect(await visible('synthetic-b', 'case-1')).toBe(false);
  expect(await visible('synthetic-a', 'case-2')).toBe(false);
});
