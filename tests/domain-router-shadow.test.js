'use strict';
const fs = require('fs');
const os = require('os');
const path = require('path');
const { ServiceBroker } = require('moleculer');
const Router = require('../services/domain-router.service');
const shadow = require('../src/domain-router-shadow-mixin');
const jobStore = require('../src/job-store');
const meta = {
  tenantId: 'shadow-tenant',
  apiToken: {
    tenantId: 'shadow-tenant',
    userId: 'actor',
    scope: 'read-only',
    roles: ['ROLE_GRID_OPERATOR'],
  },
};

describe('Personal Agent shadow hooks use real router and outbox', () => {
  let broker, service, dir, jobs, seen;
  beforeEach(async () => {
    dir = fs.mkdtempSync(path.join(os.tmpdir(), 'cet-dr-shadow-'));
    jobs = [];
    seen = [];
    broker = new ServiceBroker({ logger: false });
    service = broker.createService({
      ...Router,
      settings: {
        ...Router.settings,
        dbPath: path.join(dir, 'state'),
        eventsDbPath: path.join(dir, 'events'),
      },
    });
    broker.createService({ name: 'capability-broker', actions: { recommend: () => ({}) } });
    broker.createService({ name: 'agent-receipts', actions: { select: () => ({}) } });
    broker.createService({
      name: 'personal-agent',
      mixins: [shadow],
      actions: {
        askCernionAgent(ctx) {
          seen.push(ctx.meta.domainRouterShadow);
          return { shortAnswer: 'unchanged' };
        },
        answerDossier(ctx) {
          seen.push(ctx.meta.domainRouterShadow);
          return { dossierId: 'dossier-1', dossierMarkdown: 'unchanged' };
        },
        chat(ctx) {
          seen.push(ctx.meta.domainRouterShadow);
          const jobId = jobStore.createJob({
            service: 'personal-agent',
            action: 'chat',
            tenantId: 'shadow-tenant',
          });
          jobs.push(jobId);
          return { jobId, status: 'queued' };
        },
      },
    });
    await broker.start();
  });
  afterEach(async () => {
    await broker.stop();
    for (const id of jobs) jobStore.deleteJob(id);
    fs.rmSync(dir, { recursive: true, force: true });
  });
  const envelope = {
    asyncDelivery: { mode: 'poll', clientId: 'shadow-client' },
    disableKnowledgeRouting: true,
  };
  test('legacy calls retain shape and do not create state', async () => {
    expect(
      await broker.call('personal-agent.askCernionAgent', { question: 'Redispatch' }, { meta })
    ).toEqual({ shortAnswer: 'unchanged' });
    expect(seen).toEqual([undefined]);
    expect((await service.db.allDocs()).rows).toEqual([]);
  });
  test('opt-in classify runs before selection and dossier completion feeds outbox', async () => {
    const result = await broker.call(
      'personal-agent.answerDossier',
      { question: 'MSCONS Lastgang', taskEnvelope: envelope },
      { meta }
    );
    expect(result).toEqual({ dossierId: 'dossier-1', dossierMarkdown: 'unchanged' });
    expect(seen[0].transition.type).toBe('clarify');
    const poll = await broker.call(
      'domain-router.events.list',
      { clientId: 'shadow-client' },
      { meta }
    );
    expect(poll.events.map((e) => e.eventType)).toEqual(
      expect.arrayContaining(['clarification.required', 'async.message.ready'])
    );
  });
  test('completed existing async job actively feeds outbox after the turn returns', async () => {
    const result = await broker.call(
      'personal-agent.chat',
      { message: 'Redispatch', taskEnvelope: envelope },
      { meta }
    );
    expect((await service.eventsDb.allDocs()).rows).toEqual([]);
    jobStore.saveResult(result.jobId, { answer: 'late answer' });
    await service.sweepJobs();
    expect(
      (await service.eventsDb.allDocs({ include_docs: true })).rows.map((r) => r.doc.eventType)
    ).toContain('async.message.ready');
    const state = (await service.db.allDocs({ include_docs: true })).rows[0].doc;
    expect(state.pendingJobs).toEqual([]);
    await service.sweepJobs();
    expect((await service.eventsDb.allDocs()).rows).toHaveLength(1);
  });
});
