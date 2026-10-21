'use strict';
const { fail } = require('./errors');
const v = require('./values');
const { namespace } = require('./builtins');
function graphApi(state, read) {
  const nodes = state.graph.filter((record) => record.recordType === 'node');
  const edges = state.graph.filter((record) => record.recordType === 'edge');
  const byId = new Map(nodes.map((node) => [node.nodeId, node]));
  const nodeFor = (id) => {
    if (!byId.has(id)) fail('CONTAINER_VIOLATION', 'Node outside project');
    return byId.get(id);
  };
  const project = (node) =>
    node.kind === 'external' ? { nodeId: node.nodeId, kind: node.kind, ref: node.ref } : node;
  const neighbors = (id, options = {}, relations) => {
    nodeFor(id);
    const depth = options.depth ?? 1;
    if (!Number.isInteger(depth) || depth < 1 || depth > 3)
      fail('CONTAINER_VIOLATION', 'Invalid graph depth');
    const visited = new Set([id]),
      foundEdges = new Set();
    let frontier = [id];
    for (let level = 0; level < depth; level++) {
      const next = [];
      for (const current of frontier)
        for (const edge of edges) {
          state.budget.tick();
          if (!relations.includes(edge.relation) || (edge.from !== current && edge.to !== current))
            continue;
          nodeFor(edge.from);
          nodeFor(edge.to);
          foundEdges.add(edge);
          const target = edge.from === current ? edge.to : edge.from;
          if (!visited.has(target)) {
            visited.add(target);
            next.push(target);
          }
        }
      frontier = next;
    }
    return { nodes: [...visited].map((key) => project(byId.get(key))), edges: [...foundEdges] };
  };
  return {
    nodeFor,
    api: namespace({
      nodes: read(
        'graph.nodes',
        ([options = {}]) => {
          const limit = options.limit ?? 100;
          if (!Number.isSafeInteger(limit) || limit < 1 || limit > 1000)
            fail('RUNTIME_ERROR', 'Invalid graph limit');
          return nodes
            .filter(
              (node) =>
                (!options.kind || node.kind === options.kind) &&
                (!options.label || node.labels?.includes(options.label))
            )
            .slice(0, limit)
            .map(project);
        },
        'graphAccesses'
      ),
      neighbors: read(
        'graph.neighbors',
        ([id, options = {}]) =>
          neighbors(id, options, options.relation ? [options.relation] : state.relations),
        'graphAccesses'
      ),
      attribute: read(
        'graph.attribute',
        async ([alias, field]) => {
          const labeled = nodes.filter(
            (node) => node.nodeId === alias || node.labels?.includes(alias)
          );
          const matches = labeled.length
            ? labeled
            : nodes.filter(
                (node) =>
                  node.kind === 'dataset' &&
                  state.datasets
                    .find((dataset) => dataset.id === node.ref)
                    ?.columns.some((column) => column.name === alias)
              );
          if (!matches.length) fail('CONTAINER_VIOLATION', 'Unknown graph alias');
          const resolved = neighbors(matches[0].nodeId, { depth: 3 }, ['sameEntity', 'joinsOn']);
          if (matches.some((node) => !resolved.nodes.some((entry) => entry.nodeId === node.nodeId)))
            fail('CONTAINER_VIOLATION', 'Ambiguous graph alias');
          const values = v.record();
          const datasets = resolved.nodes.filter((node) => node.kind === 'dataset');
          for (const node of datasets) {
            const dataset = state.datasets.find((item) => item.id === node.ref);
            if (
              !dataset ||
              !dataset.columns.some((column) => column.name === alias) ||
              !dataset.columns.some((column) => column.name === field)
            )
              continue;
            const handle = state.tables.get(dataset.id);
            const col = v.capabilities.get(handle.col).fn;
            const rows = await state.sql(
              ['SELECT ', ' AS k, ', ' AS v FROM ', ''],
              [col([alias]), col([field]), handle]
            );
            for (const row of rows) {
              const key = v.keyOf(row.k);
              if (Object.hasOwn(values, key) && values[key] !== row.v)
                fail('RUNTIME_ERROR', 'Ambiguous graph attribute');
              values[key] = row.v;
            }
          }
          if (!Object.keys(values).length) fail('RUNTIME_ERROR', 'No linked attribute data');
          return values;
        },
        'graphAccesses'
      ),
    }),
  };
}
module.exports = { graphApi };
