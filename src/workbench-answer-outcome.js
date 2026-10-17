'use strict';

// Status is authoritative for current replies; wording only cleans historical records.
function safeConclusion(text, outcome = {}) {
  if (
    outcome.answerStatus === 'fallback' ||
    outcome.metadata?.degraded ||
    outcome.metadata?.fallbackReason ||
    outcome.metadata?.degradedReason ||
    /(?:nicht zuverlässig beantworten|gerade keine belastbare Antwort|keine verlässliche Antwort|verlässliche neue Bewertung (?:ist gerade nicht zustande gekommen|kann ich deshalb noch nicht formulieren)|Entwurf ist gerade nicht sauber zustande gekommen)/iu.test(
      String(text || '')
    )
  )
    return '';
  return String(text || '');
}
module.exports = { safeConclusion };
