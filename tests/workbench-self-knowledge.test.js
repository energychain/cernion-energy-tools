'use strict';
jest.mock('../src/workbench-document', () => ({ loadDocuments: jest.fn() }));
const { loadDocuments } = require('../src/workbench-document');
const { searchKnowledge, searchSummary } = require('../src/workbench-self-knowledge');
const p = {
  tenantId: 'synthetic-tenant',
  actorId: 'person-a',
  roles: ['ROLE_ALPHA'],
  clearance: [],
};
function setup() {
  const state = {
    tenantId: p.tenantId,
    actorId: p.actorId,
    cetCaseId: 'case-a',
    sensitivityFlags: [],
  };
  const router = {
    visibleStates: jest.fn(async () => [state]),
    readCaseSummary: jest.fn(async () => ({ summary: 'Projekt System X' })),
  };
  const service = { store: { caseDisplayRef: jest.fn(async () => 'F-1') } };
  const fact = {
    id: 'fact-a',
    tenantId: p.tenantId,
    status: 'valid',
    text: 'System X wird im Projekt eingesetzt.',
    person: { actorId: 'person-a', name: 'Person A', functionLabel: 'Team A' },
    createdAt: '2026-01-01',
    relationIds: [],
    anchors: [],
  };
  const ctx = {
    broker: { getLocalService: (name) => (name === 'domain-router' ? router : {}) },
    call: jest.fn(async (name) =>
      name === 'object-store.query'
        ? { docs: [{ payload: fact }] }
        : [{ title: 'System X Datensatz', tenantId: p.tenantId }]
    ),
  };
  loadDocuments.mockResolvedValue([
    { name: 'System X Leitfaden', text: 'System X ist ein synthetisches System.' },
  ]);
  return { service, ctx, router };
}
test('searches all four stores using existing tenant-scoped reads and reports results', async () => {
  const { service, ctx, router } = setup();
  const result = await searchKnowledge(service, ctx, p, {
    selfKnowledge: { query: 'System X' },
    retrievalTerms: ['System X'],
  });
  expect(result.trace).toHaveLength(4);
  expect(result.trace.every((entry) => entry.hitCount === 1)).toBe(true);
  expect(router.visibleStates).toHaveBeenCalledWith(p);
  expect(loadDocuments).toHaveBeenCalledWith(service.store, { ...p, caseId: 'case-a' });
  expect(ctx.call).toHaveBeenCalledWith('datapoint.datasetCatalog', { operation: 'list' });
  expect(result.evidence.map((hit) => hit.retrievalSource).sort()).toEqual([
    'cases',
    'datasets',
    'documents',
    'tenant-memory',
  ]);
  expect(searchSummary(result.trace)).toContain('Tenant-Gedächtnis (1 Treffer)');
});
test('unavailable source is not claimed to have no matches', async () => {
  const { service, ctx } = setup();
  ctx.call.mockRejectedValue(new Error('Unavailable'));
  const result = await searchKnowledge(service, ctx, p, { selfKnowledge: { query: 'Unknown' } });
  expect(searchSummary(result.trace)).toContain('Fälle (keine Treffer)');
  expect(searchSummary(result.trace)).toContain('Tenant-Gedächtnis (gerade nicht erreichbar)');
});
test('foreign tenant cases cannot expose document contents', async () => {
  const { service, ctx, router } = setup();
  router.visibleStates.mockResolvedValue([
    { tenantId: 'foreign', actorId: 'foreign', cetCaseId: 'private' },
  ]);
  loadDocuments.mockClear();
  await searchKnowledge(service, ctx, p, { selfKnowledge: { query: 'System X' } });
  expect(loadDocuments).not.toHaveBeenCalled();
});
