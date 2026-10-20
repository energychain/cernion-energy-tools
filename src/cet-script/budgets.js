'use strict';
const { performance } = require('node:perf_hooks');
const { fail } = require('./errors');
const DEFAULTS = Object.freeze({
  steps: 5000000,
  runtimeMs: 30000,
  sqlQueries: 50,
  sqlRowsPerQuery: 200000,
  sqlRowsTotal: 1000000,
  opCalls: 20,
  graphAccesses: 200,
  recursionDepth: 200,
  resultBytes: 2 * 1024 * 1024,
  derivedEntries: 10,
  derivedEntryBytes: 256 * 1024,
  sourceBytes: 65536,
  astNodes: 20000,
  valueBytes: 8 * 1024 * 1024,
  memoryBytes: 64 * 1024 * 1024,
  collectionItems: 200000,
});
class Budgets {
  constructor(overrides = {}) {
    this.limits = { ...DEFAULTS };
    for (const [key, value] of Object.entries(overrides)) {
      if (!Object.hasOwn(DEFAULTS, key) || !Number.isSafeInteger(value) || value < 1)
        fail('RUNTIME_ERROR', 'Invalid budget configuration');
      this.limits[key] = value;
    }
    this.started = performance.now();
    this.used = Object.create(null);
    this.stopped = false;
    this.failure = null;
  }
  exceed(name, node) {
    this.failure ||= { name, node };
    fail('BUDGET_EXCEEDED', `Budget exceeded: ${this.failure.name}`, this.failure.node, {
      budget: this.failure.name,
    });
  }
  check(node) {
    if (this.failure) this.exceed(this.failure.name, this.failure.node);
    if (this.stopped || this.remaining() <= 0) this.exceed('runtimeMs', node);
  }
  remaining() {
    return this.limits.runtimeMs - (performance.now() - this.started);
  }
  tick(node, count = 1) {
    this.check(node);
    this.charge('steps', count, node);
  }
  charge(name, count = 1, node) {
    this.used[name] = (this.used[name] || 0) + count;
    this.bound(name, this.used[name], node);
  }
  bound(name, count, node) {
    if (count > this.limits[name]) this.exceed(name, node);
  }
  allocate(bytes, node) {
    this.charge('memoryBytes', Math.max(0, Math.ceil(bytes)), node);
  }
  async wait(promise, node) {
    this.check(node);
    let timer;
    try {
      return await Promise.race([
        promise,
        new Promise((_, reject) => {
          timer = setTimeout(
            () => {
              try {
                this.exceed('runtimeMs', node);
              } catch (error) {
                reject(error);
              }
            },
            Math.max(1, this.remaining())
          );
        }),
      ]);
    } finally {
      clearTimeout(timer);
      this.check(node);
    }
  }
}
module.exports = { Budgets, DEFAULTS };
