'use strict';

const crypto = require('crypto');
const http = require('http');
const https = require('https');
const { URL } = require('url');
const { Errors } = require('moleculer');

const MAX_FIELD = 500;
const MAX_SUMMARY = 2000;
const SECRET_KEYS = /authorization|bearer|token|secret|password|api[_-]?key|cookie|credential/i;

function williError(message, code = 'WORKBENCH_WILLI_MAKO_INVALID', status = 422, data = {}) {
  throw new Errors.MoleculerClientError(message, status, code, data);
}

function cleanString(value, field, { max = MAX_FIELD, required = false } = {}) {
  if (value === undefined || value === null || value === '') {
    if (required) williError(`${field} required`);
    return undefined;
  }
  const text = String(value).trim();
  if (!text) {
    if (required) williError(`${field} required`);
    return undefined;
  }
  if (SECRET_KEYS.test(field) || SECRET_KEYS.test(text) || /^bearer\s+/iu.test(text)) {
    williError(
      `${field} must not contain secrets`,
      'WORKBENCH_WILLI_MAKO_SECRET_LEAK_BLOCKED',
      400
    );
  }
  if (text.length > max) williError(`${field} too long`);
  return text;
}

function safeString(value, field, options = {}) {
  return cleanString(value, field, { required: false, ...options });
}

function asArray(value) {
  return Array.isArray(value) ? value : value ? [value] : [];
}

function sanitizeSummary(value, fallback = 'Willi-MaKo diagnostic evidence attached.') {
  const text = safeString(value || fallback, 'safeSummary', { max: MAX_SUMMARY }) || fallback;
  return text.replace(/\s+/g, ' ').trim().slice(0, MAX_SUMMARY);
}

function sha256(value) {
  return `sha256:${crypto.createHash('sha256').update(String(value)).digest('hex')}`;
}

function normalizeBaseUrl(value) {
  const base = safeString(value, 'baseUrl', { max: 500 });
  if (!base) return null;
  let parsed;
  try {
    parsed = new URL(base);
  } catch (_err) {
    williError('Invalid Willi-MaKo base URL');
  }
  if (!['http:', 'https:'].includes(parsed.protocol)) {
    williError('Unsupported Willi-MaKo base URL protocol');
  }
  parsed.pathname = parsed.pathname.replace(/\/$/, '');
  return parsed;
}

function normalizeWilliLookupInput(input = {}) {
  const williMandantId = cleanString(
    input.williMandantId || input.externalOrgId,
    'williMandantId',
    {
      required: true,
      max: 240,
    }
  );
  return {
    williMandantId,
    williUserId: safeString(input.williUserId || input.externalUserId, 'williUserId', { max: 240 }),
    externalEmailNorm: safeString(input.externalEmailNorm || input.email, 'externalEmailNorm', {
      max: 320,
    })?.toLowerCase(),
    williSessionId: safeString(input.williSessionId || input.sessionId, 'williSessionId', {
      max: 240,
    }),
    limit: Math.min(Math.max(Number(input.limit) || 20, 1), 100),
  };
}

function normalizedPath(pathname) {
  return pathname.startsWith('/api/cet') ? pathname : `/api/cet${pathname}`;
}

function requestJson(url, { method = 'GET', body = null, headers = {}, timeoutMs = 8000 } = {}) {
  const client = url.protocol === 'https:' ? https : http;
  const payload = body ? Buffer.from(JSON.stringify(body)) : null;
  const requestHeaders = {
    Accept: 'application/json',
    ...(payload
      ? { 'Content-Type': 'application/json', 'Content-Length': String(payload.length) }
      : {}),
    ...headers,
  };
  return new Promise((resolve, reject) => {
    const req = client.request(
      url,
      { method, headers: requestHeaders, timeout: timeoutMs },
      (res) => {
        const chunks = [];
        let size = 0;
        res.on('data', (chunk) => {
          size += chunk.length;
          if (size > 512 * 1024) {
            req.destroy(new Error('Willi-MaKo response too large'));
            return;
          }
          chunks.push(chunk);
        });
        res.on('end', () => {
          const text = Buffer.concat(chunks).toString('utf8');
          let data = {};
          if (text) {
            try {
              data = JSON.parse(text);
            } catch (err) {
              reject(err);
              return;
            }
          }
          if (res.statusCode >= 400) {
            reject(
              new Errors.MoleculerClientError(
                data.error || data.message || 'Willi-MaKo service request failed',
                res.statusCode,
                'WORKBENCH_WILLI_MAKO_SERVICE_FAILED',
                { statusCode: res.statusCode }
              )
            );
            return;
          }
          resolve(data);
        });
      }
    );
    req.on('timeout', () => req.destroy(new Error('Willi-MaKo service timeout')));
    req.on('error', reject);
    if (payload) req.write(payload);
    req.end();
  });
}

function serviceHeaders({ method, path, body, williMandantId, secret, token }) {
  const headers = {
    'User-Agent': 'CernionWorkbenchWilliMakoConnector/1.0',
    'X-CET-Service-Tenant': williMandantId,
  };
  if (token) headers.Authorization = `Bearer ${token}`;
  if (secret) {
    const timestamp = new Date().toISOString();
    const payload = body ? JSON.stringify(body) : '';
    const signed = [method.toUpperCase(), path, payload, timestamp, williMandantId].join('\n');
    headers['X-CET-Service-Timestamp'] = timestamp;
    headers['X-CET-Service-Signature'] = crypto
      .createHmac('sha256', secret)
      .update(signed)
      .digest('hex');
  }
  return headers;
}

class WilliMakoClient {
  constructor({ baseUrl, secret, token, timeoutMs = 8000 } = {}) {
    this.baseUrl = normalizeBaseUrl(baseUrl);
    this.secret = secret || null;
    this.token = token || null;
    this.timeoutMs = timeoutMs;
  }

  get configured() {
    return Boolean(this.baseUrl && (this.secret || this.token));
  }

  async request(pathname, { method = 'GET', body = null, williMandantId } = {}) {
    if (!this.configured) {
      williError(
        'Willi-MaKo service connector is not configured',
        'WORKBENCH_WILLI_MAKO_SERVICE_UNCONFIGURED',
        503
      );
    }
    const path = normalizedPath(pathname);
    const url = new URL(`${this.baseUrl.toString().replace(/\/$/, '')}${path}`);
    const headers = serviceHeaders({
      method,
      path,
      body,
      williMandantId,
      secret: this.secret,
      token: this.token,
    });
    return requestJson(url, { method, body, headers, timeoutMs: this.timeoutMs });
  }

  sessions(input) {
    const query = new URLSearchParams();
    if (input.williUserId) query.set('williUserId', input.williUserId);
    if (input.externalEmailNorm) query.set('email', input.externalEmailNorm);
    query.set('limit', String(input.limit || 20));
    return this.request(`/tenants/${encodeURIComponent(input.williMandantId)}/sessions?${query}`, {
      williMandantId: input.williMandantId,
    });
  }

  evidenceSummary(input) {
    return this.request(`/sessions/${encodeURIComponent(input.williSessionId)}/evidence-summary`, {
      williMandantId: input.williMandantId,
    });
  }

  card(input) {
    return this.request(`/sessions/${encodeURIComponent(input.williSessionId)}/card`, {
      williMandantId: input.williMandantId,
    });
  }

  linkCase(input) {
    return this.request(`/sessions/${encodeURIComponent(input.williSessionId)}/link-cet-case`, {
      method: 'POST',
      williMandantId: input.williMandantId,
      body: {
        cetCaseId: input.cetCaseId,
        cetTenantId: input.cetTenantId,
        cetActorId: input.cetActorId,
        correlationId: input.correlationId,
      },
    });
  }
}

function safeSession(item = {}) {
  return {
    williSessionId: item.williSessionId || item.sessionId || item.id,
    williMandantId: item.williMandantId || item.mandantId || item.tenantId,
    title: safeString(item.title || item.name || 'Willi-MaKo Fallakte', 'title', { max: 240 }),
    status: safeString(item.status || 'unknown', 'status', { max: 80 }),
    updatedAt: item.updatedAt || item.lastUpdatedAt || null,
    messageTypes: asArray(item.messageTypes).slice(0, 20),
    errorCodes: asArray(item.errorCodes).slice(0, 20),
    processRefs: asArray(item.processRefs).slice(0, 20),
    sensitivityLevel: item.sensitivityLevel || 'tenant_internal',
  };
}

function safeSessionsResponse(response = {}) {
  const sourceItems = response.items || response.sessions || [];
  return {
    items: sourceItems.map((item) => safeSession(item)).filter((item) => item.williSessionId),
  };
}

function normalizeEvidenceSummary(summary = {}, fallback = {}) {
  const source = summary.evidenceSummary || summary.summary || summary;
  const williSessionId = cleanString(
    source.williSessionId || source.sessionId || fallback.williSessionId,
    'williSessionId',
    { required: true, max: 240 }
  );
  const williMandantId = cleanString(
    source.williMandantId || source.mandantId || fallback.williMandantId,
    'williMandantId',
    { required: true, max: 240 }
  );
  const messageTypes = asArray(source.messageTypes || source.messageType).slice(0, 20);
  const errorCodes = asArray(source.errorCodes || source.errorCode).slice(0, 20);
  const processRefs = asArray(source.processRefs || source.processRef).slice(0, 20);
  const maloIds = asArray(source.maloIds || source.maloId).slice(0, 20);
  const meloIds = asArray(source.meloIds || source.meloId).slice(0, 20);
  const evidenceHints = asArray(source.evidenceHints).slice(0, 20);
  const messageType = safeString(source.messageType || messageTypes[0], 'messageType', { max: 80 });
  const errorCode = safeString(source.errorCode || errorCodes[0], 'errorCode', { max: 80 });
  const safeSummary = sanitizeSummary(
    source.safeSummary || source.summaryText || source.title,
    'Willi-MaKo case evidence summary attached as supporting diagnostic evidence.'
  );
  return {
    williSessionId,
    williMandantId,
    williCaseRef: safeString(
      source.williCaseRef || source.caseRef || williSessionId,
      'williCaseRef',
      {
        max: 240,
      }
    ),
    title: safeString(source.title || 'Willi-MaKo Fallakte', 'title', { max: 240 }),
    status: safeString(source.status || 'unknown', 'status', { max: 80 }),
    safeSummary,
    messageType,
    relatedMessageType: safeString(source.relatedMessageType, 'relatedMessageType', { max: 80 }),
    messageId: safeString(source.messageId, 'messageId', { max: 240 }),
    processRef: safeString(source.processRef || processRefs[0], 'processRef', { max: 240 }),
    errorCode,
    segmentRef: safeString(source.segmentRef, 'segmentRef', { max: 240 }),
    ahbVersion: safeString(source.ahbVersion, 'ahbVersion', { max: 80 }),
    maloId: safeString(source.maloId || maloIds[0], 'maloId', { max: 240 }),
    meloId: safeString(source.meloId || meloIds[0], 'meloId', { max: 240 }),
    marketPartner: safeString(source.marketPartner, 'marketPartner', { max: 240 }),
    direction: safeString(source.direction, 'direction', { max: 80 }),
    timestamp: safeString(source.timestamp || source.updatedAt, 'timestamp', { max: 80 }),
    messageTypes,
    errorCodes,
    processRefs,
    maloIds,
    meloIds,
    evidenceHints,
    cardUrl: safeString(source.cardUrl || source.deepLink, 'cardUrl', { max: 500 }),
    sensitivityLevel: source.sensitivityLevel || 'tenant_internal',
    provenance: source.provenance || { system: 'willi.cernion.de', retrievalMode: 'reference' },
  };
}

function evidenceTypeForSummary(summary) {
  if (String(summary.errorCode || '').toUpperCase()) return 'mako_error_code_diagnosis';
  if (String(summary.messageType || '').toUpperCase() === 'APERAK') return 'aperak_message';
  if (String(summary.messageType || '').toUpperCase() === 'CONTRL') return 'contrl_message';
  if (String(summary.messageType || '').toUpperCase() === 'MSCONS') return 'mscons_message_status';
  if (String(summary.messageType || '').toUpperCase() === 'UTILMD') return 'utilmd_master_data';
  return 'mako_process_trace';
}

function routingSignalsForSummary(summary) {
  const signals = ['willi_mako_ref', 'market_communication'];
  const errorCode = String(summary.errorCode || '').toUpperCase();
  const messageType = String(summary.messageType || '').toUpperCase();
  if (messageType) signals.push(messageType.toLowerCase());
  if (errorCode) signals.push(`mako_error_${errorCode.toLowerCase()}`);
  if (errorCode === 'Z18') signals.push('aperak_z18');
  if (
    summary.maloId ||
    summary.meloId ||
    summary.evidenceHints.some((hint) => /lieferbeginn|stammdaten|malo|melo/i.test(String(hint)))
  ) {
    signals.push('market_master_data', 'master_data');
  }
  return [...new Set(signals)];
}

function buildWilliMakoEvidence(summaryInput = {}, { mapping, actorId, caseId } = {}) {
  const summary = normalizeEvidenceSummary(summaryInput, {
    williMandantId: mapping?.williMandantId,
    williSessionId: summaryInput.williSessionId,
  });
  const sourceRef = {
    williTenantRef: summary.williMandantId,
    williMandantId: summary.williMandantId,
    williSessionId: summary.williSessionId,
    williCaseRef: summary.williCaseRef,
    messageId: summary.messageId,
    processRef: summary.processRef,
    messageType: summary.messageType,
    relatedMessageType: summary.relatedMessageType,
    errorCode: summary.errorCode,
    segmentRef: summary.segmentRef,
    ahbVersion: summary.ahbVersion,
    maloId: summary.maloId,
    meloId: summary.meloId,
    marketPartner: summary.marketPartner,
    direction: summary.direction,
    timestamp: summary.timestamp,
    title: summary.title,
    status: summary.status,
    cardUrl: summary.cardUrl,
    safeSummary: summary.safeSummary,
  };
  const extracts = Object.fromEntries(Object.entries(sourceRef).filter(([, value]) => value));
  const evidenceType = evidenceTypeForSummary(summary);
  const sourceFingerprint = sha256(
    [
      mapping?.cetTenantId || '',
      caseId || '',
      summary.williMandantId,
      summary.williSessionId,
      summary.messageId || '',
      summary.processRef || '',
      summary.messageType || '',
      summary.errorCode || '',
      summary.segmentRef || '',
      summary.ahbVersion || '',
    ].join('|')
  );
  return {
    evidenceType,
    sourceType: 'willi_mako_ref',
    label:
      `${summary.title || 'Willi-MaKo Evidenz'}${summary.errorCode ? ` (${summary.errorCode})` : ''}`.slice(
        0,
        160
      ),
    safeSummary: summary.safeSummary,
    sourceRef,
    extracts,
    provenance: {
      ...(summary.provenance || {}),
      system: 'willi.cernion.de',
      retrievalMode: 'reference',
      retrievedAt: new Date().toISOString(),
      retrievedBy: 'cet-workbench',
      actorId: actorId || null,
    },
    evidenceRole: 'diagnostic_signal',
    claimStrength: 'supporting',
    readinessReviewRequired: true,
    sensitivityLevel: summary.sensitivityLevel || 'tenant_internal',
    sourceFingerprint,
    routingSignals: routingSignalsForSummary(summary),
  };
}

module.exports = {
  WilliMakoClient,
  normalizeWilliLookupInput,
  safeSessionsResponse,
  normalizeEvidenceSummary,
  buildWilliMakoEvidence,
};
