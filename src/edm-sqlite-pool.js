'use strict';

const fs = require('fs');
const path = require('path');
const { MoleculerError } = require('moleculer').Errors;

const SQLITE_UNAVAILABLE_TYPE = 'EDM_SQLITE_UNAVAILABLE';

const REGISTRY_SCHEMA = `
CREATE TABLE IF NOT EXISTS melos (
  melo_id TEXT PRIMARY KEY,
  type TEXT NOT NULL CHECK(type IN ('physical','virtual','dummy')),
  name TEXT,
  nap_mastr_nummer TEXT,
  installation_mastr_nummer TEXT,
  grid_operator_mastr_id TEXT,
  spannungsebene TEXT,
  messkonzept_id TEXT,
  obis_registers TEXT,
  source_type TEXT,
  source_config TEXT,
  metadata TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS messkonzepte (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  type TEXT NOT NULL CHECK(type IN ('SUM','DIFF','NET','CALC','CUSTOM')),
  formula TEXT,
  inputs TEXT DEFAULT '[]',
  output_melo_id TEXT NOT NULL,
  output_obis TEXT NOT NULL,
  schedule TEXT DEFAULT 'on_input_change',
  valid_since TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS custom_slp (
  profile_id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  base_profile TEXT,
  season TEXT NOT NULL,
  day_type TEXT NOT NULL,
  "values" TEXT NOT NULL,
  owner TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);
`;

const TIMESERIES_SCHEMA = `
CREATE TABLE IF NOT EXISTS timeseries (
  melo_id TEXT NOT NULL,
  obis TEXT NOT NULL,
  ts TEXT NOT NULL,
  value REAL,
  quality TEXT NOT NULL DEFAULT 'measured',
  source TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  PRIMARY KEY (melo_id, obis, ts)
) WITHOUT ROWID;

CREATE INDEX IF NOT EXISTS idx_ts_melo_date ON timeseries(melo_id, ts);
`;

class EdmSqlitePool {
  constructor(basePath, options = {}) {
    this.basePath = basePath || process.env.EDM_DB_PATH || 'data/edm';
    this.connections = new Map();
    this.registryDb = null;
    this.databaseFactory =
      typeof options.databaseFactory === 'function' ? options.databaseFactory : null;
    this.sqliteStatus = {
      ready: false,
      phase: 'init',
      reason: 'not_initialized',
      nativeCode: null,
    };
  }

  getDatabaseFactory() {
    if (this.databaseFactory) {
      return this.databaseFactory;
    }

    try {
      // Lazy load to convert native binding failures into controlled service errors.
      const Database = require('better-sqlite3');
      this.databaseFactory = Database;
      this.sqliteStatus = {
        ready: true,
        phase: 'load-module',
        reason: 'loaded',
        nativeCode: null,
      };
      return this.databaseFactory;
    } catch (err) {
      throw this.wrapSqliteError('Failed to load better-sqlite3 native module', err, {
        phase: 'load-module',
      });
    }
  }

  wrapSqliteError(message, err, details = {}) {
    const nativeCode = err?.code ? String(err.code) : null;
    this.sqliteStatus = {
      ready: false,
      phase: details.phase || 'runtime',
      reason: message,
      nativeCode,
    };

    return new MoleculerError(message, 503, SQLITE_UNAVAILABLE_TYPE, {
      ...details,
      nativeCode,
      nativeMessage: err?.message ? String(err.message) : null,
    });
  }

  openDatabase(filePath, schemaSql) {
    let db;
    try {
      const Database = this.getDatabaseFactory();
      db = new Database(filePath);
      db.pragma('journal_mode = WAL');
      db.pragma('synchronous = NORMAL');
      db.exec(schemaSql);
    } catch (err) {
      throw this.wrapSqliteError(`EDM SQLite backend unavailable (${filePath})`, err, {
        phase: 'open-database',
        filePath,
      });
    }

    this.sqliteStatus = {
      ready: true,
      phase: 'open-database',
      reason: 'ready',
      nativeCode: null,
    };
    return db;
  }

  assertAvailable() {
    this.getRegistry();
    return this.getHealthInfo();
  }

  getHealthInfo() {
    return {
      ready: Boolean(this.registryDb),
      basePath: this.basePath,
      registryPath: path.join(this.basePath, 'registry.sqlite'),
      openTimeseriesPartitions: this.connections.size,
      sqlite: { ...this.sqliteStatus },
    };
  }

  getRegistry() {
    if (this.registryDb) {
      return this.registryDb;
    }

    fs.mkdirSync(this.basePath, { recursive: true });
    const registryPath = path.join(this.basePath, 'registry.sqlite');
    const db = this.openDatabase(registryPath, REGISTRY_SCHEMA);

    this.registryDb = db;
    return db;
  }

  getTimeseries(partitionKey, quarter) {
    const cacheKey = `${partitionKey}:${quarter}`;
    if (this.connections.has(cacheKey)) {
      return this.connections.get(cacheKey);
    }

    const tsDir = path.join(this.basePath, `ts_${partitionKey}`);
    fs.mkdirSync(tsDir, { recursive: true });

    const tsPath = path.join(tsDir, `${quarter}.sqlite`);
    const db = this.openDatabase(tsPath, TIMESERIES_SCHEMA);

    this.connections.set(cacheKey, db);
    return db;
  }

  resolvePartition(meloId) {
    const db = this.getRegistry();
    const row = db
      .prepare('SELECT grid_operator_mastr_id FROM melos WHERE melo_id = ?')
      .get(meloId);

    if (row?.grid_operator_mastr_id) {
      return `vnb_${row.grid_operator_mastr_id}`;
    }

    return 'virtual';
  }

  resolveQuarter(isoDateString) {
    const date = new Date(isoDateString);
    if (Number.isNaN(date.getTime())) {
      throw new Error(`Invalid date: ${isoDateString}`);
    }

    const quarter = Math.floor(date.getUTCMonth() / 3) + 1;
    return `${date.getUTCFullYear()}_Q${quarter}`;
  }

  getTimeseriesForRange(meloId, from, to) {
    const partition = this.resolvePartition(meloId);
    const quarters = this._listQuarterRange(from, to);

    return quarters.map((quarter) => ({
      db: this.getTimeseries(partition, quarter),
      quarter,
    }));
  }

  _listQuarterRange(from, to) {
    const start = new Date(from);
    const end = new Date(to);

    if (Number.isNaN(start.getTime()) || Number.isNaN(end.getTime())) {
      throw new Error('Invalid date range');
    }

    if (start > end) {
      throw new Error('Invalid date range: from must be <= to');
    }

    let year = start.getUTCFullYear();
    let quarter = Math.floor(start.getUTCMonth() / 3) + 1;

    const endYear = end.getUTCFullYear();
    const endQuarter = Math.floor(end.getUTCMonth() / 3) + 1;
    const result = [];

    while (year < endYear || (year === endYear && quarter <= endQuarter)) {
      result.push(`${year}_Q${quarter}`);
      quarter += 1;
      if (quarter > 4) {
        quarter = 1;
        year += 1;
      }
    }

    return result;
  }

  closeAll() {
    for (const db of this.connections.values()) {
      try {
        db.close();
      } catch (_err) {
        // no-op: idempotent close
      }
    }
    this.connections.clear();

    if (this.registryDb) {
      try {
        this.registryDb.close();
      } catch (_err) {
        // no-op: idempotent close
      }
      this.registryDb = null;
    }
  }

  getRetentionDays() {
    return parseInt(process.env.EDM_RETENTION_DAYS || '1095', 10);
  }
}

module.exports = EdmSqlitePool;
