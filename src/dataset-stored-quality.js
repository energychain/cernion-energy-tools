'use strict';

const { detectControlRows } = require('./dataset-table-quality');

// Second disk scan keeps imports bounded even when controls occur outside the schema sample.
function storedTableQuality(pool, tenantId, id, columns) {
  const db = pool.tenant(tenantId),
    table = pool.table(id);
  const select = columns.map((_column, i) => `c${i}`).join(',');
  return detectControlRows(function* () {
    for (const entry of db
      .prepare(`SELECT row_number, ${select} FROM ${table} ORDER BY row_number`)
      .iterate()) {
      const row = Object.fromEntries(columns.map((column, i) => [column.name, entry[`c${i}`]]));
      yield { index: entry.row_number, row };
    }
  }, columns);
}

function excludeStoredControls(pool, tenantId, id, columns, controls) {
  const db = pool.tenant(tenantId),
    table = pool.table(id);
  db.transaction(() => {
    const remove = db.prepare(`DELETE FROM ${table} WHERE row_number = ?`);
    for (const entry of controls) remove.run(entry.index);
  })();
  const count = db.prepare(`SELECT COUNT(*) AS n FROM ${table}`).get().n;
  let missingValues = 0;
  columns.forEach((column, i) => {
    const stats = db
      .prepare(
        `SELECT COUNT(c${i}) AS n, SUM(c${i}) AS sum, MIN(c${i}) AS min, MAX(c${i}) AS max FROM ${table}`
      )
      .get();
    column.nullCount = count - stats.n;
    column.nullRatio = column.nullCount / count;
    column.nullable = Boolean(column.nullCount);
    missingValues += column.nullCount;
    if (column.type === 'number' && stats.n)
      column.numeric = { min: stats.min, max: stats.max, mean: stats.sum / stats.n };
  });
  return { count, missingValues };
}

module.exports = { storedTableQuality, excludeStoredControls };
