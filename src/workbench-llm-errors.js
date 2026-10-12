'use strict';

// Provider errors may echo prompt fragments. Log only known diagnostics, never payloads.
function llmErrorDetails(error) {
  const tenantQuota = error.type === 'LLM_QUOTA_EXCEEDED';
  const status = error.status || error.response?.status || error.code;
  const raw = String(error.message || '');
  const message = tenantQuota
    ? 'CET tenant quota exceeded'
    : Number(status) === 429
      ? 'LLM provider quota exceeded'
      : /thinking/i.test(raw)
        ? 'Requested thinking configuration is not supported'
        : /timeout|budget/i.test(raw)
          ? 'LLM request exceeded its time budget'
          : /quota|rate.limit|429/i.test(raw)
            ? 'LLM provider quota exceeded'
            : /Invalid Workbench|JSON/i.test(raw)
              ? 'LLM response failed schema validation'
              : 'LLM provider request failed';
  return {
    errorClass: tenantQuota
      ? 'tenant_quota_exceeded'
      : Number(status) === 429
        ? 'provider_quota'
        : error.type || error.name || 'Error',
    ...(tenantQuota
      ? { resetAt: error.data?.resetAt || null, resource: error.data?.resource || null }
      : {}),
    providerStatus: !tenantQuota && Number.isInteger(Number(status)) ? Number(status) : null,
    message,
    ...(error.outputLength !== undefined ? { outputLength: error.outputLength } : {}),
    ...(error.truncated !== undefined ? { truncated: error.truncated } : {}),
  };
}
function logLlmError(logger, phase, error) {
  const details = llmErrorDetails(error);
  if (logger?.warn) logger.warn(`Workbench ${phase} failed`, details);
  else process.stderr.write(JSON.stringify({ level: 'warn', phase, ...details }) + '\n');
}
function quotaMessage(error) {
  if (error?.type !== 'LLM_QUOTA_EXCEEDED') return '';
  const reset = error.data?.resetAt;
  const date = reset && new Date(reset);
  const when =
    date && Number.isFinite(date.getTime())
      ? date.toLocaleString('de-DE', {
          timeZone: 'Europe/Berlin',
          day: '2-digit',
          month: '2-digit',
          hour: '2-digit',
          minute: '2-digit',
        }) + ' Uhr'
      : 'dem nächsten Kontingentzeitraum';
  const period =
    error.data?.resource === 'llm_tokens_per_month' ? 'Monatskontingent' : 'Tageskontingent';
  return `Das ${period} für euer Stadtwerk ist erreicht – ab ${when} geht es wieder. Bis dahin kannst du vorhandene Fälle, festgehaltene Aussagen und Datensätze ohne neue Modellbewertung abrufen.`;
}
module.exports = { llmErrorDetails, logLlmError, quotaMessage };
