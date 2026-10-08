'use strict';

const { logLlmError } = require('./workbench-llm-errors');

function logInfo(logger, message, details) {
  if (logger?.info) logger.info(message, details);
  else process.stderr.write(JSON.stringify({ level: 'info', message, ...details }) + '\n');
}

function schemaError(errors, reason = 'schema_validation') {
  const error = new SyntaxError('Invalid Workbench response');
  error.fallbackReason = reason;
  // AJV values, params and messages may contain user data. Only structural paths
  // and validator keywords are diagnostic data; unknown path segments are masked.
  const fields = new Set([
    'concern',
    'situation',
    'participants',
    'identifiers',
    'kind',
    'value',
    'deadlines',
    'basis',
    'hypotheses',
    'id',
    'confidence',
    'missingInformation',
    'key',
    'question',
    'blocking',
    'requestedAction',
    'description',
    'externalEffect',
    'draftRequested',
    'turnKind',
    'retrievalTerms',
    'followupKind',
    'timeline',
    'role',
    'date',
    'summary',
    'assertions',
    'observations',
    'expectation',
    'nextSteps',
    'interpretation',
    'assumptions',
    'draft',
    'text',
    'origin',
    'supported',
    'condition',
    'completedAction',
    'specific',
    'codeDependencies',
    'evidenceIds',
  ]);
  error.schemaErrors = (errors || []).map(({ instancePath, keyword }) => ({
    instancePath: String(instancePath || '')
      .split('/')
      .map((part) => (!part || fields.has(part) || /^\d+$/u.test(part) ? part : '[field]'))
      .join('/'),
    keyword,
  }));
  return error;
}

async function repairOutput({ options, logger, phase, generate }) {
  const deadline = performance.now() + options.timeoutMs;
  let repairInstruction;
  for (let attempt = 0; attempt < 2; attempt++) {
    let timer;
    try {
      const remaining = deadline - performance.now();
      if (remaining <= 0) throw new Error('Workbench budget exceeded');
      return await Promise.race([
        generate({
          attempt,
          repairInstruction,
          attemptOptions: { ...options, timeoutMs: remaining },
        }),
        new Promise((_, reject) => {
          timer = setTimeout(() => reject(new Error('Workbench budget exceeded')), remaining);
        }),
      ]);
    } catch (error) {
      logLlmError(logger, phase, error);
      if (error.schemaErrors)
        logInfo(logger, 'Workbench schema rejection', { phase, schemaErrors: error.schemaErrors });
      const repairable =
        error instanceof SyntaxError ||
        /LLM response failed schema validation/u.test(String(error.message));
      if (attempt || !repairable) throw Object.assign(error, { workbenchLogged: true });
      repairInstruction =
        error.repairInstruction ||
        'Die vorherige Ausgabe war kein gültiges JSON gemäß Schema. Erzeuge sie neu: kurze Absätze, vollständige Pflichtfelder, keine Zusatzfelder oder Markdown-Zäune. Nicht die vorherige Ausgabe übernehmen.';
    } finally {
      clearTimeout(timer);
    }
  }
}

function fallbackReason(error) {
  if (error?.fallbackReason) return error.fallbackReason;
  if (/timeout|budget/iu.test(String(error?.message))) return 'time_budget_exceeded';
  if (error instanceof SyntaxError || /schema validation/iu.test(String(error?.message)))
    return 'schema_validation';
  return 'provider_error';
}
module.exports = { repairOutput, schemaError, logInfo, fallbackReason };
