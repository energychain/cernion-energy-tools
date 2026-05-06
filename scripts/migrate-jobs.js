#!/usr/bin/env node

'use strict';

const fs = require('fs');
const path = require('path');
const PouchDB = require('pouchdb');
PouchDB.plugin(require('pouchdb-find'));

const sourceDir = process.env.JOB_STORE_DIR || path.join(__dirname, '..', 'data', 'jobs');
const targetPath = process.env.JOB_STORE_POUCHDB_PATH || path.join('data', 'jobs-pouchdb');
const targetDb = new PouchDB(targetPath, { auto_compaction: true });

function safeReadJson(filePath) {
  try {
    return JSON.parse(fs.readFileSync(filePath, 'utf-8'));
  } catch {
    return null;
  }
}

async function migrate() {
  if (!fs.existsSync(sourceDir)) {
    console.log(`[migrate-jobs] source directory not found: ${sourceDir}`);
    return;
  }

  const progressFiles = fs.readdirSync(sourceDir).filter((f) => f.endsWith('.progress.json'));
  console.log(`[migrate-jobs] found ${progressFiles.length} progress files in ${sourceDir}`);

  let migrated = 0;
  let skipped = 0;

  for (const filename of progressFiles) {
    const jobId = filename.replace('.progress.json', '');
    const progress = safeReadJson(path.join(sourceDir, filename));
    if (!progress) {
      skipped += 1;
      continue;
    }

    const result = safeReadJson(path.join(sourceDir, `${jobId}.result.json`));
    const doc = {
      _id: `job:${jobId}`,
      type: 'job',
      jobId,
      progress,
      result,
      migratedAt: new Date().toISOString(),
      source: 'file-job-store',
    };

    try {
      const existing = await targetDb.get(doc._id);
      await targetDb.put({ ...doc, _rev: existing._rev });
      migrated += 1;
    } catch (err) {
      if (err.status === 404 || err.name === 'not_found') {
        await targetDb.put(doc);
        migrated += 1;
      } else {
        skipped += 1;
      }
    }
  }

  await targetDb.close();
  console.log(`[migrate-jobs] done: migrated=${migrated}, skipped=${skipped}, target=${targetPath}`);
}

migrate().catch((err) => {
  console.error('[migrate-jobs] failed:', err.message);
  process.exit(1);
});
