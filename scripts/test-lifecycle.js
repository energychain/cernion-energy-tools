#!/usr/bin/env node
'use strict';

// A standalone process isolates cwd, environment and process-lifetime stores from Jest.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { performance } = require('node:perf_hooks');
const { ServiceBroker } = require('moleculer');

const servicesDirectory = path.resolve(__dirname, '../services');
const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'cernion-all-services-lifecycle-'));
process.chdir(directory);
process.env.NODE_ENV = 'test';
// Never load local credentials or contact an LLM during this lifecycle smoke test.
for (const key of Object.keys(process.env)) {
  if (/(API_KEY|TOKEN|DB_PATH|_DIR)$/.test(key)) delete process.env[key];
}
process.env.CERNION_TOKEN = 'test_token_placeholder';
const broker = new ServiceBroker({
  logger: false,
  transporter: null,
  registry: { stopDelay: 0 },
  dependencyInterval: 100,
  dependencyTimeout: 10000,
});
const stopFailures = [];
broker.localBus.on('$broker.error', (event) => {
  if (event.type === 'FAILED_STOPPING_SERVICES') stopFailures.push(event.error);
});

async function main() {
  const startedAt = performance.now();
  const files = fs
    .readdirSync(servicesDirectory)
    .filter((name) => name.endsWith('.service.js'))
    .filter((name) => !['mqtt-broker.service.js', 'api.service.js'].includes(name));
  try {
    for (const filename of files) broker.loadService(path.join(servicesDirectory, filename));
    // Observe every real stop hook as well: broker.stop() can swallow hook errors.
    for (const service of broker.services) {
      const originalStop = service._stop;
      service._stop = async function () {
        try {
          return await originalStop.call(this);
        } catch (error) {
          stopFailures.push(new Error(`${this.fullName}: ${error.message}`, { cause: error }));
          throw error;
        }
      };
    }
    await broker.start();
    assert.equal(
      broker.services.filter((service) => service.name !== '$node').length,
      files.length
    );
    await broker.stop();
    assert.equal(stopFailures.length, 0, stopFailures.map((error) => error.message).join('\n'));
    assert.equal(broker.started, false);
    console.log(
      `Lifecycle PASS: ${files.length} services started and stopped in ${((performance.now() - startedAt) / 1000).toFixed(2)} s`
    );
  } finally {
    if (broker.started) await broker.stop();
    // Some services intentionally keep shared stores open for process lifetime.
    process.chdir(os.tmpdir());
    fs.rmSync(directory, { recursive: true, force: true });
  }
}

const timeout = setTimeout(() => {
  console.error('Lifecycle FAIL: exceeded 120 s');
  process.exit(1);
}, 120000);
main().then(
  () => {
    clearTimeout(timeout);
    process.exit(0);
  },
  (error) => {
    clearTimeout(timeout);
    console.error(error);
    process.exit(1);
  }
);
