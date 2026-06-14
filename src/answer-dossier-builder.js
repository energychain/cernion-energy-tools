'use strict';

const { v4: uuidv4 } = require('uuid'); // already a dependency

const DOSSIER_USER_CONTEXT = Object.freeze({
  UNKNOWN: 'unknown',
  MANAGEMENT: 'management',
  TARGET_GRID_PLANNING: 'target_grid_planning',
  PROCESS_ACTION: 'process_action',
});

const DOSSIER_PROCESS_STAGE = Object.freeze({
  INITIAL: 'initial',
  EVIDENCE_COLLECTION: 'evidence_collection',
  ACTION_REQUESTED: 'action_requested',
  COMPLETED: 'completed',
});

const DOSSIER_ANSWER_MODE = Object.freeze({
  CLARIFICATION_NEEDED: 'clarification_needed',
  MANAGEMENT_BRIEF: 'management_brief',
  EVIDENCE_COLLECTION: 'evidence_collection',
  PREPARE_INTENT: 'prepare_intent',
});

const DOSSIER_CONFIDENCE = Object.freeze({
  LOW: 'low',
  MEDIUM: 'medium',
  HIGH: 'high',
});

const DOSSIER_COMPLETION_STATE = Object.freeze({
  COMPLETED: 'completed',
  PARTIAL: 'partial',
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

function classifyDossierContext({ question = '', priorUserContext = null, priorProcessStage = null, domain = 'auto', evidenceCount = 0 }) {
  // userContext — detect from question, preserve prior if already known
  let userContext = priorUserContext && priorUserContext !== DOSSIER_USER_CONTEXT.UNKNOWN
    ? priorUserContext
    : DOSSIER_USER_CONTEXT.UNKNOWN;

  if (userContext === DOSSIER_USER_CONTEXT.UNKNOWN) {
    const q = question.toLowerCase();
    if (/zielnetz|netzplanung|netzentwicklung|netzausbau|trassen/.test(q)) {
      userContext = DOSSIER_USER_CONTEXT.TARGET_GRID_PLANNING;
    } else if (/bürgermeister|management|vorstand|geschäftsführ|entscheid|überblick/.test(q)) {
      userContext = DOSSIER_USER_CONTEXT.MANAGEMENT;
    } else if (/prozess starten|auslösen|durchführen|beauftrag|freigeben|abschicken|anmelden|einleiten/.test(q)) {
      userContext = DOSSIER_USER_CONTEXT.PROCESS_ACTION;
    }
  }

  // answerMode from userContext
  const answerModeMap = {
    [DOSSIER_USER_CONTEXT.UNKNOWN]: DOSSIER_ANSWER_MODE.CLARIFICATION_NEEDED,
    [DOSSIER_USER_CONTEXT.MANAGEMENT]: DOSSIER_ANSWER_MODE.MANAGEMENT_BRIEF,
    [DOSSIER_USER_CONTEXT.TARGET_GRID_PLANNING]: DOSSIER_ANSWER_MODE.EVIDENCE_COLLECTION,
    [DOSSIER_USER_CONTEXT.PROCESS_ACTION]: DOSSIER_ANSWER_MODE.PREPARE_INTENT,
  };
  const answerMode = answerModeMap[userContext];

  // processStage
  let processStage;
  if (userContext === DOSSIER_USER_CONTEXT.PROCESS_ACTION) {
    processStage = DOSSIER_PROCESS_STAGE.ACTION_REQUESTED;
  } else if (evidenceCount > 0 || (priorProcessStage && priorProcessStage !== DOSSIER_PROCESS_STAGE.INITIAL)) {
    processStage = DOSSIER_PROCESS_STAGE.EVIDENCE_COLLECTION;
  } else {
    processStage = DOSSIER_PROCESS_STAGE.INITIAL;
  }

  // confidence
  let confidence;
  if (evidenceCount >= 3) confidence = DOSSIER_CONFIDENCE.HIGH;
  else if (evidenceCount >= 1) confidence = DOSSIER_CONFIDENCE.MEDIUM;
  else confidence = DOSSIER_CONFIDENCE.LOW;

  return { userContext, processStage, answerMode, confidence };
}

function buildRequiredAnswerBehavior(answerMode, userContext) {
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
  } else if (answerMode === DOSSIER_ANSWER_MODE.PREPARE_INTENT) {
    rules.push('Nur Prepare Intent oder Draft formulieren — keine direkte Ausführung, Bestätigung oder Freigabe.');
    rules.push('Fehlende Voraussetzungen für die Aktion explizit benennen.');
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
  } else if (answerMode === DOSSIER_ANSWER_MODE.PREPARE_INTENT) {
    return ['1. Beschreibung der gewünschten Aktion', '2. Fehlende Voraussetzungen', '3. Prepare-Intent-Formulierung (kein Execute)'];
  }
  return ['1. Antwort auf Basis des Dossiers', '2. Unsicherheiten benennen'];
}

function buildDossierMarkdown({
  dossierId,
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
}) {
  const { userContext, processStage, answerMode, confidence } = dossierState;
  const forbiddenClaims = [
    ...FORBIDDEN_CLAIM_TEXTS,
    ...(domain === 'redispatch' ? REDISPATCH_FORBIDDEN_CLAIMS : []),
  ];
  const requiredBehavior = buildRequiredAnswerBehavior(answerMode, userContext);
  const recommendedStructure = buildRecommendedAnswerStructure(answerMode);

  const lines = [
    '# CERNION ANSWER DOSSIER',
    '',
    '## Metadata',
    `- session_id: ${sessionId || 'unknown'}`,
    `- dossier_id: ${dossierId}`,
    `- process_stage: ${processStage}`,
    `- user_context: ${userContext}`,
    `- answer_mode: ${answerMode}`,
    `- confidence: ${confidence}`,
    `- time_budget_ms: ${timeBudget.totalBudgetMs}`,
    `- completion_state: ${completionState}`,
    `- domain: ${domain || 'auto'}`,
    '',
    '## Original User Prompt',
    question,
    '',
    '## Current Conversation State',
    `- Turns in session: ${priorTurnsCount}`,
    `- Process stage: ${processStage}`,
    `- User context: ${userContext}`,
    priorTurnsCount > 0
      ? `- This is a follow-up turn in an ongoing conversation.`
      : `- This is the first turn in this session.`,
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
    'Fuege keine Fakten, Quellen, Bewertungen oder Prozessentscheidungen hinzu.',
    'Bewahre Unsicherheit, Required Answer Behavior und Forbidden Claims.',
    '',
    `Originalfrage des Nutzers:\n"${question}"`,
  ];

  if (completionState === DOSSIER_COMPLETION_STATE.PARTIAL) {
    lines.push('');
    lines.push('## Renderer Notes');
    lines.push('Dieses Dossier ist vorläufig. Einige Evidence-Phasen haben das Zeitbudget überschritten.');
    lines.push('Bitte keine abschließende Antwort formulieren. Weise auf eine mögliche Aktualisierung hin.');
  }

  return lines.join('\n');
}

function buildRendererSystemHint(channel) {
  return 'Du bist nur der Prosa-Renderer. Nutze ausschliesslich das Cernion Answer Dossier. Fuege keine Fakten, Quellen, Bewertungen oder Prozessentscheidungen hinzu. Bewahre Unsicherheit, offene Fragen, Required Answer Behavior und Forbidden Claims. Wenn das Dossier eine Rueckfrage verlangt, formuliere diese Rueckfrage.';
}

function buildReasoningSummary({ userContext, answerMode, evidenceCount, domain, question }) {
  const parts = [];
  if (evidenceCount > 0) {
    parts.push(`${evidenceCount} Evidence-Einheit(en) aus dem Cernion-Kontext gefunden.`);
  } else {
    parts.push('Keine direkten Evidence-Treffer für diese Frage gefunden.');
  }
  if (domain && domain !== 'auto') {
    parts.push(`Routing-Domäne: ${domain}.`);
  }
  if (userContext === DOSSIER_USER_CONTEXT.UNKNOWN) {
    parts.push('Nutzerkontext nicht eindeutig erkannt — Rückfrage empfohlen.');
  } else if (userContext === DOSSIER_USER_CONTEXT.TARGET_GRID_PLANNING) {
    parts.push('Zielnetzplanung erkannt — Evidence-Sammlung läuft, finale Planungsaussagen vermeiden.');
  } else if (userContext === DOSSIER_USER_CONTEXT.MANAGEMENT) {
    parts.push('Management-Kontext erkannt — kompakte Entscheidungsgrundlage formulieren.');
  } else if (userContext === DOSSIER_USER_CONTEXT.PROCESS_ACTION) {
    parts.push('Prozessaktion erkannt — Prepare Intent formulieren, keine direkte Ausführung.');
  }
  return parts.join(' ');
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
  computeTimeBudget,
  classifyDossierContext,
  buildDossierMarkdown,
  buildRendererSystemHint,
  buildReasoningSummary,
  generateDossierId,
};
