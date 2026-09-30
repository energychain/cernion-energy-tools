#!/usr/bin/env node
'use strict';
// Exercise the Python helpers against an isolated real gateway and forecast worker.
const fs = require('fs');
const os = require('os');
const path = require('path');
const { spawn } = require('child_process');
const assert = require('assert/strict');
const repo = path.resolve(__dirname, '../..');
const output = fs.mkdtempSync(path.join(os.tmpdir(), 'forecast-cli-http-'));
process.env.RATE_QUOTA_DRIVER = 'file';
process.env.RATE_QUOTA_DIR = path.join(output, 'quotas');
process.env.JOB_STORE_DIR = path.join(output, 'jobs');
process.env.FORECAST_PORTFOLIO_RUNTIME_PATH = path.join(output, 'runtime');
process.env.TRACING_ENABLED = 'false';
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
        const tenantId = { ck_cli_operator: 'operator', ck_cli_customer: 'customer' }[
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
const python = path.join(repo, '.venv-forecast/bin/python');
function run(args, tenant = 'operator') {
  return new Promise((resolve, reject) => {
    const child = spawn(python, args, {
      cwd: repo,
      env: { ...process.env, CET_API_TOKEN: 'ck_cli_' + tenant },
      timeout: 240000,
    });
    let log = '';
    child.stdout.on('data', (b) => {
      log += b;
    });
    child.stderr.on('data', (b) => {
      log += b;
    });
    child.on('error', reject);
    child.on('exit', (code) => (code === 0 ? resolve(log) : reject(new Error(log))));
  });
}
const read = (file) => JSON.parse(fs.readFileSync(file, 'utf8'));
(async () => {
  try {
    await broker.start();
    await new Promise((resolve) => setTimeout(resolve, 1500));
    const base = 'http://127.0.0.1:' + api.server.address().port;
    await run([
      '-c',
      `from openpyxl import Workbook
import datetime as d
from pathlib import Path
out=Path(${JSON.stringify(output)})
for meter in (1,2):
 b=Workbook();s=b.active;s.append(['Meldepunkt','OBIS','Datum von','Datum bis','Wert'])
 t=d.datetime(2024,1,1)
 for i in range(46*96):
  start=t+d.timedelta(minutes=15*i)
  s.append([str(meter),'1-1:1.29.0',start,start+d.timedelta(minutes=15),1+meter*(start.hour>=8 and start.hour<18)])
 b.save(out/f'{meter}.xlsx')`,
    ]);
    const common = (tenant, folder) => [
      '--tenant-id',
      tenant,
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
      'seed',
      ...common('operator', 'seed'),
      '--xlsx',
      path.join(output, '1.xlsx'),
      path.join(output, '2.xlsx'),
      '--unit',
      'kWh',
      '--time-basis',
      'utc',
      '--forecast-for',
      '2024-02-15',
    ]);
    const seed = read(path.join(output, 'seed/result.json'));
    assert.equal(seed.result.model.contributed_meter_count, 2);
    await run(
      [
        cli,
        'enroll',
        ...common('customer', 'enroll'),
        '--input',
        path.join(output, '1.xlsx'),
        '--series-id',
        'customer-meter',
        '--unit',
        'kWh',
        '--time-basis',
        'utc',
        '--forecast-for',
        '2024-02-15',
      ],
      'customer'
    );
    assert.equal(
      read(path.join(output, 'enroll/result.json')).result.model.reference_meter_count,
      2
    );
    await run(
      [
        cli,
        'predict',
        ...common('customer', 'predict'),
        '--series-id',
        'customer-meter',
        '--model-file',
        path.join(output, 'enroll/result.json'),
        '--forecast-for',
        '2024-02-15',
      ],
      'customer'
    );
    await run(
      [
        cli,
        'score',
        '--tenant-id',
        'customer',
        '--series-id',
        'customer-meter',
        '--predictions',
        path.join(output, 'predict/result.json'),
        '--actuals',
        path.join(output, '1.xlsx'),
        '--unit',
        'kWh',
        '--time-basis',
        'utc',
        '--out',
        path.join(output, 'score'),
      ],
      'customer'
    );
    const metrics = read(path.join(output, 'score/metrics.json'));
    assert.equal(metrics.sample_count, 96);
    assert.equal(metrics.coverage, 1);
    for (const key of ['rmse', 'mae', 'wape_percent']) assert.ok(Number.isFinite(metrics[key]));
    await run(
      [
        cli,
        'resume',
        ...common('customer', 'resume'),
        '--run-file',
        path.join(output, 'predict/run.json'),
      ],
      'customer'
    );
    assert.deepEqual(
      read(path.join(output, 'resume/result.json')).result.forecast_values,
      read(path.join(output, 'predict/result.json')).result.forecast_values
    );
    await run(
      [
        cli,
        'retrain',
        ...common('customer', 'retrain'),
        '--model-file',
        path.join(output, 'enroll/result.json'),
        '--forecast-for',
        '2024-02-16',
      ],
      'customer'
    );
    assert.notEqual(
      read(path.join(output, 'retrain/result.json')).result.model_version,
      read(path.join(output, 'enroll/result.json')).result.model_version
    );
    const checks = [
      'XLSX seed',
      'new tenant enrollment with references',
      'REST prediction',
      'exact timestamp scoring',
      'resume',
      'retrain',
    ];
    fs.writeFileSync(
      path.join(output, 'report.json'),
      JSON.stringify({ status: 'passed', checks, metrics }, null, 2)
    );
    process.stdout.write('PASS ' + checks.join(', ') + '\nArtifacts: ' + output + '\n');
  } finally {
    await broker.stop();
  }
})().catch((error) => {
  process.stderr.write(error.stack + '\n');
  process.exitCode = 1;
});
