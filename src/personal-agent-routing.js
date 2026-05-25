'use strict';

const {
  CURATED_CAPABILITIES,
  INTERFACE_PLACEHOLDER_CAPABILITY,
  GLOBAL_DO_NOT_USE,
} = require('./capability-catalog');
const { planEvidence } = require('./evidence-planner');

const EXECUTION_MODES = Object.freeze({
  AUTO: 'auto',
  HITL: 'hitl',
});

const CHAT_MODES = Object.freeze({
  EXECUTION: 'execution',
  CONSULTATION: 'consultation',
});

const ROUTING_CONTROL_ACTIONS = Object.freeze({
  MISSING_CONTEXT: 'MISSING_CONTEXT',
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
  'znp.assessPortfolio': { allOf: ['projectId'] },
  'redispatch-expost.audit': {
    anyOf: ['gridOperatorId', 'gridOperatorBdew', 'gridOperatorName'],
  },
  'settlement.calculateRedispatch': { allOf: ['installations', 'period'] },
  'grid-connection.fnavValidate': { allOf: ['fnavProfile'] },
  'finance-agent.fnavEconomics': { allOf: ['fnavProfile'] },
  'finance-agent.analyze': { allOf: ['query'] },
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
  'znp.assessPortfolio': {
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
  'finance-agent.analyze': {
    query: ['query', 'dueDiligenceQuestion', 'lastUserMessage'],
    profileId: ['profileId'],
    mode: ['mode'],
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

function normalizeChatMode(mode) {
  const normalized = String(mode || '')
    .trim()
    .toLowerCase();
  if (normalized === CHAT_MODES.EXECUTION) return CHAT_MODES.EXECUTION;
  if (normalized === CHAT_MODES.CONSULTATION) return CHAT_MODES.CONSULTATION;
  if (normalized === 'consulting') return CHAT_MODES.CONSULTATION;
  return null;
}

function detectExplicitChatModeSwitch(message = '') {
  const haystack = String(message || '').toLowerCase();
  if (!haystack) return null;

  const executionSwitchSignals = [
    /wechsle\s+in\s+den\s+pr[üu]f-modus/i,
    /f[üu]hre\s+die\s+pr[üu]fung\s+durch/i,
    /jetzt\s+pr[üu]fen/i,
  ];
  if (executionSwitchSignals.some((rx) => rx.test(haystack))) {
    return CHAT_MODES.EXECUTION;
  }

  const consultationSwitchSignals = [
    /wechsle\s+in\s+den\s+beratungsmodus/i,
    /nur\s+beraten/i,
    /ohne\s+pr[üu]fung/i,
  ];
  if (consultationSwitchSignals.some((rx) => rx.test(haystack))) {
    return CHAT_MODES.CONSULTATION;
  }

  return null;
}

function detectChatMode(message, brokerRecommendation = {}, session = {}) {
  const explicit = detectExplicitChatModeSwitch(message);
  if (explicit) return explicit;

  const persisted = normalizeChatMode(session?.chatMode || session?.l3?.chatMode || null);
  const haystack = String(message || '').toLowerCase();

  const consultationSignals = [
    /wie hoch/i,
    /wahrscheinlichkeit/i,
    /was kann ich tun/i,
    /wie vermeide/i,
    /warum/i,
    /bedeutet das/i,
    /was passiert wenn/i,
    /erkl[äa]r/i,
    /abgeregelt/i,
    /redispatch/i,
    /problem/i,
    /frage/i,
    /unsicher/i,
    /soll ich/i,
    /empfiehl/i,
    /was w[üu]rdest du/i,
  ];

  const executionSignals = [
    /pr[üu]fe/i,
    /validiere/i,
    /suche/i,
    /finde/i,
    /ermittle/i,
    /mastr/i,
    /bdew/i,
    /netzbetreiber/i,
    /anschlusszusage/i,
    /dokument/i,
    /nachweis/i,
    /beleg/i,
  ];

  const hasConsultation = consultationSignals.some((rx) => rx.test(haystack));
  const hasExecution = executionSignals.some((rx) => rx.test(haystack));

  if (hasExecution && !hasConsultation) return CHAT_MODES.EXECUTION;
  if (hasConsultation) return CHAT_MODES.CONSULTATION;

  if (Number(brokerRecommendation?.confidence || 0) < 0.6) {
    return CHAT_MODES.CONSULTATION;
  }

  if (persisted) return persisted;
  return CHAT_MODES.CONSULTATION;
}

function getCapabilityScore(message, capability) {
  const haystack = String(message || '').toLowerCase();
  return (capability.keywords || []).reduce(
    (acc, keyword) => (haystack.includes(String(keyword).toLowerCase()) ? acc + 1 : acc),
    0
  );
}

function tokenizeForSemanticRouting(text = '') {
  return String(text || '')
    .toLowerCase()
    .replace(/[\W_]+/g, ' ')
    .split(/\s+/)
    .filter((token) => token && token.length >= 3);
}

function scoreTokenOverlap(messageTokens = [], referenceTokens = []) {
  if (!Array.isArray(messageTokens) || messageTokens.length === 0) return 0;
  if (!Array.isArray(referenceTokens) || referenceTokens.length === 0) return 0;

  const ref = new Set(referenceTokens);
  let overlap = 0;
  for (const token of messageTokens) {
    if (ref.has(token)) overlap += 1;
  }
  return overlap / Math.max(1, messageTokens.length);
}

function scoreSemanticCapabilityMatch(message = '', capability = {}) {
  const messageTokens = tokenizeForSemanticRouting(message);
  const referenceText = [
    capability?.capability || '',
    capability?.intent || '',
    capability?.domain || '',
    ...(Array.isArray(capability?.keywords) ? capability.keywords : []),
    ...(Array.isArray(capability?.risksAndNotes) ? capability.risksAndNotes : []),
  ]
    .filter(Boolean)
    .join(' ');
  const referenceTokens = tokenizeForSemanticRouting(referenceText);

  const overlap = scoreTokenOverlap(messageTokens, referenceTokens);
  const lexicalBoost =
    getCapabilityScore(message, capability) / Math.max(1, (capability?.keywords || []).length);
  return Number((overlap * 0.7 + lexicalBoost * 0.3).toFixed(4));
}

function fuzzyClassifyConsultationIntent(message = '', knownContext = {}, extractedInputs = []) {
  const haystack = String(message || '').toLowerCase();
  const availableInputs = Array.isArray(extractedInputs) ? extractedInputs : [];

  const semanticProfiles = [
    {
      workflowType: 'advisory_only',
      personaType: 'governance',
      domainIntent: 'governance_advisory',
      executionReadinessIntent: 'advisory_only',
      advisoryOnly: true,
      terms: [
        'governance',
        'blackbox',
        'black box',
        'ki',
        'ai',
        'transparenz',
        'aufsicht',
        'haftung',
        'compliance',
      ],
    },
    {
      workflowType: 'process_governance_decision_matrix',
      personaType: 'operations_management',
      domainIntent: 'process_governance',
      executionReadinessIntent: 'consultation_only',
      advisoryOnly: true,
      terms: ['gremium', 'prozess', 'entscheidungsmatrix', 'freigabe', 'ablauf', 'entscheidung'],
    },
    {
      workflowType: 'edm_market_communication_diagnostics',
      personaType: 'market_communication',
      domainIntent: 'edm_market_communication',
      executionReadinessIntent: 'awaiting_input',
      advisoryOnly: false,
      terms: [
        'edm',
        'mako',
        'marktkommunikation',
        'bilanzierung',
        'edi',
        'datenaustausch',
        'nachrichtenformat',
      ],
    },
    {
      workflowType: 'prosumer_nap_wallet_onboarding',
      personaType: 'prosumer',
      domainIntent: 'prosumer_onboarding',
      executionReadinessIntent: 'awaiting_input',
      advisoryOnly: false,
      terms: ['prosumer', 'wallet', 'nap', 'netzanschlusspunkt', 'onboarding', 'kundenportal'],
    },
    {
      workflowType: 'bess_screening',
      personaType: 'grid_planning',
      domainIntent: 'bess_screening',
      executionReadinessIntent: 'awaiting_input',
      advisoryOnly: false,
      terms: [
        'bess',
        'batteriespeicher',
        'großspeicher',
        'stromspeicher',
        'speicherprojekt',
        'mw',
        'mwh',
      ],
    },
  ];

  const scored = semanticProfiles
    .map((profile) => {
      const score = profile.terms.reduce(
        (acc, term) => (haystack.includes(term) ? acc + 1 : acc),
        0
      );
      return { ...profile, score };
    })
    .sort((a, b) => b.score - a.score);

  const best = scored[0] || semanticProfiles[0];
  const confidence = Math.max(0, Math.min(1, best.score / Math.max(2, best.terms.length * 0.5)));

  const missingInputs = [];
  if (best.workflowType === 'bess_screening') {
    const hasState =
      availableInputs.some((entry) =>
        ['state', 'bundesland'].includes(String(entry?.param || '').toLowerCase())
      ) || Boolean(knownContext?.state || knownContext?.bundesland);
    if (!hasState) {
      missingInputs.push({ param: 'state', label: 'Bundesland oder Region', priority: 'critical' });
    }
  }

  return {
    workflowType: best.workflowType,
    personaType: best.personaType,
    domainIntent: best.domainIntent,
    executionReadinessIntent: best.executionReadinessIntent,
    advisoryOnly: Boolean(best.advisoryOnly),
    availableInputs,
    missingInputs,
    confidence: Number(confidence.toFixed(2)),
    rationale:
      best.score > 0
        ? `Fuzzy-Semantik-Match auf ${best.workflowType} mit ${best.score} Signalen.`
        : 'Kein starker semantischer Treffer; konservativer Fallback.',
    source: 'fuzzy',
  };
}

function findBestCapability(message) {
  const haystack = String(message || '').toLowerCase();

  const semanticCapabilityCandidates = CURATED_CAPABILITIES.map((capability) => ({
    capability,
    score: scoreSemanticCapabilityMatch(message, capability),
  })).sort((a, b) => b.score - a.score);
  const semanticTop = semanticCapabilityCandidates[0] || null;

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
  const financierDueDiligenceSignals = [
    'due diligence',
    'risk assessment',
    'kreditausschuss',
    'credit committee',
    'bankability',
    'condition precedent',
    'financier',
    'finanzierer',
  ];
  const vdmiGovernanceSignals = [
    'arealnetzbetreiber',
    '§17 enwg',
    '17 enwg',
    'ohne formales netzanschlussbegehren',
    'netzanschlussbegehren',
    'projektträger nicht netzbetreiber',
    'darf keine netzanschlusszusage treffen',
    'zulässige aussagen',
    'rollengrenze',
  ];
  const vdmiDecisionCoreSignals = [
    'anschlusszusage',
    'kapazitätszusage',
    'kapazitaetszusage',
    'übergabepunkt',
    'uebergabepunkt',
    'netzbetreiberentscheidung',
    'belastbare zusage',
    'darf der netzbetreiber zusagen',
    'decision_blocked_pending_formal_request',
  ];
  const vdmiDecisionContextSignals = ['formales netzanschlussbegehren', '§17 enwg', '17 enwg'];
  const vdmiAssetValidationSignals = [
    'asset validation',
    'asset-validierung',
    'asset validierung',
    'asset-prüfung',
    'asset pruefung',
    'assetklasse',
    'evidence',
    'evidenz',
    'nachweis',
    'beleg',
    'forbidden assumption',
    'forbidden assumptions',
    'verbotene annahme',
    'verbotene annahmen',
    'risk factor',
    'risk factors',
    'risikofaktor',
    'risikofaktoren',
    'grid-connection-asset-validation',
  ];

  const hasVdmiBoundaryCombo =
    /(rollen|rolle|schnittstellen)/i.test(haystack) &&
    /(netzanschluss|enwg|arealnetz|gatekeeper)/i.test(haystack);

  const hasVdmiDecisionCombo =
    /(zusage|entscheidung|uebergabepunkt|übergabepunkt|kapazit[aä]t)/i.test(haystack) &&
    /(netzbetreiber|formales netzanschlussbegehren|§17|17 enwg|enwg)/i.test(haystack);

  const hasVdmiDecisionSignal =
    vdmiDecisionCoreSignals.some((signal) => haystack.includes(signal)) ||
    (vdmiDecisionContextSignals.some((signal) => haystack.includes(signal)) &&
      /(zusage|entscheidung|uebergabepunkt|übergabepunkt|kapazit[aä]t|anschluss)/i.test(haystack));

  if (hasVdmiDecisionSignal || hasVdmiDecisionCombo) {
    const vdmiDecisionCapability = findCapabilityByName('vdmi_grid_connection_decision_governance');
    if (vdmiDecisionCapability) {
      return {
        capability: vdmiDecisionCapability,
        score: 130,
        usedFallback: false,
      };
    }
  }

  const hasFinancierDueDiligenceCombo =
    /(due\s*diligence|risk\s*assessment|kreditausschuss|credit\s*committee|bankability)/i.test(
      haystack
    ) && /(finanz|financier|kredit|committee|condition\s*precedent|risiko)/i.test(haystack);

  if (
    financierDueDiligenceSignals.some((signal) => haystack.includes(signal)) ||
    hasFinancierDueDiligenceCombo
  ) {
    const financierDueDiligenceCapability = findCapabilityByName(
      'financier_due_diligence_assessment'
    );
    if (financierDueDiligenceCapability) {
      return {
        capability: financierDueDiligenceCapability,
        score: 125,
        usedFallback: false,
      };
    }
  }

  const hasVdmiAssetValidationCombo =
    /(asset|assetklasse|transformator|trafo|dossier|task\s*-?id)/i.test(haystack) &&
    /(evidence|evidenz|nachweis|beleg|risk|risiko|forbidden|verbotene annahme)/i.test(haystack);

  const hasAdvisoryGovernanceContext =
    /(ki|ai|black\s*box|blackbox|governance|aufsicht|compliance|haftung)/i.test(haystack);
  const hasBessContext = /(bess|batteriespeicher|großspeicher|stromspeicher)/i.test(haystack);
  const hasEdmContext = /(edm|mako|marktkommunikation|bilanzierung|edi|datenaustausch)/i.test(
    haystack
  );
  const hasProsumerContext = /(prosumer|wallet|netzanschlusspunkt|\bnap\b)/i.test(haystack);

  const disallowVdmiAssetValidationByGuardrail =
    hasAdvisoryGovernanceContext || hasBessContext || hasEdmContext || hasProsumerContext;

  if (
    !disallowVdmiAssetValidationByGuardrail &&
    (vdmiAssetValidationSignals.some((signal) => haystack.includes(signal)) ||
      hasVdmiAssetValidationCombo)
  ) {
    const vdmiAssetValidationCapability = findCapabilityByName('vdmi_asset_validation_governance');
    if (vdmiAssetValidationCapability) {
      return {
        capability: vdmiAssetValidationCapability,
        score: 120,
        usedFallback: false,
      };
    }
  }

  if (
    hasAdvisoryGovernanceContext &&
    semanticTop?.capability?.capability === 'residual_load_forecast_for_dso'
  ) {
    const governanceFallback = findCapabilityByName('vdmi_role_boundary_governance');
    if (governanceFallback) {
      return {
        capability: governanceFallback,
        score: 95,
        usedFallback: false,
      };
    }
  }

  if (vdmiGovernanceSignals.some((signal) => haystack.includes(signal)) || hasVdmiBoundaryCombo) {
    const vdmiGovernanceCapability = findCapabilityByName('vdmi_role_boundary_governance');
    if (vdmiGovernanceCapability) {
      return {
        capability: vdmiGovernanceCapability,
        score: 100,
        usedFallback: false,
      };
    }
  }

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
        'pv',
        'wind',
        'speicher',
      ].some((signal) => haystack.includes(signal));

      if (hasProsumerContext || hasEdmContext) {
        score = 0;
      }

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

  if (semanticTop && semanticTop.score >= 0.42) {
    return {
      capability: semanticTop.capability,
      score: Number((semanticTop.score * 100).toFixed(0)),
      usedFallback: false,
    };
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

function extractForecastTemporalHints(text = '') {
  const haystack = String(text || '').toLowerCase();

  const explicitDaysMatch = haystack.match(
    /(?:n[äa]chste(?:n)?|kommende(?:n)?)\s*(\d{1,2})\s*(tagen|tage|tag|wochen|woche)/i
  );
  if (explicitDaysMatch) {
    const amount = Number(explicitDaysMatch[1]);
    const unit = explicitDaysMatch[2];
    if (Number.isFinite(amount) && amount > 0) {
      return {
        forecastDays: /woche/.test(unit) ? amount * 7 : amount,
        timeframeHint: 'near_term_forecast',
      };
    }
  }

  if (/\bmorgen\b/i.test(haystack)) {
    return { forecastDays: 1, timeframeHint: 'near_term_forecast' };
  }

  if (/\b(?:n[äa]chste(?:n)?|kommende(?:n)?)\s+woche(?:n)?\b/i.test(haystack)) {
    return { forecastDays: 7, timeframeHint: 'near_term_forecast' };
  }

  if (/\b(?:in\s+den\s+)?(?:n[äa]chste(?:n)?|kommende(?:n)?)\s+tage(?:n)?\b/i.test(haystack)) {
    return { forecastDays: 3, timeframeHint: 'near_term_forecast' };
  }

  return { forecastDays: undefined, timeframeHint: undefined };
}

function detectEvidenceSignalKey(message = '', knownContext = {}, promptHints = {}) {
  const text = String(message || '').toLowerCase();
  const hasRedispatchSignal = /\bredispatch\b/i.test(text);
  const hasProbabilitySignal =
    /\bwahrscheinlichkeit\b|\blikelihood\b|\brisiko\b|\bwie\s+hoch\b/i.test(text);
  const hasNearTermSignal =
    /\bmorgen\b|\b(?:in\s+den\s+)?(?:n[äa]chste(?:n)?|kommende(?:n)?)\s+(?:tage(?:n)?|woche(?:n)?)\b/i.test(
      text
    ) || Number.isFinite(Number(promptHints?.forecastDays || knownContext?.forecastDays));
  const hasStorageOrGenerationSignal =
    /\bpv\b|\bspeicher\b|\banlage\b|\berzeugung\b|\bsolar\b|\bwind\b/i.test(text);

  if (
    hasRedispatchSignal &&
    hasNearTermSignal &&
    (hasProbabilitySignal || hasStorageOrGenerationSignal)
  ) {
    return 'redispatch_probability_forecast';
  }

  return null;
}

function findMatchingMatrixRoute(domainKeys = []) {
  return ROUTING_MATRIX.find((route) =>
    route.domains.every((domain) => domainKeys.includes(domain))
  );
}

function isHitlRequiredForAction(capability, action) {
  const policy = capability?.hitlPolicy;
  if (!policy || policy.criticalFlow !== true) {
    return false;
  }

  if (Array.isArray(policy.stepActions) && policy.stepActions.length > 0) {
    return policy.stepActions.includes(action);
  }

  return policy.mode === 'mandatory_step_approval';
}

function buildCuratedBrokerSteps(capability, brokerRecommendation) {
  const blockedActions = new Set(GLOBAL_DO_NOT_USE.map((entry) => entry.action));
  const brokerActions = brokerRecommendation?.recommendedCapabilities?.[0]?.actions;
  const actions =
    Array.isArray(brokerActions) && brokerActions.length > 0
      ? brokerActions.filter((action) => !blockedActions.has(action))
      : (capability.preferredActions || []).filter((action) => !blockedActions.has(action));

  return actions.map((action, index) => ({
    step: index + 1,
    action,
    purpose: `Execute curated capability path for ${capability.capability}`,
    paramsTemplate:
      brokerRecommendation?.recommendedPlan?.find((item) => item.action === action)?.params || {},
    source: 'capability-broker',
    hitlRequired: isHitlRequiredForAction(capability, action),
    criticalityClass: capability?.hitlPolicy?.criticalityClass || null,
  }));
}

function extractPromptHints(message) {
  const text = String(message || '');
  const temporalHints = extractForecastTemporalHints(text);
  const projectIdExplicitMatch = text.match(
    /\b(?:projekt(?:\s*-?\s*id)?|project(?:\s*-?\s*id)?)\s*[:=]\s*([a-z0-9][a-z0-9_-]{2,})\b/i
  );
  const projectInlineMatch = text.match(/\b(?:projekt|project)\s+([a-z0-9][a-z0-9_-]{2,})\b/i);
  const projectCandidate = projectIdExplicitMatch?.[1] || projectInlineMatch?.[1] || undefined;
  const projectId =
    projectCandidate &&
    !/^(?:in|bei|f(?:ü|u)r)$/i.test(projectCandidate) &&
    (/[0-9]/.test(projectCandidate) ||
      /[_-]/.test(projectCandidate) ||
      Boolean(projectIdExplicitMatch))
      ? projectCandidate
      : undefined;
  const isoDates = text.match(/\b\d{4}-\d{2}-\d{2}\b/g) || [];
  const locationPhraseMatch = text.match(
    /\b(?:in|bei|für|fuer|standort|ort)\s+([A-ZÄÖÜ][A-Za-zÄÖÜäöüß-]+(?:\s+[A-ZÄÖÜ][A-Za-zÄÖÜäöüß-]+){0,2})/
  );
  const operatorAssertionMatch = text.match(
    /\b(?:netzbetreiber|vnb|betreiber)\b\s*(?:soll|sei|ist|=|:)?\s*([A-ZÄÖÜ][^,.;\n]+)/i
  );
  const leadingSegment = text.split(',')[0]?.trim();
  const leadingLooksLikeLocation =
    leadingSegment &&
    !/\b(?:netzbetreiber|vnb|betreiber|bdew|snb)\b/i.test(leadingSegment) &&
    /[A-Za-zÄÖÜäöüß]/.test(leadingSegment) &&
    leadingSegment.split(/\s+/).length <= 4;

  const locationCandidate =
    locationPhraseMatch?.[1]?.trim() || (leadingLooksLikeLocation ? leadingSegment : undefined);

  const operatorCandidate = operatorAssertionMatch?.[1]
    ? operatorAssertionMatch[1].replace(/\b(?:sein|ist|sind)\b.*$/i, '').trim()
    : undefined;

  const postalMatch = text.match(/\b\d{5}\b/);
  const capacityKwMatch = text.match(/\b(\d+(?:[.,]\d+)?)\s*kW\b/i);
  const capacityMwMatch = text.match(/\b(\d+(?:[.,]\d+)?)\s*MW\b/i);
  const requestedCapacityMatch =
    text.match(/\brequested\s*capacity\s*kw\s*[:=]?\s*(\d+(?:[.,]\d+)?)/i) ||
    text.match(/\brequestedcapacitykw\s*[:=]?\s*(\d+(?:[.,]\d+)?)/i) ||
    text.match(/\brequested\s*capacity\s*[:=]?\s*(\d+(?:[.,]\d+)?)/i);
  const bdewNumericMatch = text.match(/\b([0-9]{13})\b/);
  const bdewPrefixedMatch = text.match(
    /\b(?:bdew(?:\s*-?\s*code)?|code)\s*[:=]\s*([A-Z0-9]{6,20})\b/i
  );
  const bdewCandidate = bdewPrefixedMatch?.[1] || bdewNumericMatch?.[1];
  const bdewCode =
    bdewCandidate && /\d/.test(bdewCandidate) ? String(bdewCandidate).toUpperCase() : undefined;

  const requestedCapacityKW = requestedCapacityMatch
    ? Number(requestedCapacityMatch[1].replace(',', '.'))
    : capacityMwMatch
      ? Number(capacityMwMatch[1].replace(',', '.')) * 1000
      : capacityKwMatch
        ? Number(capacityKwMatch[1].replace(',', '.'))
        : undefined;

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
    forecastDays: temporalHints.forecastDays,
    timeframeHint: temporalHints.timeframeHint,
  };
}

function parseBenchmarkNames(text = '') {
  const againstMatch = String(text || '').match(
    /\b(?:benchmark(?:e|t)?|vergleich(?:e|t)?)\s+(.+?)\s+gegen\s+(.+?)(?:[\.!?]|$)/i
  );
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
  const actionOverrides =
    knownContext?.stepParams?.[action] || knownContext?.byAction?.[action] || {};
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
        if (
          typeof originalTemplateValue === 'string' &&
          originalTemplateValue.startsWith('__step_')
        ) {
          unresolvedStepPlaceholders.add(key);
        }
        const replacement = findContextValue(action, key, knownContext, promptHints);
        return [key, replacement];
      }
      return [key, value];
    })
  );

  const parsedBenchmarkNames = parseBenchmarkNames(
    String(knownContext?.lastUserMessage || promptHints?.query || '')
  );

  const isLikelyFullPromptQuery = (value) => {
    if (typeof value !== 'string') return false;
    const text = value.trim();
    if (!text) return false;
    const wordCount = text.split(/\s+/).filter(Boolean).length;
    if (text.length > 80 || wordCount > 8) return true;
    if (/[,?!]/.test(text) && wordCount > 5) return true;
    return (
      /\b(?:bitte|projekt|netzbetreiber|standort|risiko|bewertung)\b/i.test(text) && wordCount > 4
    );
  };

  if (action === 'grid-operations.marketPartners') {
    if (
      hydrated.query == null ||
      hydrated.query === '' ||
      isLikelyFullPromptQuery(hydrated.query)
    ) {
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
        knownContext?.requestedCapacityKW ??
        knownContext?.requestedCapacity ??
        promptHints?.requestedCapacityKW;
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
        knownContext?.requestedCapacityKW ??
        knownContext?.requestedCapacity ??
        promptHints?.requestedCapacityKW;
    }
    if (hydrated.ownerContact == null && knownContext?.ownerContact) {
      hydrated.ownerContact = knownContext.ownerContact;
    }
  }

  if (action === 'ewk-monitoring.benchmarkVnb') {
    if (hydrated.vnbName == null || hydrated.vnbName === '') {
      hydrated.vnbName =
        knownContext?.vnbName ||
        knownContext?.vnb1Name ||
        parsedBenchmarkNames.vnb1Name ||
        knownContext?.gridOperatorName ||
        promptHints?.query ||
        undefined;
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

  if (action === 'vdmi.dossier' || action === 'vdmi.negotiationTrace') {
    if (hydrated.taskId == null && knownContext?.taskId) {
      hydrated.taskId = knownContext.taskId;
    }
    const lastPromptText = String(knownContext?.lastUserMessage || promptHints?.query || '');
    const isVdmiDecisionPrompt =
      /(anschlusszusage|kapazitaetszusage|kapazitätszusage|uebergabepunkt|übergabepunkt|netzbetreiberentscheidung|belastbare\s+zusage)/i.test(
        lastPromptText
      ) && /(formales\s+netzanschlussbegehren|§17\s*enwg|17\s*enwg|enwg)/i.test(lastPromptText);
    if (hydrated.taskId == null && isVdmiDecisionPrompt) {
      hydrated.taskId = 'network-operator-decision';
    }
  }

  if (action === 'vdmi.agentRole') {
    if (hydrated.agentId == null && knownContext?.agentId) {
      hydrated.agentId = knownContext.agentId;
    }
    if (hydrated.taskId == null && knownContext?.taskId) {
      hydrated.taskId = knownContext.taskId;
    }
    if (hydrated.processType == null && knownContext?.processType) {
      hydrated.processType = knownContext.processType;
    }
    const lastPromptText = String(knownContext?.lastUserMessage || promptHints?.query || '');
    const isVdmiDecisionPrompt =
      /(anschlusszusage|kapazitaetszusage|kapazitätszusage|uebergabepunkt|übergabepunkt|netzbetreiberentscheidung|belastbare\s+zusage)/i.test(
        lastPromptText
      ) && /(formales\s+netzanschlussbegehren|§17\s*enwg|17\s*enwg|enwg)/i.test(lastPromptText);
    if (hydrated.taskId == null && isVdmiDecisionPrompt) {
      hydrated.taskId = 'network-operator-decision';
    }
    if (hydrated.processType == null && isVdmiDecisionPrompt) {
      hydrated.processType = 'grid-connection-governance';
    }
  }

  if (action === 'finance-agent.analyze') {
    if (hydrated.query == null || hydrated.query === '') {
      hydrated.query =
        knownContext?.query ||
        knownContext?.dueDiligenceQuestion ||
        knownContext?.lastUserMessage ||
        promptHints?.query ||
        undefined;
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

/**
 * Determines if a parameter value is "missing" for execution preflight purposes.
 * Treats null, undefined, empty string, empty array, and empty plain object as missing.
 * This is more strict than a simple null-check: an empty string projectId is not valid.
 */
function isMissingRequired(value) {
  if (value == null) return true;
  if (typeof value === 'string') return value.trim() === '';
  if (Array.isArray(value)) return value.length === 0;
  if (typeof value === 'object') return Object.keys(value).length === 0;
  return false;
}

function getMissingInputs(action, params = {}) {
  const rules = ACTION_REQUIREMENTS[action];
  if (!rules) return [];
  const missing = [];

  if (Array.isArray(rules.allOf)) {
    for (const key of rules.allOf) {
      if (!Object.prototype.hasOwnProperty.call(params, key) || params[key] == null) {
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

/**
 * Central execution preflight function.
 *
 * Validates params before any ctx.call() is issued for the given action.
 * Combines ACTION_REQUIREMENTS (allOf / anyOf), isMissingRequired (covers null/empty-string/
 * empty-array/empty-object), and optional required-scope checks.
 *
 * Returns a structured outcome:
 *   { outcome: 'ok' }
 *   { outcome: 'missing-inputs', missingParams: string[] }
 *   { outcome: 'scope-blocked',  missingParams: string[] }
 *
 * Callers in executeDeterministicPlan must treat any outcome !== 'ok' as a hard stop
 * and must NOT forward execution to ctx.call.
 *
 * @param {string} action         - Moleculer action name, e.g. 'znp.assessPortfolio'
 * @param {object} params         - Resolved params that would be passed to ctx.call
 * @param {object} [options]
 * @param {string[]} [options.requiredScopes]  - Scopes that must be present in contextScopes
 * @param {object}  [options.contextScopes]    - Map of scope key → boolean/truthy from context
 */
function runExecutionPreflight(action, params = {}, { requiredScopes = [], contextScopes = null } = {}) {
  const rules = ACTION_REQUIREMENTS[action];
  const missingParams = [];

  if (rules) {
    if (Array.isArray(rules.allOf)) {
      for (const key of rules.allOf) {
        if (!Object.prototype.hasOwnProperty.call(params, key) || isMissingRequired(params[key])) {
          missingParams.push(key);
        }
      }
    }

    if (Array.isArray(rules.anyOf) && rules.anyOf.length > 0) {
      const hasAny = rules.anyOf.some(
        (key) => Object.prototype.hasOwnProperty.call(params, key) && !isMissingRequired(params[key])
      );
      if (!hasAny) {
        missingParams.push(`oneOf:${rules.anyOf.join('|')}`);
      }
    }
  }

  if (missingParams.length > 0) {
    return { outcome: 'missing-inputs', missingParams };
  }

  if (Array.isArray(requiredScopes) && requiredScopes.length > 0 && contextScopes != null) {
    const blockedScopes = requiredScopes.filter((s) => !contextScopes[s]);
    if (blockedScopes.length > 0) {
      return { outcome: 'scope-blocked', missingParams: blockedScopes };
    }
  }

  return { outcome: 'ok', missingParams: [] };
}

function shouldAttachRegulatoryContextNote(action = '') {
  const value = String(action || '').toLowerCase();
  return /^(grid-operations\.|grid-connection\.|finance-agent\.|redispatch|settlement\.)/.test(
    value
  );
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

function buildExecutionPlan({
  message,
  brokerRecommendation,
  knowledgeContext = null,
  knownContext = {},
}) {
  const promptHints = extractPromptHints(message);
  const evidenceSignalKey = detectEvidenceSignalKey(message, knownContext, promptHints);
  const requestedDomains = detectRequestedDomains(message);
  const route = findMatchingMatrixRoute(requestedDomains);

  if (route) {
    const unsupportedDomains = requestedDomains.filter((domain) => !route.domains.includes(domain));
    const routingMatrixPlan = {
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
        hitlRequired: false,
        criticalityClass: null,
      })),
      status: 'ready',
      warnings:
        unsupportedDomains.length > 0
          ? [`Unsupported extra domains requested: ${unsupportedDomains.join(', ')}`]
          : [],
      promptHints,
    };
    routingMatrixPlan.evidencePlan = planEvidence(routingMatrixPlan, {
      ...(promptHints || {}),
      ...(knownContext || {}),
    });
    return routingMatrixPlan;
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

  const steps = buildCuratedBrokerSteps(selected.capability, brokerRecommendation).map((step) => ({
    ...step,
    contextNote: toContextNote(knowledgeContext, step.action),
  }));
  const unsupportedDomains = requestedDomains.length > 1 ? requestedDomains.slice(1) : [];

  const brokerPlan = {
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
    warnings:
      selected.usedFallback || unsupportedDomains.length > 0
        ? [`No routing-matrix entry for chained domains: ${requestedDomains.join(' -> ')}`]
        : [],
    promptHints,
    capability: selected.capability,
    evidenceKey: evidenceSignalKey,
  };
  brokerPlan.evidencePlan = planEvidence(brokerPlan, {
    ...(promptHints || {}),
    ...(knownContext || {}),
  });
  return brokerPlan;
}

function applyMissingContextFallback(plan = {}, { knownContext = {}, executionMode } = {}) {
  if (executionMode !== EXECUTION_MODES.AUTO) {
    return plan;
  }

  if (!plan || !Array.isArray(plan.steps) || plan.steps.length === 0) {
    return plan;
  }

  const hasMissingContextStep = plan.steps.some(
    (step) => step?.action === ROUTING_CONTROL_ACTIONS.MISSING_CONTEXT
  );
  if (hasMissingContextStep) {
    return plan;
  }

  const executionState = { stepResults: {} };

  for (const plannedStep of plan.steps) {
    const params = pruneUndefinedDeep(
      fillTemplateWithContext(
        plannedStep.paramsTemplate,
        plannedStep.action,
        knownContext,
        plan.promptHints,
        executionState
      )
    );

    const missingParams = getMissingInputs(plannedStep.action, params);
    if (missingParams.length === 0) {
      continue;
    }

    return {
      ...plan,
      status: plan.status === 'partial' ? 'partial' : 'missing-context',
      missingContext: {
        blockedStep: plannedStep.step,
        blockedAction: plannedStep.action,
        missingParams,
      },
      steps: [
        ...plan.steps,
        {
          step: (plan.steps.length || 0) + 1,
          action: ROUTING_CONTROL_ACTIONS.MISSING_CONTEXT,
          purpose: `Collect missing context for ${plannedStep.action}`,
          source: 'routing-missing-context',
          blockedStep: plannedStep.step,
          blockedAction: plannedStep.action,
          missingParams,
          status: 'pending-input',
        },
      ],
    };
  }

  return plan;
}

module.exports = {
  EXECUTION_MODES,
  CHAT_MODES,
  ROUTING_CONTROL_ACTIONS,
  ROUTING_MATRIX,
  normalizeExecutionMode,
  normalizeChatMode,
  detectExplicitChatModeSwitch,
  detectChatMode,
  detectRequestedDomains,
  buildExecutionPlan,
  applyMissingContextFallback,
  fillTemplateWithContext,
  pruneUndefinedDeep,
  getMissingInputs,
  isMissingRequired,
  runExecutionPreflight,
  detectEvidenceSignalKey,
  fuzzyClassifyConsultationIntent,
  planEvidence,
};
