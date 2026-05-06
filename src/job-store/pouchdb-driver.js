'use strict';

const FileJobStoreDriver = require('./file-driver');

/**
 * v0.45.1 rollout note:
 * This driver is intentionally compatibility-first and delegates to file storage
 * while exposing a dedicated driver identity and config shape.
 *
 * The follow-up implementation will replace this shim with native PouchDB
 * persistence and conflict-resolution semantics.
 */
class PouchDbJobStoreDriver extends FileJobStoreDriver {
  constructor(options = {}) {
    super(options);
    this.dbPath = options.dbPath || process.env.JOB_STORE_POUCHDB_PATH || './data/jobs-pouchdb';
  }

  getInfo() {
    return {
      name: 'pouchdb',
      mode: 'compat-shim',
      jobsDir: this.jobsDir,
      dbPath: this.dbPath,
    };
  }
}

module.exports = PouchDbJobStoreDriver;
