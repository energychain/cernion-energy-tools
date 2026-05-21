'use strict';

const FileRateQuotaDriver = require('./file-driver');

class RedisCompatRateQuotaDriver extends FileRateQuotaDriver {
  constructor(options = {}) {
    super(options);
    this.redisUrl = options.redisUrl || process.env.RATE_QUOTA_REDIS_URL || null;
    this.keyPrefix =
      options.keyPrefix || process.env.RATE_QUOTA_REDIS_PREFIX || 'cernion:rate-quotas';
  }

  getInfo() {
    return {
      name: 'redis-compat',
      mode: 'compat-shim',
      baseDir: this.baseDir,
      redisUrlConfigured: Boolean(this.redisUrl),
      keyPrefix: this.keyPrefix,
    };
  }
}

module.exports = RedisCompatRateQuotaDriver;
