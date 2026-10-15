'use strict';

const fs = require('node:fs');
const path = require('node:path');
const DatasetSqlitePool = require('./dataset-sqlite-pool');
const disk = require('./project-file-disk');

// A fixed scope adapts the existing query executor without making other files reachable.
class ProjectDatasetPool extends DatasetSqlitePool {
  static async open(basePath, tenantId, projectId) {
    const directory = await disk.projectDirectory(basePath, tenantId, projectId);
    const filename = path.join(directory, 'project.sqlite');
    for (const suffix of ['', '-wal', '-shm']) {
      try {
        await disk.regularFile(filename + suffix);
      } catch (error) {
        if (error.code !== 'ENOENT') throw error;
      }
    }
    const pool = new ProjectDatasetPool(directory);
    pool.tenantId = tenantId;
    pool.projectId = projectId;
    pool.filename = filename;
    // Create exclusively first, with private permissions even under a permissive umask.
    const handle = await fs.promises.open(filename, 'ax', 0o600).catch((error) => {
      if (error.code !== 'EEXIST') throw error;
    });
    await handle?.close();
    pool.tenant(tenantId);
    return pool;
  }

  tenant(tenantId) {
    if (tenantId !== this.tenantId) throw new Error('Project database tenant mismatch');
    if (!this.connections.has(tenantId)) {
      const db = this.openDatabase(this.filename, '');
      db.pragma('secure_delete = ON');
      db.pragma('cache_size = -8192');
      db.pragma('temp_store = FILE');
      db.exec(`CREATE TABLE IF NOT EXISTS project_candidates (
        object_id TEXT NOT NULL, version TEXT NOT NULL, kind TEXT NOT NULL,
        value TEXT NOT NULL, location TEXT NOT NULL, catalog_field TEXT,
        PRIMARY KEY(object_id, version, kind, value, location)
      ) WITHOUT ROWID`);
      this.connections.set(tenantId, db);
    }
    return this.connections.get(tenantId);
  }

  appendRows(id, rows, columns, times, offset) {
    const db = this.tenant(this.tenantId);
    const insert = db.prepare(
      `INSERT INTO ${this.table(id)} VALUES (${Array(columns.length + 3)
        .fill('?')
        .join(',')})`
    );
    db.transaction(() =>
      rows.forEach((row, i) =>
        insert.run(
          offset + i,
          times.utc[i] || null,
          times.local[i] || null,
          ...columns.map((column) => row[column.name] ?? null)
        )
      )
    )();
  }

  indexes(id, columns) {
    const db = this.tenant(this.tenantId);
    db.exec(`CREATE INDEX "${id}_utc" ON ${this.table(id)} (utc)`);
    columns.forEach((column, index) => {
      if (
        column.type === 'timestamp' ||
        column.sensitive ||
        (column.type === 'string' && column.distinctRatio > 0.9)
      )
        db.exec(`CREATE INDEX "${id}_c${index}" ON ${this.table(id)} (c${index})`);
    });
    db.pragma('wal_checkpoint(TRUNCATE)');
  }

  candidates(objectId, version, values) {
    const db = this.tenant(this.tenantId);
    const insert = db.prepare('INSERT OR IGNORE INTO project_candidates VALUES (?, ?, ?, ?, ?, ?)');
    db.transaction(() =>
      values.forEach((entry) =>
        insert.run(
          objectId,
          version,
          entry.kind,
          String(entry.value).slice(0, 1000),
          JSON.stringify(
            Object.fromEntries(
              Object.entries(entry.location).map(([key, value]) => [
                key,
                typeof value === 'string' ? value.slice(0, 1000) : value,
              ])
            )
          ),
          entry.catalogField || null
        )
      )
    )();
  }
}

async function datasetPoolFor(service, record) {
  if (!record.provenance?.projectId) return service.datasetPool;
  service.projectDatasetPools ||= new Map();
  const key = JSON.stringify([record.tenantId, record.provenance.projectId]);
  if (!service.projectDatasetPools.has(key)) {
    const basePath =
      service.broker?.getLocalService('project-upload')?.basePath() ||
      process.env.CET_PROJECT_DATA_PATH ||
      './data/project-objects';
    const pending = ProjectDatasetPool.open(basePath, record.tenantId, record.provenance.projectId);
    service.projectDatasetPools.set(key, pending);
    try {
      await pending;
    } catch (error) {
      service.projectDatasetPools.delete(key);
      throw error;
    }
  }
  return service.projectDatasetPools.get(key);
}

// Ordered SQLite iteration keeps quality checks bounded for filtered million-row queries.
function queryTimeQuality(db, sql, params, timeField, _timezone, intervalMinutes, localField) {
  const quality = { intervalMinutes, gaps: 0, duplicates: 0, transitions: [] };
  let previous, previousOffset;
  for (const row of db
    .prepare(
      `SELECT ${timeField} AS time${localField ? `, ${localField} AS wall` : ''} FROM (${sql}) ORDER BY ${timeField}`
    )
    .iterate(...params)) {
    if (!row.time) continue;
    const instant = Date.parse(row.time);
    if (row.wall) {
      const offset = Date.parse(row.wall.replace(' ', 'T') + 'Z') - instant;
      if (previousOffset != null && offset !== previousOffset && quality.transitions.length < 1000)
        quality.transitions.push({
          at: row.wall,
          offsetMinutes: (offset - previousOffset) / 60000,
        });
      previousOffset = offset;
    }
    if (previous != null) {
      if (instant === previous) quality.duplicates++;
      else if (intervalMinutes)
        quality.gaps += Math.max(
          0,
          Math.round((instant - previous) / (intervalMinutes * 60000)) - 1
        );
    }
    previous = instant;
  }
  return quality;
}

module.exports = { ProjectDatasetPool, datasetPoolFor, queryTimeQuality };
