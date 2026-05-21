'use strict';

const FileRateQuotaDriver = require('./file-driver');
const RedisCompatRateQuotaDriver = require('./redis-compat-driver');

function normalizeDriverName(raw) {
  return String(raw || 'redis-compat')
    .trim()
    .toLowerCase();
}

function createDriver(logger = console) {
  const name = normalizeDriverName(process.env.RATE_QUOTA_DRIVER);

  if (name === 'file') return new FileRateQuotaDriver();

  if (name === 'redis-compat' || name === 'redis' || name === 'valkey') {
    logger.warn?.(
      '[rate-quota] RATE_QUOTA_DRIVER=redis-compat active in compatibility mode (v0.48.4).'
    );
    return new RedisCompatRateQuotaDriver();
  }

  logger.warn?.(`[rate-quota] Unknown RATE_QUOTA_DRIVER="${name}". Falling back to redis-compat.`);
  return new RedisCompatRateQuotaDriver();
}

module.exports = {
  createDriver,
  normalizeDriverName,
};
