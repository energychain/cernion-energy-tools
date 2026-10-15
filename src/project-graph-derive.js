'use strict';
const { normalizeAnchor } = require('./tenant-memory-store');
const { identity, VERSION } = require('./project-graph-policy');
const { sketch, candidateRows } = require('./project-graph-sqlite');

// Each independent evidence kind contributes at most its cap, regardless of duplicates.
const caps = {
  overlap: 0.65,
  type: 0.15,
  cardinality: 0.15,
  anchor: 0.9,
  period: 0.7,
  interval: 0.2,
  source: 1,
  catalog: 0.35,
  observed: 0.6,
};
function weight(evidence) {
  const totals = new Map();
  for (const item of evidence)
    totals.set(
      item.kind,
      Math.max(totals.get(item.kind) || 0, Math.min(caps[item.kind] || 0, item.score))
    );
  return Math.min(
    1,
    [...totals.values()].reduce((sum, value) => sum + value, 0)
  );
}
function deriveGraph({ projectId, tenantId, objects, datasets, documents, db, limits }) {
  const nodes = new Map(),
    edges = new Map();
  const maxNodes = Math.min(limits.nodes, limits.runNodes),
    maxEdges = Math.min(limits.edges, limits.runEdges);
  let comparisons = 0;
  const node = (kind, ref, labels = [], attributes = {}, provenance = {}) => {
    const nodeId = 'n_' + identity(kind, ref);
    if (!nodes.has(nodeId)) {
      if (nodes.size >= maxNodes) throw new Error('Graph node limit exceeded');
      nodes.set(nodeId, {
        recordType: 'node',
        nodeId,
        tenantId,
        projectId,
        kind,
        ref,
        labels,
        attributes,
        provenance,
        derivation: { version: VERSION },
      });
    }
    return nodeId;
  };
  const edge = (from, to, relation, evidence, origin = 'derived') => {
    const score = weight(evidence);
    if (score < limits.threshold) return;
    const edgeId = 'e_' + identity(from, to, relation);
    if (!edges.has(edgeId) && edges.size >= maxEdges) throw new Error('Graph edge limit exceeded');
    const prior = edges.get(edgeId);
    const combined = [...(prior?.evidence || []), ...evidence];
    edges.set(edgeId, {
      recordType: 'edge',
      edgeId,
      tenantId,
      projectId,
      from,
      to,
      relation,
      evidence: combined.slice(0, 32),
      weight: weight(combined),
      origin,
      derivation: { version: VERSION },
    });
  };
  const compare = () => {
    if (++comparisons > limits.pairs) throw new Error('Graph comparison limit exceeded');
  };
  const sources = new Map(
    objects.map((object) => [
      object.objectId,
      node(
        'object',
        object.objectId,
        [object.name],
        {},
        { objectId: object.objectId, hash: object.hash }
      ),
    ])
  );
  const sourceEdges = (id, objectId) => {
    if (!sources.has(objectId)) return;
    edge(sources.get(objectId), id, 'contains', [{ kind: 'source', score: 1, objectId }]);
    edge(id, sources.get(objectId), 'derivedFrom', [{ kind: 'source', score: 1, objectId }]);
  };
  const data = datasets.map((record) => {
    const id = node(
      'dataset',
      record.id,
      [record.title || record.sourceName],
      {
        columns: record.columns,
        period: record.period,
        intervalMinutes: record.quality?.intervalMinutes,
      },
      { objectId: record.provenance.objectId, hash: record.hash, location: { sheet: record.sheet } }
    );
    sourceEdges(id, record.provenance.objectId);
    return { ...record, nodeId: id };
  });
  const sections = documents.map((record) => {
    const id = node(
      'section',
      record.id,
      [record.title || record.name],
      {},
      { objectId: record.provenance.objectId, location: record.sourceLocation }
    );
    sourceEdges(id, record.provenance.objectId);
    return { ...record, nodeId: id };
  });
  const columns = [];
  for (const record of data) {
    record.columns.forEach((column, index) => {
      if (columns.length >= limits.columns) throw new Error('Graph column limit exceeded');
      columns.push({ record, column, index, ...sketch(db, record, index, limits.sketch) });
    });
  }
  const usable = (column) =>
    column.column.type === 'string' &&
    column.values.length &&
    column.values.some((value) => value.length >= 4 && /[a-z]/i.test(value));
  const specificity = (column) =>
    column.record.rowCount > 0 && column.distinct / column.record.rowCount <= 0.1 ? 0.1 : 1;
  const frequency = new Map();
  for (const col of columns.filter(usable))
    for (const value of col.values) frequency.set(value, (frequency.get(value) || 0) + 1);
  const rarity = (value) => {
    const count = frequency.get(value) || 1;
    if (columns.length >= 10 && count / columns.length >= 0.25) return 0;
    return (
      Math.log(1 + Math.max(2, columns.length) / count) /
      Math.log(1 + Math.max(2, columns.length) / 2)
    );
  };
  for (let i = 0; i < columns.length; i++) {
    const left = columns[i];
    if (!usable(left)) continue;
    for (const right of columns.slice(i + 1)) {
      if (
        left.record.id === right.record.id ||
        !usable(right) ||
        left.column.type !== right.column.type
      )
        continue;
      compare();
      const shared = left.values.filter(
        (value) => value.length >= 4 && right.values.includes(value)
      );
      if (!shared.length) continue;
      const overlap =
        shared.reduce((sum, value) => sum + Math.min(1, rarity(value)), 0) /
        Math.min(left.values.length, right.values.length);
      const lowCardinality = [left, right].every((column) => specificity(column) < 1);
      const evidence = [
        {
          kind: 'overlap',
          score: overlap * caps.overlap * (lowCardinality ? 0.1 : 1),
          lowCardinality,
          columns: [left.column.name, right.column.name],
          shared: shared.length,
          samples: [left.values.length, right.values.length],
          sampled: left.sampled || right.sampled,
        },
        { kind: 'type', score: caps.type, type: left.column.type },
        {
          kind: 'cardinality',
          score:
            (caps.cardinality * Math.min(left.distinct, right.distinct)) /
            Math.max(left.distinct, right.distinct),
          counts: [left.distinct, right.distinct],
        },
      ];
      edge(left.record.nodeId, right.record.nodeId, 'joinsOn', evidence);
    }
  }
  for (let i = 0; i < data.length; i++) {
    const left = data[i];
    for (const right of data.slice(i + 1)) {
      compare();
      const a = left.period,
        b = right.period;
      const li = left.quality?.intervalMinutes,
        ri = right.quality?.intervalMinutes;
      if (!a?.from || !a.to || !b?.from || !b.to || !li || !ri) continue;
      const start = Math.max(Date.parse(a.from), Date.parse(b.from)),
        end = Math.min(Date.parse(a.to), Date.parse(b.to));
      const ratio = Math.max(li, ri) / Math.min(li, ri);
      if (start > end || !Number.isInteger(ratio) || ratio > 24) continue;
      const span = Math.min(
        Date.parse(a.to) - Date.parse(a.from),
        Date.parse(b.to) - Date.parse(b.from)
      );
      const coverage = span ? (end - start) / span : 1;
      edge(left.nodeId, right.nodeId, 'timeAligned', [
        {
          kind: 'period',
          score: caps.period * coverage,
          from: new Date(start).toISOString(),
          to: new Date(end).toISOString(),
        },
        { kind: 'interval', score: caps.interval, minutes: [li, ri] },
      ]);
    }
  }
  const candidates = candidateRows(db, limits.candidates + 1);
  if (candidates.length > limits.candidates) throw new Error('Graph candidate limit exceeded');
  const sourceObjects = new Map(objects.map((object) => [object.objectId, object]));
  const entityRows = [];
  for (const candidate of candidates) {
    const object = sourceObjects.get(candidate.object_id);
    if (!object || candidate.version !== object.derivation.version || candidate.kind === 'period')
      continue;
    const value = normalizeAnchor(candidate.value);
    if (value.length < 4 || !/[a-z]/i.test(value)) continue;
    const location = JSON.parse(candidate.location);
    const matching = columns.filter(
      (col) =>
        col.record.provenance.objectId === candidate.object_id &&
        col.record.sheet === location.sheet &&
        col.column.name === location.column &&
        usable(col) &&
        col.values.includes(value)
    );
    const passages = location.column
      ? []
      : sections.filter(
          (section) =>
            section.provenance.objectId === candidate.object_id &&
            ` ${section.anchorText || ''} `.includes(` ${value} `) &&
            ['page', 'slide', 'chapter'].every(
              (key) => !location[key] || section.sourceLocation?.[key] === location[key]
            )
        );
    if (!matching.length && !passages.length) continue;
    const scope = Object.fromEntries(
      ['sheet', 'column', 'page', 'slide', 'chapter', 'field']
        .filter((key) => location[key] !== undefined)
        .map((key) => [key, location[key]])
    );
    const ref = { objectId: candidate.object_id, kind: candidate.kind, value, location: scope };
    const identityKey = 'n_' + identity('entity', ref);
    const existing = nodes.get(identityKey);
    if (existing) {
      existing.attributes.occurrences++;
      if (existing.attributes.sampleLocations.length < 16)
        existing.attributes.sampleLocations.push(location);
      continue;
    }
    const id = node(
      'entity',
      ref,
      [candidate.value],
      {
        candidate: true,
        catalogField: candidate.catalog_field,
        occurrences: 1,
        sampleLocations: [location],
      },
      { objectId: candidate.object_id, hash: object.hash, location }
    );
    sourceEdges(id, candidate.object_id);
    entityRows.push({
      id,
      value,
      matching,
      passages,
      specificity: matching.length ? Math.max(...matching.map(specificity)) : 1,
    });
    for (const passage of passages) {
      for (const col of columns.filter(usable)) {
        compare();
        if (!col.values.includes(value)) continue;
        edge(passage.nodeId, col.record.nodeId, 'describes', [
          {
            kind: 'anchor',
            score: caps.anchor * Math.min(1, rarity(value)) * specificity(col),
            candidate: id,
            column: col.column.name,
            location,
          },
        ]);
      }
    }
  }
  const groups = new Map();
  for (const item of entityRows) {
    for (const other of groups.get(item.value) || []) {
      compare();
      if (item.matching.length === 0 && other.matching.length === 0) continue;
      edge(other.id, item.id, 'sameEntity', [
        {
          kind: 'anchor',
          score:
            caps.anchor *
            Math.min(1, rarity(item.value)) *
            Math.min(item.specificity, other.specificity),
          candidates: [other.id, item.id],
        },
      ]);
    }
    const group = groups.get(item.value) || [];
    group.push(item);
    groups.set(item.value, group);
  }
  return { nodes, edges, columns, node, edge, comparisons };
}
module.exports = { deriveGraph, weight };
