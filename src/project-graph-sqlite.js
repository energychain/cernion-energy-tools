'use strict';
const path = require('node:path');
const Database = require('better-sqlite3');
const disk = require('./project-file-disk');
const { normalizeAnchor } = require('./tenant-memory-store');
const { identity } = require('./project-graph-policy');

async function openGraphSource(basePath, tenantId, projectId) {
  const directory = await disk.projectDirectory(basePath, tenantId, projectId);
  const filename = path.join(directory, 'project.sqlite');
  for (const suffix of ['', '-wal', '-shm']) {
    try {
      await disk.regularFile(filename + suffix);
    } catch (error) {
      if (suffix === '' || error.code !== 'ENOENT') throw error;
    }
  }
  const db = new Database(filename, { readonly: true, fileMustExist: true });
  db.pragma('query_only = ON');
  db.pragma('cache_size = -8192');
  db.pragma('temp_store = FILE');
  db.function('graph_anchor', { deterministic: true }, (value) => normalizeAnchor(value));
  db.function('graph_rank', { deterministic: true }, (value) => identity(value));
  return db;
}
function table(id) {
  if (!/^ds_[a-f0-9]{32}$/.test(id)) throw new Error('Invalid graph dataset reference');
  return `"${id}"`;
}
function sketch(db, dataset, columnIndex, limit) {
  const name = `c${columnIndex}`;
  const source = `SELECT graph_anchor(${name}) AS value, CAST(${name} AS TEXT) AS raw FROM ${table(dataset.id)} WHERE ${name} IS NOT NULL AND length(CAST(${name} AS TEXT)) <= 1000`;
  const { n } = db
    .prepare(`SELECT COUNT(DISTINCT value) AS n FROM (${source}) WHERE value <> ''`)
    .get();
  const sample = db
    .prepare(
      `SELECT value, MIN(raw) AS raw FROM (${source}) WHERE value <> '' GROUP BY value ORDER BY graph_rank(value), value LIMIT ?`
    )
    .all(limit);
  const values = sample.map((row) => row.value);
  const rawValues = Object.fromEntries(sample.map((row) => [row.value, row.raw]));
  return { distinct: n, values, rawValues, sampled: n > values.length };
}
function candidateRows(db, limit) {
  return db
    .prepare(
      "SELECT * FROM project_candidates WHERE kind <> 'period' ORDER BY object_id, version, kind, value, location LIMIT ?"
    )
    .all(limit);
}
function graphSource(db, datasets, limits) {
  const columns = [];
  for (const record of datasets) {
    record.columns.forEach((column, index) => {
      if (columns.length >= limits.columns) throw new Error('Graph column limit exceeded');
      columns.push({ record, column, index, ...sketch(db, record, index, limits.sketch) });
    });
  }
  const candidates = candidateRows(db, limits.candidates + 1);
  if (candidates.length > limits.candidates) throw new Error('Graph candidate limit exceeded');
  return { columns, candidates };
}
module.exports = { openGraphSource, sketch, candidateRows, graphSource };
