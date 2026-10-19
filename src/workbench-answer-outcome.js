'use strict';

// Status is authoritative for current replies; wording only cleans historical records.
function safeConclusion(text, outcome = {}) {
  if (
    ['fallback', 'error', 'unavailable'].includes(outcome.answerStatus) ||
    outcome.metadata?.degraded ||
    outcome.metadata?.fallbackReason ||
    outcome.metadata?.degradedReason ||
    /(?:nicht zuverlässig beantworten|gerade keine belastbare Antwort|keine verlässliche Antwort|verlässliche neue Bewertung (?:ist gerade nicht zustande gekommen|kann ich deshalb noch nicht formulieren)|Entwurf ist gerade nicht sauber zustande gekommen)/iu.test(
      String(text || '')
    )
  )
    return '';
  const value = String(text || '');
  if (outcome.topic && value.trim() === String(outcome.topic).trim()) return '';
  return require('./workbench-answer-filter').isInternalDescription(value) ? '' : value;
}
module.exports = { safeConclusion };
