'use strict';
// Operator-configured public starter only. No credentials or customer data leave CET.
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const { execFile } = require('child_process');
const { promisify } = require('util');
const execute = promisify(execFile);
const LIMIT = 64 * 1024 * 1024;
const sha = (value) => crypto.createHash('sha256').update(value).digest('hex');
const check = (ok, message) => {
  if (!ok) throw new Error(message);
};
const root = () =>
  process.env.FORECAST_PORTFOLIO_RUNTIME_PATH ||
  path.join(__dirname, '../data/forecast-portfolio-runtime');
const base = () => path.join(root(), '_starter-baseline');
function engineHash() {
  return sha(
    Buffer.concat(
      [
        'engine.py',
        'persistence.py',
        'runtime.py',
        'contracts.py',
        'regimes.py',
        'product.py',
        'starter.py',
      ].map((name) => fs.readFileSync(path.join(__dirname, '../tools/forecast-portfolio', name)))
    )
  );
}
async function python(args) {
  const local = path.join(__dirname, '../.venv-forecast/bin/python');
  const binary = process.env.FORECAST_PYTHON || (fs.existsSync(local) ? local : 'python3');
  return execute(
    binary,
    [path.join(__dirname, '../tools/forecast-portfolio/starter.py'), ...args],
    { timeout: 60000, maxBuffer: LIMIT }
  );
}
function verify(bytes, publicKey, expectedSha) {
  check(bytes.length <= LIMIT, 'Starter package too large');
  check(!expectedSha || /^[a-f0-9]{64}$/.test(expectedSha), 'Invalid configured SHA-256');
  check(!expectedSha || sha(bytes) === expectedSha, 'Starter package checksum mismatch');
  const envelope = JSON.parse(bytes);
  check(
    envelope.format === 'cet-signed-starter' && envelope.schema === 1,
    'Unsupported signed starter'
  );
  check(
    typeof envelope.payload === 'string' && typeof envelope.signature === 'string',
    'Invalid envelope'
  );
  const key = crypto.createPublicKey(publicKey);
  check(key.asymmetricKeyType === 'ed25519', 'Ed25519 public key required');
  const data = Buffer.from(envelope.payload, 'base64');
  check(
    crypto.verify(null, data, key, Buffer.from(envelope.signature, 'base64')),
    'Starter signature invalid'
  );
  const payload = JSON.parse(data);
  check(
    payload.format === 'cet-public-forecast-starter' && payload.schema === 1,
    'Unsupported starter payload'
  );
  check(payload.engine_sha256 === engineHash(), 'Starter engine mismatch');
  check(/^[A-Za-z0-9][A-Za-z0-9._-]{0,79}$/.test(payload.release), 'Invalid release');
  return { payload, data, version: sha(data) };
}
function candidate() {
  const pointer = path.join(base(), 'current.json');
  if (!fs.existsSync(pointer)) return null;
  const { version } = JSON.parse(fs.readFileSync(pointer));
  check(/^[a-f0-9]{64}$/.test(version), 'Invalid starter pointer');
  const directory = path.join(base(), 'versions', version);
  const signed = verify(
    fs.readFileSync(path.join(directory, 'bundle.json')),
    fs.readFileSync(path.join(directory, 'trust.pem'))
  );
  check(signed.version === version, 'Starter identity mismatch');
  const manifestBytes = fs.readFileSync(path.join(directory, 'manifest.json'));
  const manifest = JSON.parse(manifestBytes);
  // All metadata must be exactly the signed payload, with only its binary representation replaced.
  const expected = {
    ...signed.payload,
    model:
      'constant' in signed.payload.model
        ? { constant: signed.payload.model.constant }
        : { file: 'starter.cbm', sha256: signed.payload.model.sha256 },
  };
  check(JSON.stringify(manifest) === JSON.stringify(expected), 'Starter metadata changed');
  if (manifest.model.file)
    check(
      sha(fs.readFileSync(path.join(directory, manifest.model.file))) === manifest.model.sha256,
      'Starter weights changed'
    );
  return { directory, version, manifest_sha256: sha(manifestBytes), release: manifest.release };
}
function localModelExists() {
  const shared = path.join(root(), '_shared-baseline', 'models');
  if (!fs.existsSync(shared)) return false;
  return fs.readdirSync(shared).some((version) => {
    if (!/^[a-f0-9]{64}$/.test(version)) return false;
    try {
      const m = JSON.parse(fs.readFileSync(path.join(shared, version, 'manifest.json')));
      return (
        m.engine_sha256 === engineHash() &&
        Object.values(m.models).every(
          (entry) =>
            'constant' in entry ||
            sha(fs.readFileSync(path.join(shared, version, entry.file))) === entry.sha256
        )
      );
    } catch {
      return false;
    }
  });
}
async function install(bytes, publicKey, expectedSha) {
  const signed = verify(bytes, publicKey, expectedSha);
  fs.mkdirSync(base(), { recursive: true, mode: 0o700 });
  const lock = path.join(base(), 'install.lock');
  const fd = fs.openSync(lock, 'wx', 0o600);
  fs.closeSync(fd);
  let stage;
  try {
    if (candidate() || localModelExists()) return { status: 'existing_model_preserved' };
    stage = fs.mkdtempSync(path.join(base(), '.install-'));
    fs.chmodSync(stage, 0o700);
    fs.writeFileSync(path.join(stage, 'payload.json'), signed.data, { mode: 0o600 });
    await python(['validate', '--payload', path.join(stage, 'payload.json'), '--directory', stage]);
    fs.unlinkSync(path.join(stage, 'payload.json'));
    fs.writeFileSync(path.join(stage, 'bundle.json'), bytes, { mode: 0o600 });
    fs.writeFileSync(path.join(stage, 'trust.pem'), publicKey, { mode: 0o600 });
    const versions = path.join(base(), 'versions');
    fs.mkdirSync(versions, { recursive: true, mode: 0o700 });
    const target = path.join(versions, signed.version);
    check(
      !fs.existsSync(target),
      'Starter version already exists without active pointer; inspect interrupted installation'
    );
    fs.renameSync(stage, target);
    stage = null;
    // Never replace a pointer created concurrently outside this installer.
    const temporary = path.join(base(), crypto.randomUUID() + '.tmp');
    try {
      fs.writeFileSync(temporary, JSON.stringify({ version: signed.version }), { mode: 0o600 });
      fs.linkSync(temporary, path.join(base(), 'current.json'));
    } finally {
      fs.rmSync(temporary, { force: true });
    }
    candidate();
    return { status: 'installed', version: signed.version, release: signed.payload.release };
  } finally {
    if (stage) fs.rmSync(stage, { recursive: true, force: true });
    fs.unlinkSync(lock);
  }
}
async function download(address) {
  const signal = AbortSignal.timeout(30000);
  for (let redirects = 0; redirects <= 3; redirects++) {
    const url = new URL(address);
    check(
      url.protocol === 'https:' && !url.username && !url.password,
      'Public starter URL must use HTTPS without credentials'
    );
    const response = await fetch(url, { redirect: 'manual', signal });
    if ([301, 302, 303, 307, 308].includes(response.status)) {
      await response.body?.cancel();
      address = new URL(response.headers.get('location'), url).href;
      continue;
    }
    check(response.ok, 'Starter download failed');
    check(
      Number(response.headers.get('content-length') || 0) <= LIMIT,
      'Starter download too large'
    );
    const parts = [];
    let size = 0;
    for await (const part of response.body) {
      size += part.length;
      check(size <= LIMIT, 'Starter download too large');
      parts.push(part);
    }
    return Buffer.concat(parts);
  }
  throw new Error('Too many starter redirects');
}
async function bootstrap(logger) {
  if (process.env.FORECAST_STARTER_AUTO_DOWNLOAD !== 'true') return { status: 'disabled' };
  try {
    if (candidate() || localModelExists()) return { status: 'existing_model_preserved' };
    const url = process.env.FORECAST_STARTER_URL;
    const keyFile = process.env.FORECAST_STARTER_PUBLIC_KEY_FILE;
    check(
      url && keyFile && process.env.FORECAST_STARTER_SHA256,
      'Starter URL, public key and SHA-256 must be configured'
    );
    const key = fs.readFileSync(keyFile);
    const result = await install(await download(url), key, process.env.FORECAST_STARTER_SHA256);
    logger?.info('Forecast starter: ' + result.status);
    return result;
  } catch {
    // No URLs, key contents, subprocess payloads or environment secrets in logs.
    logger?.warn(
      'Forecast starter unavailable; CET continues without automatic starter installation. Check URL, signature, checksum and compatibility with starter_model.js.'
    );
    return { status: 'unavailable' };
  }
}
module.exports = {
  root,
  base,
  engineHash,
  python,
  verify,
  candidate,
  localModelExists,
  install,
  download,
  bootstrap,
  sha,
};
