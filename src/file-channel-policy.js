'use strict';

const { Errors } = require('moleculer');
const { createHash, createHmac, timingSafeEqual } = require('node:crypto');
const { assertSensitivityAllowed } = require('./workbench-evidence');
const storeCapability = Symbol('file-channel-store');
const LINK_SECONDS = 7 * 24 * 60 * 60;
const TYPES = Object.freeze({
  pdf: 'application/pdf',
  docx: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  xlsx: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  csv: 'text/csv',
  pptx: 'application/vnd.openxmlformats-officedocument.presentationml.presentation',
  txt: 'text/plain',
  edi: 'application/edifact',
  edifact: 'application/edifact',
  eml: 'message/rfc822',
});
function fileError(message, status = 422, type = 'FILE_CHANNEL_INVALID') {
  throw new Errors.MoleculerClientError(message, status, type);
}
function fileSetting(name, fallback) {
  const value = Number(process.env[`CET_FILE_${name}`] || fallback);
  if (!Number.isSafeInteger(value) || value <= 0) throw new Error(`Invalid CET_FILE_${name}`);
  return value;
}
function signingKey() {
  const value = process.env.CET_FILE_SIGNING_KEY;
  if (!value || Buffer.byteLength(value) < 32) fileError('Dateikanal-Schlüssel fehlt.', 503);
  return value;
}
function fileId(value) {
  if (typeof value !== 'string' || !/^[a-f0-9]{64}$/.test(value))
    fileError('Ungültige Dateireferenz.');
  return value;
}
function namespace(tenantId) {
  // Object-store namespace grammar; hashing avoids both delimiter and path ambiguities.
  return `files:${createHash('sha256').update(tenantId).digest('hex')}`;
}
function guardFileStore(ctx) {
  if (
    /^files(?:_audit)?:/.test(String(ctx.params.namespace || '')) &&
    ctx.meta.fileStoreCapability !== storeCapability
  )
    fileError('Dateien sind nur über den Dateikanal zugänglich.', 403);
}
function validateFile(input) {
  const { name, contentBase64, mimeType } = input;
  if (
    typeof name !== 'string' ||
    !name ||
    name.length > 200 ||
    /[\\/\x00-\x1f\x7f]/.test(name) ||
    name === '.' ||
    name === '..'
  )
    fileError('Dateiname darf keinen Pfad oder Steuerzeichen enthalten.');
  const extension = name.split('.').at(-1).toLowerCase();
  const allowed = (process.env.CET_FILE_ALLOWED_TYPES || Object.keys(TYPES).join(','))
    .split(',')
    .map((s) => s.trim());
  if (
    !TYPES[extension] ||
    !allowed.includes(extension) ||
    (mimeType && mimeType !== TYPES[extension])
  )
    fileError(
      'Dateityp nicht erlaubt. Erlaubt: ' + allowed.filter((type) => TYPES[type]).join(', ')
    );
  const max = fileSetting('MAX_BYTES', 10 * 1024 * 1024);
  if (typeof contentBase64 !== 'string' || contentBase64.length > 4 * Math.ceil(max / 3))
    fileError(`Datei zu groß. Grenze: ${max} Bytes.`, 413, 'FILE_CHANNEL_LIMIT');
  if (contentBase64.length % 4 !== 0 || !/^[A-Za-z0-9+/]*={0,2}$/.test(contentBase64))
    fileError('Ungültige Dateikodierung.');
  const bytes = Buffer.from(contentBase64, 'base64');
  if (!bytes.length || bytes.length > max)
    fileError(`Datei leer oder zu groß. Grenze: ${max} Bytes.`, 413, 'FILE_CHANNEL_LIMIT');
  if (extension === 'pdf' && bytes.subarray(0, 5).toString() !== '%PDF-')
    fileError('Ungültige PDF-Datei.');
  if (['docx', 'xlsx', 'pptx'].includes(extension))
    require('./file-channel-extract').validateOffice(bytes, extension);
  else if (['csv', 'txt', 'eml', 'edi', 'edifact'].includes(extension)) {
    try {
      new TextDecoder('utf-8', { fatal: true }).decode(bytes);
    } catch (_error) {
      fileError('Textdateien müssen UTF-8 sein.');
    }
    if (bytes.includes(0)) fileError('Binärdaten sind kein Textdokument.');
  }
  const sensitivityLevel = input.sensitivityLevel || 'tenant_internal';
  if (!['public', 'tenant_internal', 'restricted', 'highly_sensitive'].includes(sensitivityLevel))
    fileError('Ungültige Vertraulichkeitsstufe.');
  return {
    name,
    mimeType: TYPES[extension],
    extension,
    bytes,
    size: bytes.length,
    hash: createHash('sha256').update(bytes).digest('hex'),
    sensitivityLevel,
  };
}
function authorizeFile(p, file) {
  if (file.tenantId !== p.tenantId) fileError('Datei nicht zugänglich.', 403);
  assertSensitivityAllowed(file.sensitivityLevel, p.clearance);
  for (const level of file.requiredClearance || []) assertSensitivityAllowed(level, p.clearance);
  if (file.deletedAt || file.expiresAt <= Date.now())
    fileError('Datei gelöscht oder Aufbewahrung abgelaufen.', 410);
}
function reference(file) {
  return {
    fileId: file.fileId,
    name: file.name,
    mimeType: file.mimeType,
    size: file.size,
    hash: file.hash,
  };
}
function signDownload(file, now = Date.now()) {
  const expires = Math.floor(now / 1000) + LINK_SECONDS;
  const payload = Buffer.from(
    JSON.stringify({ fileId: file.fileId, tenantId: file.tenantId, expires, version: file.version })
  ).toString('base64url');
  return {
    ticket: payload + '.' + createHmac('sha256', signingKey()).update(payload).digest('base64url'),
    expiresAt: new Date(expires * 1000).toISOString(),
  };
}
function verifyDownload(ticket, p, file, now = Date.now()) {
  if (typeof ticket !== 'string' || ticket.length > 2048)
    fileError('Ungültiger Download-Link.', 403);
  const [payload, signature, extra] = ticket.split('.');
  const expected = createHmac('sha256', signingKey())
    .update(payload || '')
    .digest();
  const actual = Buffer.from(signature || '', 'base64url');
  if (extra || actual.length !== expected.length || !timingSafeEqual(actual, expected))
    fileError('Ungültiger Download-Link.', 403);
  let value;
  try {
    value = JSON.parse(Buffer.from(payload, 'base64url').toString());
  } catch (_error) {
    fileError('Ungültiger Download-Link.', 403);
  }
  if (
    value.tenantId !== p.tenantId ||
    value.fileId !== file.fileId ||
    value.version !== file.version ||
    !Number.isSafeInteger(value.expires) ||
    value.expires <= now / 1000 ||
    value.expires > now / 1000 + LINK_SECONDS
  )
    fileError('Download-Link abgelaufen oder nicht zugänglich.', 403);
  authorizeFile(p, file);
}
module.exports = {
  TYPES,
  LINK_SECONDS,
  storeCapability,
  fileError,
  fileSetting,
  fileId,
  namespace,
  guardFileStore,
  validateFile,
  authorizeFile,
  reference,
  signDownload,
  verifyDownload,
};
