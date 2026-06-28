'use strict';

const {
  encryptWalletPayload,
  decryptWalletPayload,
  rotateWalletPassphrase,
  fingerprintPublicKey,
  WalletCryptoError,
} = require('../src/wallet-crypto');

const SENSITIVE_PAYLOAD = Object.freeze({
  privateSigningKey: 'TEST_PRIVATE_KEY_DO_NOT_LEAK',
  mnemonic: 'test seed phrase never log',
  napCredential: { username: 'anlage-operator', refreshToken: 'refresh-token-secret' },
  Anlagenpass: { mastrId: 'SEE000000000001', serial: 'asset-serial-secret' },
});

const METADATA = Object.freeze({
  walletId: 'wallet:test-001',
  publicVerificationKeys: [
    {
      keyId: 'pub-1',
      fingerprint: fingerprintPublicKey('synthetic-public-key-1'),
    },
  ],
  evidenceIndex: [{ ref: 'datapoint:snapshot:abc', hash: 'sha256-test-hash' }],
  provenanceRefs: ['grid-connection:proof:123'],
});

function expectRedactedFailure(fn) {
  expect(fn).toThrow(WalletCryptoError);
  try {
    fn();
  } catch (error) {
    const message = String(error && error.message);
    expect(message).not.toContain('correct horse battery');
    expect(message).not.toContain(SENSITIVE_PAYLOAD.privateSigningKey);
    expect(message).not.toContain(SENSITIVE_PAYLOAD.mnemonic);
    expect(message).not.toContain(SENSITIVE_PAYLOAD.napCredential.refreshToken);
    expect(message).not.toContain(SENSITIVE_PAYLOAD.Anlagenpass.serial);
  }
}

describe('wallet crypto', () => {
  it('encrypts sensitive wallet payload into an authenticated envelope', () => {
    const envelope = encryptWalletPayload(SENSITIVE_PAYLOAD, 'correct horse battery staple', {
      ...METADATA,
      now: '2026-06-28T15:00:00.000Z',
    });

    expect(envelope.walletId).toBe(METADATA.walletId);
    expect(envelope.version).toBe(1);
    expect(envelope.keyDerivation).toMatchObject({
      algorithm: 'scrypt',
      keyLength: 32,
    });
    expect(envelope.cipher).toMatchObject({ algorithm: 'aes-256-gcm' });
    expect(envelope.encryptedPayload).toEqual(expect.any(String));
    expect(envelope.publicVerificationKeys).toEqual(METADATA.publicVerificationKeys);
    expect(envelope.evidenceIndex).toEqual(METADATA.evidenceIndex);
    expect(envelope.provenanceRefs).toEqual(METADATA.provenanceRefs);

    const serialized = JSON.stringify(envelope);
    expect(serialized).not.toContain(SENSITIVE_PAYLOAD.privateSigningKey);
    expect(serialized).not.toContain(SENSITIVE_PAYLOAD.mnemonic);
    expect(serialized).not.toContain(SENSITIVE_PAYLOAD.napCredential.refreshToken);
    expect(serialized).not.toContain(SENSITIVE_PAYLOAD.Anlagenpass.serial);

    expect(decryptWalletPayload(envelope, 'correct horse battery staple')).toEqual(
      SENSITIVE_PAYLOAD
    );
  });

  it('fails closed with redacted errors for a wrong passphrase', () => {
    const envelope = encryptWalletPayload(SENSITIVE_PAYLOAD, 'correct horse battery staple', {
      ...METADATA,
    });

    expectRedactedFailure(() => decryptWalletPayload(envelope, 'wrong passphrase'));
  });

  it('fails closed when ciphertext, auth tag, or clear authenticated metadata is tampered', () => {
    const envelope = encryptWalletPayload(SENSITIVE_PAYLOAD, 'correct horse battery staple', {
      ...METADATA,
    });

    expectRedactedFailure(() =>
      decryptWalletPayload(
        {
          ...envelope,
          encryptedPayload: `${envelope.encryptedPayload.slice(0, -2)}AA`,
        },
        'correct horse battery staple'
      )
    );
    expectRedactedFailure(() =>
      decryptWalletPayload(
        {
          ...envelope,
          cipher: { ...envelope.cipher, authTag: `${envelope.cipher.authTag.slice(0, -2)}AA` },
        },
        'correct horse battery staple'
      )
    );
    expectRedactedFailure(() =>
      decryptWalletPayload(
        {
          ...envelope,
          evidenceIndex: [{ ref: 'datapoint:snapshot:tampered', hash: 'sha256-test-hash' }],
        },
        'correct horse battery staple'
      )
    );
  });

  it('fails closed for unsupported version and malformed KDF metadata', () => {
    const envelope = encryptWalletPayload(SENSITIVE_PAYLOAD, 'correct horse battery staple', {
      ...METADATA,
    });

    expectRedactedFailure(() =>
      decryptWalletPayload({ ...envelope, version: 999 }, 'correct horse battery staple')
    );
    expectRedactedFailure(() =>
      decryptWalletPayload(
        {
          ...envelope,
          keyDerivation: { ...envelope.keyDerivation, algorithm: 'pbkdf2' },
        },
        'correct horse battery staple'
      )
    );
    expectRedactedFailure(() =>
      decryptWalletPayload(
        {
          ...envelope,
          keyDerivation: { ...envelope.keyDerivation, salt: 'not-base64' },
        },
        'correct horse battery staple'
      )
    );
  });

  it('rotates passphrase with fresh encryption metadata and preserves public identity', () => {
    const envelope = encryptWalletPayload(SENSITIVE_PAYLOAD, 'correct horse battery staple', {
      ...METADATA,
      now: '2026-06-28T15:00:00.000Z',
    });
    const rotated = rotateWalletPassphrase(
      envelope,
      'correct horse battery staple',
      'new correct horse battery',
      { now: '2026-06-28T15:30:00.000Z' }
    );

    expect(rotated.walletId).toBe(envelope.walletId);
    expect(rotated.createdAt).toBe(envelope.createdAt);
    expect(rotated.updatedAt).toBe('2026-06-28T15:30:00.000Z');
    expect(rotated.publicVerificationKeys).toEqual(envelope.publicVerificationKeys);
    expect(rotated.evidenceIndex).toEqual(envelope.evidenceIndex);
    expect(rotated.provenanceRefs).toEqual(envelope.provenanceRefs);
    expect(rotated.keyDerivation.salt).not.toBe(envelope.keyDerivation.salt);
    expect(rotated.cipher.iv).not.toBe(envelope.cipher.iv);
    expect(rotated.encryptedPayload).not.toBe(envelope.encryptedPayload);
    expect(decryptWalletPayload(rotated, 'new correct horse battery')).toEqual(SENSITIVE_PAYLOAD);
    expectRedactedFailure(() => decryptWalletPayload(rotated, 'correct horse battery staple'));
  });

  it('creates deterministic public-key fingerprints', () => {
    expect(fingerprintPublicKey('synthetic-public-key-1')).toMatch(/^sha256:[a-f0-9]{64}$/);
    expect(fingerprintPublicKey('synthetic-public-key-1')).toBe(
      fingerprintPublicKey('synthetic-public-key-1')
    );
    expect(() => fingerprintPublicKey('')).toThrow(WalletCryptoError);
  });
});
