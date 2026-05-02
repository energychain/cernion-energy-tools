/**
 * Central Ontology Graph Cache — Cernion Energy Tools v0.36.0
 *
 * Two-Tier-Persistenz für den Graphology Asset-Graphen:
 *   L1: In-Memory Map (schnell, stirbt bei Prozess-Restart)
 *   L2: Object Store Namespace 'cya_ontology_graphs' (überlebt Restart)
 *
 * Cache-Key: operatorIdentifier (VNB-BDEW-Code oder MaStR-ID)
 * TTL: 86400s (24h) — MaStR-Daten ändern sich selten
 *
 * @module cya-graph-cache
 * @since v0.36.0
 */

'use strict';

const Graph = require('graphology');

const GRAPH_NAMESPACE = 'cya_ontology_graphs';
const DEFAULT_TTL_SEC = 86400; // 24h
const L1_MAX_ENTRIES = 20; // max VNBs im In-Memory-Cache

// ── L1: In-Memory ────────────────────────────────────────────────────────────

class GraphCache {
  constructor(options = {}) {
    this.ttlSeconds = options.ttlSeconds || DEFAULT_TTL_SEC;
    this.l1 = new Map(); // key → { graph, serialized, cachedAt, hitCount }
    this.namespace = GRAPH_NAMESPACE;
  }

  /**
   * Cache-Key aus Operator-Identifier bauen.
   * Normalisiert zu: lowercase, nur alphanumerisch + Unterstrich.
   *
   * @param {string} operatorIdentifier - VNB-BDEW-Code, MaStR-ID, oder Freitext
   * @returns {string} normalisierter Cache-Key
   */
  buildKey(operatorIdentifier) {
    if (!operatorIdentifier || typeof operatorIdentifier !== 'string') {
      throw new Error('GRAPH_CACHE_INVALID_KEY: operatorIdentifier required');
    }
    return `ontology_${operatorIdentifier.toLowerCase().replace(/[^a-z0-9]/g, '_')}`;
  }

  /**
   * Prüft ob ein Cache-Eintrag noch gültig ist.
   *
   * @param {object|null} entry - Cache-Eintrag mit cachedAt
   * @returns {boolean} true wenn veraltet oder leer
   */
  isStale(entry) {
    if (!entry || !entry.cachedAt) return true;
    const ageMs = Date.now() - new Date(entry.cachedAt).getTime();
    return ageMs > this.ttlSeconds * 1000;
  }

  /**
   * L1-Cache lesen (synchron, <1ms).
   *
   * @param {string} key - normalisierter Cache-Key
   * @returns {Graph|null} Graphology-Instanz oder null bei Miss/Stale
   */
  getL1(key) {
    const entry = this.l1.get(key);
    if (!entry || this.isStale(entry)) return null;
    entry.hitCount = (entry.hitCount || 0) + 1;
    return entry.graph;
  }

  /**
   * L1-Cache schreiben (synchron).
   * LRU-ähnlich: ältesten Eintrag entfernen wenn voll.
   *
   * @param {string} key       - normalisierter Cache-Key
   * @param {Graph}  graph     - Graphology-Instanz
   * @param {object} serialized - graph.export() Ergebnis
   * @param {string} cachedAt  - ISO 8601 Timestamp
   */
  setL1(key, graph, serialized, cachedAt) {
    if (this.l1.size >= L1_MAX_ENTRIES) {
      const oldest = [...this.l1.entries()].sort(
        (a, b) => new Date(a[1].cachedAt) - new Date(b[1].cachedAt)
      )[0];
      if (oldest) this.l1.delete(oldest[0]);
    }
    this.l1.set(key, { graph, serialized, cachedAt, hitCount: 0 });
  }

  /**
   * L2-Cache lesen (async, via Object Store broker call).
   * Wärmt L1 auf bei L2-Hit.
   *
   * @param {string}   key        - normalisierter Cache-Key
   * @param {Function} brokerCall - broker.call.bind(broker) oder ctx.call.bind(ctx)
   * @returns {Promise<Graph|null>} Graphology-Instanz oder null bei Miss/Fehler
   */
  async getL2(key, brokerCall) {
    try {
      const result = await brokerCall('object-store.get', {
        namespace: this.namespace,
        key,
      });
      if (!result?.payload) return null;
      const entry = result.payload;
      if (this.isStale(entry)) return null;

      // Graphology-Graph aus serialisiertem Export wiederherstellen
      const graph = new Graph({ type: 'directed' });
      graph.import(entry.serialized);

      // L1 warm-up
      this.setL1(key, graph, entry.serialized, entry.cachedAt);

      return graph;
    } catch {
      return null; // L2-Fehler → Cache-Miss, kein Crash
    }
  }

  /**
   * In beide Tiers schreiben.
   * L1 synchron, L2 non-blocking (fire-and-forget).
   *
   * @param {string}   key        - normalisierter Cache-Key
   * @param {Graph}    graph      - zu persistierender Graphology-Graph
   * @param {Function} brokerCall - broker.call.bind(broker) oder ctx.call.bind(ctx)
   * @returns {Promise<void>}
   */
  async set(key, graph, brokerCall) {
    const serialized = graph.export();
    const cachedAt = new Date().toISOString();

    // L1 synchron
    this.setL1(key, graph, serialized, cachedAt);

    // L2 async, non-blocking
    brokerCall('object-store.put', {
      namespace: this.namespace,
      key,
      payload: {
        serialized,
        cachedAt,
        nodeCount: graph.order,
        edgeCount: graph.size,
        ttlSeconds: this.ttlSeconds,
      },
    }).catch(() => null); // L2-Fehler ignorieren — L1 genügt für laufende Session
  }

  /**
   * Einen Eintrag invalidieren (beide Tiers).
   *
   * @param {string}   key        - normalisierter Cache-Key
   * @param {Function} brokerCall - broker.call.bind(broker) oder ctx.call.bind(ctx)
   * @returns {Promise<{key: string, invalidated: boolean}>}
   */
  async invalidate(key, brokerCall) {
    this.l1.delete(key);
    try {
      await brokerCall('object-store.delete', { namespace: this.namespace, key });
    } catch {
      // Object Store hat evtl. kein delete → L2-Eintrag veraltet nach TTL
    }
    return { key, invalidated: true };
  }

  /**
   * Cache-Status für alle L1-Einträge (für Monitoring/Ops).
   *
   * @returns {object} Cache-Statistiken
   */
  getStats() {
    const entries = [...this.l1.entries()].map(([key, e]) => ({
      key,
      nodeCount: e.graph?.order || 0,
      edgeCount: e.graph?.size || 0,
      cachedAt: e.cachedAt,
      hitCount: e.hitCount,
      stale: this.isStale(e),
    }));
    return {
      l1Entries: entries.length,
      ttlSeconds: this.ttlSeconds,
      namespace: this.namespace,
      entries,
    };
  }
}

// Singleton — ein Cache pro Prozess
const graphCache = new GraphCache();

module.exports = { GraphCache, graphCache, GRAPH_NAMESPACE, DEFAULT_TTL_SEC, L1_MAX_ENTRIES };
