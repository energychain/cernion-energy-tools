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
    ? consultation.nextActions
        .map((a) => `${a.action || ''} ${a.description || ''}`)
        .join(' ')
    : '';
  return `${String(message || '')} ${nextActionText}`;
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
function classifyWorkflowType({ message = '', consultation = {}, knownContext = {}, brokerRecommendation = {}, extractedInputs = [] } = {}) {
  const semanticWorkflow = String(consultation?.semanticClassification?.workflowType || '').trim();
  if (semanticWorkflow && Object.values(WORKFLOW_TYPES).includes(semanticWorkflow)) {
    return semanticWorkflow;
  }

  const text = signalText(message, consultation);

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

  // 1c. Portfolio / Flexibility / Aggregator
  if (PORTFOLIO_SIGNALS.test(text)) {
    return WORKFLOW_TYPES.SUPPLIER_PORTFOLIO_FLEX_ASSESSMENT;
  }

  // 1d. Prosumer / NAP / Wallet
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
  { param: 'location', label: 'Projektort (Gemeinde oder GPS)', priority: 'critical', keys: ['municipality', 'location', 'latitude'] },
  { param: 'powerMW', label: 'Installierte Leistung (MW)', priority: 'critical', keys: ['powerMW', 'capacityMW'] },
  { param: 'capacityMWh', label: 'Speicherkapazität (MWh)', priority: 'high', keys: ['capacityMWh'] },
  { param: 'gridOperator', label: 'Netzbetreiber oder BDEW-Code', priority: 'high', keys: ['gridOperatorName', 'bdewCode', 'bdew'] },
];

const BESS_SCREEN_REQUIRED = [
  { param: 'state', label: 'Bundesland oder Region', priority: 'critical', keys: ['state', 'bundesland'] },
];

const ES_REQUIRED = [
  { param: 'municipality', label: 'Gemeinde / Standort', priority: 'critical', keys: ['municipality', 'location'] },
  { param: 'powerMW', label: 'PV-Leistung (kW/MW) oder Gebäudefläche', priority: 'high', keys: ['powerMW', 'capacityMW', 'buildingArea'] },
];

const VNB_REQUIRED = [
  { param: 'location_or_bdew', label: 'Gemeinde/Ort ODER BDEW-Code', priority: 'critical', keys: ['municipality', 'location', 'bdewCode', 'bdew'] },
];

const MASTR_REQUIRED = [
  { param: 'location', label: 'Gemeinde oder Postleitzahl', priority: 'critical', keys: ['municipality', 'location', 'postalCode'] },
];

const REQUIRED_BY_WORKFLOW = {
  [WORKFLOW_TYPES.BESS_DEVELOPMENT]: BESS_DEV_REQUIRED,
  [WORKFLOW_TYPES.BESS_SCREENING]: BESS_SCREEN_REQUIRED,
  [WORKFLOW_TYPES.ENERGY_SHARING_READINESS]: ES_REQUIRED,
  [WORKFLOW_TYPES.VNB_IDENTIFICATION]: VNB_REQUIRED,
  [WORKFLOW_TYPES.MASTR_INVENTORY]: MASTR_REQUIRED,
  [WORKFLOW_TYPES.ADVISORY_ONLY]: [],
};

function hasContextKey(knownContext, keys = []) {
  return keys.some((k) => {
    const v = knownContext[k];
    return v !== null && v !== undefined && v !== '';
  });
}

function analyzeInputReadiness({ workflowType = WORKFLOW_TYPES.ADVISORY_ONLY, knownContext = {}, consultation = {}, extractedInputs = [] } = {}) {
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
    availableInputs.push({ param: key, value: String(knownContext[key]).slice(0, 100), source: 'knownContext', confidence: 'medium' });
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

function buildExecutablePlan({ workflowType = WORKFLOW_TYPES.ADVISORY_ONLY, knownContext = {}, missingInputs = [] } = {}) {
  const executableSteps = [];
  const evidenceGates = [];
  const assumptions = [];

  const missingParams = new Set(missingInputs.map((m) => m.param));

  if (workflowType === WORKFLOW_TYPES.BESS_DEVELOPMENT) {
    // Step 1: VNB lookup — needs location or BDEW
    const hasLocation = hasInput(knownContext, ['municipality', 'location', 'latitude', 'longitude']);
    const hasBdew = hasInput(knownContext, ['bdewCode', 'bdew']);
    if (hasLocation || hasBdew) {
      executableSteps.push({
        step: 1,
        action: 'grid-operations.vnbLookup',
        label: 'Netzbetreiber-Zuständigkeit prüfen',
        params: {
          ...(knownContext.municipality && { city: knownContext.municipality }),
          ...(knownContext.location && !knownContext.municipality && { city: knownContext.location }),
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
      statement: 'MaStR-Bestand wird als Kontextindikator verwendet – kein Nachweis freier Netzkapazität.',
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
    const hasState = hasInput(knownContext, ['state', 'bundesland']);
    if (hasState) {
      executableSteps.push({
        step: 1,
        action: 'grid-operations.marketPartners',
        label: 'Netzbetreiber im Bundesland identifizieren',
        params: {
          query: knownContext.state || knownContext.bundesland,
          limit: 10,
        },
        canExecute: true,
        purpose: 'state_operator_overview',
      });
    }

    evidenceGates.push({
      id: 'site_analysis_gate',
      label: 'Standortanalyse (Gemeinde/Koordinaten)',
      blockedBy: 'location_missing',
      required: true,
      description: 'Konkrete Gemeinde oder GPS-Koordinaten für Standortprüfung benötigt.',
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
      description:
        'Netzbetreiber muss bestätigen, dass Energy-Sharing im Netzgebiet zulässig ist.',
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
    const hasMunicipality = hasInput(knownContext, ['municipality', 'location']);
    const hasBdew = hasInput(knownContext, ['bdewCode', 'bdew']);

    if (hasMunicipality || hasBdew) {
      executableSteps.push({
        step: 1,
        action: 'grid-operations.vnbLookup',
        label: 'VNB-Zuständigkeit prüfen',
        params: {
          ...(hasMunicipality && { city: knownContext.municipality || knownContext.location }),
          ...(hasBdew && { bdew: knownContext.bdewCode || knownContext.bdew }),
        },
        canExecute: true,
        purpose: 'primary_vnb_lookup',
      });
      executableSteps.push({
        step: 2,
        action: 'grid-operations.marketPartners',
        label: 'Marktpartner & Kontaktdaten',
        params: {
          query: knownContext.municipality || knownContext.gridOperatorName || '',
          limit: 5,
        },
        canExecute: true,
        purpose: 'market_context',
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
    return { readiness: EXECUTION_READINESS.ADVISORY_ONLY, canExecuteNow: false, nextUserQuestion: null };
  }

  const criticalMissing = missingInputs.filter((m) => m.priority === 'critical');
  const canRunSomething = executableSteps.some((s) => s.canExecute);

  if (criticalMissing.length === 0 && canRunSomething) {
    const readiness = canAutoExecute ? EXECUTION_READINESS.READY : EXECUTION_READINESS.PARTIAL;
    return { readiness, canExecuteNow: canAutoExecute, nextUserQuestion: null };
  }

  if (criticalMissing.length > 0) {
    const first = criticalMissing[0];
    const nextUserQuestion = `Zu Ihrer genauen Einordnung: ${first.label}?`;
    return { readiness: EXECUTION_READINESS.AWAITING_INPUT, canExecuteNow: false, nextUserQuestion };
  }

  if (missingInputs.length > 0) {
    const first = missingInputs[0];
    const nextUserQuestion = `Können Sie noch angeben: ${first.label}?`;
    return { readiness: EXECUTION_READINESS.AWAITING_INPUT, canExecuteNow: false, nextUserQuestion };
  }

  return { readiness: EXECUTION_READINESS.PARTIAL, canExecuteNow: false, nextUserQuestion: null };
}

// ─────────────────────────────────────────────────────────────────────────────
// 5. Top-level builder
// ─────────────────────────────────────────────────────────────────────────────

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

  const { availableInputs, missingInputs } = analyzeInputReadiness({
    workflowType,
    knownContext,
    consultation: consultationEnvelope,
    extractedInputs,
  });

  const { executableSteps, evidenceGates, assumptions } = buildExecutablePlan({
    workflowType,
    knownContext,
    missingInputs,
  });

  // Only allow auto-execution when: mode is auto, no critical missing inputs, steps available
  const criticalMissing = missingInputs.filter((m) => m.priority === 'critical');
  const canAutoExecute =
    executionMode === 'auto' &&
    criticalMissing.length === 0 &&
    executableSteps.some((s) => s.canExecute);

  const { readiness, canExecuteNow, nextUserQuestion } = assessExecutionReadiness({
    workflowType,
    missingInputs,
    executableSteps,
    canAutoExecute,
  });

  return {
    workflowType,
    readiness,
    availableInputs,
    missingInputs,
    assumptions,
    executableSteps,
    evidenceGates,
    canExecuteNow,
    nextUserQuestion,
    audience: responseStrategy?.audience || 'general',
    abstractionLevel: responseStrategy?.abstractionLevel || 'balanced',
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
};
