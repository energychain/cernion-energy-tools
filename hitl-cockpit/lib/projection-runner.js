'use strict';

const crypto = require('node:crypto');
const fs = require('node:fs');
const path = require('node:path');
const { spawnSync } = require('node:child_process');
const { ManagementStore, SCHEMA_VERSION } = require('./management-store');
const { buildClassificationAudit, project } = require('./projector');

const DEFAULT_LOCK_STALE_MS = 10 * 60 * 1000;
const SQLITE_MAINTENANCE = String.raw`
import os, sqlite3, sys
mode, source, target = sys.argv[1:4]
if mode == 'backup':
    src=sqlite3.connect('file:'+source+'?mode=ro', uri=True, timeout=10)
    dst=sqlite3.connect(target, timeout=10)
    src.backup(dst)
    dst.execute('PRAGMA wal_checkpoint(TRUNCATE)')
    dst.execute('PRAGMA journal_mode=DELETE')
    dst.commit(); dst.close(); src.close()
elif mode == 'normalize':
    import time
    deadline=time.monotonic()+10
    while True:
        con=sqlite3.connect(source, timeout=1)
        try:
            con.execute('PRAGMA busy_timeout=1000')
            con.execute('PRAGMA wal_checkpoint(TRUNCATE)')
            mode_row=con.execute('PRAGMA journal_mode=DELETE').fetchone()
            if not mode_row or str(mode_row[0]).lower() != 'delete':
                raise sqlite3.OperationalError('journal mode still busy')
            con.commit(); con.close(); break
        except sqlite3.OperationalError:
            con.close()
            if time.monotonic() >= deadline: raise
            time.sleep(0.1)
os.chmod(target if mode == 'backup' else source, 0o600)
`;

function canonical(value) {
  if (Array.isArray(value)) return value.map(canonical);
  if (!value || typeof value !== 'object') return value;
  return Object.fromEntries(
    Object.keys(value)
      .sort()
      .map((key) => [key, canonical(value[key])])
  );
}

function sourceFingerprint(source) {
  const publicState = {
    boards: (source.boards || []).map((board) => ({
      board: board.board,
      items: board.items || [],
    })),
    errors: (source.errors || []).map((error) => ({ board: error.board, failed: true })),
  };
  return crypto
    .createHash('sha256')
    .update(JSON.stringify(canonical(publicState)))
    .digest('hex');
}

function lastEventAt(board) {
  return (
    Math.max(
      0,
      ...(board.items || []).map((item) =>
        Number(item.completed_at || item.started_at || item.created_at || 0)
      )
    ) || null
  );
}

function opaqueSourceId(value) {
  return `source_${crypto
    .createHash('sha256')
    .update(String(value || 'unknown'))
    .digest('hex')
    .slice(0, 16)}`;
}

function sourceHealth(source, observedAt) {
  const healthy = (source.boards || []).map((board) => ({
    source_id: opaqueSourceId(board.board),
    source_type: 'kanban',
    observed_at: observedAt,
    last_event_at: lastEventAt(board),
    status: 'healthy',
    error_code: null,
    source_count: (board.items || []).length,
  }));
  const errors = (source.errors || []).map((error) => ({
    source_id: opaqueSourceId(error.board),
    source_type: 'kanban',
    observed_at: observedAt,
    last_event_at: null,
    status: 'error',
    error_code: 'SOURCE_READ_FAILED',
    source_count: 0,
  }));
  return [...healthy, ...errors];
}

function projectionCount(projection) {
  return ['topics', 'decisions', 'outcomes', 'wakeups', 'digestItems', 'agentBriefs'].reduce(
    (total, key) => total + (projection[key] || []).length,
    0
  );
}

function fsyncPath(target) {
  const descriptor = fs.openSync(target, 'r');
  try {
    fs.fsyncSync(descriptor);
  } finally {
    fs.closeSync(descriptor);
  }
}

function securePrecreate(target) {
  fs.mkdirSync(path.dirname(target), { recursive: true });
  const descriptor = fs.openSync(target, 'a', 0o600);
  try {
    fs.fchmodSync(descriptor, 0o600);
  } finally {
    fs.closeSync(descriptor);
  }
}

function sqliteMaintenance(mode, source, target = source, timeoutMs = 30000) {
  if (mode === 'backup') securePrecreate(target);
  const result = spawnSync('python3', ['-c', SQLITE_MAINTENANCE, mode, source, target], {
    encoding: 'utf8',
    timeout: Math.max(1, Math.floor(timeoutMs || 30000)),
    maxBuffer: 1024 * 1024,
  });
  if (result.status !== 0) throw new Error('SQLITE_SNAPSHOT_FAILED');
}

class ProjectionLock {
  constructor(lockPath, options = {}) {
    this.path = path.resolve(lockPath);
    this.nowMs = options.nowMs || Date.now;
    this.staleAfterMs = Number(options.staleAfterMs || DEFAULT_LOCK_STALE_MS);
    this.token = crypto.randomUUID();
    this.handle = null;
  }

  processStartTicks(pid) {
    if (!Number.isInteger(pid) || pid <= 1) return null;
    try {
      const stat = fs.readFileSync(`/proc/${pid}/stat`, 'utf8');
      const close = stat.lastIndexOf(')');
      const fields = stat
        .slice(close + 2)
        .trim()
        .split(/\s+/);
      return /^\d+$/.test(fields[19] || '') ? fields[19] : null;
    } catch (_) {
      return null;
    }
  }

  ownerAlive(pid) {
    if (!Number.isInteger(pid) || pid <= 1) return false;
    try {
      process.kill(pid, 0);
      return true;
    } catch (error) {
      return error.code !== 'ESRCH';
    }
  }

  acquire() {
    fs.mkdirSync(path.dirname(this.path), { recursive: true });
    for (let attempt = 0; attempt < 3; attempt += 1) {
      try {
        this.handle = fs.openSync(this.path, 'wx', 0o600);
        fs.writeFileSync(
          this.handle,
          JSON.stringify({
            token: this.token,
            pid: process.pid,
            processStartTicks: this.processStartTicks(process.pid),
            createdAtMs: this.nowMs(),
          })
        );
        fs.fsyncSync(this.handle);
        return true;
      } catch (error) {
        if (error.code !== 'EEXIST') throw error;
        let stat;
        let metadata = null;
        try {
          stat = fs.statSync(this.path);
          metadata = JSON.parse(fs.readFileSync(this.path, 'utf8'));
        } catch (_) {
          try {
            stat = stat || fs.statSync(this.path);
          } catch (statError) {
            if (statError.code === 'ENOENT') continue;
            throw statError;
          }
        }
        const createdAt = Number(metadata?.createdAtMs || stat.mtimeMs);
        const stale = this.nowMs() - createdAt > this.staleAfterMs;
        const pid = Number(metadata?.pid);
        const storedStart = metadata?.processStartTicks;
        const validIdentity =
          Number.isInteger(pid) && pid > 1 && /^\d+$/.test(String(storedStart || ''));
        if (validIdentity) {
          const alive = this.ownerAlive(pid);
          const currentStart = this.processStartTicks(pid);
          if (alive && currentStart === String(storedStart)) return false;
          if (alive && currentStart === null && !stale) return false;
        } else if (!stale) {
          return false;
        }
        const tombstone = `${this.path}.stale.${process.pid}.${this.token}`;
        try {
          fs.renameSync(this.path, tombstone);
          fs.rmSync(tombstone, { force: true });
        } catch (reclaimError) {
          if (!['ENOENT', 'EEXIST'].includes(reclaimError.code)) throw reclaimError;
        }
      }
    }
    return false;
  }

  release() {
    if (this.handle !== null) {
      fs.closeSync(this.handle);
      this.handle = null;
    }
    try {
      const metadata = JSON.parse(fs.readFileSync(this.path, 'utf8'));
      if (metadata.token === this.token) fs.rmSync(this.path, { force: true });
    } catch (_) {
      // A missing/replaced lock belongs to nobody or another runner and must not be removed.
    }
  }
}

class ProjectionRunner {
  constructor(options = {}) {
    if (!options.database) throw new Error('database is required');
    if (typeof options.loadSource !== 'function') throw new Error('loadSource is required');
    this.database = path.resolve(options.database);
    this.lockPath = path.resolve(options.lockPath || `${this.database}.projection.lock`);
    this.loadSource = options.loadSource;
    this.project = options.project || project;
    this.projectionOptions = options.projectionOptions || {};
    this.now = options.now || (() => Math.floor(Date.now() / 1000));
    this.wallClock = options.wallClock || Date.now;
    this.maxDurationMs = Number(options.maxDurationMs || 0);
    this.lockStaleMs = Number(options.lockStaleMs || DEFAULT_LOCK_STALE_MS);
    this.beforeActivate = options.beforeActivate || null;
  }

  deadline(startedMs) {
    return this.maxDurationMs > 0 ? startedMs + this.maxDurationMs : Number.POSITIVE_INFINITY;
  }

  remaining(deadline) {
    const value = deadline - this.wallClock();
    if (value <= 0) throw new Error('RUN_BUDGET_EXCEEDED');
    return Number.isFinite(value) ? Math.max(1, Math.floor(value)) : 0;
  }

  scan(deadline) {
    return this.loadSource({ timeoutMs: this.remaining(deadline), deadlineMs: deadline });
  }

  recordFailure(startedAt, errorCode, fingerprint = null, source = null) {
    const completedAt = this.now();
    securePrecreate(this.database);
    const store = new ManagementStore({ database: this.database });
    store.initialize();
    const runId = `run_${crypto.randomUUID()}`;
    const sources = source
      ? sourceHealth(source, completedAt)
      : [
          {
            source_id: 'aggregate',
            source_type: 'kanban',
            observed_at: completedAt,
            last_event_at: null,
            status: 'error',
            error_code: errorCode,
            source_count: 0,
          },
        ];
    store.writeProjectionHealth(
      {
        run_id: runId,
        started_at: startedAt,
        completed_at: completedAt,
        status: 'failed',
        source_count: Number(source?.count || 0),
        projected_count: 0,
        error_count: Math.max(1, source?.errors?.length || 0),
        lag_seconds: null,
        fingerprint,
        error_code: errorCode,
      },
      sources,
      [{ checkpoint_key: 'last_attempt', value: runId, updated_at: completedAt }],
      { replaceSources: true }
    );
    return { status: 'failed', errorCode };
  }

  observation(source, startedAt, fingerprint, projectedCount, store, unchanged) {
    const completedAt = this.now();
    const status = source.errors?.length ? 'degraded' : 'success';
    const newestEvent = Math.max(
      0,
      ...(source.boards || []).map((board) => lastEventAt(board) || 0)
    );
    const runId = `run_${crypto.randomUUID()}`;
    store.writeProjectionHealth(
      {
        run_id: runId,
        started_at: startedAt,
        completed_at: completedAt,
        status,
        source_count: Number(
          source.count ?? source.boards.reduce((n, board) => n + board.items.length, 0)
        ),
        projected_count: projectedCount,
        error_count: source.errors?.length || 0,
        lag_seconds: newestEvent ? Math.max(0, completedAt - newestEvent) : null,
        fingerprint,
        error_code: source.errors?.length ? 'SOURCE_READ_FAILED' : null,
      },
      sourceHealth(source, completedAt),
      [
        { checkpoint_key: 'last_attempt', value: runId, updated_at: completedAt },
        { checkpoint_key: 'last_success_run_id', value: runId, updated_at: completedAt },
        { checkpoint_key: 'last_success_fingerprint', value: fingerprint, updated_at: completedAt },
      ],
      { replaceSources: true }
    );
    return { status, unchanged, fingerprint, projectedCount };
  }

  verify(store, expectedSourceCount) {
    if (store.query('PRAGMA integrity_check')[0]?.integrity_check !== 'ok')
      throw new Error('INTEGRITY_CHECK_FAILED');
    if (store.query('PRAGMA user_version')[0]?.user_version !== SCHEMA_VERSION)
      throw new Error('SCHEMA_VERSION_MISMATCH');
    const tables = [
      'management_topics',
      'governance_decisions',
      'agent_briefs',
      'outcomes',
      'wakeups',
      'classification_audit',
      'cockpit_events',
      'projection_boards',
      'projection_objects',
      'digest_items',
    ];
    const forbidden = [
      'twl-netze-private',
      'twl-private',
      'private-quarantine',
      'mixed-sensitive',
      '"sensitivity":"private"',
      '"sensitivity": "private"',
      '"sensitivity":"unclear"',
      '"sensitivity": "unclear"',
    ];
    for (const table of tables) {
      const serialized = JSON.stringify(store.query(`SELECT * FROM ${table}`))
        .toLowerCase()
        .replaceAll('\\', '');
      if (forbidden.some((marker) => serialized.includes(marker)))
        throw new Error('PRIVACY_CHECK_FAILED');
    }
    const sensitiveTopics = store.query(
      "SELECT COUNT(*) AS count FROM management_topics WHERE LOWER(sensitivity) IN ('twl-private','twl-netze-private','private-quarantine','private','unclear','mixed-sensitive')"
    )[0].count;
    if (Number(sensitiveTopics) !== 0) throw new Error('PRIVACY_CHECK_FAILED');
    const boardCount = store.query(
      'SELECT COALESCE(SUM(source_count),0) AS count FROM projection_boards'
    )[0].count;
    if (Number(boardCount) < expectedSourceCount) throw new Error('SOURCE_COVERAGE_CHECK_FAILED');
  }

  snapshotCandidate(target, deadline) {
    securePrecreate(target);
    if (fs.existsSync(this.database))
      sqliteMaintenance('backup', this.database, target, this.remaining(deadline));
  }

  activate(candidate, deadline) {
    sqliteMaintenance('normalize', candidate, candidate, this.remaining(deadline));
    if (fs.existsSync(this.database)) {
      sqliteMaintenance('normalize', this.database, this.database, this.remaining(deadline));
      for (const suffix of ['-wal', '-shm'])
        fs.rmSync(`${this.database}${suffix}`, { force: true });
    }
    for (const suffix of ['-wal', '-shm']) fs.rmSync(`${candidate}${suffix}`, { force: true });
    fs.chmodSync(candidate, 0o600);
    fsyncPath(candidate);
    fs.renameSync(candidate, this.database);
    fs.chmodSync(this.database, 0o600);
    fsyncPath(this.database);
    fsyncPath(path.dirname(this.database));
  }

  runOnce() {
    const lock = new ProjectionLock(this.lockPath, {
      nowMs: this.wallClock,
      staleAfterMs: this.lockStaleMs,
    });
    if (!lock.acquire()) return { status: 'locked', errorCode: 'PROJECTION_LOCKED' };
    const startedAt = this.now();
    const startedMs = this.wallClock();
    const deadline = this.deadline(startedMs);
    let tempDatabase = null;
    try {
      let first;
      try {
        first = this.scan(deadline);
      } catch (error) {
        const code = error.message === 'RUN_BUDGET_EXCEEDED' ? error.message : 'SOURCE_LOAD_FAILED';
        return this.recordFailure(startedAt, code);
      }
      if (!(first.boards || []).length && !(first.errors || []).length)
        return this.recordFailure(startedAt, 'NO_SOURCES_AVAILABLE');
      const fingerprint = sourceFingerprint(first);
      const unchanged = this.previousFingerprint(fingerprint);
      const second = this.scan(deadline);
      if (sourceFingerprint(second) !== fingerprint)
        return this.recordFailure(startedAt, 'SOURCE_CHANGED_DURING_RUN', fingerprint, first);

      if (unchanged) {
        const active = new ManagementStore({ database: this.database });
        const previous = active.query(
          "SELECT projected_count FROM projection_runs WHERE status IN ('success','degraded') ORDER BY completed_at DESC LIMIT 1"
        )[0];
        return this.observation(
          first,
          startedAt,
          fingerprint,
          Number(previous?.projected_count || 0),
          active,
          true
        );
      }

      this.remaining(deadline);
      fs.mkdirSync(path.dirname(this.database), { recursive: true });
      tempDatabase = path.join(
        path.dirname(this.database),
        `.${path.basename(this.database)}.${process.pid}.${crypto.randomUUID()}.tmp`
      );
      this.snapshotCandidate(tempDatabase, deadline);
      const store = new ManagementStore({ database: tempDatabase });
      store.initialize();
      this.remaining(deadline);
      const result = this.project(store, first, this.projectionOptions);
      this.remaining(deadline);
      store.writeClassificationAudit(buildClassificationAudit(first, this.projectionOptions));
      const projectedCount = projectionCount(result.projection);
      this.observation(first, startedAt, fingerprint, projectedCount, store, false);
      this.verify(store, Number(first.count || 0));
      if (this.beforeActivate) this.beforeActivate({ tempDatabase, source: first, store });
      this.remaining(deadline);
      const activationSource = this.scan(deadline);
      if (sourceFingerprint(activationSource) !== fingerprint)
        throw new Error('SOURCE_CHANGED_DURING_RUN');
      this.remaining(deadline);
      this.activate(tempDatabase, deadline);
      tempDatabase = null;
      return {
        status: first.errors?.length ? 'degraded' : 'success',
        unchanged: false,
        fingerprint,
        projectedCount,
      };
    } catch (error) {
      const code = /^[A-Z0-9_]+$/.test(error.message) ? error.message : 'PROJECTION_BUILD_FAILED';
      return this.recordFailure(startedAt, code);
    } finally {
      if (tempDatabase) {
        fs.rmSync(tempDatabase, { force: true });
        for (const suffix of ['-wal', '-shm'])
          fs.rmSync(`${tempDatabase}${suffix}`, { force: true });
      }
      lock.release();
    }
  }

  previousFingerprint(fingerprint) {
    if (!fs.existsSync(this.database)) return false;
    try {
      const rows = new ManagementStore({ database: this.database }).query(
        "SELECT value FROM projection_checkpoint WHERE checkpoint_key='last_success_fingerprint'"
      );
      return rows[0]?.value === fingerprint;
    } catch (_) {
      return false;
    }
  }
}

module.exports = {
  DEFAULT_LOCK_STALE_MS,
  ProjectionLock,
  ProjectionRunner,
  canonical,
  opaqueSourceId,
  sourceFingerprint,
  sourceHealth,
  securePrecreate,
};
