'use strict';
const { fail } = require('./errors');
const { lexSql } = require('./sql-lex');
function volumeCheck(db, statement, sql, params, datasets, limit) {
  const roots = new Map();
  for (const dataset of datasets) {
    for (const row of db
      .prepare(
        "SELECT rootpage FROM sqlite_schema WHERE (name=? AND type='table') OR (tbl_name=? AND type='index')"
      )
      .all(dataset.id, dataset.id))
      roots.set(row.rootpage, dataset);
  }
  const instructions = db.prepare(`EXPLAIN ${sql}`).all(...params);
  const readRoots = instructions.filter((item) => ['OpenRead', 'ReopenIdx'].includes(item.opcode));
  const cache = new Map();
  let multiplicity = 1,
    largest = 8;
  for (const value of params)
    if (typeof value === 'string') largest = Math.max(largest, Buffer.byteLength(value));
  for (const token of lexSql(sql))
    if (token.text === 'literal') largest = Math.max(largest, token.end - token.start);
  for (const instruction of readRoots) {
    const dataset = roots.get(instruction.p2);
    if (!dataset) fail('SQL_REJECTED', 'Unresolved dataset root');
    if (!cache.has(dataset.id)) {
      const lengths = dataset.columns.map(
        (_column, index) => `MAX(length(CAST(c${index} AS BLOB))) AS l${index}`
      );
      const row = db
        .prepare(
          `SELECT COUNT(cet_script_tick(row_number)) AS n${lengths.length ? ',' : ''}${lengths.join(',')} FROM "${dataset.id}"`
        )
        .get();
      const maxCell = Math.max(
        8,
        ...Object.entries(row)
          .filter(([key]) => key !== 'n')
          .map(([, value]) => Number(value) || 0)
      );
      cache.set(dataset.id, { count: row.n, maxCell });
    }
    const stats = cache.get(dataset.id);
    multiplicity *= Math.max(1, stats.count);
    largest = Math.max(largest, stats.maxCell);
    if (!Number.isSafeInteger(multiplicity))
      fail('BUDGET_EXCEEDED', 'SQL work volume exceeded', null, { budget: 'memoryBytes' });
  }
  const estimated = multiplicity * (largest * 2 * statement.columns().length + 128);
  if (estimated > limit)
    fail('BUDGET_EXCEEDED', 'SQL scratch volume exceeded', null, { budget: 'memoryBytes' });
  return estimated;
}
module.exports = { volumeCheck };
