'use strict';

const crypto = require('crypto');

const ENCRYPTION_ALGO = 'aes-256-gcm';
const SIGNING_ALGO = 'sha256';

function getKeyMaterial() {
  const secret = String(process.env.WEBHOOK_SECRET_ENCRYPTION_KEY || '').trim();
  if (!secret) {
    throw new Error(
      'WEBHOOK_SECRET_ENCRYPTION_KEY is required for webhook secret encryption/decryption.'
    );
  }
  return crypto.createHash('sha256').update(secret, 'utf8').digest();
}

function encryptSecret(plainText) {
  const source = String(plainText || '');
  if (!source) return null;

  const key = getKeyMaterial();
  const iv = crypto.randomBytes(12);
  const cipher = crypto.createCipheriv(ENCRYPTION_ALGO, key, iv);

  const encrypted = Buffer.concat([cipher.update(source, 'utf8'), cipher.final()]);
  const authTag = cipher.getAuthTag();

  return [iv.toString('base64'), encrypted.toString('base64'), authTag.toString('base64')].join(
    '.'
  );
}

function decryptSecret(cipherText) {
  const value = String(cipherText || '').trim();
  if (!value) return '';

  const parts = value.split('.');
  if (parts.length !== 3) {
    throw new Error('Invalid encrypted secret format.');
  }

  const [ivB64, encryptedB64, authTagB64] = parts;
  const key = getKeyMaterial();
  const iv = Buffer.from(ivB64, 'base64');
  const encrypted = Buffer.from(encryptedB64, 'base64');
  const authTag = Buffer.from(authTagB64, 'base64');

  const decipher = crypto.createDecipheriv(ENCRYPTION_ALGO, key, iv);
  decipher.setAuthTag(authTag);

  return Buffer.concat([decipher.update(encrypted), decipher.final()]).toString('utf8');
}

function signPayload(payloadString, secret) {
  const source = String(payloadString || '');
  const key = String(secret || '');
  if (!key) return null;

  const digest = crypto.createHmac(SIGNING_ALGO, key).update(source, 'utf8').digest('hex');
  return `${SIGNING_ALGO}=${digest}`;
}

module.exports = {
  encryptSecret,
  decryptSecret,
  signPayload,
};
