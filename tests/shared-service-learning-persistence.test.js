'use strict';
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { ServiceBroker } = require('moleculer');
const learning = require('../services/shared-service-learning.service');
const coverage = require('../services/function-coverage.service');
const activation = require('../services/function-activation.service');
const journal = require('../services/shared-service-journal.service');

test('real PouchDB restart retains corrections, preferences and reversible graph overlays', async () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'correction-persistence-'));
  const model = {
    sourceHash: 'persistent-v1',
    parameters: { minWeight: 0.2 },
    functions: [
      { functionId: 'fn-a', capabilities: ['a'], neighbors: [{ functionId: 'fn-b', weight: 0.8 }] },
      { functionId: 'fn-b', capabilities: ['b'], neighbors: [] },
    ],
  };
  const auth = { authUser: { tenantId: 'tenant-a', id: 'person', roles: ['ROLE_ADMIN'] } };
  const make = async () => {
    const broker = new ServiceBroker({ logger: false, transporter: null });
    broker.createService({
      ...learning,
      settings: { ...learning.settings, model, dbPath: path.join(root, 'learning') },
    });
    broker.createService({
      ...coverage,
      settings: { ...coverage.settings, model, dbPath: path.join(root, 'coverage') },
    });
    broker.createService({
      ...activation,
      settings: {
        ...activation.settings,
        model,
        sweepIntervalMs: 0,
        dbPath: path.join(root, 'activation'),
      },
    });
    broker.createService({
      ...journal,
      settings: {
        ...journal.settings,
        functionModel: () => model,
        retentionIntervalMs: 0,
        dbPath: path.join(root, 'journal'),
      },
    });
    await broker.start();
    return broker;
  };
  let broker;
  try {
    broker = await make();
    const call = (name, input) => broker.call(name, input, { meta: auth });
    await broker.emit('function.touched.v1', {
      tenantId: 'tenant-a',
      actorId: 'person',
      functionId: 'fn-a',
      confidence: 1,
      conversationId: 'one',
      at: new Date().toISOString(),
    });
    const result = await call('shared-service-learning.apply', {
      target: 'neighbor',
      correction: { functionId: 'fn-a', neighborId: 'fn-b', weight: 0 },
    });
    await call('shared-service-learning.apply', {
      target: 'coverage',
      correction: { functionId: 'fn-a', score: 1 },
    });
    await call('shared-service-learning.apply', {
      target: 'activation',
      correction: { functionId: 'fn-b', cet: false },
    });
    await broker.stop();
    broker = await make();
    expect((await call('function-coverage.byActor', {})).items[0]).toMatchObject({
      origin: 'corrected',
    });
    expect(await call('shared-service-learning.list', {})).toHaveLength(3);
    expect(
      (await call('activation.get', { tenantId: 'tenant-a', functionId: 'fn-b' })).activations[0]
        .responsibility.cet
    ).toBe(false);
    await call('shared-service-learning.undo', { correctionId: result.correctionId });
    expect((await call('shared-service-learning.overrideProposals', {})).proposals).toEqual([]);
    expect(
      (await call('journal.byFunction', { functionId: 'fn-a' })).filter(
        (e) => e.kind === 'corrected'
      ).length
    ).toBeGreaterThanOrEqual(3);
  } finally {
    if (broker) await broker.stop();
    fs.rmSync(root, { recursive: true, force: true });
  }
});
