'use strict';

const clone = (value) => JSON.parse(JSON.stringify(value));

// Test double at the lifecycle mixin's constructor seam, with revision checks.
function memoryPouch(stores = new Map()) {
  return class MemoryPouch {
    static plugin() {}
    constructor(name) {
      if (!stores.has(name)) stores.set(name, new Map());
      this.records = stores.get(name);
    }
    async createIndex() {
      return { result: 'created' };
    }
    async get(id) {
      if (!this.records.has(id)) throw Object.assign(new Error('missing'), { status: 404 });
      return clone(this.records.get(id));
    }
    async put(document) {
      const old = this.records.get(document._id);
      if ((old && old._rev !== document._rev) || (!old && document._rev))
        throw Object.assign(new Error('conflict'), { status: 409 });
      const rev = String(Number(old?._rev || 0) + 1);
      this.records.set(document._id, clone({ ...document, _rev: rev }));
      return { ok: true, id: document._id, rev };
    }
    async allDocs({ startkey = '', endkey = '\uffff', include_docs = false } = {}) {
      return {
        rows: [...this.records]
          .filter(([id]) => id >= startkey && id <= endkey)
          .map(([id, doc]) => ({ id, ...(include_docs ? { doc: clone(doc) } : {}) })),
      };
    }
    async remove(document) {
      const old = await this.get(document._id);
      if (old._rev !== document._rev) throw Object.assign(new Error('conflict'), { status: 409 });
      this.records.delete(document._id);
      return { ok: true, id: document._id };
    }
    async close() {}
  };
}

module.exports = { memoryPouch };
