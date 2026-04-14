'use strict';

function toArray(value) {
  return Array.isArray(value) ? value : [];
}

function normalizeStatement(answer) {
  const text = String(answer || '').replace(/\s+/g, ' ').trim();
  if (!text) return 'Keine belastbare Aussage verfügbar.';
  return text.length > 260 ? `${text.slice(0, 257)}...` : text;
}

function buildFacts(retrieval) {
  const items = toArray(retrieval?.items).filter((item) => item.ok);
  return items.map((item, index) => ({
    factId: `F${index + 1}`,
    focusArea: item.focusArea,
    statement: normalizeStatement(item.answer),
    sources: toArray(item.sources),
    confidence: item.sources.length > 0 ? 'medium' : 'low',
  }));
}

function buildDataGaps(retrieval) {
  return toArray(retrieval?.items)
    .filter((item) => !item.ok)
    .map((item) => ({
      focusArea: item.focusArea,
      reason: item.error || 'Quelle nicht erreichbar',
      impact: 'Relevanter Kontext fehlt oder ist unvollständig.',
    }));
}

function computeConfidenceScore(factCount, requestedCount, gapCount) {
  if (!requestedCount) return 0;
  const base = Math.round((factCount / requestedCount) * 100);
  const penalty = Math.min(45, gapCount * 15);
  return Math.max(0, Math.min(100, base - penalty));
}

function toConfidenceLabel(score) {
  if (score >= 75) return 'high';
  if (score >= 45) return 'medium';
  return 'low';
}

function buildClarification(context, dataGaps) {
  if (!context?.location) {
    return {
      question: 'Für welche konkrete Region soll die Argumentation priorisiert werden?',
      reason: 'location_missing',
      suggestedInputs: ['Stadt/Gemeinde', 'PLZ-Bereich', 'Netzgebiet'],
    };
  }

  if (dataGaps.length > 0) {
    return {
      question: 'Sollen fehlende Datenquellen über manuelle Angaben ergänzt werden?',
      reason: 'data_gap_detected',
      suggestedInputs: dataGaps.map((gap) => gap.focusArea),
    };
  }

  return null;
}

function buildGrounding(input) {
  const retrieval = input?.retrieval || {};
  const context = input?.context || {};
  const regulatoryGraph = input?.regulatoryGraph || {};

  const facts = buildFacts(retrieval);
  const dataGaps = buildDataGaps(retrieval);
  const requestedCount = toArray(retrieval?.items).length;
  const score = computeConfidenceScore(facts.length, requestedCount, dataGaps.length);
  const confidence = toConfidenceLabel(score);

  const clarification = buildClarification(context, dataGaps);
  const requiresClarification = confidence === 'low' || clarification !== null;

  return {
    generatedAt: new Date().toISOString(),
    confidence,
    confidenceScore: score,
    requiresClarification,
    clarification,
    facts,
    dataGaps,
    regulatorySignals: toArray(regulatoryGraph?.signals),
  };
}

module.exports = {
  buildGrounding,
};
