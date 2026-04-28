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
