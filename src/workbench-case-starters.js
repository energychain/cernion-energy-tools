'use strict';

const { Errors } = require('moleculer');
const { getWorkbenchActivity, listWorkbenchActivities } = require('./workbench-activity-taxonomy');

const CASE_STARTERS_VERSION = 'cernion.workbench.case-starters.v1';
const MAX_STARTER_PROMPT_LENGTH = 8000;
const MAX_INPUT_VALUE_LENGTH = 1000;
const SENSITIVE_KEY_PATTERN =
  /authorization|bearer|token|secret|password|api[_-]?key|credential|cookie/i;

const STARTER_OVERRIDES = [
  {
    activityId: 'market_communication_clarification',
    starterId: 'mako-mscons-aperak-clarification',
    title: 'MaKo-Klärfall: MSCONS fehlt / APERAK',
    description:
      'Strukturiert einen MaKo-/EDM-/MSB-Grenzfall mit MSCONS, APERAK/CONTRL und Stammdatenbezug.',
    requiredInputs: [
      { key: 'marketLocationId', label: 'MaLo/MeLo oder Prozessreferenz' },
      { key: 'messageStatus', label: 'Nachrichtenstatus' },
      { key: 'aperakContrlContext', label: 'APERAK/CONTRL-Kontext' },
    ],
    nextSafeStep: 'APERAK/CONTRL, MSCONS-Versandstatus und MaLo/MeLo-Stammdatenhistorie prüfen.',
  },
  {
    activityId: 'edm_metering_data_quality',
    starterId: 'edm-metering-values-clarification',
    title: 'EDM-Messwertproblem',
    description: 'Klärt fehlende oder unplausible Messwerte, Lastgänge und Zeitreihenstatus.',
    requiredInputs: [
      { key: 'marketLocationId', label: 'MaLo/MeLo' },
      { key: 'period', label: 'Zeitraum' },
      { key: 'obis', label: 'OBIS/Zeitreihe' },
      { key: 'plausibilityStatus', label: 'Plausibilisierungsstatus' },
    ],
    nextSafeStep:
      'EDM-Status, Plausibilisierung und Versand-/Übergabestatus evidenzbasiert prüfen.',
  },
  {
    activityId: 'market_master_data',
    starterId: 'malo-melo-master-data-check',
    title: 'MaLo/MeLo Stammdatenprüfung',
    description: 'Prüft MaLo-/MeLo-Zuordnung, Lieferbeginn und UTILMD-/Stammdatenkontext.',
    requiredInputs: [
      { key: 'maloId', label: 'MaLo' },
      { key: 'meloId', label: 'MeLo' },
      { key: 'deliveryStart', label: 'Lieferbeginn/Lieferende' },
      { key: 'masterDataHistory', label: 'UTILMD-/Stammdatenhistorie' },
    ],
    nextSafeStep: 'Zuordnung, Gültigkeiten und Marktpartnerkontext ohne externe Nachricht prüfen.',
  },
  {
    activityId: 'grid_connection_precheck',
    starterId: 'grid-connection-precheck',
    title: 'Netzanschlussvorprüfung',
    description: 'Führt eine nicht-bindende Vorprüfung für Anschlussleistung und Spannungsebene.',
    requiredInputs: [
      { key: 'location', label: 'Standort' },
      { key: 'energyOrLoadProfile', label: 'Jahresarbeit oder Lastprofil' },
      { key: 'requestedCapacity', label: 'Anschlussleistung' },
      { key: 'expansionReserve', label: 'Ausbaureserve' },
    ],
    nextSafeStep:
      'Anschlussleistung, Spannungsebene und fehlende Netzbetreiber-Evidenz als Vorprüfung einordnen.',
  },
  {
    activityId: 'target_grid_planning_readiness',
    starterId: 'znp-production-readiness-gate',
    title: 'Zielnetzplanung Evidence Gate',
    description: 'Strukturiert Produktionsreife, Evidenzstatus und Handoff für Zielnetzplanung.',
    requiredInputs: [
      { key: 'projectPath', label: 'Projekt/Ausbaupfad' },
      { key: 'evidenceGate', label: 'Evidence Gate' },
      { key: 'referenceData', label: 'Referenzdaten' },
      { key: 'ownerRole', label: 'Owner/Rolle' },
    ],
    nextSafeStep: 'Produktionsreife anhand fehlender Evidenz und No-Call-Grenzen einordnen.',
  },
  {
    activityId: 'redispatch_clarification',
    starterId: 'redispatch-clarification',
    title: 'Redispatch-Klärfall',
    description: 'Klärt fehlende Abrufdaten, Fahrpläne oder EDM-/Redispatch-Grenzfälle.',
    requiredInputs: [
      { key: 'assetRef', label: 'Anlage/Asset' },
      { key: 'period', label: 'Abrufzeitraum' },
      { key: 'dispatchStatus', label: 'Fahrplan-/Abrufstatus' },
      { key: 'meteringStatus', label: 'Messwertstatus' },
    ],
    nextSafeStep: 'Redispatch- und EDM-Evidenz getrennt prüfen und offene Datenlücken markieren.',
  },
  {
    activityId: 'management_dossier',
    starterId: 'management-governance-dossier',
    title: 'Management/Governance Dossier',
    description:
      'Erzeugt eine nicht-bindende Lage mit Evidenz, Risiken und nächsten sicheren Schritten.',
    requiredInputs: [
      { key: 'topic', label: 'Thema' },
      { key: 'audience', label: 'Zielgruppe' },
      { key: 'availableEvidence', label: 'verfügbare Evidenz' },
      { key: 'decisionBoundary', label: 'Entscheidungsgrenze' },
    ],
    nextSafeStep:
      'Lage, Annahmen, fehlende Evidenz und No-Call-Guards für Managementsicht trennen.',
  },
  {
    activityId: 'grid_connection_precheck',
    starterId: 'data-center-renewable-grid-precheck',
    title: 'Rechenzentrum / regionale EE / Netzanschluss',
    description:
      'Prüft regionale EE-Bedingungen, Zeitgleichkeit/PPA-Annahmen und Netzanschluss-Vorprüfung.',
    requiredInputs: [
      { key: 'location', label: 'Standort' },
      { key: 'regionalGeneration', label: 'regionale PV-/Wind-Erzeugung' },
      { key: 'simultaneityAssumption', label: 'Zeitgleichkeitsannahme' },
      { key: 'ppaQuantity', label: 'PPA-Menge' },
      { key: 'itLoadPue', label: 'IT-Last/PUE' },
    ],
    nextSafeStep:
      'Rechnerische Obergrenzen und Anschlussleistungsband nicht-bindend ausweisen; Evidenzbedarf markieren.',
  },
];

const STARTERS_BY_ID = new Map(STARTER_OVERRIDES.map((config) => [config.starterId, config]));
const DEFAULT_NO_CALL_GUARDS = [
  'Keine externe Nachricht oder Marktkommunikation ohne CET-RBAC/HITL-Freigabe.',
  'Keine Genehmigung, Freigabe, Buchung, Rechnung oder bindende regulatorische Bewertung behaupten.',
  'Bei fehlender Evidenz Arbeitsannahmen und readinessState evidence_required sichtbar machen.',
];

function starterError(message, code = 'WORKBENCH_CASE_STARTER_INVALID') {
  return new Errors.MoleculerClientError(message, 422, code);
}

function normalizeInputDescriptor(input, fallbackIndex) {
  if (typeof input === 'string') {
    return { key: `input${fallbackIndex + 1}`, label: input, required: true };
  }
  const key = String(input.key || `input${fallbackIndex + 1}`).trim();
  return {
    key,
    label: String(input.label || key).trim(),
    required: input.required !== false,
  };
}

function descriptorsFor(activity, override = {}) {
  const entries = override.requiredInputs || activity.requiredEvidence || [];
  return entries.map(normalizeInputDescriptor);
}

function starterFromActivity(activity, override = {}) {
  const requiredInputs = descriptorsFor(activity, override);
  const inheritedBlockedActions = Array.isArray(activity.blockedActions)
    ? activity.blockedActions
    : [];
  return {
    starterId: override.starterId || activity.activityId,
    activityId: activity.activityId,
    title: override.title || activity.title,
    description: override.description || `Guided starter for ${activity.title}.`,
    domainHint: activity.domain,
    initialPromptTemplate: buildPromptTemplate(activity, override, requiredInputs),
    requiredInputs,
    suggestedEvidenceTypes: [...(activity.requiredEvidence || [])],
    noCallGuards: [
      ...DEFAULT_NO_CALL_GUARDS,
      ...(activity.noCallGuards || []),
      ...(override.noCallGuards || []),
    ],
    defaultAsyncDelivery: { mode: 'poll', ackMode: 'explicit' },
    expectedRoleFamilies: [...(activity.typicalRoles || [])],
    allowedActions: [...(activity.allowedActions || [])],
    blockedActions: [...new Set([...inheritedBlockedActions, ...(override.blockedActions || [])])],
    handoffDomains: [...(activity.handoffDomains || [])],
    dossierTemplateHint: activity.dossierTemplateHint || override.dossierTemplateHint || null,
    nextSafeStep:
      override.nextSafeStep || 'CET Case klassifizieren und fehlende Evidenz markieren.',
  };
}

function buildPromptTemplate(
  activity,
  override = {},
  requiredInputs = descriptorsFor(activity, override)
) {
  const evidence = requiredInputs.map((item) => item.label).join(', ');
  return [
    `Starte einen CET Workbench Case für: ${override.title || activity.title}.`,
    `Domain-Hinweis: ${activity.domain}.`,
    evidence ? `Benötigte Eingaben/Evidenz: ${evidence}.` : null,
    `Nächster sicherer Schritt: ${override.nextSafeStep || 'fehlende Evidenz und Rückfragen herausarbeiten'}.`,
    ...DEFAULT_NO_CALL_GUARDS,
  ]
    .filter(Boolean)
    .join('\n');
}

function listCaseStarters({ domain = null } = {}) {
  const customStarters = STARTER_OVERRIDES.map((override) => {
    const activity = getWorkbenchActivity(override.activityId);
    if (!activity?.caseStarterEligible) return null;
    if (domain && activity.domain !== domain) return null;
    return starterFromActivity(activity, override);
  }).filter(Boolean);
  const customActivityIds = new Set(customStarters.map((starter) => starter.activityId));
  const taxonomyStarters = listWorkbenchActivities({ caseStarterEligible: true })
    .filter((activity) => !domain || activity.domain === domain)
    .filter((activity) => !customActivityIds.has(activity.activityId))
    .map((activity) => starterFromActivity(activity));
  return [...customStarters, ...taxonomyStarters].sort((a, b) => a.title.localeCompare(b.title));
}

function getCaseStarter(starterId) {
  const override = STARTERS_BY_ID.get(starterId);
  if (override) {
    const activity = getWorkbenchActivity(override.activityId);
    return activity?.caseStarterEligible ? starterFromActivity(activity, override) : null;
  }
  const activity = getWorkbenchActivity(starterId);
  return activity?.caseStarterEligible ? starterFromActivity(activity) : null;
}

function sanitizeStarterInputs(starter, rawInputs = {}) {
  if (!rawInputs || typeof rawInputs !== 'object' || Array.isArray(rawInputs))
    return { values: {}, missing: [] };
  const allowed = new Map(starter.requiredInputs.map((entry) => [entry.key, entry]));
  const values = {};
  for (const [key, rawValue] of Object.entries(rawInputs)) {
    if (!allowed.has(key)) continue;
    if (SENSITIVE_KEY_PATTERN.test(key))
      throw starterError(`Starter input ${key} must not contain secrets`);
    if (rawValue == null || rawValue === '') continue;
    if (typeof rawValue === 'object') throw starterError(`Starter input ${key} must be scalar`);
    const text = String(rawValue).trim();
    if (SENSITIVE_KEY_PATTERN.test(text))
      throw starterError(`Starter input ${key} must not contain secrets`);
    if (text.length > MAX_INPUT_VALUE_LENGTH) throw starterError(`Starter input ${key} too long`);
    values[key] = text;
  }
  const missing = starter.requiredInputs.filter((entry) => entry.required && !values[entry.key]);
  return { values, missing };
}

function sanitizeUserRequest(value) {
  if (value == null || value === '') return '';
  if (typeof value !== 'string') throw starterError('userRequest must be a string');
  if (SENSITIVE_KEY_PATTERN.test(value)) throw starterError('userRequest must not contain secrets');
  return value.trim().slice(0, 4000);
}

function renderStarterPrompt(starter, input = {}) {
  const { values, missing } = sanitizeStarterInputs(starter, input.inputs || {});
  const userRequest = sanitizeUserRequest(input.userRequest || input.message);
  const details = Object.entries(values)
    .map(([key, value]) => `- ${key}: ${value}`)
    .join('\n');
  const missingText = missing.length
    ? `Fehlende Starter-Eingaben: ${missing.map((entry) => entry.label).join(', ')}. Behandle den Case als evidence_required/clarification_required, bis diese Angaben geklärt sind.`
    : null;
  const prompt = [
    starter.initialPromptTemplate,
    userRequest ? `Nutzerkontext:\n${userRequest}` : null,
    details ? `Starter-Eingaben:\n${details}` : null,
    missingText,
  ]
    .filter(Boolean)
    .join('\n\n');
  return prompt.length > MAX_STARTER_PROMPT_LENGTH
    ? `${prompt.slice(0, MAX_STARTER_PROMPT_LENGTH)}\n[TRUNCATED_BY_WORKBENCH_CASE_STARTER]`
    : prompt;
}

function starterKnownContext(starter, input = {}) {
  const { values, missing } = sanitizeStarterInputs(starter, input.inputs || {});
  return {
    schemaVersion: CASE_STARTERS_VERSION,
    starterId: starter.starterId,
    activityId: starter.activityId,
    domainHint: starter.domainHint,
    requiredInputs: starter.requiredInputs,
    providedInputs: values,
    missingInputs: missing.map((entry) => entry.label),
    suggestedEvidenceTypes: starter.suggestedEvidenceTypes,
    noCallGuards: starter.noCallGuards,
    nextSafeStep: starter.nextSafeStep,
    blockedActions: starter.blockedActions,
    expectedRoleFamilies: starter.expectedRoleFamilies,
  };
}

module.exports = {
  CASE_STARTERS_VERSION,
  listCaseStarters,
  getCaseStarter,
  renderStarterPrompt,
  starterKnownContext,
  sanitizeStarterInputs,
};
