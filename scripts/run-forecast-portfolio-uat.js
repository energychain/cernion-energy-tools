#!/usr/bin/env node
'use strict';
// Real HTTP, isolated gateway, synthetic data. Does not touch the PM2 application.
const fs = require('fs');
const path = require('path');
const os = require('os');
const assert = require('assert/strict');
const { spawn } = require('child_process');
const output = path.resolve(
  process.argv[3] || fs.mkdtempSync(path.join(os.tmpdir(), 'portfolio-uat-'))
);
fs.mkdirSync(output, { recursive: true });
const pause = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
async function server() {
  process.env.RATE_QUOTA_DRIVER = 'file';
  process.env.RATE_QUOTA_DIR = path.join(output, 'quotas');
  process.env.JOB_STORE_DIR = path.join(output, 'jobs');
  process.env.FORECAST_PORTFOLIO_RUNTIME_PATH = path.join(output, 'runtime');
  process.env.FORECAST_PORTFOLIO_DATA_PATH = path.join(output, 'datasets');
  process.env.TRACING_ENABLED = 'false';
  const { ServiceBroker } = require('moleculer');
  const schema = require('../services/api.service');
  const broker = new ServiceBroker({ logger: false, transporter: null, requestTimeout: 180000 });
  const api = broker.createService({
    ...schema,
    settings: { ...schema.settings, port: 0, ip: '127.0.0.1' },
  });
  broker.createService({
    name: 'token-manager',
    actions: {
      verify: {
        handler(ctx) {
          return {
            valid: ctx.params.token === 'ck_portfolio_uat',
            tenantId: 'portfolio-uat',
            tokenId: 'uat',
            scope: 'full-access',
            scopes: ['admin'],
          };
        },
      },
    },
  });
  broker.createService(require('../services/forecast-sandbox.service'));
  broker.createService(require('../services/job-status.service'));
  await broker.start();
  fs.writeFileSync(path.join(output, 'url'), `http://127.0.0.1:${api.server.address().port}`);
  process.on('SIGTERM', async () => {
    await broker.stop();
    process.exit(0);
  });
}
async function main() {
  let child, base;
  const checks = [];
  const prefix = '/api/forecast-sandbox/consumption/portfolio';
  async function boot() {
    fs.rmSync(path.join(output, 'url'), { force: true });
    const log = fs.openSync(path.join(output, 'server.log'), 'a');
    child = spawn(process.execPath, [__filename, '--serve', output], {
      stdio: ['ignore', log, log],
    });
    fs.closeSync(log);
    for (let i = 0; i < 100; i++) {
      if (fs.existsSync(path.join(output, 'url'))) {
        base = fs.readFileSync(path.join(output, 'url'), 'utf8');
        try {
          const r = await fetch(base + '/api/forecast-sandbox/openapi.json');
          await r.arrayBuffer();
          if (r.ok) return;
        } catch {
          /* start */
        }
      }
      await pause(100);
    }
    throw new Error('Gateway did not start');
  }
  async function stop() {
    if (!child) return;
    const closed = new Promise((resolve) => child.once('exit', resolve));
    child.kill('SIGKILL');
    await closed;
    child = null;
  }
  async function call(route, payload, statuses = [200, 202]) {
    const response = await fetch(base + route, {
      method: payload === undefined ? 'GET' : 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: 'Bearer ck_portfolio_uat' },
      body: payload === undefined ? undefined : JSON.stringify(payload),
      signal: AbortSignal.timeout(60000),
    });
    const data = await response.json();
    assert.ok(statuses.includes(response.status), JSON.stringify(data));
    return data;
  }
  async function finish(job) {
    if (job.status === 'completed') return job;
    for (let i = 0; i < 1200; i++) {
      const state = await call(prefix + '/runs/' + job.run_id);
      if (state.status === 'completed') return state.result;
      const j = await call('/api/jobs/' + job.jobId + '/status');
      if (j.status === 'error') throw new Error(j.error);
      await pause(1000);
    }
    throw new Error('Job timed out');
  }
  function pass(name) {
    checks.push(name);
    process.stdout.write('PASS ' + name + '\n');
  }
  try {
    await boot();
    const begin = Date.parse('2023-05-01T00:00:00Z');
    const datasets = ['a', 'b'].map((series_id) => ({
      series_id,
      unit: 'kWh',
      timezone: 'UTC',
      period_from: '2023-05-01',
      period_until: '2024-01-05',
      values: Array.from(
        { length: (Date.parse('2024-01-06T00:00:00Z') - begin) / 900000 },
        (_, i) => ({ timestamp: new Date(begin + i * 900000).toISOString(), value: 0 })
      ),
    }));
    const ids = [];
    for (const dataset of datasets)
      ids.push((await call(prefix + '/datasets', { dataset })).dataset_id);
    const input = {
      dataset_ids: ids,
      payload_fit_confirmed: true,
      configuration: {
        ...require(
          process.argv[4]
            ? path.resolve(process.argv[4])
            : '../tools/xlsx-forecast-test/portfolio-0700.json'
        ),
        forecast_period_from: '2023-12-01',
        forecast_period_until: '2023-12-30',
      },
    };
    const job = await call(prefix + '/run', input);
    let checkpoint = false;
    for (let i = 0; i < 1200; i++) {
      const state = await call(prefix + '/runs/' + job.run_id);
      if (state.completed_blocks >= 1) {
        checkpoint = true;
        break;
      }
      await pause(1000);
    }
    assert.ok(checkpoint);
    await stop();
    await boot();
    const resumed = await call(prefix + '/runs/' + job.run_id + '/resume', {});
    assert.equal(resumed.run_id, job.run_id);
    const result = await finish(resumed);
    assert.equal(result.result_manifest.length, 2);
    const status = await call('/api/jobs/' + resumed.jobId + '/status');
    assert.ok(status.logs.some((l) => l.phase === 'checkpoint_reused'));
    for (const row of result.result_manifest) {
      const series = await call(row.url);
      assert.equal(series.forecast_values.length, 30 * 96);
      assert.equal(series.backtest.rmse, 0);
    }
    pass('SIGKILL + gateway restart resumes saved block and streams complete per-series results');
    await stop();
    await boot();
    assert.equal((await call(prefix + '/runs/' + job.run_id + '/resume', {})).status, 'completed');
    pass('Completed durable result survives restart independently of worker/job state');
    for (const dataset of datasets)
      await call(prefix + '/history', { dataset, historical_import: true });
    const trained = await finish(
      await call(prefix + '/train', {
        series_ids: ['a', 'b'],
        forecast_for: '2024-01-05',
        portfolio_method: input.configuration.portfolio_method,
      })
    );
    assert.ok(trained.model_version);
    await stop();
    await boot();
    const inspect = await call(prefix + '/models/' + trained.model_version);
    assert.deepEqual(Object.keys(inspect.identities), ['a', 'b']);
    assert.deepEqual(inspect.benchmark_contract, input.configuration.portfolio_method);
    const prediction = await finish(
      await call(prefix + '/predict', {
        series_id: 'a',
        model_version: trained.model_version,
        forecast_for: '2024-01-05',
      })
    );
    assert.equal(prediction.forecast_values.length, 96);
    assert.equal(prediction.daily_energy_kwh, 0);
    assert.equal(prediction.information_as_of, '2024-01-04T07:00:00.000Z');
    pass('Native model version reloads after server restart and serves REST prediction');
    const corrected = await call(prefix + '/history', {
      dataset: { ...datasets[0], values: [{ timestamp: '2024-01-03T00:00:00Z', value: 100 }] },
      allow_corrections: true,
    });
    assert.equal(corrected.corrections, 1);
    const historical = await finish(
      await call(prefix + '/predict', {
        series_id: 'a',
        model_version: trained.model_version,
        forecast_for: '2024-01-05',
      })
    );
    assert.deepEqual(historical.forecast_values, prediction.forecast_values);
    pass('New correction does not leak into earlier historical forecast');
    await call(
      prefix + '/predict',
      { series_id: 'absent', model_version: trained.model_version, forecast_for: '2024-01-05' },
      [400]
    );
    pass('Unknown meter fails with HTTP 400');
    const refit = await finish(
      await call(prefix + '/retrain', {
        model_version: trained.model_version,
        forecast_for: '2024-01-06',
      })
    );
    assert.notEqual(refit.model_version, trained.model_version);
    assert.deepEqual(
      (await call(prefix + '/models/' + refit.model_version)).benchmark_contract,
      inspect.benchmark_contract
    );
    assert.equal((await call(prefix + '/models/' + trained.model_version)).first_day, '2024-01-05');
    const next = await finish(
      await call(prefix + '/predict', {
        series_id: 'b',
        model_version: refit.model_version,
        forecast_for: '2024-01-06',
      })
    );
    assert.equal(next.forecast_values.length, 96);
    pass('Retraining creates a distinct version while the previous model remains available');
    fs.writeFileSync(
      path.join(output, 'report.json'),
      JSON.stringify({ status: 'passed', checks }, null, 2)
    );
  } finally {
    await stop();
  }
}
(process.argv[2] === '--serve' ? server() : main()).catch((error) => {
  process.stderr.write(error.stack + '\n');
  process.exitCode = 1;
});
