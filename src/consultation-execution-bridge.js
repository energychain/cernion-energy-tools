'use strict';

/**
 * Consultation-to-Execution Bridge
 *
 * Converts consultation recommendations into one of:
 *   1. A compact minimum data intake (awaiting_input)
 *   2. A structured executable tool plan (ready / partial)
 *   3. An advisory-only handoff when execution is not applicable (advisory_only)
 *
 * Domain guardrails:
 *   - MaStR is labeled as context/indicator, never as capacity proof.
 *   - VNB/ÜNB identity requires lookup evidence, not hardcoded assumptions.
 *   - Board/governance questions remain advisory only.
 *   - BESS vs. Energy Sharing paths are kept separate.
 */

const {
  classifyQueryScope,
  isOperatorScopeResolved,
  hasLocationScope,
} = require('./query-scope-classifier');

const { LOCATION_PRECISION } = require('./location-resolution');
const { isBlockedAction } = require('./dossier-hydration-registry');

const WORKFLOW_TYPES = Object.freeze({
  BESS_SCREENING: 'bess_screening',
  BESS_DEVELOPMENT: 'bess_development',
  ENERGY_SHARING_READINESS: 'energy_sharing_readiness',
  VNB_IDENTIFICATION: 'vnb_identification',
  MASTR_INVENTORY: 'mastr_inventory',
  ADVISORY_ONLY: 'advisory_only',
  // New workflow types for expanded domain coverage
  MUNICIPAL_ENERGY_SHARING_ASSESSMENT: 'municipal_energy_sharing_assessment',
  PROCESS_GOVERNANCE_DECISION_MATRIX: 'process_governance_decision_matrix',
  ZNP_ASSET_MDM_PLANNING: 'znp_asset_mdm_planning',
  EDM_MARKET_COMMUNICATION_DIAGNOSTICS: 'edm_market_communication_diagnostics',
  SUPPLIER_PORTFOLIO_FLEX_ASSESSMENT: 'supplier_portfolio_flex_assessment',
  PROSUMER_NAP_WALLET_ONBOARDING: 'prosumer_nap_wallet_onboarding',
  // Generic fallback for any capability the broker has confidently routed to
  // (e.g. VDMI governance) when no local text-heuristic workflow applies (#150)
  CAPABILITY_BROKER_EXECUTION: 'capability_broker_execution',
});

const EXECUTION_READINESS = Object.freeze({
  READY: 'ready',
  PARTIAL: 'partial',
  AWAITING_INPUT: 'awaiting_input',
  ADVISORY_ONLY: 'advisory_only',
});

// ─────────────────────────────────────────────────────────────────────────────
// Signal helpers
// ─────────────────────────────────────────────────────────────────────────────

const GOVERNANCE_SIGNALS =
  /governance|transparent|blackbox|black.?box|erklärbar|erkl[aä]rb|audit|ai.risk|ki.risik|strateg|entscheidung.*risiko|risiko.*entscheidung|aufsicht|haftung|compliance/i;

const BESS_SIGNALS =
  /speicher|bess|battery|puffer|stromspeicher|großspeicher|batteriespeicher|lithium|mw.*speicher|speicher.*mw/i;

const ENERGY_SHARING_SIGNALS =
  /energy.sharing|energiesharing|mieterstrom|gemeinschaftliche.erzeugung|eigenversorgung.*gebäude|gebäude.*eigenversorgung/i;

const VNB_SIGNALS =
  /netzbetreiber|vnb|ünb|netzgebiet|zuständig|stromnetz|verteilnetz|übertragungsnetz/i;

const MASTR_SIGNALS = /mastr|marktstammdaten|anlagenregister|eeg.register/i;

// New signal patterns for expanded domain coverage
const PROCESS_GOVERNANCE_SIGNALS =
  /gremium|prozess|entscheidungsmatrix|entscheidungs.matrix|arbeitsgruppe|team|workflow|governance.process/i;

const ZNP_SIGNALS = /znp|zentrale.netzausbau|netzausbau|stromnetzausbau/i;

const EDM_SIGNALS =
  /edm|elektronische.datenaustauch|datenaustausch|marktkommunikation|market.communication|nachricht|message/i;

const PORTFOLIO_SIGNALS = /portfolio|flexibilität|flex|virtual.power|vppp|aggregator|vermarkter/i;

const PROSUMER_SIGNALS = /prosumer|nap|netzanschlusspunkt|wallet|eigenversorgung|eigenverbrauch/i;

const MUNICIPAL_ES_SIGNALS =
  /gemeinde|kommunal|stadt.*energie|energie.*sharing.*gemeinde|dezentral.*energie|quartier/i;

function signalText(message, consultation) {
  const nextActionText = Array.isArray(consultation?.nextActions)
    ? consultation.nextActions.map((a) => `${a.action || ''} ${a.description || ''}`).join(' ')
    : '';
  return `${String(message || '')} ${nextActionText}`;
}

function normalizeWorkflowSignalText(value = '') {
  return String(value || '')
    .normalize('NFKD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/ä/g, 'ae')
    .replace(/ö/g, 'oe')
    .replace(/ü/g, 'ue')
    .replace(/ß/g, 'ss')
    .replace(/[._/\\-]+/g, ' ')
    .replace(/[^a-z0-9\s]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function serializeSignalRecords(records = []) {
  if (!Array.isArray(records)) {
    return '';
  }

  return records
    .map((record) => {
      if (record == null) {
        return '';
      }
      if (typeof record !== 'object') {
        return String(record);
      }
      return [
        record.param,
        record.label,
        record.value,
        record.source,
        record.statement,
        record.action,
        record.description,
        record.key,
        record.intent,
        record.workflowType,
      ]
        .filter(Boolean)
        .join(' ');
    })
    .join(' ');
}

function toKnownContextSignalText(knownContext = {}) {
  if (!knownContext || typeof knownContext !== 'object') {
    return '';
  }

  return Object.entries(knownContext)
    .map(([key, value]) => `${key} ${Array.isArray(value) ? value.join(' ') : String(value ?? '')}`)
    .join(' ');
}

function hasAnyPattern(text, patterns = []) {
  return patterns.some((pattern) => pattern.test(text));
}

function hasBessDomainContext(knownContext = {}, extractedContext = {}) {
  const domainCandidates = [
    knownContext?.domain,
    knownContext?.domainHint,
    extractedContext?.domain,
    extractedContext?.domainHint,
  ]
    .filter(Boolean)
    .map((value) => normalizeWorkflowSignalText(String(value)))
    .join(' ');

  if (!domainCandidates) {
    return false;
  }

  return hasAnyPattern(domainCandidates, [
    /\b(bess|battery|batterie|speicher|grid connection|netzanschluss|netzanschlusspunkt|bess grid connection)\b/i,
  ]);
}

function buildWorkflowSignalCorpus({
  message = '',
  consultation = {},
  knownContext = {},
  brokerRecommendation = {},
  extractedInputs = [],
} = {}) {
  return normalizeWorkflowSignalText(
    [
      message,
      consultation?.semanticClassification?.workflowType,
      serializeSignalRecords(consultation?.factsUsed),
      serializeSignalRecords(consultation?.nextActions),
      toKnownContextSignalText(knownContext),
      serializeSignalRecords(extractedInputs),
      serializeSignalRecords([brokerRecommendation]),
    ]
      .filter(Boolean)
      .join(' ')
  );
}

function reconcileSemanticWorkflowType({
  message = '',
  consultation = {},
  knownContext = {},
  brokerRecommendation = {},
  extractedInputs = [],
} = {}) {
  const semanticWorkflow = String(consultation?.semanticClassification?.workflowType || '').trim();
  const validSemanticWorkflow = Object.values(WORKFLOW_TYPES).includes(semanticWorkflow)
    ? semanticWorkflow
    : null;

  if (!validSemanticWorkflow) {
    return null;
  }

  const explicitBessDomain =
    normalizeWorkflowSignalText(String(knownContext?.domain || '')) === 'bess grid connection' ||
    normalizeWorkflowSignalText(String(knownContext?.domainHint || '')) === 'bess grid connection';
  const hasProjectMetrics =
    hasContextKey(knownContext, ['powerMW', 'capacityMW', 'capacityMWh']) ||
    hasAnyPattern(normalizeWorkflowSignalText(message), [/\b\d+(?:[.,]\d+)?\s*(mw|mwh)\b/i]);

  if (explicitBessDomain && hasProjectMetrics) {
    return WORKFLOW_TYPES.BESS_SCREENING;
  }

  const text = buildWorkflowSignalCorpus({
    message,
    consultation,
    knownContext,
    brokerRecommendation,
    extractedInputs,
  });

  const hasAiContext = hasAnyPattern(text, [
    /\b(ai|ki|artificial intelligence|kuenstliche intelligenz)\b/i,
  ]);
  const hasGovernanceSignals = hasAnyPattern(text, [
    /\b(blackbox|black box|aufsicht|transparenz|erklaerbarkeit|erkl[aä]rb|haftung|compliance|governance|hitl|human in the loop)\b/i,
  ]);
  if (hasAiContext && hasGovernanceSignals) {
    return WORKFLOW_TYPES.ADVISORY_ONLY;
  }

  const hasProsumerRole = hasAnyPattern(text, [/\b(haushaltskunde|haushalt|endkunde|prosumer)\b/i]);
  const hasNapWallet = hasAnyPattern(text, [/\b(nap|netzanschlusspunkt|wallet)\b/i]);
  const hasProsumerDevices = hasAnyPattern(text, [
    /\b(pv|photovoltaik|waermepumpe|wärmepumpe|wallbox)\b/i,
    /\bspeicher\b/i,
  ]);
  const hasProsumerData = hasAnyPattern(text, [
    /\b(rohdaten|daten honeypot|datenhoneypot|datenfreigabe|onboarding|kundenportal)\b/i,
  ]);
  if (hasNapWallet && (hasProsumerRole || hasProsumerDevices || hasProsumerData)) {
    return WORKFLOW_TYPES.PROSUMER_NAP_WALLET_ONBOARDING;
  }

  if (
    hasAnyPattern(text, [
      /\b(edm|marktkommunikation|mako|bilanzierung|mabis|wim|utilmd|gpke|edi|datenaustausch)\b/i,
    ])
  ) {
    return WORKFLOW_TYPES.EDM_MARKET_COMMUNICATION_DIAGNOSTICS;
  }

  const extractedContext = Object.fromEntries(
    (Array.isArray(extractedInputs) ? extractedInputs : []).map((entry) => [
      entry?.param,
      entry?.value,
    ])
  );
  const hasBessCore =
    hasAnyPattern(text, [/\b(bess|batteriespeicher|grossspeicher|stromspeicher)\b/i]) ||
    hasBessDomainContext(knownContext, extractedContext);
  const hasLocationSignals =
    hasAnyPattern(text, [
      /\b(arnstadt|thueringen|thuringen|bundesland|gemeinde|postleitzahl|plz)\b/i,
    ]) ||
    hasContextKey(knownContext, [
      'municipality',
      'location',
      'postalCode',
      'bundesland',
      'state',
      'region',
    ]) ||
    hasContextKey(extractedContext, [
      'municipality',
      'location',
      'postalCode',
      'bundesland',
      'state',
      'region',
    ]);
  const hasProjectMetricSignals =
    hasAnyPattern(text, [/\b\d+(?:[.,]\d+)?\s*(mw|mwh)\b/i]) ||
    hasContextKey(knownContext, ['powerMW', 'capacityMW', 'capacityMWh']) ||
    hasContextKey(extractedContext, ['powerMW', 'capacityMW', 'capacityMWh']);
  const hasGridConnectionSignals =
    hasAnyPattern(text, [
      /\b(netzanschluss|anschlussloesung|anschlusslösung|flexib(?:el|ler|le)?\s+anschluss|netzbetreiber|vnb|bdew)\b/i,
    ]) ||
    hasContextKey(knownContext, ['gridOperatorName', 'bdewCode', 'bdew']) ||
    hasContextKey(extractedContext, ['gridOperatorName', 'bdewCode', 'bdew']);
  if (hasBessCore && (hasLocationSignals || hasProjectMetricSignals || hasGridConnectionSignals)) {
    return WORKFLOW_TYPES.BESS_SCREENING;
  }

  const hasMastrRegister = hasAnyPattern(text, [/\b(mastr|marktstammdaten|anlagenregister)\b/i]);
  const hasInventorySignals = hasAnyPattern(text, [
    /\b(bestand|inventar|liste|abfragen|abfrage|zaehlen|zählen|filtern|register)\b/i,
  ]);
  if (hasMastrRegister && hasInventorySignals) {
    return WORKFLOW_TYPES.MASTR_INVENTORY;
  }

  return validSemanticWorkflow;
}

// ─────────────────────────────────────────────────────────────────────────────
// 1. Workflow classification
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Classifies the consultation into a workflow type based on message and context.
 *
 * Hierarchy:
 * 1. Explicit domain signals (EDM, ZNP, etc.) — check BEFORE generic governance
 * 2. Governance (advisory only) — catch-all for governance patterns
 * 3. Process/Gremium — organizational decisions
 * 4. Domain-specific — BESS, Energy Sharing, Portfolio, Prosumer, Municipal
 * 5. Fallback — VNB, MaStR, Advisory
 *
 * Note: Uses extractedInputs parameter to avoid redundant extraction.
 */
function classifyWorkflowType({
  message = '',
  consultation = {},
  knownContext = {},
  brokerRecommendation = {},
  extractedInputs = [],
} = {}) {
  const reconciledSemanticWorkflow = reconcileSemanticWorkflowType({
    message,
    consultation,
    knownContext,
    brokerRecommendation,
    extractedInputs,
  });
  if (reconciledSemanticWorkflow) {
    return reconciledSemanticWorkflow;
  }

  const text = signalText(message, consultation);
  const extractedContext = Object.fromEntries(
    (Array.isArray(extractedInputs) ? extractedInputs : []).map((entry) => [
      entry?.param,
      entry?.value,
    ])
  );

  // 1. Explicit domain signals — check BEFORE generic governance patterns
  // (because "strategie" in governance might appear in legitimate domain messages)

  // 1a. EDM / Market Communication (must check BEFORE generic "strategie")
  if (EDM_SIGNALS.test(text)) {
    return WORKFLOW_TYPES.EDM_MARKET_COMMUNICATION_DIAGNOSTICS;
  }

  // 1b. ZNP / Central Grid Expansion Planning
  if (ZNP_SIGNALS.test(text)) {
    return WORKFLOW_TYPES.ZNP_ASSET_MDM_PLANNING;
  }

  // 1c. Strong BESS project context must win over generic portfolio/flex signals
  const hasStrongBessCore =
    BESS_SIGNALS.test(text) || hasBessDomainContext(knownContext, extractedContext);
  const hasStrongBessLocation =
    /\b(arnstadt|thueringen|thuringen|bundesland|gemeinde|postleitzahl|plz)\b/i.test(text) ||
    hasContextKey(knownContext, [
      'municipality',
      'location',
      'postalCode',
      'bundesland',
      'state',
      'region',
    ]) ||
    hasContextKey(extractedContext, [
      'municipality',
      'location',
      'postalCode',
      'bundesland',
      'state',
      'region',
    ]);
  const hasStrongBessMetrics =
    /\b\d+(?:[.,]\d+)?\s*(mw|mwh)\b/i.test(text) ||
    hasContextKey(knownContext, ['powerMW', 'capacityMW', 'capacityMWh']) ||
    hasContextKey(extractedContext, ['powerMW', 'capacityMW', 'capacityMWh']);
  const hasStrongBessGrid =
    /\b(netzanschluss|anschlussloesung|anschlusslösung|flexib(?:el|ler|le)?\s+anschluss|netzbetreiber|vnb|bdew|netzanschlusspunkt)\b/i.test(
      text
    ) ||
    hasContextKey(knownContext, ['gridOperatorName', 'bdewCode', 'bdew']) ||
    hasContextKey(extractedContext, ['gridOperatorName', 'bdewCode', 'bdew']);

  if (hasStrongBessCore && (hasStrongBessLocation || hasStrongBessMetrics || hasStrongBessGrid)) {
    return WORKFLOW_TYPES.BESS_SCREENING;
  }

  // 1d. Portfolio / Flexibility / Aggregator
  if (PORTFOLIO_SIGNALS.test(text)) {
    return WORKFLOW_TYPES.SUPPLIER_PORTFOLIO_FLEX_ASSESSMENT;
  }

  // 1e. Prosumer / NAP / Wallet
  if (PROSUMER_SIGNALS.test(text)) {
    return WORKFLOW_TYPES.PROSUMER_NAP_WALLET_ONBOARDING;
  }

  // 2. Governance / AI transparency → advisory only (AFTER explicit domain checks)
  if (GOVERNANCE_SIGNALS.test(text)) {
    return WORKFLOW_TYPES.ADVISORY_ONLY;
  }

  // 3. Process / Gremium / Organizational workflows
  if (PROCESS_GOVERNANCE_SIGNALS.test(text)) {
    return WORKFLOW_TYPES.PROCESS_GOVERNANCE_DECISION_MATRIX;
  }

  // 4. Domain-specific workflows
  // 4a. BESS / battery storage
  if (BESS_SIGNALS.test(text)) {
    const hasLocation = Boolean(knownContext?.municipality || knownContext?.location);
    const hasCapacity = Boolean(
      knownContext?.powerMW || knownContext?.capacityMW || knownContext?.capacityMWh
    );
    const hasExplicitExecutionCue =
      /validier|prüf|pruef|ausf[üu]hr|start|task\s*-?id|dossier/i.test(text) ||
      /vdmi_asset_validation|vdmi_grid_connection/i.test(
        String(brokerRecommendation?.intent || '')
      );

    return hasLocation && hasCapacity && hasExplicitExecutionCue
      ? WORKFLOW_TYPES.BESS_DEVELOPMENT
      : WORKFLOW_TYPES.BESS_SCREENING;
  }

  // 4b. Energy Sharing / Mieterstrom
  if (ENERGY_SHARING_SIGNALS.test(text)) {
    // Check if municipal context
    if (MUNICIPAL_ES_SIGNALS.test(text)) {
      return WORKFLOW_TYPES.MUNICIPAL_ENERGY_SHARING_ASSESSMENT;
    }
    return WORKFLOW_TYPES.ENERGY_SHARING_READINESS;
  }

  // 5. Fallback domain workflows
  // VNB identification
  if (VNB_SIGNALS.test(text)) {
    return WORKFLOW_TYPES.VNB_IDENTIFICATION;
  }

  // MaStR inventory
  if (MASTR_SIGNALS.test(text)) {
    return WORKFLOW_TYPES.MASTR_INVENTORY;
  }

  return WORKFLOW_TYPES.ADVISORY_ONLY;
}

// ─────────────────────────────────────────────────────────────────────────────
// 2. Input readiness analysis
// ─────────────────────────────────────────────────────────────────────────────

const BESS_DEV_REQUIRED = [
  {
    param: 'location',
    label: 'Projektort (Gemeinde oder GPS)',
    priority: 'critical',
    keys: ['municipality', 'location', 'latitude'],
  },
  {
    param: 'powerMW',
    label: 'Installierte Leistung (MW)',
    priority: 'critical',
    keys: ['powerMW', 'capacityMW'],
  },
  {
    param: 'capacityMWh',
    label: 'Speicherkapazität (MWh)',
    priority: 'high',
    keys: ['capacityMWh'],
  },
  {
    param: 'gridOperator',
    label: 'Netzbetreiber oder BDEW-Code',
    priority: 'high',
    keys: ['gridOperatorName', 'bdewCode', 'bdew'],
  },
];

const BESS_SCREEN_REQUIRED = [
  {
    param: 'state',
    label: 'Bundesland oder Region',
    priority: 'critical',
    keys: ['state', 'bundesland', 'region', 'municipality', 'location', 'postalCode'],
  },
  {
    param: 'municipality',
    label: 'Gemeinde, PLZ oder konkreter Standort (für VNB-Zuordnung)',
    priority: 'high',
    keys: ['municipality', 'location', 'postalCode'],
  },
];

const ES_REQUIRED = [
  {
    param: 'municipality',
    label: 'Gemeinde / Standort',
    priority: 'critical',
    keys: ['municipality', 'location'],
  },
  {
    param: 'powerMW',
    label: 'PV-Leistung (kW/MW) oder Gebäudefläche',
    priority: 'high',
    keys: ['powerMW', 'capacityMW', 'buildingArea'],
  },
];

const VNB_REQUIRED = [
  {
    param: 'location_or_bdew',
    label: 'Gemeinde/Ort ODER BDEW-Code',
    priority: 'critical',
    keys: ['municipality', 'location', 'bdewCode', 'bdew'],
  },
];

const MASTR_REQUIRED = [
  {
    param: 'location',
    label: 'Gemeinde oder Postleitzahl',
    priority: 'critical',
    keys: ['municipality', 'location', 'postalCode'],
  },
];

const PROSUMER_NAP_REQUIRED = [
  {
    param: 'did',
    label: 'NAP-Wallet-DID',
    priority: 'critical',
    keys: ['did', 'walletDid', 'assetDid', 'didUri'],
  },
  {
    param: 'location_or_melo',
    label: 'PLZ, Ort oder MeLo-ID des Netzanschlusses',
    priority: 'critical',
    keys: ['postalCode', 'municipality', 'location', 'meloId', 'melo', 'marketLocationId'],
  },
  {
    param: 'asset_baseline',
    label: 'MaStR-Nummer, MeLo-ID oder Asset-Typen (PV, Speicher, Wallbox, Wärmepumpe)',
    priority: 'high',
    keys: ['mastrId', 'mastrNumber', 'meloId', 'assetType', 'assets', 'devices'],
  },
];

const REQUIRED_BY_WORKFLOW = {
  [WORKFLOW_TYPES.BESS_DEVELOPMENT]: BESS_DEV_REQUIRED,
  [WORKFLOW_TYPES.BESS_SCREENING]: BESS_SCREEN_REQUIRED,
  [WORKFLOW_TYPES.ENERGY_SHARING_READINESS]: ES_REQUIRED,
  [WORKFLOW_TYPES.VNB_IDENTIFICATION]: VNB_REQUIRED,
  [WORKFLOW_TYPES.MASTR_INVENTORY]: MASTR_REQUIRED,
  [WORKFLOW_TYPES.PROSUMER_NAP_WALLET_ONBOARDING]: PROSUMER_NAP_REQUIRED,
  [WORKFLOW_TYPES.ADVISORY_ONLY]: [],
};

function hasContextKey(knownContext, keys = []) {
  return keys.some((k) => {
    const v = knownContext[k];
    return v !== null && v !== undefined && v !== '';
  });
}

function analyzeInputReadiness({
  workflowType = WORKFLOW_TYPES.ADVISORY_ONLY,
  knownContext = {},
  consultation = {},
  extractedInputs = [],
} = {}) {
  const required = REQUIRED_BY_WORKFLOW[workflowType] || [];

  const availableInputs = [];
  const missingInputs = [];

  // 1. Start with extracted inputs (from message, consultation facts, known context)
  // These are pre-extracted and ranked by confidence
  if (Array.isArray(extractedInputs) && extractedInputs.length > 0) {
    extractedInputs.forEach((extracted) => {
      availableInputs.push({
        param: extracted.param,
        value: String(extracted.value).slice(0, 100),
        source: extracted.source,
        confidence: extracted.confidence,
      });
    });
  }

  // 2. Add any remaining context keys not yet in availableInputs
  const extractedParams = new Set(extractedInputs.map((e) => e.param));
  const allKeys = Object.keys(knownContext).filter((k) => {
    const v = knownContext[k];
    return v !== null && v !== undefined && v !== '' && !extractedParams.has(k);
  });
  allKeys.forEach((key) => {
    availableInputs.push({
      param: key,
      value: String(knownContext[key]).slice(0, 100),
      source: 'knownContext',
      confidence: 'medium',
    });
  });

  // 3. Check what we need vs. what we have
  const availableParamSet = new Set(availableInputs.map((a) => a.param));
  required.forEach(({ param, label, priority, keys }) => {
    // Check if ANY of the alternative keys is available
    const keyIsAvailable = keys.some((k) => availableParamSet.has(k));
    if (!keyIsAvailable) {
      missingInputs.push({ param, label, priority });
    }
  });

  return { availableInputs, missingInputs };
}

// ─────────────────────────────────────────────────────────────────────────────
// 3. Executable plan builder
// ─────────────────────────────────────────────────────────────────────────────

function hasInput(knownContext, keys = []) {
  return hasContextKey(knownContext, keys);
}

function buildExecutablePlan({
  workflowType = WORKFLOW_TYPES.ADVISORY_ONLY,
  knownContext = {},
  missingInputs = [],
} = {}) {
  const executableSteps = [];
  const evidenceGates = [];
  const assumptions = [];

  const missingParams = new Set(missingInputs.map((m) => m.param));

  if (workflowType === WORKFLOW_TYPES.BESS_DEVELOPMENT) {
    // Step 1: VNB lookup — needs location or BDEW
    const hasLocation = hasInput(knownContext, [
      'municipality',
      'location',
      'latitude',
      'longitude',
    ]);
    const hasBdew = hasInput(knownContext, ['bdewCode', 'bdew']);
    if (hasLocation || hasBdew) {
      executableSteps.push({
        step: 1,
        action: 'grid-operations.vnbLookup',
        label: 'Netzbetreiber-Zuständigkeit prüfen',
        params: {
          ...(knownContext.municipality && { city: knownContext.municipality }),
          ...(knownContext.location &&
            !knownContext.municipality && { city: knownContext.location }),
          ...(hasBdew && { bdew: knownContext.bdewCode || knownContext.bdew }),
        },
        canExecute: true,
        purpose: 'determine_grid_operator',
      });
    } else {
      evidenceGates.push({
        id: 'vnb_lookup_gate',
        label: 'Netzbetreiber-Zuständigkeit prüfen',
        blockedBy: 'location_or_bdew_missing',
        required: true,
        description: 'Standort (Gemeinde/Koordinaten) oder BDEW-Code benötigt.',
      });
    }

    // Step 2: MaStR context inventory — needs location
    if (hasLocation) {
      executableSteps.push({
        step: 2,
        action: 'grid-operations.marketPartners',
        label: 'Marktpartner im Netzgebiet (Kontext)',
        params: {
          query: knownContext.municipality || knownContext.location,
          limit: 5,
        },
        canExecute: true,
        purpose: 'grid_context_inventory',
        disclaimer: 'MaStR-Bestand ist Kontextindikator – kein Nachweis freier Netzkapazität.',
      });
    } else {
      evidenceGates.push({
        id: 'mastr_context_gate',
        label: 'Marktpartner/Bestandsabfrage (Kontext)',
        blockedBy: 'location_missing',
        required: false,
        description: 'Standortangabe für Marktpartner-Kontext benötigt.',
      });
    }

    // Gate: grid capacity assessment always requires confirmed VNB
    evidenceGates.push({
      id: 'grid_capacity_gate',
      label: 'Netzanschluss-/Kapazitätsprüfung (Netzanschlusszusage)',
      blockedBy: 'vnb_confirmation_required',
      required: true,
      description:
        'Netzbetreiber-Bestätigung erforderlich. Netzanschlusszusage ist nicht aus öffentlichen APIs ableitbar.',
    });

    assumptions.push({
      type: 'working_assumption',
      statement:
        'MaStR-Bestand wird als Kontextindikator verwendet – kein Nachweis freier Netzkapazität.',
      basis: 'domain_guardrail',
      status: 'explicit',
    });
    assumptions.push({
      type: 'working_assumption',
      statement:
        'Netzanschlusszusage (fNAV/fNAZ) ist beim zuständigen Netzbetreiber zu beantragen – nicht aus öffentlichen Registern ableitbar.',
      basis: 'domain_guardrail',
      status: 'explicit',
    });
  }

  if (workflowType === WORKFLOW_TYPES.BESS_SCREENING) {
    const hasState = hasInput(knownContext, [
      'state',
      'bundesland',
      'region',
      'municipality',
      'location',
      'postalCode',
    ]);
    // "municipality_resolved": PLZ or Gemeinde present → sufficient for communal precheck
    const hasMunicipality = hasInput(knownContext, ['municipality', 'location', 'postalCode']);
    const hasSiteCoordinates = hasInput(knownContext, ['latitude', 'longitude', 'address']);

    if (hasState) {
      executableSteps.push({
        step: 1,
        action: 'grid-operations.marketPartners',
        label: 'Netzbetreiber im Bundesland identifizieren',
        params: {
          query:
            knownContext.municipality ||
            knownContext.location ||
            knownContext.postalCode ||
            knownContext.state ||
            knownContext.bundesland ||
            knownContext.region,
          limit: 10,
        },
        canExecute: true,
        purpose: 'state_operator_overview',
      });
    }

    if (hasMunicipality) {
      const spatialQuery = [
        knownContext.postalCode,
        knownContext.municipality || knownContext.location,
      ]
        .filter(Boolean)
        .join(' ')
        .trim();

      executableSteps.push({
        step: executableSteps.length + 1,
        action: 'osm-geo.infrastructureNearby',
        label: 'OSM-Raum- und Infrastrukturkontext spiegeln',
        params: {
          location:
            spatialQuery ||
            knownContext.municipality ||
            knownContext.location ||
            knownContext.postalCode,
          radiusMeters: 5000,
          infraTypes: ['substation', 'transformer', 'line', 'cable'],
          maxResults: 25,
          include_geometry: false,
        },
        canExecute: true,
        purpose: 'municipal_spatial_context',
        disclaimer:
          'OSM-Kontext ist ein öffentlicher Plausibilitäts- und Vertrauensanker; er ist kein Nachweis freier Netzkapazität oder zuständiger Netzbetreiber.',
      });
    } else {
      evidenceGates.push({
        id: 'municipal_spatial_context_gate',
        label: 'OSM-Raumkontext für kommunalen Precheck',
        blockedBy: 'location_missing',
        required: false,
        description:
          'Gemeinde oder PLZ benötigt, um öffentlichen OSM-Kontext sichtbar in die Beratung einzubeziehen.',
      });
    }

    if (hasMunicipality && !hasSiteCoordinates) {
      // Gemeinde/PLZ vorhanden → kommunaler Precheck möglich.
      // Exakte Koordinaten/Adresse fehlen noch für flächenscharfe Netzplanung.
      // This is NOT a blocking gate — the communal precheck can proceed.
      evidenceGates.push({
        id: 'site_coordinates_gate',
        label: 'Flächenscharfe Standortangabe (Koordinaten oder Adresse)',
        blockedBy: 'site_coordinates_missing',
        required: false,
        locationStatus: LOCATION_PRECISION.MUNICIPALITY,
        description:
          'Gemeinde/PLZ vorhanden — kommunaler Precheck möglich. ' +
          'Für präzise Netzplanung, Grundstücksbezug oder punktgenaue OSM-Analyse werden GPS-Koordinaten oder eine Adresse benötigt.',
      });
    } else if (!hasState) {
      // No location at all → block with the original gate
      evidenceGates.push({
        id: 'site_analysis_gate',
        label: 'Standortanalyse (Gemeinde/Koordinaten)',
        blockedBy: 'location_missing',
        required: true,
        locationStatus: LOCATION_PRECISION.UNKNOWN,
        description: 'Konkrete Gemeinde oder GPS-Koordinaten für Standortprüfung benötigt.',
      });
    }
    // hasSiteCoordinates && hasMunicipality → no location gate needed at all

    assumptions.push({
      type: 'working_assumption',
      statement:
        'OSM wird im kommunalen Precheck als öffentlicher Spatial-Context-Layer gespiegelt, nicht als Netzkapazitäts- oder Netzgebietsnachweis.',
      basis: 'domain_guardrail',
      status: 'explicit',
    });
  }

  if (workflowType === WORKFLOW_TYPES.ENERGY_SHARING_READINESS) {
    const hasMunicipality = hasInput(knownContext, ['municipality', 'location']);

    if (hasMunicipality) {
      executableSteps.push({
        step: 1,
        action: 'grid-operations.vnbLookup',
        label: 'Netzbetreiber für Energy-Sharing-Prüfung ermitteln',
        params: { city: knownContext.municipality || knownContext.location },
        canExecute: true,
        purpose: 'energy_sharing_operator',
      });
      executableSteps.push({
        step: 2,
        action: 'grid-operations.marketPartners',
        label: 'Marktpartner im Netzgebiet',
        params: {
          query: knownContext.municipality || knownContext.location,
          limit: 5,
        },
        canExecute: true,
        purpose: 'market_context',
      });
    } else {
      evidenceGates.push({
        id: 'es_location_gate',
        label: 'Standort für Energy-Sharing-Prüfung',
        blockedBy: 'municipality_missing',
        required: true,
      });
    }

    evidenceGates.push({
      id: 'energy_sharing_validation_gate',
      label: 'Energy-Sharing-Vertrag & Netzausschluss-Prüfung (§42c EnWG)',
      blockedBy: 'vnb_lookup_completion_required',
      required: true,
      description: 'Netzbetreiber muss bestätigen, dass Energy-Sharing im Netzgebiet zulässig ist.',
    });

    assumptions.push({
      type: 'working_assumption',
      statement:
        'Energy Sharing über öffentliches Netz (§42c EnWG) ist von Mieterstrom und reiner Eigenversorgung zu unterscheiden – drei unterschiedliche Modelle.',
      basis: 'domain_guardrail',
      status: 'explicit',
    });
  }

  if (workflowType === WORKFLOW_TYPES.VNB_IDENTIFICATION) {
    const hasMunicipality = hasInput(knownContext, ['municipality', 'location', 'city']);
    const hasBdew = hasInput(knownContext, ['bdewCode', 'bdew']);
    const hasVnbName = hasInput(knownContext, ['vnbName', 'gridOperatorName']);

    // Domain rule: operatorScope (bdew/vnbName) enables direct vnbLookup.
    // locationScope alone (city) is disambiguation context only, not operator identity.
    // When only locationScope is available, resolve via 2-step: marketPartners → vnbLookup.
    if (hasBdew || hasVnbName) {
      // Operator identity available: direct vnbLookup
      executableSteps.push({
        step: 1,
        action: 'grid-operations.vnbLookup',
        label: 'VNB-Zuständigkeit prüfen (Operator-Scope)',
        params: {
          ...(hasBdew && { bdew: knownContext.bdewCode || knownContext.bdew }),
          ...(hasVnbName && { vnbName: knownContext.vnbName || knownContext.gridOperatorName }),
          ...(hasMunicipality && { city: knownContext.municipality || knownContext.location }),
        },
        canExecute: true,
        purpose: 'direct_vnb_lookup',
        scopeType: 'operatorScope',
      });
      executableSteps.push({
        step: 2,
        action: 'grid-operations.marketPartners',
        label: 'Marktpartner & Kontaktdaten',
        params: {
          query:
            knownContext.vnbName ||
            knownContext.gridOperatorName ||
            knownContext.municipality ||
            '',
          limit: 5,
        },
        canExecute: true,
        purpose: 'market_context',
        scopeType: 'operatorScope',
      });
    } else if (hasMunicipality) {
      // Location scope only: resolve operator via marketPartners first, then vnbLookup
      // Step 1 can execute; step 2 requires step 1 result (operatorScope not yet resolved)
      executableSteps.push({
        step: 1,
        action: 'grid-operations.marketPartners',
        label: 'Marktpartner für Standort identifizieren (Operator-Auflösung)',
        params: {
          query: knownContext.municipality || knownContext.location || knownContext.city,
          limit: 5,
        },
        canExecute: true,
        purpose: 'operator_resolution_from_location',
        scopeType: 'locationScope',
        note: 'locationScope only — operator identity not yet resolved; marketPartners provides candidates',
      });
      executableSteps.push({
        step: 2,
        action: 'grid-operations.vnbLookup',
        label: 'VNB-Zuständigkeit prüfen (nach Operator-Auflösung)',
        params: {},
        canExecute: false,
        purpose: 'vnb_lookup_after_resolution',
        scopeType: 'operatorScope',
        scopeRequirement: 'operatorScope',
        dependsOn: 'step1',
        note: 'Requires operatorScope from step 1 (marketPartners result). city alone is not sufficient.',
      });
    } else {
      evidenceGates.push({
        id: 'vnb_lookup_blocker',
        label: 'VNB-Auflösung',
        blockedBy: 'location_or_bdew_missing',
        required: true,
      });
    }
  }

  if (workflowType === WORKFLOW_TYPES.MASTR_INVENTORY) {
    const hasLocation = hasInput(knownContext, ['municipality', 'location', 'postalCode']);
    if (hasLocation) {
      executableSteps.push({
        step: 1,
        action: 'grid-operations.marketPartners',
        label: 'Marktpartner-Bestand ermitteln',
        params: {
          query: knownContext.municipality || knownContext.location || knownContext.postalCode,
          limit: 10,
        },
        canExecute: true,
        purpose: 'asset_inventory',
        disclaimer: 'MaStR ist Kontextindikator – kein Nachweis freier Netzkapazität.',
      });
    } else {
      evidenceGates.push({
        id: 'location_required',
        label: 'Standort für Bestandsabfrage',
        blockedBy: 'location_missing',
        required: true,
      });
    }
  }

  if (workflowType === WORKFLOW_TYPES.PROSUMER_NAP_WALLET_ONBOARDING) {
    const hasDid = hasInput(knownContext, ['did', 'walletDid', 'assetDid', 'didUri']);
    const hasLocation = hasInput(knownContext, ['municipality', 'location', 'postalCode']);
    const hasMelo = hasInput(knownContext, ['meloId', 'melo', 'marketLocationId']);
    const hasMastr = hasInput(knownContext, ['mastrId', 'mastrNumber']);
    const hasAssets = hasInput(knownContext, ['assetType', 'assets', 'devices']);
    const hasGridOperator = hasInput(knownContext, [
      'gridOperatorName',
      'gridOperatorId',
      'bdewCode',
      'bdew',
    ]);
    const query =
      knownContext.municipality ||
      knownContext.location ||
      knownContext.postalCode ||
      knownContext.meloId ||
      knownContext.melo ||
      knownContext.marketLocationId ||
      '';

    if (hasDid) {
      assumptions.push({
        type: 'identity_anchor',
        statement:
          'Die NAP-Wallet-DID wird als technischer Anker verwendet; private Schlüssel werden nie verarbeitet.',
        basis: 'user_provided_did',
        status: 'explicit',
      });
    } else {
      evidenceGates.push({
        id: 'nap_wallet_did_gate',
        label: 'NAP-Wallet-DID erfassen',
        blockedBy: 'did_missing',
        required: true,
        description: 'DID wird als Anker für spätere Nachweise und DID-linked Resources benötigt.',
      });
    }

    if (hasLocation || hasMelo) {
      executableSteps.push({
        step: 1,
        action: 'grid-operations.marketPartners',
        label: 'Netzanschluss-Kontext und mögliche Marktpartner prüfen',
        params: { query, limit: 10 },
        canExecute: true,
        purpose: 'nap_connection_context',
        disclaimer:
          'Marktpartner-/MaStR-Kontext ist kein Nachweis der Anschluss- oder Steuerbarkeit.',
      });
    } else {
      evidenceGates.push({
        id: 'nap_connection_context_gate',
        label: 'Netzanschluss-Kontext prüfen',
        blockedBy: 'location_or_melo_missing',
        required: true,
        description:
          'PLZ, Ort oder MeLo-ID benötigt, um Netzanschluss und Zuständigkeit einzuordnen.',
      });
    }

    if (hasLocation) {
      executableSteps.push({
        step: 2,
        action: 'osm-geo.infrastructureNearby',
        label: 'Lokale Netzinfrastruktur und Energy-Sharing-Umfeld prüfen',
        params: {
          location: knownContext.municipality || knownContext.location || knownContext.postalCode,
          radiusMeters: 2000,
          maxResults: 20,
        },
        canExecute: true,
        purpose: 'nap_local_infrastructure_context',
      });
    } else {
      evidenceGates.push({
        id: 'nap_geo_context_gate',
        label: 'Lokale Infrastrukturprüfung',
        blockedBy: 'location_missing',
        required: false,
        description: 'Ort/PLZ oder Koordinaten verbessern die §42c-/Energy-Sharing-Vorprüfung.',
      });
    }

    if (hasGridOperator && (hasMastr || hasMelo || hasAssets)) {
      executableSteps.push({
        step: 3,
        action: 'mastr-quality.audit',
        label: 'Asset-Baseline gegen MaStR/Netzbetreiberkontext prüfen',
        params: {
          ...(knownContext.gridOperatorId && { gridOperatorId: knownContext.gridOperatorId }),
          ...((knownContext.bdewCode || knownContext.bdew) && {
            gridOperatorBdew: knownContext.bdewCode || knownContext.bdew,
          }),
          ...(knownContext.mastrId && { mastrId: knownContext.mastrId }),
          ...(knownContext.meloId && { meloId: knownContext.meloId }),
        },
        canExecute: true,
        purpose: 'nap_asset_baseline',
      });
    } else {
      evidenceGates.push({
        id: 'nap_asset_baseline_gate',
        label: 'Asset-Baseline für Wallet-Nachweis',
        blockedBy: hasGridOperator
          ? 'asset_baseline_missing'
          : 'grid_operator_or_asset_baseline_missing',
        required: true,
        description:
          'Für belastbare Credentials werden Netzbetreiberbezug plus MaStR-/MeLo-/Asset-Daten benötigt.',
      });
    }

    evidenceGates.push({
      id: 'nap_consent_gate',
      label: 'Einwilligung und Datenfreigabe',
      blockedBy: 'consent_required',
      required: true,
      description:
        'Vor DID-linked Resource oder Verifiable Credential muss feststehen, welche Anschluss-/Asset-/HEMS-Daten freigegeben werden dürfen.',
    });

    evidenceGates.push({
      id: 'nap_dlr_publication_gate',
      label: 'DID-linked Resource / Credential veröffentlichen',
      blockedBy: 'verified_baseline_and_consent_required',
      required: true,
      description:
        'Die DID wird erst nach geprüfter Asset-Baseline und Einwilligung mit einem Nachweis verknüpft.',
    });

    assumptions.push({
      type: 'working_assumption',
      statement:
        '§14a- oder §42c-Eignung darf nicht aus der Wallet allein abgeleitet werden; sie braucht Netzbetreiber-, Standort- und Asset-Evidenz.',
      basis: 'domain_guardrail',
      status: 'explicit',
    });
  }

  return { executableSteps, evidenceGates, assumptions };
}

// ─────────────────────────────────────────────────────────────────────────────
// 4. Readiness assessment
// ─────────────────────────────────────────────────────────────────────────────

function assessExecutionReadiness({
  workflowType = WORKFLOW_TYPES.ADVISORY_ONLY,
  missingInputs = [],
  executableSteps = [],
  canAutoExecute = false,
} = {}) {
  if (workflowType === WORKFLOW_TYPES.ADVISORY_ONLY) {
    return {
      readiness: EXECUTION_READINESS.ADVISORY_ONLY,
      canExecuteNow: false,
      nextUserQuestion: null,
    };
  }

  const criticalMissing = missingInputs.filter((m) => m.priority === 'critical');
  const highMissing = missingInputs.filter((m) => m.priority === 'high');
  const canRunSomething = executableSteps.some((s) => s.canExecute);

  if (criticalMissing.length === 0 && highMissing.length === 0 && canRunSomething) {
    const readiness = canAutoExecute ? EXECUTION_READINESS.READY : EXECUTION_READINESS.PARTIAL;
    return { readiness, canExecuteNow: canAutoExecute, nextUserQuestion: null };
  }

  if (criticalMissing.length > 0) {
    const first = criticalMissing[0];
    const nextUserQuestion = `Zu Ihrer genauen Einordnung: ${first.label}?`;
    return {
      readiness: EXECUTION_READINESS.AWAITING_INPUT,
      canExecuteNow: false,
      nextUserQuestion,
    };
  }

  if (highMissing.length > 0) {
    const first = highMissing[0];
    const nextUserQuestion = `Können Sie mir ${first.label} nennen, damit ich die Analyse gezielt durchführen kann?`;
    return {
      readiness: EXECUTION_READINESS.AWAITING_INPUT,
      canExecuteNow: false,
      nextUserQuestion,
    };
  }

  if (missingInputs.length > 0) {
    const first = missingInputs[0];
    const nextUserQuestion = `Können Sie noch angeben: ${first.label}?`;
    return {
      readiness: EXECUTION_READINESS.AWAITING_INPUT,
      canExecuteNow: false,
      nextUserQuestion,
    };
  }

  return { readiness: EXECUTION_READINESS.PARTIAL, canExecuteNow: false, nextUserQuestion: null };
}

// ─────────────────────────────────────────────────────────────────────────────
// 5. Top-level builder
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Resolves a permitted workflow type when the classified type is blocked by avoidWorkflowTypes.
 * Falls back to semanticWorkflowType if valid, otherwise advisory_only.
 *
 * @param {string|null} semanticWorkflowType - workflowType from semanticClassification
 * @param {string[]} avoidWorkflowTypes      - types that must not be used
 * @returns {string}
 */
function _resolvePermittedWorkflowType(semanticWorkflowType, avoidWorkflowTypes) {
  if (
    semanticWorkflowType &&
    !avoidWorkflowTypes.includes(semanticWorkflowType) &&
    Object.values(WORKFLOW_TYPES).includes(semanticWorkflowType)
  ) {
    return semanticWorkflowType;
  }
  return WORKFLOW_TYPES.ADVISORY_ONLY;
}

/**
 * Filters missingInputs by removing any entries whose param matches a doNotAskFor entry.
 * Matching is case-insensitive and normalises underscores/hyphens/spaces.
 *
 * @param {object[]} missingInputs
 * @param {string[]} doNotAskFor
 * @returns {object[]}
 */
function _filterSuppressedInputs(missingInputs, doNotAskFor) {
  if (!Array.isArray(doNotAskFor) || doNotAskFor.length === 0) return missingInputs;
  const norm = (s) =>
    String(s || '')
      .toLowerCase()
      .replace(/[_\s-]+/g, '');
  return (Array.isArray(missingInputs) ? missingInputs : []).filter((missing) => {
    const normParam = norm(missing.param);
    return !doNotAskFor.some((excluded) => {
      const normExcluded = norm(excluded);
      return (
        normParam === normExcluded ||
        normExcluded.includes(normParam) ||
        normParam.includes(normExcluded)
      );
    });
  });
}

/**
 * Derives executable steps directly from the capability broker's own
 * recommendedPlan when the local text-heuristic workflow produced nothing.
 *
 * Generic by design: works for any capability with preferredActions
 * (VDMI governance included), not a VDMI-specific shortcut (#150).
 *
 * @param {object[]} recommendedPlan - brokerRecommendation.recommendedPlan
 * @returns {object[]} executableSteps in the bridge's own step shape
 */
function _buildStepsFromBrokerRecommendation(recommendedPlan) {
  if (!Array.isArray(recommendedPlan) || recommendedPlan.length === 0) return [];

  return recommendedPlan
    .filter(
      (step) =>
        typeof step?.action === 'string' &&
        step.action.trim().length > 0 &&
        !step.action.startsWith('interface-placeholder.') &&
        !isBlockedAction(step.action)
    )
    .map((step, index) => ({
      step: index + 1,
      action: step.action,
      label: step.purpose || step.action,
      params: step.params && typeof step.params === 'object' ? step.params : {},
      canExecute: true,
      purpose: step.purpose || 'capability_broker_recommended_action',
      source: 'capability_broker',
    }));
}

/**
 * Builds the complete consultation execution plan artifact.
 *
 * @param {object} input
 * @param {string} input.message            - User message
 * @param {object} input.consultation       - Consultation result (nextActions, hypotheses, etc.)
 * @param {object} input.brokerRecommendation
 * @param {object} input.knownContext       - Known context params
 * @param {array} input.extractedInputs     - Pre-extracted inputs [{param, value, source, confidence}, ...]
 * @param {object} input.responseStrategy   - Response strategy (for audience/abstractionLevel)
 * @param {string} input.executionMode      - 'auto' | 'hitl'
 * @param {object|null} input.routingPolicy - Blueprint routing policy (avoidWorkflowTypes, stickiness)
 * @param {object|null} input.synthesisPolicy - Blueprint synthesis policy (doNotAskFor, deprioritize)
 * @returns {object} executionReadiness artifact
 */
function buildConsultationExecutionPlan({
  message = '',
  consultation = {},
  brokerRecommendation = {},
  knownContext = {},
  semanticClassification = null,
  extractedInputs = [],
  responseStrategy = {},
  executionMode = 'auto',
  routingPolicy = null,
  synthesisPolicy = null,
} = {}) {
  const consultationEnvelope = {
    ...(consultation || {}),
    semanticClassification:
      semanticClassification && typeof semanticClassification === 'object'
        ? semanticClassification
        : consultation?.semanticClassification || null,
  };

  const workflowType = classifyWorkflowType({
    message,
    consultation: consultationEnvelope,
    knownContext,
    brokerRecommendation,
    extractedInputs,
  });

  // Apply avoidWorkflowTypes policy: redirect blocked workflow types
  const avoidWorkflowTypes = Array.isArray(routingPolicy?.avoidWorkflowTypes)
    ? routingPolicy.avoidWorkflowTypes
    : [];
  const effectiveWorkflowType =
    avoidWorkflowTypes.length > 0 && avoidWorkflowTypes.includes(workflowType)
      ? _resolvePermittedWorkflowType(
          consultationEnvelope?.semanticClassification?.workflowType,
          avoidWorkflowTypes
        )
      : workflowType;

  const { availableInputs, missingInputs } = analyzeInputReadiness({
    workflowType: effectiveWorkflowType,
    knownContext,
    consultation: consultationEnvelope,
    extractedInputs,
  });

  // Apply doNotAskFor policy: suppress specified inputs from being asked
  const doNotAskFor = Array.isArray(synthesisPolicy?.doNotAskFor)
    ? synthesisPolicy.doNotAskFor
    : [];
  const filteredMissingInputs = _filterSuppressedInputs(missingInputs, doNotAskFor);

  const effectiveKnownContext = {
    ...Object.fromEntries(
      availableInputs
        .filter((input) => input?.param && input?.value !== undefined && input?.value !== null)
        .map((input) => [input.param, input.value])
    ),
    ...knownContext,
  };

  const localPlan = buildExecutablePlan({
    workflowType: effectiveWorkflowType,
    knownContext: effectiveKnownContext,
    missingInputs: filteredMissingInputs,
  });

  // Generic capability-broker fallback (#150): when the local text-heuristic
  // workflow produced no executable steps, but the broker already computed a
  // confident, capability-filtered recommendedPlan (e.g. VDMI governance's
  // vdmi.dossier/vdmi.negotiationTrace/vdmi.agentRole), use that instead of
  // leaving the turn advisory-only. Generic for any future capability with
  // preferredActions — not a VDMI-only shortcut.
  const brokerDrivenSteps =
    localPlan.executableSteps.length === 0
      ? _buildStepsFromBrokerRecommendation(brokerRecommendation?.recommendedPlan)
      : [];

  const usingBrokerDrivenPlan = brokerDrivenSteps.length > 0;
  const plannedWorkflowType = usingBrokerDrivenPlan
    ? WORKFLOW_TYPES.CAPABILITY_BROKER_EXECUTION
    : effectiveWorkflowType;
  const executableSteps = usingBrokerDrivenPlan ? brokerDrivenSteps : localPlan.executableSteps;
  const evidenceGates = localPlan.evidenceGates;
  const assumptions = usingBrokerDrivenPlan
    ? [
        ...localPlan.assumptions,
        {
          type: 'working_assumption',
          statement:
            `Ausführungsplan aus Capability-Broker-Empfehlung übernommen (` +
            `${brokerRecommendation?.capability || brokerRecommendation?.intent || 'unbekannt'}` +
            `), da keine lokale Workflow-Heuristik einen Plan liefert.`,
          basis: 'capability_broker_recommendation',
          status: 'explicit',
        },
      ]
    : localPlan.assumptions;

  // The broker already validated/interpolated its own plan's params upstream —
  // the discarded local workflow type's missingInputs requirements don't apply to it.
  const plannedMissingInputs = usingBrokerDrivenPlan ? [] : filteredMissingInputs;

  // Only allow auto-execution when: mode is auto, no critical missing inputs, steps available
  const criticalMissing = plannedMissingInputs.filter((m) => m.priority === 'critical');
  const canAutoExecute =
    executionMode === 'auto' &&
    criticalMissing.length === 0 &&
    executableSteps.some((s) => s.canExecute);

  const { readiness, canExecuteNow, nextUserQuestion } = assessExecutionReadiness({
    workflowType: plannedWorkflowType,
    missingInputs: plannedMissingInputs,
    executableSteps,
    canAutoExecute,
  });

  // Classify the query scope so the execution trace shows what drove tool selection
  const scopeClassification = classifyQueryScope(message, knownContext);

  return {
    workflowType: plannedWorkflowType,
    readiness,
    availableInputs,
    missingInputs: plannedMissingInputs,
    assumptions,
    executableSteps,
    evidenceGates,
    canExecuteNow,
    nextUserQuestion,
    audience: responseStrategy?.audience || 'general',
    abstractionLevel: responseStrategy?.abstractionLevel || 'balanced',
    scopeClassification,
    appliedPolicy: routingPolicy
      ? {
          sessionIntent: routingPolicy.sessionIntent || null,
          blueprintId: routingPolicy._blueprintId || null,
          blueprintVersion: routingPolicy._blueprintVersion || null,
          source: 'blueprint-policy',
          avoidWorkflowTypes,
        }
      : null,
  };
}

module.exports = {
  WORKFLOW_TYPES,
  EXECUTION_READINESS,
  classifyWorkflowType,
  analyzeInputReadiness,
  buildExecutablePlan,
  assessExecutionReadiness,
  buildConsultationExecutionPlan,
  executeWithReceipt,
  _resolvePermittedWorkflowType,
  _filterSuppressedInputs,
};

// ─────────────────────────────────────────────────────────────────────────────
// 6. Receipt Executor — thin adapter for runtime receipt execution
// ─────────────────────────────────────────────────────────────────────────────

/**
 * executeWithReceipt: Deterministic receipt tool plan executor
 *
 * Processes receipt.toolPlan.steps sequentially:
 * 1. Resolve params from receipt paramMapping + knownContext
 * 2. Execute tool using existing consultation-tool-resolver primitives
 * 3. Collect observations
 * 4. (Optional) Execute fallback if step 1 empty and fallbackActions exist
 * 5. Return results in shape compatible with legacy buildExecutablePlan output
 *
 * @param {object} receipt - Runtime receipt document (vnb-lookup-v1, etc.)
 * @param {object} knownContext - User context (city, bdewCode, vnbName, etc.)
 * @param {array} observations - Existing observations (appended to)
 * @param {object} toolResolver - consultation-tool-resolver context (callAction, etc.)
 * @param {object} logger - Logger for diagnostics
 * @returns {object} {steps: [], observations: [], errors: []}
 */
async function executeWithReceipt(
  receipt,
  knownContext = {},
  observations = [],
  toolResolver = {},
  logger = {}
) {
  if (!receipt || !receipt.toolPlan || !Array.isArray(receipt.toolPlan.steps)) {
    return { steps: [], observations, errors: ['Invalid receipt or missing toolPlan'] };
  }

  const results = { steps: [], observations: [...observations], errors: [] };
  const receiptId = receipt.receiptId || 'unknown';
  const log = logger || { info: () => {}, warn: () => {}, error: () => {} };
  const executionState = { stepResults: {} };
  const runtimeContext = {
    ...(knownContext && typeof knownContext === 'object' ? { ...knownContext } : {}),
  };

  for (const step of receipt.toolPlan.steps) {
    const stepNum = step.step || 0;
    const action = step.action || '';

    log.info(`[executeWithReceipt:${receiptId}] Step ${stepNum}: executing ${action}`);

    try {
      // 1. Resolve params from receipt paramMapping
      const resolvedParams = resolveReceiptParamMapping(
        step,
        runtimeContext,
        receipt.defaults || {},
        executionState
      );

      if (Object.keys(resolvedParams).length === 0 && step.required) {
        const err = `[executeWithReceipt] Step ${stepNum} (${action}) has no resolved params but is required`;
        log.warn(err);
        results.errors.push(err);
        results.steps.push({
          step: stepNum,
          action,
          status: 'skipped',
          reason: 'no_params_resolved',
        });
        continue;
      }

      // 2. Execute tool (using toolResolver if available, else fallback)
      let observation;
      if (toolResolver && typeof toolResolver.executeTool === 'function') {
        observation = await toolResolver.executeTool(action, resolvedParams);
      } else {
        // Fallback: dummy observation (for testing)
        observation = {
          action,
          status: 'completed',
          result: null,
          error: 'toolResolver not available',
        };
      }

      const normalizedObservation = normalizeObservationForStep(action, observation);
      const normalizedResult = normalizedObservation?.result;
      const normalizedStepData =
        normalizedResult &&
        typeof normalizedResult === 'object' &&
        normalizedResult.data !== undefined
          ? normalizedResult.data
          : normalizedResult;
      if (stepNum) {
        executionState.stepResults[stepNum] = {
          data: normalizedStepData,
          raw: normalizedResult,
          params: resolvedParams,
        };
      }
      mergeContextFromStepResult(runtimeContext, action, normalizedStepData);

      results.observations.push(normalizedObservation);
      results.steps.push({
        step: stepNum,
        action,
        status: normalizedObservation.status || 'completed',
        paramMapping: step.paramMapping,
        params: resolvedParams,
        outcome: normalizedObservation,
      });

      // 3. Conditional fallback: if step had no result AND fallbackActions exist
      if (
        !normalizedObservation.error &&
        (!normalizedObservation.result ||
          Object.keys(normalizedObservation.result || {}).length === 0) &&
        step.fallbackActions &&
        Array.isArray(step.fallbackActions) &&
        step.fallbackActions.length > 0
      ) {
        const fallbackAction = step.fallbackActions[0];
        log.info(
          `[executeWithReceipt:${receiptId}] Step ${stepNum}: primary empty, executing fallback ${fallbackAction}`
        );

        // Resolve params for fallback action (use same context, may differ by action)
        const fallbackParams = resolveFallbackActionParams(fallbackAction, runtimeContext, step);

        let fallbackObs;
        if (toolResolver && typeof toolResolver.executeTool === 'function') {
          fallbackObs = await toolResolver.executeTool(fallbackAction, fallbackParams);
        } else {
          fallbackObs = {
            action: fallbackAction,
            status: 'skipped',
            reason: 'toolResolver not available',
          };
        }

        const normalizedFallbackObservation = normalizeObservationForStep(
          fallbackAction,
          fallbackObs
        );
        const fallbackStepData =
          normalizedFallbackObservation?.result &&
          typeof normalizedFallbackObservation.result === 'object' &&
          normalizedFallbackObservation.result.data !== undefined
            ? normalizedFallbackObservation.result.data
            : normalizedFallbackObservation?.result;
        if (stepNum) {
          executionState.stepResults[`${stepNum}b`] = {
            data: fallbackStepData,
            raw: normalizedFallbackObservation?.result,
            params: fallbackParams,
          };
        }
        mergeContextFromStepResult(runtimeContext, fallbackAction, fallbackStepData);

        results.observations.push(normalizedFallbackObservation);
        results.steps.push({
          step: `${stepNum}b`,
          action: fallbackAction,
          status: 'fallback',
          outcome: normalizedFallbackObservation,
        });

        // If fallback succeeded, don't try further fallbacks
        if (!normalizedFallbackObservation.error && normalizedFallbackObservation.result) {
          break;
        }
      }
    } catch (err) {
      const errMsg = `[executeWithReceipt] Step ${stepNum} error: ${err.message}`;
      log.error(errMsg);
      results.errors.push(errMsg);
      results.steps.push({
        step: stepNum,
        action,
        status: 'error',
        error: errMsg,
      });

      // Don't stop on error; continue to next step
    }
  }

  log.info(
    `[executeWithReceipt:${receiptId}] Completed: ${results.steps.length} steps, ${results.errors.length} errors`
  );
  return results;
}

/**
 * Resolve params for a receipt step using paramMapping + knownContext + defaults
 *
 * paramMapping structure:
 * {
 *   bdew: { source: 'context', contextField: 'bdewCode', derivationHint: '...' },
 *   city: { source: 'fixed', value: 'Berlin' },  // or source: 'default', defaultKey: 'defaultCity'
 * }
 */
function resolveReceiptParamMapping(
  step = {},
  knownContext = {},
  defaults = {},
  executionState = {}
) {
  const resolved = pruneEmptyValues(
    deepResolveStepReferences(
      {
        ...(step?.params && typeof step.params === 'object' ? step.params : {}),
        ...(step?.paramsTemplate && typeof step.paramsTemplate === 'object'
          ? step.paramsTemplate
          : {}),
      },
      executionState
    )
  );
  const paramMapping = step.paramMapping || {};

  Object.entries(paramMapping).forEach(([paramName, mapping]) => {
    if (!mapping || typeof mapping !== 'object') return;

    const { source, contextField, value, defaultKey } = mapping;

    if (source === 'fixed' && value !== undefined) {
      const resolvedValue = resolveMappedRuntimeValue(value, executionState);
      if (resolvedValue !== undefined && resolvedValue !== null && resolvedValue !== '') {
        resolved[paramName] = resolvedValue;
      }
    } else if (source === 'context' && contextField) {
      const ctxValue =
        typeof contextField === 'string' && contextField.startsWith('__step_')
          ? resolveStepReference(contextField, executionState)
          : getByPath(knownContext, contextField);
      if (ctxValue !== undefined && ctxValue !== null && ctxValue !== '') {
        resolved[paramName] = ctxValue;
      }
    } else if (source === 'default' && defaultKey) {
      const defValue = getByPath(defaults, defaultKey);
      if (defValue !== undefined && defValue !== null && defValue !== '') {
        resolved[paramName] = defValue;
      }
    }
  });

  return resolved;
}

function normalizeObservationForStep(action = '', observation = {}) {
  if (!observation || typeof observation !== 'object') {
    return {
      action,
      status: 'completed',
      result: observation,
    };
  }

  if (action !== 'grid-operations.marketPartners') {
    return observation;
  }

  const result = observation.result;
  if (!result || typeof result !== 'object') {
    return observation;
  }

  const data = result?.data && typeof result.data === 'object' ? result.data : null;
  const candidates = Array.isArray(data?.results)
    ? data.results
    : Array.isArray(result?.results)
      ? result.results
      : [];

  if (candidates.length < 2) {
    return observation;
  }

  const ordered = orderMarketPartnersByVnbPreference(candidates);
  const normalizedResult =
    data && Array.isArray(data.results)
      ? {
          ...result,
          data: {
            ...data,
            results: ordered,
          },
        }
      : {
          ...result,
          results: ordered,
        };

  return {
    ...observation,
    result: normalizedResult,
  };
}

function orderMarketPartnersByVnbPreference(candidates = []) {
  const scoreCandidate = (candidate = {}) => {
    const role = String(candidate?.role || candidate?.marketRole || '').toLowerCase();
    const roleLabel = String(candidate?.roleLabel || '').toLowerCase();
    const name = String(
      candidate?.name || candidate?.companyName || candidate?.legalName || ''
    ).toLowerCase();
    const hasBdew = Boolean(candidate?.bdewCode || candidate?.bdew);

    let score = 0;
    if (/\bvnb\b|distribution|verteilnetz/.test(role) || /\bvnb\b|distribution/.test(roleLabel)) {
      score += 120;
    }
    if (/netze|netz|verteilnetz/.test(name)) {
      score += 90;
    }
    if (
      /lieferant|vertrieb|energiehandel|sales/.test(role) ||
      /lieferant|vertrieb|energiehandel/.test(name)
    ) {
      score -= 70;
    }
    if (hasBdew) {
      score += 10;
    }
    if (Array.isArray(candidate?.contacts) && candidate.contacts.length > 0) {
      score += 5;
    }
    return score;
  };

  return [...candidates]
    .map((candidate, index) => ({
      candidate,
      index,
      score: scoreCandidate(candidate),
    }))
    .sort((a, b) => {
      if (b.score !== a.score) {
        return b.score - a.score;
      }
      return a.index - b.index;
    })
    .map((entry) => entry.candidate);
}

function mergeContextFromStepResult(runtimeContext = {}, action = '', stepData = {}) {
  if (
    !runtimeContext ||
    typeof runtimeContext !== 'object' ||
    !stepData ||
    typeof stepData !== 'object'
  ) {
    return;
  }

  if (action === 'grid-operations.marketPartners') {
    const results = Array.isArray(stepData?.results) ? stepData.results : [];
    const top = results[0] || null;
    if (top && runtimeContext.bdewCode == null && runtimeContext.bdew == null) {
      runtimeContext.bdewCode = top.bdewCode || top.bdew || runtimeContext.bdewCode;
      runtimeContext.bdew = top.bdewCode || top.bdew || runtimeContext.bdew;
    }
    if (top && !runtimeContext.city) {
      runtimeContext.city = top?.contacts?.[0]?.city || runtimeContext.city;
    }
    if (top && !runtimeContext.vnbName) {
      runtimeContext.vnbName = top.name || top.companyName || runtimeContext.vnbName;
    }
  }

  if (action === 'grid-operations.vnbLookup') {
    const operator =
      stepData?.operator && typeof stepData.operator === 'object' ? stepData.operator : null;
    if (operator && runtimeContext.bdewCode == null && runtimeContext.bdew == null) {
      runtimeContext.bdewCode = operator.bdew || runtimeContext.bdewCode;
      runtimeContext.bdew = operator.bdew || runtimeContext.bdew;
    }
    if (operator && !runtimeContext.city) {
      runtimeContext.city = operator.city || runtimeContext.city;
    }
    if (operator && !runtimeContext.vnbName) {
      runtimeContext.vnbName = operator.name || runtimeContext.vnbName;
    }
  }
}

function resolveMappedRuntimeValue(value, executionState = {}) {
  if (typeof value !== 'string') {
    return value;
  }
  const trimmed = value.trim();
  if (!trimmed.startsWith('__step_')) {
    return value;
  }
  return resolveStepReference(trimmed, executionState);
}

function deepResolveStepReferences(value, executionState = {}) {
  if (Array.isArray(value)) {
    return value.map((item) => deepResolveStepReferences(item, executionState));
  }
  if (!value || typeof value !== 'object') {
    return resolveMappedRuntimeValue(value, executionState);
  }

  return Object.fromEntries(
    Object.entries(value).map(([key, child]) => [
      key,
      deepResolveStepReferences(child, executionState),
    ])
  );
}

function resolveStepReference(reference = '', executionState = {}) {
  if (typeof reference !== 'string') {
    return undefined;
  }

  const match = reference.match(/^(__step_(\d+))(?:\.(.+))?$/);
  if (!match) {
    return undefined;
  }

  const stepIndex = Number(match[2]);
  const stepPath = match[3] || '';
  const stepEntry = executionState?.stepResults?.[stepIndex];
  if (!stepEntry) {
    return undefined;
  }

  if (!stepPath) {
    return stepEntry;
  }

  return getByPath(stepEntry, stepPath);
}

function getByPath(source, path = '') {
  if (!path) {
    return source;
  }
  const segments = String(path)
    .replace(/\[(\d+)\]/g, '.$1')
    .split('.')
    .filter(Boolean);

  return segments.reduce((cursor, segment) => {
    if (cursor === undefined || cursor === null) {
      return undefined;
    }
    return cursor[segment];
  }, source);
}

function pruneEmptyValues(value) {
  if (Array.isArray(value)) {
    return value.map((item) => pruneEmptyValues(item)).filter((item) => item !== undefined);
  }
  if (!value || typeof value !== 'object') {
    if (value === undefined || value === null || value === '') {
      return undefined;
    }
    return value;
  }

  const entries = Object.entries(value)
    .map(([key, child]) => [key, pruneEmptyValues(child)])
    .filter(([, child]) => child !== undefined);

  return Object.fromEntries(entries);
}

/**
 * Resolve params for fallback action (e.g., marketPartners after vnbLookup fails)
 * Derives query param from context or prior step result
 */
function resolveFallbackActionParams(fallbackAction = '', knownContext = {}, priorStep = {}) {
  const params = {};

  if (fallbackAction === 'grid-operations.marketPartners') {
    // marketPartners prefers query param, can use city/vnbName/gridOperatorName as fallback
    params.query = knownContext.city || knownContext.vnbName || knownContext.gridOperatorName || '';
    params.limit = 5;
  }

  return params;
}
