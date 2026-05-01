'use strict';

/**
 * CYA Context Manager — Zwiebelmodus (v0.32.0)
 *
 * Enables iterative re-entry into the CYA pipeline. Instead of linear
 * Phase 1→4 traversal, the Context Manager tracks nested "zoom" states
 * (outer goal → focused subgraph) so that Phase 2 can request targeted
 * Phase 1 re-retrieval without restarting the whole pipeline.
 *
 * The "Zwiebelmodus" (onion mode): outer shell = overall goal context,
 * inner shells = progressively narrower subgraphs around specific nodes.
 *
 * EU AI Act Art. 12: every zoom operation is recorded in iterationLog
 * with timestamp for full audit trail.
 */

const { MoleculerError } = require('moleculer').Errors;
const { getSubgraph, queryNodes, NODE_TYPE } = require('./cya-ontology-graph');

const MAX_ITERATIONS_DEFAULT = 3;

class CyaContextManager {
  /**
   * @param {import('graphology').Graph} ontologyGraph
   * @param {number} [maxIterations=3]
   */
  constructor(ontologyGraph, maxIterations) {
    this._graph = ontologyGraph;
    this._maxIterations = maxIterations != null ? maxIterations : MAX_ITERATIONS_DEFAULT;
    this._outerContext = null;
    this._zoomStack = [];      // stack of { nodeId, radius, subGraph }
    this._iterationLog = [];
    this._zoomCounter = 0;
  }

  /**
   * Set the outer context (overall goal and focus area).
   *
   * @param {string} goal
   * @param {string|string[]} focusArea
   */
  setOuterContext(goal, focusArea) {
    this._outerContext = {
      goal: goal || null,
      focusArea: Array.isArray(focusArea) ? focusArea : (focusArea ? [focusArea] : []),
      setAt: new Date().toISOString(),
    };
    this._log('set_outer_context', null, { goal, focusArea });
  }

  /**
   * Zoom into a specific node, returning the subgraph within radius hops.
   * Throws CONTEXT_MAX_ITERATIONS if maxIterations is exceeded.
   *
   * @param {string} nodeId
   * @param {number} [radius=2]
   * @returns {import('graphology').Graph}
   */
  zoomIn(nodeId, radius) {
    const r = radius != null ? radius : 2;
    if (this._zoomCounter >= this._maxIterations) {
      throw new MoleculerError(
        `CONTEXT_MAX_ITERATIONS: max iterations (${this._maxIterations}) reached`,
        429,
        'CONTEXT_MAX_ITERATIONS',
        { nodeId, zoomCounter: this._zoomCounter }
      );
    }

    const subGraph = getSubgraph(this._graph, nodeId, r);
    this._zoomStack.push({ nodeId, radius: r, subGraph });
    this._zoomCounter++;
    this._log('zoom_in', nodeId, { radius: r, subGraphNodes: subGraph.order });

    return subGraph;
  }

  /**
   * Step back out to the previous zoom level.
   * No-op if already at the outer context level.
   */
  zoomOut() {
    const popped = this._zoomStack.pop();
    if (popped) {
      this._log('zoom_out', popped.nodeId, {});
    }
  }

  /**
   * Check whether a specific node is missing connectivity data
   * that requires a Phase 1 re-retrieval.
   * Currently: true if INSTALLATION has no outbound VERBUNDEN_MIT edge.
   *
   * @param {string} nodeId
   * @returns {boolean}
   */
  needsRetrieval(nodeId) {
    if (!this._graph.hasNode(nodeId)) return true;
    const attrs = this._graph.getNodeAttributes(nodeId);
    if (attrs.nodeType !== NODE_TYPE.INSTALLATION) return false;

    const hasNap = this._graph.outEdges(nodeId).some(e => {
      const ea = this._graph.getEdgeAttributes(e);
      return ea.edgeType === 'VERBUNDEN_MIT';
    });
    return !hasNap;
  }

  /**
   * Get focused context for LLM synthesis — only the relevant subgraph,
   * plus signals and a breadcrumb trail for keeping context.
   *
   * @param {string} nodeId
   * @returns {{ nodes: Object[], edges: Object[], breadcrumb: string[] }}
   */
  getFocusedContext(nodeId) {
    const currentGraph = this._zoomStack.length > 0
      ? this._zoomStack[this._zoomStack.length - 1].subGraph
      : this._graph;

    const nodes = [];
    currentGraph.forEachNode((id, attrs) => nodes.push({ id, attrs }));

    const edges = [];
    currentGraph.forEachEdge((edgeId, attrs, source, target) => {
      edges.push({ edgeId, source, target, attrs });
    });

    const breadcrumb = this._buildBreadcrumb(nodeId);

    return { nodes, edges, breadcrumb, nodeId };
  }

  /**
   * Return the full iteration log for audit trail.
   *
   * @returns {Array<{ operation: string, nodeId: string|null, meta: Object, timestamp: string }>}
   */
  getIterationLog() {
    return [...this._iterationLog];
  }

  // ── Persistence (v0.37.0) ─────────────────────────────────────────────

  /**
   * Serializes the current zoom-state for persistence.
   * zoomStack entries contain only nodeId strings — subGraph objects are NOT serialized.
   * @returns {{ outerContext: Object|null, currentDepth: number, breadcrumb: string[], iterationLog: Object[], maxIterations: number, zoomStack: string[] }}
   */
  serialize() {
    return {
      outerContext: this._outerContext
        ? { goal: this._outerContext.goal, focusArea: this._outerContext.focusArea }
        : null,
      currentDepth: this._zoomStack.length,
      breadcrumb: this._buildBreadcrumb(null),
      iterationLog: [...this._iterationLog],
      maxIterations: this._maxIterations,
      zoomStack: this._zoomStack.map((frame) => frame.nodeId),
    };
  }

  /**
   * Restores a CyaContextManager from a serialized state.
   * zoomStack nodeIds are reconstructed via getSubgraph (radius defaults to 2).
   * @param {Object} serialized - from serialize()
   * @param {import('graphology').Graph} ontologyGraph
   * @returns {CyaContextManager}
   */
  static deserialize(serialized, ontologyGraph) {
    if (!serialized || typeof serialized !== 'object') {
      throw new (require('moleculer').Errors.MoleculerError)(
        'Cannot deserialize null or invalid context state', 400, 'CONTEXT_DESERIALIZE_FAILED'
      );
    }
    if (!ontologyGraph) {
      throw new (require('moleculer').Errors.MoleculerError)(
        'Cannot deserialize without ontologyGraph', 400, 'CONTEXT_DESERIALIZE_FAILED'
      );
    }
    const cm = new CyaContextManager(ontologyGraph, serialized.maxIterations);
    if (serialized.outerContext) {
      cm._outerContext = { ...serialized.outerContext, setAt: new Date().toISOString() };
    }
    const zoomIds = Array.isArray(serialized.zoomStack) ? serialized.zoomStack : [];
    for (const nodeId of zoomIds) {
      try {
        const subGraph = getSubgraph(ontologyGraph, nodeId, 2);
        cm._zoomStack.push({ nodeId, radius: 2, subGraph });
        cm._zoomCounter++;
      } catch {
        // Node no longer in graph — skip silently
      }
    }
    cm._iterationLog = Array.isArray(serialized.iterationLog) ? [...serialized.iterationLog] : [];
    return cm;
  }

  /**
   * Checks whether the restored state is compatible with the current graph
   * (i.e. all persisted nodeIds still exist in the graph).
   * @param {import('graphology').Graph} ontologyGraph
   * @returns {boolean}
   */
  isCompatibleWith(ontologyGraph) {
    if (!ontologyGraph) return false;
    for (const frame of this._zoomStack) {
      if (!ontologyGraph.hasNode(frame.nodeId)) return false;
    }
    return true;
  }

  /**
   * Returns a compact state suitable for LLM prompts.
   * Contains only the last 3 iteration log entries; full iterationLog omitted.
   * @returns {{ outerContext: Object|null, currentDepth: number, breadcrumb: string[], recentIterations: Object[] }}
   */
  getCompactState() {
    return {
      outerContext: this._outerContext
        ? { goal: this._outerContext.goal, focusArea: this._outerContext.focusArea }
        : null,
      currentDepth: this._zoomStack.length,
      breadcrumb: this._buildBreadcrumb(null),
      recentIterations: this._iterationLog.slice(-3),
    };
  }

  // ── Private ───────────────────────────────────────────────────────────

  _log(operation, nodeId, meta) {
    this._iterationLog.push({
      operation,
      nodeId: nodeId || null,
      meta: meta || {},
      timestamp: new Date().toISOString(),
    });
  }

  _buildBreadcrumb(nodeId) {
    const crumbs = [];
    if (this._outerContext?.goal) {
      crumbs.push(`Ziel: ${this._outerContext.goal}`);
    }
    for (const frame of this._zoomStack) {
      const attrs = this._graph.hasNode(frame.nodeId)
        ? this._graph.getNodeAttributes(frame.nodeId)
        : {};
      const label = attrs.name || attrs.mastrNummer || frame.nodeId;
      crumbs.push(`Fokus: ${label} (r=${frame.radius})`);
    }
    if (nodeId && this._graph.hasNode(nodeId)) {
      const a = this._graph.getNodeAttributes(nodeId);
      const label = a.name || a.mastrNummer || nodeId;
      if (crumbs.length === 0 || !crumbs[crumbs.length - 1].includes(label)) {
        crumbs.push(`Knoten: ${label}`);
      }
    }
    return crumbs.length > 0 ? crumbs : ['[root]'];
  }
}

module.exports = { CyaContextManager };
