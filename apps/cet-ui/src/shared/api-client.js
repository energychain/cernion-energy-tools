'use strict';

function normalizeApiBaseUrl(baseUrl = '') {
  const trimmed = String(baseUrl || '').replace(/\/+$/, '');
  return trimmed.endsWith('/api') ? trimmed.slice(0, -4) : trimmed;
}

function classifyApiError(error) {
  if (error instanceof TypeError || /Failed to fetch|Network/i.test(String(error?.message || ''))) {
    return 'network';
  }
  if (error?.status === 401) return 'unauthenticated';
  if (error?.status === 403) return 'forbidden';
  if (error?.status === 409) return 'conflict';
  if (error?.status === 422) return 'validation';
  return 'unknown';
}

function createApiClient({ baseUrl = '', tenantId, token, fetchImpl = globalThis.fetch } = {}) {
  if (typeof fetchImpl !== 'function') throw new Error('createApiClient requires fetchImpl');
  const normalizedBaseUrl = normalizeApiBaseUrl(baseUrl);

  async function request(path, { method = 'GET', body } = {}) {
    const headers = { Accept: 'application/json' };
    if (body !== undefined) headers['Content-Type'] = 'application/json';
    if (tenantId) headers['x-tenant-id'] = tenantId;
    if (token) headers.Authorization = `Bearer ${token}`;

    const response = await fetchImpl(`${normalizedBaseUrl}/api${path}`, {
      method,
      headers,
      ...(body !== undefined ? { body: JSON.stringify(body) } : {}),
    });

    if (!response.ok) {
      const error = new Error(`CET UI API request failed with ${response.status}`);
      error.status = response.status;
      error.kind = classifyApiError(error);
      throw error;
    }

    const contentType = response.headers?.get?.('content-type') || '';
    if (contentType.includes('application/json') || typeof response.json === 'function') {
      return response.json();
    }
    return response.text();
  }

  return {
    getSessionContext: () => request('/ui/v0/session-context'),
    getDailySurface: () => request('/ui/v0/daily-surface'),
    getToday: () => request('/ui/v0/daily-surface'),
    getCase: (id) => request(`/ui/v0/cases/${encodeURIComponent(id)}`),
    getVorgang: (id) => request(`/ui/v0/cases/${encodeURIComponent(id)}`),
    getEvidenceDossier: (id) => request(`/ui/v0/cases/${encodeURIComponent(id)}/evidence`),
    claimCase: (id, basisRev) =>
      request(`/ui/v0/cases/${encodeURIComponent(id)}/claim`, {
        method: 'POST',
        body: { basisRev },
      }),
    takeoverVorgang: (id, basisRev) =>
      request(`/ui/v0/cases/${encodeURIComponent(id)}/claim`, {
        method: 'POST',
        body: { basisRev },
      }),
    freezeCase: (id, payload) =>
      request(`/ui/v0/cases/${encodeURIComponent(id)}/freeze`, { method: 'POST', body: payload }),
    freezeVorgang: (id, payload) =>
      request(`/ui/v0/cases/${encodeURIComponent(id)}/freeze`, { method: 'POST', body: payload }),
    requestApproval: (id, payload) =>
      request(`/ui/v0/cases/${encodeURIComponent(id)}/approval-requests`, {
        method: 'POST',
        body: payload,
      }),
    listOperations: () => request('/ui/v0/operations'),
    runOperation: (operationId, payload) =>
      request(`/ui/v0/operations/${encodeURIComponent(operationId)}/prepare`, {
        method: 'POST',
        body: payload,
      }),
    recordAudit: (payload) => request('/ui/v0/audit-events', { method: 'POST', body: payload }),
  };
}

module.exports = {
  classifyApiError,
  createApiClient,
  normalizeApiBaseUrl,
};
