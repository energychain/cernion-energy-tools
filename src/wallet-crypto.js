'use strict';

const crypto = require('crypto');

const WALLET_VERSION = 1;
const CIPHER_ALGORITHM = 'aes-256-gcm';
const KDF_ALGORITHM = 'scrypt';
const KEY_LENGTH_BYTES = 32;
const IV_LENGTH_BYTES = 12;
const DEFAULT_SCRYPT = Object.freeze({
  N: 16384,
  r: 8,
  p: 1,
});

class WalletCryptoError extends Error {
  constructor(message) {
    super(message);
    this.name = 'WalletCryptoError';
  }
}

function fail(message = 'Wallet crypto operation failed.') {
  throw new WalletCryptoError(message);
}

function stableStringify(value) {
  if (Array.isArray(value)) {
    return `[${value.map(stableStringify).join(',')}]`;
  }

  if (value && typeof value === 'object') {
    return `{${Object.keys(value)
      .sort()
      .map((key) => `${JSON.stringify(key)}:${stableStringify(value[key])}`)
      .join(',')}}`;
  }

  return JSON.stringify(value);
}

function toBase64(buffer) {
  return Buffer.from(buffer).toString('base64');
}

function fromBase64(value, label) {
  if (typeof value !== 'string' || !value.trim()) {
    fail(`Invalid wallet ${label}.`);
  }

  const buffer = Buffer.from(value, 'base64');
  if (!buffer.length || toBase64(buffer) !== value) {
    fail(`Invalid wallet ${label}.`);
  }
  return buffer;
}

function assertPassphrase(passphrase) {
  if (typeof passphrase !== 'string' || passphrase.length < 1) {
    fail('Wallet passphrase is required.');
  }
}

function normalizeDate(value) {
  if (!value) return new Date().toISOString();
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) {
    fail('Invalid wallet timestamp.');
  }
  return date.toISOString();
}

function deriveKey(passphrase, keyDerivation) {
  assertPassphrase(passphrase);
  if (!keyDerivation || keyDerivation.algorithm !== KDF_ALGORITHM) {
    fail('Unsupported wallet key derivation.');
  }

  const N = Number(keyDerivation.N);
  const r = Number(keyDerivation.r);
  const p = Number(keyDerivation.p);
  const keyLength = Number(keyDerivation.keyLength || KEY_LENGTH_BYTES);
  if (!Number.isInteger(N) || !Number.isInteger(r) || !Number.isInteger(p) || keyLength !== 32) {
    fail('Invalid wallet key derivation.');
  }

  const salt = fromBase64(keyDerivation.salt, 'salt');
  return crypto.scryptSync(passphrase, salt, keyLength, {
    N,
    r,
    p,
    maxmem: 64 * 1024 * 1024,
  });
}

function buildAuthenticatedData(envelope) {
  return Buffer.from(
    stableStringify({
      version: envelope.version,
      walletId: envelope.walletId,
      createdAt: envelope.createdAt,
      updatedAt: envelope.updatedAt,
      keyDerivation: envelope.keyDerivation,
      cipher: {
        algorithm: envelope.cipher && envelope.cipher.algorithm,
        iv: envelope.cipher && envelope.cipher.iv,
      },
      publicVerificationKeys: envelope.publicVerificationKeys || [],
      evidenceIndex: envelope.evidenceIndex || [],
      provenanceRefs: envelope.provenanceRefs || [],
    }),
    'utf8'
  );
}

function normalizeEnvelopeMetadata(options = {}) {
  const now = normalizeDate(options.now);
  return {
    version: WALLET_VERSION,
    walletId: options.walletId || `wallet:${crypto.randomUUID()}`,
    createdAt: normalizeDate(options.createdAt || now),
    updatedAt: normalizeDate(options.updatedAt || now),
    publicVerificationKeys: Array.isArray(options.publicVerificationKeys)
      ? options.publicVerificationKeys
      : [],
    evidenceIndex: Array.isArray(options.evidenceIndex) ? options.evidenceIndex : [],
    provenanceRefs: Array.isArray(options.provenanceRefs) ? options.provenanceRefs : [],
  };
}

function createKeyDerivation(options = {}) {
  const params = {
    ...DEFAULT_SCRYPT,
    ...(options.keyDerivation || {}),
  };
  const salt = options.salt ? fromBase64(options.salt, 'salt') : crypto.randomBytes(16);

  return {
    algorithm: KDF_ALGORITHM,
    N: Number(params.N),
    r: Number(params.r),
    p: Number(params.p),
    keyLength: KEY_LENGTH_BYTES,
    salt: toBase64(salt),
  };
}

function encryptWalletPayload(payload, passphrase, options = {}) {
  try {
    assertPassphrase(passphrase);
    if (!payload || typeof payload !== 'object' || Array.isArray(payload)) {
      fail('Wallet payload must be an object.');
    }

    const keyDerivation = createKeyDerivation(options);
    const iv = crypto.randomBytes(IV_LENGTH_BYTES);
    const envelope = {
      ...normalizeEnvelopeMetadata(options),
      keyDerivation,
      cipher: {
        algorithm: CIPHER_ALGORITHM,
        iv: toBase64(iv),
      },
    };

    const key = deriveKey(passphrase, keyDerivation);
    const cipher = crypto.createCipheriv(CIPHER_ALGORITHM, key, iv);
    cipher.setAAD(buildAuthenticatedData(envelope));
    const encrypted = Buffer.concat([
      cipher.update(Buffer.from(JSON.stringify(payload), 'utf8')),
      cipher.final(),
    ]);

    envelope.cipher.authTag = toBase64(cipher.getAuthTag());
    envelope.encryptedPayload = toBase64(encrypted);
    return envelope;
  } catch (error) {
    if (error instanceof WalletCryptoError) throw error;
    fail();
  }
}

function assertSupportedEnvelope(envelope) {
  if (!envelope || typeof envelope !== 'object' || Array.isArray(envelope)) {
    fail('Invalid wallet envelope.');
  }
  if (envelope.version !== WALLET_VERSION) {
    fail('Unsupported wallet version.');
  }
  if (!envelope.cipher || envelope.cipher.algorithm !== CIPHER_ALGORITHM) {
    fail('Unsupported wallet cipher.');
  }
}

function decryptWalletPayload(envelope, passphrase) {
  try {
    assertSupportedEnvelope(envelope);
    const key = deriveKey(passphrase, envelope.keyDerivation);
    const iv = fromBase64(envelope.cipher.iv, 'iv');
    const authTag = fromBase64(envelope.cipher.authTag, 'auth tag');
    const encryptedPayload = fromBase64(envelope.encryptedPayload, 'payload');

    const decipher = crypto.createDecipheriv(CIPHER_ALGORITHM, key, iv);
    decipher.setAAD(buildAuthenticatedData(envelope));
    decipher.setAuthTag(authTag);
    const decrypted = Buffer.concat([decipher.update(encryptedPayload), decipher.final()]);
    return JSON.parse(decrypted.toString('utf8'));
  } catch (error) {
    if (error instanceof WalletCryptoError) throw error;
    fail('Wallet decrypt failed: invalid passphrase or envelope.');
  }
}

function rotateWalletPassphrase(envelope, oldPassphrase, newPassphrase, options = {}) {
  const payload = decryptWalletPayload(envelope, oldPassphrase);
  return encryptWalletPayload(payload, newPassphrase, {
    ...options,
    walletId: envelope.walletId,
    createdAt: envelope.createdAt,
    publicVerificationKeys: envelope.publicVerificationKeys || [],
    evidenceIndex: envelope.evidenceIndex || [],
    provenanceRefs: envelope.provenanceRefs || [],
  });
}

function fingerprintPublicKey(publicKey) {
  const source = typeof publicKey === 'string' ? publicKey.trim() : '';
  if (!source) {
    fail('Public key is required.');
  }
  return `sha256:${crypto.createHash('sha256').update(source, 'utf8').digest('hex')}`;
}

module.exports = {
  encryptWalletPayload,
  decryptWalletPayload,
  rotateWalletPassphrase,
  fingerprintPublicKey,
  WalletCryptoError,
};
