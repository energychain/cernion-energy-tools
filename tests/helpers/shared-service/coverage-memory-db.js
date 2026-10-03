'use strict';

function createMemoryDb() {
  const docs = new Map();
  let writes = 0;
  return {
    get writes() {
      return writes;
    },
    docs,
    async put(input) {
      const previous = docs.get(input._id);
      if (previous && previous._rev !== input._rev)
        throw Object.assign(new Error('Conflict'), { status: 409 });
      const rev = String(Number(previous?._rev || 0) + 1);
      docs.set(input._id, structuredClone({ ...input, _rev: rev }));
      writes++;
      return { rev };
    },
    async allDocs({ startkey, endkey, skip = 0, limit = 256 }) {
      const { compareCanonicalStrings } = require('../../../src/canonical-order');
      return {
        rows: [...docs.keys()]
          .filter((id) => id >= startkey && id <= endkey)
          .sort(compareCanonicalStrings)
          .slice(skip, skip + limit)
          .map((id) => ({ id, doc: structuredClone(docs.get(id)) })),
      };
    },
    async remove(doc) {
      docs.delete(doc._id);
      writes++;
    },
    async close() {},
  };
}

module.exports = { createMemoryDb };
