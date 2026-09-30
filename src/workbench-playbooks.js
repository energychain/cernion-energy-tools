'use strict';

const { Errors } = require('moleculer');
const { GOVERNANCE_BY_DOMAIN, governanceForDomain } = require('./workbench-tool-governance');

const SAFE_ACTIONS = ['inspect_evidence', 'clarify', 'prepare_handoff'];
const SKILL_STATUSES = ['draft', 'proposed', 'active', 'deprecated', 'archived'];
const KNOWN_DOMAINS = new Set(Object.keys(GOVERNANCE_BY_DOMAIN));
const BASELINE_BLOCKED_ACTIONS = ['external_message_send', 'approval_grant'];
const MAX_STR = 500;
const MAX_LIST = 20;
const MAX_STEPS = 30;

const SENSITIVE_PATTERN =
  /authorization|bearer|secret|password|api[_-]?key|private[_-]?key|credential|access[_-]?token|cookie/i;

function skillError(message, code = 'WORKBENCH_SKILL_INVALID') {
  return new Errors.MoleculerClientError(message, 422, code);
}

function containsCredentialUrl(text) {
  const marker = '://';
  const schemeIndex = text.indexOf(marker);
  if (schemeIndex === -1) return false;
  const authority = text.slice(schemeIndex + marker.length).split(/[\s/]/, 1)[0] || '';
  if (!authority.includes('@') || !authority.includes(':')) return false;
  const userInfo = authority.split('@')[0];
  return userInfo.includes(':');
}

function looksSecret(text) {
  return SENSITIVE_PATTERN.test(text) || containsCredentialUrl(text) || /^bearer\s+/i.test(text);
}

function rejectOrUndefined(condition, message, strict, code) {
  if (!condition) return false;
  if (strict) throw skillError(message, code);
  return true;
}

function sanitizeText(value, field, { required = false, max = MAX_STR, strict = true } = {}) {
  if (value == null || value === '') {
    if (required && strict) throw skillError(`${field} required`);
    return undefined;
  }
  if (
    rejectOrUndefined(
      typeof value !== 'string',
      `${field} must be a string, not a nested/raw payload`,
      strict
    )
  ) {
    return undefined;
  }
  const text = value.trim();
  if (rejectOrUndefined(!text && required, `${field} required`, strict)) return undefined;
  if (
    rejectOrUndefined(
      looksSecret(text),
      `${field} must not contain secrets or credentials`,
      strict,
      'WORKBENCH_SKILL_SECRET_REJECTED'
    )
  ) {
    return undefined;
  }
  if (text.length > max) {
    if (strict) throw skillError(`${field} too long`);
    return text.slice(0, max);
  }
  return text || undefined;
}

function sanitizeList(
  values,
  field,
  { maxItems = MAX_LIST, maxLen = MAX_STR, strict = true } = {}
) {
  if (values == null) return [];
  if (!Array.isArray(values)) {
    if (strict) throw skillError(`${field} must be a list`);
    return [];
  }
  const out = [];
  for (const raw of values) {
    if (typeof raw !== 'string') {
      if (strict) throw skillError(`${field} must be a flat list of strings, not nested objects`);
      continue;
    }
    const cleaned = sanitizeText(raw, field, { max: maxLen, strict });
    if (cleaned) out.push(cleaned);
    if (out.length >= maxItems) break;
  }
  return [...new Set(out)];
}

function normalizeDomains(values, { strict = true, required = true, field = 'domains' } = {}) {
  const list = sanitizeList(values, field, { maxItems: 6, maxLen: 80, strict });
  const filtered = list.filter((d) => KNOWN_DOMAINS.has(d));
  if (required && strict && !filtered.length) {
    throw skillError(`${field} required and must reference known Workbench domains`);
  }
  return filtered;
}

function applyGuardInheritance(skill) {
  const domains = skill.domains?.length ? skill.domains : ['governance'];
  const noCallGuards = new Set(skill.noCallGuards || []);
  for (const d of domains) {
    for (const g of governanceForDomain(d).noCallGuards || []) noCallGuards.add(g);
  }
  const blockedActions = new Set([...(skill.blockedActions || []), ...BASELINE_BLOCKED_ACTIONS]);
  return {
    ...skill,
    blockedActions: [...blockedActions],
    noCallGuards: [...noCallGuards],
  };
}

function buildSkillInput(raw = {}, { strict = true } = {}) {
  const title = sanitizeText(raw.title, 'title', { required: true, max: 200, strict: true });
  const description = sanitizeText(raw.description, 'description', { max: 2000, strict }) || '';
  const domains = normalizeDomains(
    raw.domains?.length ? raw.domains : [raw.domain].filter(Boolean),
    {
      strict,
    }
  );
  const triggerPatterns = sanitizeList(
    raw.triggerPatterns || raw.routingSignals,
    'triggerPatterns',
    {
      strict,
    }
  );
  const examplePrompts = sanitizeList(raw.examplePrompts, 'examplePrompts', {
    maxLen: 400,
    strict,
  });
  const applicableRoles = sanitizeList(raw.applicableRoles || raw.roleFamilies, 'applicableRoles', {
    strict,
  });
  const requiredEvidence = sanitizeList(raw.requiredEvidence, 'requiredEvidence', { strict });
  const steps = sanitizeList(raw.steps, 'steps', { maxItems: MAX_STEPS, maxLen: 500, strict });
  const allowedActionsRaw = sanitizeList(raw.allowedActions, 'allowedActions', { strict });
  const blockedActions = sanitizeList(raw.blockedActions, 'blockedActions', { strict });
  const noCallGuards = sanitizeList(raw.noCallGuards, 'noCallGuards', { maxLen: 400, strict });
  const handoffDomains = normalizeDomains(raw.handoffDomains, {
    strict,
    required: false,
    field: 'handoffDomains',
  });
  const capabilityHints = sanitizeList(raw.capabilityHints, 'capabilityHints', { strict });
  const receiptHints = sanitizeList(raw.receiptHints, 'receiptHints', { strict });
  const base = {
    title,
    description,
    domain: domains[0] || 'governance',
    domains,
    scope: 'tenant',
    roleFamilies: applicableRoles,
    applicableRoles,
    routingSignals: triggerPatterns,
    triggerPatterns,
    examplePrompts,
    requiredEvidence,
    steps,
    allowedActions: allowedActionsRaw.length ? allowedActionsRaw : SAFE_ACTIONS,
    blockedActions,
    noCallGuards,
    handoffDomains,
    capabilityHints,
    receiptHints,
  };
  return applyGuardInheritance(base);
}

function projectSkillFromCase({
  classification = {},
  currentDomain,
  evidenceTypes = [],
  override = {},
}) {
  const domain = currentDomain || classification.primaryDomain || 'governance';
  const hint = (classification.activityHints || [])[0] || {};
  const applicableRoles = [
    classification.roleProjection?.roleFamily,
    ...(governanceForDomain(domain).requiredRoles || []),
  ].filter(Boolean);
  return {
    title: override.title || `Proposed skill: ${domain} case pattern`,
    description: override.description || '',
    domain,
    domains: [domain],
    triggerPatterns: hint.matchedSignals || [],
    examplePrompts: override.examplePrompts || [],
    applicableRoles,
    requiredEvidence: [
      ...new Set([
        ...(evidenceTypes || []),
        ...(governanceForDomain(domain).requiredEvidence || []),
      ]),
    ],
    steps: classification.nextSafeStep ? [classification.nextSafeStep] : [],
    allowedActions: classification.allowedActions || [],
    blockedActions: classification.blockedActions || [],
    noCallGuards: classification.noCallGuards || [],
    handoffDomains: hint.handoffDomains || [],
    capabilityHints: hint.capabilityMappings || [],
    receiptHints: hint.receiptMappings || [],
  };
}

function playbook({
  playbookId,
  title,
  domain,
  scope = 'domain',
  roleFamilies,
  routingSignals,
  requiredEvidence,
  allowedActions = SAFE_ACTIONS,
  blockedActions,
  noCallGuards,
  handoffRules,
  eventRules,
}) {
  return {
    playbookId,
    title,
    domain,
    scope,
    roleFamilies,
    routingSignals,
    requiredEvidence,
    allowedActions,
    blockedActions,
    noCallGuards,
    handoffRules,
    eventRules,
  };
}

const DEFAULT_PLAYBOOKS = [
  playbook({
    playbookId: 'mako-clarification-case',
    title: 'MaKo clarification case',
    domain: 'market_communication',
    roleFamilies: ['ROLE_MARKET_COMMUNICATION', 'ROLE_GRID_OPERATOR'],
    routingSignals: ['market_communication', 'aperak', 'mscons', 'contrl'],
    requiredEvidence: [
      'aperak_message',
      'contrl_message',
      'mscons_message_status',
      'utilmd_master_data',
    ],
    blockedActions: ['external_message_send', 'approval_grant'],
    noCallGuards: ['Keine externe Marktkommunikationsnachricht ohne CET-RBAC/HITL-Freigabe.'],
    handoffRules: ['Bei MaLo/MeLo/Lieferbeginn-Hinweisen market_master_data prüfen.'],
    eventRules: ['evidence.required', 'clarification.required'],
  }),
  playbook({
    playbookId: 'edm-measurement-issue',
    title: 'EDM measurement-data issue',
    domain: 'edm',
    roleFamilies: ['ROLE_EDM', 'ROLE_GRID_OPERATOR'],
    routingSignals: ['edm', 'mscons', 'zeitreihe', 'lastgang'],
    requiredEvidence: ['mscons_timeseries_status', 'metering_values_export'],
    blockedActions: ['external_message_send', 'billing_write'],
    noCallGuards: ['Keine Abrechnungskorrektur ohne geprüfte Messwert-/Bilanzierungs-Evidenz.'],
    handoffRules: ['Bei Versand-/APERAK-Hinweisen market_communication hinzuziehen.'],
    eventRules: ['evidence.required'],
  }),
  playbook({
    playbookId: 'grid-connection-precheck',
    title: 'Grid connection preliminary review',
    domain: 'grid_connection',
    roleFamilies: ['ROLE_GRID_OPERATOR', 'ROLE_GRID_PLANNING'],
    routingSignals: ['grid_connection', 'anschlussleistung', 'spannungsebene'],
    requiredEvidence: ['grid_connection_document', 'calculation_assumption'],
    blockedActions: ['connection_approval', 'binding_capacity_commitment'],
    noCallGuards: ['Keine Netzanschlusszusage oder Genehmigungsaussage ohne Netzbetreiberprüfung.'],
    handoffRules: ['Bei MW-Leistung Mittelspannung/Hochspannung parallel prüfen.'],
    eventRules: ['evidence.required', 'handoff.required'],
  }),
  playbook({
    playbookId: 'dossier-no-call-review',
    title: 'Dossier and no-call review',
    domain: 'governance',
    scope: 'tenant',
    roleFamilies: ['ROLE_MANAGEMENT_READ', 'ROLE_UTILITY_HQ', 'ROLE_GRID_OPERATOR'],
    routingSignals: ['dossier', 'lage', 'governance', 'management'],
    requiredEvidence: ['generic_document', 'calculation_assumption'],
    allowedActions: ['inspect_evidence', 'prepare_dossier', 'clarify'],
    blockedActions: ['approval_grant', 'external_message_send', 'regulatory_binding_statement'],
    noCallGuards: ['Dossier ist intern/nicht-bindend, solange readinessState nicht ready ist.'],
    handoffRules: ['Bei fehlender Evidenz evidence.required erzeugen.'],
    eventRules: ['readiness.review_required'],
  }),
  playbook({
    playbookId: 'willi-mako-evidence-usage',
    title: 'Willi-MaKo supporting evidence usage',
    domain: 'market_communication',
    roleFamilies: ['ROLE_MARKET_COMMUNICATION', 'ROLE_GRID_OPERATOR'],
    routingSignals: ['willi_mako_ref', 'market_communication', 'mako_error_code_diagnosis'],
    requiredEvidence: ['mako_error_code_diagnosis', 'mako_process_trace'],
    blockedActions: ['external_message_send', 'case_auto_resolution'],
    noCallGuards: ['Willi-MaKo ist Diagnose-/Evidence-Quelle; CET bleibt Case-/Audit-Owner.'],
    handoffRules: ['APERAK Z18 gegen AHB, Segmentreferenz und Stammdatenhistorie prüfen.'],
    eventRules: ['evidence.available', 'readiness.review_required'],
  }),
];

function safePlaybook(playbook) {
  if (!playbook) return null;
  const domains =
    Array.isArray(playbook.domains) && playbook.domains.length
      ? playbook.domains
      : [playbook.domain].filter(Boolean);
  const roleFamilies = playbook.roleFamilies || [];
  const routingSignals = playbook.routingSignals || [];
  return {
    // legacy/back-compat playbook fields
    playbookId: playbook.playbookId,
    domain: playbook.domain,
    scope: playbook.scope,
    roleFamilies,
    routingSignals,
    handoffRules: playbook.handoffRules || [],
    eventRules: playbook.eventRules || [],
    // Issue #640 Skill object fields
    skillId: playbook.playbookId,
    tenantId: playbook.tenantId,
    title: playbook.title,
    description: playbook.description || '',
    domains,
    triggerPatterns: playbook.triggerPatterns?.length ? playbook.triggerPatterns : routingSignals,
    examplePrompts: playbook.examplePrompts || [],
    applicableRoles: playbook.applicableRoles?.length ? playbook.applicableRoles : roleFamilies,
    requiredEvidence: playbook.requiredEvidence || [],
    steps: playbook.steps || [],
    allowedActions: playbook.allowedActions || [],
    blockedActions: playbook.blockedActions || [],
    noCallGuards: playbook.noCallGuards || [],
    handoffDomains: playbook.handoffDomains || [],
    capabilityHints: playbook.capabilityHints || [],
    receiptHints: playbook.receiptHints || [],
    status: playbook.status || 'active',
    version: playbook.version || 1,
    createdBy: playbook.createdBy || null,
    approvedBy: playbook.approvedBy || null,
    createdAt: playbook.createdAt || null,
    updatedAt: playbook.updatedAt || null,
    auditRefs: playbook.auditRefs || [],
  };
}

function defaultPlaybooksForTenant(tenantId) {
  return DEFAULT_PLAYBOOKS.map((item) =>
    safePlaybook({ ...item, tenantId, source: 'default', version: 1, status: 'active' })
  );
}

function matchPlaybooks(playbooks, { domain, roles = [], workspaceId = null } = {}) {
  const roleSet = new Set(roles);
  return playbooks
    .filter((item) => (item.status || 'active') === 'active')
    .filter((item) => {
      if (!domain) return true;
      if (item.domain === domain || item.domain === 'governance') return true;
      return Array.isArray(item.domains) && item.domains.includes(domain);
    })
    .filter((item) => !item.workspaceId || item.workspaceId === workspaceId)
    .filter(
      (item) => !item.roleFamilies?.length || item.roleFamilies.some((role) => roleSet.has(role))
    )
    .map(safePlaybook)
    .slice(0, 5);
}

module.exports = {
  DEFAULT_PLAYBOOKS,
  SKILL_STATUSES,
  defaultPlaybooksForTenant,
  matchPlaybooks,
  safePlaybook,
  buildSkillInput,
  projectSkillFromCase,
  applyGuardInheritance,
  sanitizeText,
  sanitizeList,
  normalizeDomains,
  skillError,
};
