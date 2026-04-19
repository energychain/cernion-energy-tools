'use strict';

const fs = require('fs');
const os = require('os');
const path = require('path');
const EdmSqlitePool = require('../src/edm-sqlite-pool');

function createTempDir() {
  return path.join(os.tmpdir(), `edm-pool-${Date.now()}-${Math.random().toString(16).slice(2)}`);
}

describe('edm-sqlite-pool', () => {
  let basePath;
  let pool;

  beforeEach(() => {
    basePath = createTempDir();
    pool = new EdmSqlitePool(basePath);
  });

  afterEach(() => {
    pool.closeAll();
    fs.rmSync(basePath, { recursive: true, force: true });
  });

  it('Pool erstellt Registry-DB automatisch', () => {
    pool.getRegistry();
    expect(fs.existsSync(path.join(basePath, 'registry.sqlite'))).toBe(true);
  });

  it('Schema enthält melos + messkonzepte + custom_slp', () => {
    const db = pool.getRegistry();
    const tables = db
      .prepare("SELECT name FROM sqlite_master WHERE type = 'table'")
      .all()
      .map((row) => row.name);

    expect(tables).toContain('melos');
    expect(tables).toContain('messkonzepte');
    expect(tables).toContain('custom_slp');
  });

  it('getTimeseries erstellt Partition-Verzeichnis und Datei', () => {
    pool.getTimeseries('vnb_SNB935578300972', '2026_Q2');

    expect(fs.existsSync(path.join(basePath, 'ts_vnb_SNB935578300972'))).toBe(true);
    expect(fs.existsSync(path.join(basePath, 'ts_vnb_SNB935578300972', '2026_Q2.sqlite'))).toBe(
      true
    );
  });

  it("resolveQuarter('2026-04-15') → 2026_Q2", () => {
    expect(pool.resolveQuarter('2026-04-15')).toBe('2026_Q2');
  });

  it("resolveQuarter('2026-01-01') → 2026_Q1", () => {
    expect(pool.resolveQuarter('2026-01-01')).toBe('2026_Q1');
  });

  it("resolveQuarter('2026-12-31') → 2026_Q4", () => {
    expect(pool.resolveQuarter('2026-12-31')).toBe('2026_Q4');
  });

  it('closeAll ist idempotent', () => {
    pool.getRegistry();
    pool.getTimeseries('vnb_demo', '2026_Q1');
    expect(() => pool.closeAll()).not.toThrow();
    expect(() => pool.closeAll()).not.toThrow();
  });

  it('WAL-Modus ist aktiv', () => {
    const db = pool.getRegistry();
    expect(db.pragma('journal_mode', { simple: true })).toBe('wal');
  });

  it('getRegistry ist Singleton', () => {
    const a = pool.getRegistry();
    const b = pool.getRegistry();
    expect(a).toBe(b);
  });
});
