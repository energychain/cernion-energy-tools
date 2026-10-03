'use strict';

const { ServiceBroker } = require('moleculer');
const { createJournalDb } = require('./journal-db');

async function createAdapter({ functions, jest: testClock }) {
  const schema = require('../../../services/shared-service-journal.service');
  const broker = new ServiceBroker({ logger: false, transporter: null, internalServices: false });
  // Preserve the actual lifecycle mixin; replace only the owned DB construction hook.
  const service = broker.createService({
    ...schema,
    mixins: schema.mixins.map((mixin) => ({
      ...mixin,
      created() {
        this.db = createJournalDb();
      },
    })),
    settings: { ...schema.settings, functionModel: { functions } },
  });
  await broker.start();
  return {
    broker,
    service,
    async apply(step) {
      if (step.type === 'advance') {
        await testClock.advanceTimersByTimeAsync(step.milliseconds);
      } else if (
        step.event === 'shared-service.correction.v1' ||
        step.event === 'function.activation.changed.v1' ||
        step.event === 'shared-agent.lifecycle.v1'
      ) {
        await broker.emit(step.event, step.payload);
        await service.writeQueue;
      }
      // Other services' inputs are intentionally unimplemented until their issues land.
    },
    async snapshot() {
      return { functions, now: Date.now(), journal: await service.readEntries('tenant-a') };
    },
    async close() {
      // Moleculer stop uses nextTick and timeouts, which must run during fake-clock teardown.
      const stopping = broker.stop();
      await testClock.advanceTimersByTimeAsync(1000);
      await stopping;
    },
  };
}

module.exports = { createAdapter };
