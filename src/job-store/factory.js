'use strict';

const FileJobStoreDriver = require('./file-driver');
const PouchDbJobStoreDriver = require('./pouchdb-driver');
const RedisCompatJobStoreDriver = require('./redis-compat-driver');

function normalizeDriverName(raw) {
  return String(raw || 'file')
    .trim()
    .toLowerCase();
}

function createDriver(logger = console) {
  const name = normalizeDriverName(process.env.JOB_STORE_DRIVER);

  if (name === 'file') return new FileJobStoreDriver();

  if (name === 'pouchdb') {
    logger.warn?.('[job-store] JOB_STORE_DRIVER=pouchdb active in compatibility mode (v0.45.1).');
    return new PouchDbJobStoreDriver();
  }

  if (name === 'redis-compat' || name === 'redis' || name === 'valkey') {
    logger.warn?.(
      '[job-store] JOB_STORE_DRIVER=redis-compat active in compatibility mode (v0.45.1).'
    );
    return new RedisCompatJobStoreDriver();
  }

  logger.warn?.(`[job-store] Unknown JOB_STORE_DRIVER="${name}". Falling back to file.`);
  return new FileJobStoreDriver();
}

module.exports = {
  createDriver,
  normalizeDriverName,
};
