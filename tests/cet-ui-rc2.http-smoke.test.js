'use strict';

const http = require('http');
const { ServiceBroker } = require('moleculer');
const ApiService = require('../services/api.service');
const CetUiService = require('../services/cet-ui.service');
const { REFERENCE_CASE_ID } = require('../src/cet-ui-rc2/ui-gateway-adapter');

const AUTH_HEADERS = {
  Authorization: 'Bearer ck_rc2_http_smoke',
  'content-type': 'application/json',
};

async function readJson(response) {
  const text = response.body;
  try {
    return JSON.parse(text);
  } catch (_err) {
    throw new Error(`Expected JSON response but got ${response.status}: ${text.slice(0, 200)}`);
  }
}

async function expectOkJson(responseOrPromise) {
  const response = await responseOrPromise;
  const payload = await readJson(response);
  expect(response.status).toBeGreaterThanOrEqual(200);
  expect(response.status).toBeLessThan(300);
  return payload;
}

describe('CET RC2 UI real HTTP smoke', () => {
  let broker;
  let baseUrl;

  function request(relativePath, { method = 'GET', headers = {}, body } = {}) {
    return new Promise((resolve, reject) => {
      const payload = body == null ? null : String(body);
      const normalizedPath = String(relativePath || '').replace(/^\//, '');
      const url = new URL(`${baseUrl}/${normalizedPath}`);
      const req = http.request(
        url,
        {
          method,
          headers: {
            ...headers,
            ...(payload == null ? {} : { 'content-length': Buffer.byteLength(payload) }),
          },
        },
        (res) => {
          const chunks = [];
          res.on('data', (chunk) => chunks.push(chunk));
          res.on('end', () => {
            resolve({
              status: res.statusCode,
              headers: {
                get(name) {
                  return res.headers[String(name).toLowerCase()] || null;
                },
              },
              body: Buffer.concat(chunks).toString('utf8'),
            });
          });
        }
      );
      req.on('error', reject);
      if (payload != null) req.write(payload);
      req.end();
    });
  }

  beforeAll(async () => {
    broker = new ServiceBroker({ logger: false, transporter: null });
    broker.createService({
      ...ApiService,
      settings: {
        ...ApiService.settings,
        port: 0,
      },
    });
    broker.createService({
      name: 'token-manager',
      actions: {
        verify: {
          handler(ctx) {
            expect(ctx.params.token).toBe('ck_rc2_http_smoke');
            return {
              valid: true,
              tokenId: 'tok-rc2-http-smoke',
              name: 'RC2 HTTP smoke token',
              scope: 'full-access',
              scopes: ['full-access'],
              tenantId: 'rc2-stadtwerk-a',
              userId: 'user-mako-1',
            };
          },
        },
      },
    });
    broker.createService(CetUiService);
    await broker.start();

    const api = broker.getLocalService('api');
    const port = api.server.address().port;
    baseUrl = `http://127.0.0.1:${port}/api/ui/v0`;
  });

  afterAll(async () => {
    if (broker) await broker.stop();
  });

  it('serves the Vite SPA and built asset bundle over the CET API gateway', async () => {
    const appResponse = await request('/app');
    const html = appResponse.body;

    expect(appResponse.status).toBe(200);
    expect(appResponse.headers.get('content-type')).toContain('text/html');
    expect(html).toContain('<div id="root"></div>');
    const assetMatch = html.match(/assets\/[^"']+\.js/);
    expect(assetMatch).toBeTruthy();

    const assetResponse = await request(`/${assetMatch[0]}`);
    const js = assetResponse.body;
    expect(assetResponse.status).toBe(200);
    expect(assetResponse.headers.get('content-type')).toContain('application/javascript');
    expect(js).toContain('/ui/v0/session-context');
  });

  it('walks session, daily, claim, freeze, approval and evidence through HTTP only', async () => {
    const session = await expectOkJson(request('/session-context', { headers: AUTH_HEADERS }));
    expect(session.schemaVersion).toBe('rc2.ui-session-context.v1');
    expect(session.tenant.id).toBe('rc2-stadtwerk-a');
    expect(session.user.id).toBe('user-mako-1');

    const daily = await expectOkJson(request('/daily-surface', { headers: AUTH_HEADERS }));
    expect(daily.items[0].caseId).toBe(REFERENCE_CASE_ID);

    const beforeEvidence = await expectOkJson(
      request(`/cases/${REFERENCE_CASE_ID}/evidence`, { headers: AUTH_HEADERS })
    );
    expect(beforeEvidence.frozenAt || null).toBeNull();

    const claim = await expectOkJson(
      request(`/cases/${REFERENCE_CASE_ID}/claim`, {
        method: 'POST',
        headers: AUTH_HEADERS,
        body: JSON.stringify({ basisRev: 'rev-1' }),
      })
    );
    expect(claim.card.assignment.status).toBe('mir_zugewiesen');

    const freeze = await expectOkJson(
      request(`/cases/${REFERENCE_CASE_ID}/freeze`, {
        method: 'POST',
        headers: AUTH_HEADERS,
        body: JSON.stringify({ basisRev: claim.card.basisRev }),
      })
    );
    expect(freeze.card.evidenceState.status).toBe('eingefroren');

    const approval = await expectOkJson(
      request(`/cases/${REFERENCE_CASE_ID}/approval-requests`, {
        method: 'POST',
        headers: AUTH_HEADERS,
        body: JSON.stringify({
          basisRev: freeze.card.basisRev,
          roleId: 'RC2_ROLE_ABTEILUNGSLEITUNG',
        }),
      })
    );
    expect(approval.card.hitlRequests).toEqual(
      expect.arrayContaining([expect.objectContaining({ status: 'angefordert' })])
    );

    const evidence = await expectOkJson(
      request(`/cases/${REFERENCE_CASE_ID}/evidence`, { headers: AUTH_HEADERS })
    );
    expect(evidence.frozenAt).toBeTruthy();
    expect(evidence.approvalRequests).toEqual(
      expect.arrayContaining([expect.objectContaining({ status: 'angefordert' })])
    );
  });
});
