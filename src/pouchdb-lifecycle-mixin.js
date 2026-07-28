'use strict';

/**
 * Shared Moleculer mixin for the PouchDB-backed service lifecycle
 * (settings.dbPath / created / started-with-createIndex / stopped) that was
 * previously hand-copied across ~60 services. Moleculer chains `created`,
 * `started`, and `stopped` hooks across mixins and the service's own schema
 * (mixin first for created/started, service's own hook first for stopped),
 * so a service that also needs extra init/teardown logic (timers, seeding,
 * overlay restore, ...) simply keeps its own created/started/stopped hooks
 * for that extra part — this mixin only owns the PouchDB instance itself.
 *
 * created() always synchronously mkdir -p's the target directory before
 * opening it. This isn't just for services that used to do this by hand
 * (e.g. mqtt-broker): when several services' created() hooks run back to
 * back during broker.start() and their db paths share a not-yet-existing
 * parent directory (e.g. the repo-root `./data/`), leveldown's own internal
 * directory creation can race and intermittently fail with
 * "IO error: <path>/LOCK: No such file or directory" — root-caused and
 * reproduced in isolation (two services' test suites run together, ~always
 * failing without this, ~always passing with it) while investigating
 * pre-existing test flakiness. A synchronous mkdirSync before `new PouchDB()`
 * removes the race entirely, since Node's sync fs call has no equivalent
 * ordering hazard.
 *
 * @param {object} options
 * @param {string} [options.dbPathEnvVar] - env var name overriding the default path
 * @param {string} options.defaultDbPath - fallback PouchDB path
 * @param {string[][]} [options.indexes] - field arrays passed to db.createIndex per entry
 * @param {string} [options.dbProperty] - property name the PouchDB instance is assigned to (default: 'db')
 * @param {string} [options.logLabel] - label used in the ready log line (default: service name)
 * @param {string} [options.settingsKey] - settings property holding the path (default: 'dbPath'); override for services whose callers/tests already override a differently-named settings key (e.g. `decisionAuditDbPath`) for per-test DB isolation
 */
function createPouchDbLifecycleMixin({
  dbPathEnvVar,
  defaultDbPath,
  indexes = [],
  dbProperty = 'db',
  logLabel,
  settingsKey = 'dbPath',
} = {}) {
  const PouchDB = require('pouchdb');
  PouchDB.plugin(require('pouchdb-find'));

  const dbPath = (dbPathEnvVar && process.env[dbPathEnvVar]) || defaultDbPath;

  return {
    settings: {
      [settingsKey]: dbPath,
    },

    created() {
      const fs = require('fs');
      const path = require('path');
      const resolvedDbPath = this.settings[settingsKey];
      const resolved = path.resolve(resolvedDbPath);
      if (!fs.existsSync(resolved)) {
        fs.mkdirSync(resolved, { recursive: true });
      }
      this[dbProperty] = new PouchDB(resolvedDbPath, { auto_compaction: true });
    },

    async started() {
      for (const fields of indexes) {
        await this[dbProperty].createIndex({ index: { fields } });
      }
      this.logger.info(`[${logLabel || this.name}] PouchDB ready at ${this.settings[settingsKey]}`);
    },

    async stopped() {
      if (this[dbProperty]) {
        await this[dbProperty].close();
      }
    },
  };
}

module.exports = { createPouchDbLifecycleMixin };
