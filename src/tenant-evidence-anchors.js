'use strict';

const { candidates, documentCandidates } = require('./project-structure-table');

function observedAnchors(entries) {
  const unique = new Map();
  for (const entry of entries) {
    const value = String(entry.value || '').trim();
    if (
      entry.kind === 'period' ||
      value.length < 4 ||
      value.length > 160 ||
      !/[\p{L}]/u.test(value) ||
      value.split(/\s+/u).length > 8 ||
      unique.has(value)
    )
      continue;
    if (unique.size < 32)
      unique.set(value, { name: value, origin: 'observed', location: entry.location });
  }
  return [...unique.values()];
}
function documentSourceAnchors(row) {
  return observedAnchors(documentCandidates(String(row.text || ''), row.sourceLocation || {}));
}
function tableSourceAnchors(rows, columns, sheet) {
  return observedAnchors(
    candidates(
      rows.slice(0, 512),
      columns.filter((column) => column.type === 'string' && !column.sensitive).slice(0, 32),
      0,
      sheet
    )
  );
}
function storedTableAnchors(service, p, row) {
  const entries = [];
  const pool = service.datasetPool;
  for (const [index, column] of row.columns.entries()) {
    if (column.type !== 'string' || column.sensitive || index >= 32) continue;
    const values = pool
      .tenant(p.tenantId)
      .prepare(
        `SELECT c${index} AS value, MIN(row_number) + 2 AS line FROM ${pool.table(row.id)}
       WHERE c${index} IS NOT NULL AND length(c${index}) <= 160
       GROUP BY c${index} ORDER BY c${index} LIMIT 32`
      )
      .all();
    entries.push(
      ...values.map(({ value, line }) => ({
        kind: 'label',
        value,
        location: { sheet: row.sheet, column: column.name, row: line },
      }))
    );
  }
  return observedAnchors(entries);
}
function promptCandidate(candidate) {
  const observed = new Set(
    candidate.routingSources.flatMap((source) =>
      source.anchors.filter((anchor) => anchor.origin === 'observed').map((anchor) => anchor.name)
    )
  );
  return {
    id: candidate.id,
    title: candidate.title,
    manifest: {
      ...candidate.manifest,
      entities: candidate.manifest.entities.filter((entity) => !observed.has(entity.name)),
    },
    routingSources: candidate.routingSources.map((source) => ({
      ...source,
      anchors: source.anchors.filter((anchor) => anchor.origin !== 'observed'),
    })),
  };
}
module.exports = {
  observedAnchors,
  documentSourceAnchors,
  tableSourceAnchors,
  storedTableAnchors,
  promptCandidate,
};
