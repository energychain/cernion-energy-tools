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
  service.broker = ctx.broker;
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
  // The knowledge register (#997) and the self-improvement register (#1010) are further sources;
  // the four content stores are searched.
  const stores = result.trace.filter(
    (entry) => !['knowledge-register', 'self-improvement'].includes(entry.source)
  );
  expect(stores).toHaveLength(4);
  expect(stores.every((entry) => entry.hitCount === 1)).toBe(true);
  expect(router.visibleStates).toHaveBeenCalledWith(p);
  expect(loadDocuments).toHaveBeenCalledWith(
    service.store,
    { ...p, caseId: 'case-a' },
    { broker: ctx.broker, roles: p.roles }
  );
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

test('an unavailable case index marks the dependent document search unavailable', async () => {
  const { service, ctx, router } = setup();
  router.visibleStates.mockRejectedValue(new Error('Unavailable'));
  loadDocuments.mockClear();
  const result = await searchKnowledge(service, ctx, p, { selfKnowledge: { query: 'System X' } });
  expect(result.trace.find((entry) => entry.source === 'cases').status).toBe('unavailable');
  expect(result.trace.find((entry) => entry.source === 'documents').status).toBe('unavailable');
  expect(searchSummary(result.trace)).toContain('Dokumente (gerade nicht erreichbar)');
  expect(loadDocuments).not.toHaveBeenCalled();
});

test('"what do you know about us" lists known, disputed and open needs from the register (#997)', async () => {
  const { service, ctx } = setup();
  const needs = [
    {
      needId: 'need:a',
      label: 'Kennung A',
      state: 'answered',
      answers: [{ value: 'SYN-1', actorId: 'person-a', at: '2026-10-27T10:00:00.000Z' }],
    },
    { needId: 'need:b', label: 'Kennung B', state: 'disputed', answers: [] },
    { needId: 'need:c', label: 'Zuständigkeit C', state: 'unknown', answers: [] },
  ];
  const original = ctx.call;
  ctx.call = jest.fn(async (name, params) =>
    name === 'knowledge-needs.list' ? needs : original(name, params)
  );
  const result = await searchKnowledge(service, ctx, p, {
    selfKnowledge: { query: 'Organisation' },
    retrievalTerms: [],
  });
  const register = result.evidence
    .filter((hit) => hit.source === 'knowledge-register')
    .map((hit) => hit.value);
  expect(register).toEqual([
    'Bekannt: Kennung A = SYN-1 (Angabe von person-a, 2026-10-27)',
    'Strittig: Kennung B',
    'Noch offen (1), wichtigste: Zuständigkeit C',
  ]);
});

test('"which failures did you recognise" reports cases of the own tenant with level and status (#1010)', async () => {
  const { service, ctx } = setup();
  const caseOverview = jest.fn(async () => ({
    total: 2,
    byLevel: { A: 0, B: 1, C: 1, D: 0 },
    byStatus: { open: 1, resolved_runtime: 1 },
    latest: [
      {
        caseId: 'c1',
        level: 'C',
        status: 'open',
        count: 4,
        summary: 'Eine Quelle antwortet zu spät',
        levelReason: 'Zeitlimit im Katalog',
      },
    ],
  }));
  ctx.broker = {
    getLocalService: (name) =>
      name === 'failure-signals' ? { caseOverview } : name === 'domain-router' ? undefined : {},
  };
  const result = await searchKnowledge(service, ctx, p, {
    selfKnowledge: { query: 'Fehler' },
    retrievalTerms: [],
  });
  expect(caseOverview).toHaveBeenCalledWith(p.tenantId, expect.any(String));
  const values = result.evidence
    .filter((hit) => hit.source === 'self-improvement')
    .map((hit) => hit.value);
  expect(values[0]).toMatch(
    /^Selbst erkannte Fehlerfälle seit \d{4}-\d{2}-\d{2}: 2 \(Stufen B: 1, C: 1; offen: 1, zur Laufzeit behoben: 1\)\.$/u
  );
  expect(values[1]).toBe(
    'Fehlerfall (Stufe C, offen, 4 Signale): Eine Quelle antwortet zu spät – Zeitlimit im Katalog'
  );
  expect(searchSummary(result.trace)).toContain('Selbst erkannte Fehler (2 Treffer)');
  // An unrelated self question does not list failure cases.
  const other = await searchKnowledge(service, ctx, p, {
    selfKnowledge: { query: 'Organisation' },
    retrievalTerms: [],
  });
  expect(other.evidence.filter((hit) => hit.source === 'self-improvement')).toEqual([]);
});

test('observed failure signals without a case are reported apart from cases, never as fixed (#1026)', async () => {
  const { service, ctx } = setup();
  const caseOverview = jest.fn(async () => ({
    observedSignals: 2,
    pendingSignals: 2,
    unclassified: 0,
    total: 0,
    byLevel: { A: 0, B: 0, C: 0, D: 0 },
    byStatus: {},
    latest: [],
  }));
  ctx.broker = {
    getLocalService: (name) =>
      name === 'failure-signals' ? { caseOverview } : name === 'domain-router' ? undefined : {},
  };
  const result = await searchKnowledge(service, ctx, p, {
    selfKnowledge: { query: 'Fehler' },
    retrievalTerms: [],
  });
  const values = result.evidence
    .filter((hit) => hit.source === 'self-improvement')
    .map((hit) => hit.value);
  expect(values).toHaveLength(1);
  expect(values[0]).toMatch(
    /^Beobachtete Fehlersignale seit \d{4}-\d{2}-\d{2}: 2; noch keinem Fehlerfall zugeordnet: 2; gebündelte Fehlerfälle: 0 \(noch nicht eingestuft: 0\)\. Erkannt heißt nicht behoben oder veröffentlicht\.$/u
  );
});
