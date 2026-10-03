'use strict';

// Minimal PouchDB test double at the lifecycle seam; copied values model disk isolation.
function createJournalDb() {
  const docs = new Map();
  const copy = (value) => JSON.parse(JSON.stringify(value));
  return {
    async createIndex() {},
    async put(doc) {
      if (docs.has(doc._id)) throw Object.assign(new Error('Conflict'), { status: 409 });
      docs.set(doc._id, { ...copy(doc), _rev: '1' });
      return { id: doc._id, rev: '1' };
    },
    async allDocs(options = {}) {
      return {
        rows: [...docs.values()]
          .filter(
            (doc) =>
              (!options.startkey || doc._id >= options.startkey) &&
              (!options.endkey || doc._id <= options.endkey)
          )
          .map((doc) => ({ id: doc._id, doc: copy(doc) })),
      };
    },
    async remove(doc) {
      docs.delete(doc._id);
    },
    async compact() {},
    async close() {},
  };
}

module.exports = { createJournalDb };
