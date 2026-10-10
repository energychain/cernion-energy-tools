'use strict';

const fs = require('node:fs');
const path = require('node:path');
const { createHash } = require('node:crypto');
const EdmSqlitePool = require('./edm-sqlite-pool');

// Reuse the native-error handling, WAL settings, connection cache and shutdown.
class DatasetSqlitePool extends EdmSqlitePool {
  tenant(tenantId) {
    const key = createHash('sha256').update(tenantId).digest('hex');
    if (!this.connections.has(key)) {
      fs.mkdirSync(this.basePath, { recursive: true });
      const db = this.openDatabase(path.join(this.basePath, `${key}.sqlite`), '');
      db.pragma('secure_delete = ON');
      this.connections.set(key, db);
    }
    return this.connections.get(key);
  }

  table(id) {
    if (!/^ds_[a-f0-9]{32}$/.test(id)) throw new Error('Invalid dataset table reference');
    return `"${id}"`;
  }

  putRows(tenantId, id, rows, columns, normalizedTimes = [], localTimes = []) {
    const db = this.tenant(tenantId),
      table = this.table(id);
    db.transaction(() => {
      const definitions = columns
        .map((column, i) => `c${i} ${column.type === 'number' ? 'REAL' : 'TEXT'}`)
        .join(',');
      db.exec(
        `CREATE TABLE ${table} (row_number INTEGER PRIMARY KEY, utc TEXT, local_time TEXT, ${definitions})`
      );
      const insert = db.prepare(
        `INSERT INTO ${table} VALUES (${Array(columns.length + 3)
          .fill('?')
          .join(',')})`
      );
      rows.forEach((row, i) =>
        insert.run(
          i,
          normalizedTimes[i] || null,
          localTimes[i] || null,
          ...columns.map((column) => row[column.name] ?? null)
        )
      );
    })();
  }

  rows(tenantId, id, columns) {
    return this.tenant(tenantId)
      .prepare(`SELECT * FROM ${this.table(id)} ORDER BY row_number`)
      .all()
      .map((row) => Object.fromEntries(columns.map((column, i) => [column.name, row[`c${i}`]])));
  }

  removeRows(tenantId, id) {
    const db = this.tenant(tenantId);
    db.exec(`DROP TABLE IF EXISTS ${this.table(id)}`);
    db.pragma('wal_checkpoint(TRUNCATE)');
    db.exec('VACUUM');
  }

  updateTimes(tenantId, id, times, localTimes = []) {
    const db = this.tenant(tenantId);
    const update = db.prepare(
      `UPDATE ${this.table(id)} SET utc = ?, local_time = ? WHERE row_number = ?`
    );
    db.transaction(() =>
      times.forEach((time, i) => update.run(time || null, localTimes[i] || null, i))
    )();
  }
}

module.exports = DatasetSqlitePool;
