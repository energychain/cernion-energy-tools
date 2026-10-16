'use strict';

const { createHash } = require('node:crypto');
const { setting } = require('./project-structure-policy');
const capability = Symbol('project-graph');
const VERSION = '2';
const relations = [
  'contains',
  'derivedFrom',
  'describes',
  'sameEntity',
  'joinsOn',
  'timeAligned',
  'references',
  'answeredBy',
];
const kinds = ['object', 'dataset', 'section', 'entity', 'skill', 'external'];
function identity(...parts) {
  return createHash('sha256').update(JSON.stringify(parts)).digest('hex');
}
function limits() {
  const threshold = Number(process.env.CET_PROJECT_GRAPH_THRESHOLD || 0.6);
  if (!Number.isFinite(threshold) || threshold <= 0 || threshold > 1)
    throw new Error('Invalid graph threshold');
  return {
    nodes: setting('GRAPH_MAX_NODES', 10000),
    edges: setting('GRAPH_MAX_EDGES', 30000),
    runNodes: setting('GRAPH_RUN_MAX_NODES', 10000),
    runEdges: setting('GRAPH_RUN_MAX_EDGES', 30000),
    sketch: setting('GRAPH_SKETCH_VALUES', 128),
    columns: setting('GRAPH_MAX_COLUMNS', 512),
    pairs: setting('GRAPH_MAX_PAIRS', 20000),
    candidates: setting('GRAPH_MAX_CANDIDATES', 10000),
    documentAnchors: setting('GRAPH_DOCUMENT_MAX_ANCHORS', 256),
    documentAnchorChars: setting('GRAPH_DOCUMENT_MAX_ANCHOR_CHARS', 16000),
    runAnchors: setting('GRAPH_RUN_MAX_ANCHORS', 10000),
    runAnchorChars: setting('GRAPH_RUN_MAX_ANCHOR_CHARS', 640000),
    calls: setting('GRAPH_EXTERNAL_CALLS', 12),
    samples: setting('GRAPH_EXTERNAL_SAMPLES', 3),
    timeout: setting('GRAPH_EXTERNAL_TIMEOUT_MS', 1500),
    batch: setting('GRAPH_BATCH_DOCS', 500),
    threshold,
  };
}
function sourcePending(object) {
  return (
    object.status === 'receiving' ||
    ['queued', 'processing'].includes(object.ingestState) ||
    (object.status === 'received' && ['pending', 'processing'].includes(object.extraction?.status))
  );
}
function prefix(tenantId, projectId) {
  return `project-graph:${encodeURIComponent(tenantId)}:${encodeURIComponent(projectId)}:`;
}
module.exports = { capability, VERSION, relations, kinds, identity, limits, prefix, sourcePending };
