'use strict';

function buildExecutionGapResponse({
  routingDecision = {},
  brokerRecommendation = {},
  message = '',
} = {}) {
  const gap = routingDecision?.gap || {};
  const reason = gap.reason || 'execution_gap';
  const confidence = typeof gap.confidence === 'number' ? gap.confidence : null;
  const threshold = typeof gap.threshold === 'number' ? gap.threshold : null;

  const suggestions = [];
  if (reason === 'low_confidence_broker') {
    suggestions.push(
      'Beschreibe die gewünschte Prüfung konkreter, z. B. MaStR, BDEW-Code oder Netzbetreiber.'
    );
  }
  if (reason === 'no_broker_intent') {
    suggestions.push('Formuliere die gewünschte Aktion explizit, z. B. „Prüfe den MaStR-Eintrag“.');
  }
  suggestions.push(
    'Alternativ kann ich die Anfrage zuerst beratend einordnen und die fehlenden Angaben gemeinsam klären.'
  );

  return {
    reasonCode: 'MARK_UNKNOWN_EXECUTION_GAP',
    gapReason: reason,
    confidence,
    threshold,
    intent: brokerRecommendation?.intent || null,
    capability: brokerRecommendation?.capability || null,
    message: String(message || '').slice(0, 280),
    suggestions,
  };
}

module.exports = {
  buildExecutionGapResponse,
};
