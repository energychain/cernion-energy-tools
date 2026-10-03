'use strict';

const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { ServiceBroker } = require('moleculer');
const journalSchema = require('../services/shared-service-journal.service');
const activationSchema = require('../services/function-activation.service');

test('real lifecycle mixins preserve journal, archived digest and event retry identity across restart', async () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'journal-persistence-'));
  const model = { sourceHash: 'fixture-v1', functions: [{ functionId: 'fn-a', neighbors: [] }] };
  const meta = { authUser: { tenantId: 'tenant-a', userId: 'actor-a', roles: ['ROLE_USER'] } };
  let now = Date.UTC(2026, 0, 1);
  const activationEvent = {
    tenantId: 'tenant-a',
    functionId: 'fn-a',
    state: 'active',
    responsibility: { humans: [], cet: false },
  };
  const make = () => {
    const broker = new ServiceBroker({ logger: false, transporter: null });
    broker.createService({
      ...activationSchema,
      settings: {
        ...activationSchema.settings,
        model,
        clock: () => now,
        dbPath: path.join(root, 'activation'),
        sweepIntervalMs: 0,
      },
    });
    const journal = broker.createService({
      ...journalSchema,
      settings: {
        ...journalSchema.settings,
        functionModel: model,
        clock: () => now,
        dbPath: path.join(root, 'journal'),
        retentionMs: 0,
      },
    });
    return { broker, journal };
  };
  let { broker, journal } = make();
  try {
    await broker.start();
    await broker.emit('function.touched.v1', {
      tenantId: 'tenant-a',
      actorId: 'actor-a',
      functionId: 'fn-a',
      conversationId: 'conversation-a',
      confidence: 1,
      at: new Date(now).toISOString(),
    });
    await broker.call(
      'journal.append',
      { entryId: 'entry-a', functionId: 'fn-a', kind: 'awaiting', summary: 'Antwort steht aus.' },
      { meta }
    );
    const before = await broker.call('journal.digest', { functionId: 'fn-a' }, { meta });
    now++;
    await journal.serializeWrite(() => journal.compactEntries());
    await broker.stop();
    ({ broker, journal } = make());
    await broker.start();
    await broker.emit('function.activation.changed.v1', activationEvent);
    expect(await broker.call('journal.digest', { functionId: 'fn-a' }, { meta })).toEqual(before);
    await expect(
      broker.call(
        'journal.append',
        { entryId: 'entry-a', functionId: 'fn-a', kind: 'observed', summary: 'Neue Beobachtung.' },
        { meta }
      )
    ).rejects.toMatchObject({ code: 409 });
  } finally {
    await broker.stop();
    fs.rmSync(root, { recursive: true, force: true });
  }
});
