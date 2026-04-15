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
    // User-asserted facts (trusted:true) are capped at 'medium' — never 'high'.
    // EU AI Act Art. 12: provenance must be traceable. 'high' is reserved for
    // machine-verified API responses with confirmed sources.
    confidence: item.trusted === true
      ? 'medium'
      : item.sources.length > 0 ? 'medium' : 'low',
    trusted: item.trusted === true ? true : undefined,
    dataProvenance: item.dataProvenance || undefined,
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

function needsFactQualityClarification(facts) {
  if (!Array.isArray(facts) || facts.length === 0) return true;
  return facts.every((fact) => fact.confidence === 'low');
}

function buildFactQualityClarification(retrieval) {
  const requestedFocusAreas = toArray(retrieval?.items)
    .map((item) => item?.focusArea)
    .filter(Boolean);

  return {
    question:
      'Es liegen keine belastbaren Fakten vor. Bitte ergänzen Sie konkrete Daten (z. B. Kapazität, Netzebene, vorgelagerter Netzbezug/Koppelkapazität) für die betroffenen Themenfelder.',
    reason: 'insufficient_fact_quality',
    suggestedInputs: requestedFocusAreas.length > 0
      ? requestedFocusAreas
      : ['capacity', 'grid_expansion', 'redispatch'],
  };
}

function buildGrounding(input) {
  const retrieval = input?.retrieval || {};
  const context = input?.context || {};
  const regulatoryGraph = input?.regulatoryGraph || {};
  const topologyHop = input?.topologyHop !== undefined ? input.topologyHop : (retrieval?.topologyHop || null);

  const facts = buildFacts(retrieval);
  const dataGaps = buildDataGaps(retrieval);
  const requestedCount = toArray(retrieval?.items).length;
  const score = computeConfidenceScore(facts.length, requestedCount, dataGaps.length);
  const confidence = toConfidenceLabel(score);

  const baseClarification = buildClarification(context, dataGaps);
  const factQualityClarification = needsFactQualityClarification(facts)
    ? buildFactQualityClarification(retrieval)
    : null;
  const clarification = baseClarification || factQualityClarification;
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
    topologyHop: topologyHop || null,
  };
}

module.exports = {
  buildGrounding,
};
