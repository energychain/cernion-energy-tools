'use strict';

const REGULATORY_RULES = [
  {
    id: 'NOVA_BLOCKED',
    severity: 'warning',
    oeoClass: 'https://openenergyplatform.org/ontology/oeo/OEO_00020143',
    evaluate: ({ text }) => /nova|netzorient|verzöger|block/i.test(text),
    rationale: 'NOVA-relevante Priorisierungs- oder Blockadehinweise erkannt.',
  },
  {
    id: 'HIGH_CURTAILMENT',
    severity: 'warning',
    oeoClass: 'https://openenergyplatform.org/ontology/oeo/OEO_00020144',
    evaluate: ({ text }) => /abregel|curtail|redispatch|einspeisemanagement/i.test(text),
    rationale: 'Hinweise auf erhöhte Abregelung/Redispatch gefunden.',
  },
  {
    id: 'EWK_BELOW_MEDIAN',
    severity: 'info',
    oeoClass: 'https://openenergyplatform.org/ontology/oeo/OEO_00020145',
    evaluate: ({ text }) => /ewk|unter.*median|unterdurchschnitt|wirtschaftlichkeit/i.test(text),
    rationale: 'Hinweise auf unterdurchschnittliche Wirtschaftlichkeit erkannt.',
  },
  {
    id: 'MISSING_NAP',
    severity: 'critical',
    oeoClass: 'https://openenergyplatform.org/ontology/oeo/OEO_00020146',
    evaluate: ({ text }) => /nap|netzanschlusspunkt|fehlend|unvollständig/i.test(text),
    rationale: 'Hinweis auf fehlende/unklare Netzanschlusspunktdaten.',
  },
  {
    id: 'SECTION14A_GAP',
    severity: 'warning',
    oeoClass: 'https://openenergyplatform.org/ontology/oeo/OEO_00020147',
    evaluate: ({ text }) => /14a|steuerbar|steuerbox|smart.?meter/i.test(text) && /lücke|fehl|ungeklärt/i.test(text),
    rationale: '§14a-bezogene Umsetzungslücke im Kontext erkannt.',
  },
  {
    id: 'ENERGY_SHARING_DEADLINE',
    severity: 'warning',
    oeoClass: 'https://openenergyplatform.org/ontology/oeo/OEO_00020148',
    evaluate: ({ text, focusAreas }) =>
      focusAreas.includes('energy_sharing') || /42c|01\.06\.2026|deadline|frist/i.test(text),
    rationale: 'Energy-Sharing-Fristen oder regulatorische Dringlichkeit erkannt.',
  },
  {
    id: 'GRID_TOPOLOGY_RADIAL',
    severity: 'info',
    oeoClass: 'https://openenergyplatform.org/ontology/oeo/OEO_00020149',
    evaluate: ({ text }) => /radial|ring|topolog|netzstruktur/i.test(text),
    rationale: 'Topologie-Hinweis auf radial geprägte Netzstruktur erkannt.',
  },
  {
    id: 'HIGH_RENEWABLE_SHARE',
    severity: 'info',
    oeoClass: 'https://openenergyplatform.org/ontology/oeo/OEO_00020150',
    evaluate: ({ text, focusAreas }) =>
      focusAreas.includes('renewables') && /erneuerbar|renewable|einspeis|pv|wind/i.test(text),
    rationale: 'Hohe EE-Dynamik im Kontext identifiziert.',
  },
  {
    id: 'VOLTAGE_HOP_REQUIRED',
    severity: 'warning',
    oeoClass: 'https://openenergyplatform.org/ontology/oeo/OEO_00020151',
    evaluate: ({ topologyHop }) => topologyHop?.needsHop === true,
    rationale: 'Asset-Kapazität erfordert Anschluss an vorgelagerte 110-kV-Ebene (HS). Physikalischer Anschlusspunkt liegt außerhalb der lokalen Netzregion.',
  },
];

function compactText(retrieval) {
  const items = Array.isArray(retrieval?.items) ? retrieval.items : [];
  return items
    .filter((item) => item.ok)
    .map((item) => `${item.focusArea}: ${item.answer || ''}`)
    .join('\n');
}

function buildRegulatoryGraph(input) {
  const retrieval = input?.retrieval || {};
  const focusAreas = Array.isArray(input?.context?.focus_areas) ? input.context.focus_areas : [];
  const text = compactText(retrieval);
  const topologyHop = input?.topologyHop !== undefined ? input.topologyHop : (retrieval?.topologyHop || null);

  const signals = REGULATORY_RULES
    .filter((rule) => rule.evaluate({ text, focusAreas, topologyHop }))
    .map((rule) => ({
      ruleId: rule.id,
      severity: rule.severity,
      oeoClass: rule.oeoClass,
      rationale: rule.rationale,
      confidence: rule.severity === 'critical' ? 'high' : 'medium',
    }));

  const severityCount = signals.reduce(
    (acc, signal) => {
      acc[signal.severity] = (acc[signal.severity] || 0) + 1;
      return acc;
    },
    { critical: 0, warning: 0, info: 0 }
  );

  return {
    generatedAt: new Date().toISOString(),
    evaluatedRules: REGULATORY_RULES.length,
    triggeredRules: signals.length,
    severityCount,
    signals,
  };
}

// ── OEO class mapping (keyed by ruleId) ───────────────────────────────────
const OEO_MAPPINGS = Object.fromEntries(
  REGULATORY_RULES.map(r => [r.id, { ruleId: r.id, oeoClass: r.oeoClass, rationale: r.rationale }])
);

/**
 * Graph-based regulatory signal evaluation (v0.32.0).
 * Uses deriveSignals() from cya-ontology-graph.js instead of Regex text-matching.
 * Return format is identical to buildRegulatoryGraph() for drop-in compatibility.
 *
 * @param {import('graphology').Graph} ontologyGraph
 * @param {string} focusNodeId - e.g. `INSTALLATION:<mastrNummer>`
 * @returns {Object} Same shape as buildRegulatoryGraph() output, plus graphBased:true
 */
function buildRegulatoryGraphFromOntology(ontologyGraph, focusNodeId) {
  const { deriveSignals } = require('./cya-ontology-graph');

  const rawSignals = deriveSignals(ontologyGraph, focusNodeId);

  const signals = rawSignals.map(s => ({
    ruleId: s.ruleId,
    severity: s.severity,
    oeoClass: s.oeoClass,
    rationale: s.rationale,
    confidence: s.severity === 'critical' ? 'high' : 'medium',
    evidence: s.evidence || [],
  }));

  const severityCount = signals.reduce(
    (acc, signal) => {
      acc[signal.severity] = (acc[signal.severity] || 0) + 1;
      return acc;
    },
    { critical: 0, warning: 0, info: 0 }
  );

  return {
    generatedAt: new Date().toISOString(),
    evaluatedRules: signals.length,
    triggeredRules: signals.length,
    severityCount,
    signals,
    oeoMappings: signals.map(s => OEO_MAPPINGS[s.ruleId]).filter(Boolean),
    graphBased: true,
  };
}

module.exports = {
  REGULATORY_RULES,
  OEO_MAPPINGS,
  buildRegulatoryGraph,
  buildRegulatoryGraphFromOntology,
};
