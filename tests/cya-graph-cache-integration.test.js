'use strict';

/**
 * Integration tests: _buildOntologyLayer with Two-Tier Cache (v0.36.0)
 *
 * Tests the async _buildOntologyLayer method using the real graphCache singleton.
 * L1 is cleared before each test for isolation.
 */

const { graphCache } = require('../src/cya-graph-cache');
const { buildOntologyGraph } = require('../src/cya-ontology-graph');

// ── Fixtures ─────────────────────────────────────────────────────────────────

const VNB_A = 'Pfalzwerke Netz AG';
const VNB_B = 'TWL Netze GmbH';

function makeInstallation(mastrNr, opts = {}) {
  return {
    EinheitMastrNummer: mastrNr,
    name: opts.name || `PV ${mastrNr}`,
    Bruttoleistung: opts.leistungKw || 10,
    Netzbetreiber: opts.vnb || VNB_A,
    NetzbetreiberMastrNummer: opts.vnbId || 'SNB_PFALZ_001',
    spannungsebene: 'NS',
    technologie: 'SOLAR',
    ibJahr: 2015,
    status: 35,
  };
}

const INSTALLATIONS_A = [
  makeInstallation('SEE999952467552', { name: 'PV Hoeheinoed 1', vnb: VNB_A }),
  makeInstallation('SEE976608984557', { name: 'PV Hoeheinoed 2', vnb: VNB_A }),
  makeInstallation('SEE982890040772', { name: 'PV Hoeheinoed 3', vnb: VNB_A }),
];

const INSTALLATIONS_B = [
  makeInstallation('SEE000000000001', { name: 'PV Ludwigshafen 1', vnb: VNB_B }),
  makeInstallation('SEE000000000002', { name: 'PV Ludwigshafen 2', vnb: VNB_B }),
];

// ── Build service stub that uses the real singleton ───────────────────────────

function makeCyaStub() {
  const svcDef = require('../services/cya.service.js');
  const method = svcDef.methods._buildOntologyLayer;

  const emittedEvents = [];
  const stub = {
    logger: { warn: jest.fn(), info: jest.fn() },
    broker: {
      call: jest.fn().mockResolvedValue(null),
      emit: jest.fn((eventName, params) => {
        emittedEvents.push({ eventName, params });
      }),
    },
    _emittedEvents: emittedEvents,
  };
  stub._buildOntologyLayer = method.bind(stub);
  return stub;
}

// ── Tests ─────────────────────────────────────────────────────────────────────

describe('_buildOntologyLayer — Cache integration (v0.36.0)', () => {
  let svc;

  beforeEach(() => {
    graphCache.l1.clear();
    svc = makeCyaStub();
  });

  test('first call: Cache-Miss builds graph and populates L1', async () => {
    const retrieval = { installations: INSTALLATIONS_A, operator: VNB_A };
    await svc._buildOntologyLayer(retrieval, null, []);
    const key = graphCache.buildKey(VNB_A);
    expect(graphCache.getL1(key)).not.toBeNull();
  });

  test('first call: broker.emit cya.ontology.graph.built fires on Cache-Miss', async () => {
    const retrieval = { installations: INSTALLATIONS_A, operator: VNB_A };
    await svc._buildOntologyLayer(retrieval, null, []);
    await new Promise(r => setImmediate(r));
    const built = svc._emittedEvents.find(e => e.eventName === 'cya.ontology.graph.built');
    expect(built).toBeDefined();
    expect(built.params.nodeCount).toBeGreaterThan(0);
  });

  test('second call same operatorId: L1-Hit, no build event emitted', async () => {
    const retrieval = { installations: INSTALLATIONS_A, operator: VNB_A };
    await svc._buildOntologyLayer(retrieval, null, []);
    svc._emittedEvents.length = 0;
    await svc._buildOntologyLayer(retrieval, null, []);
    await new Promise(r => setImmediate(r));
    const built = svc._emittedEvents.find(e => e.eventName === 'cya.ontology.graph.built');
    expect(built).toBeUndefined();
  });

  test('different operatorId: separate L1 entries are created', async () => {
    await svc._buildOntologyLayer({ installations: INSTALLATIONS_A, operator: VNB_A }, null, []);
    await svc._buildOntologyLayer({ installations: INSTALLATIONS_B, operator: VNB_B }, null, []);
    expect(graphCache.getL1(graphCache.buildKey(VNB_A))).not.toBeNull();
    expect(graphCache.getL1(graphCache.buildKey(VNB_B))).not.toBeNull();
  });

  test('after invalidate: next call rebuilds and emits graph.built', async () => {
    const retrieval = { installations: INSTALLATIONS_A, operator: VNB_A };
    await svc._buildOntologyLayer(retrieval, null, []);
    const key = graphCache.buildKey(VNB_A);
    await graphCache.invalidate(key, jest.fn().mockResolvedValue(null));
    svc._emittedEvents.length = 0;
    await svc._buildOntologyLayer(retrieval, null, []);
    await new Promise(r => setImmediate(r));
    const built = svc._emittedEvents.find(e => e.eventName === 'cya.ontology.graph.built');
    expect(built).toBeDefined();
  });

  test('fallback to installations[0].Netzbetreiber when operator absent', async () => {
    const retrieval = { installations: INSTALLATIONS_A };
    await svc._buildOntologyLayer(retrieval, null, []);
    const key = graphCache.buildKey(VNB_A);
    expect(graphCache.getL1(key)).not.toBeNull();
  });

  test('operatorId="unknown" — no crash, result has graphSignals property', async () => {
    const retrieval = {
      installations: [{ EinheitMastrNummer: 'SEE111', Bruttoleistung: 10, spannungsebene: 'NS' }],
    };
    const result = await svc._buildOntologyLayer(retrieval, null, []);
    expect(result).toBeDefined();
    expect('graphSignals' in result).toBe(true);
  });

  test('empty installations: graphSignals=null, L1 untouched', async () => {
    const result = await svc._buildOntologyLayer({ installations: [], operator: VNB_A }, null, []);
    expect(result.graphSignals).toBeNull();
    expect(graphCache.l1.size).toBe(0);
  });

  test('L2 hit: L1 is warmed, no graph.built event', async () => {
    const graphForL2 = buildOntologyGraph(INSTALLATIONS_A, null);
    const l2Entry = {
      serialized: graphForL2.export(),
      cachedAt: new Date().toISOString(),
      ttlSeconds: 86400,
    };
    svc.broker.call.mockResolvedValue({ payload: l2Entry });
    const retrieval = { installations: INSTALLATIONS_A, operator: VNB_A };
    await svc._buildOntologyLayer(retrieval, null, []);
    const key = graphCache.buildKey(VNB_A);
    expect(graphCache.getL1(key)).not.toBeNull();
    const built = svc._emittedEvents.find(e => e.eventName === 'cya.ontology.graph.built');
    expect(built).toBeUndefined();
  });
});
