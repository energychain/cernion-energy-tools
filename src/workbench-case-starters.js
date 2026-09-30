'use strict';

const { Errors } = require('moleculer');
const { getWorkbenchActivity, listWorkbenchActivities } = require('./workbench-activity-taxonomy');

const CASE_STARTERS_VERSION = 'cernion.workbench.case-starters.v1';
const MAX_STARTER_PROMPT_LENGTH = 8000;
const MAX_INPUT_VALUE_LENGTH = 1000;
const SENSITIVE_KEY_PATTERN =
  /authorization|bearer|token|secret|password|api[_-]?key|credential|cookie/i;

const STARTER_COLUMNS = ['activityId', 'starterId', 'title', 'description', 'nextSafeStep'];
const STARTER_ROWS_TEXT = `\
market_communication_clarification|mako-mscons-aperak-clarification|MaKo-Klärfall: MSCONS fehlt / APERAK|Strukturiert einen MaKo-/EDM-/MSB-Grenzfall mit MSCONS, APERAK/CONTRL und Stammdatenbezug.|APERAK/CONTRL, MSCONS-Versandstatus und MaLo/MeLo-Stammdatenhistorie prüfen.|marketLocationId=MaLo/MeLo oder Prozessreferenz;messageStatus=Nachrichtenstatus;aperakContrlContext=APERAK/CONTRL-Kontext\nedm_metering_data_quality|edm-metering-values-clarification|EDM-Messwertproblem|Klärt fehlende oder unplausible Messwerte, Lastgänge und Zeitreihenstatus.|EDM-Status, Plausibilisierung und Versand-/Übergabestatus evidenzbasiert prüfen.|marketLocationId=MaLo/MeLo;period=Zeitraum;obis=OBIS/Zeitreihe;plausibilityStatus=Plausibilisierungsstatus\nmarket_master_data|malo-melo-master-data-check|MaLo/MeLo Stammdatenprüfung|Prüft MaLo-/MeLo-Zuordnung, Lieferbeginn und UTILMD-/Stammdatenkontext.|Zuordnung, Gültigkeiten und Marktpartnerkontext ohne externe Nachricht prüfen.|maloId=MaLo;meloId=MeLo;deliveryStart=Lieferbeginn/Lieferende;masterDataHistory=UTILMD-/Stammdatenhistorie\ngrid_connection_precheck|grid-connection-precheck|Netzanschlussvorprüfung|Führt eine nicht-bindende Vorprüfung für Anschlussleistung und Spannungsebene.|Anschlussleistung, Spannungsebene und fehlende Netzbetreiber-Evidenz als Vorprüfung einordnen.|location=Standort;energyOrLoadProfile=Jahresarbeit oder Lastprofil;requestedCapacity=Anschlussleistung;expansionReserve=Ausbaureserve\ntarget_grid_planning_readiness|znp-production-readiness-gate|Zielnetzplanung Evidence Gate|Strukturiert Produktionsreife, Evidenzstatus und Handoff für Zielnetzplanung.|Produktionsreife anhand fehlender Evidenz und No-Call-Grenzen einordnen.|projectPath=Projekt/Ausbaupfad;evidenceGate=Evidence Gate;referenceData=Referenzdaten;ownerRole=Owner/Rolle\nredispatch_clarification|redispatch-clarification|Redispatch-Klärfall|Klärt fehlende Abrufdaten, Fahrpläne oder EDM-/Redispatch-Grenzfälle.|Redispatch- und EDM-Evidenz getrennt prüfen und offene Datenlücken markieren.|assetRef=Anlage/Asset;period=Abrufzeitraum;dispatchStatus=Fahrplan-/Abrufstatus;meteringStatus=Messwertstatus\nmanagement_dossier|management-governance-dossier|Management/Governance Dossier|Erzeugt eine nicht-bindende Lage mit Evidenz, Risiken und nächsten sicheren Schritten.|Lage, Annahmen, fehlende Evidenz und No-Call-Guards für Managementsicht trennen.|topic=Thema;audience=Zielgruppe;availableEvidence=verfügbare Evidenz;decisionBoundary=Entscheidungsgrenze\ngrid_connection_precheck|data-center-renewable-grid-precheck|Rechenzentrum / regionale EE / Netzanschluss|Prüft regionale EE-Bedingungen, Zeitgleichkeit/PPA-Annahmen und Netzanschluss-Vorprüfung.|Rechnerische Obergrenzen und Anschlussleistungsband nicht-bindend ausweisen; Evidenzbedarf markieren.|location=Standort;regionalGeneration=regionale PV-/Wind-Erzeugung;simultaneityAssumption=Zeitgleichkeitsannahme;ppaQuantity=PPA-Menge;itLoadPue=IT-Last/PUE\n`;

function parseStarterRows() {
  return STARTER_ROWS_TEXT.trim()
    .split('\n')
    .map((line) => line.split('|'));
}

function parseRequiredInputs(serializedInputs) {
  return serializedInputs.split(';').map((entry) => {
    const [key, ...labelParts] = entry.split('=');
    return { key, label: labelParts.join('=').trim() };
  });
}

function starterOverrideFromRow(row) {
  const override = Object.fromEntries(STARTER_COLUMNS.map((column, index) => [column, row[index]]));
  override.requiredInputs = parseRequiredInputs(row[STARTER_COLUMNS.length]);
  return override;
}

const STARTER_OVERRIDES = parseStarterRows().map(starterOverrideFromRow);

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
