#!/usr/bin/env node
'use strict';

/**
 * scripts/migrate-tenant-energy-sharing.js
 *
 * Automated migration: assigns all un-tenanted energy-sharing and allocation
 * records to a specified tenantId by creating new tenant-prefixed documents.
 *
 * Usage:
 *   node scripts/migrate-tenant-energy-sharing.js --tenant hoeheinoed [--dry-run]
 *
 * Migrates:
 *   - data/energy-sharing PouchDB:  es:{id}   → es:{tenant}:{id}
 *   - data/allocation-engine PouchDB: alloc:{id} → alloc:{tenant}:{id}
 *
 * Migration is idempotent: already-prefixed docs are skipped.
 * A manifest JSON is written to data/migrations/ for audit trail (EU AI Act Art. 12).
 *
 * Sub-Track B (v0.47.0) — Pilot-Tenant Höheinöd produktiv
 */

const crypto = require('crypto');
const fs = require('fs');
const path = require('path');
const PouchDB = require('pouchdb');
PouchDB.plugin(require('pouchdb-find'));

// ---------------------------------------------------------------------------
// CLI args
// ---------------------------------------------------------------------------
const args = process.argv.slice(2);
const tenantArg = args.find((a) => a.startsWith('--tenant=') || a === '--tenant');
const tenantId = tenantArg
  ? (tenantArg.includes('=') ? tenantArg.split('=')[1] : args[args.indexOf('--tenant') + 1])
  : null;
const dryRun = args.includes('--dry-run');

if (!tenantId || !/^[a-z0-9-]{1,64}$/.test(tenantId)) {
  console.error('Usage: node scripts/migrate-tenant-energy-sharing.js --tenant <tenantId> [--dry-run]');
  console.error('tenantId must match /^[a-z0-9-]{1,64}$/');
  process.exit(1);
}

const ES_DB_PATH = process.env.ENERGY_SHARING_DB_PATH || path.join(__dirname, '../data/energy-sharing');
const ALLOC_DB_PATH = process.env.ALLOCATION_ENGINE_DB_PATH || path.join(__dirname, '../data/allocation-engine');
const MANIFEST_DIR = path.join(__dirname, '../data/migrations');

// ---------------------------------------------------------------------------
// Migration helpers
// ---------------------------------------------------------------------------

/**
 * Migrate un-tenanted docs in a PouchDB to use a tenant-prefixed _id.
 * @param {PouchDB.Database} db
 * @param {string} prefix - 'es' | 'alloc'
 * @param {string} tenant
 * @param {boolean} dry
 * @returns {{ migrated: number; skipped: number; errors: string[]; docs: object[] }}
 */
async function migrateDb(db, prefix, tenant, dry) {
  const result = await db.allDocs({
    include_docs: true,
    startkey: `${prefix}:`,
    endkey: `${prefix}:\ufff0`,
  });

  let migrated = 0;
  let skipped = 0;
  const errors = [];
  const docs = [];

  for (const row of result.rows) {
    const doc = row.doc;
    const oldId = doc._id;

    // Skip if already tenant-prefixed (pattern: prefix:tenant:uuid)
    const tenantPrefixPattern = new RegExp(`^${prefix}:[a-z0-9-]+:[0-9a-f-]{36}$`);
    if (tenantPrefixPattern.test(oldId)) {
      skipped++;
      continue;
    }

    const uuidPart = oldId.replace(`${prefix}:`, '');
    const newId = `${prefix}:${tenant}:${uuidPart}`;

    docs.push({ oldId, newId, communityId: doc.communityId || '', createdAt: doc.createdAt || '' });

    if (dry) {
      migrated++;
      continue;
    }

    try {
      // Create new doc under tenant-prefixed key
      const newDoc = { ...doc, _id: newId, tenantId: tenant };
      delete newDoc._rev;
      await db.put(newDoc);

      // Mark old doc as migrated (keep for audit, soft-delete flag)
      await db.put({ ...doc, _migrated_to: newId, _migrated_at: new Date().toISOString() });

      migrated++;
    } catch (err) {
      errors.push(`Failed ${oldId} → ${newId}: ${err.message}`);
    }
  }

  return { migrated, skipped, errors, docs };
}

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------
async function main() {
  console.log(`[migrate-tenant-energy-sharing] tenantId=${tenantId} dryRun=${dryRun}`);

  const esDb = new PouchDB(ES_DB_PATH, { auto_compaction: true });
  const allocDb = new PouchDB(ALLOC_DB_PATH, { auto_compaction: true });

  const esResult = await migrateDb(esDb, 'es', tenantId, dryRun);
  const allocResult = await migrateDb(allocDb, 'alloc', tenantId, dryRun);

  await esDb.close();
  await allocDb.close();

  // ---------------------------------------------------------------------------
  // Manifest (EU AI Act Art. 12 audit trail)
  // ---------------------------------------------------------------------------
  const manifest = {
    migration: 'migrate-tenant-energy-sharing',
    version: '0.47.0',
    tenantId,
    dryRun,
    executedAt: new Date().toISOString(),
    executedBy: process.env.USER || 'system',
    results: {
      energySharing: {
        migrated: esResult.migrated,
        skipped: esResult.skipped,
        errors: esResult.errors,
        docs: esResult.docs,
      },
      allocation: {
        migrated: allocResult.migrated,
        skipped: allocResult.skipped,
        errors: allocResult.errors,
        docs: allocResult.docs,
      },
    },
    provenanceHash: crypto
      .createHash('sha256')
      .update(JSON.stringify({ tenantId, esResult, allocResult }))
      .digest('hex'),
  };

  if (!dryRun) {
    if (!fs.existsSync(MANIFEST_DIR)) fs.mkdirSync(MANIFEST_DIR, { recursive: true });
    const manifestPath = path.join(
      MANIFEST_DIR,
      `migrate-tenant-${tenantId}-${Date.now()}.json`
    );
    fs.writeFileSync(manifestPath, JSON.stringify(manifest, null, 2), 'utf8');
    console.log(`[migrate-tenant-energy-sharing] Manifest written: ${manifestPath}`);
  }

  console.log(`[migrate-tenant-energy-sharing] energy-sharing: migrated=${esResult.migrated} skipped=${esResult.skipped} errors=${esResult.errors.length}`);
  console.log(`[migrate-tenant-energy-sharing] allocation:      migrated=${allocResult.migrated} skipped=${allocResult.skipped} errors=${allocResult.errors.length}`);

  const totalErrors = esResult.errors.length + allocResult.errors.length;
  if (totalErrors > 0) {
    console.error('[migrate-tenant-energy-sharing] Errors:');
    [...esResult.errors, ...allocResult.errors].forEach((e) => console.error(' ', e));
    process.exit(1);
  }

  if (dryRun) {
    console.log('[migrate-tenant-energy-sharing] DRY RUN — no changes written. Re-run without --dry-run to apply.');
  } else {
    console.log('[migrate-tenant-energy-sharing] Migration complete.');
  }
}

main().catch((err) => {
  console.error('[migrate-tenant-energy-sharing] Fatal:', err.message);
  process.exit(1);
});
