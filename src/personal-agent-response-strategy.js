'use strict';

const TECHNICAL_CUES = [
  'api',
  'schema',
  'json',
  'parameter',
  'params',
  'mastr',
  'bdew',
  'nap',
  'netzanschlusspunkt',
  'netzbetreiber',
  'redispatch',
  'vnb',
  'moleculer',
  'service',
  'endpoint',
  'debug',
  'trace',
  'log',
  'pouchdb',
  'kpi',
  'spannungsebene',
  'leistung',
  'kw',
  'mw',
  'implementation',
  'implementierung',
  'fehler',
  'stack',
];

const LEADERSHIP_CUES = [
  'vorstand',
  'geschäftsführung',
  'geschaeftsfuehrung',
  'leitung',
  'management',
  'strategie',
  'strategisch',
  'entscheid',
  'entscheidung',
  'freigabe',
  'budget',
  'risiko',
  'business case',
  'investor',
  'board',
  'gremium',
  'ausschuss',
  'portfolio',
  'wirtschaftlich',
  'roi',
  'amortisation',
  'priorisierung',
];

const AUDIENCES = Object.freeze({
  TECHNICAL: 'technical',
  LEADERSHIP: 'leadership',
  MIXED: 'mixed',
  GENERAL: 'general',
});

const EPISTEMIC_STATES = Object.freeze({
  CLEAR: 'clear',
  INFERABLE: 'inferable',
  AMBIGUOUS: 'ambiguous',
  MISSING: 'missing',
});

function normalizeText(value) {
  return String(value || '')
    .toLowerCase()
    .replace(/[\u200b\u200c\u200d]/g, '')
    .replace(/ß/g, 'ss');
}

function countCueHits(haystack, cues = []) {
  const text = normalizeText(haystack);
  return cues.reduce((count, cue) => (text.includes(normalizeText(cue)) ? count + 1 : count), 0);
}

function toHumanLabel(value) {
  const text = String(value || '')
    .replace(/([a-z])([A-Z])/g, '$1 $2')
    .replace(/[_-]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();

  return text ? text.charAt(0).toUpperCase() + text.slice(1) : 'die fehlende Angabe';
}

function humanizeMissingInput(paramKey) {
  const mapping = {
    taskId: 'die Task-ID',
    agentId: 'den verantwortlichen Akteur',
    matrixId: 'die Matrix-ID',
    processId: 'die Prozess-ID',
    projectId: 'die Projekt-ID',
    gridOperatorName: 'den Netzbetreiber',
    gridOperatorId: 'die Netzbetreiber-ID',
    gridOperatorBdew: 'den BDEW-Code',
    bdew: 'den BDEW-Code',
    city: 'den Ort',
    vnbName: 'den Netzbetreibernamen',
    query: 'einen belastbaren Suchhinweis',
    operatorEvidence: 'den Netzbetreiber oder den BDEW-Code',
    fnavProfile: 'das fNAV-Profil',
    voltageLevel: 'die Spannungsebene',
    ownerContact: 'den Ansprechpartner',
    communityName: 'den Gemeinschaftsnamen',
    communityId: 'die Gemeinschafts-ID',
    generators: 'die Erzeugungsdaten',
    consumers: 'die Verbrauchsdaten',
    dateFrom: 'den Startzeitpunkt',
    dateTo: 'den Endzeitpunkt',
    annualFeeEur: 'den Jahresbetrag',
    postalCode: 'die Postleitzahl',
    postleitzahl: 'die Postleitzahl',
    location: 'den Standort',
    role: 'die Rolle',
  };

  return mapping[paramKey] || `den Wert für ${toHumanLabel(paramKey)}`;
}

function inferAudience(input = {}) {
  const knownContext = input.knownContext || {};
  const knowledgeContext = input.knowledgeContext || null;
  const plan = input.plan || {};
  const execution = input.execution || {};

  const signalParts = [
    input.message,
    knownContext.targetAudience,
    knownContext.target_audience,
    knownContext.role,
    knowledgeContext?.synthesisStyle,
    knowledgeContext?.domainHint,
    knowledgeContext?.regulatoryFrame,
    plan?.primaryIntent,
    plan?.routeLabel,
    plan?.routeKey,
    execution?.stopPoint?.reasonCode,
    Array.isArray(plan?.steps)
      ? plan.steps.map((step) => `${step?.action || ''} ${step?.purpose || ''} ${step?.label || ''}`)
      : [],
  ]
    .flat()
    .filter(Boolean)
    .join(' ');

  const technicalScore = countCueHits(signalParts, TECHNICAL_CUES);
  const leadershipScore = countCueHits(signalParts, LEADERSHIP_CUES);

  const explicitAudience = normalizeText(
    knownContext.targetAudience || knownContext.target_audience || knownContext.role || ''
  );
  if (/(vorstand|geschäftsführung|geschaeftsfuehrung|leitung|management|führung|fuehrung|board)/i.test(explicitAudience)) {
    return { audience: AUDIENCES.LEADERSHIP, confidence: 0.9 };
  }
  if (/(technisch|technik|api|schema|json|debug|trace|bdew|mastr|netzbetreiber)/i.test(explicitAudience)) {
    return { audience: AUDIENCES.TECHNICAL, confidence: 0.9 };
  }

  if (technicalScore > leadershipScore + 1) {
    return { audience: AUDIENCES.TECHNICAL, confidence: 0.78 };
  }
  if (leadershipScore > technicalScore + 1) {
    return { audience: AUDIENCES.LEADERSHIP, confidence: 0.78 };
  }
  if (technicalScore > 0 && leadershipScore > 0) {
    return { audience: AUDIENCES.MIXED, confidence: 0.6 };
  }

  return { audience: AUDIENCES.GENERAL, confidence: 0.45 };
}

function inferEpistemicState(input = {}, audience = AUDIENCES.GENERAL) {
  const missingParams = Array.isArray(input.missingParams) ? input.missingParams : [];
  const knownContext = input.knownContext || {};
  const existingAssumptions = Array.isArray(input.existingAssumptions)
    ? input.existingAssumptions
    : [];
  const executionAssumptions = Array.isArray(input.execution?.assumptions)
    ? input.execution.assumptions
    : [];
  const combinedAssumptions = [...existingAssumptions, ...executionAssumptions];

  if (missingParams.length === 0) {
    return EPISTEMIC_STATES.CLEAR;
  }

  const inferableHints = [
    knownContext.gridOperatorName,
    knownContext.assertedGridOperatorName,
    knownContext.bdew,
    knownContext.gridOperatorBdew,
    knownContext.postalCode,
    knownContext.postleitzahl,
    knownContext.location,
    knownContext.city,
  ]
    .filter(Boolean)
    .length;

  const hasInferableMissing = missingParams.some((param) =>
    /^(gridOperatorName|gridOperatorId|gridOperatorBdew|bdew|operatorEvidence|city|postalCode|postleitzahl|location)$/i.test(
      String(param || '')
    )
  );

  if (hasInferableMissing && (inferableHints > 0 || combinedAssumptions.length > 0)) {
    return EPISTEMIC_STATES.INFERABLE;
  }

  if (audience === AUDIENCES.MIXED && missingParams.length > 0) {
    return EPISTEMIC_STATES.AMBIGUOUS;
  }

  return EPISTEMIC_STATES.MISSING;
}

function formatAssumption(assumption = {}) {
  if (!assumption || typeof assumption !== 'object') {
    return null;
  }

  if (typeof assumption.statement === 'string' && assumption.statement.trim()) {
    return {
      ...assumption,
      statement: assumption.statement.trim(),
    };
  }

  if (assumption.type === 'location_operator_unverified') {
    const location = String(assumption.location || 'dem Standort').trim() || 'dem Standort';
    const operator = String(assumption.assertedGridOperatorName || '').trim();
    const statement = operator
      ? `Vorläufige Annahme: Die Zuständigkeit von ${operator} am Standort ${location} ist noch nicht belastbar verifiziert.`
      : `Vorläufige Annahme: Die Zuständigkeit des Netzbetreibers am Standort ${location} ist noch nicht belastbar verifiziert.`;

    return {
      type: assumption.type,
      statement,
      basis: 'location-operator-consistency',
      confidence: 'medium',
      status: assumption.status || 'unverified',
    };
  }

  const label = assumption.type ? toHumanLabel(assumption.type) : 'Vorläufige Annahme';
  const details = [assumption.location, assumption.assertedGridOperatorName, assumption.status]
    .filter(Boolean)
    .map((entry) => String(entry).trim())
    .join(' · ');

  return {
    ...assumption,
    statement: details ? `${label}: ${details}` : `${label}: ohne weitere Detailangaben`,
  };
}

function buildAssumptions(input = {}, epistemicState = EPISTEMIC_STATES.CLEAR) {
  const assumptions = [];
  const existingAssumptions = Array.isArray(input.existingAssumptions)
    ? input.existingAssumptions
    : [];
  const executionAssumptions = Array.isArray(input.execution?.assumptions)
    ? input.execution.assumptions
    : [];

  for (const assumption of [...existingAssumptions, ...executionAssumptions]) {
    const formatted = formatAssumption(assumption);
    if (formatted) {
      assumptions.push(formatted);
    }
  }

  if (
    epistemicState === EPISTEMIC_STATES.INFERABLE &&
    assumptions.length === 0 &&
    Array.isArray(input.missingParams) &&
    input.missingParams.length > 0
  ) {
    const inferredLabel = input.missingParams
      .slice(0, 2)
      .map((param) => humanizeMissingInput(param))
      .join(' und ');

    assumptions.push({
      type: 'working_assumption',
      statement: `Vorläufige Annahme: ${inferredLabel} ist aus dem aktuellen Kontext noch nicht belastbar verifiziert.`,
      basis: 'contextual-inference',
      confidence: 'medium',
      status: 'inferred',
    });
  }

  return assumptions;
}

function buildStrategyLead({ audience, epistemicState, assumptions } = {}) {
  const hasAssumptions = Array.isArray(assumptions) && assumptions.length > 0;

  if (epistemicState === EPISTEMIC_STATES.INFERABLE || hasAssumptions) {
    return 'Vorläufige Annahme:';
  }
  if (epistemicState === EPISTEMIC_STATES.AMBIGUOUS) {
    return 'Noch nicht eindeutig:';
  }
  if (audience === AUDIENCES.LEADERSHIP) {
    return 'Für die Entscheidungsebene:';
  }
  if (audience === AUDIENCES.TECHNICAL) {
    return 'Technisch betrachtet:';
  }
  if (audience === AUDIENCES.MIXED) {
    return 'Ich trenne Technik und Entscheidung:';
  }
  return '';
}

function buildOnboardingQuestionText({ paramKey, label, strategy = {}, fallbackText } = {}) {
  if (fallbackText) {
    return fallbackText;
  }

  const safeLabel = String(label || humanizeMissingInput(paramKey)).trim() || 'die fehlende Angabe';
  const audience = strategy.audience || AUDIENCES.GENERAL;
  const epistemicState = strategy.epistemicState || EPISTEMIC_STATES.CLEAR;

  if (epistemicState === EPISTEMIC_STATES.INFERABLE) {
    return `Ich kann vorläufig weiterarbeiten, sobald ${safeLabel} belastbar vorliegt.`;
  }
  if (epistemicState === EPISTEMIC_STATES.AMBIGUOUS) {
    return `Damit ich die Lage sauber auflösen kann, brauche ich noch ${safeLabel}.`;
  }
  if (audience === AUDIENCES.LEADERSHIP) {
    return `Für die Entscheidungsebene brauche ich noch ${safeLabel}.`;
  }
  if (audience === AUDIENCES.TECHNICAL) {
    return `Bitte geben Sie ${safeLabel} an.`;
  }
  if (audience === AUDIENCES.MIXED) {
    return `Damit ich Technik und Entscheidung sauber trennen kann, brauche ich ${safeLabel}.`;
  }

  return `Bitte geben Sie ${safeLabel} an.`;
}

function buildResponseStrategy(input = {}) {
  const audienceResult = inferAudience(input);
  const epistemicState = inferEpistemicState(input, audienceResult.audience);
  const assumptions = buildAssumptions(input, epistemicState);
  const lead = buildStrategyLead({
    audience: audienceResult.audience,
    epistemicState,
    assumptions,
  });

  const abstractionLevel =
    audienceResult.audience === AUDIENCES.LEADERSHIP
      ? 'executive'
      : audienceResult.audience === AUDIENCES.TECHNICAL
        ? 'technical'
        : epistemicState === EPISTEMIC_STATES.MISSING
          ? 'clarify'
          : 'balanced';

  const nextMove =
    epistemicState === EPISTEMIC_STATES.MISSING
      ? 'request_parameters'
      : epistemicState === EPISTEMIC_STATES.INFERABLE
        ? 'state_assumption'
        : audienceResult.audience === AUDIENCES.LEADERSHIP
          ? 'recommend_action'
          : 'answer';

  const decisionRole =
    audienceResult.audience === AUDIENCES.LEADERSHIP && epistemicState === EPISTEMIC_STATES.MISSING
      ? 'strategic_clarification'
      : audienceResult.audience === AUDIENCES.LEADERSHIP &&
          epistemicState === EPISTEMIC_STATES.INFERABLE
        ? 'strategic_assumption'
        : audienceResult.audience === AUDIENCES.LEADERSHIP
          ? 'strategic_decision'
          : audienceResult.audience === AUDIENCES.TECHNICAL
            ? 'technical_validation'
            : epistemicState === EPISTEMIC_STATES.MISSING
              ? 'information_gathering'
              : 'advisory';

  const userFacingQuestionStyle =
    epistemicState === EPISTEMIC_STATES.MISSING
      ? 'parametric'
      : epistemicState === EPISTEMIC_STATES.AMBIGUOUS
        ? 'clarification'
        : epistemicState === EPISTEMIC_STATES.INFERABLE
          ? 'confirmation'
          : 'none';

  return {
    audience: audienceResult.audience,
    audienceConfidence: audienceResult.confidence,
    epistemicState,
    abstractionLevel,
    nextMove,
    assumptions,
    lead,
    decisionRole,
    userFacingQuestionStyle,
    shouldHideInternalSchema: true,
    confidence: Math.min(
      0.99,
      Number(
        ((audienceResult.confidence || 0.45) + (epistemicState === EPISTEMIC_STATES.CLEAR ? 0.2 : 0.1)).toFixed(2)
      )
    ),
  };
}

module.exports = {
  AUDIENCES,
  EPISTEMIC_STATES,
  buildOnboardingQuestionText,
  buildResponseStrategy,
  buildStrategyLead,
  humanizeMissingInput,
  toHumanLabel,
};
