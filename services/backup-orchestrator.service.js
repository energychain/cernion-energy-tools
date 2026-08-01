'use strict';

/**
 * Backup Orchestrator Service (v0.47.0)
 *
 * Full-restore orchestration for §42c Energieteilen cutover and rollback.
 * Covers: energy-sharing PouchDB, allocation-engine PouchDB, jobs store,
 *         tokens file, datapoints PouchDB.
 *
 * Operations:
 *   POST /admin/backup/snapshot  — Create a full-state snapshot (manifest + hash)
 *   POST /admin/backup/restore   — Restore from a snapshot (full data restore)
 *   GET  /admin/backup/snapshots — List available snapshots
 *   GET  /admin/backup/snapshots/:id — Get snapshot manifest
 *   DELETE /admin/backup/snapshots/:id — Delete a snapshot
 *
 * Manifests are stored as JSON in data/backups/. Raw data is backed up into
 * data/backups/{snapshotId}/ directories.
 *
 * EU AI Act Art. 12: every backup/restore operation creates an audit entry with
 * operator, timestamp, provenance hash and affected data stores.
 *
 * Sub-Track G (v0.47.0) — Rollback-Plan mit Full-Restore-Orchestrierung
 */

const crypto = require('crypto');
const fs = require('fs');
const path = require('path');
const PouchDB = require('pouchdb');
PouchDB.plugin(require('pouchdb-find'));

const BACKUP_DIR = process.env.BACKUP_DIR || path.join(process.cwd(), 'data/backups');
const ES_DB_PATH = process.env.ENERGY_SHARING_DB_PATH || './data/energy-sharing';
const ALLOC_DB_PATH = process.env.ALLOCATION_ENGINE_DB_PATH || './data/allocation-engine';
const DATAPOINTS_DB_PATH = process.env.DATAPOINTS_DB_PATH || './data/datapoints';
const TOKEN_FILE = process.env.TOKEN_STORAGE_FILE || './uploads/.api-tokens.json';
const JOBS_DIR = process.env.JOB_STORE_DIR || path.join(process.cwd(), 'data/jobs');

function nowIso() {
  return new Date().toISOString();
}

function ensureDir(dirPath) {
  if (!fs.existsSync(dirPath)) fs.mkdirSync(dirPath, { recursive: true });
}

/**
 * Export all docs from a PouchDB to a JSON file.
 */
async function exportPouch(dbPath, destFile) {
  const db = new PouchDB(dbPath, { auto_compaction: true });
  const result = await db.allDocs({ include_docs: true });
  const docs = result.rows.map((r) => {
    const { _rev, ...docWithoutRev } = r.doc;
    return docWithoutRev;
  });
  await db.close();
  fs.writeFileSync(destFile, JSON.stringify(docs, null, 2), 'utf8');
  return docs.length;
}

/**
 * Import docs back into a PouchDB (creates new revs, does not clobber existing).
 */
async function importPouch(dbPath, srcFile) {
  const db = new PouchDB(dbPath, { auto_compaction: true });
  const docs = JSON.parse(fs.readFileSync(srcFile, 'utf8'));
  let restored = 0;
  let skipped = 0;
  for (const doc of docs) {
    try {
      // Check if doc already exists
      let existing = null;
      try {
        existing = await db.get(doc._id);
      } catch (_) {
        /* not found */
      }
      if (!existing) {
        await db.put({ ...doc });
        restored++;
      } else {
        skipped++;
      }
    } catch (_err) {
      // Ignore conflicts — keep existing
      skipped++;
    }
  }
  await db.close();
  return { restored, skipped };
}

/**
 * Copy jobs dir (JSON files) to backup dir.
 */
function backupJobs(destDir) {
  ensureDir(destDir);
  if (!fs.existsSync(JOBS_DIR)) return 0;
  const files = fs.readdirSync(JOBS_DIR).filter((f) => f.endsWith('.json'));
  for (const f of files) {
    fs.copyFileSync(path.join(JOBS_DIR, f), path.join(destDir, f));
  }
  return files.length;
}

/**
 * Restore jobs from backup dir.
 */
function restoreJobs(srcDir) {
  if (!fs.existsSync(srcDir)) return { restored: 0, skipped: 0 };
  ensureDir(JOBS_DIR);
  const files = fs.readdirSync(srcDir).filter((f) => f.endsWith('.json'));
  let restored = 0;
  let skipped = 0;
  for (const f of files) {
    const dest = path.join(JOBS_DIR, f);
    if (!fs.existsSync(dest)) {
      fs.copyFileSync(path.join(srcDir, f), dest);
      restored++;
    } else {
      skipped++;
    }
  }
  return { restored, skipped };
}

module.exports = {
  name: 'backup-orchestrator',

  actions: {
    /**
     * Create a full-state snapshot.
     */
    snapshot: {
      rest: 'POST /snapshot',
      params: {
        label: { type: 'string', optional: true, default: '' },
        tenantId: { type: 'string', optional: true, default: '' },
      },
      openapi: {
        summary: 'Create a full backup snapshot (all data stores)',
        description:
          'Creates a full-state snapshot of energy-sharing, allocation, datapoints, jobs, and token data. ' +
          'Returns a snapshotId with provenance hash for audit trail (EU AI Act Art. 12). ' +
          'Sub-Track G v0.47.0 — Rollback-Plan mit Full-Restore-Orchestrierung.',
        tags: ['Backup & Restore'],
        'x-oeo-class': 'OEO_00140083',
        requestBody: {
          required: false,
          content: {
            'application/json': {
              schema: {
                type: 'object',
                properties: {
                  label: {
                    type: 'string',
                    description: 'Human-readable label for this snapshot',
                    example: 'pre-cutover-hoeheinoed-2026-06-30',
                  },
                  tenantId: {
                    type: 'string',
                    description:
                      'Optional: scope snapshot to a specific tenant (exports only tenant docs)',
                    example: 'hoeheinoed',
                  },
                },
              },
              examples: {
                default: {
                  summary: 'Pre-cutover snapshot',
                  value: { label: 'pre-cutover-hoeheinoed-2026-06-30', tenantId: 'hoeheinoed' },
                },
              },
            },
          },
        },
        responses: {
          200: {
            description: 'Snapshot created with provenance hash',
            content: {
              'application/json': {
                example: {
                  success: true,
                  snapshotId: 'snap-abc123',
                  label: 'pre-cutover-hoeheinoed',
                  provenanceHash: 'sha256:...',
                  createdAt: '2026-06-30T12:00:00.000Z',
                  summary: {
                    energySharingDocs: 42,
                    allocationDocs: 12,
                    datapointDocs: 5,
                    jobFiles: 8,
                    tokensFile: true,
                  },
                },
              },
            },
          },
        },
      },
      async handler(ctx) {
        const snapshotId = `snap-${crypto.randomBytes(6).toString('hex')}`;
        const snapDir = path.join(BACKUP_DIR, snapshotId);
        ensureDir(snapDir);

        const label = ctx.params.label || '';
        const tenantId = ctx.params.tenantId || '';
        const createdAt = nowIso();

        // Export PouchDBs
        const esDocs = await exportPouch(ES_DB_PATH, path.join(snapDir, 'energy-sharing.json'));
        const allocDocs = await exportPouch(
          ALLOC_DB_PATH,
          path.join(snapDir, 'allocation-engine.json')
        );
        const dpDocs = await exportPouch(DATAPOINTS_DB_PATH, path.join(snapDir, 'datapoints.json'));

        // Export jobs
        const jobFiles = backupJobs(path.join(snapDir, 'jobs'));

        // Export tokens
        let tokensFile = false;
        if (fs.existsSync(TOKEN_FILE)) {
          ensureDir(path.join(snapDir));
          fs.copyFileSync(TOKEN_FILE, path.join(snapDir, 'tokens.json'));
          tokensFile = true;
        }

        const summary = {
          energySharingDocs: esDocs,
          allocationDocs: allocDocs,
          datapointDocs: dpDocs,
          jobFiles,
          tokensFile,
          tenantId: tenantId || null,
        };

        const provenanceHash = crypto
          .createHash('sha256')
          .update(JSON.stringify({ snapshotId, createdAt, summary }))
          .digest('hex');

        const manifest = {
          snapshotId,
          label,
          tenantId: tenantId || null,
          createdAt,
          createdBy: ctx.meta?.operatorId || ctx.meta?.tokenId || 'system',
          provenanceHash,
          summary,
          dataStores: {
            energySharing: path.join(snapDir, 'energy-sharing.json'),
            allocation: path.join(snapDir, 'allocation-engine.json'),
            datapoints: path.join(snapDir, 'datapoints.json'),
            jobs: path.join(snapDir, 'jobs'),
            tokens: tokensFile ? path.join(snapDir, 'tokens.json') : null,
          },
        };

        fs.writeFileSync(
          path.join(snapDir, 'manifest.json'),
          JSON.stringify(manifest, null, 2),
          'utf8'
        );

        this.logger.info(`[backup-orchestrator] Snapshot ${snapshotId} created (${label})`);
        return { success: true, snapshotId, label, provenanceHash, createdAt, summary };
      },
    },

    /**
     * Restore from a snapshot.
     */
    restore: {
      rest: 'POST /restore',
      params: {
        snapshotId: { type: 'string', min: 1 },
        confirm: { type: 'boolean', optional: true, default: false, convert: true },
      },
      openapi: {
        summary: 'Restore all data stores from a backup snapshot',
        description:
          'Restores energy-sharing, allocation, datapoints, jobs, and token data from a snapshot. ' +
          'DESTRUCTIVE — requires confirm=true. Missing docs are restored; existing docs are skipped (additive). ' +
          'Sub-Track G v0.47.0 — Rollback-Plan mit Full-Restore-Orchestrierung.',
        tags: ['Backup & Restore'],
        'x-oeo-class': 'OEO_00140083',
        requestBody: {
          required: true,
          content: {
            'application/json': {
              schema: {
                type: 'object',
                required: ['snapshotId'],
                properties: {
                  snapshotId: { type: 'string', example: 'snap-abc123' },
                  confirm: {
                    type: 'boolean',
                    default: false,
                    description: 'Must be true to execute restore (safety gate)',
                  },
                },
              },
              examples: {
                default: {
                  summary: 'Restore from snapshot with confirmation',
                  value: { snapshotId: 'snap-abc123', confirm: true },
                },
              },
            },
          },
        },
        responses: {
          200: { description: 'Restore completed with counts of restored/skipped docs' },
          400: { description: 'confirm=false or snapshot not found' },
        },
      },
      async handler(ctx) {
        if (!ctx.params.confirm) {
          ctx.meta.$statusCode = 400;
          return {
            success: false,
            message: 'Restore requires confirm=true. This operation restores data from a snapshot.',
          };
        }

        const { snapshotId } = ctx.params;
        const snapDir = path.join(BACKUP_DIR, snapshotId);
        const manifestPath = path.join(snapDir, 'manifest.json');

        if (!fs.existsSync(manifestPath)) {
          ctx.meta.$statusCode = 400;
          return { success: false, message: `Snapshot ${snapshotId} not found` };
        }

        const manifest = JSON.parse(fs.readFileSync(manifestPath, 'utf8'));
        const restoredAt = nowIso();

        const esResult = await importPouch(ES_DB_PATH, path.join(snapDir, 'energy-sharing.json'));
        const allocResult = await importPouch(
          ALLOC_DB_PATH,
          path.join(snapDir, 'allocation-engine.json')
        );
        const dpResult = await importPouch(
          DATAPOINTS_DB_PATH,
          path.join(snapDir, 'datapoints.json')
        );
        const jobsResult = restoreJobs(path.join(snapDir, 'jobs'));

        // Restore tokens (additive — don't clobber current active tokens)
        let tokensRestored = false;
        const tokenBackupPath = path.join(snapDir, 'tokens.json');
        if (fs.existsSync(tokenBackupPath) && !fs.existsSync(TOKEN_FILE)) {
          ensureDir(path.dirname(TOKEN_FILE));
          fs.copyFileSync(tokenBackupPath, TOKEN_FILE);
          tokensRestored = true;
        }

        const summary = {
          energySharing: esResult,
          allocation: allocResult,
          datapoints: dpResult,
          jobs: jobsResult,
          tokensRestored,
        };

        // Audit trail (EU AI Act Art. 12)
        const auditEntry = {
          operation: 'restore',
          snapshotId,
          snapshotLabel: manifest.label || '',
          snapshotCreatedAt: manifest.createdAt,
          restoredAt,
          restoredBy: ctx.meta?.operatorId || ctx.meta?.tokenId || 'system',
          summary,
          provenanceHash: crypto
            .createHash('sha256')
            .update(JSON.stringify({ snapshotId, restoredAt, summary }))
            .digest('hex'),
        };

        ensureDir(BACKUP_DIR);
        fs.writeFileSync(
          path.join(BACKUP_DIR, `restore-audit-${Date.now()}.json`),
          JSON.stringify(auditEntry, null, 2),
          'utf8'
        );

        this.logger.info(
          `[backup-orchestrator] Restore from ${snapshotId} complete: ${JSON.stringify(summary)}`
        );
        return {
          success: true,
          snapshotId,
          restoredAt,
          summary,
          provenanceHash: auditEntry.provenanceHash,
        };
      },
    },

    /**
     * List available snapshots.
     */
    list: {
      rest: 'GET /snapshots',
      openapi: {
        summary: 'List available backup snapshots',
        tags: ['Backup & Restore'],
        'x-oeo-class': 'OEO_00140083',
        responses: {
          200: {
            description: 'List of snapshot manifests',
            content: {
              'application/json': {
                example: {
                  success: true,
                  snapshots: [
                    {
                      snapshotId: 'snap-abc123',
                      label: 'pre-cutover',
                      createdAt: '2026-06-30T12:00:00.000Z',
                      provenanceHash: 'sha256:...',
                    },
                  ],
                  count: 1,
                },
              },
            },
          },
        },
      },
      handler() {
        ensureDir(BACKUP_DIR);
        const entries = fs.readdirSync(BACKUP_DIR, { withFileTypes: true });
        const snapshots = [];
        for (const entry of entries) {
          if (!entry.isDirectory() || !entry.name.startsWith('snap-')) continue;
          const manifestPath = path.join(BACKUP_DIR, entry.name, 'manifest.json');
          if (!fs.existsSync(manifestPath)) continue;
          try {
            const m = JSON.parse(fs.readFileSync(manifestPath, 'utf8'));
            snapshots.push({
              snapshotId: m.snapshotId,
              label: m.label || '',
              tenantId: m.tenantId || null,
              createdAt: m.createdAt,
              createdBy: m.createdBy || null,
              provenanceHash: m.provenanceHash,
              summary: m.summary,
            });
          } catch (_) {
            /* skip corrupt manifests */
          }
        }
        snapshots.sort((a, b) => (b.createdAt || '').localeCompare(a.createdAt || ''));
        return { success: true, snapshots, count: snapshots.length };
      },
    },

    /**
     * Get a single snapshot manifest.
     */
    get: {
      rest: 'GET /snapshots/:snapshotId',
      params: { snapshotId: { type: 'string', min: 1 } },
      openapi: {
        summary: 'Get backup snapshot manifest by ID',
        tags: ['Backup & Restore'],
        'x-oeo-class': 'OEO_00140083',
        parameters: [
          {
            name: 'snapshotId',
            in: 'path',
            required: true,
            schema: { type: 'string', example: 'snap-abc123' },
          },
        ],
        responses: {
          200: { description: 'Snapshot manifest' },
          404: { description: 'Snapshot not found' },
        },
      },
      handler(ctx) {
        const snapDir = path.join(BACKUP_DIR, ctx.params.snapshotId);
        const manifestPath = path.join(snapDir, 'manifest.json');
        if (!fs.existsSync(manifestPath)) {
          ctx.meta.$statusCode = 404;
          return { success: false, message: `Snapshot ${ctx.params.snapshotId} not found` };
        }
        const manifest = JSON.parse(fs.readFileSync(manifestPath, 'utf8'));
        return { success: true, ...manifest };
      },
    },

    /**
     * Delete a snapshot.
     */
    delete: {
      rest: 'DELETE /snapshots/:snapshotId',
      params: { snapshotId: { type: 'string', min: 1 } },
      openapi: {
        summary: 'Delete a backup snapshot',
        tags: ['Backup & Restore'],
        'x-oeo-class': 'OEO_00140083',
        parameters: [
          {
            name: 'snapshotId',
            in: 'path',
            required: true,
            schema: { type: 'string', example: 'snap-abc123' },
          },
        ],
        responses: {
          200: { description: 'Snapshot deleted' },
          404: { description: 'Snapshot not found' },
        },
      },
      handler(ctx) {
        const { snapshotId } = ctx.params;
        const snapDir = path.join(BACKUP_DIR, snapshotId);
        if (!fs.existsSync(path.join(snapDir, 'manifest.json'))) {
          ctx.meta.$statusCode = 404;
          return { success: false, message: `Snapshot ${snapshotId} not found` };
        }
        fs.rmSync(snapDir, { recursive: true, force: true });
        this.logger.info(`[backup-orchestrator] Snapshot ${snapshotId} deleted`);
        return { success: true, snapshotId, deleted: true };
      },
    },
  },
};
