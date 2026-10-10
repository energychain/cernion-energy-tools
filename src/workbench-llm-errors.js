'use strict';

// Provider errors may echo prompt fragments. Log only known diagnostics, never payloads.
function llmErrorDetails(error) {
  const status = error.status || error.response?.status || error.code;
  const raw = String(error.message || '');
  const message = /thinking/i.test(raw)
    ? 'Requested thinking configuration is not supported'
    : /timeout|budget/i.test(raw)
      ? 'LLM request exceeded its time budget'
      : /quota|rate.limit|429/i.test(raw)
        ? 'LLM provider quota exceeded'
        : /Invalid Workbench|JSON/i.test(raw)
          ? 'LLM response failed schema validation'
          : 'LLM provider request failed';
  return {
    errorClass: error.type || error.name || 'Error',
    providerStatus: Number.isInteger(Number(status)) ? Number(status) : null,
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
module.exports = { llmErrorDetails, logLlmError };
