'use strict';
const fs = require('fs');
const path = require('path');
const os = require('os');
const crypto = require('crypto');
const { execFileSync } = require('child_process');
const starter = require('../src/forecast-starter');
const keys = crypto.generateKeyPairSync('ed25519');
const publicKey = keys.publicKey.export({ type: 'spki', format: 'pem' });
const python = path.resolve('.venv-forecast/bin/python');
let root;
const originalFetch = global.fetch;
const originalEnv = { ...process.env };
function payload() {
  return JSON.parse(
    execFileSync(
      python,
      [
        '-c',
        "import sys,json;sys.path.insert(0,'tools/forecast-portfolio');import engine as e,product,numpy as n;print(json.dumps(dict(format='cet-public-forecast-starter',schema=1,contract='cet-starter-core-v1',release='1.0.0',license='Apache-2.0',engine_sha256=e.SOURCE_SHA256,dependencies=dict(catboost=e.CATBOOST_VERSION,numpy=n.__version__),features=product.FEATURES,unit='kWh',timezone='Europe/Berlin',training_information_as_of='2024-01-01T00:00:00Z',model=dict(constant=1.0))))",
      ],
      { encoding: 'utf8' }
    )
  );
}
function bundle(p = payload()) {
  const bytes = Buffer.from(JSON.stringify(p));
  return Buffer.from(
    JSON.stringify({
      format: 'cet-signed-starter',
      schema: 1,
      payload: bytes.toString('base64'),
      signature: crypto.sign(null, bytes, keys.privateKey).toString('base64'),
    })
  );
}
beforeEach(() => {
  root = fs.mkdtempSync(path.join(os.tmpdir(), 'starter-test-'));
  process.env.FORECAST_PORTFOLIO_RUNTIME_PATH = root;
  process.env.FORECAST_STARTER_AUTO_DOWNLOAD = 'false';
});
afterEach(() => {
  global.fetch = originalFetch;
  for (const key of Object.keys(process.env)) if (!(key in originalEnv)) delete process.env[key];
  Object.assign(process.env, originalEnv);
  fs.rmSync(root, { recursive: true, force: true });
});
test('signed install is pinned, idempotent and private histories are absent', async () => {
  const bytes = bundle();
  const installed = await starter.install(bytes, publicKey, starter.sha(bytes));
  expect(installed.status).toBe('installed');
  const pinned = starter.candidate();
  expect(pinned.release).toBe('1.0.0');
  expect(fs.readdirSync(root)).toEqual(['_starter-baseline']);
  expect((await starter.install(bytes, publicKey, starter.sha(bytes))).status).toBe(
    'existing_model_preserved'
  );
  expect(starter.candidate()).toEqual(pinned);
  const manifest = path.join(pinned.directory, 'manifest.json');
  const changed = JSON.parse(fs.readFileSync(manifest));
  changed.training_information_as_of = '2000-01-01T00:00:00Z';
  fs.writeFileSync(manifest, JSON.stringify(changed));
  expect(() => starter.candidate()).toThrow('metadata changed');
});
test('signature, checksum and feature contract failures never activate an installation', async () => {
  const bytes = bundle();
  const wrong = crypto
    .generateKeyPairSync('ed25519')
    .publicKey.export({ type: 'spki', format: 'pem' });
  await expect(starter.install(bytes, wrong, starter.sha(bytes))).rejects.toThrow('signature');
  await expect(starter.install(bytes, publicKey, '0'.repeat(64))).rejects.toThrow('checksum');
  const bad = payload();
  bad.features = [];
  const malformed = bundle(bad);
  await expect(starter.install(malformed, publicKey, starter.sha(malformed))).rejects.toThrow();
  expect(starter.candidate()).toBeNull();
});
test('configured first start downloads once, preserves existing model and fails nonblocking', async () => {
  const bytes = bundle();
  const keyFile = path.join(root, 'operator-public.pem');
  fs.writeFileSync(keyFile, publicKey);
  Object.assign(process.env, {
    FORECAST_STARTER_AUTO_DOWNLOAD: 'true',
    FORECAST_STARTER_URL: 'https://models.example.org/v1.json',
    FORECAST_STARTER_SHA256: starter.sha(bytes),
    FORECAST_STARTER_PUBLIC_KEY_FILE: keyFile,
  });
  global.fetch = jest.fn(async () => new Response(bytes, { status: 200 }));
  expect((await starter.bootstrap({ info: jest.fn(), warn: jest.fn() })).status).toBe('installed');
  expect(global.fetch).toHaveBeenCalledTimes(1);
  expect((await starter.bootstrap()).status).toBe('existing_model_preserved');
  expect(global.fetch).toHaveBeenCalledTimes(1);
  fs.rmSync(starter.base(), { recursive: true });
  global.fetch = jest.fn(async () => {
    throw new Error('network failed');
  });
  expect((await starter.bootstrap({ warn: jest.fn() })).status).toBe('unavailable');
  expect(starter.candidate()).toBeNull();
});
test('existing local baseline prevents download; HTTPS downgrade and redirects are bounded', async () => {
  const dir = path.join(root, '_shared-baseline/models', 'a'.repeat(64));
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(
    path.join(dir, 'manifest.json'),
    JSON.stringify({ engine_sha256: starter.engineHash(), models: { baseline: { constant: 1 } } })
  );
  process.env.FORECAST_STARTER_AUTO_DOWNLOAD = 'true';
  global.fetch = jest.fn();
  expect((await starter.bootstrap()).status).toBe('existing_model_preserved');
  expect(global.fetch).not.toHaveBeenCalled();
  await expect(starter.download('http://example.org/model')).rejects.toThrow('HTTPS');
  global.fetch = jest.fn(
    async () =>
      new Response(null, { status: 302, headers: { location: 'http://example.org/model' } })
  );
  await expect(starter.download('https://example.org/model')).rejects.toThrow('HTTPS');
  global.fetch = jest.fn(
    async () =>
      new Response(null, { status: 302, headers: { location: 'https://example.org/model' } })
  );
  await expect(starter.download('https://example.org/model')).rejects.toThrow('redirects');
});
