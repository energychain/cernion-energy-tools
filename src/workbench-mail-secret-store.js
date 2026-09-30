'use strict';

const crypto = require('crypto');
const { Errors } = require('moleculer');

const ALGORITHM = 'aes-256-gcm';
const KEY_ENV = 'CET_WORKBENCH_MAIL_SECRET_KEY';
const LEGACY_KEY_ENV = 'WORKBENCH_MAIL_SECRET_KEY';

function mailSecretError(message, code = 'WORKBENCH_MAIL_SECRET_INVALID', status = 422) {
  throw new Errors.MoleculerClientError(message, status, code);
}

function resolveKeyMaterial(env = process.env) {
  const configured = env[KEY_ENV] || env[LEGACY_KEY_ENV];
  if (configured) return configured;
  if (env.NODE_ENV === 'test') return 'test-only-cet-workbench-mail-secret-key';
  mailSecretError(
    'Workbench mail secret key is required',
    'WORKBENCH_MAIL_SECRET_KEY_REQUIRED',
    503
  );
}

function deriveKey(keyMaterial) {
  return crypto.createHash('sha256').update(String(keyMaterial)).digest();
}

function safeSecretPayload(input = {}) {
  const output = {};
  for (const key of ['host', 'port', 'username', 'password', 'oauthToken', 'tls', 'driver']) {
    if (input[key] !== undefined && input[key] !== null && input[key] !== '') {
      output[key] = input[key];
    }
  }
  if (!output.host && !output.username && !output.password && !output.oauthToken) {
    mailSecretError('At least one mail account secret field is required');
  }
  return output;
}

function encryptMailSecret(secret, { keyMaterial = resolveKeyMaterial() } = {}) {
  const payload = Buffer.from(JSON.stringify(safeSecretPayload(secret)), 'utf8');
  const iv = crypto.randomBytes(12);
  const cipher = crypto.createCipheriv(ALGORITHM, deriveKey(keyMaterial), iv);
  const ciphertext = Buffer.concat([cipher.update(payload), cipher.final()]);
  const tag = cipher.getAuthTag();
  return {
    alg: ALGORITHM,
    iv: iv.toString('base64'),
    tag: tag.toString('base64'),
    ciphertext: ciphertext.toString('base64'),
    keyRef: KEY_ENV,
  };
}

function decryptMailSecret(encrypted, { keyMaterial = resolveKeyMaterial() } = {}) {
  if (!encrypted || encrypted.alg !== ALGORITHM) {
    mailSecretError('Unsupported encrypted mail secret', 'WORKBENCH_MAIL_SECRET_UNSUPPORTED', 500);
  }
  const decipher = crypto.createDecipheriv(
    ALGORITHM,
    deriveKey(keyMaterial),
    Buffer.from(encrypted.iv, 'base64')
  );
  decipher.setAuthTag(Buffer.from(encrypted.tag, 'base64'));
  const plaintext = Buffer.concat([
    decipher.update(Buffer.from(encrypted.ciphertext, 'base64')),
    decipher.final(),
  ]);
  return JSON.parse(plaintext.toString('utf8'));
}

function secretFingerprint(secret = {}) {
  const identity = {
    driver: secret.driver || 'himalaya',
    host: secret.host || null,
    port: secret.port || null,
    username: secret.username || null,
  };
  return `sha256:${crypto.createHash('sha256').update(JSON.stringify(identity)).digest('hex')}`;
}

function hasEncryptedSecret(doc = {}) {
  return Boolean(
    doc.encryptedSecret?.ciphertext && doc.encryptedSecret?.iv && doc.encryptedSecret?.tag
  );
}

module.exports = {
  encryptMailSecret,
  decryptMailSecret,
  secretFingerprint,
  hasEncryptedSecret,
};
