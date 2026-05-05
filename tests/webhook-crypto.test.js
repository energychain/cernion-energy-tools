'use strict';

const { encryptSecret, decryptSecret, signPayload } = require('../src/webhook-crypto');

describe('webhook-crypto', () => {
  const originalKey = process.env.WEBHOOK_SECRET_ENCRYPTION_KEY;

  beforeEach(() => {
    process.env.WEBHOOK_SECRET_ENCRYPTION_KEY = 'unit-test-webhook-encryption-key';
  });

  afterAll(() => {
    process.env.WEBHOOK_SECRET_ENCRYPTION_KEY = originalKey;
  });

  test('encrypts and decrypts webhook secret round-trip', () => {
    const encrypted = encryptSecret('super-secret');
    expect(encrypted).toBeTruthy();
    expect(encrypted).not.toContain('super-secret');

    const plain = decryptSecret(encrypted);
    expect(plain).toBe('super-secret');
  });

  test('throws when encryption key is missing', () => {
    delete process.env.WEBHOOK_SECRET_ENCRYPTION_KEY;
    expect(() => encryptSecret('x')).toThrow(/WEBHOOK_SECRET_ENCRYPTION_KEY/);
  });

  test('returns sha256 signature header format', () => {
    const signature = signPayload('{"ok":true}', 'secret');
    expect(signature).toMatch(/^sha256=[a-f0-9]{64}$/);
  });
});
