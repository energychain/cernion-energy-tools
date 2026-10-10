#!/usr/bin/env node
'use strict';
// Isolated HTTP product flow; download transport is stubbed, signature/model/inference are real.
const fs = require('fs');
const path = require('path');
const os = require('os');
const crypto = require('crypto');
const assert = require('assert/strict');
const { promisify } = require('util');
const execute = promisify(require('child_process').execFile);
const repo = path.resolve(__dirname, '../..');
const output = fs.mkdtempSync(path.join(os.tmpdir(), 'forecast-starter-http-'));
const runtime = path.join(output, 'runtime');
const python = path.join(repo, '.venv-forecast/bin/python');
Object.assign(process.env, {
  FORECAST_PORTFOLIO_RUNTIME_PATH: runtime,
  JOB_STORE_DIR: path.join(output, 'jobs'),
  RATE_QUOTA_DRIVER: 'file',
  RATE_QUOTA_DIR: path.join(output, 'quotas'),
  TRACING_ENABLED: 'false',
});
const starter = require('../../src/forecast-starter');
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
        const tenantId = { ck_starter_customer: 'starter-customer', ck_starter_foreign: 'foreign' }[
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
const read = (file) => JSON.parse(fs.readFileSync(file));
const run = (args, token = 'ck_starter_customer') =>
  execute(python, args, {
    cwd: repo,
    env: { ...process.env, CET_API_TOKEN: token },
    timeout: 240000,
    maxBuffer: 1024 * 1024,
  });
const oldFetch = global.fetch;
(async () => {
  try {
    const input = path.join(output, 'sample.json');
    await run([
      '-c',
      `import sys,json;sys.path.insert(0,'tools/forecast-portfolio');from test_product import sample;import datetime as d
s=sample(sid='private-seed',days=110)
json.dump(dict(series_id=s['series_id'],unit=s['unit'],timezone=s['timezone'],values=[dict(timestamp=d.datetime.fromtimestamp(r[0]/1000,d.timezone.utc).replace(year=2024).isoformat(),value=r[1]) for r in s['rows']]),open(${JSON.stringify(input)},'w'))`,
    ]);
    const trained = path.join(output, 'training');
    await run([
      path.join(__dirname, 'prepare_starter.py'),
      '--input',
      input,
      '--unit',
      'kWh',
      '--forecast-for',
      '2024-08-12',
      '--out',
      trained,
    ]);
    const keys = crypto.generateKeyPairSync('ed25519');
    const keyFile = path.join(output, 'public.pem');
    fs.writeFileSync(keyFile, keys.publicKey.export({ type: 'spki', format: 'pem' }));
    const { stdout } = await starter.python([
      'export',
      '--model-dir',
      trained,
      '--release',
      'test-1',
      '--license',
      'Apache-2.0',
    ]);
    const payload = Buffer.from(stdout.trim());
    const bytes = Buffer.from(
      JSON.stringify({
        format: 'cet-signed-starter',
        schema: 1,
        payload: payload.toString('base64'),
        signature: crypto.sign(null, payload, keys.privateKey).toString('base64'),
      })
    );
    Object.assign(process.env, {
      FORECAST_STARTER_AUTO_DOWNLOAD: 'true',
      FORECAST_STARTER_URL: 'https://models.example.org/test-1.json',
      FORECAST_STARTER_PUBLIC_KEY_FILE: keyFile,
      FORECAST_STARTER_SHA256: starter.sha(bytes),
    });
    let downloads = 0;
    global.fetch = async (url, options) => {
      assert.equal(String(url), process.env.FORECAST_STARTER_URL);
      assert.equal(options.headers, undefined);
      downloads++;
      return new Response(bytes, { status: 200 });
    };
    await broker.start();
    assert.equal(downloads, 1);
    assert.ok(starter.candidate());
    assert.deepEqual(fs.readdirSync(runtime), ['_starter-baseline']);
    // Public-only runtime is also transferable through the private admin transfer tool.
    const transfer = path.join(__dirname, 'transfer.py');
    const archive = path.join(output, 'public-only.zip');
    const receipt = JSON.parse(
      (
        await run([
          transfer,
          'export',
          '--runtime',
          runtime,
          '--archive',
          archive,
          '--service-stopped',
        ])
      ).stdout
    );
    await run([
      transfer,
      'import',
      '--runtime',
      path.join(output, 'copied-starter'),
      '--archive',
      archive,
      '--sha256',
      receipt.sha256,
      '--service-stopped',
    ]);
    await new Promise((resolve) => setTimeout(resolve, 1500));
    const base = 'http://127.0.0.1:' + api.server.address().port;
    const cli = path.join(__dirname, 'forecast_product.py');
    const common = (name) => [
      '--env-file',
      '/dev/null',
      '--base-url',
      base,
      '--poll-interval',
      '0.2',
      '--out',
      path.join(output, name),
    ];
    await run([
      cli,
      'enroll',
      ...common('enroll'),
      '--input',
      input,
      '--series-id',
      'new-meter',
      '--forecast-for',
      '2024-10-20',
    ]);
    const model = read(path.join(output, 'enroll/result.json')).result;
    assert.equal(model.model.evidence['new-meter'].public_starter_status, 'eligible');
    assert.equal(model.model.reference_meter_count, 0);
    assert.ok(Number.isFinite(model.model.evidence['new-meter'].mae.public_starter));
    await run([
      cli,
      'predict',
      ...common('predict'),
      '--model-version',
      model.model_version,
      '--series-id',
      'new-meter',
      '--forecast-for',
      '2024-10-20',
    ]);
    assert.equal(read(path.join(output, 'predict/result.json')).result.forecast_values.length, 96);
    await assert.rejects(
      run(
        [
          cli,
          'predict',
          ...common('denied'),
          '--model-version',
          model.model_version,
          '--series-id',
          'new-meter',
          '--forecast-for',
          '2024-10-20',
        ],
        'ck_starter_foreign'
      )
    );
    assert.equal((await starter.bootstrap()).status, 'existing_model_preserved');
    assert.equal(downloads, 1);
    const report = {
      status: 'passed',
      checks: [
        'signed service bootstrap',
        'no private seed histories installed',
        'public-only admin transfer',
        'new-meter chronological starter comparison',
        'REST forecast',
        'foreign tenant denied',
        'no repeated download',
      ],
      training: trained,
    };
    fs.writeFileSync(path.join(output, 'report.json'), JSON.stringify(report, null, 2));
    process.stdout.write(JSON.stringify(report) + '\nArtifacts: ' + output + '\n');
  } finally {
    global.fetch = oldFetch;
    await broker.stop();
  }
})().catch((error) => {
  process.stderr.write(error.stack + '\n');
  process.exitCode = 1;
});
