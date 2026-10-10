'use strict';

const crypto = require('crypto');
const { Errors } = require('moleculer');

const SECRET_KEYS = /authorization|bearer|token|secret|password|api[_-]?key|cookie|credential/i;
const MAX_FIELD = 500;
const MAX_SNIPPET = 2000;

function mailError(message, code = 'WORKBENCH_MAIL_EVIDENCE_INVALID', status = 422, data = {}) {
  throw new Errors.MoleculerClientError(message, status, code, data);
}

function cleanString(value, field, { max = MAX_FIELD, required = false } = {}) {
  if (value === undefined || value === null || value === '') {
    if (required) mailError(`${field} required`);
    return undefined;
  }
  const text = String(value).trim();
  if (!text) {
    if (required) mailError(`${field} required`);
    return undefined;
  }
  if (SECRET_KEYS.test(field) || SECRET_KEYS.test(text) || /^bearer\s+/i.test(text)) {
    mailError(`${field} must not contain secrets`, 'WORKBENCH_MAIL_SECRET_LEAK_BLOCKED', 400);
  }
  if (text.length > max) mailError(`${field} too long`);
  return text;
}

function removeHtmlTags(value) {
  let output = '';
  let insideTag = false;
  for (const char of value) {
    if (char === '<') {
      insideTag = true;
      output += ' ';
      continue;
    }
    if (char === '>') {
      insideTag = false;
      output += ' ';
      continue;
    }
    if (!insideTag) output += char;
  }
  return output;
}

function stripMailText(value = '') {
  const raw = String(value);
  if (SECRET_KEYS.test(raw) || /^bearer\s+/i.test(raw.trim())) {
    mailError('mail snippet must not contain secrets', 'WORKBENCH_MAIL_SECRET_LEAK_BLOCKED', 400);
  }
  return removeHtmlTags(raw).replace(/\s+/g, ' ').trim().slice(0, MAX_SNIPPET);
}

function hash(value) {
  return `sha256:${crypto.createHash('sha256').update(String(value)).digest('hex')}`;
}

function safeMailAccount(account = {}) {
  return {
    mailAccountRef: account.mailAccountRef,
    tenantId: account.tenantId,
    label: account.label,
    provider: account.provider,
    driver: account.driver || 'himalaya',
    mode: account.mode || 'reference',
    folders: account.folders || ['INBOX'],
    allowedQueryPrefixes: account.allowedQueryPrefixes || [],
    enabled: account.enabled !== false,
    secretConfigured: Boolean(account.encryptedSecret?.ciphertext),
    createdAt: account.createdAt,
    updatedAt: account.updatedAt,
  };
}

function normalizeMailAccountInput(
  params = {},
  { tenantId, actorId, encryptSecret, secretFingerprint }
) {
  const mailAccountRef = cleanString(
    params.mailAccountRef || `mail_${crypto.randomUUID()}`,
    'mailAccountRef',
    { max: 120 }
  );
  const credentials = params.credentials || params.secret || params.imap || {};
  return {
    tenantId,
    actorId,
    mailAccountRef,
    label: cleanString(params.label || mailAccountRef, 'label', { required: true, max: 160 }),
    provider: cleanString(params.provider || 'imap', 'provider', { max: 80 }),
    driver: cleanString(params.driver || 'himalaya', 'driver', { max: 80 }),
    mode: cleanString(params.mode || 'reference', 'mode', { max: 40 }),
    folders: Array.isArray(params.folders)
      ? params.folders.map((folder) => cleanString(folder, 'folder', { max: 120 })).filter(Boolean)
      : ['INBOX'],
    allowedQueryPrefixes: Array.isArray(params.allowedQueryPrefixes)
      ? params.allowedQueryPrefixes
          .map((prefix) => cleanString(prefix, 'allowedQueryPrefix', { max: 120 }))
          .filter(Boolean)
      : [],
    encryptedSecret: encryptSecret(credentials),
    secretFingerprint: secretFingerprint(credentials),
    enabled: params.enabled !== false,
  };
}

function assertMailActionInput(toolClass, input = {}) {
  const mailAccountRef = cleanString(input.mailAccountRef, 'mailAccountRef', {
    required: true,
    max: 120,
  });
  const folder = cleanString(input.folder || 'INBOX', 'folder', { max: 120 }) || 'INBOX';
  if (toolClass === 'mail_search') {
    return {
      mailAccountRef,
      folder,
      query: cleanString(input.query || input.search, 'query', { required: true, max: 500 }),
      limit: Math.min(Math.max(Number(input.limit) || 10, 1), 50),
    };
  }
  if (toolClass === 'mail_read') {
    return {
      mailAccountRef,
      folder,
      messageId: cleanString(input.messageId, 'messageId', { required: true, max: 240 }),
      subject:
        cleanString(input.subject || 'Mail message', 'subject', { max: 240 }) || 'Mail message',
      sender:
        cleanString(input.sender || input.from || 'unknown', 'sender', { max: 240 }) || 'unknown',
      recipients: cleanString(input.recipients || input.to || '', 'recipients', { max: 500 }),
      date: cleanString(input.date || new Date().toISOString(), 'date', { max: 80 }),
      snippet: stripMailText(input.snippet || input.body || input.safeSummary || ''),
      threadId: cleanString(input.threadId || '', 'threadId', { max: 240 }),
    };
  }
  if (toolClass === 'mail_attachment_ref') {
    return {
      mailAccountRef,
      folder,
      messageId: cleanString(input.messageId, 'messageId', { required: true, max: 240 }),
      attachmentId: cleanString(input.attachmentId || input.fileId, 'attachmentId', {
        required: true,
        max: 240,
      }),
      fileName:
        cleanString(input.fileName || 'attachment', 'fileName', { max: 255 }) || 'attachment',
      mimeType: cleanString(input.mimeType || 'application/octet-stream', 'mimeType', { max: 120 }),
      size: cleanString(input.size || '', 'size', { max: 80 }),
    };
  }
  mailError('Unsupported mail evidence tool class', 'WORKBENCH_MAIL_TOOL_UNSUPPORTED', 400);
}

function buildMailEvidence({ tool, input = {}, account }) {
  if (!account || account.enabled === false) {
    mailError(
      'Workbench mail account not found or disabled',
      'WORKBENCH_MAIL_ACCOUNT_REQUIRED',
      404
    );
  }
  const normalized = assertMailActionInput(tool.toolClass, input);
  if (normalized.mailAccountRef !== account.mailAccountRef) {
    mailError('Mail account reference mismatch', 'WORKBENCH_MAIL_ACCOUNT_MISMATCH', 403);
  }
  const retrievedAt = new Date().toISOString();
  const baseSource = {
    mailAccountRef: account.mailAccountRef,
    folder: normalized.folder,
    retrievedAt,
  };
  if (tool.toolClass === 'mail_search') {
    return {
      evidenceType: 'mail_thread',
      sourceType: 'mail_ref',
      label: `Mail search: ${normalized.query}`.slice(0, 160),
      safeSummary: `Mail search recorded for ${normalized.query}. Results remain tenant-bound and are not injected as raw mail content.`,
      sourceRef: { ...baseSource, query: normalized.query, resultLimit: String(normalized.limit) },
      extracts: {
        query: normalized.query,
        folder: normalized.folder,
        resultLimit: normalized.limit,
      },
      provenance: { system: 'himalaya/imap', retrievalMode: 'mail_search', retrievedAt },
      sourceFingerprint: hash(
        `${account.mailAccountRef}|search|${normalized.folder}|${normalized.query}`
      ),
    };
  }
  if (tool.toolClass === 'mail_read') {
    const sourceRef = {
      ...baseSource,
      messageId: normalized.messageId,
      threadId: normalized.threadId,
      subject: normalized.subject,
      sender: normalized.sender,
      recipients: normalized.recipients,
      date: normalized.date,
    };
    return {
      evidenceType: 'mail_message',
      sourceType: 'mail_ref',
      label: normalized.subject.slice(0, 160),
      safeSummary:
        normalized.snippet || `Mail message ${normalized.messageId} attached as evidence.`,
      sourceRef,
      extracts: sourceRef,
      provenance: { system: 'himalaya/imap', retrievalMode: 'mail_read', retrievedAt },
      sourceFingerprint: hash(`${account.mailAccountRef}|message|${normalized.messageId}`),
    };
  }
  const sourceRef = {
    ...baseSource,
    messageId: normalized.messageId,
    attachmentId: normalized.attachmentId,
    fileName: normalized.fileName,
    mimeType: normalized.mimeType,
    size: normalized.size,
  };
  return {
    evidenceType: 'mail_attachment_metadata',
    sourceType: 'mail_ref',
    label: normalized.fileName.slice(0, 160),
    safeSummary: `Mail attachment metadata for ${normalized.fileName} attached as evidence. Attachment bytes are not injected into chat context.`,
    sourceRef,
    extracts: sourceRef,
    provenance: { system: 'himalaya/imap', retrievalMode: 'mail_attachment_ref', retrievedAt },
    sourceFingerprint: hash(
      `${account.mailAccountRef}|attachment|${normalized.messageId}|${normalized.attachmentId}`
    ),
  };
}

module.exports = {
  buildMailEvidence,
  normalizeMailAccountInput,
  safeMailAccount,
  assertMailActionInput,
};
