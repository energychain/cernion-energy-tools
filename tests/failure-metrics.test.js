'use strict';

jest.mock('../src/llm-client', () => ({
  generateStructured: jest.fn(async () => ({
    level: 'B',
    levelReason: 'Teamgedächtnis ergänzen',
    summary: 'Antwort zurückgewiesen',
    hypothesis: 'Angabe des Hauses unbekannt',
    expected: 'belegte Antwort',
  })),
}));
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { ServiceBroker } = require('moleculer');
const { checkTurn } = require('../scripts/practice-evaluation-checks');

describe('self-improvement metrics (#1010 step 8)', () => {
  let broker, dir;
  const meta = (roles = ['ROLE_EDM'], tenantId = 'synthetic-a') => ({
    authUser: { tenantId, userId: 'person-a', roles },
  });
  const service = () => broker.getLocalService('failure-signals');
  const outcome = (extra = {}) => ({
    unanswered: false,
    timeouts: [],
    openQuestions: 0,
    functionIds: [],
    ...extra,
  });
  beforeEach(async () => {
    dir = fs.mkdtempSync(path.join(os.tmpdir(), 'failure-metrics-'));
    broker = new ServiceBroker({ logger: false });
    const schema = require('../services/failure-signals.service');
    broker.createService({ ...schema, settings: { ...schema.settings, dbPath: dir } });
    await broker.start();
  });
  afterEach(async () => {
    await broker.stop();
    fs.rmSync(dir, { recursive: true, force: true });
  });

  test('counts cases per level and status and the share fixed without code', async () => {
    for (const conversationId of ['chat-1', 'chat-2'])
      await service().observeTurn({
        tenantId: 'synthetic-a',
        conversationId,
        turnRef: 't',
        outcome: outcome({ disagreement: true }),
      });
    await service().idle();
    const [first] = await broker.call(
      'failure-signals.cases',
      {},
      { meta: meta(['ROLE_TENANT_ADMIN']) }
    );
    // One rejection kind with the same key bundles into one case; a second key gives a second.
    await service().record({
      tenantId: 'synthetic-a',
      kind: 'skill_degraded',
      sources: [{ source: 'projectSkill', name: 'skill-1' }],
    });
    await service().idle();
    await broker.call('failure-signals.setCaseStatus', {
      tenantId: 'synthetic-a',
      caseId: first.caseId,
      status: 'resolved_runtime',
    });
    const metrics = await broker.call('failure-signals.metrics', {}, { meta: meta() });
    expect(metrics).toMatchObject({
      signals: 3,
      cases: 2,
      byLevel: { B: 2 },
      levelShare: { B: 1, C: 0 },
      byStatus: { open: 1, resolved_runtime: 1 },
      fixedWithoutCode: 1,
      fixedWithoutCodeShare: 1,
      netRemovedGates: null,
      netRemovedRegex: null,
    });
    // Counts only: no case content in the metrics.
    expect(JSON.stringify(metrics)).not.toContain('zurückgewiesen');
    // Tenant separation.
    expect(
      (
        await broker.call(
          'failure-signals.metrics',
          {},
          { meta: meta(['ROLE_EDM'], 'synthetic-b') }
        )
      ).cases
    ).toBe(0);
  });

  test('the read actions are exposed as REST routes; internal ones are not', () => {
    const schema = require('../services/failure-signals.service');
    expect(
      Object.fromEntries(
        Object.entries(schema.actions)
          .filter(([, action]) => action.rest)
          .map(([name, action]) => [name, action.rest])
      )
    ).toEqual({
      list: 'GET /signals',
      summary: 'GET /summary',
      cases: 'GET /cases',
      metrics: 'GET /metrics',
    });
    expect(schema.actions.setCaseStatus.visibility).toBe('protected');
    expect(schema.actions.record.visibility).toBe('protected');
  });
});

describe('practice rule: a correction becomes a failure case', () => {
  const turn = {
    expect: {
      description: 'x',
      rules: { failureCase: { kind: 'user_correction', levels: ['B', 'C'] } },
    },
  };
  const failed = (reply) =>
    checkTurn(turn, { responseText: 'Fehlerregister gelesen.', ...reply })
      .filter((check) => !check.passed)
      .map((check) => check.id);

  test('passes with a classified case and reproduction', () => {
    expect(
      failed({
        failureCases: [
          {
            kind: 'user_correction',
            level: 'B',
            reproduction: { observed: 'user_correction (1×)', expected: 'belegte Antwort' },
          },
        ],
      })
    ).toEqual([]);
  });

  test('fails without a case, with a wrong level or without reproduction', () => {
    expect(failed({ failureCases: [] })).toEqual([
      'failure-case',
      'failure-case-level',
      'failure-case-reproduction',
    ]);
    expect(
      failed({
        failureCases: [
          { kind: 'user_correction', level: 'D', reproduction: { observed: 'o', expected: 'e' } },
        ],
      })
    ).toEqual(['failure-case-level']);
    expect(
      failed({
        failureCases: [{ kind: 'user_correction', level: 'B', reproduction: { observed: 'o' } }],
      })
    ).toEqual(['failure-case-reproduction']);
  });
});
