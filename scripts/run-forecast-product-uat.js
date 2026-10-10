#!/usr/bin/env node
'use strict';
// Real isolated REST gateway and Python worker; test-only identity provider, no PM2 changes.
const fs = require('fs');
const path = require('path');
const os = require('os');
const assert = require('assert/strict');
const output = path.resolve(
  process.argv[2] || fs.mkdtempSync(path.join(os.tmpdir(), 'forecast-product-http-'))
);
fs.mkdirSync(output, { recursive: true });
process.env.RATE_QUOTA_DRIVER = 'file';
process.env.RATE_QUOTA_DIR = path.join(output, 'quotas');
process.env.JOB_STORE_DIR = path.join(output, 'jobs');
process.env.FORECAST_PORTFOLIO_RUNTIME_PATH = path.join(output, 'runtime');
process.env.FORECAST_PORTFOLIO_DATA_PATH = path.join(output, 'datasets');
process.env.TRACING_ENABLED = 'false';
const { ServiceBroker } = require('moleculer');
const gateway = require('../services/api.service');
const broker = new ServiceBroker({ logger: false, transporter: null, requestTimeout: 180000 });
const api = broker.createService({
  ...gateway,
  settings: { ...gateway.settings, port: 0, ip: '127.0.0.1' },
});
broker.createService({
  name: 'token-manager',
  actions: {
    verify: {
      handler(ctx) {
        const id = { ck_test_alice: 'alice', ck_test_bob: 'bob' }[ctx.params.token];
        return { valid: !!id, tenantId: id, scope: 'full-access', scopes: ['admin'], tokenId: id };
      },
    },
  },
});
broker.createService(require('../services/forecast-sandbox.service'));
broker.createService(require('../services/job-status.service'));
const prefix = '/api/forecast-sandbox/consumption/portfolio';
const checks = [];
let base;
async function call(tenant, route, payload, statuses = [200, 202], extra = {}) {
  const response = await fetch(base + route, {
    method: payload === undefined ? 'GET' : 'POST',
    headers: {
      'Content-Type': 'application/json',
      ...(tenant ? { Authorization: 'Bearer ck_test_' + tenant } : {}),
      ...extra,
    },
    body: payload === undefined ? undefined : JSON.stringify(payload),
  });
  const data = await response.json();
  assert.ok(statuses.includes(response.status), JSON.stringify(data));
  return data;
}
async function finish(tenant, job) {
  if (job.status === 'completed') return job;
  for (let i = 0; i < 180; i++) {
    const state = await call(tenant, '/api/jobs/' + job.jobId + '/status');
    if (state.status === 'error') throw new Error(state.error);
    if (state.status === 'completed') {
      const saved = await call(tenant, prefix + '/runs/' + job.run_id);
      assert.equal(saved.status, 'completed');
      return saved.result;
    }
    await new Promise((resolve) => setTimeout(resolve, 1000));
  }
  throw new Error('Timeout');
}
function pass(name) {
  checks.push(name);
  process.stdout.write('PASS ' + name + '\n');
}
(async () => {
  try {
    await broker.start();
    base = 'http://127.0.0.1:' + api.server.address().port;
    await new Promise((resolve) => setTimeout(resolve, 1500));
    const dataset = {
      series_id: 'meter-1',
      unit: 'kWh',
      timezone: 'UTC',
      value_semantics: 'interval_energy',
      profile_label: 'office',
      profile_available_at: '2026-07-01T00:00:00Z',
      values: Array.from({ length: 40 * 96 }, (_, i) => ({
        timestamp: new Date(Date.parse('2026-07-01T00:00:00Z') + i * 900000).toISOString(),
        value: 1 + (i % 96 >= 32 && i % 96 < 72 ? 2 : 0),
        reactive_power_kvar: 0.3,
      })),
    };
    await call(null, prefix + '/history', { dataset, historical_import: true }, [401], {
      'x-tenant-id': 'alice',
    });
    pass('Header-only tenant cannot write meter history');
    let aliceJob, alice;
    for (const tenant of ['alice', 'bob']) {
      await call(tenant, prefix + '/history', { dataset, historical_import: true });
      const job = await call(tenant, prefix + '/train', {
        series_ids: ['meter-1'],
        strategy: 'shared_baseline',
        forecast_for: '2026-08-12',
      });
      const trained = await finish(tenant, job);
      assert.equal(trained.model.reference_meter_count, tenant === 'alice' ? 0 : 1);
      assert.deepEqual(Object.keys(trained.model.identities), ['meter-1']);
      const inspected = await call(tenant, prefix + '/models/' + trained.model_version);
      assert.equal(inspected.baseline_version, trained.model.baseline_version);
      const prediction = await finish(
        tenant,
        await call(tenant, prefix + '/predict', {
          series_id: 'meter-1',
          model_version: trained.model_version,
          forecast_for: '2026-08-12',
        })
      );
      assert.equal(prediction.forecast_values.length, 96);
      assert.ok(prediction.daily_energy_kwh > 0);
      assert.ok(!JSON.stringify(trained).includes('reference_snapshots'));
      if (tenant === 'alice') {
        alice = trained;
        aliceJob = job;
      }
    }
    pass(
      'Initial single-meter train, second tenant uses shared evidence, both receive private forecasts'
    );
    await call(
      'bob',
      prefix + '/predict',
      { series_id: 'meter-1', model_version: alice.model_version, forecast_for: '2026-08-12' },
      [400]
    );
    await call('bob', prefix + '/models/' + alice.model_version, undefined, [400]);
    await call('bob', prefix + '/runs/' + aliceJob.run_id, undefined, [400]);
    for (const suffix of ['status', 'progress', 'result'])
      await call('bob', '/api/jobs/' + aliceJob.jobId + '/' + suffix, undefined, [404]);
    await call(null, '/api/jobs/' + aliceJob.jobId + '/result', undefined, [404], {
      'x-tenant-id': 'alice',
    });
    pass(
      'Foreign model/run IDs and all job read endpoints reject the other tenant and unbound credentials'
    );
    const retrained = await finish(
      'alice',
      await call('alice', prefix + '/retrain', {
        model_version: alice.model_version,
        forecast_for: '2026-08-13',
      })
    );
    assert.equal(retrained.model.strategy, 'shared_baseline');
    assert.equal(retrained.model.reference_meter_count, 1);
    assert.notEqual(retrained.model_version, alice.model_version);
    assert.equal(
      (await call('alice', prefix + '/models/' + alice.model_version)).baseline_version,
      alice.model.baseline_version
    );
    pass('Retrain includes new evidence and keeps previous private model version available');
    fs.writeFileSync(
      path.join(output, 'report.json'),
      JSON.stringify({ status: 'passed', checks }, null, 2)
    );
  } finally {
    await broker.stop();
  }
})().catch((error) => {
  process.stderr.write(error.stack + '\n');
  process.exitCode = 1;
});
