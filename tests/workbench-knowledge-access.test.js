'use strict';

const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { knowledgeSearchText, knowledgeSourceAccess } = require('../src/workbench-knowledge-access');
const { collectEvidence } = require('../src/workbench-retrieval');
const methods = require('../services/personal-agent/methods-part-01-of-11');
const personalAgent = require('../services/personal-agent.service');

const situation = {
  concern:
    'Lieferbeginn prüfen: Max Mustermann, MaLo 99000000001, Beispielstraße 12, 12345 Musterstadt, max@example.org, +49 30 123456789',
  retrievalTerms: ['UTILMD', 'Z17', 'Lieferbeginn', 'Netzanmeldung'],
  primaryDomain: 'market_communication',
  identifiers: [
    { kind: 'MaLo', value: '99000000001' },
    { kind: 'Adresse', value: 'Beispielstraße 12' },
  ],
};
let dir, previous;
beforeEach(() => {
  previous = process.env.CERNION_TENANT_REGISTRY_FILE;
  dir = fs.mkdtempSync(path.join(os.tmpdir(), 'cet-knowledge-'));
  process.env.CERNION_TENANT_REGISTRY_FILE = path.join(dir, 'tenants.json');
});
afterEach(() => {
  if (previous === undefined) delete process.env.CERNION_TENANT_REGISTRY_FILE;
  else process.env.CERNION_TENANT_REGISTRY_FILE = previous;
  fs.rmSync(dir, { recursive: true, force: true });
});
function registry(settings) {
  fs.writeFileSync(
    process.env.CERNION_TENANT_REGISTRY_FILE,
    JSON.stringify([
      { tenantId: 'tenant-a', knowledgeSources: settings },
      { tenantId: 'tenant-b', knowledgeSources: { williMako: 'on', federated: 'on' } },
    ])
  );
}
function context() {
  return {
    meta: { apiToken: { tenantId: 'tenant-a' }, tenantId: 'tenant-b' },
    params: { question: situation.concern, domain: 'auto', maxEvidence: 5, context: { situation } },
    call: jest.fn(async (action) => {
      if (action === 'willi-mako.resolveStructure')
        return {
          success: true,
          data: {
            sources: [
              { id: 'one', title: 'Lieferbeginn', excerpt: 'UTILMD Netzanmeldung bearbeiten' },
            ],
          },
        };
      if (action === 'knowledge-rag.federatedSearch')
        return { success: true, data: { results: [] } };
      if (action === 'query.search') return { results: [] };
      if (action === 'datapoint.list') return { datapoints: [] };
      if (action === 'object-store.query') return { docs: [] };
      if (action === 'knowledge-rag.query') return { success: true, data: { results: [] } };
      throw new Error(action);
    }),
  };
}

test('compact PII-scrubbed knowledge query retains process types and removes local identities', () => {
  const query = knowledgeSearchText(situation);
  expect(query.length).toBeLessThanOrEqual(200);
  for (const value of [
    'Max',
    'Mustermann',
    '99000000001',
    'Beispielstraße',
    'Musterstadt',
    'max@example.org',
    '123456789',
    'MASKED',
  ])
    expect(query).not.toContain(value);
  expect(query).toContain('UTILMD');
  expect(query).toContain('Z17');
  expect(knowledgeSearchText({ concern: 'x'.repeat(500) }).length).toBe(200);
});

test.each(['workbench', 'facade'])(
  'mapping-free %s asks Willi with sanitized text; tenant off blocks both knowledge collectors',
  async (route) => {
    const ctx = context();
    const run = () =>
      route === 'workbench'
        ? collectEvidence(methods, ctx, { situation })
        : personalAgent.actions.askCernionAgent.handler.call(methods, ctx);
    await run();
    const calls = ctx.call.mock.calls.filter(
      ([action]) => action === 'willi-mako.resolveStructure'
    );
    expect(calls).toHaveLength(1);
    expect(calls[0][1].query).toBe(knowledgeSearchText(situation));
    expect(calls[0][1]).not.toHaveProperty('williUserId');
    registry({ williMako: 'off', federated: 'off' });
    ctx.call.mockClear();
    await run();
    expect(
      ctx.call.mock.calls.some(
        ([action]) => action.startsWith('willi-mako.') || action === 'knowledge-rag.federatedSearch'
      )
    ).toBe(false);
  }
);

test('federated search requires no mapping and obeys its independent tenant switch', async () => {
  const ctx = context();
  registry({ williMako: 'off', federated: 'on' });
  await collectEvidence(methods, ctx, { situation });
  expect(ctx.call.mock.calls.some(([action]) => action === 'knowledge-rag.federatedSearch')).toBe(
    true
  );
  expect(ctx.call.mock.calls.some(([action]) => action === 'willi-mako.resolveStructure')).toBe(
    false
  );
  const call = ctx.call.mock.calls.find(([action]) => action === 'knowledge-rag.federatedSearch');
  expect(call[1].query).toBe(knowledgeSearchText(situation));
});

test('registry failures and invalid settings disable outbound knowledge access; caller context cannot override', () => {
  registry({ williMako: 'invalid', federated: 'off' });
  expect(knowledgeSourceAccess(context())).toEqual({
    'willi-mako': false,
    'knowledge-rag-federated': false,
  });
  fs.writeFileSync(process.env.CERNION_TENANT_REGISTRY_FILE, '{bad');
  expect(knowledgeSourceAccess(context())).toEqual({
    'willi-mako': false,
    'knowledge-rag-federated': false,
  });
});

test('direct MCP-exposed knowledge actions enforce tenant off before transport', async () => {
  const ctx = context();
  ctx.params.query = situation.concern;
  registry({ williMako: 'off', federated: 'off' });
  const willi = require('../services/willi-mako.service');
  const rag = require('../services/knowledge-rag.service');
  const startFederatedSearchJob = jest.fn();
  expect(await willi.actions.search.handler(ctx)).toEqual({
    success: false,
    error: { code: 'KNOWLEDGE_SOURCE_DISABLED' },
  });
  expect(await rag.actions.federatedSearch.handler.call({ startFederatedSearchJob }, ctx)).toEqual({
    success: false,
    error: { code: 'KNOWLEDGE_SOURCE_DISABLED' },
  });
  expect(startFederatedSearchJob).not.toHaveBeenCalled();
});

test('names with umlauts and hyphens are removed; technical noun pairs remain', () => {
  expect(
    knowledgeSearchText({ concern: 'Änne Müller und Jean-Pierre Dupont fragen nach Lieferbeginn' })
  ).not.toMatch(/Änne|Müller|Jean|Dupont/);
  expect(knowledgeSearchText({ concern: 'APERAK Fehlercode Frist Marktkommunikation' })).toBe(
    'APERAK Fehlercode Frist Marktkommunikation'
  );
  expect(knowledgeSearchText({ concern: 'MaKo Prüfidentifikator 11039' })).toBe(
    'MaKo Prüfidentifikator 11039'
  );
  expect(knowledgeSearchText({ concern: 'MaLo99000000001 Lieferbeginn' })).not.toContain(
    '99000000001'
  );
});
