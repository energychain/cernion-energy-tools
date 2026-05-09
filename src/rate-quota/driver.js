'use strict';

class RateQuotaDriver {
  getTenantState(_tenantId) {
    throw new Error('RateQuotaDriver#getTenantState not implemented');
  }

  saveTenantState(_tenantId, _state) {
    throw new Error('RateQuotaDriver#saveTenantState not implemented');
  }

  getInfo() {
    return { name: 'unknown' };
  }
}

module.exports = RateQuotaDriver;
