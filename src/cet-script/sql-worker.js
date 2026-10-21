'use strict';
const { parentPort, workerData } = require('node:worker_threads');
const Database = require('better-sqlite3');
const { authorize, validateText, deterministicTime } = require('./sql-authorizer');
const { installCheckpoints, instrument } = require('./sql-checkpoints');
const { fail } = require('./errors');
const { volumeCheck } = require('./sql-volume');
const { copy } = require('./values');
let db;
try {
  db = new Database(workerData.filename, { readonly: true, fileMustExist: true });
  db.pragma('query_only = ON');
  db.pragma('trusted_schema = OFF');
  db.pragma('temp_store = FILE');
  db.pragma('cache_size = -4096');
  deterministicTime(db);
  const checkpoints = installCheckpoints(db, workerData.deadline, workerData.stepLimit);
  validateText(workerData.sql);
  const guardedSql = instrument(workerData.sql);
  const statement = authorize(db, guardedSql, workerData.params, workerData.datasets);
  volumeCheck(
    db,
    statement,
    guardedSql,
    workerData.params,
    workerData.datasets,
    workerData.memoryLimit
  );
  const rows = [];
  let bytes = 0;
  for (const original of statement.iterate(...workerData.params)) {
    const row = copy(original);
    for (const value of Object.values(row))
      if (typeof value === 'number' && !Number.isFinite(value))
        fail('SQL_REJECTED', 'Nonfinite SQL value');
    checkpoints.check();
    delete row.__cet_guard;
    if (rows.length >= workerData.rowLimit)
      fail('BUDGET_EXCEEDED', 'SQL row budget exceeded', null, { budget: workerData.rowBudget });
    bytes += Buffer.byteLength(JSON.stringify(row));
    if (bytes > workerData.valueLimit)
      fail('BUDGET_EXCEEDED', 'SQL data size exceeded', null, { budget: 'valueBytes' });
    rows.push(row);
  }
  parentPort.postMessage({ rowsJson: JSON.stringify(rows), workSteps: checkpoints.steps() });
} catch (error) {
  parentPort.postMessage({
    error: {
      code: error.code?.startsWith('CET_SCRIPT_') ? error.code : 'CET_SCRIPT_SQL_REJECTED',
      message: 'SQL execution rejected',
      details: error.details,
    },
  });
} finally {
  db?.close();
}
