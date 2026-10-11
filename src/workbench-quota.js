'use strict';

const { normalizePhrase } = require('./function-resolver');
const { deny } = require('./domain-router-policy');

// Control vocabulary; independent of domains and usable without a model.
async function quotaQuery(ctx, p, message) {
  const tokens = new Set(normalizePhrase(message).split(' '));
  if (![...tokens].some((word) => ['kontingent', 'kontingents', 'quota', 'quotas'].includes(word)))
    return null;
  if (!p.roles.some((role) => ['ROLE_TENANT_ADMIN', 'ROLE_ADMIN'].includes(role)))
    deny('Quota usage requires tenant administrator authorization');
  const result = await ctx.call('tenant-quota.getQuotas', { id: p.tenantId });
  const daily = result.data.usage.llm_tokens_per_day;
  const monthly = result.data.usage.llm_tokens_per_month;
  const format = (value) => Number(value).toLocaleString('de-DE');
  return {
    state: 'tenant_quota_usage',
    nonBinding: true,
    responseText: `Heute sind ${format(daily.used)} von ${format(daily.limit)} Tokens verbraucht; ${format(daily.remaining)} sind noch übrig. Im Monat sind ${format(monthly.used)} von ${format(monthly.limit)} Tokens verbraucht.`,
    quota: result.data,
  };
}
module.exports = { quotaQuery };
