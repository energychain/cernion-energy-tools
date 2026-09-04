'use strict';

/**
 * gas_layer_ingest.js
 *
 * Node-side wiring helper for POST /api/znp/projects/:id/layers (commodity=gas).
 * Shells out to tools/scigrid_gas_to_znp.py to convert a SciGRID_gas CSV export
 * into a graphology-shaped JSON payload, then imports it into an in-memory
 * `graphology` Graph instance matching znp.service.js's existing shape.
 *
 * Intended call site: services/znp.service.js `layers` action handler, when
 * commodity === 'gas' and `source` resolves to a directory containing
 * SciGRID_gas nodes/edges CSVs (see README for the exact patch to apply).
 *
 * Falls back to the existing virtual-root-only graph when no source data is
 * supplied, preserving current (source-less) behaviour.
 */

const path = require('path');
const fs = require('fs');
const { execFileSync } = require('child_process');
const os = require('os');
const Graph = require('graphology');

const SCRIPT_PATH = path.join(__dirname, 'scigrid_gas_to_znp.py');

/**
 * Build a gas-layer graphology Graph from a SciGRID_gas nodes/edges CSV pair.
 *
 * @param {object} opts
 * @param {string} opts.nodesPath - path to SciGRID_gas nodes CSV
 * @param {string} opts.edgesPath - path to SciGRID_gas edges CSV
 * @param {string} opts.projectId - ZNP projectId to tag the export with
 * @param {string} [opts.rootNodeId] - node id to mark as virtual root (GAS_FEED_1)
 * @returns {{ graph: Graph, meta: object }}
 */
function buildGasGraphFromScigrid({ nodesPath, edgesPath, projectId, rootNodeId }) {
  if (!fs.existsSync(nodesPath)) {
    throw new Error(`gas ingest: nodes CSV not found: ${nodesPath}`);
  }
  if (!fs.existsSync(edgesPath)) {
    throw new Error(`gas ingest: edges CSV not found: ${edgesPath}`);
  }

  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'znp-gas-'));
  const graphOut = path.join(tmpDir, 'graph.json');
  const metaOut = path.join(tmpDir, 'meta.json');

  const args = [
    SCRIPT_PATH,
    '--nodes', nodesPath,
    '--edges', edgesPath,
    '--project-id', projectId,
    '--out', graphOut,
    '--meta-out', metaOut,
  ];
  if (rootNodeId) {
    args.push('--root-node-id', rootNodeId);
  }

  try {
    execFileSync('python3', args, { stdio: ['ignore', 'pipe', 'pipe'] });
  } catch (err) {
    const stderr = err.stderr ? err.stderr.toString() : err.message;
    throw new Error(`gas ingest: scigrid_gas_to_znp.py failed: ${stderr}`);
  }

  const graphExport = JSON.parse(fs.readFileSync(graphOut, 'utf-8'));
  const meta = JSON.parse(fs.readFileSync(metaOut, 'utf-8'));

  const graph = new Graph({ type: 'directed', multi: false });
  for (const n of graphExport.nodes) {
    graph.addNode(n.key, n.attributes);
  }
  for (const e of graphExport.edges) {
    // Real SciGRID_gas exports contain parallel pipe segments between the
    // same node pair (e.g. multiple PipeSegments records). Use mergeEdgeWithKey
    // instead of addEdgeWithKey so duplicates are tolerated (existing edge
    // attributes are merged) instead of throwing on the full-scale dataset.
    graph.mergeEdgeWithKey(e.key, e.source, e.target, e.attributes);
  }

  fs.rmSync(tmpDir, { recursive: true, force: true });

  return { graph, meta };
}

module.exports = { buildGasGraphFromScigrid };
