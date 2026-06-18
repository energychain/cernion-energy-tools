'use strict';

/**
 * Tests for src/cya-graph-cache.js (v0.36.0)
 *
 * Coverage: GraphCache constructor, buildKey, isStale, L1, L2, set, invalidate, getStats
 */

const Graph = require('graphology');
const {
  GraphCache,
  GRAPH_NAMESPACE,
  DEFAULT_TTL_SEC,
  L1_MAX_ENTRIES,
} = require('../src/cya-graph-cache');

// ── Helpers ──────────────────────────────────────────────────────────────────

function makeGraph(nodeCount = 2) {
  const g = new Graph({ type: 'directed' });
  for (let i = 0; i < nodeCount; i++) {
    g.addNode(`n${i}`, { type: 'INSTALLATION' });
  }
  if (nodeCount >= 2) g.addEdge('n0', 'n1', { type: 'VERBUNDEN_MIT' });
  return g;
}

function pastIso(ms) {
  return new Date(Date.now() - ms).toISOString();
}

function makeMockBrokerCall(l2Store = {}) {
  return jest.fn(async (action, params) => {
    if (action === 'object-store.put') {
      l2Store[params.key] = { payload: params.payload };
      return { ok: true };
    }
    if (action === 'object-store.get') {
      return l2Store[params.key] || null;
    }
    if (action === 'object-store.delete') {
      delete l2Store[params.key];
      return { ok: true };
    }
    return null;
  });
}

// ── Constructor ───────────────────────────────────────────────────────────────

describe('GraphCache — constructor', () => {
  test('default TTL is DEFAULT_TTL_SEC (86400)', () => {
    const c = new GraphCache();
    expect(c.ttlSeconds).toBe(DEFAULT_TTL_SEC);
    expect(DEFAULT_TTL_SEC).toBe(86400);
  });

  test('custom TTL is respected', () => {
    const c = new GraphCache({ ttlSeconds: 3600 });
    expect(c.ttlSeconds).toBe(3600);
  });

  test('L1 is empty after initialization', () => {
    const c = new GraphCache();
    expect(c.l1.size).toBe(0);
  });

  test('namespace is GRAPH_NAMESPACE', () => {
    const c = new GraphCache();
    expect(c.namespace).toBe(GRAPH_NAMESPACE);
    expect(GRAPH_NAMESPACE).toBe('cya_ontology_graphs');
  });
});

// ── buildKey ─────────────────────────────────────────────────────────────────

describe('GraphCache — buildKey', () => {
  const c = new GraphCache();

  test('standard MaStR-ID is normalized to lowercase', () => {
    expect(c.buildKey('SNB961471621746')).toBe('ontology_snb961471621746');
  });

  test('special characters are replaced with underscores', () => {
    expect(c.buildKey('STROMDAO-Netze GmbH')).toBe('ontology_stromdao_netze_gmbh');
  });

  test('dots and dashes are replaced', () => {
    expect(c.buildKey('netze-bw.de')).toBe('ontology_netze_bw_de');
  });

  test('pure lowercase alphanumeric stays unchanged (prefix only)', () => {
    expect(c.buildKey('unknown')).toBe('ontology_unknown');
  });

  test('empty string throws GRAPH_CACHE_INVALID_KEY', () => {
    expect(() => c.buildKey('')).toThrow('GRAPH_CACHE_INVALID_KEY');
  });

  test('null throws GRAPH_CACHE_INVALID_KEY', () => {
    expect(() => c.buildKey(null)).toThrow('GRAPH_CACHE_INVALID_KEY');
  });

  test('undefined throws GRAPH_CACHE_INVALID_KEY', () => {
    expect(() => c.buildKey(undefined)).toThrow('GRAPH_CACHE_INVALID_KEY');
  });

  test('number throws GRAPH_CACHE_INVALID_KEY', () => {
    expect(() => c.buildKey(12345)).toThrow('GRAPH_CACHE_INVALID_KEY');
  });
});

// ── isStale ───────────────────────────────────────────────────────────────────

describe('GraphCache — isStale', () => {
  const c = new GraphCache({ ttlSeconds: 100 });

  test('fresh entry (cachedAt = now) is not stale', () => {
    expect(c.isStale({ cachedAt: new Date().toISOString() })).toBe(false);
  });

  test('entry older than TTL is stale', () => {
    expect(c.isStale({ cachedAt: pastIso(200 * 1000) })).toBe(true);
  });

  test('entry exactly at TTL boundary is stale', () => {
    expect(c.isStale({ cachedAt: pastIso(100 * 1000 + 1) })).toBe(true);
  });

  test('null entry is stale', () => {
    expect(c.isStale(null)).toBe(true);
  });

  test('entry without cachedAt is stale', () => {
    expect(c.isStale({ graph: {} })).toBe(true);
  });
});

// ── L1 Cache ─────────────────────────────────────────────────────────────────

describe('GraphCache — L1', () => {
  test('getL1 returns graph after setL1', () => {
    const c = new GraphCache();
    const g = makeGraph(2);
    c.setL1('key1', g, g.export(), new Date().toISOString());
    expect(c.getL1('key1')).toBe(g);
  });

  test('getL1 returns null after TTL expires', () => {
    const c = new GraphCache({ ttlSeconds: 100 });
    const g = makeGraph(2);
    // Store with a past cachedAt that is beyond TTL
    c.setL1('key1', g, g.export(), pastIso(200 * 1000));
    expect(c.getL1('key1')).toBeNull();
  });

  test('getL1 with unknown key returns null', () => {
    const c = new GraphCache();
    expect(c.getL1('nonexistent')).toBeNull();
  });

  test('hitCount increments on each getL1 call', () => {
    const c = new GraphCache();
    const g = makeGraph(2);
    const cachedAt = new Date().toISOString();
    c.setL1('k', g, g.export(), cachedAt);
    c.getL1('k');
    c.getL1('k');
    c.getL1('k');
    expect(c.l1.get('k').hitCount).toBe(3);
  });

  test(`LRU eviction: ${L1_MAX_ENTRIES + 1}th entry evicts oldest`, () => {
    const c = new GraphCache();
    const graphs = [];
    for (let i = 0; i < L1_MAX_ENTRIES; i++) {
      const g = makeGraph(1);
      graphs.push(g);
      // stagger cachedAt so oldest is deterministic
      const t = new Date(Date.now() - (L1_MAX_ENTRIES - i) * 1000).toISOString();
      c.setL1(`key_${i}`, g, g.export(), t);
    }
    // L1 is now full; oldest = key_0
    const newG = makeGraph(1);
    c.setL1('key_new', newG, newG.export(), new Date().toISOString());
    expect(c.l1.size).toBe(L1_MAX_ENTRIES);
    expect(c.l1.has('key_0')).toBe(false);
    expect(c.l1.has('key_new')).toBe(true);
  });

  test('L1_MAX_ENTRIES constant is 20', () => {
    expect(L1_MAX_ENTRIES).toBe(20);
  });
});

// ── L2 Cache ─────────────────────────────────────────────────────────────────

describe('GraphCache — L2 (getL2)', () => {
  test('brokerCall is called with object-store.get', async () => {
    const c = new GraphCache();
    const brokerCall = makeMockBrokerCall();
    await c.getL2('somekey', brokerCall);
    expect(brokerCall).toHaveBeenCalledWith('object-store.get', {
      namespace: GRAPH_NAMESPACE,
      key: 'somekey',
    });
  });

  test('returns null when object-store returns null', async () => {
    const c = new GraphCache();
    const brokerCall = jest.fn().mockResolvedValue(null);
    expect(await c.getL2('k', brokerCall)).toBeNull();
  });

  test('returns null when payload is absent', async () => {
    const c = new GraphCache();
    const brokerCall = jest.fn().mockResolvedValue({ nopayload: true });
    expect(await c.getL2('k', brokerCall)).toBeNull();
  });

  test('returns null for stale L2 entry', async () => {
    const c = new GraphCache({ ttlSeconds: 10 });
    const g = makeGraph(2);
    const staleEntry = {
      serialized: g.export(),
      cachedAt: pastIso(20 * 1000),
      ttlSeconds: 10,
    };
    const brokerCall = jest.fn().mockResolvedValue({ payload: staleEntry });
    expect(await c.getL2('k', brokerCall)).toBeNull();
  });

  test('restores graph with correct order from L2', async () => {
    const c = new GraphCache();
    const g = makeGraph(3);
    const entry = {
      serialized: g.export(),
      cachedAt: new Date().toISOString(),
      ttlSeconds: 86400,
    };
    const brokerCall = jest.fn().mockResolvedValue({ payload: entry });
    const restored = await c.getL2('k', brokerCall);
    expect(restored).not.toBeNull();
    expect(restored.order).toBe(3);
  });

  test('L2 hit warms up L1 (subsequent getL1 hits)', async () => {
    const c = new GraphCache();
    const g = makeGraph(2);
    const entry = {
      serialized: g.export(),
      cachedAt: new Date().toISOString(),
      ttlSeconds: 86400,
    };
    const brokerCall = jest.fn().mockResolvedValue({ payload: entry });
    await c.getL2('warmkey', brokerCall);
    const l1hit = c.getL1('warmkey');
    expect(l1hit).not.toBeNull();
    expect(l1hit.order).toBe(2);
  });

  test('returns null and does not throw when brokerCall throws', async () => {
    const c = new GraphCache();
    const brokerCall = jest.fn().mockRejectedValue(new Error('store offline'));
    expect(await c.getL2('k', brokerCall)).toBeNull();
  });
});

// ── set ───────────────────────────────────────────────────────────────────────

describe('GraphCache — set', () => {
  test('L1 is populated synchronously after set', async () => {
    const c = new GraphCache();
    const g = makeGraph(4);
    const brokerCall = makeMockBrokerCall();
    await c.set('mykey', g, brokerCall);
    expect(c.getL1('mykey')).not.toBeNull();
  });

  test('brokerCall is called with object-store.put', async () => {
    const c = new GraphCache();
    const g = makeGraph(2);
    const brokerCall = makeMockBrokerCall();
    await c.set('mykey', g, brokerCall);
    // L2 put is fire-and-forget so we need to flush
    await new Promise((r) => setImmediate(r));
    const putCall = brokerCall.mock.calls.find(([action]) => action === 'object-store.put');
    expect(putCall).toBeDefined();
    expect(putCall[1].namespace).toBe(GRAPH_NAMESPACE);
    expect(putCall[1].key).toBe('mykey');
  });

  test('put payload contains nodes and edges in serialized', async () => {
    const c = new GraphCache();
    const g = makeGraph(2);
    const l2Store = {};
    const brokerCall = makeMockBrokerCall(l2Store);
    await c.set('mykey', g, brokerCall);
    await new Promise((r) => setImmediate(r));
    const stored = l2Store['mykey']?.payload;
    expect(stored).toBeDefined();
    expect(stored.serialized).toBeDefined();
    expect(Array.isArray(stored.serialized.nodes)).toBe(true);
    expect(stored.nodeCount).toBe(2);
  });

  test('set does not throw when brokerCall rejects', async () => {
    const c = new GraphCache();
    const g = makeGraph(2);
    const brokerCall = jest.fn().mockRejectedValue(new Error('L2 down'));
    await expect(c.set('k', g, brokerCall)).resolves.not.toThrow();
  });
});

// ── invalidate ────────────────────────────────────────────────────────────────

describe('GraphCache — invalidate', () => {
  test('L1 entry is removed', async () => {
    const c = new GraphCache();
    const g = makeGraph(2);
    c.setL1('ikey', g, g.export(), new Date().toISOString());
    expect(c.getL1('ikey')).not.toBeNull();
    await c.invalidate('ikey', jest.fn().mockResolvedValue(null));
    expect(c.getL1('ikey')).toBeNull();
  });

  test('brokerCall is invoked with object-store.delete', async () => {
    const c = new GraphCache();
    const brokerCall = jest.fn().mockResolvedValue(null);
    await c.invalidate('ikey', brokerCall);
    expect(brokerCall).toHaveBeenCalledWith('object-store.delete', {
      namespace: GRAPH_NAMESPACE,
      key: 'ikey',
    });
  });

  test('returns { key, invalidated: true }', async () => {
    const c = new GraphCache();
    const result = await c.invalidate('ikey', jest.fn().mockResolvedValue(null));
    expect(result).toEqual({ key: 'ikey', invalidated: true });
  });

  test('does not throw when object-store.delete throws (L2 may not have delete)', async () => {
    const c = new GraphCache();
    const brokerCall = jest.fn().mockRejectedValue(new Error('no delete'));
    await expect(c.invalidate('k', brokerCall)).resolves.toEqual({ key: 'k', invalidated: true });
  });
});

// ── getStats ─────────────────────────────────────────────────────────────────

describe('GraphCache — getStats', () => {
  test('empty cache: l1Entries = 0', () => {
    const c = new GraphCache();
    const stats = c.getStats();
    expect(stats.l1Entries).toBe(0);
    expect(stats.entries).toHaveLength(0);
  });

  test('l1Entries reflects number of L1 entries', () => {
    const c = new GraphCache();
    c.setL1('k1', makeGraph(2), {}, new Date().toISOString());
    c.setL1('k2', makeGraph(3), {}, new Date().toISOString());
    expect(c.getStats().l1Entries).toBe(2);
  });

  test('entries contain correct nodeCount and edgeCount', () => {
    const c = new GraphCache();
    const g = makeGraph(3); // 3 nodes, 1 edge from helper
    c.setL1('k', g, g.export(), new Date().toISOString());
    const { entries } = c.getStats();
    expect(entries[0].nodeCount).toBe(3);
    expect(entries[0].edgeCount).toBe(g.size);
  });

  test('stats include ttlSeconds and namespace', () => {
    const c = new GraphCache({ ttlSeconds: 1234 });
    const stats = c.getStats();
    expect(stats.ttlSeconds).toBe(1234);
    expect(stats.namespace).toBe(GRAPH_NAMESPACE);
  });

  test('stale flag is correct for fresh vs expired entries', () => {
    const c = new GraphCache({ ttlSeconds: 1 });
    const g = makeGraph(1);
    c.setL1('fresh', g, g.export(), new Date().toISOString());
    c.setL1('stale', g, g.export(), pastIso(5000));
    const { entries } = c.getStats();
    const freshEntry = entries.find((e) => e.key === 'fresh');
    const staleEntry = entries.find((e) => e.key === 'stale');
    expect(freshEntry.stale).toBe(false);
    expect(staleEntry.stale).toBe(true);
  });
});
