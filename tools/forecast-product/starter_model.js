#!/usr/bin/env node
'use strict';
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const starter = require('../../src/forecast-starter');
const { parseArgs } = require('util');
async function main() {
  const { values, positionals } = parseArgs({
    allowPositionals: true,
    options: Object.fromEntries(
      [
        'model-dir',
        'release',
        'license',
        'private-key',
        'public-key',
        'out',
        'package',
        'runtime',
        'sha256',
      ]
        .map((name) => [name, { type: 'string' }])
        .concat([['help', { type: 'boolean' }]])
    ),
  });
  const command = positionals[0];
  if (values.help || !command) {
    process.stdout.write(
      'Commands: keygen --out DIR | export --model-dir DIR --release VERSION --license SPDX --private-key FILE --out FILE | verify --package FILE --public-key FILE --sha256 HASH | install --package FILE --public-key FILE --sha256 HASH --runtime DIR\n'
    );
    return;
  }
  const need = (...keys) =>
    keys.forEach((key) => {
      if (!values[key]) throw new Error('Required: --' + key);
    });
  if (command === 'keygen') {
    need('out');
    fs.mkdirSync(values.out, { mode: 0o700 });
    const keys = crypto.generateKeyPairSync('ed25519', {
      publicKeyEncoding: { type: 'spki', format: 'pem' },
      privateKeyEncoding: { type: 'pkcs8', format: 'pem' },
    });
    fs.writeFileSync(path.join(values.out, 'private.pem'), keys.privateKey, {
      flag: 'wx',
      mode: 0o600,
    });
    fs.writeFileSync(path.join(values.out, 'public.pem'), keys.publicKey, {
      flag: 'wx',
      mode: 0o644,
    });
    process.stdout.write('Signing key generated; distribute only public.pem.\n');
    return;
  }
  if (command === 'export') {
    need('model-dir', 'release', 'license', 'private-key', 'out');
    const modelManifest = JSON.parse(
      fs.readFileSync(path.join(values['model-dir'], 'model.json'), 'utf8')
    );
    let baselineQuality;
    if (modelManifest.publisher_training) {
      const reportBytes = fs.readFileSync(path.join(values['model-dir'], 'quality-report.json'));
      if (starter.sha(reportBytes) !== modelManifest.publisher_training.quality_report_sha256) {
        throw new Error('Baseline quality report checksum mismatch');
      }
      const report = JSON.parse(reportBytes);
      const summary = report.validation_summary;
      if (
        report.status !== 'trained' ||
        !summary?.checks?.all_meters_evaluated ||
        !summary.checks.all_window_coverage_sufficient ||
        !summary.checks.no_duplicate_histories ||
        !Number.isFinite(summary.normalized_validation_mae)
      ) {
        throw new Error('Baseline validation incomplete; review the quality report before export');
      }
      baselineQuality = {
        normalized_validation_mae: summary.normalized_validation_mae,
        claim: 'direct_common_model_chronological_validation_not_unseen_meter_generalization',
        four_seasons_per_meter: summary.checks.four_seasons_per_meter,
        evaluated_meter_count: Object.keys(summary.by_meter).length,
        review_required: true,
      };
    }
    const scopeFile = path.join(values['model-dir'], 'training-scope.json');
    if (
      fs.existsSync(scopeFile) &&
      JSON.parse(fs.readFileSync(scopeFile, 'utf8')).target_direction !== 'import'
    ) {
      throw new Error('The public consumption starter cannot publish a feed-in training model');
    }
    if (
      !/^[A-Za-z0-9][A-Za-z0-9._-]{0,79}$/.test(values.release) ||
      !/^[A-Za-z0-9][A-Za-z0-9.+-]{0,79}$/.test(values.license)
    )
      throw new Error('Invalid release/license identifier');
    const { stdout } = await starter.python([
      'export',
      '--model-dir',
      values['model-dir'],
      '--release',
      values.release,
      '--license',
      values.license,
    ]);
    const publicPayload = JSON.parse(stdout);
    if (baselineQuality) publicPayload.quality = baselineQuality;
    const data = Buffer.from(JSON.stringify(publicPayload));
    const key = crypto.createPrivateKey(fs.readFileSync(values['private-key']));
    if (key.asymmetricKeyType !== 'ed25519') throw new Error('Ed25519 signing key required');
    const bytes = Buffer.from(
      JSON.stringify({
        format: 'cet-signed-starter',
        schema: 1,
        payload: data.toString('base64'),
        signature: crypto.sign(null, data, key).toString('base64'),
      })
    );
    starter.verify(bytes, crypto.createPublicKey(key).export({ type: 'spki', format: 'pem' }));
    fs.writeFileSync(values.out, bytes, { flag: 'wx', mode: 0o600 });
    process.stdout.write(
      JSON.stringify({
        status: 'exported',
        sha256: starter.sha(bytes),
        release: values.release,
        output: values.out,
      }) + '\n'
    );
    return;
  }
  if (!['install', 'verify'].includes(command)) throw new Error('Unknown command');
  need('package', 'public-key', 'sha256');
  const bytes = fs.readFileSync(values.package);
  const publicKey = fs.readFileSync(values['public-key']);
  if (command === 'verify') {
    const verified = starter.verify(bytes, publicKey, values.sha256);
    const os = require('os');
    const temp = fs.mkdtempSync(path.join(os.tmpdir(), 'cet-starter-verify-'));
    try {
      fs.writeFileSync(path.join(temp, 'payload.json'), verified.data, { mode: 0o600 });
      await starter.python([
        'validate',
        '--payload',
        path.join(temp, 'payload.json'),
        '--directory',
        temp,
      ]);
    } finally {
      fs.rmSync(temp, { recursive: true, force: true });
    }
    process.stdout.write(
      JSON.stringify({
        status: 'verified',
        version: verified.version,
        release: verified.payload.release,
      }) + '\n'
    );
  } else {
    need('runtime');
    process.env.FORECAST_PORTFOLIO_RUNTIME_PATH = path.resolve(values.runtime);
    process.stdout.write(
      JSON.stringify(await starter.install(bytes, publicKey, values.sha256)) + '\n'
    );
  }
}
main().catch(() => {
  process.stderr.write(
    'Starter operation failed: check arguments, paths, signature, checksum and engine compatibility. Existing installations are not overwritten.\n'
  );
  process.exitCode = 1;
});
