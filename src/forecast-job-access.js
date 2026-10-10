'use strict';
const { Errors } = require('moleculer');
function assertForecastJobAccess(ctx, job) {
  if (!job || job.service !== 'forecast-sandbox') return;
  let allowed = job.tenantId === (ctx.meta?.tenantId || 'default');
  if (job.action === 'productForecast') {
    try {
      allowed = allowed && require('./forecast-product').tenant(ctx.meta) === job.tenantId;
    } catch {
      allowed = false;
    }
  }
  if (!allowed) throw new Errors.MoleculerClientError('Job not found', 404, 'JOB_NOT_FOUND');
}
module.exports = { assertForecastJobAccess };
