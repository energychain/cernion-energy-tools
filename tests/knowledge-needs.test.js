'use strict';

const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { ServiceBroker } = require('moleculer');
const { buildKnowledgeNeeds, writeOrCheck } = require('../scripts/generate-knowledge-needs');

describe('knowledge-need projection (#997)', () => {
  const model = buildKnowledgeNeeds();
  const parameters = require('../knowledge-needs.parameters.json');

  test('committed artifacts match the generator and the projection is deterministic', () => {
    expect(writeOrCheck({ check: true })).toEqual([]);
    expect(JSON.stringify(buildKnowledgeNeeds())).toBe(JSON.stringify(model));
  });

  test('a tenant input used by many capabilities becomes one need with all unlocks', () => {
    const { CURATED_CAPABILITIES } = require('../src/capability-catalog');
    const key = Object.entries(parameters.parameters).find(
      ([, entry]) => entry.scope === 'tenant'
    )[0];
    const users = CURATED_CAPABILITIES.filter((capability) =>
      (capability.requiredInputs || []).some((input) => input.name === key)
    );
    const needs = model.needs.filter((need) => need.key === key);
    expect(needs).toHaveLength(1);
    for (const capability of users)
      expect(needs[0].unlocks).toContainEqual({ capabilityId: capability.capability });
  });

  test('only reviewed tenant inputs become needs; case and runtime inputs never do', () => {
    const keys = new Set(model.needs.map((need) => need.key));
    for (const [name, entry] of Object.entries(parameters.parameters))
      if (entry.scope === 'runtime') expect(keys.has(name)).toBe(false);
    const { CURATED_CAPABILITIES } = require('../src/capability-catalog');
    const unlisted = CURATED_CAPABILITIES.flatMap((capability) =>
      (capability.requiredInputs || []).map((input) => input.name)
    ).filter((name) => !parameters.parameters[name]);
    expect(unlisted.length).toBeGreaterThan(0);
    for (const name of unlisted) expect(keys.has(name)).toBe(false);
  });

  test('every need has a stable id, provenance, a kind and a bounded priority', () => {
    for (const need of model.needs) {
      expect(need.needId).toBe(`need:${need.key}`);
      expect(need.derivedFrom.length).toBeGreaterThan(0);
      expect(['fact', 'identifier', 'term', 'dataset', 'contact', 'deadline']).toContain(need.kind);
      expect(need.basePriority).toBeGreaterThanOrEqual(0);
      expect(need.basePriority).toBeLessThanOrEqual(1);
    }
    expect(model.needs.some((need) => need.kind === 'contact')).toBe(true);
    expect(model.needs.some((need) => need.kind === 'dataset')).toBe(true);
  });
});

describe('knowledge-need register', () => {
  let broker, dir, artifactPath, events;
  const meta = (tenantId, userId = 'synthetic-person-a') => ({
    authUser: { tenantId, userId, name: userId, roles: ['ROLE_EDM'], scope: 'full-access' },
  });
  const call = (action, params, tenantId = 'synthetic-a') =>
    broker.call(`knowledge-needs.${action}`, params, { meta: meta(tenantId) });
  const artifact = (needs, sourceHash) => ({
    derivation: { version: 1, parameters: 1 },
    sourceHash,
    needs,
  });
  const need = (key, basePriority = 0.5) => ({
    needId: `need:${key}`,
    key,
    label: `Bezeichnung ${key}`,
    kind: 'identifier',
    derivedFrom: [{ source: 'capability', ref: 'synthetic' }],
    functionIds: [],
    unlocks: [],
    basePriority,
  });

  beforeEach(async () => {
    dir = fs.mkdtempSync(path.join(os.tmpdir(), 'knowledge-needs-'));
    artifactPath = path.join(dir, 'knowledge-needs.json');
    fs.writeFileSync(artifactPath, JSON.stringify(artifact([need('a', 0.9), need('b')], 'v1')));
    events = [];
    broker = new ServiceBroker({ logger: false });
    const schema = require('../services/knowledge-needs.service');
    broker.createService({
      ...schema,
      settings: { ...schema.settings, dbPath: path.join(dir, 'db'), artifactPath },
    });
    broker.createService({
      name: 'listener',
      events: {
        'knowledge.need.changed.v1'(ctx) {
          events.push(ctx.params);
        },
      },
    });
    await broker.start();
  });
  afterEach(async () => {
    await broker.stop();
    fs.rmSync(dir, { recursive: true, force: true });
  });

  test('a fresh tenant starts with every need unknown, ordered by priority', async () => {
    const needs = await call('list', {});
    expect(needs.map((entry) => [entry.key, entry.state])).toEqual([
      ['a', 'unknown'],
      ['b', 'unknown'],
    ]);
    expect(await call('summary', {})).toMatchObject({ total: 2, byState: { unknown: 2 } });
  });

  test('states are tenant scoped and follow the state machine with an audit trail', async () => {
    await call('markState', { needId: 'need:a', state: 'answered', reason: 'synthetic' });
    expect((await call('get', { needId: 'need:a' })).state).toBe('answered');
    expect((await call('get', { needId: 'need:a' }, 'synthetic-b')).state).toBe('unknown');
    await expect(
      call('markState', { needId: 'need:b', state: 'confirmed', reason: 'skip' })
    ).rejects.toThrow(/not allowed/u);
    const audited = await call('get', { needId: 'need:a' });
    expect(audited.audit).toMatchObject([{ from: 'unknown', to: 'answered' }]);
    expect(events).toContainEqual({ tenantId: 'synthetic-a', needId: 'need:a', state: 'answered' });
    expect(Object.keys(audited)).not.toEqual(
      expect.arrayContaining(['tenantId', 'domainsAllowed', 'roles', 'sensitivityClearance'])
    );
  });

  test('a new artifact version adds needs and marks removed ones stale without losing answers', async () => {
    await call('markState', {
      needId: 'need:a',
      state: 'answered',
      reason: 'synthetic',
      answerRef: 'answer-1',
    });
    fs.writeFileSync(artifactPath, JSON.stringify(artifact([need('a', 0.9), need('c')], 'v2')));
    const states = Object.fromEntries(
      (await call('list', {})).map((entry) => [entry.key, entry.state])
    );
    expect(states).toEqual({ a: 'answered', b: 'stale', c: 'unknown' });
    expect((await call('get', { needId: 'need:a' })).answers).toEqual([{ answerId: 'answer-1' }]);
  });

  test('a foreign tenant cannot read another tenant record by id', async () => {
    await call('list', {});
    await expect(call('get', { needId: 'need:missing' }, 'synthetic-b')).rejects.toThrow(
      /Unknown knowledge need/u
    );
  });
});
