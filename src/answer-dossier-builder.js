'use strict';

const { v4: uuidv4 } = require('uuid');

const DOSSIER_USER_CONTEXT = Object.freeze({
  UNKNOWN: 'unknown',
  MAYOR: 'mayor',
  MANAGEMENT: 'management',
  TARGET_GRID_PLANNING: 'target_grid_planning',
  REGULATORY: 'regulatory',
  TECHNICAL_OPERATOR: 'technical_operator',
  PROCESS_ACTION: 'process_action',
});

const DOSSIER_PROCESS_STAGE = Object.freeze({
  INITIAL: 'initial',
  CONTEXT_CLARIFICATION: 'context_clarification',
  EVIDENCE_COLLECTION: 'evidence_collection',
  SYNTHESIS: 'synthesis',
  ASYNC_PENDING: 'async_pending',
  INTENT_PREPARED: 'intent_prepared',
  // kept for session backwards-compatibility with v0.63.0 state
  ACTION_REQUESTED: 'action_requested',
  COMPLETED: 'completed',
});

const DOSSIER_ANSWER_MODE = Object.freeze({
  CLARIFICATION_NEEDED: 'clarification_needed',
  MANAGEMENT_BRIEF: 'management_brief',
  EVIDENCE_COLLECTION: 'evidence_collection',
  PROCESS_CHECK: 'process_check',
  PREPARE_INTENT: 'prepare_intent',
  PARTIAL_ASYNC: 'partial_async',
  FINAL_ANSWER: 'final_answer',
});

const DOSSIER_CONFIDENCE = Object.freeze({
  LOW: 'low',
  MEDIUM: 'medium',
  HIGH: 'high',
});

const DOSSIER_COMPLETION_STATE = Object.freeze({
  COMPLETED: 'completed',
  PARTIAL: 'partial',
  ASYNC_PENDING: 'async_pending',
});

const FORBIDDEN_CLAIM_TEXTS = [
  'Keine VNB-Zuständigkeit ohne belegte Quelldaten behaupten.',
  'Keine Rechtsquellen oder Fristen ohne belegte Evidence nennen.',
  'Keine Terminentlastung oder Fristverlängerung ohne Evidence-Basis.',
  'Keine Prozessschritte nennen, die nicht zum aktuellen Prozesskontext passen.',
  'Keine fachlichen Schlussfolgerungen ohne belastbare Evidence-Grundlage.',
];

const REDISPATCH_FORBIDDEN_CLAIMS = [
  'Keine Redispatch-Pflicht oder Abrechnungsgrundlage ohne vollständige Einspeisedaten behaupten.',
];

function computeTimeBudget(totalBudgetMs) {
  const safe = Math.max(5000, Math.min(60000, totalBudgetMs || 30000));
  if (safe >= 25000) {
    return { totalBudgetMs: safe, factCollectionMs: 14000, thinkingMs: 9000, compilationMs: 5000, safetyReserveMs: 2000 };
  } else if (safe >= 12000) {
    return {
      totalBudgetMs: safe,
      factCollectionMs: Math.floor(safe * 0.48),
      thinkingMs: Math.floor(safe * 0.3),
      compilationMs: 3000,
      safetyReserveMs: Math.max(500, safe - Math.floor(safe * 0.48) - Math.floor(safe * 0.3) - 3000),
    };
  } else {
    return { totalBudgetMs: safe, factCollectionMs: 0, thinkingMs: 0, compilationMs: safe - 1000, safetyReserveMs: 1000 };
  }
}

// Maps userContext → default answerMode
const USER_CONTEXT_TO_ANSWER_MODE = {
  [DOSSIER_USER_CONTEXT.UNKNOWN]: DOSSIER_ANSWER_MODE.CLARIFICATION_NEEDED,
  [DOSSIER_USER_CONTEXT.MAYOR]: DOSSIER_ANSWER_MODE.MANAGEMENT_BRIEF,
  [DOSSIER_USER_CONTEXT.MANAGEMENT]: DOSSIER_ANSWER_MODE.MANAGEMENT_BRIEF,
  [DOSSIER_USER_CONTEXT.TARGET_GRID_PLANNING]: DOSSIER_ANSWER_MODE.EVIDENCE_COLLECTION,
  [DOSSIER_USER_CONTEXT.REGULATORY]: DOSSIER_ANSWER_MODE.PROCESS_CHECK,
  [DOSSIER_USER_CONTEXT.TECHNICAL_OPERATOR]: DOSSIER_ANSWER_MODE.EVIDENCE_COLLECTION,
  [DOSSIER_USER_CONTEXT.PROCESS_ACTION]: DOSSIER_ANSWER_MODE.PREPARE_INTENT,
};

function classifyDossierContext({ question = '', priorUserContext = null, priorProcessStage = null, domain = 'auto', evidenceCount = 0 }) {
  // Preserve known prior userContext; re-detect only when unknown
  let userContext =
    priorUserContext && priorUserContext !== DOSSIER_USER_CONTEXT.UNKNOWN
      ? priorUserContext
      : DOSSIER_USER_CONTEXT.UNKNOWN;

  if (userContext === DOSSIER_USER_CONTEXT.UNKNOWN) {
    const q = question.toLowerCase();
    if (
      /\b(?:ev|e-?auto|elektroauto|wallbox|laden|ladezeit|ladung|charging)\b/i.test(q) &&
      /(?:\b(?:co2|kohlenstoff|emission|emissions|grünstrom|gruenstrom|gsi|strommix|klima)\b|co₂)/i.test(q)
    ) {
      userContext = DOSSIER_USER_CONTEXT.TECHNICAL_OPERATOR;
    } else if (/zielnetz|netzplanung|netzentwicklung|netzausbau|trassen/.test(q)) {
      userContext = DOSSIER_USER_CONTEXT.TARGET_GRID_PLANNING;
    } else if (
      /projektentwickl|machbarkeit|standortmachbarkeit|netzanschluss|anschlussleistung|rechenzentrum|data\s*center|grossverbrauch|großverbrauch|10\s*mw/.test(q)
    ) {
      userContext = DOSSIER_USER_CONTEXT.TECHNICAL_OPERATOR;
    } else if (/bürgermeister|buergermeister|mayor/.test(q)) {
      userContext = DOSSIER_USER_CONTEXT.MAYOR;
    } else if (/management|vorstand|geschäftsführ|entscheid|überblick/.test(q)) {
      userContext = DOSSIER_USER_CONTEXT.MANAGEMENT;
    } else if (/regulier|bundesnetzagentur|behörde|aufsicht|compliance|genehmigung/.test(q)) {
      userContext = DOSSIER_USER_CONTEXT.REGULATORY;
    } else if (
      /technisch|betrieb|wartung|messung|messwesen|messkonzept|mk10|mk40|schaltung|netzführung|dispatching|wärmepumpe|waermepumpe|speicher|pv[-\s]?anlage/.test(q)
    ) {
      userContext = DOSSIER_USER_CONTEXT.TECHNICAL_OPERATOR;
    } else if (/prozess starten|auslösen|durchführen|beauftrag|freigeben|abschicken|anmelden|einleiten/.test(q)) {
      userContext = DOSSIER_USER_CONTEXT.PROCESS_ACTION;
    }
  }

  const answerMode = USER_CONTEXT_TO_ANSWER_MODE[userContext] || DOSSIER_ANSWER_MODE.CLARIFICATION_NEEDED;

  // processStage — derived from userContext; known context always advances beyond initial
  let processStage;
  if (userContext === DOSSIER_USER_CONTEXT.PROCESS_ACTION) {
    processStage = DOSSIER_PROCESS_STAGE.INTENT_PREPARED;
  } else if (userContext === DOSSIER_USER_CONTEXT.UNKNOWN) {
    processStage = DOSSIER_PROCESS_STAGE.CONTEXT_CLARIFICATION;
  } else {
    // All known user contexts → evidence_collection; never leave at initial
    processStage = DOSSIER_PROCESS_STAGE.EVIDENCE_COLLECTION;
  }

  // Preserve prior stage if it's further along the pipeline (never regress)
  const STAGE_ORDER = [
    DOSSIER_PROCESS_STAGE.INITIAL,
    DOSSIER_PROCESS_STAGE.CONTEXT_CLARIFICATION,
    DOSSIER_PROCESS_STAGE.EVIDENCE_COLLECTION,
    DOSSIER_PROCESS_STAGE.SYNTHESIS,
    DOSSIER_PROCESS_STAGE.INTENT_PREPARED,
    DOSSIER_PROCESS_STAGE.ACTION_REQUESTED, // v0.63.0 compat
    DOSSIER_PROCESS_STAGE.COMPLETED,
  ];
  const priorIdx = STAGE_ORDER.indexOf(priorProcessStage);
  const currentIdx = STAGE_ORDER.indexOf(processStage);
  if (priorIdx > currentIdx && priorProcessStage !== DOSSIER_PROCESS_STAGE.ASYNC_PENDING) {
    processStage = priorProcessStage;
  }

  // confidence
  let confidence;
  if (evidenceCount >= 3) confidence = DOSSIER_CONFIDENCE.HIGH;
  else if (evidenceCount >= 1) confidence = DOSSIER_CONFIDENCE.MEDIUM;
  else confidence = DOSSIER_CONFIDENCE.LOW;

  return { userContext, processStage, answerMode, confidence };
}

function buildRequiredAnswerBehavior(answerMode) {
  const rules = [
    'Keine fachlichen Fakten hinzufügen, die nicht im Dossier enthalten sind.',
    'Unsicherheit und fehlende Evidence explizit benennen.',
  ];
  if (answerMode === DOSSIER_ANSWER_MODE.CLARIFICATION_NEEDED) {
    rules.push('Nutzerkontext ist unklar — eine gezielte Rückfrage formulieren statt einer abschließenden Antwort.');
    rules.push('Keine finalen Planungs- oder Prozessaussagen ohne bekannten Kontext.');
  } else if (answerMode === DOSSIER_ANSWER_MODE.MANAGEMENT_BRIEF) {
    rules.push('Kompakte, entscheidungsorientierte Antwort mit klarem Evidenzhinweis.');
    rules.push('Keine Detailtechnik — Fokus auf Handlungsrelevanz und offene Risiken.');
  } else if (answerMode === DOSSIER_ANSWER_MODE.EVIDENCE_COLLECTION) {
    rules.push('Keine finalen Planungsaussagen, solange Evidence unvollständig ist.');
    rules.push('Hypothesen und fehlende Datenpunkte explizit nennen.');
    rules.push('Evidence-Flow beschreiben, nicht abschließend bewerten.');
  } else if (answerMode === DOSSIER_ANSWER_MODE.PROCESS_CHECK) {
    rules.push('Regulatorische Anforderungen und Compliance-Stand benennen.');
    rules.push('Keine verbindliche Rechtsauskunft — nur Prüfpunkte und Handlungshinweise.');
  } else if (answerMode === DOSSIER_ANSWER_MODE.PREPARE_INTENT) {
    rules.push('Nur Prepare Intent oder Draft formulieren — keine direkte Ausführung, Bestätigung oder Freigabe.');
    rules.push('Fehlende Voraussetzungen für die Aktion explizit benennen.');
  } else if (answerMode === DOSSIER_ANSWER_MODE.PARTIAL_ASYNC) {
    rules.push('Dieses Dossier ist vorläufig — einige Evidence-Phasen sind noch ausstehend.');
    rules.push('Keine abschließende Antwort formulieren. Auf Aktualisierung hinweisen.');
  }
  return rules;
}

function buildRecommendedAnswerStructure(answerMode) {
  if (answerMode === DOSSIER_ANSWER_MODE.CLARIFICATION_NEEDED) {
    return ['1. Kurzer Kontextvorbehalt (1–2 Sätze)', '2. Gezielte Rückfrage an den Nutzer'];
  } else if (answerMode === DOSSIER_ANSWER_MODE.MANAGEMENT_BRIEF) {
    return ['1. Kernantwort (1–3 Sätze)', '2. Wichtigster Evidenzhinweis', '3. Offene Risiken oder nächster Schritt'];
  } else if (answerMode === DOSSIER_ANSWER_MODE.EVIDENCE_COLLECTION) {
    return ['1. Aktueller Evidenzstand', '2. Fehlende Datenpunkte oder Quellen', '3. Nächste Sammelschritte'];
  } else if (answerMode === DOSSIER_ANSWER_MODE.PROCESS_CHECK) {
    return ['1. Regulatorischer Prüfstand', '2. Compliance-Lücken', '3. Empfohlene nächste Schritte'];
  } else if (answerMode === DOSSIER_ANSWER_MODE.PREPARE_INTENT) {
    return ['1. Beschreibung der gewünschten Aktion', '2. Fehlende Voraussetzungen', '3. Prepare-Intent-Formulierung (kein Execute)'];
  } else if (answerMode === DOSSIER_ANSWER_MODE.PARTIAL_ASYNC) {
    return ['1. Vorläufige Evidence', '2. Ausstehende Phasen benennen', '3. Follow-up-Hinweis'];
  }
  return ['1. Antwort auf Basis des Dossiers', '2. Unsicherheiten benennen'];
}

function normalizeKnowledgeSpaceContext({
  tenantId = null,
  requestedTenantId = null,
  tenantScopeStatus = null,
  sessionId = null,
  conversationId = null,
  channel = null,
  surface = null,
} = {}) {
  return {
    tenantId: tenantId || 'default',
    requestedTenantId: requestedTenantId || null,
    tenantScopeStatus: tenantScopeStatus || 'auth_tenant_used',
    sessionId: sessionId || null,
    conversationId: conversationId || sessionId || null,
    channel: channel || 'unknown',
    surface: surface || 'unknown',
  };
}

function compactDossierText(value, maxLength = 500) {
  const text = String(value || '')
    .replace(/\s+/g, ' ')
    .trim();
  if (text.length <= maxLength) return text;
  return `${text.slice(0, Math.max(0, maxLength - 1)).trim()}…`;
}

function normalizePriorConversationContext(context = {}) {
  if (!context || typeof context !== 'object') {
    return { turns: [], summary: null, knownEvidence: [], missingEvidence: [] };
  }

  const turns = Array.isArray(context.turns)
    ? context.turns
        .map((turn) => ({
          dossierVersion: turn?.dossierVersion || null,
          question: compactDossierText(turn?.question, 350),
          dossierSummary: compactDossierText(turn?.dossierSummary, 500),
          answerMode: turn?.answerMode || null,
          processStage: turn?.processStage || null,
          userContext: turn?.userContext || null,
        }))
        .filter((turn) => turn.question || turn.dossierSummary)
        .slice(-5)
    : [];

  const knownEvidence = Array.isArray(context.knownEvidence)
    ? context.knownEvidence.map((entry) => compactDossierText(entry, 240)).filter(Boolean).slice(0, 5)
    : [];
  const missingEvidence = Array.isArray(context.missingEvidence)
    ? context.missingEvidence.map((entry) => compactDossierText(entry, 240)).filter(Boolean).slice(0, 5)
    : [];

  return {
    turns,
    summary: compactDossierText(context.summary, 700) || null,
    knownEvidence,
    missingEvidence,
  };
}

function buildPriorConversationSection(priorConversationContext = {}) {
  const normalized = normalizePriorConversationContext(priorConversationContext);
  const hasContext =
    normalized.summary ||
    normalized.turns.length > 0 ||
    normalized.knownEvidence.length > 0 ||
    normalized.missingEvidence.length > 0;

  const lines = ['## Prior Conversation Context'];
  if (!hasContext) {
    lines.push('_Keine vorherige Dossier-Konversation in dieser Session verfügbar._');
    return lines.join('\n');
  }

  if (normalized.summary) {
    lines.push(`- Summary: ${normalized.summary}`);
  }

  if (normalized.turns.length > 0) {
    lines.push('');
    lines.push('### Prior Dossier Turns');
    normalized.turns.forEach((turn, index) => {
      const label = turn.dossierVersion ? `Turn ${turn.dossierVersion}` : `Turn ${index + 1}`;
      lines.push(`- ${label}:`);
      if (turn.question) lines.push(`  - Nutzerfrage: ${turn.question}`);
      if (turn.dossierSummary) lines.push(`  - Dossier-Kontext: ${turn.dossierSummary}`);
      const state = [turn.userContext, turn.processStage, turn.answerMode].filter(Boolean).join(' / ');
      if (state) lines.push(`  - State: ${state}`);
    });
  }

  if (normalized.knownEvidence.length > 0) {
    lines.push('');
    lines.push('### Carry-Forward Evidence');
    normalized.knownEvidence.forEach((entry, index) => lines.push(`${index + 1}. ${entry}`));
  }

  if (normalized.missingEvidence.length > 0) {
    lines.push('');
    lines.push('### Carry-Forward Missing Evidence');
    normalized.missingEvidence.forEach((entry, index) => lines.push(`${index + 1}. ${entry}`));
  }

  return lines.join('\n');
}

function buildCapabilityRoutingSection(capabilityRouting) {
  const status = capabilityRouting?.status || 'unavailable';
  if (!capabilityRouting || status !== 'success' || !capabilityRouting.result) {
    const elapsed = capabilityRouting?.elapsedMs != null ? `${capabilityRouting.elapsedMs}ms` : 'n/a';
    return [
      '## Capability Routing Context',
      `- status: ${status}`,
      `- elapsed_ms: ${elapsed}`,
      '- note: Broker advisory not available for this dossier — proceed on Evidence basis only.',
    ].join('\n');
  }

  const r = capabilityRouting.result;
  const lines = [
    '## Capability Routing Context',
    `- status: ${status}`,
    `- elapsed_ms: ${capabilityRouting.elapsedMs}`,
    '- source: capability-broker (advisory only — does not upgrade evidence confidence)',
  ];

  if (r.intent) lines.push(`- intent: ${r.intent}`);
  if (r.capability) lines.push(`- capability: ${r.capability}`);
  if (typeof r.confidence === 'number') lines.push(`- confidence: ${r.confidence}`);
  if (r.domain) lines.push(`- domain: ${r.domain}`);
  if (r.routeLabel) lines.push(`- route_label: ${r.routeLabel}`);
  if (Array.isArray(r.recommendedCapabilities) && r.recommendedCapabilities.length > 0) {
    lines.push(`- recommended_capabilities: ${r.recommendedCapabilities.slice(0, 3).join(', ')}`);
  }
  if (Array.isArray(r.requiredInputs) && r.requiredInputs.length > 0) {
    lines.push(`- required_inputs: ${r.requiredInputs.slice(0, 5).join(', ')}`);
  }
  if (Array.isArray(r.missingInputs) && r.missingInputs.length > 0) {
    lines.push(`- missing_inputs: ${r.missingInputs.slice(0, 5).join(', ')}`);
  }
  if (Array.isArray(r.risks) && r.risks.length > 0) {
    lines.push(`- risks: ${r.risks.slice(0, 3).join('; ')}`);
  }
  if (r.hitlRequired != null) lines.push(`- hitl_required: ${r.hitlRequired}`);
  if (Array.isArray(r.preferredActions) && r.preferredActions.length > 0) {
    lines.push(`- preferred_actions: ${r.preferredActions.slice(0, 3).join(', ')}`);
  }
  if (Array.isArray(r.fallbackActions) && r.fallbackActions.length > 0) {
    lines.push(`- fallback_actions: ${r.fallbackActions.slice(0, 3).join(', ')}`);
  }
  if (r.summary) lines.push(`- summary: ${String(r.summary).slice(0, 200)}`);
  lines.push('');
  lines.push('**Advisory note**: This routing context is informational only. It does not constitute validated evidence and must not be used to promote Low Evidence to a higher confidence tier.');

  return lines.join('\n');
}

function buildDossierMarkdown({
  dossierId,
  dossierVersion,
  sessionId,
  question,
  dossierState,
  evidence = [],
  missingEvidence = [],
  reasoningSummary = '',
  timeBudget,
  completionState,
  domain,
  priorTurnsCount = 0,
  knowledgeSpace = {},
  preliminaryAnswerRequested = false,
  capabilityRouting = null,
  priorConversationContext = null,
}) {
  const { userContext, processStage, answerMode, confidence } = dossierState;
  const normalizedKnowledgeSpace = normalizeKnowledgeSpaceContext({
    ...knowledgeSpace,
    sessionId: knowledgeSpace.sessionId || sessionId,
  });
  const forbiddenClaims = [
    ...FORBIDDEN_CLAIM_TEXTS,
    ...(domain === 'redispatch' ? REDISPATCH_FORBIDDEN_CLAIMS : []),
  ];
  const hasValidatedEvidence = evidence.some((entry) => entry?.metadata?.evidenceQuality !== 'low');
  const requiredBehavior = buildRequiredAnswerBehavior(answerMode);
  if (!hasValidatedEvidence) {
    requiredBehavior.push('Ohne validierte Evidence keine Beispiele, Paragraphen, Behörden, Netzbetreiber, Fristen oder typischen Verfahren nennen.');
    if (preliminaryAnswerRequested && evidence.length > 0) {
      requiredBehavior.push('Der Nutzer verlangt ausdrücklich eine vorläufige Aussage trotz Low-Evidence: Formuliere nur eine klar gekennzeichnete, nicht belastbare Arbeitshypothese auf Basis der Known Evidence.');
      requiredBehavior.push('Keine Machbarkeitszusage, keine Netzanschlussbewertung und keine Handlungsempfehlung als gesichert darstellen.');
    } else {
      requiredBehavior.push('Nur benennen, welche Evidence fehlt, welche Rückfragen nötig sind und dass keine belastbare Bewertung möglich ist.');
    }
  }
  const recommendedStructure = !hasValidatedEvidence && preliminaryAnswerRequested && evidence.length > 0
    ? ['1. Vorläufige Arbeitshypothese deutlich als nicht belastbar kennzeichnen', '2. Low-Evidence-Basis nennen', '3. Fehlende validierte Evidence und nächste Rückfragen benennen']
    : !hasValidatedEvidence
    ? ['1. Kurz sagen, dass keine belastbare Evidence verfügbar ist', '2. Fehlende Datenpunkte benennen', '3. Gezielt um die nächsten Evidence-Unterlagen bitten']
    : buildRecommendedAnswerStructure(answerMode);
  const isPartial = completionState !== DOSSIER_COMPLETION_STATE.COMPLETED;

  const dossierLines = [
    '# CERNION ANSWER DOSSIER',
    '',
    '## Metadata',
    `- session_id: ${sessionId || 'unknown'}`,
    `- dossier_id: ${dossierId}`,
    `- dossier_version: ${dossierVersion || 1}`,
    `- process_stage: ${processStage}`,
    `- user_context: ${userContext}`,
    `- answer_mode: ${answerMode}`,
    `- confidence: ${confidence}`,
    `- time_budget_ms: ${timeBudget.totalBudgetMs}`,
    `- completion_state: ${completionState}`,
    `- preliminary_answer_requested: ${preliminaryAnswerRequested ? 'true' : 'false'}`,
    `- domain: ${domain || 'auto'}`,
    `- tenant_id: ${normalizedKnowledgeSpace.tenantId}`,
    `- requested_context_tenant_id: ${normalizedKnowledgeSpace.requestedTenantId || 'not_provided'}`,
    `- tenant_scope_status: ${normalizedKnowledgeSpace.tenantScopeStatus}`,
    `- conversation_id: ${normalizedKnowledgeSpace.conversationId || 'unknown'}`,
    `- channel: ${normalizedKnowledgeSpace.channel}`,
    `- surface: ${normalizedKnowledgeSpace.surface}`,
    '',
    '## Original User Prompt',
    question,
    '',
    '## Current Conversation State',
    `- Turns in session: ${priorTurnsCount}`,
    `- Process stage: ${processStage}`,
    `- User context: ${userContext}`,
    `- Knowledge space: tenant=${normalizedKnowledgeSpace.tenantId}, session=${sessionId || 'unknown'}, conversation=${normalizedKnowledgeSpace.conversationId || 'unknown'}`,
    `- Tenant scope: ${normalizedKnowledgeSpace.tenantScopeStatus}`,
    priorTurnsCount > 0
      ? '- This is a follow-up turn in an ongoing conversation.'
      : '- This is the first turn in this session.',
    '',
    buildPriorConversationSection(priorConversationContext),
    '',
    '## Required Answer Behavior',
    ...requiredBehavior.map((r) => `- ${r}`),
    '',
    '## Known Evidence',
    evidence.length > 0
      ? evidence.map((e, i) => `${i + 1}. **${e.source || 'Cernion'}**: ${e.value || ''}`).join('\n')
      : '_Keine Evidence verfügbar._',
    '',
    '## Missing Evidence',
    missingEvidence.length > 0
      ? missingEvidence.map((m, i) => `${i + 1}. ${m}`).join('\n')
      : '_Keine fehlende Evidence identifiziert._',
    '',
    '## Reasoning Summary',
    reasoningSummary || '_Keine Zusammenfassung verfügbar._',
    '',
    '## Forbidden Claims',
    ...forbiddenClaims.map((c) => `- ${c}`),
    '',
    '## Recommended Answer Structure',
    ...recommendedStructure.map((s) => `- ${s}`),
    '',
    '## Final Renderer Instruction',
    'Bitte beantworte die Frage des Nutzers ausschliesslich auf Basis dieses Cernion Answer Dossiers.',
    'Fuege keine Fakten, Gesetze, Quellen, Beispiele, Bewertungen oder Prozessentscheidungen hinzu, die nicht im Dossier stehen.',
    'Bewahre Unsicherheit, Required Answer Behavior und Forbidden Claims.',
    '',
    `Originalfrage des Nutzers:\n"${question}"`,
  ];

  if (capabilityRouting) {
    const rendIdx = dossierLines.indexOf('## Final Renderer Instruction');
    if (rendIdx !== -1) {
      dossierLines.splice(rendIdx, 0, buildCapabilityRoutingSection(capabilityRouting), '');
    }
  }

  if (isPartial) {
    dossierLines.push('');
    dossierLines.push('## Renderer Notes');
    if (completionState === DOSSIER_COMPLETION_STATE.ASYNC_PENDING) {
      dossierLines.push('Dieses Dossier ist vorläufig. Backend-Evidence-Jobs sind noch ausstehend.');
    } else {
      dossierLines.push('Dieses Dossier ist vorläufig. Einige Evidence-Phasen haben das Zeitbudget überschritten.');
    }
    dossierLines.push('Bitte keine abschließende Antwort formulieren. Weise auf eine mögliche Aktualisierung hin.');
  }

  return buildRendererPackageMarkdown({
    rendererSystemHint: buildRendererSystemHint(),
    question,
    dossierMarkdown: dossierLines.join('\n'),
  });
}

function buildRendererSystemHint() {
  return 'Du bist nur der Prosa-Renderer. Nutze ausschliesslich dieses Cernion Answer Dossier. Fuege keine Fakten, Gesetze, Quellen, Beispiele, Bewertungen oder Prozessentscheidungen hinzu, die nicht im Dossier stehen. Bewahre Unsicherheit, offene Fragen, Required Answer Behavior und Forbidden Claims. Wenn das Dossier eine Rueckfrage verlangt, formuliere diese Rueckfrage.';
}

function buildRendererPackageMarkdown({ rendererSystemHint, question, dossierMarkdown }) {
  return [
    '# CERNION RENDERER PACKAGE',
    '',
    '## Systemhinweis',
    rendererSystemHint,
    '',
    '## Aufgabe',
    'Formuliere eine Antwort auf die Originalfrage des Nutzers ausschliesslich aus dem nachfolgenden Dossier.',
    'Wenn Evidence fehlt, der Nutzerkontext unklar ist oder Backend-Jobs noch ausstehen, stelle eine Rueckfrage oder formuliere die Antwort als vorlaeufig.',
    'Ergaenze keine eigenen Gesetze, Quellen, Beispiele, Bewertungen oder Prozessentscheidungen.',
    '',
    'Originalfrage des Nutzers:',
    `"${question}"`,
    '',
    '## Cernion Answer Dossier',
    dossierMarkdown,
  ].join('\n');
}

function buildReasoningSummary({ userContext, answerMode, evidenceCount, domain }) {
  const parts = [];
  if (evidenceCount > 0) {
    parts.push(`${evidenceCount} Evidence-Einheit(en) aus dem Cernion-Kontext gefunden.`);
  } else {
    parts.push('Keine direkten Evidence-Treffer für diese Frage gefunden.');
  }
  if (domain && domain !== 'auto') {
    parts.push(`Routing-Domäne: ${domain}.`);
  }
  const summaryByContext = {
    [DOSSIER_USER_CONTEXT.UNKNOWN]: 'Nutzerkontext nicht eindeutig erkannt — Rückfrage empfohlen.',
    [DOSSIER_USER_CONTEXT.MAYOR]: 'Bürgermeister-Kontext erkannt — kompakte Entscheidungsgrundlage formulieren.',
    [DOSSIER_USER_CONTEXT.MANAGEMENT]: 'Management-Kontext erkannt — kompakte Entscheidungsgrundlage formulieren.',
    [DOSSIER_USER_CONTEXT.TARGET_GRID_PLANNING]: 'Zielnetzplanung erkannt — Evidence-Sammlung läuft, finale Planungsaussagen vermeiden.',
    [DOSSIER_USER_CONTEXT.REGULATORY]: 'Regulatorischer Kontext erkannt — Compliance-Prüfpunkte zusammenstellen.',
    [DOSSIER_USER_CONTEXT.TECHNICAL_OPERATOR]: 'Technischer Betrieb erkannt — operative Datenlage und Messwerte prüfen.',
    [DOSSIER_USER_CONTEXT.PROCESS_ACTION]: 'Prozessaktion erkannt — Prepare Intent formulieren, keine direkte Ausführung.',
  };
  if (summaryByContext[userContext]) {
    parts.push(summaryByContext[userContext]);
  }
  return parts.join(' ');
}

function buildFollowUpMetadata({ completionState, sessionId, dossierId, pollAfterMs = 10000 }) {
  if (completionState === DOSSIER_COMPLETION_STATE.COMPLETED) return null;
  return {
    available: true,
    pollAfterMs,
    reason: completionState === DOSSIER_COMPLETION_STATE.ASYNC_PENDING
      ? 'backend_jobs_pending'
      : 'partial_evidence',
    query: {
      sessionId,
      parentDossierId: dossierId,
      mode: 'answer_dossier_followup',
    },
  };
}

function generateDossierId() {
  return uuidv4();
}

module.exports = {
  DOSSIER_USER_CONTEXT,
  DOSSIER_PROCESS_STAGE,
  DOSSIER_ANSWER_MODE,
  DOSSIER_CONFIDENCE,
  DOSSIER_COMPLETION_STATE,
  FORBIDDEN_CLAIM_TEXTS,
  USER_CONTEXT_TO_ANSWER_MODE,
  computeTimeBudget,
  classifyDossierContext,
  buildCapabilityRoutingSection,
  buildDossierMarkdown,
  buildPriorConversationSection,
  buildRendererSystemHint,
  buildRendererPackageMarkdown,
  normalizeKnowledgeSpaceContext,
  buildReasoningSummary,
  buildFollowUpMetadata,
  generateDossierId,
};
