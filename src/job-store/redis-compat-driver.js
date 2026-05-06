'use strict';

const FileJobStoreDriver = require('./file-driver');

/**
 * v0.45.1 rollout note:
 * Compatibility shim for redis/valkey-backed deployments.
 * Current behavior delegates to file storage while preserving a stable
 * configuration/API contract for progressive rollout.
 */
class RedisCompatJobStoreDriver extends FileJobStoreDriver {
  constructor(options = {}) {
    super(options);
    this.redisUrl = options.redisUrl || process.env.JOB_STORE_REDIS_URL || null;
    this.keyPrefix = options.keyPrefix || process.env.JOB_STORE_REDIS_PREFIX || 'cernion:jobs';
  }

  getInfo() {
    return {
      name: 'redis-compat',
      mode: 'compat-shim',
      jobsDir: this.jobsDir,
      redisUrlConfigured: Boolean(this.redisUrl),
      keyPrefix: this.keyPrefix,
    };
  }
}

module.exports = RedisCompatJobStoreDriver;
