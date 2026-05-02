'use strict';

const { CyaContextManager } = require('../src/cya-context-manager');
const { buildOntologyGraph } = require('../src/cya-ontology-graph');

// ── Fixtures ──────────────────────────────────────────────────────────────────

function makeInstallation(mastrNummer, opts = {}) {
  return {
    EinheitMastrNummer: mastrNummer,
    EinheitName: opts.name || `Anlage ${mastrNummer}`,
    Bruttoleistung: opts.leistungKw || 100,
    Technologie: 'Solarenergie',
    InbetriebnahmeDatum: '2020-01-01',
    EinheitBetriebsstatus: 'InBetrieb',
    Postleitzahl: '66989',
    Gemeinde: 'Höheinöd',
    Laengengrad: 7.63,
    Breitengrad: 49.47,
    NetzbetreiberMastrNummer: 'SNB_TEST_001',
    Netzbetreiber: 'Pfalzwerke Netz AG',
    NetzanschlusspunktMastrNummer: opts.napId !== undefined ? opts.napId : 'NAP_TEST_001',
  };
}

const installations = [
  makeInstallation('SEE999952467552', { name: 'PV Höheinöd 1' }),
  makeInstallation('SEE976608984557', { name: 'PV Höheinöd 2' }),
];

const INST_ID_1 = 'INSTALLATION:SEE999952467552';
const INST_ID_2 = 'INSTALLATION:SEE976608984557';

let graph;

beforeAll(() => {
  graph = buildOntologyGraph(installations);
});

// ── serialize / deserialize ────────────────────────────────────────────────────

describe('serialize', () => {
  test('returns all required fields', () => {
    const cm = new CyaContextManager(graph);
    cm.setOuterContext('Netzkapazitätsanalyse', ['capacity']);
    const s = cm.serialize();
    expect(s).toHaveProperty('outerContext');
    expect(s).toHaveProperty('currentDepth');
    expect(s).toHaveProperty('breadcrumb');
    expect(s).toHaveProperty('iterationLog');
    expect(s).toHaveProperty('maxIterations');
    expect(s).toHaveProperty('zoomStack');
  });

  test('currentDepth equals zoomStack.length', () => {
    const cm = new CyaContextManager(graph);
    cm.setOuterContext('Test', ['grid']);
    cm.zoomIn(INST_ID_1, 1);
    const s = cm.serialize();
    expect(s.currentDepth).toBe(1);
    expect(s.zoomStack.length).toBe(1);
  });

  test('zoomStack contains nodeId strings only (not graph objects)', () => {
    const cm = new CyaContextManager(graph);
    cm.zoomIn(INST_ID_1, 1);
    const s = cm.serialize();
    expect(typeof s.zoomStack[0]).toBe('string');
    expect(s.zoomStack[0]).toBe(INST_ID_1);
  });

  test('zoomStack contains full zoomIn history after multiple zooms', () => {
    const cm = new CyaContextManager(graph, 10);
    cm.zoomIn(INST_ID_1, 1);
    cm.zoomIn(INST_ID_2, 1);
    const s = cm.serialize();
    expect(s.zoomStack).toEqual([INST_ID_1, INST_ID_2]);
  });

  test('outerContext goal and focusArea are preserved', () => {
    const cm = new CyaContextManager(graph);
    cm.setOuterContext('My Goal', ['capacity', 'redispatch']);
    const s = cm.serialize();
    expect(s.outerContext.goal).toBe('My Goal');
    expect(s.outerContext.focusArea).toEqual(['capacity', 'redispatch']);
  });
});

describe('deserialize', () => {
  test('restores outerContext correctly', () => {
    const cm = new CyaContextManager(graph);
    cm.setOuterContext('Ziel A', ['capacity']);
    const restored = CyaContextManager.deserialize(cm.serialize(), graph);
    expect(restored.serialize().outerContext.goal).toBe('Ziel A');
    expect(restored.serialize().outerContext.focusArea).toEqual(['capacity']);
  });

  test('restores currentDepth correctly', () => {
    const cm = new CyaContextManager(graph, 10);
    cm.zoomIn('SEE999952467552', 1);
    const restored = CyaContextManager.deserialize(cm.serialize(), graph);
    expect(restored.serialize().currentDepth).toBe(1);
  });

  test('throws CONTEXT_DESERIALIZE_FAILED for null input', () => {
    let err;
    try {
      CyaContextManager.deserialize(null, graph);
    } catch (e) {
      err = e;
    }
    expect(err?.type).toBe('CONTEXT_DESERIALIZE_FAILED');
  });

  test('throws CONTEXT_DESERIALIZE_FAILED for non-object input', () => {
    let err;
    try {
      CyaContextManager.deserialize('bad', graph);
    } catch (e) {
      err = e;
    }
    expect(err?.type).toBe('CONTEXT_DESERIALIZE_FAILED');
  });

  test('throws CONTEXT_DESERIALIZE_FAILED when ontologyGraph is missing', () => {
    const cm = new CyaContextManager(graph);
    let err;
    try {
      CyaContextManager.deserialize(cm.serialize(), null);
    } catch (e) {
      err = e;
    }
    expect(err?.type).toBe('CONTEXT_DESERIALIZE_FAILED');
  });

  test('serialize → deserialize → serialize is idempotent (deep equal)', () => {
    const cm = new CyaContextManager(graph, 5);
    cm.setOuterContext('Idempotenztest', ['grid', 'capacity']);
    cm.zoomIn(INST_ID_1, 1);
    const s1 = cm.serialize();
    const restored = CyaContextManager.deserialize(s1, graph);
    const s2 = restored.serialize();
    expect(s2.outerContext).toEqual(s1.outerContext);
    expect(s2.currentDepth).toBe(s1.currentDepth);
    expect(s2.zoomStack).toEqual(s1.zoomStack);
    expect(s2.maxIterations).toBe(s1.maxIterations);
  });

  test('iterationLog is restored', () => {
    const cm = new CyaContextManager(graph);
    cm.setOuterContext('Test', []);
    const s = cm.serialize();
    const restored = CyaContextManager.deserialize(s, graph);
    const log = restored.getIterationLog();
    expect(log.length).toBeGreaterThan(0);
    expect(log[0].operation).toBe('set_outer_context');
  });
});

// ── isCompatibleWith ──────────────────────────────────────────────────────────

describe('isCompatibleWith', () => {
  test('compatible when all nodeIds exist in graph', () => {
    const cm = new CyaContextManager(graph, 10);
    cm.zoomIn(INST_ID_1, 1);
    expect(cm.isCompatibleWith(graph)).toBe(true);
  });

  test('incompatible when a nodeId is no longer in graph', () => {
    // Build a second graph without INST_ID_1's installation
    const sparseGraph = buildOntologyGraph([makeInstallation('SEE976608984557')]);
    const cm = new CyaContextManager(graph, 10);
    cm.zoomIn(INST_ID_1, 1);
    expect(cm.isCompatibleWith(sparseGraph)).toBe(false);
  });

  test('empty zoomStack is always compatible', () => {
    const cm = new CyaContextManager(graph);
    const emptyGraph = buildOntologyGraph([]);
    expect(cm.isCompatibleWith(emptyGraph)).toBe(true);
  });

  test('returns false when ontologyGraph is null', () => {
    const cm = new CyaContextManager(graph);
    expect(cm.isCompatibleWith(null)).toBe(false);
  });
});

// ── getCompactState ───────────────────────────────────────────────────────────

describe('getCompactState', () => {
  test('contains outerContext and currentDepth', () => {
    const cm = new CyaContextManager(graph);
    cm.setOuterContext('Compact Test', ['grid']);
    const compact = cm.getCompactState();
    expect(compact).toHaveProperty('outerContext');
    expect(compact).toHaveProperty('currentDepth');
    expect(compact.outerContext.goal).toBe('Compact Test');
  });

  test('contains breadcrumb', () => {
    const cm = new CyaContextManager(graph);
    cm.setOuterContext('Compact', ['capacity']);
    const compact = cm.getCompactState();
    expect(Array.isArray(compact.breadcrumb)).toBe(true);
  });

  test('recentIterations contains at most 3 entries', () => {
    const cm = new CyaContextManager(graph, 10);
    cm.setOuterContext('Many ops', []);
    cm.zoomIn(INST_ID_1, 1);
    cm.zoomOut();
    cm.zoomIn(INST_ID_1, 1);
    cm.zoomOut();
    cm.zoomIn(INST_ID_1, 1);
    const compact = cm.getCompactState();
    expect(compact.recentIterations.length).toBeLessThanOrEqual(3);
  });

  test('does NOT include full iterationLog key', () => {
    const cm = new CyaContextManager(graph);
    cm.setOuterContext('Test', []);
    const compact = cm.getCompactState();
    expect(compact).not.toHaveProperty('iterationLog');
  });

  test('recentIterations are the LAST N entries from the log', () => {
    const cm = new CyaContextManager(graph, 10);
    cm.setOuterContext('Sequential', []);
    cm.zoomIn(INST_ID_1, 1);
    cm.zoomOut();
    cm.zoomIn(INST_ID_1, 1);
    const fullLog = cm.getIterationLog();
    const compact = cm.getCompactState();
    const expectedLast3 = fullLog.slice(-3);
    expect(compact.recentIterations).toEqual(expectedLast3);
  });
});

// ── _persistContextState / _restoreContextState (broker-mock) ─────────────────

describe('_persistContextState', () => {
  function makeService() {
    const puts = [];
    const service = {
      logger: { warn: jest.fn(), info: jest.fn() },
      broker: {
        call: jest.fn((action, params) => {
          if (action === 'object-store.put') {
            puts.push(params);
            return Promise.resolve({ ok: true });
          }
          return Promise.resolve(null);
        }),
      },
      // copied from cya.service.js methods body
      async _persistContextState(sessionId, contextManager) {
        if (!sessionId || !contextManager) return;
        const state = contextManager.serialize();
        this.broker
          .call('object-store.put', {
            namespace: 'cya_context_states',
            key: `ctx_${sessionId}`,
            payload: { ...state, savedAt: new Date().toISOString(), sessionId },
          })
          .catch((err) =>
            this.logger.warn('[ContextManager] persist failed (non-blocking):', err.message)
          );
      },
      async _restoreContextState(sessionId, ontologyGraph) {
        if (!sessionId || !ontologyGraph) return null;
        try {
          const result = await this.broker.call('object-store.get', {
            namespace: 'cya_context_states',
            key: `ctx_${sessionId}`,
          });
          if (!result?.payload) return null;
          const cm = CyaContextManager.deserialize(result.payload, ontologyGraph);
          if (!cm.isCompatibleWith(ontologyGraph)) {
            this.logger.info('[ContextManager] state incompatible with current graph, rebuilding');
            return null;
          }
          return cm;
        } catch {
          return null;
        }
      },
    };
    return { service, puts };
  }

  test('calls object-store.put with correct namespace and key', async () => {
    const { service, puts } = makeService();
    const cm = new CyaContextManager(graph);
    cm.setOuterContext('Test', []);
    await service._persistContextState('session123', cm);
    // fire-and-forget — wait a tick
    await new Promise((r) => setImmediate(r));
    expect(puts.length).toBe(1);
    expect(puts[0].namespace).toBe('cya_context_states');
    expect(puts[0].key).toBe('ctx_session123');
    expect(puts[0].payload.sessionId).toBe('session123');
  });

  test('null sessionId → no object-store.put call', async () => {
    const { service } = makeService();
    const cm = new CyaContextManager(graph);
    await service._persistContextState(null, cm);
    await new Promise((r) => setImmediate(r));
    expect(service.broker.call).not.toHaveBeenCalled();
  });

  test('null contextManager → no object-store.put call', async () => {
    const { service } = makeService();
    await service._persistContextState('session123', null);
    await new Promise((r) => setImmediate(r));
    expect(service.broker.call).not.toHaveBeenCalled();
  });
});

describe('_restoreContextState', () => {
  function makeServiceWithStore(storedPayload) {
    const service = {
      logger: { warn: jest.fn(), info: jest.fn() },
      broker: {
        call: jest.fn((action) => {
          if (action === 'object-store.get') {
            return Promise.resolve(storedPayload ? { payload: storedPayload } : null);
          }
          return Promise.resolve(null);
        }),
      },
      async _restoreContextState(sessionId, ontologyGraph) {
        if (!sessionId || !ontologyGraph) return null;
        try {
          const result = await this.broker.call('object-store.get', {
            namespace: 'cya_context_states',
            key: `ctx_${sessionId}`,
          });
          if (!result?.payload) return null;
          const cm = CyaContextManager.deserialize(result.payload, ontologyGraph);
          if (!cm.isCompatibleWith(ontologyGraph)) {
            this.logger.info('[ContextManager] state incompatible with current graph, rebuilding');
            return null;
          }
          return cm;
        } catch {
          return null;
        }
      },
    };
    return service;
  }

  test('returns null when object-store has no result', async () => {
    const service = makeServiceWithStore(null);
    const result = await service._restoreContextState('s1', graph);
    expect(result).toBeNull();
  });

  test('returns null when stored state is incompatible with current graph', async () => {
    // Build state that refers to a nodeId not in a sparse graph
    const cm = new CyaContextManager(graph, 10);
    cm.zoomIn('SEE999952467552', 1);
    const state = cm.serialize();
    const sparseGraph = buildOntologyGraph([makeInstallation('SEE976608984557')]);
    const service = makeServiceWithStore(state);
    const result = await service._restoreContextState('s1', sparseGraph);
    expect(result).toBeNull();
  });

  test('returns CyaContextManager for compatible state', async () => {
    const cm = new CyaContextManager(graph, 10);
    cm.setOuterContext('Test', ['capacity']);
    cm.zoomIn(INST_ID_1, 1);
    const state = cm.serialize();
    const service = makeServiceWithStore(state);
    const restored = await service._restoreContextState('s1', graph);
    expect(restored).toBeInstanceOf(CyaContextManager);
    expect(restored.serialize().outerContext.goal).toBe('Test');
  });

  test('returns null when store.get throws an error (graceful)', async () => {
    const service = {
      logger: { warn: jest.fn(), info: jest.fn() },
      broker: {
        call: jest.fn().mockRejectedValue(new Error('store unavailable')),
      },
      async _restoreContextState(sessionId, ontologyGraph) {
        if (!sessionId || !ontologyGraph) return null;
        try {
          const result = await this.broker.call('object-store.get', {
            namespace: 'cya_context_states',
            key: `ctx_${sessionId}`,
          });
          if (!result?.payload) return null;
          const restored = CyaContextManager.deserialize(result.payload, ontologyGraph);
          if (!restored.isCompatibleWith(ontologyGraph)) return null;
          return restored;
        } catch {
          return null;
        }
      },
    };
    const result = await service._restoreContextState('s1', graph);
    expect(result).toBeNull();
  });
});

// ── REST endpoint shape ────────────────────────────────────────────────────────

describe('REST endpoint simulation', () => {
  function makeCtxStateHandler(storedPayload) {
    const { MoleculerClientError } = require('moleculer').Errors;
    return async function handler(ctxParams) {
      const { id } = ctxParams;
      const result = await Promise.resolve(storedPayload ? { payload: storedPayload } : null).catch(
        () => null
      );
      if (!result?.payload) {
        throw new MoleculerClientError(
          `No context state for session '${id}'`,
          404,
          'CONTEXT_STATE_NOT_FOUND'
        );
      }
      return { sessionId: id, ...result.payload };
    };
  }

  test('throws 404 CONTEXT_STATE_NOT_FOUND when no state stored', async () => {
    const handler = makeCtxStateHandler(null);
    await expect(handler({ id: 'cya_missing' })).rejects.toMatchObject({
      code: 404,
      type: 'CONTEXT_STATE_NOT_FOUND',
    });
  });

  test('returns correct shape with sessionId when state exists', async () => {
    const cm = new CyaContextManager(graph);
    cm.setOuterContext('Shape Test', ['capacity']);
    const state = { ...cm.serialize(), savedAt: '2026-05-01T00:00:00.000Z', sessionId: 'cya_test' };
    const handler = makeCtxStateHandler(state);
    const result = await handler({ id: 'cya_test' });
    expect(result.sessionId).toBe('cya_test');
    expect(result.savedAt).toBe('2026-05-01T00:00:00.000Z');
    expect(result.outerContext.goal).toBe('Shape Test');
    expect(Array.isArray(result.zoomStack)).toBe(true);
    expect(Array.isArray(result.breadcrumb)).toBe(true);
    expect(typeof result.maxIterations).toBe('number');
  });
});
