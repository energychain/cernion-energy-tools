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
    return {
      totalBudgetMs: safe,
      factCollectionMs: 14000,
      thinkingMs: 9000,
      compilationMs: 5000,
      safetyReserveMs: 2000,
    };
  } else if (safe >= 12000) {
    return {
      totalBudgetMs: safe,
      factCollectionMs: Math.floor(safe * 0.48),
      thinkingMs: Math.floor(safe * 0.3),
      compilationMs: 3000,
      safetyReserveMs: Math.max(
        500,
        safe - Math.floor(safe * 0.48) - Math.floor(safe * 0.3) - 3000
      ),
    };
  } else {
    return {
      totalBudgetMs: safe,
      factCollectionMs: 0,
      thinkingMs: 0,
      compilationMs: safe - 1000,
      safetyReserveMs: 1000,
    };
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

function classifyDossierContext({
  question = '',
  priorUserContext = null,
  priorProcessStage = null,
  domain = 'auto',
  evidenceCount = 0,
}) {
  // Preserve known prior userContext; re-detect only when unknown
  let userContext =
    priorUserContext && priorUserContext !== DOSSIER_USER_CONTEXT.UNKNOWN
      ? priorUserContext
      : DOSSIER_USER_CONTEXT.UNKNOWN;

  if (userContext === DOSSIER_USER_CONTEXT.UNKNOWN) {
    const q = question.toLowerCase();
    if (
      /\b(?:ev|e-?auto|elektroauto|wallbox|laden|ladezeit|ladung|charging)\b/i.test(q) &&
      /(?:\b(?:co2|kohlenstoff|emission|emissions|grünstrom|gruenstrom|gsi|strommix|klima)\b|co₂)/i.test(
        q
      )
    ) {
      userContext = DOSSIER_USER_CONTEXT.TECHNICAL_OPERATOR;
    } else if (/zielnetz|netzplanung|netzentwicklung|netzausbau|trassen/.test(q)) {
      userContext = DOSSIER_USER_CONTEXT.TARGET_GRID_PLANNING;
    } else if (
      /projektentwickl|machbarkeit|standortmachbarkeit|netzanschluss|anschlussleistung|rechenzentrum|data\s*center|grossverbrauch|großverbrauch|10\s*mw/.test(
        q
      )
    ) {
      userContext = DOSSIER_USER_CONTEXT.TECHNICAL_OPERATOR;
    } else if (/bürgermeister|buergermeister|mayor/.test(q)) {
      userContext = DOSSIER_USER_CONTEXT.MAYOR;
    } else if (/management|vorstand|geschäftsführ|entscheid|überblick/.test(q)) {
      userContext = DOSSIER_USER_CONTEXT.MANAGEMENT;
    } else if (/regulier|bundesnetzagentur|behörde|aufsicht|compliance|genehmigung/.test(q)) {
      userContext = DOSSIER_USER_CONTEXT.REGULATORY;
    } else if (
      /technisch|betrieb|wartung|messung|messwesen|messkonzept|mk10|mk40|schaltung|netzführung|dispatching|wärmepumpe|waermepumpe|speicher|pv[-\s]?anlage/.test(
        q
      )
    ) {
      userContext = DOSSIER_USER_CONTEXT.TECHNICAL_OPERATOR;
    } else if (
      /prozess starten|auslösen|durchführen|beauftrag|freigeben|abschicken|anmelden|einleiten/.test(
        q
      )
    ) {
      userContext = DOSSIER_USER_CONTEXT.PROCESS_ACTION;
    }
  }

  const answerMode =
    USER_CONTEXT_TO_ANSWER_MODE[userContext] || DOSSIER_ANSWER_MODE.CLARIFICATION_NEEDED;

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

function buildRequiredAnswerBehavior(
  answerMode,
  { finalMode = false, evidenceFirst = false } = {}
) {
  const rules = [
    'Keine fachlichen Fakten hinzufügen, die nicht im Dossier enthalten sind.',
    'Unsicherheit und fehlende Evidence explizit benennen.',
  ];
  if (answerMode === DOSSIER_ANSWER_MODE.CLARIFICATION_NEEDED) {
    if (finalMode) {
      rules.push(
        'Nutzerkontext ist unklar, aber der Nutzer verlangt eine finale Antwort ohne weitere Rückfrage — gib eine bestmögliche Einschätzung und benenne die Kontextunsicherheit als Einschränkung.'
      );
    } else if (evidenceFirst) {
      rules.push(
        'Vorhandene Evidence reicht für eine substantielle Antwort: Beantworte die Frage zuerst auf Basis der Evidence, benenne den unklaren Nutzerkontext erst danach als Einschränkung.'
      );
      rules.push(
        'Eine Rückfrage ist optional für eine genauere oder andere Antwort — sie darf die aktuelle Antwort nicht ersetzen oder blockieren.'
      );
    } else {
      rules.push(
        'Nutzerkontext ist unklar — eine gezielte Rückfrage formulieren statt einer abschließenden Antwort.'
      );
      rules.push('Keine finalen Planungs- oder Prozessaussagen ohne bekannten Kontext.');
    }
  } else if (answerMode === DOSSIER_ANSWER_MODE.MANAGEMENT_BRIEF) {
    rules.push('Kompakte, entscheidungsorientierte Antwort mit klarem Evidenzhinweis.');
    rules.push('Keine Detailtechnik — Fokus auf Handlungsrelevanz und offene Risiken.');
  } else if (answerMode === DOSSIER_ANSWER_MODE.EVIDENCE_COLLECTION) {
    if (finalMode) {
      rules.push(
        'Trotz unvollständiger Evidence eine bestmögliche finale Einschätzung geben; Evidence-Lücken klar als Einschränkung/Annahme benennen statt eine Rückfrage zu stellen.'
      );
    } else if (evidenceFirst) {
      rules.push(
        'Vorhandene Evidence reicht für eine substantielle Antwort: Beantworte die Frage zuerst auf Basis der vorhandenen Evidence.'
      );
      rules.push(
        'Fehlende zusätzliche Datenpunkte erst nach der Antwort als optionale Vertiefung benennen, nicht als Voraussetzung für die Antwort.'
      );
    } else {
      rules.push('Keine finalen Planungsaussagen, solange Evidence unvollständig ist.');
    }
    rules.push('Hypothesen und fehlende Datenpunkte explizit nennen.');
    rules.push(
      finalMode
        ? 'Evidence-Flow knapp einordnen und mit der finalen Einschätzung abschließen.'
        : evidenceFirst
          ? 'Evidence-Flow knapp einordnen und die Antwort darauf stützen.'
          : 'Evidence-Flow beschreiben, nicht abschließend bewerten.'
    );
  } else if (answerMode === DOSSIER_ANSWER_MODE.PROCESS_CHECK) {
    rules.push('Regulatorische Anforderungen und Compliance-Stand benennen.');
    rules.push('Keine verbindliche Rechtsauskunft — nur Prüfpunkte und Handlungshinweise.');
  } else if (answerMode === DOSSIER_ANSWER_MODE.PREPARE_INTENT) {
    rules.push(
      'Nur Prepare Intent oder Draft formulieren — keine direkte Ausführung, Bestätigung oder Freigabe.'
    );
    rules.push('Fehlende Voraussetzungen für die Aktion explizit benennen.');
  } else if (answerMode === DOSSIER_ANSWER_MODE.PARTIAL_ASYNC) {
    rules.push('Dieses Dossier ist vorläufig — einige Evidence-Phasen sind noch ausstehend.');
    rules.push('Keine abschließende Antwort formulieren. Auf Aktualisierung hinweisen.');
  }
  return rules;
}

function buildRecommendedAnswerStructure(
  answerMode,
  { finalMode = false, evidenceFirst = false } = {}
) {
  if (answerMode === DOSSIER_ANSWER_MODE.CLARIFICATION_NEEDED) {
    if (finalMode)
      return [
        '1. Bestmögliche finale Einschätzung trotz unklarem Kontext',
        '2. Kontext-Einschränkung als Caveat benennen',
      ];
    if (evidenceFirst)
      return [
        '1. Substantielle Antwort auf Basis der vorhandenen Evidence',
        '2. Unklarer Nutzerkontext als Einschränkung benennen',
        '3. Optionale Rückfrage für eine genauere oder andere Antwort',
      ];
    return ['1. Kurzer Kontextvorbehalt (1–2 Sätze)', '2. Gezielte Rückfrage an den Nutzer'];
  } else if (answerMode === DOSSIER_ANSWER_MODE.MANAGEMENT_BRIEF) {
    return [
      '1. Kernantwort (1–3 Sätze)',
      '2. Wichtigster Evidenzhinweis',
      '3. Offene Risiken oder nächster Schritt',
    ];
  } else if (answerMode === DOSSIER_ANSWER_MODE.EVIDENCE_COLLECTION) {
    if (evidenceFirst)
      return [
        '1. Substantielle Antwort auf Basis der vorhandenen Evidence',
        '2. Fehlende Datenpunkte als optionale Vertiefung benennen',
        '3. Nächste Sammelschritte (optional)',
      ];
    return [
      '1. Aktueller Evidenzstand',
      '2. Fehlende Datenpunkte oder Quellen',
      '3. Nächste Sammelschritte',
    ];
  } else if (answerMode === DOSSIER_ANSWER_MODE.PROCESS_CHECK) {
    return [
      '1. Regulatorischer Prüfstand',
      '2. Compliance-Lücken',
      '3. Empfohlene nächste Schritte',
    ];
  } else if (answerMode === DOSSIER_ANSWER_MODE.PREPARE_INTENT) {
    return [
      '1. Beschreibung der gewünschten Aktion',
      '2. Fehlende Voraussetzungen',
      '3. Prepare-Intent-Formulierung (kein Execute)',
    ];
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
    ? context.knownEvidence
        .map((entry) => compactDossierText(entry, 240))
        .filter(Boolean)
        .slice(0, 5)
    : [];
  const missingEvidence = Array.isArray(context.missingEvidence)
    ? context.missingEvidence
        .map((entry) => compactDossierText(entry, 240))
        .filter(Boolean)
        .slice(0, 5)
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
      const state = [turn.userContext, turn.processStage, turn.answerMode]
        .filter(Boolean)
        .join(' / ');
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
    const elapsed =
      capabilityRouting?.elapsedMs != null ? `${capabilityRouting.elapsedMs}ms` : 'n/a';
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
  lines.push(
    '**Advisory note**: This routing context is informational only. It does not constitute validated evidence and must not be used to promote Low Evidence to a higher confidence tier.'
  );

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
  finalMode = false,
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
  const requiredBehavior = buildRequiredAnswerBehavior(answerMode, {
    finalMode,
    evidenceFirst: hasValidatedEvidence,
  });
  if (!hasValidatedEvidence) {
    requiredBehavior.push(
      'Ohne validierte Evidence keine Beispiele, Paragraphen, Behörden, Netzbetreiber, Fristen oder typischen Verfahren nennen.'
    );
    if (finalMode) {
      requiredBehavior.push(
        'Der Nutzer verlangt eine finale Antwort ohne weitere Rückfrage: Formuliere eine bestmögliche Einschätzung auf Basis der vorhandenen (ggf. Low-Evidence) Informationen und benenne die Evidence-Lücken klar als Einschränkung/Annahme.'
      );
      requiredBehavior.push(
        'Keine Machbarkeitszusage, keine Netzanschlussbewertung und keine Handlungsempfehlung als gesichert darstellen.'
      );
    } else if (preliminaryAnswerRequested && evidence.length > 0) {
      requiredBehavior.push(
        'Der Nutzer verlangt ausdrücklich eine vorläufige Aussage trotz Low-Evidence: Formuliere nur eine klar gekennzeichnete, nicht belastbare Arbeitshypothese auf Basis der Known Evidence.'
      );
      requiredBehavior.push(
        'Keine Machbarkeitszusage, keine Netzanschlussbewertung und keine Handlungsempfehlung als gesichert darstellen.'
      );
    } else {
      requiredBehavior.push(
        'Nur benennen, welche Evidence fehlt, welche Rückfragen nötig sind und dass keine belastbare Bewertung möglich ist.'
      );
    }
  }
  const recommendedStructure =
    finalMode && !hasValidatedEvidence
      ? [
          '1. Bestmögliche finale Einschätzung auf Basis der Low-Evidence/Annahmen',
          '2. Evidence-Lücken klar als Einschränkung/Annahme benennen',
          '3. Keine Rückfrage formulieren — Antwort bewusst als eingeschränkt kennzeichnen',
        ]
      : !hasValidatedEvidence && preliminaryAnswerRequested && evidence.length > 0
        ? [
            '1. Vorläufige Arbeitshypothese deutlich als nicht belastbar kennzeichnen',
            '2. Low-Evidence-Basis nennen',
            '3. Fehlende validierte Evidence und nächste Rückfragen benennen',
          ]
        : !hasValidatedEvidence
          ? [
              '1. Kurz sagen, dass keine belastbare Evidence verfügbar ist',
              '2. Fehlende Datenpunkte benennen',
              '3. Gezielt um die nächsten Evidence-Unterlagen bitten',
            ]
          : buildRecommendedAnswerStructure(answerMode, {
              finalMode,
              evidenceFirst: hasValidatedEvidence,
            });
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
    `- final_dossier_mode: ${finalMode ? 'true' : 'false'}`,
    `- domain: ${domain || 'auto'}`,
    `- tenant_id: ${normalizedKnowledgeSpace.tenantId}`,
    `- requested_context_tenant_id: ${normalizedKnowledgeSpace.requestedTenantId || 'not_provided'}`,
    `- tenant_scope_status: ${normalizedKnowledgeSpace.tenantScopeStatus}`,
    `- conversation_id: ${normalizedKnowledgeSpace.conversationId || 'unknown'}`,
    `- channel: ${normalizedKnowledgeSpace.channel}`,
    `- surface: ${normalizedKnowledgeSpace.surface}`,
    '',
    '## Response Policy',
    'Evidence-first: Wenn relevante Evidence im Dossier vorhanden ist, beantworte die Frage zuerst auf dieser Basis.',
    'Fehlende zusätzliche Evidence, unklarer Kontext oder Rückfragen folgen danach als Ergänzung — sie ersetzen oder blockieren die Antwort nicht.',
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
      ? evidence
          .map((e, i) => `${i + 1}. **${e.source || 'Cernion'}**: ${e.value || ''}`)
          .join('\n')
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
      dossierLines.push(
        'Dieses Dossier ist vorläufig. Backend-Evidence-Jobs sind noch ausstehend.'
      );
    } else {
      dossierLines.push(
        'Dieses Dossier ist vorläufig. Einige Evidence-Phasen haben das Zeitbudget überschritten.'
      );
    }
    dossierLines.push(
      'Bitte keine abschließende Antwort formulieren. Weise auf eine mögliche Aktualisierung hin.'
    );
  }

  return buildRendererPackageMarkdown({
    rendererSystemHint: buildRendererSystemHint({ finalMode }),
    question,
    dossierMarkdown: dossierLines.join('\n'),
    finalMode,
  });
}

function buildRendererSystemHint({ finalMode = false } = {}) {
  if (finalMode) {
    return 'Du bist nur der Prosa-Renderer. Nutze ausschliesslich dieses Cernion Answer Dossier. Fuege keine Fakten, Gesetze, Quellen, Beispiele, Bewertungen oder Prozessentscheidungen hinzu, die nicht im Dossier stehen. Formuliere eine abschliessende Antwort. Benenne Unsicherheit, Annahmen und fehlende Evidence als Einschraenkungen, aber stelle KEINE Rueckfrage an den Nutzer.';
  }
  return 'Du bist nur der Prosa-Renderer. Nutze ausschliesslich dieses Cernion Answer Dossier. Fuege keine Fakten, Gesetze, Quellen, Beispiele, Bewertungen oder Prozessentscheidungen hinzu, die nicht im Dossier stehen. Evidence-first: Wenn das Dossier relevante Evidence enthaelt, beantworte die Frage zuerst auf dieser Basis. Bewahre Unsicherheit, offene Fragen, Required Answer Behavior und Forbidden Claims. Wenn das Dossier eine Rueckfrage verlangt, formuliere diese Rueckfrage erst nach der Antwort und nur als optionale Ergaenzung.';
}

function buildRendererPackageMarkdown({
  rendererSystemHint,
  question,
  dossierMarkdown,
  finalMode = false,
}) {
  return [
    '# CERNION RENDERER PACKAGE',
    '',
    '## Systemhinweis',
    rendererSystemHint,
    '',
    '## Aufgabe',
    finalMode
      ? 'Formuliere eine abschliessende Antwort auf die Originalfrage des Nutzers ausschliesslich aus dem nachfolgenden Dossier.'
      : 'Formuliere eine Antwort auf die Originalfrage des Nutzers ausschliesslich aus dem nachfolgenden Dossier. Wenn relevante Evidence vorhanden ist, beantworte die Frage zuerst auf dieser Basis.',
    finalMode
      ? 'Fehlende Evidence oder ein unklarer Nutzerkontext werden als Einschraenkung/Annahme benannt — stelle KEINE Rueckfrage.'
      : 'Fehlende Evidence, unklarer Nutzerkontext oder ausstehende Backend-Jobs folgen danach als Einschraenkung oder optionale Rueckfrage — sie ersetzen oder blockieren die Antwort nicht, sofern relevante Evidence vorhanden ist. Ohne verwertbare Evidence stelle eine Rueckfrage oder formuliere die Antwort als vorlaeufig.',
    'Ergaenze keine eigenen Gesetze, Quellen, Beispiele, Bewertungen oder Prozessentscheidungen.',
    '',
    'Originalfrage des Nutzers:',
    `"${question}"`,
    '',
    '## Cernion Answer Dossier',
    dossierMarkdown,
  ].join('\n');
}

function buildReasoningSummary({
  userContext,
  answerMode,
  evidenceCount,
  domain,
  finalMode = false,
  evidenceFirst = false,
}) {
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
    [DOSSIER_USER_CONTEXT.UNKNOWN]: finalMode
      ? 'Nutzerkontext nicht eindeutig erkannt — finale Einschätzung trotzdem mit Einschränkung formuliert.'
      : evidenceFirst
        ? 'Nutzerkontext nicht eindeutig erkannt — Antwort zuerst auf Basis der Evidence, Rückfrage nur optional.'
        : 'Nutzerkontext nicht eindeutig erkannt — Rückfrage empfohlen.',
    [DOSSIER_USER_CONTEXT.MAYOR]:
      'Bürgermeister-Kontext erkannt — kompakte Entscheidungsgrundlage formulieren.',
    [DOSSIER_USER_CONTEXT.MANAGEMENT]:
      'Management-Kontext erkannt — kompakte Entscheidungsgrundlage formulieren.',
    [DOSSIER_USER_CONTEXT.TARGET_GRID_PLANNING]: finalMode
      ? 'Zielnetzplanung erkannt — finale Einschätzung trotz laufender Evidence-Sammlung formuliert, Lücken benannt.'
      : evidenceFirst
        ? 'Zielnetzplanung erkannt — vorhandene Evidence reicht für eine substantielle Antwort, weitere Sammlung optional.'
        : 'Zielnetzplanung erkannt — Evidence-Sammlung läuft, finale Planungsaussagen vermeiden.',
    [DOSSIER_USER_CONTEXT.REGULATORY]:
      'Regulatorischer Kontext erkannt — Compliance-Prüfpunkte zusammenstellen.',
    [DOSSIER_USER_CONTEXT.TECHNICAL_OPERATOR]:
      'Technischer Betrieb erkannt — operative Datenlage und Messwerte prüfen.',
    [DOSSIER_USER_CONTEXT.PROCESS_ACTION]:
      'Prozessaktion erkannt — Prepare Intent formulieren, keine direkte Ausführung.',
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
    reason:
      completionState === DOSSIER_COMPLETION_STATE.ASYNC_PENDING
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

/**
 * Single source of truth for whether the dossier's instructions actually force a substantive,
 * evidence-derived answer rather than a defensive non-answer. Mirrors the exact conditions that
 * select the answer-first branches in buildDossierMarkdown's recommendedStructure, so the signal
 * can never drift from the generated Required Answer Behavior / Recommended Answer Structure text.
 */
function resolveDossierSubstantiveAnswer({
  hasValidatedEvidence = false,
  finalMode = false,
  preliminaryAnswerRequested = false,
  evidenceCount = 0,
} = {}) {
  return (
    Boolean(hasValidatedEvidence) ||
    Boolean(finalMode) ||
    (Boolean(preliminaryAnswerRequested) && evidenceCount > 0)
  );
}

const DOSSIER_CONTRACT = Object.freeze({
  RICH: 'rich',
  SLIM: 'slim',
});

/**
 * Decides the effective dossier contract (#242). Default stays 'rich' — today's full
 * governance/policy package — unless the caller explicitly opts into 'slim'. Process-action
 * and not-yet-complete dossiers are routed back to 'rich' regardless of the request: a slim,
 * answer-dense payload is the wrong shape when the answer is itself a consequential process
 * step, or when backend evidence collection genuinely hasn't finished yet.
 */
function resolveDossierContract({
  requestedContract = DOSSIER_CONTRACT.RICH,
  answerMode,
  completionState,
} = {}) {
  if (requestedContract !== DOSSIER_CONTRACT.SLIM) {
    return { contract: DOSSIER_CONTRACT.RICH, overridden: false, reason: null };
  }
  if (answerMode === DOSSIER_ANSWER_MODE.PREPARE_INTENT) {
    return { contract: DOSSIER_CONTRACT.RICH, overridden: true, reason: 'process_risk' };
  }
  if (completionState && completionState !== DOSSIER_COMPLETION_STATE.COMPLETED) {
    return { contract: DOSSIER_CONTRACT.RICH, overridden: true, reason: 'incomplete_evidence' };
  }
  return { contract: DOSSIER_CONTRACT.SLIM, overridden: false, reason: null };
}

function describeDossierContract({ contract, overridden, reason }) {
  if (!overridden) return `${contract}_v1`;
  return `${contract}_v1 (slim_requested_overridden_${reason})`;
}

/**
 * Breaks a "Label: Value · Label2: Value2" evidence string (the formatting convention every
 * hydration rule already uses) into individual answer-ready facts, instead of repeating the
 * whole concatenated line. Domain-agnostic — relies only on that existing separator, not on
 * which capability produced the value.
 */
function splitDossierEvidenceFacts(value = '') {
  return String(value || '')
    .split(' · ')
    .map((part) => part.trim())
    .filter(Boolean);
}

function buildSlimEvidenceSection(evidence = []) {
  if (evidence.length === 0) {
    return ['## Evidence', '_Keine Evidence verfügbar._'];
  }
  const lines = ['## Evidence'];
  evidence.forEach((entry, index) => {
    const source = entry?.source || 'Cernion';
    const facts = splitDossierEvidenceFacts(entry?.value);
    if (facts.length > 1) {
      lines.push(`${index + 1}. **${source}**`);
      facts.forEach((fact) => lines.push(`   - ${fact}`));
    } else {
      lines.push(`${index + 1}. **${source}**: ${entry?.value || ''}`);
    }
  });
  return lines;
}

function buildSlimAnswerConstraintsSection({ domain, blockingConstraints = [] } = {}) {
  const lines = [
    '## Answer Constraints',
    '- Nur Fakten aus Evidence und Reasoning verwenden — keine zusätzlichen Annahmen, Gesetze, Fristen oder Verfahren ergänzen.',
  ];
  if (domain === 'redispatch') {
    REDISPATCH_FORBIDDEN_CLAIMS.forEach((claim) => lines.push(`- ${claim}`));
  }
  blockingConstraints.forEach((constraint) => lines.push(`- ${constraint}`));
  return lines;
}

function buildSlimFollowUpSection(possibleFollowUp = []) {
  if (!Array.isArray(possibleFollowUp) || possibleFollowUp.length === 0) {
    return [
      '## Possible Follow-Up',
      '_Keine zusätzlichen Rückfragen — die Antwort oben ist vollständig auf Basis der Evidence._',
    ];
  }
  const lines = ['## Possible Follow-Up'];
  possibleFollowUp.forEach(({ question, enablesDossierAddition }) => {
    lines.push(`- ${question} → ${enablesDossierAddition}`);
  });
  return lines;
}

/**
 * Slim answer-payload dossier (#242): maximizes answer-relevant facts, reasoning, and evidence
 * per token instead of the full rich governance/policy package. Returned as a standalone
 * markdown document — no outer "CERNION RENDERER PACKAGE" wrapper — since its own Renderer
 * Instruction section already covers what the wrapper's Systemhinweis/Aufgabe did.
 */
function buildSlimDossierMarkdown({
  question,
  dossierState,
  evidence = [],
  reasoningSummary = '',
  domain,
  possibleFollowUp = [],
  blockingConstraints = [],
}) {
  const { userContext, answerMode, confidence } = dossierState;
  const lines = [
    '# CERNION ANSWER DOSSIER (SLIM)',
    '',
    '## Question',
    question,
    '',
    '## Consulting Interpretation',
    `- Nutzerkontext: ${userContext}`,
    `- Antwortmodus: ${answerMode}`,
    `- Konfidenz: ${confidence} (${evidence.length} Evidence-Einheit(en))`,
    '- Diese Antwort stützt sich ausschließlich auf die unten gelistete Evidence; weitere Evidence-Typen wurden nicht angefordert, da sie für diese konkrete Frage nicht erforderlich sind.',
    '',
    '## Reasoning',
    reasoningSummary || '_Keine Zusammenfassung verfügbar._',
    '',
    ...buildSlimEvidenceSection(evidence),
    '',
    ...buildSlimAnswerConstraintsSection({ domain, blockingConstraints }),
    '',
    ...buildSlimFollowUpSection(possibleFollowUp),
    '',
    '## Renderer Instruction',
    'Beantworte die Frage ausschließlich auf Basis von Evidence und Reasoning oben. Antworte zuerst substantiell aus der Evidence; nenne Answer Constraints danach als Einschränkung.',
    'Stelle Rückfragen aus "Possible Follow-Up" nur, wenn sie für eine bessere Antwort hilfreich sind — sie sind optional und blockieren diese Antwort nicht.',
    'Füge keine Fakten, Gesetze, Quellen oder Bewertungen hinzu, die nicht oben stehen.',
  ];
  return lines.join('\n');
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
  resolveDossierSubstantiveAnswer,
  DOSSIER_CONTRACT,
  resolveDossierContract,
  describeDossierContract,
  buildSlimDossierMarkdown,
};
