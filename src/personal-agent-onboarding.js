'use strict';

const crypto = require('crypto');

const ONBOARDING_QUESTION_STATUS = Object.freeze({
  PENDING: 'pending',
  ANSWERED: 'answered',
  STALE: 'stale',
});

const ONBOARDING_PARAM_QUESTIONS = Object.freeze({
  gridOperatorId: {
    label: 'Netzbetreiber-ID',
    question: 'Welche Netzbetreiber-ID (z.B. BDEW-Code) möchten Sie verwenden?',
  },
  gridOperatorName: {
    label: 'Netzbetreiber',
    question: 'Für welchen Netzbetreiber (z.B. Stadtwerke Troisdorf) soll ich die Prüfung durchführen?',
  },
  gridOperatorBdew: {
    label: 'BDEW-Code',
    question: 'Kennen Sie den BDEW-Code Ihres Netzbetreibers?',
  },
  bdew: {
    label: 'BDEW-Code',
    question: 'Kennen Sie den BDEW-Code Ihres Netzbetreibers?',
  },
  city: {
    label: 'Ort',
    question: 'Welcher Ort ist für die Netzbetreiber-Zuordnung relevant?',
  },
  vnbName: {
    label: 'Netzbetreibername',
    question: 'Wie lautet der Name des Netzbetreibers?',
  },
  query: {
    label: 'Suchhinweis',
    question: 'Nennen Sie bitte den Netzbetreiber oder einen belastbaren Suchhinweis (z.B. BDEW-Code oder Ort).',
  },
  operatorEvidence: {
    label: 'Netzbetreiber-Evidenz',
    question: 'Nennen Sie bitte den Netzbetreiber oder den BDEW-Code, damit ich die Zuordnung belastbar verifizieren kann.',
  },
  projectId: {
    label: 'Projekt-ID',
    question: 'Welche Projekt-ID soll ich verwenden?',
  },
  fnavProfile: {
    label: 'fNAV-Profil',
    question: 'Bitte beschreiben Sie kurz das fNAV-Profil oder geben Sie den Profilnamen an.',
  },
  voltageLevel: {
    label: 'Spannungsebene',
    question: 'In welcher Spannungsebene (NS/MS/HS) soll ich prüfen?',
  },
  postleitzahl: {
    label: 'Postleitzahl',
    question: 'Welche Postleitzahl betrifft die Anfrage?',
  },
  postalCode: {
    label: 'Postleitzahl',
    question: 'Welche Postleitzahl betrifft die Anfrage?',
  },
  location: {
    label: 'Standort',
    question: 'Welcher Standort (Stadt/PLZ) ist gemeint?',
  },
  role: {
    label: 'Rolle',
    question: 'In welcher Rolle agieren Sie (z.B. VNB, Betreiber, Dienstleister)?',
  },
});

const ONBOARDING_PARAM_ALTERNATIVES = Object.freeze({
  fnavProfile: [
    'Zunächst die technische N-1-Kapazität nach §17 EnWG ohne fNAV-Profil prüfen',
    'Netzanschluss-Eignung auf Basis der Anschlussleistung (kW/MW) vorab einschätzen',
  ],
  gridOperatorName: [
    'PLZ oder Ort angeben – der Netzbetreiber wird dann automatisch zugeordnet',
    'BDEW-Code direkt eingeben, falls bekannt',
  ],
  gridOperatorId: [
    'Netzbetreibernamen oder PLZ nennen (automatische BDEW-Auflösung)',
  ],
  gridOperatorBdew: [
    'Netzbetreibernamen oder Standort nennen – BDEW-Code wird automatisch ermittelt',
  ],
  bdew: [
    'Netzbetreibernamen oder PLZ für automatische Zuordnung nennen',
  ],
  voltageLevel: [
    'Anschlussleistung in kW oder MW angeben – Spannungsebene wird daraus abgeleitet',
  ],
  postalCode: [
    'Ort oder Landkreis nennen, falls die genaue PLZ noch nicht bekannt ist',
  ],
  postleitzahl: [
    'Ort oder Landkreis nennen, falls die genaue PLZ noch nicht bekannt ist',
  ],
  location: [
    'PLZ oder Bundesland angeben für regionalspezifische Auswertung',
  ],
  projectId: [
    'Projektnamen nennen – ich suche das Projekt dann im System',
    'Neues Projekt anlegen lassen',
  ],
  operatorEvidence: [
    'BDEW-Code, BKZ oder Marktlokationsnummer direkt eingeben',
    'Netzanschlusspunkt-Adresse nennen für automatische Zuordnung',
  ],
  city: [
    'PLZ angeben falls die Stadt noch nicht bekannt ist',
  ],
  role: [
    'Typische Rollen: VNB (Netzbetreiber), Anlagenbetreiber, Direktvermarkter, Dienstleister',
  ],
});

function buildOnboardingQuestion({ paramKey, action, fallbackText }) {
  const meta = ONBOARDING_PARAM_QUESTIONS[paramKey];
  const questionText = fallbackText || meta?.question || `Bitte geben Sie ${paramKey} an.`;
  return {
    questionId: `oq_${crypto.randomUUID().slice(0, 8)}`,
    paramKey,
    action,
    questionText,
    label: meta?.label || paramKey,
    ts: new Date().toISOString(),
    answeredAt: null,
    answer: null,
    status: ONBOARDING_QUESTION_STATUS.PENDING,
  };
}

function captureOnboardingAnswer({ question, message }) {
  if (!question || typeof message !== 'string') return null;
  const text = message.trim();
  if (text.length <= 2) return null;
  if (text.startsWith('/')) return null;

  if (question?.paramKey === 'operatorEvidence') {
    const followUpPattern = /\?|^(bitte|welche|welcher|welches|wie|was|warum|wieso|arbeite|fahre|erstelle|gib|nenne|zeige|fasse|projiziere|vergleiche|aktualisiere|erkläre|erklaere)\b/i;
    const evidencePattern = /(bkz|bdew|marktlokation|netzanschlusspunkt|netzanschlusszusage|malo|ma-lo|\b\d{13}\b|\bde\d{10,}\b)/i;

    if (followUpPattern.test(text) || !evidencePattern.test(text)) {
      return null;
    }
  }

  return {
    ...question,
    answeredAt: new Date().toISOString(),
    answer: text,
    status: ONBOARDING_QUESTION_STATUS.ANSWERED,
  };
}

function findPendingOnboardingQuestion(sessionL3 = {}) {
  const questions = Array.isArray(sessionL3?.onboardingQuestions)
    ? sessionL3.onboardingQuestions
    : [];
  return (
    questions.find((q) => q?.status === ONBOARDING_QUESTION_STATUS.PENDING) || null
  );
}

function listAnsweredOnboardingFacts(sessionL3 = {}) {
  const questions = Array.isArray(sessionL3?.onboardingQuestions)
    ? sessionL3.onboardingQuestions
    : [];
  return questions
    .filter(
      (q) =>
        q?.status === ONBOARDING_QUESTION_STATUS.ANSWERED &&
        typeof q?.answer === 'string' &&
        q.answer.trim().length > 0
    )
    .map((q) => ({
      paramKey: q.paramKey,
      value: q.answer.trim(),
      answeredAt: q.answeredAt || q.ts || new Date().toISOString(),
      source: 'onboarding-chat',
    }));
}

function markStaleQuestions(sessionL3 = {}, maxAgeHours = 24) {
  const questions = Array.isArray(sessionL3?.onboardingQuestions)
    ? sessionL3.onboardingQuestions
    : [];
  const now = Date.now();
  const maxAgeMs = Math.max(1, Number(maxAgeHours || 24)) * 60 * 60 * 1000;

  return questions.map((question) => {
    if (question?.status !== ONBOARDING_QUESTION_STATUS.PENDING) {
      return question;
    }
    const ts = Date.parse(question.ts || question.answeredAt || '');
    if (Number.isNaN(ts)) {
      return question;
    }
    if (now - ts > maxAgeMs) {
      return { ...question, status: ONBOARDING_QUESTION_STATUS.STALE };
    }
    return question;
  });
}

function parseMissingToken(missingToken) {
  const token = String(missingToken || '');
  if (!token.startsWith('oneOf:')) {
    return [token].filter(Boolean);
  }
  return token
    .replace(/^oneOf:/, '')
    .split('|')
    .map((entry) => entry.trim())
    .filter(Boolean);
}

function pickPreferredParamKey(keys = []) {
  const order = [
    'gridOperatorName',
    'gridOperatorId',
    'gridOperatorBdew',
    'bdew',
    'operatorEvidence',
    'vnbName',
    'city',
    'query',
    'projectId',
    'fnavProfile',
    'voltageLevel',
    'postalCode',
    'postleitzahl',
    'location',
    'role',
  ];
  for (const candidate of order) {
    if (keys.includes(candidate)) {
      return candidate;
    }
  }
  return keys[0] || null;
}

function resolveParamKeyFromMissing(missingParams = []) {
  if (!Array.isArray(missingParams) || missingParams.length === 0) {
    return null;
  }
  for (const token of missingParams) {
    const keys = parseMissingToken(token);
    const preferred = pickPreferredParamKey(keys);
    if (preferred) return preferred;
  }
  return null;
}

module.exports = {
  ONBOARDING_QUESTION_STATUS,
  ONBOARDING_PARAM_QUESTIONS,
  ONBOARDING_PARAM_ALTERNATIVES,
  buildOnboardingQuestion,
  captureOnboardingAnswer,
  findPendingOnboardingQuestion,
  listAnsweredOnboardingFacts,
  markStaleQuestions,
  resolveParamKeyFromMissing,
};
