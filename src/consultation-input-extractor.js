'use strict';

/**
 * Consultation Input Extractor
 *
 * Robustly extracts available inputs from user message, consultation facts,
 * and known context using pattern matching to prevent redundant slot-filling
 * questions (e.g., "Bundesland?" when user already mentioned it).
 *
 * Uses regex-based pattern matching for NLP-like extraction—more robust than
 * LLM-based slot-filling which hallucinations.
 *
 * Energy-domain identifiers (MeLo, MaLo, MaStR-ID, BDEW/GLN, EIC, OBIS,
 * PLZ) are extracted via the centralised energy-id-extractor utility instead
 * of ad-hoc regexes to avoid false positives like mistaking "Hier" for a
 * BDEW code.
 */

const { extractEnergyIds } = require('./utils/energy-id-extractor');

const INPUT_PATTERNS = Object.freeze({
  bundesland: {
    patterns: [
      /\b(thüringen|thueringen|bayern|nrw|nordrhein-westfalen|baden-württemberg|baden-wuerttemberg|hamburg|bremen|schleswig-holstein|mecklenburg-vorpommern|sachsen-anhalt|sachsen|brandenburg|berlin|hessen|rheinland-pfalz|saarland|niedersachsen)\b/i,
      /bundesland\s*[:=]?\s*([A-Z][a-zäöüß\-]{2,})/i,
    ],
    aliases: ['state', 'state_name', 'region'],
  },
  municipality: {
    patterns: [
      // Only match when preceded by an explicit location keyword to avoid
      // catching arbitrary words like "d die RLM-Daten" or sentence fragments.
      /(?:stadt|gemeinde|ort)\s+([A-Z][a-zäöüß\-\s]{2,})/i,
      /\b(arnstadt|münchen|hamburg|köln|berlin|dresden|frankfurt|düsseldorf|heidelberg|wiesloch|mannheim|karlsruhe|stuttgart|nürnberg|dortmund|essen|leipzig|bremen|hannover|duisburg|bochum|wuppertal|bielefeld|bonn|münster|augsburg|wiesbaden|gelsenkirchen|mönchengladbach|braunschweig|chemnitz|kiel|aachen|halle|magdeburg|freiburg|krefeld|lübeck|oberhausen|erfurt|mainz|rostock|kassel|hagen|hamm|saarbrücken|mülheim)\b/i,
    ],
    aliases: ['city', 'town', 'location'],
  },
  powerMW: {
    patterns: [
      /(\d+(?:[,\.]\d+)?)\s*(?:MW|megawatt|megawatt)/i,
      /leistung\s*[:=]?\s*(\d+(?:[,\.]\d+)?)\s*(?:MW|megawatt)/i,
      /power\s*[:=]?\s*(\d+(?:[,\.]\d+)?)\s*(?:MW|megawatt)/i,
    ],
    aliases: ['capacity_mw', 'power', 'leistung'],
  },
  capacityMWh: {
    patterns: [
      /(\d+(?:[,\.]\d+)?)\s*(?:MWh|megawattstunde|megawatt.stunde)/i,
      /speicherkapazität\s*[:=]?\s*(\d+(?:[,\.]\d+)?)\s*(?:MWh|megawattstunde)/i,
    ],
    aliases: ['storage_capacity', 'battery_mwh'],
  },
  gridOperatorName: {
    patterns: [
      /(?:netzbetreiber|vnb)\s*[:=]?\s*([A-Z][a-zäöüß\s\-\.]{2,})/i,
      /(?:zuständig|betrieben)\s+(?:von|durch)\s+([A-Z][a-zäöüß\s\-\.]{2,})/i,
    ],
    aliases: ['vnb_name', 'operator', 'netzbetreiber'],
  },
  assetType: {
    patterns: [
      /(?:anlage|installation|typ|art)\s*[:=]?\s*(PV|photovoltaik|wind|wasserkraft|biomasse|speicher|BESS|batterie|wasserkraft)/i,
      /\b(photovoltaik|pv-anlage|windkraftanlage|biomassanlage|speicheranlage|bess)\b/i,
    ],
    aliases: ['installation_type', 'generator_type'],
  },
  projectName: {
    patterns: [
      /(?:projekt|name|vorhaben)\s*[:=]?\s*([A-Z][a-zäöüß\s\-\.]{2,})/i,
      /(?:titel|bezeichnung)\s*[:=]?\s*([A-Z][a-zäöüß\s\-\.]{2,})/i,
    ],
    aliases: ['project_id', 'vorhabensname'],
  },
  userRole: {
    patterns: [
      /\b(investor|operator|betreiber|plant_owner|eigentümer|entwickler|developer|consultant|berater|grid_operator|netzbetreiber)\b/i,
      /(?:ich bin|bin|rolle)\s*[:=]?\s*(investor|operator|betreiber|plant_owner|eigentümer|entwickler|consultant|berater|grid_operator)\b/i,
    ],
    aliases: ['role', 'stakeholder_type'],
  },
});

/**
 * Extract available inputs from message, consultation facts, and known context.
 *
 * @param {string} message - User message or consultation prompt
 * @param {object} consultationFacts - Facts used in consultation (e.g., user-provided, extracted)
 * @param {object} knownContext - Existing known context (L0/L1/L2)
 * @returns {array} Array of {param, value, source, confidence}
 *
 * Source: 'message' | 'consultationFacts' | 'knownContext'
 * Confidence: 'high' | 'medium' | 'low'
 */
function extractAvailableInputs(message = '', consultationFacts = {}, knownContext = {}) {
  const availableInputs = [];
  const seen = new Set(); // Track param keys to avoid duplicates

  // Helper: add input if not already present
  const addIfNew = (param, value, source, confidence = 'high') => {
    if (seen.has(param)) return;
    if (!value || String(value).trim() === '') return;
    availableInputs.push({ param, value, source, confidence });
    seen.add(param);
  };

  // 1. Extract from message using regex patterns
  if (message && String(message).length > 0) {
    for (const [paramKey, patternObj] of Object.entries(INPUT_PATTERNS)) {
      if (seen.has(paramKey)) continue;

      for (const pattern of patternObj.patterns) {
        const match = message.match(pattern);
        if (match && match[1]) {
          addIfNew(paramKey, match[1], 'message', 'high');
          break; // Use first match
        }
      }
    }

    // 1b. Extract energy-domain identifiers (MeLo, MaLo, MaStR-ID, BDEW/GLN,
    //     EIC, OBIS, PLZ) via the centralised utility — strict word-boundary
    //     patterns prevent false positives like matching "Hier" as a BDEW code.
    const energyIds = extractEnergyIds(message);
    for (const match of energyIds) {
      // Map extractor type → INPUT_PATTERNS / knownContext field names
      const paramKey = {
        meloId: 'meloId',
        maloId: 'maloId',
        mastrId: 'mastrId',
        bdewCode: 'bdewCode',
        eicCode: 'eicCode',
        obisCode: 'obisCode',
        postalCode: 'postalCode',
      }[match.type];
      if (paramKey) {
        addIfNew(paramKey, match.value, 'message', 'high');
      }
    }
  }

  // 2. Extract from consultationFacts (already-used facts)
  if (consultationFacts && typeof consultationFacts === 'object') {
    for (const [key, value] of Object.entries(consultationFacts)) {
      const normalized = key.toLowerCase().replace(/[-_]/g, '');
      const paramKey = Object.keys(INPUT_PATTERNS).find(
        (p) =>
          p.toLowerCase() === normalized ||
          INPUT_PATTERNS[p].aliases.some((a) => a.toLowerCase() === normalized)
      );

      if (paramKey && !seen.has(paramKey)) {
        addIfNew(paramKey, value, 'consultationFacts', 'high');
      }
    }
  }

  // 3. Extract from knownContext (user profile, previous turns)
  if (knownContext && typeof knownContext === 'object') {
    for (const [key, value] of Object.entries(knownContext)) {
      const normalized = key.toLowerCase().replace(/[-_]/g, '');
      const paramKey = Object.keys(INPUT_PATTERNS).find(
        (p) =>
          p.toLowerCase() === normalized ||
          INPUT_PATTERNS[p].aliases.some((a) => a.toLowerCase() === normalized)
      );

      if (paramKey && !seen.has(paramKey)) {
        addIfNew(paramKey, value, 'knownContext', 'medium');
      }
    }
  }

  return availableInputs;
}

/**
 * Check if a specific input parameter has already been provided.
 *
 * @param {string} paramKey - Parameter key (e.g., 'bundesland', 'powerMW')
 * @param {array} availableInputs - Array of {param, value, source, confidence}
 * @returns {boolean} true if paramKey is already in availableInputs
 */
function isInputAlreadyProvided(paramKey = '', availableInputs = []) {
  if (!paramKey || !Array.isArray(availableInputs)) return false;
  return availableInputs.some((input) => input.param === paramKey);
}

module.exports = {
  extractAvailableInputs,
  isInputAlreadyProvided,
  INPUT_PATTERNS,
};
