'use strict';

const crypto = require('crypto');
const dns = require('dns').promises;
const http = require('http');
const https = require('https');
const net = require('net');
const { URL } = require('url');
const { Errors } = require('moleculer');

const MAX_FETCH_BYTES = 512 * 1024;
const DEFAULT_TIMEOUT_MS = 8000;
const MAX_SNIPPET = 2000;
const ALLOWED_PROTOCOLS = new Set(['http:', 'https:']);
const SUPPORTED_TYPES = [
  'text/html',
  'text/plain',
  'application/xhtml+xml',
  'application/pdf',
  'application/json',
];

function webError(message, code = 'WORKBENCH_WEB_EVIDENCE_INVALID', status = 422, data = {}) {
  throw new Errors.MoleculerClientError(message, status, code, data);
}

function sha256(value) {
  return `sha256:${crypto.createHash('sha256').update(value).digest('hex')}`;
}

function normalizeUrl(rawUrl) {
  if (!rawUrl || typeof rawUrl !== 'string') webError('url required');
  let parsed;
  try {
    parsed = new URL(rawUrl.trim());
  } catch (_err) {
    webError('Invalid URL');
  }
  if (!ALLOWED_PROTOCOLS.has(parsed.protocol)) webError('Unsupported URL protocol');
  parsed.hash = '';
  return parsed;
}

function isPrivateIPv4(ip) {
  const parts = ip.split('.').map((part) => Number(part));
  if (
    parts.length !== 4 ||
    parts.some((part) => !Number.isInteger(part) || part < 0 || part > 255)
  ) {
    return true;
  }
  const [a, b] = parts;
  return (
    a === 0 ||
    a === 10 ||
    a === 127 ||
    (a === 169 && b === 254) ||
    (a === 172 && b >= 16 && b <= 31) ||
    (a === 192 && b === 168) ||
    a >= 224 ||
    (a === 100 && b >= 64 && b <= 127) ||
    (a === 192 && b === 0) ||
    (a === 192 && b === 88) ||
    (a === 198 && (b === 18 || b === 19)) ||
    (a === 203 && b === 0)
  );
}

function isPrivateIPv6(ip) {
  const value = ip.toLowerCase();
  return (
    value === '::1' ||
    value === '::' ||
    value.startsWith('fc') ||
    value.startsWith('fd') ||
    value.startsWith('fe80:') ||
    value.startsWith('ff')
  );
}

function isPrivateAddress(address) {
  const family = net.isIP(address);
  if (family === 4) return isPrivateIPv4(address);
  if (family === 6) return isPrivateIPv6(address);
  return true;
}

async function assertPublicTarget(parsedUrl, { allowPrivateNetwork = false } = {}) {
  const hostname = parsedUrl.hostname;
  if (!hostname) webError('URL hostname required');
  if (hostname === 'localhost' || hostname.endsWith('.localhost')) {
    if (!allowPrivateNetwork)
      webError('Private or local web targets are blocked', 'WORKBENCH_WEB_PRIVATE_TARGET', 403);
    return;
  }
  if (net.isIP(hostname)) {
    if (!allowPrivateNetwork && isPrivateAddress(hostname)) {
      webError('Private or local web targets are blocked', 'WORKBENCH_WEB_PRIVATE_TARGET', 403);
    }
    return;
  }
  let records = [];
  try {
    records = await dns.lookup(hostname, { all: true, verbatim: true });
  } catch (_err) {
    webError('Unable to resolve web evidence host', 'WORKBENCH_WEB_DNS_FAILED', 422);
  }
  if (!allowPrivateNetwork && records.some((record) => isPrivateAddress(record.address))) {
    webError('Private or local web targets are blocked', 'WORKBENCH_WEB_PRIVATE_TARGET', 403);
  }
}

function parseContentType(header = '') {
  return String(header).split(';')[0].trim().toLowerCase() || 'application/octet-stream';
}

function classifyEvidenceType(contentType, requestedType) {
  if (requestedType) return requestedType;
  if (contentType === 'application/pdf') return 'public_pdf_document';
  return 'public_web_page';
}

function stripHtml(value) {
  return String(value)
    .replace(/<script[\s\S]*?<\/script>/gi, ' ')
    .replace(/<style[\s\S]*?<\/style>/gi, ' ')
    .replace(/<[^>]+>/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function extractTitle(body, contentType, url) {
  if (!contentType.includes('html')) return url.hostname;
  const match = String(body).match(/<title[^>]*>([\s\S]*?)<\/title>/i);
  return stripHtml(match?.[1] || url.hostname).slice(0, 160) || url.hostname;
}

function safeSnippet(body, contentType) {
  if (contentType === 'application/pdf') return 'PDF document fetched as supporting web evidence.';
  return stripHtml(body).slice(0, MAX_SNIPPET);
}

function fetchUrl(parsedUrl, { timeoutMs = DEFAULT_TIMEOUT_MS, maxBytes = MAX_FETCH_BYTES } = {}) {
  const client = parsedUrl.protocol === 'https:' ? https : http;
  return new Promise((resolve, reject) => {
    const request = client.get(
      parsedUrl,
      {
        timeout: timeoutMs,
        headers: {
          'User-Agent': 'CernionWorkbenchWebEvidence/1.0',
          Accept: 'text/html,text/plain,application/pdf,application/json;q=0.8,*/*;q=0.1',
        },
      },
      (response) => {
        const chunks = [];
        let size = 0;
        response.on('data', (chunk) => {
          size += chunk.length;
          if (size > maxBytes) {
            request.destroy(new Error('web evidence response too large'));
            return;
          }
          chunks.push(chunk);
        });
        response.on('end', () => {
          resolve({
            statusCode: response.statusCode,
            contentType: parseContentType(response.headers['content-type']),
            body: Buffer.concat(chunks),
            finalUrl: parsedUrl.toString(),
          });
        });
      }
    );
    request.on('timeout', () => request.destroy(new Error('web evidence fetch timeout')));
    request.on('error', reject);
  });
}

async function buildWebEvidence(input = {}) {
  const parsedUrl = normalizeUrl(input.url || input.sourceUrl);
  await assertPublicTarget(parsedUrl, { allowPrivateNetwork: input.allowPrivateNetwork === true });
  let fetched;
  try {
    fetched = await fetchUrl(parsedUrl, {
      timeoutMs:
        Number(input.timeoutMs) > 0
          ? Math.min(Number(input.timeoutMs), DEFAULT_TIMEOUT_MS)
          : DEFAULT_TIMEOUT_MS,
    });
  } catch (err) {
    webError('Web evidence fetch failed', 'WORKBENCH_WEB_FETCH_FAILED', 502, {
      reason: err.message,
      url: parsedUrl.toString(),
    });
  }
  if (!fetched.statusCode || fetched.statusCode >= 400) {
    webError('Web evidence fetch returned an error status', 'WORKBENCH_WEB_FETCH_STATUS', 502, {
      statusCode: fetched.statusCode,
    });
  }
  const contentType = fetched.contentType;
  if (!SUPPORTED_TYPES.some((type) => contentType === type || contentType.startsWith(`${type};`))) {
    webError(
      'Unsupported web evidence content type',
      'WORKBENCH_WEB_UNSUPPORTED_CONTENT_TYPE',
      415,
      {
        contentType,
      }
    );
  }
  const bodyText = fetched.body.toString('utf8');
  const title = input.title || extractTitle(bodyText, contentType, parsedUrl);
  const retrievedAt = new Date().toISOString();
  const snippet = safeSnippet(bodyText, contentType);
  const hash = sha256(fetched.body);
  const evidenceType = classifyEvidenceType(contentType, input.evidenceType);
  return {
    evidenceType,
    sourceType: 'web_fetch_ref',
    label: String(input.label || title || parsedUrl.hostname).slice(0, 160),
    safeSummary: snippet,
    sourceRef: {
      url: parsedUrl.toString(),
      title: String(title).slice(0, 160),
      retrievedAt,
      contentType,
      statusCode: String(fetched.statusCode),
      fileHash: hash,
    },
    provenance: {
      system: 'cet-workbench-web-evidence',
      retrievalMode: 'web_fetch',
      retrievedAt,
    },
    sourceFingerprint: sha256(`${parsedUrl.toString()}|${hash}`),
    fileHash: hash,
    hashStatus: 'provided',
    contentType,
    retrievedAt,
    rawHtmlStored: false,
  };
}

module.exports = {
  buildWebEvidence,
  isPrivateAddress,
  normalizeUrl,
};
