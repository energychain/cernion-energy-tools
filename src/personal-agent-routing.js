'use strict';

const {
  CURATED_CAPABILITIES,
  INTERFACE_PLACEHOLDER_CAPABILITY,
  GLOBAL_DO_NOT_USE,
} = require('./capability-catalog');

const EXECUTION_MODES = Object.freeze({
  AUTO: 'auto',
  HITL: 'hitl',
});

const DOMAIN_SIGNAL_DEFINITIONS = Object.freeze([
  {
    key: 'investment-planning',
    patterns: [/\binvest(?:ition|ment)?\b/i, /\bcapex\b/i, /\bmaßnahme\b/i, /\bmassnahme\b/i],
  },
  {
    key: 'grid-connection',
    patterns: [/\bgrid\b/i, /\bnetz\b/i, /\banschluss\b/i, /\bcapacity\b/i, /\bkapazit[aä]t\b/i],
  },
  {
    key: 'energy-sharing',
    patterns: [/\bmieterstrom\b/i, /\benergy sharing\b/i, /\bgemeinschaft\b/i],
  },
  {
    key: 'znp',
    patterns: [/\bznp\b/i, /\bzielnetzplanung\b/i, /\bprojekt\b/i],
  },
  {
    key: 'redispatch',
    patterns: [/\bredispatch\b/i, /\baudit\b/i, /\babregelung\b/i],
  },
  {
    key: 'settlement',
    patterns: [/\bsettlement\b/i, /\babrechnung\b/i, /\bcompensation\b/i],
  },
  {
    key: 'fnav',
    patterns: [/\bfnav\b/i, /\bnetzfahrplan\b/i, /\bflexib(?:el|ler) netzanschlussvertrag\b/i],
  },
  {
    key: 'finance',
    patterns: [/\bfinance\b/i, /\bwirtschaft\b/i, /\bpayback\b/i, /\bfee\b/i, /\bkosten\b/i],
  },
  {
    key: 'forecast',
    patterns: [/\bforecast\b/i, /\bprognose\b/i, /\berzeugung\b/i, /\bgeneration\b/i],
  },
  {
    key: 'flex',
    patterns: [/\bflex\b/i, /\b§14a\b/i, /\bdimming\b/i, /\blastverschieb\w*\b/i],
  },
]);

const ROUTING_MATRIX = Object.freeze([
  {
    key: 'investment-grid-check',
    label: 'Investition + Grid-Check',
    domains: ['investment-planning', 'grid-connection'],
    primaryIntent: 'investment-planning.create',
    secondaryIntents: ['grid-connection.validate'],
    steps: [
      {
        action: 'investment-planning.createPlan',
        purpose: 'Investition zuerst erzeugen',
        paramsTemplate: {
          gridOperatorId: null,
          redispatchAuditId: null,
          measures: null,
        },
        source: 'routing-matrix',
      },
      {
        action: 'grid-connection.validate',
        purpose: 'Danach Netzanschluss deterministisch prüfen',
        paramsTemplate: {
          gridOperatorId: null,
          gridOperatorBdew: null,
          gridOperatorName: null,
        },
        source: 'routing-matrix',
        dependsOnStep: 1,
      },
    ],
  },
  {
    key: 'energy-sharing-znp',
    label: 'Mieterstrom + ZNP',
    domains: ['energy-sharing', 'znp'],
    primaryIntent: 'energy-sharing.validate',
    secondaryIntents: ['znp.projects.get'],
    steps: [
      {
        action: 'energy-sharing.validate',
        purpose: 'Energy-Sharing-Validierung zuerst ausführen',
        paramsTemplate: {
          gridOperatorId: null,
          gridOperatorBdew: null,
          communityName: null,
          communityId: null,
          generators: null,
          consumers: null,
        },
        source: 'routing-matrix',
      },
      {
        action: 'znp.getProjectMeta',
        purpose: 'Anschließend ZNP-Referenz für Standortprüfung laden',
        paramsTemplate: {
          projectId: null,
        },
        source: 'routing-matrix',
        dependsOnStep: 1,
      },
    ],
  },
  {
    key: 'redispatch-settlement',
    label: 'Redispatch + Settlement',
    domains: ['redispatch', 'settlement'],
    primaryIntent: 'redispatch.audit.run',
    secondaryIntents: ['settlement.redispatch.calculate'],
    steps: [
      {
        action: 'redispatch-expost.audit',
        purpose: 'Audit zuerst ausführen',
        paramsTemplate: {
          gridOperatorId: null,
          gridOperatorBdew: null,
          gridOperatorName: null,
          dateFrom: null,
          dateTo: null,
        },
        source: 'routing-matrix',
      },
      {
        action: 'settlement.calculateRedispatch',
        purpose: 'Settlement auf Basis der Audit-Daten berechnen',
        paramsTemplate: {
          installations: null,
          period: null,
          compensationMethod: 'actual_loss',
        },
        source: 'routing-matrix',
        dependsOnStep: 1,
      },
    ],
  },
  {
    key: 'fnav-finance',
    label: 'fNAV + Finance',
    domains: ['fnav', 'finance'],
    primaryIntent: 'grid-connection.fnav',
    secondaryIntents: ['finance-agent.analyze'],
    steps: [
      {
        action: 'grid-connection.fnavValidate',
        purpose: 'fNAV-Profil technisch validieren',
        paramsTemplate: {
          gridOperatorId: null,
          gridOperatorBdew: null,
          gridOperatorName: null,
          voltageLevel: null,
          ownerContact: null,
          fnavProfile: null,
        },
        source: 'routing-matrix',
      },
      {
        action: 'finance-agent.fnavEconomics',
        purpose: 'Wirtschaftliche Einordnung aus fNAV-Profil ableiten',
        paramsTemplate: {
          gridOperator: null,
          voltageLevel: null,
          ownerContact: null,
          annualFeeEur: null,
          avoidedCapexOverrideEur: null,
          fnavProfile: null,
        },
        source: 'routing-matrix',
        dependsOnStep: 1,
      },
    ],
  },
  {
    key: 'forecast-flex',
    label: 'Forecast + Flex',
    domains: ['forecast', 'flex'],
    primaryIntent: 'forecast.generation',
    secondaryIntents: ['flex.event.plan'],
    steps: [
      {
        action: 'forecast.generationForecast',
        purpose: 'Erzeugungsprognose zuerst berechnen',
        paramsTemplate: {
          installationType: null,
          forecastDays: null,
          resolution: null,
          startDate: null,
          gridOperatorMastrId: null,
          postleitzahl: null,
        },
        source: 'routing-matrix',
      },
      {
        action: 'flex.planDimming',
        purpose: 'Flex-Event aus Prognose-Lücke planen',
        paramsTemplate: {
          date: null,
          postalCode: null,
          gridCapacityKw: null,
          loadForecastOverride: null,
        },
        source: 'routing-matrix',
        dependsOnStep: 1,
      },
    ],
  },
]);

const ACTION_REQUIREMENTS = Object.freeze({
  'grid-connection.validate': { anyOf: ['gridOperatorId', 'gridOperatorBdew', 'gridOperatorName'] },
  'energy-sharing.validate': {
    anyOf: ['gridOperatorId', 'gridOperatorBdew', 'communityName', 'communityId'],
  },
  'znp.getProjectMeta': { allOf: ['projectId'] },
  'redispatch-expost.audit': {
    anyOf: ['gridOperatorId', 'gridOperatorBdew', 'gridOperatorName'],
  },
  'settlement.calculateRedispatch': { allOf: ['installations', 'period'] },
  'grid-connection.fnavValidate': { allOf: ['fnavProfile'] },
  'finance-agent.fnavEconomics': { allOf: ['fnavProfile'] },
  'grid-operations.vnbLookup': { anyOf: ['bdew', 'city', 'vnbName', 'query'] },
  'forecast.generationForecast': {
    anyOf: ['gridOperatorMastrId', 'installationMastrNummer', 'messlokationId', 'postleitzahl'],
  },
  'flex.planDimming': { allOf: ['date', 'gridCapacityKw'] },
});

const ACTION_PARAM_ALIASES = Object.freeze({
  'investment-planning.createPlan': {
    gridOperatorId: ['gridOperatorId'],
    redispatchAuditId: ['redispatchAuditId', 'auditId'],
    measures: ['measures'],
  },
  'grid-connection.validate': {
    gridOperatorId: ['gridOperatorId'],
    gridOperatorBdew: ['gridOperatorBdew', 'gridOperatorCode'],
    gridOperatorName: ['gridOperatorName', 'query', 'operatorName', 'location'],
  },
  'energy-sharing.validate': {
    gridOperatorId: ['gridOperatorId'],
    gridOperatorBdew: ['gridOperatorBdew'],
    communityName: ['communityName'],
    communityId: ['communityId'],
    generators: ['generators'],
    consumers: ['consumers'],
  },
  'znp.getProjectMeta': {
    projectId: ['projectId'],
  },
  'redispatch-expost.audit': {
    gridOperatorId: ['gridOperatorId'],
    gridOperatorBdew: ['gridOperatorBdew'],
    gridOperatorName: ['gridOperatorName', 'query', 'operatorName'],
    dateFrom: ['dateFrom', 'startDate'],
    dateTo: ['dateTo', 'endDate'],
  },
  'settlement.calculateRedispatch': {
    installations: ['installations'],
    period: ['period'],
    compensationMethod: ['compensationMethod'],
  },
  'grid-connection.fnavValidate': {
    gridOperatorId: ['gridOperatorId'],
    gridOperatorBdew: ['gridOperatorBdew'],
    gridOperatorName: ['gridOperatorName', 'query', 'operatorName'],
    voltageLevel: ['voltageLevel'],
    ownerContact: ['ownerContact'],
    fnavProfile: ['fnavProfile'],
  },
  'grid-operations.marketPartners': {
    query: ['query', 'vnb1Name', 'gridOperatorName', 'operatorName', 'location'],
    limit: ['limit'],
  },
  'grid-operations.vnbLookup': {
    bdew: ['bdew', 'gridOperatorBdew', 'bdewCode', 'bnr'],
    city: ['city', 'location', 'gemeinde', 'postalCode', 'postleitzahl'],
    vnbName: ['vnbName', 'gridOperatorName', 'operatorName', 'query'],
    query: ['query', 'gridOperatorName', 'operatorName', 'location'],
  },
  'grid-operations.netzfahrplanGenerate': {
    gridOperatorName: ['gridOperatorName', 'query', 'operatorName'],
    voltageLevel: ['voltageLevel'],
    requestedCapacityKW: ['requestedCapacityKW', 'requestedCapacity', 'gridCapacityKw'],
    firmCapacityKW: ['firmCapacityKW', 'firmCapacity'],
    flexibleCapacityKW: ['flexibleCapacityKW', 'flexibleCapacity'],
    curtailmentWindow: ['curtailmentWindow'],
    contractStatus: ['contractStatus'],
    legalStatus: ['legalStatus'],
    ownerContact: ['ownerContact'],
  },
  'ewk-monitoring.benchmarkVnb': {
    vnbName: ['vnbName', 'vnb1Name', 'query', 'gridOperatorName'],
    bnr: ['bnr', 'bdew', 'bdewCode'],
  },
  'finance-agent.fnavEconomics': {
    gridOperator: ['gridOperator', 'gridOperatorName', 'query', 'operatorName'],
    voltageLevel: ['voltageLevel'],
    ownerContact: ['ownerContact'],
    annualFeeEur: ['annualFeeEur'],
    avoidedCapexOverrideEur: ['avoidedCapexOverrideEur'],
    fnavProfile: ['fnavProfile'],
  },
  'forecast.generationForecast': {
    installationType: ['installationType'],
    forecastDays: ['forecastDays'],
    resolution: ['resolution'],
    startDate: ['startDate', 'dateFrom'],
    gridOperatorMastrId: ['gridOperatorMastrId'],
    postleitzahl: ['postleitzahl', 'postalCode'],
  },
  'flex.planDimming': {
    date: ['date', 'startDate'],
    postalCode: ['postalCode', 'postleitzahl'],
    gridCapacityKw: ['gridCapacityKw'],
    loadForecastOverride: ['loadForecastOverride'],
  },
});

function normalizeExecutionMode(mode) {
  return mode === EXECUTION_MODES.HITL ? EXECUTION_MODES.HITL : EXECUTION_MODES.AUTO;
}

function getCapabilityScore(message, capability) {
  const haystack = String(message || '').toLowerCase();
  return (capability.keywords || []).reduce(
    (acc, keyword) => (haystack.includes(String(keyword).toLowerCase()) ? acc + 1 : acc),
    0
  );
}

function findBestCapability(message) {
  const haystack = String(message || '').toLowerCase();

  const findCapabilityByName = (capabilityName) =>
    CURATED_CAPABILITIES.find((capability) => capability.capability === capabilityName) || null;

  const cyaSignals = [
    'versorgungssicherheit',
    'belastbare aussagen',
    'journalist',
    'fazit',
    'unsicher',
    'kernaussagen',
  ];
  const benchmarkSignals = [
    'benchmark',
    'vergleich',
    'rangliste',
    'digitalisierungsindex',
    'umsetzungsquote',
    'kpi',
  ];
  const fnavSignals = [
    'netzfahrplan',
    'n-1',
    'requestedcapacitykw',
    'voltage level',
    'rechenzentrum',
    'kupferausbau',
    'firm capacity',
    'flexible capacity',
  ];

  if (cyaSignals.some((signal) => haystack.includes(signal))) {
    const cyaCapability = findCapabilityByName('cya_assessment_briefing');
    if (cyaCapability) {
      return {
        capability: cyaCapability,
        score: 100,
        usedFallback: false,
      };
    }
  }

  if (benchmarkSignals.some((signal) => haystack.includes(signal))) {
    const benchmarkCapability = findCapabilityByName('vnb_kpi_benchmark_comparison');
    if (benchmarkCapability) {
      return {
        capability: benchmarkCapability,
        score: 100,
        usedFallback: false,
      };
    }
  }

  if (fnavSignals.some((signal) => haystack.includes(signal))) {
    const fnavCapability = findCapabilityByName('netzfahrplan_fnav_assessment');
    if (fnavCapability) {
      return {
        capability: fnavCapability,
        score: 100,
        usedFallback: false,
      };
    }
  }

  let best = null;
  for (const capability of CURATED_CAPABILITIES) {
    let score = getCapabilityScore(message, capability);

    if (capability.capability === 'mastr_asset_inventory') {
      const hasExplicitMastrSignal = [
        'mastr',
        'redispatch',
        'fernsteuerbarkeit',
        'anlage',
        'anlagen',
        'pv',
        'wind',
        'speicher',
      ].some((signal) => haystack.includes(signal));

      const hasCompetingScenarioSignal = [...cyaSignals, ...benchmarkSignals, ...fnavSignals].some(
        (signal) => haystack.includes(signal)
      );

      if (!hasExplicitMastrSignal || hasCompetingScenarioSignal) {
        score = 0;
      }
    }

    if (!best || score > best.score) {
      best = { capability, score };
    }
  }
  if (!best || best.score === 0) {
    return {
      capability: INTERFACE_PLACEHOLDER_CAPABILITY,
      score: 0,
      usedFallback: true,
    };
  }
  return {
    capability: best.capability,
    score: best.score,
    usedFallback: false,
  };
}

function detectRequestedDomains(message) {
  const text = String(message || '');
  const matches = [];
  for (const domain of DOMAIN_SIGNAL_DEFINITIONS) {
    let firstIndex = Number.POSITIVE_INFINITY;
    for (const pattern of domain.patterns) {
      const found = text.search(pattern);
      if (found >= 0) {
        firstIndex = Math.min(firstIndex, found);
      }
    }
    if (Number.isFinite(firstIndex)) {
      matches.push({ key: domain.key, index: firstIndex });
    }
  }
  return matches.sort((a, b) => a.index - b.index).map((entry) => entry.key);
}

function findMatchingMatrixRoute(domainKeys = []) {
  return ROUTING_MATRIX.find((route) => route.domains.every((domain) => domainKeys.includes(domain)));
}

function buildCuratedBrokerSteps(capability, brokerRecommendation) {
  const blockedActions = new Set(GLOBAL_DO_NOT_USE.map((entry) => entry.action));
  const brokerActions = brokerRecommendation?.recommendedCapabilities?.[0]?.actions;
  const actions = Array.isArray(brokerActions) && brokerActions.length > 0
    ? brokerActions.filter((action) => !blockedActions.has(action))
    : (capability.preferredActions || []).filter((action) => !blockedActions.has(action));

  return actions.map((action, index) => ({
    step: index + 1,
    action,
    purpose: `Execute curated capability path for ${capability.capability}`,
    paramsTemplate: brokerRecommendation?.recommendedPlan?.find((item) => item.action === action)?.params || {},
    source: 'capability-broker',
  }));
}

function extractPromptHints(message) {
  const text = String(message || '');
  const projectIdExplicitMatch = text.match(
    /\b(?:projekt(?:\s*-?\s*id)?|project(?:\s*-?\s*id)?)\s*[:=]\s*([a-z0-9][a-z0-9_-]{2,})\b/i
  );
  const projectInlineMatch = text.match(/\b(?:projekt|project)\s+([a-z0-9][a-z0-9_-]{2,})\b/i);
  const projectCandidate = projectIdExplicitMatch?.[1]
    || projectInlineMatch?.[1]
    || undefined;
  const projectId = projectCandidate
    && !/^(?:in|bei|f(?:ü|u)r)$/i.test(projectCandidate)
    && (/[0-9]/.test(projectCandidate) || /[_-]/.test(projectCandidate) || Boolean(projectIdExplicitMatch))
      ? projectCandidate
      : undefined;
  const isoDates = text.match(/\b\d{4}-\d{2}-\d{2}\b/g) || [];
  const locationPhraseMatch = text.match(/\b(?:in|bei|für|fuer|standort|ort)\s+([A-ZÄÖÜ][A-Za-zÄÖÜäöüß-]+(?:\s+[A-ZÄÖÜ][A-Za-zÄÖÜäöüß-]+){0,2})/);
  const operatorAssertionMatch = text.match(/\b(?:netzbetreiber|vnb|betreiber)\b\s*(?:soll|sei|ist|=|:)?\s*([A-ZÄÖÜ][^,.;\n]+)/i);
  const leadingSegment = text.split(',')[0]?.trim();
  const leadingLooksLikeLocation =
    leadingSegment
    && !/\b(?:netzbetreiber|vnb|betreiber|bdew|snb)\b/i.test(leadingSegment)
    && /[A-Za-zÄÖÜäöüß]/.test(leadingSegment)
    && leadingSegment.split(/\s+/).length <= 4;

  const locationCandidate = locationPhraseMatch?.[1]?.trim()
    || (leadingLooksLikeLocation ? leadingSegment : undefined);

  const operatorCandidate = operatorAssertionMatch?.[1]
    ? operatorAssertionMatch[1]
      .replace(/\b(?:sein|ist|sind)\b.*$/i, '')
      .trim()
    : undefined;

  const postalMatch = text.match(/\b\d{5}\b/);
  const capacityKwMatch = text.match(/\b(\d+(?:[.,]\d+)?)\s*kW\b/i);
  const capacityMwMatch = text.match(/\b(\d+(?:[.,]\d+)?)\s*MW\b/i);
  const requestedCapacityMatch =
    text.match(/\brequested\s*capacity\s*kw\s*[:=]?\s*(\d+(?:[.,]\d+)?)/i)
    || text.match(/\brequestedcapacitykw\s*[:=]?\s*(\d+(?:[.,]\d+)?)/i)
    || text.match(/\brequested\s*capacity\s*[:=]?\s*(\d+(?:[.,]\d+)?)/i);
  const bdewNumericMatch = text.match(/\b([0-9]{13})\b/);
  const bdewPrefixedMatch = text.match(
    /\b(?:bdew(?:\s*-?\s*code)?|code)\s*[:=]\s*([A-Z0-9]{6,20})\b/i
  );
  const bdewCandidate = bdewPrefixedMatch?.[1] || bdewNumericMatch?.[1];
  const bdewCode = bdewCandidate && /\d/.test(bdewCandidate)
    ? String(bdewCandidate).toUpperCase()
    : undefined;

  const requestedCapacityKW = requestedCapacityMatch
    ? Number(requestedCapacityMatch[1].replace(',', '.'))
    : (capacityMwMatch
      ? Number(capacityMwMatch[1].replace(',', '.')) * 1000
      : (capacityKwMatch ? Number(capacityKwMatch[1].replace(',', '.')) : undefined));

  return {
    projectId,
    location: locationCandidate,
    city: locationCandidate,
    query: operatorCandidate || locationCandidate,
    gridOperatorName: operatorCandidate,
    assertedGridOperatorName: operatorCandidate,
    gridOperatorBdew: bdewCode,
    bdewCode,
    dateFrom: isoDates[0],
    dateTo: isoDates[1],
    startDate: isoDates[0],
    postleitzahl: postalMatch ? postalMatch[0] : undefined,
    postalCode: postalMatch ? postalMatch[0] : undefined,
    gridCapacityKw: requestedCapacityKW,
    requestedCapacityKW,
  };
}

function parseBenchmarkNames(text = '') {
  const againstMatch = String(text || '').match(/\b(?:benchmark(?:e|t)?|vergleich(?:e|t)?)\s+(.+?)\s+gegen\s+(.+?)(?:[\.!?]|$)/i);
  if (!againstMatch) {
    return { vnb1Name: undefined, vnb2Name: undefined };
  }
  const vnb1Name = String(againstMatch[1] || '').trim() || undefined;
  const secondPart = String(againstMatch[2] || '').trim();
  const vnb2Name = secondPart.split(/\s+(?:und|,|vs\.?|versus)\s+/i)[0]?.trim() || undefined;
  return { vnb1Name, vnb2Name };
}

function getValueAtPath(source, dottedPath) {
  if (!source || !dottedPath) return undefined;
  const tokens = String(dottedPath)
    .replace(/\[(\d+)\]/g, '.$1')
    .split('.')
    .filter(Boolean);

  return tokens.reduce((acc, key) => {
    if (acc === null || acc === undefined) return undefined;
    if (Array.isArray(acc) && /^\d+$/.test(key)) {
      return acc[Number(key)];
    }
    return acc[key];
  }, source);
}

function resolvePlaceholderReference(value, executionState) {
  if (typeof value !== 'string' || !value.startsWith('__step_')) {
    return value;
  }
  const match = value.match(/^__step_(\d+)\.(.+)$/);
  if (!match) return value;
  const stepNumber = Number(match[1]);
  const path = match[2];
  const stepResult = executionState?.stepResults?.[stepNumber];
  const sourceCandidates = [
    stepResult,
    stepResult?.data,
    stepResult?.raw,
    stepResult?.result,
    stepResult?.data?.data,
    stepResult?.data?.result,
    stepResult?.raw?.data,
    stepResult?.raw?.result,
  ].filter((candidate) => candidate && typeof candidate === 'object');
  const sources = [...new Set(sourceCandidates)];

  const candidatePaths = [path];
  if (path.startsWith('data.')) {
    candidatePaths.push(path.slice(5));
  } else {
    candidatePaths.push(`data.${path}`);
  }
  if (path.startsWith('result.')) {
    candidatePaths.push(path.slice(7));
  } else {
    candidatePaths.push(`result.${path}`);
  }
  const uniquePaths = [...new Set(candidatePaths.filter(Boolean))];

  for (const source of sources) {
    for (const candidatePath of uniquePaths) {
      const resolved = getValueAtPath(source, candidatePath);
      if (resolved !== undefined) {
        return resolved;
      }
    }
  }

  return undefined;
}

function deepResolveTemplate(value, executionState) {
  if (Array.isArray(value)) {
    return value.map((item) => deepResolveTemplate(item, executionState));
  }
  if (value && typeof value === 'object') {
    return Object.fromEntries(
      Object.entries(value).map(([key, child]) => [key, deepResolveTemplate(child, executionState)])
    );
  }
  return resolvePlaceholderReference(value, executionState);
}

function findContextValue(action, key, knownContext, promptHints) {
  const actionOverrides = knownContext?.stepParams?.[action] || knownContext?.byAction?.[action] || {};
  if (Object.prototype.hasOwnProperty.call(actionOverrides, key)) {
    return actionOverrides[key];
  }

  const aliases = ACTION_PARAM_ALIASES[action]?.[key] || [key];
  for (const alias of aliases) {
    if (Object.prototype.hasOwnProperty.call(knownContext || {}, alias)) {
      return knownContext[alias];
    }
    if (Object.prototype.hasOwnProperty.call(promptHints || {}, alias)) {
      return promptHints[alias];
    }
  }
  return undefined;
}

function fillTemplateWithContext(template, action, knownContext, promptHints, executionState) {
  const resolved = deepResolveTemplate(template || {}, executionState);

  if (Array.isArray(resolved)) {
    return resolved;
  }
  if (!resolved || typeof resolved !== 'object') {
    return resolved;
  }

  const unresolvedStepPlaceholders = new Set();
  const hydrated = Object.fromEntries(
    Object.entries(resolved).map(([key, value]) => {
      const originalTemplateValue = template?.[key];
      if (value === null || value === undefined) {
        if (typeof originalTemplateValue === 'string' && originalTemplateValue.startsWith('__step_')) {
          unresolvedStepPlaceholders.add(key);
        }
        const replacement = findContextValue(action, key, knownContext, promptHints);
        return [key, replacement];
      }
      return [key, value];
    })
  );

  const parsedBenchmarkNames = parseBenchmarkNames(String(knownContext?.lastUserMessage || promptHints?.query || ''));

  const isLikelyFullPromptQuery = (value) => {
    if (typeof value !== 'string') return false;
    const text = value.trim();
    if (!text) return false;
    const wordCount = text.split(/\s+/).filter(Boolean).length;
    if (text.length > 80 || wordCount > 8) return true;
    if (/[,?!]/.test(text) && wordCount > 5) return true;
    return /\b(?:bitte|projekt|netzbetreiber|standort|risiko|bewertung)\b/i.test(text) && wordCount > 4;
  };

  if (action === 'grid-operations.marketPartners') {
    if (hydrated.query == null || hydrated.query === '' || isLikelyFullPromptQuery(hydrated.query)) {
      hydrated.query =
        knownContext?.assertedGridOperatorName ||
        promptHints?.assertedGridOperatorName ||
        knownContext?.query ||
        knownContext?.vnb1Name ||
        parsedBenchmarkNames.vnb1Name ||
        knownContext?.gridOperatorName ||
        promptHints?.gridOperatorName ||
        knownContext?.location ||
        promptHints?.location ||
        promptHints?.city ||
        promptHints?.query ||
        '*';
    }
    if (hydrated.limit == null) {
      hydrated.limit = 3;
    }
  }

  if (action === 'grid-connection.fnavValidate') {
    if (hydrated.gridOperatorName == null && knownContext?.gridOperatorName) {
      hydrated.gridOperatorName = knownContext.gridOperatorName;
    }
    if (hydrated.voltageLevel == null && knownContext?.voltageLevel) {
      hydrated.voltageLevel = knownContext.voltageLevel;
    }
    if (hydrated.ownerContact == null && knownContext?.ownerContact) {
      hydrated.ownerContact = knownContext.ownerContact;
    }
    if (typeof hydrated.fnavProfile === 'string') {
      hydrated.fnavProfile = undefined;
    }
    if (hydrated.fnavProfile == null) {
      const requestedCapacity =
        knownContext?.requestedCapacityKW
        ?? knownContext?.requestedCapacity
        ?? promptHints?.requestedCapacityKW;
      if (requestedCapacity != null) {
        hydrated.fnavProfile = {
          requestedCapacity,
          firmCapacity: knownContext?.firmCapacityKW ?? knownContext?.firmCapacity,
          flexibleCapacity: knownContext?.flexibleCapacityKW ?? knownContext?.flexibleCapacity,
          curtailmentWindow: knownContext?.curtailmentWindow,
          contractStatus: knownContext?.contractStatus,
          legalStatus: knownContext?.legalStatus,
        };
      }
    }
  }

  if (action === 'grid-operations.netzfahrplanGenerate') {
    if (hydrated.requestedCapacityKW == null) {
      hydrated.requestedCapacityKW =
        knownContext?.requestedCapacityKW
        ?? knownContext?.requestedCapacity
        ?? promptHints?.requestedCapacityKW;
    }
    if (hydrated.ownerContact == null && knownContext?.ownerContact) {
      hydrated.ownerContact = knownContext.ownerContact;
    }
  }

  if (action === 'ewk-monitoring.benchmarkVnb') {
    if (hydrated.vnbName == null || hydrated.vnbName === '') {
      hydrated.vnbName =
        knownContext?.vnbName
        || knownContext?.vnb1Name
        || parsedBenchmarkNames.vnb1Name
        || knownContext?.gridOperatorName
        || promptHints?.query
        || undefined;
    }
    if (hydrated.bnr == null && knownContext?.bnr) {
      hydrated.bnr = knownContext.bnr;
    }
  }

  if (action === 'grid-operations.vnbLookup') {
    if (hydrated.bdew != null && unresolvedStepPlaceholders.has('city')) {
      hydrated.city = undefined;
    }
  }

  return hydrated;
}

function pruneUndefinedDeep(value) {
  if (Array.isArray(value)) {
    return value.map(pruneUndefinedDeep).filter((item) => item !== undefined);
  }
  if (!value || typeof value !== 'object') {
    return value === undefined ? undefined : value;
  }
  const entries = Object.entries(value)
    .map(([key, child]) => [key, pruneUndefinedDeep(child)])
    .filter(([, child]) => child !== undefined);
  return Object.fromEntries(entries);
}

function getMissingInputs(action, params = {}) {
  const rules = ACTION_REQUIREMENTS[action];
  if (!rules) return [];
  const missing = [];

  if (Array.isArray(rules.allOf)) {
    for (const key of rules.allOf) {
      if (!Object.prototype.hasOwnProperty.call(params, key) || params[key] === undefined) {
        missing.push(key);
      }
    }
  }

  if (Array.isArray(rules.anyOf) && rules.anyOf.length > 0) {
    const hasAny = rules.anyOf.some(
      (key) => Object.prototype.hasOwnProperty.call(params, key) && params[key] !== undefined
    );
    if (!hasAny) {
      missing.push(`oneOf:${rules.anyOf.join('|')}`);
    }
  }

  return missing;
}

function shouldAttachRegulatoryContextNote(action = '') {
  const value = String(action || '').toLowerCase();
  return /^(grid-operations\.|grid-connection\.|finance-agent\.|redispatch|settlement\.)/.test(value);
}

function toContextNote(knowledgeContext = {}, action = '') {
  if (!knowledgeContext || !knowledgeContext.regulatoryFrame) {
    return undefined;
  }
  if (!shouldAttachRegulatoryContextNote(action)) {
    return undefined;
  }
  return `Regulatorischer Rahmen: ${knowledgeContext.regulatoryFrame}`;
}

function buildExecutionPlan({ message, brokerRecommendation, knowledgeContext = null }) {
  const promptHints = extractPromptHints(message);
  const requestedDomains = detectRequestedDomains(message);
  const route = findMatchingMatrixRoute(requestedDomains);

  if (route) {
    const unsupportedDomains = requestedDomains.filter((domain) => !route.domains.includes(domain));
    return {
      source: 'routing-matrix',
      routeKey: route.key,
      routeLabel: route.label,
      primaryIntent: route.primaryIntent,
      secondaryIntents: route.secondaryIntents,
      requestedDomains,
      unsupportedDomains,
      steps: route.steps.map((step, index) => ({
        step: index + 1,
        action: step.action,
        purpose: step.purpose,
        paramsTemplate: step.paramsTemplate,
        source: step.source,
        dependsOnStep: step.dependsOnStep || null,
        contextNote: toContextNote(knowledgeContext, step.action),
      })),
      status: 'ready',
      warnings: unsupportedDomains.length > 0
        ? [`Unsupported extra domains requested: ${unsupportedDomains.join(', ')}`]
        : [],
      promptHints,
    };
  }

  const selected = brokerRecommendation?.recommendedCapabilities?.[0]?.capability
    ? {
        capability:
          CURATED_CAPABILITIES.find(
            (item) => item.capability === brokerRecommendation.recommendedCapabilities[0].capability
          ) || INTERFACE_PLACEHOLDER_CAPABILITY,
        usedFallback:
          brokerRecommendation.recommendedCapabilities[0].capability ===
          INTERFACE_PLACEHOLDER_CAPABILITY.capability,
      }
    : findBestCapability(message);

  const steps = buildCuratedBrokerSteps(selected.capability, brokerRecommendation)
    .map((step) => ({
      ...step,
      contextNote: toContextNote(knowledgeContext, step.action),
    }));
  const unsupportedDomains = requestedDomains.length > 1 ? requestedDomains.slice(1) : [];

  return {
    source: 'capability-broker',
    routeKey: null,
    routeLabel: selected.capability.capability,
    primaryIntent: selected.capability.intent,
    secondaryIntents: Array.isArray(selected.capability.secondaryIntents)
      ? selected.capability.secondaryIntents
      : [],
    requestedDomains,
    unsupportedDomains,
    steps,
    status: selected.usedFallback ? 'partial' : 'ready',
    warnings: selected.usedFallback || unsupportedDomains.length > 0
      ? [`No routing-matrix entry for chained domains: ${requestedDomains.join(' -> ')}`]
      : [],
    promptHints,
    capability: selected.capability,
  };
}

module.exports = {
  EXECUTION_MODES,
  ROUTING_MATRIX,
  normalizeExecutionMode,
  detectRequestedDomains,
  buildExecutionPlan,
  fillTemplateWithContext,
  pruneUndefinedDeep,
  getMissingInputs,
};
