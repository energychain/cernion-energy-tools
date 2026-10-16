'use strict';

// Routing hints only; values for an answer still require a fresh authorized read.
function projectRoutingSources(nodes, datasets, projectId) {
  const objects = new Map(
    nodes.filter((node) => node.kind === 'object').map((node) => [node.ref, node])
  );
  const records = new Map(
    datasets
      .filter((record) => record.provenance?.projectId === projectId && record.current !== false)
      .map((record) => [record.id, record])
  );
  const entities = new Map();
  for (const node of nodes.filter((node) => node.kind === 'entity')) {
    const key = node.provenance?.objectId;
    const list = entities.get(key) || [];
    list.push(...(node.labels || []).map((name) => ({ nodeId: node.nodeId, name })));
    entities.set(key, list);
  }
  return nodes
    .filter((node) => ['dataset', 'section'].includes(node.kind))
    .map((node) => {
      const record = records.get(node.ref);
      const object = objects.get(node.provenance?.objectId);
      const anchors = entities.get(node.provenance?.objectId) || [];
      return {
        nodeId: node.nodeId,
        nodeIds: [
          ...new Set(
            [node.nodeId, object?.nodeId, ...anchors.map((item) => item.nodeId)].filter(Boolean)
          ),
        ],
        kind: node.kind,
        names: [
          ...new Set(
            [
              ...(node.labels || []),
              ...(object?.labels || []),
              record?.title,
              record?.sourceName,
            ].filter(Boolean)
          ),
        ],
        columns: (record?.columns || node.attributes?.columns || []).map(({ name, type }) => ({
          name,
          type,
        })),
        units: record?.semantic?.units || {},
        period: record?.period || node.attributes?.period,
        anchors: [
          ...(record?.semantic?.anchors || []).map((name) => ({ nodeId: node.nodeId, name })),
          ...anchors,
        ],
      };
    });
}

module.exports = { projectRoutingSources };
