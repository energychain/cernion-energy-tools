'use strict';

const fs = require('fs');
const path = require('path');
const RateQuotaDriver = require('./driver');

const DEFAULT_DIR = path.join(__dirname, '..', '..', 'data', 'rate-quotas');

class FileRateQuotaDriver extends RateQuotaDriver {
  constructor(options = {}) {
    super();
    this.baseDir = options.baseDir || process.env.RATE_QUOTA_DIR || DEFAULT_DIR;
  }

  ensureDir() {
    if (!fs.existsSync(this.baseDir)) {
      fs.mkdirSync(this.baseDir, { recursive: true });
    }
  }

  statePath(tenantId) {
    return path.join(this.baseDir, `${tenantId}.json`);
  }

  getTenantState(tenantId) {
    this.ensureDir();
    try {
      return JSON.parse(fs.readFileSync(this.statePath(tenantId), 'utf8'));
    } catch (err) {
      this.logger?.warn(`[file-driver] silent-catch-fallback (line 29): ${err && err.message}`);
      return null;
    }
  }

  saveTenantState(tenantId, state) {
    this.ensureDir();
    fs.writeFileSync(this.statePath(tenantId), JSON.stringify(state, null, 2));
    return state;
  }

  getInfo() {
    return {
      name: 'file',
      baseDir: this.baseDir,
    };
  }
}

module.exports = FileRateQuotaDriver;
