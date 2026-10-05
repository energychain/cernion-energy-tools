'use strict';

const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { ServiceBroker } = require('moleculer');
const { model, operation, meta } = require('./helpers/shared-service/gap-adapter');
const schemas = [
  ['agents', require('../services/shared-service-agent.service')],
  ['activation', require('../services/function-activation.service')],
  ['journal', require('../services/shared-service-journal.service')],
  ['signals', require('../services/signals.service')],
  ['notices', require('../services/shared-service-notices.service')],
];

test('AC-03/04/08: real PouchDB restart retains lists, ignore and once-only used feedback', async () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'gap-persistence-'));
  let response = { status: 'needs_input', missingInputs: [{ id: 'a', label: 'Field A' }] };
  const feedback = [];
  async function make() {
    const broker = new ServiceBroker({ logger: false, transporter: null });
    const services = {};
    for (const [name, schema] of schemas)
      services[name] = broker.createService({
        ...schema,
        settings: {
          ...schema.settings,
          model,
          functionModel: () => model,
          dbPath: path.join(root, name),
          sweepIntervalMs: 0,
          operationIndex: { operations: [operation] },
          catalog: {
            version: 2,
            operations: [
              {
                ...operation,
                classification: 'contextual',
                parameterNames: ['caseId'],
                signals: [],
              },
            ],
          },
        },
      });
    broker.createService({ name: 'neutral', actions: { read: () => response } });
    broker.createService({
      name: 'domain-router',
      methods: {
        loadCase() {
          return { knownContext: {} };
        },
      },
    });
    broker.createService({
      name: 'feedback-observer',
      events: { 'shared-agent.feedback.v1': (ctx) => feedback.push(ctx.params) },
    });
    await broker.start();
    return { broker, ...services };
  }
  let instance = await make();
  const options = { meta: meta() };
  const run = async () => {
    const doc = await instance.agents.readDocument('tenant-a');
    return instance.broker.call('shared-service-agent.runCycle', {
      tenantId: 'tenant-a',
      agentId: doc.agents[0].agentId,
    });
  };
  const read = async () => (await instance.agents.readDocument('tenant-a')).agents[0];
  const deliver = (turnRef) =>
    instance.broker.call(
      'notices.completeTurn',
      { tenantId: 'tenant-a', actorId: 'person-a', turnRef },
      options
    );
  try {
    await instance.broker.emit('function.coverage.changed.v1', {
      tenantId: 'tenant-a',
      actorId: 'person-a',
      functionId: 'fn-a',
      score: 1,
      origin: 'observed',
    });
    await instance.broker.emit('function.touched.v1', {
      tenantId: 'tenant-a',
      actorId: 'person-a',
      functionId: 'fn-a',
      conversationId: 'one',
      confidence: 1,
      at: new Date().toISOString(),
    });
    await instance.activation.settle();
    await instance.agents.settle();
    await instance.journal.actions.append(
      {
        tenantId: 'tenant-a',
        functionId: 'fn-b',
        kind: 'observed',
        summary: 'Existing context.',
        refs: [{ kind: 'case', id: 'case-a' }],
      },
      options
    );
    await run();
    await deliver('first');
    const gap = (await read()).gapLists[0];
    await instance.broker.call(
      'shared-service-agent.correctGap',
      {
        tenantId: 'tenant-a',
        functionId: 'fn-b',
        gapRef: gap.ref,
        contentHash: gap.contentHash,
        kind: 'gap_ignore',
      },
      options
    );
    const before = await read();
    await instance.broker.stop();
    instance = await make();
    expect((await read()).gapLists).toEqual(before.gapLists);
    expect((await read()).stats).toEqual(before.stats);
    expect((await deliver('after-restart')).items.filter((item) => item.kind === 'gap')).toEqual(
      []
    );
    response = { status: 'needs_input', missingInputs: [{ id: 'b', label: 'Field B' }] };
    await run();
    await deliver('changed');
    response = { status: 'ready', missingInputs: [] };
    await run();
    expect((await read()).gapLists[0]).toMatchObject({ state: 'completed', used: true });
    expect(feedback.filter((event) => event.outcome === 'used')).toHaveLength(1);
    await instance.broker.stop();
    instance = await make();
    await run();
    expect(feedback.filter((event) => event.outcome === 'used')).toHaveLength(1);
    expect((await read()).gapLists[0].pendingFeedback).toBeNull();
  } finally {
    await instance.broker.stop();
    fs.rmSync(root, { recursive: true, force: true });
  }
}, 20000);
