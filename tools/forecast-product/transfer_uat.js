#!/usr/bin/env node
'use strict';
// Run after uat.js: argument is its isolated artifact directory, never a live runtime.
const fs = require('fs');
const path = require('path');
const os = require('os');
const assert = require('assert/strict');
const { spawn } = require('child_process');
const repo = path.resolve(__dirname, '../..');
const source = path.resolve(process.argv[2]);
const output = fs.mkdtempSync(path.join(os.tmpdir(), 'forecast-transfer-http-'));
const target = path.join(output, 'runtime');
const archive = path.join(output, 'bundle.zip');
Object.assign(process.env, {
  FORECAST_PORTFOLIO_RUNTIME_PATH: target,
  JOB_STORE_DIR: path.join(output, 'jobs'),
  RATE_QUOTA_DRIVER: 'file',
  RATE_QUOTA_DIR: path.join(output, 'quotas'),
  TRACING_ENABLED: 'false',
});
const python = path.join(repo, '.venv-forecast/bin/python');
function run(args, token = 'ck_transfer_customer') {
  return new Promise((resolve, reject) => {
    const child = spawn(python, args, {
      cwd: repo,
      env: { ...process.env, CET_API_TOKEN: token },
      timeout: 240000,
    });
    let log = '';
    child.stdout.on('data', (b) => (log += b));
    child.stderr.on('data', (b) => (log += b));
    child.on('error', reject);
    child.on('exit', (code) => (code === 0 ? resolve(log) : reject(new Error(log))));
  });
}
const { ServiceBroker } = require('moleculer');
const schema = require('../../services/api.service');
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
        const tenantId = { ck_transfer_customer: 'customer', ck_transfer_new: 'new-customer' }[
          ctx.params.token
        ];
        return {
          valid: !!tenantId,
          tenantId,
          scope: 'full-access',
          scopes: ['admin'],
          tokenId: tenantId,
        };
      },
    },
  },
});
broker.createService(require('../../services/forecast-sandbox.service'));
broker.createService(require('../../services/job-status.service'));
const read = (file) => JSON.parse(fs.readFileSync(file, 'utf8'));
(async () => {
  try {
    const tool = path.join(__dirname, 'transfer.py');
    const receipt = JSON.parse(
      await run([
        tool,
        'export',
        '--runtime',
        path.join(source, 'runtime'),
        '--archive',
        archive,
        '--service-stopped',
      ])
    );
    await run([
      tool,
      'import',
      '--runtime',
      target,
      '--archive',
      archive,
      '--sha256',
      receipt.sha256,
      '--service-stopped',
    ]);
    await broker.start();
    await new Promise((resolve) => setTimeout(resolve, 1500));
    const base = 'http://127.0.0.1:' + api.server.address().port;
    const common = (folder) => [
      '--env-file',
      '/dev/null',
      '--base-url',
      base,
      '--poll-interval',
      '0.2',
      '--out',
      path.join(output, folder),
    ];
    const cli = path.join(__dirname, 'forecast_product.py');
    await run([
      cli,
      'predict',
      ...common('predict'),
      '--series-id',
      'customer-meter',
      '--model-file',
      path.join(source, 'enroll/result.json'),
      '--forecast-for',
      '2024-02-15',
    ]);
    assert.deepEqual(
      read(path.join(output, 'predict/result.json')).result.forecast_values,
      read(path.join(source, 'predict/result.json')).result.forecast_values
    );
    await assert.rejects(
      run(
        [
          cli,
          'predict',
          ...common('denied'),
          '--series-id',
          'customer-meter',
          '--model-version',
          read(path.join(source, 'enroll/result.json')).result.model_version,
          '--forecast-for',
          '2024-02-15',
        ],
        'ck_transfer_new'
      )
    );
    await run(
      [
        cli,
        'enroll',
        ...common('new'),
        '--input',
        path.join(source, '1.xlsx'),
        '--series-id',
        'new-meter',
        '--unit',
        'kWh',
        '--time-basis',
        'utc',
        '--forecast-for',
        '2024-02-15',
      ],
      'ck_transfer_new'
    );
    assert.equal(read(path.join(output, 'new/result.json')).result.model.reference_meter_count, 3);
    const report = {
      status: 'passed',
      checks: [
        'export/import',
        'identical REST forecast after relocation',
        'foreign tenant denied',
        'new tenant trains using three transferred references',
      ],
      sha256: receipt.sha256,
    };
    fs.writeFileSync(path.join(output, 'report.json'), JSON.stringify(report, null, 2));
    process.stdout.write(JSON.stringify(report) + '\nArtifacts: ' + output + '\n');
  } finally {
    await broker.stop();
  }
})().catch((error) => {
  process.stderr.write(error.stack + '\n');
  process.exitCode = 1;
});
