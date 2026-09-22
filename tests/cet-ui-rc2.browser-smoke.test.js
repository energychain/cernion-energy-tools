'use strict';

const fs = require('fs');
const path = require('path');
const vm = require('vm');
const {
  buildReferenceUiGateway,
  buildReferenceUiGatewayContext,
  REFERENCE_CASE_ID,
} = require('../src/cet-ui-rc2/ui-gateway-adapter');
const { RC2_ROLE_IDS } = require('../src/cet-ui-rc2/fixtures/reference-tenant');

function jsonResponse(body) {
  return {
    ok: true,
    status: 200,
    statusText: 'OK',
    headers: { get: () => 'application/json' },
    async json() {
      return body;
    },
  };
}

function createFakeBrowser() {
  const gateway = buildReferenceUiGateway();
  const context = buildReferenceUiGatewayContext({
    tenantId: 'rc2-stadtwerk-a',
    userId: 'user-mako-1',
    activeRoleId: RC2_ROLE_IDS.MARKTKOMMUNIKATION,
    now: '2026-09-21T12:20:00Z',
  });
  const elements = Object.fromEntries(
    ['session', 'daily', 'case', 'evidence', 'operations'].map((id) => [id, { id, innerHTML: '' }])
  );
  let clickHandler;
  const calls = [];

  async function fetchImpl(url, options = {}) {
    calls.push({ url, options });
    const parsed = typeof url === 'string' ? url : String(url);
    const method = options.method || 'GET';
    if (method === 'GET' && parsed === '/api/ui/v0/session-context') {
      return jsonResponse(gateway.getSessionContext(context));
    }
    if (method === 'GET' && parsed === '/api/ui/v0/daily-surface') {
      return jsonResponse(gateway.getDailySurface(context));
    }
    if (method === 'GET' && parsed === `/api/ui/v0/cases/${REFERENCE_CASE_ID}`) {
      return jsonResponse(gateway.getCase(context, { caseId: REFERENCE_CASE_ID }));
    }
    if (method === 'GET' && parsed === `/api/ui/v0/cases/${REFERENCE_CASE_ID}/evidence`) {
      return jsonResponse(gateway.getEvidence(context, { caseId: REFERENCE_CASE_ID }));
    }
    if (method === 'POST' && parsed === `/api/ui/v0/cases/${REFERENCE_CASE_ID}/claim`) {
      return jsonResponse(gateway.claimCase(context, { caseId: REFERENCE_CASE_ID }));
    }
    if (method === 'POST' && parsed === `/api/ui/v0/cases/${REFERENCE_CASE_ID}/freeze`) {
      return jsonResponse(gateway.freezeCase(context, { caseId: REFERENCE_CASE_ID }));
    }
    if (method === 'POST' && parsed === `/api/ui/v0/cases/${REFERENCE_CASE_ID}/approval-requests`) {
      return jsonResponse(gateway.requestApproval(context, { caseId: REFERENCE_CASE_ID }));
    }
    if (method === 'GET' && parsed === '/api/ui/v0/operations') {
      return jsonResponse(gateway.listOperations(context));
    }
    if (method === 'POST' && parsed === '/api/ui/v0/operations/mako.case.lookup/prepare') {
      return jsonResponse(gateway.prepareOperation(context, { operationId: 'mako.case.lookup' }));
    }
    throw new Error(`Unexpected ${method} ${parsed}`);
  }

  const sandbox = {
    document: {
      getElementById(id) {
        return elements[id];
      },
      addEventListener(eventName, handler) {
        if (eventName === 'click') clickHandler = handler;
      },
    },
    fetch: fetchImpl,
    console,
  };
  vm.createContext(sandbox);
  vm.runInContext(
    fs.readFileSync(path.join(__dirname, '..', 'apps', 'cet-ui', 'src', 'main.js'), 'utf8'),
    sandbox,
    { filename: 'apps/cet-ui/src/main.js' }
  );

  return { calls, elements, clickHandler: (event) => clickHandler(event) };
}

async function flushPromises() {
  await new Promise((resolve) => setImmediate(resolve));
  await new Promise((resolve) => setImmediate(resolve));
}

describe('CET UI RC2 browser smoke', () => {
  test('static browser shell loads session, role navigation, reference flow and not-projected operation', async () => {
    const browser = createFakeBrowser();
    await flushPromises();

    expect(browser.elements.session.innerHTML).toContain('RC2 Stadtwerk A');
    expect(browser.elements.session.innerHTML).toContain('Rollenperspektive');
    expect(browser.elements.daily.innerHTML).toContain('Vorgang öffnen');
    expect(browser.elements.case.innerHTML).toContain('Artikel-ID-Änderung prüfen');
    expect(browser.elements.evidence.innerHTML).toContain('offen');

    await browser.clickHandler({
      target: { dataset: { action: 'claim', case: REFERENCE_CASE_ID } },
    });
    await flushPromises();
    expect(browser.elements.case.innerHTML).toContain('mir_zugewiesen');

    await browser.clickHandler({
      target: { dataset: { action: 'freeze', case: REFERENCE_CASE_ID } },
    });
    await flushPromises();
    expect(browser.elements.evidence.innerHTML).toContain('eingefroren');

    await browser.clickHandler({
      target: { dataset: { action: 'approval', case: REFERENCE_CASE_ID } },
    });
    await flushPromises();
    expect(browser.elements.evidence.innerHTML).toContain('angefordert');

    await browser.clickHandler({
      target: { dataset: { prepareOperation: 'mako.case.lookup' } },
    });
    await flushPromises();
    expect(browser.elements.operations.innerHTML).toContain('Nicht projiziert');
    expect(browser.calls.map((call) => call.url)).toContain('/api/ui/v0/session-context');
  });
});
